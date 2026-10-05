/**
 * The whole app, one page.
 *
 * Owns the voice state machine:
 *   idle -> recording -> thinking -> (needs_confirmation | success | error) -> idle
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import MicButton from '../components/MicButton.jsx';
import InventoryTable from '../components/InventoryTable.jsx';
import LowStockPanel from '../components/LowStockPanel.jsx';
import VoiceActivityLog from '../components/VoiceActivityLog.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import AppFooter from '../components/AppFooter.jsx';
import { useRecorder } from '../hooks/useRecorder.js';
import { useDashboard } from '../hooks/useDashboard.js';
import { speak, stopSpeaking } from '../hooks/useSpeech.js';
import { confirmVoiceAction, processVoice } from '../services/api.js';

const DONE_RESET_MS = 2500;

export default function Dashboard() {
  const { items, lowStock, recentActions, shop, loading, error: loadError, refresh } = useDashboard();
  const { isRecording, start, stop, cancel } = useRecorder();

  const [micState, setMicState] = useState('idle');
  const [banner, setBanner] = useState(null);
  const [pending, setPending] = useState(null);
  const [confirming, setConfirming] = useState(false);

  // Guards against a state update after unmount and against double submits.
  const busyRef = useRef(false);
  const resetTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      stopSpeaking();
    },
    [],
  );

  const scheduleIdleReset = useCallback(() => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setMicState('idle'), DONE_RESET_MS);
  }, []);

  /** Every server response lands in the same place, so the UI can never diverge. */
  const handleResult = useCallback(
    async (payload, { spoken = false } = {}) => {
      await refresh();

      if (payload.status === 'needs_confirmation') {
        // The dialog owns the screen from here, so the mic returns to idle
        // rather than sitting on "Samajh raha hoon..." and staying disabled.
        setBanner(null);
        setPending(payload);
        setMicState('idle');
        return;
      }

      setPending(null);

      if (payload.status === 'success') {
        setBanner({ tone: 'success', message: payload.message, warning: payload.warning, transcript: spoken ? payload.transcript : '' });
        // Read the answer aloud, but only if the browser can. Never required.
        if (payload.intent === 'CHECK_STOCK' && payload.message) speak(payload.message);
        setMicState('done');
        scheduleIdleReset();
        return;
      }

      setBanner({ tone: 'error', message: payload.message, transcript: spoken ? payload.transcript : '' });
      setMicState('idle');
    },
    [refresh, scheduleIdleReset],
  );

  /** Tap 1 starts recording, tap 2 stops it and sends the audio. */
  const handleMicToggle = useCallback(async () => {
    if (confirming || busyRef.current) return;

    if (isRecording) {
      busyRef.current = true;
      setMicState('thinking');
      setBanner(null);

      let clip;
      try {
        clip = await stop();
      } catch (err) {
        busyRef.current = false;
        setMicState('idle');
        setBanner({ tone: 'error', message: err?.message || 'Please bolkar command dein.' });
        return;
      }

      try {
        const payload = await processVoice(clip.blob, clip.mimeType);
        await handleResult(payload, { spoken: true });
      } catch (err) {
        setBanner({ tone: 'error', message: err?.userMessage || 'Voice samajhne mein problem hui.' });
        setMicState('idle');
      } finally {
        busyRef.current = false;
      }
      return;
    }

    // Idle -> recording
    // Claim the lock before awaiting getUserMedia, otherwise a fast double tap
    // opens two microphone streams and the second silently wins.
    busyRef.current = true;
    stopSpeaking();
    setPending(null);
    setBanner(null);
    try {
      await start();
      setMicState('recording');
    } catch (err) {
      setMicState('idle');
      setBanner({ tone: 'error', message: err?.message || 'Microphone permission required.' });
    } finally {
      busyRef.current = false;
    }
  }, [confirming, isRecording, start, stop, handleResult]);

  const handleConfirm = useCallback(async () => {
    if (!pending?.confirmationId || confirming) return;
    setConfirming(true);
    try {
      const payload = await confirmVoiceAction(pending.confirmationId);
      await handleResult(payload, { spoken: true });
    } catch (err) {
      setBanner({ tone: 'error', message: err?.userMessage || 'Inventory update nahi ho paya.' });
      setPending(null);
      setMicState('idle');
    } finally {
      setConfirming(false);
    }
  }, [pending, confirming, handleResult]);

  /** "Nahi" simply drops the pending action. Nothing was ever written. */
  const handleCancel = useCallback(() => {
    stopSpeaking();
    cancel();
    setPending(null);
    setBanner({ tone: 'info', message: 'Theek hai, kuch nahi badla. Dobara bol sakte hain.' });
    setMicState('idle');
  }, [cancel]);

  // Keyboard support: Space is the natural "press to talk" key.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== 'Space') return;
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      handleMicToggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleMicToggle]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b-4 border-slate-800 bg-slate-800 px-4 py-4 text-white sm:px-6">
        <h1 className="text-2xl font-bold sm:text-3xl">{shop} — Dukaan Sathi</h1>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-6 p-4 pb-16 sm:p-6">
        {/* Largest, most prominent thing on the page. */}
        <section className="rounded-2xl border-2 border-slate-200 bg-white p-6 py-10 sm:p-8">
          <MicButton state={micState} onToggle={handleMicToggle} disabled={confirming} />
          <p className="mt-6 text-center text-sm text-slate-500">
            Example: &ldquo;5 kilo aata bik gaya&rdquo;
          </p>
        </section>

        <StatusBanner result={banner} />

        {loadError ? (
          <div className="rounded-2xl border-2 border-red-400 bg-red-50 p-4 text-lg text-red-900">
            {loadError}
          </div>
        ) : null}

        <LowStockPanel lowStock={lowStock} latestWarning={banner?.warning} />
        {/* onChanged re-reads the dashboard, so a hand edit updates the low-stock
            panel and the numbers together instead of drifting apart. */}
        <InventoryTable items={items} loading={loading} onChanged={refresh} />
        <VoiceActivityLog actions={recentActions} />
      </main>

      <AppFooter />

      <ConfirmDialog
        pending={pending}
        busy={confirming}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}
