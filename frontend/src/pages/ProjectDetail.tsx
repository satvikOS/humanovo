import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  FiArrowLeft, FiActivity, FiTarget,
  FiChevronRight, FiFileText, FiRefreshCw,
  FiTrash2, FiBook, FiX, FiPrinter,
} from 'react-icons/fi'
import clsx from 'clsx'
import api, { Project } from '../services/api'
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
  paper_html?: string
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
  translational_roadmap?: any
}

type ViewMode = 'list' | 'hypothesis_viewer' | 'hypothesis_paper'

const PAPER_PHASES = [
  { label: 'Initializing research pipeline...', duration: 2000 },
  { label: 'Phase 1: Generating abstract & introduction...', duration: 8000 },
  { label: 'Phase 2: Bench science — mechanism, evidence, targets...', duration: 10000 },
  { label: 'Phase 3: Translational roadmap — T0 Basic Research, T1 First-in-Human...', duration: 12000 },
  { label: 'Phase 4: Clinical phases — T2 Trials, T3 Implementation...', duration: 12000 },
  { label: 'Phase 5: Population & global health — T4 Community, T5 Global Impact...', duration: 10000 },
  { label: 'Phase 6: Regulatory strategy, risk analysis & commercialization...', duration: 10000 },
  { label: 'Phase 7: Discussion, conclusion & quality review...', duration: 10000 },
  { label: 'Rendering final research paper — formatting, tables, citations...', duration: 8000 },
]

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const [generatingPaper, setGeneratingPaper] = useState(false)
  const generatingPaperRef = useRef(false)
  const [, setRefresh] = useState(0)

  // Project from API
  const [project, setProject] = useState<Project | null>(null)
  const [loadingProject, setLoadingProject] = useState(true)

  // Document viewer state
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [paperHtml, setPaperHtml] = useState<string | null>(null)
  const [paperError, setPaperError] = useState<string | null>(null)
  const [activeHypothesis, setActiveHypothesis] = useState<SavedHypothesis | null>(null)

  // Loading phase animation
  const [currentPhase, setCurrentPhase] = useState(0)
  const [phaseProgress, setPhaseProgress] = useState(0)
  const phaseTimerRef = useRef<number | null>(null)
  const progressTimerRef = useRef<number | null>(null)

  // Hypothesis chooser modal state
  const [showChooser, setShowChooser] = useState(false)

  // Load project from API, fall back to localStorage
  useEffect(() => {
    if (!projectId) return
    loadProject()
  }, [projectId])

  const loadProject = async () => {
    if (!projectId) return
    setLoadingProject(true)
    try {
      const proj = await api.getProject(projectId)
      setProject(proj)
    } catch {
      // Fall back to localStorage
      const localProjects = persistGet<any[]>('projects', [])
      const local = localProjects.find((p: any) => p.id === projectId)
      if (local) {
        setProject(local as Project)
      }
    } finally {
      setLoadingProject(false)
    }
  }

  // Get hypotheses from project or localStorage
  const allHypotheses = persistGet<SavedHypothesis[]>('hypotheses', [])
  const projectHypotheses = [
    // From API project
    ...(project?.hypotheses || []).map(h => ({
      id: h.id,
      title: h.title,
      description: h.description,
      mechanism: h.mechanism,
      confidence: h.confidence,
      tags: [] as string[],
      disease: project?.disease_focus || '',
      discovery_type: 'treatment',
      project_id: projectId || '',
      created_at: h.created_at,
      model_used: h.model_used,
    })),
    // From localStorage
    ...allHypotheses.filter(h => h.project_id === projectId),
  ]

  // Deduplicate by id
  const uniqueHypotheses = projectHypotheses.filter((h, i, arr) =>
    arr.findIndex(x => x.id === h.id) === i
  )

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

  const openHypothesisViewer = useCallback((hypothesis: SavedHypothesis) => {
    setActiveHypothesis(hypothesis)
    setViewMode('hypothesis_viewer')
    setPdfBlobUrl(null)
    setPaperError(null)
  }, [])

  const cancelPaperGeneration = useCallback(async () => {
    generatingPaperRef.current = false
    setGeneratingPaper(false)
    stopPhaseAnimation()
    try {
      await fetch(`${API_BASE}/orchestrator/cancel-paper`, { method: 'POST' })
    } catch { /* best-effort */ }
    setPaperError(null)
  }, [stopPhaseAnimation])

  const generateHypothesisPaper = useCallback(async (hypothesis: SavedHypothesis) => {
    generatingPaperRef.current = true
    setGeneratingPaper(true)
    setActiveHypothesis(hypothesis)
    setViewMode('hypothesis_paper')
    setPdfBlobUrl(null)
    setPaperHtml(null)
    setPaperError(null)
    setShowChooser(false)
    startPhaseAnimation()

    const bodyPayload = JSON.stringify({
      title: hypothesis.title,
      description: hypothesis.description,
      mechanism: hypothesis.mechanism,
      confidence: hypothesis.confidence,
      disease: hypothesis.disease || project?.disease_focus || 'Unknown',
      discovery_type: hypothesis.discovery_type || 'treatment',
      model_used: hypothesis.model_used || 'unknown',
      tags: hypothesis.tags || [],
      external_factors: [],
    })

    try {
      // Step 1: Check if paper for THIS hypothesis already exists in Lambda DynamoDB
      let cachedHtml = ''
      try {
        const statusRes = await fetch(`${API_BASE}/orchestrator/paper-status`)
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          // Only use cached paper if it matches this specific hypothesis
          if (statusData.status === 'done' && statusData.paper_html && statusData.paper_html.length > 100
              && statusData.hypothesis_id === hypothesis.id) {
            cachedHtml = statusData.paper_html
          }
        }
      } catch { /* ignore — will generate fresh */ }

      if (cachedHtml) {
        stopPhaseAnimation()
        setPaperHtml(cachedHtml)
        setGeneratingPaper(false)
        _saveResearchPaper(hypothesis, cachedHtml)
        return
      }

      // Step 2: Trigger Lambda paper generation (the pipeline that actually works)
      const triggerRes = await fetch(`${API_BASE}/orchestrator/generate-paper/markdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hypothesis_id: hypothesis.id,
          hypothesis_data: {
            id: hypothesis.id,
            title: hypothesis.title,
            description: hypothesis.description,
            mechanism: hypothesis.mechanism,
            confidence: hypothesis.confidence,
            disease: hypothesis.disease || project?.disease_focus || 'Unknown',
            discovery_type: hypothesis.discovery_type || 'treatment',
            tags: hypothesis.tags || [],
          },
        }),
      })

      if (triggerRes.ok) {
        const triggerData = await triggerRes.json()

        // If backend says paper already exists, fetch it immediately
        if (triggerData.status === 'already_done') {
          const doneRes = await fetch(`${API_BASE}/orchestrator/paper-status`)
          if (doneRes.ok) {
            const doneData = await doneRes.json()
            if (doneData.paper_html && doneData.paper_html.length > 100) {
              stopPhaseAnimation()
              setPaperHtml(doneData.paper_html)
              setGeneratingPaper(false)
              _saveResearchPaper(hypothesis, doneData.paper_html)
              return
            }
          }
        }

        // Poll for completion (Lambda generates async, stores HTML in DynamoDB)
        const pollInterval = 5000 // 5 seconds
        const maxPolls = 120     // 10 minutes max
        let pollCount = 0

        const pollForPaper = async (): Promise<boolean> => {
          while (pollCount < maxPolls) {
            pollCount++
            await new Promise(r => setTimeout(r, pollInterval))
            // Check if user cancelled
            if (!generatingPaperRef.current) {
              return true
            }
            try {
              const pollRes = await fetch(`${API_BASE}/orchestrator/paper-status`)
              if (pollRes.ok) {
                const pollData = await pollRes.json()
                if (pollData.status === 'done' && pollData.paper_html && pollData.paper_html.length > 100) {
                  stopPhaseAnimation()
                  setPaperHtml(pollData.paper_html)
                  setGeneratingPaper(false)
                  _saveResearchPaper(hypothesis, pollData.paper_html)
                  return true
                }
                if (pollData.status === 'failed' || pollData.status === 'idle') {
                  stopPhaseAnimation()
                  setPaperError(`Paper generation failed: ${pollData.error || 'Unknown error'}`)
                  setGeneratingPaper(false)
                  return true
                }
                // Still generating — continue polling
              }
            } catch { /* network hiccup, keep polling */ }
          }
          return false
        }

        const completed = await pollForPaper()
        if (completed) return
      }

      // Step 3: Fallback — try FastAPI HTML endpoint
      stopPhaseAnimation()
      const htmlRes = await fetch(`${API_BASE}/documents/hypothesis/${hypothesis.id}/html`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyPayload,
      })

      if (htmlRes.ok) {
        const contentType = htmlRes.headers.get('content-type') || ''
        if (contentType.includes('text/html')) {
          const html = await htmlRes.text()
          if (html && html.length > 100) {
            setPaperHtml(html)
            setGeneratingPaper(false)
            _saveResearchPaper(hypothesis, html)
            return
          }
        }
      }

      // Step 4: Last resort — try PDF endpoint
      const pdfRes = await fetch(`${API_BASE}/documents/hypothesis/${hypothesis.id}/pdf?use_ai=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyPayload,
      })

      if (pdfRes.ok) {
        const contentType = pdfRes.headers.get('content-type') || ''
        let blob: Blob

        if (contentType.includes('application/json')) {
          const data = await pdfRes.json()
          if (!data.pdf_base64) {
            setPaperError('Server returned empty paper. Check backend logs for errors.')
            setGeneratingPaper(false)
            return
          }
          const byteChars = atob(data.pdf_base64)
          const byteArray = new Uint8Array(byteChars.length)
          for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
          blob = new Blob([byteArray], { type: 'application/pdf' })
        } else {
          blob = await pdfRes.blob()
        }

        if (blob.size === 0) {
          setPaperError('Server returned empty paper. Check backend logs for errors.')
          setGeneratingPaper(false)
          return
        }
        const url = URL.createObjectURL(blob)
        setPdfBlobUrl(url)
        setGeneratingPaper(false)
        _saveResearchPaper(hypothesis)
        return
      }

      setPaperError('Paper generation failed. Check backend logs.')
      setGeneratingPaper(false)
    } catch (e) {
      stopPhaseAnimation()
      console.error('Hypothesis paper generation failed:', e)
      setPaperError(`Paper generation failed: ${e instanceof Error ? e.message : String(e)}`)
      setGeneratingPaper(false)
    }
  }, [project, startPhaseAnimation, stopPhaseAnimation])

  const _saveResearchPaper = useCallback((hypothesis: SavedHypothesis, html?: string) => {
    const papers = persistGet<SavedResearchPaper[]>('research-papers', [])
    // If paper already exists, update its HTML if we have new HTML
    const existingIdx = papers.findIndex(p => p.hypothesis_id === hypothesis.id)
    if (existingIdx >= 0) {
      if (html) {
        papers[existingIdx].paper_html = html
        persistSet('research-papers', papers)
        setRefresh(n => n + 1)
      }
      return
    }
    const paper: SavedResearchPaper = {
      id: `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      hypothesis_id: hypothesis.id,
      hypothesis_title: hypothesis.title,
      project_id: hypothesis.project_id,
      disease: hypothesis.disease || project?.disease_focus || 'Unknown',
      generated_at: new Date().toISOString(),
      filename: `humanovo-${hypothesis.title.replace(/\s+/g, '-').toLowerCase().slice(0, 50)}.pdf`,
      paper_html: html,
    }
    papers.unshift(paper)
    persistSet('research-papers', papers.slice(0, 200))
    logActivity({ type: 'evidence', action: 'created', title: `Research paper: ${hypothesis.title}`, project: project?.name })
    setRefresh(n => n + 1)
  }, [project])

  const printPaper = useCallback(() => {
    // Print the paper via the iframe's contentWindow
    const iframe = document.querySelector('iframe[title="Research Paper"]') as HTMLIFrameElement
    if (iframe?.contentWindow) {
      iframe.contentWindow.print()
    } else if (paperHtml) {
      // Fallback: open in a new window and print
      const printWindow = window.open('', '_blank')
      if (printWindow) {
        printWindow.document.write(paperHtml)
        printWindow.document.close()
        printWindow.focus()
        printWindow.print()
      }
    }
  }, [paperHtml])

  const closeViewer = useCallback(() => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
    generatingPaperRef.current = false
    stopPhaseAnimation()
    setPdfBlobUrl(null)
    setPaperHtml(null)
    setPaperError(null)
    setActiveHypothesis(null)
    setViewMode('list')
    setGeneratingPaper(false)
  }, [pdfBlobUrl, stopPhaseAnimation])

  if (loadingProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="p-8">
        <Link to="/projects" className="inline-flex items-center text-accent-blue hover:underline mb-6">
          <FiArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Link>
        <div className="glass-card text-center py-12">
          <FiTarget className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
          <h2 className="text-xl font-semibold text-white mb-2">Project Not Found</h2>
          <p className="text-[var(--color-text-muted)] max-w-md mx-auto">
            This project may not have been saved properly. Try running a new discovery
            and saving results to a project from the Agents page.
          </p>
        </div>
      </div>
    )
  }

  // Full-page hypothesis doc viewer
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
          translational_roadmap: activeHypothesis.translational_roadmap,
        }}
        breadcrumbs={[
          { label: 'Projects', onClick: () => { closeViewer() } },
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

  // Paper viewer (generating or displaying PDF)
  if (viewMode === 'hypothesis_paper' && activeHypothesis) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Link to="/projects" className="text-accent-blue hover:underline text-sm">
              <FiArrowLeft className="w-3.5 h-3.5 inline mr-1" />Projects
            </Link>
            <span className="text-[var(--color-text-muted)]">/</span>
            <button onClick={closeViewer} className="text-accent-blue hover:underline text-sm">
              {project.name}
            </button>
            <span className="text-[var(--color-text-muted)]">/</span>
            <span className="text-[var(--color-text-muted)] text-sm truncate max-w-xs">{activeHypothesis.title}</span>
          </div>
          <div className="flex items-center gap-2">
            {paperHtml && (
              <button onClick={printPaper} className="btn text-accent-purple hover:bg-accent-purple/10 text-sm">
                <FiPrinter className="w-3.5 h-3.5 mr-1" />
                Print
              </button>
            )}
            <button onClick={closeViewer} className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
              <FiX className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 relative">
          {generatingPaper && !pdfBlobUrl && !paperHtml && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
              <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-white/10" />
                <div className="absolute inset-0 rounded-full border-4 border-t-accent-purple animate-spin" />
                <FiFileText className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-accent-purple" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Generating Research Paper</h3>
              <p className="text-[var(--color-text-muted)] text-sm mb-1">{activeHypothesis.title}</p>
              <div className="mt-6 w-full max-w-lg px-8">
                <div className="mb-3">
                  <p className="text-accent-purple text-sm font-medium text-center">
                    {PAPER_PHASES[currentPhase]?.label || 'Processing...'}
                  </p>
                  <p className="text-[var(--color-text-muted)] text-xs text-center mt-1">
                    Step {currentPhase + 1} of {PAPER_PHASES.length}
                  </p>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-accent-purple rounded-full transition-all duration-200 ease-linear"
                    style={{ width: `${((currentPhase + phaseProgress / 100) / PAPER_PHASES.length) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between px-1">
                  {PAPER_PHASES.map((_, idx) => (
                    <div
                      key={idx}
                      className={clsx(
                        'w-2 h-2 rounded-full transition-colors',
                        idx < currentPhase ? 'bg-accent-purple' :
                        idx === currentPhase ? 'bg-accent-purple/60 animate-pulse' : 'bg-white/10'
                      )}
                    />
                  ))}
                </div>
                <p className="text-[var(--color-text-muted)] text-xs text-center mt-4">
                  Generating comprehensive research content — this may take a few minutes
                </p>
                <div className="flex justify-center mt-5">
                  <button
                    onClick={cancelPaperGeneration}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                  >
                    <FiX className="w-4 h-4" />
                    Stop Generation
                  </button>
                </div>
              </div>
            </div>
          )}

          {paperError && !generatingPaper && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
              <div className="w-16 h-16 rounded-full bg-accent-purple/10 flex items-center justify-center mb-4">
                <FiFileText className="w-8 h-8 text-accent-purple" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                {paperError.includes('not cached') ? 'Paper Not Cached' : 'Generation Failed'}
              </h3>
              <p className={`text-sm mb-4 max-w-md text-center ${paperError.includes('not cached') ? 'text-[var(--color-text-muted)]' : 'text-red-400'}`}>
                {paperError}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => generateHypothesisPaper(activeHypothesis)}
                  className="btn text-accent-purple hover:bg-accent-purple/10"
                >
                  <FiRefreshCw className="w-4 h-4 mr-1" />
                  {paperError.includes('not cached') ? 'Regenerate Paper' : 'Retry'}
                </button>
                <button onClick={closeViewer} className="btn text-[var(--color-text-secondary)] hover:bg-white/5">
                  Back
                </button>
              </div>
            </div>
          )}

          {paperHtml && (
            <iframe
              srcDoc={paperHtml}
              className="w-full h-full border-0"
              title="Research Paper"
              sandbox="allow-same-origin allow-popups allow-modals"
              style={{ minHeight: '100%' }}
            />
          )}

          {pdfBlobUrl && !paperHtml && (
            <object data={pdfBlobUrl} type="application/pdf" className="w-full h-full">
              <div className="flex flex-col items-center justify-center h-full">
                <p className="text-[var(--color-text-muted)] mb-4">Unable to display PDF inline.</p>
              </div>
            </object>
          )}
        </div>
      </div>
    )
  }

  // Default list view
  const highConf = uniqueHypotheses.filter(h => h.confidence >= 0.7).length
  const medConf = uniqueHypotheses.filter(h => h.confidence >= 0.5 && h.confidence < 0.7).length
  const lowConf = uniqueHypotheses.filter(h => h.confidence < 0.5).length

  return (
    <div className="p-8">
      <Link to="/projects" className="inline-flex items-center text-accent-blue hover:underline mb-6">
        <FiArrowLeft className="w-4 h-4 mr-2" />
        Back to Projects
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">{project.name}</h1>
        {project.description && (
          <p className="text-[var(--color-text-muted)] mt-2">{project.description}</p>
        )}
        {uniqueHypotheses.length > 0 && (
          <div className="relative inline-block">
            <button
              onClick={() => setShowChooser(!showChooser)}
              disabled={generatingPaper}
              className="mt-4 btn text-accent-purple hover:bg-accent-purple/10 disabled:opacity-50"
            >
              {generatingPaper ? (
                <FiRefreshCw className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <FiFileText className="w-4 h-4 mr-1" />
              )}
              {generatingPaper ? 'Generating Paper...' : 'Generate Research Paper'}
            </button>

            {showChooser && !generatingPaper && (
              <div className="absolute z-50 mt-2 w-96 max-h-80 overflow-y-auto glass-card p-0">
                <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
                  <span className="text-sm font-medium text-white">Choose a hypothesis for the paper</span>
                  <button onClick={() => setShowChooser(false)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                    <FiX className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-1">
                  {uniqueHypotheses.map((h, idx) => (
                    <button
                      key={h.id}
                      onClick={() => generateHypothesisPaper(h)}
                      className="w-full text-left p-3 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-text-muted)] font-mono text-xs shrink-0">#{idx + 1}</span>
                        <span className="text-white text-sm font-medium truncate flex-1">{h.title}</span>
                        <span className={clsx(
                          'text-xs font-bold shrink-0',
                          h.confidence >= 0.7 ? 'text-accent-green' :
                          h.confidence >= 0.5 ? 'text-accent-yellow' : 'text-accent-orange'
                        )}>
                          {(h.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      {h.description && (
                        <p className="text-[var(--color-text-muted)] text-xs mt-1 line-clamp-1 ml-6">{h.description}</p>
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
          <div className="glass-card">
            <h2 className="text-lg font-semibold text-white mb-4">Details</h2>
            <dl className="space-y-3">
              {project.disease_focus && (
                <div>
                  <dt className="text-[var(--color-text-muted)] text-sm">Disease Focus</dt>
                  <dd className="text-white">{project.disease_focus}</dd>
                </div>
              )}
              {project.research_question && (
                <div>
                  <dt className="text-[var(--color-text-muted)] text-sm">Research Question</dt>
                  <dd className="text-white">{project.research_question}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="glass-card">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center">
              <FiActivity className="w-5 h-5 mr-2 text-accent-blue" />
              Hypotheses ({uniqueHypotheses.length})
            </h2>

            {uniqueHypotheses.length > 0 ? (
              <div className="space-y-3">
                {uniqueHypotheses.map((h, idx) => (
                  <div
                    key={h.id}
                    className="border rounded-lg transition-colors border-[var(--color-border)] hover:border-white/10"
                  >
                    <button
                      onClick={() => openHypothesisViewer(h)}
                      className="w-full text-left p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                          <span className="text-[var(--color-text-muted)] font-mono text-sm shrink-0">#{idx + 1}</span>
                          <h3 className="font-medium text-white truncate">{h.title}</h3>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0 ml-2">
                          <span className={clsx(
                            'text-sm font-bold',
                            h.confidence >= 0.7 ? 'text-accent-green' :
                            h.confidence >= 0.5 ? 'text-accent-yellow' : 'text-accent-orange'
                          )}>
                            {(h.confidence * 100).toFixed(1)}%
                          </span>
                          <FiChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                        </div>
                      </div>
                      {h.description && (
                        <p className="text-[var(--color-text-muted)] text-sm mt-1 line-clamp-1 ml-8">{h.description}</p>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--color-text-muted)]">
                No hypotheses stored in this project yet. Run a discovery from the Agents page
                and save results to populate this project.
              </p>
            )}
          </div>

          <div className="glass-card">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center">
              <FiBook className="w-5 h-5 mr-2 text-accent-purple" />
              Research Papers ({projectPapers.length})
            </h2>

            {projectPapers.length > 0 ? (
              <div className="space-y-2">
                {projectPapers.map(paper => {
                  const hyp = uniqueHypotheses.find(h => h.id === paper.hypothesis_id)
                  return (
                    <div
                      key={paper.id}
                      className="flex items-center justify-between p-3 border border-[var(--color-border)] rounded-lg hover:border-white/10 transition-colors cursor-pointer"
                      onClick={async () => {
                        // Open the already-generated research paper
                        const h = hyp || {
                          id: paper.hypothesis_id,
                          title: paper.hypothesis_title,
                          description: '',
                          mechanism: '',
                          confidence: 0.5,
                          tags: [],
                          disease: paper.disease,
                          discovery_type: 'treatment',
                          project_id: paper.project_id,
                          created_at: paper.generated_at,
                        }
                        setActiveHypothesis(h)
                        setPaperError(null)
                        setGeneratingPaper(false)
                        setPdfBlobUrl(null)

                        // Re-read from localStorage to get latest paper_html
                        const freshPapers = persistGet<SavedResearchPaper[]>('research-papers', [])
                        const freshPaper = freshPapers.find(p => p.hypothesis_id === paper.hypothesis_id)
                        const storedHtml = freshPaper?.paper_html || paper.paper_html

                        if (storedHtml && storedHtml.length > 100) {
                          setPaperHtml(storedHtml)
                          setViewMode('hypothesis_paper')
                          return
                        }

                        // Try fetching from Lambda cache
                        try {
                          const statusRes = await fetch(`${API_BASE}/orchestrator/paper-status`)
                          if (statusRes.ok) {
                            const data = await statusRes.json()
                            if (data?.status === 'done' && data.paper_html?.length > 100
                                && data.hypothesis_id === paper.hypothesis_id) {
                              setPaperHtml(data.paper_html)
                              _saveResearchPaper(h, data.paper_html)
                              setViewMode('hypothesis_paper')
                              return
                            }
                          }
                        } catch { /* Lambda unavailable */ }

                        // No cached paper found — show paper view with a "not cached" message
                        // so user can regenerate explicitly
                        setPaperHtml(null)
                        setPaperError('This paper was generated in a previous session and the content was not cached. Click "Regenerate" below to generate it again.')
                        setViewMode('hypothesis_paper')
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FiFileText className="w-4 h-4 text-accent-purple shrink-0" />
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium truncate">{paper.hypothesis_title}</p>
                          <p className="text-[var(--color-text-muted)] text-xs">
                            {new Date(paper.generated_at).toLocaleDateString()} &middot; {paper.disease}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (hyp) generateHypothesisPaper(hyp)
                          }}
                          disabled={generatingPaper}
                          className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-accent-purple transition-colors"
                          title="Regenerate & view"
                        >
                          <FiRefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const updated = persistGet<SavedResearchPaper[]>('research-papers', []).filter(p => p.id !== paper.id)
                            persistSet('research-papers', updated)
                            setRefresh(n => n + 1)
                          }}
                          className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
                          title="Remove"
                        >
                          <FiTrash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-[var(--color-text-muted)] text-sm">
                No research papers generated yet. Click &ldquo;Generate Research Paper&rdquo; above
                and choose a hypothesis, or click a hypothesis to view it and generate from there.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card">
            <h2 className="text-lg font-semibold text-white mb-4">Statistics</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)]">Hypotheses</dt>
                <dd className="text-white font-medium">{uniqueHypotheses.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)]">Research Papers</dt>
                <dd className="text-white font-medium">{projectPapers.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)]">Status</dt>
                <dd className="text-white font-medium capitalize">{project.status || 'active'}</dd>
              </div>
            </dl>
          </div>

          {uniqueHypotheses.length > 0 && (
            <div className="glass-card">
              <h2 className="text-lg font-semibold text-white mb-4">Confidence Distribution</h2>
              <div className="space-y-2">
                {[
                  { label: 'High (>=70%)', count: highConf, color: 'bg-accent-green' },
                  { label: 'Medium (50-70%)', count: medConf, color: 'bg-accent-yellow' },
                  { label: 'Low (<50%)', count: lowConf, color: 'bg-accent-orange' },
                ].map(({ label, count, color }) => {
                  const pct = uniqueHypotheses.length > 0 ? (count / uniqueHypotheses.length) * 100 : 0
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[var(--color-text-muted)]">{label}</span>
                        <span className="text-white">{count}</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full">
                        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {project.tags && project.tags.length > 0 && (
            <div className="glass-card">
              <h2 className="text-lg font-semibold text-white mb-4">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {project.tags.map((tag: string) => (
                  <span key={tag} className="text-xs px-2 py-1 rounded bg-white/5 text-[var(--color-text-secondary)]">
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
