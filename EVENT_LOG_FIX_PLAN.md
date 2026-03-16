# Event Log Fix Plan

## Problem

The event log panel flashes open on every game event even when the user has not clicked the button. The desired behaviour is: panel starts closed, opens only when the user clicks **≡ Log**, and stays closed until they do so again.

---

## Root Cause Analysis

### RC-1 — Toggle button lives inside `container.innerHTML`

`renderGameBoard()` is called on every game-state update (every ask, every claim, every bot turn). It runs:

```js
container.innerHTML = `
  <div class="game-board">
    <div class="game-header">
      <button id="log-toggle">≡ Log …</button>   ← recreated every call
      …
    </div>
    …
  </div>
`;
```

Every call tears down and rebuilds the entire inner DOM. The button visually flickers. Each rebuild also calls `toggleBtn?.addEventListener('click', …)` — so N events → the button has N stacked listeners attached (though they're on a new element each time, so old ones are GC'd). More importantly: the button is never stable — it's a different element on every render.

---

### RC-2 — Spectator auto-reopen loop

Inside `renderGameBoard`, at the bottom:

```js
// Spectators default to log open
if (isSpectating && !logOpen) _openLog(toggleBtn);
```

Scenario:

1. Spectator joins → first render → `logOpen = false` → `_openLog()` → `logOpen = true` ✓  
2. User presses **✕** → `_closeLog()` → `logOpen = false`  
3. Next game event → re-render → `isSpectating && !logOpen` → **true** → `_openLog()` → panel pops open  
4. Repeat for every subsequent event

This is the most direct cause of "pops up on every event" for the Watch Bots Play path.

---

### RC-3 — Animation flash gap (display none → flex)

The current `_openLog()` sequence:

```js
_logPanel.classList.remove('log-panel-open');
_logPanel.style.display = 'flex';   // ← element rendered at translateX(0) right now
void _logPanel.offsetWidth;          // ← reflow committed — still at translateX(0)
_logPanel.classList.add('log-panel-open'); // ← animation scheduled for NEXT paint
```

Between the `display = 'flex'` line and the browser's next paint (when the keyframe's `from { translateX(-100%) }` is actually drawn), the panel is already visible at its natural position (`translateX(0)`). The user sees a flash of the fully-open panel before the slide-in animation begins. The `offsetWidth` reflow trick works for CSS *transitions* but not for *animations*, because it can't commit the first keyframe before a paint.

---

## Proposed Fix

Three targeted changes, no architectural rewrites.

---

### Fix 1 — Move the toggle button into the persistent overlay (RC-1)

**File:** `client/src/ui/gameBoard.js`

Add a `_toggleBtn` module-level variable alongside `_backdrop` and `_logPanel`. In `ensureLogOverlay()`, create the button and append it to `document.body` once, and attach its click listener once:

```js
let _toggleBtn = null;

function ensureLogOverlay() {
  if (_logPanel && document.body.contains(_logPanel)) return;

  _backdrop  = document.createElement('div');
  _backdrop.className = 'log-backdrop';

  _toggleBtn = document.createElement('button');
  _toggleBtn.className = 'log-toggle-btn log-toggle-persistent';
  _toggleBtn.innerHTML = '≡ Log';
  _toggleBtn.addEventListener('click', () => _openLog());

  _logPanel = document.createElement('div');
  _logPanel.className = 'log-panel';
  _logPanel.innerHTML = `…`; // unchanged

  document.body.appendChild(_backdrop);
  document.body.appendChild(_toggleBtn);
  document.body.appendChild(_logPanel);

  _backdrop.addEventListener('click', _closeLog);
  _logPanel.querySelector('#log-close-btn').addEventListener('click', _closeLog);
}
```

Remove `id="log-toggle"` from `container.innerHTML` (or replace it with a non-interactive placeholder).

Remove the per-render `toggleBtn?.addEventListener` block entirely.

Update `_openLog()` / `_closeLog()` to update `_toggleBtn` directly instead of accepting it as a parameter:

```js
function _openLog() {
  logOpen = true;
  unreadCount = 0;
  _logPanel.classList.add('log-panel-open');
  _backdrop.classList.add('log-backdrop-visible');
  _toggleBtn.innerHTML = '≡ Log';
}

function _closeLog() {
  logOpen = false;
  _logPanel.classList.remove('log-panel-open');
  _backdrop.classList.remove('log-backdrop-visible');
}
```

