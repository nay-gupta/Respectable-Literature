import socket from "../socket.js";
import { renderHandTray }    from "./handTray.js";
import { renderEventLog }    from "./eventLog.js";
import { cameraTileHtml }    from "./cameraTile.js";
import { renderTableCenter } from "./tableCenter.js";
import { animateCardTransfer, animateCardShake } from "./cardAnimation.js";
import { openAskModal }   from "./askModal.js";
import { openClaimModal } from "./claimModal.js";

// ─── Module-level state (survives re-renders) ──────────────────────────────

let logOpen        = false;
let unreadCount    = 0;
let lastLogLength  = 0;
let _animHandlersRegistered = false;

// The log panel, backdrop, and toggle button live on document.body so they
// are NEVER destroyed by container.innerHTML re-renders. Created once, reused forever.
let _backdrop  = null;
let _logPanel  = null;
let _toggleBtn = null;
let _spectatorLogOpenedOnce = false;

function ensureLogOverlay() {
  if (_logPanel && document.body.contains(_logPanel)) return;

  _backdrop = document.createElement('div');
  _backdrop.className = 'log-backdrop';

  _toggleBtn = document.createElement('button');
  _toggleBtn.className = 'log-toggle-btn';
  _toggleBtn.innerHTML = '\u2261 Log';
  _toggleBtn.addEventListener('click', _openLog);

  _logPanel = document.createElement('div');
  _logPanel.className = 'log-panel';
  _logPanel.innerHTML = `
    <div class="log-panel-header">
      <span class="log-panel-title">Event Log</span>
      <button class="log-close-btn" id="log-close-btn">\u2715</button>
    </div>
    <div class="log-panel-content" id="log-panel-content"></div>
  `;

  document.body.appendChild(_backdrop);
  document.body.appendChild(_logPanel);

  _backdrop.addEventListener('click', _closeLog);
  _logPanel.querySelector('#log-close-btn').addEventListener('click', _closeLog);
}

function _openLog() {
  logOpen = true;
  unreadCount = 0;
  _logPanel.classList.add('log-panel-open');
  _backdrop.classList.add('log-backdrop-visible');
  if (_toggleBtn) _toggleBtn.innerHTML = '\u2261 Log';
}

function _closeLog() {
  logOpen = false;
  _logPanel.classList.remove('log-panel-open');
  _backdrop.classList.remove('log-backdrop-visible');
}

function registerAnimHandlers() {
  if (_animHandlersRegistered) return;
  _animHandlersRegistered = true;
  socket.on('ask-result', ({ success, askerId, targetId, card }) => {
    if (success) animateCardTransfer(targetId, askerId, card);
    else         animateCardShake(targetId);
  });
}

// ─── Seat geometry ─────────────────────────────────────────────────────────

function computeSeatPositions(N) {
  const CX = 50, CY = 50, RX = 37, RY = 32;
  return Array.from({ length: N }, (_, i) => {
    const angle = Math.PI / 2 - (2 * Math.PI * i / N);
    return {
      x: CX + RX * Math.cos(angle),
      y: CY + RY * Math.sin(angle),
    };
  });
}

// ─── Main render ───────────────────────────────────────────────────────────

