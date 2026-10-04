/* Home hero: the modular simulator, driven by scroll.
   The hero section is tall; its stage stays pinned while scroll progress (0..1) runs:
     0.00-0.07  closed white trainer, headline visible
     0.07-0.52  cover turns translucent, lifts away, modules separate (labels appear)
     0.58-0.72  pelvic module: healthy uterus swaps to fibroid uterus
     0.76-0.94  imaging planes sweep the pelvic module (patient-scan option)
   The OS Reduce Motion setting is not honored (see `reduce` below); the still-view branches stay for an easy switch back. */
import { buildSimulator, stageScene, THREE } from './abdomen-model.js';

const hero = document.querySelector('.sim-hero');
if (hero) start();

function start() {
  const stage = hero.querySelector('.sim-stage');
  // The OS Reduce Motion setting is deliberately not honored: every visitor gets the full motion.
  // To honor it again, set this back to matchMedia('(prefers-reduced-motion: reduce)').matches.
  const reduce = false;
  const coarse = matchMedia('(pointer: coarse)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    return; // No WebGL: the poster image stays
  }

  const quality = coarse || innerWidth < 720 ? 'low' : 'high';
  let dprCap = coarse ? 1.5 : 1.75;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'sim-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.insertBefore(renderer.domElement, stage.querySelector('.sim-labels'));

  const scene = new THREE.Scene();
  stageScene(renderer, scene);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const sim = buildSimulator({ quality });
  scene.add(sim.root);

  /* Module labels: pills pinned to each module's projected center */
  const labelLayer = hero.querySelector('.sim-labels');
  const labels = Object.values(sim.modules).map((m) => {
    const el = document.createElement('span');
    el.className = 'sim-label';
    el.textContent = m.label;
    labelLayer.appendChild(el);
    return { module: m, el };
  });

  /* Layout: model on the right on desktop, in the upper part on phones */
  let W = 1, H = 1, desktop = true, distScale = 1;
  const resize = () => {
    W = stage.clientWidth;
    H = stage.clientHeight;
    desktop = W >= 960;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    if (desktop) camera.setViewOffset(W, H, -W * 0.2, H * 0.03, W, H);
    else camera.setViewOffset(W, H, 0, H * 0.17, W, H);
    // Pull back on narrow or tall screens so the exploded model still fits
    distScale = desktop ? Math.max(1, 1.55 / camera.aspect) : Math.max(1.2, 1.25 / camera.aspect);
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  /* Scroll progress through the pinned section */
  let p = 0;
  const target = { p: 0 };
  const readProgress = () => {
    const rect = hero.getBoundingClientRect();
    const span = rect.height - innerHeight;
    target.p = span > 0 ? Math.min(Math.max(-rect.top / span, 0), 1) : 0;
  };

  const ramp = (v, a, b) => Math.min(Math.max((v - a) / (b - a), 0), 1);
  const ease = (t) => t * t * (3 - 2 * t);

  /* Captions and headline */
  const intro = hero.querySelector('.sim-intro');
  const hint = hero.querySelector('.sim-hint');
  const caps = [...hero.querySelectorAll('.sim-cap')];
  let step = -1;
  const setStep = (next) => {
    if (reduce || next === step) return;
    step = next;
    intro.classList.toggle('is-hidden', step > 0);
    if (hint) hint.classList.toggle('is-hidden', step > 0);
    caps.forEach((c) => {
      const on = +c.dataset.step === step;
      c.classList.toggle('is-active', on);
      c.querySelectorAll('[data-reveal]').forEach((el) => el.classList.toggle('is-in', on));
    });
  };
  // Reduce Motion: captions are a plain list, each fading in as it scrolls into view
  if (reduce) {
    const show = (c) => c.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
      }), { rootMargin: '0px 0px -12% 0px' });
      caps.forEach((c) => io.observe(c));
    } else caps.forEach(show);
  }

  /* Camera rig */
  const baseTarget = new THREE.Vector3(0, 1.1, 0.7);
  const overview = new THREE.Vector3(11.6, 13.2, 21);
  const focusOffset = new THREE.Vector3(3.8, 3.4, 7.4);
  const pelvicWorld = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const timeline = (prog) => {
    if (reduce) return { explode: 1, swap: 0, scan: 0, focus: 0, labels: 1, spin: 0.35 };
    const explode = ramp(prog, 0.07, 0.52);
    const swap = ramp(prog, 0.58, 0.72);
    const scan = ramp(prog, 0.76, 0.94);
    const focus = ease(ramp(prog, 0.54, 0.62)) * (1 - ease(ramp(prog, 0.95, 1)));
    const labels = ramp(prog, 0.34, 0.39) * (1 - ramp(prog, 0.54, 0.58));
    return { explode, swap, scan, focus, labels, spin: 0.2 + prog * 0.55 };
  };
  const stepFor = (prog) => (reduce ? 0 : prog < 0.07 ? 0 : prog < 0.33 ? 1 : prog < 0.56 ? 2 : prog < 0.76 ? 3 : 4);

  /* Adaptive quality: drop pixel ratio if frames run slow */
  let frameCount = 0, slowFrames = 0, lastNow = 0;
  const adapt = (now) => {
    if (lastNow) {
      const dt = now - lastNow;
      frameCount++;
      if (dt > 24) slowFrames++;
      if (frameCount >= 90) {
        if (slowFrames > 30 && dprCap > 1) {
          dprCap = Math.max(1, dprCap - 0.25);
          renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
          resize();
        }
        frameCount = 0;
        slowFrames = 0;
      }
    }
    lastNow = now;
  };

  /* Model's on-screen bounds, exposed for layout checks */
  const box = new THREE.Box3();
  window.veridienSim = {
    sim,
    camera,
    progress: () => p,
    snap() { readProgress(); p = target.p; },
    frame() { render(performance.now()); },
    screenBounds() {
      box.makeEmpty();
      sim.root.traverseVisible((o) => {
        const mats = o.material ? [].concat(o.material) : [];
        if (o.isMesh && mats.some((m) => !m.transparent || m.opacity > 0.05)) box.expandByObject(o);
      });
      const r = stage.getBoundingClientRect();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        tmp.set(x, y, z).project(camera);
        const sx = r.left + (tmp.x + 1) / 2 * r.width;
        const sy = r.top + (1 - tmp.y) / 2 * r.height;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
      return { left: minX, top: minY, right: maxX, bottom: maxY };
    },
  };

  let ready = false;
  const render = (now) => {
    adapt(now);
    readProgress();
    p += (target.p - p) * (reduce ? 1 : 0.14);
    if (Math.abs(target.p - p) < 0.0005) p = target.p;
    const t = now / 1000;
    const tl = timeline(p);
    setStep(stepFor(p));

    sim.root.rotation.y = tl.spin + Math.sin(t * 0.3) * (reduce ? 0.25 : 0.05);
    sim.update({ explode: tl.explode, swap: tl.swap, scan: tl.scan, isolate: tl.focus, time: t });
    sim.root.updateMatrixWorld(true);

    const pelvic = sim.modules.pelvic;
    pelvic.group.localToWorld(pelvicWorld.copy(pelvic.anchor));
    lookAt.copy(baseTarget).lerp(pelvicWorld, tl.focus);
    tmp.copy(overview).multiplyScalar(distScale * (1 + 0.25 * tl.explode)).lerp(focusOffset.clone().multiplyScalar(distScale), tl.focus);
    camera.position.copy(lookAt).add(tmp);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();

    labels.forEach(({ module, el }) => {
      module.group.localToWorld(tmp.copy(module.anchor));
      tmp.project(camera);
      const x = (tmp.x + 1) / 2 * W;
      const y = (1 - tmp.y) / 2 * H;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${(y - 34).toFixed(1)}px, 0) translate(-50%, -50%)`;
      el.style.opacity = tl.labels.toFixed(3);
    });

    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      hero.classList.add('sim-ready');
    }
  };

  /* Only animate while the hero is on screen and the tab is visible */
  let visible = true;
  const loop = (now) => {
    if (visible && !document.hidden) render(now);
    requestAnimationFrame(loop);
  };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(hero);
  }
  requestAnimationFrame(loop);
}
