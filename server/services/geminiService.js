/**
 * AI layer. The ONLY place that talks to Gemini, and the ONLY place that knows
 * the Gemini key exists. The key is read from config and never leaves the server.
 *
 * Responsibility boundary (this is the important bit):
 *   Gemini  -> understands speech, returns {intent, item, quantity, unit, confidence}
 *   Backend -> decides what that means for inventory
 *
 * Gemini never decides stock levels, never decides whether a sale is legal and
 * never decides thresholds. Its output is treated as untrusted user input.
 */

import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import config from '../config/env.js';
import { logger } from '../utils/logger.js';
import { AiError, AI_ERRORS } from './aiErrors.js';
import { SEED_ITEMS } from './itemAliases.js';

const TAG = 'gemini';

/**
 * Audio containers Gemini is documented to accept. Anything else is rejected
 * before it costs a round trip.
 */
export const SUPPORTED_AUDIO_MIME = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp3',
  'audio/mpeg',
  'audio/aiff',
  'audio/x-aiff',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/x-flac',
]);

export function isSupportedAudioMime(mimeType) {
  if (!mimeType) return false;
  return SUPPORTED_AUDIO_MIME.has(String(mimeType).split(';')[0].trim().toLowerCase());
}

/** The only keys the AI is allowed to influence. Anything else is dropped. */
const AI_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    transcript: {
      type: 'string',
      description: 'The spoken words exactly as heard, in Roman-script Hinglish. No translation.',
    },
    intent: {
      type: 'string',
      enum: ['SALE', 'SET_STOCK', 'CHECK_STOCK'],
      description: 'Which inventory operation the shopkeeper asked for.',
    },
    item: {
      type: 'string',
      description: 'The item name spoken, as heard. Do not translate or correct it.',
    },
    quantity: {
      type: ['number', 'null'],
      description: 'The numeric quantity spoken. null when no number was spoken.',
    },
    unit: {
      type: 'string',
      description:
        'The measuring unit spoken, e.g. kg / kilo, litre / L, packet / packets. null if not spoken.',
    },
    confidence: {
      type: 'number',
      description: 'Your own confidence in this parse, from 0 to 1.',
    },
  },
  required: ['transcript', 'intent', 'item', 'quantity', 'unit', 'confidence'],
  propertyOrdering: ['transcript', 'intent', 'item', 'quantity', 'unit', 'confidence'],
  additionalProperties: false,
};

const CATALOGUE = SEED_ITEMS.map((i) => `${i.name} (${i.unit})`).join(', ');

const SYSTEM_INSTRUCTION = `You are the speech-understanding layer of "Dukaan Sathi", a voice inventory assistant for a small Indian kirana shop.

The shopkeeper speaks Hindi or Hinglish (Hindi written in Roman script). You do one job only: transcribe what was said and pull out a structured intent. You never decide inventory outcomes.

The shop currently stocks exactly these items: ${CATALOGUE}.

Choose exactly one intent:
- SALE - something left the shelf. "5 kilo aata bik gaya", "2 packet maggi bech diye", "tel 3 litre diya".
- SET_STOCK - a stock count being declared or corrected. "Maggi ke 3 packet bache hain", "aata 20 kilo hai", "sugar 15 kilo kar do".
- CHECK_STOCK - a question about how much is left. No change. "Aata kitna bacha hai?", "Maggi stock batao".

Rules:
- "item": the item as the shopkeeper said it. If they said something not in the stock list, still return what they said verbatim. Never invent an item, never correct it, never substitute a similar item.
- "quantity": a plain number. "5 kilo" -> 5. "ek kilo" -> 1. "aadha kilo" -> 0.5. "do packet" -> 2. Use null when no number was spoken at all, such as a pure CHECK_STOCK question.
- "unit": the unit as spoken, in English ("kg", "kilo", "litre", "packet", "packets"). Use null when no unit was spoken. For a pure CHECK_STOCK question with no unit, put the unit that item is normally measured in.
- "transcript": the words exactly as spoken, Roman script, no translation, no added punctuation at the end.
- "confidence": 0 to 1. Be honest. Use below 0.7 when the audio is unclear, the item is ambiguous, or you had to guess the number. Use 0.9 or above only when the audio was clear and the intent was unambiguous.`;

const REQUEST_TIMEOUT_MS = 30_000;

