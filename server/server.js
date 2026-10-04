/**
 * Dukaan Sathi API server.
 *
 * Serves the JSON API in development and, when a production build of the client
 * exists, also serves the built single-page app so the whole thing can run from
 * one process.
 */

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import config, { REPO_ROOT } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApiRoutes } from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/security.js';
import { autoSeed } from './seed.js';
import { logger } from './utils/logger.js';
import { ERRORS } from './utils/messages.js';

const TAG = 'server';

/**
 * Origins allowed to call the API.
 *
 * CLIENT_ORIGIN may be a comma-separated list, so a shop reachable at both
 * http://192.168.1.9:5000 and http://shop.local can allow both without a code
 * change. Reflecting arbitrary origins (the old `origin: true` in production)
 * is deliberately not done: it would let any webpage on the internet complete a
 * preflight against this API.
 */
function allowedOrigins() {
  const list = String(config.clientOrigin || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return list.length ? list : false;
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Before everything else, so even the 404 and the error handler emit them.
  app.use(securityHeaders());

  app.use(
    cors({
      origin: allowedOrigins(),
      // PUT / PATCH / DELETE are needed by the item edit and delete endpoints.
      // Without them a split deploy (Vercel frontend + Render API) fails the
      // preflight and the browser blocks the request before it is ever sent.
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // A custom auth header means every cross-origin call is preflighted, so
      // the allowlist is what actually decides who may talk to the API.
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'Accept'],
      exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 86400,
    }),
  );

  // Audio is multipart, so JSON is only needed for /api/voice/confirm.
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  app.use('/api', createApiRoutes());

  const clientDist = path.join(REPO_ROOT, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    logger.info(TAG, 'serving client build from client/dist');
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

async function start() {
  try {
    await connectDb();
  } catch (err) {
    // Do not start serving if there is no source of truth.
    logger.error(TAG, 'cannot reach MongoDB. Is it running?');
    logger.error(TAG, err?.message || err);
    process.exit(1);
  }

  await autoSeed();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(TAG, `Dukaan Sathi API listening on http://localhost:${config.port}`);
    logger.info(TAG, `shop: ${config.shopName}`);
    logger.info(TAG, `model: ${config.geminiModel}, confidence threshold: ${config.confidenceThreshold}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(TAG, `port ${config.port} is already in use.`);
      process.exit(1);
    }
    logger.error(TAG, 'server error:', err?.message || err);
  });

  const shutdown = async (signal) => {
    logger.info(TAG, `${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error(TAG, 'unhandled rejection:', reason?.message || reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error(TAG, 'uncaught exception:', err?.message || err);
    shutdown('uncaughtException');
  });

  return server;
}

// Only auto-start when run directly, so tests can import createApp.
const isDirectRun = process.argv[1] && process.argv[1].endsWith('server.js');
if (isDirectRun) {
  start().catch((err) => {
    logger.error(TAG, 'startup failed:', err?.message || err);
    process.exit(1);
  });
}

export { start, ERRORS };
