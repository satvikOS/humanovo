import { useState, useEffect } from 'react'
import {
  FiClipboard, FiUsers, FiFileText, FiDollarSign,
  FiPlus, FiTrash2,
} from 'react-icons/fi'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

interface Trial {
  id: string; protocol_number: string; title: string; phase: string; status: string
  pi: string; target_enrollment: number; current_enrollment: number; description: string
  arms: any[]; budget: any; start_date: string; estimated_end: string; created_at: string
}
interface Subject { id: string; subject_number: string; display_name: string; age: number; sex: string; arm: string; status: string; enrolled_date: string }
interface Document { id: string; document_type: string; name: string; status: string; version: string; uploaded_by: string }

type ViewTab = 'overview' | 'subjects' | 'visits' | 'documents' | 'budget'
const API = '/api/v1/clinical-trials'
const STATUS_COLORS: Record<string, string> = { planning: 'var(--color-text-muted)', recruiting: 'var(--color-accent-blue)', active: 'var(--color-success)', completed: 'var(--color-accent-purple)', suspended: 'var(--color-error)' }

export default function ClinicalTrials() {
  const [trials, setTrials] = useState<Trial[]>([])
  const [selected, setSelected] = useState<Trial | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [viewTab, setViewTab] = useState<ViewTab>('overview')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ protocol_number: '', title: '', phase: 'Phase I', pi: '', target_enrollment: 0 })
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const load = async () => { try { const r = await fetch(API); if (r.ok) setTrials((await r.json()).items || []) } catch {} }
  useEffect(() => { load() }, [])

  const selectTrial = async (t: Trial) => {
    setSelected(t); setViewTab('overview')
    const [sR, dR] = await Promise.all([fetch(`${API}/${t.id}/subjects`), fetch(`${API}/${t.id}/documents`)])
    if (sR.ok) setSubjects((await sR.json()).items || [])
    if (dR.ok) setDocuments((await dR.json()).items || [])
  }

  const createTrial = async () => {
    if (!form.title.trim()) return
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (r.ok) { load(); setShowAdd(false); setForm({ protocol_number: '', title: '', phase: 'Phase I', pi: '', target_enrollment: 0 }) }
  }

  const deleteTrial = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    await fetch(`${API}/${deleteConfirmId}`, { method: 'DELETE' })
    if (selected?.id === deleteConfirmId) setSelected(null)
    load()
    setDeleteConfirmId(null)
  }

  const enrollPct = selected ? Math.round((selected.current_enrollment / Math.max(selected.target_enrollment, 1)) * 100) : 0

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div><h1 className="text-2xl font-semibold tracking-tight">Clinical Trial Management</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Protocol registry, enrollment, visits, and budgets</p></div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}><FiPlus className="w-4 h-4" /> New Trial</button>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)]">
          <div className="max-w-xl mx-auto space-y-2">
            <div className="flex gap-2">
              <input value={form.protocol_number} onChange={e => setForm(f => ({ ...f, protocol_number: e.target.value }))} placeholder="Protocol # *" className="input text-xs w-40" />
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Trial title *" className="input flex-1 text-xs" />
            </div>
            <div className="flex gap-2">
              <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))} className="input text-xs w-32">
                {['Phase I', 'Phase II', 'Phase III', 'Phase IV'].map(p => <option key={p}>{p}</option>)}
              </select>
              <input value={form.pi} onChange={e => setForm(f => ({ ...f, pi: e.target.value }))} placeholder="Principal Investigator" className="input flex-1 text-xs" />
              <input type="number" value={form.target_enrollment} onChange={e => setForm(f => ({ ...f, target_enrollment: parseInt(e.target.value) || 0 }))} placeholder="Target N" className="input text-xs w-24" />
            </div>
            <div className="flex gap-2">
              <button onClick={createTrial} disabled={!form.title.trim()} className="btn text-xs" style={{ color: 'var(--color-success)' }}>Create</button>
              <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 border-r border-[var(--color-border)] overflow-y-auto p-3 space-y-1">
          {trials.length === 0 ? <p className="text-xs text-[var(--color-text-muted)] text-center py-8">No trials</p> : trials.map(t => (
            <div key={t.id} onClick={() => selectTrial(t)}
              className={`p-3 rounded-lg cursor-pointer group transition-colors ${selected?.id === t.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'hover:bg-[var(--glass-bg)]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate">{t.protocol_number}</span>
                <button onClick={e => { e.stopPropagation(); deleteTrial(t.id) }} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-[var(--color-error)]"><FiTrash2 className="w-3 h-3" /></button>
              </div>
              <div className="text-xxs text-[var(--color-text-muted)] truncate mt-0.5">{t.title}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xxs px-1.5 py-0.5 rounded-full" style={{ color: STATUS_COLORS[t.status] || 'var(--color-text-muted)', background: 'var(--glass-bg)' }}>{t.status}</span>
                <span className="text-xxs text-[var(--color-text-muted)]">{t.phase}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]"><FiClipboard className="w-12 h-12 mx-auto mb-4 opacity-20" /><p className="text-sm">Select a trial</p></div>
          ) : (
            <div className="max-w-4xl mx-auto">
              <h2 className="text-lg font-semibold mb-1">{selected.title}</h2>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">{selected.protocol_number} | {selected.phase} | PI: {selected.pi}</p>

              <div className="flex gap-1 mb-4">
                {([['overview', 'Overview', FiClipboard], ['subjects', 'Subjects', FiUsers], ['documents', 'Documents', FiFileText], ['budget', 'Budget', FiDollarSign]] as [ViewTab, string, any][]).map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setViewTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${viewTab === id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'text-[var(--color-text-muted)]'}`}>
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>

              {viewTab === 'overview' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold" style={{ color: STATUS_COLORS[selected.status] }}>{selected.current_enrollment}</div><div className="text-xs text-[var(--color-text-muted)]">Enrolled / {selected.target_enrollment}</div></div>
                    <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold">{enrollPct}%</div><div className="text-xs text-[var(--color-text-muted)]">Enrollment</div></div>
                    <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold" style={{ color: STATUS_COLORS[selected.status] }}>{selected.status}</div><div className="text-xs text-[var(--color-text-muted)]">Status</div></div>
                  </div>
                  {selected.description && <div className="glass-card p-4"><p className="text-xs leading-relaxed">{selected.description}</p></div>}
                  {selected.arms && selected.arms.length > 0 && (
                    <div className="glass-card p-4">
                      <h3 className="text-xs font-medium mb-2">Study Arms</h3>
                      {selected.arms.map((arm: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1.5 text-xs border-b border-[var(--color-border)]/30 last:border-0">
                          <span className="font-medium">{arm.name}</span><span className="text-[var(--color-text-muted)]">{arm.description} (n={arm.target_n})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {viewTab === 'subjects' && (
                <div className="glass-card overflow-hidden">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-[var(--color-border)]">
                      <th className="text-left p-3 text-[var(--color-text-muted)]">ID</th><th className="text-left p-3 text-[var(--color-text-muted)]">Age</th>
                      <th className="text-left p-3 text-[var(--color-text-muted)]">Sex</th><th className="text-left p-3 text-[var(--color-text-muted)]">Arm</th>
                      <th className="text-left p-3 text-[var(--color-text-muted)]">Status</th><th className="text-left p-3 text-[var(--color-text-muted)]">Enrolled</th>
                    </tr></thead>
                    <tbody>
                      {subjects.map(s => (
                        <tr key={s.id} className="border-b border-[var(--color-border)]/30">
                          <td className="p-3 font-mono">{s.subject_number}</td><td className="p-3">{s.age}</td><td className="p-3">{s.sex}</td>
                          <td className="p-3">{s.arm}</td>
                          <td className="p-3"><span className={`px-1.5 py-0.5 rounded-full text-xxs ${s.status === 'active' ? 'bg-green-500/10 text-green-400' : s.status === 'withdrawn' ? 'bg-red-500/10 text-red-400' : 'bg-[var(--glass-bg)]'}`}>{s.status}</span></td>
                          <td className="p-3 text-[var(--color-text-muted)]">{s.enrolled_date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewTab === 'documents' && (
                <div className="space-y-2">
                  {documents.map(d => (
                    <div key={d.id} className="glass-card p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FiFileText className="w-4 h-4 text-[var(--color-text-muted)]" />
                        <div><div className="text-xs font-medium">{d.name}</div><div className="text-xxs text-[var(--color-text-muted)]">{d.document_type} | v{d.version}</div></div>
                      </div>
                      <span className={`text-xxs px-2 py-0.5 rounded-full ${d.status === 'approved' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>{d.status}</span>
                    </div>
                  ))}
                </div>
              )}

              {viewTab === 'budget' && selected.budget && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold" style={{ color: 'var(--color-accent-blue)' }}>${(selected.budget.total / 1000000).toFixed(1)}M</div><div className="text-xs text-[var(--color-text-muted)]">Total Budget</div></div>
                    <div className="glass-card p-4 text-center"><div className="text-2xl font-semibold" style={{ color: 'var(--color-accent-purple)' }}>${(selected.budget.spent / 1000000).toFixed(1)}M</div><div className="text-xs text-[var(--color-text-muted)]">Spent ({Math.round(selected.budget.spent / selected.budget.total * 100)}%)</div></div>
                  </div>
                  {selected.budget.categories && (
                    <div className="glass-card p-4">
                      <h3 className="text-xs font-medium mb-3">Budget by Category</h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={selected.budget.categories}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                          <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                          <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                          <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                          <Bar dataKey="budgeted" fill="var(--color-accent-blue)" radius={[2, 2, 0, 0]} name="Budgeted" />
                          <Bar dataKey="spent" fill="var(--color-accent-purple)" radius={[2, 2, 0, 0]} name="Spent" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDeleteDialog
        open={deleteConfirmId !== null}
        entityName="Clinical Trial"
        message="This will permanently delete this clinical trial record. This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
