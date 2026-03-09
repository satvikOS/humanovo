import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FiPlay,
  FiPause,
  FiSquare,
  FiTarget,
  FiSettings,
  FiChevronDown,
  FiChevronUp,
  FiAward,
  FiPlus,
  FiX,
  FiDownload,
  FiCpu,
  FiZap,
  FiClock,
  FiCheck,
  FiAlertTriangle,
  FiColumns,
  FiExternalLink,
  FiFolder,
} from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../services/api'
import type { OrchestratorStatus, DiscoveryConfig } from '../services/api'
import { persistSet, persistGet } from '../utils/persistence'

// Types
interface Hypothesis {
  id: string
  title: string
  description: string
  mechanism: string
  confidence: number
  validated: boolean
  external_factors?: Array<Record<string, string>>
  evidence_summary?: string[]
  risks?: string[]
  validation_steps?: string[]
  novelty_score?: number
  key_citations?: string[]
  fda_references?: string[]
  clinical_trial_references?: string[]
  grounding_sources?: {
    pubmed_count?: number
    clinical_trials_count?: number
    fda_count?: number
    uniprot_count?: number
    reactome_count?: number
  }
  stages_completed?: number
  round_number?: number
  created_at?: string
}

interface ExternalFactor {
  name: string
  category: 'nutrient' | 'chemical' | 'drug' | 'compound' | 'element'
  interaction: string
}

interface DiscoveryRun {
  id: string
  disease: string
  discoveryType: string
  hypothesesCount: number
  timestamp: string
  status: string
}

function isValidHypothesis(h: Hypothesis): boolean {
  if (!h.title || h.title.length < 10) return false
  if (h.title.startsWith('<reasoning>') || h.title.startsWith('<think>')) return false
  if (h.title.startsWith('```') || h.title.startsWith('{')) return false
  if (h.description?.startsWith('<reasoning>') || h.description?.startsWith('<think>')) return false
  if (!h.description || h.description.length < 50) return false
  return true
}

const discoveryTypes = [
  { value: 'treatment', label: 'Treatment Discovery', description: 'Find therapeutic strategies' },
  { value: 'prevention', label: 'Prevention Strategy', description: 'Prevent disease onset' },
  { value: 'biomarker', label: 'Biomarker Discovery', description: 'Early detection markers' },
  { value: 'drug_repurposing', label: 'Drug Repurposing', description: 'Existing drugs for new uses' },
  { value: 'combination_therapy', label: 'Combination Therapy', description: 'Synergistic drug combinations' },
]

const factorCategories = ['nutrient', 'chemical', 'drug', 'compound', 'element'] as const

function confidenceColor(c: number) {
  if (c >= 0.8) return 'var(--color-success)'
  if (c >= 0.6) return 'var(--color-warning)'
  if (c >= 0.4) return 'var(--color-accent-orange)'
  return 'var(--color-error)'
}

