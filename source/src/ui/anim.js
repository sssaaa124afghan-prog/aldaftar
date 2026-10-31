// Motion helpers (Electric Glass Pro). All respect prefers-reduced-motion AND the in-app «قلّل الحركة» switch (html.rm).
import { isNative, haptic as nativeHaptic } from '../core/native.js';
const root = () => (typeof document !== 'undefined' ? document.documentElement : null);
export const reduced = () => {
  const r = root();
  if (r && r.classList.contains('rm')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
};

/** In-app «قلّل الحركة»: html.rm zeroes the motion tokens and turns every animation/transition off (components.css). */
export function setReduceMotion(on) { const r = root(); if (r) r.classList.toggle('rm', !!on); }

// ───────── run once an element is on screen ─────────
let io = null; const waiting = new WeakMap();
function observer() {
  if (io || typeof IntersectionObserver !== 'function') return io;
  io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const fns = waiting.get(en.target); waiting.delete(en.target); io.unobserve(en.target);
      if (fns) for (const fn of fns) { try { fn(); } catch (e) { console.warn('[anim] visible cb failed', e && e.message); } }
    }
  }, { threshold: 0.15 });
  return io;
}
/** whenVisible(el, fn): fn() the first time el is at least 15% on screen (waits a few frames for el to be attached). */
export function whenVisible(el, fn, tries = 40) {
  if (!el) return;
  if (!el.isConnected) { if (tries > 0) requestAnimationFrame(() => whenVisible(el, fn, tries - 1)); return; }
  const o = observer();
  if (!o) { fn(); return; }
  const list = waiting.get(el);
  if (list) list.push(fn); else { waiting.set(el, [fn]); o.observe(el); }
}

/** Count a number up inside el once it is on screen. Latin digits, thousands separators. format(v) overrides the text. */
export function countUp(el, to, { from = 0, dp = 0, ms = 900, format = null } = {}) {
  const f = format || ((v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  if (!el) return;
  if (reduced() || !isFinite(to)) { el.textContent = f(to || 0); return; }
  whenVisible(el, () => {
    if (reduced()) { el.textContent = f(to); return; }
    const t0 = performance.now(); const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => { const t = Math.min(1, (now - t0) / ms); el.textContent = f(from + (to - from) * ease(t)); if (t < 1) requestAnimationFrame(step); };
    el.textContent = f(from);
    requestAnimationFrame(step);
  });
}

/** Small press/pop feedback on an element (used for ✓, PR, add). */
export function pop(el, cls = 'is-pop') {
  if (!el || reduced()) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

// ───────── haptics ─────────
// Android/Chromium: navigator.vibrate. iOS Safari has no vibrate, but since iOS 18 toggling an
// <input type="checkbox" switch> through its label plays the system «tick». Profile › «اهتزاز خفيف» turns both off.
let hapticsOn = true;
export function setHaptics(on) { hapticsOn = on !== false; }
export const hapticsEnabled = () => hapticsOn;
const canVib = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
function iosTick() {
  if (typeof document === 'undefined') return;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
  label.appendChild(input);
  const stop = (e) => e.stopPropagation(); // never reach document-level click/change listeners
  for (const t of ['click', 'change', 'input']) { label.addEventListener(t, stop); input.addEventListener(t, stop); }
  document.head.appendChild(label);
  try { label.click(); } finally { label.remove(); }
}
/** Light haptic tick (after a user gesture). ms is used where vibrate exists; double=true → two ticks (PR). */
export function haptic(ms = 12, { double = false } = {}) {
  if (!hapticsOn) return;
  if (isNative()) { nativeHaptic(double ? 'success' : ms >= 40 ? 'medium' : 'light'); return; } // iOS shell: Taptic Engine
  try {
    if (canVib()) {
      if (!navigator.userActivation || navigator.userActivation.hasBeenActive) navigator.vibrate(double ? [ms, 70, ms] : ms);
      return;
    }
    iosTick();
    if (double) setTimeout(() => { try { iosTick(); } catch (_) { /* optional */ } }, 90);
  } catch (_) { /* optional */ }
}
