import { emit } from "../socket.js";
import { HALF_SUIT_NAMES } from "../constants.js";

/**
 * Renders the results/end-game screen.
 * @param {HTMLElement} container
 * @param {object}      state
 * @param {string}      localUserId
 */
export function renderResultsScreen(container, state, localUserId) {
  const {
    scores = [0, 0], claimedHalfSuits = [], winner,
    instanceId, players = [], isSpectating = false,
  } = state;

  const isHost       = !isSpectating && players.length > 0 && players[0].id === localUserId;
  const localPlayer  = players.find(p => p.id === localUserId);

  const winnerText = winner === null ? '🤝 It\'s a Tie!'
                   : winner === 0   ? '🏆 Team A Wins!'
                   :                  '🏆 Team B Wins!';

  // Scoreboard rows
  const rowsHtml = claimedHalfSuits.map(c => {
    const claimer = players.find(p => p.id === c.claimedBy);
    const claimerName = claimer?.username ?? '—';
    const isCancelled = c.outcome === 'wrong_location';

    const winnerCell = isCancelled
      ? `<td class="rs-cancelled">✕ Cancelled</td>`
      : c.teamIndex === 0
        ? `<td class="rs-team-a">Team A 🔵</td>`
        : `<td class="rs-team-b">Team B 🔴</td>`;

    return `
      <tr class="${isCancelled ? 'rs-row-cancelled' : ''}">
        <td>${HALF_SUIT_NAMES[c.halfSuit] ?? c.halfSuit}</td>
        ${winnerCell}
        <td>${claimerName}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="results-screen">
      <h1 class="results-title">${winnerText}</h1>
      <div class="results-scores">
        <div class="result-score team-a">
          <span class="result-score-label">Team A</span>
          <span class="result-score-value">${scores[0]}</span>
        </div>
        <div class="result-score-divider">–</div>
        <div class="result-score team-b">
          <span class="result-score-label">Team B</span>
          <span class="result-score-value">${scores[1]}</span>
        </div>
      </div>

      <div class="rs-table-wrap">
        <table class="rs-table">
          <thead>
            <tr>
              <th>Half-Suit</th>
              <th>Winner</th>
              <th>Claimed by</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>

      ${isHost
        ? `<button id="play-again-btn" class="btn btn-primary">▶ Play Again</button>`
        : `<p class="waiting-text">Waiting for the host to start a new game…</p>`}
    </div>
  `;

  // Confetti for the winner
  if (winner !== null) spawnConfetti(container, winner);

  container.querySelector('#play-again-btn')?.addEventListener('click', () => {
    emit('join-game', {
      instanceId,
      userId:    localPlayer?.id,
      username:  localPlayer?.username,
      avatarUrl: localPlayer?.avatarUrl,
    });
  });
}

// ─── Confetti ───────────────────────────────────────────────────────────────

function spawnConfetti(container, winner) {
  const colors = winner === 0
    ? ['#5865F2', '#7983f5', '#ffffff', '#faa61a']
    : ['#ED4245', '#f27173', '#ffffff', '#faa61a'];

  const wrap = document.createElement('div');
  wrap.className = 'confetti-wrap';

  for (let i = 0; i < 48; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const size = 6 + Math.random() * 8;
    Object.assign(p.style, {
      left:                    `${Math.random() * 100}%`,
      width:                   `${size}px`,
      height:                  `${size}px`,
      background:              colors[i % colors.length],
      borderRadius:            Math.random() > 0.5 ? '50%' : '2px',
      animationDelay:          `${(Math.random() * 2.5).toFixed(2)}s`,
      animationDuration:       `${(2 + Math.random() * 2).toFixed(2)}s`,
    });
    wrap.appendChild(p);
  }

  document.body.appendChild(wrap);
  // Remove after all particles have fallen
  setTimeout(() => wrap.remove(), 6000);
}

