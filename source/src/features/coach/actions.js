// Coach actions (pure): parse [[ACTION:{…}]] proposals out of a reply, validate them, and the local fast path
// «ضيف 150 جرام صدر فراخ» (works offline, no API call). Nothing here writes; cards.js asks for confirmation.
import * as NU from '../nutrition/logic.js';

const SECTIONS = ['breakfast', 'lunch', 'dinner', 'snack'];
const clean = (v, max = 80) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** Arabic-Indic / Persian digits and the Arabic decimal mark → ASCII. */
export const asciiDigits = (t) => String(t ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0)).replace(/٫/g, '.');
/**
 * Tolerant number: 250 | "250" | "٢٥٠" | "150 جم" | "150g" | "250 kcal" | "≈ 250" → 250. A range («150-200») or text → null.
 * Only a single leading number followed by an optional unit word is accepted.
 */
export function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = asciiDigits(v).replace(/[\u200e\u200f\u061c]/g, '').trim().replace(/^[~≈±]\s*/, '');
  const m = /^(\d+(?:[.,]\d+)?)\s*([\u0600-\u06FFa-zA-Z. ]{0,14})$/.exec(t);
  return m ? Number(m[1].replace(',', '.')) : null;
}
/** Unit word that may trail a number string («150 جم» → 'جم'). */
const unitOf = (v) => (typeof v === 'string' ? (/^[^\d٠-٩۰-۹]*[\d٠-٩۰-۹.,٫]+\s*([\u0600-\u06FFa-zA-Z]{1,12})/.exec(v.trim()) || [])[1] || '' : '');
const numIn = (v, min, max) => { const x = toNum(v); return x !== null && x >= min && x <= max ? Math.round(x * 10) / 10 : null; };

function item(it) {
  if (!it || typeof it !== 'object') return null;
  const name = clean(it.name); const grams = numIn(it.grams ?? it.qty, 0.1, 5000);
  if (!name || !grams) return null;
  return { name, grams, kcal: numIn(it.kcal, 0, 10000) ?? 0, p: numIn(it.p, 0, 1000) ?? 0, c: numIn(it.c, 0, 1000) ?? 0, f: numIn(it.f, 0, 1000) ?? 0 };
}

// ── workout proposals (schema only; program-level guards live in workout/coach-bridge.js planChange) ──
const id40 = (v) => { const x = typeof v === 'string' || typeof v === 'number' ? String(v).trim().replace(/\s+/g, ' ') : ''; return /^[A-Za-z0-9_\-؀-ۿ ]{1,40}$/.test(x) ? x : ''; };
const int = (v, min, max) => { const x = numIn(v, min, max); return x !== null && Number.isInteger(x) ? x : null; };
const repsStr = (v) => { const t = String(v ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[–—]/g, '-').replace(/\s+/g, ''); const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(t); if (!m) return null; const lo = +m[1], hi = +(m[2] ?? m[1]); return lo >= 3 && hi <= 30 && lo <= hi ? (m[2] ? `${lo}-${hi}` : String(lo)) : null; };
const reason = (a) => (clean(a.reason, 200) ? { reason: clean(a.reason, 200) } : {});
const WORKOUT = {
  'workout.prefill': (a) => {
    const day = id40(a.day); if (!day || !Array.isArray(a.items) || !a.items.length || a.items.length > 12) return null;
    const items = [];
    for (const x of a.items) {
      const exId = id40(x && x.exId); const sets = Array.isArray(x && x.sets) ? x.sets : null;
      if (!exId || !sets || !sets.length || sets.length > 10) return null;
      const ss = sets.map((t) => ({ w: numIn(t && t.w, 0, 500), r: int(t && t.r, 1, 30) }));
      if (ss.some((t) => t.w === null || t.r === null)) return null;
      items.push({ exId, sets: ss, ...(clean(x.note, 120) ? { note: clean(x.note, 120) } : {}) });
    }
    return { type: 'workout.prefill', day, items, ...reason(a) };
  },
  'workout.swap': (a) => {
    const day = id40(a.day), fromExId = id40(a.fromExId), toExId = id40(a.toExId);
    return day && fromExId && toExId && fromExId !== toExId ? { type: 'workout.swap', day, fromExId, toExId, ...reason(a) } : null;
  },
  'workout.sets': (a) => {
    const day = id40(a.day), exId = id40(a.exId), sets = int(a.sets, 1, 10);
    const reps = a.reps === undefined || a.reps === null || a.reps === '' ? undefined : repsStr(a.reps);
    return day && exId && sets && reps !== null ? { type: 'workout.sets', day, exId, sets, ...(reps ? { reps } : {}), ...reason(a) } : null;
  },
  'workout.addExercise': (a) => {
    const day = id40(a.day), exId = id40(a.exId), sets = int(a.sets, 1, 10), reps = repsStr(a.reps);
    const pairWith = a.pairWith ? id40(a.pairWith) : '';
    if (a.pairWith && !pairWith) return null;
    return day && exId && sets && reps ? { type: 'workout.addExercise', day, exId, sets, reps, ...(pairWith ? { pairWith } : {}), ...reason(a) } : null;
  },
  'workout.removeExercise': (a) => {
    const day = id40(a.day), exId = id40(a.exId);
    return day && exId ? { type: 'workout.removeExercise', day, exId, ...reason(a) } : null;
  },
  'workout.deload': (a) => {
    if (a.now === true) return { type: 'workout.deload', now: true, ...reason(a) };
    if (typeof a.startWeek === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.startWeek)) return { type: 'workout.deload', startWeek: a.startWeek, ...reason(a) };
    const w = int(a.startWeek, 0, 8);
    if (w === null) return null;
    return w === 0 ? { type: 'workout.deload', now: true, ...reason(a) } : { type: 'workout.deload', startWeek: w, ...reason(a) };
  },
};

