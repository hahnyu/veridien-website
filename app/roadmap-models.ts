import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

import markSvg from "../public/logo-mark.svg?raw";
import { buildHepatobiliary } from "./anatomy/hepatobiliary.js";
import { occlusionJob } from "./anatomy/kit.js";
import { buildPelvic } from "./anatomy/pelvic.js";
import { buildUpperGI } from "./anatomy/upper-gi.js";

/**
 * The roadmap's models, built in code to match the hero render: a light grey split dome on a white
 * base plate, a grey ribbed module tub, trocars with blue collars, black ring-handled instruments,
 * and the cast hydrogel organs from the previous site (app/anatomy). Each model stands on y = 0 and
 * faces +z; the scene frames whatever size it comes out.
 */
export type Model = {
  root: THREE.Group;
  /** Per frame: seconds since start, the camera (for things that face it), and the drawing size in px. */
  update?: (time: number, camera: THREE.Camera, size: THREE.Vector2) => void;
};

/** Accent for anything drawn rather than built: tracking marks, trails, guidance, the reference scan. */
const BLUE = new THREE.Color("#2f86c4");
/** The tile behind each model; trails fade into it rather than to transparent. */
const TILE = new THREE.Color("#e9efeb");

// Matte, light grey plastics, as in the hero render (white reads grey under soft light)
const shell = () => new THREE.MeshPhysicalMaterial({ color: "#dfe1de", roughness: 0.62, clearcoat: 0.08, clearcoatRoughness: 0.7 });
const shellInside = () => new THREE.MeshStandardMaterial({ color: "#c9ccc8", roughness: 0.8, side: THREE.BackSide });
const plate = () => new THREE.MeshPhysicalMaterial({ color: "#e6e8e5", roughness: 0.66 });
const tubGrey = () => new THREE.MeshStandardMaterial({ color: "#bfc3bf", roughness: 0.72 });
const black = () => new THREE.MeshStandardMaterial({ color: "#1b1d1f", roughness: 0.42, metalness: 0.1 });
const steel = () => new THREE.MeshStandardMaterial({ color: "#c4cad0", roughness: 0.24, metalness: 1 });
const blue = () => new THREE.MeshStandardMaterial({ color: "#3a9ddb", roughness: 0.35 });
const gold = () => new THREE.MeshStandardMaterial({ color: "#c9a14a", roughness: 0.3, metalness: 1 });
const cable = () => new THREE.MeshStandardMaterial({ color: "#a6c3d8", roughness: 0.4 });
/** Guidance and overlays: flat accent, see-through, drawn over what is behind it. */
const overlay = (opacity = 0.3) => new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity, depthWrite: false });

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0 over `period` seconds, resting a while at each end. */
const cycle = (time: number, period: number, phase = 0) => smooth(0.2, 0.8, 0.5 - 0.5 * Math.cos(((time + phase) / period) * Math.PI * 2));

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, at?: THREE.Vector3) {
  const m = new THREE.Mesh(geometry, material);
  if (at) m.position.copy(at);
  return m;
}

function shadows<T extends THREE.Object3D>(object: T): T {
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return object;
}

function roundedRect(w: number, d: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
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

/** A flat slab with soft edges, lying on y = 0. */
function slab(w: number, d: number, h: number, r: number, material: THREE.Material, bevel = Math.min(0.04, h / 3)) {
  const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * bevel, d - 2 * bevel, r), {
    depth: h - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 20,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return mesh(g, material);
}

/** A flat part drawn in profile (x across, y up) and given thickness along x, with soft edges. */
function profile(shape: THREE.Shape, thickness: number, material: THREE.Material, bevel = 0.025) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 24 });
  g.translate(0, 0, -(thickness - 2 * bevel) / 2);
  // The profile's x becomes -z, so parts drawn toward +x reach back from the shaft
  g.rotateY(Math.PI / 2);
  return mesh(g, material);
}

