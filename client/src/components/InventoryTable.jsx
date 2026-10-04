import { useState } from 'react';
import { formatQty, formatUnit } from '../services/format.js';
import { createItem, deleteItem, updateItem } from '../services/api.js';
import ItemFormDialog from './ItemFormDialog.jsx';
import DeleteItemDialog from './DeleteItemDialog.jsx';

/**
 * The shop's live stock, and the only place items can be added or removed by hand.
 *
 * Read from across the counter, so the numbers stay large. The row actions are
 * deliberately smaller and quieter than the numbers: adding stock is a typo-fix,
 * not the main event.
 */
export default function InventoryTable({ items, loading, onChanged }) {
  // null = closed, 'new' = adding, or the row being edited.
  const [formMode, setFormMode] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState(null);

  const closeForm = () => {
    setFormMode(null);
    setFormError('');
  };

  const closeDelete = () => {
    setDeleteTarget(null);
    setDeleteError('');
  };

  const handleSubmit = async (values) => {
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      const payload =
        formMode === 'new'
          ? await createItem(values)
          : await updateItem(formMode.id, values);

      setNotice({ tone: 'success', message: payload.message });
      closeForm();
      await onChanged?.();
    } catch (err) {
      // The server already speaks Hinglish, so its message is shown as-is.
      setFormError(err?.userMessage || 'Item save nahi ho paya.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy || !deleteTarget) return;
    setBusy(true);
    setDeleteError('');
    try {
      const payload = await deleteItem(deleteTarget.id);
      setNotice({ tone: 'success', message: payload.message });
      closeDelete();
      await onChanged?.();
    } catch (err) {
      setDeleteError(err?.userMessage || 'Item delete nahi ho paya.');
    } finally {
      setBusy(false);
    }
  };

  const canEdit = typeof onChanged === 'function';

  function startEdit(item) {
    setFormError('');
    setFormMode(item);
  }

  function startDelete(item) {
    setDeleteError('');
    setDeleteTarget(item);
  }

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-slate-900">Stock</h2>

        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setFormError('');
              setFormMode('new');
            }}
            disabled={loading}
            className={[
              'min-h-12 rounded-xl bg-slate-900 px-4 py-2 text-lg font-bold text-white',
              'focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-400',
              loading ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-700 active:bg-slate-800',
            ].join(' ')}
          >
            + Item add karein
          </button>
        ) : null}
      </div>

      {notice ? (
        <p
          role="status"
          className={[
            'mb-4 rounded-xl border-2 p-3 text-base font-semibold',
            notice.tone === 'success'
              ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
              : 'border-red-400 bg-red-50 text-red-900',
          ].join(' ')}
        >
          {notice.message}
        </p>
      ) : null}

      {loading ? (
        <p className="py-6 text-center text-lg text-slate-500">Stock load ho raha hai...</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-lg text-slate-500">Koi item nahi mila.</p>
      ) : (
        <>
          {/* Phone: stacked cards. Wider screens: a real table. */}
          <ul className="space-y-3 sm:hidden">
            {items.map((item) => (
              <li
                key={item.id}
                className={[
                  'rounded-xl border-2 p-4',
                  item.status === 'Low'
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-slate-200 bg-slate-50',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xl font-bold text-slate-900">{item.name}</span>
                  <StatusPill status={item.status} />
                </div>
                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {formatQty(item.quantity)}{' '}
                  <span className="text-xl font-semibold text-slate-600">
                    {formatUnit(item.quantity, item.unit)}
                  </span>
                </p>
                {canEdit ? <RowActions item={item} onEdit={startEdit} onDelete={startDelete} /> : null}
              </li>
            ))}
          </ul>

          <table className="hidden w-full text-left sm:table">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th scope="col" className="pb-3 text-lg font-bold text-slate-600">
                  Item
                </th>
                <th scope="col" className="pb-3 text-lg font-bold text-slate-600">
                  Stock
                </th>
                <th scope="col" className="pb-3 text-lg font-bold text-slate-600">
                  Status
                </th>
                {canEdit ? (
                  <th scope="col" className="pb-3 text-right text-lg font-bold text-slate-600">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={[
                    'border-b border-slate-100',
                    item.status === 'Low' ? 'bg-amber-50' : '',
                  ].join(' ')}
                >
                  <th scope="row" className="py-4 text-2xl font-bold text-slate-900">
                    {item.name}
                  </th>
                  <td className="py-4 text-2xl font-bold text-slate-900">
                    {formatQty(item.quantity)}{' '}
                    <span className="text-lg font-semibold text-slate-600">
                      {formatUnit(item.quantity, item.unit)}
                    </span>
                  </td>
                  <td className="py-4">
                    <StatusPill status={item.status} />
                  </td>
                  {canEdit ? (
                    <td className="py-4 text-right">
                      <RowActions item={item} onEdit={startEdit} onDelete={startDelete} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {formMode ? (
        <ItemFormDialog
          item={formMode === 'new' ? null : formMode}
          busy={busy}
          error={formError}
          onSubmit={handleSubmit}
          onClose={closeForm}
        />
      ) : null}

      <DeleteItemDialog
        item={deleteTarget}
        busy={busy}
        error={deleteError}
        onConfirm={handleDelete}
        onClose={closeDelete}
      />
    </section>
  );
}

/** 48px tall so it is tappable with a thumb, in the shop or on a phone. */
function RowActions({ item, onEdit, onDelete }) {
  return (
    <div className="mt-3 flex gap-2 sm:mt-0 sm:justify-end">
      <button
        type="button"
        onClick={() => onEdit(item)}
        aria-label={`${item.name} badlein`}
        className="min-h-12 flex-1 rounded-lg border-2 border-slate-300 bg-white px-4 py-2 text-base font-bold text-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-300 hover:bg-slate-50 sm:flex-none"
      >
        Badlein
      </button>
      <button
        type="button"
        onClick={() => onDelete(item)}
        aria-label={`${item.name} delete karein`}
        className="min-h-12 flex-1 rounded-lg border-2 border-red-300 bg-white px-4 py-2 text-base font-bold text-red-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-300 hover:bg-red-50 sm:flex-none"
      >
        Delete
      </button>
    </div>
  );
}

function StatusPill({ status }) {
  const isLow = status === 'Low';
  return (
    <span
      className={[
        'inline-block rounded-full px-3 py-1 text-sm font-bold uppercase tracking-wide',
        isLow ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white',
      ].join(' ')}
    >
      {status}
    </span>
  );
}