/**
 * Docs — developer documentation landing.
 *
 * Single-page reference covering the pipeline architecture, the 5
 * moats, and the API surface. Not a replacement for a real docs site
 * (mkdocs / docusaurus) but enough for external developers to evaluate
 * the platform in one read.
 */

import { Link } from 'react-router-dom'
import { FiArrowRight, FiCode, FiTerminal } from 'react-icons/fi'

export default function Docs() {
  return (
    <div className="min-h-screen p-8 max-w-[880px] mx-auto">
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

      <article className="prose prose-invert max-w-none">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">humanovo Docs</h1>
        <p className="text-base mb-8" style={{ color: 'var(--color-text-muted)' }}>
          The adversarial biomedical hypothesis engine — architecture,
          API, and compliance surface.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">The 12-stage pipeline</h2>
        <p className="text-sm mb-3">
          Every discovery run executes 12 specialised LLM stages sequentially.
          Each stage emits a structured output; dual-embedding grounding
          runs between every stage.
        </p>
        <div className="glass-card p-4 mb-6">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: 'var(--color-text-muted)' }}>
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Stage</th>
                <th className="py-1 pr-3">Role</th>
                <th className="py-1">Model</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['1', 'SEED', 'Generate initial hypothesis', 'Claude Opus 4.6'],
                ['2', 'EXPAND', 'Broaden scope', 'Claude Sonnet 4.6'],
                ['3', 'EVIDENCE', 'Literature review', 'Cohere Command A'],
                ['4', 'COUNTER', 'Adversarial counter-arguments', 'Mistral Large 3'],
                ['5', 'REVISE', 'Rebut counter-arguments', 'o3-mini'],
                ['6', 'MECHANISM', 'Mechanistic deep-dive', 'GPT-4.1'],
                ['7', 'VALIDATE', 'Cross-validation', 'Claude Sonnet 4.6'],
                ['8', 'GROUND', '3-layer grounding', 'Grok-4-1-fast'],
                ['9', 'SCORE', 'Multi-dimensional confidence', 'GPT-4.1'],
                ['10', 'REFINE', 'Fast refinement', 'GPT-4o'],
                ['11', 'TRANSLATE', 'Translational roadmap T0-T5', 'Claude Sonnet 4.6'],
                ['12', 'FINALIZE', 'Final synthesis', 'Claude Sonnet 4.6'],
              ].map((r) => (
                <tr key={r[0]} className="border-t border-[var(--color-border)]">
                  <td className="py-1 pr-3 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{r[0]}</td>
                  <td className="py-1 pr-3 font-medium">{r[1]}</td>
                  <td className="py-1 pr-3" style={{ color: 'var(--color-text-muted)' }}>{r[2]}</td>
                  <td className="py-1 font-mono text-xxs">{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="text-xl font-semibold mt-8 mb-3">Quickstart: start a run</h2>
        <div className="glass-card p-4 font-mono text-xs mb-6 overflow-x-auto">
          <div className="flex items-center gap-2 mb-2 text-xxs" style={{ color: 'var(--color-text-muted)' }}>
            <FiTerminal className="w-3 h-3" />
            curl
          </div>
          <pre style={{ color: 'var(--color-text)' }}>{`curl -X POST https://api.humanovo.com/api/v1/orchestrator/start \\
  -H "Authorization: Bearer $HUMANOVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "disease": "Parkinson\\u2019s Disease",
    "discovery_type": "treatment",
    "focus_entities": ["alpha-synuclein", "vagus nerve", "GBA"],
    "num_rounds": 2,
    "hypotheses_per_round": 3
  }'`}</pre>
        </div>

        <h2 className="text-xl font-semibold mt-8 mb-3">Key API endpoints</h2>
        <div className="glass-card p-4 mb-6">
          <table className="w-full text-xs">
            <tbody>
              {[
                ['POST', '/orchestrator/start', 'Start a 12-stage discovery run'],
                ['GET', '/orchestrator/status', 'Poll active discovery run'],
                ['WS', '/ws/discovery/{run_id}', 'Stream per-stage updates'],
                ['GET', '/knowledge-graph/entities', 'Search KG entities (alias match)'],
                ['POST', '/knowledge-graph/search/similar', 'pgvector cosine search'],
                ['POST', '/knowledge-graph/paths', 'Multi-hop path finder'],
                ['POST', '/citation/verify', 'CrossRef / NCBI round-trip'],
                ['GET', '/hypotheses', 'List hypotheses'],
                ['GET', '/evidence', 'List evidence records'],
                ['GET', '/audit-log', 'Audit record export (enterprise)'],
              ].map((r) => (
                <tr key={`${r[0]}-${r[1]}`} className="border-t border-[var(--color-border)] first:border-0">
                  <td className="py-1 pr-3 font-mono text-xxs" style={{ color: 'var(--color-text-muted)' }}>{r[0]}</td>
                  <td className="py-1 pr-3 font-mono" style={{ color: 'var(--color-text)' }}>{r[1]}</td>
                  <td className="py-1" style={{ color: 'var(--color-text-muted)' }}>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="text-xl font-semibold mt-8 mb-3">Dual-embedding grounding</h2>
        <p className="text-sm mb-3">
          Between every one of the 12 stages, two independent embedding
          models verify that the hypothesis-under-construction stays
          grounded in retrieved evidence:
        </p>
        <ul className="text-sm mb-6 list-disc list-inside space-y-1" style={{ color: 'var(--color-text-muted)' }}>
          <li><strong>Biomedical:</strong> Bedrock Cohere Embed v3 (1024-d)</li>
          <li><strong>General:</strong> Azure text-embedding-3-large (1536-d)</li>
        </ul>
        <p className="text-sm mb-6">
          Each claim in the output is embedded, retrieved against evidence
          pool, and scored by cosine similarity. Claims scoring below
          <code className="mx-1 px-1 rounded bg-[var(--glass-bg)]">GROUNDING_SIMILARITY_THRESHOLD</code>
          (default 0.4) are flagged as ungrounded and blocked from
          propagating into the next stage.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">Tamper-evident audit (Enterprise)</h2>
        <p className="text-sm mb-3">
          Every <code>audit_records</code> row carries a SHA-256 hash of
          its own content <em>plus</em> the previous row's hash. This
          builds a cryptographic chain — any tampering invalidates every
          hash downstream. <code>AuditService.verify_chain()</code>
          re-walks the chain and reports exactly which rows diverge.
        </p>
        <p className="text-sm mb-6">
          Exportable as JSON or CSV. Filter by user, project, execution
          run, time range, or event type. Integrates with the compliance
          docs in <code>COMPLIANCE.md</code>.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">Self-host</h2>
        <div className="glass-card p-4 font-mono text-xs mb-6 overflow-x-auto">
          <div className="flex items-center gap-2 mb-2 text-xxs" style={{ color: 'var(--color-text-muted)' }}>
            <FiCode className="w-3 h-3" />
            docker-compose
          </div>
          <pre style={{ color: 'var(--color-text)' }}>{`git clone https://github.com/satvikOS/humanovo.git
cd humanovo
cp backend/.env.example backend/.env    # fill in Bedrock + Azure keys
docker-compose up -d postgres redis neo4j
cd backend && alembic upgrade head
python -m scripts.seed_kg
python -m scripts.seed_evidence
uvicorn app.main:app --reload --port 8000
cd ../frontend && npm ci && npm run dev`}</pre>
        </div>
      </article>

      <footer className="text-xxs py-8 border-t border-[var(--color-border)] mt-12" style={{ color: 'var(--color-text-muted)' }}>
        <div className="flex items-center justify-between">
          <span>© 2026 humanovo · Adyanthaya Ventures · Proprietary</span>
          <div className="flex items-center gap-3">
            <Link to="/welcome" className="underline">Home</Link>
            <Link to="/pricing" className="underline">Pricing</Link>
            <a href="mailto:satvik@humanovo.com" className="underline">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
