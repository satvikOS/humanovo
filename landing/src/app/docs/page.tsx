import type { Metadata } from "next";
import Link from "next/link";
import Colophon from "@/components/Colophon";

/*
  /docs — documentation hub.

  Currently a curated index of the technical writing already on the
  site (provenance, atlas, manifesto) plus the reference material
  the launch needs (getting started, API auth, data model, exports,
  support). Each entry links to either a dedicated page (where
  written) or an inline placeholder describing what will live there
  when written.

  Tone: editorial-encyclopedic. Reads like the table of contents of
  a Renaissance encyclopedia — numbered chapters, italic chapter
  titles, paragraph-length descriptions. Researchers don't want a
  Mintlify lookalike; they want to know what's documented and how
  to find it.

  Each section flagged "(in progress)" should be filled in as the
  underlying functionality stabilises. The hub itself can ship
  before every chapter exists — that's how a working encyclopedia
  is built.
*/

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Documentation. Getting started, the citation roundtrip, the API, data exports, and the editorial pages every researcher should read before depending on us.",
  alternates: { canonical: "https://www.humanovo.net/docs" },
  openGraph: {
    title: "humanovo — Documentation",
    description:
      "Getting started, citation roundtrip, the API, exports, and the editorial reading list.",
    url: "https://www.humanovo.net/docs",
    type: "article",
  },
};

type Chapter = {
  numeral: string;
  title: string;
  body: string;
  href: string;
  status?: "shipped" | "in-progress";
  external?: boolean;
};

