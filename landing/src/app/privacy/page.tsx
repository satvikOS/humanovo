import type { Metadata } from "next";
import Link from "next/link";
import Colophon from "@/components/Colophon";

/*
  /privacy — privacy policy in editorial register.

  This page is read by three audiences with different stakes:
  (a) the working researcher who wants to know whether we train on
  their data; (b) the institutional procurement officer who needs
  a HIPAA / GDPR / SOC 2 answer; (c) the regulator who will check
  the legal claims. The page must serve all three without sounding
  like any of them in isolation.

  Tone: precise, plain, non-evasive. We commit to specific things,
  with specific dates where the answer involves a date. Where we
  are still in progress (SOC 2 Type II, BAA negotiation), we say
  so plainly. The page itself becomes evidence of how we treat the
  ethics of data — which is a primary trust signal for the
  audience we are trying to earn.

  Effective date: 7 May 2026 (tracks the first-impression date in
  the colophon). Update this whenever a substantive policy change
  ships, and add a CHANGELOG entry below.
*/

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Privacy policy. We do not train on your data. We do not share it with third-party LLM vendors. We delete on request within 24h. The full policy.",
  alternates: { canonical: "https://www.humanovo.net/privacy" },
  openGraph: {
    title: "humanovo — Privacy",
    description:
      "We do not train on your data. We do not share it. The full policy, plainly stated.",
    url: "https://www.humanovo.net/privacy",
    type: "article",
  },
};

const EFFECTIVE_DATE = "7 May 2026";

