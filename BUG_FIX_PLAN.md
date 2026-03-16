# Bug Fix Plan

---

## Bug 1 — Clarify who the host is

**Problem:** There is no visual indicator in the lobby or game board telling players who the current host is. The 👑 "Make Host" button on other players' rows implies something, but there is no label on the host themselves.

**Root cause:** `playerItemHtml` shows host-control buttons for *other* players, but never marks the host's own row. The game board header has no host indicator at all.

**Fix:**
- In `playerItemHtml` (lobby.js): add a `👑` crown badge next to the username of the player whose `id === hostUserId`. Pass `hostUserId` into the function.
- In `renderGameBoard` (gameBoard.js): if `isHost`, show a small "You are the host" or 👑 chip somewhere unobtrusive (e.g. next to the ⏹ End Game button, or as a tooltip on it).

**Files:** `client/src/ui/lobby.js`, `client/src/ui/gameBoard.js`

---

## Bug 2 — Host transfer on disconnect; end game if no humans remain

**Problem:** When the host disconnects, `game.hostUserId` still points to the gone user. No new host is promoted. All host-gated actions (start game, add bot, kick, end game) silently fail for everyone. If all humans leave a playing game, it keeps running bots forever.

**Root cause:** The `disconnect` handler in `server.js` removes the player but never reassigns `hostUserId`.

**Fix:**
In the `disconnect` handler, after `removePlayer`:
1. If `userId === game.hostUserId`:
   - Find the next human player in `game.players` (not a bot).
   - If found: `game.hostUserId = nextHuman.id` and log the transfer.
   - If not found in lobby: `deleteGame` (no one left to host).
   - If not found while playing: call `finalizeGame`, emit `game-over` to the room, then optionally keep bots running or end the game.
2. Extend the same check to `lobby-spectate`: if the host moves to spectators and is the *only* real player left in the player list, reassign host to the next human player (or let spectator-host remain, which already works).

**Files:** `server/server.js`

---

## Bug 3 — End Game button not appearing after spectate → rejoin cycle

**Problem:** The host spectates via the 👁 Watch button, then rejoins via ↩ Rejoin. After rejoining, `isHost` in `renderGameBoard` is `false` and the ⏹ End Game button is missing.

**Root cause — two sub-issues:**

1. **`lobby-spectate` emits a custom state** (`{ ...game, isSpectating: true }`) directly to the socket *after* `broadcastGameState`, which strips `hostUserId` from the per-player public state. The client stores this state and now thinks `hostUserId` is undefined.

   Actually the real issue: `getPublicState` spreads the whole game object including `hostUserId` — so that should be fine. The problem is more subtle:

2. **`lobby-rejoin` does not resend state to the rejoining socket.** After `broadcastGameState`, the rejoining player's socket is moved back to the `player:userId:instanceId` room, but `broadcastGameState` iterates `game.players` to send per-player state. By the time `broadcastGameState` runs, the player is back in `game.players`, so they *should* receive their state. However, `socket.isSpectator` is set to `false` but the socket is still in the `spectators:instanceId` room momentarily — they receive the spectator-stripped state which has no `hostUserId`.

   Actually more likely: the `lobby-spectate` handler sends `{ ...game, isSpectating: true }` which is the *raw game object* — not `getPublicState` — so it may be missing fields or ordered incorrectly compared to what the client expects.

**Fix:**
- In `lobby-rejoin`: after `broadcastGameState`, also send `getPublicState(game, userId)` directly to the rejoining socket so they get the full player view with `hostUserId` intact.
- In `lobby-spectate`: replace `socket.emit("game-state", { ...game, isSpectating: true })` with `socket.emit("game-state", { ...getSpectatorState(game), isSpectating: true })` for consistency.

**Files:** `server/server.js`

---

## Bug 4 — Settings panel causes layout shift when collapsed vs expanded

**Problem:** The `.lobby-actions` button bar changes width/alignment depending on whether `<details id="settings-panel">` is open or closed. This is because the settings panel and the action buttons share the same parent flow and the `<details>` element changes the container width.

**Root cause:** The host actions block renders buttons and the `<details>` panel as siblings in the same `<div class="lobby-actions">`. The `<details>` element has no fixed width; when open, its content (`.settings-body`) expands and shifts surrounding flex items.

**Fix:**
- Move `${settingsPanelHtml}` *outside* `.lobby-actions` so it sits below the button row as a separate block — which it already partially does (it's after the closing `</div>`). Verify there is no accidental nesting.
- Add `width: 100%` to `.settings-panel` so it always takes full container width regardless of open/closed state.
- Add `align-items: center` and a fixed `min-width` or `justify-content: flex-start` to `.lobby-actions` so buttons stay left-aligned and don't reflow when content outside them changes.

**Files:** `client/src/ui/lobby.js`, `client/style.css`
