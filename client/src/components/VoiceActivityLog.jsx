import { relativeTime } from '../services/format.js';

/** Newest first, with a relative timestamp and a plain outcome. */
export default function VoiceActivityLog({ actions }) {
  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="mb-4 text-2xl font-bold text-slate-900">Aapki Awaazein</h2>

      {actions.length === 0 ? (
        <p className="py-4 text-lg text-slate-500">Abhi koi command nahi aayi.</p>
      ) : (
        <ul className="space-y-3">
          {actions.map((action) => {
            const icon = !action.success ? '\u2717' : action.lowStock ? '\u26A0\uFE0F' : '\u2713';
            const tone = !action.success
              ? 'border-red-300 bg-red-50 text-red-900'
              : action.lowStock
                ? 'border-amber-400 bg-amber-50 text-amber-900'
                : 'border-emerald-300 bg-emerald-50 text-emerald-900';

            return (
              <li
                key={action.id}
                className={`rounded-xl border-2 p-3 sm:p-4 ${tone}`}
              >
                <p className="flex items-start gap-2 text-lg leading-snug sm:text-xl">
                  <span aria-hidden="true">{'\u{1F399}\uFE0F'}</span>
                  <span className="font-semibold">
                    &ldquo;{action.transcript}&rdquo;
                  </span>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm sm:text-base">
                  <span className="opacity-70">{relativeTime(action.createdAt)}</span>
                  <span aria-hidden="true">{icon}</span>
                  <span className="font-semibold">
                    {action.success
                      ? action.lowStock
                        ? 'Low stock'
                        : 'Inventory updated'
                      : 'Update nahi hua'}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
