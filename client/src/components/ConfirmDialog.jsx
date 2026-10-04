/**
 * Shown when the AI was not confident enough to act on its own.
 *
 * Two very large buttons. "Haan" sends only the opaque confirmation id back to
 * the server, which re-validates the stored action against live stock before
 * applying anything. Escape is treated exactly like "Nahi".
 */
import { useEffect, useRef } from 'react';

export default function ConfirmDialog({ pending, busy, onConfirm, onCancel }) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!pending) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        cancelRef.current?.();
      }
    };

    // Stop the page behind the modal from scrolling on touch devices.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pending, busy]);

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <h2 id="confirm-title" className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Confirm karein?
        </h2>

        <p className="mt-4 text-xl leading-relaxed text-slate-800 sm:text-2xl">
          {pending.message}
        </p>

        {pending.transcript ? (
          <p className="mt-3 text-base text-slate-500 sm:text-lg">
            Aapne kaha: &ldquo;{pending.transcript}&rdquo;
          </p>
        ) : null}

        <div className="mt-8 grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={[
              'flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl px-4 text-2xl font-bold text-white',
              'focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400',
              busy ? 'cursor-wait bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800',
            ].join(' ')}
          >
            <span className="text-4xl leading-none" aria-hidden="true">
              {'\u2713'}
            </span>
            <span>Haan</span>
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={[
              'flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl px-4 text-2xl font-bold text-white',
              'focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400',
              busy ? 'cursor-wait bg-slate-400' : 'bg-red-600 hover:bg-red-700 active:bg-red-800',
            ].join(' ')}
          >
            <span className="text-4xl leading-none" aria-hidden="true">
              {'\u2715'}
            </span>
            <span>Nahi</span>
          </button>
        </div>
      </div>
    </div>
  );
}
