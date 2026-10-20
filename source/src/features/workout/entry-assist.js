// Set-entry helpers for the live session (pure; tests in entry-assist.test.js).
// 1) Carry-forward: a weight typed / stepped on set j pre-fills the later open sets of the same exercise that the user has
//    not edited himself (s.wEd). «طبّق على الباقي» stays only for later sets he DID edit (explicit tap + Undo).
// 2) 0-kg guard: loaded lifts (barbell / dumbbell / machine / cable) never log at 0 kg; bodyweight moves may.
// 3) First-session calibration: a guided ramp for an exercise with no history. After each ramp set one answer
//    «سهل / مناسب / تقيل» moves the weight; «مناسب» (RIR ≈ 3, re-entry 3–4) locks the working weight. No typing.
import { libById, findLib } from './exercises.js';

export const LOADED_EQ = Object.freeze(new Set(['بار', 'دمبل', 'جهاز', 'كابل']));

/** Equipment of a live exercise or plan item ('بار' | 'دمبل' | 'جهاز' | 'كابل' | 'وزن جسم' | 'أداة' | null). */
export function equipOf(e) {
  const L = e && ((e.lib && libById(e.lib)) || findLib(e.en || e.name || e.ar));
  return L ? L.eq : null;
}
export const isLoaded = (e) => LOADED_EQ.has(equipOf(e));
/** True when this set cannot be logged yet: a loaded lift at 0 kg. */
export const needsWeight = (e, s) => !!(e && s && isLoaded(e) && !(+s.w > 0));

// ── carry-forward ─────────────────────────────────────────────
/** Later, not-done sets the user has not edited (they still hold a prefill, possibly carried). */
export function carryTargets(sets, j) {
  const out = [];
  for (let k = j + 1; k < (sets || []).length; k++) if (!sets[k].done && !sets[k].wEd) out.push(k);
  return out;
}
/**
 * Copy set j's weight onto the untouched later open sets. Returns [[k, previousW]] for the ones that changed (Undo).
 * Set j itself is marked as edited by the caller.
 */
export function carryWeight(sets, j) {
  const w = +sets?.[j]?.w;
  if (!Number.isFinite(w)) return [];
  const before = [];
  for (const k of carryTargets(sets, j)) if (+sets[k].w !== w) { before.push([k, sets[k].w]); sets[k].w = w; }
  return before;
}
/** Later open sets the user edited himself to a different weight: the only ones «طبّق على الباقي» still offers. */
export function editedPeers(sets, j) {
  const w = +sets?.[j]?.w, out = [];
  for (let k = j + 1; k < (sets || []).length; k++) if (!sets[k].done && sets[k].wEd && +sets[k].w !== w) out.push(k);
  return out;
}

// ── calibration ramp ──────────────────────────────────────────
// Working weight for ~8–10 reps at RIR ≈ 3 as a share of body weight (dumbbells: per hand). Conservative
// starting points for a returning intermediate lifter [opinion: practical bodyweight-ratio heuristics, not a study].
const RATIO = {
  'بار': { 'صدر': 0.55, 'ظهر': 0.5, 'كتف': 0.35, 'رجل': 0.7, 'رجل خلفي': 0.6, 'مؤخرة': 0.8, 'باي': 0.25, 'تراي': 0.3, 'ساعد': 0.2, 'ترابيس': 0.6, _: 0.35 },
  'دمبل': { 'صدر': 0.18, 'ظهر': 0.22, 'كتف': 0.13, 'كتف خلفي': 0.05, 'رجل': 0.12, 'باي': 0.1, 'تراي': 0.1, 'ساعد': 0.1, 'ترابيس': 0.25, _: 0.1 },
  'جهاز': { 'صدر': 0.5, 'ظهر': 0.55, 'رجل': 1.0, 'رجل خلفي': 0.45, 'مؤخرة': 0.8, 'سمانة': 0.6, 'ضامة': 0.4, 'باي': 0.2, 'تراي': 0.25, 'كتف': 0.05, 'كتف خلفي': 0.15, 'بطن': 0.3, _: 0.3 },
};
RATIO['كابل'] = { ...RATIO['جهاز'], 'ظهر': 0.5, 'كتف خلفي': 0.2, 'مؤخرة': 0.15, 'صدر': 0.2, 'تراي': 0.25 };
const ISO_SCALE = { 'صدر': 0.5, 'كتف': 0.45, 'رجل': 0.35, 'رجل خلفي': 0.6, 'ظهر': 0.55 };
const BY_NAME = [[/deadlift/i, 0.9], [/leg press/i, 1.4], [/hip thrust/i, 1.0], [/romanian|rdl/i, 0.7], [/lateral raise|rear delt/i, 0.05]];

