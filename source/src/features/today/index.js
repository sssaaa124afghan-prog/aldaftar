// Today (النهارده) — Electric Glass Pro: greeting → calorie gauge → 4 macro rings → today's workout card →
// tiles (water / readiness / consistency) → «ذكاء اليوم» → «أهداف النهارده».
import './today.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, countText } from '../../ui/num.js';
import { ring } from '../../ui/ring.js';
import { countUp, pop, haptic, reduced } from '../../ui/anim.js';
import { parseDayKey, weekday } from '../../core/date.js';
import { sumEntries, dayType, heartDowOf, heartDaysOf } from '../../core/targets.js';
import { DAY_TYPE_LABEL, sessionState, loadTargets } from '../../app/day.js';
import { SECTION_LABEL } from '../nutrition/logic.js';
import { openWeightSheet } from '../profile/weight.js';
import * as WK from '../workout/logic.js';
import { bpGate } from '../workout/bp.js';
import * as M from '../progress/metrics.js';
import { waterGoalMl, mealsDone, checklist, AUTO_ITEMS, DEFAULT_PREGYM } from './logic.js';

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
  const heartDays = heartDaysOf(sessions);
  const type = dayType(day, { trainingDays, overrides, sessionDays: doneDays, heartDays, heartDow });
  const planned = dayType(day, { trainingDays, overrides, heartDow });
  const t = targets[type];
  const ws = M.lifting(sessions);
  weights.sort((a, b) => String(a.day).localeCompare(String(b.day)));
  return { day, type, planned, target: { kcal: t.kcal, p: t.p, c: t.c, f: t.f }, entries: (log && Array.isArray(log.entries)) ? log.entries : [],
    nutrition, progress, training, sessions, lifting: ws, programRec, weights, daily: daily || { day }, name: String((prof && prof.name) || '').trim(),
    sex: prof && prof.sex, trainingDays, heartDow, bp: Array.isArray(health.bp) ? health.bp : [], startDow: Number(ctx.settings.get('weekStart')) || 1 };
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

function macros(st, ctx) {
  const tot = sumEntries(st.entries); const md = mealsDone(st.entries);
  const mk = (val, max, color, name, sub, label, href) => h('a', { class: 'td-mc gl', href, style: `--k:${color}` },
    h('div', { class: 'td-rw' }, ring({ value: val, max, color, size: 64, stroke: 6, track: 'rgba(255,255,255,.12)', label }), h('b', { class: 'num' }, typeof val === 'string' ? val : fmt(val))),
    h('div', { class: 'td-nm' }, name), h('div', { class: 'td-sub' }, sub));
  const meals = h('a', { class: 'td-mc gl', href: md.next ? `#/nutrition?section=${md.next}` : '#/nutrition', style: '--k:var(--cal)' },
    h('div', { class: 'td-rw' }, ring({ value: md.done, max: md.total, color: 'var(--cal)', size: 64, stroke: 6 }), h('b', { class: 'num' }, `${md.done}/${md.total}`)),
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
    title = d ? d.name : 'يوم تمرين'; sub = d ? `${countText(d.items.length, 'exercise')} · ${est ? est.lift : WK.estimateMinutes(d.items)} دقيقة${est && est.z2 ? ` + Zone 2 ‏${est.z2} د` : ''}` : 'الخطة جاهزة';
    btn = 'ابدأ'; run = () => ctx.go('workout', { start: '1' });
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
  if (load) rows.push(h('div', { class: `td-row l-${load.level}` }, h('i', { 'aria-hidden': 'true' }), h('p', {}, h('b', {}, 'حمل التدريب: '), h('span', { class: 'num' }, fmt(load.ratio, { dp: 2 })), ` — ${M.LOAD_TEXT[load.level]}`)));
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
  const item = (r) => {
    const box = h('button', { type: 'button', class: `td-ck${r.done ? ' on' : ''}`, role: 'checkbox', 'aria-checked': String(r.done), 'aria-label': r.label }, I('check', { size: 16 }));
    if (r.auto && !ACT[r.id]) box.disabled = true;
    box.addEventListener('click', async () => {
      if (r.auto) { ACT[r.id] && ACT[r.id](); return; } // auto items tick from your data
      const on = !r.done;
      try { st.daily = await patchDaily(ctx, st.day, (d) => ({ ...d, checklist: { ...(d.checklist || {}), [r.id]: on } })); } catch { ctx.toast('ماقدرناش نحفظ.'); return; }
      haptic(); rerender(); requestAnimationFrame(() => pop(document.querySelector(`[data-ck="${r.id}"] .td-ck`)));
    });
    return h('li', { class: r.done ? 'done' : '', dataset: { ck: r.id } }, box, h('span', {}, r.label),
      r.auto ? h('small', {}, r.done ? 'اتحقق' : 'تلقائي') : null);
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

export async function renderToday(el, ctx) {
  let st; let alive = true; let first = true;
  const paint = () => {
    if (!alive) return;
    const hour = new Date().getHours();
    const greet = st.name ? `${hour < 12 ? 'صباح الفل' : 'مساء الفل'} يا ${st.name}` : dayTitle(st.day);
    const more = h('button', { type: 'button', class: 'td-ib gl', 'aria-label': 'خيارات اليوم', 'aria-haspopup': 'dialog', onclick: () => moreMenu(st, ctx) }, I('more'));
    const openW = () => wellnessSheet(st, ctx, paint);
    fill(el, h('div', { class: `td${first && !reduced() ? ' td-in' : ''}` },
      h('header', { class: 'td-hd' }, h('div', {}, h('p', { class: 'td-dayp' }, st.name ? dayTitle(st.day) : '', h('b', { class: st.type === 'training' ? 'tr' : st.type === 'heart' ? 'hd' : 'rs' }, DAY_TYPE_LABEL[st.type])), h('h1', {}, greet)), more),
      gauge(st), macros(st, ctx), workoutCard(st, ctx), tiles(st, ctx, openW), intel(st, ctx, openW), goals(st, ctx, paint)));
    first = false;
  };
  const refresh = async () => { st = await load(ctx); paint(); };
  await refresh();
  const offs = ['food:changed', 'session:changed', 'weight:changed', 'settings:changed', 'wellness:changed'].map((e) => ctx.on(e, () => refresh()));
  const onVis = () => { if (document.visibilityState === 'visible' && st && st.day !== ctx.today()) refresh(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { alive = false; offs.forEach((f) => f()); document.removeEventListener('visibilitychange', onVis); };
}

export const routes = { today: renderToday };
