import { emit } from "../socket.js";

/**
 * Renders the lobby screen into the given container.
 * @param {HTMLElement} container
 * @param {object} state - Current game state
 * @param {object|string} localUserOrId - The current user object {id,username,avatarUrl} or just userId string
 */
export function renderLobby(container, state, localUserOrId) {
  // Accept either the full localUser object or a bare id string (backwards-compat)
  const localUser = typeof localUserOrId === 'string'
    ? { id: localUserOrId, username: '', avatarUrl: null }
    : localUserOrId;
  const localUserId = localUser.id;

  const { players = [], spectators = [], instanceId } = state;
  const isHost = players.length > 0 && players[0].id === localUserId;
  const isPlayer = players.some(p => p.id === localUserId);
  const canStart = players.length === 6 || players.length === 8;

  const teamA = players.filter(p => p.teamIndex === 0);
  const teamB = players.filter(p => p.teamIndex === 1);
  const unassigned = players.filter(p => p.teamIndex === null || p.teamIndex === undefined);

  const spectatorsHtml = spectators.length > 0
    ? `<ul class="spectator-list">${spectators.map(s => `
        <li class="spectator-item">
          ${s.avatarUrl
            ? `<img src="${s.avatarUrl}" class="player-avatar-sm" alt="${s.username}" />`
            : `<div class="player-avatar-sm avatar-placeholder">${s.username[0].toUpperCase()}</div>`}
          <span>${s.username}${s.id === localUserId ? ' <span class="you-badge">(you)</span>' : ''}</span>
        </li>`).join('')}
      </ul>`
    : `<p class="spectators-empty">No spectators yet</p>`;

  container.innerHTML = `
    <div class="lobby">
      <div class="lobby-header">
        <h1 class="lobby-title">Literature</h1>
        <p class="lobby-subtitle">Waiting for players…</p>
        <div class="player-count-badge ${canStart ? 'ready' : ''}">
          ${players.length} / 6–8 players
        </div>
      </div>

      <div class="teams-container">
        <div class="team team-a">
          <h3 class="team-label">Team A 🔵</h3>
          <ul class="player-list-lobby">
            ${(teamA.length ? teamA : unassigned.slice(0, Math.ceil(unassigned.length / 2)))
              .map(p => playerItemHtml(p, localUserId, isHost)).join('')}
            ${teamA.length === 0 && unassigned.length === 0 ? '<li class="empty-slot">No players yet</li>' : ''}
          </ul>
        </div>
        <div class="team team-b">
          <h3 class="team-label">Team B 🔴</h3>
          <ul class="player-list-lobby">
            ${(teamB.length ? teamB : unassigned.slice(Math.ceil(unassigned.length / 2)))
              .map(p => playerItemHtml(p, localUserId, isHost)).join('')}
            ${teamB.length === 0 && unassigned.length === 0 ? '<li class="empty-slot">No players yet</li>' : ''}
          </ul>
        </div>
      </div>

      ${isHost ? `
        <div class="lobby-actions">
          <button id="shuffle-teams-btn" class="btn btn-ghost">
            🔀 Shuffle Teams
          </button>
          <button id="add-bot-btn" class="btn btn-ghost ${players.length >= 8 ? 'disabled' : ''}" ${players.length >= 8 ? 'disabled' : ''}>
            🤖 Add Bot
          </button>
          <button id="start-game-btn" class="btn btn-primary ${canStart ? '' : 'disabled'}" ${canStart ? '' : 'disabled'}>
            ▶ Start Game
          </button>
          <button id="watch-bots-btn" class="btn btn-ghost">
            👁 Watch Bots Play
          </button>
        </div>
        ${!canStart ? `<p class="lobby-hint">Need exactly 6 or 8 players to start. ${players.length < 6 ? `Add ${6 - players.length} more.` : players.length === 7 ? 'Add 1 more.' : ''}</p>` : ''}
      ` : !isPlayer ? `
        <div class="lobby-actions">
          <button id="join-as-spectator-btn" class="btn btn-ghost">
            👁 Watch as Spectator
          </button>
          <button id="watch-bots-btn" class="btn btn-ghost">
            👁 Watch Bots Play
          </button>
        </div>
        <p class="lobby-hint">The game hasn't started yet. You can watch as a spectator, or ask the host to save you a seat.</p>
      ` : `
        <div class="lobby-actions">
          <p class="lobby-waiting">Waiting for the host to start the game…</p>
          <button id="watch-bots-btn" class="btn btn-ghost">
            👁 Watch Bots Play
          </button>
        </div>
      `}

      <div class="spectators-section">
        <h4 class="spectators-heading">👁 Spectators (${spectators.length})</h4>
        ${spectatorsHtml}
      </div>
    </div>
  `;

  if (isHost) {
    container.querySelector('#start-game-btn')?.addEventListener('click', () => {
      if (canStart) emit('start-game', { instanceId });
    });

    container.querySelector('#shuffle-teams-btn')?.addEventListener('click', () => {
      emit('request-state', { instanceId });
    });

    container.querySelector('#add-bot-btn')?.addEventListener('click', () => {
      if (players.length < 8) emit('add-bot', { instanceId });
    });

    // Remove-bot buttons (one per bot row)
    container.querySelectorAll('.remove-bot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        emit('remove-bot', { instanceId, botId: btn.dataset.botId });
      });
    });
  }

  container.querySelector('#join-as-spectator-btn')?.addEventListener('click', () => {
    emit('join-game', {
      instanceId,
      userId: localUser.id,
      username: localUser.username,
      avatarUrl: localUser.avatarUrl,
      spectate: true,
    });
  });

  container.querySelector('#watch-bots-btn')?.addEventListener('click', () => {
    emit('spectate-bot-game', { instanceId });
  });
}

function playerItemHtml(player, localUserId, isHost = false) {
  const isYou = player.id === localUserId;
  const avatarEl = player.isBot
    ? `<div class="player-avatar-sm avatar-placeholder">🤖</div>`
    : player.avatarUrl
      ? `<img src="${player.avatarUrl}" class="player-avatar-sm" alt="${player.username}" />`
      : `<div class="player-avatar-sm avatar-placeholder">${player.username[0].toUpperCase()}</div>`;

  const label = player.isBot
    ? `<span class="player-name">${player.username} <span class="bot-badge">BOT</span></span>`
    : `<span class="player-name">${player.username}${isYou ? ' <span class="you-badge">(you)</span>' : ''}</span>`;

  const removeBtn = (player.isBot && isHost)
    ? `<button class="remove-bot-btn" data-bot-id="${player.id}" title="Remove bot">✕</button>`
    : '';

  return `
    <li class="player-item-lobby">
      ${avatarEl}
      ${label}
      ${removeBtn}
    </li>
  `;
}
