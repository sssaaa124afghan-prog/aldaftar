import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';

const sets = (...ws) => ws.map((w) => ({ w, r: 8, rir: null, done: false }));

test('cleanField validates typed weight / reps and never guesses', () => {
  assert.equal(L.cleanField('w', 62.54), 62.5);
  assert.equal(L.cleanField('w', 0), 0);
  assert.equal(L.cleanField('w', NaN), null);
  assert.equal(L.cleanField('w', ''), null);
  assert.equal(L.cleanField('w', -1), null);
  assert.equal(L.cleanField('w', 2001), null);
  assert.equal(L.cleanField('r', 9.6), 10);
  assert.equal(L.cleanField('r', 101), null);
});

test('stepField: ten +2.5 taps are exactly +25, clamps at 0', () => {
  let w = 60; for (let i = 0; i < 10; i++) w = L.stepField('w', w, 2.5);
  assert.equal(w, 85);
  let r = 5; for (let i = 0; i < 10; i++) r = L.stepField('r', r, 1);
  assert.equal(r, 15);
  assert.equal(L.stepField('w', 1, -2.5), 0);
  assert.equal(L.stepField('r', 0, -1), 0);
  assert.equal(L.stepField('w', 0.1, 0.2), 0.3);
});

test('changing one set never changes the others; peers are only proposed', () => {
  const s = sets(60, 60, 60, 55);
  s[0].w = 62.5;
  assert.deepEqual(s.map((t) => t.w), [62.5, 60, 60, 55]);
  assert.deepEqual(L.applyPeers(s, 0, 60), [1, 2]);
  s[1].done = true;
  assert.deepEqual(L.applyPeers(s, 0, 60), [2]);
  assert.deepEqual(L.applyPeers(s, 0, 62.5), [], 'no change → no chip');
  const before = L.applyWeight(s, 0, [2]);
  assert.deepEqual(s.map((t) => t.w), [62.5, 60, 62.5, 55]);
  assert.deepEqual(before, [[2, 60]]);
});

test('removeSet keeps the cursor on a sensible set and refuses the last one', () => {
  const s = sets(1, 2, 3);
  let res = L.removeSet(s, 0, 2);
  assert.equal(res.removed.w, 1); assert.equal(res.cur, 1); assert.equal(s.length, 2);
  res = L.removeSet(s, 1, 1);
  assert.equal(res.cur, 0); assert.equal(s.length, 1);
  assert.equal(L.removeSet(s, 0, 0), null);
  const t = sets(1, 2, 3); t[1].done = true;
  assert.equal(L.removeSet(t, 0, 0).cur, 1, 'next open set after the removed one');
});

test('isSwipe needs a clear horizontal gesture', () => {
  assert.equal(L.isSwipe(90, 10), true);
  assert.equal(L.isSwipe(-90, 30), true);
  assert.equal(L.isSwipe(70, 0), false);
  assert.equal(L.isSwipe(100, 60), false, 'diagonal scroll');
  assert.equal(L.isSwipe(5, 300), false);
});
