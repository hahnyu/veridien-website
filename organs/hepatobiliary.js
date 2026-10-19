import { THREE, hydrogel } from '../anatomy-kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mat = (c, o = {}) => hydrogel(c, o);

/* Hepatobiliary module: liver, gallbladder, and the extrahepatic biliary tree.
   Frame: +x patient's left, +y anterior (up off the tray), -z cranial, +z caudal. 1 unit ≈ 3.5 cm.

   The liver is a thick sheet over its outline as seen from the front: an anterior (diaphragmatic)
   surface molded to the cover like the liver to the diaphragm, a visceral surface underneath
   (porta hepatis, gallbladder fossa, caudate lobe, impressions), and a rim that is rounded along the
   right and superior borders and sharp along the inferior border. It is meshed as a grid of columns
   running from a core line out to the rim, so the rim falls exactly on a row of vertices. */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); };
const smax = (a, b, k) => -smin(-a, -b, k);
const pw = (a, p) => { const b = a * a; return p === 2 ? b : p === 4 ? b * b : Math.abs(a) ** p; };
const bump = (x, z, cx, cz, sx, sz, p = 2) => Math.exp(-(pw((x - cx) / sx, p) + pw((z - cz) / sz, p)));
const cube = (a) => Math.abs(a * a * a);

// Inner surface of the closed cover (the audit's 0.92 dome)
const [CA, CB, CC] = [4.9 * 0.92, 3.2 * 0.92, 4.1 * 0.92];
const coverY = (x, z, k) => {
  const s = 1 - cube(x / (CA * k)) - cube(z / (CC * k));
  return s > 0 ? CB * k * Math.cbrt(s) : 0;
};

/* ---------------------------------------------------------------- liver surfaces */

// Anterior / diaphragmatic surface height
function anterior(x, z) {
  const dome = coverY(x, z, 0.962) - 0.02;
  const crown = 2.68 - 0.045 * (x + 1.4) ** 2; // highest over the right lobe, lower toward the left tip
  return smin(dome, crown, 0.25);
}

// Visceral / posterior surface height (before the gallbladder fossa is pressed in)
function visceral(x, z, T = anterior(x, z)) {
  // Posterior surface: deepest over the bare area and gently convex. It bulges as it rises toward
  // the anterior inferior border (steeply in the middle, later on the right over the hepatic flexure).
  const deep = 0.46 + 0.05 * ((x + 1.7) / 1.7) ** 2 + 0.18 * Math.max(0, -2.6 - z) ** 2;
  const rise = (a, b) => sstep(a, b, z);
  const medial = deep + (2.36 - deep) * rise(-2.9, -0.8); // gallbladder and porta
  const renal = deep + (2.3 - deep) * rise(-2.8, -1.0); // over the kidney, under the colon
  const lateral = deep + (1.86 - deep) * rise(-2.6, -0.95); // over the hepatic flexure
  let v = mix(mix(lateral, renal, sstep(-3.3, -2.8, x)), medial, sstep(-2.05, -1.6, x));
  // Left lobe: a thin plate over the stomach with a shallow gastric impression. It begins at the
  // umbilical fissure in front and at the fissure for the ligamentum venosum behind (where the
  // caudate lobe ends), leaving the esophageal groove free near the top.
  const back = sstep(-1.85, -2.35, z);
  const x0 = mix(-0.42, -0.22, back);
  const plate = 1.98 + 0.1 * sstep(-3.0, -1.7, z) + 0.07 * bump(x, z, 0.8, -2.35, 0.55, 0.42);
  v = mix(v, smax(v, plate, 0.1), sstep(x0 - mix(0.14, 0.25, back), x0 + mix(0.18, 0.85, back), x));
  // Caudate lobe: a rounded posterior lobe left of the IVC
  v -= 0.16 * bump(x, z, -0.08, -2.5, 0.24, 0.36, 2);
  // Groove for the IVC on the bare area
  v = smax(v, mix(v, 0.68, bump(x, z, -0.38, -2.6, 0.2, 0.95, 4)), 0.04);
  // Quadrate lobe: a squarish bulge between the gallbladder fossa, the umbilical fissure and the porta
  v -= 0.13 * bump(x, z, -0.86, -1.5, 0.32, 0.24, 4);
  // Porta hepatis (transverse fissure) and umbilical fissure
  v += 0.4 * bump(x, z, -0.66, -1.9, 0.44, 0.14, 4);
  v += 0.28 * bump(x, z, -0.42, -1.6, 0.1, 0.36, 4);
  // Renal and colic impressions on the right lobe, with a soft ridge between them
  v += 0.12 * bump(x, z, -2.45, -1.65, 0.5, 0.36);
  v += 0.1 * bump(x, z, -2.8, -1.12, 0.6, 0.2);
  return Math.min(v, T - 0.14);
}

