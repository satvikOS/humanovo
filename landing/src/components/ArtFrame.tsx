"use client";

import { useState } from "react";

/*
  ArtFrame — shows a locked Renaissance image from /public/art.
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

  return (
    <div
      className={`art-frame ${fit === "contain" ? "art-contain" : ""} ${className ?? ""}`}
      style={{ aspectRatio: aspect, ...style }}
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
          no selection, no touch callout. */}
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
          } as React.CSSProperties
        }
      />
    </div>
  );
}
