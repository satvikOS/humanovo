import { useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  FiArrowLeft, FiActivity, FiTarget, FiCpu, FiClock,
  FiChevronDown, FiChevronUp, FiFileText, FiRefreshCw, FiTag,
  FiTrash2, FiBook,
} from 'react-icons/fi'
import clsx from 'clsx'
import { persistGet, persistSet, logActivity } from '../utils/persistence'
import DocumentViewer, { HypothesisViewer } from '../components/DocumentViewer'

const API_BASE = '/api/v1'

interface SavedResearchPaper {
  id: string
  hypothesis_id: string
  hypothesis_title: string
  project_id: string
  disease: string
  generated_at: string
  filename: string
}

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
  model_used?: string
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

type ViewMode = 'list' | 'project_paper' | 'hypothesis_paper'

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [generatingHypId, setGeneratingHypId] = useState<string | null>(null)
  const [, setRefresh] = useState(0)

  // Document viewer state
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [paperHtml, setPaperHtml] = useState<string | null>(null)
  const [activeHypothesis, setActiveHypothesis] = useState<SavedHypothesis | null>(null)
  const paperPollRef = useRef<number | null>(null)

  const projects = persistGet<LocalProject[]>('projects', [])
  const project = projects.find(p => p.id === projectId)

  const allHypotheses = persistGet<SavedHypothesis[]>('hypotheses', [])
  const projectHypotheses = allHypotheses.filter(h => h.project_id === projectId)

  // Research papers state
  const allPapers = persistGet<SavedResearchPaper[]>('research-papers', [])
  const projectPapers = allPapers.filter(p => p.project_id === projectId)

  // ---- Generate project-level paper via document pipeline ----
  const generateProjectPaper = useCallback(async () => {
    if (!projectId) return
    setGeneratingPaper(true)
    setGeneratingHypId(null)
    setViewMode('project_paper')
    setPdfBlobUrl(null)
    setPaperHtml(null)

    try {
      // Try the new document pipeline first (returns PDF bytes directly)
      const res = await fetch(`${API_BASE}/documents/project/${projectId}/pdf?use_ai=true`, {
        method: 'POST',
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        setPdfBlobUrl(url)
        setGeneratingPaper(false)

        // Auto-save to evidence
        const disease = project?.disease_focus || 'Unknown'
        _saveToEvidence(disease, projectHypotheses.length)
        return
      }

      // Fallback: use legacy orchestrator HTML pipeline
      await _fallbackLegacyPaper()
    } catch (e) {
      console.error('Document pipeline failed, trying fallback:', e)
      await _fallbackLegacyPaper()
    }
  }, [projectId, project, projectHypotheses.length])

  // ---- Generate hypothesis-level paper ----
  const generateHypothesisPaper = useCallback(async (hypothesis: SavedHypothesis) => {
    setGeneratingPaper(true)
    setGeneratingHypId(hypothesis.id)
    setActiveHypothesis(hypothesis)
    setViewMode('hypothesis_paper')
    setPdfBlobUrl(null)
    setPaperHtml(null)

    try {
      // Use document pipeline for hypothesis-level PDF
      const res = await fetch(`${API_BASE}/documents/hypothesis/${hypothesis.id}/pdf?use_ai=true`, {
        method: 'POST',
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        setPdfBlobUrl(url)
        setGeneratingPaper(false)
        setGeneratingHypId(null)

        const disease = hypothesis.disease || project?.disease_focus || 'Unknown'
        _saveToEvidence(disease, 1)
        _saveResearchPaper(hypothesis)
        return
      }

      // Fallback: use legacy orchestrator
      await _fallbackLegacyPaper(hypothesis.id)
    } catch (e) {
      console.error('Hypothesis paper generation failed, trying fallback:', e)
      await _fallbackLegacyPaper(hypothesis.id)
    }
  }, [project])

  // ---- Legacy fallback (existing orchestrator HTML pipeline) ----
  const _fallbackLegacyPaper = useCallback(async (hypothesisId?: string) => {
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
        setViewMode('list')
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

            const disease = project?.disease_focus || 'Unknown'
            _saveToEvidence(disease, projectHypotheses.length)
          } else if (data.status === 'failed') {
            if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
            alert(`Paper generation failed: ${data.error || 'Unknown error'}`)
            setGeneratingPaper(false)
            setGeneratingHypId(null)
            setViewMode('list')
          }
        } catch { /* keep polling */ }
      }, 4000)
    } catch (e) {
      console.error('Legacy paper generation failed:', e)
      alert('Failed to generate paper')
      setGeneratingPaper(false)
      setGeneratingHypId(null)
      setViewMode('list')
    }
  }, [project, projectHypotheses.length])

  // ---- Save generated paper to research papers list ----
  const _saveResearchPaper = useCallback((hypothesis: SavedHypothesis) => {
    const papers = persistGet<SavedResearchPaper[]>('research-papers', [])
    const paper: SavedResearchPaper = {
      id: `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      hypothesis_id: hypothesis.id,
      hypothesis_title: hypothesis.title,
      project_id: hypothesis.project_id,
      disease: hypothesis.disease || project?.disease_focus || 'Unknown',
      generated_at: new Date().toISOString(),
      filename: `humanovo-${hypothesis.title.replace(/\s+/g, '-').toLowerCase().slice(0, 50)}.pdf`,
    }
    papers.unshift(paper)
    persistSet('research-papers', papers.slice(0, 200))
    logActivity({ type: 'evidence', action: 'created', title: `Research paper: ${hypothesis.title}`, project: project?.name })
    setRefresh(n => n + 1)
  }, [project])

  // ---- Save generated paper to evidence store ----
  const _saveToEvidence = useCallback((disease: string, hypCount: number) => {
    const evidence = persistGet<Array<Record<string, unknown>>>('evidence', [])
    const diseaseTag = disease.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    evidence.unshift({
      id: `ev-paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: `AI Research Paper: ${disease}`,
      source: 'Humanovo Document Pipeline',
      sourceUrl: '',
      type: 'paper',
      status: 'pending',
      date: new Date().toISOString().split('T')[0],
      authors: ['Humanovo Multi-Model Discovery System'],
      abstract: `Auto-generated research paper for ${disease} containing ${hypCount} hypotheses.`,
      tags: ['internal-hypothesis-source', 'humanovo', 'ai-generated', 'document-pipeline', diseaseTag],
      citations: 0,
      relevanceScore: 0.95,
      publisher: 'Humanovo',
    })
    persistSet('evidence', evidence.slice(0, 500))
    logActivity({ type: 'evidence', action: 'created', title: `Auto-saved paper: ${disease}` })
  }, [])

  const closeViewer = useCallback(() => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
    setPdfBlobUrl(null)
    setPaperHtml(null)
    setActiveHypothesis(null)
    setViewMode('list')
    setGeneratingPaper(false)
    setGeneratingHypId(null)
    if (paperPollRef.current) { clearInterval(paperPollRef.current); paperPollRef.current = null }
  }, [pdfBlobUrl])

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

  // ---- Hypothesis paper viewer (split view) ----
  if (viewMode === 'hypothesis_paper' && activeHypothesis) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 border-b border-secondary-700 flex items-center gap-2 shrink-0">
          <Link to="/projects" className="text-primary-400 hover:text-primary-300 text-sm">
            <FiArrowLeft className="w-3.5 h-3.5 inline mr-1" />Projects
          </Link>
          <span className="text-secondary-600">/</span>
          <button onClick={closeViewer} className="text-primary-400 hover:text-primary-300 text-sm">
            {project.name}
          </button>
          <span className="text-secondary-600">/</span>
          <span className="text-secondary-400 text-sm truncate">{activeHypothesis.title}</span>
        </div>
        <div className="flex-1 min-h-0">
          <HypothesisViewer
            hypothesis={activeHypothesis}
            pdfUrl={pdfBlobUrl}
            htmlContent={paperHtml}
            isGenerating={generatingPaper}
            onGeneratePaper={() => generateHypothesisPaper(activeHypothesis)}
            onClose={closeViewer}
          />
        </div>
      </div>
    )
  }

  // ---- Project paper viewer (full width) ----
  if (viewMode === 'project_paper') {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 border-b border-secondary-700 flex items-center gap-2 shrink-0">
          <Link to="/projects" className="text-primary-400 hover:text-primary-300 text-sm">
            <FiArrowLeft className="w-3.5 h-3.5 inline mr-1" />Projects
          </Link>
          <span className="text-secondary-600">/</span>
          <button onClick={closeViewer} className="text-primary-400 hover:text-primary-300 text-sm">
            {project.name}
          </button>
          <span className="text-secondary-600">/</span>
          <span className="text-secondary-400 text-sm">Research Paper</span>
        </div>
        <div className="flex-1 min-h-0">
          <DocumentViewer
            pdfUrl={pdfBlobUrl}
            htmlContent={paperHtml}
            title={`Research Paper: ${project.disease_focus || project.name}`}
            onClose={closeViewer}
            filename={`humanovo-${project.disease_focus?.replace(/\s+/g, '-').toLowerCase() || 'research'}.pdf`}
            isGenerating={generatingPaper}
            progressMessage="Running document pipeline..."
          />
        </div>
      </div>
    )
  }

  // ---- Default: project detail list view ----
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
            onClick={generateProjectPaper}
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
                            onClick={() => generateHypothesisPaper(h)}
                            disabled={generatingPaper}
                            className="btn bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50 text-sm"
                          >
                            {generatingHypId === h.id ? (
                              <FiRefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FiFileText className="w-3.5 h-3.5" />
                            )}
                            {generatingHypId === h.id ? 'Generating Paper...' : 'Generate Research Paper'}
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

          {/* Research Papers section */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center">
              <FiBook className="w-5 h-5 mr-2 text-purple-400" />
              Research Papers ({projectPapers.length})
            </h2>

            {projectPapers.length > 0 ? (
              <div className="space-y-2">
                {projectPapers.map((paper) => (
                  <div
                    key={paper.id}
                    className="flex items-center justify-between p-3 border border-secondary-700 rounded-lg hover:border-purple-600/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FiFileText className="w-4 h-4 text-purple-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{paper.hypothesis_title}</p>
                        <p className="text-secondary-500 text-xs">
                          {new Date(paper.generated_at).toLocaleDateString()} &middot; {paper.disease}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          const hyp = projectHypotheses.find(h => h.id === paper.hypothesis_id)
                          if (hyp) generateHypothesisPaper(hyp)
                        }}
                        disabled={generatingPaper}
                        className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400 hover:text-purple-400 transition-colors"
                        title="Regenerate & view"
                      >
                        <FiRefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          const updated = persistGet<SavedResearchPaper[]>('research-papers', []).filter(p => p.id !== paper.id)
                          persistSet('research-papers', updated)
                          setRefresh(n => n + 1)
                        }}
                        className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400 hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <FiTrash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-secondary-400 text-sm">
                No research papers generated yet. Expand a hypothesis above and click
                &ldquo;Generate Research Paper&rdquo; to create one.
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
