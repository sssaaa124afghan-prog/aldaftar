// Owner-approved 4-day plan + coaching rules (review.md §2–3, hypertrophy.md §3–5, product-ideas 1–5, 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';
import { PROGRAMS, MUSCLE_LM, LIBRARY, libById, fineOf, NEW_PROGRAM, DEFAULT_PROGRAM } from './exercises.js';

const ses = (id, day, exercises, extra = {}) => ({ id, day, startedAt: `${day}T18:00:00+04:00`, status: 'done', exercises, ...extra });
const ex = (lib, sets, extra = {}) => { const Lb = libById(lib); return { exId: extra.exId || lib, lib, name: Lb.ar, en: Lb.en, muscle: Lb.muscle, kind: Lb.kind, sets: sets.map(([w, r, rir = null]) => ({ w, r, rir, done: true })), ...extra }; };
const P = () => L.fromTemplate(NEW_PROGRAM);

test('new default program: compact Upper/Lower from review.md §3 with supersets, rests, fills and schedule', () => {
  assert.equal(DEFAULT_PROGRAM, 'ul4c');
  const p = P();
  assert.deepEqual(p.order, ['upperA', 'lowerA', 'upperB', 'lowerB']);
  // plan v3: Sat UA · Sun LA · Tue UB · Wed LB · Thu Boxing Day (replaces the Saturday Heart Day)
  assert.deepEqual(p.schedule, { 6: 'upperA', 0: 'lowerA', 2: 'upperB', 3: 'lowerB' });
  assert.equal(PROGRAMS.ul4c.heartDow, 4);
  assert.deepEqual(L.programFlags(p), { z2: true, meso: true, heartDow: 4, cardio: 'boxing', boxing: true });
  const row = (d) => p.days[d].items.map((x) => `${x.lib}:${x.sets}x${x.reps}${x.ss ? ':' + x.ss : ''}${x.restS ? '@' + x.restS : ''}${x.fill ? 'f' : ''}`);
  assert.deepEqual(row('upperA'), ['ex1:4x5-8:A@110', 'ex14:4x6-10:A@110', 'ex2:3x8-12:B@90', 'exCSTB:3x8-12:B@90', 'ex27:3x12-20:C@45', 'exOCT:3x10-15:C@45',
    'ex31:3x10-15:D@60', 'exRPD:3x12-20:D@60', 'ex64:3x8-15:D@60']);
  assert.deepEqual(row('lowerA'), ['ex41:4x5-8:A@110', 'ex23:4x12-20:A@110', 'ex48:4x8-12:B@60', 'ex44:4x10-15:B@60', 'exMHT:3x8-12:C@75', 'ex65:3x10-15:C@75',
    'ex51:5x8-15:D@60', 'ex81:3x15-20:D@60f', 'exRWC:2x15-20:D@60f']);
  assert.deepEqual(row('upperB'), ['exLID:4x6-10:A@90', 'ex14:4x8-12:A@90', 'ex22:3x8-12:B@75', 'ex15:3x8-12:B@75', 'ex27:3x12-20:C@45', 'ex24:3x12-20:C@45',
    'exWCH:3x10-12/جنب:C@45', 'ex32:3x10-15:D@45', 'exROE:3x10-15:D@45']);
  assert.deepEqual(row('lowerB'), ['ex47:3x6-10:A@120', 'ex27:3x12-20:A@120', 'ex45b:3x8-12:B@90', 'ex48:3x10-15:B@90', 'ex42:3x8-12/رجل:C@75', 'ex62:3x10-15:C@75',
    'ex51:5x10-20:D@60', 'exADD:3x12-20:D@60f', 'ex72:2x10-15:D@60f']);
  // Arabic + English names come from the library; legacy ids kept where the exercise is the same
  assert.equal(p.days.upperA.items[0].id, 'uaFB');
  assert.equal(p.days.upperA.items[0].ar, 'بنش بريس بالبار');
  assert.equal(p.days.upperB.items[7].en, 'Preacher Curl');
  // plan v2 swaps (exercise-selection.md §3): new item ids so history does not mix; notes + meso-1 reps survive a round trip
  assert.equal(p.tv, 3);
  assert.deepEqual(['upperA', 'lowerA', 'upperB', 'lowerB'].map((d) => p.days[d].items.filter((x) => ['uaLPD', 'lbSC', 'lbSLC', 'ubPRC', 'ubOCT', 'ubLID'].includes(x.id)).map((x) => x.id)),
    [['uaLPD'], [], ['ubLID', 'ubPRC', 'ubOCT'], ['lbSLC', 'lbSC']]);
  assert.match(p.days.upperA.items[1].note, /3×8 عقلة بوزن جسمك عند RIR 2 ارجع للعقلة/);
  assert.equal(p.days.upperA.items[0].r1, '6-10'); assert.equal(p.days.lowerA.items[0].r1, '6-10');
  assert.match(p.days.lowerB.items[6].note, /وقفة 2 ث/);
  assert.match(p.days.upperB.items[8].note, /pushdown/);
  assert.equal(p.days.upperB.items[0].en, 'Low-Incline DB Press 15°');
  // seated leg curl pairs with the hack squat on Lower B: two different machines (the combo leg-curl/extension clash is only Lower A)
  assert.deepEqual(p.days.lowerB.items.filter((x) => x.ss === 'B').map((x) => x.lib), ['ex45b', 'ex48']);
  // 4:30 warm-up ramps per day
  assert.deepEqual(p.days.lowerA.warm, [[0, 8], [50, 5], [70, 3], [85, 1]]);
  // survives a save/load round trip
  const back = L.normalizeProgram({ ...p, v: 2 });
  assert.equal(back.days.lowerA.items[7].fill, true);
  assert.equal(back.days.upperA.items[0].rir, '1-2');
  assert.deepEqual(back.days.upperA.warm, [[0, 8], [60, 5], [80, 2]]);
  assert.deepEqual(back.schedule, p.schedule);
  assert.equal(back.tv, 3); assert.equal(back.days.upperA.items[0].r1, '6-10'); assert.equal(back.days.upperA.items[1].note, p.days.upperA.items[1].note);
});

