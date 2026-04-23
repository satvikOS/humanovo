// LibraryTable — Mendeley-style dense table of citations.
//
// Columns: star · read · type · title · authors · journal · year · added.
// Multi-select via checkbox + shift-click range + ⌘/Ctrl-click toggle.
// Click a row to open the detail panel (parent-controlled).
import { useState, useCallback } from 'react'
import { FiStar, FiCircle, FiCheckCircle, FiBookmark } from 'react-icons/fi'
import type { LibraryCitation } from '../../services/api'

interface LibraryTableProps {
  citations: LibraryCitation[]
  selectedIds: Set<string>
  focusedId: string | null
  onFocus: (id: string) => void
  onSelectionChange: (ids: Set<string>) => void
  onToggleStar: (id: string, starred: boolean) => void
  onToggleRead: (id: string, read: boolean) => void
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}

export type SortKey = 'title' | 'authors' | 'journal' | 'year' | 'updated'

const typeBadge = (t: string): string => {
  switch (t) {
    case 'journal':    return 'JRN'
    case 'conference': return 'CONF'
    case 'book':       return 'BOOK'
    case 'preprint':   return 'PRE'
    case 'thesis':     return 'THES'
    case 'website':    return 'WEB'
    default:           return t.toUpperCase().slice(0, 4)
  }
}

export default function LibraryTable({
  citations, selectedIds, focusedId, onFocus, onSelectionChange,
  onToggleStar, onToggleRead, sortKey, sortDir, onSort,
}: LibraryTableProps) {
  // Track last-clicked index for shift-click ranges. Using a ref via
  // state keeps the table pure + survives re-renders.
  const [lastIndex, setLastIndex] = useState<number | null>(null)

  const handleRowClick = useCallback((e: React.MouseEvent, idx: number) => {
    const cit = citations[idx]
    if (!cit) return
    if (e.shiftKey && lastIndex !== null) {
      // Range select.
      const [a, b] = idx < lastIndex ? [idx, lastIndex] : [lastIndex, idx]
      const next = new Set(selectedIds)
      for (let i = a; i <= b; i++) next.add(citations[i].id)
      onSelectionChange(next)
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle.
      const next = new Set(selectedIds)
      if (next.has(cit.id)) next.delete(cit.id); else next.add(cit.id)
      onSelectionChange(next)
      setLastIndex(idx)
    } else {
      onFocus(cit.id)
      setLastIndex(idx)
    }
  }, [citations, selectedIds, lastIndex, onFocus, onSelectionChange])

  const sortArrow = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''

  return (
    <div className="w-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-[var(--color-surface-solid)] border-b border-[var(--color-border)]">
          <tr className="text-left text-[var(--color-text-muted)]">
            <th className="w-6 pl-2">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={citations.length > 0 && selectedIds.size === citations.length}
                onChange={e => onSelectionChange(e.target.checked ? new Set(citations.map(c => c.id)) : new Set())}
              />
            </th>
            <th className="w-6" />  {/* star */}
            <th className="w-6" />  {/* read */}
            <th className="w-12 pr-2 font-medium uppercase tracking-wider text-xxs">Type</th>
            <th className="font-medium uppercase tracking-wider text-xxs cursor-pointer select-none" onClick={() => onSort('title')}>Title {sortArrow('title')}</th>
            <th className="font-medium uppercase tracking-wider text-xxs cursor-pointer select-none w-48" onClick={() => onSort('authors')}>Authors {sortArrow('authors')}</th>
            <th className="font-medium uppercase tracking-wider text-xxs cursor-pointer select-none w-40" onClick={() => onSort('journal')}>Journal {sortArrow('journal')}</th>
            <th className="font-medium uppercase tracking-wider text-xxs cursor-pointer select-none w-14" onClick={() => onSort('year')}>Year {sortArrow('year')}</th>
            <th className="font-medium uppercase tracking-wider text-xxs cursor-pointer select-none w-24" onClick={() => onSort('updated')}>Added {sortArrow('updated')}</th>
          </tr>
        </thead>
        <tbody>
          {citations.map((c, idx) => {
            const isSelected = selectedIds.has(c.id)
            const isFocused = focusedId === c.id
            return (
              <tr
                key={c.id}
                onClick={e => handleRowClick(e, idx)}
                className={`cursor-pointer transition-colors border-b border-[var(--color-border)] ${
                  isFocused ? 'bg-[var(--glass-bg)]' : isSelected ? 'bg-[var(--color-surface-raised)]' : 'hover:bg-[var(--glass-bg)]'
                }`}
                aria-selected={isSelected}
              >
                <td className="pl-2 py-1.5" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${c.title}`}
                    checked={isSelected}
                    onChange={e => {
                      const next = new Set(selectedIds)
                      if (e.target.checked) next.add(c.id); else next.delete(c.id)
                      onSelectionChange(next)
                    }}
                  />
                </td>
                <td onClick={e => { e.stopPropagation(); onToggleStar(c.id, !c.starred) }}>
                  <FiStar
                    className={`w-3.5 h-3.5 ${c.starred ? 'text-[var(--color-accent,#C4956A)] fill-current' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                    aria-label={c.starred ? 'Starred' : 'Star'}
                  />
                </td>
                <td onClick={e => { e.stopPropagation(); onToggleRead(c.id, !c.read) }}>
                  {c.read
                    ? <FiCheckCircle className="w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-label="Read" />
                    : <FiCircle className="w-3.5 h-3.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Mark read" />}
                </td>
                <td className="pr-2 text-xxs font-mono text-[var(--color-text-muted)]">{typeBadge(c.type)}</td>
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {c.pdf_url && <FiBookmark className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0" aria-label="Has PDF" />}
                    <span className="truncate font-medium" style={{ color: 'var(--color-text)' }}>{c.title || '(untitled)'}</span>
                  </div>
                  {c.tags.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map(t => (
                        <span key={t} className="text-xxs px-1 py-0 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]">{t}</span>
                      ))}
                      {c.tags.length > 3 && <span className="text-xxs text-[var(--color-text-muted)]">+{c.tags.length - 3}</span>}
                    </div>
                  )}
                </td>
                <td className="pr-3 truncate text-[var(--color-text-muted)]">{(c.authors || []).slice(0, 2).join(', ')}{c.authors && c.authors.length > 2 ? ' et al.' : ''}</td>
                <td className="pr-3 truncate italic text-[var(--color-text-muted)]">{c.journal || ''}</td>
                <td className="pr-3 tabular-nums text-[var(--color-text-muted)]">{c.year ?? ''}</td>
                <td className="pr-3 tabular-nums text-[var(--color-text-muted)]">{new Date(c.updated_at).toLocaleDateString()}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {citations.length === 0 && (
        <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
          No citations match the current filter. Try clearing search or switching folders.
        </div>
      )}
    </div>
  )
}
