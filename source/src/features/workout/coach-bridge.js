// Coach ↔ workout bridge. Pure preview of a coach proposal against the current program (diff, weekly sets per muscle
// vs MEV/MRV, guards), then a write through the store with an exact snapshot for Undo. Nothing here writes without
// applyChange(), which cards.js calls only after the user taps «طبّق».
// Also the one-shot «next session weights» store: kv.training.coachPrefill[dayId] = {at, reason?, items:{[itemId]:{sets:[{w,r}], note?, lib}}};
// session.js calls consumePrefill(ctx, dayId) once when that day's session starts.
import * as L from './logic.js';
import { libById, MUSCLE_LM } from './exercises.js';
import { loadProgram, saveProgram, loadTraining, patchTraining } from './store.js';
import { addDays, weekStart, diffDays, isDayKey } from '../../core/date.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const half = (x) => Math.round(x * 2) / 2;
export const MAX_SESSION_MIN = 60;

// Superset safety (review.md §1 / S6): never two axially loaded lifts or two grip-limited lifts in one superset.
const AXIAL = new Set(['ex41', 'ex41b', 'ex11', 'ex47', 'ex13', 'ex21', 'ex46c', 'ex16', 'ex45b', 'ex43']);
const GRIP = new Set(['ex11', 'ex47', 'ex12', 'exWPU', 'ex13', 'ex16', 'ex17', 'exFW', 'ex46c', 'ex71', 'ex72', 'ex81', 'ex82', 'exRWC']);
const COMBO = [['ex48', 'ex44']]; // often one combo machine: warn only (the default plan keeps this pair)

/** Day id from an id or a day name (case-insensitive). */
export function resolveDay(program, day) {
  if (!program || !day) return null;
  const k = String(day).trim();
  if (program.days[k]) return k;
  const lk = k.toLowerCase();
  return program.order.find((id) => id.toLowerCase() === lk || String(program.days[id].name).toLowerCase() === lk) || null;
}
/** Index of an item in a day by item id first, then by library id. */
export function resolveItem(program, dayId, exId) {
  const items = program?.days[dayId]?.items || [];
  const k = String(exId || '');
  let i = items.findIndex((x) => x.id === k);
  if (i < 0) i = items.findIndex((x) => x.lib === k);
  return i;
}

/** Planned weekly sets per fine muscle (each program day once a week; synergists 0.5). */
export function weeklyPlanned(program) {
  const out = {};
  for (const id of program?.order || []) for (const [m, n] of Object.entries(L.plannedByMuscle(program.days[id].items))) out[m] = (out[m] || 0) + n;
  for (const k of Object.keys(out)) out[k] = half(out[k]);
  return out;
}

const statusOf = (n, lm) => (!lm ? 'in' : n > lm.mrv ? 'over' : n < lm.mev ? 'under' : n > lm.mav ? 'high' : 'in');
/** Rows for the muscles whose weekly sets change (or that are named). */
export function muscleRows(before, after, only = null, also = []) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((m) => (before[m] || 0) !== (after[m] || 0));
  const keys = only || [...new Set([...also.filter(Boolean), ...changed])];
  return keys.filter((m) => MUSCLE_LM[m]).map((m) => {
    const lm = MUSCLE_LM[m]; const b = before[m] || 0; const a = after[m] || 0;
    return { muscle: m, before: b, after: a, mev: lm.mev, mrv: lm.mrv, status: statusOf(a, lm) };
  });
}

/** Arabic error when a superset group mixes two axial or two grip lifts; null when fine. */
export function ssConflict(items, tag) {
  if (!tag) return null;
  const libs = items.filter((x) => x.ss === tag).map((x) => x.lib);
  const n = (set) => libs.filter((l) => set.has(l)).length;
  if (n(AXIAL) >= 2) return 'السوبر سِت ده هيبقى فيه تمرينين بيحمّلوا الضهر (محوري + محوري). ده ممنوع في الخطة.';
  if (n(GRIP) >= 2) return 'السوبر سِت ده هيبقى فيه تمرينين بيتعبوا القبضة. ده ممنوع في الخطة.';
  return null;
}
function comboWarn(items, tag) {
  if (!tag) return null;
  const libs = new Set(items.filter((x) => x.ss === tag).map((x) => x.lib));
  return COMBO.some(([a, b]) => libs.has(a) && libs.has(b)) ? 'لو الرجل الأمامي والخلفي جهاز واحد، اعملهم مجموعات عادية ورا بعض.' : null;
}

