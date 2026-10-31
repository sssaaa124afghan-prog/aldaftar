// core/alerts.js: wall-clock timer cues + catch-up, WAV fallback, platform probe, settings defaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../src/core/alerts.js';

const T0 = Date.parse('2026-10-31T18:00:00+04:00');
const kinds = (r) => r.events.map((e) => e.kind);

test('timerCues: 90 s rest → nothing early, one 10 s tick, then 3-2-1, then end exactly once', () => {
  const st = { endsAt: T0 + 90_000, total: 90 };
  assert.deepEqual(kinds(A.timerCues(st, T0)), []);
  assert.deepEqual(kinds(A.timerCues(st, T0 + 70_000)), []);
  assert.deepEqual(kinds(A.timerCues(st, T0 + 80_000)), ['warn']); // 10 s left
  assert.deepEqual(kinds(A.timerCues(st, T0 + 80_250)), [], 'warn fires once');
  const c = A.timerCues(st, T0 + 86_900); // 3.1 s left → three beeps on the audio clock
  assert.deepEqual(kinds(c), ['count', 'count', 'count']);
  assert.deepEqual(c.events.map((e) => +e.delay.toFixed(2)), [0.1, 1.1, 2.1]);
  assert.deepEqual(kinds(A.timerCues(st, T0 + 88_000)), [], 'countdown once');
  const end = A.timerCues(st, T0 + 90_100);
  assert.deepEqual(kinds(end), ['restEnd']); assert.equal(end.catchUp, false);
  assert.deepEqual(kinds(A.timerCues(st, T0 + 91_000)), [], 'end once');
});

test('timerCues: counts from the wall clock, never from ticks (a page frozen mid-rest skips straight to the right cue)', () => {
  const st = { endsAt: T0 + 60_000, total: 60 };
  assert.deepEqual(kinds(A.timerCues(st, T0 + 1000)), []);
  // frozen for 57 s: wakes 2.4 s before the end → only the remaining countdown beeps, no stale 10 s tick
  const r = A.timerCues(st, T0 + 57_600);
  assert.deepEqual(kinds(r), ['count', 'count']);
  assert.equal(st.fired.warn, true);
});

test('timerCues: catch-up after a locked screen fires the end at once with the lateness', () => {
  const st = { endsAt: T0 + 120_000, total: 120 };
  A.timerCues(st, T0 + 5000);
  const r = A.timerCues(st, T0 + 120_000 + 47_000); // he unlocks 47 s after the end
  assert.deepEqual(kinds(r), ['restEnd'], 'no 10 s tick or 3-2-1 replay, only the end');
  assert.equal(r.catchUp, true); assert.equal(r.late, 47_000); assert.equal(r.left, 0);
  assert.equal(A.lateText(r.late), 'الراحة خلصت من 47 ث');
  assert.equal(A.lateText(125_000), 'الراحة خلصت من 2 د و5 ث');
  assert.equal(A.lateText(120_000, 'الجولة'), 'الجولة خلصت من 2 د');
});

test('timerCues: short rests (≤ 20 s) skip the 10 s tick; a reset fired map replays cues after +15 s', () => {
  const st = { endsAt: T0 + 15_000, total: 15 };
  assert.deepEqual(kinds(A.timerCues(st, T0 + 6000)), []);
  const st2 = { endsAt: T0 + 30_000, total: 30 };
  assert.deepEqual(kinds(A.timerCues(st2, T0 + 21_000)), ['warn']);
  st2.endsAt += 15_000; st2.fired = {}; // shiftRest(+15)
  assert.deepEqual(kinds(A.timerCues(st2, T0 + 36_000)), ['warn']);
});

test('timerCues: just-late end (≤ 1.5 s) is a normal end, not a catch-up', () => {
  const st = { endsAt: T0, total: 90 };
  const r = A.timerCues(st, T0 + 1200);
  assert.equal(r.catchUp, false);
});

test('CUES: every cue exists, is short, and renders to a valid 8-bit WAV', () => {
  for (const k of ['restEnd', 'warn', 'count', 'bell', 'bellEnd', 'bellSoft', 'clap', 'set', 'pr', 'hold', 'relax', 'phase', 'done', 'test']) {
    assert.ok(A.CUES[k] && A.CUES[k].length, k);
    assert.ok(A.cueLength(k) > 0 && A.cueLength(k) <= 2, `${k} length ${A.cueLength(k)}`);
  }
  const w = A.renderWav(A.CUES.restEnd, { rate: 8000 });
  assert.equal(String.fromCharCode(...w.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...w.subarray(8, 12)), 'WAVE');
  const dv = new DataView(w.buffer);
  assert.equal(dv.getUint32(24, true), 8000); assert.equal(dv.getUint16(34, true), 8);
  assert.equal(dv.getUint32(40, true), w.length - 44);
  let peak = 0; for (let i = 44; i < w.length; i++) peak = Math.max(peak, Math.abs(w[i] - 128));
  assert.ok(peak > 40, `audible (${peak})`);
  assert.match(A.wavDataUri(A.CUES.count), /^data:audio\/wav;base64,UklGR/);
});

test('alertEnv: iPhone Safari tab / home-screen PWA / Android', () => {
  const ua = { ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1', and: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile' };
  const w = (o) => ({ navigator: { userAgent: o.ua, standalone: o.sa, wakeLock: o.wl ? { request() {} } : undefined }, matchMedia: () => ({ matches: !!o.sa }), Notification: o.N });
  const tab = A.alertEnv(w({ ua: ua.ios, sa: false, wl: true }));
  assert.deepEqual([tab.ios, tab.standalone, tab.notify, tab.bgAlerts, tab.canAsk, tab.wakeLock], [true, false, false, false, false, true]);
  const pwa = A.alertEnv(w({ ua: ua.ios, sa: true, wl: true, N: { permission: 'default' } }));
  assert.deepEqual([pwa.standalone, pwa.notify, pwa.bgAlerts, pwa.canAsk], [true, true, false, false], 'iOS PWA: API exists but no background timer alerts');
  const and = A.alertEnv(w({ ua: ua.and, N: { permission: 'default' } }));
  assert.deepEqual([and.ios, and.bgAlerts, and.canAsk, and.wakeLock], [false, true, true, false]);
  assert.equal(A.alertEnv(w({ ua: ua.and, N: { permission: 'granted' } })).canAsk, false);
});

test('settings defaults: sound on, 80 % volume, voice off, vibration on, screen-on on; bound to ctx.settings', () => {
  const store = {};
  A.initAlerts({ get: (k) => store[k] });
  assert.deepEqual([A.soundOn(), A.volume(), A.voiceOn(), A.vibrateOn(), A.wakeOn()], [true, 0.8, false, true, true]);
  Object.assign(store, { 'alerts.sound': false, 'alerts.volume': 0.3, 'alerts.voice': true, 'ui.haptics': false, 'wk.wakeLock': false });
  assert.deepEqual([A.soundOn(), A.volume(), A.voiceOn(), A.vibrateOn(), A.wakeOn()], [false, 0.3, true, false, false]);
  store['alerts.volume'] = 7; assert.equal(A.volume(), 1);
  assert.equal(A.cue('restEnd'), false, 'sound off → no cue');
});
