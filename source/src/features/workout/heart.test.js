import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './heart.js';

test('HRmax and zones (Tanaka) for age 27 and profile fallbacks', () => {
  assert.equal(H.hrMax(27), 189);
  const z = H.zones(27);
  assert.deepEqual(z.z2, [113, 132]);
  assert.deepEqual(z.hard, [170, 180]);
  assert.equal(H.ageOf(null), 27);
  assert.equal(H.ageOf({ age: 35 }), 35);
  assert.equal(H.ageOf({ birthYear: 1999 }, new Date('2026-10-20T12:00:00')), 27);
  assert.equal(H.ageOf({ age: 'x' }), 27);
  assert.equal(H.zoneCheck(120, z.z2), 'in');
  assert.equal(H.zoneCheck(100, z.z2), 'low');
  assert.equal(H.zoneCheck(150, z.z2), 'high');
});

test('plan week from start day, clamped 1..12', () => {
  assert.equal(H.planWeek(null, '2026-10-20'), 1);
  assert.equal(H.planWeek('2026-10-20', '2026-10-20'), 1);
  assert.equal(H.planWeek('2026-10-01', '2026-10-20'), 3);
  assert.equal(H.planWeek('2026-01-01', '2026-10-20'), 12);
  assert.equal(H.planWeek('2026-11-01', '2026-10-20'), 1);
});

test('every Heart Day week totals exactly 30:00', () => {
  for (let w = 1; w <= 12; w++) for (const gate of ['ok', 'baseline', 'gp', 'block']) assert.equal(H.totalSecs(H.heartPlan(w, { gate })), 1800, `week ${w} ${gate}`);
});

test('weeks 1–4: 3 warm / 18 Z2 / 1 transfer / 2×2 wall sit / pelvic floor', () => {
  const p = H.heartPlan(2);
  assert.deepEqual(p.map((b) => [b.kind, b.dur]), [['warm', 180], ['z2', 1080], ['easy', 60], ['wall', 120], ['rest', 60], ['wall', 120], ['pelvic', 180]]);
  assert.equal(p.findIndex((b) => b.hrr), 1);
});

test('weeks 7–11: 4-3-4-3-4-1 (last minute is the HR-recovery test); weeks 5, 6, 12: 2×4', () => {
  const p = H.heartPlan(8);
  assert.deepEqual(p.slice(1, 7).map((b) => b.dur), [240, 180, 240, 180, 240, 60]);
  assert.equal(p.filter((b) => b.kind === 'hard').length, 3);
  assert.equal(p[p.findIndex((b) => b.hrr) + 1].dur, 60);
  for (const w of [5, 6, 12]) assert.equal(H.heartPlan(w).filter((b) => b.kind === 'hard').length, 2);
  assert.equal(H.intervalsFor(9), 3);
  assert.equal(H.intervalsFor(3), 0);
  assert.equal(H.heartPlan(9).filter((b) => b.kind === 'wall').length, 2);
});

test('locked gate: walking / Zone 2 only, no wall sit, no hard intervals', () => {
  const p = H.heartPlan(9, { gate: 'baseline' });
  assert.ok(!p.some((b) => b.kind === 'wall' || b.kind === 'hard'));
});

test('home isometrics: 4 × 2 min with 2-min rests = 14 min', () => {
  const p = H.isoPlan();
  assert.equal(p.filter((b) => b.kind === 'wall').length, 4);
  assert.ok(p.filter((b) => b.kind === 'rest').every((b) => b.dur === 120));
  assert.equal(H.totalSecs(p), 840);
});

test('AHA/ACC BP categories', () => {
  assert.equal(H.bpCategory(115, 75).key, 'normal');
  assert.equal(H.bpCategory(125, 78).key, 'elevated');
  assert.equal(H.bpCategory(125, 82).key, 'stage1');
  assert.equal(H.bpCategory(135, 70).key, 'stage1');
  assert.equal(H.bpCategory(142, 70).key, 'stage2');
  assert.equal(H.bpCategory(120, 95).key, 'stage2');
  assert.equal(H.bpCategory(185, 100).key, 'severe');
  assert.equal(H.bpCategory(150, 125).key, 'severe');
  assert.equal(H.bpCategory('', 80), null);
});

test('BP validation', () => {
  assert.ok(H.validateBP({ sys: 118, dia: 76 }).ok);
  assert.ok(H.validateBP({ sys: '118', dia: '76', pulse: '' }).ok);
  assert.ok(H.validateBP({ sys: 60, dia: 40 }).errors.sys);
  assert.ok(H.validateBP({ sys: 120, dia: 130 }).errors.dia);
  assert.ok(H.validateBP({ sys: 120, dia: 80, pulse: 10 }).errors.pulse);
});

const r = (day, sys, dia, at = 'm', cuff = 'arm') => ({ day, sys, dia, cuff, at: `${day}T${at === 'm' ? '07' : '21'}:00:00Z` });
const days3 = (s, d) => ['2026-10-17', '2026-10-18', '2026-10-19'].flatMap((x) => [r(x, s, d, 'm'), r(x, s, d, 'e')]);
test('BP gate: needs 3 days × 2 upper-arm readings, then thresholds', () => {
  const T = '2026-10-20';
  assert.equal(H.bpGate([], T).state, 'baseline');
  assert.equal(H.bpGate(days3(118, 76).slice(0, 4), T).state, 'baseline');
  assert.equal(H.bpGate(days3(118, 76), T).state, 'ok');
  assert.equal(H.bpGate(days3(118, 76).map((x) => ({ ...x, cuff: 'other' })), T).state, 'baseline');
  assert.equal(H.bpGate(days3(145, 85), T).state, 'gp');
  assert.equal(H.bpGate(days3(125, 92), T).state, 'gp');
  assert.equal(H.bpGate([...days3(118, 76), r('2026-10-16', 162, 80)], T).state, 'block');
  assert.equal(H.bpGate([r('2026-10-20', 165, 102)], T).state, 'block');
  assert.equal(H.bpGate([...days3(118, 76), { ...r('2026-10-20', 190, 100), at: '2026-10-20T23:00:00Z' }], T).state, 'stop');
  assert.equal(H.bpGate(days3(118, 76), '2026-12-30').state, 'baseline'); // old readings fall out of the 30-day window
});