const repsOk = (r) => { const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(String(r || '').trim()); if (!m) return false; const lo = +m[1], hi = +(m[2] ?? m[1]); return lo >= 3 && hi <= 30 && lo <= hi; };
const libName = (id) => libById(id)?.ar || id;
const sr = (it) => `${it.sets}×${it.reps}`;
export const fail = (error) => ({ ok: false, error });

function minutesOf(program, items) {
  const flags = L.programFlags(program);
  return L.estimateMinutes(items) + (flags.z2 ? 9 : 0); // 1 min transfer + ≥ 8 min Zone 2 (review.md M4)
}

/**
 * planChange(program, action, {training, today, weekStartDow}) → {ok:false, error} |
 * {ok:true, type, dayId, dayName, next (program|null), patch (kv.training patch|null), rows:[{label, before, after}],
 *  muscles:[{muscle, before, after, mev, mrv, status}], warnings:[], ack (warning that needs an explicit tick)|null, message}
 * Pure: the program passed in is never mutated.
 */
export function planChange(program, action, { training = {}, today = null, weekStartDow = 1 } = {}) {
  if (!program || !action) return fail('مفيش خطة نعدّل عليها.');
  if (action.type === 'workout.deload') return deloadChange(program, action, { training, today, weekStartDow });
  const dayId = resolveDay(program, action.day);
  if (!dayId) return fail('اليوم ده مش موجود في خطتك.');
  const day = program.days[dayId];
  const before = weeklyPlanned(program);
  const next = clone(program);
  const items = next.days[dayId].items;
  const warnings = []; let ack = null; const rows = []; let message = ''; const touched = [];
  const primeOf = (lib) => libById(lib)?.prime || null;
  const base = { ok: true, type: action.type, dayId, dayName: day.name, patch: null };

  if (action.type === 'workout.prefill') {
    const out = {}; const seen = new Set();
    for (const x of action.items) {
      const i = resolveItem(program, dayId, x.exId);
      if (i < 0) return fail(`التمرين «${libName(x.exId)}» مش في ${day.name}.`);
      const it = day.items[i];
      if (seen.has(it.id)) continue; seen.add(it.id);
      out[it.id] = { sets: x.sets.map((t) => ({ w: t.w, r: t.r })), lib: it.lib || null, ...(x.note ? { note: x.note } : {}) };
      rows.push({ label: it.ar, before: sr(it), after: x.sets.map((t) => `${L.fmtW(t.w)}×${t.r}`).join(' · '), note: x.note || '' });
    }
    const prev = training.coachPrefill || {};
    return { ...base, next: null, patch: { coachPrefill: { ...prev, [dayId]: { at: today, ...(action.reason ? { reason: action.reason } : {}), items: out } } },
      rows, muscles: [], warnings: prev[dayId] ? ['فيه أوزان مقترحة قبل كده لليوم ده، هتتبدّل بالجديدة.'] : [], ack: null,
      message: `أوزان ${day.name} الجاية جاهزة · هتظهر أول ما تبدأ الحصة` };
  }

  if (action.type === 'workout.swap') {
    const i = resolveItem(program, dayId, action.fromExId);
    if (i < 0) return fail(`التمرين ده مش في ${day.name}.`);
    const to = libById(action.toExId);
    if (!to) return fail('التمرين البديل مش في المكتبة.');
    const from = items[i];
    if (from.lib === to.id) return fail('ده نفس التمرين.');
    if (items.some((x, j) => j !== i && x.lib === to.id)) return fail(`«${to.ar}» موجود بالفعل في ${day.name}.`);
    const fromLib = libById(from.lib) || {};
    const pf = fromLib.prime || from.muscle; const pt = to.prime || to.muscle;
    touched.push(primeOf(from.lib), primeOf(to.id));
    if (pf !== pt) ack = `العضلة الأساسية مختلفة: «${pf || from.muscle}» ← «${pt || to.muscle}». متأكد إنك عايز تبدّل؟`;
    const id = items.some((x) => x.id === to.id) ? `${to.id}_${Date.now().toString(36)}` : to.id;
    items[i] = { ...from, id, lib: to.id, ar: to.ar, en: to.en, muscle: to.muscle, kind: to.kind }; // keeps sets/reps/rest/ss/rir/fill
    const c = ssConflict(items, items[i].ss); if (c) return fail(c);
    rows.push({ label: 'التمرين', before: from.ar, after: to.ar }, { label: 'المجموعات', before: sr(from), after: sr(items[i]) });
    message = `«${to.ar}» مكان «${from.ar}» في ${day.name}`;
  } else if (action.type === 'workout.sets') {
    const i = resolveItem(program, dayId, action.exId);
    if (i < 0) return fail(`التمرين ده مش في ${day.name}.`);
    const it = items[i]; touched.push(primeOf(it.lib));
    if (action.reps && !repsOk(action.reps)) return fail('العدّات لازم تكون بين 3 و 30.');
    const old = sr(it);
    it.sets = action.sets; if (action.reps) it.reps = action.reps;
    if (old === sr(it)) return fail('مفيش تغيير في المجموعات.');
    rows.push({ label: it.ar, before: old, after: sr(it) });
    message = `${it.ar}: ${sr(it)}`;
  } else if (action.type === 'workout.addExercise') {
    const lib = libById(action.exId);
    if (!lib) return fail('التمرين ده مش في المكتبة.');
    if (items.some((x) => x.lib === lib.id)) return fail(`«${lib.ar}» موجود بالفعل في ${day.name}.`);
    if (!repsOk(action.reps)) return fail('العدّات لازم تكون بين 3 و 30.');
    if (items.length >= 12) return fail('اليوم ده فيه 12 تمرين. مفيش مكان لتمرين زيادة.');
    const it = L.itemFromLib(lib.id);
    if (items.some((x) => x.id === it.id)) it.id = `${it.id}_${Date.now().toString(36)}`;
    it.sets = action.sets; it.reps = action.reps;
    let at = items.length;
    if (action.pairWith) {
      const j = resolveItem(next, dayId, action.pairWith);
      if (j < 0) return fail('التمرين اللي هيتعمل معاه سوبر سِت مش في اليوم ده.');
      const tag = items[j].ss || L.nextSsTag(items);
      if (items.filter((x) => x.ss === tag).length >= 3) return fail('السوبر سِت ده فيه 3 تمارين بالفعل.');
      items[j].ss = tag; it.ss = tag; if (items[j].restS) it.restS = items[j].restS;
      let k = j; while (k + 1 < items.length && items[k + 1].ss === tag) k++;
      at = k + 1;
      const c = ssConflict([...items, it], tag); if (c) return fail(c);
      const w = comboWarn([...items, it], tag); if (w) warnings.push(w);
    }
    items.splice(at, 0, it);
    rows.push({ label: it.ar, before: '—', after: `${sr(it)}${it.ss ? ` · سوبر ${it.ss}` : ''}` });
    message = `«${it.ar}» اتضاف لـ ${day.name}`;
  } else if (action.type === 'workout.removeExercise') {
    const i = resolveItem(program, dayId, action.exId);
    if (i < 0) return fail(`التمرين ده مش في ${day.name}.`);
    const [it] = items.splice(i, 1);
    if (it.ss) { const rest = items.filter((x) => x.ss === it.ss); if (rest.length === 1) { delete rest[0].ss; delete rest[0].fill; } }
    rows.push({ label: it.ar, before: sr(it), after: 'اتشال' });
    message = `«${it.ar}» اتشال من ${day.name}`;
  } else return fail('اقتراح مش مفهوم.');

  const after = weeklyPlanned(next);
  const muscles = muscleRows(before, after, null, touched);
  for (const r of muscles) {
    if (r.after > r.mrv && r.after > r.before) return fail(`«${r.muscle}» هتوصل ${r.after} مجموعة في الأسبوع، أكتر من الحد الأقصى للتعافي (${r.mrv}). ماينفعش.`);
    if (r.after < r.mev && r.before >= r.mev) warnings.push(`«${r.muscle}» هتنزل لـ ${r.after} مجموعة في الأسبوع، أقل من الحد الأدنى المفيد (${r.mev}).`);
  }
  const mins = minutesOf(program, next.days[dayId].items);
  if (mins > MAX_SESSION_MIN && mins > minutesOf(program, day.items)) warnings.push(`${day.name} هيبقى حوالي ${mins} دقيقة مع الكارديو، أطول من 60.`);
  return { ...base, next, rows, muscles, warnings, ack, message, minutes: { before: minutesOf(program, day.items), after: mins } };
}