test('new library entries carry muscles and synergists', () => {
  for (const id of ['exBAY', 'exADD', 'exWCH', 'exPAL', 'exRWC', 'exNECK', 'exMHT', 'exLID', 'exROE']) assert.ok(libById(id), id);
  assert.equal(libById('exLID').prime, 'صدر'); assert.equal(libById('exROE').prime, 'تراي');
  assert.equal(libById('exADD').prime, 'ضامة');
  assert.equal(libById('exWCH').prime, 'جوانب');
  assert.deepEqual(libById('ex1').synergists, ['تراي', 'كتف أمامي']);
  assert.deepEqual(libById('ex41').synergists, ['مؤخرة', 'ضامة']);
  assert.equal(new Set(LIBRARY.map((x) => x.id)).size, LIBRARY.length);
  // custom / legacy exercises fall back to the coarse muscle
  assert.equal(fineOf({ name: 'x', muscle: 'كتف', kind: 'compound' }).prime, 'كتف أمامي');
  assert.equal(fineOf({ name: 'x', muscle: 'رجل خلفي' }).prime, 'هامسترينج');
});

test('per-muscle landmarks from hypertrophy.md §3', () => {
  for (const m of ['كوادز', 'هامسترينج', 'مؤخرة', 'سمانة', 'ضامة', 'صدر', 'لات', 'ظهر علوي', 'كتف أمامي', 'كتف جانبي', 'كتف خلفي', 'باي', 'تراي', 'ساعد', 'بطن', 'جوانب']) assert.ok(MUSCLE_LM[m], m);
  assert.deepEqual(MUSCLE_LM['كتف جانبي'], { mev: 8, mavLo: 14, mav: 20, mrv: 26 });
  assert.deepEqual(MUSCLE_LM['صدر'], { mev: 8, mavLo: 12, mav: 18, mrv: 22 });
  assert.deepEqual(MUSCLE_LM['ضامة'], { mev: 0, mavLo: 6, mav: 10, mrv: 16 });
});

test('hard sets: RIR ≤ 3 counts, synergists get 0.5, group view never double-counts within a group', () => {
  assert.equal(L.RIR_HARD_MAX, 3);
  const hist = [ses('a', '2026-10-19', [ex('ex1', [[80, 8, 2], [80, 8, 3], [80, 8, 4]]), ex('ex15', [[60, 10, 2], [60, 10]])])];
  const m = L.hardSetsByMuscle(hist, '2026-10-19', '2026-10-25', { by: 'muscle' });
  assert.equal(m['صدر'], 2); // RIR 4 is not hard
  assert.equal(m['تراي'], 1);
  assert.equal(m['كتف أمامي'], 1);
  assert.equal(m['ظهر علوي'], 2);
  assert.equal(m['لات'], 1);
  assert.equal(m['باي'], 1);
  assert.equal(m['كتف خلفي'], 1);
  const g = L.hardSetsByMuscle(hist, '2026-10-19', '2026-10-25');
  assert.equal(g['صدر'], 2);
  assert.equal(g['ظهر'], 2); // row: upper back 1 + lats in the same group → no extra
  assert.equal(g['تراي'], 1);
  assert.equal(g['أكتاف'], 2); // bench front delt 0.5 × 2 + row rear delt 0.5 × 2
  assert.equal(g['باي'], 1);
  // the compact plan's weekly projection lands in the review's ranges
  const p = P();
  const all = {};
  for (const d of p.order) for (const [k, v] of Object.entries(L.plannedByMuscle(p.days[d].items))) all[k] = (all[k] || 0) + v;
  assert.equal(all['كتف جانبي'], 14.5);
  assert.equal(all['كوادز'], 14);
  assert.equal(all['هامسترينج'], 10);
  assert.equal(all['سمانة'], 10);
  for (const [k, lm] of Object.entries(MUSCLE_LM)) assert.ok((all[k] || 0) >= lm.mev && (all[k] || 0) <= lm.mrv, `${k} ${all[k]}`);
});

