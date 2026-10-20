import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayType, targetsForDay, validateTargets, setTargets, portion, validateQty, sumEntries, remaining, kcalFromMacros, QTY_MAX } from '../src/core/targets.js';
import { DEFAULT_TARGETS } from '../src/core/schema.js';

test('default schedule: Mon/Tue/Thu/Fri training', () => {
  // week of 2026-10-19 (Mon) .. 2026-10-25 (Sun)
  const types = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map((d) => dayType(d));
  assert.deepEqual(types, ['training', 'training', 'rest', 'training', 'training', 'rest', 'rest']);
});

test('override beats schedule; a logged session flips a rest day to training', () => {
  assert.equal(dayType('2026-10-19', { overrides: { '2026-10-19': 'rest' } }), 'rest');
  assert.equal(dayType('2026-10-21', { sessionDays: new Set(['2026-10-21']) }), 'training');
  assert.equal(dayType('2026-10-21', { sessionDays: ['2026-10-21'], overrides: { '2026-10-21': 'rest' } }), 'rest');
  assert.equal(dayType('2026-10-25', { trainingDays: [0] }), 'training');
  assert.throws(() => dayType('bad'), RangeError);
});

test('defaults per day type', () => {
  assert.deepEqual(targetsForDay('2026-10-19'), { type: 'training', kcal: 2600, p: 160, c: 330, f: 70 });
  assert.deepEqual(targetsForDay('2026-10-21'), { type: 'rest', kcal: 2050, p: 160, c: 200, f: 65 });
});

test('defaults are internally consistent (kcal ≈ 4P+4C+9F)', () => {
  for (const t of Object.values(DEFAULT_TARGETS)) assert.equal(validateTargets(t).ok, true);
  assert.equal(kcalFromMacros(DEFAULT_TARGETS.training), 2590);
});

test('mismatch is reported, not silently fixed', () => {
  const t = { kcal: 2000, p: 160, c: 330, f: 70 }; // macros = 2590
  const v = validateTargets(t);
  assert.equal(v.ok, false);
  assert.equal(v.issues[0].code, 'kcal_mismatch');
  assert.equal(v.diff, -590);
  const r = setTargets(DEFAULT_TARGETS, 'training', t);
  assert.equal(r.saved, true);
  assert.equal(r.targets.training.kcal, 2000); // exactly what the user typed
  assert.equal(r.targets.isDefault, false);
  assert.match(r.validation.issues[0].message, /[؀-ۿ]/);
});

test('non-numbers / out of range are rejected and targets stay unchanged', () => {
  const r = setTargets(DEFAULT_TARGETS, 'rest', { kcal: 'abc', p: 160, c: 200, f: 65 });
  assert.equal(r.saved, false);
  assert.equal(r.targets, DEFAULT_TARGETS);
  assert.equal(validateTargets({ kcal: 100, p: 0, c: 0, f: 0 }).issues[0].code, 'out_of_range');
  assert.throws(() => setTargets(DEFAULT_TARGETS, 'cheat', {}), RangeError);
});

test('portion uses the food `per` base (legacy bug: qty/100 ignored per)', () => {
  const chicken = { kcal: 165, p: 31, c: 0, f: 3.6, per: 100 };
  assert.deepEqual(portion(chicken, 200), { kcal: 330, p: 62, c: 0, f: 7.2 });
  const whey = { kcal: 120, p: 24, c: 3, f: 1.5, per: 1 }; // per 1 scoop
  assert.deepEqual(portion(whey, 1), { kcal: 120, p: 24, c: 3, f: 1.5 }); // legacy gave 1.2 kcal
  const egg = { kcal: 70, p: 6, c: 0.5, f: 5, per: 1 };
  assert.deepEqual(portion(egg, 4), { kcal: 280, p: 24, c: 2, f: 20 });
  const oats30 = { kcal: 114, p: 3.9, c: 19.8, f: 2.1, per: 30 };
  assert.deepEqual(portion(oats30, 60), { kcal: 228, p: 7.8, c: 39.6, f: 4.2 });
  assert.deepEqual(portion({ cal: 130, pro: 2.7, carb: 28, fat: 0.3, per: 100 }, 150), { kcal: 195, p: 4.1, c: 42, f: 0.5 }); // legacy field names
  assert.deepEqual(portion({ kcal: 50, p: 1, c: 1, f: 1 }, 50), { kcal: 25, p: 0.5, c: 0.5, f: 0.5 }); // missing per → 100
});

test('qty ≤ 0, > 5000 or not a number is rejected', () => {
  const food = { kcal: 100, p: 1, c: 1, f: 1, per: 100 };
  for (const q of [0, -5, 5000.1, 99999, NaN, Infinity, 'abc', null, undefined]) {
    assert.throws(() => portion(food, q), (e) => e.name === 'ValidationError', String(q));
    assert.equal(validateQty(q).ok, false);
  }
  assert.equal(validateQty(QTY_MAX).ok, true);
  assert.equal(validateQty('150,5').qty, 150.5);
  assert.deepEqual(portion(food, '250'), { kcal: 250, p: 2.5, c: 2.5, f: 2.5 });
});

