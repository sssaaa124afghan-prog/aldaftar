// «استورد أوزانك القديمة»: the old GymPro Elite / Solo Gym backup → one baseline per plan day (pure; tests in oldweights.test.js).
// Privacy: only `ses`, `days`, `bw` and `profile.weight` / `profile.bodyweight` are ever read from the file. Everything else
// (API keys included) is dropped right after JSON.parse and never stored, logged or returned. Parsing happens on the device.
//
// Per plan item: the last 3 valid sessions of the mapped old exercises → best (Epley e1RM), last, the chosen working weight and
// the re-entry week 1 / week 2 loads (× 0.8 / × 0.9, rounded by the equipment step — the same rule the live session uses).
import { LIBRARY, PROGRAMS, libById, enKey, findLib } from './exercises.js';
import { e1rm, parseReps, roundLoad, equipStep, REENTRY } from './logic.js';
import { dayKeyFromInstant, isDayKey, diffDays } from '../../core/date.js';

export const BAR_KG = 20;
const SIDE_MAX = 0.6;     // a barbell value under 0.6 × that exercise's median may be one side's plates
const FIT = [0.85, 1.15]; // a reading fits when it lands within ±15 % of the neighbouring sessions (week-to-week loads rarely move more) [opinion]
const FIT_PLAN = [0.7, 1.3]; // looser when only the old plan's own weight is there to compare with [opinion]
const SPIKE = 1.5;        // a session e1RM over 1.5 × the exercise's median session e1RM is a logging slip [opinion]
const TYPO = 3;           // a set over 3 × the exercise's median weight is a typo (3012, 2275 …)

/**
 * Old name (English part before «·», lower case) → [[library id, factor]]. Cross-maps follow the plan's swaps:
 * flat DB press → 15° low-incline DB at 95 %; overhead cable triceps → also the standing rope overhead at 90 %;
 * EZ / barbell curl → preacher; lying leg curl → seated; barbell hip thrust → Smith / machine; any pull-up → pull-up history.
 */
const T = (lib, f = 1) => [lib, f];
export const OLD_MAP = Object.freeze({
  'flat barbell bench press': [T('ex1')], 'barbell bench press': [T('ex1')], 'bench press': [T('ex1')], 'flat bench press': [T('ex1')],
  'weighted pull-up': [T('exWPU')], 'weighted pull-ups': [T('exWPU')], 'pull-ups weighted': [T('exWPU')], 'pull-ups': [T('exWPU')],
  'pull-up': [T('exWPU')], 'pullups': [T('exWPU')], 'bodyweight pull-up': [T('exWPU')], 'chin-ups': [T('exWPU')], 'chin-up': [T('exWPU')],
  'lat pulldown': [T('ex14')], 'lat pull-down': [T('ex14')],
  'incline db press 30°': [T('ex2')], 'incline db press': [T('ex2')], 'incline dumbbell press': [T('ex2')],
  'chest-supported t-bar row': [T('exCSTB')], 'chest supported t-bar row': [T('exCSTB')],
  'cable lateral raise': [T('ex27')], 'lateral raise': [T('ex23')], 'lateral raises': [T('ex23')], 'db lateral raise': [T('ex23')],
  'reverse pec-dec': [T('exRPD')], 'reverse pec-deck': [T('exRPD')], 'reverse pec deck': [T('exRPD')], 'rear delt fly': [T('exRPD')],
  'overhead cable triceps ext': [T('exOCT'), T('exROE', 0.9)], 'overhead cable triceps extension': [T('exOCT'), T('exROE', 0.9)],
  'standing rope overhead cable ext': [T('exROE')], 'rope overhead cable ext': [T('exROE')],
  'incline db curl': [T('ex31')], 'incline dumbbell curl': [T('ex31')],
  'back squat': [T('ex41')], 'back squat high-bar': [T('ex41')], 'squat': [T('ex41')],
  'romanian deadlift': [T('ex47')], 'rdl': [T('ex47')],
  'barbell hip thrust': [T('exMHT')], 'hip thrust': [T('exMHT')], 'smith hip thrust': [T('exMHT')], 'machine hip thrust': [T('exMHT')],
  'smith or machine hip thrust': [T('exMHT')],
  'seated leg curl': [T('ex48')], 'lying leg curl': [T('ex48')],
  'leg extension': [T('ex44')], 'standing calf raise': [T('ex51')], 'hanging leg raise': [T('ex65')],
  'wrist curl': [T('ex81')], 'reverse wrist curl': [T('exRWC')],
  'flat db press': [T('exLID', 0.95)], 'low-incline db press 15°': [T('exLID')], 'low-incline db press': [T('exLID')],
  'seated db shoulder press': [T('ex22')], 'db shoulder press': [T('ex22')],
  'seated cable row': [T('ex15')], 'face pull': [T('ex24')],
  'cable woodchopper': [T('exWCH')], 'high-to-low cable woodchop': [T('exWCH')],
  'ez-bar curl': [T('ex32')], 'barbell curl': [T('ex32')], 'preacher curl': [T('ex32')],
  'bulgarian split squat': [T('ex42')], 'cable crunch': [T('ex62')], 'hack squat': [T('ex45b')],
  'hip adduction': [T('exADD')], 'hip adduction machine': [T('exADD')], 'db shrug': [T('ex72')], 'dumbbell shrug': [T('ex72')],
});
const LIB_BY_EN = new Map(LIBRARY.map((e) => [e.en.toLowerCase(), e.id]));
/** [[lib, factor]] for an old exercise name; [] when it has no place in the plan. */
export function mapOldName(name) {
  const k = enKey(name);
  if (!k) return [];
  if (OLD_MAP[k]) return OLD_MAP[k];
  return LIB_BY_EN.has(k) ? [T(LIB_BY_EN.get(k))] : [];
}

