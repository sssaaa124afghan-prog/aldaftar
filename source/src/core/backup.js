// Backup export (schema v1, never the API key) and import with format detection + MERGE.
// Accepted inputs: v1 backup, NutriPro raw dump (expData/exportData), NutriPro foods file (nutripro_foods_v1),
// NutriPro saved meals (nutripro_meals_v1), NutriPro→GymPro export (nutripro_gym_v1, read-only),
// Solo Gym raw dump (expD), Solo Gym v21 backup ({app:'SoloGym',key,ts,data}). CSV is export-only.

import { APP_ID, SCHEMA_VERSION, emptyData, clone, isObj, num, str, stripSecrets } from './schema.js';
import { dayKey, isDayKey } from './date.js';
import { safeParseJSON, loadData, saveData, writeSnapshot } from './db.js';
import { migrateLegacy } from './migrate.js';
import { mergeData } from './merge.js';

export const IMPORT_ERRORS = Object.freeze({
  empty: 'الملف فاضي.',
  invalid_json: 'الملف ده مش نسخة احتياطية سليمة (JSON بايظ). بياناتك الحالية زي ما هي.',
  csv_unsupported: 'ملفات CSV للتصدير بس. استورد ملف JSON بدلها.',
  unknown_format: 'مش قادرين نتعرف على نوع الملف ده. بياناتك الحالية زي ما هي.',
  newer_schema: 'النسخة دي معمولة من إصدار أحدث من التطبيق. حدّث التطبيق الأول.',
  invalid_data: 'النسخة فيها بيانات ناقصة أو غلط ومحدش اتغيّر.',
});

// ───────────────────────── export ─────────────────────────

/** Build the backup object. Secrets are stripped by name AND by token shape, wherever they are. */
export function exportBackup(data, { now = new Date(), includeLegacyRaw = true } = {}) {
  const d = stripSecrets(clone(data));
  delete d.secrets;
  if (!includeLegacyRaw && d.meta) d.meta.legacyRaw = {};
  return { app: APP_ID, schema: SCHEMA_VERSION, exportedAt: now.toISOString(), includesSecrets: false, data: d };
}

export const serializeBackup = (data, opts) => JSON.stringify(exportBackup(data, opts));
export const backupFileName = (now = new Date()) => `${APP_ID}-backup-${dayKey(now)}.json`;

// ───────────────────────── detection ─────────────────────────

export function detectFormat(obj) {
  if (Array.isArray(obj)) return 'unknown';
  if (!isObj(obj)) return 'unknown';
  if (obj.app === APP_ID || (obj.schema !== undefined && isObj(obj.data) && 'exportedAt' in obj)) return 'v1';
  if (obj._format === 'nutripro_foods_v1' && isObj(obj.foods)) return 'nutripro_foods_v1';
  if (obj._format === 'nutripro_meals_v1' && isObj(obj.savedMeals)) return 'nutripro_meals_v1';
  if (obj._format === 'nutripro_gym_v1') return 'nutripro_gym_v1';
  if (obj.app === 'SoloGym' && isObj(obj.data)) return 'sologym_v21';
  if (Array.isArray(obj.ses) || (isObj(obj.days) && Array.isArray(obj.bw))) return 'sologym_raw';
  if (isObj(obj.foods) || isObj(obj.log) || isObj(obj.savedMeals)) return 'nutripro_raw';
  return 'unknown';
}

// ───────────────────────── v1 validation ─────────────────────────

const macro = (v) => num(v, 0, 100000) ?? 0;

/** Sanitise a v1 data object. Invalid records are dropped and counted, valid ones kept. */
export function validateV1(input) {
  const skipped = {};
  const skip = (k) => { skipped[k] = (skipped[k] || 0) + 1; };
  const out = emptyData();
  if (!isObj(input)) return { ok: false, data: null, skipped };
  for (const k of ['meta', 'settings', 'profile', 'targets', 'programs', 'training', 'nutrition', 'wellness']) {
    if (isObj(input[k])) out[k] = { ...out[k], ...clone(input[k]) };
  }
  if (!Array.isArray(out.wellness.log)) out.wellness.log = [];
  if (!Array.isArray(out.wellness.recoveryLog)) out.wellness.recoveryLog = [];
  out.foods = (Array.isArray(input.foods) ? input.foods : []).flatMap((f) => {
    if (!isObj(f) || !f.id || !str(f.name).trim()) { skip('foods'); return []; }
    return [{ ...clone(f), id: str(f.id, 80), name: str(f.name, 120), kcal: macro(f.kcal), p: macro(f.p), c: macro(f.c), f: macro(f.f), per: num(f.per, 0.001, 100000) ?? 100 }];
  });
  for (const [day, entries] of Object.entries(isObj(input.foodLog) ? input.foodLog : {})) {
    if (!isDayKey(day) || !Array.isArray(entries)) { skip('foodDays'); continue; }
    const good = entries.filter((e) => isObj(e) && e.id).map((e) => ({ ...clone(e), name: str(e.name, 120), kcal: macro(e.kcal), p: macro(e.p), c: macro(e.c), f: macro(e.f) }));
    for (let i = good.length; i < entries.length; i++) skip('meals');
    if (good.length) out.foodLog[day] = good;
  }
  out.sessions = (Array.isArray(input.sessions) ? input.sessions : []).filter((s) => (isObj(s) && s.id) || (skip('sessions'), false)).map(clone);
  out.bodyweight = (Array.isArray(input.bodyweight) ? input.bodyweight : []).filter((w) => (isObj(w) && isDayKey(w.day) && num(w.kg, 20, 400) !== null) || (skip('weights'), false)).map(clone);
  out.measurements = (Array.isArray(input.measurements) ? input.measurements : []).filter((m) => (isObj(m) && m.id) || (skip('measurements'), false)).map(clone);
  out.chat = (Array.isArray(input.chat) ? input.chat : []).filter((c) => (isObj(c) && c.id && typeof c.content === 'string' && (c.role === 'user' || c.role === 'assistant')) || (skip('chat'), false)).map(clone);
  for (const [day, v] of Object.entries(isObj(input.daily) ? input.daily : {})) {
    if (!isDayKey(day) || !isObj(v)) { skip('daily'); continue; }
    out.daily[day] = clone(v);
  }
  return { ok: true, data: stripSecrets(out), skipped };
}

