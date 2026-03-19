/**
 * PipelineIntelligence — 4-tab dashboard per Jamison spec Section 14.6
 * Tabs: Costs, Model Performance, Benchmarks, Optimizations
 */
import { useState, useEffect } from 'react'

const API = '/api'

interface CostSummary {
  total_cost_cents: number
  total_requests: number
  by_model: Record<string, number>
  by_project: { project_id: string; project_name: string; cost_cents: number }[]
}

interface ModelPerformance {
  model: string
  total_calls: number
  avg_latency_ms: number
  avg_tokens: number
  error_rate: number
  fallback_rate: number
}

interface BenchmarkResult {
  test_case: string
  disease: string
  score: number
  pass: boolean
  timestamp: string
}

const TABS = ['Costs', 'Model Performance', 'Benchmarks', 'Optimizations'] as const
type Tab = typeof TABS[number]

export default function PipelineIntelligence() {
  const [tab, setTab] = useState<Tab>('Costs')
  const [costData, setCostData] = useState<CostSummary | null>(null)
  const [models, setModels] = useState<ModelPerformance[]>([])
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/v1/pipeline-intelligence/costs/summary`).then(r => r.json()).catch(() => null),
      fetch(`${API}/v1/pipeline-intelligence/models/performance`).then(r => r.json()).catch(() => []),
      fetch(`${API}/v1/pipeline-intelligence/benchmarks`).then(r => r.json()).catch(() => []),
    ]).then(([costs, mods, bench]) => {
      setCostData(costs)
      setModels(Array.isArray(mods) ? mods : mods?.items || [])
      setBenchmarks(Array.isArray(bench) ? bench : bench?.items || [])
      setLoading(false)
    })
  }, [])

  const costDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Pipeline Intelligence</h1>

      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? '' : 'border-transparent'}`}
            style={tab === t ? { color: 'var(--color-accent-blue)', borderColor: 'var(--color-accent-blue)' } : { color: 'var(--color-text-muted)' }}>
            {t}
          </button>
        ))}
      </div>

      {loading && <div className="animate-pulse text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading...</div>}

      {!loading && tab === 'Costs' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Total Spend" value={costData ? costDollars(costData.total_cost_cents) : '$0.00'} />
            <StatCard label="Total Requests" value={String(costData?.total_requests || 0)} />
            <StatCard label="Models Used" value={String(Object.keys(costData?.by_model || {}).length)} />
          </div>

          {costData?.by_model && Object.keys(costData.by_model).length > 0 && (
            <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <h3 className="font-medium mb-3" style={{ color: 'var(--color-text)' }}>Cost by Model</h3>
              {Object.entries(costData.by_model).sort(([, a], [, b]) => b - a).map(([model, cents]) => (
                <div key={model} className="flex justify-between text-sm py-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  <span className="font-mono text-xs">{model}</span>
                  <span className="font-mono">{costDollars(cents)}</span>
                </div>
              ))}
            </div>
          )}

          {costData?.by_project && costData.by_project.length > 0 && (
            <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <h3 className="font-medium mb-3" style={{ color: 'var(--color-text)' }}>Cost by Project</h3>
              {costData.by_project.sort((a, b) => b.cost_cents - a.cost_cents).map(p => (
                <div key={p.project_id} className="flex justify-between text-sm py-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  <span>{p.project_name}</span>
                  <span className="font-mono">{costDollars(p.cost_cents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'Model Performance' && (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)' }}>
                <Th>Model</Th><Th>Calls</Th><Th>Avg Latency</Th><Th>Avg Tokens</Th><Th>Error Rate</Th><Th>Fallback Rate</Th>
              </tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr key={m.model} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <Td><span className="font-mono text-xs">{m.model}</span></Td>
                  <Td>{m.total_calls}</Td>
                  <Td>{m.avg_latency_ms?.toFixed(0)}ms</Td>
                  <Td>{m.avg_tokens}</Td>
                  <Td><span style={{ color: m.error_rate > 0.1 ? '#ef4444' : '#22c55e' }}>{(m.error_rate * 100).toFixed(1)}%</span></Td>
                  <Td>{(m.fallback_rate * 100).toFixed(1)}%</Td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No performance data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'Benchmarks' && (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)' }}>
                <Th>Test Case</Th><Th>Disease</Th><Th>Score</Th><Th>Result</Th><Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((b, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <Td>{b.test_case}</Td>
                  <Td>{b.disease}</Td>
                  <Td><span className="font-mono">{b.score.toFixed(2)}</span></Td>
                  <Td><span style={{ color: b.pass ? '#22c55e' : '#ef4444' }}>{b.pass ? 'PASS' : 'FAIL'}</span></Td>
                  <Td>{new Date(b.timestamp).toLocaleDateString()}</Td>
                </tr>
              ))}
              {benchmarks.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No benchmark data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'Optimizations' && (
        <div className="space-y-3">
          <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Automated Recommendations</h3>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Recommendations are generated from pipeline performance data. Run more discovery pipelines to populate this section.
            </p>
            {models.filter(m => m.error_rate > 0.1).map(m => (
              <div key={m.model} className="mt-2 text-sm p-2 rounded" style={{ background: '#ef444410', border: '1px solid #ef444430', color: '#ef4444' }}>
                Model {m.model} has {(m.error_rate * 100).toFixed(1)}% error rate — consider reviewing fallback chain
              </div>
            ))}
            {models.filter(m => m.avg_latency_ms > 10000).map(m => (
              <div key={m.model} className="mt-2 text-sm p-2 rounded" style={{ background: '#eab30810', border: '1px solid #eab30830', color: '#eab308' }}>
                Stage using {m.model} has high avg latency ({(m.avg_latency_ms / 1000).toFixed(1)}s) — consider switching to a faster model
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
      <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: 'var(--color-text-muted)' }}>{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{children}</td>
}
