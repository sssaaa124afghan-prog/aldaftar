// Lock-screen alerts through a tiny Web Push scheduler (Cloudflare Worker, see push-server/README.ar.md).
// iOS freezes a home-screen PWA when the phone locks, so only a server push can wake it at the end of a rest / round.
//
// Privacy: the only things that leave the phone are the push subscription (endpoint + public keys), the end time and a
// fixed tag ('rest' | 'box' | 'test'). No titles, exercise names, weights or health data are ever sent; the server
// picks a generic Arabic text from the tag. Worker URL, token, VAPID key and subscription live in the 'secrets' record
// (never exported in backups).
//
// Every call is a graceful no-op when push is not configured, unsupported (iOS tab, not installed) or offline.
import { getSecret, setSecret } from './db.js';
import * as native from './native.js';

export const TAGS = Object.freeze(['rest', 'box', 'test']);
const S = Object.freeze({ url: 'pushUrl', token: 'pushToken', key: 'pushVapid', sub: 'pushSub' });
const TIMEOUT_MS = 6000;
const MAX_AHEAD_MS = 2 * 60 * 60 * 1000;

export function b64uToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const sameBytes = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/** https only, no credentials / query / hash; trailing slash dropped. Returns '' when invalid. */
export function cleanUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    if (x.protocol !== 'https:' || x.username || x.password || x.search || x.hash) return '';
    return x.origin + x.pathname.replace(/\/+$/, '');
  } catch { return ''; }
}
export const tokenOk = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(t.trim());

/**
 * Factory (tests inject fakes). deps: { getSecret(name), setSecret(name, value), fetch, navigator, Notification, now, hasPush }
 */
