/**
 * Rate limiting.
 *
 * The two budgets are deliberately different because the endpoints cost wildly
 * different amounts:
 *
 *   - /api/voice/process makes one billable Gemini call per request, so it gets
 *     a tight budget. This is the actual defence against a runaway client loop
 *     or a bored attacker burning the shop's money.
 *   - the read endpoints hit MongoDB only, so they get a looser budget and stay
 *     out of the way of the dashboard refreshing after every voice command.
 *
 * These are factories, not shared singletons, so each app instance owns its own
 * counters and reads its own limits at construction time. A module-level
 * singleton would be shared by every app built in the same process, which makes
 * the limits depend on import order.
 *
 * Counters live in memory. That is correct for a single-process deployment and
 * resets on restart, which is the safe direction to fail.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import config from '../config/env.js';
import { logger } from '../utils/logger.js';

const TAG = 'ratelimit';

/**
 * Bucket for one caller.
 *
 * Behind a proxy every socket shares the proxy's address, so X-Forwarded-For is
 * the only way to tell callers apart. `ipKeyGenerator` is used rather than the
 * raw address because express-rate-limit requires IPv6 addresses to be folded
 * into a subnet - a single IPv6 host has enough addresses to walk past a limiter
 * that keys on the full string.
 */
function keyGenerator(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return ipKeyGenerator(forwarded.split(',')[0].trim());
  return ipKeyGenerator(req.ip || 'unknown');
}

function buildLimiter({ limit, name }) {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    // CORS preflight carries no credentials and must never be counted.
    skip: (req) => req.method === 'OPTIONS',
    handler: (req, res) => {
      logger.warn(TAG, `${name} limit hit by ${keyGenerator(req)}`);
      res.status(429).json({
        status: 'error',
        code: 'RATE_LIMITED',
        message:
          name === 'voice'
            ? 'Bahut zyada commands bhej diye. Thodi der rukein, phir try karein.'
            : 'Bahut zyada requests. Thodi der rukein, phir try karein.',
        retryAfterSeconds: Math.ceil(config.rateLimitWindowMs / 1000),
      });
    },
  });
}

/** Tight budget: every hit here can cost money. */
export function createVoiceLimiter() {
  return buildLimiter({ limit: config.rateLimitVoiceMax, name: 'voice' });
}

/** Loose budget: MongoDB reads only, so keep it out of the shopkeeper's way. */
export function createReadLimiter() {
  return buildLimiter({ limit: config.rateLimitReadMax, name: 'read' });
}
