import type { ReactNode } from "react";

type Shot = {
  name: string;
  /** Widths encoded in public/photos, largest last. Nothing is upscaled past its source. */
  widths: number[];
  alt: string;
  label: ReactNode;
};

const SHOTS: Shot[] = [
  {
    name: "twin",
    widths: [640, 960, 1000],
    alt: "A render from the laparoscope's viewpoint, with two graspers at the surface of the hydrogel uterus.",
    label: "Digital twin, rendered",
  },
  {
    name: "simulator",
    widths: [640, 960, 1280, 1482],
    alt: "A laparoscope view of the Veridien hydrogel uterus, with a grasper on the left and a curved instrument below it.",
    label: "Our simulator, through the scope",
  },
  {
    name: "surgery",
    widths: [640, 960, 1040],
    alt: "A laparoscope view of a real uterus in a patient, with an instrument passing beneath it.",
    label: (
      <>
        Real laparoscopy. Photo:{" "}
        <a href="https://commons.wikimedia.org/wiki/File:Female_reproductive_system.jpg">
          Hic et nunc
        </a>
        ,{" "}
        <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>, cropped
      </>
    ),
  },
];

/** One column on phones, three from 820px, and the row stops growing at 1680px. */
const SIZES = "(min-width: 1680px) 520px, (min-width: 820px) calc((100vw - 112px) / 3), calc(100vw - 40px)";

const url = (name: string, width: number) => `/photos/${name}-${width}.webp`;

/** The same anatomy three ways: the point is that a reader compares them, so all three share one frame. */
export function Compare() {
  return (
    <section className="compare" aria-label="The simulator beside a render and a real laparoscopy">
      <div className="compare-row">
        {SHOTS.map((shot) => (
          <figure key={shot.name} className="compare-shot">
            <img
              src={url(shot.name, 960)}
              srcSet={shot.widths.map((width) => `${url(shot.name, width)} ${width}w`).join(", ")}
              sizes={SIZES}
              width={1200}
              height={900}
              alt={shot.alt}
              loading="lazy"
              decoding="async"
            />
            <figcaption>{shot.label}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
