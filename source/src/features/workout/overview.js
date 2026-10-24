// #/workout — today's planned session, start/continue, quick session, program overview.
import { fill } from '../../ui/dom.js';
import { h, N, ico, band, relDay, safeWrite, DAY_NAMES, setsReps } from './view.js';
import { countWord } from '../../ui/num.js';
import * as L from './logic.js';
import { loadAll, loadProgram, saveProgram, loadTraining, patchTraining, putSession, loadGateInputs } from './store.js';
import { weekday, addDays, diffDays } from '../../core/date.js';
import { videoLink, videoSource } from './exercise-videos.js';
import { prepareStart, budgetPicker, newPlanCard, heartDayCard, weekOf, planForDay } from './today-plan.js';

// «معاك كام دقيقة؟»: the pick lives for the day (default 60)
const budgetFor = (today) => L.budgetFor(today);

export async function startSession(ctx, { dayId, quick = false, budget = null } = {}) {
  const { all, live } = await loadAll(ctx.db);
  if (live) { ctx.go('workout/session'); return; }
  const { program, rec } = await loadProgram(ctx.db);
  const today = ctx.today();
  const id = program.days[dayId] ? dayId : L.nextDayId(program, all, today);
  const day = program.days[id];
  const [training, gi] = await Promise.all([loadTraining(ctx.db), loadGateInputs(ctx.db, today)]);
  const flags = L.programFlags(program);
  // the 6-week block starts with the first session when the plan has no start date yet
  if (flags.meso && !program.startDay) { program.startDay = today; await safeWrite(ctx, () => saveProgram(ctx.db, program, rec)); }
  const prep = prepareStart(ctx, { program, sessions: L.finished(all), training, dayId: id, budget: budget || budgetFor(today), today });
  const deload = prep.deload;
  const gap = L.gapDays(all, today);
  const items = quick ? L.quickItems(day.items) : prep.items;
  const phase = !flags.meso && ctx.settings.get('wk.periodization') === true ? L.phaseOf(program.startDay, today)?.type || null : null;
  const bwNow = [...gi.bw].filter((x) => x && +x.kg > 0 && x.day).sort((a, b) => String(a.day).localeCompare(String(b.day))).pop()?.kg || 0;
  const s = L.buildLive({ items, dayId: id, dayName: quick ? `${day.name} · سريعة` : day.name, sessions: all, deload,
    lighter: !deload && !prep.reentry && gap !== null && gap >= 7, quick, program: program.activeProgram,
    readiness: L.readinessOf(gi.daily), bwDrop: L.bwDrop(gi.bw), load: L.trainingLoad(all, today).level, phase,
    home: ctx.settings.get('wk.home') === true, bw: bwNow, week: prep.week ?? null, warm: day.warm || null, warmNote: day.warmNote || '',
    z2: flags.z2 && !quick, plan: quick ? null : prep.plan, reentry: prep.reentry });
  if (!(await safeWrite(ctx, () => putSession(ctx.db, s)))) return;
  if (!quick) await safeWrite(ctx, () => patchTraining(ctx.db, { carry: prep.carryNext }));
  ctx.go('workout/session');
  ctx.emit('session:changed', { id: s.id, state: 'active' });
}

// One render per element at a time: a newer render (activate → onDone + the session:changed event both re-route) wins and
// an older one that is still awaiting the db bails out instead of appending a second copy of the page (UX B2).
const renderTok = new WeakMap();

