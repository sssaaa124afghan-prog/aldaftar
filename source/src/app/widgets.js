// iOS shell only: today's snapshot for the home-screen / lock-screen widgets (the shell's widget extension).
// Sent on start, when food / sessions / settings change, and every time the app goes to the background.
// Stays on the phone (App Group container); nothing leaves the device.
import { isNative, post } from '../core/native.js';
import { sumEntries } from '../core/targets.js';
import { dayInfo } from './day.js';
import { todayPlan } from '../features/workout/today-plan.js';

import { widgetPayload } from './widgets-data.js';

async function snapshot(ctx) {
  const day = ctx.today();
  const [info, log, plan] = await Promise.all([
    dayInfo(ctx.db, day, ctx.settings),
    ctx.db.get('foodLog', day).catch(() => null),
    todayPlan(ctx, day).catch(() => null)]);
  const eaten = sumEntries(log && Array.isArray(log.entries) ? log.entries : []);
  return widgetPayload({ day, plan, target: info.target, eaten });
}

export function initWidgets(ctx) {
  if (!isNative() || typeof document === 'undefined') return;
  let t = 0, last = '';
  const run = async () => {
    clearTimeout(t); t = 0;
    try {
      const data = await snapshot(ctx);
      const key = JSON.stringify({ ...data, at: 0 });
      if (key === last) return;
      last = key;
      post('widgetData', { json: JSON.stringify(data) });
    } catch { /* widgets are best effort */ }
  };
  const soon = () => { clearTimeout(t); t = setTimeout(run, 700); };
  for (const ev of ['food:changed', 'session:changed', 'settings:changed', 'weight:changed']) ctx.on(ev, soon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') run(); });
  setTimeout(run, 1500);
}
