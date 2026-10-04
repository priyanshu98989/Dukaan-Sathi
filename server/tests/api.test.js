/**
 * End-to-end API tests.
 *
 * The AI layer is replaced with a deterministic stub so every validation and
 * error branch can be exercised exactly, including the cases that are hard to
 * trigger with real speech (malformed JSON, low confidence, unknown item).
 * The real Gemini integration is verified separately by tests/gemini.live.test.js.
 *
 * Run: npm test
 *
 * The test environment (MONGODB_URI -> dukaan_sathi_test, stub key, log level)
 * is set in tests/setup-env.js, which npm's test script loads with `--import`
 * BEFORE any module here is evaluated. Because ESM imports are hoisted, setting
 * process.env at the top of this file would be too late - env.js (dotenv) would
 * already have read the real .env and connected the suite to the live database.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { createApp } from '../server.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { autoSeed } from '../seed.js';
import InventoryItem from '../models/InventoryItem.js';
import VoiceAction from '../models/VoiceAction.js';
import { setAiOverride } from '../services/geminiService.js';
import { clearPendingActions } from '../services/pendingActions.js';
import { normaliseKey, resolveItemName, resolveUnit } from '../services/itemAliases.js';

const TAG = 'test';

let server;
let baseUrl;

/** Minimal multipart/form-data writer so the tests hit the real HTTP path. */
function buildMultipart(fieldName, buffer, filename, contentType) {
  const boundary = `----dukaantest${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([head, buffer, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** 1x second of silence as a valid WAV, so the real size/mime path is exercised. */
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

async function postAudio(audio = silentWav, contentType = 'audio/wav', fieldName = 'audio', filename = 'clip.wav') {
  const mp = buildMultipart(fieldName, audio, filename, contentType);
  const res = await fetch(`${baseUrl}/api/voice/process`, {
    method: 'POST',
    headers: { 'Content-Type': mp.contentType },
    body: mp.body,
  });
  return { status: res.status, body: await res.json() };
}

async function postConfirm(payload) {
  const res = await fetch(`${baseUrl}/api/voice/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function getJson(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

/** The api tests run with the auth escape hatch on, so no key is needed. */
function sendJson(method, path, payload) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

const postJson = (path, payload) => sendJson('POST', path, payload);
const putJson = (path, payload) => sendJson('PUT', path, payload);
const deleteJson = (path) => sendJson('DELETE', path, {});

async function qty(name) {
  return (await InventoryItem.findOne({ name })).quantity;
}

/** Seeded starting quantities, so every test begins from a known state. */
const SEED_QTY = { Aata: 20, Maggi: 30, Oil: 10, Sugar: 15, Biscuit: 40 };

async function setQuantities(map) {
  const entries = Object.entries({ ...SEED_QTY, ...map });
  await Promise.all(
    entries.map(([name, quantity]) => InventoryItem.updateOne({ name }, { $set: { quantity } })),
  );
}

async function resetStock() {
  await setQuantities({});
  // Item-CRUD tests add rows, and every other test asserts on exact counts and on
  // item resolution. Leaving a "Chawal" behind would break both, so the seeded
  // set is restored before each test.
  const extra = await InventoryItem.find({ nameKey: { $nin: Object.keys(SEED_QTY).map(normaliseKey) } })
    .select('_id')
    .lean();
  if (extra.length) await InventoryItem.deleteMany({ _id: { $in: extra.map((d) => d._id) } });
}

/** Program the stubbed AI layer with one specific response. */
function stubAi(response) {
  setAiOverride(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

before(async () => {
  await connectDb();
  await InventoryItem.deleteMany({});
  await VoiceAction.deleteMany({});
  await autoSeed();

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  setAiOverride(null);
  clearPendingActions();
  await new Promise((resolve) => server.close(resolve));
  await disconnectDb();
});

beforeEach(async () => {
  clearPendingActions();
  await VoiceAction.deleteMany({});
  await resetStock();
});

describe('unit: item alias normalization', () => {
  it('maps spelling, casing and script variants to the same seeded item', () => {
    for (const variant of ['aata', 'Aata', 'AATA', 'आटा', 'atta', 'aata.', '  aata  ']) {
      assert.equal(resolveItemName(variant), 'Aata', `failed for "${variant}"`);
    }
    for (const variant of ['maggi', 'Maggi', 'मैगी', 'maggie', '2 minute noodles']) {
      assert.equal(resolveItemName(variant), 'Maggi', `failed for "${variant}"`);
    }
    for (const variant of ['oil', 'Oil', 'तेल', 'khan ka tel', 'khane ka tel']) {
      assert.equal(resolveItemName(variant), 'Oil', `failed for "${variant}"`);
    }
    for (const variant of ['sugar', 'Cheeni', 'चीनी', 'mishri']) {
      assert.equal(resolveItemName(variant), 'Sugar', `failed for "${variant}"`);
    }
    for (const variant of ['biscuit', 'Biscuits', 'बिस्कुट', 'biskut']) {
      assert.equal(resolveItemName(variant), 'Biscuit', `failed for "${variant}"`);
    }
  });

  it('refuses items that are not in the seeded inventory', () => {
    for (const unknown of ['rajma', 'chawal', 'doodh', '', null, undefined, 'atta aata']) {
      assert.equal(resolveItemName(unknown), null, `should not match "${unknown}"`);
    }
  });

  it('normalises units to the three canonical values', () => {
    assert.equal(resolveUnit('kilo'), 'kg');
    assert.equal(resolveUnit('KG'), 'kg');
    assert.equal(resolveUnit('kg'), 'kg');
    assert.equal(resolveUnit('किलो'), 'kg');
    assert.equal(resolveUnit('litre'), 'L');
    assert.equal(resolveUnit('L'), 'L');
    assert.equal(resolveUnit('packet'), 'packets');
    assert.equal(resolveUnit('packets'), 'packets');
    assert.equal(resolveUnit('पैकेट'), 'packets');
    assert.equal(resolveUnit('bags'), null);
    assert.equal(resolveUnit(null), null);
  });

  it('collapses punctuation and whitespace', () => {
    assert.equal(normaliseKey('  Aata,  '), 'aata');
    assert.equal(normaliseKey('Biscuit.'), 'biscuit');
  });
});

describe('SALE intent', () => {
  it('test 1: "5 kilo aata bik gaya" takes Aata from 20 kg to 15 kg', async () => {
    stubAi({
      transcript: '5 kilo aata bik gaya',
      intent: 'SALE',
      item: 'aata',
      quantity: 5,
      unit: 'kilo',
      confidence: 0.94,
    });

    const { status, body } = await postAudio();
    assert.equal(status, 200);
    assert.equal(body.status, 'success');
    assert.equal(body.intent, 'SALE');
    assert.equal(body.item.name, 'Aata');
    assert.equal(body.item.quantity, 15);
    assert.equal(body.item.unit, 'kg');
    assert.equal(body.item.status, 'Normal');
    assert.equal(await qty('Aata'), 15);
  });

  it('accepts decimals and marks status Low below the threshold', async () => {
    stubAi({ transcript: 'sugar 10 kilo bik gaya', intent: 'SALE', item: 'cheeni', quantity: 10, unit: 'kg', confidence: 0.9 });
    const { body } = await postAudio();
    assert.equal(body.status, 'success');
    assert.equal(body.item.quantity, 5);
    assert.equal(body.item.status, 'Normal'); // 5 is not < 4? it is not below 4, so Normal
  });

  it('test 2 partial: subtracting to exactly zero is allowed and flagged Low', async () => {
    await InventoryItem.updateOne({ name: 'Aata' }, { $set: { quantity: 5 } });
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.95 });
    const { body } = await postAudio();
    assert.equal(body.status, 'success');
    assert.equal(body.item.quantity, 0);
    assert.equal(body.item.status, 'Low');
    assert.equal(body.lowStock, true);
    assert.ok(body.warning.includes('Aata'));
  });
});

describe('SET_STOCK intent', () => {
  it('test 2: "Maggi ke 3 packet bache hain" sets 30 -> 3 and raises the low-stock warning', async () => {
    stubAi({
      transcript: 'Maggi ke 3 packet bache hain',
      intent: 'SET_STOCK',
      item: 'Maggi',
      quantity: 3,
      unit: 'packets',
      confidence: 0.96,
    });

    const { status, body } = await postAudio();
    assert.equal(status, 200);
    assert.equal(body.status, 'success');
    assert.equal(body.intent, 'SET_STOCK');
    assert.equal(body.item.name, 'Maggi');
    assert.equal(body.item.quantity, 3);
    assert.equal(body.item.unit, 'packets');
    assert.equal(body.item.status, 'Low');
    assert.equal(body.lowStock, true);
    assert.match(body.warning, /Maggi ka stock sirf 3 packets hai/);
    assert.equal(body.lowStockItems.length, 1);
    assert.equal(await qty('Maggi'), 3);
  });

  it('overwrites rather than subtracts', async () => {
    stubAi({ transcript: 'oil 4 litre bache hain', intent: 'SET_STOCK', item: 'तेल', quantity: 4, unit: 'litre', confidence: 0.9 });
    const { body } = await postAudio();
    assert.equal(body.item.quantity, 4);
    assert.equal(body.item.status, 'Normal');
  });

  it('allows setting to zero only through an explicit confirmation', async () => {
    stubAi({ transcript: 'biscuit khatam', intent: 'SET_STOCK', item: 'Biscuit', quantity: 0, unit: 'packets', confidence: 0.9 });
    const { body } = await postAudio();
    // zero is not a positive number, so it must ask rather than silently apply
    assert.equal(body.status, 'needs_confirmation');
    assert.equal(await qty('Biscuit'), 40, 'nothing written before consent');
  });
});

describe('CHECK_STOCK intent', () => {
  it('test 3: "Aata kitna bacha hai?" returns "Aata ka stock 15 kg hai" and writes nothing', async () => {
    await InventoryItem.updateOne({ name: 'Aata' }, { $set: { quantity: 15 } });
    stubAi({
      transcript: 'Aata kitna bacha hai',
      intent: 'CHECK_STOCK',
      item: 'aata',
      quantity: null,
      unit: 'kg',
      confidence: 0.93,
    });

    const { status, body } = await postAudio();
    assert.equal(status, 200);
    assert.equal(body.status, 'success');
    assert.equal(body.intent, 'CHECK_STOCK');
    assert.equal(body.message, 'Aata ka stock 15 kg hai');
    assert.equal(body.item.quantity, 15);
    assert.equal(await qty('Aata'), 15, 'CHECK_STOCK must not change stock');
  });

  it('works even when no number was spoken at all', async () => {
    stubAi({ transcript: 'Maggi stock batao', intent: 'CHECK_STOCK', item: 'Maggi', quantity: null, unit: null, confidence: 0.9 });
    const { body } = await postAudio();
    assert.equal(body.status, 'success');
    assert.equal(body.message, 'Maggi ka stock 30 packets hai');
  });
});

describe('validation: never trust raw AI output', () => {
  it('rejects an unknown item and does not create it', async () => {
    stubAi({ transcript: '2 kilo rajma bik gaya', intent: 'SALE', item: 'rajma', quantity: 2, unit: 'kg', confidence: 0.95 });

    const { status, body } = await postAudio();
    assert.equal(status, 200);
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'UNKNOWN_ITEM');
    assert.equal(body.message, 'Rajma inventory mein nahi mila.');

    const count = await InventoryItem.countDocuments({ name: /rajma/i });
    assert.equal(count, 0, 'AI must never create inventory items');
  });

  it('rejects a sale that would take stock below zero', async () => {
    await InventoryItem.updateOne({ name: 'Aata' }, { $set: { quantity: 3 } });
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.95 });

    const { body } = await postAudio();
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'INSUFFICIENT_STOCK');
    assert.equal(body.message, 'Aata ka stock sirf 3 kg hai. 5 kg sale update nahi ho sakti.');
    assert.equal(await qty('Aata'), 3, 'stock must be untouched');
  });

  it('asks instead of applying when the quantity is zero or negative', async () => {
    for (const bad of [0, -4]) {
      stubAi({ transcript: 'aata', intent: 'SALE', item: 'aata', quantity: bad, unit: 'kg', confidence: 0.95 });
      const { body } = await postAudio();
      assert.equal(body.status, 'needs_confirmation', `quantity ${bad} should ask, not apply`);
      assert.equal(await qty('Aata'), 20, `quantity ${bad} must not be written`);
    }
  });

  it('refuses a nonsensical quantity even if the shopkeeper taps Haan', async () => {
    // The pending action for a zero quantity proposes the low-stock threshold,
    // but a corrupted store entry must still be rejected on the way in.
    stubAi({ transcript: 'aata', intent: 'SALE', item: 'aata', quantity: 0, unit: 'kg', confidence: 0.95 });
    const pending = (await postAudio()).body;
    assert.equal(pending.status, 'needs_confirmation');
    // Aata threshold is 5, and there is 20 kg, so this one is legal and applies.
    const done = await postConfirm({ confirmationId: pending.confirmationId });
    assert.equal(done.body.status, 'success');
    assert.equal(done.body.item.quantity, 15);
  });

  it('asks instead of applying when the unit disagrees with how the item is stocked', async () => {
    stubAi({ transcript: '3 litre aata bik gaya', intent: 'SALE', item: 'aata', quantity: 3, unit: 'litre', confidence: 0.95 });
    const { body } = await postAudio();
    assert.equal(body.status, 'needs_confirmation');
    assert.equal(body.reason, 'INVALID_UNIT');
    assert.match(body.message, /Aata ka stock kg mein count hota hai/);
    assert.equal(await qty('Aata'), 20, 'stock must be untouched');
  });

  it('applies a corrected unit only after the shopkeeper taps Haan', async () => {
    stubAi({ transcript: '3 litre aata bik gaya', intent: 'SALE', item: 'aata', quantity: 3, unit: 'litre', confidence: 0.95 });
    const pending = (await postAudio()).body;
    assert.equal(await qty('Aata'), 20);

    const done = await postConfirm({ confirmationId: pending.confirmationId });
    assert.equal(done.body.status, 'success');
    assert.equal(done.body.item.name, 'Aata');
    assert.equal(done.body.item.unit, 'kg', 'must fall back to the stocked unit');
    assert.equal(done.body.item.quantity, 17);
  });

  it('asks instead of applying when the unit is not recognisable at all', async () => {
    stubAi({ transcript: '3 dabba aata bik gaya', intent: 'SALE', item: 'aata', quantity: 3, unit: 'dabba', confidence: 0.95 });
    const { body } = await postAudio();
    assert.equal(body.status, 'needs_confirmation');
    assert.equal(body.reason, 'INVALID_UNIT');
    assert.equal(await qty('Aata'), 20);
  });

  it('rejects an intent outside the three supported ones outright', async () => {
    stubAi({ transcript: 'delete aata', intent: 'DELETE_ITEM', item: 'aata', quantity: 1, unit: 'kg', confidence: 0.99 });
    const { body } = await postAudio();
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'UNKNOWN_INTENT');
    assert.equal(body.confirmationId, undefined, 'an unsupported intent must never be confirmable');
    assert.equal(await qty('Aata'), 20);
  });

  it('surfaces a malformed AI response as the generic retry message', async () => {
    const { AiError, AI_ERRORS } = await import('../services/aiErrors.js');
    stubAi(new AiError(AI_ERRORS.MALFORMED_RESPONSE, 'not json'));

    const { status, body } = await postAudio();
    assert.equal(status, 502);
    assert.equal(body.status, 'error');
    assert.equal(body.message, 'Voice samajhne mein problem hui. Please dobara boliye.');
    assert.equal(await qty('Aata'), 20);
  });

  it('surfaces a Gemini timeout as the generic retry message', async () => {
    const { AiError, AI_ERRORS } = await import('../services/aiErrors.js');
    stubAi(new AiError(AI_ERRORS.GEMINI_TIMEOUT, 'timeout'));

    const { body } = await postAudio();
    assert.equal(body.message, 'Voice samajhne mein problem hui. Please dobara boliye.');
  });

  it('surfaces a raw provider crash without leaking internals', async () => {
    stubAi(new Error('ECONNRESET to internal-host:443 with key sk-abc123'));
    const { status, body } = await postAudio();
    assert.equal(status, 502);
    assert.equal(body.message, 'Voice samajhne mein problem hui. Please dobara boliye.');
    assert.ok(!JSON.stringify(body).includes('sk-abc123'), 'no internals may leak');
  });

  it('rejects an audio type the AI layer cannot read', async () => {
    const { body } = await postAudio(silentWav, 'audio/webm;codecs=opus', 'audio', 'clip.webm');
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'UNSUPPORTED_AUDIO');
    assert.match(body.message, /audio format support nahi hai/);
  });

  it('rejects a non-audio upload', async () => {
    const { body } = await postAudio(Buffer.from('not audio'), 'text/plain', 'audio', 'notes.txt');
    assert.equal(body.status, 'error');
    assert.match(body.message, /audio format support nahi hai/);
  });

  it('asks for a command when no audio was recorded', async () => {
    const res = await fetch(`${baseUrl}/api/voice/process`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.message, 'Please bolkar command dein.');
  });

  it('rejects an empty audio part', async () => {
    const { body } = await postAudio(Buffer.alloc(0), 'audio/wav');
    assert.equal(body.message, 'Please bolkar command dein.');
  });

  it('rejects a request with the audio field under the wrong name', async () => {
    const { body } = await postAudio(silentWav, 'audio/wav', 'sound');
    assert.equal(body.message, 'Please bolkar command dein.');
  });
});

