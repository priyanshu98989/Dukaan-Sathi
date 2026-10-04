/**
 * Item name normalization, deliberately scoped to the five seeded items.
 *
 * This is NOT a general transliteration engine. It is a small hand-written alias
 * table so that "aata" / "Aata" / "आटा" all resolve to the same seeded row.
 * Anything not in this table is reported as an unknown item - the AI is never
 * allowed to create new inventory rows.
 */

const SEED_ITEMS = [
  { name: 'Aata', quantity: 20, unit: 'kg', lowStockThreshold: 5 },
  { name: 'Maggi', quantity: 30, unit: 'packets', lowStockThreshold: 5 },
  { name: 'Oil', quantity: 10, unit: 'L', lowStockThreshold: 3 },
  { name: 'Sugar', quantity: 15, unit: 'kg', lowStockThreshold: 4 },
  { name: 'Biscuit', quantity: 40, unit: 'packets', lowStockThreshold: 8 },
];

/**
 * Alias -> canonical seeded name.
 * Lowercase keys. Devanagari and Latin spellings both covered.
 */
const ALIASES = {
  // ---- Aata (wheat flour) ----
  aata: 'Aata',
  aataa: 'Aata',
  ata: 'Aata',
  aat: 'Aata',
  atta: 'Aata',
  aatam: 'Aata',
  'aata flour': 'Aata',
  'aatta': 'Aata',
  'aataa flour': 'Aata',
  gehun: 'Aata',
  gehoon: 'Aata',
  gahu: 'Aata',
  'आटा': 'Aata',
  'अाटा': 'Aata',
  'आटा आटा': 'Aata',
  'गेहूं': 'Aata',
  'गेहूँ': 'Aata',
  'गेहुं': 'Aata',

  // ---- Maggi ----
  maggi: 'Maggi',
  maggie: 'Maggi',
  magee: 'Maggi',
  'maggi noodle': 'Maggi',
  'maggi noodles': 'Maggi',
  '2 minute noodles': 'Maggi',
  'two minute noodles': 'Maggi',
  'मैगी': 'Maggi',
  'मैगि': 'Maggi',
  'मैग्गी': 'Maggi',
  'मेगी': 'Maggi',
  'मैगी नूडल्स': 'Maggi',

  // ---- Oil ----
  oil: 'Oil',
  oils: 'Oil',
  tel: 'Oil',
  'khan ka tel': 'Oil',
  'khane ka tel': 'Oil',
  'cooking oil': 'Oil',
  'edible oil': 'Oil',
  'til': 'Oil',
  'तेल': 'Oil',
  'खाना तेल': 'Oil',
  'खाने का तेल': 'Oil',
  'कुकिंग ऑयल': 'Oil',
  'सरसों का तेल': 'Oil',
  'सरिफ': 'Oil',

  // ---- Sugar ----
  sugar: 'Sugar',
  sugars: 'Sugar',
  cheeni: 'Sugar',
  cheni: 'Sugar',
  chini: 'Sugar',
  chhena: 'Sugar',
  'cheeni kilo': 'Sugar',
  mishri: 'Sugar',
  mishri_: 'Sugar',
  godhi: 'Sugar',
  godhi_: 'Sugar',
  'white sugar': 'Sugar',
  'चीनी': 'Sugar',
  'चिनी': 'Sugar',
  'मिसरी': 'Sugar',
  'गोड़ी': 'Sugar',
  'गोडी': 'Sugar',
  'शक्कर': 'Sugar',
  'सफेद चीनी': 'Sugar',

  // ---- Biscuit ----
  biscuit: 'Biscuit',
  biscuits: 'Biscuit',
  biskut: 'Biscuit',
  bisquit: 'Biscuit',
  'biscuit packet': 'Biscuit',
  'biscuit packets': 'Biscuit',
  'parle g': 'Biscuit',
  cookie: 'Biscuit',
  cookies: 'Biscuit',
  'बिस्कुट': 'Biscuit',
  'बिस्किट': 'Biscuit',
  'बिस्कूट': 'Biscuit',
};

/** Unit aliases. Only these three canonical units exist in the database. */
const UNIT_ALIASES = {
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  kgs: 'kg',
  'किलो': 'kg',
  'किलोग्राम': 'kg',
  'केजी': 'kg',

  l: 'L',
  litre: 'L',
  litres: 'L',
  liter: 'L',
  liters: 'L',
  litre_: 'L',
  'लीटर': 'L',
  'लिटर': 'L',
  'एल': 'L',

  pack: 'packets',
  packet: 'packets',
  packets: 'packets',
  pkt: 'packets',
  pkts: 'packets',
  packs: 'packets',
  'पैकेट': 'packets',
  'पैकेट्स': 'packets',
  'पेकेट': 'packets',
};

const SEED_NAMES = SEED_ITEMS.map((i) => i.name);

/**
 * Lowercase, strip punctuation and collapse whitespace so that
 * "Aata." / "  AATA  " / "aata," all collapse to "aata".
 * Devanagari danda and nukta forms are normalised explicitly.
 */
export function normaliseKey(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, '') // curly quotes
    .replace(/[.,!?;:'"`~*()\[\]{}/\\|_\-]/g, ' ') // punctuation -> space
    .replace(/[\u0964\u0965]/g, ' ') // danda
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a spoken/AI-supplied item name to a canonical seeded name.
 * Returns null when the item is not in the seeded inventory.
 * @param {string} raw
 * @returns {string|null}
 */
export function resolveItemName(raw) {
  const key = normaliseKey(raw);
  if (!key) return null;

  if (ALIASES[key]) return ALIASES[key];

  // Exact match against a canonical name (covers "Aata", "Oil", "Sugar").
  const direct = SEED_NAMES.find((n) => normaliseKey(n) === key);
  if (direct) return direct;

  // Singular/plural wobble on a single-token name, e.g. "biscuit"/"biscuits".
  const singular = key.replace(/(s|es)$/, '').trim();
  if (singular && ALIASES[singular]) return ALIASES[singular];

  return null;
}

/**
 * Resolve a spoken unit to one of the three canonical units.
 * @param {string|null|undefined} raw
 * @returns {string|null} canonical unit, or null if unrecognised
 */
export function resolveUnit(raw) {
  if (raw === null || raw === undefined) return null;
  const key = normaliseKey(raw);
  if (!key) return null;
  return UNIT_ALIASES[key] || null;
}

/** A conservative pluraliser used only for the confirmation sentence. */
export function pluraliseUnit(unit) {
  if (unit === 'packets') return 'packets';
  if (unit === 'L') return 'L';
  if (unit === 'kg') return 'kg';
  return unit;
}

export { SEED_ITEMS, SEED_NAMES, ALIASES, UNIT_ALIASES };
