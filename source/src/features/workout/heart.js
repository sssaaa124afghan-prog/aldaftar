// #/workout/heart — Heart Day (Saturday, 30 min), home isometric mini player, home BP log.
// Pure logic first (node-safe, tested in heart.test.js), then the screens. Specs: plan/cardio-health.md,
// plan/mens-health.md §2, owner decisions 20/10/2026. Timers are timestamp based (survive a locked screen).
// Records: sessions store {kind:'heart', mode:'heart'|'iso', ...}; BP + gate + pelvic-floor log in kv 'health' (on-device).
import { h, N, ico, band, safeWrite, canVibrate } from './view.js';
import { putSession, loadProgram } from './store.js';
import { tone, prefSwitch } from './kit.js';
import { reduced } from '../../ui/anim.js';
import { dayKey, diffDays, weekStart } from '../../core/date.js';
import { wallSitArt, bikeArt } from './kegel-art.js';
import { latestBP, bpGate } from './bp.js';

export { latestBP, bpGate };

// ══ pure logic ══════════════════════════════════════════════════
export const DEFAULT_AGE = 27;
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fin = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** Age from the profile record ({age} or {birthYear}); default 27. */
export function ageOf(profile, now = new Date()) {
  const a = fin(profile && profile.age);
  if (Number.isFinite(a) && a >= 14 && a <= 90) return Math.round(a);
  const y = fin(profile && profile.birthYear);
  if (Number.isFinite(y) && y > 1900) { const d = now.getFullYear() - y; if (d >= 14 && d <= 90) return d; }
  return DEFAULT_AGE;
}
/** Tanaka 2001: HRmax = 208 − 0.7 × age. */
export const hrMax = (age = DEFAULT_AGE) => Math.round(208 - 0.7 * (Number.isFinite(+age) ? +age : DEFAULT_AGE));
/** Zone 2 = 60–70% HRmax, intervals = 90–95% HRmax (bpm, rounded). */
export function zones(age = DEFAULT_AGE) {
  const max = hrMax(age);
  return { age: +age || DEFAULT_AGE, max, z2: [Math.round(max * 0.6), Math.round(max * 0.7)], hard: [Math.round(max * 0.9), Math.round(max * 0.95)] };
}
/** 'low' | 'in' | 'high' for a bpm reading against a band. */
export function zoneCheck(bpm, band) {
  const b = fin(bpm);
  if (!Number.isFinite(b) || !band) return null;
  return b < band[0] ? 'low' : b > band[1] ? 'high' : 'in';
}

/** Program week 1..12 from a start day (null → 1). */
export function planWeek(startDay, today) {
  if (!startDay || !today) return 1;
  let d; try { d = diffDays(startDay, today); } catch { return 1; }
  if (!Number.isFinite(d) || d < 0) return 1;
  return clampN(Math.floor(d / 7) + 1, 1, 12);
}

const B = (id, kind, dur, label, sub, extra = {}) => ({ id, kind, dur, label, sub, ...extra });
/**
 * Heart Day blocks for week N — always exactly 30:00 (review M5/S3).
 * Wk 1–4: warm-up 3 · Zone 2 18 · transfer + HR-recovery 1 · wall sit 2×2 (1 rest) · pelvic floor 3.
 * Wk 7–11: warm-up 3 · 4 hard/3 easy/4 hard/3 easy/4 hard/1 easy (that last minute IS the HR-recovery test) ·
 * transfer 0:30 · wall sit 5 · pelvic floor 2:30. Wk 5, 6, 12: 2×4 intervals + 7 min Zone 2.
 * gate ≠ 'ok' (BP baseline missing, GP or doctor needed): walking / Zone 2 only, still 30:00.
 */
export function heartPlan(week = 1, { gate = 'ok' } = {}) {
  const w = clampN(Math.round(+week || 1), 1, 12);
  const pf = w <= 4 ? 180 : 150;
  const warm = B('warm', 'warm', 180, 'تسخين وحركة', 'ابدأ هادي وزوّد تدريجي · لف الورك ومرجحة الرجل');
  const pelvic = B('pelvic', 'pelvic', pf, 'قاع الحوض + تنفس بطيء', 'شهيق 4 ثواني · زفير 6 ثواني · شد مع الزفير · بتتحسب جلسة من جلستين النهارده');
  if (gate !== 'ok') return [warm, B('z2', 'z2', 1800 - 180 - pf, 'Zone 2 / مشي سريع', 'ثابت ومستمر · تقدر تتكلم بجمل كاملة'), pelvic];
  const wall = [B('wall1', 'wall', 120, 'جلوس على الحيطة 1 من 2', 'اتنفس طبيعي · ممنوع تكتم نفسك'),
    B('wrest', 'rest', 60, 'راحة', 'قوم وامشي خطوتين'),
    B('wall2', 'wall', 120, 'جلوس على الحيطة 2 من 2', 'اتنفس طبيعي · ممنوع تكتم نفسك')];
  if (w <= 4) return [warm, B('z2', 'z2', 1080, 'Zone 2', 'ثابت ومستمر · تقدر تتكلم بجمل كاملة', { hrr: true }),
    B('hrr', 'easy', 60, 'انتقال + اختبار نزول النبض', 'سجّل نبضك وامشي هادي دقيقة'), ...wall, pelvic];
  const n = intervalsFor(w);
  const out = [warm];
  if (n === 2) out.push(B('z2', 'z2', 420, 'Zone 2', 'ثابت ومستمر · تقدر تتكلم بجمل كاملة'));
  for (let i = 1; i <= n; i++) {
    out.push(B(`hard${i}`, 'hard', 240, `فترة قوية ${i} من ${n}`, 'كلمة أو اتنين بس · مجهود 8–9 من 10', { hrr: i === n }));
    out.push(i < n ? B(`easy${i}`, 'easy', 180, `هادي ${i} من ${n - 1}`, 'بدّل ببطء وخد نفسك')
      : B('hrr', 'easy', 60, 'هادي + اختبار نزول النبض', 'دقيقة تبديل هادي وسجّل النبض في آخرها'));
  }
  out.push(B('move', 'rest', 30, 'انتقل للحيطة', 'انزل من الجهاز بهدوء'), ...wall, pelvic);
  return out;
}
/** Number of 4-min hard intervals: 2 in weeks 5, 6, 12 (lifting overreach / deload weeks), 3 in weeks 7–11, 0 in 1–4. */
export const intervalsFor = (week) => (week <= 4 ? 0 : [5, 6, 12].includes(+week) ? 2 : 3);
/** Rest-day isometric block (Wed / Sun): wall sit 4 × 2 min, 2 min rests (trial protocol, Wiles 2017) = 14 min. */
export function isoPlan() {
  const out = [];
  for (let i = 1; i <= 4; i++) {
    out.push(B(`wall${i}`, 'wall', 120, `جلوس على الحيطة ${i} من 4`, 'اتنفس طبيعي · مجهود 7 من 10 في الآخر'));
    if (i < 4) out.push(B(`rest${i}`, 'rest', 120, 'راحة', 'قوم وامشي وهز رجلك'));
  }
  return out;
}
export const totalSecs = (blocks) => (blocks || []).reduce((a, b) => a + (+b.dur || 0), 0);

