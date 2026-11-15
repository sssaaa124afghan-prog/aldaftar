// The movement viewer: a sheet over the page with the 3D mannequin doing the exercise, target muscles coloured,
// drag to turn it, scrub or pause the motion, and the video one tap away for the fine details.
import { h } from '../view.js';
import { fineOf } from '../exercises.js';
import { moveFor, hasMove, padsFor, mistakesFor, contentKeyFor } from './moves.js';
import { FORM_PHASES } from '../content.js';
import { ease } from './rig.js';

export { hasMove };
const CSS = `.m3-sheet{position:fixed;inset:0;z-index:9999;display:grid;place-items:end center;background:rgb(10 14 24/.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.m3-box{width:min(100%,520px);max-height:96dvh;overflow:auto;background:var(--sheet-bg,#fff);color:var(--tx,#141B2E);border-radius:28px 28px 0 0;padding:14px 16px calc(env(safe-area-inset-bottom,0px) + 16px);box-shadow:0 -20px 60px rgb(0 0 0/.3)}
@media(min-width:560px){.m3-sheet{place-items:center}.m3-box{border-radius:28px}}
.m3-bar{display:flex;align-items:center;gap:10px}.m3-bar b{flex:1;min-width:0;font:700 17px/1.35 var(--f,inherit)}
.m3-x{min-width:44px;min-height:44px;border:1px solid var(--edge,rgb(0 0 0/.12));border-radius:14px;background:transparent;color:inherit;font-size:18px}
.m3-stage{position:relative;margin-top:8px;border-radius:22px;overflow:hidden;background:radial-gradient(120% 90% at 50% 20%,var(--tone-soft,rgb(125 140 170/.14)),transparent 70%);touch-action:none;cursor:grab}
.m3-stage:active{cursor:grabbing}
.m3-stage canvas{display:block;width:100%;aspect-ratio:1/1;max-height:52dvh}
.m3-hint{position:absolute;inset-inline-start:12px;bottom:10px;font:600 12px/1 var(--f,inherit);color:var(--mu,#566079);pointer-events:none}
.m3-ctl{display:flex;align-items:center;gap:10px;margin-top:10px}
.m3-ctl button{min-width:48px;min-height:48px;border:0;border-radius:16px;background:var(--cta,#FF6B2C);color:var(--cta-tx,#2A0E00);font:700 14px/1 var(--f,inherit);padding:0 14px}
.m3-ctl input{flex:1;min-height:44px;accent-color:var(--cta,#FF6B2C)}
.m3-ctl small{font:600 12px/1 var(--f,inherit);color:var(--mu,#566079)}
.m3-legend{display:flex;flex-direction:column;gap:6px;margin-top:10px;font:500 14px/1.5 var(--f,inherit)}
.m3-legend span{display:flex;align-items:center;gap:8px}
.m3-dot{width:14px;height:14px;border-radius:50%;flex:none}
.m3-notes{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.m3-notes section{border-radius:16px;padding:10px 14px;border:1px solid var(--edge,rgb(0 0 0/.1))}
.m3-notes h3{margin:0 0 4px;font:700 14px/1.4 var(--f,inherit)}
.m3-notes ul{margin:0;padding-inline-start:18px;font:500 14px/1.75 var(--f,inherit)}
.m3-bad{background:color-mix(in srgb,#E5484D 9%,transparent)}.m3-bad h3{color:var(--danger-tx,#B42318)}
.m3-good{background:color-mix(in srgb,#1F8A5B 9%,transparent)}
.m3-foot{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px}
.m3-foot p{flex:1;min-width:180px;margin:0;font:500 12px/1.6 var(--f,inherit);color:var(--mu,#566079)}
.m3-fail{padding:40px 16px;text-align:center;color:var(--mu,#566079);font:500 14px/1.7 var(--f,inherit)}`;

const isLight = () => { try { const d = document.documentElement.dataset.design; return d === 'e' || d === 'c' || /light/.test(getComputedStyle(document.documentElement).colorScheme || ''); } catch { return true; } };

/**
 * Open the 3D movement of a library exercise. `extra` = an element shown in the footer (the video link).
 * → true when a movement exists for it (the sheet opened), false otherwise.
 */
