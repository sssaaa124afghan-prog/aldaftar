// Inline-SVG charts (shared helper, docs/parity.md §11 rule 4). RTL time: oldest on the RIGHT, newest on the LEFT.
// Line draws in once (pathLength 100 + CSS), bars grow; both are off under prefers-reduced-motion (progress.css).
// Text labels live in HTML (≥ 12 px), not inside the scaled SVG.
import { h } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { diffDays, parseDayKey } from '../../core/date.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, String(v)); if (parent) parent.appendChild(e); return e; };
let gid = 0;
const MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const dm = (day) => { const d = parseDayKey(day); return `${d.getDate()} ${MON[d.getMonth()]}`; };
export const monthOf = (day) => MON[parseDayKey(day).getMonth()];

/** Pure geometry for a time series (exported for tests). x: oldest → right. */
export function lineGeometry(points, { W = 300, H = 120, pad = 8, min: fmin, max: fmax } = {}) {
  if (!points.length) return { pts: [], d: '', min: 0, max: 0 };
  const vs = points.map((p) => p.v);
  let min = fmin ?? Math.min(...vs), max = fmax ?? Math.max(...vs);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const span = Math.max(1, diffDays(points[0].day, points[points.length - 1].day));
  const pts = points.map((p) => ({ ...p,
    x: points.length === 1 ? W / 2 : Math.round((W - pad - (diffDays(points[0].day, p.day) / span) * (W - 2 * pad)) * 10) / 10,
    y: Math.round((pad + (1 - (p.v - min) / (max - min)) * (H - 2 * pad)) * 10) / 10 }));
  return { pts, d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '), min, max };
}

/**
 * lineChart({points:[{day,v}], color, area, dots, fmtV, label, unit, band:{lo,hi}, extra:[{points,color,dash}]}) → <figure>
 */
export function lineChart({ points, color = 'var(--pro)', area = true, dots = false, fmtV = (v) => fmt(v, { dp: 1 }), label = '', unit = '', band = null, extra = [], H = 120 }) {
  const W = 300; const id = `lg${++gid}`;
  const all = [...points, ...extra.flatMap((e) => e.points)];
  const vs = all.map((p) => p.v).concat(band ? [band.lo, band.hi] : []);
  const min = Math.min(...vs), max = Math.max(...vs);
  const pad = (max - min) * 0.12 || 1;
  const g = lineGeometry(points, { W, H, min: min - pad, max: max + pad });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pg-svg', role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  svg.style.setProperty('--c', color);
  const defs = s('defs', {}, svg);
  const lg = s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  s('stop', { offset: 0, 'stop-color': color, 'stop-opacity': 0.35 }, lg); s('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 }, lg);
  for (const f of [0.25, 0.5, 0.75]) s('line', { x1: 0, x2: W, y1: H * f, y2: H * f, class: 'pg-grid' }, svg);
  if (band) {
    const yb = (v) => 8 + (1 - (v - (min - pad)) / ((max + pad) - (min - pad))) * (H - 16);
    s('rect', { x: 0, width: W, y: yb(band.hi), height: Math.max(1, yb(band.lo) - yb(band.hi)), class: 'pg-band-r' }, svg);
  }
  for (const e of extra) {
    const ge = lineGeometry(e.points, { W, H, min: min - pad, max: max + pad });
    if (ge.pts.length > 1) s('path', { d: ge.d, class: 'pg-line2', stroke: e.color || 'var(--mu-2)', 'stroke-dasharray': e.dash || null }, svg);
  }
  if (g.pts.length > 1) {
    if (area) s('path', { d: `${g.d} L${g.pts[g.pts.length - 1].x} ${H} L${g.pts[0].x} ${H} Z`, fill: `url(#${id})`, class: 'pg-area' }, svg);
    s('path', { d: g.d, class: 'pg-line', pathLength: 100, stroke: color }, svg);
  }
  if (dots) for (const p of g.pts) s('circle', { cx: p.x, cy: p.y, r: 2.6, class: 'pg-pt', fill: color }, svg);
  const lastP = g.pts[g.pts.length - 1];
  if (lastP) { s('circle', { cx: lastP.x, cy: lastP.y, r: 4.5, class: 'pg-end', stroke: color }, svg); }
  const fig = h('figure', { class: 'pg-fig' },
    h('div', { class: 'pg-yl', 'aria-hidden': 'true' }, h('span', { class: 'num' }, fmtV(max)), h('span', { class: 'num' }, fmtV(min))),
    svg,
    xLabels(points.map((p) => p.day)));
  if (unit) fig.dataset.unit = unit;
  return fig;
}

/** Up to 4 evenly spaced date labels; HTML row in RTL already puts the first (oldest) on the right. */
export function xLabels(days) {
  if (!days.length) return h('div', { class: 'pg-xl' });
  const n = Math.min(4, days.length);
  const idx = n === 1 ? [0] : Array.from({ length: n }, (_, i) => Math.round((i * (days.length - 1)) / (n - 1)));
  return h('div', { class: 'pg-xl', 'aria-hidden': 'true' }, ...[...new Set(idx)].map((i) => h('span', {}, dm(days[i]))));
}

/** Glowing columns: cols [{label, v, sub?, tone?}], lines [values] dashed guides. RTL: first col on the right. */
export function columns(cols, { max, lines = [], label = '', fmtV = (v) => fmt(v), unitLabel = '' } = {}) {
  const top = Math.max(1, max ?? Math.max(...cols.map((c) => c.v), ...lines));
  const plot = h('div', { class: 'pg-plot', 'aria-hidden': 'true' });
  for (const l of lines) plot.appendChild(h('i', { class: 'pg-guide', style: { bottom: `${(l / top) * 82}%` } }));
  cols.forEach((c, i) => {
    plot.appendChild(h('div', { class: `pg-col${c.tone ? ` t-${c.tone}` : ''}` },
      h('b', { class: 'num' }, c.v ? fmtV(c.v) : ''),
      h('i', { style: { height: `${Math.max(c.v ? 3 : 0, (c.v / top) * 82)}%`, animationDelay: `${i * 50}ms` } })));
  });
  return h('div', { class: 'pg-cols', role: 'img', 'aria-label': label || cols.map((c) => `${c.label} ${fmtV(c.v)}${unitLabel}`).join('، ') },
    plot, h('div', { class: 'pg-clabels', 'aria-hidden': 'true' }, ...cols.map((c) => h('span', {}, c.label))));
}

/** Dual chart: bars (volume per week) + line (weight avg) on one time axis. */
export function dualChart({ bars, line, label }) {
  const W = 300, H = 120;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pg-svg', role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  const bmax = Math.max(1, ...bars.map((b) => b.v));
  const bw = W / bars.length;
  bars.forEach((b, i) => {
    const hh = (b.v / bmax) * (H - 16);
    s('rect', { x: W - (i + 1) * bw + bw * 0.22, width: bw * 0.56, y: H - hh, height: hh, rx: 4, class: 'pg-dbar', style: `animation-delay:${i * 40}ms` }, svg);
  });
  if (line.length > 1) {
    const first = bars[0].day; const last = bars[bars.length - 1].day;
    const span = Math.max(1, diffDays(first, last) + 7);
    const vs = line.map((p) => p.v); const mn = Math.min(...vs) - 0.5, mx = Math.max(...vs) + 0.5;
    const pts = line.filter((p) => p.day >= first).map((p) => ({ x: W - (diffDays(first, p.day) / span) * W, y: 8 + (1 - (p.v - mn) / (mx - mn)) * (H - 24) }));
    if (pts.length > 1) s('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x)} ${Math.round(p.y)}`).join(' '), class: 'pg-line', pathLength: 100, stroke: 'var(--fat)' }, svg);
  }
  return h('figure', { class: 'pg-fig' }, svg, xLabels(bars.map((b) => b.day)));
}

/** Scatter (sleep vs performance). */
export function scatter(points, { xLabel, yLabel, label }) {
  const W = 300, H = 140;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pg-svg', role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(...xs) - 0.5, x1 = Math.max(...xs) + 0.5, y0 = Math.min(...ys) - 5, y1 = Math.max(...ys) + 5;
  for (const f of [0.5]) s('line', { x1: 0, x2: W, y1: H * f, y2: H * f, class: 'pg-grid' }, svg);
  // RTL: more sleep further left
  for (const p of points) s('circle', { cx: W - 10 - ((p.x - x0) / (x1 - x0)) * (W - 20), cy: 10 + (1 - (p.y - y0) / (y1 - y0)) * (H - 20), r: 4, class: 'pg-sc' }, svg);
  return h('figure', { class: 'pg-fig' }, svg, h('div', { class: 'pg-xl' }, h('span', {}, `${xLabel}: أقل`), h('span', {}, `${yLabel} ↑`), h('span', {}, 'أكتر')));
}
