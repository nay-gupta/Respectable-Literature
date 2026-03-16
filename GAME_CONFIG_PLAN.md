# Game Configuration & Management Plan

## Overview

This plan covers three categories of features:

1. **New Game** — the ability to reset/restart a game after it finishes, without requiring all players to leave and rejoin
2. **Game Settings** — host-configurable options set in the lobby before the game starts
3. **Common Config** — quality-of-life management features (kick, team lock, player cap, spectate-from-lobby, etc.)

---

## Part 1 — New Game (Rematch / Reset)

### Current behaviour

When a game finishes, `renderResultsScreen` is shown. There is no way to play again — players must close and reopen the Discord Activity.

### Goal

After a game ends, the host can press **Play Again**. This resets the game state back to a lobby with the same players (minus any disconnected ones), preserving team assignments if desired.

---

### 1.1 Server — `reset-game` socket event

**File:** `server/server.js`

Add a new socket handler `reset-game`:

```js
socket.on("reset-game", ({ instanceId, keepTeams = false }) => {
  const game = getGame(instanceId);
  if (!game) { socket.emit("error", …); return; }
  if (game.status !== "finished") { socket.emit("error", …); return; }

  // Determine host: first non-bot human player
  const host = game.players.find(p => !p.isBot);
  if (socket.userId !== host?.id) {
    socket.emit("error", { message: "Only the host can start a new game.", code: "FORBIDDEN" });
    return;
  }

  // Keep only the human players (drop bots); reset their hands/cardCount
  const survivors = game.players
    .filter(p => !p.isBot)
    .map(p => ({ ...p, hand: [], cardCount: 0, teamIndex: keepTeams ? p.teamIndex : null }));

  // Reset the game object in-place (preserves socket room memberships)
  Object.assign(game, {
    status:              'lobby',
    players:             survivors,
    teams:               [[], []],
    currentTurnPlayerId: null,
    lastQuestion:        null,
    claimedHalfSuits:    [],
    scores:              [0, 0],
    forcedClaimTeam:     null,
    eventLog:            [],
    startedAt:           null,
    finishedAt:          null,
    settings:            game.settings,   // preserve settings from previous game
  });

  broadcastGameState(instanceId, game);
});
```

> **Why in-place mutation?** All sockets are already in the `instanceId` room and `player:{id}:{instanceId}` rooms. A full `deleteGame` + `createGame` would require all clients to rejoin their rooms.

---

### 1.2 Client — Results screen

**File:** `client/src/ui/resultsScreen.js`

Add a **Play Again** button visible to the host:

```js
// In the results HTML template:
${isHost ? `<button id="play-again-btn" class="btn btn-primary">🔄 Play Again</button>` : ''}

// In the event binding section:
container.querySelector('#play-again-btn')?.addEventListener('click', () => {
  emit('reset-game', { instanceId, keepTeams: false });
});
```

The `isHost` check: `state.players[0]?.id === localUserId` (first player is always host).

---

## Part 2 — Game Settings

### Goal

The host can configure options in the lobby before pressing Start. Settings are stored in `game.settings` on the server and sent to all clients as part of the game state.

### Settings to implement

| Setting | Type | Default | Description |
|---|---|---|---|
| `playerCount` | `6` \| `8` | `6` | Lock the lobby to exactly 6 or 8 players |
| `botDifficulty` | `"easy"` \| `"hard"` | `"easy"` | Easy = current random logic; Hard = smarter ask selection |
| `botSpeed` | `"slow"` \| `"fast"` | `"slow"` | Slow = 1.2–2.2 s delay; Fast = 0.3–0.6 s |
| `turnTimeLimit` | `0` \| `30` \| `60` \| `90` | `0` (off) | Seconds per turn; 0 = unlimited |
| `allowSpectators` | `boolean` | `true` | If false, late joiners cannot watch |

---

### 2.1 Server — store settings on game state

**File:** `server/game/gameEngine.js`

Add a `settings` field to `createGame`:

```js
export function createGame(instanceId) {
  return {
    …,
    settings: {
      playerCount:    6,
      botDifficulty:  'easy',
      botSpeed:       'slow',
      turnTimeLimit:  0,
      allowSpectators: true,
    },
  };
}
```

---

### 2.2 Server — `update-settings` socket event

**File:** `server/server.js`