export default function Agents() {
  // State
  const [state, setState] = useState<string>('idle')
  const [stats, setStats] = useState<OrchestratorStatus | null>(null)
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [selectedHypothesis, setSelectedHypothesis] = useState<Hypothesis | null>(null)
  const [compareHypothesis, setCompareHypothesis] = useState<Hypothesis | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [showConfig, setShowConfig] = useState(true)
  const [showFactors, setShowFactors] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [sortBy, setSortBy] = useState<'confidence' | 'novelty' | 'date'>('confidence')
  const [filterConfidence, setFilterConfidence] = useState(0)

  // Config
  const [config, setConfig] = useState<DiscoveryConfig>({
    disease: '',
    discovery_type: 'treatment',
    focus_entities: [],
    max_results: 50,
    min_confidence: 0.3,
    research_guidance: '',
  })
  const [focusInput, setFocusInput] = useState('')
  const [factors, setFactors] = useState<ExternalFactor[]>([])
  const [factorName, setFactorName] = useState('')
  const [factorCategory, setFactorCategory] = useState<ExternalFactor['category']>('nutrient')
  const [factorInteraction, setFactorInteraction] = useState('')

  // History
  const [discoveryHistory, setDiscoveryHistory] = useState<DiscoveryRun[]>(() => {
    try { return JSON.parse(localStorage.getItem('humanovo-discovery-history') || '[]') } catch { return [] }
  })

  // Project tracking (auto-created by backend)
  const [projectId, setProjectId] = useState<string>('')
  const [, setProjectName] = useState<string>('')

  const pollRef = useRef<number | null>(null)
  const failRef = useRef(0)

  // Polling
  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getOrchestratorStatus()
      failRef.current = 0
      setConnected(true)
      setState(res.state || 'idle')
      setStats(res)

      // Restore config from backend
      if (!config.disease && (res as any).disease) {
        setConfig(prev => ({ ...prev, disease: (res as any).disease, discovery_type: (res as any).discovery_type || prev.discovery_type }))
      }

      // Track auto-created project and sync to localStorage for ProjectDetail
      if ((res as any).project_id && (res as any).project_id !== 'discovery') {
        const pid = (res as any).project_id
        const pname = (res as any).project_name || ''
        setProjectId(pid)
        setProjectName(pname)

        // Save project to localStorage so ProjectDetail can find it
        const existingProjects = persistGet<any[]>('projects', [])
        if (!existingProjects.find((p: any) => p.id === pid)) {
          const projectEntry = {
            id: pid,
            name: pname,
            description: `Auto-generated discovery project for ${(res as any).disease || config.disease}`,
            disease_focus: (res as any).disease || config.disease,
            research_question: `${config.discovery_type?.replace('_', ' ')} discovery for ${(res as any).disease || config.disease}`,
            tags: ['discovery', 'auto-generated'],
            status: state === 'completed' ? 'completed' : 'active',
            hypothesis_count: (res as any).top_hypotheses?.length || 0,
            evidence_count: 0,
            simulation_count: 0,
            hypotheses: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          persistSet('projects', [...existingProjects, projectEntry])
        } else {
          // Update hypothesis count and status
          const updated = existingProjects.map((p: any) =>
            p.id === pid ? {
              ...p,
              hypothesis_count: (res as any).top_hypotheses?.length || p.hypothesis_count,
              status: state === 'completed' ? 'completed' : p.status,
              updated_at: new Date().toISOString(),
            } : p
          )
          persistSet('projects', updated)
        }
      }

      // Merge hypotheses and sync to localStorage
      if ((res as any).top_hypotheses?.length > 0) {
        const pid = (res as any).project_id || ''
        setHypotheses(prev => {
          const ids = new Set(prev.map(h => h.id))
          const incoming = (res as any).top_hypotheses.filter((h: Hypothesis) => !ids.has(h.id)).filter(isValidHypothesis)
          if (!incoming.length) return prev
          const merged = [...incoming, ...prev].sort((a: Hypothesis, b: Hypothesis) => b.confidence - a.confidence).slice(0, 100)

          // Save hypotheses to localStorage with project_id for ProjectDetail
          if (pid && pid !== 'discovery') {
            const savedHypotheses = persistGet<any[]>('hypotheses', [])
            const existingIds = new Set(savedHypotheses.map((h: any) => h.id))
            const newEntries = merged.filter(h => !existingIds.has(h.id)).map(h => ({
              ...h,
              project_id: pid,
              disease: (res as any).disease || config.disease,
              discovery_type: config.discovery_type || 'treatment',
            }))
            if (newEntries.length > 0) {
              persistSet('hypotheses', [...savedHypotheses, ...newEntries])
            }
          }

          return merged
        })
      }

      // Adapt polling speed
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = window.setInterval(fetchStatus, res.state === 'running' ? 3000 : 10000)
      }
    } catch {
      failRef.current++
      if (failRef.current >= 2) {
        setConnected(false)
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = window.setInterval(fetchStatus, 30000)
        }
      }
    }
  }, [config.disease])

  useEffect(() => {
    fetchStatus()
    pollRef.current = window.setInterval(fetchStatus, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchStatus])

  // Actions
  const startDiscovery = async () => {
    if (!config.disease.trim()) return
    try {
      await api.startDiscovery(config)
      setState('running')
      setShowConfig(false)
      setHypotheses([])

      // Save to history
      const run: DiscoveryRun = {
        id: `run-${Date.now()}`,
        disease: config.disease,
        discoveryType: config.discovery_type || 'treatment',
        hypothesesCount: 0,
        timestamp: new Date().toISOString(),
        status: 'running',
      }
      const updated = [run, ...discoveryHistory].slice(0, 50)
      setDiscoveryHistory(updated)
      localStorage.setItem('humanovo-discovery-history', JSON.stringify(updated))
    } catch (err) {
      console.error('Failed to start discovery:', err)
    }
  }

  const pauseDiscovery = async () => {
    try { await api.pauseDiscovery(); setState('paused') } catch (e) { console.error(e) }
  }

  const resumeDiscovery = async () => {
    try {
      await fetch('/api/v1/orchestrator/resume', { method: 'POST' })
      setState('running')
    } catch (e) { console.error(e) }
  }

  const stopDiscovery = async () => {
    try { await api.stopDiscovery(); setState('stopping') } catch (e) { console.error(e) }
  }

  const exportPdf = async (h: Hypothesis) => {
    try {
      const res = await fetch(`/api/v1/documents/hypothesis/${h.id}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: h.title, description: h.description, mechanism: h.mechanism,
          confidence: h.confidence, evidence_summary: h.evidence_summary,
          risks: h.risks, validation_steps: h.validation_steps,
          key_citations: h.key_citations, disease: config.disease,
          discovery_type: config.discovery_type,
        }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `${h.title.slice(0, 50)}.pdf`; a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) { console.error(e) }
  }

  const addFocusEntity = () => {
    if (!focusInput.trim()) return
    setConfig(prev => ({ ...prev, focus_entities: [...(prev.focus_entities || []), focusInput.trim()] }))
    setFocusInput('')
  }

  const removeFocusEntity = (entity: string) => {
    setConfig(prev => ({ ...prev, focus_entities: (prev.focus_entities || []).filter(e => e !== entity) }))
  }

  const addFactor = () => {
    if (!factorName.trim()) return
    setFactors(prev => [...prev, { name: factorName, category: factorCategory, interaction: factorInteraction }])
    setFactorName(''); setFactorInteraction('')
  }

  // Sort & filter hypotheses
  const sortedHypotheses = [...hypotheses]
    .filter(h => h.confidence >= filterConfidence)
    .sort((a, b) => {
      if (sortBy === 'novelty') return (b.novelty_score || 0) - (a.novelty_score || 0)
      if (sortBy === 'date') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      return b.confidence - a.confidence
    })

  const isRunning = state === 'running'
  const isPaused = state === 'paused'
  const isIdle = state === 'idle' || state === 'completed'

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Panel - Config & Stats */}
      <div className="w-80 flex flex-col border-r border-[var(--color-border)] overflow-hidden">
        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FiCpu className="w-4 h-4 text-[var(--color-text-muted)]" />
              <h2 className="text-sm font-medium">Discovery Engine</h2>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: connected ? 'var(--color-success)' : connected === false ? 'var(--color-error)' : 'var(--color-warning)' }} />
              <span className="text-xs text-[var(--color-text-muted)]">{connected ? 'Live' : connected === false ? 'Offline' : '...'}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {isIdle && (
              <button onClick={startDiscovery} disabled={!config.disease.trim()} className="btn flex-1 text-sm border border-[var(--color-border)] disabled:opacity-30" style={{ color: 'var(--color-success)' }}>
                <FiPlay className="w-4 h-4" /> Start
              </button>
            )}
            {isRunning && (
              <>
                <button onClick={pauseDiscovery} className="btn flex-1 text-sm" style={{ color: 'var(--color-warning)' }}>
                  <FiPause className="w-4 h-4" /> Pause
                </button>
                <button onClick={stopDiscovery} className="btn text-sm" style={{ color: 'var(--color-error)' }}>
                  <FiSquare className="w-4 h-4" /> Stop
                </button>
              </>
            )}
            {isPaused && (
              <>
                <button onClick={resumeDiscovery} className="btn flex-1 text-sm" style={{ color: 'var(--color-success)' }}>
                  <FiPlay className="w-4 h-4" /> Resume
                </button>
                <button onClick={stopDiscovery} className="btn text-sm" style={{ color: 'var(--color-error)' }}>
                  <FiSquare className="w-4 h-4" /> Stop
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Configuration */}
          <div className="border-b border-[var(--color-border)]">
            <button onClick={() => setShowConfig(!showConfig)} className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-[var(--glass-bg)] transition-all">
              <span className="flex items-center gap-2"><FiSettings className="w-4 h-4 text-[var(--color-text-muted)]" /> Configuration</span>
              {showConfig ? <FiChevronUp className="w-4 h-4" /> : <FiChevronDown className="w-4 h-4" />}
            </button>
            {showConfig && (
              <div className="px-4 pb-4 space-y-4 animate-slide-down">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1.5 block font-medium">Disease / Target *</label>
                  <input
                    type="text"
                    value={config.disease}
                    onChange={e => setConfig(prev => ({ ...prev, disease: e.target.value }))}
                    disabled={!isIdle}
                    placeholder="e.g., Pancreatic Cancer"
                    className="input w-full disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1.5 block font-medium">Discovery Type</label>
                  <select
                    value={config.discovery_type}
                    onChange={e => setConfig(prev => ({ ...prev, discovery_type: e.target.value as any }))}
                    disabled={!isIdle}
                    className="input w-full disabled:opacity-50"
                  >
                    {discoveryTypes.map(dt => (
                      <option key={dt.value} value={dt.value}>{dt.label}</option>
                    ))}
                  </select>
                  <p className="text-xxs text-[var(--color-text-muted)] mt-1">
                    {discoveryTypes.find(d => d.value === config.discovery_type)?.description}
                  </p>
                </div>

                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1.5 block font-medium">Focus Entities</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={focusInput}
                      onChange={e => setFocusInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addFocusEntity()}
                      disabled={!isIdle}
                      placeholder="e.g., KRAS, TP53"
                      className="input flex-1 text-xs disabled:opacity-50"
                    />
                    <button onClick={addFocusEntity} disabled={!isIdle || !focusInput.trim()} className="btn btn-sm disabled:opacity-30">
                      <FiPlus className="w-3 h-3" />
                    </button>
                  </div>
                  {(config.focus_entities || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {config.focus_entities!.map(e => (
                        <span key={e} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-[var(--glass-bg)] text-[var(--color-text-secondary)]">
                          {e}
                          {isIdle && <button onClick={() => removeFocusEntity(e)} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]"><FiX className="w-2.5 h-2.5" /></button>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1.5 flex justify-between font-medium">
                    <span>Min Confidence</span><span>{Math.round((config.min_confidence || 0.3) * 100)}%</span>
                  </label>
                  <input type="range" min="0.1" max="0.95" step="0.05" value={config.min_confidence} onChange={e => setConfig(prev => ({ ...prev, min_confidence: parseFloat(e.target.value) }))} disabled={!isIdle} className="w-full" />
                </div>

                {/* Research Guidance */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1.5 block font-medium">Research Guidance</label>
                  <textarea
                    value={config.research_guidance || ''}
                    onChange={e => setConfig(prev => ({ ...prev, research_guidance: e.target.value }))}
                    disabled={!isIdle}
                    placeholder="Add detailed guidance for the AI pipeline... e.g., focus on epigenetic mechanisms, prioritize FDA-approved compounds, explore immunotherapy combinations..."
                    rows={4}
                    className="input w-full text-xs disabled:opacity-50 resize-none"
                  />
                  <p className="text-xxs text-[var(--color-text-muted)] mt-1">
                    Provide specific instructions to guide hypothesis generation
                  </p>
                </div>

                {/* External Factors */}
                <div>
                  <button onClick={() => setShowFactors(!showFactors)} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    {showFactors ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />}
                    External Factors ({factors.length})
                  </button>
                  {showFactors && (
                    <div className="mt-2 space-y-2 animate-slide-down">
                      <input type="text" value={factorName} onChange={e => setFactorName(e.target.value)} placeholder="Factor name" disabled={!isIdle} className="input w-full text-xs disabled:opacity-50" />
                      <div className="flex gap-1">
                        <select value={factorCategory} onChange={e => setFactorCategory(e.target.value as any)} disabled={!isIdle} className="input flex-1 text-xs disabled:opacity-50">
                          {factorCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button onClick={addFactor} disabled={!isIdle || !factorName.trim()} className="btn btn-sm disabled:opacity-30"><FiPlus className="w-3 h-3" /></button>
                      </div>
                      <input type="text" value={factorInteraction} onChange={e => setFactorInteraction(e.target.value)} placeholder="Known interactions (optional)" disabled={!isIdle} className="input w-full text-xs disabled:opacity-50" />
                      {factors.map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-[var(--glass-bg)]">
                          <span><span className="font-medium">{f.name}</span> <span className="text-[var(--color-text-muted)]">({f.category})</span></span>
                          {isIdle && <button onClick={() => setFactors(prev => prev.filter((_, j) => j !== i))} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]"><FiX className="w-3 h-3" /></button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Live Stats */}
          {stats && (isRunning || isPaused) && (
            <div className="p-4 border-b border-[var(--color-border)] space-y-3">
              <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Live Statistics</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Agents', value: stats.total_agents, color: 'var(--color-text)' },
                  { label: 'Active', value: stats.active_agents, color: 'var(--color-success)' },
                  { label: 'Paths', value: stats.paths_explored, color: 'var(--color-text)' },
                  { label: 'Found', value: stats.hypotheses_found, color: 'var(--color-accent-purple)' },
                ].map(s => (
                  <div key={s.label} className="p-2.5 rounded-lg bg-[var(--glass-bg)]">
                    <div className="text-xxs text-[var(--color-text-muted)]">{s.label}</div>
                    <div className="text-lg font-semibold" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {stats.current_round !== undefined && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-muted)]">Round {stats.current_round}/{stats.total_rounds}</span>
                  <span className="text-[var(--color-text-muted)]">{stats.high_confidence_discoveries} high conf.</span>
                </div>
              )}

              {/* Model distribution */}
              {stats.agents_by_model && Object.keys(stats.agents_by_model).length > 0 && (
                <div>
                  <div className="text-xxs text-[var(--color-text-muted)] mb-2">Agents by Model</div>
                  <div className="h-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={Object.entries(stats.agents_by_model).map(([name, count]) => ({ name: name.split('-')[0], count }))}>
                        <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                        <Bar dataKey="count" fill="var(--color-accent-blue)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {stats.learning_stats && (
                <div>
                  <div className="text-xxs text-[var(--color-text-muted)] mb-1">Learning</div>
                  <div className="flex gap-2 text-xs">
                    <span>{stats.learning_stats.total_explored} explored</span>
                    <span style={{ color: 'var(--color-success)' }}>{stats.learning_stats.high_value_paths} high</span>
                    <span style={{ color: 'var(--color-error)' }}>{stats.learning_stats.low_value_paths} low</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Discovery History */}
          <div className="border-b border-[var(--color-border)]">
            <button onClick={() => setShowHistory(!showHistory)} className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-[var(--glass-bg)] transition-all">
              <span className="flex items-center gap-2"><FiClock className="w-4 h-4 text-[var(--color-text-muted)]" /> History ({discoveryHistory.length})</span>
              {showHistory ? <FiChevronUp className="w-4 h-4" /> : <FiChevronDown className="w-4 h-4" />}
            </button>
            {showHistory && (
              <div className="px-4 pb-4 space-y-2 animate-slide-down max-h-64 overflow-y-auto">
                {discoveryHistory.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] py-2">No discovery runs yet</p>
                ) : discoveryHistory.map(run => (
                  <div key={run.id} className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{run.disease}</span>
                      <span className="text-[var(--color-text-muted)]">{run.discoveryType}</span>
                    </div>
                    <div className="flex items-center justify-between text-xxs text-[var(--color-text-muted)] mt-1">
                      <span>{new Date(run.timestamp).toLocaleDateString()}</span>
                      <span>{run.hypothesesCount} hypotheses</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Center - Hypotheses */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Discovery</h1>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
                {isRunning ? 'Discovery in progress...' : isPaused ? 'Discovery paused' : state === 'completed' ? 'Discovery complete' : `${hypotheses.length} hypotheses discovered`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {projectId && projectId !== 'discovery' && (
                <Link
                  to={`/projects/${projectId}`}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--glass-bg-hover)] transition-all"
                  style={{ color: 'var(--color-accent-blue)' }}
                >
                  <FiFolder className="w-3.5 h-3.5" />
                  View in Project
                  <FiExternalLink className="w-3 h-3" />
                </Link>
              )}
              {isRunning && (
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ color: 'var(--color-success)', background: 'rgba(34, 197, 94, 0.08)' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" /> Running
                </span>
              )}
            </div>
          </div>

          {/* Sort & Filter */}
          {hypotheses.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5 bg-[var(--glass-bg)] rounded-lg p-0.5">
                {[
                  { value: 'confidence', label: 'Confidence' },
                  { value: 'novelty', label: 'Novelty' },
                  { value: 'date', label: 'Recent' },
                ].map(s => (
                  <button
                    key={s.value}
                    onClick={() => setSortBy(s.value as any)}
                    className={`px-3 py-1.5 text-xs rounded-md transition-all ${sortBy === s.value ? 'bg-[var(--glass-bg-hover)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <span>Min: {Math.round(filterConfidence * 100)}%</span>
                <input type="range" min="0" max="0.9" step="0.1" value={filterConfidence} onChange={e => setFilterConfidence(parseFloat(e.target.value))} className="w-20" />
              </div>
              <span className="text-xs text-[var(--color-text-muted)] ml-auto">{sortedHypotheses.length} results</span>
            </div>
          )}
        </div>

        {/* Hypothesis List */}
        <div className="flex-1 overflow-y-auto p-4">
          {hypotheses.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
              <FiTarget className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">No hypotheses yet</p>
              <p className="text-xs mt-1">Configure a disease target and start discovery</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedHypotheses.map(h => (
                <button
                  key={h.id}
                  onClick={() => { setSelectedHypothesis(h); setShowCompare(false) }}
                  className={`w-full text-left glass-card p-4 transition-all group ${selectedHypothesis?.id === h.id ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg-hover)]' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg flex-shrink-0" style={{ background: `${confidenceColor(h.confidence)}12` }}>
                      <FiZap className="w-4 h-4" style={{ color: confidenceColor(h.confidence) }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium line-clamp-2">{h.title}</h3>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-medium" style={{ color: confidenceColor(h.confidence) }}>
                            {Math.round(h.confidence * 100)}%
                          </span>
                          {h.novelty_score !== undefined && (
                            <span className="text-xxs text-[var(--color-text-muted)]">N:{Math.round(h.novelty_score * 100)}%</span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{h.description}</p>
                      <div className="flex items-center gap-3 mt-2 text-xxs text-[var(--color-text-muted)]">
                        {h.evidence_summary && <span>{h.evidence_summary.length} evidence</span>}
                        {h.risks && <span>{h.risks.length} risks</span>}
                        {h.round_number && <span>Round {h.round_number}</span>}
                        <button
                          onClick={e => { e.stopPropagation(); setCompareHypothesis(h); setShowCompare(true) }}
                          className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-[var(--color-accent-blue)] transition-opacity"
                          title="Compare"
                        >
                          <FiColumns className="w-3 h-3" /> Compare
                        </button>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Detail/Compare */}
      {(selectedHypothesis || showCompare) && (
        <div className="w-96 border-l border-[var(--color-border)] overflow-y-auto">
          {showCompare && selectedHypothesis && compareHypothesis ? (
            <ComparisonView a={selectedHypothesis} b={compareHypothesis} onClose={() => setShowCompare(false)} />
          ) : selectedHypothesis ? (
            <HypothesisDetail hypothesis={selectedHypothesis} onClose={() => setSelectedHypothesis(null)} onExport={() => exportPdf(selectedHypothesis)} />
          ) : null}
        </div>
      )}
    </div>
  )
}

// ── Hypothesis Detail ───────────────────────────────────────────

function HypothesisDetail({ hypothesis: h, onClose, onExport }: { hypothesis: Hypothesis; onClose: () => void; onExport: () => void }) {
  return (
    <div className="animate-slide-up">
      <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FiAward className="w-4 h-4" style={{ color: confidenceColor(h.confidence) }} />
          <span className="text-sm font-semibold" style={{ color: confidenceColor(h.confidence) }}>{Math.round(h.confidence * 100)}% confidence</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onExport} className="btn btn-sm" title="Export PDF"><FiDownload className="w-3.5 h-3.5" /></button>
          <button onClick={onClose} className="btn btn-sm"><FiX className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <h2 className="text-lg font-semibold leading-tight">{h.title}</h2>
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{h.description}</p>

        {h.mechanism && (
          <div>
            <h4 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Mechanism</h4>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">{h.mechanism}</p>
          </div>
        )}

        {h.evidence_summary && h.evidence_summary.length > 0 && (
          <div>
            <h4 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Evidence ({h.evidence_summary.length})</h4>
            <div className="space-y-1.5">
              {h.evidence_summary.map((ev, i) => (
                <div key={i} className="text-xs text-[var(--color-text-secondary)] p-2.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] flex items-start gap-2">
                  <FiCheck className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent-blue)' }} />
                  <span>{ev}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {h.grounding_sources && (
          <div>
            <h4 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Grounding Sources</h4>
            <div className="flex flex-wrap gap-1.5">
              {h.grounding_sources.pubmed_count ? <span className="text-xxs px-2 py-1 rounded-md" style={{ color: 'var(--color-accent-green)', background: 'rgba(34,197,94,0.08)' }}>PubMed: {h.grounding_sources.pubmed_count}</span> : null}
              {h.grounding_sources.clinical_trials_count ? <span className="text-xxs px-2 py-1 rounded-md" style={{ color: 'var(--color-accent-cyan)', background: 'rgba(6,182,212,0.08)' }}>ClinicalTrials: {h.grounding_sources.clinical_trials_count}</span> : null}
              {h.grounding_sources.fda_count ? <span className="text-xxs px-2 py-1 rounded-md" style={{ color: 'var(--color-accent-orange)', background: 'rgba(249,115,22,0.08)' }}>FDA: {h.grounding_sources.fda_count}</span> : null}
              {h.grounding_sources.uniprot_count ? <span className="text-xxs px-2 py-1 rounded-md" style={{ color: 'var(--color-accent-purple)', background: 'rgba(168,85,247,0.08)' }}>UniProt: {h.grounding_sources.uniprot_count}</span> : null}
            </div>
          </div>
        )}

        {h.risks && h.risks.length > 0 && (
          <div>
            <h4 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Risks ({h.risks.length})</h4>
            <div className="space-y-1.5">
              {h.risks.map((risk, i) => (
                <div key={i} className="text-xs text-[var(--color-text-secondary)] p-2.5 rounded-lg border border-[var(--color-border)] flex items-start gap-2" style={{ borderColor: 'rgba(239,68,68,0.2)' }}>
                  <FiAlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-error)' }} />
                  <span>{risk}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {h.validation_steps && h.validation_steps.length > 0 && (
          <div>
            <h4 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Validation Steps</h4>
            <div className="space-y-1.5">
              {h.validation_steps.map((step, i) => (
                <div key={i} className="text-xs text-[var(--color-text-secondary)] p-2.5 rounded-lg bg-[var(--glass-bg)] flex items-start gap-2">
                  <span className="text-xxs font-semibold text-[var(--color-text-muted)] mt-0.5">{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Comparison View ─────────────────────────────────────────────

function ComparisonView({ a, b, onClose }: { a: Hypothesis; b: Hypothesis; onClose: () => void }) {
  return (
    <div className="animate-slide-up">
      <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2"><FiColumns className="w-4 h-4" /> Comparison</h3>
        <button onClick={onClose} className="btn btn-sm"><FiX className="w-3.5 h-3.5" /></button>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {/* Confidence comparison */}
        <div className="p-4">
          <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-3 font-medium">Confidence</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center p-3 rounded-lg bg-[var(--glass-bg)]">
              <div className="text-2xl font-bold" style={{ color: confidenceColor(a.confidence) }}>{Math.round(a.confidence * 100)}%</div>
              <div className="text-xxs text-[var(--color-text-muted)] mt-1">Hypothesis A</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-[var(--glass-bg)]">
              <div className="text-2xl font-bold" style={{ color: confidenceColor(b.confidence) }}>{Math.round(b.confidence * 100)}%</div>
              <div className="text-xxs text-[var(--color-text-muted)] mt-1">Hypothesis B</div>
            </div>
          </div>
        </div>

        {/* Titles */}
        <div className="p-4">
          <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Hypotheses</div>
          <div className="space-y-2">
            <div className="p-3 rounded-lg bg-[var(--glass-bg)] border-l-2" style={{ borderColor: confidenceColor(a.confidence) }}>
              <div className="text-xxs text-[var(--color-text-muted)] mb-1">A</div>
              <p className="text-xs font-medium">{a.title}</p>
            </div>
            <div className="p-3 rounded-lg bg-[var(--glass-bg)] border-l-2" style={{ borderColor: confidenceColor(b.confidence) }}>
              <div className="text-xxs text-[var(--color-text-muted)] mb-1">B</div>
              <p className="text-xs font-medium">{b.title}</p>
            </div>
          </div>
        </div>

        {/* Metrics comparison */}
        <div className="p-4">
          <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Metrics</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--color-text-muted)]">
                <th className="text-left py-1">Metric</th>
                <th className="text-right py-1">A</th>
                <th className="text-right py-1">B</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="py-1">Confidence</td><td className="text-right">{Math.round(a.confidence * 100)}%</td><td className="text-right">{Math.round(b.confidence * 100)}%</td></tr>
              <tr><td className="py-1">Novelty</td><td className="text-right">{a.novelty_score ? Math.round(a.novelty_score * 100) + '%' : '-'}</td><td className="text-right">{b.novelty_score ? Math.round(b.novelty_score * 100) + '%' : '-'}</td></tr>
              <tr><td className="py-1">Evidence</td><td className="text-right">{a.evidence_summary?.length || 0}</td><td className="text-right">{b.evidence_summary?.length || 0}</td></tr>
              <tr><td className="py-1">Risks</td><td className="text-right">{a.risks?.length || 0}</td><td className="text-right">{b.risks?.length || 0}</td></tr>
              <tr><td className="py-1">Validation Steps</td><td className="text-right">{a.validation_steps?.length || 0}</td><td className="text-right">{b.validation_steps?.length || 0}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