/** Defence in depth: the model output is validated again on our side. */
const AiEnvelopeSchema = z
  .object({
    transcript: z.string().min(1).max(500),
    // Deliberately NOT coerced to a valid intent. An intent outside the three
    // supported ones must surface as UNKNOWN_INTENT and be rejected downstream,
    // never silently rewritten into something the system will act on.
    intent: z.string().max(40).nullable().catch(null),
    item: z.string().max(120).catch(''),
    quantity: z
      .union([z.number(), z.null()])
      .nullable()
      .catch(null)
      .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)),
    unit: z.string().max(40).nullable().catch(null),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .catch(0)
      .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)),
  })
  .strict();

let client = null;

function getClient() {
  if (!client) {
    // Throws if the key is missing, so this stays server-side only.
    client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    logger.info(TAG, `client ready, model=${config.geminiModel}`);
  }
  return client;
}

/** Lets the test suite swap in a deterministic implementation. */
let override = null;

/** @param {null | ((args: {buffer: Buffer, mimeType: string}) => Promise<object>)} fn */
export function setAiOverride(fn) {
  override = fn;
}

function buildTimeoutSignal(ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  // Never keep the event loop alive just for the timeout.
  if (typeof timer.unref === 'function') timer.unref();
  return { signal: ac.signal, cancel: () => clearTimeout(timer) };
}

async function callGemini({ buffer, mimeType }) {
  const ai = getClient();
  const { signal, cancel } = buildTimeoutSignal(REQUEST_TIMEOUT_MS);

  try {
    return await ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: buffer.toString('base64'),
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseJsonSchema: AI_OUTPUT_SCHEMA,
        temperature: 0,
        abortSignal: signal,
      },
    });
  } finally {
    cancel();
  }
}

/**
 * Pull a JSON object out of the model response.
 * Tolerates the ```json fences and stray prose some models still emit.
 */
function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    const direct = JSON.parse(candidate);
    if (direct && typeof direct === 'object') return direct;
  } catch {
    // fall through to brace-slice recovery
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const recovered = JSON.parse(candidate.slice(start, end + 1));
      if (recovered && typeof recovered === 'object') return recovered;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Transcribe the audio and extract the structured intent in a single call.
 *
 * @param {{buffer: Buffer, mimeType: string}} args
 * @returns {Promise<{transcript: string, intent: string, item: string, quantity: number|null, unit: string|null, confidence: number}>}
 * @throws {AiError}
 */
export async function transcribeAndExtract({ buffer, mimeType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AiError(AI_ERRORS.NO_AUDIO, 'transcribeAndExtract: empty buffer');
  }

  if (override) {
    return override({ buffer, mimeType });
  }

  if (!isSupportedAudioMime(mimeType)) {
    throw new AiError(AI_ERRORS.UNSUPPORTED_AUDIO, `unsupported mime: ${mimeType}`);
  }

  let response;
  try {
    response = await callGemini({ buffer, mimeType });
  } catch (err) {
    if (err instanceof AiError) throw err;
    const name = err?.name || '';
    if (name === 'AbortError' || /abort/i.test(String(err?.message))) {
      throw new AiError(AI_ERRORS.GEMINI_TIMEOUT, `gemini timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    logger.error(TAG, 'generateContent failed:', err?.message || err);
    throw new AiError(AI_ERRORS.GEMINI_FAILED, String(err?.message || err));
  }

  if (response?.promptFeedback?.blockReason) {
    logger.warn(TAG, 'blocked by safety:', response.promptFeedback.blockReason);
    throw new AiError(AI_ERRORS.GEMINI_FAILED, `blocked: ${response.promptFeedback.blockReason}`);
  }

  const candidate = response?.candidates?.[0];
  const raw = typeof response?.text === 'string' ? response.text : undefined;

  if (!candidate || candidate.finishReason === 'SAFETY' || !raw) {
    throw new AiError(
      AI_ERRORS.GEMINI_FAILED,
      `empty response, finishReason=${candidate?.finishReason ?? 'none'}`,
    );
  }

  const json = extractJson(raw);
  if (!json) {
    logger.warn(TAG, 'model returned non-JSON:', raw.slice(0, 200));
    throw new AiError(AI_ERRORS.MALFORMED_RESPONSE, 'response was not a JSON object');
  }

  const parsed = AiEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn(TAG, 'schema validation failed:', parsed.error.issues.map((i) => i.path.join('.')));
    throw new AiError(AI_ERRORS.MALFORMED_RESPONSE, 'response did not match the output contract');
  }

  const value = parsed.data;
  logger.debug(TAG, 'parsed:', JSON.stringify(value));
  return value;
}

export function resetClient() {
  client = null;
  override = null;
}
