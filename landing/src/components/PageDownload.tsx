"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";
import { useOverlay } from "@/components/Navigation";

function WindowsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  );
}
function MacOSIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}
function LinuxIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.43.39.03.8-.066 1.109-.199.69-.4 1.31-.85 1.815-1.334.249-.25.443-.52.603-.8.595-.606.86-1.202.842-1.735-.008-.199-.065-.37-.147-.527.03-.024.06-.05.085-.076.052-.048.108-.1.144-.15.221-.305.098-.729-.127-1.143a.946.946 0 01-.07-.097c-.235-.375-.507-.655-.71-.734-.263-.105-.59.063-.765.3-.283-.1-.67-.027-.98.195-.26.221-.378.567-.31.87-.123.121-.192.26-.265.404l-.022.044c-.18.391-.298.756-.463 1.029-.225.417-.41.698-.66.79-.042.012-.077.019-.117.015-.18-.008-.349-.139-.488-.344-.278-.408-.534-.974-.705-1.515l-.004-.007c-.056-.172-.137-.3-.235-.403.143-.166.28-.339.41-.519.245-.317.453-.659.622-1.007a.42.42 0 00.04-.072c.105-.234.133-.44.117-.63a1.107 1.107 0 00-.025-.116 1.787 1.787 0 00-.154-.44c-.248-.551-.732-1.096-1.216-1.636-.124-.145-.252-.294-.38-.446-.262-.319-.495-.652-.667-.999a3.017 3.017 0 01-.235-.664c-.07-.256-.11-.521-.127-.792-.03-.504.028-1.038.154-1.533.16-.583.42-1.09.754-1.468.164-.183.358-.326.544-.424l.009-.003a1.77 1.77 0 01.592-.157c.093-.005.182.003.263.023.066.016.152.046.176.103.065.152-.149.355-.208.472-.122.199-.252.419-.349.656-.073.167-.13.351-.17.545a2.107 2.107 0 00.045 1.003c.047.177.12.342.2.485l.004.006c.168.337.408.625.702.849l.002.002c.165.137.37.255.543.334.257.14.536.218.814.21a.794.794 0 00.404-.12c.152-.092.256-.229.322-.399.053-.132.084-.283.094-.448l.003-.044c.016-.191.018-.396.012-.603a4.07 4.07 0 00-.088-.727 5.755 5.755 0 00-.337-1.069c-.11-.244-.253-.48-.39-.67-.282-.386-.598-.613-.983-.75-.274-.103-.549-.136-.812-.136z" />
    </svg>
  );
}

type Platform = {
  name: string;
  icon: React.ReactNode;
  detail: string;
  file: string;
  plate: string;
  tint: string;
};

const platforms: Platform[] = [
  {
    name: "Windows",
    icon: <WindowsIcon />,
    detail: "Windows 11 · 10",
    file: "humanovo-setup-x64.exe",
    plate: "I.",
    tint: "rgba(199, 145, 46, 0.12)",
  },
  {
    name: "macOS",
    icon: <MacOSIcon />,
    detail: "macOS 13 Ventura+",
    file: "humanovo-arm64.dmg",
    plate: "II.",
    tint: "rgba(180, 74, 44, 0.12)",
  },
  {
    name: "Linux",
    icon: <LinuxIcon />,
    detail: "Ubuntu 22.04 · Fedora",
    file: "humanovo-x86_64.AppImage",
    plate: "III.",
    tint: "rgba(110, 122, 78, 0.14)",
  },
];

