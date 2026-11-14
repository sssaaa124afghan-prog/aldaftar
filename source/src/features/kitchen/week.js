// «خطة الأسبوع» pure logic: chosen recipes + each day's own target → what goes on the plate every day, one shopping list
// in raw weights, and a prep sheet (how many boxes of each size). Same rule as the rest of the kitchen: numbers come only
// from ingredients.js through logic.js › macros / fit.
import { ING } from './ingredients.js';
import { RECIPES } from './recipes.js';
import { fit, macros, baseQty, pieceMacros, isFixed, qtyText } from './logic.js';

const KEYS = ['kcal', 'p', 'c', 'f'];
const r1 = (n) => Math.round(n * 10) / 10;
const byId = (id) => RECIPES.find((r) => r.id === id) || null;
const add = (a, b, k = 1) => { for (const key of KEYS) a[key] = r1(a[key] + b[key] * k); return a; };
const zero = () => ({ kcal: 0, p: 0, c: 0, f: 0 });

/** One breakfast as it is eaten: the written plate, or every piece of a fixed recipe (4 pancakes). */
function wholeServing(r) {
  if (!isFixed(r)) return { qty: baseQty(r), pieces: null, macros: macros(baseQty(r)) };
  const one = pieceMacros(r); const n = r.max || r.yield;
  return { qty: baseQty(r), pieces: n, macros: { kcal: one.kcal * n, p: r1(one.p * n), c: r1(one.c * n), f: r1(one.f * n) } };
}

/**
 * planWeek({days: [{day, type, target:{kcal,p,c,f}}], breakfast, meals: [recipeIds], dessert, perDay})
 * → {days: [{day, type, target, slots: [{key, kind, rid, name, unit, n, macros, qty}], total, off:{kcal,p}}],
 *    shopping: [{id, name, qty, text, packs}], prep: [{rid, name, boxes, sizes: [{type, count, lines:[{name,state,text}], macros}], total: [...]}],
 *    spices: [..], ok}
 * Meals rotate through the day slots, so two recipes over two meals a day means one of each daily.
 * Each prepared meal is fitted to (day target − breakfast − dessert) ÷ perDay for THAT day type, so training-day boxes
 * carry more rice than rest-day boxes while the recipe stays the same.
 */
export function planWeek({ days = [], breakfast = null, meals = [], dessert = null, perDay = 2 } = {}) {
  const bf = byId(breakfast); const ds = byId(dessert);
  const mealRs = meals.map(byId).filter((r) => r && !isFixed(r));
  const n = Math.max(1, Math.min(3, Number(perDay) || 2));
  const bfS = bf ? wholeServing(bf) : null;
  const dsOne = ds && isFixed(ds) ? pieceMacros(ds) : null;
  const fits = new Map(); // `${rid}|${type}` → fit result
  const need = {}; // ingredient → raw quantity for the whole plan
  const bump = (qty, k = 1) => { for (const [id, q] of Object.entries(qty)) need[id] = (need[id] || 0) + q * k; };
  const sizes = new Map(); // rid → Map(type → {count, res})
  let dessertPieces = 0; let bfCount = 0; let cursor = 0;

  const outDays = days.map((d) => {
    const slots = []; const total = zero();
    if (bfS) { slots.push({ key: 'b', kind: 'breakfast', rid: bf.id, name: bf.name, unit: bfS.pieces ? bf.unit : 'طبق', n: bfS.pieces || 1, macros: bfS.macros, qty: bfS.qty }); add(total, bfS.macros); bfCount++; }
    const left = {};
    for (const k of KEYS) left[k] = Math.max(0, (Number(d.target[k]) || 0) - total[k] - (dsOne ? dsOne[k] : 0));
    const per = Object.fromEntries(KEYS.map((k) => [k, Math.round(left[k] / n)]));
    for (let s = 0; s < n && mealRs.length; s++) {
      const r = mealRs[cursor++ % mealRs.length];
      const key = `${r.id}|${d.type}`;
      if (!fits.has(key)) fits.set(key, fit(r, per));
      const res = fits.get(key);
      slots.push({ key: `m${s}`, kind: 'meal', rid: r.id, name: r.name, unit: 'علبة', n: 1, macros: res.macros, qty: res.qty, fitOk: res.ok });
      add(total, res.macros); bump(res.qty);
      if (!sizes.has(r.id)) sizes.set(r.id, new Map());
      const m = sizes.get(r.id); const cur = m.get(d.type) || { count: 0, res };
      cur.count++; m.set(d.type, cur);
    }
    if (dsOne) { slots.push({ key: 'd', kind: 'dessert', rid: ds.id, name: ds.name, unit: ds.unit, n: 1, macros: dsOne, qty: null }); add(total, dsOne); dessertPieces++; }
    const off = { kcal: d.target.kcal > 0 ? (total.kcal - d.target.kcal) / d.target.kcal : 0, p: d.target.p > 0 ? (total.p - d.target.p) / d.target.p : 0 };
    return { day: d.day, type: d.type, target: d.target, slots, total: { kcal: Math.round(total.kcal), p: r1(total.p), c: r1(total.c), f: r1(total.f) }, off };
  });

  if (bfS) bump(bfS.qty, isFixed(bf) ? Math.ceil((bfS.pieces * bfCount) / bf.yield) / 1 : bfCount);
  let dessertBatches = 0;
  if (ds && dessertPieces) { dessertBatches = Math.ceil(dessertPieces / ds.yield); bump(baseQty(ds), dessertBatches); }

  const order = Object.keys(ING);
  const shopping = Object.entries(need).filter(([, q]) => q > 0).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([id, q]) => {
    const g = ING[id];
    const qty = g.unit === 'g' ? Math.ceil(q / 5) * 5 : Math.ceil(q);
    return { id, name: g.name, state: g.state || '', group: g.group, qty, text: g.unit === 'g' && qty >= 1000 ? `${r1(qty / 1000)} كجم` : qtyText(id, qty), packs: g.unit === 'g' && g.pack ? Math.ceil(qty / g.pack) : null, pack: g.pack || null };
  });

  const lineOf = (r, qty, k = 1) => r.ing.map(([id]) => ({ id, name: ING[id].name, state: ING[id].state || '', text: qtyText(id, qty[id] * k) }));
  const prep = [...sizes.entries()].map(([rid, m]) => {
    const r = byId(rid); const tot = {}; let boxes = 0;
    const sz = [...m.entries()].map(([type, { count, res }]) => {
      boxes += count; for (const [id, q] of Object.entries(res.qty)) tot[id] = (tot[id] || 0) + q * count;
      return { type, count, macros: res.macros, lines: lineOf(r, res.qty), ok: res.ok };
    });
    return { rid, name: r.name, boxes, sizes: sz, total: lineOf(r, tot), spices: r.spices, steps: r.steps };
  });
  if (ds && dessertBatches) prep.push({ rid: ds.id, name: ds.name, boxes: dessertBatches * ds.yield, unit: ds.unit, fixed: true, batches: dessertBatches, sizes: [], total: lineOf(ds, baseQty(ds), dessertBatches), spices: ds.spices, steps: ds.steps });

  const ok = outDays.every((d) => Math.abs(d.off.kcal) <= 0.1 && d.off.p >= -0.1);
  return { days: outDays, shopping, prep, ok, perDay: n };
}

/** Cooked food keeps 3 days in the fridge: boxes for day index ≥ 3 after the cook day belong in the freezer. */
export const boxesToFreeze = (dayCount, fridgeDays = 3) => Math.max(0, dayCount - fridgeDays);
