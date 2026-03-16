# Rejoin & Mid-Game Spectate — Analysis & Plan

---

## Issue 1 — Player leaves and relaunches while the game is still going

### What currently happens

#### The happy path (brief disconnect, same socket reconnects)
The Socket.io client is configured with `reconnection: true`, up to 10 attempts with 1–5 s back-off.
When the socket reconnects, `main.js` fires another `join-game` emission inside the `connect` handler.

`join-game` on the server:
1. Looks up `isExistingPlayer = game.players.find(p => p.id === userId)`.
2. Because the player is still in `game.players` (disconnect did not remove them during play), `isExistingPlayer` is truthy.
3. `forceSpectate = !isExistingPlayer && game.status === 'playing'` → **false**.
4. The player joins the `player:{id}:{instanceId}` room and `getPublicState` is sent back immediately.

**This already works correctly for brief disconnects.** The player comes back, sees their hand, and play continues.

#### The broken path (full activity close + relaunch)
When the Discord Activity is fully closed (not just a blip), the server's `disconnect` handler fires:

```js
} else if (game.status === "playing") {
  if (game.currentTurnPlayerId === userId) {
    advanceTurn(game);
  }
  broadcastGameState(instanceId, game);
  // ← player is NOT removed from game.players
}
```

The player **stays in `game.players`**. Their hand and `teamIndex` are preserved. Good.

When they relaunch the Activity, Discord re-runs the full OAuth flow and calls `setupDiscordSdk()` again, obtaining the same `userId`. The `join-game` handler re-runs successfully and the player gets their state back.

**However, there is one edge case:**

If the player was the **current turn holder** when they disconnected, `advanceTurn` fires immediately and they lose their turn. On relaunch they are back in the game but it is now someone else's turn. This is acceptable behaviour, but worth documenting.

#### What is actually broken — the `reconnect` event

`main.js` handles the Socket.io `reconnect` event by emitting `request-state`:

```js
socket.on("reconnect", () => {
  showToast("Reconnected!");
  socket.emit("request-state", { instanceId });
});
```

`request-state` **only re-sends state**. It does **not** re-join the socket to the correct rooms (`player:{id}:{instanceId}`). A reconnected socket starts with no rooms. If `request-state` arrives before `connect` (or the `connect` re-emission of `join-game` is skipped for any reason), the player will see their state but **won't receive future broadcasts** because they are not in the room.

In practice the `connect` event fires first and re-emits `join-game`, which joins the rooms. But `reconnect` fires after `connect`, so state is requested twice and the `request-state` call is redundant. The risk is low but the code is confusing.

#### What needs to change

| # | Change | File |
|---|--------|------|
| 1 | Remove the `reconnect` listener — the `connect` handler already re-emits `join-game` which resends state | `client/main.js` |
| 2 | Add a toast on the `connect` event **only when it is a reconnection** (socket was previously connected) so the user knows they are back | `client/main.js` |
| 3 | *(Optional / nice UX)* While the socket is disconnected, show an overlay ("Reconnecting…") so the player knows the game is still live and they haven't lost their seat | `client/main.js` |

---

## Issue 2 — Spectating a game that has already started

### What currently exists

The server already supports mid-game spectating. In `join-game`:

```js
const isExistingPlayer = game.players.find(p => p.id === userId);
const forceSpectate = !isExistingPlayer && (game.status === "playing" || game.status === "finished");

if (spectate || forceSpectate) {
  // join spectators room, send getSpectatorState
}
```

Any user who was **not already a player** when the game started is automatically placed into spectators if they join mid-game. This is correct.

### What is broken / missing

#### 1. No way to navigate to a live game inside Discord as a spectator
Discord launches activities via a voice channel panel. There is no lobby screen showing "a game is in progress — click here to watch". A new user who opens the activity while a game is running **will be auto-spectated**, but only after they go through the full OAuth flow and the page loads. There is no explicit "Watch" button on an interstitial. This is largely a Discord Activity UX limitation, but worth noting.

#### 2. The `?spectate=1` query param is the only explicit opt-in, and it is never used
`main.js` reads `wantsSpectate` from `?spectate=1` and passes it to `join-game`. But nothing in the UI generates that URL. The auto-spectate path (`forceSpectate`) works for brand-new joiners, but an **existing lobby player** who left and comes back after game start will be re-added to `game.players` (not spectators) because `isExistingPlayer` is still truthy — even though they closed the activity and have no hand state.

