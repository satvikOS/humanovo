/**
 * DiscoveryRunner — Live pipeline viewer per Jamison spec Section 14.3
 * Phase 1: Config panel → Phase 2: Live 11-stage progress viewer via WebSocket
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'

const _BACKEND = import.meta.env.VITE_API_BASE_URL || ''
const API = `${_BACKEND}/api`
const WS_BASE = _BACKEND
  ? _BACKEND.replace(/^http/, 'ws')
  : (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host

const STAGES = ['SEED', 'EXPAND', 'EVIDENCE', 'COUNTER', 'REVISE', 'MECHANISM', 'VALIDATE', 'GROUND', 'SCORE', 'REFINE', 'TRANSLATE', 'FINALIZE']

interface StageStatus {
  status: 'pending' | 'running' | 'completed' | 'error'
  model?: string
  duration_seconds?: number
  tokens_in?: number
  tokens_out?: number
  cost_cents?: number
  grounding_ratio?: number
}

interface LogEntry {
  time: string
  event: string
  detail: string
}

interface HypothesisPreview {
  index: number
  round: number
  title: string
  confidence_score: number | null
}

export default function DiscoveryRunner() {
  const { projectId } = useParams<{ projectId: string }>()

  // Config state
  const [disease, setDisease] = useState('')
  const [discoveryType, setDiscoveryType] = useState('treatment_discovery')
  const [externalFactors, setExternalFactors] = useState('')
  const [numRounds, setNumRounds] = useState(3)
  const [outputFormat, setOutputFormat] = useState('narrative')
  const [verbosity, setVerbosity] = useState('standard')
  const [grantType, setGrantType] = useState('')
  const [citationStyle, setCitationStyle] = useState('numbered')

  // Pipeline state
  const [phase, setPhase] = useState<'config' | 'running' | 'completed'>('config')
  const [, setRunId] = useState<string | null>(null)
  const [stages, setStages] = useState<Record<string, StageStatus>>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [hypotheses, setHypotheses] = useState<HypothesisPreview[]>([])
  const [totalCost, setTotalCost] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [bestHypothesis, setBestHypothesis] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadedDocs, setUploadedDocs] = useState<{ name: string; status: 'uploaded' | 'failed' }[]>([])

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      try {
        await api.uploadDocument(file, projectId ? { project_id: projectId } : undefined)
        setUploadedDocs(prev => [...prev, { name: file.name, status: 'uploaded' }])
      } catch {
        setUploadedDocs(prev => [...prev, { name: file.name, status: 'failed' }])
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addLog = useCallback((event: string, detail: string) => {
    setLogs(prev => [...prev, { time: new Date().toISOString().slice(11, 19), event, detail }])
  }, [])

  const startDiscovery = async () => {
    if (!projectId || !disease.trim()) return
    const body = {
      disease,
      discovery_type: discoveryType,
      external_factors: externalFactors ? externalFactors.split(',').map(s => s.trim()).filter(Boolean) : null,
      num_rounds: numRounds,
      hypotheses_per_round: 3,
      output_format: outputFormat,
      verbosity,
      grant_type: outputFormat === 'grant_sections' ? grantType || null : null,
      citation_style: citationStyle,
    }

    try {
      const res = await fetch(`${API}/v1/projects/${projectId}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setRunId(data.run_id)
      setPhase('running')
      addLog('started', `Discovery run ${data.run_id} started`)

      // Start timer
      const start = Date.now()
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)

      // Connect WebSocket
      const wsUrl = data.websocket_url || `${WS_BASE}/ws/discovery/${data.run_id}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          handleWsEvent(msg)
        } catch { /* ignore non-JSON */ }
      }

      ws.onerror = () => addLog('ws_error', 'WebSocket error')
      ws.onclose = () => addLog('ws_close', 'WebSocket closed')
    } catch (err) {
      addLog('error', String(err))
    }
  }

  const handleWsEvent = useCallback((msg: Record<string, unknown>) => {
    const event = msg.event as string
    switch (event) {
      case 'stage_started':
        setStages(prev => ({ ...prev, [msg.stage as string]: { status: 'running', model: msg.model as string } }))
        addLog('stage_started', `${msg.stage} started (${msg.model})`)
        break
      case 'stage_completed':
        setStages(prev => ({
          ...prev,
          [msg.stage as string]: {
            status: 'completed',
            model: prev[msg.stage as string]?.model,
            duration_seconds: msg.duration_seconds as number,
            tokens_in: msg.tokens_in as number,
            tokens_out: msg.tokens_out as number,
            cost_cents: msg.cost_cents as number,
            grounding_ratio: msg.grounding_ratio as number,
          },
        }))
        addLog('stage_completed', `${msg.stage} completed in ${(msg.duration_seconds as number)?.toFixed(1)}s`)
        break
      case 'hypothesis_completed':
        setHypotheses(prev => [...prev, {
          index: msg.hypothesis_index as number,
          round: msg.round as number,
          title: msg.title as string,
          confidence_score: msg.confidence_score as number | null,
        }])
        addLog('hypothesis', `Hypothesis ${(msg.hypothesis_index as number) + 1}: ${msg.title}`)
        break
      case 'cost_update':
        setTotalCost(msg.total_cost_cents as number)
        break
      case 'run_completed':
        setPhase('completed')
        setBestHypothesis(msg.best_hypothesis_id as string)
        if (timerRef.current) clearInterval(timerRef.current)
        addLog('completed', `Run completed — ${msg.total_hypotheses} hypotheses generated`)
        break
      case 'run_error':
        addLog('error', msg.error as string)
        if (!(msg.recoverable as boolean)) {
          setPhase('completed')
          if (timerRef.current) clearInterval(timerRef.current)
        }
        break
    }
  }, [addLog])

  const cancelRun = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ command: 'cancel' }))
    }
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const costDollars = (cents: unknown) => { const n = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0; return `$${(n / 100).toFixed(2)}` }

  if (phase === 'config') {
    return (
      <div className="p-6 max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>New Discovery Run</h1>

        <div className="space-y-4">
          <Field label="Disease">
            <input value={disease} onChange={e => setDisease(e.target.value)} placeholder="e.g., Rett syndrome"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          </Field>

          <Field label="Discovery Type">
            <select value={discoveryType} onChange={e => setDiscoveryType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="treatment_discovery">Treatment Discovery</option>
              <option value="prevention_strategies">Prevention Strategies</option>
              <option value="biomarker_identification">Biomarker Identification</option>
              <option value="drug_repurposing">Drug Repurposing</option>
              <option value="combination_therapy">Combination Therapy</option>
            </select>
          </Field>

          <Field label="External Factors">
            <input value={externalFactors} onChange={e => setExternalFactors(e.target.value)}
              placeholder="e.g., age of onset, genetic variant MECP2"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          </Field>

          <Field label={`Rounds (${numRounds})`}>
            <input type="range" min={1} max={4} value={numRounds} onChange={e => setNumRounds(Number(e.target.value))}
              className="w-full" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Output Format">
              <select value={outputFormat} onChange={e => setOutputFormat(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="narrative">Narrative</option>
                <option value="structured_table">Structured Table</option>
                <option value="knowledge_gap_map">Knowledge Gap Map</option>
                <option value="grant_sections">Grant Sections</option>
                <option value="comprehensive">Comprehensive</option>
              </select>
            </Field>

            <Field label="Verbosity">
              <select value={verbosity} onChange={e => setVerbosity(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="brief">Brief (~300 words)</option>
                <option value="standard">Standard (~1000 words)</option>
                <option value="comprehensive">Comprehensive (~3000 words)</option>
              </select>
            </Field>
          </div>

          {outputFormat === 'grant_sections' && (
            <Field label="Grant Type">
              <select value={grantType} onChange={e => setGrantType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="nih_r01">NIH R01</option>
                <option value="nih_r21">NIH R21</option>
                <option value="nsf">NSF</option>
                <option value="dod">DoD</option>
                <option value="private_foundation">Private Foundation</option>
              </select>
            </Field>
          )}

          <Field label="Citation Style">
            <select value={citationStyle} onChange={e => setCitationStyle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="numbered">Numbered [1][2][3]</option>
              <option value="apa">APA</option>
              <option value="vancouver">Vancouver</option>
            </select>
          </Field>

          <Field label="Supporting Documents">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.csv,.json,.docx,.xlsx,.md,.tsv"
              onChange={handleDocUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm"
              style={{ border: '2px dashed var(--color-border)', color: 'var(--color-text-muted)', opacity: uploading ? 0.5 : 1 }}>
              {uploading ? 'Uploading...' : 'Click to upload research documents'}
            </button>
            {uploadedDocs.length > 0 && (
              <div className="mt-2 space-y-1">
                {uploadedDocs.map((doc, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg-secondary)' }}>
                    <span style={{ color: doc.status === 'uploaded' ? 'var(--color-accent-green)' : '#ef4444' }}>●</span>
                    <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{doc.name}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>{doc.status}</span>
                  </div>
                ))}
              </div>
            )}
          </Field>

          <button onClick={startDiscovery} disabled={!disease.trim()}
            className="w-full px-4 py-3 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--color-accent-blue)', opacity: disease.trim() ? 1 : 0.5 }}>
            Start Discovery
          </button>
        </div>
      </div>
    )
  }

  // Phase 2: Live pipeline viewer
  return (
    <div className="p-6 space-y-4">
      {/* Header with cost and timer */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
          {phase === 'completed' ? 'Discovery Complete' : 'Discovery Running...'}
        </h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="font-mono" style={{ color: 'var(--color-text-muted)' }}>
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
          <span className="font-mono font-medium" style={{ color: 'var(--color-text-secondary)' }}>{costDollars(totalCost)}</span>
          {phase === 'running' && (
            <button onClick={cancelRun} className="px-3 py-1 rounded text-xs font-medium"
              style={{ background: '#ef444420', color: '#ef4444' }}>Cancel</button>
          )}
        </div>
      </div>

      {/* 12-stage progress bar */}
      <div className="flex gap-0.5">
        {STAGES.map(stage => {
          const s = stages[stage]
          const bg = !s ? 'var(--color-bg-secondary)' : s.status === 'running' ? '#3b82f6' : s.status === 'completed' ? '#22c55e' : '#ef4444'
          return (
            <div key={stage} className="flex-1 group relative">
              <div className="h-8 rounded-sm flex items-center justify-center text-xs font-mono transition-colors"
                style={{ background: bg, color: s?.status === 'running' || s?.status === 'completed' ? '#fff' : 'var(--color-text-muted)' }}>
                {stage.slice(0, 4)}
              </div>
              {s && (
                <div className="absolute top-full mt-1 left-0 right-0 text-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <div className="inline-block px-2 py-1 rounded text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                    {s.model}{s.duration_seconds ? ` (${s.duration_seconds.toFixed(1)}s)` : ''}
                    {s.grounding_ratio != null && Number.isFinite(s.grounding_ratio) ? ` GR:${(s.grounding_ratio * 100).toFixed(0)}%` : ''}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hypothesis grid */}
        <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>Hypotheses</h3>
          <div className="space-y-2">
            {hypotheses.length === 0 && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Waiting for hypotheses...</p>}
            {hypotheses.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-sm p-2 rounded"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-accent-blue)', color: '#fff' }}>
                  R{h.round}
                </span>
                <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{h.title}</span>
                {h.confidence_score != null && Number.isFinite(h.confidence_score) && (
                  <span className="text-xs font-mono" style={{ color: h.confidence_score >= 0.7 ? '#22c55e' : '#eab308' }}>
                    {(h.confidence_score * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Live log feed */}
        <div className="rounded-lg p-4 max-h-96 overflow-y-auto" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>Pipeline Log</h3>
          <div className="space-y-1 font-mono text-xs">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-2" style={{ color: log.event === 'error' ? '#ef4444' : 'var(--color-text-muted)' }}>
                <span className="shrink-0 opacity-50">{log.time}</span>
                <span className="shrink-0 font-medium w-20">{log.event}</span>
                <span className="truncate">{log.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Post-run summary */}
      {phase === 'completed' && bestHypothesis && (
        <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Best Hypothesis</h3>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {hypotheses.find(h => `${h.round}-${h.index}` === bestHypothesis)?.title || bestHypothesis}
          </p>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>{label}</label>
      {children}
    </div>
  )
}
