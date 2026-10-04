/**
 * Typed AI-layer errors.
 *
 * `code` is for the backend log, `message` is the Hinglish string the shopkeeper
 * sees. Keeping them separate guarantees no provider error text leaks to the UI.
 */

import { ERRORS } from '../utils/messages.js';

export const AI_ERRORS = {
  NO_AUDIO: 'NO_AUDIO',
  UNSUPPORTED_AUDIO: 'UNSUPPORTED_AUDIO',
  AUDIO_TOO_LARGE: 'AUDIO_TOO_LARGE',
  GEMINI_FAILED: 'GEMINI_FAILED',
  GEMINI_TIMEOUT: 'GEMINI_TIMEOUT',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
};

const MESSAGES = {
  [AI_ERRORS.NO_AUDIO]: ERRORS.NO_AUDIO,
  [AI_ERRORS.UNSUPPORTED_AUDIO]: ERRORS.UNSUPPORTED_AUDIO,
  [AI_ERRORS.AUDIO_TOO_LARGE]: ERRORS.AUDIO_TOO_LARGE,
  [AI_ERRORS.GEMINI_FAILED]: ERRORS.GEMINI_FAILED,
  [AI_ERRORS.GEMINI_TIMEOUT]: ERRORS.GEMINI_FAILED,
  [AI_ERRORS.MALFORMED_RESPONSE]: ERRORS.GEMINI_FAILED,
};

export class AiError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || ERRORS.GEMINI_FAILED);
    this.name = 'AiError';
    this.code = code;
    this.userMessage = MESSAGES[code] || ERRORS.GEMINI_FAILED;
    this.detail = detail;
  }

  toClient() {
    return { code: this.code, message: this.userMessage };
  }
}
