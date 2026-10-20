// Progress ring / gauge (SVG). Animates fill on mount unless reduced motion.
import { reduced } from './anim.js';
const NS = 'http://www.w3.org/2000/svg';
const el = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

/**
 * ring({ value, max, color, size=72, stroke=8, track='rgba(255,255,255,.12)', gauge=false, label })
 * gauge=true draws a 270° arc gauge (hero calories). Returns an <svg>. Over max → full + data-over.
 */
export function ring({ value = 0, max = 1, color = 'var(--violet)', size = 72, stroke = 8, track = 'rgba(255,255,255,.12)', gauge = false, label = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, span = gauge ? 0.75 : 1;
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring', role: 'img', 'aria-label': label || `${Math.round(frac * 100)}%` });
  if (value > max) svg.dataset.over = '1';
  const rot = gauge ? 135 : -90;
  const common = { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', transform: `rotate(${rot} ${size / 2} ${size / 2})` };
  svg.appendChild(el('circle', { ...common, stroke: track, 'stroke-dasharray': `${c * span} ${c}` }));
  const arc = el('circle', { ...common, stroke: color, 'stroke-dasharray': `${c * span * frac} ${c}`, class: 'ring-arc' });
  svg.appendChild(arc);
  if (!reduced()) {
    arc.setAttribute('stroke-dasharray', `0 ${c}`);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      arc.style.transition = 'stroke-dasharray 1100ms cubic-bezier(.22,.9,.24,1)';
      arc.setAttribute('stroke-dasharray', `${c * span * frac} ${c}`);
    }));
  }
  return svg;
}
