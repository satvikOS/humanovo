"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";

/*
  Paper backdrop — warm parchment with drifting ochre/rust washes and grain.
  Fixed full-viewport, behind all content.
*/
export default function PaperBackdrop() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const washes = gsap.utils.toArray<HTMLElement>(".paper-wash");
      washes.forEach((el, i) => {
        gsap.to(el, {
          x: `+=${40 + i * 14}`,
          y: `-=${30 + i * 12}`,
          scale: 1.06,
          duration: 18 + i * 4,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      });
    },
    { scope: root }
  );

  return (
    <div ref={root} className="paper-stage" aria-hidden>
      <div
        className="paper-wash"
        style={{
          top: "-10%",
          left: "-10%",
          width: "55vw",
          height: "55vw",
          background:
            "radial-gradient(circle, rgba(199,145,46,0.45), rgba(199,145,46,0) 60%)",
        }}
      />
      <div
        className="paper-wash"
        style={{
          top: "25%",
          right: "-15%",
          width: "55vw",
          height: "55vw",
          background:
            "radial-gradient(circle, rgba(180,74,44,0.28), rgba(180,74,44,0) 60%)",
        }}
      />
      <div
        className="paper-wash"
        style={{
          bottom: "-18%",
          left: "15%",
          width: "60vw",
          height: "60vw",
          background:
            "radial-gradient(circle, rgba(106,30,40,0.18), rgba(106,30,40,0) 62%)",
        }}
      />
      <div className="rule-grid" />
      <div className="grain" />
    </div>
  );
}
