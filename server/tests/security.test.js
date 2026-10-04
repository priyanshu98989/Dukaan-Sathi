/**
 * Security tests: authentication, security headers, and rate limiting.
 *
 * These live in their own file because they need different middleware settings
 * from the business-logic suite. setup-env.js turns auth OFF and the rate limits
 * up so the main suite keeps testing inventory behaviour; here each test builds
 * a fresh app with the setting it wants to exercise, because a limiter captures
 * its limit when the router is constructed.
 *
 * The API key is a plain string on the shared config object, read per request,
 * so it can be flipped at runtime without re-importing anything.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server.js';
import { connectDb, disconnectDb } from '../config/db.js';
import config from '../config/env.js';
import { setAiOverride } from '../services/geminiService.js';

const GOOD_KEY = 'shop-key-for-tests-0123456789';
const OTHER_KEY = 'a-completely-different-key-98765';

/**
 * Boot an app on an ephemeral port with the given config overrides applied, and
 * hand back a stop() that puts the config back the way it was.
 */
async function startApp(overrides = {}) {
  const saved = { ...config };
  Object.assign(config, overrides);

  const app = createApp();
  const listener = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const { port } = listener.address();
  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => listener.close(resolve));
      Object.assign(config, saved);
    },
  };
}

/** Minimal multipart writer, so uploads hit the real HTTP path. */
function buildMultipart(fieldName, buffer, filename, contentType) {
  const boundary = `----dukaansec${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([head, buffer, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** 1 second of silence as a valid WAV. */
function makeSilentWav(ms = 300) {
  const sampleRate = 8000;
  const samples = Math.floor((sampleRate * ms) / 1000);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

const silentWav = makeSilentWav();

before(async () => {
  await connectDb();
  // A read-only intent, so no rate-limit test can mutate real test inventory.
  setAiOverride(async () => ({
    transcript: 'aata kitna bacha hai',
    intent: 'CHECK_STOCK',
    item: 'Aata',
    quantity: null,
    unit: 'kg',
    confidence: 0.95,
  }));
});

after(async () => {
  await disconnectDb();
});

describe('authentication', () => {
  let app;
  before(async () => {
    app = await startApp({ apiKey: GOOD_KEY, apiKeyAllowAnonymous: false });
  });
  after(async () => {
    await app.stop();
  });

  it('refuses the inventory with no key at all', async () => {
    const res = await fetch(`${app.url}/api/inventory`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('refuses a wrong key without hinting at the right one', async () => {
    const res = await fetch(`${app.url}/api/inventory`, {
      headers: { 'X-API-Key': OTHER_KEY },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
    // The rejection must not describe, or leak, the expected key.
    assert.ok(!JSON.stringify(body).includes(GOOD_KEY));
  });

  it('accepts the right key in the X-API-Key header', async () => {
    const res = await fetch(`${app.url}/api/inventory`, {
      headers: { 'X-API-Key': GOOD_KEY },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'success');
    assert.ok(Array.isArray(body.items));
  });

  it('accepts the right key as a Bearer token', async () => {
    const res = await fetch(`${app.url}/api/inventory`, {
      headers: { Authorization: `Bearer ${GOOD_KEY}` },
    });
    assert.equal(res.status, 200);
  });

  it('refuses a key that merely shares a prefix', async () => {
    const res = await fetch(`${app.url}/api/inventory`, {
      headers: { 'X-API-Key': GOOD_KEY.slice(0, -1) },
    });
    assert.equal(res.status, 401);
  });

  it('locks the write endpoints too, not just the reads', async () => {
    const mp = buildMultipart('audio', silentWav, 'clip.wav', 'audio/wav');
    const res = await fetch(`${app.url}/api/voice/process`, {
      method: 'POST',
      headers: { 'Content-Type': mp.contentType },
      body: mp.body,
    });
    assert.equal(res.status, 401);
  });

  it('locks confirm as well', async () => {
    const res = await fetch(`${app.url}/api/voice/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationId: 'made-up' }),
    });
    assert.equal(res.status, 401);
  });

  it('leaves /api/health open so monitoring needs no secret', async () => {
    const res = await fetch(`${app.url}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.service, 'dukaan-sathi');
    // It must not leak shop data.
    assert.equal(body.items, undefined);
  });

  it('advertises the scheme on a rejection so a browser can prompt', async () => {
    const res = await fetch(`${app.url}/api/inventory`);
    assert.match(String(res.headers.get('www-authenticate')), /ApiKey/);
  });
});

describe('authentication can be deliberately disabled', () => {
  let app;
  before(async () => {
    app = await startApp({ apiKey: '', apiKeyAllowAnonymous: true });
  });
  after(async () => {
    await app.stop();
  });

  it('lets a keyless caller through when the escape hatch is set', async () => {
    const res = await fetch(`${app.url}/api/inventory`);
    assert.equal(res.status, 200);
  });
});

describe('security headers', () => {
  let app;
  before(async () => {
    app = await startApp({ apiKey: GOOD_KEY, apiKeyAllowAnonymous: false });
  });
  after(async () => {
    await app.stop();
  });

  it('sends a content security policy that only allows this origin', async () => {
    const res = await fetch(`${app.url}/api/health`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'expected a CSP header');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    // Plain HTTP on a shop LAN: upgrading to https would break the app.
    assert.ok(!csp.includes('upgrade-insecure-requests'));
  });

  it('sets the usual hardening headers', async () => {
    const res = await fetch(`${app.url}/api/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('does not force HTTPS while the shop is on plain HTTP', async () => {
    const res = await fetch(`${app.url}/api/health`);
    assert.equal(res.headers.get('strict-transport-security'), null);
  });

  it('still sends headers on an error response, not only on success', async () => {
    const res = await fetch(`${app.url}/api/nope`);
    assert.equal(res.status, 401); // auth runs before the 404 handler
    assert.ok(res.headers.get('content-security-policy'));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('sends headers on the 404 too, once the caller is let in', async () => {
    const res = await fetch(`${app.url}/api/nope`, { headers: { 'X-API-Key': GOOD_KEY } });
    assert.equal(res.status, 404);
    assert.ok(res.headers.get('content-security-policy'));
  });

  it('serves the SPA shell itself without demanding a key', async () => {
    // The unlock screen has to load before anyone can type a key.
    const res = await fetch(`${app.url}/`);
    assert.ok(res.status === 200 || res.status === 404);
    assert.ok(res.headers.get('content-security-policy'));
  });
});

describe('rate limiting', () => {
  it('stops a burst of voice commands once the budget runs out', async () => {
    const app = await startApp({
      apiKey: GOOD_KEY,
      apiKeyAllowAnonymous: false,
      rateLimitVoiceMax: 3,
      rateLimitReadMax: 1000,
      rateLimitWindowMs: 60_000,
    });

    try {
      const post = async () => {
        const mp = buildMultipart('audio', silentWav, 'clip.wav', 'audio/wav');
        return fetch(`${app.url}/api/voice/process`, {
          method: 'POST',
          headers: { 'Content-Type': mp.contentType, 'X-API-Key': GOOD_KEY },
          body: mp.body,
        });
      };

      const first = await post();
      assert.equal(first.status, 200, 'the first request should be allowed');

      await post();
      await post();

      const blocked = await post();
      assert.equal(blocked.status, 429);

      const body = await blocked.json();
      assert.equal(body.status, 'error');
      assert.equal(body.code, 'RATE_LIMITED');
      assert.ok(body.message && body.message.length > 0);
    } finally {
      await app.stop();
    }
  });

  it('spends the voice budget only on voice, never on dashboard reads', async () => {
    const app = await startApp({
      apiKey: GOOD_KEY,
      apiKeyAllowAnonymous: false,
      rateLimitVoiceMax: 1,
      rateLimitReadMax: 50,
      rateLimitWindowMs: 60_000,
    });

    try {
      // Burn the single voice slot.
      const mp = buildMultipart('audio', silentWav, 'clip.wav', 'audio/wav');
      const voice = await fetch(`${app.url}/api/voice/process`, {
        method: 'POST',
        headers: { 'Content-Type': mp.contentType, 'X-API-Key': GOOD_KEY },
        body: mp.body,
      });
      assert.equal(voice.status, 200);

      // Reads must be unaffected.
      for (let i = 0; i < 10; i += 1) {
        const read = await fetch(`${app.url}/api/dashboard`, {
          headers: { 'X-API-Key': GOOD_KEY },
        });
        assert.equal(read.status, 200, `dashboard read ${i + 1} should not be rate limited`);
      }

      // The next voice command is refused.
      const mp2 = buildMultipart('audio', silentWav, 'clip.wav', 'audio/wav');
      const blocked = await fetch(`${app.url}/api/voice/process`, {
        method: 'POST',
        headers: { 'Content-Type': mp2.contentType, 'X-API-Key': GOOD_KEY },
        body: mp2.body,
      });
      assert.equal(blocked.status, 429);
    } finally {
      await app.stop();
    }
  });

  it('never lets an unauthenticated flood reach the model', async () => {
    const app = await startApp({
      apiKey: GOOD_KEY,
      apiKeyAllowAnonymous: false,
      rateLimitVoiceMax: 1000,
      rateLimitReadMax: 1000,
      rateLimitWindowMs: 60_000,
    });

    try {
      const mp = buildMultipart('audio', silentWav, 'clip.wav', 'audio/wav');
      for (let i = 0; i < 5; i += 1) {
        const res = await fetch(`${app.url}/api/voice/process`, {
          method: 'POST',
          headers: { 'Content-Type': mp.contentType },
          body: mp.body,
        });
        // Rejected on the key, before the limiter and before Gemini.
        assert.equal(res.status, 401);
      }
    } finally {
      await app.stop();
    }
  });
});
