import type { Metadata } from "next";
import Link from "next/link";
import Colophon from "@/components/Colophon";

/*
  /pricing — four tiers, editorial register.

  No "MOST POPULAR" badges, no green checkmarks, no comparison-table
  theatre. Researchers buy software the way they buy reagents: they
  read the spec sheet, weigh it against the budget, and decide.
  Pricing is a spec sheet.

  Structure mirrors a Renaissance imprint's dedication leaf — single
  column, four tiers laid out as numbered "subscriptions" with
  italic Fraunces tier names, mono price, and a paragraph of
  editorial copy. The cost-cap discipline (we cap inference compute
  per tier so power users can't blow up the unit economics, and so
  budget-conscious researchers never get a surprise bill) is stated
  plainly at the top because it is the most distinctive thing about
  the model.
*/

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Four tiers — Trial, Researcher, Lab, Institution. Capped compute, no surprise bills, transparent unit economics. Pricing as a spec sheet, not a funnel.",
  alternates: { canonical: "https://www.humanovo.net/pricing" },
  openGraph: {
    title: "humanovo — Pricing",
    description:
      "Four tiers — Trial, Researcher, Lab, Institution. Capped compute, no surprise bills.",
    url: "https://www.humanovo.net/pricing",
    type: "article",
  },
};

type Tier = {
  numeral: string;
  name: string;
  price: string;
  cadence: string;
  cap: string;
  audience: string;
  body: string;
  includes: string[];
  cta: { label: string; href: string };
};

const TIERS: Tier[] = [
  {
    numeral: "I",
    name: "Trial",
    price: "$0",
    cadence: "no card required",
    cap: "$0.50 of compute / month",
    audience: "for trying the pipeline before you decide",
    body: "Run two adversarial pipelines a week against the full corpus. Read every citation, audit every claim, export the full hypothesis trace. The cap is enforced; you will not be charged. When you outgrow it, the upgrade is one click.",
    includes: [
      "Full 12-stage adversarial pipeline",
      "Citation roundtrip on every claim",
      "Read-only access to the public atlas of plates",
      "Export hypotheses to Markdown / BibTeX",
    ],
    cta: { label: "Start trial", href: "/#section-cta" },
  },
  {
    numeral: "II",
    name: "Researcher",
    price: "$20",
    cadence: "per researcher · per month",
    cap: "$4 of compute / month included",
    audience: "for the individual scientist",
    body: "The default tier for working scientists. Run pipelines as often as the question warrants; the included compute covers the median power-user month. Overage is opt-in, billed at cost, and a one-line entry on your invoice — no surprise bills, ever.",
    includes: [
      "Everything in Trial",
      "Private corpus — your notebooks, PDFs, datasets",
      "Per-hypothesis audit log with Merkle commit",
      "CrossRef + NCBI snapshots pinned per hypothesis",
      "Email-based support, replied to in 24h by a person",
    ],
    cta: { label: "Request access", href: "/#section-cta" },
  },
  {
    numeral: "III",
    name: "Lab",
    price: "$200",
    cadence: "per lab · per month · up to 5 seats",
    cap: "$40 of compute / month included",
    audience: "for a PI and their group",
    body: "The PI plus four trainees, one shared corpus, one shared library of saved hypotheses. The right unit is the lab, not the seat — a graduate student joining mid-rotation should be able to read every prior hypothesis the lab has run, with full citation provenance. That is what this tier buys you.",
    includes: [
      "Everything in Researcher, for the whole group",
      "Shared lab corpus + private member workspaces",
      "Lab-wide search across every hypothesis ever run",
      "Role-based access: PI, member, read-only collaborator",
      "Priority support (4h business-hours response)",
    ],
    cta: { label: "Talk to us", href: "mailto:hello@humanovo.net?subject=humanovo%20%2F%20Lab%20tier" },
  },
  {
    numeral: "IV",
    name: "Institution",
    price: "Custom",
    cadence: "annual contract · floor $200 / seat",
    cap: "negotiated against expected usage",
    audience: "for departments, hospitals, biotechs",
    body: "Tenant-isolated deployment, dedicated encryption keys, audit-log export to your SIEM, SSO via SAML or OIDC, HIPAA BAA on request, and a named technical contact. We will sign your security questionnaire. We will sit on your IRB call. We will fly out for the kickoff.",
    includes: [
      "Everything in Lab, with tenant isolation",
      "BYOK encryption (per-tenant KMS keys)",
      "SSO (SAML 2.0 / OIDC) + SCIM provisioning",
      "Audit log export (S3 / Splunk / Datadog)",
      "HIPAA BAA, SOC 2 Type II report (in progress, ETA Q4 2026)",
      "Named CSM + 2h response SLA, business hours",
      "Optional on-premises / VPC deployment",
    ],
    cta: { label: "Schedule a call", href: "mailto:hello@humanovo.net?subject=humanovo%20%2F%20Institution%20tier" },
  },
];

