// Day type (training/rest) from the training schedule, per-day-type targets, and portion math.
// The only place macros are computed. Validation REPORTS problems; it never silently "fixes" numbers.

import { DEFAULT_TARGETS, DEFAULT_TRAINING_DAYS, DAY_TYPES, HEART_DOW, DEFAULT_PROGRAM_ID, num } from './schema.js';
import { weekday, isDayKey } from './date.js';

export const QTY_MIN_EXCLUSIVE = 0;
export const QTY_MAX = 5000; // grams (or units) per logged item

export const TARGET_MESSAGES = Object.freeze({
  not_number: 'لازم تكتب رقم.',
  out_of_range: 'الرقم ده برّه الحدود المعقولة.',
  kcal_mismatch: 'السعرات مش متوافقة مع الماكروز (4×بروتين + 4×كارب + 9×دهون).',
  qty_not_number: 'اكتب الكمية رقم.',
  qty_too_small: 'الكمية لازم تكون أكبر من صفر.',
  qty_too_large: `الكمية كبيرة أوي (أقصى حاجة ${QTY_MAX}).`,
  bad_food: 'بيانات الأكلة ناقصة.',
});

const has = (set, day) => !!set && (set instanceof Set ? set.has(day) : set.includes(day));

/**
 * dayType(day, {trainingDays, overrides, sessionDays, heartDays, heartDow}) → 'training' | 'rest' | 'heart'
 * Order: manual override for that date → a lifting session was logged → a Heart Day session was logged →
 * weekly lifting schedule → the program's Heart Day weekday → rest.
 */
export function dayType(day, { trainingDays = DEFAULT_TRAINING_DAYS, overrides = {}, sessionDays = null, heartDays = null, heartDow = null } = {}) {
  if (!isDayKey(day)) throw new RangeError(`invalid day key: ${day}`);
  const o = overrides && overrides[day];
  if (DAY_TYPES.includes(o)) return o;
  if (has(sessionDays, day)) return 'training';
  if (has(heartDays, day)) return 'heart';
  const wd = weekday(day);
  if ((trainingDays || DEFAULT_TRAINING_DAYS).includes(wd)) return 'training';
  return Number.isInteger(heartDow) && heartDow === wd ? 'heart' : 'rest';
}

/**
 * Heart Day weekday for a stored program record (programs/'current'), mirroring workout normalizeProgram():
 * a v2 record → its template's day (null for custom/imported); a legacy Solo Gym record → null; nothing stored → default plan.
 */
export function heartDowOf(rec) {
  if (rec && rec.v === 2 && rec.days && Array.isArray(rec.order) && rec.order.length) {
    const d = HEART_DOW[rec.activeProgram];
    return Number.isInteger(d) ? d : null;
  }
  if (rec && rec.days && typeof rec.days === 'object' && !Array.isArray(rec.days)
    && Object.values(rec.days).some((d) => d && Array.isArray(d.exercises) && d.exercises.some((e) => e && !e.isWarmup))) return null;
  return HEART_DOW[DEFAULT_PROGRAM_ID] ?? null;
}

/** Days with a finished Heart Day session ({kind:'heart', mode:'heart'}; the 10-min isometric block alone does not count). */
export function heartDaysOf(sessions = []) {
  return new Set((sessions || []).filter((s) => s && s.kind === 'heart' && s.mode !== 'iso' && isDayKey(s.day) && !s.discarded
    && s.status !== 'active' && s.status !== 'running').map((s) => s.day));
}

/** Stored targets with every day type present (heart falls back to its default until the user edits it). */
export function withDayTypes(t) {
  const out = t && t.training && t.rest ? { ...t } : { training: { ...DEFAULT_TARGETS.training }, rest: { ...DEFAULT_TARGETS.rest }, isDefault: true };
  for (const k of DAY_TYPES) if (!out[k] || typeof out[k].kcal !== 'number') out[k] = { ...DEFAULT_TARGETS[k] };
  return out;
}

/** Targets for a day: {type, kcal, p, c, f}. */
export function targetsForDay(day, { targets = DEFAULT_TARGETS, ...opts } = {}) {
  const type = dayType(day, opts);
  const t = (targets && targets[type]) || DEFAULT_TARGETS[type];
  return { type, kcal: t.kcal, p: t.p, c: t.c, f: t.f };
}

export const kcalFromMacros = ({ p = 0, c = 0, f = 0 }) => 4 * p + 4 * c + 9 * f;

