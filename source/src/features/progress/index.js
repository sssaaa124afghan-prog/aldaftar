// Progress (التقدّم): smart summary → القوة → الحجم → الجسم → التقارير. Electric Glass Pro.
// Every projection is labelled «تقدير». AI runs only on a button press and is cached per day (coach/api.js).
import './progress.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, parseNum } from '../../ui/num.js';
import { ring } from '../../ui/ring.js';
import { countUp } from '../../ui/anim.js';
import { isDayKey, addDays, weekDays, weekStart, diffDays } from '../../core/date.js';
import { sumEntries, targetsForDay, heartDaysOf, heartDowOf, cardioOf, withDayTypes } from '../../core/targets.js';
import { boxingWeekStats } from '../workout/boxing-plan.js';
import * as WK from '../workout/logic.js';
import { targetRange, richTextNodes } from '../nutrition/logic.js';
import { openWeightSheet } from '../profile/weight.js';
import * as M from './metrics.js';
import { movingAvg7, weeklyTrend, weekAdherence, weeklyReportLines, cleanWeights } from './logic.js';
import { lineChart, columns, dualChart, scatter, dm, monthOf } from './charts.js';
import { INFO } from './info.js';

const I = (n) => raw(icon(n));
const N = (v, dp = 0, o = {}) => h('span', { class: 'num' }, fmt(v, { dp, ...o }));
// counted figure: final value at first paint, counts up from 0 when it comes on screen (ui/anim.js countUp)
const NC = (v, dp = 0) => { const el = N(v, dp); if (Number.isFinite(+v) && +v > 0) countUp(el, +v, { dp, ms: 800, format: (x) => fmt(x, { dp }) }); return el; };
const NF = (a, b) => { if (!+b && !+a) return h('span', { class: 'num' }, '—'); const el = h('span', { class: 'num' }, `${a}/${b}`); if (+a > 0) countUp(el, +a, { ms: 700, format: (x) => `${Math.round(x)}/${b}` }); return el; };
const PERIOD_KEYS = ['m', 'q', 'y'];

async function loadAll(ctx) {
  const db = ctx.db;
  const all = async (st) => { try { return await db.getAll(st); } catch { return []; } };
  const kv = async (k) => { try { const r = await db.get('kv', k); return r && r.value && typeof r.value === 'object' ? r.value : {}; } catch { return {}; } };
  const [sessions, weights, logs, dailyRows, measurements, targetsKv, nutrition, progress, prof, programRec] = await Promise.all([
    all('sessions'), all('bodyweight'), all('foodLog'), all('daily'), all('measurements'), kv('targets'), kv('nutrition'), kv('progress'), db.get('profile', 'me').catch(() => null),
    db.get('programs', 'current').catch(() => null)]);
  const foodLog = {}; for (const r of logs) if (r && isDayKey(r.day) && Array.isArray(r.entries)) foodLog[r.day] = r.entries;
  const daily = {}; for (const r of dailyRows) if (r && isDayKey(r.day)) daily[r.day] = r;
  const targets = withDayTypes(targetsKv);
  return { sessions, weights: cleanWeights(weights), foodLog, daily, measurements: measurements.filter((m) => m && isDayKey(m.day)).sort((a, b) => a.day.localeCompare(b.day)),
    targets, overrides: nutrition.dayTypeOverrides || {}, heartDow: heartDowOf(programRec), cardio: cardioOf(programRec)?.kind || null, progress, profile: prof || {} };
}

async function patchProgress(ctx, fn) {
  let cur = {};
  try { const r = await ctx.db.get('kv', 'progress'); cur = (r && r.value) || {}; } catch { /* new */ }
  const next = fn(structuredClone(cur));
  await ctx.db.put('kv', { key: 'progress', value: next });
  return next;
}

function infoBtn(ctx, key) {
  const it = INFO[key];
  if (!it) return null;
  return h('button', { type: 'button', class: 'pg-info', 'aria-label': `إيه معنى ${it.title}؟`, onclick: () => ctx.sheet({ title: it.title, body: h('div', { class: 'pg-info-body' }, ...it.text.map((t) => h('p', {}, t))) }) }, '?');
}

