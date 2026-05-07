import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { formatDate, formatDateTime, logActivity, persistGet, persistSet } from '../utils/persistence'
import api from '../services/api'
import { toast } from '../contexts/ToastContext'
import { Skeleton } from '../components/Skeleton'
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

// Status — icon + label carry the meaning; colour stays muted to match
// the rest of the app's palette. "failed" keeps a subtle red since it
// is destructive/critical semantic information.
const STATUS_CONFIG = {
  planned: { label: 'Planned', color: 'var(--color-text-muted)', icon: FiClock },
  in_progress: { label: 'In Progress', color: 'var(--color-text-muted)', icon: FiPlay },
  completed: { label: 'Completed', color: 'var(--color-text-muted)', icon: FiCheck },
  failed: { label: 'Failed', color: 'var(--color-text-muted)', icon: FiAlertTriangle },
  paused: { label: 'Paused', color: 'var(--color-text-muted)', icon: FiPause },
}

// Enum-guarded status filter values so `?status=bogus` falls back to
// "all" without crashing or polluting the select control.
const VALID_STATUS_FILTERS = new Set(['', 'planned', 'in_progress', 'completed', 'failed', 'paused'])

// API is source of truth; local cache only for offline-first UX so the
// page still renders while the fetch is in flight after a reload.
const CACHE_KEY = 'experiments'

function normalizeFromApi(row: Record<string, unknown>): Experiment {
  const s = (v: unknown, dflt = ''): string => typeof v === 'string' ? v : dflt
  const sOpt = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined
  const arr = (v: unknown): string[] => Array.isArray(v) ? (v as string[]) : []
  return {
    id: String(row.id),
    title: s(row.title),
    hypothesis: s(row.hypothesis),
    status: (s(row.status, 'planned')) as Experiment['status'],
    protocol: arr(row.protocol),
    materials: arr(row.materials),
    observations: s(row.observations),
    results: s(row.results),
    conclusion: s(row.conclusion),
    tags: arr(row.tags),
    startDate: sOpt(row.start_date) ?? sOpt(row.startDate),
    endDate: sOpt(row.end_date) ?? sOpt(row.endDate),
    createdAt: sOpt(row.created_at) ?? sOpt(row.createdAt) ?? new Date().toISOString(),
    updatedAt: sOpt(row.updated_at) ?? sOpt(row.updatedAt) ?? new Date().toISOString(),
  }
}

function toApiPayload(exp: Partial<Experiment>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (exp.title !== undefined) out.title = exp.title
  if (exp.hypothesis !== undefined) out.hypothesis = exp.hypothesis
  if (exp.status !== undefined) out.status = exp.status
  if (exp.protocol !== undefined) out.protocol = exp.protocol
  if (exp.materials !== undefined) out.materials = exp.materials
  if (exp.observations !== undefined) out.observations = exp.observations
  if (exp.results !== undefined) out.results = exp.results
  if (exp.conclusion !== undefined) out.conclusion = exp.conclusion
  if (exp.tags !== undefined) out.tags = exp.tags
  if (exp.startDate !== undefined) out.start_date = exp.startDate
  if (exp.endDate !== undefined) out.end_date = exp.endDate
  return out
}

