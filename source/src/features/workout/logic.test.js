import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';
import { LIBRARY, PROGRAMS, muscleGroup, findLib } from './exercises.js';

const ses = (id, day, exercises, extra = {}) => ({ id, day, startedAt: `${day}T18:00:00+04:00`, status: 'done', exercises, ...extra });
const ex = (name, sets, extra = {}) => ({ exId: extra.exId || name, name, sets: sets.map(([w, r, rir = null]) => ({ w, r, rir, done: true })), ...extra });

test('e1rm uses Epley and guards bad input', () => {
  assert.equal(L.e1rm(100, 1), 100);
  assert.equal(L.e1rm(100, 5), 116.7);
  assert.equal(L.e1rm(80, 8), 101.3);
  assert.equal(L.e1rm(0, 5), 0);
  assert.equal(L.e1rm(100, 0), 0);
  assert.equal(L.e1rm(50, 20), 0);
  assert.equal(L.e1rm('82.5', '8'), 104.5);
});

test('parseReps handles ranges, singles, per-leg and time', () => {
  assert.deepEqual(L.parseReps('5-8'), { lo: 5, hi: 8 });
  assert.deepEqual(L.parseReps('15'), { lo: 15, hi: 15 });
  assert.deepEqual(L.parseReps('8-10/رجل'), { lo: 8, hi: 10 });
  assert.equal(L.parseReps('40 ثانية'), null);
  assert.equal(L.parseReps('45-60s'), null);
  assert.equal(L.parseReps(''), null);
});

test('one rest rule: compound 150 s, isolation 90 s', () => {
  assert.equal(L.restFor({ kind: 'compound' }), 150);
  assert.equal(L.restFor({ kind: 'isolation' }), 90);
  assert.equal(L.restFor({ name: 'Flat Barbell Bench Press · بار' }), 150);
  assert.equal(L.restFor({ name: 'Cable Lateral Raise · كابل' }), 90);
  assert.equal(L.restFor({ name: 'Some Unknown Row' }), 150);
});

test('rest timer is timestamp based', () => {
  const r = L.startRest({ kind: 'compound' }, 1_000_000);
  assert.equal(L.restRemaining(r, 1_000_000), 150);
  assert.equal(L.restRemaining(r, 1_000_000 + 60_500), 90);
  assert.equal(L.restRemaining(r, 1_000_000 + 10 * 60_000), 0); // screen locked for 10 min
  assert.equal(L.restRemaining(null), 0);
});

test('prescribe: no history uses plan; repeats last; ready → +2.5 kg at bottom of range', () => {
  const item = { id: 'uaFB', sets: 3, reps: '6-8', kind: 'compound', w: 60 };
  assert.deepEqual(L.prescribe(item, null).sets, [{ w: 60, r: 6 }, { w: 60, r: 6 }, { w: 60, r: 6 }]);
  const notYet = L.prescribe(item, ex('b', [[80, 8, 2], [80, 7, 1], [80, 6, 1]]));
  assert.equal(notYet.ready, false);
  assert.deepEqual(notYet.sets.map((t) => t.w), [80, 80, 80]);
  assert.deepEqual(notYet.sets.map((t) => t.r), [8, 7, 6]);
  const ready = L.prescribe(item, ex('b', [[80, 8, 2], [80, 8, 2], [80, 9, 1]]));
  assert.equal(ready.ready, true);
  assert.equal(ready.inc, 2.5);
  assert.deepEqual(ready.sets, [{ w: 82.5, r: 6 }, { w: 82.5, r: 6 }, { w: 82.5, r: 6 }]);
  // RIR too high means the top of the range was easy-ish but logged far from failure → not ready
  assert.equal(L.prescribe(item, ex('b', [[80, 8, 4], [80, 8, 4], [80, 8, 4]])).ready, false);
  // light isolation increments by 1 kg
  const lat = L.prescribe({ sets: 2, reps: '12-15' }, ex('l', [[9, 15], [9, 15]]));
  assert.equal(lat.inc, 1);
  assert.equal(lat.sets[0].w, 10);
});

test('prescribe deload halves sets and takes 10% off', () => {
  const p = L.prescribe({ sets: 4, reps: '5-8' }, ex('s', [[100, 6], [100, 6], [100, 6], [100, 5]]), { deload: true });
  assert.equal(p.sets.length, 2);
  assert.equal(p.sets[0].w, 90);
  assert.equal(p.ready, false);
});

test('PR detection: weight PR, e1RM PR, baseline is not a PR', () => {
  assert.equal(L.detectPR({ w: 80, r: 8, done: true }, { e1rm: 0, w: 0 }), null);
  assert.deepEqual(L.detectPR({ w: 82.5, r: 8, done: true }, { e1rm: 101.3, w: 80 }), { type: 'weight', value: 82.5, delta: 2.5 });
  assert.equal(L.detectPR({ w: 80, r: 9, done: true }, { e1rm: 101.3, w: 80 }).type, 'e1rm');
  assert.equal(L.detectPR({ w: 80, r: 8, done: true }, { e1rm: 101.3, w: 80 }), null);
  // a second heavier set in the same session only counts against earlier sets of the session too
  assert.equal(L.detectPR({ w: 82.5, r: 8, done: true }, { e1rm: 101.3, w: 80 }, [{ w: 82.5, r: 8 }]), null);
});

