// Three.js mannequin for the movement viewer. Everything is placed from the joint positions rig.js › solve() returns:
// bones are cylinders between joints, muscles are ellipsoid pads that light up for the target muscles.
// Loaded only when a viewer opens (dynamic import from sheet.js).
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Mesh, MeshStandardMaterial, MeshBasicMaterial,
  SphereGeometry, CylinderGeometry, BoxGeometry, CircleGeometry, Vector3, Quaternion, Matrix4, Color,
} from 'three';
import { solve, along, V } from './rig.js';

const UP = new Vector3(0, 1, 0);
const v3 = (a) => new Vector3(a[0], a[1], a[2]);
const perp = (v, axis) => V.sub(v, V.mul(axis, V.dot(v, axis)));

export const PALETTE = {
  light: { body: '#D9DDE6', pad: '#C6CBD6', joint: '#B9BFCC', primary: '#FF4A1C', secondary: '#FFB24D', metal: '#5B6475', cushion: '#2F3644', floor: '#1B2233', cable: '#3A4252' },
  dark: { body: '#8792A6', pad: '#7A859A', joint: '#6B768B', primary: '#FF5A2E', secondary: '#FFC062', metal: '#B9C2D3', cushion: '#3A4458', floor: '#FFFFFF', cable: '#C5CDDB' },
};

/**
 * createViewer(canvas, {move, primary: Set, secondary: Set, scheme: 'light'|'dark'})
 * → {setT(t 0..1), rotate(dYaw, dPitch), resize(), render(), dispose()}
 */
