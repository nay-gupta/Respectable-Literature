/**
 * Renders the player list / scoreboard bar.
 * @param {HTMLElement} container
 * @param {object} state
 * @param {string} localUserId
 */
export function renderPlayerList(container, state) {
  const { players = [], teams = [[], []], currentTurnPlayerId, scores = [0, 0] } = state;

  const teamA = teams[0] ?? [];
  const teamB = teams[1] ?? [];

  container.innerHTML = `
    <div class="player-list-bar">
      <div class="scores-bar">
        <span class="score team-a-score">Team A: ${scores[0]}</span>
        <span class="score-divider">|</span>
        <span class="score team-b-score">Team B: ${scores[1]}</span>
      </div>
      <div class="players-row">
        <div class="team-players team-a-players">
          ${players.filter(p => teamA.includes(p.id)).map(p => playerChipHtml(p, currentTurnPlayerId)).join('')}
        </div>
        <div class="team-divider"></div>
        <div class="team-players team-b-players">
          ${players.filter(p => teamB.includes(p.id)).map(p => playerChipHtml(p, currentTurnPlayerId)).join('')}
        </div>
      </div>
    </div>
  `;
}

function playerChipHtml(player, currentTurnPlayerId) {
  const isCurrentTurn = player.id === currentTurnPlayerId;
  const isEmpty = player.cardCount === 0;
  return `
    <div class="player-chip ${isCurrentTurn ? 'current-turn' : ''} ${isEmpty ? 'no-cards' : ''}">
      ${player.avatarUrl
        ? `<img src="${player.avatarUrl}" class="player-avatar-xs" alt="${player.username}" />`
        : `<div class="player-avatar-xs avatar-placeholder">${player.username[0].toUpperCase()}</div>`
      }
      <div class="player-chip-info">
        <span class="player-chip-name">${player.username}</span>
        <span class="player-chip-cards">${player.cardCount} 🃏</span>
      </div>
      ${isCurrentTurn ? '<span class="turn-indicator">▶</span>' : ''}
    </div>
  `;
}