test('exposures/bests match legacy names to library exercises', () => {
  const hist = [
    ses('a', '2026-10-01', [ex('Flat Barbell Bench Press · بار · قبضة أمامية', [[80, 8]], { exId: 'uaFB' })]),
    ses('b', '2026-10-05', [ex('بنش', [[82.5, 6]], { exId: 'pp_fbb', lib: 'ex1' })]),
  ];
  const item = { id: 'zzz', lib: 'ex1' };
  const ex1 = L.exposures(hist, item);
  assert.equal(ex1.length, 2);
  assert.equal(ex1[0].session.id, 'b'); // newest first
  assert.deepEqual(L.bests(hist, item), { e1rm: L.e1rm(80, 8), w: 82.5 });
  assert.equal(findLib('Back Squat High-Bar · بار').id, 'ex41');
});

test('hard sets per muscle group within a week, RIR ≤ 4', () => {
  const hist = [
    ses('a', '2026-10-13', [ex('x', [[80, 8, 2], [80, 8, 5]], { muscle: 'صدر' }), ex('y', [[10, 12]], { muscle: 'كتف خلفي' })]),
    ses('b', '2026-10-15', [ex('z', [[100, 5], [100, 5]], { muscle: 'رجل خلفي' })]),
    ses('c', '2026-10-20', [ex('z', [[100, 5]], { muscle: 'رجل' })]),
  ];
  const v = L.hardSetsByMuscle(hist, '2026-10-13', '2026-10-19');
  assert.equal(v['صدر'], 1);
  assert.equal(v['أكتاف'], 1);
  assert.equal(v['رجلين'], 2);
  assert.equal(L.landmarkStatus(5, { mev: 8, mav: 12, mrv: 20 }), 'under');
  assert.equal(L.landmarkStatus(10, { mev: 8, mav: 12, mrv: 20 }), 'in');
  assert.equal(L.landmarkStatus(15, { mev: 8, mav: 12, mrv: 20 }), 'high');
  assert.equal(L.landmarkStatus(21, { mev: 8, mav: 12, mrv: 20 }), 'over');
  assert.equal(muscleGroup('ساعد'), null);
});

test('deload check: weeks, stall, active, cool-down', () => {
  const lift = (w) => [ex('Back Squat', [[w, 5]], { kind: 'compound' }), ex('Bench Press', [[w, 5]], { kind: 'compound' })];
  const rising = [ses('1', '2026-09-01', lift(80)), ses('2', '2026-09-08', lift(82.5)), ses('3', '2026-09-15', lift(85))];
  assert.equal(L.deloadCheck(rising, { today: '2026-09-16' }).suggest, false);
  const stalled = [ses('1', '2026-09-01', lift(85)), ses('2', '2026-09-08', lift(85)), ses('3', '2026-09-15', lift(82.5))];
  assert.deepEqual(L.deloadCheck(stalled, { today: '2026-09-16' }).reason, 'stall');
  const long = [ses('1', '2026-08-01', lift(80)), ses('2', '2026-09-01', lift(82.5)), ses('3', '2026-09-15', lift(85))];
  assert.equal(L.deloadCheck(long, { today: '2026-09-16' }).reason, 'weeks');
  assert.equal(L.deloadCheck(stalled, { today: '2026-09-16', deload: { active: true, start: '2026-09-14' } }).suggest, false);
  assert.equal(L.deloadCheck(stalled, { today: '2026-09-16', deload: { active: false, start: '2026-09-01' } }).suggest, false);
  assert.equal(L.deloadActive({ active: true, start: '2026-09-10' }, '2026-09-16'), true);
  assert.equal(L.deloadActive({ active: true, start: '2026-09-10' }, '2026-09-17'), false);
});

