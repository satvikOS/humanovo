import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiFileText, FiPlus, FiTrash2, FiEdit3, FiUsers, FiSend,
  FiDownload, FiSave, FiCheckSquare, FiSquare,
} from 'react-icons/fi'
import { formatDate, logActivity } from '../utils/persistence'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { BulkActionBar } from '../components/BulkActionBar'
import { toast } from '../contexts/ToastContext'
import { apiClient } from '../services'
import api from '../services/api'

interface Manuscript {
  id: string; title: string; status: string; journal_target: string
  sections: Record<string, string>; authors: Author[]; keywords: string[]
  submission_history: any[]; word_count: number; created_at: string; updated_at: string
}
interface Author { id: string; name: string; affiliation: string; email: string; role: string; order: number }

// apiClient's baseURL already includes /api/v1
const BASE = '/manuscripts'
// accepted/published stay green (terminal success states) and rejected
// stays red so reviewers can spot final outcomes instantly; in-progress
// states (draft/review/submitted) are monochrome to match the shell.
const STATUS_COLORS: Record<string, string> = { draft: 'var(--color-text-muted)', review: 'var(--color-text)', submitted: 'var(--color-text)', accepted: 'var(--color-success)', published: 'var(--color-success)', rejected: 'var(--color-error)' }
const SECTIONS = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'references']

