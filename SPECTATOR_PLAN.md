# Spectator Mode — Implementation Plan

Spectators are Discord users who join a game instance to watch without participating. They see the full public game state (card counts, event log, claimed half-suits) in real time but have no hand, no turn, and no action buttons.

---

## 1. What Spectators Can and Cannot Do

| | Spectator | Player |
|---|---|---|
| See card counts for all players | ✅ | ✅ |
| See the event log | ✅ | ✅ |
| See claimed half-suits | ✅ | ✅ |
| See their own hand | — (no hand) | ✅ |
| See other players' hands | ❌ | ❌ |
| Ask for a card | ❌ | ✅ |
| Claim a half-suit | ❌ | ✅ |
| Chat / react | ✅ (future) | ✅ (future) |
| Join mid-game | ✅ | ❌ |
| Leave without affecting game state | ✅ | turn advances |

---

## 2. Server Changes

### `server/game/gameEngine.js`

Add a `spectators` array to the game state:

```js
// In createGame():
{
  ...
  spectators: [],   // [{ id, username, avatarUrl }]
}
```

Add two helpers:

```js
export function addSpectator(gameState, { id, username, avatarUrl }) {
  if (gameState.spectators.find(s => s.id === id)) return gameState; // already watching
  gameState.spectators.push({ id, username, avatarUrl });
  return gameState;
}

export function removeSpectator(gameState, spectatorId) {
  gameState.spectators = gameState.spectators.filter(s => s.id !== spectatorId);
  return gameState;
}
```

Update `getPublicState` so spectators always receive the state with no hand data (same as other players' views, `forPlayerId = null`):

```js
export function getSpectatorState(gameState) {
  return {
    ...gameState,
    isSpectating: true,
    players: gameState.players.map(({ hand: _hand, ...rest }) => rest),
  };
}
```

### `server/server.js`

#### `join-game` event — add a `spectate` flag

```js
socket.on("join-game", ({ instanceId, userId, username, avatarUrl, spectate = false }) => {
  ...
  if (spectate || game.status === "playing") {
    // Join as spectator
    addSpectator(game, { id: userId, username, avatarUrl });
    socket.isSpectator = true;
    socket.join(instanceId);
    socket.join(`spectator:${userId}:${instanceId}`);
    socket.emit("game-state", getSpectatorState(game));
    broadcastSpectatorList(instanceId, game);
    return;
  }
  // Normal player join...
});
```

#### `broadcastGameState` — send spectator state to watchers

```js
function broadcastGameState(instanceId, gameState) {
  // Players get their private state (hand included)
  for (const player of gameState.players) {
    if (player.isBot) continue;
    io.to(`player:${player.id}:${instanceId}`).emit("game-state", getPublicState(gameState, player.id));
  }
  // Spectators get a hand-stripped state with isSpectating: true
  io.to(instanceId).emit("game-state-spectator", getSpectatorState(gameState));
  scheduleBotTurn(instanceId);
}
```

In the client the spectator socket listens on `game-state-spectator` instead of `game-state`.

#### `disconnect` for spectators

```js
socket.on("disconnect", () => {
  if (socket.isSpectator) {
    removeSpectator(game, socket.userId);
    broadcastSpectatorList(instanceId, game);
    return;
  }
  // Existing player disconnect logic...
});
```

---

## 3. Client Changes

### `client/main.js`

Detect the `spectate` query param (can be set by Discord when sharing the activity, or toggled in the lobby):

```js
const isSpectating = urlParams.get('spectate') === '1'
  || /* game already full or in progress when we joined */ false;

socket.emit("join-game", {
  instanceId,
  userId: localUser.id,
  username: localUser.username,
  avatarUrl: localUser.avatarUrl,
  spectate: isSpectating,
});
```

Track spectator mode in `gameState.js` — the `isSpectating` flag comes down with every state update.

### Socket event routing

```js
socket.on("game-state", (state) => {
  // Only fired for players
  updateState({ ...state, isSpectating: false });
});

socket.on("game-state-spectator", (state) => {
  // Only fired for spectators
  updateState({ ...state, isSpectating: true });
});
```

---

## 4. UI Changes

### Lobby screen

- Add a **"Join as Spectator"** button alongside "Start Game" for non-host users, and also shown when the game is already full.
- Display a **Spectators** section below the two team columns, listing current watchers.

```
  Team A 🔵       Team B 🔴
  • Alice          • Dave
  • Bob            • Eve
  • Carol          • Frank

  👁 Watching (2)
  • Grace  • Heidi
```

### Game screen (spectator view)

The table layout is identical, but:
- The **hand tray is hidden** (no cards to show).
- The **Ask Card** and **Claim Half-Suit** buttons are replaced with a read-only banner:
  ```
  👁 You are spectating — sit back and enjoy!
  ```
- A **"Spectators (N)"** chip sits in the header strip. Hovering it reveals the watcher list.
- Turn announcements and the event log are fully visible.

### Optional: "X-ray" mode

A toggle button exclusive to spectators that reveals all players' hands (since the server could optionally send this). This would only be enabled when the host allows it — useful for learning / commentary.

> **Privacy note**: x-ray mode must be opt-in by the host and clearly indicated to all players (e.g. a 👁 banner shown to everyone).

---

## 5. Spectator List in the Header

A small avatars strip shows who is watching, similar to Discord's "watching" indicators:

```
[≡ Log]   Team A: 3  |  Team B: 2        👁 3  [🧑][🧑][🧑]
```

Clicking the 👁 chip expands a tooltip/dropdown listing spectator names.

---

## 6. Mid-Game Join

If a user opens the activity while a game is already in progress:
- The server detects `game.status === "playing"` during `join-game` and automatically promotes them to spectator (even without `spectate: true` in the payload).
- The client renders the spectator game view immediately.
- They can continue watching when the current game ends and a new lobby forms — at which point they are given the option to **join as a player** for the next game.

---

## 7. Implementation Phases

| Phase | Work | Files |
|---|---|---|
| **A** | Server: `addSpectator`, `removeSpectator`, `getSpectatorState`, `spectators` array in game state | `gameEngine.js` |
| **B** | Server: spectate flag in `join-game`, `game-state-spectator` broadcast, disconnect cleanup | `server.js` |
| **C** | Client: `spectate` query param detection, dual socket event routing | `main.js`, `gameState.js` |
| **D** | Client: spectator banner in game screen, hide hand tray | `gameBoard.js`, `handDisplay.js` |
| **E** | Client: spectator list in lobby + header chip | `lobby.js`, `playerList.js` |
| **F** | Client: "Join as Spectator" button, mid-game auto-spectate | `lobby.js`, `main.js` |
| **G** | Optional: x-ray mode toggle (host-controlled) | `server.js`, `gameBoard.js` |
