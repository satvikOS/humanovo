import { useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FiArrowLeft,
} from 'react-icons/fi'
import { api } from '../services/api'
import { HypothesisViewer } from '../components/DocumentViewer'

const API_BASE = '/api/v1'

export default function HypothesisDetail() {
  const { hypothesisId } = useParams<{ hypothesisId: string }>()

  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)

  const { data: hypothesis, isLoading } = useQuery({
    queryKey: ['hypothesis', hypothesisId],
    queryFn: () => api.getHypothesis(hypothesisId!),
    enabled: !!hypothesisId,
  })

  const generatePaper = useCallback(async () => {
    if (!hypothesisId) return
    setGeneratingPaper(true)
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(null)
    }

    try {
      // Send hypothesis data in body so backend doesn't need to look it up
      const res = await fetch(`${API_BASE}/documents/hypothesis/${hypothesisId}/pdf?use_ai=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: hypothesis?.statement || '',
          description: hypothesis?.rationale || hypothesis?.mechanism || '',
          mechanism: hypothesis?.mechanism || '',
          confidence: hypothesis?.confidence_score || 0,
          disease: 'Unknown',
          discovery_type: 'treatment',
          model_used: 'unknown',
          tags: hypothesis?.tags || [],
          external_factors: [],
        }),
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
    } catch (e) {
      console.error('Paper generation failed:', e)
      alert('Failed to generate paper')
      setGeneratingPaper(false)
    }
  }, [hypothesisId, pdfBlobUrl])

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

  // Map API hypothesis to HypothesisViewer format
  const viewerHypothesis = {
    id: hypothesis.id,
    title: hypothesis.statement,
    description: hypothesis.rationale || hypothesis.mechanism || '',
    mechanism: hypothesis.mechanism,
    confidence: hypothesis.confidence_score,
    tags: hypothesis.tags,
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-secondary-700 flex items-center gap-2 shrink-0">
        <button
          onClick={() => window.history.back()}
          className="text-primary-400 hover:text-primary-300 text-sm"
        >
          <FiArrowLeft className="w-3.5 h-3.5 inline mr-1" />Back
        </button>
        <span className="text-secondary-600">/</span>
        <span className="text-secondary-400 text-sm truncate">{hypothesis.statement}</span>
      </div>
      <div className="flex-1 min-h-0">
        <HypothesisViewer
          hypothesis={viewerHypothesis}
          pdfUrl={pdfBlobUrl}
          isGenerating={generatingPaper}
          onGeneratePaper={generatePaper}
          onClose={() => window.history.back()}
        />
      </div>
    </div>
  )
}
