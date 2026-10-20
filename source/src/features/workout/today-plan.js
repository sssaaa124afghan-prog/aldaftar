// Today's plan glue for the overview: new-plan confirm card, «معاك كام دقيقة؟» time chips with the autopilot diff,
// and the start-time computation (mesocycle week, auto-deload in week 6, weekly balance, carry-over ledger).
import { h, N, ico, safeWrite } from './view.js';
import * as L from './logic.js';
import { NEW_PROGRAM, PROGRAMS } from './exercises.js';
import { loadProgram, saveProgram, patchTraining } from './store.js';
import './plan.css';

export const BUDGETS = [30, 45, 60, 75];
export const OLD_NAME = 'برنامجي القديم';

/** Mesocycle week (1–6) for a program that runs the 6-week block; null otherwise. */
export function weekOf(program, today) {
  return L.programFlags(program).meso ? L.mesoWeek(program.startDay, today) : null;
}

/**
 * Everything startSession needs, from the same pure functions the preview uses.
 * → {items, plan:{budget, minutes, baseMinutes, changes}, carryNext, week, deload}
 */
export function prepareStart(ctx, { program, sessions, training, dayId, budget = 60, today }) {
  const e = L.dayEstimate({ program, sessions, today, dayId, training, budgetMin: budget,
    weekStartDow: ctx.settings.get('weekStart') ?? 1, trainingDays: ctx.settings.get('trainingDays') || null });
  const r = e.plan;
  return { items: r.items, week: e.week, deload: e.deload, carryNext: r.carryNext,
    plan: { budget, minutes: r.minutes, z2: e.z2, total: e.total, baseMinutes: r.baseMinutes, fits: r.fits !== false, changes: r.changes.map(({ code, text }) => ({ code, text })) } };
}

/** «معاك كام دقيقة؟» chips + the diff of what the autopilot changed. onPick(budget) re-renders the caller. */
export function budgetPicker(ctx, { prep, budget, onPick }) {
  const wrap = h('div', { class: 'wk-budget' },
    h('p', { class: 'wk-budget-q', id: 'wk-budget-l' }, 'معاك كام دقيقة؟'),
    h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'wk-budget-l' },
      ...BUDGETS.map((m) => h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(m === budget), dataset: { fk: `bud${m}` },
        onclick: () => { if (m !== budget) onPick(m); } }, N(String(m)), ' د'))));
  const ch = prep.plan.changes;
  if (prep.deload) wrap.appendChild(h('p', { class: 'wk-hint quiet' }, ico('trend'), h('span', {}, prep.week === 6 ? 'أسبوع 6 · تخفيف تلقائي: نص المجموعات ووزن أقل 10%' : 'أسبوع خفيف: نص المجموعات ووزن أقل 10%')));
  if (ch.length) {
    wrap.appendChild(h('div', { class: 'wk-diff', role: 'status' },
      h('p', {}, budget < 60 || ch.some((c) => c.code === 'rest' || c.code === 'set' || c.code === 'drop')
        ? ['علشان ', N(String(budget)), ' د: من ', N(String(prep.plan.baseMinutes)), ' لـ ', N(String(prep.plan.minutes)), ' دقيقة']
        : 'تعديلات الأسبوع'),
      h('ul', {}, ...ch.map((c) => h('li', { class: `c-${c.code}` }, c.text)))));
  }
  if (!prep.plan.fits) wrap.appendChild(h('p', { class: 'wk-hint warn' }, 'لسه أطول من الوقت ده شوية — الأساسيات اتحافظ عليها.'));
  return wrap;
}

/** The one-time confirm card for existing users: switch to the new plan, keep the old one selectable. */
export function newPlanCard(ctx, { program, training, onDone }) {
  if (program.activeProgram === NEW_PROGRAM || training.newPlan?.decided) return null;
  const t = PROGRAMS[NEW_PROGRAM];
  return h('section', { class: 'sheet-card wk-newplan', 'aria-labelledby': 'wk-np-h' },
    h('h3', { id: 'wk-np-h' }, 'خطة جديدة جاهزة', h('small', {}, 'أعلى/أسفل · 4 أيام')),
    h('p', { class: 'wk-muted' }, t.note),
    h('ul', { class: 'wk-np-list' },
      h('li', {}, 'الاتنين Upper A · التلات Lower A · الخميس Upper B · الجمعة Lower B'),
      h('li', {}, 'السبت يوم القلب ٣٠ د · الأربع والحد راحة ومشي'),
      h('li', {}, 'دورة ٦ أسابيع: الأسبوع السادس تخفيف تلقائي')),
    h('p', { class: 'wk-muted' }, 'خطتك الحالية هتتحفظ باسم «', OLD_NAME, '» وتقدر ترجعلها من شاشة الخطة.'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn sm', dataset: { fk: 'np-on' }, onclick: async () => { if (await activateNewPlan(ctx, training)) onDone(); } }, 'فعّل الخطة الجديدة'),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => {
        if (await safeWrite(ctx, () => patchTraining(ctx.db, { newPlan: { decided: 'later', at: ctx.today() } }))) onDone();
      } }, 'مش دلوقتي')));
}

/** Save the current plan as «برنامجي القديم», switch to the new template (schedule, start date = today), set training days. */
export async function activateNewPlan(ctx, training = {}) {
  const today = ctx.today();
  const tdBefore = ctx.settings.get('trainingDays') || null;
  const { program, rec } = await loadProgram(ctx.db);
  const next = L.fromTemplate(NEW_PROGRAM, { startDay: today });
  next.previous = { name: OLD_NAME, savedAt: today, program: { activeProgram: program.activeProgram, order: program.order, days: program.days, ...(program.schedule ? { schedule: program.schedule } : {}), ...(program.startDay ? { startDay: program.startDay } : {}) } };
  const ok = await safeWrite(ctx, async () => {
    await saveProgram(ctx.db, next, rec);
    await patchTraining(ctx.db, { newPlan: { decided: 'on', at: today }, carry: {} });
  });
  if (!ok) return false;
  try { await ctx.settings.set('trainingDays', [1, 2, 4, 5]); } catch { /* settings are best effort */ }
  ctx.emit('session:changed', { state: 'plan' });
  ctx.toast('الخطة الجديدة اتفعّلت · خطتك القديمة محفوظة', { action: { label: 'تراجع', run: async () => {
    const { rec: r2 } = await loadProgram(ctx.db);
    const old = L.normalizeProgram({ v: 2, ...next.previous.program });
    if (next.previous.program.schedule) old.schedule = next.previous.program.schedule; else delete old.schedule;
    old.previous = null;
    if (await safeWrite(ctx, async () => { await saveProgram(ctx.db, old, r2); await patchTraining(ctx.db, { newPlan: { ...training.newPlan, decided: null } }); })) {
      try { if (tdBefore) await ctx.settings.set('trainingDays', tdBefore); } catch { /* ignore */ }
      ctx.emit('session:changed', { state: 'plan' });
    }
  } } });
  return true;
}

/** Saturday on the new plan: the Heart Day card (route owned by heart.js). */
export function heartDayCard(program, today, weekdayOf) {
  const { heartDow } = L.programFlags(program);
  if (heartDow === null || weekdayOf(today) !== heartDow) return null;
  return h('a', { class: 'wk-recov glass', href: '#/workout/heart' },
    h('span', { class: 'ic' }, ico('heart')),
    h('span', { class: 'grow' }, h('b', {}, 'يوم القلب'), h('small', {}, '30 دقيقة · Zone 2 أو فترات + ضغط ثابت + قاع الحوض')), ico('chevron'));
}