export function renderGameBoard(container, state, localUserId) {
  registerAnimHandlers();
  ensureLogOverlay();

  const {
    players = [], currentTurnPlayerId,
    isSpectating = false, spectators = [],
    scores = [0, 0], claimedHalfSuits = [],
    eventLog = [], hostUserId = null,
  } = state;

  const localPlayer = players.find(p => p.id === localUserId);
  const isMyTurn    = currentTurnPlayerId === localUserId;
  const isHost      = hostUserId ? hostUserId === localUserId : false;
  const hand        = localPlayer?.hand ?? [];

  // ── Unread tracking ────────────────────────────────────────────────────
  const newLogLen = eventLog.length;
  if (!logOpen && newLogLen > lastLogLength) unreadCount += newLogLen - lastLogLength;
  lastLogLength = newLogLen;

  // Update the persistent toggle button badge
  if (_toggleBtn) {
    _toggleBtn.innerHTML = unreadCount > 0 && !logOpen
      ? `\u2261 Log<span class="unread-badge">${unreadCount}</span>`
      : '\u2261 Log';
  }

  // ── Seat order ─────────────────────────────────────────────────────────
  const anchorIdx      = isSpectating ? 0 : Math.max(0, players.findIndex(p => p.id === localUserId));
  const orderedPlayers = [...players.slice(anchorIdx), ...players.slice(0, anchorIdx)];
  const seatPositions  = computeSeatPositions(orderedPlayers.length);

  // ── Turn label ─────────────────────────────────────────────────────────
  const currentTurnPlayer = players.find(p => p.id === currentTurnPlayerId);
  const turnLabel = currentTurnPlayer
    ? (isMyTurn
        ? `<span class="turn-label-you">\u2b50 Your turn!</span>`
        : `<span class="turn-label">${currentTurnPlayer.username}'s turn</span>`)
    : '';

  // ── DOM (no log panel here — it lives on body) ─────────────────────────
  container.innerHTML = `
    <div class="game-board${isSpectating ? ' spectator-mode' : ''}">

      <div class="game-header">
        <div class="header-left">
          <div class="header-scores">
            <span class="score-chip score-chip-a">${scores[0]}</span>
            <span class="score-sep">\u2013</span>
            <span class="score-chip score-chip-b">${scores[1]}</span>
          </div>
        </div>
        <div class="header-turn">${turnLabel}</div>
        <div class="header-right">
          ${spectators.length > 0 ? `<div class="spectator-count-chip">\ud83d\udc41 ${spectators.length}</div>` : ''}
        </div>
      </div>

      <div class="table-wrapper">
        <div class="felt-table">
          <div class="table-center-tokens" id="table-center"></div>
        </div>
        ${orderedPlayers.map((player, i) => {
          const pos           = seatPositions[i];
          const isCurrentTurn = player.id === currentTurnPlayerId;
          const isYou         = !isSpectating && player.id === localUserId;
          const isOpponent    = localPlayer && player.teamIndex !== localPlayer.teamIndex;
          const isAskTarget   = isMyTurn && isOpponent && hand.length > 0 && !isSpectating && player.cardCount > 0;
          return `
            <div class="seat${isAskTarget ? ' seat-askable' : ''}"
                 style="left:${pos.x.toFixed(1)}%;top:${pos.y.toFixed(1)}%"
                 data-player-id="${player.id}"
                 ${isAskTarget ? 'data-ask-target="1"' : ''}>
              ${cameraTileHtml(player, { isCurrentTurn, isYou })}
            </div>`;
        }).join('')}
      </div>

      ${!isSpectating ? `
        <div class="hand-tray-area" id="hand-tray-area"></div>
        <div class="action-bar">
          <button id="ask-btn"
                  class="btn btn-primary${isMyTurn && hand.length > 0 ? '' : ' disabled'}"
                  ${isMyTurn && hand.length > 0 ? '' : 'disabled'}>
            \ud83d\ude4b Ask
          </button>
          <button id="claim-btn"
                  class="btn btn-secondary${isMyTurn ? '' : ' disabled'}"
                  ${isMyTurn ? '' : 'disabled'}>
            \ud83c\udccf Claim
          </button>
          ${isHost ? `<button id="end-game-btn" class="btn btn-ghost end-game-btn">⏹ End Game</button>` : ''}
        </div>
      ` : `
        <div class="spectator-banner">\ud83d\udc41 You are spectating \u2014 sit back and enjoy!</div>
      `}
    </div>
  `;

  // ── Sub-components ─────────────────────────────────────────────────────
  // Re-insert the persistent toggle button as the first item in header-left.
  // Moving an existing DOM node preserves its event listeners.
  const headerLeft = container.querySelector('.header-left');
  if (headerLeft && _toggleBtn) headerLeft.insertBefore(_toggleBtn, headerLeft.firstChild);

  renderTableCenter(container.querySelector('#table-center'), claimedHalfSuits);
  if (!isSpectating) renderHandTray(container.querySelector('#hand-tray-area'), hand);

  // Update the persistent log panel content (the panel element itself is untouched)
  renderEventLog(_logPanel.querySelector('#log-panel-content'), state, localUserId);

  // ── Camera-tile ask ────────────────────────────────────────────────────
  container.querySelectorAll('[data-ask-target="1"]').forEach(seatEl => {
    seatEl.addEventListener('click', () => {
      const target = players.find(p => p.id === seatEl.dataset.playerId);
      if (target) openAskModal(state, localUserId, target);
    });
  });

  // ── Action bar ─────────────────────────────────────────────────────────
  container.querySelector('#ask-btn')?.addEventListener('click', () => {
    if (isMyTurn && hand.length > 0) openAskModal(state, localUserId);
  });
  container.querySelector('#claim-btn')?.addEventListener('click', () => {
    if (isMyTurn) openClaimModal(state, localUserId);
  });
  container.querySelector('#end-game-btn')?.addEventListener('click', () => {
    socket.emit('end-game', { instanceId: state.instanceId });
  });
}
