import type { Metadata } from "next";
import Link from "next/link";
import Colophon from "@/components/Colophon";

/*
  /pricing - four tiers, professional register.

  Plain spec-sheet layout: one tier per row, retail price, who it
  is for, what it includes, and a single CTA. No internal economics,
  no "MOST POPULAR" badges, no comparison-table theatre.
*/

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Four tiers - Trial, Researcher, Lab, Institution. Choose the tier that matches your work.",
  alternates: { canonical: "https://www.humanovo.net/pricing" },
  openGraph: {
    title: "humanovo - Pricing",
    description:
      "Four tiers - Trial, Researcher, Lab, Institution.",
    url: "https://www.humanovo.net/pricing",
    type: "article",
  },
};

type Tier = {
  numeral: string;
  name: string;
  price: string;
  cadence: string;
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
    audience: "for evaluating the platform",
    body: "Run a limited number of adversarial pipelines per week against the public corpus. Read every citation, audit every claim, export the full hypothesis trace. Upgrade in one click when you are ready.",
    includes: [
      "Full 12-stage adversarial pipeline",
      "Citation roundtrip on every claim",
      "Access to the public atlas of plates",
      "Export hypotheses to Markdown / BibTeX",
    ],
    cta: { label: "Start trial", href: "/#section-cta" },
  },
  {
    numeral: "II",
    name: "Researcher",
    price: "$20",
    cadence: "per researcher / month",
    audience: "for the individual scientist",
    body: "The default tier for working scientists. Generous monthly limits sized for active research, and a clear notification before any additional usage is authorised - never a surprise charge.",
    includes: [
      "Everything in Trial",
      "Private corpus - your notebooks, PDFs, datasets",
      "Per-hypothesis audit log with Merkle commit",
      "CrossRef + NCBI snapshots pinned per hypothesis",
      "Email support with 24h response",
    ],
    cta: { label: "Request access", href: "/#section-cta" },
  },
  {
    numeral: "III",
    name: "Lab",
    price: "$200",
    cadence: "per lab / month, up to 5 seats",
    audience: "for a PI and their group",
    body: "The PI plus four trainees, one shared corpus, one shared library of saved hypotheses. A graduate student joining mid-rotation should be able to read every prior hypothesis the lab has run, with full citation provenance.",
    includes: [
      "Everything in Researcher, for the whole group",
      "Shared lab corpus + private member workspaces",
      "Lab-wide search across every hypothesis ever run",
      "Role-based access: PI, member, read-only collaborator",
      "Priority support (4h business-hours response)",
    ],
    cta: { label: "Talk to sales", href: "mailto:hello@humanovo.net?subject=humanovo%20%2F%20Lab%20tier" },
  },
  {
    numeral: "IV",
    name: "Institution",
    price: "Custom",
    cadence: "annual contract",
    audience: "for departments, hospitals, biotechs",
    body: "Tenant-isolated deployment, dedicated encryption keys, audit-log export to your SIEM, SSO via SAML or OIDC, HIPAA BAA on request, and a named technical contact.",
    includes: [
      "Everything in Lab, with tenant isolation",
      "BYOK encryption (per-tenant KMS keys)",
      "SSO (SAML 2.0 / OIDC) + SCIM provisioning",
      "Audit log export (S3 / Splunk / Datadog)",
      "HIPAA BAA available; SOC 2 Type II in progress",
      "Named technical contact with 2h business-hours response",
      "Optional on-premises / VPC deployment",
    ],
    cta: { label: "Contact sales", href: "mailto:hello@humanovo.net?subject=humanovo%20%2F%20Institution%20tier" },
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
            Choose the tier
            <br />
            <span style={{ color: "var(--rust)" }}>that matches your work.</span>
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
            From a free trial to enterprise deployment.
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
              body="Researcher tier is available at no charge for full-time graduate students. Verify your university email to enable."
            />
            <Note
              term="Annual billing"
              body="Two months free when paid annually. Lab and Institution tiers are annual by default; Researcher is monthly by default."
            />
            <Note
              term="Cancellation"
              body="Cancel at any time, prorated to the next billing cycle. Your hypotheses, audit logs, and exported data remain accessible read-only for 90 days, then are deleted."
            />
            <Note
              term="Refunds"
              body="Refundable to source within 14 days of first payment. After 14 days, prorated against unused time."
            />
            <Note
              term="Currency"
              body="Prices are USD. Invoicing in EUR, GBP, CAD, or AUD is available on annual contracts."
            />
            <Note
              term="Taxes"
              body="Prices exclude VAT, GST, and sales tax, which are added at checkout based on your jurisdiction."
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
          margin: "18px 0 18px",
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