export function openMove(lib, { name = '', extra = null } = {}) {
  if (!lib || !hasMove(lib.id) || typeof document === 'undefined') return false;
  const move = moveFor(lib.id);
  const fine = fineOf({ lib: lib.id, ...lib });
  const pads = padsFor(fine);
  const back = document.activeElement;
  let viewer = null; let raf = 0; let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches; let t0 = performance.now(); let manual = 0; let closed = false;
  const period = move.period || 2800;

  const canvas = h('canvas', { 'aria-label': `مجسّم بيعمل تمرين ${name || lib.ar}`, role: 'img' });
  const stage = h('div', { class: 'm3-stage' }, canvas, h('span', { class: 'm3-hint' }, 'اسحب عشان تلف المجسّم'));
  const slider = h('input', { type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'مكان الحركة من البداية للنهاية' });
  const playBtn = h('button', { type: 'button' }, playing ? 'وقّف' : 'شغّل');
  const x = h('button', { type: 'button', class: 'm3-x', 'aria-label': 'اقفل' }, '✕');
  const light = isLight();
  const dot = (c) => h('i', { class: 'm3-dot', style: `background:${c}` });
  const legend = h('div', { class: 'm3-legend' },
    h('span', {}, dot(light ? '#FF4A1C' : '#FF5A2E'), h('span', {}, 'العضلة الأساسية: ', h('b', {}, fine.prime || lib.muscle || ''))),
    (fine.synergists || []).length ? h('span', {}, dot(light ? '#FFB24D' : '#FFC062'), h('span', {}, 'بتساعد: ', (fine.synergists || []).join('، '))) : null);
  const bad = mistakesFor(lib.id);
  const form = FORM_PHASES[contentKeyFor(lib.id)]; // matched by movement family, never by a word in the name
  const good = (form && form.cues) || [];
  const notes = h('div', { class: 'm3-notes' },
    bad.length ? h('section', { class: 'm3-bad' }, h('h3', {}, 'أخطاء شائعة تجنّبها'), h('ul', {}, ...bad.map((t) => h('li', {}, t)))) : null,
    good.length ? h('section', { class: 'm3-good' }, h('h3', {}, 'الأداء الصح'), h('ul', {}, ...good.slice(0, 5).map((t) => h('li', {}, t)))) : null);
  const box = h('div', { class: 'm3-box' },
    h('div', { class: 'm3-bar' }, h('b', {}, name || lib.ar), x),
    stage,
    h('div', { class: 'm3-ctl' }, playBtn, h('small', {}, 'البداية'), slider, h('small', {}, 'النهاية')),
    legend,
    notes,
    h('div', { class: 'm3-foot' }, h('p', {}, 'مجسّم توضيحي لمسار الحركة والعضلة. تفاصيل القبضة ووضع الكتف والضهر في الفيديو.'), extra));
  const wrap = h('div', { class: 'm3-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `حركة ${name || lib.ar}`, onclick: (e) => { if (e.target === wrap) close(); } }, box);

  function tick(now) {
    if (closed) return;
    let t = manual;
    if (playing) {
      const ph = ((now - t0) % period) / period;
      const tri = ph < 0.44 ? ph / 0.44 : ph < 0.54 ? 1 : ph < 0.96 ? 1 - (ph - 0.54) / 0.42 : 0;
      t = ease(tri); slider.value = String(Math.round(t * 100));
    }
    viewer.setT(t); viewer.render();
    raf = requestAnimationFrame(tick);
  }
  function close() {
    if (closed) return; closed = true;
    cancelAnimationFrame(raf); if (viewer) viewer.dispose();
    removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey, true);
    wrap.remove();
    try { back && back.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const onResize = () => { if (viewer) viewer.resize(); };
  x.onclick = close;
  playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? 'وقّف' : 'شغّل'; if (playing) t0 = performance.now(); else manual = Number(slider.value) / 100; };
  slider.oninput = () => { playing = false; playBtn.textContent = 'شغّل'; manual = Number(slider.value) / 100; };
  let last = null;
  stage.onpointerdown = (e) => { last = [e.clientX, e.clientY]; try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
  stage.onpointermove = (e) => { if (!last || !viewer) return; viewer.rotate(-(e.clientX - last[0]) * 0.012, (e.clientY - last[1]) * 0.008); last = [e.clientX, e.clientY]; };
  stage.onpointerup = stage.onpointercancel = () => { last = null; };

  if (!document.getElementById('m3-css')) { const st = document.createElement('style'); st.id = 'm3-css'; st.textContent = CSS; document.head.appendChild(st); }
  document.body.appendChild(wrap);
  document.addEventListener('keydown', onKey, true); addEventListener('resize', onResize);
  x.focus({ preventScroll: true });

  import('./scene.js').then(({ createViewer }) => {
    if (closed) return;
    viewer = createViewer(canvas, { move, primary: pads.primary, secondary: pads.secondary, scheme: light ? 'light' : 'dark' });
    if (!playing) manual = 1;
    raf = requestAnimationFrame(tick);
  }).catch(() => {
    if (closed) return;
    stage.textContent = '';
    stage.appendChild(h('p', { class: 'm3-fail' }, 'المجسّم مش شغّال على الجهاز ده. استخدم الفيديو.'));
  });
  return true;
}
