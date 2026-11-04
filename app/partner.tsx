import type { MouseEvent } from "react";

const EMAIL = "contact@veridienlabs.org";
const MAILTO = `mailto:${EMAIL}?subject=${encodeURIComponent("Partnering with Veridien")}`;

/**
 * Glides down instead of jumping, so the hero plays through on the way. Reduced motion and no
 * JavaScript both fall through to the plain anchor, which jumps.
 */
function glideToPartner(event: MouseEvent<HTMLAnchorElement>) {
  const target = document.getElementById("partner");
  if (!target || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  event.preventDefault();
  history.replaceState(null, "", "#partner");
  target.scrollIntoView({ behavior: "smooth" });
  target.focus({ preventScroll: true });
}

export function PartnerLink() {
  return (
    <a className="hero-link" href="#partner" onClick={glideToPartner}>
      Partner with us
    </a>
  );
}

export function Partner() {
  return (
    <section id="partner" className="partner" tabIndex={-1} aria-labelledby="partner-title">
      <h2 id="partner-title">Partner with us</h2>
      <p>We're looking for hospitals and surgical training programs to pilot the trainer with.</p>
      <a className="partner-mail" href={MAILTO}>
        {EMAIL}
      </a>
    </section>
  );
}
