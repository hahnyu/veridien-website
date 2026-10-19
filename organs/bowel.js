import { THREE, blob, hydrogel } from '../anatomy-kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* Bowel module: small bowel on its mesentery, and the colon from cecum (with appendix) to rectum.
   Frame: +x patient's left, +y anterior (up off the tray), -z cranial, +z caudal. 1 unit ≈ 3.5 cm. */

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);

/* Piecewise-linear lookup: table of [key, value] pairs sorted by key */
const table = (rows) => (k) => {
  if (k <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) {
    if (k <= rows[i][0]) return lerp(rows[i - 1][1], rows[i][1], (k - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]));
  }
  return rows[rows.length - 1][1];
};

/* Rounded end: 1 in the middle, closing like a dome over `e` units at each end */
const dome = (d, e) => (d >= e ? 1 : Math.sqrt(Math.max(0, 1 - (1 - d / e) ** 2)));

/* ---------------------------------------------------------------- geometry helpers */

/* Even arc-length samples of a centripetal Catmull-Rom curve through `points`.
   C[i] is the fractional control-point index at each sample (for anatomical landmarks). */
function path(points, step, smoothing = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, points.length * 10);
  let L = curve.getLength();
  const n = Math.max(2, Math.ceil(L / step));
  const P = [], T = [], S = [], C = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const t = curve.getUtoTmapping(u);
    P.push(curve.getPoint(t));
    T.push(curve.getTangent(t).normalize());
    S.push(u * L);
    C.push(t * (points.length - 1));
  }
  if (smoothing) {
    // Spread out bends that are tighter than the tube is wide (Catmull-Rom bunches curvature
    // at the control points): relax the samples toward their neighbors, ends fixed
    let cur = new Float64Array((n + 1) * 3), nxt = new Float64Array((n + 1) * 3);
    P.forEach((p, i) => { cur[i * 3] = p.x; cur[i * 3 + 1] = p.y; cur[i * 3 + 2] = p.z; });
    nxt.set(cur);
    for (let it = 0; it < smoothing; it++) {
      for (let i = 3; i < n * 3; i++) nxt[i] = 0.5 * cur[i] + 0.25 * (cur[i - 3] + cur[i + 3]);
      [cur, nxt] = [nxt, cur];
    }
    P.forEach((p, i) => p.set(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]));
    for (let i = 0; i <= n; i++) T[i].subVectors(P[Math.min(n, i + 1)], P[Math.max(0, i - 1)]).normalize();
    S[0] = 0;
    for (let i = 1; i <= n; i++) S[i] = S[i - 1] + P[i].distanceTo(P[i - 1]);
    L = S[n];
  }
  return { P, T, S, C, L, n };
}

/* Cross-section frames. With `up`, the frame's normal is the up vector projected off the
   tangent (no twist for a tube that never runs straight up), so angle 0 always faces `up`;
   otherwise frames are parallel-transported (rotation-minimizing) along the curve. */
function frames(T, up) {
  const N = [], B = [];
  const q = new THREE.Quaternion();
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    let n;
    if (up || i === 0) {
      n = (up || new THREE.Vector3(0, 1, 0)).clone();
      n.addScaledVector(t, -n.dot(t));
      if (n.lengthSq() < 1e-3) n = i ? N[i - 1].clone() : new THREE.Vector3(1, 0, 0);
    } else {
      n = N[i - 1].clone().applyQuaternion(q.setFromUnitVectors(T[i - 1], t));
    }
    n.addScaledVector(t, -n.dot(t)).normalize();
    N.push(n);
    B.push(new THREE.Vector3().crossVectors(t, n).normalize());
  }
  return { N, B };
}

/* Tube along sampled path `sp`: radius(i, angle) per ring i; optional squash(i) flattens the
   cross-section along world y. Ends close with a center vertex. */
