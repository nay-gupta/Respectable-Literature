import { emit } from "../socket.js";
import { HALF_SUIT_NAMES } from "../constants.js";

const ALL_HALF_SUITS = ['lowS', 'highS', 'lowH', 'highH', 'lowD', 'highD', 'lowC', 'highC'];

/**
 * Opens the Claim Half-Suit modal (two-step flow).
 * @param {object} state - Current game state
 * @param {string} localUserId
 */
export function openClaimModal(state, localUserId) {
  const { players = [], teams = [[], []], claimedHalfSuits = [], instanceId } = state;
  const localPlayer = players.find(p => p.id === localUserId);
  if (!localPlayer) return;

  const myTeamIndex = localPlayer.teamIndex;
  const myTeamIds = teams[myTeamIndex] ?? [];
  const myTeammates = players.filter(p => myTeamIds.includes(p.id));

  const claimedIds = claimedHalfSuits.map(c => c.halfSuit);
  const unclaimedHalfSuits = ALL_HALF_SUITS.filter(hs => !claimedIds.includes(hs));

  let selectedHalfSuit = null;
  // cardMap: { cardString: playerId }
  let cardMap = {};

  const modal = createModal();
  document.body.appendChild(modal);

  function renderStep1() {
    modal.querySelector('.modal-body').innerHTML = `
      <h3 class="modal-step-title">Step 1: Pick a half-suit to claim</h3>
      <div class="halfsuit-grid">
        ${unclaimedHalfSuits.map(hs => `
          <button class="halfsuit-btn" data-hs="${hs}">
            ${HALF_SUIT_NAMES[hs] ?? hs}
          </button>
        `).join('')}
      </div>
    `;

    modal.querySelectorAll('.halfsuit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedHalfSuit = btn.dataset.hs;
        cardMap = {};
        renderStep2();
      });
    });
  }

  function renderStep2() {
    const cards = getCardsInHalfSuit(selectedHalfSuit);

    modal.querySelector('.modal-body').innerHTML = `
      <h3 class="modal-step-title">Step 2: Assign each card to a teammate</h3>
      <p class="modal-step-sub">Claiming <strong>${HALF_SUIT_NAMES[selectedHalfSuit] ?? selectedHalfSuit}</strong></p>
      <div class="claim-assignments">
        ${cards.map(card => `
          <div class="claim-row" data-card="${card}">
            <span class="claim-card">${formatCard(card)}</span>
            <select class="claim-select" data-card="${card}">
              <option value="">— assign to —</option>
              ${myTeammates.map(p => `
                <option value="${p.id}" ${p.id === localUserId ? 'selected' : ''}>
                  ${p.username}${p.id === localUserId ? ' (you)' : ''}
                </option>
              `).join('')}
            </select>
          </div>
        `).join('')}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost modal-back-btn">← Back</button>
        <button class="btn btn-primary modal-confirm-btn">Claim!</button>
      </div>
    `;

    // Pre-fill cardMap with defaults (self for everything)
    for (const card of cards) {
      cardMap[card] = localUserId;
    }

    modal.querySelectorAll('.claim-select').forEach(select => {
      select.addEventListener('change', () => {
        cardMap[select.dataset.card] = select.value;
      });
    });

    modal.querySelector('.modal-back-btn').addEventListener('click', renderStep1);

    modal.querySelector('.modal-confirm-btn').addEventListener('click', () => {
      // Validate all cards are assigned
      for (const card of cards) {
        if (!cardMap[card]) {
          alert(`Please assign card ${card} to a player.`);
          return;
        }
      }
      emit('make-claim', { instanceId, halfSuit: selectedHalfSuit, cardMap });
      closeModal(modal);
    });
  }

  renderStep1();
  setupModalClose(modal);
}

function getCardsInHalfSuit(hsId) {
  const suit = hsId.slice(-1);
  const isLow = hsId.startsWith('low');
  const values = isLow ? ['2', '3', '4', '5', '6', '7'] : ['9', '10', 'J', 'Q', 'K', 'A'];
  return values.map(v => `${v}${suit}`);
}

function formatCard(card) {
  const suit = card.slice(-1);
  const value = card.slice(0, -1);
  const suitSymbol = { S: '♠', H: '♥', D: '♦', C: '♣' }[suit] ?? suit;
  return `${value}${suitSymbol}`;
}

function createModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">Claim a Half-Suit</h2>
        <button class="modal-close-btn">✕</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  return modal;
}

function setupModalClose(modal) {
  modal.querySelector('.modal-close-btn').addEventListener('click', () => closeModal(modal));
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal(modal);
  });
}

function closeModal(modal) {
  modal.remove();
}
