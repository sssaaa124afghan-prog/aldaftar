// Nutrition pure logic (no DOM, no db). Tested in logic.test.js.
import { portion, sumEntries, validateQty, QTY_MAX } from '../../core/targets.js';

// ───────────────────────── sections ─────────────────────────

export const SECTIONS = Object.freeze([
  { key: 'breakfast', label: 'فطار' },
  { key: 'lunch', label: 'غدا' },
  { key: 'dinner', label: 'عشا' },
  { key: 'snack', label: 'سناك' },
]);
export const SECTION_LABEL = Object.freeze(Object.fromEntries(SECTIONS.map((s) => [s.key, s.label])));

/** Section key for the hour of day (local). */
export function sectionForHour(hour) {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 20) return 'dinner';
  return 'snack';
}

const LEGACY_SECTION = { 'افطار': 'breakfast', 'فطار': 'breakfast', 'فطور': 'breakfast', 'غداء': 'lunch', 'غدا': 'lunch',
  'عشاء': 'dinner', 'عشا': 'dinner', 'سناك': 'snack', 'سناكس': 'snack', 'وجبه خفيفه': 'snack' };

/** Entry section → one of the 4 keys. Accepts new keys and legacy Arabic labels; unknown → by entry time, else snack. */
export function sectionOf(entry) {
  const raw = entry && entry.section;
  if (typeof raw === 'string') {
    if (SECTION_LABEL[raw]) return raw;
    const k = LEGACY_SECTION[normalizeAr(raw)];
    if (k) return k;
  }
  const t = entry && typeof entry.time === 'string' && /^(\d{1,2}):/.exec(entry.time);
  if (t) return sectionForHour(Number(t[1]));
  return 'snack';
}

/** {breakfast:{entries,totals}, ...} keeping log order. */
export function groupBySection(entries = []) {
  const out = Object.fromEntries(SECTIONS.map((s) => [s.key, { entries: [], totals: { kcal: 0, p: 0, c: 0, f: 0 } }]));
  for (const e of entries) out[sectionOf(e)].entries.push(e);
  for (const k of Object.keys(out)) out[k].totals = sumEntries(out[k].entries);
  return out;
}

