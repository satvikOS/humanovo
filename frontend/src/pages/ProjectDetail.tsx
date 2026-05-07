import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  FiArrowLeft, FiActivity, FiTarget,
  FiChevronRight, FiFileText, FiRefreshCw,
  FiTrash2, FiBook, FiX, FiPrinter,
  FiUpload, FiFile, FiEye, FiEdit2, FiCheck,
} from 'react-icons/fi'
import clsx from 'clsx'
import api, { Project, apiClient } from '../services/api'
import { logActivity, formatDate, usePersistentState, blobPut, blobGet, blobDelete } from '../utils/persistence'
import HypothesisDocViewer, { type TranslationalRoadmapDoc } from '../components/HypothesisDocViewer'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { useEscapeKey } from '../utils/clickable'
import { useSavedPapers } from '../hooks/useSavedPapers'


// SavedResearchPaper is now sourced from the backend (SavedPaperSummary +
// SavedPaperDetail in services/api.ts). The local interface that lived
// here was a localStorage shape; persistence moved to /api/v1/saved-papers
// in Round 4b, and the writes path is wired in Round 4c via
// useSavedPapers(projectId).

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
  translational_roadmap?: TranslationalRoadmapDoc
}

interface ProjectDocument {
  id: string
  project_id: string
  title: string
  doc_type: string
  authors: string
  date: string
  description: string
  tags: string[]
  filename: string
  file_size: number
  mime_type: string
  uploaded_at: string
  knowledge_base: 'private' | 'common'
  // data_base64 is stored in IndexedDB, NOT in this object (to avoid localStorage size limits)
}

const DOC_TYPES = ['Protocol', 'Report', 'Dataset', 'Consent Form', 'IRB Approval', 'Lab Notes', 'Manuscript', 'Supplementary', 'Other'] as const

type ViewMode = 'list' | 'hypothesis_viewer' | 'hypothesis_paper' | 'document_viewer'

