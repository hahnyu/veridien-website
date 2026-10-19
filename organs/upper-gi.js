import { THREE, tube, capped, hydrogel, noise3, smooth } from '../anatomy-kit.js';

const mat = (c, o = {}) => hydrogel(c, o);
const V = (p) => new THREE.Vector3(...p);

/* Upper GI module: stomach with abdominal esophagus and duodenum, pancreas, spleen.
   Frame: +x patient's left, +y anterior (up off the tray), -z cranial, +z caudal. 1 unit ~ 3.5 cm.
   The stomach and pancreas are lofted between two border rails (the lesser and greater
   curvatures; the pancreas's inner and outer borders), so a short concave border can fan
   around a long convex one without the surface folding over itself. */

/* ------------------------------------------------------------ helpers */

// Uniform Catmull-Rom through numbers or vectors, indexed like a CatmullRomCurve3's getPoint
function railOf(points) {
  const c = new THREE.CatmullRomCurve3(points.map(V), false, 'centripetal');
  return (s) => c.getPoint(Math.min(1, Math.max(0, s)));
}
function scalarOf(values) {
  const n = values.length - 1;
  return (s) => {
    const f = Math.min(n - 1e-6, Math.max(0, s * n));
    const i = Math.floor(f), t = f - i;
    const p0 = values[Math.max(0, i - 1)], p1 = values[i], p2 = values[i + 1], p3 = values[Math.min(n, i + 2)];
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  };
}

/* Surface lofted between rail L (theta = pi) and rail G (theta = 0), half-thickness hA toward the
   anterior hint `up` and hP away from it. Optional rounded caps continue past either end. */
