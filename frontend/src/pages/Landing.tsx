/**
 * Landing — unauthenticated marketing surface.
 *
 * Minimal hero + 5 moat bullets lifted from COMPETITIVE_POSITIONING.md.
 * Navigates straight into the app on CTA. Served at `/` when we flip
 * the index route; today's deployment auto-redirects to /dashboard so
 * this component is reachable via /welcome until the routing cutover.
 */

import { Link } from 'react-router-dom'
import {
  FiCpu, FiShield, FiCheckCircle, FiDatabase, FiZap, FiArrowRight,
} from 'react-icons/fi'

const MOAT = [
  {
    icon: <FiCpu className="w-5 h-5" />,
    color: '#60a5fa',
    title: 'Heterogeneous 12-stage adversarial pipeline',
    body:
      'Claude Opus + Sonnet, GPT-4.1 + 4o + o3-mini, Cohere, Mistral, Grok. ' +
      'One vendor cannot collapse consensus. No other platform runs seven ' +
      'independent model families per hypothesis.',
  },
  {
    icon: <FiZap className="w-5 h-5" />,
    color: '#f87171',
    title: 'Dual-embedding inter-stage grounding',
    body:
      'Cohere Embed v3 (biomedical, 1024d) + Azure text-embedding-3-large ' +
      '(general, 1536d) run between every one of the 12 stages. Semantic ' +
      'drift is detected before it compounds.',
  },
  {
    icon: <FiShield className="w-5 h-5" />,
    color: '#4ade80',
    title: 'Tamper-evident HIPAA / SOC 2 audit',
    body:
      'Every LLM call, every API hit, every data access is hash-chained ' +
      'in an append-only audit_records table. Cryptographic provenance ' +
      'ready for FDA submission on day one.',
  },
  {
    icon: <FiCheckCircle className="w-5 h-5" />,
    color: '#a78bfa',
    title: 'Every citation verified against CrossRef + NCBI',
    body:
      'Every DOI and PMID humanovo emits is round-tripped against the ' +
      'real sources. No hallucinated references — 94.2% citation-grounding ' +
      'accuracy vs 47.6% baseline on GPT-4o.',
  },
  {
    icon: <FiDatabase className="w-5 h-5" />,
    color: '#fbbf24',
    title: 'Live knowledge graph, not a static bundle',
    body:
      'Neo4j + pgvector, hit live via /api/v1/knowledge-graph/entities. ' +
      'Competitors ship quarterly-refreshed CSVs; humanovo ingests PubTator3 ' +
      '+ HGNC + UniProt continuously.',
  },
]

export default function Landing() {
  return (
    <div className="min-h-screen p-8 max-w-[1100px] mx-auto">
      <header className="flex items-center justify-between mb-16">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-md bg-[var(--color-text)] text-[var(--color-bg)] flex items-center justify-center font-bold">h</span>
          <span className="font-semibold italic">humanovo</span>
        </div>
        <Link
          to="/dashboard"
          className="text-sm flex items-center gap-1"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Open app <FiArrowRight className="w-3 h-3" />
        </Link>
      </header>

      <section className="mb-16">
        <h1 className="text-4xl font-semibold tracking-tight mb-3">
          The adversarial biomedical hypothesis engine.
        </h1>
        <p className="text-lg max-w-[640px]" style={{ color: 'var(--color-text-muted)' }}>
          12 stages. 7 independent LLMs. Dual-embedding grounding between
          every stage. Tamper-evident audit chain. Live knowledge graph.
          Every citation verified.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            to="/agents?start=1"
            className="btn btn-primary flex items-center gap-2"
            aria-label="Start a 12-stage discovery run"
          >
            <FiZap className="w-4 h-4" />
            Start discovery
          </Link>
          <Link
            to="/dashboard"
            className="btn btn-secondary flex items-center gap-2"
            aria-label="Open the main app"
          >
            See live metrics <FiArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        {MOAT.map((m) => (
          <div
            key={m.title}
            className="glass-card p-5"
            role="article"
          >
            <div
              className="mb-3"
              style={{ color: m.color }}
              aria-hidden
            >
              {m.icon}
            </div>
            <h2 className="text-sm font-semibold mb-2">{m.title}</h2>
            <p className="text-xxs" style={{ color: 'var(--color-text-muted)' }}>
              {m.body}
            </p>
          </div>
        ))}
      </section>

      <section className="glass-card p-6 mb-10">
        <h2 className="text-lg font-semibold mb-2">Why it matters</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Single-LLM hypothesis agents (Biomni, Google AI Co-Scientist) suffer
          from model collapse. Curated-KG platforms (Causaly, BenchSci) ship
          data as static bundles that go stale quarterly. humanovo pits seven
          heterogeneous models against each other, verifies every citation,
          and persists the whole audit chain — so enterprise pharma and
          regulated research teams can <em>use the output</em> instead of
          just citing it as inspiration.
        </p>
      </section>

      <footer className="text-xxs py-6" style={{ color: 'var(--color-text-muted)' }}>
        © 2026 humanovo · Adyanthaya Ventures · Proprietary
      </footer>
    </div>
  )
}
