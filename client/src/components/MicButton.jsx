/**
 * The single most important control on the page.
 *
 * One big button. Tap to start, tap again to stop. The label always says what
 * the button will do next, and every non-idle state is spelled out.
 */

const LABELS = {
  idle: { emoji: '\u{1F399}\uFE0F', title: 'Bolkar Bataiye', hint: 'Bolne ke liye dabayein. Dobara dabakar band karein.' },
  recording: { emoji: '\u{1F534}', title: 'Recording... Bolna shuru karein', hint: 'Bolkar command dein, phir dobara dabayein.' },
  thinking: { emoji: '\u23F3\uFE0F', title: 'Samajh raha hoon...', hint: 'Thoda intezaar karein.' },
  done: { emoji: '\u2713', title: 'Ho gaya', hint: '' },
};

const RING = {
  idle: 'ring-slate-300',
  recording: 'ring-red-500',
  thinking: 'ring-amber-400',
  done: 'ring-emerald-500',
};

const FILL = {
  idle: 'bg-red-600 hover:bg-red-700 active:bg-red-800',
  recording: 'bg-red-700 hover:bg-red-800 animate-pulse',
  thinking: 'bg-slate-400 cursor-wait',
  done: 'bg-emerald-600',
};

export default function MicButton({ state, onToggle, disabled }) {
  const cfg = LABELS[state] ?? LABELS.idle;
  const busy = state === 'thinking';

  return (
    <div className="flex flex-col items-center gap-5">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled || busy}
        aria-label={cfg.title}
        aria-live="polite"
        data-state={state}
        className={[
          'group relative flex h-40 w-40 items-center justify-center rounded-full',
          'text-white shadow-xl ring-8 transition-all duration-200',
          'focus:outline-none focus-visible:ring-offset-4 sm:h-48 sm:w-48',
          FILL[state] ?? FILL.idle,
          RING[state] ?? RING.idle,
          disabled && !busy ? 'opacity-50' : '',
          'cursor-pointer disabled:cursor-not-allowed',
        ].join(' ')}
      >
        <span className="flex flex-col items-center gap-2 px-3 text-center">
          <span className="text-5xl leading-none sm:text-6xl" aria-hidden="true">
            {cfg.emoji}
          </span>
        </span>
      </button>

      <div className="text-center">
        <p
          className={[
            'text-2xl font-bold sm:text-3xl',
            state === 'recording' ? 'text-red-700' : 'text-slate-900',
          ].join(' ')}
        >
          {cfg.title}
        </p>
        {cfg.hint ? <p className="mt-1 text-base text-slate-600 sm:text-lg">{cfg.hint}</p> : null}
      </div>
    </div>
  );
}

export { LABELS as MIC_STATES };
