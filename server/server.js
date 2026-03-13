import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";
import fetch from "node-fetch";

import { getOrCreateGame, getGame, deleteGame } from "./game/gameManager.js";
import {
  joinGame,
  removePlayer,
  addSpectator,
  removeSpectator,
  getSpectatorState,
  startGame,
  validateAsk,
  processAsk,
  validateClaim,
  processClaim,
  checkEndgame,
  finalizeGame,
  getPublicState,
  advanceTurn,
} from "./game/gameEngine.js";
import { getBotMove, getNextBotName } from "./game/botAI.js";

dotenv.config({ path: "../.env" });

const app = express();
const httpServer = createServer(app);
const port = 3001;

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "https://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Allow express to parse JSON bodies
app.use(express.json());

// ─── REST endpoints ────────────────────────────────────────────────────────────

app.post("/api/token", async (req, res) => {
  // Exchange the code for an access_token
  const response = await fetch(`https://discord.com/api/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: req.body.code,
    }),
  });

  const { access_token } = await response.json();
  res.send({ access_token });
});

// ─── Helper: broadcast per-player state to entire room ────────────────────────

function broadcastGameState(instanceId, gameState) {
  for (const player of gameState.players) {
    if (player.isBot) continue; // bots have no socket
    const publicState = getPublicState(gameState, player.id);
    io.to(`player:${player.id}:${instanceId}`).emit("game-state", publicState);
  }
  // Spectators get a hand-stripped view
  if (gameState.spectators.length > 0) {
    const spectatorState = getSpectatorState(gameState);
    io.to(`spectators:${instanceId}`).emit("game-state", spectatorState);
  }
  // After every state change, schedule a bot move if it's a bot's turn
  scheduleBotTurn(instanceId);
}

// ─── Bot turn scheduling ──────────────────────────────────────────────────────

const botTimeouts = new Map(); // instanceId -> timeoutId

function scheduleBotTurn(instanceId) {
  // Clear any already-pending bot move for this game
  if (botTimeouts.has(instanceId)) {
    clearTimeout(botTimeouts.get(instanceId));
    botTimeouts.delete(instanceId);
  }

  const game = getGame(instanceId);
  if (!game || game.status !== "playing") return;

  const current = game.players.find(p => p.id === game.currentTurnPlayerId);
  if (!current?.isBot) return;

  // Add a realistic thinking delay (1.2 – 2.2 s)
  const delay = 1200 + Math.random() * 1000;
  const timeout = setTimeout(() => {
    botTimeouts.delete(instanceId);
    executeBotTurn(instanceId, current.id);
  }, delay);
  botTimeouts.set(instanceId, timeout);
}

function executeBotTurn(instanceId, botId) {
  const game = getGame(instanceId);
  if (!game || game.status !== "playing") return;
  if (game.currentTurnPlayerId !== botId) return; // turn changed while waiting

  const move = getBotMove(game, botId);

  if (!move) {
    // Bot has no valid move; advance the turn
    advanceTurn(game);
    broadcastGameState(instanceId, game);
    return;
  }

  if (move.type === "ask") {
    const { valid } = validateAsk(game, botId, move.targetId, move.card);
    if (!valid) {
      advanceTurn(game);
    } else {
      const { newState, success } = processAsk(game, botId, move.targetId, move.card);
      Object.assign(game, newState);
      io.to(instanceId).emit("ask-result", {
        success,
        card: move.card,
        askerId: botId,
        targetId: move.targetId,
        lastQuestion: game.lastQuestion,
      });
    }
  } else if (move.type === "claim") {
    const { valid } = validateClaim(game, botId, move.halfSuit, move.cardMap);
    if (valid) {
      const claimer = game.players.find(p => p.id === botId);
      const { newState, outcome } = processClaim(game, botId, move.halfSuit, move.cardMap);
      Object.assign(game, newState);
      const scoringTeam = outcome === "correct"
        ? claimer.teamIndex
        : outcome === "opponent_has_card" ? (claimer.teamIndex === 0 ? 1 : 0) : null;
      io.to(instanceId).emit("claim-result", {
        outcome, halfSuit: move.halfSuit, teamIndex: scoringTeam, claimerId: botId,
      });
    }
  }

  const { gameOver, winner } = checkEndgame(game);
  if (gameOver) {
    finalizeGame(game);
    io.to(instanceId).emit("game-over", { scores: game.scores, winner });
  }

  broadcastGameState(instanceId, game);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Adds one bot to a lobby game and returns the bot player object. */
function addBotToGame(game) {
  const existingBots = game.players.filter(p => p.isBot);
  const botName = getNextBotName(existingBots);
  const botId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  joinGame(game, { id: botId, username: botName, avatarUrl: null, isBot: true });
  return game.players.find(p => p.id === botId);
}

// ─── Socket.io event handlers ─────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // ── join-game ──────────────────────────────────────────────────────────────
  socket.on("join-game", ({ instanceId, userId, username, avatarUrl, spectate = false }) => {
    if (!instanceId || !userId) {
      socket.emit("error", { message: "instanceId and userId are required.", code: "BAD_REQUEST" });
      return;
    }

    const game = getOrCreateGame(instanceId);

    socket.instanceId = instanceId;
    socket.userId = userId;
    socket.username = username;
    socket.avatarUrl = avatarUrl;

    // ── Spectator path ────────────────────────────────────────────────────────
    // Spectate if explicitly requested, or if the game is in-progress/finished
    // and this user isn't already a registered player.
    const isExistingPlayer = game.players.find(p => p.id === userId);
    const forceSpectate = !isExistingPlayer && (game.status === "playing" || game.status === "finished");

    if (spectate || forceSpectate) {
      socket.isSpectator = true;
      socket.join(instanceId);
      socket.join(`spectators:${instanceId}`);
      addSpectator(game, { id: userId, username, avatarUrl });
      console.log(`[Game ${instanceId}] ${username} joined as spectator (${game.spectators.length} watching)`);
      socket.emit("game-state", getSpectatorState(game));
      // Notify players that spectator count changed
      broadcastGameState(instanceId, game);
      return;
    }

    // ── Player path ───────────────────────────────────────────────────────────
    socket.join(instanceId);
    socket.join(`player:${userId}:${instanceId}`);

    // If game is already playing and player is rejoining, just resend state
    if (game.status === "playing" || game.status === "finished") {
      if (isExistingPlayer) {
        const publicState = getPublicState(game, userId);
        socket.emit("game-state", publicState);
        return;
      }
    }

    joinGame(game, { id: userId, username, avatarUrl });

    console.log(`[Game ${instanceId}] ${username} joined (${game.players.length} players)`);
    broadcastGameState(instanceId, game);
  });

  // ── start-game ────────────────────────────────────────────────────────────
  socket.on("start-game", ({ instanceId }) => {
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (game.status !== "lobby") {
      socket.emit("error", { message: "Game already started.", code: "INVALID_STATE" });
      return;
    }

    try {
      startGame(game);
    } catch (err) {
      socket.emit("error", { message: err.message, code: "VALIDATION" });
      return;
    }

    console.log(`[Game ${instanceId}] Game started with ${game.players.length} players`);
    broadcastGameState(instanceId, game);
  });

  // ── ask-card ──────────────────────────────────────────────────────────────
  socket.on("ask-card", ({ instanceId, targetId, card }) => {
    const askerId = socket.userId;
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }

    const { valid, reason } = validateAsk(game, askerId, targetId, card);
    if (!valid) {
      socket.emit("error", { message: reason, code: "VALIDATION" });
      return;
    }

    const { newState, success } = processAsk(game, askerId, targetId, card);
    Object.assign(game, newState);

    const { gameOver, winner } = checkEndgame(game);
    if (gameOver) {
      finalizeGame(game);
      io.to(instanceId).emit("game-over", { scores: game.scores, winner });
    }

    io.to(instanceId).emit("ask-result", {
      success,
      card,
      askerId,
      targetId,
      lastQuestion: game.lastQuestion,
    });

    broadcastGameState(instanceId, game);
  });

  // ── make-claim ────────────────────────────────────────────────────────────
  socket.on("make-claim", ({ instanceId, halfSuit, cardMap }) => {
    const claimerId = socket.userId;
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }

    const { valid, reason } = validateClaim(game, claimerId, halfSuit, cardMap);
    if (!valid) {
      socket.emit("error", { message: reason, code: "VALIDATION" });
      return;
    }

    const claimer = game.players.find(p => p.id === claimerId);
    const { newState, outcome } = processClaim(game, claimerId, halfSuit, cardMap);
    Object.assign(game, newState);

    const scoringTeam = outcome === "correct"
      ? claimer.teamIndex
      : outcome === "opponent_has_card"
        ? (claimer.teamIndex === 0 ? 1 : 0)
        : null;

    io.to(instanceId).emit("claim-result", {
      outcome,
      halfSuit,
      teamIndex: scoringTeam,
      claimerId,
    });

    const { gameOver, winner } = checkEndgame(game);
    if (gameOver) {
      finalizeGame(game);
      io.to(instanceId).emit("game-over", { scores: game.scores, winner });
    }

    broadcastGameState(instanceId, game);
  });

  // ── add-bot ────────────────────────────────────────────────────────────────
  socket.on("add-bot", ({ instanceId }) => {
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (game.status !== "lobby") {
      socket.emit("error", { message: "Can only add bots in the lobby.", code: "INVALID_STATE" });
      return;
    }
    if (game.players.length >= 8) {
      socket.emit("error", { message: "Game is full (max 8 players).", code: "VALIDATION" });
      return;
    }

    addBotToGame(game);
    console.log(`[Game ${instanceId}] Bot added (${game.players.length} players)`);
    broadcastGameState(instanceId, game);
  });

  // ── remove-bot ────────────────────────────────────────────────────────────
  socket.on("remove-bot", ({ instanceId, botId }) => {
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (game.status !== "lobby") {
      socket.emit("error", { message: "Can only remove bots in the lobby.", code: "INVALID_STATE" });
      return;
    }
    const bot = game.players.find(p => p.id === botId && p.isBot);
    if (!bot) {
      socket.emit("error", { message: "Bot not found.", code: "NOT_FOUND" });
      return;
    }
    removePlayer(game, botId);
    console.log(`[Game ${instanceId}] Bot removed: ${bot.username}`);
    broadcastGameState(instanceId, game);
  });

  // ── spectate-bot-game ─────────────────────────────────────────────────────
  // Removes the requesting user from the player list, fills remaining slots
  // with bots (up to 6), starts the game, and switches the user to spectator.
  socket.on("spectate-bot-game", ({ instanceId }) => {
    const { userId, username, avatarUrl } = socket;
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (game.status !== "lobby") {
      socket.emit("error", { message: "Game already started.", code: "INVALID_STATE" });
      return;
    }

    // Remove the human from the player list so all seats go to bots
    removePlayer(game, userId);

    // Fill up to exactly 6 bots (minimum needed to start)
    while (game.players.length < 6) {
      addBotToGame(game);
    }

    try {
      startGame(game);
    } catch (err) {
      socket.emit("error", { message: err.message, code: "VALIDATION" });
      return;
    }

    // Switch socket to spectator mode
    socket.isSpectator = true;
    socket.join(`spectators:${instanceId}`);
    addSpectator(game, { id: userId, username, avatarUrl });

    console.log(`[Game ${instanceId}] Bot-only game started; ${username} is spectating`);
    socket.emit("game-state", getSpectatorState(game));
    // Notify any other sockets in the room (e.g. reconnecting sessions)
    broadcastGameState(instanceId, game);
  });

  // ── request-state ─────────────────────────────────────────────────────────
  socket.on("request-state", ({ instanceId }) => {
    const userId = socket.userId;
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (socket.isSpectator) {
      socket.emit("game-state", getSpectatorState(game));
    } else {
      socket.emit("game-state", getPublicState(game, userId));
    }
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const { instanceId, userId } = socket;
    console.log(`[Socket] Client disconnected: ${socket.id} (user: ${userId})`);

    if (!instanceId || !userId) return;

    const game = getGame(instanceId);
    if (!game) return;

    if (socket.isSpectator) {
      removeSpectator(game, userId);
      broadcastGameState(instanceId, game);
      return;
    }

    if (game.status === "lobby") {
      removePlayer(game, userId);
      broadcastGameState(instanceId, game);
      if (game.players.length === 0) {
        deleteGame(instanceId);
      }
    } else if (game.status === "playing") {
      if (game.currentTurnPlayerId === userId) {
        advanceTurn(game);
        broadcastGameState(instanceId, game);
      }
    }
  });
});

// ─── Start server ──────────────────────────────────────────────────────────────

httpServer.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