/** AHA/ACC category for one reading. {key, label, action, tone} — key ∈ normal|elevated|stage1|stage2|severe. */
export function bpCategory(sys, dia) {
  const s = fin(sys), d = fin(dia);
  if (!Number.isFinite(s) || !Number.isFinite(d)) return null;
  if (s > 180 || d > 120) return { key: 'severe', label: 'ضغط عالي جداً', tone: 'danger', action: 'ارتاح 5 دقايق وقيس تاني. لو لسه عالي من غير أعراض كلّم دكتور النهارده. لو فيه ألم صدر أو ضيق نفس أو زغللة أو صداع شديد أو تنميل: طوارئ 998 / 999.' };
  if (s >= 140 || d >= 90) return { key: 'stage2', label: 'ارتفاع ضغط درجة 2', tone: 'danger', action: 'روح لدكتور خلال أسبوع أو اتنين. وقّف الفترات القوية والتمرين الثابت لحد ما يطمّنك.' };
  if (s >= 130 || d >= 80) return { key: 'stage1', label: 'ارتفاع ضغط درجة 1', tone: 'warn', action: 'احجز كشف عند دكتور عام خلال أسابيع للتأكيد، وركّز على الملح والنوم والكارديو.' };
  if (s >= 120) return { key: 'elevated', label: 'مرتفع شوية', tone: 'warn', action: 'ركّز على ملح أقل وحركة أكتر، وقيس تاني كل شهر.' };
  return { key: 'normal', label: 'طبيعي', tone: 'ok', action: 'كمّل كده. قيس تاني كل 3 شهور.' };
}
/** Validate a BP entry. Returns {ok, errors:{sys?,dia?,pulse?}, value}. */
export function validateBP({ sys, dia, pulse } = {}) {
  const e = {}; const s = fin(sys), d = fin(dia), p = fin(pulse);
  if (!Number.isInteger(s) || s < 70 || s > 260) e.sys = 'اكتب رقم بين 70 و 260';
  if (!Number.isInteger(d) || d < 40 || d > 160) e.dia = 'اكتب رقم بين 40 و 160';
  if (!e.sys && !e.dia && d >= s) e.dia = 'الرقم الصغير لازم يبقى أقل من الكبير';
  if (pulse !== undefined && pulse !== null && pulse !== '' && (!Number.isInteger(p) || p < 30 || p > 220)) e.pulse = 'اكتب رقم بين 30 و 220 أو سيبه فاضي';
  const ok = !Object.keys(e).length;
  return { ok, errors: e, value: ok ? { sys: s, dia: d, pulse: Number.isFinite(p) ? p : null } : null };
}
// latestBP / bpGate live in bp.js (tiny, pure) so Today can read the gate without loading this screen.
export const AEROBIC_TARGET = 160;
const AEROBIC_KINDS = new Set(['warm', 'z2', 'hard', 'easy']);
/** Clock minutes of aerobic work this week: Heart Day aerobic blocks + recovery cardio + logged brisk walks. */
export function weeklyAerobic(sessions, walks, today, startDow = 1) {
  let ws; try { ws = weekStart(today, startDow); } catch { return 0; }
  const inWk = (d) => d && d >= ws && d <= today;
  let sec = 0;
  for (const s of sessions || []) {
    if (!s || s.discarded || !inWk(s.day)) continue;
    if (s.kind === 'heart' && Array.isArray(s.blocks)) sec += s.blocks.filter((b) => AEROBIC_KINDS.has(b.kind)).reduce((a, b) => a + (+b.doneS || 0), 0);
    else if (s.kind === 'recovery' && s.mode === 'cardio') sec += (+s.durationMin || 0) * 60;
  }
  for (const w of walks || []) if (w && inWk(w.day)) sec += (+w.min || 0) * 60;
  return Math.round(sec / 60);
}
/** 1-min HR recovery (Cole 1999). {drop, band:'good'|'ok'|'low'} or null. */
export function hrrResult(peak, after) {
  const p = fin(peak), a = fin(after);
  if (!Number.isFinite(p) || !Number.isFinite(a) || p < 60 || p > 230 || a < 30 || a > p) return null;
  const drop = p - a;
  return { peak: p, after: a, drop, band: drop > 20 ? 'good' : drop > 12 ? 'ok' : 'low' };
}

// ── pelvic floor (mens-health §2.3; owner: wk 1–2 3 s ×10 lying→sitting→standing, up to 10 s by wk 9–12) ──
export const POS = Object.freeze({ lying: 'نايم على ضهرك', sitting: 'قاعد', standing: 'واقف' });
export const KEGEL_STAGES = Object.freeze([
  { stage: 1, weeks: [1, 2], hold: 3, relax: 3, reps: 10, flicks: 5, positions: ['lying', 'sitting', 'standing'] },
  { stage: 2, weeks: [3, 4], hold: 5, relax: 5, reps: 8, flicks: 8, positions: ['lying', 'sitting', 'standing'] },
  { stage: 3, weeks: [5, 6], hold: 7, relax: 7, reps: 10, flicks: 10, positions: ['sitting', 'standing'] },
  { stage: 4, weeks: [7, 8], hold: 8, relax: 8, reps: 10, flicks: 10, positions: ['standing'] },
  { stage: 5, weeks: [9, 12], hold: 10, relax: 10, reps: 10, flicks: 12, positions: ['standing'], maxSet: true },
  { stage: 6, weeks: [13, Infinity], hold: 10, relax: 10, reps: 10, flicks: 10, positions: ['standing'], maintenance: true },
].map((s) => Object.freeze({ ...s, perDay: s.maintenance ? 1 : 2 })));
/** Stage for a protocol week (13+ = maintenance). */
export function kegelStage(week = 1) {
  const w = Math.max(1, Math.round(+week || 1));
  return KEGEL_STAGES.find((s) => w >= s.weeks[0] && w <= s.weeks[1]) || KEGEL_STAGES[KEGEL_STAGES.length - 1];
}
/** Protocol week from the first-session day (unbounded, ≥1). */
export function kegelWeek(start, today) {
  if (!start || !today) return 1;
  let d; try { d = diffDays(start, today); } catch { return 1; }
  return Number.isFinite(d) && d >= 0 ? Math.floor(d / 7) + 1 : 1;
}
export const MOVE_SECS = 10;
/** Timer steps for one session: per position an endurance set, then quick flicks (+ one max hold from stage 5). */
export function kegelSteps(st) {
  const out = [];
  st.positions.forEach((pos, pi) => {
    if (pi > 0 || st.positions.length > 1) out.push({ type: 'move', dur: MOVE_SECS, pos });
    for (let r = 1; r <= st.reps; r++) {
      out.push({ type: 'hold', dur: st.hold, pos, rep: r, of: st.reps });
      out.push({ type: 'relax', dur: st.relax, pos, rep: r, of: st.reps });
    }
  });
  const last = st.positions[st.positions.length - 1];
  out.push({ type: 'move', dur: 5, pos: last, flicksNext: true });
  for (let r = 1; r <= st.flicks; r++) {
    out.push({ type: 'flick', dur: 1, pos: last, rep: r, of: st.flicks });
    out.push({ type: 'frelax', dur: 1, pos: last, rep: r, of: st.flicks });
  }
  if (st.maxSet) { out.push({ type: 'relax', dur: 5, pos: last, rep: 0, of: 0 }); out.push({ type: 'hold', dur: st.hold, pos: last, rep: 1, of: 1, max: true }); out.push({ type: 'relax', dur: st.relax, pos: last, rep: 1, of: 1, max: true }); }
  return out;
}
/** Sessions logged in the week of `today` (and today). No streaks: just counts against the weekly target. */
export function kegelWeekCount(log, today, startDow = 6) {
  let ws; try { ws = weekStart(today, startDow); } catch { return { week: 0, today: 0 }; }
  const rows = (log || []).filter((r) => r && r.day);
  return { week: rows.filter((r) => r.day >= ws && r.day <= today).length, today: rows.filter((r) => r.day === today).length };
}

