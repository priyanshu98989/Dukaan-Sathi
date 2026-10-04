/**
 * Voice request handling.
 *
 * Flow: audio in -> Gemini (one call) -> validate -> decide -> MongoDB -> respond.
 * No database write happens until every check in `validateIntent` has passed and
 * confidence is at or above the threshold.
 */

import config from '../config/env.js';
import InventoryItem from '../models/InventoryItem.js';
import { logger } from '../utils/logger.js';
import { AiError } from '../services/aiErrors.js';
import { transcribeAndExtract } from '../services/geminiService.js';
import { applyIntent, listLowStock, logVoiceAction, validateIntent } from '../services/inventoryService.js';
import { createPendingAction, consumePendingAction } from '../services/pendingActions.js';
import {
  ERRORS,
  FAILURE_CODES,
  INTENTS,
  confirmMessage,
  lowStockAlert,
  unclearQuantityMessage,
} from '../utils/messages.js';

const TAG = 'voice';

/** Strip the AI envelope down to the documented output contract. */
const contract = (ai) => ({
  intent: ai.intent,
  item: ai.item,
  quantity: ai.quantity,
  unit: ai.unit,
  confidence: ai.confidence,
});

/** Safest proposal when the spoken number could not be understood. */
function intentFallbackQuantity(intent, item) {
  if (!item) return 1;
  if (intent === INTENTS.SET_STOCK) return item.quantity;
  return item.lowStockThreshold > 0 ? item.lowStockThreshold : 1;
}

/**
 * Only these failures are safe to turn into a yes/no question.
 *
 * Everything else - an unknown item, an intent outside the three supported
 * ones, anything unrecognised - is rejected outright. Default-deny: a failure
 * code that is not on this list never reaches the confirmation flow.
 */
const ASKS_THE_SHOPKEEPER = new Set([
  FAILURE_CODES.INVALID_QUANTITY,
  FAILURE_CODES.INVALID_UNIT,
]);

/**
 * Build the pending-confirmation prompt.
 *
 * The browser receives an opaque id and the sentence to display. It cannot
 * influence what gets applied, because everything applied later is read back
 * out of the server-side pending store.
 *
 * Fallback for a quantity the AI could not make sense of:
 *   - SET_STOCK -> the item's current stock, so confirming is a harmless no-op
 *   - SALE      -> the item's low stock threshold, a small non-destructive figure
 * Either way the proposed number is shown to the shopkeeper and requires an
 * explicit "Haan" before anything is written.
 */
async function buildConfirmation(ai, transcript, validation, reason) {
  const canonicalName = validation?.item?.name || validation?.itemLabel || null;
  const item = canonicalName ? await InventoryItem.findOne({ name: canonicalName }).lean() : null;

  const unit = item?.unit || ai.unit || 'kg';

  const parsedQty = Number(ai.quantity);
  const hasUsableQty = Number.isFinite(parsedQty) && parsedQty > 0;
  const quantity = hasUsableQty
    ? parsedQty
    : intentFallbackQuantity(ai.intent, item);

  const confirmationId = createPendingAction(
    {
      intent: ai.intent,
      item: item?.name || ai.item,
      quantity,
      unit,
      confidence: ai.confidence,
      reason,
      hadUsableQuantity: hasUsableQty,
    },
    transcript,
    item?._id,
  );

  const name = item?.name || ai.item || 'item';
  let message = hasUsableQty
    ? confirmMessage({ item: name, quantity, unit, intent: ai.intent })
    : unclearQuantityMessage({ item: name, quantity, unit, intent: ai.intent });

  // Tell the shopkeeper why they are being asked, so "Haan" is an informed choice.
  if (reason === FAILURE_CODES.INVALID_UNIT && ai.unit) {
    message = `${name} ka stock ${unit} mein count hota hai. ${message}`;
  }

  return {
    status: 'needs_confirmation',
    confirmationId,
    reason,
    transcript,
    parsed: contract(ai),
    message,
  };
}

/** Shared tail: attach the current low-stock picture to any successful result. */
async function withLowStock(result) {
  const lowStockItems = await listLowStock();
  return {
    ...result,
    lowStockItems,
    lowStockMessage: lowStockItems.map((i) => lowStockAlert(i)),
  };
}

/**
 * POST /api/voice/process
 * multipart/form-data with an `audio` field.
 */
