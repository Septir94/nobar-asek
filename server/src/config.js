/**
 * Centralized configuration — reads all values from environment variables.
 * Validates that required secrets are present at startup.
 */

const required = ['JWT_SECRET', 'TURN_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const config = {
  port: parseInt(process.env.PORT || '4000', 10),

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '5m',
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // TURN / coturn
  turn: {
    secret: process.env.TURN_SECRET,
    server: process.env.TURN_SERVER || 'turn:localhost:3478',
    realm: process.env.TURN_REALM || 'nobar.local',
    ttl: parseInt(process.env.TURN_CREDENTIAL_TTL || '86400', 10), // 24h default
  },

  // Room
  room: {
    ttl: parseInt(process.env.ROOM_TTL_SECONDS || '7200', 10), // 2h default
    maxMembers: parseInt(process.env.ROOM_MAX_MEMBERS || '4', 10),
    codeLength: 6,
  },
};

export default config;