test('estimateMinutes models supersets, tri-sets, fills, transitions and the 4:30 warm-up', () => {
  const p = P();
  const near = (d, target) => { const m = L.estimateSeconds(p.days[d].items) / 60; assert.ok(Math.abs(m - target) <= 1.25, `${d} ${m.toFixed(2)} vs ${target}`); };
  near('upperA', 48.08); near('lowerA', 47.58); near('upperB', 47.17); near('lowerB', 46);
  // the same items as straight sets take longer than as supersets
  const straight = p.days.upperA.items.map(({ ss, fill, ...x }) => x);
  assert.ok(L.estimateMinutes(straight) > L.estimateMinutes(p.days.upperA.items) + 10);
  assert.equal(L.estimateSeconds([{ kind: 'isolation', sets: 3, reps: '12', restS: 60 }], { warmup: false }), 3 * 45 + 2 * 60 + 30);
  assert.ok(L.estimateMinutes([{ kind: 'compound', sets: 4 }, { kind: 'isolation', sets: 3 }]) > 0);
});

test('round rest is the largest restS in the group; fills rotate one at a time inside the anchor rest', () => {
  const p = P();
  const live = L.buildLive({ items: p.days.lowerA.items, dayId: 'lowerA', dayName: 'Lower A', sessions: [] });
  assert.equal(L.groupRest(live, 0), 110);
  live.exercises[0].restS = 90; // a per-exercise override on one member: the larger wins
  assert.equal(L.groupRest(live, 0), 110);
  // calf (6) ↔ wrist curl (7, sets 1-3) then reverse wrist curl (8, sets 4-5)
  for (let k = 0; k < 6; k++) live.exercises[k].sets.forEach((t) => { t.done = true; });
  const seq = [];
  let cur = { ex: 6, set: 0 };
  for (let n = 0; n < 10 && cur; n++) {
    seq.push(`${cur.ex}.${cur.set}`);
    live.exercises[cur.ex].sets[cur.set].done = true;
    live.exercises[cur.ex].sets[cur.set].at = 1000 + n;
    const nx = L.nextAfter(live, cur.ex);
    cur = nx.cur;
  }
  assert.deepEqual(seq, ['6.0', '7.0', '6.1', '7.1', '6.2', '7.2', '6.3', '8.0', '6.4', '8.1']);
  // fill rest: what is left of the 60 s since the calf set (min 10 s)
  const l2 = L.buildLive({ items: p.days.lowerA.items, dayId: 'lowerA', dayName: 'x', sessions: [] });
  l2.exercises[6].sets[0].done = true; l2.exercises[6].sets[0].at = 100_000;
  l2.exercises[7].sets[0].done = true;
  assert.equal(L.fillRest(l2, 7, 100_000 + 30_000), 30);
  assert.equal(L.fillRest(l2, 7, 100_000 + 90_000), 10);
  assert.equal(L.fillRest(l2, 6, 0), 60);
});

test('tri-set: lateral → face pull → woodchop, then the round rest', () => {
  const p = P();
  const live = L.buildLive({ items: p.days.upperB.items, dayId: 'upperB', dayName: 'x', sessions: [] });
  live.exercises[4].sets[0].done = true;
  assert.deepEqual(L.nextAfter(live, 4), { cur: { ex: 5, set: 0 }, rest: 'none' });
  live.exercises[5].sets[0].done = true;
  assert.deepEqual(L.nextAfter(live, 5), { cur: { ex: 6, set: 0 }, rest: 'none' });
  live.exercises[6].sets[0].done = true;
  assert.deepEqual(L.nextAfter(live, 6), { cur: { ex: 4, set: 1 }, rest: 'superset' });
  assert.equal(L.groupRest(live, 6), 45);
});

test('equipment-based load steps and reps-first for small isolations', () => {
  const it = (lib, reps = '8-12') => ({ lib, reps, kind: libById(lib).kind });
  assert.equal(L.loadStep(it('ex1', '5-8'), 80).inc, 2.5); // barbell upper
  assert.equal(L.loadStep(it('ex41', '5-8'), 105, { bw: 80 }).inc, 2.5); // squat > 1.25 × BW
  assert.equal(L.loadStep(it('ex41', '5-8'), 90, { bw: 80 }).inc, 5); // barbell lower
  assert.equal(L.loadStep(it('ex47', '6-10'), 60).inc, 5);
  assert.equal(L.loadStep(it('exFDP', '6-10'), 30).inc, 2); // next DB pair
  assert.equal(L.loadStep(it('exFDP', '6-10'), 8).inc, 1);
  assert.equal(L.loadStep(it('ex14'), 60).inc, 5); // next pin
  assert.equal(L.loadStep(it('ex14'), 40).inc, 2.5);
  const pin = L.loadStep(it('ex44', '10-15'), 20); // 2.5 on 20 = 12.5 % → reps first to top + 3
  assert.equal(pin.repsFirst, true); assert.equal(pin.repCap, 18);
  const lat = L.loadStep(it('ex27', '12-20'), 10);
  assert.equal(lat.repsFirst, false); // range already ends at 20
  const curl = L.loadStep(it('ex31', '10-15'), 12);
  assert.equal(curl.repsFirst, true); assert.equal(curl.repCap, 20);
  // prescribe: an incline curl at the top of 10-15 adds a rep (to 20) before load
  const pr = L.prescribe({ id: 'c', lib: 'ex31', sets: 2, reps: '10-15' }, ex('ex31', [[12, 15, 2], [12, 15, 2]]));
  assert.equal(pr.mode, 'reps');
  assert.deepEqual(pr.sets, [{ w: 12, r: 16 }, { w: 12, r: 16 }]);
  const pr2 = L.prescribe({ id: 'c', lib: 'ex31', sets: 2, reps: '10-15' }, ex('ex31', [[12, 20, 2], [12, 20, 2]]));
  assert.equal(pr2.ready, true); assert.equal(pr2.inc, 2); assert.deepEqual(pr2.sets[0], { w: 14, r: 10 });
  const bench = L.prescribe({ id: 'b', lib: 'ex1', sets: 2, reps: '5-8' }, ex('ex1', [[80, 8, 2], [80, 8, 2]]));
  assert.equal(bench.inc, 2.5);
  const sq = L.prescribe({ id: 's', lib: 'ex41', sets: 2, reps: '5-8' }, ex('ex41', [[80, 8, 2], [80, 8, 2]]), { bw: 80 });
  assert.equal(sq.inc, 5); assert.equal(sq.sets[0].w, 85);
});

