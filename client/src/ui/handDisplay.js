import { HALF_SUIT_NAMES } from "../constants.js";

/**
 * Renders the current player's hand grouped by half-suit.
 * @param {HTMLElement} container
 * @param {string[]} hand - Array of card strings
 */
export function renderHand(container, hand) {
  if (!hand || hand.length === 0) {
    container.innerHTML = `<p class="no-cards">You have no cards remaining.</p>`;
    return;
  }

  // Group cards by half-suit
  const groups = groupByHalfSuit(hand);

  container.innerHTML = `
    <div class="hand-display">
      <h3 class="hand-title">Your Hand</h3>
      <div class="half-suits">
        ${Object.entries(groups).map(([hsId, cards]) => `
          <div class="half-suit-group" data-halfsuit="${hsId}">
            <span class="half-suit-label ${getSuitColorClass(hsId)}">${HALF_SUIT_NAMES[hsId]}</span>
            <div class="cards-row">
              ${cards.map(card => cardHtml(card)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Groups an array of card strings by their half-suit ID.
 */
export function groupByHalfSuit(cards) {
  const HALF_SUITS_ORDER = ['lowS', 'highS', 'lowH', 'highH', 'lowD', 'highD', 'lowC', 'highC'];
  const groups = {};

  for (const card of cards) {
    const hs = getHalfSuitId(card);
    if (hs) {
      if (!groups[hs]) groups[hs] = [];
      groups[hs].push(card);
    }
  }

  // Return in canonical order
  const ordered = {};
  for (const hs of HALF_SUITS_ORDER) {
    if (groups[hs]) ordered[hs] = groups[hs];
  }
  return ordered;
}

/**
 * Returns the half-suit ID for a card string (client-side, mirrors deck.js logic).
 */
export function getHalfSuitId(card) {
  const suit = card.slice(-1);
  const value = card.slice(0, -1);
  const lowValues = ['2', '3', '4', '5', '6', '7'];
  const highValues = ['9', '10', 'J', 'Q', 'K', 'A'];

  if (lowValues.includes(value)) return `low${suit}`;
  if (highValues.includes(value)) return `high${suit}`;
  return null;
}

function getSuitColorClass(hsId) {
  return (hsId.endsWith('H') || hsId.endsWith('D')) ? 'suit-red' : 'suit-black';
}

export function cardHtml(card, isSelected = false, isDisabled = false) {
  const suit = card.slice(-1);
  const value = card.slice(0, -1);
  const suitSymbol = { S: '♠', H: '♥', D: '♦', C: '♣' }[suit] ?? suit;
  const colorClass = (suit === 'H' || suit === 'D') ? 'card-red' : 'card-black';
  const selectedClass = isSelected ? 'card-selected' : '';
  const disabledClass = isDisabled ? 'card-disabled' : '';

  return `
    <div class="card ${colorClass} ${selectedClass} ${disabledClass}" data-card="${card}">
      <span class="card-value">${value}</span>
      <span class="card-suit">${suitSymbol}</span>
    </div>
  `;
}
