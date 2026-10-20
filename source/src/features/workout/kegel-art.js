// Inline SVG diagrams for the heart day + pelvic floor screens (Electric Glass Pro palette, medical-schematic style).
// Static markup only (no user data), colours come from health.css classes (.a-*) that map to tokens.
// Non-explicit: bones + a muscle sling, neutral rounded silhouettes. Every svg has role="img" + an Arabic aria-label.
import { h, raw } from './view.js';

const svg = (vb, label, body, cls = '') => raw(`<svg viewBox="${vb}" class="hk-svg ${cls}" role="img" aria-label="${label}" focusable="false" dir="ltr">${body}</svg>`);
const fig = (cls, label, body, vb, caption, extra = null) => h('figure', { class: `hk-fig ${cls}` }, svg(vb, label, body), caption ? h('figcaption', {}, caption) : null, extra);

/** (i) Side-view schematic: pelvis bones with the pelvic-floor sling, relaxed (dashed) vs lifted (solid + arrow). */
export function pelvisArt() {
  const body = `
    <path class="a-bone" d="M96 30 C 128 8, 206 6, 246 34 C 262 46, 262 70, 250 86 C 238 100, 214 104, 196 100 C 176 96, 150 84, 128 78 C 112 74, 98 60, 96 30 Z"/>
    <circle class="a-bone-in" cx="196" cy="84" r="11"/>
    <path class="a-v a-thick" d="M100 28 C 82 52, 76 86, 82 112 C 85 124, 90 132, 96 138"/>
    <path class="a-v a-tick" d="M84 54 l12 4 M80 74 l12 3 M80 94 l12 2 M84 114 l11 0"/>
    <ellipse class="a-bone a-v" cx="240" cy="126" rx="10" ry="17" transform="rotate(-18 240 126)"/>
    <path class="a-mu a-dash" d="M98 140 Q 170 196 232 140"/>
    <path class="a-p a-sling" d="M98 140 Q 170 150 232 140"/>
    <path class="a-p a-fib" d="M126 146 l0 -6 M150 149 l0 -6 M174 150 l0 -6 M198 148 l0 -6"/>
    <path class="a-a a-arrow" d="M168 186 L168 158 M160 166 L168 156 L176 166"/>
    <text class="a-tx" x="64" y="168" text-anchor="middle">العصعص</text>
    <text class="a-tx" x="262" y="172" text-anchor="middle">عظمة العانة</text>
    <text class="a-tx a-tx-p" x="170" y="132" text-anchor="middle">قاع الحوض</text>
    <text class="a-tx" x="182" y="52" text-anchor="middle">عظم الحوض</text>`;
  return fig('hk-fig-pelvis', 'رسم جانبي للحوض: عضلات قاع الحوض زي شبكة بين عظمة العانة والعصعص، مرتاحة تحت ومشدودة لفوق مع سهم لفوق', body, '0 0 320 200',
    'منظر جانبي تخطيطي: العضلات شبكة بتشيل اللي فوقها.',
    h('ul', { class: 'hk-legend' },
      h('li', {}, h('i', { class: 'lg-dash', 'aria-hidden': 'true' }), 'مرتاحة'),
      h('li', {}, h('i', { class: 'lg-p', 'aria-hidden': 'true' }), 'مشدودة لفوق ولجوه'),
      h('li', {}, h('i', { class: 'lg-a', 'aria-hidden': 'true' }), 'اتجاه الشد: رفع، مش زق لتحت')));
}

