import { io } from "socket.io-client";

// Singleton Socket.io client
const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

/**
 * Connects the socket if not already connected.
 */
export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

/**
 * Emits an event with optional data.
 */
export function emit(event, data) {
  socket.emit(event, data);
}

export default socket;
