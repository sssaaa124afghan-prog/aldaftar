// «استورد أوزانك القديمة» parser — synthetic fixtures only (no real backup values).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as O from './oldweights.js';
import * as L from './logic.js';
import { needsCalibration } from './entry-assist.js';
import { PROGRAMS } from './exercises.js';

const FAKE_KEY = 'sk-ant-test-0000-synthetic';
let n = 0;
/** One old session: day 'YYYY-MM-DD', dk, {name: [unit, [[w, r, done?], …]]} */
const oses = (day, dk, exs) => ({ id: `s${++n}`, date: `${day}T15:00:00.000Z`, dk, dn: dk, exs: Object.fromEntries(Object.entries(exs).map(([name, [unit, sets]], i) =>
  [`e${i}`, { id: `e${i}`, name, unit, sets: sets.map(([w, r, done = true]) => ({ w, r, rpe: 7, done })) }])) });
const backup = (ses, extra = {}) => JSON.stringify({ claudeKey: FAKE_KEY, aiKey: 'gsk_synthetic', chatHistory: [{ t: 'secret chat' }], xp: 9, ses,
  days: { upperA: { name: 'Upper A', exercises: [{ id: 'w', name: 'إحماء', isWarmup: true }, { id: 'uaFB', name: 'Flat Barbell Bench Press · بار', unit: 'كجم إجمالي', lastW: 60 }] },
    lowerB: { name: 'Lower B', exercises: [{ id: 'la2', name: 'Romanian Deadlift · بار', unit: 'كجم إجمالي', lastW: 90 }, { id: 'lbHACK', name: 'Hack Squat', unit: 'كجم', lastW: 70 }] } },
  bw: [], profile: { name: 'x', weight: 80 }, ...extra });
const model = (ses, extra, today = '2026-10-20') => O.buildImport(O.pickSafe(backup(ses, extra)).data, { today });
const row = (m, dayId, lib) => m.rows.find((r) => r.dayId === dayId && r.lib === lib);

test('pickSafe keeps only ses / days / bw / profile weight — keys and chats never come back', () => {
  const r = O.pickSafe(backup([oses('2026-07-01', 'upperA', { 'Flat Barbell Bench Press': ['كجم إجمالي', [[80, 8]]] })]));
  assert.equal(r.ok, true);
  const txt = JSON.stringify(r);
  for (const bad of [FAKE_KEY, 'sk-ant', 'gsk_synthetic', 'claudeKey', 'aiKey', 'secret chat', 'xp']) assert.ok(!txt.includes(bad), bad);
  assert.deepEqual(Object.keys(r.data).sort(), ['bw', 'days', 'ses', 'weight']);
  assert.equal(r.data.weight, 80);
  assert.equal(O.pickSafe('not json').ok, false);
  assert.equal(O.pickSafe('[1,2]').ok, false);
});

test('per-side: RDL logged 22–25 while the old plan says 90 → 2w + 20, flagged', () => {
  const ses = ['2026-06-01', '2026-06-08', '2026-06-15'].map((d, i) => oses(d, 'lowerB', { 'Romanian Deadlift': ['كجم إجمالي', [[22.5 + i * 1.25, 10], [22.5 + i * 1.25, 10]]] }));
  const m = model(ses);
  const r = row(m, 'lowerB', 'ex47');
  assert.equal(r.chosen, 2 * 25 + 20); // 70
  assert.ok(r.flags.includes('side')); assert.equal(r.review, true);
  assert.equal(O.FLAG_TEXT.side, 'اتفسّر كوزن جنب واحد');
  assert.deepEqual([r.w1, r.w2], [55, 62.5]); // 56 → 55, 63 → 62.5 (bar 2.5)
});

