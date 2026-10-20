import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';
import { planChange, applyChange, consumePrefill, weeklyPlanned, resolveDay, resolveItem, ssConflict } from './coach-bridge.js';

const TODAY = '2026-10-20'; // Tuesday

/** In-memory db with the ctx.db surface used by the store (get / put / getAll / delete). */
function memDb(seed = {}) {
  const stores = { programs: new Map(), kv: new Map(), sessions: new Map() };
  for (const [st, rows] of Object.entries(seed)) for (const r of rows) stores[st].set(r.key ?? r.id, JSON.parse(JSON.stringify(r)));
  const cp = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    stores,
    async get(st, k) { return cp(stores[st].get(k)); },
    async put(st, v) { stores[st].set(v.key ?? v.id, cp(v)); },
    async getAll(st) { return [...stores[st].values()].map(cp); },
    async delete(st, k) { stores[st].delete(k); },
  };
}
function fakeCtx(seed) {
  const events = [];
  return { db: memDb(seed), today: () => TODAY, settings: { get: (k) => (k === 'weekStart' ? 1 : null) }, emit: (e, d) => events.push([e, d]), events };
}
const base = () => L.fromTemplate('ul4c', { startDay: '2026-10-05' });
const rec = () => ({ key: 'current', v: 2, ...base() });

test('resolveDay / resolveItem accept ids, names and library ids', () => {
  const p = base();
  assert.equal(resolveDay(p, 'Upper A'), 'upperA');
  assert.equal(resolveDay(p, 'lowera'), 'lowerA');
  assert.equal(resolveDay(p, 'nope'), null);
  assert.equal(resolveItem(p, 'upperA', 'uaFB'), 0);
  assert.equal(resolveItem(p, 'upperA', 'ex1'), 0);
  assert.equal(resolveItem(p, 'upperA', 'ex41'), -1);
});

test('swap: same primary muscle keeps sets/reps/rest/superset; other muscle needs an explicit ack', () => {
  const p = base();
  const it = p.days.upperA.items[2]; // uaID incline DB press, ss B
  const r = planChange(p, { type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'exFDP' }, { today: TODAY });
  assert.equal(r.ok, true); assert.equal(r.ack, null);
  const n = r.next.days.upperA.items[2];
  assert.equal(n.lib, 'exFDP'); assert.equal(n.ar, 'ضغط دمبل مسطّح');
  assert.deepEqual([n.sets, n.reps, n.restS, n.ss, n.rir], [it.sets, it.reps, it.restS, it.ss, it.rir]);
  assert.notEqual(n.id, 'uaID', 'new id so the old history is not credited to the new exercise');
  assert.equal(p.days.upperA.items[2].lib, 'ex2', 'input program never mutated');
  assert.deepEqual(r.muscles.find((m) => m.muscle === 'صدر'), { muscle: 'صدر', before: 11, after: 11, mev: 8, mrv: 22, status: 'in' }, 'affected muscle shown even when unchanged');
  const x = planChange(p, { type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'ex29' }, { today: TODAY });
  assert.equal(x.ok, true); assert.match(x.ack, /العضلة الأساسية مختلفة/);
  assert.equal(planChange(p, { type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'nope' }).ok, false);
  assert.equal(planChange(p, { type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'ex1' }).ok, false, 'already in the day');
});

test('superset rules: no axial + axial, no grip + grip', () => {
  const p = base();
  const r = planChange(p, { type: 'workout.swap', day: 'lowerB', fromExId: 'lbLR', toExId: 'ex41' }, { today: TODAY }); // RDL ↔ squat
  assert.equal(r.ok, false); assert.match(r.error, /الضهر/);
  assert.match(ssConflict([{ lib: 'ex11', ss: 'A' }, { lib: 'ex12', ss: 'A' }], 'A'), /القبضة/);
  assert.equal(ssConflict([{ lib: 'ex1', ss: 'A' }, { lib: 'exWPU', ss: 'A' }], 'A'), null);
  const add = planChange(p, { type: 'workout.addExercise', day: 'upperB', exId: 'ex13', sets: 3, reps: '8-10', pairWith: 'ua4' }, { today: TODAY });
  assert.equal(add.ok, true, 'barbell row + lat pulldown is fine');
});

test('sets: weekly hard sets per muscle bounded by MRV; reps 3–30', () => {
  const p = base();
  assert.equal(weeklyPlanned(p)['كوادز'], 14);
  const a = planChange(p, { type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 10 }, { today: TODAY });
  assert.equal(a.ok, true);
  const q = a.muscles.find((m) => m.muscle === 'كوادز');
  assert.deepEqual([q.before, q.after, q.mev, q.mrv], [14, 20, 8, 20]);
  const b = planChange(a.next, { type: 'workout.sets', day: 'lowerB', exId: 'lbHACK', sets: 4 }, { today: TODAY });
  assert.equal(b.ok, false); assert.match(b.error, /كوادز/); assert.match(b.error, /20/);
  assert.equal(planChange(p, { type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 4, reps: '2-5' }).ok, false);
  assert.equal(planChange(p, { type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 4, reps: '5-8' }).ok, false, 'no change');
  const down = planChange(a.next, { type: 'workout.sets', day: 'lowerA', exId: 'la1', sets: 9 }, { today: TODAY });
  assert.equal(down.ok, true, 'going down is always allowed');
});

