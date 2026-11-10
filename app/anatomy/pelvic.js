import { THREE, tube, capped, hydrogel, noise3 } from './kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mat = (c, o = {}) => hydrogel(c, o);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/* Same as the kit's blob(), but the welded unit sphere is built once per detail level and
   shared (welding with numeric keys is several times faster than the generic mergeVertices) */
const spheres = new Map();
function unitSphere(detail) {
  if (spheres.has(detail)) return spheres.get(detail);
  const src = new THREE.IcosahedronGeometry(1, detail).attributes.position.array;
  const keyOf = new Map(), pos = [], index = new Uint32Array(src.length / 3);
  for (let i = 0; i < src.length; i += 3) {
    const k = `${Math.round(src[i] * 1e4)},${Math.round(src[i + 1] * 1e4)},${Math.round(src[i + 2] * 1e4)}`;
    let id = keyOf.get(k);
    if (id === undefined) { id = pos.length / 3; keyOf.set(k, id); pos.push(src[i], src[i + 1], src[i + 2]); }
    index[i / 3] = id;
  }
  const s = { pos: Float32Array.from(pos), index: new THREE.BufferAttribute(index, 1) };
  spheres.set(detail, s);
  return s;
}
function blob({ detail = 4, freq = 1.6, seed = 0, deform }) {
  const { pos: unit, index } = unitSphere(detail);
  const out = new Float32Array(unit.length);
  for (let i = 0; i < unit.length; i += 3) {
    const x = unit[i], y = unit[i + 1], z = unit[i + 2];
    const p = deform(x, y, z, noise3(x * freq + seed, y * freq - seed * 0.7, z * freq + seed * 1.3));
    out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(index.clone());
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

/* Pelvic module: anteverted, anteflexed uterus with cervix and upper vagina (fibroid morph
   target plus fibroid nodules), fallopian tubes with fimbriae, ovaries with their ligaments,
   round ligaments, and an empty bladder.
   Contract used by abdomen-model.js: uterus.morphTargetInfluences[0] drives the fibroid shape;
   fibroids is a Group of nodes whose scale abdomen-model.js animates from ~0 to 1.
   Frame: +x patient's left, +y anterior (up off the tray), -z cranial, +z caudal. 1 unit ~ 3.5 cm. */

/* ------------------------------------------------------------ uterus body
   One continuous surface swept along a bent midline (sagittal plane, x = 0): the upper vagina
   runs cranially above the rectum, bends up into the cervix (anteversion), and the body flexes
   forward over the bladder (anteflexion), closing in a broad fundus.
   Each control point: [y, z, half-width, anterior half-thickness, posterior half-thickness, squareness] */
const MIDLINE = [
  [0.79, 3.42, 0.31, 0.13, 0.13, 2.6], // upper vagina, cut at the module edge
  [0.79, 3.18, 0.33, 0.14, 0.14, 2.6],
  [0.83, 2.94, 0.38, 0.17, 0.21, 2.4], // vaginal vault (fornices)
  [1.03, 2.71, 0.35, 0.29, 0.31, 2.1], // cervix
  [1.24, 2.51, 0.36, 0.26, 0.29, 2.1], // isthmus
  [1.54, 2.33, 0.55, 0.29, 0.36, 2.3], // lower body
  [1.94, 2.14, 0.63, 0.31, 0.38, 2.4], // fundus at the cornua
  [2.32, 1.99, 0.62, 0.29, 0.36, 2.4], // fundus apex
];
const FUNDUS_CAP = 0.5;
const VAULT_CAP = 0.1;

function buildUterusSweep() {
  const curve = new THREE.CatmullRomCurve3(MIDLINE.map(([y, z]) => V(0, y, z)), false, 'centripetal');
  const prof = new THREE.CatmullRomCurve3(MIDLINE.map((p) => V(p[2], p[3], p[4])), false, 'catmullrom', 0.5);
  const sq = new THREE.CatmullRomCurve3(MIDLINE.map((p) => V(p[5], 0, 0)), false, 'catmullrom', 0.5);
  const L = curve.getLength();
  const X = V(1, 0, 0);

  // Ring stations along the midline: tight near the rounded ends
  const stations = [];
  const nV = 4, nF = 11;
  for (let k = 1; k <= nV; k++) stations.push(VAULT_CAP * (1 - Math.cos((k / nV) * Math.PI / 2)));
  const span = L - FUNDUS_CAP - VAULT_CAP;
  const nMid = Math.ceil(span / 0.05);
  for (let k = 1; k < nMid; k++) stations.push(VAULT_CAP + span * (k / nMid));
  for (let k = nF; k >= 1; k--) stations.push(L - FUNDUS_CAP * (1 - Math.cos((k / nF) * Math.PI / 2)));

  const capF = (s) => {
    const dF = L - s, dV = s;
    let c = 1;
    if (dF < FUNDUS_CAP) { const u = 1 - dF / FUNDUS_CAP; c *= Math.pow(Math.max(0, 1 - Math.pow(u, 2)), 1 / 2); }
    if (dV < VAULT_CAP) { const u = 1 - dV / VAULT_CAP; c *= Math.sqrt(Math.max(0, 1 - u * u)); }
    return c;
  };
  // Cross-section frame at arc length s: center, anterior direction, profile
  const station = (s) => {
    const t = curve.getUtoTmapping(Math.min(Math.max(s / L, 0), 1));
    const T = curve.getTangent(t);
    return { s, P: curve.getPoint(t), N: V(0, 0, 0).crossVectors(X, T).normalize(), pr: prof.getPoint(t), e: 2 / sq.getPoint(t).x, k: capF(s) };
  };
  // Point on the surface of a cross-section at angle phi (0 = patient's left, pi/2 = anterior side)
  const ringPoint = (st, phi, out) => {
    const c = Math.cos(phi), si = Math.sin(phi);
    const sx = Math.sign(c) * Math.pow(Math.abs(c), st.e), sy = Math.sign(si) * Math.pow(Math.abs(si), st.e);
    // Cornua: the fundus juts out a little at its upper lateral angles
    const dF = L - st.s;
    const corn = 1 + 0.05 * Math.exp(-(((dF - 0.34) / 0.12) ** 2)) * Math.pow(Math.abs(c), 6);
    const b = si > 0 ? st.pr.y : st.pr.z;
    return out.copy(st.P).addScaledVector(X, st.pr.x * sx * st.k * corn).addScaledVector(st.N, b * sy * st.k);
  };
  const at = (s, phi, out = V(0, 0, 0)) => ringPoint(station(s), phi, out);

  const R = 46;
  const pos = [];
  const q = V(0, 0, 0), d = V(0, 0, 0);
  for (const s of stations) {
    const st = station(s);
    for (let j = 0; j < R; j++) {
      ringPoint(st, (j / R) * Math.PI * 2, q);
      // Faint irregularity, like a hand-finished cast
      const n = noise3(q.x * 3.1 + 4.1, q.y * 3.1 - 1.7, q.z * 3.1 + 0.6);
      d.copy(q).sub(st.P);
      q.addScaledVector(d, (0.012 * n) / (d.length() || 1));
      pos.push(q.x, q.y, q.z);
    }
  }
  const P = V(0, 0, 0);
  const idx = [];
  const rings = stations.length;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * R + j, b = (i + 1) * R + j, c = (i + 1) * R + ((j + 1) % R), d = i * R + ((j + 1) % R);
      idx.push(a, b, d, b, c, d);
    }
  }
  const start = pos.length / 3;
  curve.getPoint(0, P); pos.push(P.x, P.y, P.z);
  curve.getPoint(1, P); pos.push(P.x, P.y, P.z);
  const last = (rings - 1) * R;
  for (let j = 0; j < R; j++) {
    idx.push(start, j, (j + 1) % R);
    idx.push(start + 1, last + ((j + 1) % R), last + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  // Surface frame helper: point and outward normal at (s, phi)
  const frame = (s, phi) => {
    const p = at(s, phi, V(0, 0, 0));
    const ds = at(s + 0.01, phi, V(0, 0, 0)).sub(at(s - 0.01, phi, V(0, 0, 0)));
    const dp = at(s, phi + 0.01, V(0, 0, 0)).sub(at(s, phi - 0.01, V(0, 0, 0)));
    const n = V(0, 0, 0).crossVectors(dp, ds).normalize();
    const t = curve.getUtoTmapping(s / L);
    if (n.dot(p.clone().sub(curve.getPoint(t))) < 0) n.negate();
    return { p, n };
  };
  return { geometry: g, frame, L };
}

/* Smooth union of the uterine surface with fibroid spheres, as a morph target: each vertex
   slides out along its normal to where smin(uterus, spheres) = 0 (uterus taken as locally flat). */
function fibroidMorph(geometry, sites) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal;
  const out = new Float32Array(pos.array.length);
  const p = V(0, 0, 0), n = V(0, 0, 0), x = V(0, 0, 0);
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const field = (t) => {
      x.copy(p).addScaledVector(n, t);
      let d = t;
      for (const f of sites) d = smin(d, x.distanceTo(f.c) - f.hump, f.k);
      return d;
    };
    let push = 0;
    if (field(0) < 0) {
      let lo = 0, hi = 1.2;
      for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (field(mid) < 0) lo = mid; else hi = mid; }
      push = lo;
    }
    out[i * 3] = p.x + n.x * push; out[i * 3 + 1] = p.y + n.y * push; out[i * 3 + 2] = p.z + n.z * push;
  }
  const tmp = new THREE.BufferGeometry();
  tmp.setIndex(geometry.index);
  tmp.setAttribute('position', new THREE.BufferAttribute(out, 3));
  tmp.computeVertexNormals();
  geometry.morphAttributes.position = [tmp.attributes.position];
  geometry.morphAttributes.normal = [tmp.attributes.normal];
}

