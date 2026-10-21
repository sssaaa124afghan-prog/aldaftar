// Coach actions (pure): parse [[ACTION:{…}]] proposals out of a reply, validate them, and the local fast path
// «ضيف 150 جرام صدر فراخ» (works offline, no API call). Nothing here writes; cards.js asks for confirmation.
import * as NU from '../nutrition/logic.js';

const SECTIONS = ['breakfast', 'lunch', 'dinner', 'snack'];
const clean = (v, max = 80) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const numIn = (v, min, max) => { const x = typeof v === 'string' ? Number(v) : v; return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? Math.round(x * 10) / 10 : null; };

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
function foodItem(it, meal) {
  if (!it || typeof it !== 'object') return null;
  const name = clean(it.name); if (!name) return null;
  const grams = numIn(it.grams ?? it.g, 0.1, 5000);
  const unit = clean(it.unit, 12);
  const gramsUnit = /^(جم|جرام|غرام|مل|g|gm|gr|grams?|ml)$/i.test(unit);
  const qty = numIn(it.qty ?? it.count, 0.1, gramsUnit ? 5000 : 100);
  const out = { name, meal: SECTIONS.includes(it.meal) ? it.meal : (SECTIONS.includes(it.section) ? it.section : meal) };
  if (grams) out.grams = grams;
  else if (qty && gramsUnit) out.grams = qty;
  else if (qty) { out.qty = qty; out.unit = unit && UNIT_RE.test(unit) ? unit : 'حبة'; }
  else return null;
  for (const k of ['kcal', 'p', 'c', 'f']) { const v = numIn(it[k], 0, k === 'kcal' ? 10000 : 1000); if (v !== null) out[k] = v; }
  return out;
}
/** 'today' | 'yesterday' | 'YYYY-MM-DD' → kept as given (resolved against ctx.today() in foodlog.resolveDay). */
const dayRef = (d) => (d === undefined || d === null || d === '' || d === 'today' || d === 'النهارده' ? 'today' : d === 'yesterday' || d === 'امبارح' ? 'yesterday' : typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

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
      return items.length ? { type: 'log', section: SECTIONS.includes(a.section) ? a.section : null, items } : null;
    }
    case 'food.log': {
      const meal = SECTIONS.includes(a.meal) ? a.meal : (SECTIONS.includes(a.section) ? a.section : null);
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
 * Reply text → {text (visible), actions[], errors[]}. Accepts [[ACTION:{…}]], fenced ```json {…}``` / [{…}] blocks and bare
 * {"type":"workout.…"} objects, plus the older trailing {"items":[…]} JSON. Unknown types are dropped silently; a known type
 * with invalid fields adds an Arabic line to errors. Never throws.
 */
export function parseActions(raw) {
  let text = String(raw ?? '');
  const actions = []; const errors = [];
  const take = (v) => {
    for (const a of (Array.isArray(v) ? v : [v]).slice(0, 8)) {
      if (!a || typeof a !== 'object' || typeof a.type !== 'string') continue;
      if (!KNOWN_TYPES.includes(a.type)) continue;
      const ok = validateAction(a);
      if (ok) actions.push(ok); else errors.push(`المدرب اقترح «${ACTION_LABEL[a.type]}» بأرقام مش سليمة، فتجاهلناه. اطلبه تاني.`);
    }
  };
  const isActionJson = (v) => (Array.isArray(v) ? v.some((x) => x && typeof x.type === 'string') : !!v && typeof v === 'object' && typeof v.type === 'string');
  // 1) [[ACTION:{…}]] (balanced scan, so "]]" inside nested arrays can't cut the JSON)
  for (let i = text.indexOf('[[ACTION:'); i >= 0; i = text.indexOf('[[ACTION:', i)) {
    let j = i + 9; while (/\s/.test(text[j] || '')) j++;
    const e = jsonEnd(text, j);
    let k = e; if (e > 0) { while (/\s/.test(text[k] || '')) k++; }
    if (e < 0 || text.slice(k, k + 2) !== ']]') { const z = text.indexOf(']]', i); text = text.slice(0, i) + (z < 0 ? '' : text.slice(z + 2)); continue; }
    try { take(JSON.parse(text.slice(j, e))); } catch { /* ignore malformed */ }
    text = text.slice(0, i) + text.slice(k + 2);
  }
  // 2) fenced blocks holding action JSON
  text = text.replace(/```(?:json|JSON)?\s*([\s\S]*?)```/g, (m, body) => {
    const b = body.trim();
    try { const v = JSON.parse(b); if (isActionJson(v)) { take(v); return ''; } } catch { /* maybe one object per line */ }
    const lines = b.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const objs = []; for (const l of lines) { try { objs.push(JSON.parse(l)); } catch { return m; } }
    if (objs.length && objs.every(isActionJson)) { objs.forEach(take); return ''; }
    return m;
  });
  // 3) bare {"type":"…"} objects in the prose
  const re = /\{\s*"type"\s*:/g; let mm;
  while ((mm = re.exec(text))) {
    const e = jsonEnd(text, mm.index);
    if (e < 0) break;
    let v = null; try { v = JSON.parse(text.slice(mm.index, e)); } catch { /* not JSON */ }
    if (v && KNOWN_TYPES.includes(v.type)) { take(v); text = text.slice(0, mm.index) + text.slice(e); re.lastIndex = mm.index; }
  }
  if (!actions.length && /\{\s*"items"\s*:/.test(text)) {
    const r = NU.splitCoachReply(text);
    if (r.items) { const a = validateAction({ type: 'log', items: r.items }); if (a) actions.push(a); text = r.text; }
  }
  text = stripLeftovers(text);
  if (!text && actions.length) text = 'راجع المقترح ده قبل ما يتسجّل:';
  return { text, actions, errors };
}

/** Removes what must never be shown: an unclosed ``` block, a cut [[ACTION / {"type" / {"items" tail, empty fences. */
export function stripLeftovers(t) {
  let text = String(t ?? '');
  const cut = (re) => { const m = re.exec(text); if (m) text = text.slice(0, m.index); };
  if ((text.match(/```/g) || []).length % 2) cut(/```(?![\s\S]*```)/);
  cut(/\[\[\s*ACTION[\s\S]*$/);
  // a JSON object that starts like an action but never closes (cut by max_tokens / still streaming)
  for (const m of text.matchAll(/\{\s*"(?:type|items)"\s*:/g)) { if (jsonEnd(text, m.index) < 0) { text = text.slice(0, m.index); break; } }
  cut(/\[\[?\s*$/);
  return text.replace(/```(?:json|JSON)?\s*```/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** Live view of a streaming reply: complete action blocks removed, anything that starts an action / JSON hidden. */
export function streamVisible(raw) {
  let t = String(raw ?? '').replace(/\[\[ACTION:[\s\S]*?\]\](?=\s|$)/g, '');
  t = t.replace(/```(?:json|JSON)?[\s\S]*?```/g, (m) => (/\{\s*"/.test(m) ? '' : m));
  return stripLeftovers(t);
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