test('weeks on plan with forgiveness and flex weeks (Mon start, 4 planned)', () => {
  const mk = (days) => days.map((d, i) => ses(`s${i}`, d, []));
  // 3 full weeks of 3 sessions + this week 1 session → 3 weeks
  const s = mk(['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-05', '2026-10-06', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-16', '2026-10-19']);
  const r = L.weeksOnPlan(s, { plannedPerWeek: 4, weekStartDow: 1, today: '2026-10-20' });
  assert.equal(r.weeks, 3);
  assert.equal(r.thisWeek, 1);
  // an off-plan week without banked flex resets
  const gap = mk(['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-06', '2026-10-12', '2026-10-13', '2026-10-16']);
  assert.equal(L.weeksOnPlan(gap, { plannedPerWeek: 4, today: '2026-10-20' }).weeks, 1);
  // 8 on-plan weeks earn a flex that covers the 9th week
  const days = [];
  let d = '2026-08-03';
  for (let w = 0; w < 8; w++) { for (const k of [0, 1, 3]) days.push(addDaysT(d, w * 7 + k)); }
  const r2 = L.weeksOnPlan(mk(days), { plannedPerWeek: 4, today: '2026-10-05' });
  assert.equal(r2.weeks, 8);
  assert.equal(r2.flexUsed, 1);
  assert.equal(r2.bank, 0);
  assert.equal(L.weeksOnPlan([], { today: '2026-10-05' }).weeks, 0);
});
function addDaysT(k, n) { const [y, m, dd] = k.split('-').map(Number); const x = new Date(y, m - 1, dd + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }

test('programs: defaults, legacy Solo Gym days, rotation, quick session', () => {
  const p = L.normalizeProgram(null);
  assert.equal(p.activeProgram, 'ul4c');
  assert.deepEqual(p.order, ['upperA', 'lowerA', 'upperB', 'lowerB']);
  assert.equal(p.days.upperA.items[0].id, 'uaFB');
  assert.equal(p.days.upperA.items[0].kind, 'compound');
  const legacy = L.normalizeProgram({ activeProgram: 'ppl', days: { upperA: { name: 'Upper A', exercises: [
    { id: 'ua0', name: 'إحماء', isWarmup: true }, { id: 'uaFB', name: 'Flat Barbell Bench Press · بار', sets: 4, reps: '5-8', lastW: 60, muscle: 'صدر' }] } } });
  assert.equal(legacy.activeProgram, 'imported');
  assert.equal(legacy.days.upperA.items.length, 1);
  assert.equal(legacy.days.upperA.items[0].ar, 'بنش بريس بالبار');
  assert.equal(legacy.days.upperA.items[0].w, 60);
  assert.equal(L.nextDayId(p, []), 'upperA');
  assert.equal(L.nextDayId(p, [ses('x', '2026-10-01', [], { dayKey: 'upperB' })]), 'lowerB');
  assert.equal(L.nextDayId(p, [ses('x', '2026-10-01', [], { dayKey: 'lowerB' })]), 'upperA');
  const q = L.quickItems(p.days.upperA.items);
  assert.equal(q.length, 3);
  assert.ok(q.every((x) => x.kind === 'compound' && x.sets <= 3));
  assert.equal(L.normalizeProgram(L.fromTemplate('ppl6')).order.length, 6);
  assert.ok(Object.values(PROGRAMS).length >= 2);
  assert.ok(LIBRARY.length >= 70);
  assert.equal(new Set(LIBRARY.map((x) => x.id)).size, LIBRARY.length);
});

test('live session: build, next open set, finalize with PR + summary', () => {
  const item = { id: 'uaFB', lib: 'ex1', ar: 'بنش بريس بالبار', muscle: 'صدر', kind: 'compound', sets: 2, reps: '6-8' };
  const hist = [ses('old', '2026-10-12', [ex('Flat Barbell Bench Press', [[80, 8, 2], [80, 8, 2]], { exId: 'uaFB' })], { dayKey: 'upperA' })];
  const live = L.buildLive({ items: [item], dayId: 'upperA', dayName: 'Upper A', sessions: hist, now: new Date('2026-10-19T15:00:00Z') });
  assert.equal(live.day, '2026-10-19');
  assert.equal(live.exercises[0].ready, true);
  assert.deepEqual(live.exercises[0].sets.map((t) => t.w), [82.5, 82.5]);
  assert.deepEqual(L.nextOpen(live), { ex: 0, set: 0 });
  live.exercises[0].sets.forEach((t) => { t.done = true; t.r = 7; t.rir = 2; });
  assert.equal(L.nextOpen(live), null);
  const { record, prs } = L.finalize(live, hist, new Date('2026-10-19T15:52:00Z'));
  assert.equal(record.durationMin, 52);
  assert.equal(record.sets, 2);
  assert.equal(record.volume, 82.5 * 7 * 2);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].type, 'weight');
  const sum = L.summarize(record, [...hist, record]);
  assert.equal(sum.prevVolume, 1280);
  assert.equal(sum.deltaPct, Math.round(((1155 - 1280) / 1280) * 100));
  assert.equal(sum.prs.length, 1);
});

test('formatting uses Latin digits', () => {
  assert.equal(L.fmtW(82.5), '82.5');
  assert.equal(L.fmtW(80), '80');
  assert.equal(L.fmtInt(12345), '12,345');
  assert.equal(L.fmtInt(-19), '−19');
  assert.equal(L.fmtClock(150), '2:30');
  assert.equal(L.fmtClock(3725), '1:02:05');
  assert.equal(L.estimateMinutes([{ kind: 'compound', sets: 4 }, { kind: 'isolation', sets: 3 }]) > 0, true);
});

test('re-entry after a gap: 10% lighter, gapDays', () => {
  const p = L.prescribe({ sets: 2, reps: '5-8' }, ex('s', [[100, 6], [100, 6]]), { lighter: true });
  assert.deepEqual(p.sets.map((t) => t.w), [90, 90]);
  assert.equal(L.gapDays([ses('a', '2026-10-01', [])], '2026-10-09'), 8);
  assert.equal(L.gapDays([], '2026-10-09'), null);
  assert.equal(L.isActive({ status: 'active' }), true);
  assert.equal(L.finished([{ id: 'x', status: 'active', exercises: [] }]).length, 0);
});
