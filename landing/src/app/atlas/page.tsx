import type { Metadata } from "next";
import Link from "next/link";
import ArtFrame from "@/components/ArtFrame";
import Colophon from "@/components/Colophon";

/*
  /atlas — public gallery of every plate used on the site.

  Purpose: this is the lowest-marketing-cost trust signal we can ship.
  Researchers studying the history of medicine will link to it from
  Wikipedia. Art historians will cite the attributions. Visitors who
  want to verify our care for the source material can audit every
  plate against its institution's catalog.

  Each row is a single plate, full attribution, holding institution
  with deep link, license confirmation, and a short editorial note
  on why we chose it. Layout is two-column on desktop (image + meta)
  and stacks on mobile.

  See /landing/public/art/SOURCES.md for the canonical attribution
  table that drives this. Adding/removing a plate? Update SOURCES.md
  AND the PLATES array below; they are intentionally hand-kept in
  sync to force editorial discipline.
*/

type Plate = {
  slug: string;
  src: string;
  alt: string;
  artFilter?: string;
  title: string;
  artist: string;
  date: string;
  technique: string;
  institution: string;
  institutionUrl: string;
  license: string;
  attribution: string;
  editorialNote: string;
  /* Where this plate appears on the site. Empty array = atlas-only. */
  appearsIn: string[];
};

