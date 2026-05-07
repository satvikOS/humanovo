import type { Metadata } from "next";
import Link from "next/link";
import Colophon from "@/components/Colophon";

/*
  /manifesto — a real essay, set in real type, written in the
  voice of a person rather than a marketing department. Purpose:
  the page-most-likely-to-be-shared. Researchers will forward it
  if it earns the forward.

  Visual register: 64ch column on warm parchment, Fraunces body at
  19px / 1.65 leading, drop-cap on the opening word, italic accents,
  small marginal numerals (I, II, III) for paragraph groups. Reads
  like an editorial in a printed scientific journal — not a
  product page.
*/

export const metadata: Metadata = {
  title: "Manifesto",
  description:
    "Why humanovo. The future here lies in the past — and in how well we understand it. A founder's note on lineage, scepticism, and the impulse to map living systems.",
  alternates: { canonical: "https://www.humanovo.net/manifesto" },
  openGraph: {
    title: "humanovo — Manifesto",
    description:
      "Why humanovo. The future here lies in the past — and in how well we understand it.",
    url: "https://www.humanovo.net/manifesto",
    type: "article",
  },
};

export default function ManifestoPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        position: "relative",
        zIndex: 1,
        paddingTop: 90,
        paddingBottom: 0,
      }}
    >
      {/* Lightweight back-link — no full nav. The page is meant to be
          read, not browsed. */}
      <div
        style={{
          maxWidth: 720,
          marginInline: "auto",
          paddingInline: 24,
          marginBottom: 60,
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            textDecoration: "none",
            paddingBottom: 2,
            borderBottom: "1px solid transparent",
            transition: "color 0.2s ease, border-color 0.2s ease",
          }}
          className="manifesto-back"
        >
          <span aria-hidden>&larr;</span>
          humanovo
        </Link>
      </div>

      <article
        style={{
          maxWidth: 720,
          marginInline: "auto",
          paddingInline: 24,
        }}
      >
        {/* Masthead — date + section label, in the register of a
            scientific journal essay header. */}
        <header style={{ marginBottom: 56, textAlign: "center" }}>
          <span
            style={{
              display: "inline-block",
              fontFamily: "var(--font-mono), monospace",
              fontSize: "0.58rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
              marginBottom: 22,
            }}
          >
            Vol. I &middot; No. 01 &middot; Manifesto
          </span>
          <h1
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              fontWeight: 400,
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
              fontSize: "clamp(2.4rem, 4.8vw, 3.4rem)",
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: "var(--ink-0)",
              margin: 0,
            }}
          >
            The future here lies in the past&mdash;
            <br />
            <span style={{ color: "var(--rust)" }}>
              and in how well we understand it.
            </span>
          </h1>
          <p
            style={{
              marginTop: 28,
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 72, "SOFT" 80',
              fontSize: "0.96rem",
              color: "var(--ink-3)",
            }}
          >
            A note on lineage, scepticism, and what humanovo is for.
          </p>
        </header>

        <div
          style={{
            margin: "0 auto 60px",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
          aria-hidden
        />

        {/* The essay. Editorial-register prose; no marketing voice;
            no bulleted lists. Written as if for a colleague. */}
        <section
          aria-label="Essay"
          style={{
            fontFamily: "var(--font-display), Georgia, serif",
            fontSize: "1.18rem",
            lineHeight: 1.75,
            letterSpacing: "-0.005em",
            color: "var(--ink-1)",
            fontVariationSettings: '"opsz" 18, "SOFT" 30, "WONK" 0',
          }}
        >
          <p style={{ marginTop: 0 }}>
            <span
              style={{
                float: "left",
                fontFamily: "var(--font-display), Georgia, serif",
                fontWeight: 400,
                fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
                fontSize: "5.6rem",
                lineHeight: 0.85,
                marginRight: 14,
                marginTop: 6,
                marginBottom: -6,
                color: "var(--rust)",
                letterSpacing: "-0.03em",
              }}
              aria-hidden
            >
              I
            </span>
            n 1543, in Padua, a young Flemish anatomist named{" "}
            <em>Andreas Vesalius</em> opened a body and drew what he
            saw. For thirteen centuries, the study of the human body
            had run on the authority of Galen&mdash;a 2nd-century
            physician who, forbidden from dissecting humans, had
            built his anatomy from Barbary apes. Vesalius read Galen.
            Then he looked. The discrepancies he found, he rendered
            as plates&mdash;public, beautiful, peer-reviewable
            artifacts anyone with a copy of <em>De humani corporis
            fabrica</em> could verify. The book did not argue. It
            simply <em>showed</em>. That gesture is the modern
            scientific method, compressed.
          </p>

          <p>
            What is humanovo? It is the next entry in that conversation.
          </p>

          <p>
            Five hundred years on, the body of knowledge has changed
            scale. There are{" "}
            <em>thirty-six million papers</em> indexed in PubMed.
            There are 200,000 new ones every month. A working
            scientist, in a working life, can read perhaps 10,000 of
            them. The remaining 99.97% sit in a library no one will
            ever finish. Some of those papers contain the answer to
            the question you are asking right now. You will not find
            them by searching for them, because you do not know to
            search for them. They were written in a different
            decade, in a different field, in a different vocabulary.
            They are the papers Vesalius would have wanted&mdash;
            and they are unreadable at human bandwidth.
          </p>

          <p>
            <em>Read everything. Look yourself. Render the
            discrepancies.</em> That is what humanovo is for. We
            read every paper that has ever been published in your
            field, and the adjacent fields, and the fields you do
            not yet know are adjacent. We hold them as one corpus
            in one model, alongside your own notebooks and your
            lab&rsquo;s data, and we surface the thread of thought
            you were already pulling on&mdash;weighted by evidence,
            grounded in citations that exist, contradicted where
            the literature contradicts itself. We do not give you
            the answer. We give you the next experiment.
          </p>

          <p>
            We are aware of the company we keep. There are LLMs that
            will write you confident-sounding paragraphs about
            biology with citations to papers that do not exist.
            There are literature-search tools that return the same
            twenty-five papers everyone else has already read.
            There are notes apps that let you organise what you
            have already written down. We are <em>not</em> any of
            these. The pipeline behind every humanovo hypothesis is
            twelve adversarial stages: generation, evidence
            grounding, mechanism extraction, contradiction-search,
            counter-argument, revision, and so on&mdash;each stage
            scored, every claim round-tripped through CrossRef and
            NCBI before it lands on your screen. If a citation does
            not resolve to a real paper with the claim we attached
            to it, you do not see it. The literature-of-record is
            our peer reviewer.
          </p>

          <p>
            And we are sceptics by training. We do not train models
            on your work. We do not share your data with the LLM
            vendors we use. We acknowledge, in the colophon, that
            the foundational anatomical plates we love were possible
            only because of dissections often performed without the
            consent of the families involved. Renaissance science
            had ethical failures we have inherited a duty to repair;
            our own version of that duty is that the work we ship
            be auditable, that our methodology be inspectable, and
            that the thread of provenance from claim to citation be
            something a graduate student in 2126 could still follow.
          </p>

          <p>
            What we are reaching for, then, is not &ldquo;AI for
            biology.&rdquo; It is the next chapter of the same
            impulse Vesalius started: to know the body of living
            knowledge, render its discrepancies, and ask&mdash;
            in the company of every researcher who has come
            before&mdash;<em>what does this make possible
            now?</em>
          </p>

          <p>
            If that is the question your work is trying to answer,
            humanovo was made for you.
          </p>

          <div
            style={{
              marginTop: 70,
              fontFamily: "var(--font-mono), monospace",
              fontSize: "0.66rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              textAlign: "center",
            }}
          >
            &mdash; satvik, May 2026
          </div>
        </section>

        <div
          style={{
            margin: "70px auto 0",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
          aria-hidden
        />

        {/* Bottom-of-essay CTA. One option. Editorial register.
            No "buy now" energy. */}
        <div style={{ textAlign: "center", marginTop: 44 }}>
          <Link
            href="/#section-trust"
            style={{
              display: "inline-block",
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 96, "SOFT" 80, "WONK" 1',
              fontSize: "1.1rem",
              color: "var(--ink-1)",
              textDecoration: "none",
              borderBottom: "1px solid var(--rust)",
              paddingBottom: 2,
            }}
          >
            See how humanovo works &rarr;
          </Link>
        </div>
      </article>

      <Colophon />

      <style>{`
        .manifesto-back:hover,
        .manifesto-back:focus-visible {
          color: var(--ink-0);
          border-bottom-color: var(--rust);
        }
        article p {
          margin-bottom: 1.45em;
        }
        /* Drop-cap respects reduced motion and small viewports —
           collapse the float so narrow phones don't get a stranded
           letter beside two-word lines. */
        @media (max-width: 480px) {
          article p:first-of-type span:first-child {
            float: none !important;
            display: inline-block;
            font-size: 3.6rem !important;
            line-height: 0.9 !important;
            margin-right: 6px !important;
            vertical-align: -0.15em;
          }
        }
      `}</style>
    </main>
  );
}
