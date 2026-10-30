// Schema v1 of the in-memory data object. db.js maps it to IndexedDB stores,
// backup.js serialises it, migrate.js produces it from the legacy apps.

export const SCHEMA_VERSION = 1;
export const APP_ID = 'fitness-companion'; // placeholder until the app name is chosen

/** Keys that must never leave the device (backup, AI context, logs). */
export const SECRET_KEY_NAMES = /^(aiKey|claudeKey|apiKey|anthropicKey|groqKey|geminiKey|x-api-key|secrets)$/i;
/** Token shapes of Anthropic / Groq / Google keys, scrubbed from free text. */
export const SECRET_VALUE_RE = /(sk-ant-[A-Za-z0-9_\-]{8,}|gsk_[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_\-]{20,})/g;

export const DEFAULT_TRAINING_DAYS = [1, 2, 4, 5]; // Mon, Tue, Thu, Fri (Date#getDay numbering)

// Defaults for the owner (72 kg, 175 cm, 27 y, male; growth-assessment.md §0.5): weekly average ≈ 2,700 = maintenance to +5 %.
// Protein 155 g (≈ 2.15 g/kg), fat 70 g (≈ 0.97 g/kg), carbs fill the rest so kcal = 4P + 4C + 9F exactly.
export const DEFAULT_TARGETS = Object.freeze({
  training: Object.freeze({ kcal: 2850, p: 155, c: 400, f: 70 }),
  rest: Object.freeze({ kcal: 2350, p: 155, c: 275, f: 70 }),
  // Heart Day (Saturday on the 4-day plan, review S2): 30 min cardio, no lifting → between rest and training.
  heart: Object.freeze({ kcal: 2550, p: 155, c: 325, f: 70 }),
});
/** The previous defaults (before 20/10/2026): stored targets still equal to these are migrated silently. */
export const LEGACY_DEFAULT_TARGETS = Object.freeze({
  training: Object.freeze({ kcal: 2600, p: 160, c: 330, f: 70 }),
  rest: Object.freeze({ kcal: 2050, p: 160, c: 200, f: 65 }),
  heart: Object.freeze({ kcal: 2300, p: 160, c: 260, f: 68 }),
});
export const DEFAULT_HEIGHT_CM = 175;
export const DEFAULT_BODY_KG = 72;
export const DAY_TYPES = Object.freeze(['training', 'rest', 'heart']);
/**
 * Weekly cardio day per program template (Date#getDay) and what it is. ul4c from template v3: Thursday Boxing Day
 * (Sat UA · Sun LA · Tue UB · Wed LB · Thu boxing); a ul4c record still on v1–v2 keeps the Saturday Heart Day until he
 * answers the «تحديث الخطة» card. Nutrition uses the 'heart' day type (2550) for both. Templates without one are absent.
 */
export const CARDIO_DAY = Object.freeze({ ul4c: Object.freeze({ dow: 4, kind: 'boxing', since: 3, legacy: Object.freeze({ dow: 6, kind: 'heart' }) }) });
/** Weekday of the cardio day on the current template version (kept for older imports). */
export const HEART_DOW = Object.freeze({ ul4c: CARDIO_DAY.ul4c.dow });
/** The 4-day plan's lifting days from template v3 (Sat, Sun, Tue, Wed) and before it (Mon, Tue, Thu, Fri). */
export const UL4C_TRAINING_DAYS = Object.freeze([0, 2, 3, 6]);
export const UL4C_LEGACY_TRAINING_DAYS = Object.freeze([1, 2, 4, 5]);

/**
 * Boot migration for the default training days (ctx DEFAULTS moved to the v3 layout Sat/Sun/Tue/Wed on 30/10/2026):
 * a user who never saved trainingDays but already has a stored plan on any other layout ran on the old default
 * (Mon/Tue/Thu/Fri) → pin that explicitly so nothing moves under him. → days to write, or null (nothing stored / already v3).
 */
export function pinTrainingDays(rec) {
  if (!rec || typeof rec !== 'object' || !rec.days) return null;
  const v3 = { 6: 'upperA', 0: 'lowerA', 2: 'upperB', 3: 'lowerB' };
  const s = rec.schedule && typeof rec.schedule === 'object' ? rec.schedule : {};
  const same = Object.keys(s).length === 4 && Object.entries(v3).every(([k, v]) => s[k] === v);
  if (rec.v === 2 && rec.activeProgram === 'ul4c' && Number.isInteger(rec.tv) && rec.tv >= 3 && same) return null;
  return [...UL4C_LEGACY_TRAINING_DAYS];
}