```js
socket.on("update-settings", ({ instanceId, settings }) => {
  const game = getGame(instanceId);
  if (!game) { socket.emit("error", …); return; }
  if (game.status !== "lobby") { socket.emit("error", { message: "Settings can only be changed in the lobby." }); return; }

  const host = game.players.find(p => !p.isBot);
  if (socket.userId !== host?.id) { socket.emit("error", { message: "Only the host can change settings." }); return; }

  // Whitelist only known keys to prevent injection
  const allowed = ['playerCount', 'botDifficulty', 'botSpeed', 'turnTimeLimit', 'allowSpectators'];
  for (const key of allowed) {
    if (settings[key] !== undefined) game.settings[key] = settings[key];
  }

  broadcastGameState(instanceId, game);
});
```

---

### 2.3 Server — enforce settings at game start

**File:** `server/server.js` — `start-game` handler

```js
// Before calling startGame(game):
const required = game.settings.playerCount;
if (game.players.length !== required) {
  socket.emit("error", { message: `Need exactly ${required} players to start.` });
  return;
}
```

---

### 2.4 Server — use `botSpeed` in `scheduleBotTurn`

**File:** `server/server.js`

```js
const [minDelay, maxDelay] = game.settings.botSpeed === 'fast'
  ? [300, 600]
  : [1200, 2200];
const delay = minDelay + Math.random() * (maxDelay - minDelay);
```

---

### 2.5 Server — turn time limit enforcement

**File:** `server/server.js`

Add a `turnTimers` Map alongside `botTimeouts`. After every `broadcastGameState`:

```js
function scheduleTurnTimer(instanceId) {
  clearTurnTimer(instanceId);
  const game = getGame(instanceId);
  if (!game || game.status !== 'playing') return;
  if (!game.settings.turnTimeLimit) return;               // 0 = off
  if (game.players.find(p => p.id === game.currentTurnPlayerId)?.isBot) return; // bots handled separately

  const ms = game.settings.turnTimeLimit * 1000;
  const t = setTimeout(() => {
    const g = getGame(instanceId);
    if (!g || g.status !== 'playing') return;
    // Force the turn to advance (player ran out of time)
    g.eventLog.push({ type: 'timeout', playerId: g.currentTurnPlayerId });
    advanceTurn(g);
    broadcastGameState(instanceId, g);
  }, ms);
  turnTimers.set(instanceId, t);
}
```

Send `settings.turnTimeLimit` and `turnStartedAt: Date.now()` in the game state so the client can render a countdown.

---

### 2.6 Client — Settings panel in the lobby

**File:** `client/src/ui/lobby.js`

Add a collapsible settings section below the action buttons, visible only to the host:

```html
<details class="settings-panel" id="settings-panel">
  <summary class="settings-summary">⚙ Game Settings</summary>
  <div class="settings-body">

    <label class="setting-row">
      <span>Player count</span>
      <div class="btn-group">
        <button class="setting-btn ${s.playerCount===6?'active':''}" data-setting="playerCount" data-value="6">6</button>
        <button class="setting-btn ${s.playerCount===8?'active':''}" data-setting="playerCount" data-value="8">8</button>
      </div>
    </label>

    <label class="setting-row">
      <span>Bot difficulty</span>
      <div class="btn-group">
        <button class="setting-btn ${s.botDifficulty==='easy'?'active':''}" data-setting="botDifficulty" data-value="easy">Easy</button>
        <button class="setting-btn ${s.botDifficulty==='hard'?'active':''}" data-setting="botDifficulty" data-value="hard">Hard</button>
      </div>
    </label>

    <label class="setting-row">
      <span>Bot speed</span>
      <div class="btn-group">
        <button class="setting-btn ${s.botSpeed==='slow'?'active':''}" data-setting="botSpeed" data-value="slow">Slow</button>
        <button class="setting-btn ${s.botSpeed==='fast'?'active':''}" data-setting="botSpeed" data-value="fast">Fast</button>
      </div>
    </label>

    <label class="setting-row">
      <span>Turn time limit</span>
      <div class="btn-group">
        <button class="setting-btn ${s.turnTimeLimit===0?'active':''}"  data-setting="turnTimeLimit" data-value="0">Off</button>
        <button class="setting-btn ${s.turnTimeLimit===30?'active':''}" data-setting="turnTimeLimit" data-value="30">30s</button>
        <button class="setting-btn ${s.turnTimeLimit===60?'active':''}" data-setting="turnTimeLimit" data-value="60">60s</button>
      </div>
    </label>

    <label class="setting-row">
      <span>Allow spectators</span>
      <input type="checkbox" ${s.allowSpectators ? 'checked' : ''} id="allow-spectators-toggle" />
    </label>

  </div>
</details>
```

