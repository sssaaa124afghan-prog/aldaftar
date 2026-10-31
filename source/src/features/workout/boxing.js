// #/workout/boxing — Boxing Day (Thursday, 30–40 min, replaces the Heart Day). Round timer with bell + 10 s clap (WebAudio,
// no assets), haptics, lock-screen alert on the rest-timer path, RPE per round, «كومبو الأسبوع», cues and technique videos.
// Pure parts: boxing-plan.js. Timers are timestamp based (runner from heart.js), so a locked screen catches up on return.
// Debug: ?speed=20 runs the clock 20× (QA only), ?week=N previews another curriculum week, ?min=30|35|40 the length.
import './boxing.css';
import { h, N, ico, band, safeWrite, bidiRanges } from './view.js';
import { fill } from '../../ui/dom.js';
import { putSession, loadProgram, loadTraining } from './store.js';
import { prefSwitch, askNotifyPermission, armPhaseNotice, cancelPhaseNotice } from './kit.js';
import { haptic, reduced } from '../../ui/anim.js';
import { cue, buzz, unlock, keepAwake, alertEnv } from '../../core/alerts.js';
import { videoLink } from './exercise-videos.js';
import { BOX_VIDEO_NAME } from './boxing-videos.js';
import { runner, ringSvg, loadHealth, patchHealth } from './heart.js';
import * as L from './logic.js';
import { pushSyncer } from './push-sync.js';
import { pushStatus } from '../../core/push.js';
import { boxingToday, boxingPlan, boxingRecord, curriculumFor, boxingWeekStats, roundDone, SAFETY, GEAR_VIDEOS, PHASES, BOX_DEFAULT } from './boxing-plan.js';

