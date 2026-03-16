# Go To Lobby Fix Plan

## Observed behaviour
Clicking "Go to Lobby" from the results screen (or after End Game) does nothing.
The server log confirms "Game reset to lobby by host" fires, so the server-side
reset succeeds. The client never transitions back to the lobby UI.

---

## Root cause trace

### Scenario that triggers the bug
1. Host joins as a player → socket joins `instanceId` + `player:{hostId}:{instanceId}`
2. Host clicks 👁 Watch → `lobby-spectate` fires:
   - `removePlayer(game, hostId)` — host removed from `game.players`
   - `addSpectator(game, ...)` — host added to `game.spectators`
   - `socket.leave("player:{hostId}:{instanceId}")`
   - `socket.join("spectators:{instanceId}")`
3. Game starts. Host's socket is in: `instanceId` (base) + `spectators:{instanceId}`
4. Host clicks 👑 End Game → game finishes. `broadcastGameState` sends the
   finished state to `spectators:{instanceId}` (still populated). Client renders results screen.
5. Host clicks "Go to Lobby" → `reset-game` fires on the server.

### What happens inside `reset-game`
```
survivors = game.players.filter(!isBot)   // host is NOT in game.players — they spectated
                                          // so survivors = [] (or other human players only)

Object.assign(game, {
  players:    survivors,   // host excluded
  spectators: [],          // ← spectators list CLEARED — host vanishes from both lists
  ...
});

// fetchSockets loop: checks isNowPlayer = game.players.some(p => p.id === uid)
//   Host's uid is not in game.players → isNowPlayer = false
//   Host's socket stays in spectators:{instanceId}, isSpectator stays true

broadcastGameState(instanceId, game):
  // Iterates game.players → host is not there → host gets nothing
  // Checks game.spectators.length > 0 → it's 0 (cleared) → spectators room gets nothing
  // HOST RECEIVES NO STATE UPDATE
```

### Why the previous `fetchSockets` patch didn't help
The patch correctly moves sockets back to `player:{}:{}` rooms — but only for userIds
that appear in `game.players` after the reset. The host-spectator is never added to
`game.players` by the patch, so the condition `isNowPlayer = false` and the fix does
nothing for the host.

---

## Fix

**Core idea**: before clearing `game.spectators`, collect all human participants
(from both `game.players` AND `game.spectators`). Put them ALL into the new
`game.players` survivor list. Then fix their socket room memberships.

### Changes to `server/server.js` — `reset-game` handler

```js
// 1. Collect survivors from BOTH lists before clearing them
const allHumans = [
  ...game.players.filter(p => !p.isBot),
  ...game.spectators,
].filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i); // deduplicate

const survivors = allHumans.map(p => ({
  ...p,
  hand: [], cardCount: 0, teamIndex: null,
}));

// 2. Reset game state
Object.assign(game, {
  status: 'lobby',
  players: survivors,
  spectators: [],
  ...
});

// 3. Fix socket room memberships for everyone in the instance
const socketsInRoom = await io.in(instanceId).fetchSockets();
for (const s of socketsInRoom) {
  const uid = s.userId;
  if (!uid) continue;
  // Everyone is now a player in lobby
  s.leave(`spectators:${instanceId}`);
  s.join(`player:${uid}:${instanceId}`);
  s.isSpectator = false;
}

// 4. Broadcast — now all sockets are in their player rooms
broadcastGameState(instanceId, game);
```

### Why this is correct
- The host who was spectating is now a player again in the lobby (with no cards,
  unassigned team), same as if they had clicked Rejoin.
- `broadcastGameState` now finds the host in `game.players` and sends to
  `player:{hostId}:{instanceId}`, which the host's socket now belongs to.
- The client's `onStateChange` receives `status: 'lobby'` and renders the lobby.

### No other files need changes
- `gameState.js` — shallow merge is fine; `status: 'lobby'` overwrites `status: 'finished'`
- `main.js` — `onStateChange` already routes `status === 'lobby'` to `renderLobby`
- Client-side lobby rendering — already handles the host being in the player list