Event binding (one delegated listener on the panel):

```js
container.querySelector('#settings-panel')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-setting]');
  if (!btn) return;
  const key = btn.dataset.setting;
  const raw = btn.dataset.value;
  const value = isNaN(raw) ? raw : Number(raw);
  emit('update-settings', { instanceId, settings: { [key]: value } });
});

container.querySelector('#allow-spectators-toggle')?.addEventListener('change', e => {
  emit('update-settings', { instanceId, settings: { allowSpectators: e.target.checked } });
});
```

---

### 2.7 CSS — settings panel

**File:** `client/style.css`

```css
.settings-panel { margin-top: 12px; border: 1px solid var(--border); border-radius: var(--radius); }
.settings-summary { cursor: pointer; padding: 8px 12px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
.settings-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
.btn-group { display: flex; gap: 4px; }
.setting-btn {
  background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-muted); font-size: 11px; font-weight: 600; padding: 3px 9px;
  cursor: pointer; font-family: inherit;
}
.setting-btn.active { background: var(--team-a); color: #fff; border-color: var(--team-a); }
.setting-btn:hover:not(.active) { border-color: var(--text-muted); color: var(--text); }
```

---

## Part 3 — Common Config (Management Features)

### 3.1 Kick player (host only)

**When:** Lobby only.

**Server (`server.js`):**

```js
socket.on("kick-player", ({ instanceId, targetId }) => {
  const game = getGame(instanceId);
  const host = game?.players.find(p => !p.isBot);
  if (socket.userId !== host?.id) { socket.emit("error", { message: "Only the host can kick." }); return; }
  if (game.status !== 'lobby') { socket.emit("error", { message: "Can't kick after game starts." }); return; }

  removePlayer(game, targetId);
  // Tell the kicked socket to go back to a "kicked" state
  io.to(`player:${targetId}:${instanceId}`).emit("kicked", { reason: "You were removed by the host." });
  broadcastGameState(instanceId, game);
});
```

**Client (`lobby.js`):** Add a ✕ button next to each non-bot human player row when `isHost`. Emit `kick-player`.

**Client (`main.js`):** Listen for `kicked` event → show a toast and reset to a "you were kicked" screen.

---

### 3.2 Transfer host

**When:** Lobby only.

The first player in `game.players` is the host. To transfer:

**Server:**

```js
socket.on("transfer-host", ({ instanceId, newHostId }) => {
  …
  // Move newHostId to index 0 in players array
  const idx = game.players.findIndex(p => p.id === newHostId);
  if (idx > 0) {
    const [player] = game.players.splice(idx, 1);
    game.players.unshift(player);
  }
  broadcastGameState(instanceId, game);
});
```

**Client:** Host sees a "👑 Make Host" option in each player row dropdown.

---

### 3.3 Team lock (prevent shuffle after manual assignment)

**Game state field:** `settings.teamsLocked: false`

When `teamsLocked = true`, the **Shuffle Teams** button is hidden and `start-game` skips the `assignTeams()` call, preserving manually chosen positions.

**Client:** Add a **🔒 Lock Teams** toggle button in lobby actions (host only). Emits `update-settings` with `{ teamsLocked: true/false }`.

**Server `start-game`:** 

```js
if (!game.settings.teamsLocked) {
  assignTeams(game);
}
```

---

### 3.4 Manual team switching (self-service)

Allow players to switch between Team A and Team B themselves before the game starts (subject to team balance — max 4 per team in 8-player, max 3 in 6-player).

**Server:**

```js
socket.on("switch-team", ({ instanceId }) => {
  const game = getGame(instanceId);
  if (game.status !== 'lobby') return;
  if (game.settings.teamsLocked) { socket.emit("error", { message: "Teams are locked." }); return; }

  const player = game.players.find(p => p.id === socket.userId);
  if (!player || player.teamIndex === null) return;

  const maxPerTeam = game.players.length <= 6 ? 3 : 4;
  const targetTeam = player.teamIndex === 0 ? 1 : 0;
  const targetCount = game.players.filter(p => p.teamIndex === targetTeam).length;
  if (targetCount >= maxPerTeam) { socket.emit("error", { message: "That team is full." }); return; }

  player.teamIndex = targetTeam;
  broadcastGameState(instanceId, game);
});
```