export function createPush(deps = {}) {
  const d = {
    fetch: (...a) => globalThis.fetch(...a),
    navigator: globalThis.navigator,
    Notification: globalThis.Notification,
    now: () => Date.now(),
    hasPush: () => typeof globalThis.PushManager !== 'undefined', // iOS: only in the installed home-screen app
    ...deps,
  };
  const st = { url: '', token: '', key: '', sub: null, loaded: false };

  async function load() {
    if (st.loaded || !d.getSecret) return;
    st.url = (await d.getSecret(S.url)) || '';
    st.token = (await d.getSecret(S.token)) || '';
    st.key = (await d.getSecret(S.key)) || '';
    try { st.sub = JSON.parse((await d.getSecret(S.sub)) || 'null'); } catch { st.sub = null; }
    st.loaded = true;
  }
  const save = async (name, v) => { if (d.setSecret) await d.setSecret(name, v); };

  const online = () => !d.navigator || d.navigator.onLine !== false;
  const configured = () => !!(st.url && st.token && st.sub && st.sub.endpoint);

  /** What this device can do. reason: 'ok' | 'no_sw' | 'no_push' (iOS tab / not installed) | 'denied' */
  function support() {
    const nav = d.navigator;
    if (!nav || !nav.serviceWorker) return 'no_sw';
    if (!d.hasPush() || !d.Notification) return 'no_push';
    if (d.Notification.permission === 'denied') return 'denied';
    return 'ok';
  }

  async function call(path, body, { method = 'POST' } = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : 0;
    try {
      const res = await d.fetch(st.url + path, {
        method,
        headers: method === 'POST' ? { 'content-type': 'application/json', 'x-app-token': st.token } : {},
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        keepalive: true, // lets the request finish while the page goes to the background
        mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: ctl ? ctl.signal : undefined,
      });
      let data = null; try { data = await res.json(); } catch { /* empty */ }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally { if (t) clearTimeout(t); }
  }

  /**
   * Ask permission (must run inside a tap on iOS), subscribe, store, and send a test push in 5 s.
   * Returns { ok, reason }. reason: 'bad_url' | 'bad_token' | 'no_sw' | 'no_push' | 'denied' | 'offline' | 'server' | 'token' | 'subscribe'
   */
  async function enable({ url, token, testInSec = 5 } = {}) {
    await load();
    const u = cleanUrl(url), tk = String(token || '').trim();
    if (!u) return { ok: false, reason: 'bad_url' };
    if (!tokenOk(tk)) return { ok: false, reason: 'bad_token' };
    const sup = support();
    if (sup !== 'ok') return { ok: false, reason: sup };
    if (d.Notification.permission !== 'granted') {
      const p = await d.Notification.requestPermission();
      if (p !== 'granted') return { ok: false, reason: 'denied' };
    }
    if (!online()) return { ok: false, reason: 'offline' };
    st.url = u; st.token = tk;
    const v = await call('/vapid', null, { method: 'GET' });
    if (!v.ok || !v.data || typeof v.data.key !== 'string') return { ok: false, reason: v.status ? 'server' : 'offline' };
    const key = v.data.key;
    let sub;
    try {
      const reg = await d.navigator.serviceWorker.ready;
      if (!reg || !reg.pushManager) return { ok: false, reason: 'no_push' };
      sub = await reg.pushManager.getSubscription();
      const have = sub && sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (sub && have && !sameBytes(have, b64uToBytes(key))) { await sub.unsubscribe(); sub = null; } // server keys rotated
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
    } catch { return { ok: false, reason: 'subscribe' }; }
    const j = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
    st.sub = { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
    st.key = key;
    await save(S.url, u); await save(S.token, tk); await save(S.key, key); await save(S.sub, JSON.stringify(st.sub));
    if (testInSec > 0) {
      const r = await schedule(d.now() + testInSec * 1000, 'test');
      if (!r.ok) return { ok: false, reason: r.status === 401 ? 'token' : r.reason || 'server' };
    }
    return { ok: true, reason: 'ok' };
  }

  /** Schedule the lock-screen alert for `tag` at epoch ms `at`. Same tag replaces. title/body are ignored on purpose (privacy). */
  async function schedule(at, tag /* , title, body */) {
    await load();
    if (!configured()) return { ok: false, reason: 'off' };
    if (!TAGS.includes(tag)) return { ok: false, reason: 'tag' };
    const now = d.now(), t = Math.round(+at);
    if (!Number.isFinite(t) || t <= now + 1000 || t > now + MAX_AHEAD_MS) return { ok: false, reason: 'at' };
    if (!online()) return { ok: false, reason: 'offline' };
    const r = await call('/schedule', { sub: st.sub, at: t, tag });
    return r.ok ? { ok: true } : { ok: false, status: r.status, reason: r.reason || 'server' };
  }

  /** Cancel `tag` (or every pending alert when tag is omitted). */
  async function cancel(tag) {
    await load();
    if (!configured()) return { ok: false, reason: 'off' };
    if (tag !== undefined && !TAGS.includes(tag)) return { ok: false, reason: 'tag' };
    if (!online()) return { ok: false, reason: 'offline' };
    const r = await call('/cancel', tag === undefined ? { sub: st.sub } : { sub: st.sub, tag });
    return r.ok ? { ok: true } : { ok: false, status: r.status, reason: r.reason || 'server' };
  }

  /** «إيقاف ومسح»: cancel + forget on the server, unsubscribe on the device, wipe the stored settings. */
  async function disable() {
    await load();
    let server = 'skipped';
    if (configured() && online()) {
      await call('/cancel', { sub: st.sub });
      const f = await call('/forget', { sub: st.sub });
      server = f.ok ? 'forgotten' : 'failed';
    }
    try {
      const reg = d.navigator && d.navigator.serviceWorker ? await d.navigator.serviceWorker.ready : null;
      const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
      if (sub) await sub.unsubscribe(); // the endpoint dies too, so even a stale server copy can no longer reach the phone
    } catch { /* ignore */ }
    st.url = ''; st.token = ''; st.key = ''; st.sub = null;
    for (const k of Object.values(S)) await save(k, '');
    return { ok: true, server };
  }

  async function status() { await load(); return { on: configured(), url: st.url, support: support() }; }

  return { enable, schedule, cancel, disable, status, support, isOn: () => configured() };
}

// ───────── app-wide instance (bound once from main.js) ─────────
let inst = null;
/** Call once at boot with ctx (needs ctx.db). Safe to call again. */
export function initPush(ctx) {
  if (!ctx || !ctx.db) return null;
  inst = createPush({ getSecret: (n) => getSecret(ctx.db, n), setSecret: (n, v) => setSecret(ctx.db, n, v) });
  return inst;
}
const noop = async () => ({ ok: false, reason: 'off' });

// ───────── iOS shell (core/native.js): local notifications on the phone, no server, nothing leaves the device ─────────
/** Native twin of schedule(): same tags and limits, generic Arabic text per tag. */
export function nativeSchedule(at, tag, { now = Date.now(), w } = {}) {
  if (!TAGS.includes(tag)) return { ok: false, reason: 'tag' };
  const t = Math.round(+at);
  if (!Number.isFinite(t) || t <= now + 1000 || t > now + MAX_AHEAD_MS) return { ok: false, reason: 'at' };
  const txt = native.NOTE_TEXT[tag];
  return native.scheduleNotification({ id: native.noteId(tag), at: t, title: txt.title, body: txt.body }, w) ? { ok: true, native: true } : { ok: false, reason: 'off' };
}
export function nativeCancel(tag, { w } = {}) {
  if (tag !== undefined && !TAGS.includes(tag)) return { ok: false, reason: 'tag' };
  for (const t of tag === undefined ? TAGS : [tag]) native.cancelNotification(native.noteId(t), w);
  return { ok: true, native: true };
}
/** status for the shell: on = notifications allowed (the shell asks at the first schedule / from Profile). */
export async function nativeStatus(w) {
  const permission = await native.notificationStatus(w);
  return { on: permission === 'granted' || permission === 'provisional', url: '', support: 'native', native: true, permission };
}

export const schedulePush = (at, tag, title, body) => (native.isNative() ? Promise.resolve(nativeSchedule(at, tag)) : inst ? inst.schedule(at, tag, title, body) : noop());
export const cancelPush = (tag) => (native.isNative() ? Promise.resolve(nativeCancel(tag)) : inst ? inst.cancel(tag) : noop());
export const enablePush = (opts) => (native.isNative() ? noop() : inst ? inst.enable(opts) : noop());
export const disablePush = () => (native.isNative() ? noop() : inst ? inst.disable() : noop());
export const pushStatus = () => (native.isNative() ? nativeStatus() : inst ? inst.status() : Promise.resolve({ on: false, url: '', support: 'no_sw' }));
