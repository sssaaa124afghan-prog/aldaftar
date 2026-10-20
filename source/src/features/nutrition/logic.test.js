import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';
import { FOODS } from './foods.js';

test('foods.js: 457 valid foods with unique ids', () => {
  assert.equal(FOODS.length, 457);
  assert.equal(new Set(FOODS.map((f) => f.id)).size, 457);
  for (const f of FOODS) {
    assert.ok(f.name && !/[<>]/.test(f.name));
    assert.ok(f.per > 0 && f.kcal >= 0 && f.p >= 0 && f.c >= 0 && f.f >= 0);
  }
});

test('normalizeAr folds hamza, ta marbuta, alef maqsura, diacritics, digits', () => {
  assert.equal(L.normalizeAr('أُرْز  إفطار آخر'), 'ارز افطار اخر');
  assert.equal(L.normalizeAr('بيضة مسلوقة'), 'بيضه مسلوقه');
  assert.equal(L.normalizeAr('مشوى'), 'مشوي');
  assert.equal(L.normalizeAr('١٥٠ جم'), '150 جم');
  assert.equal(L.normalizeAr('ـلبـن'), 'لبن');
});

test('search: exact/prefix first, synonyms (دجاج→فراخ), typo-tolerant stems', () => {
  const cat = L.buildCatalog(FOODS, []);
  const r1 = L.searchFoods(cat, 'صدور فراخ');
  assert.match(r1[0].name, /صدور فراخ/);
  const r2 = L.searchFoods(cat, 'صدر دجاج');
  assert.ok(r2.some((f) => /فراخ|دجاج/.test(f.name)), 'synonym hit');
  const r3 = L.searchFoods(cat, 'ارز');
  assert.ok(r3.some((f) => /رز|أرز/.test(f.name)));
  assert.deepEqual(L.searchFoods(cat, ''), []);
});

test('search ranks frequently used foods first among equals; empty query → recent/frequent', () => {
  const cat = L.buildCatalog(FOODS, []);
  const egg = cat.find((f) => /^بيض/.test(f.name));
  const usage = L.computeUsage([{ day: '2026-10-18', entries: [{ foodId: egg.id, name: egg.name, qty: 200, section: 'breakfast' }] }]);
  assert.equal(L.searchFoods(cat, '', { usage })[0].id, egg.id);
  assert.equal(usage.get(egg.id).lastQty, 200);
  assert.deepEqual(L.suggestionsFor(cat, usage, 'breakfast').map((f) => f.id), [egg.id]);
  assert.equal(L.suggestionsFor(cat, usage, 'dinner').length, 0);
});

test('catalog: db foods win over defaults by name; deleted hides default', () => {
  const defs = [{ id: 'd:f1', name: 'صدور فراخ مشوية', per: 100, kcal: 165, p: 31, c: 0, f: 3.6 }, { id: 'd:f2', name: 'رز', per: 100, kcal: 130, p: 2.7, c: 28, f: 0.3 }];
  const cat = L.buildCatalog(defs, [{ id: 'u1', name: 'صدور فراخ مشويه', per: 100, kcal: 170, p: 32, c: 0, f: 4 }, { id: 'd:f2', name: 'رز', deleted: true }]);
  assert.equal(cat.length, 1);
  assert.equal(cat[0].kcal, 170);
});

test('sections: keys, legacy Arabic labels, time fallback', () => {
  assert.equal(L.sectionOf({ section: 'lunch' }), 'lunch');
  assert.equal(L.sectionOf({ section: 'إفطار' }), 'breakfast');
  assert.equal(L.sectionOf({ section: 'غداء' }), 'lunch');
  assert.equal(L.sectionOf({ section: 'عشاء' }), 'dinner');
  assert.equal(L.sectionOf({ section: 'وجبة', time: '21:10' }), 'snack');
  assert.equal(L.sectionOf({ time: '08:00' }), 'breakfast');
  const g = L.groupBySection([{ section: 'إفطار', kcal: 100, p: 10 }, { section: 'lunch', kcal: 300, p: 20 }, { section: 'lunch', kcal: 50, p: 1 }]);
  assert.equal(g.lunch.totals.kcal, 350);
  assert.equal(g.breakfast.entries.length, 1);
});

test('makeEntry uses per (scoop of 30 g, piece) and validates qty 1..5000', () => {
  const scoop = { id: 'x', name: 'واي', per: 30, unit: 'جرام', kcal: 120, p: 24, c: 3, f: 1.5 };
  const e = L.makeEntry(scoop, 60, 'breakfast', new Date(2026, 9, 19, 8, 5));
  assert.equal(e.kcal, 240); assert.equal(e.p, 48); assert.equal(e.time, '08:05'); assert.equal(e.foodId, 'x');
  assert.throws(() => L.makeEntry(scoop, 0, 'lunch'));
  assert.throws(() => L.makeEntry(scoop, 5001, 'lunch'));
  assert.throws(() => L.makeEntry(scoop, 'abc', 'lunch'));
});

test('quickEntry validates kcal + protein', () => {
  assert.equal(L.quickEntry({ kcal: '', p: 10 }, 'lunch').ok, false);
  assert.equal(L.quickEntry({ kcal: 6000 }, 'lunch').errors.kcal, L.QUICK_MESSAGES.kcal);
  assert.equal(L.quickEntry({ kcal: 300, p: 600 }, 'lunch').ok, false);
  const ok = L.quickEntry({ kcal: '450', p: '30' }, 'dinner');
  assert.equal(ok.ok, true); assert.equal(ok.entry.kcal, 450); assert.equal(ok.entry.p, 30); assert.equal(ok.entry.src, 'quick');
});

