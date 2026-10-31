// Shared alert system: synthesized cue sounds (no asset files), an <audio> fallback, haptics, Arabic speech,
// wall-clock timer cues with catch-up, the Screen Wake Lock, and the platform probe for notifications.
//
// Why this exists (bug «مفيش أصوات للتنبيه وحتى لما الوقت بيخلص مفيش تنبيه», iPhone):
//  - the rest tone was opt-in (wk.sound, default off) → silence by default;
//  - tone() created its AudioContext inside a setInterval callback (no user gesture) → iOS keeps it «suspended» forever;
//  - nothing resumed WebAudio after the page came back from the background (iOS suspends it);
//  - iOS has no navigator.vibrate, and the switch-tick haptic only plays inside a tap, so the timer-end buzz was silent;
//  - iOS Safari tabs have no Notification API, and a locked home-screen PWA is frozen (page + service worker),
//    so the SW setTimeout alert never ran. Only a real Web Push wakes a locked iPhone (see council/alerts.md).
// What works on iPhone: screen on + app open → sound, haptic tick, banner; screen locked → the alert fires the moment
// he unlocks (catch-up from the wall-clock end time). The wake lock keeps the screen on during a session (iOS 18.4+ PWA).
import { haptic } from '../ui/anim.js';
import * as native from './native.js';

// ───────── settings (bound once from main.js; defaults when unset) ─────────
let read = () => undefined;
export const KEYS = Object.freeze({ sound: 'alerts.sound', volume: 'alerts.volume', voice: 'alerts.voice', vibrate: 'ui.haptics', wake: 'wk.wakeLock' });
const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
export const soundOn = () => read(KEYS.sound) !== false;
export const volume = () => Math.max(0, Math.min(1, num(read(KEYS.volume), 0.8)));
export const voiceOn = () => read(KEYS.voice) === true;
export const vibrateOn = () => read(KEYS.vibrate) !== false;
export const wakeOn = () => read(KEYS.wake) !== false;

/** Bind to ctx.settings and arm the one-time audio unlock. Safe to call more than once. */
export function initAlerts(settings) {
  if (settings && typeof settings.get === 'function') read = (k) => settings.get(k);
  installUnlock();
}

// ───────── cue table (pure; shared by WebAudio and the WAV fallback) ─────────
// note: {t: start s, d: length s, f: Hz, g: gain 0..1, w: 'sine'|'triangle'|'square'|'bell'|'noise'}
const beep = (t, f, d = 0.14, g = 0.5, w = 'sine') => ({ t, d, f, g, w });
const bellAt = (t, g = 0.55) => ({ t, d: 1.4, f: 820, g, w: 'bell' });
export const CUES = Object.freeze({
  restEnd: [beep(0, 880, 0.16), beep(0.24, 880, 0.16), beep(0.48, 1175, 0.32)], // triple beep, last one higher
  warn: [beep(0, 1320, 0.05, 0.3, 'triangle')], // 10 s left: one short tick
  count: [beep(0, 660, 0.12, 0.45)], // one beep of the 3-2-1 countdown
  go: [beep(0, 990, 0.3, 0.5)],
  bell: [bellAt(0)], // round start
  bellEnd: [bellAt(0), bellAt(0.22), bellAt(0.44)], // round end
  bellSoft: [bellAt(0, 0.22)], // other phases
  clap: [{ t: 0, d: 0.09, f: 1400, g: 0.8, w: 'noise' }, { t: 0.16, d: 0.09, f: 1400, g: 0.8, w: 'noise' }], // boxing 10 s
  set: [beep(0, 1568, 0.06, 0.25, 'triangle')], // set logged
  pr: [beep(0, 523, 0.12, 0.4, 'triangle'), beep(0.12, 659, 0.12, 0.4, 'triangle'), beep(0.24, 784, 0.12, 0.4, 'triangle'), beep(0.36, 1047, 0.4, 0.45, 'triangle')],
  hold: [beep(0, 740, 0.1, 0.35)], // kegel / iso: squeeze
  relax: [beep(0, 494, 0.12, 0.3)], // kegel / iso: let go
  phase: [beep(0, 660, 0.12, 0.4), beep(0.16, 880, 0.18, 0.4)], // heart blocks, recovery stations
  done: [beep(0, 784, 0.14), beep(0.2, 988, 0.14), beep(0.4, 1319, 0.36)],
  test: [beep(0, 880, 0.16), beep(0.24, 880, 0.16), beep(0.48, 1175, 0.32)],
});
export const cueLength = (kind) => (CUES[kind] || []).reduce((m, n) => Math.max(m, n.t + n.d), 0);
const BELL_PARTIALS = [[1, 1], [2.32, 0.5], [3.98, 0.28], [5.4, 0.16]];