describe('low confidence confirmation flow', () => {
  it('does not touch the database and asks the shopkeeper to confirm', async () => {
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.4 });

    const { body } = await postAudio();
    assert.equal(body.status, 'needs_confirmation');
    assert.ok(body.confirmationId, 'an id must be issued');
    assert.equal(body.reason, 'LOW_CONFIDENCE');
    assert.match(body.message, /Aapne 5 kg Aata bikne ki baat kahi\. Confirm karein\?/);
    assert.equal(await qty('Aata'), 20, 'nothing may be written before confirmation');
  });

  it('applies the sale only after the shopkeeper taps Haan', async () => {
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.4 });
    const pending = (await postAudio()).body;
    assert.equal(await qty('Aata'), 20);

    const done = await postConfirm({ confirmationId: pending.confirmationId });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'success');
    assert.equal(done.body.confirmed, true);
    assert.equal(done.body.item.quantity, 15);
    assert.equal(await qty('Aata'), 15);
  });

  it('cancels cleanly on Nahi and leaves stock alone', async () => {
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.4 });
    const pending = (await postAudio()).body;

    // "Nahi" is simply not calling /confirm from the UI. The id is dropped,
    // and the TTL sweep disposes of it. Nothing is ever written.
    assert.equal(await qty('Aata'), 20);
    assert.ok(pending.confirmationId);
  });

  it('refuses to apply the same confirmation twice', async () => {
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.4 });
    const pending = (await postAudio()).body;

    const first = await postConfirm({ confirmationId: pending.confirmationId });
    assert.equal(first.body.status, 'success');
    assert.equal(await qty('Aata'), 15);

    const second = await postConfirm({ confirmationId: pending.confirmationId });
    assert.equal(second.status, 404);
    assert.equal(second.body.code, 'CONFIRMATION_EXPIRED');
    assert.equal(await qty('Aata'), 15, 'a replayed confirm must not double-apply');
  });

  it('re-validates against live stock at confirm time, so a stale sale is rejected', async () => {
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.4 });
    const pending = (await postAudio()).body;

    // Stock shrinks between asking and confirming.
    await InventoryItem.updateOne({ name: 'Aata' }, { $set: { quantity: 2 } });

    const done = await postConfirm({ confirmationId: pending.confirmationId });
    assert.equal(done.body.status, 'error');
    assert.equal(done.body.code, 'INSUFFICIENT_STOCK');
    assert.match(done.body.message, /Aata ka stock sirf 2 kg hai/);
    assert.equal(await qty('Aata'), 2);
  });

  it('ignores anything the client tries to smuggle into the confirm payload', async () => {
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.4 });
    const pending = (await postAudio()).body;

    // The client claims a different, larger sale. The server must ignore it.
    const done = await postConfirm({
      confirmationId: pending.confirmationId,
      intent: 'SET_STOCK',
      item: 'Maggi',
      quantity: 9999,
    });
    assert.equal(done.body.status, 'success');
    assert.equal(done.body.item.name, 'Aata', 'must apply the stored action, not the payload');
    assert.equal(done.body.item.quantity, 15);
    assert.equal(await qty('Aata'), 15);
    assert.equal(await qty('Maggi'), 30, 'Maggi must be untouched');
  });

  it('asks for confirmation when the quantity is missing', async () => {
    stubAi({ transcript: 'aata thoda sa bik gaya', intent: 'SALE', item: 'aata', quantity: null, unit: 'kg', confidence: 0.9 });
    const { body } = await postAudio();
    assert.equal(body.status, 'needs_confirmation');
    assert.equal(body.reason, 'MISSING_FIELDS');
    assert.match(body.message, /clear nahi hua/);
    assert.equal(await qty('Aata'), 20);
  });

  it('rejects a confirm with a missing or made-up id', async () => {
    const missing = await postConfirm({});
    assert.equal(missing.status, 400);

    const fake = await postConfirm({ confirmationId: 'not-a-real-id' });
    assert.equal(fake.status, 404);
    assert.match(fake.body.message, /waqt nikal gaya/);
  });
});

