// Exercise → 3D movement. Each movement is a short list of key poses (start … end) plus the equipment around it.
// Poses are written with targets (where the hands and ankles are), see rig.js. Numbers are metres; the figure faces +Z.
// One template covers a family of exercises (press, row, curl, squat…); MOVES maps library ids onto them.
// An exercise with no entry here simply keeps its video button.
import { V, frame, chestPoint as cp, shoulder as S, DIM } from './rig.js';

// ───── equipment helpers ─────
const bench = (top = 0.4, z0 = -0.82, z1 = 0.32, w = 0.3) => [
  { t: 'box', p: [0, top - 0.04, (z0 + z1) / 2], s: [w, 0.08, z1 - z0], c: 'pad' },
  { t: 'box', p: [0, (top - 0.08) / 2, z0 + 0.14], s: [w - 0.04, top - 0.08, 0.05], c: 'metal' },
  { t: 'box', p: [0, (top - 0.08) / 2, z1 - 0.14], s: [w - 0.04, top - 0.08, 0.05], c: 'metal' }];
const seat = (top = 0.45, z = 0, d = 0.4) => [{ t: 'box', p: [0, top - 0.04, z], s: [0.36, 0.08, d], c: 'pad' }, { t: 'box', p: [0, (top - 0.08) / 2, z], s: [0.1, top - 0.08, 0.1], c: 'metal' }];
/** Pad behind (side = -1) or in front of (+1) the torso of a pose. */
const torsoPad = (p, side = -1, len = 0.8, up = 0.32) => {
  const f = frame(p.pr || 0);
  return { t: 'box', p: V.add(p.pelvis, V.add(V.mul(f.u, up), V.mul(f.f, 0.15 * side))), s: [0.32, len, 0.07], rx: p.pr || 0, c: 'pad' };
};
const post = (x, z, h = 2.2) => ({ t: 'cyl', a: [x, 0, z], b: [x, h, z], r: 0.03, c: 'metal' });
const bar = (len = 1.9, plates = true, at = 'hands') => ({ t: 'rod', at, len, plates });
const SEATED = { pelvis: [0, 0.55, 0], foot: [0.2, 0.07, 0.38], kp: [0, 1, 0.6] };
const HANG = [0.27, 0.92, 0.03];
const view = (yaw, y = 0.95, dist = 3.5, pitch = 12) => ({ yaw, y, dist, pitch });

