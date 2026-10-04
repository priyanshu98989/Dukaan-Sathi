/**
 * Inventory business logic.
 *
 * Nothing in this file trusts the AI. Every write goes through
 * `applyIntent`, which re-reads the item from MongoDB, re-checks the intent,
 * the unit and the quantity, and uses a conditional atomic update so a sale can
 * never drive stock below zero even if two voice commands land at once.
 */

import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.js';
import VoiceAction from '../models/VoiceAction.js';
import { logger } from '../utils/logger.js';
import { normaliseKey, resolveItemName, resolveUnit, speechSkeleton } from './itemAliases.js';
import { invalidateCatalogue } from './geminiService.js';
import { createItemSchema, explain, updateItemSchema } from '../validation/itemValidation.js';
import {
  FAILURE_CODES,
  INTENTS,
  duplicateItemMessage,
  insufficientStockMessage,
  itemNotFoundMessage,
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

/* ---------------------------------------------------------------------------
 * Add / edit / delete
 *
 * These are the only ways an inventory row is ever created or removed. The voice
 * layer still cannot do either: it can only name an item that is already here.
 * ------------------------------------------------------------------------ */

/**
 * A bad :id in the URL would make findById throw a CastError and surface as a
 * 500, so it is turned into the same clean 404 as a missing row.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
function isUsableId(id) {
  return typeof id === 'string' && mongoose.isValidObjectId(id);
}

/**
 * Case-insensitive duplicate guard.
 *
 * Checked in application code rather than relying on the unique index alone, so
 * the shopkeeper gets "Chawal already inventory mein hai" instead of a raw
 * E11000. The index still exists as the race-condition backstop - two taps on a
 * slow phone can pass this check at the same moment.
 *
 * @param {string} nameKey
 * @param {string|null} excludeId row being edited, which does not clash with itself
 */
async function findNameClash(nameKey, excludeId = null) {
  const clash = await InventoryItem.findOne({ nameKey }).select('_id').lean();
  if (!clash) return null;
  if (excludeId && String(clash._id) === String(excludeId)) return null;
  return clash;
}

const DUPLICATE_KEY_CODE = 11000;

/**
 * Add an item.
 *
 * @param {unknown} input raw request body
 * @returns {Promise<{ok: true, item: object} | {ok: false, code: string, message: string, status: number}>}
 */
export async function createItem(input) {
  const parsed = createItemSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: FAILURE_CODES.INVALID_ITEM,
      message: explain(parsed.error),
      status: 400,
    };
  }

  const { name, unit, quantity, lowStockThreshold } = parsed.data;
  const nameKey = normaliseKey(name);

  if (await findNameClash(nameKey)) {
    return {
      ok: false,
      code: FAILURE_CODES.DUPLICATE_ITEM,
      message: duplicateItemMessage(name),
      status: 409,
    };
  }

  try {
    const created = await InventoryItem.create({
      name,
      nameKey,
      unit,
      quantity,
      lowStockThreshold,
    });
    // The voice prompt's item list is now out of date.
    invalidateCatalogue();
    logger.info(TAG, `ADD_ITEM ${created.name} (${created.unit}), qty ${created.quantity}`);
    return { ok: true, item: toClientItem(created) };
  } catch (err) {
    // Lost the race against a concurrent insert, or against the index itself.
    if (err?.code === DUPLICATE_KEY_CODE) {
      return {
        ok: false,
        code: FAILURE_CODES.DUPLICATE_ITEM,
        message: duplicateItemMessage(name),
        status: 409,
      };
    }
    throw err;
  }
}

/**
 * Edit an item. Every field is optional, so correcting a quantity does not force
 * the shopkeeper to retype the name and unit.
 *
 * @param {unknown} id
 * @param {unknown} input raw request body
 * @returns {Promise<{ok: true, item: object} | {ok: false, code: string, message: string, status: number}>}
 */
