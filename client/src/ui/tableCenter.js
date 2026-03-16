import { HALF_SUIT_NAMES } from '../constants.js';

/**
 * Incrementally updates claimed-half-suit tokens in the table center.
 * Only newly claimed tokens are inserted (with pop animation); existing
 * tokens are never removed, preventing re-animation on every state update.
 *
 * @param {HTMLElement} container
 * @param {Array}       claimedHalfSuits  - from game state
 */
export function renderTableCenter(container, claimedHalfSuits = []) {
  if (!container) return;

  if (claimedHalfSuits.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Ensure row elements exist
  let rowA         = container.querySelector('.table-tokens-a');
  let rowCancelled = container.querySelector('.table-tokens-cancelled');
  let rowB         = container.querySelector('.table-tokens-b');

  if (!rowA) {
    rowA = document.createElement('div');
    rowA.className = 'table-tokens-row table-tokens-a';
    container.appendChild(rowA);
  }
  if (!rowB) {
    rowB = document.createElement('div');
    rowB.className = 'table-tokens-row table-tokens-b';
    container.appendChild(rowB);
  }

  // Build a set of half-suits already in the DOM
  const existing = new Set(
    [...container.querySelectorAll('.claimed-token')].map(el => el.dataset.halfSuit)
  );

  for (const c of claimedHalfSuits) {
    if (existing.has(c.halfSuit)) continue; // already rendered — skip

    const cls   = c.teamIndex === 0 ? 'token-team-a'
                : c.teamIndex === 1 ? 'token-team-b'
                : 'token-cancelled';
    const label = HALF_SUIT_NAMES[c.halfSuit] ?? c.halfSuit;
    const icon  = c.teamIndex === 0 ? '🔵' : c.teamIndex === 1 ? '🔴' : '✕';
    const outcomeTitle = c.outcome === 'wrong_location' ? ' (cancelled)' : '';

    const el = document.createElement('div');
    el.className = `claimed-token ${cls}`;
    el.dataset.halfSuit = c.halfSuit;
    el.title = `${label}${outcomeTitle}`;
    el.textContent = `${icon} ${label}`;

    if (c.teamIndex === null) {
      // Lazy-create cancelled row if needed
      if (!rowCancelled) {
        rowCancelled = document.createElement('div');
        rowCancelled.className = 'table-tokens-row table-tokens-cancelled';
        // Insert between rowA and rowB
        container.insertBefore(rowCancelled, rowB);
      }
      rowCancelled.appendChild(el);
    } else if (c.teamIndex === 0) {
      rowA.appendChild(el);
    } else {
      rowB.appendChild(el);
    }
  }
}
