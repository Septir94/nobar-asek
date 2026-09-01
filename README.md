# Private Nobar

Private Nobar is a browser-based video room app for private, invite-only conversations. It uses WebRTC for peer-to-peer video/audio, Socket.IO for signaling, Redis for room state, and a TURN server for NAT traversal in real-world networking conditions.

## Features

- Create or join rooms with a short room code
- Secure room membership with JWT-based authentication
- WebRTC mesh connection between participants
- TURN/STUN support via coturn for reliable connectivity
- Chat, reactions, voice stickers, screen sharing, and camera toggles
- Dockerized deployment with Caddy reverse proxy

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express + Socket.IO
- Data store: Redis
- Media connectivity: coturn
- Proxy / TLS: Caddy
- Container orchestration: Docker Compose

## Project Structure

```text
.
├── client/                 # React frontend
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── server/                 # Express + Socket.IO backend
│   ├── src/
│   └── package.json
├── coturn/                 # TURN server config
├── caddy/                  # Caddy reverse proxy config
├── docker-compose.yml      # Local deployment stack
├── .env.example            # Example environment configuration
├── package.json            # Root scripts
└── README.md
```

## Requirements

- Node.js 18+ or newer
- npm
- Docker and Docker Compose (for containerized setup)
- A valid TURN secret and public server address for production deployments

## Local Development Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Update the values in `.env` as needed.

3. Install dependencies:

```bash
npm install
cd server && npm install
cd ../client && npm install
```

4. Start the backend and frontend in separate terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

The API server runs on port `4000` by default, and the Vite client runs on port `5173`.

## Docker Setup

This project includes a full Docker Compose stack for local or hosted deployment.

1. Create `.env` from `.env.example`.
2. Build and start the services:

```bash
npm run docker:up
```

3. Stop the stack when finished:

```bash
npm run docker:down
```

The stack includes:

- `server` — Express API and Socket.IO signaling service
- `client` — static frontend build served by Caddy
- `redis` — room metadata and membership tracking
- `coturn` — TURN server for ICE relay
- `caddy` — HTTPS reverse proxy and routing

## Environment Variables

| Variable | Purpose | Example |
| --- | --- | --- |
| `JWT_SECRET` | Secret used to sign room auth tokens | `change-me` |
| `JWT_EXPIRES_IN` | JWT lifetime | `5m` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `TURN_SECRET` | Shared secret for TURN auth | `change-me` |
| `TURN_SERVER` | TURN endpoint | `turn:your-server-ip:3478` |
| `TURN_REALM` | TURN realm | `nobar.local` |
| `ROOM_TTL_SECONDS` | Room lifetime in Redis | `7200` |
| `ROOM_MAX_MEMBERS` | Max members allowed in a room | `4` |
| `SITE_ADDRESS` | Caddy site host | `localhost` |

## API Overview

### Create a room

```http
POST /api/rooms
```

Returns a room code and JWT token for the host.

### Join a room

```http
POST /api/rooms/join
```

Accepts `{ roomCode, displayName }` and returns a JWT token for the joining user.

### Health check

```http
GET /api/health
```

Returns the server health status.

## Notes

- Room membership is stored in Redis and expires based on `ROOM_TTL_SECONDS`.
- Socket events are authenticated with JWTs before allowing signaling or room actions.
- TURN is required for broader client compatibility when peers are behind NATs or strict firewalls.
- The app is designed for local deployment or private hosting rather than public multi-tenant SaaS use.

## License

This project is provided as-is for educational and private deployment use.
