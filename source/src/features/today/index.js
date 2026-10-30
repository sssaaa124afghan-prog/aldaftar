// Today (النهارده) — Electric Glass Pro: greeting → calorie gauge → 4 macro rings → today's workout card →
// tiles (water / readiness / consistency) → «ذكاء اليوم» → «أهداف النهارده».
import './today.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, countText, parseNum } from '../../ui/num.js';
import { ring } from '../../ui/ring.js';
import { countUp, pop, haptic } from '../../ui/anim.js';
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

function gauge(st) {
  const eaten = Math.round(sumEntries(st.entries).kcal);
  const goal = st.target.kcal; const left = goal - eaten; const over = left < 0;
  const frac = Math.max(0, Math.min(1, eaten / goal));
  const svg = svgEl('svg', { viewBox: '0 0 250 134', class: 'td-arc', 'aria-hidden': 'true' });
  const defs = svgEl('defs'); const lg = svgEl('linearGradient', { id: 'td-ga', x1: '1', y1: '0', x2: '0', y2: '0' });
  lg.append(svgEl('stop', { offset: '0', 'stop-color': '#FDE68A' }), svgEl('stop', { offset: '1', 'stop-color': '#FB923C' })); defs.append(lg); svg.append(defs);
  svg.append(svgEl('path', { d: 'M17 125 A108 108 0 0 1 233 125', class: 'td-arc-tr' }));
  const v = svgEl('path', { d: 'M233 125 A108 108 0 0 0 17 125', class: `td-arc-v${over ? ' over' : ''}`, pathLength: '100', stroke: over ? 'var(--fat)' : 'url(#td-ga)' });
  v.style.setProperty('--p', String(Math.round(frac * 1000) / 10));
  svg.append(v);
  const big = h('b', { class: 'num' }, fmt(Math.abs(left)));
  const ate = h('b', { class: 'num td-cal' }, fmt(eaten));
  const pLeft = Math.max(0, Math.round(st.target.p - sumEntries(st.entries).p));
  const card = h('section', { class: 'td-gauge gl', 'aria-label': `السعرات: أكلت ${fmt(eaten)} من ${fmt(goal)}، ${over ? `زيادة ${fmt(-left)}` : `فاضل ${fmt(left)}`}` },
    svg, h('div', { class: 'td-mid', 'aria-hidden': 'true' }, big, h('span', {}, over ? 'سعرة زيادة عن الهدف' : 'سعرة فاضلة النهارده')),
    h('div', { class: 'td-g3', 'aria-hidden': 'true' },
      h('div', {}, ate, h('span', {}, 'أكلت')), h('div', {}, h('b', { class: 'num' }, fmt(goal)), h('span', {}, 'الهدف')),
      h('div', {}, h('b', { class: 'num td-pro' }, fmt(pLeft)), h('span', {}, 'بروتين فاضل (جم)'))));
  requestAnimationFrame(() => { countUp(big, Math.abs(left), { from: goal }); countUp(ate, eaten); });
  return card;
}

// big ring figure: final value at first paint; counts up (from 0, or from what it showed before a repaint) once on screen
const shownNum = new Map();
function countNum(key, val, format) {
  const b = h('b', { class: 'num' }, format ? format(val) : fmt(val));
  const from = shownNum.has(key) ? shownNum.get(key) : 0;
  shownNum.set(key, val);
  if (from !== val) countUp(b, val, { from, ms: 800, format: format || ((v) => fmt(Math.round(v))) });
  return b;
}

