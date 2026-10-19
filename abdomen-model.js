/* Modular abdominal simulator, built entirely in code.
   A base tray (with vessels and kidneys), a layered abdominal wall, and four swappable
   organ modules, each built in organs/*.js from the shared anatomy-kit.js. Generic organs are shaped from noise-displaced spheres and variable-radius
   tubes, shaded as cast PVA hydrogel.

   update({ explode, swap, scan, time }) drives everything:
     explode 0..1  wall lifts off, then modules separate along their own vectors
     swap    0..1  pelvic uterus morphs from healthy to fibroid
     scan    0..1  imaging planes sweep through the pelvic module */
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THREE, CLINICAL, clamp01, smooth, easeInOut, roundedRect, DOME_P, superDome, superOutline, hydrogel, occlusionJob } from './anatomy-kit.js';
import { buildHepatobiliary } from './organs/hepatobiliary.js';
import { buildUpperGI } from './organs/upper-gi.js';
import { buildBowel } from './organs/bowel.js';
import { buildPelvic } from './organs/pelvic.js';
import { buildBase } from './organs/base.js';

/* ---------------------------------------------------------------- simulator */

export function buildSimulator({ quality = 'high' } = {}) {
  const root = new THREE.Group();
  const hepatobiliary = buildHepatobiliary();
  const upperGI = buildUpperGI();
  const bowel = buildBowel();
  const pelvic = buildPelvic();
  const anatomy = buildBase();
  const parts = { uterus: pelvic.uterus, fibroids: pelvic.fibroids };

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
  base.add(plate, rim, plateEdges, rimEdges, ...anatomy.meshes);
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
    // tilt: how far a module rocks toward the viewer as it lifts, so flat organs show their shape
    // instead of an edge (the liver tips back to show its underside: gallbladder, ducts, porta).
    // The pelvic close-up stays level.
    hepatobiliary: { label: 'Hepatobiliary', group: new THREE.Group(), vector: new THREE.Vector3(-4.4, 2.6, -2.2), tilt: -0.8 },
    upperGI: { label: 'Upper GI', group: new THREE.Group(), vector: new THREE.Vector3(4.2, 2.4, -2.9), tilt: 0.5 },
    bowel: { label: 'Bowel', group: new THREE.Group(), vector: new THREE.Vector3(0, 3.3, 1.1), tilt: 0.35 },
    pelvic: { label: 'Pelvic', group: new THREE.Group(), vector: new THREE.Vector3(-0.3, 1.1, 4.8), tilt: 0 },
  };
  modules.hepatobiliary.group.add(...hepatobiliary.meshes);
  modules.upperGI.group.add(...upperGI.meshes);
  modules.bowel.group.add(...bowel.meshes);
  modules.pelvic.group.add(...pelvic.meshes);
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
    const m = hydrogel(color, { opacity: 0.12, roughness: 0.35, vertexColors: false, glow: 0.3, edge: 0.25 });
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
  const scanShape = roundedRect(3.6, 2.6, 0.22);
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

  // Crease shading: organs start unshaded (white vertex colors) and shadeStep(ms) fills it in
  // a slice at a time. Fibroids are posed at full size while it runs so they shade the uterus.
  [base, ...Object.values(modules).map((m) => m.group)].forEach((g) => g.traverse((o) => {
    if (o.isMesh && o.material.vertexColors) {
      o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 3).fill(1), 3));
    }
  }));
  const shadeJobs = [
    ...Object.values(modules).map((m) => occlusionJob(m.group, { floorY: 0.02 })),
    occlusionJob(base, { cell: 0.12, floorY: 0.02 }),
  ];
  function shadeStep(budgetMs = 6) {
    if (!shadeJobs.length) return true;
    const sizes = parts.fibroids.children.map((node) => node.scale.x);
    parts.fibroids.children.forEach((node) => node.scale.setScalar(1));
    const end = performance.now() + budgetMs;
    while (shadeJobs.length && performance.now() < end) {
      if (shadeJobs[0].next().done) shadeJobs.shift();
    }
    parts.fibroids.children.forEach((node, i) => node.scale.setScalar(sizes[i]));
    return !shadeJobs.length;
  }

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
  const pivot = new THREE.Vector3();
  const pivotR = new THREE.Vector3();

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
      // Tilt around the module's own center, not the group origin
      m.group.rotation.x = m.tilt * spread;
      if (m.anchor && m.tilt) m.group.position.add(pivot.copy(m.anchor).sub(pivotR.copy(m.anchor).applyEuler(m.group.rotation)));
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

  return { root, modules, update, state, shadeStep };
}

/* Environment and lights shared by every page that shows the simulator */
export function stageScene(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight('#c9d6e2', '#0b0b0c', 0.35));
  const key = new THREE.DirectionalLight('#fff3e6', 2.0);
  key.position.set(-6, 10, 8);
  const rimBlue = new THREE.DirectionalLight(CLINICAL, 1.5);
  rimBlue.position.set(-9, 4, -10);
  const rimWarm = new THREE.DirectionalLight('#ffc2a0', 2.4);
  rimWarm.position.set(10, 3, -8);
  const under = new THREE.PointLight('#4fa3d1', 6, 18, 1.6);
  under.position.set(0, -1.5, 2);
  scene.add(key, rimBlue, rimWarm, under);
}

export { THREE };