test('mesocycle: week from the plan start, RIR targets by type (M7), week 6 deload', () => {
  assert.equal(L.mesoWeek('2026-10-19', '2026-10-19'), 1);
  assert.equal(L.mesoWeek('2026-10-19', '2026-11-18'), 5);
  assert.equal(L.mesoWeek('2026-10-19', '2026-11-23'), 6);
  assert.equal(L.mesoWeek('2026-10-19', '2026-11-30'), 1); // next block
  assert.equal(L.mesoWeek('2026-10-19', '2026-10-18'), null);
  const bench = { lib: 'ex1', kind: 'compound', sets: 4 }, hack = { lib: 'ex45b', kind: 'compound', sets: 3 }, lat = { lib: 'ex27', kind: 'isolation', sets: 3 };
  assert.deepEqual([1, 2, 3, 4].map((w) => L.rirTarget(bench, w)), [{ lo: 3, hi: 3 }, { lo: 2, hi: 2 }, { lo: 2, hi: 2 }, { lo: 1, hi: 2 }]);
  assert.deepEqual(L.rirTarget(bench, 5), { lo: 1, hi: 2 }); // free weight: never 0
  assert.deepEqual(L.rirTarget(hack, 5), { lo: 1, hi: 1 }); // machine
  assert.deepEqual(L.rirTarget(lat, 5, 0, 3), { lo: 1, hi: 1 });
  assert.deepEqual(L.rirTarget(lat, 5, 2, 3), { lo: 0, hi: 0 }); // only the last isolation set to failure
  assert.deepEqual([1, 2, 4].map((w) => L.rirTarget(lat, w)), [{ lo: 2, hi: 2 }, { lo: 1, hi: 1 }, { lo: 0, hi: 1 }]);
  assert.equal(L.rirTarget(bench, 6).deload, true);
  assert.equal(L.rirPhrase(L.rirTarget(bench, 2)), 'سيب 2 عدّات');
  assert.equal(L.rirPhrase(L.rirTarget(bench, 4)), 'سيب 1–2 عدّات');
  assert.equal(L.rirPhrase(L.rirTarget(lat, 2)), 'سيب 1 عدّة');
  assert.equal(L.rirPhrase(L.rirTarget(lat, 5, 2, 3)), 'المجموعة دي للفشل');
  // live exercises carry their target; a week-3 RIR 2 set still counts as "ready" for an isolation target of 1
  const live = L.buildLive({ items: P().days.upperA.items, dayId: 'upperA', dayName: 'x', sessions: [], week: 5 });
  assert.equal(live.week, 5);
  assert.deepEqual(live.exercises[0].rirT, { lo: 1, hi: 2 });
  // effort gate with a target: RIR 0–1 on a week-4 isolation (target 0–1) does not hold the load
  const g = L.prescribe({ lib: 'exRPD', sets: 2, reps: '12-20', kind: 'isolation' }, ex('exRPD', [[30, 20, 0], [30, 20, 1]]), { rirTarget: { lo: 0, hi: 1 } });
  assert.equal(g.gates.includes('effort'), false);
  assert.equal(L.prescribe({ lib: 'exRPD', sets: 2, reps: '12-20', kind: 'isolation' }, ex('exRPD', [[30, 20, 0], [30, 20, 0]]), { rirTarget: { lo: 1, hi: 1 } }).gates.includes('effort'), true);
});

test('stall rule: 2 sessions → check recovery; 3 → variant next block', () => {
  const item = { id: 'uaFB', lib: 'ex1', kind: 'compound' };
  const s = (id, day, w, r) => ses(id, day, [ex('ex1', [[w, r], [w, r]], { exId: 'uaFB' })]);
  assert.equal(L.stallInfo([s('1', '2026-09-01', 80, 8), s('2', '2026-09-04', 80, 9)], item).action, null);
  const two = [s('1', '2026-09-01', 80, 8), s('2', '2026-09-04', 80, 8), s('3', '2026-09-08', 80, 7)];
  assert.deepEqual(L.stallInfo(two, item), { stalls: 2, action: 'recovery', variant: null });
  const three = [...two, s('4', '2026-09-11', 80, 7)];
  const st = L.stallInfo(three, item);
  assert.equal(st.action, 'variant');
  assert.equal(st.variant.id, 'ex2');
  assert.match(L.stallText(st), /ضغط دمبل مائل/);
  // a load increase breaks the stall
  assert.equal(L.stallInfo([...three, s('5', '2026-09-15', 82.5, 6)], item).action, null);
});

