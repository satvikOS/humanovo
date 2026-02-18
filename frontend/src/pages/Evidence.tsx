import { useState, useMemo, useCallback } from 'react'
import {
  FiDatabase,
  FiSearch,
  FiPlus,
  FiRefreshCw,
  FiExternalLink,
  FiFileText,
  FiCheckCircle,
  FiClock,
  FiAlertCircle,
  FiCalendar,
  FiUser,
  FiMoreVertical,
  FiBookOpen,
  FiAward,
  FiX
} from 'react-icons/fi'
import clsx from 'clsx'
import { usePersistentState, logActivity } from '../utils/persistence'
import type { EvidenceItem } from '../data/evidence/evidenceRepository'

const typeIcons: Record<EvidenceItem['type'], typeof FiFileText> = {
  paper: FiFileText,
  trial: FiDatabase,
  dataset: FiDatabase,
  patent: FiFileText,
}

const statusConfig: Record<EvidenceItem['status'], { icon: typeof FiCheckCircle; color: string; label: string }> = {
  verified: { icon: FiCheckCircle, color: 'text-success-400', label: 'Verified' },
  pending: { icon: FiClock, color: 'text-warning-400', label: 'Pending Review' },
  disputed: { icon: FiAlertCircle, color: 'text-error-400', label: 'Disputed' },
}

interface IngestionItem {
  id: number
  source: string
  status: 'processing' | 'queued' | 'completed'
  progress: number
  items: number
}

