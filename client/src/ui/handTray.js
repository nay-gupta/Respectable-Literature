import { groupByHalfSuit, cardHtml } from './handDisplay.js';
import { HALF_SUIT_NAMES } from '../constants.js';

/**
 * Renders the card fan hand tray.
 * Cards are grouped by half-suit with a slight arc / overlap fan.
 *
 * @param {HTMLElement} container
 * @param {string[]}    hand       - Array of card strings
 * @param {object}      opts
 * @param {string|null} opts.highlightHalfSuit - dim all other groups when set
 */
export function renderHandTray(container, hand, opts = {}) {
  const { highlightHalfSuit = null } = opts;

  if (!container) return;

  if (!hand || hand.length === 0) {
    container.innerHTML = `<div class="hand-tray"><p class="no-cards-tray">You have no cards remaining.</p></div>`;
    return;
  }

  const groups = groupByHalfSuit(hand);

  const groupsHtml = Object.entries(groups).map(([hsId, cards]) => {
    const suitColorClass = (hsId.endsWith('H') || hsId.endsWith('D')) ? 'suit-red' : 'suit-black';
    const isDimmed      = highlightHalfSuit !== null && hsId !== highlightHalfSuit;
    const isHighlighted = highlightHalfSuit !== null && hsId === highlightHalfSuit;
    const n = cards.length;

    const fanItemsHtml = cards.map((card, i) => {
      // offset from center of the group (-1.5 to +1.5 for n=4, etc.)
      const offset = i - (n - 1) / 2;
      return `<div class="card-fan-item" style="--offset:${offset.toFixed(2)};z-index:${i + 1}">
        ${cardHtml(card)}
      </div>`;
    }).join('');

    return `
      <div class="hand-group${isDimmed ? ' hand-group-dimmed' : ''}${isHighlighted ? ' hand-group-hl' : ''}"
           data-halfsuit="${hsId}">
        <div class="card-fan">${fanItemsHtml}</div>
        <div class="hand-group-label ${suitColorClass}">${HALF_SUIT_NAMES[hsId]}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="hand-tray">
      <div class="hand-groups">${groupsHtml}</div>
    </div>
  `;
}
