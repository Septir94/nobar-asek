/**
 * Room service — abstracts Redis operations for room state.
 *
 * Redis data model:
 *   Key:   "room:<code>"
 *   Type:  Hash
 *   Fields:
 *     host      — userId of the room creator
 *     createdAt — ISO timestamp
 *     members   — JSON array of userId strings
 *   TTL:   config.room.ttl seconds
 */

import Redis from 'ioredis';
import { customAlphabet } from 'nanoid';
import config from '../config.js';

const redis = new Redis(config.redis.url);

// Alphanumeric uppercase, 6 characters (e.g. "A1B2C3")
const generateCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', config.room.codeLength);

/**
 * Create a new room. Returns the room code.
 * @param {string} hostId
 * @returns {Promise<string>} roomCode
 */
export async function createRoom(hostId) {
  // Generate unique code — retry if collision (extremely unlikely with 36^6 space)
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
    if (attempts > 10) throw new Error('Failed to generate unique room code');
  } while (await redis.exists(`room:${code}`));

  const roomData = {
    host: hostId,
    createdAt: new Date().toISOString(),
    members: JSON.stringify([hostId]),
  };

  const key = `room:${code}`;
  await redis.hset(key, roomData);
  await redis.expire(key, config.room.ttl);

  return code;
}

/**
 * Get room data by code. Returns null if room doesn't exist.
 * @param {string} code
 * @returns {Promise<object|null>}
 */
export async function getRoom(code) {
  const data = await redis.hgetall(`room:${code}`);
  if (!data || !data.host) return null;

  return {
    ...data,
    members: JSON.parse(data.members),
  };
}

/**
 * Add a user to a room. Returns the updated room or throws on error.
 * @param {string} code
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function joinRoom(code, userId) {
  const room = await getRoom(code);
  if (!room) {
    const err = new Error('Room not found');
    err.status = 404;
    throw err;
  }

  // Already a member? Allow reconnect
  if (room.members.includes(userId)) {
    return room;
  }

  if (room.members.length >= config.room.maxMembers) {
    const err = new Error(`Room is full (max ${config.room.maxMembers} members)`);
    err.status = 403;
    throw err;
  }

  room.members.push(userId);
  await redis.hset(`room:${code}`, 'members', JSON.stringify(room.members));

  return room;
}

/**
 * Remove a user from a room. Deletes the room if empty.
 * @param {string} code
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function removeUser(code, userId) {
  const room = await getRoom(code);
  if (!room) return;

  room.members = room.members.filter((id) => id !== userId);

  if (room.members.length === 0) {
    await redis.del(`room:${code}`);
  } else {
    await redis.hset(`room:${code}`, 'members', JSON.stringify(room.members));
  }
}

/**
 * Check if a room code is valid (exists in Redis).
 * @param {string} code
 * @returns {Promise<boolean>}
 */
export async function roomExists(code) {
  return (await redis.exists(`room:${code}`)) === 1;
}

export { redis };
