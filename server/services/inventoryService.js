/**
 * Inventory business logic.
 *
 * Nothing in this file trusts the AI. Every write goes through
 * `applyIntent`, which re-reads the item from MongoDB, re-checks the intent,
 * the unit and the quantity, and uses a conditional atomic update so a sale can
 * never drive stock below zero even if two voice commands land at once.
 */

import InventoryItem from '../models/InventoryItem.js';
import VoiceAction from '../models/VoiceAction.js';
import { logger } from '../utils/logger.js';
import { resolveItemName, resolveUnit } from './itemAliases.js';
import {
  FAILURE_CODES,
  INTENTS,
  insufficientStockMessage,
  lowStockAlert,
  lowStockMessage,
  saleSuccessMessage,
  setStockSuccessMessage,
  stockMessage,
  unknownItemMessage,
} from '../utils/messages.js';

const TAG = 'inventory';

const toClientItem = (doc) => ({
  id: String(doc._id),
  name: doc.name,
  quantity: doc.quantity,
  unit: doc.unit,
  lowStockThreshold: doc.lowStockThreshold,
  status: doc.quantity < doc.lowStockThreshold ? 'Low' : 'Normal',
  updatedAt: doc.updatedAt,
});

const isLow = (doc) => doc.quantity < doc.lowStockThreshold;

/**
 * Coerce a value to a finite Number before it is ever used in a query or a
 * write. Returns null for anything that is not a real, finite number, which
 * callers treat as a validation failure.
 *
 * This is the call-site sanitisation that lets us keep `$gte` and friends in the
 * stock guard without turning on Mongoose's global `sanitizeFilter` (which would
 * rewrite those operators into `$eq` and break the negative-stock protection).
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function toSafeNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** All items, in a stable, human-friendly order. */
export async function listInventory() {
  const docs = await InventoryItem.find().sort({ _id: 1 }).lean();
  return docs.map((d) => ({ ...toClientItem(d), __v: undefined }));
}

/** Currently low items - the differentiating alert. */
export async function listLowStock() {
  const docs = await InventoryItem.find().sort({ _id: 1 }).lean();
  return docs.filter(isLow).map((d) => toClientItem(d));
}

/** Most recent voice actions first, for the activity log. */
export async function listRecentActions(limit = 15) {
  const docs = await VoiceAction.find().sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((d) => ({
    id: String(d._id),
    transcript: d.transcript,
    intent: d.intent,
    parsedData: d.parsedData || {},
    success: d.success,
    message: d.message || '',
    lowStock: d.lowStock,
    createdAt: d.createdAt,
  }));
}

/**
 * Resolve and validate the AI output. Does not write anything.
 *
 * @param {object} ai raw-ish parsed output (already schema-checked by the AI layer)
 * @returns {Promise<{ok: true, intent: string, item: object, itemName: string, unit: string, quantity: number|null, raw: object}
 *                 | {ok: false, code: string, message: string, itemLabel: string|null}>}
 */
export async function validateIntent(ai) {
  const intent = typeof ai?.intent === 'string' ? ai.intent.trim().toUpperCase() : '';

  if (!Object.values(INTENTS).includes(intent)) {
    return {
      ok: false,
      code: FAILURE_CODES.UNKNOWN_INTENT,
      message: unknownItemMessage(ai?.item),
      itemLabel: null,
    };
  }

  // --- item must exist in the seeded inventory. Never auto-create. ---
  const itemLabel = typeof ai?.item === 'string' ? ai.item.trim() : '';
  const canonicalName = itemLabel ? resolveItemName(itemLabel) : null;

  if (!canonicalName) {
    return {
      ok: false,
      code: FAILURE_CODES.UNKNOWN_ITEM,
      message: unknownItemMessage(itemLabel),
      itemLabel: itemLabel || null,
    };
  }

  const item = await InventoryItem.findOne({ name: canonicalName });
  if (!item) {
    return {
      ok: false,
      code: FAILURE_CODES.UNKNOWN_ITEM,
      message: unknownItemMessage(itemLabel),
      itemLabel,
    };
  }

  // --- unit must agree with how the item is stocked ---
  const resolvedUnit = resolveUnit(ai?.unit);

  if (intent === INTENTS.CHECK_STOCK) {
    // A read-only question rarely names a unit ("Maggi stock batao"). Fall back
    // to the unit the item is actually stocked in - it cannot be wrong, and a
    // missing unit must never block a harmless read.
    return {
      ok: true,
      intent,
      item: toClientItem(item),
      itemName: item.name,
      unit: item.unit,
      quantity: null,
      raw: ai,
    };
  }

  if (!resolvedUnit) {
    return {
      ok: false,
      code: FAILURE_CODES.INVALID_UNIT,
      reason: FAILURE_CODES.INVALID_UNIT,
      message: `${item.name} ka stock ${item.unit} mein count hota hai. Confirm karein?`,
      itemLabel: item.name,
    };
  }
  if (resolvedUnit !== item.unit) {
    return {
      ok: false,
      code: FAILURE_CODES.INVALID_UNIT,
      reason: FAILURE_CODES.INVALID_UNIT,
      message: `${item.name} ka stock ${item.unit} mein hai, ${resolvedUnit} mein nahi. Confirm karein?`,
      itemLabel: item.name,
    };
  }

  // --- quantity rules, which differ per intent ---
  const quantity = toSafeNumber(ai?.quantity);
  if (quantity === null) {
    return {
      ok: false,
      code: FAILURE_CODES.INVALID_QUANTITY,
      reason: FAILURE_CODES.MISSING_FIELDS,
      message: `${item.name} ke liye kitna batayein?`,
      itemLabel: item.name,
    };
  }
  if (quantity <= 0) {
    return {
      ok: false,
      code: FAILURE_CODES.INVALID_QUANTITY,
      reason: FAILURE_CODES.INVALID_QUANTITY,
      message: `${item.name} ke liye quantity zero ya usse zyada honi chahiye.`,
      itemLabel: item.name,
    };
  }
  // Guards against a nonsensical hallucinated figure eating the whole shelf.
  if (quantity > 100000) {
    return {
      ok: false,
      code: FAILURE_CODES.INVALID_QUANTITY,
      reason: FAILURE_CODES.INVALID_QUANTITY,
      message: `${item.name} ke liye quantity bahut badi lag rahi hai.`,
      itemLabel: item.name,
    };
  }

  return {
    ok: true,
    intent,
    item: toClientItem(item),
    itemName: item.name,
    unit: item.unit,
    quantity,
    raw: ai,
  };
}

