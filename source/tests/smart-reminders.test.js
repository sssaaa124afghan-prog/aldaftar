import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartPlan, smartSettings, atMs, SMART_IDS } from '../src/app/smart-reminders-plan.js';

const day = '2026-11-12', nextDay = '2026-11-13';
const noon = atMs(day, '12:00');
const ids = (r) => r.schedule.map((x) => x.id).sort();

test('protein short + training not done → both today, plus tomorrow', () => {
  const r = smartPlan({ now: noon, day, nextDay, target: { p: 160 }, eaten: { p: 110, n: 3 }, plan: { kind: 'training', name: 'Upper A', exercises: 9, minutes: 60 }, nextPlan: { kind: 'heart', cardio: 'boxing' } });
  assert.deepEqual(ids(r), ['fc-smart-protein', 'fc-smart-protein-next', 'fc-smart-train', 'fc-smart-train-next']);
  const p = r.schedule.find((x) => x.id === 'fc-smart-protein');
  assert.match(p.title, /50 جم بروتين/);
  assert.equal(p.at, atMs(day, '21:00'));
  assert.equal(p.route, '#/nutrition/add');
  assert.match(r.schedule.find((x) => x.id === 'fc-smart-train').title, /Upper A/);
  assert.match(r.schedule.find((x) => x.id === 'fc-smart-train-next').title, /الملاكمة/);
});

test('protein met + session done → today cancelled', () => {
  const r = smartPlan({ now: noon, day, nextDay, target: { p: 160 }, eaten: { p: 150, n: 4 }, plan: { kind: 'done', name: 'Upper A' }, nextPlan: null });
  assert.ok(r.cancel.includes('fc-smart-protein'));
  assert.ok(r.cancel.includes('fc-smart-train'));
  assert.ok(r.cancel.includes('fc-smart-train-next'));
  assert.deepEqual(ids(r), ['fc-smart-protein-next']);
});

test('nothing logged → «مفيش أكل» text; after the time → not scheduled', () => {
  const r = smartPlan({ now: noon, day, nextDay, target: { p: 160 }, eaten: { p: 0, n: 0 }, plan: null });
  assert.match(r.schedule.find((x) => x.id === 'fc-smart-protein').title, /مفيش أكل/);
  const late = smartPlan({ now: atMs(day, '22:00'), day, nextDay, target: { p: 160 }, eaten: { p: 0, n: 0 }, plan: { kind: 'training', name: 'X' } });
  assert.ok(late.cancel.includes('fc-smart-protein') && late.cancel.includes('fc-smart-train'));
});

test('off → everything cancelled; settings validation', () => {
  const r = smartPlan({ now: noon, day, nextDay, settings: { on: false }, target: { p: 160 }, eaten: { p: 0, n: 0 } });
  assert.deepEqual(r.schedule, []);
  assert.deepEqual([...r.cancel].sort(), [...SMART_IDS].sort());
  assert.deepEqual(smartSettings({ proteinAt: '25:00', trainAt: '18:15' }), { on: true, proteinAt: '21:00', trainAt: '18:15', proteinGap: 25 });
});
