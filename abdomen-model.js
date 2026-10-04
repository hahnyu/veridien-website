/* Modular abdominal simulator, built entirely in code.
   A base tray (with vessels and kidneys), a layered abdominal wall, and four swappable
   organ modules. Generic organs are shaped from noise-displaced spheres and variable-radius
   tubes, shaded as translucent hydrogel.

   update({ explode, swap, scan, time }) drives everything:
     explode 0..1  wall lifts off, then modules separate along their own vectors
     swap    0..1  pelvic uterus morphs from healthy to fibroid
     scan    0..1  imaging planes sweep through the pelvic module */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const CLINICAL = new THREE.Color('#4fa3d1');
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const easeInOut = (v) => { const t = clamp01(v); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

/* Cheap, deterministic organic noise (sum of sines), roughly -1..1 */
const noise3 = (x, y, z) =>
  Math.sin(x * 1.7 + 1.3) * Math.sin(y * 2.3 + 0.4) * Math.sin(z * 1.9 + 2.1) +
  0.5 * Math.sin(x * 3.1 + 0.7) * Math.sin(y * 3.7 + 1.9) * Math.sin(z * 2.9 + 0.2) +
  0.25 * Math.sin(x * 6.3 + 2.2) * Math.sin(y * 5.9 + 0.8) * Math.sin(z * 6.7 + 1.4);

/* ---------------------------------------------------------------- geometry */

/* Smooth closed organ: a unit sphere pushed through deform(x, y, z, n) -> [X, Y, Z],
   where n is a noise sample. An optional second deform becomes a morph target. */
function blob({ detail = 4, freq = 1.6, seed = 0, deform, morph = null }) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const unit = g.attributes.position.array.slice();
  const shapeWith = (fn) => {
    const out = new Float32Array(unit.length);
    for (let i = 0; i < unit.length; i += 3) {
      const x = unit[i], y = unit[i + 1], z = unit[i + 2];
      const n = noise3(x * freq + seed, y * freq - seed * 0.7, z * freq + seed * 1.3);
      const p = fn(x, y, z, n);
      out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
    }
    return out;
  };
  g.setAttribute('position', new THREE.BufferAttribute(shapeWith(deform), 3));
  g.computeVertexNormals();
  if (morph) {
    const tmp = new THREE.BufferGeometry();
    tmp.setIndex(g.index);
    tmp.setAttribute('position', new THREE.BufferAttribute(shapeWith(morph), 3));
    tmp.computeVertexNormals();
    g.morphAttributes.position = [tmp.attributes.position];
    g.morphAttributes.normal = [tmp.attributes.normal];
  }
  return g;
}

/* Tube along a smooth curve with radius(t, angle); ends taper closed. */
function tube(points, { segments = 240, radial = 18, radius }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [];
  const idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const r = radius(t, a);
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(P.x + r * (c * N.x + s * B.x), P.y + r * (c * N.y + s * B.y), P.z + r * (c * N.z + s * B.z));
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = (i + 1) * radial + j;
      const c = (i + 1) * radial + ((j + 1) % radial);
      const d = i * radial + ((j + 1) % radial);
      idx.push(a, d, b, b, d, c);
    }
  }
  const start = pos.length / 3;
  curve.getPointAt(0, P);
  pos.push(P.x, P.y, P.z);
  const end = start + 1;
  curve.getPointAt(1, P);
  pos.push(P.x, P.y, P.z);
  const last = segments * radial;
  for (let j = 0; j < radial; j++) {
    idx.push(start, (j + 1) % radial, j);
    idx.push(end, last + j, last + ((j + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Rounded ends for tube radius functions */
const capped = (t, edge = 0.04) => {
  const e = Math.min(t, 1 - t);
  return e >= edge ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow(1 - e / edge, 2)));
};

function roundedRect(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/* Boxy dome (upper half of a superellipsoid), like a torso trainer cover.
   Unit size; scale by (A, B, C). Exponent p > 2 squares off the sides. */
const DOME_P = 3.0;
function superDome(p = DOME_P, wSeg = 112, hSeg = 56) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = Math.pow(Math.abs(x) ** p + Math.abs(y) ** p + Math.abs(z) ** p, 1 / p);
    pos.setXYZ(i, x / k, y / k, z / k);
  }
  g.computeVertexNormals();
  return g;
}
function superOutline(a, c, p = DOME_P, steps = 160) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    pts.push(new THREE.Vector2(a * Math.sign(ct) * Math.abs(ct) ** (2 / p), c * Math.sign(st) * Math.abs(st) ** (2 / p)));
  }
  return pts;
}

