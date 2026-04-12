import { useState, useEffect } from 'react'
import { FiShield, FiFileText, FiCheckSquare, FiInbox } from 'react-icons/fi'

type TabId = 'irb' | 'agreements' | 'consent' | 'checklists'

interface IRBSubmission { id: string; protocol_title: string; irb_number: string; status: string; submission_date: string; approval_date: string | null; pi: string; risk_level: string; review_type?: string; history: any[] }
interface Agreement { id: string; title: string; agreement_type: string; status: string; party: string; data_types: string[]; start_date: string; end_date: string }
interface ConsentForm { id: string; title: string; version: string; status: string; language: string; irb_approved: boolean; versions: any[] }
interface Checklist { id: string; framework: string; items: { name: string; completed: boolean; notes: string }[]; completion_pct: number; last_reviewed: string }

const API = '/api/v1/regulatory'

export default function RegulatoryCompliance() {
  const [tab, setTab] = useState<TabId>('irb')
  const [irbs, setIrbs] = useState<IRBSubmission[]>([])
  const [agreements, setAgreements] = useState<Agreement[]>([])
  const [consents, setConsents] = useState<ConsentForm[]>([])
  const [checklists, setChecklists] = useState<Checklist[]>([])
  const [selectedIrb, setSelectedIrb] = useState<IRBSubmission | null>(null)

  const loadTab = async (t: TabId) => {
    try {
      if (t === 'irb') { const r = await fetch(`${API}/irb-submissions`); if (r.ok) setIrbs((await r.json()).items || []) }
      else if (t === 'agreements') { const r = await fetch(`${API}/agreements`); if (r.ok) setAgreements((await r.json()).items || []) }
      else if (t === 'consent') { const r = await fetch(`${API}/consent-forms`); if (r.ok) setConsents((await r.json()).items || []) }
      else if (t === 'checklists') { const r = await fetch(`${API}/checklists`); if (r.ok) setChecklists((await r.json()).items || []) }
    } catch { /* network error — keep stale state */ }
  }
  useEffect(() => { loadTab(tab) }, [tab])

  const toggleCheckItem = async (cl: Checklist, idx: number) => {
    const items = cl.items.map((item, i) => i === idx ? { ...item, completed: !item.completed } : item)
    const r = await fetch(`${API}/checklists/${cl.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
    if (r.ok) loadTab('checklists')
  }

  const tabs = [
    { id: 'irb' as TabId, label: 'IRB Submissions', icon: <FiFileText className="w-3.5 h-3.5" /> },
    { id: 'agreements' as TabId, label: 'Agreements', icon: <FiShield className="w-3.5 h-3.5" /> },
    { id: 'consent' as TabId, label: 'Consent Forms', icon: <FiFileText className="w-3.5 h-3.5" /> },
    { id: 'checklists' as TabId, label: 'Compliance', icon: <FiCheckSquare className="w-3.5 h-3.5" /> },
  ]

  const statusColor = (s: string) => s === 'approved' || s === 'active' ? 'text-[var(--color-text-secondary)] bg-[var(--glass-bg)]' : s === 'pending' || s === 'draft' ? 'text-[var(--color-text-muted)] bg-[var(--glass-bg)]' : 'text-[var(--color-text-muted)] bg-[var(--glass-bg)]'

  const EmptyState = ({ title, hint }: { title: string; hint: string }) => (
    <div className="glass-card p-10 text-center">
      <FiInbox className="mx-auto mb-3 w-8 h-8 text-[var(--color-text-muted)]" />
      <div className="text-sm font-medium mb-1">{title}</div>
      <div className="text-xxs text-[var(--color-text-muted)]">{hint}</div>
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-semibold tracking-tight">Regulatory & Compliance</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">IRB submissions, agreements, consent forms, and compliance checklists</p>
        <div className="flex gap-1 mt-3">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === t.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'text-[var(--color-text-muted)]'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* IRB */}
          {tab === 'irb' && (
            <div className="space-y-3">
              {irbs.length === 0 && <EmptyState title="No IRB submissions yet" hint="IRB protocols you submit will appear here with approval status and review history." />}
              {irbs.map(irb => (
                <div key={irb.id} className="glass-card p-4 cursor-pointer" onClick={() => setSelectedIrb(selectedIrb?.id === irb.id ? null : irb)}>
                  <div className="flex items-center justify-between">
                    <div><div className="text-sm font-medium">{irb.protocol_title}</div><div className="text-xxs text-[var(--color-text-muted)]">{irb.irb_number} | PI: {irb.pi}</div></div>
                    <span className={`text-xxs px-2 py-0.5 rounded-full ${statusColor(irb.status)}`}>{irb.status}</span>
                  </div>
                  {selectedIrb?.id === irb.id && (
                    <div className="mt-3 pt-3 border-t border-[var(--color-border)]/30">
                      <div className="grid grid-cols-3 gap-3 text-xxs mb-3">
                        <div><span className="text-[var(--color-text-muted)]">Submitted:</span> {irb.submission_date}</div>
                        <div><span className="text-[var(--color-text-muted)]">Risk Level:</span> {irb.risk_level}</div>
                        <div><span className="text-[var(--color-text-muted)]">Review:</span> {irb.review_type || 'N/A'}</div>
                      </div>
                      {irb.history && (
                        <div className="space-y-1">
                          <p className="text-xxs font-medium text-[var(--color-text-muted)]">History</p>
                          {irb.history.map((h: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-xxs py-1 border-l-2 border-[var(--color-border)] pl-3">
                              <span className="text-[var(--color-text-muted)]">{h.date}</span>
                              <span className="font-medium">{h.action}</span>
                              <span className="text-[var(--color-text-muted)]">{h.notes}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Agreements */}
          {tab === 'agreements' && (
            <div className="space-y-3">
              {agreements.length === 0 && <EmptyState title="No agreements on file" hint="DUAs, MTAs, and data-use agreements you track will appear here." />}
              {agreements.map(a => (
                <div key={a.id} className="glass-card p-4">
                  <div className="flex items-center justify-between">
                    <div><div className="text-sm font-medium">{a.title}</div><div className="text-xxs text-[var(--color-text-muted)]">{a.agreement_type} | {a.party}</div></div>
                    <span className={`text-xxs px-2 py-0.5 rounded-full ${statusColor(a.status)}`}>{a.status}</span>
                  </div>
                  <div className="flex gap-3 mt-2 text-xxs text-[var(--color-text-muted)]">
                    <span>Period: {a.start_date} — {a.end_date}</span>
                    <span>Data: {a.data_types.join(', ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Consent Forms */}
          {tab === 'consent' && (
            <div className="space-y-3">
              {consents.length === 0 && <EmptyState title="No consent forms yet" hint="Versioned informed-consent documents and translations live here once uploaded." />}
              {consents.map(c => (
                <div key={c.id} className="glass-card p-4">
                  <div className="flex items-center justify-between">
                    <div><div className="text-sm font-medium">{c.title}</div><div className="text-xxs text-[var(--color-text-muted)]">v{c.version} | {c.language}</div></div>
                    <div className="flex items-center gap-2">
                      {c.irb_approved && <span className="text-xxs px-2 py-0.5 rounded-full bg-[var(--glass-bg)] text-[var(--color-text-secondary)]">IRB Approved</span>}
                      <span className={`text-xxs px-2 py-0.5 rounded-full ${statusColor(c.status)}`}>{c.status}</span>
                    </div>
                  </div>
                  {c.versions && (
                    <div className="mt-2 space-y-0.5">
                      {c.versions.map((v: any, i: number) => (
                        <div key={i} className="text-xxs text-[var(--color-text-muted)]">v{v.version} ({v.date}): {v.changes}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Checklists */}
          {tab === 'checklists' && (
            <div className="space-y-4">
              {checklists.length === 0 && <EmptyState title="No compliance checklists" hint="Track HIPAA, 21 CFR Part 11, GDPR, and custom frameworks from here." />}
              {checklists.map(cl => (
                <div key={cl.id} className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium">{cl.framework} Compliance</h3>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 rounded-full bg-[var(--glass-bg)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${cl.completion_pct}%`, background: cl.completion_pct === 100 ? 'var(--color-success)' : 'var(--color-text)' }} />
                      </div>
                      <span className="text-xxs text-[var(--color-text-muted)]">{cl.completion_pct}%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {cl.items.map((item, i) => (
                      <label key={i} className="flex items-center gap-2 py-1 text-xs cursor-pointer hover:bg-[var(--glass-bg)] rounded px-1">
                        <input type="checkbox" checked={item.completed} onChange={() => toggleCheckItem(cl, i)} className="rounded" />
                        <span className={item.completed ? 'line-through text-[var(--color-text-muted)]' : ''}>{item.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
