// Module-level reactive game state store

let state = {};
const listeners = new Set();

/**
 * Returns the current game state.
 */
export function getState() {
  return state;
}

/**
 * Merges newState into the current state and notifies all subscribers.
 */
export function updateState(newState) {
  state = { ...state, ...newState };
  for (const listener of listeners) {
    listener(state);
  }
}

/**
 * Subscribes a listener to state changes. Returns an unsubscribe function.
 */
export function onStateChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Resets the state to empty.
 */
export function resetState() {
  state = {};
  for (const listener of listeners) {
    listener(state);
  }
}
