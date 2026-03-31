/**
 * Reusable "Are you sure?" confirmation dialog for destructive actions.
 */
import { FiAlertTriangle } from 'react-icons/fi'

interface ConfirmDeleteDialogProps {
  /** Dialog title — e.g. "Delete Project?" */
  title?: string
  /** Entity name — used to auto-generate title if title is not provided */
  entityName?: string
  /** Explanation of what will happen */
  message: string
  /** Called when user confirms deletion */
  onConfirm: () => void
  /** Called when user cancels */
  onCancel: () => void
  /** Label for the confirm button */
  confirmLabel?: string
  /** If false, dialog is hidden (allows conditional rendering via prop) */
  open?: boolean
}

export default function ConfirmDeleteDialog({
  title,
  entityName,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete Permanently',
  open = true,
}: ConfirmDeleteDialogProps) {
  if (!open) return null

  const heading = title || (entityName ? `Delete ${entityName}?` : 'Delete?')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="glass-card p-6 max-w-sm mx-4 text-center" onClick={e => e.stopPropagation()}>
        <div className="inline-flex p-3 rounded-xl bg-red-500/10 mb-4">
          <FiAlertTriangle className="w-6 h-6 text-red-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{heading}</h3>
        <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed">
          {message}
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={onCancel} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
            Cancel
          </button>
          <button onClick={onConfirm} className="btn px-4 py-2 text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 font-medium">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
