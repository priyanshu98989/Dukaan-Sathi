import { formatQty, formatUnit } from '../services/format.js';

/**
 * The differentiating feature: a prominent, unmissable warning the moment
 * anything drops below its threshold. No reorder system - the alert is the point.
 */
export default function LowStockPanel({ lowStock, latestWarning }) {
  const items = lowStock?.items ?? [];

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="mb-4 text-2xl font-bold text-slate-900">Low Stock</h2>

      {/* Just-triggered alert, shouted before the standing list. */}
      {latestWarning ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border-2 border-amber-500 bg-amber-100 p-4 text-xl font-bold text-amber-900 sm:text-2xl"
        >
          {latestWarning}
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-xl bg-emerald-50 p-4 text-lg font-semibold text-emerald-800 sm:text-xl">
          {'\u2713'} All inventory levels are healthy
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4"
            >
              <span className="text-2xl" aria-hidden="true">
                {'\u26A0\uFE0F'}
              </span>
              <span className="text-xl font-bold text-amber-900 sm:text-2xl">
                {item.name} ka stock sirf {formatQty(item.quantity)}{' '}
                {formatUnit(item.quantity, item.unit)} hai.
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
