/**
 * Validation for the add / edit / delete item endpoints.
 *
 * Zod does the structural work; this file's second job is making sure the shop-
 * keeper never sees a Zod issue code. `explain` turns whatever Zod complained
 * about into one Hinglish sentence that says what to do next.
 *
 * No custom Zod error messages are used on purpose. Zod 4 renamed the parameter
 * (`message` -> `error`), and building the text here means the wording is one
 * place we control rather than spread across a dozen schema definitions.
 */

import { z } from 'zod';
import { resolveUnit } from '../services/itemAliases.js';
import { UNIT_CHOICES_HINGLISH } from '../utils/messages.js';

/** The only units the shop counts in. */
export const CANONICAL_UNITS = ['kg', 'L', 'packets'];

/**
 * Upper bound on any stock figure. Matches the guard in validateIntent, so a
 * number typed by hand can never be larger than one a voice command may produce.
 */
export const MAX_QUANTITY = 100000;

/** A name longer than this is not a kirana item, it is a mistake. */
export const MAX_NAME_LENGTH = 60;

/** 0 means "always flag it as Low", which is a legitimate choice. */
export const MIN_QUANTITY = 0;

/**
 * Accept a real number, or a numeric string from a form field.
 *
 * An empty or whitespace-only field becomes `undefined` rather than 0, because
 * `Number('')` is 0 and that would silently create an item with no stock when
 * the shopkeeper simply forgot to fill the box in.
 */
function preprocessNumeric(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    // A non-numeric string is passed through unchanged so the type check fails
    // and we can report "ek number likhein" instead of a cast error.
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  return value;
}

const quantityField = z
  .preprocess(preprocessNumeric, z.number())
  .refine((n) => Number.isFinite(n), { message: 'not-finite' })
  .refine((n) => n >= MIN_QUANTITY, { message: 'negative' })
  .refine((n) => n <= MAX_QUANTITY, { message: 'too-large' });

const thresholdField = z
  .preprocess(preprocessNumeric, z.number())
  .refine((n) => Number.isFinite(n), { message: 'not-finite' })
  .refine((n) => n >= MIN_QUANTITY, { message: 'negative' })
  .refine((n) => n <= MAX_QUANTITY, { message: 'too-large' });

const nameField = z
  .string()
  .trim()
  .min(1, { message: 'empty' })
  .max(MAX_NAME_LENGTH, { message: 'too-long' });

/**
 * Accepts "kg" / "kilo" / "किलो" and stores the canonical value, so the API is
 * forgiving about how the unit is written but the database only ever holds one
 * of the three. Anything unrecognised is passed through and fails the enum,
 * which produces a message that lists the choices.
 */
const unitField = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (CANONICAL_UNITS.includes(trimmed)) return trimmed;
  return resolveUnit(trimmed) ?? trimmed;
}, z.enum(CANONICAL_UNITS));

/** Every field required - used when creating an item. */
export const createItemSchema = z.object({
  name: nameField,
  unit: unitField,
  quantity: quantityField,
  lowStockThreshold: thresholdField,
});

/**
 * Every field optional - used when editing, so the shopkeeper can correct just
 * the quantity without retyping the name and unit.
 */
export const updateItemSchema = z.object({
  name: nameField.optional(),
  unit: unitField.optional(),
  quantity: quantityField.optional(),
  lowStockThreshold: thresholdField.optional(),
});

/* ---------------------------------------------------------------------------
 * Turning a Zod failure into something a shopkeeper can act on.
 * ------------------------------------------------------------------------ */

const NAME_ERRORS = {
  invalid_type: 'Item ka naam likhein.',
  empty: 'Item ka naam likhein.',
  'too-long': `Item ka naam ${MAX_NAME_LENGTH} characters se chhota rakhein.`,
  too_big: `Item ka naam ${MAX_NAME_LENGTH} characters se chhota rakhein.`,
};

const UNIT_ERRORS = {
  invalid_type: `Unit chunein: ${UNIT_CHOICES_HINGLISH}.`,
  invalid_value: `Unit chunein: ${UNIT_CHOICES_HINGLISH}.`,
  too_small: `Unit chunein: ${UNIT_CHOICES_HINGLISH}.`,
};

const QUANTITY_ERRORS = {
  invalid_type: 'Quantity ek number likhein, jaise 20 ya 2.5.',
  not_finite: 'Quantity ek number likhein, jaise 20 ya 2.5.',
  negative: 'Quantity zero ya usse zyada honi chahiye.',
  'too-large': `Quantity ${MAX_QUANTITY} se chhoti honi chahiye.`,
};

const THRESHOLD_ERRORS = {
  invalid_type: 'Low stock limit ek number likhein, jaise 5.',
  not_finite: 'Low stock limit ek number likhein, jaise 5.',
  negative: 'Low stock limit zero ya usse zyada honi chahiye.',
  'too-large': `Low stock limit ${MAX_QUANTITY} se chhoti honi chahiye.`,
};

const ERRORS_BY_FIELD = {
  name: NAME_ERRORS,
  unit: UNIT_ERRORS,
  quantity: QUANTITY_ERRORS,
  lowStockThreshold: THRESHOLD_ERRORS,
};

const FALLBACK_ERROR = 'Kuch galat ho gaya. Please dobara try karein.';

/**
 * One sentence per failed field, in the order the shopkeeper would fix them.
 *
 * @param {{issues: Array<{path?: Array<string|number>, code?: string, message?: string}>}} error
 * @returns {string}
 */
export function explain(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  if (issues.length === 0) return FALLBACK_ERROR;

  const messages = [];
  for (const issue of issues) {
    const field = Array.isArray(issue.path) ? String(issue.path[0] ?? '') : '';
    const table = ERRORS_BY_FIELD[field];
    // Zod puts our refine `message` in `message`, not `code`, so try both.
    const key = issue.message && table?.[issue.message] ? issue.message : issue.code;
    const friendly = table?.[key] ?? FALLBACK_ERROR;
    if (!messages.includes(friendly)) messages.push(friendly);
  }

  return messages.join(' ') || FALLBACK_ERROR;
}