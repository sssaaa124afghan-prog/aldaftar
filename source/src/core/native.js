// Native iOS shell bridge (ios-app/: SwiftUI + WKWebView, «المدرب»).
// The shell exposes window.webkit.messageHandlers.native and injects window.NativeApp at document start.
// Everything here is a no-op on the web, so the PWA keeps its own paths (Web Push, wake lock, <a download>).
//
// Protocol (one JSON object per postMessage; `cb` is set when JS waits for an answer, the shell answers with
// window.NativeApp.__resolve(cb, value)):
//   {type:'scheduleNotification', id, at, title, body}   local notification at epoch ms `at` (same id replaces)
//   {type:'cancelNotification', id}
//   {type:'requestNotificationPermission', cb}            → 'granted' | 'denied' | 'provisional' | 'notDetermined'
//   {type:'notificationStatus', cb}                       → same values, never prompts
//   {type:'haptic', kind}                                 'light'|'medium'|'heavy'|'rigid'|'soft'|'selection'|'success'|'warning'|'error'
//   {type:'keepAwake', on}                                UIApplication.isIdleTimerDisabled
//   {type:'share', text} | {type:'share', filename, dataBase64, mime}   UIActivityViewController (backup export)

const win = () => (typeof window !== 'undefined' ? window : undefined);
const handler = (w = win()) => {
  try { const h = w && w.webkit && w.webkit.messageHandlers && w.webkit.messageHandlers.native; return h && typeof h.postMessage === 'function' ? h : null; } catch { return null; }
};

/** True inside the iOS shell (the bridge exists). */
export const isNative = (w = win()) => !!handler(w);

/** Fire-and-forget message. Returns false when there is no bridge. Never throws. */
export function post(type, payload = {}, w = win()) {
  const h = handler(w);
  if (!h) return false;
  try { h.postMessage({ ...payload, type }); return true; } catch { return false; }
}

// ───────── request/answer (the shell may have injected NativeApp already; reuse its table) ─────────
function helper(w = win()) {
  if (!w) return null;
  if (!w.NativeApp) w.NativeApp = {};
  const N = w.NativeApp;
  if (!N.__pending) N.__pending = {};
  if (typeof N.__resolve !== 'function') N.__resolve = (id, value) => { const f = N.__pending[id]; if (f) { delete N.__pending[id]; f(value); } };
  return N;
}
let seq = 0;
/** Ask the shell and wait for its answer (resolves `fallback` after `ms` if it never answers). */
export function ask(type, payload = {}, { ms = 4000, fallback = 'unknown' } = {}, w = win()) {
  if (!handler(w)) return Promise.resolve(fallback);
  const N = helper(w);
  return new Promise((resolve) => {
    const cb = `c${Date.now().toString(36)}${(++seq).toString(36)}`;
    const t = setTimeout(() => { delete N.__pending[cb]; resolve(fallback); }, ms);
    N.__pending[cb] = (v) => { clearTimeout(t); resolve(v); };
    if (!post(type, { ...payload, cb }, w)) { clearTimeout(t); delete N.__pending[cb]; resolve(fallback); }
  });
}

// ───────── notifications ─────────
/** Generic Arabic texts per timer tag (same privacy rule as the push Worker: no exercise names leave the page). */
export const NOTE_TEXT = Object.freeze({
  rest: { title: 'الراحة خلصت', body: 'يلا على المجموعة اللي بعدها 💪' },
  box: { title: 'الجولة خلصت', body: 'خد نفسك — الجولة اللي بعدها قرّبت.' },
  test: { title: 'تنبيه تجربة', body: 'التنبيهات شغالة والشاشة مقفولة ✓' },
});
export const noteId = (tag) => `fc-${tag}`;

export function scheduleNotification({ id, at, title, body } = {}, w) {
  const t = Math.round(+at);
  if (!id || !Number.isFinite(t)) return false;
  return post('scheduleNotification', { id: String(id), at: t, title: String(title || ''), body: String(body || '') }, w);
}
export const cancelNotification = (id, w) => (id ? post('cancelNotification', { id: String(id) }, w) : false);
export const requestNotificationPermission = (w) => ask('requestNotificationPermission', {}, { ms: 60000 }, w);
export const notificationStatus = (w) => ask('notificationStatus', {}, { ms: 2500 }, w);