/** A ring drawn in profile: centre (cx, cy), outer and inner radius. */
function ringShape(cx: number, cy: number, r: number, hole: number) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.absarc(cx, cy, hole, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

/** Points an object's +y axis along `dir`, with its origin at `at`. */
function aim(object: THREE.Object3D, at: THREE.Vector3, dir: THREE.Vector3) {
  object.position.copy(at);
  object.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
}

/** Turns `object` (inside `root`) to face the camera. */
const facing = new THREE.Quaternion();
function faceCamera(object: THREE.Object3D, camera: THREE.Camera) {
  object.parent!.getWorldQuaternion(facing).invert();
  object.quaternion.copy(facing).multiply(camera.quaternion);
}

/** Text drawn on a canvas, as a flat card or label for the scene. */
function textPlane(width: number, height: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * 256);
  canvas.height = Math.round(height * 256);
  const c = canvas.getContext("2d")!;
  draw(c, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const plane = mesh(new THREE.PlaneGeometry(width * scale, height * scale), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  plane.renderOrder = 20;
  return plane;
}

const FONT = '"Schibsted Grotesk", system-ui, -apple-system, sans-serif';

function roundRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/* ------------------------------------------------------------------ organs */

type Organ = { root: THREE.Group };
const organs: Partial<Record<"pelvic" | "liver" | "upperGI", Organ>> = {};
const shadingJobs: Generator<void, void, void>[] = [];

/**
 * Crease shading for the hydrogel organs, worked out a slice at a time in idle moments (it would
 * stall a frame done at once). The organs are clones sharing one geometry, so shading the source
 * shades every copy. Returns true when there is nothing left to do.
 */
export function shadeStep(budgetMs = 6): boolean {
  const end = performance.now() + budgetMs;
  while (shadingJobs.length && performance.now() < end) {
    if (shadingJobs[0].next().done) shadingJobs.shift();
  }
  return shadingJobs.length === 0;
}

/** Wrap an organ module so it stands centred on y = 0, scaled to one unit across, and queue its shading. */
function source(meshes: THREE.Object3D[]): Organ {
  const inner = new THREE.Group();
  inner.name = "inner";
  inner.add(...meshes);
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.vertexColors && !m.geometry.attributes.color) {
      m.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(m.geometry.attributes.position.count * 3).fill(1), 3));
    }
  });
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const root = new THREE.Group();
  root.add(inner);
  root.scale.setScalar(1 / Math.max(size.x, size.z));
  shadingJobs.push(occlusionJob(inner, { floorY: box.min.y + 0.02 }));
  return { root };
}

type Fibroids = "none" | "multiple" | "single";

/** The pelvic module (uterus, tubes, ovaries, bladder): healthy, with several fibroids, or one large one. */
function pelvic(fibroids: Fibroids = "multiple", width = 2.2) {
  if (!organs.pelvic) {
    const p = buildPelvic();
    p.fibroids.name = "fibroids";
    p.uterus.name = "uterus";
    // The source keeps its fibroids at full size, so the crease shading accounts for them
    p.fibroids.children.forEach((n) => n.scale.setScalar(1));
    organs.pelvic = source(p.meshes);
  }
  const copy = organs.pelvic.root.clone(true);
  const uterus = copy.getObjectByName("uterus") as THREE.Mesh;
  uterus.morphTargetInfluences = [fibroids === "none" ? 0 : fibroids === "single" ? 0.7 : 1];
  copy.getObjectByName("fibroids")!.children.forEach((n, i) =>
    n.scale.setScalar(fibroids === "multiple" ? 1 : fibroids === "single" && i === 0 ? 1.45 : 0.001),
  );
  copy.scale.multiplyScalar(width);
  return copy;
}

/** The hepatobiliary module (liver, gallbladder, bile ducts), optionally with a pale lesion on the liver. */
function liver(lesion = false, width = 2.3) {
  if (!organs.liver) organs.liver = source(buildHepatobiliary().meshes);
  const copy = organs.liver.root.clone(true);
  if (lesion) {
    const inner = copy.getObjectByName("inner")!;
    const lobe = inner.children[0] as THREE.Mesh;
    lobe.geometry.computeBoundingBox();
    const b = lobe.geometry.boundingBox!;
    const g = new THREE.IcosahedronGeometry(1, 5);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = 1 + 0.08 * Math.sin(x * 5 + z * 3) * Math.cos(y * 4);
      pos.setXYZ(i, x * r, y * r * 0.55, z * r);
    }
    g.computeVertexNormals();
    const spot = mesh(g, new THREE.MeshPhysicalMaterial({ color: "#efd8c6", roughness: 0.45, clearcoat: 0.4, sheen: 0.4 }));
    spot.scale.setScalar((b.max.x - b.min.x) * 0.11);
    spot.position.set(b.min.x + (b.max.x - b.min.x) * 0.62, b.max.y - (b.max.y - b.min.y) * 0.12, (b.min.z + b.max.z) / 2 - 0.15);
    spot.castShadow = true;
    lobe.add(spot);
  }
  copy.scale.multiplyScalar(width);
  return copy;
}

/** The upper GI module (stomach, pancreas, spleen). */
function upperGI(width = 2.3) {
  if (!organs.upperGI) organs.upperGI = source(buildUpperGI().meshes);
  const copy = organs.upperGI.root.clone(true);
  copy.scale.multiplyScalar(width);
  return copy;
}

/* ------------------------------------------------------------------ the trainer */

const DOME = { a: 2.25, b: 1.7, c: 1.85, p: 2.4, t: 0.07 };

/** Height of the dome surface above (x, z), and its outward normal there. */
function domeAt(x: number, z: number) {
  const { a, b, c, p } = DOME;
  const k = Math.max(0, 1 - Math.abs(x / a) ** p - Math.abs(z / c) ** p);
  const y = b * k ** (1 / p);
  const n = V(
    (Math.sign(x) * Math.abs(x / a) ** (p - 1)) / a,
    (y / b) ** (p - 1) / b,
    (Math.sign(z) * Math.abs(z / c) ** (p - 1)) / c,
  ).normalize();
  return { point: V(x, y, z), normal: n };
}

