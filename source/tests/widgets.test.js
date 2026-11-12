import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widgetPayload, quickItems, planQueue } from '../src/app/widgets-data.js';

const target = { kcal: 2850, p: 160, c: 330, f: 80 };
const eaten = { kcal: 1200.4, p: 70.6, c: 100, f: 30 };

test('widgets: training day', () => {
  const w = widgetPayload({ day: '2026-11-01', plan: { kind: 'training', name: 'Upper A', exercises: 9, minutes: 60 }, target, eaten, now: 1 });
  assert.equal(w.workout.kind, 'training');
  assert.equal(w.workout.title, 'Upper A');
  assert.equal(w.workout.sub, '9 تمارين · 60 د');
  assert.equal(w.workout.link, '#/workout');
  assert.deepEqual(w.food, { kcal: 1200, kcalGoal: 2850, p: 71, pGoal: 160, c: 100, cGoal: 330, f: 30, fGoal: 80 });
  assert.deepEqual(w.water, { ml: 0, goal: 0 });
  assert.deepEqual(w.quick, []);
});

test('widgets: boxing, done, rest', () => {
  assert.equal(widgetPayload({ day: 'd', plan: { kind: 'heart', cardio: 'boxing' }, target, eaten }).workout.kind, 'boxing');
  assert.equal(widgetPayload({ day: 'd', plan: { kind: 'done', name: 'Lower A' }, target, eaten }).workout.kind, 'done');
  assert.equal(widgetPayload({ day: 'd', plan: null, target, eaten }).workout.kind, 'rest');
});

test('widgets: quick items = water + 2 newest saved meals', () => {
  const q = quickItems([{ id: 'a', name: 'فطار', totals: { kcal: 520.4, p: 38, c: 50, f: 14 } }, { id: 'b', name: 'سكوب', totals: { kcal: 120, p: 24, c: 3, f: 1 } }, { id: 'c', name: 'x', totals: { kcal: 1, p: 1, c: 1, f: 1 } }]);
  assert.deepEqual(q.map((x) => x.id), ['water', 'm:a', 'm:b']);
  assert.equal(q[1].kcal, 520);
  assert.deepEqual(quickItems([]).map((x) => x.id), ['water']);
});

test('widgets: queue → water per day + meals, bad items skipped', () => {
  const d1 = new Date(2026, 10, 2, 8, 30).getTime(), d2 = new Date(2026, 10, 2, 23, 10).getTime(), d3 = new Date(2026, 10, 3, 0, 5).getTime();
  const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const r = planQueue([{ id: 'water', at: d1 }, { id: 'water', at: d2 }, { id: 'water', at: d3 }, { id: 'm:a', at: d1 }, { id: 'zzz', at: d1 }, { id: 'water', at: 'x' }, { id: 'water', at: Date.now() + 3600e3 }], dayOf);
  assert.deepEqual(r.water, { '2026-11-02': 500, '2026-11-03': 250 });
  assert.deepEqual(r.meals, [{ day: '2026-11-02', hour: 8, mealId: 'a', at: d1 }]);
  assert.equal(r.skipped, 3); // unknown id, bad time, a time in the future
});