const fmtClock = (sec) => { const t = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const KIND_COLOR = { rope: 'var(--cal)', shadow: 'var(--carb)', srest: 'var(--mu-3)', gloves: 'var(--mu-3)', bag: 'var(--orange)', brest: 'var(--mu-3)',
  drill: 'var(--pro)', drest: 'var(--mu-3)', core: 'var(--violet)', wall: 'var(--violet)', rest: 'var(--mu-3)', pelvic: 'var(--pink)' };
const KIND_TAG = { rope: 'تسخين', shadow: 'شادو', srest: 'راحة', gloves: 'تجهيز', bag: 'شوال', brest: 'راحة', drill: 'دفاع وحركة', drest: 'راحة',
  core: 'بطن', wall: 'ثابت', rest: 'راحة', pelvic: 'قاع الحوض' };
const ROUND = new Set(['bag', 'shadow']);
const BELL_KEY = 'box.bell';
const bellOn = (ctx) => ctx.settings.get(BELL_KEY) !== false; // on by default: the round bell is the timer itself

// ── sound: boxing bell + clap, synthesised by core/alerts.js (no audio files; master «صوت التنبيهات» applies too) ──
const BELL_CUE = { start: 'bell', end: 'bellEnd', warn: 'clap', soft: 'bellSoft' };
/** 'start' = one bell, 'end' = three quick bells, 'warn' = two claps (10 s left), 'soft' = one quiet bell (other phases). */
export function bell(ctx, kind) {
  if (!bellOn(ctx)) return false;
  return !!cue(BELL_CUE[kind] || 'bellSoft');
}

// ── small pieces ──
const vidRow = (keys) => h('div', { class: 'bx-vids' }, ...keys.map((k) => videoLink(k, { name: BOX_VIDEO_NAME[k] || '' })).filter(Boolean));
function comboEl(combo, cls = '') {
  return h('p', { class: `bx-combo ${cls}` }, h('span', { class: 'bx-code' }, ...bidiRanges(combo.code)), h('small', {}, combo.ar));
}
function note(id, title, text, extra = []) {
  return h('section', { class: 'glass wk-card hk-doc soft bx-note', role: 'note', 'aria-labelledby': id }, h('h3', { id }, title), h('p', {}, text), ...extra);
}

export async function renderBoxing(el, ctx, params = {}) {
  const today = ctx.today();
  const [health, prog, training, sessions] = await Promise.all([loadHealth(ctx.db), loadProgram(ctx.db).catch(() => ({ program: L.normalizeProgram(null) })),
    loadTraining(ctx.db).catch(() => ({})), ctx.db.getAll('sessions').catch(() => [])]);
  const program = prog.program;
  const reentry = (() => { try { return L.reentryInfo(ctx.settings, today); } catch { return null; } })();
  const minutes = [30, 35, 40].includes(+params.min) ? +params.min : ({ 30: 30, 45: 40 })[L.budgetFor(today)] || BOX_DEFAULT;
  const T = boxingToday({ startDay: program.startDay, today, reentry, deload: training.deload, bp: health.bp, budgetMin: minutes });
  const week = +params.week >= 1 && +params.week <= 12 ? Math.round(+params.week) : T.week;
  const cw = curriculumFor(week);
  // a previewed week keeps today's BP gate; its own deload weeks (6, 12) are technique-only too
  const P = week === T.week ? T.plan : boxingPlan({ week, budgetMin: minutes, tech: T.gate.tech || T.reentry || week === 6 || week === 12, iso: T.gate.iso });
  const speed = Math.min(60, Math.max(1, Math.round(+params.speed || 1)));
  const startDow = ctx.settings.get('weekStart') ?? 1;
  const go = (p) => ctx.go('workout/boxing', Object.fromEntries(Object.entries({ week: params.week, min: params.min, speed: params.speed, ...p }).filter(([, v]) => v !== undefined && v !== null && v !== '')));
  const cleanups = [];

  el.appendChild(band({ title: 'يوم الملاكمة', sub: ['الخميس · ', N(String(P ? Math.round(P.total / 60) : minutes)), ' دقيقة · مش بتتحسب جلسة رفع'], back: () => ctx.go('workout') }));
  const root = h('div', { class: 'hk-root bx-root' });
  el.appendChild(root);

  if (T.gate.stop) {
    root.appendChild(note('bx-stop-h', 'مفيش تمرين النهارده', T.why, [h('a', { class: 'btn ghost sm', href: '#/workout/heart?tab=bp' }, 'افتح سجل الضغط')]));
    root.appendChild(safetyCard());
    return () => {};
  }

  // ══ the player (main action first) ══
  const phases = P.phases;
  const base = Date.now();
  const now = speed > 1 ? () => base + (Date.now() - base) * speed : () => Date.now();
  const r = runner(phases, { now });
  const total = P.total;
  const rpe = {};
  let pendingRpe = null, warned = -1, lastIdx = -1, finished = false, saved = null, hiddenAt = 0;
  // lock-screen alert at the end of the running round (bag / shadow). Paused, between rounds or finished → cancelled.
  const boxPush = pushSyncer('box');
  const syncBoxPush = () => boxPush.set(!finished && r.running() && ROUND.has(phases[r.s.idx].kind) ? Date.now() + (r.left() * 1000) / speed : null);

  const ring = ringSvg(232, 14);
  const tNum = h('b', { class: 'num bx-clock' }, fmtClock(phases[0].dur));
  const tTag = h('span', { class: 'bx-tag' }, KIND_TAG[phases[0].kind]);
  const roundEl = h('p', { class: 'bx-round' });
  const nameEl = h('h4', { class: 'bx-name' });
  const subEl = h('p', { class: 'wk-muted bx-sub' });
  const comboBox = h('div', { class: 'bx-now-combo', hidden: true });
  const prog2 = h('p', { class: 'hk-prog' });
  const nextEl = h('p', { class: 'hk-next' });
  const rpeBox = h('div', { class: 'bx-rpe', hidden: true });
  const playIco = h('span', { class: 'bx-pi', 'aria-hidden': 'true' }, ico('play'));
  const play = h('button', { type: 'button', class: 'btn bx-play', dataset: { fk: 'bx-play' }, onclick: () => { toggle(); } }, playIco, h('span', {}, 'ابدأ الجولات'));
  const prev = h('button', { type: 'button', class: 'ibtn glass wk-flip bx-ctl', 'aria-label': 'المرحلة اللي فاتت', dataset: { fk: 'bx-prev' }, onclick: () => { r.jump(-1); onMove(0); } }, ico('skip'));
  const skip = h('button', { type: 'button', class: 'ibtn glass bx-ctl', 'aria-label': 'تخطّي للمرحلة الجاية', dataset: { fk: 'bx-skip' }, onclick: () => { const leaving = r.s.idx; const res = r.jump(1); if (res === 'finished') done(); else onMove(1, leaving); } }, ico('skip'));
  const endBtn = h('button', { type: 'button', class: 'btn ghost sm bx-end', hidden: true, dataset: { fk: 'bx-end' }, onclick: () => finishEarly() }, ico('check'), 'خلّص وسجّل اللي عملته');
  const list = h('ol', { class: 'hk-blocks' });
  const summary = h('div', { class: 'bx-summary', hidden: true, 'aria-live': 'polite' });
  const player = h('section', { class: 'glass wk-card hk-player bx-player', 'aria-labelledby': 'bx-pl-h' },
    h('h3', { id: 'bx-pl-h' }, 'جولات النهارده', h('small', {}, N(String(Math.round(total / 60))), ' دقيقة', T.tech ? ' · تكنيك بس' : '')),
    h('div', { class: 'bx-stage' },
      h('div', { class: 'wk-ring hk-ring bx-ring', role: 'timer', 'aria-label': 'الوقت الفاضل في المرحلة' }, ring.svg, h('div', { class: 'c' }, tNum, tTag)),
      h('div', { class: 'bx-info', 'aria-live': 'polite' }, roundEl, nameEl, comboBox, subEl, prog2, nextEl)),
    rpeBox,
    h('div', { class: 'wk-rx-ctrls bx-ctrls' }, prev, play, skip),
    endBtn, summary,
    h('details', { class: 'wk-fold bx-all' }, h('summary', {}, 'كل المراحل', h('small', {}, N(String(phases.length)), ' مرحلة')), list));
  root.appendChild(player);
  // live view (UX audit #11): the ring is a big tap-anywhere pause target while the rounds run
  player.querySelector('.bx-stage').addEventListener('click', (ev) => { if (!player.classList.contains('is-live') || ev.target.closest('button,a,input')) return; toggle(); });
  cleanups.push(() => document.documentElement.classList.remove('bx-live'));

  function signal(kind) { bell(ctx, kind); buzz(kind === 'end' ? [200, 100, 200, 100, 300] : kind === 'warn' ? [40, 60, 40] : 60); }
  // screen stays on while the rounds run (Profile › «خلّي الشاشة منوّرة أثناء التمرين»), re-taken on return by core/alerts.js
  function wake(on) { keepAwake(!!on, 'boxing'); }
  function toggle() {
    if (finished) return;
    const wasStarted = r.s.started;
    unlock(); // unlock WebAudio inside the tap
    r.toggle();
    if (r.running()) { if (!wasStarted || r.s.idx !== lastIdx) signal(ROUND.has(phases[r.s.idx].kind) ? 'start' : 'soft'); wake(true); }
    else wake(false);
    endBtn.hidden = !r.s.started;
    syncBoxPush();
    paint();
  }
  /** After a phase change. leaving = index of the phase just left (when it ran to its end or was skipped forward). */
  function onMove(dir, leaving = null) {
    const p = leaving !== null ? phases[leaving] : null;
    if (p && ROUND.has(p.kind) && dir > 0) { pendingRpe = p.id; signal('end'); }
    const cur = phases[r.s.idx];
    if (r.running()) setTimeout(() => { if (!finished && phases[r.s.idx] === cur) signal(ROUND.has(cur.kind) ? 'start' : 'soft'); }, p && ROUND.has(p.kind) && dir > 0 ? 700 : 0);
    syncBoxPush();
    paint();
  }
  function tick() {
    if (finished) return;
    const before = r.s.idx;
    const res = r.tick();
    if (res.finished) { if (ROUND.has(phases[before].kind)) pendingRpe = phases[before].id; signal('end'); done(); return; }
    if (res.moved) syncBoxPush();
    const back = document.visibilityState === 'visible';
    if (res.moved && back && hiddenAt && Date.now() - hiddenAt > 1500) {
      // back from a locked / hidden screen: say what happened while he was away
      ctx.toast(`${res.moved === 1 ? 'المرحلة اللي فاتت' : `${res.moved} مراحل`} خلصت والشاشة مقفولة · دلوقتي: ${phases[r.s.idx].label}`);
    }
    if (back) hiddenAt = 0;
    if (res.moved) {
      // after a locked screen several phases may have passed: one cue only, and the last finished round asks for RPE
      let lastRound = null; for (let i = before; i < r.s.idx; i++) if (ROUND.has(phases[i].kind)) lastRound = i;
      if (lastRound !== null) pendingRpe = phases[lastRound].id;
      const into = ROUND.has(phases[r.s.idx].kind);
      if (res.moved > 1) signal('soft');
      else if (ROUND.has(phases[before].kind)) { signal('end'); if (into) setTimeout(() => { if (!finished) signal('start'); }, 700); }
      else signal(into ? 'start' : 'soft');
    }
    const left = r.left();
    if (r.running() && ROUND.has(phases[r.s.idx].kind) && left <= 10 && left > 0 && warned !== r.s.idx && phases[r.s.idx].dur > 20) { warned = r.s.idx; signal('warn'); }
    paint();
  }
  function paintRpe() {
    rpeBox.textContent = '';
    const p = pendingRpe && phases.find((x) => x.id === pendingRpe);
    rpeBox.hidden = !p;
    if (!p) return;
    const id = `bx-rpe-${p.id}`;
    const v = rpe[p.id];
    rpeBox.append(h('p', { id, class: 'bx-rpe-q' }, p.kind === 'bag' ? 'جولة شوال ' : 'جولة شادو ', N(String(p.round)), ' خلصت · المجهود كام من 10؟'),
      h('div', { class: 'chips bx-rpe-chips', role: 'radiogroup', 'aria-labelledby': id },
        ...Array.from({ length: 10 }, (_, i) => i + 1).map((n) => h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(v === n), dataset: { fk: `rpe${n}` },
          onclick: () => { rpe[p.id] = n; haptic(10); paintRpe(); rpeBox.querySelector(`[data-fk="rpe${n}"]`)?.focus({ preventScroll: true }); } }, N(String(n))))),
      ...(v && P.rpeMax <= 6 && v > 6 ? [h('p', { class: 'wk-hint warn' }, 'النهارده تكنيك: خلّي الجولة الجاية 6 أو أقل.')] : []));
  }
  function paint() {
    const s = r.s, p = phases[s.idx], left = r.left();
    tNum.textContent = finished ? 'تم' : fmtClock(left);
    tTag.textContent = finished ? 'خلصت' : KIND_TAG[p.kind];
    roundEl.textContent = '';
    if (!finished && p.round) roundEl.append(p.kind === 'bag' ? 'جولة ' : 'شادو ', N(String(p.round)), ' من ', N(String(p.of)));
    else if (!finished) roundEl.append(KIND_TAG[p.kind]);
    nameEl.textContent = finished ? 'خلصت يوم الملاكمة' : p.label;
    nameEl.hidden = !finished && !!p.round; // the round counter already says «جولة 2 من 4»
    subEl.textContent = finished ? 'برافو. فك الرباط واشرب مية.' : p.sub;
    comboBox.textContent = '';
    comboBox.hidden = finished || p.kind !== 'bag';
    if (!comboBox.hidden) comboBox.append(h('small', { class: 'bx-k' }, p.light ? 'كومبو الأسبوع · خفيف' : 'كومبو الأسبوع'), comboEl(p.combo || cw.combo, 'big'));
    let gone = 0; for (let i = 0; i < s.idx; i++) gone += phases[i].dur; gone += p.dur - left;
    prog2.textContent = '';
    prog2.append('المرحلة ', N(`${Math.min(s.idx + 1, phases.length)}/${phases.length}`), ' · ', N(`${fmtClock(finished ? total : gone)} / ${fmtClock(total)}`));
    const nx = phases[s.idx + 1];
    nextEl.textContent = '';
    if (!finished) { if (nx) nextEl.append('الجاي: ', h('b', {}, nx.label), ' · ', N(fmtClock(nx.dur))); else nextEl.append('آخر مرحلة'); }
    const warn = !finished && r.running() && ROUND.has(p.kind) && left <= 10;
    ring.set(finished ? 1 : (p.dur - left) / p.dur, finished ? 'var(--ok-c)' : warn ? 'var(--amber)' : KIND_COLOR[p.kind]);
    player.classList.toggle('is-warn', warn && !reduced());
    player.dataset.kind = finished ? 'done' : p.kind;
    player.dataset.flood = finished ? 'done' : ROUND.has(p.kind) ? 'work' : 'rest';
    const liveNow = s.started && !finished;
    if (player.classList.contains('is-live') !== liveNow) { player.classList.toggle('is-live', liveNow); document.documentElement.classList.toggle('bx-live', liveNow); }
    const running = r.running();
    play.lastChild.textContent = finished ? 'خلصت' : running ? 'وقّف' : s.started ? 'كمّل' : 'ابدأ الجولات';
    if (playIco.dataset.i !== String(running)) { playIco.dataset.i = String(running); fill(playIco, ico(running ? 'pause' : 'play')); }
    play.setAttribute('aria-pressed', String(running));
    play.disabled = finished; prev.disabled = finished || s.idx === 0; skip.disabled = finished;
    if (lastIdx !== s.idx || finished) {
      lastIdx = s.idx;
      list.textContent = '';
      phases.forEach((x, i) => {
        const cur = !finished && i === s.idx, ok = finished || i < s.idx;
        list.appendChild(h('li', { class: cur ? 'cur' : ok ? 'done' : '', 'aria-current': cur ? 'step' : null, style: `--k:${KIND_COLOR[x.kind]}` },
          h('span', { class: 'ck', 'aria-hidden': 'true' }, ok ? ico('check') : null), h('span', {}, x.label), h('small', { class: 'num' }, fmtClock(x.dur))));
      });
      paintRpe();
    }
  }
  async function save(blocks, early = false) {
    if (saved) return saved;
    const mode = !T.tech ? 'full' : T.gate.tech ? 'tech' : T.deload ? 'deload' : 'reentry';
    const rec = boxingRecord({ week, mode, phases: blocks, rpe, combo: cw.combo, gate: T.gate.state, budget: minutes });
    if (early) rec.early = true;
    saved = rec;
    if (await safeWrite(ctx, () => putSession(ctx.db, rec))) {
      ctx.emit('session:changed', { id: rec.id, state: 'boxing' });
      const pf = blocks.find((b) => b.kind === 'pelvic');
      if (pf && pf.doneS >= 60) await safeWrite(ctx, () => patchHealth(ctx.db, (c) => { const k = c.kegel || {}; return { ...c, kegel: { ...k, start: k.start || rec.day, log: [...(k.log || []), { day: rec.day, at: rec.finishedAt, src: 'boxing', secs: pf.doneS }].slice(-500) } }; }));
    } else saved = null;
    return saved;
  }
  function paintSummary(rec) {
    summary.textContent = '';
    if (!rec) return;
    const bagDone = rec.rounds.filter((x) => x.kind === 'bag' && roundDone(x));
    const rs = rec.rounds.map((x) => x.rpe).filter(Number.isInteger);
    summary.hidden = false;
    summary.append(h('div', { class: 'bx-sum' },
      h('div', {}, h('small', {}, 'جولات شوال'), h('b', {}, N(String(bagDone.length)))),
      h('div', {}, h('small', {}, 'الوقت'), h('b', {}, N(String(rec.durationMin)), h('small', {}, ' د'))),
      h('div', {}, h('small', {}, 'متوسط المجهود'), h('b', {}, rs.length ? N((rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(1)) : '—'))),
    h('p', { class: 'wk-muted' }, 'اتسجّلت كدقايق كارديو، مش جلسة رفع.'));
  }
  async function done() {
    if (finished) return;
    finished = true; wake(false); cancelPhaseNotice(); boxPush.clear();
    paint();
    const rec = await save(phases.map((b, i) => ({ ...b, doneS: r.s.done[i] })));
    endBtn.hidden = true;
    paintSummary(rec);
    if (rec) ctx.toast('اتسجّل يوم الملاكمة. مش بيتحسب جلسة رفع.');
  }
  async function finishEarly() {
    if (finished || !r.s.started) return;
    if (!(await ctx.confirm({ title: 'نخلّص الجلسة هنا؟', text: 'هنسجّل الجولات اللي خلصتها بس.', confirmLabel: 'خلّص وسجّل' }))) return;
    // count what ran of the current phase, then close
    const left = r.left(); r.s.done[r.s.idx] = Math.max(r.s.done[r.s.idx], phases[r.s.idx].dur - left);
    if (ROUND.has(phases[r.s.idx].kind) && phases[r.s.idx].dur - left >= phases[r.s.idx].dur * 0.5) pendingRpe = phases[r.s.idx].id;
    r.s.finished = true; r.s.pausedLeft = 0;
    finished = true; wake(false); cancelPhaseNotice(); boxPush.clear(); paint();
    const rec = await save(phases.map((b, i) => ({ ...b, doneS: r.s.done[i] })), true);
    endBtn.hidden = true; paintSummary(rec);
    if (rec) ctx.toast('اتسجّل اللي عملته.');
  }
  paint();
  const iv = setInterval(tick, 250);
  const onVis = () => {
    if (document.visibilityState === 'visible') { cancelPhaseNotice(); tick(); if (r.running()) wake(true); return; }
    if (!r.running() || finished) return;
    hiddenAt = Date.now();
    const p = phases[r.s.idx], nx = phases[r.s.idx + 1];
    armPhaseNotice(ctx, { at: Date.now() + (r.left() * 1000) / speed, title: ROUND.has(p.kind) ? `${p.kind === 'bag' ? 'جولة' : 'شادو'} ${p.round} خلصت` : `خلص: ${p.label}`,
      body: nx ? `الجاي: ${nx.label}` : 'آخر مرحلة خلصت', url: '#/workout/boxing' });
  };
  document.addEventListener('visibilitychange', onVis);
  cleanups.push(() => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); wake(false); cancelPhaseNotice(); boxPush.clear(); });

  // ══ why today is technique-only (BP gate / deload / re-entry) ══
  if (T.tech && T.why) root.appendChild(note('bx-tech-h', T.gate.tech ? 'النهارده تكنيك بس: الضغط' : 'النهارده تكنيك بس', T.why,
    T.gate.tech ? [h('a', { class: 'btn ghost sm', href: '#/workout/heart?tab=bp' }, 'افتح سجل الضغط')] : []));

  // ══ length chips (30 / 35 / 40) ══
  root.appendChild(h('section', { class: 'bx-len', 'aria-labelledby': 'bx-len-l' },
    h('p', { id: 'bx-len-l', class: 'wk-budget-q' }, 'معاك كام دقيقة؟'),
    h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'bx-len-l' },
      ...[30, 35, 40].map((m) => h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(m === minutes), dataset: { fk: `bxmin${m}` },
        onclick: () => { if (m === minutes) return; if (r.s.started && !finished) { ctx.toast('غيّر الوقت قبل ما تبدأ أو بعد ما تخلص.'); return; } go({ min: String(m) }); } }, N(String(m)), ' د'))),
    h('p', { class: 'wk-muted' }, 'جولات الشوال بتتظبط على الوقت · شوال ', N(String(P.rounds.bag)), ' × ', N(String(P.rounds.bagLen / 60)), ' د',
      ' · مجهود ', h('bdi', {}, ...bidiRanges(P.rpe)), ' من 10')));

  // ══ this week's lesson ══
  const ws = boxingWeekStats(sessions, today, startDow);
  root.appendChild(h('section', { class: 'glass wk-card bx-week', 'aria-labelledby': 'bx-wk-h' },
    h('h3', { id: 'bx-wk-h' }, 'الأسبوع ', N(String(week)), ' من ', N('12'), h('small', {}, PHASES[cw.phase], ' · ', cw.title)),
    h('p', { class: 'bx-k' }, 'كومبو الأسبوع'), comboEl(cw.combo),
    h('h4', {}, 'ركّز على'), h('ul', { class: 'bx-cues' }, ...cw.cues.slice(0, 3).map((t) => h('li', {}, t))),
    h('details', { class: 'wk-fold bx-mis' }, h('summary', {}, 'أخطاء شائعة'), h('ul', { class: 'bx-cues x' }, ...cw.mistakes.map((t) => h('li', {}, t)))),
    h('h4', {}, 'اتفرّج قبل ما تبدأ'), vidRow(cw.videos),
    ws.sessions ? h('p', { class: 'wk-muted bx-wstat' }, 'الأسبوع ده: ', N(String(ws.rounds)), ' جولة شوال · ', N(String(ws.minutes)), ' دقيقة') : null));

  root.appendChild(safetyCard());
  root.appendChild(h('section', { class: 'glass wk-card bx-gear', 'aria-labelledby': 'bx-gear-h' },
    h('h3', { id: 'bx-gear-h' }, 'الحبل والرباط'), h('p', { class: 'wk-muted' }, 'لو أول مرة: اتعلّم لف الرباط ونط الحبل من الفيديوهين دول.'), vidRow(GEAR_VIDEOS)));

  // ══ preview another week ══
  root.appendChild(h('div', { class: 'hk-week bx-pick' },
    h('label', { for: 'bx-wk' }, 'الأسبوع'),
    h('select', { id: 'bx-wk', onchange: (e) => go({ week: +e.target.value === T.week ? undefined : e.target.value }) },
      ...Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === week ? true : null }, `${i + 1}${i + 1 === T.week ? ' (أسبوعك)' : ''} · ${CURRICULUM_TITLE(i + 1)}`))),
    h('small', {}, week === T.week ? 'ده أسبوعك في الخطة' : 'معاينة · الجلسة بتتسجّل على الأسبوع ده')));

  // ══ cues ══
  const bellId = 'bx-bell';
  // iOS: a locked iPhone only gets the round end through Web Push (Profile › «تنبيه والشاشة مقفولة», core/push.js)
  const IOS_NO_PUSH = 'الشاشة بتفضل منوّرة والجولات شغالة. الآيفون مش بيبعت تنبيه والشاشة مقفولة غير لو فعّلت «تنبيه والشاشة مقفولة» من الملف. من غيره: لو قفلتها، العدّاد بيكمّل وبنقولك اللي حصل أول ما تفتحها. مفتاح الصامت بيكتم الجرس.';
  const IOS_PUSH = '«تنبيه والشاشة مقفولة» متفعّل: لو قفلت الشاشة، هيوصلك إشعار لما الجولة اللي شغالة تخلص، والعدّاد بيكمّل وبنقولك اللي حصل أول ما تفتحها. مفتاح الصامت بيكتم الجرس.';
  const cueNote = h('p', { class: 'wk-muted' }, alertEnv().ios ? IOS_NO_PUSH : 'الشاشة بتفضل منوّرة والجولات شغالة. الصوت والاهتزاز من الملف › الأصوات والتنبيهات.');
  if (alertEnv().ios) pushStatus().then((st) => { if (st.on) cueNote.textContent = IOS_PUSH; }).catch(() => {});
  root.appendChild(h('details', { class: 'wk-fold hk-cues' }, h('summary', {}, 'الجرس والتنبيهات', h('small', {}, 'الجرس شغّال')),
    h('div', { class: 'hk-fold-body' },
      h('label', { class: 'wk-switch', for: bellId }, h('span', {}, 'جرس بداية ونهاية الجولة + تصقيفة قبل النهاية بـ 10 ثواني'),
        h('input', { type: 'checkbox', id: bellId, role: 'switch', checked: bellOn(ctx) ? true : null, onchange: (e) => { ctx.settings.set(BELL_KEY, e.target.checked); if (e.target.checked) bell(ctx, 'start'); } }), h('i', { 'aria-hidden': 'true' })),
      alertEnv().bgAlerts ? prefSwitch(ctx, 'notify', { onChange: async (on) => { if (!on) return true; const p = await askNotifyPermission(); if (p !== 'granted') { ctx.toast('الإشعارات مش مسموحة من المتصفح.'); return false; } return true; } }) : null,
      cueNote)));

  return () => cleanups.forEach((f) => f());
}
const CURRICULUM_TITLE = (w) => curriculumFor(w).title;

function safetyCard() {
  return h('section', { class: 'glass wk-card hk-tips bx-safe', 'aria-labelledby': 'bx-safe-h' },
    h('h3', { id: 'bx-safe-h' }, 'أمان قبل أي جولة'), h('ul', {}, ...SAFETY.map((t) => h('li', {}, t))),
    h('div', { class: 'bx-vids' }, videoLink('box.wraps', { name: BOX_VIDEO_NAME['box.wraps'] })));
}
