"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";
import { useOverlay } from "@/components/Navigation";

/*
  PageTrust — the trust surface.

  Two blocks: privacy commitment and citation methodology.
  Researchers need to know what happens to their data and how
  citations are verified before depending on a tool. The page
  answers both directly.

  Block 1 — Privacy commitment
    All-caps mono on a paper-2 panel. Reads like a contractual
    clause.

  Block 2 — Methodology
    Bordered scientific spec. Numbers, units, mechanism.
*/

export default function PageTrust() {
  const root = useRef<HTMLElement>(null);
  const { setOpen } = useOverlay();

  useGSAP(
    () => {
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      // Defensive y-only — see Page2Pipeline for full rationale.
      // Below-fold sections must never sit at `autoAlpha: 0`
      // waiting for a scroll-trigger that may not fire fast enough
      // for users who land via hash-anchor or slow hydration.
      gsap.from(".trust-header > *", {
        y: 22,
        duration: 0.85,
        stagger: 0.07,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".trust-header",
          start: "top 80%",
          toggleActions: "play none none reverse",
        },
      });

      gsap.from(".trust-block", {
        y: 36,
        duration: 1.0,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".trust-grid",
          start: "top 82%",
          toggleActions: "play none none reverse",
        },
      });
    },
    { scope: root }
  );

  return (
    <section
      ref={root}
      id="section-trust"
      className="section"
      aria-labelledby="trust-headline"
      style={{ paddingTop: 120, paddingBottom: 100 }}
    >
      <div
        className="relative z-10 w-full mx-auto px-6 md:px-12"
        style={{ maxWidth: 1180 }}
      >
        <div
          className="trust-header"
          style={{ textAlign: "center", marginBottom: 70 }}
        >
          <span className="pill">
            <span className="dot" />
            Trust
          </span>
          <h2
            id="trust-headline"
            className="t-h2"
            style={{ marginTop: 22 }}
          >
            Built by researchers,&nbsp;
            <em
              style={{
                fontStyle: "italic",
                fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
                color: "var(--rust)",
                fontWeight: 400,
              }}
            >
              for researchers.
            </em>
          </h2>
          <p
            className="t-lead"
            style={{
              maxWidth: 580,
              marginInline: "auto",
              marginTop: 20,
              color: "var(--ink-2)",
            }}
          >
            Provenance, privacy, and a pipeline you can audit. The
            three things a researcher needs to be confident in a tool
            before depending on it.
          </p>
        </div>

        <div
          className="trust-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 28,
          }}
        >
          {/* ── Block 1 — Privacy commitment ── */}
          <div
            className="trust-block plate plate-tinted"
            style={
              {
                padding: "36px 32px 32px",
                "--tint": "rgba(106, 30, 40, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: 18,
              } as React.CSSProperties
            }
          >
            <header
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
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
                Pl. I.
              </span>
              <span
                className="t-eyebrow"
                style={{ fontSize: "0.56rem", letterSpacing: "0.3em" }}
              >
                Data handling
              </span>
            </header>

            <h3
              className="t-display-upright"
              style={{ fontSize: "1.6rem" }}
            >
              Your work stays yours.
            </h3>

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {[
                "We do not train models on your uploads.",
                "We do not share data with third-party LLM vendors.",
                "Per-tenant encryption keys on the institution tier.",
                "Delete your data and it is gone — within 24 hours.",
              ].map((line) => (
                <li
                  key={line}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    columnGap: 12,
                    alignItems: "baseline",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      fontFamily: "var(--font-mono), monospace",
                      fontSize: "0.7rem",
                      color: "var(--rust)",
                      lineHeight: 1.4,
                    }}
                  >
                    ✕
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-display), Georgia, serif",
                      fontStyle: "italic",
                      fontVariationSettings: '"opsz" 72, "SOFT" 60',
                      fontSize: "0.98rem",
                      lineHeight: 1.4,
                      color: "var(--ink-1)",
                    }}
                  >
                    {line}
                  </span>
                </li>
              ))}
            </ul>

            <div
              style={{
                marginTop: "auto",
                paddingTop: 18,
                borderTop: "1px solid var(--paper-edge)",
                fontFamily: "var(--font-mono), monospace",
                fontSize: "0.62rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              HIPAA-ready · SOC 2 Type 1 in audit
            </div>
          </div>

          {/* ── Block 2 — Methodology ── */}
          <div
            className="trust-block plate plate-tinted"
            style={
              {
                padding: "36px 32px 32px",
                "--tint": "rgba(110, 122, 78, 0.10)",
                display: "flex",
                flexDirection: "column",
                gap: 18,
              } as React.CSSProperties
            }
          >
            <header
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
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
                Pl. II.
              </span>
              <span
                className="t-eyebrow"
                style={{ fontSize: "0.56rem", letterSpacing: "0.3em" }}
              >
                Methodology
              </span>
            </header>

            <h3
              className="t-display-upright"
              style={{ fontSize: "1.6rem" }}
            >
              Citations that exist.
            </h3>

            <p
              style={{
                fontFamily: "var(--font-display), Georgia, serif",
                fontStyle: "italic",
                fontVariationSettings: '"opsz" 72, "SOFT" 60',
                fontSize: "1.02rem",
                lineHeight: 1.5,
                color: "var(--ink-1)",
                margin: 0,
              }}
            >
              Every citation round-trips through CrossRef and NCBI
              before it lands on your screen. Hallucinated references
              never reach you.
            </p>

            <dl
              style={{
                marginTop: 6,
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                rowGap: 8,
                columnGap: 18,
                fontFamily: "var(--font-mono), monospace",
                fontSize: "0.7rem",
                letterSpacing: "0.06em",
              }}
            >
              {[
                ["Pipeline", "12 adversarial stages"],
                ["Sources", "36 biomedical APIs"],
                ["Round-trip", "100% on launch"],
                ["Audit log", "tamper-evident"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{ display: "contents" }}
                >
                  <dt style={{ color: "var(--ink-4)", textTransform: "uppercase" }}>
                    {k}
                  </dt>
                  <dd style={{ margin: 0, color: "var(--ink-1)" }}>{v}</dd>
                </div>
              ))}
            </dl>

            <div
              style={{
                marginTop: "auto",
                paddingTop: 18,
                borderTop: "1px solid var(--paper-edge)",
              }}
            >
              <button
                onClick={() => setOpen(true)}
                className="btn-ghost"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  fontSize: "0.72rem",
                }}
              >
                Read the technical brief
                <span className="btn-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path
                      d="M5 12h14M13 5l7 7-7 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