export function createViewer(canvas, { move, primary = new Set(), secondary = new Set(), scheme = 'light' } = {}) {
  const C = PALETTE[scheme] || PALETTE.light;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 30);
  scene.add(new HemisphereLight(0xffffff, scheme === 'dark' ? 0x1b2233 : 0x9aa3b5, 1.15));
  const sun = new DirectionalLight(0xffffff, 1.7); sun.position.set(2.2, 4, 3); scene.add(sun);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  const mat = (hex, rough = 0.62) => keep(new MeshStandardMaterial({ color: new Color(hex), roughness: rough, metalness: 0.02 }));
  const M = { body: mat(C.body), pad: mat(C.pad), joint: mat(C.joint), primary: mat(C.primary, 0.45), secondary: mat(C.secondary, 0.5), metal: mat(C.metal, 0.4), cushion: mat(C.cushion, 0.8), cable: mat(C.cable, 0.5) };
  const G = { cyl: keep(new CylinderGeometry(1, 1, 1, 18)), sph: keep(new SphereGeometry(1, 22, 16)), box: keep(new BoxGeometry(1, 1, 1)), disc: keep(new CircleGeometry(1, 40)) };
  const padMat = (name) => (primary.has(name) ? M.primary : secondary.has(name) ? M.secondary : M.pad);

  // ground + soft contact shadow
  const floor = new Mesh(G.disc, keep(new MeshBasicMaterial({ color: new Color(C.floor), transparent: true, opacity: scheme === 'dark' ? 0.07 : 0.05, depthWrite: false })));
  floor.rotation.x = -Math.PI / 2; floor.scale.setScalar(1.7); scene.add(floor);
  const blob = new Mesh(G.disc, keep(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false })));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.002; scene.add(blob);

  const q = new Quaternion(); const m4 = new Matrix4();
  const mk = (geo, m) => { const x = new Mesh(geo, m); scene.add(x); return x; };
  function placeSeg(mesh, a, b, r) {
    const d = V.sub(b, a); const L = V.len(d) || 1e-6;
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    mesh.quaternion.setFromUnitVectors(UP, v3(V.mul(d, 1 / L)));
    mesh.scale.set(r, L, r);
  }
  const basisQuat = (fr) => q.setFromRotationMatrix(m4.makeBasis(v3(fr.r), v3(fr.u), v3(fr.f)));
  function placeBlob(mesh, pos, fr, s) { mesh.position.set(pos[0], pos[1], pos[2]); mesh.quaternion.copy(basisQuat(fr)); mesh.scale.set(s[0], s[1], s[2]); }
  const inFrame = (o, fr, c) => V.add(o, V.add(V.mul(fr.r, c[0]), V.add(V.mul(fr.u, c[1]), V.mul(fr.f, c[2]))));

  // ───── body ─────
  const BONES = [['shL', 'elL', 0.05], ['elL', 'wrL', 0.041], ['shR', 'elR', 0.05], ['elR', 'wrR', 0.041], ['wrL', 'haL', 0.036], ['wrR', 'haR', 0.036], ['hipL', 'knL', 0.074], ['knL', 'anL', 0.054], ['hipR', 'knR', 0.074], ['knR', 'anR', 0.054],
    ['anL', 'toeL', 0.04], ['anR', 'toeR', 0.04], ['shL', 'shR', 0.055], ['hipL', 'hipR', 0.07]];
  const bones = BONES.map(([a, b, r]) => ({ a, b, r, mesh: mk(G.cyl, M.body) }));
  const neck = mk(G.cyl, M.body);
  const JOINTS = [['shL', 0.062], ['shR', 0.062], ['elL', 0.048], ['elR', 0.048], ['haL', 0.052], ['haR', 0.052], ['hipL', 0.082], ['hipR', 0.082], ['knL', 0.06], ['knR', 0.06], ['anL', 0.046], ['anR', 0.046], ['toeL', 0.04], ['toeR', 0.04]];
  const joints = JOINTS.map(([k, r]) => { const mesh = mk(G.sph, M.joint); mesh.scale.setScalar(r); return { k, mesh }; });
  const head = mk(G.sph, M.body); const pelvisB = mk(G.sph, M.body); const belly = mk(G.sph, M.body); const ribs = mk(G.sph, M.body);

  // ───── muscle pads ─────
  const torsoPads = [
    ['pec', 'c', [0.085, 0.215, 0.105], [0.085, 0.065, 0.042]], ['pec', 'c', [-0.085, 0.215, 0.105], [0.085, 0.065, 0.042]],
    ['abs', 'c', [0, 0.03, 0.096], [0.075, 0.125, 0.035]], ['obl', 'c', [0.135, 0.02, 0.03], [0.04, 0.11, 0.07]], ['obl', 'c', [-0.135, 0.02, 0.03], [0.04, 0.11, 0.07]],
    ['lat', 'c', [0.135, 0.14, -0.075], [0.062, 0.135, 0.05]], ['lat', 'c', [-0.135, 0.14, -0.075], [0.062, 0.135, 0.05]],
    ['upback', 'c', [0, 0.21, -0.108], [0.13, 0.075, 0.035]], ['trap', 'c', [0, 0.335, -0.06], [0.115, 0.05, 0.055]],
    ['lowback', 'p', [0, 0.13, -0.088], [0.085, 0.09, 0.035]], ['glute', 'p', [0.08, -0.03, -0.088], [0.082, 0.088, 0.066]], ['glute', 'p', [-0.08, -0.03, -0.088], [0.082, 0.088, 0.066]],
  ].map(([name, fr, c, s]) => ({ name, fr, c, s, mesh: mk(G.sph, padMat(name)) }));
  const delts = [];
  for (const side of [1, -1]) for (const [name, c, s] of [['deltF', [0.012, 0, 0.05], [0.05, 0.055, 0.05]], ['deltS', [0.05, 0.015, 0], [0.045, 0.058, 0.052]], ['deltR', [0.012, 0, -0.05], [0.05, 0.055, 0.05]]]) {
    delts.push({ name, side, c: [c[0] * side, c[1], c[2]], s, mesh: mk(G.sph, padMat(name)) });
  }
  const limbPads = [];
  for (const k of ['L', 'R']) {
    limbPads.push({ name: 'bi', k, kind: 'bi', mesh: mk(G.sph, padMat('bi')) }, { name: 'tri', k, kind: 'tri', mesh: mk(G.sph, padMat('tri')) }, { name: 'fore', k, kind: 'fore', mesh: mk(G.sph, padMat('fore')) },
      { name: 'quad', k, kind: 'quad', mesh: mk(G.sph, padMat('quad')) }, { name: 'ham', k, kind: 'ham', mesh: mk(G.sph, padMat('ham')) }, { name: 'add', k, kind: 'add', mesh: mk(G.sph, padMat('add')) }, { name: 'calf', k, kind: 'calf', mesh: mk(G.sph, padMat('calf')) });
  }
  function placeLimbPad(mesh, a, b, frac, off, offLen, s) {
    const axis = V.norm(V.sub(b, a));
    const pos = V.add(V.lerp(a, b, frac), V.mul(off, offLen));
    mesh.position.set(pos[0], pos[1], pos[2]);
    // orient: Y along the limb, Z toward the offset so the pad bulges outward
    const z = V.len(off) > 1e-6 ? V.norm(perp(off, axis)) : V.norm(perp([0, 0, 1], axis));
    const x = V.cross(axis, z);
    mesh.quaternion.setFromRotationMatrix(m4.makeBasis(v3(x), v3(axis), v3(z)));
    mesh.scale.set(s[0], s[1], s[2]);
  }
  const unitOr = (v, fallback) => (V.len(v) > 0.02 ? V.norm(v) : V.norm(fallback));

  // ───── equipment ─────
  const dyn = [];
  const matOf = (c) => (c === 'pad' ? M.cushion : M.metal);
  for (const p of (move && move.props) || []) {
    if (p.t === 'box') { const b = mk(G.box, matOf(p.c)); b.position.set(p.p[0], p.p[1], p.p[2]); b.scale.set(p.s[0], p.s[1], p.s[2]); if (p.rx) b.rotation.x = (p.rx * Math.PI) / 180; }
    else if (p.t === 'cyl') { placeSeg(mk(G.cyl, matOf(p.c)), p.a, p.b, p.r || 0.02); }
    else if (p.t === 'rod') { const o = { p, bar: mk(G.cyl, M.metal), plates: [] }; if (p.plates) for (let i = 0; i < (p.wheel ? 1 : 2); i++) o.plates.push(mk(G.cyl, M.cushion)); dyn.push(o); }
    else if (p.t === 'db') { const hands = p.at === 'mid' ? ['mid'] : p.only ? [`ha${p.only}`] : ['haL', 'haR']; for (const hk of hands) dyn.push({ p, hk, bar: mk(G.cyl, M.metal), heads: p.small ? [] : [mk(G.sph, M.cushion), mk(G.sph, M.cushion)] }); }
    else if (p.t === 'cable') { dyn.push({ p, bar: mk(G.cyl, M.cable) }); }
    else if (p.t === 'follow') { const b = mk(G.box, M.metal); b.scale.set(p.s[0], p.s[1], p.s[2]); if (p.rx) b.rotation.x = (p.rx * Math.PI) / 180; dyn.push({ p, box: b }); }
  }
  const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  function placeProps(S) {
    const { J, pf, cf } = S;
    const midHands = V.mid(J.haL, J.haR);
    for (const o of dyn) {
      const p = o.p;
      if (p.t === 'rod') {
        let c; let dir;
        if (p.at === 'back') { c = inFrame(J.waist, cf, [0, 0.34, -0.1]); dir = cf.r; }
        else if (p.at === 'front') { c = inFrame(J.waist, cf, [0, 0.3, 0.13]); dir = cf.r; }
        else if (p.at === 'hips') { c = V.add(J.pelvis, V.mul(pf.f, 0.13)); dir = pf.r; }
        else if (p.at === 'ankles') { c = V.mid(J.anL, J.anR); dir = unitOr(V.sub(J.anL, J.anR), [1, 0, 0]); }
        else { c = midHands; dir = unitOr(V.sub(J.haL, J.haR), [1, 0, 0]); }
        const h = p.len / 2;
        placeSeg(o.bar, V.sub(c, V.mul(dir, h)), V.add(c, V.mul(dir, h)), p.at === 'ankles' ? 0.05 : 0.016);
        o.plates.forEach((pl, i) => {
          const at = p.wheel ? c : V.add(c, V.mul(dir, (i ? -1 : 1) * (h - 0.13)));
          placeSeg(pl, V.sub(at, V.mul(dir, 0.025)), V.add(at, V.mul(dir, 0.025)), p.wheel ? 0.1 : 0.2);
        });
      } else if (p.t === 'db') {
        const c = o.hk === 'mid' ? midHands : J[o.hk]; const ax = AX[p.axis] || AX.x; const h = p.small ? 0.07 : 0.085;
        placeSeg(o.bar, V.sub(c, V.mul(ax, h)), V.add(c, V.mul(ax, h)), 0.017);
        o.heads.forEach((hd, i) => { const at = V.add(c, V.mul(ax, (i ? -1 : 1) * h)); hd.position.set(at[0], at[1], at[2]); hd.scale.setScalar(0.052); });
      } else if (p.t === 'cable') {
        placeSeg(o.bar, p.from, p.to === 'mid' ? midHands : J[p.to], 0.007);
      } else if (p.t === 'follow') {
        const c = V.add(p.at === 'feet' ? V.mid(J.anL, J.anR) : midHands, p.off || [0, 0, 0]);
        o.box.position.set(c[0], c[1], c[2]);
      }
    }
  }

  // ───── per-frame placement ─────
  function setT(t) {
    const S = solve(along(move.keys, t));
    const { J, B, pf, cf } = S;
    for (const b of bones) placeSeg(b.mesh, J[b.a], J[b.b], b.r);
    for (const j of joints) j.mesh.position.set(J[j.k][0], J[j.k][1], J[j.k][2]);
    placeSeg(neck, J.neck, J.head, 0.042);
    placeBlob(head, J.head, cf, [0.1, 0.118, 0.108]);
    placeBlob(pelvisB, inFrame(J.pelvis, pf, [0, 0.01, 0]), pf, [0.165, 0.12, 0.115]);
    const mf = { r: pf.r, u: V.norm(V.add(pf.u, cf.u)), f: V.norm(V.add(pf.f, cf.f)) };
    placeBlob(belly, V.lerp(J.pelvis, J.chest, 0.52), mf, [0.14, 0.15, 0.1]);
    placeBlob(ribs, J.chest, cf, [0.186, 0.185, 0.122]);
    for (const p of torsoPads) placeBlob(p.mesh, inFrame(p.fr === 'c' ? J.waist : J.pelvis, p.fr === 'c' ? cf : pf, p.c), p.fr === 'c' ? cf : pf, p.s);
    for (const d of delts) placeBlob(d.mesh, inFrame(J[d.side === 1 ? 'shL' : 'shR'], cf, d.c), cf, d.s);
    for (const lp of limbPads) {
      const k = lp.k; const sh = J[`sh${k}`]; const el = J[`el${k}`]; const ha = J[`wr${k}`]; const hip = J[`hip${k}`]; const kn = J[`kn${k}`]; const an = J[`an${k}`];
      if (lp.kind === 'bi' || lp.kind === 'tri') {
        const axis = V.norm(V.sub(el, sh));
        const inner = unitOr(perp(V.sub(ha, el), axis), V.mul(B[`arm${k}`], -1));
        if (lp.kind === 'bi') placeLimbPad(lp.mesh, sh, el, 0.55, inner, 0.026, [0.04, 0.105, 0.042]);
        else placeLimbPad(lp.mesh, sh, el, 0.5, V.mul(inner, -1), 0.028, [0.043, 0.115, 0.042]);
      } else if (lp.kind === 'fore') {
        placeLimbPad(lp.mesh, el, ha, 0.36, [0, 0, 0], 0, [0.049, 0.1, 0.049]);
      } else if (lp.kind === 'calf') {
        const axis = V.norm(V.sub(an, kn));
        placeLimbPad(lp.mesh, kn, an, 0.3, unitOr(perp(V.sub(hip, kn), axis), V.mul(B[`leg${k}`], -1)), 0.03, [0.052, 0.13, 0.05]);
      } else {
        const axis = V.norm(V.sub(kn, hip));
        const back = unitOr(perp(V.sub(an, kn), axis), V.mul(B[`leg${k}`], -1));
        if (lp.kind === 'quad') placeLimbPad(lp.mesh, hip, kn, 0.52, V.mul(back, -1), 0.034, [0.072, 0.175, 0.058]);
        else if (lp.kind === 'ham') placeLimbPad(lp.mesh, hip, kn, 0.5, back, 0.034, [0.066, 0.165, 0.055]);
        else { let side = V.cross(axis, back); const other = J[k === 'L' ? 'hipR' : 'hipL']; if (V.dot(side, V.sub(other, hip)) < 0) side = V.mul(side, -1); placeLimbPad(lp.mesh, hip, kn, 0.36, side, 0.04, [0.045, 0.14, 0.05]); }
      }
    }
    placeProps(S);
    const feet = V.mid(J.anL, J.anR);
    const lie = Math.hypot(J.head[0] - feet[0], J.head[2] - feet[2]); // how stretched out along the floor the body is
    blob.position.x = (J.head[0] + feet[0]) / 2; blob.position.z = (J.head[2] + feet[2]) / 2;
    blob.scale.set(0.36, 0.36 + lie * 0.42, 1);
  }

  // ───── camera ─────
  const vw = (move && move.view) || { yaw: 35, y: 0.95, dist: 3.6, pitch: 12 };
  let yaw = (vw.yaw * Math.PI) / 180; let pitch = ((vw.pitch || 12) * Math.PI) / 180;
  function aim() {
    const d = (vw.dist || 3.6) * 1.14 * Math.max(1, 1 / (camera.aspect || 1)); const ty = vw.y || 0.95; // a little air around the figure; back off more on tall canvases
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * d, ty + Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
    camera.lookAt(0, ty, 0);
  }
  function rotate(dYaw, dPitch) { yaw += dYaw; pitch = Math.max(-0.15, Math.min(1.2, pitch + dPitch)); aim(); }
  function resize() {
    const w = canvas.clientWidth || 300; const h = canvas.clientHeight || 300;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); aim();
  }
  const render = () => renderer.render(scene, camera);
  function dispose() { for (const d of disposables) d.dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ignore */ } }

  aim(); resize(); setT(0);
  return { setT, rotate, resize, render, dispose };
}
