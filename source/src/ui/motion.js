// Navigation motion: directional screen transitions + one-time card reveal below the fold.
// Only transform/opacity animate. Everything is skipped under reduced motion (OS setting or Profile › «قلّل الحركة»).
import { reduced } from './anim.js';

/**
 * navDir(fromRoute, toRoute, tabs) → 'left' | 'right' | null — the side the NEW view slides in from.
 * Tabs: the tab bar is visual, so in RTL the next tab sits to the left. Sub-screens push from the
 * inline-end (left in RTL) and going back to a shallower screen comes from the inline-start.
 */
export function navDir(from, to, tabs, rtl = true) {
  if (!from || !to || from === to) return null;
  const fa = from.split('/'), ta = to.split('/');
  const end = rtl ? 'left' : 'right', start = rtl ? 'right' : 'left';
  if (fa.length !== ta.length) return ta.length > fa.length ? end : start;
  if (fa[0] !== ta[0]) {
    const i = tabs.indexOf(fa[0]), j = tabs.indexOf(ta[0]);
    if (i < 0 || j < 0) return ta.length > 1 ? end : null;
    return j > i ? end : start; // tab order runs inline-start → inline-end
  }
  return end; // sibling sub-screen of the same tab
}

/** A text field has focus (iOS keyboard up) or the visual viewport is squeezed: no screen motion then. */
export function keyboardOpen() {
  const a = document.activeElement;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && !/^(checkbox|radio|button|submit|range)$/.test(a.type || '')) return true;
  const vv = window.visualViewport;
  return !!(vv && vv.height < window.innerHeight * 0.75);
}

export const motionOK = () => !reduced() && document.visibilityState !== 'hidden';

// ───────── staggered reveal (first time a card scrolls into view, once per rendered view) ─────────
const CARD = '.gl,.glass,.sheet-card,.pg-card,.pg-sec,.nu-card,.psec,.wk-card,.wk-day,.wk-tile,[data-reveal]';
let rvIO = null;
function revealIO() {
  if (rvIO) return rvIO;
  rvIO = new IntersectionObserver((entries) => {
    const hits = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    hits.forEach((e, i) => {
      rvIO.unobserve(e.target);
      e.target.style.setProperty('--rv-i', String(Math.min(i, 6)));
      e.target.classList.add('rv-in');
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
  return rvIO;
}

/**
 * Mark card-level blocks that start fully below the fold (.rv: hidden + 10px down) and reveal them on entry.
 * Anything touching the first viewport is left alone, so first paint and LCP never wait on an observer.
 */
export function revealBelowFold(view) {
  if (!view || !motionOK() || typeof IntersectionObserver !== 'function') return;
  const all = [...view.querySelectorAll(CARD)];
  const set = new Set(all);
  const fold = window.innerHeight;
  const io = revealIO();
  io.disconnect(); // only the current view is watched
  for (const el of all) {
    let p = el.parentElement, nested = false;
    while (p && p !== view) { if (set.has(p)) { nested = true; break; } p = p.parentElement; }
    if (nested || el.closest('.dock,[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.height || r.top < fold) continue;
    el.classList.add('rv');
    io.observe(el);
  }
}