test('add / remove: MRV on add, MEV warning on remove, superset partner cleaned up', () => {
  const p = base();
  const add = planChange(p, { type: 'workout.addExercise', day: 'lowerB', exId: 'ex43', sets: 10, reps: '8-12' }, { today: TODAY });
  assert.equal(add.ok, false); assert.match(add.error, /الحد الأقصى/);
  const ok = planChange(p, { type: 'workout.addExercise', day: 'upperB', exId: 'ex30', sets: 2, reps: '10-15', pairWith: 'ubOCT' }, { today: TODAY });
  assert.equal(ok.ok, true);
  const items = ok.next.days.upperB.items;
  const i = items.findIndex((x) => x.lib === 'ex30');
  assert.equal(items[i].ss, 'D'); assert.equal(items[i - 1].id, 'ubOCT', 'placed right after its superset group');
  const long = planChange(p, { type: 'workout.addExercise', day: 'upperA', exId: 'ex30', sets: 3, reps: '10-15' }, { today: TODAY });
  assert.ok(long.ok && long.minutes.after > 60 && long.warnings.some((w) => /60/.test(w)), `time warning past 60 min ${JSON.stringify(long.minutes)}`);
  const rm = planChange(p, { type: 'workout.removeExercise', day: 'lowerA', exId: 'la5a' }, { today: TODAY });
  assert.equal(rm.ok, true);
  assert.ok(rm.warnings.some((w) => /سمانة/.test(w) && /الحد الأدنى/.test(w)), rm.warnings.join());
  const rm2 = planChange(p, { type: 'workout.removeExercise', day: 'lowerB', exId: 'lbLR' }, { today: TODAY });
  assert.equal(rm2.next.days.lowerB.items.find((x) => x.id === 'la2').ss, undefined, 'lone partner loses its tag');
});

test('apply + undo restores the exact program snapshot', async () => {
  const ctx = fakeCtx({ programs: [rec()], kv: [{ key: 'training', value: { carry: { x: 1 } } }] });
  const before = await ctx.db.get('programs', 'current');
  const r = await applyChange(ctx, { type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'exFDP' });
  assert.equal(r.ok, true);
  const mid = await ctx.db.get('programs', 'current');
  assert.equal(mid.days.upperA.items[2].lib, 'exFDP');
  assert.ok(ctx.events.some(([e]) => e === 'session:changed'));
  await r.undo();
  assert.deepEqual(await ctx.db.get('programs', 'current'), before);
  // without an ack a muscle-changing swap is refused
  const x = await applyChange(ctx, { type: 'workout.swap', day: 'upperA', fromExId: 'uaID', toExId: 'ex29' });
  assert.equal(x.ok, false);
  assert.deepEqual(await ctx.db.get('programs', 'current'), before);
  // no stored program (defaults) → undo removes the record again
  const c2 = fakeCtx({});
  const r2 = await applyChange(c2, { type: 'workout.sets', day: 'upperA', exId: 'ua5a', sets: 4 });
  assert.equal(r2.ok, true); assert.ok(await c2.db.get('programs', 'current'));
  await r2.undo(); assert.equal(await c2.db.get('programs', 'current'), undefined);
});

test('prefill: stored per day, consumed exactly once; undo restores the previous prefill', async () => {
  const ctx = fakeCtx({ programs: [rec()], kv: [{ key: 'training', value: { carry: { a: 1 } } }] });
  const act = { type: 'workout.prefill', day: 'lowerA', items: [{ exId: 'la1', sets: [{ w: 100, r: 6 }, { w: 100, r: 6 }], note: 'زوّد عدّة' }, { exId: 'ex44', sets: [{ w: 50, r: 12 }] }] };
  const r = await applyChange(ctx, act);
  assert.equal(r.ok, true);
  const t = (await ctx.db.get('kv', 'training')).value;
  assert.deepEqual(Object.keys(t.coachPrefill.lowerA.items), ['la1', 'la7a'], 'keyed by item id (= live exId)');
  assert.deepEqual(t.carry, { a: 1 }, 'other training keys untouched');
  const got = await consumePrefill(ctx, 'lowerA');
  assert.deepEqual(got.la1, { sets: [{ w: 100, r: 6 }, { w: 100, r: 6 }], lib: 'ex41', note: 'زوّد عدّة' });
  assert.equal(await consumePrefill(ctx, 'lowerA'), null, 'second call gets nothing');
  assert.equal(await consumePrefill(ctx, 'upperA'), null);
  // undo after apply puts back exactly what was there (no coachPrefill key)
  const r2 = await applyChange(ctx, act);
  await r2.undo();
  assert.equal('coachPrefill' in (await ctx.db.get('kv', 'training')).value, true, 'empty object left by consume stays');
  assert.deepEqual((await ctx.db.get('kv', 'training')).value.coachPrefill, {});
  const bad = await applyChange(ctx, { type: 'workout.prefill', day: 'lowerA', items: [{ exId: 'ex1', sets: [{ w: 60, r: 8 }] }] });
  assert.equal(bad.ok, false, 'exercise not in that day');
});

test('deload: now or a future week, never while one is active; undo restores the previous deload', async () => {
  const ctx = fakeCtx({ programs: [rec()], kv: [{ key: 'training', value: { deload: { dismissed: '2026-10-01' } } }] });
  const p = base();
  const fut = planChange(p, { type: 'workout.deload', startWeek: 1 }, { today: TODAY, weekStartDow: 1 });
  assert.equal(fut.patch.deload.start, '2026-10-26');
  const r = await applyChange(ctx, { type: 'workout.deload', now: true, reason: 'تعب' });
  assert.equal(r.ok, true);
  const t = (await ctx.db.get('kv', 'training')).value;
  assert.equal(t.deload.active, true); assert.equal(t.deload.start, TODAY);
  assert.equal(L.deloadActive(t.deload, TODAY), true);
  assert.equal((await applyChange(ctx, { type: 'workout.deload', now: true })).ok, false, 'already active');
  await r.undo();
  assert.deepEqual((await ctx.db.get('kv', 'training')).value.deload, { dismissed: '2026-10-01' });
});