/** One half of the superellipsoid dome (front: z >= 0, back: z <= 0), as a shell with its cut edge closed. */
function domeHalf(front: boolean, material: THREE.Material = shell()) {
  const { a, b, c, p, t } = DOME;
  const surface = (inset: number) => {
    const g = new THREE.SphereGeometry(1, 80, 36, front ? 0 : Math.PI, Math.PI, 0, Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = (Math.abs(x) ** p + Math.abs(y) ** p + Math.abs(z) ** p) ** (1 / p) || 1;
      pos.setXYZ(i, (x / k) * (a - inset), (y / k) * (b - inset), (z / k) * (c - inset));
    }
    g.computeVertexNormals();
    return g;
  };
  const g = new THREE.Group();
  g.add(mesh(surface(0), material), mesh(surface(t), shellInside()));
  // The cut edge: the band between the outer and inner profiles, in the z = 0 plane
  const outline = (inset: number, n = 48) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const s = (i / n) * Math.PI;
      const cx = Math.cos(s);
      return new THREE.Vector2((a - inset) * Math.sign(cx) * Math.abs(cx) ** (2 / p), (b - inset) * Math.abs(Math.sin(s)) ** (2 / p));
    });
  const band = new THREE.Shape([...outline(0), ...outline(t).reverse()]);
  g.add(mesh(new THREE.ShapeGeometry(band, 1), new THREE.MeshStandardMaterial({ color: "#d4d6d2", roughness: 0.6, side: THREE.DoubleSide })));
  // Foot ring where the shell meets the plate
  const foot = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 64, Math.PI), material);
  foot.rotation.x = front ? Math.PI / 2 : -Math.PI / 2;
  foot.scale.set(a, c, 1);
  foot.position.y = 0.03;
  g.add(foot);
  return shadows(g);
}

function basePlate() {
  const g = new THREE.Group();
  g.add(slab(6.2, 4.6, 0.16, 0.45, plate()));
  // The turntable groove and screw heads, as in the render
  const groove = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.08, 96), new THREE.MeshBasicMaterial({ color: "#c3c7c3" }));
  groove.rotation.x = -Math.PI / 2;
  groove.position.y = 0.161;
  g.add(groove);
  const screwGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16);
  const screwMat = new THREE.MeshStandardMaterial({ color: "#7d8389", roughness: 0.35, metalness: 0.8 });
  for (const [x, z] of [[-2.8, -2.0], [2.8, -2.0], [-2.8, 2.0], [2.8, 2.0], [0, 2.15], [-2.5, 0]]) g.add(mesh(screwGeo, screwMat, V(x, 0.165, z)));
  // Connector box on the right
  const box = slab(0.5, 1.05, 0.34, 0.06, black());
  box.position.set(2.65, 0.16, 0.9);
  g.add(box);
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.03, 0.08, 0.16), steel(), V(2.91, 0.33, 0.6 + i * 0.3)));
  return shadows(g);
}

/** The grey ribbed module tub that the organs sit in. */
function tub(w = 2.6, d = 1.9, h = 0.72) {
  const g = new THREE.Group();
  const mat = tubGrey();
  const ring = roundedRect(w, d, 0.2);
  ring.holes.push(roundedRect(w - 0.16, d - 0.16, 0.13));
  const walls = new THREE.ExtrudeGeometry(ring, { depth: h, bevelEnabled: false, curveSegments: 16 });
  walls.rotateX(-Math.PI / 2);
  g.add(mesh(walls, mat));
  g.add(slab(w - 0.1, d - 0.1, 0.08, 0.15, new THREE.MeshStandardMaterial({ color: "#d2d5d1", roughness: 0.8 })));
  // Vertical ribs round the outside
  const rib = new THREE.BoxGeometry(0.04, h * 0.86, 0.035);
  for (let x = -w / 2 + 0.3; x <= w / 2 - 0.29; x += 0.2) {
    for (const s of [-1, 1]) g.add(mesh(rib, mat, V(x, h * 0.47, s * (d / 2 + 0.012))));
  }
  for (let z = -d / 2 + 0.3; z <= d / 2 - 0.29; z += 0.2) {
    for (const s of [-1, 1]) {
      const r = mesh(rib, mat, V(s * (w / 2 + 0.012), h * 0.47, z));
      r.rotation.y = Math.PI / 2;
      g.add(r);
    }
  }
  return shadows(g);
}

/** A tub with an organ module standing in it. */
function module(organ: THREE.Object3D) {
  const t = tub();
  organ.position.y = 0.08;
  t.add(organ);
  return t;
}

/** Trocar: white cannula, two blue collars and a valve cap. Origin at the skin, axis along +y. */
function trocar() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: "#eceeeb", roughness: 0.45 });
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 20), steel(), V(0, -0.35, 0)));
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.42, 24), white, V(0, 0.2, 0)));
  g.add(mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.07, 24), blue(), V(0, 0.08, 0)));
  g.add(mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.07, 24), blue(), V(0, 0.34, 0)));
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.08, 24), white, V(0, 0.45, 0)));
  return shadows(g);
}

