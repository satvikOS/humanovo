/**
 * Pricing — unauthenticated marketing surface.
 *
 * 3 tiers with honest feature gating. Intentionally no "contact sales
 * hidden price" tier; every tier ships with a real limit so the pharma-
 * buyer conversation starts concrete.
 */

import { Link } from 'react-router-dom'
import { FiCheck, FiArrowRight, FiShield } from 'react-icons/fi'

const TIERS = [
  {
    name: 'Researcher',
    price: '$0',
    cadence: 'forever · academic',
    audience: 'Academic + non-profit labs',
    cta: 'Start free',
    ctaHref: '/agents?start=1',
    ctaPrimary: false,
    features: [
      '100 hypotheses / month',
      '10-entity KG slice per run',
      'CrossRef / NCBI citation verification',
      'Single-user, local notebook',
      'Community support',
    ],
    notIncluded: [
      'HIPAA / SOC 2 audit log',
      'Neo4j + pgvector at production scale',
      'API access',
    ],
    color: '#60a5fa',
  },
  {
    name: 'Team',
    price: '$2,400',
    cadence: '/ month · 10 seats',
    audience: 'Biotech discovery teams (5-50 people)',
    cta: 'Start 14-day trial',
    ctaHref: '/agents?start=1',
    ctaPrimary: true,
    features: [
      '2,500 hypotheses / month',
      'Full KG + live Neo4j + pgvector',
      'Every citation round-trip verified',
      'Shared projects, collaborative notebooks',
      'Webhook + REST API access',
      'Email support (24h SLA)',
    ],
    notIncluded: ['HIPAA / SOC 2 audit log', 'SSO / SAML'],
    color: '#4ade80',
    badge: 'Most popular',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: 'annual · starts at $180k',
    audience: 'Pharma R&D + regulated clinical research',
    cta: 'Contact sales',
    ctaHref: 'mailto:satvik@humanovo.com?subject=Enterprise pricing',
    ctaPrimary: false,
    features: [
      'Unlimited hypotheses + discovery runs',
      'Hash-chained HIPAA / SOC 2 audit log',
      'Self-hosted or VPC deployment',
      'SSO (SAML / OIDC) + RBAC',
      'Custom KG ingestion (internal papers, labeled data)',
      'Dedicated SRE + named CSM',
      '99.95% SLA + 4-hour critical response',
    ],
    notIncluded: [],
    color: '#a78bfa',
  },
]

export default function Pricing() {
  return (
    <div className="min-h-screen p-8 max-w-[1100px] mx-auto">
      <header className="flex items-center justify-between mb-12">
        <a
          href="https://www.humanovo.net/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2"
          aria-label="humanovo.net"
        >
          <span className="w-8 h-8 rounded-md bg-[var(--color-text)] text-[var(--color-bg)] flex items-center justify-center font-bold">h</span>
          <span className="font-semibold italic">humanovo</span>
        </a>
        <Link
          to="/dashboard"
          className="text-sm flex items-center gap-1"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Open app <FiArrowRight className="w-3 h-3" />
        </Link>
      </header>

      <section className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight mb-3">
          Pricing for regulated biomedical research.
        </h1>
        <p className="text-base max-w-[640px]" style={{ color: 'var(--color-text-muted)' }}>
          Every tier ships with the full 12-stage adversarial pipeline and
          CrossRef / NCBI citation verification. Tiers differ by scale,
          collaboration surface, and the audit-log + SSO controls pharma
          compliance teams need.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className="glass-card p-5 flex flex-col"
            style={t.badge ? { borderColor: t.color, borderWidth: 1 } : undefined}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold">{t.name}</h2>
              {t.badge && (
                <span
                  className="text-xxs px-1.5 py-0.5 rounded"
                  style={{
                    background: `${t.color}22`,
                    color: t.color,
                    border: `1px solid ${t.color}66`,
                  }}
                >
                  {t.badge}
                </span>
              )}
            </div>
            <p className="text-xxs mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t.audience}
            </p>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-2xl font-semibold" style={{ color: t.color }}>{t.price}</span>
              <span className="text-xxs" style={{ color: 'var(--color-text-muted)' }}>{t.cadence}</span>
            </div>
            <ul className="space-y-1.5 mb-4 flex-1">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5 text-xs">
                  <FiCheck className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: t.color }} />
                  <span>{f}</span>
                </li>
              ))}
              {t.notIncluded.map((f) => (
                <li key={f} className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <span className="w-3 h-3 flex-shrink-0 mt-0.5">—</span>
                  <span className="line-through">{f}</span>
                </li>
              ))}
            </ul>
            {t.ctaHref.startsWith('mailto:') ? (
              <a
                href={t.ctaHref}
                className={t.ctaPrimary ? 'btn btn-primary' : 'btn btn-secondary'}
                aria-label={t.cta}
              >
                {t.cta}
              </a>
            ) : (
              <Link
                to={t.ctaHref}
                className={t.ctaPrimary ? 'btn btn-primary' : 'btn btn-secondary'}
                aria-label={t.cta}
              >
                {t.cta}
              </Link>
            )}
          </div>
        ))}
      </section>

      <section className="glass-card p-5 mb-10">
        <div className="flex items-start gap-3">
          <FiShield className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#4ade80' }} />
          <div>
            <h2 className="text-sm font-semibold mb-1">Compliance by construction</h2>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Every LLM call, external API request, and data access on the
              Enterprise tier is hash-chained into an append-only
              audit_records table (migration 009). SHA-256 + previous-hash
              chain means tampering is cryptographically detectable. Export
              to JSON or CSV for external auditor review; verify-chain
              endpoint confirms integrity over any time range.
            </p>
          </div>
        </div>
      </section>

      <footer className="text-xxs py-6" style={{ color: 'var(--color-text-muted)' }}>
        Questions? <a href="mailto:satvik@humanovo.com" className="underline">satvik@humanovo.com</a> · © 2026 Adyanthaya Ventures
      </footer>
    </div>
  )
}
