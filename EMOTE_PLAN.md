# Emote System Plan

## Overview

Allow players to send emote reactions during gameplay. Emotes appear as animated overlays on the sender's camera tile, visible to all players and spectators in real time.

## Emotes

| ID | Name | Emoji | Notes |
|----|------|-------|-------|
| `middle-finger` | Middle Finger | 🖕 | |
| `wet` | Wet | 💦 | |
| `lip-bite` | Lip Bite | 😏 | Closest standard emoji to lip bite |
| `yacht-flip` | Yacht Flip | 🛥️🥞 | Special: yacht flipping pancakes — custom two-part animation |

## Client Changes

### 1. Emote Picker Button (gameBoard.js)

- Add a small emote button (e.g. 😀) to the bottom-right of the game board UI, near the player's own camera tile or in the action bar.
- Clicking it opens a compact emote picker tray (not a full modal — a small floating panel).
- The tray displays the 4 emote options as clickable buttons in a row.
- Clicking an emote sends it and closes the tray.
- Rate-limit on client side: disable the button for 3 seconds after sending.

### 2. Emote Display (cameraTile.js)

- When an emote event is received, render an animated overlay on top of the sender's camera tile.
- The overlay shows the emoji(s) with a pop-in + float-up animation.
- For `yacht-flip`: show the yacht emoji tilting/flipping with pancake emojis flying off it.
- Overlay auto-removes after ~2 seconds.

### 3. Socket Listener (socket.js / gameBoard.js)

- Register a listener for the `emote` event from the server.
- On receive: find the sender's camera tile by player ID and trigger the overlay animation.

### 4. Emit Event

- `socket.emit('send-emote', { instanceId, emoteId })`

## Server Changes

### 5. Handle `send-emote` (server.js)

- Listen for `send-emote` on each player socket.
- Validate:
  - Player is in an active game (`status === 'playing'`).
  - `emoteId` is one of the 4 valid IDs.
  - Rate-limit: max 1 emote per 3 seconds per player (server-enforced).
- Broadcast to all sockets in the game room (players + spectators):
  ```
  io.to(room).emit('emote', { playerId, emoteId })
  ```

### 6. Rate-Limit Tracking (gameManager.js or server.js)

- Store `lastEmoteTime` per player (in-memory Map, keyed by `odlayerId:instanceId`).
- Reject emotes sent within 3 seconds of the previous one (silently drop or send an error back to the sender only).

## CSS / Animation Changes

### 7. Emote Overlay Styles (style.css)

- `.emote-overlay` — absolutely positioned over the camera tile frame, centered.
- Animation keyframes:
  - `emotePopUp` — scale(0) → scale(1.3) → scale(1), then float upward with fade-out.
  - `yachtFlip` — rotate the yacht emoji 360° while pancakes scatter outward.
- `z-index` above tiles but below modals (e.g. `z-index: 50`).

### 8. Emote Picker Styles (style.css)

- `.emote-picker` — small floating panel, dark background, rounded, row of emoji buttons.
- Positioned above the emote trigger button.
- Subtle appear/disappear transition.

## File-by-File Summary

| File | Changes |
|------|---------|
| `server/server.js` | Add `send-emote` handler, validate, broadcast `emote` event |
| `client/src/ui/gameBoard.js` | Add emote picker button, register `emote` socket listener, trigger overlay |
| `client/src/ui/cameraTile.js` | Add `showEmote(playerId, emoteId)` function to render animated overlay on a tile |
| `client/src/socket.js` | (Optional) Register `emote` listener here if centralizing socket listeners |
| `client/style.css` | Add `.emote-overlay`, `.emote-picker`, keyframe animations |
| `client/src/constants.js` | Add `EMOTES` map (`id → { label, emoji }`) shared across UI code |

## Implementation Order

1. Add emote constants to `constants.js`
2. Add server-side `send-emote` handler with validation + rate-limit + broadcast
3. Add emote overlay rendering + animations in `cameraTile.js` and `style.css`
4. Add emote picker UI in `gameBoard.js` and `style.css`
5. Wire up socket listener in `gameBoard.js` to call overlay renderer
6. Test all 4 emotes, verify rate-limiting, verify spectator visibility
