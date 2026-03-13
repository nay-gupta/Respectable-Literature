import { createGame } from './gameEngine.js';

// In-memory map of instanceId → gameState
const games = new Map();

// Stale game cleanup threshold: 2 hours
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/**
 * Gets an existing game by instance ID. Returns null if not found.
 */
export function getGame(instanceId) {
  return games.get(instanceId) ?? null;
}

/**
 * Gets an existing game or creates a new one if it doesn't exist.
 */
export function getOrCreateGame(instanceId) {
  if (!games.has(instanceId)) {
    games.set(instanceId, createGame(instanceId));
  }
  return games.get(instanceId);
}

/**
 * Deletes a game instance.
 */
export function deleteGame(instanceId) {
  games.delete(instanceId);
}

/**
 * Returns all active game instance IDs.
 */
export function listGames() {
  return Array.from(games.keys());
}

/**
 * Cleans up games that have been idle for more than STALE_THRESHOLD_MS.
 * A game is considered idle if it hasn't been updated since createdAt (for lobby games)
 * or finishedAt (for finished games).
 */
export function cleanupStaleGames() {
  const now = Date.now();
  for (const [instanceId, game] of games.entries()) {
    const referenceTime = game.finishedAt ?? game.startedAt ?? game.createdAt;
    if (now - referenceTime > STALE_THRESHOLD_MS) {
      console.log(`[GameManager] Cleaning up stale game: ${instanceId}`);
      games.delete(instanceId);
    }
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupStaleGames, 30 * 60 * 1000);
