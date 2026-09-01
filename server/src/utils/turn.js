/**
 * TURN credential generator — time-limited shared-secret mode.
 *
 * coturn validates credentials using HMAC-SHA1:
 *   username = "timestamp:userId"
 *   password = Base64(HMAC-SHA1(secret, username))
 *
 * The timestamp is a Unix epoch (seconds) representing when the credential expires.
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

  return {
    username,
    credential,
    urls: [
      `turn:${config.turn.server}?transport=udp`,
      `turn:${config.turn.server}?transport=tcp`,
    ],
  };
}