function sweep(sp, { radial, radius, up = null, squash = null }) {
  const { P, T, n } = sp;
  const { N, B } = frames(T, up);
  const pos = new Float32Array(((n + 1) * radial + 2) * 3);
  const cs = [], sn = [];
  for (let j = 0; j < radial; j++) { cs.push(Math.cos((j / radial) * TAU)); sn.push(Math.sin((j / radial) * TAU)); }
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const p = P[i], nn = N[i], bb = B[i];
    const sq = squash ? squash(i) : 1;
    for (let j = 0; j < radial; j++) {
      const r = radius(i, (j / radial) * TAU);
      pos[k++] = p.x + r * (cs[j] * nn.x + sn[j] * bb.x);
      pos[k++] = p.y + r * (cs[j] * nn.y + sn[j] * bb.y) * sq;
      pos[k++] = p.z + r * (cs[j] * nn.z + sn[j] * bb.z);
    }
  }
  pos[k++] = P[0].x; pos[k++] = P[0].y; pos[k++] = P[0].z;
  pos[k++] = P[n].x; pos[k++] = P[n].y; pos[k++] = P[n].z;
  const idx = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = (i + 1) * radial + j, c = (i + 1) * radial + ((j + 1) % radial), d = i * radial + ((j + 1) % radial);
      idx.push(a, d, b, b, d, c);
    }
  }
  const start = (n + 1) * radial, end = start + 1, last = n * radial;
  for (let j = 0; j < radial; j++) {
    idx.push(start, (j + 1) % radial, j);
    idx.push(end, last + j, last + ((j + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Deterministic pseudo-random numbers */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/* ---------------------------------------------------------------- colon */

// Centerline from the cecal pole to the pelvic floor (control-point indices are used as landmarks)
const COLON = [
  [-2.62, 0.5, 2.85], // 0 cecal pole: blind end, appendix arises here
  [-2.92, 0.71, 2.45], // 1 cecum, in the right iliac fossa
  [-3.2, 0.66, 1.85], // 2 ileocecal junction level
  [-3.44, 0.64, 1.0], // 3 ascending colon: posterior, on the right flank, lateral to the kidney
  [-3.5, 0.72, 0.45], // 4
  [-3.3, 1.0, 0.0], // 5 hepatic flexure, under the liver
  [-2.8, 1.42, 0.12], // 6
  [-1.75, 1.92, 0.08], // 7 transverse colon: anterior, sagging caudally in the middle
  [-0.75, 2.1, 0.5], // 8
  [0.55, 2.12, 0.62], // 9
  [1.75, 2.02, 0.45], // 10 below the greater curvature of the stomach
  [2.9, 1.86, 0.05], // 11
  [3.5, 1.78, -0.8], // 12 splenic flexure: higher and more cranial, at the spleen's lower pole
  [3.95, 1.2, -0.62], // 13
  [3.98, 0.66, -0.25], // 14 descending colon (posterior, on the left flank)
  [3.85, 0.52, 0.7], // 15
  [3.6, 0.52, 1.65], // 16 left iliac fossa
  [3.25, 0.6, 2.35], // 17 sigmoid loop, beside the left adnexa
  [2.75, 0.75, 2.75], // 18
  [2.2, 0.8, 2.45], // 19
  [2.15, 0.85, 1.75], // 20
  [1.3, 0.85, 1.35], // 21 crossing the left common iliac vessels at the pelvic brim
  [0.45, 0.85, 1.42], // 22 rectosigmoid junction, over the sacral promontory
  [0.2, 0.5, 2.05], // 23 rectum, in the sacral hollow behind the uterus
  [0.1, 0.3, 2.6], // 24
  [0.05, 0.28, 3.1], // 25 ampulla
  [0.0, 0.3, 3.45], // 26 pelvic floor
];
const colonRadius = table([[0, 0.54], [1.2, 0.56], [2.3, 0.47], [4, 0.41], [5.5, 0.39], [7.5, 0.37], [11, 0.36], [13, 0.35], [15.5, 0.33], [17, 0.31], [21, 0.29], [22.3, 0.26], [23.5, 0.27], [25, 0.3], [26, 0.26]]);
const haustraDepth = table([[0, 1], [16.5, 1], [19, 0.75], [21.5, 0.45], [22.6, 0]]);
const haustraLength = table([[0, 0.78], [3, 0.66], [7, 0.6], [12, 0.56], [16, 0.5], [21, 0.56]]);

function buildColon() {
  const sp = path(COLON, 0.062, 60);
  const { S, C, L, n } = sp;
  // Haustral phase: integrated so the sacculation length can vary smoothly along the colon
  const phase = [0];
  for (let i = 1; i <= n; i++) phase.push(phase[i - 1] + (S[i] - S[i - 1]) / haustraLength(C[i]));
  const stagger = [0, 0.37, 0.71]; // haustra in the three sectors don't line up
  const third = TAU / 3;
  const base = S.map((s, i) => colonRadius(C[i]) * dome(s, 0.55) * dome(L - s, 0.22));
  const depth = C.map(haustraDepth);
  // Three taeniae coli at 0 (libera, anterior), 120° and 240°; sacculations bulge between them
  const sectors = new Map();
  const sectorAt = (a) => {
    if (!sectors.has(a)) {
      const sector = Math.floor(a / third) % 3;
      const x = (a - sector * third) / third; // 0..1 across the sector, taeniae at both edges
      const edge = Math.min(x, 1 - x); // 0 on a taenia's midline
      sectors.set(a, [sector, smoothstep(0.085, 0.2, edge) * Math.pow(Math.sin(Math.PI * x), 0.6)]);
    }
    return sectors.get(a);
  };
  const radius = (i, a) => {
    const h = depth[i];
    if (h <= 0) return base[i];
    const [sector, across] = sectorAt(a);
    const hp = phase[i] + stagger[sector];
    const sac = Math.pow(Math.sin(Math.PI * fract(hp)), 0.4); // 0 at a semilunar fold, 1 mid-haustrum
    const size = 0.75 + 0.5 * fract(Math.sin(Math.floor(hp) * 12.9898 + sector * 78.233) * 43758.5453); // haustra vary
    // flat taenia bands at 0.93; folds dip to 0.83; sacculations swell to 1.0-1.15 between bands
    return base[i] * (1 + h * (-0.07 + across * (0.3 * size * sac - 0.1)));
  };
  // The rectum flattens into the sacral hollow
  const squash = (i) => lerp(1, 0.8, smoothstep(22.4, 23.6, C[i]));
  const geo = sweep(sp, { radial: 36, radius, up: new THREE.Vector3(0, 1, 0), squash });
  return { geo, sp };
}

/* Appendix: arises from the cecal pole (where the taeniae converge), hangs medially toward the pelvis */
function buildAppendix() {
  const pts = [[-2.68, 0.5, 2.7], [-2.52, 0.34, 2.99], [-2.28, 0.25, 3.2], [-1.98, 0.25, 3.24], [-1.8, 0.3, 3.08]];
  const sp = path(pts, 0.05);
  const geo = sweep(sp, { radial: 10, radius: (i) => lerp(0.1, 0.08, sp.S[i] / sp.L) * dome(sp.L - sp.S[i], 0.09) });
  return { geo, sp };
}

/* Epiploic appendages: small fatty tags hanging off the taeniae of the transverse and sigmoid
   colon (only where they point outward or forward, so they never push into the loops). */
function buildEpiploic(colon) {
  const { P, T, C, S, n } = colon.sp;
  const { N, B } = frames(T, new THREE.Vector3(0, 1, 0));
  const rand = rng(5);
  const parts = [];
  // a soft club: narrow stalk widening to a blunt, slightly flattened lobule
  const unit = blob({ detail: 2, seed: 2.2, freq: 2.4, deform: (x, y, z, k) => { const r = 1 + 0.1 * k; const w = 0.5 + 0.5 * (y + 1) / 2; return [x * w * r, y, z * w * 0.7 * r]; } });
  const up = new THREE.Vector3(0, 1, 0);
  let next = 0;
  for (let i = 0; i <= n; i++) {
    const c = C[i];
    const onColon = (c > 6.8 && c < 11.6) || (c > 16.8 && c < 21.6);
    if (!onColon || S[i] < next) continue;
    for (const a of [0, TAU / 3, (2 * TAU) / 3]) {
      const dir = N[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(B[i], Math.sin(a));
      const outward = new THREE.Vector3(P[i].x, 0, P[i].z - 0.9).normalize().dot(dir);
      if (dir.y < 0.15 && outward < 0.5) continue;
      if (rand() < 0.45) continue;
      const len = 0.075 + 0.05 * rand(), wid = 0.06 + 0.03 * rand();
      const g = unit.clone();
      const lean = dir.clone().addScaledVector(T[i], (rand() < 0.5 ? -1 : 1) * (0.5 + 0.4 * rand())).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, lean);
      const r = colonRadius(c) * 0.93;
      g.applyMatrix4(new THREE.Matrix4().compose(P[i].clone().addScaledVector(dir, r).addScaledVector(lean, len * 0.6), q, new THREE.Vector3(wid, len, wid)));
      parts.push(g);
    }
    next = S[i] + 0.32 + 0.25 * rand();
  }
  return parts.length ? mergeGeometries(parts) : null;
}

/* ---------------------------------------------------------------- small bowel */

const DJ = [0.65, 0.75, -0.35]; // duodenojejunal flexure (where the Upper GI duodenum ends)
const IC = [-2.9, 0.64, 1.88]; // ileocecal junction, inside the medial cecal wall
const SB_RADIUS = (f) => lerp(0.2, 0.155, smoothstep(0.25, 1, f)); // jejunum wider, ileum narrower

/* The duodenal C-loop and pancreatic head (Upper GI module) sit here, cranial to the loops and
   behind the transverse colon; only the start of the jejunum, at the DJ flexure, is inside */
const inDuodenalC = (x, z) => x > -1.6 && x < 0.95 && z < 0.95;

/* Grows the small bowel as a chain of beads: it lengthens inside the space the colon frames,
   buckling into closely packed, gently folded loops that never pass through each other.
   Starts as a short path from the DJ flexure through the upper left, across, and down to the
   ileocecal junction, so the jejunum ends up upper left and the ileum lower right. It rests on
   the base anatomy (FLOOR), stays out of the duodenal C-loop and the pelvic organs, and keeps
   under the cover. */
function growSmallBowel(obstacles) {
  const L0 = 0.15; // bead spacing
  const target = 62; // length to grow to (in life ~6 m; here compressed to fit the module)
  const Rmin = 0.4; // tightest bend of the centerline
  const c2 = 2 * L0 * Math.cos(L0 / Rmin / 2); // bend limit as minimum 2nd- and 3rd-neighbor distances
  const c3 = 2 * Rmin * Math.sin((3 * L0) / (2 * Rmin));
  // over 4-5 beads, no hairpin tighter than ~0.28 (keeps the inner wall of a U-turn from pinching)
  const HP = 0.28;
  const c4 = 2 * HP * Math.sin((4 * L0) / (2 * HP)), c5 = 2 * HP * Math.sin((5 * L0) / (2 * HP));
  const seed = [DJ, [1.25, 1.0, -0.05], [2.3, 0.95, 0.15], [2.55, 0.95, 0.95], [1.7, 0.95, 1.35], [0.6, 0.95, 1.2], [-0.6, 0.95, 1.15],
    [-1.9, 0.95, 0.6], [-2.4, 0.9, 1.0], [-1.4, 0.9, 1.5], [-0.3, 0.9, 1.75], [-1.3, 0.8, 2.0], [-2.0, 0.7, 1.92], IC];
  const sp = path(seed, L0);
  const CAP = Math.ceil(target / L0) + 64;
  const X = new Float64Array(CAP * 3);
  const R = new Float64Array(CAP);
  let N = sp.P.length;
  sp.P.forEach((p, i) => { X[i * 3] = p.x; X[i * 3 + 1] = p.y; X[i * 3 + 2] = p.z; });
  const rand = rng(11);
  // The jejunum leaves the DJ flexure heading forward and to the left, clear of the duodenum
  const lead = new THREE.Vector3(0.7, 0.7, 0.15).normalize();
  const pinA = [0, 1, 2, 3].map((k) => [DJ[0] + lead.x * L0 * k, DJ[1] + lead.y * L0 * k, DJ[2] + lead.z * L0 * k]);
  // The terminal ileum runs in from the medial side, rising slightly from the pelvis
  const tail = new THREE.Vector3(1, -0.12, 0.3).normalize();
  const pinB = [0, 1, 2, 3, 4].map((k) => [IC[0] + tail.x * L0 * k, IC[1] + tail.y * L0 * k, IC[2] + tail.z * L0 * k]);

  // Grids: static obstacle spheres (colon, appendix) and the beads themselves, binned by cell
  const H = 0.5, OX = -5, OY = -1, OZ = -3, NX = 20, NY = 10, NZ = 18;
  const cellOf = (x, y, z) => {
    const i = Math.floor((x - OX) / H), j = Math.floor((y - OY) / H), k = Math.floor((z - OZ) / H);
    return i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ ? -1 : (k * NY + j) * NX + i;
  };
  const obsCells = Array.from({ length: NX * NY * NZ }, () => []);
  for (const o of obstacles) {
    const reach = o[3] + 0.25;
    const i0 = Math.floor((o[0] - reach - OX) / H), i1 = Math.floor((o[0] + reach - OX) / H);
    const j0 = Math.floor((o[1] - reach - OY) / H), j1 = Math.floor((o[1] + reach - OY) / H);
    const k0 = Math.floor((o[2] - reach - OZ) / H), k1 = Math.floor((o[2] + reach - OZ) / H);
    for (let k = Math.max(0, k0); k <= Math.min(NZ - 1, k1); k++) for (let j = Math.max(0, j0); j <= Math.min(NY - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(NX - 1, i1); i++) obsCells[(k * NY + j) * NX + i].push(o);
  }
  const [A, B, Cc] = [4.9 * 0.92, 3.2 * 0.92, 4.1 * 0.92];
  const ceil0 = 1.9, ceilK = 0.4;
  const constrain = (i, obs) => {
    const r = R[i], o3 = i * 3;
    let x = X[o3], y = X[o3 + 1], z = X[o3 + 2];
    // The duodenal C-loop and pancreatic head sit cranial to the loops, under the transverse
    // colon: only the first beads (leaving the DJ flexure) may be there
    if (i > 8 && inDuodenalC(x, z)) {
      // out through the nearest side: caudal, or to the left or right of the C-loop
      const dz = 0.95 - z, dl = 0.95 - x, dr = x + 1.6;
      if (dz <= dl && dz <= dr) z = 0.95; else if (dl <= dr) x = 0.95; else x = -1.6;
    }
    const fl = floorTop(x, z) + r + 0.04;
    if (y < fl) y = fl; // tray floor and the base anatomy on it
    // the anterior surface of the pile: a low pillow under the transverse colon
    const top = Math.max(ceil0 - ceilK * ((x / 3) ** 2 + ((z - 0.95) / 1.5) ** 2) - r, fl + 2.3 * r); // always room for two layers
    if (i > 3 && y > top) y = top;
    if (i > 3 && z < r - 0.1) z = r - 0.1; // stay caudal of the liver, stomach and pancreas
    // keep out of the pelvis (uterus, adnexa, bladder)
    const ex = x / (2.15 + r), ey = (y - 1.25) / (1.35 + r), ez = (z - 2.8) / (1.35 + r);
    const f = ex * ex + ey * ey + ez * ez;
    if (f < 1) { const k = 1 / Math.sqrt(f); x *= k; y = 1.25 + (y - 1.25) * k; z = 2.8 + (z - 2.8) * k; }
    // under the cover
    const g = Math.abs(x / (A - r)) ** 3 + Math.abs(y / (B - r)) ** 3 + Math.abs(z / (Cc - r)) ** 3;
    if (g > 1) { const k = Math.pow(g, -1 / 3); x *= k; y *= k; z *= k; }
    // colon and appendix
    if (obs) {
      const c = cellOf(x, y, z);
      const ends = i < 3 || i > N - 6; // the ends join the duodenum and the cecum
      if (c >= 0) for (const o of obsCells[c]) {
        if (ends && o[4]) continue;
        const dx = x - o[0], dy = y - o[1], dz = z - o[2];
        const Rr = o[3] + r + 0.03;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < Rr * Rr) { const k = Rr / (Math.sqrt(d2) || 1e-6); x = o[0] + dx * k; y = o[1] + dy * k; z = o[2] + dz * k; }
      }
    }
    X[o3] = x; X[o3 + 1] = y; X[o3 + 2] = z;
  };
  // Keep beads a <= distance apart (min) or exactly apart (spring)
  const apart = (i, j, d0, spring) => {
    const a = i * 3, b = j * 3;
    const dx = X[b] - X[a], dy = X[b + 1] - X[a + 1], dz = X[b + 2] - X[a + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (!spring && d >= d0) return;
    const k = ((d - d0) / d) * 0.5;
    X[a] += dx * k; X[a + 1] += dy * k; X[a + 2] += dz * k;
    X[b] -= dx * k; X[b + 1] -= dy * k; X[b + 2] -= dz * k;
  };

  // Bead pairs far apart along the chain are pushed apart when they overlap
  const pair = (i, j) => {
    const a = i * 3, b = j * 3;
    const dx = X[b] - X[a], dy = X[b + 1] - X[a + 1], dz = X[b + 2] - X[a + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const D = R[i] + R[j] + 0.04;
    if (d2 >= D * D) return;
    const d = Math.sqrt(d2) || 1e-6;
    const k = ((D - d) / d) * 0.5;
    X[a] -= dx * k; X[a + 1] -= dy * k; X[a + 2] -= dz * k;
    X[b] += dx * k; X[b + 1] += dy * k; X[b + 2] += dz * k;
  };
  const head = new Int32Array(NX * NY * NZ);
  const next = new Int32Array(CAP);
  const GROW = 200, ITER = GROW + 150; // then settle: no gravity, softer bending
  for (let it = 0; it < ITER; it++) {
    const settle = it >= GROW;
    // Grow: insert beads spread quasi-randomly along the chain
    for (let g = 0; g < 4 && N * L0 < target && N < CAP; g++) {
      const at = 4 + Math.floor(fract(it * 0.6180339 + g * 0.2763932) * (N - 9));
      X.copyWithin((at + 2) * 3, (at + 1) * 3, N * 3);
      for (let c = 0; c < 3; c++) X[(at + 1) * 3 + c] = (X[at * 3 + c] + X[(at + 2) * 3 + c]) / 2 + (rand() - 0.5) * 0.05;
      N++;
    }
    for (let i = 0; i < N; i++) R[i] = SB_RADIUS(i / (N - 1));
    // Springs keep beads evenly spaced; 2nd/3rd-neighbor limits keep bends gentle
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N - 1; i++) apart(i, i + 1, L0, true);
      for (let i = 0; i < N - 2; i++) apart(i, i + 2, c2, false);
      for (let i = 0; i < N - 3; i++) apart(i, i + 3, c3, false);
      for (let i = 0; i < N - 4; i++) apart(i, i + 4, c4, false);
      for (let i = 0; i < N - 5; i++) apart(i, i + 5, c5, false);
    }
    // Bending stiffness: each bead eases toward its neighbors' midpoint (long, gentle runs)
    for (let i = 2; i < N - 2; i++) {
      for (let c = 0; c < 3; c++) X[i * 3 + c] += (settle ? 0.15 : 0.6) * ((X[(i - 1) * 3 + c] + X[(i + 1) * 3 + c]) / 2 - X[i * 3 + c]);
    }
    // Repulsion between beads far apart along the chain, then the walls (floor, cover, colon...).
    // While settling, alternate the two a few times so the result satisfies both.
    const g = settle ? 0 : 0.002;
    const rounds = settle ? 6 : 1;
    for (let rep = 0; rep < rounds; rep++) {
      head.fill(-1);
      for (let i = 0; i < N; i++) { const c = cellOf(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); if (c >= 0) { next[i] = head[c]; head[c] = i; } }
      for (let i = 0; i < N; i++) {
        const ci = Math.floor((X[i * 3] - OX) / H), cj = Math.floor((X[i * 3 + 1] - OY) / H), ck = Math.floor((X[i * 3 + 2] - OZ) / H);
        for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const x = ci + di, y = cj + dj, z = ck + dk;
          if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
          for (let j = head[(z * NY + y) * NX + x]; j >= 0; j = next[j]) if (j > i + 4) pair(i, j);
        }
      }
      // loops settle toward the back (posterior) wall
      const obs = it % 2 === 0 || settle;
      for (let i = 0; i < N; i++) { X[i * 3 + 1] -= g; constrain(i, obs); }
      pinA.forEach((p, k) => X.set(p, k * 3));
      pinB.forEach((p, k) => X.set(p, (N - 1 - k) * 3));
    }
  }
  const pts = [];
  for (let i = 0; i < N; i++) pts.push([X[i * 3], X[i * 3 + 1], X[i * 3 + 2]]);
  return pts;
}

/* Where two stretches of a tube (far apart along it) press closer than their radii allow,
   slim both a little there, feathered along the tube, so the walls touch without crossing */
function thinWhereTouching(sp, R, minApart = 10, clearance = 0.004) {
  const { P, n } = sp;
  const H = 0.5, cells = new Map();
  const key = (p) => Math.floor(p.x / H) + 1000 * Math.floor(p.y / H) + 1e6 * Math.floor(p.z / H);
  P.forEach((p, i) => { const k = key(p); (cells.get(k) || cells.set(k, []).get(k)).push(i); });
  const scale = new Float32Array(n + 1).fill(1);
  P.forEach((p, i) => {
    const cx = Math.floor(p.x / H), cy = Math.floor(p.y / H), cz = Math.floor(p.z / H);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const j of cells.get(cx + a + 1000 * (cy + b) + 1e6 * (cz + c)) || []) {
        if (j < i + minApart) continue;
        const gap = p.distanceTo(P[j]) - R[i] - R[j] - clearance;
        if (gap >= 0) continue;
        const k = Math.max(0.85, 1 + gap / (R[i] + R[j]));
        scale[i] = Math.min(scale[i], k); scale[j] = Math.min(scale[j], k);
      }
    }
  });
  // feather: each ring takes the smallest scale within a few rings, eased by distance
  for (let i = 0; i <= n; i++) {
    let s = 1;
    for (let d = -6; d <= 6; d++) { const j = i + d; if (j >= 0 && j <= n) s = Math.min(s, 1 - (1 - scale[j]) * (1 - Math.abs(d) / 7)); }
    R[i] *= s;
  }
}

/* A tube folds through itself on the inside of a bend tighter than its radius: where the
   centerline bends that tightly, slim the tube to fit, feathered along it */
function slimTightBends(sp, R) {
  const { P, n } = sp;
  const cap = new Float32Array(n + 1).fill(Infinity);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 3; i <= n - 3; i++) {
    a.subVectors(P[i], P[i - 3]); b.subVectors(P[i + 3], P[i]);
    const ang = a.angleTo(b);
    if (ang > 1e-4) cap[i] = (0.78 * (a.length() + b.length())) / 2 / ang;
  }
  for (let i = 0; i <= n; i++) {
    let c = Infinity;
    for (let d = -5; d <= 5; d++) { const j = i + d; if (j >= 0 && j <= n) c = Math.min(c, cap[j] + Math.abs(d) * 0.012); }
    R[i] = Math.min(R[i], Math.max(c, R[i] * 0.75));
  }
}

