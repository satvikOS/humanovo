import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FiSearch,
  FiZap,
  FiCheckCircle,
  FiAlertCircle,
  FiPlay,
  FiPause,
  FiSquare,
  FiRefreshCw,
  FiTarget,
  FiLayers,
  FiSettings,
  FiChevronDown,
  FiChevronUp,
  FiAward,
  FiFileText,
  FiPlus,
  FiX,
  FiDownload,
} from 'react-icons/fi'
import clsx from 'clsx'

// Types
type OrchestratorState = 'idle' | 'running' | 'paused' | 'stopping'
type AgentRole = 'explorer' | 'reasoner' | 'validator' | 'synthesizer' | 'critic'

interface OrchestratorStats {
  state: OrchestratorState
  total_agents: number
  active_agents: number
  hypotheses_found: number
  paths_explored: number
  high_confidence_discoveries: number
  current_best_confidence: number
  runtime_seconds: number
  agents_by_role: Record<string, number>
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
  model_used: string
  validated: boolean
  external_factors?: Array<Record<string, string>>
  created_at?: string
}

interface ExternalFactor {
  name: string
  category: 'nutrient' | 'chemical' | 'drug' | 'compound' | 'element'
  interaction: string
}

interface DiscoveryConfig {
  disease: string
  discoveryType: 'cure' | 'prevention' | 'treatment' | 'biomarker' | 'drug_repurposing'
  focusEntities: string[]
  maxAgents: number
  targetConfidence: number
  externalFactors: ExternalFactor[]
}

// Model configurations for display
const modelInfo = [
  { id: 'llama_maverick', name: 'Llama Maverick', color: 'bg-blue-500', desc: 'Fast exploration' },
  { id: 'deepseek_r1', name: 'DeepSeek R1', color: 'bg-yellow-500', desc: 'Deep reasoning' },
  { id: 'kimi_25', name: 'Kimi 2.5', color: 'bg-purple-500', desc: 'Long-context analysis' },
  { id: 'gpt_oss_120b', name: 'GPT OSS 120B', color: 'bg-green-500', desc: 'Large-parameter reasoning' },
]

const agentRoles = [
  {
    role: 'explorer' as AgentRole,
    name: 'Explorer Agents',
    description: 'Discover new biological connections and pathways',
    icon: FiSearch,
    color: 'text-blue-400 bg-blue-500/20',
    percentage: 40,
  },
  {
    role: 'reasoner' as AgentRole,
    name: 'Reasoner Agents',
    description: 'Deep logical analysis with DeepSeek R1',
    icon: FiZap,
    color: 'text-yellow-400 bg-yellow-500/20',
    percentage: 25,
  },
  {
    role: 'validator' as AgentRole,
    name: 'Validator Agents',
    description: 'Verify evidence quality and reliability',
    icon: FiCheckCircle,
    color: 'text-green-400 bg-green-500/20',
    percentage: 15,
  },
  {
    role: 'synthesizer' as AgentRole,
    name: 'Synthesizer Agents',
    description: 'Combine findings with Kimi 2.5 long context',
    icon: FiLayers,
    color: 'text-purple-400 bg-purple-500/20',
    percentage: 10,
  },
  {
    role: 'critic' as AgentRole,
    name: 'Critic Agents',
    description: 'Find flaws and potential failures',
    icon: FiAlertCircle,
    color: 'text-red-400 bg-red-500/20',
    percentage: 10,
  },
]

const discoveryTypes = [
  { value: 'cure', label: 'Cure Discovery', description: 'Find curative treatments' },
  { value: 'prevention', label: 'Prevention Strategy', description: 'Prevent disease onset' },
  { value: 'treatment', label: 'Treatment Options', description: 'Manage symptoms and progression' },
  { value: 'biomarker', label: 'Biomarker Discovery', description: 'Early detection markers' },
  { value: 'drug_repurposing', label: 'Drug Repurposing', description: 'Existing drugs for new uses' },
]

const factorCategories = ['nutrient', 'chemical', 'drug', 'compound', 'element'] as const

const API_BASE = '/api/v1'