test('weekly balance: under-MEV muscle gets +1–2 sets on its next session, never in deload or above MRV; carry comes back', () => {
  const p = P();
  const items = p.days.upperA.items;
  const proj = Object.fromEntries(Object.keys(MUSCLE_LM).map((m) => [m, 12]));
  proj['كتف خلفي'] = 4.5; // MEV 6
  const r = L.balanceAdds({ items, projection: proj });
  const rpd = r.items.find((x) => x.lib === 'exRPD');
  assert.equal(rpd.sets, 5); // +2 (ceil(6 − 4.5) = 2)
  assert.match(rpd.planNote, /كتف خلفي متأخر/);
  assert.equal(r.changes[0].code, 'balance');
  assert.equal(L.balanceAdds({ items, projection: proj, deload: true }).changes.length, 0);
  // MRV cap
  const hi = { ...proj, 'كتف خلفي': 4, 'تراي': 19.5 };
  const capped = L.balanceAdds({ items, projection: { ...hi, 'كتف خلفي': 21.5 }, carry: { 'كتف خلفي': { n: 2, day: '2026-10-19' } } });
  assert.equal(capped.items.find((x) => x.lib === 'exRPD').sets, 3 + 2); // carry 2, projection 21.5 − 2 + 2 ≤ 22
  assert.deepEqual(capped.consumed, { 'كتف خلفي': 2 });
  // projection reads finished sessions + remaining scheduled days
  const wp = L.weekProjection({ program: p, sessions: [], today: '2026-10-19', items: p.days.upperA.items, todayId: 'upperA' });
  assert.equal(wp.projection['كتف جانبي'], 14.5);
  assert.deepEqual(L.remainingDays(p, [], '2026-10-20'), ['lowerB', 'upperA', 'lowerA']); // Tue → Wed, Sat, Sun (week from Monday)
  assert.deepEqual(L.remainingDays(p, [ses('x', '2026-10-20', [], { dayKey: 'upperA' }), ses('y', '2026-10-21', [], { dayKey: 'lowerA' })], '2026-10-22'), []); // Sat/Sun already done this week
});

test('autopilot: 60 fits as planned; 45 trims rest first; 30 cuts sets then isolations; MEV protected by carry-over', () => {
  const p = P();
  const day = p.days.upperA.items;
  const proj = L.weekProjection({ program: p, sessions: [], today: '2026-10-19', items: day, todayId: 'upperA' }).projection;
  const a60 = L.autopilot({ items: day, budgetMin: 60, projection: proj });
  assert.equal(a60.changes.length, 0); assert.equal(a60.fits, true);
  const a45 = L.autopilot({ items: day, budgetMin: 45, projection: proj });
  assert.equal(a45.fits, true);
  assert.equal(a45.changes[0].code, 'rest');
  assert.ok(a45.items.find((x) => x.lib === 'ex1').restS >= 90); // heavy pair never below 90 s
  assert.ok(a45.minutes <= 45);
  const a30 = L.autopilot({ items: day, budgetMin: 30, projection: proj });
  assert.equal(a30.fits, true);
  const codes = a30.changes.map((c) => c.code);
  assert.ok(codes.indexOf('rest') < codes.indexOf('set') && codes.indexOf('set') < codes.indexOf('drop'), codes.join());
  assert.ok(a30.items.filter((x) => L.kindOf(x) === 'compound').length === 4); // compounds untouched
  assert.ok(a30.items.every((x) => L.kindOf(x) === 'compound' || x.sets >= 2));
  // a muscle near MEV that loses its isolation is carried to its next session
  const tight = { ...proj, 'كتف خلفي': 6.5 };
  const c = L.autopilot({ items: day, budgetMin: 30, projection: tight });
  assert.ok(c.carry['كتف خلفي'] >= 1, JSON.stringify(c.carry));
  assert.ok(c.changes.some((k) => k.code === 'carried'));
  // the plan glue: carry ledger merges and old entries expire
  const plan = L.planSession({ program: p, sessions: [], today: '2026-10-19', dayId: 'upperA', budgetMin: 45 });
  assert.ok(plan.minutes <= 45 && plan.baseMinutes >= 47);
  assert.deepEqual(L.mergeCarry({ 'باي': { n: 2, day: '2026-10-01' }, 'تراي': { n: 3, day: '2026-10-18' } }, { 'صدر': 1 }, { 'تراي': 1 }, '2026-10-19'),
    { 'تراي': { n: 2, day: '2026-10-18' }, 'صدر': { n: 1, day: '2026-10-19' } });
  const dl = L.planSession({ program: p, sessions: [], today: '2026-10-19', dayId: 'upperA', budgetMin: 30, deload: true });
  assert.equal(dl.changes.length, 0);
});

test('Zone 2 after lifting: min(12, 59 − liftEnd − 1), floor 8', () => {
  assert.equal(L.z2Minutes(46), 12);
  assert.equal(L.z2Minutes(48), 10);
  assert.equal(L.z2Minutes(48.2), 9);
  assert.equal(L.z2Minutes(55), 8);
  assert.equal(L.z2Minutes(30), 12);
  assert.equal(L.z2Minutes(30, { deload: true }), 15);
});