test('per-side vs total: a low bench value is normalized when 2w + 20 fits the neighbours, dropped when neither fits', () => {
  const fits = model([
    oses('2026-06-01', 'upperA', { 'Bench Press': ['كجم إجمالي', [[100, 6], [100, 6]]] }),
    oses('2026-06-08', 'upperA', { 'Bench Press': ['كجم إجمالي', [[40, 6], [40, 6]]] }),   // 40 per side → 100
    oses('2026-06-15', 'upperA', { 'Bench Press': ['كجم إجمالي', [[102.5, 5], [100, 6]]] })]);
  const a = row(fits, 'upperA', 'ex1');
  assert.ok(a.flags.includes('side'));
  assert.equal(a.chosen, 102.5);
  // 80–85 then 45: per side would be 110 (+30 %), total 45 (−45 %) → neither fits → those sessions are dropped
  const amb = model([
    oses('2026-07-01', 'upperA', { 'Flat Barbell Bench Press · بار': ['كجم إجمالي', [[80, 8], [80, 8]]] }),
    oses('2026-07-08', 'upperA', { 'Flat Barbell Bench Press · بار': ['كجم إجمالي', [[80, 8], [85, 6]]] }),
    oses('2026-07-15', 'upperA', { 'Flat Barbell Bench Press · بار': ['كجم إجمالي', [[85, 6], [85, 6], [85, 6]]] }),
    oses('2026-07-22', 'upperA', { 'Flat Barbell Bench Press · بار': ['كجم إجمالي', [[45, 6], [45, 7]]] }),
    oses('2026-07-29', 'upperA', { 'Flat Barbell Bench Press · بار': ['كجم إجمالي', [[45, 6], [0, 0, false]]] })]);
  const b = row(amb, 'upperA', 'ex1');
  assert.equal(b.chosen, 85); assert.equal(b.last.day, '2026-07-15');
  assert.deepEqual([b.w1, b.w2], [67.5, 77.5]);
  assert.ok(b.flags.includes('ambiguous')); assert.equal(b.review, true);
});

test('outliers: typo sets (> 3 × median, 3012) and spike sessions are removed and flagged', () => {
  const m = model([
    oses('2026-06-01', 'upperB', { 'Seated DB Shoulder Press': ['كجم/دمبل', [[20, 10], [20, 10]]] }),
    oses('2026-06-08', 'upperB', { 'Seated DB Shoulder Press': ['كجم/دمبل', [[22.5, 8], [22.5, 8]]] }),
    oses('2026-06-15', 'upperB', { 'Seated DB Shoulder Press': ['كجم/دمبل', [[22.5, 9], [225, 10], [3012, 1]]] }),
    oses('2026-06-01', 'upperA', { 'Incline DB Curl': ['كجم/دمبل', [[14, 10], [14, 10]]] }),
    oses('2026-06-08', 'upperA', { 'Incline DB Curl': ['كجم/دمبل', [[14, 10], [14, 10]]] }),
    oses('2026-06-15', 'upperA', { 'Incline DB Curl': ['كجم/دمبل', [[34, 10], [34, 10]]] }), // another bench / a slip
    oses('2026-06-22', 'upperA', { 'Incline DB Curl': ['كجم/دمبل', [[16, 8], [16, 8], [16, 1]]] })]);
  const sp = row(m, 'upperB', 'ex22');
  assert.equal(sp.chosen, 22.5); assert.ok(sp.flags.includes('typo')); assert.equal(sp.best.w, 22.5);
  const cu = row(m, 'upperA', 'ex31');
  assert.equal(cu.chosen, 16); assert.ok(cu.flags.includes('spike')); assert.ok(cu.best.w < 34);
  // r < 3 and undone sets never count
  assert.equal(cu.last.r, 8);
});

