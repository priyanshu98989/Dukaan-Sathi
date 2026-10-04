/**
 * Test-environment bootstrap, loaded via `node --test --import ./tests/setup-env.js`.
 *
 * The environment variables MUST be set here, in a file that runs before any
 * ESM import pulls in config/env.js. Env.js reads `process.env` at module
 * evaluation time and so does the top-level `import 'dotenv/config'` in it.
 *
 * Setting MONGODB_URI at the top of api.test.js was ineffective: ES module
 * imports are hoisted and evaluated before the module body, so env.js had
 * already loaded the real .env URI and pointed the whole suite at the LIVE
 * `dukaan_sathi` database. Nothing in the suite belongs near real data.
 */

process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/dukaan_sathi_test';
process.env.GEMINI_API_KEY = 'test-key-not-used';
process.env.LOG_LEVEL = 'error';
process.env.CONFIDENCE_THRESHOLD = '0.75';

// The suite runs with auth switched OFF so the 46 existing tests keep exercising
// business logic rather than the lock screen. tests/api.test.js turns it back on
// for the dedicated security cases, which is the only place that matters.
process.env.API_KEY_ALLOW_ANONYMOUS = 'true';

// Generous, so the limiter never interferes with a test that is not about it.
process.env.RATE_LIMIT_VOICE_MAX = '10000';
process.env.RATE_LIMIT_READ_MAX = '10000';