/**
 * Apply a validated intent to MongoDB.
 *
 * Re-validates against the *current* database row, not against the copy the
 * caller was given, so a stale confirmation cannot resurrect old numbers.
 *
 * @param {{intent: string, itemName: string, quantity: number|null, unit: string, confidence: number}} validated
 * @returns {Promise<object>} result object for the API response
 */
export async function applyIntent(validated) {
  const { intent, itemName, unit } = validated;
  let { quantity } = validated;

  // Final defensive gate: a write intent must have a real, finite, positive
  // number. Nothing untrusted ever reaches a MongoDB filter.
  if (intent !== INTENTS.CHECK_STOCK) {
    const safeQty = toSafeNumber(quantity);
    if (safeQty === null || safeQty <= 0) {
      return {
        status: 'error',
        code: FAILURE_CODES.INVALID_QUANTITY,
        message: 'Quantity samajh nahi aayi. Please dobara boliye.',
      };
    }
    quantity = safeQty;
  }

  // Re-read from the database. The caller's copy may be stale.
  const current = await InventoryItem.findOne({ name: itemName });
  if (!current) {
    return {
      status: 'error',
      code: FAILURE_CODES.UNKNOWN_ITEM,
      message: unknownItemMessage(itemName),
    };
  }

  if (intent === INTENTS.CHECK_STOCK) {
    return {
      status: 'success',
      intent,
      item: toClientItem(current),
      message: stockMessage(current),
      lowStock: isLow(current),
      lowStockItems: isLow(current) ? [toClientItem(current)] : [],
    };
  }

  if (intent === INTENTS.SET_STOCK) {
    const updated = await InventoryItem.findOneAndUpdate(
      { _id: current._id, unit: current.unit },
      { $set: { quantity, updatedAt: new Date() } },
      { returnDocument: 'after', runValidators: true },
    );
    if (!updated) {
      return {
        status: 'error',
        code: FAILURE_CODES.DB_FAILED,
        message: 'Inventory update nahi ho paya. Please try again.',
      };
    }
    logger.info(TAG, `SET_STOCK ${updated.name}: ${current.quantity} -> ${updated.quantity} ${updated.unit}`);
    return {
      status: 'success',
      intent,
      item: toClientItem(updated),
      previousQuantity: current.quantity,
      message: setStockSuccessMessage(updated),
      lowStock: isLow(updated),
      lowStockItems: isLow(updated) ? [toClientItem(updated)] : [],
    };
  }

  if (intent === INTENTS.SALE) {
    // Atomic guard: the filter only matches while enough stock remains, so two
    // concurrent sales can never both succeed and drive the quantity negative.
    const updated = await InventoryItem.findOneAndUpdate(
      { _id: current._id, quantity: { $gte: quantity } },
      { $inc: { quantity: -quantity }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after', runValidators: true },
    );

    if (!updated) {
      // Either it was never enough, or it stopped being enough mid-flight.
      const latest = await InventoryItem.findOne({ _id: current._id });
      const available = latest ? latest.quantity : 0;
      const availableUnit = latest ? latest.unit : current.unit;
      return {
        status: 'error',
        code: FAILURE_CODES.INSUFFICIENT_STOCK,
        message: insufficientStockMessage(
          { name: current.name, quantity: available, unit: availableUnit },
          quantity,
        ),
        item: latest ? toClientItem(latest) : toClientItem(current),
      };
    }

    logger.info(TAG, `SALE ${updated.name}: ${current.quantity} -> ${updated.quantity} ${updated.unit}`);
    return {
      status: 'success',
      intent,
      item: toClientItem(updated),
      previousQuantity: current.quantity,
      message: saleSuccessMessage(updated, quantity, current.quantity),
      lowStock: isLow(updated),
      lowStockItems: isLow(updated) ? [toClientItem(updated)] : [],
    };
  }

  return {
    status: 'error',
    code: FAILURE_CODES.UNKNOWN_INTENT,
    message: unknownItemMessage(itemName),
  };
}

/** Write the activity-log row. Never throws into the request path. */
export async function logVoiceAction({
  transcript,
  intent,
  parsedData,
  success,
  message,
  lowStock = false,
  failureCode = '',
}) {
  try {
    await VoiceAction.create({
      transcript: String(transcript || '').slice(0, 500) || '(speech not recognised)',
      intent: Object.values(INTENTS).includes(intent) ? intent : 'UNKNOWN',
      parsedData: parsedData && typeof parsedData === 'object' ? parsedData : {},
      success: Boolean(success),
      message: String(message || '').slice(0, 300),
      lowStock: Boolean(lowStock),
      failureCode: String(failureCode || '').slice(0, 40),
    });
  } catch (err) {
    logger.error(TAG, 'failed to write VoiceAction log:', err?.message || err);
  }
}

/** Recompute low-stock for the whole shop after any change. */
export async function currentLowStock() {
  return listLowStock();
}

export { toClientItem, isLow, lowStockMessage, lowStockAlert };
