/**
 * Animates a card flying from one player's tile to another on a successful ask.
 *
 * @param {string} fromPlayerId - player who lost the card
 * @param {string} toPlayerId   - player who gained the card
 * @param {string} card         - e.g. "10H"
 */
export async function animateCardTransfer(fromPlayerId, toPlayerId, card) {
  const fromEl = document.querySelector(`[data-player-id="${fromPlayerId}"] .tile-frame`);
  const toEl   = document.querySelector(`[data-player-id="${toPlayerId}"] .tile-frame`);
  if (!fromEl || !toEl) return;

  const from = fromEl.getBoundingClientRect();
  const to   = toEl.getBoundingClientRect();

  const suit       = card.slice(-1);
  const value      = card.slice(0, -1);
  const suitSymbol = { S: '♠', H: '♥', D: '♦', C: '♣' }[suit] ?? suit;
  const colorClass = (suit === 'H' || suit === 'D') ? 'card-red' : 'card-black';

  const el = document.createElement('div');
  el.className = `flying-card card ${colorClass}`;
  el.innerHTML = `<span class="card-value">${value}</span><span class="card-suit">${suitSymbol}</span>`;

  // Start position: center of source tile
  const startX = from.left + from.width  / 2 - 18;
  const startY = from.top  + from.height / 2 - 24;

  el.style.cssText = `
    position: fixed;
    left: ${startX}px;
    top:  ${startY}px;
    z-index: 9999;
    pointer-events: none;
    transition: transform 0.9s cubic-bezier(0.25,0.8,0.25,1), opacity 0.2s;
    will-change: transform;
  `;
  document.body.appendChild(el);

  // Two RAF ticks to ensure paint before transition fires
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const endX = to.left + to.width  / 2 - 18;
  const endY = to.top  + to.height / 2 - 24;
  el.style.transform = `translate(${endX - startX}px, ${endY - startY}px) scale(0.75)`;

  await new Promise(r => {
    el.addEventListener('transitionend', r, { once: true });
    setTimeout(r, 1200); // safety fallback
  });

  el.style.opacity = '0';
  setTimeout(() => el.remove(), 250);
}

/**
 * Shakes a player's camera tile to indicate a failed ask.
 *
 * @param {string} playerId
 */
export function animateCardShake(playerId) {
  const el = document.querySelector(`[data-player-id="${playerId}"]`);
  if (!el) return;
  el.classList.add('tile-shake');
  el.addEventListener('animationend', () => el.classList.remove('tile-shake'), { once: true });
}