test('«كله زي الخطة» logs every open set with its prefill; warm-up ramps follow the day plan', () => {
  const sets = [{ w: 50, r: 10, done: true }, { w: 50, r: 10, done: false }, { w: 52.5, r: 8, done: false }, { w: 0, r: 0, done: false }];
  assert.deepEqual(L.logRemaining(sets, 1000), [1, 2]);
  assert.ok(sets[1].done && sets[2].done && sets[2].w === 52.5 && sets[2].asPlanned && !sets[3].done);
  assert.deepEqual(L.warmupSets(100, 20, [[0, 8], [60, 5], [80, 2]]).map((t) => `${t.w}x${t.r}`), ['20x8', '60x5', '80x2']);
  assert.deepEqual(L.warmupSets(30, 0, [[50, 8], [75, 4]], 2).map((t) => `${t.w}x${t.r}`), ['16x8', '22x4']);
  assert.deepEqual(L.warmupSets(100).map((t) => t.pct), [40, 60, 80]); // default unchanged
});

test('core moves keep their own RIR 1–2 floor: never to failure, not even in week 5 (QA r3 F3)', () => {
  const p = P();
  const all = Object.values(p.days).flatMap((d) => d.items);
  const core = ['uaAW', 'la6a', 'lb7a', 'ubWC'].map((id) => all.find((it) => it.id === id));
  assert.deepEqual(core.map((it) => it.lib), ['ex64', 'ex65', 'ex62', 'exWCH']);
  for (const it of core) {
    assert.equal(it.rir, '1-2');
    for (let w = 1; w <= 5; w++) {
      for (const t of [L.rirTarget(it, w), ...Array.from({ length: it.sets }, (_, j) => L.rirTarget(it, w, j, it.sets))]) {
        assert.ok(t.lo >= 1, `${it.id} week ${w} → ${JSON.stringify(t)}`);
        assert.ok(!t.lastToFailure);
      }
    }
    assert.deepEqual(L.rirTarget(it, 5, it.sets - 1, it.sets), { lo: 1, hi: 2 });
    assert.equal(L.rirTarget(it, 6).deload, true);
  }
  // plain isolations (template RIR 0-1) still take the last week-5 set to failure; the live exercise carries the floor
  const lat = all.find((it) => it.id === 'ua5a');
  assert.deepEqual(L.rirTarget(lat, 5, lat.sets - 1, lat.sets), { lo: 0, hi: 0 });
  const live = L.buildLive({ items: p.days.upperA.items, dayId: 'upperA', dayName: 'x', sessions: [], week: 5 });
  const aw = live.exercises.find((e) => e.exId === 'uaAW');
  assert.equal(aw.rir, '1-2');
  assert.deepEqual(L.rirTarget(aw, 5, 2, 3), { lo: 1, hi: 2 });
  assert.equal(L.rirPhrase(L.rirTarget(aw, 5, 2, 3)), 'سيب 1–2 عدّات');
});

test('dayEstimate is the one time source: planSession minutes + the Zone 2 finisher (Today = overview)', () => {
  const p = { ...P(), startDay: '2026-10-19' };
  const e = L.dayEstimate({ program: p, sessions: [], today: '2026-10-19', dayId: 'upperA', training: {} });
  const r = L.planSession({ program: p, sessions: [], today: '2026-10-19', dayId: 'upperA', budgetMin: 60 });
  assert.equal(e.lift, r.minutes);
  assert.equal(e.z2, L.z2Minutes(r.minutes));
  assert.equal(e.total, e.lift + e.z2);
  L.pickBudget('2026-10-19', 45);
  assert.ok(L.dayEstimate({ program: p, today: '2026-10-19', dayId: 'upperA' }).lift <= 45);
  assert.equal(L.budgetFor('2026-10-20'), 60);
  L.pickBudget(null, 60);
});

// ══ plan v2: swaps migration, meso-1 reps, re-entry (exercise-selection.md, growth-assessment.md §0.4) ══
const V1 = () => {
  // a user saved on ul4c before v2: no tv, the old rows
  const p = P(); delete p.tv;
  const old = { upperA: [['ub1', 'exWPU', 1]], upperB: [['ub3', 'exFDP', 0], ['ubBAY', 'exBAY', 7], ['ub6b', 'ex36', 8]], lowerB: [['la4', 'ex45', 3], ['lb5a', 'ex52', 6]] };
  for (const [d, rows] of Object.entries(old)) for (const [id, lib, i] of rows) { const Lb = libById(lib); p.days[d].items[i] = { ...p.days[d].items[i], id, lib, ar: Lb.ar, en: Lb.en }; delete p.days[d].items[i].note; }
  for (const d of ['upperA', 'lowerA']) delete p.days[d].items[0].r1;
  return L.normalizeProgram({ ...p, v: 2 });
};

