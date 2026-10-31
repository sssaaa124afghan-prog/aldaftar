import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPush, cleanUrl, tokenOk, b64uToBytes, schedulePush, cancelPush } from '../src/core/push.js';

const KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const TOKEN = 'A'.repeat(43);
const URL0 = 'https://fit-push.someone.workers.dev';
const SUBJ = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };

function rig({ permission = 'default', grant = 'granted', online = true, existing = null, status = 200, hasPush = true, throwFetch = false } = {}) {
  const secrets = new Map(), calls = [], subs = { unsub: 0, subscribed: null };
  let cur = existing;
  const pushManager = {
    getSubscription: async () => cur,
    subscribe: async (o) => { subs.subscribed = o; cur = { options: { applicationServerKey: o.applicationServerKey.buffer }, toJSON: () => SUBJ, unsubscribe: async () => { subs.unsub++; cur = null; return true; } }; return cur; },
  };
  const Notification = { permission, requestPermission: async () => { Notification.permission = grant; return grant; } };
  const nav = { onLine: online, serviceWorker: { ready: Promise.resolve({ pushManager }) } };
  const now = 1_800_000_000_000;
  const p = createPush({
    getSecret: async (k) => secrets.get(k) || '', setSecret: async (k, v) => { if (v) secrets.set(k, v); else secrets.delete(k); },
    navigator: nav, Notification, now: () => now, hasPush: () => hasPush,
    fetch: async (url, init) => {
      if (throwFetch) throw new TypeError('Failed to fetch');
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith('/vapid')) return new Response(JSON.stringify({ key: KEY }), { status: 200 });
      return new Response(JSON.stringify({ ok: status === 200 }), { status });
    },
  });
  return { p, secrets, calls, subs, nav, Notification, now };
}

test('helpers', () => {
  assert.equal(cleanUrl(' https://a.workers.dev/ '), 'https://a.workers.dev');
  assert.equal(cleanUrl('http://a.workers.dev'), '');
  assert.equal(cleanUrl('https://u:p@a.dev'), '');
  assert.equal(cleanUrl('https://a.dev/?x=1'), '');
  assert.equal(cleanUrl('nope'), '');
  assert.ok(tokenOk(TOKEN)); assert.ok(!tokenOk('short')); assert.ok(!tokenOk('A'.repeat(40) + ' !'));
  assert.equal(b64uToBytes(KEY).length, 65);
});

test('unbound module functions are no-ops', async () => {
  assert.deepEqual(await schedulePush(Date.now() + 5000, 'rest'), { ok: false, reason: 'off' });
  assert.deepEqual(await cancelPush('rest'), { ok: false, reason: 'off' });
});

test('not configured → schedule/cancel are no-ops without network', async () => {
  const r = rig();
  assert.equal((await r.p.schedule(r.now + 60000, 'rest')).reason, 'off');
  assert.equal((await r.p.cancel('rest')).reason, 'off');
  assert.equal(r.calls.length, 0);
});

test('enable: asks permission, subscribes with the VAPID key, stores secrets, test push in 5 s', async () => {
  const r = rig();
  const res = await r.p.enable({ url: URL0 + '/', token: TOKEN });
  assert.deepEqual(res, { ok: true, reason: 'ok' });
  assert.equal(r.Notification.permission, 'granted');
  assert.equal(r.subs.subscribed.userVisibleOnly, true);
  assert.deepEqual([...r.subs.subscribed.applicationServerKey], [...b64uToBytes(KEY)]);
  assert.equal(r.calls[0].url, URL0 + '/vapid');
  assert.equal(r.calls[0].init.headers['x-app-token'], undefined, 'token never sent to /vapid');
  const t = r.calls[1];
  assert.equal(t.url, URL0 + '/schedule');
  assert.equal(t.init.headers['x-app-token'], TOKEN);
  assert.equal(t.init.credentials, 'omit');
  assert.deepEqual(t.body, { sub: SUBJ, at: r.now + 5000, tag: 'test' });
  assert.equal(r.secrets.get('pushUrl'), URL0);
  assert.equal(r.secrets.get('pushToken'), TOKEN);
  assert.deepEqual(JSON.parse(r.secrets.get('pushSub')), SUBJ);
  assert.ok(r.p.isOn());
});