// Outline seen from the front: x, z, sharpness (0 rounded border, 1 sharp inferior border)
const OUTLINE = [
  [-3.97, -1.62, 0], [-3.82, -1.12, 0.15], [-3.45, -0.8, 0.3], [-2.95, -0.6, 0.7], [-2.4, -0.62, 1],
  [-1.95, -0.85, 1], [-1.76, -1.06, 1], [-1.58, -1.3, 1], [-1.38, -1.16, 1], [-0.95, -1.12, 1],
  [-0.58, -1.2, 1], [-0.42, -1.36, 1], [-0.28, -1.26, 1], [0.15, -1.48, 1], [0.7, -1.86, 1],
  [1.18, -2.18, 0.85], [1.5, -2.46, 0.6], [1.58, -2.68, 0.4], [1.36, -2.86, 0.2], [0.75, -3.04, 0.05],
  [0, -3.2, 0], [-0.85, -3.33, 0], [-1.75, -3.36, 0], [-2.65, -3.18, 0], [-3.4, -2.75, 0], [-3.85, -2.2, 0],
];
// Core line the columns run out from (quadratic Bezier, right lobe to left lobe)
const CORE = [[-3.05, -1.85], [-1.0, -2.35], [1.0, -2.47]];

/* ---------------------------------------------------------------- gallbladder path */

// Centers from fundus to neck; the gallbladder sits in its fossa on the right lobe's visceral surface
// x, z of centers from fundus to neck; heights follow the visceral surface (the fundus tucks just
// under the anterior surface where it peeks past the inferior border)
const GB_XZ = [[-1.58, -1.34], [-1.48, -1.5], [-1.36, -1.68], [-1.22, -1.82], [-1.08, -1.9], [-0.97, -1.86]];
const gbCenters = () => GB_XZ.map(([x, z], i) => [x, i === 0 ? anterior(x, z) - 0.4 : Math.min(visceral(x, z) - 0.06, anterior(x, z) - 0.36), z]);
const GB_FUNDUS = 0.31;
function gbRadius(t) {
  let r = mix(GB_FUNDUS, 0.22, sstep(0.3, 0.76, t)); // fundus and body
  r += 0.025 * bump(t, 0, 0.8, 0, 0.06, 1); // Hartmann's pouch
  r = mix(r, 0.075, sstep(0.84, 1.0, t)); // neck
  return r;
}

/* ---------------------------------------------------------------- helpers */

