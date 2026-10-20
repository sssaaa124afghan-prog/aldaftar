// Tests for the restored Solo Gym intelligence (parity §11 WP-Workout acceptance checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';
import { PROGRAMS, LIBRARY, registerCustom, libById } from './exercises.js';
import { TIPS, FORM_PHASES, BREATHING_CUES, STATIONS } from './content.js';

const day = (n) => `2026-${String(9 + Math.floor((n - 1) / 30)).padStart(2, '0')}-${String(((n - 1) % 30) + 1).padStart(2, '0')}`;
const ses = (id, d, exercises, extra = {}) => ({ id, day: d, startedAt: `${d}T18:00:00+04:00`, finishedAt: `${d}T19:00:00+04:00`, status: 'done', exercises, ...extra });
const ex = (sets, extra = {}) => ({ exId: 'uaFB', lib: 'ex1', name: 'بنش بريس بالبار', muscle: 'صدر', kind: 'compound',
  sets: sets.map(([w, r, rir = null, type]) => ({ w, r, rir, done: true, ...(type ? { type } : {}) })), ...extra });
const item = { id: 'uaFB', lib: 'ex1', ar: 'بنش بريس بالبار', muscle: 'صدر', kind: 'compound', sets: 3, reps: '6-8' };
const hist = (tops) => tops.map((w, i) => ses(`s${i}`, day(i * 3 + 1), [ex([[w, 6], [w, 6], [w, 6]])]));

test('recommend: 3 equal tops → plateau + 3 protocols; 4 equal → deload 90% rounded to 2.5', () => {
  const p = L.recommend(hist([75, 80, 80, 80]), item);
  assert.equal(p.status, 'plateau');
  assert.equal(p.protocols.length, 3);
  assert.equal(p.weight, 82.5);
  const d = L.recommend(hist([80, 80, 80, 80]), item);
  assert.equal(d.status, 'deload');
  assert.equal(d.weight, 72.5); // 72 → 72.5
  assert.equal(L.recommend(hist([92.5, 92.5, 92.5, 92.5]), item).weight, 82.5); // 83.25 → 82.5
  assert.equal(L.recommend(hist([70, 75]), item).status, 'progressing');
  assert.equal(L.recommend([], item).status, 'new');
});

test('velocity: reps down with RIR down → fatigue_drop; reps up → improving', () => {
  const a = [ses('a', day(1), [ex([[80, 8, 3], [80, 8, 3]])]), ses('b', day(4), [ex([[80, 6, 1], [80, 6, 0]])])];
  assert.equal(L.velocity(a, item), 'fatigue_drop');
  const b = [ses('a', day(1), [ex([[80, 6, 2]])]), ses('b', day(4), [ex([[80, 8, 2]])])];
  assert.equal(L.velocity(b, item), 'improving');
  assert.equal(L.velocity([ses('a', day(1), [ex([[80, 6]])])], item), 'stable');
});

test('estimateRir: 100 × 8 with best e1RM 125 → 2; clamps and guards', () => {
  assert.equal(L.estimateRir(100, 8, 125), 2);
  assert.equal(L.estimateRir(120, 5, 125), 0);
  assert.equal(L.estimateRir(50, 5, 125), 5);
  assert.equal(L.estimateRir(0, 5, 125), null);
  assert.equal(L.estimateRir(100, 5, 0), null);
  const h = [ses('a', day(1), [ex([[100, 7.5]])])];
  assert.ok(L.recentBestE1rm(h, item) > 0);
});

test('RIR zone guidance matches the zone table', () => {
  assert.match(L.rirZone(0).msg, /الفشل/);
  assert.match(L.rirZone(1).msg, /حافظ على الوزن/);
  assert.match(L.rirZone(2).msg, /مثالي/);
  assert.match(L.rirZone(3).msg, /زوّد عدّة دلوقتي أو وزن/);
  assert.match(L.rirZone(7).msg, /زوّد الوزن/);
  assert.equal(L.rirZone(null), null);
});