test('cross-maps: flat DB → 15° at 95 %, overhead cable → rope overhead 90 %, curls → preacher, lying → seated, hip thrust → Smith, pull-up → pull-up (body weight)', () => {
  const m = model([
    oses('2026-07-01', 'upperB', { 'Flat DB Press · دمبل': ['كجم/دمبل', [[40, 8], [40, 8]]], 'EZ-Bar Curl': ['كجم إجمالي', [[30, 10], [30, 10]]],
      'Overhead Cable Triceps Ext · حبل': ['كجم', [[50, 12], [50, 12]]] }),
    oses('2026-07-02', 'lowerA', { 'Lying Leg Curl': ['كجم', [[55, 10], [55, 10]]], 'Barbell Hip Thrust': ['كجم إجمالي', [[100, 10], [100, 10]]] }),
    oses('2026-07-03', 'upperA', { 'Weighted Pull-Up · قبضة': ['وزن مضاف', [[80, 10], [80, 9], [80, 8]]], 'Hanging Leg Raise': ['وزن جسم', [[80, 12]]] })]);
  assert.equal(row(m, 'upperB', 'exLID').chosen, 38);
  assert.match(row(m, 'upperB', 'exLID').crossNote, /flat db press × 95%/);
  assert.equal(row(m, 'upperB', 'exROE').chosen, 45);
  assert.equal(row(m, 'upperA', 'exOCT').chosen, 50); // same exercise in Upper A, 100 %
  assert.equal(row(m, 'upperB', 'ex32').chosen, 30);
  assert.equal(row(m, 'lowerA', 'ex48').chosen, 55); assert.equal(row(m, 'lowerB', 'ex48').chosen, 55);
  assert.equal(row(m, 'lowerA', 'exMHT').chosen, 100);
  const pu = row(m, 'upperA', 'exWPU');
  assert.equal(pu.body, true); assert.equal(pu.chosen, 0); assert.equal(pu.itemId, 'ub1'); assert.equal(pu.extra, true);
  assert.equal(row(m, 'lowerA', 'ex65').chosen, 0);
  assert.equal(row(m, 'upperA', 'ex14'), undefined); // no pulldown history → no row (pull-ups do not feed the pulldown)
  // no history but the old plan has a weight → that weight, flagged
  const hk = row(m, 'lowerB', 'ex45b');
  assert.equal(hk.chosen, 70); assert.deepEqual(hk.flags, ['plan']); assert.equal(hk.review, true);
  assert.deepEqual(O.mapOldName('Weighted Pull-Up · x'), [['exWPU', 1]]);
  assert.deepEqual(O.mapOldName('Something Unknown'), []);
});

test('editing a weight recomputes week 1 / week 2 by the equipment step', () => {
  const r = { eq: 'دمبل', body: false, chosen: 30 };
  O.setChosen(r, 35);
  assert.deepEqual([r.chosen, r.w1, r.w2], [35, 27.5, 32.5]); // 2.5-grid dumbbells
  O.setChosen(r, 26);
  assert.deepEqual([r.w1, r.w2], [20, 24]);                    // 2-kg pairs
  const c = { eq: 'كابل', body: false };
  O.setChosen(c, 80); assert.deepEqual([c.w1, c.w2], [65, 70]);
  O.setChosen(c, 30); assert.deepEqual([c.w1, c.w2], [25, 27.5]);
  assert.equal(L.roundLoad(68, 'بار'), 67.5);
  assert.equal(L.equipStep('جهاز', 60), 5);
});

