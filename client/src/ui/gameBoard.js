import { renderPlayerList } from "./playerList.js";
import { renderHand } from "./handDisplay.js";
import { renderEventLog } from "./eventLog.js";
import { openAskModal } from "./askModal.js";
import { openClaimModal } from "./claimModal.js";

/**
 * Renders the main game board screen.
 * @param {HTMLElement} container
 * @param {object} state
 * @param {string} localUserId
 */
export function renderGameBoard(container, state, localUserId) {
  const { players = [], currentTurnPlayerId, status } = state;
  const localPlayer = players.find(p => p.id === localUserId);
  const isMyTurn = currentTurnPlayerId === localUserId;
  const hand = localPlayer?.hand ?? [];

  container.innerHTML = `
    <div class="game-board">
      <div id="player-list-container" class="player-list-area"></div>
      <div id="event-log-container" class="event-log-area"></div>
      <div id="hand-container" class="hand-area"></div>
      <div class="action-bar">
        <button id="ask-btn" class="btn btn-primary ${isMyTurn && hand.length > 0 ? '' : 'disabled'}" ${isMyTurn && hand.length > 0 ? '' : 'disabled'}>
          🙋 Ask Card
        </button>
        <button id="claim-btn" class="btn btn-secondary ${isMyTurn ? '' : 'disabled'}" ${isMyTurn ? '' : 'disabled'}>
          🃏 Claim Half-Suit
        </button>
      </div>
    </div>
  `;

  renderPlayerList(container.querySelector('#player-list-container'), state, localUserId);
  renderEventLog(container.querySelector('#event-log-container'), state, localUserId);
  renderHand(container.querySelector('#hand-container'), hand);

  container.querySelector('#ask-btn')?.addEventListener('click', () => {
    if (isMyTurn && hand.length > 0) {
      openAskModal(state, localUserId);
    }
  });

  container.querySelector('#claim-btn')?.addEventListener('click', () => {
    if (isMyTurn) {
      openClaimModal(state, localUserId);
    }
  });
}