/** Session record for the sessions store (never a lifting session: no exercises array, kind 'heart'). */
export function heartRecord({ now = new Date(), mode = 'heart', week = null, blocks = [], hrRec = null, hrZ2 = null } = {}) {
  const durationS = blocks.reduce((a, b) => a + (+b.doneS || 0), 0);
  const rec = { id: `h:${now.getTime().toString(36)}`, kind: 'heart', mode, day: dayKey(now), week,
    startedAt: new Date(now.getTime() - durationS * 1000).toISOString(), finishedAt: now.toISOString(),
    durationS, durationMin: Math.max(1, Math.round(durationS / 60)), status: 'done',
    blocks: blocks.map((b) => ({ id: b.id, kind: b.kind, dur: b.dur, doneS: Math.round(+b.doneS || 0) })) };
  if (hrRec) rec.hrRec = hrRec;
  if (hrZ2 && hrZ2.length) rec.hrZ2 = hrZ2.slice(0, 40);
  return rec;
}

/** Timestamp-based step runner shared by the players. now() injectable for tests. */
export function runner(steps, { now = () => Date.now() } = {}) {
  const s = { idx: 0, endsAt: null, pausedLeft: steps.length ? steps[0].dur : 0, started: false, finished: false, done: steps.map(() => 0) };
  const left = () => (s.finished ? 0 : s.pausedLeft !== null ? s.pausedLeft : Math.max(0, Math.ceil((s.endsAt - now()) / 1000)));
  const leave = () => { s.done[s.idx] = Math.max(s.done[s.idx], steps[s.idx].dur - left()); };
  const api = {
    s, steps, left,
    running: () => !s.finished && s.pausedLeft === null,
    toggle() {
      if (s.finished) return;
      if (s.pausedLeft !== null) { s.endsAt = now() + s.pausedLeft * 1000; s.pausedLeft = null; s.started = true; }
      else s.pausedLeft = left();
    },
    jump(d) {
      if (s.finished) return 'none';
      leave();
      if (d > 0 && s.idx >= steps.length - 1) { s.finished = true; s.pausedLeft = 0; return 'finished'; }
      const i = clampN(s.idx + d, 0, steps.length - 1);
      const run = s.pausedLeft === null;
      s.idx = i;
      if (run) s.endsAt = now() + steps[i].dur * 1000; else s.pausedLeft = steps[i].dur;
      return 'moved';
    },
    /** Advance across elapsed steps (carry-over after a locked screen). → {moved, finished} */
    tick() {
      if (s.finished || s.pausedLeft !== null || !s.endsAt) return { moved: 0, finished: false };
      let moved = 0, guard = 0;
      while (now() >= s.endsAt && guard++ <= steps.length) {
        s.done[s.idx] = steps[s.idx].dur;
        if (s.idx >= steps.length - 1) { s.finished = true; s.pausedLeft = 0; return { moved, finished: true }; }
        s.idx++; moved++; s.endsAt += steps[s.idx].dur * 1000;
      }
      return { moved, finished: false };
    },
  };
  return api;
}

// ══ storage (kv 'health', on-device only) ═══════════════════════
export async function loadHealth(db) {
  try { const r = await db.get('kv', 'health'); return r && r.value && typeof r.value === 'object' ? r.value : {}; } catch { return {}; }
}
export async function patchHealth(db, fn) {
  const cur = await loadHealth(db);
  const value = typeof fn === 'function' ? fn(cur) : { ...cur, ...fn };
  await db.put('kv', { key: 'health', value });
  return value;
}
async function loadAge(db) { try { return ageOf(await db.get('profile', 'me')); } catch { return DEFAULT_AGE; } }

