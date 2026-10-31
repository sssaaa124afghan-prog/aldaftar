import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveTimer, onIslandAction, takeIslandAction } from '../src/core/native.js';

const fakeWin = () => {
  const sent = [];
  const w = { webkit: { messageHandlers: { native: { postMessage: (m) => { sent.push(m); if (m.cb && m.type === 'timerTake') setTimeout(() => w.NativeApp.__resolve(m.cb, JSON.stringify({ kind: 'rest', rid: '5', endsAt: 99 })), 0); } } } } };
  return { w, sent };
};

test('liveTimer: sends once per real change, ignores sub-1.5 s end jitter, ends once', () => {
  const { w, sent } = fakeWin();
  const s = { kind: 'rest', title: 'راحة', subtitle: 'x', endsAt: 100000, startedAt: 1, total: 90, controls: true, rid: '1' };
  assert.equal(liveTimer(s, w), true);
  assert.equal(liveTimer({ ...s, endsAt: 100900 }, w), false);
  assert.equal(liveTimer({ ...s, endsAt: 130000 }, w), true);
  assert.equal(liveTimer({ ...s, endsAt: 130000, paused: true, pausedLeft: 30 }, w), true);
  assert.equal(liveTimer(null, w), true);
  assert.equal(liveTimer(null, w), false);
  assert.deepEqual(sent.map((m) => m.type), ['liveTimer', 'liveTimer', 'liveTimer', 'liveTimerEnd']);
  assert.equal(sent[0].state.controls, true);
});

test('liveTimer: no-op on the web', () => {
  assert.equal(liveTimer({ kind: 'work' }, {}), false);
});

test('island: live callback + pending take', async () => {
  const { w } = fakeWin();
  let got = null;
  const off = onIslandAction((s) => { got = s; }, w);
  w.NativeApp.__island('{"kind":"rest","rid":"7"}');
  assert.equal(got.rid, '7');
  off();
  assert.equal(w.NativeApp.__island, undefined);
  const st = await takeIslandAction(w);
  assert.equal(st.rid, '5');
});