// ───── templates ─────
function press({ incl = 0, eq = 'bar', grip = 0.3 } = {}) {
  const base = { pelvis: [0, 0.5, incl ? 0.1 : 0.15], pr: incl - 90, foot: [0.25, 0.07, incl ? 0.62 : 0.75], kp: [0.1, 1, 0.3] };
  const sh = S(base);
  const a = { ...base, hand: cp(base, [grip, 0.24, 0.13]), ep: grip < 0.2 ? [0.3, -1, 0.4] : [1, -0.8, 0.2] };
  const b = { ...base, hand: [grip * 0.9, sh[1] + 0.53, sh[2]], ep: a.ep };
  const props = incl ? [...seat(0.4, 0.14, 0.34), torsoPad(base, -1, 0.9, 0.3)] : bench();
  props.push(eq === 'bar' ? bar(grip < 0.2 ? 1.7 : 1.9) : { t: 'db', axis: 'x' });
  return { keys: [a, b], props, view: view(55, 0.75, 3.3) };
}
function machinePress() {
  const base = { ...SEATED, pr: -15 };
  return { keys: [{ ...base, hand: cp(base, [0.3, 0.2, 0.14]), ep: [1, -0.5, 0] }, { ...base, hand: cp(base, [0.26, 0.24, 0.6]), ep: [1, -0.5, 0] }],
    props: [...seat(0.45), torsoPad(base), { t: 'db', axis: 'y', small: true }], view: view(60, 0.85, 3.2) };
}
function pushup() {
  const c = { hand: [0.3, 0.04, 0.25], ep: [1, 0.2, -0.6], foot: [0.1, 0.19, -1.05], toe: [0, -1, 0.15], kp: [0, 1, 0] };
  return { keys: [{ ...c, pelvis: [0, 0.16, -0.125], pr: 84 }, { ...c, pelvis: [0, 0.41, -0.18], pr: 68.6 }], props: [], view: view(70, 0.3, 3.2, 16) };
}
function dips(lean = 5) {
  const c = { hand: [0.3, 1.0, 0], ep: [0.2, 0, -1], kp: [0, 0, 1] };
  return { keys: [{ ...c, pelvis: [0, 0.82, -0.12 - lean / 200], pr: lean + 12, foot: [0.1, 0.26, -0.5] }, { ...c, pelvis: [0, 1.1, -0.02 - lean / 300], pr: lean, foot: [0.1, 0.52, -0.42] }],
    props: [{ t: 'cyl', a: [0.3, 0.97, -0.5], b: [0.3, 0.97, 0.5], r: 0.022, c: 'metal' }, { t: 'cyl', a: [-0.3, 0.97, -0.5], b: [-0.3, 0.97, 0.5], r: 0.022, c: 'metal' }, post(0.3, -0.5, 0.97), post(-0.3, -0.5, 0.97)], view: view(50, 0.95, 3.4) };
}
function flyLying() {
  const base = { pelvis: [0, 0.5, 0.15], pr: -90, foot: [0.25, 0.07, 0.75], kp: [0.1, 1, 0.3] };
  const sh = S(base);
  return { keys: [{ ...base, hand: [0.62, sh[1] + 0.06, sh[2]], ep: [0.2, -1, 0] }, { ...base, hand: [0.07, sh[1] + 0.53, sh[2]], ep: [0.6, -0.4, 0] }], props: [...bench(), { t: 'db', axis: 'z' }], view: view(25, 0.75, 3.3, 20) };
}
function pecDeck(reverse = false) {
  const base = { ...SEATED };
  const open = { ...base, hand: [0.62, 1.0, reverse ? 0.02 : 0.1], ep: reverse ? [0, -1, 0.2] : [0, -1, -0.5] };
  const closed = { ...base, hand: [reverse ? 0.1 : 0.07, 1.0, 0.5], ep: open.ep };
  return { keys: reverse ? [closed, open] : [open, closed], props: [...seat(0.45), torsoPad(base, reverse ? 1 : -1, 0.6, 0.3), { t: 'db', axis: 'y', small: true }], view: view(reverse ? 150 : 30, 0.85, 3.2) };
}
function crossover() {
  const base = { pelvis: [0, 1, 0], pr: 12 };
  return { keys: [{ ...base, hand: [0.66, 1.38, 0.05], ep: [0.3, 0.3, -1] }, { ...base, hand: [0.06, 1.02, 0.42], ep: [0.3, 0.3, -1] }],
    props: [post(1.1, 0), post(-1.1, 0), { t: 'cable', from: [1.1, 2.05, 0], to: 'haL' }, { t: 'cable', from: [-1.1, 2.05, 0], to: 'haR' }], view: view(25, 1.05, 4.2) };
}
function rearFly() {
  const base = { pelvis: [0, 0.93, -0.15], pr: 70, foot: [0.13, 0.07, 0], kp: [0, 0, 1] };
  return { keys: [{ ...base, hand: cp(base, [0.1, 0.3, 0.52]), ep: [0.2, 1, -0.3] }, { ...base, hand: cp(base, [0.6, 0.32, 0.1]), ep: [0.2, 1, -0.3] }], props: [{ t: 'db', axis: 'z' }], view: view(140, 0.9, 3.4, 18) };
}
function facePull() {
  return { keys: [{ hand: [0.12, 1.5, 0.5], ep: [1, 0.3, 0] }, { hand: [0.34, 1.56, 0.06], ep: [1, 0.3, 0] }], props: [post(0, 1.35), { t: 'cable', from: [0, 1.7, 1.33], to: 'haL' }, { t: 'cable', from: [0, 1.7, 1.33], to: 'haR' }], view: view(130, 1.1, 3.8) };
}
function ohp({ seated = false, eq = 'bar' } = {}) {
  if (!seated) return { keys: [{ hand: [0.28, 1.5, 0.14], ep: [0.5, -1, 0.2] }, { hand: [0.25, 2.0, 0.02], ep: [0.5, -1, 0.2] }], props: [eq === 'bar' ? bar() : { t: 'db', axis: 'x' }], view: view(30, 1.15, 4) };
  const base = { ...SEATED };
  return { keys: [{ ...base, hand: [0.33, 1.05, 0.08], ep: [1, -1, 0] }, { ...base, hand: [0.24, 1.55, 0], ep: [1, -1, 0] }], props: [...seat(0.45), torsoPad(base, -1, 0.7, 0.3), eq === 'bar' ? bar() : { t: 'db', axis: 'x' }], view: view(30, 0.9, 3.5) };
}
function lateral(cable = false) {
  const a = { hand: [0.3, 0.93, 0.05], ep: [0, -1, -0.6] }; const b = { hand: [0.73, 1.43, 0.08], ep: [0, -1, -0.6] };
  if (!cable) return { keys: [a, b], props: [{ t: 'db', axis: 'z' }], view: view(15, 1.05, 3.8) };
  const r = { handR: [-0.27, 0.92, 0.03] };
  return { keys: [{ ...a, ...r }, { ...b, ...r }], props: [post(-0.75, 0.05, 1.2), { t: 'cable', from: [-0.75, 0.08, 0.05], to: 'haL' }], view: view(15, 1.05, 3.8) };
}
function uprightRow() { return { keys: [{ hand: [0.11, 0.92, 0.13], ep: [1, 0.5, -0.1] }, { hand: [0.11, 1.36, 0.13], ep: [1, 0.5, -0.1] }], props: [bar(1.5)], view: view(25, 1.05, 3.8) }; }
function shrug(eq) { return { keys: [{ hand: [0.27, 0.92, 0.05] }, { hand: [0.27, 0.99, 0.05], shrug: 0.07 }], props: [eq === 'bar' ? bar() : { t: 'db', axis: 'z' }], view: view(160, 1.1, 3.6), period: 2000 }; }