test('plan update: users already on ul4c get a diff card; apply swaps in place, keeps edits, sets tv; new installs have none', () => {
  assert.equal(L.planUpdate(P()), null, 'fresh template is current');
  const v1 = V1();
  const u = L.planUpdate(v1);
  assert.equal(u.from, 1); assert.equal(u.to, 3);
  assert.equal(u.applicable, 8); // the v1 user moved his own schedule here (V1 keeps the template's v3 days) → only the 8 swaps apply
  assert.ok(u.changes.some((c) => /سمانة جالس ← سمانة واقف/.test(c.text)), u.changes.map((c) => c.text).join('\n'));
  // the user removed the Bayesian curl himself → that change is skipped, the rest apply
  v1.days.upperB.items = v1.days.upperB.items.filter((x) => x.id !== 'ubBAY');
  v1.days.lowerB.items.find((x) => x.id === 'la4').sets = 4; // his own edit on a swapped slot is replaced by the template row
  const r = L.applyPlanUpdate(v1);
  assert.equal(r.skipped.length, 2); assert.equal(r.applied.length, 7); // Bayesian removed by him + his own (non-old) schedule kept
  assert.deepEqual(r.skipped.map((c) => c.kind).sort(), ['schedule', 'swap']);
  assert.equal(r.program.tv, 3);
  assert.equal(L.planUpdate(r.program), null);
  const row = (d) => r.program.days[d].items.map((x) => x.id);
  assert.deepEqual(row('lowerB'), ['la2', 'lbLR', 'lbHACK', 'lbSLC', 'lb2', 'lb7a', 'lbSC', 'lbADD', 'lbSH']);
  assert.deepEqual(row('upperB').slice(0, 1), ['ubLID']);
  assert.ok(row('upperB').includes('ubOCT') && !row('upperB').includes('ubPRC'));
  assert.equal(r.program.days.upperA.items[1].lib, 'ex14');
  assert.equal(r.program.days.upperA.items[1].ss, 'A');
  assert.equal(r.program.days.upperA.items[0].r1, '6-10');
  assert.match(r.program.days.upperA.warmNote, /سحب أمامي/);
  // the original is untouched (undo = save it back)
  assert.equal(v1.days.lowerB.items[6].id, 'lb5a');
  // other templates: nothing to update
  assert.equal(L.planUpdate(L.fromTemplate('ppl6')), null);
});

test('meso 1 (and re-entry): back squat + bench run 6–10; from block 2 the template 5–8; days stay ≤ 60 min', () => {
  const p = { ...P(), startDay: '2026-10-19' };
  const e1 = L.dayEstimate({ program: p, sessions: [], today: '2026-10-19', dayId: 'upperA' });
  assert.equal(e1.block, 1);
  assert.equal(e1.plan.items[0].reps, '6-10');
  const e2 = L.dayEstimate({ program: p, sessions: [], today: '2026-12-07', dayId: 'upperA' });
  assert.equal(e2.block, 2);
  assert.equal(e2.plan.items[0].reps, '5-8');
  assert.equal(L.mesoBlock('2026-10-19', '2026-11-29'), 1); assert.equal(L.mesoBlock('2026-10-19', '2026-11-30'), 2);
  for (const d of p.order) {
    const m = L.estimateSeconds(L.withBlockReps(p, d).days[d].items) / 60;
    assert.ok(m <= 49.5, `${d} ${m.toFixed(1)} min`);
    assert.ok(Math.round(m) + L.z2Minutes(Math.round(m)) <= 60, `${d} lift + Z2 ${m}`);
  }
});