function macros(st, ctx) {
  const tot = sumEntries(st.entries); const md = mealsDone(st.entries);
  const mk = (val, max, color, name, sub, label, href) => h('a', { class: 'td-mc gl', href, style: `--k:${color}` },
    h('div', { class: 'td-rw' }, ring({ value: val, max, color, size: 64, stroke: 6, track: 'rgba(255,255,255,.12)', label }), countNum(name, val)),
    h('div', { class: 'td-nm' }, name), h('div', { class: 'td-sub' }, sub));
  const meals = h('a', { class: 'td-mc gl', href: md.next ? `#/nutrition?section=${md.next}` : '#/nutrition', style: '--k:var(--cal)' },
    h('div', { class: 'td-rw' }, ring({ value: md.done, max: md.total, color: 'var(--cal)', size: 64, stroke: 6 }), countNum('meals', md.done, (v) => `${Math.round(v)}/${md.total}`)),
    h('div', { class: 'td-nm', 'aria-hidden': 'true' }, 'وجبات'), h('div', { class: 'td-sub', 'aria-hidden': 'true' }, md.next ? `${SECTION_LABEL[md.next]} فاضل` : 'كمّلت'));
  return h('div', { class: 'td-macros' },
    mk(Math.round(tot.p), st.target.p, 'var(--pro)', 'بروتين', `من ${fmt(st.target.p)} جم`, `بروتين ${fmt(tot.p)} من ${fmt(st.target.p)} جم`, '#/nutrition'),
    mk(Math.round(tot.c), st.target.c, 'var(--carb)', 'كارب', `من ${fmt(st.target.c)} جم`, `كارب ${fmt(tot.c)} من ${fmt(st.target.c)} جم`, '#/nutrition'),
    mk(Math.round(tot.f), st.target.f, 'var(--fat)', 'دهون', `من ${fmt(st.target.f)} جم`, `دهون ${fmt(tot.f)} من ${fmt(st.target.f)} جم`, '#/nutrition'),
    meals);
}

