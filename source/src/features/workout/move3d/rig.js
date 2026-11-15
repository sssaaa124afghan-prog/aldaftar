// 3D mannequin maths (pure, no rendering): a pose is a handful of targets (pelvis, torso pitch, where the hands and
// ankles are) and solve() returns every joint position, using two-bone IK for arms and legs. Units ≈ metres, Y up,
// the figure faces +Z and its LEFT side is +X. Left-side values mirror to the right unless a pose gives the R one.
export const DIM = Object.freeze({ UA: 0.29, FA: 0.27, TH: 0.44, SH: 0.44, WAIST: 0.16, SHY: 0.30, SHX: 0.2, HIPX: 0.095, HIPY: -0.05, NECK: 0.36, HEAD: 0.5, ANKLE: 0.07, FOOT: 0.2 });

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
  mx: (a) => [-a[0], a[1], a[2]],
};
const rad = (d) => (d * Math.PI) / 180;

export const DEFAULT_POSE = Object.freeze({
  pelvis: [0, 1, 0], pr: 0, yaw: 0, spine: 0, shrug: 0,
  hand: [0.27, 0.92, 0.03], ep: [0.3, 0, -1], grip: [0, 0, 0], // grip = where the fist sits relative to the wrist (wrist curls)
  foot: [0.11, 0.07, 0], kp: [0, 0, 1], toe: [0, 0, 1],
});
/** Fill a partial pose with the standing defaults. */
export const pose = (o = {}) => ({ ...DEFAULT_POSE, ...o });

/** Body frame for a pitch (deg, + = lean forward) and yaw: u = up the spine, f = out of the chest, r = to the left side. */
export function frame(pitch, yaw = 0) {
  const p = rad(pitch); const y = rad(yaw);
  const fwd = [Math.sin(y), 0, Math.cos(y)];
  const u = V.add(V.mul([0, 1, 0], Math.cos(p)), V.mul(fwd, Math.sin(p)));
  const f = V.add(V.mul([0, 1, 0], -Math.sin(p)), V.mul(fwd, Math.cos(p)));
  return { u, f, r: V.cross(u, f) };
}
const at = (o, fr, c) => V.add(o, V.add(V.mul(fr.r, c[0]), V.add(V.mul(fr.u, c[1]), V.mul(fr.f, c[2]))));

/** World position of a point given in chest space [left, up the spine from the waist, out of the chest]. */
export function chestPoint(p0, c) {
  const p = pose(p0);
  const pf = frame(p.pr, p.yaw);
  return at(V.add(p.pelvis, V.mul(pf.u, DIM.WAIST)), frame(p.pr + p.spine, p.yaw), c);
}
/** World position of the left (side = 1) or right (−1) shoulder joint. */
export const shoulder = (p0, side = 1) => chestPoint(p0, [DIM.SHX * side, DIM.SHY, 0]);

/**
 * Two-bone IK: root a, target t, bone lengths l1 + l2, pole = the way the middle joint should point.
 * → {mid, end, bend}: end is the target pulled inside reach; bend is the unit vector from the a–end line to the middle joint.
 */
export function ik(a, t, l1, l2, pole) {
  let d = V.sub(t, a); let L = V.len(d);
  const max = l1 + l2 - 1e-4; const min = Math.abs(l1 - l2) + 1e-4;
  if (L < 1e-6) { d = [0, -1, 0]; L = min; }
  const dir = V.norm(d);
  const Lc = Math.max(min, Math.min(max, L));
  let b = V.sub(pole, V.mul(dir, V.dot(pole, dir)));
  if (V.len(b) < 1e-4) { b = V.cross(dir, [1, 0, 0]); if (V.len(b) < 1e-4) b = V.cross(dir, [0, 0, 1]); }
  b = V.norm(b);
  const cos = (l1 * l1 + Lc * Lc - l2 * l2) / (2 * l1 * Lc);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  return { mid: V.add(a, V.add(V.mul(dir, l1 * cos), V.mul(b, l1 * sin))), end: V.add(a, V.mul(dir, Lc)), bend: b };
}

/** All joints of a pose. bend* = which way the elbow / knee sticks out (muscle pads are placed from it). */
export function solve(p0) {
  const p = pose(p0);
  const pf = frame(p.pr, p.yaw); const cf = frame(p.pr + p.spine, p.yaw);
  const waist = V.add(p.pelvis, V.mul(pf.u, DIM.WAIST));
  const J = { pelvis: p.pelvis, waist, neck: at(waist, cf, [0, DIM.NECK, 0]), head: at(waist, cf, [0, DIM.HEAD, 0.015]), chest: at(waist, cf, [0, 0.17, 0]) };
  const B = {};
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const sh = at(waist, cf, [DIM.SHX * s, DIM.SHY + p.shrug, 0]);
    const hip = at(p.pelvis, pf, [DIM.HIPX * s, DIM.HIPY, 0]);
    const hand = p[`hand${k}`] || (s === 1 ? p.hand : V.mx(p.hand));
    const ep = p[`ep${k}`] || (s === 1 ? p.ep : V.mx(p.ep));
    const foot = p[`foot${k}`] || (s === 1 ? p.foot : V.mx(p.foot));
    const kp = p[`kp${k}`] || (s === 1 ? p.kp : V.mx(p.kp));
    const toe = p[`toe${k}`] || (s === 1 ? p.toe : V.mx(p.toe));
    const arm = ik(sh, hand, DIM.UA, DIM.FA, ep);
    const leg = ik(hip, foot, DIM.TH, DIM.SH, kp);
    const grip = p[`grip${k}`] || (s === 1 ? p.grip : V.mx(p.grip));
    J[`sh${k}`] = sh; J[`el${k}`] = arm.mid; J[`wr${k}`] = arm.end; J[`ha${k}`] = V.add(arm.end, grip);
    J[`hip${k}`] = hip; J[`kn${k}`] = leg.mid; J[`an${k}`] = leg.end;
    J[`toe${k}`] = V.add(leg.end, V.mul(V.norm(toe), DIM.FOOT));
    B[`arm${k}`] = arm.bend; B[`leg${k}`] = leg.bend;
  }
  return { J, B, pf, cf };
}

const isVec = (v) => Array.isArray(v) && v.length === 3;
/** Blend two poses (every vector and number in either one; missing fields come from the defaults). */
export function mix(a0, b0, t) {
  const a = pose(a0); const b = pose(b0); const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] !== undefined ? a[k] : mirrorOf(a, k); const y = b[k] !== undefined ? b[k] : mirrorOf(b, k);
    out[k] = isVec(x) ? V.lerp(x, y, t) : x + (y - x) * t;
  }
  return out;
}
// a pose that sets handR on one key only: the other key's value is the mirror of its left-side target
function mirrorOf(p, k) { const base = k.slice(0, -1); return k.endsWith('R') && p[base] !== undefined ? V.mx(p[base]) : k.endsWith('L') ? p[base] : undefined; }

/** Pose at t ∈ [0,1] along a list of keyframes (2 = straight, 3 = through the middle one). */
export function along(keys, t) {
  const n = keys.length - 1;
  if (n <= 0) return pose(keys[0]);
  const x = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return mix(keys[i], keys[i + 1], x - i);
}
/** Smooth start and stop. */
export const ease = (t) => t * t * (3 - 2 * t);
