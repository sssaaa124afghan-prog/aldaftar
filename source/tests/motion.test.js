import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navDir } from '../src/ui/motion.js';

const TABS = ['today', 'workout', 'nutrition', 'progress', 'profile'];

test('navDir: tabs follow the visual tab bar (RTL: next tab is on the left)', () => {
  assert.equal(navDir('today', 'workout', TABS), 'left');
  assert.equal(navDir('progress', 'nutrition', TABS), 'right');
  assert.equal(navDir('today', 'workout', TABS, false), 'right');
});

test('navDir: sub-screen push comes from the inline-end, back from the inline-start', () => {
  assert.equal(navDir('workout', 'workout/plan', TABS), 'left');
  assert.equal(navDir('workout/plan', 'workout', TABS), 'right');
  assert.equal(navDir('today', 'workout/session', TABS), 'left');
  assert.equal(navDir('workout/session', 'workout', TABS), 'right');
  assert.equal(navDir('workout/plan', 'workout/library', TABS), 'left');
});

test('navDir: no motion on first render or same route', () => {
  assert.equal(navDir(null, 'today', TABS), null);
  assert.equal(navDir('today', 'today', TABS), null);
});
