/**
 * Socket.io client singleton.
 * Connected lazily — not until the user enters a room.
 */

import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

let socket = null;

/**
 * Get (or create) the singleton socket, authenticated with a JWT token.
 * @param {string} token
 * @returns {import('socket.io-client').Socket}
 */
export function getSocket(token) {
  console.log("token", token);
  if (socket && socket.connected) return socket;

  if (socket) {
    socket.disconnect();
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    // Start with polling so the Socket.IO handshake succeeds even behind
    // proxies that need to see the initial HTTP request, then upgrade to WS.
    transports: ['polling', 'websocket'],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  return socket;
}

/**
 * Disconnect and clear the socket singleton.
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
