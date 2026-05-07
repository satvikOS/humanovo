"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ArtFrame from "@/components/ArtFrame";
import { gsap, useGSAP } from "@/lib/gsap";

type Stage = {
  num: string;
  romanNum: string;
  title: string;
  tagline: string;
  description: string;
  tint: string;
  art: string;
  artAlt: string;
  artLabel: string;
  artFilter?: string;
  signature: string;
};

const stages: Stage[] = [
  {
    num: "01",
    romanNum: "I",
    title: "Ingest",
    tagline: "Every source, gathered.",
    description:
      "Papers, preprints, datasets, notebooks, and your lab's internal memory — brought in, normalized, and made queryable as a single corpus.",
    tint: "rgba(199, 145, 46, 0.14)",
    art: "/art/VesaliusFrontColor.jpg",
    artAlt:
      "Andreas Vesalius — frontispiece of De humani corporis fabrica, 1543 — an anatomical theatre crowded with scholars",
    artLabel: "Vesalius · Fabrica frontispiece, 1543",
    artFilter:
      "grayscale(0.9) contrast(1.35) brightness(1.15) sepia(0.5) hue-rotate(-6deg)",
    signature: "libraries · arXiv · PubMed · your drive",
  },
  {
    num: "02",
    romanNum: "II",
    title: "Analyze",
    tagline: "Patterns the eye would miss.",
    description:
      "Semantic, causal, and numerical signals are extracted and cross-correlated across every source. The literature stops being a pile — it becomes a map.",
    tint: "rgba(180, 74, 44, 0.14)",
    art: "/art/heart-and-its-blood-vessels.jpg",
    artAlt:
      "Leonardo da Vinci — heart and its blood vessels (ventricular studies)",
    artLabel: "Leonardo · Heart & Vessels",
    artFilter: "grayscale(0.45) contrast(1.22) brightness(1.18) sepia(0.3)",
    signature: "graphs · embeddings · causal traces",
  },
  {
    num: "03",
    romanNum: "III",
    title: "Generate",
    tagline: "Hypotheses that earn their place.",
    description:
      "When signals converge, humanovo surfaces the hypothesis, its evidence trail, and the experiment that would test it. No black box — every claim carries its citations.",
    tint: "rgba(106, 30, 40, 0.12)",
    art: "/art/vesalius_fabrica_1543_lambert_181_watermark.jpg",
    artAlt:
      "Andreas Vesalius — Prima Musculorum Tabula, the standing muscle figure in an Italian landscape (Fabrica, 1543)",
    artLabel: "Vesalius · Prima Musculorum, 1543",
    artFilter: "grayscale(0.85) contrast(1.3) brightness(1.12) sepia(0.42)",
    signature: "evidence-weighted · fully cited",
  },
  {
    num: "04",
    romanNum: "IV",
    title: "Manage",
    tagline: "Your research, in sequence.",
    description:
      "Threads, milestones, and citations stay in step. Every direction carries its full context forward, so the next investigator picks up exactly where you left.",
    tint: "rgba(110, 122, 78, 0.14)",
    art: "/art/keto05.jpg",
    artAlt:
      "19th-century anatomical écorché with ancillary hand and foot studies — Bourgery & Jacob after Vesalius",
    artLabel: "Écorché with ancillary studies",
    artFilter: "grayscale(0.9) contrast(1.32) brightness(1.14) sepia(0.4)",
    signature: "threads · milestones · receipts",
  },
];

