/**
 * Shared bulk-action bar used by every list surface (Projects,
 * ClinicalTrials, Manuscripts, Biobank, Regulatory...). One visual
 * vocabulary across the app: "Select" toggle in the header flips into
 * a floating bar with Select-all / Archive / Restore / Delete.
 */
import type { ReactNode } from 'react'
import { FiArchive, FiTrash2 } from 'react-icons/fi'

interface BulkActionBarProps {
  count: number
  allSelected: boolean
  onSelectAll: () => void
  onArchive?: () => void   // omit to hide archive button
  onRestore?: () => void   // omit to hide restore button
  onDelete: () => void
  extra?: ReactNode         // render additional buttons
  className?: string
}

export function BulkActionBar({
  count, allSelected, onSelectAll, onArchive, onRestore, onDelete, extra, className,
}: BulkActionBarProps) {
  if (count === 0) return null
  return (
    <div
      className={
        'mb-4 p-3 rounded-lg border border-[var(--color-border-strong)] flex items-center justify-between gap-3 flex-wrap bg-[var(--glass-bg)] ' +
        (className || '')
      }
    >
      <div className="text-sm text-[var(--color-text)]">
        {count} item{count === 1 ? '' : 's'} selected
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onSelectAll}
          className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          {allSelected ? 'Clear selection' : 'Select all visible'}
        </button>
        {onArchive && (
          <button
            onClick={onArchive}
            className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors flex items-center gap-1.5"
          >
            <FiArchive className="w-3 h-3" /> Archive
          </button>
        )}
        {onRestore && (
          <button
            onClick={onRestore}
            className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Restore
          </button>
        )}
        {extra}
        <button
          onClick={onDelete}
          className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-400/90 hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1.5"
        >
          <FiTrash2 className="w-3 h-3" /> Delete
        </button>
      </div>
    </div>
  )
}
