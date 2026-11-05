const EMAIL = "contact@veridienlabs.org";

const PAPERS = [
  {
    title:
      "What does a surgical skill model measure? Quantifying identity confounding and miscalibration on JIGSAWS",
    status: "Under review",
    venue: "International Journal of Computer Assisted Radiology and Surgery",
    url: "https://link.springer.com/journal/11548",
  },
  {
    title: "Decoupling Suture Retention from Stiffness in Hydrogel Surgical Training Phantoms",
    status: "Under review",
    venue: "SAGES 2027 Annual Meeting",
    url: "https://www.sages2027.org/",
  },
  {
    title:
      "Development of a Modular, High-Fidelity Physical Simulator for Laparoscopic Hysterectomy Training",
    status: "Presented",
    venue: "Northeast Bioengineering Conference 2026",
    url: "https://sites.temple.edu/nebec2026/",
  },
  {
    title:
      "Reflux-Based Dissolution of Polyvinyl Alcohol for Reproducible Hydrogel Mold Fabrication",
    status: "Presented",
    venue: "Conference for Undergraduate Health Research 2026",
    url: "https://www.uhre.ca/cuhr-2026",
  },
];

const PARTNERS = [
  {
    logo: "cornell",
    name: "Cornell University",
    detail: "Meinig School of Biomedical Engineering",
  },
  {
    logo: "harvard",
    name: "Harvard Medical School and Brigham and Women’s Hospital",
    detail: "Department of Radiology",
  },
  {
    logo: "buffalo",
    name: "University at Buffalo Jacobs School of Medicine",
    detail: "Clinical validation",
  },
];

const PHOTO_WIDTHS = [640, 960, 1088];

export function Research() {
  return (
    <section id="research" className="section" tabIndex={-1}>
      <h2>Built on research at Cornell.</h2>
      <div className="columns research">
        <figure className="research-photo">
          <img
            src="/photos/phantom-960.webp"
            srcSet={PHOTO_WIDTHS.map((width) => `/photos/phantom-${width}.webp ${width}w`).join(", ")}
            sizes="(min-width: 1200px) 720px, (min-width: 820px) calc((100vw - 96px) / 2), calc(100vw - 40px)"
            width={1088}
            height={816}
            alt="Gloved hands removing a fibroid from a red PVA hydrogel uterine phantom with an electrosurgical pen."
            loading="lazy"
            decoding="async"
          />
          <figcaption>Fibroid removal on a PVA hydrogel phantom</figcaption>
        </figure>
        <div className="research-col">
          <h3>Publications</h3>
          <ul className="stack">
            {PAPERS.map((paper) => (
              <li key={paper.title}>
                <p>{paper.title}</p>
                <p className="muted">
                  {paper.status}, <a href={paper.url}>{paper.venue}</a>
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div className="research-col">
          <h3>Partners</h3>
          <ul className="stack">
            {PARTNERS.map((partner) => (
              <li key={partner.name} className="partner-row">
                <img src={`/logos/${partner.logo}.webp`} alt="" loading="lazy" decoding="async" />
                <div>
                  <p>{partner.name}</p>
                  <p className="muted">{partner.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const TEAM = [
  { name: "Zaid ElNasser", role: "Chief Executive Officer", photo: "zaid" },
  { name: "Hamilton Jeong", role: "Chief Operating Officer", photo: "hamilton" },
  { name: "Andre Boufama", role: "Chief Technology Officer", photo: "andre" },
];

export function People() {
  return (
    <section id="people" className="section" tabIndex={-1}>
      <h2>People</h2>
      <ul className="columns">
        {TEAM.map((person) => (
          <li key={person.name} className="person">
            <img
              src={`/people/${person.photo}.webp`}
              width={360}
              height={360}
              alt={`Portrait of ${person.name}`}
              loading="lazy"
              decoding="async"
            />
            <div>
              <h3>{person.name}</h3>
              <p className="muted">{person.role}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="advisor">
        Advised by Dr. Suélia de Siqueira Rodrigues Fleury Rosa, Cornell University
      </p>
    </section>
  );
}

export function Partner() {
  return (
    <section id="partner" className="partner" tabIndex={-1}>
      <div className="columns partner-grid">
        <h2>Partner with us</h2>
        <p>We’re looking for hospitals and surgical training programs to pilot the trainer with.</p>
        <a
          className="partner-mail"
          href={`mailto:${EMAIL}?subject=${encodeURIComponent("Partnering with Veridien")}`}
        >
          {EMAIL}
        </a>
        <p className="partner-foot">© 2026 Veridien</p>
      </div>
    </section>
  );
}