export default function Page2Pipeline() {
  const root = useRef<HTMLElement>(null);
  const stageRefs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [navVisible, setNavVisible] = useState(false);

  /* Observe which stage is currently centred in the viewport so the
     side-nav and the progress bar stay in sync. */
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = Number(
          (visible.target as HTMLElement).dataset.stageIndex ?? -1
        );
        if (idx >= 0) setActive(idx);
      },
      { threshold: [0.35, 0.55, 0.75], rootMargin: "-20% 0px -20% 0px" }
    );
    stageRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  /* Side-nav only shows while the pipeline section is in view */
  useEffect(() => {
    if (!root.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => setNavVisible(entry.isIntersecting),
      { threshold: 0.15 }
    );
    obs.observe(root.current);
    return () => obs.disconnect();
  }, []);

  /* Header reveal + per-stage reveal on scroll */
  useGSAP(
    () => {
      gsap.from(".pipeline-header > *", {
        y: 22,
        autoAlpha: 0,
        duration: 0.9,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".pipeline-header",
          start: "top 78%",
          toggleActions: "play none none reverse",
        },
      });

      gsap.utils.toArray<HTMLElement>(".stage-row").forEach((row) => {
        gsap.from(row.querySelectorAll(".stage-anim"), {
          y: 28,
          autoAlpha: 0,
          duration: 0.9,
          stagger: 0.08,
          ease: "power3.out",
          scrollTrigger: {
            trigger: row,
            start: "top 75%",
            toggleActions: "play none none reverse",
          },
        });
      });
    },
    { scope: root }
  );

  const scrollToStage = useCallback((i: number) => {
    const el = stageRefs.current[i];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const goPrev = () => scrollToStage(Math.max(0, active - 1));
  const goNext = () => scrollToStage(Math.min(stages.length - 1, active + 1));

  return (
    <section
      ref={root}
      id="section-pipeline"
      className="section"
      style={{ display: "block" }}
    >
      <div className="relative z-10 w-full">
        {/* Header */}
        <div
          className="pipeline-header w-full max-w-5xl mx-auto px-6 md:px-12"
          style={{ paddingTop: 120, paddingBottom: 40, textAlign: "center" }}
        >
          <span className="pill">
            <span className="dot" />
            The platform
          </span>
          <h2 className="t-h2" style={{ marginTop: 22 }}>
            From signal&nbsp;<span style={{ color: "var(--rust)" }}>to</span>
            &nbsp;hypothesis.
          </h2>
          <p
            className="t-lead"
            style={{ maxWidth: 620, margin: "22px auto 0" }}
          >
            Four stages, one pipeline. Scroll through the loop that turns a
            field of literature into a direction worth pursuing.
          </p>
        </div>

        {/* Vertical stack of stages */}
        <div
          className="pipeline-stack w-full max-w-6xl mx-auto px-6 md:px-12"
          style={{ display: "grid", rowGap: 24 }}
        >
          {stages.map((stage, i) => (
            <article
              key={stage.num}
              ref={(el) => {
                stageRefs.current[i] = el;
              }}
              data-stage-index={i}
              className="stage-row plate plate-tinted"
              style={
                {
                  display: "grid",
                  gridTemplateColumns:
                    i % 2 === 0
                      ? "minmax(0, 0.9fr) minmax(0, 1.1fr)"
                      : "minmax(0, 1.1fr) minmax(0, 0.9fr)",
                  gap: 44,
                  alignItems: "center",
                  padding: "36px 36px",
                  minHeight: 520,
                  scrollMarginTop: 120,
                  "--tint": stage.tint,
                } as React.CSSProperties
              }
            >
              {/* Art — alternates side for rhythm */}
              <div
                className="stage-anim"
                style={{
                  order: i % 2 === 0 ? 0 : 1,
                }}
              >
                <ArtFrame
                  src={stage.art}
                  alt={stage.artAlt}
                  aspect="1 / 1"
                  fit="cover"
                  placeholderLabel={stage.artLabel}
                  sizes="(max-width: 768px) 90vw, 520px"
                  style={
                    {
                      borderRadius: 14,
                      ["--art-filter" as string]: stage.artFilter,
                    } as React.CSSProperties
                  }
                />
              </div>

              {/* Copy */}
              <div
                style={{
                  order: i % 2 === 0 ? 1 : 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <header
                  className="stage-anim"
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
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
                    Pl. {stage.romanNum}.
                  </span>
                  <span
                    className="t-caption"
                    style={{ fontSize: "0.58rem", letterSpacing: "0.28em" }}
                  >
                    Stage {stage.num} / 04
                  </span>
                </header>

                <h3
                  className="t-display-upright stage-anim"
                  style={{ fontSize: "clamp(2rem, 3.6vw, 2.8rem)" }}
                >
                  {stage.title}
                </h3>
                <p
                  className="stage-anim"
                  style={{
                    fontFamily: "var(--font-display), Georgia, serif",
                    fontStyle: "italic",
                    fontWeight: 300,
                    fontVariationSettings: '"opsz" 72, "SOFT" 60',
                    fontSize: "1.1rem",
                    color: "var(--rust)",
                    letterSpacing: "-0.005em",
                  }}
                >
                  {stage.tagline}
                </p>
                <p className="t-body stage-anim" style={{ fontSize: "0.98rem" }}>
                  {stage.description}
                </p>
                <div
                  className="stage-anim"
                  style={{
                    marginTop: 10,
                    paddingTop: 14,
                    borderTop: "1px solid var(--paper-edge)",
                  }}
                >
                  <div className="t-caption" style={{ fontSize: "0.6rem" }}>
                    {stage.signature}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* Floating side-nav — prev / next + stage dots (only while
            the pipeline section is in view) */}
        {navVisible && (
          <StageNav
            active={active}
            count={stages.length}
            stages={stages}
            onPrev={goPrev}
            onNext={goNext}
            onJump={scrollToStage}
          />
        )}

        {/* Spacer before next section */}
        <div style={{ height: 100 }} />
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Side navigation — stage dots + prev/next
   ───────────────────────────────────────────── */
function StageNav({
  active,
  count,
  stages,
  onPrev,
  onNext,
  onJump,
}: {
  active: number;
  count: number;
  stages: Stage[];
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
}) {
  return (
    <nav
      aria-label="Pipeline stage navigation"
      className="stage-nav"
      style={{
        position: "fixed",
        right: "max(18px, 2vw)",
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}
    >
      <button
        onClick={onPrev}
        disabled={active === 0}
        aria-label="Previous stage"
        className="stage-nav-btn"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "10px 6px",
          borderRadius: 999,
          background: "rgba(244, 236, 220, 0.78)",
          border: "1px solid rgba(201, 183, 149, 0.7)",
          backdropFilter: "blur(14px) saturate(140%)",
          WebkitBackdropFilter: "blur(14px) saturate(140%)",
        }}
      >
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            onClick={() => onJump(i)}
            aria-label={`Stage ${i + 1}: ${stages[i].title}`}
            title={stages[i].title}
            className={`stage-dot ${i === active ? "is-active" : ""}`}
          />
        ))}
      </div>

      <button
        onClick={onNext}
        disabled={active === count - 1}
        aria-label="Next stage"
        className="stage-nav-btn"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </nav>
  );
}
