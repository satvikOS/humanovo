import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FiPlay,
  FiPause,
  FiSquare,
  FiRefreshCw,
  FiTarget,
  FiSettings,
  FiChevronDown,
  FiChevronUp,
  FiAward,
  FiFileText,
  FiPlus,
  FiX,
  FiDownload,
  FiSend,
} from 'react-icons/fi'
import clsx from 'clsx'
import { persistGet, persistSet, logActivity } from '../utils/persistence'

// Types
type OrchestratorState = 'idle' | 'running' | 'paused' | 'stopping' | 'completed'

interface OrchestratorStats {
  state: OrchestratorState
  total_agents: number
  active_agents: number
  hypotheses_found: number
  paths_explored: number
  high_confidence_discoveries: number
  current_best_confidence: number
  runtime_seconds: number
  current_round?: number
  total_rounds?: number
  agents_by_role: Record<string, number>
  agents_by_model?: Record<string, number>
  models_active?: string[]
  token_pool_stats?: {
    global_tokens_used: number
    requests_per_model: Record<string, number>
    errors_per_model: Record<string, number>
  }
  learning_stats: {
    total_explored: number
    low_value_paths: number
    high_value_paths: number
    avg_relation_score: number
  }
}

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
  created_at?: string
}

// Filter out malformed hypotheses (system messages, raw JSON, reasoning tags)
function isValidHypothesis(h: Hypothesis): boolean {
  if (!h.title || h.title.length < 10) return false
  if (h.title.startsWith('<reasoning>') || h.title.startsWith('<think>')) return false
  if (h.title.startsWith('```') || h.title.startsWith('{')) return false
  if (h.description?.startsWith('<reasoning>') || h.description?.startsWith('<think>')) return false
  if (!h.description || h.description.length < 50) return false
  return true
}

interface ExternalFactor {
  name: string
  category: 'nutrient' | 'chemical' | 'drug' | 'compound' | 'element'
  interaction: string
}

interface DiscoveryConfig {
  disease: string
  discoveryType: 'treatment' | 'prevention' | 'biomarker' | 'drug_repurposing' | 'combination_therapy'
  focusEntities: string[]
  maxAgents: number
  targetConfidence: number
  externalFactors: ExternalFactor[]
}

const discoveryTypes = [
  { value: 'treatment', label: 'Treatment Discovery', description: 'Find therapeutic strategies' },
  { value: 'prevention', label: 'Prevention Strategy', description: 'Prevent disease onset' },
  { value: 'biomarker', label: 'Biomarker Discovery', description: 'Early detection markers' },
  { value: 'drug_repurposing', label: 'Drug Repurposing', description: 'Existing drugs for new uses' },
  { value: 'combination_therapy', label: 'Combination Therapy', description: 'Synergistic drug combinations' },
]

const factorCategories = ['nutrient', 'chemical', 'drug', 'compound', 'element'] as const

const API_BASE = '/api/v1'

