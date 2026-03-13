import { emit } from "../socket.js";
import { cardHtml, groupByHalfSuit, getHalfSuitId } from "./handDisplay.js";
import { HALF_SUIT_NAMES } from "../constants.js";

/**
 * Opens the Ask Card modal (three-step flow).
 * @param {object} state - Current game state
 * @param {string} localUserId
 */
export function openAskModal(state, localUserId) {
  const { players = [], teams = [[], []], instanceId } = state;
  const localPlayer = players.find(p => p.id === localUserId);
  if (!localPlayer) return;

  const hand = localPlayer.hand ?? [];
  const myTeamIndex = localPlayer.teamIndex;

  // Opponents with at least 1 card
  const opponents = players.filter(p => p.teamIndex !== myTeamIndex && p.cardCount > 0);

  // Half-suits the local player holds at least one card in
  const availableHalfSuits = [...new Set(hand.map(c => getHalfSuitId(c)).filter(Boolean))];

  let selectedOpponent = null;
  let selectedHalfSuit = null;

  const modal = createModal();
  document.body.appendChild(modal);

  function renderStep1() {
    modal.querySelector('.modal-body').innerHTML = `
      <h3 class="modal-step-title">Step 1: Pick an opponent to ask</h3>
      <div class="opponent-grid">
        ${opponents.map(p => `
          <button class="opponent-btn" data-id="${p.id}">
            ${p.avatarUrl
              ? `<img src="${p.avatarUrl}" class="player-avatar-sm" alt="${p.username}" />`
              : `<div class="player-avatar-sm avatar-placeholder">${p.username[0].toUpperCase()}</div>`
            }
            <span>${p.username}</span>
            <span class="chip">${p.cardCount} 🃏</span>
          </button>
        `).join('')}
      </div>
    `;

    modal.querySelectorAll('.opponent-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedOpponent = opponents.find(p => p.id === btn.dataset.id);
        renderStep2();
      });
    });
  }

  function renderStep2() {
    modal.querySelector('.modal-body').innerHTML = `
      <h3 class="modal-step-title">Step 2: Pick a half-suit</h3>
      <p class="modal-step-sub">Asking <strong>${selectedOpponent.username}</strong></p>
      <div class="halfsuit-grid">
        ${availableHalfSuits.map(hs => `
          <button class="halfsuit-btn" data-hs="${hs}">
            ${HALF_SUIT_NAMES[hs] ?? hs}
          </button>
        `).join('')}
      </div>
      <button class="btn btn-ghost modal-back-btn">← Back</button>
    `;

    modal.querySelectorAll('.halfsuit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedHalfSuit = btn.dataset.hs;
        renderStep3();
      });
    });
    modal.querySelector('.modal-back-btn').addEventListener('click', renderStep1);
  }

  function renderStep3() {
    // Cards in chosen half-suit that the player does NOT hold
    const hsGroups = groupByHalfSuit(hand);
    const heldInSuit = hsGroups[selectedHalfSuit] ?? [];
    const allInSuit = getCardsInHalfSuit(selectedHalfSuit);
    const askableCards = allInSuit.filter(c => !heldInSuit.includes(c));

    modal.querySelector('.modal-body').innerHTML = `
      <h3 class="modal-step-title">Step 3: Pick a card to ask for</h3>
      <p class="modal-step-sub">
        Asking <strong>${selectedOpponent.username}</strong> for a card in
        <strong>${HALF_SUIT_NAMES[selectedHalfSuit] ?? selectedHalfSuit}</strong>
      </p>
      <div class="cards-pick-row">
        ${askableCards.map(c => `
          <button class="card-pick-btn" data-card="${c}">${cardHtml(c)}</button>
        `).join('')}
      </div>
      <button class="btn btn-ghost modal-back-btn">← Back</button>
    `;

    modal.querySelectorAll('.card-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.dataset.card;
        emit('ask-card', { instanceId, targetId: selectedOpponent.id, card });
        closeModal(modal);
      });
    });
    modal.querySelector('.modal-back-btn').addEventListener('click', renderStep2);
  }

  renderStep1();
  setupModalClose(modal);
}

function getCardsInHalfSuit(hsId) {
  const suits = { S: 'S', H: 'H', D: 'D', C: 'C' };
  const suit = hsId.slice(-1);
  const isLow = hsId.startsWith('low');
  const values = isLow ? ['2', '3', '4', '5', '6', '7'] : ['9', '10', 'J', 'Q', 'K', 'A'];
  return values.map(v => `${v}${suit}`);
}

function createModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">Ask for a Card</h2>
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
