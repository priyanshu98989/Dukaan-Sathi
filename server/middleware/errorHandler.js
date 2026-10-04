/** Last-resort error handler. No stack trace ever reaches the client. */

import { logger } from '../utils/logger.js';
import { ERRORS } from '../utils/messages.js';

const TAG = 'error';

export function notFound(req, res) {
  return res.status(404).json({
    status: 'error',
    code: 'NOT_FOUND',
    message: ERRORS.NOT_FOUND,
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (res.headersSent) return;

  // Mongo down / timeout / write failure.
  const mongoCodes = [
    'MongoNetworkError',
    'MongoServerSelectionError',
    'MongooseServerSelectionError',
    'MongoNotConnectedError',
    'MongoTimeoutError',
    'WriteConflict',
  ];
  if (mongoCodes.includes(err?.name) || err?.name === 'MongooseError') {
    logger.error(TAG, 'database failure:', err?.message || err);
    return res.status(503).json({
      status: 'error',
      code: 'DB_FAILED',
      message: ERRORS.DB_FAILED,
    });
  }

  // Malformed JSON body from the browser.
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', code: 'BAD_JSON', message: ERRORS.INTERNAL });
  }

  logger.error(TAG, 'unhandled:', err?.message || err);
  if (process.env.LOG_LEVEL === 'debug') logger.error(TAG, err?.stack || '');

  return res.status(500).json({
    status: 'error',
    code: 'INTERNAL',
    message: ERRORS.INTERNAL,
  });
}
