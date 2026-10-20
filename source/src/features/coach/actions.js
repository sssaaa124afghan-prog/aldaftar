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

/** Validate one raw action → normalised action or null. */
export function validateAction(a) {
  if (!a || typeof a !== 'object') return null;
  switch (a.type) {
    case 'log': {
      const items = (Array.isArray(a.items) ? a.items : []).slice(0, 12).map(item).filter(Boolean);
      return items.length ? { type: 'log', section: SECTIONS.includes(a.section) ? a.section : null, items } : null;
    }
    case 'adddb': {
      const f = a.food && typeof a.food === 'object' ? a.food : a;
      const name = clean(f.name);
      const kcal = numIn(f.kcal, 0, 10000);
      if (!name || kcal === null) return null;
      return { type: 'adddb', food: { name, per: numIn(f.per, 1, 1000) ?? 100, unit: clean(f.unit, 12) || 'جم', kcal, p: numIn(f.p, 0, 1000) ?? 0, c: numIn(f.c, 0, 1000) ?? 0, f: numIn(f.f, 0, 1000) ?? 0, fiber: numIn(f.fiber, 0, 200) ?? 0 } };
    }
    case 'goal': {
      const dayType = a.dayType === 'rest' ? 'rest' : a.dayType === 'training' ? 'training' : null;
      if (!dayType) return null;
      const v = { kcal: numIn(a.kcal, 800, 6000), p: numIn(a.p, 0, 500), c: numIn(a.c, 0, 1000), f: numIn(a.f, 0, 400) };
      if (Object.values(v).every((x) => x === null)) return null;
      return { type: 'goal', dayType, values: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) };
    }
    case 'delete': {
      const entryId = clean(a.entryId ?? a.id, 60);
      return entryId ? { type: 'delete', entryId } : null;
    }
    case 'water': {
      const ml = numIn(a.ml, 50, 3000);
      return ml ? { type: 'water', ml: Math.round(ml) } : null;
    }
    default: return null;
  }
}

/** Reply text → {text (visible), actions[]}. Also accepts the older trailing {"items":[…]} JSON. Never throws. */
export function parseActions(raw) {
  let text = String(raw ?? '');
  const actions = [];
  text = text.replace(/\[\[ACTION:([\s\S]*?)\]\]/g, (_, json) => {
    try { const a = validateAction(JSON.parse(json)); if (a) actions.push(a); } catch { /* ignore malformed */ }
    return '';
  });
  if (!actions.length && /\{\s*"items"\s*:/.test(text)) {
    const r = NU.splitCoachReply(text);
    if (r.items) { const a = validateAction({ type: 'log', items: r.items }); if (a) actions.push(a); text = r.text; }
  }
  text = text.replace(/```(?:json)?\s*```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text && actions.length) text = 'راجع المقترح ده قبل ما يتسجّل:';
  return { text, actions };
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