function workoutCard(st, ctx) {
  const todays = st.sessions.filter((s) => s && s.day === st.day);
  const active = todays.find((s) => sessionState(s) === 'active');
  const done = todays.find((s) => sessionState(s) === 'done' && !M.isRecovery(s));
  const heartDone = todays.find((s) => s.kind === 'heart' && s.mode !== 'iso' && sessionState(s) === 'done');
  const recDone = todays.find((s) => M.isRecovery(s) && sessionState(s) === 'done');
  let program = null; try { program = WK.normalizeProgram(st.programRec); } catch { /* none */ }
  let wp = null; try { wp = WK.weeksOnPlan(st.sessions, { plannedPerWeek: st.trainingDays.length || 4, weekStartDow: st.startDow, today: st.day }); } catch { /* ignore */ }
  let small, title, sub, btn, run, icn = 'dumbbell';
  if (active) {
    small = 'الجلسة شغالة'; title = active.dayName || 'التمرين'; sub = `${(active.exercises || []).length} تمارين`; btn = 'كمّل'; run = () => ctx.go('workout/session');
  } else if (done) {
    small = 'التمرين اتسجل'; title = done.dayName || 'جلسة النهارده'; sub = `${fmt(WK.sessionVolume(done))} كجم · ${WK.sessionSetCount(done)} مجموعة${done.durationMin ? ` · ${done.durationMin} دقيقة` : ''}`; btn = 'التفاصيل'; run = () => ctx.go('workout');
  } else if (st.planned === 'training' || st.type === 'training') {
    const fin = WK.finished(st.sessions);
    const id = program ? WK.nextDayId(program, fin, st.day) : null;
    const d = program && id ? program.days[id] : null;
    // same estimate as the workout overview (lifting incl. warm-up after balance + time budget, then Zone 2)
    let est = null; try { if (d) est = WK.dayEstimate({ program, sessions: fin, today: st.day, dayId: id, training: st.training, weekStartDow: ctx.settings.get('weekStart') ?? 1, trainingDays: ctx.settings.get('trainingDays') || null }); } catch { /* fall back */ }
    small = wp ? `جلسة ${wp.thisWeek + 1} من ${wp.planned} الأسبوع ده` : 'تمرين النهارده';
    const P = st.plan;
    if (P) {
      // same day name / count / minutes as the Workout tab (todayPlan)
      title = P.name;
      sub = [P.count ? countText(P.count, 'exercise') : null, P.minutes ? `${P.minutes} دقيقة${P.z2 ? ` + Zone 2 ‏${P.z2} د` : ''}` : null].filter(Boolean).join(' · ') || 'الخطة جاهزة';
    } else {
      title = d ? d.name : 'يوم تمرين'; sub = d ? `${countText(d.items.length, 'exercise')} · ${est ? est.lift : WK.estimateMinutes(d.items)} دقيقة${est && est.z2 ? ` + Zone 2 ‏${est.z2} د` : ''}` : 'الخطة جاهزة';
    }
    btn = 'ابدأ'; run = () => ctx.go('workout', { start: '1' });
  } else if ((st.type === 'heart' || st.planned === 'heart') && st.cardio === 'boxing' && program) {
    // Boxing Day (program cardio day, Thursday on plan v3): this week's combo; cardio minutes, not a lifting session.
    icn = 'bolt';
    const bxDone = todays.find((s) => s.kind === 'boxing' && sessionState(s) === 'done');
    let box = null; try { box = TP.boxingDayInfo(ctx, { program, training: st.training, health: st.health, day: st.day }); } catch { /* fall back */ }
    title = `يوم الملاكمة · ${box && box.minutes ? box.minutes : 35} د`;
    if (bxDone) {
      small = 'يوم الملاكمة اتسجل';
      const rounds = (bxDone.rounds || []).filter((x) => x.kind === 'bag' && x.doneS >= x.dur * 0.5).length;
      sub = `${rounds} جولة شوال · ${bxDone.durationMin || 0} دقيقة · مش بتتحسب جلسة رفع`; btn = 'التفاصيل';
    } else {
      small = box && box.week ? `يوم الملاكمة · الأسبوع ${box.week} من 12` : 'يوم الملاكمة';
      sub = !box ? 'شوال + تكنيك' : box.gate.stop ? 'ضغطك عالي جداً: مفيش تمرين النهارده، افتح التعليمات'
        : `كومبو الأسبوع: ${box.cw.combo.code}${box.tech ? ' · تكنيك بس' : ''}`;
      btn = box && box.gate.stop ? 'افتح' : 'ابدأ';
    }
    run = () => ctx.go('workout/boxing');
  } else if (st.type === 'heart' || st.planned === 'heart') {
    // Heart Day (program heartDow, e.g. Saturday on the 4-day plan): 30 min, not a lifting session.
    icn = 'heart'; title = 'يوم القلب · 30 د';
    if (heartDone) {
      small = 'يوم القلب اتسجل';
      const min = Math.round((+heartDone.durationS || 0) / 60);
      sub = `${min ? `${min} دقيقة · ` : ''}مش بتتحسب جلسة رفع`; btn = 'التفاصيل';
    } else {
      const g = bpGate(st.bp, st.day).state;
      small = 'يوم القلب';
      sub = g === 'stop' ? 'ضغطك عالي جداً: مفيش تمرين النهارده، افتح التعليمات'
        : g === 'ok' ? 'Zone 2 أو فترات + ضغط ثابت + قاع الحوض'
          : 'مشي / Zone 2 بس لحد ما قراءات الضغط تتأكد';
      btn = g === 'stop' ? 'افتح' : 'ابدأ';
    }
    run = () => ctx.go('workout/heart');
  } else {
    icn = 'timer'; small = 'يوم راحة';
    title = recDone ? 'التعافي اتسجل' : 'يوم تعافي'; sub = recDone ? 'العضلات بتتبني دلوقتي' : 'كارديو زون 2 أو إطالة 12 دقيقة';
    btn = recDone ? 'تاني' : 'ابدأ'; run = () => ctx.go('workout/recovery');
  }
  const go = h('button', { type: 'button', class: 'td-go' }, I('play', { size: 16 }), btn);
  go.addEventListener('click', () => { haptic(); run(); });
  return h('section', { class: 'td-wo gl', 'aria-label': `${small}: ${title}` },
    h('div', { class: 'td-ic', 'aria-hidden': 'true' }, I(icn)),
    h('div', { class: 't' }, h('small', {}, small), h('b', {}, title), h('span', {}, sub)), go);
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
  return h('section', { class: 'td-goals gl', 'aria-labelledby': 'td-goals-h' },
    h('div', { class: 'td-gh' }, h('h2', { id: 'td-goals-h' }, 'أهداف النهارده'), h('span', { class: 'num' }, `${n}/${day.length}`), edit),
    h('ul', {}, ...day.map(item)),
    pre.length ? h('h3', {}, 'قبل الجيم') : null, pre.length ? h('ul', {}, ...pre.map(item)) : null);
}

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

