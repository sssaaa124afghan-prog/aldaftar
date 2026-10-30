// Analytics engine (pure: no DOM, no db). Used by Progress, Today and the coach context.
// Contract helpers from workout/nutrition logic are preferred when present and well-shaped;
// every one has a local fallback here (see docs/frontend-analytics.md §helpers).
import * as WK from '../workout/logic.js';
import * as NU from '../nutrition/logic.js';
import { addDays, diffDays, weekStart, isDayKey } from '../../core/date.js';
import { sumEntries } from '../../core/targets.js';
import { countText } from '../../ui/num.js';

/** «أسبوع» / «أسبوعين» / «3 أسابيع» / «12 أسبوع» */
export const weeksText = (n) => (n === 1 ? 'أسبوع' : n === 2 ? 'أسبوعين' : n >= 3 && n <= 10 ? `${n} أسابيع` : `${n} أسبوع`);

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Call a contract helper if it exists and its result passes `ok`; else null. Never throws. */
function viaContract(mod, name, args, ok) {
  try {
    const fn = mod && mod[name];
    if (typeof fn !== 'function') return null;
    const v = fn(...args);
    return ok(v) ? v : null;
  } catch { return null; }
}
export const contractStatus = () => Object.fromEntries(
  ['e1rmSeries', 'prList', 'progressRate', 'trainingLoad', 'laggingMuscle', 'strengthLevel', 'wilks'].map((k) => [`workout.${k}`, typeof WK[k] === 'function'])
    .concat(['eatingPatterns', 'weekStats', 'proteinPerMeal', 'adaptiveSuggestion', 'tdee'].map((k) => [`nutrition.${k}`, typeof NU[k] === 'function'])));

// ───────────────────────── sessions ─────────────────────────

/** Not a lifting session: recovery, Heart Day, Boxing Day (cardio minutes only) and the home isometric block. */
export const isRecovery = (s) => !!s && (s.kind === 'recovery' || s.type === 'recovery' || s.kind === 'heart' || s.kind === 'boxing' || s.mode === 'iso');
/** Finished lifting sessions, oldest → newest (no live / discarded / recovery). */
export function lifting(sessions) {
  return WK.finished(sessions).filter((s) => s.day && isDayKey(s.day) && !isRecovery(s));
}
export const volumeOf = (s) => WK.sessionVolume(s);

const LIB_LIFT = { ex1: 'bench', ex41: 'squat', ex11: 'deadlift', ex21: 'ohp', ex13: 'row' };
export const LIFT_AR = { bench: 'بنش', squat: 'سكوات', deadlift: 'ديدليفت', ohp: 'ضغط كتف', row: 'تجديف' };
/** 'bench' | 'squat' | 'deadlift' | 'ohp' | 'row' | null */
export function liftOf(item) {
  const k = WK.exKey(item);
  return k.startsWith('lib:') ? LIB_LIFT[k.slice(4)] || null : null;
}

/** Distinct exercises with history: [{key, name, item, count, lastDay, lift, kind}] main lifts first, then by count. */
export function liftsIn(sessions) {
  const m = new Map();
  for (const s of lifting(sessions)) {
    for (const e of s.exercises) {
      if (!WK.doneSets(e).length) continue;
      const key = WK.exKey(e);
      const cur = m.get(key) || { key, name: WK.displayName(e) || e.name, item: e, count: 0, lastDay: s.day, lift: liftOf(e), kind: WK.kindOf(e) };
      cur.count++; cur.lastDay = s.day; m.set(key, cur);
    }
  }
  const order = ['bench', 'squat', 'deadlift', 'ohp', 'row'];
  return [...m.values()].sort((a, b) => {
    const ia = a.lift ? order.indexOf(a.lift) : 99, ib = b.lift ? order.indexOf(b.lift) : 99;
    return ia - ib || b.count - a.count || (a.kind === 'compound' ? -1 : 1);
  });
}

