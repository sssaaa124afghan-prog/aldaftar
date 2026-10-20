// Meal reminders: opt-in (off by default), at most 2 a day, only while the app is open or in the background tab
// (no push server). Settings key 'nu.reminders' = {on:boolean, times:['HH:MM', ...≤2]}.
import { sumEntries } from '../../core/targets.js';
import { getEntries, dayTarget } from './data.js';

export const REMINDER_DEFAULT = Object.freeze({ on: false, times: ['13:30', '20:30'] });
export const MAX_REMINDERS = 2;

/** Normalised reminder settings: ≤ 2 valid HH:MM times, sorted, unique. */
export function reminderSettings(v) {
  const o = v && typeof v === 'object' ? v : {};
  const times = [...new Set((Array.isArray(o.times) ? o.times : REMINDER_DEFAULT.times).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort().slice(0, MAX_REMINDERS);
  return { on: o.on === true, times };
}

/** ms until the next occurrence of HH:MM today (null when already passed). */
export function msUntil(hhmm, now = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date(now); t.setHours(h, m, 0, 0);
  const d = t - now;
  return d > 0 ? d : null;
}

let timers = [];
let started = false;
let fired = new Set();

async function fire(ctx, hhmm) {
  const day = ctx.today();
  const key = `${day} ${hhmm}`;
  if (fired.has(key)) return;
  fired.add(key);
  let text = 'وقت تسجّل وجبتك.';
  try {
    const [t, es] = await Promise.all([dayTarget(ctx, day), getEntries(ctx.db, day)]);
    const it = sumEntries(es);
    const p = Math.round(t.p - it.p);
    text = !es.length ? 'لسه مفيش أكل متسجل النهارده.' : p > 5 ? `فاضل ${p} جم بروتين النهارده.` : 'البروتين وصل. سجّل باقي أكلك.';
  } catch { /* default text */ }
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';
  if (!visible && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg && reg.showNotification) await reg.showNotification('تذكير الأكل', { body: text, tag: 'nu-reminder', lang: 'ar', dir: 'rtl' });
      else new Notification('تذكير الأكل', { body: text, tag: 'nu-reminder', lang: 'ar', dir: 'rtl' });
      return;
    } catch { /* fall back to toast */ }
  }
  ctx.toast(text, { action: { label: 'سجّل', run: () => ctx.go('nutrition/add') } });
}

/** (Re)schedule today's reminders. Safe to call many times. */
export function startReminders(ctx) {
  if (!started) {
    started = true;
    ctx.on('settings:changed', (d) => { if (d && d.key === 'nu.reminders') schedule(ctx); });
  }
  schedule(ctx);
}

function schedule(ctx) {
  timers.forEach(clearTimeout); timers = [];
  const s = reminderSettings(ctx.settings.get('nu.reminders'));
  if (!s.on) return;
  for (const t of s.times) {
    const ms = msUntil(t);
    if (ms !== null && ms < 864e5) timers.push(setTimeout(() => fire(ctx, t), ms));
  }
}

export function _resetForTests() { timers.forEach(clearTimeout); timers = []; started = false; fired = new Set(); }
