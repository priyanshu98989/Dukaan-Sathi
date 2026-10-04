import { formatQty, formatUnit } from '../services/format.js';

/** The shop's live stock. Large text on purpose - read it from across the counter. */
export default function InventoryTable({ items, loading }) {
  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="mb-4 text-2xl font-bold text-slate-900">Stock</h2>

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
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
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