async function logEntries(ctx, day, entries, label) {
  let prev;
  try {
    prev = (await ctx.db.get('foodLog', day).catch(() => null)) || { day, entries: [] };
    await ctx.db.put('foodLog', { ...prev, day, entries: [...(Array.isArray(prev.entries) ? prev.entries : []), ...entries] });
  } catch { ctx.toast('ماقدرناش نحفظ دلوقتي. جرّب تاني.'); return false; }
  const ids = new Set(entries.map((e) => e.id));
  ctx.emit('food:changed', { day });
  ctx.toast(label, { action: { label: 'تراجع', run: async () => {
    const cur = (await ctx.db.get('foodLog', day).catch(() => null)) || { day, entries: [] };
    await ctx.db.put('foodLog', { ...cur, entries: (cur.entries || []).filter((e) => !ids.has(e.id)) });
    ctx.emit('food:changed', { day });
  } } });
  return true;
}

function mealFor(st, hour) {
  return quickMeal({ hour, todayEntries: st.entries, days: st.recentDays, yesterday: st.yesterday, savedMeals: st.savedMeals });
}
async function logMeal(ctx, st, m) {
  const es = entriesForLog(m);
  const name = m.kind === 'yesterday' ? `${SECTION_LABEL[m.section]} زي امبارح` : 'الفطار المعتاد';
  return logEntries(ctx, st.day, es, `اتسجّل ${name} · ${fmt(m.kcal)} سعرة`);
}

function mealCard(st, ctx, hour) {
  const m = mealFor(st, hour);
  if (!m) return null;
  const title = m.kind === 'yesterday' ? `${SECTION_LABEL[m.section]} زي امبارح` : 'فطارك المعتاد';
  const small = m.source === 'seed' ? 'الفطار الثابت · تقدر تغيّره من التغذية' : m.source === 'saved' ? 'من وجباتي' : m.kind === 'yesterday' ? 'نفس أكل امبارح' : 'اللي بتاكله عادةً';
  const go = h('button', { type: 'button', class: 'td-go', dataset: { quick: 'meal' }, 'aria-label': `سجّل ${title}: ${fmt(m.kcal)} سعرة` }, I('plus', { size: 16 }), 'سجّله');
  go.addEventListener('click', async () => { go.disabled = true; haptic(); pop(go); if (!(await logMeal(ctx, st, m))) go.disabled = false; });
  return h('section', { class: 'td-wo td-meal gl', 'aria-label': title },
    h('div', { class: 'td-ic', 'aria-hidden': 'true' }, I('food')),
    h('div', { class: 't' }, h('small', {}, small), h('b', {}, title), h('span', { class: 'td-ml' }, mealLine(m.entries)),
      h('span', {}, h('span', { class: 'num' }, fmt(m.kcal)), ' سعرة · ', h('span', { class: 'num' }, fmt(m.p)), ' جم بروتين')), go);
}

