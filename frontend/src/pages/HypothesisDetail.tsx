import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FiArrowLeft, FiFileText, FiRefreshCw,
} from 'react-icons/fi'
import { api } from '../services/api'
import DocumentViewer from '../components/DocumentViewer'

const API_BASE = '/api/v1'

export default function HypothesisDetail() {
  const { hypothesisId } = useParams<{ hypothesisId: string }>()

  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [showViewer, setShowViewer] = useState(false)

  const { data: hypothesis, isLoading } = useQuery({
    queryKey: ['hypothesis', hypothesisId],
    queryFn: () => api.getHypothesis(hypothesisId!),
    enabled: !!hypothesisId,
  })

  const generatePaper = useCallback(async () => {
    if (!hypothesisId) return
    setGeneratingPaper(true)
    setShowViewer(true)
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(null)
    }

    try {
      const res = await fetch(`${API_BASE}/documents/hypothesis/${hypothesisId}/pdf?use_ai=true`, {
        method: 'POST',
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        setPdfBlobUrl(url)
        setGeneratingPaper(false)
        return
      }

      // Fallback error
      let detail = 'Unknown error'
      try { const err = await res.json(); detail = err.detail || detail } catch {}
      alert(`Paper generation failed: ${detail}`)
      setGeneratingPaper(false)
      setShowViewer(false)
    } catch (e) {
      console.error('Paper generation failed:', e)
      alert('Failed to generate paper')
      setGeneratingPaper(false)
      setShowViewer(false)
    }
  }, [hypothesisId, pdfBlobUrl])

  const closeViewer = useCallback(() => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
    setPdfBlobUrl(null)
    setShowViewer(false)
    setGeneratingPaper(false)
  }, [pdfBlobUrl])

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

  // ---- Document viewer mode ----
  if (showViewer) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 border-b border-secondary-700 flex items-center gap-2 shrink-0">
          <button onClick={closeViewer} className="text-primary-400 hover:text-primary-300 text-sm">
            <FiArrowLeft className="w-3.5 h-3.5 inline mr-1" />Back
          </button>
          <span className="text-secondary-600">/</span>
          <span className="text-secondary-400 text-sm truncate">{hypothesis.statement}</span>
        </div>
        <div className="flex-1 min-h-0">
          <DocumentViewer
            pdfUrl={pdfBlobUrl}
            title={`Research Paper: ${hypothesis.statement}`}
            onClose={closeViewer}
            filename={`humanovo-hypothesis-${hypothesisId}.pdf`}
            isGenerating={generatingPaper}
            progressMessage="Running document pipeline..."
          />
        </div>
      </div>
    )
  }

  // ---- Standard detail view ----
  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center space-x-3 mb-4">
          <span className={`badge ${
            hypothesis.status === 'validated' ? 'badge-success' :
            hypothesis.status === 'active' ? 'badge-info' :
            hypothesis.status === 'rejected' ? 'badge-error' :
            'badge-warning'
          }`}>
            {hypothesis.status}
          </span>
          <span className="text-secondary-400">v{hypothesis.version}</span>
        </div>
        <h1 className="text-2xl font-bold text-white">{hypothesis.statement}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Mechanism */}
          {hypothesis.mechanism && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-3">Mechanism</h2>
              <p className="text-secondary-300">{hypothesis.mechanism}</p>
            </div>
          )}

          {/* Rationale */}
          {hypothesis.rationale && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-3">Rationale</h2>
              <p className="text-secondary-300 whitespace-pre-wrap">{hypothesis.rationale}</p>
            </div>
          )}

          {/* Evidence */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Evidence</h2>
            {hypothesis.evidence_refs && hypothesis.evidence_refs.length > 0 ? (
              <div className="space-y-3">
                {hypothesis.evidence_refs.map((ref, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg border ${
                      ref.evidence_type === 'supporting'
                        ? 'bg-green-900/20 border-green-700'
                        : ref.evidence_type === 'contradicting'
                        ? 'bg-red-900/20 border-red-700'
                        : 'bg-secondary-800 border-secondary-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${
                        ref.evidence_type === 'supporting' ? 'text-green-400' :
                        ref.evidence_type === 'contradicting' ? 'text-red-400' :
                        'text-secondary-400'
                      }`}>
                        {ref.evidence_type}
                      </span>
                      <span className="text-secondary-500 text-xs">
                        {Math.round(ref.relevance_score * 100)}% relevance
                      </span>
                    </div>
                    {ref.snippet && (
                      <p className="text-secondary-300 text-sm">{ref.snippet}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-secondary-400">No evidence linked yet</p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Scores */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Scores</h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-secondary-400">Confidence</span>
                  <span className="text-white">{Math.round(hypothesis.confidence_score * 100)}%</span>
                </div>
                <div className="h-2 bg-secondary-700 rounded-full">
                  <div
                    className="h-full bg-primary-500 rounded-full"
                    style={{ width: `${hypothesis.confidence_score * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-secondary-400">Novelty</span>
                  <span className="text-white">{Math.round(hypothesis.novelty_score * 100)}%</span>
                </div>
                <div className="h-2 bg-secondary-700 rounded-full">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${hypothesis.novelty_score * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Actions</h2>
            <div className="space-y-2">
              <button
                onClick={generatePaper}
                disabled={generatingPaper}
                className="btn bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 w-full"
              >
                {generatingPaper ? (
                  <FiRefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <FiFileText className="w-4 h-4" />
                )}
                {generatingPaper ? 'Generating...' : 'Generate Research Paper'}
              </button>
              <button className="btn btn-primary w-full">Verify Hypothesis</button>
              <button className="btn btn-secondary w-full">Run Simulation</button>
              <button className="btn btn-secondary w-full">Find Evidence</button>
            </div>
          </div>

          {/* Simulation Results */}
          {hypothesis.simulation_results && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-4">Simulation</h2>
              <p className="text-secondary-300 text-sm">
                {hypothesis.simulation_results.summary}
              </p>
              <div className="mt-3 text-sm">
                <span className="text-secondary-400">Outcome probability: </span>
                <span className="text-white font-medium">
                  {Math.round(hypothesis.simulation_results.outcome_probability * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