/* ------------------------------------------------------------------ instruments */

type InstrumentData = { open: (a: number) => void; squeeze?: (s: number) => void };
type Instrument = THREE.Group & { userData: InstrumentData };

/**
 * A laparoscopic instrument with its tip at the origin and the shaft along +y: fenestrated grasper
 * jaws with fine teeth, or curved Maryland jaws, on a black insulated shaft with depth marks, and
 * (optionally) the ring handle: a moulded body and finger ring, a hinged thumb lever, a knurled
 * rotation knob with a blue band, and the cautery post. Rings reach back toward -z.
 * `material` swaps every surface, for a see-through guide copy.
 */
function instrument({ length = 3.2, handle = true, kind = "grasper" as "grasper" | "maryland", material = undefined as THREE.Material | undefined } = {}): Instrument {
  const root = new THREE.Group() as Instrument;
  const m = (make: () => THREE.Material) => material ?? make();
  const ink = m(black);
  const metal = m(steel);
  const shaftR = 0.045;
  root.add(mesh(new THREE.CylinderGeometry(shaftR, shaftR, length, 24), ink, V(0, 0.4 + length / 2, 0)));
  // Depth marks near the tip
  const mark = m(() => new THREE.MeshStandardMaterial({ color: "#d8dcd8", roughness: 0.5 }));
  for (let i = 0; i < 4; i++) root.add(mesh(new THREE.CylinderGeometry(shaftR * 1.01, shaftR * 1.01, 0.012, 24), mark, V(0, 0.75 + i * 0.12, 0)));
  // Clevis and pin
  root.add(mesh(new THREE.CylinderGeometry(shaftR * 1.06, shaftR, 0.16, 24), metal, V(0, 0.33, 0)));
  const pin = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 10), metal, V(0, 0.28, 0));
  pin.rotation.z = Math.PI / 2;
  root.add(pin);

  const L = 0.32;
  const w = 0.04;
  const t = 0.04;
  const jawGeometry = (side: 1 | -1) => {
    const s = new THREE.Shape();
    if (kind === "grasper") {
      s.moveTo(-w, 0);
      s.lineTo(-w, -L + w);
      s.absarc(0, -L + w, w, Math.PI, 0, false);
      s.lineTo(w, 0);
      s.lineTo(-w, 0);
      const window = new THREE.Path();
      window.absellipse(0, -L * 0.5, w * 0.42, L * 0.26, 0, Math.PI * 2, false, 0);
      s.holes.push(window);
    } else {
      // Maryland: narrow and curved to one side
      s.moveTo(-w, 0);
      s.quadraticCurveTo(-w, -L * 0.7, w * 1.6, -L);
      s.quadraticCurveTo(w * 1.3, -L * 0.78, w, -L * 0.55);
      s.lineTo(w, 0);
      s.lineTo(-w, 0);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 16 });
    // The jaws stack in the direction they close (z), so the window looks through them that way
    g.translate(0, 0, side > 0 ? 0 : -t);
    return g;
  };
  const jaws = ([1, -1] as const).map((side) => {
    const pivot = new THREE.Group();
    pivot.position.y = 0.28;
    pivot.add(mesh(jawGeometry(side), metal));
    // Fine teeth across the gripping face
    for (let i = 0; i < 7; i++) {
      const tooth = mesh(new THREE.BoxGeometry(w * 1.6, 0.008, 0.01), metal, V(0, -0.05 - i * 0.035, side > 0 ? -0.004 : 0.004));
      pivot.add(tooth);
    }
    root.add(pivot);
    return { pivot, side };
  });
  root.userData.open = (angle: number) => {
    for (const { pivot, side } of jaws) pivot.rotation.x = (-side * angle) / 2;
  };
  root.userData.open(0.4);

  if (handle) {
    const h = new THREE.Group();
    h.position.y = 0.4 + length;
    // Rotation knob: knurled, with a blue band
    h.add(mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.12, 32), ink, V(0, 0.04, 0)));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const k = mesh(new THREE.BoxGeometry(0.016, 0.1, 0.03), ink, V(Math.cos(a) * 0.113, 0.04, Math.sin(a) * 0.113));
      k.rotation.y = -a;
      h.add(k);
    }
    h.add(mesh(new THREE.CylinderGeometry(0.117, 0.117, 0.022, 32), m(blue), V(0, 0.11, 0)));
    // Moulded body sweeping back into the finger ring
    const body = new THREE.Shape();
    body.moveTo(-0.075, 0.1);
    body.lineTo(0.075, 0.1);
    body.quadraticCurveTo(0.1, 0.34, 0.26, 0.5);
    body.lineTo(0.4, 0.62);
    body.lineTo(0.33, 0.72);
    body.quadraticCurveTo(0.05, 0.6, -0.04, 0.5);
    body.quadraticCurveTo(-0.1, 0.4, -0.075, 0.1);
    h.add(profile(body, 0.15, ink));
    h.add(profile(ringShape(0.52, 0.78, 0.17, 0.112), 0.12, ink));
    h.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.18, 12), m(gold), V(0, 0.62, 0.06))); // cautery post
    // Thumb lever, hinged inside the body
    const lever = new THREE.Group();
    lever.position.set(0, 0.36, -0.02);
    const arm = new THREE.Shape();
    arm.moveTo(-0.04, 0.03);
    arm.lineTo(0.04, -0.05);
    arm.quadraticCurveTo(0.22, -0.16, 0.36, -0.2);
    arm.lineTo(0.38, -0.1);
    arm.quadraticCurveTo(0.2, -0.04, 0.0, 0.08);
    arm.lineTo(-0.04, 0.03);
    lever.add(profile(arm, 0.11, ink), profile(ringShape(0.5, -0.2, 0.16, 0.105), 0.11, ink));
    h.add(lever);
    // Ratchet bar between the rings
    const ratchet = mesh(new THREE.BoxGeometry(0.025, 0.36, 0.025), metal, V(0, 0.36, -0.64));
    h.add(ratchet);
    root.add(h);
    root.userData.squeeze = (s: number) => {
      lever.rotation.x = 0.22 * s;
    };
  }
  return shadows(root) as Instrument;
}