function rowBent({ support = false, one = false } = {}) {
  const base = support ? { pelvis: [0, 0.74, -0.2], pr: 50, foot: [0.15, 0.07, -0.55], kp: [0, 0.3, 1] } : { pelvis: [0, 0.93, -0.12], pr: one ? 72 : 60, foot: [0.14, 0.07, 0], kp: [0.1, 0, 1] };
  const sh = S(base);
  const a = { ...base, hand: [0.25, sh[1] - 0.55, sh[2]], ep: [0.3, 0.8, -1] };
  const b = { ...base, hand: [0.25, sh[1] - 0.2, sh[2] - 0.22], ep: [0.3, 0.8, -1] };
  if (one) {
    const r = { handR: [-0.2, 0.5, sh[2] + 0.05], epR: [-0.3, 0, -1] };
    return { keys: [{ ...a, ...r }, { ...b, ...r }], props: [{ t: 'box', p: [-0.2, 0.42, sh[2] + 0.05], s: [0.3, 0.08, 0.9], c: 'pad' }, { t: 'box', p: [-0.2, 0.19, sh[2] + 0.05], s: [0.1, 0.38, 0.1], c: 'metal' }, { t: 'db', axis: 'z', only: 'L' }], view: view(115, 0.8, 3.4, 16) };
  }
  return { keys: [a, b], props: [...(support ? [torsoPad(base, 1, 0.75, 0.3), { t: 'box', p: [0, 0.3, 0.1], s: [0.1, 0.6, 0.1], c: 'metal' }] : []), bar(support ? 1.3 : 1.9)], view: view(115, 0.8, 3.5, 16) };
}
function cableRow() {
  const base = { pelvis: [0, 0.5, 0], foot: [0.12, 0.32, 0.85], kp: [0, 1, 0], toe: [0, 1, 0.2] };
  return { keys: [{ ...base, pr: 8, hand: [0.1, 0.98, 0.55], ep: [0.5, -0.3, -1] }, { ...base, pr: -6, hand: [0.2, 0.92, 0.14], ep: [0.5, -0.3, -1] }],
    props: [...bench(0.4, -0.3, 0.55), { t: 'box', p: [0, 0.3, 0.97], s: [0.5, 0.34, 0.05], rx: -15, c: 'metal' }, post(0, 1.4, 1.1), { t: 'cable', from: [0, 0.95, 1.38], to: 'mid' }, bar(0.5, false)], view: view(100, 0.75, 3.5) };
}
function pulldown() {
  const base = { ...SEATED, foot: [0.2, 0.07, 0.3], kp: [0, 1, 0.5] };
  return { keys: [{ ...base, pr: 0, hand: [0.38, 1.54, 0.04], ep: [1, 0, 0.3] }, { ...base, pr: -12, hand: [0.34, 1.12, 0.12], ep: [1, -0.8, -0.3] }],
    props: [...seat(0.45), { t: 'box', p: [0, 0.72, 0.3], s: [0.5, 0.08, 0.12], c: 'pad' }, bar(1.2, false), { t: 'cable', from: [0, 2.35, 0.06], to: 'mid' }], view: view(160, 1.05, 3.8) };
}
function pullup() {
  const c = { hand: [0.33, 2.1, 0], kp: [0, 0, 1] };
  return { keys: [{ ...c, pelvis: [0, 1.13, 0], foot: [0.1, 0.35, -0.25], ep: [1, 0, 0.4] }, { ...c, pelvis: [0, 1.5, -0.06], pr: -8, foot: [0.1, 0.72, -0.3], ep: [1, -0.6, -0.2] }],
    props: [{ t: 'cyl', a: [-0.65, 2.1, 0], b: [0.65, 2.1, 0], r: 0.02, c: 'metal' }, post(0.65, 0, 2.1), post(-0.65, 0, 2.1)], view: view(160, 1.25, 4.3) };
}
function straightArm() {
  const base = { pelvis: [0, 1, -0.05], pr: 15 };
  return { keys: [{ ...base, hand: [0.2, 1.72, 0.42], ep: [0.3, 1, -0.5] }, { ...base, hand: [0.2, 0.95, 0.16], ep: [0.3, 0.2, -1] }], props: [bar(0.6, false), post(0, 0.8), { t: 'cable', from: [0, 2.2, 0.78], to: 'mid' }], view: view(110, 1.1, 4) };
}
function deadlift({ sumo = false, rdl = false } = {}) {
  const foot = sumo ? [0.36, 0.07, 0] : [0.14, 0.07, 0]; const kp = sumo ? [1, 0, 0.6] : [0.15, 0, 1]; const hx = sumo ? 0.13 : 0.24;
  const top = { foot, kp, hand: [hx, 0.86, 0.12] };
  const low = rdl ? { foot, kp, pelvis: [0, 0.93, -0.2], pr: 78, hand: [hx, 0.5, 0.22] } : { foot, kp, pelvis: [0, sumo ? 0.5 : 0.55, sumo ? -0.22 : -0.3], pr: sumo ? 48 : 55, hand: [hx, 0.27, 0.1] };
  return { keys: rdl ? [top, low] : [low, top], props: [bar()], view: view(65, 0.8, 3.8) };
}
function hyper() {
  const c = { pelvis: [0, 0.95, 0], foot: [0.1, 0.25, -0.6], kp: [0, 1, 0.3], toe: [0, -0.7, -0.7], ep: [1, -0.3, 0] };
  const a = { ...c, pr: 108, spine: 8 }; const b = { ...c, pr: 45 };
  a.hand = cp(a, [0.08, 0.22, 0.13]); b.hand = cp(b, [0.08, 0.22, 0.13]);
  return { keys: [a, b], props: [{ t: 'box', p: [0, 0.83, 0.1], s: [0.4, 0.1, 0.3], rx: 45, c: 'pad' }, { t: 'box', p: [0, 0.4, 0.05], s: [0.1, 0.8, 0.1], c: 'metal' }, { t: 'box', p: [0, 0.2, -0.68], s: [0.4, 0.08, 0.1], c: 'pad' }], view: view(80, 0.8, 3.6) };
}

