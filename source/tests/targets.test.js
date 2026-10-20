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
  assert.deepEqual(targetsForDay('2026-10-19'), { type: 'training', kcal: 2850, p: 155, c: 400, f: 70 });
  assert.deepEqual(targetsForDay('2026-10-21'), { type: 'rest', kcal: 2350, p: 155, c: 275, f: 70 });
});

test('defaults are internally consistent (kcal ≈ 4P+4C+9F)', () => {
  for (const t of Object.values(DEFAULT_TARGETS)) assert.equal(validateTargets(t).ok, true);
  assert.equal(kcalFromMacros(DEFAULT_TARGETS.training), 2850);
  for (const t of Object.values(DEFAULT_TARGETS)) assert.equal(kcalFromMacros(t), t.kcal, 'exact 4P+4C+9F');
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

test('heart day type (S2): program heartDow or a logged Heart Day session → 2550 kcal; training/rest unchanged', async () => {
  const { heartDowOf, heartDaysOf, withDayTypes } = await import('../src/core/targets.js');
  const sat = '2026-10-24', sun = '2026-10-25', mon = '2026-10-19';
  assert.deepEqual(targetsForDay(sat, { heartDow: 6 }), { type: 'heart', kcal: 2550, p: 155, c: 325, f: 70 });
  assert.equal(targetsForDay(sat).type, 'rest'); // no program heart day → rest
  assert.deepEqual(targetsForDay(mon, { heartDow: 6 }), { type: 'training', kcal: 2850, p: 155, c: 400, f: 70 });
  assert.deepEqual(targetsForDay('2026-10-21', { heartDow: 6 }), { type: 'rest', kcal: 2350, p: 155, c: 275, f: 70 });
  // a logged Heart Day on a rest day; the iso block alone does not count; a lifting session wins
  const hs = heartDaysOf([{ kind: 'heart', mode: 'heart', day: sun }, { kind: 'heart', mode: 'iso', day: '2026-10-21' }, { kind: 'heart', mode: 'heart', day: '2026-10-22', status: 'active' }]);
  assert.deepEqual([...hs], [sun]);
  assert.equal(dayType(sun, { heartDays: hs }), 'heart');
  assert.equal(dayType(sun, { heartDays: hs, sessionDays: new Set([sun]) }), 'training');
  assert.equal(dayType(sat, { heartDow: 6, overrides: { [sat]: 'rest' } }), 'rest');
  assert.equal(dayType('2026-10-21', { overrides: { '2026-10-21': 'heart' } }), 'heart');
  // stored targets from before S2 get the heart default; edited heart targets are used
  const old = { training: { kcal: 2700, p: 170, c: 340, f: 72 }, rest: { kcal: 2100, p: 170, c: 200, f: 66 } };
  assert.deepEqual(targetsForDay(sat, { targets: old, heartDow: 6 }).kcal, 2550);
  assert.deepEqual(withDayTypes(old).heart, { kcal: 2550, p: 155, c: 325, f: 70 });
  assert.equal(withDayTypes(null).isDefault, true);
  assert.equal(setTargets(withDayTypes(old), 'heart', { kcal: 2400, p: 165, c: 270, f: 70 }).targets.heart.kcal, 2400);
  assert.equal(kcalFromMacros(DEFAULT_TARGETS.heart), 2550);
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

test('72-kg defaults: training 2850 / heart 2550 / rest 2350, protein 155 (≈2.15 g/kg), fat 70, carbs fill', async () => {
  const { macrosFor, defaultTargetsFor } = await import('../src/core/targets.js');
  assert.deepEqual(DEFAULT_TARGETS.training, { kcal: 2850, p: 155, c: 400, f: 70 });
  assert.deepEqual(DEFAULT_TARGETS.heart, { kcal: 2550, p: 155, c: 325, f: 70 });
  assert.deepEqual(DEFAULT_TARGETS.rest, { kcal: 2350, p: 155, c: 275, f: 70 });
  assert.ok(Math.abs(155 / 72 - 2.15) < 0.01);
  const avg = (4 * 2850 + 2550 + 2 * 2350) / 7;
  assert.equal(Math.round(avg), 2664); // weekly average ≈ maintenance (TDEE 2,525–2,860, midpoint ~2,700)
  assert.deepEqual(macrosFor(2850, { p: 155, f: 70 }), { kcal: 2850, p: 155, c: 400, f: 70 });
  assert.deepEqual(defaultTargetsFor(72).training, DEFAULT_TARGETS.training);
  const t80 = defaultTargetsFor(80);
  assert.equal(t80.training.p, 170); assert.equal(t80.training.f, 80);
  for (const t of Object.values(t80)) assert.equal(kcalFromMacros(t), t.kcal);
});

test('migration: old defaults → new ones silently with a toast; custom targets kept + a suggestion; idempotent', async () => {
  const { migrateTargets, isLegacyDefault, runTargetsMigration, TARGETS_TOAST } = await import('../src/core/targets.js');
  const { LEGACY_DEFAULT_TARGETS } = await import('../src/core/schema.js');
  const old = { training: { ...LEGACY_DEFAULT_TARGETS.training }, rest: { ...LEGACY_DEFAULT_TARGETS.rest }, heart: { ...LEGACY_DEFAULT_TARGETS.heart }, isDefault: true };
  assert.equal(isLegacyDefault(old), true);
  assert.equal(isLegacyDefault({ training: old.training, rest: old.rest }), true, 'pre-heart record');
  assert.equal(isLegacyDefault(null), true);
  const m = migrateTargets(old);
  assert.equal(m.reason, 'defaults'); assert.equal(m.toast, TARGETS_TOAST); assert.equal(m.toast, 'اتحدّثت أهدافك حسب وزنك 72');
  assert.deepEqual(m.targets.training, DEFAULT_TARGETS.training); assert.equal(m.targets.tv, 2);
  assert.equal(migrateTargets(m.targets).changed, false);
  const custom = { training: { kcal: 2400, p: 170, c: 280, f: 65 }, rest: { kcal: 2000, p: 170, c: 180, f: 60 } };
  const c = migrateTargets(custom);
  assert.equal(c.reason, 'custom'); assert.deepEqual(c.targets.training, custom.training); assert.equal(c.toast, undefined);
  assert.ok(c.suggestion && c.suggestion.delta > 0, JSON.stringify(c.suggestion));
  assert.deepEqual(c.suggestion.targets.training, DEFAULT_TARGETS.training);
  // the db runner: writes targets + height 175 when missing, parks the custom suggestion
  const mem = new Map([['kv:targets', { key: 'targets', value: old }], ['profile:me', { key: 'me', age: 27 }]]);
  const db = { get: async (s, k) => mem.get(`${s}:${k}`) ?? null, put: async (s, v) => { mem.set(`${s}:${v.key}`, v); }, getAll: async () => [] };
  const r = await runTargetsMigration(db);
  assert.equal(r.changed, true); assert.equal(r.toast, TARGETS_TOAST);
  assert.equal(mem.get('kv:targets').value.training.kcal, 2850);
  assert.deepEqual(mem.get('profile:me'), { key: 'me', age: 27, heightCm: 175 });
  assert.equal((await runTargetsMigration(db)).changed, false);
  mem.set('kv:targets', { key: 'targets', value: custom }); mem.set('profile:me', { key: 'me', heightCm: 180 });
  const r2 = await runTargetsMigration(db);
  assert.equal(r2.reason, 'custom'); assert.equal(mem.get('kv:targets').value.training.kcal, 2400);
  assert.equal(mem.get('profile:me').heightCm, 180, 'an existing height is kept');
  assert.ok(mem.get('kv:nutrition').value.targetSuggestion.delta > 0);
});

test('gain engine: ±150 every 14 days vs the 7-day average, +0.25–0.5 kg/month, only after re-entry + regain', async () => {
  const { gainSuggestion, GAIN_STEP } = await import('../src/core/targets.js');
  const { addDays } = await import('../src/core/date.js');
  const series = (start, n, kg0, perDay) => Array.from({ length: n }, (_, i) => ({ day: addDays(start, i), kg: Math.round((kg0 + perDay * i) * 100) / 100 }));
  const today = '2026-12-31';
  // flat weight → below +0.25/month → +150
  const flat = series('2026-12-01', 31, 72, 0);
  const a = gainSuggestion(flat, [], { today });
  assert.equal(a.delta, GAIN_STEP); assert.equal(a.phase, 'gain'); assert.match(a.reason, /0.25/);
  // +0.4 kg/month → inside the band → nothing
  assert.equal(gainSuggestion(series('2026-12-01', 31, 72, 0.4 / 30), [], { today }), null);
  // +1 kg/month → −150
  assert.equal(gainSuggestion(series('2026-12-01', 31, 72, 1 / 30), [], { today }).delta, -GAIN_STEP);
  // not again within 14 days of the last applied change
  assert.equal(gainSuggestion(flat, [{ date: '2026-12-20', change: 150 }], { today }), null);
  assert.equal(gainSuggestion(flat, [{ date: '2026-12-17', change: 150 }], { today }).delta, GAIN_STEP);
  // regain runway (8 weeks from the re-entry start): a fast rise is fine, flat is fine, only a falling average gets +150
  const re = { today, reentryStart: '2026-11-20' };
  assert.equal(gainSuggestion(series('2026-12-01', 31, 72, 1 / 30), [], re), null);
  assert.equal(gainSuggestion(flat, [], re), null);
  const down = gainSuggestion(series('2026-12-01', 31, 73, -0.6 / 7), [], re);
  assert.equal(down.delta, GAIN_STEP); assert.equal(down.phase, 'regain');
  // too few weigh-ins → nothing; snoozed → nothing
  assert.equal(gainSuggestion(flat.slice(-3), [], { today }), null);
  assert.equal(gainSuggestion(flat, [], { today, snoozeUntil: '2027-01-02' }), null);
});