// ───────────────────────── Arabic search ─────────────────────────

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/** أإآٱ→ا, ة→ه, ى→ي, ؤ→و, ئ→ي, strip diacritics + tatweel, Arabic-Indic digits → Latin, lowercase, collapse spaces. */
export function normalizeAr(s) {
  return String(s ?? '')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[()\[\],.،؛:\-_/]+/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Same-meaning words across Egyptian / Gulf / MSA (normalised forms). */
export const SYNONYMS = Object.freeze([
  ['فراخ', 'دجاج', 'فرخه'], ['رز', 'ارز'], ['عيش', 'خبز'], ['لبن', 'حليب'], ['زبادي', 'روب', 'لبن رايب'],
  ['تونه', 'تونا'], ['لحمه', 'لحم'], ['بطاطس', 'بطاطا'], ['شوفان', 'اوتس', 'oats'], ['بيض', 'بيضه'],
  ['جبنه', 'جبن'], ['مكرونه', 'معكرونه', 'باستا'], ['موز', 'موزه'], ['فول', 'فول مدمس'], ['واي', 'بروتين واي', 'whey'],
]);
const SYN = new Map();
for (const group of SYNONYMS) for (const w of group) SYN.set(w, group);

/** Light Arabic stem: strips ال/بال/وال/لل, plural/feminine suffixes (ات، ين، ون، ه) and inner و/ي. */
export function stemAr(w) {
  let t = String(w || '');
  if (t.length > 3) t = t.replace(/^(?:وال|بال|فال|كال|لل|ال)/, '');
  if (t.length > 4) t = t.replace(/(?:ات|ين|ون)$/, '');
  return t.replace(/[وي]/g, '').replace(/ه$/, '');
}
const stem = stemAr;

// Multi-word synonyms whose words mean something else on their own («لبن رايب» is yoghurt, «لبن» alone is milk).
// In food names they are read as one token, so «لبن» never counts as a whole-word hit on «لبن رايب».
const COMPOUNDS = SYNONYMS.flatMap((g) => g.filter((w) => w.includes(' ') && !w.split(' ').some((p) => g.includes(p))));
function tokensOf(n) {
  let s = n;
  for (const c of COMPOUNDS) if (s.includes(c)) s = s.split(c).join(c.replace(/ /g, '_'));
  return s.split(' ').filter(Boolean);
}
// synonyms by the word itself or without the article («الفراخ» → فراخ); never by the full stem, so «لبنة» does not pull in milk
const altsOf = (qw) => { const w = qw.replace(/_/g, ' '); return SYN.get(w) || (w.length > 3 && SYN.get(w.replace(/^(?:وال|بال|فال|كال|لل|ال)/, ''))) || [w]; };
/** The everyday meaning of a one-word query (Egyptian usage): «لبن» = whole milk, «رز» = white rice. Small tie-break bonus. */
export const EVERYDAY = Object.freeze({ 'لبن': 'حليب كامل الدسم', 'حليب': 'حليب كامل الدسم', 'بيض': 'بيضه كامله', 'رز': 'ارز ابيض مطبوخ', 'ارز': 'ارز ابيض مطبوخ',
  'عيش': 'عيش بلدي', 'شوفان': 'شوفان جاف', 'واي': 'واي بروتين سكوب', 'زبادي': 'زبادي عادي' });

/**
 * How well one query word matches one food-name token, 0..1.
 * whole word 1 · same stem .9 (.7 when only ة differs) · inside a compound with another meaning .45 · prefix .4 · food word is a prefix .35 · substring .3
 */
function wordQuality(a, fw) {
  if (fw === a) return 1;
  if (fw.includes('_')) return fw.split('_').includes(a) ? 0.45 : fw.startsWith(a) ? 0.4 : 0;
  const sa = stem(a);
  // same stem: plural / article (.9); a word that differs only by ة is often another food (لبن ≠ لبنة) → .7, unity nouns live in SYNONYMS
  if (sa.length > 1 && sa === stem(fw)) return (fw === `${a}ه` || a === `${fw}ه`) ? 0.7 : 0.9;
  if (fw.startsWith(a)) return 0.4;
  if (fw.length >= 3 && a.startsWith(fw)) return 0.35;
  if (a.length > 2 && fw.includes(a)) return 0.3;
  return 0;
}

/**
 * Score 0..100 of one food against a normalised query.
 * 100 exact name · 88–98 every query word is a whole word (or synonym / same stem) of the name; +5 when the
 * name starts with it, −1 per extra word · ≤ 83 only ة differs («لبن» → «لبنة») · ≤ 74 prefix / substring · ≤ 50 some words.
 */
export function scoreFood(food, q) {
  if (!q) return 0;
  const names = [food._n || normalizeAr(food.name), ...(food.aliases || []).map(normalizeAr)];
  const qWords = tokensOf(q).filter((w) => w.length > 1 || /\d/.test(w));
  let best = 0;
  for (const n of names) {
    if (n === q) return 100;
    if (!qWords.length) { if (n.startsWith(q)) best = Math.max(best, 50); continue; }
    const fT = tokensOf(n);
    const padded = ` ${n} `;
    let sum = 0, hit = 0, lead = false;
    qWords.forEach((qw, i) => {
      let bq = 0, bj = -1;
      for (const alt of altsOf(qw)) {
        if (alt.includes(' ')) { if (padded.includes(` ${alt} `) && bq < 1) { bq = 1; bj = fT.findIndex((t) => t.startsWith(alt.split(' ')[0])); } continue; }
        fT.forEach((fw, j) => { const m = wordQuality(alt, fw); if (m > bq || (m === bq && m > 0 && j < bj)) { bq = m; bj = j; } });
      }
      if (bq > 0) { hit++; sum += bq; if (i === 0 && bj === 0 && bq >= 0.9) lead = true; }
    });
    if (!hit) continue;
    const s = hit === qWords.length
      ? 62 + 30 * (sum / hit) + (lead ? 5 : 0) - Math.min(4, Math.max(0, fT.length - qWords.length))
      : 55 * (sum / qWords.length) - 5;
    best = Math.max(best, Math.min(98, Math.round(s)));
  }
  const ev = qWords.length === 1 && EVERYDAY[qWords[0]];
  if (ev && best >= 88 && names[0].startsWith(ev)) best = Math.min(99, best + 3);
  return best;
}

/** Key used to tie log entries / usage back to a food when no foodId exists. */
export const foodKey = (f) => (f && f.foodId) || (f && f.id && !String(f.id).startsWith('e:') && !String(f.id).startsWith('n:') ? f.id : `n:${normalizeAr(f && f.name)}`);

/**
 * Usage stats from food log days: Map(key → {count, last, lastQty, sections:{key:count}, secQty:{key:qty}, secLast:{key:day}})
 * days: [{day, entries}] (any order).
 */
export function computeUsage(days = []) {
  const m = new Map();
  for (const d of days) {
    for (const e of (d && d.entries) || []) {
      const keys = new Set([e.foodId, `n:${normalizeAr(e.name)}`].filter(Boolean));
      for (const k of keys) {
        const u = m.get(k) || { count: 0, last: '', lastQty: null, sections: {}, secQty: {}, secLast: {} };
        u.count++;
        if (d.day >= u.last) { u.last = d.day; if (e.qty > 0) u.lastQty = e.qty; }
        const s = sectionOf(e);
        u.sections[s] = (u.sections[s] || 0) + 1;
        // typical portion per meal: the latest quantity logged in that meal
        if (e.qty > 0 && d.day >= (u.secLast[s] || '')) { u.secLast[s] = d.day; u.secQty[s] = e.qty; }
        m.set(k, u);
      }
    }
  }
  return m;
}

/** Typical portion of a food in a meal: your last quantity in that meal, else your last quantity anywhere, else null. */
export function typicalQty(usage, f, section) {
  const u = usageOf(usage, f);
  if (!u) return null;
  return (section && u.secQty && u.secQty[section]) || u.lastQty || null;
}

const usageOf = (usage, f) => (usage && (usage.get(f.id) || usage.get(`n:${f._n || normalizeAr(f.name)}`))) || null;

/**
 * Catalog = db foods (user/migrated, win) + bundled defaults not already present by normalised name.
 * Foods flagged `deleted` in the db hide the default with the same id/name.
 */
export function buildCatalog(defaults = [], dbFoods = []) {
  const out = [];
  const seen = new Set();
  const hidden = new Set();
  for (const f of dbFoods) {
    if (!f || typeof f.name !== 'string' || !f.name.trim()) continue;
    const n = normalizeAr(f.name);
    if (f.deleted) { hidden.add(n); hidden.add(f.id); continue; }
    if (seen.has(n)) continue;
    seen.add(n);
    out.push({ ...f, per: f.per > 0 ? f.per : 100, _n: n });
  }
  for (const f of defaults) {
    const n = normalizeAr(f.name);
    if (seen.has(n) || hidden.has(n) || hidden.has(f.id)) continue;
    seen.add(n);
    out.push({ ...f, src: 'default', _n: n });
  }
  return out;
}

/**
 * searchFoods(catalog, query, {usage, limit}) → foods sorted by score, then frequency, then recency.
 * Empty query → recent/frequent foods (most used first, ties by last day).
 */
export function searchFoods(catalog, query, { usage = null, limit = 30 } = {}) {
  const q = normalizeAr(query);
  if (!q) {
    if (!usage) return [];
    return catalog.map((f) => ({ f, u: usageOf(usage, f) })).filter((x) => x.u)
      .sort((a, b) => b.u.count - a.u.count || b.u.last.localeCompare(a.u.last)).slice(0, limit).map((x) => x.f);
  }
  const scored = [];
  for (const f of catalog) {
    const s = scoreFood(f, q);
    if (s >= 35) {
      const u = usageOf(usage, f);
      // your frequent foods first, but only inside the same match class: a prefix hit (≤ 74 + 6) never beats a whole word (≥ 88)
      scored.push({ f, s: s + (u && s >= 60 ? Math.min(6, u.count) : 0), u });
    }
  }
  scored.sort((a, b) => b.s - a.s || (b.u?.count || 0) - (a.u?.count || 0) || (b.u?.last || '').localeCompare(a.u?.last || '') || a.f.name.length - b.f.name.length);
  return scored.slice(0, limit).map((x) => x.f);
}

/**
 * ≤5 suggestions for a section (time of day): foods most often logged in that section, recent first.
 */
export function suggestionsFor(catalog, usage, section, limit = 5) {
  if (!usage) return [];
  return catalog.map((f) => ({ f, u: usageOf(usage, f) }))
    .filter((x) => x.u && x.u.sections[section])
    .sort((a, b) => b.u.sections[section] - a.u.sections[section] || b.u.last.localeCompare(a.u.last))
    .slice(0, Math.min(5, limit)).map((x) => x.f);
}

// ───────────────────────── entries ─────────────────────────

let seq = 0;
export function newId(prefix = 'e', now = Date.now()) {
  seq = (seq + 1) % 1296;
  return `${prefix}:${now.toString(36)}${seq.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Log entry from a catalog food and a quantity (validated 1..5000 via core portion()). Throws ValidationError. */
export function makeEntry(food, qty, section, now = new Date(), src = 'db') {
  const m = portion(food, qty);
  const e = { id: newId('e', now.getTime()), foodId: food.id || null, name: String(food.name).slice(0, 120), qty: Number(qty),
    unit: food.unit || 'جرام', ...m, section, time: hhmm(now), src };
  const per = food.per > 0 ? food.per : 100;
  if (Number(food.fiber) > 0) e.fib = Math.round((Number(food.fiber) * Number(qty) / per) * 10) / 10;
  if (Number(food.sodium) > 0) e.na = Math.round(Number(food.sodium) * Number(qty) / per);
  return e;
}

export const QUICK_MESSAGES = Object.freeze({
  kcal: 'اكتب السعرات رقم بين 1 و 5000.',
  p: 'البروتين رقم بين 0 و 500 جم.',
  name: 'الاسم طويل أوي.',
});

/** Quick add: kcal (1..5000) + protein (0..500) + optional name. → {ok, entry?, errors:{field:msg}} */
export function quickEntry({ name = '', kcal, p = 0 }, section, now = new Date()) {
  const errors = {};
  const k = Number(String(kcal ?? '').replace(',', '.'));
  const pr = String(p ?? '').trim() === '' ? 0 : Number(String(p).replace(',', '.'));
  if (!Number.isFinite(k) || k < 1 || k > QTY_MAX) errors.kcal = QUICK_MESSAGES.kcal;
  if (!Number.isFinite(pr) || pr < 0 || pr > 500) errors.p = QUICK_MESSAGES.p;
  if (String(name).length > 60) errors.name = QUICK_MESSAGES.name;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors, entry: { id: newId('e', now.getTime()), foodId: null, name: String(name).trim() || 'إضافة سريعة', qty: 1, unit: 'حصة',
    kcal: Math.round(k), p: Math.round(pr * 10) / 10, c: 0, f: 0, section, time: hhmm(now), src: 'quick' } };
}

/** Re-scale an existing entry to a new quantity (keeps per-unit macros). */
export function rescaleEntry(entry, qty) {
  const v = validateQty(qty);
  if (!v.ok) return { ok: false, message: v.message };
  const old = entry.qty > 0 ? entry.qty : 1;
  const f = v.qty / old;
  const r = (x) => Math.round((Number(x) || 0) * f * 10) / 10;
  return { ok: true, entry: { ...entry, qty: v.qty, kcal: r(entry.kcal), p: r(entry.p), c: r(entry.c), f: r(entry.f) } };
}

/** Copy yesterday's entries of one section as new entries for today. */
export function repeatSection(yEntries = [], section, now = new Date()) {
  return yEntries.filter((e) => sectionOf(e) === section).map((e) => ({ ...e, id: newId('e', now.getTime()), section, time: hhmm(now), src: e.src === 'quick' ? 'quick' : 'repeat' }));
}

/** Stepper step for a unit: grams step 10 (25 above 200), pieces/scoops 1, else 0.5. */
export function stepFor(unit, qty) {
  if (/جرام|جم|مل|g|ml/i.test(unit || '')) return qty >= 200 ? 25 : 10;
  return 1;
}

// ───────────────────────── day balance ─────────────────────────

export const KCAL_BAND = 0.05; // ±5 % of the day-type target, at least ±100 kcal
export const PROTEIN_SLACK = 5; // grams under target still counted as "hit"

/** Min/max range for a day target: {kcalMin, kcalMax, pMin}. */
export function targetRange(t) {
  const band = Math.max(100, Math.round(t.kcal * KCAL_BAND));
  return { kcalMin: t.kcal - band, kcalMax: t.kcal + band, pMin: t.p - PROTEIN_SLACK };
}

/**
 * Day balance → {state:'empty'|'open'|'closed'|'over', kcalLeft, pLeft, kcalInRange, proteinHit, message}
 * closed = protein hit AND kcal inside range (the double rule). over = kcal above max.
 */
export function dayBalance(intake, target, ranges = null) {
  const base = targetRange(target);
  const r = ranges && ranges.kcal ? { kcalMin: ranges.kcal.min, kcalMax: ranges.kcal.max, pMin: ranges.p.min } : base;
  const kcalLeft = Math.round(target.kcal - intake.kcal);
  const pLeft = Math.round((target.p - intake.p) * 10) / 10;
  const kcalInRange = intake.kcal >= r.kcalMin && intake.kcal <= r.kcalMax;
  const proteinHit = intake.p >= r.pMin;
  let state = 'open';
  if (!intake.kcal && !intake.p) state = 'empty';
  else if (intake.kcal > r.kcalMax) state = 'over';
  else if (kcalInRange && proteinHit) state = 'closed';
  const message = state === 'empty' ? 'لسه مفيش أكل متسجل النهارده'
    : state === 'closed' ? 'الحساب اتقفل · بروتين وسعرات في المدى'
    : state === 'over' ? `السعرات فوق المدى بـ ${Math.round(intake.kcal - r.kcalMax)}${proteinHit ? '' : ` · فاضل ${Math.round(pLeft)} جم بروتين`}`
    : !proteinHit ? `الحساب مفتوح · فاضل ${Math.round(pLeft)} جم بروتين عشان يتقفل`
    : `الحساب مفتوح · فاضل ${Math.max(0, r.kcalMin - Math.round(intake.kcal))} سعرة للمدى`;
  return { state, kcalLeft, pLeft, kcalInRange, proteinHit, message, range: r };
}

// ───────────────────────── barcode / OpenFoodFacts ─────────────────────────

/** GTIN-8/12/13/14 with a valid check digit. */
export function validBarcode(code) {
  const c = String(code ?? '').replace(/\s+/g, '');
  if (!/^(\d{8}|\d{12,14})$/.test(c)) return false;
  const d = c.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((x, i) => { sum += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

export const OFF_FIELDS = 'code,product_name,product_name_ar,brands,nutriments,serving_quantity';
export const offUrl = (code) => `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=${OFF_FIELDS}`;

const cleanText = (s, max) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const rng = (v, max) => { const x = typeof v === 'string' ? Number(v) : v; return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x * 10) / 10 : null; };

/** OFF v2 JSON → food per 100 g, or null (product missing / no kcal). Treats every field as untrusted. */
export function parseOFF(json, code) {
  if (!json || typeof json !== 'object' || json.status === 0 || !json.product || typeof json.product !== 'object') return null;
  const p = json.product;
  const n = p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {};
  let kcal = rng(n['energy-kcal_100g'], 900);
  if (kcal === null) { const kj = rng(n.energy_100g ?? n['energy-kj_100g'], 3800); if (kj !== null) kcal = Math.round(kj / 4.184); }
  if (kcal === null) return null;
  const name = cleanText(p.product_name_ar, 80) || cleanText(p.product_name, 80);
  const brand = cleanText(p.brands, 40).split(',')[0].trim();
  return { id: `bc:${code}`, barcode: String(code), name: name || `منتج ${code}`, brand: brand || null,
    kcal, p: rng(n.proteins_100g, 100) ?? 0, c: rng(n.carbohydrates_100g, 100) ?? 0, f: rng(n.fat_100g, 100) ?? 0,
    per: 100, unit: 'جرام', cat: null, src: 'off' };
}

/** Existing food with the same barcode (dedupe). */
export const findByBarcode = (foods, code) => foods.find((f) => f && String(f.barcode || '') === String(code)) || null;

// ───────────────────────── saved meals («وجباتي») ─────────────────────────

/** Saved meal from entries: {id, name, section, items:[{foodId,name,qty,unit,kcal,p,c,f}], createdAt}. */
export function mealFromEntries(name, entries, section, now = new Date()) {
  const nm = String(name || '').trim().slice(0, 60);
  if (!nm) return { ok: false, message: 'اكتب اسم للوجبة.' };
  if (!entries.length) return { ok: false, message: 'الوجبة فاضية.' };
  const items = entries.map(({ foodId = null, name: n, qty, unit, kcal, p, c, f }) => ({ foodId, name: n, qty, unit, kcal, p, c, f }));
  return { ok: true, meal: { id: newId('m', now.getTime()), name: nm, section: section || null, items, createdAt: now.toISOString() } };
}

/** Saved meals object (new or migrated legacy shape) → sorted list with totals. */
export function listMeals(savedMeals) {
  const out = [];
  for (const [id, m] of Object.entries(savedMeals || {})) {
    if (!m || typeof m !== 'object') continue;
    const items = (Array.isArray(m.items) ? m.items : Array.isArray(m.foods) ? m.foods : Array.isArray(m.meals) ? m.meals : [])
      .filter((x) => x && typeof x === 'object' && x.name)
      .map((x) => ({ foodId: x.foodId || null, name: String(x.name), qty: Number(x.qty) || 1, unit: x.unit || '', kcal: Number(x.kcal ?? x.cal) || 0, p: Number(x.p ?? x.pro) || 0, c: Number(x.c ?? x.carb) || 0, f: Number(x.f ?? x.fat) || 0 }));
    out.push({ id: m.id || id, name: String(m.name || 'وجبة'), section: m.section && SECTION_LABEL[m.section] ? m.section : null, items, totals: sumEntries(items), createdAt: m.createdAt || m.savedAt || '' });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.name.localeCompare(b.name));
}

/** Entries to log from a saved meal. */
export const entriesFromMeal = (meal, section, now = new Date()) => meal.items.map((it) => ({ ...it, id: newId('e', now.getTime()), section, time: hhmm(now), src: 'meal' }));

// ───────────────────────── AI items (photo / coach) ─────────────────────────

/** AI item {name, grams, kcal,p,c,f} → entry; a confident DB match (score ≥ 90) replaces AI macros. */
export function entryFromAIItem(item, section, catalog = [], now = new Date()) {
  const q = normalizeAr(item.name);
  let best = null, bs = 0;
  for (const f of catalog) { const s = scoreFood(f, q); if (s > bs) { bs = s; best = f; } }
  if (best && bs >= 90 && /جرام|مل/.test(best.unit || '')) {
    try { return { ...makeEntry(best, item.grams, section, now, 'ai'), matched: true }; } catch { /* fall through */ }
  }
  return { id: newId('e', now.getTime()), foodId: null, name: item.name, qty: item.grams, unit: 'جرام', kcal: item.kcal, p: item.p, c: item.c, f: item.f, section, time: hhmm(now), src: 'ai', matched: false };
}

export const COACH_LOG_HINT = '\n\n[تعليمات التطبيق: لو طلبت تسجيل أكل، اكتب ردك عادي وفي آخر سطر JSON بس بالشكل {"items":[{"name":"<اسم عربي>","grams":<رقم>,"kcal":<رقم>,"p":<رقم>,"c":<رقم>,"f":<رقم>}]}. غير كده ماتكتبش JSON خالص.]';

/** Split a coach reply into visible text and proposed log items (null if none). Never throws. */
export function splitCoachReply(text) {
  const t = String(text ?? '');
  const idx = t.lastIndexOf('{"items"');
  const alt = idx >= 0 ? idx : t.search(/\{\s*"items"\s*:/);
  if (alt < 0) return { text: t.trim(), items: null };
  const end = t.lastIndexOf('}');
  if (end < alt) return { text: t.trim(), items: null };
  const jsonPart = t.slice(alt, end + 1);
  let items = null;
  try {
    const parsed = JSON.parse(jsonPart);
    if (parsed && Array.isArray(parsed.items)) {
      const num = (v, max) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x * 10) / 10 : null; };
      items = parsed.items.flatMap((it) => {
        const name = it && typeof it.name === 'string' ? cleanText(it.name, 80) : '';
        const grams = num(it && it.grams, QTY_MAX);
        return name && grams ? [{ name, grams, kcal: num(it.kcal, 10000) ?? 0, p: num(it.p, 1000) ?? 0, c: num(it.c, 1000) ?? 0, f: num(it.f, 1000) ?? 0 }] : [];
      });
      if (!items.length) items = null;
    }
  } catch { items = null; }
  const visible = (t.slice(0, alt) + t.slice(end + 1)).replace(/```(?:json)?/gi, '').trim();
  return { text: visible || (items ? 'دي الأكلات اللي فهمتها، راجعها قبل التسجيل:' : t.trim()), items };
}