export const FLAG_TEXT = Object.freeze({
  side: 'اتفسّر كوزن جنب واحد',
  ambiguous: 'مش واضح جنب ولا إجمالي · اتشال',
  typo: 'رقم غلط اتشال',
  spike: 'جلسة شاذة اتشالت',
  plan: 'من الخطة القديمة · مفيش جلسات',
  cross: 'من تمرين قريب',
});

const num = (v) => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : +v; return Number.isFinite(n) ? n : NaN; };
const median = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); if (!v.length) return 0; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : '');

/**
 * Parse the backup text and keep ONLY the four fields this feature needs. Returns {ok, data:{ses, days, bw, weight}} or
 * {ok:false, reason}. The parsed object is never returned, so nothing else from the file (keys, chats) can leak.
 */
export function pickSafe(text) {
  let o;
  try { o = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch { return { ok: false, reason: 'json' }; }
  // wrapped exports: {gymProAI_v12_fixed: "<json string>"} or {data: {...}}
  for (let i = 0; i < 3 && o && typeof o === 'object' && !Array.isArray(o) && !Array.isArray(o.ses); i++) {
    const inner = Object.values(o).find((v) => (typeof v === 'string' && /"ses"\s*:/.test(v)) || (v && typeof v === 'object' && Array.isArray(v.ses)));
    if (!inner) break;
    try { o = typeof inner === 'string' ? JSON.parse(inner) : inner; } catch { break; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, reason: 'shape' };
  const ses = [];
  for (const s of Array.isArray(o.ses) ? o.ses.slice(0, 5000) : []) {
    if (!s || typeof s !== 'object' || !s.exs || typeof s.exs !== 'object') continue;
    const day = dayKeyFromInstant(s.date);
    if (!day) continue;
    const exs = [];
    for (const e of Object.values(s.exs).slice(0, 60)) {
      if (!e || typeof e !== 'object' || !Array.isArray(e.sets)) continue;
      exs.push({ name: str(e.name), unit: str(e.unit, 30), sets: e.sets.slice(0, 20).map((t) => ({ w: num(t && t.w), r: num(t && t.r), done: !!(t && t.done) })) });
    }
    if (exs.length) ses.push({ day, at: str(s.date, 40), dk: str(s.dk, 40), exs });
  }
  const days = {};
  if (o.days && typeof o.days === 'object') {
    for (const [id, d] of Object.entries(o.days).slice(0, 20)) {
      if (!d || !Array.isArray(d.exercises)) continue;
      days[str(id, 40)] = { name: str(d.name, 60), exercises: d.exercises.slice(0, 40).filter((e) => e && !e.isWarmup)
        .map((e) => ({ name: str(e.name), unit: str(e.unit, 30), lastW: num(e.lastW) })) };
    }
  }
  const bw = (Array.isArray(o.bw) ? o.bw : []).map((b) => ({ day: b && dayKeyFromInstant(b.date), kg: num(b && (b.w ?? b.kg)), at: str(b && b.date, 40) }))
    .filter((b) => b.day && b.kg >= 25 && b.kg <= 300);
  const p = o.profile && typeof o.profile === 'object' ? o.profile : {};
  const pw = num(p.weight ?? p.bodyweight);
  o = null; // drop the rest of the file
  return { ok: true, data: { ses: ses.sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at)), days, bw, weight: pw >= 25 && pw <= 300 ? pw : null } };
}