export async function processVoice(req, res) {
  let transcript = '';
  let ai = null;
  let lowStockAfter = false;

  try {
    const file = req.file;

    // ---- 1. did we actually get audio? ----
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      await logVoiceAction({
        transcript: '(no audio received)',
        intent: 'UNKNOWN',
        parsedData: {},
        success: false,
        message: ERRORS.NO_AUDIO,
        failureCode: FAILURE_CODES.NO_AUDIO,
      });
      return res.status(400).json({
        status: 'error',
        code: FAILURE_CODES.NO_AUDIO,
        message: ERRORS.NO_AUDIO,
      });
    }

    // ---- 2. transcribe + extract intent in one Gemini call ----
    try {
      ai = await transcribeAndExtract({ buffer: file.buffer, mimeType: file.mimetype });
    } catch (err) {
      const known = err instanceof AiError;
      const code = known ? err.code : FAILURE_CODES.GEMINI_FAILED;
      const message = known ? err.userMessage : ERRORS.GEMINI_FAILED;
      logger.warn(TAG, `ai failure code=${code}`, known ? err.detail : err?.message);

      await logVoiceAction({
        transcript: '(voice could not be understood)',
        intent: 'UNKNOWN',
        parsedData: {},
        success: false,
        message,
        failureCode: code,
      });
      return res.status(known && code === FAILURE_CODES.UNSUPPORTED_AUDIO ? 415 : 502).json({
        status: 'error',
        code,
        message,
      });
    }

    transcript = ai.transcript;

    // ---- 3. validate the AI output against the real database ----
    const validation = await validateIntent(ai);
    if (!validation.ok) {
      // Default-deny. Only a bad or missing *field* becomes a yes/no question.
      // An unknown item or an unsupported intent is a dead end and is rejected
      // outright - the AI must never create items or gain a new capability.
      if (!ASKS_THE_SHOPKEEPER.has(validation.code)) {
        await logVoiceAction({
          transcript,
          intent: ai.intent,
          parsedData: contract(ai),
          success: false,
          message: validation.message,
          failureCode: validation.code,
        });
        return res.status(200).json({
          status: 'error',
          code: validation.code,
          transcript,
          parsed: contract(ai),
          message: validation.message,
        });
      }

      // Spec: a missing or invalid field must not touch the database. Ask.
      const reason = validation.reason || validation.code;
      const pending = await buildConfirmation(ai, transcript, validation, reason);
      logger.info(TAG, `invalid field (${reason}) -> confirmation for ${ai.item}`);

      await logVoiceAction({
        transcript,
        intent: ai.intent,
        parsedData: contract(ai),
        success: false,
        message: pending.message,
        failureCode: reason,
      });
      return res.status(200).json(pending);
    }

    // ---- 4. confidence gate. Below threshold: ask, never write. ----
    const confidence = Number(ai.confidence);
    if (Number.isFinite(confidence) && confidence < config.confidenceThreshold) {
      const pending = await buildConfirmation(ai, transcript, validation, FAILURE_CODES.LOW_CONFIDENCE);
      logger.info(TAG, `low confidence ${confidence} -> confirmation for ${validation.itemName}`);

      await logVoiceAction({
        transcript,
        intent: ai.intent,
        parsedData: contract(ai),
        success: false,
        message: pending.message,
        failureCode: FAILURE_CODES.LOW_CONFIDENCE,
      });
      return res.status(200).json(pending);
    }

    // A write intent with no number at all still has to be confirmed, not applied.
    // (A CHECK_STOCK question legitimately has no number and is already handled
    // above, because it never writes.)
    if (
      ai.intent !== INTENTS.CHECK_STOCK &&
      (ai.quantity === null || ai.quantity === undefined)
    ) {
      const pending = await buildConfirmation(ai, transcript, validation, FAILURE_CODES.MISSING_FIELDS);
      await logVoiceAction({
        transcript,
        intent: ai.intent,
        parsedData: contract(ai),
        success: false,
        message: pending.message,
        failureCode: FAILURE_CODES.MISSING_FIELDS,
      });
      return res.status(200).json(pending);
    }

    // ---- 5. apply ----
    const result = await applyIntent(validation);

    if (result.status !== 'success') {
      await logVoiceAction({
        transcript,
        intent: ai.intent,
        parsedData: contract(ai),
        success: false,
        message: result.message,
        failureCode: result.code,
      });
      return res.status(result.code === FAILURE_CODES.DB_FAILED ? 500 : 200).json({
        status: 'error',
        code: result.code,
        transcript,
        parsed: contract(ai),
        message: result.message,
        item: result.item,
      });
    }

    lowStockAfter = Boolean(result.lowStock);
    const payload = await withLowStock({
      status: 'success',
      intent: result.intent,
      transcript,
      parsed: contract(ai),
      item: result.item,
      previousQuantity: result.previousQuantity,
      message: result.message,
      lowStock: result.lowStock,
      warning: result.lowStock ? lowStockAlert(result.item) : null,
    });

    // CHECK_STOCK writes no log entry as a "change", but the activity log should
    // still show what was asked.
    await logVoiceAction({
      transcript,
      intent: ai.intent,
      parsedData: contract(ai),
      success: true,
      message: result.message,
      lowStock: result.lowStock,
    });

    logger.info(TAG, `applied ${ai.intent} for ${validation.itemName}`);
    return res.status(200).json(payload);
  } catch (err) {
    logger.error(TAG, 'processVoice failed:', err?.message || err);
    if (transcript) {
      await logVoiceAction({
        transcript,
        intent: ai?.intent || 'UNKNOWN',
        parsedData: ai ? contract(ai) : {},
        success: false,
        message: ERRORS.DB_FAILED,
        failureCode: FAILURE_CODES.DB_FAILED,
      });
    }
    return res.status(500).json({
      status: 'error',
      code: FAILURE_CODES.DB_FAILED,
      message: ERRORS.DB_FAILED,
    });
  }
}

