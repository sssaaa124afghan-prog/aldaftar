// #/workout/session — live set logging with the restored Solo Gym intelligence (parity §1, WP-Workout P1/P2).
// One tap «سجّل المجموعة» completes the current set and starts the rest timer in the hero ring.
// Timer is timestamp based (survives screen lock). Undo via ctx.toast. Sounds / TTS / notifications are opt-in.
import { fill } from '../../ui/dom.js';
import { h, N, ico, safeWrite, setsReps, bidiRanges } from './view.js';
import * as L from './logic.js';
import { loadAll, loadProgram, saveProgram, putSession, deleteSession, loadTraining, patchTraining, loadGateInputs } from './store.js';
import * as EA from './entry-assist.js';
import { pickExercise } from './picker.js';
import { parseNum, countText } from '../../ui/num.js';
import { ring } from '../../ui/ring.js';
import { pop, haptic, countUp, reduced } from '../../ui/anim.js';
import { holdRepeat } from '../../ui/hold.js';
import { nextTrainLabel } from './overview.js';
import { spark, loadCoach, pref, prefSwitch, askNotifyPermission, coachingFor } from './kit.js';
import { cue, alertNow, unlock, alertEnv, keepAwake, timerCues, lateText } from '../../core/alerts.js';
import { STRETCH_PROTOCOLS } from './content.js';
import { libById } from './exercises.js';
import { videoLink } from './exercise-videos.js';
import * as V from './voice.js';

const TYPES = [['normal', 'عادية'], ['drop', 'Drop'], ['rp', 'Rest-pause'], ['myo', 'Myo']];
const TYPE_LABEL = Object.fromEntries(TYPES);
const PRESETS = [30, 60, 90, 120, 150, 180];
const HERO = 132, HERO_STROKE = 10;

