import { useState, useEffect } from 'react'
import { FiSearch, FiPlus, FiTrash2, FiAlertTriangle, FiLogOut, FiLogIn } from 'react-icons/fi'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

interface Sample {
  id: string; barcode: string; sample_type: string; status: string; project: string
  tissue_type: string; patient_id: string; collection_date: string; quantity: string
  quality_score: number; chain_of_custody: any[]; storage_details: any
}
interface Inventory { total_samples: number; by_type: Record<string, number>; by_status: Record<string, number>; by_project: Record<string, number>; alerts: any[]; storage_utilization: any[] }

const API = '/api/v1/biobank'
const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#06b6d4', '#ef4444']
const STATUS_COLORS: Record<string, string> = { available: 'text-green-400 bg-green-500/10', checked_out: 'text-yellow-400 bg-yellow-500/10', depleted: 'text-red-400 bg-red-500/10', reserved: 'text-blue-400 bg-blue-500/10' }

export default function BiobankManager() {
  const [samples, setSamples] = useState<Sample[]>([])
  const [selected, setSelected] = useState<Sample | null>(null)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [view, setView] = useState<'list' | 'inventory'>('list')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ barcode: '', sample_type: 'tissue', tissue_type: '', project: '', patient_id: '', quantity: '' })
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const load = async () => {
    try { const r = await fetch(`${API}/samples`); if (r.ok) setSamples((await r.json()).items || []) } catch {}
    try { const r = await fetch(`${API}/inventory`); if (r.ok) setInventory(await r.json()) } catch {}
  }
  useEffect(() => { load() }, [])

  const createSample = async () => {
    const r = await fetch(`${API}/samples`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (r.ok) { load(); setShowAdd(false); setForm({ barcode: '', sample_type: 'tissue', tissue_type: '', project: '', patient_id: '', quantity: '' }) }
  }

  const deleteSample = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    await fetch(`${API}/samples/${deleteConfirmId}`, { method: 'DELETE' })
    if (selected?.id === deleteConfirmId) setSelected(null); load()
    setDeleteConfirmId(null)
  }

  const checkout = async (id: string) => {
    const r = await fetch(`${API}/samples/${id}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ researcher: 'Current Researcher', purpose: 'Analysis' }) })
    if (r.ok) { const s = await r.json(); setSelected(s); load() }
  }

  const checkin = async (id: string) => {
    const r = await fetch(`${API}/samples/${id}/checkin?condition=good`, { method: 'POST' })
    if (r.ok) { const s = await r.json(); setSelected(s); load() }
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
            <button onClick={() => setView(view === 'list' ? 'inventory' : 'list')} className="btn text-xs text-[var(--color-text-muted)]">{view === 'list' ? 'Inventory' : 'Sample List'}</button>
            <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}><FiPlus className="w-4 h-4" /> New Sample</button>
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
                <FiAlertTriangle className="w-4 h-4 text-yellow-400" /><span className="text-xs">{a.message}</span>
              </div>
            ))}

            <div className="grid grid-cols-4 gap-3">
              <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold">{inventory.total_samples}</div><div className="text-xs text-[var(--color-text-muted)]">Total Samples</div></div>
              <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold text-green-400">{inventory.by_status.available || 0}</div><div className="text-xs text-[var(--color-text-muted)]">Available</div></div>
              <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold text-yellow-400">{inventory.by_status.checked_out || 0}</div><div className="text-xs text-[var(--color-text-muted)]">Checked Out</div></div>
              <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold text-red-400">{inventory.by_status.depleted || 0}</div><div className="text-xs text-[var(--color-text-muted)]">Depleted</div></div>
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
                    <Bar dataKey="utilization_pct" fill="var(--color-accent-blue)" radius={[2, 2, 0, 0]} name="Utilization %" />
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

            <div className="flex gap-4">
              {/* Sample table */}
              <div className="flex-1 glass-card overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-[var(--color-border)]">
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Barcode</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Type</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Status</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Project</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Patient</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]"></th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(s => (
                      <tr key={s.id} onClick={() => setSelected(s)} className={`border-b border-[var(--color-border)]/30 cursor-pointer hover:bg-[var(--glass-bg)] ${selected?.id === s.id ? 'bg-[var(--glass-bg)]' : ''}`}>
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
                        <button onClick={() => checkout(selected.id)} className="btn text-xxs" style={{ color: 'var(--color-accent-blue)' }}><FiLogOut className="w-3 h-3" /> Checkout</button>
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
    </div>
  )
}
