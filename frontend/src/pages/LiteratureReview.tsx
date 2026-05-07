import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiBookOpen,
  FiSearch,
  FiPlus,
  FiExternalLink,
  FiStar,
  FiTag,
  FiTrash2,
  FiEdit3,
  FiCalendar,
  FiFileText,
  FiDownload,
  FiAlertCircle,
} from 'react-icons/fi'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { logActivity } from '../utils/persistence'
import { api, LibraryCitation } from '../services/api'

// ─── Relevance encoding ─────────────────────────────────────────────
//
// `LibraryCitation` (the backend model) doesn't carry a `relevance`
// field — but the literature-review UX has always classified papers
// as high/medium/low priority. We round-trip relevance through the
// `tags` array using a `relevance:<value>` prefix so a single backend
// schema serves both the citation manager and the literature review.
//
// Tags with this prefix are NEVER shown in the user-facing tag chips
// (filtered via `userTags()` below) so the encoding is invisible.
type Relevance = 'high' | 'medium' | 'low'
const RELEVANCE_PREFIX = 'relevance:'

function getRelevance(tags: string[]): Relevance {
  const found = tags.find(t => t.startsWith(RELEVANCE_PREFIX))
  if (!found) return 'medium'
  const value = found.slice(RELEVANCE_PREFIX.length).toLowerCase()
  return value === 'high' || value === 'low' ? value : 'medium'
}

function setRelevanceOnTags(tags: string[], next: Relevance): string[] {
  return [...tags.filter(t => !t.startsWith(RELEVANCE_PREFIX)), `${RELEVANCE_PREFIX}${next}`]
}

function userTags(tags: string[]): string[] {
  return tags.filter(t => !t.startsWith(RELEVANCE_PREFIX))
}

const RELEVANCE_COLORS: Record<Relevance, string> = {
  high: 'var(--color-success)',
  medium: 'var(--color-warning)',
  low: 'var(--color-text-muted)',
}