Wait — actually this is fine: the player stayed in `game.players` with their hand intact (server never removes them during play), so resending `getPublicState` is correct. ✓

#### 3. The spectator state is missing `settings` (needed by the in-game settings panel)
`getSpectatorState` does `{ ...gameState, isSpectating: true, players: ... }`. Since `settings` is a top-level field on `gameState`, it **is** included. ✓

#### 4. Mid-game spectators see `null` for players' hands (expected) but the hand tray area is hidden — correct. ✓

#### 5. Missing: an in-game "Watch" or "Spectate" button visible to the current user if they somehow arrive at the game screen without being a registered player
Currently impossible without the above auto path. No action needed.

#### 6. The `lobby-spectate` handler is lobby-only — there is NO way for an active player to voluntarily step away mid-game
```js
socket.on("lobby-spectate", ({ instanceId }) => {
  if (!game || game.status !== "lobby") return;  // ← blocks mid-game
```
This is intentional for game integrity (can't abandon your hand), so no change needed here.

### What needs to change

| # | Change | File |
|---|--------|------|
| 1 | When a new user joins mid-game (status = playing), show an explicit interstitial screen: **"A game is in progress — you're watching as a spectator"** instead of dropping them straight onto the board with no context | `client/main.js` or new `spectatorLanding.js` |
| 2 | The reconnecting overlay (from Issue 1 fix #3) should not show on a spectator's screen if the game ends, since for them the result screen will appear naturally | covered by Issue 1 fix |

---

## Summary of changes

### `client/main.js`

1. **Remove the `reconnect` listener** — state is already restored via the `connect` → `join-game` path.
2. **Track whether socket was previously connected** (`wasEverConnected` flag); in the `connect` handler, if rejoining, show "Reconnected!" toast instead of the `reconnect` event doing it.
3. **Add a disconnection overlay** (`isDisconnected` flag) that shows a non-blocking banner ("Reconnecting…") while the socket is down, and clears it on `connect`.

### No server changes required
The server already handles all the key cases:
- Player rejoins mid-game → `isExistingPlayer` is true → hand and team are restored.
- Brand-new user joins mid-game → `forceSpectate` is set → auto-spectated.
- Brief reconnect → socket `connect` re-emits `join-game` → state restored.
- Full activity relaunch → same as brief reconnect path.

---

## Code sketches

### Fix 1 & 2 & 3 — `client/main.js`

```js
// Replace the reconnect + disconnect listeners in setupSocket():

let _wasConnected = false;
let _reconnectBanner = null;

function showReconnectBanner() {
  if (_reconnectBanner) return;
  _reconnectBanner = document.createElement('div');
  _reconnectBanner.className = 'reconnect-banner';
  _reconnectBanner.textContent = '⚡ Reconnecting…';
  document.body.appendChild(_reconnectBanner);
  setTimeout(() => _reconnectBanner?.classList.add('visible'), 10);
}

function hideReconnectBanner() {
  if (!_reconnectBanner) return;
  _reconnectBanner.classList.remove('visible');
  setTimeout(() => { _reconnectBanner?.remove(); _reconnectBanner = null; }, 300);
}

// In setupSocket():
socket.on("connect", () => {
  if (_wasConnected) {
    showToast("Reconnected!");
    hideReconnectBanner();
  }
  _wasConnected = true;

  if (localUser) {
    socket.emit("join-game", {
      instanceId,
      userId: localUser.id,
      username: localUser.username,
      avatarUrl: localUser.avatarUrl,
      spectate: wantsSpectate,
    });
  }
});

socket.on("disconnect", (reason) => {
  if (reason !== "io client disconnect") {
    showReconnectBanner();
  }
});

// Remove the `reconnect` listener entirely.
```

### CSS for reconnect banner
```css
.reconnect-banner {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: rgba(0,0,0,0.8);
  color: var(--text-muted);
  border-radius: var(--radius);
  padding: 8px 16px;
  font-size: 13px;
  z-index: 9999;
  opacity: 0;
  transition: opacity 0.2s, transform 0.2s;
}
.reconnect-banner.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
```
