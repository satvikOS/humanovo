import { useState, useEffect, useRef } from 'react'
import {
  FiDatabase, FiUpload, FiDownload, FiSearch, FiTrash2,
  FiPlus, FiEye, FiBarChart2, FiBook,
} from 'react-icons/fi'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { logActivity } from '../utils/persistence'

interface Dataset {
  id: string; name: string; description: string; format: string
  columns: Column[]; rows: any[]; row_count: number; tags: string[]
  created_at: string; updated_at: string
}
interface Column { name: string; type: string; description: string; nullable: boolean }
interface Profile { name: string; count: number; non_null: number; null_count: number; completeness: number; unique: number; min?: number; max?: number; mean?: number; value_counts?: Record<string, number> }

const API = '/api/v1/datasets'

export default function DataManager() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [selected, setSelected] = useState<Dataset | null>(null)
  const [profile, setProfile] = useState<{ columns: Profile[]; row_count: number; total_completeness: number } | null>(null)
  const [view, setView] = useState<'list' | 'preview' | 'profile' | 'dictionary'>('list')
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [search, setSearch] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch(API)
      if (res.ok) { const d = await res.json(); setDatasets(d.items || []) }
    } catch { /* ignore */ }
  }

  useEffect(() => { load() }, [])

  const createDataset = async () => {
    if (!newName.trim()) return
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, description: newDesc }) })
    if (res.ok) { const ds = await res.json(); setDatasets(prev => [ds, ...prev]); setNewName(''); setNewDesc(''); setShowAdd(false); logActivity({ type: 'discovery', action: 'created', title: `Created dataset: ${newName}` }) }
  }

  const deleteDataset = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    const deletedDs = datasets.find(d => d.id === deleteConfirmId)
    await fetch(`${API}/${deleteConfirmId}`, { method: 'DELETE' })
    setDatasets(prev => prev.filter(d => d.id !== deleteConfirmId))
    if (selected?.id === deleteConfirmId) { setSelected(null); setView('list') }
    setDeleteConfirmId(null)
    logActivity({ type: 'discovery', action: 'deleted', title: `Deleted dataset: ${deletedDs?.name || deleteConfirmId}` })
  }

  const uploadFile = async (dsId: string, file: File) => {
    const form = new FormData(); form.append('file', file)
    const res = await fetch(`${API}/${dsId}/upload`, { method: 'POST', body: form })
    if (res.ok) { load(); selectDs(dsId); logActivity({ type: 'discovery', action: 'imported', title: `Uploaded file to dataset: ${file.name}` }) }
  }

  const selectDs = async (id: string) => {
    const res = await fetch(`${API}/${id}`)
    if (res.ok) { const ds = await res.json(); setSelected(ds); setView('preview') }
  }

  const loadProfile = async (id: string) => {
    const res = await fetch(`${API}/${id}/profile`)
    if (res.ok) { setProfile(await res.json()); setView('profile') }
  }

  const exportDs = async (id: string, fmt: string) => {
    const res = await fetch(`${API}/${id}/export?format=${fmt}`, { method: 'POST' })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `export.${fmt}`; a.click()
    }
  }

  const filtered = datasets.filter(d => !search || d.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Research Data Manager</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Import, explore, and manage research datasets</p>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <FiPlus className="w-4 h-4" /> New Dataset
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)] animate-slide-down">
          <div className="max-w-xl mx-auto space-y-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Dataset name *" className="input w-full text-sm" />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description" className="input w-full text-sm" />
            <div className="flex gap-2">
              <button onClick={createDataset} disabled={!newName.trim()} className="btn text-xs" style={{ color: 'var(--color-success)' }}>Create</button>
              <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Dataset list */}
        <div className="w-72 border-r border-[var(--color-border)] overflow-y-auto p-3 space-y-1">
          <div className="relative mb-2">
            <FiSearch className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search datasets..." className="input w-full text-xs pl-8" />
          </div>
          {filtered.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-8">No datasets</p>
          ) : filtered.map(ds => (
            <div key={ds.id} onClick={() => selectDs(ds.id)}
              className={`p-3 rounded-lg cursor-pointer transition-colors group ${selected?.id === ds.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'hover:bg-[var(--glass-bg)]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate">{ds.name}</span>
                <button onClick={e => { e.stopPropagation(); deleteDataset(ds.id) }} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-[var(--color-error)]">
                  <FiTrash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex gap-2 mt-1 text-xxs text-[var(--color-text-muted)]">
                <span>{ds.row_count} rows</span>
                <span>{ds.format}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Right: Detail view */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]">
              <FiDatabase className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm">Select a dataset to view</p>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <div className="flex gap-1">
                  <input ref={fileRef} type="file" accept=".csv,.json" className="hidden" onChange={e => { if (e.target.files?.[0]) uploadFile(selected.id, e.target.files[0]) }} />
                  <button onClick={() => fileRef.current?.click()} className="btn text-xs text-[var(--color-text-muted)]"><FiUpload className="w-3.5 h-3.5" /> Upload</button>
                  <button onClick={() => exportDs(selected.id, 'csv')} className="btn text-xs text-[var(--color-text-muted)]"><FiDownload className="w-3.5 h-3.5" /> CSV</button>
                  <button onClick={() => exportDs(selected.id, 'json')} className="btn text-xs text-[var(--color-text-muted)]"><FiDownload className="w-3.5 h-3.5" /> JSON</button>
                </div>
              </div>
              {selected.description && <p className="text-xs text-[var(--color-text-muted)] mb-4">{selected.description}</p>}

              {/* View tabs */}
              <div className="flex gap-1 mb-4">
                {[
                  { id: 'preview', label: 'Preview', icon: <FiEye className="w-3.5 h-3.5" /> },
                  { id: 'profile', label: 'Data Quality', icon: <FiBarChart2 className="w-3.5 h-3.5" /> },
                  { id: 'dictionary', label: 'Dictionary', icon: <FiBook className="w-3.5 h-3.5" /> },
                ].map(t => (
                  <button key={t.id} onClick={() => { if (t.id === 'profile') loadProfile(selected.id); else setView(t.id as any) }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${view === t.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              {/* Preview table */}
              {view === 'preview' && selected.rows && (
                <div className="overflow-x-auto glass-card">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        {selected.columns.map(c => <th key={c.name} className="text-left p-2 text-[var(--color-text-muted)] font-medium">{c.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.rows.slice(0, 50).map((row, i) => (
                        <tr key={i} className="border-b border-[var(--color-border)]/30 hover:bg-[var(--glass-bg)]">
                          {selected.columns.map(c => (
                            <td key={c.name} className="p-2 font-mono">
                              {row[c.name] === null ? <span className="text-[var(--color-text-muted)] italic">null</span> : String(row[c.name])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-2 text-xxs text-[var(--color-text-muted)]">Showing {Math.min(50, selected.rows.length)} of {selected.row_count} rows</div>
                </div>
              )}

              {/* Data quality profile */}
              {view === 'profile' && profile && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="glass-card p-4 text-center">
                      <div className="text-2xl font-semibold">{profile.row_count}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">Total Rows</div>
                    </div>
                    <div className="glass-card p-4 text-center">
                      <div className="text-2xl font-semibold">{profile.columns.length}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">Columns</div>
                    </div>
                    <div className="glass-card p-4 text-center">
                      <div className="text-2xl font-semibold" style={{ color: profile.total_completeness > 0.9 ? 'var(--color-success)' : 'var(--color-warning)' }}>{(profile.total_completeness * 100).toFixed(1)}%</div>
                      <div className="text-xs text-[var(--color-text-muted)]">Completeness</div>
                    </div>
                  </div>

                  <div className="glass-card p-4">
                    <h3 className="text-sm font-medium mb-3">Column Completeness</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={profile.columns.map(c => ({ name: c.name, completeness: Math.round(c.completeness * 100) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                        <Bar dataKey="completeness" fill="var(--color-accent-blue)" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {profile.columns.map(c => (
                    <div key={c.name} className="glass-card p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{c.name}</span>
                        <span className={`text-xxs px-2 py-0.5 rounded-full ${c.completeness === 1 ? 'bg-[var(--glass-bg)] text-[var(--color-text-secondary)]' : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)]'}`}>
                          {(c.completeness * 100).toFixed(0)}% complete
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xxs text-[var(--color-text-muted)]">
                        <span>Count: {c.count}</span>
                        <span>Unique: {c.unique}</span>
                        {c.min !== undefined && <span>Min: {c.min}</span>}
                        {c.max !== undefined && <span>Max: {c.max}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Data dictionary */}
              {view === 'dictionary' && (
                <div className="glass-card overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="text-left p-3 text-[var(--color-text-muted)]">Column</th>
                        <th className="text-left p-3 text-[var(--color-text-muted)]">Type</th>
                        <th className="text-left p-3 text-[var(--color-text-muted)]">Description</th>
                        <th className="text-left p-3 text-[var(--color-text-muted)]">Nullable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.columns.map(c => (
                        <tr key={c.name} className="border-b border-[var(--color-border)]/30">
                          <td className="p-3 font-mono font-medium">{c.name}</td>
                          <td className="p-3"><span className="px-2 py-0.5 rounded bg-[var(--glass-bg)] text-xxs">{c.type}</span></td>
                          <td className="p-3 text-[var(--color-text-muted)]">{c.description || '—'}</td>
                          <td className="p-3">{c.nullable ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDeleteDialog
        open={deleteConfirmId !== null}
        entityName="Dataset"
        message="This will permanently delete this dataset. This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
