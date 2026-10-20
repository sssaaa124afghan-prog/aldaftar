import test from 'node:test';
import assert from 'node:assert/strict';
import { quickMeal, usualCombo, entriesForLog, mealLine, SEED_BREAKFAST, weightDue, bpDue, kegelDue } from './logic.js';
import { FOODS } from '../nutrition/foods.js';
import { sumEntries } from '../../core/targets.js';

const E = (foodId, name, qty, section, kcal = 100, p = 10) => ({ id: `e:${Math.random()}`, foodId, name, qty, unit: 'جرام', kcal, p, c: 0, f: 0, section });
const egg = (n = 4) => E('d:f9', 'بيضة كاملة', n, 'breakfast', 72 * n, 6.3 * n);
const oats = E('d:f19', 'شوفان جاف', 60, 'breakfast', 233, 10);
const foul = E('d:f60', 'فول مدمس', 200, 'breakfast', 220, 15);

test('seed breakfast ids and values match foods.js; ≈ 790 kcal, ≈ 60 g protein', () => {
  for (const s of SEED_BREAKFAST) {
    const f = FOODS.find((x) => x.id === s.foodId);
    assert.ok(f, s.foodId); assert.equal(f.name, s.name); assert.equal(f.kcal, s.kcal); assert.equal(f.per, s.per);
  }
  const m = quickMeal({ hour: 7 });
  assert.equal(m.section, 'breakfast'); assert.equal(m.source, 'seed');
  assert.ok(m.kcal > 750 && m.kcal < 820, String(m.kcal)); assert.ok(m.p >= 55);
});

test('usual breakfast is learned from the most frequent combo (order-free), latest day wins ties', () => {
  const days = [
    { day: '2026-10-15', entries: [egg(), oats] },
    { day: '2026-10-16', entries: [oats, egg(3)] },
    { day: '2026-10-17', entries: [foul] },
    { day: '2026-10-18', entries: [egg(), { ...oats, qty: 70 }, E('x', 'غدا', 1, 'lunch')] },
  ];
  const c = usualCombo(days, 'breakfast');
  assert.equal(c.count, 3); assert.equal(c.day, '2026-10-18');
  const m = quickMeal({ hour: 7, days });
  assert.equal(m.source, 'history'); assert.equal(m.entries.length, 2);
  assert.equal(m.entries.find((e) => e.foodId === 'd:f19').qty, 70, 'portions from the latest day');
  // a saved «فطار» meal beats a combo seen once
  const once = [{ day: '2026-10-18', entries: [foul] }];
  const saved = [{ name: 'فطار ثابت', items: [egg(), oats] }];
  assert.equal(quickMeal({ hour: 8, days: once, savedMeals: saved }).source, 'saved');
  assert.equal(quickMeal({ hour: 8, days: once }).source, 'last');
});

test('quickMeal by time of day: hidden once logged; lunch = «زي امبارح»; none for snacks', () => {
  assert.equal(quickMeal({ hour: 7, todayEntries: [egg()] }), null);
  const y = { entries: [E('r', 'رز', 250, 'lunch', 325, 7), E('c', 'فراخ', 200, 'lunch', 330, 62)] };
  const l = quickMeal({ hour: 13, yesterday: y });
  assert.equal(l.section, 'lunch'); assert.equal(l.kind, 'yesterday'); assert.equal(l.kcal, 655);
  assert.equal(quickMeal({ hour: 13 }), null, 'no lunch yesterday → no card');
  assert.equal(quickMeal({ hour: 13, yesterday: y, todayEntries: [E('r', 'رز', 1, 'lunch')] }), null);
  assert.equal(quickMeal({ hour: 22, yesterday: y }), null);
});

test('entriesForLog: fresh ids, the meal section, the current time; totals preserved', () => {
  const m = quickMeal({ hour: 7 });
  const now = new Date(2026, 9, 20, 7, 15);
  const es = entriesForLog(m, now);
  assert.equal(es.length, 4);
  assert.ok(es.every((e) => /^e:/.test(e.id) && e.section === 'breakfast' && e.time === '07:15'));
  assert.equal(new Set(es.map((e) => e.id)).size, 4);
  assert.equal(Math.round(sumEntries(es).kcal), m.kcal);
  assert.match(mealLine(es), /^4 بيضة كاملة · حليب كامل الدسم 250 مل · شوفان جاف 60 جم · 1 واي بروتين سكوب$/);
});

test('due cards: weight before noon until logged; BP during the baseline (2 a day); pelvic floor 2× a day', () => {
  assert.equal(weightDue({ hour: 7, weighed: false }), true);
  assert.equal(weightDue({ hour: 7, weighed: true }), false);
  assert.equal(weightDue({ hour: 13, weighed: false }), false);
  const day = '2026-10-20';
  assert.deepEqual(bpDue({ gateState: 'baseline', bp: [], day }), { need: 2, today: 0 });
  assert.deepEqual(bpDue({ gateState: 'baseline', bp: [{ day }], day }), { need: 2, today: 1 });
  assert.equal(bpDue({ gateState: 'baseline', bp: [{ day }, { day }], day }), null);
  assert.equal(bpDue({ gateState: 'ok', bp: [], day }), null);
  assert.deepEqual(kegelDue({ kegel: {}, day }), { done: 0, perDay: 2 });
  assert.deepEqual(kegelDue({ kegel: { log: [{ day }] }, day }), { done: 1, perDay: 2 });
  assert.equal(kegelDue({ kegel: { log: [{ day }, { day }] }, day }), null);
  assert.equal(kegelDue({ kegel: { log: [{ day }] }, day, week: 14 }), null);
});