/** Load step for the equipment: barbell 2.5 (≥ empty bar 20), dumbbells 1 under 10 kg then 2, machine / cable 2.5 (≥ 5). */
export function loadRound(w, eq) {
  const v = Math.max(0, +w || 0);
  if (eq === 'بار') return Math.max(20, Math.round(v / 2.5) * 2.5);
  if (eq === 'دمبل') return v < 10 ? Math.max(1, Math.round(v)) : Math.round(v / 2) * 2;
  return Math.max(5, Math.round(v / 2.5) * 2.5);
}
const nextStep = (w, eq) => (eq === 'دمبل' ? (w < 10 ? 1 : 2) : 2.5);

/** Estimated working weight for an exercise (kg; per hand for dumbbells). */
export function estimateWorking(e, bw = 72, { reentry = false } = {}) {
  const eq = equipOf(e);
  if (!LOADED_EQ.has(eq)) return 0;
  const L = (e.lib && libById(e.lib)) || findLib(e.en || e.name) || {};
  const muscle = L.muscle || e.muscle || '';
  const en = String(L.en || e.en || '');
  let r = (BY_NAME.find(([re]) => re.test(en)) || [])[1];
  if (r === undefined) {
    r = RATIO[eq][muscle] ?? RATIO[eq]._;
    if ((L.kind || e.kind) === 'isolation' && eq !== 'جهاز' && eq !== 'كابل' && ISO_SCALE[muscle]) r *= ISO_SCALE[muscle];
    if ((L.kind || e.kind) === 'isolation' && (eq === 'جهاز' || eq === 'كابل') && muscle === 'صدر') r = 0.3;
  }
  const b = +bw > 30 && +bw < 250 ? +bw : 72;
  return loadRound(r * b * (reentry ? 0.85 : 1), eq);
}

/** Does this live exercise get the guided ramp? Loaded, no history, nothing logged, no weight entered yet. */
export function needsCalibration(e) {
  if (!e || e.skipped || !isLoaded(e)) return false;
  if (e.calib && (e.calib.locked !== undefined || e.calib.skip)) return false;
  if ((e.prev && e.prev.length) || e.from === 'last') return false;
  if (e.sets.some((s) => s.done || s.wEd)) return false;
  return e.sets.every((s) => !(+s.w > 0));
}

/** First ramp step: about 60% of the estimate (barbell: at least the empty bar). → {n, w, r, est, eq, log:[]} */
export function calibStart(e, bw = 72, { reentry = false, reps = 8 } = {}) {
  const eq = equipOf(e);
  const est = estimateWorking(e, bw, { reentry });
  const w = Math.min(est, loadRound(est * 0.6, eq));
  return { n: 1, w, r: Math.max(5, Math.min(12, +reps || 8)), est, eq, reentry: !!reentry, log: [] };
}

export const CALIB_MAX = 5;
/**
 * One answer after a ramp set. feel: 'easy' (5+ reps left) | 'ok' (3–4 left) | 'hard' (≤ 2 left).
 * easy → next step (step 2 jumps to the estimate, then +15 %, re-entry +10 %); ok → lock this weight;
 * hard → lock 10 % lighter (re-entry 15 %). After CALIB_MAX steps an «easy» locks the next weight.
 * Returns a new state; `locked` holds the working weight once decided.
 */
export function calibNext(cal, feel) {
  const { eq } = cal;
  const log = [...(cal.log || []), { w: cal.w, feel }];
  if (feel === 'ok') return { ...cal, log, locked: cal.w };
  if (feel === 'hard') {
    const down = loadRound(cal.w * (cal.reentry ? 0.85 : 0.9), eq);
    return { ...cal, log, locked: Math.min(cal.w, down) };
  }
  const grow = cal.reentry ? 1.1 : 1.15;
  let w = cal.n === 1 && cal.est > cal.w ? cal.est : loadRound(cal.w * grow, eq);
  if (w <= cal.w) w = cal.w + nextStep(cal.w, eq);
  if (cal.n >= CALIB_MAX) return { ...cal, log, locked: w };
  return { ...cal, log, n: cal.n + 1, w };
}

/** Put the locked working weight on every open set the user has not edited. Returns [[k, previousW]] (Undo). */
export function applyCalibration(sets, w) {
  const before = [];
  (sets || []).forEach((s, k) => { if (!s.done && !s.wEd && +s.w !== +w) { before.push([k, s.w]); s.w = +w; } });
  return before;
}
