/**
 * ProjectWorkspace — 6-tab project view per Jamison spec Section 14.2
 * Tabs: Overview, Discovery Runs, Hypotheses, Evidence, Costs, Settings
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { persistGet, safeNum, safePct, safeDollars } from '../utils/persistence'

const API = '/api'

interface SavedResearchPaper {
  id: string
  hypothesis_id: string
  hypothesis_title: string
  project_id: string
  disease: string
  generated_at: string
  filename: string
  paper_html?: string
}

interface Project {
  id: string
  name: string
  description: string
  disease: string
  status: string
  total_discovery_runs: number
  total_api_cost_cents: number
  best_confidence_score: number
  last_discovery_at: string | null
  lab_profile: LabProfile | null
  created_at: string
}

interface LabProfile {
  equipment: string[]
  modalities: string[]
  techniques: string[]
  excluded_methods: string[]
  filter_mode: 'strict' | 'permissive'
}

interface DiscoveryRun {
  id: string
  status: string
  disease: string
  discovery_type: string
  num_rounds: number
  best_hypothesis_id: string | null
  total_cost_cents: number
  total_duration_seconds: number | null
  created_at: string
}

interface Hypothesis {
  id: string
  title: string
  confidence_score: number | null
  novelty_score: number | null
  feasibility_score: number | null
  impact_score: number | null
  round_number: number
  discovery_type: string
  created_at: string
}

interface SynthesisRun {
  id: string
  status: string
  hypothesis: string
  output_format: string
  verbosity: string
  created_at: string
}

interface MethodCategory {
  name: string
  methods: string[]
}

const TABS = ['Overview', 'Discovery Runs', 'Hypotheses', 'Evidence', 'Costs', 'Settings'] as const
type Tab = typeof TABS[number]

export default function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('Overview')
  const [project, setProject] = useState<Project | null>(null)
  const [runs, setRuns] = useState<DiscoveryRun[]>([])
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [synthRuns, setSynthRuns] = useState<SynthesisRun[]>([])
  const [taxonomy, setTaxonomy] = useState<MethodCategory[]>([])
  const [papers, setPapers] = useState<SavedResearchPaper[]>([])
  const [loading, setLoading] = useState(true)

  // Lab profile editor state
  const [labEquipment, setLabEquipment] = useState('')
  const [labTechniques, setLabTechniques] = useState('')
  const [labModalities, setLabModalities] = useState<string[]>([])
  const [labExcluded, setLabExcluded] = useState<string[]>([])
  const [labFilterMode, setLabFilterMode] = useState<'strict' | 'permissive'>('permissive')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!projectId) return
    setLoading(true)
    Promise.all([
      fetch(`${API}/v1/projects/${projectId}`).then(r => r.json()).catch(() => null),
      fetch(`${API}/v1/projects/${projectId}/discovery-runs`).then(r => r.json()).catch(() => []),
      fetch(`${API}/v1/projects/${projectId}/hypotheses`).then(r => r.json()).catch(() => []),
      fetch(`${API}/v1/projects/${projectId}/synthesis-runs`).then(r => r.json()).catch(() => []),
      fetch(`${API}/v1/config/methods-taxonomy`).then(r => r.json()).catch(() => ({ categories: [] })),
    ]).then(([proj, dRuns, hyps, sRuns, tax]) => {
      setProject(proj)
      setRuns(Array.isArray(dRuns) ? dRuns : dRuns?.items || [])
      setHypotheses(Array.isArray(hyps) ? hyps : hyps?.items || [])
      setSynthRuns(Array.isArray(sRuns) ? sRuns : sRuns?.items || [])
      setTaxonomy(tax?.categories || [])
      if (proj?.lab_profile) {
        setLabEquipment((proj.lab_profile.equipment || []).join(', '))
        setLabTechniques((proj.lab_profile.techniques || []).join(', '))
        setLabModalities(proj.lab_profile.modalities || [])
        setLabExcluded(proj.lab_profile.excluded_methods || [])
        setLabFilterMode(proj.lab_profile.filter_mode || 'permissive')
      }
      // Load research papers from localStorage
      const allPapers = persistGet<SavedResearchPaper[]>('research-papers', [])
      setPapers(allPapers.filter(p => p.project_id === projectId))
      setLoading(false)
    })
  }, [projectId])

  const allMethods = taxonomy.flatMap(c => c.methods)

  const saveLabProfile = async () => {
    if (!projectId) return
    setSaving(true)
    try {
      const body = {
        equipment: labEquipment.split(',').map(s => s.trim()).filter(Boolean),
        modalities: labModalities,
        techniques: labTechniques.split(',').map(s => s.trim()).filter(Boolean),
        excluded_methods: labExcluded,
        filter_mode: labFilterMode,
      }
      await fetch(`${API}/v1/projects/${projectId}/lab-profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-8 animate-pulse" style={{ color: 'var(--color-text-muted)' }}>Loading workspace...</div>
  }

  const costDollars = (cents: unknown) => safeDollars(cents)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{project?.name || 'Project'}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{project?.disease} &middot; {project?.status}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate(`/projects/${projectId}/discover`)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--color-accent-blue)' }}>
            Run Discovery
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? '' : 'border-transparent'}`}
            style={tab === t ? { color: 'var(--color-accent-blue)', borderColor: 'var(--color-accent-blue)' } : { color: 'var(--color-text-muted)' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'Overview' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Discovery Runs" value={String(project?.total_discovery_runs || runs.length)} />
          <StatCard label="Hypotheses" value={String(hypotheses.length)} />
          <StatCard label="Best Confidence" value={safePct(project?.best_confidence_score, 0, 'N/A')} />
          <StatCard label="Total Cost" value={costDollars(project?.total_api_cost_cents || 0)} />
          <div className="col-span-full rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Recent Activity</h3>
            {runs.slice(0, 5).map(r => (
              <div key={r.id} className="text-sm py-1" style={{ color: 'var(--color-text-muted)' }}>
                {r.discovery_type} &middot; {r.status} &middot; {new Date(r.created_at).toLocaleDateString()}
              </div>
            ))}
            {runs.length === 0 && <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No runs yet</p>}
          </div>
        </div>
      )}

      {tab === 'Discovery Runs' && (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)' }}>
                <Th>Status</Th><Th>Type</Th><Th>Rounds</Th><Th>Cost</Th><Th>Duration</Th><Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id} className="cursor-pointer hover:opacity-80" style={{ borderTop: '1px solid var(--color-border)' }}
                  onClick={() => navigate(`/projects/${projectId}/discover?run=${r.id}`)}>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td>{r.discovery_type}</Td>
                  <Td>{r.num_rounds}</Td>
                  <Td>{costDollars(r.total_cost_cents)}</Td>
                  <Td>{r.total_duration_seconds ? `${r.total_duration_seconds.toFixed(1)}s` : '-'}</Td>
                  <Td>{new Date(r.created_at).toLocaleDateString()}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length === 0 && <p className="p-4 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>No discovery runs yet</p>}
        </div>
      )}

      {tab === 'Hypotheses' && (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)' }}>
                <Th>Title</Th><Th>Confidence</Th><Th>Novelty</Th><Th>Feasibility</Th><Th>Impact</Th><Th>Round</Th>
              </tr>
            </thead>
            <tbody>
              {hypotheses.map(h => (
                <tr key={h.id} className="cursor-pointer hover:opacity-80" style={{ borderTop: '1px solid var(--color-border)' }}
                  onClick={() => navigate(`/projects/${projectId}/hypotheses/${h.id}`)}>
                  <Td>{h.title}</Td>
                  <Td><ScoreBadge score={h.confidence_score} /></Td>
                  <Td><ScoreBadge score={h.novelty_score} /></Td>
                  <Td><ScoreBadge score={h.feasibility_score} /></Td>
                  <Td><ScoreBadge score={h.impact_score} /></Td>
                  <Td>{h.round_number}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {hypotheses.length === 0 && <p className="p-4 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>No hypotheses yet</p>}
        </div>
      )}

      {tab === 'Evidence' && (
        <div className="space-y-6">
          {/* Research Papers */}
          {papers.length > 0 && (
            <div>
              <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Research Papers</h3>
              <div className="space-y-2">
                {papers.map(p => (
                  <div key={p.id} className="rounded-lg p-3 flex items-center justify-between"
                    style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{p.hypothesis_title || p.filename}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {p.disease} &middot; Generated {new Date(p.generated_at).toLocaleDateString()}
                      </div>
                    </div>
                    {p.paper_html && (
                      <button
                        onClick={() => {
                          const win = window.open('', '_blank')
                          if (win) { win.document.write(p.paper_html!); win.document.close() }
                        }}
                        className="px-3 py-1 text-xs rounded"
                        style={{ background: 'var(--color-accent-blue)', color: '#fff' }}>
                        View
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Synthesis Runs */}
          <div>
            <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Synthesis Runs</h3>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--color-bg-secondary)' }}>
                    <Th>Hypothesis</Th><Th>Status</Th><Th>Format</Th><Th>Verbosity</Th><Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {synthRuns.map(s => (
                    <tr key={s.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <Td>{s.hypothesis.slice(0, 80)}{s.hypothesis.length > 80 ? '...' : ''}</Td>
                      <Td><StatusBadge status={s.status} /></Td>
                      <Td>{s.output_format}</Td>
                      <Td>{s.verbosity}</Td>
                      <Td>{new Date(s.created_at).toLocaleDateString()}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {synthRuns.length === 0 && papers.length === 0 && <p className="p-4 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>No evidence or papers yet</p>}
            </div>
          </div>
        </div>
      )}

      {tab === 'Costs' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Total Spend" value={costDollars(project?.total_api_cost_cents || 0)} />
            <StatCard label="Avg Cost/Run" value={runs.length ? costDollars(Math.round(safeNum(project?.total_api_cost_cents) / runs.length)) : '$0.00'} />
            <StatCard label="Runs" value={String(runs.length + synthRuns.length)} />
          </div>
          <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <h3 className="font-medium mb-3" style={{ color: 'var(--color-text)' }}>Cost by Run</h3>
            {runs.map(r => (
              <div key={r.id} className="flex justify-between text-sm py-1" style={{ color: 'var(--color-text-muted)' }}>
                <span>{r.discovery_type} ({new Date(r.created_at).toLocaleDateString()})</span>
                <span className="font-mono">{costDollars(r.total_cost_cents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'Settings' && (
        <div className="space-y-6 max-w-2xl">
          <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <h3 className="font-medium mb-4" style={{ color: 'var(--color-text)' }}>Lab Profile</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Equipment</label>
                <input value={labEquipment} onChange={e => setLabEquipment(e.target.value)}
                  placeholder="e.g., 3T Siemens Prisma MRI, 64-channel EEG"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Modalities</label>
                <div className="flex flex-wrap gap-1">
                  {allMethods.map(m => (
                    <button key={m} onClick={() => setLabModalities(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                      className="px-2 py-0.5 rounded text-xs"
                      style={{
                        background: labModalities.includes(m) ? 'var(--color-accent-blue)' : 'var(--color-bg)',
                        color: labModalities.includes(m) ? '#fff' : 'var(--color-text-muted)',
                        border: '1px solid var(--color-border)',
                      }}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Techniques</label>
                <input value={labTechniques} onChange={e => setLabTechniques(e.target.value)}
                  placeholder="e.g., resting-state connectivity, event-related potentials"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Excluded Methods</label>
                <div className="flex flex-wrap gap-1">
                  {allMethods.map(m => (
                    <button key={m} onClick={() => setLabExcluded(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                      className="px-2 py-0.5 rounded text-xs"
                      style={{
                        background: labExcluded.includes(m) ? '#ef4444' : 'var(--color-bg)',
                        color: labExcluded.includes(m) ? '#fff' : 'var(--color-text-muted)',
                        border: '1px solid var(--color-border)',
                      }}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Filter Mode</label>
                <div className="flex gap-4">
                  {(['permissive', 'strict'] as const).map(mode => (
                    <label key={mode} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="radio" name="filterMode" value={mode} checked={labFilterMode === mode}
                        onChange={() => setLabFilterMode(mode)} />
                      {mode === 'permissive' ? 'Permissive (flag but keep)' : 'Strict (remove)'}
                    </label>
                  ))}
                </div>
              </div>

              <button onClick={saveLabProfile} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: 'var(--color-accent-blue)', opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Saving...' : 'Save Lab Profile'}
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
    <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
      <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-muted)' }}>{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{children}</td>
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: '#22c55e', running: '#3b82f6', pending: '#eab308', failed: '#ef4444', cancelled: '#6b7280',
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: `${colors[status] || '#6b7280'}20`, color: colors[status] || '#6b7280' }}>
      {status}
    </span>
  )
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--color-text-muted)' }}>-</span>
  const pct = (score * 100).toFixed(0)
  const color = score >= 0.8 ? '#22c55e' : score >= 0.5 ? '#eab308' : '#ef4444'
  return <span className="font-mono text-xs" style={{ color }}>{pct}%</span>
}
