// food.log from the coach chat (pure): resolve each item against the app's food DB with the nutrition ranker, else keep
// the model's estimate flagged «تقدير»; recompute macros when the amount changes; build foodLog entries. Nothing writes here.
import { addDays, isDayKey } from '../../core/date.js';
import { portion, sumEntries } from '../../core/targets.js';
import { searchFoods, scoreFood, normalizeAr, stemAr, makeEntry, newId, sectionForHour, SECTION_LABEL } from '../nutrition/logic.js';
import { parseFoodUtterance } from '../nutrition/voice.js';
import { FOOD_LOG_RE } from './prompts.js';

const r1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
const isGramFood = (f) => /جرام|مل/.test((f && f.unit) || 'جرام');

/** 'today' | 'yesterday' | YYYY-MM-DD → a day key between today−30 and today (a future or bad date falls back to today). */
export function resolveDay(ref, today) {
  if (ref === 'yesterday') return addDays(today, -1);
  if (isDayKey(ref) && ref <= today && ref >= addDays(today, -30)) return ref;
  return today;
}

/** Every spoken word must start a word of the food name or an alias («مية» must not match «كريمية»). */
function wordsHit(food, q) {
  const qWords = q.split(' ').filter((w) => w.length > 1);
  if (!qWords.length) return false;
  return [food._n || normalizeAr(food.name), ...(food.aliases || []).map(normalizeAr)].some((n) => {
    const fw = n.split(' ');
    return qWords.every((w) => fw.some((x) => x.startsWith(w) || x.startsWith(stemAr(w)) || stemAr(x) === stemAr(w) || x === `ا${w}`));
  });
}

/** Best DB food for an item (unit-compatible: grams ↔ gram foods, a count ↔ piece foods), or null. */
export function matchFoods(item, catalog, { usage = null, minScore = 60, limit = 4 } = {}) {
  const q = normalizeAr(item.name);
  if (!q) return [];
  const wantGrams = item.grams > 0;
  return searchFoods(catalog, item.name, { usage, limit: 10 })
    .filter((f) => !f.deleted && scoreFood(f, q) >= minScore && wordsHit(f, q) && (wantGrams ? isGramFood(f) : !isGramFood(f))).slice(0, limit);
}
export const matchFood = (item, catalog, opts) => matchFoods(item, catalog, opts)[0] || null;

/**
 * resolveItems(action.items, catalog, {usage, hour}) → rows
 * row: {name, food|null, amount, unit, meal, est, base:{kcal,p,c,f per 1 unit} | null, kcal, p, c, f}
 */
export function resolveItems(items, catalog = [], { usage = null, hour = new Date().getHours(), meal = null } = {}) {
  const fallbackMeal = meal || sectionForHour(hour);
  return (items || []).map((it) => {
    const amount = it.grams > 0 ? it.grams : it.qty;
    const alts = matchFoods(it, catalog, { usage });
    const k = ['kcal', 'p', 'c', 'f'];
    const hasEst = k.some((x) => Number(it[x]) > 0);
    const base = Object.fromEntries(k.map((x) => [x, amount > 0 ? (Number(it[x]) || 0) / amount : 0]));
    const row = { name: it.name, meal: it.meal || fallbackMeal, amount, unit: it.grams > 0 ? 'جم' : (it.unit || 'حبة'), alts, base, hasEst, estUnit: it.grams > 0 ? 'جم' : (it.unit || 'حبة') };
    const viaDb = alts.length ? withFood(row, alts[0]) : null;
    if (viaDb && !viaDb.invalid) return viaDb;
    return { ...row, food: null, est: true, ...Object.fromEntries(k.map((x) => [x, r1(it[x])])) };
  });
}

/** Switch a row to another DB food (from row.alts) or back to the model's estimate (food = null). */
export function withFood(row, food) {
  if (!food) return withAmount({ ...row, food: null, est: true, unit: row.estUnit || row.unit }, row.amount);
  let m = null; try { m = portion(food, row.amount); } catch { m = null; }
  if (!m) return { ...row, invalid: true };
  return { ...row, food, est: false, invalid: false, unit: isGramFood(food) ? (/مل/.test(food.unit) ? 'مل' : 'جم') : food.unit, ...m };
}

/** Same row with a new amount: DB food → portion(), estimate → scaled from the model's per-unit values. */
export function withAmount(row, amount) {
  const a = Number(amount);
  if (!(a > 0 && a <= 5000)) return { ...row, amount: a, invalid: true };
  if (row.food) { try { return { ...row, amount: a, invalid: false, ...portion(row.food, a) }; } catch { return { ...row, amount: a, invalid: true }; } }
  const b = row.base || {};
  return { ...row, amount: a, invalid: false, kcal: r1(b.kcal * a), p: r1(b.p * a), c: r1(b.c * a), f: r1(b.f * a) };
}

export const totals = (rows) => sumEntries(rows.filter((r) => !r.invalid));

/** Rows → foodLog entries (each with its own meal). */
export function entriesFor(rows, now = new Date()) {
  return rows.filter((r) => !r.invalid && r.amount > 0).map((r) => {
    if (r.food) { try { return { ...makeEntry(r.food, r.amount, r.meal, now, 'coach') }; } catch { /* fall back to the values shown */ } }
    return { id: newId('e', now.getTime()), foodId: null, name: String(r.name).slice(0, 120), qty: r.amount, unit: r.unit === 'جم' ? 'جرام' : r.unit,
      kcal: r1(r.kcal), p: r1(r.p), c: r1(r.c), f: r1(r.f), section: r.meal, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, src: 'coach', est: true };
  });
}

/**
 * Local fast path for «اكلت 150 جم كبدة و290 جم مكرونة للغدا» (no API call): split into items, every item must have an amount
 * and a confident DB match, otherwise null (the model handles it). → food.log action with DB-resolved items.
 */
export function localFoodLog(text, catalog, { usage = null } = {}) {
  const t = normalizeAr(String(text || ''));
  if (!FOOD_LOG_RE.test(t)) return null;
  const body = t.replace(/^(.*?\s)?(اكلت|كلت|فطرت|اتغديت|تغديت|اتعشيت|تعشيت|شربت|سجل(لي|ي)?|ضيف(لي)?|ضف|احسبلي)\s+/, '');
  const pieces = body.split(/\s*(?:[,،+]|\s(?:و)(?=\s*\d)|\sو(?=\d))\s*/).map((x) => x.trim()).filter(Boolean);
  if (!pieces.length || pieces.length > 8) return null;
  let meal = null;
  const items = [];
  for (const piece of pieces) {
    const p = parseFoodUtterance(`ضيف ${piece}`);
    if (p.section) meal = meal || p.section;
    if (!p.name || !(p.qty > 0)) return null;
    const it = p.unit === 'g' || p.unit === 'ml' || (!p.unit && p.qty >= 10) ? { name: p.name, grams: p.qty } : { name: p.name, qty: p.qty, unit: 'حبة' };
    if (!matchFood(it, catalog, { usage, minScore: 70 })) return null;
    items.push(it);
  }
  return { type: 'food.log', day: 'today', meal, items: items.map((x) => ({ ...x, meal })) };
}

export const MEAL_LABEL = SECTION_LABEL;
