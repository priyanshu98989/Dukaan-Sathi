/**
 * Speaks the answer aloud using the browser's own text-to-speech.
 *
 * Strictly optional. If `speechSynthesis` is missing, blocked, or has no voices
 * loaded yet, this is a no-op and the text answer on screen still stands.
 */

const PREFERRED_VOICE_HINTS = [
  'hi-IN', // Hindi (India)
  'mr-IN', // Marathi, often bundled with the Hindi voice
  'en-IN', // Indian English
];

/** @type {SpeechSynthesisVoice[] | null} */
let cachedVoices = null;

function loadVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices && voices.length) cachedVoices = voices;
  return voices || [];
}

function scoreVoice(voice) {
  const lang = (voice.lang || '').toLowerCase();
  let score = 0;
  const hintIndex = PREFERRED_VOICE_HINTS.findIndex((h) => lang.startsWith(h.toLowerCase()));
  if (hintIndex !== -1) score += 100 - hintIndex * 10;
  else if (lang.startsWith('hi')) score += 60;
  else if (lang.startsWith('en')) score += 20;
  if (voice.localService) score += 5;
  if (voice.default) score += 2;
  return score;
}

/** Best available voice for Hindi / Indian English, or null. */
export function pickVoice() {
  const voices = loadVoices();
  if (!voices.length) return null;
  const ranked = voices
    .map((v) => ({ v, s: scoreVoice(v) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return ranked.length ? ranked[0].v : null;
}

export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Speak `text`. Resolves either way - never throws, never blocks the UI.
 * @param {string} text
 */
export function speak(text) {
  if (!isSpeechSupported() || !text) return false;
  try {
    const synth = window.speechSynthesis;
    // Cancel anything already queued so rapid answers do not stack up.
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = PREFERRED_VOICE_HINTS[0];
    }
    utterance.rate = 1;
    utterance.pitch = 1;

    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