/* ---------------------------------------------------------------- materials */

/* Translucent hydrogel: clearcoat + sheen, partial transmission on capable devices,
   and a fresnel rim so edges glow as if lit from behind. */
function hydrogel(color, { quality, rim = null, rimStrength = 0.42, transmission = 0.22, roughness = 0.3, opacity = 1, emissive = 0.04 }) {
  const base = new THREE.Color(color);
  const params = {
    color: base,
    roughness,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    sheen: 0.35,
    sheenRoughness: 0.5,
    sheenColor: base.clone().lerp(new THREE.Color('#ffffff'), 0.25),
    emissive: base.clone().multiplyScalar(emissive),
    envMapIntensity: 0.85,
  };
  if (quality === 'high' && opacity === 1) {
    Object.assign(params, {
      transmission,
      thickness: 1.4,
      ior: 1.36,
      attenuationColor: base.clone().multiplyScalar(0.55),
      attenuationDistance: 0.9,
    });
  } else {
    Object.assign(params, { transparent: opacity < 1 || quality !== 'high', opacity: opacity < 1 ? opacity : 0.94 });
  }
  const m = new THREE.MeshPhysicalMaterial(params);
  const rimColor = new THREE.Color(rim || base.clone().offsetHSL(0, 0.1, 0.18));
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
    shader.uniforms.rimStrength = { value: rimStrength };
    m.userData.shader = shader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float facing = clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 );
          totalEmissiveRadiance += rimColor * pow( 1.0 - facing, 2.6 ) * rimStrength;
        }`
      );
  };
  m.customProgramCacheKey = () => 'veridien-hydrogel';
  return m;
}

/* ---------------------------------------------------------------- organs */

function makeOrgans(quality) {
  const mat = (c, o = {}) => hydrogel(c, { quality, ...o });
  const parts = {};

  // Liver: large wedge, thick on the patient's right (viewer's left), flat underside
  parts.liver = new THREE.Mesh(
    blob({
      detail: 5, seed: 0.3,
      deform: (x, y, z, n) => {
        const right = (1 - x) / 2; // 1 at the patient's right (thick lobe), 0 at the left tip
        const thick = 0.22 + 0.95 * Math.pow(right, 0.85);
        const front = 1 - 0.55 * Math.max(0, z); // thinner toward the sharp anterior edge
        const yy = y < 0 ? y * 0.32 : y; // flat underside
        const depth = 0.7 + 0.85 * right;
        const r = 1 + 0.04 * n;
        return [x * 2.6 * r, yy * thick * front * 1.2 * r, z * depth * r];
      },
    }),
    mat('#6e1d24', { rimStrength: 0.4 })
  );
  parts.liver.position.set(-1.35, 1.35, -2.05);
  parts.liver.rotation.set(0.08, 0.12, -0.08);

  // Gallbladder: small pear tucked under the liver
  parts.gallbladder = new THREE.Mesh(
    blob({ seed: 1.1, deform: (x, y, z, n) => { const r = (0.82 + 0.22 * z) * (1 + 0.04 * n); return [x * 0.36 * r, y * 0.34 * r, z * 0.78]; } }),
    mat('#5f8a4e', { rimStrength: 0.55 })
  );
  parts.gallbladder.position.set(-1.25, 0.72, -0.95);
  parts.gallbladder.rotation.set(0.3, -0.5, 0.2);

  // Stomach: J-shaped tube from the cardia, through fundus and body, to the pylorus
  parts.stomach = new THREE.Mesh(
    tube([[0.35, 1.7, -3.15], [1.35, 1.75, -2.95], [2.35, 1.45, -2.25], [2.45, 1.2, -1.25], [1.7, 1.05, -0.55], [0.6, 1.0, -0.6], [-0.1, 0.92, -0.95]], {
      segments: 220, radial: 28,
      radius: (t, a) => {
        const body = 0.42 + 0.58 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.95);
        const taper = t > 0.62 ? 1 - (t - 0.62) * 1.55 : 1;
        return Math.max(0.2, body * taper) * capped(t, 0.05) * (1 + 0.025 * Math.sin(a * 3 + t * 30));
      },
    }),
    mat('#cf7d5f')
  );

  // Spleen: dark bean high on the patient's left
  parts.spleen = new THREE.Mesh(
    blob({ seed: 2.4, deform: (x, y, z, n) => { const dent = 1 - 0.22 * Math.max(0, x); const r = dent * (1 + 0.05 * n); return [x * 0.5 * r, y * 0.42 * r, z * 1.0 * r]; } }),
    mat('#5a2140')
  );
  parts.spleen.position.set(3.55, 1.05, -2.15);
  parts.spleen.rotation.set(0.2, -0.6, 0.15);

  // Pancreas: tapering, lobulated tube from head to tail
  parts.pancreas = new THREE.Mesh(
    tube([[-0.55, 0.55, -0.45], [0.4, 0.6, -0.85], [1.5, 0.68, -1.25], [2.6, 0.78, -1.75], [3.05, 0.86, -2.0]], {
      segments: 120, radial: 16,
      radius: (t, a) => (0.42 - 0.24 * t) * capped(t, 0.08) * (1 + 0.09 * Math.sin(t * 46 + a * 2) * Math.sin(a * 3)),
    }),
    mat('#d1a467', { rimStrength: 0.4 })
  );

  // Small bowel: a long meandering coil filling the mid-abdomen
  const coil = [];
  for (let i = 0; i <= 160; i++) {
    const s = i / 160;
    coil.push([
      1.95 * Math.sin(s * Math.PI * 9 + 0.4) * (0.8 + 0.2 * Math.sin(s * 7)),
      1.22 + 0.32 * Math.sin(s * Math.PI * 13 + 1.2),
      -0.15 + 2.2 * s + 0.32 * Math.sin(s * Math.PI * 23),
    ]);
  }
  parts.smallBowel = new THREE.Mesh(
    tube(coil, { segments: 1100, radial: 12, radius: (t) => 0.21 * capped(t, 0.01) * (1 + 0.04 * Math.sin(t * 37)) }),
    mat('#e3958a', { rimStrength: 0.4 })
  );

  // Colon: frames the abdomen, with haustral bulges, ending in the rectum
  parts.colon = new THREE.Mesh(
    tube([[-3.45, 0.85, 2.2], [-3.6, 1.05, 0.9], [-3.45, 1.35, -0.75], [-2.4, 1.85, -0.85], [0, 2.05, -0.55], [2.4, 1.9, -0.8], [3.55, 1.45, -0.6], [3.6, 1.1, 0.9], [3.2, 0.85, 2.15], [1.9, 0.7, 2.75], [0.7, 0.55, 2.95], [0.15, 0.45, 3.15]], {
      segments: 520, radial: 20,
      radius: (t, a) => {
        const base = 0.34 - 0.1 * t;
        const haustra = 1 + 0.07 * Math.pow(Math.abs(Math.sin(t * 62)), 2) + 0.04 * Math.cos(a * 3);
        return base * haustra * capped(t, 0.02);
      },
    }),
    mat('#9a5560')
  );

  // Appendix: small worm off the cecum
  parts.appendix = new THREE.Mesh(
    tube([[-3.4, 0.7, 2.35], [-3.15, 0.55, 2.75], [-2.75, 0.5, 2.85], [-2.5, 0.58, 2.65]], {
      segments: 40, radial: 10, radius: (t) => 0.085 * capped(t, 0.15),
    }),
    mat('#9a5560')
  );

  // Bladder: rounded, slightly flattened sac at the front of the pelvis
  parts.bladder = new THREE.Mesh(
    blob({ seed: 3.3, deform: (x, y, z, n) => { const r = 1 + 0.04 * n; const yy = y > 0 ? y * 0.78 : y; return [x * 0.64 * r, yy * 0.44 * r, z * 0.54 * r]; } }),
    mat('#b39563', { rimStrength: 0.4, transmission: 0.45 })
  );
  parts.bladder.position.set(0, 0.5, 3.15);

  // Uterus: pear-shaped, anteverted over the bladder; morph target adds fibroid bulges
  const fibroidSites = [
    [0.58, 0.6, 0.38, 0.27],
    [-0.66, 0.34, 0.22, 0.2],
    [0.06, 0.92, -0.4, 0.17],
  ];
  const pear = (x, y, z, n) => {
    const up = (y + 1) / 2;
    const width = 0.48 + 0.52 * Math.pow(up, 0.7);
    const r = 1 + 0.035 * n;
    return [x * 0.82 * width * r, y * 1.05 * r, z * 0.6 * width * r];
  };
  parts.uterus = new THREE.Mesh(
    blob({
      detail: 5, seed: 4.1,
      deform: pear,
      morph: (x, y, z, n) => {
        let bump = 0;
        for (const [fx, fy, fz, s] of fibroidSites) {
          const d2 = (x - fx) ** 2 + (y - fy) ** 2 + (z - fz) ** 2;
          bump += s * 0.9 * Math.exp(-d2 / (s * s * 0.9));
        }
        const p = pear(x, y, z, n);
        const k = 1 + bump;
        return [p[0] * k, p[1] * k, p[2] * k];
      },
    }),
    mat('#c9353d', { rimStrength: 0.6 })
  );
  parts.uterus.position.set(0, 1.25, 2.5);
  parts.uterus.rotation.set(0.42, 0, 0);
  parts.uterus.scale.setScalar(0.82);
  parts.uterus.morphTargetInfluences = [0];

  // Fallopian tubes curving out from the fundus, flaring at the ends, with ovaries beneath
  const adnexa = new THREE.Group();
  const tubeMat = mat('#c9474f', { rimStrength: 0.5, transmission: 0.15 });
  const ovaryMat = mat('#d9a38f', { rimStrength: 0.5 });
  for (const side of [-1, 1]) {
    adnexa.add(new THREE.Mesh(
      tube([[side * 0.55, 0.78, 0], [side * 1.05, 0.95, 0.05], [side * 1.55, 0.8, 0.12], [side * 1.85, 0.42, 0.18], [side * 1.7, 0.12, 0.2]], {
        segments: 90, radial: 12,
        radius: (t) => (0.075 + 0.11 * Math.pow(t, 6)) * (t < 0.05 ? capped(t, 0.05) : 1) * (t > 0.97 ? capped(t, 0.03) : 1),
      }),
      tubeMat
    ));
    const ovary = new THREE.Mesh(
      blob({ detail: 3, seed: side * 2.7, deform: (x, y, z, n) => { const r = 1 + 0.06 * n; return [x * 0.34 * r, y * 0.2 * r, z * 0.22 * r]; } }),
      ovaryMat
    );
    ovary.position.set(side * 1.25, 0.2, 0.22);
    ovary.rotation.z = side * 0.4;
    adnexa.add(ovary);
  }
  parts.uterus.add(adnexa);

  // Fibroid nodules: pale, firm spheres partly embedded at the bulges
  parts.fibroids = new THREE.Group();
  const fibroidMat = hydrogel('#c99a92', { quality, rim: CLINICAL, rimStrength: 0.55, transmission: 0.08, roughness: 0.5, emissive: 0.02 });
  for (const [fx, fy, fz, s] of fibroidSites) {
    const len = Math.hypot(fx, fy, fz);
    const node = new THREE.Mesh(
      blob({ detail: 3, seed: fx * 9, deform: (x, y, z, n) => { const r = s * 1.05 * (1 + 0.06 * n); return [x * r, y * r, z * r]; } }),
      fibroidMat
    );
    const p = pear(fx / len, fy / len, fz / len, 0);
    node.position.set(p[0] * 1.0, p[1] * 1.0, p[2] * 1.0);
    node.userData.home = node.position.clone();
    node.scale.setScalar(0.001);
    parts.fibroids.add(node);
  }
  parts.uterus.add(parts.fibroids);

  // Kidneys: retroperitoneal beans, part of the base
  const kidney = () => blob({ seed: 5.2, deform: (x, y, z, n) => { const dent = 1 - 0.28 * Math.max(0, -x); const r = dent * (1 + 0.04 * n); return [x * 0.42 * r, y * 0.32 * r, z * 0.72 * r]; } });
  parts.kidneyL = new THREE.Mesh(kidney(), mat('#6a1f2c'));
  parts.kidneyL.position.set(-2.2, 0.45, -0.75);
  parts.kidneyL.rotation.set(0, 0.25, 0.3);
  parts.kidneyR = new THREE.Mesh(kidney(), mat('#6a1f2c'));
  parts.kidneyR.position.set(2.25, 0.45, -0.85);
  parts.kidneyR.rotation.set(0, -0.25 + Math.PI, -0.3);

  // Great vessels: aorta and IVC running the length of the base, iliac bifurcation below
  const vessel = (pts, r, color) => new THREE.Mesh(
    tube(pts, { segments: 120, radial: 14, radius: (t) => r * capped(t, 0.03) }),
    mat(color, { rimStrength: 0.7, transmission: 0.2 })
  );
  parts.vessels = new THREE.Group();
  parts.vessels.add(
    vessel([[0.3, 0.32, -3.4], [0.32, 0.3, -1], [0.3, 0.3, 1.35]], 0.19, '#b3282f'),
    vessel([[0.3, 0.3, 1.3], [0.85, 0.28, 2.1], [1.3, 0.26, 2.95]], 0.13, '#b3282f'),
    vessel([[0.3, 0.3, 1.3], [-0.3, 0.28, 2.1], [-0.75, 0.26, 2.95]], 0.13, '#b3282f'),
    vessel([[-0.35, 0.32, -3.4], [-0.36, 0.3, -1], [-0.4, 0.3, 1.25]], 0.21, '#3c5d8c')
  );

  return parts;
}

/* ---------------------------------------------------------------- simulator */

export function buildSimulator({ quality = 'high' } = {}) {
  const root = new THREE.Group();
  const parts = makeOrgans(quality);

  // Base tray: graphite chassis with a low rim and hairline edges
  const base = new THREE.Group();
  const trayMat = new THREE.MeshStandardMaterial({ color: '#1a1c1f', roughness: 0.5, metalness: 0.45 });
  const plate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(10.8, 9.2, 0.9), { depth: 0.45, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3, curveSegments: 20 }),
    trayMat
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -0.5;
  const rimShape = roundedRect(10.8, 9.2, 0.9);
  rimShape.holes.push(roundedRect(10.1, 8.5, 0.6));
  const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(rimShape, { depth: 0.55, bevelEnabled: false, curveSegments: 20 }), trayMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.05;
  const edgeMat = new THREE.LineBasicMaterial({ color: '#9aa8b4', transparent: true, opacity: 0.35 });
  const plateEdges = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry, 25), edgeMat);
  plateEdges.rotation.copy(plate.rotation);
  plateEdges.position.copy(plate.position);
  const rimEdges = new THREE.LineSegments(new THREE.EdgesGeometry(rim.geometry, 25), edgeMat);
  rimEdges.rotation.copy(rim.rotation);
  rimEdges.position.copy(rim.position);
  base.add(plate, rim, plateEdges, rimEdges, parts.vessels, parts.kidneyL, parts.kidneyR);
  base.position.z = 0.3;

  // Docking sockets: rings in the tray floor under each module; they light up as modules lift
  const socketMat = new THREE.MeshBasicMaterial({ color: CLINICAL, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const socketAt = (x, z, r = 0.75) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.07, 64), socketMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    base.add(ring);
  };

  // Organ modules
  const modules = {
    hepatobiliary: { label: 'Hepatobiliary', group: new THREE.Group(), vector: new THREE.Vector3(-4.4, 2.6, -2.2) },
    upperGI: { label: 'Upper GI', group: new THREE.Group(), vector: new THREE.Vector3(4.2, 2.4, -2.9) },
    bowel: { label: 'Bowel', group: new THREE.Group(), vector: new THREE.Vector3(0, 3.3, 1.1) },
    pelvic: { label: 'Pelvic', group: new THREE.Group(), vector: new THREE.Vector3(-0.3, 1.1, 4.8) },
  };
  modules.hepatobiliary.group.add(parts.liver, parts.gallbladder);
  modules.upperGI.group.add(parts.stomach, parts.spleen, parts.pancreas);
  modules.bowel.group.add(parts.smallBowel, parts.colon, parts.appendix);
  modules.pelvic.group.add(parts.uterus, parts.bladder);
  socketAt(-1.4, -1.9, 1.1);
  socketAt(2.1, -1.6, 0.9);
  socketAt(0, 1.0, 1.2);
  socketAt(0, 3.1, 0.75);

  // Abdominal wall cover: an opaque white trainer cover with a flange, latches and grommeted
  // port holes. On scroll it turns translucent (revealing muscle and fat layers and the organs),
  // then lifts away.
  const wall = new THREE.Group();
  const [A, B, C] = [4.9, 3.2, 4.1];
  const shellGeo = superDome();
  const fadeMats = [];
  const fading = (m, rest = 1) => { m.transparent = true; m.userData.rest = rest; m.opacity = rest; fadeMats.push(m); return m; };

  const coverMat = fading(new THREE.MeshPhysicalMaterial({
    color: '#f2efe9', roughness: 0.4, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3,
    sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffffff'), envMapIntensity: 0.9,
  }));
  const skin = new THREE.Mesh(shellGeo, coverMat);
  skin.scale.set(A, B, C);

  const layer = (color, s) => {
    const m = hydrogel(color, { quality: 'low', opacity: 0.12, rimStrength: 0.45, roughness: 0.25 });
    m.side = THREE.DoubleSide;
    m.depthWrite = false;
    const mesh = new THREE.Mesh(shellGeo, m);
    mesh.scale.set(A * s, B * s, C * s);
    return mesh;
  };
  const fat = layer('#e2c178', 0.965);
  const muscle = layer('#a7464c', 0.93);

  // Flange where the cover meets the tray, and four latches
  const flangeShape = new THREE.Shape(superOutline(A + 0.12, C + 0.12));
  flangeShape.holes.push(new THREE.Path(superOutline(A - 0.03, C - 0.03).reverse()));
  const flangeMat = fading(new THREE.MeshPhysicalMaterial({ color: '#e9e6e0', roughness: 0.45, clearcoat: 0.3 }));
  const flange = new THREE.Mesh(new THREE.ExtrudeGeometry(flangeShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 96 }), flangeMat);
  flange.rotation.x = -Math.PI / 2;
  const latchMat = fading(new THREE.MeshStandardMaterial({ color: '#8d959c', roughness: 0.35, metalness: 0.7 }));
  const latchGeo = new THREE.BoxGeometry(0.7, 0.42, 0.16);
  for (const [x, z, ry] of [[4.98, 0, Math.PI / 2], [-4.98, 0, Math.PI / 2], [0, 4.18, 0], [0, -4.18, 0]]) {
    const latch = new THREE.Mesh(latchGeo, latchMat);
    latch.position.set(x, 0.42, z);
    latch.rotation.y = ry;
    wall.add(latch);
  }

  // Port holes: dark opening, rubber grommet, inner seal; a larger camera port at the top
  const ports = new THREE.Group();
  const holeMat = fading(new THREE.MeshBasicMaterial({ color: '#0d0e10' }));
  const grommetMat = fading(new THREE.MeshStandardMaterial({ color: '#7f8a94', roughness: 0.55, metalness: 0.1 }));
  const sealMat = fading(new THREE.MeshStandardMaterial({ color: '#2b2f34', roughness: 0.6 }));
  const zAxis = new THREE.Vector3(0, 0, 1);
  const portSites = [
    [0, -0.25, 0.34],
    [-1.75, 0.55, 0.24], [1.75, 0.55, 0.24],
    [-2.7, -0.9, 0.22], [2.7, -0.9, 0.22],
    [0, 1.9, 0.2],
  ];
  const P = DOME_P;
  for (const [x, z, r] of portSites) {
    const y = B * Math.pow(Math.max(0, 1 - Math.abs(x / A) ** P - Math.abs(z / C) ** P), 1 / P);
    const normal = new THREE.Vector3(
      Math.sign(x) * Math.abs(x / A) ** (P - 1) / A,
      (y / B) ** (P - 1) / B,
      Math.sign(z) * Math.abs(z / C) ** (P - 1) / C
    ).normalize();
    const port = new THREE.Group();
    const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 40), holeMat);
    const grommet = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.065, 14, 48), grommetMat);
    const seal = new THREE.Mesh(new THREE.TorusGeometry(r * 0.48, 0.03, 10, 36), sealMat);
    hole.position.z = 0.012;
    grommet.position.z = 0.03;
    seal.position.z = 0.02;
    port.add(hole, grommet, seal);
    port.position.set(x, y, z);
    port.quaternion.setFromUnitVectors(zAxis, normal);
    ports.add(port);
  }

  wall.add(muscle, fat, skin, flange, ports);
  wall.position.z = 0.3;
  muscle.renderOrder = 2;
  fat.renderOrder = 3;
  skin.renderOrder = 4;

  // Imaging planes that sweep through the pelvic module
  const scan = new THREE.Group();
  const scanPlaneMat = new THREE.MeshBasicMaterial({ color: CLINICAL, transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const scanEdgeMat = new THREE.LineBasicMaterial({ color: CLINICAL, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  const scanShape = roundedRect(3.4, 2.6, 0.22);
  const scanGeo = new THREE.ShapeGeometry(scanShape, 16);
  const scanEdges = new THREE.EdgesGeometry(scanGeo);
  const scanPlanes = [];
  for (let i = 0; i < 6; i++) {
    const plane = new THREE.Group();
    plane.add(new THREE.Mesh(scanGeo, scanPlaneMat.clone()), new THREE.LineSegments(scanEdges, scanEdgeMat.clone()));
    plane.rotation.x = -Math.PI / 2;
    scan.add(plane);
    scanPlanes.push(plane);
  }

  root.add(base, wall);
  Object.values(modules).forEach((m) => {
    m.group.position.z = 0.3;
    m.home = m.group.position.clone();
    root.add(m.group);
  });
  root.position.y = -0.6;

  // Anchor points for labels (module centers in local space)
  const box = new THREE.Box3();
  Object.values(modules).forEach((m) => {
    box.setFromObject(m.group);
    m.anchor = box.getCenter(new THREE.Vector3()).sub(m.group.position);
  });

  // Center the scan stack on the pelvic organs, starting just below them
  modules.pelvic.group.add(scan);
  scan.position.set(modules.pelvic.anchor.x, 0, modules.pelvic.anchor.z);

  const state = { explode: 0, swap: 0, scan: 0 };

  function update({ explode = state.explode, swap = state.swap, scan: scanP = state.scan, isolate = 0, time = 0 } = {}) {
    Object.assign(state, { explode, swap, scan: scanP });
    const iso = easeInOut(isolate);
    const reveal = smooth(explode / 0.16);
    const lift = easeInOut((explode - 0.12) / 0.32);
    const spread = easeInOut((explode - 0.32) / 0.68);

    // Cover: opaque white at rest, translucent once scrolling starts
    fadeMats.forEach((m) => { m.opacity = m.userData.rest * (1 - 0.86 * reveal) * (1 - 0.5 * lift); });
    coverMat.depthWrite = reveal < 0.02;
    [fat, muscle].forEach((s) => { s.material.opacity = s.userData.baseOpacity * reveal * (1 - 0.5 * lift); });

    wall.position.y = lift * 8.6;
    skin.position.y = lift * 0.9;
    ports.position.y = skin.position.y;
    fat.position.y = lift * 0.45;
    wall.rotation.x = -0.12 * lift;

    // isolate: the pelvic module stays put while the tray sinks away and the other modules drift off
    Object.values(modules).forEach((m, i) => {
      const away = m === modules.pelvic ? 0 : iso;
      m.group.position.copy(m.home).addScaledVector(m.vector, spread + away * 2.2);
      m.group.position.y += Math.sin(time * 0.9 + i * 1.7) * 0.06 * spread + away * 4;
      m.group.visible = away < 0.98;
    });
    base.position.y = -iso * 11;
    base.visible = iso < 0.98;
    socketMat.opacity = 0.75 * spread;

    // Uterus swap: morph to fibroid shape; nodules grow in with a slight overshoot
    const sw = clamp01(swap);
    parts.uterus.morphTargetInfluences[0] = smooth(sw);
    parts.fibroids.children.forEach((node, i) => {
      const local = clamp01(sw * 1.35 - i * 0.12);
      const pop = local < 1 ? smooth(local) * (1 + 0.18 * Math.sin(local * Math.PI)) : 1;
      node.scale.setScalar(Math.max(0.001, pop));
    });

    // Scan planes: a stack that sweeps up through the pelvic module, brightest at the leading plane
    scan.visible = scanP > 0.001 && scanP < 0.999;
    if (scan.visible) {
      scanPlanes.forEach((plane, i) => {
        const y = -0.2 + (scanP * 3.2) - i * 0.22;
        plane.position.y = y;
        const inside = y > 0 && y < 2.2;
        const fade = Math.max(0, 1 - i * 0.17) * (inside ? 1 : 0.25);
        plane.children[0].material.opacity = 0.14 * fade;
        plane.children[1].material.opacity = 0.9 * fade;
      });
    }
  }
  [fat, muscle].forEach((s) => { s.userData.baseOpacity = s.material.opacity; });
  update({ explode: 0 });

  return { root, modules, update, state };
}

/* Environment and lights shared by every page that shows the simulator */
export function stageScene(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight('#c9d6e2', '#0b0b0c', 0.35));
  const key = new THREE.DirectionalLight('#fff3e6', 1.9);
  key.position.set(-6, 10, 8);
  const rimBlue = new THREE.DirectionalLight(CLINICAL, 3.2);
  rimBlue.position.set(-9, 4, -10);
  const rimWarm = new THREE.DirectionalLight('#ffb48c', 1.6);
  rimWarm.position.set(10, 3, -8);
  const under = new THREE.PointLight('#4fa3d1', 14, 18, 1.6);
  under.position.set(0, -1.5, 2);
  scene.add(key, rimBlue, rimWarm, under);
}

export { THREE };
