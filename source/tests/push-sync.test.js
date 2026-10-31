import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushSyncer, restEndAt } from '../src/features/workout/push-sync.js';

function rig() {
  const log = []; let t = 1_000_000;
  const s = pushSyncer('rest', { schedule: async (at, tag) => log.push(['s', at, tag]), cancel: async (tag) => log.push(['c', tag]), now: () => t });
  return { s, log, tick: (ms) => { t += ms; }, now: () => t };
}

test('rest start → schedule once; repeated saves with the same end do nothing', () => {
  const r = rig();
  r.s.set(r.now() + 90_000); r.s.set(r.now() + 90_000); r.s.set(r.now() + 90_500);
  assert.deepEqual(r.log, [['s', r.now() + 90_000, 'rest']]);
});

test('±15 s re-schedules, skip cancels, pause cancels, resume re-schedules', () => {
  const r = rig();
  const end = r.now() + 90_000;
  r.s.set(end);
  r.s.set(end + 15_000);
  r.s.set(end);
  r.s.set(null); // skip / pause
  r.s.set(null); // nothing armed → no second cancel
  r.s.set(end + 5000); // resume
  assert.deepEqual(r.log.map((x) => x[0]), ['s', 's', 's', 'c', 's']);
});

test('timer already over → no cancel request (server job is gone)', () => {
  const r = rig();
  r.s.set(r.now() + 60_000);
  r.tick(61_000);
  r.s.set(null);
  assert.deepEqual(r.log.map((x) => x[0]), ['s']);
});

test('too-close end times are ignored (local alert covers them)', () => {
  const r = rig();
  r.s.set(r.now() + 800);
  assert.deepEqual(r.log, []);
});

test('restEndAt', () => {
  assert.equal(restEndAt(null), null);
  assert.equal(restEndAt({ endsAt: 5, pausedLeft: 30 }), null);
  assert.equal(restEndAt({ endsAt: 5 }), 5);
});

test('never throws when the push call rejects', () => {
  const s = pushSyncer('box', { schedule: () => Promise.reject(new Error('x')), cancel: () => { throw new Error('y'); }, now: () => 0 });
  s.set(60_000); s.set(null);
});
