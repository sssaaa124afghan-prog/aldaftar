// «عضلات الأسبوع»: a front + back figure whose muscles light up with the hard sets done in the last 7 days.
// Stylised on purpose (rounded plates, not anatomy): each shape carries data-m = the exercise «muscle» label.
import { h } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { muscleSets, muscleRank, level, FULL_SETS } from './musclemap-data.js';

const NS = 'http://www.w3.org/2000/svg';
const S = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

// [muscle, shape, attrs] on a 120 × 250 figure. Paired shapes are drawn once and mirrored around x = 60.
const FRONT = [
  ['ترابيس', 'path', { d: 'M48 40 L60 34 L72 40 L66 46 L54 46 Z' }],
  ['كتف', 'ellipse', { cx: 31, cy: 54, rx: 10, ry: 9, pair: 1 }],
  ['صدر', 'path', { d: 'M40 48 H58 V72 Q48 76 40 68 Z', pair: 1 }],
  ['باي', 'ellipse', { cx: 25, cy: 80, rx: 6.5, ry: 14, pair: 1 }],
  ['ساعد', 'ellipse', { cx: 20, cy: 112, rx: 5.5, ry: 15, pair: 1 }],
  ['بطن', 'path', { d: 'M47 78 H73 V112 Q60 122 47 112 Z' }],
  ['ضامة', 'path', { d: 'M54 128 L60 124 L60 158 Q55 150 54 128 Z', pair: 1 }],
  ['رجل', 'path', { d: 'M38 126 Q46 120 53 127 L55 172 Q48 180 41 172 Z', pair: 1 }],
  ['سمانة', 'ellipse', { cx: 46, cy: 204, rx: 6.5, ry: 18, pair: 1 }],
];
const BACK = [
  ['ترابيس', 'path', { d: 'M44 42 L60 32 L76 42 L60 64 Z' }],
  ['كتف خلفي', 'ellipse', { cx: 31, cy: 54, rx: 10, ry: 9, pair: 1 }],
  ['ظهر', 'path', { d: 'M42 52 L57 66 V104 Q46 100 40 76 Z', pair: 1 }],
  ['تراي', 'ellipse', { cx: 25, cy: 80, rx: 6.5, ry: 14, pair: 1 }],
  ['ساعد', 'ellipse', { cx: 20, cy: 112, rx: 5.5, ry: 15, pair: 1 }],
  ['مؤخرة', 'path', { d: 'M41 114 H59 V134 Q48 140 41 130 Z', pair: 1 }],
  ['رجل خلفي', 'path', { d: 'M39 140 Q47 136 55 141 L55 176 Q48 182 41 176 Z', pair: 1 }],
  ['سمانة', 'ellipse', { cx: 46, cy: 204, rx: 7, ry: 18, pair: 1 }],
];
export const MAP_MUSCLES = [...new Set([...FRONT, ...BACK].map((x) => x[0]))];

function figure(shapes, sets, title) {
  const svg = S('svg', { viewBox: '0 0 120 250', class: 'mm-fig', role: 'img', 'aria-label': title });
  // body silhouette (neutral): head, torso, arms, legs
  const body = S('g', { class: 'mm-body' });
  body.append(S('circle', { cx: 60, cy: 20, r: 12 }), S('rect', { x: 54, y: 30, width: 12, height: 10, rx: 4 }),
    S('path', { d: 'M36 44 Q60 36 84 44 L80 120 Q60 128 40 120 Z' }),
    S('path', { d: 'M24 46 Q14 60 16 96 L13 130 Q16 138 23 132 L30 96 Q34 64 34 50 Z' }), S('path', { d: 'M96 46 Q106 60 104 96 L107 130 Q104 138 97 132 L90 96 Q86 64 86 50 Z' }),
    S('path', { d: 'M38 118 H60 V180 L56 236 Q50 242 44 236 L40 180 Z' }), S('path', { d: 'M82 118 H60 V180 L64 236 Q70 242 76 236 L80 180 Z' }));
  svg.append(body);
  for (const [m, tag, attrs] of shapes) {
    const { pair, ...a } = attrs;
    const lv = level(sets[m]);
    const mk = () => { const e = S(tag, a); e.setAttribute('class', `mm-m${lv > 0 ? ' on' : ''}`); e.dataset.m = m; e.style.setProperty('--lv', String(lv)); return e; };
    svg.append(mk());
    if (pair) { const g = S('g', { transform: 'translate(120 0) scale(-1 1)' }); g.append(mk()); svg.append(g); }
  }
  return svg;
}

/** The card. sessions = all sessions, today = day key. */
export function muscleMapCard(sessions, today) {
  const sets = muscleSets(sessions, today);
  const { done, missed } = muscleRank(sets, MAP_MUSCLES);
  const total = done.reduce((a, b) => a + b.n, 0);
  const chips = h('div', { class: 'mm-chips' },
    ...done.slice(0, 6).map(({ m, n }) => h('span', { class: 'mm-chip on', style: { '--lv': String(level(n)) } }, m, ' ', h('b', { class: 'num' }, fmt(n)))),
    ...missed.slice(0, done.length ? 3 : 0).map((m) => h('span', { class: 'mm-chip' }, m, ' ', h('b', { class: 'num' }, '0'))));
  return h('section', { class: 'sheet-card mm-card', 'aria-labelledby': 'mm-h' },
    h('div', { class: 'mm-head' }, h('h2', { id: 'mm-h' }, 'عضلات الأسبوع'), h('small', {}, total ? ['آخر 7 أيام · ', h('b', { class: 'num' }, fmt(total)), ' مجموعة'] : 'آخر 7 أيام')),
    h('div', { class: 'mm-figs' },
      h('figure', {}, figure(FRONT, sets, 'الجسم من قدّام'), h('figcaption', {}, 'قدّام')),
      h('figure', {}, figure(BACK, sets, 'الجسم من ورا'), h('figcaption', {}, 'ورا'))),
    total ? chips : h('p', { class: 'mm-empty' }, 'أول جلسة تسجّلها هتنوّر العضلات اللي اشتغلت.'),
    total ? h('p', { class: 'mm-legend' }, h('i', { 'aria-hidden': 'true' }), `كل ما اللون ينوّر أكتر، العضلة أخدت مجموعات أكتر (${FULL_SETS} مجموعات = منوّرة على الآخر).`) : null);
}
