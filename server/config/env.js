/** Reads and validates environment variables once, at import time. */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

function required(name, value) {
  if (!value || value.startsWith('your_')) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and set it.`,
    );
  }
  return value;
}

function num(name, value, fallback) {
  const parsed = Number(value);
  if (value === undefined || value === '' || Number.isNaN(parsed)) return fallback;
  return parsed;
}

const PORT = num('PORT', process.env.PORT, 5000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`PORT must be a valid port number, received "${process.env.PORT}"`);
}

// Shared secret that gates every /api route. The shopkeeper types it into the
// app once; it is held in sessionStorage on the client and never compiled into
// the bundle. Set API_KEY_ALLOW_ANONYMOUS=true only for local poking.
const API_KEY = String(process.env.API_KEY || '').trim();
const API_KEY_ALLOW_ANONYMOUS =
  String(process.env.API_KEY_ALLOW_ANONYMOUS || '').toLowerCase() === 'true';

if (!API_KEY && !API_KEY_ALLOW_ANONYMOUS) {
  throw new Error(
    'Missing required environment variable API_KEY. Generate one with `openssl rand -hex 24` ' +
      '(or `node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"`). ' +
      'Set API_KEY_ALLOW_ANONYMOUS=true to deliberately run without it.',
  );
}

const RATE_LIMIT_VOICE_MAX = num('RATE_LIMIT_VOICE_MAX', process.env.RATE_LIMIT_VOICE_MAX, 20);
const RATE_LIMIT_READ_MAX = num('RATE_LIMIT_READ_MAX', process.env.RATE_LIMIT_READ_MAX, 120);

/**
 * Where the database is.
 *
 * `MONGODB_URI` is the normal form and stays the only one you need locally. It
 * exists because a hosting platform can hand out the pieces of a connection
 * string separately but cannot concatenate them: Render's Blueprint can inject
 * another service's internal hostname via `fromService`, but it cannot turn
 * that into `mongodb://<host>:27017/<db>`. So `MONGODB_HOST` is accepted as an
 * alternative, and the URI is assembled here where it can actually be joined.
 *
 * `MONGODB_URI` wins if both are present, so an explicit URI is never silently
 * overridden by a hostname that happens to be in the environment too.
 */
const MONGO_HOST = String(process.env.MONGODB_HOST || '').trim();
const MONGO_PORT = num('MONGODB_PORT', process.env.MONGODB_PORT, 27017);
const MONGO_DB = String(process.env.MONGODB_DB || 'dukaan_sathi').trim();

function resolveMongoUri() {
  const explicit = String(process.env.MONGODB_URI || '').trim();
  if (explicit) return required('MONGODB_URI', explicit);
  if (MONGO_HOST) return `mongodb://${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}`;
  throw new Error(
    'Missing required environment variable MONGODB_URI. Set it to a full connection ' +
      'string, or set MONGODB_HOST (plus optionally MONGODB_PORT and MONGODB_DB) and it ' +
      'will be assembled for you.',
  );
}

export const config = {
  port: PORT,
  mongoUri: resolveMongoUri(),
  geminiApiKey: required('GEMINI_API_KEY', process.env.GEMINI_API_KEY),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  confidenceThreshold: num('CONFIDENCE_THRESHOLD', process.env.CONFIDENCE_THRESHOLD, 0.75),
  maxAudioBytes: num('MAX_AUDIO_BYTES', process.env.MAX_AUDIO_BYTES, 10 * 1024 * 1024),
  shopName: process.env.SHOP_NAME || 'Sharma General Store',
  nodeEnv: process.env.NODE_ENV || 'development',
  apiKey: API_KEY,
  apiKeyAllowAnonymous: API_KEY_ALLOW_ANONYMOUS,
  rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitVoiceMax: RATE_LIMIT_VOICE_MAX,
  rateLimitReadMax: RATE_LIMIT_READ_MAX,
};

if (config.confidenceThreshold <= 0 || config.confidenceThreshold >= 1) {
  throw new Error('CONFIDENCE_THRESHOLD must be between 0 and 1');
}

for (const [name, value] of [
  ['RATE_LIMIT_VOICE_MAX', RATE_LIMIT_VOICE_MAX],
  ['RATE_LIMIT_READ_MAX', RATE_LIMIT_READ_MAX],
]) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, received "${value}"`);
  }
}

export default config;