const isBodyUnit = (u) => /وزن جسم/.test(u || '');
const isAddedUnit = (u) => /مضاف/.test(u || '');
const isTotalUnit = (u) => /إجمالي|اجمالي/.test(u || '');

/** Body weight to tell «w = body weight» apart from added load: file bw → profile → median of «وزن جسم» sets. */
export function bodyweightOf(data) {
  const last = [...(data.bw || [])].sort((a, b) => a.day.localeCompare(b.day)).pop();
  if (last) return last.kg;
  if (data.weight) return data.weight;
  const ws = [];
  for (const s of data.ses || []) for (const e of s.exs) if (isBodyUnit(e.unit)) for (const t of e.sets) if (t.done && t.w >= 25 && t.w <= 300) ws.push(t.w);
  return ws.length ? median(ws) : null;
}

/** Old plan's own working weight for an exercise (days[].exercises[].lastW), by mapped library id. */
function planLastW(days, lib) {
  for (const d of Object.values(days || {})) for (const e of d.exercises) {
    if (!(e.lastW > 0)) continue;
    const m = mapOldName(e.name).find(([id]) => id === lib);
    if (m) return { w: e.lastW, unit: e.unit, name: e.name, f: m[1] };
  }
  return null;
}

/**
 * History of one old exercise (all its old names that map to the same source key) → cleaned sessions.
 * Steps: valid sets (done, r ≥ 3, w > 0) → typo sets (> 3 × median) out → barbell per-side check → spike sessions out.
 * → {sessions:[{day, dk, sets:[{w,r}], work, e1rm, flags:Set}], dropped:[{day, code}]}
 */