/** Laparoscope: camera head, coupler, steel shaft and the light cable. Tip at the origin, shaft along +y. */
function scope(length = 2.8) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, length, 20), steel(), V(0, length / 2, 0)));
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.16, 28), steel(), V(0, length + 0.05, 0)));
  // Camera head: a rounded, tapering body
  const head = new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.16, 0.08], [0.17, 0.3], [0.14, 0.42], [0.08, 0.47], [0, 0.48]].map(([x, y]) => new THREE.Vector2(x, y)), 32);
  head.scale(1.15, 1, 0.95);
  g.add(mesh(head, black(), V(0, length + 0.13, 0)));
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 28), blue(), V(0, length + 0.15, 0)));
  // Light post and its cable looping away
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 12), steel(), V(0.1, length * 0.72, 0)).rotateZ(Math.PI / 2));
  const curve = new THREE.CatmullRomCurve3([V(0.2, length * 0.72, 0), V(0.45, length * 0.74, 0.05), V(0.7, length * 0.6, 0.1), V(0.85, length * 0.25, 0.15), V(0.95, -0.4, 0.2)]);
  g.add(mesh(new THREE.TubeGeometry(curve, 64, 0.03, 10), cable()));
  const cord = new THREE.CatmullRomCurve3([V(0, length + 0.6, 0), V(-0.05, length + 0.85, -0.1), V(-0.3, length + 0.95, -0.2), V(-0.6, length + 0.6, -0.25)]);
  g.add(mesh(new THREE.TubeGeometry(cord, 40, 0.025, 8), black()));
  return shadows(g);
}

/* ------------------------------------------------------------------ the trainer, assembled */

/** The whole trainer: plate, tub with a module, the split dome, trocars, two graspers and the scope. */
function trainer({ organ = pelvic("multiple"), tools = true } = {}) {
  const root = new THREE.Group();
  root.add(basePlate());
  const mod = module(organ);
  mod.position.set(0, 0.16, 0.05);
  root.add(mod);
  const back = domeHalf(false);
  back.position.y = 0.16;
  root.add(back);
  // The front half hangs on a hinge at its right-hand end, so it can swing open like a door
  const hinge = new THREE.Group();
  hinge.position.set(DOME.a, 0.16, 0);
  const front = domeHalf(true);
  front.position.x = -DOME.a;
  hinge.add(front);
  root.add(hinge);
  // A sensor panel on the front half, as in the render
  const at = domeAt(1.35, 1.0);
  const panel = slab(0.34, 0.26, 0.03, 0.05, new THREE.MeshStandardMaterial({ color: "#d9dbd7", roughness: 0.5 }));
  panel.add(mesh(new THREE.BoxGeometry(0.16, 0.012, 0.12), black(), V(0, 0.03, 0)));
  panel.position.copy(at.point);
  panel.quaternion.setFromUnitVectors(UP, at.normal);
  front.add(panel);

  const ports: { tool: THREE.Group; skin: THREE.Vector3; dir: THREE.Vector3; depth: number; phase: number }[] = [];
  if (tools) {
    const add = (x: number, z: number, lean: THREE.Vector3, tool: THREE.Group, depth: number, phase: number) => {
      const { point, normal } = domeAt(x, z);
      const out = normal.clone().add(lean).normalize();
      const t = trocar();
      aim(t, point, out);
      back.add(t);
      back.add(tool);
      ports.push({ tool, skin: point, dir: out, depth, phase });
    };
    const left = instrument({ length: 3.0 });
    const right = instrument({ length: 3.0, kind: "maryland" });
    add(-0.85, -0.45, V(-0.7, 0.3, 0.2), left, 1.5, 0);
    add(0.3, -0.75, V(-0.1, 0.4, 0.1), right, 1.4, 2.1);
    add(0.95, -0.35, V(0.45, 0.6, -0.1), scope(2.7), 1.25, 4.2);
  }
  const sway = (time: number, amount = 1) => {
    for (const { tool, skin, dir, depth, phase } of ports) {
      const d = dir.clone().add(V(Math.sin(time * 0.7 + phase) * 0.06 * amount, 0, Math.cos(time * 0.55 + phase) * 0.05 * amount)).normalize();
      aim(tool, skin.clone().addScaledVector(d, -depth), d);
      const u = tool.userData as InstrumentData;
      const grip = Math.max(0, Math.sin(time * 1.2 + phase));
      u.open?.(0.1 + 0.45 * grip);
      u.squeeze?.(1 - grip);
    }
  };
  sway(0);
  return { root, mod, back, hinge, sway };
}

