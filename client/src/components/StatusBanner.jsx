/** The result of the last voice command: success, error, or a low-stock alert. */
export default function StatusBanner({ result }) {
  if (!result) return null;

  const tone = {
    success: 'border-emerald-500 bg-emerald-50 text-emerald-900',
    error: 'border-red-500 bg-red-50 text-red-900',
    info: 'border-slate-300 bg-slate-50 text-slate-800',
  }[result.tone] ?? 'border-slate-300 bg-slate-50 text-slate-800';

  return (
    <div
      role={result.tone === 'error' ? 'alert' : 'status'}
      className={`rounded-2xl border-2 p-4 sm:p-5 ${tone}`}
    >
      {result.message ? (
        <p className="text-xl font-semibold leading-relaxed sm:text-2xl">{result.message}</p>
      ) : null}

      {result.warning ? (
        <p className="mt-2 text-xl font-bold leading-relaxed sm:text-2xl">{result.warning}</p>
      ) : null}

      {result.transcript ? (
        <p className="mt-2 text-base text-slate-600 sm:text-lg">
          Aapne kaha: &ldquo;{result.transcript}&rdquo;
        </p>
      ) : null}
    </div>
  );
}