/* ---------------------------------------------------------------- mesentery */

/* The mesentery seen from the front: a sheet slung beneath the loops. It clings to the underside
   of each loop (tucked just inside the bowel wall, so it reads as attached along the mesenteric
   border) and dips between neighboring loops, where it shows as pale webbing. Built as a height
   field over the tray, so it can never fold through itself. `floorAt(x, z)` gives the lowest it
   may sag (tray floor, base anatomy); `keepOut(x, z)` is true where it must not go. */
function buildMesentery(sp, radiusAt, floorAt, keepOut) {
  const ATTACH = 0.35; // 1 = slung under the loops, 0 = joins them at mid-height
  const H = 0.085, X0 = -3.1, Z0 = -0.55, NX = 78, NZ = 36;
  const id = (i, k) => k * NX + i;
  const cover = new Float32Array(NX * NZ).fill(Infinity); // underside of the lowest loop above each point
  for (let s = 0; s <= sp.n; s++) {
    const p = sp.P[s], r = radiusAt(s) * 0.82;
    const i0 = Math.max(0, Math.floor((p.x - r - X0) / H)), i1 = Math.min(NX - 1, Math.ceil((p.x + r - X0) / H));
    const k0 = Math.max(0, Math.floor((p.z - r - Z0) / H)), k1 = Math.min(NZ - 1, Math.ceil((p.z + r - Z0) / H));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const dx = X0 + i * H - p.x, dz = Z0 + k * H - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) cover[id(i, k)] = Math.min(cover[id(i, k)], p.y - ATTACH * Math.sqrt(r * r - d2));
    }
  }
  // Sheet extent: under the loops, plus the crevices between them (points with loops close by on
  // at least three of four sides), so the sheet has no free outer edge on show
  const covered = (i, k) => i >= 0 && k >= 0 && i < NX && k < NZ && cover[id(i, k)] < Infinity;
  const K = 5;
  const mask = new Uint8Array(NX * NZ);
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    if (covered(i, k)) { mask[id(i, k)] = 1; continue; }
    let sides = 0;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let n = 1; n <= K; n++) if (covered(i + di * n, k + dk * n)) { sides++; break; }
    }
    mask[id(i, k)] = sides >= 3 ? 1 : 0;
  }
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) if (keepOut(X0 + i * H, Z0 + k * H)) mask[id(i, k)] = 0;

  // Heights: pinned under the loops of the deepest layer; elsewhere relaxed toward the
  // neighbors with a little sag, and always below any loop overhead
  const h = new Float32Array(NX * NZ);
  const floor = new Float32Array(NX * NZ);
  const pinned = new Uint8Array(NX * NZ);
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    const c = id(i, k);
    floor[c] = floorAt(X0 + i * H, Z0 + k * H);
    pinned[c] = cover[c] < floor[c] + 0.45 ? 1 : 0;
    h[c] = pinned[c] ? cover[c] : floor[c] + 0.2;
  }
  const SAG = 0.004;
  for (let it = 0; it < 70; it++) {
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      const c = id(i, k);
      if (!mask[c] || pinned[c]) continue;
      let sum = 0, n = 0;
      for (const [a, b] of [[i - 1, k], [i + 1, k], [i, k - 1], [i, k + 1]]) if (a >= 0 && b >= 0 && a < NX && b < NZ && mask[id(a, b)]) { sum += h[id(a, b)]; n++; }
      if (n) h[c] = Math.min(cover[c] - 0.02, Math.max(floor[c], sum / n - SAG));
    }
  }
  // Triangulate the masked cells, keeping only the vertices in use
  const remap = new Int32Array(NX * NZ).fill(-1);
  const pos = [], idx = [];
  const vert = (i, k) => {
    const c = id(i, k);
    if (remap[c] < 0) { remap[c] = pos.length / 3; pos.push(X0 + i * H, h[c], Z0 + k * H); }
    return remap[c];
  };
  for (let k = 0; k < NZ - 1; k++) for (let i = 0; i < NX - 1; i++) {
    if (!(mask[id(i, k)] && mask[id(i + 1, k)] && mask[id(i, k + 1)] && mask[id(i + 1, k + 1)])) continue;
    const a = vert(i, k), b = vert(i + 1, k), c = vert(i + 1, k + 1), d = vert(i, k + 1);
    idx.push(a, d, b, b, d, c);
  }
  // Round off the grid's stair-steps: relax the free edge (edges used by one triangle) in plan
  const edgeCount = new Map();
  const key = (u, v) => (u < v ? u * 65536 + v : v * 65536 + u);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const k = key(idx[t + e], idx[t + (e + 1) % 3]);
    edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
  }
  const nbrs = new Map();
  for (const [k, n] of edgeCount) {
    if (n !== 1) continue;
    const u = Math.floor(k / 65536), v = k % 65536;
    (nbrs.get(u) || nbrs.set(u, []).get(u)).push(v);
    (nbrs.get(v) || nbrs.set(v, []).get(v)).push(u);
  }
  for (let it = 0; it < 6; it++) {
    const moved = [];
    for (const [u, vs] of nbrs) {
      if (vs.length !== 2) continue;
      const [a, b] = vs;
      moved.push([u, (pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2]);
    }
    for (const [u, x, z] of moved) { pos[u * 3] = lerp(pos[u * 3], x, 0.6); pos[u * 3 + 2] = lerp(pos[u * 3 + 2], z, 0.6); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- module */

/* What the small bowel packs around (besides the floor, the cover and the pelvic organs) */
function smallBowelObstacles(colon, appendix) {
  const obstacles = [];
  colon.sp.P.forEach((p, i) => { if (i % 2 === 0) obstacles.push([p.x, p.y, p.z, colonRadius(colon.sp.C[i]) * 1.08, 1]); });
  appendix.sp.P.forEach((p, i) => { if (i % 3 === 0) obstacles.push([p.x, p.y, p.z, 0.1, 1]); });
  return obstacles;
}

/* Height of the base anatomy under this module (vessels, kidneys, ureters), baked on
   a coarse grid: one character per cell, (char - 48) / 20 units. Cells hold the highest point
   in and around them, so the mesentery and the loops can rest on it without dipping into it. */
const FLOOR = {
  x0: -4.2, z0: -1.5, h: 0.3, nx: 28, nz: 18,
  data: (
    '000<?AAAA??>>DDDDAAAAAAA=000' +
    '000>@AAAAAA>=>>@@AAABBBA>000' +
    '000>AAAAAAA>;;;;@AAABBBA>000' +
    '000>AAAAAAA>:;<<<??ABBBA>000' +
    '000>AAAAA@>::;<===5AAAAA>000' +
    '000>AAAA@::99;<===63@@@@=000' +
    '000>@@@@55899;<===6500000000' +
    '0000000055799:<<<<6500000000' +
    '000000035579::;;;95530000000' +
    '00000005577:;;;::99550000000' +
    '000000088;;<<<;:<<<880000000' +
    '0000000<<<<<<<;:<<<<<0000000' +
    '0000000====<<<;9<====0000000' +
    '0000000====>>>>>>====0000000' +
    '0000000====>>>>>>====;000000' +
    '0000000<<<=>>>>>>=<<<<000000' +
    '0000000<<<=>>>>>>=<<<<000000' +
    '0000000<<<80000008<<<<000000'
  ),
};
const floorCell = (i, k) => (i < 0 || k < 0 || i >= FLOOR.nx || k >= FLOOR.nz ? 0 : (FLOOR.data.charCodeAt(k * FLOOR.nx + i) - 48) / 20);
function floorTop(x, z) {
  if (!FLOOR.data) return 0;
  // bilinear between cell centers, so the loops slide over it instead of catching on steps
  const u = (x - FLOOR.x0) / FLOOR.h - 0.5, w = (z - FLOOR.z0) / FLOOR.h - 0.5;
  const i = Math.floor(u), k = Math.floor(w), fu = u - i, fw = w - k;
  return lerp(lerp(floorCell(i, k), floorCell(i + 1, k), fu), lerp(floorCell(i, k + 1), floorCell(i + 1, k + 1), fu), fw);
}

/* The grown small-bowel centerline, baked: beads as int16 (units / 4000), base64. Growing it
   takes ~100 ms, so it is done offline, against the neighboring modules as they sit in the
   assembled simulator. After changing the colon, the growth rules or a neighbor, rebake in the
   lab page console and paste the two strings into SB_BAKED and FLOOR.data:
     const m = await import('/organs/bowel.js'); copy(JSON.stringify(m.bakeSmallBowel(sim)));  */
const SB_BAKED = (
  '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' +
  'CQsesNIACmAd'
);
const SB_SCALE = 4000;
export function bakeSmallBowel(sim) {
  // What lies beneath the loops, in this module's frame: the base anatomy on the tray
  sim.update({ explode: 0, swap: 0, scan: 0 });
  sim.root.updateMatrixWorld(true);
  const toLocal = sim.modules.bowel.group.matrixWorld.clone().invert();
  const top = new Float32Array(FLOOR.nx * FLOOR.nz);
  const v = new THREE.Vector3();
  sim.root.children[0].traverse((o) => {
    if (!o.isMesh || !o.material.vertexColors || !o.visible) return;
    const m = toLocal.clone().multiply(o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      // highest point over each floor cell and its neighbors
      const ci = Math.floor((v.x - FLOOR.x0) / FLOOR.h), ck = Math.floor((v.z - FLOOR.z0) / FLOOR.h);
      for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
        const a = ci + di, b = ck + dk;
        if (a >= 0 && b >= 0 && a < FLOOR.nx && b < FLOOR.nz) top[b * FLOOR.nx + a] = Math.max(top[b * FLOOR.nx + a], v.y);
      }
    }
  });
  FLOOR.data = Array.from(top, (y) => String.fromCharCode(48 + Math.min(60, Math.ceil(y * 20)))).join('');
  const beads = growSmallBowel(smallBowelObstacles(buildColon(), buildAppendix()));
  const q = new Int16Array(beads.flat().map((x) => Math.round(x * SB_SCALE)));
  let bin = '';
  new Uint8Array(q.buffer).forEach((b) => { bin += String.fromCharCode(b); });
  return { beads: btoa(bin), floor: FLOOR.data };
}
function bakedBeads() {
  const bin = atob(SB_BAKED);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Int16Array(bytes.buffer);
  const beads = [];
  for (let i = 0; i < q.length; i += 3) beads.push([q[i] / SB_SCALE, q[i + 1] / SB_SCALE, q[i + 2] / SB_SCALE]);
  return beads;
}

export function buildBowel() {
  const colon = buildColon();
  const appendix = buildAppendix();
  const beads = SB_BAKED ? bakedBeads() : growSmallBowel(smallBowelObstacles(colon, appendix));
  const sbPath = path(beads, 0.08, 12);
  const sbR = sbPath.S.map((s) => {
    const wobble = 1 + 0.025 * Math.sin(s * 2.3) * Math.sin(s * 0.71 + 1.3);
    return 0.97 * SB_RADIUS(s / sbPath.L) * wobble * dome(s, 0.06) * dome(sbPath.L - s, 0.06);
  });
  thinWhereTouching(sbPath, sbR);
  slimTightBends(sbPath, sbR);
  const sbGeo = sweep(sbPath, { radial: 12, radius: (i) => sbR[i] });
  const smallBowel = new THREE.Mesh(sbGeo, hydrogel('#c4675f', { scale: 1.8 }));

  const colonMesh = new THREE.Mesh(mergeGeometries([colon.geo, appendix.geo]), hydrogel('#9b4d57', { scale: 1.3 }));

  // Mesentery: may sag to the tray floor or onto the base anatomy; never under the flank colon
  // or over the duodenal C-loop
  const floorAt = (x, z) => Math.max(0.06, floorTop(x, z) + 0.03);
  const lowColon = colon.sp.P.map((p, i) => [p.x, p.y, p.z, colonRadius(colon.sp.C[i])]).filter((o) => o[1] < 1.2);
  const keepOut = (x, z) => inDuodenalC(x, z) || lowColon.some((o) => Math.abs(x - o[0]) < o[3] && (x - o[0]) ** 2 + (z - o[2]) ** 2 < (o[3] * 0.9) ** 2);
  const mesMat = hydrogel('#cf8478', { scale: 1.6, mottle: 0.2, glow: 0.3 });
  mesMat.side = THREE.DoubleSide;
  const mesGeo = buildMesentery(sbPath, (i) => SB_RADIUS(sbPath.S[i] / sbPath.L), floorAt, keepOut);
  const tags = buildEpiploic(colon);
  const mesentery = new THREE.Mesh(tags ? mergeGeometries([mesGeo, tags]) : mesGeo, mesMat);

  return { meshes: [smallBowel, colonMesh, mesentery] };
}
