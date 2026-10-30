// Boxing Day (plan v3): curriculum week mapping, session time ≤ 40 min, BP-gate fallback, exclusion from lifting volume,
// schedule migration for users already on ul4c, side-delt cut, videos, weekly stats.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from './boxing-plan.js';
import * as L from './logic.js';
import { PROGRAMS, NEW_PROGRAM } from './exercises.js';
import { VIDEOS, videoFor } from './exercise-videos.js';
import { BOX_VIDEOS } from './boxing-videos.js';
import { weeklyAerobic } from './heart.js';
import { cardioDayOf, pinTrainingDays } from '../../core/schema.js';
import { heartDowOf, heartDaysOf, dayType, targetsForDay } from '../../core/targets.js';
import { isRecovery, lifting } from '../progress/metrics.js';
import { countsAsSession } from '../progress/logic.js';

const arm = (day, sys, dia, at = `${day}T07:00:00Z`) => ({ day, at, sys, dia, cuff: 'arm' });
const okLog = (from = '2026-10-26') => ['2026-10-26', '2026-10-27', '2026-10-28'].flatMap((d, i) => [arm(d, 118, 76, `${d}T07:0${i}:00Z`), arm(d, 116, 74, `${d}T19:0${i}:00Z`)]);
const box = (day, rounds = [], extra = {}) => ({ id: `b:${day}`, kind: 'boxing', mode: 'full', day, status: 'done', durationS: 2100, durationMin: 35,
  phases: [{ id: 'rope', kind: 'rope', dur: 300, doneS: 300 }, { id: 'bag1', kind: 'bag', dur: 120, doneS: 120 }, { id: 'core', kind: 'core', dur: 180, doneS: 180 }, { id: 'wall1', kind: 'wall', dur: 120, doneS: 120 }],
  rounds, ...extra });

test('curriculum: 12 weeks as data, combo + ≤ 3 Egyptian-Arabic cues + mistakes, and the four phases in order', () => {
  assert.equal(B.CURRICULUM.length, 12);
  B.CURRICULUM.forEach((w, i) => {
    assert.equal(w.week, i + 1);
    assert.ok(w.combo.code && w.combo.ar, `week ${w.week} combo`);
    assert.ok(w.cues.length >= 1 && w.cues.length <= 3, `week ${w.week} cues ≤ 3`);
    assert.ok(w.mistakes.length >= 1, `week ${w.week} mistakes`);
    assert.ok(w.cues.every((c) => /[؀-ۿ]/.test(c)), 'Arabic cues');
    assert.ok(w.drill.label && w.drill.video);
  });
  assert.deepEqual(B.CURRICULUM.map((w) => w.phase), ['base', 'base', 'base', 'power', 'power', 'power', 'defense', 'defense', 'defense', 'master', 'master', 'master']);
  assert.equal(B.curriculumFor(2).combo.code, '1-2');
  assert.equal(B.curriculumFor(4).combo.code, '1-2-3');
  assert.equal(B.curriculumFor(5).combo.code, '1-2-3-2');
  assert.match(B.curriculumFor(7).title, /سليب/);
  assert.match(B.curriculumFor(12).title, /صوّر/);
  assert.equal(B.curriculumFor(0).week, 1); assert.equal(B.curriculumFor(99).week, 12);
});