/** Curl keys around a shoulder position: the elbow hangs under it and stays put while the forearm folds. */
function curlKeys(base, sh, fwd = 0) {
  const e = [sh[0] + 0.02, sh[1] - 0.29 + fwd * 0.1, sh[2] + fwd * 0.21];
  const ep = [0.1, -0.3, -1];
  if (fwd) return [{ ...base, hand: V.add(e, V.mul(V.norm([0, -0.55, 0.83]), 0.27)), ep: [0, -1, 0.3] }, { ...base, hand: V.add(e, V.mul(V.norm([0, 0.3, 0.95]), 0.27)), ep: [0, -1, 0.3] }, { ...base, hand: V.add(e, V.mul(V.norm([0, 0.95, -0.3]), 0.27)), ep: [0, -1, 0.3] }];
  return [{ ...base, hand: [e[0] + 0.02, e[1] - 0.265, e[2] + 0.04], ep }, { ...base, hand: [e[0] + 0.01, e[1], e[2] + 0.27], ep }, { ...base, hand: [e[0] - 0.01, e[1] + 0.23, e[2] + 0.14], ep }];
}
function curl({ eq = 'bar', kind = 'stand' } = {}) {
  const tool = eq === 'bar' ? bar(1.4) : eq === 'cable' ? bar(0.5, false) : { t: 'db', axis: eq === 'hammer' ? 'z' : 'x' };
  if (kind === 'incline') { const base = { ...SEATED, pr: -30, foot: [0.2, 0.07, 0.45] }; return { keys: curlKeys(base, S(base)), props: [...seat(0.45, 0.05), torsoPad(base, -1, 0.9, 0.3), tool], view: view(60, 0.85, 3.3) }; }
  if (kind === 'preacher') { const base = { ...SEATED, pelvis: [0, 0.55, -0.1], pr: 15 }; const sh = S(base); return { keys: curlKeys(base, sh, 1), props: [...seat(0.45, -0.1), { t: 'box', p: [0, sh[1] - 0.2, sh[2] + 0.2], s: [0.55, 0.06, 0.42], rx: 45, c: 'pad' }, { t: 'box', p: [0, (sh[1] - 0.3) / 2, sh[2] + 0.3], s: [0.1, sh[1] - 0.3, 0.1], c: 'metal' }, tool], view: view(60, 0.85, 3.3) }; }
  const props = [tool];
  if (eq === 'cable') props.push(post(0, kind === 'behind' ? -0.9 : 0.75, 0.6), { t: 'cable', from: [0, 0.1, kind === 'behind' ? -0.88 : 0.73], to: 'mid' });
  return { keys: curlKeys({}, S({})), props, view: view(50, 1.05, 3.7) };
}
function pushdown(rope = false) {
  return { keys: [{ pr: 8, hand: [0.15, 1.28, 0.24], ep: [0.2, 0, -1] }, { pr: 8, hand: [0.17, 0.9, 0.1], ep: [0.2, 0, -1] }], props: [...(rope ? [] : [bar(0.5, false)]), post(0, 0.55), { t: 'cable', from: [0, 2.2, 0.52], to: 'mid' }], view: view(60, 1.1, 3.9) };
}
function overheadExt({ cable = false } = {}) {
  if (cable) {
    const base = { pelvis: [0, 1, 0], pr: 25, foot: [0.12, 0.07, 0.05] }; const f = frame(25);
    const ep = V.add(f.u, V.mul(f.f, 0.6));
    return { keys: [{ ...base, hand: cp(base, [0.1, 0.52, -0.16]), ep }, { ...base, hand: cp(base, [0.1, 0.82, 0.12]), ep }], props: [post(0, -1.0), { t: 'cable', from: [0, 1.05, -0.98], to: 'mid' }], view: view(110, 1.1, 4) };
  }
  const base = { ...SEATED }; const sh = S(base);
  return { keys: [{ ...base, hand: [0.1, sh[1] + 0.2, -0.2], ep: [0.2, 1, 0.4] }, { ...base, hand: [0.1, sh[1] + 0.55, 0], ep: [0.2, 1, 0.4] }], props: [...seat(0.45), { t: 'db', axis: 'y', at: 'mid' }], view: view(125, 0.95, 3.5) };
}
function skull() {
  const base = { pelvis: [0, 0.5, 0.15], pr: -90, foot: [0.25, 0.07, 0.75], kp: [0.1, 1, 0.3] }; const sh = S(base);
  return { keys: [{ ...base, hand: [0.15, sh[1] + 0.23, sh[2] - 0.28], ep: [0, 1, 1] }, { ...base, hand: [0.15, sh[1] + 0.555, sh[2] - 0.02], ep: [0, 1, 1] }], props: [...bench(), bar(1.2)], view: view(75, 0.75, 3.3) };
}

