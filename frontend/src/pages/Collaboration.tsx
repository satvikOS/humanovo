import { useState, useEffect } from 'react'
import {
  FiUsers, FiMessageSquare, FiShare2, FiBell, FiShield,
  FiSend, FiCheckCircle,
} from 'react-icons/fi'
import { formatDate, formatDateTime } from '../utils/persistence'

type TabId = 'team' | 'comments' | 'shares' | 'notifications' | 'audit'

interface TeamMember { id: string; name: string; email: string; role: string; avatar_color: string }
interface Comment { id: string; entity_type: string; entity_id: string; content: string; user_name: string; user_color: string; created_at: string }
interface Share { id: string; entity_type: string; entity_name: string; shared_with_name: string; shared_by_name: string; permission: string; created_at: string }
interface Notification { id: string; title: string; message: string; notification_type: string; read: boolean; created_at: string }
interface AuditEntry { id: string; action: string; entity_type: string; user_name: string; details: string; timestamp: string }

const API = '/api/v1/collaboration'

export default function Collaboration() {
  const [tab, setTab] = useState<TabId>('team')
  const [team, setTeam] = useState<TeamMember[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [shares, setShares] = useState<Share[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [newComment, setNewComment] = useState('')
  const [commentEntity, setCommentEntity] = useState('project')

  const loadTab = async (t: TabId) => {
    try {
      if (t === 'team') {
        const res = await fetch(`${API}/team`); if (res.ok) setTeam((await res.json()).members || [])
      } else if (t === 'comments') {
        const res = await fetch(`${API}/comments`); if (res.ok) setComments((await res.json()).items || [])
      } else if (t === 'shares') {
        const res = await fetch(`${API}/shares`); if (res.ok) setShares((await res.json()).items || [])
      } else if (t === 'notifications') {
        const res = await fetch(`${API}/notifications?user_id=user-1`)
        if (res.ok) { const d = await res.json(); setNotifications(d.items || []); setUnread(d.unread || 0) }
      } else if (t === 'audit') {
        const res = await fetch(`${API}/audit-log`); if (res.ok) setAudit((await res.json()).items || [])
      }
    } catch { /* ignore */ }
  }

  useEffect(() => { loadTab(tab) }, [tab])

  const addComment = async () => {
    if (!newComment.trim()) return
    const res = await fetch(`${API}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: commentEntity, entity_id: 'general', content: newComment, user_id: 'user-1' }),
    })
    if (res.ok) { setNewComment(''); loadTab('comments') }
  }

  const markAllRead = async () => {
    await fetch(`${API}/notifications/mark-all-read?user_id=user-1`, { method: 'POST' })
    loadTab('notifications')
  }

  const shareProject = async (userId: string) => {
    await fetch(`${API}/shares`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'project', entity_id: 'demo', entity_name: 'Current Project', shared_with: userId, permission: 'edit', shared_by: 'user-1' }),
    })
    loadTab('shares')
  }

  const tabs = [
    { id: 'team' as TabId, label: 'Team', icon: <FiUsers className="w-3.5 h-3.5" /> },
    { id: 'comments' as TabId, label: 'Comments', icon: <FiMessageSquare className="w-3.5 h-3.5" /> },
    { id: 'shares' as TabId, label: 'Shared', icon: <FiShare2 className="w-3.5 h-3.5" /> },
    { id: 'notifications' as TabId, label: `Notifications${unread > 0 ? ` (${unread})` : ''}`, icon: <FiBell className="w-3.5 h-3.5" /> },
    { id: 'audit' as TabId, label: 'Audit Log', icon: <FiShield className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-semibold tracking-tight">Collaboration</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Team communication, sharing, and audit trails</p>
        <div className="flex gap-1 mt-3">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === t.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Team */}
          {tab === 'team' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {team.map(m => (
                <div key={m.id} className="glass-card p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium" style={{ background: m.avatar_color }}>
                    {m.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xxs text-[var(--color-text-muted)]">{m.email}</div>
                  </div>
                  <span className="text-xxs px-2 py-0.5 rounded-full bg-[var(--glass-bg)] border border-[var(--color-border)]">{m.role}</span>
                  <button onClick={() => shareProject(m.id)} className="btn text-xxs text-[var(--color-text-muted)]"><FiShare2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}

          {/* Comments */}
          {tab === 'comments' && (
            <div className="space-y-4">
              <div className="glass-card p-4">
                <div className="flex gap-2 mb-2">
                  <select value={commentEntity} onChange={e => setCommentEntity(e.target.value)} className="input text-xs w-32">
                    <option value="project">Project</option>
                    <option value="hypothesis">Hypothesis</option>
                    <option value="experiment">Experiment</option>
                  </select>
                  <input value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()}
                    placeholder="Write a comment..." className="input flex-1 text-xs" />
                  <button onClick={addComment} disabled={!newComment.trim()} className="btn text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    <FiSend className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {comments.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-8">No comments yet</p>
              ) : comments.map(c => (
                <div key={c.id} className="glass-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xxs" style={{ background: c.user_color }}>
                      {c.user_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <span className="text-xs font-medium">{c.user_name}</span>
                    <span className="text-xxs text-[var(--color-text-muted)]">{formatDateTime(c.created_at)}</span>
                    <span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)]">{c.entity_type}</span>
                  </div>
                  <p className="text-xs leading-relaxed">{c.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* Shares */}
          {tab === 'shares' && (
            <div className="space-y-2">
              {shares.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-8">No shared items</p>
              ) : shares.map(s => (
                <div key={s.id} className="glass-card p-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">{s.entity_name || s.entity_type}</div>
                    <div className="text-xxs text-[var(--color-text-muted)]">{s.shared_by_name} shared with {s.shared_with_name}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xxs px-2 py-0.5 rounded-full bg-[var(--glass-bg)]">{s.permission}</span>
                    <span className="text-xxs text-[var(--color-text-muted)]">{formatDate(s.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notifications */}
          {tab === 'notifications' && (
            <div className="space-y-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="btn text-xs text-[var(--color-text-muted)] mb-2"><FiCheckCircle className="w-3.5 h-3.5" /> Mark all read</button>
              )}
              {notifications.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-8">No notifications</p>
              ) : notifications.map(n => (
                <div key={n.id} className={`glass-card p-3 ${!n.read ? 'border-l-2 border-l-[var(--color-accent-blue)]' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{n.title}</span>
                    <span className="text-xxs text-[var(--color-text-muted)]">{formatDateTime(n.created_at)}</span>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">{n.message}</p>
                </div>
              ))}
            </div>
          )}

          {/* Audit Log */}
          {tab === 'audit' && (
            <div className="glass-card overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Time</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">User</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Action</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Entity</th>
                    <th className="text-left p-3 text-[var(--color-text-muted)]">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.length === 0 ? (
                    <tr><td colSpan={5} className="p-4 text-center text-[var(--color-text-muted)]">No audit entries</td></tr>
                  ) : audit.map(a => (
                    <tr key={a.id} className="border-b border-[var(--color-border)]/30">
                      <td className="p-3 text-[var(--color-text-muted)]">{formatDateTime(a.timestamp)}</td>
                      <td className="p-3">{a.user_name}</td>
                      <td className="p-3"><span className="px-1.5 py-0.5 rounded bg-[var(--glass-bg)]">{a.action}</span></td>
                      <td className="p-3">{a.entity_type}</td>
                      <td className="p-3 text-[var(--color-text-muted)] truncate max-w-[200px]">{a.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
