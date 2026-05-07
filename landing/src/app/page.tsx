"use client";

import Navigation, {
  OverlayProvider,
  ContactOverlay,
} from "@/components/Navigation";
import AuroraBackdrop from "@/components/AuroraBackdrop";
import Page1Hero from "@/components/Page1Hero";
import PageWedge from "@/components/PageWedge";
import Page2Pipeline from "@/components/Page2Pipeline";
import PageTrust from "@/components/PageTrust";
import PageDownload from "@/components/PageDownload";
import PlatformLock from "@/components/PlatformLock";

/*
  Page composition — narrative rhythm:

    Hero       (heavy art — Vitruvian)
    Wedge      (pure typography — reset)
    Pipeline   (heavy art — four Renaissance plates)
    Trust      (editorial — three colophon-style blocks)
    Download   (functional — three platform plates)

  Pattern: dense → sparse → dense → sparse → dense. Senior-designer
  instinct: a page reads better when the eye gets a breath every
  other section. Avoid stacking five "feature blocks" in a row.
*/

export default function Home() {
  return (
    <OverlayProvider>
      {/* Skip-link for keyboard users — invisible until focused.
          See globals.css `.skip-link` for the focus-visible reveal. */}
      <a href="#section-hero" className="skip-link">
        Skip to content
      </a>
      <PlatformLock />
      <AuroraBackdrop />
      <Navigation />
      <ContactOverlay />
      <main id="main" style={{ position: "relative", zIndex: 1 }}>
        <Page1Hero />
        <PageWedge />
        <Page2Pipeline />
        <PageTrust />
        <PageDownload />
      </main>
    </OverlayProvider>
  );
}
