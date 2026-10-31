import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widgetPayload } from '../src/app/widgets-data.js';

const target = { kcal: 2850, p: 160, c: 330, f: 80 };
const eaten = { kcal: 1200.4, p: 70.6, c: 100, f: 30 };

test('widgets: training day', () => {
  const w = widgetPayload({ day: '2026-11-01', plan: { kind: 'training', name: 'Upper A', exercises: 9, minutes: 60 }, target, eaten, now: 1 });
  assert.equal(w.workout.kind, 'training');
  assert.equal(w.workout.title, 'Upper A');
  assert.equal(w.workout.sub, '9 تمارين · 60 د');
  assert.equal(w.workout.link, '#/workout');
  assert.deepEqual(w.food, { kcal: 1200, kcalGoal: 2850, p: 71, pGoal: 160, c: 100, cGoal: 330, f: 30, fGoal: 80 });
});

test('widgets: boxing, done, rest', () => {
  assert.equal(widgetPayload({ day: 'd', plan: { kind: 'heart', cardio: 'boxing' }, target, eaten }).workout.kind, 'boxing');
  assert.equal(widgetPayload({ day: 'd', plan: { kind: 'done', name: 'Lower A' }, target, eaten }).workout.kind, 'done');
  assert.equal(widgetPayload({ day: 'd', plan: null, target, eaten }).workout.kind, 'rest');
});
