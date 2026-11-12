// iOS shell only: today's snapshot for the home-screen / lock-screen widgets (the shell's widget extension).
// Sent on start, when food / sessions / settings change, and every time the app goes to the background.
// Stays on the phone (App Group container); nothing leaves the device.
import { isNative, post } from '../core/native.js';
import { sumEntries } from '../core/targets.js';
import { dayInfo } from './day.js';
import { todayPlan } from '../features/workout/today-plan.js';

import { widgetPayload, quickItems, planQueue } from './widgets-data.js';
import { dayKey } from '../core/date.js';
import { kvGet, dailyGet, dailyPatch, getEntriesStrict, putEntries, loadWeights } from '../features/nutrition/data.js';
import { listMeals, entriesFromMeal, sectionForHour, waterGoalMl } from '../features/nutrition/logic.js';
import { takeWidgetQueue } from '../core/native.js';

async function snapshot(ctx) {
  const day = ctx.today();
  const [info, log, plan, nkv, daily, weights] = await Promise.all([
    dayInfo(ctx.db, day, ctx.settings),
    ctx.db.get('foodLog', day).catch(() => null),
    todayPlan(ctx, day).catch(() => null),
    kvGet(ctx.db, 'nutrition'), dailyGet(ctx.db, day), loadWeights(ctx.db).catch(() => [])]);
  const eaten = sumEntries(log && Array.isArray(log.entries) ? log.entries : []);
  const kg = Array.isArray(weights) && weights.length ? weights[weights.length - 1].kg : null;
  return widgetPayload({ day, plan, target: info.target, eaten, waterMl: +daily.waterMl || 0, waterGoal: waterGoalMl(kg, info.type), quick: quickItems(listMeals(nkv.savedMeals)) });
}

/**
 * Applies what was tapped on the widget while the app slept (cups of water, saved meals) to the real data.
 * The shell hands the queue over once; meals that no longer exist are skipped. → number of things written.
 */
export async function applyWidgetQueue(ctx) {
  const queue = await takeWidgetQueue();
  if (!queue || !queue.length) return 0;
  const plan = planQueue(queue, (ms) => dayKey(new Date(ms)));
  let n = 0; let cups = 0; const names = [];
  for (const [day, ml] of Object.entries(plan.water)) {
    await dailyPatch(ctx.db, day, (d) => ({ ...d, waterMl: Math.max(0, Math.min(40 * 250, (+d.waterMl || 0) + ml)) }));
    cups += ml / 250; n++;
  }
  if (plan.meals.length) {
    const meals = listMeals((await kvGet(ctx.db, 'nutrition')).savedMeals);
    for (const q of plan.meals) {
      const meal = meals.find((m) => m.id === q.mealId);
      if (!meal) continue;
      const when = new Date(q.at);
      const entries = entriesFromMeal(meal, meal.section || sectionForHour(q.hour), when).map((e, i) => ({ ...e, id: `${e.id}w${i}`, src: 'widget' }));
      const cur = await getEntriesStrict(ctx.db, q.day);
      await putEntries(ctx.db, q.day, [...cur, ...entries]);
      names.push(meal.name); n++;
    }
  }
  if (n) {
    ctx.emit('food:changed', { widget: true });
    const parts = [cups ? `${cups} كوباية ميه` : '', ...names].filter(Boolean);
    try { ctx.toast(`اتسجّل من الويدجيت: ${parts.join(' · ')}`); } catch { /* ignore */ }
  }
  return n;
}

export function initWidgets(ctx) {
  if (!isNative() || typeof document === 'undefined') return;
  let t = 0, last = '';
  const run = async () => {
    clearTimeout(t); t = 0;
    try {
      await applyWidgetQueue(ctx).catch(() => 0); // widget taps first, so the snapshot below already counts them
      const data = await snapshot(ctx);
      const key = JSON.stringify({ ...data, at: 0 });
      if (key === last) return;
      last = key;
      post('widgetData', { json: JSON.stringify(data) });
    } catch { /* widgets are best effort */ }
  };
  const soon = () => { clearTimeout(t); t = setTimeout(run, 700); };
  for (const ev of ['food:changed', 'session:changed', 'settings:changed', 'weight:changed']) ctx.on(ev, soon);
  document.addEventListener('visibilitychange', () => { run(); }); // hidden: fresh numbers for the widgets · visible: apply widget taps
  setTimeout(run, 1500);
}