test('curriculum week mapping: block start, weeks 13+ cycle 7–12, deload weeks 6/12 and active deload → technique-only, re-entry', () => {
  const s = '2026-09-03'; // a Thursday
  assert.equal(B.boxingWeek({ startDay: null, today: '2026-10-30' }).week, 1, 'no start date yet → week 1');
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-09-03' }).week, 1);
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-09-09' }).week, 1);
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-09-10' }).week, 2);
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-08-01' }).week, 1, 'before the start → week 1');
  const w6 = B.boxingWeek({ startDay: s, today: '2026-10-08' });
  assert.equal(w6.week, 6); assert.equal(w6.deload, true); assert.equal(w6.tech, true); assert.equal(w6.why, 'deload');
  const w7 = B.boxingWeek({ startDay: s, today: '2026-10-15' });
  assert.equal(w7.week, 7); assert.equal(w7.tech, false);
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-11-19' }).week, 12);
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-11-19' }).deload, true, 'week 12 = block 2 week 6');
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-11-26' }).week, 7, 'week 13 cycles to 7');
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-12-31' }).week, 12, 'week 18 → 12, still the deload week');
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-12-31' }).deload, true);
  // a manual deload (kv.training.deload) also turns boxing technique-only
  const man = B.boxingWeek({ startDay: s, today: '2026-10-15', deload: { active: true, start: '2026-10-13' } });
  assert.equal(man.tech, true); assert.equal(man.week, 7);
  // re-entry: weeks 1–2 of the ramp, technique-only, and the block (and week 1) starts after it
  const re = { active: true, week: 2, of: 2, startDay: '2026-10-22', endDay: '2026-11-05' };
  const r2 = B.boxingWeek({ startDay: s, today: '2026-10-30', reentry: re });
  assert.deepEqual([r2.week, r2.reentry, r2.tech, r2.why], [2, true, true, 'reentry']);
  assert.equal(B.boxingWeek({ startDay: s, today: '2026-11-05', reentry: { ...re, active: false } }).week, 1, 'block restarts after re-entry');
  // the lifting meso week and the boxing week agree on the same block start
  assert.equal(L.mesoWeek(L.blockStart(s, null), '2026-10-08'), 6);
});

test('session template: every phase timed, total ≤ budget ≤ 40 min for all weeks, lengths and modes; 35 min default', () => {
  for (let w = 1; w <= 12; w++) for (const m of [30, 35, 40, 20, 90]) for (const [tech, iso] of [[false, true], [true, false], [true, true], [false, false]]) {
    const p = B.boxingPlan({ week: w, budgetMin: m, tech, iso });
    assert.ok(p.total <= Math.min(40, Math.max(30, m)) * 60, `w${w} ${m} tech=${tech} iso=${iso}: ${p.total}`);
    assert.ok(p.total <= 40 * 60);
    assert.ok(p.phases.every((x) => Number.isInteger(x.dur) && x.dur > 0), 'timed');
    assert.equal(p.total, B.totalSecs(p.phases));
    assert.equal(new Set(p.phases.map((x) => x.id)).size, p.phases.length, 'unique ids');
  }
  const d = B.boxingPlan({ week: 1 });
  assert.equal(d.total, 35 * 60);
  const k = (p, kind) => p.phases.filter((x) => x.kind === kind);
  assert.equal(k(d, 'rope')[0].dur, 300, 'jump rope + joint prep 5 min');
  assert.deepEqual(k(d, 'shadow').map((x) => x.dur), [120, 120, 120], 'shadow 3 × 2 min');
  assert.deepEqual(k(d, 'srest').map((x) => x.dur), [30, 30]);
  assert.deepEqual(k(d, 'bag').map((x) => x.dur), [120, 120, 120, 120], 'weeks 1–3: 4 × 2 min');
  assert.deepEqual(k(d, 'brest').map((x) => x.dur), [60, 60, 60], '1 min off');
  assert.ok(k(d, 'drill').length >= 1 && k(d, 'drill').every((x) => x.dur === 120));
  assert.equal(k(d, 'core')[0].dur, 180);
  const health = [...k(d, 'wall'), ...d.phases.filter((x) => x.id === 'wrest'), ...k(d, 'pelvic')].reduce((a, x) => a + x.dur, 0);
  assert.ok(health >= 360 && health <= 480, `health block 6–8 min: ${health}`);
  // weeks 4+: 3-min rounds, trimmed to fit (5 at most, fewer at 35)
  const w8 = B.boxingPlan({ week: 8, budgetMin: 40 });
  assert.ok(k(w8, 'bag').every((x) => x.dur === 180));
  assert.ok(k(w8, 'bag').length >= 3 && k(w8, 'bag').length <= 5);
  assert.ok(k(B.boxingPlan({ week: 8, budgetMin: 30 }), 'bag').length < k(w8, 'bag').length, '30 chip trims rounds');
  assert.ok(B.boxingPlan({ week: 8, budgetMin: 30 }).total <= 1800);
  // combo of the week rides on every bag round, with the round counter
  assert.ok(k(w8, 'bag').every((x, i) => x.combo.code === B.curriculumFor(8).combo.code && x.round === i + 1 && x.of === k(w8, 'bag').length));
  // chips: 30 → 30, 45 → 40 (cap), nothing picked (60) → 35
  assert.deepEqual([30, 45, 60, 75, 35, 40, undefined].map(B.boxingBudget), [30, 40, 35, 35, 35, 40, 35]);
});