export default function PricingPage() {
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
          maxWidth: 760,
          marginInline: "auto",
          paddingInline: 24,
          marginBottom: 60,
        }}
      >
        <Link
          href="/"
          className="pricing-back"
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
          maxWidth: 760,
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
            Vol. I &middot; No. 01 &middot; Pricing
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
            Pricing as a spec sheet,
            <br />
            <span style={{ color: "var(--rust)" }}>not a funnel.</span>
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
            Four tiers, capped compute, no surprise bills.
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

        {/* Editorial preamble — the cost-cap discipline. The thing
            that makes this pricing distinctive sits up here, in
            italic, like a publisher's note. */}
        <section
          style={{
            marginBottom: 56,
            fontSize: "1.12rem",
            lineHeight: 1.7,
            color: "var(--ink-1)",
          }}
        >
          <p style={{ marginTop: 0 }}>
            Every tier ships with a <em>compute cap</em>. The cap is the
            ceiling on what humanovo will spend on inference for you in a
            month before pausing and asking. We do this because the cost
            of running adversarial pipelines on the world&rsquo;s
            literature is real, and we would rather you see the number
            than discover it on an invoice.
          </p>
          <p>
            The Researcher and Lab tiers include enough compute to cover
            the <em>p90</em> month of usage we&rsquo;ve seen in beta.
            If you exceed the cap, the pipeline pauses; you can opt in
            to overage (billed at our cost, never marked up) or wait
            until the next billing cycle. There are no surprise bills,
            because there are no bills you didn&rsquo;t click to
            authorise.
          </p>
        </section>

        {TIERS.map((tier) => (
          <TierCard key={tier.numeral} tier={tier} />
        ))}

        <div
          aria-hidden
          style={{
            margin: "70px auto 0",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        <section style={{ marginTop: 56 }}>
          <h2
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              fontWeight: 400,
              fontVariationSettings: '"opsz" 144, "SOFT" 60, "WONK" 0',
              fontSize: "clamp(1.6rem, 2.6vw, 2rem)",
              lineHeight: 1.15,
              letterSpacing: "-0.015em",
              color: "var(--ink-0)",
              margin: "0 0 22px",
              textAlign: "center",
            }}
          >
            Notes on the model
          </h2>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(200px, 30%) 1fr",
              rowGap: 18,
              columnGap: 28,
              fontSize: "1rem",
              lineHeight: 1.6,
            }}
          >
            <Note
              term="Academic discount"
              body="Researcher tier is free for full-time graduate students. Email us from your university address; we verify and flip the bit. No paperwork."
            />
            <Note
              term="Annual billing"
              body="2 months free (effectively 16% off) if you pay annually. Lab and Institution tiers are annual by default; Researcher is monthly by default."
            />
            <Note
              term="Cancellation"
              body="Cancel any time, prorated to the next billing cycle. Your hypotheses, audit logs, and exported data remain accessible read-only for 90 days. After 90 days the workspace is deleted; export tooling is one click."
            />
            <Note
              term="Refunds"
              body="Within 14 days, no questions asked, refunded to source. After 14 days, prorated against unused time. We do not haggle and we do not retain dark-pattern friction."
            />
            <Note
              term="Currency"
              body="Prices are USD. We can invoice in EUR / GBP / CAD / AUD on annual contracts; ask."
            />
            <Note
              term="Taxes"
              body="Prices exclude VAT / GST / sales tax, which is added at checkout based on your jurisdiction."
            />
          </dl>
        </section>

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
            href="/manifesto"
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
            Read the manifesto &rarr;
          </Link>
        </div>
      </article>

      <Colophon />

      <style>{`
        .pricing-back:hover,
        .pricing-back:focus-visible {
          color: var(--ink-0);
          border-bottom-color: var(--rust);
        }
      `}</style>
    </main>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  return (
    <section
      style={{
        marginBottom: 44,
        padding: "32px 28px 28px",
        border: "1px solid var(--paper-edge)",
        borderRadius: 6,
        background: "var(--paper-2)",
        position: "relative",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 16,
          right: 18,
          fontFamily: "var(--font-display), Georgia, serif",
          fontStyle: "italic",
          fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
          fontSize: "1.6rem",
          color: "var(--ink-4)",
          letterSpacing: "-0.02em",
        }}
      >
        {tier.numeral}
      </span>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: 16,
          marginBottom: 8,
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-display), Georgia, serif",
            fontWeight: 400,
            fontStyle: "italic",
            fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1',
            fontSize: "2rem",
            lineHeight: 1,
            letterSpacing: "-0.015em",
            color: "var(--ink-0)",
            margin: 0,
          }}
        >
          {tier.name}
        </h3>
        <span
          style={{
            fontFamily: "var(--font-mono), monospace",
            fontSize: "1.05rem",
            color: "var(--rust)",
            letterSpacing: "0.02em",
          }}
        >
          {tier.price}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.7rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          {tier.cadence}
        </span>
      </div>
      <p
        style={{
          margin: "0 0 6px",
          fontStyle: "italic",
          fontSize: "0.95rem",
          color: "var(--ink-3)",
        }}
      >
        {tier.audience}
      </p>
      <p
        style={{
          margin: "0 0 18px",
          fontFamily: "var(--font-mono), monospace",
          fontSize: "0.7rem",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink-2)",
        }}
      >
        Cap &middot; {tier.cap}
      </p>
      <p
        style={{
          margin: "0 0 18px",
          fontSize: "1rem",
          lineHeight: 1.65,
          color: "var(--ink-1)",
        }}
      >
        {tier.body}
      </p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0 0 22px",
          display: "grid",
          gridTemplateColumns: "1fr",
          rowGap: 7,
        }}
      >
        {tier.includes.map((item) => (
          <li
            key={item}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              fontSize: "0.96rem",
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}
          >
            <span
              aria-hidden
              style={{
                color: "var(--rust)",
                fontFamily: "var(--font-display), Georgia, serif",
                fontStyle: "italic",
                fontSize: "0.9em",
                paddingTop: 1,
              }}
            >
              &mdash;
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <Link
        href={tier.cta.href}
        style={{
          display: "inline-block",
          fontFamily: "var(--font-display), Georgia, serif",
          fontStyle: "italic",
          fontVariationSettings: '"opsz" 96, "SOFT" 80, "WONK" 1',
          fontSize: "1rem",
          color: "var(--ink-0)",
          textDecoration: "none",
          borderBottom: "1px solid var(--rust)",
          paddingBottom: 2,
        }}
      >
        {tier.cta.label} &rarr;
      </Link>
    </section>
  );
}

function Note({ term, body }: { term: string; body: string }) {
  return (
    <div style={{ display: "contents" }}>
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
        {term}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: "1rem",
          lineHeight: 1.6,
          color: "var(--ink-1)",
        }}
      >
        {body}
      </dd>
    </div>
  );
}