test('sum and remaining', () => {
  const t = sumEntries([{ kcal: 280, p: 24, c: 2, f: 20 }, { kcal: 228, p: 7.8, c: 39.6, f: 4.2 }, { kcal: 'x' }]);
  assert.deepEqual(t, { kcal: 508, p: 31.8, c: 41.6, f: 24.2 });
  assert.deepEqual(remaining({ kcal: 2050, p: 160, c: 200, f: 65 }, t), { kcal: 1542, p: 128.2, c: 158.4, f: 40.8 });
});

test('heart day type (S2): program heartDow or a logged Heart Day session → 2300 kcal; training/rest unchanged', async () => {
  const { heartDowOf, heartDaysOf, withDayTypes } = await import('../src/core/targets.js');
  const sat = '2026-10-24', sun = '2026-10-25', mon = '2026-10-19';
  assert.deepEqual(targetsForDay(sat, { heartDow: 6 }), { type: 'heart', kcal: 2300, p: 160, c: 260, f: 68 });
  assert.equal(targetsForDay(sat).type, 'rest'); // no program heart day → rest
  assert.deepEqual(targetsForDay(mon, { heartDow: 6 }), { type: 'training', kcal: 2600, p: 160, c: 330, f: 70 });
  assert.deepEqual(targetsForDay('2026-10-21', { heartDow: 6 }), { type: 'rest', kcal: 2050, p: 160, c: 200, f: 65 });
  // a logged Heart Day on a rest day; the iso block alone does not count; a lifting session wins
  const hs = heartDaysOf([{ kind: 'heart', mode: 'heart', day: sun }, { kind: 'heart', mode: 'iso', day: '2026-10-21' }, { kind: 'heart', mode: 'heart', day: '2026-10-22', status: 'active' }]);
  assert.deepEqual([...hs], [sun]);
  assert.equal(dayType(sun, { heartDays: hs }), 'heart');
  assert.equal(dayType(sun, { heartDays: hs, sessionDays: new Set([sun]) }), 'training');
  assert.equal(dayType(sat, { heartDow: 6, overrides: { [sat]: 'rest' } }), 'rest');
  assert.equal(dayType('2026-10-21', { overrides: { '2026-10-21': 'heart' } }), 'heart');
  // stored targets from before S2 get the heart default; edited heart targets are used
  const old = { training: { kcal: 2700, p: 170, c: 340, f: 72 }, rest: { kcal: 2100, p: 170, c: 200, f: 66 } };
  assert.deepEqual(targetsForDay(sat, { targets: old, heartDow: 6 }).kcal, 2300);
  assert.deepEqual(withDayTypes(old).heart, { kcal: 2300, p: 160, c: 260, f: 68 });
  assert.equal(withDayTypes(null).isDefault, true);
  assert.equal(setTargets(withDayTypes(old), 'heart', { kcal: 2400, p: 165, c: 270, f: 70 }).targets.heart.kcal, 2400);
  assert.equal(kcalFromMacros(DEFAULT_TARGETS.heart), 2292);
  // heartDowOf mirrors the workout normalizeProgram(): none stored → default plan (Saturday); old plan / custom / Solo Gym → none
  assert.equal(heartDowOf(null), 6);
  assert.equal(heartDowOf({ v: 2, activeProgram: 'ul4c', order: ['upperA'], days: { upperA: {} } }), 6);
  assert.equal(heartDowOf({ v: 2, activeProgram: 'ul4', order: ['a'], days: { a: {} } }), null);
  assert.equal(heartDowOf({ v: 2, activeProgram: 'custom', order: ['a'], days: { a: {} } }), null);
  assert.equal(heartDowOf({ days: { d1: { exercises: [{ name: 'Bench' }] } } }), null);
});

test('heartDowOf agrees with workout programFlags(normalizeProgram(rec)).heartDow', async () => {
  const { heartDowOf } = await import('../src/core/targets.js');
  const W = await import('../src/features/workout/logic.js');
  const recs = [null, {}, { v: 2 }, W.fromTemplate('ul4c'), W.fromTemplate('ul4'), { ...W.fromTemplate('ul4c'), activeProgram: 'custom' },
    { days: { d1: { exercises: [{ name: 'Bench Press', sets: 3 }] } } }, { days: { d1: { exercises: [] } } }];
  for (const r of recs) assert.equal(heartDowOf(r), W.programFlags(W.normalizeProgram(r)).heartDow, JSON.stringify(r)?.slice(0, 60));
});