/**
 * cardioDayOf({activeProgram, tv, schedule}) → {dow, kind:'boxing'|'heart'} | null for a program record (raw or normalised).
 * Missing tv = 1. When his schedule lifts on the template's cardio weekday (he kept his old days), the cardio day moves to
 * the legacy weekday (Saturday) if that one is free.
 */
export function cardioDayOf(rec) {
  const c = rec && CARDIO_DAY[rec.activeProgram];
  if (!c) return null;
  const tv = Number.isInteger(rec.tv) && rec.tv > 0 ? rec.tv : 1;
  if (c.since && tv < c.since) return { dow: c.legacy.dow, kind: c.legacy.kind };
  const used = new Set(Object.keys((rec.schedule && typeof rec.schedule === 'object' && !Array.isArray(rec.schedule)) ? rec.schedule : {}).map(Number));
  if (!used.has(c.dow)) return { dow: c.dow, kind: c.kind };
  if (c.legacy && !used.has(c.legacy.dow)) return { dow: c.legacy.dow, kind: c.kind };
  return null;
}
export const DEFAULT_PROGRAM_ID = 'ul4c';

export function emptyData(now = new Date()) {
  return {
    meta: { schema: SCHEMA_VERSION, createdAt: now.toISOString(), migratedAt: null, migratedFrom: { nutri: null, gym: null },
      lastBackupAt: null, legacyLastBackupAt: null, legacyRaw: {}, issues: [] },
    settings: { weekStartDow: 1, trainingDays: [...DEFAULT_TRAINING_DAYS], notifications: {}, soundOff: false,
      pinnedNote: '', waterGoalCups: null, ui: {} },
    profile: { name: '', birthYear: null, age: null, sex: null, heightCm: null, activityFactor: null },
    targets: { training: { ...DEFAULT_TARGETS.training }, rest: { ...DEFAULT_TARGETS.rest }, heart: { ...DEFAULT_TARGETS.heart }, isDefault: true },
    foods: [],          // [{id,name,kcal,p,c,f,per,unit,cat,src}]
    foodLog: {},        // {day: [{id,name,qty,unit,kcal,p,c,f,section,time,src}]}
    sessions: [],       // [{id,day,startedAt,dayKey,dayName,durationMin,mood,note,fatigueScore,exercises:[...]}]
    programs: { activeProgram: null, days: null, schedule: null },
    training: {},       // currentSets, doneExs, completedDays, templates, goals, injuries, deload ...
    nutrition: {},      // savedMeals, recipes, favorites, templates, lastQty, archive, dayTypeOverrides ...
    bodyweight: [],     // [{day,kg,src,at}]
    measurements: [],   // [{id,day,at,chest,waist,...}]
    daily: {},          // {day: {waterMl, wellness:{sleep,energy,stress}}}
    wellness: { log: [], recoveryLog: [] },
    chat: [],           // [{id,role:'user'|'assistant',content,at,domain}]
  };
}

/** Deep clone that drops functions; JSON-safe. */
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Finite number in [min,max] or null. */
export function num(v, min = 0, max = 1e6) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Trimmed string capped at max chars, or '' */
export function str(v, max = 200) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}

/** Remove secret-named keys anywhere in a JSON value and scrub key-shaped strings. Returns a new value. */
export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEY_NAMES.test(k)) out[k] = stripSecrets(v);
    return out;
  }
  if (typeof value === 'string') return value.replace(SECRET_VALUE_RE, '[redacted]');
  return value;
}

/** Redact secret fields inside a raw legacy JSON string, keeping the rest byte-for-byte when parseable. */
export function redactRaw(raw) {
  if (typeof raw !== 'string') return raw;
  let s = raw.replace(SECRET_VALUE_RE, '[redacted]');
  // also blank the values of known key fields even if they don't match a token shape
  s = s.replace(/("(?:aiKey|claudeKey|apiKey|groqKey|geminiKey)"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"[redacted]"');
  // personal identifiers (name, job, location…) inside any profile/user object are blanked
  try {
    const o = JSON.parse(s);
    const PII = /^(name|fullName|job|jobTitle|employer|company|workplace|location|city|country|nationality|email|phone)$/i;
    const walk = (v, inProfile) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, inProfile));
      if (!v || typeof v !== 'object') return;
      for (const k of Object.keys(v)) {
        const isProfile = /^(profile|user|userProfile|me|account)$/i.test(k);
        if (inProfile && PII.test(k) && typeof v[k] === 'string') v[k] = '[redacted]';
        else walk(v[k], inProfile || isProfile);
      }
    };
    walk(o, false);
    s = JSON.stringify(o);
  } catch (_) { /* unparseable: keep as-is (already key-scrubbed) */ }
  return s;
}