test('BP gate: ≥ 160/100 or no 3-day baseline → technique-only (shadow + light bag RPE ≤ 6) with a plain-Arabic reason; wall sit skipped', () => {
  const today = '2026-10-29';
  const none = B.boxingGate([], today);
  assert.deepEqual([none.state, none.tech, none.iso, none.stop], ['baseline', true, false, false]);
  assert.match(none.why, /3 أيام/);
  const ok = B.boxingGate(okLog(), today);
  assert.deepEqual([ok.state, ok.tech, ok.iso], ['ok', false, true]);
  const hi = B.boxingGate([...okLog(), arm('2026-10-29', 162, 92, '2026-10-29T07:30:00Z')], today);
  assert.deepEqual([hi.state, hi.tech, hi.iso], ['block', true, false]);
  assert.match(hi.why, /160\/100/);
  const dia = B.boxingGate([...okLog(), arm('2026-10-29', 150, 101, '2026-10-29T07:30:00Z')], today);
  assert.equal(dia.state, 'block');
  const stop = B.boxingGate([...okLog(), arm('2026-10-29', 185, 100, '2026-10-29T07:30:00Z')], today);
  assert.deepEqual([stop.state, stop.stop], ['stop', true]);
  // the whole day: technique-only plan, light rounds, no wall sit, still timed and ≤ 40
  const t = B.boxingToday({ startDay: '2026-09-03', today: '2026-10-15', bp: [] });
  assert.equal(t.tech, true); assert.equal(t.plan.mode, 'tech'); assert.equal(t.plan.rpeMax, 6);
  assert.ok(t.plan.phases.filter((x) => x.kind === 'bag').every((x) => x.light && x.dur === 120));
  assert.equal(t.plan.phases.filter((x) => x.kind === 'wall').length, 0);
  assert.ok(t.plan.phases.some((x) => x.kind === 'pelvic'));
  assert.match(t.why, /تكنيك/);
  const full = B.boxingToday({ startDay: '2026-09-03', today: '2026-10-29', bp: okLog() });
  assert.equal(full.tech, false); assert.equal(full.plan.mode, 'full'); assert.equal(full.plan.phases.filter((x) => x.kind === 'wall').length, 2);
  assert.equal(B.boxingToday({ today, bp: [...okLog(), arm('2026-10-29', 190, 100, '2026-10-29T08:00:00Z')] }).plan, null, 'stop → no session');
  assert.equal(B.SAFETY.length, 3); assert.match(B.SAFETY[0], /رباط/); assert.match(B.SAFETY[1], /الصدر/); assert.match(B.SAFETY[1], /دوخة/);
});

