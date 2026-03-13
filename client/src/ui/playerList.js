/**
 * Renders the player list / scoreboard bar.
 * @param {HTMLElement} container
 * @param {object} state
 * @param {string} localUserId
 */
export function renderPlayerList(container, state, localUserId) {
  const { players = [], teams = [[], []], currentTurnPlayerId, scores = [0, 0] } = state;

  const teamA = teams[0] ?? [];
  const teamB = teams[1] ?? [];

  const teamAPlayers = players.filter(p => teamA.includes(p.id));
  const teamBPlayers = players.filter(p => teamB.includes(p.id));

  container.innerHTML = `
    <div class="player-list-bar">
      <div class="team-section team-section-a">
        <div class="team-section-header">
          <span class="team-section-label">Team A</span>
          <span class="team-section-score">${scores[0]}</span>
        </div>
        <div class="team-chips">
          ${teamAPlayers.map(p => playerChipHtml(p, currentTurnPlayerId, 'a', localUserId)).join('')}
        </div>
      </div>
      <div class="team-section-divider"></div>
      <div class="team-section team-section-b">
        <div class="team-section-header">
          <span class="team-section-label">Team B</span>
          <span class="team-section-score">${scores[1]}</span>
        </div>
        <div class="team-chips">
          ${teamBPlayers.map(p => playerChipHtml(p, currentTurnPlayerId, 'b', localUserId)).join('')}
        </div>
      </div>
    </div>
  `;
}

function playerChipHtml(player, currentTurnPlayerId, team, localUserId) {
  const isCurrentTurn = player.id === currentTurnPlayerId;
  const isYou = player.id === localUserId;
  const isEmpty = player.cardCount === 0;
  const classes = [
    'player-chip',
    `player-chip-team-${team}`,
    isCurrentTurn ? 'current-turn' : '',
    isEmpty ? 'no-cards' : '',
    isYou ? 'is-you' : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="${classes}">
      ${player.avatarUrl
        ? `<img src="${player.avatarUrl}" class="player-avatar-xs" alt="${player.username}" />`
        : `<div class="player-avatar-xs avatar-placeholder">${(player.isBot ? '🤖' : player.username[0].toUpperCase())}</div>`
      }
      <div class="player-chip-info">
        <span class="player-chip-name">${player.username}${isYou ? ' <span class="you-badge">(you)</span>' : ''}</span>
        <span class="player-chip-cards">${player.cardCount} 🃏</span>
      </div>
      ${isCurrentTurn ? '<span class="turn-indicator">▶</span>' : ''}
    </div>
  `;
}