function weightRow(st, ctx) {
  const last = st.weights.length ? st.weights[st.weights.length - 1].kg : null;
  const input = h('input', { id: 'td-kg', type: 'text', inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off', class: 'num', value: last != null ? String(last) : '', 'aria-describedby': 'td-kg-h td-kg-err' });
  const err = h('p', { class: 'td-err', id: 'td-kg-err', 'aria-live': 'polite' });
  const clear = () => { err.textContent = ''; input.removeAttribute('aria-invalid'); };
  const step = (d) => { const v = parseNum(input.value); const base = Number.isFinite(v) ? v : (last ?? 72); input.value = String(Math.round((base + d) * 10) / 10); clear(); };
  const save = h('button', { type: 'button', class: 'td-save' }, 'احفظ');
  const run = async () => {
    const v = validKg(input.value);
    if (!v.ok) { err.textContent = v.message; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    save.disabled = true; haptic();
    try { await saveWeight(ctx, v.kg, st.day); } catch { err.textContent = 'ماقدرناش نحفظ دلوقتي — جرّب تاني.'; save.disabled = false; }
  };
  save.addEventListener('click', run);
  input.addEventListener('input', clear);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  const sb = (d, label, txt) => h('button', { type: 'button', class: 'td-stp', 'aria-label': label, onclick: () => step(d) }, txt);
  return h('section', { class: 'td-now td-kgrow gl', 'aria-labelledby': 'td-kg-l' },
    h('div', { class: 'td-nh' }, I('scale', { size: 16 }), h('label', { for: 'td-kg', id: 'td-kg-l' }, 'وزنك النهارده'),
      h('small', { id: 'td-kg-h' }, last != null ? `آخر مرة ${fmt(last, { dp: 1 })} كجم` : 'على الريق لو تقدر')),
    h('div', { class: 'td-kgin' }, sb(0.1, 'زوّد 0.1 كجم', '+'), input, sb(-0.1, 'قلّل 0.1 كجم', '−'), save), err);
}

function bpCard(st, ctx, force = false) {
  const g = bpGate(st.bp, st.day);
  const due = bpDue({ gateState: g.state, bp: st.bp, day: st.day });
  if (!due && !force) return null;
  const f = (id, label, min, max, hint) => {
    const input = h('input', { id, type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'num', 'aria-describedby': `${id}-err`, enterkeyhint: id === 'td-sys' ? 'next' : 'done' });
    const err = h('p', { class: 'td-err', id: `${id}-err`, 'aria-live': 'polite' });
    input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });
    return { input, err, el: h('div', { class: 'td-bpf' }, h('label', { for: id }, label, h('small', {}, hint)), input, err), min, max };
  };
  const sys = f('td-sys', 'الانقباضي', 70, 260, ' (الكبير)');
  const dia = f('td-dia', 'الانبساطي', 40, 160, ' (الصغير)');
  const save = h('button', { type: 'button', class: 'td-save' }, 'سجّل');
  const run = async () => {
    const H = await import('../workout/heart.js');
    const v = H.validateBP({ sys: sys.input.value.trim(), dia: dia.input.value.trim() });
    sys.err.textContent = v.errors.sys || ''; dia.err.textContent = v.errors.dia || '';
    sys.input.setAttribute('aria-invalid', String(!!v.errors.sys)); dia.input.setAttribute('aria-invalid', String(!!v.errors.dia));
    if (!v.ok) { (v.errors.sys ? sys : dia).input.focus(); return; }
    save.disabled = true; haptic();
    const row = { id: `bp:${Date.now().toString(36)}`, at: new Date().toISOString(), day: st.day, ...v.value, cuff: st.health.cuffArm === false ? 'other' : 'arm' };
    try { await H.patchHealth(ctx.db, (c) => ({ ...c, bp: [...(c.bp || []), row].slice(-400) })); } catch { ctx.toast('ماقدرناش نحفظ دلوقتي. جرّب تاني.'); save.disabled = false; return; }
    ctx.toast(`اتسجّل ${row.sys}/${row.dia}: ${H.bpCategory(row.sys, row.dia).label}`);
    ctx.emit('health:changed', { day: st.day });
  };
  const toNum = (s) => String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  for (const x of [sys, dia]) x.input.addEventListener('input', () => { const t = toNum(x.input.value); if (t !== x.input.value) x.input.value = t; });
  sys.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dia.input.focus(); } });
  dia.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  save.addEventListener('click', run);
  const sub = due ? `قراءة ${due.today + 1} من 2 · يوم ${g.days} من 3` : 'قراءة جديدة';
  return h('section', { class: 'td-now td-bp gl', 'aria-labelledby': 'td-bp-h' },
    h('div', { class: 'td-nh' }, I('heart', { size: 16 }), h('h2', { id: 'td-bp-h' }, 'ضغط البيت'), h('small', {}, sub),
      h('a', { class: 'td-lnk', href: '#/workout/heart?tab=bp' }, 'السجل')),
    h('div', { class: 'td-bpin' }, sys.el, h('span', { class: 'td-slash', 'aria-hidden': 'true' }, '/'), dia.el, save),
    h('p', { class: 'td-hint' }, 'جهاز دراع، بعد 5 دقايق راحة وإنت قاعد · قراءتين بينهم دقيقة'));
}

function kegelCard(st, ctx) {
  const kg = st.health.kegel || {};
  let week = 1; try { if (kg.start) week = Math.floor(diffDays(kg.start, st.day) / 7) + 1; } catch { /* default */ }
  const due = kegelDue({ kegel: kg, day: st.day, week });
  if (!due) return null;
  const go = h('button', { type: 'button', class: 'td-go', dataset: { quick: 'kegel' } }, I('play', { size: 16 }), 'ابدأ');
  go.addEventListener('click', () => { haptic(); ctx.go('workout/kegel'); });
  return h('section', { class: 'td-wo td-kegel gl', 'aria-label': `تمرين قاع الحوض: مرة ${due.done + 1} من ${due.perDay} النهارده` },
    h('div', { class: 'td-ic', 'aria-hidden': 'true' }, I('timer')),
    h('div', { class: 't' }, h('small', {}, 'في البيت · حوالي 4 دقايق'), h('b', {}, 'تمرين قاع الحوض'),
      h('span', {}, `مرة ${due.done + 1} من ${due.perDay} النهارده`)), go);
}