// ───────── device ─────────
export const HAPTICS = Object.freeze(['light', 'medium', 'heavy', 'rigid', 'soft', 'selection', 'success', 'warning', 'error']);
export const haptic = (kind = 'light', w) => post('haptic', { kind: HAPTICS.includes(kind) ? kind : 'light' }, w);
/** A web vibrate pattern → the closest native haptic: long timer-end buzz → warning, PR double tick → success. */
export function hapticFor(pattern) {
  const arr = Array.isArray(pattern) ? pattern : [pattern];
  const total = arr.reduce((a, v) => a + (+v || 0), 0);
  if (arr.length >= 4 || total >= 400) return 'warning';
  if (arr.length > 1) return 'success';
  const ms = +arr[0] || 12;
  return ms >= 40 ? 'medium' : 'light';
}
export const keepAwake = (on, w) => post('keepAwake', { on: !!on }, w);

/** Share sheet: {text} or a file {filename, dataBase64, mime}. */
export function share(opts = {}, w) {
  if (opts.dataBase64 && opts.filename) return post('share', { filename: String(opts.filename), dataBase64: String(opts.dataBase64), mime: String(opts.mime || 'application/octet-stream') }, w);
  if (opts.text) return post('share', { text: String(opts.text) }, w);
  return false;
}
/** UTF-8 string → base64 (backup JSON has Arabic text). */
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(String(str));
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Detailed notification settings from the shell (banner / lock screen / Notification Center / scheduled summary). */
export async function notificationDetails(w) {
  const v = await ask('notificationDetails', {}, { ms: 2500, fallback: '' }, w);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

// ───────── Live Activity: Dynamic Island + lock screen (iOS 17+, the shell's widget extension) ─────────
// state = {kind:'rest'|'work'|'box'|'boxRest', title, subtitle, endsAt(ms), startedAt(ms), total(s), paused, pausedLeft(s), controls, rid}
// Stays on the phone (ActivityKit is local), so names may show. null = end the activity.
let lastLive = null;
const liveKey = (s) => JSON.stringify({ ...s, endsAt: 0 });
export function liveTimer(state, w) {
  if (!handler(w)) return false;
  if (!state) {
    if (lastLive === 'end') return false;
    lastLive = 'end';
    return post('liveTimerEnd', {}, w);
  }
  const s = {
    kind: String(state.kind || 'work'), title: String(state.title || ''), subtitle: String(state.subtitle || ''),
    endsAt: Math.round(+state.endsAt || 0), startedAt: Math.round(+state.startedAt || Date.now()), total: Math.max(0, +state.total || 0),
    paused: !!state.paused, pausedLeft: Math.max(0, +state.pausedLeft || 0), controls: !!state.controls, rid: String(state.rid || ''),
  };
  // same state with an end time within 1.5 s → nothing to send (callers may call every tick)
  if (lastLive && lastLive !== 'end' && lastLive.key === liveKey(s) && Math.abs(lastLive.endsAt - s.endsAt) < 1500) return false;
  lastLive = { key: liveKey(s), endsAt: s.endsAt };
  return post('liveTimer', { state: s }, w);
}
/** Dynamic Island buttons (+30 ث / وقّف / تخطّي) → fn(state) with the new absolute rest state. Returns an unsubscribe. */
export function onIslandAction(fn, w = win()) {
  if (!handler(w)) return () => {};
  const N = helper(w);
  const f = (json) => { try { const s = typeof json === 'string' ? JSON.parse(json) : json; if (s) fn(s); } catch { /* ignore */ } };
  N.__island = f;
  return () => { if (N.__island === f) delete N.__island; };
}
/** A button pressed while the app slept: the shell keeps the latest state until the page takes it. */
export async function takeIslandAction(w) {
  const v = await ask('timerTake', {}, { ms: 1500, fallback: '' }, w);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