test('prescribe gates: readiness < 40 → −10%; avg RIR ≤ 1 → hold; BW drop → hold; load high → hold', () => {
  const last = ex([[80, 8, 2], [80, 8, 2], [80, 8, 2]]);
  assert.equal(L.prescribe(item, last).ready, true);
  const low = L.prescribe(item, last, { readiness: 30 });
  assert.equal(low.ready, false);
  assert.deepEqual(low.gates, ['readiness']);
  assert.equal(low.sets[0].w, 72.5); // 80×0.9=72 → 72.5
  const eff = L.prescribe(item, ex([[80, 8, 1], [80, 8, 1], [80, 8, 0]]));
  assert.equal(eff.ready, false); assert.deepEqual(eff.gates, ['effort']); assert.equal(eff.sets[0].w, 80);
  const bw = L.prescribe(item, last, { bwDrop: 2.5 });
  assert.equal(bw.ready, false); assert.deepEqual(bw.gates, ['bw']); assert.match(L.GATES.bw, /البروتين/);
  const ld = L.prescribe(item, last, { load: 'high' });
  assert.equal(ld.ready, false); assert.deepEqual(ld.gates, ['load']);
  assert.equal(L.prescribe(item, last, { readiness: 80 }).ready, true);
  assert.equal(L.bwDrop([{ day: '2026-10-01', kg: 82 }, { day: '2026-10-03', kg: 82 }, { day: '2026-10-05', kg: 82 }, { day: '2026-10-10', kg: 79.5 }]), 2.5);
  assert.equal(L.readinessOf({ wellness: { score: 35 } }), 35);
  assert.equal(L.readinessOf({ readiness: 2 }), 25);
  assert.equal(L.readinessOf(null), null);
});

test('intra-session fatigue: reps −30% first→last', () => {
  assert.deepEqual(L.intraFatigue([{ w: 80, r: 10, done: true }, { w: 80, r: 7, done: true }]), { type: 'reps', pct: 30 });
  assert.equal(L.intraFatigue([{ w: 80, r: 10, done: true }, { w: 80, r: 9, done: true }]), null);
  assert.equal(L.intraFatigue([{ w: 100, r: 5, done: true }, { w: 85, r: 5, done: true }]).type, 'weight');
});

test('warm-up ramp: 100 kg → 40/60/80% rounded; light lifts 50/75; volume unchanged', () => {
  assert.deepEqual(L.warmupSets(100).map((t) => [t.pct, t.w]), [[40, 40], [60, 60], [80, 80]]);
  assert.deepEqual(L.warmupSets(102.5).map((t) => t.w), [40, 62.5, 82.5]);
  assert.deepEqual(L.warmupSets(50).map((t) => t.w), [25, 37.5]);
  assert.deepEqual(L.warmupSets(15), []);
  const live = L.buildLive({ items: [{ ...item, w: 100 }], dayId: 'upperA', dayName: 'Upper A', sessions: [], now: new Date('2026-10-19T15:00:00Z') });
  assert.equal(live.exercises[0].warm.length, 3);
  live.exercises[0].warm.forEach((t) => { t.done = true; });
  assert.equal(L.liveVolume(live), 0);
  assert.ok(L.mobilityFor([item]).length >= 3);
  assert.ok(L.mobilityFor([{ muscle: 'رجل', kind: 'compound' }])[0].includes('Hip'));
});

test('supersets: A→B with no rest, rest after the round (90 s compound / 40 s isolation)', () => {
  const items = [
    { id: 'a', lib: 'ex1', ar: 'A', kind: 'compound', sets: 2, reps: '8', ss: 'A' },
    { id: 'b', lib: 'ex13', ar: 'B', kind: 'compound', sets: 2, reps: '8', ss: 'A' },
    { id: 'c', lib: 'ex23', ar: 'C', kind: 'isolation', sets: 2, reps: '12' },
  ];
  const live = L.buildLive({ items, dayId: 'x', dayName: 'X', sessions: [] });
  live.exercises[0].sets[0].done = true;
  assert.deepEqual(L.nextAfter(live, 0), { cur: { ex: 1, set: 0 }, rest: 'none' });
  live.exercises[1].sets[0].done = true;
  assert.deepEqual(L.nextAfter(live, 1), { cur: { ex: 0, set: 1 }, rest: 'superset' });
  assert.equal(L.groupRest(live, 1), 90);
  live.exercises[0].sets[1].done = true; live.exercises[1].sets[1].done = true;
  assert.deepEqual(L.nextAfter(live, 1), { cur: { ex: 2, set: 0 }, rest: 'superset' });
  assert.equal(L.restFor({ kind: 'isolation' }, { superset: true }), 40);
  assert.equal(L.restFor({ kind: 'compound', restS: 120 }), 120);
  assert.equal(L.nextSsTag([{ ss: 'A' }]), 'B');
  // no superset: normal rest
  assert.deepEqual(L.nextAfter(live, 2), { cur: { ex: 2, set: 0 }, rest: 'normal' });
});