function fanLoft({ L, G, hA, hP, up = () => new THREE.Vector3(0, 1, 0), rows, radial, flat = 0.85, bias = 0.1, rowAt = (s) => s, cap0 = null, cap1 = null, displace = null, keep = 0.55 }) {
  const frame = (s) => {
    const l = L(s), g = G(s);
    const M = l.clone().add(g).multiplyScalar(0.5);
    const D = g.clone().sub(l).multiplyScalar(0.5);
    const e = 1e-3;
    const T = L(s + e).add(G(s + e)).sub(L(s - e)).sub(G(s - e)).normalize();
    const d = D.clone().normalize();
    const u = up(s).clone();
    u.addScaledVector(d, -u.dot(d)).normalize();
    const N = new THREE.Vector3().crossVectors(T, d).normalize();
    if (N.dot(u) < 0) N.negate();
    N.multiplyScalar(1 - keep).addScaledVector(u, keep);
    N.addScaledVector(d, -N.dot(d)).normalize();
    return { M, D, N, T, a: hA(s), p: hP(s), s };
  };
  const pos = [];
  const rings = [];
  // Point on the section at angle th (before displacement)
  const at = (f, th) => {
    const c = Math.cos(th), sn = Math.sin(th);
    const h = (sn >= 0 ? f.a : f.p) * Math.sign(sn) * Math.pow(Math.abs(sn), flat) * (1 + bias * c) / (1 + Math.abs(bias));
    return f.M.clone().addScaledVector(f.D, c).addScaledVector(f.N, h);
  };
  const push = (P, s, th, w) => {
    if (displace) {
      const r = P.clone().sub(w.center);
      const len = r.length() || 1;
      P.addScaledVector(r, displace(P, s, th, w.scale) / len);
    }
    pos.push(P.x, P.y, P.z);
    return pos.length / 3 - 1;
  };
  const ringAt = (f) => {
    const ring = [];
    for (let j = 0; j < radial; j++) { const th = (j / radial) * Math.PI * 2; ring.push(push(at(f, th), f.s, th, { center: f.M, scale: 1 })); }
    rings.push(ring);
  };
  /* Rounded cap past an end section: each surface line continues from the end ring with its own
     slope (cubic Hermite) and arrives level at the pole, so the dome joins the loft without a ridge. */
  const capAt = (f, cap, dirSign) => {
    const dir = f.T.clone().multiplyScalar(dirSign);
    if (cap.tilt) dir.add(V(cap.tilt)).normalize();
    const pole = f.M.clone().addScaledVector(dir, cap.len);
    const g = frame(f.s - dirSign * 0.01);
    const lines = [];
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const P0 = at(f, th);
      const t0 = P0.clone().sub(at(g, th)).normalize();
      const d = pole.clone().sub(P0);
      const m0 = t0.multiplyScalar(Math.PI / 2 * Math.max(0.25 * cap.len, d.dot(t0)) * (cap.bulge || 1));
      const m1 = d.clone().addScaledVector(dir, -d.dot(dir)).multiplyScalar(Math.PI / 2);
      lines.push([P0, m0, pole, m1, th]);
    }
    const out = [];
    for (let k = 1; k < cap.rings; k++) {
      const u = k / cap.rings, u2 = u * u, u3 = u2 * u;
      const [a0, b0, a1, b1] = [2 * u3 - 3 * u2 + 1, u3 - 2 * u2 + u, -2 * u3 + 3 * u2, u3 - u2];
      out.push(lines.map(([P0, m0, P1, m1, th]) => [P0.clone().multiplyScalar(a0).addScaledVector(m0, b0).addScaledVector(P1, a1).addScaledVector(m1, b1), th, 1 - u]));
    }
    return { out, pole, center: f.M };
  };
  const capRing = (list, center) => rings.push(list.map(([P, th, sc]) => push(P, 0, th, { center, scale: sc })));
  let pole0 = null, pole1 = null;
  const f0 = frame(rowAt(0)), f1 = frame(rowAt(1));
  if (cap0) {
    const { out, pole, center } = capAt(f0, cap0, -1);
    pole0 = pole;
    for (let k = out.length - 1; k >= 0; k--) capRing(out[k], center);
  }
  for (let i = 0; i <= rows; i++) ringAt(i === 0 ? f0 : i === rows ? f1 : frame(rowAt(i / rows)));
  if (cap1) {
    const { out, pole, center } = capAt(f1, cap1, 1);
    pole1 = pole;
    for (const r of out) capRing(r, center);
  }
  const idx = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < radial; j++) {
      const a = rings[r][j], b = rings[r + 1][j], c = rings[r + 1][(j + 1) % radial], d = rings[r][(j + 1) % radial];
      idx.push(a, d, b, b, d, c);
    }
  }
  const poleFan = (p, ring, flip) => {
    const k = pos.length / 3;
    pos.push(p.x, p.y, p.z);
    for (let j = 0; j < radial; j++) {
      const a = ring[j], b = ring[(j + 1) % radial];
      if (flip) idx.push(k, a, b); else idx.push(k, b, a);
    }
  };
  if (pole0) poleFan(pole0, rings[0], false);
  if (pole1) poleFan(pole1, rings[rings.length - 1], true);
  const geo = finish(pos, idx);
  // Undisplaced surface point pushed `off` outward from the section center (for laying vessels on it)
  geo.userData.on = (s, th, off = 0) => {
    const f = frame(s), P = at(f, th);
    return P.addScaledVector(P.clone().sub(f.M).normalize(), off);
  };
  return geo;
}

// Indexed geometry with outward-facing triangles (flips the winding if the volume comes out negative)
function finish(pos, idx) {
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
         - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
         + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Closed lat-long sphere through deform(x, y, z, n) like the kit's blob(), with its poles on the
   z axis (the long axis of the organ). Much cheaper to build than a finely subdivided icosphere. */
function ovoid({ rows = 40, cols = 48, freq = 1.6, seed = 0, deform }) {
  const pos = [], idx = [];
  const put = (x, y, z) => {
    const n = noise3(x * freq + seed, y * freq - seed * 0.7, z * freq + seed * 1.3);
    pos.push(...deform(x, y, z, n));
  };
  put(0, 0, -1);
  for (let i = 1; i < rows; i++) {
    const u = (i / rows) * Math.PI;
    for (let j = 0; j < cols; j++) { const v = (j / cols) * Math.PI * 2; put(Math.sin(u) * Math.cos(v), Math.sin(u) * Math.sin(v), -Math.cos(u)); }
  }
  put(0, 0, 1);
  const last = pos.length / 3 - 1;
  const at = (i, j) => 1 + (i - 1) * cols + (j % cols);
  for (let j = 0; j < cols; j++) idx.push(0, at(1, j + 1), at(1, j));
  for (let i = 1; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) idx.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
  }
  for (let j = 0; j < cols; j++) idx.push(last, at(rows - 1, j), at(rows - 1, j + 1));
  return finish(pos, idx);
}

