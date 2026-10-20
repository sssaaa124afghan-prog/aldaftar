import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from './entry-assist.js';

const S = (ws, extra = {}) => ws.map((w) => ({ w, r: 8, rir: null, done: false, ...extra }));

test('carry-forward: untouched later open sets follow set 1; edited and done ones do not', () => {
  const sets = S([0, 0, 0, 0]);
  sets[0].w = 22.5; sets[0].wEd = true;
  const before = A.carryWeight(sets, 0);
  assert.deepEqual(sets.map((s) => s.w), [22.5, 22.5, 22.5, 22.5]);
  assert.deepEqual(before, [[1, 0], [2, 0], [3, 0]]);
  // editing set 2 to 25 changes set 3/4 (untouched) but never set 1
  sets[1].w = 25; sets[1].wEd = true;
  A.carryWeight(sets, 1);
  assert.deepEqual(sets.map((s) => s.w), [22.5, 25, 25, 25]);
  // a user-edited later set is left alone; a done set too
  sets[3].w = 20; sets[3].wEd = true; sets[2].done = true;
  sets[0].w = 30; A.carryWeight(sets, 0);
  assert.deepEqual(sets.map((s) => s.w), [30, 25, 25, 20]);
  assert.deepEqual(A.editedPeers(sets, 0), [1, 3]);
});

test('0 kg guard: loaded lifts need a weight, bodyweight moves do not', () => {
  assert.equal(A.needsWeight({ lib: 'ex2' }, { w: 0 }), true); // incline DB press
  assert.equal(A.needsWeight({ lib: 'ex16' }, { w: 0 }), true); // T-bar row (bar)
  assert.equal(A.needsWeight({ lib: 'ex14' }, { w: 0 }), true); // lat pulldown (cable)
  assert.equal(A.needsWeight({ lib: 'ex2' }, { w: 12 }), false);
  assert.equal(A.needsWeight({ lib: 'ex12' }, { w: 0 }), false); // pull-ups
  assert.equal(A.needsWeight({ lib: 'exWPU' }, { w: 0 }), false); // weighted pull-up: 0 added kg is fine
});

test('calibration: only for loaded lifts with no history and no weight', () => {
  const e = { lib: 'ex1', kind: 'compound', prev: [], from: 'plan', sets: S([0, 0, 0]) };
  assert.equal(A.needsCalibration(e), true);
  assert.equal(A.needsCalibration({ ...e, prev: [{ w: 60, r: 8 }], from: 'last' }), false);
  assert.equal(A.needsCalibration({ ...e, lib: 'ex12' }), false);
  assert.equal(A.needsCalibration({ ...e, sets: S([40, 40, 40]) }), false);
  assert.equal(A.needsCalibration({ ...e, calib: { skip: true } }), false);
  assert.equal(A.needsCalibration({ ...e, calib: { locked: 40 } }), false);
});

test('calibration ramp: light start → estimate → lock on «مناسب»; re-entry is lighter', () => {
  const bench = { lib: 'ex1', kind: 'compound', sets: S([0, 0, 0]) };
  const c1 = A.calibStart(bench, 72);
  assert.equal(c1.est, 40); // 0.55 × 72 = 39.6 → 40
  assert.equal(c1.w, 25); // 60 % → 24 → 25, ≥ empty bar
  const c2 = A.calibNext(c1, 'easy');
  assert.equal(c2.w, 40); assert.equal(c2.n, 2); assert.equal(c2.locked, undefined);
  const c3 = A.calibNext(c2, 'easy');
  assert.equal(c3.w, 45); // +15 % → 46 → 45
  const done = A.calibNext(c3, 'ok');
  assert.equal(done.locked, 45);
  const hard = A.calibNext(c2, 'hard');
  assert.equal(hard.locked, 35); // 40 × 0.9 = 36 → 35
  const re = A.calibStart(bench, 72, { reentry: true });
  assert.ok(re.est < c1.est, `re-entry estimate ${re.est} < ${c1.est}`);
  assert.equal(A.calibNext({ ...c2, reentry: true }, 'hard').locked, 35); // 34 → 35 (2.5 steps)
  // dumbbells: per hand, dumbbell steps
  const db = A.calibStart({ lib: 'ex2', kind: 'compound', sets: S([0, 0, 0]) }, 72);
  assert.equal(db.est, 12); assert.equal(db.w, 7);
  // cap: easy forever still locks
  let c = c1; for (let i = 0; i < 10 && c.locked === undefined; i++) c = A.calibNext(c, 'easy');
  assert.ok(c.locked > 40 && c.log.length <= A.CALIB_MAX);
});

test('applyCalibration fills untouched open sets and returns Undo data', () => {
  const sets = S([0, 0, 0]); sets[2].w = 30; sets[2].wEd = true;
  const before = A.applyCalibration(sets, 42.5);
  assert.deepEqual(sets.map((s) => s.w), [42.5, 42.5, 30]);
  assert.deepEqual(before, [[0, 0], [1, 0]]);
});