// ── food.log: [{name, grams | qty+unit, meal, kcal, p, c, f}] + day + meal (validated; resolution against the DB is foodlog.js) ──
const UNIT_RE = /^[\u0600-\u06FFa-zA-Z ]{1,12}$/;
const GRAM_UNIT_RE = /^(جم|جرام|جرامات|غرام|غرامات|غ|مل|ملي|g|gm|gms|gr|grams?|ml)$/i;
const KG_UNIT_RE = /^(كيلو|كجم|كغ|kg|kilo)$/i;
const ar = (t) => String(t ?? '').trim().toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const MEAL_WORDS = { breakfast: 'breakfast', فطار: 'breakfast', فطور: 'breakfast', الفطار: 'breakfast', الفطور: 'breakfast', lunch: 'lunch', غدا: 'lunch', غداء: 'lunch', الغدا: 'lunch', الغداء: 'lunch',
  dinner: 'dinner', عشا: 'dinner', عشاء: 'dinner', العشا: 'dinner', العشاء: 'dinner', snack: 'snack', snacks: 'snack', سناك: 'snack', تصبيره: 'snack', التصبيره: 'snack' };
/** breakfast|lunch|dinner|snack from the key or an Arabic / English meal word, else null. */
export const mealOf = (v) => (typeof v === 'string' ? MEAL_WORDS[ar(v)] || null : null);
const first = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
function foodItem(it, meal) {
  if (!it || typeof it !== 'object') return null;
  const name = clean(it.name ?? it.food ?? it.item); if (!name) return null;
  const gRaw = first(it, ['grams', 'g', 'gram', 'weight', 'weight_g']);
  const qRaw = first(it, ['qty', 'count', 'amount', 'quantity', 'pieces']);
  const unit = clean(it.unit, 12) || unitOf(qRaw) || '';
  const gramsUnit = GRAM_UNIT_RE.test(unit); const kgUnit = KG_UNIT_RE.test(unit);
  const gUnit = unitOf(gRaw); const gKg = KG_UNIT_RE.test(gUnit);
  const grams = gRaw === undefined ? null : numIn(gKg ? (toNum(gRaw) ?? 0) * 1000 : gRaw, 0.1, 5000);
  const qty0 = qRaw === undefined ? null : toNum(qRaw);
  const qty = qty0 === null ? null : numIn(kgUnit ? qty0 * 1000 : qty0, 0.1, gramsUnit || kgUnit ? 5000 : 100);
  const out = { name, meal: mealOf(it.meal) || mealOf(it.section) || meal };
  if (grams) out.grams = grams;
  else if (qty && (gramsUnit || kgUnit)) out.grams = qty;
  else if (qty) { out.qty = qty; out.unit = unit && UNIT_RE.test(unit) ? unit : 'حبة'; }
  else return null;
  const ALIAS = { kcal: ['kcal', 'calories', 'cal', 'energy'], p: ['p', 'protein'], c: ['c', 'carbs', 'carb'], f: ['f', 'fat'] };
  for (const k of ['kcal', 'p', 'c', 'f']) { const v = numIn(first(it, ALIAS[k]), 0, k === 'kcal' ? 10000 : 1000); if (v !== null) out[k] = v; }
  return out;
}
/** 'today' | 'yesterday' | 'YYYY-MM-DD' (also Arabic words, D/M/YYYY, Arabic digits) → normalised ref, or null. */
export function dayRef(d) {
  if (d === undefined || d === null || d === '') return 'today';
  if (typeof d !== 'string') return null;
  const w = ar(d);
  if (/^(today|النهارده|النهاردا|اليوم|انهارده)$/.test(w)) return 'today';
  if (/^(yesterday|امبارح|مبارح|امس|البارح)$/.test(w)) return 'yesterday';
  const t = asciiDigits(d).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t); // D/M/YYYY (UAE / Egypt order)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Arabic name of each proposal type (used in the "ignored" error line). */
