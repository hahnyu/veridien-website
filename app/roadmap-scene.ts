import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { BUILDERS, type Model, shadeStep } from "./roadmap-models";

/** Models that would look odd going all the way round (a row of trays) sway instead. */
const SWAY = new Set(["library", "instruments"]);
/** Where each model faces when it first appears, so its best side is toward the reader. */
const FACING: Record<string, number> = { prototype: -0.45, production: -0.5, coach: -0.2, instruments: 0.15, library: 0, validation: 0.35 };
const FOV = 26;
const SPIN = 0.2; // rad/s

type View = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  name: string;
  visible: boolean;
  built?: { model: Model; scene: THREE.Scene; camera: THREE.PerspectiveCamera; turntable: THREE.Group; target: number };
  drag: number;
  velocity: number;
  dragging: boolean;
};

/** A soft round shadow on the tile, under the model. */
function shadowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!;
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(15, 46, 20, 0.2)");
  g.addColorStop(0.55, "rgba(15, 46, 20, 0.08)");
  g.addColorStop(1, "rgba(15, 46, 20, 0)");
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One WebGL renderer draws every card: each visible card's model is rendered, then copied into that
 * card's own 2D canvas. A single GPU context serves the whole section, which phones need, and a card
 * that is off screen costs nothing. Returns a function that stops it all.
 */
export function startRoadmapScene(canvases: HTMLCanvasElement[], { still = false } = {}): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.setPixelRatio(1); // sizes below are already in device pixels
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap; // soft-edged, like the studio light in the hero

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const shadow = shadowTexture();
  const size = new THREE.Vector2();

  const views: View[] = canvases.map((canvas) => ({
    canvas,
    context: canvas.getContext("2d")!,
    name: canvas.dataset.model ?? "",
    visible: false,
    drag: 0,
    velocity: 0,
    dragging: false,
  }));

  const build = (view: View) => {
    const make = BUILDERS[view.name];
    if (!make) return;
    const model = make();
    const scene = new THREE.Scene();
    scene.environment = environment;
    scene.environmentIntensity = 0.42;
    scene.add(new THREE.HemisphereLight("#f4f6f5", "#c3cac5", 0.55));
    // A soft key from the upper left, as in the hero render, casting the only real shadow
    const key = new THREE.DirectionalLight("#fffaf3", 1.25);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 12;
    key.shadow.blurSamples = 16;
    key.shadow.bias = -0.0008;
    scene.add(key, key.target);

    // Frame the model over the range it moves through, centred on the turntable's axis
    const box = new THREE.Box3();
    const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 0.1, 100);
    for (const t of [0, 1.3, 2.6, 3.9, 5.2]) {
      model.update?.(t, camera, size.set(800, 600));
      model.root.updateMatrixWorld(true);
      // Not `precise`: fat lines carry a unit quad as their position attribute, which would throw the box off
      box.union(new THREE.Box3().setFromObject(model.root));
    }
    const center = box.getCenter(new THREE.Vector3());
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    model.root.position.x -= center.x;
    model.root.position.z -= center.z;
    const turntable = new THREE.Group();
    turntable.add(model.root);
    scene.add(turntable);

    const reach = Math.hypot(half.x, half.z);
    const radius = Math.hypot(reach, half.y);
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 0.8;
    const dir = new THREE.Vector3(0, 0.3, 1).normalize(); // low, as in the hero
    camera.position.copy(dir.multiplyScalar(distance)).add(new THREE.Vector3(0, center.y, 0));
    camera.lookAt(0, center.y, 0);

    // Soft contact shadow underneath, plus a floor that only shows the key light's shadow
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = box.min.y + 0.002;
    floor.scale.setScalar(reach * 2.4);
    scene.add(floor);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(reach * 6, reach * 6), new THREE.ShadowMaterial({ color: "#0f2e14", opacity: 0.14 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = box.min.y + 0.004;
    catcher.receiveShadow = true;
    scene.add(catcher);
    const span = radius * 1.4;
    key.position.set(-0.45 * radius, center.y + 3 * radius, 0.6 * radius);
    key.target.position.set(0, center.y, 0);
    Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.1, far: radius * 6 });
    key.shadow.camera.updateProjectionMatrix();

    view.built = { model, scene, camera, turntable, target: FACING[view.name] ?? 0.4 };
  };

  const draw = (view: View, time: number) => {
    if (!view.built) build(view);
    const b = view.built;
    if (!b) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(view.canvas.clientWidth * dpr);
    const h = Math.round(view.canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (view.canvas.width !== w || view.canvas.height !== h) {
      view.canvas.width = w;
      view.canvas.height = h;
    }
    renderer.getSize(size);
    if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
    b.camera.aspect = w / h;
    b.camera.updateProjectionMatrix();

    const t = still ? 2 : time;
    const auto = still ? 0 : SWAY.has(view.name) ? Math.sin(t * 0.35) * 0.45 : t * SPIN;
    b.turntable.rotation.y = b.target + auto + view.drag;
    b.model.update?.(t, b.camera, size.set(w, h));
    renderer.render(b.scene, b.camera);
    view.context.clearRect(0, 0, w, h);
    view.context.drawImage(renderer.domElement, 0, 0);
  };

  // Drag to turn a model; it keeps a little momentum when let go
  const cleanups: (() => void)[] = [];
  for (const view of views) {
    const tile = view.canvas.parentElement ?? view.canvas;
    let lastX = 0;
    const down = (e: PointerEvent) => {
      view.dragging = true;
      lastX = e.clientX;
      view.velocity = 0;
      tile.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!view.dragging) return;
      const dx = (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
      view.drag += dx;
      view.velocity = dx;
      if (still) draw(view, 0);
    };
    const up = () => {
      view.dragging = false;
    };
    tile.addEventListener("pointerdown", down);
    tile.addEventListener("pointermove", move);
    tile.addEventListener("pointerup", up);
    tile.addEventListener("pointercancel", up);
    cleanups.push(() => {
      tile.removeEventListener("pointerdown", down);
      tile.removeEventListener("pointermove", move);
      tile.removeEventListener("pointerup", up);
      tile.removeEventListener("pointercancel", up);
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const view = views.find((v) => v.canvas === entry.target);
        if (!view) continue;
        view.visible = entry.isIntersecting;
        if (still && view.visible) draw(view, 0);
      }
    },
    { rootMargin: "80px" },
  );
  views.forEach((view) => observer.observe(view.canvas));

  let frame = 0;
  const start = performance.now();
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    if (document.hidden) return;
    const time = (now - start) / 1000;
    for (const view of views) {
      if (!view.visible) continue;
      if (!view.dragging) {
        view.drag += view.velocity;
        view.velocity *= 0.92;
      }
      draw(view, time);
    }
  };
  if (!still) frame = requestAnimationFrame(loop);

  // Crease shading for the organs, a slice at a time while the page is idle; a still page redraws once it's done
  let idle = 0;
  const hasIdle = "requestIdleCallback" in window; // Safari has only had it recently
  const later = (fn: () => void) => (hasIdle ? requestIdleCallback(fn, { timeout: 200 }) : window.setTimeout(fn, 40));
  const shade = () => {
    if (!shadeStep(8)) idle = later(shade);
    else if (still) views.forEach((view) => view.visible && draw(view, 0));
  };
  idle = later(shade);

  return () => {
    cancelAnimationFrame(frame);
    if (hasIdle) cancelIdleCallback(idle);
    else clearTimeout(idle);
    observer.disconnect();
    cleanups.forEach((fn) => fn());
    renderer.dispose();
    environment.dispose();
    shadow.dispose();
  };
}