/**
 * POST /api/voice/confirm
 * Body: { confirmationId }
 *
 * The client sends nothing but the id. Everything else is re-read from the
 * server-side pending store and re-validated against the current stock.
 */
export async function confirmVoiceAction(req, res) {
  const confirmationId = typeof req.body?.confirmationId === 'string' ? req.body.confirmationId : '';

  if (!confirmationId) {
    return res.status(400).json({
      status: 'error',
      code: FAILURE_CODES.CONFIRMATION_NOT_FOUND,
      message: ERRORS.NOT_FOUND,
    });
  }

  const pending = consumePendingAction(confirmationId);
  if (!pending) {
    return res.status(404).json({
      status: 'error',
      code: FAILURE_CODES.CONFIRMATION_EXPIRED,
      message: 'Confirm karne ka waqt nikal gaya. Please dobara boliye.',
    });
  }

  const transcript = pending.transcript || '(confirmed action)';

  try {
    // Re-validate from scratch. The pending snapshot may be minutes old.
    const validation = await validateIntent({
      intent: pending.intent,
      item: pending.item,
      quantity: pending.quantity,
      unit: pending.unit,
      confidence: pending.confidence,
    });

    if (!validation.ok) {
      await logVoiceAction({
        transcript,
        intent: pending.intent,
        parsedData: {
          intent: pending.intent,
          item: pending.item,
          quantity: pending.quantity,
          unit: pending.unit,
          confidence: pending.confidence,
        },
        success: false,
        message: validation.message,
        failureCode: validation.code,
      });
      return res.status(200).json({
        status: 'error',
        code: validation.code,
        transcript,
        message: validation.message,
      });
    }

    const result = await applyIntent(validation);

    if (result.status !== 'success') {
      await logVoiceAction({
        transcript,
        intent: pending.intent,
        parsedData: {
          intent: pending.intent,
          item: pending.item,
          quantity: pending.quantity,
          unit: pending.unit,
          confidence: pending.confidence,
        },
        success: false,
        message: result.message,
        failureCode: result.code,
      });
      return res.status(result.code === FAILURE_CODES.DB_FAILED ? 500 : 200).json({
        status: 'error',
        code: result.code,
        transcript,
        message: result.message,
        item: result.item,
      });
    }

    await logVoiceAction({
      transcript,
      intent: pending.intent,
      parsedData: {
        intent: pending.intent,
        item: pending.item,
        quantity: pending.quantity,
        unit: pending.unit,
        confidence: pending.confidence,
      },
      success: true,
      message: result.message,
      lowStock: result.lowStock,
    });

    const payload = await withLowStock({
      status: 'success',
      intent: result.intent,
      confirmed: true,
      transcript,
      parsed: {
        intent: pending.intent,
        item: pending.item,
        quantity: pending.quantity,
        unit: pending.unit,
        confidence: pending.confidence,
      },
      item: result.item,
      previousQuantity: result.previousQuantity,
      message: result.message,
      lowStock: result.lowStock,
      warning: result.lowStock ? lowStockAlert(result.item) : null,
    });

    logger.info(TAG, `confirmed ${pending.intent} for ${validation.itemName}`);
    return res.status(200).json(payload);
  } catch (err) {
    logger.error(TAG, 'confirmVoiceAction failed:', err?.message || err);
    return res.status(500).json({
      status: 'error',
      code: FAILURE_CODES.DB_FAILED,
      message: ERRORS.DB_FAILED,
    });
  }
}

export { INTENTS };
