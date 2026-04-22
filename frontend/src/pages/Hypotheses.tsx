import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FiZap, FiCheck, FiAlertTriangle, FiClock, FiDownload, FiRefreshCw } from 'react-icons/fi'
import { api, Hypothesis } from '../services/api'
import clsx from 'clsx'

const API_BASE = '/api/v1'

// Download hypothesis PDF from backend (ReportLab) with client-side fallback
async function downloadHypothesisPdf(hypothesisId: string, hypothesisData: {
  title: string
  description?: string
  mechanism?: string
  confidence: number
  disease?: string
  tags?: string[]
}) {
  const response = await fetch(`${API_BASE}/documents/hypothesis/${hypothesisId}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: hypothesisData.title,
      description: hypothesisData.description || '',
      mechanism: hypothesisData.mechanism || '',
      confidence: hypothesisData.confidence,
      disease: hypothesisData.disease || 'Research',
      tags: hypothesisData.tags || [],
    }),
  })
  if (response.ok) {
    const data = await response.json()
    const byteChars = atob(data.pdf_base64)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
    const blob = new Blob([byteArray], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = data.filename || `humanovo-${hypothesisData.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }
}

function HypothesisCard({ hypothesis }: { hypothesis: Hypothesis }) {
  const [exporting, setExporting] = useState(false)

  const statusConfig = {
    draft: { icon: FiClock, color: 'text-secondary-400', bg: 'bg-secondary-600/20' },
    generating: { icon: FiClock, color: 'text-[var(--color-text-muted)]', bg: 'bg-yellow-600/20' },
    active: { icon: FiZap, color: 'text-[var(--color-text)]', bg: 'bg-[var(--color-surface-raised)]' },
    validated: { icon: FiCheck, color: 'text-[var(--color-text-secondary)]', bg: 'bg-green-600/20' },
    rejected: { icon: FiAlertTriangle, color: 'text-[var(--color-text-muted)]', bg: 'bg-red-600/20' },
    archived: { icon: FiClock, color: 'text-secondary-400', bg: 'bg-secondary-600/20' },
  }

  const status = statusConfig[hypothesis.status] || statusConfig.draft
  const StatusIcon = status.icon

  const handleExportPdf = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setExporting(true)
    try {
      await downloadHypothesisPdf(hypothesis.id, {
        title: hypothesis.statement,
        description: hypothesis.rationale || hypothesis.mechanism || '',
        mechanism: hypothesis.mechanism || '',
        confidence: (hypothesis.confidence_score != null && Number.isFinite(hypothesis.confidence_score)) ? hypothesis.confidence_score : 0,
        tags: hypothesis.tags,
      })
    } finally {
      setTimeout(() => setExporting(false), 1000)
    }
  }, [hypothesis])

  return (
    <Link
      to={`/hypotheses/${hypothesis.id}`}
      className="card hover:border-primary-600/50 transition-colors"
    >
      <div className="flex items-start space-x-4">
        <div className={clsx('p-2 rounded-lg', status.bg)}>
          <StatusIcon className={clsx('w-5 h-5', status.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium line-clamp-2">{hypothesis.statement}</p>
          {hypothesis.mechanism && (
            <p className="text-secondary-400 text-sm mt-1 line-clamp-1">
              {hypothesis.mechanism}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <span className={clsx('badge', {
            'badge-success': hypothesis.status === 'validated',
            'badge-warning': hypothesis.status === 'generating',
            'badge-error': hypothesis.status === 'rejected',
            'badge-info': hypothesis.status === 'active',
          })}>
            {hypothesis.status}
          </span>
          <span className="text-secondary-400 text-sm">
            {Number.isFinite(hypothesis.confidence_score) && hypothesis.confidence_score != null
              ? `${Math.round(hypothesis.confidence_score * 100)}% confidence`
              : '-- confidence'}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleExportPdf}
            disabled={exporting}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10 disabled:opacity-50 transition-colors"
            title="Export as PDF" aria-label="Export as PDF"
          >
            {exporting ? (
              <FiRefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FiDownload className="w-3.5 h-3.5" />
            )}
            {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
          <span className="text-secondary-500 text-xs">
            v{hypothesis.version}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center space-x-4 text-sm">
        <span className="text-[var(--color-text-secondary)]">
          {hypothesis.supporting_count} supporting
        </span>
        <span className="text-[var(--color-text-muted)]">
          {hypothesis.contradiction_count} contradicting
        </span>
      </div>
    </Link>
  )
}

type SortKey = 'confidence' | 'novelty' | 'recent' | 'title'
type StatusFilter = 'all' | 'draft' | 'validated' | 'active' | 'rejected'

export default function Hypotheses() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hypotheses'],
    queryFn: () => api.getHypotheses({ page: 1, page_size: 50 }),
    retry: 1,
  })
  const [sortKey, setSortKey] = useState<SortKey>('confidence')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const apiHypotheses = data?.items || []
  const filtered = apiHypotheses
    .filter(h => statusFilter === 'all' || h.status === statusFilter)
    .filter(h => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        (h.statement || '').toLowerCase().includes(q)
        || (h.mechanism || '').toLowerCase().includes(q)
        || (h.tags || []).some(t => t.toLowerCase().includes(q))
      )
    })
    .sort((a, b) => {
      switch (sortKey) {
        case 'confidence': return (b.confidence_score ?? 0) - (a.confidence_score ?? 0)
        case 'novelty':    return (b.novelty_score ?? 0)   - (a.novelty_score ?? 0)
        case 'recent':     return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        case 'title':      return (a.statement || '').localeCompare(b.statement || '')
        default:           return 0
      }
    })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Hypotheses</h1>
          <p className="text-secondary-400 mt-1">
            AI-generated biomedical hypotheses
            {apiHypotheses.length > 0 && (
              <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                {filtered.length}/{apiHypotheses.length}
              </span>
            )}
          </p>
        </div>
        <Link to="/agents" className="btn btn-primary flex items-center space-x-2">
          <FiZap className="w-4 h-4" />
          <span>Generate New</span>
        </Link>
      </div>

      {/* Filter row */}
      {apiHypotheses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search statements, mechanisms, tags…"
            aria-label="Search hypotheses"
            className="bg-[var(--glass-bg)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm flex-1 min-w-[200px]"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by status"
            className="bg-[var(--glass-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
          >
            <option value="all">All status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="validated">Validated</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            aria-label="Sort hypotheses"
            className="bg-[var(--glass-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
          >
            <option value="confidence">Confidence ↓</option>
            <option value="novelty">Novelty ↓</option>
            <option value="recent">Most recent</option>
            <option value="title">Title (A–Z)</option>
          </select>
        </div>
      )}

      {isError && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-[var(--color-text-muted)]">
          Backend is offline. Run a discovery from the Agents page first.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-secondary-800 h-32 rounded-lg" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map((hypothesis) => (
            <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} />
          ))}
        </div>
      ) : apiHypotheses.length > 0 ? (
        <div className="text-center py-16">
          <FiZap className="w-12 h-12 text-secondary-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No hypotheses match your filters</h3>
          <p className="text-secondary-400 mb-6">Clear the search or change the status filter.</p>
        </div>
      ) : (
        <div className="text-center py-16">
          <FiZap className="w-12 h-12 text-secondary-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No hypotheses yet</h3>
          <p className="text-secondary-400 mb-6">
            Generate your first AI-powered hypothesis from the Discovery page
          </p>
          <Link to="/agents" className="btn btn-primary">Start Discovery</Link>
        </div>
      )}
    </div>
  )
}