/** Per-exposure best e1RM for one exercise, oldest first: [{day, e1rm, w, r}]. */
export function e1rmSeries(sessions, item) {
  const theirs = viaContract(WK, 'e1rmSeries', [sessions, item], (v) => Array.isArray(v) && v.every((p) => p && isDayKey(p.day) && isNum(p.e1rm)));
  if (theirs) return theirs.map((p) => ({ day: p.day, e1rm: p.e1rm, w: p.w ?? p.topW ?? null, r: p.r ?? null }));
  const out = [];
  for (const s of lifting(sessions)) {
    const e = s.exercises.find((x) => WK.sameExercise(x, item));
    if (!e) continue;
    let best = null;
    for (const t of WK.doneSets(e)) {
      if (t.type === 'drop') continue;
      const v = WK.e1rm(t.w, t.r);
      if (v > 0 && (!best || v > best.e1rm)) best = { day: s.day, e1rm: v, w: +t.w, r: +t.r };
    }
    if (best) out.push(best);
  }
  return out;
}

/** Least-squares slope of y over days → kg/week. Needs ≥3 points spanning ≥14 days, else null. */
export function slopePerWeek(points) {
  if (!points || points.length < 3) return null;
  const d0 = points[0].day;
  const xs = points.map((p) => diffDays(d0, p.day)), ys = points.map((p) => p.v);
  if (xs[xs.length - 1] - xs[0] < 14) return null;
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? r2((num / den) * 7) : null;
}

/** e1RM trend in kg/week over the last `weeks` weeks (null when too little data). */
export function progressRate(sessions, item, { today, weeks = 8 } = {}) {
  const theirs = viaContract(WK, 'progressRate', [sessions, item], (v) => v === null || isNum(v) || (v && isNum(v.kgPerWeek)));
  if (theirs !== null && theirs !== undefined && today === undefined) return isNum(theirs) ? theirs : theirs.kgPerWeek;
  const s = e1rmSeries(sessions, item);
  const from = today ? addDays(today, -weeks * 7) : null;
  return slopePerWeek(s.filter((p) => !from || p.day >= from).map((p) => ({ day: p.day, v: p.e1rm })));
}

/** Rate chip text: «+0.8 كجم/أسبوع» or «ثابت» (|rate| < 0.25). */
export function rateLabel(rate) {
  if (rate === null || rate === undefined) return null;
  if (Math.abs(rate) < 0.25) return 'ثابت';
  return `${rate > 0 ? '+' : '−'}${r1(Math.abs(rate))} كجم/أسبوع`;
}

/** Best per exercise: [{key, name, e1rm, w, r, day}] sorted by day desc. */
export function prList(sessions) {
  const best = new Map();
  for (const s of lifting(sessions)) for (const e of s.exercises) {
    for (const t of WK.doneSets(e)) {
      if (t.type === 'drop') continue;
      const v = WK.e1rm(t.w, t.r); if (!(v > 0)) continue;
      const key = WK.exKey(e); const cur = best.get(key);
      if (!cur || v > cur.e1rm) best.set(key, { key, name: WK.displayName(e) || e.name, e1rm: v, w: +t.w, r: +t.r, day: s.day });
    }
  }
  return [...best.values()].sort((a, b) => b.day.localeCompare(a.day) || b.e1rm - a.e1rm);
}