export default function ManuscriptManager() {
  // Deep-link support: `?add=1` opens the new-manuscript dialog, and
  // `?id=<manuscriptId>` auto-selects that manuscript once the list
  // resolves from the backend. Params are stripped on mount so shared
  // links stay canonical.
  const [searchParams] = useSearchParams()
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([])
  const [selected, setSelected] = useState<Manuscript | null>(null)
  const [editSection, setEditSection] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showAdd, setShowAdd] = useState(() => searchParams.get('add') === '1')
  const [newTitle, setNewTitle] = useState('')
  const [newJournal, setNewJournal] = useState('')
  const [showAuthorAdd, setShowAuthorAdd] = useState(false)
  const [newAuthor, setNewAuthor] = useState({ name: '', affiliation: '', email: '', role: 'Co-Author' })
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  const load = async () => {
    try {
      const { data } = await apiClient.get(BASE, { headers: { 'X-Silent-Error': '1' } })
      setManuscripts(data?.items || [])
    } catch (err) {
      toast('error', `Could not load manuscripts — ${err instanceof Error ? err.message : 'network error'}`, { title: 'Manuscripts' })
    }
  }
  useEffect(() => { load() }, [])

  // Consume & strip `add` + `id` from the URL on mount and kick off
  // the selectMs fetch for the deep-linked id once it's known.
  const [pendingId] = useState(() => searchParams.get('id') || '')
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    let dirty = false
    if (sp.has('add')) { sp.delete('add'); dirty = true }
    if (sp.has('id')) { sp.delete('id'); dirty = true }
    if (dirty) {
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
     
  }, [])
  useEffect(() => {
    if (!pendingId || selected) return
    const match = manuscripts.find(m => m.id === pendingId)
    if (match) {
      // Use selectMs to hydrate full manuscript details (authors,
      // sections) from the detail endpoint.
      ;(async () => {
        try {
          const { data: ms } = await apiClient.get(`${BASE}/${pendingId}`)
          setSelected(ms)
        } catch { /* ignore */ }
      })()
    }
  }, [manuscripts, pendingId, selected])

  const selectMs = async (id: string) => {
    try {
      const { data: ms } = await apiClient.get(`${BASE}/${id}`)
      setSelected(ms)
      setEditSection(null)
    } catch { /* interceptor surfaces the toast */ }
  }

  const createMs = async () => {
    if (!newTitle.trim()) return
    try {
      await apiClient.post(BASE, { title: newTitle, journal_target: newJournal })
      load()
      setShowAdd(false)
      logActivity({ type: 'notebook', action: 'created', title: `Created manuscript: ${newTitle}` })
      setNewTitle('')
      setNewJournal('')
    } catch { /* interceptor surfaces the toast */ }
  }

  const deleteMs = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    const deletedMs = manuscripts.find(m => m.id === deleteConfirmId)
    try {
      await apiClient.delete(`${BASE}/${deleteConfirmId}`)
    } catch { /* interceptor surfaces the toast */ }
    if (selected?.id === deleteConfirmId) setSelected(null); load()
    setDeleteConfirmId(null)
    logActivity({ type: 'notebook', action: 'deleted', title: `Deleted manuscript: ${deletedMs?.title || deleteConfirmId}` })
  }

  const saveSection = async () => {
    if (!selected || !editSection) return
    const sections = { ...selected.sections, [editSection]: editText }
    try {
      const { data: ms } = await apiClient.patch(`${BASE}/${selected.id}`, { sections })
      setSelected(ms)
      setEditSection(null)
      logActivity({ type: 'notebook', action: 'updated', title: `Updated section ${editSection}: ${selected.title}` })
    } catch { /* interceptor surfaces the toast */ }
  }

  const addAuthor = async () => {
    if (!selected || !newAuthor.name.trim()) return
    try {
      await apiClient.post(`${BASE}/${selected.id}/authors`, newAuthor)
      selectMs(selected.id)
      setShowAuthorAdd(false)
      setNewAuthor({ name: '', affiliation: '', email: '', role: 'Co-Author' })
      logActivity({ type: 'notebook', action: 'updated', title: `Added author ${newAuthor.name} to: ${selected.title}` })
    } catch { /* interceptor surfaces the toast */ }
  }

  const removeAuthor = async (authorId: string) => {
    if (!selected) return
    const removedAuthor = selected.authors.find(a => a.id === authorId)
    try {
      await apiClient.delete(`${BASE}/${selected.id}/authors/${authorId}`)
    } catch { /* interceptor surfaces the toast */ }
    selectMs(selected.id)
    logActivity({ type: 'notebook', action: 'updated', title: `Removed author ${removedAuthor?.name || authorId} from: ${selected.title}` })
  }

  const exportMs = async () => {
    if (!selected) return
    try {
      const { data: blob } = await apiClient.get(`${BASE}/${selected.id}/export`, {
        params: { format: 'markdown' },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selected.title}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* interceptor surfaces the toast */ }
  }

  const submitMs = async () => {
    if (!selected || !selected.journal_target) return
    try {
      await apiClient.post(`${BASE}/${selected.id}/submit`, { journal: selected.journal_target })
      selectMs(selected.id)
      logActivity({ type: 'notebook', action: 'updated', title: `Submitted manuscript: ${selected.title}` })
    } catch { /* interceptor surfaces the toast */ }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div><h1 className="text-2xl font-semibold tracking-tight">Manuscript Manager</h1><p className="text-sm text-[var(--color-text-muted)] mt-1">Draft, format, and track manuscript submissions</p></div>
          <div className="flex gap-2">
            <button
              onClick={() => { if (selectMode) { setSelectMode(false); setSelectedIds(new Set()) } else setSelectMode(true) }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${selectMode ? 'border-[var(--color-border-strong)] text-[var(--color-text)]' : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]'}`}
              aria-pressed={selectMode}
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
            <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-text-secondary)' }}><FiPlus className="w-4 h-4" /> New Manuscript</button>
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)]">
          <div className="max-w-xl mx-auto flex gap-2">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Manuscript title *" className="input flex-1 text-xs" />
            <input value={newJournal} onChange={e => setNewJournal(e.target.value)} placeholder="Target journal" className="input w-40 text-xs" />
            <button onClick={createMs} disabled={!newTitle.trim()} className="btn text-xs" style={{ color: 'var(--color-success)' }}>Create</button>
            <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
          </div>
        </div>
      )}

      {selectMode && selectedIds.size > 0 && (
        <div className="px-6 pt-4">
          <BulkActionBar
            count={selectedIds.size}
            allSelected={manuscripts.length > 0 && manuscripts.every(m => selectedIds.has(m.id))}
            onSelectAll={() => {
              const allSel = manuscripts.every(m => selectedIds.has(m.id))
              setSelectedIds(allSel ? new Set() : new Set(manuscripts.map(m => m.id)))
            }}
            onArchive={async () => {
              try {
                const res = await api.bulkArchiveManuscripts([...selectedIds])
                toast('success', `Archived ${res.updated_count} manuscript${res.updated_count === 1 ? '' : 's'}`)
                load()
                setSelectMode(false); setSelectedIds(new Set())
              } catch (err: any) {
                toast('error', err?.message || 'Bulk archive failed', { title: 'Could not archive' })
              }
            }}
            onRestore={async () => {
              try {
                const res = await api.bulkArchiveManuscripts([...selectedIds], true)
                toast('success', `Restored ${res.updated_count} manuscript${res.updated_count === 1 ? '' : 's'}`)
                load()
                setSelectMode(false); setSelectedIds(new Set())
              } catch (err: any) {
                toast('error', err?.message || 'Bulk restore failed', { title: 'Could not restore' })
              }
            }}
            onDelete={() => setBulkDeleteConfirm(true)}
          />
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 border-r border-[var(--color-border)] overflow-y-auto p-3 space-y-1">
          {manuscripts.length === 0 && (
            <div className="text-center py-8 px-3">
              <FiFileText className="w-8 h-8 mx-auto mb-2 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-xs text-[var(--color-text-muted)]">No manuscripts yet</p>
              <p className="text-xxs text-[var(--color-text-muted)] mt-1">Use "New" above to draft one.</p>
            </div>
          )}
          {manuscripts.map(m => {
            const sel = selectedIds.has(m.id)
            return (
            <div
              key={m.id}
              onClick={() => {
                if (selectMode) {
                  setSelectedIds(prev => {
                    const next = new Set(prev)
                    if (next.has(m.id)) next.delete(m.id); else next.add(m.id)
                    return next
                  })
                } else {
                  selectMs(m.id)
                }
              }}
              className={`p-3 rounded-lg cursor-pointer group transition-colors ${(!selectMode && selected?.id === m.id) || (selectMode && sel) ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'hover:bg-[var(--glass-bg)]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {selectMode && (sel ? <FiCheckSquare className="w-4 h-4 text-[var(--color-text)] flex-shrink-0" /> : <FiSquare className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />)}
                  <span className="text-xs font-medium truncate">{m.title}</span>
                </div>
                {!selectMode && (
                  <button onClick={e => { e.stopPropagation(); deleteMs(m.id) }} className="opacity-0 group-hover:opacity-100 p-1 flex-shrink-0"><FiTrash2 className="w-3 h-3" /></button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xxs px-1.5 py-0.5 rounded-full" style={{ color: STATUS_COLORS[m.status], background: 'var(--glass-bg)' }}>{m.status}</span>
                {m.journal_target && <span className="text-xxs text-[var(--color-text-muted)]">{m.journal_target}</span>}
              </div>
            </div>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]"><FiFileText className="w-12 h-12 mx-auto mb-4 opacity-20" /><p className="text-sm">Select a manuscript</p></div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div><h2 className="text-lg font-semibold">{selected.title}</h2><p className="text-xs text-[var(--color-text-muted)]">{selected.journal_target || 'No target journal'} | {selected.word_count} words | {selected.status}</p></div>
                <div className="flex gap-1">
                  <button onClick={exportMs} className="btn text-xs text-[var(--color-text-muted)]"><FiDownload className="w-3.5 h-3.5" /> Export</button>
                  {selected.status === 'draft' && selected.journal_target && (
                    <button onClick={submitMs} className="btn text-xs" style={{ color: 'var(--color-text-secondary)' }}><FiSend className="w-3.5 h-3.5" /> Submit</button>
                  )}
                </div>
              </div>

              {/* Authors */}
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium flex items-center gap-1"><FiUsers className="w-3.5 h-3.5" /> Authors ({selected.authors.length})</h3>
                  <button onClick={() => setShowAuthorAdd(!showAuthorAdd)} className="btn text-xxs text-[var(--color-text-muted)]"><FiPlus className="w-3 h-3" /></button>
                </div>
                {showAuthorAdd && (
                  <div className="flex gap-2 mb-2">
                    <input value={newAuthor.name} onChange={e => setNewAuthor(a => ({ ...a, name: e.target.value }))} placeholder="Name *" className="input flex-1 text-xs" />
                    <input value={newAuthor.affiliation} onChange={e => setNewAuthor(a => ({ ...a, affiliation: e.target.value }))} placeholder="Affiliation" className="input flex-1 text-xs" />
                    <button onClick={addAuthor} className="btn text-xxs" style={{ color: 'var(--color-success)' }}>Add</button>
                  </div>
                )}
                <div className="space-y-1">
                  {selected.authors.map(a => (
                    <div key={a.id} className="flex items-center justify-between py-1 text-xs">
                      <div><span className="font-medium">{a.order}. {a.name}</span><span className="text-[var(--color-text-muted)] ml-2">{a.affiliation}</span></div>
                      <div className="flex items-center gap-2">
                        <span className="text-xxs text-[var(--color-text-muted)]">{a.role}</span>
                        <button onClick={() => removeAuthor(a.id)} className="p-0.5 hover:text-[var(--color-error)]"><FiTrash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sections */}
              {SECTIONS.map(section => (
                <div key={section} className="glass-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-medium capitalize">{section}</h3>
                    {editSection !== section ? (
                      <button onClick={() => { setEditSection(section); setEditText(selected.sections[section] || '') }} className="btn text-xxs text-[var(--color-text-muted)]"><FiEdit3 className="w-3 h-3" /> Edit</button>
                    ) : (
                      <div className="flex gap-1">
                        <button onClick={saveSection} className="btn text-xxs" style={{ color: 'var(--color-success)' }}><FiSave className="w-3 h-3" /> Save</button>
                        <button onClick={() => setEditSection(null)} className="btn text-xxs text-[var(--color-text-muted)]">Cancel</button>
                      </div>
                    )}
                  </div>
                  {editSection === section ? (
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={8} className="input w-full text-xs font-mono resize-y" />
                  ) : (
                    <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap">{selected.sections[section] || <span className="text-[var(--color-text-muted)] italic">No content yet</span>}</div>
                  )}
                </div>
              ))}

              {/* Submission History */}
              {selected.submission_history.length > 0 && (
                <div className="glass-card p-4">
                  <h3 className="text-xs font-medium mb-2">Submission History</h3>
                  {selected.submission_history.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between py-1.5 text-xs border-b border-[var(--color-border)]/30 last:border-0">
                      <span>{s.journal}</span><span className="text-[var(--color-text-muted)]">{s.status} — {formatDate(s.submitted_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDeleteDialog
        open={deleteConfirmId !== null}
        entityName="Manuscript"
        message="This will permanently delete this manuscript. This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
      <ConfirmDeleteDialog
        open={bulkDeleteConfirm}
        entityName={`${selectedIds.size} Manuscript${selectedIds.size === 1 ? '' : 's'}`}
        message="This will permanently delete the selected manuscripts. This action cannot be undone."
        onConfirm={async () => {
          setBulkDeleteConfirm(false)
          try {
            const res = await api.bulkDeleteManuscripts([...selectedIds])
            toast('success', `Deleted ${res.deleted_count} manuscript${res.deleted_count === 1 ? '' : 's'}`)
            load()
            setSelectMode(false); setSelectedIds(new Set())
          } catch (err: any) {
            toast('error', err?.message || 'Bulk delete failed', { title: 'Could not delete' })
          }
        }}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </div>
  )
}
