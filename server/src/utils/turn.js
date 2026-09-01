/**
 * TURN credential generator — time-limited shared-secret mode.
 *
 * coturn validates credentials using HMAC-SHA1:
 *   username = "timestamp:userId"
 *   password = Base64(HMAC-SHA1(secret, username))
 *
 * The timestamp is a Unix epoch (seconds) representing when the credential expires.
 *
 * IMPORTANT: TURN_SERVER env var must be just "host:port" (e.g. "34.x.x.x:3478")
 * WITHOUT any protocol prefix. This function adds the correct turn: / turns: prefixes.
 */

import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Generate time-limited TURN credentials for a given user.
 * @param {string} userId
 * @returns {{ username: string, credential: string, urls: string[] }}
 */
export function generateTurnCredentials(userId) {
  const ttl = config.turn.ttl;
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiresAt}:${userId}`;

  const hmac = crypto.createHmac('sha1', config.turn.secret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  // Strip any accidental "turn:" prefix from the env var so we don't double-prefix
  const server = config.turn.server.replace(/^turns?:\/?\/?/, '');

  return {
    username,
    credential,
    urls: [
      `turn:${server}?transport=udp`,
      `turn:${server}?transport=tcp`,
      `turns:${server}?transport=tcp`, // TLS fallback — helps on restrictive networks
    ],
  };
}
