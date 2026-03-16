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
  assignTeams,
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
  // Exchange the code for an access_token.
  // Note: redirect_uri is intentionally omitted — Discord Activities use an
  // internal OAuth flow where no HTTP redirect occurs.
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

  const data = await response.json();
  if (!response.ok) {
    console.error("[/api/token] Discord returned error:", data);
    return res.status(response.status).json({ error: data.error, error_description: data.error_description });
  }
  res.send({ access_token: data.access_token });
});

// ─── Helper: broadcast per-player state to entire room ────────────────────────

function broadcastGameState(instanceId, gameState) {
  // Update turn timer deadline BEFORE sending state so clients see the correct value
  refreshTurnTimer(instanceId);
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

// ─── Turn timer ──────────────────────────────────────────────────────────────

const turnTimers = new Map(); // instanceId -> timeoutId

/**
 * Refreshes the turn countdown for the current player.
 * Sets game.turnTimerDeadline (included in broadcast) and schedules a server
 * timeout that auto-advances the turn when the limit expires.
 * Called at the top of broadcastGameState so the deadline is always current.
 */
function refreshTurnTimer(instanceId) {
  // Cancel any running countdown
  if (turnTimers.has(instanceId)) {
    clearTimeout(turnTimers.get(instanceId));
    turnTimers.delete(instanceId);
  }

  const game = getGame(instanceId);
  if (!game || game.status !== "playing") {
    if (game) game.turnTimerDeadline = null;
    return;
  }

  const limit = game.settings?.turnTimeLimit;
  if (!limit || limit <= 0) {
    game.turnTimerDeadline = null;
    return;
  }

  const current = game.players.find(p => p.id === game.currentTurnPlayerId);
  if (!current || current.isBot) {
    game.turnTimerDeadline = null;
    return;
  }

  // Stamp the deadline on the game object so it travels with the broadcast
  const deadline = Date.now() + limit * 1000;
  game.turnTimerDeadline = deadline;

  const capturedPlayerId = current.id;
  const capturedName = current.username;
  const timer = setTimeout(() => {
    turnTimers.delete(instanceId);
    const g = getGame(instanceId);
    if (!g || g.status !== "playing" || g.currentTurnPlayerId !== capturedPlayerId) return;
    g.eventLog.push({ type: "turn_timeout", message: `${capturedName}'s time ran out!` });
    advanceTurn(g);
    broadcastGameState(instanceId, g);
  }, limit * 1000);

  turnTimers.set(instanceId, timer);
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

  const delay = (() => {
    const game = getGame(instanceId);
    const fast = game?.settings?.botSpeed === 'fast';
    return fast ? 300 + Math.random() * 300 : 1200 + Math.random() * 1000;
  })();
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
  const bot = game.players.find(p => p.id === botId);
  // Auto-assign to the team with fewer players (balance teams)
  const teamACount = game.players.filter(p => p.teamIndex === 0).length;
  const teamBCount = game.players.filter(p => p.teamIndex === 1).length;
  const teamIndex = teamACount <= teamBCount ? 0 : 1;
  bot.teamIndex = teamIndex;
  if (!game.teams[teamIndex]) game.teams[teamIndex] = [];
  game.teams[teamIndex].push(botId);
  return bot;
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

    // Set hostUserId to the first human who joins
    if (!game.hostUserId) {
      game.hostUserId = userId;
    }

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
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can start the game.", code: "FORBIDDEN" });
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
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can add bots.", code: "FORBIDDEN" });
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
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can remove bots.", code: "FORBIDDEN" });
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

  // ── lobby-spectate ─────────────────────────────────────────────────────────
  // Moves the requesting player from the player list to spectators (in the lobby).
  // The host keeps their hostUserId so they can still start the game.
  socket.on("lobby-spectate", ({ instanceId }) => {
    const { userId, username, avatarUrl } = socket;
    const game = getGame(instanceId);
    if (!game || game.status !== "lobby") return;

    const isPlayer = game.players.find(p => p.id === userId);
    if (!isPlayer) return; // already not a player

    removePlayer(game, userId);
    addSpectator(game, { id: userId, username, avatarUrl });

    socket.leave(`player:${userId}:${instanceId}`);
    socket.join(`spectators:${instanceId}`);
    socket.isSpectator = true;

    broadcastGameState(instanceId, game);
    // Resend lobby state with isSpectating so the client updates its view
    socket.emit("game-state", { ...getSpectatorState(game), isSpectating: true });
    console.log(`[Game ${instanceId}] ${username} moved to spectators in lobby`);
  });

  // ── lobby-rejoin ───────────────────────────────────────────────────────────
  // Moves the requesting user back from spectators to the player list (lobby only).
  socket.on("lobby-rejoin", ({ instanceId }) => {
    const { userId, username, avatarUrl } = socket;
    const game = getGame(instanceId);
    if (!game || game.status !== "lobby") return;
    if (game.players.length >= 8) {
      socket.emit("error", { message: "Game is full.", code: "VALIDATION" });
      return;
    }

    removeSpectator(game, userId);
    joinGame(game, { id: userId, username, avatarUrl });

    socket.leave(`spectators:${instanceId}`);
    socket.join(`player:${userId}:${instanceId}`);
    socket.isSpectator = false;

    broadcastGameState(instanceId, game);
    // Explicitly resend full player-view state to the rejoining socket so
    // hostUserId is present (they may have received a spectator-stripped state).
    socket.emit("game-state", getPublicState(game, userId));
    console.log(`[Game ${instanceId}] ${username} rejoined as player from spectators`);
  });

  // ── shuffle-teams ──────────────────────────────────────────────────────────
  socket.on("shuffle-teams", ({ instanceId }) => {
    const game = getGame(instanceId);
    if (!game || game.status !== "lobby") return;
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can shuffle teams.", code: "FORBIDDEN" });
      return;
    }
    assignTeams(game);
    console.log(`[Game ${instanceId}] Teams shuffled by host`);
    broadcastGameState(instanceId, game);
  });

  // ── switch-team ────────────────────────────────────────────────────────────
  // Allows a player to move themselves to a specific team in the lobby.
  socket.on("switch-team", ({ instanceId, teamIndex }) => {
    const { userId } = socket;
    const game = getGame(instanceId);
    if (!game || game.status !== "lobby") return;
    if (teamIndex !== 0 && teamIndex !== 1) return;
    const player = game.players.find(p => p.id === userId);
    if (!player) return;
    // Remove from current team tracking array
    const oldIndex = player.teamIndex;
    if (oldIndex !== null && oldIndex !== undefined && game.teams[oldIndex]) {
      game.teams[oldIndex] = game.teams[oldIndex].filter(id => id !== userId);
    }
    player.teamIndex = teamIndex;
    if (!game.teams[teamIndex]) game.teams[teamIndex] = [];
    game.teams[teamIndex].push(userId);
    console.log(`[Game ${instanceId}] ${socket.username} switched to team ${teamIndex}`);
    broadcastGameState(instanceId, game);
  });

  // ── end-game ─────────────────────────────────────────────────────────────
  // Host ends the in-progress game early and sends everyone to the results screen.
  socket.on("end-game", ({ instanceId }) => {
    const game = getGame(instanceId);
    if (!game) return;
    if (game.status !== "playing") return;
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can end the game.", code: "FORBIDDEN" });
      return;
    }
    finalizeGame(game);
    io.to(instanceId).emit("game-over", { scores: game.scores, winner: game.winner });
    broadcastGameState(instanceId, game);
    console.log(`[Game ${instanceId}] Game ended early by host`);
  });

  // ── reset-game ─────────────────────────────────────────────────────────────
  // Resets a playing or finished game back to a lobby with the same human players.
  socket.on("reset-game", async ({ instanceId }) => {
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (game.status === "lobby") {
      // Already in the lobby — resync the client and do nothing
      broadcastGameState(instanceId, game);
      return;
    }
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can go back to the lobby.", code: "FORBIDDEN" });
      return;
    }

    // Collect survivors from BOTH players AND spectators (host may be spectating)
    // Deduplicate by id in case anyone appears in both lists
    const allHumans = [
      ...game.players.filter(p => !p.isBot),
      ...game.spectators,
    ].filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);

    const survivors = allHumans.map(p => ({
      ...p,
      hand: [], cardCount: 0, teamIndex: null,
    }));

    Object.assign(game, {
      status:              'lobby',
      players:             survivors,
      spectators:          [],
      teams:               [[], []],
      currentTurnPlayerId: null,
      lastQuestion:        null,
      claimedHalfSuits:    [],
      scores:              [0, 0],
      forcedClaimTeam:     null,
      eventLog:            [],
      startedAt:           null,
      finishedAt:          null,
      // preserve settings and hostUserId
    });

    console.log(`[Game ${instanceId}] Game reset to lobby by host`);

    // Fix socket room memberships — everyone in the instance becomes a player again
    const socketsInRoom = await io.in(instanceId).fetchSockets();
    for (const s of socketsInRoom) {
      const uid = s.userId;
      if (!uid) continue;
      s.leave(`spectators:${instanceId}`);
      s.join(`player:${uid}:${instanceId}`);
      s.isSpectator = false;
    }

    broadcastGameState(instanceId, game);
  });

  // ── update-settings ────────────────────────────────────────────────────────
  socket.on("update-settings", ({ instanceId, settings }) => {
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (game.status !== "lobby" && game.status !== "playing") {
      socket.emit("error", { message: "Settings can only be changed in the lobby or during a game.", code: "INVALID_STATE" });
      return;
    }
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can change settings.", code: "FORBIDDEN" });
      return;
    }

    // Whitelist known keys only to prevent pollution
    const allowed = ['botDifficulty', 'botSpeed', 'turnTimeLimit'];
    for (const key of allowed) {
      if (settings[key] !== undefined) game.settings[key] = settings[key];
    }

    broadcastGameState(instanceId, game);
  });

  // ── kick-player ────────────────────────────────────────────────────────────
  socket.on("kick-player", ({ instanceId, targetId }) => {
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (game.status !== "lobby") {
      socket.emit("error", { message: "Can only kick players in the lobby.", code: "INVALID_STATE" });
      return;
    }
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can kick players.", code: "FORBIDDEN" });
      return;
    }
    if (targetId === socket.userId) {
      socket.emit("error", { message: "You cannot kick yourself.", code: "VALIDATION" });
      return;
    }

    removePlayer(game, targetId);
    io.to(`player:${targetId}:${instanceId}`).emit("kicked", { reason: "You were removed by the host." });
    console.log(`[Game ${instanceId}] Player ${targetId} was kicked by host`);
    broadcastGameState(instanceId, game);
  });

  // ── transfer-host ──────────────────────────────────────────────────────────
  socket.on("transfer-host", ({ instanceId, newHostId }) => {
    const game = getGame(instanceId);
    if (!game) {
      socket.emit("error", { message: "Game not found.", code: "NOT_FOUND" });
      return;
    }
    if (game.status !== "lobby") {
      socket.emit("error", { message: "Can only transfer host in the lobby.", code: "INVALID_STATE" });
      return;
    }
    if (game.hostUserId !== socket.userId) {
      socket.emit("error", { message: "Only the host can transfer host.", code: "FORBIDDEN" });
      return;
    }
    const newHost = game.players.find(p => p.id === newHostId && !p.isBot);
    if (!newHost) {
      socket.emit("error", { message: "Target player not found.", code: "NOT_FOUND" });
      return;
    }

    game.hostUserId = newHostId;
    console.log(`[Game ${instanceId}] Host transferred to ${newHost.username}`);
    broadcastGameState(instanceId, game);
  });

  // ── spectate-bot-game (legacy — kept for session compatibility) ───────────
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

    removePlayer(game, userId);
    while (game.players.length < 6) addBotToGame(game);

    try {
      startGame(game);
    } catch (err) {
      socket.emit("error", { message: err.message, code: "VALIDATION" });
      return;
    }

    socket.isSpectator = true;
    socket.join(`spectators:${instanceId}`);
    addSpectator(game, { id: userId, username, avatarUrl });

    console.log(`[Game ${instanceId}] Bot-only game started (legacy); ${username} is spectating`);
    socket.emit("game-state", getSpectatorState(game));
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

      // Reassign host if the disconnecting player was the host
      if (game.hostUserId === userId) {
        const nextHuman = game.players.find(p => !p.isBot);
        if (nextHuman) {
          game.hostUserId = nextHuman.id;
          console.log(`[Game ${instanceId}] Host transferred to ${nextHuman.username} after disconnect`);
        } else {
          // No humans left — delete the game
          deleteGame(instanceId);
          console.log(`[Game ${instanceId}] Deleted: no humans remain after host disconnect`);
          return;
        }
      }

      broadcastGameState(instanceId, game);
      if (game.players.length === 0) {
        deleteGame(instanceId);
      }
    } else if (game.status === "playing") {
      // Reassign host if needed
      if (game.hostUserId === userId) {
        const nextHuman = game.players.find(p => !p.isBot && p.id !== userId);
        if (nextHuman) {
          game.hostUserId = nextHuman.id;
          console.log(`[Game ${instanceId}] Host transferred to ${nextHuman.username} during game`);
        } else {
          // No humans left — end the game
          finalizeGame(game);
          io.to(instanceId).emit("game-over", { scores: game.scores, winner: game.winner });
          broadcastGameState(instanceId, game);
          console.log(`[Game ${instanceId}] Game ended: no humans remain`);
          return;
        }
      }

      if (game.currentTurnPlayerId === userId) {
        advanceTurn(game);
      }
      broadcastGameState(instanceId, game);
    }
  });
});

// ─── Start server ──────────────────────────────────────────────────────────────

httpServer.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