test('rescaleEntry and repeatSection', () => {
  const r = L.rescaleEntry({ qty: 100, kcal: 165, p: 31, c: 0, f: 3.6 }, 250);
  assert.equal(r.entry.kcal, 412.5);
  assert.equal(L.rescaleEntry({ qty: 100, kcal: 1 }, 0).ok, false);
  const y = [{ id: 'a', section: 'dinner', name: 'x', kcal: 1 }, { id: 'b', section: 'lunch', name: 'y', kcal: 2 }];
  const rep = L.repeatSection(y, 'dinner');
  assert.equal(rep.length, 1); assert.notEqual(rep[0].id, 'a'); assert.equal(rep[0].section, 'dinner');
});

test('dayBalance: empty / open / closed (double rule) / over', () => {
  const t = { kcal: 2050, p: 160 };
  assert.equal(L.dayBalance({ kcal: 0, p: 0 }, t).state, 'empty');
  const open = L.dayBalance({ kcal: 1602, p: 124 }, t);
  assert.equal(open.state, 'open'); assert.match(open.message, /36 جم بروتين/);
  assert.equal(L.dayBalance({ kcal: 2031, p: 164 }, t).state, 'closed');
  assert.equal(L.dayBalance({ kcal: 2400, p: 170 }, t).state, 'over');
  assert.deepEqual(L.targetRange({ kcal: 2600, p: 160 }), { kcalMin: 2470, kcalMax: 2730, pMin: 155 });
});

test('barcode validation (GTIN check digit)', () => {
  assert.equal(L.validBarcode('5449000000996'), true);  // Coca-Cola EAN-13
  assert.equal(L.validBarcode('5449000000997'), false);
  assert.equal(L.validBarcode('96385074'), true);       // EAN-8
  assert.equal(L.validBarcode('12345'), false);
  assert.equal(L.validBarcode('abc'), false);
  assert.match(L.offUrl('5449000000996'), /api\/v2\/product\/5449000000996\?fields=/);
});

test('parseOFF: untrusted fields cleaned, kJ fallback, missing → null; dedupe by barcode', () => {
  const f = L.parseOFF({ status: 1, product: { product_name: '<img src=x onerror=alert(1)>Cola', brands: 'Coca-Cola,X', nutriments: { energy_100g: 180, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 'x' } } }, '5449000000996');
  assert.ok(!/[<>]/.test(f.name)); assert.equal(f.kcal, 43); assert.equal(f.f, 0); assert.equal(f.brand, 'Coca-Cola'); assert.equal(f.per, 100);
  assert.equal(L.parseOFF({ status: 0 }, '1'), null);
  assert.equal(L.parseOFF({ status: 1, product: { product_name: 'x', nutriments: {} } }, '1'), null);
  assert.equal(L.parseOFF({ status: 1, product: { product_name: 'x', nutriments: { 'energy-kcal_100g': 99999 } } }, '1'), null);
  assert.equal(L.findByBarcode([{ id: 'a', barcode: '5449000000996' }], '5449000000996').id, 'a');
});

test('saved meals: create, list (legacy shapes), log', () => {
  assert.equal(L.mealFromEntries('', [{}]).ok, false);
  const m = L.mealFromEntries('فطاري المعتاد', [{ foodId: 'd:f1', name: 'بيض', qty: 200, unit: 'جرام', kcal: 300, p: 25, c: 2, f: 20, id: 'z', time: '08:00' }], 'breakfast');
  assert.equal(m.ok, true); assert.equal(m.meal.items[0].id, undefined);
  const list = L.listMeals({ [m.meal.id]: m.meal, old: { name: 'قديمة', foods: [{ name: 'رز', qty: 100, cal: 130, pro: 3, carb: 28, fat: 0 }] } });
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.name === 'قديمة').totals.kcal, 130);
  const es = L.entriesFromMeal(list[0], 'lunch');
  assert.equal(es[0].section, 'lunch'); assert.equal(es[0].src, 'meal');
});

test('coach reply split: visible text + validated items; junk JSON ignored', () => {
  const r = L.splitCoachReply('تمام، هسجّل:\n{"items":[{"name":"صدر فراخ","grams":150,"kcal":250,"p":46,"c":0,"f":5},{"name":"","grams":1}]}');
  assert.equal(r.text, 'تمام، هسجّل:'); assert.equal(r.items.length, 1); assert.equal(r.items[0].grams, 150);
  assert.equal(L.splitCoachReply('رد عادي').items, null);
  assert.equal(L.splitCoachReply('x {"items": [ broken').items, null);
  assert.equal(L.splitCoachReply('{"items":[{"name":"x","grams":9000}]}').items, null);
});

test('entryFromAIItem prefers a confident DB match', () => {
  const cat = L.buildCatalog(FOODS, []);
  const e = L.entryFromAIItem({ name: 'صدور فراخ مشوية', grams: 200, kcal: 999, p: 1, c: 1, f: 1 }, 'lunch', cat);
  assert.equal(e.matched, true); assert.equal(e.kcal, 330);
  const u = L.entryFromAIItem({ name: 'طبق غريب جدا', grams: 300, kcal: 500, p: 20, c: 50, f: 20 }, 'lunch', cat);
  assert.equal(u.matched, false); assert.equal(u.kcal, 500);
});

test('stepFor', () => {
  assert.equal(L.stepFor('جرام', 100), 10);
  assert.equal(L.stepFor('جرام', 250), 25);
  assert.equal(L.stepFor('حبة', 2), 1);
});
