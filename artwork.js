/* Hero artwork: a live 3D render of stacked MRI slices, each etched with the organ
   contour at that depth. Orbits slowly, tilts toward the pointer, spreads apart on
   scroll, and a scan plane sweeps through the stack. Falls back to the inline SVG. */
(() => {
  const host = document.querySelector('.hero-art');
  if (!host) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;
  canvas.className = 'hero-canvas';
  host.appendChild(canvas);
  host.classList.add('has-canvas');

  // The OS Reduce Motion setting is deliberately not honored: every visitor gets the full motion.
  // To honor it again, set this back to matchMedia('(prefers-reduced-motion: reduce)').matches.
  const reduce = false;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const BONE = '255,253,249';
  const BLUE = '79,163,209';
  const RED = '255,72,72';
  const CYAN = '64,150,255';

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

  /* Geometry, in units where the slab half-width is 1 */
  const bezier = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };
  const organSegments = [
    [[-74, -46], [-78, -92], [74, -96], [76, -50]],
    [[76, -50], [78, -8], [44, 30], [20, 68]],
    [[20, 68], [12, 86], [-12, 88], [-20, 70]],
    [[-20, 70], [-44, 30], [-72, -4], [-74, -46]],
  ];
  const organ = [];
  organSegments.forEach(([a, b, c, d]) => {
    for (let i = 0; i < 18; i++) {
      const [x, z] = bezier(a, b, c, d, i / 18);
      organ.push([x / 130, z / 130]);
    }
  });

  const roundedSquare = (h, r, steps = 6) => {
    const pts = [];
    [[h - r, h - r, 0], [-(h - r), h - r, 0.5], [-(h - r), -(h - r), 1], [h - r, -(h - r), 1.5]]
      .forEach(([cx, cz, start]) => {
        for (let i = 0; i <= steps; i++) {
          const a = (start + (i / steps) * 0.5) * Math.PI;
          pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
        }
      });
    return pts;
  };
  const circle = (cx, cz, r, n = 28) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
    });
  const transform = (pts, k, deg) => {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return pts.map(([x, z]) => [(x * c - z * s) * k, (x * s + z * c) * k]);
  };

  const slab = roundedSquare(1, 0.12);
  const scanFrame = roundedSquare(1.2, 0.16);
  const slices = [
    { k: 0.42, rot: -6 },
    { k: 0.68, rot: -3 },
    { k: 0.86, rot: 0, lesion: [32, -46, 9] },
    { k: 1, rot: 4, lesion: [28, -42, 16] },
    { k: 0.92, rot: 7, lesion: [30, -44, 10] },
    { k: 0.72, rot: 10 },
    { k: 0.45, rot: 14 },
  ].map((s) => ({
    ...s,
    outer: transform(organ, s.k, s.rot),
    inner: transform(organ, s.k * 0.55, s.rot),
    les: s.lesion ? circle(s.lesion[0] / 130, s.lesion[1] / 130, s.lesion[2] / 130) : null,
  }));
  const N = slices.length;
  const GAP = 0.34;

  /* Canvas sizing: drawn larger than the host so glow and spread aren't clipped */
  let W = 0;
  let H = 0;
  let dpr = 1;
  let scale = 1;
  let cx = 0;
  let cy = 0;
  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight || w * (720 / 640);
    W = w * 1.3;
    H = h * 1.3;
    dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    scale = w * 0.29;
    cx = W / 2;
    cy = H / 2;
    if (!running) draw(performance.now());
  };

  /* Camera */
  const cam = { cyaw: 1, syaw: 0, cp: 1, sp: 0 };
  const project = (x, y, z) => {
    const x1 = x * cam.cyaw - z * cam.syaw;
    const z1 = x * cam.syaw + z * cam.cyaw;
    const y2 = y * cam.cp - z1 * cam.sp;
    const z2 = y * cam.sp + z1 * cam.cp;
    const f = 5 / (5 - z2);
    return [cx + x1 * f * scale, cy - y2 * f * scale];
  };
  const pathAt = (pts, y) => {
    const p = new Path2D();
    pts.forEach(([x, z], i) => {
      const [sx, sy] = project(x, y, z);
      if (i) p.lineTo(sx, sy); else p.moveTo(sx, sy);
    });
    p.closePath();
    return p;
  };

  let fringe = 1.3;
  const glowScale = coarse ? 0.6 : 1;
  const chromaStroke = (path, alpha, width, blur) => {
    if (alpha <= 0.002) return;
    ctx.lineWidth = width;
    ctx.save();
    ctx.translate(fringe, 0);
    ctx.strokeStyle = `rgba(${RED},${alpha * 0.55})`;
    ctx.stroke(path);
    ctx.translate(-fringe * 2, 0);
    ctx.strokeStyle = `rgba(${CYAN},${alpha * 0.6})`;
    ctx.stroke(path);
    ctx.restore();
    ctx.shadowColor = `rgba(${BLUE},${Math.min(1, alpha)})`;
    ctx.shadowBlur = blur * dpr * glowScale;
    ctx.strokeStyle = `rgba(${BONE},${Math.min(1, alpha)})`;
    ctx.stroke(path);
    ctx.shadowBlur = 0;
  };

  /* Inputs: pointer, scroll, and the intro start time */
  let startAt = window.veridienStartedAt || Infinity;
  window.addEventListener('veridien:start', () => { startAt = window.veridienStartedAt || performance.now(); });

  let tx = 0;
  let ty = 0;
  let mx = 0;
  let my = 0;
  addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth) * 2 - 1;
    ty = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  const hero = document.querySelector('.hero');
  let lastScroll = scrollY;

  function draw(now) {
    const t = now / 1000;
    const age = (now - startAt) / 1000;
    const intro = easeOutExpo(clamp(age / 2.2, 0, 1));
    const heroH = hero ? hero.offsetHeight : innerHeight;
    const sp = reduce ? 0 : clamp(scrollY / Math.max(heroH, 1), 0, 1.4);

    const velocity = reduce ? 0 : Math.abs(scrollY - lastScroll);
    lastScroll = scrollY;
    fringe += (clamp(1.3 + velocity * 0.12, 1.3, 6) - fringe) * 0.12;

    if (!reduce) {
      mx += (tx - mx) * 0.05;
      my += (ty - my) * 0.05;
    }

    const yaw = 0.785 + Math.sin(t * 0.18) * 0.22 + mx * 0.35 + sp * 0.9;
    const pitch = 0.62 + my * 0.1 - sp * 0.12;
    cam.cyaw = Math.cos(yaw);
    cam.syaw = Math.sin(yaw);
    cam.cp = Math.cos(pitch);
    cam.sp = Math.sin(pitch);

    const stacked = innerWidth < 960;
    const spread = (reduce ? 1 : 0.2 + 0.8 * intro) * (1 + sp * (stacked ? 0.25 : 1.1));
    const top = 3 * GAP * spread;
    const span = 6 * GAP * spread;
    const cycle = (t / 6.6) % 1;
    const scanY = top + 0.35 - cycle * (span + 0.7);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';

    /* Rails through the stack's corners */
    const railAlpha = 0.14 * intro;
    [[1, 1], [-1, 1], [1, -1]].forEach(([x, z]) => {
      const [x1, y1] = project(x * 0.94, top, z * 0.94);
      const [x2, y2] = project(x * 0.94, top - span, z * 0.94);
      ctx.strokeStyle = `rgba(${BONE},${railAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    for (let i = N - 1; i >= 0; i--) {
      const s = slices[i];
      const y = (3 - i) * GAP * spread;
      const a = clamp((age - 0.05 - (N - 1 - i) * 0.09) / 0.7, 0, 1);
      if (a <= 0) continue;
      const lit = Math.exp(-((y - scanY) ** 2) / (2 * 0.1 * 0.1));

      const plate = pathAt(slab, y);
      ctx.fillStyle = `rgba(${BONE},${(0.03 + lit * 0.05) * a})`;
      ctx.fill(plate);
      ctx.fillStyle = `rgba(${BLUE},${(0.05 + lit * 0.08) * a})`;
      ctx.fill(plate);
      chromaStroke(plate, ((i === 0 ? 0.85 : 0.38) + lit * 0.5) * a, 1, 6 + lit * 10);

      const outer = pathAt(s.outer, y);
      ctx.fillStyle = `rgba(${BONE},${(0.04 + lit * 0.06) * a})`;
      ctx.fill(outer);
      chromaStroke(outer, (0.88 + lit * 0.3) * a, 1.5, 10 + lit * 14);

      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = `rgba(${BONE},${(0.3 + lit * 0.3) * a})`;
      ctx.lineWidth = 1;
      ctx.stroke(pathAt(s.inner, y));
      ctx.setLineDash([]);

      if (s.les) {
        ctx.shadowColor = `rgba(${BLUE},1)`;
        ctx.shadowBlur = (16 + lit * 16) * dpr * glowScale;
        ctx.fillStyle = `rgba(${BLUE},${(0.85 + lit * 0.15) * a})`;
        ctx.fill(pathAt(s.les, y));
        ctx.shadowBlur = 0;
      }
    }

    /* Scan plane */
    const edgeFade = clamp(1 - Math.abs(scanY - (top - span / 2)) / (span / 2 + 0.35), 0, 1);
    const scanAlpha = 0.55 * intro * Math.min(1, edgeFade * 1.6);
    if (scanAlpha > 0.01) {
      const frame = pathAt(scanFrame, scanY);
      ctx.fillStyle = `rgba(${BLUE},${scanAlpha * 0.08})`;
      ctx.fill(frame);
      ctx.shadowColor = `rgba(${BLUE},1)`;
      ctx.shadowBlur = 18 * dpr * glowScale;
      ctx.strokeStyle = `rgba(${BLUE},${scanAlpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke(frame);
      ctx.shadowBlur = 0;
    }
  }

  /* Loop only while the hero is on screen */
  let running = false;
  let rafId = 0;
  const loop = (now) => {
    draw(now);
    rafId = requestAnimationFrame(loop);
  };
  const play = () => {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(rafId);
  };

  resize();
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => (entry.isIntersecting ? play() : pause())).observe(host);
  } else {
    play();
  }
})();
