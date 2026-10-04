/**
 * Every user-facing string in the app lives here.
 *
 * The shopkeeper must never see a stack trace, an HTTP status code or an English
 * technical message. Anything that reaches the screen is built from this file.
 */

/** Hard failures - the shopkeeper is stuck and needs to know what to do. */
export const ERRORS = {
  MIC_DENIED:
    'Microphone permission required. Please enable it in browser settings.',
  NO_AUDIO: 'Please bolkar command dein.',
  GEMINI_FAILED: 'Voice samajhne mein problem hui. Please dobara boliye.',
  UNSUPPORTED_AUDIO:
    'Is browser ka audio format support nahi hai. Please Chrome ya Edge use karein.',
  AUDIO_TOO_LARGE: 'Recording bahut lambi thi. Please chhoti recording dein.',
  DB_FAILED: 'Inventory update nahi ho paya. Please try again.',
  INTERNAL: 'Kuch galat ho gaya. Please dobara try karein.',
  NOT_FOUND: 'Yeh command nahi mili.',
};

/** The three supported intents. Nothing else is ever accepted. */
export const INTENTS = {
  SALE: 'SALE',
  SET_STOCK: 'SET_STOCK',
  CHECK_STOCK: 'CHECK_STOCK',
};

export const SUPPORTED_INTENTS = Object.values(INTENTS);

/** Quantity/unit as returned in the AI output contract. */
export const FAILURE_CODES = {
  NO_AUDIO: 'NO_AUDIO',
  UNSUPPORTED_AUDIO: 'UNSUPPORTED_AUDIO',
  AUDIO_TOO_LARGE: 'AUDIO_TOO_LARGE',
  GEMINI_FAILED: 'GEMINI_FAILED',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  UNKNOWN_INTENT: 'UNKNOWN_INTENT',
  MISSING_FIELDS: 'MISSING_FIELDS',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  INVALID_UNIT: 'INVALID_UNIT',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  UNKNOWN_ITEM: 'UNKNOWN_ITEM',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  DB_FAILED: 'DB_FAILED',
  CONFIRMATION_EXPIRED: 'CONFIRMATION_EXPIRED',
  CONFIRMATION_NOT_FOUND: 'CONFIRMATION_NOT_FOUND',
  INVALID_ITEM: 'INVALID_ITEM',
  DUPLICATE_ITEM: 'DUPLICATE_ITEM',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
};

/** 20 -> "20", 3.5 -> "3.5". Never "20.0". */
export function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}

/** 1 packet vs 3 packets. kg and L stay as they are. */
export function formatUnit(quantity, unit) {
  if (quantity === 1 && unit === 'packets') return 'packet';
  return unit;
}

/** 20 kg -> "20 kg" */
export function formatQtyWithUnit(quantity, unit) {
  return `${formatQty(quantity)} ${formatUnit(quantity, unit)}`;
}

/** "Aata ka stock 15 kg hai" - the CHECK_STOCK answer. */
export function stockMessage(item) {
  return `${item.name} ka stock ${formatQtyWithUnit(item.quantity, item.unit)} hai`;
}

/** "Aapne 5 kg Aata bikne ki baat kahi. Confirm karein?" */
export function confirmMessage({ item, quantity, unit, intent }) {
  const qty = formatQtyWithUnit(quantity, unit);
  if (intent === INTENTS.SALE) {
    return `Aapne ${qty} ${item} bikne ki baat kahi. Confirm karein?`;
  }
  if (intent === INTENTS.SET_STOCK) {
    return `Aapne ${item} ka stock ${qty} set karne ki baat kahi. Confirm karein?`;
  }
  return `Aapne ${item} ka stock poocha. Confirm karein?`;
}