// ───────────────────────── legacy → v1 ─────────────────────────

function fromNutriproGym(obj) {
  // diary_entries are grouped by date in file order so ids match a raw NutriPro migration (n:<day>:<idx>)
  const log = {};
  for (const e of Array.isArray(obj.diary_entries) ? obj.diary_entries : []) {
    if (!isObj(e) || !isDayKey(e.date)) continue;
    const n = isObj(e.nutrition) ? e.nutrition : {};
    (log[e.date] ||= []).push({ name: e.name, qty: e.qty, unit: e.unit, section: e.section, time: e.time,
      cal: n.calories, pro: n.protein, carb: n.carbohydrates, fat: n.fat });
  }
  const weightLog = {};
  for (const w of Array.isArray(obj.weight_log) ? obj.weight_log : []) if (isObj(w) && isDayKey(w.date)) weightLog[w.date] = w.weight_kg;
  return { log, weightLog };
}

/** Turn any accepted object into a v1 data object (or an error code). */
export function toV1(obj, { now = new Date() } = {}) {
  const format = detectFormat(obj);
  const legacy = (input) => {
    const { data, report } = migrateLegacy(input, { now });
    if (!report.ok) return { format, error: 'invalid_data' };
    data.meta.legacyRaw = {}; data.meta.migratedFrom = { nutri: null, gym: null }; // the file itself is the raw copy
    return { format, data, legacyReport: report };
  };
  switch (format) {
    case 'v1': {
      if (num(obj.schema, 1, 1e6) === null) return { format, error: 'invalid_data' };
      if (obj.schema > SCHEMA_VERSION) return { format, error: 'newer_schema' };
      const v = validateV1(obj.data);
      return v.ok ? { format, data: v.data, skipped: v.skipped } : { format, error: 'invalid_data' };
    }
    case 'nutripro_foods_v1': return legacy({ nutri: JSON.stringify({ foods: obj.foods }) });
    case 'nutripro_meals_v1': return legacy({ nutri: JSON.stringify({ savedMeals: obj.savedMeals }) });
    case 'nutripro_gym_v1': return legacy({ nutri: JSON.stringify(fromNutriproGym(obj)) });
    case 'nutripro_raw': return legacy({ nutri: JSON.stringify(obj) });
    case 'sologym_raw': return legacy({ gym: JSON.stringify(obj) });
    case 'sologym_v21': return legacy({ gym: JSON.stringify(obj.data) });
    default: return { format, error: 'unknown_format' };
  }
}

// ───────────────────────── import ─────────────────────────

/**
 * importBackup(input, existing, {mode:'merge'|'replace'}) → {ok, format, data, stats, error?, message?}
 * input: file text or parsed object. On any error `data` is the untouched existing object.
 */
export function importBackup(input, existing, { mode = 'merge', now = new Date() } = {}) {
  const fail = (error, format = null) => ({ ok: false, format, error, message: IMPORT_ERRORS[error], data: existing, stats: null });
  let obj = input;
  if (typeof input === 'string') {
    const t = input.trim();
    if (!t) return fail('empty');
    if (!/^[[{]/.test(t) && /[,;]/.test(t.split('\n')[0] || '')) return fail('csv_unsupported', 'csv');
    const p = safeParseJSON(t);
    if (!p.ok) return fail('invalid_json');
    obj = p.value;
  }
  const r = toV1(obj, { now });
  if (r.error) return fail(r.error, r.format);
  const incoming = stripSecrets(r.data);
  if (mode === 'replace') {
    const base = emptyData(now);
    const keepMeta = existing && existing.meta ? existing.meta : base.meta;
    const { data, stats } = mergeData(null, incoming);
    data.meta = { ...keepMeta, issues: keepMeta.issues || [] };
    return { ok: true, format: r.format, mode, data, stats, skipped: r.skipped || {} };
  }
  const { data, stats } = mergeData(existing, incoming);
  return { ok: true, format: r.format, mode, data, stats, skipped: r.skipped || {} };
}

/** DB convenience: snapshot current data, import, persist. Never writes on a failed import. */
export async function importBackupToDB(db, input, opts = {}) {
  const { data: existing, empty } = await loadData(db);
  const res = importBackup(input, empty ? null : existing, opts);
  if (!res.ok) return res;
  if (!empty) await writeSnapshot(db, existing, { now: opts.now });
  await saveData(db, res.data, { replace: res.mode === 'replace' });
  return res;
}

/** Mark that a new-format backup was made (gates deleting legacy keys in a later release). */
export function markBackedUp(data, now = new Date()) {
  return { ...data, meta: { ...data.meta, lastBackupAt: now.toISOString() } };
}

