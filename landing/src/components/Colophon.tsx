"use client";

/*
  Colophon — set in JetBrains Mono with Fraunces italic accents,
  modeled on the colophon page of a Renaissance imprint. The point
  is not the literal information — it is the gesture. A site that
  publishes itself with a colophon declares "we are publishers, not
  vendors." That gesture compounds.

  Structure follows the convention of a 16th-century book back-page:

    set in       — typefaces credited
    plates       — illustration credits
    composed at  — where + when produced
    masthead     — the editorial team
    acknowledged — the ethical line that distinguishes scholarship
                   from decoration

  Visual register: small mono caps, italic Fraunces flourishes for
  the typeface names, generous letter-spacing, single-column max-
  width 540px so the eye reads it as a finished plate, not as a
  footer block.
*/

import Link from "next/link";

// First impression date — change this when the site has a
// substantial new "issue" worth marking. Rev'd monthly is fine;
// rev'd never is fine too. The point is that it is dated.
const FIRST_IMPRESSION = "14 May 2026";

export default function Colophon() {
  return (
    <footer
      role="contentinfo"
      aria-label="Colophon"
      style={{
        position: "relative",
        zIndex: 1,
        borderTop: "1px solid var(--paper-edge)",
        paddingTop: 76,
        paddingBottom: 84,
        background: "transparent",
      }}
    >
      <div
        style={{
          maxWidth: 580,
          marginInline: "auto",
          paddingInline: 24,
          textAlign: "center",
        }}
      >
        {/* Printer's mark — a small charcoal disc with a rust dot.
            The same mark that lives in the nav. Printers' marks
            were how 16th-century houses signed their work. */}
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            margin: "0 auto 26px",
            borderRadius: 8,
            background: "var(--ink-0)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: "var(--rust)",
              boxShadow: "0 0 0 2px rgba(180, 74, 44, 0.18)",
            }}
          />
        </div>

        {/* Set-in — typefaces, with credit lines */}
        <div className="colophon-block">
          <span className="colophon-label">Set in</span>
          <p className="colophon-line">
            <em className="colophon-emph">Fraunces</em>{" "}
            <span className="colophon-faint">
              (Phaedra Charles &amp; David Jonathan Ross, 2017&ndash;)
            </span>{" "}
            at the <span className="colophon-mono">opsz</span>,{" "}
            <span className="colophon-mono">SOFT</span>, and{" "}
            <span className="colophon-mono">WONK</span> axes, with{" "}
            <em className="colophon-emph">JetBrains Mono</em>{" "}
            <span className="colophon-faint">(JetBrains, 2020)</span>{" "}
            for technical labels.
          </p>
        </div>

        {/* Plates — illustration credits in the same compact register.
            All public-domain. Listed because the work is owed the
            credit and the visitor is owed the provenance. */}
        <div className="colophon-block">
          <span className="colophon-label">Plates</span>
          <p className="colophon-line">
            <em className="colophon-emph">Vesalius</em>{" "}
            <span className="colophon-faint">
              (Fabrica frontispiece &amp; Prima Musculorum, 1543);
            </span>{" "}
            <em className="colophon-emph">Leonardo</em>{" "}
            <span className="colophon-faint">
              (Vitruvian Man c. 1490, Heart &amp; Vessels c. 1513);
            </span>{" "}
            <em className="colophon-emph">Bourgery &amp; Jacob</em>{" "}
            <span className="colophon-faint">
              (Trait&eacute; complet de l&rsquo;anatomie, 1831&ndash;54);
            </span>{" "}
            <em className="colophon-emph">Valverde</em>{" "}
            <span className="colophon-faint">
              (Historia de la composicion del cuerpo humano, 1556).
            </span>
          </p>
        </div>

        {/* Composed at — when + where the publication is made. */}
        <div className="colophon-block">
          <span className="colophon-label">Composed at</span>
          <p className="colophon-line">
            <em className="colophon-emph">humanovo.net</em>
            <span className="colophon-faint">
              {" "}&middot; first impression {FIRST_IMPRESSION}.
            </span>
          </p>
        </div>

        {/* Masthead — even when every line is the same name, the
            gesture of a masthead matters. */}
        <div className="colophon-block">
          <span className="colophon-label">Masthead</span>
          <p className="colophon-line">
            <span className="colophon-faint">Editor &amp; engineering</span>{" "}
            <em className="colophon-emph">satvik</em>{" "}
            <span className="colophon-faint">
              &middot; in conversation with researchers at URMC, MIT, Stanford,
              and others quietly named when they ask to be.
            </span>
          </p>
        </div>

        {/* Acknowledged dissection — the line that distinguishes us
            from every brand that uses anatomical illustration as
            decoration. Quiet. Important. Required. */}
        <div className="colophon-block">
          <span className="colophon-label">Acknowledged</span>
          <p className="colophon-line">
            <span className="colophon-faint">
              The foundational anatomical illustrations referenced on this
              page were possible because of the dissection of bodies, often
              without consent or compensation to families. We hold this
              clearly in mind. The work continues in their debt.
            </span>
          </p>
        </div>

        {/* Footer rule + meta navigation */}
        <div
          aria-hidden
          style={{
            margin: "44px auto 22px",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        <nav
          aria-label="Colophon navigation"
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 22,
            flexWrap: "wrap",
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          <Link href="/manifesto" className="colophon-link">
            Manifesto
          </Link>
          <span aria-hidden style={{ color: "var(--ink-4)" }}>&middot;</span>
          <a
            href="https://github.com/satvikOS/humanovo"
            target="_blank"
            rel="noopener noreferrer"
            className="colophon-link"
          >
            GitHub
          </a>
          <span aria-hidden style={{ color: "var(--ink-4)" }}>&middot;</span>
          <a
            href="mailto:hello@humanovo.net"
            className="colophon-link"
          >
            hello@humanovo.net
          </a>
        </nav>

        <p
          style={{
            marginTop: 28,
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.56rem",
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: "var(--ink-4)",
            lineHeight: 1.6,
          }}
        >
          &copy; 2026 humanovo &middot; vol. i &middot; no. 01
        </p>
      </div>

      {/* Local styles — mono labels, italic emphasis, faint body.
          Kept inline because they are intrinsically tied to the
          colophon's editorial register; promoting them to globals.css
          would invite reuse outside this register. */}
      <style jsx>{`
        .colophon-block {
          margin-bottom: 26px;
        }
        .colophon-label {
          display: block;
          font-family: var(--font-mono), monospace;
          font-size: 0.58rem;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: var(--ink-4);
          margin-bottom: 8px;
        }
        .colophon-line {
          font-family: var(--font-display), Georgia, serif;
          font-size: 0.94rem;
          line-height: 1.55;
          color: var(--ink-2);
          letter-spacing: -0.005em;
          font-variation-settings: "opsz" 18, "SOFT" 30, "WONK" 0;
          margin: 0;
        }
        .colophon-emph {
          font-style: italic;
          font-weight: 400;
          color: var(--ink-1);
          font-variation-settings: "opsz" 72, "SOFT" 80, "WONK" 1;
        }
        .colophon-faint {
          color: var(--ink-3);
        }
        .colophon-mono {
          font-family: var(--font-mono), monospace;
          font-size: 0.78em;
          color: var(--ink-2);
          letter-spacing: 0.04em;
        }
        .colophon-link {
          color: var(--ink-2);
          text-decoration: none;
          border-bottom: 1px solid transparent;
          padding-bottom: 1px;
          transition: color 0.2s ease, border-color 0.2s ease;
        }
        .colophon-link:hover,
        .colophon-link:focus-visible {
          color: var(--ink-0);
          border-color: var(--rust);
        }
      `}</style>
    </footer>
  );
}
