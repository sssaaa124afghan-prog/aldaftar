// «المطبخ» pure logic (no DOM, no storage): macros from the ingredient table, the bounded «ظبطها» fit, pantry match.
// Macros are ALWAYS computed here from ingredients.js; nothing else (and no AI) supplies numbers.
import { ING } from './ingredients.js';

const r1 = (n) => Math.round(n * 10) / 10;
const KEYS = ['kcal', 'p', 'c', 'f'];
const PRICEY = new Set(['beef', 'greek', 'feta', 'pb', 'cocoa', 'tortilla', 'tuna']);

export const isFixed = (r) => Number(r.yield) > 0;
export const totalMin = (r) => (r.active || 0) + (r.wait || 0);
/** «سريعة»: at most 15 minutes of your own work (waiting on the air fryer does not count). */
export const isQuick = (r) => (r.active || 0) <= 10 && totalMin(r) <= 30;
/** «رخيصة»: at most one ingredient from the pricier shelf. Prices are not tracked (they change monthly). */
export const isCheap = (r) => r.ing.filter(([id]) => PRICEY.has(id)).length <= 1 && !r.ing.some(([id]) => id === 'beef');

/** Base quantities of a recipe → {ingredientId: qty}. */
export const baseQty = (r) => Object.fromEntries(r.ing.map(([id, q]) => [id, q]));

/** Macros of a quantity map. Unknown ingredient → throws (a recipe must never be shown with a guessed number). */
export function macros(qty) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const [id, q] of Object.entries(qty)) {
    const g = ING[id];
    if (!g) throw new Error(`unknown ingredient: ${id}`);
    const k = Number(q) / g.per;
    for (const key of KEYS) t[key] += g[key] * k;
  }
  return { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) };
}

/** One piece of a fixed recipe (whole batch ÷ yield). */
export function pieceMacros(r) {
  const t = macros(baseQty(r));
  return { kcal: Math.round(t.kcal / r.yield), p: r1(t.p / r.yield), c: r1(t.c / r.yield), f: r1(t.f / r.yield) };
}

/** What one serving is, as written: a plate (scalable recipes) or one piece (fixed recipes). */
export const servingMacros = (r) => (isFixed(r) ? pieceMacros(r) : macros(baseQty(r)));

const W = { kcal: 2, p: 3, c: 1, f: 1 };
/** Weighted relative distance from a target; dimensions the target leaves out (0 / missing) are ignored. */
export function fitError(m, target) {
  let e = 0;
  for (const k of KEYS) { const t = Number(target && target[k]); if (t > 0) e += W[k] * Math.abs(m[k] - t) / t; }
  return e;
}
const rel = (v, t) => (Number(t) > 0 ? (v - t) / t : 0);

/**
 * «ظبطها»: bring ONE serving of a recipe as close as it can get to target {kcal, p, c, f} (any subset).
 * Scalable recipe → only its levers move, in their own cookable steps (25 g, whole eggs, whole loaves), inside min..max.
 * Fixed recipe → picks how many pieces (1..max).
 * → {qty, pieces, macros, off: {kcal, p} (signed, relative), ok}. ok = calories within 10 % and protein not more than 10 % short.
 */
export function fit(r, target) {
  if (!target || !KEYS.some((k) => Number(target[k]) > 0)) { const m = servingMacros(r); return { qty: baseQty(r), pieces: isFixed(r) ? 1 : null, macros: m, off: { kcal: 0, p: 0 }, ok: true }; }
  if (isFixed(r)) {
    const one = pieceMacros(r);
    let best = null;
    for (let n = 1; n <= (r.max || 4); n++) {
      const m = { kcal: one.kcal * n, p: r1(one.p * n), c: r1(one.c * n), f: r1(one.f * n) };
      const e = fitError(m, target);
      if (!best || e < best.e) best = { e, n, m };
    }
    return done(baseQty(r), best.n, best.m, target);
  }
  const qty = baseQty(r);
  const levers = r.ing.filter((x) => x[2]).map(([id, , l]) => ({ id, ...l }));
  let cur = fitError(macros(qty), target);
  for (let i = 0; i < 400; i++) {
    let move = null;
    for (const l of levers) for (const d of [l.step, -l.step]) {
      const v = qty[l.id] + d;
      if (v < l.min || v > l.max) continue;
      const e = fitError(macros({ ...qty, [l.id]: v }), target);
      if (e < cur - 1e-9 && (!move || e < move.e)) move = { id: l.id, v, e };
    }
    if (!move) break;
    qty[move.id] = move.v; cur = move.e;
  }
  return done(qty, null, macros(qty), target);
}
function done(qty, pieces, m, target) {
  const off = { kcal: rel(m.kcal, target.kcal), p: rel(m.p, target.p) };
  return { qty, pieces, macros: m, off, ok: Math.abs(off.kcal) <= 0.1 && off.p >= -0.1 };
}

/** Readable quantity: «200 جم» / «3 بيضات». */
export function qtyText(id, q) {
  const g = ING[id];
  if (g.unit === 'g') return `${Math.round(q)} جم`;
  const n = Math.round(q * 100) / 100;
  return `${n} ${g.word || ''}`.trim();
}

/** Ingredient lines for `servings` plates (or the whole fixed batch × batches). */
export function lines(r, qty, times = 1) {
  return r.ing.map(([id]) => ({ id, name: ING[id].name, state: ING[id].state || '', note: ING[id].note || '', qty: qty[id] * times, text: qtyText(id, qty[id] * times) }));
}

/**
 * «عندي إيه؟»: rank recipes by what is missing from the pantry (set of ingredient ids).
 * → [{recipe, missing: [names], have, need}] fewest missing first; an empty pantry keeps the library order.
 */
export function matchPantry(recipes, pantry) {
  const have = pantry instanceof Set ? pantry : new Set(pantry || []);
  const rows = recipes.map((recipe, i) => {
    const ids = recipe.ing.map(([id]) => id);
    const missing = ids.filter((id) => !have.has(id));
    return { recipe, i, missing: missing.map((id) => ING[id].name), have: ids.length - missing.length, need: ids.length };
  });
  if (!have.size) return rows;
  return rows.sort((a, b) => a.missing.length - b.missing.length || b.have - a.have || a.i - b.i);
}

/** Target for the next meal: what is left today split over the meals still to come (never negative). */
export function remainingTarget(dayTarget, intake, meals = 1) {
  const n = Math.max(1, Math.min(4, Number(meals) || 1));
  const out = {};
  for (const k of KEYS) out[k] = Math.max(0, Math.round(((Number(dayTarget[k]) || 0) - (Number(intake[k]) || 0)) / n));
  return out;
}

export const FRIDGE_DAYS = 3;
