/**
 * JWT authentication middleware.
 * Verifies Bearer token from Authorization header.
 * Attaches decoded payload to req.user on success.
 */

import jwt from 'jsonwebtoken';
import config from '../config.js';

/**
 * Express middleware — verify JWT from Authorization header.
 */
export function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Verify a JWT token string directly (for Socket.io auth).
 * @param {string} token
 * @returns {object} decoded payload
 * @throws {Error} if invalid
 */
export function verifyTokenRaw(token) {
  return jwt.verify(token, config.jwt.secret);
}