// ───────── WebAudio ─────────
let actx = null, unlocked = false;
const AC = () => (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
export function audioCtx() {
  if (actx) return actx;
  const C = AC(); if (!C) return null;
  try { actx = new C(); actx.onstatechange = () => { if (actx.state !== 'running') installUnlock(); }; } catch { actx = null; }
  return actx;
}
const running = () => !!actx && actx.state === 'running';

function synth(a, notes, when, vol) {
  let master = null;
  try { master = a.createGain(); master.gain.value = vol; master.connect(a.destination); } catch { return false; }
  for (const n of notes) {
    const t = when + n.t;
    if (n.w === 'noise') {
      const len = Math.max(1, Math.floor(a.sampleRate * n.d)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = a.createBufferSource(), bp = a.createBiquadFilter(), v = a.createGain();
      src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = n.f; bp.Q.value = 0.9; v.gain.value = n.g;
      src.connect(bp); bp.connect(v); v.connect(master); src.start(t);
      continue;
    }
    const parts = n.w === 'bell' ? BELL_PARTIALS : [[1, 1]];
    for (const [r, pg] of parts) {
      const o = a.createOscillator(), v = a.createGain();
      o.type = n.w === 'bell' ? 'sine' : n.w; o.frequency.value = n.f * r;
      const end = n.w === 'bell' ? t + n.d / Math.sqrt(r) : t + n.d;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.g * pg), t + 0.008);
      if (n.w !== 'bell') v.gain.setValueAtTime(Math.max(0.0002, n.g * pg), Math.max(t + 0.01, end - 0.03));
      v.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(v); v.connect(master); o.start(t); o.stop(end + 0.02);
    }
  }
  return true;
}

// ───────── WAV fallback (an <audio> element unlocked by the first tap) ─────────
/** 8-bit mono PCM WAV bytes of a cue (pure; used for the fallback and in tests). */
export function renderWav(notes, { rate = 16000, vol = 0.8 } = {}) {
  const dur = notes.reduce((m, n) => Math.max(m, n.t + n.d), 0) + 0.05;
  const len = Math.max(1, Math.ceil(dur * rate));
  const pcm = new Float32Array(len);
  for (const n of notes) {
    const s0 = Math.floor(n.t * rate);
    const parts = n.w === 'bell' ? BELL_PARTIALS : n.w === 'noise' ? [] : [[1, 1]];
    const nd = Math.ceil(n.d * rate);
    for (let i = 0; i < nd && s0 + i < len; i++) {
      const x = i / rate, env = n.w === 'bell' ? Math.exp(-4 * x / n.d) : Math.min(1, i / 80, (nd - i) / 200);
      let v = 0;
      if (n.w === 'noise') v = (Math.random() * 2 - 1) * Math.pow(1 - i / nd, 3);
      for (const [r, pg] of parts) {
        const ph = 2 * Math.PI * n.f * r * x;
        const w = n.w === 'square' ? Math.sign(Math.sin(ph)) : n.w === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
        v += w * pg;
      }
      pcm[s0 + i] += v * n.g * env;
    }
  }
  const out = new Uint8Array(44 + len), dv = new DataView(out.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + len, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); str(36, 'data'); dv.setUint32(40, len, true);
  for (let i = 0; i < len; i++) out[44 + i] = Math.max(0, Math.min(255, Math.round(128 + 127 * Math.max(-1, Math.min(1, pcm[i] * vol)))));
  return out;
}
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
export const wavDataUri = (notes, opts) => `data:audio/wav;base64,${b64(renderWav(notes, opts))}`;
const SILENT = () => wavDataUri([{ t: 0, d: 0.05, f: 0, g: 0, w: 'sine' }], { rate: 8000 });
let el = null; const uriCache = new Map(); const nativeSent = new Set();
function fallbackEl() {
  if (el || typeof Audio === 'undefined') return el;
  try { el = new Audio(); el.preload = 'auto'; el.setAttribute('playsinline', ''); } catch { el = null; }
  return el;
}
function playFallback(kind, vol) {
  const a = fallbackEl(); if (!a) return false;
  try {
    const key = `${kind}:${Math.round(vol * 10)}`;
    if (!uriCache.has(key)) uriCache.set(key, wavDataUri(CUES[kind], { vol }));
    a.src = uriCache.get(key); a.currentTime = 0;
    const p = a.play(); if (p && p.catch) p.catch(() => {});
    return true;
  } catch { return false; }
}