/** Very small, safe markdown: **bold** and line breaks → DOM nodes (no innerHTML). */
export function richTextNodes(doc, text) {
  const frag = doc.createDocumentFragment();
  String(text ?? '').split('\n').forEach((line, i) => {
    if (i) frag.appendChild(doc.createElement('br'));
    line.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) { const b = doc.createElement('b'); b.textContent = part.slice(2, -2); frag.appendChild(b); }
      else if (part) frag.appendChild(doc.createTextNode(part));
    });
  });
  return frag;
}

// ═════════════════════════ intelligence (pure; ported from NutriPro, rewritten) ═════════════════════════

const r0 = (x) => Math.round(Number(x) || 0);
const r1n = (x) => Math.round((Number(x) || 0) * 10) / 10;
const minutesOf = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hhmmOf = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Default allowed distance from each target (grams / kcal). Custom values from kv.nutrition.ranges override per macro. */
export const DEFAULT_RANGE = Object.freeze({ kcal: null, p: { lo: PROTEIN_SLACK, hi: null }, c: { pct: 0.15 }, f: { pct: 0.15 } });

/**
 * macroRanges(target, custom) → {kcal:{min,max}, p:{min,max|null}, c:{min,max}, f:{min,max}}
 * custom: {kcal:{lo,hi}, p:{lo,hi}, c:{lo,hi}, f:{lo,hi}} — allowed distance under / over the target.
 */