/** Every time a best e1RM was beaten (first exposure is the baseline): [{day, key, name, e1rm, w, r, delta}] newest first. */
export function prTimeline(sessions) {
  const theirs = viaContract(WK, 'prList', [sessions], (v) => Array.isArray(v) && v.every((p) => p && isDayKey(p.day) && isNum(+p.w) && isNum(+p.r)));
  if (theirs) {
    return theirs.map((p) => ({ day: p.day, key: p.key, name: p.name, e1rm: WK.e1rm(p.w, p.r) || +p.value || 0, w: +p.w, r: +p.r, delta: isNum(p.delta) ? p.delta : null, type: p.type }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }
  return prTimelineLocal(sessions);
}
export function prTimelineLocal(sessions) {
  const best = new Map(); const out = [];
  for (const s of lifting(sessions)) for (const e of s.exercises) {
    const key = WK.exKey(e);
    let top = null;
    for (const t of WK.doneSets(e)) { if (t.type === 'drop') continue; const v = WK.e1rm(t.w, t.r); if (v > 0 && (!top || v > top.e1rm)) top = { e1rm: v, w: +t.w, r: +t.r }; }
    if (!top) continue;
    const prev = best.get(key);
    if (prev !== undefined && top.e1rm > prev) out.push({ day: s.day, key, name: WK.displayName(e) || e.name, ...top, delta: r1(top.e1rm - prev) });
    if (prev === undefined || top.e1rm > prev) best.set(key, top.e1rm);
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

/** 12-week projection (تقدير). Rate is clamped to a realistic band. */
export function projection(current, rate, weeks = 12) {
  if (!isNum(current) || !isNum(rate)) return null;
  const k = Math.max(-1, Math.min(2.5, rate));
  return { value: r1(current + k * weeks), rate: k, weeks, estimate: true };
}

/** Date a target would be reached at the current rate (تقدير). null when rate ≤ 0 or > 2 years. */
export function predictDate(current, rate, target, today) {
  if (!isNum(current) || !isNum(target) || !isDayKey(today)) return null;
  if (current >= target) return { day: today, weeks: 0, reached: true };
  if (!isNum(rate) || rate <= 0) return null;
  const weeks = Math.ceil((target - current) / rate);
  if (weeks > 104) return null;
  return { day: addDays(today, weeks * 7), weeks, reached: false, estimate: true };
}

// ───────────────────────── strength level / DOTS ─────────────────────────

const STD = { // bodyweight multiples (e1RM ÷ BW), male; female ≈ ×0.65
  bench: [0.5, 0.75, 1.0, 1.5, 2.0],
  squat: [0.75, 1.25, 1.5, 2.25, 2.75],
  deadlift: [1.0, 1.5, 2.0, 2.5, 3.0],
  ohp: [0.35, 0.55, 0.75, 1.0, 1.4],
  row: [0.5, 0.75, 1.0, 1.5, 1.75],
};
export const LEVELS = ['مبتدئ', 'مبتدئ متقدّم', 'متوسط', 'متقدّم', 'نخبة'];

/** {idx (-1..4), label, ratio, next:{label, kg}|null} from e1RM ÷ current body weight. */
export function strengthLevel(e1rmKg, bw, lift, sex = 'male') {
  const theirs = sex !== 'female' ? viaContract(WK, 'strengthLevel', [e1rmKg, bw, lift], (v) => v && isNum(v.idx) && typeof v.level === 'string') : null;
  if (theirs) return { idx: theirs.idx, label: theirs.level, ratio: theirs.ratio, next: theirs.idx < 4 && isNum(theirs.next) ? { label: LEVELS[theirs.idx + 1], kg: theirs.next } : null };
  return strengthLevelLocal(e1rmKg, bw, lift, sex);
}
export function strengthLevelLocal(e1rmKg, bw, lift, sex = 'male') {
  const t = STD[lift];
  if (!t || !(e1rmKg > 0) || !(bw > 0)) return null;
  const f = sex === 'female' ? 0.65 : 1;
  const ratio = r2(e1rmKg / bw);
  let idx = -1;
  t.forEach((m, i) => { if (ratio >= m * f) idx = i; });
  const nx = idx < 4 ? { label: LEVELS[idx + 1], kg: r1(t[idx + 1] * f * bw) } : null;
  return { idx, label: idx >= 0 ? LEVELS[idx] : 'بداية', ratio, next: nx };
}

/** DOTS score (successor of Wilks) for a squat+bench+deadlift total. */
export function dots(total, bw, sex = 'male') {
  if (!(total > 0) || !(bw >= 35)) return null;
  const c = sex === 'female' ? [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706] : [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093];
  const b = Math.min(bw, sex === 'female' ? 150 : 210);
  const den = c[0] + c[1] * b + c[2] * b ** 2 + c[3] * b ** 3 + c[4] * b ** 4;
  return r1((total * 500) / den);
}

/** Classic Wilks from the workout contract (null when unavailable). */
export function wilksScore(total, bw, sex = 'male') {
  const v = viaContract(WK, 'wilks', [total, bw, sex === 'female' ? 'f' : 'm'], (x) => isNum(x) && x > 0);
  return v === null ? null : r1(v);
}

// ───────────────────────── load / readiness / lagging ─────────────────────────

/** Acute (7 d) : chronic (28 d ÷ 4) volume ratio. → {acute, chronic, ratio, level} | null */
export function trainingLoad(sessions, today) {
  const ls = lifting(sessions);
  let acute = 0, chronic28 = 0;
  for (const s of ls) {
    const d = diffDays(s.day, today);
    if (d < 0) continue;
    const v = volumeOf(s);
    if (d < 7) acute += v;
    if (d < 28) chronic28 += v;
  }
  const chronic = chronic28 / 4;
  if (!(chronic > 0) || ls.filter((s) => diffDays(s.day, today) < 28).length < 3) return null;
  const ratio = r2(acute / chronic);
  const level = ratio < 0.8 ? 'low' : ratio <= 1.3 ? 'normal' : ratio <= 1.5 ? 'high' : 'very';
  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio, level };
}
export const LOAD_TEXT = {
  low: 'أقل من متوسطك — مساحة تزوّد',
  normal: 'في المعدل الطبيعي',
  high: 'أعلى من متوسطك — راقب التعب',
  very: 'عالي جدًا — خلّي الجلسة الجاية أخف',
};

/** Muscle under 60 % of the top muscle's hard sets over the last 28 days. → {muscle, sets, top, topSets} | null */
export function laggingMuscle(sessions, today) {
  const g = WK.hardSetsByMuscle(sessions, addDays(today, -27), today);
  const rows = Object.entries(g).filter(([m]) => m !== 'بطن');
  if (!rows.length) return null;
  rows.sort((a, b) => b[1] - a[1]);
  const [top, topSets] = rows[0];
  if (topSets < 6) return null;
  const low = rows[rows.length - 1];
  if (low[1] >= topSets * 0.6) return null;
  return { muscle: low[0], sets: low[1], top, topSets };
}

/** Readiness 0-100 from sleep h, energy/stress/soreness 1-5. */
export function readinessScore({ sleepH, energy, stress, soreness } = {}) {
  const s = isNum(+sleepH) && +sleepH > 0 ? Math.min(+sleepH / 8, 1) : 0.85;
  const e = isNum(+energy) && +energy >= 1 ? (+energy - 1) / 4 : 0.5;
  const st = isNum(+stress) && +stress >= 1 ? (5 - +stress) / 4 : 0.5;
  const so = isNum(+soreness) && +soreness >= 1 ? (5 - +soreness) / 4 : 0.5;
  return Math.max(0, Math.min(100, Math.round(s * 30 + e * 25 + st * 20 + so * 25)));
}
/** 4 bands (old Solo Gym thresholds 80/60/40). */
export function readinessBand(score) {
  if (!isNum(score)) return null;
  if (score >= 80) return { key: 'top', label: 'ممتازة', advice: 'يوم مناسب تحاول فيه رقم قياسي.' };
  if (score >= 60) return { key: 'good', label: 'كويسة', advice: 'اتمرن بتركيز، وابعد عن الفشل (RIR 0).' };
  if (score >= 40) return { key: 'mid', label: 'متوسطة', advice: 'خفّف الأوزان 10–15% النهارده.' };
  return { key: 'low', label: 'منخفضة', advice: 'فكّر في راحة أو تمرين خفيف.' };
}

/** Body-weight drop warning: latest vs mean of the 4 before > 2 kg. */
export function bwDrop(weights) {
  const ws = [...weights].filter((w) => w && isNum(w.kg)).sort((a, b) => a.day.localeCompare(b.day));
  if (ws.length < 3) return null;
  const last = ws[ws.length - 1].kg; const prev = ws.slice(-5, -1);
  const avg = prev.reduce((a, w) => a + w.kg, 0) / prev.length;
  const drop = r1(avg - last);
  return drop > 2 ? { drop } : null;
}

// ───────────────────────── volume ─────────────────────────

export function volumeByDay(sessions, days) {
  const m = new Map(days.map((d) => [d, 0]));
  for (const s of lifting(sessions)) if (m.has(s.day)) m.set(s.day, m.get(s.day) + volumeOf(s));
  return days.map((day) => ({ day, v: m.get(day) }));
}
export function volumeByWeek(sessions, today, weeks = 8, startDow = 1) {
  const cur = weekStart(today, startDow);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(cur, -(weeks - 1 - i) * 7));
  const m = new Map(starts.map((d) => [d, 0]));
  for (const s of lifting(sessions)) { const w = weekStart(s.day, startDow); if (m.has(w)) m.set(w, m.get(w) + volumeOf(s)); }
  return starts.map((day) => ({ day, v: m.get(day) }));
}
/** Hard sets per muscle for the last `weeks` weeks: {weeks:[start...], rows:[{muscle, sets:[...]}]} */
export function muscleWeeks(sessions, today, weeks = 4, startDow = 1) {
  const cur = weekStart(today, startDow);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(cur, -(weeks - 1 - i) * 7));
  const per = starts.map((w) => WK.hardSetsByMuscle(sessions, w, addDays(w, 6)));
  const muscles = Object.keys(per[0] || {});
  return { weeks: starts, rows: muscles.map((muscle) => ({ muscle, sets: per.map((p) => p[muscle] || 0), lm: WK.VOL_LM[muscle] || null })) };
}

/** Training this week vs last week (to the same weekday). */
export function weekCompareTraining(sessions, today, startDow = 1) {
  const cur = weekStart(today, startDow); const prev = addDays(cur, -7);
  const span = diffDays(cur, today);
  const pick = (from) => lifting(sessions).filter((s) => s.day >= from && s.day <= addDays(from, span));
  const prs = prTimeline(sessions);
  const sum = (ss, from) => ({ sessions: ss.length, volume: ss.reduce((a, s) => a + volumeOf(s), 0), sets: ss.reduce((a, s) => a + WK.sessionSetCount(s), 0),
    prs: prs.filter((p) => p.day >= from && p.day <= addDays(from, span)).length });
  return { cur: sum(pick(cur), cur), prev: sum(pick(prev), prev), span };
}

/** Per-exercise comparison of two sessions (a = older, b = newer). */
export function sessionCompare(a, b) {
  if (!a || !b) return null;
  const sum = (e) => ({ topW: WK.topWOf(e), vol: Math.round(WK.doneSets(e).reduce((v, t) => v + (+t.w || 0) * (+t.r || 0), 0)), sets: WK.doneSets(e).length, e1rm: WK.bestE1rmOf(e) });
  const rows = [];
  for (const eb of b.exercises || []) {
    const ea = (a.exercises || []).find((x) => WK.sameExercise(x, eb));
    const sb = sum(eb); const sa = ea ? sum(ea) : null;
    rows.push({ name: WK.displayName(eb) || eb.name, a: sa, b: sb, dW: sa ? r1(sb.topW - sa.topW) : null, dVol: sa ? sb.vol - sa.vol : null, dE: sa ? r1(sb.e1rm - sa.e1rm) : null });
  }
  return { rows, dur: [a.durationMin || null, b.durationMin || null], vol: [volumeOf(a), volumeOf(b)] };
}

/** Overview stats for sessions in [from, to]. */
export function overviewStats(sessions, from, to) {
  const ss = lifting(sessions).filter((s) => s.day >= from && s.day <= to);
  const weeks = Math.max(1, (diffDays(from, to) + 1) / 7);
  const durs = ss.map((s) => s.durationMin).filter((d) => d > 0);
  return { sessions: ss.length, volume: ss.reduce((a, s) => a + volumeOf(s), 0), sets: ss.reduce((a, s) => a + WK.sessionSetCount(s), 0),
    avgMin: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null, perWeek: r1(ss.length / weeks) };
}

/** Consistency grid, oldest week first: [[{day, state}]] state: trained | recovery | missed | rest | future */
export function consistencyCalendar(sessions, { today, weeks = 12, startDow = 1, trainingDays = [1, 2, 4, 5] } = {}) {
  const trained = new Set(lifting(sessions).map((s) => s.day));
  const rec = new Set((sessions || []).filter((s) => isRecovery(s) && s.day && !s.discarded).map((s) => s.day));
  const first = addDays(weekStart(today, startDow), -(weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, i) => {
    const day = addDays(first, w * 7 + i);
    const planned = trainingDays.includes(new Date(`${day}T12:00:00`).getDay());
    const state = day > today ? 'future' : trained.has(day) ? 'trained' : rec.has(day) ? 'recovery' : planned && day < today ? 'missed' : 'rest';
    return { day, state };
  }));
}

