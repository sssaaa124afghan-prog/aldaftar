// Day type (training/rest) from the training schedule, per-day-type targets, and portion math.
// The only place macros are computed. Validation REPORTS problems; it never silently "fixes" numbers.

import { DEFAULT_TARGETS, LEGACY_DEFAULT_TARGETS, DEFAULT_HEIGHT_CM, DEFAULT_BODY_KG, DEFAULT_TRAINING_DAYS, DAY_TYPES, HEART_DOW, CARDIO_DAY, cardioDayOf, DEFAULT_PROGRAM_ID, num } from './schema.js';
import { weekday, isDayKey, addDays, diffDays } from './date.js';

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
  return cardioOf(rec)?.dow ?? null;
}
/**
 * The weekly cardio day for a stored program record: {dow, kind:'boxing'|'heart'} | null. Same rules as heartDowOf
 * (v2 record → its template + version; legacy Solo Gym record → none; nothing stored → the default plan, v3 = Thursday boxing).
 */
export function cardioOf(rec) {
  if (rec && rec.v === 2 && rec.days && Array.isArray(rec.order) && rec.order.length) return cardioDayOf(rec);
  if (rec && rec.days && typeof rec.days === 'object' && !Array.isArray(rec.days)
    && Object.values(rec.days).some((d) => d && Array.isArray(d.exercises) && d.exercises.some((e) => e && !e.isWarmup))) return null;
  return HEART_DOW[DEFAULT_PROGRAM_ID] === undefined ? null : { dow: HEART_DOW[DEFAULT_PROGRAM_ID], kind: CARDIO_DAY[DEFAULT_PROGRAM_ID]?.kind || 'heart' };
}