export const ACTION_LABEL = Object.freeze({
  log: 'تسجيل أكل', 'food.log': 'تسجيل أكل', adddb: 'إضافة أكلة', goal: 'تغيير الأهداف', 'targets.set': 'تغيير الأهداف', delete: 'مسح تسجيل', water: 'تسجيل مية',
  'workout.prefill': 'أوزان الحصة الجاية', 'workout.swap': 'تبديل تمرين', 'workout.sets': 'تعديل المجموعات',
  'workout.addExercise': 'إضافة تمرين', 'workout.removeExercise': 'شيل تمرين', 'workout.deload': 'أسبوع ديلود',
});
export const KNOWN_TYPES = Object.freeze(Object.keys(ACTION_LABEL));
export const isWorkoutAction = (a) => !!a && typeof a.type === 'string' && a.type.startsWith('workout.');

/** Validate one raw action → normalised action or null. */
export function validateAction(a) {
  if (!a || typeof a !== 'object') return null;
  switch (a.type) {
    case 'log': {
      const items = (Array.isArray(a.items) ? a.items : []).slice(0, 12).map(item).filter(Boolean);
      return items.length ? { type: 'log', section: mealOf(a.section) || mealOf(a.meal), items } : null;
    }
    case 'food.log': {
      const meal = mealOf(a.meal) || mealOf(a.section);
      const day = dayRef(a.day); if (!day) return null;
      const items = (Array.isArray(a.items) ? a.items : []).slice(0, 15).map((x) => foodItem(x, meal)).filter(Boolean);
      return items.length ? { type: 'food.log', day, meal, items } : null;
    }
    case 'adddb': {
      const f = a.food && typeof a.food === 'object' ? a.food : a;
      const name = clean(f.name);
      const kcal = numIn(f.kcal, 0, 10000);
      if (!name || kcal === null) return null;
      return { type: 'adddb', food: { name, per: numIn(f.per, 1, 1000) ?? 100, unit: clean(f.unit, 12) || 'جم', kcal, p: numIn(f.p, 0, 1000) ?? 0, c: numIn(f.c, 0, 1000) ?? 0, f: numIn(f.f, 0, 1000) ?? 0, fiber: numIn(f.fiber, 0, 200) ?? 0 } };
    }
    case 'goal':
    case 'targets.set': {
      const dayType = ['training', 'rest', 'heart'].includes(a.dayType) ? a.dayType : null;
      if (!dayType) return null;
      const src = a.values && typeof a.values === 'object' ? a.values : a;
      const v = { kcal: numIn(src.kcal, 800, 6000), p: numIn(src.p, 0, 500), c: numIn(src.c, 0, 1000), f: numIn(src.f, 0, 400) };
      if (Object.values(v).every((x) => x === null)) return null;
      return { type: 'goal', dayType, values: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)), ...(clean(a.reason, 200) ? { reason: clean(a.reason, 200) } : {}) };
    }
    case 'delete': {
      const entryId = clean(a.entryId ?? a.id, 60);
      return entryId ? { type: 'delete', entryId } : null;
    }
    case 'water': {
      const ml = numIn(a.ml, 50, 3000);
      return ml ? { type: 'water', ml: Math.round(ml) } : null;
    }
    default: return WORKOUT[a.type] ? WORKOUT[a.type](a) : null;
  }
}

