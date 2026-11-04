import type { MouseEvent } from "react";

/**
 * Glides to a section instead of jumping, so the hero plays through on the way. Reduced motion and
 * no JavaScript both fall through to the plain anchor, which jumps.
 */
export function glideTo(event: MouseEvent<HTMLAnchorElement>) {
  const id = event.currentTarget.hash.slice(1);
  const target = document.getElementById(id);
  if (!target || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  event.preventDefault();
  history.replaceState(null, "", `#${id}`);
  target.scrollIntoView({ behavior: "smooth" });
  target.focus({ preventScroll: true });
}