export default function ExperimentTracker() {
  const [experiments, _setExperiments] = useState<Experiment[]>(() => persistGet<Experiment[]>(CACHE_KEY, []))
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const setExperiments = useCallback((fn: Experiment[] | ((prev: Experiment[]) => Experiment[])) => {
    _setExperiments(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      persistSet(CACHE_KEY, next)
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.getExperiments({ page_size: 200 })
        if (cancelled) return
        const items = (res?.items || []).map(normalizeFromApi)
        setExperiments(items)
        setStale(false)
      } catch {
        if (!cancelled) setStale(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [setExperiments])
  // Deep-link support: `?add=1` auto-opens the new-experiment dialog;
  // `?status=<planned|in_progress|...>` seeds the status filter;
  // `?id=<experimentId>` selects that experiment once it loads.
  // All three are stripped from the URL on mount so shared links
  // stay canonical.
  const [searchParams] = useSearchParams()
  const [selected, setSelected] = useState<Experiment | null>(() => {
    const qId = searchParams.get('id')
    if (!qId) return null
    // experiments list is still initializing from persistence; a
    // second effect below will reconcile `selected` once the array
    // is ready if it wasn't available during initial render.
    return null
  })
  const [showAdd, setShowAdd] = useState(() => searchParams.get('add') === '1')
  const [filterStatus, setFilterStatus] = useState(() => {
    const qs = searchParams.get('status') || ''
    return VALID_STATUS_FILTERS.has(qs) ? qs : ''
  })
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    let dirty = false
    if (sp.has('add')) { sp.delete('add'); dirty = true }
    if (sp.has('status')) { sp.delete('status'); dirty = true }
    const qId = sp.get('id')
    if (qId) { sp.delete('id'); dirty = true }
    if (dirty) {
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
    if (qId) {
      const match = experiments.find(e => e.id === qId)
      if (match) setSelected(match)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Partial<Experiment>>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const [form, setForm] = useState({ title: '', hypothesis: '', tags: '' })

  const addExperiment = async () => {
    if (!form.title.trim()) return
    const payload = {
      title: form.title,
      hypothesis: form.hypothesis,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    }
    try {
      const created = await api.createExperiment(payload)
      const exp = normalizeFromApi(created)
      setExperiments(prev => [exp, ...prev])
      logActivity({ type: 'project', action: 'created', title: exp.title })
      setForm({ title: '', hypothesis: '', tags: '' })
      setShowAdd(false)
      setSelected(exp)
      toast('success', 'Experiment created')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Create failed'
      toast('error', msg, { title: 'Could not create experiment' })
    }
  }

  const updateExperiment = async (id: string, updates: Partial<Experiment>) => {
    const previous = experiments.find(e => e.id === id)
    // Optimistic local update for snappy UX
    const optimistic = { ...previous!, ...updates, updatedAt: new Date().toISOString() } as Experiment
    setExperiments(prev => prev.map(e => e.id === id ? optimistic : e))
    if (selected?.id === id) setSelected(optimistic)
    try {
      const updated = normalizeFromApi(await api.updateExperiment(id, toApiPayload(updates)))
      setExperiments(prev => prev.map(e => e.id === id ? updated : e))
      if (selected?.id === id) setSelected(updated)
      logActivity({ type: 'evidence', action: 'updated', title: `Updated experiment: ${previous?.title || id}` })
    } catch (err: unknown) {
      // Roll back to previous state if server rejects
      if (previous) {
        setExperiments(prev => prev.map(e => e.id === id ? previous : e))
        if (selected?.id === id) setSelected(previous)
      }
      const msg = err instanceof Error ? err.message : 'Update failed'
      toast('error', msg, { title: 'Could not save changes' })
    }
  }

  const deleteExperiment = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    const id = deleteConfirmId
    const deletedExp = experiments.find(e => e.id === id)
    setDeleteConfirmId(null)
    try {
      await api.deleteExperiment(id)
      setExperiments(prev => prev.filter(e => e.id !== id))
      logActivity({ type: 'project', action: 'deleted', title: `Deleted experiment: ${deletedExp?.title || id}` })
      if (selected?.id === id) setSelected(null)
      toast('success', `Deleted ${deletedExp?.title || 'experiment'}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed'
      toast('error', msg, { title: 'Could not delete' })
    }
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
              {stale && (
                <span
                  className="text-xxs px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]"
                  title="Backend unreachable — showing locally-cached experiments"
                >
                  cached
                </span>
              )}
            </div>
            <button onClick={() => setShowAdd(!showAdd)} className="btn btn-sm text-xs" style={{ color: 'var(--color-text-secondary)' }}>
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
          {loading && filtered.length === 0 ? (
            <div className="space-y-2 p-1">
              {[0, 1, 2, 3].map(i => <Skeleton key={i} height={56} style={{ borderRadius: 8 }} />)}
            </div>
          ) : filtered.length === 0 ? (
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
                  <span>{formatDate(exp.updatedAt)}</span>
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
                  <span className="text-xs text-[var(--color-text-muted)]">Updated {formatDateTime(selected.updatedAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setEditing(!editing); setEditData(selected) }} className="btn btn-sm text-xs" style={{ color: 'var(--color-text-secondary)' }}>
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
      {deleteConfirmId && (
        <ConfirmDeleteDialog
          title="Delete Experiment?"
          message="This will permanently delete this experiment and all its data. This action cannot be undone."
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}