// Sweep a cross-section along a curve with a fixed "up" reference (no Frenet twisting).
// section(t, a) -> [offset along the normal, offset along the side]; ends close with a fan.
// caps: [len0, rings0, len1, rings1] spaces the rings evenly in angle over rounded ends of those
// lengths (in t units), so a roundEnd() profile closes smoothly instead of in a cone.
function sweep(points, { segments = 48, radial = 12, section, up = [0, 1, 0], caps = null }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const U = new THREE.Vector3(...up);
  const P = new THREE.Vector3(), T = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3();
  const pos = [], idx = [];
  const ringT = (i) => {
    if (!caps) return i / segments;
    const [l0, n0, l1, n1] = caps, i1 = segments - n1;
    if (i <= n0) return l0 * (1 - Math.cos((i / n0) * Math.PI / 2));
    if (i >= i1) return 1 - l1 * (1 - Math.cos(((segments - i) / n1) * Math.PI / 2));
    return l0 + (1 - l0 - l1) * ((i - n0) / (i1 - n0));
  };
  for (let i = 0; i <= segments; i++) {
    const t = ringT(i);
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    S.crossVectors(T, U);
    if (S.lengthSq() < 1e-8) S.set(1, 0, 0);
    S.normalize();
    N.crossVectors(S, T).normalize();
    for (let j = 0; j < radial; j++) {
      const [dn, ds] = section(t, (j / radial) * TAU);
      pos.push(P.x + dn * N.x + ds * S.x, P.y + dn * N.y + ds * S.y, P.z + dn * N.z + ds * S.z);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = (i + 1) * radial + j, c = (i + 1) * radial + ((j + 1) % radial), d = i * radial + ((j + 1) % radial);
      idx.push(a, d, b, b, d, c);
    }
  }
  const start = pos.length / 3;
  curve.getPointAt(0, P); pos.push(P.x, P.y, P.z);
  curve.getPointAt(1, P); pos.push(P.x, P.y, P.z);
  const last = segments * radial;
  for (let j = 0; j < radial; j++) {
    idx.push(start, (j + 1) % radial, j);
    idx.push(start + 1, last + j, last + ((j + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return outward(g);
}

// Round end profile: 0 at the tip, 1 once `len` (in t units) from it
const roundEnd = (t, len) => (t >= len ? 1 : Math.sqrt(Math.max(0, 1 - (1 - t / len) ** 2)));
const roundTube = (radius) => (t, a) => { const r = radius(t); return [r * Math.cos(a), r * Math.sin(a)]; };

// Windings are built outward-facing (checked with a signed-volume test during development)
function outward(g) {
  g.computeVertexNormals();
  return g;
}

// Nearest point on a polyline in the x-z plane: { d, t }
function nearestXZ(line, x, z) {
  let best = Infinity, bt = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, , az] = line[i], [bx, , bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az;
    const u = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = (x - ax - u * dx) ** 2 + (z - az - u * dz) ** 2;
    if (d < best) { best = d; bt = (i + u) / (line.length - 1); }
  }
  return { d: Math.sqrt(best), t: bt };
}

/* ---------------------------------------------------------------- liver mesh */

function buildLiver(gbLine) {
  const M = 188; // columns around the rim (even)
  const H = M / 2;
  const TOP_IN = 7, TOP_RIM = 7, BOT_IN = 11, BOT_RIM = 7;
  const NT = TOP_IN + TOP_RIM, NB = BOT_IN + BOT_RIM;

  // Outline sampled at even arc length, split at its rightmost and leftmost points
  const curve = new THREE.CatmullRomCurve3(OUTLINE.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const D = 640;
  const dense = [];
  for (let i = 0; i < D; i++) {
    const u = i / D;
    const p = curve.getPointAt(u);
    const seg = curve.getUtoTmapping(u) * OUTLINE.length;
    const k = Math.floor(seg) % OUTLINE.length, f = seg - Math.floor(seg);
    dense.push([p.x, p.z, mix(OUTLINE[k][2], OUTLINE[(k + 1) % OUTLINE.length][2], f)]);
  }
  let iR = 0, iL = 0;
  dense.forEach((p, i) => { if (p[0] < dense[iR][0]) iR = i; if (p[0] > dense[iL][0]) iL = i; });
  const walk = (from, to) => { const out = []; for (let i = from; ; i = (i + 1) % D) { out.push(dense[i]); if (i === to) break; } return out; };
  const halfA = walk(iR, iL), halfB = walk(iL, iR);
  const resample = (arr, n) => {
    const cum = [0];
    for (let i = 1; i < arr.length; i++) cum.push(cum[i - 1] + Math.hypot(arr[i][0] - arr[i - 1][0], arr[i][1] - arr[i - 1][1]));
    const out = [];
    let k = 0;
    for (let j = 0; j < n; j++) {
      const s = (j / n) * cum[cum.length - 1];
      while (k < cum.length - 2 && cum[k + 1] < s) k++;
      const f = (s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
      out.push([0, 1, 2].map((c) => mix(arr[k][c], arr[k + 1][c], f)));
    }
    return out;
  };
  const rim = [...resample(halfA, H), ...resample(halfB, H)];
  const core = (c) => {
    const [a, b, d] = CORE, u = 1 - c;
    return [u * u * a[0] + 2 * u * c * b[0] + c * c * d[0], u * u * a[1] + 2 * u * c * b[1] + c * c * d[1]];
  };

  // Per-column rim data
  const cols = rim.map(([bx, bz, s], j) => {
    const c = j <= H ? (1 - Math.cos((Math.PI * j) / H)) / 2 : (1 + Math.cos((Math.PI * (j - H)) / H)) / 2;
    const [kx, kz] = core(c);
    const R = Math.hypot(bx - kx, bz - kz);
    const T = anterior(bx, bz), V = Math.min(visceral(bx, bz), T - 0.04);
    const e = V + (0.5 + 0.42 * s) * (T - V);
    const round = Math.min(0.85 * R, 0.5 * (T - V) + 0.06);
    return { bx, bz, kx, kz, R, s, e, wt: Math.min(0.85 * R, mix(round, 0.22, s)), wb: Math.min(0.85 * R, mix(round, 0.75, s)) };
  });

  // Vertices: top rows (core..rim-1), shared rim row, bottom rows (rim-1..core). Core rows are merged
  // in pairs (j, M - j), which closes the surface along the core line.
  const pos = [];
  const vid = []; // vid[row][col]
  const rows = NT + NB + 1;
  for (let r = 0; r < rows; r++) vid.push(new Int32Array(M));
  const place = (col, isTop, i) => {
    const nIn = isTop ? TOP_IN : BOT_IN, nRim = isTop ? TOP_RIM : BOT_RIM;
    const w = isTop ? col.wt : col.wb;
    let delta, P;
    if (i <= nIn) { delta = col.R - (col.R - w) * (i / nIn); P = 1; }
    else {
      const a = ((i - nIn) / nRim) * (Math.PI / 2);
      delta = w * (1 - Math.sin(a));
      P = Math.pow(Math.cos(a), isTop ? 1 + 0.6 * col.s : 1 + col.s);
    }
    const f = delta / col.R;
    const x = col.bx + (col.kx - col.bx) * f, z = col.bz + (col.kz - col.bz) * f;
    const T = anterior(x, z);
    let y;
    if (isTop) y = col.e + (T - col.e) * P;
    else {
      y = col.e - (col.e - visceral(x, z, T)) * P;
      // Gallbladder fossa: the visceral surface hugs the top of the gallbladder
      const { d, t } = nearestXZ(gbLine, x, z);
      const r = gbRadius(t);
      const m = (1 - sstep(0.9 * r, r + 0.3, d)) * sstep(0, 0.45, P); // fades out at the rim edge
      if (m > 0) {
        const k = Math.min(gbLine.length - 1.001, t * (gbLine.length - 1)), k0 = Math.floor(k);
        const yc = mix(gbLine[k0][1], gbLine[k0 + 1][1], k - k0);
        const dd = Math.min(d, 0.92 * r);
        y = mix(y, yc + Math.sqrt(Math.max(0, (r + 0.012) ** 2 - dd * dd)), m);
      }
      y = Math.min(y, col.e + (T - col.e) * P - 0.08 * P);
    }
    return [x, y, z];
  };
  for (let r = 0; r < rows; r++) {
    const isTop = r < NT, i = isTop ? r : rows - 1 - r; // ring index from the core
    for (let j = 0; j < M; j++) {
      if (r === NT) { // rim ring
        const col = cols[j];
        vid[r][j] = pos.length / 3;
        pos.push(col.bx, col.e, col.bz);
        continue;
      }
      if (i === 0 && j > H) { vid[r][j] = vid[r][M - j]; continue; }
      vid[r][j] = pos.length / 3;
      const q = place(cols[j], isTop, i);
      pos.push(q[0], q[1], q[2]);
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      const a = vid[r][j], b = vid[r][j1], c = vid[r + 1][j1], d = vid[r + 1][j];
      if (a !== b) idx.push(a, c, b);
      if (c !== d) idx.push(a, d, c);
    }
  }

  // Keep clear of the cover: compress anything near its inner surface (as the diaphragm molds the liver)
  const [kA, kB, kC] = [CA * 0.985, CB * 0.985, CC * 0.985];
  for (let i = 0; i < pos.length; i += 3) {
    const f = Math.cbrt(cube(pos[i] / kA) + cube(pos[i + 1] / kB) + cube(pos[i + 2] / kC));
    if (f > 0.94) {
      const g = 0.94 + 0.06 * Math.tanh((f - 0.94) / 0.06);
      pos[i] *= g / f; pos[i + 1] *= g / f; pos[i + 2] *= g / f;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return outward(geo);
}

/* ---------------------------------------------------------------- build */

export function buildHepatobiliary() {
  // Gallbladder centerline, extended past the fundus center to its tip
  const GB = gbCenters();
  const gbLine = GB.map((p) => p.slice());
  const head = new THREE.Vector3(...GB[0]), next = new THREE.Vector3(...GB[1]);
  const tip = head.clone().addScaledVector(head.clone().sub(next).normalize(), GB_FUNDUS);
  gbLine.unshift(tip.toArray());

  const liverGeo = buildLiver(gbLine);

  // Falciform ligament: a low fin on the anterior surface from the umbilical notch over the dome,
  // with the ligamentum teres leaving the notch toward the umbilicus
  const falcPts = [[-0.42, -1.52], [-0.37, -1.95], [-0.31, -2.4], [-0.27, -2.75], [-0.25, -2.98]].map(([x, z]) => [x, anterior(x, z) - 0.02, z]);
  const falciform = sweep(falcPts, {
    segments: 36, radial: 8,
    section: (t, a) => { const h = 0.075 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6; return [0.01 + h * (0.5 + 0.5 * Math.cos(a)), 0.018 * Math.sin(a)]; },
  });
  const notchY = anterior(-0.42, -1.4);
  const teres = sweep([[-0.43, notchY - 0.22, -1.62], [-0.42, notchY - 0.14, -1.4], [-0.4, notchY - 0.09, -1.22], [-0.39, notchY - 0.05, -1.12]], {
    segments: 14, radial: 10, section: roundTube((t) => 0.042 * roundEnd(1 - t, 0.2)),
  });
  const liver = new THREE.Mesh(mergeGeometries([liverGeo, falciform, teres]), mat('#7a2229', { scale: 0.9, mottle: 0.22 }));

  // Gallbladder: pear-shaped, fundus peeking below the inferior border, neck at the porta
  const gallbladder = new THREE.Mesh(
    sweep(gbLine, {
      segments: 56, radial: 20, caps: [0.17, 10, 0.05, 4],
      section: roundTube((t) => gbRadius(t) * roundEnd(t, 0.17) * roundEnd(1 - t, 0.05)),
    }),
    mat('#5f8247', { scale: 1.8, glow: 0.5 })
  );

  // Biliary tree: right and left hepatic ducts -> common hepatic duct -> (cystic duct) -> common bile
  // duct, which runs behind the duodenum and ends at the ampulla (shared point with the Upper GI module)
  const porta = visceral(-0.78, -1.86);
  const conf = [-0.8, porta - 0.1, -1.8];
  const junction = [-0.9, 1.0, -1.3];
  const AMPULLA = [-1.05, 0.6, -0.35];
  const duct = (pts, r0, r1, seg = 20) => sweep(pts, { segments: seg, radial: 8, section: roundTube((t) => mix(r0, r1, t) * roundEnd(t, 0.06) * roundEnd(1 - t, 0.06)) });
  const into = (x, z) => [x, visceral(x, z) + 0.06, z]; // starts just inside the liver
  const rhd = duct([into(-1.02, -1.96), [-0.94, porta - 0.04, -1.88], conf], 0.055, 0.065, 14);
  const lhd = duct([into(-0.4, -1.86), [-0.52, porta - 0.02, -1.86], conf], 0.055, 0.065, 14);
  const cbd = duct([conf, [-0.84, 1.18, -1.56], junction, [-0.96, 0.72, -1.06], [-1.01, 0.53, -0.8], [-1.04, 0.52, -0.55], AMPULLA], 0.07, 0.08, 56);
  // Cystic duct: leaves the gallbladder neck, turns down alongside the hepatic duct with a gentle
  // spiral (the valves of Heister), and joins it from the right
  const neck = gbLine[gbLine.length - 1];
  const course = new THREE.CatmullRomCurve3([[neck[0] - 0.03, neck[1], neck[2]], [-0.92, 1.2, -1.76], [-0.99, 1.12, -1.6], [-0.97, 1.05, -1.44], [junction[0] - 0.02, junction[1] + 0.02, junction[2] - 0.03]].map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const cyst = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, p = course.getPointAt(t), amp = 0.022 * Math.sin(Math.PI * t);
    cyst.push([p.x + amp * Math.cos(t * 16), p.y + amp * Math.sin(t * 16), p.z]);
  }
  const cystic = duct(cyst, 0.048, 0.042, 36);
  const ducts = new THREE.Mesh(mergeGeometries([rhd, lhd, cbd, cystic]), mat('#7d8f4a', { scale: 2.2, glow: 0.45 }));

  // Portal triad stubs at the porta: portal vein behind the duct, hepatic artery to its left, the
  // right hepatic artery crossing behind the common hepatic duct. Cut where the ligament is trimmed.
  // A trimmed vessel: flat, slightly beveled cut at its start, rounded where it enters the liver
  const vessel = (pts, r0, r1, seg = 18, radial = 10) => sweep(pts, {
    segments: seg, radial,
    section: roundTube((t) => mix(r0, r1, t) * (t < 0.5 / seg ? 0.86 : 1) * roundEnd(1 - t, 0.08)),
  });
  const fork = [-0.7, porta - 0.16, -1.78];
  const portal = new THREE.Mesh(mergeGeometries([
    vessel([[-0.6, 0.84, -1.26], [-0.66, 1.02, -1.5], fork], 0.13, 0.125, 16, 12),
    vessel([fork, [-0.9, porta - 0.12, -1.86], into(-1.08, -1.98)], 0.1, 0.085, 12),
    vessel([fork, [-0.52, porta - 0.1, -1.86], into(-0.36, -1.9)], 0.095, 0.08, 12),
  ]), mat('#3c5d8c', { scale: 2.4, glow: 0.6 }));
  const split = [-0.62, porta - 0.08, -1.74];
  const artery = new THREE.Mesh(mergeGeometries([
    vessel([[-0.44, 1.0, -1.3], [-0.56, 1.16, -1.55], split], 0.045, 0.042, 14, 8),
    vessel([split, [-0.86, porta - 0.2, -1.8], [-1.0, porta - 0.12, -1.88], into(-1.14, -1.99)], 0.036, 0.034, 16, 8),
    vessel([split, [-0.5, porta - 0.06, -1.82], into(-0.46, -1.94)], 0.034, 0.032, 10, 8),
  ]), mat('#b3282f', { scale: 2.4, glow: 0.6 }));

  return { meshes: [liver, gallbladder, ducts, portal, artery] };
}