test('HR recovery bands (Cole 1999)', () => {
  assert.equal(H.hrrResult(175, 150).band, 'good');
  assert.equal(H.hrrResult(175, 160).band, 'ok');
  assert.equal(H.hrrResult(175, 165).band, 'low');
  assert.equal(H.hrrResult(175, 163).band, 'low');
  assert.equal(H.hrrResult(170, 180), null);
});

test('pelvic floor progression over 12 weeks then maintenance', () => {
  const s1 = H.kegelStage(1);
  assert.equal(s1.hold, 3); assert.equal(s1.reps, 10); assert.deepEqual(s1.positions, ['lying', 'sitting', 'standing']); assert.equal(s1.perDay, 2);
  assert.equal(H.kegelStage(2).stage, 1);
  assert.equal(H.kegelStage(4).hold, 5);
  assert.equal(H.kegelStage(9).hold, 10);
  assert.equal(H.kegelStage(12).hold, 10);
  const m = H.kegelStage(13);
  assert.ok(m.maintenance); assert.equal(m.perDay, 1);
  for (let w = 1; w <= 13; w++) assert.ok(H.kegelStage(w + 1).hold >= H.kegelStage(w).hold);
  assert.equal(H.kegelWeek('2026-10-01', '2026-10-20'), 3);
  assert.equal(H.kegelWeek(null, '2026-10-20'), 1);
});

test('pelvic floor steps: holds per position + 1 s flicks, session ≈ 3–5 min', () => {
  const st = H.kegelStage(1);
  const steps = H.kegelSteps(st);
  assert.equal(steps.filter((s) => s.type === 'hold').length, 30);
  assert.equal(steps.filter((s) => s.type === 'flick').length, 5);
  assert.ok(steps.filter((s) => s.type === 'flick').every((s) => s.dur === 1));
  for (let w = 1; w <= 13; w++) { const t = H.totalSecs(H.kegelSteps(H.kegelStage(w))); assert.ok(t >= 150 && t <= 330, `week ${w}: ${t}s`); }
  assert.ok(H.kegelSteps(H.kegelStage(10)).some((s) => s.max));
});

test('weekly counts without streaks', () => {
  const log = [{ day: '2026-10-19' }, { day: '2026-10-20' }, { day: '2026-10-20' }, { day: '2026-10-12' }];
  assert.deepEqual(H.kegelWeekCount(log, '2026-10-20', 1), { week: 3, today: 2 });
});

test('weekly aerobic minutes: heart aerobic blocks + recovery cardio + walks', () => {
  const ses = [
    { kind: 'heart', day: '2026-10-19', blocks: [{ kind: 'warm', doneS: 180 }, { kind: 'z2', doneS: 1080 }, { kind: 'wall', doneS: 240 }, { kind: 'pelvic', doneS: 180 }] },
    { kind: 'recovery', mode: 'cardio', day: '2026-10-20', durationMin: 18 },
    { kind: 'recovery', mode: 'stretch', day: '2026-10-20', durationMin: 12 },
    { kind: 'heart', day: '2026-10-10', blocks: [{ kind: 'z2', doneS: 1200 }] },
    { day: '2026-10-20', exercises: [] },
  ];
  assert.equal(H.weeklyAerobic(ses, [{ day: '2026-10-20', min: 15 }], '2026-10-20', 1), 21 + 18 + 15);
});

test('heart record never looks like a lifting session', () => {
  const rec = H.heartRecord({ now: new Date('2026-10-24T08:00:00+04:00'), week: 1, blocks: [{ id: 'z2', kind: 'z2', dur: 1080, doneS: 1080 }], hrRec: { drop: 25 } });
  assert.equal(rec.kind, 'heart'); assert.equal(rec.day, '2026-10-24'); assert.equal(rec.durationS, 1080); assert.equal(rec.durationMin, 18);
  assert.equal(rec.exercises, undefined); assert.equal(rec.status, 'done'); assert.deepEqual(rec.hrRec, { drop: 25 });
});

test('runner: timestamps, pause, skip, carry-over after a locked screen', () => {
  let t = 0; const now = () => t;
  const steps = [{ dur: 10 }, { dur: 5 }, { dur: 3 }];
  const r = H.runner(steps, { now });
  assert.equal(r.left(), 10); r.toggle(); assert.ok(r.running());
  t = 4000; assert.equal(r.left(), 6);
  r.toggle(); t = 9000; assert.equal(r.left(), 6); r.toggle();
  t = 9000 + 6000 + 5000 + 1000; const res = r.tick();
  assert.equal(res.moved, 2); assert.equal(r.s.idx, 2); assert.equal(r.left(), 2);
  assert.equal(r.jump(1), 'finished'); assert.ok(r.s.finished);
  assert.deepEqual(r.s.done, [10, 5, 1]);
});
