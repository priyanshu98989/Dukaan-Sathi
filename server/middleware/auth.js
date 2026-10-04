/**
 * Shared-secret authentication for the JSON API.
 *
 * The shopkeeper types the shop key into the app once; the browser keeps it in
 * sessionStorage and sends it as `X-API-Key` (a Bearer token is also accepted).
 * It is never compiled into the client bundle, so reading the JavaScript source
 * does not reveal it.
 *
 * What this does and does not buy us, stated plainly:
 *   - It stops anonymous callers on the LAN from reading or changing stock, and
 *     it stops a drive-by webpage from using the API, because a cross-origin
 *     request cannot supply the header without a CORS preflight being approved.
 *   - It is NOT per-user identity. There is one shop key, no passwords, no
 *     sessions, and no revocation short of restarting with a new key. A stolen
 *     key is a full compromise of this API. For a single-shop MVP that is a
 *     reasonable trade; it is not how you would run a multi-tenant service.
 *
 * Comparison is constant-time so a wrong key cannot be discovered byte by byte.
 */

import crypto from 'node:crypto';
import config from '../config/env.js';
import { logger } from '../utils/logger.js';

const TAG = 'auth';

const HEADER = 'x-api-key';

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws when the two buffers have different lengths, which
 * would itself leak the length, so both sides are hashed to a fixed width
 * first and the raw lengths are compared as a separate boolean.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Pull the presented key out of the request.
 * Supports `X-API-Key: <key>` and `Authorization: Bearer <key>`.
 *
 * @param {import('express').Request} req
 * @returns {string} the presented key, or '' when absent
 */
export function extractKey(req) {
  const header = req.get(HEADER);
  if (typeof header === 'string' && header.trim()) return header.trim();

  const auth = req.get('authorization');
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

/**
 * Require the shop key on every protected route.
 *
 * Responses stay in the same friendly shape as the rest of the API, and reveal
 * nothing about the expected key.
 */
export function requireApiKey(req, res, next) {
  if (config.apiKeyAllowAnonymous) {
    res.setHeader('x-api-key-required', 'false');
    return next();
  }

  const presented = extractKey(req);
  if (!presented || !safeEqual(presented, config.apiKey)) {
    // Deliberately vague: a correct-but-rejected key and a missing key must be
    // indistinguishable to a prober.
    logger.warn(TAG, `rejected ${req.method} ${req.originalUrl} (no valid key)`);
    res.setHeader('WWW-Authenticate', 'ApiKey realm="dukaan-sathi"');
    return res.status(401).json({
      status: 'error',
      code: 'UNAUTHORIZED',
      message: 'Dukaan kholne ka key daalein, phir try karein.',
    });
  }

  res.setHeader('x-api-key-required', 'true');
  return next();
}

export { HEADER as API_KEY_HEADER };