test('seed sessions: prefill + re-entry use them; volume, PRs, weekly counts, gaps and charts never see them', () => {
  const m = model([
    oses('2026-07-01', 'upperA', { 'Flat Barbell Bench Press': ['كجم إجمالي', [[80, 8], [80, 8]]] }),
    oses('2026-07-08', 'upperA', { 'Flat Barbell Bench Press': ['كجم إجمالي', [[85, 6], [85, 6]]] })]);
  const seeds = O.seedSessions(m, { now: new Date('2026-10-20T08:00:00Z') });
  const ua = seeds.find((s) => s.dayKey === 'upperA');
  assert.equal(ua.id, 'seed:upperA'); assert.equal(ua.seed, true); assert.equal(ua.kind, 'baseline'); assert.equal(ua.day, '2026-07-08');
  const bench = ua.exercises.find((e) => e.lib === 'ex1');
  assert.equal(bench.sets.length, 4); assert.ok(bench.sets.every((t) => t.w === 85 && t.done));
  // a seed alone never triggers a load increase (reps under the top of the range)
  const item = PROGRAMS.ul4c.days.upperA.items[0];
  assert.equal(L.prescribe(item, bench).ready, false);

  const real = { id: 'r1', day: '2026-10-13', status: 'done', dayKey: 'lowerA', startedAt: '2026-10-13T15:00:00Z', exercises: [{ exId: 'la1', lib: 'ex41', name: 'x', sets: [{ w: 100, r: 6, done: true }] }] };
  const all = [...seeds, real];
  assert.deepEqual(L.finished(all).map((s) => s.id), ['r1']);
  assert.equal(L.finished(all, { seeds: true }).length, seeds.length + 1);
  assert.equal(L.exposures(all, item).length, 0);
  assert.equal(L.exposures(all, item, { seeds: true }).length, 1);
  assert.equal(L.bests(all, item).w, 0);                                     // PR baseline ignores seeds
  assert.equal(L.prList(all).length, 0);
  assert.equal(L.weeksOnPlan(all, { today: '2026-10-20' }).thisWeek, 0);
  assert.equal(L.gapDays(all, '2026-10-20'), 7);                             // from the real session, not the seed
  assert.equal(L.e1rmSeries(all, item).length, 0);                            // Progress charts
  const hs = L.hardSetsByMuscle(all, '2026-07-01', '2026-07-31');
  assert.equal(Object.values(hs).reduce((a, v) => a + (+v || 0), 0), 0);       // volume

  // live session: week 1 re-entry → 80 % of 85 = 67.5, prefilled from the seed, no calibration ramp
  const st = { get: (k) => (k === 'wk.reentry' ? { startDay: '2026-10-20', weeks: 2 } : undefined) };
  const w1 = L.reentryInfo(st, '2026-10-20');
  const live = L.buildLive({ items: PROGRAMS.ul4c.days.upperA.items, dayId: 'upperA', dayName: 'Upper A', sessions: all, reentry: w1 });
  const b = live.exercises.find((e) => e.lib === 'ex1');
  assert.equal(b.from, 'last'); assert.ok(b.sets.every((t) => t.w === 67.5)); assert.equal(b.prev.length, 4);
  assert.equal(needsCalibration(b), false);
  const w2 = L.reentryInfo(st, '2026-10-27');
  const live2 = L.buildLive({ items: PROGRAMS.ul4c.days.upperA.items, dayId: 'upperA', dayName: 'Upper A', sessions: all, reentry: w2 });
  assert.ok(live2.exercises.find((e) => e.lib === 'ex1').sets.every((t) => t.w === 77.5));
  // the pull-up gate still needs real sessions
  assert.equal(L.pullupReady([{ id: 'seed:x', seed: true, kind: 'baseline', status: 'done', day: '2026-07-01', exercises: [{ lib: 'ex12', sets: [{ w: 0, r: 10, done: true }, { w: 0, r: 10, done: true }, { w: 0, r: 10, done: true }] }] }]).ready, false);
});

test('latest bw entry only; body weight fallback from «وزن جسم» sets', () => {
  const m = model([oses('2026-07-01', 'upperA', { 'Hanging Leg Raise': ['وزن جسم', [[77, 12]]] })],
    { bw: [{ date: '2026-06-01T10:00:00Z', w: 79 }, { date: '2026-07-01T10:00:00Z', w: 78 }], profile: {} });
  assert.deepEqual(m.bodyweight, { day: '2026-07-01', kg: 78 });
  const m2 = model([oses('2026-07-01', 'upperA', { 'Hanging Leg Raise': ['وزن جسم', [[77, 12]]] })], { profile: {} });
  assert.equal(m2.bodyweight, null); assert.equal(m2.bwKg, 77);
  assert.equal(m2.gap, 111);
});
