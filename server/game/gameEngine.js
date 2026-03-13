import { HALF_SUITS, dealCards, getHalfSuit } from './deck.js';

/**
 * Creates an initial game state in 'lobby' status.
 */
export function createGame(instanceId) {
  return {
    instanceId,
    status: 'lobby',
    players: [],
    spectators: [],
    teams: [[], []],
    currentTurnPlayerId: null,
    lastQuestion: null,
    claimedHalfSuits: [],
    scores: [0, 0],
    forcedClaimTeam: null,
    eventLog: [],
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * Adds or updates a player in the lobby. Returns the new state.
 */
export function joinGame(gameState, player) {
  const { id, username, avatarUrl, isBot = false } = player;
  const existing = gameState.players.find(p => p.id === id);
  if (existing) {
    // Update info in case username/avatar changed
    existing.username = username;
    existing.avatarUrl = avatarUrl;
    return gameState;
  }
  gameState.players.push({
    id,
    username,
    avatarUrl,
    teamIndex: null,
    hand: [],
    cardCount: 0,
    isBot,
  });
  return gameState;
}

/**
 * Removes a player from the game (used on disconnect in lobby).
 */
export function removePlayer(gameState, playerId) {
  gameState.players = gameState.players.filter(p => p.id !== playerId);
  gameState.teams[0] = gameState.teams[0].filter(id => id !== playerId);
  gameState.teams[1] = gameState.teams[1].filter(id => id !== playerId);
  return gameState;
}

/**
 * Adds a spectator. No-ops if already watching.
 */
export function addSpectator(gameState, { id, username, avatarUrl }) {
  if (gameState.spectators.find(s => s.id === id)) return gameState;
  gameState.spectators.push({ id, username, avatarUrl });
  return gameState;
}

/**
 * Removes a spectator by id.
 */
export function removeSpectator(gameState, spectatorId) {
  gameState.spectators = gameState.spectators.filter(s => s.id !== spectatorId);
  return gameState;
}

/**
 * Returns a state object safe to send to a spectator:
 * all player hands are stripped; isSpectating flag is set.
 */
export function getSpectatorState(gameState) {
  return {
    ...gameState,
    isSpectating: true,
    players: gameState.players.map(({ hand: _hand, ...rest }) => rest),
  };
}

/**
 * Randomly assigns players to two teams, alternating seats.
 * Mutates and returns the game state.
 */
export function assignTeams(gameState) {
  const shuffled = [...gameState.players].sort(() => Math.random() - 0.5);
  gameState.teams = [[], []];
  shuffled.forEach((player, i) => {
    const teamIndex = i % 2;
    player.teamIndex = teamIndex;
    gameState.teams[teamIndex].push(player.id);
  });
  // Reorder players array to alternate teams (A, B, A, B, ...)
  gameState.players = shuffled;
  return gameState;
}

/**
 * Starts the game: assign teams, deal cards, set first turn.
 * Returns { newState } or throws an error string.
 */
export function startGame(gameState) {
  const count = gameState.players.length;
  if (count !== 6 && count !== 8) {
    throw new Error(`Need exactly 6 or 8 players to start (have ${count})`);
  }

  assignTeams(gameState);

  const hands = dealCards(count);
  gameState.players.forEach((player, i) => {
    player.hand = hands[i];
    player.cardCount = hands[i].length;
  });

  gameState.currentTurnPlayerId = gameState.players[0].id;
  gameState.status = 'playing';
  gameState.startedAt = Date.now();

  gameState.eventLog.push({ type: 'game_started', message: 'The game has started!' });

  return gameState;
}

/**
 * Validates an ask action. Returns { valid: bool, reason: string }.
 */
export function validateAsk(gameState, askerId, targetId, card) {
  const asker = gameState.players.find(p => p.id === askerId);
  const target = gameState.players.find(p => p.id === targetId);

  if (gameState.status !== 'playing') return { valid: false, reason: 'Game is not in progress.' };
  if (gameState.currentTurnPlayerId !== askerId) return { valid: false, reason: 'It is not your turn.' };
  if (!asker) return { valid: false, reason: 'Asker not found.' };
  if (!target) return { valid: false, reason: 'Target player not found.' };
  if (asker.teamIndex === target.teamIndex) return { valid: false, reason: 'You cannot ask a teammate.' };
  if (target.cardCount === 0) return { valid: false, reason: 'That player has no cards.' };
  if (asker.hand.includes(card)) return { valid: false, reason: 'You already hold that card.' };

  const halfSuit = getHalfSuit(card);
  if (!halfSuit) return { valid: false, reason: 'Invalid card.' };

  const hasCardInHalfSuit = asker.hand.some(c => getHalfSuit(c) === halfSuit);
  if (!hasCardInHalfSuit) return { valid: false, reason: 'You must hold at least one card in the same half-suit.' };

  return { valid: true, reason: null };
}

/**
 * Executes an ask. Assumes it has been validated.
 * Returns { newState, success }.
 */
export function processAsk(gameState, askerId, targetId, card) {
  const asker = gameState.players.find(p => p.id === askerId);
  const target = gameState.players.find(p => p.id === targetId);

  const success = target.hand.includes(card);
  const halfSuit = getHalfSuit(card);

  gameState.lastQuestion = {
    askerId,
    askerName: asker.username,
    targetId,
    targetName: target.username,
    card,
    halfSuit,
    success,
  };

  if (success) {
    // Transfer card from target to asker
    target.hand = target.hand.filter(c => c !== card);
    target.cardCount = target.hand.length;
    asker.hand.push(card);
    asker.cardCount = asker.hand.length;
    // Asker keeps the turn
    gameState.eventLog.push({
      type: 'ask_success',
      askerId, askerName: asker.username, askerTeam: asker.teamIndex,
      targetId, targetName: target.username, targetTeam: target.teamIndex,
      card,
    });
  } else {
    // Turn passes to target
    gameState.eventLog.push({
      type: 'ask_fail',
      askerId, askerName: asker.username, askerTeam: asker.teamIndex,
      targetId, targetName: target.username, targetTeam: target.teamIndex,
      card,
    });
    gameState = advanceTurn(gameState, targetId);
  }

  return { newState: gameState, success };
}

/**
 * Validates a claim. Returns { valid: bool, reason: string }.
 */
export function validateClaim(gameState, claimerId, halfSuit, cardMap) {
  if (gameState.status !== 'playing') return { valid: false, reason: 'Game is not in progress.' };
  if (gameState.currentTurnPlayerId !== claimerId) return { valid: false, reason: 'It is not your turn.' };

  const claimer = gameState.players.find(p => p.id === claimerId);
  if (!claimer) return { valid: false, reason: 'Claimer not found.' };

  if (!HALF_SUITS[halfSuit]) return { valid: false, reason: 'Invalid half-suit.' };

  const alreadyClaimed = gameState.claimedHalfSuits.find(c => c.halfSuit === halfSuit);
  if (alreadyClaimed) return { valid: false, reason: 'That half-suit has already been claimed.' };

  // cardMap must contain all 6 cards in the half-suit
  const expectedCards = HALF_SUITS[halfSuit];
  for (const card of expectedCards) {
    if (!cardMap[card]) return { valid: false, reason: `Missing assignment for card ${card}.` };
  }

  // All assigned players must be on claimer's team
  const claimerTeamIds = gameState.teams[claimer.teamIndex];
  for (const [card, assignedPlayerId] of Object.entries(cardMap)) {
    if (!claimerTeamIds.includes(assignedPlayerId)) {
      return { valid: false, reason: `Card ${card} assigned to a player not on your team.` };
    }
  }

  return { valid: true, reason: null };
}

/**
 * Executes a claim. Assumes it has been validated.
 * Returns { newState, outcome } where outcome is 'correct', 'wrong_location', or 'opponent_has_card'.
 */
export function processClaim(gameState, claimerId, halfSuit, cardMap) {
  const claimer = gameState.players.find(p => p.id === claimerId);
  const cards = HALF_SUITS[halfSuit];
  const claimerTeamIds = gameState.teams[claimer.teamIndex];
  const opponentTeamIds = gameState.teams[claimer.teamIndex === 0 ? 1 : 0];
  const opponentTeamIndex = claimer.teamIndex === 0 ? 1 : 0;

  // Check if any opponent has any card in this half-suit
  const opponentsHaveCard = gameState.players
    .filter(p => opponentTeamIds.includes(p.id))
    .some(p => p.hand.some(c => cards.includes(c)));

  let outcome;
  let scoringTeam;

  if (opponentsHaveCard) {
    // Opponents hold at least one card → opponents score it
    outcome = 'opponent_has_card';
    scoringTeam = opponentTeamIndex;
    gameState.scores[opponentTeamIndex] += 1;
  } else {
    // All cards are on claimer's team — check if locations are correct
    let allCorrect = true;
    for (const card of cards) {
      const assignedPlayerId = cardMap[card];
      const actualHolder = gameState.players.find(p => claimerTeamIds.includes(p.id) && p.hand.includes(card));
      if (!actualHolder || actualHolder.id !== assignedPlayerId) {
        allCorrect = false;
        break;
      }
    }

    if (allCorrect) {
      outcome = 'correct';
      scoringTeam = claimer.teamIndex;
      gameState.scores[claimer.teamIndex] += 1;
    } else {
      // Wrong locations — cancelled, neither team scores
      outcome = 'wrong_location';
      scoringTeam = null;
    }
  }

  // Remove all cards in the half-suit from all hands regardless
  for (const player of gameState.players) {
    player.hand = player.hand.filter(c => !cards.includes(c));
    player.cardCount = player.hand.length;
  }

  gameState.claimedHalfSuits.push({
    halfSuit,
    teamIndex: scoringTeam,
    claimedBy: claimerId,
    outcome,
  });

  const outcomeMsg = {
    correct: `${claimer.username} correctly claimed ${halfSuit}! Team ${claimer.teamIndex === 0 ? 'A' : 'B'} scores!`,
    wrong_location: `${claimer.username} claimed ${halfSuit} but got the locations wrong — cancelled!`,
    opponent_has_card: `${claimer.username} tried to claim ${halfSuit} but opponents held a card — opponents score!`,
  }[outcome];

  gameState.eventLog.push({
    type: 'claim',
    outcome,
    claimerId, claimerName: claimer.username, claimerTeam: claimer.teamIndex,
    halfSuit,
    scoringTeam,
  });

  // After claim, check if the claimer (or their team) has cards for turn management
  gameState = advanceTurn(gameState);

  return { newState: gameState, outcome };
}

/**
 * Advances the turn to toPlayerId (or finds the next eligible player).
 * Handles players with 0 cards (skips to next eligible on same team if needed).
 */
export function advanceTurn(gameState, toPlayerId = null) {
  const activePlayers = gameState.players.filter(p => p.cardCount > 0);

  if (activePlayers.length === 0) {
    // All cards claimed, game should end
    return gameState;
  }

  // If a specific player was requested, try them first
  if (toPlayerId) {
    const target = gameState.players.find(p => p.id === toPlayerId);
    if (target && target.cardCount > 0) {
      gameState.currentTurnPlayerId = toPlayerId;
      return gameState;
    }
    // Target has no cards — find next eligible on their team
    if (target) {
      const teamId = target.teamIndex;
      const teammate = gameState.players.find(p => p.teamIndex === teamId && p.cardCount > 0 && p.id !== toPlayerId);
      if (teammate) {
        gameState.currentTurnPlayerId = teammate.id;
        return gameState;
      }
    }
  }

  // Default: keep current player if they still have cards
  const current = gameState.players.find(p => p.id === gameState.currentTurnPlayerId);
  if (current && current.cardCount > 0) {
    return gameState;
  }

  // Find next player in order with cards
  const currentIndex = gameState.players.findIndex(p => p.id === gameState.currentTurnPlayerId);
  for (let i = 1; i <= gameState.players.length; i++) {
    const nextIndex = (currentIndex + i) % gameState.players.length;
    if (gameState.players[nextIndex].cardCount > 0) {
      gameState.currentTurnPlayerId = gameState.players[nextIndex].id;
      return gameState;
    }
  }

  return gameState;
}

/**
 * Checks if the game is over. Returns { gameOver, winner }.
 *
 * Win condition: a team wins when it has clinched a majority — meaning the
 * opposing team cannot reach the same score even if they won every remaining
 * unresolved set (including sets that might be cancelled via wrong_location).
 *
 * Formula: scores[i] > scores[1-i] + remaining  →  team i has won.
 *
 * This handles the subtle case where wrong_location claims remove sets from
 * play without awarding points: those cancelled sets reduce `remaining`,
 * making it easier for one team to clinch earlier than the raw set count
 * might suggest.
 */
export function checkEndgame(gameState) {
  const TOTAL_SETS = 8;
  const claimed = gameState.claimedHalfSuits.length;
  const remaining = TOTAL_SETS - claimed;

  // Early-win: trailing team cannot catch up even if they took every remaining set
  if (gameState.scores[0] > gameState.scores[1] + remaining) {
    return { gameOver: true, winner: 0 };
  }
  if (gameState.scores[1] > gameState.scores[0] + remaining) {
    return { gameOver: true, winner: 1 };
  }

  // All sets resolved — determine winner by score (tie = null)
  if (claimed === TOTAL_SETS) {
    const winner = gameState.scores[0] > gameState.scores[1] ? 0
                 : gameState.scores[1] > gameState.scores[0] ? 1
                 : null;
    return { gameOver: true, winner };
  }

  // Check if one team has run out of cards (forced claim scenario)
  const team0Cards = gameState.teams[0].reduce((sum, id) => {
    const p = gameState.players.find(p => p.id === id);
    return sum + (p ? p.cardCount : 0);
  }, 0);
  const team1Cards = gameState.teams[1].reduce((sum, id) => {
    const p = gameState.players.find(p => p.id === id);
    return sum + (p ? p.cardCount : 0);
  }, 0);

  if (team0Cards === 0 && team1Cards > 0) {
    gameState.forcedClaimTeam = 1;
  } else if (team1Cards === 0 && team0Cards > 0) {
    gameState.forcedClaimTeam = 0;
  }

  return { gameOver: false, winner: null };
}

/**
 * Finalizes the game state when game over.
 */
export function finalizeGame(gameState) {
  gameState.status = 'finished';
  gameState.finishedAt = Date.now();
  const winner = gameState.scores[0] > gameState.scores[1] ? 0 : gameState.scores[1] > gameState.scores[0] ? 1 : null;
  gameState.winner = winner;
  return gameState;
}

/**
 * Returns a "public" view of the game state safe to send to a specific player.
 * Strips other players' hands; includes only the requesting player's own hand.
 */
export function getPublicState(gameState, forPlayerId) {
  return {
    ...gameState,
    players: gameState.players.map(p => {
      if (p.id === forPlayerId) {
        return { ...p }; // include full hand for this player
      }
      const { hand: _hand, ...rest } = p;
      return rest; // strip hand for all others
    }),
  };
}