// Concatenate closed shells into one geometry (one draw call per material)
function merge(geos) {
  const pos = [], idx = [];
  for (const g of geos) {
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    for (const i of g.index.array) idx.push(i + base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------ build */

export function buildUpperGI() {
  /* Stomach. Rails run from the fundus (cranial) to the pylorus; the fundus dome is a cap past
     the first section. L = lesser curvature (cardiac notch, cardia, incisura, pyloric canal),
     G = greater curvature. Index-matched sections. */
  const Lr = railOf([
    [1.38, 0.96, -2.94],  // cardiac notch (angle of His)
    [0.98, 1.02, -2.68],  // cardia
    [0.98, 1.16, -2.2],
    [1.08, 1.32, -1.62],
    [0.92, 1.4, -1.38],   // angular incisure
    [0.42, 1.45, -1.24],
    [-0.02, 1.38, -1.12],
    [-0.42, 1.16, -0.99], // pylorus
  ]);
  const Gr = railOf([
    [2.86, 0.92, -2.86],
    [3.08, 1.0, -2.36],
    [3.12, 1.16, -1.7],
    [2.85, 1.34, -0.95],
    [2.05, 1.44, -0.34],
    [0.98, 1.46, -0.3],
    [0.22, 1.38, -0.52],
    [-0.36, 1.16, -0.63],
  ]);
  const sA = scalarOf([0.66, 0.66, 0.63, 0.6, 0.56, 0.5, 0.37, 0.19]);
  const sP = scalarOf([0.56, 0.54, 0.47, 0.44, 0.42, 0.4, 0.3, 0.19]);
  const stomachGeo = fanLoft({
    L: Lr, G: Gr, hA: sA, hP: sP, rows: 84, radial: 40, flat: 0.8, bias: 0.12,
    cap0: { len: 0.66, rings: 10, tilt: [0.4, 0, 0] },
    displace: (p) => 0.012 * noise3(p.x * 2.2, p.y * 2.2, p.z * 2.2),
  });

  // Abdominal esophagus: from the hiatus down and to the left into the cardia, flaring at the junction
  const esophagusGeo = tube([[0.46, 0.96, -3.6], [0.68, 1.0, -3.2], [0.96, 1.03, -2.86], [1.32, 1.02, -2.64], [1.72, 0.99, -2.56]], {
    segments: 24, radial: 18,
    radius: (t) => (0.17 + 0.035 * smooth((t - 0.3) / 0.3)) * capped(t, 0.05),
  });

  // Duodenum: bulb, then the C-loop around the pancreatic head, ending at the duodenojejunal flexure
  const duodenumGeo = tube([
    [-0.14, 1.3, -0.83], [-0.42, 1.14, -0.81], [-0.72, 0.97, -0.87], [-1.0, 0.78, -0.9], [-1.15, 0.63, -0.62],
    [-1.16, 0.6, -0.3], [-1.12, 0.62, 0.0], [-0.98, 0.66, 0.28], [-0.7, 0.72, 0.45], [-0.3, 0.75, 0.52], [0.15, 0.76, 0.5],
    [0.5, 0.76, 0.32], [0.64, 0.76, 0.0], [0.65, 0.75, -0.35],
  ], {
    segments: 110, radial: 18,
    radius: (t) => {
      const ring = 0.035 * Math.exp(-(((t - 0.035) / 0.012) ** 2)); // pyloric sphincter
      const neck = -0.03 * Math.exp(-(((t - 0.06) / 0.015) ** 2));
      const bulb = 0.06 * Math.exp(-(((t - 0.12) / 0.05) ** 2));
      return (0.21 + ring + neck + bulb - 0.02 * t) * (t < 0.02 ? 0.85 + 7.5 * t : 1) * capped(t, 0.015);
    },
  });

  const gutMat = mat('#b85d4b', { scale: 1.1 });
  const stomach = new THREE.Mesh(merge([stomachGeo, esophagusGeo, duodenumGeo]), gutMat);

  /* Pancreas: lofted from the uncinate process, around the head inside the duodenal C,
     through the neck and body to the tail at the splenic hilum. I = inner border (the notch,
     then the inferior border), O = outer border (along the duodenum, then the superior border). */
  const Ir = railOf([
    [0.12, 0.62, 0.05], [-0.24, 0.66, -0.1], [-0.3, 0.7, -0.3], [-0.26, 0.74, -0.48], [-0.22, 0.78, -0.58],
    [-0.0, 0.8, -0.64], [0.38, 0.82, -0.74], [1.1, 0.8, -0.96], [1.9, 0.78, -1.32], [2.55, 0.78, -1.72], [3.06, 0.76, -2.06],
  ]);
  const Or = railOf([
    [0.1, 0.62, 0.27], [-0.42, 0.66, 0.3], [-0.88, 0.68, 0.11], [-0.96, 0.7, -0.3], [-0.84, 0.74, -0.66],
    [-0.28, 0.82, -1.04], [0.25, 0.85, -1.2], [1.0, 0.84, -1.58], [1.78, 0.83, -1.84], [2.42, 0.82, -2.1], [2.94, 0.78, -2.32],
  ]);
  const pA = scalarOf([0.13, 0.2, 0.26, 0.29, 0.27, 0.22, 0.21, 0.21, 0.2, 0.17, 0.13]);
  const pP = scalarOf([0.11, 0.17, 0.23, 0.25, 0.24, 0.2, 0.19, 0.18, 0.17, 0.15, 0.11]);
  const lobules = (p) => {
    const w = 0.07 * noise3(p.x * 3.1, p.y * 3.1, p.z * 3.1);
    const k = 17;
    const v = Math.sin((p.x + w) * k) * Math.sin((p.y - w) * k + 1.3) * Math.sin((p.z + w) * k + 0.7);
    return 0.028 * (Math.pow(Math.abs(v), 0.45) - 0.55);
  };
  const pancreasGeo = fanLoft({
      L: Ir, G: Or, hA: pA, hP: pP, rows: 100, radial: 26, flat: 0.75, bias: 0.05,
      cap0: { len: 0.1, rings: 4 }, cap1: { len: 0.16, rings: 5 },
      displace: (p, s, th, sc) => lobules(p) * sc,
    });
  const pancreas = new THREE.Mesh(pancreasGeo, mat('#bb8a4f', { scale: 2.2, bump: 0.8 }));

  /* Spleen: coffee-bean crescent. Convex diaphragmatic surface faces posterolaterally, the concave
     visceral surface (gastric impression in front, renal behind, hilum between) faces the stomach
     and pancreatic tail; the superior border is notched. */
  const ez = new THREE.Vector3(0.4, 0.25, 0.88).normalize();           // superior pole -> inferior pole
  const ex = new THREE.Vector3(0.96, -0.28, 0); // diaphragmatic surface
  ex.addScaledVector(ez, -ex.dot(ez)).normalize();
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();        // toward the superior border
  if (ey.y < 0) ey.negate();
  const spleenC = new THREE.Vector3(3.32, 0.66, -2.18);
  const [sa, sb, sc] = [1.2, 0.64, 0.38];
  const spleen = new THREE.Mesh(
    ovoid({
      rows: 44, cols: 50, seed: 2.4,
      deform: (x, y, z, n) => {
        const rim = Math.sqrt(Math.max(1e-4, 1 - z * z));
        const yr = y / rim;
        let X = sc * x * (1 - 0.35 * Math.max(0, yr)) + 0.5 * sc * (1 - yr * yr) * rim + 0.25 * sc * (1 - z * z);
        if (x < 0) {
          X += sc * 0.1 * Math.exp(-(((yr - 0.45) / 0.4) ** 2)) * rim;
          X += sc * 0.16 * Math.exp(-(((yr + 0.1) / 0.2) ** 2)) * Math.exp(-((z / 0.6) ** 2)) * -x;
        }
        // bean outline: convex notched superior border, straighter inferior border, blunt lower pole
        let Y = sb * y * (1 + 0.12 * z) + 0.22 * sb * (1 - z * z);
        const notch = [-0.46, -0.1, 0.3].reduce((m, zi) => m + Math.exp(-(((z - zi) / 0.09) ** 2)), 0);
        Y -= sb * 0.1 * notch * smooth((yr - 0.35) / 0.6);
        const Z = sa * z;
        const r = 1 + 0.02 * n;
        return [
          spleenC.x + (ex.x * X + ey.x * Y + ez.x * Z) * r,
          spleenC.y + (ex.y * X + ey.y * Y + ez.y * Z) * r,
          spleenC.z + (ex.z * X + ey.z * Y + ez.z * Z) * r,
        ];
      },
    }),
    mat('#5e2238', { scale: 1.4 })
  );

  /* Vessels: the celiac trunk (on the aorta when docked) with its three branches. The splenic
     artery winds along the pancreas's superior border to the hilum; the left gastric climbs to the
     cardia and runs down the lesser curvature to meet the right gastric; the common hepatic runs
     right to the gastroduodenal, which passes behind the bulb and becomes the right gastroepiploic
     along the greater curvature, joining the left gastroepiploic from the splenic hilum. */
  const vessel = (pts, r, perUnit = 16) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    return tube(pts, { segments: Math.max(8, Math.round(len * perUnit)), radial: 6, radius: (t) => r * capped(t, 0.04 / len) });
  };
  const arr = (v) => [v.x, v.y, v.z];
  const sOn = stomachGeo.userData.on, pOn = pancreasGeo.userData.on;
  const celiac = [0.3, 0.5, -1.36];
  const hilum = spleenC.clone().addScaledVector(ex, -0.02).addScaledVector(ey, 0.04);
  const intoHilum = (k) => arr(hilum.clone().addScaledVector(ez, k).addScaledVector(ex, 0.1));
  // splenic artery: tortuous along the superior border
  const splenic = [celiac, [0.42, 0.72, -1.4]];
  for (let i = 0; i <= 14; i++) {
    const s = 0.6 + 0.36 * (i / 14);
    const P = pOn(s, 0.35, 0.03);
    P.y += 0.04 * Math.sin(i * 1.7);
    P.z += -0.05 * Math.cos(i * 1.7);
    splenic.push(arr(P));
  }
  splenic.push(arr(hilum.clone().addScaledVector(ex, -0.18)), intoHilum(0));
  const hilarUp = [arr(hilum.clone().addScaledVector(ex, -0.18)), arr(hilum.clone().addScaledVector(ex, -0.08).addScaledVector(ez, -0.3)), intoHilum(-0.4)];
  const hilarDown = [arr(hilum.clone().addScaledVector(ex, -0.18)), arr(hilum.clone().addScaledVector(ex, -0.08).addScaledVector(ez, 0.3)), intoHilum(0.42)];
  // lesser-curvature arcade (left and right gastric), from the cardia to the pylorus
  const lesser = [];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    lesser.push(arr(sOn(0.1 + 0.84 * u, Math.PI - 0.55, 0.03 - 0.05 * Math.max(0, Math.abs(u - 0.5) * 2 - 0.85) / 0.15)));
  }
  // common hepatic -> gastroduodenal behind the bulb -> right and left gastroepiploic
  const hepatic = [celiac, [0.05, 0.74, -1.3], [-0.3, 0.84, -1.2], [-0.58, 0.86, -1.14], [-0.82, 0.86, -1.22]];
  const greater = [[-0.58, 0.86, -1.14], [-0.6, 0.7, -0.98], [-0.5, 0.78, -0.62], [-0.3, 1.0, -0.5]];
  for (let i = 0; i <= 16; i++) greater.push(arr(sOn(0.94 - 0.7 * (i / 16), 0.45 * (1 - 0.7 * smooth((i - 11) / 5)), 0.03)));
  // short gastrics: from the upper hilum across the gastrosplenic ligament to the fundus
  // (and the left gastroepiploic, the same kind of bridge from the lower hilum to the greater curvature)
  const shortGastric = (s, k, th = -0.35, r = 0.024, off = -0.01) => {
    const a = hilum.clone().addScaledVector(ex, -0.1).addScaledVector(ez, k), b = sOn(s, th, off);
    const m = a.clone().lerp(b, 0.5).addScaledVector(ey, 0.12);
    return vessel([arr(a.clone().addScaledVector(ex, 0.12)), arr(a), arr(m), arr(b)], r);
  };
  const arteries = new THREE.Mesh(
    merge([vessel(splenic, 0.05), vessel(hilarUp, 0.035), vessel(hilarDown, 0.035), vessel(lesser, 0.032), vessel(hepatic, 0.045), vessel(greater, 0.034), shortGastric(0.06, -0.55), shortGastric(0.16, -0.3), shortGastric(0.24, 0.45, 0.45 * 0.3, 0.032, 0.03)]),
    mat('#a8262f', { scale: 2.4, glow: 0.6 })
  );

  return { meshes: [stomach, pancreas, spleen, arteries] };
}