Update the unread badge by mutating `_toggleBtn.innerHTML` inside `renderGameBoard` after the unread-count calculation:

```js
if (_toggleBtn) {
  _toggleBtn.innerHTML = unreadCount > 0 && !logOpen
    ? `≡ Log<span class="unread-badge">${unreadCount}</span>`
    : '≡ Log';
}
```

---

### Fix 2 — Spectator auto-open fires only once (RC-2)

**File:** `client/src/ui/gameBoard.js`

Add a module-level flag:

```js
let _spectatorLogOpenedOnce = false;
```

Replace:

```js
// Spectators default to log open
if (isSpectating && !logOpen) _openLog(toggleBtn);
```

With:

```js
// Open log once when spectator first enters; never re-open after user closes it
if (isSpectating && !_spectatorLogOpenedOnce) {
  _spectatorLogOpenedOnce = true;
  _openLog();
}
```

Reset `_spectatorLogOpenedOnce = false` inside `_closeLog()` is **not** done — the flag stays `true` permanently so the log never re-opens itself. The user can still open it manually.

---

### Fix 3 — Replace display-toggle animation with visibility + transition (RC-3)

**File:** `client/style.css`

Switch from `display: none` + `@keyframes` to `visibility` + CSS `transition`. The element stays in the DOM at all times (never `display: none`), which means the transition cannot fire unexpectedly on DOM insertion. The transition only fires when the class is explicitly toggled.

Replace the current `.log-panel` / `.log-panel-open` / `@keyframes logSlideIn` block with:

```css
.log-panel {
  position: fixed;
  left: 0; top: 0;
  height: 100vh;
  width: 290px;
  max-width: 85vw;
  background: rgba(30, 31, 34, 0.78);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-right: 1px solid rgba(78,80,88,0.5);
  z-index: 100;
  display: flex;
  flex-direction: column;
  box-shadow: 4px 0 24px rgba(0,0,0,0.5);
  /* Hidden by default — off-screen and invisible */
  transform: translateX(-100%);
  visibility: hidden;
  pointer-events: none;
  transition: transform 0.25s cubic-bezier(0.4,0,0.2,1),
              visibility 0s linear 0.25s;  /* delay hides after slide-out finishes */
}
.log-panel-open {
  transform: translateX(0);
  visibility: visible;
  pointer-events: auto;
  transition: transform 0.25s cubic-bezier(0.4,0,0.2,1),
              visibility 0s linear 0s;  /* no delay — show immediately on open */
}
```

**File:** `client/src/ui/gameBoard.js`

Simplify `_openLog()` and `_closeLog()` — remove all `style.display` manipulation, which is no longer needed:

```js
function _openLog() {
  logOpen = true;
  unreadCount = 0;
  _logPanel.classList.add('log-panel-open');
  _backdrop.classList.add('log-backdrop-visible');
  if (_toggleBtn) _toggleBtn.innerHTML = '≡ Log';
}

function _closeLog() {
  logOpen = false;
  _logPanel.classList.remove('log-panel-open');
  _backdrop.classList.remove('log-backdrop-visible');
}
```

---

### Fix 4 — Position the persistent toggle button (style.css)

Since `_toggleBtn` is now on `document.body` (not inside `.game-header`), it needs its own positioning. Add a new class:

```css
.log-toggle-persistent {
  position: fixed;
  top: 8px;
  left: 10px;
  z-index: 98;  /* below panel (100) but above game content */
}
```

The existing `.log-toggle-btn` styles (border, color, font, hover) are reused — just add the positioning class name in JS.

---

## Files Changed

| File | Changes |
|---|---|
| `client/src/ui/gameBoard.js` | Add `_toggleBtn` + `_spectatorLogOpenedOnce` module vars; move button into `ensureLogOverlay`; simplify `_openLog`/`_closeLog`; add per-render badge update; remove per-render listener attach; fix spectator auto-open |
| `client/style.css` | Replace `display:none` + `@keyframes` with `visibility` + `transition`; add `.log-toggle-persistent` positioning |

---

## Why These Three Fixes Are Sufficient

| Old behaviour | After fix |
|---|---|
| Button recreated every render → flicker | Button is a persistent DOM element, touched only to update badge text |
| Spectator closes log → reopens on next event | `_spectatorLogOpenedOnce` flag prevents any re-open |
| `display:none → flex` flash gap before keyframe | Element always in DOM; `visibility` transition cannot fire at DOM insertion |
