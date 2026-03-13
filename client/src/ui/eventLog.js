import { HALF_SUIT_NAMES } from "../constants.js";

/**
 * Renders the event log feed.
 * @param {HTMLElement} container
 * @param {object} state
 */
export function renderEventLog(container, state, localUserId) {
  const { eventLog = [], currentTurnPlayerId, players = [] } = state;

  const currentPlayer = players.find(p => p.id === currentTurnPlayerId);
  const isMyTurn = currentTurnPlayerId === localUserId;

  // Preserve scroll position: if already near the top (newest), stay there
  const feed = container.querySelector('.event-feed');
  const wasAtTop = !feed || feed.scrollTop < 40;

  container.innerHTML = `
    <div class="event-log">
      ${currentPlayer ? `
        <div class="turn-announcement">
          It's <strong class="${isMyTurn ? 'name-self' : teamClass(currentPlayer.teamIndex)}">${currentPlayer.username}</strong>'s turn${isMyTurn ? ' — <span class="your-turn-cue">your turn!</span>' : ''}.
        </div>
      ` : ''}
      <div class="event-feed">
        ${eventLog.length === 0
          ? '<p class="no-events">No events yet.</p>'
          : eventLog.slice().reverse().map(e => eventHtml(e, localUserId)).join('')
        }
      </div>
    </div>
  `;

  if (wasAtTop) {
    const newFeed = container.querySelector('.event-feed');
    if (newFeed) newFeed.scrollTop = 0;
  }
}

function teamClass(teamIndex) {
  if (teamIndex === 0) return 'name-team-a';
  if (teamIndex === 1) return 'name-team-b';
  return '';
}

function name(n, team, id, localUserId) {
  const cls = id && id === localUserId ? 'name-self' : teamClass(team);
  return `<strong class="${cls}">${n}</strong>`;
}

function formatCard(card) {
  if (!card) return card;
  const suit = card.slice(-1);
  const value = card.slice(0, -1);
  const sym = { S: '♠', H: '♥', D: '♦', C: '♣' }[suit] ?? suit;
  const colorClass = (suit === 'H' || suit === 'D') ? 'card-sym-red' : 'card-sym-black';
  return `<span class="card-sym ${colorClass}">${value}${sym}</span>`;
}

function eventHtml(event, localUserId) {
  const iconMap = {
    ask_success: '✅',
    ask_fail: '❌',
    claim: '🃏',
    game_started: '🎮',
  };
  const icon = iconMap[event.type] ?? '•';
  const n = (label, team, id) => name(label, team, id, localUserId);

  let msg;
  switch (event.type) {
    case 'ask_success':
      msg = `${n(event.askerName, event.askerTeam, event.askerId)} asked ${n(event.targetName, event.targetTeam, event.targetId)} for ${formatCard(event.card)} — ${n(event.targetName, event.targetTeam, event.targetId)} had it!`;
      break;
    case 'ask_fail':
      msg = `${n(event.askerName, event.askerTeam, event.askerId)} asked ${n(event.targetName, event.targetTeam, event.targetId)} for ${formatCard(event.card)} — ${n(event.targetName, event.targetTeam, event.targetId)} did not have it.`;
      break;
    case 'claim': {
      const hsName = HALF_SUIT_NAMES[event.halfSuit] ?? event.halfSuit;
      const claimer = n(event.claimerName, event.claimerTeam, event.claimerId);
      const scoringLabel = event.scoringTeam === 0
        ? `<span class="name-team-a">Team A</span>`
        : event.scoringTeam === 1
          ? `<span class="name-team-b">Team B</span>`
          : null;
      if (event.outcome === 'correct') {
        msg = `${claimer} claimed <em>${hsName}</em> correctly! ${scoringLabel} scores.`;
      } else if (event.outcome === 'wrong_location') {
        msg = `${claimer} claimed <em>${hsName}</em> but got the locations wrong — cancelled!`;
      } else {
        msg = `${claimer} tried to claim <em>${hsName}</em> — opponents held a card, ${scoringLabel} scores.`;
      }
      break;
    }
    case 'game_started':
      msg = 'The game has started!';
      break;
    default:
      msg = event.message ?? '';
  }

  return `<div class="event-item event-${event.type}">${icon} ${msg}</div>`;
}

