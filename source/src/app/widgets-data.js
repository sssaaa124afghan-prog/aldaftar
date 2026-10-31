// Pure widget snapshot shape (no DOM / CSS imports, unit-tested).
const r = (x) => Math.round(+x || 0);

/** Pure: today's plan + food → widget JSON (exported for tests). */
export function widgetPayload({ day, plan, target, eaten, now = Date.now() }) {
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
  };
}