**Client:** Each player sees a **↔ Switch** button next to their own name in the lobby.

---

### 3.5 Reconnect grace period

**Current behaviour:** On disconnect, players are removed from the lobby (and the game after disconnect).

**Goal:** Give disconnected in-game players 60 seconds to reconnect before treating them as gone.

**Server `disconnect` handler adjustment:**

```js
// Instead of removing immediately during a game:
if (game.status === 'playing') {
  const GRACE_MS = 60_000;
  player.disconnected = true;
  broadcastGameState(instanceId, game);  // show greyed-out tile to others
  
  const timer = setTimeout(() => {
    removePlayer(game, userId);
    broadcastGameState(instanceId, game);
  }, GRACE_MS);
  disconnectTimers.set(`${userId}:${instanceId}`, timer);
} else {
  // In lobby: remove immediately as before
  removePlayer(game, userId);
  broadcastGameState(instanceId, game);
}
```

**Client `cameraTile.js`:** Show a "🔌 Reconnecting…" overlay when `player.disconnected === true`.

---

### 3.6 Host spectates from the lobby (bot-only game without a dedicated button)

#### Goal

The host should be able to:
1. Add bots as players in the lobby (using the existing **Add Bot** button)
2. Click **👁 Watch** on their own player row to move themselves from the player list to the spectator list
3. Click **▶ Start Game** — the game starts with only the bots, and the host watches as a spectator

This replaces the current dedicated **👁 Watch Bots Play** button with a natural lobby workflow. The button can be removed once this is implemented.

---

#### Why this requires a persistent host identity

Currently the host is determined by `game.players[0]` — the first human in the player array. If the host moves themselves out of the player list, they lose host status and cannot start the game. To fix this, a `hostUserId` field must be stored on the game object separately from the player list.

---

#### 3.6.1 Server — add `hostUserId` to game state

**File:** `server/game/gameEngine.js`

```js
export function createGame(instanceId) {
  return {
    …,
    hostUserId: null,   // set to the first human who joins
  };
}
```

**File:** `server/server.js` — `join-game` handler

When the first non-bot human joins, set `game.hostUserId` if it is not already set:

```js
if (!game.hostUserId && !spectate) {
  game.hostUserId = userId;
}
```

Replace all `game.players.find(p => !p.isBot)` host checks with `game.hostUserId === socket.userId`.

---

#### 3.6.2 Server — `lobby-spectate` socket event

A new event that moves the requesting player from the player list into the spectator list while still in the lobby:

```js
socket.on("lobby-spectate", ({ instanceId }) => {
  const game = getGame(instanceId);
  if (!game || game.status !== 'lobby') return;

  const { userId, username, avatarUrl } = socket;
  const isPlayer = game.players.find(p => p.id === userId);
  if (!isPlayer) return; // already not a player

  removePlayer(game, userId);
  addSpectator(game, { id: userId, username, avatarUrl });

  // Switch socket room memberships
  socket.leave(`player:${userId}:${instanceId}`);
  socket.join(`spectators:${instanceId}`);
  socket.isSpectator = true;

  broadcastGameState(instanceId, game);
  // Send the spectator view back to this client so the lobby re-renders
  socket.emit('game-state', { ...game, isSpectating: true });
});
```

---

#### 3.6.3 Server — allow the host-spectator to start the game

**File:** `server/server.js` — `start-game` handler

Replace the current host check:

```js
// Before:
if (game.players[0]?.id !== socket.userId) { … }

// After:
if (game.hostUserId !== socket.userId) { … }
```

This allows `start-game` to succeed even when the host is in `game.spectators` instead of `game.players`.

---

#### 3.6.4 Server — host rejoins as player (`lobby-rejoin`)

If the host has moved to spectator but changes their mind, they should be able to move back to the player list:

