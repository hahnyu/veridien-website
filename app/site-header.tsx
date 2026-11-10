import { glideTo } from "./glide";
import { Wordmark } from "./wordmark";

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="wordmark" href="#top">
        <Wordmark />
      </a>
      <nav className="site-nav" aria-label="Sections">
        <a className="site-nav-section" href="#platform" onClick={glideTo}>
          Platform
        </a>
        <a className="site-nav-section" href="#roadmap" onClick={glideTo}>
          Roadmap
        </a>
        <a className="site-nav-section" href="#research" onClick={glideTo}>
          Research
        </a>
        <a className="site-nav-section" href="#people" onClick={glideTo}>
          People
        </a>
        <a className="site-nav-partner" href="#partner" onClick={glideTo}>
          Partner with us
        </a>
      </nav>
    </header>
  );
}