const PLATES: Plate[] = [
  {
    slug: "vitruvian-man",
    src: "/art/leonardo-da-vinci-vitruvian-man-2.jpg",
    alt: "Leonardo da Vinci — Vitruvian Man, c. 1490",
    artFilter:
      "grayscale(0.7) contrast(1.28) brightness(1.15) sepia(0.45)",
    title: "Vitruvian Man",
    artist: "Leonardo da Vinci",
    date: "c. 1490",
    technique: "Pen and ink on paper",
    institution: "Gallerie dell'Accademia, Venice",
    institutionUrl: "https://www.gallerieaccademia.it/en/vitruvian-man",
    license: "Public domain (pre-1928)",
    attribution:
      "Leonardo da Vinci, Study of proportions of the human body (Vitruvian Man), pen and ink on paper, c. 1490. Gallerie dell'Accademia, Venice.",
    editorialNote:
      "The hero plate. Geometry as a claim about the body — the diagram that says human proportions are knowable, measurable, repeatable. Every page humanovo will ever ship descends from this gesture.",
    appearsIn: ["Hero"],
  },
  {
    slug: "vesalius-frontispiece",
    src: "/art/VesaliusFrontColor.jpg",
    alt: "Vesalius — Fabrica frontispiece, 1543",
    artFilter:
      "grayscale(0.9) contrast(1.35) brightness(1.15) sepia(0.5) hue-rotate(-6deg)",
    title: "De humani corporis fabrica — frontispiece",
    artist: "Andreas Vesalius (drawing by Jan van Calcar)",
    date: "1543",
    technique: "Woodcut",
    institution: "National Library of Medicine, Bethesda",
    institutionUrl:
      "https://www.nlm.nih.gov/exhibition/historicalanatomies/vesalius_home.html",
    license: "Public domain",
    attribution:
      "Andreas Vesalius, De humani corporis fabrica libri septem, frontispiece woodcut, 1543 (Basel: Joannis Oporini). Drawing by Jan van Calcar.",
    editorialNote:
      "The opening plate of the modern scientific method. An anatomical theatre — scholars, specimens, manuscripts, instruments composed into one frame. Already a multi-stage pipeline four hundred and eighty years before software was a word.",
    appearsIn: ["Pipeline · Stage I (Ingest)"],
  },
  {
    slug: "leonardo-heart",
    src: "/art/heart-and-its-blood-vessels.jpg",
    alt: "Leonardo — heart and blood vessels",
    artFilter:
      "grayscale(0.45) contrast(1.22) brightness(1.18) sepia(0.3)",
    title: "Heart and its blood vessels",
    artist: "Leonardo da Vinci",
    date: "c. 1508–1513",
    technique: "Pen and brown ink on paper",
    institution: "Royal Collection Trust, Windsor Castle",
    institutionUrl: "https://www.rct.uk/collection/919112",
    license: "Public domain (pre-1928)",
    attribution:
      "Leonardo da Vinci, Anatomical study of the heart, lungs, and blood vessels, pen and brown ink on paper, c. 1508–1513. Royal Collection Trust, Windsor Castle.",
    editorialNote:
      "Cross-correlation made visual: the same chamber drawn from four angles on a single folio so the inconsistencies could reveal themselves on contact with paper. The exact register humanovo's grounding pipeline runs in, five centuries later.",
    appearsIn: ["Pipeline · Stage II (Analyze)"],
  },
  {
    slug: "vesalius-prima-musculorum",
    src: "/art/vesalius_fabrica_1543_lambert_181_watermark.jpg",
    alt: "Vesalius — Prima Musculorum Tabula, 1543",
    artFilter:
      "grayscale(0.85) contrast(1.3) brightness(1.12) sepia(0.42)",
    title: "Prima Musculorum Tabula",
    artist: "Andreas Vesalius (drawing by Jan van Calcar)",
    date: "1543",
    technique: "Woodcut",
    institution: "National Library of Medicine, Bethesda",
    institutionUrl:
      "https://www.nlm.nih.gov/exhibition/historicalanatomies/vesalius_home.html",
    license: "Public domain",
    attribution:
      "Andreas Vesalius, De humani corporis fabrica libri septem, Prima Musculorum Tabula, 1543 (Basel: Joannis Oporini). Drawing by Jan van Calcar.",
    editorialNote:
      "Illustration becomes hypothesis. The standing figure posed in a Tuscan landscape, asking the viewer to look at the muscles in the world, not on a slab. Every Renaissance plate was a wordless claim about how a body moves.",
    appearsIn: ["Pipeline · Stage III (Generate)"],
  },
  {
    slug: "bourgery-ecorche",
    src: "/art/keto05.jpg",
    alt: "Bourgery & Jacob écorché with ancillary studies",
    artFilter:
      "grayscale(0.9) contrast(1.32) brightness(1.14) sepia(0.4)",
    title: "Écorché with ancillary studies",
    artist: "Nicolas-Henri Jacob (illustration); Bourgery (author)",
    date: "1831–1854",
    technique: "Lithograph, hand-coloured",
    institution: "Bibliothèque nationale de France (Gallica)",
    institutionUrl: "https://gallica.bnf.fr/ark:/12148/bpt6k1043327w",
    license: "Public domain",
    attribution:
      "Jean-Baptiste Marc Bourgery and Nicolas-Henri Jacob, Traité complet de l'anatomie de l'homme, lithographic plate, 1831–1854 (Paris). Bibliothèque nationale de France.",
    editorialNote:
      "The institutional library, in plate form. A central figure surrounded by adjacent studies of the same hand, the same foot — organised so the next investigator could pick up the thread. Bourgery's atlas is what a research workspace wanted to be before workspaces were software.",
    appearsIn: ["Pipeline · Stage IV (Manage)"],
  },
  {
    slug: "valverde-historia",
    src: "/art/Valverde_p64.jpg",
    alt: "Valverde — Historia plate, 1556",
    artFilter:
      "grayscale(0.85) contrast(1.28) brightness(1.14) sepia(0.45)",
    title: "Historia de la composicion del cuerpo humano",
    artist: "Gaspar Becerra (drawings); Nicolas Beatrizet (engravings)",
    date: "1556",
    technique: "Copperplate engraving",
    institution: "Library of Congress, Washington DC",
    institutionUrl: "https://www.loc.gov/item/2021666850/",
    license: "Public domain",
    attribution:
      "Juan Valverde de Amusco, Historia de la composicion del cuerpo humano, 1556 (Rome: Antonio de Salamanca and Antonio Lafrery). Drawings by Gaspar Becerra; engravings by Nicolas Beatrizet. Library of Congress.",
    editorialNote:
      "Geographic + chronological breadth for the canon. Valverde's Spanish-Italian publication shows Renaissance anatomy travelling beyond Padua — the Vesalian project as an idea rather than a single book.",
    appearsIn: [],
  },
];