// ══ UI ═══════════════════════════════════════════════════════════
const NS = 'http://www.w3.org/2000/svg';
const fmtClock = (sec) => { const t = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const KIND_COLOR = { warm: 'var(--cal)', z2: 'var(--carb)', hard: 'var(--orange)', easy: 'var(--pro)', wall: 'var(--violet)', rest: 'var(--mu-3)', pelvic: 'var(--pink)' };
const KIND_TAG = { warm: 'تسخين', z2: 'Zone 2', hard: 'قوي', easy: 'هادي', wall: 'ثابت', rest: 'راحة', pelvic: 'قاع الحوض' };
export const VIB_KEY = 'hk.vibrate';
const vibOn = (ctx) => ctx.settings.get(VIB_KEY) === true;
export function buzz(ctx, pattern) { if (vibOn(ctx) && canVibrate()) try { navigator.vibrate(pattern); } catch { /* optional */ } }

/** Big ring SVG; returns {svg, set(frac, color)}. */
export function ringSvg(size = 200, stroke = 14) {
  const R = (size - stroke) / 2, C = 2 * Math.PI * R;
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const mk = (stroke2, cls) => { const e = document.createElementNS(NS, 'circle'); for (const [k, v] of Object.entries({ cx: size / 2, cy: size / 2, r: R, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', transform: `rotate(-90 ${size / 2} ${size / 2})`, stroke: stroke2 })) e.setAttribute(k, v); if (cls) e.setAttribute('class', cls); return e; };
  svg.append(mk('rgba(255,255,255,.12)'), mk('var(--carb)', 'hk-arc'));
  const arc = svg.lastChild;
  arc.setAttribute('stroke-dasharray', `0 ${C}`);
  if (reduced()) arc.style.transition = 'none';
  return { svg, set(frac, color) { arc.setAttribute('stroke-dasharray', `${C * clampN(frac, 0, 1)} ${C}`); if (color) arc.setAttribute('stroke', color); } };
}

/** Opt-in cue switches (sound uses the shared wk.sound pref; vibration is hk.vibrate). */
export function cueSwitches(ctx) {
  const id = 'hk-vib';
  const vib = h('input', { type: 'checkbox', id, role: 'switch', checked: vibOn(ctx) ? true : null, onchange: (e) => { ctx.settings.set(VIB_KEY, e.target.checked); if (e.target.checked) buzz(ctx, 40); } });
  return h('details', { class: 'wk-fold hk-cues' }, h('summary', {}, 'صوت واهتزاز', h('small', {}, 'مقفولين لحد ما تفتحهم')),
    h('div', { class: 'hk-fold-body' }, prefSwitch(ctx, 'sound'),
      h('label', { class: 'wk-switch', for: id }, h('span', {}, 'اهتزاز مع كل مرحلة جديدة'), vib, h('i', { 'aria-hidden': 'true' }))));
}

/**
 * Guided block player (glass ring per block, next preview, back/play/skip, block list).
 * opts: {blocks, title, onBlock(block), onFinish(blocksWithDone, runner)} → {el, tick, destroy, r}
 */
function blockPlayer(ctx, { blocks, title, headId, onBlock, onFinish, startLabel = 'ابدأ' }) {
  const r = runner(blocks);
  const ring = ringSvg(196, 14);
  const tNum = h('b', { class: 'num' }, fmtClock(blocks[0].dur));
  const tTag = h('span', {}, KIND_TAG[blocks[0].kind]);
  const bName = h('h4', {}, blocks[0].label);
  const bSub = h('p', { class: 'wk-muted' }, blocks[0].sub);
  const prog = h('p', { class: 'hk-prog' });
  const next = h('p', { class: 'hk-next' });
  const play = h('button', { type: 'button', class: 'btn', onclick: () => { r.toggle(); paint(); } }, startLabel);
  const list = h('ol', { class: 'hk-blocks' });
  const total = totalSecs(blocks);
  const el = h('section', { class: 'glass wk-card hk-player', 'aria-labelledby': headId },
    h('h3', { id: headId }, title, ' · ', N(String(Math.round(total / 60))), ' دقيقة'),
    h('div', { class: 'hk-stage' },
      h('div', { class: 'wk-ring hk-ring', role: 'timer', 'aria-label': 'الوقت الفاضل في المرحلة' }, ring.svg, h('div', { class: 'c' }, tNum, tTag)),
      h('div', { class: 'hk-info', 'aria-live': 'polite' }, bName, bSub, prog, next)),
    h('div', { class: 'wk-rx-ctrls' },
      h('button', { type: 'button', class: 'ibtn glass', 'aria-label': 'المرحلة اللي فاتت', onclick: () => { r.jump(-1); paint(); } }, ico('skip')),
      play,
      h('button', { type: 'button', class: 'ibtn glass wk-flip', 'aria-label': 'المرحلة الجاية', onclick: () => { const res = r.jump(1); if (res === 'finished') done(); else { cue(); paint(); } } }, ico('skip'))),
    list);
  let lastIdx = -1, finishedOnce = false;
  function cue() { buzz(ctx, 120); tone(ctx); }
  function done() { if (finishedOnce) return; finishedOnce = true; buzz(ctx, [90, 60, 90]); tone(ctx); paint(); onFinish && onFinish(blocks.map((b, i) => ({ ...b, doneS: r.s.done[i] })), r); }
  function paint() {
    const s = r.s, b = blocks[s.idx], l = r.left();
    tNum.textContent = s.finished ? 'تم' : fmtClock(l);
    tTag.textContent = s.finished ? 'خلصت' : KIND_TAG[b.kind];
    bName.textContent = s.finished ? 'خلصت الجلسة' : b.label;
    bSub.textContent = s.finished ? 'برافو. اشرب مية وسجّل نزول النبض لو قسته.' : b.sub;
    let gone = 0; for (let i = 0; i < s.idx; i++) gone += blocks[i].dur; gone += b.dur - l;
    prog.textContent = '';
    prog.append('المرحلة ', N(`${Math.min(s.idx + 1, blocks.length)}/${blocks.length}`), ' · ', N(`${fmtClock(s.finished ? total : gone)} / ${fmtClock(total)}`));
    const nb = blocks[s.idx + 1];
    next.textContent = '';
    if (!s.finished) { if (nb) next.append('الجاي: ', h('b', {}, nb.label), ' · ', N(fmtClock(nb.dur))); else next.append('آخر مرحلة'); }
    ring.set(s.finished ? 1 : (b.dur - l) / b.dur, s.finished ? 'var(--ok-c)' : l <= 5 && r.running() ? 'var(--amber)' : KIND_COLOR[b.kind]);
    play.textContent = s.finished ? 'خلصت' : r.running() ? 'وقّف' : s.started ? 'كمّل' : startLabel;
    play.disabled = s.finished;
    if (lastIdx !== s.idx || s.finished) {
      lastIdx = s.idx;
      list.textContent = '';
      blocks.forEach((x, i) => {
        const cur = !s.finished && i === s.idx, ok = s.finished || i < s.idx;
        list.appendChild(h('li', { class: `${cur ? 'cur' : ok ? 'done' : ''}`, 'aria-current': cur ? 'step' : null, style: `--k:${KIND_COLOR[x.kind]}` },
          h('span', { class: 'ck', 'aria-hidden': 'true' }, ok ? ico('check') : null), h('span', {}, x.label), h('small', { class: 'num' }, fmtClock(x.dur))));
      });
      if (!s.finished) onBlock && onBlock(b, s.idx);
    }
  }
  function tick() {
    const res = r.tick();
    if (res.moved) cue();
    if (res.finished) { done(); return; }
    paint();
  }
  paint();
  return { el, tick, r, paint };
}

/** Interval + visibility wiring for a player; returns cleanup. */
function drive(tickFn) {
  const t = setInterval(tickFn, 250);
  const onVis = () => { if (document.visibilityState === 'visible') tickFn(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
}

function numField({ id, label, hint, min, max, value = '' }) {
  const input = h('input', { id, type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', dir: 'ltr', 'aria-describedby': `${id}-e${hint ? ` ${id}-h` : ''}`, value, 'data-min': min, 'data-max': max });
  const err = h('p', { class: 'err', id: `${id}-e`, role: 'alert' });
  return { input, err, el: h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint', id: `${id}-h` }, hint) : null, err) };
}
const latin = (s) => String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^0-9]/g, '');

function tipsCard(id, title, items) {
  return h('section', { class: 'glass wk-card hk-tips', 'aria-labelledby': id }, h('h3', { id }, title), h('ul', {}, ...items.map((t) => h('li', {}, t))));
}
export const WALL_TIPS = [
  'ضهرك كله لازق في الحيطة من فوق لتحت، والرجلين بعرض الحوض.',
  'ابدأ بزاوية ركبة 95–100 درجة (الفخد قريب من الموازي مش موازي). لو سهلة، انزل شوية الجلسة الجاية.',
  'الركبة فوق الكعب، مش قدام صوابع رجلك.',
  'اتنفس طبيعي طول الوقت. كتم النفس بيرفع الضغط جامد، فممنوع.',
  'المفروض تحس بمجهود 7 من 10 في آخر الدقيقتين.',
  'وقّف فوراً لو دوخة أو صداع أو ضيق في الصدر. ومتعملوش قبل يوم رجل على طول.',
];
const STOP_SIGNS = [
  'ألم أو ضغط أو تقل في الصدر، أو ألم بيروح للدراع أو الفك: وقّف، ولو مارحش بعد دقايق راحة اتصل بالطوارئ 998 / 999.',
  'إغماء أو قرب إغماء، أو نَفَس مقطوع فجأة، أو دقات سريعة أو مش منتظمة مابتهداش.',
  'صداع شديد مفاجئ، زغللة، تنميل أو ضعف في ناحية واحدة: طوارئ.',
  'علامات الحر: لخبطة، بطّلت تعرق، جلد سخن ناشف: وقّف وبرّد جسمك.',
];

// ── BP gate note (before isometrics and intervals) ──
function gateNote(g, ctx) {
  const T = {
    baseline: ['قبل الفترات القوية والجلوس على الحيطة: قياس ضغط الأول',
      'محتاجين 3 أيام فيهم قراءتين على الأقل (الصبح وبالليل) من جهاز دراع معتمد. لحد كده الجلسة مشي أو Zone 2 بس، وده آمن ومفيد. الخطر قليل أصلاً، بس الخطوة دي ببلاش وبتكشف ضغط عالي ممكن يكون مستخبي.'],
    gp: ['متوسط ضغطك 140/90 أو أكتر شوية', 'احجز كشف عند دكتور عام للتأكيد. لحد ما يطمّنك، الجلسة مشي أو Zone 2 بس من غير فترات قوية ولا جلوس على الحيطة.'],
    block: ['الفترات القوية والجلوس على الحيطة مقفولين', 'فيه قراءة 160/100 أو أكتر. اكشف عند دكتور قبل ما ترجعلهم. المشي و Zone 2 الهادي مفتوحين.'],
    stop: ['مفيش تمرين النهارده', 'آخر قراءة أعلى من 180/110. ارتاح وقيس تاني بعد 5 دقايق، وكلّم دكتور النهارده. لو فيه ألم صدر أو ضيق نفس أو زغللة أو صداع شديد: طوارئ 998 / 999.'],
  }[g.state];
  if (!T) return null;
  return h('section', { class: `glass wk-card hk-doc${g.state === 'baseline' ? ' soft' : ''}`, role: 'note', 'aria-labelledby': 'hk-doc-h' },
    h('h3', { id: 'hk-doc-h' }, T[0]), h('p', {}, T[1]),
    g.state === 'baseline' ? h('div', { class: 'hk-base' }, h('div', { class: 'bar glow-pro' }, h('i', { style: `--p:${Math.round((Math.min(g.days, 3) / 3) * 100)}%` })),
      h('small', {}, N(String(Math.min(g.days, 3))), ' من ', N('3'), ' أيام جاهزة · ', N(String(g.n)), ' قراءة')) : null,
    g.avg && g.state !== 'baseline' ? h('p', { class: 'wk-muted' }, 'المتوسط ', h('bdi', { dir: 'ltr' }, N(`${g.avg.sys}/${g.avg.dia}`))) : null,
    h('a', { class: 'btn ghost sm', href: '#/workout/heart?tab=bp' }, 'افتح سجل الضغط'),
    h('p', { class: 'wk-muted' }, 'ولما تتمرن: اتنفس طبيعي طول الوقت، ومتكتمش نفسك أبداً.'));
}

// ── weekly aerobic minutes ──
function minutesCard(ctx, mins, rerender) {
  const add = async (m) => {
    if (await safeWrite(ctx, () => patchHealth(ctx.db, (c) => ({ ...c, walks: [...(c.walks || []), { day: ctx.today(), at: new Date().toISOString(), min: m }].slice(-300) })))) { ctx.toast(`اتسجّل مشي ${m} دقيقة.`); rerender(); }
  };
  const pct = Math.min(100, Math.round((mins / AEROBIC_TARGET) * 100));
  return h('section', { class: 'glass wk-card hk-mins', 'aria-labelledby': 'hk-m-h' },
    h('h3', { id: 'hk-m-h' }, 'دقايق الكارديو الأسبوع ده'),
    h('p', { class: 'hk-big' }, N(String(mins), undefined, 'count'), h('small', {}, ' / ', N(String(AEROBIC_TARGET)), ' دقيقة')),
    h('div', { class: 'bar glow-carb' }, h('i', { style: `--p:${pct}%` })),
    h('p', { class: 'wk-muted' }, '10 د Zone 2 بعد كل حديد × 4 · يوم القلب · مشي سريع 45 د الأربع و 45 د الحد · ومشي سريع 15 د السبت بالليل (بعد الحديد بـ 3 ساعات على الأقل).'),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn ghost sm', onclick: () => add(15) }, 'سجّلت مشي 15 د'), h('button', { type: 'button', class: 'btn ghost sm', onclick: () => add(45) }, 'سجّلت مشي 45 د')));
}

// ── zones card ──
function zonesCard(z) {
  return h('section', { class: 'glass wk-card hk-zones', 'aria-labelledby': 'hk-z-h' },
    h('div', { class: 'hk-zhead' }, h('div', {}, h('h3', { id: 'hk-z-h' }, 'مناطق النبض بتاعتك'),
      h('p', { class: 'wk-muted' }, 'على سن ', N(String(z.age)), ' · أقصى نبض تقديري ', N(String(z.max)), ' (208 − 0.7 × السن)')), bikeArt()),
    h('div', { class: 'hk-zgrid' },
      h('div', { class: 'glass-2 hk-z z2' }, h('small', {}, 'Zone 2 · ', h('bdi', { dir: 'ltr' }, '60–70%')), h('b', { dir: 'ltr' }, N(`${z.z2[0]}–${z.z2[1]}`)), h('span', {}, 'نبضة/دقيقة')),
      h('div', { class: 'glass-2 hk-z hard' }, h('small', {}, 'الفترات القوية · ', h('bdi', { dir: 'ltr' }, '90–95%')), h('b', { dir: 'ltr' }, N(`${z.hard[0]}–${z.hard[1]}`)), h('span', {}, 'نبضة/دقيقة'))),
    h('ul', { class: 'hk-talk' },
      h('li', {}, h('b', {}, 'Zone 2: '), 'تقدر تتكلم بجمل كاملة بس مش تغنّي. التنفس من مناخيرك بالعافية ممكن.'),
      h('li', {}, h('b', {}, 'الفترات القوية: '), 'كلمة أو اتنين بس، مجهود 8–9 من 10.'),
      h('li', {}, 'لو النبض قال حاجة والكلام قال حاجة، صدّق اختبار الكلام. وفي حر الإمارات النبض بيعلى 10–15 على نفس السرعة.')),
    h('p', { class: 'wk-muted' }, 'الأفضل: عجلة ثابتة 80–90 لفّة، أو مشي على سير بميل 6–12%. متمسكش في الجنب.'));
}

// ── HR entry during Zone 2 ──
function hrEntry(z, log) {
  const f = numField({ id: 'hk-hr', label: 'نبضك دلوقتي (اختياري)', hint: 'من الساعة أو عِد 15 ثانية واضرب في 4', min: 40, max: 230 });
  const out = h('p', { class: 'hk-hrout', 'aria-live': 'polite' });
  const add = () => {
    const v = +latin(f.input.value);
    if (!Number.isInteger(v) || v < 40 || v > 230) { f.err.textContent = 'اكتب رقم بين 40 و 230'; f.input.setAttribute('aria-invalid', 'true'); return; }
    f.err.textContent = ''; f.input.setAttribute('aria-invalid', 'false');
    log.push({ at: new Date().toISOString(), bpm: v });
    const c = zoneCheck(v, z.z2);
    out.textContent = c === 'in' ? `${v}: إنت في Zone 2 بالظبط.` : c === 'low' ? `${v}: أقل من Zone 2. زوّد السرعة أو المقاومة شوية.` : `${v}: أعلى من Zone 2. هدّي لحد ما تقدر تتكلم بجمل.`;
    out.dataset.k = c; f.input.value = '';
  };
  f.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return h('div', { class: 'hk-hr', hidden: true }, h('div', { class: 'hk-inline' }, f.el, h('button', { type: 'button', class: 'btn ghost sm', onclick: add }, 'سجّل النبض')), out);
}

// ── HR recovery test card ──
function hrrCard(ctx, getRec, setPending) {
  const peak = numField({ id: 'hk-hrr-p', label: 'النبض في آخر المجهود', min: 60, max: 230 });
  const after = numField({ id: 'hk-hrr-a', label: 'النبض بعد دقيقة', min: 30, max: 230 });
  const out = h('p', { class: 'hk-hrout', 'aria-live': 'polite' });
  const tNum = h('b', { class: 'num' }, '1:00');
  let ends = null, t = null;
  const timerBtn = h('button', { type: 'button', class: 'btn ghost sm', onclick: () => {
    if (t) { clearInterval(t); t = null; ends = null; tNum.textContent = '1:00'; timerBtn.lastChild.textContent = 'ابدأ دقيقة القياس'; return; }
    ends = Date.now() + 60000; timerBtn.lastChild.textContent = 'الغي';
    t = setInterval(() => { const l = Math.max(0, Math.ceil((ends - Date.now()) / 1000)); tNum.textContent = fmtClock(l); if (!l) { clearInterval(t); t = null; buzz(ctx, [90, 60, 90]); tone(ctx); timerBtn.lastChild.textContent = 'ابدأ دقيقة القياس'; after.input.focus(); } }, 250);
  } }, tNum, h('span', {}, 'ابدأ دقيقة القياس'));
  const save = async () => {
    const res = hrrResult(latin(peak.input.value), latin(after.input.value));
    if (!res) { after.err.textContent = 'اكتب الرقمين: آخر المجهود (60–230) وبعد دقيقة (أقل منه)'; after.input.setAttribute('aria-invalid', 'true'); return; }
    after.err.textContent = ''; after.input.setAttribute('aria-invalid', 'false');
    out.dataset.k = res.band;
    out.textContent = res.band === 'good' ? `نزل ${res.drop} نبضة. ممتاز (أكتر من 20).` : res.band === 'ok' ? `نزل ${res.drop} نبضة. كويس (13–20).` : `نزل ${res.drop} بس. لو اتكرر يوم القلب الجاي، اكشف عند دكتور.`;
    const rec = getRec();
    if (rec) { rec.hrRec = res; if (await safeWrite(ctx, () => putSession(ctx.db, rec))) ctx.toast('اتسجّل نزول النبض مع الجلسة.'); }
    else { setPending(res); ctx.toast('اتسجّل، وهيتحفظ مع الجلسة لما تخلص.'); }
  };
  const el = h('section', { class: 'glass wk-card hk-hrr', hidden: true, 'aria-labelledby': 'hk-hrr-h' },
    h('h3', { id: 'hk-hrr-h' }, 'اختبار نزول النبض بعد دقيقة'),
    h('p', { class: 'wk-muted' }, 'سجّل نبضك في آخر المجهود، وكمّل مشي أو تبديل هادي وإنت واقف أو قاعد على العجلة دقيقة، وسجّل تاني.'),
    timerBtn,
    h('div', { class: 'fgrid hk-2' }, peak.el, after.el),
    h('button', { type: 'button', class: 'btn ghost sm', onclick: save }, 'احفظ النتيجة'), out);
  return { el, destroy: () => t && clearInterval(t) };
}

// ── BP log ──
function bpLog(ctx, health, rerender) {
  const sys = numField({ id: 'hk-sys', label: 'الكبير', min: 70, max: 260 });
  const dia = numField({ id: 'hk-dia', label: 'الصغير', min: 40, max: 160 });
  const pul = numField({ id: 'hk-pul', label: 'النبض (اختياري)', min: 30, max: 220 });
  const cuffId = 'hk-cuff';
  const cuff = h('input', { type: 'checkbox', id: cuffId, role: 'switch', checked: health.cuffArm === false ? null : true });
  const res = h('div', { class: 'hk-bpres', 'aria-live': 'polite' });
  const fields = { sys, dia, pulse: pul };
  const read = () => validateBP({ sys: latin(sys.input.value), dia: latin(dia.input.value), pulse: latin(pul.input.value) });
  for (const [k, f] of Object.entries(fields)) {
    f.input.addEventListener('blur', () => { if (!f.input.value) return; const v = read(); f.err.textContent = v.errors[k] || ''; f.input.setAttribute('aria-invalid', String(!!v.errors[k])); });
    f.input.addEventListener('input', () => { if (f.err.textContent) { f.err.textContent = ''; f.input.setAttribute('aria-invalid', 'false'); } });
  }
  const add = async () => {
    const v = read();
    for (const [k, f] of Object.entries(fields)) { f.err.textContent = v.errors[k] || ''; f.input.setAttribute('aria-invalid', String(!!v.errors[k])); }
    if (!v.ok) { (v.errors.sys ? sys : v.errors.dia ? dia : pul).input.focus(); return; }
    const row = { id: `bp:${Date.now().toString(36)}`, at: new Date().toISOString(), day: ctx.today(), ...v.value, cuff: cuff.checked ? 'arm' : 'other' };
    if (await safeWrite(ctx, () => patchHealth(ctx.db, (c) => ({ ...c, cuffArm: cuff.checked, bp: [...(c.bp || []), row].slice(-400) })))) {
      const cat = bpCategory(row.sys, row.dia);
      ctx.toast(`اتسجّل: ${cat.label}`);
      rerender();
    }
  };
  const rows = [...(health.bp || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 14);
  const last = rows[0];
  if (last) {
    const c = bpCategory(last.sys, last.dia);
    res.append(h('div', { class: `hk-cat ${c.tone}` }, h('span', { class: 'pill' }, c.label), h('b', { dir: 'ltr' }, N(`${last.sys}/${last.dia}`)), h('small', {}, 'آخر قراءة')), h('p', {}, c.action));
  }
  const list = h('ul', { class: 'hk-bplist' }, ...rows.map((r) => {
    const c = bpCategory(r.sys, r.dia);
    return h('li', {}, h('span', { class: 'num', dir: 'ltr' }, `${r.sys}/${r.dia}`), r.pulse ? h('small', {}, 'نبض ', N(String(r.pulse))) : h('small', {}, ''),
      h('small', { class: `hk-tag ${c.tone}` }, c.label), h('small', { class: 'num' }, String(r.day || '').slice(5).replace('-', '/')),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': `امسح قراءة ${r.sys} على ${r.dia}`, onclick: async () => {
        if (!(await ctx.confirm({ title: 'تمسح القراءة دي؟', text: `${r.sys}/${r.dia} بتاريخ ${r.day}`, confirmLabel: 'امسح القراءة', danger: true }))) return;
        if (await safeWrite(ctx, () => patchHealth(ctx.db, (cur) => ({ ...cur, bp: (cur.bp || []).filter((x) => x.id !== r.id) })))) rerender();
      } }, ico('trash')));
  }));
  return h('section', { class: 'glass wk-card hk-bp', 'aria-labelledby': 'hk-bp-h' },
    h('h3', { id: 'hk-bp-h' }, 'سجل ضغط البيت'),
    h('p', { class: 'wk-muted' }, 'الهدف أقل من 120/80. قراءتين بينهم دقيقة، الصبح وبالليل.'),
    h('div', { class: 'fgrid hk-3' }, sys.el, dia.el, pul.el),
    h('label', { class: 'wk-switch', for: cuffId }, h('span', {}, 'جهاز دراع معتمد (مش رسغ ولا صباع)', h('small', { class: 'hk-sub' }, 'دراعك أكتر من 32 سم؟ استخدم كُم كبير 32–42 سم')), cuff, h('i', { 'aria-hidden': 'true' })),
    h('button', { type: 'button', class: 'btn', onclick: add }, 'سجّل القراءة'),
    res,
    rows.length ? list : h('p', { class: 'wk-muted hk-empty' }, 'لسه مفيش قراءات. أول قراءة بتدّيك تصنيفها والخطوة الجاية على طول.'),
    h('details', { class: 'wk-fold' }, h('summary', {}, 'إزاي تقيس صح'),
      h('ol', { class: 'wk-steps hk-ol' },
        h('li', {}, 'جهاز دراع أوتوماتيك معتمد، مش رسغ ولا صباع. ولو دراعك كبير خد كُم كبير (32–42 سم).'),
        h('li', {}, 'نص ساعة قبلها: لا قهوة ولا تدخين ولا تمرين ولا بري-وركاوت، وفضّي المثانة.'),
        h('li', {}, 'اقعد وضهرك مسنود ورجلك على الأرض من غير ما تحطها على بعض، ودراعك على ترابيزة في مستوى القلب على الجلد.'),
        h('li', {}, 'ارتاح 5 دقايق ساكت من غير موبايل.'),
        h('li', {}, 'قراءتين بينهم دقيقة، الصبح وبالليل، 7 أيام. شيل اليوم الأول وخد متوسط الباقي.'),
        h('li', {}, 'نفس الدراع كل مرة. أول مرة قيس الاتنين، ولو الفرق أكتر من 10 استخدم الأعلى وقول للدكتور.'))));
}

function tabs(ctx, cur) {
  const t = (key, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(cur === key), onclick: () => ctx.go('workout/heart', key === 'heart' ? {} : { tab: key }) }, label);
  return h('div', { class: 'chips hk-tabs', role: 'group', 'aria-label': 'أقسام القلب والضغط' }, t('heart', 'يوم القلب'), t('iso', 'ثابت في البيت'), t('bp', 'ضغط البيت'));
}

export async function renderHeart(el, ctx, params = {}) {
  const today = ctx.today();
  const [health, age, prog, sessions] = await Promise.all([loadHealth(ctx.db), loadAge(ctx.db),
    loadProgram(ctx.db).catch(() => ({ program: {} })), ctx.db.getAll('sessions').catch(() => [])]);
  const dow = new Date(`${today}T12:00:00`).getDay();
  const tab = ['heart', 'iso', 'bp'].includes(params.tab) ? params.tab : (dow === 3 || dow === 0) ? 'iso' : 'heart';
  const z = zones(age);
  const autoWeek = planWeek(prog.program && prog.program.startDay, today);
  const week = clampN(+params.week || autoWeek, 1, 12);
  const g = bpGate(health.bp, today);
  const gate = g.state;
  const rerender = () => ctx.go('workout/heart', { ...(params.tab ? { tab } : {}), ...(params.week ? { week: params.week } : {}) });
  const cleanups = [];
  const startDow = ctx.settings.get('weekStart') ?? 1;

  el.appendChild(band({ title: 'القلب والضغط', sub: tab === 'iso' ? ['الأربع والحد في البيت · ', N('14'), ' دقيقة'] : tab === 'bp' ? 'قراءاتك على جهازك بس' : ['السبت · ', N('30'), ' دقيقة · مش بتتحسب جلسة رفع'], back: () => ctx.go('workout') }));
  const root = h('div', { class: 'hk-root' });
  el.appendChild(root);
  root.appendChild(tabs(ctx, tab));

  if (tab === 'bp') {
    if (gate !== 'ok') root.appendChild(gateNote(g, ctx));
    root.appendChild(bpLog(ctx, health, rerender));
    return () => {};
  }
  if (tab === 'iso') {
    if (gate !== 'ok') root.appendChild(gateNote(g, ctx));
    if (gate === 'ok') {
      let saved = false;
      const p = blockPlayer(ctx, { blocks: isoPlan(), title: 'جلوس على الحيطة 4 × 2', headId: 'hk-iso-h', startLabel: 'ابدأ',
        onFinish: async (blocks) => {
          if (saved) return; saved = true;
          const rec = heartRecord({ mode: 'iso', blocks });
          if (await safeWrite(ctx, () => putSession(ctx.db, rec))) { ctx.emit('session:changed', { id: rec.id, state: 'heart' }); ctx.toast('اتسجّل تمرين الضغط الثابت.'); }
        } });
      root.appendChild(p.el);
      cleanups.push(drive(p.tick));
    }
    root.appendChild(h('section', { class: 'glass wk-card hk-art-card', 'aria-label': 'وضع الجلوس على الحيطة' }, wallSitArt()));
    root.appendChild(tipsCard('hk-wt-h', 'اعمله صح: الجلوس على الحيطة', WALL_TIPS));
    root.appendChild(h('p', { class: 'wk-muted hk-pad' }, 'البديل لو مش جنب حيطة: اقبض على كورة تنس أو فوطة ملفوفة بقوة متوسطة 4 × 2 دقيقة، وبدّل الإيد.'));
    root.appendChild(cueSwitches(ctx));
    return () => cleanups.forEach((f) => f());
  }

  // ── Heart Day: the player (main action) first, then the gate note, week picker and the info cards (QA r3 #5) ──
  const n = intervalsFor(week);
  const weekPick = (h('div', { class: 'hk-week' },
    h('label', { for: 'hk-wk' }, 'الأسبوع'),
    h('select', { id: 'hk-wk', onchange: (e) => ctx.go('workout/heart', +e.target.value === autoWeek ? {} : { week: e.target.value }) },
      ...Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === week ? true : null }, `${i + 1}${i + 1 === autoWeek ? ' (أسبوعك)' : ''}`))),
    h('small', {}, gate !== 'ok' ? 'مشي / Zone 2 لحد ما الضغط يتأكد' : n ? `فترات ${n} × 4 دقايق` : 'Zone 2 ‏18 دقيقة')));
  const infoCards = () => { root.appendChild(minutesCard(ctx, weeklyAerobic(sessions, health.walks, today, startDow), rerender)); root.appendChild(zonesCard(z)); };

  if (gate === 'stop') {
    root.appendChild(gateNote(g, ctx)); root.appendChild(tipsCard('hk-st-h', 'وقّف فوراً واطلب مساعدة لو', STOP_SIGNS));
    root.appendChild(weekPick); infoCards(); return () => {};
  }
  const blocks = heartPlan(week, { gate });
  const hrLog = [];
  let savedRec = null, pendingHrr = null;
  const hr = hrEntry(z, hrLog);
  const hrr = hrrCard(ctx, () => savedRec, (r) => { pendingHrr = r; });
  const hrrIdx = blocks.findIndex((b) => b.hrr);
  const p = blockPlayer(ctx, { blocks, title: 'يوم القلب', headId: 'hk-hd-h', startLabel: 'ابدأ يوم القلب',
    onBlock: (b, i) => {
      hr.hidden = !(b.kind === 'z2' || b.kind === 'easy');
      if (hrrIdx >= 0 && i === hrrIdx + 1) { hrr.el.hidden = false; ctx.toast('خلص المجهود: سجّل نبضك دلوقتي وابدأ دقيقة القياس.'); }
    },
    onFinish: async (done) => {
      hrr.el.hidden = hrrIdx < 0; hr.hidden = true;
      if (savedRec) return;
      const rec = heartRecord({ mode: 'heart', week, blocks: done, hrRec: pendingHrr, hrZ2: hrLog });
      savedRec = rec;
      if (await safeWrite(ctx, () => putSession(ctx.db, rec))) { ctx.emit('session:changed', { id: rec.id, state: 'heart' }); ctx.toast('اتسجّل يوم القلب. مش بيتحسب جلسة رفع.'); }
      else savedRec = null;
      // the heart-day pelvic-floor block counts as one of today's two pelvic-floor sessions (review M5)
      const pf = done.find((b) => b.kind === 'pelvic');
      if (pf && pf.doneS >= 60) await safeWrite(ctx, () => patchHealth(ctx.db, (c) => { const k = c.kegel || {}; return { ...c, kegel: { ...k, start: k.start || rec.day, log: [...(k.log || []), { day: rec.day, at: rec.finishedAt, src: 'heart', secs: pf.doneS }].slice(-500) } }; }));
    } });
  p.el.insertBefore(hr, p.el.querySelector('.hk-blocks'));
  root.appendChild(p.el);
  root.appendChild(hrr.el);
  cleanups.push(drive(p.tick), hrr.destroy);
  if (gate !== 'ok') root.appendChild(gateNote(g, ctx));
  root.appendChild(weekPick);
  infoCards();
  if (gate === 'ok') {
    root.appendChild(h('section', { class: 'glass wk-card hk-art-card', 'aria-label': 'وضع الجلوس على الحيطة' }, wallSitArt()));
    root.appendChild(tipsCard('hk-wt-h', 'اعمله صح: الجلوس على الحيطة', WALL_TIPS));
  }
  root.appendChild(h('a', { class: 'wk-recov glass', href: '#/workout/kegel' }, h('span', { class: 'ic' }, ico('spark')),
    h('span', { class: 'grow' }, h('b', {}, 'تمرين قاع الحوض'), h('small', {}, 'آخر جزء في الجلسة · التايمر الموجّه')), ico('chevron')));
  root.appendChild(tipsCard('hk-st-h', 'وقّف فوراً واطلب مساعدة لو', STOP_SIGNS));
  root.appendChild(cueSwitches(ctx));
  return () => cleanups.forEach((f) => f());
}