/** Kinds of a finished session that make the day a cardio ('heart' type) day: Heart Day and Boxing Day. */
export const CARDIO_KINDS = Object.freeze(['heart', 'boxing']);
/** Days with a finished Heart Day or Boxing Day session (the 10-min isometric block alone does not count). */
export function heartDaysOf(sessions = []) {
  return new Set((sessions || []).filter((s) => s && CARDIO_KINDS.includes(s.kind) && s.mode !== 'iso' && isDayKey(s.day) && !s.discarded
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

// ───────── 72-kg defaults: macros, silent migration, gain-phase adaptive step (growth-assessment.md §0.5) ─────────

/**
 * macrosFor(kcal, {p, f}) → {kcal, p, c, f}: protein and fat fixed, carbs fill the rest (rounded), kcal = 4P + 4C + 9F exactly.
 */
export function macrosFor(kcal, { p, f }) {
  const c = Math.max(0, Math.round((kcal - 4 * p - 9 * f) / 4));
  return { kcal: 4 * p + 4 * c + 9 * f, p, c, f };
}
/** Default targets for a body weight: protein ≈ 2.15 g/kg, fat ≈ 0.97 g/kg (both to 5 g), day kcal scaled from the 72-kg plan (to 50). */
export function defaultTargetsFor(kg = DEFAULT_BODY_KG) {
  const w = Number(kg) > 30 && Number(kg) < 300 ? Number(kg) : DEFAULT_BODY_KG;
  if (Math.abs(w - DEFAULT_BODY_KG) < 0.5) return { training: { ...DEFAULT_TARGETS.training }, rest: { ...DEFAULT_TARGETS.rest }, heart: { ...DEFAULT_TARGETS.heart } };
  const r5 = (x) => Math.round(x / 5) * 5, r50 = (x) => Math.round(x / 50) * 50;
  const p = r5(w * 2.15), f = r5(w * 0.97);
  const out = {};
  for (const k of DAY_TYPES) out[k] = macrosFor(r50(DEFAULT_TARGETS[k].kcal * w / DEFAULT_BODY_KG), { p, f });
  return out;
}

const sameT = (a, b) => !!a && !!b && ['kcal', 'p', 'c', 'f'].every((k) => Number(a[k]) === Number(b[k]));
/** Stored targets that are still the old defaults (or were never edited): every stored day type equals the old default. */
export function isLegacyDefault(stored) {
  if (!stored || !stored.training || !stored.rest) return true; // nothing saved → defaults
  return ['training', 'rest', 'heart'].every((k) => !stored[k] || sameT(stored[k], LEGACY_DEFAULT_TARGETS[k]));
}
export const TARGETS_VERSION = 2;
export const TARGETS_TOAST = 'اتحدّثت أهدافك حسب وزنك 72';

/**
 * migrateTargets(stored, {kg}) → {targets, changed, reason, toast?, suggestion?}
 * - already migrated (tv ≥ 2) → unchanged;
 * - still the old defaults (2600 / 2050 / 2300) → the new defaults, silently, with TARGETS_TOAST;
 * - custom → kept exactly; `suggestion` = the new defaults for the adaptive card (apply only on confirm).
 */
export function migrateTargets(stored, { kg = DEFAULT_BODY_KG } = {}) {
  if (stored && Number(stored.tv) >= TARGETS_VERSION) return { targets: stored, changed: false, reason: 'current' };
  const next = defaultTargetsFor(kg);
  if (isLegacyDefault(stored)) {
    return { targets: { ...next, isDefault: true, tv: TARGETS_VERSION }, changed: true, reason: 'defaults', toast: TARGETS_TOAST.replace('72', String(Math.round(Number(kg) || DEFAULT_BODY_KG))) };
  }
  const t = withDayTypes(stored);
  const avg = (x) => (4 * x.training.kcal + x.heart.kcal + 2 * x.rest.kcal) / 7;
  const delta = Math.round(avg(next) - avg(t));
  return { targets: { ...stored, tv: TARGETS_VERSION }, changed: true, reason: 'custom',
    suggestion: Math.abs(delta) >= 100 ? { kind: 'body', delta, targets: next, title: `أهداف ${Math.round(Number(kg) || DEFAULT_BODY_KG)} كجم: ${delta > 0 ? '+' : '−'}${Math.abs(delta)} سعرة في المتوسط`,
      reason: `على وزنك المتوسط الأسبوعي الأنسب حوالي ${Math.round(avg(next))} سعرة (ثبات لحد +5%). أهدافك الحالية ${Math.round(avg(t))}.` } : null };
}

/**
 * runTargetsMigration(db) → {changed, toast?, suggestion?}: reads kv 'targets' + the profile + the latest weight, writes the
 * migrated targets (tv 2) and the profile height (175 cm) when missing, and parks a custom-target suggestion in
 * kv 'nutrition'.targetSuggestion for the adaptive card. Safe to call on every boot (no-op once tv = 2).
 */
export async function runTargetsMigration(db) {
  const kvGet = async (k) => { try { const r = await db.get('kv', k); return r && r.value && typeof r.value === 'object' ? r.value : null; } catch { return null; } };
  const out = { changed: false };
  let prof = null;
  try { prof = await db.get('profile', 'me'); } catch { prof = null; }
  if (!prof || !(Number(prof.heightCm) > 0)) {
    try { await db.put('profile', { ...(prof || {}), key: 'me', heightCm: DEFAULT_HEIGHT_CM }); out.height = DEFAULT_HEIGHT_CM; } catch { /* best effort */ }
  }
  let kg = DEFAULT_BODY_KG;
  try { const ws = (await db.getAll('bodyweight')).filter((r) => r && isDayKey(r.day) && Number(r.kg) > 30).sort((a, b) => a.day.localeCompare(b.day)); if (ws.length) kg = Number(ws[ws.length - 1].kg); } catch { /* none */ }
  const stored = await kvGet('targets');
  const m = migrateTargets(stored, { kg });
  if (!m.changed) return out;
  await db.put('kv', { key: 'targets', value: m.targets });
  out.changed = true; out.reason = m.reason;
  if (m.toast) out.toast = m.toast;
  if (m.suggestion) {
    out.suggestion = m.suggestion;
    const n = (await kvGet('nutrition')) || {};
    await db.put('kv', { key: 'nutrition', value: { ...n, targetSuggestion: { ...m.suggestion, date: new Date().toISOString().slice(0, 10) } } });
  }
  return out;
}

/**
 * Lean-gain adaptive step (growth-assessment §0.5): ±150 kcal at most every 14 days, from the 7-day average weight now vs the
 * 7-day average 14 days earlier, aiming at +0.25–0.5 kg/month. Only after the re-entry + regain runway (gainFrom, default
 * 8 weeks after the re-entry start): before that a faster rise is normal (glycogen, water, muscle memory), so the only step
 * is +150 when the average is FALLING > 0.25 kg/week. → null | {delta, change, rateMonth, from, to, days, title, reason, phase}
 */
export const GAIN_STEP = 150;
export const GAIN_BAND = Object.freeze({ lo: 0.25, hi: 0.5 }); // kg / month
export const GAIN_EVERY_DAYS = 14;
export const REGAIN_DAYS = 56;
export function gainSuggestion(weights = [], history = [], { today, gainFrom = null, reentryStart = null, snoozeUntil = null } = {}) {
  const ws = (weights || []).filter((w) => w && isDayKey(w.day) && Number(w.kg) > 20).sort((a, b) => a.day.localeCompare(b.day));
  const end = today || (ws.length ? ws[ws.length - 1].day : null);
  if (!end || ws.length < 4) return null;
  if (snoozeUntil && end < snoozeUntil) return null;
  const last = (history || []).filter((x) => x && isDayKey(x.date)).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (last && diffDays(last.date, end) < GAIN_EVERY_DAYS) return null;
  const avgIn = (from, to) => { const v = ws.filter((w) => w.day >= from && w.day <= to).map((w) => Number(w.kg)); return v.length >= 2 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const now = avgIn(addDays(end, -6), end);
  const before = avgIn(addDays(end, -20), addDays(end, -14));
  if (now === null || before === null) return null;
  const change = Math.round((now - before) * 100) / 100;
  const rateMonth = Math.round(change * (30 / 14) * 100) / 100;
  const startGain = gainFrom || (reentryStart && isDayKey(reentryStart) ? addDays(reentryStart, REGAIN_DAYS) : null);
  const regain = !!startGain && end < startGain;
  const base = { change, rateMonth, from: Math.round(before * 10) / 10, to: Math.round(now * 10) / 10, days: 14, phase: regain ? 'regain' : 'gain' };
  const kgTxt = (x) => `${Math.abs(x).toFixed(2).replace(/0$/, '')}`;
  if (regain) {
    if (change / 2 < -0.25) return { ...base, delta: GAIN_STEP, title: `زوّد ${GAIN_STEP} سعرة`, reason: `متوسط وزنك نزل ${kgTxt(change)} كجم في أسبوعين وإنت لسه في فترة الرجوع. الزيادة هنا طبيعية، النزول معناه عجز كبير.` };
    return null;
  }
  if (rateMonth < GAIN_BAND.lo) return { ...base, delta: GAIN_STEP, title: `زوّد ${GAIN_STEP} سعرة`, reason: `متوسط وزنك اتغيّر ${change >= 0 ? '+' : '−'}${kgTxt(change)} كجم في أسبوعين (≈ ${rateMonth.toFixed(2)} كجم في الشهر). الهدف +0.25 لـ +0.5 كجم في الشهر.` };
  if (rateMonth > GAIN_BAND.hi) return { ...base, delta: -GAIN_STEP, title: `قلّل ${GAIN_STEP} سعرة`, reason: `متوسط وزنك زاد ${kgTxt(change)} كجم في أسبوعين (≈ ${rateMonth.toFixed(2)} كجم في الشهر). أكتر من +0.5 في الشهر أغلبه دهون.` };
  return null;
}
