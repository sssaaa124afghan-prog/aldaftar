// Pure training logic (no DOM, no storage). Tested by logic.test.js.
import { addDays, diffDays, weekStart, dayKey, weekday as weekdayOf } from '../../core/date.js';
import { cardioDayOf } from '../../core/schema.js';
import { PROGRAMS, DEFAULT_PROGRAM, LIBRARY, VOL_LM, MUSCLE_LM, PLAN_UPDATES, findLib, libById, enKey, muscleGroup, fineOf, isLowerMuscle } from './exercises.js';
import { PLATEAU_PROTOCOLS, MOBILITY_PREP, STATIONS } from './content.js';

export const REST = Object.freeze({ compound: 150, isolation: 90 });
/** Rest after a full superset round (Solo Gym _getSmartTimer): compound 90 s, isolation 40 s. */
export const SS_REST = Object.freeze({ compound: 90, isolation: 40 });
export const RIR_HARD_MAX = 3; // a set counts as "hard" when RIR ≤ 3 (or RIR not logged) — review.md / hypertrophy.md §7
export const SYNERGIST_CREDIT = 0.5;

// ── numbers ─────────────────────────────────────────────────
export const round1 = (n) => Math.round(n * 10) / 10;
export function roundTo(n, step = 2.5) { return Math.round(n / step) * step; }
/** Weight/number as a Latin-digit string, ≤ 2 decimals, no trailing zeros. */
export function fmtW(n) {
  if (n === null || n === undefined || !Number.isFinite(+n)) return '—';
  return String(Math.round(+n * 100) / 100);
}
/** Thousands-separated integer, Latin digits. */
export function fmtInt(n) {
  if (!Number.isFinite(+n)) return '—';
  const s = String(Math.round(Math.abs(+n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (+n < 0 ? '−' : '') + s;
}
/** Seconds → "m:ss" (or "h:mm:ss"). */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

// ── exercises ───────────────────────────────────────────────
/** "5-8" → {lo:5,hi:8}; "15" → {lo:15,hi:15}; "8-10/رجل" → {lo:8,hi:10}; time-based → null */
export function parseReps(reps) {
  const s = String(reps ?? '').trim();
  if (/ثانية|ث$|s$|sec|دقيقة/i.test(s)) return null;
  const m = /^(\d{1,3})\s*(?:[-–]\s*(\d{1,3}))?/.exec(s);
  if (!m) return null;
  const lo = +m[1], hi = m[2] ? +m[2] : lo;
  if (!lo || hi < lo) return null;
  return { lo, hi };
}

const COMPOUND_HINT = ['bench', 'deadlift', 'squat', 'row', 'press', 'ohp', 'pull-up', 'pullup', 'chin', 'dip', 'hip thrust', 'lunge', 'rdl', 'pulldown'];
/** 'compound' | 'isolation' for any exercise-like object. */
export function kindOf(ex) {
  if (!ex) return 'isolation';
  if (ex.kind === 'compound' || ex.kind === 'isolation') return ex.kind;
  const L = (ex.lib && libById(ex.lib)) || findLib(ex.en || ex.name);
  if (L) return L.kind;
  const n = String(ex.en || ex.name || '').toLowerCase();
  return COMPOUND_HINT.some((k) => n.includes(k)) ? 'compound' : 'isolation';
}

/** Rest rule: per-exercise override (restS) → superset round rule → compound 150 s / isolation 90 s. */
export const restFor = (ex, { superset = false } = {}) =>
  (ex && +ex.restS >= 15 && +ex.restS <= 600 ? Math.round(+ex.restS) : (superset ? SS_REST : REST)[kindOf(ex)]);

/** Stable identity used to match an exercise across sessions/programs. */
export function exKey(ex) {
  if (!ex) return '';
  const L = (ex.lib && libById(ex.lib)) || findLib(ex.en || ex.name);
  return L ? `lib:${L.id}` : `id:${ex.exId ?? ex.id ?? enKey(ex.name)}`;
}
export function sameExercise(a, b) {
  if (!a || !b) return false;
  const ia = a.exId ?? a.id, ib = b.exId ?? b.id;
  if (ia !== undefined && ia === ib) return true;
  return exKey(a) === exKey(b);
}

/** Arabic display name for a (possibly legacy) exercise. */
export function displayName(ex) {
  if (!ex) return '';
  const L = (ex.lib && libById(ex.lib)) || findLib(ex.en || ex.name);
  if (L) return L.ar;
  return String(ex.ar || ex.name || '').split('·')[0].trim();
}

// ── strength ────────────────────────────────────────────────
/** Epley estimated 1RM. 0 for empty sets; reps > 15 are too unreliable → 0. */
export function e1rm(w, r) {
  w = +w; r = +r;
  if (!(w > 0) || !(r > 0) || r > 15) return 0;
  if (r === 1) return round1(w);
  return round1(w * (1 + r / 30));
}

export const isDoneSet = (t) => !!t && t.done !== false && (+t.r > 0) && (+t.w >= 0);
export const doneSets = (ex) => (Array.isArray(ex?.sets) ? ex.sets.filter((t) => t && t.done && +t.r > 0) : []);
/** Sets that may set a PR / count as a top set: drop sets are excluded (W11). */
export const prSets = (ex) => doneSets(ex).filter((t) => t.type !== 'drop');

export const bestE1rmOf = (ex) => prSets(ex).reduce((m, t) => Math.max(m, e1rm(t.w, t.r)), 0);
export const topWOf = (ex) => prSets(ex).reduce((m, t) => Math.max(m, +t.w || 0), 0);

/** Status of a running session in the sessions store (Today reads it via app/day.js sessionState). */
export const ACTIVE = 'active';
const LIVE = new Set(['active', 'running', 'live']);
export const isActive = (s) => !!s && LIVE.has(s.status);

/** Imported baseline («استورد أوزانك القديمة»): a synthetic session that only seeds prefill / re-entry / progression. */
export const isSeed = (s) => !!s && (s.seed === true || s.kind === 'baseline');
/**
 * Finished sessions sorted oldest → newest (excludes discarded / active). Seed (baseline) sessions are left out by default,
 * so volume, streaks, PRs, weekly counts and charts never see them; prefill passes {seeds:true}.
 */
export function finished(sessions, { seeds = false } = {}) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && !LIVE.has(s.status) && !s.discarded && s.kind !== 'recovery' && (seeds || !isSeed(s)) && Array.isArray(s.exercises))
    .sort((a, b) => String(a.finishedAt || a.startedAt || a.day || '').localeCompare(String(b.finishedAt || b.startedAt || b.day || '')));
}

/** All past exposures of an exercise, newest first: [{session, ex}] (only with ≥1 done set). {seeds:true} includes baselines. */
export function exposures(sessions, item, { excludeId, seeds = false } = {}) {
  const out = [];
  for (const s of finished(sessions, { seeds })) {
    if (excludeId && s.id === excludeId) continue;
    for (const e of s.exercises) if (sameExercise(e, item) && doneSets(e).length) { out.push({ session: s, ex: e }); break; }
  }
  return out.reverse();
}

/** Best previous e1RM and weight for an exercise. */
export function bests(sessions, item, opts) {
  let e = 0, w = 0;
  for (const { ex } of exposures(sessions, item, opts)) { e = Math.max(e, bestE1rmOf(ex)); w = Math.max(w, topWOf(ex)); }
  return { e1rm: e, w };
}

/**
 * PR check for a just-completed set against the best before this session AND earlier sets this session.
 * Returns null or {type:'e1rm'|'weight', value, delta}.
 */
export function detectPR(set, prior, sessionSoFar = []) {
  if (!isDoneSet(set) || !(+set.w > 0) || set.type === 'drop') return null;
  sessionSoFar = sessionSoFar.filter((t) => t && t.type !== 'drop');
  const prevE = Math.max(prior?.e1rm || 0, ...sessionSoFar.map((t) => e1rm(t.w, t.r)));
  const prevW = Math.max(prior?.w || 0, ...sessionSoFar.map((t) => +t.w || 0));
  if (!(prior?.e1rm > 0 || prior?.w > 0)) return null; // first exposure is a baseline, not a PR
  const e = e1rm(set.w, set.r);
  if (+set.w > prevW) return { type: 'weight', value: +set.w, delta: round1(+set.w - prevW) };
  if (e > prevE) return { type: 'e1rm', value: e, delta: round1(e - prevE) };
  return null;
}

// ── progression (double progression) ────────────────────────
export const incFor = (w) => (+w >= 20 ? 2.5 : 1);

/** Decision gates (Solo Gym eliteDecision), applied in prescribe(). Order = priority. */
export const GATES = Object.freeze({
  readiness: 'جاهزيتك النهارده قليلة — الأوزان أخف 10%',
  effort: 'آخر مرة كانت قريبة من الفشل (RIR ≤ 1) — ثبّت الوزن وزوّد عدّات',
  bw: 'وزن جسمك نزل أكتر من 2 كجم — ثبّت الوزن وركز على البروتين',
  load: 'حمل التدريب عالي الأسبوع ده — ثبّت الوزن',
  phase: 'أسبوع تخفيف في الدورة — 90% من الوزن',
  reentry: 'أسبوع الرجوع 1 — 80% من آخر وزن ومجموعات أقل، من غير فشل',
  reentry2: 'أسبوع الرجوع 2 — 90% من آخر وزن ومجموعات أقل شوية',
});
const lighten = (w) => (w >= 20 ? roundTo(w * 0.9) : round1(w * 0.9));
const avgRirOf = (sets) => { const v = sets.filter((t) => t.rir !== null && t.rir !== undefined && t.rir !== '').map((t) => +t.rir); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/**
 * Prefill for today's sets from the last exposure.
 * Ready to add load when every planned set hit the top of the rep range at RIR ≤ 2 (or RIR not logged).
 * Gates (W25/R7/R8): readiness < 40 → −10%; avg RIR ≤ 1 → hold; body weight −2 kg → hold; training load high → hold;
 * periodization deload week → 90%.
 * Returns {sets:[{w,r}], ready, inc, from:'last'|'plan', gates:[code], hold:boolean}.
 */
export function prescribe(item, lastEx, { deload = false, lighter = false, readiness = null, bwDrop = 0, load = null, phase = null, bw = 0, rirTarget = null } = {}) {
  const n = Math.max(1, Math.min(10, +item.sets || 3));
  const range = parseReps(item.reps);
  const lo = range ? range.lo : (+item.r || 8);
  const hi = range ? range.hi : lo;
  let sets, ready = false, inc = 0, from = 'plan', mode = null;
  const gates = [];
  const lowReady = readiness !== null && Number.isFinite(+readiness) && +readiness < 40;
  const last = lastEx ? prSets(lastEx) : [];
  if (!last.length) {
    const w0 = +item.w || 0;
    sets = Array.from({ length: n }, () => ({ w: w0, r: lo }));
  } else {
    from = 'last';
    const top = Math.max(...last.map((t) => +t.w || 0));
    const rirOk = Math.max(2, rirTarget ? rirTarget.hi : 2);
    ready = !!range && last.length >= n && last.slice(0, n).every((t) => +t.r >= hi && (t.rir === null || t.rir === undefined || +t.rir <= rirOk));
    const ar = avgRirOf(last);
    if (ready && !deload && !lighter && lowReady) gates.push('readiness');
    // with a mesocycle target the effort gate fires only when he went closer to failure than planned
    if (ready && ar !== null && (rirTarget ? ar < rirTarget.lo : ar <= 1)) gates.push('effort');
    if (ready && bwDrop > 2) gates.push('bw');
    if (ready && load === 'high') gates.push('load');
    if (gates.length) ready = false;
    const step = ready ? loadStep(item, top, { bw, hi }) : null;
    if (ready && step.repsFirst && Math.min(...last.slice(0, n).map((t) => +t.r || 0)) < step.repCap) {
      // reps first (small isolations up to 20, or a machine pin jump > 10%): same load, one more rep
      ready = false; mode = 'reps';
      const r1 = Math.min(step.repCap, Math.min(...last.slice(0, n).map((t) => +t.r || lo)) + 1);
      sets = Array.from({ length: n }, (_, i) => ({ w: +last[Math.min(i, last.length - 1)].w || 0, r: r1 }));
    } else if (ready) {
      inc = step.inc;
      sets = Array.from({ length: n }, () => ({ w: round1(top + inc), r: lo }));
    } else {
      sets = Array.from({ length: n }, (_, i) => {
        const t = last[Math.min(i, last.length - 1)];
        return { w: +t.w || 0, r: Math.min(hi, Math.max(1, +t.r || lo)) };
      });
    }
  }
  if (deload) {
    const k = Math.ceil(n / 2);
    sets = sets.slice(0, k).map((t) => ({ w: lighten(t.w), r: t.r }));
    ready = false; inc = 0;
  } else if (lighter) { // back after a 7+ day gap: same sets, 10% lighter
    sets = sets.map((t) => ({ w: lighten(t.w), r: t.r }));
    ready = false; inc = 0;
  } else if (phase === 'deload') {
    sets = sets.map((t) => ({ w: lighten(t.w), r: t.r })); ready = false; inc = 0; gates.push('phase');
  } else if (lowReady) {
    sets = sets.map((t) => ({ w: lighten(t.w), r: t.r })); ready = false; inc = 0;
    if (!gates.includes('readiness')) gates.unshift('readiness');
  }
  return { sets, ready, inc, from, gates, hold: gates.length > 0, ...(mode ? { mode } : {}) };
}

const SMALL_ISO = new Set(['كتف جانبي', 'كتف خلفي', 'باي', 'تراي', 'ساعد']);
/**
 * Load step by equipment (hypertrophy.md §4.1): barbell upper +2.5; barbell lower +5 (+2.5 once > 1.25 × body weight);
 * dumbbells the next pair (+1 under 10 kg, else +2); machine / cable the next pin (+2.5, +5 from 50 kg) and reps first up to
 * the top + 3 when that pin is > 10%; small isolations (side/rear delt, biceps, triceps, forearms) reps first up to 20.
 * Unknown equipment keeps the old rule (+2.5, +1 under 20 kg). → {inc, repsFirst, repCap}
 */
export function loadStep(item, w, { bw = 0, hi = null } = {}) {
  const L = item && ((item.lib && libById(item.lib)) || findLib(item.en || item.name));
  w = +w || 0;
  const top = hi || parseReps(item?.reps)?.hi || 12;
  const { prime } = fineOf(item || {});
  const kind = kindOf(item);
  let inc = incFor(w), repCap = 0;
  if (L && L.eq === 'بار') inc = isLowerMuscle(prime) ? (+bw > 0 && w > 1.25 * +bw ? 2.5 : 5) : 2.5;
  else if (L && L.eq === 'دمبل') inc = w < 10 ? 1 : 2;
  else if (L && (L.eq === 'جهاز' || L.eq === 'كابل')) { inc = w >= 50 ? 5 : 2.5; if (w > 0 && inc / w > 0.1) repCap = top + 3; }
  if (kind === 'isolation' && SMALL_ISO.has(prime)) repCap = 20; // small isolations: reps first to 20, then the next pin / pair
  return { inc, repsFirst: repCap > top, repCap: repCap > top ? repCap : top };
}

// ── session aggregates ──────────────────────────────────────
export function sessionVolume(s) {
  let v = 0;
  for (const e of s?.exercises || []) for (const t of doneSets(e)) v += (+t.w || 0) * (+t.r || 0);
  return Math.round(v);
}
export const sessionSetCount = (s) => (s?.exercises || []).reduce((n, e) => n + doneSets(e).length, 0);

const isHard = (t) => t.rir === null || t.rir === undefined || t.rir === '' || +t.rir <= RIR_HARD_MAX;
/** Credit one set of this exercise gives each fine muscle: prime 1, each synergist 0.5. */
export function setCredits(ex) {
  const { prime, synergists } = fineOf(ex);
  const out = {};
  if (prime && MUSCLE_LM[prime]) out[prime] = 1;
  for (const m of synergists) if (MUSCLE_LM[m] && !(m in out)) out[m] = SYNERGIST_CREDIT;
  return out;
}
/** Same credits folded into the legacy landmark groups (a synergist in the prime's own group adds nothing). */
function groupCredits(ex) {
  const { prime, synergists } = fineOf(ex);
  const out = {};
  const g0 = muscleGroup(prime) || muscleGroup(ex?.muscle || findLib(ex?.en || ex?.name)?.muscle);
  if (g0) out[g0] = 1;
  for (const m of synergists) { const g = muscleGroup(m); if (g && !(g in out)) out[g] = SYNERGIST_CREDIT; }
  return out;
}
/**
 * Hard sets (RIR ≤ 3 or not logged) for sessions whose day is in [from, to], synergists at 0.5.
 * by 'group' (default, legacy VOL_LM keys used by progress / coach) or 'muscle' (MUSCLE_LM fine keys).
 */
export function hardSetsByMuscle(sessions, from, to, { by = 'group' } = {}) {
  const fine = by === 'muscle';
  const out = Object.fromEntries(Object.keys(fine ? MUSCLE_LM : VOL_LM).map((k) => [k, 0]));
  for (const s of finished(sessions)) {
    if (!s.day || s.day < from || s.day > to) continue;
    for (const e of s.exercises) {
      const n = doneSets(e).filter(isHard).length;
      if (!n) continue;
      for (const [k, c] of Object.entries(fine ? setCredits(e) : groupCredits(e))) if (k in out) out[k] += n * c;
    }
  }
  return out;
}
/** Planned sets per fine muscle for a list of plan items (sets × credit). */
export function plannedByMuscle(items) {
  const out = {};
  for (const it of items || []) for (const [m, c] of Object.entries(setCredits(it))) out[m] = (out[m] || 0) + (+it.sets || 0) * c;
  return out;
}
/** 'under' (< MEV) | 'in' | 'high' (> MAV) | 'over' (> MRV) */
export function landmarkStatus(count, lm) {
  if (count < lm.mev) return 'under';
  if (count > lm.mrv) return 'over';
  if (count > lm.mav) return 'high';
  return 'in';
}

// ── deload ──────────────────────────────────────────────────
export const DELOAD_DAYS = 7;
export function deloadActive(deload, today) {
  if (!deload || !deload.active || !deload.start) return false;
  try { const d = diffDays(deload.start, today); return d >= 0 && d < DELOAD_DAYS; } catch { return false; }
}

/**
 * Suggest a deload (never forced). Reasons:
 *  'weeks'  — ≥ 6 weeks of training since the last deload (or since the first session);
 *  'stall'  — the top e1RM of ≥ 2 compound lifts has not risen over their last 3 exposures;
 *  'effort' — average logged RIR over the last 14 days ≤ 0.5 across ≥ 12 sets.
 * Not suggested within 28 days after a deload started.
 */
export function deloadCheck(sessions, { today, deload } = {}) {
  const fin = finished(sessions).filter((s) => s.day);
  if (!fin.length || !today) return { suggest: false, reason: null };
  if (deloadActive(deload, today)) return { suggest: false, reason: null };
  if (deload?.start) { try { if (diffDays(deload.start, today) < 28) return { suggest: false, reason: null }; } catch { /* ignore */ } }
  const since = deload?.start && deload.start > fin[0].day ? deload.start : fin[0].day;
  const span = diffDays(since, today);
  // stall
  const seen = new Map();
  for (let i = fin.length - 1; i >= 0; i--) {
    for (const e of fin[i].exercises) {
      if (kindOf(e) !== 'compound') continue;
      const best = bestE1rmOf(e);
      if (!best) continue;
      const k = exKey(e);
      const arr = seen.get(k) || [];
      if (arr.length < 3) { arr.push(best); seen.set(k, arr); }
    }
  }
  let stalled = 0;
  for (const arr of seen.values()) if (arr.length === 3 && arr[0] <= arr[1] && arr[1] <= arr[2]) stalled++; // newest first, not rising
  if (stalled >= 2) return { suggest: true, reason: 'stall', stalled };
  // effort
  const from = addDays(today, -13);
  const rirs = [];
  for (const s of fin) if (s.day >= from) for (const e of s.exercises) for (const t of doneSets(e)) if (t.rir !== null && t.rir !== undefined) rirs.push(+t.rir);
  if (rirs.length >= 12 && rirs.reduce((a, b) => a + b, 0) / rirs.length <= 0.5) return { suggest: true, reason: 'effort' };
  if (span >= 42) return { suggest: true, reason: 'weeks', weeks: Math.floor(span / 7) };
  return { suggest: false, reason: null };
}

// ── weekly consistency (weeks on plan + flex weeks) ─────────
/**
 * A week is on plan when finished sessions ≥ planned − 1. One flex week is earned per 8 on-plan weeks
 * (max 2 banked) and is applied automatically to an off-plan week. The current week only adds, never breaks.
 * Returns {weeks, bank, flexUsed, thisWeek, planned}.
 */
export function weeksOnPlan(sessions, { plannedPerWeek = 4, weekStartDow = 1, today } = {}) {
  const planned = Math.max(1, plannedPerWeek | 0);
  const need = Math.max(1, planned - 1);
  const days = finished(sessions).map((s) => s.day).filter(Boolean);
  const cur = weekStart(today, weekStartDow);
  const count = new Map();
  for (const d of days) { const w = weekStart(d, weekStartDow); count.set(w, (count.get(w) || 0) + 1); }
  const thisWeek = count.get(cur) || 0;
  if (!days.length) return { weeks: 0, bank: 0, flexUsed: 0, thisWeek, planned };
  let w = weekStart(days.reduce((a, b) => (a < b ? a : b)), weekStartDow);
  let streak = 0, bank = 0, flexUsed = 0, onPlan = 0;
  for (; w < cur; w = addDays(w, 7)) {
    if ((count.get(w) || 0) >= need) { streak++; onPlan++; if (onPlan % 8 === 0) bank = Math.min(2, bank + 1); }
    else if (bank > 0 && streak > 0) { bank--; flexUsed++; }
    else streak = 0;
  }
  if (thisWeek >= need) streak++;
  return { weeks: streak, bank, flexUsed, thisWeek, planned };
}

// ── programs ────────────────────────────────────────────────
/** Normalise whatever sits in programs.current (v2 own format, legacy Solo Gym days, or nothing). */
export function normalizeProgram(rec) {
  if (rec && rec.v === 2 && rec.days && Array.isArray(rec.order) && rec.order.length) {
    const days = {};
    for (const id of rec.order) if (rec.days[id]) days[id] = normDay(rec.days[id], id);
    const order = rec.order.filter((id) => days[id]);
    if (order.length) {
      const out = { v: 2, activeProgram: rec.activeProgram || 'custom', order, days };
      if (rec.schedule && typeof rec.schedule === 'object' && !Array.isArray(rec.schedule)) out.schedule = Object.fromEntries(Object.entries(rec.schedule).filter(([d, id]) => /^[0-6]$/.test(d) && days[id]));
      if (rec.startDay && /^\d{4}-\d{2}-\d{2}$/.test(rec.startDay)) out.startDay = rec.startDay;
      if (Number.isInteger(rec.tv) && rec.tv > 0) out.tv = rec.tv;
      return out;
    }
  }
  if (rec && rec.days && typeof rec.days === 'object' && !Array.isArray(rec.days)) {
    const days = {}; const order = [];
    for (const [id, d] of Object.entries(rec.days)) {
      if (!d || !Array.isArray(d.exercises)) continue;
      const items = d.exercises.filter((e) => e && !e.isWarmup).map((e) => normItem({ id: e.id, name: e.name, muscle: e.muscle, sets: e.sets, reps: e.reps, w: e.lastW })).filter(Boolean);
      if (!items.length) continue;
      days[id] = { name: String(d.name || id).slice(0, 40), items }; order.push(id);
    }
    if (order.length) return { v: 2, activeProgram: 'imported', order, days };
  }
  return fromTemplate(DEFAULT_PROGRAM);
}

function normDay(d, id) {
  const out = { name: String(d.name || id), items: (d.items || []).map(normItem).filter(Boolean) };
  if (Array.isArray(d.warm)) { const w = d.warm.filter((x) => Array.isArray(x) && x.length === 2 && x.every((v) => Number.isFinite(+v))).slice(0, 5).map(([a, b]) => [+a, +b]); if (w.length) out.warm = w; }
  if (d.warmNote) out.warmNote = String(d.warmNote).slice(0, 160);
  return out;
}

function normItem(e) {
  if (!e || (e.id === undefined && !e.name && !e.lib)) return null;
  const L = (e.lib && libById(e.lib)) || findLib(e.en || e.name);
  const sets = Math.max(1, Math.min(10, Math.round(+e.sets || 3)));
  return {
    id: String(e.id ?? (L ? L.id : enKey(e.name))),
    lib: L ? L.id : (e.lib || null),
    ar: L ? L.ar : String(e.ar || e.name || '').split('·')[0].trim().slice(0, 80),
    en: L ? L.en : String(e.en || e.name || '').split('·')[0].trim().slice(0, 80),
    muscle: String(e.muscle || (L && L.muscle) || '').slice(0, 30),
    kind: e.kind === 'compound' || e.kind === 'isolation' ? e.kind : (L ? L.kind : kindOf(e)),
    sets,
    reps: String(e.reps ?? '8-12').slice(0, 20),
    ...(Number.isFinite(+e.w) && +e.w > 0 ? { w: +e.w } : {}),
    ...(e.ss && /^[A-Z]$/.test(String(e.ss)) ? { ss: String(e.ss) } : {}),
    ...(+e.restS >= 15 && +e.restS <= 600 ? { restS: Math.round(+e.restS) } : {}),
    ...(e.rir && /^\d(-\d)?$/.test(String(e.rir)) ? { rir: String(e.rir) } : {}),
    ...(e.fill === true && e.ss ? { fill: true } : {}),
    ...(e.note ? { note: String(e.note).slice(0, 160) } : {}),
    ...(e.r1 && parseReps(e.r1) ? { r1: String(e.r1).slice(0, 20) } : {}),
  };
}

export function fromTemplate(id, { startDay = null } = {}) {
  const t = PROGRAMS[id] || PROGRAMS[DEFAULT_PROGRAM];
  const p = { v: 2, activeProgram: t.id, order: [...t.order], days: Object.fromEntries(t.order.map((d) => [d, normDay(t.days[d], d)])) };
  if (t.schedule) p.schedule = Object.fromEntries(Object.entries(t.schedule).map(([k, v]) => [String(k), v]));
  if (startDay) p.startDay = startDay;
  if (t.version) p.tv = t.version;
  return p;
}
/**
 * Template flags for a program record: z2 after lifting, mesocycle, and the weekly cardio day (core/schema cardioDayOf):
 * heartDow = its weekday, cardio = 'boxing' (ul4c v3, Thursday) | 'heart' (ul4c v1–v2, Saturday) | null.
 */
export const programFlags = (program) => {
  const t = PROGRAMS[program?.activeProgram];
  const c = t ? cardioDayOf(program) : null;
  return { z2: !!t?.z2, meso: !!t?.meso, heartDow: c ? c.dow : null, cardio: c ? c.kind : null, boxing: c?.kind === 'boxing' };
};

export function itemFromLib(libId) {
  const L = libById(libId);
  if (!L) return null;
  return normItem({ id: L.id, lib: L.id, sets: 3, reps: L.kind === 'compound' ? '6-10' : '10-15' });
}

/** Days since the last finished session (null when none). */
export function gapDays(sessions, today) {
  const fin = finished(sessions).filter((s) => s.day);
  if (!fin.length) return null;
  try { return diffDays(fin[fin.length - 1].day, today); } catch { return null; }
}

/** Next day: fixed weekday mapping when set (P3), otherwise rotation after the last finished session. */
export function nextDayId(program, sessions, today = null) {
  if (today && program.schedule) { try { const id = program.schedule[String(weekdayOf(today))]; if (id && program.days[id]) return id; } catch { /* ignore */ } }
  const fin = finished(sessions);
  for (let i = fin.length - 1; i >= 0; i--) {
    const k = fin[i].dayKey;
    const idx = program.order.indexOf(k);
    if (idx >= 0 && !fin[i].quick) return program.order[(idx + 1) % program.order.length];
  }
  return program.order[0];
}

/** Quick session: first 3 compound lifts of a day (fallback: first 3 items), max 3 sets each. */
export function quickItems(items) {
  const c = items.filter((x) => kindOf(x) === 'compound');
  return (c.length >= 2 ? c : items).slice(0, 3).map((x) => ({ ...x, sets: Math.min(3, x.sets) }));
}

/** Time model (review.md §3.8): seconds of work for one set. */
export const TIME = Object.freeze({ set: 45, heavy: 40, uni: 85, side: 60, transition: 25, fillTransition: 5, changeover: 60, end: 30, warmup: 270 });
export function setSeconds(it) {
  const reps = String(it?.reps || '');
  if (/رجل/.test(reps)) return TIME.uni;
  if (/جنب/.test(reps)) return TIME.side;
  const r = parseReps(reps);
  if (kindOf(it) === 'compound' && r && r.lo <= 5) return TIME.heavy;
  return TIME.set;
}
/** Consecutive items sharing a superset tag form one block; others are blocks of one. */
export function blocksOf(items) {
  const out = [];
  for (const it of items || []) {
    const last = out[out.length - 1];
    if (it.ss && last && last[0].ss === it.ss) last.push(it); else out.push([it]);
  }
  return out;
}
const blockRest = (b) => (b.length > 1 ? Math.max(...b.map((x) => +x.restS || 0)) || restFor({ kind: b.some((x) => kindOf(x) === 'compound') ? 'compound' : 'isolation' }, { superset: true }) : restFor(b[0]));
/**
 * Duration of a list of items in seconds: warm-up 4:30 + per block rounds × (sets + in-pair transitions 25 s) + rest between rounds
 * + 60 s changeover (30 s after the last block). Fill members (inside the anchor's rest) take one filler per round and eat the rest.
 */
export function estimateSeconds(items, { warmup = null } = {}) {
  const list = (items || []).filter((x) => x && +x.sets > 0 && !x.skipped);
  const blocks = blocksOf(list);
  let t = (warmup ?? list.some((x) => kindOf(x) === 'compound')) ? TIME.warmup : 0;
  blocks.forEach((b, bi) => {
    const anchors = b.filter((x) => !x.fill), fills = b.filter((x) => x.fill);
    const rounds = Math.max(...anchors.map((x) => +x.sets || 0), fills.reduce((n, x) => n + (+x.sets || 0), 0) ? 1 : 0);
    const rest = blockRest(b);
    const fillQueue = fills.flatMap((x) => Array.from({ length: +x.sets || 0 }, () => setSeconds(x)));
    for (let r = 0; r < rounds; r++) {
      const inRound = anchors.filter((x) => r < +x.sets);
      let work = inRound.reduce((a, x) => a + setSeconds(x), 0) + Math.max(0, inRound.length - 1) * TIME.transition;
      let fillT = 0;
      if (fillQueue.length) { fillT = fillQueue.shift() + 2 * TIME.fillTransition; work += fillT; }
      if (r < rounds - 1) t += work + Math.max(0, rest - fillT); else t += work;
    }
    // filler sets left over after the anchor's rounds (rare): straight sets
    for (const f of fillQueue) t += f + TIME.fillTransition;
    t += bi < blocks.length - 1 ? TIME.changeover : TIME.end;
  });
  return Math.round(t);
}
/** Session estimate in whole minutes (warm-up, supersets / tri-sets, transitions and changeovers included). */
export function estimateMinutes(items, opts) {
  return Math.max(1, Math.round(estimateSeconds(items, opts) / 60));
}

// ── rest timer (timestamp based; survives screen lock) ──────
export function startRest(ex, now = Date.now(), { superset = false, total: fixed = 0 } = {}) {
  const total = fixed > 0 ? fixed : restFor(ex, { superset });
  return { startedAt: now, endsAt: now + total * 1000, total };
}
export function restRemaining(rest, now = Date.now()) {
  if (!rest) return 0;
  return Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
}

// ── live session ────────────────────────────────────────────
/** One live exercise from a plan item + history (shared by buildLive, add exercise and swap). */
export function liveExercise(it, sessions, opts = {}) {
  const last = exposures(sessions, it, { seeds: true })[0]; // an imported baseline counts as the last exposure (prefill only)
  let p = prescribe(it, last?.ex, opts.reentry?.active ? { ...opts, lighter: false } : opts);
  if (opts.reentry?.active) p = reentryAdjust(p, opts.reentry, { item: it, sets: !it.reSets });
  const ex = {
    exId: it.id, lib: it.lib || null, name: it.ar || displayName(it), en: it.en || '', muscle: it.muscle || '', kind: kindOf(it),
    reps: it.reps, ready: p.ready, inc: p.inc, gates: p.gates, from: p.from,
    prev: last ? doneSets(last.ex).map((t) => ({ w: +t.w || 0, r: +t.r || 0, ...(t.rir !== null && t.rir !== undefined ? { rir: t.rir } : {}), ...(t.type ? { type: t.type } : {}) })) : [],
    sets: p.sets.map((t) => ({ w: t.w, r: t.r, rir: null, done: false })),
  };
  if (it.ss) ex.ss = String(it.ss).slice(0, 4);
  if (+it.restS > 0) ex.restS = +it.restS;
  if (it.fill) ex.fill = true;
  if (it.rir) ex.rir = it.rir;
  const pn = [it.planNote, it.note].filter(Boolean).join(' · ');
  if (pn) ex.planNote = pn.slice(0, 240);
  if (p.mode) ex.mode = p.mode;
  if (opts.reentry?.active) ex.rirT = reentryRir(it, opts.reentry);
  else if (Number.isInteger(opts.week)) ex.rirT = rirTarget(it, opts.week);
  const st = stallInfo(sessions, it);
  if (st.action) ex.stall = st;
  const lastNote = last?.ex?.note || (opts.notes && opts.notes[exKey(it)]) || '';
  if (lastNote) ex.lastNote = String(lastNote).slice(0, 300);
  return ex;
}

/** Build a live session from plan items + history. */
export function buildLive({ items, dayId, dayName, sessions, now = new Date(), deload = false, lighter = false, quick = false, program = null,
  readiness = null, bwDrop = 0, load = null, phase = null, home = false, bw = 0, week = null, warm = null, warmNote = '', z2 = false, plan = null, reentry = null }) {
  const re = reentry && reentry.active ? reentry : null;
  if (re) { week = null; lighter = false; }
  const opts = { deload, lighter, readiness, bwDrop, load, phase, bw, ...(Number.isInteger(week) ? { week } : {}), ...(re ? { reentry: re } : {}) };
  const exercises = items.map((it) => liveExercise(it, sessions, opts));
  // warm-up ramp for the first compound lift (W50): never counted in volume / PRs
  const first = exercises.find((e) => e.kind === 'compound');
  if (first) {
    const w = Math.max(0, ...first.sets.map((t) => +t.w || 0));
    const db = libById(first.lib)?.eq === 'دمبل';
    const ws = warmupSets(w, db ? 0 : 20, warm, db ? 2 : 2.5);
    if (ws.length) first.warm = ws.map((t) => ({ ...t, done: false }));
    if (warmNote) first.warmNote = String(warmNote).slice(0, 160);
  }
  const live = {
    id: `w:${now.getTime().toString(36)}`, status: ACTIVE, day: dayKey(now), startedAt: now.toISOString(), startedMs: now.getTime(),
    dayKey: dayId, dayName, program, quick, deload, lighter, home: !!home, readiness: Number.isFinite(readiness) ? readiness : null,
    cur: { ex: 0, set: 0 }, rest: null, exercises,
  };
  if (Number.isInteger(week)) live.week = week;
  if (re) live.reentry = { week: re.week, of: re.of, startDay: re.startDay };
  if (z2) live.z2 = { plan: true };
  if (plan) live.plan = plan;
  return live;
}

/** First not-done set at or after the given exercise; null when all done. */
export function nextOpen(live, fromEx = 0) {
  const n = live.exercises.length;
  for (let k = 0; k < n; k++) {
    const i = (fromEx + k) % n;
    const e = live.exercises[i];
    if (e.skipped) continue;
    const j = e.sets.findIndex((t) => !t.done);
    if (j >= 0) return { ex: i, set: j };
  }
  return null;
}

// ── set entry (inline editing; one set changes only itself) ──
export const LIMITS = Object.freeze({ w: 2000, r: 100 });
/** Validated value for a typed field, or null (keep the model unchanged). Weights → 0.1 kg, reps → integers. */
export function cleanField(field, v) {
  const n = +v;
  if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < 0 || n > (LIMITS[field] ?? 0)) return null;
  return field === 'w' ? round1(n) : Math.round(n);
}
/** One stepper tap: exact delta, clamped, never touches other sets. */
export function stepField(field, cur, delta) {
  const v = (+cur || 0) + delta;
  return field === 'w' ? Math.max(0, Math.min(LIMITS.w, round1(v))) : Math.max(0, Math.min(LIMITS.r, Math.round(v)));
}
/** Later, not-done sets that still carry the weight set j had before the edit (candidates for «طبّق على الباقي»). */
export function applyPeers(sets, j, fromW) {
  const nowW = +sets[j]?.w;
  if (!Number.isFinite(+fromW) || +fromW === nowW) return [];
  const out = [];
  for (let k = j + 1; k < sets.length; k++) if (!sets[k].done && +sets[k].w === +fromW) out.push(k);
  return out;
}
/** Copy set j's weight onto the given peers; returns the previous weights for Undo. */
export function applyWeight(sets, j, peers) {
  const w = +sets[j].w; const before = peers.map((k) => [k, sets[k].w]);
  for (const k of peers) sets[k].w = w;
  return before;
}
/** Remove set j; returns { removed, cur } where cur is the new current-set index in that exercise. */
export function removeSet(sets, j, curSet) {
  if (sets.length <= 1 || j < 0 || j >= sets.length) return null;
  const [removed] = sets.splice(j, 1);
  let cur = curSet;
  if (curSet > j) cur = curSet - 1;
  else if (curSet === j) { const open = sets.findIndex((t, k) => k >= j && !t.done); cur = open >= 0 ? open : Math.min(j, sets.length - 1); }
  return { removed, cur };
}
/** Swipe counts only with a clear horizontal intent (a scroll never completes a set). */
export const isSwipe = (dx, dy) => Math.abs(dx) > 80 && Math.abs(dx) > 2 * Math.abs(dy);

/** Freeze a live session into a stored record. */
export function finalize(live, history, now = new Date()) {
  const exercises = [];
  const prs = [];
  for (const e of live.exercises) {
    const sets = e.sets.filter((t) => t.done && +t.r > 0).map((t) => ({ w: +t.w || 0, r: +t.r || 0, rir: t.rir ?? null, done: true, ...(t.type && t.type !== 'normal' ? { type: t.type } : {}) }));
    if (!sets.length) continue;
    const prior = bests(history, e, { excludeId: live.id });
    const so = [];
    let pr = null;
    for (const t of sets) { const p = detectPR(t, prior, so); if (p && (!pr || p.value > pr.value || p.type === 'weight')) pr = { ...p, w: t.w, r: t.r }; so.push(t); }
    const ps = sets.filter((t) => t.type !== 'drop');
    const rec = { exId: e.exId, lib: e.lib, name: e.name, en: e.en, muscle: e.muscle, kind: e.kind, sets,
      topW: Math.max(0, ...ps.map((t) => t.w)), vol: Math.round(sets.reduce((v, t) => v + t.w * t.r, 0)), e1rm: Math.max(0, ...ps.map((t) => e1rm(t.w, t.r))) };
    if (e.note && String(e.note).trim()) rec.note = String(e.note).trim().slice(0, 300);
    if (e.ss) rec.ss = e.ss;
    if (e.swappedFrom) rec.swappedFrom = e.swappedFrom;
    if (pr) { rec.pr = pr; prs.push({ name: e.name, ...pr }); }
    exercises.push(rec);
  }
  const durationMin = Math.max(1, Math.round((now.getTime() - (live.startedMs || Date.parse(live.startedAt) || now.getTime())) / 60000));
  const rec = { id: live.id, day: live.day, startedAt: live.startedAt, finishedAt: now.toISOString(), dayKey: live.dayKey, dayName: live.dayName,
    program: live.program, quick: !!live.quick, deload: !!live.deload, durationMin, status: 'done', exercises };
  if (live.home) rec.home = true;
  if (Number.isFinite(live.readiness)) rec.readiness = live.readiness;
  if (Number.isInteger(live.week)) rec.week = live.week;
  if (live.z2 && live.z2.startedAt) rec.z2Min = Math.max(0, Math.round(((live.z2.doneAt || now.getTime()) - live.z2.startedAt) / 60000));
  if (live.plan && live.plan.budget) rec.budgetMin = live.plan.budget;
  rec.volume = sessionVolume(rec);
  rec.sets = sessionSetCount(rec);
  return { record: rec, prs };
}

/** Summary numbers for the end sheet (peak-end): vs the previous session of the same day. */
export function summarize(record, history) {
  const prev = finished(history).filter((s) => s.id !== record.id && s.dayKey && s.dayKey === record.dayKey).pop();
  const pv = prev ? sessionVolume(prev) : 0;
  return {
    sets: sessionSetCount(record), volume: sessionVolume(record), durationMin: record.durationMin,
    prevVolume: pv, deltaPct: pv ? Math.round(((sessionVolume(record) - pv) / pv) * 100) : null,
    prs: record.exercises.filter((e) => e.pr).map((e) => ({ name: e.name, ...e.pr })),
  };
}

// ══ in-set intelligence (W6-W8, W22-W30) ══════════════════════
/** Top weight per exposure (newest first), drop sets excluded. */
export function topSeries(sessions, item, n = 5, opts) {
  return exposures(sessions, item, opts).slice(0, n).map(({ session, ex }) => ({ day: session.day, w: topWOf(ex), e1rm: bestE1rmOf(ex) }));
}

/**
 * Performance velocity from the last 2 exposures (Solo Gym VELOCITY):
 * 'fatigue_drop' when reps fell while effort rose (RIR fell); 'improving' when reps, top weight or e1RM rose; else 'stable'.
 */
export function velocity(sessions, item, opts) {
  const h = exposures(sessions, item, opts);
  if (h.length < 2) return 'stable';
  const [a, b] = [h[0].ex, h[1].ex]; // a = newest
  const avg = (ex, k) => { const v = prSets(ex).filter((t) => t[k] !== null && t[k] !== undefined).map((t) => +t[k]); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const ra = avg(a, 'r'), rb = avg(b, 'r'), ia = avg(a, 'rir'), ib = avg(b, 'rir');
  if (ra !== null && rb !== null && ra < rb && ia !== null && ib !== null && ia < ib) return 'fatigue_drop';
  if ((ra !== null && rb !== null && ra > rb) || topWOf(a) > topWOf(b) || bestE1rmOf(a) > bestE1rmOf(b)) return 'improving';
  return 'stable';
}
export const VELOCITY_LABEL = Object.freeze({ improving: 'بيتحسّن', stable: 'ثابت', fatigue_drop: 'علامة تعب: عدّات أقل بمجهود أعلى' });

/**
 * Progressive-overload recommendation (Solo Gym OE.getRecommendation) from the last tops (newest first):
 * 4 equal tops → 'deload' at 90% (rounded to 2.5, or 1 under 20 kg); 3 equal → 'plateau' (+inc + 3 breaker protocols);
 * newest > previous → 'progressing' (+inc); otherwise 'stable'. 'new' without history.
 */
export function recommend(sessions, item, opts) {
  const tops = topSeries(sessions, item, 5, opts).map((t) => t.w).filter((w) => w > 0);
  if (!tops.length) return { status: 'new', weight: +item?.w || 0, msg: 'أول مرة: ابدأ بوزن تقدر تعمل بيه كل العدّات بفورم نضيف.' };
  const top = tops[0];
  const step = top >= 20 ? 2.5 : 1;
  const inc = incFor(top);
  if (tops.length >= 4 && tops[0] === tops[1] && tops[1] === tops[2] && tops[2] === tops[3]) {
    const w = roundTo(top * 0.9, step);
    return { status: 'deload', weight: w, msg: `نفس الوزن 4 مرات — خفّف لـ ${fmtW(w)} كجم (90%) وابني تاني.` };
  }
  if (tops.length >= 3 && tops[0] === tops[1] && tops[1] === tops[2]) {
    const w = roundTo(top + inc, step);
    return { status: 'plateau', weight: w, msg: `ثبات 3 مرات على ${fmtW(top)} كجم — جرّب ${fmtW(w)} كجم أو بروتوكول كسر الثبات.`, protocols: PLATEAU_PROTOCOLS.slice(0, 3) };
  }
  if (tops.length >= 2 && tops[0] > tops[1]) {
    const w = roundTo(top + inc, step);
    return { status: 'progressing', weight: w, msg: `بتتقدّم: الهدف الجاي ${fmtW(w)} كجم.` };
  }
  return { status: 'stable', weight: top, msg: 'ثبّت الوزن وزوّد العدّات لحد أعلى المدى.' };
}
export const REC_LABEL = Object.freeze({ new: 'جديد', stable: 'ثابت', progressing: 'بيتقدّم', ready: 'جاهز تزوّد', plateau: 'ثبات', deload: 'خفّف 90%' });

/** Intra-session fatigue (Solo Gym getIntraFatigue): weight −10% or reps −30% from the first to the last done set. */
export function intraFatigue(sets) {
  const d = (sets || []).filter((t) => t && t.done && +t.r > 0 && t.type !== 'drop');
  if (d.length < 2) return null;
  const f = d[0], l = d[d.length - 1];
  if (+f.w > 0 && (+f.w - +l.w) / +f.w > 0.1) return { type: 'weight', pct: Math.round(((+f.w - +l.w) / +f.w) * 100) };
  const drop = (+f.r - +l.r) / +f.r;
  if (drop >= 0.3) return { type: 'reps', pct: Math.round(drop * 100) };
  return null;
}

/** Best e1RM over the last n exposures (Solo Gym suggestRPE uses the last 15). */
export function recentBestE1rm(sessions, item, n = 15, opts) {
  return exposures(sessions, item, opts).slice(0, n).reduce((m, { ex }) => Math.max(m, bestE1rmOf(ex)), 0);
}
/**
 * Estimated RIR for a set from the best recent e1RM, using the O'Conner relation 1RM = w × (1 + 0.025 × reps):
 * reps possible at w = (best / w − 1) / 0.025, RIR = that − reps done, clamped 0..5. 100 × 8 with best 125 → 2.
 */
export function estimateRir(w, r, best) {
  w = +w; r = +r; best = +best;
  if (!(w > 0) || !(r > 0) || !(best > 0)) return null;
  const max = (best / w - 1) / 0.025;
  return Math.max(0, Math.min(5, Math.round(max - r)));
}
/** RIR zone guidance (Solo Gym ZONES), shown after a pick. */
export const RIR_ZONES = Object.freeze([
  { rir: 0, label: 'فشل', tone: 'stop', msg: 'وصلت الفشل — متزوّدش عدّات، وخُد راحتك كاملة' },
  { rir: 1, label: 'صعب جدًا', tone: 'hold', msg: 'شغّال على الحد — حافظ على الوزن' },
  { rir: 2, label: 'مثالي', tone: 'good', msg: 'المنطقة المثالية — زوّد عدّة الجلسة الجاية' },
  { rir: 3, label: 'فاضل شوية', tone: 'add', msg: 'سهل نسبيًا — زوّد عدّة دلوقتي أو وزن' },
  { rir: 4, label: 'خفيف', tone: 'easy', msg: 'خفيف — زوّد الوزن الجلسة الجاية' },
]);
export const rirZone = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : RIR_ZONES[Math.max(0, Math.min(4, Math.round(+v)))]);

/** Reason line for today's prefill (W29). */
export function prefillReason(ex) {
  if (!ex) return '';
  if (ex.gates && ex.gates.length) return GATES[ex.gates[0]];
  if (ex.ready) return `كمّلت كل العدّات المرة اللي فاتت · زوّدنا ${fmtW(ex.inc)} كجم`;
  if (ex.from === 'last' && ex.prev && ex.prev.length) return `من الجلسة اللي فاتت: ${ex.prev.map((t) => `${fmtW(t.w)}×${t.r}`).join('، ')} — نفس الوزن، حاول توصل لأعلى المدى`;
  return '';
}

// ══ warm-up + mobility (W50, W51) ═════════════════════════════
/** Warm-up ramp for a working weight: > 60 kg → 40/60/80%, otherwise 50/75%; rounded to 2.5, ≥ empty bar, < working weight. */
export function warmupSets(working, bar = 20, plan = null, step = 2.5) {
  const w = +working;
  if (!(w > 0) || (bar > 0 && !(w >= bar))) return [];
  const ramp = Array.isArray(plan) && plan.length ? plan : (w > 60 ? [[40, 10], [60, 5], [80, 3]] : [[50, 8], [75, 4]]);
  return ramp.map(([pct, r]) => ({ pct, w: pct === 0 ? bar : roundTo((w * pct) / 100, step), r }))
    .filter((t) => t.w > 0 && t.w >= bar && t.w < w);
}
/** Mobility prep for the first compound of the day (Solo Gym getSmartWarmup). */
export function mobilityFor(items) {
  const first = (items || []).find((x) => kindOf(x) === 'compound') || (items || [])[0];
  const m = String(first?.muscle || '');
  const keys = Object.keys(MOBILITY_PREP).sort((a, b) => b.length - a.length);
  const k = keys.find((key) => m.includes(key)) || (muscleGroup(m) === 'رجلين' ? 'رجل' : muscleGroup(m) === 'أكتاف' ? 'كتف' : null);
  return k ? [...MOBILITY_PREP[k]] : ['Joint Circles ×10/جنب', 'Dynamic Stretch ×30ث', 'Movement Prep ×10'];
}

// ══ supersets (W39-W41) ═══════════════════════════════════════
/** Indices of the exercises sharing i's superset tag (in order), or [i]. */
export function groupOf(live, i) {
  const t = live.exercises[i]?.ss;
  if (!t) return [i];
  return live.exercises.map((e, k) => (e.ss === t && !e.skipped ? k : -1)).filter((k) => k >= 0);
}
const openSet = (e) => (e && !e.skipped ? e.sets.findIndex((t) => !t.done) : -1);
/**
 * Members of i's group that take part in the current round. Fill members (done inside the anchor's rest, e.g. wrist curls on
 * calf sets 1–3, then reverse wrist curls on 4–5) join one at a time: the first fill with an open set, or i itself.
 */
export function roundMembers(live, i) {
  const g = groupOf(live, i);
  if (g.length < 2) return g;
  const ex = live.exercises;
  const fillNow = ex[i]?.fill ? i : g.find((k) => ex[k].fill && openSet(ex[k]) >= 0);
  return g.filter((k) => !ex[k].fill || k === fillNow);
}
/**
 * Where to go after a set on exercise i. Inside a superset: the next member with an open set and no rest;
 * after the last member of a round: back to the first open member with the round rest.
 * Returns {cur:{ex,set}|null, rest:'none'|'normal'|'superset'}.
 */
export function nextAfter(live, i) {
  const g = roundMembers(live, i);
  if (g.length > 1) {
    const pos = g.indexOf(i);
    for (let k = 1; k <= g.length; k++) {
      const idx = g[(pos + k) % g.length];
      const j = openSet(live.exercises[idx]);
      if (j < 0) continue;
      const wrapped = (pos + k) >= g.length;
      return { cur: { ex: idx, set: j }, rest: wrapped ? 'superset' : 'none' };
    }
    const all = groupOf(live, i);
    for (const k of all) { const j = openSet(live.exercises[k]); if (j >= 0) return { cur: { ex: k, set: j }, rest: 'superset' }; }
    const after = nextOpen(live, all[all.length - 1] + 1 < live.exercises.length ? all[all.length - 1] + 1 : 0);
    return { cur: after, rest: after ? 'superset' : 'none' };
  }
  const nx = nextOpen(live, i);
  return { cur: nx, rest: nx ? 'normal' : 'none' };
}
/** Round rest for a group: the largest per-exercise restS in the group; else compound rule when any member is compound. */
export function groupRest(live, i) {
  const g = groupOf(live, i).map((k) => live.exercises[k]);
  const own = Math.max(0, ...g.map((e) => (+e.restS >= 15 && +e.restS <= 600 ? Math.round(+e.restS) : 0)));
  if (own) return own;
  return restFor({ kind: g.some((e) => kindOf(e) === 'compound') ? 'compound' : 'isolation' }, { superset: g.length > 1 });
}
/** Next free superset tag ('A', 'B', …) for a list of exercises/items. */
export function nextSsTag(list) {
  const used = new Set((list || []).map((x) => x && x.ss).filter(Boolean));
  for (const c of 'ABCDEFGH') if (!used.has(c)) return c;
  return 'Z';
}

// ══ swap, home mode, injuries (W35, W36, W38, W64) ════════════
const HOME_EQ = new Set(['وزن جسم', 'دمبل', 'أداة']);
/** Same-muscle alternatives from the library; preferred (swap memory) first; home mode keeps body-weight/dumbbell only. */
export function swapCandidates(item, { memory = {}, home = false, exclude = [] } = {}) {
  const L0 = (item.lib && libById(item.lib)) || findLib(item.en || item.name);
  const muscle = L0?.muscle || item.muscle || '';
  const g = muscleGroup(muscle);
  const skip = new Set([L0?.id, ...exclude].filter(Boolean));
  let alts = LIBRARY.filter((e) => !skip.has(e.id) && (e.muscle === muscle || (g && muscleGroup(e.muscle) === g)));
  alts.sort((a, b) => (b.muscle === muscle) - (a.muscle === muscle) || (b.kind === (L0?.kind || 'compound')) - (a.kind === (L0?.kind || 'compound')));
  if (home) alts = alts.filter((e) => HOME_EQ.has(e.eq));
  const pref = memory[exKey(item)] || memory[item.exId] || memory[item.id];
  if (pref) alts = [...alts.filter((e) => e.id === pref), ...alts.filter((e) => e.id !== pref)];
  return alts;
}
const JOINT = { 'ركبة': ['رجلين'], 'ركب': ['رجلين'], 'كوع': ['باي', 'تراي'], 'رسغ': ['باي', 'تراي'], 'معصم': ['باي', 'تراي'], 'ظهر سفلي': ['ظهر', 'رجلين'], 'أسفل الظهر': ['ظهر', 'رجلين'], 'رقبة': ['ظهر', 'أكتاف'] };
export const activeInjuries = (list) => (Array.isArray(list) ? list.filter((i) => i && i.active !== false && i.muscle) : []);
/** First active injury that touches this exercise's muscle (muscle group or joint map). */
export function injuryFor(ex, injuries) {
  const m = String(ex?.muscle || findLib(ex?.en || ex?.name)?.muscle || '');
  const g = muscleGroup(m);
  for (const inj of activeInjuries(injuries)) {
    const im = String(inj.muscle).trim();
    if (!im) continue;
    if (m.includes(im) || im.includes(m) || (g && muscleGroup(im) === g)) return inj;
    const j = Object.keys(JOINT).find((k) => im.includes(k));
    if (j && g && JOINT[j].includes(g)) return inj;
  }
  return null;
}

// ══ tools (T1-T3) ═════════════════════════════════════════════
export const PLATES = Object.freeze([25, 20, 15, 10, 5, 2.5, 1.25]);
/** Plates per side for a total barbell weight. 100 kg / bar 20 → [25, 15]. rest = what can't be loaded. */
export function platesFor(total, bar = 20, plates = PLATES) {
  let side = Math.round(((+total - +bar) / 2) * 100) / 100;
  if (!(side > 0)) return { perSide: [], rest: 0, bar: +bar };
  const out = [];
  for (const p of plates) while (side + 1e-9 >= p) { out.push(p); side = Math.round((side - p) * 100) / 100; }
  return { perSide: out, rest: side, bar: +bar };
}
/** %1RM load table: [% , reps target, weight rounded to 2.5]. */
export function loadTable(oneRm) {
  const rows = [[95, 2], [90, 4], [85, 6], [80, 8], [75, 10], [70, 12], [65, 15], [60, 20]];
  return +oneRm > 0 ? rows.map(([pct, r]) => ({ pct, r, w: roundTo((+oneRm * pct) / 100) })) : [];
}
/** Brzycki 1RM (second opinion shown next to Epley). */
export function brzycki(w, r) { w = +w; r = +r; if (!(w > 0) || !(r > 0) || r >= 37) return 0; return round1(r === 1 ? w : w * 36 / (37 - r)); }

// ══ live figures (W16, W17) ═══════════════════════════════════
export function liveVolume(live) {
  let v = 0;
  for (const e of live?.exercises || []) for (const t of e.sets) if (t.done && +t.r > 0) v += (+t.w || 0) * (+t.r || 0);
  return Math.round(v);
}
export function liveProgress(live) {
  let done = 0, total = 0;
  for (const e of live?.exercises || []) { if (e.skipped) { done += e.sets.filter((t) => t.done).length; total += e.sets.filter((t) => t.done).length; continue; } total += e.sets.length; done += e.sets.filter((t) => t.done).length; }
  return { done, total };
}
/** Volume of the last finished session of the same plan day (for the live Δ). */
export function lastDayVolume(sessions, dayKeyId, excludeId) {
  const prev = finished(sessions).filter((s) => s.id !== excludeId && s.dayKey && s.dayKey === dayKeyId).pop();
  return prev ? sessionVolume(prev) : 0;
}

// ══ periodization (W70, opt-in) ═══════════════════════════════
export const PHASES = Object.freeze({ volume: 'حجم', intensity: 'شدّة', peak: 'ذروة', deload: 'تخفيف' });
/** 4-week wave from a plan start date: week 1 volume, 2 intensity, 3 peak, 4 deload. */
export function phaseOf(startDay, today) {
  if (!startDay || !today) return null;
  let d; try { d = diffDays(startDay, today); } catch { return null; }
  if (d < 0) return null;
  const week = (Math.floor(d / 7) % 4) + 1;
  return { week, type: ['volume', 'intensity', 'peak', 'deload'][week - 1] };
}

// ══ body weight + readiness gates ═════════════════════════════
/** Drop of the newest weigh-in vs the average of up to 4 before it (kg, ≥ 0). Entries [{day, kg}] any order. */
export function bwDrop(entries) {
  const e = (entries || []).filter((x) => x && +x.kg > 0 && x.day).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (e.length < 3) return 0;
  const recent = +e[e.length - 1].kg;
  const prev = e.slice(-5, -1);
  const avg = prev.reduce((s, x) => s + +x.kg, 0) / prev.length;
  return Math.max(0, round1(avg - recent));
}
/** Readiness 0-100 from a daily record (wellness.score, or the 1-5 Today chip mapped to 0-100). */
export function readinessOf(daily) {
  const s = daily?.wellness?.score;
  if (Number.isFinite(+s) && s !== null && s !== '') return Math.max(0, Math.min(100, +s));
  const r = +daily?.readiness;
  if (r >= 1 && r <= 5) return (r - 1) * 25;
  return null;
}

// ══ analytics helpers (contract for WP-Analytics, read-only) ══
/** Best set per exposure, oldest → newest: [{day, e1rm, w, r}]. */
export function e1rmSeries(sessions, item) {
  return exposures(sessions, item).reverse().map(({ session, ex }) => {
    const top = prSets(ex).reduce((b, t) => (e1rm(t.w, t.r) > e1rm(b.w, b.r) ? t : b), { w: 0, r: 0 });
    return { day: session.day, e1rm: e1rm(top.w, top.r), w: +top.w || 0, r: +top.r || 0 };
  }).filter((p) => p.e1rm > 0);
}
/** Every PR event across history (first exposure is a baseline), sorted by day: [{day, key, name, type, value, w, r, delta}]. */
export function prList(sessions) {
  const best = new Map(); const out = [];
  for (const s of finished(sessions)) {
    for (const e of s.exercises) {
      const k = exKey(e);
      const prior = best.get(k);
      const so = [];
      let pr = null;
      for (const t of prSets(e)) {
        if (prior) { const p = detectPR(t, prior, so); if (p && (!pr || p.type === 'weight' || p.value > pr.value)) pr = { ...p, w: +t.w, r: +t.r }; }
        so.push(t);
      }
      const b = { e1rm: Math.max(prior?.e1rm || 0, bestE1rmOf(e)), w: Math.max(prior?.w || 0, topWOf(e)) };
      if (b.e1rm > 0 || b.w > 0) best.set(k, b);
      if (pr) out.push({ day: s.day, key: k, name: displayName(e), ...pr });
    }
  }
  return out.sort((a, b) => String(a.day).localeCompare(String(b.day)));
}
/** e1RM change in kg per week (least squares over the last 8 exposures); null with < 2 points or < 7 days span. */
export function progressRate(sessions, item) {
  const pts = e1rmSeries(sessions, item).slice(-8);
  if (pts.length < 2) return null;
  const x = pts.map((p) => diffDays(pts[0].day, p.day)), y = pts.map((p) => p.e1rm);
  if (x[x.length - 1] < 7) return null;
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  return den ? round1((num / den) * 7) : null;
}
/**
 * Acute:chronic training load from session volume. acute = last 7 days, chronic = weekly average of the last 28 days.
 * level: 'high' (> 1.3), 'low' (< 0.8), 'normal', or 'unknown' with < 14 days of history.
 */
export function trainingLoad(sessions, today) {
  const fin = finished(sessions).filter((s) => s.day && s.day <= today);
  const a0 = addDays(today, -6), c0 = addDays(today, -27);
  let acute = 0, chronic = 0;
  for (const s of fin) { const v = sessionVolume(s); if (s.day >= a0) acute += v; if (s.day >= c0) chronic += v; }
  chronic = Math.round(chronic / 4);
  const span = fin.length ? diffDays(fin[0].day, today) : 0;
  const ratio = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null;
  const level = span < 14 || ratio === null ? 'unknown' : ratio > 1.3 ? 'high' : ratio < 0.8 ? 'low' : 'normal';
  return { acute, chronic, ratio, level };
}
/** Muscle group with the least volume in the last 10 sessions when < 60% of the top group (Solo Gym laggingMuscle). */
export function laggingMuscle(sessions) {
  const m = {};
  for (const s of finished(sessions).slice(-10)) for (const e of s.exercises) {
    const g = muscleGroup(e.muscle || findLib(e.en || e.name)?.muscle);
    if (!g) continue;
    m[g] = (m[g] || 0) + doneSets(e).reduce((v, t) => v + (+t.w || 0) * (+t.r || 1), 0);
  }
  const a = Object.entries(m).sort((x, y) => x[1] - y[1]);
  if (a.length < 2) return null;
  return a[a.length - 1][1] > 0 && a[0][1] / a[a.length - 1][1] < 0.6 ? a[0][0] : null;
}
const STD = { bench: [0.5, 0.75, 1, 1.25, 1.5], squat: [0.75, 1, 1.25, 1.75, 2.25], deadlift: [1, 1.25, 1.5, 2, 2.5], ohp: [0.35, 0.5, 0.65, 0.85, 1.05], row: [0.5, 0.65, 0.85, 1.05, 1.3] };
export const LEVELS = Object.freeze(['مبتدئ', 'مبتدئ متقدّم', 'متوسط', 'متقدّم', 'نخبة']);
/** Strength level from e1RM / body weight (common bodyweight-ratio standards). {ratio, level, idx, next} (next = kg for the next level). */
export function strengthLevel(e1rmKg, bw, lift) {
  const s = STD[lift]; e1rmKg = +e1rmKg; bw = +bw;
  if (!s || !(e1rmKg > 0) || !(bw > 0)) return null;
  const ratio = Math.round((e1rmKg / bw) * 100) / 100;
  let idx = -1; for (let i = 0; i < s.length; i++) if (ratio >= s[i]) idx = i;
  idx = Math.max(0, idx);
  const next = idx < s.length - 1 ? roundTo(s[idx + 1] * bw) : null;
  return { ratio, level: LEVELS[idx], idx, next };
}
/** Classic Wilks score. sex 'm' | 'f'. */
export function wilks(total, bw, sex = 'm') {
  total = +total; const x = +bw;
  if (!(total > 0) || !(x > 0)) return 0;
  const c = sex === 'f' ? [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-05, -9.054e-08]
    : [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-06, -1.291e-08];
  const den = c[0] + c[1] * x + c[2] * x ** 2 + c[3] * x ** 3 + c[4] * x ** 4 + c[5] * x ** 5;
  return round1((total * 500) / den);
}
/** Map a library entry / exercise to a main lift for strengthLevel. */
export function liftOf(ex) {
  const id = ((ex?.lib && libById(ex.lib)) || findLib(ex?.en || ex?.name))?.id;
  return { ex1: 'bench', ex41: 'squat', ex11: 'deadlift', ex21: 'ohp', ex13: 'row' }[id] || null;
}

// ══ decision journal (W28) ════════════════════════════════════
/** Journal entries after a session: one {date, action, weight, msg} per exercise, newest first, max 10 per key. */
export function journalAfter(journal, record, history) {
  const j = { ...(journal || {}) };
  for (const e of record.exercises || []) {
    const k = exKey(e);
    const rec = recommend(history, e);
    const entry = { date: record.day, action: rec.status, weight: rec.weight, msg: rec.msg };
    const list = Array.isArray(j[k]) ? j[k].filter((x) => x && x.date !== record.day) : [];
    j[k] = [entry, ...list].slice(0, 10);
  }
  return j;
}
export const journalFor = (journal, ex) => {
  const a = journal?.[exKey(ex)] || journal?.[ex?.exId] || journal?.[ex?.id];
  return Array.isArray(a) ? a.slice(0, 5) : [];
};

// ══ recovery (R1-R5) ══════════════════════════════════════════
/** Flat list of stretch phases from the 6 stations: [{si, name, tip, side, dur, breathe}]. */
export const RECOVERY_PHASES = Object.freeze(STATIONS.flatMap((s, si) => s.ph.map(([side, dur]) => ({ si, name: s.n, tip: s.t, side, dur, breathe: !!s.breathe }))));
export const RECOVERY_TOTAL = RECOVERY_PHASES.reduce((a, p) => a + p.dur, 0);
export const CARDIO_SECS = 18 * 60;
/** Recovery record for the sessions store. Not a lifting session (finished() ignores it). */
export function recoveryRecord({ now = new Date(), mode = 'stretch', seconds = RECOVERY_TOTAL } = {}) {
  return { id: `r:${now.getTime().toString(36)}`, kind: 'recovery', mode, day: dayKey(now), startedAt: new Date(now.getTime() - seconds * 1000).toISOString(),
    finishedAt: now.toISOString(), durationMin: Math.max(1, Math.round(seconds / 60)), status: 'done' };
}
/** Stretch list after training by day type (Solo Gym getDayType). */
export function stretchTypeOf(record) {
  const k = String(record?.dayKey || record?.dayName || '').toLowerCase();
  if (/push|upper|fba/.test(k)) return 'push';
  if (/pull|fbb/.test(k)) return 'pull';
  if (/leg|lower|fbc/.test(k)) return 'leg';
  return 'default';
}

// ══ share (W58) ═══════════════════════════════════════════════
export function shareText(record) {
  const lines = [`${record.dayName || 'تمرين'} · ${record.day}`];
  for (const e of record.exercises || []) {
    const top = prSets(e).reduce((b, t) => (e1rm(t.w, t.r) > e1rm(b.w, b.r) ? t : b), { w: 0, r: 0 });
    lines.push(`${displayName(e)}: ${doneSets(e).length} مجموعات · أعلى ${fmtW(top.w)}×${top.r}${e.pr ? ' · رقم شخصي' : ''}`);
  }
  lines.push(`الحجم ${fmtInt(sessionVolume(record))} كجم · ${record.durationMin || 0} دقيقة`);
  return lines.join('\n');
}

// ══ 6-week mesocycle (hypertrophy.md §4.2, review.md M7) ═══════════
export const MESO_WEEKS = 6;
/** Week 1–6 of the block from the plan start date (repeats every 6 weeks); null without a start date or before it. */
export function mesoWeek(startDay, today) {
  if (!startDay || !today) return null;
  let d; try { d = diffDays(startDay, today); } catch { return null; }
  if (d < 0) return null;
  return (Math.floor(d / 7) % MESO_WEEKS) + 1;
}
const FREE_EQ = new Set(['بار', 'دمبل', 'وزن جسم']);
/**
 * Target RIR for an item in week w (review.md §3.1 + M7): compounds 3 / 2 / 2 / 1–2 / week 5: free weights 1–2 (never 0),
 * machines 1 / deload 4+; isolations 2 / 1 / 1 / 0–1 / week 5: only the LAST set to 0 (others 1) / deload 3+.
 * setIdx / nSets pick the last set in week 5. → {lo, hi, deload?}
 */
export function rirTarget(item, week, setIdx = null, nSets = null) {
  const t = rirByKind(item, week, setIdx, nSets);
  // The template's own RIR is a floor (review §3.2–3.5): core moves (ab wheel, hanging leg raise, cable crunch, woodchop)
  // are RIR 1–2 and never go to failure, even though they are isolations. Deload targets stay as they are.
  const own = /^(\d)(?:-(\d))?$/.exec(String(item?.rir ?? ''));
  if (own && !t.deload) {
    const lo = +own[1], hi = Math.max(lo, +(own[2] ?? own[1]));
    if (t.lo < lo) return { lo, hi };
  }
  return t;
}
function rirByKind(item, week, setIdx, nSets) {
  const w = Math.max(1, Math.min(MESO_WEEKS, +week || 1));
  const iso = kindOf(item) === 'isolation';
  const L = item && ((item.lib && libById(item.lib)) || findLib(item.en || item.name));
  const free = L ? FREE_EQ.has(L.eq) : true;
  if (w === 6) return iso ? { lo: 3, hi: 3, deload: true } : { lo: 4, hi: 4, deload: true };
  if (!iso) return [null, { lo: 3, hi: 3 }, { lo: 2, hi: 2 }, { lo: 2, hi: 2 }, { lo: 1, hi: 2 }, free ? { lo: 1, hi: 2 } : { lo: 1, hi: 1 }][w];
  if (w === 5) {
    const n = +nSets || +item?.sets || 0;
    if (setIdx === null || setIdx === undefined) return { lo: 0, hi: 1, lastToFailure: true };
    return setIdx >= n - 1 ? { lo: 0, hi: 0 } : { lo: 1, hi: 1 };
  }
  return [null, { lo: 2, hi: 2 }, { lo: 1, hi: 1 }, { lo: 1, hi: 1 }, { lo: 0, hi: 1 }][w];
}
/** «سيب 2 عدّات» / «سيب 1–2 عدّة» / «آخر مجموعة للفشل» for a target. */
export function rirPhrase(t) {
  if (!t) return '';
  if (t.deload) return `سيب ${t.lo}+ عدّات`;
  if (t.lo === 0 && t.hi === 0) return 'المجموعة دي للفشل';
  if (t.lastToFailure) return 'سيب عدّة، وآخر مجموعة للفشل';
  const x = t.lo === t.hi ? String(t.lo) : `${t.lo}–${t.hi}`;
  return `سيب ${x} ${t.hi <= 1 && t.lo === t.hi ? 'عدّة' : 'عدّات'}`;
}
export const MESO_LABEL = Object.freeze(['', 'بداية', 'بناء', 'بناء', 'تقريب', 'ذروة', 'تخفيف']);
/** Block number (1, 2, …) of the 6-week mesocycle from the plan start date; null without a start date or before it. */
export function mesoBlock(startDay, today) {
  if (!startDay || !today) return null;
  let d; try { d = diffDays(startDay, today); } catch { return null; }
  if (d < 0) return null;
  return Math.floor(d / (7 * MESO_WEEKS)) + 1;
}

// ══ re-entry after a break (growth-assessment.md §0.4) ═══════════
/**
 * Two ramp weeks before the 6-week block after a long break (repeated-bout effect; Bickel 2011: low volume regrows
 * previously trained muscle). Week 1: ~55% of the sets, RIR 4 compounds / 3 isolations, ~80% of the last logged load.
 * Week 2: ~75%, RIR 3 / 2, ~90%. No intervals on the Heart Day. The 6-week block starts the day after.
 */
export const REENTRY = Object.freeze({
  1: Object.freeze({ sets: 0.55, load: 0.8, rir: { compound: 4, isolation: 3 }, gate: 'reentry' }),
  2: Object.freeze({ sets: 0.75, load: 0.9, rir: { compound: 3, isolation: 2 }, gate: 'reentry2' }),
});
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The stored setting `wk.reentry = {startDay, weeks}` from ctx.settings, ctx, a plain settings object or the value itself. */
export function reentrySetting(src) {
  if (!src) return null;
  let v = null;
  try {
    if (typeof src.get === 'function') v = src.get('wk.reentry');
    else if (src.settings && typeof src.settings.get === 'function') v = src.settings.get('wk.reentry');
    else if (src['wk.reentry'] !== undefined) v = src['wk.reentry'];
    else if (src.startDay) v = src;
  } catch { v = null; }
  if (!v || typeof v !== 'object' || !DAY_RE.test(String(v.startDay || ''))) return null;
  return { startDay: v.startDay, weeks: Math.max(1, Math.min(4, Math.round(+v.weeks || 2))) };
}
/**
 * reentryInfo(settings, day) → null (never set) | {active, week (1..weeks), of, startDay, endDay (first block day), daysLeft}.
 * active is false before the start day and from endDay on (then the 6-week block runs from endDay).
 */
export function reentryInfo(settings, day) {
  const r = reentrySetting(settings);
  if (!r || !day) return null;
  let d; try { d = diffDays(r.startDay, day); } catch { return null; }
  const endDay = addDays(r.startDay, r.weeks * 7);
  const active = d >= 0 && d < r.weeks * 7;
  return { active, week: active ? Math.floor(d / 7) + 1 : null, of: r.weeks, startDay: r.startDay, endDay, daysLeft: active ? r.weeks * 7 - d : 0 };
}
/** For heart.js / Today: re-entry running on that date (no intervals then). Accepts ctx, ctx.settings or a settings object. */
export const isReentry = (settings, day) => !!reentryInfo(settings, day)?.active;
/** Start of the 6-week block: the plan start date, moved to the end of the re-entry weeks when those end later. */
export function blockStart(startDay, reentry) {
  const end = reentry && reentry.endDay;
  if (!end) return startDay || null;
  return !startDay || String(startDay) < end ? end : startDay;
}
const reCfg = (info) => REENTRY[Math.max(1, Math.min(2, +info?.week || 1))];
/** Sets in a re-entry week: round(n × share), min 1. Dropping from the end keeps the first (best) sets. */
export const reentrySets = (n, info) => Math.max(1, Math.round((+n || 0) * reCfg(info).sets));
/** Re-entry RIR target for an item: {lo, hi, reentry:true}. */
export function reentryRir(item, info) {
  const v = reCfg(info).rir[kindOf(item) === 'isolation' ? 'isolation' : 'compound'];
  return { lo: v, hi: v, reentry: true };
}
const reLoad = (w, f) => { w = +w || 0; if (!w) return 0; const x = w * f; return x >= 20 ? roundTo(x) : Math.max(1, Math.round(x)); };
/**
 * Load step of the equipment for a weight: barbell 2.5; dumbbells 2.5 when the pair he uses is on a 2.5 grid (17.5, 22.5 …),
 * else 2 (1 under 10 kg); cable / machine 2.5 under 50 kg, then 5. Unknown equipment → null (old rule).
 */
export function equipStep(eq, w, base = w) {
  w = +w || 0; base = +base || 0;
  if (eq === 'بار') return 2.5;
  if (eq === 'دمبل') { if (base % 2 !== 0 && base % 2.5 === 0) return 2.5; return w < 10 ? 1 : 2; }
  if (eq === 'جهاز' || eq === 'كابل') return w < 50 ? 2.5 : 5;
  return null;
}
/** Round a load to the equipment step (min one step). Unknown equipment keeps the re-entry rule (2.5 from 20 kg, else 1). */
export function roundLoad(x, eq, base = x) {
  x = +x || 0; if (!(x > 0)) return 0;
  const st = equipStep(eq, x, base);
  if (!st) return x >= 20 ? roundTo(x) : Math.max(1, Math.round(x));
  return Math.max(st, Math.round(x / st) * st);
}
/** Re-entry load for an item: × 0.8 / 0.9 of the last load, rounded by the item's equipment (library entry) when known. */
export function reentryLoad(w, f, item = null) {
  w = +w || 0; if (!w) return 0;
  const L = item && ((item.lib && libById(item.lib)) || findLib(item.en || item.name));
  return L && equipStep(L.eq, w) ? roundLoad(w * f, L.eq, w) : reLoad(w, f);
}
/**
 * reentryAdjust(prescription, info, {item, sets}) → the prescribe() result for a re-entry week: fewer sets (last ones dropped,
 * unless the plan already cut them: sets:false), loads × 0.8 / 0.9 of the last logged, no increase, gate line, RIR target.
 */
export function reentryAdjust(prescription, info, { item = null, sets: cut = true } = {}) {
  if (!prescription || !info || info.active === false) return prescription;
  const c = reCfg(info);
  const list = prescription.sets || [];
  const k = cut ? Math.min(list.length, reentrySets(list.length, info)) : list.length;
  const out = list.slice(0, k).map((t) => ({ w: reentryLoad(t.w, c.load, item), r: t.r }));
  const gates = [c.gate, ...(prescription.gates || []).filter((g) => g !== 'readiness' && g !== 'phase' && g !== c.gate)];
  const { mode, ...rest } = prescription;
  return { ...rest, sets: out, ready: false, inc: 0, gates, hold: true, reentry: { week: info.week, of: info.of }, ...(item ? { rirT: reentryRir(item, info) } : {}) };
}
/** «رجوع · الأسبوع 1 من 2» (+ « · سيب 4 عدّات» with an item). */
export function reentryHeader(info, item = null) {
  if (!info || !info.active) return '';
  const head = `رجوع · الأسبوع ${info.week} من ${info.of}`;
  return item ? `${head} · ${rirPhrase(reentryRir(item, info))}` : head;
}
/** The session header line for exercise e: re-entry first, then the mesocycle week; '' when neither. */
export function weekLine(live, e, setIdx = null) {
  if (!live || !e) return '';
  if (live.reentry) return reentryHeader({ active: true, ...live.reentry }, e);
  if (Number.isInteger(live.week)) return `الأسبوع ${live.week} · ${rirPhrase(rirTarget(e, live.week, setIdx, e.sets?.length))}`;
  return '';
}

// ══ template updates for users already on a template («تحديث الخطة») ══
/**
 * planUpdate(program) → null | {from, to, title, changes:[{day, dayName, kind:'swap'|'set', fromName, toName, text, why, ok}]}
 * Pending when the program runs a template whose version is newer than programs.current.tv (missing tv = 1).
 */
export function planUpdate(program) {
  const t = PROGRAMS[program?.activeProgram];
  const ups = PLAN_UPDATES[program?.activeProgram];
  if (!t || !t.version || !ups) return null;
  const from = Number.isInteger(program.tv) ? program.tv : 1;
  if (from >= t.version) return null;
  const changes = [];
  let title = '';
  for (let v = from + 1; v <= t.version; v++) {
    const u = ups[v]; if (!u) continue;
    title = u.title || title;
    if (u.boxing) changes.push({ v, kind: 'info', ok: true, text: 'الخميس يوم الملاكمة: بيحل محل يوم القلب', why: u.boxing.why || '' });
    if (u.schedule) {
      // the move is always offered: «طبّق التحديث» is his explicit yes. A missing schedule means the old default.
      const hasOwn = program.schedule && Object.keys(program.schedule).length > 0;
      const custom = hasOwn && !sameSchedule(program.schedule, u.schedule.from);
      changes.push({ v, kind: 'schedule', ok: true, custom, schedule: u.schedule.to, trainingDays: u.schedule.trainingDays?.to || null, fromTd: u.schedule.trainingDays?.from || null,
        text: `الجدول: ${scheduleText(u.schedule.to, program)}`, why: custom ? 'أيامك الحالية متعدّلة بإيدك، والتحديث هيبدّلها بالجدول ده' : (u.schedule.why || '') });
    }
    for (const c of u.changes) {
      const day = program.days[c.day];
      const dayName = day?.name || t.days[c.day]?.name || c.day;
      if (c.set) {
        const it = day?.items.find((x) => x.id === c.id);
        const r = c.set.r1 ? `${String(c.set.r1).replace('-', '–')} عدّات أول 6 أسابيع (بدل ${String(it?.reps || '').replace('-', '–')})` : '';
        changes.push({ v, day: c.day, dayName, kind: 'set', id: c.id, set: c.set, fromName: it?.ar || '', toName: it?.ar || '', ok: !!it && Object.entries(c.set).some(([k, val]) => it[k] !== val), why: c.why || '', text: `${dayName}: ${it?.ar || c.id} · ${r}` });
      } else {
        const it = day?.items.find((x) => x.id === c.from);
        const nx = t.days[c.day]?.items.find((x) => x.id === c.to);
        changes.push({ v, day: c.day, dayName, kind: 'swap', from: c.from, to: c.to, fromName: it?.ar || '', toName: nx?.ar || c.to, ok: !!it && !!nx && !day.items.some((x) => x.id === c.to), why: c.why || '',
          text: `${dayName}: ${it?.ar || '—'} ← ${nx?.ar || c.to}` });
      }
    }
  }
  return { from, to: t.version, title, changes, applicable: changes.filter((c) => c.ok && c.kind !== 'info').length };
}
const DOW_AR = ['الحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const sameSchedule = (a, b) => { const x = a || {}, y = b || {}; const kx = Object.keys(x).sort(), ky = Object.keys(y).sort(); return kx.length === ky.length && kx.every((k, i) => k === ky[i] && x[k] === y[k]); };
/** «السبت Upper A · الحد Lower A · …» in week order from Saturday. */
function scheduleText(sched, program) {
  return [6, 0, 1, 2, 3, 4, 5].filter((d) => sched[d] || sched[String(d)]).map((d) => `${DOW_AR[d]} ${program?.days?.[sched[d] || sched[String(d)]]?.name || sched[d] || sched[String(d)]}`).join(' · ');
}
/**
 * Schedule migration for a ul4c record still on the old weekday layout (Mon UA · Tue LA · Thu UB · Fri LB):
 * → {schedule, trainingDays} for template v3, or null when he already moved his days (nothing to migrate) / no template.
 * trainingDays is only rewritten when the stored setting still equals the old one (or was never set).
 */
export function scheduleMigration(program, trainingDays = null) {
  const ups = PLAN_UPDATES[program?.activeProgram] || {};
  const m = Object.values(ups).map((u) => u.schedule).filter(Boolean).pop();
  if (!m || !sameSchedule(program.schedule, m.from)) return null;
  const td = Array.isArray(trainingDays) && trainingDays.length ? [...trainingDays].sort((a, b) => a - b) : null;
  const oldTd = [...(m.trainingDays?.from || [])].sort((a, b) => a - b);
  const keepTd = td && (td.length !== oldTd.length || td.some((d, i) => d !== oldTd[i]));
  return { schedule: Object.fromEntries(Object.entries(m.to).map(([k, v]) => [String(k), v])), trainingDays: keepTd ? td : [...(m.trainingDays?.to || [])].sort((a, b) => a - b) };
}
/** Apply a pending update: swaps replace the old item in place (same position), `set` patches; tv = template version. */
export function applyPlanUpdate(program) {
  const u = planUpdate(program);
  if (!u) return { program, applied: [], skipped: [] };
  const t = PROGRAMS[program.activeProgram];
  const next = { ...program, days: Object.fromEntries(Object.entries(program.days).map(([k, d]) => [k, { ...d, items: d.items.map((x) => ({ ...x })) }])) };
  const applied = [], skipped = [];
  let trainingDays = null;
  for (const c of u.changes) {
    if (c.kind === 'info') continue;
    if (c.kind === 'schedule') {
      if (!c.ok) { skipped.push(c); continue; }
      next.schedule = Object.fromEntries(Object.entries(c.schedule).map(([k, v]) => [String(k), v]));
      trainingDays = c.trainingDays ? [...c.trainingDays].sort((a, b) => a - b) : null;
      applied.push(c); continue;
    }
    const day = next.days[c.day];
    if (!c.ok || !day) { skipped.push(c); continue; }
    if (c.kind === 'set') { const it = day.items.find((x) => x.id === c.id); Object.assign(it, c.set); applied.push(c); continue; }
    const i = day.items.findIndex((x) => x.id === c.from);
    const tpl = t.days[c.day].items.find((x) => x.id === c.to);
    const old = day.items[i];
    // keep the user's own superset tag / rest / sets where he changed them from the template's old row
    day.items[i] = normItem({ ...tpl, ...(old.ss ? { ss: old.ss } : {}), ...(old.restS ? { restS: old.restS } : {}) });
    applied.push(c);
  }
  // template warm-up note changes (pull-up → pulldown ramp)
  for (let v = u.from + 1; v <= u.to; v++) for (const d of Object.keys(PLAN_UPDATES[program.activeProgram]?.[v]?.warmNote || {})) {
    if (next.days[d] && t.days[d]?.warmNote) next.days[d].warmNote = t.days[d].warmNote;
  }
  next.tv = t.version;
  return { program: next, applied, skipped, trainingDays };
}

/**
 * Pull-up gate (exercise-selection #3): a session with ≥ 3 body-weight pull-up sets of ≥ 8 reps at RIR ≥ 2 (or not logged)
 * → ready to go back to the weighted pull-up. → {ready, day} | {ready:false}
 */
export function pullupReady(sessions) {
  const fin = finished(sessions || []);
  for (let i = fin.length - 1; i >= 0; i--) {
    for (const e of fin[i].exercises || []) {
      const lib = e.lib || findLib(e.en || e.name)?.id;
      if (lib !== 'ex12' && lib !== 'exWPU') continue;
      const ok = doneSets(e).filter((t) => !(+t.w > 0) && +t.r >= 8 && (t.rir === null || t.rir === undefined || t.rir === '' || +t.rir >= 2));
      if (ok.length >= 3) return { ready: true, day: fin[i].day };
    }
  }
  return { ready: false };
}
/** Swap the pulldown slot back to the weighted pull-up (Upper A, same superset / rest). */
export function backToPullup(program) {
  const next = { ...program, days: { ...program.days } };
  const d = next.days.upperA; if (!d) return program;
  const i = d.items.findIndex((x) => x.id === 'uaLPD'); if (i < 0) return program;
  const old = d.items[i];
  const items = d.items.map((x) => ({ ...x }));
  items[i] = normItem({ id: 'ub1', lib: 'exWPU', sets: old.sets, reps: '6-10', ss: old.ss, restS: old.restS, rir: old.rir });
  next.days.upperA = { ...d, items };
  return next;
}

// ══ stall rule (hypertrophy.md §4.1) ══════════════════════════
/** Variants for the 3-session stall swap (next block); fallback: first same-muscle library alternative. */
const VARIANT = { ex1: 'ex2', ex2: 'exFDP', exFDP: 'ex2', ex45b: 'ex43', ex43: 'ex45b', ex41: 'ex45b', ex47: 'ex50', exWPU: 'ex14', ex14: 'exWPU', exCSTB: 'ex15', ex15: 'exCSTB', ex22: 'ex26', ex46: 'exMHT', exMHT: 'ex46', ex42: 'ex43', exLID: 'exFDP', exROE: 'exOCT', exOCT: 'exROE', ex32: 'ex34b' };
/**
 * Same exercise, same top load, no rep gain: counts the newest consecutive exposures that did not beat the one before.
 * 2 → 'recovery' (check sleep, calories, readiness); 3+ → 'variant' (swap to a variant next block). → {stalls, action, variant}
 */
export function stallInfo(sessions, item) {
  const h = exposures(sessions, item);
  let n = 0;
  for (let k = 0; k + 1 < h.length && n < 3; k++) {
    const a = h[k].ex, b = h[k + 1].ex;
    const repsA = prSets(a).reduce((x, t) => x + (+t.r || 0), 0), repsB = prSets(b).reduce((x, t) => x + (+t.r || 0), 0);
    if (topWOf(a) === topWOf(b) && topWOf(a) > 0 && repsA <= repsB) n++; else break;
  }
  if (n < 2) return { stalls: n, action: null, variant: null };
  if (n === 2) return { stalls: n, action: 'recovery', variant: null };
  const L0 = (item.lib && libById(item.lib)) || findLib(item.en || item.name);
  const v = (L0 && VARIANT[L0.id] && libById(VARIANT[L0.id])) || (L0 ? LIBRARY.find((e) => e.id !== L0.id && e.prime && e.prime === L0.prime && e.kind === L0.kind) : null);
  return { stalls: n, action: 'variant', variant: v ? { id: v.id, ar: v.ar } : null };
}
export function stallText(st) {
  if (!st || !st.action) return '';
  if (st.action === 'recovery') return 'نفس الوزن ونفس العدّات جلستين ورا بعض — راجع نومك وأكلك وجاهزيتك قبل ما تزوّد.';
  return `ثبات ${st.stalls} جلسات — بدّله ببديل${st.variant ? ` (${st.variant.ar})` : ''} من الدورة الجاية.`;
}

// ══ weekly muscle balance + session autopilot (product-ideas 1, 2, 5) ══
/** Plan day ids still ahead this week (after today), not done yet. Uses the weekday schedule, else the rotation order. */
export function remainingDays(program, sessions, today, { weekStartDow = 1, trainingDays = null, todayId = null } = {}) {
  const ws = weekStart(today, weekStartDow);
  const doneKeys = new Set(finished(sessions).filter((s) => s.day >= ws && s.day <= today).map((s) => s.dayKey));
  const out = [];
  if (program.schedule && Object.keys(program.schedule).length) {
    for (let d = addDays(today, 1); diffDays(ws, d) < 7; d = addDays(d, 1)) {
      const id = program.schedule[String(weekdayOf(d))];
      if (id && program.days[id] && !doneKeys.has(id) && id !== todayId) out.push(id);
    }
    return out;
  }
  let left = 7;
  if (Array.isArray(trainingDays)) { left = 0; for (let d = addDays(today, 1); diffDays(ws, d) < 7; d = addDays(d, 1)) if (trainingDays.includes(weekdayOf(d))) left++; }
  for (const id of program.order) if (!doneKeys.has(id) && id !== todayId && out.length < left) out.push(id);
  return out;
}
/**
 * Projected weekly hard sets per fine muscle = done this week + today's items + remaining planned days + pending carry-over.
 * → {done, today, rest, carry, projection} (all keyed by MUSCLE_LM muscle)
 */
export function weekProjection({ program, sessions, today, items = [], weekStartDow = 1, trainingDays = null, todayId = null, carry = {} }) {
  const ws = weekStart(today, weekStartDow);
  const done = hardSetsByMuscle(sessions, ws, today, { by: 'muscle' });
  const todayP = plannedByMuscle(items);
  const rest = {};
  for (const id of remainingDays(program, sessions, today, { weekStartDow, trainingDays, todayId })) for (const [m, v] of Object.entries(plannedByMuscle(program.days[id].items))) rest[m] = (rest[m] || 0) + v;
  const projection = {};
  for (const m of Object.keys(MUSCLE_LM)) projection[m] = (done[m] || 0) + (todayP[m] || 0) + (rest[m] || 0) + (+carry?.[m]?.n || 0);
  return { done, today: todayP, rest, projection };
}
const fmtSets = (n) => String(Math.round(n * 10) / 10);
const primeOf = (it) => fineOf(it).prime;
/** Best item to add a set to for muscle m: isolation with that prime first, then any item with that prime. */
function bestFor(items, m) {
  const c = items.filter((x) => primeOf(x) === m);
  return c.find((x) => kindOf(x) === 'isolation') || c[0] || null;
}
/**
 * Weekly balance (idea 2): carry-over sets owed to a muscle trained today come back first; then a muscle whose projected week is
 * under MEV gets +1–2 sets here. Never in a deload, never above MRV, max 6 sets per exercise. Every change has a reason line.
 * → {items, changes:[{code, text, exId, muscle, n}], consumed:{muscle:n}}
 */
export function balanceAdds({ items, projection, carry = {}, deload = false }) {
  const out = items.map((x) => ({ ...x }));
  const changes = [], consumed = {};
  if (deload) return { items: out, changes, consumed };
  const proj = { ...projection };
  const add = (it, n, m) => { const room = Math.max(0, Math.min(6 - it.sets, Math.floor((MUSCLE_LM[m]?.mrv ?? 99) - proj[m]))); const k = Math.min(n, room); if (k > 0) { it.sets += k; proj[m] += k; } return k; };
  for (const [m, c] of Object.entries(carry || {})) {
    const it = bestFor(out, m); const n = Math.min(3, +c?.n || 0);
    if (!it || !n) continue;
    proj[m] -= n; // the debt was already in the projection as pending
    const k = add(it, n, m);
    consumed[m] = n;
    if (k) { it.planNote = `+${k} ${k === 1 ? 'مجموعة' : 'مجموعات'}: متعوّضة من جلسة اتقصّرت`; changes.push({ code: 'carry', exId: it.id, muscle: m, n: k, text: `${it.ar}: +${k} (تعويض ${m})` }); }
  }
  for (const m of Object.keys(MUSCLE_LM)) {
    const lm = MUSCLE_LM[m];
    if (!lm.mev || proj[m] >= lm.mev) continue;
    const it = bestFor(out, m);
    if (!it) continue;
    const before = proj[m];
    const k = add(it, Math.min(2, Math.ceil(lm.mev - proj[m])), m);
    if (k) {
      it.planNote = `+${k} ${k === 1 ? 'مجموعة' : 'مجموعات'}: ${m} متأخر الأسبوع ده (${fmtSets(before)} من ${lm.mev})`;
      changes.push({ code: 'balance', exId: it.id, muscle: m, n: k, text: `${it.ar}: +${k} علشان ${m} تحت الحد (${fmtSets(before)} من ${lm.mev})` });
    }
  }
  return { items: out, changes, consumed };
}
const REST_FLOOR = { heavy: 90, compound: 60, isolation: 30 };
const restFloor = (b) => (b.some((x) => kindOf(x) === 'compound' && (parseReps(x.reps)?.lo ?? 9) <= 6) ? REST_FLOOR.heavy : b.some((x) => kindOf(x) === 'compound') ? REST_FLOOR.compound : REST_FLOOR.isolation);
/**
 * Session autopilot (idea 1): fit today's items into budgetMin. Cuts in a fixed order, re-estimating after each:
 * 1) tighter superset round rest (−20 s, floors heavy 90 / compound 60 / isolation 30);
 * 2) drop the last set of an isolation whose muscle is furthest above its weekly target (MAV low end), never below 2 sets;
 * 3) drop a whole isolation exercise (same order).
 * A cut that would put a muscle's projected week under MEV is carried to its next session (carry[muscle]).
 * → {items, minutes, changes:[{code,text,…}], carry:{muscle:n}, fits}
 */
export function autopilot({ items, budgetMin = 60, projection = {}, warmup = null }) {
  let list = items.map((x) => ({ ...x }));
  const changes = [], carry = {};
  const proj = { ...projection };
  const budget = budgetMin * 60;
  const est = () => estimateSeconds(list, { warmup });
  const start = est();
  if (start <= budget) return { items: list, minutes: Math.round(start / 60), changes, carry, fits: true };
  // 1) superset rest
  let saved = 0;
  for (const b of blocksOf(list)) {
    if (b.length < 2) continue;
    const cur = Math.max(...b.map((x) => +x.restS || 0)) || blockRest(b);
    const nx = Math.max(restFloor(b), cur - 20);
    if (nx < cur) { for (const x of b) x.restS = nx; saved += cur - nx; }
  }
  if (saved) changes.push({ code: 'rest', text: 'راحة أقصر بعد كل جولة سوبر سِت (حتى 20 ث أقل، من غير ما ننزل عن الحد الآمن)' });
  const surplus = (m) => (proj[m] ?? 0) - (MUSCLE_LM[m]?.mavLo ?? 0);
  const cutSets = (it, n) => {
    for (const [m, c] of Object.entries(setCredits(it))) {
      const before = proj[m] ?? 0; proj[m] = before - n * c;
      const mev = MUSCLE_LM[m]?.mev ?? 0;
      if (c === 1 && proj[m] < mev) { const owe = Math.min(n, Math.ceil(mev - proj[m])); carry[m] = (carry[m] || 0) + owe; proj[m] += owe; }
    }
  };
  const isoOrder = () => list.map((x, i) => ({ x, i })).filter(({ x }) => kindOf(x) === 'isolation')
    .sort((a, b) => surplus(primeOf(b.x)) - surplus(primeOf(a.x)) || b.i - a.i);
  // 2) last set of the isolation with the biggest weekly surplus
  while (est() > budget) {
    const c = isoOrder().find(({ x }) => x.sets > 2);
    if (!c) break;
    c.x.sets -= 1; cutSets(c.x, 1);
    const prev = changes.find((k) => k.code === 'set' && k.exId === c.x.id);
    if (prev) { prev.n += 1; prev.text = `${c.x.ar}: −${prev.n} مجموعة (${primeOf(c.x)} فوق هدفه الأسبوع ده)`; }
    else changes.push({ code: 'set', exId: c.x.id, n: 1, muscle: primeOf(c.x), text: `${c.x.ar}: −1 مجموعة (${primeOf(c.x)} فوق هدفه الأسبوع ده)` });
  }
  // 3) whole isolation exercise
  while (est() > budget) {
    const c = isoOrder()[0];
    if (!c) break;
    cutSets(c.x, c.x.sets);
    list = list.filter((x) => x !== c.x);
    changes.push({ code: 'drop', exId: c.x.id, muscle: primeOf(c.x), text: `شلنا ${c.x.ar} النهارده` });
  }
  for (const [m, n] of Object.entries(carry)) changes.push({ code: 'carried', muscle: m, n, text: `${n} ${n === 1 ? 'مجموعة' : 'مجموعات'} ${m} هتتعوّض في الجلسة الجاية اللي فيها ${m}` });
  // a superset partner left alone keeps its tag harmlessly; a lone tag is cleaned for display
  const tags = {}; for (const x of list) if (x.ss) tags[x.ss] = (tags[x.ss] || 0) + 1;
  for (const x of list) if (x.ss && tags[x.ss] < 2) { delete x.ss; delete x.fill; }
  const end = est();
  return { items: list, minutes: Math.round(end / 60), changes, carry, fits: end <= budget };
}
/** Merge a new carry-over into the ledger {muscle:{n, day}}; entries older than 7 days drop. */
export function mergeCarry(ledger, add, consumed, today) {
  const out = {};
  for (const [m, v] of Object.entries(ledger || {})) {
    if (!v || !(+v.n > 0)) continue;
    try { if (v.day && diffDays(v.day, today) > 7) continue; } catch { continue; }
    const left = +v.n - (+consumed?.[m] || 0);
    if (left > 0) out[m] = { n: left, day: v.day };
  }
  for (const [m, n] of Object.entries(add || {})) if (+n > 0) out[m] = { n: Math.min(6, (out[m]?.n || 0) + +n), day: today };
  return out;
}

/**
 * Today's plan in one call: weekly projection → balance / carry-over adds → autopilot trims for the time budget.
 * Deload weeks skip both (buildLive halves the sets). → {items, minutes, baseMinutes, changes, carryNext, projection}
 */
export function planSession({ program, sessions, today, dayId, budgetMin = 60, carry = {}, weekStartDow = 1, trainingDays = null, deload = false }) {
  const day = program.days[dayId];
  const base = day.items.map((x) => ({ ...x }));
  const baseMinutes = estimateMinutes(deload ? base.map((x) => ({ ...x, sets: Math.ceil(x.sets / 2) })) : base);
  if (deload) return { items: base, minutes: baseMinutes, baseMinutes, changes: [], carryNext: mergeCarry(carry, {}, {}, today), projection: null };
  const wp = { program, sessions, today, weekStartDow, trainingDays, todayId: dayId, carry };
  const p0 = weekProjection({ ...wp, items: base });
  const bal = balanceAdds({ items: base, projection: p0.projection, carry, deload });
  const left = Object.fromEntries(Object.entries(carry || {}).filter(([m]) => !(m in bal.consumed)));
  const p1 = weekProjection({ ...wp, items: bal.items, carry: left });
  const ap = autopilot({ items: bal.items, budgetMin, projection: p1.projection });
  return { items: ap.items, minutes: ap.minutes, baseMinutes, changes: [...bal.changes, ...ap.changes], fits: ap.fits,
    carryNext: mergeCarry(carry, ap.carry, bal.consumed, today), projection: p1.projection };
}

// ══ planned time for a day: ONE source for Today and the overview (QA r3 #6) ══
let budgetPick = { day: null, min: 60 };
/** The «معاك كام دقيقة؟» pick holds for the rest of that day (overview chips). */
export const pickBudget = (day, min) => { budgetPick = { day, min }; };
export const budgetFor = (today) => (budgetPick.day === today ? budgetPick.min : 60);
/**
 * dayEstimate → {plan (planSession result), week, deload, lift, z2, total}: lifting minutes (warm-up included, after the
 * weekly balance and the time budget) plus the Zone 2 finisher the program adds after lifting.
 */
export function dayEstimate({ program: prog0, sessions = [], today, dayId, training = {}, budgetMin = budgetFor(today), weekStartDow = 1, trainingDays = null, reentry = null }) {
  const flags = programFlags(prog0);
  const bx = flags.boxing ? boxingAdjust(prog0) : { program: prog0, cuts: [] };
  const program = bx.program;
  const re = reentry && reentry.active ? reentry : null;
  const start = blockStart(program.startDay, reentry);
  const week = flags.meso && !re ? mesoWeek(start, today) : null;
  const block = flags.meso && !re ? mesoBlock(start, today) : null;
  const deload = !re && (deloadActive(training.deload, today) || week === 6);
  // meso 1 (and the re-entry weeks before it): the item's first-block rep range (back squat / bench 6–10)
  const p0 = flags.meso && (re || block === null || block === 1) ? withBlockReps(program, dayId) : program;
  let plan;
  if (re) {
    const items = p0.days[dayId].items.map((x) => ({ ...x, sets: reentrySets(x.sets, re), reSets: true }));
    const full = estimateMinutes(p0.days[dayId].items);
    const ap = autopilot({ items, budgetMin, projection: {} });
    const pct = Math.round(REENTRY[Math.min(re.week, 2)].sets * 100);
    plan = { items: ap.items, minutes: ap.minutes, baseMinutes: full, fits: ap.fits, projection: null, carryNext: mergeCarry(training.carry || {}, {}, {}, today),
      changes: [{ code: 'reentry', text: `${reentryHeader(re)} · حوالي ${pct}% من المجموعات ووزن ${Math.round(REENTRY[Math.min(re.week, 2)].load * 100)}% من آخر مرة` },
        ...ap.changes.filter((c) => c.code !== 'carried')] };
  } else plan = planSession({ program: p0, sessions, today, dayId, budgetMin, carry: training.carry || {}, weekStartDow, trainingDays, deload });
  for (const c of bx.cuts.filter((x) => x.day === dayId)) {
    const it = program.days[dayId].items.find((x) => x.id === c.id);
    if (it) plan.changes.push({ code: 'box', exId: it.id, muscle: 'كتف جانبي', n: 1, text: `${it.ar}: −1 مجموعة (الملاكمة بتشغّل الكتف الجانبي)` });
  }
  const z2 = flags.z2 ? z2Minutes(plan.minutes, { deload: deload || !!re }) : 0;
  return { plan, week, block, deload, reentry: re, lift: plan.minutes, z2, total: plan.minutes + z2 };
}
// ══ Boxing Day shoulder load (boxing.js) ═══════════════════════
/** Weekly side-delt sets taken off the plan when the week has a Boxing Day (bag rounds load the shoulders). */
export const BOX_DELT_CUT = 2;
/**
 * boxingAdjust(program) → {program, cuts:[{day, id}]}: −1 set on up to BOX_DELT_CUT side-delt isolation slots (never below 2 sets).
 * Slots: the template's boxDeltCut ids first (ul4c: the lateral raises on Lower A / Lower B), then any other side-delt isolation
 * from the end of the week. Only for programs whose cardio day is boxing; everything else is returned untouched.
 */
export function boxingAdjust(program) {
  if (!program || !programFlags(program).boxing) return { program, cuts: [] };
  const t = PROGRAMS[program.activeProgram] || {};
  const slots = [];
  for (const id of t.boxDeltCut || []) for (const d of program.order) if (program.days[d]?.items.some((x) => x.id === id)) slots.push([d, id]);
  for (const d of [...program.order].reverse()) for (const x of program.days[d]?.items || []) {
    if (fineOf(x).prime === 'كتف جانبي' && kindOf(x) === 'isolation' && !slots.some(([dd, id]) => dd === d && id === x.id)) slots.push([d, x.id]);
  }
  const days = { ...program.days };
  const cuts = [];
  for (const [d, id] of slots) {
    if (cuts.length >= BOX_DELT_CUT) break;
    const it = days[d].items.find((x) => x.id === id);
    if (!it || it.sets <= 2) continue;
    days[d] = { ...days[d], items: days[d].items.map((x) => (x.id === id ? { ...x, sets: x.sets - 1, boxCut: 1 } : x)) };
    cuts.push({ day: d, id });
  }
  return { program: cuts.length ? { ...program, days } : program, cuts };
}
/** A copy of the program whose items use their first-block rep range (`r1`) where they have one. */
export function withBlockReps(program, dayId = null) {
  const days = { ...program.days };
  for (const id of dayId ? [dayId] : program.order) {
    const d = program.days[id]; if (!d) continue;
    days[id] = { ...d, items: d.items.map((x) => (x.r1 ? { ...x, reps: x.r1 } : x)) };
  }
  return { ...program, days };
}

// ══ Zone 2 after lifting (review.md M4) ═══════════════════════
/** z2 = min(12, 59 − liftEnd − 1), floor 8 (deload week: up to 15). liftEnd = minutes lifted. */
export function z2Minutes(liftEndMin, { deload = false } = {}) {
  const cap = deload ? 15 : 12;
  return Math.max(8, Math.min(cap, 59 - Math.ceil(+liftEndMin || 0) - 1));
}
/** Rest before the anchor after a fill set: what is left of the round rest since the anchor's last set (min 10 s). */
export function fillRest(live, i, now = Date.now()) {
  const e = live.exercises[i];
  const total = groupRest(live, i);
  if (!e?.fill) return total;
  const anchors = groupOf(live, i).map((k) => live.exercises[k]).filter((x) => !x.fill);
  const at = Math.max(0, ...anchors.flatMap((x) => x.sets.filter((t) => t.done && t.at).map((t) => t.at)));
  if (!at) return total;
  return Math.max(10, Math.round(total - (now - at) / 1000));
}
/** «كله زي الخطة»: mark every open set of an exercise done with its prefilled numbers. Returns the indices for Undo. */
export function logRemaining(sets, now = Date.now()) {
  const idx = [];
  (sets || []).forEach((t, k) => { if (!t.done && +t.r > 0) { t.done = true; t.at = now + k; t.asPlanned = true; idx.push(k); } });
  return idx;
}

export { LIBRARY, VOL_LM, PROGRAMS, muscleGroup };
