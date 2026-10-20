import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActions, parseLogCommand, validateAction, jsonEnd } from './actions.js';
import * as WK from '../workout/logic.js';
import { ACTION_PROTOCOL } from './prompts.js';
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
  assert.equal(QUICK.training.length + QUICK.nutrition.length, 14);
  for (const l of ['جهّزلي أوزان الحصة الجاية', 'عدّل خطتي حسب أدائي', 'عضلة متأخرة؟ زوّدها', 'أعمل ديلود؟']) assert.ok(QUICK.training.some((q) => q.label === l && INTENTS[q.intent].writes), l);
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

test('workout action schemas: valid ones normalised, invalid ones rejected', () => {
  assert.deepEqual(validateAction({ type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'exFDP', reason: 'الكتف' }),
    { type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'exFDP', reason: 'الكتف' });
  assert.equal(validateAction({ type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'uaID' }), null);
  assert.equal(validateAction({ type: 'workout.swap', day: 'upperA', fromExId: '<x>', toExId: 'ex2' }), null);
  assert.deepEqual(validateAction({ type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: '5', reps: '٦–١٠' }), { type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 5, reps: '6-10' });
  assert.equal(validateAction({ type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 11 }), null);
  assert.equal(validateAction({ type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 3, reps: '2-5' }), null, 'reps below 3');
  assert.equal(validateAction({ type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 3, reps: '20-35' }), null, 'reps above 30');
  assert.equal(validateAction({ type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 2.5 }), null);
  assert.ok(validateAction({ type: 'workout.addExercise', day: 'upperB', exId: 'ex30', sets: 2, reps: '10-15', pairWith: 'ub6b' }));
  assert.equal(validateAction({ type: 'workout.addExercise', day: 'upperB', exId: 'ex30', sets: 2 }), null, 'reps required');
  assert.ok(validateAction({ type: 'workout.removeExercise', day: 'lowerB', exId: 'lbSH' }));
  const pf = validateAction({ type: 'workout.prefill', day: 'lowerA', items: [{ exId: 'la1', sets: [{ w: '100', r: 6 }], note: '<b>x</b>' }] });
  assert.deepEqual(pf.items[0].sets, [{ w: 100, r: 6 }]); assert.ok(!/[<>]/.test(pf.items[0].note));
  assert.equal(validateAction({ type: 'workout.prefill', day: 'lowerA', items: [{ exId: 'la1', sets: [{ w: 900, r: 6 }] }] }), null);
  assert.equal(validateAction({ type: 'workout.prefill', day: 'lowerA', items: [] }), null);
  assert.deepEqual(validateAction({ type: 'workout.deload', now: true }), { type: 'workout.deload', now: true });
  assert.deepEqual(validateAction({ type: 'workout.deload', startWeek: 2 }), { type: 'workout.deload', startWeek: 2 });
  assert.deepEqual(validateAction({ type: 'workout.deload', startWeek: 0 }), { type: 'workout.deload', now: true });
  assert.equal(validateAction({ type: 'workout.deload' }), null);
  assert.deepEqual(validateAction({ type: 'targets.set', dayType: 'heart', kcal: 2300, p: 160, c: 260, f: 68 }), { type: 'goal', dayType: 'heart', values: { kcal: 2300, p: 160, c: 260, f: 68 } });
  assert.equal(validateAction({ type: 'targets.set', dayType: 'cheat', kcal: 2300 }), null);
});

test('parser: [[ACTION]], fenced and unfenced JSON; unknown dropped, invalid reported in Arabic', () => {
  const nested = '[[ACTION:{"type":"workout.prefill","day":"lowerA","items":[{"exId":"la1","sets":[{"w":100,"r":6}]}]}]]';
  const r1 = parseActions(`جاهز.\n${nested}`);
  assert.equal(r1.text, 'جاهز.'); assert.equal(r1.actions[0].items[0].sets[0].w, 100);
  const fenced = 'شوف ده:\n```json\n{"type":"workout.swap","day":"upperA","fromExId":"uaID","toExId":"exFDP"}\n```\nوكمان:\n```\n[{"type":"workout.deload","now":true},{"type":"targets.set","dayType":"heart","kcal":2300,"p":160,"c":260,"f":68}]\n```';
  const r2 = parseActions(fenced);
  assert.deepEqual(r2.actions.map((a) => a.type), ['workout.swap', 'workout.deload', 'goal']);
  assert.ok(!/```|\{/.test(r2.text), r2.text);
  const bare = 'اقتراحي {"type":"workout.sets","day":"lowerA","exId":"la1","sets":5} و {"type":"workout.sets","day":"lowerA","exId":"la1","sets":50} و {"type":"evil","x":1}.';
  const r3 = parseActions(bare);
  assert.equal(r3.actions.length, 1); assert.equal(r3.actions[0].sets, 5);
  assert.equal(r3.errors.length, 1); assert.match(r3.errors[0], /تعديل المجموعات/);
  assert.ok(r3.text.includes('{"type":"evil"'), 'unknown JSON is left as text, never applied');
  const code = parseActions('مثال كود:\n```js\nconst x = {a:1}\n```');
  assert.equal(code.actions.length, 0); assert.ok(code.text.includes('const x'));
  assert.equal(jsonEnd('{"a":"}"}', 0), 9);
});

test('program block is in the context (compact) and the protocol lists every new action', () => {
  const program = WK.fromTemplate('ul4c', { startDay: '2026-10-05' });
  const t = buildContext({ ...data, program }, { blocks: ['program'] });
  assert.match(t, /- upperA «Upper A» ~48min lifting: uaFB\/ex1 بنش بريس بالبار 4×5-8 r110 ssA/);
  assert.match(t, /Planned weekly sets per muscle \[MEV-MRV\]: صدر 11 \[8-22\]/);
  assert.match(t, /Next session: /); assert.match(t, /Block: week 3 of 6/);
  assert.ok(t.length < 2600, `small: ${t.length}`);
  for (const k of ['workout.prefill', 'workout.swap', 'workout.sets', 'workout.addExercise', 'workout.removeExercise', 'workout.deload', 'training|rest|heart', 'MRV', '60 min', 'axially', 'blood-pressure']) assert.ok(ACTION_PROTOCOL.includes(k), k);
  assert.ok(buildContext({ ...data, program }).includes('Program ul4c'), 'chat context includes it');
});