const PELVIS_DOT = (x, y) => `<path class="a-p a-hl" d="M${x - 7} ${y - 1} Q ${x} ${y + 7} ${x + 7} ${y - 1}"/>`;
const POSE = {
  lying: { label: 'نايم على ضهرك والركبتين مثنيين', vb: '0 0 120 110', body: `
    <path class="a-floor" d="M6 98 H114"/>
    <circle class="a-head" cx="18" cy="82" r="7"/>
    <path class="a-v a-limb" d="M27 86 L62 89"/>
    <path class="a-v a-limb" d="M62 89 L80 64 L96 95"/>
    <path class="a-v a-limb a-arm" d="M32 89 L54 93"/>
    ${PELVIS_DOT(62, 89)}` },
  sitting: { label: 'قاعد على كرسي وضهرك مفرود', vb: '0 0 120 110', body: `
    <path class="a-chair" d="M36 72 H82 M38 72 V28 M40 72 V100 M80 72 V100"/>
    <path class="a-floor" d="M6 101 H114"/>
    <circle class="a-head" cx="54" cy="16" r="7"/>
    <path class="a-v a-limb" d="M54 25 L55 66"/>
    <path class="a-v a-limb" d="M55 68 L88 68 L90 98 L100 98"/>
    <path class="a-v a-limb a-arm" d="M55 34 L68 56"/>
    ${PELVIS_DOT(56, 68)}` },
  standing: { label: 'واقف ورجليك بعرض الحوض', vb: '0 0 120 110', body: `
    <path class="a-floor" d="M6 101 H114"/>
    <circle class="a-head" cx="60" cy="12" r="7"/>
    <path class="a-v a-limb" d="M60 21 L60 58"/>
    <path class="a-v a-limb" d="M60 58 L53 99 M60 58 L67 99"/>
    <path class="a-v a-limb a-arm" d="M60 28 L49 55 M60 28 L71 55"/>
    ${PELVIS_DOT(60, 58)}` },
};
export const POSE_NAMES = { lying: 'نايم', sitting: 'قاعد', standing: 'واقف' };
/** (ii) The three positions; `active` = positions used this stage, `cur` = the one in use now. */
export function positionsArt(active = ['lying', 'sitting', 'standing'], cur = null) {
  return h('div', { class: 'hk-poses', role: 'list', 'aria-label': 'أوضاع التمرين بالترتيب' },
    ...['lying', 'sitting', 'standing'].map((k, i) => {
      const p = POSE[k];
      const on = active.includes(k);
      return h('figure', { class: `hk-fig hk-pose${on ? ' on' : ''}${cur === k ? ' cur' : ''}`, role: 'listitem', dataset: { pos: k } },
        svg(p.vb, p.label, p.body), h('figcaption', {}, h('b', { class: 'num' }, String(i + 1)), ' ', POSE_NAMES[k], on ? null : h('small', {}, 'بعدين')));
    }));
}

/** (iii) Wall sit: back flat on the wall, thighs about parallel, knees over the heels. */
export function wallSitArt() {
  const body = `
    <path class="a-wall" d="M40 8 V150"/>
    <path class="a-hatch" d="M40 20 l-10 10 M40 44 l-10 10 M40 68 l-10 10 M40 92 l-10 10 M40 116 l-10 10"/>
    <path class="a-floor" d="M30 150 H196"/>
    <circle class="a-head" cx="56" cy="28" r="9"/>
    <path class="a-v a-limb a-big" d="M52 40 L52 94"/>
    <path class="a-v a-limb a-big" d="M52 94 L112 96"/>
    <path class="a-v a-limb a-big" d="M112 96 L114 146 L134 146"/>
    <path class="a-v a-limb a-arm" d="M54 50 L70 84"/>
    <path class="a-p a-back" d="M46 42 V92"/>
    <path class="a-a a-angle" d="M112 116 A 20 20 0 0 1 92 96"/>
    <text class="a-tx a-tx-a" x="146" y="122" text-anchor="middle">90–100°</text>
    <text class="a-tx" x="150" y="74" text-anchor="middle">الركبة فوق الكعب</text>
    <text class="a-tx a-tx-p" x="112" y="34" text-anchor="middle">ضهر لازق</text>`;
  return fig('hk-fig-wall', 'رسم للجلوس على الحيطة: الضهر لازق في الحيطة والفخد قريب من الموازي للأرض والركبة فوق الكعب بزاوية 90 لـ 100 درجة', body, '0 0 200 160',
    'جلوس على الحيطة: ضهرك مفرود على الحيطة، وزاوية الركبة 90–100 درجة.');
}

/** (iv) Zone 2 bike icon (upright stationary bike + pulse line). */
export function bikeArt() {
  const body = `
    <path class="a-floor" d="M8 58 H56"/>
    <path class="a-v a-frame" d="M16 58 L22 50 H44 L48 58 M24 50 L30 26 M30 26 L44 44 M30 26 H22 M38 18 L42 16 H48 M40 18 L44 44"/>
    <circle class="a-v a-frame" cx="44" cy="44" r="7"/>
    <path class="a-p a-pulse" d="M4 12 H12 L15 6 L19 18 L22 10 H28"/>`;
  return h('span', { class: 'hk-bike' }, svg('0 0 64 64', 'أيقونة عجلة ثابتة لكارديو Zone 2', body));
}
