# Literature — Game UI Redesign Plan

## Overview

Replace the current utilitarian layout with an immersive top-down card table. Players sit around a felt table, cameras float at each seat, cards animate between hands, and the log slides in/out from the side.

---

## 1. Layout: The Table

### Structure

**6 players** — 3 top, 3 bottom, alternating A B around the table:

```
         [A]      [B]      [A]

         ╔═══════════════════╗
         ║    felt table     ║
         ╚═══════════════════╝

         [B]    [YOU·A]    [B]
```

**8 players** — 3 top, 1 each side, 3 bottom, alternating A B around the table:

```
         [B]      [A]      [B]

  [A]   ╔═══════════════════╗   [A]
         ║    felt table     ║
         ╚═══════════════════╝

         [B]    [YOU·A]    [B]
```

In both layouts the local player is anchored at bottom-center. Going clockwise the seats strictly alternate A → B → A → B, satisfying the Literature seating rule. The two side seats in the 8-player layout end up both being Team A because the parity works out that way.

### Table Visual
- A rounded rectangle with a **dark green felt texture** (CSS radial gradient or SVG pattern).
- Subtle inner shadow and a thin wood-grain border ring (CSS `box-shadow` + `border`).
- **Claimed half-suit tokens** appear in the center of the table as small card-fan icons, colored by the team that claimed them. They stack/fade in as claims are made.
- The table scales with the viewport; seats reposition automatically for 6 vs 8 players.

### Seat Positions
Players are arranged around the table using absolute/CSS grid positioning. Seats are computed as evenly-spaced points on an ellipse:

```js
// pseudo-code
const angle = (seatIndex / totalPlayers) * 2 * Math.PI - Math.PI / 2;
const x = cx + rx * Math.cos(angle);
const y = cy + ry * Math.sin(angle);
```

The local player is always anchored to the **bottom-center** seat; others rotate around them.

---

## 2. Player Cameras

Each seat renders a **camera tile** — a small rounded rectangle showing:
- Avatar image (Discord CDN) or initials placeholder, slightly zoomed/cropped like a webcam feed.
- Player name underneath.
- Card count badge (bottom-right corner of tile).
- **Team color ring** around the tile border (blurple / red).
- **Gold pulsing ring** when it's that player's turn.
- A 🤖 overlay badge for bots.
- Greyed out + strikethrough card count when a player has 0 cards.

### Turn Pulse Animation
```css
@keyframes turnPulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--gold); }
  50%       { box-shadow: 0 0 0 6px rgba(250,166,26,0.3); }
}
.camera-tile.current-turn { animation: turnPulse 1.4s ease-in-out infinite; }
```

### Reaction Emotes (future)
Small floating emoji (👍 😮 🎉) could pop from a camera tile when triggered — easy to add later as a Socket.io broadcast.

---

## 3. Card Transfer Animation

When an ask succeeds, a card visually flies from the target's camera to the asker's camera.

### Implementation
1. On `ask-result` (success), capture the **source position** (target camera tile) and **destination position** (asker camera tile) using `getBoundingClientRect()`.
2. Create a temporary `.flying-card` element, absolutely positioned over the source.
3. Use a CSS transition (or Web Animations API `element.animate()`) to translate it to the destination.
4. Remove the element on `transitionend`, then trigger the normal state re-render.

```js
async function animateCardTransfer(fromEl, toEl, card) {
  const from = fromEl.getBoundingClientRect();
  const to   = toEl.getBoundingClientRect();

  const el = document.createElement('div');
  el.className = 'flying-card card ' + (isRed(card) ? 'card-red' : 'card-black');
  el.textContent = formatCard(card);
  el.style.cssText = `
    position: fixed; left: ${from.x}px; top: ${from.y}px;
    transition: transform 0.5s cubic-bezier(0.25,0.8,0.25,1), opacity 0.5s;
    z-index: 9999;
  `;
  document.body.appendChild(el);

  // Force reflow, then animate
  requestAnimationFrame(() => {
    el.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px)`;
  });

  await new Promise(r => el.addEventListener('transitionend', r, { once: true }));
  el.remove();
}
```

### Failed Ask Animation
When an ask fails, the card shakes at the target's tile (`@keyframes shake`) and a small ✗ badge flashes over it.

---

## 4. Hand Tray

The local player's hand sits in a **fixed bottom tray** that stays docked to the viewport bottom.

### Fan Layout
Cards fan out in a slight arc, overlapping, like a real hand:
```css
.card-fan .card:nth-child(n) {
  transform: rotate(calc((var(--i) - var(--mid)) * 4deg))
             translateY(calc(abs(var(--i) - var(--mid)) * 3px));
}
.card-fan .card:hover {
  transform: rotate(...) translateY(-14px) scale(1.08);
  z-index: 10;
}
```
Each card's `--i` CSS variable is set inline from JS.

### Half-suit Grouping
Cards are grouped into labeled clusters with a small gap between groups. The tray scrolls horizontally if the hand is large.

### Ask Highlighting
When the Ask modal is open and the player picks a half-suit, the corresponding cards in the tray **glow** and non-matching cards dim.

---

## 5. Hideable Log

The event log becomes a **slide-in side panel** rather than a fixed section of the layout.

### Behavior
- A **≡ Log** toggle button sits in the top-left header strip.
- Clicking it slides the log panel in from the left (CSS `transform: translateX`).
- A semi-transparent backdrop dims the table behind it (but doesn't block interaction).
- The panel is ~280 px wide, full viewport height.
- The log retains scroll position when hidden/shown.

### Unread Badge
While the log is hidden, an unread-count badge increments on the toggle button so the player knows they've missed events.

```
[≡ Log  +3]
```

---

## 6. Claim & Ask Modals — Redesigned

### Ask Flow
Instead of separate step screens inside a modal, use a **three-panel inline overlay** anchored near the table center:
1. Opponent ring highlights — click a camera tile directly to select the target (no separate step).
2. Half-suit selector pops up as a radial/grid of pill buttons.
3. Card grid appears; click a card to fire the ask.

### Claim Flow
The claim modal stays as a step modal but gains a **visual card layout** — each of the 6 cards in the half-suit is displayed as an actual card graphic, with a dropdown below it to assign the holder.

---

## 7. Scored Half-suits on the Table

As half-suits are claimed, small **book icons / card fans** materialize in the center of the table:
- Team A claims stack on the left half; Team B on the right.
- Each token shows the half-suit name (e.g. "Low ♠") and team color.
- They animate in with a `scale(0) → scale(1)` pop.
- Hovering a token shows a tooltip with who claimed it and the outcome.

---

## 8. Results Screen

The results screen gets a **confetti burst** (CSS-only or canvas) for the winning team and a "scoreboard" table:

```
🏆 Team A Wins!  5 – 3