test('swap: same muscle, preferred first, home filter; injury warning on OHP for كتف', () => {
  const ohp = { id: 'ubOHP', lib: 'ex21', ar: 'ضغط كتف بالبار', muscle: 'كتف', kind: 'compound' };
  const alts = L.swapCandidates(ohp);
  assert.ok(alts.length > 3 && alts.every((e) => e.id !== 'ex21'));
  assert.ok(alts.every((e) => e.muscle.startsWith('كتف')));
  const pref = L.swapCandidates(ohp, { memory: { [L.exKey(ohp)]: 'ex26' } });
  assert.equal(pref[0].id, 'ex26');
  assert.ok(L.swapCandidates(ohp, { home: true }).every((e) => ['وزن جسم', 'دمبل', 'أداة'].includes(e.eq)));
  const inj = [{ id: 'i1', muscle: 'كتف', severity: 2, active: true }, { id: 'i2', muscle: 'ركبة', active: false }];
  assert.equal(L.injuryFor(ohp, inj).id, 'i1');
  assert.equal(L.injuryFor({ lib: 'ex41', muscle: 'رجل' }, inj), null);
  assert.equal(L.injuryFor({ lib: 'ex41', muscle: 'رجل' }, [{ muscle: 'ركبة' }]).muscle, 'ركبة');
  // swapped exercise pulls its own history and keeps the set count
  const h = [ses('a', day(1), [{ exId: 'ex26', lib: 'ex26', name: 'أرنولد بريس', kind: 'compound', sets: [{ w: 20, r: 10, done: true }] }])];
  const it = { ...L.itemFromLib('ex26'), sets: 4 };
  const e = L.liveExercise(it, h);
  assert.equal(e.sets.length, 4); assert.equal(e.sets[0].w, 20); assert.equal(e.prev.length, 1);
});

test('drop sets never count for PR or top set', () => {
  const prior = { e1rm: 100, w: 85 };
  assert.equal(L.detectPR({ w: 90, r: 5, done: true, type: 'drop' }, prior), null);
  assert.ok(L.detectPR({ w: 90, r: 5, done: true }, prior));
  assert.equal(L.topWOf(ex([[80, 8], [95, 3, null, 'drop']])), 80);
});

test('tools: plates, load table, 1RM', () => {
  assert.deepEqual(L.platesFor(100, 20).perSide, [25, 15]);
  assert.deepEqual(L.platesFor(60, 20).perSide, [20]);
  assert.deepEqual(L.platesFor(62.5, 20).perSide, [20, 1.25]);
  assert.deepEqual(L.platesFor(15, 20).perSide, []);
  assert.equal(L.e1rm(100, 5), 116.7);
  assert.equal(L.loadTable(100)[0].w, 95);
  assert.equal(L.loadTable(100).length, 8);
  assert.equal(L.brzycki(100, 5), 112.5);
});

