import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, along, ik, V, DIM, frame, mix } from '../src/features/workout/move3d/rig.js';
import { MOVES, moveFor, padsFor, PADS_OF } from '../src/features/workout/move3d/moves.js';
import { LIBRARY, fineOf } from '../src/features/workout/exercises.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('ik: bone lengths are exact and an out-of-reach target is pulled in, never stretched', () => {
  const r = ik([0, 1, 0], [0.3, 0.9, 0.2], 0.29, 0.27, [0, 0, -1]);
  assert.ok(near(V.len(V.sub(r.mid, [0, 1, 0])), 0.29, 1e-9));
  assert.ok(near(V.len(V.sub(r.end, r.mid)), 0.27, 1e-9));
  const far = ik([0, 1, 0], [5, 1, 0], 0.29, 0.27, [0, 0, -1]);
  assert.ok(V.len(V.sub(far.end, [0, 1, 0])) <= 0.56);
  assert.ok(Number.isFinite(ik([0, 1, 0], [0, 1, 0], 0.29, 0.27, [0, 0, 0]).mid[0]), 'degenerate input stays finite');
});

test('frame: standing is upright, +pitch leans forward, -90 lies on the back', () => {
  assert.deepEqual(frame(0).u.map((x) => Math.round(x)), [0, 1, 0]);
  assert.ok(frame(30).u[2] > 0);
  const lying = frame(-90);
  assert.ok(near(lying.f[1], 1, 1e-9) && near(lying.u[2], -1, 1e-9));
  assert.ok(near(frame(0).r[0], 1, 1e-9), 'left side is +X');
});

test('standing pose: symmetric, feet on the floor, head on top', () => {
  const { J } = solve({});
  assert.ok(near(J.haL[0], -J.haR[0]) && near(J.knL[1], J.knR[1]));
  assert.ok(near(J.anL[1], DIM.ANKLE, 1e-3));
  assert.ok(J.head[1] > J.neck[1] && J.neck[1] > J.shL[1] && J.shL[1] > J.hipL[1]);
});

test('every movement: all joints finite on the whole path, nothing under the floor, limbs keep their length', () => {
  const bad = new Set();
  for (const id of Object.keys(MOVES)) {
    const m = moveFor(id);
    assert.ok(m.keys.length >= 2 && m.view && Array.isArray(m.props), id);
    for (let i = 0; i <= 10; i++) {
      const { J } = solve(along(m.keys, i / 10));
      for (const [k, v] of Object.entries(J)) {
        assert.ok(v.every(Number.isFinite), `${id} ${k} t=${i / 10}`);
        if (!(v[1] > -0.03)) bad.add(`${id} ${k} ${v[1].toFixed(2)}`);
      }
      for (const s of ['L', 'R']) {
        assert.ok(near(V.len(V.sub(J[`el${s}`], J[`sh${s}`])), DIM.UA, 1e-6), `${id} upper arm`);
        assert.ok(near(V.len(V.sub(J[`kn${s}`], J[`hip${s}`])), DIM.TH, 1e-6), `${id} thigh`);
      }
    }
  }
  assert.deepEqual([...bad], [], 'joints under the floor');
});

test('every movement actually moves, and both ends are reachable (hands land where the pose says)', () => {
  const short = [];
  for (const id of Object.keys(MOVES)) {
    const m = moveFor(id);
    const a = solve(m.keys[0]).J; const b = solve(m.keys[m.keys.length - 1]).J;
    const travel = Math.max(...Object.keys(a).map((k) => V.len(V.sub(a[k], b[k]))));
    assert.ok(travel > 0.01, `${id} does not move`);
    for (const key of m.keys) {
      if (!key.hand) continue;
      const J = solve(key).J;
      const d = V.len(V.sub(J.haL, key.hand));
      if (d >= 0.09) short.push(`${id} hand ${d.toFixed(2)}`);
      if (key.foot) { const fd = V.len(V.sub(J.anL, key.foot)); if (fd >= 0.09) short.push(`${id} foot ${fd.toFixed(2)}`); }
    }
  }
  assert.deepEqual(short, [], 'targets out of reach');
});

test('mapping: every id is a real library exercise, and every library muscle name has pads', () => {
  const ids = new Set(LIBRARY.map((e) => e.id));
  for (const id of Object.keys(MOVES)) assert.ok(ids.has(id), id);
  for (const e of LIBRARY) {
    const f = fineOf({ lib: e.id, ...e });
    if (!MOVES[e.id]) continue;
    assert.ok(PADS_OF[f.prime], `${e.id}: no pads for «${f.prime}»`);
    assert.ok(padsFor(f).primary.size > 0, e.id);
  }
  assert.ok(Object.keys(MOVES).length >= 60);
});

test('mix: a right-hand override on one key blends against the mirrored left hand of the other', () => {
  const p = mix({ hand: [0.3, 1, 0] }, { hand: [0.3, 1, 0], handR: [-0.1, 0.5, 0] }, 0.5);
  assert.deepEqual(p.handR.map((x) => Math.round(x * 100) / 100), [-0.2, 0.75, 0]);
});

test('every movement lists its common mistakes', async () => {
  const { mistakesFor } = await import('../src/features/workout/move3d/moves.js');
  for (const id of Object.keys(MOVES)) assert.ok(mistakesFor(id).length >= 2, id);
  assert.deepEqual(mistakesFor('nope'), []);
});
