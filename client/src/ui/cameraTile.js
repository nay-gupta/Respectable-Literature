import { EMOTES } from '../constants.js';

/**
 * Returns the HTML string for a single camera tile.
 *
 * @param {object} player
 * @param {object} opts
 * @param {boolean} opts.isCurrentTurn
 * @param {boolean} opts.isYou
 */
export function cameraTileHtml(player, opts = {}) {
  const { isCurrentTurn = false, isYou = false } = opts;

  const teamClass = player.teamIndex === 0 ? 'tile-team-a'
                  : player.teamIndex === 1 ? 'tile-team-b'
                  : '';
  const turnClass   = isCurrentTurn ? 'tile-current-turn' : '';
  const emptyClass  = player.cardCount === 0 ? 'tile-empty' : '';
  const youClass    = isYou ? 'tile-is-you' : '';

  let avatarHtml;
  if (player.isBot) {
    avatarHtml = `<div class="tile-avatar tile-avatar-placeholder">🤖</div>`;
  } else if (player.avatarUrl) {
    avatarHtml = `<img src="${player.avatarUrl}" class="tile-avatar" alt="${player.username}" loading="lazy" />`;
  } else {
    const initial = (player.username?.[0] ?? '?').toUpperCase();
    avatarHtml = `<div class="tile-avatar tile-avatar-placeholder">${initial}</div>`;
  }

  const cardCountHtml = player.cardCount === 0
    ? `<div class="tile-card-count tile-card-empty">✕</div>`
    : `<div class="tile-card-count">${player.cardCount}</div>`;

  const youTag = isYou ? `<span class="tile-you-tag">YOU</span>` : '';

  return `
    <div class="camera-tile ${teamClass} ${turnClass} ${emptyClass} ${youClass}"
         data-player-id="${player.id}">
      <div class="tile-frame">
        ${avatarHtml}
        ${cardCountHtml}
        ${player.isBot ? '<div class="tile-bot-badge">BOT</div>' : ''}
      </div>
      <div class="tile-name">${player.username}${youTag}</div>
    </div>
  `;
}

/**
 * Shows an animated emote overlay on the camera tile for a given player.
 * @param {string} playerId
 * @param {string} emoteId
 */
export function showEmote(playerId, emoteId) {
  const emote = EMOTES[emoteId];
  if (!emote) return;

  const tile = document.querySelector(`.camera-tile[data-player-id="${playerId}"] .tile-frame`);
  if (!tile) return;

  const overlay = document.createElement('div');
  overlay.className = emoteId === 'yacht-flip' ? 'emote-overlay emote-yacht-flip' : 'emote-overlay';
  overlay.textContent = emote.emoji;
  tile.appendChild(overlay);

  overlay.addEventListener('animationend', () => overlay.remove());
  // Fallback removal
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 2500);
}
