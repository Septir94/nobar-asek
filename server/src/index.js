/**
 * Server entry point.
 * Bootstraps Express + Socket.io, registers routes, and starts listening.
 */

import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import config from './config.js';
import roomRoutes from './routes/room.js';
import { registerSocketHandlers } from './socket/signaling.js';

const app = express();
const httpServer = createServer(app);

// --- Middleware ---
app.use(helmet());
app.use(cors());
app.use(express.json());

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Routes ---
app.use('/api/rooms', roomRoutes);

// --- Socket.io ---
// CORS_ORIGIN can be a single origin or comma-separated list.
// In development, fall back to permissive '*'.
const rawOrigin = process.env.CORS_ORIGIN;
let corsOrigin;
if (rawOrigin) {
  // Support comma-separated multiple origins e.g. "https://foo.com,https://bar.com"
  const origins = rawOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  corsOrigin = origins.length === 1 ? origins[0] : origins;
} else {
  // No CORS_ORIGIN set — allow all in dev, warn in production
  if (process.env.NODE_ENV === 'production') {
    console.warn('[server] WARNING: CORS_ORIGIN is not set in production! Allowing all origins — set CORS_ORIGIN in .env');
  }
  corsOrigin = '*';
}

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOrigin,
    credentials: corsOrigin !== '*',
    methods: ['GET', 'POST'],
  },
  // Allow polling fallback so proxies that don't support WS upgrades still work
  transports: ['polling', 'websocket'],
});

// --- Socket.io signaling ---
registerSocketHandlers(io);

// --- Start ---
httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${config.port}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   CORS origin: ${JSON.stringify(corsOrigin)}`);
});