function IngestionQueue() {
  const [queue] = useState<IngestionItem[]>([])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Ingestion Queue</h3>
        <button className="btn btn-sm btn-secondary">
          <FiRefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>
      <div className="space-y-2">
        {queue.length === 0 ? (
          <div className="text-center py-4 text-[var(--color-text-muted)] text-xs">
            No active ingestion jobs
          </div>
        ) : queue.map(item => (
          <div key={item.id} className="flex items-center gap-3 p-2 bg-[var(--color-bg)] rounded">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium">{item.source}</span>
                <span className="text-[var(--color-text-muted)]">{item.items} items</span>
              </div>
              <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all',
                    item.status === 'completed' ? 'bg-success-500' :
                    item.status === 'processing' ? 'bg-primary-500' : 'bg-[var(--color-border-strong)]'
                  )}
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            </div>
            <span className={clsx(
              'text-xxs px-1.5 py-0.5 rounded',
              item.status === 'completed' ? 'bg-success-500/20 text-success-400' :
              item.status === 'processing' ? 'bg-primary-500/20 text-primary-400' : 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
            )}>
              {item.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EvidenceCard({ item, isSelected, onSelect }: {
  item: EvidenceItem
  isSelected: boolean
  onSelect: () => void
}) {
  const StatusIcon = statusConfig[item.status].icon
  const TypeIcon = typeIcons[item.type]

  return (
    <div
      onClick={onSelect}
      className={clsx(
        'card cursor-pointer transition-all',
        isSelected ? 'ring-1 ring-primary-500 border-primary-500' : 'hover:border-[var(--color-border-strong)]'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={clsx(
          'w-8 h-8 rounded flex items-center justify-center flex-shrink-0',
          item.type === 'paper' && 'bg-primary-500/20 text-primary-400',
          item.type === 'trial' && 'bg-success-500/20 text-success-400',
          item.type === 'dataset' && 'bg-warning-500/20 text-warning-400',
          item.type === 'patent' && 'bg-error-500/20 text-error-400',
        )}>
          <TypeIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="text-sm font-medium line-clamp-2">{item.title}</h4>
            <button className="p-1 hover:bg-[var(--color-border)] rounded flex-shrink-0">
              <FiMoreVertical className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-2">
            <span>{item.source}</span>
            <span>-</span>
            <span>{item.date}</span>
            {item.citations && (
              <>
                <span>-</span>
                <span>{item.citations} citations</span>
              </>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <StatusIcon className={clsx('w-3.5 h-3.5', statusConfig[item.status].color)} />
              <span className={clsx('text-xs', statusConfig[item.status].color)}>
                {statusConfig[item.status].label}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-16 bg-[var(--color-border)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full"
                  style={{ width: `${item.relevanceScore * 100}%` }}
                />
              </div>
              <span className="text-xxs text-[var(--color-text-muted)]">
                {Math.round(item.relevanceScore * 100)}%
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {item.tags.slice(0, 3).map(tag => (
              <span key={tag} className="badge badge-neutral">{tag}</span>
            ))}
            {item.tags.length > 3 && (
              <span className="badge badge-neutral">+{item.tags.length - 3}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function EvidenceDetail({ item }: { item: EvidenceItem | null }) {
  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
        <FiDatabase className="w-8 h-8 mb-2" />
        <span className="text-sm">Select evidence to view details</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-medium leading-tight">{item.title}</h2>
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-secondary"
              onClick={(e) => e.stopPropagation()}
            >
              <FiExternalLink className="w-3 h-3" />
              View Source
            </a>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1">
            <FiCalendar className="w-3 h-3" />
            {item.date}
          </div>
          <div className="flex items-center gap-1">
            <FiDatabase className="w-3 h-3" />
            {item.source}
          </div>
          {item.citations && (
            <div className="flex items-center gap-1">
              <FiFileText className="w-3 h-3" />
              {item.citations} citations
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {item.authors && (
          <div>
            <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Authors</div>
            <div className="flex flex-wrap gap-1">
              {item.authors.map(author => (
                <span key={author} className="flex items-center gap-1 text-xs px-2 py-1 bg-[var(--color-bg)] rounded">
                  <FiUser className="w-3 h-3" />
                  {author}
                </span>
              ))}
            </div>
          </div>
        )}

        {item.abstract && (
          <div>
            <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Abstract</div>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{item.abstract}</p>
          </div>
        )}

        <div>
          <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Tags</div>
          <div className="flex flex-wrap gap-1">
            {item.tags.map(tag => (
              <span key={tag} className="badge badge-info">{tag}</span>
            ))}
            <button className="badge badge-neutral flex items-center gap-1">
              <FiPlus className="w-2.5 h-2.5" />
              Add Tag
            </button>
          </div>
        </div>

        <div>
          <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Status</div>
          <div className="flex items-center gap-2">
            {(() => {
              const StatusIcon = statusConfig[item.status].icon
              return (
                <>
                  <StatusIcon className={clsx('w-4 h-4', statusConfig[item.status].color)} />
                  <span className={clsx('text-sm', statusConfig[item.status].color)}>
                    {statusConfig[item.status].label}
                  </span>
                </>
              )
            })()}
          </div>
        </div>

        <div className="pt-2 flex gap-2">
          <button className="btn btn-primary flex-1">
            <FiCheckCircle className="w-3.5 h-3.5" />
            Verify
          </button>
          <button className="btn btn-secondary flex-1">
            <FiAlertCircle className="w-3.5 h-3.5" />
            Dispute
          </button>
        </div>
      </div>
    </div>
  )
}

function AddEvidenceModal({ onClose, onAdd }: { onClose: () => void; onAdd: (item: EvidenceItem) => void }) {
  const [form, setForm] = useState({
    title: '',
    source: '',
    sourceUrl: '',
    type: 'paper' as EvidenceItem['type'],
    abstract: '',
    authors: '',
    tags: '',
    date: new Date().toISOString().split('T')[0],
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newItem: EvidenceItem = {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: form.title,
      source: form.source || 'User Added',
      sourceUrl: form.sourceUrl,
      type: form.type,
      status: 'pending',
      date: form.date,
      authors: form.authors ? form.authors.split(',').map(a => a.trim()) : [],
      abstract: form.abstract,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()) : [],
      citations: 0,
      relevanceScore: 0.5,
      publisher: form.source || 'User Added',
    }
    onAdd(newItem)
    logActivity({ type: 'evidence', action: 'created', title: `Added evidence: ${form.title}` })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold">Add Evidence</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <FiX className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Title *</label>
            <input type="text" className="input w-full" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required placeholder="Paper or evidence title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Source</label>
              <input type="text" className="input w-full" value={form.source} onChange={e => setForm({...form, source: e.target.value})} placeholder="e.g., Nature, PubMed" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Type</label>
              <select className="input w-full" value={form.type} onChange={e => setForm({...form, type: e.target.value as EvidenceItem['type']})}>
                <option value="paper">Paper</option>
                <option value="trial">Clinical Trial</option>
                <option value="dataset">Dataset</option>
                <option value="patent">Patent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">URL</label>
            <input type="url" className="input w-full" value={form.sourceUrl} onChange={e => setForm({...form, sourceUrl: e.target.value})} placeholder="https://..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Authors (comma separated)</label>
            <input type="text" className="input w-full" value={form.authors} onChange={e => setForm({...form, authors: e.target.value})} placeholder="Author A, Author B" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Abstract</label>
            <textarea className="input w-full h-20 resize-none" value={form.abstract} onChange={e => setForm({...form, abstract: e.target.value})} placeholder="Brief description..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Tags (comma separated)</label>
            <input type="text" className="input w-full" value={form.tags} onChange={e => setForm({...form, tags: e.target.value})} placeholder="genomics, cancer, ..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" className="btn btn-primary">Add Evidence</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Evidence() {
  const [evidence, setEvidence] = usePersistentState<EvidenceItem[]>('evidence', [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [showAddModal, setShowAddModal] = useState(false)
  const pageSize = 50

  const addEvidence = useCallback((item: EvidenceItem) => {
    setEvidence(prev => [item, ...prev])
  }, [setEvidence])

  const stats = useMemo(() => {
    const byType: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    for (const e of evidence) {
      byType[e.type] = (byType[e.type] || 0) + 1
      byStatus[e.status] = (byStatus[e.status] || 0) + 1
    }
    return { total: evidence.length, byType, byStatus }
  }, [evidence])

  const selectedItem = evidence.find(e => e.id === selectedId) || null

  const filteredEvidence = useMemo(() => {
    let items = evidence
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.abstract?.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q)) ||
        e.authors?.some(a => a.toLowerCase().includes(q))
      )
    }
    if (filterType !== 'all') items = items.filter(e => e.type === filterType)
    if (filterStatus !== 'all') items = items.filter(e => e.status === filterStatus)
    return items
  }, [evidence, searchQuery, filterType, filterStatus])

  const paginatedEvidence = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredEvidence.slice(start, start + pageSize)
  }, [filteredEvidence, page])

  const totalPages = Math.ceil(filteredEvidence.length / pageSize)

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="p-4 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold">Evidence Repository</h1>
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                <FiPlus className="w-3.5 h-3.5" />
                Add Evidence
              </button>
            </div>
          </div>

          {/* Search and filters */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Search evidence..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input w-full pl-9"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input"
            >
              <option value="all">All Types</option>
              <option value="paper">Papers</option>
              <option value="trial">Trials</option>
              <option value="dataset">Datasets</option>
              <option value="patent">Patents</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input"
            >
              <option value="all">All Status</option>
              <option value="verified">Verified</option>
              <option value="pending">Pending</option>
              <option value="disputed">Disputed</option>
            </select>
          </div>
        </div>

        {/* Stats bar */}
        <div className="px-4 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-[var(--color-text-muted)]">
              <span className="font-medium text-[var(--color-text)]">{filteredEvidence.length.toLocaleString()}</span> results
              {searchQuery && ` for "${searchQuery}"`}
            </span>
            <span className="text-[var(--color-text-muted)]">
              Repository: <span className="font-medium text-primary-400">{stats.total.toLocaleString()}</span> items
            </span>
          </div>
          <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
            <span><FiFileText className="inline w-3 h-3 mr-1" />{stats.byType.paper || 0} papers</span>
            <span><FiDatabase className="inline w-3 h-3 mr-1" />{stats.byType.trial || 0} trials</span>
            <span><FiBookOpen className="inline w-3 h-3 mr-1" />{stats.byType.dataset || 0} datasets</span>
            <span><FiAward className="inline w-3 h-3 mr-1" />{stats.byType.patent || 0} patents</span>
          </div>
        </div>

        {/* Evidence list */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-3">
            {paginatedEvidence.map(item => (
              <EvidenceCard
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-sm btn-secondary disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-[var(--color-text-muted)]">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn btn-sm btn-secondary disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <div className="w-80 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
        <div className="flex-1">
          <EvidenceDetail item={selectedItem} />
        </div>

        {/* Ingestion queue */}
        <div className="p-4 border-t border-[var(--color-border)]">
          <IngestionQueue />
        </div>
      </div>

      {showAddModal && (
        <AddEvidenceModal onClose={() => setShowAddModal(false)} onAdd={addEvidence} />
      )}
    </div>
  )
}