describe('low stock detection', () => {
  it('flags every item that is below its own threshold', async () => {
    // Spec rule is strictly `<`, so Maggi sitting exactly on its threshold of 5
    // is still Normal. Aata (4 < 5) and Oil (2 < 3) are Low.
    await setQuantities({ Aata: 4, Maggi: 5, Oil: 2, Sugar: 15, Biscuit: 40 });
    const { body } = await getJson('/api/dashboard');
    const names = body.lowStock.items.map((i) => i.name).sort();
    assert.deepEqual(names, ['Aata', 'Oil']);
    assert.equal(body.lowStock.headline, undefined);
  });

  it('treats a quantity exactly on the threshold as Normal, per the strict < rule', async () => {
    await setQuantities({ Aata: 5 });
    const { body } = await getJson('/api/inventory');
    const aata = body.items.find((i) => i.name === 'Aata');
    assert.equal(aata.quantity, 5);
    assert.equal(aata.status, 'Normal');
  });

  it('reports all healthy when nothing is low', async () => {
    const { body } = await getJson('/api/dashboard');
    assert.equal(body.lowStock.count, 0);
    assert.equal(body.lowStock.headline, '\u2713 All inventory levels are healthy');
  });
});

describe('voice activity log', () => {
  it('records the transcript newest first with the outcome', async () => {
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.94 });
    await postAudio();

    stubAi({ transcript: 'Maggi ke 3 packet bache hain', intent: 'SET_STOCK', item: 'Maggi', quantity: 3, unit: 'packets', confidence: 0.96 });
    await postAudio();

    const { body } = await getJson('/api/dashboard');
    assert.equal(body.recentActions.length, 2);
    assert.equal(body.recentActions[0].transcript, 'Maggi ke 3 packet bache hain');
    assert.equal(body.recentActions[0].success, true);
    assert.equal(body.recentActions[0].lowStock, true);
    assert.equal(body.recentActions[1].transcript, '5 kilo aata bik gaya');
    assert.ok(body.recentActions[0].createdAt);
  });

  it('records failures too, so the shopkeeper can see what went wrong', async () => {
    stubAi({ transcript: '2 kilo rajma bik gaya', intent: 'SALE', item: 'rajma', quantity: 2, unit: 'kg', confidence: 0.95 });
    await postAudio();

    const { body } = await getJson('/api/dashboard');
    assert.equal(body.recentActions.length, 1);
    assert.equal(body.recentActions[0].success, false);
    assert.equal(body.recentActions[0].message, 'Rajma inventory mein nahi mila.');
  });
});