export function macroRanges(t, custom = {}) {
  const base = targetRange(t);
  const cu = custom || {};
  const pick = (k, def) => {
    const c = cu[k];
    if (c && Number.isFinite(Number(c.lo)) && Number.isFinite(Number(c.hi))) return { min: Math.max(0, r0(t[k] - Number(c.lo))), max: r0(t[k] + Number(c.hi)), custom: true };
    return def;
  };
  const pct = (k, p) => ({ min: Math.max(0, r0((t[k] || 0) * (1 - p))), max: r0((t[k] || 0) * (1 + p)) });
  return {
    kcal: pick('kcal', { min: base.kcalMin, max: base.kcalMax }),
    p: pick('p', { min: base.pMin, max: null }),
    c: pick('c', pct('c', 0.15)),
    f: pick('f', pct('f', 0.15)),
  };
}

/** 'low' | 'in' | 'over' for a value against a {min,max} range. */
export function rangeStatus(v, range) {
  if (!range) return 'in';
  if (v < range.min) return 'low';
  if (range.max !== null && range.max !== undefined && v > range.max) return 'over';
  return 'in';
}

/** Share of energy per macro → {p, c, f} in % (sums to 100 when there is intake), or null. */
export function macroSplit(intake) {
  const kp = (intake.p || 0) * 4, kc = (intake.c || 0) * 4, kf = (intake.f || 0) * 9;
  const tot = kp + kc + kf;
  if (tot <= 0) return null;
  const p = Math.round((kp / tot) * 100), c = Math.round((kc / tot) * 100);
  return { p, c, f: Math.max(0, 100 - p - c) };
}

/** Fiber total of entries (only foods that carry fiber). */
export const sumFiber = (entries = []) => r1n(entries.reduce((s, e) => s + (Number(e && e.fib) || 0), 0));

const MEAL_END = { breakfast: 11, lunch: 16, dinner: 22 };

/**
 * mealBudget(groups, intake, target, hour) → null | {mealsLeft, sections:[key], kcal, p}
 * Remaining kcal/protein split over the main meals not logged yet whose time has not passed (else one snack).
 */
export function mealBudget(groups, intake, t, hour) {
  const remK = r0(t.kcal - intake.kcal), remP = r0(t.p - intake.p);
  if (remK < 100 || hour >= 23) return null;
  let left = ['breakfast', 'lunch', 'dinner'].filter((k) => !(groups[k] && groups[k].entries.length) && hour < MEAL_END[k]);
  if (!left.length) left = ['snack'];
  return { mealsLeft: left.length, sections: left, kcal: r0(remK / left.length), p: Math.max(0, r0(remP / left.length)) };
}

/** Mifflin-St Jeor BMR. profile {kg, cm, age, sex}. null when weight or height is missing. */
export function bmr(profile = {}) {
  const kg = Number(profile.kg), cm = Number(profile.cm), age = Number(profile.age) || 27;
  if (!(kg > 20 && kg < 400 && cm > 100 && cm < 250)) return null;
  return Math.round(10 * kg + 6.25 * cm - 5 * age + (profile.sex === 'female' ? -161 : 5));
}

export const ACTIVITY_LEVELS = Object.freeze([
  { v: 1.2, label: 'قليل الحركة (مكتب، من غير تمرين)' },
  { v: 1.375, label: 'خفيف (تمرين 1-3 أيام)' },
  { v: 1.55, label: 'متوسط (تمرين 3-5 أيام)' },
  { v: 1.725, label: 'عالي (تمرين 6-7 أيام)' },
  { v: 1.9, label: 'عالي جدًا (شغل بدني + تمرين)' },
]);

/**
 * tdee(profile, activity=1.55, dayType) → kcal per day (number) or null.
 * Training day = activity + 0.1, rest day = activity − 0.2 (min 1.2) — the old app used 1.65 / 1.35 around 1.55.
 */
export function tdee(profile, activity = 1.55, dayType) {
  const b = bmr(profile);
  if (b === null) return null;
  const a = Number(activity) >= 1.1 && Number(activity) <= 2.2 ? Number(activity) : 1.55;
  const f = dayType === 'training' ? a + 0.1 : dayType === 'rest' ? Math.max(1.2, a - 0.2) : a;
  return Math.round(b * f);
}

/** Today's energy balance vs the estimated burn → null | {balance, grams, weeklyKg, direction} (7700 kcal ≈ 1 kg). */
export function weightImpact(intake, burn) {
  if (!burn || !(intake.kcal >= 50)) return null;
  const balance = Math.round(intake.kcal - burn);
  return { balance, grams: Math.round(Math.abs(balance) / 7.7), weeklyKg: Math.round((Math.abs(balance) * 7 / 7700) * 100) / 100,
    direction: balance > 25 ? 'surplus' : balance < -25 ? 'deficit' : 'even' };
}

/** Per-meal protein threshold: ~0.4 g/kg (min 20 g, max 50 g); 25 g without a weight. */
export const proteinMealThreshold = (kg) => (Number(kg) > 0 ? Math.max(20, Math.min(50, Math.round(0.4 * Number(kg)))) : 25);