export async function renderSession(el, ctx) {
  const [{ all, live: found }, training, gi] = await Promise.all([loadAll(ctx.db), loadTraining(ctx.db), loadGateInputs(ctx.db, ctx.today()).catch(() => ({ bw: [] }))]);
  if (!found) {
    el.appendChild(h('div', { class: 'empty-state' },
      h('h2', {}, 'مفيش جلسة شغّالة'),
      h('p', {}, 'ابدأ تمرين النهارده من شاشة التمرين.'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.go('workout') }, 'روح للتمرين')));
    return;
  }
  const live = found;
  const history = L.finished(all);
  const seeded = L.finished(all, { seeds: true }); // + imported baselines: prefill only (add / swap exercise)
  let tr = training;
  const coach = await loadCoach(ctx);
  const priorCache = new Map();
  const prior = (e) => { const k = L.exKey(e) + '|' + e.exId; if (!priorCache.has(k)) priorCache.set(k, L.bests(history, e, { excludeId: live.id })); return priorCache.get(k); };
  const recentBest = (e) => L.recentBestE1rm(history, e, 15, { excludeId: live.id });
  const lastVol = L.lastDayVolume(history, live.dayKey, live.id);
  // body weight for the calibration ramp (latest entry; the owner's 72 kg when none is logged yet)
  const bwKg = [...(gi.bw || [])].filter((x) => x && +x.kg > 0 && x.day).sort((a, b) => String(a.day).localeCompare(String(b.day))).pop()?.kg || 72;
  // re-entry («أسبوع رجوع»): logic.js reentryInfo when engineer A's export exists, else the 7+ day gap flag on the session
  const reentry = (() => {
    if (live.reentry) return true;
    try {
      if (typeof L.reentryInfo === 'function') {
        const r = L.reentryInfo(ctx.settings, ctx.today());
        if (r === true || (r && (r.active || r.on || r.reentry))) return true;
      }
    } catch { /* optional export */ }
    return !!live.lighter;
  })();
  if (!live.cur || !live.exercises[live.cur.ex]) live.cur = L.nextOpen(live) || { ex: 0, set: 0 };
  // coach bridge contract: one prefill per fresh program-day session, applied before the first render (optional module)
  if (!live.coachPf && live.dayKey && !L.liveProgress(live).done) {
    live.coachPf = 'tried';
    try {
      const load = import.meta.glob('./coach-bridge.js')['./coach-bridge.js'];
      const m = load ? await load() : null;
      const pf = await m?.consumePrefill?.(ctx, live.dayKey);
      if (pf && V.applyPrefill(live, pf)) live.coachPf = 'applied';
    } catch { /* bridge missing or failed: keep the planned prefill */ }
    await safeWrite(ctx, () => putSession(ctx.db, live));
  }

  // drawn exercise thumbnails (optional module; the session works without it)
  let imgMod = null;
  import('./exercise-images.js').then((m) => { imgMod = m && typeof m.exerciseThumb === 'function' ? m : null; if (imgMod && !closed) safeDraw(); }).catch(() => { imgMod = null; });
  const root = h('div', { class: 'wk-session' });
  const announcer = h('p', { class: 'vh', 'aria-live': 'assertive' });
  el.append(root, announcer);
  let clockEl = null, closed = false, hero = null, dock = null, justSet = null, tipPending = false;
  // inline entry state: typing updates the model + the touched bits only (never a full re-render under the finger)
  let stepBlock = null; // current set's kg / reps steppers: live in the dock, right above the CTA (UX audit #2)
  let rowUI = [], stepUI = null, needHint = null, rirBox = null, typeChip = null, volEl = null, bestW = 0, apply = null, saveT = 0, redrawLater = false, lastTap = { ev: null, k: '', t: -1 };
  let lastUndo = null; // the latest «تراجع» of a logged set (voice «امسح» runs it)
  const vc = V.createVoiceUI({ h, ico, onInput: (alts) => onVoice(alts) });

  const save = () => { clearTimeout(saveT); saveT = 0; return safeWrite(ctx, () => putSession(ctx.db, live)); };
  const queueSave = () => { clearTimeout(saveT); saveT = setTimeout(() => { saveT = 0; save(); }, 400); };
  const flushSave = () => (saveT ? save() : null);
  const editing = () => { const a = document.activeElement; return !!(a && a.tagName === 'INPUT' && root.contains(a)); };
  /** Async redraws (AI tip, prefs) wait until the user leaves the field. */
  const safeDraw = (k) => { if (editing()) { redrawLater = true; return; } draw(k); };
  const curEx = () => live.exercises[live.cur.ex];
  const curSet = () => curEx()?.sets[live.cur.set];
  const restLeft = () => (live.rest ? (Number.isFinite(live.rest.pausedLeft) ? live.rest.pausedLeft : L.restRemaining(live.rest)) : 0);

  function recomputePR(e) {
    const p = prior(e); const so = [];
    for (const t of e.sets) {
      if (!t.done || !(+t.r > 0)) { delete t.pr; continue; }
      const pr = L.detectPR(t, p, so);
      if (pr) t.pr = { type: pr.type, delta: pr.delta, value: pr.value }; else delete t.pr;
      so.push(t);
    }
  }
  /** The first PR of the session (by time) gets the gold card; later ones only a brass tick (peak-end rule). */
  function peakSet() {
    let best = null;
    for (const e of live.exercises) for (const t of e.sets) if (t.pr && (!best || (t.at || 0) < (best.at || 0))) best = t;
    return best;
  }

  // ── actions ──
  async function complete() {
    const e = curEx(), t = curSet();
    if (!e || !t) return;
    if (t.done) { live.cur = L.nextOpen(live, live.cur.ex) || live.cur; await save(); return draw(); }
    if (EA.needsWeight(e, t)) { focusWeight(live.cur.set); return; } // loaded lift at 0 kg never logs (UX B3)
    if (!(+t.r > 0)) return;
    carryAcc = null; clearTimeout(carryT); // the carried values are on screen; the set toast takes the one toast slot
    const was = { cur: { ...live.cur }, rest: live.rest };
    // a tap during a running rest ends it early: say so (toast + cue), never a silent state change (UX audit #2)
    const cutRest = !!(live.rest && !Number.isFinite(live.rest.pausedLeft) && L.restRemaining(live.rest) > 0);
    t.done = true; t.at = Date.now();
    if ((t.rir === null || t.rir === undefined) && Number.isFinite(t.rirEst)) t.rirEst = L.estimateRir(t.w, t.r, recentBest(e));
    recomputePR(e);
    const exIdx = live.cur.ex;
    const nx = L.nextAfter(live, exIdx);
    if (nx.rest === 'none' || !nx.cur) live.rest = null;
    else if (nx.rest === 'superset') live.rest = { ...L.startRest(e, Date.now(), { total: e.fill ? L.fillRest(live, exIdx) : L.groupRest(live, exIdx) }), fromId: e.exId, forId: live.exercises[nx.cur.ex].exId, forSet: nx.cur.set, ss: true };
    else live.rest = { ...L.startRest(e), fromId: e.exId, forId: live.exercises[nx.cur.ex].exId, forSet: nx.cur.set };
    if (nx.cur) live.cur = nx.cur;
    justSet = t;
    haptic(t.pr ? 30 : 12, { double: !!t.pr }); // inside the tap (iOS switch haptic needs the gesture); PR = two ticks
    unlock(); cue(t.pr ? 'pr' : 'set'); // inside the tap: unlocks WebAudio on iOS for the rest-end cue later
    if (cutRest) cue('relax', { delay: 0.15 }); // second, lower note = «rest cancelled»
    if (live.rest && !alertTipSeen()) tipPending = true;
    await save();
    draw('done');
    const idx = e.sets.indexOf(t) + 1;
    const ssHop = nx.rest === 'none' && nx.cur && nx.cur.ex !== exIdx;
    const undo = async () => {
      if (lastUndo === undo) lastUndo = null;
      t.done = false; delete t.at; recomputePR(e);
      live.cur = was.cur; live.rest = null;
      await save(); draw('done');
    };
    lastUndo = undo;
    ctx.toast(t.pr ? `رقم شخصي جديد · ${L.fmtW(t.w)} × ${t.r}` : cutRest ? `المجموعة ${idx} اتسجّلت · الراحة اللي فاتت اتلغت` : ssHop ? `سوبر سِت · على ${live.exercises[nx.cur.ex].name} من غير راحة` : `المجموعة ${idx} اتسجّلت`, { action: { label: 'تراجع', run: undo } });
    if (!e.sets.some((s) => !s.done)) afterExercise(e);
    if (!L.nextOpen(live)) announce('خلصت كل المجموعات. اقفل الجلسة لما تكون جاهز.');
  }

  /** After the LAST set of an exercise: optional one AI tip (opt-in, max 1 call per exercise). */
  async function afterExercise(e) {
    if (!coach || !pref(ctx, 'aiTip') || e.aiTipAsked) return;
    e.aiTipAsked = true; save();
    try {
      const res = await coach.askCoach(ctx, { intent: 'set-tip', prompt: `خلصت ${e.name}. نصيحة واحدة قصيرة للجلسة الجاية.`, extra: { liveSession: compact(), exercise: compactEx(e) } });
      const text = String(res?.text || '').trim().slice(0, 400);
      if (text) { e.aiTip = text; save(); if (!closed) safeDraw(); }
    } catch { /* quiet: tip is optional */ }
  }

  // ── inline entry: one set changes only itself ──
  /** Model write for set j of the current exercise; repaints in place (no list re-render), saves debounced. */
  function setField(j, field, v, src) {
    const e = curEx(), s = e?.sets[j];
    if (!s || v === null) return;
    if (field === 'w') {
      if (+s.w === v) return;
      if (!apply || apply.e !== e || apply.j !== j) apply = { e, j, from: +s.w };
      s.w = v; s.wEd = true;
      // carry forward: the later open sets he has not edited follow this weight (visible at once; one Undo in the toast)
      noteCarry(e, j, EA.carryWeight(e.sets, j));
      // a typed weight means he knows it: the guided ramp steps aside
      if (e.calib && e.calib.locked === undefined) e.calib = { ...e.calib, skip: true };
    } else { if (+s.r === v) return; s.r = v; }
    if (s.done) recomputePR(e);
    paintLive(src); queueSave();
  }
  // ── carry-forward Undo: one toast per edit burst (field blur, or 1.2 s after the last ± tap) ──
  let carryAcc = null, carryT = 0;
  function noteCarry(e, j, before) {
    if (!before.length) return;
    if (!carryAcc || carryAcc.e !== e || carryAcc.j !== j) { flushCarry(); carryAcc = { e, j, before: new Map() }; }
    for (const [k, w] of before) if (!carryAcc.before.has(k)) carryAcc.before.set(k, w);
  }
  function flushCarry() {
    clearTimeout(carryT); carryT = 0;
    const c = carryAcc; carryAcc = null;
    if (!c || closed) return;
    const ks = [...c.before.keys()].filter((k) => c.e.sets[k] && !c.e.sets[k].done && +c.e.sets[k].w !== +c.before.get(k));
    if (!ks.length) return;
    const w = c.e.sets[c.j]?.w;
    ctx.toast(`${L.fmtW(w)} كجم اتنقل ${ks.length === 1 ? 'للمجموعة' : 'للمجموعات'} ${ks.map((k) => k + 1).join(' و')}`, { action: { label: 'تراجع', run: async () => {
      for (const k of ks) if (c.e.sets[k] && !c.e.sets[k].done) c.e.sets[k].w = c.before.get(k);
      await save(); if (!closed) paintLive();
    } } });
  }
  const carrySoon = () => { clearTimeout(carryT); carryT = setTimeout(flushCarry, 1200); };
  /** ± stepper on the current set: exact delta, guarded against a duplicated activation of the same tap. */
  function adjust(field, delta, ev) {
    // one handler (click) per button; a duplicated dispatch of the very same activation is dropped
    if (ev && (ev === lastTap.ev || (lastTap.k === `${field}${delta}` && ev.timeStamp === lastTap.t))) return;
    lastTap = { ev, k: `${field}${delta}`, t: ev?.timeStamp ?? -1 };
    const t = curSet(); if (!t) return;
    setField(live.cur.set, field, L.stepField(field, field === 'w' ? t.w : t.r, delta), null);
    if (field === 'w') carrySoon();
  }
  const wStepNow = () => L.incFor(curSet()?.w || 0);
  /** Wire one kg / reps input: select-all on focus, model on input, Enter kg → reps, Enter reps → complete. */
  function bindField(el, field, jf, next) {
    el.addEventListener('focus', () => {
      const j = jf();
      const v0 = el.value;
      try { el.select(); } catch { /* ignore */ }
      // mobile browsers may drop the selection on touchend: re-select once, but never after the user started typing
      setTimeout(() => { try { if (document.activeElement === el && el.value === v0) el.select(); } catch { /* ignore */ } }, 0);
      if (live.cur.set !== j) { live.cur = { ex: live.cur.ex, set: j }; paintLive(el); queueSave(); }
    });
    el.addEventListener('input', () => {
      const v = L.cleanField(field, parseNum(el.value));
      if (v === null && el.value.trim() !== '') el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      setField(jf(), field, v, el);
    });
    el.addEventListener('blur', () => {
      flushSave();
      if (field === 'w') flushCarry();
      const s = curEx()?.sets[jf()];
      if (s) el.value = field === 'w' ? L.fmtW(s.w) : String(s.r);
      el.removeAttribute('aria-invalid');
      setTimeout(() => { if (redrawLater && !editing() && !closed) { redrawLater = false; draw(); } }, 0);
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing) return;
      ev.preventDefault();
      if (field === 'w' && next) { next()?.focus(); return; }
      const j = jf(); el.blur(); completeAt(j);
    });
  }
  function completeAt(j) {
    const e = curEx(), s = e?.sets[j];
    if (!s) return;
    live.cur = { ex: live.cur.ex, set: j };
    if (EA.needsWeight(e, s)) { paintLive(); focusWeight(j); return; }
    if (!(+s.r > 0)) { paintLive(); ctx.toast('اكتب عدد العدّات الأول.'); rowUI[j]?.r.focus(); return; }
    return complete();
  }
  function toggleDone(j) { const s = curEx()?.sets[j]; if (!s) return; if (s.done) reopen(j); else completeAt(j); }
  function reopen(j) {
    const e = curEx(), s = e?.sets[j];
    if (!s || !s.done) return;
    const was = { at: s.at, cur: { ...live.cur }, rest: live.rest };
    s.done = false; delete s.at; recomputePR(e); live.rest = null; live.cur = { ex: live.cur.ex, set: j };
    save(); draw(`ck${j}`);
    ctx.toast(`المجموعة ${j + 1} رجعت مفتوحة`, { action: { label: 'تراجع', run: async () => {
      s.done = true; s.at = was.at; recomputePR(e); live.cur = was.cur; live.rest = was.rest; await save(); draw();
    } } });
  }
  /** «طبّق على الباقي»: for later sets he edited himself (untouched ones already follow by carry-forward) — one tap, Undo. */
  function applyRest(j) {
    const e = curEx();
    if (!apply || apply.e !== e || apply.j !== j) return;
    const peers = EA.editedPeers(e.sets, j);
    apply = null;
    if (!peers.length) { paintLive(); return; }
    const before = L.applyWeight(e.sets, j, peers);
    for (const k of peers) delete e.sets[k].wEd; // they follow set j again from now on
    rowUI[j]?.ck.focus({ preventScroll: true });
    save(); paintLive();
    ctx.toast(`اتطبّق ${L.fmtW(e.sets[j].w)} كجم على ${countText(peers.length, 'set')} كمان`, { action: { label: 'تراجع', run: async () => {
      for (const [k, w] of before) if (e.sets[k]) { e.sets[k].w = w; e.sets[k].wEd = true; }
      await save(); if (!closed) paintLive();
    } } });
  }
  function deleteSet(j) {
    const e = curEx();
    const cur0 = { ...live.cur }, rest0 = live.rest;
    const res = L.removeSet(e.sets, j, live.cur.set);
    if (!res) { ctx.toast('دي آخر مجموعة · استخدم «تخطّى التمرين» من القايمة.'); return; }
    live.cur = { ex: live.cur.ex, set: res.cur };
    if (live.rest && live.rest.forId === e.exId && live.rest.forSet === j) live.rest = null;
    apply = null; recomputePR(e);
    save(); draw();
    ctx.toast(`اتحذفت المجموعة ${j + 1}`, { action: { label: 'تراجع', run: async () => {
      e.sets.splice(j, 0, res.removed); live.cur = cur0; live.rest = rest0; recomputePR(e); await save(); draw();
    } } });
  }
  function setSheet(j) {
    const e = curEx(), s = e?.sets[j];
    if (!s) return;
    const item = (label, iconName, run, cls = '') => h('button', { type: 'button', class: `menu-item ${cls}`, onclick: () => { api.close(); run(); } }, ico(iconName), label);
    const api = ctx.sheet({ title: `المجموعة ${j + 1} · ${e.name}`, body: h('div', {},
      item(s.done ? 'افتح المجموعة تاني' : 'سجّل المجموعة', 'check', () => toggleDone(j)),
      item(`النوع: ${TYPE_LABEL[s.type || 'normal']}`, 'bars', () => setTypeSheet(j)),
      e.sets.length > 1 ? item('احذف المجموعة', 'trash', () => deleteSet(j), 'wk-danger') : null) });
  }
  /** «كله زي الخطة»: log every open set of this exercise as prefilled, then move on (one Undo brings them all back). */
  async function logAsPlanned() {
    const e = curEx();
    if (!e) return;
    const zero = e.sets.findIndex((t) => !t.done && EA.needsWeight(e, t));
    if (zero >= 0) { focusWeight(zero); return; }
    const was = { cur: { ...live.cur }, rest: live.rest };
    const idx = L.logRemaining(e.sets, Date.now());
    if (!idx.length) return;
    recomputePR(e);
    const exIdx = live.cur.ex;
    const nx = L.nextAfter(live, exIdx);
    live.rest = null;
    if (nx.cur) live.cur = nx.cur;
    await save(); draw('done');
    ctx.toast(`اتسجّل ${countText(idx.length, 'set')} زي الخطة`, { action: { label: 'تراجع', run: async () => {
      for (const k of idx) { const t = e.sets[k]; if (t) { t.done = false; delete t.at; delete t.asPlanned; } }
      recomputePR(e); live.cur = was.cur; live.rest = was.rest; await save(); draw();
    } } });
    if (!e.sets.some((t) => !t.done)) afterExercise(e);
    if (!L.nextOpen(live)) announce('خلصت كل المجموعات.');
  }
  /** 0-kg guard target: select set j and put the cursor in the kg field (the big stepper field when it is the current set). */
  function focusWeight(j = live.cur.set) {
    if (live.cur.set !== j) { live.cur = { ex: live.cur.ex, set: j }; paintLive(); }
    const el = stepUI?.w || rowUI[j]?.w;
    if (!el) return;
    el.focus({ preventScroll: true });
    try { el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch { /* ignore */ }
    announce('اكتب الوزن الأول. التمرين ده بوزن.');
  }

  // ── first-session calibration: guided ramp, three answers, no typing (UX #10) ──
  // first-time ramp: answered in the dock (in place of the CTA, under the A1/A2 strip in a superset), never as a popup
  const calibOn = (e = curEx()) => !!e && EA.needsCalibration(e) && !!curSet() && !curSet().done;
  function calibState(e) {
    if (!e.calib || e.calib.locked !== undefined || e.calib.skip) e.calib = EA.calibStart(e, bwKg, { reentry, reps: L.parseReps(e.reps)?.lo || 8 });
    return e.calib;
  }
  async function calibAnswer(feel) {
    const e = curEx(); if (!e || !calibOn(e)) return;
    const prev = calibState(e);
    const nx = EA.calibNext(prev, feel);
    e.calib = nx;
    haptic(12);
    if (nx.locked === undefined) {
      await save(); drawDock();
      dock?.querySelector('[data-fk="cal-ok"]')?.focus({ preventScroll: true });
      announce(`جرّب ${L.fmtW(nx.w)} كجم × ${nx.r}`);
      return;
    }
    const before = EA.applyCalibration(e.sets, nx.locked);
    await save(); draw('done');
    const per = nx.eq === 'دمبل' ? ' لكل إيد' : '';
    ctx.toast(`وزن الشغل ${L.fmtW(nx.locked)} كجم${per} · اتحط على كل المجموعات`, { action: { label: 'تراجع', run: async () => {
      for (const [k, w] of before) if (e.sets[k] && !e.sets[k].done) e.sets[k].w = w;
      e.calib = prev; await save(); if (!closed) draw('done');
    } } });
  }
  function skipCalib() {
    const e = curEx(); if (!e) return;
    e.calib = { ...(e.calib || {}), skip: true };
    save(); draw(); focusWeight(live.cur.set);
  }
  function calibPanel(e) {
    const c = calibState(e);
    const per = c.eq === 'دمبل' ? ' لكل إيد' : '';
    const bar = c.eq === 'بار' && +c.w === 20 ? ' (البار فاضي)' : '';
    const ok = reentry ? '3–4' : '3';
    const chip = (feel, fk, label, sub) => h('button', { type: 'button', class: `wk-calc wk-calc-${feel}`, dataset: { fk }, onclick: () => calibAnswer(feel) },
      h('b', {}, label), h('small', {}, bidiRanges(sub)));
    return h('div', { class: 'wk-calib', role: 'group', 'aria-labelledby': 'wk-cal-h' },
      h('p', { class: 'wk-cal-h', id: 'wk-cal-h' }, h('span', {}, 'أول مرة · نلاقي وزنك'), h('small', {}, 'خطوة ', N(String(c.n)), ' · مش بتتحسب في الحجم')),
      h('p', { class: 'wk-cal-do' }, 'اعمل ', N(String(c.r)), ' عدّات بـ ', N(L.fmtW(c.w), undefined, 'wk-cal-w'), ' كجم', per, bar, '، وقولّي كانت إزاي:'),
      h('div', { class: 'wk-cal-chips' },
        chip('easy', 'cal-easy', 'سهل', 'فاضل 5+'),
        chip('ok', 'cal-ok', 'مناسب', `فاضل ${ok}`),
        chip('hard', 'cal-hard', 'تقيل', 'فاضل 2 أو أقل')),
      h('div', { class: 'wk-cal-foot' }, h('button', { type: 'button', class: 'linkbtn wk-cal-skip', onclick: skipCalib }, 'أعرف وزني · هكتبه'), vc.mic));
  }

  // ── voice / typed set logging: fills the CURRENT set in place (paintLive), never other sets ──
  async function onVoice(alts) {
    if (closed) return;
    const cmd = V.parseBest(alts);
    const e = curEx(), j = live.cur.set;
    const res = V.resolveCommand(cmd, e, j);
    if (res.action === 'error') { vc.say(res.msg); return; }
    if (res.action === 'undo') {
      if (vc.cancelPending()) { vc.say('اتلغى.'); return; }
      if (lastUndo) { const u = lastUndo; lastUndo = null; await u(); vc.say('رجّعنا آخر مجموعة.'); return; }
      vc.say('مفيش حاجة نرجّعها.'); return;
    }
    if (res.action === 'next') {
      const n = live.exercises.length;
      const nx = n > 1 ? L.nextOpen(live, (live.cur.ex + 1) % n) : null;
      if (!nx || nx.ex === live.cur.ex) { vc.say('مفيش تمرين تاني مفتوح.'); return; }
      vc.clear(); select(nx.ex, nx.set); haptic(10);
      announce(`التمرين الجاي: ${live.exercises[nx.ex].name}`);
      return;
    }
    const t = curSet();
    if (!t) { vc.say('مفيش مجموعة مفتوحة دلوقتي.'); return; }
    vc.cancelPending();
    const before = { w: t.w, r: t.r, rir: t.rir ?? null };
    const snap = e.sets.map((x) => ({ w: x.w, wEd: x.wEd })); // ✕ also takes back the carried weights
    setField(j, 'w', Math.round(res.w * 100) / 100, null);
    setField(j, 'r', res.r, null);
    if (res.rir !== null && res.rir !== undefined) { t.rir = Math.min(4, res.rir); fillRir(); }
    paintLive(); haptic(10);
    const label = `${L.fmtW(t.w)} × ${t.r}`;
    announce(`المجموعة ${j + 1}: ${L.fmtW(t.w)} كجم في ${t.r}`);
    if (res.commit) { vc.clear(); await completeAt(j); return; }
    vc.chip(label, () => {
      const i = live.exercises.indexOf(e);
      if (i < 0 || !e.sets[j] || e.sets[j].done) return;
      live.cur = { ex: i, set: j }; completeAt(j);
    }, () => {
      if (!e.sets[j] || e.sets[j].done) return;
      Object.assign(e.sets[j], { w: before.w, r: before.r, rir: before.rir });
      snap.forEach((x, k) => { const t2 = e.sets[k]; if (!t2 || t2.done || k < j) return; t2.w = x.w; if (x.wEd) t2.wEd = true; else delete t2.wEd; });
      carryAcc = null; apply = null; paintLive(); queueSave();
    });
  }

  // ── Zone 2 after lifting (last step of the session) ──
  const z2On = () => !!(live.z2 && live.z2.plan);
  const liftMin = () => ((live.z2?.startedAt || Date.now()) - (live.startedMs || Date.parse(live.startedAt))) / 60000;
  const z2Plan = () => (live.z2?.total ? Math.round(live.z2.total / 60) : L.z2Minutes(liftMin(), { deload: !!live.deload }));
  const z2Left = () => (live.z2?.startedAt ? Math.max(0, Math.ceil((live.z2.startedAt + live.z2.total * 1000 - Date.now()) / 1000)) : 0);
  async function startZ2() {
    const min = L.z2Minutes(liftMin(), { deload: !!live.deload });
    live.z2 = { ...live.z2, plan: true, startedAt: Date.now(), total: min * 60 };
    live.rest = null;
    await save(); draw('top');
    announce(`Zone 2 بدأ · ${min} دقايق`);
  }
  function setRir(v) { const t = curSet(); if (!t) return; t.rir = t.rir === v ? null : v; if (t.done) recomputePR(curEx()); save(); fillRir(); drawDock(); }
  function select(i, j) { live.cur = { ex: i, set: j }; save(); draw(); }
  function addSet() {
    const e = curEx(); const last = e.sets[e.sets.length - 1] || { w: 0, r: L.parseReps(e.reps)?.lo || 8 };
    e.sets.push({ w: last.w, r: last.r, rir: null, done: false });
    if (curSet()?.done) live.cur = { ex: live.cur.ex, set: e.sets.length - 1 };
    save(); draw();
  }
  function skipRest() { live.rest = null; tipPending = false; save(); draw(); focusDock(); }
  function shiftRest(sec) {
    if (!live.rest) return;
    if (Number.isFinite(live.rest.pausedLeft)) live.rest.pausedLeft = Math.max(0, live.rest.pausedLeft + sec);
    else live.rest.endsAt = Math.max(Date.now(), live.rest.endsAt + sec * 1000);
    live.rest.total = Math.max(live.rest.total, restLeft());
    live.rest.fired = {}; // the 10 s tick / 3-2-1 replay for the new end time
    save(); paintRest();
  }
  function togglePause() {
    if (!live.rest) return;
    if (Number.isFinite(live.rest.pausedLeft)) { live.rest.endsAt = Date.now() + live.rest.pausedLeft * 1000; delete live.rest.pausedLeft; live.rest.fired = {}; }
    else live.rest.pausedLeft = L.restRemaining(live.rest);
    save(); draw('pause');
  }
  function startTimer(sec, { save: keep = false } = {}) {
    const e = curEx();
    if (keep && e) { e.restS = sec; persistRestOverride(e, sec); }
    live.rest = { ...L.startRest(e, Date.now(), { total: sec }), fromId: e?.exId, forId: e?.exId, forSet: live.cur.set };
    save(); draw();
  }
  async function persistRestOverride(e, sec) {
    const { program, rec } = await loadProgram(ctx.db);
    const day = program.days[live.dayKey];
    const it = day?.items.find((x) => x.id === e.exId);
    if (!it) return;
    it.restS = sec;
    await safeWrite(ctx, () => saveProgram(ctx.db, program, rec));
  }
  function presetsSheet() {
    const e = curEx();
    let keep = false;
    const body = h('div', {},
      h('p', { class: 'wk-muted' }, 'اختار مدة الراحة. القاعدة: مركّب 2:30، عزل 1:30، وبعد جولة سوبر سِت 1:30 أو 0:40.'),
      h('div', { class: 'chips wk-gap wk-bigchips' }, ...PRESETS.map((s) => h('button', { type: 'button', class: 'chip', onclick: () => { api.close(); startTimer(s, { save: keep }); } }, N(L.fmtClock(s))))),
      e ? h('label', { class: 'wk-switch wk-mt', for: 'wk-keep' }, h('span', {}, `خلّيها الراحة الثابتة لـ ${e.name}`),
        h('input', { type: 'checkbox', id: 'wk-keep', role: 'switch', onchange: (ev) => { keep = ev.target.checked; } }), h('i', { 'aria-hidden': 'true' })) : null);
    const api = ctx.sheet({ title: 'مؤقّت الراحة', body });
  }

  function setTypeSheet(j = live.cur.set) {
    const t = curEx()?.sets[j]; if (!t) return;
    const body = h('div', { class: 'chips wk-bigchips', role: 'radiogroup', 'aria-label': 'نوع المجموعة' },
      ...TYPES.map(([k, lbl]) => h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String((t.type || 'normal') === k),
        onclick: () => { if (k === 'normal') delete t.type; else t.type = k; recomputePR(curEx()); save(); api.close(); draw(); } }, lbl)));
    const api = ctx.sheet({ title: 'نوع المجموعة', body: h('div', {}, body, h('p', { class: 'wk-muted wk-mt' }, 'مجموعة الـ Drop مش بتتحسب رقم شخصي.')) });
  }
  function noteSheet() {
    const e = curEx();
    const ta = h('textarea', { id: 'wk-note', rows: 3, maxlength: 300, value: e.note || '' });
    ta.value = e.note || '';
    const api = ctx.sheet({ title: `ملاحظة · ${e.name}`, body: h('div', {},
      e.lastNote ? h('p', { class: 'wk-muted' }, 'المرة اللي فاتت: ', e.lastNote) : null,
      h('div', { class: 'field' }, h('label', { for: 'wk-note' }, 'إعداد الجهاز، إحساس، فورم'), ta)),
    actions: [{ label: 'احفظ الملاحظة', run: () => { e.note = ta.value.trim().slice(0, 300); save(); draw(); } }] });
    return api;
  }

  async function addExercise() {
    const id = await pickExercise(ctx, { exclude: live.exercises.map((e) => e.lib).filter(Boolean) });
    if (!id) return;
    const it = L.itemFromLib(id);
    const ex = L.liveExercise(it, seeded, { deload: live.deload, lighter: live.lighter, readiness: live.readiness });
    const at = Math.min(live.exercises.length, live.cur.ex + 1);
    live.exercises.splice(at, 0, ex);
    if (!curSet() || curSet().done) live.cur = { ex: at, set: 0 };
    await save(); draw();
  }
  /** W35/W36/W64: same-muscle alternatives, preferred first; keeps the set count; pulls the new exercise's history. */
  function swapSheet(i = live.cur.ex) {
    const e = live.exercises[i];
    const alts = L.swapCandidates(e, { memory: tr.swapHistory || {}, home: !!live.home, exclude: live.exercises.map((x) => x.lib) });
    const pref0 = (tr.swapHistory || {})[L.exKey(e)];
    const body = h('div', { role: 'list' },
      live.home ? h('p', { class: 'wk-muted' }, 'وضع البيت: بدائل بوزن الجسم والدمبل بس.') : null,
      ...alts.slice(0, 14).map((a) => h('button', { type: 'button', class: 'list-row', role: 'listitem', onclick: () => { api.close(); doSwap(i, a.id); } },
        h('span', { class: 'grow' }, h('b', {}, a.ar), h('small', {}, `${a.en} · ${a.eq}`)),
        a.id === pref0 ? h('small', { class: 'wk-tag' }, 'اختيارك قبل كده') : h('small', { class: 'wk-kind' }, a.kind === 'compound' ? 'مركّب' : 'عزل'))),
      !alts.length ? h('p', { class: 'wk-muted' }, 'مفيش بديل لنفس العضلة. جرّب «ضيف تمرين».') : null);
    const api = ctx.sheet({ title: `بدّل ${e.name}`, body });
  }
  async function doSwap(i, libId) {
    const e = live.exercises[i];
    const it = { ...L.itemFromLib(libId), id: libId, sets: e.sets.length, reps: e.reps };
    const nx = L.liveExercise(it, seeded, { deload: live.deload, lighter: live.lighter, readiness: live.readiness });
    // keep done sets? only when none done: a swap replaces the exercise
    nx.swappedFrom = e.exId; if (e.ss) nx.ss = e.ss;
    live.exercises[i] = nx;
    live.cur = { ex: i, set: 0 };
    tr = { ...tr, swapHistory: { ...(tr.swapHistory || {}), [L.exKey(e)]: libId } };
    await safeWrite(ctx, () => patchTraining(ctx.db, { swapHistory: tr.swapHistory }));
    await save(); draw();
    ctx.toast(`اتبدّل لـ ${nx.name} · نفس عدد المجموعات`);
  }
  async function toggleHome() {
    const turnOn = !live.home;
    live.home = turnOn;
    if (turnOn) {
      const need = live.exercises.map((e, i) => ({ e, i })).filter(({ e }) => !e.sets.some((t) => t.done) && libById(e.lib) && !['وزن جسم', 'دمبل', 'أداة'].includes(libById(e.lib).eq));
      const plan = need.map(({ e, i }) => ({ i, from: e.name, to: L.swapCandidates(e, { memory: tr.swapHistory || {}, home: true })[0] })).filter((x) => x.to);
      if (plan.length) {
        const ok = await ctx.confirm({ title: 'نبدّل لبدائل البيت؟', text: plan.map((x) => `${x.from} ← ${x.to.ar}`).join('\n'), confirmLabel: `بدّل ${countText(plan.length, 'exercise')}` });
        if (ok) for (const x of plan) await doSwap(x.i, x.to.id);
      }
    }
    await save(); draw();
    ctx.toast(turnOn ? 'مكان التمرين: البيت' : 'مكان التمرين: الجيم');
  }
  function linkSuperset() {
    const i = live.cur.ex, e = live.exercises[i];
    if (e.ss) { const tag = e.ss; live.exercises.forEach((x) => { if (x.ss === tag) delete x.ss; }); save(); draw(); ctx.toast('اتفكّ السوبر سِت'); return; }
    const j = i + 1 < live.exercises.length ? i + 1 : -1;
    if (j < 0) { ctx.toast('مفيش تمرين بعده يتربط معاه.'); return; }
    const nb = live.exercises[j];
    const tag = nb.ss || L.nextSsTag(live.exercises);
    e.ss = tag; nb.ss = tag;
    save(); draw();
    ctx.toast(`سوبر سِت ${tag}: ${e.name} + ${nb.name}`);
  }
  async function finishExercise() {
    const e = curEx();
    for (const t of e.sets) if (!t.done) t.skipped = true;
    e.sets = e.sets.filter((t) => t.done);
    if (!e.sets.length) e.skipped = true;
    live.cur = L.nextOpen(live, live.cur.ex) || live.cur;
    await save(); draw();
  }
  async function skipExercise() {
    const e = curEx(); e.skipped = true;
    live.cur = L.nextOpen(live, live.cur.ex) || live.cur;
    await save(); draw();
  }
  function reorderSheet() {
    const body = h('ol', { class: 'wk-reorder' });
    const paint = () => {
      body.textContent = '';
      live.exercises.forEach((e, i) => {
        const doneN = e.sets.filter((t) => t.done).length;
        body.appendChild(h('li', { class: 'list-row' },
          h('button', { type: 'button', class: 'grow wk-jump', onclick: () => { live.cur = { ex: i, set: Math.max(0, e.sets.findIndex((t) => !t.done)) }; e.skipped = false; save(); draw(); api.close(); } },
            h('b', {}, e.name, e.ss ? h('span', { class: 'wk-tag' }, `سوبر ${e.ss}`) : null), h('small', {}, e.skipped ? 'متخطّي' : [N(`${doneN}/${e.sets.length}`), ' مجموعة'])),
          h('button', { type: 'button', class: 'ibtn', 'aria-label': `طلّع ${e.name} لفوق`, disabled: i === 0, onclick: () => move(i, -1) }, ico('chevron')),
          h('button', { type: 'button', class: 'ibtn wk-down', 'aria-label': `نزّل ${e.name} لتحت`, disabled: i === live.exercises.length - 1, onclick: () => move(i, 1) }, ico('chevron'))));
      });
    };
    const move = (i, d) => {
      const j = i + d; if (j < 0 || j >= live.exercises.length) return;
      const cur = curEx();
      [live.exercises[i], live.exercises[j]] = [live.exercises[j], live.exercises[i]];
      live.cur.ex = live.exercises.indexOf(cur);
      save(); paint(); draw();
    };
    paint();
    const api = ctx.sheet({ title: 'ترتيب التمارين', body });
  }
  function prefsSheet() {
    ctx.sheet({ title: 'إعدادات الجلسة', body: h('div', { class: 'wk-prefs' },
      h('p', { class: 'wk-muted' }, alertEnv().ios ? 'الصوت والاهتزاز شغالين والتطبيق مفتوح. لو قفلت الشاشة، التنبيه بييجي أول ما تفتحها. باقي الإعدادات في الملف › الأصوات والتنبيهات.' : 'الصوت شغال من الأول. باقي الإعدادات في الملف › الأصوات والتنبيهات.'),
      prefSwitch(ctx, 'sound'), prefSwitch(ctx, 'tts'),
      alertEnv().bgAlerts ? prefSwitch(ctx, 'notify', { onChange: async (on) => { if (!on) return true; const p = await askNotifyPermission(); if (p !== 'granted') { ctx.toast('الإشعارات مش مسموحة من المتصفح.'); return false; } return true; } }) : null,
      prefSwitch(ctx, 'swipe', { onChange: () => { setTimeout(() => safeDraw(), 0); return true; } }),
      coach ? prefSwitch(ctx, 'aiTip') : null) });
  }
  function compactEx(e) { return { name: e.name, en: e.en, muscle: e.muscle, reps: e.reps, note: e.note || null, sets: e.sets.map((t) => ({ w: t.w, r: t.r, rir: t.rir ?? null, done: !!t.done, type: t.type || null })) }; }
  function compact() { return { dayName: live.dayName, startedAt: live.startedAt, home: !!live.home, deload: !!live.deload, readiness: live.readiness ?? null, current: curEx()?.name, exercises: live.exercises.map(compactEx) }; }
  function askCoachSheet() { try { coach.openCoachSheet(ctx, { intent: 'workout', attach: { liveSession: compact() } }); } catch { ctx.toast('المدرب مش متاح دلوقتي.'); } }
  /** W61: AI suggests today's weights; shown as a proposal; applied only on confirm. */
  async function aiPlan() {
    ctx.toast('بنجهّز اقتراح المدرب…');
    let res;
    try { res = await coach.askCoach(ctx, { intent: 'session-plan', prompt: 'اقترح أوزان وعدّات النهارده لكل تمرين من سجلّي. رد بالأرقام بس.', extra: { liveSession: compact() } }); }
    catch { ctx.toast('المدرب مش متاح دلوقتي — جرّب تاني.'); return; }
    const acts = (res?.actions || []).filter((a) => a && a.type === 'workout.prefill' && Array.isArray(a.items));
    const items = acts.flatMap((a) => a.items).filter((x) => x && Number.isFinite(+x.w) && +x.w >= 0 && +x.w < 1000);
    const body = h('div', {}, h('p', { class: 'wk-ai-text' }, String(res?.text || 'مفيش اقتراح.').slice(0, 1500)),
      items.length ? h('ul', { class: 'wk-ai-list' }, ...items.map((x) => { const e = live.exercises.find((y) => y.exId === x.exId || y.name === x.name); return e ? h('li', {}, e.name, ' · ', N(`${L.fmtW(+x.w)} × ${+x.r || '—'}`)) : null; })) : null);
    ctx.sheet({ title: 'اقتراح المدرب للجلسة', body, actions: items.length ? [
      { label: 'طبّق على المجموعات الجاية', run: () => {
        for (const x of items) { const e = live.exercises.find((y) => y.exId === x.exId || y.name === x.name); if (!e) continue; for (const t of e.sets) if (!t.done) { t.w = L.round1(+x.w); if (+x.r > 0) t.r = Math.round(+x.r); } }
        save(); draw();
      } },
      { label: 'سيبه زي ما هو', ghost: true, run: () => {} }] : [] });
  }
  function menu() {
    const item = (label, iconName, run, cls = '') => h('button', { type: 'button', class: `menu-item ${cls}`, onclick: () => { api.close(); run(); } }, ico(iconName), label);
    const e = curEx();
    const body = h('div', {},
      item('ضيف تمرين', 'plus', addExercise),
      item('بدّل التمرين ده', 'repeat', () => swapSheet()),
      item(e?.ss ? 'فك السوبر سِت' : 'اربطه سوبر سِت مع اللي بعده', 'bolt', linkSuperset),
      item('خلّص التمرين ده', 'check', finishExercise),
      item('تخطّى التمرين ده', 'skip', skipExercise),
      item('رتّب التمارين', 'bars', reorderSheet),
      item(live.home ? 'مكان التمرين: البيت · رجّعه جيم' : 'مكان التمرين: الجيم · حوّل للبيت', 'home', toggleHome),
      item('عدّل في الخطة', 'edit', () => ctx.go('workout/plan', live.dayKey ? { day: live.dayKey } : undefined)),
      item('الأدوات: 1RM والأقراص والمؤقّت', 'timer', () => ctx.go('workout/tools', { from: 'session' })),
      coach ? item('اسأل المدرب عن الجلسة', 'msg', askCoachSheet) : null,
      coach ? item('اقتراح المدرب لأوزان النهارده', 'spark', aiPlan) : null,
      item('إعدادات الجلسة', 'settings', prefsSheet),
      item('اقفل الجلسة', 'check', finish),
      item('الغي الجلسة', 'trash', discard, 'wk-danger'));
    const api = ctx.sheet({ title: live.dayName, body });
  }
  async function discard() {
    const ok = await ctx.confirm({ title: 'نلغي الجلسة؟', text: 'المجموعات اللي سجّلتها في الجلسة دي هتتمسح.', confirmLabel: 'الغي الجلسة', danger: true });
    if (!ok) return;
    if (!(await safeWrite(ctx, () => deleteSession(ctx.db, live.id)))) return;
    closed = true;
    ctx.emit('session:changed', { id: live.id, state: 'discarded' });
    ctx.go('workout');
  }
  async function finish() {
    const open = live.exercises.reduce((n, e) => n + (e.skipped ? 0 : e.sets.filter((t) => !t.done).length), 0);
    const doneN = live.exercises.reduce((n, e) => n + e.sets.filter((t) => t.done && +t.r > 0).length, 0);
    if (!doneN) return discard();
    if (open) {
      const ok = await ctx.confirm({ title: 'نقفل الجلسة؟', text: `فاضل ${countText(open, 'set')} ماتسجّلتش. هنقفل بالموجود.`, confirmLabel: 'اقفل الجلسة' });
      if (!ok) return;
    }
    if (live.z2 && live.z2.startedAt && !live.z2.doneAt) live.z2.doneAt = Date.now();
    const { record } = L.finalize(live, history, new Date());
    if (!(await safeWrite(ctx, () => putSession(ctx.db, record)))) return;
    closed = true;
    ctx.emit('session:changed', { id: record.id, state: 'done' });
    const hist = [...history, record];
    try { await patchTraining(ctx.db, { poJournal: L.journalAfter(tr.poJournal, record, hist) }); } catch { /* journal is best effort */ }
    const { program } = await loadProgram(ctx.db);
    showSummary(ctx, record, hist, program.days[L.nextDayId(program, hist)]?.name || '', { coach });
  }

  function announce(text) { announcer.textContent = ''; requestAnimationFrame(() => { announcer.textContent = text; }); }

  const Z2 = () => h('bdi', { dir: 'ltr' }, 'Zone 2');
  function z2Card() {
    const started = !!live.z2.startedAt;
    return h('section', { class: 'sheet-card wk-z2', 'aria-labelledby': 'wk-z2-h' },
      h('h3', { id: 'wk-z2-h' }, 'آخر خطوة · ', Z2(), ' على العجلة', h('small', {}, N(String(z2Plan())), ' د')),
      h('p', { class: 'wk-muted' }, started ? 'خليك على نفس الإيقاع لحد ما المؤقّت يخلص.' : ['خلصت الرفع في ', N(String(Math.round(liftMin()))), ' د. بعدها دقيقة للعجلة و', Z2(), ' ', N(String(z2Plan())), ' د علشان الزيارة تفضل تحت الساعة.']),
      h('p', { class: 'wk-muted' }, 'اختبار الكلام: تقدر تتكلم جمل كاملة بس نفَسك أسرع (حوالي 120–140 نبضة).'),
      !started ? h('button', { type: 'button', class: 'btn ghost sm', onclick: finish }, 'اقفل من غير Zone 2') : null);
  }

  // ── render ──
  function draw(focusKey) {
    const fk = focusKey || document.activeElement?.dataset?.fk;
    const y = window.scrollY;
    root.textContent = '';
    const e = curEx(), t = curSet();
    const idx = live.cur.ex;
    const pr0 = prior(e);
    const prog = L.liveProgress(live);
    const vol = L.liveVolume(live);

    // top bar
    clockEl = N(L.fmtClock((Date.now() - (live.startedMs || Date.parse(live.startedAt))) / 1000));
    root.appendChild(h('header', { class: 'wk-top' },
      h('button', { type: 'button', class: 'ibtn wk-back', 'aria-label': 'رجوع للتمرين (الجلسة هتفضل شغّالة)', onclick: () => ctx.go('workout') }, ico('back')),
      h('div', { class: 'grow wk-top-mid' }, h('h1', {}, live.dayName), h('span', {}, 'التمرين ', N(String(idx + 1)), ' من ', N(String(live.exercises.length)), live.home ? ' · بيت' : ''),
        (() => { // «رجوع · الأسبوع 1 من 2 · سيب 4 عدّات» / «الأسبوع N · سيب X عدّات» (logic.js weekLine)
          const si = t && !t.done ? live.cur.set : null;
          const line = typeof L.weekLine === 'function' ? L.weekLine(live, e, si)
            : Number.isInteger(live.week) ? `الأسبوع ${live.week} · ${L.rirPhrase(L.rirTarget(e, live.week, si, e.sets.length))}` : '';
          return line ? h('span', { class: 'wk-meso' }, bidiRanges(line)) : null;
        })()),
      h('span', { class: 'wk-live', 'aria-label': 'مدة الجلسة' }, clockEl),
      h('button', { type: 'button', class: 'wk-endbtn', dataset: { fk: 'end' }, onclick: finish }, 'إنهاء'), // UX audit #8: finish in ≤ 2 taps
      h('button', { type: 'button', class: 'ibtn', 'aria-label': 'خيارات الجلسة', 'aria-haspopup': 'dialog', dataset: { fk: 'menu' }, onclick: menu }, ico('more'))));

    // live band: volume Δ + completion
    const dPct = lastVol ? Math.round(((vol - lastVol) / lastVol) * 100) : null;
    root.appendChild(h('div', { class: 'wk-livebar' },
      h('span', {}, 'الحجم ', N(L.fmtInt(vol), undefined, 'wk-vol'), ' كجم',
        dPct !== null && vol && (dPct >= 0 || !L.nextOpen(live)) ? [' · ', N(`${dPct > 0 ? '+' : dPct < 0 ? '−' : ''}${Math.abs(dPct)}%`, undefined, dPct >= 0 ? 'wk-up' : 'wk-down'), ' عن المرة اللي فاتت']
          : lastVol ? [' · المرة اللي فاتت ', N(L.fmtInt(lastVol))] : null),
      h('span', {}, N(`${prog.done}/${prog.total}`), ' مجموعة'),
      h('div', { class: 'wk-progress', role: 'progressbar', 'aria-label': 'المجموعات المتسجّلة', 'aria-valuemin': '0', 'aria-valuemax': String(prog.total), 'aria-valuenow': String(prog.done) },
        h('i', { style: { transform: `scaleX(${prog.total ? prog.done / prog.total : 0})` } }))));

    const pinned = String(ctx.settings.get('pinnedNote') || '').trim();
    if (pinned) root.appendChild(h('p', { class: 'wk-pinned' }, ico('edit'), h('span', {}, pinned)));

    // what the autopilot / balance engine changed for today (why + undo lives on the overview before start)
    if (!prog.done && live.plan && live.plan.changes && live.plan.changes.length) {
      root.appendChild(h('details', { class: 'wk-fold wk-planfold' }, // collapsed: the session opens on the current set (UX audit #2)
        h('summary', {}, ico('spark'), 'خطة النهارده', h('small', {}, countText(live.plan.changes.length, 'change'), ' · ', N(String(live.plan.minutes)), ' د من ', N(String(live.plan.budget)))),
        h('ul', {}, ...live.plan.changes.map((c) => h('li', {}, c.text)))));
    }
    // mobility prep at the start (W51)
    if (!prog.done) {
      const mob = L.mobilityFor(live.exercises);
      root.appendChild(h('details', { class: 'wk-fold wk-mob' },
        h('summary', {}, ico('flame'), 'تجهيز الحركة قبل ما تبدأ', h('small', {}, N('3'), ' حركات')),
        h('ul', {}, ...mob.map((m) => h('li', {}, m)))));
    }

    // Zone 2 step once every set is logged
    if (z2On() && !L.nextOpen(live)) root.appendChild(z2Card());

    // hero ring (rest or exercise progress)
    hero = h('section', { class: 'wk-hero glass', 'aria-label': live.rest ? 'الراحة' : 'التقدّم في التمرين' });
    root.appendChild(hero);
    drawHero();

    // exercise head
    const tops = L.topSeries(history, e, 5, { excludeId: live.id }).map((x) => x.w).reverse();
    const bestSet = L.exposures(history, e, { excludeId: live.id }).flatMap(({ ex }) => L.prSets(ex)).reduce((b, s) => (L.e1rm(s.w, s.r) > L.e1rm(b.w, b.r) ? s : b), { w: 0, r: 0 });
    const ssPeers = e.ss ? L.groupOf(live, idx).filter((k) => k !== idx).map((k) => live.exercises[k].name) : [];
    const head = h('section', { class: 'wk-exh', 'aria-labelledby': 'wk-ex-h' },
      h('div', { class: 'wk-exh-row' },
        imgMod && e.lib ? imgMod.exerciseThumb(e.lib) : null,
        h('h2', { id: 'wk-ex-h' }, e.name),
        h('span', { class: 'wk-exh-sr' }, setsReps(e.sets.length, e.reps))),
      h('p', { class: 'wk-meta' }, e.muscle ? [e.muscle, ' · '] : null, 'راحة ', N(L.fmtClock(e.ss ? L.groupRest(live, idx) : L.restFor(e))),
        bestSet.w ? [' · أفضل ', N(`${L.fmtW(bestSet.w)} × ${bestSet.r}`, undefined, 'wk-best')] : null,
        pr0.e1rm ? [' · e1RM ', N(L.fmtW(Math.round(pr0.e1rm)))] : null),
      e.ss ? null : h('div', { class: 'wk-vidrow' }, videoLink(e, { name: e.name })),
      tops.length >= 2 && !e.ss ? h('div', { class: 'wk-spark-row' }, spark(tops, { label: `أعلى وزن في آخر ${tops.length} جلسات` }), h('small', {}, 'آخر ', N(String(tops.length)), ' جلسات')) : null,
      e.ss ? h('p', { class: 'wk-ss' }, ico('bolt'), 'سوبر سِت ', e.ss, ' مع ', ssPeers.join(' و'), ' · من غير راحة بينهم') : null);
    root.appendChild(head);

    // signals: injury, gates/ready reason, last note, intra fatigue, deload/lighter
    const inj = L.injuryFor(e, tr.injuries);
    if (inj) head.appendChild(h('div', { class: 'wk-warn', role: 'note' }, h('span', {}, `عندك إصابة في ${inj.muscle} — خفّف أو بدّل التمرين.`),
      h('button', { type: 'button', class: 'chip', onclick: () => swapSheet() }, 'بدّل')));
    if (live.deload) head.appendChild(h('p', { class: 'wk-hint quiet' }, 'أسبوع خفيف · نص المجموعات ووزن أقل 10%'));
    else if (live.lighter) head.appendChild(h('p', { class: 'wk-hint quiet' }, 'رجوع بأمان · أخف 10%'));
    const reason = L.prefillReason(e);
    if (reason) head.appendChild(h('p', { class: `wk-hint${e.ready ? '' : ' quiet'}` }, ico(e.ready ? 'bolt' : 'trend'), h('span', {}, reason)));
    if (e.planNote) head.appendChild(h('p', { class: 'wk-hint' }, ico('spark'), h('span', {}, e.planNote)));
    if (e.mode === 'reps') head.appendChild(h('p', { class: 'wk-hint quiet' }, ico('trend'), h('span', {}, 'نفس الوزن وعدّة زيادة — بنكمّل العدّات الأول قبل الوزن')));
    if (e.stall) head.appendChild(h('p', { class: 'wk-hint warn' }, L.stallText(e.stall)));
    if (e.lastNote) head.appendChild(h('p', { class: 'wk-lastnote' }, 'ملاحظتك المرة اللي فاتت: ', e.lastNote));
    const fat = L.intraFatigue(e.sets);
    if (fat) head.appendChild(h('p', { class: 'wk-hint warn' }, fat.type === 'reps' ? `العدّات نزلت ${fat.pct}% — راحة أطول أو وقف هنا` : `الوزن نزل ${fat.pct}% — تعب داخل الجلسة، راحة أطول`));

    // PR gold card (peak-end)
    const peak = peakSet();
    if (peak && e.sets.includes(peak)) {
      root.appendChild(h('div', { class: 'wk-prcard', role: 'status' },
        h('span', { class: 'ic' }, ico('trophy')),
        h('div', {}, h('b', {}, 'رقم شخصي جديد'), h('span', {}, peak.pr.type === 'weight' ? ['أعلى وزن ', N(L.fmtW(peak.w)), ' كجم'] : ['e1RM بقى ', N(L.fmtW(peak.pr.value || L.e1rm(peak.w, peak.r))), ' كجم'])),
        h('em', { class: 'num' }, `+${L.fmtW(peak.pr.delta)}`)));
    }

    // warm-up ramp (W50)
    if (e.warm && e.warm.length) {
      const wd = e.warm.filter((x) => x.done).length;
      const det = h('details', { class: 'wk-fold wk-warm', open: wd < e.warm.length && !e.sets.some((s) => s.done) ? true : null },
        h('summary', {}, ico('flame'), 'إحماء', h('small', {}, N(`${wd}/${e.warm.length}`), ' · مش بيتحسب في الحجم')),
        e.warmNote ? h('p', { class: 'wk-muted wk-warmnote' }, e.warmNote) : null,
        ...e.warm.map((x, k) => h('button', { type: 'button', class: `wk-wrow${x.done ? ' done' : ''}`, 'aria-pressed': String(!!x.done), dataset: { fk: `warm${k}` },
          onclick: () => { x.done = !x.done; save(); draw(`warm${k}`); } },
          N(`${x.pct}%`), N(`${L.fmtW(x.w)} × ${x.r}`), h('span', { class: 'ck' }, x.done ? ico('check') : null))));
      root.appendChild(det);
    }

    // set rows: inline kg / reps inputs + ✓ per row. Typing never re-renders the list.
    bestW = pr0.w || 0;
    rowUI = [];
    const sets = h('div', { class: 'wk-sets', role: 'group', 'aria-label': `مجموعات ${e.name}` },
      h('div', { class: 'srow head', 'aria-hidden': 'true' }, h('span', {}, '#'), h('span', {}, 'السابق'), h('span', {}, 'كجم'), h('span', {}, 'عدّة'), h('span', {})));
    e.sets.forEach((s, j) => {
      const u = buildRow(e, s, j);
      rowUI.push(u);
      sets.appendChild(u.row);
    });
    root.appendChild(sets);
    justSet = null;

    // steppers for the current set (update in place; fixed height so nothing jumps)
    stepUI = null; rirBox = null; typeChip = null; needHint = null; stepBlock = null;
    if (t) {
      const mk = (f) => h('input', { class: 'num wk-stepin', type: 'text', inputmode: f === 'w' ? 'decimal' : 'numeric', enterkeyhint: f === 'w' ? 'next' : 'done', autocomplete: 'off',
        value: f === 'w' ? L.fmtW(t.w) : String(t.r), 'aria-label': f === 'w' ? 'وزن المجموعة الحالية بالكيلو' : 'عدّات المجموعة الحالية', dataset: { fk: f === 'w' ? 'win' : 'rin' } });
      const sw = mk('w'), sr = mk('r');
      bindField(sw, 'w', () => live.cur.set, () => stepUI?.r);
      bindField(sr, 'r', () => live.cur.set);
      const btn = (fk, label, iconName, run) => { const b = h('button', { type: 'button', class: 'wk-stb', 'aria-label': label, dataset: { fk } }, ico(iconName)); holdRepeat(b, () => run({ timeStamp: performance.now() + Math.random() })); return b; };
      const wp = btn('w+', 'زوّد الوزن', 'plus', (ev) => adjust('w', wStepNow(), ev));
      const wm = btn('w-', 'قلّل الوزن', 'minus', (ev) => adjust('w', -wStepNow(), ev));
      const wLbl = h('small', {}, 'كجم');
      const wBox = h('div', { class: 'step' }, wp, h('div', {}, sw, wLbl), wm);
      const title = h('span', {});
      const plateLine = h('p', { class: 'wk-plates', hidden: true, 'aria-live': 'polite' });
      const plateBar = h('div', { class: 'wk-platebar' }, h('button', { type: 'button', class: 'linkbtn wk-platebtn', 'aria-expanded': 'false', onclick: (ev) => {
        const p = L.platesFor(+(curSet()?.w || 0), +(ctx.settings.get('wk.bar') || 20));
        plateLine.textContent = '';
        plateLine.append(...[p.perSide.length ? [N(p.perSide.map(L.fmtW).join(' + ')), ' لكل جنب · بار ', N(String(p.bar))] : 'الوزن ده البار لوحده', p.rest > 0 ? [' · فاضل ', N(L.fmtW(p.rest)), ' كجم'] : ''].flat());
        plateLine.hidden = !plateLine.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!plateLine.hidden));
      } }, 'أقراص الوزن ده'), plateLine);
      stepUI = { w: sw, r: sr, wp, wm, wBox, wLbl, title, plateBar };
      stepBlock = h('div', { class: 'wk-stepper', role: 'group', 'aria-label': 'تعديل المجموعة الحالية' },
        h('p', { class: 'wk-stepl' }, title),
        wBox,
        h('div', { class: 'step' },
          btn('r+', 'زوّد عدّة', 'plus', (ev) => adjust('r', 1, ev)),
          h('div', {}, sr, h('small', {}, 'عدّة')),
          btn('r-', 'قلّل عدّة', 'minus', (ev) => adjust('r', -1, ev))));
      root.appendChild(plateBar);
      needHint = h('p', { class: 'wk-needw', role: 'note', hidden: true }, ico('edit'), h('span', {}, 'اكتب الوزن · التمرين ده بوزن، مش هيتسجّل بـ 0 كجم'));
      root.appendChild(needHint);
      // RIR with estimate (W6-W8)
      rirBox = h('div', { class: 'wk-rir', role: 'group', 'aria-labelledby': 'wk-rir-l' });
      root.appendChild(rirBox);
      fillRir();
    }

    // set actions live UNDER the entry block: nothing sits between the list and the steppers to be hit by mistake
    typeChip = t ? h('button', { type: 'button', class: 'chip', dataset: { fk: 'type' }, onclick: () => setTypeSheet() }) : null;
    root.appendChild(h('div', { class: 'wk-setacts' },
      h('button', { type: 'button', class: 'chip wk-addset', dataset: { fk: 'addset' }, onclick: addSet }, ico('plus'), 'مجموعة'),
      e.sets.some((x) => !x.done && +x.r > 0) ? h('button', { type: 'button', class: 'chip wk-asplan', dataset: { fk: 'asplan' }, onclick: logAsPlanned }, ico('check'), 'كله زي الخطة') : null,
      typeChip,
      h('button', { type: 'button', class: 'chip', dataset: { fk: 'timer' }, onclick: presetsSheet, 'aria-haspopup': 'dialog' }, ico('timer'), 'مؤقّت'),
      h('button', { type: 'button', class: 'chip', dataset: { fk: 'note' }, onclick: noteSheet }, ico('edit'), e.note ? 'الملاحظة' : 'ملاحظة')));
    volEl = root.querySelector('.wk-vol');
    paintLive();
    // analysis panel (W22-W30)
    root.appendChild(analysis(e));

    // next list
    const nexts = live.exercises.map((x, i) => ({ x, i })).filter(({ x, i }) => i !== idx && !x.skipped && x.sets.some((s) => !s.done));
    if (nexts.length) {
      root.appendChild(h('section', { class: 'wk-nextlist', 'aria-labelledby': 'wk-next-l' },
        h('h3', { id: 'wk-next-l' }, 'الجاي'),
        h('ul', {}, ...nexts.slice(0, 6).map(({ x, i }) => h('li', {},
          h('button', { type: 'button', class: 'wk-nextbtn', onclick: () => select(i, Math.max(0, x.sets.findIndex((s) => !s.done))) },
            h('span', {}, x.name, x.ss ? h('small', { class: 'wk-tag' }, `سوبر ${x.ss}`) : null), setsReps(x.sets.length, x.reps)))))));
    }

    dock = h('div', { class: 'dock wk-dock' });
    root.appendChild(dock);
    drawDock();
    if (fk) {
      const target = fk === 'done' ? dock.querySelector('button.wk-cta, .wk-calib [data-fk="cal-ok"]') : root.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      if (target && document.activeElement !== target) target.focus({ preventScroll: true });
    }
    if (focusKey !== 'top') window.scrollTo(0, y);
  }

  function analysis(e) {
    const open = ctx.settings.get('wk.analysisOpen') === true;
    const det = h('details', { class: 'wk-fold wk-analysis', open: open ? true : null });
    det.addEventListener('toggle', () => { if ((ctx.settings.get('wk.analysisOpen') === true) !== det.open) ctx.settings.set('wk.analysisOpen', det.open); });
    const rec = L.recommend(history, e, { excludeId: live.id });
    const vel = L.velocity(history, e, { excludeId: live.id });
    const st = e.ready && rec.status !== 'deload' && rec.status !== 'plateau' ? 'ready' : rec.status;
    const tops = L.topSeries(history, e, 5, { excludeId: live.id }).reverse();
    const journal = L.journalFor(tr.poJournal, e);
    det.append(
      h('summary', {}, ico('chart'), 'تحليل', h('span', { class: `wk-pill v-${vel}` }, L.VELOCITY_LABEL[vel]), h('span', { class: `wk-pill s-${st}` }, L.REC_LABEL[st])),
      h('div', { class: 'wk-an-body' },
        tops.length ? h('div', { class: 'wk-an-spark' }, spark(tops.map((x) => x.w), { w: 220, h: 48, label: 'أعلى وزن في آخر 5 جلسات' }),
          h('div', { class: 'wk-an-x' }, ...tops.map((x) => N(L.fmtW(x.w))))) : h('p', { class: 'wk-muted' }, 'أول مرة للتمرين ده — التحليل هيظهر بعد جلستين.'),
        h('p', { class: 'wk-an-rec' }, h('b', {}, 'التوصية: '), rec.msg),
        rec.protocols ? h('div', { class: 'wk-an-protos' }, h('b', {}, 'كسر الثبات — اختار واحد:'),
          h('ul', {}, ...rec.protocols.map((p) => h('li', {}, h('span', { class: 'num' }, p.name), ' — ', p.desc)))) : null,
        L.prefillReason(e) ? h('p', { class: 'wk-muted' }, 'الجلسة دي: ', L.prefillReason(e)) : null,
        e.aiTip ? h('p', { class: 'wk-ai-tip' }, ico('spark'), h('span', {}, e.aiTip)) : null,
        journal.length ? h('div', { class: 'wk-an-journal' }, h('b', {}, 'قراراتك اللي فاتت'),
          h('ol', {}, ...journal.map((j) => h('li', {}, N(String(j.date || '').slice(5).replace('-', '/')), ' · ', h('span', { class: `wk-pill s-${j.action}` }, L.REC_LABEL[j.action] || j.action || '—'), ' ', j.msg || '')))) : null));
    return det;
  }

  const rowLabel = (s, j) => `المجموعة ${j + 1}: ${L.fmtW(s.w)} كجم × ${s.r}${s.type ? `، ${TYPE_LABEL[s.type]}` : ''}${s.done ? '، اتسجّلت' : ''}${s.pr ? '، رقم شخصي' : ''}`;
  function buildRow(e, s, j) {
    const pv = e.prev[j] || null;
    const mk = (f) => h('input', { class: 'num wk-cell', type: 'text', inputmode: f === 'w' ? 'decimal' : 'numeric', enterkeyhint: f === 'w' ? 'next' : 'done', autocomplete: 'off',
      value: f === 'w' ? L.fmtW(s.w) : String(s.r), placeholder: pv ? (f === 'w' ? L.fmtW(pv.w) : String(pv.r)) : (f === 'w' ? 'كجم' : 'عدّة'),
      'aria-label': `${f === 'w' ? 'الوزن بالكيلو' : 'عدد العدّات'} · المجموعة ${j + 1}`, dataset: { fk: `${f}${j}` } });
    const w = mk('w'), r = mk('r');
    bindField(w, 'w', () => j, () => rowUI[j]?.r);
    bindField(r, 'r', () => j);
    const up = h('small', { class: 'wk-upby', hidden: true });
    const prev = h('span', { class: 'prev num' }, pv ? `${L.fmtW(pv.w)} × ${pv.r}` : '—', up, s.coach && !s.done ? h('small', { class: 'wk-cotag' }, 'اقتراح المدرب') : null);
    const applyBtn = h('button', { type: 'button', class: 'wk-apply', hidden: true, dataset: { fk: `ap${j}` }, onclick: () => applyRest(j) }, 'طبّق على الباقي');
    const n = h('button', { type: 'button', class: 'n', 'aria-label': `خيارات المجموعة ${j + 1}`, 'aria-haspopup': 'dialog', dataset: { fk: `opt${j}` }, onclick: () => setSheet(j) },
      h('b', { class: 'num' }, String(j + 1)), s.type ? h('small', { class: 'wk-tag' }, TYPE_LABEL[s.type]) : h('i', { 'aria-hidden': 'true' }, '⋯'));
    const ck = h('button', { type: 'button', class: `ck${s.pr ? ' wk-pr-ck' : ''}`, 'aria-pressed': String(!!s.done), 'aria-label': s.done ? `افتح المجموعة ${j + 1} تاني` : `سجّل المجموعة ${j + 1}`,
      dataset: { fk: `ck${j}` }, onclick: () => toggleDone(j) }, h('span', { class: 'dot' }, ico('check')));
    const row = h('div', { class: `srow wk-st${s.done ? ' done' : ''}${s === justSet ? ' just' : ''}`, role: 'group', dataset: { j: String(j) } },
      n, h('span', { class: 'pvc' }, prev, applyBtn), w, r, ck);
    row.addEventListener('click', (ev) => { if (ev.target.closest('input,button')) return; if (live.cur.set !== j) { live.cur = { ex: live.cur.ex, set: j }; paintLive(); queueSave(); } });
    if (pref(ctx, 'swipe')) attachSwipe(row, j);
    return { row, w, r, ck, prev, up, apply: applyBtn };
  }
  function paintRow(u, s, j, src) {
    const e = curEx(), isCur = j === live.cur.set;
    u.row.classList.toggle('cur', isCur);
    if (isCur) u.row.setAttribute('aria-current', 'step'); else u.row.removeAttribute('aria-current');
    u.row.setAttribute('aria-label', rowLabel(s, j));
    for (const [el, v] of [[u.w, L.fmtW(s.w)], [u.r, String(s.r)]]) if (el !== src && document.activeElement !== el && el.value !== v) el.value = v;
    const pv = e.prev[j];
    const d = pv && !s.done ? L.round1(+s.w - +pv.w) : 0;
    u.up.hidden = !d;
    if (d) { u.up.textContent = `${d > 0 ? '+' : '−'}${L.fmtW(Math.abs(d))}`; u.up.className = `wk-upby ${d > 0 ? 'plus' : 'minus'}`; }
    const peers = apply && apply.e === e && apply.j === j ? EA.editedPeers(e.sets, j) : [];
    const noW = !s.done && EA.needsWeight(e, s);
    u.ck.classList.toggle('off', noW);
    if (noW) u.ck.setAttribute('aria-disabled', 'true'); else u.ck.removeAttribute('aria-disabled');
    u.ck.setAttribute('aria-label', s.done ? `افتح المجموعة ${j + 1} تاني` : noW ? `اكتب الوزن الأول · المجموعة ${j + 1}` : `سجّل المجموعة ${j + 1}`);
    u.prev.hidden = peers.length > 0; u.apply.hidden = !peers.length;
    if (peers.length) u.apply.setAttribute('aria-label', `طبّق ${L.fmtW(s.w)} كجم على المجموعة ${peers.map((k) => k + 1).join(' و')}`);
  }
  /** Repaint everything that depends on set values / the current set — in place, focus untouched. */
  function paintLive(src = null) {
    if (closed) return;
    const e = curEx(), t = curSet();
    if (!e) return;
    rowUI.forEach((u, k) => { if (e.sets[k]) paintRow(u, e.sets[k], k, src); });
    if (stepUI && t) {
      for (const [el, v] of [[stepUI.w, L.fmtW(t.w)], [stepUI.r, String(t.r)]]) if (el !== src && document.activeElement !== el && el.value !== v) el.value = v;
      const ws = wStepNow();
      stepUI.wp.setAttribute('aria-label', `زوّد الوزن ${ws}`); stepUI.wm.setAttribute('aria-label', `قلّل الوزن ${ws}`);
      const above = bestW > 0 && +t.w > bestW && !t.done;
      stepUI.wBox.classList.toggle('wk-above', above); stepUI.wLbl.textContent = above ? 'فوق أفضل وزن' : 'كجم';
      stepUI.title.textContent = `${t.done ? 'بتعدّل' : 'الحالية'} · المجموعة ${live.cur.set + 1}`;
      stepUI.plateBar.style.visibility = +t.w > 20 ? '' : 'hidden';
    }
    if (typeChip && t) typeChip.textContent = `النوع: ${TYPE_LABEL[t.type || 'normal']}`;
    if (needHint) needHint.hidden = !(t && !t.done && EA.needsWeight(e, t)) || calibOn(e);
    fillRir();
    if (volEl) volEl.textContent = L.fmtInt(L.liveVolume(live));
    if (!(live.rest && restLeft() > 0)) drawHero();
    drawDock();
  }
  function fillRir() {
    const t = curSet(), e = curEx();
    if (!rirBox || !t) return;
    const fk = rirBox.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
    const est = L.estimateRir(t.w, t.r, recentBest(e));
    if (!t.done) t.rirEst = est;
    const shown = t.rir ?? null;
    const zone = L.rirZone(shown);
    fill(rirBox, 
      h('span', { id: 'wk-rir-l' }, 'فاضل كام عدّة (RIR)', shown === null && est !== null ? [' · تقدير ', N(est >= 4 ? '4+' : String(est))] : ' · اختياري'),
      h('div', { class: 'chips' }, ...[0, 1, 2, 3, 4].map((v) => h('button', { type: 'button', class: `chip wk-rirc z${v}${shown === null && est !== null && Math.min(4, est) === v ? ' est' : ''}`,
        'aria-pressed': String(shown === v || (v === 4 && shown >= 4)), dataset: { fk: `rir${v}` }, onclick: () => setRir(v) }, N(v === 4 ? '4+' : String(v))))),
      zone ? h('p', { class: `wk-zone t-${zone.tone}` }, zone.msg) : null);
    if (fk) rirBox.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
  }

  /** Swipe right = done, left = reopen — only a clear horizontal gesture, never while typing, never from an input. */
  function attachSwipe(row, j) {
    let x0 = null, y0 = 0;
    row.addEventListener('pointerdown', (ev) => { x0 = editing() || ev.target.closest('input') ? null : ev.clientX; y0 = ev.clientY; });
    row.addEventListener('pointercancel', () => { x0 = null; });
    row.addEventListener('pointerup', (ev) => {
      if (x0 === null) return;
      const dx = ev.clientX - x0, dy = ev.clientY - y0; x0 = null;
      if (editing() || !L.isSwipe(dx, dy)) return;
      const s = curEx()?.sets[j]; if (!s) return;
      if (dx > 0 && !s.done) completeAt(j);
      else if (dx < 0 && s.done) reopen(j);
    });
  }

  let heroArc = null, heroC = 0, heroNum = null;
  function drawHero() {
    if (!hero) return;
    hero.textContent = ''; heroArc = heroNum = null;
    const e = curEx();
    const resting = live.rest && restLeft() > 0;
    hero.hidden = !(z2On() && live.z2.startedAt && !L.nextOpen(live));
    if (hero.hidden) return;
    if (resting) {
      const left = restLeft(), total = live.rest.total || left;
      const svg = ring({ value: left, max: total, size: HERO, stroke: HERO_STROKE, color: 'url(#wk-rg)', label: 'الراحة' });
      addGrad(svg);
      heroArc = svg.querySelector('.ring-arc'); heroC = 2 * Math.PI * ((HERO - HERO_STROKE) / 2);
      if (heroArc) setTimeout(() => { if (heroArc) heroArc.style.transition = reduced() ? 'none' : 'stroke-dasharray 300ms linear'; }, 1200);
      heroNum = h('b', { class: 'num' }, L.fmtClock(left));
      const ne = live.exercises.find((x) => x.exId === live.rest.forId);
      const paused = Number.isFinite(live.rest.pausedLeft);
      hero.append(
        h('div', { class: 'wk-ring', role: 'timer', 'aria-live': 'off' }, svg, h('div', { class: 'c' }, heroNum, h('span', {}, 'من ', h('bdi', { class: 'num' }, L.fmtClock(total))))),
        h('div', { class: 'side' },
          h('b', {}, paused ? 'الراحة واقفة' : live.rest.ss ? 'راحة بعد الجولة' : 'راحة · خُد نفَسك'),
          h('p', {}, !ne ? '' : live.rest.forId === live.rest.fromId ? ['المجموعة ', N(String((live.rest.forSet ?? 0) + 1)), ' جاية'] : ['الجاي: ', ne.name]),
          h('div', { class: 'ctr' },
            h('button', { type: 'button', class: 'num', 'aria-label': 'قلّل 15 ثانية', onclick: () => shiftRest(-15) }, h('bdi', { dir: 'ltr' }, '−15')),
            h('button', { type: 'button', class: 'num', 'aria-label': 'زوّد 15 ثانية', onclick: () => shiftRest(15) }, h('bdi', { dir: 'ltr' }, '+15')),
            h('button', { type: 'button', 'aria-label': paused ? 'كمّل الراحة' : 'وقّف الراحة', dataset: { fk: 'pause' }, onclick: togglePause }, ico(paused ? 'play' : 'pause')),
            h('button', { type: 'button', class: 'sk', onclick: skipRest }, ico('skip'), 'تخطّي'))));
      return;
    }
    if (z2On() && live.z2.startedAt && !L.nextOpen(live)) {
      const left = z2Left(), total = live.z2.total || 1;
      const svg = ring({ value: left, max: total, size: HERO, stroke: HERO_STROKE, color: 'url(#wk-rg)', label: 'Zone 2' });
      addGrad(svg);
      heroNum = h('b', { class: 'num' }, L.fmtClock(left));
      heroArc = svg.querySelector('.ring-arc'); heroC = 2 * Math.PI * ((HERO - HERO_STROKE) / 2);
      hero.append(
        h('div', { class: 'wk-ring', role: 'timer', 'aria-live': 'off' }, svg, h('div', { class: 'c' }, heroNum, h('span', {}, 'من ', h('bdi', { class: 'num' }, L.fmtClock(total))))),
        h('div', { class: 'side' }, h('b', {}, left ? 'Zone 2 شغّال' : 'Zone 2 خلص'), h('p', {}, left ? 'نفَس أسرع بس تقدر تتكلم' : 'اقفل الجلسة')));
      return;
    }
    const done = e.sets.filter((s) => s.done).length;
    const svg = ring({ value: done, max: e.sets.length || 1, size: HERO, stroke: HERO_STROKE, color: 'url(#wk-rg)', label: `${done} من ${e.sets.length} مجموعات` });
    addGrad(svg);
    const t = curSet();
    const restSec = e.ss ? L.groupRest(live, live.cur.ex) : L.restFor(e);
    hero.append(
      h('div', { class: 'wk-ring' }, svg, h('div', { class: 'c' }, h('b', { class: 'num' }, `${done}/${e.sets.length}`), h('span', {}, 'مجموعات'))),
      h('div', { class: 'side' },
        t && !t.done ? [h('b', {}, 'المجموعة ', N(String(live.cur.set + 1))), h('p', {}, N(`${L.fmtW(t.w)} × ${t.r}`), ' · راحة بعدها ', N(L.fmtClock(restSec)))]
          : [h('b', {}, L.nextOpen(live) ? 'اختار المجموعة الجاية' : 'خلصت كل المجموعات'), h('p', {}, 'الجلسة شغّالة')],
        h('div', { class: 'ctr' },
          h('button', { type: 'button', class: 'sk', onclick: presetsSheet, 'aria-haspopup': 'dialog' }, ico('timer'), 'مؤقّت'))));
  }
  function addGrad(svg) {
    const NS = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(NS, 'defs');
    const g = document.createElementNS(NS, 'linearGradient');
    g.setAttribute('id', 'wk-rg'); g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '1'); g.setAttribute('y2', '1');
    for (const [o, c] of [['0', 'var(--pro)'], ['1', 'var(--violet)']]) { const s = document.createElementNS(NS, 'stop'); s.setAttribute('offset', o); s.style.stopColor = c; g.appendChild(s); }
    defs.appendChild(g); svg.insertBefore(defs, svg.firstChild);
  }

  function drawDock() {
    if (!dock) return;
    const micFocused = document.activeElement === vc.mic;
    for (const c of [...dock.children]) if (c !== vc.panel && c !== stepBlock) c.remove();
    if (vc.panel.parentNode !== dock) dock.prepend(vc.panel);
    // the one-time rest-alert explanation takes the stepper's place while it is up (the dock never covers half the screen)
    const tipUp = !!(live.rest && restLeft() > 0 && tipPending && !alertTipSeen());
    const showStep = !!(stepBlock && curSet() && !curSet().done && !calibOn() && !tipUp);
    if (stepBlock) { if (showStep && stepBlock.parentNode !== dock) dock.appendChild(stepBlock); if (!showStep) stepBlock.remove(); }
    const above = (el) => (stepBlock && stepBlock.parentNode === dock ? dock.insertBefore(el, stepBlock) : dock.appendChild(el));
    const ss = ssStrip(); if (ss) above(ss);
    const allDone = !L.nextOpen(live);
    const t = curSet();
    const nextName = (() => { const n = L.nextAfter(live, live.cur.ex).cur; const ex = n ? live.exercises[n.ex] : null; return ex && ex !== curEx() ? ex.name : (curEx()?.name || ''); })();
    // rest countdown pinned in the dock (thumb zone): visible even when the hero ring is scrolled away (UX #7)
    restUI = null;
    const resting = !!(live.rest && restLeft() > 0);
    if (resting) { if (tipPending && !alertTipSeen()) above(alertTip()); above(restBar()); }
    // first time on a loaded lift: the guided ramp replaces the CTA (three answers, no keyboard)
    if (!allDone && calibOn()) { above(calibPanel(curEx())); if (micFocused && vc.mic.isConnected) vc.mic.focus({ preventScroll: true }); return; }
    const noW = !!(t && !t.done && EA.needsWeight(curEx(), t));
    let btn;
    if (noW) btn = h('button', { type: 'button', class: 'btn wk-cta wk-cta-w', onclick: () => focusWeight(live.cur.set) }, ico('edit'), 'اكتب الوزن');
    else if (allDone && (!t || t.done) && z2On() && !live.z2.startedAt) btn = h('button', { type: 'button', class: 'btn wk-cta', onclick: startZ2 }, ico('play'), 'ابدأ ', h('bdi', { dir: 'ltr' }, 'Zone 2'), ' · ', N(String(z2Plan())), ' د');
    else if (allDone && (!t || t.done)) btn = h('button', { type: 'button', class: 'btn wk-cta', onclick: finish }, ico('check'), 'اقفل الجلسة');
    else if (t && t.done) btn = h('button', { type: 'button', class: 'btn wk-cta', onclick: complete }, ico('check'), 'احفظ التعديل');
    // during a rest the CTA turns secondary and says it ends the rest (UX audit #3: never a silent cancel)
    else if (resting && !Number.isFinite(live.rest.pausedLeft)) btn = h('button', { type: 'button', class: 'btn ghost wk-cta wk-cta-rest', disabled: !(t && +t.r > 0), onclick: complete }, ico('check'), 'سجّل وأنهِ الراحة');
    else btn = h('button', { type: 'button', class: 'btn wk-cta', disabled: !(t && +t.r > 0), onclick: complete }, ico('check'), 'سجّل المجموعة');
    dock.appendChild(h('div', { class: 'wk-logbar' },
      h('div', { class: 'meta' }, allDone ? (z2On() && !live.z2.doneAt ? 'آخر خطوة' : 'الجلسة') : 'الجاي', h('b', {}, allDone ? (z2On() && !live.z2.startedAt ? 'Zone 2 على العجلة' : 'جاهزة تتقفل') : nextName)), t ? vc.mic : null, btn));
    if (micFocused && vc.mic.isConnected) vc.mic.focus({ preventScroll: true });
    fitDock();
  }
  // the scroll area always clears the (variable-height) dock
  function fitDock() { if (dock && dock.isConnected) root.style.paddingBottom = `${Math.ceil(dock.getBoundingClientRect().height) + 16}px`; }
  /** Superset on one screen (UX audit #9): A1 / A2 rows in the dock, the active one highlighted; tap to jump. */
  function ssStrip() {
    const e = curEx(); if (!e || !e.ss) return null;
    const g = L.groupOf(live, live.cur.ex); if (g.length < 2) return null;
    return h('ol', { class: 'wk-ssstrip', 'aria-label': `سوبر سِت ${e.ss}` }, ...g.map((k, n) => {
      const x = live.exercises[k]; const j = x.sets.findIndex((q) => !q.done); const q = x.sets[j >= 0 ? j : x.sets.length - 1];
      const on = k === live.cur.ex;
      return h('li', {}, h('button', { type: 'button', class: `wk-ssrow${on ? ' on' : ''}`, 'aria-current': on ? 'step' : null, onclick: () => { if (!on && j >= 0) select(k, j); } },
        h('b', { class: 'num' }, `${e.ss}${n + 1}`), h('span', {}, x.name),
        h('small', {}, j >= 0 ? [N(`${j + 1}/${x.sets.length}`), ' · ', N(`${L.fmtW(q.w)}×${q.r}`)] : 'خلص')));
    }));
  }
  function focusDock() { dock?.querySelector('button.wk-cta, .wk-calib button')?.focus({ preventScroll: true }); }
  let restUI = null;
  function restBar() {
    const left = restLeft(), paused = Number.isFinite(live.rest.pausedLeft);
    const ne = live.exercises.find((x) => x.exId === live.rest.forId);
    const num = h('b', { class: 'num' }, L.fmtClock(left));
    const b = (cls, label, run, ...kids) => h('button', { type: 'button', class: `wk-rb ${cls}`, 'aria-label': label, onclick: run }, ...kids);
    const canNotify = alertEnv().canAsk && !pref(ctx, 'notify') && ctx.settings.get('wk.notifyAsked') !== true && !tipPending;
    restUI = { num };
    return h('div', { class: `wk-restbar${paused ? ' paused' : ''}`, role: 'timer', 'aria-label': 'الراحة' },
      h('div', { class: 'wk-rb-t' }, h('small', {}, paused ? 'الراحة واقفة' : live.rest.ss ? 'راحة الجولة' : 'راحة', ne && ne.exId !== live.rest.fromId ? [' · ', ne.name] : ''), num),
      b('num', 'قلّل 15 ثانية', () => shiftRest(-15), h('bdi', { dir: 'ltr' }, '−15')),
      b('num', 'زوّد 15 ثانية', () => shiftRest(15), h('bdi', { dir: 'ltr' }, '+15')),
      canNotify ? b('wk-rb-bell', 'نبّهني بإشعار لما الراحة تخلص والتطبيق في الخلفية', enableNotify, ico('bell')) : null,
      b('sk', 'تخطّي الراحة', skipRest, ico('skip'), 'تخطّي'));
  }
  async function enableNotify() {
    try { await ctx.settings.set('wk.notifyAsked', true); } catch { /* best effort */ }
    const p = await askNotifyPermission();
    if (p === 'granted') { try { await ctx.settings.set('wk.notify', true); } catch { /* ignore */ } ctx.toast('هيوصلك إشعار لما الراحة تخلص والتطبيق في الخلفية.'); }
    else ctx.toast('الإشعارات مقفولة من المتصفح. الصوت والاهتزاز شغالين والتطبيق مفتوح.');
    if (!closed) drawDock();
  }
  // One-time, honest explanation the first time a rest starts (UX: right moment, from a tap). iOS: no lock-screen alerts
  // for web apps → keep the screen on + catch-up. Android/desktop: offer the background notification (permission from the tap).
  const alertTipSeen = () => ctx.settings.get('wk.alertTipSeen') === true;
  function alertTip() {
    const env = alertEnv();
    const close = async () => { tipPending = false; try { await ctx.settings.set('wk.alertTipSeen', true); } catch { /* ignore */ } if (!closed) drawDock(); };
    const lines = [];
    if (env.ios) {
      lines.push('الآيفون مش بيسمح لتطبيقات الويب تنبّه والشاشة مقفولة.');
      lines.push(env.wakeLock && ctx.settings.get('wk.wakeLock') !== false ? 'عشان كده الشاشة هتفضل منوّرة أثناء التمرين، والصوت والاهتزاز هيشتغلوا لما الراحة تخلص. لو قفلتها، التنبيه هييجي أول ما تفتحها.'
        : 'خلّي الشاشة مفتوحة أثناء الراحة، أو طوّل «القفل التلقائي» من الإعدادات › الشاشة والسطوع. لو قفلتها، التنبيه هييجي أول ما تفتحها.');
      lines.push('مفتاح الصامت في جنب الآيفون بيكتم صوت التنبيه.');
      if (!env.standalone) lines.push('الأحسن تفتحه من الشاشة الرئيسية: زر المشاركة › «إضافة إلى الشاشة الرئيسية».');
    } else if (env.canAsk) {
      lines.push('لو سبت التطبيق في الخلفية، نقدر نبعتلك إشعار لما الراحة تخلص.');
    } else {
      lines.push('الصوت والاهتزاز هيشتغلوا لما الراحة تخلص والتطبيق مفتوح. لو قفلت الشاشة، التنبيه هييجي أول ما تفتحها.');
    }
    const acts = [];
    if (env.canAsk) acts.push(h('button', { type: 'button', class: 'btn sm', onclick: async () => { await enableNotify(); close(); } }, ico('bell'), 'فعّل الإشعارات'));
    acts.push(h('button', { type: 'button', class: 'btn ghost sm', onclick: close }, env.canAsk ? 'مش دلوقتي' : 'فهمت'));
    return h('div', { class: 'wk-alert-tip glass', role: 'note', 'aria-labelledby': 'wk-at-h' },
      h('b', { id: 'wk-at-h' }, 'تنبيه نهاية الراحة'), ...lines.map((t) => h('p', {}, t)), h('div', { class: 'btn-row wrap' }, ...acts));
  }

  function paintRest() {
    if (live.rest && restUI) restUI.num.textContent = L.fmtClock(restLeft());
    else if (live.rest && dock) drawDock();
    if (!live.rest || !heroNum) { drawHero(); return; }
    const left = restLeft();
    heroNum.textContent = L.fmtClock(left);
    if (heroArc) heroArc.setAttribute('stroke-dasharray', `${heroC * Math.max(0, Math.min(1, left / (live.rest.total || 1)))} ${heroC}`);
  }

  // ── lock-screen rest (UX #12): opt-in («إشعار…» in session settings, or the bell in the rest bar) + permission ──
  // On hide: one quiet «راحة لحد 10:42» notice (absolute end time, right even if every timer freezes), then the end alert from
  // the service worker (survives a frozen page) or a page timer when there is no SW. Same tag → never two end alerts.
  const notice = { t: 0, armed: false, sw: false, fired: 0 };
  // Android / desktop only: iOS freezes a locked PWA (page and service worker), so a timer-based notification never fires there.
  const notifyOK = () => pref(ctx, 'notify') && alertEnv().bgAlerts && Notification.permission === 'granted';
  async function swReg() {
    try { return navigator.serviceWorker && navigator.serviceWorker.getRegistration ? (await navigator.serviceWorker.getRegistration()) || null : null; } catch { return null; }
  }
  const nextLine = () => { const e = live.exercises.find((x) => x.exId === live.rest?.forId) || curEx(); return e ? `المجموعة ${(live.rest?.forSet ?? live.cur.set) + 1} من ${e.name}` : ''; };
  async function showNote(title, opts) {
    const reg = await swReg();
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return reg; }
    new Notification(title, opts); return null;
  }
  async function closeNotes(tag) {
    try { const reg = await swReg(); const list = reg && reg.getNotifications ? await reg.getNotifications({ tag }) : []; for (const n of list) n.close(); } catch { /* ignore */ }
  }
  async function armRestNotice() {
    if (!notifyOK() || !live.rest || Number.isFinite(live.rest.pausedLeft)) return;
    const ms = live.rest.endsAt - Date.now();
    if (ms <= 500) return;
    cancelRestNotice(false);
    notice.armed = true;
    const at = live.rest.endsAt;
    const until = new Date(at).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
    const endOpts = { body: nextLine(), tag: 'wk-rest', renotify: true, requireInteraction: false, silent: false, vibrate: [200, 100, 200, 100, 300], timestamp: at, data: { url: '#/workout/session' } };
    try {
      const reg = await showNote(`راحة لحد ${until}`, { body: nextLine(), tag: 'wk-rest-now', silent: true, timestamp: at, data: { url: '#/workout/session' } });
      if (reg && reg.active) { reg.active.postMessage({ type: 'wk-rest', at, title: 'الراحة خلصت', options: endOpts }); notice.sw = true; }
    } catch { /* notifications are best effort */ }
    // page timer: the end alert itself when there is no service worker (the SW one wins otherwise)
    notice.t = setTimeout(() => { notice.t = 0; if (document.visibilityState !== 'visible') restEndNotice(endOpts.body, at); }, ms);
  }
  function cancelRestNotice(closeNow = true) {
    clearTimeout(notice.t); notice.t = 0;
    if (!notice.armed) return;
    notice.armed = false; notice.sw = false;
    swReg().then((reg) => { try { reg?.active?.postMessage({ type: 'wk-rest-cancel' }); } catch { /* ignore */ } });
    if (closeNow) { closeNotes('wk-rest-now'); closeNotes('wk-rest'); }
  }
  /** The end alert (page side). Skipped when visible, when off, or when the SW already showed it. */
  async function restEndNotice(body, at = 0) {
    if (!notifyOK() || document.visibilityState === 'visible' || notice.sw) return false;
    if (at && notice.fired === at) return false;
    notice.fired = at || Date.now();
    try {
      const reg = await swReg();
      if (reg && reg.getNotifications && (await reg.getNotifications({ tag: 'wk-rest' })).length) return false;
      await showNote('الراحة خلصت', { body, tag: 'wk-rest', renotify: true, vibrate: [200, 100, 200, 100, 300], data: { url: '#/workout/session' } });
      closeNotes('wk-rest-now');
      return true;
    } catch { return false; }
  }

  function tick() {
    if (closed) return;
    if (clockEl) clockEl.textContent = L.fmtClock((Date.now() - (live.startedMs || Date.parse(live.startedAt))) / 1000);
    if (z2On() && live.z2.startedAt && !live.z2.doneAt && heroNum && !L.nextOpen(live)) {
      const left = z2Left();
      heroNum.textContent = L.fmtClock(left);
      if (heroArc) heroArc.setAttribute('stroke-dasharray', `${heroC * Math.max(0, Math.min(1, left / (live.z2.total || 1)))} ${heroC}`);
      if (!left) {
        live.z2.doneAt = Date.now(); save(); drawHero(); drawDock();
        alertNow('done'); announce('Zone 2 خلص. اقفل الجلسة.');
      }
    }
    if (live.rest && !Number.isFinite(live.rest.pausedLeft)) {
      // wall-clock cues: 10 s tick, 3-2-1, end (with catch-up after a locked / hidden screen)
      const rc = timerCues(live.rest, Date.now());
      for (const ev of rc.events) if (ev.kind !== 'restEnd') cue(ev.kind, { delay: ev.delay || 0 });
      if (rc.events.some((ev) => ev.kind === 'restEnd')) {
        const rest = live.rest;
        live.rest = null; tipPending = false; save(); drawHero(); drawDock();
        const e = curEx();
        const msg = e ? `الراحة خلصت · المجموعة ${live.cur.set + 1} من ${e.name}` : 'الراحة خلصت';
        alertNow('restEnd', { speech: 'الراحة خلصت' });
        restEndNotice(msg, rest.endsAt);
        if (rc.catchUp) ctx.toast(`${lateText(rc.late)} · المجموعة ${live.cur.set + 1}${e ? ` من ${e.name}` : ''}`);
        announce(rc.catchUp ? lateText(rc.late) : msg);
      } else paintRest();
    }
  }
  const timer = setInterval(tick, 250);

  // keep the screen on during the session (Profile › «خلّي الشاشة منوّرة أثناء التمرين»; re-acquired on return, core/alerts.js)
  const onVis = () => { if (document.visibilityState === 'visible') { cancelRestNotice(); tick(); } else { flushSave(); armRestNotice(); } };
  document.addEventListener('visibilitychange', onVis);
  keepAwake(true, 'session');

  draw('top');
  return () => {
    if (saveT) save();
    closed = true;
    clearInterval(timer);
    cancelRestNotice();
    flushCarry();
    vc.destroy();
    document.removeEventListener('visibilitychange', onVis);
    keepAwake(false, 'session');
  };
}