export function cleanHistory(entries, { eq, lib, bwKg = null, anchorW = 0 } = {}) {
  const body = eq === 'وزن جسم';
  const dropped = [];
  let rows = entries.map((x) => ({ day: x.day, dk: x.dk, unit: x.unit, flags: new Set(),
    sets: x.sets.filter((t) => t.done && t.r >= 3 && t.r <= 60 && (body ? t.w >= 0 : t.w > 0) && Number.isFinite(t.w)).map((t) => ({ w: t.w, r: t.r })) }));
  // body-weight lifts store w = body weight → 0 added; «وزن مضاف» keeps a real added load
  if (body) {
    for (const x of rows) x.sets = x.sets.map((t) => {
      const asBody = isBodyUnit(x.unit) || !isAddedUnit(x.unit) || (bwKg ? Math.abs(t.w - bwKg) <= 6 || t.w >= 0.8 * bwKg : t.w >= 40);
      return { w: asBody ? 0 : t.w, r: t.r };
    });
  }
  // typos: > 3 × the median set weight, or absurd values
  const med = median(rows.flatMap((x) => x.sets.map((t) => t.w)).filter((w) => w > 0));
  for (const x of rows) {
    const keep = x.sets.filter((t) => !(t.w >= 1000 || (med > 0 && t.w > TYPO * med)));
    if (keep.length < x.sets.length) { x.flags.add('typo'); dropped.push({ day: x.day, code: 'typo' }); }
    x.sets = keep;
  }
  // dumbbells logged as a total of both → per hand
  if (eq === 'دمبل') for (const x of rows) if (isTotalUnit(x.unit)) x.sets = x.sets.map((t) => ({ w: t.w / 2, r: t.r }));
  rows = rows.filter((x) => x.sets.length);
  const work = (sets) => { const c = new Map(); for (const t of sets) c.set(t.w, (c.get(t.w) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]; };
  // barbell: one side's plates vs the total — pick the reading that fits the neighbouring sessions
  const barbell = eq === 'بار' || (eq !== 'دمبل' && eq !== 'وزن جسم' && rows.some((x) => isTotalUnit(x.unit)));
  if (barbell && rows.length) {
    const anchor = Math.max(median(rows.map((x) => work(x.sets))), +anchorW || 0);
    const low = (w) => w < SIDE_MAX * anchor;
    const normal = rows.filter((x) => !low(work(x.sets)));
    const dist = (a, b) => Math.abs(Date.parse(a) - Date.parse(b));
    // neighbours: the 3 nearest sessions (in time) that are not in doubt; none → the old plan's own weight
    const refOf = (x) => {
      if (!normal.length) return { ref: +anchorW || 0, fit: FIT_PLAN };
      const near = [...normal].sort((a, b) => dist(a.day, x.day) - dist(b.day, x.day)).slice(0, 3);
      return { ref: median(near.map((y) => work(y.sets))), fit: FIT };
    };
    if (normal.length || anchorW > 0) {
      for (const x of rows) {
        const keep = [];
        const { ref, fit } = refOf(x);
        for (const t of x.sets) {
          if (!low(t.w)) { keep.push(t); continue; }
          const side = 2 * t.w + BAR_KG, rs = side / ref, rt = t.w / ref;
          if (rs >= fit[0] && rs <= fit[1]) { keep.push({ w: side, r: t.r, side: true }); x.flags.add('side'); }
          else if (rt >= fit[0] && rt <= fit[1]) keep.push(t);
          else x.flags.add('ambiguous');
        }
        if (keep.length < x.sets.length) dropped.push({ day: x.day, code: 'ambiguous' });
        x.sets = keep;
      }
      rows = rows.filter((x) => x.sets.length);
    }
  }
  for (const x of rows) { x.work = work(x.sets); x.e1rm = Math.max(...x.sets.map((t) => e1rm(t.w, t.r) || 0)); }
  // spikes: a session far above the exercise's usual level (another machine, a slip) never becomes the baseline
  if (!body && rows.length >= 3) {
    const m = median(rows.map((x) => x.e1rm).filter((v) => v > 0));
    rows = rows.filter((x) => { const bad = m > 0 && x.e1rm > SPIKE * m; if (bad) dropped.push({ day: x.day, code: 'spike' }); return !bad; });
  }
  return { sessions: rows, dropped, lib };
}

const pct = (f) => `${Math.round(f * 100)}%`;
/** Re-entry loads for a chosen working weight: week 1 × 0.8, week 2 × 0.9, rounded by the equipment step. */
export function reentryPreview(w, eq) {
  w = +w || 0;
  if (!(w > 0) || !equipStep(eq, w)) return { w1: w > 0 ? w : 0, w2: w > 0 ? w : 0 };
  return { w1: roundLoad(w * REENTRY[1].load, eq, w), w2: roundLoad(w * REENTRY[2].load, eq, w) };
}

/** Plan days to seed: the active program when it is the 4-day ul4c plan, else the ul4c template (ids line up by library). */
export function planDays(program) {
  const p = program && program.activeProgram === 'ul4c' && program.days ? program : PROGRAMS.ul4c;
  return (p.order || Object.keys(p.days)).filter((id) => p.days[id]).map((id) => ({ id, name: p.days[id].name, items: p.days[id].items }));
}

/**
 * The review model: {days:[{id, name, date, rows}], rows, bodyweight, lastDay, gap, bwKg}.
 * row = {key, dayId, itemId, lib, ar, eq, sets, reps, sources, best, last, chosen, w1, w2, body, flags:[code], review, from}
 */
export function buildImport(data, { program = null, today = null } = {}) {
  const bwKg = bodyweightOf(data);
  // old entries grouped by target library id
  const byLib = new Map();
  for (const s of data.ses || []) for (const e of s.exs) for (const [lib, f] of mapOldName(e.name)) {
    if (!byLib.has(lib)) byLib.set(lib, new Map());
    const src = enKey(e.name);
    const m = byLib.get(lib);
    if (!m.has(src)) m.set(src, { f, entries: [] });
    m.get(src).entries.push({ day: s.day, dk: s.dk, unit: e.unit, sets: e.sets });
  }
  const cache = new Map();
  function historyFor(lib) {
    if (cache.has(lib)) return cache.get(lib);
    const L = libById(lib);
    const out = { sessions: [], dropped: [], sources: [] };
    for (const [src, { f, entries }] of byLib.get(lib) || []) {
      // the old exercise's own equipment decides the per-side / per-hand reading (EZ curl is a barbell even though it maps
      // to the preacher machine); the factor then maps it onto the plan exercise
      const SL = findLib(src) || L;
      const anchor = planLastW(data.days, lib);
      const c = cleanHistory(entries, { eq: SL.eq, lib: SL.id, bwKg, anchorW: anchor && enKey(anchor.name) === src ? anchor.w : 0 });
      const cross = f !== 1 || SL.id !== lib;
      for (const x of c.sessions) out.sessions.push({ ...x, src, f, cross, sets: x.sets.map((t) => ({ ...t, w: t.w * f })), work: x.work * f, e1rm: x.e1rm * f });
      out.dropped.push(...c.dropped.map((d) => ({ ...d, src })));
      out.sources.push(src);
    }
    out.sessions.sort((a, b) => a.day.localeCompare(b.day));
    cache.set(lib, out);
    return out;
  }
  const lastDayOf = {};
  for (const s of data.ses || []) { if (s.dk) lastDayOf[s.dk] = s.day; }
  const lastDay = (data.ses || []).reduce((m, s) => (s.day > m ? s.day : m), '');
  const mkRow = (day, it) => {
    const L = libById(it.lib); if (!L) return null;
    const body = L.eq === 'وزن جسم';
    const H = historyFor(it.lib);
    const range = parseReps(it.reps) || { lo: 8, hi: 12 };
    const row = { key: `${day.id}:${it.id}`, dayId: day.id, itemId: it.id, lib: it.lib, ar: L.ar, en: L.en, eq: L.eq, muscle: L.muscle, kind: L.kind,
      sets: +it.sets || 3, reps: it.reps, sources: H.sources, best: null, last: null, chosen: 0, body, flags: [], from: null };
    const last3 = H.sessions.slice(-3);
    if (last3.length) {
      const all = last3.flatMap((x) => x.sets.map((t) => ({ ...t, day: x.day })));
      const b = all.reduce((m, t) => (e1rm(t.w, t.r) > e1rm(m.w, m.r) ? t : m), all[0]);
      const ls = last3[last3.length - 1];
      const lt = ls.sets.filter((t) => t.w === ls.work).sort((x, y) => y.r - x.r)[0] || ls.sets[0];
      row.best = { w: b.w, r: b.r, e1rm: e1rm(b.w, b.r), day: b.day };
      row.last = { w: ls.work, r: lt.r, day: ls.day };
      // his own number stays as it was (machines differ); only a %-mapped weight is rounded to the equipment step
      row.chosen = body ? 0 : ls.f === 1 ? Math.round(ls.work * 100) / 100 : roundLoad(ls.work, L.eq, ls.work / ls.f);
      row.reps0 = Math.max(range.lo, Math.min(range.hi > range.lo ? range.hi - 1 : range.hi, lt.r));
      row.from = 'history';
      const flags = new Set();
      for (const x of last3) { for (const f of x.flags) flags.add(f); if (x.cross) flags.add('cross'); }
      const from = last3[0].day;
      for (const d of H.dropped) if (d.day >= from) flags.add(d.code);
      row.flags = [...flags];
      if (last3.some((x) => x.cross)) row.crossNote = [...new Set(last3.filter((x) => x.cross).map((x) => (x.f !== 1 ? `${x.src} × ${pct(x.f)}` : x.src)))].join(' · ');
    } else {
      const p = planLastW(data.days, it.lib);
      if (p && !body) {
        row.chosen = roundLoad(p.w * p.f * (L.eq === 'دمبل' && isTotalUnit(p.unit) ? 0.5 : 1), L.eq, p.w);
        row.reps0 = range.lo; row.from = 'plan'; row.flags = ['plan'];
      } else if (body && H.sources.length) { row.from = 'history'; row.reps0 = range.lo; }
    }
    if (!row.from) return null;
    Object.assign(row, body ? { w1: 0, w2: 0 } : reentryPreview(row.chosen, L.eq));
    row.review = row.flags.some((f) => f !== 'cross');
    return row;
  };
  const days = [];
  // the user's own plan first; if nothing in it maps (renamed/custom items), fall back to the default ul4c template
  let pdays = planDays(program);
  if (!pdays.some((d) => d.items.some((it) => libById(it.lib) && historyFor(it.lib).sessions.length))) pdays = planDays(null);
  for (const d of pdays) {
    const rows = d.items.map((it) => mkRow(d, it)).filter(Boolean);
    // pull-up history stays as pull-up history (the plan has the pulldown until the pull-up gate passes)
    if (d.id === 'upperA' && !d.items.some((x) => x.lib === 'exWPU' || x.lib === 'ex12') && historyFor('exWPU').sessions.length) {
      const pu = mkRow(d, { id: 'ub1', lib: 'exWPU', sets: 4, reps: '6-10' });
      if (pu) { pu.extra = true; rows.push(pu); }
    }
    if (rows.length) days.push({ id: d.id, name: d.name, date: lastDayOf[d.id] || lastDay || null, rows });
  }
  const latestBw = [...(data.bw || [])].sort((a, b) => a.day.localeCompare(b.day)).pop() || null;
  let gap = null;
  if (lastDay && today && isDayKey(today)) { try { gap = diffDays(lastDay, today); } catch { gap = null; } }
  return { days, rows: days.flatMap((d) => d.rows), bodyweight: latestBw ? { day: latestBw.day, kg: latestBw.kg } : null, lastDay: lastDay || null, gap, bwKg };
}

/** Edit one row's chosen weight (kg as typed, to 0.25) → updates w1 / w2 (those follow the equipment step). */
export function setChosen(row, w) {
  const v = Math.max(0, Math.min(500, +w || 0));
  row.chosen = row.body ? 0 : Math.round(v * 4) / 4;
  Object.assign(row, row.body ? { w1: 0, w2: 0 } : reentryPreview(row.chosen, row.eq));
  row.edited = true;
  return row;
}

/** Stepper step for a row: the equipment step at that weight (2.5 when unknown). */
export const stepOf = (row) => equipStep(row.eq, row.chosen || 0, row.chosen || 0) || 2.5;

export const SEED_PREFIX = 'seed:';
/**
 * Seed records: one synthetic «baseline» session per plan day, dated the old last session of that day, flagged
 * seed:true / kind:'baseline'. Each exercise holds `sets` × the chosen weight at the bottom of the rep range (never above
 * top − 1, so a seed alone never triggers a load increase). Rows with no weight (loaded lift at 0) are skipped.
 */
export function seedSessions(model, { now = new Date(), program = 'ul4c' } = {}) {
  const out = [];
  for (const d of model.days) {
    const exs = d.rows.filter((r) => r.body || r.chosen > 0).map((r) => ({
      exId: r.itemId, lib: r.lib, name: r.ar, en: r.en, muscle: r.muscle, kind: r.kind, seed: true,
      sets: Array.from({ length: Math.max(1, Math.min(10, r.sets)) }, () => ({ w: r.body ? 0 : r.chosen, r: r.reps0 || parseReps(r.reps)?.lo || 8, rir: null, done: true })),
    }));
    if (!exs.length) continue;
    const day = d.date || model.lastDay;
    if (!day) continue;
    const at = `${day}T12:00:00.000Z`;
    out.push({ id: `${SEED_PREFIX}${d.id}`, seed: true, kind: 'baseline', status: 'done', day, startedAt: at, finishedAt: at, dayKey: d.id, dayName: d.name,
      program, importedAt: now.toISOString(), exercises: exs });
  }
  return out;
}
