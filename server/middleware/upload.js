/**
 * Audio upload handling.
 *
 * Audio is held in memory only (never written to disk), capped in size, and
 * restricted to audio MIME types. Anything unexpected is turned into the same
 * clear Hinglish message rather than a multer error object.
 */

import multer from 'multer';
import config from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ERRORS, FAILURE_CODES } from '../utils/messages.js';
import { isSupportedAudioMime } from '../services/geminiService.js';

const TAG = 'upload';

export const AUDIO_FIELD = 'audio';

const storage = multer.memoryStorage();

const ALLOWED_PREFIXES = ['audio/', 'video/webm', 'application/octet-stream'];

/** Reject with the same code the AI layer would use, so the UI sees one shape. */
function rejectUnsupported(reason) {
  const err = new Error(ERRORS.UNSUPPORTED_AUDIO);
  err.code = FAILURE_CODES.UNSUPPORTED_AUDIO;
  err.reason = reason;
  return err;
}

function fileFilter(_req, file, cb) {
  const mime = (file.mimetype || '').toLowerCase();

  const looksLikeAudio = ALLOWED_PREFIXES.some((p) => mime.startsWith(p));
  if (!looksLikeAudio) {
    logger.warn(TAG, 'rejected non-audio upload:', mime);
    return cb(rejectUnsupported('not audio'));
  }

  // `application/octet-stream` happens when a browser guesses poorly, so let it
  // through the prefix check and verify the real container below.
  if (mime !== 'application/octet-stream' && !isSupportedAudioMime(mime)) {
    logger.warn(TAG, 'audio container not supported by the AI layer:', mime);
    return cb(rejectUnsupported('container not readable by AI layer'));
  }

  return cb(null, true);
}

const uploader = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxAudioBytes,
    files: 1,
    fields: 4,
    parts: 6,
  },
});

/** Wraps multer so failures become clean, user-facing JSON. */
export function uploadAudio(req, res, next) {
  uploader.single(AUDIO_FIELD)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        logger.warn(TAG, 'upload too large');
        return res.status(413).json({
          status: 'error',
          code: 'AUDIO_TOO_LARGE',
          message: ERRORS.AUDIO_TOO_LARGE,
        });
      }
      logger.warn(TAG, 'multer error:', err.code);
      return res.status(400).json({
        status: 'error',
        code: err.code,
        message: ERRORS.NO_AUDIO,
      });
    }

    logger.warn(TAG, 'upload rejected:', err.message);
    return res.status(415).json({
      status: 'error',
      code: FAILURE_CODES.UNSUPPORTED_AUDIO,
      message: ERRORS.UNSUPPORTED_AUDIO,
    });
  });
}
