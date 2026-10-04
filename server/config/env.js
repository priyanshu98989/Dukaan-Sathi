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

export const config = {
  port: PORT,
  mongoUri: required('MONGODB_URI', process.env.MONGODB_URI),
  geminiApiKey: required('GEMINI_API_KEY', process.env.GEMINI_API_KEY),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  confidenceThreshold: num('CONFIDENCE_THRESHOLD', process.env.CONFIDENCE_THRESHOLD, 0.75),
  maxAudioBytes: num('MAX_AUDIO_BYTES', process.env.MAX_AUDIO_BYTES, 10 * 1024 * 1024),
  shopName: process.env.SHOP_NAME || 'Sharma General Store',
  nodeEnv: process.env.NODE_ENV || 'development',
};

if (config.confidenceThreshold <= 0 || config.confidenceThreshold >= 1) {
  throw new Error('CONFIDENCE_THRESHOLD must be between 0 and 1');
}

export default config;