/* ------------------------------------------------------------------ milestones */

/** Prototype simulator: the trainer in use; its front shell swings open to show the hydrogel module inside. */
function prototype(): Model {
  const t = trainer();
  return {
    root: t.root,
    update(time) {
      t.hinge.rotation.y = -1.75 * cycle(time, 9, 2.5);
      t.sway(time);
    },
  };
}

/** The pinecone mark, as a thin raised badge one unit tall. */
function logoBadge(material: THREE.Material) {
  const shapes = new SVGLoader().parse(markSvg).paths.flatMap((p) => SVGLoader.createShapes(p));
  const g = new THREE.ExtrudeGeometry(shapes, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.15, bevelSegments: 2, curveSegments: 6 });
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, 0);
  g.scale(1 / (b.max.y - b.min.y), -1 / (b.max.y - b.min.y), 0.02);
  return mesh(g, material);
}

/**
 * Production prototype: the trainer as a finished product. A graphite plinth with a lit seam and
 * the mark, one moulded shell with a smoked visor over the module, and flush ports with blue collars.
 */
function production(): Model {
  const root = new THREE.Group();
  const graphite = new THREE.MeshPhysicalMaterial({ color: "#2a2d30", roughness: 0.38, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.25 });
  const plinth = slab(5.4, 4.2, 0.62, 0.7, graphite, 0.12);
  root.add(plinth);
  // A lit seam around the plinth
  const seamShape = roundedRect(5.42, 4.22, 0.71);
  seamShape.holes.push(roundedRect(5.3, 4.1, 0.65));
  const seamGeo = new THREE.ExtrudeGeometry(seamShape, { depth: 0.035, bevelEnabled: false, curveSegments: 24 });
  seamGeo.rotateX(-Math.PI / 2);
  const glow = new THREE.MeshBasicMaterial({ color: "#5fb6ec" });
  const seam = mesh(seamGeo, glow, V(0, 0.44, 0));
  root.add(seam);
  // White top deck, inset
  const deck = slab(5.0, 3.8, 0.06, 0.55, plate(), 0.02);
  deck.position.y = 0.6;
  root.add(deck);
  const badge = logoBadge(new THREE.MeshStandardMaterial({ color: "#d9dcd8", roughness: 0.4, metalness: 0.3 }));
  badge.scale.setScalar(0.24);
  badge.position.set(-1.9, 0.3, 2.105);
  root.add(badge);

  // One moulded shell (both halves closed), with a smoked visor and flush ports
  const dome = new THREE.Group();
  dome.position.y = 0.66;
  const finish = new THREE.MeshPhysicalMaterial({ color: "#eef0ed", roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  dome.add(domeHalf(false, finish), domeHalf(true, finish));
  const visor = new THREE.BufferGeometry();
  const rows = 14;
  const cols = 28;
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const u = j / cols;
      const v = i / rows;
      const x = (u - 0.5) * 2.6 * (1 - 0.25 * v);
      const z = 1.62 - v * 0.95;
      const { point, normal } = domeAt(x, z);
      point.addScaledVector(normal, 0.012);
      verts.push(point.x, point.y, point.z);
      if (i < rows && j < cols) {
        const a = i * (cols + 1) + j;
        index.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
      }
    }
  }
  visor.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  visor.setIndex(index);
  visor.computeVertexNormals();
  dome.add(mesh(visor, new THREE.MeshPhysicalMaterial({ color: "#1d2329", roughness: 0.08, metalness: 0.3, clearcoat: 1, side: THREE.DoubleSide })));
  for (const [x, z] of [[-0.75, -0.35], [0.75, -0.35], [0, -0.85]]) {
    const { point, normal } = domeAt(x, z);
    const port = new THREE.Group();
    port.add(mesh(new THREE.TorusGeometry(0.13, 0.035, 12, 40), blue()));
    port.add(mesh(new THREE.CircleGeometry(0.12, 32), new THREE.MeshStandardMaterial({ color: "#2a2d30", roughness: 0.6 })));
    port.position.copy(point);
    port.quaternion.setFromUnitVectors(V(0, 0, 1), normal);
    dome.add(port);
  }
  root.add(shadows(dome));
  shadows(plinth);
  return {
    root,
    update(time) {
      // The seam breathes slowly
      glow.color.setHSL(0.565, 0.75, 0.55 + 0.12 * Math.sin(time * 1.4));
    },
  };
}

