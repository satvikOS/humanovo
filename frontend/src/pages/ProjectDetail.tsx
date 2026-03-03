import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  FiArrowLeft, FiActivity, FiTarget,
  FiChevronRight, FiFileText, FiRefreshCw,
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
  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [generatingHypId, setGeneratingHypId] = useState<string | null>(null)
  const [, setRefresh] = useState(0)

  // Document viewer state
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [paperError, setPaperError] = useState<string | null>(null)
  const [activeHypothesis, setActiveHypothesis] = useState<SavedHypothesis | null>(null)

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

    setPaperError(null)

    try {
      const res = await fetch(`${API_BASE}/documents/project/${projectId}/pdf?use_ai=true`, {
        method: 'POST',
      })

      if (res.ok) {
        const blob = await res.blob()
        if (blob.size === 0) {
          setPaperError('Server returned empty PDF. Check backend logs for errors.')
          setGeneratingPaper(false)
          return
        }
        const url = URL.createObjectURL(blob)
        setPdfBlobUrl(url)
        setGeneratingPaper(false)
        return
      }

      let detail = 'Unknown error'
      try { const err = await res.json(); detail = err.detail || detail } catch {}
      setPaperError(`Paper generation failed (${res.status}): ${detail}`)
      setGeneratingPaper(false)
    } catch (e) {
      console.error('Document pipeline failed:', e)
      setPaperError(`Paper generation failed: ${e instanceof Error ? e.message : String(e)}`)
      setGeneratingPaper(false)
    }
  }, [projectId])

  // ---- Generate hypothesis-level paper ----
  // ---- Open hypothesis in doc viewer ----
  const openHypothesisViewer = useCallback((hypothesis: SavedHypothesis) => {
    setActiveHypothesis(hypothesis)
    setViewMode('hypothesis_paper')
    setPdfBlobUrl(null)

    setPaperError(null)
  }, [])

  const generateHypothesisPaper = useCallback(async (hypothesis: SavedHypothesis) => {
    setGeneratingPaper(true)
    setGeneratingHypId(hypothesis.id)
    setActiveHypothesis(hypothesis)
    setViewMode('hypothesis_paper')
    setPdfBlobUrl(null)

    setPaperError(null)

    try {
      const res = await fetch(`${API_BASE}/documents/hypothesis/${hypothesis.id}/pdf?use_ai=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: hypothesis.title,
          description: hypothesis.description,
          mechanism: hypothesis.mechanism,
          confidence: hypothesis.confidence,
          disease: hypothesis.disease || project?.disease_focus || 'Unknown',
          discovery_type: hypothesis.discovery_type || 'treatment',
          model_used: hypothesis.model_used || 'unknown',
          tags: hypothesis.tags || [],
          external_factors: [],
        }),
      })

      if (res.ok) {
        const blob = await res.blob()
        if (blob.size === 0) {
          setPaperError('Server returned empty PDF. Check backend logs for errors.')
          setGeneratingPaper(false)
          setGeneratingHypId(null)
          return
        }
        const url = URL.createObjectURL(blob)
        setPdfBlobUrl(url)
        setGeneratingPaper(false)
        setGeneratingHypId(null)
        _saveResearchPaper(hypothesis)
        return
      }

      let detail = 'Unknown error'
      try { const err = await res.json(); detail = err.detail || detail } catch {}
      setPaperError(`Paper generation failed (${res.status}): ${detail}`)
      setGeneratingPaper(false)
      setGeneratingHypId(null)
    } catch (e) {
      console.error('Hypothesis paper generation failed:', e)
      setPaperError(`Paper generation failed: ${e instanceof Error ? e.message : String(e)}`)
      setGeneratingPaper(false)
      setGeneratingHypId(null)
    }
  }, [project])

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

  const closeViewer = useCallback(() => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
    setPdfBlobUrl(null)

    setPaperError(null)
    setActiveHypothesis(null)
    setViewMode('list')
    setGeneratingPaper(false)
    setGeneratingHypId(null)
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
            htmlContent={null}
            isGenerating={generatingPaper}
            onGeneratePaper={() => generateHypothesisPaper(activeHypothesis)}
            onClose={closeViewer}
            errorMessage={paperError}
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
            htmlContent={null}
            title={`Research Paper: ${project.disease_focus || project.name}`}
            onClose={closeViewer}
            filename={`humanovo-${project.disease_focus?.replace(/\s+/g, '-').toLowerCase() || 'research'}.pdf`}
            isGenerating={generatingPaper}
            progressMessage="Running document pipeline..."
            errorMessage={paperError}
            onGenerateResearchPaper={generateProjectPaper}
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
                  return (
                    <div
                      key={h.id}
                      className="border rounded-lg transition-colors border-secondary-700 hover:border-primary-600/50"
                    >
                      {/* Collapsed header — click to open in doc viewer */}
                      <button
                        onClick={() => openHypothesisViewer(h)}
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
                            <FiChevronRight className="w-4 h-4 text-secondary-400" />
                          </div>
                        </div>
                        {h.description && (
                          <p className="text-secondary-400 text-sm mt-1 line-clamp-1 ml-8">{h.description}</p>
                        )}
                      </button>
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
