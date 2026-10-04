/**
 * Add / edit dialog for one inventory item.
 *
 * Sized for a phone held in one hand at a shop counter:
 *   - every control is full width and at least 48px tall
 *   - inputs are text-lg so iOS Safari does not zoom the page on focus
 *   - numeric keyboards for the two number fields
 *   - errors land in one place, above the buttons, and the server's own
 *     Hinglish message is shown verbatim rather than replaced with our own guess
 *
 * No client-side validation beyond "required". The server owns the rules and the
 * wording, so the two can never disagree about what a valid item is.
 */

import { useEffect, useRef, useState } from 'react';

const UNITS = [
  { value: 'kg', label: 'kg (kilo)' },
  { value: 'L', label: 'L (litre)' },
  { value: 'packets', label: 'packets' },
];

const emptyDraft = { name: '', unit: 'kg', quantity: '', lowStockThreshold: '' };

/** Pre-fill from the row being edited; quantities arrive as numbers. */
function draftFrom(item) {
  if (!item) return emptyDraft;
  return {
    name: item.name ?? '',
    unit: item.unit ?? 'kg',
    quantity: String(item.quantity ?? ''),
    lowStockThreshold: String(item.lowStockThreshold ?? ''),
  };
}

export default function ItemFormDialog({ item, busy, error, onSubmit, onClose }) {
  const isEdit = Boolean(item);
  const [draft, setDraft] = useState(() => draftFrom(item));
  const [localError, setLocalError] = useState('');

  const firstFieldRef = useRef(null);
  const cancelRef = useRef(onClose);
  cancelRef.current = onClose;

  // The parent swaps `item` in to switch between add and edit, so reset whenever
  // the dialog opens rather than keeping the previous row's values.
  useEffect(() => {
    setDraft(draftFrom(item));
    setLocalError('');
    firstFieldRef.current?.focus();
  }, [item]);

  useEffect(() => {
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
  }, [busy]);

  const set = (field) => (event) => setDraft((d) => ({ ...d, [field]: event.target.value }));

  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy) return;

    // Only catch what we can describe better than the server can. Everything
    // else (duplicate name, negative stock) is the server's call.
    if (!isEdit && !draft.name.trim()) {
      setLocalError('Item ka naam likhein.');
      return;
    }
    if (draft.quantity === '' || Number.isNaN(Number(draft.quantity))) {
      setLocalError('Quantity ek number likhein, jaise 20 ya 2.5.');
      return;
    }
    if (draft.lowStockThreshold === '' || Number.isNaN(Number(draft.lowStockThreshold))) {
      setLocalError('Low stock limit ek number likhein, jaise 5.');
      return;
    }

    setLocalError('');
    onSubmit(draft);
  };

  const shownError = localError || error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-form-title"
    >
      <form
        onSubmit={handleSubmit}
        className="my-auto w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
      >
        <h2 id="item-form-title" className="text-2xl font-bold text-slate-900">
          {isEdit ? `${item.name} badlein` : 'Naya item add karein'}
        </h2>

        <div className="mt-5 space-y-4">
          <Field label="Item ka naam" htmlFor="item-name">
            <input
              id="item-name"
              ref={firstFieldRef}
              type="text"
              value={draft.name}
              onChange={set('name')}
              disabled={busy}
              autoComplete="off"
              placeholder="Chawal"
              className={inputClass}
            />
          </Field>

          <Field label="Unit" htmlFor="item-unit">
            <select
              id="item-unit"
              value={draft.unit}
              onChange={set('unit')}
              disabled={busy}
              className={inputClass}
            >
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Kitna stock hai" htmlFor="item-quantity">
            <input
              id="item-quantity"
              type="text"
              inputMode="decimal"
              value={draft.quantity}
              onChange={set('quantity')}
              disabled={busy}
              placeholder="20"
              className={inputClass}
            />
          </Field>

          <Field
            label="Low stock limit"
            htmlFor="item-threshold"
            hint="Isse kam hote hi warning dikhegi."
          >
            <input
              id="item-threshold"
              type="text"
              inputMode="decimal"
              value={draft.lowStockThreshold}
              onChange={set('lowStockThreshold')}
              disabled={busy}
              placeholder="5"
              className={inputClass}
            />
          </Field>
        </div>

        {shownError ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-base font-semibold text-red-900"
          >
            {shownError}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={busy}
            className={[
              'min-h-14 w-full rounded-xl px-5 text-xl font-bold text-white sm:w-auto sm:min-w-40',
              'focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400',
              busy ? 'cursor-wait bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800',
            ].join(' ')}
          >
            {busy ? 'Save ho raha hai...' : isEdit ? 'Save karein' : 'Add karein'}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={[
              'min-h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-5 text-xl font-bold text-slate-700',
              'focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-300',
              busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50',
            ].join(' ')}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** text-lg keeps iOS from zooming on focus; py-3 + text-lg clears 48px. */
const inputClass =
  'w-full min-h-12 rounded-xl border-2 border-slate-300 bg-white px-3 py-3 text-lg ' +
  'text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-100';

function Field({ label, htmlFor, hint, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-base font-bold text-slate-800">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}