export async function renderOverview(el, ctx, params = {}) {
  const tok = (renderTok.get(el) || 0) + 1;
  renderTok.set(el, tok);
  const stale = () => renderTok.get(el) !== tok || !el.isConnected;
  const today = ctx.today();
  const [{ all, live, done }, { program, rec: progRec }, training] = await Promise.all([loadAll(ctx.db), loadProgram(ctx.db), loadTraining(ctx.db)]);
  if (stale()) return undefined;
  // today's planned day: the same answer Today shows (today-plan.js todayPlan / planForDay)
  const tp = planForDay(ctx, { program, sessions: all, training, day: today });
  const trainingDays = tp.trainingDays;
  const isTrainDay = tp.isTrainDay;
  const wk = L.weeksOnPlan(done, { plannedPerWeek: trainingDays.length || 4, weekStartDow: ctx.settings.get('weekStart') ?? 1, today });
  const nextId = tp.dayId;
  const dayId = program.days[params.day] ? params.day : nextId;
  const day = program.days[dayId];
  const doneToday = done.filter((s) => s.day === today).pop();
  const deloadOn = L.deloadActive(training.deload, today);
  const dl = L.deloadCheck(done, { today, deload: training.deload });
  const dismissed = training.deload?.dismissed && training.deload.dismissed >= addDays(today, -6);
  const gap = L.gapDays(done, today);
  const [gi, planMod] = await Promise.all([loadGateInputs(ctx.db, today), !live ? import('./plan.js').catch(() => null) : null]);
  if (stale()) return undefined;
  el.textContent = '';
  const activeInj = L.activeInjuries(training.injuries).length;

  el.appendChild(band({
    title: 'التمرين',
    sub: [N(String(wk.thisWeek)), ' من ', N(String(wk.planned)), ' جلسات الأسبوع ده', wk.weeks ? [' · ', N(String(wk.weeks)), ' أسبوع على الخطة'] : null],
  }));

  // ── next action ──
  const next = h('section', { class: 'next wk-next-action', 'aria-labelledby': 'wk-next-h' });
  if (live) {
    const total = live.exercises.reduce((n, e) => n + (e.skipped ? 0 : e.sets.length), 0);
    const doneN = live.exercises.reduce((n, e) => n + e.sets.filter((t) => t.done).length, 0);
    const mins = Math.max(0, Math.round((Date.now() - (live.startedMs || Date.parse(live.startedAt))) / 60000));
    next.append(
      h('h2', { id: 'wk-next-h' }, live.dayName, ' شغّال'),
      h('p', {}, N(`${doneN}/${total}`), ' مجموعة · بدأت من ', N(String(mins)), ' دقيقة'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.go('workout/session') }, ico('play'), 'كمّل التمرين'));
  } else if (doneToday && !params.day) {
    next.append(
      h('h2', { id: 'wk-next-h' }, doneToday.dayName || 'جلسة النهارده'),
      h('div', { class: 'wk-closed' },
        h('div', { class: 'wk-tot' }, h('span', {}, 'المجموعات'), N(String(L.sessionSetCount(doneToday)))),
        h('div', { class: 'wk-tot' }, h('span', {}, 'الحجم'), h('span', {}, N(L.fmtInt(L.sessionVolume(doneToday))), ' كجم')),
        h('div', { class: 'wk-tot grand rule-open rule-closed' }, h('span', {}, 'الجلسة اتقفلت'), h('span', {}, N(String(doneToday.durationMin || 0)), ' دقيقة'))),
      h('p', { class: 'wk-after' }, 'الجاي: ', program.days[nextId]?.name || '', ' · ', nextTrainLabel(today, trainingDays)));
  } else {
    const budget = budgetFor(today);
    const prep = dayId === tp.dayId && tp.prep ? tp.prep : prepareStart(ctx, { program, sessions: done, training, dayId, budget, today });
    const est = prep.plan.minutes;
    const last = done.filter((s) => s.dayKey === dayId).pop();
    if (!isTrainDay && !params.day) {
      next.append(h('h2', { id: 'wk-next-h' }, 'يوم راحة'),
        h('p', {}, 'الراحة جزء من الخطة. لو حابب تتمرن، الجاي ', day.name, '.'));
    } else {
      next.append(h('h2', { id: 'wk-next-h' }, day.name),
        h('p', {}, N(String(day.items.length)), ` ${countWord(day.items.length, 'exercise')} · حوالي `, N(String(est), undefined, 'wk-est'), ' دقيقة', prep.plan.z2 ? [' + Zone 2 ‏', N(String(prep.plan.z2), undefined, 'wk-z2'), ' د'] : null, last ? [' · آخر مرة ', ...relDay(last.day, today)] : null));
    }
    const re = prep.reentry;
    if (re) next.appendChild(h('p', { class: 'wk-note' }, 'أسبوع رجوع ', N(String(re.week)), ' من ', N(String(re.of)), ' · أوزان أخف ومجموعات أقل، وسيب 3–4 عدّات.'));
    else if (gap !== null && gap >= 7 && !deloadOn) next.appendChild(h('p', { class: 'wk-note' }, 'أهلاً بيك تاني. أول جلسة هتبقى أخف 10% علشان ترجع بأمان.'));
    if (isTrainDay || params.day) {
      const slot = h('div', { class: 'wk-budget-slot' });
      const paint = (m) => {
        L.pickBudget(today, m);
        const p2 = m === budget ? prep : prepareStart(ctx, { program, sessions: done, training, dayId, budget: m, today });
        fill(slot, budgetPicker(ctx, { prep: p2, budget: m, onPick: (v) => { paint(v); slot.querySelector(`[data-fk="bud${v}"]`)?.focus({ preventScroll: true }); } }));
        const sub = next.querySelector('.wk-est'); if (sub) sub.textContent = String(p2.plan.minutes);
        const z2El = next.querySelector('.wk-z2'); if (z2El) z2El.textContent = String(p2.plan.z2);
      };
      paint(budget);
      next.appendChild(slot);
    }
    // one time question only: «معاك كام دقيقة؟» (30 = the short session); the separate «جلسة سريعة» button is gone (UX #21)
    next.append(
      h('button', { type: 'button', class: `btn${!isTrainDay && !params.day ? ' ghost' : ''}`, onclick: () => startSession(ctx, { dayId, budget: budgetFor(today) }) }, `ابدأ ${isTrainDay || params.day ? 'التمرين' : day.name}`));
  }
  el.appendChild(next);

  // ── new plan: one-time confirm card for existing users ──
  const np = !live ? newPlanCard(ctx, { program, training, onDone: () => rerender(el, ctx, params, true) }) : null;
  if (np) el.appendChild(np);
  // template update for users already on the plan («تحديث الخطة», plan.js)
  const pu = !np && planMod && typeof planMod.planUpdateCard === 'function' ? planMod.planUpdateCard(ctx, { program, rec: progRec, onDone: () => rerender(el, ctx, params) }) : null;
  if (pu) el.appendChild(pu);

  // ── Heart Day (Saturday on the new plan) ──
  const hd = !live && !params.day ? heartDayCard(program, today, weekday) : null;
  if (hd) el.appendChild(hd);

  // ── recovery day (R1) ──
  if (!live && !isTrainDay && !params.day && !hd) {
    el.appendChild(h('a', { class: 'wk-recov glass', href: '#/workout/recovery' },
      h('span', { class: 'ic' }, ico('heart')),
      h('span', { class: 'grow' }, h('b', {}, 'يوم تعافي'), h('small', {}, 'كارديو Zone 2 · 18 دقيقة + دائرة إطالة موجّهة ~12 دقيقة')), ico('chevron')));
  }

  // ── today's intelligence: readiness, training load, cycle phase ──
  const readiness = L.readinessOf(gi.daily);
  const load = L.trainingLoad(done, today);
  // cycle week from dayEstimate (respects the re-entry block start); weekOf only as a fallback
  const mw = tp.prep ? (tp.prep.reentry ? null : tp.prep.week) : weekOf(program, today);
  const phase = mw ? { week: mw, type: mw === 6 ? 'deload' : 'meso', of: 6 } : ctx.settings.get('wk.periodization') === true ? L.phaseOf(program.startDay, today) : null;
  const lag = L.laggingMuscle(done);
  const LOAD = { high: 'عالي', normal: 'طبيعي', low: 'خفيف', unknown: 'لسه بنتعلّم' };
  el.appendChild(h('section', { class: 'wk-intel', 'aria-label': 'ذكاء النهارده' },
    h('div', { class: 'glass' }, h('small', {}, 'الجاهزية'), readiness === null ? h('a', { href: '#/today', class: 'wk-intel-link' }, 'سجّلها') : h('b', { class: readiness < 40 ? 'low' : '' }, h('bdi', { dir: 'ltr' }, N(String(Math.round(readiness))), h('small', {}, '/100'))),
      h('span', {}, readiness === null ? 'من شاشة النهارده' : readiness < 40 ? 'الأوزان أخف 10%' : readiness >= 80 ? 'يوم كويس للأرقام' : 'عادي')),
    h('div', { class: 'glass' }, h('small', {}, 'حمل التدريب'), h('b', { class: load.level === 'high' ? 'low' : '' }, load.ratio === null ? '—' : N(load.ratio.toFixed(2))),
      h('span', {}, LOAD[load.level], ' · 7 أيام / متوسطك')),
    h('div', { class: 'glass' }, h('small', {}, phase ? 'مرحلة الدورة' : 'عضلة متأخرة'),
      phase ? h('b', {}, phase.of ? L.MESO_LABEL[phase.week] : L.PHASES[phase.type]) : h('b', {}, lag || '—'),
      h('span', {}, phase ? ['أسبوع ', N(String(phase.week)), ' من ', N(String(phase.of || 4))] : lag ? 'أقل حجم آخر 10 جلسات' : 'متوازن'))));

  // ── pinned note (W67) ──
  const pinned = String(ctx.settings.get('pinnedNote') || '').trim();
  el.appendChild(h('button', { type: 'button', class: `wk-pinned${pinned ? '' : ' empty'}`, onclick: () => editPinned(ctx, () => rerender(el, ctx, params)) },
    ico('edit'), h('span', {}, pinned || 'ثبّت ملاحظة تظهر فوق التمرين (هدف، تنبيه، إعداد جهاز)')));

  // ── deload ──
  if (deloadOn) {
    const left = Math.max(1, L.DELOAD_DAYS - diffDays(training.deload.start, today));
    el.appendChild(h('section', { class: 'sheet-card wk-deload', 'aria-label': 'أسبوع خفيف' },
      h('h3', {}, 'أسبوع خفيف', h('small', {}, 'فاضل ', N(String(left)), ` ${countWord(left, 'day')}`)),
      h('p', { class: 'wk-muted' }, 'نص المجموعات ووزن أقل 10%. ده بيدّي جسمك فرصة يتعافى ويرجع أقوى.'),
      h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
        if (await safeWrite(ctx, () => patchTraining(ctx.db, { deload: { ...training.deload, active: false } }))) rerender(el, ctx, params);
      } }, 'رجّع الحمل العادي')));
  } else if (dl.suggest && !dismissed && !live) {
    const why = { stall: 'آخر 3 مرات في أكتر من تمرين أساسي القوة ثابتة.', effort: 'المجهود قريب من الآخر في معظم المجموعات آخر أسبوعين.', weeks: `بقالك حوالي ${dl.weeks} ${Number(dl.weeks) >= 3 && Number(dl.weeks) <= 10 ? 'أسابيع' : Number(dl.weeks) === 2 ? 'أسبوعين' : 'أسبوع'} من غير أسبوع خفيف.` }[dl.reason];
    el.appendChild(h('section', { class: 'sheet-card wk-deload', 'aria-label': 'اقتراح أسبوع خفيف' },
      h('h3', {}, 'وقت أسبوع خفيف؟', h('small', {}, 'اقتراح')),
      h('p', { class: 'wk-muted' }, why, ' أسبوع بنص المجموعات ووزن أقل 10% بيساعد التعافي.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn sm', onclick: async () => {
          if (await safeWrite(ctx, () => patchTraining(ctx.db, { deload: { active: true, start: today } }))) rerender(el, ctx, params);
        } }, 'ابدأ أسبوع خفيف'),
        h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => {
          if (await safeWrite(ctx, () => patchTraining(ctx.db, { deload: { ...(training.deload || {}), dismissed: today } }))) rerender(el, ctx, params);
        } }, 'مش دلوقتي'))));
  }

  // ── today's plan (ledger) ──
  const plan = h('section', { class: 'sheet-card wk-plan', 'aria-labelledby': 'wk-plan-h' },
    h('h3', { id: 'wk-plan-h' }, day.name, h('small', {}, ...programLabel(program))),
    h('div', { class: 'chips wk-days', role: 'group', 'aria-label': 'اختار يوم' },
      ...program.order.map((id) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(id === dayId),
        onclick: () => ctx.go('workout', id === nextId ? {} : { day: id }) }, program.days[id].name))),
    h('div', { class: 'wk-row wk-head' }, h('span', {}, 'التمرين'), h('span', {}, 'المجموعات'), h('span', {}, 'آخر مرة')));
  for (const it of day.items) {
    const lastEx = L.exposures(all, it, { seeds: true })[0];
    const top = lastEx ? L.doneSets(lastEx.ex).reduce((b, t) => (t.w > b.w || (t.w === b.w && t.r > b.r) ? t : b), { w: 0, r: 0 }) : null;
    plan.appendChild(h('div', { class: 'wk-row' },
      h('span', { class: 'wk-ovname' }, h('span', { class: 'grow' }, h('b', {}, it.ar), h('small', {}, it.muscle), h('small', { class: 'wk-vidsrc', dir: 'ltr' }, videoSource(it))),
        videoLink(it, { name: it.ar, variant: 'icon' })),
      setsReps(it.sets, it.reps),
      top ? N(`${L.fmtW(top.w)} × ${top.r}`) : h('span', { class: 'num wk-muted' }, '—')));
  }
  el.appendChild(plan);

  // ── links ──
  const link = (route, iconName, title, sub) => h('a', { class: 'wk-tile glass', href: `#/${route}` }, h('span', { class: 'ic' }, ico(iconName)), h('b', {}, title), h('small', {}, sub));
  el.appendChild(h('nav', { class: 'wk-tiles', 'aria-label': 'أدوات التمرين' },
    link('workout/plan', 'edit', 'الخطة', 'الأيام والتمارين'),
    link('workout/history', 'chart', 'السجل والتقدّم', 'e1RM وسيتات كل عضلة'),
    link('workout/library', 'search', 'مكتبة التمارين', 'الفورم والنصايح'),
    link('workout/tools', 'timer', 'الأدوات', '1RM، أقراص، مؤقّت'),
    link('workout/recovery', 'heart', 'التعافي', 'كارديو Zone 2 + إطالة'),
    link('workout/heart', 'trend', 'القلب والضغط', 'يوم القلب · 30 د · ضغط البيت'),
    link('workout/kegel', 'spark', 'تمرين قاع الحوض', '5 د'),
    link('workout/injuries', 'bell', 'الإصابات', activeInj ? `${activeInj} نشطة` : 'سجّل وتابع')));

  // re-render only while this screen is the one showing (e.g. Today or a sheet changed a session)
  const off = ctx.on('session:changed', () => { if (/^#\/workout(\?|$)/.test(location.hash)) rerender(el, ctx, params); });
  return () => { off(); if (renderTok.get(el) === tok) renderTok.delete(el); };
}

function editPinned(ctx, done) {
  const ta = h('textarea', { id: 'wk-pin', rows: 3, maxlength: 2000 });
  ta.value = String(ctx.settings.get('pinnedNote') || '');
  ctx.sheet({ title: 'ملاحظة مثبّتة', body: h('div', { class: 'field' }, h('label', { for: 'wk-pin' }, 'بتظهر فوق التمرين وفي الجلسة'), ta), actions: [
    { label: 'احفظ الملاحظة', run: async () => { await ctx.settings.set('pinnedNote', ta.value.trim().slice(0, 2000)); done(); } },
    { label: 'امسحها', ghost: true, run: async () => { await ctx.settings.set('pinnedNote', ''); done(); } },
  ] });
}

// Coalesce: activating the plan calls onDone AND emits session:changed in the same tick → one navigation, not two.
let rerenderQueued = false;
function rerender(el, ctx, params) {
  if (rerenderQueued) return;
  rerenderQueued = true;
  queueMicrotask(() => { rerenderQueued = false; ctx.go('workout', params && params.day ? { day: params.day } : undefined); });
}

export function programLabel(p) {
  const t = L.PROGRAMS[p.activeProgram || p.id];
  if (t) return [h('bdi', {}, t.name), ' · ', N(String(t.perWeek)), ` ${countWord(t.perWeek, 'day')}`];
  return [p.activeProgram === 'imported' ? 'خطتك من Solo Gym' : 'خطة مخصّصة'];
}

export function nextTrainLabel(today, trainingDays) {
  for (let i = 1; i <= 7; i++) {
    const k = addDays(today, i);
    if (trainingDays.includes(weekday(k))) return i === 1 ? 'بكرة' : DAY_NAMES[weekday(k)];
  }
  return '—';
}