/** Standalone doc viewer that loads blob content from IndexedDB asynchronously */
function DocumentViewer({ doc, onClose }: { doc: ProjectDocument; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isImage = doc.mime_type.startsWith('image/')
  const isPdf = doc.mime_type === 'application/pdf'
  const isText = doc.mime_type.startsWith('text/') || doc.mime_type.includes('json') || doc.mime_type.includes('xml')

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const base64 = await blobGet(doc.id)
        if (cancelled) return
        if (!base64) {
          setError('File content not found. It may need to be re-uploaded on this device.')
          setLoading(false)
          return
        }
        // Convert base64 to Blob → ObjectURL (handles large files properly)
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: doc.mime_type })
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
        if (isText) {
          try { setTextContent(new TextDecoder().decode(bytes)) } catch { setTextContent(null) }
        }
      } catch (e) {
        if (!cancelled) setError(`Failed to load document: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [doc.id])

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-sm flex items-center gap-1">
            <FiArrowLeft className="w-3.5 h-3.5" />Back
          </button>
          <span className="text-[var(--color-text-muted)]">/</span>
          <span className="text-[var(--color-text)] text-sm font-medium truncate max-w-md">{doc.title}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span>{doc.doc_type}</span>
          {doc.authors && <span>{doc.authors}</span>}
          <span>{formatDate(doc.date)}</span>
          {blobUrl && (
            <a href={blobUrl} download={doc.filename} className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Download">
              <FiFile className="w-3.5 h-3.5" />
            </a>
          )}
          <button aria-label="Close" onClick={onClose} className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
            <FiX className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <FiFile className="w-16 h-16 text-[var(--color-text-muted)] opacity-30" />
            <p className="text-[var(--color-text-muted)] text-sm">{error}</p>
          </div>
        )}
        {!loading && blobUrl && isPdf && (
          <iframe src={`${blobUrl}#toolbar=0&navpanes=0`} className="w-full h-full border-0" title={doc.title} />
        )}
        {!loading && blobUrl && isImage && (
          <div className="flex items-center justify-center h-full p-8">
            <img src={blobUrl} alt={doc.title} className="max-w-full max-h-full object-contain rounded" />
          </div>
        )}
        {!loading && blobUrl && isText && textContent && (
          <div className="p-8 overflow-auto h-full">
            <pre className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono">{textContent}</pre>
          </div>
        )}
        {!loading && blobUrl && !isPdf && !isImage && !isText && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <FiFile className="w-16 h-16 text-[var(--color-text-muted)] opacity-30" />
            <p className="text-[var(--color-text-muted)]">Preview not available for this file type</p>
            <a href={blobUrl} download={doc.filename} className="text-sm text-[var(--color-text-secondary)] hover:underline">Download {doc.filename}</a>
          </div>
        )}
      </div>
      {doc.description && (
        <div className="px-6 py-3 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
          {doc.description}
        </div>
      )}
    </div>
  )
}

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
  // Project from API
  const [project, setProject] = useState<Project | null>(null)
  const [loadingProject, setLoadingProject] = useState(true)

  // Document viewer state
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [paperHtml, setPaperHtml] = useState<string | null>(null)
  const [paperError, setPaperError] = useState<string | null>(null)
  const [activeHypothesis, setActiveHypothesis] = useState<SavedHypothesis | null>(null)
  const [deletePaperId, setDeletePaperId] = useState<string | null>(null)

  // Documents state
  const [allDocs, setAllDocs] = usePersistentState<ProjectDocument[]>('project-documents', [])
  const projectDocs = allDocs.filter(d => d.project_id === projectId)
  const setProjectDocs = useCallback((updater: ProjectDocument[] | ((prev: ProjectDocument[]) => ProjectDocument[])) => {
    setAllDocs(prev => {
      const others = prev.filter(d => d.project_id !== projectId)
      const current = prev.filter(d => d.project_id === projectId)
      const next = typeof updater === 'function' ? updater(current) : updater
      return [...next, ...others]
    })
  }, [projectId, setAllDocs])
  const [showDocUpload, setShowDocUpload] = useState(false)
  // Wire global Escape closer for the doc-upload modal (sibling backdrop;
  // focus is in the file input so backdrop's own keydown never fires).
  useEscapeKey(() => setShowDocUpload(false), showDocUpload)
  const [docForm, setDocForm] = useState({ title: '', doc_type: 'Protocol' as string, authors: '', date: '', description: '', tags: '', knowledge_base: 'private' as 'private' | 'common' })
  const [docFile, setDocFile] = useState<File | null>(null)
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null)
  const [viewingDoc, setViewingDoc] = useState<ProjectDocument | null>(null)
  const docInputRef = useRef<HTMLInputElement>(null)

  // Project edit state
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', disease_focus: '', tags: '', research_question: '' })
  const [editSaving, setEditSaving] = useState(false)

  const startEditing = useCallback(() => {
    if (!project) return
    setEditForm({
      name: project.name,
      description: project.description || '',
      disease_focus: project.disease_focus || '',
      tags: (project.tags || []).join(', '),
      research_question: project.research_question || '',
    })
    setIsEditing(true)
  }, [project])

  const saveEdit = useCallback(async () => {
    if (!project || !projectId) return
    setEditSaving(true)
    try {
      const updated = await api.updateProject(projectId, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || undefined,
        disease_focus: editForm.disease_focus.trim() || undefined,
        research_question: editForm.research_question.trim() || undefined,
        tags: editForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      })
      setProject(updated)
      setIsEditing(false)
      logActivity({ type: 'project', action: 'updated', title: `Edited project: ${updated.name}` })
    } catch (err: unknown) {
      console.error('Failed to update project', err)
    } finally {
      setEditSaving(false)
    }
  }, [project, projectId, editForm])

  // Loading phase animation
  const [currentPhase, setCurrentPhase] = useState(0)
  const [phaseProgress, setPhaseProgress] = useState(0)
  const phaseTimerRef = useRef<number | null>(null)
  const progressTimerRef = useRef<number | null>(null)

  // Hypothesis chooser modal state
  const [showChooser, setShowChooser] = useState(false)

  // Load project from API
  useEffect(() => {
    if (!projectId) return
    loadProject()
  }, [projectId])

  const [loadError, setLoadError] = useState<string | null>(null)

  const loadProject = async () => {
    if (!projectId) return
    setLoadingProject(true)
    setLoadError(null)
    try {
      const proj = await api.getProject(projectId)
      setProject(proj)
    } catch (err: unknown) {
      console.warn('ProjectDetail: failed to load project from API', err)
      const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string }
      const status = e?.response?.status
      const errData = e?.response?.data
      // Lambda returns 400 with error:"not_found" (not 404, to avoid CloudFront HTML intercept)
      if (status === 404 || (status === 400 && errData?.error === 'not_found')) {
        setLoadError('This project does not exist in the database.')
      } else if (status === 422) {
        setLoadError('Invalid project ID format.')
      } else {
        setLoadError(e?.message || 'Failed to load project. The backend may be unavailable.')
      }
    } finally {
      setLoadingProject(false)
    }
  }

  // Get hypotheses from API project data only
  const uniqueHypotheses = (project?.hypotheses || []).map(h => ({
    id: h.id,
    title: h.title,
    description: h.description,
    mechanism: h.mechanism,
    confidence: (h as { confidence?: number; confidence_score?: number }).confidence ?? (h as { confidence?: number; confidence_score?: number }).confidence_score ?? 0,
    tags: [] as string[],
    disease: project?.disease_focus || '',
    discovery_type: 'treatment',
    project_id: projectId || '',
    created_at: h.created_at,
    model_used: h.model_used,
  }))

  // Research papers — backend-backed (Round 4b/4c). The hook fetches
  // /api/v1/saved-papers?project_id={id} on mount and exposes CRUD that
  // round-trips to the API. Listing rows are summaries (no paper_html);
  // getPaperHtml lazily fetches the rendered body when the user opens
  // the paper viewer.
  const {
    papers: projectPapers,
    createPaper: apiCreatePaper,
    deletePaper: apiDeletePaper,
    getPaperHtml: apiGetPaperHtml,
  } = useSavedPapers(projectId)

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
      await apiClient.post('/orchestrator/cancel-paper')
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
        const statusRes = await apiClient.get('/orchestrator/paper-status')
        const statusData = statusRes.data
        // Only use cached paper if it matches this specific hypothesis
        if (statusData.status === 'done' && statusData.paper_html && statusData.paper_html.length > 100
            && statusData.hypothesis_id === hypothesis.id) {
          cachedHtml = statusData.paper_html
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
      let triggerData: Record<string, unknown> | null = null
      let triggerOk = false
      try {
        const triggerRes = await apiClient.post('/orchestrator/generate-paper/markdown', {
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
        })
        triggerData = triggerRes.data
        triggerOk = true
      } catch {
        triggerOk = false
      }

      if (triggerOk && triggerData) {
        // If backend says paper already exists, fetch it immediately
        if (triggerData.status === 'already_done') {
          try {
            const doneRes = await apiClient.get('/orchestrator/paper-status')
            const doneData = doneRes.data
            if (doneData.paper_html && doneData.paper_html.length > 100) {
              stopPhaseAnimation()
              setPaperHtml(doneData.paper_html)
              setGeneratingPaper(false)
              _saveResearchPaper(hypothesis, doneData.paper_html)
              return
            }
          } catch { /* fall through to polling */ }
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
              const pollRes = await apiClient.get('/orchestrator/paper-status')
              const pollData = pollRes.data
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
            } catch { /* network hiccup, keep polling */ }
          }
          return false
        }

        const completed = await pollForPaper()
        if (completed) return
      }

      // Step 3: Fallback — try FastAPI HTML endpoint.
      // validateStatus=()=>true so we can inspect content-type on failure
      // and still emit a sensible fallback rather than throw through the
      // global error interceptor for a known-soft endpoint.
      stopPhaseAnimation()
      const bodyObj = JSON.parse(bodyPayload)
      try {
        const htmlRes = await apiClient.post(
          `/documents/hypothesis/${hypothesis.id}/html`,
          bodyObj,
          { responseType: 'text', validateStatus: () => true },
        )
        const contentType = String(htmlRes.headers['content-type'] || '')
        if (htmlRes.status < 400 && contentType.includes('text/html')) {
          const html = String(htmlRes.data || '')
          if (html.length > 100) {
            setPaperHtml(html)
            setGeneratingPaper(false)
            _saveResearchPaper(hypothesis, html)
            return
          }
        }
      } catch { /* fall through to pdf endpoint */ }

      // Step 4: Last resort — try PDF endpoint (JSON-wrapped base64 or
      // direct PDF blob). Axios blob responseType works for both; a
      // JSON response is returned as a Blob of type application/json
      // which we detect and parse.
      try {
        const pdfRes = await apiClient.post(
          `/documents/hypothesis/${hypothesis.id}/pdf`,
          bodyObj,
          { params: { use_ai: true }, responseType: 'blob', validateStatus: () => true },
        )
        if (pdfRes.status >= 400) {
          setPaperError('Paper generation failed. Check backend logs.')
          setGeneratingPaper(false)
          return
        }
        const rawBlob = pdfRes.data as Blob
        const contentType = rawBlob.type || String(pdfRes.headers['content-type'] || '')
        let blob: Blob
        if (contentType.includes('application/json')) {
          const text = await rawBlob.text()
          const data = JSON.parse(text)
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
          blob = rawBlob
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
      } catch { /* fall through to error */ }

      setPaperError('Paper generation failed. Check backend logs.')
      setGeneratingPaper(false)
    } catch (e) {
      stopPhaseAnimation()
      console.error('Hypothesis paper generation failed:', e)
      setPaperError(`Paper generation failed: ${e instanceof Error ? e.message : String(e)}`)
      setGeneratingPaper(false)
    }
  }, [project, startPhaseAnimation, stopPhaseAnimation])

  const confirmDeletePaper = useCallback(async () => {
    if (!deletePaperId) return
    try {
      await apiDeletePaper(deletePaperId)
    } catch (e) {
      console.error('Failed to delete saved paper:', e)
    } finally {
      setDeletePaperId(null)
    }
  }, [deletePaperId, apiDeletePaper])

  const _saveResearchPaper = useCallback(async (hypothesis: SavedHypothesis, html?: string) => {
    // Skip if we have no rendered HTML — saving a row with an empty body
    // creates an artifact the user can't actually open. The earlier
    // localStorage version stored html-less stub rows; the backend
    // `paper_html` column is NOT NULL, so this guard is required.
    if (!html) return
    const filename = `humanovo-${hypothesis.title.replace(/\s+/g, '-').toLowerCase().slice(0, 50)}.pdf`
    try {
      // Upsert semantics — if the user re-runs paper generation for the
      // same hypothesis, replace the prior row rather than accumulate
      // duplicates. Until a PATCH /saved-papers/{id} endpoint lands,
      // delete-then-create is the simplest path.
      const existing = projectPapers.find(p => p.hypothesis_id === hypothesis.id)
      if (existing) {
        await apiDeletePaper(existing.id)
      }
      await apiCreatePaper({
        hypothesis_id: hypothesis.id,
        project_id: hypothesis.project_id,
        hypothesis_title: hypothesis.title,
        disease: hypothesis.disease || project?.disease_focus || 'Unknown',
        filename,
        paper_html: html,
      })
      logActivity({ type: 'evidence', action: 'created', title: `Research paper: ${hypothesis.title}`, project: project?.name })
    } catch (e) {
      console.error('Failed to save research paper:', e)
    }
  }, [project, projectPapers, apiCreatePaper, apiDeletePaper])

  const handleDocUpload = useCallback(async () => {
    if (!docFile || !docForm.title.trim() || !projectId) return
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1] || ''
      const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // Store the file blob in IndexedDB (no size limits)
      await blobPut(docId, base64)
      // Store metadata in localStorage (small, syncs across devices)
      const doc: ProjectDocument = {
        id: docId,
        project_id: projectId,
        title: docForm.title.trim(),
        doc_type: docForm.doc_type,
        authors: docForm.authors.trim(),
        date: docForm.date || new Date().toISOString().split('T')[0],
        description: docForm.description.trim(),
        tags: docForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        filename: docFile.name,
        file_size: docFile.size,
        mime_type: docFile.type,
        uploaded_at: new Date().toISOString(),
        knowledge_base: docForm.knowledge_base,
      }
      setProjectDocs(prev => [doc, ...prev])
      // Also upload to backend ingestion for AI knowledge base
      try {
        const { default: apiService } = await import('../services/api')
        await apiService.uploadDocument(docFile, { project_id: projectId })
      } catch { /* Backend may be unavailable — local storage still works */ }
      logActivity({ type: 'evidence', action: 'imported', title: `Uploaded document: ${docForm.title} (${docForm.knowledge_base} KB)`, project: project?.name })
      setShowDocUpload(false)
      setDocForm({ title: '', doc_type: 'Protocol', authors: '', date: '', description: '', tags: '', knowledge_base: 'private' })
      setDocFile(null)
    }
    reader.readAsDataURL(docFile)
  }, [docFile, docForm, projectId, project, setProjectDocs])

  const confirmDeleteDoc = async () => {
    if (!deleteDocId) return
    const doc = projectDocs.find(d => d.id === deleteDocId)
    await blobDelete(deleteDocId).catch(err => {
      // Local IndexedDB blob deletion failing is non-fatal (the doc
      // record itself was already removed); log so a dev can see if
      // the blob store is actually broken vs the doc never had a blob.
      console.warn('ProjectDetail: failed to delete document blob (record removed anyway)', err)
    })
    setProjectDocs(prev => prev.filter(d => d.id !== deleteDocId))
    logActivity({ type: 'evidence', action: 'deleted', title: `Deleted document: ${doc?.title || deleteDocId}`, project: project?.name })
    setDeleteDocId(null)
  }

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
        <Link to="/projects" className="inline-flex items-center text-[var(--color-text-secondary)] hover:underline mb-6">
          <FiArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Link>
        <div className="glass-card text-center py-12">
          <FiTarget className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
          <h2 className="text-xl font-semibold text-white mb-2">Project Not Found</h2>
          <p className="text-[var(--color-text-muted)] max-w-md mx-auto">
            {loadError || 'This project could not be loaded. It may have been deleted or the backend may be unavailable.'}
          </p>
          <button
            onClick={loadProject}
            className="mt-4 btn text-[var(--color-text-secondary)] hover:bg-white/5"
          >
            <FiRefreshCw className="w-4 h-4 mr-1" />
            Retry
          </button>
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
            const res = await apiClient.post(`/documents/hypothesis/${activeHypothesis.id}/pdf`, {
              title: activeHypothesis.title,
              description: activeHypothesis.description,
              mechanism: activeHypothesis.mechanism,
              confidence: activeHypothesis.confidence,
              disease: activeHypothesis.disease || project?.disease_focus || 'Research',
              discovery_type: activeHypothesis.discovery_type || 'treatment',
            })
            const data = res.data
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
            <Link to="/projects" className="text-[var(--color-text-secondary)] hover:underline text-sm">
              <FiArrowLeft className="w-3.5 h-3.5 inline mr-1" />Projects
            </Link>
            <span className="text-[var(--color-text-muted)]">/</span>
            <button onClick={closeViewer} className="text-[var(--color-text-secondary)] hover:underline text-sm">
              {project.name}
            </button>
            <span className="text-[var(--color-text-muted)]">/</span>
            <span className="text-[var(--color-text-muted)] text-sm truncate max-w-xs">{activeHypothesis.title}</span>
          </div>
          <div className="flex items-center gap-2">
            {paperHtml && (
              <button onClick={printPaper} className="btn text-[var(--color-text-secondary)] hover:bg-white/5 text-sm">
                <FiPrinter className="w-3.5 h-3.5 mr-1" />
                Print
              </button>
            )}
            <button aria-label="Close" onClick={closeViewer} className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
              <FiX className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 relative">
          {generatingPaper && !pdfBlobUrl && !paperHtml && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
              <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-white/10" />
                <div className="absolute inset-0 rounded-full border-4 border-t-white animate-spin" />
                <FiFileText className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-[var(--color-text-secondary)]" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Generating Research Paper</h3>
              <p className="text-[var(--color-text-muted)] text-sm mb-1">{activeHypothesis.title}</p>
              <div className="mt-6 w-full max-w-lg px-8">
                <div className="mb-3">
                  <p className="text-[var(--color-text-secondary)] text-sm font-medium text-center">
                    {PAPER_PHASES[currentPhase]?.label || 'Processing...'}
                  </p>
                  <p className="text-[var(--color-text-muted)] text-xs text-center mt-1">
                    Step {currentPhase + 1} of {PAPER_PHASES.length}
                  </p>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-white/20 rounded-full transition-all duration-200 ease-linear"
                    style={{ width: `${((currentPhase + phaseProgress / 100) / PAPER_PHASES.length) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between px-1">
                  {PAPER_PHASES.map((_, idx) => (
                    <div
                      key={idx}
                      className={clsx(
                        'w-2 h-2 rounded-full transition-colors',
                        idx < currentPhase ? 'bg-white/20' :
                        idx === currentPhase ? 'bg-white/20/60 animate-pulse' : 'bg-white/10'
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
              <div className="w-16 h-16 rounded-full bg-white/20/10 flex items-center justify-center mb-4">
                <FiFileText className="w-8 h-8 text-[var(--color-text-secondary)]" />
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
                  className="btn text-[var(--color-text-secondary)] hover:bg-white/5"
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

  // Document viewer — loads blob from IndexedDB
  if (viewMode === 'document_viewer' && viewingDoc) {
    return <DocumentViewer doc={viewingDoc} onClose={() => { setViewingDoc(null); setViewMode('list') }} />
  }

  // Default list view
  const safeConf = (c: unknown) => (typeof c === 'number' && !isNaN(c)) ? c : 0
  const highConf = uniqueHypotheses.filter(h => safeConf(h.confidence) >= 0.7).length
  const medConf = uniqueHypotheses.filter(h => safeConf(h.confidence) >= 0.5 && safeConf(h.confidence) < 0.7).length
  const lowConf = uniqueHypotheses.filter(h => safeConf(h.confidence) < 0.5).length

  // Parse project title — show disease name only, strip discovery type and datetime from subtitle
  const titleParts = project.name.split(' — ')
  const displayTitle = project.disease_focus || titleParts[0] || project.name
  const discoveryPattern = /discovery$/i
  const dateTimePattern = /^\w{3}\s+\d{1,2}\s+\d{4}|^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{4}|^\d{2}:\d{2}/
  const subtitleParts = titleParts
    .slice(1)
    .filter(part => {
      const trimmed = part.trim()
      if (discoveryPattern.test(trimmed)) return false
      if (dateTimePattern.test(trimmed)) return false
      return true
    })
    .filter(Boolean)
  // Also include the first part if it differs from displayTitle
  if (titleParts[1] && titleParts[0] !== displayTitle) {
    const first = titleParts[0].trim()
    if (!discoveryPattern.test(first) && !dateTimePattern.test(first)) {
      subtitleParts.unshift(first)
    }
  }

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <Link to="/projects" className="inline-flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-8 text-sm">
        <FiArrowLeft className="w-4 h-4 mr-2" />
        Back to Projects
      </Link>

      <div className="mb-10">
        {isEditing ? (
          <div className="glass-card p-6 space-y-4 max-w-2xl">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold text-white">Edit Project</h2>
              <button onClick={() => setIsEditing(false)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Project Name</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Description</label>
              <textarea
                value={editForm.description}
                onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)] resize-none"
                placeholder="Project description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Disease Focus</label>
                <input
                  value={editForm.disease_focus}
                  onChange={e => setEditForm(prev => ({ ...prev, disease_focus: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)]"
                  placeholder="e.g. Alzheimer's Disease"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Tags</label>
                <input
                  value={editForm.tags}
                  onChange={e => setEditForm(prev => ({ ...prev, tags: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)]"
                  placeholder="Comma-separated tags"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Research Question</label>
              <textarea
                value={editForm.research_question}
                onChange={e => setEditForm(prev => ({ ...prev, research_question: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)] resize-none"
                placeholder="What is the main research question?"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-lg hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!editForm.name.trim() || editSaving}
                className="px-4 py-2 text-sm text-white bg-white/10 hover:bg-white/15 rounded-lg border border-[var(--color-border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {editSaving ? <FiRefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FiCheck className="w-3.5 h-3.5" />}
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-white">{displayTitle}</h1>
              <button
                onClick={startEditing}
                className="p-2 rounded-lg hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                title="Edit project info" aria-label="Edit project info"
              >
                <FiEdit2 className="w-4 h-4" />
              </button>
            </div>
            {subtitleParts.length > 0 && (
              <p className="text-[var(--color-text-muted)] text-sm mt-1.5">{subtitleParts.join(' \u00B7 ')}</p>
            )}
            {project.description && (
              <p className="text-[var(--color-text-secondary)] mt-3 text-sm leading-relaxed max-w-2xl">{project.description}</p>
            )}
          </>
        )}
        {!isEditing && uniqueHypotheses.length > 0 && (
          <div className="relative inline-block mt-5">
            <button
              onClick={() => setShowChooser(!showChooser)}
              disabled={generatingPaper}
              className="btn text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-white/5 border border-[var(--color-border)] disabled:opacity-50"
            >
              {generatingPaper ? (
                <FiRefreshCw className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <FiFileText className="w-4 h-4 mr-1.5" />
              )}
              {generatingPaper ? 'Generating Paper...' : 'Generate Research Paper'}
            </button>

            {showChooser && !generatingPaper && (
              <div className="absolute z-50 mt-2 w-96 max-h-80 overflow-y-auto glass-card p-0">
                <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
                  <span className="text-sm font-medium text-white">Choose a hypothesis</span>
                  <button onClick={() => setShowChooser(false)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                    <FiX className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-1.5">
                  {uniqueHypotheses.map((h, idx) => (
                    <button
                      key={h.id}
                      onClick={() => generateHypothesisPaper(h)}
                      className="w-full text-left p-3 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-text-muted)] font-mono text-xs shrink-0">#{idx + 1}</span>
                        <span className="text-white text-sm font-medium truncate flex-1">{h.title}</span>
                        <span className="text-xs text-[var(--color-text-secondary)] shrink-0">
                          {(safeConf(h.confidence) * 100).toFixed(0)}%
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-8">
          {/* Details */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white">Details</h2>
              <button
                onClick={startEditing}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 border border-[var(--color-border)] transition-colors"
              >
                <FiEdit2 className="w-3 h-3" /> Edit
              </button>
            </div>
            <dl className="space-y-4">
              {project.disease_focus && (
                <div>
                  <dt className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider mb-1">Disease Focus</dt>
                  <dd className="text-white text-sm">{project.disease_focus}</dd>
                </div>
              )}
              {project.research_question && (
                <div>
                  <dt className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider mb-1">Research Question</dt>
                  <dd className="text-white text-sm">{project.research_question}</dd>
                </div>
              )}
              {!project.disease_focus && !project.research_question && (
                <p className="text-[var(--color-text-muted)] text-sm">No details added yet. Click Edit to add disease focus, research question, and tags.</p>
              )}
            </dl>
          </div>

          {/* Hypotheses */}
          <div className="glass-card p-6">
            <h2 className="text-base font-semibold text-white mb-5 flex items-center">
              <FiActivity className="w-4 h-4 mr-2 text-[var(--color-text-muted)]" />
              Hypotheses ({uniqueHypotheses.length})
            </h2>

            {uniqueHypotheses.length > 0 ? (
              <div className="space-y-3">
                {uniqueHypotheses.map((h, idx) => (
                  <div
                    key={h.id}
                    className="border rounded-lg transition-colors border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                  >
                    <button
                      onClick={() => openHypothesisViewer(h)}
                      className="w-full text-left px-5 py-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <span className="text-[var(--color-text-muted)] font-mono text-xs shrink-0">#{idx + 1}</span>
                          <h3 className="font-medium text-white text-sm truncate">{h.title}</h3>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm text-[var(--color-text-secondary)]">
                            {(safeConf(h.confidence) * 100).toFixed(0)}%
                          </span>
                          <FiChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                        </div>
                      </div>
                      {h.description && (
                        <p className="text-[var(--color-text-muted)] text-xs mt-2 line-clamp-1 ml-8">{h.description}</p>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--color-text-muted)] text-sm">
                No hypotheses yet. Run a discovery from the Agents page to populate this project.
              </p>
            )}
          </div>

          {/* Research Papers */}
          <div className="glass-card p-6">
            <h2 className="text-base font-semibold text-white mb-5 flex items-center">
              <FiBook className="w-4 h-4 mr-2 text-[var(--color-text-muted)]" />
              Research Papers ({projectPapers.length})
            </h2>

            {projectPapers.length > 0 ? (
              <div className="space-y-2">
                {projectPapers.map(paper => {
                  const hyp = uniqueHypotheses.find(h => h.id === paper.hypothesis_id)
                  return (
                    <div
                      key={paper.id}
                      className="flex items-center justify-between px-4 py-3 border border-[var(--color-border)] rounded-lg hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
                      onClick={async () => {
                        const h = hyp || {
                          id: paper.hypothesis_id,
                          title: paper.hypothesis_title,
                          description: '',
                          mechanism: '',
                          confidence: 0.5,
                          tags: [],
                          disease: paper.disease || 'Unknown',
                          discovery_type: 'treatment',
                          project_id: paper.project_id || projectId || '',
                          created_at: paper.created_at,
                        }
                        setActiveHypothesis(h)
                        setPaperError(null)
                        setGeneratingPaper(false)
                        setPdfBlobUrl(null)

                        // Lazy-fetch the rendered HTML from the backend.
                        // The list endpoint omits paper_html for response-
                        // size reasons; getPaperHtml hits the detail
                        // endpoint and returns the body string.
                        try {
                          const html = await apiGetPaperHtml(paper.id)
                          if (html && html.length > 100) {
                            setPaperHtml(html)
                            setViewMode('hypothesis_paper')
                            return
                          }
                        } catch (e) {
                          console.error('Failed to fetch paper HTML:', e)
                        }

                        // Fallback: an in-flight orchestrator run may still
                        // have the freshly-rendered HTML in memory.
                        try {
                          const statusRes = await apiClient.get('/orchestrator/paper-status')
                          const data = statusRes.data
                          if (data?.status === 'done' && data.paper_html?.length > 100
                              && data.hypothesis_id === paper.hypothesis_id) {
                            setPaperHtml(data.paper_html)
                            _saveResearchPaper(h, data.paper_html)
                            setViewMode('hypothesis_paper')
                            return
                          }
                        } catch { /* Lambda unavailable */ }

                        setPaperHtml(null)
                        setPaperError('This paper could not be loaded. Click "Regenerate" below to generate it again.')
                        setViewMode('hypothesis_paper')
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FiFileText className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium truncate">{paper.hypothesis_title}</p>
                          <p className="text-[var(--color-text-muted)] text-xs mt-0.5">
                            {formatDate(paper.created_at)} &middot; {paper.disease || 'Unknown'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); if (hyp) generateHypothesisPaper(hyp) }}
                          disabled={generatingPaper}
                          className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                          title="Regenerate"
                        >
                          <FiRefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletePaperId(paper.id) }}
                          className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
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
                No research papers generated yet. Click &ldquo;Generate Research Paper&rdquo; above to create one.
              </p>
            )}
          </div>

          {/* Documents */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white flex items-center">
                <FiFile className="w-4 h-4 mr-2 text-[var(--color-text-muted)]" />
                Documents ({projectDocs.length})
              </h2>
              <button
                onClick={() => setShowDocUpload(true)}
                className="btn text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-white/5 border border-[var(--color-border)] text-xs"
              >
                <FiUpload className="w-3.5 h-3.5 mr-1.5" />
                Upload Document
              </button>
            </div>

            {projectDocs.length > 0 ? (
              <div className="space-y-2">
                {projectDocs.map(doc => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between px-4 py-3 border border-[var(--color-border)] rounded-lg hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
                    onClick={() => { setViewingDoc(doc); setViewMode('document_viewer') }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FiFile className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{doc.title}</p>
                        <p className="text-[var(--color-text-muted)] text-xs mt-0.5">
                          {doc.doc_type} &middot; {formatDate(doc.date)} &middot; {(doc.file_size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); setViewingDoc(doc); setViewMode('document_viewer') }}
                        className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        title="View"
                      >
                        <FiEye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteDocId(doc.id) }}
                        className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        title="Remove"
                      >
                        <FiTrash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--color-text-muted)] text-sm">
                No documents uploaded yet. Upload protocols, reports, datasets, or any relevant files.
              </p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          <div className="glass-card p-6">
            <h2 className="text-base font-semibold text-white mb-5">Statistics</h2>
            <dl className="space-y-4">
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)] text-sm">Hypotheses</dt>
                <dd className="text-white font-medium">{uniqueHypotheses.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)] text-sm">Research Papers</dt>
                <dd className="text-white font-medium">{projectPapers.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)] text-sm">Documents</dt>
                <dd className="text-white font-medium">{projectDocs.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)] text-sm">Evidence</dt>
                <dd className="text-white font-medium">{(project.evidence_count || 0) + projectDocs.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)] text-sm">Status</dt>
                <dd className="text-white font-medium capitalize">{project.status || 'active'}</dd>
              </div>
            </dl>
          </div>

          {uniqueHypotheses.length > 0 && (
            <div className="glass-card p-6">
              <h2 className="text-base font-semibold text-white mb-5">Confidence Distribution</h2>
              <div className="space-y-3">
                {[
                  { label: 'High (\u226570%)', count: highConf, color: '#2d6a4f' },
                  { label: 'Medium (50\u201370%)', count: medConf, color: '#0096c7' },
                  { label: 'Low (<50%)', count: lowConf, color: '#991b1b' },
                ].map(({ label, count, color }) => {
                  const pct = uniqueHypotheses.length > 0 ? (count / uniqueHypotheses.length) * 100 : 0
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="text-[var(--color-text-muted)]">{label}</span>
                        <span className="text-white">{count}</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {project.tags && project.tags.length > 0 && (
            <div className="glass-card p-6">
              <h2 className="text-base font-semibold text-white mb-5">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {project.tags.map((tag: string) => (
                  <span key={tag} className="text-xs px-2.5 py-1 rounded bg-white/5 text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Document Upload Modal */}
      {showDocUpload && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowDocUpload(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-lg glass-card p-0" style={{ background: 'var(--color-surface-solid)' }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <h3 className="text-base font-semibold text-white">Upload Document</h3>
                <button onClick={() => setShowDocUpload(false)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                  <FiX className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* File drop zone */}
                <div
                  onClick={() => docInputRef.current?.click()}
                  className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-6 text-center cursor-pointer hover:border-[var(--color-border-strong)] transition-colors"
                >
                  <input
                    ref={docInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) {
                        setDocFile(f)
                        if (!docForm.title) setDocForm(prev => ({ ...prev, title: f.name.replace(/\.[^.]+$/, '') }))
                      }
                    }}
                  />
                  {docFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FiFile className="w-5 h-5 text-[var(--color-text-secondary)]" />
                      <span className="text-sm text-white">{docFile.name}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">({(docFile.size / 1024).toFixed(0)} KB)</span>
                    </div>
                  ) : (
                    <>
                      <FiUpload className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-2" />
                      <p className="text-sm text-[var(--color-text-muted)]">Click to select a file</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">PDF, DOC, images, spreadsheets, etc.</p>
                    </>
                  )}
                </div>

                {/* Title */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Title *</label>
                  <input
                    value={docForm.title}
                    onChange={e => setDocForm(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)]"
                    placeholder="Document title"
                  />
                </div>

                {/* Type + Date row */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Type</label>
                    <select
                      value={docForm.doc_type}
                      onChange={e => setDocForm(prev => ({ ...prev, doc_type: e.target.value }))}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white focus:outline-none focus:border-[var(--color-border-strong)]"
                    >
                      {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Date</label>
                    <input
                      type="date"
                      value={docForm.date}
                      onChange={e => setDocForm(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white focus:outline-none focus:border-[var(--color-border-strong)]"
                    />
                  </div>
                </div>

                {/* Authors */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Authors</label>
                  <input
                    value={docForm.authors}
                    onChange={e => setDocForm(prev => ({ ...prev, authors: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)]"
                    placeholder="Author names"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Description</label>
                  <textarea
                    value={docForm.description}
                    onChange={e => setDocForm(prev => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)] resize-none"
                    placeholder="Brief description of this document"
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">Tags</label>
                  <input
                    value={docForm.tags}
                    onChange={e => setDocForm(prev => ({ ...prev, tags: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-strong)]"
                    placeholder="Comma-separated tags"
                  />
                </div>

                {/* Knowledge Base */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 block">Knowledge Base</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setDocForm(prev => ({ ...prev, knowledge_base: 'private' }))}
                      className={`flex-1 p-3 rounded-lg border text-left transition-colors ${docForm.knowledge_base === 'private' ? 'border-[var(--color-border-strong)] bg-white/5' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}`}
                    >
                      <div className="text-sm text-white font-medium">Private</div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5">Only you and your AI can access this document</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocForm(prev => ({ ...prev, knowledge_base: 'common' }))}
                      className={`flex-1 p-3 rounded-lg border text-left transition-colors ${docForm.knowledge_base === 'common' ? 'border-[var(--color-border-strong)] bg-white/5' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}`}
                    >
                      <div className="text-sm text-white font-medium">Common</div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5">Shared with all users. May earn royalties if used in others' discoveries</div>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
                <button
                  onClick={() => setShowDocUpload(false)}
                  className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-lg hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDocUpload}
                  disabled={!docFile || !docForm.title.trim()}
                  className="px-4 py-2 text-sm text-white bg-white/10 hover:bg-white/15 rounded-lg border border-[var(--color-border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Upload
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {deletePaperId && (
        <ConfirmDeleteDialog
          title="Delete Research Paper?"
          message="This will permanently delete this generated research paper. This action cannot be undone."
          onConfirm={confirmDeletePaper}
          onCancel={() => setDeletePaperId(null)}
        />
      )}
      {deleteDocId && (
        <ConfirmDeleteDialog
          title="Delete Document?"
          message="This will permanently delete this document. This action cannot be undone."
          onConfirm={confirmDeleteDoc}
          onCancel={() => setDeleteDocId(null)}
        />
      )}
    </div>
  )
}