// ───────────────────────── summary sentence ─────────────────────────

/** Smart summary (A30): 4 figures + 1 sentence. now = Date for hour gaps. */
export function smartSummary(sessions, { today, now = new Date(), startDow = 1, plannedPerWeek = 4 } = {}) {
  const ls = lifting(sessions);
  const ws = weekStart(today, startDow);
  const week = ls.filter((s) => s.day >= ws && s.day <= today);
  const load = trainingLoad(sessions, today);
  const last = ls[ls.length - 1];
  let gapH = null;
  if (last) {
    const t = Date.parse(last.finishedAt || '');
    gapH = Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 3600000)) : diffDays(last.day, today) * 24;
  }
  let sentence;
  if (!last) sentence = 'لسه مفيش جلسات — أول جلسة بتحدد نقطة البداية.';
  else if (gapH > 48) sentence = `آخر جلسة من ${countText(Math.round(gapH / 24), 'day')} — وقت ترجع للجيم.`;
  else if (load && load.level === 'very') sentence = 'الحمل عالي الأسبوع ده — خلّي الجلسة الجاية أخف.';
  else if (week.length >= plannedPerWeek) sentence = 'الأسبوع اتقفل على الخطة — كمّل كده.';
  else sentence = `كمّل — فاضل ${plannedPerWeek - week.length} من جلسات الأسبوع.`;
  return { sessionsWeek: week.length, planned: plannedPerWeek, weekVolume: week.reduce((a, s) => a + volumeOf(s), 0), gapH, load, sentence };
}

