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
// Allow the origin set via CORS_ORIGIN env (set by Docker/Caddy), or fall back
// to permissive '*' in development so the Vite proxy / direct connections work.
const corsOrigin =
  process.env.CORS_ORIGIN ||
  (process.env.NODE_ENV === 'production' ? 'https://localhost' : '*');

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
});
