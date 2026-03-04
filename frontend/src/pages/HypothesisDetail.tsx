import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FiArrowLeft, FiFileText, FiRefreshCw, FiX, FiDownload,
} from 'react-icons/fi'
import clsx from 'clsx'
import { api } from '../services/api'

const API_BASE = '/api/v1'

const PAPER_PHASES = [
  { label: 'Initializing 8-model pipeline...', duration: 3000 },
  { label: 'Phase 1: Generating abstract & introduction...', duration: 12000 },
  { label: 'Phase 2: Core sections — literature, methods, results...', duration: 25000 },
  { label: 'Phase 3: Synthesis — discussion, mechanisms, conclusion...', duration: 20000 },
  { label: 'Phase 4: QA & review...', duration: 15000 },
  { label: 'Rendering PDF...', duration: 8000 },
]

export default function HypothesisDetail() {
  const { hypothesisId } = useParams<{ hypothesisId: string }>()

  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [paperError, setPaperError] = useState<string | null>(null)
  const [currentPhase, setCurrentPhase] = useState(0)
  const [phaseProgress, setPhaseProgress] = useState(0)
  const progressTimerRef = useRef<number | null>(null)

  const { data: hypothesis, isLoading } = useQuery({
    queryKey: ['hypothesis', hypothesisId],
    queryFn: () => api.getHypothesis(hypothesisId!),
    enabled: !!hypothesisId,
  })

  useEffect(() => {
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current) }
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
  }, [])

  const generatePaper = useCallback(async () => {
    if (!hypothesisId || !hypothesis) return
    setGeneratingPaper(true)
    setPaperError(null)
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(null)
    }
    startPhaseAnimation()

    try {
      const res = await fetch(`${API_BASE}/documents/hypothesis/${hypothesisId}/pdf?use_ai=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: hypothesis.statement || '',
          description: hypothesis.rationale || hypothesis.mechanism || '',
          mechanism: hypothesis.mechanism || '',
          confidence: hypothesis.confidence_score || 0,
          disease: 'Unknown',
          discovery_type: 'treatment',
          model_used: 'unknown',
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
        return
      }

      let detail = 'Unknown error'
      try { const err = await res.json(); detail = err.detail || detail } catch {}
      setPaperError(`Paper generation failed (${res.status}): ${detail}`)
      setGeneratingPaper(false)
    } catch (e) {
      stopPhaseAnimation()
      console.error('Paper generation failed:', e)
      setPaperError(`Paper generation failed: ${e instanceof Error ? e.message : String(e)}`)
      setGeneratingPaper(false)
    }
  }, [hypothesisId, hypothesis, pdfBlobUrl, startPhaseAnimation, stopPhaseAnimation])

  const downloadPdf = useCallback(() => {
    if (!pdfBlobUrl) return
    const a = document.createElement('a')
    a.href = pdfBlobUrl
    a.download = `humanovo-hypothesis-${hypothesisId}.pdf`
    a.click()
  }, [pdfBlobUrl, hypothesisId])

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-secondary-800 rounded w-2/3" />
          <div className="h-4 bg-secondary-800 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!hypothesis) {
    return (
      <div className="p-8">
        <p className="text-secondary-400">Hypothesis not found</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-secondary-700 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.history.back()}
            className="text-primary-400 hover:text-primary-300 text-sm"
          >
            <FiArrowLeft className="w-3.5 h-3.5 inline mr-1" />Back
          </button>
          <span className="text-secondary-600">/</span>
          <span className="text-secondary-400 text-sm truncate">{hypothesis.statement}</span>
        </div>
        <div className="flex items-center gap-2">
          {!pdfBlobUrl && !generatingPaper && (
            <button onClick={generatePaper} className="btn btn-sm bg-purple-500 text-white hover:bg-purple-600">
              <FiFileText className="w-3.5 h-3.5" />
              Generate Research Paper
            </button>
          )}
          {pdfBlobUrl && (
            <button onClick={downloadPdf} className="btn btn-sm bg-purple-500/20 text-purple-400 hover:bg-purple-500/30">
              <FiDownload className="w-3.5 h-3.5" />
              Download PDF
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {/* Loading animation with phases */}
        {generatingPaper && !pdfBlobUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary-900 z-10">
            <div className="relative w-24 h-24 mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-secondary-700" />
              <div className="absolute inset-0 rounded-full border-4 border-t-purple-500 animate-spin" />
              <FiFileText className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-purple-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Generating Research Paper</h3>
            <div className="mt-4 w-full max-w-lg px-8">
              <p className="text-purple-300 text-sm font-medium text-center mb-1">
                {PAPER_PHASES[currentPhase]?.label || 'Processing...'}
              </p>
              <p className="text-secondary-500 text-xs text-center mb-3">
                Step {currentPhase + 1} of {PAPER_PHASES.length}
              </p>
              <div className="h-2 bg-secondary-700 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all duration-200 ease-linear"
                  style={{ width: `${((currentPhase + phaseProgress / 100) / PAPER_PHASES.length) * 100}%` }}
                />
              </div>
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
            </div>
          </div>
        )}

        {/* Error */}
        {paperError && !generatingPaper && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary-900 z-10">
            <FiX className="w-12 h-12 text-red-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Generation Failed</h3>
            <p className="text-red-400 text-sm mb-4 max-w-md text-center">{paperError}</p>
            <button onClick={generatePaper} className="btn bg-purple-500 text-white hover:bg-purple-600">
              <FiRefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}

        {/* PDF viewer */}
        {pdfBlobUrl && (
          <object data={pdfBlobUrl} type="application/pdf" className="w-full h-full">
            <div className="flex flex-col items-center justify-center h-full">
              <p className="text-secondary-400 mb-4">Unable to display PDF inline.</p>
              <button onClick={downloadPdf} className="btn bg-purple-500 text-white hover:bg-purple-600">
                <FiDownload className="w-4 h-4" /> Download PDF
              </button>
            </div>
          </object>
        )}

        {/* Default: show hypothesis content */}
        {!generatingPaper && !pdfBlobUrl && !paperError && (
          <div className="overflow-y-auto p-8">
            <div className="max-w-4xl mx-auto">
              <h1 className="text-2xl font-bold text-white mb-4">{hypothesis.statement}</h1>
              <div className="flex items-center gap-3 mb-6">
                <span className={clsx(
                  'px-3 py-1 rounded-full text-sm font-bold',
                  (hypothesis.confidence_score || 0) >= 0.7 ? 'bg-green-500/20 text-green-400' :
                  (hypothesis.confidence_score || 0) >= 0.5 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-orange-500/20 text-orange-400'
                )}>
                  {((hypothesis.confidence_score || 0) * 100).toFixed(1)}% Confidence
                </span>
              </div>
              {hypothesis.rationale && (
                <div className="mb-6">
                  <h2 className="text-xs font-semibold text-secondary-400 uppercase tracking-wider mb-2">Rationale</h2>
                  <p className="text-secondary-200 leading-relaxed whitespace-pre-wrap">{hypothesis.rationale}</p>
                </div>
              )}
              {hypothesis.mechanism && (
                <div className="mb-6">
                  <h2 className="text-xs font-semibold text-secondary-400 uppercase tracking-wider mb-2">Mechanism</h2>
                  <div className="bg-secondary-800 border border-secondary-700 rounded-lg p-4">
                    <p className="text-secondary-200 leading-relaxed whitespace-pre-wrap">{hypothesis.mechanism}</p>
                  </div>
                </div>
              )}

              {/* Generate Paper CTA */}
              <div className="mt-8 p-6 bg-purple-500/10 border border-purple-500/30 rounded-lg text-center">
                <FiFileText className="w-8 h-8 text-purple-400 mx-auto mb-3" />
                <h3 className="text-white font-semibold mb-1">Generate FDA/R&D-Grade Research Paper</h3>
                <p className="text-secondary-400 text-sm mb-4">
                  Professional PDF with cover page, TOC, citations, diagrams, and tables using 8 AI models.
                </p>
                <button onClick={generatePaper} className="btn bg-purple-500 text-white hover:bg-purple-600">
                  <FiFileText className="w-4 h-4" />
                  Generate Research Paper (PDF)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