/** End-of-session summary (peak-end): totals, PRs, mood + note, stretch, share, coach analysis, save as plan day. */
export function showSummary(ctx, record, history, nextDay = '', { coach = null } = {}) {
  const s = L.summarize(record, history);
  const trainingDays = ctx.settings.get('trainingDays') || [];
  const effort = [`${s.sets} مجموعة`];
  if (s.prs.length) effort.push(s.prs.length === 1 ? 'رقم شخصي جديد' : `${s.prs.length} أرقام شخصية`);
  if (record.z2Min) effort.push(`Zone 2 ${record.z2Min} د`);
  const persist = () => safeWrite(ctx, () => putSession(ctx.db, record));
  const volEl = N('0');
  const durEl = N(String(s.durationMin)); const setsEl = N(String(s.sets));
  const moods = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'wk-mood-l' },
    ...[1, 2, 3, 4, 5].map((m) => h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(record.mood === m),
      onclick: (ev) => { record.mood = record.mood === m ? null : m; for (const c of moods.children) c.setAttribute('aria-checked', String(c === ev.currentTarget && record.mood === m)); persist(); } },
      N(String(m)), m === 1 ? ' صعبة' : m === 5 ? ' ممتازة' : '')));
  const note = h('textarea', { id: 'wk-snote', rows: 2, maxlength: 2000 });
  note.value = record.note || '';
  note.addEventListener('change', () => { record.note = note.value.trim().slice(0, 2000) || null; persist(); });
  const type = L.stretchTypeOf(record);
  // leads with what was done (UX audit #8, principle 2: no guilt); a lower volume is never the headline
  const up = s.prevVolume && s.deltaPct > 0;
  const body = h('div', { class: 'wk-summary' },
    h('div', { class: 'wk-sumhead' }, h('b', {}, `خلصت ${record.dayName || 'الجلسة'}`), h('p', {}, effort.join(' · '))),
    s.prs.length ? h('div', { class: 'wk-prcard' }, h('span', { class: 'ic' }, ico('trophy')),
      h('div', {}, h('b', {}, s.prs.length === 1 ? 'رقم شخصي جديد' : `${s.prs.length} أرقام شخصية`), h('span', {}, s.prs.map((p) => p.name).join('، '))),
      h('em', { class: 'num' }, `+${L.fmtW(s.prs[0].delta)}`)) : null,
    h('div', { class: 'wk-sumgrid' },
      h('div', {}, h('small', {}, 'المدة'), h('b', {}, durEl, h('small', {}, ' دقيقة'))),
      h('div', {}, h('small', {}, 'المجموعات'), h('b', {}, setsEl)),
      up ? h('div', {}, h('small', {}, 'الحجم عن المرة اللي فاتت'), h('b', { class: 'wk-up' }, N(`+${Math.abs(s.deltaPct)}%`)))
        : h('div', {}, h('small', {}, 'التمارين'), h('b', {}, N(String((record.exercises || []).filter((x) => (x.sets || []).some((t) => t.done)).length))))),
    ...s.prs.map((p) => h('div', { class: 'wk-tot wk-prline' }, h('span', {}, p.name), h('span', { class: 'pr' }, N(`${L.fmtW(p.w)} × ${p.r}`), ' · ', N(`+${L.fmtW(p.delta)}`)))),
    h('div', { class: 'wk-tot grand rule-open rule-closed' }, h('span', {}, 'الجلسة اتقفلت · الحجم'), h('span', {}, volEl, ' كجم')),
    h('p', { class: 'status ok' }, h('i', {}), `جلسة متسجّلة: ${effort.join('، ')}.`),
    h('div', { class: 'field wk-mt' }, h('span', { class: 'lbl', id: 'wk-mood-l' }, 'الجلسة كانت عاملة إزاي؟'), moods),
    h('div', { class: 'field' }, h('label', { for: 'wk-snote' }, 'ملاحظة على الجلسة (اختياري)'), note),
    h('div', { class: 'wk-sumacts' },
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { api.close(); ctx.go('workout/recovery', { stretch: type }); } }, ico('heart'), 'إطالة بعد التمرين · 5 دقايق'),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => share(ctx, record) }, ico('upload'), 'شارك'),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => saveAsDay(ctx, record) }, ico('plus'), 'احفظها كيوم في الخطة'),
      coach ? h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { try { coach.openCoachSheet(ctx, { intent: 'session-review', attach: { session: record } }); } catch { ctx.toast('المدرب مش متاح دلوقتي.'); } } }, ico('spark'), 'حلّل الجلسة') : null),
    nextDay ? h('p', { class: 'wk-after' }, 'الجلسة الجاية: ', nextDay, ' · ', nextTrainLabel(ctx.today(), trainingDays)) : null);
  const api = ctx.sheet({ title: record.dayName || 'الجلسة', body, actions: [
    { label: 'احفظ وارجع', run: () => ctx.go('workout') },
    { label: 'سجّل وجبة بعد التمرين', ghost: true, run: () => ctx.go('nutrition') },
  ], onClose: () => { if (location.hash.startsWith('#/workout/session')) ctx.go('workout'); } });
  countUp(volEl, s.volume, { ms: 900 });
  countUp(durEl, +s.durationMin || 0, { ms: 700 }); countUp(setsEl, +s.sets || 0, { ms: 700 });
  pop(body.querySelector('.wk-prcard'));
  void STRETCH_PROTOCOLS; void coachingFor;
}

