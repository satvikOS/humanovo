import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FiSearch, FiPlus, FiTrash2, FiAlertTriangle, FiLogOut, FiLogIn, FiDatabase, FiCheckSquare, FiSquare } from 'react-icons/fi'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { EmptyState } from '../components/EmptyState'
import { BulkActionBar } from '../components/BulkActionBar'
import { logActivity } from '../utils/persistence'
import { toast } from '../contexts/ToastContext'
import { apiClient } from '../services'
import api from '../services/api'

interface Sample {
  id: string; barcode: string; sample_type: string; status: string; project: string
  tissue_type: string; patient_id: string; collection_date: string; quantity: string
  quality_score: number; chain_of_custody: any[]; storage_details: any
}
interface Inventory { total_samples: number; by_type: Record<string, number>; by_status: Record<string, number>; by_project: Record<string, number>; alerts: any[]; storage_utilization: any[] }

// apiClient's baseURL already includes /api/v1
const BASE = '/biobank'
const PIE_COLORS = ['#5B8DB8', '#8B7EAF', '#6BA594', '#C4956A', '#7BA7B8', '#B07E8B']
const STATUS_COLORS: Record<string, string> = { available: 'text-[var(--color-text-secondary)] bg-[var(--glass-bg)]', checked_out: 'text-[var(--color-text-muted)] bg-[var(--glass-bg)]', depleted: 'text-[var(--color-text-muted)] bg-[var(--glass-bg)]', reserved: 'text-[var(--color-text-secondary)] bg-[var(--glass-bg)]' }

// Enum-guarded view & filter sets keep bogus `?view=` / `?status=` /
// `?type=` values from polluting component state. Sample types and
// statuses here match the backend `/api/v1/biobank` enums.
const VALID_VIEWS = new Set(['list', 'inventory'])
const VALID_BIOBANK_STATUSES = new Set(['', 'available', 'checked_out', 'depleted', 'reserved'])
const VALID_BIOBANK_TYPES = new Set(['', 'tissue', 'blood', 'dna', 'rna', 'plasma', 'serum', 'saliva', 'urine', 'cell_line'])