test('record kind boxing: cardio minutes yes; lifting volume, lifting days, PRs and session counts no', () => {
  const rec = B.boxingRecord({ now: new Date('2026-10-29T16:00:00Z'), week: 4, phases: B.boxingPlan({ week: 4 }).phases.map((p) => ({ ...p, doneS: p.dur })), rpe: { bag1: 7, bag2: 8, sh1: 4, bag9: 99 }, combo: B.curriculumFor(4).combo });
  assert.equal(rec.kind, 'boxing'); assert.equal(rec.status, 'done'); assert.equal(rec.day, '2026-10-29');
  assert.equal(rec.exercises, undefined, 'no exercises array');
  assert.equal(rec.durationS, 35 * 60); assert.equal(rec.combo, '1-2-3');
  assert.equal(rec.rounds.find((r) => r.id === 'bag1').rpe, 7);
  assert.equal(rec.rounds.find((r) => r.id === 'sh1').rpe, 4);
  const lift = { id: 's1', day: '2026-10-28', status: 'done', dayKey: 'lowerB', exercises: [{ exId: 'la2', lib: 'ex47', name: 'ديدليفت روماني', muscle: 'رجل خلفي', kind: 'compound', sets: [{ w: 80, r: 8, done: true }] }] };
  const all = [lift, rec];
  assert.deepEqual(L.finished(all).map((s) => s.id), ['s1'], 'finished() = lifting only');
  assert.deepEqual(L.hardSetsByMuscle(all, '2026-10-26', '2026-10-31', { by: 'muscle' }), L.hardSetsByMuscle([lift], '2026-10-26', '2026-10-31', { by: 'muscle' }));
  assert.equal(L.prList(all).length, L.prList([lift]).length);
  assert.equal(isRecovery(rec), true); assert.deepEqual(lifting(all).map((s) => s.id), ['s1']);
  assert.equal(countsAsSession(rec), false);
  // nutrition: a logged boxing session makes the day a cardio ('heart', 2550) day, never training
  assert.ok(heartDaysOf(all).has('2026-10-29'));
  assert.equal(dayType('2026-10-29', { heartDays: heartDaysOf(all), trainingDays: [0, 2, 3, 6] }), 'heart');
  assert.equal(targetsForDay('2026-10-29', { heartDow: 4, trainingDays: [0, 2, 3, 6] }).kcal, 2550);
  // weekly aerobic minutes count rope/shadow/bag/drill + their rests, not core / wall sit / pelvic floor
  const cardioMin = Math.round(B.boxingCardioSecs(rec) / 60);
  assert.ok(cardioMin >= 25 && cardioMin < 35, String(cardioMin));
  assert.equal(weeklyAerobic([rec], [], '2026-10-30', 1), cardioMin);
  // weekly boxing stats for Progress
  const st = B.boxingWeekStats([rec, box('2026-10-20', [{ kind: 'bag', dur: 120, doneS: 120, rpe: 6 }])], '2026-10-30', 1);
  assert.deepEqual([st.sessions, st.rounds, st.minutes], [1, rec.rounds.filter((r) => r.kind === 'bag').length, 35]);
  assert.equal(st.avgRpe, Math.round(((7 + 8 + 4) / 3) * 10) / 10);
  assert.equal(B.roundDone({ dur: 180, doneS: 89 }), false); assert.equal(B.roundDone({ dur: 180, doneS: 90 }), true);
});

test('volume engine: boxing week takes 1–2 side-delt sets off (Lower A / Lower B lateral raises), never below 2 sets; other plans untouched', () => {
  const p = L.fromTemplate(NEW_PROGRAM);
  const r = L.boxingAdjust(p);
  assert.deepEqual(r.cuts, [{ day: 'lowerA', id: 'laLR' }, { day: 'lowerB', id: 'lbLR' }]);
  assert.equal(r.program.days.lowerA.items.find((x) => x.id === 'laLR').sets, 3);
  assert.equal(r.program.days.lowerB.items.find((x) => x.id === 'lbLR').sets, 2);
  assert.equal(p.days.lowerA.items.find((x) => x.id === 'laLR').sets, 4, 'original untouched');
  const side = (prog) => prog.order.reduce((a, d) => a + (L.plannedByMuscle(prog.days[d].items)['كتف جانبي'] || 0), 0);
  const cut = side(p) - side(r.program);
  assert.ok(cut >= 1 && cut <= 2, String(cut));
  // the day estimate uses the cut and says why
  const e = L.dayEstimate({ program: p, sessions: [], today: '2026-10-25', dayId: 'lowerA', budgetMin: 60, weekStartDow: 0 }); // Sunday = week start: the rest of the week is still planned
  assert.equal(e.plan.items.find((x) => x.id === 'laLR').sets, 3);
  assert.ok(e.plan.changes.some((c) => c.code === 'box' && /الملاكمة/.test(c.text)));
  // a plan without boxing (legacy v2 Heart Day, ppl6) keeps its sets
  const v2 = { ...p, tv: 2 };
  assert.equal(L.boxingAdjust(v2).cuts.length, 0);
  assert.equal(L.boxingAdjust(L.fromTemplate('ppl6')).cuts.length, 0);
  // never under 2 sets
  const lean = L.fromTemplate(NEW_PROGRAM); lean.days.lowerB.items.find((x) => x.id === 'lbLR').sets = 2;
  assert.ok(!L.boxingAdjust(lean).cuts.some((c) => c.id === 'lbLR'));
});