function squat({ front = false, machine = false } = {}) {
  const c = { foot: [0.2, 0.07, 0], kp: [0.3, 0, 1] };
  const a = { ...c, pelvis: [0, 1, 0], pr: 4 }; const b = { ...c, pelvis: [0, 0.5, front ? -0.24 : -0.3], pr: front ? 30 : 42 };
  for (const k of [a, b]) { k.hand = cp(k, front ? [0.2, 0.34, 0.12] : [0.36, 0.33, -0.09]); k.ep = front ? [0.2, -0.2, 1] : [0.2, -1, -0.5]; }
  return { keys: [a, b], props: [bar(machine ? 0.6 : 1.9, !machine, front ? 'front' : 'back')], view: view(60, 0.85, 3.9) };
}
function legPress() {
  const base = { pelvis: [0, 0.42, 0], pr: -55, hand: [0.27, 0.4, 0.1], kp: [0.25, 1, -0.3], toe: [0, 0.77, -0.64] };
  return { keys: [{ ...base, foot: [0.16, 0.78, 0.42] }, { ...base, foot: [0.16, 0.93, 0.6] }], props: [{ t: 'box', p: [0, 0.28, 0.02], s: [0.36, 0.08, 0.36], c: 'pad' }, torsoPad(base, -1, 0.8, 0.3), { t: 'follow', at: 'feet', s: [0.6, 0.5, 0.05], rx: -40, off: [0, 0.1, 0.12] }], view: view(75, 0.7, 3.5) };
}
function splitSquat() {
  const c = { foot: [0.12, 0.07, 0.38], footR: [-0.12, 0.48, -0.72], toeR: [0, -1, -0.2], kp: [0, 0, 1], kpR: [0, -0.4, 1] };
  const a = { ...c, pelvis: [0, 0.93, 0] }; const b = { ...c, pelvis: [0, 0.56, 0], pr: 12 };
  for (const k of [a, b]) { const sh = S(k); k.hand = [0.27, sh[1] - 0.54, sh[2]]; }
  return { keys: [a, b], props: [{ t: 'box', p: [0, 0.36, -0.86], s: [0.9, 0.08, 0.3], c: 'pad' }, { t: 'box', p: [0, 0.16, -0.86], s: [0.1, 0.32, 0.1], c: 'metal' }, { t: 'db', axis: 'z' }], view: view(75, 0.8, 3.8) };
}
function legMachine(curl = false) {
  const base = { pelvis: [0, 0.62, 0], pr: -12, hand: [0.26, 0.55, 0.12], kp: [0, 1, 0.4] };
  const down = { ...base, foot: [0.1, 0.15, curl ? 0.36 : 0.5], toe: [0, 0, 1] }; const out = { ...base, foot: [0.1, 0.56, 0.87], toe: [0, 1, 0.2] };
  return { keys: curl ? [out, down] : [down, out], props: [...seat(0.52, 0.12, 0.5), torsoPad(base, -1, 0.7, 0.3), bar(0.5, false, 'ankles')], view: view(75, 0.7, 3.3) };
}
function lyingCurl() {
  const base = { pelvis: [0, 0.6, 0], pr: 90, hand: [0.2, 0.45, 0.75], ep: [0.6, -1, 0], kp: [0, -1, 0] };
  return { keys: [{ ...base, foot: [0.1, 0.58, -0.92], toe: [0, -1, -0.2] }, { ...base, foot: [0.1, 0.98, -0.42], toe: [0, 0.3, -1] }], props: [{ t: 'box', p: [0, 0.46, 0.15], s: [0.36, 0.1, 1.3], c: 'pad' }, { t: 'box', p: [0, 0.2, 0.15], s: [0.1, 0.42, 0.6], c: 'metal' }, bar(0.5, false, 'ankles')], view: view(100, 0.6, 3.4, 16) };
}
function nordic() {
  const c = { foot: [0.1, 0.07, -0.44], kp: [0, -1, 1], toe: [0, -0.3, -1], ep: [0.5, 0, -1] };
  const a = { ...c, pelvis: [0, 0.55, 0], pr: 0 }; a.hand = cp(a, [0.2, 0.2, 0.22]);
  return { keys: [a, { ...c, pelvis: [0, 0.36, 0.38], pr: 62, hand: [0.22, 0.12, 0.78] }], props: [{ t: 'box', p: [0, 0.17, -0.45], s: [0.5, 0.06, 0.12], c: 'pad' }, { t: 'box', p: [0, 0.015, 0], s: [0.5, 0.03, 0.4], c: 'pad' }], view: view(80, 0.5, 3.3, 14) };
}
function hipThrust() {
  const c = { foot: [0.18, 0.07, 0.82], kp: [0, 1, 0.2] };
  const a = { ...c, pelvis: [0, 0.2, 0.22], pr: -45 }; const b = { ...c, pelvis: [0, 0.52, 0.3], pr: -88 };
  for (const k of [a, b]) k.hand = [0.3, k.pelvis[1] + 0.1, k.pelvis[2]];
  return { keys: [a, b], props: [{ t: 'box', p: [0, 0.36, -0.3], s: [1.0, 0.08, 0.3], c: 'pad' }, { t: 'box', p: [0, 0.16, -0.3], s: [0.8, 0.32, 0.06], c: 'metal' }, bar(1.9, true, 'hips')], view: view(70, 0.5, 3.6, 14) };
}
function kickback() {
  const c = { pelvis: [0, 0.98, 0], pr: 35, hand: [0.2, 1.05, 0.62], foot: [0.1, 0.07, 0], kpR: [0, 0, 1] };
  return { keys: [{ ...c, footR: [-0.1, 0.09, 0.1] }, { ...c, footR: [-0.1, 0.5, -0.72], toeR: [0, -1, 0] }], props: [{ t: 'cyl', a: [-0.4, 1.05, 0.64], b: [0.4, 1.05, 0.64], r: 0.02, c: 'metal' }, post(0, 0.9, 1.3), { t: 'cable', from: [0, 0.1, 0.88], to: 'anR' }], view: view(-100, 0.8, 3.7) };
}
function donkey() {
  const c = { pelvis: [0, 0.5, -0.2], pr: 90, hand: [0.2, 0.03, 0.26], foot: [0.1, 0.07, -0.72], kp: [0, -1, 0.3], toe: [0, -0.2, -1] };
  return { keys: [{ ...c }, { ...c, footR: [-0.1, 0.93, -0.6], kpR: [0, -1, -0.6], toeR: [0, 0, -1] }], props: [], view: view(-100, 0.45, 3.2, 14) };
}
function calf(seated = false) {
  if (seated) { const c = { ...SEATED, hand: [0.2, 0.66, 0.4], kp: [0, 1, 0.3] }; return { keys: [{ ...c, foot: [0.12, 0.07, 0.42] }, { ...c, foot: [0.12, 0.16, 0.42], toe: [0, -0.45, 0.9] }], props: [...seat(0.45), { t: 'box', p: [0, 0.64, 0.4], s: [0.5, 0.07, 0.14], c: 'pad' }], view: view(75, 0.6, 3.1), period: 2000 }; }
  return { keys: [{ pelvis: [0, 0.99, 0], hand: HANG }, { pelvis: [0, 1.09, 0.02], foot: [0.1, 0.17, 0], toe: [0, -0.5, 0.87], hand: [0.27, 1.02, 0.03] }], props: [], view: view(75, 0.8, 3.7), period: 2000 };
}
function plank() {
  const c = { pr: 80, hand: [0.18, 0.05, 0.5], ep: [0, -1, -0.2], foot: [0.1, 0.19, -1.02], toe: [0, -1, 0.1], kp: [0, 1, 0] };
  return { keys: [{ ...c, pelvis: [0, 0.33, -0.2] }, { ...c, pelvis: [0, 0.345, -0.2] }], props: [], view: view(75, 0.3, 3.2, 14), period: 3200 };
}
function cableCrunch() {
  const c = { foot: [0.1, 0.07, -0.44], kp: [0, -1, 1], toe: [0, -0.3, -1], ep: [1, -0.3, 0.3] };
  const a = { ...c, pelvis: [0, 0.55, 0], pr: 10 }; const b = { ...c, pelvis: [0, 0.5, -0.06], pr: 35, spine: 60 };
  for (const k of [a, b]) k.hand = cp(k, [0.12, 0.47, 0.1]);
  return { keys: [a, b], props: [post(0, 0.5), { t: 'cable', from: [0, 2.2, 0.47], to: 'mid' }], view: view(75, 0.7, 3.6) };
}
function legRaise(hanging = false) {
  if (hanging) { const c = { hand: [0.3, 2.1, 0], pelvis: [0, 1.13, 0], kp: [0, 0.3, 1] }; return { keys: [{ ...c, foot: [0.1, 0.26, 0.03] }, { ...c, pr: -15, foot: [0.1, 1.08, 0.8] }], props: [{ t: 'cyl', a: [-0.65, 2.1, 0], b: [0.65, 2.1, 0], r: 0.02, c: 'metal' }, post(0.65, 0, 2.1), post(-0.65, 0, 2.1)], view: view(65, 1.2, 4.3) }; }
  const c = { pelvis: [0, 0.12, 0], pr: -90, hand: [0.27, 0.06, 0.08], kp: [0, 1, 0] };
  return { keys: [{ ...c, foot: [0.1, 0.12, 0.9], toe: [0, 1, 0.2] }, { ...c, foot: [0.1, 0.98, 0.12], toe: [0, 0.2, -1] }], props: [], view: view(75, 0.35, 3.2, 16) };
}
function abWheel() {
  const c = { foot: [0.1, 0.07, -0.44], kp: [0, -1, 1], toe: [0, -0.3, -1] };
  return { keys: [{ ...c, pelvis: [0, 0.56, -0.05], pr: 60, hand: [0.1, 0.2, 0.47] }, { ...c, pelvis: [0, 0.36, 0.3], pr: 82, hand: [0.1, 0.1, 1.25] }], props: [{ t: 'rod', at: 'hands', len: 0.4, plates: true, wheel: true }], view: view(75, 0.35, 3.4, 14) };
}
function adduction() {
  const c = { pelvis: [0, 0.6, 0], pr: -15, hand: [0.26, 0.55, 0.1] };
  return { keys: [{ ...c, foot: [0.45, 0.2, 0.42], kp: [1, 0.8, 0.6] }, { ...c, foot: [0.13, 0.2, 0.5], kp: [0.1, 1, 0.5] }], props: [...seat(0.5, 0.05), torsoPad(c, -1, 0.7, 0.3)], view: view(20, 0.65, 3.3, 18) };
}

