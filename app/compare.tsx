import type { ReactNode } from "react";

type Shot = {
  name: string;
  /** Widths encoded in public/photos, largest last. Nothing is upscaled past its source. */
  widths: number[];
  alt: string;
  title: string;
  text: string;
  credit?: ReactNode;
};

const SHOTS: Shot[] = [
  {
    name: "twin",
    widths: [640, 960, 1000],
    alt: "A render from the laparoscope's viewpoint, with two graspers at the surface of the hydrogel uterus.",
    title: "Digital twin",
    text: "A rendered view of our digital twin. Cameras track every instrument, so surgeons get feedback as they work.",
  },
  {
    name: "simulator",
    widths: [640, 960, 1280, 1482],
    alt: "A laparoscope view of the Veridien hydrogel uterus, with a grasper on the left and a curved instrument below it.",
    title: "Hydrogel simulator",
    text: "Our tissue models through the scope. Organs and pathology swap for each procedure on one reusable base.",
  },
  {
    name: "surgery",
    widths: [640, 960, 1040],
    alt: "A laparoscope view of a real uterus in a patient, with an instrument passing beneath it.",
    title: "Real laparoscopy",
    text: "The anatomy we build toward. Models can also be made from a patient’s own MRI or CT.",
    credit: (
      <>
        Photo:{" "}
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

/** A reader is meant to compare these, so all three share one frame. Each explains one part of the product. */
export function Compare() {
  return (
    <section id="platform" className="section" tabIndex={-1}>
      <h2>Minimally invasive surgery, viewed digitally, through our simulator, and in real life.</h2>
      <div className="columns">
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
            <figcaption>
              <h3>{shot.title}</h3>
              <p>{shot.text}</p>
              {shot.credit && <p className="photo-credit">{shot.credit}</p>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