const CHAPTERS: { group: string; chapters: Chapter[] }[] = [
  {
    group: "Read first",
    chapters: [
      {
        numeral: "I",
        title: "Manifesto",
        body: "Why humanovo exists. The thesis a researcher should agree with before investing time in the tool. Five hundred years of looking, rendered into a paragraph about the next chapter of that practice.",
        href: "/manifesto",
        status: "shipped",
      },
      {
        numeral: "II",
        title: "Provenance — the citation roundtrip",
        body: "The methodology section. How every claim is verified against CrossRef and NCBI before it lands on your screen, what failure modes we explicitly catch, and how the per-hypothesis audit log makes any rendered claim later-replayable byte-for-byte.",
        href: "/provenance",
        status: "shipped",
      },
      {
        numeral: "III",
        title: "Atlas — the plate sources",
        body: "Every Renaissance plate used on the site, with full attribution to the holding institution, license confirmation, and a short editorial note on the choice. The lowest-marketing-cost trust signal we ship.",
        href: "/atlas",
        status: "shipped",
      },
    ],
  },
  {
    group: "Getting started",
    chapters: [
      {
        numeral: "IV",
        title: "Install the desktop app",
        body: "macOS (Universal), Windows (x64), and Linux (deb / rpm / AppImage). Codesigned and notarised on macOS; signed with our EV cert on Windows; signed AppImage on Linux. The download links live on the homepage; the install instructions per-OS will live here when the binary is in public beta.",
        href: "/#section-download",
        status: "in-progress",
      },
      {
        numeral: "V",
        title: "Your first hypothesis",
        body: "A walkthrough — pose a question, point us at the corpus you care about, and read the resulting hypothesis trace. Includes how to interpret the audit log, what each pipeline stage scores, and where the gold-standard examples live.",
        href: "/docs",
        status: "in-progress",
      },
      {
        numeral: "VI",
        title: "Loading your private corpus",
        body: "How to upload PDFs, sync from Zotero, point at a Notion / Obsidian / Roam workspace, or connect a Google Drive folder. Per-source ingestion notes, OCR caveats for scanned PDFs, and the privacy story for each.",
        href: "/docs",
        status: "in-progress",
      },
    ],
  },
  {
    group: "The pipeline",
    chapters: [
      {
        numeral: "VII",
        title: "The 12 adversarial stages",
        body: "What each of the twelve pipeline stages does, what it scores, and how to read the per-stage trace. Generation, evidence grounding, mechanism extraction, contradiction-search, counter-argument, revision, and the rest.",
        href: "/docs",
        status: "in-progress",
      },
      {
        numeral: "VIII",
        title: "The biomedical sources we read",
        body: "PubMed Central, bioRxiv, medRxiv, ClinVar, Reactome, ChEMBL, OpenTargets, GTEx, the Human Protein Atlas, ICTRP, and the rest of the 60+ open-access sources humanovo holds in one corpus. Each with the indexing cadence, license terms, and the canonical URL.",
        href: "/docs",
        status: "in-progress",
      },
      {
        numeral: "IX",
        title: "How citations are scored",
        body: "Beyond the binary verified/unverified roundtrip — the cohort-concentration score, the predatory-source flag, the AI-generated-paper heuristic, the retraction-watch lookup, and how each surfaces in the UI as a chip you can click to read the rationale.",
        href: "/provenance",
        status: "shipped",
      },
    ],
  },
  {
    group: "API & integrations",
    chapters: [
      {
        numeral: "X",
        title: "API reference",
        body: "REST + Webhook surface. Authentication via API keys with scoped permissions, rate limits per tier, idempotency keys for pipeline starts, and pagination conventions across list endpoints. Reference shipping with the public-beta API release.",
        href: "/docs",
        status: "in-progress",
      },
      {
        numeral: "XI",
        title: "Webhooks & events",
        body: "Subscribe to hypothesis-completed, citation-verified, retraction-detected, audit-log-committed events. Signed payloads (HMAC-SHA-256), at-least-once delivery, replay endpoint for last 30 days. Spec lands with the API reference.",
        href: "/docs",
        status: "in-progress",
      },
      {
        numeral: "XII",
        title: "Exports",
        body: "Hypothesis exports in Markdown, BibTeX, RIS, and JSON. Audit log exports as JSON-Lines plus the Merkle commit hashes. Workspace bulk export as a tar.gz suitable for re-import or archival.",
        href: "/docs",
        status: "in-progress",
      },
    ],
  },
  {
    group: "Operating the service",
    chapters: [
      {
        numeral: "XIII",
        title: "Pricing & billing",
        body: "Four tiers, capped compute, no surprise bills. Invoices, currencies, taxes, and the academic discount mechanic.",
        href: "/pricing",
        status: "shipped",
      },
      {
        numeral: "XIV",
        title: "Privacy policy",
        body: "Our four privacy commitments and the operational detail behind each. Encryption, regional pinning, the inference-vendor roster, and the data-subject rights we honour globally regardless of jurisdiction.",
        href: "/privacy",
        status: "shipped",
      },
      {
        numeral: "XV",
        title: "Terms of service",
        body: "The contract between humanovo and the people who use it. Plain-language acceptable-use, IP, liability, and dispute-resolution clauses.",
        href: "/terms",
        status: "shipped",
      },
      {
        numeral: "XVI",
        title: "Status & SLA",
        body: "Public status page (status.humanovo.net) with real uptime, p50/p95/p99 pipeline latency, and incident history. Institution-tier SLA terms detailed here once the SLA contract template is finalised.",
        href: "/docs",
        status: "in-progress",
      },
      {
        numeral: "XVII",
        title: "Support",
        body: "Email hello@humanovo.net. Response within 24h on Researcher tier, 4h on Lab, 2h on Institution.",
        href: "mailto:hello@humanovo.net",
        status: "shipped",
        external: true,
      },
    ],
  },
];