function deloadChange(program, action, { training, today, weekStartDow }) {
  if (!isDayKey(today)) return fail('مفيش تاريخ النهارده.');
  if (L.deloadActive(training.deload, today)) return fail('إنت في أسبوع خفيف بالفعل.');
  let start = today;
  if (!action.now) {
    if (typeof action.startWeek === 'string' && isDayKey(action.startWeek)) start = weekStart(action.startWeek, weekStartDow);
    else start = addDays(weekStart(today, weekStartDow), 7 * Math.max(1, action.startWeek | 0));
    if (start < today) start = today;
  }
  if (diffDays(today, start) > 56) return fail('الديلود ده بعيد أوي. اختار أسبوع خلال 8 أسابيع.');
  const flags = L.programFlags(program);
  const mw = flags.meso ? L.mesoWeek(program.startDay, start) : null;
  const warnings = [];
  if (mw === 6) warnings.push('الأسبوع ده هو أسبوع 6 في الدورة، وهو تخفيف تلقائي أصلاً.');
  const prevDl = training.deload || null;
  const rows = [
    { label: 'البداية', before: prevDl?.active && prevDl.start >= today ? prevDl.start : '—', after: start === today ? `النهارده ${start}` : start },
    { label: 'المدة', before: '', after: `${L.DELOAD_DAYS} أيام` },
    { label: 'الجلسات', before: 'عادي', after: 'نص المجموعات · وزن أقل 10%' },
  ];
  return { ok: true, type: action.type, dayId: null, dayName: '', next: null, rows, muscles: [], warnings, ack: null,
    patch: { deload: { active: true, start, by: 'coach', ...(action.reason ? { reason: action.reason } : {}) } },
    message: start === today ? 'أسبوع الديلود بدأ النهارده' : `الديلود هيبدأ ${start}` };
}

