// iOS shell: smart reminders as local notifications (planner: smart-reminders-plan.js). Settings key 'remind.smart'.
import { isNative, scheduleNotification, cancelNotification } from '../core/native.js';
import { sumEntries } from '../core/targets.js';
import { addDays } from '../core/date.js';
import { dayInfo } from './day.js';
import { todayPlan } from '../features/workout/today-plan.js';
import { smartPlan } from './smart-reminders-plan.js';

export async function syncSmartReminders(ctx) {
  if (!isNative()) return null;
  const day = ctx.today(), nextDay = addDays(day, 1);
  const [info, log, plan, nextPlan] = await Promise.all([
    dayInfo(ctx.db, day, ctx.settings), ctx.db.get('foodLog', day).catch(() => null),
    todayPlan(ctx, day).catch(() => null), todayPlan(ctx, nextDay).catch(() => null)]);
  const entries = log && Array.isArray(log.entries) ? log.entries : [];
  const eaten = sumEntries(entries);
  const res = smartPlan({ day, nextDay, settings: ctx.settings.get('remind.smart'), target: info.target, eaten: { p: eaten.p, n: entries.length }, plan, nextPlan });
  for (const id of res.cancel) cancelNotification(id);
  for (const n of res.schedule) scheduleNotification(n);
  return res;
}

export function initSmartReminders(ctx) {
  if (!isNative() || typeof document === 'undefined') return;
  let t = 0, last = '';
  const run = () => {
    clearTimeout(t); t = 0;
    syncSmartReminders(ctx).then((r) => { last = JSON.stringify(r); }).catch(() => {});
  };
  const soon = () => { clearTimeout(t); t = setTimeout(run, 900); };
  for (const ev of ['food:changed', 'session:changed', 'settings:changed']) ctx.on(ev, soon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') run(); else soon(); });
  setTimeout(run, 2500);
  void last;
}
