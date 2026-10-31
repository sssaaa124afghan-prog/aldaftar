// Latin digits, thousands separators, real minus sign. Wrap figures in <span class="num"> (numH does it).
import { html } from '../core/esc.js';

const cache = new Map();
const nf = (dp) => {
  if (!cache.has(dp)) cache.set(dp, new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp }));
  return cache.get(dp);
};

/** fmt(1602) → "1,602"; fmt(-19) → "−19"; fmt(78.44,{dp:1}) → "78.4"; fmt(4,{sign:true}) → "+4"; null → "—" */
export function fmt(n, { dp = 0, sign = false, dash = '—' } = {}) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return dash;
  const v = Number(n);
  const s = nf(dp).format(Math.abs(v));
  if (s === '0' || /^0(\.0+)?$/.test(s)) return '0';
  if (v < 0) return '−' + s;
  return sign ? '+' + s : s;
}

/** numH(n, opts, cls) → html`<span class="num">…</span>` */
export const numH = (n, opts = {}, cls = '') => html`<span class="num${cls ? ' ' + cls : ''}">${fmt(n, opts)}</span>`;

/** Parse user input: accepts Arabic-Indic digits and comma decimals. NaN on junk. */
export function parseNum(s) {
  if (typeof s === 'number') return s;
  const t = String(s ?? '').trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0))
    .replace(/[٫,]/g, '.').replace(/−/g, '-');
  return t === '' ? NaN : Number(t);
}

/** Arabic count forms [1, 2, 3–10, 11+]. */
export const COUNT = Object.freeze({
  exercise: ['تمرين', 'تمرينين', 'تمارين', 'تمرين'],
  day: ['يوم', 'يومين', 'أيام', 'يوم'],
  set: ['مجموعة', 'مجموعتين', 'مجموعات', 'مجموعة'],
  meal: ['وجبة', 'وجبتين', 'وجبات', 'وجبة'],
  session: ['جلسة', 'جلستين', 'جلسات', 'جلسة'],
  change: ['تعديل', 'تعديلين', 'تعديلات', 'تعديل'],
});
/** countWord(3,'day') → "أيام"; 1 → "يوم"; 2 → "يومين"; 11+ → "يوم" (0 → 3–10 form). */
export function countWord(n, kind) {
  const f = COUNT[kind] || kind;
  const v = Math.abs(Math.trunc(Number(n) || 0)) % 100 === 0 && Number(n) !== 0 ? 11 : Math.abs(Math.trunc(Number(n) || 0));
  if (v === 1) return f[0];
  if (v === 2) return f[1];
  if (v === 0 || (v >= 3 && v <= 10) || (v % 100 >= 3 && v % 100 <= 10)) return f[2];
  return f[3];
}
/** countText(1,'exercise') → "1 تمرين" */
export const countText = (n, kind) => `${fmt(n)} ${countWord(n, kind)}`;