/**
 * proteinPerMeal(entries, kg) → {threshold, meals:[{key,label,p,ok}], under}
 * One row per logged section; ok when the section's protein reaches the threshold. Snacks are informational (never "under").
 */
export function proteinPerMeal(entries = [], kg) {
  const threshold = proteinMealThreshold(kg);
  const g = groupBySection(entries);
  const meals = SECTIONS.filter((s) => g[s.key].entries.length).map((s) => {
    const p = r0(g[s.key].totals.p);
    return { key: s.key, label: s.label, p, ok: p >= threshold || s.key === 'snack' };
  });
  return { threshold, meals, under: meals.filter((m) => !m.ok).length };
}

/** First → last logged time. null with fewer than 2 timed entries. */
export function eatingWindow(entries = []) {
  const ts = entries.map((e) => minutesOf(e && e.time)).filter((x) => x !== null).sort((a, b) => a - b);
  if (ts.length < 2 || ts[ts.length - 1] === ts[0]) return null;
  const minutes = ts[ts.length - 1] - ts[0];
  return { first: hhmmOf(ts[0]), last: hhmmOf(ts[ts.length - 1]), minutes, hours: Math.floor(minutes / 60), mins: minutes % 60 };
}

/** «جودة اليوم»: plain checks (no score). fiber target 30 g is only checked when fiber data exists. */
export function dayQuality(intake, t, ranges, fiber = 0) {
  const R = ranges || macroRanges(t);
  const out = [
    { key: 'kcal', label: 'السعرات في المدى', ok: rangeStatus(intake.kcal, R.kcal) === 'in' },
    { key: 'p', label: 'البروتين وصل', ok: intake.p >= R.p.min },
    { key: 'f', label: 'الدهون في المدى', ok: rangeStatus(intake.f, R.f) === 'in' },
  ];
  if (fiber > 0) out.push({ key: 'fib', label: 'ألياف 25 جم أو أكتر', ok: fiber >= 25 });
  return out;
}

/** Water goal in ml: 33 ml/kg + 500 ml on a training day (2.5 L without weight). */
export function waterGoalMl(kg, dayType) {
  const base = Number(kg) > 20 ? Math.round(Number(kg) * 33) : 2500;
  return base + (dayType === 'training' ? 500 : 0);
}
export const cupsFor = (ml) => Math.ceil((Number(ml) || 0) / 250);

/**
 * smartAlert({today, recent:[{day,intake,target}], lastWeighDay, waterMl, waterGoal, hour, isToday}) → null | {kind, text}
 * One alert at most, in priority order: protein low 2 days running → no weigh-in for 5+ days → water low late in the day.
 */
