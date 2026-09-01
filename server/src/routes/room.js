/**
 * Room API routes.
 *
 * POST /api/rooms       — Create a new room (returns roomCode)
 * POST /api/rooms/join  — Join a room (validates code, issues JWT)
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import config from '../config.js';
import { createRoom, joinRoom, getRoom } from '../services/room.js';

const router = Router();

// Rate-limit join attempts: max 5 per minute per IP
const joinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many join attempts. Please try again in a minute.' },
});

/**
 * POST /api/rooms
 * Body: { displayName?: string }
 * Response: { roomCode, userId }
 */
router.post('/', async (req, res) => {
  try {
    const { displayName } = req.body || {};
    const userId = crypto.randomUUID();

    const roomCode = await createRoom(userId);

    // Issue JWT for the host too
    const token = jwt.sign(
      { roomCode, userId, displayName: displayName || 'Host', isHost: true },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.status(201).json({ roomCode, userId, token });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

/**
 * POST /api/rooms/join
 * Body: { roomCode: string, displayName?: string }
 * Response: { token, userId, roomCode }
 */
router.post('/join', joinLimiter, async (req, res) => {
  try {
    const { roomCode, displayName } = req.body || {};

    if (!roomCode || typeof roomCode !== 'string') {
      return res.status(400).json({ error: 'roomCode is required' });
    }

    // Normalize to uppercase
    const code = roomCode.trim().toUpperCase();

    // Validate format: 6 chars alphanumeric
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid room code format' });
    }

    const userId = crypto.randomUUID();

    // joinRoom validates existence and capacity
    const room = await joinRoom(code, userId);

    const token = jwt.sign(
      { roomCode: code, userId, displayName: displayName || 'Guest', isHost: false },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({ token, userId, roomCode: code });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: 'Room not found. Check your room code.' });
    }
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    console.error('Join room error:', err);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

/**
 * GET /api/rooms/:code
 * Query room info (for debugging / future use).
 */
router.get('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await getRoom(code);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
      roomCode: code,
      memberCount: room.members.length,
      maxMembers: config.room.maxMembers,
      createdAt: room.createdAt,
    });
  } catch (err) {
    console.error('Get room error:', err);
    res.status(500).json({ error: 'Failed to get room info' });
  }
});

export default router;
