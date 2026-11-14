import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENTS, ING } from '../src/features/kitchen/ingredients.js';
import { RECIPES } from '../src/features/kitchen/recipes.js';
import { macros, baseQty, fit, servingMacros, pieceMacros, matchPantry, remainingTarget, isFixed, qtyText, isQuick } from '../src/features/kitchen/logic.js';

test('ingredient table: calories agree with the macros (Atwater, within 20 %)', () => {
  for (const g of INGREDIENTS) {
    const calc = 4 * g.p + 4 * g.c + 9 * g.f;
    if (g.id === 'cocoa') continue; // fibre-heavy: label calories sit well under 4-4-9
    assert.ok(Math.abs(calc - g.kcal) / g.kcal < 0.2 || Math.abs(calc - g.kcal) <= 8, `${g.id}: ${g.kcal} vs ${Math.round(calc)}`);
  }
});

test('every recipe uses known ingredients, has steps, and levers sit inside their own bounds', () => {
  const ids = new Set();
  for (const r of RECIPES) {
    assert.ok(!ids.has(r.id), `duplicate ${r.id}`); ids.add(r.id);
    assert.ok(r.steps.length >= 2 && r.spices.length >= 1, r.id);
    for (const [id, q, l] of r.ing) {
      assert.ok(ING[id], `${r.id}: ${id}`);
      assert.ok(q > 0, `${r.id}: ${id} qty`);
      if (l) {
        assert.ok(!isFixed(r), `${r.id}: fixed recipes have no levers`);
        assert.ok(q >= l.min && q <= l.max && (q - l.min) % l.step === 0, `${r.id}: ${id} lever`);
      }
    }
    if (!isFixed(r)) assert.ok(r.ing.some((x) => x[2]), `${r.id}: needs a lever`);
  }
});

test('servings are real meals: plates 350-900 kcal, dessert pieces under 320 kcal', () => {
  for (const r of RECIPES) {
    const m = servingMacros(r);
    if (r.cat === 'dessert') assert.ok(m.kcal >= 60 && m.kcal <= 320, `${r.id}: ${m.kcal}`);
    else if (!isFixed(r)) assert.ok(m.kcal >= 350 && m.kcal <= 900, `${r.id}: ${m.kcal}`);
  }
});

test('macros: chicken and rice by hand', () => {
  const m = macros({ chicken: 200, rice: 100, oil: 5 });
  assert.equal(m.kcal, Math.round(240 + 365 + 44.2));
  assert.equal(m.p, 52.1);
  assert.throws(() => macros({ unicorn: 10 }));
});

test('fit: moves only levers, in steps, inside bounds, and gets close', () => {
  const r = RECIPES.find((x) => x.id === 'chicken-rice');
  const out = fit(r, { kcal: 800, p: 60 });
  assert.equal(out.qty.oil, 5);
  assert.equal(out.qty.chicken % 25, 0); assert.equal(out.qty.rice % 25, 0);
  assert.ok(out.qty.chicken >= 125 && out.qty.chicken <= 300);
  assert.ok(out.ok, JSON.stringify(out));
  assert.ok(Math.abs(out.macros.kcal - 800) <= 60);
  assert.deepEqual(baseQty(r), { chicken: 200, rice: 100, oil: 5 }, 'recipe untouched');
});

test('fit: an impossible target says so instead of inventing quantities', () => {
  const r = RECIPES.find((x) => x.id === 'sardine-sandwich');
  const out = fit(r, { kcal: 1500, p: 120 });
  assert.equal(out.ok, false);
  assert.ok(out.qty.sardine <= 180 && out.qty.bread <= 2);
});

test('fit: eggs and loaves stay whole', () => {
  const r = RECIPES.find((x) => x.id === 'shakshuka');
  const out = fit(r, { kcal: 700, p: 35 });
  assert.ok(Number.isInteger(out.qty.egg) && Number.isInteger(out.qty.bread));
});

test('fit: fixed recipes choose a number of pieces, never rescale the batch', () => {
  const r = RECIPES.find((x) => x.id === 'date-balls');
  const one = pieceMacros(r);
  const out = fit(r, { kcal: one.kcal * 2 });
  assert.equal(out.pieces, 2);
  assert.deepEqual(out.qty, baseQty(r));
  assert.equal(fit(r, { kcal: 5000 }).pieces, r.max);
});

test('fit: no target → the recipe as written', () => {
  const r = RECIPES[0];
  assert.deepEqual(fit(r, null).qty, baseQty(r));
  assert.deepEqual(fit(r, { kcal: 0 }).macros, servingMacros(r));
});

