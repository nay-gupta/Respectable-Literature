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

  // Preserve settings panel open state before we blow away the DOM
  const settingsPanelWasOpen = container.querySelector('#settings-panel')?.hasAttribute('open') ?? false;

  const { players = [], spectators = [], instanceId, settings = {}, hostUserId } = state;

  // Host check uses persistent hostUserId; falls back to first player for old states
  const isHost   = hostUserId ? hostUserId === localUserId : (players.length > 0 && players[0].id === localUserId);
  const isPlayer = players.some(p => p.id === localUserId);
  const isSpectatorSelf = !isPlayer && spectators.some(s => s.id === localUserId);

  const s = {
    botDifficulty:   settings.botDifficulty   ?? 'easy',
    botSpeed:        settings.botSpeed        ?? 'slow',
    turnTimeLimit:   settings.turnTimeLimit   ?? 0,
  };

  const assignedCount = players.filter(p => p.teamIndex === 0 || p.teamIndex === 1).length;
  const teamACount = players.filter(p => p.teamIndex === 0).length;
  const teamBCount = players.filter(p => p.teamIndex === 1).length;
  const teamsEven = teamACount === teamBCount;
  const canStart = (players.length === 6 || players.length === 8) && assignedCount === players.length && teamsEven;
  const localPlayerTeam = players.find(p => p.id === localUserId)?.teamIndex ?? null;

  const teamA      = players.filter(p => p.teamIndex === 0);
  const teamB      = players.filter(p => p.teamIndex === 1);
  const unassigned = players.filter(p => p.teamIndex === null || p.teamIndex === undefined);

  const spectatorsHtml = spectators.length > 0
    ? `<ul class="spectator-list">${spectators.map(sp => `
        <li class="spectator-item">
          ${sp.avatarUrl
            ? `<img src="${sp.avatarUrl}" class="player-avatar-sm" alt="${sp.username}" />`
            : `<div class="player-avatar-sm avatar-placeholder">${sp.username[0].toUpperCase()}</div>`}
          <span>${sp.username}${sp.id === localUserId ? ' <span class="you-badge">(you)</span>' : ''}</span>
        </li>`).join('')}
      </ul>`
    : `<p class="spectators-empty">No spectators yet</p>`;

  // Settings panel (host only)
  const settingsPanelHtml = isHost ? `
    <details class="settings-panel" id="settings-panel">
      <summary class="settings-summary">⚙ Game Settings</summary>
      <div class="settings-body">

        <label class="setting-row">
          <span>Bot difficulty</span>
          <div class="btn-group">
            <button class="setting-btn ${s.botDifficulty==='easy'?'active':''}" data-setting="botDifficulty" data-value="easy">Easy</button>
            <button class="setting-btn ${s.botDifficulty==='hard'?'active':''}" data-setting="botDifficulty" data-value="hard">Hard</button>
          </div>
        </label>

        <label class="setting-row">
          <span>Bot speed</span>
          <div class="btn-group">
            <button class="setting-btn ${s.botSpeed==='slow'?'active':''}" data-setting="botSpeed" data-value="slow">Slow</button>
            <button class="setting-btn ${s.botSpeed==='fast'?'active':''}" data-setting="botSpeed" data-value="fast">Fast</button>
          </div>
        </label>

        <label class="setting-row">
          <span>Turn time limit</span>
          <div class="btn-group">
            <button class="setting-btn ${s.turnTimeLimit===0?'active':''}"  data-setting="turnTimeLimit" data-value="0">Off</button>
            <button class="setting-btn ${s.turnTimeLimit===30?'active':''}" data-setting="turnTimeLimit" data-value="30">30s</button>
            <button class="setting-btn ${s.turnTimeLimit===60?'active':''}" data-setting="turnTimeLimit" data-value="60">60s</button>
          </div>
        </label>

      </div>
    </details>
  ` : '';

  // Host action bar (shown whether the host is a player OR a spectator)
  const hostActionsHtml = isHost ? `
    <div class="lobby-actions">
      ${isPlayer ? `
        <button id="shuffle-teams-btn" class="btn btn-ghost">
          🔀 Shuffle Teams
        </button>
      ` : ''}
      <button id="add-bot-btn" class="btn btn-ghost ${players.length >= 8 ? 'disabled' : ''}" ${players.length >= 8 ? 'disabled' : ''}>
        🤖 Add Bot
      </button>
      <button id="start-game-btn" class="btn btn-primary ${canStart ? '' : 'disabled'}" ${canStart ? '' : 'disabled'}>
        ▶ Start Game
      </button>
    </div>
    ${!canStart ? `<p class="lobby-hint">${
      players.length !== 6 && players.length !== 8
        ? `Need 6 or 8 players to start (have ${players.length}).`
        : assignedCount !== players.length
          ? `All players must be assigned to a team before starting.`
          : `Teams must be equal size (${teamACount}v${teamBCount}).`
    }</p>` : ''}
    ${settingsPanelHtml}
  ` : !isPlayer && !isSpectatorSelf ? `
    <div class="lobby-actions">
      <button id="join-as-spectator-btn" class="btn btn-ghost">
        👁 Watch as Spectator
      </button>
    </div>
    <p class="lobby-hint">The game hasn't started yet. Ask the host to save you a seat.</p>
  ` : !isHost && isPlayer ? `
    <div class="lobby-actions">
      <p class="lobby-waiting">Waiting for the host to start the game…</p>
    </div>
  ` : '';

  // Rejoin button for when local user is in spectator list (lobby)
  const rejoinHtml = isSpectatorSelf ? `
    <button id="rejoin-btn" class="btn btn-ghost">↩ Rejoin as Player</button>
  ` : '';

  container.innerHTML = `
    <div class="lobby">
      <div class="lobby-header">
        <h1 class="lobby-title">Literature</h1>
        <p class="lobby-subtitle">Waiting for players…</p>
        <div class="player-count-badge ${canStart ? 'ready' : ''}">
          ${players.length} players
        </div>
      </div>

      <div class="teams-container">
        <div class="team team-a">
          <div class="team-header">
            <h3 class="team-label">Team A 🔵</h3>
            ${isPlayer ? (localPlayerTeam === 0
              ? `<span class="team-joined-badge">✓ You're here</span>`
              : `<button class="join-team-btn" data-team-index="0">Join</button>`) : ''}
          </div>
          <ul class="player-list-lobby">
            ${teamA.map(p => playerItemHtml(p, localUserId, isHost, hostUserId)).join('')}
            ${teamA.length === 0 ? '<li class="empty-slot">No players yet</li>' : ''}
          </ul>
        </div>
        <div class="team team-b">
          <div class="team-header">
            <h3 class="team-label">Team B 🔴</h3>
            ${isPlayer ? (localPlayerTeam === 1
              ? `<span class="team-joined-badge">✓ You're here</span>`
              : `<button class="join-team-btn" data-team-index="1">Join</button>`) : ''}
          </div>
          <ul class="player-list-lobby">
            ${teamB.map(p => playerItemHtml(p, localUserId, isHost, hostUserId)).join('')}
            ${teamB.length === 0 ? '<li class="empty-slot">No players yet</li>' : ''}
          </ul>
        </div>
      </div>

      ${unassigned.length > 0 ? `
      <div class="unassigned-section">
        <h4 class="unassigned-heading">No team yet</h4>
        <ul class="player-list-lobby">
          ${unassigned.map(p => playerItemHtml(p, localUserId, isHost, hostUserId)).join('')}
        </ul>
      </div>` : ''}

      ${hostActionsHtml}

      <div class="spectators-section">
        <h4 class="spectators-heading">👁 Spectators (${spectators.length})</h4>
        ${spectatorsHtml}
        ${rejoinHtml}
      </div>
    </div>
  `;

  // ── Event bindings ────────────────────────────────────────────────────────

  // Restore settings panel open state (lost when container.innerHTML is rebuilt)
  if (settingsPanelWasOpen) {
    container.querySelector('#settings-panel')?.setAttribute('open', '');
  }

  if (isHost) {
    container.querySelector('#start-game-btn')?.addEventListener('click', () => {
      if (canStart) emit('start-game', { instanceId });
    });

    container.querySelector('#shuffle-teams-btn')?.addEventListener('click', () => {
      emit('shuffle-teams', { instanceId });
    });

    container.querySelector('#add-bot-btn')?.addEventListener('click', () => {
      if (players.length < 8) emit('add-bot', { instanceId });
    });

    // Remove-bot buttons
    container.querySelectorAll('.remove-bot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        emit('remove-bot', { instanceId, botId: btn.dataset.botId });
      });
    });

    // Kick-player buttons
    container.querySelectorAll('.kick-player-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        emit('kick-player', { instanceId, targetId: btn.dataset.playerId });
      });
    });

    // Transfer-host buttons
    container.querySelectorAll('.make-host-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        emit('transfer-host', { instanceId, newHostId: btn.dataset.playerId });
      });
    });

    // Settings panel — delegated click for segmented buttons
    container.querySelector('#settings-panel')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-setting]');
      if (!btn) return;
      const key = btn.dataset.setting;
      const raw = btn.dataset.value;
      const value = raw !== undefined && !isNaN(raw) ? Number(raw) : raw;
      emit('update-settings', { instanceId, settings: { [key]: value } });
    });


  }

  // Watch-self: move local player to spectators
  container.querySelector('.watch-self-btn')?.addEventListener('click', () => {
    emit('lobby-spectate', { instanceId });
  });

  // Switch team: move self to a chosen team
  container.querySelectorAll('.join-team-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      emit('switch-team', { instanceId, teamIndex: Number(btn.dataset.teamIndex) });
    });
  });

  // Rejoin: move local spectator back to players
  container.querySelector('#rejoin-btn')?.addEventListener('click', () => {
    emit('lobby-rejoin', { instanceId });
  });

  container.querySelector('#join-as-spectator-btn')?.addEventListener('click', () => {
    emit('join-game', {
      instanceId,
      userId:    localUser.id,
      username:  localUser.username,
      avatarUrl: localUser.avatarUrl,
      spectate: true,
    });
  });
}

function playerItemHtml(player, localUserId, isHost = false, hostUserId = null) {
  const isYou = player.id === localUserId;
  const isHostPlayer = player.id === hostUserId;
  const avatarEl = player.isBot
    ? `<div class="player-avatar-sm avatar-placeholder">🤖</div>`
    : player.avatarUrl
      ? `<img src="${player.avatarUrl}" class="player-avatar-sm" alt="${player.username}" />`
      : `<div class="player-avatar-sm avatar-placeholder">${player.username[0].toUpperCase()}</div>`;

  const label = player.isBot
    ? `<span class="player-name">${player.username} <span class="bot-badge">BOT</span></span>`
    : `<span class="player-name">${player.username}${isYou ? ' <span class="you-badge">(you)</span>' : ''}${isHostPlayer ? ' <span class="host-badge">👑</span>' : ''}</span>`;

  // Watch button: shown on the local human player's own row
  const watchBtn = (!player.isBot && isYou)
    ? `<button class="watch-self-btn player-row-btn" title="Move to spectators">👁</button>`
    : '';

  // Remove bot button
  const removeBtn = (player.isBot && isHost)
    ? `<button class="remove-bot-btn player-row-btn" data-bot-id="${player.id}" title="Remove bot">✕</button>`
    : '';

  // Host controls for other humans (kick + make host)
  const hostControls = (isHost && !player.isBot && !isYou)
    ? `<button class="kick-player-btn player-row-btn" data-player-id="${player.id}" title="Kick player">🚫</button>
       <button class="make-host-btn player-row-btn" data-player-id="${player.id}" title="Make host">👑</button>`
    : '';

  return `
    <li class="player-item-lobby">
      ${avatarEl}
      ${label}
      ${watchBtn}
      ${removeBtn}
      ${hostControls}
    </li>
  `;
}
