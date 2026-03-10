import { useState, useCallback } from 'react'
import {
  FiClipboard,
  FiPlus,
  FiCheck,
  FiClock,
  FiPlay,
  FiPause,
  FiTrash2,
  FiEdit3,
  FiTag,
  FiAlertTriangle,
} from 'react-icons/fi'

interface Experiment {
  id: string
  title: string
  hypothesis: string
  status: 'planned' | 'in_progress' | 'completed' | 'failed' | 'paused'
  protocol: string[]
  materials: string[]
  observations: string
  results: string
  conclusion: string
  tags: string[]
  startDate?: string
  endDate?: string
  createdAt: string
  updatedAt: string
}

const STATUS_CONFIG = {
  planned: { label: 'Planned', color: 'var(--color-text-muted)', icon: FiClock },
  in_progress: { label: 'In Progress', color: 'var(--color-accent-blue)', icon: FiPlay },
  completed: { label: 'Completed', color: 'var(--color-success)', icon: FiCheck },
  failed: { label: 'Failed', color: 'var(--color-error)', icon: FiAlertTriangle },
  paused: { label: 'Paused', color: 'var(--color-warning)', icon: FiPause },
}

export default function ExperimentTracker() {
  const [experiments, setExperiments] = useState<Experiment[]>(() => {
    try { return JSON.parse(localStorage.getItem('humanovo-experiments') || '[]') } catch { return [] }
  })
  const [selected, setSelected] = useState<Experiment | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Partial<Experiment>>({})

  const save = useCallback((updated: Experiment[]) => {
    setExperiments(updated)
    localStorage.setItem('humanovo-experiments', JSON.stringify(updated))
  }, [])

  const [form, setForm] = useState({ title: '', hypothesis: '', tags: '' })

  const addExperiment = () => {
    if (!form.title.trim()) return
    const exp: Experiment = {
      id: `exp-${Date.now()}`,
      title: form.title,
      hypothesis: form.hypothesis,
      status: 'planned',
      protocol: [],
      materials: [],
      observations: '',
      results: '',
      conclusion: '',
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    save([exp, ...experiments])
    setForm({ title: '', hypothesis: '', tags: '' })
    setShowAdd(false)
    setSelected(exp)
  }

  const updateExperiment = (id: string, updates: Partial<Experiment>) => {
    const updated = experiments.map(e => e.id === id ? { ...e, ...updates, updatedAt: new Date().toISOString() } : e)
    save(updated)
    if (selected?.id === id) setSelected({ ...selected, ...updates, updatedAt: new Date().toISOString() })
  }

  const deleteExperiment = (id: string) => {
    save(experiments.filter(e => e.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const filtered = experiments.filter(e => !filterStatus || e.status === filterStatus)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-80 flex flex-col border-r border-[var(--color-border)]">
        <div className="p-4 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FiClipboard className="w-4 h-4 text-[var(--color-text-muted)]" />
              <h2 className="text-sm font-medium">Experiment Tracker</h2>
            </div>
            <button onClick={() => setShowAdd(!showAdd)} className="btn btn-sm text-xs" style={{ color: 'var(--color-accent-blue)' }}>
              <FiPlus className="w-3.5 h-3.5" />
            </button>
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input w-full text-xs py-1.5">
            <option value="">All Status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {showAdd && (
          <div className="p-3 border-b border-[var(--color-border)] bg-[var(--glass-bg)] space-y-2 animate-slide-down">
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Experiment title *" className="input w-full text-xs" />
            <textarea value={form.hypothesis} onChange={e => setForm(f => ({ ...f, hypothesis: e.target.value }))} placeholder="Hypothesis being tested" rows={2} className="input w-full text-xs resize-none" />
            <input type="text" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="Tags (comma-separated)" className="input w-full text-xs" />
            <div className="flex gap-2">
              <button onClick={addExperiment} disabled={!form.title.trim()} className="btn btn-sm text-xs flex-1 disabled:opacity-30" style={{ color: 'var(--color-success)' }}>Create</button>
              <button onClick={() => setShowAdd(false)} className="btn btn-sm text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
              <FiClipboard className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-xs">No experiments yet</p>
            </div>
          ) : filtered.map(exp => {
            const cfg = STATUS_CONFIG[exp.status]
            const Icon = cfg.icon
            return (
              <button
                key={exp.id}
                onClick={() => { setSelected(exp); setEditing(false) }}
                className={`w-full text-left p-3 rounded-lg transition-all ${selected?.id === exp.id ? 'bg-[var(--glass-bg-hover)] border border-[var(--color-border-strong)]' : 'hover:bg-[var(--glass-bg)]'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-3 h-3 flex-shrink-0" style={{ color: cfg.color }} />
                  <h3 className="text-xs font-medium truncate">{exp.title}</h3>
                </div>
                <div className="flex items-center gap-2 text-xxs text-[var(--color-text-muted)]">
                  <span style={{ color: cfg.color }}>{cfg.label}</span>
                  <span>{new Date(exp.updatedAt).toLocaleDateString()}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right - detail */}
      {selected ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-xl font-semibold">{selected.title}</h1>
                <div className="flex items-center gap-3 mt-2">
                  <select
                    value={selected.status}
                    onChange={e => updateExperiment(selected.id, { status: e.target.value as Experiment['status'] })}
                    className="input text-xs py-1"
                    style={{ color: STATUS_CONFIG[selected.status].color }}
                  >
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <span className="text-xs text-[var(--color-text-muted)]">Updated {new Date(selected.updatedAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setEditing(!editing); setEditData(selected) }} className="btn btn-sm text-xs" style={{ color: 'var(--color-accent-blue)' }}>
                  <FiEdit3 className="w-3.5 h-3.5" /> {editing ? 'Cancel' : 'Edit'}
                </button>
                <button onClick={() => deleteExperiment(selected.id)} className="btn btn-sm text-xs" style={{ color: 'var(--color-error)' }}>
                  <FiTrash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {selected.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {selected.tags.map(t => (
                  <span key={t} className="text-xxs px-2 py-0.5 rounded-md bg-[var(--glass-bg)] text-[var(--color-text-muted)]"><FiTag className="w-2.5 h-2.5 inline mr-0.5" />{t}</span>
                ))}
              </div>
            )}

            <div className="space-y-6">
              {/* Hypothesis */}
              <section>
                <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Hypothesis</h3>
                {editing ? (
                  <textarea value={editData.hypothesis || ''} onChange={e => setEditData(d => ({ ...d, hypothesis: e.target.value }))} rows={3} className="input w-full text-sm resize-none" />
                ) : (
                  <p className="text-sm text-[var(--color-text-secondary)] p-4 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                    {selected.hypothesis || <span className="italic text-[var(--color-text-muted)]">Not specified</span>}
                  </p>
                )}
              </section>

              {/* Observations */}
              <section>
                <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Observations</h3>
                {editing ? (
                  <textarea value={editData.observations || ''} onChange={e => setEditData(d => ({ ...d, observations: e.target.value }))} rows={5} className="input w-full text-sm resize-none" placeholder="Record observations..." />
                ) : (
                  <p className="text-sm text-[var(--color-text-secondary)] p-4 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] min-h-[80px] whitespace-pre-wrap">
                    {selected.observations || <span className="italic text-[var(--color-text-muted)]">No observations recorded</span>}
                  </p>
                )}
              </section>

              {/* Results */}
              <section>
                <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Results</h3>
                {editing ? (
                  <textarea value={editData.results || ''} onChange={e => setEditData(d => ({ ...d, results: e.target.value }))} rows={5} className="input w-full text-sm resize-none" placeholder="Record results..." />
                ) : (
                  <p className="text-sm text-[var(--color-text-secondary)] p-4 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] min-h-[80px] whitespace-pre-wrap">
                    {selected.results || <span className="italic text-[var(--color-text-muted)]">No results recorded</span>}
                  </p>
                )}
              </section>

              {/* Conclusion */}
              <section>
                <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Conclusion</h3>
                {editing ? (
                  <textarea value={editData.conclusion || ''} onChange={e => setEditData(d => ({ ...d, conclusion: e.target.value }))} rows={3} className="input w-full text-sm resize-none" placeholder="Summarize conclusions..." />
                ) : (
                  <p className="text-sm text-[var(--color-text-secondary)] p-4 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                    {selected.conclusion || <span className="italic text-[var(--color-text-muted)]">No conclusion yet</span>}
                  </p>
                )}
              </section>

              {editing && (
                <button
                  onClick={() => { updateExperiment(selected.id, editData); setEditing(false) }}
                  className="btn text-sm"
                  style={{ color: 'var(--color-success)' }}
                >
                  <FiCheck className="w-4 h-4" /> Save Changes
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
          <div className="text-center">
            <FiClipboard className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">Select an experiment to view details</p>
            <p className="text-xs mt-1">or create a new one to start tracking</p>
          </div>
        </div>
      )}
    </div>
  )
}