async function share(ctx, record) {
  const text = L.shareText(record);
  try {
    if (navigator.share) { await navigator.share({ title: record.dayName || 'تمرين', text }); return; }
    await navigator.clipboard.writeText(text);
    ctx.toast('اتنسخ ملخص الجلسة.');
  } catch (e) { if (e && e.name !== 'AbortError') ctx.toast('ماقدرناش نشارك دلوقتي.'); }
}

/** W60: save this session as a new day in the plan (exercises + done set count + top rep range). */
async function saveAsDay(ctx, record) {
  const ok = await ctx.confirm({ title: 'نحفظ الجلسة كيوم في الخطة؟', text: `هيتضاف يوم جديد اسمه «${record.dayName || 'جلسة'} · نسخة» بنفس التمارين وعدد المجموعات.`, confirmLabel: 'احفظ اليوم' });
  if (!ok) return;
  const { program, rec } = await loadProgram(ctx.db);
  const id = `d${Date.now().toString(36)}`;
  const items = record.exercises.map((e) => {
    const base = (e.lib && L.itemFromLib(e.lib)) || { id: e.exId, ar: e.name, en: e.en, muscle: e.muscle, kind: e.kind, reps: '8-12' };
    const rs = e.sets.map((t) => +t.r).filter((r) => r > 0);
    return { ...base, id: `${base.id}_${id}`, sets: e.sets.length, reps: rs.length ? `${Math.min(...rs)}-${Math.max(...rs)}`.replace(/^(\d+)-\1$/, '$1') : base.reps, ...(e.ss ? { ss: e.ss } : {}) };
  });
  program.days[id] = { name: `${record.dayName || 'جلسة'} · نسخة`.slice(0, 40), items };
  program.order.push(id);
  if (await safeWrite(ctx, () => saveProgram(ctx.db, program, rec))) { ctx.emit('session:changed', { state: 'plan' }); ctx.toast('اتضاف يوم جديد في الخطة.'); }
}
