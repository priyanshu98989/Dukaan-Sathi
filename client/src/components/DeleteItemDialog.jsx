/**
 * Delete confirmation.
 *
 * Separate from the voice ConfirmDialog on purpose: that one sends a pending
 * action id back to the server, this one destroys a row permanently. It says so
 * in plain words, and the destructive button is the one that is not the default
 * focus.
 */

import { useEffect, useRef } from 'react';

export default function DeleteItemDialog({ item, busy, error, onConfirm, onClose }) {
  const cancelRef = useRef(onClose);
  cancelRef.current = onClose;

  useEffect(() => {
    if (!item) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        cancelRef.current?.();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [item, busy]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-item-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl sm:p-6">
        <h2 id="delete-item-title" className="text-2xl font-bold text-slate-900">
          {item.name} hatayein?
        </h2>

        <p className="mt-3 text-lg leading-relaxed text-slate-800">
          Ye item inventory se delete ho jayega. Voice se bhi iska stock nahi badal paayega.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-base font-semibold text-red-900"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={[
              'min-h-14 w-full rounded-xl px-5 text-xl font-bold text-white sm:w-auto sm:min-w-40',
              'focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400',
              busy ? 'cursor-wait bg-slate-400' : 'bg-red-600 hover:bg-red-700 active:bg-red-800',
            ].join(' ')}
          >
            {busy ? 'Delete ho raha hai...' : 'Haan, delete karein'}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            autoFocus
            className={[
              'min-h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-5 text-xl font-bold text-slate-700',
              'focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-300',
              busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50',
            ].join(' ')}
          >
            Rehne dein
          </button>
        </div>
      </div>
    </div>
  );
}