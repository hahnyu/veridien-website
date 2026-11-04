import { Compare } from "../compare";
import { Partner, PartnerLink } from "../partner";
import { ScrollExplode } from "../scroll-explode";
import { Wordmark } from "../wordmark";
import type { Route } from "./+types/home";

const DESCRIPTION =
  "Veridien is building a laparoscopic trainer for real anatomical variation: hydrogel organs tuned to handle like tissue, with a live digital twin of every instrument.";

export const meta: Route.MetaFunction = () => [
  { title: "Veridien" },
  { name: "description", content: DESCRIPTION },
  { property: "og:title", content: "Veridien" },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:type", content: "website" },
  { property: "og:url", content: "https://veridienlabs.org/" },
  { property: "og:image", content: "https://veridienlabs.org/og.jpg" },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { name: "twitter:card", content: "summary_large_image" },
];

export default function Home() {
  return (
    <main>
      <ScrollExplode alt="The Veridien dome simulator on its base, with two graspers and a laparoscope through its ports.">
        <header className="hero-top">
          <h1 className="wordmark">
            <Wordmark />
          </h1>
          <PartnerLink />
        </header>
        <p className="hero-about">
          Veridien is building a laparoscopic trainer for real anatomical variation: hydrogel organs
          tuned to handle like tissue, on one reusable base. Cameras follow every instrument into a
          live digital twin, so surgeons can practice unique cases with feedback as they work.
        </p>
      </ScrollExplode>
      <Compare />
      <Partner />
    </main>
  );
}