/** Used when the number itself was not understood, so the figure shown is a proposal. */
export function unclearQuantityMessage({ item, quantity, unit, intent }) {
  const qty = formatQtyWithUnit(quantity, unit);
  if (intent === INTENTS.SALE) {
    return `Kitna ${item} bik gaya, yeh clear nahi hua. Kya ${qty} bikne ki baat hai? Confirm karein?`;
  }
  if (intent === INTENTS.SET_STOCK) {
    return `Kitna ${item} bacha, yeh clear nahi hua. Kya stock ${qty} hai? Confirm karein?`;
  }
  return `Kya aap ${item} ka stock poochna chahte hain? Confirm karein?`;
}

/** "5 kg Aata bik gaya. Ab stock 15 kg hai." */
export function saleSuccessMessage(item, soldQty, previousQty) {
  return `${formatQtyWithUnit(soldQty, item.unit)} ${item.name} bik gaya. Ab stock ${formatQtyWithUnit(
    previousQty - soldQty,
    item.unit,
  )} hai.`;
}

/** "Aata ka stock 15 kg set ho gaya." */
export function setStockSuccessMessage(item) {
  return `${item.name} ka stock ${formatQtyWithUnit(item.quantity, item.unit)} set ho gaya.`;
}

/** "Aata ka stock sirf 3 kg hai. 5 kg sale update nahi ho sakti." */
export function insufficientStockMessage(item, requestedQty) {
  return `${item.name} ka stock sirf ${formatQtyWithUnit(
    item.quantity,
    item.unit,
  )} hai. ${formatQtyWithUnit(requestedQty, item.unit)} sale update nahi ho sakti.`;
}

/** "Rajma inventory mein nahi mila." */
export function unknownItemMessage(rawItem) {
  const label = String(rawItem || '').trim();
  const capitalised = label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Yeh item';
  return `${capitalised} inventory mein nahi mila.`;
}

/** "Quantity nahi samajh aayi. Kitna Aata tha?" */
export function missingFieldMessage(parsed) {
  if (!parsed || !parsed.item) return 'Item ka naam samajh nahi aaya. Please dobara boliye.';
  if (parsed.intent === INTENTS.CHECK_STOCK) {
    return 'Item ka naam samajh nahi aaya. Kaunsa item poochna hai?';
  }
  return 'Quantity samajh nahi aayi. Kitna tha?';
}

/** "Maggi ka stock sirf 3 packets hai." - the differentiating low-stock alert. */
export function lowStockMessage(item) {
  return `${item.name} ka stock sirf ${formatQtyWithUnit(item.quantity, item.unit)} hai.`;
}

export function lowStockAlert(item) {
  return `\u26A0\uFE0F ${lowStockMessage(item)}`;
}

export const LOW_STOCK_HEADING = 'Low Stock';
export const ALL_HEALTHY = '\u2713 All inventory levels are healthy';

/* ---------------------------------------------------------------------------
 * Item add / edit / delete.
 *
 * Every one of these reaches a shopkeeper who is typing on a phone, between
 * customers. So: Hinglish, one sentence, and say what to do next rather than
 * naming the field that failed validation.
 * ------------------------------------------------------------------------ */

/** The three units the shop can count in, for error messages. */
export const UNIT_CHOICES_HINGLISH = 'kg, L ya packets';

/** "Chawal already inventory mein hai." */
export function duplicateItemMessage(name) {
  return `${name} already inventory mein hai. Purana naam edit karne ke liye use karein.`;
}

/** "Chawal nahi mila. Shayad wo delete ho chuka hai." */
export function itemNotFoundMessage(name) {
  const label = String(name || '').trim();
  return label
    ? `${label} nahi mila. Shayad wo delete ho chuka hai.`
    : 'Yeh item nahi mila. List refresh karein.';
}

/** "Chawal add ho gaya: 20 kg." */
export function itemAddedMessage(item) {
  return `${item.name} add ho gaya: ${formatQtyWithUnit(item.quantity, item.unit)}.`;
}

/** "Chawal update ho gaya." */
export function itemUpdatedMessage(item) {
  return `${item.name} update ho gaya: ${formatQtyWithUnit(item.quantity, item.unit)}.`;
}

/** "Chawal delete kar diya gaya hai." */
export function itemDeletedMessage(name) {
  return `${name} delete kar diya gaya hai.`;
}
