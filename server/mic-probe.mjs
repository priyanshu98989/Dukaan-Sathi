/**
 * Live mic-path probe. Runs the server's real transcribeAndExtract() against a
 * WAV file, so it exercises the same key, model, audio decode and output-schema
 * validation that a browser recording goes through.
 *
 * Usage:  node <path-to-this-file> <audio-file> [mime]
 * Run it with cwd = server/ so dotenv picks up server/.env.
 */

import { readFileSync } from 'node:fs';
import config from './config/env.js';
import { transcribeAndExtract, isSupportedAudioMime } from './services/geminiService.js';
import { AiError } from './services/aiErrors.js';

const file = process.argv[2];
const mime = process.argv[3] || 'audio/wav';

if (!file) {
  console.error('usage: node mic-probe.mjs <audio-file> [mime]');
  process.exit(2);
}

console.log(`model      : ${config.geminiModel}`);
console.log(`key        : ${'*'.repeat(8)} (${config.geminiApiKey.length} chars, prefix "${config.geminiApiKey.slice(0, 4)}")`);
console.log(`audio      : ${file}`);
console.log(`mime       : ${mime} (ai-readable: ${isSupportedAudioMime(mime)})`);

const buffer = readFileSync(file);
console.log(`bytes      : ${buffer.length}`);
console.log('--- calling gemini ---');

try {
  const result = await transcribeAndExtract({ buffer, mimeType: mime });
  console.log('--- OK, output contract satisfied ---');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.log('--- FAILED ---');
  if (err instanceof AiError) {
    console.log(`AiError code : ${err.code}`);
    console.log(`userMessage : ${err.userMessage}`);
    console.log(`detail      : ${err.detail}`);
  } else {
    console.log(`raw error   : ${err?.message || err}`);
  }
  process.exit(1);
}