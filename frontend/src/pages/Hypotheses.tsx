import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { FiZap, FiCheck, FiAlertTriangle, FiClock, FiDownload, FiRefreshCw } from 'react-icons/fi'
import { api, apiClient, Hypothesis } from '../services/api'
import { EmptyState } from '../components/EmptyState'
import clsx from 'clsx'

// Download hypothesis PDF from backend (ReportLab) with client-side fallback.
// Binary endpoint — uses responseType 'blob' + validateStatus to silently
// handle both direct-PDF and JSON-wrapped-base64 response shapes.
async function downloadHypothesisPdf(hypothesisId: string, hypothesisData: {
  title: string
  description?: string
  mechanism?: string
  confidence: number
  disease?: string
  tags?: string[]
}) {
  const response = await apiClient.post(
    `/documents/hypothesis/${hypothesisId}/pdf`,
    {
      title: hypothesisData.title,
      description: hypothesisData.description || '',
      mechanism: hypothesisData.mechanism || '',
      confidence: hypothesisData.confidence,
      disease: hypothesisData.disease || 'Research',
      tags: hypothesisData.tags || [],
    },
    { responseType: 'blob', validateStatus: () => true },
  )
  if (response.status >= 400) return
  const rawBlob = response.data as Blob
  const contentType = rawBlob.type || String(response.headers['content-type'] || '')
  let blob: Blob
  let filename = `humanovo-${hypothesisData.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.pdf`
  if (contentType.includes('application/json')) {
    const text = await rawBlob.text()
    const data = JSON.parse(text)
    if (!data.pdf_base64) return
    const byteChars = atob(data.pdf_base64)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
    blob = new Blob([byteArray], { type: 'application/pdf' })
    filename = data.filename || filename
  } else {
    blob = rawBlob
  }
  if (blob.size === 0) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function HypothesisCard({ hypothesis }: { hypothesis: Hypothesis }) {
  const [exporting, setExporting] = useState(false)

  // Muted-only status: icon + label carry the meaning, no decorative
  // tints. Rejection keeps no red accent because this is an
  // informational filter chip, not a destructive action.
  const statusConfig = {
    draft: { icon: FiClock, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
    generating: { icon: FiClock, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
    active: { icon: FiZap, color: 'text-[var(--color-text)]', bg: 'bg-[var(--color-surface-raised)]' },
    validated: { icon: FiCheck, color: 'text-[var(--color-text-secondary)]', bg: 'bg-[var(--glass-bg)]' },
    rejected: { icon: FiAlertTriangle, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
    archived: { icon: FiClock, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
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
      className="glass-card p-4 block hover:bg-[var(--glass-bg-hover)] hover:border-[var(--color-border-strong)] transition-all"
    >
      <div className="flex items-start gap-3">
        <div className={clsx('p-2 rounded-lg flex-shrink-0', status.bg)}>
          <StatusIcon className={clsx('w-4 h-4', status.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: 'var(--color-text)' }}>
            {hypothesis.statement}
          </p>
          {hypothesis.mechanism && (
            <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
              {hypothesis.mechanism}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)]" style={{ color: 'var(--color-text-muted)' }}>
            {hypothesis.status}
          </span>
          <span className="text-xxs" style={{ color: 'var(--color-text-muted)' }}>
            {Number.isFinite(hypothesis.confidence_score) && hypothesis.confidence_score != null
              ? `${Math.round(hypothesis.confidence_score * 100)}% confidence`
              : '-- confidence'}
          </span>
          {Number.isFinite(hypothesis.novelty_score) && hypothesis.novelty_score != null && (
            <span className="text-xxs" style={{ color: 'var(--color-text-muted)' }}>
              {Math.round(hypothesis.novelty_score * 100)}% novelty
            </span>
          )}
          <span className="text-xxs" style={{ color: 'var(--color-text-muted)' }}>
            {hypothesis.supporting_count} ↑ · {hypothesis.contradiction_count} ↓
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExportPdf}
            disabled={exporting}
            className="flex items-center gap-1 px-2 py-1 rounded text-xxs hover:bg-[var(--glass-bg-hover)] disabled:opacity-40 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            title="Export as PDF"
            aria-label="Export as PDF"
          >
            {exporting ? <FiRefreshCw className="w-3 h-3 animate-spin" /> : <FiDownload className="w-3 h-3" />}
            {exporting ? 'Exporting…' : 'PDF'}
          </button>
          <span className="text-xxs ml-1" style={{ color: 'var(--color-text-muted)' }}>
            v{hypothesis.version}
          </span>
        </div>
      </div>
    </Link>
  )
}

type SortKey = 'confidence' | 'novelty' | 'recent' | 'title'
type StatusFilter = 'all' | 'draft' | 'validated' | 'active' | 'rejected'

export default function Hypotheses() {
  const navigate = useNavigate()
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
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hypotheses</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            AI-generated biomedical hypotheses
            {apiHypotheses.length > 0 && (
              <span className="ml-2 text-xs">
                {filtered.length}/{apiHypotheses.length}
              </span>
            )}
          </p>
        </div>
        <Link
          to="/agents"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
          style={{
            background: 'rgba(91, 141, 184, 0.25)',
            border: '1px solid rgba(91, 141, 184, 0.35)',
            color: '#fff',
            borderRadius: 10,
          }}
        >
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
        <EmptyState
          icon={<FiZap />}
          title="No hypotheses match your filters"
          description="Clear the search or change the status filter."
          action={{
            label: 'Clear filters',
            onClick: () => { setSearch(''); setStatusFilter('all') },
          }}
        />
      ) : (
        <EmptyState
          icon={<FiZap />}
          title="No hypotheses yet"
          description="Generate your first AI-powered hypothesis from the Discovery page."
          action={{
            label: 'Start Discovery',
            onClick: () => navigate('/agents'),
          }}
        />
      )}
    </div>
  )
}