Half-Suit      Winner    Claimed by
─────────────────────────────────────
Low ♠          Team A 🔵  Alice
High ♠         Team A 🔵  Bob
Low ♥          Team B 🔴  Dave
...
```

Note the **cancelled** outcome (`wrong_location` claims): these sets should appear in the table with a ✕ and a muted "–" in the Winner column, making it clear they were removed from play without awarding points.

### Early Clinch Banner

When one team clinches a majority *before* all 8 sets are resolved (possible because cancelled sets shrink the remaining pool), a brief **in-game toast banner** should appear:

```
🏆 Team A has clinched — they can't be caught!
```

The game then ends immediately and transitions to the results screen.

---

## 9. Responsive / Discord Iframe Sizes

Discord Activities run in iframes that vary by platform:
| Platform | Approx. size |
|---|---|
| Desktop (large) | ~1200 × 720 px |
| Desktop (small) | ~460 × 720 px |
| Mobile | ~390 × 750 px |

The table layout should:
- Collapse to a **single-column list view** on very narrow widths (< 420 px) — cameras in a horizontal scroll strip at top, hand tray below.
- Use `clamp()` and `vmin` units for camera tile and table sizing.

---

## 10. Implementation Phases

| Phase | Work | New files / changes |
|---|---|---|
| **A** | Table shell + seat positioning | `ui/table.js`, `ui/seat.js`, CSS rewrite |
| **B** | Camera tiles + team rings + turn pulse | `ui/cameraTile.js`, CSS |
| **C** | Hand tray with card fan | `ui/handTray.js`, replaces `handDisplay.js` |
| **D** | Card transfer animation | `ui/cardAnimation.js` |
| **E** | Hideable log panel + unread badge | update `ui/eventLog.js`, CSS |
| **F** | Claimed books in table center | `ui/tableCenter.js` |
| **G** | Ask/Claim modal polish | update `ui/askModal.js`, `ui/claimModal.js` |
| **H** | Results confetti + scoreboard table (incl. cancelled sets + early clinch) | update `ui/resultsScreen.js` |
| **I** | Responsive / mobile layout | CSS media queries |
| **J** | Spectator UI polish | update `ui/gameBoard.js`, `ui/lobby.js`, CSS |

Each phase can be shipped independently without breaking the existing functional UI.

---

## 11. Spectator Mode

Spectator mode is already fully implemented at the socket/state layer. This section describes the **UI polish** needed to make it feel intentional rather than just functional.

### Lobby — Spectator Controls

Three entry points exist in the lobby:

| User type | Available buttons |
|---|---|
| Host (registered player) | Shuffle Teams · Add Bot · Start Game · **👁 Watch Bots Play** |
| Registered non-host player | Waiting… · **👁 Watch Bots Play** |
| Unregistered visitor | 👁 Watch as Spectator · **👁 Watch Bots Play** |

**Watch Bots Play** — removes the requesting user from the player list (if present), fills all slots with bots (up to 6), starts the game immediately, and switches the user to spectator view. Useful for solo testing, demos, or just watching the AI.

**Spectators section** — a compact strip below the team columns showing avatar chips for everyone currently watching. Updates in real time as spectators join/leave.

### In-Game — Spectator View

The spectator game board is identical to the player view except:

- **Hand tray is hidden** — spectators have no hand.
- **Action bar is replaced** by a `spectator-banner` strip at the bottom:
  ```
  👁 You are spectating — sit back and enjoy!
  ```
- **All camera tiles visible** — spectators see card *counts* for all players the same way any player does (no extra information; hands are stripped server-side).
- **Log panel** (Phase E) should default to **open** for spectators, since they have nothing else to interact with.
- The turn-pulse animation (Phase B) still highlights whose turn it is.

### Spectator Table Layout

For the table redesign (Phases A–B), spectators see the same elliptical seat layout as players. Since there is no local player to anchor at bottom-center, seat index 0 is anchored there instead. The `YOU` label is omitted.

```js
// In seat.js: if spectating, no seat is marked .is-you;
// anchor player[0] at the bottom-center position.
const anchorId = isSpectating ? players[0].id : localUserId;
```

### Spectator Count Chip

Once the player-list bar is redesigned into camera tiles (Phase B), a small **👁 N watching** chip should appear in the top-right corner of the table area whenever `state.spectators.length > 0`.

```html
<div class="spectator-count-chip">
  👁 <span id="spec-count">3</span> watching
</div>
```

```css
.spectator-count-chip {
  position: absolute;
  top: 8px; right: 10px;
  background: rgba(0,0,0,0.45);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-muted);
  pointer-events: none;
}
```