export async function updateItem(id, input) {
  const parsed = updateItemSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: FAILURE_CODES.INVALID_ITEM,
      message: explain(parsed.error),
      status: 400,
    };
  }

  const patch = parsed.data;
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return {
      ok: false,
      code: FAILURE_CODES.INVALID_ITEM,
      message: 'Kuch badalne ke liye koi field nahi mili. Page refresh karein.',
      status: 400,
    };
  }

  if (!isUsableId(id)) {
    return { ok: false, code: FAILURE_CODES.ITEM_NOT_FOUND, message: itemNotFoundMessage(), status: 404 };
  }

  const current = await InventoryItem.findById(id).select('_id').lean();
  if (!current) {
    return { ok: false, code: FAILURE_CODES.ITEM_NOT_FOUND, message: itemNotFoundMessage(), status: 404 };
  }

  const update = {};

  if (patch.name !== undefined) {
    const nameKey = normaliseKey(patch.name);
    if (await findNameClash(nameKey, id)) {
      return {
        ok: false,
        code: FAILURE_CODES.DUPLICATE_ITEM,
        message: duplicateItemMessage(patch.name),
        status: 409,
      };
    }
    update.name = patch.name;
    // findByIdAndUpdate does not run document middleware, so nameKey - which the
    // pre('validate') hook would normally derive - is set explicitly here.
    update.nameKey = nameKey;
  }

  if (patch.unit !== undefined) update.unit = patch.unit;
  if (patch.quantity !== undefined) update.quantity = patch.quantity;
  if (patch.lowStockThreshold !== undefined) update.lowStockThreshold = patch.lowStockThreshold;

  try {
    const updated = await InventoryItem.findByIdAndUpdate(
      id,
      { $set: { ...update, updatedAt: new Date() } },
      { returnDocument: 'after', runValidators: true },
    );

    if (!updated) {
      return { ok: false, code: FAILURE_CODES.ITEM_NOT_FOUND, message: itemNotFoundMessage(), status: 404 };
    }

    invalidateCatalogue();
    logger.info(TAG, `EDIT_ITEM ${updated.name} (${updated.unit}), qty ${updated.quantity}`);
    return { ok: true, item: toClientItem(updated) };
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_CODE) {
      return {
        ok: false,
        code: FAILURE_CODES.DUPLICATE_ITEM,
        message: duplicateItemMessage(patch.name ?? ''),
        status: 409,
      };
    }
    throw err;
  }
}

/**
 * Delete an item.
 *
 * Any confirmation still waiting in the pending queue names this item; when it
 * is confirmed, applyIntent re-reads by name, finds nothing and returns
 * UNKNOWN_ITEM. So a delete cannot be followed by a stale write landing back.
 *
 * @param {unknown} id
 * @returns {Promise<{ok: true, item: object} | {ok: false, code: string, message: string, status: number}>}
 */
export async function deleteItem(id) {
  if (!isUsableId(id)) {
    return { ok: false, code: FAILURE_CODES.ITEM_NOT_FOUND, message: itemNotFoundMessage(), status: 404 };
  }

  const removed = await InventoryItem.findByIdAndDelete(id);
  if (!removed) {
    return { ok: false, code: FAILURE_CODES.ITEM_NOT_FOUND, message: itemNotFoundMessage(), status: 404 };
  }

  invalidateCatalogue();
  logger.info(TAG, `DELETE_ITEM ${removed.name}`);
  return { ok: true, item: toClientItem(removed) };
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
 * Find the inventory row a spoken item name refers to.
 *
 * Order matters and is the whole point:
 *
 *   1. the hand-written alias table, so every seeded spelling keeps working
 *      exactly as before ("aata" / "Aata" / "आटा" / "atta" -> Aata);
 *   2. an exact case-insensitive match on a stored item's name, which is what
 *      makes a freshly added item reachable by voice;
 *   3. a consonant-skeleton match, so the same item written in Devanagari
 *      resolves against a Latin name (and vice versa).
 *
 * Returns null when nothing matches. This never creates anything: a spoken name
 * that is not in the database stays an unknown item, which is the rule that keeps
 * a hallucination from inventing stock.
 *
 * @param {string} label spoken or AI-supplied item name
 * @returns {Promise<object|null>} a Mongoose document
 */
export async function resolveSpokenItem(label) {
  const text = typeof label === 'string' ? label.trim() : '';
  if (!text) return null;

  // 1. Seeded aliases first, so existing behaviour is untouched.
  const canonicalName = resolveItemName(text);
  if (canonicalName) {
    const seeded = await InventoryItem.findOne({ name: canonicalName });
    if (seeded) return seeded;
    // The alias pointed at a name the shop has since deleted. Keep going: the
    // shopkeeper may have re-added the same item under a different spelling.
  }

  // 2. Case-insensitive exact match on any stored item.
  const key = normaliseKey(text);
  if (key) {
    const exact = await InventoryItem.findOne({ nameKey: key });
    if (exact) return exact;
  }

  // 3. Cross-script match. A miss here is a miss, not a wrong answer - better to
  //    report an unknown item than to move the wrong stock.
  const wanted = speechSkeleton(text);
  if (wanted) {
    const docs = await InventoryItem.find().sort({ _id: 1 }).lean();
    const match = docs.find((d) => speechSkeleton(d.name) === wanted);
    if (match) return match;
  }

  return null;
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

  // --- the item must already exist. Alias table, then the database. ---
  const itemLabel = typeof ai?.item === 'string' ? ai.item.trim() : '';
  const item = itemLabel ? await resolveSpokenItem(itemLabel) : null;

  if (!item) {
    return {
      ok: false,
      code: FAILURE_CODES.UNKNOWN_ITEM,
      message: unknownItemMessage(itemLabel),
      itemLabel: itemLabel || null,
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