```js
socket.on("lobby-rejoin", ({ instanceId }) => {
  const game = getGame(instanceId);
  if (!game || game.status !== 'lobby') return;
  if (game.players.length >= 8) {
    socket.emit('error', { message: 'Game is full.' }); return;
  }

  const { userId, username, avatarUrl } = socket;
  removeSpectator(game, userId);
  joinGame(game, { id: userId, username, avatarUrl });

  socket.leave(`spectators:${instanceId}`);
  socket.join(`player:${userId}:${instanceId}`);
  socket.isSpectator = false;

  broadcastGameState(instanceId, game);
});
```

---

#### 3.6.5 Client — lobby player row changes

**File:** `client/src/ui/lobby.js`

In `playerItemHtml`, add a **👁 Watch** button on the local user's own row (when they are a human player):

```js
const watchBtn = (!player.isBot && isYou)
  ? `<button class="watch-self-btn" title="Move to spectators">👁</button>`
  : '';
```

In the event binding section:

```js
container.querySelector('.watch-self-btn')?.addEventListener('click', () => {
  emit('lobby-spectate', { instanceId });
});
```

In the spectators section of the lobby, when the local user is already a spectator, show a **▶ Rejoin** button:

```js
${isSpectatorSelf ? `
  <button id="rejoin-btn" class="btn btn-ghost">↩ Rejoin as Player</button>
` : ''}
```

```js
container.querySelector('#rejoin-btn')?.addEventListener('click', () => {
  emit('lobby-rejoin', { instanceId });
});
```

The **▶ Start Game** button must remain accessible when the local user is a spectator (currently it is only rendered in the `isHost` block which checks `isPlayer`). Split the conditions:

```js
const isHost = state.hostUserId === localUserId;   // host by identity
const isPlayer = players.some(p => p.id === localUserId);
// isHost remains true even when in spectator list
```

Render the Start/Shuffle/Add Bot action bar whenever `isHost`, regardless of `isPlayer`.

---

#### 3.6.6 Remove the dedicated "Watch Bots Play" button

Once this feature is implemented, the dedicated **👁 Watch Bots Play** button in the lobby and the `spectate-bot-game` socket handler on the server can be removed. The same result is achieved by:

1. Adding bots via **🤖 Add Bot**
2. Clicking **👁 Watch** on your own player row
3. Clicking **▶ Start Game**

The `spectate-bot-game` handler should be kept until 3.6 is fully deployed to avoid breaking existing sessions during the transition.

| File | Change |
|---|---|
| `server/game/gameEngine.js` | Add `settings` + `hostUserId` fields to `createGame` |
| `server/game/botAI.js` | Add `hard` difficulty logic |
| `server/server.js` | Add `reset-game`, `update-settings`, `kick-player`, `transfer-host`, `switch-team`, `lobby-spectate`, `lobby-rejoin` handlers; set `hostUserId` on first join; apply `botSpeed`, `turnTimeLimit`, `playerCount` from settings; add reconnect grace period; remove `spectate-bot-game` (after 3.6 ships) |
| `client/src/ui/lobby.js` | Settings panel (host only); kick/switch-team/watch-self buttons; host check by `hostUserId`; rejoin button in spectators section; Play Again redirect |
| `client/src/ui/resultsScreen.js` | Play Again button |
| `client/src/ui/gameBoard.js` | Turn timer countdown display; disconnected-player overlay |
| `client/src/ui/cameraTile.js` | Disconnected state styling |
| `client/main.js` | Handle `kicked` socket event |
| `client/style.css` | Settings panel, button group, kick/transfer UI, countdown timer |

---

## Implementation Order

1. **`hostUserId` field** — prerequisite for 3.6 and needed to make host checks consistent everywhere
2. **`reset-game` + Play Again button** — standalone, easiest, high value
3. **`settings` field + `update-settings` + lobby UI** — forms the infrastructure all other settings depend on
4. **`playerCount` enforcement at start** — 2-line change once settings exist
5. **`botSpeed` in scheduler** — 2-line change
6. **`lobby-spectate` + `lobby-rejoin` + Watch button** — lets the host spectate bot games naturally; remove the dedicated Watch Bots Play button once this ships
7. **Team lock** — small addition once settings exist
8. **Manual team switching** — self-contained server + client change
9. **Kick + transfer host** — moderately complex, helpful for Discord lobbies
10. **Turn time limit** — requires timer infrastructure and client countdown UI
11. **Reconnect grace period** — most complex; requires disconnect timer map and UI state
