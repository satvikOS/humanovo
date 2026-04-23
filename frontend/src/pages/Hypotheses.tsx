import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { FiZap, FiCheck, FiAlertTriangle, FiClock, FiDownload, FiRefreshCw, FiEdit3, FiX } from 'react-icons/fi'
import { api, apiClient, Hypothesis } from '../services/api'
import { EmptyState } from '../components/EmptyState'
import { toast } from '../contexts/ToastContext'
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

// Muted-only status palette. Icon + label carry the meaning.
const STATUS_CONFIG = {
  draft: { icon: FiClock, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
  generating: { icon: FiClock, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
  active: { icon: FiZap, color: 'text-[var(--color-text)]', bg: 'bg-[var(--color-surface-raised)]' },
  validated: { icon: FiCheck, color: 'text-[var(--color-text-secondary)]', bg: 'bg-[var(--glass-bg)]' },
  rejected: { icon: FiAlertTriangle, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
  archived: { icon: FiClock, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
}
const STATUS_OPTIONS = ['draft', 'active', 'validated', 'rejected', 'archived'] as const

function HypothesisCard({
  hypothesis, onEdited, onShowEvidence,
}: {
  hypothesis: Hypothesis
  onEdited: (h: Hypothesis) => void
  onShowEvidence: (h: Hypothesis) => void
}) {
  const [exporting, setExporting] = useState(false)
  const [editingField, setEditingField] = useState<null | 'statement' | 'mechanism' | 'tags' | 'status' | 'confidence'>(null)
  const [draftValue, setDraftValue] = useState<string>('')
  const [draftConfidence, setDraftConfidence] = useState<number>(0.5)

  const status = STATUS_CONFIG[hypothesis.status] || STATUS_CONFIG.draft
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

  const startEdit = (field: 'statement' | 'mechanism' | 'tags' | 'status' | 'confidence', e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingField(field)
    if (field === 'statement') setDraftValue(hypothesis.statement || '')
    else if (field === 'mechanism') setDraftValue(hypothesis.mechanism || '')
    else if (field === 'tags') setDraftValue((hypothesis.tags || []).join(', '))
    else if (field === 'confidence') setDraftConfidence(hypothesis.confidence_score ?? 0.5)
  }

  const commit = async (field: typeof editingField, override?: string | number) => {
    if (!field) return
    let payload: Partial<Hypothesis> = {}
    if (field === 'statement') payload = { statement: draftValue.trim() || hypothesis.statement }
    else if (field === 'mechanism') payload = { mechanism: draftValue.trim() }
    else if (field === 'tags') payload = { tags: draftValue.split(',').map(t => t.trim()).filter(Boolean) }
    else if (field === 'status') payload = { status: String(override) as Hypothesis['status'] }
    else if (field === 'confidence') payload = { confidence_score: Number(override ?? draftConfidence) }
    try {
      const updated = await api.updateHypothesis(hypothesis.id, payload)
      onEdited(updated)
      toast('success', 'Saved')
    } catch (err: any) {
      toast('error', err?.message || 'Save failed', { title: 'Could not save' })
    } finally {
      setEditingField(null)
    }
  }

  const cancelEdit = () => setEditingField(null)

  return (
    <div className="glass-card p-4 hover:border-[var(--color-border-strong)] transition-all">
      <div className="flex items-start gap-3">
        <div className={clsx('p-2 rounded-lg flex-shrink-0', status.bg)}>
          <StatusIcon className={clsx('w-4 h-4', status.color)} />
        </div>
        <div className="flex-1 min-w-0">
          {editingField === 'statement' ? (
            <textarea
              value={draftValue}
              onChange={e => setDraftValue(e.target.value)}
              onBlur={() => commit('statement')}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit('statement') }
                if (e.key === 'Escape') cancelEdit()
              }}
              autoFocus
              rows={2}
              className="w-full bg-[var(--glass-bg)] border border-[var(--color-border-strong)] rounded px-2 py-1 text-sm font-medium resize-y"
              style={{ color: 'var(--color-text)' }}
              aria-label="Edit statement"
            />
          ) : (
            <div className="flex items-start gap-1 group">
              <Link
                to={`/hypotheses/${hypothesis.id}`}
                className="text-sm font-medium leading-snug line-clamp-2 hover:underline flex-1"
                style={{ color: 'var(--color-text)' }}
                onDoubleClick={e => startEdit('statement', e)}
              >
                {hypothesis.statement}
              </Link>
              <button
                onClick={e => startEdit('statement', e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                title="Edit statement"
                aria-label="Edit statement"
              >
                <FiEdit3 className="w-3 h-3" />
              </button>
            </div>
          )}
          {editingField === 'mechanism' ? (
            <textarea
              value={draftValue}
              onChange={e => setDraftValue(e.target.value)}
              onBlur={() => commit('mechanism')}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit('mechanism') }
                if (e.key === 'Escape') cancelEdit()
              }}
              autoFocus
              rows={2}
              className="mt-2 w-full bg-[var(--glass-bg)] border border-[var(--color-border-strong)] rounded px-2 py-1 text-xs resize-y"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Edit mechanism"
              placeholder="Mechanism…"
            />
          ) : hypothesis.mechanism ? (
            <p
              className="text-xs mt-1 line-clamp-2 cursor-text"
              style={{ color: 'var(--color-text-muted)' }}
              onDoubleClick={e => startEdit('mechanism', e)}
              title="Double-click to edit"
            >
              {hypothesis.mechanism}
            </p>
          ) : (
            <button
              onClick={e => startEdit('mechanism', e)}
              className="text-xs mt-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline decoration-dotted"
            >
              Add mechanism…
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status chip — click to toggle */}
          {editingField === 'status' ? (
            <select
              value={hypothesis.status}
              onChange={e => commit('status', e.target.value)}
              onBlur={cancelEdit}
              autoFocus
              className="text-xxs bg-[var(--glass-bg)] border border-[var(--color-border-strong)] rounded px-1.5 py-0.5"
              style={{ color: 'var(--color-text)' }}
              aria-label="Change status"
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <button
              onClick={e => startEdit('status', e)}
              className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] hover:border hover:border-[var(--color-border-strong)]"
              style={{ color: 'var(--color-text-muted)' }}
              title="Click to change status"
            >
              {hypothesis.status}
            </button>
          )}

          {/* Confidence — click for slider */}
          {editingField === 'confidence' ? (
            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draftConfidence}
                onChange={e => setDraftConfidence(Number(e.target.value))}
                onMouseUp={() => commit('confidence')}
                onTouchEnd={() => commit('confidence')}
                className="accent-[var(--color-text)]"
                style={{ width: 80 }}
                aria-label="Confidence score"
              />
              <span className="text-xxs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                {Math.round(draftConfidence * 100)}%
              </span>
              <button onClick={cancelEdit} aria-label="Cancel" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <FiX className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={e => startEdit('confidence', e)}
              className="text-xxs hover:underline decoration-dotted"
              style={{ color: 'var(--color-text-muted)' }}
              title="Click to adjust confidence"
            >
              {Number.isFinite(hypothesis.confidence_score) && hypothesis.confidence_score != null
                ? `${Math.round(hypothesis.confidence_score * 100)}% confidence`
                : '-- confidence'}
            </button>
          )}
          {Number.isFinite(hypothesis.novelty_score) && hypothesis.novelty_score != null && (
            <span className="text-xxs" style={{ color: 'var(--color-text-muted)' }}>
              {Math.round(hypothesis.novelty_score * 100)}% novelty
            </span>
          )}

          {/* Evidence drill-down — the up/down counts are now clickable */}
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onShowEvidence(hypothesis) }}
            className="text-xxs hover:underline decoration-dotted"
            style={{ color: 'var(--color-text-muted)' }}
            title="Show linked evidence"
          >
            {hypothesis.supporting_count} ↑ · {hypothesis.contradiction_count} ↓
          </button>
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

      {/* Tags row */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {editingField === 'tags' ? (
          <input
            value={draftValue}
            onChange={e => setDraftValue(e.target.value)}
            onBlur={() => commit('tags')}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit('tags') }
              if (e.key === 'Escape') cancelEdit()
            }}
            autoFocus
            className="text-xxs bg-[var(--glass-bg)] border border-[var(--color-border-strong)] rounded px-1.5 py-0.5 flex-1"
            style={{ color: 'var(--color-text)' }}
            placeholder="tag1, tag2, tag3"
            aria-label="Edit tags (comma-separated)"
          />
        ) : (
          <>
            {(hypothesis.tags || []).slice(0, 6).map(t => (
              <span key={t} className="text-xxs px-1.5 py-0.5 rounded border border-[var(--glass-border)]" style={{ color: 'var(--color-text-muted)' }}>
                {t}
              </span>
            ))}
            <button
              onClick={e => startEdit('tags', e)}
              className="text-xxs hover:text-[var(--color-text)] text-[var(--color-text-muted)] underline decoration-dotted"
              title="Edit tags"
            >
              {hypothesis.tags && hypothesis.tags.length > 0 ? 'edit tags' : 'add tags'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Compact confidence-distribution sparkline rendered above the list. */
function ConfidenceHistogram({ scores }: { scores: number[] }) {
  if (!scores.length) return null
  const bins = Array.from({ length: 10 }, () => 0)
  for (const s of scores) {
    const idx = Math.min(9, Math.max(0, Math.floor(s * 10)))
    bins[idx]++
  }
  const max = Math.max(...bins, 1)
  return (
    <div className="mb-4 p-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Confidence distribution</span>
        <span className="text-xxs" style={{ color: 'var(--color-text-muted)' }}>
          n={scores.length} · median {Math.round((scores.slice().sort((a, b) => a - b)[Math.floor(scores.length / 2)] || 0) * 100)}%
        </span>
      </div>
      <div className="flex items-end gap-1 h-12">
        {bins.map((count, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-[var(--color-text-muted)] opacity-60"
            style={{ height: `${(count / max) * 100}%`, minHeight: count > 0 ? 2 : 0 }}
            title={`${(i * 10)}–${((i + 1) * 10)}%: ${count}`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1 text-xxs" style={{ color: 'var(--color-text-muted)' }}>
        <span>0%</span><span>50%</span><span>100%</span>
      </div>
    </div>
  )
}

/** Slide-over drill panel showing linked evidence for a hypothesis. */
function EvidenceDrillPanel({
  hypothesis, onClose,
}: { hypothesis: Hypothesis | null; onClose: () => void }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hypothesis) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        // Fetch the hypothesis's full record; evidence lives on the
        // detail response. The list row only carries counts.
        const full: any = await api.getHypothesis(hypothesis.id)
        if (!cancelled) setItems(full?.linked_evidence || full?.evidence || [])
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [hypothesis])

  // Esc to close
  useEffect(() => {
    if (!hypothesis) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hypothesis, onClose])

  if (!hypothesis) return null

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="flex-1 bg-black/50" />
      <div
        ref={panelRef}
        className="w-[420px] h-full overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface-solid)] p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-xxs uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-muted)' }}>
              Linked evidence
            </div>
            <div className="text-sm font-medium line-clamp-2" style={{ color: 'var(--color-text)' }}>
              {hypothesis.statement}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1">
            <FiX className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 mb-4 text-xxs" style={{ color: 'var(--color-text-muted)' }}>
          <span>{hypothesis.supporting_count ?? 0} supporting</span>
          <span>·</span>
          <span>{hypothesis.contradiction_count ?? 0} contradicting</span>
        </div>
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No evidence linked yet. Open the hypothesis detail to attach supporting or contradicting evidence.</div>
        ) : (
          <ul className="space-y-2">
            {items.map((ev: any) => (
              <li key={ev.id} className="p-3 rounded-lg border border-[var(--glass-border)]">
                <div className="text-xs font-medium line-clamp-2" style={{ color: 'var(--color-text)' }}>
                  {ev.title || ev.statement || 'Untitled evidence'}
                </div>
                {ev.relation && (
                  <div className="text-xxs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    relation: {ev.relation}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Link
            to={`/hypotheses/${hypothesis.id}`}
            className="text-xxs underline decoration-dotted"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Open full detail →
          </Link>
        </div>
      </div>
    </div>
  )
}

type SortKey = 'confidence' | 'novelty' | 'recent' | 'title'
type StatusFilter = 'all' | 'draft' | 'validated' | 'active' | 'rejected'

export default function Hypotheses() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hypotheses'],
    queryFn: () => api.getHypotheses({ page: 1, page_size: 50 }),
    retry: 1,
  })
  const [sortKey, setSortKey] = useState<SortKey>('confidence')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [evidenceDrill, setEvidenceDrill] = useState<Hypothesis | null>(null)

  const apiHypotheses = data?.items || []

  // Confidence scores for the histogram — defined values only so the
  // distribution isn't skewed by un-scored drafts.
  const confidenceScores = apiHypotheses
    .map(h => h.confidence_score)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s))

  // After an inline edit commits, patch the react-query cache so the
  // row updates without a full refetch round-trip.
  const handleEdited = useCallback((updated: Hypothesis) => {
    queryClient.setQueryData(['hypotheses'], (prev: any) => {
      if (!prev?.items) return prev
      return {
        ...prev,
        items: prev.items.map((h: Hypothesis) => h.id === updated.id ? { ...h, ...updated } : h),
      }
    })
  }, [queryClient])
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
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text)] transition-colors"
        >
          <FiZap className="w-4 h-4 text-[var(--color-text-muted)]" />
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

      {/* Confidence histogram — only shows with enough data points to be meaningful */}
      {!isLoading && confidenceScores.length >= 3 && (
        <ConfidenceHistogram scores={confidenceScores} />
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
            <HypothesisCard
              key={hypothesis.id}
              hypothesis={hypothesis}
              onEdited={handleEdited}
              onShowEvidence={setEvidenceDrill}
            />
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

      <EvidenceDrillPanel hypothesis={evidenceDrill} onClose={() => setEvidenceDrill(null)} />
    </div>
  )
}