export function smartAlert({ today, recent = [], lastWeighDay = null, waterMl = 0, waterGoal = 0, hour = 12, isToday = true } = {}) {
  if (!isToday) return null;
  const prev = recent.filter((d) => d.day < today).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 2);
  if (prev.length === 2 && prev.every((d) => d.intake.p > 0 && d.intake.p < d.target.p * 0.8)) {
    const avg = r0((prev[0].intake.p + prev[1].intake.p) / 2);
    return { kind: 'protein', text: `البروتين أقل من 80% يومين ورا بعض (متوسط ${avg} من ${r0(prev[0].target.p)} جم). ابدأ النهارده بوجبة فيها بروتين عالي.` };
  }
  if (lastWeighDay) {
    const days = Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${lastWeighDay}T12:00:00`)) / 864e5);
    if (days >= 5) return { kind: 'weigh', text: `آخر وزن متسجل من ${days} أيام. الوزن الأسبوعي بيخلّي ضبط الأهداف أدق.` };
  }
  if (waterGoal > 0 && hour >= 15 && waterMl < waterGoal * 0.5) return { kind: 'water', text: `المية ${fmtL(waterMl)} من ${fmtL(waterGoal)} لتر لحد دلوقتي.` };
  return null;
}
const fmtL = (ml) => (Math.round((ml / 1000) * 10) / 10).toFixed(1);

/**
 * eodRecap(intake, t, ranges, {hour, isToday, waterMl, waterGoal}) → null | {closed, missing:[text], fix}
 * After 20:00 on today with ≥ 200 kcal logged: what is missing and one concrete fix.
 */
export function eodRecap(intake, t, ranges, { hour = 0, isToday = true, waterMl = 0, waterGoal = 0 } = {}) {
  if (!isToday || hour < 20 || !(intake.kcal >= 200)) return null;
  const R = ranges || macroRanges(t);
  const missing = [];
  let fix = null;
  const pGap = r0(R.p.min - intake.p);
  if (pGap > 0) { missing.push(`بروتين ناقص ${pGap} جم`); fix = fix || `ضيف ${pGap} جم بروتين قبل النوم: زبادي يوناني أو جبنة قريش (خفاف على السعرات).`; }
  const ks = rangeStatus(intake.kcal, R.kcal);
  if (ks === 'low') { const g = r0(R.kcal.min - intake.kcal); missing.push(`سعرات ناقصة ${g}`); fix = fix || `فاضل ${g} سعرة للمدى: وجبة خفيفة متوازنة تكفي.`; }
  if (ks === 'over') { const g = r0(intake.kcal - R.kcal.max); missing.push(`سعرات زيادة ${g}`); fix = fix || 'خلاص كده للنهارده. بكرة ابدأ بفطار بروتين عالي.'; }
  if (waterGoal > 0 && waterMl < waterGoal) { const c = cupsFor(waterGoal - waterMl); missing.push(`مية ناقصة ${c} ${c === 1 ? 'كوباية' : c === 2 ? 'كوبايتين' : 'كوبايات'}`); fix = fix || 'اشرب كوبايتين مية قبل النوم بساعة.'; }
  return { closed: missing.length === 0, missing, fix: fix || 'يوم مقفول. كمّل كده.' };
}

/**
 * smartSuggestions(catalog, usage, intake, target, {dayType, favorites, limit}) → [{food, qty, kcal, p, coverage, count}]
 * Local, no AI. Mode: protein gap > 15 g → protein foods; else kcal gap > 150 → balanced; else carbs on a training day.
 * Only foods whose suggested portion fits inside the remaining kcal. The user's own frequent foods and favorites rank first.
 */
// From the default list, breakfast/snack only offers breakfast-type foods (eggs, dairy, whey, oats, beans, bread, fruit);
// anything else needs your own history in that meal. [opinion: Egyptian meal habits]
const LIGHT_MEAL = /بيض|واي|بروتين بار|زبادي|لبن|حليب|جبن|قريش|لبنه|شوفان|فول|طعميه|توست|عيش|خبز|موز|تمر|تفاح|عسل|زبده فول|مكسرات|لوز/;
/** Largest portion suggested per meal when there is no history for that food in that meal. */
export const SECTION_CAP = Object.freeze({ breakfast: { g: 200, n: 4 }, snack: { g: 150, n: 2 }, lunch: { g: 300, n: 4 }, dinner: { g: 300, n: 4 } });

export function smartSuggestions(catalog, usage, intake, t, { dayType = 'rest', favorites = {}, limit = 3, section = null } = {}) {
  const remP = t.p - intake.p, remK = t.kcal - intake.kcal, remC = (t.c || 0) - (intake.c || 0);
  const mode = remP > 15 ? 'p' : remK > 150 ? 'kcal' : remC > 30 && dayType === 'training' ? 'c' : null;
  if (!mode || remK <= 0) return { mode: null, items: [] };
  const out = [];
  for (const f of catalog) {
    if (!(f.kcal > 0)) continue;
    const per = f.per > 0 ? f.per : 100;
    const grams = /جرام|مل/.test(f.unit || 'جرام');
    const u = usage && (usage.get(f.id) || usage.get(`n:${f._n || normalizeAr(f.name)}`));
    const count = u ? u.count : 0;
    const fav = !!(favorites && favorites[f.id]);
    if (!count && !fav && f.cat !== (mode === 'c' ? 'كارب' : 'بروتين')) continue;
    // meal-aware: your own history in this meal first; a food you eat often but never in this meal is skipped,
    // and main dishes are not offered at breakfast/snack from the default list
    const inSec = section && u ? (u.sections[section] || 0) : 0;
    if (section && count >= 2 && !inSec && !fav) continue;
    if (section && !inSec && (section === 'breakfast' || section === 'snack') && !LIGHT_MEAL.test(f._n || normalizeAr(f.name))) continue;
    const typical = section && u && inSec ? (u.secQty && u.secQty[section]) || u.lastQty : null;
    const cap = section ? SECTION_CAP[section] : null;
    const perUnit = { kcal: f.kcal / per, p: (f.p || 0) / per, c: (f.c || 0) / per };
    let qty;
    if (mode === 'p') { if (perUnit.p * per < 5 || (f.p * 4) / f.kcal < 0.25) continue; qty = remP / perUnit.p; }
    else if (mode === 'kcal') qty = remK / perUnit.kcal;
    else { if (perUnit.c <= 0) continue; qty = remC / perUnit.c; }
    if (typical > 0) qty = typical;
    else if (grams) qty = Math.max(30, Math.min(cap ? cap.g : 400, Math.round(qty / 10) * 10));
    else qty = Math.max(1, Math.min(cap ? cap.n : 6, Math.round(qty)));
    let kcal = perUnit.kcal * qty;
    if (kcal > remK) {
      // shrink to fit the remaining kcal
      qty = grams ? Math.floor((remK / perUnit.kcal) / 10) * 10 : Math.floor(remK / perUnit.kcal);
      if (qty < (grams ? 30 : 1)) continue;
      kcal = perUnit.kcal * qty;
    }
    const p = perUnit.p * qty;
    const gap = mode === 'p' ? remP : mode === 'kcal' ? remK : remC;
    const got = mode === 'p' ? p : mode === 'kcal' ? kcal : perUnit.c * qty;
    const coverage = Math.min(100, Math.round((got / gap) * 100));
    const density = mode === 'p' ? (f.p * 4) / f.kcal : mode === 'c' ? ((f.c || 0) * 4) / f.kcal : 0.5;
    out.push({ food: f, qty, kcal: r0(kcal), p: r0(p), coverage, count, fav, inSection: inSec,
      score: density * 2 + Math.min(count, 10) * 0.8 + Math.min(inSec, 10) * 1.5 + (fav ? 3 : 0) + coverage / 100 });
  }
  out.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);
  const seen = new Set();
  const items = [];
  for (const x of out) { const k = x.food._n || x.food.name; if (seen.has(k)) continue; seen.add(k); items.push(x); if (items.length >= limit) break; }
  return { mode, gap: r0(mode === 'p' ? remP : mode === 'kcal' ? remK : remC), items };
}

// ───────── targets: diet modes + adaptive engine ─────────

const round50 = (x) => Math.round(x / 50) * 50;

/** Presets from body weight (NutriPro DIET_MODES). Rest day = 90% of the training-day kcal, carbs take the difference. */
export const DIET_MODES = Object.freeze({
  recomp: { label: 'ريكومب', desc: 'بناء عضل ونزول دهون مع بعض', kcal: 30, p: 2.2, f: 0.9 },
  bulk: { label: 'زيادة عضل', desc: 'فائض بسيط محسوب', kcal: 35, p: 2.2, f: 1 },
  cut: { label: 'تنشيف', desc: 'عجز مع بروتين أعلى', kcal: 25, p: 2.5, f: 0.8 },
  keto: { label: 'كيتو', desc: 'كارب 25 جم والباقي دهون', kcal: 28, p: 1.8, f: null, carb: 25 },
  maint: { label: 'ثبات', desc: 'المحافظة على الوزن', kcal: 31, p: 1.8, f: 0.9 },
});

function modeDay(m, kg, kcal) {
  const p = Math.round(kg * m.p);
  if (m.carb !== undefined) { const c = m.carb; return { kcal, p, c, f: Math.max(0, Math.round((kcal - p * 4 - c * 4) / 9)) }; }
  const f = m.f ? Math.round(kg * m.f) : Math.round(((kcal - p * 4) * 0.25) / 9);
  return { kcal, p, c: Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4)), f };
}

/** dietModeTargets('recomp', 80) → {training:{kcal:2400,p:176,…}, rest:{…}} or null. */
export function dietModeTargets(mode, kg) {
  const m = DIET_MODES[mode];
  const w = Number(kg);
  if (!m || !(w > 30 && w < 300)) return null;
  const kt = Math.round(w * m.kcal);
  // heart day (30 min cardio, no lifting) sits between the two
  return { training: modeDay(m, w, kt), heart: modeDay(m, w, round50(kt * 0.95)), rest: modeDay(m, w, round50(kt * 0.9)) };
}

export const ADAPT_STEP = 150;

/**
 * adaptiveSuggestion(weights, history, {today, snoozeUntil}) → null | {delta, change, from, to, days, title, reason}
 * Weekly, from the weight change across the weigh-ins of the last 7 days (≥ 2 weigh-ins, ≥ 4 days apart, ≥ 3 overall):
 * < −0.7 kg → +150 kcal, > +0.4 kg → −150 kcal. Not again within 7 days of the last applied change, nor while snoozed.
 */
export function adaptiveSuggestion(weights = [], history = [], { today, snoozeUntil = null } = {}) {
  const ws = (weights || []).filter((w) => w && isDay(w.day) && Number(w.kg) > 20).sort((a, b) => a.day.localeCompare(b.day));
  if (ws.length < 3) return null;
  const end = today || ws[ws.length - 1].day;
  if (snoozeUntil && end < snoozeUntil) return null;
  const last = (history || []).filter((h) => h && h.date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (last && dayDiff(last.date, end) < 7) return null;
  const from = shiftDay(end, -7);
  const win = ws.filter((w) => w.day >= from && w.day <= end);
  if (win.length < 2 || dayDiff(win[0].day, win[win.length - 1].day) < 4) return null;
  const change = Math.round((win[win.length - 1].kg - win[0].kg) * 10) / 10;
  const days = dayDiff(win[0].day, win[win.length - 1].day);
  if (change < -0.7) return { delta: ADAPT_STEP, change, from: win[0].kg, to: win[win.length - 1].kg, days,
    title: `زوّد ${ADAPT_STEP} سعرة`, reason: `وزنك نزل ${Math.abs(change)} كجم في ${days} أيام. ده أسرع من المعدل الآمن (حوالي 0.7 كجم في الأسبوع) وممكن تخسر عضل.` };
  if (change > 0.4) return { delta: -ADAPT_STEP, change, from: win[0].kg, to: win[win.length - 1].kg, days,
    title: `قلّل ${ADAPT_STEP} سعرة`, reason: `وزنك زاد ${change} كجم في ${days} أيام. ده أكتر من زيادة العضل المتوقعة، فالأغلب دهون.` };
  return null;
}

/** Apply a kcal delta to every day type; carbs absorb it (delta / 4). kcal kept within 1200–5000. */
export function applyAdjustment(targets, delta) {
  const out = { ...targets, isDefault: false };
  for (const k of ['training', 'heart', 'rest']) {
    const t = targets[k];
    if (!t) continue;
    const kcal = Math.max(1200, Math.min(5000, t.kcal + delta));
    out[k] = { ...t, kcal, c: Math.max(0, Math.round(t.c + (kcal - t.kcal) / 4)) };
  }
  return out;
}

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const shiftDay = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// ───────── weekly stats + patterns (exported for WP-Analytics) ─────────

const tgtFor = (targets, day) => (typeof targets === 'function' ? targets(day) : targets && targets[day] ? targets[day] : targets && targets.kcal ? targets : null);

/**
 * weekStats(days, targets) → null | {days, avgKcal, avgP, avgC, avgF, proteinHit, kcalHit, closed, avgKg, bestDay}
 * days: [{day, entries, kg?}] (any order; only days with entries count). targets: fn(day) | {day: t} | t.
 */
export function weekStats(days = [], targets) {
  const logged = days.filter((d) => d && Array.isArray(d.entries) && d.entries.length);
  if (!logged.length) return null;
  let best = null;
  const sums = { kcal: 0, p: 0, c: 0, f: 0 };
  let proteinHit = 0, kcalHit = 0, closed = 0;
  for (const d of logged) {
    const it = sumEntries(d.entries);
    for (const k of Object.keys(sums)) sums[k] += it[k];
    const t = tgtFor(targets, d.day);
    if (!t) continue;
    const b = dayBalance(it, t);
    if (b.proteinHit) proteinHit++;
    if (b.kcalInRange) kcalHit++;
    if (b.state === 'closed') closed++;
    const dist = Math.abs(it.kcal - t.kcal) / t.kcal + Math.max(0, t.p - it.p) / t.p;
    if (!best || dist < best.dist) best = { day: d.day, dist, kcal: r0(it.kcal), p: r0(it.p) };
  }
  const n = logged.length;
  const kgs = days.filter((d) => d && Number(d.kg) > 0).map((d) => Number(d.kg));
  return { days: n, avgKcal: r0(sums.kcal / n), avgP: r0(sums.p / n), avgC: r0(sums.c / n), avgF: r0(sums.f / n), proteinHit, kcalHit, closed,
    avgKg: kgs.length ? r1n(kgs.reduce((a, b) => a + b, 0) / kgs.length) : null, bestDay: best ? { day: best.day, kcal: best.kcal, p: best.p } : null };
}

/** this vs last week → [{key,label,cur,prev,diff,good}] (good: true/false/null). */
export function compareWeeks(cur, prev) {
  if (!cur) return [];
  const row = (key, label, dir) => {
    const a = cur[key], b = prev ? prev[key] : null;
    const diff = a !== null && b !== null && b !== undefined ? Math.round((a - b) * 10) / 10 : null;
    const good = diff === null || diff === 0 || !dir ? null : dir > 0 ? diff > 0 : diff < 0;
    return { key, label, cur: a, prev: b, diff, good };
  };
  return [row('avgKcal', 'متوسط السعرات', 0), row('avgP', 'متوسط البروتين', 1), row('proteinHit', 'أيام البروتين', 1), row('kcalHit', 'أيام السعرات في المدى', 1), row('days', 'أيام متسجلة', 1), row('avgKg', 'متوسط الوزن', 0)];
}

/**
 * eatingPatterns(days) → null | {totalDays, lateNight:{days, foods, avgHour}, skipBreakfast, overshoot:{days, avgOver}, peakHour, hours[24], topFoods:[[name,count]], notes:[{kind,title,text}]}
 * days: [{day, entries, target?:{kcal}}], last 30 used. Needs ≥ 5 logged days.
 */
export function eatingPatterns(days = []) {
  const list = days.filter((d) => d && Array.isArray(d.entries) && d.entries.length).sort((a, b) => a.day.localeCompare(b.day)).slice(-30);
  if (list.length < 5) return null;
  const hours = Array(24).fill(0);
  const late = new Map(); const lateFoods = new Map(); let lateHourSum = 0, lateN = 0;
  let skipBreakfast = 0; const over = [];
  const freq = new Map();
  for (const d of list) {
    let hasBf = false;
    for (const e of d.entries) {
      const m = minutesOf(e.time);
      if (m !== null) {
        const h = Math.floor(m / 60);
        hours[h]++;
        if (h >= 21 || h < 4) { late.set(d.day, true); lateFoods.set(e.name, (lateFoods.get(e.name) || 0) + 1); lateHourSum += h < 4 ? h + 24 : h; lateN++; }
        if (h < 11 && h >= 4) hasBf = true;
      }
      if (sectionOf(e) === 'breakfast') hasBf = true;
      if (e.name) freq.set(e.name, (freq.get(e.name) || 0) + 1);
    }
    if (!hasBf && d.entries.length >= 2) skipBreakfast++;
    const k = sumEntries(d.entries).kcal;
    if (d.target && d.target.kcal && k > d.target.kcal * 1.2 && k > 500) over.push(k - d.target.kcal);
  }
  const peak = hours.reduce((bi, c, i, a) => (c > a[bi] ? i : bi), 0);
  const topFoods = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const res = {
    totalDays: list.length,
    lateNight: { days: late.size, foods: [...lateFoods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]), avgHour: lateN ? Math.round(lateHourSum / lateN) % 24 : null },
    skipBreakfast, overshoot: { days: over.length, avgOver: over.length ? r0(over.reduce((a, b) => a + b, 0) / over.length) : 0 },
    peakHour: hours[peak] ? peak : null, hours, topFoods, notes: [],
  };
  if (res.lateNight.days >= 3) res.notes.push({ kind: 'warn', title: 'أكل بالليل متكرر', text: `${res.lateNight.days} أيام فيهم أكل بعد 9 بالليل${res.lateNight.foods.length ? ` (غالبًا ${res.lateNight.foods.join(' أو ')})` : ''}. لو جعان قبل النوم، زبادي يوناني 150 جم: 15 جم بروتين و90 سعرة.` });
  if (skipBreakfast >= 4) res.notes.push({ kind: 'warn', title: 'الفطار بيتفوّت', text: `${skipBreakfast} أيام من ${list.length} من غير فطار. ده بيصعّب توصل للبروتين. فطار سريع: 3 بيضات + 100 جم جبنة قريش.` });
  if (res.overshoot.days >= 3) res.notes.push({ kind: 'warn', title: 'أيام فوق المدى', text: `${res.overshoot.days} أيام فوق الهدف بأكتر من 20% (متوسط +${res.overshoot.avgOver} سعرة). جرّب تسجّل الوجبة قبل ما تاكلها.` });
  if (res.peakHour !== null) res.notes.push({ kind: 'info', title: `أكتر وقت بتاكل فيه حوالي ${String(res.peakHour).padStart(2, '0')}:00`, text: 'وزّع البروتين على 3-4 وجبات بدل وجبة واحدة كبيرة.' });
  if (topFoods.length && topFoods[0][1] >= 6) res.notes.push({ kind: 'info', title: `الأكتر تكرارًا: ${topFoods[0][0]}`, text: `${topFoods[0][1]} مرة في آخر ${list.length} يوم. نوّع مصادر البروتين (سمك، بيض، لحمة) عشان الأحماض الأمينية.` });
  return res;
}

// ───────── recipes ─────────

/**
 * listRecipes(recipes) → [{id, name, items, totals, cookedG|null, servings|null, per100|null, perServing|null}]
 * Reads the new shape {items, cookedG} and the legacy NutriPro shape {ingredients:[{cal,pro,…}], servings}.
 */
export function listRecipes(recipes) {
  const out = [];
  for (const [id, r] of Object.entries(recipes || {})) {
    if (!r || typeof r !== 'object' || !r.name) continue;
    const raw = Array.isArray(r.items) ? r.items : Array.isArray(r.ingredients) ? r.ingredients : [];
    const items = raw.filter((x) => x && x.name).map((x) => ({ foodId: x.foodId || null, name: String(x.name).slice(0, 80), qty: Number(x.qty) || 0, unit: x.unit || 'جرام',
      kcal: Number(x.kcal ?? x.cal) || 0, p: Number(x.p ?? x.pro) || 0, c: Number(x.c ?? x.carb) || 0, f: Number(x.f ?? x.fat) || 0 }));
    const totals = sumEntries(items);
    const cookedG = Number(r.cookedG) > 0 ? Number(r.cookedG) : null;
    const servings = !cookedG && Number(r.servings) > 0 ? Number(r.servings) : null;
    const per = (d) => ({ kcal: r1n(totals.kcal / d), p: r1n(totals.p / d), c: r1n(totals.c / d), f: r1n(totals.f / d) });
    out.push({ id: r.id || id, name: String(r.name).replace(/[^\p{L}\p{N}\s().،,\-+%]/gu, '').trim().slice(0, 60) || 'وصفة', items, totals, cookedG, servings,
      per100: cookedG ? per(cookedG / 100) : null, perServing: servings ? per(servings) : null, createdAt: r.createdAt || r.savedAt || '' });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.name.localeCompare(b.name));
}

/** Recipe → catalog food (per 100 g of cooked weight, or per serving for legacy recipes). */
export function recipeFood(r) {
  if (r.per100) return { id: `r:${r.id}`, name: r.name, per: 100, unit: 'جرام', cat: 'وصفة', ...r.per100, src: 'recipe' };
  if (r.perServing) return { id: `r:${r.id}`, name: r.name, per: 1, unit: 'حصة', cat: 'وصفة', ...r.perServing, src: 'recipe' };
  return null;
}

/** Validate + build a recipe record. → {ok, recipe?, message?} */
export function makeRecipe({ id = null, name, items = [], cookedG }, now = new Date()) {
  const nm = String(name || '').trim().slice(0, 60);
  if (!nm) return { ok: false, message: 'اكتب اسم الوصفة.' };
  if (!items.length) return { ok: false, message: 'ضيف مكوّن واحد على الأقل.' };
  const raw = items.reduce((s, x) => s + (/جرام|مل/.test(x.unit || '') ? Number(x.qty) || 0 : 0), 0);
  const g = Number(cookedG);
  if (!(g >= 10 && g <= 50000)) return { ok: false, message: 'اكتب وزن الأكل بعد الطبخ بالجرام (بين 10 و 50000).' };
  return { ok: true, rawG: raw, recipe: { id: id || newId('r', now.getTime()), name: nm, cookedG: g,
    items: items.map(({ foodId = null, name: n, qty, unit, kcal, p, c, f }) => ({ foodId, name: n, qty, unit, kcal, p, c, f })), createdAt: now.toISOString() } };
}

// ───────── custom foods, AI foods, fats, share ─────────

const FOOD_LIMITS = { kcal: 900, p: 100, c: 100, f: 100, fiber: 100, sodium: 50000 };

/**
 * validateFood({name, unit, per, kcal, p, c, f, fiber, sodium}) → {ok, errors, food}
 * Per-100 g limits apply when the unit is grams/ml; per-piece foods may go up to 5000 kcal.
 */
export function validateFood(v, { id = null } = {}) {
  const errors = {};
  const name = String(v.name || '').replace(/[\u0000-\u001f<>`]/g, '').trim();
  if (!name) errors.name = 'اكتب اسم الأكلة.'; else if (name.length > 80) errors.name = 'الاسم طويل أوي (80 حرف بالكتير).';
  const unit = String(v.unit || 'جرام').slice(0, 16);
  const per = Number(v.per);
  if (!(per > 0 && per <= 5000)) errors.per = 'الكمية المرجعية رقم بين 1 و 5000.';
  const grams = /جرام|مل/.test(unit);
  const scale = grams && per > 0 ? per / 100 : 1;
  const out = {};
  for (const k of ['kcal', 'p', 'c', 'f', 'fiber', 'sodium']) {
    const raw = v[k];
    if ((raw === '' || raw === undefined || raw === null) && k !== 'kcal') { out[k] = k === 'fiber' || k === 'sodium' ? undefined : 0; continue; }
    const x = Number(String(raw).replace(',', '.'));
    const max = grams ? FOOD_LIMITS[k] * scale : k === 'sodium' ? 50000 : 5000;
    if (!Number.isFinite(x) || x < 0 || x > max) errors[k] = k === 'kcal' ? 'اكتب السعرات رقم صحيح.' : 'الرقم ده برّه الحدود المعقولة.';
    else out[k] = Math.round(x * 10) / 10;
  }
  if (!errors.kcal && !(out.kcal > 0)) errors.kcal = 'اكتب السعرات رقم صحيح.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const food = { id: id || newId('u'), name, unit, per, kcal: out.kcal, p: out.p, c: out.c, f: out.f, cat: v.cat || null, src: 'user' };
  if (out.fiber !== undefined) food.fiber = out.fiber;
  if (out.sodium !== undefined) food.sodium = out.sodium;
  return { ok: true, errors, food };
}