test('schedule migration: ul4c v2 on Mon/Tue/Thu/Fri → plan-update card moves to Sat/Sun/Tue/Wed + Thursday boxing; keep = boxing Saturday', () => {
  const t = PROGRAMS.ul4c;
  assert.equal(t.version, 3);
  assert.deepEqual(t.schedule, { 6: 'upperA', 0: 'lowerA', 2: 'upperB', 3: 'lowerB' });
  assert.deepEqual([...t.trainingDays], [0, 2, 3, 6]);
  // a user on v2 with the old weekday layout
  const v2 = { ...L.fromTemplate('ul4c'), tv: 2, schedule: { 1: 'upperA', 2: 'lowerA', 4: 'upperB', 5: 'lowerB' } };
  const norm = L.normalizeProgram({ ...v2, v: 2 });
  assert.deepEqual(L.programFlags(norm), { z2: true, meso: true, heartDow: 6, cardio: 'heart', boxing: false }, 'still the Saturday Heart Day until he answers');
  const u = L.planUpdate(norm);
  assert.equal(u.from, 2); assert.equal(u.to, 3);
  const sc = u.changes.find((c) => c.kind === 'schedule');
  assert.equal(sc.ok, true); assert.match(sc.text, /السبت Upper A · الحد Lower A · التلات Upper B · الأربع Lower B/);
  assert.ok(u.changes.some((c) => c.kind === 'info' && /الملاكمة/.test(c.text)));
  assert.equal(u.applicable, 1);
  const r = L.applyPlanUpdate(norm);
  assert.deepEqual(r.program.schedule, { 6: 'upperA', 0: 'lowerA', 2: 'upperB', 3: 'lowerB' });
  assert.deepEqual(r.trainingDays, [0, 2, 3, 6]);
  assert.equal(r.program.tv, 3);
  assert.equal(L.planUpdate(r.program), null);
  assert.deepEqual(L.programFlags(r.program), { z2: true, meso: true, heartDow: 4, cardio: 'boxing', boxing: true });
  assert.equal(heartDowOf({ ...r.program, v: 2 }), 4, 'core/targets agrees with programFlags');
  assert.deepEqual(norm.schedule, { 1: 'upperA', 2: 'lowerA', 4: 'upperB', 5: 'lowerB' }, 'original untouched (Undo)');
  // the pure migration: training days follow only when they were still the old default
  assert.deepEqual(L.scheduleMigration(norm, [1, 2, 4, 5]).trainingDays, [0, 2, 3, 6]);
  assert.deepEqual(L.scheduleMigration(norm, null).trainingDays, [0, 2, 3, 6]);
  assert.deepEqual(L.scheduleMigration(norm, [1, 3, 5]).trainingDays, [1, 3, 5], 'his own days stay');
  assert.equal(L.scheduleMigration(r.program, [0, 2, 3, 6]), null, 'already migrated');
  assert.equal(L.scheduleMigration({ ...norm, schedule: { 1: 'upperA', 3: 'lowerA' } }), null, 'his own schedule: nothing to migrate');
  // «خلّيها زي ما هي»: tv 3 with the old days → boxing on the free Saturday, lifting days untouched
  const keep = { ...norm, tv: 3 };
  assert.deepEqual(cardioDayOf(keep), { dow: 6, kind: 'boxing' });
  assert.equal(L.programFlags(keep).boxing, true);
  // boot pin: the ctx default moved to Sat/Sun/Tue/Wed; installs with any stored older layout keep Mon/Tue/Thu/Fri explicitly
  assert.equal(pinTrainingDays(null), null, 'fresh install → the v3 default');
  assert.equal(pinTrainingDays({ ...r.program, v: 2 }), null, 'already v3');
  assert.deepEqual(pinTrainingDays({ ...norm, v: 2 }), [1, 2, 4, 5]);
  assert.deepEqual(pinTrainingDays({ v: 2, activeProgram: 'ppl6', order: ['pushA'], days: { pushA: {} } }), [1, 2, 4, 5]);
  assert.deepEqual(pinTrainingDays({ days: { d1: { exercises: [{ name: 'Bench' }] } } }), [1, 2, 4, 5], 'legacy Solo Gym record');
  // the Today/Workout planner sees Thursday as the boxing day on v3
  assert.equal(L.nextDayId(r.program, [], '2026-10-31'), 'upperA'); // Saturday
  assert.equal(L.nextDayId(r.program, [], '2026-10-28'), 'lowerB'); // Wednesday
});