function moreMenu(st, ctx) {
  const day = st.day; const flip = st.type === 'training' ? 'rest' : 'training';
  const body = h('div', {});
  const s = ctx.sheet({ title: 'خيارات اليوم', body });
  const item = (ic, text, run) => body.appendChild(h('button', { type: 'button', class: 'menu-item', onclick: () => { s.close(); run(); } }, I(ic), text));
  item('repeat', flip === 'rest' ? 'خلّي النهارده يوم راحة' : 'خلّي النهارده يوم تمرين', async () => {
    const n = await kv(ctx.db, 'nutrition'); const prev = { ...(n.dayTypeOverrides || {}) };
    try { await ctx.db.put('kv', { key: 'nutrition', value: { ...n, dayTypeOverrides: { ...prev, [day]: flip } } }); } catch { ctx.toast('ماقدرناش نحفظ دلوقتي.'); return; }
    ctx.emit('settings:changed', { key: 'dayType', day });
    ctx.toast(flip === 'rest' ? 'النهارده بقى يوم راحة · الهدف اتغيّر' : 'النهارده بقى يوم تمرين · الهدف اتغيّر', { action: { label: 'تراجع', run: async () => {
      const n2 = await kv(ctx.db, 'nutrition'); await ctx.db.put('kv', { key: 'nutrition', value: { ...n2, dayTypeOverrides: prev } }); ctx.emit('settings:changed', { key: 'dayType', day });
    } } });
  });
  item('scale', 'سجّل الوزن', () => openWeightSheet(ctx));
  item('msg', 'اسأل المدرب', () => import('../coach/api.js').then((a) => a.openCoachSheet(ctx, { intent: 'chat' })));
  item('chart', 'التقدّم والتقارير', () => ctx.go('progress'));
  item('settings', 'الملف والإعدادات', () => ctx.go('profile'));
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
  shownNum.clear(); // a fresh visit counts the ring figures up again
  let forceBP = !!params.bp;
  const paint = () => {
    if (!alive) return;
    const hour = new Date().getHours();
    const greet = st.name ? `${hour < 12 ? 'صباح الفل' : 'مساء الفل'} يا ${st.name}` : dayTitle(st.day);
    const more = h('button', { type: 'button', class: 'td-ib gl', 'aria-label': 'خيارات اليوم', 'aria-haspopup': 'dialog', onclick: () => moreMenu(st, ctx) }, I('more'));
    const openW = () => wellnessSheet(st, ctx, paint);
    const weighed = st.weights.some((w) => w.day === st.day);
    fill(el, h('div', { class: 'td' },
      h('header', { class: 'td-hd' }, h('div', {}, h('p', { class: 'td-dayp' }, st.name ? dayTitle(st.day) : '', h('b', { class: st.type === 'training' ? 'tr' : st.type === 'heart' ? 'hd' : 'rs' }, st.type === 'heart' && st.cardio === 'boxing' ? 'يوم الملاكمة' : DAY_TYPE_LABEL[st.type])), h('h1', {}, greet)), more),
      weightDue({ hour, weighed }) ? weightRow(st, ctx) : null, mealCard(st, ctx, hour), bpCard(st, ctx, forceBP),
      gauge(st), macros(st, ctx), workoutCard(st, ctx), kegelCard(st, ctx), tiles(st, ctx, openW), intel(st, ctx, openW), goals(st, ctx, paint)));
  };
  const refresh = async () => { st = await load(ctx); paint(); };
  await refresh();
  await quickAction(ctx, params, () => st, (v) => { forceBP = v; paint(); });
  const offs = ['food:changed', 'session:changed', 'weight:changed', 'settings:changed', 'wellness:changed', 'health:changed'].map((e) => ctx.on(e, () => { if (e === 'health:changed') forceBP = false; refresh(); }));
  const onVis = () => { if (document.visibilityState === 'visible' && st && st.day !== ctx.today()) refresh(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { alive = false; offs.forEach((f) => f()); document.removeEventListener('visibilitychange', onVis); };
}

export const routes = { today: renderToday };