export default function PageDownload() {
  const root = useRef<HTMLElement>(null);
  const { setOpen } = useOverlay();

  useGSAP(
    () => {
      gsap.from(".dl-header > *", {
        y: 24,
        autoAlpha: 0,
        duration: 0.9,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".dl-header",
          start: "top 78%",
          toggleActions: "play none none reverse",
        },
      });

      gsap.from(".device-card", {
        y: 46,
        autoAlpha: 0,
        scale: 0.97,
        duration: 1,
        ease: "power4.out",
        stagger: 0.1,
        scrollTrigger: {
          trigger: ".device-grid",
          start: "top 82%",
          toggleActions: "play none none reverse",
        },
      });

      gsap.from(".dl-foot > *", {
        y: 14,
        autoAlpha: 0,
        duration: 0.8,
        stagger: 0.06,
        ease: "power2.out",
        scrollTrigger: {
          trigger: ".dl-foot",
          start: "top 90%",
          toggleActions: "play none none reverse",
        },
      });
    },
    { scope: root }
  );

  /* Subtle tilt on the plate cards */
  const onTilt = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    gsap.to(card, {
      rotateX: (0.5 - y) * 5,
      rotateY: (x - 0.5) * 6,
      transformPerspective: 1000,
      transformOrigin: "center center",
      duration: 0.5,
      ease: "power3.out",
    });
  };
  const onTiltReset = (e: React.MouseEvent<HTMLDivElement>) => {
    gsap.to(e.currentTarget, {
      rotateX: 0,
      rotateY: 0,
      duration: 0.8,
      ease: "power3.out",
    });
  };

  return (
    <section
      ref={root}
      id="section-download"
      className="section"
      style={{ minHeight: "100vh", paddingTop: 130, paddingBottom: 80 }}
    >
      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 md:px-12">
        <div
          className="dl-header"
          style={{ textAlign: "center", marginBottom: 70 }}
        >
          <span className="pill">
            <span className="dot" />
            Desktop application
          </span>
          <h2 className="t-h2" style={{ marginTop: 22 }}>
            Native.&nbsp;
            <span style={{ color: "var(--rust)" }}>Everywhere</span>
            &nbsp;you work.
          </h2>
          <p
            className="t-lead"
            style={{
              marginTop: 18,
              maxWidth: 540,
              marginInline: "auto",
            }}
          >
            A focused desktop tool tuned for long research sessions — quiet on
            your desk, fast in your thread.
          </p>
        </div>

        <div className="device-grid grid grid-cols-1 md:grid-cols-3 gap-6">
          {platforms.map((p) => (
            <div
              key={p.name}
              className="device-card plate plate-tinted"
              onMouseMove={onTilt}
              onMouseLeave={onTiltReset}
              style={
                {
                  textAlign: "center",
                  padding: "36px 28px 28px",
                  "--tint": p.tint,
                } as React.CSSProperties
              }
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 22,
                  textAlign: "left",
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: "0.56rem",
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                  }}
                >
                  Pl. {p.plate}
                </span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: "0.56rem",
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                  }}
                >
                  build · 0.1.0
                </span>
              </div>

              {/* Icon disc — ink on paper */}
              <div
                style={{
                  width: 76,
                  height: 76,
                  margin: "4px auto 22px",
                  borderRadius: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--ink-0)",
                  color: "var(--paper-0)",
                  boxShadow: "0 14px 28px -12px rgba(26,22,19,0.4)",
                  border: "1px solid var(--ink-0)",
                }}
              >
                {p.icon}
              </div>

              <h3
                className="t-display-upright"
                style={{ fontSize: "1.55rem", marginBottom: 4 }}
              >
                {p.name}
              </h3>
              <p
                style={{
                  fontFamily: "var(--font-display), Georgia, serif",
                  fontStyle: "italic",
                  fontWeight: 300,
                  fontVariationSettings: '"opsz" 72',
                  fontSize: "0.96rem",
                  color: "var(--ink-2)",
                  marginBottom: 4,
                }}
              >
                {p.detail}
              </p>
              <p
                className="font-mono"
                style={{
                  fontSize: "0.62rem",
                  letterSpacing: "0.14em",
                  color: "var(--ink-4)",
                  marginBottom: 22,
                }}
              >
                {p.file}
              </p>

              <button
                disabled
                className="btn-ghost"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  cursor: "not-allowed",
                  opacity: 0.75,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "var(--rust)",
                    boxShadow: "0 0 0 3px rgba(180,74,44,0.18)",
                  }}
                />
                Coming soon
              </button>
            </div>
          ))}
        </div>

        <div
          className="dl-foot"
          style={{ textAlign: "center", marginTop: 72 }}
        >
          <p
            className="t-lead"
            style={{
              fontSize: "1rem",
              maxWidth: 440,
              marginInline: "auto",
            }}
          >
            A web version will launch alongside desktop.{" "}
            <button
              onClick={() => setOpen(true)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--ink-0)",
                borderBottom: "1px solid var(--rust)",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
                fontStyle: "italic",
              }}
            >
              Join the waitlist
            </button>
            .
          </p>

          {/* Ornamental colophon */}
          <div
            className="rule-ornament"
            style={{
              marginTop: 54,
              maxWidth: 460,
              marginInline: "auto",
              fontFamily: "var(--font-mono), monospace",
              fontSize: "0.58rem",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
              justifyContent: "center",
            }}
          >
            <span>© 2026 &nbsp;·&nbsp; Humanovo Inc.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
