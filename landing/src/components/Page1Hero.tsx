"use client";

import { useEffect, useRef, useState } from "react";
import ArtFrame from "@/components/ArtFrame";
import { gsap, useGSAP } from "@/lib/gsap";
import { useOverlay } from "@/components/Navigation";

/*
  Page 1 — editorial title-page hero.
  Composition: centered wordmark dominant, rotating tagline, ornament,
  paragraph, CTAs, stats row, and a small annotated Cajal plate beside.
*/

const TAGLINES = [
  "Hypothesis at the speed of science.",
  "See what the literature has been whispering.",
  "Every paper, dataset, intuition — one thread.",
  "From convergent signal to the next experiment.",
  "A co-investigator that has read everything.",
  "Where discovery is composed, not searched.",
];

export default function Page1Hero() {
  const root = useRef<HTMLElement>(null);
  const [tagIndex, setTagIndex] = useState(0);
  const { setOpen } = useOverlay();

  useEffect(() => {
    const id = window.setInterval(() => {
      setTagIndex((i) => (i + 1) % TAGLINES.length);
    }, 3600);
    return () => window.clearInterval(id);
  }, []);

  /* Tagline cross-fade with blur */
  useGSAP(
    () => {
      // Skip the choreography for users who've asked the OS to
      // calm motion down — the rotating tagline is still legible
      // without the blur transition.
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      const el = root.current?.querySelector<HTMLElement>(".tagline-current");
      if (!el) return;
      gsap.fromTo(
        el,
        { y: 14, autoAlpha: 0, filter: "blur(4px)" },
        {
          y: 0,
          autoAlpha: 1,
          filter: "blur(0px)",
          duration: 0.7,
          ease: "power2.out",
        }
      );
    },
    { dependencies: [tagIndex], scope: root }
  );

  /* Intro + scroll parallax */
  useGSAP(
    () => {
      // Honour reduced-motion: still reveal everything (we're not
      // hiding content) but skip the parallax + blur intro so
      // vestibular-sensitive readers don't get queasy on first paint.
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        gsap.set(
          [
            ".hero-topline",
            ".hero-wordmark-wrap",
            ".hero-rule",
            ".tagline-wrap",
            ".hero-para",
            ".hero-cta",
            ".hero-stats > *",
            ".hero-plate",
            ".hero-figcaption",
          ],
          { autoAlpha: 1, y: 0, filter: "none" }
        );
        return;
      }

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(".hero-topline", { y: 12, autoAlpha: 0, duration: 0.7 })
        .from(
          ".hero-wordmark-wrap",
          { y: 46, autoAlpha: 0, filter: "blur(8px)", duration: 1.1, ease: "power4.out" },
          "-=0.25"
        )
        .from(
          ".hero-rule",
          { scaleX: 0, autoAlpha: 0, duration: 0.9, transformOrigin: "center" },
          "-=0.5"
        )
        .from(
          ".tagline-wrap",
          { y: 16, autoAlpha: 0, duration: 0.7 },
          "-=0.5"
        )
        .from(
          ".hero-para",
          { y: 16, autoAlpha: 0, duration: 0.7 },
          "-=0.5"
        )
        .from(
          ".hero-cta",
          { y: 14, autoAlpha: 0, duration: 0.6, stagger: 0.06 },
          "-=0.45"
        )
        .from(
          ".hero-stats > *",
          { y: 12, autoAlpha: 0, duration: 0.55, stagger: 0.06 },
          "-=0.35"
        )
        .from(
          ".hero-plate",
          { y: 36, autoAlpha: 0, scale: 0.96, duration: 1.0, ease: "power4.out" },
          "-=1.1"
        )
        .from(
          ".hero-figcaption",
          { y: 10, autoAlpha: 0, duration: 0.6 },
          "-=0.4"
        );

      /* Scroll fade — disable when reduced-motion preference is on
         (already short-circuited above via the early return; this
         guard is belt-and-braces so any future call path also
         honours the preference). */
      if (
        typeof window !== "undefined" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        gsap.to(".hero-inner", {
          y: -60,
          autoAlpha: 0.35,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });
      }
    },
    { scope: root }
  );

  return (
    <section
      ref={root}
      id="section-hero"
      className="section"
      style={{
        minHeight: "100vh",
        paddingTop: 130,
        paddingBottom: 80,
      }}
    >
      <div
        className="hero-inner relative z-10 w-full mx-auto px-6 md:px-12"
        style={{ maxWidth: 1280 }}
      >
        {/* Top editorial line: left pill + right masthead */}
        <div
          className="hero-topline"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
            marginBottom: 46,
          }}
        >
          <span className="pill">
            <span className="dot" />
            Research intelligence · est. 2026
          </span>
          <span className="t-eyebrow">
            Vol. I &nbsp;·&nbsp; No. 01 &nbsp;·&nbsp; for scientists
          </span>
        </div>

        {/* Centered wordmark title */}
        <div
          className="hero-wordmark-wrap"
          style={{ textAlign: "center", position: "relative" }}
        >
          <span className="wordmark" aria-label="humanovo">
            humanovo
          </span>
        </div>

        {/* Ornamental rule */}
        <div
          className="hero-rule"
          style={{
            marginTop: 28,
            display: "flex",
            alignItems: "center",
            gap: 16,
            justifyContent: "center",
          }}
        >
          <span
            style={{ width: 64, height: 1, background: "var(--paper-edge)" }}
          />
          <span className="t-eyebrow" style={{ color: "var(--ink-2)" }}>
            a co-investigator, in residence
          </span>
          <span
            style={{ width: 64, height: 1, background: "var(--paper-edge)" }}
          />
        </div>

        {/* Main body: two-column beneath the wordmark */}
        <div
          style={{ marginTop: 48 }}
          className="hero-body-grid"
        >
          <div>
            {/* Rotating tagline */}
            <div className="tagline-wrap">
              <div className="tagline-slot" aria-live="polite">
                <span key={tagIndex} className="tagline-current">
                  {TAGLINES[tagIndex]}
                </span>
              </div>
            </div>

            {/* Supporting paragraph */}
            <p
              className="hero-para t-body"
              style={{ marginTop: 22, maxWidth: "58ch" }}
            >
              humanovo reads every paper, dataset, and notebook that matters
              to your question — then threads them into a single line of
              thought you can interrogate, continue, and publish from.
            </p>

            {/* CTAs — primary opens the contact overlay (real
                conversion path). Secondary jumps to the pipeline
                tour. The previous "Download" primary linked to a
                section full of "Coming soon" cards, which a
                researcher would clock as a bait-and-switch within
                five seconds. */}
            <div
              style={{
                marginTop: 30,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() => setOpen(true)}
                className="hero-cta btn-ink"
                type="button"
              >
                Request early access
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
              <a href="#section-pipeline" className="hero-cta btn-ghost">
                See how it works
                <span className="btn-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path
                      d="M5 12h14M13 5l7 7-7 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </a>
            </div>

            {/* Stats row — facts a researcher could verify against
                the actual pipeline, not marketing superlatives.
                Specifically: stage count (12 adversarial passes per
                hypothesis), source count (36 biomedical APIs wired
                today after Phase 2 activation), and citation-roundtrip
                rate (every cited paper is round-tripped through
                CrossRef + NCBI before landing on screen). */}
            <div
              className="hero-stats"
              style={{
                marginTop: 52,
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 22,
                maxWidth: 540,
                paddingTop: 26,
                borderTop: "1px solid var(--paper-edge)",
              }}
            >
              <Stat value="12" unit="stages" caption="Adversarial pipeline" />
              <Stat value="36" unit="sources" caption="Biomedical APIs wired" />
              <Stat value="100%" unit="roundtrip" caption="Citation verification" />
            </div>
          </div>

          {/* Right column — Vitruvian plate with caption below (clean, no overlays) */}
          <div
            className="hero-plate"
            style={{ position: "relative", marginTop: 6 }}
          >
            <ArtFrame
              src="/art/leonardo-da-vinci-vitruvian-man-2.jpg"
              alt="Leonardo da Vinci — Vitruvian Man, c. 1490"
              aspect="1 / 1"
              fit="cover"
              placeholderLabel="Vitruvian Man — da Vinci"
              priority
              sizes="(max-width: 768px) 80vw, 480px"
              style={
                {
                  ["--art-filter" as string]:
                    "grayscale(0.7) contrast(1.28) brightness(1.15) sepia(0.45)",
                } as React.CSSProperties
              }
            />

            {/* Caption below the plate — like a figure caption in a
                scientific journal, no overlap with the artwork itself */}
            <figcaption
              className="hero-figcaption"
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 14,
                marginTop: 16,
                paddingTop: 14,
                borderTop: "1px solid var(--paper-edge)",
              }}
            >
              <span
                className="t-eyebrow"
                style={{ fontSize: "0.58rem", color: "var(--ink-3)" }}
              >
                Fig. I · Vitruvian Man
              </span>
              <span
                style={{
                  fontFamily: "var(--font-display), Georgia, serif",
                  fontStyle: "italic",
                  fontVariationSettings: '"opsz" 72, "SOFT" 50',
                  fontSize: "0.92rem",
                  color: "var(--ink-2)",
                  lineHeight: 1.3,
                  textAlign: "right",
                }}
              >
                the measure of every inquiry
              </span>
            </figcaption>
          </div>
        </div>
      </div>

      {/* Scroll hint */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
        className="t-eyebrow"
      >
        <span
          style={{ width: 22, height: 1, background: "var(--paper-edge)" }}
        />
        Scroll
        <span
          style={{ width: 22, height: 1, background: "var(--paper-edge)" }}
        />
      </div>
    </section>
  );
}

function Stat({
  value,
  unit,
  caption,
}: {
  value: string;
  unit: string;
  caption: string;
}) {
  return (
    <div>
      <div className="stat-num">
        {value}
        <span className="unit">{unit}</span>
      </div>
      <div
        className="t-caption"
        style={{ marginTop: 6, color: "var(--ink-3)" }}
      >
        {caption}
      </div>
    </div>
  );
}