test('pantry: fewest missing first, names what is missing', () => {
  const rows = matchPantry(RECIPES, ['chicken', 'rice', 'oil', 'egg', 'oats']);
  assert.equal(rows[0].recipe.id, 'chicken-rice');
  assert.equal(rows[0].missing.length, 0);
  const kabsa = rows.find((x) => x.recipe.id === 'kabsa');
  assert.ok(kabsa.missing.includes('بصل'));
  assert.equal(matchPantry(RECIPES, [])[0].recipe.id, RECIPES[0].id, 'empty pantry keeps order');
});

test('remaining target splits over meals and never goes negative', () => {
  assert.deepEqual(remainingTarget({ kcal: 2550, p: 155, c: 325, f: 70 }, { kcal: 1350, p: 95, c: 400, f: 30 }, 2), { kcal: 600, p: 30, c: 0, f: 20 });
});

test('text + tags', () => {
  assert.equal(qtyText('chicken', 200), '200 جم');
  assert.equal(qtyText('egg', 3), '3 بيضات');
  assert.equal(qtyText('egg', 2), '2 بيضة');
  assert.equal(qtyText('bread', 1), '1 رغيف');
  assert.ok(isQuick(RECIPES.find((x) => x.id === 'sardine-sandwich')));
  assert.ok(!isQuick(RECIPES.find((x) => x.id === 'kabsa')));
});

// ───────── خطة الأسبوع ─────────
import { planWeek } from '../src/features/kitchen/week.js';
const T = { training: { kcal: 2850, p: 155, c: 400, f: 70 }, heart: { kcal: 2550, p: 155, c: 325, f: 70 }, rest: { kcal: 2350, p: 155, c: 275, f: 70 } };
const week = (types) => types.map((type, i) => ({ day: `2026-11-${15 + i}`, type, target: T[type] }));

test('week: every day gets breakfast + rotating meals, and lands near its own target', () => {
  const w = planWeek({ days: week(['training', 'training', 'rest', 'training', 'training', 'heart']), breakfast: 'std-breakfast', meals: ['chicken-rice', 'kabsa'], perDay: 2 });
  assert.equal(w.days.length, 6);
  for (const d of w.days) {
    assert.deepEqual(d.slots.map((s) => s.kind), ['breakfast', 'meal', 'meal']);
    assert.deepEqual(d.slots.slice(1).map((s) => s.rid), ['chicken-rice', 'kabsa']);
    assert.ok(Math.abs(d.off.kcal) <= 0.1, `${d.type} kcal ${d.total.kcal} vs ${d.target.kcal}`);
    assert.ok(d.off.p >= -0.1, `${d.type} protein ${d.total.p}`);
  }
  const tr = w.days[0].slots[1].qty.rice; const re = w.days[2].slots[1].qty.rice;
  assert.ok(tr > re, 'training box carries more rice than the rest box');
});

test('week: shopping list is the exact sum of what the days use', () => {
  const days = week(['training', 'rest', 'heart']);
  const w = planWeek({ days, breakfast: 'std-breakfast', meals: ['chicken-rice'], perDay: 2 });
  const chicken = w.days.reduce((s, d) => s + d.slots.filter((x) => x.kind === 'meal').reduce((a, x) => a + x.qty.chicken, 0), 0);
  assert.equal(w.shopping.find((x) => x.id === 'chicken').qty, chicken);
  assert.equal(w.shopping.find((x) => x.id === 'egg').qty, 12);
  assert.equal(w.shopping.find((x) => x.id === 'whey').qty, 3);
  const prep = w.prep.find((x) => x.rid === 'chicken-rice');
  assert.equal(prep.boxes, 6);
  assert.equal(prep.sizes.reduce((s, x) => s + x.count, 0), 6);
  assert.equal(prep.sizes.length, 3, 'one box size per day type');
});

test('week: dessert is whole batches, one piece a day', () => {
  const w = planWeek({ days: week(['training', 'training', 'rest']), breakfast: null, meals: ['chicken-rice'], dessert: 'date-balls', perDay: 2 });
  assert.equal(w.days[0].slots.at(-1).kind, 'dessert');
  assert.equal(w.shopping.find((x) => x.id === 'dates').qty, 120, '3 balls → one batch of 8');
  assert.equal(w.prep.find((x) => x.rid === 'date-balls').batches, 1);
});

test('week: an empty or impossible plan does not throw and says it is not ok', () => {
  assert.deepEqual(planWeek({}).days, []);
  const w = planWeek({ days: week(['training']), meals: ['sardine-sandwich'], perDay: 1 });
  assert.equal(w.ok, false);
  assert.equal(planWeek({ days: week(['rest']), meals: ['nope'] }).days[0].slots.length, 0);
});
