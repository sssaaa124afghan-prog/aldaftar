// Small view helpers shared by the workout screens (text via h() → always escaped).
import { h, raw } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt } from '../../ui/num.js';
import { parseDayKey, weekday, diffDays } from '../../core/date.js';

export { h, raw, icon, fmt };

export const DAY_NAMES = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** <span class="num">…</span> with Latin digits */
export const N = (v, opts, cls = '') => h('span', { class: `num${cls ? ' ' + cls : ''}` }, typeof v === 'string' ? v : fmt(v, opts));

/** "الاتنين 19 أكتوبر" as nodes (day number in .num) */
export function dateLabel(key) {
  try {
    const d = parseDayKey(key);
    return [DAY_NAMES[d.getDay()], ' ', N(String(d.getDate())), ' ', MONTHS[d.getMonth()]];
  } catch { return ['—']; }
}

/** "النهارده" / "امبارح" / weekday within a week / date */
export function relDay(key, today) {
  try {
    const n = diffDays(key, today);
    if (n === 0) return ['النهارده'];
    if (n === 1) return ['امبارح'];
    if (n > 1 && n < 7) return [DAY_NAMES[weekday(key)]];
    return dateLabel(key);
  } catch { return ['—']; }
}

/**
 * «4 × 5-8» for Arabic: sets, ×, then the rep range in an LTR isolate, so the line reads right-to-left as
 * «4 × 5-8» and the range itself never flips to «8-5» (QA r3 #8).
 */
export const setsReps = (sets, reps) => h('span', { class: 'wk-sr' }, N(String(sets)), ' × ', h('bdi', { class: 'num', dir: 'ltr' }, String(reps || '—')));
/** Free text with digit ranges («سيب 1–2 عدّات», «8-12») → nodes with each range in an LTR <bdi class="num">. */
export function bidiRanges(text) {
  const out = []; const s = String(text ?? ''); const re = /\d+(?:\s*[–—-]\s*\d+)+/g; let i = 0, m;
  while ((m = re.exec(s))) { if (m.index > i) out.push(s.slice(i, m.index)); out.push(h('bdi', { class: 'num', dir: 'ltr' }, m[0])); i = m.index + m[0].length; }
  if (i < s.length) out.push(s.slice(i));
  return out;
}

export const ico = (name, size) => raw(icon(name, size ? { size } : undefined));

export function band({ title, sub, back, actions = [] }) {
  return h('header', { class: 'band center wk-band' },
    back ? h('button', { type: 'button', class: 'ibtn wk-back', 'aria-label': 'رجوع', onclick: back }, ico('back')) : null,
    h('div', { class: 'grow' }, h('h1', {}, title), sub ? h('p', {}, sub) : null),
    ...actions);
}

/** Run a write; on failure show the calm error toast and rethrow false. */
export async function safeWrite(ctx, fn) {
  try { await fn(); return true; }
  catch (e) {
    console.warn('[workout] write failed', e && (e.code || e.message));
    ctx.toast('ماقدرناش نحفظ دلوقتي — جرّب تاني.');
    return false;
  }
}

/** Whether we may vibrate (only after a user gesture, never mandatory). */
export function canVibrate() {
  try { return 'vibrate' in navigator && (!navigator.userActivation || navigator.userActivation.hasBeenActive); }
  catch { return false; }
}
