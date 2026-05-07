"use client";

import { useEffect, useRef, useState } from "react";

/*
  ArtFrame — shows a locked Renaissance image from /public/art.

  Added in May 2026: a deliberate "ink-drying" reveal. The image
  enters the viewport in a desaturated, slightly faded state (the
  silvergrey moment of a print just laid in the developer tray) and
  resolves over 900 ms to its final sepia-graded state. The transition
  is materiality, not decoration — a 16th-century imprint never
  appeared all at once. Restraint: a single CSS filter transition;
  no JS animation loop; respects prefers-reduced-motion.

  The placeholder is rendered beneath the image until the image
  either loads (then placeholder is hidden, so its text can never
  bleed through the multiply-blend transparency of light areas)
  or errors (then placeholder stays visible so the filename is
  clear to whoever needs to drop the file in).
*/
export type ArtFrameProps = {
  src: string;
  alt: string;
  aspect?: string;
  fit?: "cover" | "contain";
  placeholderLabel: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
  style?: React.CSSProperties;
};

type Status = "loading" | "loaded" | "error";

export default function ArtFrame({
  src,
  alt,
  aspect = "520 / 620",
  fit = "cover",
  placeholderLabel,
  priority,
  sizes,
  className,
  style,
}: ArtFrameProps) {
  void sizes;
  const [status, setStatus] = useState<Status>("loading");
  // `developed` flips true the first time the frame enters the
  // viewport AND the bitmap has decoded. Both gates matter —
  // revealing before decode would skip the fade entirely; revealing
  // before viewport entry would burn the animation while the user
  // can't see it.
  const [developed, setDeveloped] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  // Honour prefers-reduced-motion. When the user has asked the OS
  // to calm motion, the image arrives at its final state immediately.
  // Initialised to `false` and updated in an effect so SSR + first
  // paint stays consistent.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // IntersectionObserver — only fires once. Uses a small rootMargin
  // so the developer-tray fade starts a beat before the plate is
  // fully on-screen, so the user catches the moment of resolution
  // rather than scrolling past a still-fading image.
  useEffect(() => {
    if (developed) return;
    const node = frameRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setDeveloped(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setDeveloped(true);
            obs.disconnect();
            return;
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [developed]);

  // The plate is "fully developed" only when both the bitmap has
  // decoded AND the frame has been seen. Reduced-motion users skip
  // the fade entirely — the final state is applied on first decode.
  const isResolved = (status === "loaded" && developed) || reduceMotion;

  return (
    <div
      ref={frameRef}
      className={`art-frame ${fit === "contain" ? "art-contain" : ""} ${className ?? ""} ${
        isResolved ? "is-developed" : "is-developing"
      }`}
      style={{ aspectRatio: aspect, ...style }}
      data-developed={isResolved ? "true" : "false"}
    >
      {status !== "loaded" && (
        <div className="art-pending" role="img" aria-label={alt}>
          {status === "error" ? (
            <>
              <span className="mark">{placeholderLabel}</span>
              <span className="note">artwork pending — drop file into</span>
              <span className="path">public{src}</span>
            </>
          ) : (
            <span className="mark" style={{ opacity: 0.35 }}>
              {placeholderLabel}
            </span>
          )}
        </div>
      )}

      {/* Plain <img> keeps the artwork locked: no drag, no right-click,
          no selection, no touch callout.

          The filter on this element interpolates between the "wet
          plate" state (heavily desaturated, lower contrast) and the
          configured `--art-filter` final grade. The transition runs
          900ms cubic-bezier; the filter on the developing state is
          a single pre-baked value so the GPU only blends two states.
       */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        onCopy={(e) => e.preventDefault()}
        onLoad={() => setStatus("loaded")}
        onError={(e) => {
          setStatus("error");
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
        style={
          {
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            pointerEvents: "none",
            WebkitUserDrag: "none",
            WebkitTouchCallout: "none",
            userSelect: "none",
            // The "wet plate" state — silvergrey, low contrast,
            // slightly larger than final so the resolve also includes
            // a barely-perceptible scale settle (1px movement, not
            // the kind of ken-burns thing that pulls focus).
            filter: isResolved
              ? "var(--art-filter, none)"
              : "grayscale(0.95) contrast(0.92) brightness(1.05) sepia(0.05) blur(0.4px)",
            transform: isResolved ? "scale(1)" : "scale(1.012)",
            opacity: isResolved ? 1 : 0.86,
            transition: reduceMotion
              ? "none"
              : "filter 900ms cubic-bezier(0.16, 1, 0.3, 1), transform 1100ms cubic-bezier(0.16, 1, 0.3, 1), opacity 700ms ease-out",
            willChange: isResolved ? "auto" : "filter, transform, opacity",
          } as React.CSSProperties
        }
      />
    </div>
  );
}
