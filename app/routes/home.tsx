import { Compare } from "../compare";
import { glideTo } from "../glide";
import { ScrollExplode } from "../scroll-explode";
import { Partner, People, Research } from "../sections";
import { SiteHeader } from "../site-header";
import { Walkthrough } from "../walkthrough";
import type { Route } from "./+types/home";

const DESCRIPTION =
  "Veridien is building an AI-enabled laparoscopic trainer that works with our custom hydrogel tissue models.";

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
    <>
      <SiteHeader />
      <main>
        <ScrollExplode alt="The Veridien dome simulator on its base, with two graspers and a laparoscope through its ports.">
          <div className="hero-copy">
            <h1>Every patient is unique. Surgical training should be too.</h1>
            <div className="hero-actions">
              <a className="button" href="#partner" onClick={glideTo}>
                Partner with us
              </a>
            </div>
          </div>
        </ScrollExplode>
        <section className="section statement">
          <p>
            Veridien is building an AI-enabled laparoscopic trainer that works with our custom
            hydrogel tissue models.
          </p>
        </section>
        <Walkthrough />
        <Compare />
        <Research />
        <People />
        <Partner />
      </main>
    </>
  );
}
