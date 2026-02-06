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
  FiAward
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
  created_at?: string
}

interface DiscoveryConfig {
  disease: string
  discoveryType: 'cure' | 'prevention' | 'treatment' | 'biomarker' | 'drug_repurposing'
  focusEntities: string[]
  maxAgents: number
  targetConfidence: number
}

// Agent configurations for display
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
    description: 'Combine findings into unified hypotheses',
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

const API_BASE = '/api/v1'

export default function Agents() {
  // Orchestrator state
  const [state, setState] = useState<OrchestratorState>('idle')
  const [stats, setStats] = useState<OrchestratorStats | null>(null)
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [selectedHypothesis, setSelectedHypothesis] = useState<Hypothesis | null>(null)

  // Configuration
  const [config, setConfig] = useState<DiscoveryConfig>({
    disease: '',
    discoveryType: 'cure',
    focusEntities: [],
    maxAgents: 1000,
    targetConfidence: 0.95,
  })
  const [focusEntityInput, setFocusEntityInput] = useState('')
  const [showConfig, setShowConfig] = useState(true)

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
        console.log('WebSocket connected')
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
                // Add new hypothesis at the beginning, avoid duplicates
                const exists = prev.some(h => h.id === message.data.id)
                if (exists) return prev
                return [message.data, ...prev].slice(0, 100) // Keep last 100
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
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000)
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

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
        }),
      })

      if (response.ok) {
        setState('running')
        setShowConfig(false)
        setHypotheses([])
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
      if (response.ok) {
        setState('paused')
      }
    } catch (e) {
      console.error('Failed to pause:', e)
    }
  }, [])

  const resumeDiscovery = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/orchestrator/resume`, { method: 'POST' })
      if (response.ok) {
        setState('running')
      }
    } catch (e) {
      console.error('Failed to resume:', e)
    }
  }, [])

  const stopDiscovery = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/orchestrator/stop`, { method: 'POST' })
      if (response.ok) {
        setState('stopping')
      }
    } catch (e) {
      console.error('Failed to stop:', e)
    }
  }, [])

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
                {stats?.total_agents || 0} agents • Llama Maverick + DeepSeek R1 via AWS Bedrock
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
                            ×
                          </button>
                        </span>
                      ))}
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
                <span className="text-[var(--color-text-muted)]">High Confidence (≥70%)</span>
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

        {/* Main Content - Hypotheses */}
        <div className="flex-1 overflow-y-auto">
          {hypotheses.length > 0 ? (
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
        {selectedHypothesis && (
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
                  ×
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
