// Local-time day keys. All app dates are "YYYY-MM-DD" in the DEVICE time zone (UAE = UTC+4).
// Never build a day key from toISOString(): that is UTC and files 00:00-03:59 under yesterday.

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');

/** Day key for a Date (default: now) in local time. */
export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new RangeError('invalid date');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Shortcut for today's key. */
export const today = (now = new Date()) => dayKey(now);

/** True if s is a real calendar date in YYYY-MM-DD form. */
export function isDayKey(s) {
  if (typeof s !== 'string') return false;
  const m = DAY_KEY_RE.exec(s);
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

/** Day key → Date at local midnight. Throws on bad input. */
export function parseDayKey(key) {
  if (!isDayKey(key)) throw new RangeError(`invalid day key: ${key}`);
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add n days (can be negative). Uses calendar arithmetic, safe across DST. */
export function addDays(key, n) {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a, b) {
  const ms = parseDayKey(b) - parseDayKey(a);
  return Math.round(ms / 86400000);
}

/** 0 = Sunday ... 6 = Saturday (same as Date#getDay). */
export const weekday = (key) => parseDayKey(key).getDay();

/** Start of the week containing key. startDow: 1 = Monday (default), 6 = Saturday, 0 = Sunday. */
export function weekStart(key, startDow = 1) {
  if (!Number.isInteger(startDow) || startDow < 0 || startDow > 6) throw new RangeError('startDow must be 0..6');
  const back = (weekday(key) - startDow + 7) % 7;
  return addDays(key, -back);
}

/** The 7 day keys of the week containing key. */
export function weekDays(key, startDow = 1) {
  const s = weekStart(key, startDow);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** Local day key of an ISO timestamp / epoch ms (e.g. legacy session dates). null if invalid. */
export function dayKeyFromInstant(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
  return Number.isNaN(d.getTime()) ? null : dayKey(d);
}

/** Inclusive range of day keys from a to b. */
export function dayRange(a, b) {
  const out = [];
  for (let k = a; k <= b; k = addDays(k, 1)) out.push(k);
  return out;
}
