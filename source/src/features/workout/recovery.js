// #/workout/recovery — recovery day (parity R1-R5, W57): Zone 2 cardio 18:00 timer + the guided 6-station stretch
// circuit from Solo Gym (exact sequence, 690 s). Timers are timestamp based. Finishing writes a {kind:'recovery'} record
// to the sessions store (never counted as lifting). Tone is opt-in (wk.sound); vibration only after a gesture.
import { h, N, ico, band, safeWrite } from './view.js';
import * as L from './logic.js';
import { putSession } from './store.js';
import { STATIONS, STRETCH_PROTOCOLS, REST_PROTOCOLS } from './content.js';
import { tone, speak } from './kit.js';
import { reduced } from '../../ui/anim.js';
import { buzz } from '../../core/alerts.js';

const NS = 'http://www.w3.org/2000/svg';
const STRETCH_TITLE = { push: 'إطالة بعد الدفع (صدر · كتف · تراي)', pull: 'إطالة بعد السحب (ظهر · باي)', leg: 'إطالة بعد الرجل', default: 'إطالة عامة بعد التمرين' };

export function renderRecovery(el, ctx, params = {}) {
  el.appendChild(band({ title: 'التعافي', sub: 'كارديو خفيف + إطالة موجّهة · مش بتتحسب جلسة رفع', back: () => ctx.go('workout') }));
  const root = h('div', { class: 'wk-recovery' });
  el.appendChild(root);
  let closed = false;

  // post-workout stretch list (W57) when coming from the summary
  const st = STRETCH_PROTOCOLS[params.stretch] ? params.stretch : null;
  if (st) {
    root.appendChild(h('section', { class: 'glass wk-card', 'aria-labelledby': 'wk-st-h' },
      h('h3', { id: 'wk-st-h' }, STRETCH_TITLE[st]),
      h('ol', { class: 'wk-steps' }, ...STRETCH_PROTOCOLS[st].map((p) => h('li', {}, h('b', {}, p.name), h('small', { class: 'num' }, p.time), h('p', {}, p.cue))))));
  }

  // ── Zone 2 cardio (R2) ──
  const cardio = { endsAt: null, pausedLeft: null };
  const cNum = h('b', { class: 'num' }, L.fmtClock(L.CARDIO_SECS));
  const cBtn = h('button', { type: 'button', class: 'btn', onclick: cardioToggle }, ico('play'), 'ابدأ');
  const cReset = h('button', { type: 'button', class: 'btn ghost sm', hidden: true, onclick: () => { cardio.endsAt = null; cardio.pausedLeft = null; paintCardio(); } }, 'من الأول');
  root.appendChild(h('section', { class: 'glass wk-card', 'aria-labelledby': 'wk-z2-h' },
    h('h3', { id: 'wk-z2-h' }, 'كارديو Zone 2 · ', N('18'), ' دقيقة'),
    h('p', { class: 'wk-muted' }, 'شدّة منخفضة بتحافظ على الكورتيزول واطي وبتضخ الدم للعضلات المتعبة = تعافي أنشط.'),
    h('div', { class: 'wk-opts' },
      h('div', {}, h('b', {}, 'مشي على ميل'), h('span', {}, 'ميل ', N('5-8%'), ' · سرعة ', N('4.5-5.5'), ' كم/س')),
      h('div', {}, h('b', {}, 'عجلة ثابتة'), h('span', {}, 'مقاومة متوسطة · RPM ', N('70-80')))),
    h('p', { class: 'wk-hint quiet' }, 'المعيار: تقدر تتكلم بجمل كاملة من غير ما نفَسك يتقطع = إنت في Zone 2 الصح.'),
    h('div', { class: 'wk-cardio', role: 'timer', 'aria-label': 'مؤقّت الكارديو' }, cNum, h('small', {}, 'فاضل')),
    h('div', { class: 'btn-row' }, cBtn, cReset)));

  function cardioLeft() {
    if (cardio.pausedLeft !== null) return cardio.pausedLeft;
    if (!cardio.endsAt) return L.CARDIO_SECS;
    return Math.max(0, Math.ceil((cardio.endsAt - Date.now()) / 1000));
  }
  function cardioToggle() {
    if (cardio.endsAt && cardio.pausedLeft === null) cardio.pausedLeft = cardioLeft();
    else { cardio.endsAt = Date.now() + cardioLeft() * 1000; cardio.pausedLeft = null; }
    paintCardio();
  }
  function paintCardio() {
    cNum.textContent = L.fmtClock(cardioLeft());
    const running = cardio.endsAt && cardio.pausedLeft === null;
    cBtn.textContent = '';
    cBtn.append(...(running ? [h('span', { 'aria-hidden': 'true', class: 'wk-ic' }, ico('pause')), 'وقّف'] : [h('span', { 'aria-hidden': 'true', class: 'wk-ic' }, ico('play')), cardio.endsAt ? 'كمّل' : 'ابدأ']));
    cReset.hidden = !cardio.endsAt;
  }

  // ── stretch circuit (R3) ──
  const PH = L.RECOVERY_PHASES;
  const c = { idx: 0, endsAt: null, pausedLeft: PH[0].dur, started: false, finished: false };
  const SIZE = 168, STROKE = 12, R = (SIZE - STROKE) / 2, CIRC = 2 * Math.PI * R;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`); svg.setAttribute('width', SIZE); svg.setAttribute('height', SIZE); svg.setAttribute('aria-hidden', 'true');
  const mk = (stroke, cls) => { const e = document.createElementNS(NS, 'circle'); for (const [k, v] of Object.entries({ cx: SIZE / 2, cy: SIZE / 2, r: R, fill: 'none', 'stroke-width': STROKE, 'stroke-linecap': 'round', transform: `rotate(-90 ${SIZE / 2} ${SIZE / 2})`, stroke })) e.setAttribute(k, v); if (cls) e.setAttribute('class', cls); return e; };
  svg.append(mk('rgba(255,255,255,.12)'), mk('var(--pro, #BAE6FD)', 'wk-rx-arc'));
  const arc = svg.lastChild;
  arc.setAttribute('stroke-dasharray', `0 ${CIRC}`);
  if (reduced()) arc.style.transition = 'none';
  const tNum = h('b', { class: 'num' }, '00:00');
  const tSide = h('span', {}, 'جاهز');
  const sName = h('h4', {}, 'اضغط ابدأ');
  const sTip = h('p', { class: 'wk-muted' });
  const sProg = h('p', { class: 'wk-rx-prog' });
  const breathe = h('p', { class: 'wk-hint', hidden: true }, 'شهيق 4 ثواني … زفير 6 ثواني');
  const play = h('button', { type: 'button', class: 'btn', onclick: toggle }, 'ابدأ الدائرة');
  const steps = h('ol', { class: 'wk-rx-steps' });
  root.appendChild(h('section', { class: 'glass wk-card', 'aria-labelledby': 'wk-rx-h' },
    h('h3', { id: 'wk-rx-h' }, 'دائرة الإطالة الموجّهة · ', N(L.fmtClock(L.RECOVERY_TOTAL)), ' دقيقة'),
    h('div', { class: 'wk-rx' }, h('div', { class: 'wk-ring big', role: 'timer', 'aria-live': 'off' }, svg, h('div', { class: 'c' }, tNum, tSide)),
      h('div', { class: 'wk-rx-info', 'aria-live': 'polite' }, sName, sTip, sProg, breathe)),
    h('div', { class: 'wk-rx-ctrls' },
      h('button', { type: 'button', class: 'ibtn glass', 'aria-label': 'المحطة اللي فاتت', onclick: () => jump(-1) }, ico('skip')),
      play,
      h('button', { type: 'button', class: 'ibtn glass wk-flip', 'aria-label': 'المرحلة الجاية', onclick: () => jump(1) }, ico('skip'))),
    steps));

  function left() {
    if (c.pausedLeft !== null) return c.pausedLeft;
    return Math.max(0, Math.ceil((c.endsAt - Date.now()) / 1000));
  }
  function toggle() {
    if (c.finished) { Object.assign(c, { idx: 0, endsAt: null, pausedLeft: PH[0].dur, started: false, finished: false }); paint(); return; }
    if (c.pausedLeft !== null) { c.endsAt = Date.now() + c.pausedLeft * 1000; c.pausedLeft = null; c.started = true; }
    else c.pausedLeft = left();
    paint();
  }
  function jump(d) {
    const i = Math.max(0, Math.min(PH.length - 1, c.idx + d));
    if (d > 0 && c.idx >= PH.length - 1) { finish(); return; }
    const running = c.pausedLeft === null;
    c.idx = i; c.finished = false;
    if (running) c.endsAt = Date.now() + PH[i].dur * 1000; else c.pausedLeft = PH[i].dur;
    paint();
  }
  function cue() { buzz(120); tone(ctx, 'phase'); }
  async function finish(mode = 'stretch', seconds = L.RECOVERY_TOTAL) {
    c.finished = true; c.pausedLeft = 0;
    buzz([200, 100, 200, 100, 300]);
    tone(ctx, 'done'); speak(ctx, 'خلصت جلسة التعافي');
    const rec = L.recoveryRecord({ mode, seconds });
    if (await safeWrite(ctx, () => putSession(ctx.db, rec))) {
      ctx.emit('session:changed', { id: rec.id, state: 'recovery' });
      ctx.toast('تمّت جلسة التعافي — مش بتتحسب كجلسة رفع.');
    }
    paint();
  }
  function paint() {
    const p = PH[c.idx];
    const l = c.finished ? 0 : left();
    tNum.textContent = c.finished ? L.fmtClock(L.RECOVERY_TOTAL) : L.fmtClock(l);
    tSide.textContent = c.finished ? 'خلصت' : c.started ? p.side : 'جاهز';
    sName.textContent = c.finished ? 'خلص التعافي' : p.name;
    sTip.textContent = c.finished ? 'جسمك هيشكرك بكرة.' : p.tip;
    let gone = 0; for (let i = 0; i < c.idx; i++) gone += PH[i].dur; gone += p.dur - l;
    sProg.textContent = '';
    sProg.append('المحطة ', N(`${p.si + 1}/${STATIONS.length}`), ' · ', N(`${L.fmtClock(c.finished ? L.RECOVERY_TOTAL : gone)} / ${L.fmtClock(L.RECOVERY_TOTAL)}`));
    const frac = c.finished ? 1 : (p.dur - l) / p.dur;
    arc.setAttribute('stroke-dasharray', `${CIRC * frac} ${CIRC}`);
    arc.setAttribute('stroke', c.finished ? 'var(--ok, #4ADE80)' : p.breathe ? 'var(--carb, #86EFAC)' : l <= 5 && c.started ? 'var(--amber, #FCD34D)' : 'var(--pro, #BAE6FD)');
    breathe.hidden = !(p.breathe && !c.finished);
    play.textContent = c.finished ? 'ابدأ تاني' : c.pausedLeft === null ? 'وقّف' : c.started ? 'كمّل' : 'ابدأ الدائرة';
    steps.textContent = '';
    STATIONS.forEach((s, si) => {
      const cur = !c.finished && p.si === si, done = c.finished || p.si > si;
      steps.appendChild(h('li', { class: cur ? 'cur' : done ? 'done' : '', 'aria-current': cur ? 'step' : null },
        h('span', { class: 'ck' }, done ? ico('check') : null), h('span', {}, s.n), h('small', { class: 'num' }, L.fmtClock(s.ph.reduce((a, x) => a + x[1], 0)))));
    });
  }
  function tick() {
    if (closed) return;
    if (cardio.endsAt && cardio.pausedLeft === null) {
      if (cardioLeft() <= 0) { cardio.endsAt = null; cardio.pausedLeft = null; paintCardio(); cue(); finish('cardio', L.CARDIO_SECS); ctx.toast('خلصت كارديو Zone 2.'); }
      else cNum.textContent = L.fmtClock(cardioLeft());
    }
    if (!c.finished && c.pausedLeft === null && c.endsAt) {
      let guard = 0;
      while (Date.now() >= c.endsAt && guard++ < PH.length) { // carry over while the screen was locked
        if (c.idx >= PH.length - 1) { finish(); return; }
        c.idx++; c.endsAt += PH[c.idx].dur * 1000; cue();
      }
      paint();
    }
  }
  const timer = setInterval(tick, 250);
  const onVis = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', onVis);
  paint(); paintCardio();

  // ── alternative circuits (R4) ──
  root.appendChild(h('section', { class: 'sec', 'aria-labelledby': 'wk-alt-h' },
    h('h3', { id: 'wk-alt-h' }, 'دواير بديلة'),
    ...REST_PROTOCOLS.map((p) => h('details', { class: 'wk-fold' }, h('summary', {}, p.name, h('small', {}, p.duration)),
      h('ol', { class: 'wk-steps' }, ...p.steps.map((x) => h('li', {}, x)))))));

  return () => { closed = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
}
