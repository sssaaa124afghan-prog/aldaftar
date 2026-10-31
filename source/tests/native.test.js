// core/native.js + the native routes in core/push.js and core/alerts.js (iOS shell bridge).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../src/core/native.js';
import { nativeSchedule, nativeCancel, nativeStatus } from '../src/core/push.js';
import * as A from '../src/core/alerts.js';

const T0 = Date.parse('2026-10-31T18:00:00+04:00');
function fakeWin({ answer } = {}) {
  const sent = [];
  const w = { navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' } };
  w.webkit = { messageHandlers: { native: { postMessage(m) { sent.push(m); if (m.cb && answer !== undefined) setTimeout(() => w.NativeApp.__resolve(m.cb, answer), 1); } } } };
  return { w, sent };
}

test('isNative: only with window.webkit.messageHandlers.native', () => {
  assert.equal(N.isNative({}), false);
  assert.equal(N.isNative({ webkit: { messageHandlers: {} } }), false);
  assert.equal(N.isNative(fakeWin().w), true);
  assert.equal(N.post('haptic', { kind: 'light' }, {}), false, 'no bridge → false, no throw');
});

test('scheduleNotification / cancel / keepAwake / haptic post the documented messages', () => {
  const { w, sent } = fakeWin();
  assert.ok(N.scheduleNotification({ id: 'fc-rest', at: T0 + 90_000.4, title: 'الراحة خلصت', body: 'يلا' }, w));
  assert.deepEqual(sent.at(-1), { id: 'fc-rest', at: T0 + 90_000, title: 'الراحة خلصت', body: 'يلا', type: 'scheduleNotification' });
  assert.equal(N.scheduleNotification({ id: 'x', at: NaN }, w), false);
  N.cancelNotification('fc-rest', w); assert.deepEqual(sent.at(-1), { id: 'fc-rest', type: 'cancelNotification' });
  N.keepAwake(1, w); assert.deepEqual(sent.at(-1), { on: true, type: 'keepAwake' });
  N.haptic('nope', w); assert.deepEqual(sent.at(-1), { kind: 'light', type: 'haptic' });
  N.haptic('success', w); assert.equal(sent.at(-1).kind, 'success');
});

test('hapticFor: timer-end buzz → warning, PR double → success, taps → light/medium', () => {
  assert.equal(N.hapticFor([200, 100, 200, 100, 300]), 'warning');
  assert.equal(N.hapticFor([30, 70, 30]), 'success');
  assert.equal(N.hapticFor(12), 'light');
  assert.equal(N.hapticFor(40), 'medium');
});

test('share: file payload in base64 (UTF-8 Arabic survives), text payload, nothing otherwise', () => {
  const { w, sent } = fakeWin();
  const json = JSON.stringify({ name: 'شهاب' });
  assert.ok(N.share({ filename: 'b.json', mime: 'application/json', dataBase64: N.utf8ToBase64(json) }, w));
  const m = sent.at(-1);
  assert.equal(m.type, 'share'); assert.equal(m.filename, 'b.json'); assert.equal(m.mime, 'application/json');
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(m.dataBase64), (c) => c.charCodeAt(0))), json);
  assert.ok(N.share({ text: 'hi' }, w)); assert.deepEqual(sent.at(-1), { text: 'hi', type: 'share' });
  assert.equal(N.share({}, w), false);
});

test('ask: resolves with the shell answer, or the fallback when it never answers', async () => {
  const a = fakeWin({ answer: 'granted' });
  assert.equal(await N.requestNotificationPermission(a.w), 'granted');
  assert.equal(a.sent[0].type, 'requestNotificationPermission'); assert.ok(a.sent[0].cb);
  assert.deepEqual(Object.keys(a.w.NativeApp.__pending), [], 'pending callback cleaned up');
  const b = fakeWin();
  assert.equal(await N.ask('notificationStatus', {}, { ms: 20, fallback: 'unknown' }, b.w), 'unknown');
  assert.equal(await N.ask('notificationStatus', {}, { ms: 20 }, {}), 'unknown', 'no bridge → fallback at once');
});

test('nativeSchedule/nativeCancel: local notification per tag with generic Arabic text, same limits as Web Push', () => {
  const { w, sent } = fakeWin();
  assert.deepEqual(nativeSchedule(T0 + 90_000, 'rest', { now: T0, w }), { ok: true, native: true });
  assert.deepEqual(sent.at(-1), { id: 'fc-rest', at: T0 + 90_000, title: 'الراحة خلصت', body: N.NOTE_TEXT.rest.body, type: 'scheduleNotification' });
  assert.equal(nativeSchedule(T0 + 500, 'rest', { now: T0, w }).reason, 'at', 'too soon');
  assert.equal(nativeSchedule(T0 + 3 * 3600_000, 'rest', { now: T0, w }).reason, 'at', 'too far');
  assert.equal(nativeSchedule(T0 + 90_000, 'evil', { now: T0, w }).reason, 'tag');
  sent.length = 0;
  nativeCancel('box', { w }); assert.deepEqual(sent, [{ id: 'fc-box', type: 'cancelNotification' }]);
  sent.length = 0;
  nativeCancel(undefined, { w }); assert.deepEqual(sent.map((m) => m.id), ['fc-rest', 'fc-box', 'fc-test']);
});

test('nativeStatus: on only when iOS allows notifications', async () => {
  assert.deepEqual(await nativeStatus(fakeWin({ answer: 'granted' }).w), { on: true, url: '', support: 'native', native: true, permission: 'granted' });
  assert.equal((await nativeStatus(fakeWin({ answer: 'denied' }).w)).on, false);
});

test('alertEnv: inside the shell → native, never the SW background path', () => {
  const { w } = fakeWin();
  w.Notification = { permission: 'default' };
  const e = A.alertEnv(w);
  assert.equal(e.native, true); assert.equal(e.ios, true); assert.equal(e.bgAlerts, false); assert.equal(e.canAsk, false);
  assert.equal(A.alertEnv({ navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, Notification: { permission: 'default' } }).native, false);
});

test('buzz + keepAwake route through the bridge when native (global window)', async () => {
  const { w, sent } = fakeWin();
  const prev = globalThis.window; globalThis.window = w;
  try {
    A.initAlerts({ get: () => undefined });
    assert.ok(A.buzz([200, 100, 200, 100, 300]));
    assert.deepEqual(sent.at(-1), { kind: 'warning', type: 'haptic' });
    await A.keepAwake(true, 'session');
    assert.deepEqual(sent.at(-1), { on: true, type: 'keepAwake' });
    assert.equal(A.awake(), true);
    assert.equal(await A.keepAwake(false, 'other'), false, 'another owner cannot drop it');
    await A.keepAwake(false, 'session');
    assert.deepEqual(sent.at(-1), { on: false, type: 'keepAwake' });
    A.initAlerts({ get: (k) => (k === 'ui.haptics' ? false : undefined) });
    const n = sent.length; assert.equal(A.buzz(40), false, 'haptics off in Profile → nothing'); assert.equal(sent.length, n);
  } finally { globalThis.window = prev; }
});
