import { emit } from "../socket.js";
import { HALF_SUIT_NAMES } from "../constants.js";

/**
 * Renders the results/end-game screen.
 * @param {HTMLElement} container
 * @param {object} state
 * @param {string} localUserId
 */
export function renderResultsScreen(container, state, localUserId) {
  const { scores = [0, 0], claimedHalfSuits = [], winner, instanceId, players = [], teams = [[], []] } = state;

  const winnerText =
    winner === null ? '🤝 It\'s a Tie!' :
    winner === 0 ? '🏆 Team A Wins!' : '🏆 Team B Wins!';

  const localPlayer = players.find(p => p.id === localUserId);
  const isHost = players.length > 0 && players[0].id === localUserId;

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

      <div class="claimed-list">
        <h3>Half-Suit Results</h3>
        <ul>
          ${claimedHalfSuits.map(c => {
            const teamLabel = c.teamIndex === 0 ? 'Team A' : c.teamIndex === 1 ? 'Team B' : 'Cancelled';
            const icon = c.teamIndex === 0 ? '🔵' : c.teamIndex === 1 ? '🔴' : '❌';
            return `<li>${icon} <strong>${HALF_SUIT_NAMES[c.halfSuit] ?? c.halfSuit}</strong> → ${teamLabel}</li>`;
          }).join('')}
        </ul>
      </div>

      ${isHost ? `<button id="play-again-btn" class="btn btn-primary">Play Again</button>` : `<p class="waiting-text">Waiting for host to start a new game…</p>`}
    </div>
  `;

  container.querySelector('#play-again-btn')?.addEventListener('click', () => {
    // Re-join the same instance to reset the game
    emit('join-game', {
      instanceId,
      userId: localPlayer?.id,
      username: localPlayer?.username,
      avatarUrl: localPlayer?.avatarUrl,
    });
  });
}
