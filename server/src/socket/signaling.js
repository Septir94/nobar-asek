/**
 * Socket.io signaling handler — Phase 2.
 *
 * Security model:
 * - Every connection MUST present a valid JWT in the auth handshake.
 * - Every event handler verifies sender is an active member of the room.
 * - Signal forwarding (offer/answer/ice) verifies both sender AND target are same-room members.
 *
 * In-memory room socket registry (socketRooms map) tracks {socketId → {roomCode, userId}}.
 * This supplements Redis room state with fast socket-level lookups.
 */

import { verifyTokenRaw } from '../middleware/auth.js';
import { joinRoom, removeUser, getRoom } from '../services/room.js';
import { generateTurnCredentials } from '../utils/turn.js';

// Map: socketId → { roomCode, userId, displayName }
const socketRooms = new Map();

/**
 * Returns all socket entries in a given room.
 * @param {string} roomCode
 * @returns {Array<{ socketId, userId, displayName }>}
 */
function getRoomSockets(roomCode) {
  const result = [];
  for (const [socketId, info] of socketRooms.entries()) {
    if (info.roomCode === roomCode) {
      result.push({ socketId, ...info });
    }
  }
  return result;
}

/**
 * Verify that a socket is a current member of a room.
 * @param {string} socketId
 * @param {string} roomCode
 * @returns {boolean}
 */
function isRoomMember(socketId, roomCode) {
  const info = socketRooms.get(socketId);
  return info?.roomCode === roomCode;
}

/**
 * Register Socket.io event handlers.
 * @param {import('socket.io').Server} io
 */
export function registerSocketHandlers(io) {
  // ── JWT Auth Middleware ──────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Missing auth token'));
    }

    try {
      const payload = verifyTokenRaw(token);
      socket.data.userId = payload.userId;
      socket.data.roomCode = payload.roomCode;
      socket.data.displayName = payload.displayName || 'Guest';
      socket.data.isHost = payload.isHost || false;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, roomCode, displayName, isHost } = socket.data;
    console.log(`[socket] Connected: ${socket.id} | user=${userId} | room=${roomCode}`);

    // ── join-room ──────────────────────────────────────────────────────────────
    // Client emits this immediately after connecting.
    socket.on('join-room', async (_, callback) => {
      try {
        // Re-validate room still exists and has capacity
        await joinRoom(roomCode, userId);

        // Register in socket map
        socketRooms.set(socket.id, { roomCode, userId, displayName });

        // Join socket.io room (for targeted broadcasts)
        socket.join(roomCode);

        // Get existing members (exclude current socket)
        const existing = getRoomSockets(roomCode)
          .filter((m) => m.socketId !== socket.id)
          .map((m) => ({ socketId: m.socketId, userId: m.userId, displayName: m.displayName }));

        // Send existing users to the new joiner → they will initiate offers
        socket.emit('existing-users', existing);

        // Broadcast to others that a new user joined
        socket.to(roomCode).emit('user-joined', {
          socketId: socket.id,
          userId,
          displayName,
        });

        // Generate TURN credentials for this user
        const iceServers = generateTurnCredentials(userId);

        if (callback) callback({ success: true, iceServers });
      } catch (err) {
        console.error('[socket] join-room error:', err.message);
        if (callback) callback({ error: err.message });
        socket.disconnect(true);
      }
    });

    // ── offer ─────────────────────────────────────────────────────────────────
    socket.on('offer', ({ targetSocketId, sdp }) => {
      if (!isRoomMember(socket.id, roomCode)) return;
      if (!isRoomMember(targetSocketId, roomCode)) return;

      io.to(targetSocketId).emit('offer', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromDisplayName: displayName,
        sdp,
      });
    });

    // ── answer ────────────────────────────────────────────────────────────────
    socket.on('answer', ({ targetSocketId, sdp }) => {
      if (!isRoomMember(socket.id, roomCode)) return;
      if (!isRoomMember(targetSocketId, roomCode)) return;

      io.to(targetSocketId).emit('answer', {
        fromSocketId: socket.id,
        sdp,
      });
    });

    // ── ice-candidate ─────────────────────────────────────────────────────────
    socket.on('ice-candidate', ({ targetSocketId, candidate }) => {
      if (!isRoomMember(socket.id, roomCode)) return;
      if (!isRoomMember(targetSocketId, roomCode)) return;

      io.to(targetSocketId).emit('ice-candidate', {
        fromSocketId: socket.id,
        candidate,
      });
    });

    // ── start-screen-share ────────────────────────────────────────────────────
    socket.on('start-screen-share', () => {
      if (!isRoomMember(socket.id, roomCode)) return;

      socket.to(roomCode).emit('start-screen-share', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromDisplayName: displayName,
      });
    });

    // ── stop-screen-share ─────────────────────────────────────────────────────
    socket.on('stop-screen-share', () => {
      if (!isRoomMember(socket.id, roomCode)) return;

      socket.to(roomCode).emit('stop-screen-share', {
        fromSocketId: socket.id,
      });
    });

    // ── camera-toggle ────────────────────────────────────────────────────────
    socket.on('camera-toggle', ({ cameraOn }) => {
      if (!isRoomMember(socket.id, roomCode)) return;
      if (typeof cameraOn !== 'boolean') return;

      socket.to(roomCode).emit('camera-toggle', {
        fromSocketId: socket.id,
        cameraOn,
      });
    });

    // ── send-reaction ───────────────────────────────────────────────────────
    const ALLOWED_REACTIONS = new Set(['clap', 'wow', 'laugh', 'heart', 'fire']);
    socket.on('send-reaction', ({ type }) => {
      if (!isRoomMember(socket.id, roomCode)) return;
      if (!ALLOWED_REACTIONS.has(type)) return;

      // Broadcast to entire room (including sender) so everyone sees it
      io.to(roomCode).emit('reaction', {
        fromSocketId: socket.id,
        fromDisplayName: displayName,
        type,
      });
    });

    // ── send-voice-sticker ───────────────────────────────────────────────────
    socket.on('send-voice-sticker', ({ text }) => {
      if (!isRoomMember(socket.id, roomCode)) return;
      if (typeof text !== 'string') return;

      // Sanitize: strip control characters, trim, enforce 50-char max
      const sanitized = text.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 50);
      if (!sanitized) return;

      // Broadcast to entire room including sender
      io.to(roomCode).emit('voice-sticker', {
        fromSocketId: socket.id,
        fromDisplayName: displayName,
        text: sanitized,
      });
    });

    // ── chat-message ──────────────────────────────────────────────────────────
    socket.on('chat-message', ({ text }) => {
      if (!isRoomMember(socket.id, roomCode)) return;
      if (typeof text !== 'string') return;

      // Trim and length-limit server-side (XSS sanitization is client-side on render)
      const sanitized = text.trim().slice(0, 1000);
      if (!sanitized) return;

      io.to(roomCode).emit('chat-message', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromDisplayName: displayName,
        text: sanitized,
        timestamp: Date.now(),
      });
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[socket] Disconnected: ${socket.id} (${reason})`);

      const memberInfo = socketRooms.get(socket.id);
      if (!memberInfo) return;

      const { roomCode: rc, userId: uid } = memberInfo;
      socketRooms.delete(socket.id);

      // Notify remaining peers
      socket.to(rc).emit('user-left', {
        socketId: socket.id,
        userId: uid,
      });

      // Remove from Redis
      try {
        await removeUser(rc, uid);
      } catch (err) {
        console.error('[socket] removeUser error:', err.message);
      }
    });
  });
}
