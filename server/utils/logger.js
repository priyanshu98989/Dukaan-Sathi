/** Minimal leveled logger. Quiet by default, set LOG_LEVEL=debug for detail. */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function emit(level, tag, args) {
  if (LEVELS[level] > current) return;
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} [${tag}]`;
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line, ...args);
}

export const logger = {
  error: (tag, ...a) => emit('error', tag, a),
  warn: (tag, ...a) => emit('warn', tag, a),
  info: (tag, ...a) => emit('info', tag, a),
  debug: (tag, ...a) => emit('debug', tag, a),
};