export default function DocsPage() {
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
          maxWidth: 760,
          marginInline: "auto",
          paddingInline: 24,
          marginBottom: 60,
        }}
      >
        <Link
          href="/"
          className="docs-back"
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
          maxWidth: 760,
          marginInline: "auto",
          paddingInline: 24,
          fontFamily: "var(--font-display), Georgia, serif",
          color: "var(--ink-1)",
        }}
      >
        <header style={{ textAlign: "center", marginBottom: 56 }}>
          <span
            style={{
              fontFamily: "var(--font-mono), monospace",
              fontSize: "0.58rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
            }}
          >
            Vol. I &middot; No. 01 &middot; Documentation
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
            The table of contents
            <br />
            <span style={{ color: "var(--rust)" }}>for everything we ship.</span>
          </h1>
          <p
            style={{
              marginTop: 22,
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 72, "SOFT" 80',
              fontSize: "0.96rem",
              color: "var(--ink-3)",
            }}
          >
            Read in the order written, or skip to the chapter you need.
          </p>
        </header>

        <div
          aria-hidden
          style={{
            margin: "0 auto 50px",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        {CHAPTERS.map((group) => (
          <section key={group.group} style={{ marginBottom: 48 }}>
            <h2
              style={{
                fontFamily: "var(--font-mono), monospace",
                fontSize: "0.62rem",
                letterSpacing: "0.32em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
                margin: "0 0 24px",
              }}
            >
              {group.group}
            </h2>
            <ol
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                rowGap: 28,
              }}
            >
              {group.chapters.map((ch) => (
                <ChapterRow key={ch.numeral} chapter={ch} />
              ))}
            </ol>
          </section>
        ))}

        <div
          aria-hidden
          style={{
            margin: "70px auto 0",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        <section style={{ marginTop: 56, textAlign: "center" }}>
          <p
            style={{
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 72, "SOFT" 80',
              fontSize: "1rem",
              color: "var(--ink-2)",
              maxWidth: 540,
              marginInline: "auto",
              lineHeight: 1.6,
            }}
          >
            A chapter you need that isn&rsquo;t here yet? Email{" "}
            <Link
              href="mailto:hello@humanovo.net?subject=humanovo%20docs%20%2F%20missing%20chapter"
              className="docs-inline-link"
            >
              hello@humanovo.net
            </Link>
            . We will write it next.
          </p>
        </section>

        <div style={{ textAlign: "center", marginTop: 44 }}>
          <Link
            href="/manifesto"
            style={{
              display: "inline-block",
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 96, "SOFT" 80, "WONK" 1',
              fontSize: "1.1rem",
              color: "var(--ink-1)",
              textDecoration: "none",
              borderBottom: "1px solid var(--rust)",
              paddingBottom: 2,
            }}
          >
            Read the manifesto &rarr;
          </Link>
        </div>
      </article>

      <Colophon />

      <style>{`
        .docs-back:hover,
        .docs-back:focus-visible {
          color: var(--ink-0);
          border-bottom-color: var(--rust);
        }
        .docs-inline-link {
          color: var(--ink-0);
          text-decoration: none;
          border-bottom: 1px solid var(--rust);
          padding-bottom: 1px;
        }
        .docs-chapter-link:hover .docs-chapter-title,
        .docs-chapter-link:focus-visible .docs-chapter-title {
          color: var(--rust);
        }
      `}</style>
    </main>
  );
}

function ChapterRow({ chapter }: { chapter: Chapter }) {
  const isExternal = chapter.external === true;
  const titleNode = (
    <>
      <span
        aria-hidden
        style={{
          fontFamily: "var(--font-display), Georgia, serif",
          fontStyle: "italic",
          fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
          fontSize: "1.5rem",
          color: "var(--ink-4)",
          letterSpacing: "-0.015em",
          gridArea: "numeral",
          paddingTop: 2,
        }}
      >
        {chapter.numeral}
      </span>
      <div style={{ gridArea: "body" }}>
        <h3
          className="docs-chapter-title"
          style={{
            margin: "0 0 8px",
            fontFamily: "var(--font-display), Georgia, serif",
            fontStyle: "italic",
            fontWeight: 400,
            fontVariationSettings: '"opsz" 72, "SOFT" 80, "WONK" 1',
            fontSize: "1.32rem",
            lineHeight: 1.25,
            color: "var(--ink-0)",
            letterSpacing: "-0.01em",
            transition: "color 0.18s ease",
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span>{chapter.title}</span>
          {chapter.status === "in-progress" && (
            <span
              style={{
                fontFamily: "var(--font-mono), monospace",
                fontStyle: "normal",
                fontSize: "0.56rem",
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
                border: "1px solid var(--paper-edge)",
                padding: "2px 7px",
                borderRadius: 999,
              }}
            >
              In progress
            </span>
          )}
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: "1rem",
            lineHeight: 1.6,
            color: "var(--ink-1)",
          }}
        >
          {chapter.body}
        </p>
      </div>
    </>
  );

  const wrapperStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gridTemplateAreas: '"numeral body"',
    columnGap: 22,
    alignItems: "start",
    textDecoration: "none",
  };

  return (
    <li>
      {isExternal ? (
        <a
          href={chapter.href}
          className="docs-chapter-link"
          style={wrapperStyle}
        >
          {titleNode}
        </a>
      ) : (
        <Link
          href={chapter.href}
          className="docs-chapter-link"
          style={wrapperStyle}
        >
          {titleNode}
        </Link>
      )}
    </li>
  );
}