test('enable: validation and failure reasons', async () => {
  assert.equal((await rig().p.enable({ url: 'http://x', token: TOKEN })).reason, 'bad_url');
  assert.equal((await rig().p.enable({ url: URL0, token: 'short' })).reason, 'bad_token');
  assert.equal((await rig({ hasPush: false }).p.enable({ url: URL0, token: TOKEN })).reason, 'no_push');
  assert.equal((await rig({ permission: 'denied' }).p.enable({ url: URL0, token: TOKEN })).reason, 'denied');
  assert.equal((await rig({ grant: 'default' }).p.enable({ url: URL0, token: TOKEN })).reason, 'denied');
  assert.equal((await rig({ online: false }).p.enable({ url: URL0, token: TOKEN })).reason, 'offline');
  assert.equal((await rig({ status: 401 }).p.enable({ url: URL0, token: TOKEN })).reason, 'token');
  assert.equal((await rig({ throwFetch: true }).p.enable({ url: URL0, token: TOKEN })).reason, 'offline');
});

test('enable: resubscribes when the server VAPID key changed', async () => {
  let unsub = 0;
  const old = { options: { applicationServerKey: new Uint8Array(65).fill(4).buffer }, toJSON: () => SUBJ, unsubscribe: async () => { unsub++; return true; } };
  const r = rig({ existing: old });
  assert.ok((await r.p.enable({ url: URL0, token: TOKEN })).ok);
  assert.equal(unsub, 1);
  assert.ok(r.subs.subscribed);
});

test('schedule/cancel send only {sub, at, tag} — never title/body', async () => {
  const r = rig();
  await r.p.enable({ url: URL0, token: TOKEN, testInSec: 0 });
  r.calls.length = 0;
  assert.ok((await r.p.schedule(r.now + 90_000, 'rest', 'Bench 100kg', 'سكوات')).ok);
  assert.deepEqual(r.calls[0].body, { sub: SUBJ, at: r.now + 90_000, tag: 'rest' });
  assert.ok(!r.calls[0].init.body.includes('Bench'));
  assert.ok((await r.p.cancel('rest')).ok);
  assert.deepEqual(r.calls[1].body, { sub: SUBJ, tag: 'rest' });
  assert.ok((await r.p.cancel()).ok);
  assert.deepEqual(r.calls[2].body, { sub: SUBJ });
  // bad input never hits the network
  assert.equal((await r.p.schedule(r.now + 500, 'rest')).reason, 'at');
  assert.equal((await r.p.schedule(r.now + 3 * 3600_000, 'rest')).reason, 'at');
  assert.equal((await r.p.schedule(r.now + 60_000, 'squat')).reason, 'tag');
  assert.equal(r.calls.length, 3);
  r.nav.onLine = false;
  assert.equal((await r.p.schedule(r.now + 60_000, 'rest')).reason, 'offline');
  assert.equal(r.calls.length, 3);
});

test('network failure never throws', async () => {
  const r = rig();
  await r.p.enable({ url: URL0, token: TOKEN, testInSec: 0 });
  const p3 = createPush({ getSecret: async (k) => r.secrets.get(k) || '', navigator: { onLine: true }, fetch: async () => { throw new TypeError('x'); }, now: () => r.now });
  const res = await p3.schedule(r.now + 60_000, 'rest');
  assert.equal(res.ok, false); assert.equal(res.reason, 'network');
});

test('disable («إيقاف ومسح»): cancel + forget on server, unsubscribe, wipe secrets', async () => {
  const r = rig();
  await r.p.enable({ url: URL0, token: TOKEN, testInSec: 0 });
  r.calls.length = 0;
  const res = await r.p.disable();
  assert.deepEqual(res, { ok: true, server: 'forgotten' });
  assert.deepEqual(r.calls.map((c) => c.url.slice(URL0.length)), ['/cancel', '/forget']);
  assert.equal(r.subs.unsub, 1);
  assert.equal(r.secrets.size, 0);
  assert.ok(!r.p.isOn());
  assert.equal((await r.p.schedule(r.now + 60_000, 'rest')).reason, 'off');
});
