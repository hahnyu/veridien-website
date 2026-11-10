import { useEffect, useRef } from "react";

import { wantsStill } from "./scroll-explode";

type Milestone = {
  /** Which model in roadmap-models.ts the card shows. */
  model: string;
  date: string;
  title: string;
  text: string;
  /** The milestone in progress today. */
  now?: boolean;
};

// Dates are targets.
const MILESTONES: Milestone[] = [
  {
    model: "prototype",
    date: "Fall 2026",
    now: true,
    title: "Prototype simulator",
    text: "The dome trainer on its base, with hydrogel organ modules that swap in underneath.",
  },
  {
    model: "production",
    date: "Winter 2027",
    title: "Production prototype",
    text: "A refined build, designed to be made the same way every time.",
  },
  {
    model: "coach",
    date: "Winter 2027",
    title: "AI Coach",
    text: "Step-by-step guidance and feedback from cameras that track every instrument.",
  },
  {
    model: "instruments",
    date: "Spring 2027",
    title: "Custom Veridien instruments",
    text: "Laparoscopic instruments designed alongside the trainer.",
  },
  {
    model: "library",
    date: "Spring 2027",
    title: "Pathology module library",
    text: "More pathology for each organ module, starting from the fibroid uterus.",
  },
  {
    model: "validation",
    date: "Summer 2027",
    title: "Clinical validation study",
    text: "A formal study, with clinical partners, of how training on the simulator compares.",
  },
];

/** The timeline holds still for a moment at each end, so it doesn't start or stop sliding the instant the section pins. */
const LEAD = 0.06;
const REST = 0.08;

/**
 * Where Veridien is headed: a line of milestones, each with a live model. On wide screens the
 * section pins and scrolling down slides the line sideways; phones, reduced motion and no
 * JavaScript get the same cards as a plain list (phones) or a row that scrolls by itself.
 */
export function Roadmap() {
  const sectionRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);

  // Pin and slide
  useEffect(() => {
    const section = sectionRef.current;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!section || !viewport || !track) return;
    const wide = matchMedia("(min-width: 820px)");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let distance = 0;
    let queued = false;

    const place = () => {
      queued = false;
      if (!("pinned" in section.dataset)) return;
      const span = section.offsetHeight - window.innerHeight;
      const raw = span > 0 ? Math.min(1, Math.max(0, -section.getBoundingClientRect().top / span)) : 0;
      const progress = Math.min(1, Math.max(0, (raw - LEAD) / (1 - LEAD - REST)));
      track.style.translate = `${(-progress * distance).toFixed(1)}px 0`;
    };
    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(place);
    };
    const layout = () => {
      const pin = wide.matches && !reduce.matches;
      if (!pin) {
        delete section.dataset.pinned;
        section.style.height = "";
        track.style.translate = "";
        return;
      }
      section.dataset.pinned = "";
      const style = getComputedStyle(viewport);
      distance = Math.max(0, track.offsetWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) - viewport.clientWidth);
      // The scroll distance is the slide distance, so one pixel down moves the line one pixel across
      section.style.height = `${window.innerHeight + distance / (1 - LEAD - REST)}px`;
      place();
    };

    layout();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", layout);
    wide.addEventListener("change", layout);
    reduce.addEventListener("change", layout);
    return () => {
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", layout);
      wide.removeEventListener("change", layout);
      reduce.removeEventListener("change", layout);
    };
  }, []);

  // The models load once the section is close, so three.js costs nothing to anyone who doesn't scroll here
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) {
      section.dataset.flat = "";
      return;
    }
    let stop: (() => void) | undefined;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        import("./roadmap-scene")
          .then(({ startRoadmapScene }) => {
            if (cancelled) return;
            const canvases = [...section.querySelectorAll<HTMLCanvasElement>("canvas[data-model]")];
            stop = startRoadmapScene(canvases, { still: wantsStill() });
            section.dataset.live = "";
          })
          .catch(() => {
            section.dataset.flat = "";
          });
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(section);
    return () => {
      cancelled = true;
      observer.disconnect();
      stop?.();
    };
  }, []);

  return (
    <section ref={sectionRef} id="roadmap" className="roadmap" tabIndex={-1}>
      <div className="roadmap-stage">
        <div className="roadmap-head">
          <h2>Where we’re headed.</h2>
          <p className="muted">Target dates. We’ll update them as plans firm up.</p>
        </div>
        <div ref={viewportRef} className="roadmap-viewport">
          <ol ref={trackRef} className="roadmap-track">
            {MILESTONES.map((milestone) => (
              <li key={milestone.title} className="milestone" data-now={milestone.now ? "" : undefined}>
                <p className="milestone-date">
                  {milestone.date}
                  {milestone.now && <span className="milestone-now">Now</span>}
                </p>
                <span className="milestone-dot" aria-hidden="true" />
                <div className="milestone-tile">
                  <canvas data-model={milestone.model} aria-hidden="true" />
                </div>
                <h3>{milestone.title}</h3>
                <p>{milestone.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