/** Pending prefill for a day (read only). */
export const peekPrefill = (training, dayId) => (training && training.coachPrefill && training.coachPrefill[dayId]) || null;

/**
 * consumePrefill(ctx, dayId) → {[itemId]: {sets:[{w,r}], note?, lib}} | null. Removes it, so it applies to one session only.
 */
export async function consumePrefill(ctx, dayId) {
  const t = await loadTraining(ctx.db);
  const p = peekPrefill(t, dayId);
  if (!p) return null;
  const rest = { ...(t.coachPrefill || {}) }; delete rest[dayId];
  try { await patchTraining(ctx.db, { coachPrefill: rest }); } catch { return null; } // never apply twice
  return p.items && typeof p.items === 'object' ? p.items : null;
}

/**
 * applyChange(ctx, action, {ack}) → {ok, message, undo} | {ok:false, error}. Re-reads the current program first, so a stale
 * card can't overwrite newer edits. The undo restores the exact snapshot taken right before the write.
 */
export async function applyChange(ctx, action, { ack = false } = {}) {
  const { program, rec } = await loadProgram(ctx.db);
  const training = await loadTraining(ctx.db);
  const ch = planChange(program, action, { training, today: ctx.today(), weekStartDow: ctx.settings?.get?.('weekStart') ?? 1 });
  if (!ch.ok) return ch;
  if (ch.ack && !ack) return fail('أكّد التحذير الأول.');
  const prevRec = clone(rec);
  const prevKeys = ch.patch ? Object.fromEntries(Object.keys(ch.patch).map((k) => [k, clone(training[k])])) : null;
  if (ch.next) await saveProgram(ctx.db, ch.next, rec);
  if (ch.patch) await patchTraining(ctx.db, ch.patch);
  ctx.emit('session:changed', { state: 'plan', by: 'coach' });
  const undo = async () => {
    if (ch.next) { if (prevRec) await ctx.db.put('programs', prevRec); else await ctx.db.delete('programs', 'current'); }
    if (prevKeys) {
      const cur = await loadTraining(ctx.db);
      const value = { ...cur };
      for (const [k, v] of Object.entries(prevKeys)) { if (v === undefined) delete value[k]; else value[k] = v; }
      await ctx.db.put('kv', { key: 'training', value });
    }
    ctx.emit('session:changed', { state: 'plan', by: 'coach-undo' });
  };
  return { ok: true, message: ch.message, undo };
}
