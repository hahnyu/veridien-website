import { THREE, noise3, hydrogel } from '../anatomy-kit.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* Base anatomy fixed to the tray: the retroperitoneum.
   Kidneys (with hilum, renal pelvis and ureters), adrenals, the abdominal aorta with its
   visceral and renal branches, the IVC with its renal veins, and the iliac vessels.
   Frame: +x patient's left, +y anterior (up off the tray), -z cranial, +z caudal; 1 unit ~ 3.5 cm.
   Vertebral levels used for placement: T12 ~ z -3.0, L1 ~ -2.3, L2 ~ -1.4, L3 ~ -0.4, L4 ~ 0.8,
   aortic bifurcation (L4) at z 1.3. */

const UP = new THREE.Vector3(0, 1, 0);
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/* Vessel: a tube along a smooth curve whose cross-section is an ellipse (flat < 1 flattens it
   front to back, like a vein lying on muscle). Frames follow world-up, so "flat" always squashes
   the anterior-posterior axis. Ends are either rounded (a true hemispherical cap) or buried
   (a flat disc, used where a branch starts inside its parent). */
function vessel(points, { r, flat = () => 1, radial = 12, perUnit = 10, start = 'round', end = 'round' }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const L = curve.getLength();
  const n = Math.max(4, Math.ceil(L * perUnit));
  const ts = [];
  for (let i = 0; i <= n; i++) ts.push(i / n);
  const e0 = start === 'round' ? Math.min(0.45, r(0, L, 0) / L) : 0;
  const e1 = end === 'round' ? Math.min(0.45, r(1, L, 0) / L) : 0;
  for (const f of [0.06, 0.22, 0.45, 0.72]) {
    if (e0) ts.push(e0 * f);
    if (e1) ts.push(1 - e1 * f);
  }
  ts.sort((a, b) => a - b);
  const T = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-4);
  const capR = (t) => {
    let k = 1;
    if (e0 && t < e0) { const e = t / e0; k *= Math.sqrt(Math.max(0, 1 - (1 - e) ** 2)); }
    if (e1 && t > 1 - e1) { const e = (1 - t) / e1; k *= Math.sqrt(Math.max(0, 1 - (1 - e) ** 2)); }
    return k;
  };
  const pos = [];
  const idx = [];
  const P = new THREE.Vector3(), Tg = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const prevN = new THREE.Vector3(0, 0, -1);
  const rings = T.length;
  for (let i = 0; i < rings; i++) {
    const t = T[i];
    curve.getPointAt(t, P);
    curve.getTangentAt(t, Tg);
    N.copy(UP).addScaledVector(Tg, -Tg.dot(UP));
    if (N.length() < 0.25) N.copy(prevN).addScaledVector(Tg, -Tg.dot(prevN));
    N.normalize();
    prevN.copy(N);
    B.crossVectors(Tg, N);
    const k = capR(t);
    const fy = flat(t, L);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const rr = r(t, L, a) * k;
      const c = Math.cos(a) * rr * fy, s = Math.sin(a) * rr;
      pos.push(P.x + c * N.x + s * B.x, P.y + c * N.y + s * B.y, P.z + c * N.z + s * B.z);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = (i + 1) * radial + j;
      const c = (i + 1) * radial + ((j + 1) % radial), d = i * radial + ((j + 1) % radial);
      idx.push(a, d, b, b, d, c);
    }
  }
  const s0 = pos.length / 3;
  curve.getPointAt(0, P); pos.push(P.x, P.y, P.z);
  curve.getPointAt(1, P); pos.push(P.x, P.y, P.z);
  const last = (rings - 1) * radial;
  for (let j = 0; j < radial; j++) {
    idx.push(s0, (j + 1) % radial, j);
    idx.push(s0 + 1, last + j, last + ((j + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Radius helpers: linear taper from a to b, plus an optional flare where a branch leaves its
   parent (s0 = distance from the start to the parent's wall). */
const taper = (a, b, flare = 0, s0 = 0, fl = 0.18) => (t, L) => {
  const s = t * L;
  return (a + (b - a) * t) * (1 + flare * Math.exp(-Math.max(0, s - s0) / fl));
};

/* Kidney: a bean with a real hilum. Built on a latitude/longitude sphere whose poles are the
   renal poles; the medial border is hollowed and opened into a slit-like hilum with lips in
   front and behind. place(X, Y, L) maps kidney-local points (lateral, anterior, caudal) to the
   tray, so vessels and the renal pelvis can be aimed into the sinus. */
function kidney({ side, center, len, wid, thick, roll, yaw, pitch, hilum = 0.08, seed = 0 }) {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let lift = 0;
  const place = (X, Y, L) => {
    const x0 = (X * cr + Y * sr) * side, y0 = -X * sr + Y * cr;
    const x1 = x0 * cy + side * L * sy, z1 = -side * x0 * sy + L * cy;
    const y2 = y0 * cp + z1 * sp, z2 = -y0 * sp + z1 * cp;
    return [center[0] + x1, center[1] + y2 + lift, center[2] + z2];
  };
  let g = new THREE.SphereGeometry(1, 36, 30);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const out = new Float32Array(p.count * 3);
  let minY = Infinity;
  for (let i = 0; i < p.count; i++) {
    // sphere y is the pole axis -> kidney long axis (+ caudal); x lateral; z anterior
    let x = p.getX(i), l = p.getY(i), y = p.getZ(i);
    const n = noise3(x * 1.8 + seed, y * 1.8 - seed, l * 2.2 + seed * 0.5);
    const up = -l;
    // Bean: the medial border hollows gently along its length and opens into the hilum
    const med = smoothstep(0.05, 0.95, -x);
    const bean = 0.1 * Math.exp(-(((l - hilum) / 0.8) ** 2));
    const slit = 0.34 * Math.exp(-(((l - hilum) / 0.28) ** 4)) * Math.exp(-((y / 0.75) ** 2));
    x *= 1 - med * (bean + slit);
    if (y < 0) y *= 0.84; // flatter posterior surface, lying on the muscles
    const X = x * wid * (1 + 0.06 * up) * (1 + 0.025 * n);
    const Y = y * thick * (1 + 0.08 * up) * (1 + 0.025 * n);
    const L = l * len * (1 + 0.015 * n);
    const q = place(X, Y, L);
    out[i * 3] = q[0]; out[i * 3 + 1] = q[1]; out[i * 3 + 2] = q[2];
    minY = Math.min(minY, q[1]);
  }
  lift = 0.03 - minY;
  for (let i = 0; i < p.count; i++) out[i * 3 + 1] += lift;
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  // Mapping the sphere's pole axis to the long axis swaps two axes (a reflection), and the right
  // kidney is mirrored once more; flip the winding wherever the net result is a reflection
  if (side > 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
  g.computeVertexNormals();
  return { geometry: g, place, len, wid, thick, hilum };
}

/* Right adrenal: a flattened pyramid (rounded triangular plate) seated on the upper pole.
   base = middle of the plate's base edge, apex = its tip; the plate is thin along "normal"
   and its base edge curls back around the pole (cup). */
function pyramid({ base, apex, normal, width, thick, cup = 0.1 }) {
  let g = new THREE.SphereGeometry(1, 20, 16);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const b0 = new THREE.Vector3(...base), up = new THREE.Vector3(...apex).sub(b0);
  const h = up.length();
  up.normalize();
  const nrm = new THREE.Vector3(...normal);
  nrm.addScaledVector(up, -nrm.dot(up)).normalize();
  const side = new THREE.Vector3().crossVectors(up, nrm);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (y + 1) / 2; // 0 at the base edge, 1 at the apex
    const w = width * (1 - 0.8 * Math.pow(k, 0.9)) * (1 + 0.05 * noise3(x * 3, y * 3 + 1, z * 3));
    const u = k * h;
    const across = x * w;
    const n = z * thick * (1 - 0.45 * k) - cup * ((across / width) ** 2) * (1 - k);
    v.copy(b0).addScaledVector(up, u).addScaledVector(side, across).addScaledVector(nrm, n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildBase() {
  /* ------------------------------------------------------------ kidneys */
  // Left kidney a little higher (hilum ~L1) than the right (hilum ~L1/L2, pushed down by the liver).
  // Upper poles medial and posterior; hila turned anteromedially.
  const kL = kidney({ side: 1, center: [2.22, 0, -1.3], len: 1.24, wid: 0.66, thick: 0.35, roll: 0.28, yaw: 0.26, pitch: 0.16, seed: 1.7 });
  const kR = kidney({ side: -1, center: [-2.28, 0, -0.92], len: 1.2, wid: 0.65, thick: 0.35, roll: 0.28, yaw: 0.24, pitch: 0.16, seed: 4.3 });
  const hil = (k, dx, dy, dl) => k.place(-k.wid * dx, k.thick * dy, k.len * (k.hilum + dl));

  /* ------------------------------------------------------------ arteries */
  const A = [];
  // Abdominal aorta: enters at the hiatus (T12), drifts just left of midline, tapers to the bifurcation
  const aorta = [[0.1, 0.28, -3.48], [0.18, 0.28, -2.9], [0.27, 0.28, -2.0], [0.31, 0.29, -0.9], [0.32, 0.3, 0.2], [0.29, 0.29, 1.12]];
  A.push(vessel(aorta, { r: taper(0.255, 0.205), radial: 16, perUnit: 7 }));
  // Celiac trunk (T12/L1): short anterior stub that trifurcates
  const celiacTop = [0.24, 0.7, -2.72];
  A.push(vessel([[0.22, 0.24, -2.86], [0.23, 0.5, -2.8], celiacTop], { r: taper(0.1, 0.095, 0.5, 0.24, 0.1), radial: 12, start: 'buried', end: 'round' }));
  A.push(vessel([celiacTop, [-0.05, 0.76, -2.68], [-0.4, 0.78, -2.55]], { r: taper(0.075, 0.068), radial: 8, start: 'buried' })); // common hepatic
  A.push(vessel([celiacTop, [0.55, 0.77, -2.74], [0.9, 0.77, -2.62], [1.12, 0.76, -2.7]], { r: taper(0.08, 0.072), radial: 8, start: 'buried' })); // splenic
  A.push(vessel([celiacTop, [0.3, 0.8, -2.95], [0.42, 0.84, -3.15]], { r: taper(0.055, 0.05), radial: 6, start: 'buried' })); // left gastric
  // SMA (L1): leaves anteriorly, then runs caudally, arching over the left renal vein
  A.push(vessel([[0.27, 0.24, -2.42], [0.28, 0.62, -2.28], [0.31, 0.84, -1.95], [0.33, 0.9, -1.55]], { r: taper(0.11, 0.1, 0.45, 0.24, 0.1), radial: 12, start: 'buried' }));
  // Renal arteries (L1/L2), behind the veins; the right one is longer and passes behind the IVC
  A.push(vessel([[0.3, 0.24, -1.78], [0.75, 0.24, -1.7], hil(kL, 1.3, -0.25, -0.16), hil(kL, 0.2, 0, -0.14)], { r: taper(0.088, 0.08, 0.5, 0.22, 0.1), radial: 8, start: 'buried', end: 'buried' }));
  A.push(vessel([[0.3, 0.2, -1.72], [-0.05, 0.14, -1.66], [-0.6, 0.13, -1.52], hil(kR, 1.3, -0.25, -0.16), hil(kR, 0.2, 0, -0.14)], { r: taper(0.088, 0.08, 0.5, 0.22, 0.1), radial: 8, start: 'buried', end: 'buried' }));
  // IMA (L3): small, anterior and to the left
  A.push(vessel([[0.34, 0.26, -0.2], [0.48, 0.48, -0.02], [0.66, 0.56, 0.32]], { r: taper(0.06, 0.055, 0.5, 0.22, 0.08), radial: 6, start: 'buried' }));
  // Common iliac arteries, continuing as the external iliacs along the pelvic brim to the groin.
  // The right one crosses in front of the venous confluence. Internal iliacs leave at the
  // iliac bifurcation (in front of the sacroiliac joint) and dive back into the pelvis.
  const bifR = [-0.74, 0.34, 2.18], bifL = [1.06, 0.3, 2.12];
  const iliacR = (t, L) => (0.168 - 0.05 * Math.min(1, t * 1.4)) * (1 + 0.2 * Math.exp(-Math.max(0, t * L - 0.3) / 0.22));
  A.push(vessel([[0.29, 0.29, 0.72], [0.24, 0.3, 1.0], [0.06, 0.33, 1.45], [-0.3, 0.41, 1.84], bifR, [-1.08, 0.33, 2.58], [-1.42, 0.38, 3.02], [-1.74, 0.48, 3.48]], { r: iliacR, radial: 12, perUnit: 8, start: 'buried' }));
  A.push(vessel([[0.29, 0.29, 0.72], [0.34, 0.29, 1.0], [0.55, 0.3, 1.45], [0.84, 0.3, 1.82], bifL, [1.33, 0.33, 2.56], [1.58, 0.39, 3.02], [1.8, 0.48, 3.46]], { r: iliacR, radial: 12, perUnit: 8, start: 'buried' }));
  for (const [s, bif] of [[-1, bifR], [1, bifL]]) {
    A.push(vessel([[bif[0] + s * 0.02, bif[1] - 0.02, bif[2] - 0.06], [s * 0.8, 0.22, 2.45], [s * 0.84, 0.13, 2.78], [s * 0.8, 0.12, 3.02]], { r: taper(0.11, 0.08, 0.3, 0.12, 0.12), radial: 8, start: 'buried' }));
  }

  /* ------------------------------------------------------------ veins */
  const V = [];
  // IVC: right of the aorta, ovoid and flattened; rises into the liver at the top, lifts over the right renal artery
  V.push(vessel([[-0.34, 0.2, 1.82], [-0.42, 0.22, 0.9], [-0.52, 0.24, -0.3], [-0.58, 0.38, -1.5], [-0.62, 0.32, -2.3], [-0.68, 0.44, -3.0], [-0.74, 0.68, -3.44]], {
    r: taper(0.27, 0.31), flat: () => 0.64, radial: 16, perUnit: 7, start: 'round',
  }));
  // Renal veins: the left is long and crosses in front of the aorta, under the SMA
  const lrvOut = hil(kL, 1.25, 0.05, -0.04);
  V.push(vessel([hil(kL, 0.2, 0.2, -0.02), lrvOut, [0.6, 0.62, -1.58], [0.1, 0.64, -1.6], [-0.3, 0.48, -1.56], [-0.58, 0.38, -1.52]], {
    r: taper(0.13, 0.15), flat: () => 0.7, radial: 12, start: 'buried', end: 'buried',
  }));
  V.push(vessel([hil(kR, 0.2, 0.2, -0.02), hil(kR, 1.25, 0.05, -0.04), [-0.95, 0.42, -1.3], [-0.6, 0.36, -1.38]], {
    r: taper(0.14, 0.15), flat: () => 0.75, radial: 12, start: 'buried', end: 'buried',
  }));
  // Common iliac veins meet behind the right common iliac artery (L5), the left one flattened
  // there; each continues as the external iliac vein, medial to its artery. Internal iliac
  // veins join from the pelvis, behind the arteries.
  const cvR = [-0.98, 0.17, 2.42], cvL = [1.0, 0.17, 2.4];
  const iliacV = (t, L) => 0.2 - 0.065 * t;
  V.push(vessel([[-0.36, 0.2, 1.6], [-0.66, 0.18, 2.05], cvR, [-1.14, 0.18, 2.78], [-1.34, 0.24, 3.16], [-1.46, 0.33, 3.52]], { r: iliacV, flat: () => 0.62, radial: 12, perUnit: 8, start: 'buried' }));
  V.push(vessel([[-0.36, 0.2, 1.62], [0.12, 0.14, 1.96], [0.6, 0.15, 2.2], cvL, [1.14, 0.18, 2.78], [1.34, 0.24, 3.16], [1.46, 0.33, 3.52]], {
    r: iliacV, flat: (t) => 0.62 - 0.17 * Math.exp(-(((t - 0.2) / 0.1) ** 2)), radial: 12, perUnit: 8, start: 'buried',
  }));
  for (const s of [-1, 1]) {
    V.push(vessel([[s * 0.96, 0.15, 2.36], [s * 0.76, 0.1, 2.66], [s * 0.64, 0.09, 2.9]], { r: taper(0.12, 0.1), flat: () => 0.6, radial: 8, start: 'buried' }));
  }

  // Ovarian (gonadal) vessels: the left vein drains into the left renal vein, the right straight
  // into the IVC; the arteries leave the aorta just below the renal arteries. Both run down the
  // posterior wall (along the line of the psoas, not modeled), cross in front of the ureter, and
  // pass over the external iliacs toward the ovaries.
  for (const s of [-1, 1]) {
    const lower = [[s * 1.12, 0.21, 0.62], [s * 1.46, 0.12, 1.6], [s * 1.56, 0.52, 2.3], [s * 1.38, 0.6, 2.58]];
    V.push(vessel([s > 0 ? [1.16, 0.5, -1.5] : [-0.66, 0.34, -0.98], s > 0 ? [1.04, 0.24, -0.8] : [-0.92, 0.18, -0.3], ...lower], { r: () => 0.042, flat: () => 0.85, radial: 6, perUnit: 6, start: 'buried' }));
    A.push(vessel([[0.3 + s * 0.12, 0.3, -1.3], [s * 0.62 + 0.15, 0.2, -0.9], [s * 0.98, 0.14, -0.35], lower[0].map((v, i) => v + [s * 0.06, 0.01, 0.02][i]), [s * 1.52, 0.12, 1.56], [s * 1.62, 0.54, 2.28], [s * 1.45, 0.62, 2.56]], { r: () => 0.03, radial: 6, perUnit: 6, start: 'buried' }));
  }

  /* ------------------------------------------------------------ renal pelvis and ureters */
  // From the sinus (behind the vessels), down the posterior wall, over the iliac vessels at the
  // brim, along the pelvic wall, then forward into the bladder base.
  const U = [];
  const ureter = (k, path) => {
    const pel0 = hil(k, 0.2, -0.22, 0.1), pel1 = hil(k, 1.3, -0.3, 0.22);
    return vessel([pel0, pel1, ...path], {
      r: (t, L) => {
        const s = t * L;
        const funnel = 0.062 + 0.11 * Math.exp(-((Math.max(0, s - 0.22) / 0.26) ** 1.6));
        const pinch = 1 - 0.12 * Math.exp(-(((s - 0.8) / 0.12) ** 2)); // pelviureteric junction
        return funnel * pinch * (1 + 0.04 * Math.sin(s * 9));
      },
      radial: 8, perUnit: 9, start: 'buried', end: 'round',
    });
  };
  U.push(ureter(kL, [[1.3, 0.16, -0.6], [1.16, 0.1, 0.4], [1.08, 0.13, 1.4], [1.04, 0.5, 2.08], [0.98, 0.42, 2.62], [0.78, 0.48, 2.96], [0.5, 0.65, 3.05]]));
  U.push(ureter(kR, [[-1.34, 0.16, -0.25], [-1.2, 0.1, 0.6], [-1.08, 0.14, 1.5], [-0.98, 0.52, 2.2], [-0.94, 0.42, 2.62], [-0.78, 0.48, 2.96], [-0.5, 0.65, 3.05]]));

  /* ------------------------------------------------------------ adrenals */
  const D = [];
  // Right: pyramidal, on the upper pole, tucked behind the edge of the IVC
  const rBase = kR.place(-kR.wid * 0.25, kR.thick * 0.55, -kR.len * 0.74);
  const rApex = [rBase[0] + 0.24, rBase[1] - 0.14, rBase[2] - 0.56];
  D.push(pyramid({ base: rBase, apex: rApex, normal: [0, 1, 0.3], width: 0.38, thick: 0.07, cup: 0.12 }));
  // Left: crescent along the medial border of the upper pole, down toward the hilum
  const cres = [[-0.1, 0.25, -1.06], [-0.62, 0.32, -0.88], [-0.95, 0.3, -0.58], [-1.03, 0.22, -0.28]].map(([x, y, l]) => kL.place(kL.wid * x, kL.thick * y, kL.len * l));
  D.push(vessel(cres, { r: (t) => 0.14 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.6) + 0.02, flat: () => 0.32, radial: 12, perUnit: 18 }));
  // Left suprarenal vein: from the lower end of the crescent into the top of the left renal vein
  V.push(vessel([kL.place(-kL.wid * 0.98, kL.thick * 0.2, -kL.len * 0.36), kL.place(-kL.wid * 1.3, kL.thick * 0.4, -kL.len * 0.26), lrvOut.map((v, i) => v + ([0.6, 0.62, -1.58][i] - v) * 0.22)], { r: () => 0.034, radial: 6, perUnit: 12, start: 'buried', end: 'buried' }));

  /* ------------------------------------------------------------ meshes */
  const artMat = hydrogel('#b3282f', { scale: 2.4, glow: 0.7 });
  const veinMat = hydrogel('#3c5d8c', { scale: 2.4, glow: 0.7 });
  const kidneyMat = hydrogel('#6a1f2c', { scale: 1.6, mottle: 0.16 });
  const ureterMat = hydrogel('#c9a07a', { scale: 2.6, glow: 0.5 });
  const adrenalMat = hydrogel('#b98a3e', { scale: 2.8, bump: 0.8, glow: 0.4 });
  const mesh = (geos, m) => new THREE.Mesh(mergeGeometries(geos), m);

  return {
    meshes: [
      mesh(A, artMat),
      mesh(V, veinMat),
      mesh([kL.geometry, kR.geometry], kidneyMat),
      mesh(U, ureterMat),
      mesh(D, adrenalMat),
    ],
  };
}
