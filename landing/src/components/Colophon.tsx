"use client";

/*
  Footer - slim, professional, no editorial blocks.

  An earlier version shipped a Renaissance-style colophon (plates,
  masthead, acknowledged dissection). It read as decoration on a
  product site. The footer is now strictly utilitarian: meta-nav
  to the legal/commercial pages, plus a quiet copyright line.

  No GitHub link - the platform is proprietary, not open source.
*/

import Link from "next/link";

export default function Colophon() {
  return (
    <footer
      role="contentinfo"
      aria-label="Footer"
      style={{
        position: "relative",
        zIndex: 1,
        borderTop: "1px solid var(--paper-edge)",
        paddingTop: 36,
        paddingBottom: 36,
        background: "transparent",
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          marginInline: "auto",
          paddingInline: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <nav
          aria-label="Footer navigation"
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 18,
            flexWrap: "wrap",
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          <Link href="/manifesto" className="footer-link">Manifesto</Link>
          <span aria-hidden className="footer-sep">&middot;</span>
          <Link href="/pricing" className="footer-link">Pricing</Link>
          <span aria-hidden className="footer-sep">&middot;</span>
          <Link href="/docs" className="footer-link">Docs</Link>
          <span aria-hidden className="footer-sep">&middot;</span>
          <Link href="/provenance" className="footer-link">Provenance</Link>
          <span aria-hidden className="footer-sep">&middot;</span>
          <Link href="/status" className="footer-link">Status</Link>
          <span aria-hidden className="footer-sep">&middot;</span>
          <Link href="/privacy" className="footer-link">Privacy</Link>
          <span aria-hidden className="footer-sep">&middot;</span>
          <Link href="/terms" className="footer-link">Terms</Link>
          <span aria-hidden className="footer-sep">&middot;</span>
          <a href="mailto:hello@humanovo.net" className="footer-link">
            Contact
          </a>
        </nav>

        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.58rem",
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: "var(--ink-4)",
          }}
        >
          &copy; 2026 humanovo
        </p>
      </div>

      <style jsx>{`
        .footer-link {
          color: var(--ink-2);
          text-decoration: none;
          border-bottom: 1px solid transparent;
          padding-bottom: 1px;
          transition: color 0.2s ease, border-color 0.2s ease;
        }
        .footer-link:hover,
        .footer-link:focus-visible {
          color: var(--ink-0);
          border-color: var(--rust);
        }
        .footer-sep {
          color: var(--ink-4);
        }
      `}</style>
    </footer>
  );
}