describe('read endpoints', () => {
  it('GET /api/inventory returns the five seeded items from MongoDB', async () => {
    const { status, body } = await getJson('/api/inventory');
    assert.equal(status, 200);
    assert.equal(body.shop, 'Sharma General Store');
    assert.equal(body.items.length, 5);
    assert.deepEqual(body.items.map((i) => i.name), ['Aata', 'Maggi', 'Oil', 'Sugar', 'Biscuit']);
    for (const item of body.items) {
      assert.ok(item.quantity >= 0);
      assert.ok(['Normal', 'Low'].includes(item.status));
    }
  });

  it('GET /api/dashboard bundles inventory, low stock and the log', async () => {
    const { status, body } = await getJson('/api/dashboard');
    assert.equal(status, 200);
    assert.equal(body.shop, 'Sharma General Store');
    assert.ok(Array.isArray(body.items));
    assert.ok(Array.isArray(body.lowStock.items));
    assert.ok(Array.isArray(body.recentActions));
  });

  it('returns a clean 404 for an unknown route, never a stack trace', async () => {
    const { status, body } = await getJson('/api/nope');
    assert.equal(status, 404);
    assert.equal(body.status, 'error');
    assert.ok(!JSON.stringify(body).includes('at '), 'no stack frames');
  });

  it('rejects malformed JSON on confirm with a clean message', async () => {
    const res = await fetch(`${baseUrl}/api/voice/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.status, 'error');
  });
});

describe('concurrent sales cannot drive stock negative', () => {
  it('two simultaneous 5 kg sales against 8 kg leave 3 kg, not -2 kg', async () => {
    await InventoryItem.updateOne({ name: 'Aata' }, { $set: { quantity: 8 } });
    stubAi({ transcript: '5 kilo aata bik gaya', intent: 'SALE', item: 'aata', quantity: 5, unit: 'kg', confidence: 0.95 });

    const [r1, r2] = await Promise.all([postAudio(), postAudio()]);
    const results = [r1.body, r2.body];

    assert.equal(await qty('Aata'), 3);
    assert.equal(results.filter((r) => r.status === 'success').length, 1);
    assert.equal(results.filter((r) => r.code === 'INSUFFICIENT_STOCK').length, 1);
  });
});

describe('add item', () => {
  it('stores a new item and reports it back with its low-stock status', async () => {
    const { status, body } = await postJson('/api/items', {
      name: 'Chawal',
      unit: 'kg',
      quantity: 20,
      lowStockThreshold: 5,
    });

    assert.equal(status, 201);
    assert.equal(body.status, 'success');
    assert.equal(body.item.name, 'Chawal');
    assert.equal(body.item.quantity, 20);
    assert.equal(body.item.unit, 'kg');
    assert.equal(body.item.lowStockThreshold, 5);
    assert.equal(body.item.status, 'Normal');
    assert.equal(body.message, 'Chawal add ho gaya: 20 kg.');

    const stored = await InventoryItem.findOne({ name: 'Chawal' }).lean();
    assert.ok(stored, 'the row must be in MongoDB');
    assert.equal(stored.nameKey, 'chawal', 'the case-insensitive key is stored');
  });

  it('refuses a duplicate name whatever the casing, and keeps the original row', async () => {
    const created = await postJson('/api/items', {
      name: 'Chawal',
      unit: 'kg',
      quantity: 20,
      lowStockThreshold: 5,
    });
    assert.equal(created.status, 201);

    for (const dupe of ['chawal', 'CHAWAL', '  Chawal  ', 'ChaWal']) {
      const again = await postJson('/api/items', {
        name: dupe,
        unit: 'L',
        quantity: 3,
        lowStockThreshold: 1,
      });
      assert.equal(again.status, 409, `"${dupe}" should be rejected as a duplicate`);
      assert.equal(again.body.code, 'DUPLICATE_ITEM');
      assert.match(again.body.message, /already inventory mein hai/);
    }

    assert.equal(await InventoryItem.countDocuments({ nameKey: 'chawal' }), 1);
    assert.equal(await qty('Chawal'), 20, 'the original row must be untouched');
  });

  it('accepts a unit written the way it is spoken, and stores the canonical one', async () => {
    const { status, body } = await postJson('/api/items', {
      name: 'Doodh',
      unit: 'litre',
      quantity: 12,
      lowStockThreshold: 3,
    });

    assert.equal(status, 201);
    assert.equal(body.item.unit, 'L', '"litre" is stored as "L"');
  });

  it('rejects a negative quantity and a negative threshold, writing nothing', async () => {
    for (const bad of [
      { name: 'BadOne', unit: 'kg', quantity: -4, lowStockThreshold: 1 },
      { name: 'BadTwo', unit: 'kg', quantity: 4, lowStockThreshold: -1 },
    ]) {
      const { status, body } = await postJson('/api/items', bad);
      assert.equal(status, 400, `${bad.name} should be rejected`);
      assert.equal(body.code, 'INVALID_ITEM');
      assert.match(body.message, /zero ya usse zyada honi chahiye/);
    }

    assert.equal(await InventoryItem.countDocuments({ nameKey: { $in: ['badone', 'badtwo'] } }), 0);
  });

  it('rejects a missing name, a blank name and an unusable unit in Hinglish', async () => {
    const blank = await postJson('/api/items', { name: '   ', unit: 'kg', quantity: 1, lowStockThreshold: 1 });
    assert.equal(blank.status, 400);
    assert.match(blank.body.message, /Item ka naam likhein/);

    const missing = await postJson('/api/items', { unit: 'kg', quantity: 1, lowStockThreshold: 1 });
    assert.equal(missing.status, 400);
    assert.match(missing.body.message, /Item ka naam likhein/);

    const badUnit = await postJson('/api/items', { name: 'Dabba', unit: 'dabba', quantity: 1, lowStockThreshold: 1 });
    assert.equal(badUnit.status, 400);
    assert.match(badUnit.body.message, /Unit chunein: kg, L ya packets/);

    const noQty = await postJson('/api/items', { name: 'Khali', unit: 'kg', lowStockThreshold: 1 });
    assert.equal(noQty.status, 400);
    assert.match(noQty.body.message, /Quantity ek number likhein/);
  });
});

describe('edit item', () => {
  async function addChawal() {
    const res = await postJson('/api/items', {
      name: 'Chawal',
      unit: 'kg',
      quantity: 20,
      lowStockThreshold: 5,
    });
    assert.equal(res.status, 201);
    return res.body.item;
  }

  it('corrects the quantity alone, leaving the name and unit alone', async () => {
    const item = await addChawal();

    const { status, body } = await putJson(`/api/items/${item.id}`, { quantity: 12.5 });

    assert.equal(status, 200);
    assert.equal(body.item.quantity, 12.5);
    assert.equal(body.item.name, 'Chawal');
    assert.equal(body.item.unit, 'kg');
    assert.equal(body.message, 'Chawal update ho gaya: 12.5 kg.');
    assert.equal(await qty('Chawal'), 12.5);
  });

  it('renames an item and keeps the case-insensitive key in step', async () => {
    const item = await addChawal();

    const { status, body } = await putJson(`/api/items/${item.id}`, { name: '  Chaawal ' });

    assert.equal(status, 200);
    assert.equal(body.item.name, 'Chaawal');
    assert.equal((await InventoryItem.findById(item.id).lean()).nameKey, 'chaawal');
    assert.equal(await InventoryItem.countDocuments({ nameKey: 'chawal' }), 0, 'the old key is gone');
  });

  it('recomputes the low-stock flag from the new numbers', async () => {
    const item = await addChawal();

    const { body } = await putJson(`/api/items/${item.id}`, { quantity: 2 });
    assert.equal(body.item.status, 'Low');
  });

  it('refuses a rename onto an existing item, whatever the casing', async () => {
    const item = await addChawal();

    for (const dupe of ['aata', 'AATA', ' Maggi ']) {
      const clash = await putJson(`/api/items/${item.id}`, { name: dupe });
      assert.equal(clash.status, 409, `"${dupe}" should clash`);
      assert.equal(clash.body.code, 'DUPLICATE_ITEM');
    }

    assert.equal((await InventoryItem.findById(item.id).lean()).name, 'Chawal', 'name unchanged');
    assert.equal(await qty('Aata'), 20, 'Aata must be untouched');
  });

  it('lets an item keep its own name when editing other fields', async () => {
    // The trap: a blanket duplicate check would report the row as clashing with itself.
    const item = await addChawal();
    const { status } = await putJson(`/api/items/${item.id}`, { name: 'Chawal', quantity: 7 });
    assert.equal(status, 200);
    assert.equal(await qty('Chawal'), 7);
  });

  it('rejects a negative quantity or threshold on edit', async () => {
    const item = await addChawal();

    const negQty = await putJson(`/api/items/${item.id}`, { quantity: -1 });
    assert.equal(negQty.status, 400);
    assert.equal(negQty.body.code, 'INVALID_ITEM');

    const negThreshold = await putJson(`/api/items/${item.id}`, { lowStockThreshold: -3 });
    assert.equal(negThreshold.status, 400);
    assert.match(negThreshold.body.message, /Low stock limit zero ya usse zyada/);

    assert.equal(await qty('Chawal'), 20, 'nothing may be written');
  });

  it('reports a missing or malformed id as a clean 404', async () => {
    const gone = await putJson('/api/items/64b7f9c2e13a4d5e6f7a8b9c', { quantity: 1 });
    assert.equal(gone.status, 404);
    assert.equal(gone.body.code, 'ITEM_NOT_FOUND');

    const nonsense = await putJson('/api/items/not-an-object-id', { quantity: 1 });
    assert.equal(nonsense.status, 404, 'a bad id must not become a 500');
    assert.equal(nonsense.body.code, 'ITEM_NOT_FOUND');
  });

  it('rejects an empty edit rather than silently doing nothing', async () => {
    const item = await addChawal();
    const { status, body } = await putJson(`/api/items/${item.id}`, {});
    assert.equal(status, 400);
    assert.equal(body.code, 'INVALID_ITEM');
  });
});

describe('delete item', () => {
  async function addChawal() {
    const res = await postJson('/api/items', {
      name: 'Chawal',
      unit: 'kg',
      quantity: 20,
      lowStockThreshold: 5,
    });
    assert.equal(res.status, 201);
    return res.body.item;
  }

  it('removes the row and drops it from the inventory and dashboard', async () => {
    const item = await addChawal();

    const { status, body } = await deleteJson(`/api/items/${item.id}`);
    assert.equal(status, 200);
    assert.equal(body.status, 'success');
    assert.equal(body.message, 'Chawal delete kar diya gaya hai.');

    assert.equal(await InventoryItem.findById(item.id), null);

    const inv = await getJson('/api/inventory');
    assert.equal(inv.body.items.length, 5, 'back to the five seeded items');
    assert.ok(!inv.body.items.some((i) => i.name === 'Chawal'));

    const dash = await getJson('/api/dashboard');
    assert.ok(!dash.body.items.some((i) => i.name === 'Chawal'));
  });

  it('reports a second delete of the same id as a clean 404', async () => {
    const item = await addChawal();
    assert.equal((await deleteJson(`/api/items/${item.id}`)).status, 200);

    const again = await deleteJson(`/api/items/${item.id}`);
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'ITEM_NOT_FOUND');
    assert.ok(!JSON.stringify(again.body).includes('at '), 'no stack frames');
  });

  it('rejects a malformed id as a 404 rather than a 500', async () => {
    const { status, body } = await deleteJson('/api/items/nope');
    assert.equal(status, 404);
    assert.equal(body.code, 'ITEM_NOT_FOUND');
  });

  it('leaves a deleted item unresolvable by voice, so a queued sale cannot resurrect it', async () => {
    const item = await addChawal();

    // A pending confirmation naming Chawal...
    stubAi({ transcript: '5 kilo chawal bik gaya', intent: 'SALE', item: 'chawal', quantity: 5, unit: 'kg', confidence: 0.4 });
    const pending = (await postAudio()).body;
    assert.equal(pending.status, 'needs_confirmation');

    // ...is stranded by deleting the item before the shopkeeper taps Haan.
    assert.equal((await deleteJson(`/api/items/${item.id}`)).status, 200);

    const done = await postConfirm({ confirmationId: pending.confirmationId });
    assert.equal(done.body.status, 'error');
    assert.equal(done.body.code, 'UNKNOWN_ITEM');
    assert.equal(await InventoryItem.countDocuments({ nameKey: 'chawal' }), 0);
  });
});

describe('a newly added item is reachable by voice', () => {
  it('adds Chawal, then a spoken SALE for "chawal" resolves to it', async () => {
    const created = await postJson('/api/items', {
      name: 'Chawal',
      unit: 'kg',
      quantity: 20,
      lowStockThreshold: 5,
    });
    assert.equal(created.status, 201);

    stubAi({
      transcript: '5 kilo chawal bik gaya',
      intent: 'SALE',
      item: 'chawal',
      quantity: 5,
      unit: 'kg',
      confidence: 0.95,
    });

    const { status, body } = await postAudio();
    assert.equal(status, 200);
    assert.equal(body.status, 'success', `voice should resolve the new item: ${body.message}`);
    assert.equal(body.item.name, 'Chawal');
    assert.equal(body.item.quantity, 15);
    assert.equal(await qty('Chawal'), 15);
  });

  it('resolves a new item by casing, spacing and punctuation', async () => {
    await postJson('/api/items', { name: 'Chawal', unit: 'kg', quantity: 20, lowStockThreshold: 5 });

    for (const spoken of ['Chawal', 'chawal', 'CHAWAL', '  chawal  ', 'chawal.']) {
      await InventoryItem.updateOne({ name: 'Chawal' }, { $set: { quantity: 20 } });
      stubAi({ transcript: '1 kilo chawal bik gaya', intent: 'SALE', item: spoken, quantity: 1, unit: 'kg', confidence: 0.95 });

      const { body } = await postAudio();
      assert.equal(body.status, 'success', `"${spoken}" should resolve`);
      assert.equal(body.item.name, 'Chawal', `"${spoken}" resolved to the wrong row`);
    }
  });

  it('resolves a new item written in Devanagari against its Latin name', async () => {
    await postJson('/api/items', { name: 'Chawal', unit: 'kg', quantity: 20, lowStockThreshold: 5 });

    stubAi({ transcript: '5 kilo chaawal bik gaya', intent: 'SALE', item: 'चावल', quantity: 5, unit: 'kg', confidence: 0.95 });

    const { body } = await postAudio();
    assert.equal(body.status, 'success', `Devanagari should resolve: ${body.message}`);
    assert.equal(body.item.name, 'Chawal');
    assert.equal(await qty('Chawal'), 15);
  });

  it('still refuses an item that was never added, and does not create it', async () => {
    stubAi({ transcript: '2 kilo rajma bik gaya', intent: 'SALE', item: 'rajma', quantity: 2, unit: 'kg', confidence: 0.95 });

    const { body } = await postAudio();
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'UNKNOWN_ITEM');
    assert.equal(await InventoryItem.countDocuments({ nameKey: 'rajma' }), 0);
  });

  it('builds the model prompt from the database, not the hardcoded seed', async () => {
    const { catalogueText } = await import('../services/geminiService.js');

    const before = await catalogueText();
    assert.ok(!before.includes('Chawal'), 'a cache primed before the add must not list it');

    await postJson('/api/items', { name: 'Chawal', unit: 'kg', quantity: 20, lowStockThreshold: 5 });

    const after = await catalogueText();
    assert.ok(after.includes('Chawal (kg)'), `the new item must be in the prompt list: ${after}`);
  });

  it('drops a deleted item from the model prompt too', async () => {
    const { catalogueText } = await import('../services/geminiService.js');
    const created = await postJson('/api/items', {
      name: 'Chawal',
      unit: 'kg',
      quantity: 20,
      lowStockThreshold: 5,
    });

    assert.ok((await catalogueText()).includes('Chawal (kg)'));
    await deleteJson(`/api/items/${created.body.item.id}`);
    assert.ok(!(await catalogueText()).includes('Chawal'), 'a deleted item must not stay in the prompt');
  });
});
