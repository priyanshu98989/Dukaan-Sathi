/**
 * Server-side store for actions that need a yes/no confirmation.
 *
 * The browser is only ever told an opaque id. It never gets to say what the
 * pending action is, so confirming cannot be used to smuggle in a different
 * item, quantity or intent. Entries are single-use and expire.
 */

import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

const TAG = 'pending';
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 50;

/** @type {Map<string, object>} */
const store = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
  // Bound memory if the shopkeeper never confirms.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

/**
 * @param {object} parsed validated AI output
 * @param {string} transcript
 * @param {import('mongoose').Types.ObjectId} itemId
 * @returns {string} confirmation id
 */
export function createPendingAction(parsed, transcript, itemId) {
  sweep();
  const id = crypto.randomUUID();
  store.set(id, {
    id,
    transcript,
    intent: parsed.intent,
    item: parsed.item,
    itemId: itemId ? String(itemId) : null,
    quantity: parsed.quantity,
    unit: parsed.unit,
    confidence: parsed.confidence,
    reason: parsed.reason,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  });
  logger.debug(TAG, 'pending action created', { id, intent: parsed.intent, item: parsed.item });
  return id;
}

/**
 * Read a pending action WITHOUT removing it.
 * @param {string} id
 */
export function peekPendingAction(id) {
  sweep();
  return store.get(id) || null;
}

/**
 * Read and consume a pending action. Consuming on read means a double tap on
 * "Haan" can never apply the same sale twice.
 * @param {string} id
 */
export function consumePendingAction(id) {
  sweep();
  const entry = store.get(id);
  if (entry) store.delete(id);
  return entry || null;
}

export function clearPendingActions() {
  store.clear();
}

export function pendingCount() {
  sweep();
  return store.size;
}