/** A line that fades into the tile as it trails behind a moving point. */
function trail(points: number, width: number) {
  const geometry = new LineGeometry();
  const positions = new Float32Array(points * 3);
  const colors = new Float32Array(points * 3);
  const c = new THREE.Color();
  for (let i = 0; i < points; i++) {
    c.copy(TILE).lerp(BLUE, (i / (points - 1)) ** 1.5);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setPositions(positions);
  geometry.setColors(colors);
  const material = new LineMaterial({ linewidth: width, vertexColors: true, worldUnits: false });
  const line = new Line2(geometry, material);
  line.frustumCulled = false;
  const history: THREE.Vector3[] = [];
  return {
    line,
    material,
    push(p: THREE.Vector3) {
      history.push(p.clone());
      while (history.length > points) history.shift();
      while (history.length < points) history.unshift(p.clone());
      history.forEach((h, i) => positions.set([h.x, h.y, h.z], i * 3));
      geometry.setPositions(positions);
    },
  };
}

/** The tracker's box around a tool tip, with its label: corner brackets that face the camera. */
function tracker(size: number, label: string) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: BLUE, depthTest: false, transparent: true });
  const arm = size * 0.32;
  const w = size * 0.05;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(mesh(new THREE.PlaneGeometry(arm, w), mat, V(sx * (size / 2 - arm / 2), sy * (size / 2), 0)));
    g.add(mesh(new THREE.PlaneGeometry(w, arm), mat, V(sx * (size / 2), sy * (size / 2 - arm / 2), 0)));
  }
  const tag = textPlane(0.9, 0.2, (c, W, H) => {
    c.fillStyle = "#2f86c4";
    roundRectPath(c, 0, 0, W, H, H / 2);
    c.fill();
    c.fillStyle = "#fff";
    c.font = `500 ${Math.round(H * 0.56)}px ${FONT}`;
    c.textBaseline = "middle";
    c.fillText(label, H * 0.45, H * 0.54);
  }, 0.6);
  tag.position.set(size / 2 + 0.28, size / 2 + 0.02, 0);
  g.add(tag);
  g.children.forEach((c) => (c.renderOrder = 15));
  return g;
}

/** The coach's step card: where the procedure is, and what comes next. */
function stepCard() {
  const steps = ["Expose the uterus", "Identify the fibroid", "Grasp the fibroid", "Incise the serosa", "Enucleate", "Close the defect"];
  const current = 2;
  return textPlane(1.9, 1.5, (c, W, H) => {
    const u = W / 1.9;
    c.fillStyle = "rgba(255,255,255,0.94)";
    roundRectPath(c, 0, 0, W, H, 0.12 * u);
    c.fill();
    c.strokeStyle = "rgba(15,46,20,0.12)";
    c.lineWidth = 0.008 * u;
    c.stroke();
    c.fillStyle = "#2f86c4";
    c.font = `500 ${0.085 * u}px ${FONT}`;
    c.fillText(`STEP ${current + 1} OF ${steps.length}`, 0.12 * u, 0.2 * u);
    c.fillStyle = "#0f2e14";
    c.font = `500 ${0.13 * u}px ${FONT}`;
    c.fillText(steps[current], 0.12 * u, 0.38 * u);
    steps.forEach((s, i) => {
      const y = 0.58 * u + i * 0.15 * u;
      const done = i < current;
      c.fillStyle = done ? "#166a2a" : i === current ? "#2f86c4" : "rgba(15,46,20,0.22)";
      c.beginPath();
      c.arc(0.17 * u, y - 0.03 * u, 0.04 * u, 0, Math.PI * 2);
      c.fill();
      if (done) {
        c.strokeStyle = "#fff";
        c.lineWidth = 0.012 * u;
        c.beginPath();
        c.moveTo(0.15 * u, y - 0.03 * u);
        c.lineTo(0.165 * u, y - 0.015 * u);
        c.lineTo(0.19 * u, y - 0.05 * u);
        c.stroke();
      }
      c.fillStyle = i === current ? "#0f2e14" : "rgba(15,46,20,0.55)";
      c.font = `${i === current ? 500 : 400} ${0.085 * u}px ${FONT}`;
      c.fillText(s, 0.27 * u, y);
    });
  }, 1);
}

/**
 * AI Coach: a camera inside the trainer watches the module. The target fibroid is outlined, each
 * tool is boxed and named with its recent path drawn behind it, a see-through guide tool shows
 * where to go next, and the step card says where the procedure is.
 */