test('re-entry: info, sets ~55% / ~75%, RIR 4/3 then 3/2, loads 80% / 90%, header, then the 6-week block starts', () => {
  const st = { get: (k) => (k === 'wk.reentry' ? { startDay: '2026-10-19', weeks: 2 } : undefined) };
  assert.equal(L.reentryInfo(st, '2026-10-18').active, false);
  const w1 = L.reentryInfo(st, '2026-10-19');
  assert.deepEqual({ a: w1.active, w: w1.week, of: w1.of, end: w1.endDay }, { a: true, w: 1, of: 2, end: '2026-11-02' });
  assert.equal(L.reentryInfo(st, '2026-10-26').week, 2);
  assert.equal(L.reentryInfo(st, '2026-11-02').active, false);
  assert.equal(L.reentryInfo({}, '2026-10-19'), null);
  assert.equal(L.reentryInfo({ 'wk.reentry': { startDay: 'bad' } }, '2026-10-19'), null);
  assert.equal(L.isReentry({ settings: st }, '2026-10-20'), true);
  assert.equal(L.isReentry(st, '2026-11-02'), false);
  // sets: round(n × share), min 1, last sets dropped
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => L.reentrySets(n, w1)), [1, 1, 2, 2, 3]);
  const w2 = L.reentryInfo(st, '2026-10-28');
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => L.reentrySets(n, w2)), [1, 2, 2, 3, 4]);
  const pres = { sets: [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 77.5, r: 8 }, { w: 75, r: 7 }], ready: true, inc: 2.5, from: 'last', gates: [], hold: false };
  const a = L.reentryAdjust(pres, w1, { item: { kind: 'compound' } });
  assert.deepEqual(a.sets, [{ w: 65, r: 8 }, { w: 65, r: 8 }]);
  assert.equal(a.ready, false); assert.equal(a.inc, 0); assert.equal(a.gates[0], 'reentry');
  assert.deepEqual(a.rirT, { lo: 4, hi: 4, reentry: true });
  const b = L.reentryAdjust(pres, w2, { item: { kind: 'isolation' } });
  assert.deepEqual(b.sets.map((t) => t.w), [72.5, 72.5, 70]);
  assert.deepEqual(b.rirT, { lo: 2, hi: 2, reentry: true });
  assert.equal(L.reentryAdjust({ sets: [{ w: 12, r: 12 }, { w: 0, r: 10 }] }, w1).sets.map((t) => t.w).join(), '10');
  assert.deepEqual(L.reentryRir({ kind: 'isolation' }, w1), { lo: 3, hi: 3, reentry: true });
  assert.deepEqual(L.reentryRir({ kind: 'compound' }, w2), { lo: 3, hi: 3, reentry: true });
  assert.equal(L.reentryHeader(w1, { kind: 'compound' }), 'رجوع · الأسبوع 1 من 2 · سيب 4 عدّات');
  assert.equal(L.reentryHeader(w2, { kind: 'isolation' }), 'رجوع · الأسبوع 2 من 2 · سيب 2 عدّات');
  // day estimate: no meso week during re-entry, sets cut, shorter session, a reason line
  const p = { ...P(), startDay: '2026-10-19' };
  const e = L.dayEstimate({ program: p, sessions: [], today: '2026-10-19', dayId: 'upperA', reentry: w1 });
  assert.equal(e.week, null); assert.equal(e.deload, false);
  const total = (items) => items.reduce((n, x) => n + x.sets, 0);
  assert.equal(total(p.days.upperA.items), 29);
  assert.equal(total(e.plan.items), 18); // ≈ 55–62 %
  assert.ok(e.plan.minutes < 40, `${e.plan.minutes}`);
  assert.equal(e.plan.changes[0].code, 'reentry'); assert.match(e.plan.changes[0].text, /رجوع · الأسبوع 1 من 2/);
  assert.equal(e.plan.items[0].reps, '6-10');
  const e2 = L.dayEstimate({ program: p, sessions: [], today: '2026-10-26', dayId: 'upperA', reentry: w2 });
  assert.equal(total(e2.plan.items), 20);
  // live session: loads from the last session × 0.8, header line, no double set cut, no 7-day "lighter" on top
  const hist = [ses('h1', '2026-07-20', [ex('ex1', [[80, 8, 2], [80, 8, 2], [80, 7, 2], [80, 6, 2]], { exId: 'uaFB' })], { dayKey: 'upperA' })];
  const live = L.buildLive({ items: e.plan.items, dayId: 'upperA', dayName: 'Upper A', sessions: hist, lighter: true, week: 1, reentry: w1 });
  assert.equal(live.week, undefined); assert.deepEqual(live.reentry, { week: 1, of: 2, startDay: '2026-10-19' });
  assert.deepEqual(live.exercises[0].sets.map((t) => t.w), [65, 65]);
  assert.equal(L.prefillReason(live.exercises[0]), L.GATES.reentry);
  assert.equal(L.weekLine(live, live.exercises[0]), 'رجوع · الأسبوع 1 من 2 · سيب 4 عدّات');
  assert.equal(L.weekLine({ week: 2 }, { kind: 'compound', sets: [{}, {}] }), 'الأسبوع 2 · سيب 2 عدّات');
  // after 2 weeks the 6-week block starts on the re-entry end day, even when the plan start date was earlier
  const after = L.reentryInfo(st, '2026-11-02');
  assert.equal(L.blockStart('2026-10-19', after), '2026-11-02');
  assert.equal(L.blockStart('2026-12-01', after), '2026-12-01');
  assert.equal(L.blockStart('2026-10-19', null), '2026-10-19');
  const e3 = L.dayEstimate({ program: p, sessions: [], today: '2026-11-02', dayId: 'upperA', reentry: after });
  assert.equal(e3.week, 1); assert.equal(e3.block, 1);
  assert.equal(L.dayEstimate({ program: p, sessions: [], today: '2026-11-09', dayId: 'upperA', reentry: after }).week, 2);
});

test('pull-up gate: 3×8 body-weight pull-ups at RIR ≥ 2 → back to the weighted pull-up', () => {
  const s1 = ses('a', '2026-11-02', [ex('ex12', [[0, 8, 2], [0, 8, 2], [0, 7, 2]])]);
  assert.equal(L.pullupReady([s1]).ready, false);
  const s2 = ses('b', '2026-11-09', [ex('ex12', [[0, 8, 2], [0, 9, 3], [0, 8, null]])]);
  assert.deepEqual(L.pullupReady([s1, s2]), { ready: true, day: '2026-11-09' });
  assert.equal(L.pullupReady([ses('c', '2026-11-09', [ex('ex12', [[0, 8, 1], [0, 8, 1], [0, 8, 1]])])]).ready, false, 'RIR 1 is too close to failure');
  const p = L.backToPullup(P());
  assert.equal(p.days.upperA.items[1].lib, 'exWPU'); assert.equal(p.days.upperA.items[1].id, 'ub1'); assert.equal(p.days.upperA.items[1].ss, 'A');
  assert.equal(P().days.upperA.items[1].lib, 'ex14');
});