// ───────────────────────── body ─────────────────────────

/** US Navy body-fat % (cm). */
export function navyBF({ sex = 'male', waist, neck, hip, heightCm } = {}) {
  const L = Math.log10;
  if (!(waist > 0 && neck > 0 && heightCm > 0)) return null;
  if (sex === 'female') {
    if (!(hip > 0) || waist + hip - neck <= 0) return null;
    return r1(495 / (1.29579 - 0.35004 * L(waist + hip - neck) + 0.221 * L(heightCm)) - 450);
  }
  if (waist - neck <= 0) return null;
  return r1(495 / (1.0324 - 0.19077 * L(waist - neck) + 0.15456 * L(heightCm)) - 450);
}
export const bmi = (kg, cm) => (kg > 0 && cm > 0 ? r1(kg / (cm / 100) ** 2) : null);
/** Weight in `weeks` at the current 7-day-average trend (تقدير). */
export function weightPrediction(avg7, kgPerWeek, weeks = 8) {
  if (!isNum(avg7) || !isNum(kgPerWeek)) return null;
  return { value: r1(avg7 + kgPerWeek * weeks), weeks, estimate: true };
}

// ───────────────────────── nutrition (fallbacks) ─────────────────────────

const hourOf = (e) => { const m = /^(\d{1,2}):/.exec(String(e && e.time || '')); return m ? +m[1] : null; };