// Client-side research paper HTML generator — works without backend
function generateClientSidePaperHtml(
  hypotheses: Hypothesis[],
  disease: string,
  discoveryType: string,
): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const sortedHyps = [...hypotheses].sort((a, b) => b.confidence - a.confidence)
  const highConf = sortedHyps.filter(h => h.confidence >= 0.7)
  const avgConf = sortedHyps.length > 0 ? sortedHyps.reduce((s, h) => s + h.confidence, 0) / sortedHyps.length : 0

  const hypothesisSections = sortedHyps.map((h, i) => `
    <div class="hypothesis" style="page-break-inside:avoid;margin-bottom:28px;padding:20px;border:1px solid #e5e7eb;border-radius:8px;${h.confidence >= 0.7 ? 'border-left:4px solid #22c55e' : h.confidence >= 0.5 ? 'border-left:4px solid #eab308' : 'border-left:4px solid #f97316'}">
      <h3 style="margin:0 0 8px;color:#1a1a2e;font-size:16px">Hypothesis ${i + 1}: ${h.title}</h3>
      <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
        <span class="badge ${h.confidence >= 0.7 ? 'badge-high' : h.confidence >= 0.5 ? 'badge-med' : 'badge-low'}">${(h.confidence * 100).toFixed(1)}% Confidence</span>
        ${h.validated ? '<span class="badge badge-high">Validated</span>' : ''}
      </div>
      <p style="color:#374151;line-height:1.7;text-align:justify">${h.description}</p>
      ${h.mechanism ? `<div style="margin-top:12px"><strong style="color:#1a1a2e">Mechanism of Action:</strong><p style="color:#4b5563;line-height:1.6;margin-top:4px">${h.mechanism}</p></div>` : ''}
      ${h.evidence_summary && h.evidence_summary.length > 0 ? `<div style="margin-top:12px"><strong style="color:#1a1a2e">Supporting Evidence:</strong><ul style="color:#4b5563;margin-top:4px">${h.evidence_summary.map(e => `<li>${e}</li>`).join('')}</ul></div>` : ''}
      ${h.risks && h.risks.length > 0 ? `<div style="margin-top:12px"><strong style="color:#b91c1c">Risks & Limitations:</strong><ul style="color:#dc2626;margin-top:4px">${h.risks.map(r => `<li>${r}</li>`).join('')}</ul></div>` : ''}
    </div>
  `).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Research Paper: ${disease} — ${discoveryType}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: 'Georgia', 'Times New Roman', serif; color: #1a1a2e; line-height: 1.7; max-width: 900px; margin: 0 auto; padding: 40px; }
  .cover { text-align: center; padding: 80px 20px 50px; border-bottom: 3px double #333; margin-bottom: 40px; page-break-after: always; }
  .cover h1 { font-size: 28px; margin-bottom: 12px; }
  .cover .subtitle { font-size: 18px; color: #6b7280; margin-bottom: 24px; }
  .cover .meta { color: #9ca3af; font-size: 13px; line-height: 2; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge-high { background: #dcfce7; color: #166534; }
  .badge-med { background: #fef9c3; color: #854d0e; }
  .badge-low { background: #fed7aa; color: #9a3412; }
  h2 { font-size: 20px; color: #1a1a2e; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-top: 36px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
  th { background: #f3f4f6; padding: 10px; text-align: left; border: 1px solid #e5e7eb; }
  td { padding: 10px; border: 1px solid #e5e7eb; }
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
  .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 700; color: #1a1a2e; }
  .stat-label { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 2px solid #e5e7eb; color: #9ca3af; font-size: 11px; text-align: center; }
</style></head><body>

<div class="cover">
  <h1>AI-Generated Research Paper</h1>
  <div class="subtitle">${disease} — ${discoveryType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Discovery</div>
  <div class="meta">
    <p>Generated by Humanovo Multi-Model AI Discovery Platform</p>
    <p>${date}</p>
    <p>${sortedHyps.length} Hypotheses &bull; ${highConf.length} High-Confidence Discoveries</p>
    <p>Average Confidence: ${(avgConf * 100).toFixed(1)}%</p>
  </div>
</div>

<h2>Executive Summary</h2>
<p>This research paper presents ${sortedHyps.length} AI-generated hypotheses for ${disease} ${discoveryType.replace(/_/g, ' ')} discovery,
produced by Humanovo's multi-model parallel AI pipeline. Of these, ${highConf.length} hypotheses achieved high confidence scores (&ge;70%),
with the strongest hypothesis reaching ${sortedHyps[0] ? (sortedHyps[0].confidence * 100).toFixed(1) : 0}% confidence.</p>

<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${sortedHyps.length}</div>
    <div class="stat-label">Total Hypotheses</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${highConf.length}</div>
    <div class="stat-label">High Confidence (&ge;70%)</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${(avgConf * 100).toFixed(1)}%</div>
    <div class="stat-label">Average Confidence</div>
  </div>
</div>

<h2>Hypothesis Summary Table</h2>
<table>
  <thead><tr><th>#</th><th>Hypothesis</th><th>Confidence</th><th>Validated</th></tr></thead>
  <tbody>
    ${sortedHyps.map((h, i) => `<tr>
      <td>${i + 1}</td>
      <td>${h.title}</td>
      <td><span class="badge ${h.confidence >= 0.7 ? 'badge-high' : h.confidence >= 0.5 ? 'badge-med' : 'badge-low'}">${(h.confidence * 100).toFixed(1)}%</span></td>
      <td>${h.validated ? '✓' : '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>

<h2>Detailed Hypotheses</h2>
${hypothesisSections}

<div class="footer">
  <p>Humanovo &mdash; AI-Powered Biomedical Discovery Platform</p>
  <p>Generated on ${date} &bull; ${sortedHyps.length} hypotheses analyzed</p>
  <p style="margin-top:8px;font-style:italic">This paper is AI-generated and should be validated by domain experts before clinical application.</p>
</div>
</body></html>`
}

// Auto-generate tags from hypothesis content
function generateHypothesisTags(hypothesis: Hypothesis, disease: string, discoveryType: string): string[] {
  const tags: string[] = []
  if (disease) tags.push(disease.toLowerCase())
  tags.push(discoveryType)
  if (hypothesis.confidence >= 0.8) tags.push('high-confidence')
  else if (hypothesis.confidence >= 0.6) tags.push('medium-confidence')
  else tags.push('low-confidence')
  if (hypothesis.validated) tags.push('validated')
  if (hypothesis.external_factors && hypothesis.external_factors.length > 0) tags.push('external-factors')
  // Extract keywords from title
  const keywords = (hypothesis.title || '').toLowerCase().split(/\s+/)
  const bioTerms = ['gene', 'protein', 'pathway', 'receptor', 'inhibitor', 'mutation', 'therapy', 'immune', 'target', 'compound', 'enzyme', 'kinase', 'antibody', 'biomarker']
  for (const word of keywords) {
    if (bioTerms.some(t => word.includes(t)) && !tags.includes(word)) tags.push(word)
  }
  return tags.slice(0, 8)
}

// Save hypothesis to project library
function saveHypothesisToProject(hypothesis: Hypothesis, disease: string, discoveryType: string) {
  // Get existing projects
  const projects = persistGet<Array<{
    id: string; name: string; description?: string; disease_focus?: string;
    research_question?: string; tags: string[]; hypothesis_count: number;
    evidence_count: number; status: string; created_at: string; updated_at: string;
  }>>('projects', [])

  // Find or create project for this disease
  let project = projects.find(p => p.disease_focus?.toLowerCase() === disease.toLowerCase())
  if (!project) {
    project = {
      id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${disease} — ${discoveryType.charAt(0).toUpperCase() + discoveryType.slice(1)} Research`,
      description: `AI-driven ${discoveryType} discovery for ${disease}. Hypotheses generated by humanovo's multi-model parallel agent system.`,
      disease_focus: disease,
      research_question: `What are the most promising ${discoveryType} approaches for ${disease}?`,
      tags: [disease.toLowerCase(), discoveryType, 'ai-generated'],
      hypothesis_count: 0,
      evidence_count: 0,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    projects.unshift(project)
    logActivity({ type: 'project', action: 'created', title: `Auto-created project: ${project.name}`, metadata: { source: 'discovery' } })
  }

  // Get existing saved hypotheses
  const savedHypotheses = persistGet<Array<{
    id: string; title: string; description: string; mechanism: string;
    confidence: number; tags: string[]; disease: string; discovery_type: string;
    project_id: string; created_at: string;
  }>>('hypotheses', [])

  // Check if this hypothesis is already saved
  if (savedHypotheses.some(h => h.id === hypothesis.id)) return

  // Save hypothesis with AI-filled metadata
  const tags = generateHypothesisTags(hypothesis, disease, discoveryType)
  savedHypotheses.unshift({
    id: hypothesis.id,
    title: hypothesis.title,
    description: hypothesis.description,
    mechanism: hypothesis.mechanism,
    confidence: hypothesis.confidence,
    tags,
    disease,
    discovery_type: discoveryType,
    project_id: project.id,
    created_at: hypothesis.created_at || new Date().toISOString(),
  })

  // Update project counts
  project.hypothesis_count = savedHypotheses.filter(h => h.project_id === project.id).length
  project.updated_at = new Date().toISOString()

  // Persist
  persistSet('hypotheses', savedHypotheses.slice(0, 200))
  persistSet('projects', projects)
  logActivity({
    type: 'hypothesis',
    action: 'created',
    title: `Discovered: ${hypothesis.title}`,
    project: project.name,
    metadata: { confidence: hypothesis.confidence, disease, tags },
  })
}

export default function Agents() {
  // Orchestrator state
  const [state, setState] = useState<OrchestratorState>('idle')
  const [stats, setStats] = useState<OrchestratorStats | null>(null)
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [selectedHypothesis, setSelectedHypothesis] = useState<Hypothesis | null>(null)

  // AI pipeline connection status (real check, not mock)
  const [aiConnected, setAiConnected] = useState<boolean | null>(null)
  const [connectedAgents, setConnectedAgents] = useState(0)
  const [totalAgents, setTotalAgents] = useState(8)

  // Paper generation
  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [generatingPaperId, setGeneratingPaperId] = useState<string | null>(null)
  const [paperMarkdown, setPaperMarkdown] = useState<string | null>(null)
  const [, setPaperHypothesisTitle] = useState<string>('')
  const [paperError, setPaperError] = useState<string | null>(null)
  const [paperPhase, setPaperPhase] = useState(0)
  const paperPhaseRef = useRef<number | null>(null)

  // Configuration
  const [config, setConfig] = useState<DiscoveryConfig>({
    disease: '',
    discoveryType: 'treatment',
    focusEntities: [],
    maxAgents: 1000,
    targetConfidence: 0.95,
    externalFactors: [],
  })
  const [focusEntityInput, setFocusEntityInput] = useState('')
  const [showConfig, setShowConfig] = useState(true)
  const [showFactors, setShowFactors] = useState(false)

  // External factor input
  const [factorName, setFactorName] = useState('')
  const [factorCategory, setFactorCategory] = useState<ExternalFactor['category']>('nutrient')
  const [factorInteraction, setFactorInteraction] = useState('')

  // Polling ref for persistent updates
  const pollRef = useRef<number | null>(null)
  const failCountRef = useRef(0)
  const paperPollRef = useRef<number | null>(null)

  // Fetch status from backend (real connection check)
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/orchestrator/status`)
      if (response.ok) {
        failCountRef.current = 0
        setAiConnected(true)
        // Restore fast polling when backend comes back online
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = window.setInterval(fetchStatus, 3000)
        }
        try {
          const data = await response.json()
          const newState = data.state || 'idle'
          setState(prev => {
            if ((prev === 'running' || prev === 'paused' || prev === 'stopping') && newState === 'idle' && hypotheses.length > 0) {
              setHypotheses([])
            }
            return newState
          })
          if (data.stats) {
            setStats(data.stats)
            const currentRound = data.stats.current_round || 0
            const totalRounds = data.stats.total_rounds || 0
            if (totalRounds > 0 && currentRound >= totalRounds && newState === 'running') {
              fetch(`${API_BASE}/orchestrator/stop`, { method: 'POST' }).catch(() => {})
            }
          }
          if (data.top_hypotheses && data.top_hypotheses.length > 0) {
            setHypotheses(prev => {
              const existingIds = new Set(prev.map(h => h.id))
              const incoming = data.top_hypotheses
                .filter((h: Hypothesis) => !existingIds.has(h.id))
                .filter(isValidHypothesis)
              if (incoming.length === 0) return prev
              for (const h of incoming) {
                saveHypothesisToProject(h, config.disease, config.discoveryType)
              }
              return [...incoming, ...prev].sort((a: Hypothesis, b: Hypothesis) => b.confidence - a.confidence).slice(0, 100)
            })
          }
        } catch {
          // Body parse failed but connection is still alive (200 OK)
        }
      } else {
        failCountRef.current++
        if (failCountRef.current >= 2) {
          setAiConnected(false)
          // Slow down polling when backend is down — stop flooding 500 errors
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = window.setInterval(fetchStatus, 30000)
          }
        }
      }
    } catch {
      failCountRef.current++
      if (failCountRef.current >= 2) {
        setAiConnected(false)
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = window.setInterval(fetchStatus, 30000)
        }
      }
    }
  }, [config.disease, config.discoveryType])

  // Check AI health on mount (returns connected count, never model names)
  // Retries up to 3 times on failure (Lambda cold starts take time)
  useEffect(() => {
    let retries = 0
    const maxRetries = 3
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_BASE}/orchestrator/health`)
        if (response.ok) {
          const data = await response.json()
          const count = data.connected_count || 0
          setConnectedAgents(count)
          setTotalAgents(data.total_models || 8)
          setAiConnected(count > 0)
          retries = 0
        } else {
          retries++
          if (retries >= maxRetries) setAiConnected(false)
          // else keep aiConnected as null (yellow/loading)
        }
      } catch {
        retries++
        if (retries >= maxRetries) setAiConnected(false)
      }
    }
    checkHealth()
    // Re-check health every 20 seconds
    const healthInterval = window.setInterval(checkHealth, 20000)
    return () => clearInterval(healthInterval)
  }, [])

  // On mount, check if paper generation is still running (persists across navigation)
  useEffect(() => {
    const resumePaperPoll = async () => {
      try {
        const res = await fetch(`${API_BASE}/orchestrator/paper-status`)
        if (!res.ok) return
        const data = await res.json()
        if (data.status === 'generating') {
          // Paper gen is still running — resume the polling UI
          setGeneratingPaper(true)
          if (paperPollRef.current) clearInterval(paperPollRef.current)
          paperPollRef.current = window.setInterval(async () => {
            try {
              const statusRes = await fetch(`${API_BASE}/orchestrator/paper-status`)
              if (!statusRes.ok) return
              const d = await statusRes.json()
              if (d.status === 'done' && d.paper_html) {
                if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
                setPaperMarkdown(d.paper_html)
                setGeneratingPaper(false)
                setGeneratingPaperId(null)
              } else if (d.status === 'failed' || d.status === 'idle') {
                if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
                if (d.status === 'failed') alert(`Paper generation failed: ${d.error || 'Unknown error'}`)
                setGeneratingPaper(false)
                setGeneratingPaperId(null)
              }
            } catch { /* poll error, keep trying */ }
          }, 4000)
        } else if (data.status === 'done' && data.paper_html) {
          setPaperMarkdown(data.paper_html)
        }
      } catch { /* no paper status available */ }
    }
    resumePaperPoll()
  }, [])

  // Poll for updates — persists across navigation (backend keeps running)
  useEffect(() => {
    fetchStatus()

    // Poll every 3s to keep state in sync with backend
    pollRef.current = window.setInterval(fetchStatus, 3000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (paperPollRef.current) clearInterval(paperPollRef.current)
      if (paperPhaseRef.current) clearInterval(paperPhaseRef.current)
    }
  }, [fetchStatus])

  // Control functions
  const startDiscovery = useCallback(async () => {
    if (!config.disease.trim()) {
      alert('Please enter a disease to research')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/orchestrator/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disease: config.disease,
          focus_entities: config.focusEntities,
          discovery_type: config.discoveryType,
          max_agents: config.maxAgents,
          target_confidence: config.targetConfidence,
          external_factors: config.externalFactors,
        }),
      })

      if (response.ok) {
        setState('running')
        setShowConfig(false)
        setHypotheses([])
        setPaperMarkdown(null)
        logActivity({
          type: 'discovery',
          action: 'started',
          title: `Started ${config.discoveryType} discovery for ${config.disease}`,
          metadata: { disease: config.disease, discoveryType: config.discoveryType },
        })
      } else {
        let detail = `Server error (${response.status})`
        try {
          const error = await response.json()
          if (error.detail) detail = error.detail
          else if (error.message) detail = error.message
        } catch { /* non-JSON response */ }
        alert(`Failed to start: ${detail}`)
      }
    } catch (e) {
      console.error('Failed to start discovery:', e)
      alert('Failed to start discovery')
    }
  }, [config])

  const pauseDiscovery = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/orchestrator/pause`, { method: 'POST' })
      if (response.ok) setState('paused')
    } catch (e) {
      console.error('Failed to pause:', e)
    }
  }, [])

  const resumeDiscovery = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/orchestrator/resume`, { method: 'POST' })
      if (response.ok) setState('running')
    } catch (e) {
      console.error('Failed to resume:', e)
    }
  }, [])

  const stopDiscovery = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/orchestrator/stop`, { method: 'POST' })
      if (response.ok) setState('stopping')
    } catch (e) {
      console.error('Failed to stop:', e)
    }
  }, [])

  // Start phase animation for paper generation
  const startPaperPhaseAnimation = useCallback(() => {
    setPaperPhase(0)
    if (paperPhaseRef.current) clearInterval(paperPhaseRef.current)
    let phase = 0
    paperPhaseRef.current = window.setInterval(() => {
      phase++
      if (phase <= 4) {
        setPaperPhase(phase)
      }
    }, 8000) // Advance phase every 8 seconds
  }, [])

  const stopPaperPhaseAnimation = useCallback(() => {
    if (paperPhaseRef.current) { clearInterval(paperPhaseRef.current); paperPhaseRef.current = null }
  }, [])

  // Generate paper — tries backend first, falls back to client-side HTML generation
  const generatePaper = useCallback(async (hypothesisId?: string, hypothesisTitle?: string) => {
    setGeneratingPaper(true)
    setGeneratingPaperId(hypothesisId || null)
    setPaperHypothesisTitle(hypothesisTitle || config.disease)
    setPaperError(null)
    startPaperPhaseAnimation()

    // Helper: generate paper client-side from available hypotheses
    const generateClientSide = (hyps: Hypothesis[], singleId?: string) => {
      const targetHyps = singleId ? hyps.filter(h => h.id === singleId) : hyps
      if (targetHyps.length === 0) {
        stopPaperPhaseAnimation()
        setPaperError('No hypotheses available. Run a discovery first to generate hypotheses.')
        setGeneratingPaper(false)
        setGeneratingPaperId(null)
        return
      }
      // Run through full pipeline animation before showing result
      setTimeout(() => {
        const html = generateClientSidePaperHtml(targetHyps, config.disease || 'Research', config.discoveryType || 'treatment')
        stopPaperPhaseAnimation()
        setPaperMarkdown(html)
        setGeneratingPaper(false)
        setGeneratingPaperId(null)
        logActivity({
          type: 'evidence',
          action: 'created',
          title: `Generated research paper: ${config.disease || 'Discovery'} (client-side)`,
          metadata: { source: 'paper-generation', disease: config.disease },
        })
      }, 20000)
    }

    // Try backend first
    try {
      const endpoint = hypothesisId
        ? `${API_BASE}/documents/hypothesis/${hypothesisId}/html`
        : `${API_BASE}/orchestrator/generate-paper/markdown`

      const body = hypothesisId ? JSON.stringify({
        title: hypothesisTitle || hypotheses.find(h => h.id === hypothesisId)?.title || '',
        description: hypotheses.find(h => h.id === hypothesisId)?.description || '',
        mechanism: hypotheses.find(h => h.id === hypothesisId)?.mechanism || '',
        confidence: hypotheses.find(h => h.id === hypothesisId)?.confidence || 0,
        disease: config.disease || 'Unknown',
        discovery_type: config.discoveryType || 'treatment',
        model_used: 'multi-model',
        tags: [],
        external_factors: hypotheses.find(h => h.id === hypothesisId)?.external_factors || [],
      }) : undefined

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body } : {}),
      })

      if (response.ok) {
        // For hypothesis HTML endpoint, response is the HTML directly
        if (hypothesisId) {
          const htmlContent = await response.text()
          if (htmlContent && htmlContent.length > 100) {
            stopPaperPhaseAnimation()
            setPaperMarkdown(htmlContent)
            setGeneratingPaper(false)
            setGeneratingPaperId(null)
            return
          }
        }

        // For orchestrator markdown endpoint, poll for completion
        if (paperPollRef.current) clearInterval(paperPollRef.current)
        paperPollRef.current = window.setInterval(async () => {
          try {
            const statusRes = await fetch(`${API_BASE}/orchestrator/paper-status`)
            if (!statusRes.ok) return
            const data = await statusRes.json()
            if (data.status === 'done' && data.paper_html) {
              if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
              stopPaperPhaseAnimation()
              setPaperMarkdown(data.paper_html)
              setGeneratingPaper(false)
              setGeneratingPaperId(null)
            } else if (data.status === 'failed') {
              if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
              // Backend generation failed — fall back to client-side
              generateClientSide(hypotheses, hypothesisId)
            }
          } catch { /* poll error, keep trying */ }
        }, 4000)
        return
      }

      // Backend returned error — fall back to client-side generation
      generateClientSide(hypotheses, hypothesisId)

    } catch {
      // Backend unreachable — fall back to client-side generation
      generateClientSide(hypotheses, hypothesisId)
    }
  }, [config.disease, config.discoveryType, hypotheses, startPaperPhaseAnimation, stopPaperPhaseAnimation])

  const cancelPaper = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/orchestrator/cancel-paper`, { method: 'POST' })
    } catch { /* best effort */ }
    if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
    stopPaperPhaseAnimation()
    setGeneratingPaper(false)
    setGeneratingPaperId(null)
    setPaperError(null)
  }, [stopPaperPhaseAnimation])

  const addFocusEntity = useCallback(() => {
    if (focusEntityInput.trim() && !config.focusEntities.includes(focusEntityInput.trim())) {
      setConfig(prev => ({
        ...prev,
        focusEntities: [...prev.focusEntities, focusEntityInput.trim()],
      }))
      setFocusEntityInput('')
    }
  }, [focusEntityInput, config.focusEntities])

  const removeFocusEntity = useCallback((entity: string) => {
    setConfig(prev => ({
      ...prev,
      focusEntities: prev.focusEntities.filter(e => e !== entity),
    }))
  }, [])

  const addExternalFactor = useCallback(() => {
    if (factorName.trim()) {
      setConfig(prev => ({
        ...prev,
        externalFactors: [...prev.externalFactors, {
          name: factorName.trim(),
          category: factorCategory,
          interaction: factorInteraction.trim(),
        }],
      }))
      setFactorName('')
      setFactorInteraction('')
    }
  }, [factorName, factorCategory, factorInteraction])

  const removeExternalFactor = useCallback((index: number) => {
    setConfig(prev => ({
      ...prev,
      externalFactors: prev.externalFactors.filter((_, i) => i !== index),
    }))
  }, [])

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`
    if (mins > 0) return `${mins}m ${secs}s`
    return `${secs}s`
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-400'
    if (confidence >= 0.6) return 'text-yellow-400'
    if (confidence >= 0.4) return 'text-orange-400'
    return 'text-red-400'
  }

  const getStateColor = () => {
    switch (state) {
      case 'running': return 'bg-green-500'
      case 'paused': return 'bg-yellow-500'
      case 'stopping': return 'bg-orange-500'
      default: return 'bg-gray-500'
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={clsx('w-3 h-3 rounded-full', getStateColor())} />
            <div>
              <h1 className="text-xl font-semibold">Discovery</h1>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                10 parallel agents &middot; 8 models &middot; multi-model pipeline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* AI Pipeline Status */}
            <div className={clsx(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
              aiConnected === null ? 'bg-yellow-500/20 text-yellow-400' :
              aiConnected ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
            )}>
              <div className={clsx(
                'w-2 h-2 rounded-full',
                aiConnected === null ? 'bg-yellow-500 animate-pulse' :
                aiConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
              )} />
              {aiConnected === null ? 'Connecting...' :
               aiConnected ? `${connectedAgents}/${totalAgents} Models Connected` : 'Reconnecting...'}
            </div>

            {/* Control Buttons */}
            {(state === 'idle' || state === 'completed') && (
              <button
                onClick={startDiscovery}
                disabled={!config.disease.trim()}
                className="btn bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
              >
                <FiPlay className="w-4 h-4" />
                Start Discovery
              </button>
            )}

            {state === 'running' && (
              <>
                <button
                  onClick={pauseDiscovery}
                  className="btn bg-yellow-500 text-white hover:bg-yellow-600"
                >
                  <FiPause className="w-4 h-4" />
                  Pause
                </button>
                <button
                  onClick={stopDiscovery}
                  className="btn bg-red-500 text-white hover:bg-red-600"
                >
                  <FiSquare className="w-4 h-4" />
                  Stop
                </button>
              </>
            )}

            {state === 'paused' && (
              <>
                <button
                  onClick={resumeDiscovery}
                  className="btn bg-green-500 text-white hover:bg-green-600"
                >
                  <FiPlay className="w-4 h-4" />
                  Resume
                </button>
                <button
                  onClick={stopDiscovery}
                  className="btn bg-red-500 text-white hover:bg-red-600"
                >
                  <FiSquare className="w-4 h-4" />
                  Stop
                </button>
              </>
            )}

            {state === 'stopping' && (
              <div className="flex items-center gap-2 text-orange-400">
                <FiRefreshCw className="w-4 h-4 animate-spin" />
                Stopping...
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Configuration & Stats */}
        <div className="w-80 border-r border-[var(--color-border)] overflow-y-auto">
          {/* Configuration Section */}
          <div className="border-b border-[var(--color-border)]">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="w-full p-3 flex items-center justify-between hover:bg-[var(--color-bg)]"
            >
              <div className="flex items-center gap-2">
                <FiSettings className="w-4 h-4 text-[var(--color-text-muted)]" />
                <span className="text-sm font-medium">Configuration</span>
              </div>
              {showConfig ? <FiChevronUp className="w-4 h-4" /> : <FiChevronDown className="w-4 h-4" />}
            </button>

            {showConfig && (
              <div className="p-3 space-y-4">
                {/* Disease Input */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] block mb-1">
                    Target Disease
                  </label>
                  <input
                    type="text"
                    value={config.disease}
                    onChange={(e) => setConfig(prev => ({ ...prev, disease: e.target.value }))}
                    placeholder="e.g., Alzheimer's Disease"
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm"
                    disabled={state !== 'idle' && state !== 'completed'}
                  />
                </div>

                {/* Discovery Type */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] block mb-1">
                    Discovery Type
                  </label>
                  <select
                    value={config.discoveryType}
                    onChange={(e) => setConfig(prev => ({ ...prev, discoveryType: e.target.value as DiscoveryConfig['discoveryType'] }))}
                    className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm"
                    disabled={state !== 'idle' && state !== 'completed'}
                  >
                    {discoveryTypes.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                {/* Focus Entities */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] block mb-1">
                    Focus Entities (optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={focusEntityInput}
                      onChange={(e) => setFocusEntityInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addFocusEntity()}
                      placeholder="e.g., BRCA1, Amyloid-beta"
                      className="flex-1 px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-sm"
                      disabled={state !== 'idle' && state !== 'completed'}
                    />
                    <button
                      onClick={addFocusEntity}
                      className="btn btn-sm bg-[var(--color-border)]"
                      disabled={state !== 'idle' && state !== 'completed'}
                    >
                      Add
                    </button>
                  </div>
                  {config.focusEntities.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {config.focusEntities.map(entity => (
                        <span
                          key={entity}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-500/20 text-primary-400 rounded text-xs"
                        >
                          {entity}
                          <button
                            onClick={() => removeFocusEntity(entity)}
                            className="hover:text-red-400"
                            disabled={state !== 'idle' && state !== 'completed'}
                          >
                            <FiX className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* External Factors */}
                <div>
                  <button
                    onClick={() => setShowFactors(!showFactors)}
                    className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1"
                  >
                    {showFactors ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />}
                    External Factors ({config.externalFactors.length})
                  </button>

                  {showFactors && (
                    <div className="space-y-2 p-2 bg-[var(--color-bg)] rounded border border-[var(--color-border)]">
                      <input
                        type="text"
                        value={factorName}
                        onChange={(e) => setFactorName(e.target.value)}
                        placeholder="Factor name (e.g., Vitamin D)"
                        className="w-full px-2 py-1.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded text-xs"
                        disabled={state !== 'idle' && state !== 'completed'}
                      />
                      <select
                        value={factorCategory}
                        onChange={(e) => setFactorCategory(e.target.value as ExternalFactor['category'])}
                        className="w-full px-2 py-1.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded text-xs"
                        disabled={state !== 'idle' && state !== 'completed'}
                      >
                        {factorCategories.map(cat => (
                          <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={factorInteraction}
                        onChange={(e) => setFactorInteraction(e.target.value)}
                        placeholder="Known interaction (optional)"
                        className="w-full px-2 py-1.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded text-xs"
                        disabled={state !== 'idle' && state !== 'completed'}
                      />
                      <button
                        onClick={addExternalFactor}
                        className="btn btn-sm w-full bg-[var(--color-border)] text-xs"
                        disabled={(state !== 'idle' && state !== 'completed') || !factorName.trim()}
                      >
                        <FiPlus className="w-3 h-3" /> Add Factor
                      </button>

                      {config.externalFactors.length > 0 && (
                        <div className="space-y-1 mt-2 max-h-32 overflow-y-auto">
                          {config.externalFactors.map((factor, i) => (
                            <div key={i} className="flex items-center justify-between text-xs py-1 px-1.5 bg-[var(--color-bg-elevated)] rounded">
                              <span>
                                <span className="font-medium">{factor.name}</span>
                                <span className="text-[var(--color-text-muted)] ml-1">({factor.category})</span>
                              </span>
                              <button
                                onClick={() => removeExternalFactor(i)}
                                className="text-red-400 hover:text-red-300"
                                disabled={state !== 'idle' && state !== 'completed'}
                              >
                                <FiX className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Agent Count */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] block mb-1">
                    Max Agents: {config.maxAgents.toLocaleString()}
                    <span className="text-[var(--color-text-muted)] ml-1">
                      ({Math.floor(config.maxAgents / 10).toLocaleString()} per agent)
                    </span>
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="10000"
                    step="100"
                    value={config.maxAgents}
                    onChange={(e) => setConfig(prev => ({ ...prev, maxAgents: parseInt(e.target.value) }))}
                    className="w-full"
                    disabled={state !== 'idle' && state !== 'completed'}
                  />
                </div>

                {/* Target Confidence */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] block mb-1">
                    Target Confidence: {(config.targetConfidence * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="0.99"
                    step="0.01"
                    value={config.targetConfidence}
                    onChange={(e) => setConfig(prev => ({ ...prev, targetConfidence: parseFloat(e.target.value) }))}
                    className="w-full"
                    disabled={state !== 'idle' && state !== 'completed'}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Live Stats */}
          {stats && (
            <div className="p-3 border-b border-[var(--color-border)]">
              <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-3">
                Live Statistics
              </h3>

              <div className="grid grid-cols-2 gap-2">
                <div className="card p-2">
                  <div className="text-lg font-bold">{stats.total_agents.toLocaleString()}</div>
                  <div className="text-xxs text-[var(--color-text-muted)]">Total Agents</div>
                </div>
                <div className="card p-2">
                  <div className="text-lg font-bold text-green-400">{stats.active_agents}</div>
                  <div className="text-xxs text-[var(--color-text-muted)]">Active</div>
                </div>
                <div className="card p-2">
                  <div className="text-lg font-bold">{stats.paths_explored.toLocaleString()}</div>
                  <div className="text-xxs text-[var(--color-text-muted)]">Paths Explored</div>
                </div>
                <div className="card p-2">
                  <div className="text-lg font-bold text-purple-400">{stats.hypotheses_found}</div>
                  <div className="text-xxs text-[var(--color-text-muted)]">Hypotheses</div>
                </div>
              </div>

              {/* Per-Model Agent Distribution */}
              {stats.agents_by_model && Object.keys(stats.agents_by_model).length > 0 && (
                <div className="mt-3 card p-3">
                  <div className="text-xs text-[var(--color-text-muted)] mb-2">Agents Per Model</div>
                  <div className="space-y-1.5">
                    {Object.entries(stats.agents_by_model).map(([model, count]) => {
                      const modelNames: Record<string, string> = {
                        claude_opus: 'Claude Opus 4.6',
                        deepseek_r1_0528: 'DeepSeek-R1-0528',
                        mistral_large_3: 'Mistral-Large-3',
                        gpt_4o_azure: 'GPT-4o',
                        cohere_command_a: 'Cohere Command A',
                        kimi_k2_thinking: 'Kimi-K2-Thinking',
                        o3_mini: 'o3-mini',
                        gpt_41: 'GPT-4.1',
                      }
                      const modelColors: Record<string, string> = {
                        claude_opus: 'bg-orange-500',
                        deepseek_r1_0528: 'bg-teal-500',
                        mistral_large_3: 'bg-indigo-500',
                        gpt_4o_azure: 'bg-blue-500',
                        cohere_command_a: 'bg-pink-500',
                        kimi_k2_thinking: 'bg-purple-500',
                        o3_mini: 'bg-sky-500',
                        gpt_41: 'bg-emerald-500',
                      }
                      const pct = stats.total_agents > 0 ? (count / stats.total_agents) * 100 : 0
                      return (
                        <div key={model}>
                          <div className="flex justify-between text-xxs mb-0.5">
                            <span className="text-[var(--color-text-muted)]">{modelNames[model] || model}</span>
                            <span className="font-mono">{count.toLocaleString()}</span>
                          </div>
                          <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${modelColors[model] || 'bg-primary-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Best Confidence */}
              <div className="mt-3 card p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--color-text-muted)]">Best Confidence</span>
                  <span className={clsx('text-lg font-bold', getConfidenceColor(stats.current_best_confidence))}>
                    {(stats.current_best_confidence * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all duration-500',
                      stats.current_best_confidence >= 0.8 ? 'bg-green-500' :
                        stats.current_best_confidence >= 0.6 ? 'bg-yellow-500' :
                          stats.current_best_confidence >= 0.4 ? 'bg-orange-500' : 'bg-red-500'
                    )}
                    style={{ width: `${stats.current_best_confidence * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xxs text-[var(--color-text-muted)]">0%</span>
                  <span className="text-xxs text-[var(--color-text-muted)]">Target: {(config.targetConfidence * 100).toFixed(0)}%</span>
                </div>
              </div>

              {/* Runtime */}
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">Runtime</span>
                <span className="font-mono">{formatTime(stats.runtime_seconds)}</span>
              </div>

              {/* High Confidence Discoveries */}
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">High Confidence</span>
                <span className="text-green-400 font-bold">{stats.high_confidence_discoveries}</span>
              </div>
            </div>
          )}

          {/* Learning Stats */}
          {stats?.learning_stats && (
            <div className="p-3 border-b border-[var(--color-border)]">
              <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-3">
                Learning Progress
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Paths Learned</span>
                  <span>{stats.learning_stats.total_explored.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Low Value (skipped)</span>
                  <span className="text-red-400">{stats.learning_stats.low_value_paths}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">High Value</span>
                  <span className="text-green-400">{stats.learning_stats.high_value_paths}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Avg Score</span>
                  <span>{(stats.learning_stats.avg_relation_score * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main Content - Hypotheses or Paper */}
        <div className="flex-1 overflow-y-auto">
          {/* Global paper generation status bar */}
          {generatingPaper && !paperMarkdown && (
            <div className="mx-4 mt-4 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="relative w-8 h-8">
                    <div className="absolute inset-0 rounded-full border-2 border-secondary-700" />
                    <div className="absolute inset-0 rounded-full border-2 border-t-purple-500 animate-spin" />
                    <FiFileText className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-400" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-purple-300">
                      Generating Research Paper
                    </span>
                    <span className="text-purple-400/60 text-xs ml-2">
                      10-agent pipeline &middot; runs in the background
                    </span>
                  </div>
                </div>
                <button
                  onClick={cancelPaper}
                  className="text-xs px-3 py-1.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors flex items-center gap-1"
                >
                  <FiX className="w-3 h-3" />
                  Cancel
                </button>
              </div>
              {/* Phase progress with active step indicator */}
              <div className="flex items-center gap-2 text-xs mb-2">
                {[
                  'Phase 1: Abstract & Intro',
                  'Phase 2: Core Sections',
                  'Phase 3: Synthesis',
                  'Phase 4: QA Review',
                  'PDF Render',
                ].map((label, idx) => (
                  <span key={idx} className="flex items-center gap-1.5">
                    {idx > 0 && <span className="text-secondary-600">&rarr;</span>}
                    <span className={clsx(
                      'transition-colors',
                      idx < paperPhase ? 'text-green-400' :
                      idx === paperPhase ? 'text-purple-300 font-medium' : 'text-purple-300/40'
                    )}>
                      {idx < paperPhase ? '✓ ' : idx === paperPhase ? '● ' : ''}{label}
                    </span>
                  </span>
                ))}
              </div>
              <div className="h-1.5 bg-secondary-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${Math.min(((paperPhase + 1) / 5) * 100, 95)}%` }}
                />
              </div>
              <p className="text-xs text-purple-400/60 mt-1.5">
                Step {paperPhase + 1} of 5 &middot; This may take a few minutes
              </p>
            </div>
          )}

          {/* Paper generation error */}
          {paperError && !generatingPaper && !paperMarkdown && (
            <div className="mx-4 mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FiX className="w-5 h-5 text-red-400" />
                  <div>
                    <span className="text-sm font-medium text-red-300">Paper Generation Failed</span>
                    <p className="text-xs text-red-400/80 mt-0.5">{paperError}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => generatePaper()}
                    className="text-xs px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30 transition-colors flex items-center gap-1"
                  >
                    <FiRefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                  <button
                    onClick={() => setPaperError(null)}
                    className="text-xs px-3 py-1.5 bg-secondary-700 text-secondary-400 rounded hover:bg-secondary-600 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Paper View — rich HTML rendered in iframe */}
          {paperMarkdown ? (
            <div className="p-4 h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-[var(--color-text-muted)] uppercase">
                  Generated Research Paper
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      const res = await fetch(`${API_BASE}/orchestrator/generate-paper/pdf`, { method: 'POST' })
                      if (!res.ok) return
                      const data = await res.json()
                      const byteChars = atob(data.pdf_base64)
                      const byteArray = new Uint8Array(byteChars.length)
                      for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
                      const blob = new Blob([byteArray], { type: 'application/pdf' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = data.filename || `humanovo-${config.disease.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.pdf`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="btn btn-sm bg-red-500/20 text-red-400"
                  >
                    <FiDownload className="w-3.5 h-3.5" />
                    Download PDF
                  </button>
                  <button
                    onClick={() => setPaperMarkdown(null)}
                    className="btn btn-sm bg-[var(--color-border)]"
                  >
                    Back to Hypotheses
                  </button>
                </div>
              </div>

              {/* Rich HTML Paper in iframe */}
              <iframe
                srcDoc={paperMarkdown}
                className="flex-1 w-full rounded-lg border border-[var(--color-border)]"
                style={{ minHeight: '85vh' }}
                title="Research Paper"
                sandbox="allow-same-origin"
              />
            </div>
          ) : hypotheses.length > 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8">
              <div className="text-center space-y-4 max-w-md">
                <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                  <FiSend className="w-7 h-7 text-green-400" />
                </div>
                <h3 className="text-lg font-medium text-white">
                  {hypotheses.length} Hypotheses Discovered
                </h3>
                <p className="text-sm text-[var(--color-text-muted)]">
                  All hypotheses have been automatically saved to their project folder.
                  Select a hypothesis from the sidebar, or generate a full research paper.
                </p>
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => generatePaper()}
                    disabled={generatingPaper}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 transition-colors text-sm font-medium"
                  >
                    {generatingPaper ? (
                      <FiRefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <FiFileText className="w-4 h-4" />
                    )}
                    {generatingPaper ? 'Generating...' : 'Generate Research Paper'}
                  </button>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-xs text-green-400 bg-green-500/10 px-3 py-1.5 rounded-full">
                    Auto-saved to project
                  </span>
                  {state === 'running' && (
                    <span className="text-xs text-purple-400 bg-purple-500/10 px-3 py-1.5 rounded-full flex items-center gap-1">
                      <FiRefreshCw className="w-3 h-3 animate-spin" />
                      Discovery in progress...
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : state === 'running' || state === 'paused' ? (
            <div className="flex items-center justify-center h-full p-8">
              <div className="w-full max-w-lg space-y-8">
                {/* Animated Progress Ring */}
                <div className="flex flex-col items-center">
                  <div className="relative w-40 h-40 mb-4">
                    {/* Background ring */}
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-border)" strokeWidth="6" />
                      {/* Progress arc */}
                      <circle
                        cx="60" cy="60" r="52" fill="none"
                        stroke={state === 'paused' ? '#eab308' : '#8b5cf6'}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 52}`}
                        strokeDashoffset={`${2 * Math.PI * 52 * (1 - (stats ? (stats.current_round || 0) / Math.max(stats.total_rounds || 1, 1) : 0))}`}
                        className="transition-all duration-1000 ease-out"
                      />
                      {/* Animated sweep for running state */}
                      {state === 'running' && (
                        <circle
                          cx="60" cy="60" r="52" fill="none"
                          stroke="#8b5cf6"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 52 * 0.15} ${2 * Math.PI * 52 * 0.85}`}
                          className="animate-spin origin-center"
                          style={{ animationDuration: '2s' }}
                          opacity="0.4"
                        />
                      )}
                    </svg>
                    {/* Center text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold tabular-nums">
                        {stats ? Math.round(((stats.current_round || 0) / Math.max(stats.total_rounds || 1, 1)) * 100) : 0}%
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {state === 'paused' ? 'Paused' : stats ? `Round ${stats.current_round || 0}/${stats.total_rounds || '?'}` : 'Starting...'}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm font-medium">
                    {state === 'paused' ? 'Discovery Paused' : 'Agents Exploring...'}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    {config.disease} &middot; {config.discoveryType}
                  </p>
                </div>

                {/* Live Confidence Score */}
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Best Confidence</span>
                    <span className={clsx(
                      'text-2xl font-bold tabular-nums transition-all duration-500',
                      getConfidenceColor(stats?.current_best_confidence || 0)
                    )}>
                      {((stats?.current_best_confidence || 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-3 bg-[var(--color-border)] rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all duration-1000 ease-out',
                        (stats?.current_best_confidence || 0) >= 0.8 ? 'bg-green-500' :
                          (stats?.current_best_confidence || 0) >= 0.6 ? 'bg-yellow-500' :
                            (stats?.current_best_confidence || 0) >= 0.4 ? 'bg-orange-500' : 'bg-red-500'
                      )}
                      style={{ width: `${(stats?.current_best_confidence || 0) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-xxs text-[var(--color-text-muted)]">0%</span>
                    <span className="text-xxs text-[var(--color-text-muted)]">Target: {(config.targetConfidence * 100).toFixed(0)}%</span>
                  </div>
                </div>

                {/* Agent Activity Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {['Explorer', 'Reasoner', 'Synthesizer', 'Critic'].map((role, i) => (
                    <div key={role} className="card p-3 relative overflow-hidden">
                      {state === 'running' && (
                        <div
                          className="absolute inset-0 bg-purple-500/5 animate-pulse"
                          style={{ animationDelay: `${i * 0.3}s`, animationDuration: '2s' }}
                        />
                      )}
                      <div className="relative flex items-center gap-2">
                        <div className={clsx(
                          'w-2 h-2 rounded-full',
                          state === 'running' ? 'bg-green-500 animate-pulse' :
                            state === 'paused' ? 'bg-yellow-500' : 'bg-gray-500'
                        )} style={{ animationDelay: `${i * 0.2}s` }} />
                        <span className="text-xs font-medium">{role}</span>
                      </div>
                      <div className="relative text-xxs text-[var(--color-text-muted)] mt-1 ml-4">
                        {state === 'running' ? 'Analyzing...' : state === 'paused' ? 'Paused' : 'Idle'}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Live Counters */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="card p-3 text-center">
                    <div className="text-xl font-bold tabular-nums text-purple-400">
                      {stats?.hypotheses_found || 0}
                    </div>
                    <div className="text-xxs text-[var(--color-text-muted)]">Hypotheses</div>
                  </div>
                  <div className="card p-3 text-center">
                    <div className="text-xl font-bold tabular-nums">
                      {stats?.paths_explored?.toLocaleString() || 0}
                    </div>
                    <div className="text-xxs text-[var(--color-text-muted)]">Paths</div>
                  </div>
                  <div className="card p-3 text-center">
                    <div className="text-xl font-bold tabular-nums text-green-400">
                      {stats?.high_confidence_discoveries || 0}
                    </div>
                    <div className="text-xxs text-[var(--color-text-muted)]">High Conf.</div>
                  </div>
                </div>

                {/* Runtime */}
                {stats && (
                  <div className="text-center text-sm text-[var(--color-text-muted)]">
                    Runtime: <span className="font-mono">{formatTime(stats.runtime_seconds)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FiTarget className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
                <p className="text-[var(--color-text-muted)]">No hypotheses yet</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                  Configure and start a discovery to see results
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Hypothesis Detail */}
        {selectedHypothesis && !paperMarkdown && (
          <div className="w-96 border-l border-[var(--color-border)] overflow-y-auto">
            <div className="p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FiAward className={clsx(
                    'w-5 h-5',
                    getConfidenceColor(selectedHypothesis.confidence)
                  )} />
                  <span className={clsx(
                    'text-xl font-bold',
                    getConfidenceColor(selectedHypothesis.confidence)
                  )}>
                    {(selectedHypothesis.confidence * 100).toFixed(1)}%
                  </span>
                </div>
                <button
                  onClick={() => setSelectedHypothesis(null)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <FiX className="w-4 h-4" />
                </button>
              </div>

              <h3 className="text-lg font-semibold mb-2">{selectedHypothesis.title}</h3>

              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1">
                    Description
                  </h4>
                  <p className="text-sm">{selectedHypothesis.description}</p>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1">
                    Mechanism of Action
                  </h4>
                  <p className="text-sm leading-relaxed">{selectedHypothesis.mechanism || 'Not specified'}</p>
                </div>

                {selectedHypothesis.risks && selectedHypothesis.risks.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1">
                      Risks ({selectedHypothesis.risks.length})
                    </h4>
                    <div className="space-y-1">
                      {selectedHypothesis.risks.map((risk, i) => (
                        <div key={i} className="text-xs p-2 bg-red-500/10 border border-red-500/20 rounded leading-relaxed">
                          {risk}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedHypothesis.validation_steps && selectedHypothesis.validation_steps.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1">
                      Validation Steps ({selectedHypothesis.validation_steps.length})
                    </h4>
                    <div className="space-y-1">
                      {selectedHypothesis.validation_steps.map((step, i) => (
                        <div key={i} className="text-xs p-2 bg-yellow-500/10 border border-yellow-500/20 rounded leading-relaxed">
                          {i + 1}. {step}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedHypothesis.external_factors && selectedHypothesis.external_factors.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1">
                      External Factor Interactions
                    </h4>
                    <div className="space-y-1">
                      {selectedHypothesis.external_factors.map((factor, i) => (
                        <div key={i} className="text-xs p-1.5 bg-purple-500/10 border border-purple-500/20 rounded">
                          {typeof factor === 'string' ? factor : JSON.stringify(factor)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Per-Hypothesis Paper Generation & Export */}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => generatePaper(selectedHypothesis.id, selectedHypothesis.title)}
                    disabled={generatingPaper}
                    className="flex-1 btn bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50"
                  >
                    {generatingPaperId === selectedHypothesis.id ? (
                      <FiRefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <FiFileText className="w-4 h-4" />
                    )}
                    {generatingPaperId === selectedHypothesis.id ? 'Generating...' : 'Generate Paper'}
                  </button>
                  <button
                    onClick={async () => {
                      const res = await fetch(`${API_BASE}/documents/hypothesis/${selectedHypothesis.id}/pdf`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          title: selectedHypothesis.title,
                          description: selectedHypothesis.description,
                          mechanism: selectedHypothesis.mechanism,
                          confidence: selectedHypothesis.confidence,
                          disease: config.disease || 'Research',
                          discovery_type: config.discoveryType || 'treatment',
                        }),
                      })
                      if (res.ok) {
                        const data = await res.json()
                        const byteChars = atob(data.pdf_base64)
                        const byteArray = new Uint8Array(byteChars.length)
                        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
                        const blob = new Blob([byteArray], { type: 'application/pdf' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = data.filename || `humanovo-${selectedHypothesis.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.pdf`
                        a.click()
                        URL.revokeObjectURL(url)
                      }
                    }}
                    className="btn bg-green-500 text-white hover:bg-green-600"
                  >
                    <FiDownload className="w-4 h-4" />
                    Export PDF
                  </button>
                  {generatingPaper && generatingPaperId === selectedHypothesis.id && (
                    <button
                      onClick={cancelPaper}
                      className="btn bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                    >
                      <FiX className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