test('videos: every curriculum item, the wraps and jump-rope basics have a verified, valid entry in the shared VIDEOS shape', () => {
  const keys = new Set([...B.CURRICULUM.flatMap((w) => [...w.videos, w.drill.video]), ...B.GEAR_VIDEOS,
    ...B.boxingPlan({ week: 1 }).phases.map((p) => p.video).filter(Boolean)]);
  for (const k of keys) {
    const r = videoFor(k);
    assert.equal(r && r.kind, 'video', k);
    assert.match(r.url, /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/, k);
    assert.ok(r.channel && r.title, k);
  }
  for (const [k, c] of Object.entries(BOX_VIDEOS)) {
    assert.ok(k.startsWith('box.'), k);
    assert.equal(VIDEOS[k], c, `${k} merged into VIDEOS`);
    assert.match(c.verified, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(c.dur, /^\d{1,2}:\d{2}$|^short$/);
  }
  assert.ok(B.GEAR_VIDEOS.includes('box.wraps') && B.GEAR_VIDEOS.includes('box.rope'));
  assert.equal(new Set(Object.values(BOX_VIDEOS).map((c) => c.id)).size, Object.keys(BOX_VIDEOS).length, 'no duplicate ids');
  // short videos preferred: all but one are under 10 min
  const long = Object.values(BOX_VIDEOS).filter((c) => { const [m] = c.dur.split(':').map(Number); return m >= 10; });
  assert.ok(long.length <= 1, long.map((c) => c.title).join());
});

test('coach context lines: boxing day, curriculum week, combo, cues, safe mode wording, weekly rounds', () => {
  const lines = B.boxingContextLines({ startDay: '2026-09-03', today: '2026-10-29', bp: okLog(), sessions: [box('2026-10-29', [{ kind: 'bag', dur: 180, doneS: 180, rpe: 7 }])], dow: 4 });
  const txt = lines.join('\n');
  assert.match(txt, /Boxing Day: Thu/);
  assert.match(txt, /week 9 of 12/);
  assert.match(txt, /combo of the week/);
  assert.match(txt, /Cues: /);
  assert.match(txt, /1 bag rounds/);
  assert.doesNotMatch(txt, /\d{3}\/\d{2,3}/, 'no BP readings in the context');
  const tech = B.boxingContextLines({ startDay: '2026-09-03', today: '2026-10-29', bp: [], dow: 4 }).join('\n');
  assert.match(tech, /technique-only/);
});