export default function BiobankManager() {
  // Deep-link support: `?add=1` opens the add-sample dialog,
  // `?view=list|inventory` seeds the tab selector, `?q=<term>` seeds
  // the search input, `?status=`/`?type=` seed the two filters, and
  // `?id=<sampleId>` selects that sample once the list loads. All
  // params are stripped on mount for shareable canonical URLs.
  const [searchParams] = useSearchParams()
  const [samples, setSamples] = useState<Sample[]>([])
  const [selected, setSelected] = useState<Sample | null>(null)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [view, setView] = useState<'list' | 'inventory'>(() => {
    const qv = searchParams.get('view') || ''
    return VALID_VIEWS.has(qv) ? (qv as 'list' | 'inventory') : 'list'
  })
  const [search, setSearch] = useState(() => searchParams.get('q') || '')
  const [typeFilter, setTypeFilter] = useState(() => {
    const qt = searchParams.get('type') || ''
    return VALID_BIOBANK_TYPES.has(qt) ? qt : ''
  })
  const [statusFilter, setStatusFilter] = useState(() => {
    const qs = searchParams.get('status') || ''
    return VALID_BIOBANK_STATUSES.has(qs) ? qs : ''
  })
  const [showAdd, setShowAdd] = useState(() => searchParams.get('add') === '1')
  const [form, setForm] = useState({ barcode: '', sample_type: 'tissue', tissue_type: '', project: '', patient_id: '', quantity: '' })
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  // Bulk selection state (see components/BulkActionBar for the UX)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  // Checkout dialog — replaces the old hard-coded {researcher: 'Current
  // Researcher', purpose: 'Analysis'} payload. Remembers the last
  // researcher name in localStorage so repeated checkouts stay quick.
  const [checkoutSampleId, setCheckoutSampleId] = useState<string | null>(null)
  const [checkoutForm, setCheckoutForm] = useState(() => {
    try {
      const cached = localStorage.getItem('biobank.lastResearcher') || ''
      return { researcher: cached, purpose: '' }
    } catch { return { researcher: '', purpose: '' } }
  })

  const load = async () => {
    try {
      const { data } = await apiClient.get(`${BASE}/samples`, {
        headers: { 'X-Silent-Error': '1' },
      })
      setSamples(data?.items || [])
    } catch (err) {
      toast('error', `Could not load samples — ${err instanceof Error ? err.message : 'unknown error'}`, {
        title: 'Biobank',
      })
    }
    try {
      const { data } = await apiClient.get(`${BASE}/inventory`, {
        headers: { 'X-Silent-Error': '1' },
      })
      setInventory(data)
    } catch (err) {
      toast('error', `Could not load inventory — ${err instanceof Error ? err.message : 'unknown error'}`, {
        title: 'Biobank',
      })
    }
  }
  useEffect(() => { load() }, [])

  // Consume & strip known query-string params after mount so shared
  // links remain canonical. `?id=` is also applied to `selected` once
  // the backend list finishes loading (see below).
  const [pendingId] = useState(() => searchParams.get('id') || '')
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    let dirty = false
    for (const k of ['add', 'view', 'q', 'type', 'status', 'id']) {
      if (sp.has(k)) { sp.delete(k); dirty = true }
    }
    if (dirty) {
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
     
  }, [])
  useEffect(() => {
    if (!pendingId || selected) return
    const match = samples.find(s => s.id === pendingId)
    if (match) setSelected(match)
  }, [samples, pendingId, selected])

  const createSample = async () => {
    try {
      await apiClient.post(`${BASE}/samples`, form)
      load()
      setShowAdd(false)
      logActivity({ type: 'discovery', action: 'created', title: `Added biobank sample: ${form.barcode || form.sample_type}` })
      setForm({ barcode: '', sample_type: 'tissue', tissue_type: '', project: '', patient_id: '', quantity: '' })
    } catch { /* interceptor surfaces the toast */ }
  }

  const deleteSample = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    const deletedSample = samples.find(s => s.id === deleteConfirmId)
    try {
      await apiClient.delete(`${BASE}/samples/${deleteConfirmId}`)
    } catch { /* interceptor surfaces the toast */ }
    if (selected?.id === deleteConfirmId) setSelected(null); load()
    setDeleteConfirmId(null)
    logActivity({ type: 'discovery', action: 'deleted', title: `Deleted biobank sample: ${deletedSample?.barcode || deleteConfirmId}` })
  }

  const checkout = (id: string) => {
    setCheckoutSampleId(id)
  }

  const confirmCheckout = async () => {
    if (!checkoutSampleId) return
    const researcher = checkoutForm.researcher.trim() || 'Unassigned'
    const purpose = checkoutForm.purpose.trim() || 'Analysis'
    try {
      const { data: s } = await apiClient.post(`${BASE}/samples/${checkoutSampleId}/checkout`, { researcher, purpose })
      setSelected(s); load()
      try { localStorage.setItem('biobank.lastResearcher', researcher) } catch { /* quota */ }
      logActivity({ type: 'discovery', action: 'updated', title: `Checked out sample: ${s.barcode || checkoutSampleId}` })
    } catch { /* interceptor surfaces the toast */ }
    setCheckoutSampleId(null)
  }

  const checkin = async (id: string) => {
    try {
      const { data: s } = await apiClient.post(`${BASE}/samples/${id}/checkin`, null, { params: { condition: 'good' } })
      setSelected(s); load()
      logActivity({ type: 'discovery', action: 'updated', title: `Returned sample: ${s.barcode || id}` })
    } catch { /* interceptor surfaces the toast */ }
  }

  const filtered = samples.filter(s => {
    if (typeFilter && s.sample_type !== typeFilter) return false
    if (statusFilter && s.status !== statusFilter) return false
    if (search) { const q = search.toLowerCase(); return s.barcode.toLowerCase().includes(q) || s.tissue_type.toLowerCase().includes(q) || s.patient_id.toLowerCase().includes(q) || s.project.toLowerCase().includes(q) }
    return true
  })

  const typeData = inventory ? Object.entries(inventory.by_type).map(([name, value]) => ({ name, value })) : []

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div><h1 className="text-2xl font-semibold tracking-tight">Biobank Manager</h1><p className="text-sm text-[var(--color-text-muted)] mt-1">Sample registry, storage, and chain of custody</p></div>
          <div className="flex gap-2">
            <button
              onClick={() => { if (selectMode) { setSelectMode(false); setSelectedIds(new Set()) } else setSelectMode(true) }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${selectMode ? 'border-[var(--color-border-strong)] text-[var(--color-text)]' : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]'}`}
              aria-pressed={selectMode}
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
            <button onClick={() => setView(view === 'list' ? 'inventory' : 'list')} className="btn text-xs text-[var(--color-text-muted)]">{view === 'list' ? 'Inventory' : 'Sample List'}</button>
            <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-text-secondary)' }}><FiPlus className="w-4 h-4" /> New Sample</button>
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)]">
          <div className="max-w-xl mx-auto space-y-2">
            <div className="flex gap-2">
              <input value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} placeholder="Barcode (auto if empty)" className="input w-32 text-xs" />
              <select value={form.sample_type} onChange={e => setForm(f => ({ ...f, sample_type: e.target.value }))} className="input text-xs w-28">
                {['tissue', 'blood', 'plasma', 'serum', 'dna', 'rna', 'cell_line', 'ffpe'].map(t => <option key={t}>{t}</option>)}
              </select>
              <input value={form.tissue_type} onChange={e => setForm(f => ({ ...f, tissue_type: e.target.value }))} placeholder="Tissue type" className="input flex-1 text-xs" />
            </div>
            <div className="flex gap-2">
              <input value={form.project} onChange={e => setForm(f => ({ ...f, project: e.target.value }))} placeholder="Project" className="input flex-1 text-xs" />
              <input value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} placeholder="Patient ID" className="input w-28 text-xs" />
              <input value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="Quantity" className="input w-24 text-xs" />
              <button onClick={createSample} className="btn text-xs" style={{ color: 'var(--color-success)' }}>Create</button>
              <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {view === 'inventory' && inventory ? (
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Alerts */}
            {inventory.alerts.map((a, i) => (
              <div key={i} className={`glass-card p-3 flex items-center gap-2 ${a.severity === 'warning' ? 'border-l-2 border-l-yellow-400' : ''}`}>
                <FiAlertTriangle className="w-4 h-4 text-[var(--color-text-muted)]" /><span className="text-xs">{a.message}</span>
              </div>
            ))}

            <div className="grid grid-cols-4 gap-3">
              <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold">{inventory.total_samples}</div><div className="text-xs text-[var(--color-text-muted)]">Total Samples</div></div>
              <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold text-white">{inventory.by_status.available || 0}</div><div className="text-xs text-[var(--color-text-muted)]">Available</div></div>
              <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold text-white">{inventory.by_status.checked_out || 0}</div><div className="text-xs text-[var(--color-text-muted)]">Checked Out</div></div>
              <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold text-white">{inventory.by_status.depleted || 0}</div><div className="text-xs text-[var(--color-text-muted)]">Depleted</div></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="glass-card p-4">
                <h3 className="text-xs font-medium mb-3">By Type</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(p: any) => `${p.name} (${p.value})`}>
                      {typeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="glass-card p-4">
                <h3 className="text-xs font-medium mb-3">Storage Utilization</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={inventory.storage_utilization}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                    <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                    <Bar dataKey="utilization_pct" fill="var(--color-text)" radius={[2, 2, 0, 0]} name="Utilization %" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            {/* Filters */}
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1 max-w-xs">
                <FiSearch className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search samples..." className="input w-full text-xs pl-8" />
              </div>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input text-xs w-28">
                <option value="">All Types</option>
                {['tissue', 'blood', 'plasma', 'serum', 'dna', 'rna', 'cell_line'].map(t => <option key={t}>{t}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-xs w-28">
                <option value="">All Status</option>
                {['available', 'checked_out', 'depleted', 'reserved'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>

            {selectMode && selectedIds.size > 0 && (
              <BulkActionBar
                count={selectedIds.size}
                allSelected={filtered.length > 0 && filtered.every(s => selectedIds.has(s.id))}
                onSelectAll={() => {
                  const visible = new Set(filtered.map(s => s.id))
                  const allSel = filtered.every(s => selectedIds.has(s.id))
                  setSelectedIds(allSel ? new Set() : visible)
                }}
                onArchive={async () => {
                  const ids = [...selectedIds]
                  try {
                    const res = await api.bulkArchiveBiobankSamples(ids)
                    toast('success', `Archived ${res.updated_count} sample${res.updated_count === 1 ? '' : 's'}`)
                    load()
                    setSelectMode(false); setSelectedIds(new Set())
                  } catch (err: any) {
                    toast('error', err?.message || 'Bulk archive failed', { title: 'Could not archive' })
                  }
                }}
                onRestore={async () => {
                  const ids = [...selectedIds]
                  try {
                    const res = await api.bulkArchiveBiobankSamples(ids, true)
                    toast('success', `Restored ${res.updated_count} sample${res.updated_count === 1 ? '' : 's'}`)
                    load()
                    setSelectMode(false); setSelectedIds(new Set())
                  } catch (err: any) {
                    toast('error', err?.message || 'Bulk restore failed', { title: 'Could not restore' })
                  }
                }}
                onDelete={() => setBulkDeleteConfirm(true)}
              />
            )}

            <div className="flex gap-4">
              {/* Sample table */}
              <div className="flex-1 glass-card overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-[var(--color-border)]">
                    {selectMode && <th className="p-3 w-8"></th>}
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Barcode</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Type</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Status</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Project</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Patient</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]"></th>
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          {samples.length === 0 ? (
                            <EmptyState
                              icon={<FiDatabase />}
                              title="No samples registered yet"
                              description="Register your first biospecimen to track storage, quality, and chain of custody."
                              action={{ label: 'New Sample', onClick: () => setShowAdd(true) }}
                              fullPanel={false}
                            />
                          ) : (
                            <EmptyState
                              icon={<FiDatabase />}
                              title="No samples match the current filters"
                              description="Clear the search or adjust the type / status filters."
                              action={{
                                label: 'Clear filters',
                                onClick: () => { setSearch(''); setTypeFilter(''); setStatusFilter('') },
                              }}
                              fullPanel={false}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                    {filtered.map(s => (
                      <tr
                        key={s.id}
                        onClick={() => {
                          if (selectMode) {
                            setSelectedIds(prev => {
                              const next = new Set(prev)
                              if (next.has(s.id)) next.delete(s.id); else next.add(s.id)
                              return next
                            })
                          } else {
                            setSelected(s)
                          }
                        }}
                        className={`border-b border-[var(--color-border)]/30 cursor-pointer hover:bg-[var(--glass-bg)] ${(!selectMode && selected?.id === s.id) || (selectMode && selectedIds.has(s.id)) ? 'bg-[var(--glass-bg)]' : ''}`}
                      >
                        {selectMode && (
                          <td className="p-3 w-8">
                            {selectedIds.has(s.id)
                              ? <FiCheckSquare className="w-4 h-4 text-[var(--color-text)]" />
                              : <FiSquare className="w-4 h-4 text-[var(--color-text-muted)]" />}
                          </td>
                        )}
                        <td className="p-3 font-mono font-medium">{s.barcode}</td>
                        <td className="p-3">{s.sample_type}</td>
                        <td className="p-3"><span className={`text-xxs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[s.status] || ''}`}>{s.status}</span></td>
                        <td className="p-3 text-[var(--color-text-muted)]">{s.project}</td>
                        <td className="p-3 text-[var(--color-text-muted)]">{s.patient_id}</td>
                        <td className="p-3">
                          <button onClick={e => { e.stopPropagation(); deleteSample(s.id) }} className="p-1 hover:text-[var(--color-error)]"><FiTrash2 className="w-3 h-3" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Detail panel */}
              {selected && (
                <div className="w-72 space-y-3">
                  <div className="glass-card p-4">
                    <h3 className="text-sm font-medium mb-2">{selected.barcode}</h3>
                    <div className="space-y-1 text-xxs">
                      <div><span className="text-[var(--color-text-muted)]">Type:</span> {selected.sample_type}</div>
                      <div><span className="text-[var(--color-text-muted)]">Tissue:</span> {selected.tissue_type}</div>
                      <div><span className="text-[var(--color-text-muted)]">Quantity:</span> {selected.quantity}</div>
                      <div><span className="text-[var(--color-text-muted)]">Quality:</span> {selected.quality_score}</div>
                      <div><span className="text-[var(--color-text-muted)]">Collected:</span> {selected.collection_date}</div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      {selected.status === 'available' && (
                        <button onClick={() => checkout(selected.id)} className="btn text-xxs" style={{ color: 'var(--color-text-secondary)' }}><FiLogOut className="w-3 h-3" /> Checkout</button>
                      )}
                      {selected.status === 'checked_out' && (
                        <button onClick={() => checkin(selected.id)} className="btn text-xxs" style={{ color: 'var(--color-success)' }}><FiLogIn className="w-3 h-3" /> Return</button>
                      )}
                    </div>
                  </div>

                  <div className="glass-card p-4">
                    <h4 className="text-xs font-medium mb-2">Chain of Custody</h4>
                    {selected.chain_of_custody.map((c: any, i: number) => (
                      <div key={i} className="text-xxs py-1 border-l-2 border-[var(--color-border)] pl-2 mb-1">
                        <div className="font-medium">{c.action}</div>
                        <div className="text-[var(--color-text-muted)]">{c.by} — {c.date}</div>
                        {c.notes && <div className="text-[var(--color-text-muted)] italic">{c.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <ConfirmDeleteDialog
        open={deleteConfirmId !== null}
        entityName="Biobank Sample"
        message="This will permanently delete this biobank sample record. This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
      <ConfirmDeleteDialog
        open={bulkDeleteConfirm}
        entityName={`${selectedIds.size} Biobank Sample${selectedIds.size === 1 ? '' : 's'}`}
        message="This will permanently delete the selected biobank sample records. This action cannot be undone."
        onConfirm={async () => {
          const ids = [...selectedIds]
          setBulkDeleteConfirm(false)
          try {
            const res = await api.bulkDeleteBiobankSamples(ids)
            toast('success', `Deleted ${res.deleted_count} sample${res.deleted_count === 1 ? '' : 's'}`)
            load()
            setSelectMode(false); setSelectedIds(new Set())
          } catch (err: any) {
            toast('error', err?.message || 'Bulk delete failed', { title: 'Could not delete' })
          }
        }}
        onCancel={() => setBulkDeleteConfirm(false)}
      />

      {checkoutSampleId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.55)' }}
             onClick={() => setCheckoutSampleId(null)}>
          <div className="glass-card p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium mb-3">Check out sample</h3>
            <p className="text-xxs text-[var(--color-text-muted)] mb-3">
              Attribute this checkout so the chain-of-custody log reflects the
              actual requester and intended use.
            </p>
            <div className="space-y-2">
              <div>
                <label className="text-xxs text-[var(--color-text-muted)]">Researcher</label>
                <input value={checkoutForm.researcher}
                       onChange={e => setCheckoutForm(f => ({ ...f, researcher: e.target.value }))}
                       placeholder="e.g. Dr. Sato"
                       className="input w-full text-xs mt-0.5" autoFocus />
              </div>
              <div>
                <label className="text-xxs text-[var(--color-text-muted)]">Purpose</label>
                <input value={checkoutForm.purpose}
                       onChange={e => setCheckoutForm(f => ({ ...f, purpose: e.target.value }))}
                       placeholder="e.g. Bulk RNA-seq"
                       className="input w-full text-xs mt-0.5" />
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setCheckoutSampleId(null)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
              <button onClick={confirmCheckout} className="btn text-xs" style={{ color: 'var(--color-text-secondary)' }}>Check Out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