function wristCurl(reverse = false) {
  // seated, forearms resting on the thighs, only the fist moves around the wrist
  const base = { ...SEATED, pelvis: [0, 0.55, 0], pr: 32, hand: [0.13, 0.63, 0.5], ep: [0.4, 0.3, -1] };
  const down = { ...base, grip: [0, -0.07, 0.045] }; const up = { ...base, grip: [0, 0.06, 0.055] };
  return { keys: [down, up], props: [...seat(0.45), bar(1.1)], view: view(reverse ? 40 : 55, 0.7, 2.9, 20), period: 2200 };
}
function farmers() {
  // a carry: the walk itself is not animated, the figure marches on the spot under load
  const c = { hand: [0.3, 0.9, 0.02], shrug: 0.01 };
  return { keys: [{ ...c, foot: [0.11, 0.07, 0.12], footR: [-0.11, 0.2, -0.12], kpR: [0, 0, 1] }, { ...c, foot: [0.11, 0.2, -0.12], footR: [-0.11, 0.07, 0.12] }], props: [{ t: 'db', axis: 'z' }], view: view(55, 1.0, 3.8), period: 1400 };
}

/** library id → movement builder */
export const MOVES = Object.freeze({
  ex1: () => press({ eq: 'bar' }), ex3: () => press({ incl: -15, eq: 'bar' }), exFDP: () => press({ eq: 'db' }), ex2: () => press({ incl: 30, eq: 'db' }), exLID: () => press({ incl: 15, eq: 'db' }),
  ex35: () => press({ eq: 'bar', grip: 0.13 }), exMDP: machinePress, ex6: pushup, ex7: () => dips(22), ex39: () => dips(4), ex5: flyLying, ex8: () => pecDeck(false), ex4: crossover,
  exRPD: () => pecDeck(true), ex25: rearFly, ex24: facePull,
  ex21: () => ohp({ eq: 'bar' }), ex22: () => ohp({ seated: true, eq: 'db' }), ex26: () => ohp({ seated: true, eq: 'db' }), ex23: () => lateral(false), ex27: () => lateral(true), ex28: uprightRow, ex71: () => shrug('bar'), ex72: () => shrug('db'),
  ex13: () => rowBent(), ex16: () => rowBent(), exCSTB: () => rowBent({ support: true }), ex17: () => rowBent({ one: true }), ex15: cableRow, ex14: pulldown, ex12: pullup, exWPU: pullup, ex18: straightArm,
  ex11: () => deadlift(), ex47: () => deadlift({ rdl: true }), ex46c: () => deadlift({ sumo: true }), ex20: hyper,
  ex29: () => curl({ eq: 'bar' }), ex34b: () => curl({ eq: 'bar' }), ex82: () => curl({ eq: 'bar' }), ex30: () => curl({ eq: 'hammer' }), ex33: () => curl({ eq: 'cable' }), exBAY: () => curl({ eq: 'cable', kind: 'behind' }),
  ex31: () => curl({ eq: 'db', kind: 'incline' }), ex32: () => curl({ eq: 'bar', kind: 'preacher' }), exSPC: () => curl({ eq: 'db', kind: 'preacher' }),
  ex36: () => pushdown(true), ex40: () => pushdown(false), ex37: () => overheadExt(), exOCT: () => overheadExt({ cable: true }), exROE: () => overheadExt({ cable: true }), ex38: skull,
  ex41: () => squat(), ex41b: () => squat({ front: true }), ex45b: () => squat({ machine: true }), ex43: legPress, ex42: splitSquat, ex44: () => legMachine(false), ex48: () => legMachine(true), ex45: lyingCurl, ex49: nordic, ex50: nordic,
  ex46: hipThrust, exMHT: hipThrust, ex46b: kickback, ex46d: donkey, ex51: () => calf(false), ex53: () => calf(false), ex52: () => calf(true),
  ex81: () => wristCurl(false), exRWC: () => wristCurl(true), exFW: farmers,
  ex61: plank, exWPL: plank, ex62: cableCrunch, ex63: () => legRaise(false), ex65: () => legRaise(true), ex64: abWheel, exADD: adduction,
});

