// Progress pure logic: weight trend, weekly adherence, hard sets per muscle, weekly report. No DOM, no db.
import { addDays, weekDays, diffDays, isDayKey } from '../../core/date.js';
import { sumEntries, targetsForDay, heartDaysOf } from '../../core/targets.js';
import { targetRange } from '../nutrition/logic.js';
import { countText } from '../../ui/num.js';

const r1 = (x) => Math.round(x * 10) / 10;

/** Clean, sorted, one-per-day weights: [{day, kg}] (last write per day wins). */
export function cleanWeights(list = []) {
  const m = new Map();
  for (const w of list) if (w && isDayKey(w.day) && typeof w.kg === 'number' && w.kg >= 20 && w.kg <= 400) m.set(w.day, { day: w.day, kg: w.kg });
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Trailing 7-calendar-day average for each weigh-in day: [{day, kg, avg7, n}] */
export function movingAvg7(weights) {
  const ws = cleanWeights(weights);
  return ws.map((w, i) => {
    const from = addDays(w.day, -6);
    let s = 0, n = 0;
    for (let j = i; j >= 0 && ws[j].day >= from; j--) { s += ws[j].kg; n++; }
    return { day: w.day, kg: w.kg, avg7: r1(s / n), n };
  });
}

/**
 * Trend: change of the 7-day average between the latest weigh-in and the one ≥7 days earlier,
 * scaled to kg/week. null when there is < 2 weeks of span.
 */
export function weeklyTrend(weights) {
  const a = movingAvg7(weights);
  if (a.length < 2) return null;
  const last = a[a.length - 1];
  let prev = null;
  for (let i = a.length - 2; i >= 0; i--) if (diffDays(a[i].day, last.day) >= 7) { prev = a[i]; break; }
  if (!prev) return null;
  const days = diffDays(prev.day, last.day);
  return { kgPerWeek: r1(((last.avg7 - prev.avg7) / days) * 7), from: prev, to: last, days };
}

/**
 * SVG line chart geometry. RTL time axis: oldest on the RIGHT, newest on the LEFT.
 * → {points:[{x,y,day,kg,avg7}], kgPath, avgPath, min, max}
 */
export function chartGeometry(series, { width = 340, height = 140, pad = 12 } = {}) {
  if (!series.length) return { points: [], kgPath: '', avgPath: '', min: 0, max: 0 };
  const vals = series.flatMap((p) => [p.kg, p.avg7]);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1) { const mid = (max + min) / 2; min = mid - 0.5; max = mid + 0.5; }
  const first = series[0].day, span = Math.max(1, diffDays(first, series[series.length - 1].day));
  const x = (day) => r1(width - pad - (diffDays(first, day) / span) * (width - 2 * pad));
  const y = (v) => r1(pad + (1 - (v - min) / (max - min)) * (height - 2 * pad));
  const points = series.map((p) => ({ ...p, x: series.length === 1 ? width / 2 : x(p.day), y: y(p.kg), ya: y(p.avg7) }));
  const path = (k) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${k === 'kg' ? p.y : p.ya}`).join(' ');
  return { points, kgPath: path('kg'), avgPath: path('avg'), min: r1(min), max: r1(max) };
}

/** A finished session (B's contract: status 'live' while running; discarded ones never count). */
/** A finished LIFTING session (recovery, Heart Day and home isometric records never count as one). */
export const countsAsSession = (s) => !!s && !!s.day && s.status !== 'live' && s.status !== 'active' && !s.discarded
  && s.kind !== 'recovery' && s.type !== 'recovery' && s.kind !== 'heart' && s.mode !== 'iso';

/** Days in a week where a session was logged (finished or with at least one done/filled set). */
export function sessionDaysIn(sessions = [], days) {
  const set = new Set(days);
  const out = new Set();
  for (const s of sessions) if (countsAsSession(s) && set.has(s.day)) out.add(s.day);
  return out;
}

/**
 * Weekly adherence.
 * input: {anchorDay, weekStartDow, trainingDays, sessions, foodLog:{day:entries}, targets, overrides}
 * → {days, sessionsDone, sessionsPlanned, daysLogged, proteinDaysHit, kcalDaysInRange, avgKcal, avgP, perDay:[...]}
 * Only days up to anchorDay count for nutrition (future days are not "missed").
 */
export function weekAdherence({ anchorDay, weekStartDow = 1, trainingDays = [1, 2, 4, 5], sessions = [], foodLog = {}, targets, overrides = {}, heartDow = null }) {
  const days = weekDays(anchorDay, weekStartDow);
  const done = sessionDaysIn(sessions, days);
  const heartDays = heartDaysOf(sessions);
  const sessionsDone = sessions.filter((s) => countsAsSession(s) && days.includes(s.day)).length;
  const sessionsPlanned = days.filter((d) => trainingDays.includes(new Date(`${d}T12:00:00`).getDay())).length;
  let daysLogged = 0, proteinDaysHit = 0, kcalDaysInRange = 0, sk = 0, sp = 0;
  const perDay = days.map((day) => {
    const t = targetsForDay(day, { targets, trainingDays, overrides, sessionDays: done, heartDays, heartDow });
    const entries = foodLog[day] || [];
    const intake = sumEntries(entries);
    const past = day <= anchorDay;
    const logged = past && entries.length > 0;
    const r = targetRange(t);
    const pHit = logged && intake.p >= r.pMin;
    const inRange = logged && intake.kcal >= r.kcalMin && intake.kcal <= r.kcalMax;
    if (logged) { daysLogged++; sk += intake.kcal; sp += intake.p; }
    if (pHit) proteinDaysHit++;
    if (inRange) kcalDaysInRange++;
    return { day, type: t.type, trained: done.has(day), planned: trainingDays.includes(new Date(`${day}T12:00:00`).getDay()), logged, intake, target: t, pHit, inRange, future: !past };
  });
  return { days, sessionsDone, sessionsPlanned, daysLogged, proteinDaysHit, kcalDaysInRange,
    avgKcal: daysLogged ? Math.round(sk / daysLogged) : null, avgP: daysLogged ? Math.round(sp / daysLogged) : null, perDay };
}

// ───────────────────────── weekly report ─────────────────────────

/** Calm, factual report lines (effort first, no blame). */
export function weeklyReportLines(adh, trend, muscles) {
  const lines = [];
  lines.push(`التمرين: ${adh.sessionsDone} من ${adh.sessionsPlanned} جلسات الخطة`);
  if (adh.daysLogged) {
    lines.push(`البروتين اتحقق ${adh.proteinDaysHit} من ${countText(adh.daysLogged, 'day')} ${adh.daysLogged === 1 ? 'متسجل' : 'متسجلة'}`);
    lines.push(`السعرات في المدى ${adh.kcalDaysInRange} من ${countText(adh.daysLogged, 'day')} · متوسط ${adh.avgKcal} سعرة`);
  } else lines.push('لسه مفيش أكل متسجل الأسبوع ده');
  if (trend) lines.push(`اتجاه الوزن ${trend.kgPerWeek > 0 ? '+' : ''}${trend.kgPerWeek} كجم في الأسبوع (متوسط 7 أيام)`);
  const top = [...(muscles || [])].sort((a, b) => b.sets - a.sets)[0];
  if (top && top.sets) lines.push(`أكتر عضلة اشتغلت: ${top.muscle} · ${top.sets} سيت قوي`);
  return lines;
}

/** Context object for core/ai buildContextSummary({week}). */
export const weekContext = (adh, trend) => ({ sessionsDone: adh.sessionsDone, sessionsPlanned: adh.sessionsPlanned, proteinDaysHit: adh.proteinDaysHit,
  daysLogged: adh.daysLogged, avgKcal: adh.avgKcal, weightTrendKgPerWeek: trend ? trend.kgPerWeek : null });

export const REPORT_PROMPT = 'اكتب ملخص أسبوعي قصير (4 سطور بالكتير) من بيانات الأسبوع: إيه اللي اتعمل كويس، ونقطة واحدة عملية للأسبوع الجاي. من غير لوم ومن غير إيموجي.';
