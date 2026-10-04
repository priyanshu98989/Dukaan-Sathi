/** "Just now" / "2 min ago" / "3 hr ago" / "5 din pehle" */
export function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (seconds < 45) return 'Just now';
  if (seconds < 90) return '1 min ago';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Kal';
  if (days < 30) return `${days} din pehle`;

  const months = Math.floor(days / 30);
  return months <= 1 ? '1 mahine pehle' : `${months} mahine pehle`;
}

/** 20 -> "20", 3.5 -> "3.5" */
export function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}

/** 1 packet vs 3 packets; kg and L are invariant. */
export function formatUnit(quantity, unit) {
  if (Number(quantity) === 1 && unit === 'packets') return 'packet';
  return unit;
}

export function formatQtyWithUnit(quantity, unit) {
  return `${formatQty(quantity)} ${formatUnit(quantity, unit)}`;
}