/** End index (exclusive) of the balanced JSON value starting at s[i] ('{' or '['), or -1. Strings are honoured. */
export function jsonEnd(s, i) {
  const open = s[i]; if (open !== '{' && open !== '[') return -1;
  let depth = 0, str = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') str = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return k + 1; }
  }
  return -1;
}

/**
 * JSON.parse with the repairs models need: smart quotes, Arabic-Indic digits outside strings, trailing commas,
 * a «//» line comment. Returns the value or undefined (never throws).
 */
export function parseLooseJson(src) {
  const t = String(src ?? '').trim();
  try { return JSON.parse(t); } catch { /* repair below */ }
  let out = ''; let str = false; let esc = false;
  const s = t.replace(/[“”„]/g, '"');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (str) { out += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') { str = true; out += ch; continue; }
    if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    out += /[٠-٩۰-۹٫]/.test(ch) ? asciiDigits(ch) : ch;
  }
  out = out.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(out); } catch { return undefined; }
}

const FOOD_TYPES = ['food.log', 'log'];
/** Start of an action marker: [[ACTION:, [[ action :, [ACTION: (case-insensitive). */
const MARK_RE = /\[\[?\s*ACTION\s*:\s*/gi;

/**
 * Reply text → {text (visible), actions[], errors[], dropped[]}. Accepts [[ACTION:{…}]] (also [ACTION:…], spaced, lower
 * case), fenced ```json {…}``` / [{…}] blocks and bare {"type":"…"} objects, plus the older trailing {"items":[…]} JSON.
 * JSON is repaired tolerantly (parseLooseJson). Unknown types are dropped silently; a known type that is invalid,
 * malformed or cut off (max_tokens / stream end) adds an Arabic line to errors AND a {type, why} record to dropped,
 * so the caller can fall back instead of losing it. Never throws.
 */
export function parseActions(raw) {
  let text = String(raw ?? '');
  const actions = []; const errors = []; const dropped = [];
  const drop = (type, why) => {
    dropped.push({ type, why });
    errors.push(`المدرب اقترح «${ACTION_LABEL[type] || 'تعديل'}» بأرقام مش سليمة، فتجاهلناه. اطلبه تاني.`);
  };
  const take = (v) => {
    for (const a of (Array.isArray(v) ? v : [v]).slice(0, 8)) {
      if (!a || typeof a !== 'object' || typeof a.type !== 'string') continue;
      if (!KNOWN_TYPES.includes(a.type)) continue;
      const ok = validateAction(a);
      if (ok) actions.push(ok); else drop(a.type, 'invalid');
    }
  };
  const guessType = (frag) => { const m = /"type"\s*:\s*"([^"]{1,40})"/.exec(frag); return m && KNOWN_TYPES.includes(m[1]) ? m[1] : null; };
  const isActionJson = (v) => (Array.isArray(v) ? v.some((x) => x && typeof x.type === 'string') : !!v && typeof v === 'object' && typeof v.type === 'string');
  // 1) action markers (balanced scan, so "]]" inside nested arrays can't cut the JSON)
  for (let mm, guard = 0; (MARK_RE.lastIndex = 0, mm = MARK_RE.exec(text)) && guard < 20; guard++) {
    const i = mm.index; const j = i + mm[0].length;
    const e = jsonEnd(text, j);
    if (e < 0) { // cut off (max_tokens / stream end) or not JSON at all
      const z = text.indexOf(']]', j);
      const frag = text.slice(j, z < 0 ? undefined : z);
      const t = guessType(frag); if (t) drop(t, z < 0 ? 'truncated' : 'malformed');
      text = text.slice(0, i) + (z < 0 ? '' : text.slice(z + 2));
      continue;
    }
    let k = e; while (/\s/.test(text[k] || '')) k++;
    let n = 0; while (n < 2 && text[k + n] === ']') n++;
    const v = parseLooseJson(text.slice(j, e));
    if (v === undefined) { const t = guessType(text.slice(j, e)); if (t) drop(t, 'malformed'); } else take(v);
    text = text.slice(0, i) + text.slice(k + n);
  }
  // 2) fenced blocks holding action JSON
  text = text.replace(/```(?:json|JSON)?\s*([\s\S]*?)```/g, (m, body) => {
    const b = body.trim();
    const v = parseLooseJson(b);
    if (v !== undefined && isActionJson(v)) { take(v); return ''; }
    const lines = b.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const objs = []; for (const l of lines) { const o = parseLooseJson(l); if (o === undefined) { objs.length = 0; break; } objs.push(o); }
    if (objs.length && objs.every(isActionJson)) { objs.forEach(take); return ''; }
    const t = /^\s*[[{]/.test(b) ? guessType(b) : null; // an action-looking fence we could not read
    if (t) { drop(t, 'malformed'); return ''; }
    return m;
  });
  // 3) bare {"type":"…"} objects in the prose
  const re = /\{\s*"type"\s*:/g; let mm;
  while ((mm = re.exec(text))) {
    const e = jsonEnd(text, mm.index);
    if (e < 0) { const t = guessType(text.slice(mm.index)); if (t) drop(t, 'truncated'); break; }
    const v = parseLooseJson(text.slice(mm.index, e));
    if (v && KNOWN_TYPES.includes(v.type)) { take(v); text = text.slice(0, mm.index) + text.slice(e); re.lastIndex = mm.index; }
    else if (v === undefined) { const t = guessType(text.slice(mm.index, e)); if (t) { drop(t, 'malformed'); text = text.slice(0, mm.index) + text.slice(e); re.lastIndex = mm.index; } }
  }
  if (!actions.length && /\{\s*"items"\s*:/.test(text)) {
    const r = NU.splitCoachReply(text);
    if (r.items) { const a = validateAction({ type: 'log', items: r.items }); if (a) actions.push(a); else drop('log', 'invalid'); text = r.text; }
  }
  text = stripLeftovers(text);
  if (!text && actions.length) text = 'راجع المقترح ده قبل ما يتسجّل:';
  return { text, actions, errors, dropped };
}
export const isFoodAction = (a) => !!a && FOOD_TYPES.includes(a.type);

// ── «سجلت / اتسجل» claims: only the app may say something was logged (after a verified write) ──
const D = '[\\u064B-\\u0652\\u0640]*'; // optional harakat / tatweel between letters
const word = (w) => [...w].map((ch) => (ch === 'ا' ? '[اأإآ]' : ch === 'ه' ? '[هة]' : ch === 'ي' ? '[يى]' : ch) + D).join('');
const NOT_BEFORE = '(?<!(?:ما|مش|لم|لا|مـا)\\s)(?<![\\u0600-\\u06FF])';
const NOT_AFTER = '(?!ش)(?![\\u0600-\\u06FF])';
// first person «I logged / added» → «فهمت»
const FIRST = ['سجلت', 'سجلتلك', 'سجلتهولك', 'سجلتهالك', 'سجلتها', 'سجلته', 'سجلتهم', 'سجلنا', 'سجلناه', 'سجلناها', 'سجلناهالك', 'سجلنالك',
  'ضفت', 'ضفتلك', 'ضفتها', 'ضفته', 'ضفتهولك', 'اضفت', 'اضفتلك', 'اضفتها', 'اضفته', 'ضفنا', 'ضفناها', 'قيدت', 'قيدتلك', 'قيدتها'];
const FIRST_RE = new RegExp(`${NOT_BEFORE}(?:خلاص\\s+|تمام\\s+)?(?:${FIRST.sort((a, b) => b.length - a.length).map(word).join('|')})${NOT_AFTER}`, 'g');
// passive / done statements «اتسجل», «تم التسجيل», «✅» → the sentence goes
const PASSIVE = ['اتسجل', 'اتسجلت', 'اتسجلو', 'اتسجلوا', 'اتضاف', 'اتضافت', 'اتضافو', 'اتقيد', 'اتقيدت', 'تسجلت', 'انضاف', 'انضافت'];
const PASSIVE_RE = new RegExp(`${NOT_BEFORE}(?:${PASSIVE.map(word).join('|')})${NOT_AFTER}|${NOT_BEFORE}تم${D}(?:ت${D})?\\s+(?:ال)?(?:${['تسجيل', 'اضافه', 'اضافة', 'حفظ'].map(word).join('|')})|✅|\\b(?:logged|added to your log)\\b`, 'i');
/** True when the text claims something was already logged / added. */
export const claimsLogged = (t) => { FIRST_RE.lastIndex = 0; return FIRST_RE.test(String(t ?? '')) || PASSIVE_RE.test(String(t ?? '')); };
/**
 * Rewrites model text so it never claims a write: «سجلتلك 150 جم كبدة» → «فهمت 150 جم كبدة»; a sentence with a passive /
 * done claim («اتسجل في الغدا», «تم التسجيل ✅») is removed. Everything else is kept as is.
 */
export function stripLogClaims(t) {
  const src = String(t ?? '');
  if (!claimsLogged(src)) return src.trim();
  const lines = src.split('\n').map((line) => {
    const parts = line.split(/(?<=[.!؟?…])\s+/);
    return parts.map((p) => (PASSIVE_RE.test(p) ? '' : p.replace(FIRST_RE, 'فهمت'))).filter((x) => x.trim()).join(' ');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^[\s،,.:]+/, '').trim();
}

/** Removes what must never be shown: an unclosed ``` block, a cut [[ACTION / {"type" / {"items" tail, empty fences. */
export function stripLeftovers(t) {
  let text = String(t ?? '');
  const cut = (re) => { const m = re.exec(text); if (m) text = text.slice(0, m.index); };
  if ((text.match(/```/g) || []).length % 2) cut(/```(?![\s\S]*```)/);
  cut(/\[\[?\s*ACTION\s*:[\s\S]*$/i);
  // a JSON object that starts like an action but never closes (cut by max_tokens / still streaming)
  for (const m of text.matchAll(/\{\s*"(?:type|items)"\s*:/g)) { if (jsonEnd(text, m.index) < 0) { text = text.slice(0, m.index); break; } }
  cut(/\[\[?\s*$/);
  return text.replace(/```(?:json|JSON)?\s*```/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** Live view of a streaming reply: complete action blocks removed, anything that starts an action / JSON hidden. */
export function streamVisible(raw) {
  let t = String(raw ?? '').replace(/\[\[?\s*ACTION\s*:[\s\S]*?\]\]?(?=\s|$)/gi, '');
  t = t.replace(/```(?:json|JSON)?[\s\S]*?```/g, (m) => (/\{\s*"/.test(m) ? '' : m));
  return stripLogClaims(stripLeftovers(t)); // never flash «سجلت» while streaming either
}

const WORDS = [['ميتين وخمسين', 250], ['مية وخمسين', 150], ['تلتمية', 300], ['ربعمية', 400], ['خمسمية', 500], ['ستمية', 600], ['ميتين', 200], ['مية', 100], ['ميه', 100], ['نص كيلو', 500], ['ربع كيلو', 250], ['كيلو', 1000]];
const SECTION_WORDS = [['فطار', 'breakfast'], ['فطور', 'breakfast'], ['غدا', 'lunch'], ['غداء', 'lunch'], ['عشا', 'dinner'], ['عشاء', 'dinner'], ['سناك', 'snack']];

/** «ضيف 150 جرام صدر فراخ للغدا» → {grams:150, query:'صدر فراخ', section:'lunch'} | null */
export function parseLogCommand(input) {
  let t = String(input || '').trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[٫,]/g, '.');
  const m0 = /^(?:ضيف(?:لي)?|ضيفلى|سجّل(?:لي)?|سجل(?:لي)?|اكلت|أكلت|كلت)\s+(.+)$/.exec(t);
  if (!m0) return null;
  t = m0[1];
  for (const [w, n] of WORDS) if (t.startsWith(`${w} `)) { t = `${n} ${t.slice(w.length + 1)}`; break; }
  const m = /^(\d{1,4}(?:\.\d+)?)\s*(?:جرام|جم|غرام|جرامات|g|gm|gr)?\s+(.+)$/i.exec(t);
  if (!m) return null;
  const grams = Number(m[1]);
  if (!(grams > 0 && grams <= 5000)) return null;
  let query = m[2].trim(); let section = null;
  for (const [w, k] of SECTION_WORDS) {
    const re = new RegExp(`\\s+(?:في|فى|على|عل|لل|ل)?\\s*(?:ال)?${w}$`);
    if (re.test(query)) { section = k; query = query.replace(re, '').trim(); break; }
  }
  return query ? { grams, query, section } : null;
}
