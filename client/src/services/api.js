/**
 * The only place the browser talks to the API.
 *
 * The Gemini key never appears here or anywhere in this bundle - the browser
 * only ever sends audio and receives already-validated JSON.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/** Mic permission / recording failures, in the shopkeeper's language. */
const CLIENT_ERRORS = {
  MIC_DENIED: 'Microphone permission required. Please enable it in browser settings.',
  MIC_UNAVAILABLE: 'Microphone available nahi hai. Please check your device.',
  NO_AUDIO: 'Please bolkar command dein.',
  NETWORK: 'Server se baat nahi ho payi. Please check the connection.',
  UNKNOWN: 'Kuch galat ho gaya. Please dobara try karein.',
};

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ApiError';
    this.userMessage = message;
    this.code = code;
    this.status = status;
  }
}

function messageFromPayload(payload) {
  if (payload && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return CLIENT_ERRORS.UNKNOWN;
}

/**
 * The shop key, held in sessionStorage so it survives a refresh but not a closed
 * tab. It is deliberately NOT in the bundle: anything baked into the JavaScript
 * is readable by anyone who opens devtools, and this is a secret, not a config.
 */
const KEY_STORAGE = 'dukaan-sathi.api-key';

export function getApiKey() {
  try {
    return window.sessionStorage.getItem(KEY_STORAGE) || '';
  } catch {
    // Private mode / storage disabled: the app still works for this page view
    // because the key is kept in memory, it just is not remembered.
    return '';
  }
}

export function setApiKey(value) {
  const key = String(value || '').trim();
  try {
    if (key) window.sessionStorage.setItem(KEY_STORAGE, key);
    else window.sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // ignore - in-memory copy below is enough for this page view
  }
  apiKey = key;
  notifyKeyChange(key);
  return key;
}

/** Notified when the key changes, so the gate can re-render. */
let apiKey = '';
const keyListeners = new Set();

function notifyKeyChange(key) {
  for (const fn of keyListeners) fn(key);
}

export function onApiKeyChange(fn) {
  keyListeners.add(fn);
  return () => keyListeners.delete(fn);
}

apiKey = getApiKey();

/** Headers for every API call: the shop key, plus the usual JSON ask. */
function authHeaders(extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

async function parseResponse(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    throw new ApiError(
      messageFromPayload(payload),
      payload?.code ?? `HTTP_${res.status}`,
      res.status,
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(CLIENT_ERRORS.UNKNOWN, 'BAD_RESPONSE', res.status);
  }
  return payload;
}

/**
 * Wrap a fetch so every caller gets the same auth header, the same network
 * error shape, and one place to react to a rejected key.
 */
async function apiFetch(path, options = {}) {
  const { headers, ...rest } = options;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: authHeaders(headers),
    });
    return await parseResponse(res);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(CLIENT_ERRORS.NETWORK, 'NETWORK', 0);
  }
}

/** GET /api/dashboard */
export async function fetchDashboard() {
  return apiFetch('/api/dashboard');
}

/** GET /api/inventory */
export async function fetchInventory() {
  return apiFetch('/api/inventory');
}

/* ---------------------------------------------------------------------------
 * Add / edit / delete an item.
 *
 * These are shopkeeper actions, not voice actions: the Gemini layer can never
 * create, rename or remove a row, so these three are the only paths that can.
 * ------------------------------------------------------------------------ */

/** The fields the server accepts, with empty strings dropped so a blank box is
 *  left out of an edit entirely rather than sent as "". */
function itemPayload(values) {
  const payload = {};
  if (values.name !== undefined && values.name !== '') payload.name = values.name;
  if (values.unit) payload.unit = values.unit;
  if (values.quantity !== undefined && values.quantity !== '') payload.quantity = values.quantity;
  if (values.lowStockThreshold !== undefined && values.lowStockThreshold !== '') {
    payload.lowStockThreshold = values.lowStockThreshold;
  }
  return payload;
}

/** POST /api/items */
export async function createItem(values) {
  return apiFetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(itemPayload(values)),
  });
}

/** PUT /api/items/:id */
export async function updateItem(id, values) {
  return apiFetch(`/api/items/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(itemPayload(values)),
  });
}

/** DELETE /api/items/:id */
export async function deleteItem(id) {
  return apiFetch(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * POST /api/voice/process - multipart audio in, validated result out.
 *
 * @param {Blob} blob recorded audio
 * @param {string} mimeType container the AI layer can read
 */
export async function processVoice(blob, mimeType) {
  const form = new FormData();
  // A filename is required for the browser to send a file part.
  form.append('audio', blob, `dukaan-sathi.${extensionFor(mimeType)}`);

  // No explicit Content-Type: the browser must add the multipart boundary itself.
  return apiFetch('/api/voice/process', { method: 'POST', body: form });
}

/** POST /api/voice/confirm - applies a pending action the shopkeeper approved. */
export async function confirmVoiceAction(confirmationId) {
  return apiFetch('/api/voice/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Only the opaque id is sent. The server ignores anything else and
    // re-validates the stored action against live stock.
    body: JSON.stringify({ confirmationId }),
  });
}

function extensionFor(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const map = {
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/aac': 'aac',
    'audio/aiff': 'aiff',
    'audio/x-aiff': 'aiff',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/webm': 'webm',
  };
  return map[base] || 'audio';
}

export { CLIENT_ERRORS, ApiError };
