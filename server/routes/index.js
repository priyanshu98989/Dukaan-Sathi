import { Router } from 'express';
import mongoose from 'mongoose';
import voiceRoutes from './voiceRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';
import { requireApiKey } from '../middleware/auth.js';
import { createReadLimiter, createVoiceLimiter } from '../middleware/rateLimit.js';

/**
 * A factory, not a shared router instance, so every app gets its own rate-limit
 * counters and reads the configured limits at build time.
 */
export function createApiRoutes() {
  const router = Router();

  /**
   * Unauthenticated on purpose: a health check that needs a secret is a health
   * check nobody can run. It exposes only a liveness flag and uptime - no shop
   * data - so it is safe to leave open.
   */
  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'success',
      service: 'dukaan-sathi',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Everything below this line is the shop's data: gate it, then meter it.
  // Auth first, so an anonymous flood is rejected before it can spend a slot in
  // a legitimate shop's budget, and always before it reaches Gemini.
  router.use(requireApiKey);

  router.use('/voice', createVoiceLimiter(), voiceRoutes);
  router.use('/', createReadLimiter(), inventoryRoutes);

  return router;
}

export default createApiRoutes;
