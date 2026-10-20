// Schema v1 of the in-memory data object. db.js maps it to IndexedDB stores,
// backup.js serialises it, migrate.js produces it from the legacy apps.

export const SCHEMA_VERSION = 1;
export const APP_ID = 'fitness-companion'; // placeholder until the app name is chosen

/** Keys that must never leave the device (backup, AI context, logs). */
export const SECRET_KEY_NAMES = /^(aiKey|claudeKey|apiKey|anthropicKey|groqKey|geminiKey|x-api-key|secrets)$/i;
/** Token shapes of Anthropic / Groq / Google keys, scrubbed from free text. */
export const SECRET_VALUE_RE = /(sk-ant-[A-Za-z0-9_\-]{8,}|gsk_[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_\-]{20,})/g;

export const DEFAULT_TRAINING_DAYS = [1, 2, 4, 5]; // Mon, Tue, Thu, Fri (Date#getDay numbering)

export const DEFAULT_TARGETS = Object.freeze({
  training: Object.freeze({ kcal: 2600, p: 160, c: 330, f: 70 }),
  rest: Object.freeze({ kcal: 2050, p: 160, c: 200, f: 65 }),
  // Heart Day (Saturday on the 4-day plan, review S2): 30 min cardio, no lifting → between rest and training.
  heart: Object.freeze({ kcal: 2300, p: 160, c: 260, f: 68 }),
});
export const DAY_TYPES = Object.freeze(['training', 'rest', 'heart']);
/** Weekday (Date#getDay) of the Heart Day per program template; templates without one are absent. */
export const HEART_DOW = Object.freeze({ ul4c: 6 });
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