/** Eating patterns over the given days: {days, lateDays, skippedBreakfast, overDays, topFoods, hours[24], window} */
export function eatingPatterns(foodLog, days, targetOf = () => null) {
  const local = eatingPatternsLocal(foodLog, days, targetOf);
  const theirs = viaContract(NU, 'eatingPatterns', [days.map((d) => ({ day: d, entries: foodLog[d] || [], target: targetOf(d) || undefined }))], (v) => v && typeof v === 'object' && Array.isArray(v.topFoods) && isNum(v.totalDays));
  if (!theirs) return local;
  return { ...local, days: theirs.totalDays, lateDays: theirs.lateNight ? theirs.lateNight.days : local.lateDays, skippedBreakfast: isNum(theirs.skipBreakfast) ? theirs.skipBreakfast : local.skippedBreakfast,
    overDays: theirs.overshoot ? theirs.overshoot.days : local.overDays, topFoods: theirs.topFoods.map((x) => (Array.isArray(x) ? { name: x[0], n: x[1] } : x)), hours: theirs.hours || local.hours,
    notes: Array.isArray(theirs.notes) ? theirs.notes.filter((n) => n && n.title).map((n) => ({ title: String(n.title), text: String(n.text || '') })) : [] };
}
export function eatingPatternsLocal(foodLog, days, targetOf = () => null) {
  const hours = Array(24).fill(0); const foods = new Map();
  let logged = 0, late = 0, skip = 0, over = 0; const windows = [];
  for (const d of days) {
    const es = foodLog[d] || [];
    if (!es.length) continue;
    logged++;
    const hs = es.map(hourOf).filter((x) => x !== null);
    hs.forEach((x) => hours[x]++);
    if (hs.some((x) => x >= 22 || x < 4)) late++;
    if (!es.some((e) => NU.sectionOf(e) === 'breakfast')) skip++;
    const t = targetOf(d);
    if (t && sumEntries(es).kcal > t.kcal * 1.1) over++;
    if (hs.length >= 2) windows.push(Math.max(...hs) - Math.min(...hs));
    for (const e of es) { const k = String(e.name || '').trim(); if (k) foods.set(k, (foods.get(k) || 0) + 1); }
  }
  const topFoods = [...foods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n }));
  return { days: logged, lateDays: late, skippedBreakfast: skip, overDays: over, topFoods, hours, notes: [],
    window: windows.length ? r1(windows.reduce((a, b) => a + b, 0) / windows.length) : null };
}

