import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";
import fetch from "node-fetch";

import { getOrCreateGame, getGame, deleteGame } from "./game/gameManager.js";
import {
  joinGame,
  removePlayer,
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

// ─── Socket.io event handlers ─────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // ── join-game ──────────────────────────────────────────────────────────────
  socket.on("join-game", ({ instanceId, userId, username, avatarUrl }) => {
    if (!instanceId || !userId) {
      socket.emit("error", { message: "instanceId and userId are required.", code: "BAD_REQUEST" });
      return;
    }

    const game = getOrCreateGame(instanceId);

    // Track this socket's identity for later use
    socket.instanceId = instanceId;
    socket.userId = userId;

    // Join rooms: instance room (public) and private per-player room
    socket.join(instanceId);
    socket.join(`player:${userId}:${instanceId}`);

    // If game is already playing and player is rejoining, just resend state
    if (game.status === "playing" || game.status === "finished") {
      const existingPlayer = game.players.find(p => p.id === userId);
      if (existingPlayer) {
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

    const existingBots = game.players.filter(p => p.isBot);
    const botName = getNextBotName(existingBots);
    const botId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    joinGame(game, { id: botId, username: botName, avatarUrl: null, isBot: true });
    console.log(`[Game ${instanceId}] Bot added: ${botName}`);
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

  // ── request-state ─────────────────────────────────────────────────────────
  socket.on("request-state", ({ instanceId }) => {
    const userId = socket.userId;
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    const publicState = getPublicState(game, userId);
    socket.emit("game-state", publicState);
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const { instanceId, userId } = socket;
    console.log(`[Socket] Client disconnected: ${socket.id} (user: ${userId})`);

    if (!instanceId || !userId) return;

    const game = getGame(instanceId);
    if (!game) return;

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
