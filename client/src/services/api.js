/**
 * API client — wrapper around fetch for backend communication.
 */

const API_URL = import.meta.env.VITE_API_URL || '';

async function request(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }

  return data;
}

/**
 * Create a new room.
 * @param {string} [displayName]
 * @returns {Promise<{ roomCode: string, userId: string, token: string }>}
 */
export async function createRoom(displayName) {
  return request('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
}

/**
 * Join an existing room.
 * @param {string} roomCode
 * @param {string} [displayName]
 * @returns {Promise<{ token: string, userId: string, roomCode: string }>}
 */
export async function joinRoom(roomCode, displayName) {
  return request('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify({ roomCode, displayName }),
  });
}