export default function PrivacyPage() {
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
            Vol. I &middot; No. 01 &middot; Privacy
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
            Your work,
            <br />
            <span style={{ color: "var(--rust)" }}>kept private.</span>
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
            What we collect, what we don&rsquo;t, and what you can ask
            us to delete. Effective {EFFECTIVE_DATE}.
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

        <Section title="Our four commitments">
          <p>
            The bulk of this policy is the legal detail required by
            GDPR, CCPA, and the relationships our institutional
            customers have with their own auditors. The four commitments
            below are the load-bearing ones; everything else is how we
            operationalise them.
          </p>
          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: "20px 0 0",
              display: "grid",
              rowGap: 16,
            }}
          >
            <Commitment
              n="I"
              title="We do not train on your data."
              body="Your hypotheses, notebooks, uploads, and queries are never used to train any model — neither ours, nor any third-party model we route inference through. This is contractually enforced with every LLM vendor we use; the contracts are reviewable on request under NDA."
            />
            <Commitment
              n="II"
              title="We do not share your data with third parties."
              body="Other than the inference vendors named below — used in a zero-retention mode — your data does not leave our infrastructure. We do not sell data, ever, under any circumstance. We do not place advertising. We do not have data partners."
            />
            <Commitment
              n="III"
              title="You can delete everything in 24 hours."
              body="One-click delete in your account settings removes your workspace, hypotheses, audit logs, and uploaded files within 24h, with cryptographic erasure of backup encryption keys within 30d. We will email confirmation when deletion completes."
            />
            <Commitment
              n="IV"
              title="We tell you when something happens."
              body="Material policy changes are emailed to every active account at least 30 days before they take effect. Security incidents that could affect your data are disclosed within 72h of discovery, by direct email, with a public post-mortem to follow."
            />
          </ol>
        </Section>

        <Section title="What we collect">
          <DefList
            items={[
              [
                "Account data",
                "Email, name, organisation, role. Provided by you when you sign up. Used to authenticate, bill, and contact you. Retained while your account is active.",
              ],
              [
                "Workspace content",
                "The corpus you upload, the hypotheses you generate, the audit logs they produce. Encrypted at rest with AES-256-GCM, in transit with TLS 1.3. Held in our primary database (Postgres) and object storage (S3 with object-lock for audit logs).",
              ],
              [
                "Usage telemetry",
                "Which pages you visit, which buttons you click, which pipelines you run, how long they take. Used to operate and improve the service. We do not enrich this with third-party identity data. We do not run third-party analytics scripts (no Google Analytics, no Mixpanel-style fingerprinting).",
              ],
              [
                "Inference traces",
                "The intermediate prompts, model responses, and tool calls each pipeline stage produces. Retained for 30 days for debugging and audit-replay; after 30 days, deleted unless you have flagged a specific hypothesis for retention.",
              ],
              [
                "Billing data",
                "Last four digits of card, billing address, invoices. Card numbers are tokenised by Stripe; we never see them. Retained per tax-law requirements (typically 7 years).",
              ],
            ]}
          />
        </Section>

        <Section title="What we don&rsquo;t collect">
          <DefList
            items={[
              [
                "Cross-site tracking",
                "We do not place tracking cookies, fingerprint your browser, or load third-party tags that do.",
              ],
              [
                "Sensitive personal data without consent",
                "Race, religion, sexual orientation, biometrics — never collected on the consumer site. Institutional customers handling PHI/PII do so under a BAA with explicit consent flows configured per-deployment.",
              ],
              [
                "Children&rsquo;s data",
                "humanovo is not directed at children under 16. We do not knowingly collect data from anyone under 16; if we discover such data, we delete it.",
              ],
            ]}
          />
        </Section>

        <Section title="Inference vendors">
          <p>
            Adversarial pipelines run on a small set of frontier-model
            providers. Each is contractually held to zero-retention,
            no-training-on-customer-data terms. The current roster:
          </p>
          <DefList
            items={[
              [
                "Anthropic",
                "Default provider for the generation, mechanism-extraction, and revision stages. Contracted under the Anthropic Zero-Retention Addendum. No customer data used for training.",
              ],
              [
                "OpenAI (Azure)",
                "Used for the contradiction-search and counter-argument stages. Contracted via Azure&rsquo;s zero-retention API. Data is not retained beyond the inference call and is not used for training.",
              ],
              [
                "Self-hosted open weights",
                "Llama-family and Mistral-family models we host ourselves on dedicated GPU infrastructure for the embedding and re-ranking stages. No data leaves our network.",
              ],
            ]}
          />
          <p>
            We will email every active account 30 days before adding,
            removing, or changing the role of any inference vendor.
          </p>
        </Section>

        <Section title="Security">
          <DefList
            items={[
              [
                "Encryption at rest",
                "AES-256-GCM. Database and object storage. Per-tenant data-encryption keys on the Institution tier.",
              ],
              [
                "Encryption in transit",
                "TLS 1.3 only. HSTS preloaded. Certificate transparency monitored.",
              ],
              [
                "Access control",
                "Principle-of-least-privilege internally. SSO + hardware-key 2FA mandatory for all employees. All production access logged and reviewed weekly.",
              ],
              [
                "Backups",
                "Encrypted, immutable, in a separate cloud account, in a separate region. Restore tested monthly.",
              ],
              [
                "Penetration testing",
                "Annual third-party penetration test. Most recent: scheduled Q3 2026. Reports available to Institution-tier customers under NDA.",
              ],
              [
                "SOC 2 / ISO 27001",
                "SOC 2 Type II audit in progress, ETA Q4 2026. ISO 27001 on the 2027 roadmap.",
              ],
              [
                "HIPAA",
                "BAAs available for Institution-tier customers handling PHI. Technical safeguards (encryption, access logs, breach notification) are in place site-wide; the BAA is the contractual layer that obligates us to them in writing.",
              ],
              [
                "GDPR / UK GDPR",
                "We are the data controller for site-account data and the data processor for workspace content uploaded by EU/UK customers. SCCs in place with all sub-processors. Data subject access requests fulfilled within 30 days.",
              ],
            ]}
          />
        </Section>

        <Section title="Your rights">
          <p>
            Under GDPR, UK GDPR, CCPA, and equivalent regimes, you have
            the rights below. We honour them globally, regardless of
            jurisdiction, because doing so is the right policy and the
            engineering cost of regional carve-outs exceeds the value.
          </p>
          <DefList
            items={[
              [
                "Access",
                "Export everything we hold about you, in a portable format (JSON + the underlying files). Available in account settings; arrives by email within 24h.",
              ],
              [
                "Correction",
                "Edit account data inline. Workspace content is yours to correct directly; we do not edit it.",
              ],
              [
                "Deletion",
                "One-click in account settings. Completes within 24h; backup keys destroyed within 30d.",
              ],
              [
                "Portability",
                "The export above is in a documented schema designed to be re-imported into any system you choose. We will not lock you in.",
              ],
              [
                "Objection",
                "You can object to any specific use of your data; email privacy@humanovo.net and we&rsquo;ll respond within 30 days.",
              ],
              [
                "Withdrawal of consent",
                "If we relied on consent for any processing, you can withdraw it at any time without penalty.",
              ],
            ]}
          />
        </Section>

        <Section title="Where data lives">
          <p>
            Primary infrastructure is in <em>us-east-1</em> (Virginia).
            EU customer data, by request, can be pinned to{" "}
            <em>eu-west-1</em> (Ireland) on the Institution tier, with
            no transatlantic transfers other than for support
            engineering when expressly authorised by the customer.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            We use a small set of strictly-necessary cookies (session
            authentication, CSRF token, theme preference). We do not
            use advertising or analytics cookies. There is therefore
            no cookie consent banner — none of our cookies require
            consent under ePrivacy or GDPR.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Privacy questions: <em>privacy@humanovo.net</em>. We reply
            within five business days.
          </p>
          <p>
            EU representative (Article 27 GDPR): named in the imprint
            once a customer in the EU formally requires it; not yet
            appointed because we have no qualifying EU-resident data
            subjects under the threshold. We will appoint and publish
            before crossing it.
          </p>
          <p>
            Data Protection Officer: <em>dpo@humanovo.net</em>.
          </p>
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
            href="/terms"
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
            Read the terms &rarr;
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
      `}</style>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 56 }}>
      <h2
        style={{
          fontFamily: "var(--font-display), Georgia, serif",
          fontWeight: 400,
          fontVariationSettings: '"opsz" 144, "SOFT" 60, "WONK" 0',
          fontSize: "clamp(1.5rem, 2.4vw, 1.85rem)",
          lineHeight: 1.15,
          letterSpacing: "-0.015em",
          color: "var(--ink-0)",
          margin: "0 0 22px",
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontSize: "1.06rem",
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
        rowGap: 18,
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

function Commitment({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 22,
        alignItems: "baseline",
      }}
    >
      <span
        aria-hidden
        style={{
          fontFamily: "var(--font-display), Georgia, serif",
          fontStyle: "italic",
          fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
          fontSize: "1.6rem",
          color: "var(--rust)",
          lineHeight: 1,
          minWidth: 28,
        }}
      >
        {n}
      </span>
      <div>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-display), Georgia, serif",
            fontStyle: "italic",
            fontVariationSettings: '"opsz" 72, "SOFT" 80, "WONK" 1',
            fontSize: "1.18rem",
            lineHeight: 1.3,
            color: "var(--ink-0)",
            marginBottom: 6,
          }}
        >
          {title}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "1rem",
            lineHeight: 1.6,
            color: "var(--ink-1)",
          }}
        >
          {body}
        </p>
      </div>
    </li>
  );
}