function coach(): Model {
  const root = new THREE.Group();
  const organ = pelvic("multiple");
  root.add(module(organ));
  root.updateMatrixWorld(true);

  // Segmentation: the largest fibroid outlined in the accent
  const nodule = organ.getObjectByName("fibroids")!.children[0] as THREE.Mesh;
  const outline = mesh(nodule.geometry, overlay(0.35));
  outline.scale.setScalar(1.18);
  nodule.add(outline);
  const target = nodule.getWorldPosition(new THREE.Vector3());

  // The camera board on its post at the back of the tub, and what it sees
  const cam = new THREE.Group();
  cam.add(slab(0.36, 0.3, 0.05, 0.03, black()));
  cam.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 24), new THREE.MeshStandardMaterial({ color: "#0d1b26", roughness: 0.1, metalness: 0.6 }), V(0, 0.08, 0)));
  cam.position.set(0.95, 1.25, -0.85);
  cam.lookAt(target);
  cam.rotateX(Math.PI / 2);
  root.add(cam, mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 10), black(), V(0.95, 0.95, -0.92)));
  const eye = V(0.95, 1.22, -0.82);
  root.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([V(-0.8, 0.5, -0.4), V(0.7, 0.5, -0.5), V(-0.9, 0.5, 0.8), V(0.8, 0.5, 0.75)].flatMap((p) => [eye, p])),
      new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.3 }),
    ),
  );

  const paths = [
    (t: number) => target.clone().add(V(-0.35 + 0.22 * Math.sin(t * 0.9), 0.25 + 0.1 * Math.sin(t * 1.7), 0.2 * Math.sin(t * 1.3))),
    (t: number) => target.clone().add(V(0.4 + 0.22 * Math.sin(t * 1.1 + 2), 0.28 + 0.08 * Math.cos(t * 1.4), 0.2 * Math.cos(t * 0.9 + 1))),
  ];
  const tools = [
    { tool: instrument({ length: 2.6, handle: false }), port: V(-2.0, 3.6, -0.6), path: paths[0], label: "Grasper" },
    { tool: instrument({ length: 2.6, handle: false, kind: "maryland" }), port: V(2.0, 3.6, -0.2), path: paths[1], label: "Dissector" },
  ].map((tip) => {
    const tr = trail(80, 3);
    const box = tracker(0.34, tip.label);
    root.add(tip.tool, tr.line, box);
    return { ...tip, trail: tr, box };
  });
  // The guide: a see-through grasper a little ahead, at the grip the coach is asking for
  const guide = instrument({ length: 2.6, handle: false, material: overlay(0.28) });
  guide.traverse((o) => (o.castShadow = false));
  root.add(guide);

  const card = stepCard();
  card.position.set(2.45, 2.0, -0.4);
  root.add(card);

  return {
    root,
    update(time, camera, size) {
      for (const tip of tools) {
        const p = tip.path(time);
        aim(tip.tool, p, tip.port.clone().sub(p));
        tip.tool.userData.open(0.15 + 0.4 * Math.max(0, Math.sin(time * 1.6)));
        tip.box.position.copy(p).add(V(0, 0.05, 0));
        faceCamera(tip.box, camera);
        tip.trail.material.resolution.copy(size);
        tip.trail.push(p);
      }
      const g = target.clone().add(V(-0.12, 0.12, 0.05));
      aim(guide, g, tools[0].port.clone().sub(g));
      guide.userData.open(0.55);
      (outline.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(time * 2.2));
      faceCamera(card, camera);
    },
  };
}

/** Custom instruments: one grasper in full detail, turning slowly, its jaws and thumb lever working. */
function instruments(): Model {
  const root = new THREE.Group();
  const tool = instrument({ length: 3.2 });
  // Turned on its shaft so the handle shows its profile, then laid across the frame
  tool.rotation.y = Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(tool);
  holder.rotation.set(0, 0, -1.32);
  holder.position.set(-2.1, 0.5, 0);
  root.add(holder);
  return {
    root,
    update(time) {
      const grip = cycle(time, 3.2);
      tool.userData.open(0.05 + 0.75 * grip);
      tool.userData.squeeze?.(1 - grip);
      holder.position.y = 0.5 + Math.sin(time * 0.7) * 0.04;
    },
  };
}

/**
 * Pathology module library: six modules for the one base, on a two-step stand. Front: a healthy
 * uterus, several fibroids, one large fibroid. Back: liver and gallbladder, a liver lesion, upper GI.
 */
function library(): Model {
  const root = new THREE.Group();
  const stand = new THREE.Group();
  stand.add(slab(9.6, 4.8, 0.14, 0.4, plate()));
  const step = slab(9.6, 2.3, 0.7, 0.3, plate());
  step.position.set(0, 0.14, -1.25);
  stand.add(step);
  root.add(shadows(stand));
  const rows = [
    { y: 0.14, z: 1.1, organs: [pelvic("none"), pelvic("multiple"), pelvic("single")] },
    { y: 0.84, z: -1.25, organs: [liver(false), liver(true), upperGI()] },
  ];
  for (const row of rows) {
    row.organs.forEach((organ, i) => {
      const m = module(organ);
      m.position.set((i - 1) * 3.05, row.y, row.z);
      root.add(m);
    });
  }
  return { root };
}

/** Clinical validation: the trainer closed and in use, both instruments and the scope working. */
function validation(): Model {
  const t = trainer();
  return {
    root: t.root,
    update(time) {
      t.sway(time, 1.4);
    },
  };
}

export const BUILDERS: Record<string, () => Model> = {
  prototype,
  production,
  coach,
  instruments,
  library,
  validation,
};