export const AI_FOOD_PROMPT = (name) => `[تعليمات التطبيق: المستخدم عايز القيم الغذائية للأكلة دي: «${String(name).slice(0, 80)}». رد بسطر JSON واحد بس من غير أي كلام: {"name":"<اسم عربي مختصر>","per":100,"unit":"جرام","kcal":<رقم>,"p":<رقم>,"c":<رقم>,"f":<رقم>,"fiber":<رقم>}. لو الأكلة بتتعد بالحبة استخدم "unit":"حبة","per":1. القيم متوسطة ومعقولة.]`;

/** Parse the AI's food JSON (untrusted) → validated food (not saved) or null. */
export function parseAIFood(text) {
  const t = String(text ?? '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  let j;
  try { j = JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const unit = ['جرام', 'مل', 'حبة', 'حصة', 'رغيف', 'كوب', 'ملعقة', 'سكوب'].includes(j.unit) ? j.unit : 'جرام';
  const r = validateFood({ name: cleanText(j.name, 80), unit, per: unit === 'جرام' || unit === 'مل' ? 100 : Number(j.per) || 1, kcal: j.kcal, p: j.p ?? 0, c: j.c ?? 0, f: j.f ?? 0, fiber: j.fiber ?? '' });
  return r.ok ? { ...r.food, src: 'ai' } : null;
}

/** Added fat chips (real entries, not multipliers). */
export const ADDED_FATS = Object.freeze([
  { key: 'oil_tsp', label: 'زيت · معلقة صغيرة', name: 'زيت مضاف (معلقة صغيرة)', kcal: 40, f: 4.5 },
  { key: 'oil_tbsp', label: 'زيت · معلقة كبيرة', name: 'زيت مضاف (معلقة كبيرة)', kcal: 120, f: 13.5 },
  { key: 'ghee_tbsp', label: 'سمنة · معلقة كبيرة', name: 'سمنة مضافة (معلقة كبيرة)', kcal: 115, f: 13 },
]);
export function fatEntry(key, section, now = new Date()) {
  const a = ADDED_FATS.find((x) => x.key === key);
  if (!a) return null;
  return { id: newId('e', now.getTime()), foodId: `fat:${a.key}`, name: a.name, qty: 1, unit: 'معلقة', kcal: a.kcal, p: 0, c: 0, f: a.f, section, time: hhmm(now), src: 'fat' };
}

/** Plain-text day summary for navigator.share. */
export function dayShareText(label, groups, intake, t) {
  const lines = [`حساب اليوم · ${label}`];
  for (const s of SECTIONS) {
    const g = groups[s.key];
    if (!g || !g.entries.length) continue;
    lines.push(`${s.label}: ${r0(g.totals.kcal)} سعرة · ${r0(g.totals.p)} جم بروتين`);
    for (const e of g.entries) lines.push(`  - ${String(e.name).slice(0, 60)}`);
  }
  lines.push(`المجموع: ${r0(intake.kcal)} من ${r0(t.kcal)} سعرة · بروتين ${r0(intake.p)} من ${r0(t.p)} جم · كارب ${r0(intake.c)} · دهون ${r0(intake.f)}`);
  return lines.join('\n');
}

/** Month grid (Saturday-first in the UI is not assumed): weeks of 7 day keys or null, Monday first by default. */
export function monthGrid(year, month0, startDow = 1) {
  const first = new Date(year, month0, 1);
  const days = new Date(year, month0 + 1, 0).getDate();
  const lead = (first.getDay() - startDow + 7) % 7;
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Photo analysis history entry (text only, no image) — last 20 kept. */
export function pushPhotoHistory(list, items, now = new Date()) {
  const clean = (items || []).slice(0, 12).map((x) => ({ name: cleanText(x.name, 80), grams: Number(x.grams) || 0, kcal: Number(x.kcal) || 0, p: Number(x.p) || 0, c: Number(x.c) || 0, f: Number(x.f) || 0 })).filter((x) => x.name && x.grams > 0);
  if (!clean.length) return list || [];
  return [{ id: newId('ph', now.getTime()), at: now.toISOString(), items: clean }, ...(Array.isArray(list) ? list : [])].slice(0, 20);
}
