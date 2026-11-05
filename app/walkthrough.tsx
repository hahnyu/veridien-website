import { useEffect, useRef, useState } from "react";
import { wantsStill } from "./scroll-explode";

/** Where the taller encode applies: its panel text stays readable at phone widths, and the wide one's does not. */
const PHONE = "(max-width: 559px) and (orientation: portrait)";

/**
 * The guided walkthrough, playing quietly in the page. It downloads nothing until it is on screen, plays
 * once while it is, and then offers a replay. On reduced motion, data saver or no JavaScript it stays its
 * poster. Clicking or pressing Enter pauses it, since moving content needs a way to stop.
 */
export function Walkthrough() {
  const ref = useRef<HTMLVideoElement>(null);
  const held = useRef(false);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // React does not render the muted attribute, and a browser only autoplays a muted video.
    video.muted = true;
    if (matchMedia(PHONE).matches) video.poster = "/video/walkthrough-phone.jpg";
    if (wantsStill()) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !held.current && !video.ended) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const replay = () => {
    const video = ref.current;
    if (!video) return;
    held.current = false;
    video.currentTime = 0;
    void video.play().catch(() => {});
  };

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.ended) return replay();
    held.current = !video.paused;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };

  return (
    <section className="section walkthrough">
      <div className="walkthrough-text">
        <h2>A Deterministic* AI Walks You Through Each Procedure</h2>
        <p>
          Our system divides a procedure into a series of steps, watches to confirm each one, and takes notes during the whole operation. It’s easy to review past runs by looking at annotated replay footage, and track improvements in performance through session metrics.
        </p>
      </div>
      <figure className="walkthrough-media">
        <video
          ref={ref}
          muted
          playsInline
          preload="none"
          poster="/video/walkthrough.jpg"
          width={1280}
          height={720}
          tabIndex={0}
          aria-label="A guided walkthrough over the laparoscope view of a myomectomy on a hydrogel model: a panel names each step and its end state. Press to pause."
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle();
            }
          }}
          onPlay={() => setEnded(false)}
          onEnded={() => setEnded(true)}
        >
          <source media={PHONE} src="/video/walkthrough-phone.mp4" type="video/mp4" />
          <source src="/video/walkthrough.mp4" type="video/mp4" />
        </video>
        {ended && (
          <button type="button" className="replay" aria-label="Replay the walkthrough" onClick={replay}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
      </figure>
      <div className="walkthrough-notes">
        <p className="walkthrough-footnote">
          *Deterministic: it follows a fixed list of steps and answers fixed questions about what the camera sees. Unlike an LLM, it writes nothing of its own, so it can’t invent a step.
        </p>
      </div>
    </section>
  );
}
