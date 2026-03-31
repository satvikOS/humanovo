/**
 * PgvectorManager — Developer pgvector management UI per Jamison spec Section 20.2
 * Tabs: Cache Overview, Search & Browse, Similarity Testing, Maintenance
 */
import { useState, useEffect } from 'react'

const API = '/api'

interface CacheStats {
  total_entries: number
  entries_with_cohere: number
  entries_with_openai: number
  entries_with_both: number
  oldest_entry: string | null
  expiring_in_7_days: number
  total_size_bytes: number
  source_distribution: Record<string, number>
}

interface SearchResult {
  id: string
  content: string
  source: string
  source_id: string
  similarity_score: number
  created_at: string
  metadata: Record<string, unknown>
}

interface SimilarityResult {
  cohere_results: SearchResult[]
  openai_results: SearchResult[]
  overlap_count: number
  verdict: string
}

interface MaintenanceStatus {
  ttl_last_run: string | null
  ttl_entries_deleted: number
  reindex_last_run: string | null
}

const TABS = ['Cache Overview', 'Search & Browse', 'Similarity Testing', 'Maintenance'] as const
type Tab = typeof TABS[number]

export default function PgvectorManager() {
  const [tab, setTab] = useState<Tab>('Cache Overview')
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(true)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSource, setSearchSource] = useState('')
  const [searchThreshold, setSearchThreshold] = useState(0.7)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  // Similarity test state
  const [simQuery, setSimQuery] = useState('')
  const [simResult, setSimResult] = useState<SimilarityResult | null>(null)
  const [simTesting, setSimTesting] = useState(false)

  // Maintenance state
  const [maintStatus, setMaintStatus] = useState<MaintenanceStatus | null>(null)
  const [runningTask, setRunningTask] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/v1/dev/pgvector/stats`).then(r => r.json()).catch(() => null),
      fetch(`${API}/v1/dev/pgvector/maintenance/status`).then(r => r.json()).catch(() => null),
    ]).then(([s, m]) => {
      setStats(s)
      setMaintStatus(m)
      setLoading(false)
    })
  }, [])

  const doSearch = async () => {
    setSearching(true)
    try {
      const res = await fetch(`${API}/v1/dev/pgvector/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, source: searchSource || null, threshold: searchThreshold, limit: 20 }),
      })
      setSearchResults(await res.json())
    } finally {
      setSearching(false)
    }
  }

  const doSimilarityTest = async () => {
    setSimTesting(true)
    try {
      const res = await fetch(`${API}/v1/dev/pgvector/similarity-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: simQuery }),
      })
      setSimResult(await res.json())
    } finally {
      setSimTesting(false)
    }
  }

  const runMaintenance = async (task: string) => {
    setRunningTask(task)
    try {
      await fetch(`${API}/v1/dev/pgvector/maintenance/${task}`, { method: 'POST' })
      // Refresh stats
      const s = await fetch(`${API}/v1/dev/pgvector/stats`).then(r => r.json()).catch(() => null)
      setStats(s)
    } finally {
      setRunningTask(null)
    }
  }

  const formatBytes = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(1)} KB`

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>pgvector Manager</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Developer tool — grounding cache management</p>
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? '' : 'border-transparent'}`}
            style={tab === t ? { color: 'var(--color-text-secondary)', borderColor: 'var(--color-text-secondary)' } : { color: 'var(--color-text-muted)' }}>
            {t}
          </button>
        ))}
      </div>

      {loading && <div className="animate-pulse text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading...</div>}

      {!loading && tab === 'Cache Overview' && stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Entries" value={String(stats.total_entries)} />
            <StatCard label="Cohere Embeddings" value={String(stats.entries_with_cohere)} />
            <StatCard label="OpenAI Embeddings" value={String(stats.entries_with_openai)} />
            <StatCard label="Both Embeddings" value={String(stats.entries_with_both)} />
            <StatCard label="Expiring (7 days)" value={String(stats.expiring_in_7_days)} />
            <StatCard label="Cache Size" value={formatBytes(stats.total_size_bytes)} />
          </div>

          {stats.source_distribution && Object.keys(stats.source_distribution).length > 0 && (
            <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <h3 className="font-medium mb-3" style={{ color: 'var(--color-text)' }}>Source Distribution</h3>
              {Object.entries(stats.source_distribution).sort(([, a], [, b]) => b - a).map(([src, count]) => (
                <div key={src} className="flex justify-between text-sm py-1" style={{ color: 'var(--color-text-muted)' }}>
                  <span>{src}</span>
                  <span className="font-mono">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'Search & Browse' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Enter semantic search query..."
              className="flex-1 px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            <select value={searchSource} onChange={e => setSearchSource(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">All sources</option>
              {Object.keys(stats?.source_distribution || {}).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={doSearch} disabled={!searchQuery || searching}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--color-accent-blue)', opacity: !searchQuery || searching ? 0.5 : 1 }}>
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <span>Threshold: {searchThreshold}</span>
            <input type="range" min={0.5} max={1} step={0.05} value={searchThreshold}
              onChange={e => setSearchThreshold(Number(e.target.value))} className="w-48" />
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map(r => (
                <div key={r.id} className="rounded-lg p-3 text-sm" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{r.source}</span>
                    <span className="text-xs font-mono" style={{ color: r.similarity_score >= 0.8 ? '#22c55e' : '#eab308' }}>
                      {(r.similarity_score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p style={{ color: 'var(--color-text)' }}>{r.content.slice(0, 300)}{r.content.length > 300 ? '...' : ''}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{r.source_id}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'Similarity Testing' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={simQuery} onChange={e => setSimQuery(e.target.value)}
              placeholder="Enter a claim to test grounding for..."
              className="flex-1 px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            <button onClick={doSimilarityTest} disabled={!simQuery || simTesting}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--color-accent-blue)', opacity: !simQuery || simTesting ? 0.5 : 1 }}>
              {simTesting ? 'Testing...' : 'Test'}
            </button>
          </div>

          {simResult && (
            <div className="space-y-4">
              <div className="text-center p-3 rounded-lg text-sm font-medium"
                style={{
                  background: simResult.verdict === 'Grounded' ? '#22c55e20' : simResult.verdict === 'Weakly grounded' ? '#eab30820' : '#ef444420',
                  color: simResult.verdict === 'Grounded' ? '#22c55e' : simResult.verdict === 'Weakly grounded' ? '#eab308' : '#ef4444',
                  border: `1px solid ${simResult.verdict === 'Grounded' ? '#22c55e30' : simResult.verdict === 'Weakly grounded' ? '#eab30830' : '#ef444430'}`,
                }}>
                {simResult.verdict} &middot; {simResult.overlap_count} overlapping results
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>Cohere Embed v3</h4>
                  {simResult.cohere_results.slice(0, 5).map((r, i) => (
                    <div key={i} className="text-xs p-2 mb-1 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                      <span className="font-mono" style={{ color: '#22c55e' }}>{(r.similarity_score * 100).toFixed(1)}%</span> {r.content.slice(0, 100)}...
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>OpenAI text-embedding-3-large</h4>
                  {simResult.openai_results.slice(0, 5).map((r, i) => (
                    <div key={i} className="text-xs p-2 mb-1 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                      <span className="font-mono" style={{ color: '#22c55e' }}>{(r.similarity_score * 100).toFixed(1)}%</span> {r.content.slice(0, 100)}...
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'Maintenance' && (
        <div className="space-y-4">
          {maintStatus && (
            <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Scheduled Tasks</h3>
              <div className="text-sm space-y-1" style={{ color: 'var(--color-text-muted)' }}>
                <p>TTL Cleanup last run: {maintStatus.ttl_last_run || 'Never'} ({maintStatus.ttl_entries_deleted} entries deleted)</p>
                <p>Index Rebuild last run: {maintStatus.reindex_last_run || 'Never'}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { id: 'ttl-cleanup', label: 'Run TTL Cleanup', desc: 'Delete entries older than 30 days' },
              { id: 'reindex', label: 'Rebuild IVFFlat Indexes', desc: 'Reindex for query performance' },
              { id: 'vacuum', label: 'Vacuum Analyze', desc: 'Reclaim space and update stats' },
            ].map(task => (
              <div key={task.id} className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <h4 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{task.label}</h4>
                <p className="text-xs mt-1 mb-3" style={{ color: 'var(--color-text-muted)' }}>{task.desc}</p>
                <button onClick={() => runMaintenance(task.id)} disabled={runningTask === task.id}
                  className="px-3 py-1.5 rounded text-xs font-medium text-white"
                  style={{ background: 'var(--color-accent-blue)', opacity: runningTask === task.id ? 0.5 : 1 }}>
                  {runningTask === task.id ? 'Running...' : 'Run Now'}
                </button>
              </div>
            ))}

            <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <h4 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Purge Source</h4>
              <p className="text-xs mt-1 mb-3" style={{ color: 'var(--color-text-muted)' }}>Delete all cache entries from a specific source</p>
              <select id="purge-source" className="w-full px-2 py-1.5 rounded text-xs mb-2"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                {Object.keys(stats?.source_distribution || {}).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={() => {
                const sel = (document.getElementById('purge-source') as HTMLSelectElement)?.value
                if (sel && confirm(`Delete all entries from ${sel}?`)) runMaintenance(`purge-source?source_name=${sel}`)
              }}
                className="px-3 py-1.5 rounded text-xs font-medium text-white" style={{ background: '#ef4444' }}>
                Purge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
      <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="text-xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  )
}
