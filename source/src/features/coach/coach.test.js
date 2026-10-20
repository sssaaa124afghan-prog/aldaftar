import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActions, parseLogCommand, validateAction } from './actions.js';
import { buildContext, sanitizeAttach } from './context.js';
import { detectIntent, QUICK, INTENTS, modelFor } from './prompts.js';
import { addDays } from '../../core/date.js';

test('parseActions: every action type validated, text cleaned', () => {
  const raw = 'تمام، ده اقتراحي.\n[[ACTION:{"type":"log","section":"lunch","items":[{"name":"صدر فراخ","grams":150,"kcal":248,"p":46,"c":0,"f":5}]}]]\n'
    + '[[ACTION:{"type":"adddb","food":{"name":"شوفان بالموز","per":100,"kcal":180,"p":6,"c":32,"f":3}}]]\n'
    + '[[ACTION:{"type":"goal","dayType":"training","kcal":2500,"p":170}]]\n'
    + '[[ACTION:{"type":"delete","entryId":"e:abc"}]]\n[[ACTION:{"type":"water","ml":500}]]\n[[ACTION:{"type":"hack"}]] [[ACTION:{bad json]]';
  const r = parseActions(raw);
  assert.equal(r.text, 'تمام، ده اقتراحي.');
  assert.deepEqual(r.actions.map((a) => a.type), ['log', 'adddb', 'goal', 'delete', 'water']);
  assert.equal(r.actions[0].section, 'lunch');
  assert.deepEqual(r.actions[2].values, { kcal: 2500, p: 170 });
});

test('validateAction rejects out-of-range values and HTML in names', () => {
  assert.equal(validateAction({ type: 'water', ml: 99999 }), null);
  assert.equal(validateAction({ type: 'goal', dayType: 'x', kcal: 2000 }), null);
  assert.equal(validateAction({ type: 'log', items: [{ name: 'x', grams: 0 }] }), null);
  const a = validateAction({ type: 'log', items: [{ name: '<img src=x onerror=alert(1)>', grams: 10 }] });
  assert.ok(!/[<>]/.test(a.items[0].name));
});

test('legacy {"items":…} reply still becomes a log proposal', () => {
  const r = parseActions('سجلتلك.\n{"items":[{"name":"رز","grams":200,"kcal":260,"p":5,"c":56,"f":1}]}');
  assert.equal(r.actions[0].type, 'log');
  assert.equal(r.actions[0].items[0].grams, 200);
});

test('local fast path parses Egyptian log commands without an API call', () => {
  assert.deepEqual(parseLogCommand('ضيف 150 جرام صدر فراخ'), { grams: 150, query: 'صدر فراخ', section: null });
  assert.deepEqual(parseLogCommand('سجل ١٢٠ جم رز للغدا'), { grams: 120, query: 'رز', section: 'lunch' });
  assert.deepEqual(parseLogCommand('أكلت ميتين جرام فول في الفطار'), { grams: 200, query: 'فول', section: 'breakfast' });
  assert.equal(parseLogCommand('إيه رأيك في البنش؟'), null);
});

test('intent detection + all 10 old quick prompts present', () => {
  assert.equal(detectIntent('فاضل كام بروتين؟'), 'nutrition');
  assert.equal(detectIntent('البنش واقف عندي'), 'training');
  assert.equal(QUICK.training.length + QUICK.nutrition.length, 10);
  assert.ok(modelFor('advice').includes('haiku'));
  assert.ok(modelFor('chat').includes('sonnet'));
  assert.ok(Object.values(INTENTS).every((i) => Array.isArray(i.blocks)));
});

const today = '2026-10-19';
const ses = (d, w) => ({ id: `s${d}`, day: d, status: 'done', dayKey: 'upperA', dayName: 'Upper A', durationMin: 55,
  exercises: [{ lib: 'ex1', name: 'بنش بريس بالبار', muscle: 'صدر', sets: [{ w, r: 5, rir: 2, done: true }, { w, r: 5, rir: 1, done: true }] }] });
const data = {
  today, startDow: 1, trainingDays: [1, 2, 4, 5],
  profile: { age: 27, sex: 'male', heightCm: 178, name: 'SECRETNAME' },
  weights: Array.from({ length: 20 }, (_, i) => ({ day: addDays(today, -19 + i), kg: 80 - i * 0.05 })),
  sessions: Array.from({ length: 10 }, (_, i) => ses(addDays(today, -27 + i * 3), 90 + i)),
  foodLog: { [today]: [{ id: 'e:1', name: 'فول', qty: 200, unit: 'جم', kcal: 300, p: 20, c: 40, f: 8, section: 'breakfast', time: '09:00' }] },
  daily: { [today]: { day: today, wellness: { sleepH: 7, energy: 4, stress: 2, soreness: 2, score: 78 } } },
  training: { injuries: [{ muscle: 'كتف', severity: 2 }] }, progress: { goals: [{ name: 'بنش', lib: 'ex1', target: 120 }] }, nutrition: { dietMode: 'recomp' },
};

test('rich context contains the training and nutrition blocks and no identifiers', () => {
  const t = buildContext(data);
  for (const h of ['Body:', 'Today 2026-10-19', 'Readiness today: 78/100', 'Training last 4 weeks: 10 sessions', 'Strength (top lifts)', 'Hard sets per muscle', 'Active injuries: كتف', 'Strength goals', 'Nutrition last 7 days', 'diet mode recomp', 'Today entries: [e:1]']) assert.ok(t.includes(h), h);
  assert.ok(!t.includes('SECRETNAME'));
  const n = buildContext(data, { blocks: ['today'] });
  assert.ok(!n.includes('Training last'));
});

test('attachments are sanitised (no secrets / identifiers)', () => {
  const a = sanitizeAttach({ name: 'Test User', apiKey: 'x', liveSession: { exercises: [{ name: 'بنش', sets: [{ w: 100, r: 5 }] }] }, note: 'sk-ant-api03-ABCDEFGHIJK' });
  assert.equal(a.name, undefined); assert.equal(a.apiKey, undefined);
  assert.equal(a.liveSession.exercises[0].name, 'بنش');
  assert.match(a.note, /redacted/);
});