/** Protein grams per main meal for a day: [{section, p, low}] (low < 0.4 g/kg when kg known). */
export function proteinPerMeal(entries, kg) {
  const theirs = viaContract(NU, 'proteinPerMeal', [entries, kg], Array.isArray);
  if (theirs) return theirs;
  const min = kg > 0 ? r1(kg * 0.4) : 25;
  return NU.SECTIONS.map((s) => { const p = r1(sumEntries(entries.filter((e) => NU.sectionOf(e) === s.key)).p); return { section: s.key, label: s.label, p, low: p > 0 && p < min }; }).filter((x) => x.p > 0);
}

/** Kcal per day vs target band: [{day, kcal, lo, hi, logged}] */
export function kcalSeries(foodLog, days, targetOf) {
  return days.map((day) => {
    const es = foodLog[day] || []; const t = targetOf(day); const r = NU.targetRange(t);
    return { day, kcal: Math.round(sumEntries(es).kcal), p: Math.round(sumEntries(es).p), lo: r.kcalMin, hi: r.kcalMax, target: t.kcal, logged: es.length > 0 };
  });
}

/** Best day: logged, protein hit, kcal closest to target. */
export function bestDay(perDay) {
  const c = (perDay || []).filter((d) => d.logged && d.pHit);
  if (!c.length) return null;
  return c.sort((a, b) => Math.abs(a.intake.kcal - a.target.kcal) - Math.abs(b.intake.kcal - b.target.kcal))[0];
}

