// Pure planner for the smart reminders (iOS shell, local notifications). No DOM / DB here: unit-tested.
// A local notification can't check anything when it fires (the app is asleep), so the plan is recomputed every time
// the day changes or the app goes to the background: what is still missing gets a reminder, what is done gets cancelled.
// Tomorrow's reminders are scheduled too with «nothing logged yet» texts: they are true exactly when the app is not
// opened that day, and they are replaced by the real numbers the moment it is.

export const SMART_DEFAULT = Object.freeze({ on: true, proteinAt: '21:00', trainAt: '19:30', proteinGap: 25 });
export const SMART_IDS = Object.freeze(['fc-smart-protein', 'fc-smart-train', 'fc-smart-protein-next', 'fc-smart-train-next']);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function smartSettings(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    on: o.on !== false,
    proteinAt: HHMM.test(o.proteinAt) ? o.proteinAt : SMART_DEFAULT.proteinAt,
    trainAt: HHMM.test(o.trainAt) ? o.trainAt : SMART_DEFAULT.trainAt,
    proteinGap: SMART_DEFAULT.proteinGap,
  };
}

/** Local time HH:MM on a day key → epoch ms. */
export function atMs(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi, 0, 0).getTime();
}

const trainText = (plan) => {
  if (!plan) return null;
  if (plan.kind === 'training') return { title: `النهارده ${plan.name || 'تمرين'} 🏋️`, body: `لسه ماتمرنتش. ${plan.exercises ? `${plan.exercises} تمارين` : 'الجلسة'}${plan.minutes ? ` في ${plan.minutes} دقيقة` : ''} وتخلص.`, route: '#/workout' };
  if (plan.kind === 'heart' && plan.cardio === 'boxing') return { title: 'النهارده يوم الملاكمة 🥊', body: 'لسه ماتمرنتش. 30–40 دقيقة شوال وتخلص.', route: '#/workout/boxing' };
  return null; // rest / heart / active / done → nothing to nag about
};

/**
 * smartPlan({now, day, nextDay, settings, target:{p}, eaten:{p, n}, plan, nextPlan}) → {schedule:[{id, at, title, body, route}], cancel:[id]}
 * plan / nextPlan = today-plan.js planForDay results ({kind, name, exercises, minutes, cardio}).
 */
export function smartPlan({ now = Date.now(), day, nextDay, settings, target = {}, eaten = {}, plan = null, nextPlan = null }) {
  const s = smartSettings(settings);
  const out = { schedule: [], cancel: [] };
  if (!s.on) { out.cancel = [...SMART_IDS]; return out; }
  const add = (id, at, t) => { if (t && at > now + 60_000) out.schedule.push({ id, at, ...t }); else out.cancel.push(id); };

  // today · protein
  const goal = Math.round(+target.p || 0);
  const left = Math.round(goal - (+eaten.p || 0));
  let protein = null;
  if (goal > 0) {
    if (!eaten.n) protein = { title: 'لسه مفيش أكل متسجل النهارده', body: `هدف البروتين ${goal} جم. سجّل اللي أكلته عشان الحساب يبقى مظبوط.`, route: '#/nutrition/add' };
    else if (left >= s.proteinGap) protein = { title: `ناقصك ${left} جم بروتين 🥩`, body: left >= 45 ? 'وجبة بروتين كاملة تقفلها (فراخ / تونة / سكوب + زبادي).' : 'سكوب بروتين أو علبة تونة يقفلوها قبل النوم.', route: '#/nutrition/add' };
  }
  add('fc-smart-protein', atMs(day, s.proteinAt), protein);

  // today · training
  add('fc-smart-train', atMs(day, s.trainAt), trainText(plan));

  // tomorrow (true if the app is not opened that day; replaced as soon as it is)
  if (nextDay) {
    add('fc-smart-protein-next', atMs(nextDay, s.proteinAt), goal > 0 ? { title: 'لسه مفيش أكل متسجل النهارده', body: `هدف البروتين ${goal} جم. سجّل اللي أكلته عشان الحساب يبقى مظبوط.`, route: '#/nutrition/add' } : null);
    add('fc-smart-train-next', atMs(nextDay, s.trainAt), trainText(nextPlan));
  }
  return out;
}
