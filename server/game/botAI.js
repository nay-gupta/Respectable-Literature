import { HALF_SUITS, getHalfSuit } from './deck.js';

const BOT_NAMES = ['Hemingway', 'Austen', 'Tolkien', 'Woolf', 'Twain', 'Dickens', 'Orwell', 'Fitzgerald'];

/**
 * Returns the next available bot name given the current bots in the game.
 */
export function getNextBotName(existingBots) {
  const usedNames = existingBots.map(p => p.username.replace('Bot ', ''));
  const available = BOT_NAMES.filter(n => !usedNames.includes(n));
  return available.length > 0 ? `Bot ${available[0]}` : `Bot ${existingBots.length + 1}`;
}

/**
 * Determines the best move for a bot.
 * Returns { type: 'ask', targetId, card } or { type: 'claim', halfSuit, cardMap }, or null.
 *
 * Easy strategy:
 *  1. Claim if the bot's team holds all 6 cards of any unclaimed half-suit.
 *  2. Otherwise randomly ask a valid opponent for a card in a half-suit the bot holds.
 *
 * Hard strategy:
 *  Same claim logic, but when asking it prefers cards in half-suits where the team already
 *  holds 4 or 5 of 6 (close to completing), and targets the opponent most likely to have
 *  the card (picks the opponent with the most cards first).
 */
export function getBotMove(gameState, botId) {
  const bot = gameState.players.find(p => p.id === botId);
  if (!bot) return null;

  const difficulty = gameState.settings?.botDifficulty ?? 'easy';

  const claimMove = tryClaimMove(gameState, bot);
  if (claimMove) return claimMove;

  if (bot.hand.length === 0) return null;

  return difficulty === 'hard'
    ? tryAskMoveHard(gameState, bot)
    : tryAskMove(gameState, bot);
}

function tryClaimMove(gameState, bot) {
  const teamPlayers = gameState.players.filter(p =>
    gameState.teams[bot.teamIndex].includes(p.id)
  );
  const teamCards = teamPlayers.flatMap(p => p.hand);

  for (const [hsId, cards] of Object.entries(HALF_SUITS)) {
    if (gameState.claimedHalfSuits.some(c => c.halfSuit === hsId)) continue;

    if (cards.every(c => teamCards.includes(c))) {
      const cardMap = {};
      for (const card of cards) {
        const holder = teamPlayers.find(p => p.hand.includes(card));
        if (holder) cardMap[card] = holder.id;
      }
      return { type: 'claim', halfSuit: hsId, cardMap };
    }
  }
  return null;
}

function tryAskMove(gameState, bot) {
  const opponents = gameState.players.filter(p =>
    p.teamIndex !== bot.teamIndex && p.cardCount > 0
  );
  if (opponents.length === 0) return null;

  // Build all valid (card, target) pairs the bot can ask for
  const candidates = [];
  const heldHalfSuits = [...new Set(bot.hand.map(c => getHalfSuit(c)).filter(Boolean))];

  for (const hs of heldHalfSuits) {
    const allCards = HALF_SUITS[hs];
    const botCardsInHS = bot.hand.filter(c => getHalfSuit(c) === hs);
    const askable = allCards.filter(c => !botCardsInHS.includes(c));
    for (const card of askable) {
      for (const target of opponents) {
        candidates.push({ type: 'ask', targetId: target.id, card });
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function tryAskMoveHard(gameState, bot) {
  const opponents = gameState.players.filter(p =>
    p.teamIndex !== bot.teamIndex && p.cardCount > 0
  );
  if (opponents.length === 0) return null;

  // Sort opponents descending by card count — pick the one most likely to have what we want
  const sortedOpponents = [...opponents].sort((a, b) => b.cardCount - a.cardCount);

  const teamPlayers = gameState.players.filter(p =>
    gameState.teams[bot.teamIndex].includes(p.id)
  );
  const teamCards = teamPlayers.flatMap(p => p.hand);

  const heldHalfSuits = [...new Set(bot.hand.map(c => getHalfSuit(c)).filter(Boolean))];

  // Score each half-suit by how many cards the team already holds (higher = closer to claim)
  const hsWithScore = heldHalfSuits.map(hs => {
    const allCards = HALF_SUITS[hs];
    const heldCount = allCards.filter(c => teamCards.includes(c)).length;
    return { hs, heldCount, askable: allCards.filter(c => !teamCards.includes(c)) };
  }).filter(x => x.askable.length > 0);

  if (hsWithScore.length === 0) return null;

  // Pick the half-suit where the team holds the most cards
  hsWithScore.sort((a, b) => b.heldCount - a.heldCount);
  const best = hsWithScore[0];

  // Pick the first askable card and the opponent with the most cards
  return {
    type: 'ask',
    card: best.askable[0],
    targetId: sortedOpponents[0].id,
  };
}
