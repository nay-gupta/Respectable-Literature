export const SUITS = ['S', 'H', 'D', 'C'];
export const VALUES = ['2', '3', '4', '5', '6', '7', '9', '10', 'J', 'Q', 'K', 'A'];

export const HALF_SUITS = {
  lowS:  ['2S', '3S', '4S', '5S', '6S', '7S'],
  highS: ['9S', '10S', 'JS', 'QS', 'KS', 'AS'],
  lowH:  ['2H', '3H', '4H', '5H', '6H', '7H'],
  highH: ['9H', '10H', 'JH', 'QH', 'KH', 'AH'],
  lowD:  ['2D', '3D', '4D', '5D', '6D', '7D'],
  highD: ['9D', '10D', 'JD', 'QD', 'KD', 'AD'],
  lowC:  ['2C', '3C', '4C', '5C', '6C', '7C'],
  highC: ['9C', '10C', 'JC', 'QC', 'KC', 'AC'],
};

export const HALF_SUIT_NAMES = {
  lowS:  'Low ♠',
  highS: 'High ♠',
  lowH:  'Low ♥',
  highH: 'High ♥',
  lowD:  'Low ♦',
  highD: 'High ♦',
  lowC:  'Low ♣',
  highC: 'High ♣',
};

// Build a reverse lookup: card → halfSuitId
const cardToHalfSuit = {};
for (const [id, cards] of Object.entries(HALF_SUITS)) {
  for (const card of cards) {
    cardToHalfSuit[card] = id;
  }
}

/**
 * Returns the half-suit ID for a given card string, e.g. "QH" → "highH"
 */
export function getHalfSuit(card) {
  return cardToHalfSuit[card] ?? null;
}

/**
 * Returns a shuffled 48-card deck (standard 52-card deck minus all 8s).
 */
export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push(`${value}${suit}`);
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Deals cards evenly among playerCount players.
 * 6 players → 8 cards each; 8 players → 6 cards each.
 * Returns an array of playerCount hands (arrays of card strings).
 */
export function dealCards(playerCount) {
  const deck = createDeck();
  const hands = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < deck.length; i++) {
    hands[i % playerCount].push(deck[i]);
  }
  return hands;
}
