// Motion helpers (Electric Glass Pro). All respect prefers-reduced-motion.
export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count a number up inside el. Latin digits, thousands separators. */
export function countUp(el, to, { from = 0, dp = 0, ms = 900 } = {}) {
  const f = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (!el) return;
  if (reduced() || !isFinite(to)) { el.textContent = f(to || 0); return; }
  const t0 = performance.now(); const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => { const t = Math.min(1, (now - t0) / ms); el.textContent = f(from + (to - from) * ease(t)); if (t < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/** Small press/pop feedback on an element (used for ✓, PR, add). */
export function pop(el, cls = 'is-pop') {
  if (!el || reduced()) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

/** Light haptic tick if supported and after a user gesture. */
export function haptic(ms = 12) { try { if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(ms); } catch (_) {} }
