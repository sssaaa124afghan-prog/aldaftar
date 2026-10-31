// Today (اليوم): one time-aware «what now» hero with the screen's only primary action → one-line calories/protein →
// compact «now» rows (weight, usual meal, BP, pelvic floor) that collapse to «✓ done» in place → week strip →
// tiles (consistency / readiness / water) → «ذكاء اليوم» → «أهداف النهارده» (collapsed). Profile is in the ⋯ menu.
import './today.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, countText, parseNum } from '../../ui/num.js';
import { pop, haptic } from '../../ui/anim.js';
import { holdRepeat } from '../../ui/hold.js';
import { parseDayKey, weekday, addDays, diffDays } from '../../core/date.js';
import { sumEntries, dayType, heartDowOf, heartDaysOf, cardioOf } from '../../core/targets.js';
import { DAY_TYPE_LABEL, sessionState, loadTargets } from '../../app/day.js';
import { SECTION_LABEL, listMeals } from '../nutrition/logic.js';
import { openWeightSheet, saveWeight, validKg } from '../profile/weight.js';
import * as WK from '../workout/logic.js';
import * as TP from '../workout/today-plan.js';
import { bpGate } from '../workout/bp.js';
import * as M from '../progress/metrics.js';
import { waterGoalMl, mealsDone, checklist, AUTO_ITEMS, DEFAULT_PREGYM, quickMeal, entriesForLog, mealLine, weightDue, bpDue, kegelDue } from './logic.js';

