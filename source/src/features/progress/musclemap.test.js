import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muscleSets, level, muscleRank, FULL_SETS } from './musclemap-data.js';

const ex = (muscle, done, extra = {}) => ({ muscle, sets: Array.from({ length: done }, () => ({ w: 50, r: 8, done: true })), ...extra });
const ses = (day, exercises, extra = {}) => ({ id: day, day, status: 'done', exercises, ...extra });

test('muscleSets: last 7 days, done sets only, no boxing / skipped / warm-ups', () => {
  const sessions = [
    ses('2026-11-12', [ex('صدر', 4), ex('ظهر', 3), { muscle: 'باي', sets: [{ done: true }, { done: false }, { done: true, warm: true }] }]),
    ses('2026-11-06', [ex('صدر', 3)]),                    // day −6: inside
    ses('2026-11-05', [ex('صدر', 9)]),                    // day −7: outside
    ses('2026-11-10', [ex('رجل', 5, { skipped: true })]),
    ses('2026-11-11', [ex('كتف', 6)], { kind: 'boxing' }),
    ses('2026-11-09', [ex('رجل', 2)], { status: 'live' }),
  ];
  assert.deepEqual(muscleSets(sessions, '2026-11-12'), { صدر: 7, ظهر: 3, باي: 1 });
});

test('level + rank', () => {
  assert.equal(level(0), 0);
  assert.equal(level(FULL_SETS / 2), 0.5);
  assert.equal(level(99), 1);
  const r = muscleRank({ صدر: 7, ظهر: 12 }, ['صدر', 'ظهر', 'بطن']);
  assert.deepEqual(r.done.map((x) => x.m), ['ظهر', 'صدر']);
  assert.deepEqual(r.missed, ['بطن']);
});