export const hasMove = (id) => Object.prototype.hasOwnProperty.call(MOVES, id);
export const moveFor = (id) => (hasMove(id) ? MOVES[id]() : null);

/** Fine / coarse muscle names used by the library → the mannequin's muscle pads. */
export const PADS_OF = Object.freeze({
  'صدر': ['pec'], 'لات': ['lat'], 'ظهر علوي': ['upback', 'trap'], 'ظهر': ['lat', 'upback'], 'ظهر سفلي': ['lowback'], 'ترابيس': ['trap'],
  'كتف أمامي': ['deltF'], 'كتف جانبي': ['deltS'], 'كتف خلفي': ['deltR'], 'كتف': ['deltF', 'deltS'],
  'باي': ['bi'], 'تراي': ['tri'], 'ساعد': ['fore'],
  'كوادز': ['quad'], 'رجل': ['quad'], 'هامسترينج': ['ham'], 'رجل خلفي': ['ham'], 'مؤخرة': ['glute'], 'ضامة': ['add'], 'سمانة': ['calf'],
  'بطن': ['abs'], 'جوانب': ['obl'],
});
/** {prime, synergists} (exercises.js › fineOf) → {primary: Set, secondary: Set} of pad names. */
export function padsFor(fine) {
  const primary = new Set((fine && PADS_OF[fine.prime]) || []);
  const secondary = new Set();
  for (const m of (fine && fine.synergists) || []) for (const p of PADS_OF[m] || []) if (!primary.has(p)) secondary.add(p);
  return { primary, secondary };
}
export { DIM };

