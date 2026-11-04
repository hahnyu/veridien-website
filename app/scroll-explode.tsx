import { type ReactNode, useEffect, useRef } from "react";

const FRAMES = 150;
const LOADERS = 6;

/**
 * The render only visibly moves between these frames (measured: under 0.1 % of pixels change outside
 * them). The scroll spends its distance there, with a short lead-in and a short rest at the end, so
 * the page answers straight away. Re-measure if the shot's timing changes.
 */
const MOTION_START = 22;
const MOTION_END = 112;
const LEAD = 0.03;
const REST = 0.06;

function frameAt(progress: number): number {
  if (progress < LEAD) return (progress / LEAD) * MOTION_START;
  if (progress > 1 - REST) {
    return MOTION_END + ((progress - (1 - REST)) / REST) * (FRAMES - 1 - MOTION_END);
  }
  return MOTION_START + ((progress - LEAD) / (1 - LEAD - REST)) * (MOTION_END - MOTION_START);
}

type FrameSet = "1600" | "2560";

const frameUrl = (set: FrameSet, i: number) =>
  `/renders/scroll_explode/${set}/f${String(i).padStart(3, "0")}.webp`;

/** Phones get the smaller set; larger screens get the bigger one when they can show the detail. */
function frameSet(box: HTMLElement): FrameSet {
  const devicePixels = box.getBoundingClientRect().width * window.devicePixelRatio;
  return window.innerWidth >= 1024 && devicePixels > 1700 ? "2560" : "1600";
}

/** First, last, then coarse to fine, so any scroll position soon has a decoded frame near it. */
function loadOrder(count: number): number[] {
  const order = [0, count - 1];
  const seen = new Set(order);
  for (let step = 32; step >= 1; step = Math.floor(step / 2)) {
    for (let i = 0; i < count; i += step) {
      if (!seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    }
  }
  return order;
}

const insideUrl = (set: FrameSet) => `/renders/scroll_explode/${set}/inside.webp`;

/**
 * Lens radius as a share of the frame width, and how far into the scroll it has faded out. The lens
 * image only lines up with the closed dome, so it has to be gone just as the shell starts to move.
 */
const LENS_SIZE = 0.13;
const LENS_FADE_END = 0.05;

function wantsStill(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData) || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scrubs a pre-rendered frame sequence with the scroll position. The first frame is real HTML, so
 * the page is complete without JavaScript, on reduced motion and on data saver.
 */
export function ScrollExplode({ alt, children }: { alt: string; children?: ReactNode }) {
  const trackRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!track || !canvas || !context) return;
    if (wantsStill()) {
      track.dataset.still = "";
      return;
    }

    const set = frameSet(canvas);
    const frames: (HTMLImageElement | null)[] = new Array(FRAMES).fill(null);
    let shown = -1;
    let queued = false;
    let stopped = false;

    const wanted = () => {
      const span = track.offsetHeight - window.innerHeight;
      const progress = span > 0 ? -track.getBoundingClientRect().top / span : 0;
      return Math.round(frameAt(Math.min(1, Math.max(0, progress))));
    };

    const nearest = (index: number) => {
      for (let distance = 0; distance < FRAMES; distance++) {
        if (frames[index - distance]) return index - distance;
        if (frames[index + distance]) return index + distance;
      }
      return -1;
    };

    const draw = () => {
      queued = false;
      const index = nearest(wanted());
      const frame = frames[index];
      if (!frame || index === shown) return;
      if (shown < 0) {
        // Sized from the first frame, so a sequence of any width drops in without a code change.
        canvas.width = frame.naturalWidth;
        canvas.height = frame.naturalHeight;
        canvas.dataset.ready = "";
      }
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      shown = index;
    };

    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(draw);
    };

    const queue = loadOrder(FRAMES);
    const loader = async () => {
      for (let next = queue.shift(); next !== undefined && !stopped; next = queue.shift()) {
        const image = new Image();
        image.src = frameUrl(set, next);
        try {
          await image.decode();
        } catch {
          continue;
        }
        frames[next] = image;
        request();
      }
    };

    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    for (let i = 0; i < LOADERS; i++) void loader();

    return () => {
      stopped = true;
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
    };
  }, []);

  // A soft lens follows the mouse and cuts through the shell to the image underneath. It only
  // answers to a real pointer, so touch screens keep the plain scroll.
  useEffect(() => {
    const track = trackRef.current;
    const frame = frameRef.current;
    if (!track || !frame || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const instant = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const inside = new Image();
    inside.src = insideUrl(frameSet(frame));
    inside.className = "hero-inside";
    inside.alt = "";
    frame.prepend(inside);

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let radius = 0;
    let over = false;
    let running = false;

    const scrollFade = () => {
      const span = track.offsetHeight - window.innerHeight;
      const progress = span > 0 ? -track.getBoundingClientRect().top / span : 0;
      return Math.min(1, Math.max(0, 1 - progress / LENS_FADE_END));
    };

    const step = () => {
      const size = frame.offsetWidth * LENS_SIZE;
      const targetRadius = over ? size * scrollFade() : 0;
      const follow = instant ? 1 : 0.22;
      const grow = instant ? 1 : 0.14;
      x += (targetX - x) * follow;
      y += (targetY - y) * follow;
      radius += (targetRadius - radius) * grow;

      const settled =
        Math.abs(targetX - x) < 0.3 &&
        Math.abs(targetY - y) < 0.3 &&
        Math.abs(targetRadius - radius) < 0.3;
      if (settled) radius = targetRadius;

      if (radius < 0.5) {
        delete frame.dataset.lens;
      } else {
        frame.dataset.lens = "";
        frame.style.setProperty("--lens-x", `${x.toFixed(1)}px`);
        frame.style.setProperty("--lens-y", `${y.toFixed(1)}px`);
        frame.style.setProperty("--lens-r", `${radius.toFixed(1)}px`);
      }

      if (settled) running = false;
      else requestAnimationFrame(step);
    };

    const wake = () => {
      if (running) return;
      running = true;
      requestAnimationFrame(step);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = frame.getBoundingClientRect();
      targetX = event.clientX - box.left;
      targetY = event.clientY - box.top;
      if (!over) {
        // Open where the mouse is, rather than sliding in from the last place it left.
        x = targetX;
        y = targetY;
      }
      over = true;
      wake();
    };

    const onLeave = () => {
      over = false;
      wake();
    };

    frame.addEventListener("pointermove", onMove);
    frame.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", wake, { passive: true });

    return () => {
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", wake);
      inside.remove();
    };
  }, []);

  return (
    <section ref={trackRef} className="hero">
      <div className="hero-stage">
        {children}
        <div ref={frameRef} className="hero-frame">
          <div className="hero-surface">
            <picture>
              <source media="(min-width: 1024px)" srcSet={frameUrl("2560", 0)} />
              <img
                src={frameUrl("1600", 0)}
                width={1600}
                height={900}
                alt={alt}
                fetchPriority="high"
              />
            </picture>
            <canvas ref={canvasRef} aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  );
}
