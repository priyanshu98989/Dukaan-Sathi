/** The shop's sign at the bottom of the page: what this is, and where to find it. */

const REPO_URL = import.meta.env.VITE_REPO_URL ?? 'https://github.com/priyanshu98989/Dukaan-Sathi';
const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://client-bay-alpha-22.vercel.app';

export default function AppFooter() {
  return (
    <footer className="border-t-2 border-slate-200 bg-white px-4 py-6 text-center sm:px-6">
      <p className="text-sm text-slate-500">
        Dukaan Sathi &mdash; apne aap apna stock update karne wala dukaan
      </p>

      <p className="mt-2 text-sm font-semibold text-slate-700">
        Website:{' '}
        <a
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-slate-900 underline decoration-slate-400 underline-offset-2 hover:decoration-slate-900"
        >
          {SITE_URL}
        </a>
      </p>

      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-2 rounded-lg border-2 border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-5 w-5 fill-current">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        GitHub par code dekhein
      </a>
    </footer>
  );
}