/**
 * validateTargets({kcal,p,c,f}, {tolerance}) → {ok, issues:[{field,code,message}], macroKcal, diff, diffPct}
 * tolerance: relative (default 5%) with a 50 kcal floor — fibre/alcohol/rounding make exact equality wrong.
 */
export function validateTargets(t, { tolerance = 0.05, floorKcal = 50 } = {}) {
  const issues = [];
  const limits = { kcal: [800, 7000], p: [0, 500], c: [0, 1000], f: [0, 400] };
  for (const [k, [lo, hi]] of Object.entries(limits)) {
    const v = t ? t[k] : undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) issues.push({ field: k, code: 'not_number', message: TARGET_MESSAGES.not_number });
    else if (v < lo || v > hi) issues.push({ field: k, code: 'out_of_range', message: TARGET_MESSAGES.out_of_range });
  }
  if (issues.length) return { ok: false, issues, macroKcal: null, diff: null, diffPct: null };
  const macroKcal = kcalFromMacros(t);
  const diff = t.kcal - macroKcal;
  const diffPct = diff / t.kcal;
  if (Math.abs(diff) > Math.max(floorKcal, t.kcal * tolerance)) issues.push({ field: 'kcal', code: 'kcal_mismatch', message: TARGET_MESSAGES.kcal_mismatch });
  return { ok: issues.length === 0, issues, macroKcal, diff, diffPct: Math.round(diffPct * 1000) / 1000 };
}

/**
 * setTargets(current, type, values) → {targets, validation}
 * Saves exactly what the user typed (even with a kcal mismatch — the UI shows the warning); rejects only
 * non-numbers / out-of-range values (targets unchanged then).
 */
export function setTargets(current, type, values) {
  if (!DAY_TYPES.includes(type)) throw new RangeError('type must be training|rest|heart');
  const next = { kcal: Number(values.kcal), p: Number(values.p), c: Number(values.c), f: Number(values.f) };
  const validation = validateTargets(next);
  const hard = validation.issues.some((i) => i.code !== 'kcal_mismatch');
  if (hard) return { targets: current, validation, saved: false };
  return { targets: { ...current, [type]: next, isDefault: false }, validation, saved: true };
}

/** {ok, code?, message?, qty?} */
export function validateQty(qty) {
  const q = typeof qty === 'string' ? Number(qty.replace(',', '.')) : qty;
  if (typeof q !== 'number' || !Number.isFinite(q)) return { ok: false, code: 'qty_not_number', message: TARGET_MESSAGES.qty_not_number };
  if (q <= QTY_MIN_EXCLUSIVE) return { ok: false, code: 'qty_too_small', message: TARGET_MESSAGES.qty_too_small };
  if (q > QTY_MAX) return { ok: false, code: 'qty_too_large', message: TARGET_MESSAGES.qty_too_large };
  return { ok: true, qty: q };
}

export class ValidationError extends Error {
  constructor(code, message) { super(message); this.name = 'ValidationError'; this.code = code; }
}

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * portion(food, qty) → {kcal, p, c, f}
 * food values are per `food.per` units (100 g, 1 piece, 30 g scoop...). Legacy bug: qty/100 ignored `per`.
 * Throws ValidationError for qty ≤ 0, > 5000 or not a number.
 */
export function portion(food, qty) {
  const v = validateQty(qty);
  if (!v.ok) throw new ValidationError(v.code, v.message);
  if (!food || typeof food !== 'object') throw new ValidationError('bad_food', TARGET_MESSAGES.bad_food);
  const per = num(food.per, 0.001, 100000) ?? 100;
  const m = v.qty / per;
  const g = (x) => r1((num(x, 0, 100000) ?? 0) * m);
  return { kcal: g(food.kcal ?? food.cal), p: g(food.p ?? food.pro), c: g(food.c ?? food.carb), f: g(food.f ?? food.fat) };
}

/** Sum log entries → {kcal,p,c,f}. */
export function sumEntries(entries = []) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const e of entries) for (const k of Object.keys(t)) t[k] += num(e && e[k], 0, 100000) ?? 0;
  for (const k of Object.keys(t)) t[k] = r1(t[k]);
  return t;
}

/** Remaining = target − intake (negative means over). */
export function remaining(target, intake) {
  return { kcal: r1(target.kcal - intake.kcal), p: r1(target.p - intake.p), c: r1(target.c - intake.c), f: r1(target.f - intake.f) };
}