export default function Agents() {
  // Orchestrator state
  const [state, setState] = useState<OrchestratorState>('idle')
  const [stats, setStats] = useState<OrchestratorStats | null>(null)
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [selectedHypothesis, setSelectedHypothesis] = useState<Hypothesis | null>(null)

  // Paper generation
  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [paperMarkdown, setPaperMarkdown] = useState<string | null>(null)

  // Configuration
  const [config, setConfig] = useState<DiscoveryConfig>({
    disease: '',
    discoveryType: 'cure',
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

  // WebSocket connection
  const wsRef = useRef<WebSocket | null>(null)
  const [wsConnected, setWsConnected] = useState(false)

  // Connect to WebSocket for real-time updates
  useEffect(() => {
    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}${API_BASE}/orchestrator/ws`)

      ws.onopen = () => {
        setWsConnected(true)
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          switch (message.type) {
            case 'initial_state':
              setState(message.data.state)
              if (message.data.stats) {
                setStats(message.data.stats)
              }
              break

            case 'stats':
              setStats(message.data)
              break

            case 'hypothesis':
              setHypotheses(prev => {
                const exists = prev.some(h => h.id === message.data.id)
                if (exists) return prev
                return [message.data, ...prev].slice(0, 100)
              })
              break

            case 'state_change':
              setState(message.data.state)
              break

            case 'ping':
              ws.send(JSON.stringify({ type: 'pong' }))
              break
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e)
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
        setTimeout(connectWebSocket, 3000)
      }

      ws.onerror = () => {}

      wsRef.current = ws
    }

    connectWebSocket()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  // Fetch initial status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${API_BASE}/orchestrator/status`)
        if (response.ok) {
          const data = await response.json()
          setState(data.state)
          if (data.stats) setStats(data.stats)
          if (data.top_hypotheses) setHypotheses(data.top_hypotheses)
        }
      } catch (e) {
        console.error('Failed to fetch status:', e)
      }
    }
    fetchStatus()
  }, [])

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
      } else {
        const error = await response.json()
        alert(`Failed to start: ${error.detail}`)
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

  const generatePaper = useCallback(async () => {
    setGeneratingPaper(true)
    try {
      const response = await fetch(`${API_BASE}/orchestrator/generate-paper/markdown`, { method: 'POST' })
      if (response.ok) {
        const text = await response.text()
        setPaperMarkdown(text)
      } else {
        const error = await response.json()
        alert(`Paper generation failed: ${error.detail}`)
      }
    } catch (e) {
      console.error('Failed to generate paper:', e)
      alert('Failed to generate paper')
    } finally {
      setGeneratingPaper(false)
    }
  }, [])

  const downloadPaper = useCallback(() => {
    if (!paperMarkdown) return
    const blob = new Blob([paperMarkdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `humanovo-research-${config.disease.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [paperMarkdown, config.disease])

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
              <h1 className="text-xl font-semibold">Parallel Discovery Agents</h1>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {stats?.total_agents || 0} agents across 4 models — Llama Maverick + DeepSeek R1 + Kimi 2.5 + GPT OSS 120B
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* WebSocket Status */}
            <div className={clsx(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
              wsConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            )}>
              <div className={clsx('w-2 h-2 rounded-full', wsConnected ? 'bg-green-500' : 'bg-red-500')} />
              {wsConnected ? 'Live' : 'Disconnected'}
            </div>

            {/* Generate Paper Button */}
            {(state === 'idle' || state === 'paused') && hypotheses.length > 0 && (
              <button
                onClick={generatePaper}
                disabled={generatingPaper}
                className="btn bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50"
              >
                {generatingPaper ? (
                  <FiRefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <FiFileText className="w-4 h-4" />
                )}
                {generatingPaper ? 'Generating...' : 'Generate Paper'}
              </button>
            )}

            {/* Control Buttons */}
            {state === 'idle' && (
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
                    disabled={state !== 'idle'}
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
                    disabled={state !== 'idle'}
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
                      disabled={state !== 'idle'}
                    />
                    <button
                      onClick={addFocusEntity}
                      className="btn btn-sm bg-[var(--color-border)]"
                      disabled={state !== 'idle'}
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
                            disabled={state !== 'idle'}
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
                        disabled={state !== 'idle'}
                      />
                      <select
                        value={factorCategory}
                        onChange={(e) => setFactorCategory(e.target.value as ExternalFactor['category'])}
                        className="w-full px-2 py-1.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded text-xs"
                        disabled={state !== 'idle'}
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
                        disabled={state !== 'idle'}
                      />
                      <button
                        onClick={addExternalFactor}
                        className="btn btn-sm w-full bg-[var(--color-border)] text-xs"
                        disabled={state !== 'idle' || !factorName.trim()}
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
                                disabled={state !== 'idle'}
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
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="10000"
                    step="100"
                    value={config.maxAgents}
                    onChange={(e) => setConfig(prev => ({ ...prev, maxAgents: parseInt(e.target.value) }))}
                    className="w-full"
                    disabled={state !== 'idle'}
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
                    disabled={state !== 'idle'}
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
                  <div className="text-lg font-bold">{stats.total_agents}</div>
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

          {/* Active Models */}
          <div className="p-3 border-b border-[var(--color-border)]">
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-3">
              Active Models
            </h3>
            <div className="space-y-2">
              {modelInfo.map(model => (
                <div key={model.id} className="flex items-center gap-2 text-xs">
                  <div className={clsx('w-2 h-2 rounded-full', model.color)} />
                  <span className="flex-1">{model.name}</span>
                  <span className="text-[var(--color-text-muted)]">{model.desc}</span>
                </div>
              ))}
            </div>
          </div>

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
                  <span className="text-[var(--color-text-muted)]">Avg Relation Score</span>
                  <span>{(stats.learning_stats.avg_relation_score * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Agent Roles */}
          <div className="p-3">
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-3">
              Agent Distribution
            </h3>
            <div className="space-y-2">
              {agentRoles.map(role => {
                const count = stats?.agents_by_role?.[role.role] || 0
                const Icon = role.icon
                return (
                  <div key={role.role} className="flex items-center gap-2">
                    <div className={clsx('p-1.5 rounded', role.color)}>
                      <Icon className="w-3 h-3" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-xs">
                        <span>{role.name}</span>
                        <span className="text-[var(--color-text-muted)]">{count}</span>
                      </div>
                      <div className="h-1 bg-[var(--color-border)] rounded-full mt-1">
                        <div
                          className={clsx('h-full rounded-full', role.color.split(' ')[1])}
                          style={{ width: `${role.percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Main Content - Hypotheses or Paper */}
        <div className="flex-1 overflow-y-auto">
          {/* Paper View */}
          {paperMarkdown ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-[var(--color-text-muted)] uppercase">
                  Generated Research Paper
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={downloadPaper}
                    className="btn btn-sm bg-purple-500/20 text-purple-400"
                  >
                    <FiDownload className="w-3.5 h-3.5" />
                    Download Markdown
                  </button>
                  <button
                    onClick={() => setPaperMarkdown(null)}
                    className="btn btn-sm bg-[var(--color-border)]"
                  >
                    Back to Hypotheses
                  </button>
                </div>
              </div>
              <div className="card p-6 prose prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed">{paperMarkdown}</pre>
              </div>
            </div>
          ) : hypotheses.length > 0 ? (
            <div className="p-4 space-y-3">
              <h2 className="text-sm font-medium text-[var(--color-text-muted)] uppercase">
                Discovered Hypotheses ({hypotheses.length})
              </h2>

              {hypotheses.map((hypothesis, index) => (
                <button
                  key={hypothesis.id}
                  onClick={() => setSelectedHypothesis(hypothesis)}
                  className={clsx(
                    'w-full text-left card hover:border-[var(--color-border-strong)] transition-colors',
                    selectedHypothesis?.id === hypothesis.id && 'border-primary-500'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={clsx(
                      'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold',
                      hypothesis.confidence >= 0.8 ? 'bg-green-500/20 text-green-400' :
                      hypothesis.confidence >= 0.6 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-orange-500/20 text-orange-400'
                    )}>
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{hypothesis.title}</span>
                        <span className={clsx(
                          'text-sm font-bold',
                          getConfidenceColor(hypothesis.confidence)
                        )}>
                          {(hypothesis.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-text-muted)] mt-1 line-clamp-2">
                        {hypothesis.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xxs px-1.5 py-0.5 bg-[var(--color-border)] rounded">
                          {hypothesis.model_used}
                        </span>
                        {hypothesis.validated && (
                          <span className="text-xxs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded flex items-center gap-1">
                            <FiCheckCircle className="w-3 h-3" />
                            Validated
                          </span>
                        )}
                        {hypothesis.external_factors && hypothesis.external_factors.length > 0 && (
                          <span className="text-xxs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">
                            +{hypothesis.external_factors.length} factors
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                {state === 'running' ? (
                  <>
                    <FiRefreshCw className="w-12 h-12 text-primary-400 mx-auto mb-4 animate-spin" />
                    <p className="text-[var(--color-text-muted)]">Agents are exploring...</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-2">
                      Hypotheses will appear here as they are discovered
                    </p>
                  </>
                ) : (
                  <>
                    <FiTarget className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
                    <p className="text-[var(--color-text-muted)]">No hypotheses yet</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-2">
                      Configure and start a discovery to see results
                    </p>
                  </>
                )}
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
                  <p className="text-sm">{selectedHypothesis.mechanism || 'Not specified'}</p>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1">
                    Model Used
                  </h4>
                  <span className="text-sm px-2 py-1 bg-[var(--color-border)] rounded">
                    {selectedHypothesis.model_used}
                  </span>
                </div>

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

                {selectedHypothesis.validated && (
                  <div className="p-3 bg-green-500/10 border border-green-500/30 rounded">
                    <div className="flex items-center gap-2 text-green-400">
                      <FiCheckCircle className="w-4 h-4" />
                      <span className="font-medium">Validated</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
