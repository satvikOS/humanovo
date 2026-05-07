"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";

/*
  Page 1.5 — the "wedge."

  No artwork. Pure typography. The hero is heavy with the Vitruvian
  plate, the pipeline section is heavy with four Renaissance plates;
  this section is the breath in between, the moment the page resets
  the eye on a single proposition statement before the reader
  commits to scrolling further.

  Everything below the headline reads as a marginal annotation in
  italic — three precise contrasts that say what humanovo is NOT,
  so the reader can extrapolate what it IS without the page
  having to argue. Senior-designer instinct: never tell a
  researcher what to think; show them the gap and trust them to
  fill it in.
*/

const CONTRASTS: Array<{ them: string; us: string }> = [
  {
    them: "ChatGPT doesn't know what your lab read yesterday.",
    us: "humanovo has read every paper that touched your question.",
  },
  {
    them: "Elicit and Consensus return papers.",
    us: "humanovo returns the next experiment.",
  },
  {
    them: "Notion is for what you've already written.",
    us: "humanovo is for the thought you haven't had yet.",
  },
];

export default function PageWedge() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      // Bail early when the user has asked for reduced motion — the
      // page is fully readable without choreography, and forcing it
      // is a vestibular-discomfort risk.
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      // Defensive: y-only slide. We deliberately do NOT include
      // `autoAlpha: 0` in the from-state because gsap.from() sets
      // its initial state immediately on creation — meaning a
      // visitor who lands at this URL with a hash anchor mid-page,
      // or whose JS hydration is slow, would see this section as
      // empty until the scroll-trigger fired. The slide-up alone
      // is enough cinematic; opacity stays at 1 throughout.
      gsap.from(".wedge-anim", {
        y: 22,
        duration: 0.85,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: {
          trigger: root.current,
          start: "top 78%",
          toggleActions: "play none none reverse",
        },
      });
    },
    { scope: root }
  );

  return (
    <section
      ref={root}
      id="section-wedge"
      className="section"
      aria-labelledby="wedge-headline"
      style={{
        // Quieter background than the hero — let typography do the work.
        // Vertical rhythm: 120px top / bottom mirrors Page 2 header.
        paddingTop: 120,
        paddingBottom: 120,
        position: "relative",
      }}
    >
      <div
        className="relative z-10 w-full mx-auto px-6 md:px-12"
        style={{ maxWidth: 980, textAlign: "center" }}
      >
        <span className="pill wedge-anim">
          <span className="dot" />
          The wedge
        </span>

        <h2
          id="wedge-headline"
          className="t-h2 wedge-anim"
          style={{
            marginTop: 26,
            // Larger than Page 2's h2 — this is the page's most-quoted line.
            // clamp keeps the editorial weight at every viewport.
            fontSize: "clamp(2.4rem, 5vw, 3.6rem)",
            lineHeight: 1.05,
            letterSpacing: "-0.018em",
          }}
        >
          A co-investigator&nbsp;
          <em
            style={{
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
              color: "var(--rust)",
              fontWeight: 400,
            }}
          >
            that has read everything.
          </em>
        </h2>

        <p
          className="t-lead wedge-anim"
          style={{
            marginTop: 24,
            maxWidth: 640,
            marginInline: "auto",
            color: "var(--ink-2)",
          }}
        >
          The literature, your lab&rsquo;s notebooks, every dataset you&rsquo;ve
          touched — held in one model that thinks in citations, not snippets.
        </p>

        {/* Three-row contrast list. Editorial layout: faint THEM line
            on top, italic US line on the bottom in rust. Reads like a
            marginalia gloss in a 17th-century commonplace book. */}
        <div
          className="wedge-anim"
          style={{
            marginTop: 70,
            display: "grid",
            gridTemplateColumns: "1fr",
            rowGap: 36,
            maxWidth: 720,
            marginInline: "auto",
            textAlign: "left",
            paddingTop: 32,
            borderTop: "1px solid var(--paper-edge)",
          }}
        >
          {CONTRASTS.map(({ them, us }, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                columnGap: 24,
                alignItems: "baseline",
              }}
            >
              <span
                aria-hidden
                className="t-eyebrow"
                style={{
                  fontSize: "0.58rem",
                  letterSpacing: "0.32em",
                  color: "var(--ink-4)",
                  paddingTop: 4,
                }}
              >
                §&nbsp;{String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <p
                  style={{
                    fontFamily: "var(--font-mono), monospace",
                    fontSize: "0.78rem",
                    letterSpacing: "0.04em",
                    color: "var(--ink-3)",
                    marginBottom: 6,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {them}
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-display), Georgia, serif",
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontVariationSettings:
                      '"opsz" 96, "SOFT" 80, "WONK" 1',
                    fontSize: "1.32rem",
                    lineHeight: 1.3,
                    color: "var(--ink-0)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {us}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