export default function LiteratureReview() {
  const [citations, setCitations] = useState<LibraryCitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Deep-link support: `?q=` seeds the search query and `?add=1` auto-
  // opens the Add Paper form. Query is consumed on mount and cleaned
  // off the URL so a soft reload doesn't re-apply stale values.
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [showAddForm, setShowAddForm] = useState(() => searchParams.get('add') === '1')
  useEffect(() => {
    if (searchParams.has('q') || searchParams.get('add') === '1') {
      const next = new URLSearchParams(searchParams)
      next.delete('q')
      next.delete('add')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [selectedPaper, setSelectedPaper] = useState<LibraryCitation | null>(null)
  const [filterRelevance, setFilterRelevance] = useState<string>('')
  const [filterTag, setFilterTag] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // New paper form
  const [newPaper, setNewPaper] = useState({
    title: '', authors: '', journal: '', year: new Date().getFullYear(),
    doi: '', abstract: '', tags: '', relevance: 'medium' as Relevance,
  })

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listLibraryCitations({ limit: 500 })
      setCitations(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load literature library')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  const addPaper = async () => {
    if (!newPaper.title.trim()) return
    setBusy(true)
    setError(null)
    const tags = setRelevanceOnTags(
      newPaper.tags.split(',').map(t => t.trim()).filter(Boolean),
      newPaper.relevance,
    )
    try {
      const created = await api.createLibraryCitation({
        type: 'journal',
        title: newPaper.title,
        authors: newPaper.authors.split(',').map(a => a.trim()).filter(Boolean),
        journal: newPaper.journal || null,
        year: newPaper.year || null,
        doi: newPaper.doi || null,
        abstract: newPaper.abstract || null,
        tags,
        starred: false,
      })
      setCitations(prev => [created, ...prev])
      logActivity({ type: 'notebook', action: 'created', title: `Added paper: ${created.title}` })
      setNewPaper({
        title: '', authors: '', journal: '', year: new Date().getFullYear(),
        doi: '', abstract: '', tags: '', relevance: 'medium',
      })
      setShowAddForm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add paper')
    } finally {
      setBusy(false)
    }
  }

  const toggleStar = async (id: string) => {
    const c = citations.find(x => x.id === id)
    if (!c) return
    const nextStarred = !c.starred
    // Optimistic update — revert on failure.
    setCitations(prev => prev.map(x => x.id === id ? { ...x, starred: nextStarred } : x))
    try {
      const updated = await api.updateLibraryCitation(id, { starred: nextStarred })
      setCitations(prev => prev.map(x => x.id === id ? updated : x))
      if (selectedPaper?.id === id) setSelectedPaper(updated)
    } catch (e) {
      setCitations(prev => prev.map(x => x.id === id ? { ...x, starred: !nextStarred } : x))
      setError(e instanceof Error ? e.message : 'Failed to toggle star')
    }
  }

  const deletePaper = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    const deleted = citations.find(p => p.id === deleteConfirmId)
    setBusy(true)
    setError(null)
    try {
      await api.deleteLibraryCitation(deleteConfirmId)
      setCitations(prev => prev.filter(p => p.id !== deleteConfirmId))
      logActivity({ type: 'notebook', action: 'deleted', title: `Deleted paper: ${deleted?.title || deleteConfirmId}` })
      if (selectedPaper?.id === deleteConfirmId) setSelectedPaper(null)
      setDeleteConfirmId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete paper')
    } finally {
      setBusy(false)
    }
  }

  const saveNotes = async () => {
    if (!selectedPaper) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateLibraryCitation(selectedPaper.id, { notes: notesText })
      setCitations(prev => prev.map(p => p.id === updated.id ? updated : p))
      setSelectedPaper(updated)
      setEditingNotes(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save notes')
    } finally {
      setBusy(false)
    }
  }

  const allTags = [...new Set(citations.flatMap(p => userTags(p.tags)))]

  const filtered = citations
    .filter(p => !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.authors.some(a => a.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.abstract || '').toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(p => !filterRelevance || getRelevance(p.tags) === filterRelevance)
    .filter(p => !filterTag || userTags(p.tags).includes(filterTag))
    .sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0)
      || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left - Paper list */}
      <div className="w-96 flex flex-col border-r border-[var(--color-border)] overflow-hidden">
        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FiBookOpen className="w-4 h-4 text-[var(--color-text-muted)]" />
              <h2 className="text-sm font-medium">Literature Review</h2>
            </div>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              disabled={busy}
              className="btn btn-sm text-xs disabled:opacity-40"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <FiPlus className="w-3.5 h-3.5" /> Add Paper
            </button>
          </div>

          <div className="relative">
            <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search papers, authors..."
              className="input w-full pl-8 text-xs"
            />
          </div>

          <div className="flex items-center gap-2 mt-2">
            <select
              value={filterRelevance}
              onChange={e => setFilterRelevance(e.target.value)}
              className="input text-xxs py-1"
            >
              <option value="">All Relevance</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {allTags.length > 0 && (
              <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="input text-xxs py-1 flex-1">
                <option value="">All Tags</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Add paper form */}
        {showAddForm && (
          <div className="p-4 border-b border-[var(--color-border)] space-y-2 bg-[var(--glass-bg)] animate-slide-down">
            <input type="text" value={newPaper.title} onChange={e => setNewPaper(p => ({ ...p, title: e.target.value }))} placeholder="Paper title *" className="input w-full text-xs" />
            <input type="text" value={newPaper.authors} onChange={e => setNewPaper(p => ({ ...p, authors: e.target.value }))} placeholder="Authors (comma-separated)" className="input w-full text-xs" />
            <div className="flex gap-2">
              <input type="text" value={newPaper.journal} onChange={e => setNewPaper(p => ({ ...p, journal: e.target.value }))} placeholder="Journal" className="input flex-1 text-xs" />
              <input type="number" value={newPaper.year} onChange={e => setNewPaper(p => ({ ...p, year: parseInt(e.target.value) }))} className="input w-20 text-xs" />
            </div>
            <input type="text" value={newPaper.doi} onChange={e => setNewPaper(p => ({ ...p, doi: e.target.value }))} placeholder="DOI (optional)" className="input w-full text-xs" />
            <textarea value={newPaper.abstract} onChange={e => setNewPaper(p => ({ ...p, abstract: e.target.value }))} placeholder="Abstract" rows={3} className="input w-full text-xs resize-none" />
            <div className="flex gap-2">
              <input type="text" value={newPaper.tags} onChange={e => setNewPaper(p => ({ ...p, tags: e.target.value }))} placeholder="Tags (comma-separated)" className="input flex-1 text-xs" />
              <select value={newPaper.relevance} onChange={e => setNewPaper(p => ({ ...p, relevance: e.target.value as Relevance }))} className="input text-xs w-24">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={addPaper} disabled={!newPaper.title.trim() || busy} className="btn btn-sm text-xs flex-1 disabled:opacity-30" style={{ color: 'var(--color-success)' }}>
                {busy ? 'Saving…' : 'Add'}
              </button>
              <button onClick={() => setShowAddForm(false)} disabled={busy} className="btn btn-sm text-xs text-[var(--color-text-muted)] disabled:opacity-30">Cancel</button>
            </div>
          </div>
        )}

        {/* Inline error banner */}
        {error && (
          <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-error-bg,rgba(220,38,38,0.06))] text-xxs flex items-start gap-2" role="alert">
            <FiAlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-error)' }} />
            <div className="flex-1 min-w-0">
              <p className="text-[var(--color-error)] font-medium">Error</p>
              <p className="text-[var(--color-text-secondary)] mt-0.5 break-words">{error}</p>
            </div>
            <button onClick={() => { setError(null); refetch() }} className="text-xxs underline text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
              Retry
            </button>
          </div>
        )}

        {/* Paper list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-2 space-y-1" aria-busy="true" aria-label="Loading literature library">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="p-3 rounded-lg bg-[var(--glass-bg)] animate-pulse">
                  <div className="h-3 bg-[var(--color-border)] rounded w-4/5 mb-2" />
                  <div className="h-2 bg-[var(--color-border)] rounded w-3/5 mb-2" />
                  <div className="h-2 bg-[var(--color-border)] rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
              <FiBookOpen className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">{citations.length === 0 ? 'No papers added yet' : 'No matching papers'}</p>
              <p className="text-xs mt-1">Click "Add Paper" to start your review</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filtered.map(paper => {
                const rel = getRelevance(paper.tags)
                return (
                  <button
                    key={paper.id}
                    onClick={() => { setSelectedPaper(paper); setEditingNotes(false) }}
                    className={`w-full text-left p-3 rounded-lg transition-all group ${selectedPaper?.id === paper.id ? 'bg-[var(--glass-bg-hover)] border border-[var(--color-border-strong)]' : 'hover:bg-[var(--glass-bg)]'}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); toggleStar(paper.id) }}
                        className="mt-0.5 flex-shrink-0"
                        aria-label={paper.starred ? 'Unstar paper' : 'Star paper'}
                      >
                        <FiStar className={`w-3.5 h-3.5 ${paper.starred ? 'fill-[var(--color-warning)]' : ''}`} style={{ color: paper.starred ? 'var(--color-warning)' : 'var(--color-text-muted)' }} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xs font-medium line-clamp-2">{paper.title}</h3>
                        <p className="text-xxs text-[var(--color-text-muted)] mt-0.5 truncate">
                          {paper.authors.join(', ')} {paper.year && `(${paper.year})`}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xxs px-1.5 py-0.5 rounded" style={{ color: RELEVANCE_COLORS[rel], background: `${RELEVANCE_COLORS[rel]}12` }}>
                            {rel}
                          </span>
                          {paper.journal && <span className="text-xxs text-[var(--color-text-muted)] truncate">{paper.journal}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-[var(--color-border)] text-xxs text-[var(--color-text-muted)] flex items-center justify-between">
          <span>{citations.length} papers &middot; {citations.filter(p => p.starred).length} starred</span>
          {citations.length > 0 && (
            <button
              onClick={async () => {
                try {
                  const blob = await api.exportLibraryCitations({ format: 'bibtex' })
                  if (blob instanceof Blob) {
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(blob)
                    a.download = 'literature-review.bib'
                    a.click()
                    URL.revokeObjectURL(a.href)
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed to export bibliography')
                }
              }}
              className="flex items-center gap-1 hover:text-[var(--color-text-secondary)] transition-colors"
              title="Export bibliography as BibTeX"
            >
              <FiDownload className="w-3 h-3" /> Export
            </button>
          )}
        </div>
      </div>

      {/* Right - Paper detail */}
      {selectedPaper ? (
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-3xl">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h1 className="text-xl font-semibold leading-tight">{selectedPaper.title}</h1>
                <p className="text-sm text-[var(--color-text-muted)] mt-2">{selectedPaper.authors.join(', ')}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-[var(--color-text-muted)]">
                  {selectedPaper.journal && <span className="flex items-center gap-1"><FiFileText className="w-3 h-3" /> {selectedPaper.journal}</span>}
                  {selectedPaper.year && <span className="flex items-center gap-1"><FiCalendar className="w-3 h-3" /> {selectedPaper.year}</span>}
                  {(() => {
                    const r = getRelevance(selectedPaper.tags)
                    return (
                      <span className="px-1.5 py-0.5 rounded text-xxs" style={{ color: RELEVANCE_COLORS[r], background: `${RELEVANCE_COLORS[r]}12` }}>
                        {r} relevance
                      </span>
                    )
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {selectedPaper.doi && (
                  <a href={`https://doi.org/${selectedPaper.doi}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    <FiExternalLink className="w-3.5 h-3.5" /> DOI
                  </a>
                )}
                <button onClick={() => deletePaper(selectedPaper.id)} disabled={busy} className="btn btn-sm text-xs disabled:opacity-30" style={{ color: 'var(--color-error)' }} aria-label="Delete paper">
                  <FiTrash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {userTags(selectedPaper.tags).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {userTags(selectedPaper.tags).map(tag => (
                  <span key={tag} className="flex items-center gap-1 text-xxs px-2 py-0.5 rounded-md bg-[var(--glass-bg)] text-[var(--color-text-secondary)]">
                    <FiTag className="w-2.5 h-2.5" /> {tag}
                  </span>
                ))}
              </div>
            )}

            {selectedPaper.abstract && (
              <div className="mb-6">
                <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Abstract</h3>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed p-4 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                  {selectedPaper.abstract}
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Research Notes</h3>
                <button
                  onClick={() => { setEditingNotes(!editingNotes); setNotesText(selectedPaper.notes || '') }}
                  disabled={busy}
                  className="btn btn-sm text-xxs text-[var(--color-text-muted)] disabled:opacity-30"
                >
                  <FiEdit3 className="w-3 h-3" /> {editingNotes ? 'Cancel' : 'Edit'}
                </button>
              </div>
              {editingNotes ? (
                <div>
                  <textarea
                    value={notesText}
                    onChange={e => setNotesText(e.target.value)}
                    rows={8}
                    className="input w-full text-sm resize-none"
                    placeholder="Add your notes about this paper..."
                    autoFocus
                  />
                  <button onClick={saveNotes} disabled={busy} className="btn btn-sm text-xs mt-2 disabled:opacity-30" style={{ color: 'var(--color-success)' }}>
                    {busy ? 'Saving…' : 'Save Notes'}
                  </button>
                </div>
              ) : (
                <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed p-4 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] min-h-[100px]">
                  {selectedPaper.notes || <span className="text-[var(--color-text-muted)] italic">No notes yet. Click Edit to add notes.</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
          <div className="text-center">
            <FiBookOpen className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">Select a paper to view details</p>
            <p className="text-xs mt-1">or add a new paper to your review</p>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteConfirmId !== null}
        entityName="Paper"
        message="This will permanently remove this paper from your review. This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