export const metadata: Metadata = {
  title: "Atlas",
  description:
    "Every plate, every attribution. The full record of the Renaissance and Enlightenment anatomical illustrations humanovo's site is composed against — Vesalius, Leonardo, Bourgery, Valverde — with canonical institution links and licence verification for each.",
  alternates: { canonical: "https://www.humanovo.net/atlas" },
  openGraph: {
    title: "humanovo — Atlas",
    description:
      "The full record of every plate humanovo's site is composed against. Vesalius, Leonardo, Bourgery, Valverde — with attribution and institution links.",
    url: "https://www.humanovo.net/atlas",
    type: "article",
  },
};

export default function AtlasPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        position: "relative",
        zIndex: 1,
        paddingTop: 90,
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          marginInline: "auto",
          paddingInline: 24,
          marginBottom: 60,
        }}
      >
        <Link
          href="/"
          className="atlas-back"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            textDecoration: "none",
            paddingBottom: 2,
            borderBottom: "1px solid transparent",
            transition: "color 0.2s ease, border-color 0.2s ease",
          }}
        >
          <span aria-hidden>&larr;</span>
          humanovo
        </Link>
      </div>

      <article
        style={{
          maxWidth: 1080,
          marginInline: "auto",
          paddingInline: 24,
        }}
      >
        <header style={{ textAlign: "center", marginBottom: 64 }}>
          <span
            style={{
              fontFamily: "var(--font-mono), monospace",
              fontSize: "0.58rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
            }}
          >
            Vol. I &middot; No. 01 &middot; Atlas
          </span>
          <h1
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              fontWeight: 400,
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
              fontSize: "clamp(2.4rem, 4.8vw, 3.4rem)",
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: "var(--ink-0)",
              margin: "22px 0 0",
            }}
          >
            The plates, in full.
          </h1>
          <p
            style={{
              marginTop: 22,
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 72, "SOFT" 80',
              fontSize: "0.96rem",
              color: "var(--ink-3)",
              maxWidth: 580,
              marginInline: "auto",
            }}
          >
            Every illustration on this site, with attribution to its
            holding institution and a short note on why we chose it.
            All plates are unambiguously public-domain.
          </p>
        </header>

        <div
          aria-hidden
          style={{
            margin: "0 auto 70px",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 80,
          }}
        >
          {PLATES.map((plate, i) => (
            <li
              key={plate.slug}
              id={plate.slug}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.05fr)",
                gap: 44,
                alignItems: "start",
              }}
              className="atlas-row"
            >
              <div
                style={{
                  order: i % 2 === 0 ? 0 : 1,
                }}
              >
                <ArtFrame
                  src={plate.src}
                  alt={plate.alt}
                  aspect="1 / 1"
                  fit="cover"
                  placeholderLabel={plate.title}
                  sizes="(max-width: 768px) 90vw, 460px"
                  style={
                    {
                      borderRadius: 12,
                      ["--art-filter" as string]: plate.artFilter,
                    } as React.CSSProperties
                  }
                />
              </div>

              <div
                style={{
                  order: i % 2 === 0 ? 1 : 0,
                  paddingTop: 4,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-display), Georgia, serif",
                      fontStyle: "italic",
                      fontWeight: 300,
                      fontVariationSettings: '"opsz" 72, "SOFT" 80',
                      fontSize: "1rem",
                      color: "var(--ink-3)",
                      letterSpacing: "0.02em",
                    }}
                  >
                    Pl. {toRoman(i + 1)}.
                  </span>
                  <span
                    className="t-eyebrow"
                    style={{
                      fontSize: "0.56rem",
                      letterSpacing: "0.3em",
                      color: "var(--ink-4)",
                    }}
                  >
                    {plate.date.replace(/^c\.\s*/, "c. ")}
                  </span>
                </div>

                <h2
                  className="t-display-upright"
                  style={{
                    fontSize: "clamp(1.7rem, 2.8vw, 2.2rem)",
                    margin: "0 0 6px",
                    lineHeight: 1.12,
                  }}
                >
                  {plate.title}
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-display), Georgia, serif",
                    fontStyle: "italic",
                    fontVariationSettings:
                      '"opsz" 72, "SOFT" 80, "WONK" 1',
                    fontSize: "1.05rem",
                    color: "var(--rust)",
                    margin: "0 0 22px",
                  }}
                >
                  {plate.artist}
                </p>

                <p
                  style={{
                    fontFamily: "var(--font-display), Georgia, serif",
                    fontSize: "1rem",
                    lineHeight: 1.65,
                    color: "var(--ink-1)",
                    fontVariationSettings: '"opsz" 18, "SOFT" 30, "WONK" 0',
                    margin: "0 0 24px",
                  }}
                >
                  {plate.editorialNote}
                </p>

                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    rowGap: 8,
                    columnGap: 18,
                    fontFamily: "var(--font-mono), monospace",
                    fontSize: "0.66rem",
                    margin: "0 0 22px",
                    paddingTop: 18,
                    borderTop: "1px solid var(--paper-edge)",
                  }}
                >
                  <Meta label="Technique" value={plate.technique} />
                  <Meta label="Date" value={plate.date} />
                  <Meta
                    label="Holding"
                    value={
                      <a
                        href={plate.institutionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: "var(--ink-1)",
                          textDecoration: "none",
                          borderBottom: "1px solid var(--rust)",
                          paddingBottom: 1,
                        }}
                      >
                        {plate.institution}
                      </a>
                    }
                  />
                  <Meta label="License" value={plate.license} />
                  {plate.appearsIn.length > 0 && (
                    <Meta
                      label="Appears"
                      value={plate.appearsIn.join(" · ")}
                    />
                  )}
                </dl>

                <p
                  style={{
                    fontFamily: "var(--font-display), Georgia, serif",
                    fontStyle: "italic",
                    fontVariationSettings: '"opsz" 72, "SOFT" 60',
                    fontSize: "0.86rem",
                    color: "var(--ink-3)",
                    lineHeight: 1.55,
                    margin: 0,
                    paddingTop: 16,
                    borderTop: "1px solid var(--paper-edge)",
                  }}
                >
                  {plate.attribution}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div
          aria-hidden
          style={{
            margin: "84px auto 0",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        <div
          style={{
            textAlign: "center",
            marginTop: 44,
            display: "flex",
            justifyContent: "center",
            gap: 22,
            flexWrap: "wrap",
            fontFamily: "var(--font-display), Georgia, serif",
            fontStyle: "italic",
            fontVariationSettings: '"opsz" 96, "SOFT" 80, "WONK" 1',
            fontSize: "1.08rem",
          }}
        >
          <Link
            href="/manifesto"
            style={{
              color: "var(--ink-1)",
              textDecoration: "none",
              borderBottom: "1px solid var(--rust)",
              paddingBottom: 2,
            }}
          >
            Read the manifesto &rarr;
          </Link>
          <Link
            href="/provenance"
            style={{
              color: "var(--ink-1)",
              textDecoration: "none",
              borderBottom: "1px solid var(--rust)",
              paddingBottom: 2,
            }}
          >
            See the citation algorithm &rarr;
          </Link>
        </div>
      </article>

      <Colophon />

      <style>{`
        .atlas-back:hover,
        .atlas-back:focus-visible {
          color: var(--ink-0);
          border-bottom-color: var(--rust);
        }
        @media (max-width: 720px) {
          .atlas-row {
            grid-template-columns: 1fr !important;
          }
          .atlas-row > div:first-child,
          .atlas-row > div:last-child {
            order: 0 !important;
          }
        }
      `}</style>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "contents" }}>
      <dt
        style={{
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.18em",
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, color: "var(--ink-1)" }}>{value}</dd>
    </div>
  );
}

function toRoman(n: number): string {
  const map: Array<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}
