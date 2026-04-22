/**
 * Landing — internal dev marketing surface.
 *
 * The CANONICAL public landing page lives at https://www.humanovo.net/.
 * This component is kept in-app at /welcome so developers, staff, and
 * self-hosters can preview the moat / positioning without leaving the
 * app. It is NOT served at / — index.html redirects to /dashboard.
 *
 * Any changes to copy or design that need to reach real visitors must
 * also ship to the external humanovo.net repository.
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
      <div
        className="text-xxs mb-6 px-3 py-2 rounded"
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
        }}
      >
        This is the in-app preview. The public landing page is{' '}
        <a
          href="https://www.humanovo.net/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          style={{ color: 'var(--color-text)' }}
        >
          humanovo.net
        </a>{' '}— edit copy there for real visitors.
      </div>
      <header className="flex items-center justify-between mb-16">
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
            onClick={() => { try { window.localStorage.setItem('humanovo.seen', '1') } catch { /* noop */ } }}
            className="btn btn-primary flex items-center gap-2"
            aria-label="Start a 12-stage discovery run"
          >
            <FiZap className="w-4 h-4" />
            Start discovery
          </Link>
          <Link
            to="/dashboard"
            onClick={() => { try { window.localStorage.setItem('humanovo.seen', '1') } catch { /* noop */ } }}
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

      <footer className="text-xxs py-6 flex items-center justify-between flex-wrap gap-3" style={{ color: 'var(--color-text-muted)' }}>
        <span>© 2026 humanovo · Adyanthaya Ventures · Proprietary</span>
        <div className="flex items-center gap-4">
          <Link to="/pricing" className="underline hover:text-[var(--color-text)]">Pricing</Link>
          <Link to="/docs" className="underline hover:text-[var(--color-text)]">Docs</Link>
          <a href="mailto:satvik@humanovo.com" className="underline hover:text-[var(--color-text)]">Contact</a>
        </div>
      </footer>
    </div>
  )
}
