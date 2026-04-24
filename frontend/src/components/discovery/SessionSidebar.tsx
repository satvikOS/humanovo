// SessionSidebar — left-rail of past Discovery conversations.
//
// Shows pinned sessions first, then recent-activity order. Each row
// is clickable to load the session; hover reveals rename / pin /
// delete actions. Top-of-list "+ New conversation" button triggers
// session creation via the parent.
//
// Search + filter controls at the top are wired to the list endpoint
// so large session lists stay responsive.
import { useState, useMemo } from 'react'
import { FiPlus, FiSearch, FiStar, FiTrash2, FiEdit2, FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import type { DiscoverySessionSummary } from '../../services/api'

interface SessionSidebarProps {
  sessions: DiscoverySessionSummary[]
  currentId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onSearch: (q: string) => void
  onToggleCollapsed?: (collapsed: boolean) => void
  collapsed?: boolean
}

export default function SessionSidebar({
  sessions, currentId, onSelect, onNew, onDelete, onRename,
  onTogglePin, onSearch, onToggleCollapsed, collapsed = false,
}: SessionSidebarProps) {
  const [q, setQ] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // Sort: pinned first, then updated_at desc. Backend already returns
  // in this order but re-applying here lets us keep the sidebar
  // stable when pin/unpin actions arrive locally before the refetch.
  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
  }, [sessions])

  if (collapsed) {
    return (
      <div className="flex flex-col h-full border-r border-[var(--color-border)] w-10 bg-[var(--color-surface-solid)]">
        <button
          onClick={() => onToggleCollapsed?.(false)}
          className="p-2 hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          aria-label="Expand sidebar"
          title="Expand conversation list"
        >
          <FiChevronRight className="w-4 h-4 mx-auto" />
        </button>
        <button
          onClick={onNew}
          className="p-2 hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          aria-label="New conversation"
          title="New conversation"
        >
          <FiPlus className="w-4 h-4 mx-auto" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full border-r border-[var(--color-border)] w-72 flex-shrink-0 bg-[var(--color-surface-solid)]">
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xxs uppercase tracking-wider font-semibold text-[var(--color-text-muted)]">Discovery sessions</span>
          <button
            onClick={() => onToggleCollapsed?.(true)}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]"
            aria-label="Collapse sidebar"
            title="Collapse"
          >
            <FiChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-[var(--glass-border)] text-sm text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--glass-bg)] transition-colors"
        >
          <FiPlus className="w-3.5 h-3.5" /> New conversation
        </button>
        <div className="relative mt-2">
          <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); onSearch(e.target.value) }}
            placeholder="Search sessions…"
            aria-label="Search discovery sessions"
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {sorted.length === 0 && (
          <div className="text-xxs text-center text-[var(--color-text-muted)] py-8 px-3">
            No conversations yet. Start one with a question like <br /><em>"What genes regulate anti-viral innate immunity?"</em>
          </div>
        )}
        {sorted.map(session => {
          const active = session.id === currentId
          const isRenaming = renamingId === session.id
          return (
            <div
              key={session.id}
              onClick={() => !isRenaming && onSelect(session.id)}
              className={`group relative px-2 py-2 rounded-md cursor-pointer border transition-colors ${
                active
                  ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg)]'
                  : 'border-transparent hover:border-[var(--glass-border)] hover:bg-[var(--glass-bg)]'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                {session.pinned && (
                  <FiStar className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={e => setRenameDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && renameDraft.trim()) { onRename(session.id, renameDraft.trim()); setRenamingId(null) }
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={() => {
                        if (renameDraft.trim() && renameDraft.trim() !== session.title) onRename(session.id, renameDraft.trim())
                        setRenamingId(null)
                      }}
                      onClick={e => e.stopPropagation()}
                      className="w-full px-1 py-0.5 text-xs rounded bg-[var(--color-surface-raised)] border border-[var(--color-border-strong)] text-[var(--color-text)]"
                      aria-label="Rename session"
                    />
                  ) : (
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {session.title}
                    </div>
                  )}
                  {session.preview && !isRenaming && (
                    <div className="text-xxs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {session.preview}
                    </div>
                  )}
                  <div className="text-xxs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {session.message_count} msg · {new Date(session.updated_at).toLocaleDateString()}
                  </div>
                </div>
                {!isRenaming && (
                  <div className="flex-shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); onTogglePin(session.id, !session.pinned) }}
                      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]"
                      title={session.pinned ? 'Unpin' : 'Pin'}
                      aria-label={session.pinned ? 'Unpin session' : 'Pin session'}
                    >
                      <FiStar className={`w-3 h-3 ${session.pinned ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setRenameDraft(session.title); setRenamingId(session.id) }}
                      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]"
                      title="Rename"
                      aria-label="Rename session"
                    >
                      <FiEdit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onDelete(session.id) }}
                      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]"
                      title="Delete"
                      aria-label="Delete session"
                    >
                      <FiTrash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