export const WEEKDAY = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
export const MONTH = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const dayTitle = (day) => { const d = parseDayKey(day); return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`; };
const I = (n, o) => raw(icon(n, o));
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

async function safe(p, fb) { try { const v = await p; return v === undefined || v === null ? fb : v; } catch { return fb; } }
const kv = async (db, k) => { const r = await safe(db.get('kv', k), null); return r && r.value && typeof r.value === 'object' ? r.value : {}; };

async function load(ctx) {
  const db = ctx.db; const day = ctx.today();
  const [targets, nutrition, progress, training, sessions, log, programRec, weights, daily, prof, health] = await Promise.all([
    loadTargets(db), kv(db, 'nutrition'), kv(db, 'progress'), kv(db, 'training'), safe(db.getAll('sessions'), []), safe(db.get('foodLog', day), null),
    safe(db.get('programs', 'current'), null), safe(db.getAll('bodyweight'), []), safe(db.get('daily', day), null), safe(db.get('profile', 'me'), {}), kv(db, 'health')]);
  const trainingDays = ctx.settings.get('trainingDays') || [1, 2, 4, 5];
  const overrides = nutrition.dayTypeOverrides || {};
  const doneDays = new Set(sessions.filter((s) => s && s.day && sessionState(s) === 'done' && !M.isRecovery(s)).map((s) => s.day));
  const heartDow = heartDowOf(programRec);
  const cardio = cardioOf(programRec)?.kind || null; // 'boxing' (Thursday, plan v3) | 'heart' (Saturday, v1–v2)
  const heartDays = heartDaysOf(sessions);
  const type = dayType(day, { trainingDays, overrides, sessionDays: doneDays, heartDays, heartDow });
  const planned = dayType(day, { trainingDays, overrides, heartDow });
  const t = targets[type];
  const ws = M.lifting(sessions);
  weights.sort((a, b) => String(a.day).localeCompare(String(b.day)));
  // last 30 days of food (for «فطارك المعتاد») + today's plan from the workout package (one source with the Workout tab)
  const back = Array.from({ length: 30 }, (_, i) => addDays(day, -(i + 1)));
  const [recent, plan] = await Promise.all([
    Promise.all(back.map((d) => safe(db.get('foodLog', d), null))),
    planOf(ctx, day)]);
  const recentDays = recent.filter((r) => r && Array.isArray(r.entries) && r.entries.length);
  let savedMeals = []; try { savedMeals = listMeals(nutrition.savedMeals); } catch { /* legacy shapes */ }
  return { day, type, planned, target: { kcal: t.kcal, p: t.p, c: t.c, f: t.f }, entries: (log && Array.isArray(log.entries)) ? log.entries : [],
    nutrition, progress, training, sessions, lifting: ws, programRec, weights, daily: daily || { day }, name: String((prof && prof.name) || '').trim(),
    sex: prof && prof.sex, trainingDays, heartDow, cardio, bp: Array.isArray(health.bp) ? health.bp : [], health, startDow: Number(ctx.settings.get('weekStart')) || 1,
    recentDays, yesterday: recentDays.find((r) => r.day === back[0]) || null, savedMeals, plan };
}

/**
 * Today's planned day from workout/today-plan.js `todayPlan(ctx, day)` (B1, the single source the Workout tab uses).
 * Guarded: until it exists (or if it throws) Today falls back to its own estimate. → {name, count, minutes, z2} | null
 */
async function planOf(ctx, day) {
  if (typeof TP.todayPlan !== 'function') return null;
  try {
    const r = await TP.todayPlan(ctx, day);
    if (!r) return null;
    const d = r.day && typeof r.day === 'object' ? r.day : null;
    const items = r.items || (d && d.items) || (r.prep && r.prep.items) || null;
    const name = r.name || r.dayName || (d && d.name) || r.label || null;
    const minutes = r.minutes ?? r.lift ?? (r.est && r.est.lift) ?? (r.plan && r.plan.minutes) ?? null;
    const z2 = r.z2 ?? (r.est && r.est.z2) ?? (r.plan && r.plan.z2) ?? null;
    const count = Number.isFinite(+r.exercises) && typeof r.exercises !== 'object' ? +r.exercises : Array.isArray(items) ? items.length : (r.count ?? null);
    return name ? { name, count, minutes, z2, dayId: r.dayId || r.id || null, kind: r.kind || r.type || null } : null;
  } catch (e) { console.warn('[today] todayPlan failed', e && e.message); return null; }
}

async function patchDaily(ctx, day, fn) {
  const cur = (await ctx.db.get('daily', day).catch(() => null)) || { day };
  const next = fn({ ...cur, day });
  await ctx.db.put('daily', next);
  return next;
}
async function patchProgress(ctx, fn) {
  const cur = await kv(ctx.db, 'progress');
  const next = fn(structuredClone(cur));
  await ctx.db.put('kv', { key: 'progress', value: next });
  return next;
}

// ───────── pieces ─────────

/** One-line fuel bar (UX audit #1/#3): calories and protein against today's target; the full breakdown lives in الأكل. */
function fuel(st) {
  const tot = sumEntries(st.entries);
  const kcal = Math.round(tot.kcal); const p = Math.round(tot.p);
  const pc = (v, max) => `${Math.max(0, Math.min(100, max ? (v / max) * 100 : 0))}%`;
  const over = kcal > st.target.kcal;
  return h('a', { class: 'td-fuel gl', href: '#/nutrition' }, h('span', { class: 'vh' }, 'افتح الأكل: '),
    h('div', { class: 'td-fx', style: '--k:var(--cal)' }, h('span', { class: 'td-fl' }, 'سعرات'),
      h('b', { class: `num${over ? ' over' : ''}` }, fmt(kcal)), h('small', { class: 'num' }, `/ ${fmt(st.target.kcal)}`),
      h('i', { class: 'td-fb', 'aria-hidden': 'true' }, h('u', { style: { width: pc(kcal, st.target.kcal) } }))),
    h('div', { class: 'td-fx', style: '--k:var(--pro)' }, h('span', { class: 'td-fl' }, 'بروتين'),
      h('b', { class: 'num' }, fmt(p)), h('small', { class: 'num' }, `/ ${fmt(st.target.p)} g`),
      h('i', { class: 'td-fb', 'aria-hidden': 'true' }, h('u', { style: { width: pc(p, st.target.p) } }))),
    I('chevron', { size: 18 }));
}

const isLatin = (t) => /^[\x20-\x7E]+$/.test(String(t || ''));

/** «What now»: the day's one job and its one primary action (UX audit #1). → {kind, small, title, sub, btn, run} */
function heroOf(st, ctx, hour) {
  const todays = st.sessions.filter((s) => s && s.day === st.day);
  const active = todays.find((s) => sessionState(s) === 'active');
  const done = todays.find((s) => sessionState(s) === 'done' && !M.isRecovery(s));
  const heartDone = todays.find((s) => s.kind === 'heart' && s.mode !== 'iso' && sessionState(s) === 'done');
  const recDone = todays.find((s) => M.isRecovery(s) && sessionState(s) === 'done');
  let program = null; try { program = WK.normalizeProgram(st.programRec); } catch { /* none */ }
  let wp = null; try { wp = WK.weeksOnPlan(st.sessions, { plannedPerWeek: st.trainingDays.length || 4, weekStartDow: st.startDow, today: st.day }); } catch { /* ignore */ }
  const later = hour < 15 ? 'النهارده' : 'دلوقتي';
  const eat = { btn: 'سجّل أكل', run: () => ctx.go('nutrition/add') };
  if (active) {
    const n = (active.exercises || []).length;
    return { kind: 'active', small: 'الجلسة شغالة', title: active.dayName || 'التمرين', sub: n ? countText(n, 'exercise') : 'كمّل من حيث وقفت', btn: `كمّل ${active.dayName || 'الجلسة'}`, run: () => ctx.go('workout/session') };
  }
  if (done && done.kind !== 'boxing' && done.kind !== 'heart') {
    return { kind: 'done', small: 'تمرين النهارده اتسجّل', title: done.dayName || 'جلسة النهارده', sub: `${fmt(WK.sessionVolume(done))} كجم · ${WK.sessionSetCount(done)} مجموعة${done.durationMin ? ` · ${done.durationMin} دقيقة` : ''}`, ...eat, link: { label: 'التفاصيل', href: '#/workout' } };
  }
  if (st.planned === 'training' || st.type === 'training') {
    const P = st.plan;
    let title; let sub;
    if (P) {
      title = P.name;
      sub = [P.count ? countText(P.count, 'exercise') : null, P.minutes ? `${P.minutes} دقيقة${P.z2 ? ` + Zone 2 ‏${P.z2} د` : ''}` : null].filter(Boolean).join(' · ') || 'الخطة جاهزة';
    } else {
      const fin = WK.finished(st.sessions);
      const id = program ? WK.nextDayId(program, fin, st.day) : null;
      const d = program && id ? program.days[id] : null;
      title = d ? d.name : 'يوم تمرين';
      sub = d ? `${countText(d.items.length, 'exercise')} · ${WK.estimateMinutes(d.items)} دقيقة` : 'الخطة جاهزة';
    }
    return { kind: 'training', small: wp ? `تمرين ${later} · جلسة ${wp.thisWeek + 1} من ${wp.planned} الأسبوع ده` : `تمرين ${later}`, title, sub, btn: `ابدأ ${title}`, run: () => ctx.go('workout', { start: '1' }) };
  }
  if ((st.type === 'heart' || st.planned === 'heart') && st.cardio === 'boxing' && program) {
    const bxDone = todays.find((s) => s.kind === 'boxing' && sessionState(s) === 'done');
    let box = null; try { box = TP.boxingDayInfo(ctx, { program, training: st.training, health: st.health, day: st.day }); } catch { /* fall back */ }
    if (bxDone) {
      const rounds = (bxDone.rounds || []).filter((x) => x.kind === 'bag' && x.doneS >= x.dur * 0.5).length;
      return { kind: 'done', small: 'يوم الملاكمة اتسجّل', title: 'يوم الملاكمة', sub: `${rounds} جولة شوال · ${bxDone.durationMin || 0} دقيقة`, ...eat, link: { label: 'التفاصيل', href: '#/workout/boxing' } };
    }
    const stop = box && box.gate.stop;
    return { kind: 'boxing', small: box && box.week ? `الأسبوع ${box.week} من 12 · ${box && box.minutes ? box.minutes : 35} دقيقة` : 'شوال + تكنيك',
      title: 'يوم الملاكمة', sub: stop ? 'ضغطك عالي جداً: مفيش تمرين النهارده، افتح التعليمات' : box ? `كومبو الأسبوع ${box.cw.combo.code}${box.tech ? ' · تكنيك بس' : ''}` : 'شوال + تكنيك',
      btn: stop ? 'افتح التعليمات' : 'ابدأ الملاكمة', run: () => ctx.go('workout/boxing') };
  }
  if (st.type === 'heart' || st.planned === 'heart') {
    if (heartDone) { const min = Math.round((+heartDone.durationS || 0) / 60); return { kind: 'done', small: 'يوم القلب اتسجّل', title: 'يوم القلب', sub: `${min ? `${min} دقيقة · ` : ''}مش بتتحسب جلسة رفع`, ...eat }; }
    const g = bpGate(st.bp, st.day).state;
    return { kind: 'heart', small: 'يوم القلب · 30 دقيقة', title: 'يوم القلب',
      sub: g === 'stop' ? 'ضغطك عالي جداً: مفيش تمرين النهارده، افتح التعليمات' : g === 'ok' ? 'Zone 2 أو فترات + ضغط ثابت + قاع الحوض' : 'مشي / Zone 2 بس لحد ما قراءات الضغط تتأكد',
      btn: g === 'stop' ? 'افتح التعليمات' : 'ابدأ يوم القلب', run: () => ctx.go('workout/heart') };
  }
  if (recDone) return { kind: 'done', small: 'يوم راحة', title: 'التعافي اتسجّل', sub: 'العضلات بتتبني دلوقتي', ...eat };
  return { kind: 'rest', small: 'يوم راحة', title: 'يوم تعافي', sub: 'كارديو زون 2 أو إطالة 12 دقيقة', btn: 'ابدأ التعافي', run: () => ctx.go('workout/recovery') };
}

function hero(st, ctx, hour) {
  const x = heroOf(st, ctx, hour);
  const go = h('button', { type: 'button', class: 'btn td-primary', dataset: { primary: '1' } }, x.kind === 'done' ? I('plus', { size: 18 }) : I('play', { size: 18 }), x.btn);
  go.addEventListener('click', () => { haptic(); x.run(); });
  return h('section', { class: `td-hero k-${x.kind}`, 'aria-labelledby': 'td-hero-t' },
    h('p', { class: 'td-hs' }, x.small),
    h('h2', { id: 'td-hero-t', class: `td-ht${isLatin(x.title) ? ' lat num' : ''}` }, x.title),
    h('p', { class: 'td-hsub' }, x.sub),
    go,
    x.link ? h('a', { class: 'td-hlink', href: x.link.href }, x.link.label) : null);
}

/** This week at a glance: done / planned / today (comps, all three directions). */
function week(st) {
  const start = addDays(st.day, -((weekday(st.day) - st.startDow + 7) % 7));
  const doneDays = new Set(st.sessions.filter((s) => s && s.day && sessionState(s) === 'done').map((s) => s.day));
  const SHORT = ['أحد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];
  const cells = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i); const dow = weekday(d);
    const plan = st.trainingDays.includes(dow) || dow === st.heartDow;
    const cls = [doneDays.has(d) ? 'done' : '', plan ? 'plan' : '', d === st.day ? 'now' : ''].filter(Boolean).join(' ');
    const state = doneDays.has(d) ? 'اتعمل' : plan ? (d < st.day ? 'فات' : 'متخطط') : 'راحة';
    return h('li', { class: cls, 'aria-label': `${WEEKDAY[dow]} ${parseDayKey(d).getDate()}: ${state}${d === st.day ? ' · النهارده' : ''}` },
      h('span', { 'aria-hidden': 'true' }, SHORT[dow]), h('b', { class: 'num', 'aria-hidden': 'true' }, String(parseDayKey(d).getDate())));
  });
  return h('ol', { class: 'td-week', 'aria-label': 'الأسبوع ده' }, ...cells);
}

function tiles(st, ctx, openWellness) {
  const kg = st.weights.length ? st.weights[st.weights.length - 1].kg : null;
  const goal = waterGoalMl({ nutrition: st.nutrition, settings: ctx.settings.all ? ctx.settings.all() : {}, kg, training: st.type === 'training' });
  const ml = +st.daily.waterMl || 0;
  const w = st.daily.wellness;
  const score = w ? (w.score ?? M.readinessScore(w)) : null;
  let wp = null; try { wp = WK.weeksOnPlan(st.sessions, { plannedPerWeek: st.trainingDays.length || 4, weekStartDow: st.startDow, today: st.day }); } catch { /* ignore */ }
  const bar = (p, k) => h('div', { class: 'td-bar', style: `--k:${k}` }, h('i', { style: { width: `${Math.max(0, Math.min(100, p))}%` } }));
  const waterT = h('a', { class: 'td-tl gl', href: '#/nutrition' },
    h('div', { class: 'h' }, I('droplet', { size: 14 }), 'المية'), h('b', {}, h('span', { class: 'num' }, fmt(ml / 1000, { dp: 1 })), h('small', {}, ` /${fmt(goal / 1000, { dp: 1 })} لتر`)), bar((ml / goal) * 100, 'var(--pro)'));
  const readyT = h('button', { type: 'button', class: 'td-tl gl', onclick: openWellness, 'aria-label': score === null ? 'الجاهزية: سجّل حالتك' : `الجاهزية ${score} من 100 — غيّر` },
    h('div', { class: 'h' }, I('check', { size: 14 }), 'الجاهزية'),
    score === null ? h('b', { class: 'td-ask' }, 'سجّل') : h('b', {}, h('span', { class: 'num' }, String(score)), h('small', {}, ' /100')), bar(score ?? 0, 'var(--carb)'));
  const dots = h('div', { class: 'td-dots', 'aria-hidden': 'true' }, ...Array.from({ length: wp ? wp.planned : 4 }, (_, i) => h('i', { class: wp && i < wp.thisWeek ? 'on' : '' })));
  const consT = h('a', { class: 'td-tl gl', href: '#/progress', 'aria-label': `الاستمرارية: ${wp ? wp.weeks : 0} أسبوع على الخطة، ${wp ? wp.thisWeek : 0} من ${wp ? wp.planned : 4} جلسات الأسبوع ده` },
    h('div', { class: 'h' }, I('repeat', { size: 14 }), 'الاستمرارية'), h('b', {}, h('span', { class: 'num' }, String(wp ? wp.weeks : 0)), h('small', {}, ' أسبوع')), dots);
  return h('div', { class: 'td-tiles' }, consT, readyT, waterT);
}

function intel(st, ctx, openWellness) {
  const w = st.daily.wellness;
  const score = w ? (w.score ?? M.readinessScore(w)) : null;
  const band = M.readinessBand(score);
  const load = M.trainingLoad(st.sessions, st.day);
  const lifts = M.liftsIn(st.sessions).filter((l) => l.kind === 'compound').slice(0, 3);
  const drop = M.bwDrop(st.weights);
  const rows = [];
  rows.push(h('div', { class: `td-row r-${band ? band.key : 'none'}` }, h('i', { 'aria-hidden': 'true' }),
    h('p', {}, band ? h('b', {}, `جاهزية ${band.label}: `) : h('b', {}, 'الجاهزية: '), band ? band.advice : 'سجّل نومك وطاقتك في 10 ثواني عشان النصيحة تبقى على مقاسك.'),
    h('button', { type: 'button', class: 'td-lnk', onclick: openWellness }, band ? 'غيّر' : 'سجّل')));
  if (load) rows.push(h('div', { class: `td-row l-${load.level}` }, h('i', { 'aria-hidden': 'true' }), h('p', {}, h('b', {}, 'تمرين الأسبوع ده: '), h('span', { class: 'num' }, `${fmt(load.ratio, { dp: 1 })}×`), ' متوسط آخر 4 أسابيع', ` — ${M.LOAD_TEXT[load.level]}`)));
  if (drop) rows.push(h('div', { class: 'td-row warn' }, h('i', { 'aria-hidden': 'true' }), h('p', {}, h('b', {}, 'الوزن: '), `نزل ${fmt(drop.drop, { dp: 1 })} كجم عن آخر 4 وزنات — اتأكد من البروتين.`)));
  const chips = lifts.map((l) => { const r = M.progressRate(st.sessions, l.item, { today: st.day, weeks: 8 }); const t = M.rateLabel(r); return t ? h('span', { class: `td-rate${r >= 0.25 ? ' up' : ''}` }, `${l.name.split(' ')[0]} `, h('b', {}, t)) : null; }).filter(Boolean);
  const out = h('div', { class: 'td-ai', 'aria-live': 'polite' });
  const aiBtn = h('button', { type: 'button', class: 'td-aibtn' }, I('msg', { size: 18 }), 'نصيحة النهارده');
  const show = (r, cached) => fill(out, h('div', { class: 'td-ai-text' }), h('p', { class: 'td-ai-meta' }, cached ? 'محفوظة من النهارده · ' : '', h('button', { type: 'button', class: 'td-lnk', onclick: () => ask(true) }, 'حدّث'), ' · ', h('button', { type: 'button', class: 'td-lnk', onclick: () => import('../coach/api.js').then((a) => a.openCoachSheet(ctx, { intent: 'chat' })) }, 'اسأل المدرب')));
  async function ask(refresh = false) {
    aiBtn.disabled = true;
    const [api, chat, nu, pr] = await Promise.all([import('../coach/api.js'), import('../coach/chat.js'), import('../nutrition/logic.js'), import('../coach/prompts.js')]);
    fill(out, chat.skeleton(3));
    try {
      const r = await api.askCoach(ctx, { intent: 'advice', prompt: pr.PROMPTS.advice, extra: { cacheKey: 'today.advice', refresh } });
      show(r, r.cached); out.firstChild.append(nu.richTextNodes(document, r.text));
    } catch (e) { fill(out, chat.errorLine(e)); } finally { aiBtn.disabled = false; }
  }
  aiBtn.addEventListener('click', () => ask(false));
  Promise.all([import('../coach/api.js'), import('../nutrition/logic.js')]).then(async ([api, nu]) => { const hit = await api.cached(ctx, 'today.advice'); if (hit && out.isConnected) { show(hit, true); out.firstChild.append(nu.richTextNodes(document, hit.text)); } }).catch(() => {});
  return h('section', { class: 'td-intel gl', 'aria-labelledby': 'td-intel-h' }, h('h2', { id: 'td-intel-h' }, 'ذكاء اليوم'), ...rows,
    chips.length ? h('div', { class: 'td-rates', 'aria-label': 'معدل تقدّم التمارين الأساسية' }, ...chips) : null, aiBtn, out);
}

function goals(st, ctx, rerender) {
  const kg = st.weights.length ? st.weights[st.weights.length - 1].kg : null;
  const todays = st.sessions.filter((s) => s && s.day === st.day && sessionState(s) === 'done');
  const cfg = st.progress.checklist || {};
  const rows = checklist({ type: st.planned === 'training' || st.type === 'training' ? 'training' : 'rest', entries: st.entries, target: st.target,
    waterMl: st.daily.waterMl, waterGoal: waterGoalMl({ nutrition: st.nutrition, settings: ctx.settings.all ? ctx.settings.all() : {}, kg, training: st.type === 'training' }),
    weighed: st.weights.some((w) => w.day === st.day), sessionDone: todays.some((s) => !M.isRecovery(s)), recoveryDone: todays.some((s) => M.isRecovery(s)),
    supplements: st.daily.supplements, hasSupps: !!(st.daily.supplements || (st.nutrition.supplements && Object.keys(st.nutrition.supplements).length)), config: cfg, ticks: st.daily.checklist || {} });
  const ACT = { workout: () => ctx.go('workout', { start: '1' }), recovery: () => ctx.go('workout/recovery'), protein: () => ctx.go('nutrition'), water: () => ctx.go('nutrition'), weigh: () => openWeightSheet(ctx), supps: () => ctx.go('nutrition') };
  // The whole row is the target (≥ 48 px). Rows that tick from your data open their action (weight → weight sheet);
  // your own rows toggle. No «تلقائي» chip: a chevron says the row opens something.
  const item = (r) => {
    const opens = r.auto && !r.done && !!ACT[r.id];
    const row = r.auto
      ? h('button', { type: 'button', class: 'td-ckrow', 'aria-label': r.done ? `${r.label}: اتحقق` : opens ? `${r.label}: افتح` : r.label },
        h('span', { class: `td-ck${r.done ? ' on' : ''}`, 'aria-hidden': 'true' }, I('check', { size: 16 })), h('span', { class: 'td-cl' }, r.label),
        r.done ? h('small', {}, 'اتحقق') : opens ? I('chevron', { size: 16 }) : null)
      : h('button', { type: 'button', class: 'td-ckrow', role: 'checkbox', 'aria-checked': String(r.done) },
        h('span', { class: `td-ck${r.done ? ' on' : ''}`, 'aria-hidden': 'true' }, I('check', { size: 16 })), h('span', { class: 'td-cl' }, r.label));
    if (r.auto && !opens) row.disabled = true;
    row.addEventListener('click', async () => {
      if (r.auto) { ACT[r.id] && ACT[r.id](); return; } // auto items tick from your data
      const on = !r.done;
      try { st.daily = await patchDaily(ctx, st.day, (d) => ({ ...d, checklist: { ...(d.checklist || {}), [r.id]: on } })); } catch { ctx.toast('ماقدرناش نحفظ.'); return; }
      haptic(); rerender(); requestAnimationFrame(() => pop(document.querySelector(`[data-ck="${r.id}"] .td-ck`)));
    });
    return h('li', { class: r.done ? 'done' : '', dataset: { ck: r.id } }, row);
  };
  const day = rows.filter((r) => r.group === 'day'); const pre = rows.filter((r) => r.group === 'pregym');
  const n = day.filter((r) => r.done).length;
  const edit = h('button', { type: 'button', class: 'td-lnk', onclick: () => editGoals(st, ctx, rerender) }, 'عدّل');
  // collapsed by default (UX audit IA: Today answers «what now?»; the checklist is one tap away)
  const dEl = h('details', { class: 'td-goals gl', open: goalsOpen ? true : null },
    h('summary', { class: 'td-gh' }, h('h2', { id: 'td-goals-h' }, 'أهداف النهارده'), h('span', { class: 'num' }, `${n}/${day.length}`), I('chevron', { size: 18 })),
    h('div', { class: 'td-gtools' }, edit),
    h('ul', {}, ...day.map(item)),
    pre.length ? h('h3', {}, 'قبل الجيم') : null, pre.length ? h('ul', {}, ...pre.map(item)) : null);
  dEl.addEventListener('toggle', () => { goalsOpen = dEl.open; });
  return dEl;
}
let goalsOpen = false;

function editGoals(st, ctx, rerender) {
  const cfg = structuredClone(st.progress.checklist || {});
  cfg.hidden = cfg.hidden || []; cfg.custom = cfg.custom || []; cfg.pregym = Array.isArray(cfg.pregym) ? cfg.pregym : DEFAULT_PREGYM.map((x) => ({ ...x }));
  const body = h('div', { class: 'td-edit' });
  const draw = () => {
    const input = h('input', { id: 'td-new', type: 'text', maxlength: '60', autocomplete: 'off' });
    const pin = h('input', { id: 'td-newp', type: 'text', maxlength: '60', autocomplete: 'off' });
    const add = (list, inp) => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } list.push({ id: `c:${Date.now().toString(36)}`, label: v }); draw(); };
    fill(body, 
      h('h3', {}, 'بتتعلّم لوحدها من بياناتك'),
      ...AUTO_ITEMS.map((a) => h('label', { class: 'td-erow' }, h('input', { type: 'checkbox', checked: !cfg.hidden.includes(a.id), onchange: (e) => { cfg.hidden = e.target.checked ? cfg.hidden.filter((x) => x !== a.id) : [...cfg.hidden, a.id]; } }), h('span', {}, a.label))),
      h('h3', {}, 'بنود بتاعتك'),
      ...cfg.custom.map((c, i) => h('div', { class: 'td-erow' }, h('span', {}, c.label), h('button', { type: 'button', class: 'td-x', 'aria-label': `امسح ${c.label}`, onclick: () => { cfg.custom.splice(i, 1); draw(); } }, I('x', { size: 16 })))),
      h('div', { class: 'field td-add' }, h('label', { for: 'td-new' }, 'بند جديد (مثلاً: 8 آلاف خطوة)'), h('div', { class: 'td-addrow' }, input, h('button', { type: 'button', class: 'btn sm', onclick: () => add(cfg.custom, input) }, 'ضيف'))),
      h('h3', {}, 'قبل الجيم (أيام التمرين)'),
      ...cfg.pregym.map((c, i) => h('div', { class: 'td-erow' }, h('span', {}, c.label), h('button', { type: 'button', class: 'td-x', 'aria-label': `امسح ${c.label}`, onclick: () => { cfg.pregym.splice(i, 1); draw(); } }, I('x', { size: 16 })))),
      h('div', { class: 'field td-add' }, h('label', { for: 'td-newp' }, 'بند جديد قبل الجيم'), h('div', { class: 'td-addrow' }, pin, h('button', { type: 'button', class: 'btn sm', onclick: () => add(cfg.pregym, pin) }, 'ضيف'))));
  };
  draw();
  ctx.sheet({ title: 'عدّل أهداف النهارده', body, actions: [{ label: 'احفظ', run: async () => {
    try { st.progress = await patchProgress(ctx, (p) => ({ ...p, checklist: cfg })); } catch { ctx.toast('ماقدرناش نحفظ.'); return true; }
    rerender(); return false;
  } }, { label: 'إلغاء', ghost: true }] });
}

function wellnessSheet(st, ctx, rerender) {
  const w = { sleepH: 7, energy: 3, stress: 3, soreness: 2, ...(st.daily.wellness || {}) };
  const scoreEl = h('b', { class: 'num' }, String(M.readinessScore(w)));
  const bandEl = h('p', { class: 'td-band' });
  const upd = () => { const s = M.readinessScore(w); scoreEl.textContent = String(s); bandEl.textContent = `${M.readinessBand(s).label} — ${M.readinessBand(s).advice}`; };
  const group = (key, label, opts) => h('div', { class: 'td-wf', role: 'radiogroup', 'aria-label': label }, h('p', {}, label),
    h('div', { class: 'chips' }, ...opts.map(([v, l]) => {
      const b = h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(+w[key] === v), 'aria-label': `${label}: ${l}` }, l);
      b.addEventListener('click', () => { w[key] = v; b.parentNode.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-checked', String(x === b))); upd(); });
      return b;
    })));
  upd();
  const body = h('div', { class: 'td-well' },
    h('div', { class: 'td-wscore' }, scoreEl, h('span', {}, '/100'), bandEl),
    group('sleepH', 'نمت كام ساعة؟', [[5, '5 أو أقل'], [6, '6'], [7, '7'], [8, '8'], [9, '9+']]),
    group('energy', 'طاقتك', [[1, '1 تعبان'], [2, '2'], [3, '3'], [4, '4'], [5, '5 فل']]),
    group('stress', 'الضغط', [[1, '1 رايق'], [2, '2'], [3, '3'], [4, '4'], [5, '5 عالي']]),
    group('soreness', 'الشد العضلي', [[1, '1 مفيش'], [2, '2'], [3, '3'], [4, '4'], [5, '5 جامد']]));
  ctx.sheet({ title: 'حالتك النهارده', body, actions: [{ label: 'احفظ الحالة', run: async () => {
    const rec = { sleepH: +w.sleepH, energy: +w.energy, stress: +w.stress, soreness: +w.soreness, score: M.readinessScore(w), at: new Date().toISOString() };
    try { st.daily = await patchDaily(ctx, st.day, (d) => ({ ...d, wellness: rec, readiness: Math.max(1, Math.round(rec.score / 20)) })); } catch { ctx.toast('ماقدرناش نحفظ.'); return true; }
    ctx.emit('wellness:changed', { day: st.day, score: rec.score });
    rerender(); return false;
  } }, { label: 'إلغاء', ghost: true }] });
}


// ───────── «دلوقتي»: the one-tap jobs for this hour (weight, usual meal) and due health cards ─────────

async function logEntries(ctx, day, entries) {
  try {
    const prev = (await ctx.db.get('foodLog', day).catch(() => null)) || { day, entries: [] };
    await ctx.db.put('foodLog', { ...prev, day, entries: [...(Array.isArray(prev.entries) ? prev.entries : []), ...entries] });
  } catch { ctx.toast('ماقدرناش نحفظ دلوقتي. جرّب تاني.'); return null; }
  const ids = new Set(entries.map((e) => e.id));
  ctx.emit('food:changed', { day });
  return async () => {
    const cur = (await ctx.db.get('foodLog', day).catch(() => null)) || { day, entries: [] };
    await ctx.db.put('foodLog', { ...cur, entries: (cur.entries || []).filter((e) => !ids.has(e.id)) });
    ctx.emit('food:changed', { day });
  };
}

function mealFor(st, hour) {
  return quickMeal({ hour, todayEntries: st.entries, days: st.recentDays, yesterday: st.yesterday, savedMeals: st.savedMeals });
}
const mealName = (m) => (m.kind === 'yesterday' ? `${SECTION_LABEL[m.section]} زي امبارح` : 'الفطار المعتاد');
/** Logs a quick meal. With `quiet` the caller shows the confirmation in its own row; otherwise a toast with «تراجع». */
async function logMeal(ctx, st, m, { quiet = false } = {}) {
  const undo = await logEntries(ctx, st.day, entriesForLog(m));
  if (undo && !quiet) ctx.toast(`اتسجّل ${mealName(m)} · ${fmt(m.kcal)} سعرة`, { action: { label: 'تراجع', run: undo } });
  return undo;
}

// Rows logged during this visit stay on screen as a «✓ done» line of the same height (UX audit #5: no layout jump).
// key → {text, undo}; cleared when Today is left.
const doneRows = new Map();
function doneRow(key, icn, text, rerender) {
  const d = doneRows.get(key);
  const undo = h('button', { type: 'button', class: 'td-undo' }, 'تراجع');
  undo.addEventListener('click', async () => { undo.disabled = true; doneRows.delete(key); try { await d.undo(); } catch { ctx0 && ctx0.toast('ماقدرناش نرجّعها.'); } rerender(); });
  return h('li', { class: 'td-row1 is-done', dataset: { row: key }, style: d.h ? { minHeight: `${d.h}px` } : null },
    h('span', { class: 'td-ri ok', 'aria-hidden': 'true' }, I('check', { size: 18 })),
    h('span', { class: 'td-rt' }, h('b', {}, text), d.sub ? h('small', {}, d.sub) : null), d.undo ? undo : null);
}
let ctx0 = null;
const rowH = (el) => { const li = el && el.closest('li'); return li ? Math.round(li.getBoundingClientRect().height) : 0; };

function mealRow(st, ctx, hour, rerender) {
  if (doneRows.has('meal')) return doneRow('meal', 'food', doneRows.get('meal').text, rerender);
  const m = mealFor(st, hour);
  if (!m) return null;
  const title = m.kind === 'yesterday' ? `${SECTION_LABEL[m.section]} زي امبارح` : 'فطارك المعتاد';
  const go = h('button', { type: 'button', class: 'td-act', dataset: { quick: 'meal' }, 'aria-label': `سجّل ${title}: ${fmt(m.kcal)} سعرة` }, 'سجّله');
  go.addEventListener('click', async () => {
    go.disabled = true; haptic();
    const undo = await logMeal(ctx, st, m, { quiet: true });
    if (!undo) { go.disabled = false; return; }
    doneRows.set('meal', { text: `${mealName(m)} اتسجّل`, sub: `${fmt(m.kcal)} سعرة · ${fmt(m.p)} جم بروتين`, undo, h: rowH(go) });
    rerender();
  });
  return h('li', { class: 'td-row1', dataset: { row: 'meal' } },
    h('span', { class: 'td-ri', 'aria-hidden': 'true' }, I('food', { size: 18 })),
    h('span', { class: 'td-rt' }, h('b', {}, title), h('small', {}, mealLine(m.entries), ' · ', h('span', { class: 'num' }, fmt(m.kcal)), ' سعرة')), go);
}

function weightRow(st, ctx, rerender) {
  if (doneRows.has('kg')) return doneRow('kg', 'scale', doneRows.get('kg').text, rerender);
  const prevW = st.weights.filter((w) => w.day !== st.day);
  const last = prevW.length ? prevW[prevW.length - 1].kg : null;
  const input = h('input', { id: 'td-kg', type: 'text', inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off', class: 'num', value: last != null ? String(last) : '', 'aria-label': 'وزنك النهارده بالكيلو', 'aria-describedby': 'td-kg-err' });
  const err = h('p', { class: 'td-err', id: 'td-kg-err', 'aria-live': 'polite' });
  const clear = () => { err.textContent = ''; input.removeAttribute('aria-invalid'); };
  const step = (d) => { const v = parseNum(input.value); const base = Number.isFinite(v) ? v : (last ?? 72); input.value = (Math.round((base + d) * 10) / 10).toFixed(1); clear(); };
  const save = h('button', { type: 'button', class: 'td-act' }, 'احفظ');
  const run = async () => {
    const v = validKg(input.value);
    if (!v.ok) { err.textContent = v.message; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    save.disabled = true; haptic();
    let undo; try { undo = await saveWeight(ctx, v.kg, st.day, { quiet: true }); } catch { err.textContent = 'ماقدرناش نحفظ دلوقتي — جرّب تاني.'; save.disabled = false; return; }
    const dlt = last != null ? Math.round((v.kg - last) * 10) / 10 : null;
    doneRows.set('kg', { h: rowH(save), text: `وزنك ${fmt(v.kg, { dp: 1 })} كجم`, sub: dlt == null ? 'أول وزن' : dlt === 0 ? 'زي آخر مرة' : `${dlt > 0 ? '+' : '−'}${fmt(Math.abs(dlt), { dp: 1 })} عن آخر مرة`, undo });
    rerender();
  };
  save.addEventListener('click', run);
  input.addEventListener('input', clear);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  const sb = (d, label, txt) => { const b = h('button', { type: 'button', class: 'td-stp', 'aria-label': label }, txt); holdRepeat(b, () => step(d)); return b; };
  return h('li', { class: 'td-row1 td-kgrow', dataset: { row: 'kg' } },
    h('span', { class: 'td-ri', 'aria-hidden': 'true' }, I('scale', { size: 18 })),
    h('span', { class: 'td-rt' }, h('b', {}, 'وزنك'), h('small', {}, last != null ? `آخر مرة ${fmt(last, { dp: 1 })}` : 'على الريق')),
    h('span', { class: 'td-kgin' }, sb(-0.1, 'قلّل 0.1 كجم', '−'), input, sb(0.1, 'زوّد 0.1 كجم', '+')), save, err);
}

function bpRow(st, ctx, force, rerender) {
  if (doneRows.has('bp')) return doneRow('bp', 'heart', doneRows.get('bp').text, rerender);
  const g = bpGate(st.bp, st.day);
  const due = bpDue({ gateState: g.state, bp: st.bp, day: st.day });
  if (!due && !force) return null;
  const sub = due ? `قراءة ${due.today + 1} من 2 · يوم ${g.days} من 3` : 'قراءة جديدة';
  const li = h('li', { class: 'td-row1 td-bprow', dataset: { row: 'bp' } });
  const open = h('button', { type: 'button', class: 'td-act', 'aria-expanded': 'false', 'aria-controls': 'td-bpf' }, 'سجّل');
  const head = [h('span', { class: 'td-ri', 'aria-hidden': 'true' }, I('heart', { size: 18 })),
    h('span', { class: 'td-rt' }, h('b', {}, 'ضغط البيت'), h('small', {}, sub))];
  const f = (id, label, hint) => {
    const input = h('input', { id, type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'num', 'aria-describedby': `${id}-err`, enterkeyhint: id === 'td-sys' ? 'next' : 'done' });
    const err = h('p', { class: 'td-err', id: `${id}-err`, 'aria-live': 'polite' });
    input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); const t = String(input.value).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)); if (t !== input.value) input.value = t; });
    return { input, err, el: h('div', { class: 'td-bpf' }, h('label', { for: id }, label, h('small', {}, hint)), input, err) };
  };
  const expand = () => {
    const sys = f('td-sys', 'الانقباضي', ' (الكبير)'); const dia = f('td-dia', 'الانبساطي', ' (الصغير)');
    const save = h('button', { type: 'button', class: 'td-act' }, 'احفظ');
    const run = async () => {
      const H = await import('../workout/heart.js');
      const v = H.validateBP({ sys: sys.input.value.trim(), dia: dia.input.value.trim() });
      sys.err.textContent = v.errors.sys || ''; dia.err.textContent = v.errors.dia || '';
      sys.input.setAttribute('aria-invalid', String(!!v.errors.sys)); dia.input.setAttribute('aria-invalid', String(!!v.errors.dia));
      if (!v.ok) { (v.errors.sys ? sys : dia).input.focus(); return; }
      save.disabled = true; haptic();
      const row = { id: `bp:${Date.now().toString(36)}`, at: new Date().toISOString(), day: st.day, ...v.value, cuff: st.health.cuffArm === false ? 'other' : 'arm' };
      try { await H.patchHealth(ctx.db, (c) => ({ ...c, bp: [...(c.bp || []), row].slice(-400) })); } catch { ctx.toast('ماقدرناش نحفظ دلوقتي. جرّب تاني.'); save.disabled = false; return; }
      doneRows.set('bp', { h: rowH(save), text: `ضغطك ${row.sys}/${row.dia}`, sub: H.bpCategory(row.sys, row.dia).label,
        undo: async () => { await H.patchHealth(ctx.db, (c) => ({ ...c, bp: (c.bp || []).filter((x) => x.id !== row.id) })); ctx.emit('health:changed', { day: st.day }); } });
      ctx.emit('health:changed', { day: st.day });
    };
    sys.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dia.input.focus(); } });
    dia.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    save.addEventListener('click', run);
    li.classList.add('open');
    fill(li, ...head, h('a', { class: 'td-lnk', href: '#/workout/heart?tab=bp' }, 'السجل'),
      h('div', { class: 'td-bpin', id: 'td-bpf' }, sys.el, h('span', { class: 'td-slash', 'aria-hidden': 'true' }, '/'), dia.el, save),
      h('p', { class: 'td-hint' }, 'جهاز دراع، بعد 5 دقايق راحة وإنت قاعد · قراءتين بينهم دقيقة'));
  };
  open.addEventListener('click', () => { expand(); requestAnimationFrame(() => document.getElementById('td-sys')?.focus()); });
  if (force) expand(); else fill(li, ...head, open);
  return li;
}

function kegelRow(st, ctx) {
  const kg = st.health.kegel || {};
  let week = 1; try { if (kg.start) week = Math.floor(diffDays(kg.start, st.day) / 7) + 1; } catch { /* default */ }
  const due = kegelDue({ kegel: kg, day: st.day, week });
  if (!due) return null;
  const go = h('a', { class: 'td-act', href: '#/workout/kegel', dataset: { quick: 'kegel' } }, 'ابدأ');
  return h('li', { class: 'td-row1', dataset: { row: 'kegel' } },
    h('span', { class: 'td-ri', 'aria-hidden': 'true' }, I('timer', { size: 18 })),
    h('span', { class: 'td-rt' }, h('b', {}, 'تمرين قاع الحوض'), h('small', {}, `مرة ${due.done + 1} من ${due.perDay} · حوالي 4 دقايق`)), go);
}

function moreMenu(st, ctx) {
  const day = st.day; const flip = st.type === 'training' ? 'rest' : 'training';
  const body = h('div', {});
  const s = ctx.sheet({ title: 'خيارات اليوم', body });
  const item = (ic, text, run) => body.appendChild(h('button', { type: 'button', class: 'menu-item', onclick: () => { s.close(); run(); } }, I(ic), text));
  item('user', 'الملف والإعدادات', () => ctx.go('profile'));
  item('repeat', flip === 'rest' ? 'خلّي النهارده يوم راحة' : 'خلّي النهارده يوم تمرين', async () => {
    const n = await kv(ctx.db, 'nutrition'); const prev = { ...(n.dayTypeOverrides || {}) };
    try { await ctx.db.put('kv', { key: 'nutrition', value: { ...n, dayTypeOverrides: { ...prev, [day]: flip } } }); } catch { ctx.toast('ماقدرناش نحفظ دلوقتي.'); return; }
    ctx.emit('settings:changed', { key: 'dayType', day });
    ctx.toast(flip === 'rest' ? 'النهارده بقى يوم راحة · الهدف اتغيّر' : 'النهارده بقى يوم تمرين · الهدف اتغيّر', { action: { label: 'تراجع', run: async () => {
      const n2 = await kv(ctx.db, 'nutrition'); await ctx.db.put('kv', { key: 'nutrition', value: { ...n2, dayTypeOverrides: prev } }); ctx.emit('settings:changed', { key: 'dayType', day });
    } } });
  });
  item('scale', 'سجّل الوزن', () => openWeightSheet(ctx));
  item('check', 'أهداف النهارده', () => { const d = document.querySelector('.td-goals'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } });
}


/**
 * Home-screen shortcuts (manifest `shortcuts`) land here: #/today?weigh=1 · ?usual=breakfast · ?bp=1 (+ quick=1).
 * Each opens straight into its action, then the hash is cleaned so a reload does not repeat it.
 */
async function quickAction(ctx, params, getSt, setForceBP) {
  const clean = () => { try { history.replaceState(null, '', '#/today'); } catch { /* ignore */ } };
  const focus = (sel) => requestAnimationFrame(() => { const i = document.querySelector(sel); if (i) { i.focus(); try { i.select(); } catch { /* ignore */ } } });
  if (params.weigh) {
    clean();
    if (document.getElementById('td-kg')) focus('#td-kg'); else await openWeightSheet(ctx);
  } else if (params.usual) {
    clean();
    const st = getSt();
    const m = mealFor(st, params.usual === 'lunch' ? 13 : params.usual === 'dinner' ? 18 : 7);
    if (m) await logMeal(ctx, st, m);
    else ctx.toast(`${SECTION_LABEL[params.usual] || 'الفطار'} متسجّل النهارده خلاص.`);
  } else if (params.bp) {
    clean(); setForceBP(true); focus('#td-sys');
  }
}

export async function renderToday(el, ctx, params = {}) {
  let st; let alive = true;
  doneRows.clear(); ctx0 = ctx;
  let forceBP = !!params.bp;
  const paint = () => {
    if (!alive) return;
    const hour = new Date().getHours();
    const greet = st.name ? `${hour < 12 ? 'صباح الفل' : 'مساء الفل'} يا ${st.name}` : dayTitle(st.day);
    const more = h('button', { type: 'button', class: 'td-ib', 'aria-label': 'خيارات اليوم والملف', 'aria-haspopup': 'dialog', onclick: () => moreMenu(st, ctx) }, I('more'));
    const openW = () => wellnessSheet(st, ctx, paint);
    const weighed = st.weights.some((w) => w.day === st.day);
    const lastKg = st.weights.length ? st.weights[st.weights.length - 1].kg : null;
    const rows = [weightDue({ hour, weighed }) || doneRows.has('kg') ? weightRow(st, ctx, paint) : null, mealRow(st, ctx, hour, paint), bpRow(st, ctx, forceBP, paint), kegelRow(st, ctx)].filter(Boolean);
    const tag = st.type === 'heart' && st.cardio === 'boxing' ? 'يوم الملاكمة' : DAY_TYPE_LABEL[st.type];
    fill(el, h('div', { class: 'td' },
      h('header', { class: 'td-hd' },
        h('div', {}, h('p', { class: 'td-dayp' }, st.name ? `${dayTitle(st.day)} · ${tag}` : tag), h('h1', {}, greet)),
        lastKg != null ? h('span', { class: 'td-kgtag num', 'aria-label': `آخر وزن ${fmt(lastKg, { dp: 1 })} كجم` }, `${fmt(lastKg, { dp: 1 })} kg`) : null, more),
      hero(st, ctx, hour), fuel(st),
      rows.length ? h('ul', { class: 'td-rows gl', 'aria-label': 'دلوقتي' }, ...rows) : null,
      week(st), tiles(st, ctx, openW), intel(st, ctx, openW), goals(st, ctx, paint)));
  };
  const refresh = async () => { st = await load(ctx); paint(); };
  await refresh();
  await quickAction(ctx, params, () => st, (v) => { forceBP = v; paint(); });
  const offs = ['food:changed', 'session:changed', 'weight:changed', 'settings:changed', 'wellness:changed', 'health:changed'].map((e) => ctx.on(e, () => { if (e === 'health:changed') forceBP = false; refresh(); }));
  const onVis = () => { if (document.visibilityState === 'visible' && st && st.day !== ctx.today()) { doneRows.clear(); refresh(); } };
  document.addEventListener('visibilitychange', onVis);
  return () => { alive = false; doneRows.clear(); offs.forEach((f) => f()); document.removeEventListener('visibilitychange', onVis); };
}

export const routes = { today: renderToday };
