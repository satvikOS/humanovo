import { useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  FiArrowLeft, FiActivity, FiTarget, FiCpu, FiClock,
  FiChevronDown, FiChevronUp, FiFileText, FiRefreshCw, FiDownload, FiX, FiTag,
} from 'react-icons/fi'
import clsx from 'clsx'
import { persistGet, persistSet, logActivity } from '../utils/persistence'

const API_BASE = '/api/v1'

interface SavedHypothesis {
  id: string
  title: string
  description: string
  mechanism: string
  confidence: number
  tags: string[]
  disease: string
  discovery_type: string
  project_id: string
  created_at: string
}

interface LocalProject {
  id: string
  name: string
  description?: string
  disease_focus?: string
  research_question?: string
  tags: string[]
  hypothesis_count: number
  evidence_count: number
  status: string
  created_at: string
  updated_at: string
}

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [generatingHypId, setGeneratingHypId] = useState<string | null>(null)
  const [paperHtml, setPaperHtml] = useState<string | null>(null)
  const paperPollRef = useRef<number | null>(null)

  const projects = persistGet<LocalProject[]>('projects', [])
  const project = projects.find(p => p.id === projectId)

  const allHypotheses = persistGet<SavedHypothesis[]>('hypotheses', [])
  const projectHypotheses = allHypotheses.filter(h => h.project_id === projectId)

  const generatePaper = useCallback(async (hypothesisId?: string) => {
    setGeneratingPaper(true)
    setGeneratingHypId(hypothesisId || null)

    try {
      const response = await fetch(`${API_BASE}/orchestrator/generate-paper/markdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hypothesisId ? { hypothesis_id: hypothesisId } : {}),
      })

      if (!response.ok) {
        let detail = 'Unknown error'
        try { const err = await response.json(); detail = err.detail || detail } catch {}
        alert(`Paper generation failed: ${detail}`)
        setGeneratingPaper(false)
        setGeneratingHypId(null)
        return
      }

      if (paperPollRef.current) clearInterval(paperPollRef.current)
      paperPollRef.current = window.setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/orchestrator/paper-status`)
          if (!statusRes.ok) return
          const data = await statusRes.json()
          if (data.status === 'done' && data.paper_html) {
            if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
            setPaperHtml(data.paper_html)
            setGeneratingPaper(false)
            setGeneratingHypId(null)

            // Auto-save to evidence
            const evidence = persistGet<Array<Record<string, unknown>>>('evidence', [])
            const disease = project?.disease_focus || 'Unknown'
            const diseaseTag = disease.toLowerCase().replace(/[^a-z0-9]+/g, '-')
            evidence.unshift({
              id: `ev-paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              title: `AI Research Paper: ${disease}`,
              source: 'Humanovo AI Pipeline',
              sourceUrl: '',
              type: 'paper',
              status: 'pending',
              date: new Date().toISOString().split('T')[0],
              authors: ['Humanovo Multi-Model Discovery System'],
              abstract: `Auto-generated research paper for ${disease} containing ${projectHypotheses.length} hypotheses.`,
              tags: ['internal-hypothesis-source', 'humanovo', 'ai-generated', diseaseTag],
              citations: 0,
              relevanceScore: 0.95,
              publisher: 'Humanovo',
              fullText: data.paper_html,
            })
            persistSet('evidence', evidence.slice(0, 500))
            logActivity({ type: 'evidence', action: 'created', title: `Auto-saved paper: ${disease}` })
          } else if (data.status === 'failed') {
            if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
            alert(`Paper generation failed: ${data.error || 'Unknown error'}`)
            setGeneratingPaper(false)
            setGeneratingHypId(null)
          }
        } catch { /* keep polling */ }
      }, 4000)
    } catch (e) {
      console.error('Failed to start paper generation:', e)
      alert('Failed to start paper generation')
      setGeneratingPaper(false)
      setGeneratingHypId(null)
    }
  }, [project, projectHypotheses.length])

  const downloadPaper = useCallback(() => {
    if (!paperHtml) return
    const blob = new Blob([paperHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `humanovo-paper-${project?.disease_focus?.replace(/\s+/g, '-').toLowerCase() || 'research'}-${new Date().toISOString().split('T')[0]}.html`
    a.click()
    URL.revokeObjectURL(url)
  }, [paperHtml, project])

  if (!project) {
    return (
      <div className="p-8">
        <Link to="/projects" className="inline-flex items-center text-primary-400 hover:text-primary-300 mb-6">
          <FiArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Link>
        <div className="card text-center py-12">
          <FiTarget className="w-12 h-12 text-secondary-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Project Not Found</h2>
          <p className="text-secondary-400 max-w-md mx-auto">
            This project may not have been saved properly. Try running a new discovery
            and saving results to a project from the Agents page.
          </p>
        </div>
      </div>
    )
  }

  // Paper view
  if (paperHtml) {
    return (
      <div className="p-8 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <Link to="/projects" className="inline-flex items-center text-primary-400 hover:text-primary-300">
            <FiArrowLeft className="w-4 h-4 mr-2" />
            Back to Projects
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${API_BASE}/orchestrator/generate-paper/pdf`, { method: 'POST' })
                  if (!res.ok) { alert('PDF generation failed'); return }
                  const blob = await res.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `humanovo-${project?.disease_focus?.replace(/\s+/g, '-').toLowerCase() || 'research'}.pdf`
                  a.click()
                  URL.revokeObjectURL(url)
                } catch { alert('PDF generation failed') }
              }}
              className="btn btn-sm bg-red-500/20 text-red-400"
            >
              <FiDownload className="w-3.5 h-3.5" /> Download PDF
            </button>
            <button onClick={downloadPaper} className="btn btn-sm bg-purple-500/20 text-purple-400">
              <FiDownload className="w-3.5 h-3.5" /> Download HTML
            </button>
            <button onClick={() => setPaperHtml(null)} className="btn btn-sm bg-secondary-700 text-secondary-300">
              <FiX className="w-3.5 h-3.5" /> Close Paper
            </button>
          </div>
        </div>
        <iframe
          srcDoc={paperHtml}
          className="flex-1 w-full rounded-lg border border-secondary-700"
          style={{ minHeight: '85vh' }}
          title="Research Paper"
          sandbox="allow-same-origin"
        />
      </div>
    )
  }

  const highConf = projectHypotheses.filter(h => h.confidence >= 0.7).length
  const medConf = projectHypotheses.filter(h => h.confidence >= 0.5 && h.confidence < 0.7).length
  const lowConf = projectHypotheses.filter(h => h.confidence < 0.5).length

  return (
    <div className="p-8">
      <Link to="/projects" className="inline-flex items-center text-primary-400 hover:text-primary-300 mb-6">
        <FiArrowLeft className="w-4 h-4 mr-2" />
        Back to Projects
      </Link>

      {/* Project header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">{project.name}</h1>
        {project.description && (
          <p className="text-secondary-400 mt-2">{project.description}</p>
        )}
        {/* Generate paper for entire project */}
        {projectHypotheses.length > 0 && (
          <button
            onClick={() => generatePaper()}
            disabled={generatingPaper}
            className="mt-4 btn bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50"
          >
            {generatingPaper && !generatingHypId ? (
              <FiRefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FiFileText className="w-4 h-4" />
            )}
            {generatingPaper && !generatingHypId ? 'Generating Paper...' : 'Generate Research Paper'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Project Details */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Details</h2>
            <dl className="space-y-3">
              {project.disease_focus && (
                <div>
                  <dt className="text-secondary-400 text-sm">Disease Focus</dt>
                  <dd className="text-white">{project.disease_focus}</dd>
                </div>
              )}
              {project.research_question && (
                <div>
                  <dt className="text-secondary-400 text-sm">Research Question</dt>
                  <dd className="text-white">{project.research_question}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Hypotheses - expandable detail view */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center">
              <FiActivity className="w-5 h-5 mr-2 text-primary-400" />
              Hypotheses ({projectHypotheses.length})
            </h2>

            {projectHypotheses.length > 0 ? (
              <div className="space-y-3">
                {projectHypotheses.map((h, idx) => {
                  const isExpanded = expandedId === h.id
                  return (
                    <div
                      key={h.id}
                      className={clsx(
                        'border rounded-lg transition-colors',
                        isExpanded ? 'border-primary-500 bg-primary-500/5' : 'border-secondary-700 hover:border-primary-600/50'
                      )}
                    >
                      {/* Collapsed header — always visible */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : h.id)}
                        className="w-full text-left p-4"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-2 flex-1 min-w-0">
                            <span className="text-secondary-500 font-mono text-sm shrink-0">#{idx + 1}</span>
                            <h3 className="font-medium text-white truncate">{h.title}</h3>
                          </div>
                          <div className="flex items-center space-x-2 shrink-0 ml-2">
                            <span className={clsx(
                              'text-sm font-bold',
                              h.confidence >= 0.7 ? 'text-green-400' :
                              h.confidence >= 0.5 ? 'text-yellow-400' : 'text-orange-400'
                            )}>
                              {(h.confidence * 100).toFixed(1)}%
                            </span>
                            {isExpanded ? <FiChevronUp className="w-4 h-4 text-secondary-400" /> : <FiChevronDown className="w-4 h-4 text-secondary-400" />}
                          </div>
                        </div>
                        {!isExpanded && h.description && (
                          <p className="text-secondary-400 text-sm mt-1 line-clamp-1 ml-8">{h.description}</p>
                        )}
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-4 border-t border-secondary-700/50 pt-3">
                          {/* Description */}
                          <div>
                            <div className="text-xs text-secondary-500 uppercase tracking-wider mb-1">Description</div>
                            <p className="text-secondary-300 text-sm leading-relaxed">{h.description}</p>
                          </div>

                          {/* Mechanism */}
                          {h.mechanism && (
                            <div>
                              <div className="text-xs text-secondary-500 uppercase tracking-wider mb-1">Mechanism of Action</div>
                              <p className="text-secondary-300 text-sm leading-relaxed">{h.mechanism}</p>
                            </div>
                          )}

                          {/* Tags */}
                          {h.tags && h.tags.length > 0 && (
                            <div>
                              <div className="text-xs text-secondary-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <FiTag className="w-3 h-3" /> Tags
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {h.tags.map(tag => (
                                  <span key={tag} className="badge badge-info text-xs">{tag}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Metadata row */}
                          <div className="flex items-center flex-wrap gap-4 pt-2 border-t border-secondary-700/50">
                            <span className="text-xs text-secondary-400 flex items-center gap-1">
                              <FiCpu className="w-3 h-3" />
                              {h.discovery_type || 'Unknown'}
                            </span>
                            <span className="text-xs text-secondary-400 flex items-center gap-1">
                              <FiClock className="w-3 h-3" />
                              {new Date(h.created_at).toLocaleDateString()}
                            </span>
                            <span className="text-xs text-secondary-400">
                              Disease: {h.disease}
                            </span>
                          </div>

                          {/* Generate paper for this hypothesis */}
                          <button
                            onClick={() => generatePaper(h.id)}
                            disabled={generatingPaper}
                            className="btn bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50 text-sm"
                          >
                            {generatingHypId === h.id ? (
                              <FiRefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FiFileText className="w-3.5 h-3.5" />
                            )}
                            {generatingHypId === h.id ? 'Generating Paper...' : 'Generate Paper for This Hypothesis'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-secondary-400">
                No hypotheses stored in this project yet. Run a discovery from the Agents page
                and save results to populate this project.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Stats */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Statistics</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-secondary-400">Hypotheses</dt>
                <dd className="text-white font-medium">{projectHypotheses.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-secondary-400">Evidence</dt>
                <dd className="text-white font-medium">{project.evidence_count || 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-secondary-400">Status</dt>
                <dd className="text-white font-medium capitalize">{project.status || 'active'}</dd>
              </div>
            </dl>
          </div>

          {/* Confidence distribution */}
          {projectHypotheses.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-4">Confidence Distribution</h2>
              <div className="space-y-2">
                {[
                  { label: 'High (>=70%)', count: highConf, color: 'bg-green-500' },
                  { label: 'Medium (50-70%)', count: medConf, color: 'bg-yellow-500' },
                  { label: 'Low (<50%)', count: lowConf, color: 'bg-orange-500' },
                ].map(({ label, count, color }) => {
                  const pct = projectHypotheses.length > 0 ? (count / projectHypotheses.length) * 100 : 0
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-secondary-400">{label}</span>
                        <span className="text-white">{count}</span>
                      </div>
                      <div className="h-2 bg-secondary-700 rounded-full">
                        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tags */}
          {project.tags && project.tags.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-4">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {project.tags.map((tag: string) => (
                  <span key={tag} className="badge badge-info">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
