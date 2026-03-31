import { useState, useCallback } from 'react'
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
} from 'react-icons/fi'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { logActivity } from '../utils/persistence'

interface Paper {
  id: string
  title: string
  authors: string[]
  journal: string
  year: number
  doi?: string
  abstract: string
  tags: string[]
  relevance: 'high' | 'medium' | 'low'
  notes: string
  addedAt: string
  starred: boolean
}

const RELEVANCE_COLORS = {
  high: 'var(--color-success)',
  medium: 'var(--color-warning)',
  low: 'var(--color-text-muted)',
}

export default function LiteratureReview() {
  const [papers, setPapers] = useState<Paper[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null)
  const [filterRelevance, setFilterRelevance] = useState<string>('')
  const [filterTag, setFilterTag] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // New paper form
  const [newPaper, setNewPaper] = useState({
    title: '', authors: '', journal: '', year: new Date().getFullYear(),
    doi: '', abstract: '', tags: '', relevance: 'medium' as Paper['relevance'],
  })

  const savePapers = useCallback((updated: Paper[]) => {
    setPapers(updated)
  }, [])

  const addPaper = () => {
    if (!newPaper.title.trim()) return
    const paper: Paper = {
      id: `paper-${Date.now()}`,
      title: newPaper.title,
      authors: newPaper.authors.split(',').map(a => a.trim()).filter(Boolean),
      journal: newPaper.journal,
      year: newPaper.year,
      doi: newPaper.doi,
      abstract: newPaper.abstract,
      tags: newPaper.tags.split(',').map(t => t.trim()).filter(Boolean),
      relevance: newPaper.relevance,
      notes: '',
      addedAt: new Date().toISOString(),
      starred: false,
    }
    savePapers([paper, ...papers])
    logActivity({ type: 'notebook', action: 'created', title: `Added paper: ${paper.title}` })
    setNewPaper({ title: '', authors: '', journal: '', year: new Date().getFullYear(), doi: '', abstract: '', tags: '', relevance: 'medium' })
    setShowAddForm(false)
  }

  const toggleStar = (id: string) => {
    savePapers(papers.map(p => p.id === id ? { ...p, starred: !p.starred } : p))
  }

  const deletePaper = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = () => {
    if (!deleteConfirmId) return
    const deletedPaper = papers.find(p => p.id === deleteConfirmId)
    savePapers(papers.filter(p => p.id !== deleteConfirmId))
    logActivity({ type: 'notebook', action: 'deleted', title: `Deleted paper: ${deletedPaper?.title || deleteConfirmId}` })
    if (selectedPaper?.id === deleteConfirmId) setSelectedPaper(null)
    setDeleteConfirmId(null)
  }

  const saveNotes = () => {
    if (!selectedPaper) return
    const updated = papers.map(p => p.id === selectedPaper.id ? { ...p, notes: notesText } : p)
    savePapers(updated)
    setSelectedPaper({ ...selectedPaper, notes: notesText })
    setEditingNotes(false)
  }

  const allTags = [...new Set(papers.flatMap(p => p.tags))]

  const filtered = papers
    .filter(p => !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.authors.some(a => a.toLowerCase().includes(searchQuery.toLowerCase())) ||
      p.abstract.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(p => !filterRelevance || p.relevance === filterRelevance)
    .filter(p => !filterTag || p.tags.includes(filterTag))
    .sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())

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
            <button onClick={() => setShowAddForm(!showAddForm)} className="btn btn-sm text-xs" style={{ color: 'var(--color-text-secondary)' }}>
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
              <select value={newPaper.relevance} onChange={e => setNewPaper(p => ({ ...p, relevance: e.target.value as Paper['relevance'] }))} className="input text-xs w-24">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={addPaper} disabled={!newPaper.title.trim()} className="btn btn-sm text-xs flex-1 disabled:opacity-30" style={{ color: 'var(--color-success)' }}>Add</button>
              <button onClick={() => setShowAddForm(false)} className="btn btn-sm text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        )}

        {/* Paper list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
              <FiBookOpen className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">{papers.length === 0 ? 'No papers added yet' : 'No matching papers'}</p>
              <p className="text-xs mt-1">Click "Add Paper" to start your review</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filtered.map(paper => (
                <button
                  key={paper.id}
                  onClick={() => { setSelectedPaper(paper); setEditingNotes(false) }}
                  className={`w-full text-left p-3 rounded-lg transition-all group ${selectedPaper?.id === paper.id ? 'bg-[var(--glass-bg-hover)] border border-[var(--color-border-strong)]' : 'hover:bg-[var(--glass-bg)]'}`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); toggleStar(paper.id) }}
                      className="mt-0.5 flex-shrink-0"
                    >
                      <FiStar className={`w-3.5 h-3.5 ${paper.starred ? 'fill-[var(--color-warning)]' : ''}`} style={{ color: paper.starred ? 'var(--color-warning)' : 'var(--color-text-muted)' }} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xs font-medium line-clamp-2">{paper.title}</h3>
                      <p className="text-xxs text-[var(--color-text-muted)] mt-0.5 truncate">
                        {paper.authors.join(', ')} {paper.year && `(${paper.year})`}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xxs px-1.5 py-0.5 rounded" style={{ color: RELEVANCE_COLORS[paper.relevance], background: `${RELEVANCE_COLORS[paper.relevance]}12` }}>
                          {paper.relevance}
                        </span>
                        {paper.journal && <span className="text-xxs text-[var(--color-text-muted)] truncate">{paper.journal}</span>}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-[var(--color-border)] text-xxs text-[var(--color-text-muted)]">
          {papers.length} papers &middot; {papers.filter(p => p.starred).length} starred
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
                  <span className="flex items-center gap-1"><FiCalendar className="w-3 h-3" /> {selectedPaper.year}</span>
                  <span className="px-1.5 py-0.5 rounded text-xxs" style={{ color: RELEVANCE_COLORS[selectedPaper.relevance], background: `${RELEVANCE_COLORS[selectedPaper.relevance]}12` }}>
                    {selectedPaper.relevance} relevance
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {selectedPaper.doi && (
                  <a href={`https://doi.org/${selectedPaper.doi}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    <FiExternalLink className="w-3.5 h-3.5" /> DOI
                  </a>
                )}
                <button onClick={() => deletePaper(selectedPaper.id)} className="btn btn-sm text-xs" style={{ color: 'var(--color-error)' }}>
                  <FiTrash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {selectedPaper.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {selectedPaper.tags.map(tag => (
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
                <button onClick={() => { setEditingNotes(!editingNotes); setNotesText(selectedPaper.notes) }} className="btn btn-sm text-xxs text-[var(--color-text-muted)]">
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
                  <button onClick={saveNotes} className="btn btn-sm text-xs mt-2" style={{ color: 'var(--color-success)' }}>Save Notes</button>
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
