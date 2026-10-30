// Workout UI kit: sparkline, opt-in cues (tone / TTS / notification), coach loader, coaching-content lookup.
// Everything audible or system-level is OFF by default and only runs after the user switches it on.
import { h } from './view.js';
import { TIPS, FORM_PHASES, FORM_PHASES_EN, BREATHING_CUES } from './content.js';
import { libById, findLib } from './exercises.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

/** Inline sparkline (oldest → newest values). RTL pages still read time left→right inside the svg (dir=ltr). */
export function spark(values, { w = 96, h: ht = 28, label = '', color = 'var(--pro, #BAE6FD)' } = {}) {
  const v = (values || []).filter((x) => Number.isFinite(+x)).map(Number);
  const svg = sv('svg', { viewBox: `0 0 ${w} ${ht}`, width: w, height: ht, class: 'wk-spark', role: 'img', 'aria-label': label || 'منحنى آخر الجلسات', dir: 'ltr' });
  if (v.length < 2) { svg.appendChild(sv('line', { x1: 2, y1: ht / 2, x2: w - 2, y2: ht / 2, stroke: 'currentColor', 'stroke-opacity': '.25', 'stroke-width': 2, 'stroke-linecap': 'round' })); return svg; }
  const mn = Math.min(...v), mx = Math.max(...v), span = mx - mn || 1;
  const pts = v.map((y, i) => [2 + (i * (w - 4)) / (v.length - 1), ht - 3 - ((y - mn) / span) * (ht - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  svg.appendChild(sv('path', { d: `${d} L${w - 2} ${ht} L2 ${ht} Z`, fill: color, 'fill-opacity': '.14', stroke: 'none' }));
  svg.appendChild(sv('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const [lx, ly] = pts[pts.length - 1];
  svg.appendChild(sv('circle', { cx: lx, cy: ly, r: 3, fill: color }));
  return svg;
}

// ── preferences (ctx.settings 'wk.*') ─────────────────────────
export const PREFS = Object.freeze({
  sound: { key: 'wk.sound', label: 'صوت هادي في نهاية الراحة' },
  tts: { key: 'wk.tts', label: 'تنبيه صوتي بالكلام (نهاية الراحة، المجموعة الجاية)' },
  notify: { key: 'wk.notify', label: 'إشعار لما الراحة تخلص والتطبيق في الخلفية' },
  aiTip: { key: 'wk.aiTip', label: 'نصيحة من المدرب بعد آخر مجموعة في التمرين' },
  swipe: { key: 'wk.swipe', label: 'اسحب المجموعة: يمين = تم، شمال = تراجع' },
});
export const pref = (ctx, name) => ctx.settings.get(PREFS[name]?.key || name) === true;

let audioCtx = null;
/** Soft 660 Hz tone (W44). Only when the setting is on; respects reduced motion like Solo Gym. */
export function tone(ctx) {
  if (!pref(ctx, 'sound')) return false;
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return false;
    audioCtx = audioCtx || new C();
    const a = audioCtx, o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.18, a.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.4);
    o.start(); o.stop(a.currentTime + 0.42);
    return true;
  } catch { return false; }
}
/** Arabic speech cue (W46). Only when the setting is on. */
export function speak(ctx, text) {
  if (!pref(ctx, 'tts') || !text) return false;
  try {
    const s = window.speechSynthesis; if (!s || typeof SpeechSynthesisUtterance === 'undefined') return false;
    const u = new SpeechSynthesisUtterance(String(text)); u.lang = 'ar-EG'; u.rate = 1;
    s.cancel(); s.speak(u); return true;
  } catch { return false; }
}
/** Local notification at rest end while hidden (W43). Only when on + permission granted. */
export function notifyRestEnd(ctx, body) {
  if (!pref(ctx, 'notify') || document.visibilityState === 'visible') return false;
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const opts = { body, tag: 'wk-rest', renotify: true, silent: !pref(ctx, 'sound') };
    if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then((r) => r.showNotification('الراحة خلصت', opts)).catch(() => {});
    else new Notification('الراحة خلصت', opts);
    return true;
  } catch { return false; }
}
/**
 * Phase-end alert on a locked screen for the guided timers (boxing rounds), on the rest timer's path: the page posts
 * {type:'wk-rest', at, title, options} to the service worker (public/sw.js keeps itself alive until `at`), or arms a page
 * timer when there is no SW. Same tag 'wk-rest', so it never doubles with a rest alert. Opt-in (wk.notify + permission).
 */
let phaseT = 0;
export const notifyReady = (ctx) => pref(ctx, 'notify') && typeof Notification !== 'undefined' && Notification.permission === 'granted';
export async function armPhaseNotice(ctx, { at, title, body = '', url = '#/workout' }) {
  cancelPhaseNotice();
  if (!notifyReady(ctx) || !(at > Date.now() + 500)) return false;
  const options = { body, tag: 'wk-rest', renotify: true, silent: false, vibrate: [200, 100, 200, 100, 300], timestamp: at, data: { url } };
  try {
    const reg = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.active) { reg.active.postMessage({ type: 'wk-rest', at, title, options }); return true; }
  } catch { /* fall back to the page timer */ }
  phaseT = setTimeout(() => { phaseT = 0; try { if (document.visibilityState !== 'visible') new Notification(title, options); } catch { /* best effort */ } }, at - Date.now());
  return true;
}
export function cancelPhaseNotice() {
  clearTimeout(phaseT); phaseT = 0;
  try { navigator.serviceWorker?.getRegistration?.().then((reg) => { try { reg?.active?.postMessage({ type: 'wk-rest-cancel' }); } catch { /* ignore */ } }).catch(() => {}); } catch { /* ignore */ }
}
export async function askNotifyPermission() {
  try { if (!('Notification' in window)) return 'unsupported'; if (Notification.permission === 'default') return await Notification.requestPermission(); return Notification.permission; }
  catch { return 'denied'; }
}

// ── coach (WP-Analytics api; optional) ────────────────────────
/** The coach api when it loads and an API key exists; null otherwise (AI buttons stay hidden). */
export async function loadCoach(ctx) {
  try {
    if (!String(ctx.settings.get('anthropicKey') || '').trim()) return null;
    const m = await import('../coach/api.js');
    return (m && typeof m.askCoach === 'function' && typeof m.openCoachSheet === 'function') ? m : null;
  } catch { return null; }
}

// ── coaching content lookup ───────────────────────────────────
const ENKEYS = Object.keys(FORM_PHASES_EN).sort((a, b) => b.length - a.length);
function contentKey(ex) {
  const L = (ex?.lib && libById(ex.lib)) || findLib(ex?.en || ex?.name);
  const ar = String(L?.ar || ex?.name || ex?.ar || '');
  const en = String(L?.en || ex?.en || '').toLowerCase();
  const arKeys = Object.keys(FORM_PHASES).sort((a, b) => b.length - a.length);
  return arKeys.find((k) => ar.includes(k)) || FORM_PHASES_EN[ENKEYS.find((k) => en.includes(k))] || null;
}
/** {key, tips[], form:{start, exec[{phase,cue}], cues[]}|null, breathing[]|null} */
export function coachingFor(ex) {
  const key = contentKey(ex);
  const L = (ex?.lib && libById(ex.lib)) || findLib(ex?.en || ex?.name);
  const en = String(L?.en || ex?.en || '').toLowerCase();
  const tipKey = Object.keys(TIPS).find((k) => key === k || String(L?.ar || ex?.name || '').includes(k));
  const bk = /deadlift|rdl/.test(en) ? 'Deadlift' : /squat|leg press|lunge/.test(en) ? 'Squat' : /overhead|ohp|shoulder press|arnold/.test(en) ? 'OHP'
    : /bench|press|dip|push/.test(en) ? 'Bench' : /row|pull/.test(en) ? 'Row' : /curl/.test(en) ? 'Curl' : null;
  return { key, tips: tipKey ? [...TIPS[tipKey]] : [], form: key && FORM_PHASES[key] ? FORM_PHASES[key] : null, breathing: bk ? [...BREATHING_CUES[bk]] : null };
}
/** External "how to" link: YouTube search by the English name (W34; no embed). */
export function howToUrl(ex) {
  const L = (ex?.lib && libById(ex.lib)) || findLib(ex?.en || ex?.name);
  const q = `${L?.en || ex?.en || ex?.name || ''} proper form`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

/** A switch row bound to a 'wk.*' setting. */
export function prefSwitch(ctx, name, { onChange } = {}) {
  const p = PREFS[name];
  const id = `wk-pref-${name}`;
  const input = h('input', { type: 'checkbox', id, role: 'switch', checked: pref(ctx, name) ? true : null,
    onchange: async (ev) => { const on = ev.target.checked; if (onChange) { const ok = await onChange(on); if (ok === false) { ev.target.checked = false; return; } } ctx.settings.set(p.key, on); } });
  return h('label', { class: 'wk-switch', for: id }, h('span', {}, p.label), input, h('i', { 'aria-hidden': 'true' }));
}
