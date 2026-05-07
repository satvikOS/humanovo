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
import Colophon from "@/components/Colophon";

/*
  Page composition — narrative rhythm:

    Hero       (heavy art — Vitruvian)
    Wedge      (pure typography — reset)
    Pipeline   (heavy art — four Renaissance plates)
    Trust      (editorial — three colophon-style blocks)
    Download   (functional — three platform plates)
    Colophon   (publication mark — sits at the foot of every page)

  Pattern: dense → sparse → dense → sparse → dense → settled. The
  colophon is not "footer." It is the back-of-book mark that signs
  the publication; same component sits below every page on the site
  so the brand register holds whether the visitor is reading the
  hero or the manifesto.
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
      <Colophon />
    </OverlayProvider>
  );
}