// ───────── unlock on the first tap (re-armed whenever iOS suspends the context) ─────────
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'];
let unlockArmed = false;
function onGesture() {
  unlock();
  if (wantAwake && !sentinel) acquireWake();
  if (running()) disarm();
}
function disarm() {
  if (!unlockArmed || typeof document === 'undefined') return;
  unlockArmed = false;
  for (const t of UNLOCK_EVENTS) document.removeEventListener(t, onGesture, true);
}
export function installUnlock() {
  if (typeof document === 'undefined') return;
  if (!unlockArmed) { unlockArmed = true; for (const t of UNLOCK_EVENTS) document.addEventListener(t, onGesture, { capture: true, passive: true }); }
  if (!installUnlock.vis) {
    installUnlock.vis = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (actx && actx.state !== 'running') { try { const p = actx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* next tap */ } installUnlock(); }
      if (wantAwake && !sentinel) acquireWake();
    });
  }
}
/** Call inside a tap: creates/resumes the AudioContext, plays one silent sample (iOS), primes <audio> and speech. */
export function unlock() {
  if (native.isNative()) { // iOS shell: cues play natively (AVAudioPlayer) → WebKit never touches the audio session / Now Playing
    if (!unlocked) { unlocked = true; try { if (voiceOn() && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } } catch { /* ignore */ } }
    return true;
  }
  const a = audioCtx();
  if (a) {
    try { if (a.state !== 'running') { const p = a.resume(); if (p && p.catch) p.catch(() => {}); } } catch { /* ignore */ }
    try { const s = a.createBufferSource(); s.buffer = a.createBuffer(1, 1, 22050); s.connect(a.destination); s.start(0); } catch { /* ignore */ }
  }
  if (!unlocked) {
    unlocked = true;
    const e = fallbackEl();
    if (e) { try { e.src = SILENT(); const p = e.play(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
    try { if (voiceOn() && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } } catch { /* ignore */ }
  }
  return running();
}

// ───────── public: play a cue ─────────
/** Play a cue now (or `delay` seconds from now). → 'webaudio' | 'html' | false. Never throws. */
export function cue(kind, { delay = 0, force = false } = {}) {
  if (!CUES[kind] || (!force && !soundOn())) return false;
  const vol = volume();
  if (vol <= 0) return false;
  let via = false;
  if (native.isNative()) {
    const key = `${kind}:${Math.round(vol * 10)}`;
    let wav;
    if (!nativeSent.has(key)) { wav = b64(renderWav(CUES[kind], { vol })); nativeSent.add(key); }
    via = native.playSound(key, wav, Math.max(0, delay)) ? 'native' : false;
    try { window.dispatchEvent(new CustomEvent('fc:cue', { detail: { kind, delay, via } })); } catch { /* ignore */ }
    return via;
  }
  const a = audioCtx();
  if (a && a.state !== 'running') { try { const p = a.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  if (a && a.state === 'running') via = synth(a, CUES[kind], a.currentTime + 0.02 + Math.max(0, delay), vol) ? 'webaudio' : false;
  if (!via) {
    if (delay > 0.05) { setTimeout(() => cue(kind, { force }), delay * 1000); via = 'html'; }
    else via = playFallback(kind, vol) ? 'html' : false;
  }
  try { window.dispatchEvent(new CustomEvent('fc:cue', { detail: { kind, delay, via } })); } catch { /* ignore */ }
  return via;
}

/** Haptic: Android vibrate pattern / iOS switch tick (only plays near a tap). Off with «اهتزاز». */
export function buzz(pattern = 12) {
  if (!vibrateOn()) return false;
  const arr = Array.isArray(pattern) ? pattern : [pattern];
  if (native.isNative()) return native.haptic(native.hapticFor(arr)); // iOS shell: real Taptic Engine (UIFeedbackGenerator)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      if (!navigator.userActivation || navigator.userActivation.hasBeenActive) navigator.vibrate(arr.length === 1 ? arr[0] : arr);
      return true;
    }
  } catch { /* fall through */ }
  haptic(arr[0] || 12, { double: arr.length > 1 });
  return true;
}

/** Arabic speech (opt-in «صوت بالكلام»). */
export function say(text, { force = false } = {}) {
  if (!text || (!force && !voiceOn())) return false;
  try {
    const s = window.speechSynthesis; if (!s || typeof SpeechSynthesisUtterance === 'undefined') return false;
    const u = new SpeechSynthesisUtterance(String(text));
    const vs = (s.getVoices && s.getVoices()) || [];
    const v = vs.find((x) => /^ar[-_]EG/i.test(x.lang)) || vs.find((x) => /^ar/i.test(x.lang));
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'ar-EG'; u.rate = 1; u.volume = Math.max(0.2, volume());
    s.cancel(); s.speak(u); return true;
  } catch { return false; }
}

/** One call for a timer moment: sound + haptic (+ speech). */
export function alertNow(kind, { pattern = null, speech = '' } = {}) {
  const via = cue(kind);
  buzz(pattern || (kind === 'restEnd' || kind === 'bellEnd' || kind === 'done' ? [200, 100, 200, 100, 300] : kind === 'pr' ? [30, 70, 30] : 40));
  if (speech) say(speech);
  return via;
}

// ───────── wall-clock timer cues (pure) ─────────
/**
 * Which cues are due for a countdown that ends at `endsAt` (ms), given what already fired. Never counts ticks:
 * every call recomputes from the clock, so a frozen page catches up on the first call after it wakes.
 * state: {endsAt, total (s), fired:{}}. → {events:[{kind, delay?}], left (s), late (ms), catchUp (bool)}
 */
export function timerCues(state, now = Date.now(), { warnAt = 10, count = 3, minWarnTotal = 20, lateMs = 1500 } = {}) {
  const f = state.fired || (state.fired = {});
  const leftMs = state.endsAt - now;
  const out = { events: [], left: Math.max(0, Math.ceil(leftMs / 1000)), late: Math.max(0, -leftMs), catchUp: false };
  if (leftMs <= 0) {
    if (!f.end) { f.end = f.warn = f.count = true; out.events.push({ kind: 'restEnd' }); out.catchUp = -leftMs > lateMs; }
    return out;
  }
  if (count && !f.count && leftMs <= count * 1000 + 200) {
    f.count = f.warn = true;
    for (let s = count; s >= 1; s--) { const d = (leftMs - s * 1000) / 1000; if (d >= -0.15) out.events.push({ kind: 'count', delay: Math.max(0, d) }); }
  } else if (!f.warn && (state.total || 0) > minWarnTotal && leftMs <= warnAt * 1000 && leftMs > count * 1000 + 200) {
    f.warn = true; out.events.push({ kind: 'warn' });
  }
  return out;
}
/** «الراحة خلصت من X ث / د» */
export function lateText(lateMs, what = 'الراحة') {
  const s = Math.round(lateMs / 1000);
  if (s < 60) return `${what} خلصت من ${s} ث`;
  const m = Math.floor(s / 60), r = s % 60;
  return `${what} خلصت من ${m} د${r ? ` و${r} ث` : ''}`;
}

// ───────── platform probe (pure on a window-like object) ─────────
export function alertEnv(w = typeof window !== 'undefined' ? window : undefined) {
  const nav = (w && w.navigator) || {};
  const ua = String(nav.userAgent || '');
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1);
  let standalone = nav.standalone === true;
  try { standalone = standalone || !!(w && w.matchMedia && w.matchMedia('(display-mode: standalone)').matches); } catch { /* ignore */ }
  const N = w && w.Notification;
  const isApp = native.isNative(w); // iOS shell: local notifications through the bridge, no Web Push / SW
  const notify = !!N;
  const permission = notify ? String(N.permission || 'default') : 'unsupported';
  return {
    ios, standalone, notify, permission, native: isApp,
    wakeLock: !!(nav.wakeLock && typeof nav.wakeLock.request === 'function'),
    // background alerts from the SW timer only work where the page/SW keep running: Android & desktop, never iOS
    bgAlerts: notify && !ios && !isApp,
    canAsk: notify && permission === 'default' && !ios && !isApp,
  };
}

// ───────── Screen Wake Lock during a session (re-acquired when the page comes back) ─────────
let wantAwake = false, sentinel = null, owner = null;
async function acquireWake() {
  if (native.isNative()) return false;
  if (!wantAwake || sentinel || !wakeOn()) return false;
  try {
    if (typeof navigator === 'undefined' || !navigator.wakeLock || document.visibilityState !== 'visible') return false;
    const s = await navigator.wakeLock.request('screen');
    if (!wantAwake) { try { await s.release(); } catch { /* ignore */ } return false; }
    sentinel = s;
    s.addEventListener?.('release', () => { if (sentinel === s) sentinel = null; });
    return true;
  } catch { sentinel = null; installUnlock(); return false; }
}
/** keepAwake(true, 'session') while a workout/rest/boxing timer runs; keepAwake(false, 'session') on leave. */
let nativeAwake = false;
function setNativeAwake(on) { if (nativeAwake === on) return; nativeAwake = on; native.keepAwake(on); }
export function keepAwake(on, who = 'x') {
  if (native.isNative()) { // iOS shell: UIApplication.isIdleTimerDisabled instead of the Screen Wake Lock
    if (on) { wantAwake = true; owner = who; installUnlock(); setNativeAwake(wakeOn()); return Promise.resolve(nativeAwake); }
    if (owner !== who && owner !== null) return Promise.resolve(false);
    wantAwake = false; owner = null; setNativeAwake(false);
    return Promise.resolve(true);
  }
  if (on) { wantAwake = true; owner = who; installUnlock(); return acquireWake(); }
  if (owner !== who && owner !== null) return Promise.resolve(false);
  wantAwake = false; owner = null;
  const s = sentinel; sentinel = null;
  if (s) { try { const p = s.release(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  return Promise.resolve(true);
}
export const awake = () => !!sentinel || nativeAwake;
/** Settings change: drop or re-take the lock. */
export function refreshWake() {
  if (native.isNative()) { setNativeAwake(wakeOn() && wantAwake); return; } if (!wakeOn() && sentinel) { const s = sentinel; sentinel = null; try { s.release(); } catch { /* ignore */ } } else if (wakeOn() && wantAwake) acquireWake(); }
