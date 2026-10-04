/**
 * Microphone recording via the browser MediaRecorder API.
 *
 * The container that comes out of MediaRecorder is browser-dependent, and the AI
 * layer can only read certain ones. Rather than assume a single format works,
 * we negotiate down a preference list and report honestly if none is readable.
 *
 * All MediaStream tracks are stopped on every exit path, otherwise the browser
 * keeps the microphone indicator on and the next recording silently fails.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CLIENT_ERRORS } from '../services/api.js';

/** Shorter than this and the clip is almost certainly a mis-tap. */
const MIN_RECORDING_MS = 350;
/** Guard against a forgotten recording. */
const MAX_RECORDING_MS = 60_000;

/**
 * Preference order. The first three are readable by the AI layer as-is.
 * `audio/webm` is a last-resort fallback that the server will reject with a
 * clear message rather than sending the model something it cannot decode.
 */
const PREFERRED_TYPES = [
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mpeg',
  'audio/wav',
  'audio/webm;codecs=opus',
  'audio/webm',
];

/** Strip codecs so the server sees a container it recognises. */
function toContainer(mimeType) {
  return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

/** Containers the AI layer can read. Mirrors server/services/geminiService.js. */
const AI_READABLE = new Set([
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

/** Pick the best available recording format, or null if nothing is supported. */
export function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;

  for (const type of PREFERRED_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // isTypeSupported can throw on very old browsers; keep walking the list.
    }
  }
  return null;
}

export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef(null);
  const stoppingRef = useRef(false);

  /** Always release the microphone. Safe to call repeatedly. */
  const releaseStream = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (!stream) return;
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      // Track may already be ended; nothing to do.
    }
  }, []);

  useEffect(() => releaseStream, [releaseStream]);

  /** Turn a getUserMedia rejection into the exact message the shopkeeper needs. */
  const describeMicError = useCallback((err) => {
    switch (err?.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return CLIENT_ERRORS.MIC_DENIED;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return CLIENT_ERRORS.MIC_UNAVAILABLE;
      case 'NotReadableError':
      case 'TrackStartError':
        return 'Microphone kisi aur app mein busy hai. Please baad me try karein.';
      default:
        return CLIENT_ERRORS.MIC_UNAVAILABLE;
    }
  }, []);

  /**
   * End the recording and hand back the audio.
   *
   * Also used by the hard-stop timer, so a forgotten recording is delivered and
   * settled rather than silently dropped.
   */
  const stop = useCallback(() => {
    return new Promise((resolve, reject) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        releaseStream();
        setIsRecording(false);
        reject(new Error(CLIENT_ERRORS.NO_AUDIO));
        return;
      }

      const requestedType = recorder.mimeType || 'audio/webm';

      recorder.onstop = () => {
        const duration = Date.now() - startedAtRef.current;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        setIsRecording(false);

        if (duration < MIN_RECORDING_MS) {
          reject(new Error(CLIENT_ERRORS.NO_AUDIO));
          return;
        }

        const blob = new Blob(chunks, { type: requestedType });
        if (blob.size === 0) {
          reject(new Error(CLIENT_ERRORS.NO_AUDIO));
          return;
        }

        resolve({ blob, mimeType: toContainer(requestedType), durationMs: duration, elapsed: duration });
      };

      try {
        recorder.stop();
      } catch {
        releaseStream();
        setIsRecording(false);
        reject(new Error(CLIENT_ERRORS.NO_AUDIO));
      }
    });
  }, [releaseStream]);

  const start = useCallback(async () => {
    if (isRecording) return null;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(CLIENT_ERRORS.MIC_UNAVAILABLE);
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Is browser mein audio recording support nahi hai. Please Chrome ya Edge use karein.');
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw new Error(describeMicError(err));
    }

    const mimeType = pickAudioMimeType();
    let recorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      releaseStream();
      throw new Error(CLIENT_ERRORS.MIC_UNAVAILABLE);
    }

    chunksRef.current = [];
    stoppingRef.current = false;

    /** Release everything for a finished recorder. Safe to call twice. */
    const finalise = (rec) => {
      if (recorderRef.current === rec) recorderRef.current = null;
      releaseStream();
      setIsRecording(false);
    };

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    // Default end-of-recording handler. `stop()` replaces this with one that
    // also settles its promise, but the hard-stop timer below relies on this
    // one, so a forgotten recording still frees the microphone.
    recorder.onstop = () => finalise(recorder);

    recorder.onerror = () => {
      stoppingRef.current = true;
      finalise(recorder);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();

    recorder.start(250);
    setIsRecording(true);

    // Hard stop, so a forgotten recording cannot hang the browser. Going
    // through `stop()` means the clip is still delivered rather than dropped.
    stopTimerRef.current = setTimeout(() => {
      // Nobody is awaiting this promise, so make sure it can never surface as an
      // unhandled rejection. The recorder is already finalised either way.
      if (recorderRef.current?.state === 'recording') stop().catch(() => {});
    }, MAX_RECORDING_MS);

    return recorder.mimeType || mimeType || 'audio/webm';
  }, [isRecording, describeMicError, releaseStream, stop]);

  /** Abort an in-flight recording without producing audio. */
  const cancel = useCallback(() => {
    stoppingRef.current = true;
    try {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    } catch {
      // ignore
    }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    setIsRecording(false);
  }, [releaseStream]);

  return { isRecording, start, stop, cancel, isAiReadable: (t) => AI_READABLE.has(toContainer(t)) };
}