async function progress(el, ctx, params) {
  let alive = true;
  const today = ctx.today();
  const startDow = Number(ctx.settings.get('weekStart')) || 1;
  const trainingDays = ctx.settings.get('trainingDays') || [1, 2, 4, 5];
  const planned = trainingDays.length || 4;
  const period = PERIOD_KEYS.includes(params.p) ? params.p : 'q';
  const from = addDays(today, -M.PERIODS[period].days + 1);
  let st = null;
  const ui = { lift: null, vol: '8w', kcal: 7, cmpA: null, cmpB: null, prAll: false };

  // Progressive disclosure: «الأسبوع ده» opens first, every other section starts collapsed.
  // Open/closed is remembered per section in kv.progress.open (Hick's law: one summary, then choose).
  const isOpen = (id) => { const o = st.progress.open || {}; return id in o ? !!o[id] : id === 'week'; };
  const setOpen = async (id, open) => {
    st.progress.open = { ...(st.progress.open || {}), [id]: open };
    try { await patchProgress(ctx, (p) => ({ ...p, open: { ...(p.open || {}), [id]: open } })); } catch { /* memory only */ }
  };
  const section = (id, title, info, ...children) => {
    const collapsed = !isOpen(id);
    const body = h('div', { class: 'pg-sec-body', id: `pg-b-${id}`, hidden: collapsed });
    // collapsed sections are built on first open (keeps the first paint light)
    const build = () => { if (!body.childNodes.length) body.append(...[].concat(typeof children[0] === 'function' ? children[0]() : children).flat().filter(Boolean)); };
    if (!collapsed) build();
    const tog = h('button', { type: 'button', class: 'pg-tog', 'aria-expanded': String(!collapsed), 'aria-controls': `pg-b-${id}` }, h('h2', { id: `pg-h-${id}` }, title), I('chevron'));
    const toggle = (open) => { if (open) build(); body.hidden = !open; tog.setAttribute('aria-expanded', String(open)); setOpen(id, open); };
    tog.addEventListener('click', () => toggle(body.hidden));
    tog._open = () => { if (body.hidden) toggle(true); };
    const sec = h('section', { class: 'pg-sec', id: `pg-${id}`, 'aria-labelledby': `pg-h-${id}` }, h('div', { class: 'pg-sec-h' }, tog, infoBtn(ctx, info)), body);
    sec._open = tog._open;
    return sec;
  };
  const card = (cls, ...kids) => h('div', { class: `pg-card ${cls || ''}` }, ...kids.flat().filter(Boolean));
  const head = (title, sub, info) => h('div', { class: 'pg-ch' }, h('h3', {}, title), sub ? h('small', {}, sub) : null, info ? infoBtn(ctx, info) : null);

  function tOf(d) {
    const done = new Set(M.lifting(st.sessions).map((s) => s.day));
    return targetsForDay(d, { targets: st.targets, trainingDays, overrides: st.overrides, sessionDays: done, heartDays: heartDaysOf(st.sessions), heartDow: st.heartDow });
  }

  // ───────── this week (first, open) ─────────
  function thisWeek() {
    const adh = weekAdherence({ anchorDay: today, weekStartDow: startDow, trainingDays, sessions: st.sessions, foodLog: st.foodLog, targets: st.targets, overrides: st.overrides, heartDow: st.heartDow });
    const prevAdh = weekAdherence({ anchorDay: addDays(today, -7), weekStartDow: startDow, trainingDays, sessions: st.sessions, foodLog: st.foodLog, targets: st.targets, overrides: st.overrides, heartDow: st.heartDow });
    const wc = M.weekCompareTraining(st.sessions, today, startDow);
    const trend = weeklyTrend(st.weights);
    // no bare «0» delta: nothing to compare against (both zero / no baseline) → no delta at all (UX audit #14)
    const d = (a, b, dp = 0, unit = '') => (a === null || a === undefined || b === null || b === undefined || (!+a && !+b) ? null
      : h('em', { class: `pg-wd ${a > b ? 'up' : a < b ? 'down' : ''}` }, `${fmt(Math.round((a - b) * 10 ** dp) / 10 ** dp, { dp, sign: true })}${unit}`, h('span', { class: 'vh' }, ' عن الأسبوع اللي فات')));
    const fig = (label, val, delta, sub) => h('div', { class: 'pg-fig4' }, h('small', {}, label), h('b', {}, val), delta || (sub ? h('em', {}, sub) : null));
    const ws = weekStart(today, startDow);
    const card1 = card('pg-thisweek',
      h('div', { class: 'pg-ch' }, h('h3', {}, 'حساب الأسبوع لحد النهارده'), h('small', {}, `${dm(ws)} – ${dm(addDays(ws, 6))} · الفرق عن نفس الوقت الأسبوع اللي فات`)),
      h('div', { class: 'pg-grid4' },
        fig('جلسات', NF(adh.sessionsDone, adh.sessionsPlanned), d(wc.cur.sessions, wc.prev.sessions)),
        fig('أيام البروتين', NF(adh.proteinDaysHit, adh.daysLogged), d(adh.proteinDaysHit, prevAdh.proteinDaysHit)),
        fig('متوسط السعرات', adh.avgKcal ? NC(adh.avgKcal) : '—', d(adh.avgKcal, prevAdh.avgKcal)),
        fig('الوزن', trend ? h('span', {}, N(trend.kgPerWeek, 1, { sign: true }), h('small', {}, ' كجم/أسبوع')) : '—', null, trend ? 'متوسط 7 أيام' : 'محتاج وزنات أكتر')),
      h('div', { class: 'pg-grid4 pg-grid2' },
        fig('حجم التمرين', h('span', {}, NC(wc.cur.volume), h('small', {}, ' كجم')), d(wc.cur.volume, wc.prev.volume)),
        fig('أرقام قياسية', NC(wc.cur.prs), d(wc.cur.prs, wc.prev.prs))),
      boxingFigs(fig, d, ws),
      aiBlock('weekly', 'اسأل المدرب عن أسبوعي', 'تقرير الأسبوع + تركيز الأسبوع الجاي'));
    return [card1];
  }

  // Boxing Day (plan v3): weekly bag rounds + minutes; cardio only, never part of the lifting volume above
  function boxingFigs(fig, d, ws) {
    const has = st.cardio === 'boxing' || st.sessions.some((s) => s && s.kind === 'boxing');
    if (!has) return null;
    const cur = boxingWeekStats(st.sessions, today, startDow);
    const prev = boxingWeekStats(st.sessions, addDays(ws, -1), startDow);
    return h('div', { class: 'pg-grid4 pg-grid2 pg-box', dataset: { fk: 'pg-box' } },
      fig('جولات ملاكمة', NC(cur.rounds), d(cur.rounds, prev.rounds), cur.sessions ? null : 'لسه مفيش الأسبوع ده'),
      fig('دقايق ملاكمة', h('span', {}, NC(cur.minutes), h('small', {}, ' د')), d(cur.minutes, prev.minutes), cur.avgRpe ? `متوسط المجهود ${cur.avgRpe}` : null));
  }

  // ───────── summary ─────────
  function summary() {
    const sm = M.smartSummary(st.sessions, { today, startDow, plannedPerWeek: planned });
    let wp = null; try { wp = WK.weeksOnPlan(st.sessions, { plannedPerWeek: planned, weekStartDow: startDow, today }); } catch { /* ignore */ }
    const fig = (label, val, sub, key) => h('div', { class: 'pg-fig4' }, h('small', {}, label), h('b', {}, val), sub ? h('em', {}, sub) : null, key ? infoBtn(ctx, key) : null);
    const loadTxt = sm.load ? h('span', { class: `num pg-load l-${sm.load.level}` }, fmt(sm.load.ratio, { dp: 2 })) : '—';
    const top = card('pg-sum',
      h('div', { class: 'pg-grid4' },
        fig('جلسات الأسبوع', h('span', { class: 'num' }, `${sm.sessionsWeek}/${sm.planned}`), null),
        fig('حجم الأسبوع', N(sm.weekVolume), 'كجم'),
        fig('حمل التدريب', loadTxt, sm.load ? M.LOAD_TEXT[sm.load.level].split(' — ')[0] : 'محتاج 3 جلسات', 'load'),
        fig('على الخطة', N(wp ? wp.weeks : 0), 'أسبوع متتالي', 'weeks')),
      h('p', { class: 'pg-sentence' }, sm.sentence));
    const lag = M.laggingMuscle(st.sessions, today);
    // adherence over the period + weight duo (design B)
    let done = 0, plan = 0, pHit = 0, logged = 0;
    const doneDays = new Set(M.lifting(st.sessions).map((s) => s.day));
    for (let d = from; d <= today; d = addDays(d, 1)) {
      if (trainingDays.includes(new Date(`${d}T12:00:00`).getDay())) plan++;
      if (doneDays.has(d)) done++;
      const es = st.foodLog[d] || [];
      if (es.length) { logged++; if (sumEntries(es).p >= targetRange(tOf(d)).pMin) pHit++; }
    }
    const pct = plan + logged ? Math.round(((Math.min(done, plan) + pHit) / (plan + logged)) * 100) : 0;
    const adhRing = h('div', { class: 'pg-adh-r' }, ring({ value: pct, max: 100, color: 'var(--carb)', size: 64, stroke: 7, label: `الالتزام ${pct}%` }), h('b', { class: 'num' }, `${pct}%`));
    const avg = movingAvg7(st.weights.filter((w) => w.day >= addDays(from, -6)));
    const last = avg[avg.length - 1];
    const first = avg.find((a) => a.day >= from) || avg[0];
    const dW = last && first && last !== first ? Math.round((last.avg7 - first.avg7) * 10) / 10 : null;
    const spark = avg.length > 1 ? lineChart({ points: avg.filter((a) => a.day >= from).map((a) => ({ day: a.day, v: a.avg7 })), color: 'var(--fat)', area: false, H: 40, label: 'اتجاه الوزن، متوسط 7 أيام' }) : null;
    if (spark) spark.classList.add('pg-spark');
    const duo = h('div', { class: 'pg-duo' },
      card('pg-wt', head('الوزن', 'متوسط 7 أيام'), last ? h('b', { class: 'pg-big' }, N(last.avg7, 1), h('small', {}, ' كجم')) : h('p', { class: 'pg-hint' }, 'سجّل وزنك'), spark,
        dW !== null ? h('p', { class: 'pg-delta' }, h('span', { class: 'num' }, fmt(dW, { dp: 1, sign: true })), ` كجم في ${M.PERIODS[period].label}`) : null),
      card('pg-adh', head('الالتزام', M.PERIODS[period].label, 'adherence'), h('div', { class: 'pg-adh-in' }, adhRing,
        h('ul', {}, h('li', { class: 'k-carb' }, 'تمرين ', h('b', { class: 'num' }, `${Math.min(done, plan)}/${plan}`)), h('li', { class: 'k-pro' }, 'بروتين ', h('b', { class: 'num' }, `${pHit}/${logged}`))))));
    return [top, duo, lag ? h('p', { class: 'pg-signal' }, I('chart'), `${lag.muscle} متأخرة: ${lag.sets} سيت قوي في 4 أسابيع مقابل ${lag.topSets} لـ${lag.top}. زوّد لها 2-4 سيتات في الأسبوع.`) : null];
  }

  // ───────── strength ─────────
  function strength() {
    const lifts = M.liftsIn(st.sessions);
    if (!lifts.length) return [card('', h('div', { class: 'empty-state' }, h('h3', {}, 'لسه مفيش جلسات'), h('p', {}, 'أول جلسة تمرين بتبدأ رسم القوة هنا.'), h('a', { class: 'btn sm', href: '#/workout' }, 'روح للتمرين')))];
    if (!ui.lift || !lifts.find((l) => l.key === ui.lift)) ui.lift = (st.progress.lift && lifts.find((l) => l.key === st.progress.lift)) ? st.progress.lift : lifts[0].key;
    const L = lifts.find((l) => l.key === ui.lift);
    const series = M.e1rmSeries(st.sessions, L.item);
    const inP = series.filter((p) => p.day >= from);
    const cur = series.length ? Math.max(...series.slice(-3).map((x) => x.e1rm)) : 0;
    const firstP = inP[0];
    const delta = firstP && inP.length > 1 ? Math.round((inP[inP.length - 1].e1rm - firstP.e1rm) * 10) / 10 : null;
    const rate = M.progressRate(st.sessions, L.item, { today, weeks: 8 });
    const proj = M.projection(cur, rate, 12);
    const sel = h('select', { class: 'pg-sel', 'aria-label': 'اختار التمرين' }, ...lifts.slice(0, 30).map((l) => h('option', { value: l.key, selected: l.key === ui.lift }, l.name)));
    sel.addEventListener('change', () => { ui.lift = sel.value; patchProgress(ctx, (p) => ({ ...p, lift: sel.value })).catch(() => {}); paint(); });
    const big = h('span', { class: 'num' }, fmt(cur, { dp: 1 }));
    requestAnimationFrame(() => countUp(big, cur, { from: firstP ? firstP.e1rm : 0, dp: 1 }));
    const chart = inP.length >= 2
      ? lineChart({ points: inP.map((p) => ({ day: p.day, v: p.e1rm })), color: 'var(--pro)', dots: true, label: `أقصى وزن متوقع لـ${L.name}: من ${fmt(inP[0].e1rm, { dp: 1 })} لـ ${fmt(inP[inP.length - 1].e1rm, { dp: 1 })} كجم، ${inP.length} نقطة. الأقدم يمين.` })
      : h('p', { class: 'pg-hint' }, 'محتاج جلستين على الأقل في الفترة دي عشان يبان الخط.');
    const bw = st.weights.length ? st.weights[st.weights.length - 1].kg : null;
    const lvl = L.lift && bw ? M.strengthLevel(cur, bw, L.lift, st.profile.sex) : null;
    const e1 = card('pg-e1',
      h('div', { class: 'pg-e1-top' },
        h('div', {}, h('div', { class: 'pg-lbl' }, 'أقصى وزن متوقّع (e1RM)', infoBtn(ctx, 'e1rm')), h('div', { class: 'pg-big' }, big, h('small', {}, ' كجم')),
          delta !== null ? h('p', { class: `pg-delta${delta < 0 ? ' neg' : ''}` }, I('chart'), h('span', { class: 'num' }, fmt(delta, { dp: 1, sign: true })), ` كجم في ${M.PERIODS[period].label}`) : null),
        sel),
      chart,
      h('div', { class: 'pg-chips' },
        rate !== null ? h('span', { class: 'pg-chip' }, 'المعدل ', h('b', {}, M.rateLabel(rate))) : h('span', { class: 'pg-chip' }, 'المعدل محتاج 3 جلسات في أسبوعين'),
        proj ? h('span', { class: 'pg-chip est' }, `بعد 12 أسبوع: `, N(proj.value, 1), ' كجم · تقدير') : null,
        lvl ? h('span', { class: 'pg-chip' }, 'المستوى ', h('b', {}, lvl.label), ` · `, N(lvl.ratio, 2), '× وزنك', infoBtn(ctx, 'level')) : null),
      lvl && lvl.next ? h('p', { class: 'pg-hint' }, `المستوى الجاي (${lvl.next.label}): `, N(lvl.next.kg, 1), ' كجم بوزنك الحالي.') : null);

    // rate chips for the main lifts
    const rates = lifts.filter((l) => l.kind === 'compound').slice(0, 4).map((l) => ({ l, r: M.progressRate(st.sessions, l.item, { today, weeks: 8 }) }));
    const rateRow = h('div', { class: 'pg-rates' }, ...rates.map(({ l, r }) => h('button', { type: 'button', class: `pg-rate${r !== null && r >= 0.25 ? ' up' : r !== null && r <= -0.25 ? ' down' : ''}`, onclick: () => { ui.lift = l.key; paint(); } }, h('span', {}, l.name), h('b', {}, M.rateLabel(r) || '—'))));

    // DOTS
    const byLift = (k) => { const x = lifts.find((l) => l.lift === k); if (!x) return 0; const s = M.e1rmSeries(st.sessions, x.item); return s.length ? Math.max(...s.map((p) => p.e1rm)) : 0; };
    const total = byLift('squat') + byLift('bench') + byLift('deadlift');
    const dots = byLift('squat') && byLift('bench') && byLift('deadlift') && bw ? M.dots(total, bw, st.profile.sex) : null;
    const levels = card('pg-levels', head('مستوى القوة', bw ? `بوزنك ${fmt(bw, { dp: 1 })} كجم` : 'سجّل وزنك', 'level'),
      ...lifts.filter((l) => l.lift).slice(0, 5).map((l) => {
        const s = M.e1rmSeries(st.sessions, l.item); const best = s.length ? Math.max(...s.slice(-3).map((p) => p.e1rm)) : 0;
        const v = bw ? M.strengthLevel(best, bw, l.lift, st.profile.sex) : null;
        return h('div', { class: 'pg-lvl' }, h('span', {}, M.LIFT_AR[l.lift]), h('div', { class: 'pg-lvl-bar', role: 'img', 'aria-label': v ? `${M.LIFT_AR[l.lift]}: ${v.label}` : '' }, ...[0, 1, 2, 3, 4].map((i) => h('i', { class: v && i <= v.idx ? 'on' : '' }))), h('b', {}, v ? v.label : '—'));
      }),
      dots ? h('p', { class: 'pg-dots' }, 'DOTS ', h('b', { class: 'num' }, fmt(dots, { dp: 1 })), M.wilksScore(total, bw, st.profile.sex) ? [' · Wilks ', h('b', { class: 'num' }, fmt(M.wilksScore(total, bw, st.profile.sex), { dp: 1 }))] : null, ` · مجموع ${fmt(total, { dp: 0 })} كجم (سكوات + بنش + ديدليفت، e1RM)`, infoBtn(ctx, 'dots')) : null);

    // PRs
    const tl = M.prTimeline(st.sessions);
    const best = M.prList(st.sessions);
    const prItems = (ui.prAll ? best : tl.slice(0, 8));
    const prCard = card('pg-prs', head(ui.prAll ? 'أفضل رقم لكل تمرين' : 'آخر الأرقام القياسية', ui.prAll ? `${best.length} تمرين` : `${tl.length} رقم`),
      prItems.length ? h('ol', { class: 'pg-prl' }, ...prItems.map((p) => h('li', {}, h('span', { class: 'pg-prd' }, dm(p.day)), h('b', {}, p.name), h('span', { class: 'num' }, `${fmt(p.w, { dp: 1 })}×${p.r}`), h('em', { class: 'num' }, fmt(p.e1rm, { dp: 1 }), p.delta ? h('small', {}, ` +${fmt(p.delta, { dp: 1 })}`) : null))))
        : h('p', { class: 'pg-hint' }, 'أول رقم قياسي بيظهر لما تعدّي أحسن أداء ليك في أي تمرين.'),
      h('button', { type: 'button', class: 'pg-link', onclick: () => { ui.prAll = !ui.prAll; paint(); } }, ui.prAll ? 'آخر الأرقام بالتاريخ' : 'أفضل رقم لكل تمرين'));

    // goals
    const goals = Array.isArray(st.progress.goals) ? st.progress.goals : [];
    const gCard = card('pg-goals', head('أهداف القوة', goals.length ? `${goals.length}` : ''),
      ...goals.map((g) => {
        const item = g.item || { lib: g.lib, name: g.name, en: g.en };
        const s = M.e1rmSeries(st.sessions, item); const c = s.length ? Math.max(...s.slice(-3).map((p) => p.e1rm)) : 0;
        const r = M.progressRate(st.sessions, item, { today, weeks: 8 });
        const pd = c ? M.predictDate(c, r, +g.target, today) : null;
        const pct = Math.max(0, Math.min(100, Math.round((c / g.target) * 100)));
        return h('div', { class: 'pg-goal' },
          h('div', { class: 'pg-goal-h' }, h('b', {}, g.name), h('span', { class: 'num' }, `${fmt(c, { dp: 1 })} / ${fmt(g.target, { dp: 1 })}`),
            h('button', { type: 'button', class: 'pg-x', 'aria-label': `امسح هدف ${g.name}`, onclick: async () => {
              if (!(await ctx.confirm({ title: `تمسح هدف ${g.name}؟`, confirmLabel: 'امسح الهدف', danger: true }))) return;
              st.progress = await patchProgress(ctx, (p) => ({ ...p, goals: (p.goals || []).filter((x) => x.id !== g.id) })); paint();
            } }, I('x'))),
          h('div', { class: 'pg-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${g.name} ${pct}%` }, h('i', { style: { width: `${pct}%` } })),
          h('p', { class: 'pg-hint' }, pd ? (pd.reached ? 'وصلت للهدف.' : [`على المعدل ده: ${dm(pd.day)} (بعد ${M.weeksText(pd.weeks)}) · تقدير`]) : 'التاريخ المتوقع بيظهر لما المعدل يبقى بيطلع.',
            g.by ? ` · المطلوب قبل ${dm(g.by)}` : ''));
      }),
      h('button', { type: 'button', class: 'btn ghost sm pg-add', onclick: () => goalSheet(lifts) }, I('plus'), 'هدف جديد'));
    return [e1, rates.length ? rateRow : null, levels, prCard, gCard];
  }

  function goalSheet(lifts) {
    const sel = h('select', { id: 'pg-g-l' }, ...lifts.slice(0, 40).map((l) => h('option', { value: l.key }, l.name)));
    const kg = h('input', { id: 'pg-g-kg', type: 'text', inputmode: 'decimal', class: 'num', autocomplete: 'off', 'aria-describedby': 'pg-g-err' });
    const by = h('input', { id: 'pg-g-by', type: 'date', min: today });
    const err = h('p', { class: 'err', id: 'pg-g-err', 'aria-live': 'polite' });
    const check = () => { const v = parseNum(kg.value); const ok = v > 0 && v <= 600; err.textContent = ok ? '' : 'اكتب الهدف بالكيلو، رقم بين 1 و 600.'; kg.toggleAttribute('aria-invalid', !ok); return ok ? v : null; };
    kg.addEventListener('blur', () => { if (kg.value) check(); });
    kg.addEventListener('input', () => { err.textContent = ''; kg.removeAttribute('aria-invalid'); });
    ctx.sheet({ title: 'هدف قوة جديد', body: h('div', {},
      h('div', { class: 'field' }, h('label', { for: 'pg-g-l' }, 'التمرين'), sel),
      h('div', { class: 'field' }, h('label', { for: 'pg-g-kg' }, 'الهدف (e1RM أو وزن لعدّة واحدة، كجم)'), kg, err),
      h('div', { class: 'field' }, h('label', { for: 'pg-g-by' }, 'قبل تاريخ (اختياري)'), by)),
    actions: [{ label: 'احفظ الهدف', run: async () => {
      const v = check(); if (v === null) { kg.focus(); return true; }
      const L = lifts.find((l) => l.key === sel.value);
      const g = { id: `g:${Date.now().toString(36)}`, key: L.key, name: L.name, lib: L.item.lib || null, en: L.item.en || '', target: v, by: isDayKey(by.value) ? by.value : null, at: new Date().toISOString() };
      try { st.progress = await patchProgress(ctx, (p) => ({ ...p, goals: [...(p.goals || []), g] })); } catch { ctx.toast('ماقدرناش نحفظ الهدف.'); return true; }
      paint(); return false;
    } }, { label: 'إلغاء', ghost: true }] });
  }

  // ───────── volume ─────────
  function volume() {
    const wsStart = weekStart(today, startDow);
    const sets = WK.hardSetsByMuscle(st.sessions, wsStart, today);
    const order = ['ظهر', 'صدر', 'رجلين', 'أكتاف', 'باي', 'تراي', 'بطن'];
    const cols = order.filter((m) => m in sets).map((m) => ({ label: m, v: sets[m], tone: m === 'بطن' ? 'pink' : WK.VOL_LM[m] && sets[m] > WK.VOL_LM[m].mrv ? 'over' : null }));
    const setsCard = card('pg-vol', head('مجموعات الأسبوع', 'سيتات قوية · الخطوط 10 و 20', 'hardsets'),
      cols.some((c) => c.v) ? columns(cols, { lines: [10, 20], max: Math.max(22, ...cols.map((c) => c.v)), label: `سيتات قوية الأسبوع ده: ${cols.map((c) => `${c.label} ${c.v}`).join('، ')}` }) : h('p', { class: 'pg-hint' }, 'لسه مفيش سيتات متسجلة الأسبوع ده.'));

    const seg = (opts, cur, onPick, label) => h('div', { class: 'pg-seg sm', role: 'group', 'aria-label': label }, ...opts.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === cur), onclick: () => onPick(k) }, l)));
    const vData = ui.vol === '7d' ? M.volumeByDay(st.sessions, Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i))) : M.volumeByWeek(st.sessions, today, 8, startDow);
    const vCard = card('pg-vbars', h('div', { class: 'pg-ch' }, h('h3', {}, 'حجم التمرين'), seg([['7d', '7 أيام'], ['8w', '8 أسابيع']], ui.vol, (k) => { ui.vol = k; paint(); }, 'مدة الحجم')),
      columns(vData.map((d) => ({ label: ui.vol === '7d' ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'][new Date(`${d.day}T12:00:00`).getDay()] : dm(d.day).split(' ')[0], v: Math.round(d.v / 100) / 10 })),
        { fmtV: (v) => fmt(v, { dp: 1 }), label: `الحجم بالطن: ${vData.map((d) => `${dm(d.day)} ${fmt(d.v)}`).join('، ')}` }),
      h('p', { class: 'pg-hint' }, 'بالطن (الوزن × العدّات). المجموع: ', N(vData.reduce((a, d) => a + d.v, 0)), ' كجم.'));

    const wk8 = M.volumeByWeek(st.sessions, today, 8, startDow);
    const wAvg = movingAvg7(st.weights).map((a) => ({ day: a.day, v: a.avg7 }));
    const dual = card('pg-dual', head('الوزن مع حجم التمرين', '8 أسابيع'), dualChart({ bars: wk8, line: wAvg, label: 'أعمدة: حجم التمرين الأسبوعي. خط: متوسط الوزن. الأقدم يمين.' }),
      h('p', { class: 'pg-key' }, h('i', { class: 'k-bar' }), 'الحجم', h('i', { class: 'k-line' }), 'الوزن'));

    const mw = M.muscleWeeks(st.sessions, today, 4, startDow);
    const maxS = Math.max(1, ...mw.rows.flatMap((r) => r.sets));
    const shade = card('pg-shade', head('السيتات لكل عضلة', 'آخر 4 أسابيع'),
      h('table', { class: 'pg-tbl' }, h('caption', { class: 'vh' }, 'سيتات قوية لكل عضلة في آخر 4 أسابيع'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'العضلة'), ...mw.weeks.map((w) => h('th', { scope: 'col' }, dm(w))), h('th', { scope: 'col' }, 'المدى'))),
        h('tbody', {}, ...mw.rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.muscle),
          ...r.sets.map((n) => h('td', { class: 'num', style: `--a:${(n / maxS).toFixed(2)}` }, String(n))),
          h('td', { class: 'num pg-lm' }, r.lm ? `${r.lm.mev}–${r.lm.mav}` : '—'))))));

    // week vs last week
    const wc = M.weekCompareTraining(st.sessions, today, startDow);
    const adhNow = weekAdherence({ anchorDay: today, weekStartDow: startDow, trainingDays, sessions: st.sessions, foodLog: st.foodLog, targets: st.targets, overrides: st.overrides, heartDow: st.heartDow });
    const adhPrev = weekAdherence({ anchorDay: addDays(today, -7), weekStartDow: startDow, trainingDays, sessions: st.sessions, foodLog: st.foodLog, targets: st.targets, overrides: st.overrides, heartDow: st.heartDow });
    const row = (label, a, b, dp = 0) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, fmt(b, { dp })), h('td', { class: 'num' }, fmt(a, { dp })),
      h('td', { class: `num ${a > b ? 'up' : a < b ? 'down' : ''}` }, a === null || b === null ? '—' : fmt(Math.round((a - b) * 10 ** dp) / 10 ** dp, { dp, sign: true })));
    const cmp = card('pg-cmp', head('الأسبوع ده مقابل اللي قبله', `لحد ${['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'][new Date(`${today}T12:00:00`).getDay()]}`),
      h('table', { class: 'pg-tbl' }, h('caption', { class: 'vh' }, 'مقارنة الأسبوع ده بالأسبوع اللي قبله'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), h('th', { scope: 'col' }, 'اللي فات'), h('th', { scope: 'col' }, 'ده'), h('th', { scope: 'col' }, 'الفرق'))),
        h('tbody', {}, row('جلسات', wc.cur.sessions, wc.prev.sessions), row('الحجم (كجم)', wc.cur.volume, wc.prev.volume), row('سيتات', wc.cur.sets, wc.prev.sets), row('أرقام قياسية', wc.cur.prs, wc.prev.prs),
          row('متوسط السعرات', adhNow.avgKcal, adhPrev.avgKcal), row('متوسط البروتين', adhNow.avgP, adhPrev.avgP), row('أيام البروتين', adhNow.proteinDaysHit, adhPrev.proteinDaysHit))));

    // overview stats
    const ov = M.overviewStats(st.sessions, from, today);
    const stats = card('pg-stats', head('أرقام الفترة', M.PERIODS[period].label),
      h('div', { class: 'pg-grid4' }, ...[['جلسات', N(ov.sessions)], ['في الأسبوع', N(ov.perWeek, 1)], ['متوسط المدة', ov.avgMin ? h('span', {}, N(ov.avgMin), ' د') : '—'], ['الحجم الكلي', h('span', {}, N(Math.round(ov.volume / 1000)), ' طن')]]
        .map(([l, v]) => h('div', { class: 'pg-fig4' }, h('small', {}, l), h('b', {}, v)))));

    // consistency calendar 12 weeks
    const cal = M.consistencyCalendar(st.sessions, { today, weeks: 12, startDow, trainingDays });
    const STATE = { trained: 'اتمرنت', recovery: 'تعافي', missed: 'تمرين ماتعملش', rest: 'راحة', future: '' };
    const calCard = card('pg-cal', head('الاستمرارية', '12 أسبوع'),
      h('div', { class: 'pg-calg', role: 'grid', 'aria-label': 'تقويم الاستمرارية لآخر 12 أسبوع' },
        ...cal.map((w) => h('div', { role: 'row', class: 'pg-calw' }, ...w.map((c) => h('span', { role: 'gridcell', class: `c-${c.state}`, title: `${dm(c.day)}: ${STATE[c.state]}`, 'aria-label': `${dm(c.day)}: ${STATE[c.state] || 'لسه'}` }))))),
      h('p', { class: 'pg-key' }, h('i', { class: 'c-trained' }), 'تمرين', h('i', { class: 'c-recovery' }), 'تعافي', h('i', { class: 'c-missed' }), 'فات', h('i', { class: 'c-rest' }), 'راحة'));

    // session vs session
    const ls = M.lifting(st.sessions).slice(-30).reverse();
    let cmpCard = null;
    if (ls.length >= 2) {
      if (!ui.cmpB || !ls.find((s) => s.id === ui.cmpB)) ui.cmpB = ls[0].id;
      if (!ui.cmpA || !ls.find((s) => s.id === ui.cmpA)) { const b = ls.find((s) => s.id === ui.cmpB); ui.cmpA = (ls.find((s) => s.id !== b.id && s.dayKey && s.dayKey === b.dayKey) || ls[1]).id; }
      const opt = (cur) => ls.map((s) => h('option', { value: s.id, selected: s.id === cur }, `${dm(s.day)} · ${s.dayName || 'جلسة'}`));
      const sa = h('select', { class: 'pg-sel', id: 'pg-cmp-a', 'aria-label': 'الجلسة الأقدم' }, ...opt(ui.cmpA));
      const sb = h('select', { class: 'pg-sel', id: 'pg-cmp-b', 'aria-label': 'الجلسة الأحدث' }, ...opt(ui.cmpB));
      sa.addEventListener('change', () => { ui.cmpA = sa.value; paint(); }); sb.addEventListener('change', () => { ui.cmpB = sb.value; paint(); });
      const A = ls.find((s) => s.id === ui.cmpA), B = ls.find((s) => s.id === ui.cmpB);
      const [old, neu] = A.day <= B.day ? [A, B] : [B, A];
      const c = M.sessionCompare(old, neu);
      cmpCard = card('pg-scmp', head('قارن جلستين', 'لكل تمرين'),
        h('div', { class: 'pg-two' }, sa, sb),
        h('table', { class: 'pg-tbl' }, h('caption', { class: 'vh' }, 'مقارنة جلستين'),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'التمرين'), h('th', { scope: 'col' }, 'أعلى وزن'), h('th', { scope: 'col' }, 'الحجم'))),
          h('tbody', {}, ...c.rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.name),
            h('td', { class: 'num' }, fmt(r.b.topW, { dp: 1 }), r.dW !== null ? h('small', { class: r.dW > 0 ? 'up' : r.dW < 0 ? 'down' : '' }, ` ${fmt(r.dW, { dp: 1, sign: true })}`) : h('small', {}, ' جديد')),
            h('td', { class: 'num' }, fmt(r.b.vol), r.dVol !== null ? h('small', { class: r.dVol > 0 ? 'up' : r.dVol < 0 ? 'down' : '' }, ` ${fmt(r.dVol, { sign: true })}`) : null))),
          h('tr', { class: 'pg-tot' }, h('th', { scope: 'row' }, 'الجلسة'), h('td', { class: 'num' }, c.dur[1] ? `${c.dur[1]} د` : '—'), h('td', { class: 'num' }, fmt(c.vol[1]), h('small', {}, ` ${fmt(c.vol[1] - c.vol[0], { sign: true })}`))))));
    }
    return [cmp, setsCard, vCard, dual, shade, stats, calCard, cmpCard];
  }

  // ───────── body ─────────
  function body() {
    const ws = st.weights;
    const series = movingAvg7(ws).filter((p) => p.day >= from);
    const trend = weeklyTrend(ws);
    const last = series[series.length - 1];
    const pred = last && trend ? M.weightPrediction(last.avg7, trend.kgPerWeek, 8) : null;
    const wCard = card('pg-weight', head('الوزن', 'متوسط 7 أيام', 'avg7'),
      last ? h('div', { class: 'pg-grid3' },
        h('div', { class: 'pg-fig4' }, h('small', {}, 'آخر وزن'), h('b', {}, N(last.kg, 1)), h('em', {}, dm(last.day))),
        h('div', { class: 'pg-fig4' }, h('small', {}, 'متوسط 7 أيام'), h('b', {}, N(last.avg7, 1)), h('em', {}, 'كجم')),
        h('div', { class: 'pg-fig4' }, h('small', {}, 'الاتجاه'), h('b', {}, trend ? N(trend.kgPerWeek, 1, { sign: true }) : '—'), h('em', {}, trend ? 'كجم/أسبوع' : 'محتاج أسبوعين'))) : h('p', { class: 'pg-hint' }, 'سجّل وزنك الصبح 2-3 مرات في الأسبوع عشان يبان الاتجاه.'),
      series.length >= 2 ? lineChart({ points: series.map((p) => ({ day: p.day, v: p.avg7 })), extra: [{ points: series.map((p) => ({ day: p.day, v: p.kg })), color: 'var(--mu-2)', dash: '2 4' }], color: 'var(--fat)', label: `الوزن من ${dm(series[0].day)} لـ ${dm(last.day)}: ${fmt(series[0].avg7, { dp: 1 })} → ${fmt(last.avg7, { dp: 1 })} كجم. الأقدم يمين.` }) : null,
      pred ? h('p', { class: 'pg-chip est' }, 'على المعدل ده: ~', N(pred.value, 1), ` كجم بعد ${M.weeksText(pred.weeks)} · تقدير`) : null,
      M.bwDrop(ws) ? h('p', { class: 'pg-signal warn' }, `وزنك نزل ${fmt(M.bwDrop(ws).drop, { dp: 1 })} كجم عن آخر 4 وزنات — اتأكد إن البروتين مكمّل.`) : null,
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => openWeightSheet(ctx) }, I('scale'), 'سجّل وزن النهارده'));

    // measurements + Navy BF + BMI
    const ms = st.measurements; const m = ms[ms.length - 1];
    const sex = st.profile.sex || 'male';
    const bf = m ? M.navyBF({ sex, waist: +m.waist, neck: +m.neck, hip: +m.hip, heightCm: +st.profile.heightCm }) : null;
    const bm = ws.length && st.profile.heightCm ? M.bmi(ws[ws.length - 1].kg, +st.profile.heightCm) : null;
    const MK = [['waist', 'الوسط'], ['neck', 'الرقبة'], ['chest', 'الصدر'], ['arm', 'الدراع'], ['thigh', 'الفخد'], ['shoulder', 'الكتف'], ['calf', 'السمانة'], ['hip', 'الحوض']];
    const prevM = ms[ms.length - 2];
    const mCard = card('pg-meas', head('القياسات', m ? dm(m.day) : '', 'navy'),
      m ? h('div', { class: 'pg-mgrid' }, ...MK.filter(([k]) => +m[k] > 0).map(([k, l]) => h('div', {}, h('small', {}, l), h('b', { class: 'num' }, fmt(+m[k], { dp: 1 })),
        prevM && +prevM[k] > 0 ? h('em', { class: 'num' }, fmt(+m[k] - +prevM[k], { dp: 1, sign: true })) : null))) : h('p', { class: 'pg-hint' }, 'سجّل الوسط والرقبة (والحوض للستات) عشان نحسب نسبة الدهون.'),
      bf ? h('p', { class: 'pg-chip' }, 'نسبة الدهون (Navy) ≈ ', h('b', { class: 'num' }, `${fmt(bf, { dp: 1 })}%`), ' · تقدير') : (m && !st.profile.heightCm ? h('p', { class: 'pg-hint' }, 'ضيف طولك في الملف عشان نحسب نسبة الدهون.') : null),
      bm ? h('p', { class: 'pg-hint' }, 'BMI ', N(bm, 1), ' — مؤشر عام بيغلط مع الناس اللي عندها عضل، اعتمد على الوسط ونسبة الدهون أكتر.', infoBtn(ctx, 'bmi')) : null,
      ms.length > 1 ? h('details', { class: 'pg-det' }, h('summary', {}, `السجل (${ms.length})`),
        h('table', { class: 'pg-tbl' }, h('caption', { class: 'vh' }, 'سجل القياسات'), h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'اليوم'), h('th', { scope: 'col' }, 'الوسط'), h('th', { scope: 'col' }, 'الدراع'), h('th', { scope: 'col' }, 'الصدر'))),
          h('tbody', {}, ...[...ms].reverse().slice(0, 12).map((x) => h('tr', {}, h('th', { scope: 'row' }, dm(x.day)), ...['waist', 'arm', 'chest'].map((k) => h('td', { class: 'num' }, +x[k] > 0 ? fmt(+x[k], { dp: 1 }) : '—'))))))) : null,
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => measureSheet(MK, m) }, I('plus'), 'سجّل قياسات'));

    // recomp 2 weeks
    const rc = M.recompBlock({ today, sessions: st.sessions, foodLog: st.foodLog, weights: ws, targetOf: tOf });
    const rrow = (l, a, b, dp = 0, unit = '') => h('tr', {}, h('th', { scope: 'row' }, l), h('td', { class: 'num' }, b === null ? '—' : `${fmt(b, { dp })}${unit}`), h('td', { class: 'num' }, a === null ? '—' : `${fmt(a, { dp })}${unit}`));
    const recomp = card('pg-recomp', head('إعادة التشكيل', 'أسبوعين مقابل أسبوعين'),
      h('table', { class: 'pg-tbl' }, h('caption', { class: 'vh' }, 'آخر أسبوعين مقابل الأسبوعين اللي قبلهم'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), h('th', { scope: 'col' }, 'قبلها'), h('th', { scope: 'col' }, 'آخر 14 يوم'))),
        h('tbody', {}, rrow('أيام البروتين', rc.cur.pHit, rc.prev.pHit), rrow('جلسات', rc.cur.trained, rc.prev.trained), rrow('متوسط السعرات', rc.cur.avgKcal, rc.prev.avgKcal), rrow('متوسط الوزن', rc.cur.wAvg, rc.prev.wAvg, 1))),
      rc.dW !== null ? h('p', { class: 'pg-hint' }, 'فرق متوسط الوزن: ', N(rc.dW, 1, { sign: true }), ' كجم. بروتين ثابت + تمرين ثابت مع وزن ثابت = غالبًا عضل بيزيد ودهون بتقل.') : null);

    // kcal bars vs target band
    const days = Array.from({ length: ui.kcal }, (_, i) => addDays(today, -ui.kcal + 1 + i));
    const ks = M.kcalSeries(st.foodLog, days, tOf);
    const kmax = Math.max(...ks.map((k) => Math.max(k.kcal, k.hi))) * 1.05;
    const kbars = h('div', { class: `pg-kbars n${ui.kcal}`, role: 'img', 'aria-label': `السعرات اليومية مقابل مدى الهدف آخر ${ui.kcal} يوم: ${ks.filter((k) => k.logged).map((k) => `${dm(k.day)} ${k.kcal}`).join('، ')}` },
      ...ks.map((k, i) => h('div', { class: 'pg-kb' }, h('span', { class: 'pg-kband', style: { bottom: `${(k.lo / kmax) * 100}%`, height: `${((k.hi - k.lo) / kmax) * 100}%` } }),
        h('i', { class: !k.logged ? 'none' : k.kcal >= k.lo && k.kcal <= k.hi ? 'in' : k.kcal > k.hi ? 'over' : 'under', style: { height: `${(k.kcal / kmax) * 100}%`, animationDelay: `${i * 20}ms` } }))));
    const seg = h('div', { class: 'pg-seg sm', role: 'group', 'aria-label': 'مدة السعرات' }, ...[[7, '7 أيام'], [30, '30 يوم']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(ui.kcal === k), onclick: () => { ui.kcal = k; paint(); } }, l)));
    const logged = ks.filter((k) => k.logged);
    const kCard = card('pg-kcal', h('div', { class: 'pg-ch' }, h('h3', {}, 'السعرات مقابل الهدف'), seg), kbars,
      h('p', { class: 'pg-key' }, h('i', { class: 'k-band' }), 'مدى الهدف', h('i', { class: 'k-in' }), 'في المدى', h('i', { class: 'k-over' }), 'زيادة'),
      h('div', { class: 'pg-grid4' }, ...[['أيام متسجلة', N(logged.length)], ['متوسط السعرات', logged.length ? N(Math.round(logged.reduce((a, k) => a + k.kcal, 0) / logged.length)) : '—'],
        ['متوسط البروتين', logged.length ? h('span', {}, N(Math.round(logged.reduce((a, k) => a + k.p, 0) / logged.length)), ' جم') : '—'], ['في المدى', N(logged.filter((k) => k.kcal >= k.lo && k.kcal <= k.hi).length)]]
        .map(([l, v]) => h('div', { class: 'pg-fig4' }, h('small', {}, l), h('b', {}, v)))));
    return [wCard, mCard, recomp, kCard];
  }

  function measureSheet(MK, last) {
    const ins = {};
    const err = h('p', { class: 'err', 'aria-live': 'polite' });
    const grid = h('div', { class: 'fgrid pg-mform' }, ...MK.map(([k, l]) => { ins[k] = h('input', { id: `pg-m-${k}`, type: 'text', inputmode: 'decimal', class: 'num', autocomplete: 'off', placeholder: last && +last[k] > 0 ? String(last[k]) : '' }); return h('div', { class: 'field' }, h('label', { for: `pg-m-${k}` }, `${l} (سم)`), ins[k]); }));
    ctx.sheet({ title: 'قياسات النهارده', body: h('div', {}, h('p', { class: 'lead' }, 'بشريط القياس، الصبح، على الجلد. الوسط عند السرة.'), grid, err),
      actions: [{ label: 'احفظ القياسات', run: async () => {
        const rec = { id: `m:${today}`, day: today, at: new Date().toISOString() };
        let any = false;
        for (const [k] of MK) {
          if (!ins[k].value.trim()) continue;
          const v = parseNum(ins[k].value);
          if (!(v >= 10 && v <= 250)) { err.textContent = 'كل قياس رقم بين 10 و 250 سم.'; ins[k].setAttribute('aria-invalid', 'true'); ins[k].focus(); return true; }
          rec[k] = Math.round(v * 10) / 10; any = true;
        }
        if (!any) { err.textContent = 'اكتب قياس واحد على الأقل.'; return true; }
        try { const prev = await ctx.db.get('measurements', rec.id).catch(() => null); await ctx.db.put('measurements', { ...(prev || {}), ...rec }); } catch { ctx.toast('ماقدرناش نحفظ القياسات.'); return true; }
        ctx.toast('اتسجّلت القياسات'); refresh(); return false;
      } }, { label: 'إلغاء', ghost: true }] });
  }

  // ───────── reports ─────────
  function reports() {
    const adh = weekAdherence({ anchorDay: today, weekStartDow: startDow, trainingDays, sessions: st.sessions, foodLog: st.foodLog, targets: st.targets, overrides: st.overrides, heartDow: st.heartDow });
    const trend = weeklyTrend(st.weights);
    const ws = weekStart(today, startDow);
    const by = WK.hardSetsByMuscle(st.sessions, ws, today);
    const lines = weeklyReportLines(adh, trend, Object.entries(by).map(([muscle, sets]) => ({ muscle, sets })));
    const wc = M.weekCompareTraining(st.sessions, today, startDow);
    lines.push(`الحجم ${fmt(wc.cur.volume)} كجم${wc.prev.volume ? ` (${fmt(Math.round(((wc.cur.volume - wc.prev.volume) / wc.prev.volume) * 100), { sign: true })}% عن نفس الوقت الأسبوع اللي فات)` : ''}`);
    const prs = M.prTimeline(st.sessions).filter((p) => p.day >= ws);
    lines.push(prs.length ? `أرقام قياسية: ${prs.slice(0, 3).map((p) => `${p.name} ${fmt(p.w, { dp: 1 })}×${p.r}`).join('، ')}` : 'مفيش أرقام قياسية الأسبوع ده لسه');
    const bd = M.bestDay(adh.perDay);
    if (bd) lines.push(`أحسن يوم: ${dm(bd.day)} · ${fmt(bd.intake.kcal)} سعرة و ${fmt(bd.intake.p)} بروتين`);
    const strip = h('div', { class: 'pg-days', role: 'list', 'aria-label': 'أيام الأسبوع' }, ...adh.perDay.map((d) => {
      const mark = d.trained ? 'done' : d.planned && !d.future ? 'missed' : d.planned ? 'plan' : 'off';
      return h('div', { role: 'listitem', class: d.day === today ? 'today' : '', 'aria-label': `${dm(d.day)}: ${d.trained ? 'اتمرنت' : d.planned ? (d.future ? 'تمرين مخطط' : 'تمرين ماتعملش') : 'راحة'}${d.logged ? (d.pHit ? '، البروتين اتحقق' : '، البروتين ماكملش') : ''}` },
        h('span', { 'aria-hidden': 'true' }, ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'][new Date(`${d.day}T12:00:00`).getDay()]), h('i', { class: `mk ${mark}`, 'aria-hidden': 'true' }), h('em', { class: d.pHit ? 'hit' : '', 'aria-hidden': 'true' }));
    }));
    const wk = card('pg-week', head('حساب الأسبوع', `${dm(ws)} – ${dm(addDays(ws, 6))}`), strip, h('ul', { class: 'pg-report' }, ...lines.map((l) => h('li', {}, l))),
      h('p', { class: 'pg-hint' }, 'تقرير المدرب الأسبوعي في «الأسبوع ده» فوق.'));

    // patterns (local data, always visible) + AI
    const pdays = Array.from({ length: 30 }, (_, i) => addDays(today, -i));
    const pt = M.eatingPatterns(st.foodLog, pdays, tOf);
    const ls = M.lifting(st.sessions).filter((s) => s.day >= addDays(today, -55));
    const dow = Array(7).fill(0); for (const s of ls) dow[new Date(`${s.day}T12:00:00`).getDay()]++;
    const W7 = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
    const topDow = dow.map((n, i) => ({ n, i })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 2);
    const pat = card('pg-pat', head('أنماط', 'آخر 30 يوم أكل · 8 أسابيع تمرين'),
      h('ul', { class: 'pg-report' },
        pt.days ? h('li', {}, `أكل بعد 10 بالليل: ${pt.lateDays} من ${pt.days} يوم`) : h('li', {}, 'لسه مفيش أكل كفاية للأنماط'),
        pt.days ? h('li', {}, `من غير فطار: ${pt.skippedBreakfast} يوم · فوق الهدف بـ10%+: ${pt.overDays} يوم`) : null,
        pt.window ? h('li', {}, `شباك الأكل: حوالي ${fmt(pt.window, { dp: 1 })} ساعة من أول لآخر وجبة`) : null,
        pt.topFoods.length ? h('li', {}, `أكتر أكلات: ${pt.topFoods.slice(0, 4).map((f) => f.name).join('، ')}`) : null,
        topDow.length ? h('li', {}, `أكتر أيام تمرين: ${topDow.map((x) => `${W7[x.i]} (${x.n})`).join('، ')}`) : null,
        ...(pt.notes || []).slice(0, 3).map((n) => h('li', {}, h('b', {}, `${n.title}: `), n.text))),
      aiBlock('patterns', 'حلّل الأنماط مع المدرب', 'تمرين + أكل'));

    const full = card('pg-full', head('تحليل شامل', '5–8 نقاط على كل بياناتك'), aiBlock('full', 'اعمل التحليل الشامل', ''));

    // sleep vs performance
    const sp = M.sleepPerf(st.sessions, st.daily);
    const spCard = sp.length >= 8 ? card('pg-sleep', head('النوم والأداء', `${sp.length} جلسة`), scatter(sp.map((p) => ({ x: p.sleepH, y: p.perf })), { xLabel: 'النوم', yLabel: 'الأداء', label: `${sp.length} جلسة: ساعات النوم مقابل حجم الجلسة كنسبة من المعتاد` }),
      h('p', { class: 'pg-hint' }, 'الأداء = حجم الجلسة ÷ المعتاد لنفس اليوم في الخطة.')) : card('pg-sleep', head('النوم والأداء', ''), h('p', { class: 'pg-hint' }, `بيظهر بعد 8 جلسات فيها ساعات نوم متسجلة (عندك ${sp.length}). سجّل نومك من «حالتك النهارده» في شاشة اليوم.`));

    // milestones
    const pw = []; for (let i = 0; i < 26; i++) { const end = addDays(weekStart(today, startDow), -1 - i * 7); const a = weekAdherence({ anchorDay: end, weekStartDow: startDow, trainingDays, sessions: [], foodLog: st.foodLog, targets: st.targets, heartDow: st.heartDow }); pw.push({ end, hit: a.proteinDaysHit }); }
    const ms = M.milestones({ sessions: st.sessions, today, startDow, plannedPerWeek: planned, proteinWeeks: pw.reverse() });
    const msCard = card('pg-ms', head('محطات', ms.length ? `${ms.length}` : ''), ms.length ? h('ul', { class: 'pg-msl' }, ...ms.map((x) => h('li', {}, h('b', {}, x.label), h('span', {}, dm(x.day))))) : h('p', { class: 'pg-hint' }, 'أول محطة: 50 جلسة، أو أول أسبوع بروتين كامل 7/7.'));

    const month = card('pg-month', head('ملخص الشهر', monthOf(today)), h('button', { type: 'button', class: 'btn ghost sm', onclick: monthSheet }, 'افتح ملخص الشهر للطباعة'));
    return [wk, full, pat, spCard, msCard, month];
  }

  function aiBlock(kind, label, sub) {
    const out = h('div', { class: 'pg-ai', 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'pg-aibtn' }, I('msg'), h('span', {}, label), sub ? h('small', {}, sub) : null);
    const show = (r, cachedFlag) => {
      fill(out, h('div', { class: 'pg-ai-text' }, richTextNodes(document, r.text)),
        h('p', { class: 'pg-ai-meta' }, cachedFlag ? 'من النهارده (محفوظ)' : 'دلوقتي', ' · ', h('button', { type: 'button', class: 'pg-link', onclick: () => run(true) }, 'حدّث'), ' · ', h('a', { href: '#/coach' }, 'كمّل مع المدرب')));
    };
    async function run(refresh = false) {
      btn.disabled = true;
      const api = await import('../coach/api.js');
      const { skeleton, errorLine } = await import('../coach/chat.js');
      fill(out, skeleton(4));
      try {
        const { PROMPTS } = await import('../coach/prompts.js');
        const r = await api.askCoach(ctx, { intent: kind, prompt: PROMPTS[kind], extra: { cacheKey: `progress.${kind}`, refresh } });
        if (alive) show(r, r.cached);
      } catch (e) { fill(out, errorLine(e)); } finally { btn.disabled = false; }
    }
    btn.addEventListener('click', () => run(false));
    import('../coach/api.js').then((api) => api.cached(ctx, `progress.${kind}`)).then((hit) => { if (hit && alive) show(hit, true); }).catch(() => {});
    return h('div', { class: 'pg-aiw' }, btn, out);
  }

  function monthSheet() {
    const mon = today.slice(0, 7);
    const s = M.monthSummary({ sessions: st.sessions, foodLog: st.foodLog, weights: st.weights, month: mon });
    const rows = [['الجلسات', fmt(s.sessions)], ['الحجم الكلي', `${fmt(s.volume)} كجم`], ['أرقام قياسية', fmt(s.prs.length)], ['أيام الأكل المتسجلة', fmt(s.loggedDays)],
      ['متوسط السعرات', s.avgKcal ? fmt(s.avgKcal) : '—'], ['متوسط البروتين', s.avgP ? `${fmt(s.avgP)} جم` : '—'],
      ['الوزن', s.wFirst && s.wLast ? `${fmt(s.wFirst.kg, { dp: 1 })} ← ${fmt(s.wLast.kg, { dp: 1 })} كجم` : '—']];
    const content = () => h('div', { class: 'pg-msum' }, h('h2', {}, `ملخص ${monthOf(today)} ${today.slice(0, 4)}`),
      h('table', { class: 'pg-tbl' }, h('tbody', {}, ...rows.map(([l, v]) => h('tr', {}, h('th', { scope: 'row' }, l), h('td', { class: 'num' }, v))))),
      s.prs.length ? h('ul', { class: 'pg-report' }, ...s.prs.slice(0, 10).map((p) => h('li', {}, `${dm(p.day)} · ${p.name} ${fmt(p.w, { dp: 1 })}×${p.r} (e1RM ${fmt(p.e1rm, { dp: 1 })})`))) : null);
    ctx.sheet({ title: 'ملخص الشهر', body: content(), actions: [{ label: 'اطبع / احفظ PDF', run: () => {
      const host = h('div', { id: 'pg-print' }, content());
      document.body.appendChild(host); document.body.classList.add('pg-printing');
      const done = () => { host.remove(); document.body.classList.remove('pg-printing'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      setTimeout(() => { try { window.print(); } catch { done(); } }, 50);
      return true;
    } }, { label: 'إغلاق', ghost: true }] });
  }

  // ───────── lead: the two numbers that matter, with their trend (UX audit #14: open on meaningful data) ─────────
  function lead() {
    const out = [];
    const avg = movingAvg7(st.weights).filter((w) => w.day >= from);
    if (avg.length) {
      const last = avg[avg.length - 1]; const first = avg[0];
      const dlt = avg.length > 1 ? Math.round((last.avg7 - first.avg7) * 10) / 10 : null;
      out.push(h('a', { class: 'pg-lead', href: '#pg-body', onclick: (e) => { e.preventDefault(); const t = document.getElementById('pg-body'); t && t._open && t._open(); t && t.scrollIntoView({ block: 'start' }); } },
        h('div', { class: 'pg-lh' }, h('small', {}, 'الوزن · متوسط 7 أيام'), dlt !== null && dlt !== 0 ? h('em', { class: `pg-ld ${dlt < 0 ? 'down' : 'up'}` }, N(dlt, 1, { sign: true }), ' كجم') : null),
        h('b', { class: 'pg-lv' }, N(last.avg7, 1), h('small', {}, ' kg')),
        avg.length > 1 ? lineChart({ points: avg.map((w) => ({ day: w.day, v: w.avg7 })), color: 'var(--pro)', label: `الوزن من ${fmt(first.avg7, { dp: 1 })} لـ ${fmt(last.avg7, { dp: 1 })} كجم`, unit: 'كجم', H: 72 }) : null));
    }
    const lift = M.liftsIn(st.sessions).find((l) => l.kind === 'compound');
    const ser = lift ? M.e1rmSeries(st.sessions, lift.item).filter((p) => p.day >= from) : [];
    if (ser.length) {
      const last = ser[ser.length - 1]; const first = ser[0];
      const dlt = ser.length > 1 ? Math.round((last.e1rm - first.e1rm) * 10) / 10 : null;
      out.push(h('a', { class: 'pg-lead', href: '#pg-str', onclick: (e) => { e.preventDefault(); const t = document.getElementById('pg-str'); t && t._open && t._open(); t && t.scrollIntoView({ block: 'start' }); } },
        h('div', { class: 'pg-lh' }, h('small', {}, `${lift.name} · e1RM`), dlt ? h('em', { class: `pg-ld ${dlt > 0 ? 'up' : 'down'}` }, N(dlt, 1, { sign: true }), ' كجم') : null),
        h('b', { class: 'pg-lv' }, N(Math.round(last.e1rm * 10) / 10, 1), h('small', {}, ' kg')),
        ser.length > 1 ? lineChart({ points: ser.map((p) => ({ day: p.day, v: p.e1rm })), color: 'var(--violet)', label: `e1RM ${lift.name} من ${fmt(first.e1rm, { dp: 1 })} لـ ${fmt(last.e1rm, { dp: 1 })} كجم`, unit: 'كجم', H: 72 }) : null));
    }
    if (!out.length) out.push(h('div', { class: 'pg-lead pg-lead-empty' }, h('b', {}, 'التقدّم بيبدأ من أول وزن وأول جلسة'),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => openWeightSheet(ctx) }, 'سجّل وزنك')));
    return h('div', { class: 'pg-leads' }, ...out);
  }

  // ───────── paint ─────────
  function paint() {
    if (!alive || !st) return;
    const y = window.scrollY;
    const segBtns = PERIOD_KEYS.map((k) => h('button', { type: 'button', 'aria-pressed': String(k === period), onclick: () => ctx.go('progress', k === 'q' ? {} : { p: k }) }, M.PERIODS[k].label));
    const secs = {
      week: section('week', 'الأسبوع ده', 'weekCompare', () => thisWeek()),
      sum: section('sum', 'الملخص', 'summary', () => summary()),
      str: section('str', 'القوة', 'e1rm', () => strength()),
      vol: section('vol', 'الحجم', 'hardsets', () => volume()),
      body: section('body', 'الجسم', 'avg7', () => body()),
      rep: section('rep', 'التقارير', 'reports', () => reports()),
    };
    // one row: section chips (open + jump) and the period control
    fill(el,
      h('header', { class: 'pg-head' }, h('h1', {}, 'التقدّم')),
      // the period control only: the section chips duplicated the section headers (UX audit #14)
      h('nav', { class: 'pg-nav', 'aria-label': 'الفترة' }, h('div', { class: 'pg-seg', role: 'group', 'aria-label': 'الفترة' }, ...segBtns)),
      lead(),
      h('div', { class: 'pg-body' }, ...Object.values(secs)));
    if (y) window.scrollTo(0, y);
  }
  async function refresh() { st = await loadAll(ctx); if (!st.progress.goals) st.progress.goals = []; paint(); }
  const offs = ['food:changed', 'weight:changed', 'session:changed', 'settings:changed'].map((e) => ctx.on(e, () => alive && refresh()));
  await refresh();
  return () => { alive = false; offs.forEach((f) => f()); };
}

export const routes = { progress };
