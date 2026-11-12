// Pure widget snapshot shape (no DOM / CSS imports, unit-tested).
const r = (x) => Math.round(+x || 0);

/** Pure: today's plan + food → widget JSON (exported for tests). */
/**
 * Quick-log buttons for the widget: a cup of water + the two newest saved meals («وجباتي»).
 * meals = listMeals() output ([{id, name, totals:{kcal,p,c,f}}]).
 */
export function quickItems(meals = []) {
  const out = [{ id: 'water', kind: 'water', label: 'كوباية ميه', ml: 250, kcal: 0, p: 0, c: 0, f: 0 }];
  for (const m of meals.slice(0, 2)) {
    if (!m || !m.id || !m.totals) continue;
    out.push({ id: `m:${m.id}`, kind: 'meal', label: String(m.name || 'وجبة').slice(0, 18), ml: 0, kcal: r(m.totals.kcal), p: r(m.totals.p), c: r(m.totals.c), f: r(m.totals.f) });
  }
  return out;
}

/**
 * Widget taps waiting in the shell ([{id, at}]) → what to write: {water:{[day]: ml}, meals:[{day, hour, mealId, at}], skipped}.
 * dayOf(ms) → day key (local).
 */
export function planQueue(queue, dayOf) {
  const water = {}; const meals = []; let skipped = 0;
  for (const q of Array.isArray(queue) ? queue : []) {
    const at = Number(q && q.at); const id = String((q && q.id) || '');
    if (!Number.isFinite(at) || at <= 0 || at > Date.now() + 60_000) { skipped++; continue; }
    const day = dayOf(at);
    if (id === 'water') water[day] = (water[day] || 0) + 250;
    else if (id.startsWith('m:')) meals.push({ day, hour: new Date(at).getHours(), mealId: id.slice(2), at });
    else skipped++;
  }
  return { water, meals, skipped };
}

export function widgetPayload({ day, plan, target, eaten, waterMl = 0, waterGoal = 0, quick = [], now = Date.now() }) {
  let kind = 'rest', title = 'يوم راحة', sub = 'كُل كويس ونام بدري', link = '#/today';
  if (plan) {
    if (plan.kind === 'active') { kind = 'active'; title = plan.live?.dayName || plan.name || 'التمرين'; sub = 'الجلسة شغالة · كمّل'; link = '#/workout/session'; }
    else if (plan.kind === 'done') { kind = 'done'; title = 'خلصت تمرين النهارده ✓'; sub = plan.doneToday?.dayName || plan.name || ''; link = '#/progress'; }
    else if (plan.kind === 'training') { kind = 'training'; title = plan.name || 'تمرين'; sub = `${r(plan.exercises)} تمارين · ${r(plan.minutes)} د`; link = '#/workout'; }
    else if (plan.kind === 'heart' && plan.cardio === 'boxing') { kind = 'boxing'; title = 'يوم الملاكمة'; sub = 'جولات شوال · 30–40 د'; link = '#/workout/boxing'; }
    else if (plan.kind === 'heart') { kind = 'heart'; title = 'يوم القلب'; sub = 'كارديو + ضغط'; link = '#/workout/heart'; }
  }
  return {
    v: 1, day, at: now,
    workout: { kind, title: String(title).slice(0, 40), sub: String(sub).slice(0, 60), link },
    food: { kcal: r(eaten.kcal), kcalGoal: r(target.kcal), p: r(eaten.p), pGoal: r(target.p), c: r(eaten.c), cGoal: r(target.c), f: r(eaten.f), fGoal: r(target.f) },
    water: { ml: r(waterMl), goal: r(waterGoal) },
    quick,
  };
}