/** 2-week vs previous 2-week recomposition block. */
export function recompBlock({ today, sessions, foodLog, weights, targetOf }) {
  const block = (end) => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(end, -13 + i));
    let logged = 0, pHit = 0, kcal = 0;
    for (const d of days) {
      const es = foodLog[d] || []; if (!es.length) continue;
      logged++; const s = sumEntries(es); kcal += s.kcal;
      if (s.p >= NU.targetRange(targetOf(d)).pMin) pHit++;
    }
    const ws = weights.filter((w) => w.day >= days[0] && w.day <= end);
    const trained = lifting(sessions).filter((s) => s.day >= days[0] && s.day <= end).length;
    return { logged, pHit, trained, avgKcal: logged ? Math.round(kcal / logged) : null, wAvg: ws.length ? r1(ws.reduce((a, w) => a + w.kg, 0) / ws.length) : null };
  };
  const cur = block(today), prev = block(addDays(today, -14));
  return { cur, prev, dW: cur.wAvg !== null && prev.wAvg !== null ? r1(cur.wAvg - prev.wAvg) : null };
}

/** Sleep vs performance pairs (needs ≥ 8): [{sleepH, perf}] perf = volume ÷ median volume of the same plan day ×100. */
export function sleepPerf(sessions, daily) {
  const ls = lifting(sessions);
  const byKey = new Map();
  for (const s of ls) { const k = s.dayKey || s.dayName || 'x'; (byKey.get(k) || byKey.set(k, []).get(k)).push(volumeOf(s)); }
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const out = [];
  for (const s of ls) {
    const w = daily[s.day] && daily[s.day].wellness;
    const h = w && +w.sleepH;
    const m = med(byKey.get(s.dayKey || s.dayName || 'x'));
    if (h > 0 && m > 0) out.push({ day: s.day, sleepH: h, perf: Math.round((volumeOf(s) / m) * 100) });
  }
  return out;
}

/** Quiet milestones (A37) with the day first reached. */
export function milestones({ sessions, today, startDow = 1, plannedPerWeek = 4, proteinWeeks = [] }) {
  const ls = lifting(sessions); const out = [];
  if (ls[49]) out.push({ id: 's50', label: '50 جلسة', day: ls[49].day });
  if (ls[99]) out.push({ id: 's100', label: '100 جلسة', day: ls[99].day });
  for (const [lift, kg, label] of [['squat', 100, 'أول سكوات 100 كجم'], ['bench', 100, 'أول بنش 100 كجم'], ['deadlift', 140, 'أول ديدليفت 140 كجم']]) {
    const hit = ls.find((s) => s.exercises.some((e) => liftOf(e) === lift && WK.topWOf(e) >= kg));
    if (hit) out.push({ id: `${lift}${kg}`, label, day: hit.day });
  }
  try { const wp = WK.weeksOnPlan(sessions, { plannedPerWeek, weekStartDow: startDow, today }); if (wp.weeks >= 12) out.push({ id: 'w12', label: '12 أسبوع على الخطة', day: today }); } catch { /* ignore */ }
  const pw = proteinWeeks.find((w) => w.hit >= 7);
  if (pw) out.push({ id: 'p7', label: 'أول أسبوع بروتين 7/7', day: pw.end });
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

/** Month summary for printing. */
export function monthSummary({ sessions, foodLog, weights, month }) {
  const ls = lifting(sessions).filter((s) => s.day.startsWith(month));
  const prs = prTimeline(sessions).filter((p) => p.day.startsWith(month));
  const days = Object.keys(foodLog).filter((d) => d.startsWith(month) && foodLog[d].length);
  const tot = days.reduce((a, d) => { const s = sumEntries(foodLog[d]); return { k: a.k + s.kcal, p: a.p + s.p }; }, { k: 0, p: 0 });
  const ws = weights.filter((w) => w.day.startsWith(month)).sort((a, b) => a.day.localeCompare(b.day));
  return { month, sessions: ls.length, volume: ls.reduce((a, s) => a + volumeOf(s), 0), prs,
    loggedDays: days.length, avgKcal: days.length ? Math.round(tot.k / days.length) : null, avgP: days.length ? Math.round(tot.p / days.length) : null,
    wFirst: ws[0] || null, wLast: ws[ws.length - 1] || null };
}

/** Period presets for the segmented control. */
export const PERIODS = { m: { days: 30, label: 'شهر' }, q: { days: 91, label: '3 شهور' }, y: { days: 365, label: 'سنة' } };