/* Tube through points with a radius profile r(t); a thin wrapper that keeps ends rounded */
const cord = (pts, r, { segments = 40, radial = 8, end = 0.06 } = {}) =>
  tube(pts, { segments, radial, radius: (t, a) => r(t, a) * capped(t, end) });

/* Small curved finger (a fimbria) along a quadratic Bezier: much cheaper than a full tube()
   (no arc-length tables), and plenty for something this short */
function finger(p0, p1, p2, r, { segments = 6, radial = 5, end = 0.4 } = {}) {
  const pos = [], idx = [];
  const P = V(0, 0, 0), T = V(0, 0, 0), N = V(0, 0, 0), B = V(0, 0, 0);
  const ref = V(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, u = 1 - t;
    P.set(0, 0, 0).addScaledVector(p0, u * u).addScaledVector(p1, 2 * u * t).addScaledVector(p2, t * t);
    T.set(0, 0, 0).addScaledVector(p1.clone().sub(p0), 2 * u).addScaledVector(p2.clone().sub(p1), 2 * t).normalize();
    if (i === 0) { if (Math.abs(T.dot(ref)) > 0.9) ref.set(1, 0, 0); N.crossVectors(ref, T).normalize(); }
    else N.addScaledVector(T, -N.dot(T)).normalize(); // carry the frame along (no twist)
    B.crossVectors(T, N);
    const rr = r(t) * capped(t, end);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(P.x + rr * (c * N.x + s * B.x), P.y + rr * (c * N.y + s * B.y), P.z + rr * (c * N.z + s * B.z));
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = (i + 1) * radial + j, c = (i + 1) * radial + ((j + 1) % radial), d = i * radial + ((j + 1) % radial);
    idx.push(a, d, b, b, d, c);
  }
  const start = pos.length / 3, last = segments * radial;
  pos.push(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z);
  for (let j = 0; j < radial; j++) {
    idx.push(start, (j + 1) % radial, j);
    idx.push(start + 1, last + j, last + ((j + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildPelvic() {
  /* ---------------- uterus, cervix, upper vagina */
  const U = buildUterusSweep();
  const L = U.L;
  // Landmarks by distance from the fundus apex (arc length along the midline)
  const sCornu = L - 0.3;
  const left = 0, ant = Math.PI / 2, post = -Math.PI / 2;

  // Fibroids: [distance from apex, angle around the body, radius, how far the center sits out
  // from the surface (fraction of radius), hump radius (fraction of radius)]
  const fibroidSpec = [
    { d: 0.44, phi: ant - 0.3, r: 0.42, out: 0.2, hump: 1, peek: 0.4, size: 0.76 },  // large intramural/subserosal, anterior fundus, slightly left
    { d: 0.36, phi: Math.PI - 0.22, r: 0.25, out: 0.45, hump: 0.85, peek: 0.35, size: 0.85 }, // subserosal, right fundal angle
    { d: 0.92, phi: ant + 0.45, r: 0.17, out: 0.25, hump: 1, peek: 0.42, size: 0.78 },  // small one, anterior lower body, right
  ];
  const sites = fibroidSpec.map((f) => {
    const { p, n } = U.frame(L - f.d, f.phi);
    const c = p.clone().addScaledVector(n, f.r * f.out);
    // The pale nodule sits a little proud of the red bulge: only its crown shows through
    return { c, r: f.r, hump: f.r * f.hump, k: f.r * 0.55, n, node: c.clone().addScaledVector(n, f.r * f.peek), size: f.r * f.size };
  });
  fibroidMorph(U.geometry, sites);

  const uterus = new THREE.Mesh(U.geometry, mat('#c8283a', { scale: 1.1, mottle: 0.15 }));
  uterus.morphTargetInfluences = [0];

  /* ---------------- adnexa: tubes with fimbriae, ovaries, ovarian and round ligaments */
  const tubeGeos = [], ovaryGeos = [], ligGeos = [], meso = [];
  for (const side of [-1, 1]) {
    const sideAng = side > 0 ? left : Math.PI;
    const toward = (a) => (side > 0 ? a : Math.PI - a); // mirror an angle for the right side
    const cornu = U.frame(sCornu, sideAng);

    // Ovary: almond-shaped, posterolateral, long axis from its uterine pole (medial, caudal)
    // to its tubal pole (lateral, cranial); a few follicles bulge the surface
    const oC = V(side * 1.13, 1.18, 2.36);
    const follicles = [[0.5, 0.6, 0.6, 0.22], [-0.3, 0.75, -0.55, 0.18], [0.1, -0.7, 0.7, 0.16], [-0.7, 0.3, 0.6, 0.15], [0.75, -0.2, -0.6, 0.17], [-0.2, -0.5, -0.8, 0.14], [0.2, 0.95, 0.1, 0.13]];
    const ovGeo = blob({
      detail: 6, seed: 2.7 * side, freq: 2.2,
      deform: (x, y, z, n) => {
        let b = 0;
        for (const [fx, fy, fz, s] of follicles) b += 0.12 * Math.exp(-((x - fx) ** 2 + (y - fy) ** 2 + (z - fz) ** 2) / (s * s));
        const r = 1 + 0.035 * n + b;
        return [x * 0.4 * r, y * 0.2 * r, z * 0.24 * r];
      },
    });
    const ovRot = new THREE.Euler(0.15, side * 1.15, side * 0.32, 'YXZ');
    ovGeo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(ovRot));
    ovGeo.translate(oC.x, oC.y, oC.z);
    const axis = V(1, 0, 0).applyEuler(ovRot); // long axis (points lateral for left, medial for right)
    const ovLat = oC.clone().addScaledVector(axis, side * 0.38); // tubal pole
    const ovMed = oC.clone().addScaledVector(axis, -side * 0.38); // uterine pole
    ovaryGeos.push(ovGeo);

    // Fallopian tube: narrow isthmus running laterally from the cornu, widening ampulla arching
    // over the tubal pole of the ovary and down its posterior border, flared infundibulum
    const t0 = cornu.p.clone().addScaledVector(cornu.n, -0.06);
    const tubePts = [
      t0,
      V(side * 0.86, 2.06, 2.08),
      V(side * 1.12, 2.0, 2.06),
      V(side * 1.42, 1.86, 2.12),
      V(side * 1.64, 1.6, 2.24),
      V(side * 1.72, 1.32, 2.2),
      V(side * 1.64, 1.14, 2.07),
      V(side * 1.48, 1.17, 1.98),
    ];
    const tubeCurve = new THREE.CatmullRomCurve3(tubePts, false, 'centripetal');
    tubeGeos.push(tube(tubePts, {
      segments: 72, radial: 10,
      radius: (t) => {
        const isth = 0.058 + 0.03 * Math.exp(-((t / 0.06) ** 2)); // cornual flare where it enters
        const amp = sstep(0.28, 0.6, t) * 0.038 + Math.pow(sstep(0.82, 1, t), 2) * 0.1;
        const ripple = 1 + 0.035 * Math.sin(t * 70) * sstep(0.3, 0.5, t);
        return (isth + amp) * ripple * capped(t, 0.03);
      },
    }));

    // Fimbriae: tapered fingers fanning from the infundibulum, curling toward the ovary
    const end = tubeCurve.getPoint(1), tan = tubeCurve.getTangent(1);
    const u = V(0, 0, 0).crossVectors(tan, V(0, 0, 1)).normalize();
    const w = V(0, 0, 0).crossVectors(tan, u).normalize();
    const toOv = ovLat.clone().sub(end).normalize();
    // A frilly fringe opening like a flower around the ostium, fronds curling back at the tips
    const nF = 13;
    for (let k = 0; k < nF; k++) {
      const a = (k / nF) * Math.PI * 2 + 0.3 + 0.12 * Math.sin(k * 3.7);
      const radial = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
      const len = 0.13 + 0.05 * Math.sin(k * 2.3 + side) + 0.04 * (k % 2);
      const base = end.clone().addScaledVector(tan, -0.05).addScaledVector(radial, 0.085);
      const mid = base.clone().addScaledVector(tan, len * 0.4).addScaledVector(radial, len * 0.45);
      const tip = mid.clone().addScaledVector(tan, len * 0.05).addScaledVector(radial, len * 0.5).addScaledVector(toOv, len * 0.2);
      tubeGeos.push(finger(base, mid, tip, (t) => 0.03 * (1 - 0.1 * t), { end: 0.28 }));
    }
    // Ovarian fimbria: the one long finger that reaches the tubal pole of the ovary
    {
      const base = end.clone().addScaledVector(tan, -0.04);
      const tip = ovLat.clone().addScaledVector(axis, -side * 0.06).add(V(0, 0.08, 0));
      const mid = base.clone().lerp(tip, 0.5).add(V(0, 0.02, 0.04));
      tubeGeos.push(finger(base, mid, tip, (t) => 0.036 * (1 - 0.35 * t), { segments: 12, radial: 6, end: 0.1 }));
    }

    // Ovarian ligament: uterine pole of the ovary to the uterus, just below and behind the tube
    const olA = U.frame(sCornu - 0.2, toward(-0.6));
    ligGeos.push(cord([
      olA.p.clone().addScaledVector(olA.n, -0.05),
      olA.p.clone().addScaledVector(olA.n, 0.12).lerp(ovMed, 0.25),
      ovMed.clone().addScaledVector(axis, side * 0.06),
    ], (t) => 0.052 - 0.012 * t, { segments: 16, radial: 7, end: 0.08 }));

    // Infundibulopelvic (suspensory) ligament: carries the ovarian vessels from the tubal pole of
    // the ovary up over the pelvic brim
    ligGeos.push(cord([
      ovLat.clone().lerp(oC, 0.25),
      ovLat.clone().add(V(side * 0.14, -0.04, -0.14)),
      V(side * 1.5, 1.0, 1.72),
      V(side * 1.58, 0.86, 1.5),
    ], (t) => 0.05 * (1 - 0.25 * t) * (1 + 0.3 * Math.exp(-((t / 0.1) ** 2))), { segments: 22, radial: 7, end: 0.07 }));

    // Mesosalpinx: the thin fold of broad ligament the tube hangs from, webbing the tube to the
    // ovarian ligament and the ovary below it
    {
      const olCurve = new THREE.CatmullRomCurve3([
        olA.p.clone().addScaledVector(olA.n, -0.02),
        olA.p.clone().addScaledVector(olA.n, 0.12).lerp(ovMed, 0.25),
        ovMed.clone().lerp(oC, 0.3),
        oC.clone().add(V(0, 0.04, 0)),
        ovLat.clone().lerp(oC, 0.3),
      ], false, 'centripetal');
      const nu = 22, nv = 6;
      const pts = [];
      const A = V(0, 0, 0), B = V(0, 0, 0);
      for (let i = 0; i <= nu; i++) {
        const t = i / nu;
        tubeCurve.getPointAt(0.05 + 0.6 * t, A);
        olCurve.getPointAt(t, B);
        for (let j = 0; j <= nv; j++) {
          const v = j / nv;
          const p = A.clone().lerp(B, v);
          // slight sag toward the back, like a draped membrane
          p.y -= 0.05 * Math.sin(Math.PI * v) * Math.sin(Math.PI * t);
          pts.push(p.x, p.y, p.z);
        }
      }
      const idx = [];
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a0 = i * (nv + 1) + j, a1 = a0 + nv + 1;
        if (side > 0) idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1); else idx.push(a0, a0 + 1, a1, a1, a0 + 1, a1 + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      meso.push(g);
    }

    // Round ligament: from just below and in front of the tube, anterolaterally over the pelvic
    // brim toward the deep inguinal ring
    const rlA = U.frame(sCornu - 0.2, toward(0.55));
    ligGeos.push(cord([
      rlA.p.clone().addScaledVector(rlA.n, -0.05),
      rlA.p.clone().addScaledVector(rlA.n, 0.2).add(V(0, -0.05, 0.05)),
      V(side * 1.08, 1.62, 2.66),
      V(side * 1.42, 1.42, 3.02),
      V(side * 1.78, 1.3, 3.38),
    ], (t) => 0.03 * (1 + 0.5 * Math.exp(-((t / 0.08) ** 2))) * (1 - 0.2 * t), { segments: 34, radial: 7, end: 0.05 }));
  }
  const tubeMat = mat('#c43a47', { scale: 2.4, glow: 0.7 });
  const tubes = new THREE.Mesh(mergeGeometries(tubeGeos), tubeMat);
  const ovaries = new THREE.Mesh(mergeGeometries(ovaryGeos), mat('#c98676', { scale: 2.2, mottle: 0.2 }));
  const ligaments = new THREE.Mesh(mergeGeometries(ligGeos), mat('#c9505b', { scale: 2.6, glow: 0.5 }));
  const mesoMat = mat('#cf5a64', { scale: 2.6, glow: 0.9, bump: 0.3, edge: 0.12 });
  mesoMat.side = THREE.DoubleSide;
  const mesosalpinx = new THREE.Mesh(mergeGeometries(meso), mesoMat);
  uterus.add(tubes, ovaries, ligaments, mesosalpinx);

  /* ---------------- fibroid nodules: pale, firm, whorled, partly embedded at the bulges */
  const fibroids = new THREE.Group();
  const fibroidMat = hydrogel('#e3a7ab', { roughness: 0.56, scale: 1.6, mottle: 0.22, marble: 0.75, glow: 0.35 });
  sites.forEach((f, i) => {
    const node = new THREE.Mesh(
      blob({ detail: 5, seed: 3.1 + i * 5.3, freq: 2.4, deform: (x, y, z, n) => { const r = f.size * (1 + 0.025 * n); return [x * r, y * r * 0.97, z * r]; } }),
      fibroidMat
    );
    node.position.copy(f.node);
    node.userData.home = node.position.clone();
    node.scale.setScalar(0.001);
    fibroids.add(node);
  });
  uterus.add(fibroids);

  /* ---------------- bladder: empty and flattened, behind the pubis, on the anterior vaginal
     wall; its dome is pressed in where the uterine body rests on it */
  const bladder = new THREE.Mesh(
    blob({
      detail: 9, seed: 3.3,
      deform: (x, y, z, n) => {
        const r = 1 + 0.03 * n;
        // flatter top, broader base; dome dented by the uterus (cranial-upper surface)
        // empty bladder: the dome sags into a shallow saucer
        const yy = (y > 0 ? y * 0.78 : y) - 0.2 * Math.exp(-((x / 0.7) ** 2) - ((z / 0.75) ** 2)) * sstep(0.1, 0.9, y);
        const dent = 0.22 * Math.exp(-((x / 0.75) ** 2)) * sstep(0.1, 0.9, -z) * sstep(-0.3, 0.6, y);
        const wide = 1 + 0.12 * Math.max(0, -y);
        return [x * 0.56 * r * wide, yy * 0.27 * r, (z + dent) * 0.4 * r];
      },
    }),
    mat('#a5814b', { glow: 0.6, mottle: 0.12 })
  );
  bladder.position.set(0, 1.07, 3.3);
  bladder.rotation.x = -0.25;

  return { meshes: [uterus, bladder], uterus, fibroids };
}