// ───── common mistakes per movement family (shown under the mannequin) ─────
const FAM = {
  press: 'ex1 ex3 exFDP ex2 exLID ex35 exMDP', pushup: 'ex6', dips: 'ex7 ex39', fly: 'ex5 ex8 ex4', rear: 'exRPD ex25 ex24', ohp: 'ex21 ex22 ex26', lateral: 'ex23 ex27', upright: 'ex28', shrug: 'ex71 ex72',
  row: 'ex13 ex16 exCSTB ex17 ex15', pull: 'ex14 ex12 exWPU', sarm: 'ex18', dead: 'ex11 ex46c', rdl: 'ex47', hyper: 'ex20', curl: 'ex29 ex34b ex82 ex30 ex33 exBAY ex31 ex32 exSPC', push: 'ex36 ex40', oext: 'ex37 exOCT exROE ex38',
  wrist: 'ex81 exRWC', carry: 'exFW', squat: 'ex41 ex41b ex45b', legpress: 'ex43', split: 'ex42', legext: 'ex44', legcurl: 'ex48 ex45', nordic: 'ex49 ex50', thrust: 'ex46 exMHT', kick: 'ex46b ex46d', calf: 'ex51 ex53 ex52', plank: 'ex61 exWPL', crunch: 'ex62', legraise: 'ex63 ex65', wheel: 'ex64', add: 'exADD',
};
const MISTAKES = {
  press: ['الكوع مفتوح 90° على الجنب: خليه حوالي 45° من جسمك', 'الوزن بيرتد من على الصدر بدل ما ينزل بتحكم', 'الكتف بيطلع لقدام في آخر الدفعة: ثبّت لوح الكتف في البنش', 'المؤخرة بتتشال من على البنش'],
  pushup: ['الوسط بيهبط أو المؤخرة بتعلى: الجسم خط واحد', 'الكوع مفتوح على الجنب بدل 45°', 'نص حركة: الصدر لازم يقرب من الأرض'],
  dips: ['نزول أعمق من اللي كتفك يستحمله', 'الكتف بيترفع ناحية الودن', 'مرجحة بالرجلين عشان تطلع'],
  fly: ['الدراع مفرود على الآخر: خلي الكوع مثني خفيف وثابت', 'الحركة بتتحول ضغط (الكوع بيتني ويفرد)', 'فتح زيادة عن مستوى الكتف'],
  rear: ['الحركة جاية من الترابيس وشد الكتف لفوق', 'مرجحة بالجسم', 'وزن تقيل بيخلي الكوع يتني وتبقى تجديف'],
  ohp: ['تقويس الضهر السفلي: شد البطن والمؤخرة', 'البار بيلف حوالين الراس بدل ما يطلع خط مستقيم', 'الكوع ورا البار بدل ما يكون تحته'],
  lateral: ['مرجحة بالجسم عشان الوزن يطلع', 'الإيد بتعلى عن الكوع أو فوق مستوى الكتف', 'الترابيس بتشيل: نزّل كتفك بعيد عن ودنك'],
  upright: ['الإيد أعلى من الكوع', 'السحب لحد الدقن بقبضة ضيقة (ضغط على الكتف): قبضة أوسع ولحد الصدر', 'مرجحة بالضهر'],
  shrug: ['لف الكتف في دايرة: الحركة لفوق ولتحت بس', 'تني الكوع عشان الوزن يطلع', 'الراس بتطلع لقدام'],
  row: ['الضهر متقوّس لفوق بدل ما يكون مفرود', 'مرجحة بالجسم كله', 'السحب بالدراع بس: ابدأ بضم لوح الكتف', 'الكوع بيفتح بعيد عن الجسم'],
  pull: ['مرجحة وميل للخلف زيادة', 'نص حركة من فوق: افرد دراعك في الآخر', 'الكتف مرفوع ناحية الودن في بداية الشد', 'السحب ورا الرقبة'],
  sarm: ['الكوع بيتني فتبقى ترايسبس', 'الحركة من الوسط بدل الكتف', 'الكتف بيترفع'],
  dead: ['الضهر متقوّس (مدوّر): شد البطن وافرد الضهر قبل ما ترفع', 'البار بعيد عن الرجل', 'الوسط بيطلع قبل الصدر', 'شد بالدراع أو ميل للخلف في القفلة'],
  rdl: ['تدوير الضهر السفلي', 'تني الركبة زيادة فتبقى سكوات', 'البار بيبعد عن الرجل', 'نزول أبعد من مرونة الهامسترينج'],
  hyper: ['تقويس الضهر زيادة في الآخر: وقّف والجسم خط واحد', 'مرجحة سريعة', 'الحركة من الضهر بدل مفصل الورك'],
  curl: ['الكوع بيتحرك لقدام مع الرفعة', 'مرجحة بالضهر', 'نزول سريع من غير تحكم', 'الرسغ مثني لورا'],
  push: ['الكوع بيبعد عن الجنب ويتحرك', 'ميل بالجسم كله على الوزن', 'نص حركة من غير فرد كامل'],
  oext: ['الكوع بيفتح للجنب', 'تقويس الضهر السفلي', 'الحركة من الكتف بدل الكوع'],
  squat: ['الركبة بتدخل لجوه: ادفعها ناحية صوابع الرجل', 'الكعب بيتشال من الأرض', 'الضهر السفلي بيتدوّر في القاع', 'الصدر بيقع لقدام والوسط بيطلع الأول'],
  legpress: ['المؤخرة بتتشال من الكرسي في آخر النزول', 'قفل الركبة بعنف فوق', 'الركبة بتدخل لجوه'],
  split: ['الركبة الأمامية بتدخل لجوه', 'الوزن على الرجل الخلفية بدل الأمامية', 'خطوة قصيرة بتطلّع الكعب'],
  legext: ['حدف الوزن بسرعة', 'المؤخرة بتتشال من الكرسي', 'نزول سريع من غير تحكم'],
  legcurl: ['الوسط بيتشال عشان يساعد', 'نص حركة', 'رجوع سريع من غير تحكم'],
  nordic: ['الوسط بيتني (المؤخرة لورا): الجسم خط واحد من الركبة للكتف', 'وقوع سريع من غير مقاومة'],
  thrust: ['تقويس الضهر السفلي بدل قفل المؤخرة', 'الرجل بعيدة أو قريبة: الساق عمودية فوق', 'الدقن مرفوعة: بص لقدام'],
  kick: ['تقويس الضهر عشان الرجل تعلى', 'مرجحة سريعة', 'لف الحوض للجنب'],
  calf: ['نص حركة ونطنطة سريعة', 'مفيش وقفة فوق ولا شد تحت', 'تني الركبة في الواقف'],
  plank: ['الوسط بيهبط', 'المؤخرة مرفوعة', 'الراس واقعة أو مرفوعة: بص للأرض', 'كتم النفس'],
  crunch: ['الشد بالدراع بدل البطن', 'الحركة من الورك (المؤخرة لورا) بدل لف الضهر', 'وزن تقيل بيشيلك'],
  legraise: ['تقويس الضهر السفلي', 'مرجحة', 'الحركة من عضلة الورك بس من غير لف الحوض في الآخر'],
  wheel: ['الوسط بيهبط والضهر بيتقوّس', 'مدى أبعد من اللي بطنك يتحكم فيه', 'الرجوع بالدراع بدل البطن'],
  wrist: ['الساعد بيتشال من على الفخذ: ثبّته والحركة من الرسغ بس', 'مدى قصير: انزل لآخر الرسغ واطلع لآخره', 'وزن تقيل بيخلي الكوع يشارك'],
  carry: ['ميل بالجسم على جنب', 'الكتف واقع لقدام: صدرك مفتوح وكتفك لورا', 'خطوات طويلة سريعة: خطوات قصيرة ثابتة'],
  add: ['حدف الوزن وارتداده', 'المؤخرة بتتشال من الكرسي', 'مدى أوسع من مرونتك'],
};
const FAM_OF = Object.fromEntries(Object.entries(FAM).flatMap(([f, ids]) => ids.split(' ').map((id) => [id, f])));
/** Common mistakes for a library id ([] when the movement has none listed). */
export const mistakesFor = (id) => MISTAKES[FAM_OF[id]] || [];

/** Movement family → key of the coaching content (content.js › FORM_PHASES) that really is about this movement. */
const CONTENT_KEY = { press: 'بنش', squat: 'سكوات', dead: 'ديدليفت', ohp: 'أوفرهيد', row: 'رو', curl: 'كيرل', push: 'تراي', oext: 'تراي', pull: 'لات', fly: 'فلاي', lateral: 'كتف جانب', crunch: 'بطن', legext: 'رجل أمامي', legcurl: 'رجل خلفي', calf: 'سمانة', shrug: 'شراغز', thrust: 'هيب ثرست', plank: 'بلانك' };
export const contentKeyFor = (id) => (id === 'ex24' ? 'فيس بول' : CONTENT_KEY[FAM_OF[id]] || null);
