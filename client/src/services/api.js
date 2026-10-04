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

/** GET /api/dashboard */
export async function fetchDashboard() {
  try {
    const res = await fetch(`${BASE_URL}/api/dashboard`, { headers: { Accept: 'application/json' } });
    return await parseResponse(res);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(CLIENT_ERRORS.NETWORK, 'NETWORK', 0);
  }
}

/** GET /api/inventory */
export async function fetchInventory() {
  try {
    const res = await fetch(`${BASE_URL}/api/inventory`, { headers: { Accept: 'application/json' } });
    return await parseResponse(res);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(CLIENT_ERRORS.NETWORK, 'NETWORK', 0);
  }
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

  try {
    const res = await fetch(`${BASE_URL}/api/voice/process`, { method: 'POST', body: form });
    return await parseResponse(res);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(CLIENT_ERRORS.NETWORK, 'NETWORK', 0);
  }
}

/** POST /api/voice/confirm - applies a pending action the shopkeeper approved. */
export async function confirmVoiceAction(confirmationId) {
  try {
    const res = await fetch(`${BASE_URL}/api/voice/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only the opaque id is sent. The server ignores anything else and
      // re-validates the stored action against live stock.
      body: JSON.stringify({ confirmationId }),
    });
    return await parseResponse(res);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(CLIENT_ERRORS.NETWORK, 'NETWORK', 0);
  }
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
    'audio/webm': 'webm',
  };
  return map[base] || 'audio';
}

export { CLIENT_ERRORS, ApiError };
