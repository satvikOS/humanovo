import type { Metadata } from "next";
import Link from "next/link";
import Colophon from "@/components/Colophon";

/*
  /terms — terms of service in editorial register.

  These are real terms — they need to be enforceable, but they should
  not read like the cover-our-arse boilerplate every SaaS ships. Tone:
  the contract a publisher would write to a contributor in 1620 if
  the contributor were a colleague rather than an adversary.

  The structure follows industry-standard ToS sections (acceptance,
  account, acceptable use, IP, disclaimers, liability, governing
  law) so an institutional procurement officer can find what they
  need; the prose is plain so the working researcher actually reads
  it.

  Effective date tracks the privacy policy. Changelog at the bottom.
*/

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Terms of service. The contract between humanovo and the people who use it. Plain language, enforceable terms, no dark patterns.",
  alternates: { canonical: "https://www.humanovo.net/terms" },
  openGraph: {
    title: "humanovo — Terms",
    description:
      "Terms of service. Plain language, enforceable terms, no dark patterns.",
    url: "https://www.humanovo.net/terms",
    type: "article",
  },
};

const EFFECTIVE_DATE = "7 May 2026";

export default function TermsPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        position: "relative",
        zIndex: 1,
        paddingTop: 90,
      }}
    >
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
          className="legal-back"
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
          fontFamily: "var(--font-display), Georgia, serif",
          color: "var(--ink-1)",
        }}
      >
        <header style={{ textAlign: "center", marginBottom: 56 }}>
          <span
            style={{
              fontFamily: "var(--font-mono), monospace",
              fontSize: "0.58rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
            }}
          >
            Vol. I &middot; No. 01 &middot; Terms
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
              margin: "22px 0 0",
            }}
          >
            The contract,
            <br />
            <span style={{ color: "var(--rust)" }}>plainly stated.</span>
          </h1>
          <p
            style={{
              marginTop: 22,
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 72, "SOFT" 80',
              fontSize: "0.96rem",
              color: "var(--ink-3)",
            }}
          >
            What you owe us, what we owe you, and what neither of us
            owes anyone else. Effective {EFFECTIVE_DATE}.
          </p>
        </header>

        <div
          aria-hidden
          style={{
            margin: "0 auto 50px",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        <Section title="1. Acceptance">
          <p>
            By creating a humanovo account, or by using the service
            without one (e.g. the public landing pages, the atlas of
            plates), you agree to these terms. If you don&rsquo;t agree,
            don&rsquo;t use the service. If you&rsquo;re entering into
            this agreement on behalf of an organisation, you represent
            that you have the authority to do so and the organisation
            agrees too.
          </p>
        </Section>

        <Section title="2. The service">
          <p>
            humanovo is a research-grade hypothesis-discovery system.
            We run adversarial pipelines over the biomedical
            literature, surface candidate hypotheses with full citation
            provenance, and let you maintain a private corpus of
            notebooks and papers alongside. The pipelines are
            non-deterministic; outputs vary across runs. We make best
            efforts to keep the service available, but we do not
            promise specific uptime numbers outside of an Institution-
            tier SLA.
          </p>
        </Section>

        <Section title="3. Your account">
          <p>
            You are responsible for the security of your account
            credentials. Use a unique password and a hardware-key 2FA
            method; we strongly recommend it and will require it on
            paid tiers by Q4 2026. You must be at least 16 years old,
            or the age of digital consent in your jurisdiction,
            whichever is higher.
          </p>
          <p>
            You may not share your account with anyone else. Each user
            needs their own account; the Lab and Institution tiers
            exist precisely so a group can share work without sharing
            credentials.
          </p>
        </Section>

        <Section title="4. Acceptable use">
          <p>
            humanovo is built for legitimate research. The following
            uses are explicitly out of bounds:
          </p>
          <DefList
            items={[
              [
                "Generation of misinformation",
                "You will not use humanovo to fabricate citations, manufacture appearance of consensus, or produce content designed to deceive a reader into believing a scientific claim is supported when it is not.",
              ],
              [
                "Bioweapons / dual-use harm",
                "You will not use humanovo to design, synthesise, or improve a biological agent intended to cause harm to humans, animals, or ecosystems. Our pipelines are constrained against this; circumventing the constraints is a contract breach.",
              ],
              [
                "Mass scraping / cloning the corpus",
                "You will not use humanovo to scrape our underlying corpus, mirror our service, or train competing models on our outputs. Reasonable export of your own hypotheses for your own work is welcome and explicitly allowed.",
              ],
              [
                "Spam / abuse",
                "You will not use humanovo to send unsolicited bulk communications, deploy malware, or attack other systems.",
              ],
              [
                "Illegal activity",
                "You will not use humanovo to violate laws applicable to you. We will cooperate with valid legal process; we will resist invalid process to the extent the law permits us to.",
              ],
            ]}
          />
          <p>
            Violations may result in suspension or termination, and
            severe violations will be reported to the relevant
            authorities. We reserve some discretion here because the
            edge cases require judgment; we exercise that discretion
            sparingly and document it.
          </p>
        </Section>

        <Section title="5. Your content, your rights">
          <p>
            The corpus you upload, the hypotheses you generate, and the
            audit logs they produce remain yours. We claim no ownership.
            We grant ourselves only the narrow licence required to
            operate the service: storing your content, processing it
            through our pipelines, displaying it back to you, and
            backing it up. That licence ends when your content is
            deleted.
          </p>
          <p>
            We do not train models on your content. See our{" "}
            <Link href="/privacy" className="inline-link">
              privacy policy
            </Link>{" "}
            for the operational detail.
          </p>
        </Section>

        <Section title="6. Our content">
          <p>
            The humanovo software, designs, prose, and the curated
            atlas of public-domain plates are ours (or our licensors&rsquo;).
            The plates themselves are public-domain — their underlying
            works are out of copyright — but our editorial selection,
            arrangement, and accompanying commentary on the atlas page
            is original work covered by copyright. You may quote it
            with attribution and a link back; you may not republish
            substantial portions or use it commercially without
            permission.
          </p>
        </Section>

        <Section title="7. Citations and outputs">
          <p>
            Every citation rendered by humanovo passes a roundtrip
            verification we describe in detail on the{" "}
            <Link href="/provenance" className="inline-link">
              provenance page
            </Link>
            . That said, the underlying literature itself is imperfect:
            papers get retracted, indexes lag, journals disappear. We
            commit to the best-available verification at the time of
            generation and to surfacing post-hoc retractions when we
            learn of them, but we do not guarantee that every cited
            work is currently considered correct by its field. The
            audit trail is the receipt; the literature is the world.
          </p>
          <p>
            humanovo&rsquo;s outputs are research aids, not medical
            advice, legal advice, or replacements for professional
            judgment. If you act on a humanovo hypothesis &mdash;
            running an experiment, citing it in a paper, making a
            clinical decision &mdash; the responsibility for that
            action is yours, just as it would be if you acted on a
            colleague&rsquo;s suggestion.
          </p>
        </Section>

        <Section title="8. Payment, refunds, taxes">
          <p>
            Paid tiers are billed in advance per the cadence on the{" "}
            <Link href="/pricing" className="inline-link">
              pricing page
            </Link>
            . You authorise us to charge your payment method for the
            tier you select and any opt-in overages. Failed payments
            are retried for 14 days; after that the workspace is
            paused (read-only) for a further 30 days, then deleted.
          </p>
          <p>
            Refunds: within 14 days of first payment, no questions
            asked, refunded to source. After 14 days, prorated against
            unused time. Annual contracts cancelled mid-year are
            prorated to the month. Taxes are added at checkout per
            your jurisdiction.
          </p>
        </Section>

        <Section title="9. Termination">
          <p>
            You can terminate at any time from account settings. We
            can terminate for material breach (notably, the acceptable-
            use clauses above) with notice and a cure period where
            curing is possible. On termination &mdash; by either side
            &mdash; you have 90 days of read-only export access before
            workspace deletion. Backup encryption keys are destroyed
            within 30 days of deletion; after that the data is
            cryptographically irrecoverable.
          </p>
        </Section>

        <Section title="10. Warranties and disclaimers">
          <p>
            We provide the service <em>as is</em> and <em>as available</em>,
            without express warranty other than the security and
            privacy commitments stated explicitly here and in the
            privacy policy. We do not warrant that the service will be
            uninterrupted, that every feature will work in every
            environment, or that the underlying literature will agree
            with itself.
          </p>
          <p>
            To the maximum extent permitted by applicable law, we
            disclaim implied warranties of merchantability, fitness
            for a particular purpose, and non-infringement.
          </p>
        </Section>

        <Section title="11. Limitation of liability">
          <p>
            To the maximum extent permitted by applicable law,
            humanovo&rsquo;s aggregate liability for any claim arising
            out of or relating to the service is capped at the greater
            of (a) the fees you paid us in the twelve months preceding
            the claim or (b) US$100. We are not liable for indirect,
            incidental, consequential, special, or punitive damages,
            or for lost profits, lost data, or lost goodwill, even if
            we&rsquo;ve been advised of the possibility.
          </p>
          <p>
            Some jurisdictions don&rsquo;t allow these limits; in those
            jurisdictions our liability is limited to the maximum
            extent allowed.
          </p>
        </Section>

        <Section title="12. Indemnification">
          <p>
            You agree to defend and indemnify humanovo against claims
            arising from (a) your use of the service in breach of
            these terms, (b) your content, or (c) your violation of
            applicable law. We&rsquo;ll do the same for you, on a
            mutual basis, for claims that humanovo&rsquo;s software
            infringes a third party&rsquo;s IP rights, subject to
            standard procedural requirements (prompt notice, sole
            control of the defence, reasonable cooperation).
          </p>
        </Section>

        <Section title="13. Governing law and disputes">
          <p>
            These terms are governed by the laws of the State of
            Delaware, USA, without regard to conflict-of-law principles.
            Disputes will be resolved in the state or federal courts
            sitting in Delaware, and you and humanovo each consent to
            the personal jurisdiction of those courts.
          </p>
          <p>
            Before filing anything, email{" "}
            <em>legal@humanovo.net</em> with the dispute. We will
            attempt to resolve it informally within 30 days.
          </p>
          <p>
            Nothing in these terms prevents either side from seeking
            urgent injunctive relief in court, nor does it prevent
            consumers from exercising mandatory rights under their
            local law.
          </p>
        </Section>

        <Section title="14. Changes to these terms">
          <p>
            We&rsquo;ll email every active account at least 30 days
            before material changes take effect. Non-material changes
            (typos, clarifications, link updates) take effect on
            posting; we log them in the changelog below. If you
            don&rsquo;t accept a material change, you can terminate
            and we&rsquo;ll prorate any unused fees.
          </p>
        </Section>

        <Section title="15. Miscellaneous">
          <DefList
            items={[
              [
                "Entire agreement",
                "These terms, plus the privacy policy and any executed order form, are the entire agreement between us on this subject.",
              ],
              [
                "Severability",
                "If a court invalidates any clause, the rest of the terms keep effect.",
              ],
              [
                "No waiver",
                "Failing to enforce a clause once doesn&rsquo;t waive our right to enforce it later.",
              ],
              [
                "Assignment",
                "You can&rsquo;t assign these terms without our consent. We can assign them in connection with a merger, acquisition, or sale of substantially all our assets, with notice.",
              ],
              [
                "Force majeure",
                "Neither side is in breach for delays caused by events beyond reasonable control (wars, internet outages, pandemics, acts of regulators).",
              ],
              [
                "No third-party beneficiaries",
                "These terms are between you and humanovo, with no one else getting enforceable rights.",
              ],
              [
                "Notices",
                "To us: legal@humanovo.net. To you: the email on your account.",
              ],
            ]}
          />
        </Section>

        <Section title="Changelog">
          <DefList
            items={[
              [
                EFFECTIVE_DATE,
                "Initial version.",
              ],
            ]}
          />
        </Section>

        <div
          aria-hidden
          style={{
            margin: "70px auto 0",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        <div style={{ textAlign: "center", marginTop: 44 }}>
          <Link
            href="/privacy"
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
            Read the privacy policy &rarr;
          </Link>
        </div>
      </article>

      <Colophon />

      <style>{`
        .legal-back:hover,
        .legal-back:focus-visible {
          color: var(--ink-0);
          border-bottom-color: var(--rust);
        }
        .inline-link {
          color: var(--ink-0);
          text-decoration: none;
          border-bottom: 1px solid var(--rust);
          padding-bottom: 1px;
        }
      `}</style>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2
        style={{
          fontFamily: "var(--font-display), Georgia, serif",
          fontWeight: 400,
          fontVariationSettings: '"opsz" 144, "SOFT" 60, "WONK" 0',
          fontSize: "clamp(1.4rem, 2.2vw, 1.7rem)",
          lineHeight: 1.15,
          letterSpacing: "-0.015em",
          color: "var(--ink-0)",
          margin: "0 0 18px",
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontSize: "1.04rem",
          lineHeight: 1.7,
          color: "var(--ink-1)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function DefList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl
      style={{
        margin: "20px 0 0",
        display: "grid",
        gridTemplateColumns: "minmax(180px, 30%) 1fr",
        rowGap: 16,
        columnGap: 28,
      }}
    >
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 72, "SOFT" 80, "WONK" 1',
              fontSize: "1rem",
              color: "var(--rust)",
              paddingTop: 1,
            }}
          >
            {k}
          </dt>
          <dd
            style={{
              margin: 0,
              fontSize: "1rem",
              lineHeight: 1.6,
              color: "var(--ink-1)",
            }}
          >
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
