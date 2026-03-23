import { useState, useEffect } from 'react'
import {
  FiFileText, FiPlus, FiTrash2, FiEdit3, FiUsers, FiSend,
  FiDownload, FiSave,
} from 'react-icons/fi'
import { formatDate } from '../utils/persistence'

interface Manuscript {
  id: string; title: string; status: string; journal_target: string
  sections: Record<string, string>; authors: Author[]; keywords: string[]
  submission_history: any[]; word_count: number; created_at: string; updated_at: string
}
interface Author { id: string; name: string; affiliation: string; email: string; role: string; order: number }

const API = '/api/v1/manuscripts'
const STATUS_COLORS: Record<string, string> = { draft: 'var(--color-text-muted)', review: 'var(--color-accent-blue)', submitted: 'var(--color-accent-purple)', accepted: 'var(--color-success)', published: 'var(--color-accent-green)', rejected: 'var(--color-error)' }
const SECTIONS = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'references']

export default function ManuscriptManager() {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([])
  const [selected, setSelected] = useState<Manuscript | null>(null)
  const [editSection, setEditSection] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newJournal, setNewJournal] = useState('')
  const [showAuthorAdd, setShowAuthorAdd] = useState(false)
  const [newAuthor, setNewAuthor] = useState({ name: '', affiliation: '', email: '', role: 'Co-Author' })

  const load = async () => { try { const r = await fetch(API); if (r.ok) setManuscripts((await r.json()).items || []) } catch {} }
  useEffect(() => { load() }, [])

  const selectMs = async (id: string) => {
    const r = await fetch(`${API}/${id}`)
    if (r.ok) { const ms = await r.json(); setSelected(ms); setEditSection(null) }
  }

  const createMs = async () => {
    if (!newTitle.trim()) return
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle, journal_target: newJournal }) })
    if (r.ok) { load(); setShowAdd(false); setNewTitle(''); setNewJournal('') }
  }

  const deleteMs = async (id: string) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' })
    if (selected?.id === id) setSelected(null); load()
  }

  const saveSection = async () => {
    if (!selected || !editSection) return
    const sections = { ...selected.sections, [editSection]: editText }
    const r = await fetch(`${API}/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sections }) })
    if (r.ok) { const ms = await r.json(); setSelected(ms); setEditSection(null) }
  }

  const addAuthor = async () => {
    if (!selected || !newAuthor.name.trim()) return
    const r = await fetch(`${API}/${selected.id}/authors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAuthor) })
    if (r.ok) { selectMs(selected.id); setShowAuthorAdd(false); setNewAuthor({ name: '', affiliation: '', email: '', role: 'Co-Author' }) }
  }

  const removeAuthor = async (authorId: string) => {
    if (!selected) return
    await fetch(`${API}/${selected.id}/authors/${authorId}`, { method: 'DELETE' })
    selectMs(selected.id)
  }

  const exportMs = async () => {
    if (!selected) return
    const r = await fetch(`${API}/${selected.id}/export?format=markdown`)
    if (r.ok) { const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${selected.title}.md`; a.click() }
  }

  const submitMs = async () => {
    if (!selected || !selected.journal_target) return
    const r = await fetch(`${API}/${selected.id}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ journal: selected.journal_target }) })
    if (r.ok) selectMs(selected.id)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div><h1 className="text-2xl font-semibold tracking-tight">Manuscript Manager</h1><p className="text-sm text-[var(--color-text-muted)] mt-1">Draft, format, and track manuscript submissions</p></div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}><FiPlus className="w-4 h-4" /> New Manuscript</button>
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

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 border-r border-[var(--color-border)] overflow-y-auto p-3 space-y-1">
          {manuscripts.map(m => (
            <div key={m.id} onClick={() => selectMs(m.id)}
              className={`p-3 rounded-lg cursor-pointer group transition-colors ${selected?.id === m.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'hover:bg-[var(--glass-bg)]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate">{m.title}</span>
                <button onClick={e => { e.stopPropagation(); deleteMs(m.id) }} className="opacity-0 group-hover:opacity-100 p-1"><FiTrash2 className="w-3 h-3" /></button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xxs px-1.5 py-0.5 rounded-full" style={{ color: STATUS_COLORS[m.status], background: 'var(--glass-bg)' }}>{m.status}</span>
                {m.journal_target && <span className="text-xxs text-[var(--color-text-muted)]">{m.journal_target}</span>}
              </div>
            </div>
          ))}
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
                    <button onClick={submitMs} className="btn text-xs" style={{ color: 'var(--color-accent-blue)' }}><FiSend className="w-3.5 h-3.5" /> Submit</button>
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
    </div>
  )
}
