import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  FiArrowLeft, FiActivity, FiTarget,
  FiChevronRight, FiFileText, FiRefreshCw,
  FiTrash2, FiBook, FiX, FiDownload,
} from 'react-icons/fi'
import clsx from 'clsx'
import { persistGet, persistSet, logActivity } from '../utils/persistence'
import HypothesisDocViewer from '../components/HypothesisDocViewer'

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

type ViewMode = 'list' | 'hypothesis_viewer' | 'hypothesis_paper'

// Paper generation phases for loading animation
const PAPER_PHASES = [
  { label: 'Initializing 8-model pipeline...', duration: 3000 },
  { label: 'Phase 1: Generating abstract & introduction (Claude Opus 4.6)...', duration: 12000 },
  { label: 'Phase 2: Core sections — literature review, methods, results (DeepSeek, Mistral, GPT-4o, Cohere)...', duration: 25000 },
  { label: 'Phase 3: Synthesis — discussion, molecular mechanisms, conclusion (Claude Opus 4.6)...', duration: 20000 },
  { label: 'Phase 4: QA & review (Kimi-K2, o3-mini, GPT-4.1)...', duration: 15000 },
  { label: 'Rendering PDF with ReportLab — cover page, tables, citations, diagrams...', duration: 8000 },
]

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [, setRefresh] = useState(0)

  // Document viewer state
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [paperError, setPaperError] = useState<string | null>(null)
  const [activeHypothesis, setActiveHypothesis] = useState<SavedHypothesis | null>(null)

  // Loading phase animation
  const [currentPhase, setCurrentPhase] = useState(0)
  const [phaseProgress, setPhaseProgress] = useState(0)
  const phaseTimerRef = useRef<number | null>(null)
  const progressTimerRef = useRef<number | null>(null)

  // Hypothesis chooser modal state
  const [showChooser, setShowChooser] = useState(false)

  const projects = persistGet<LocalProject[]>('projects', [])
  const project = projects.find(p => p.id === projectId)

  const allHypotheses = persistGet<SavedHypothesis[]>('hypotheses', [])
  const projectHypotheses = allHypotheses.filter(h => h.project_id === projectId)

  // Research papers state
  const allPapers = persistGet<SavedResearchPaper[]>('research-papers', [])
  const projectPapers = allPapers.filter(p => p.project_id === projectId)

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (phaseTimerRef.current) clearInterval(phaseTimerRef.current)
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
  }, [])

  // Phase animation logic
  const startPhaseAnimation = useCallback(() => {
    setCurrentPhase(0)
    setPhaseProgress(0)

    let phaseIdx = 0
    let elapsed = 0
    const TICK = 200

    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = window.setInterval(() => {
      elapsed += TICK
      const phaseDuration = PAPER_PHASES[phaseIdx]?.duration || 10000
      const pct = Math.min((elapsed / phaseDuration) * 100, 100)
      setPhaseProgress(pct)

      if (elapsed >= phaseDuration && phaseIdx < PAPER_PHASES.length - 1) {
        phaseIdx++
        elapsed = 0
        setCurrentPhase(phaseIdx)
        setPhaseProgress(0)
      }
    }, TICK)
  }, [])

  const stopPhaseAnimation = useCallback(() => {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null }
    if (phaseTimerRef.current) { clearInterval(phaseTimerRef.current); phaseTimerRef.current = null }
  }, [])

  // ---- Open hypothesis in full-page formatted doc viewer ----
  const openHypothesisViewer = useCallback((hypothesis: SavedHypothesis) => {
    setActiveHypothesis(hypothesis)
    setViewMode('hypothesis_viewer')
    setPdfBlobUrl(null)
    setPaperError(null)
  }, [])

  // ---- Generate hypothesis-level paper (PDF via ReportLab) ----
  const generateHypothesisPaper = useCallback(async (hypothesis: SavedHypothesis) => {
    setGeneratingPaper(true)
    setActiveHypothesis(hypothesis)
    setViewMode('hypothesis_paper')
    setPdfBlobUrl(null)
    setPaperError(null)
    setShowChooser(false)
    startPhaseAnimation()

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

      stopPhaseAnimation()

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
        _saveResearchPaper(hypothesis)
        return
      }

      let detail = 'Unknown error'
      try { const err = await res.json(); detail = err.detail || detail } catch {}
      setPaperError(`Paper generation failed (${res.status}): ${detail}`)
      setGeneratingPaper(false)
    } catch (e) {
      stopPhaseAnimation()
      console.error('Hypothesis paper generation failed:', e)
      setPaperError(`Paper generation failed: ${e instanceof Error ? e.message : String(e)}`)
      setGeneratingPaper(false)
    }
  }, [project, startPhaseAnimation, stopPhaseAnimation])

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

  // ---- Download current PDF ----
  const downloadPdf = useCallback(() => {
    if (!pdfBlobUrl || !activeHypothesis) return
    const a = document.createElement('a')
    a.href = pdfBlobUrl
    a.download = `humanovo-${(activeHypothesis.disease || 'research').replace(/\s+/g, '-').toLowerCase()}-${activeHypothesis.title.replace(/\s+/g, '-').toLowerCase().slice(0, 40)}.pdf`
    a.click()
  }, [pdfBlobUrl, activeHypothesis])

  const closeViewer = useCallback(() => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
    stopPhaseAnimation()
    setPdfBlobUrl(null)
    setPaperError(null)
    setActiveHypothesis(null)
    setViewMode('list')
    setGeneratingPaper(false)
  }, [pdfBlobUrl, stopPhaseAnimation])

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

  // ---- Full-page hypothesis doc viewer ----
  if (viewMode === 'hypothesis_viewer' && activeHypothesis) {
    return (
      <HypothesisDocViewer
        hypothesis={{
          id: activeHypothesis.id,
          title: activeHypothesis.title,
          description: activeHypothesis.description,
          mechanism: activeHypothesis.mechanism,
          confidence: activeHypothesis.confidence,
          tags: activeHypothesis.tags,
          disease: activeHypothesis.disease || project?.disease_focus,
          discovery_type: activeHypothesis.discovery_type,
          model_used: activeHypothesis.model_used,
          created_at: activeHypothesis.created_at,
        }}
        breadcrumbs={[
          { label: 'Projects', onClick: () => { closeViewer(); /* navigate handled by Link */ } },
          { label: project.name, onClick: closeViewer },
          { label: activeHypothesis.title },
        ]}
        onClose={closeViewer}
        onGenerateResearchPaper={() => generateHypothesisPaper(activeHypothesis)}
        onExportPdf={async () => {
          try {
            const res = await fetch(`${API_BASE}/documents/hypothesis/${activeHypothesis.id}/pdf`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: activeHypothesis.title,
                description: activeHypothesis.description,
                mechanism: activeHypothesis.mechanism,
                confidence: activeHypothesis.confidence,
                disease: activeHypothesis.disease || project?.disease_focus || 'Research',
                discovery_type: activeHypothesis.discovery_type || 'treatment',
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
              a.download = data.filename || `humanovo-${activeHypothesis.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.pdf`
              a.click()
              URL.revokeObjectURL(url)
            }
          } catch (e) {
            console.error('PDF export failed:', e)
          }
        }}
      />
    )
  }

  // ---- Paper viewer (generating or displaying PDF) ----
  if (viewMode === 'hypothesis_paper' && activeHypothesis) {
    return (
      <div className="h-full flex flex-col bg-secondary-900">
        {/* Header */}
        <div className="px-4 py-2 border-b border-secondary-700 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Link to="/projects" className="text-primary-400 hover:text-primary-300 text-sm">
              <FiArrowLeft className="w-3.5 h-3.5 inline mr-1" />Projects
            </Link>
            <span className="text-secondary-600">/</span>
            <button onClick={closeViewer} className="text-primary-400 hover:text-primary-300 text-sm">
              {project.name}
            </button>
            <span className="text-secondary-600">/</span>
            <span className="text-secondary-400 text-sm truncate max-w-xs">{activeHypothesis.title}</span>
          </div>
          <div className="flex items-center gap-2">
            {pdfBlobUrl && (
              <button onClick={downloadPdf} className="btn btn-sm bg-purple-500/20 text-purple-400 hover:bg-purple-500/30">
                <FiDownload className="w-3.5 h-3.5" />
                Download PDF
              </button>
            )}
            <button onClick={closeViewer} className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400">
              <FiX className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 relative">
          {/* Loading animation with phase updates */}
          {generatingPaper && !pdfBlobUrl && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary-900 z-10">
              {/* Spinning ring */}
              <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-secondary-700" />
                <div className="absolute inset-0 rounded-full border-4 border-t-purple-500 animate-spin" />
                <FiFileText className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-purple-400" />
              </div>

              <h3 className="text-lg font-semibold text-white mb-2">Generating Research Paper</h3>
              <p className="text-secondary-400 text-sm mb-1">{activeHypothesis.title}</p>

              {/* Phase indicator */}
              <div className="mt-6 w-full max-w-lg px-8">
                <div className="mb-3">
                  <p className="text-purple-300 text-sm font-medium text-center">
                    {PAPER_PHASES[currentPhase]?.label || 'Processing...'}
                  </p>
                  <p className="text-secondary-500 text-xs text-center mt-1">
                    Step {currentPhase + 1} of {PAPER_PHASES.length}
                  </p>
                </div>

                {/* Overall progress bar */}
                <div className="h-2 bg-secondary-700 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all duration-200 ease-linear"
                    style={{ width: `${((currentPhase + phaseProgress / 100) / PAPER_PHASES.length) * 100}%` }}
                  />
                </div>

                {/* Phase dots */}
                <div className="flex justify-between px-1">
                  {PAPER_PHASES.map((_, idx) => (
                    <div
                      key={idx}
                      className={clsx(
                        'w-2 h-2 rounded-full transition-colors',
                        idx < currentPhase ? 'bg-purple-500' :
                        idx === currentPhase ? 'bg-purple-400 animate-pulse' : 'bg-secondary-600'
                      )}
                    />
                  ))}
                </div>

                <p className="text-secondary-500 text-xs text-center mt-4">
                  8 AI models generating content in parallel — this may take a few minutes
                </p>
              </div>
            </div>
          )}

          {/* Error state */}
          {paperError && !generatingPaper && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary-900 z-10">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                <FiX className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Generation Failed</h3>
              <p className="text-red-400 text-sm mb-4 max-w-md text-center">{paperError}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => generateHypothesisPaper(activeHypothesis)}
                  className="btn bg-purple-500 text-white hover:bg-purple-600"
                >
                  <FiRefreshCw className="w-4 h-4" />
                  Retry
                </button>
                <button onClick={closeViewer} className="btn bg-secondary-700 text-white hover:bg-secondary-600">
                  Back
                </button>
              </div>
            </div>
          )}

          {/* PDF viewer */}
          {pdfBlobUrl && (
            <object
              data={pdfBlobUrl}
              type="application/pdf"
              className="w-full h-full"
            >
              <div className="flex flex-col items-center justify-center h-full">
                <p className="text-secondary-400 mb-4">Unable to display PDF inline. Download it instead.</p>
                <button onClick={downloadPdf} className="btn bg-purple-500 text-white hover:bg-purple-600">
                  <FiDownload className="w-4 h-4" />
                  Download PDF
                </button>
              </div>
            </object>
          )}
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
        {/* Generate paper — choose which hypothesis */}
        {projectHypotheses.length > 0 && (
          <div className="relative inline-block">
            <button
              onClick={() => setShowChooser(!showChooser)}
              disabled={generatingPaper}
              className="mt-4 btn bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50"
            >
              {generatingPaper ? (
                <FiRefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <FiFileText className="w-4 h-4" />
              )}
              {generatingPaper ? 'Generating Paper...' : 'Generate Research Paper'}
            </button>

            {/* Hypothesis chooser dropdown */}
            {showChooser && !generatingPaper && (
              <div className="absolute z-50 mt-2 w-96 max-h-80 overflow-y-auto bg-secondary-800 border border-secondary-600 rounded-lg shadow-xl">
                <div className="p-3 border-b border-secondary-700 flex items-center justify-between">
                  <span className="text-sm font-medium text-white">Choose a hypothesis for the paper</span>
                  <button onClick={() => setShowChooser(false)} className="p-1 rounded hover:bg-secondary-700 text-secondary-400">
                    <FiX className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-1">
                  {projectHypotheses.map((h, idx) => (
                    <button
                      key={h.id}
                      onClick={() => generateHypothesisPaper(h)}
                      className="w-full text-left p-3 rounded-lg hover:bg-secondary-700 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-secondary-500 font-mono text-xs shrink-0">#{idx + 1}</span>
                        <span className="text-white text-sm font-medium truncate flex-1">{h.title}</span>
                        <span className={clsx(
                          'text-xs font-bold shrink-0',
                          h.confidence >= 0.7 ? 'text-green-400' :
                          h.confidence >= 0.5 ? 'text-yellow-400' : 'text-orange-400'
                        )}>
                          {(h.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      {h.description && (
                        <p className="text-secondary-400 text-xs mt-1 line-clamp-1 ml-6">{h.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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

          {/* Hypotheses - click to view in full-page doc viewer */}
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
                      {/* Click to open in full doc viewer */}
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
                No research papers generated yet. Click &ldquo;Generate Research Paper&rdquo; above
                and choose a hypothesis, or click a hypothesis to view it and generate from there.
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