test('contract helpers: e1rmSeries, prList, progressRate, trainingLoad, laggingMuscle, strengthLevel, wilks', () => {
  const h = [100, 102.5, 105, 107.5, 110].map((w, i) => ses(`s${i}`, ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'][i], [ex([[w, 5]])]));
  const s = L.e1rmSeries(h, item);
  assert.equal(s.length, 5); assert.equal(s[0].day, '2026-09-01'); assert.equal(s[4].w, 110);
  const prs = L.prList(h);
  assert.equal(prs.length, 4); assert.equal(prs[0].day, '2026-09-08'); assert.equal(prs[0].type, 'weight');
  assert.equal(L.progressRate(h, item), 2.9); // 2.5 kg/week × 1.1667
  assert.equal(L.progressRate(h.slice(0, 1), item), null);
  const load = L.trainingLoad(h, '2026-09-30');
  assert.equal(load.level, 'normal'); assert.ok(load.ratio > 0.8 && load.ratio < 1.3);
  assert.equal(L.trainingLoad([], '2026-09-30').level, 'unknown');
  const lag = [ses('l', '2026-09-01', [ex([[100, 10], [100, 10]]), { name: 'x', lib: 'ex29', muscle: 'باي', sets: [{ w: 10, r: 10, done: true }] }])];
  assert.equal(L.laggingMuscle(lag), 'باي');
  const lv = L.strengthLevel(100, 80, 'bench');
  assert.equal(lv.ratio, 1.25); assert.equal(lv.level, 'متقدّم'); assert.equal(lv.next, 120);
  assert.equal(L.strengthLevel(0, 80, 'bench'), null);
  assert.ok(Math.abs(L.wilks(500, 80) - 340.6) < 1);
  assert.equal(L.liftOf({ lib: 'ex41' }), 'squat');
});

test('decision journal keeps newest 10 per exercise', () => {
  const rec = ses('n', '2026-10-01', [ex([[80, 8]])]);
  const j = L.journalAfter({}, rec, [rec]);
  const list = L.journalFor(j, rec.exercises[0]);
  assert.equal(list.length, 1); assert.equal(list[0].date, '2026-10-01'); assert.ok(list[0].msg);
});

test('recovery: 6 stations, same total as Solo Gym TOTAL (690 s), record ignored as lifting', () => {
  assert.equal(STATIONS.length, 6);
  assert.equal(L.RECOVERY_TOTAL, 690);
  assert.equal(L.RECOVERY_PHASES.length, 12);
  assert.ok(L.RECOVERY_PHASES[L.RECOVERY_PHASES.length - 1].breathe);
  const r = L.recoveryRecord({ now: new Date('2026-10-19T10:00:00Z') });
  assert.equal(r.kind, 'recovery');
  assert.equal(L.finished([r, { ...r, id: 'x', exercises: [] }]).length, 0);
  assert.equal(L.weeksOnPlan([r], { today: '2026-10-19' }).thisWeek, 0);
});

test('periodization wave and Full Body template', () => {
  assert.deepEqual(L.phaseOf('2026-10-01', '2026-10-01'), { week: 1, type: 'volume' });
  assert.equal(L.phaseOf('2026-10-01', '2026-10-23').type, 'deload');
  assert.equal(L.prescribe(item, ex([[80, 6]]), { phase: 'deload' }).sets[0].w, 72.5);
  assert.equal(PROGRAMS.fb3.order.length, 3);
  const p = L.fromTemplate('fb3');
  assert.equal(p.days.fbA.items[0].lib, 'ex41');
});

test('custom exercises join the library and picker search', () => {
  const n = LIBRARY.length;
  registerCustom([{ id: 'cx1', ar: 'ضغط سميث', en: 'Smith Press', muscle: 'صدر', kind: 'compound' }]);
  assert.equal(LIBRARY.length, n + 1);
  assert.equal(libById('cx1').ar, 'ضغط سميث');
  registerCustom([{ id: 'cx1', ar: 'dup' }]);
  assert.equal(LIBRARY.length, n + 1);
});

test('ported coaching content counts match the Solo Gym tables', () => {
  assert.equal(Object.keys(TIPS).length, 9);
  assert.equal(Object.keys(FORM_PHASES).length, 18);
  assert.equal(Object.keys(BREATHING_CUES).length, 6);
});

test('share text has exercises and PRs', () => {
  const r = ses('n', '2026-10-01', [ex([[80, 8]], { pr: { type: 'weight' } })], { dayName: 'Upper A', durationMin: 50 });
  const t = L.shareText(r);
  assert.match(t, /Upper A/); assert.match(t, /رقم شخصي/); assert.match(t, /80×8/);
});
