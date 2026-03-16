import { HALF_SUIT_NAMES } from '../constants.js';

/**
 * Renders claimed-half-suit tokens into the table center element.
 * Each token pops in with a scale animation.
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

  // Split: Team A on left half, Team B on right half, cancelled in middle
  const teamA      = claimedHalfSuits.filter(c => c.teamIndex === 0);
  const teamB      = claimedHalfSuits.filter(c => c.teamIndex === 1);
  const cancelled  = claimedHalfSuits.filter(c => c.teamIndex === null);

  const tokenHtml = (c) => {
    const cls   = c.teamIndex === 0 ? 'token-team-a'
                : c.teamIndex === 1 ? 'token-team-b'
                : 'token-cancelled';
    const label = HALF_SUIT_NAMES[c.halfSuit] ?? c.halfSuit;
    const icon  = c.teamIndex === 0 ? '🔵' : c.teamIndex === 1 ? '🔴' : '✕';
    const outcomeTitle = c.outcome === 'wrong_location' ? ' (cancelled)' : '';
    return `<div class="claimed-token ${cls}" title="${label}${outcomeTitle}">${icon} ${label}</div>`;
  };

  container.innerHTML = `
    <div class="table-tokens-row table-tokens-a">${teamA.map(tokenHtml).join('')}</div>
    ${cancelled.length > 0 ? `<div class="table-tokens-row table-tokens-cancelled">${cancelled.map(tokenHtml).join('')}</div>` : ''}
    <div class="table-tokens-row table-tokens-b">${teamB.map(tokenHtml).join('')}</div>
  `;
}
