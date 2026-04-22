/**
 * EmptyState — consistent zero-data UX across the app.
 *
 * Replaces ad-hoc inline "No foo found" blocks with a single component
 * that always renders an icon + heading + one-line explanation + primary
 * CTA. Unifies the empty-state look so users recognize "nothing here yet"
 * patterns wherever they appear.
 */

import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  /** Short heading. "No evidence yet", "Start a project", etc. */
  title: string
  /** One-line explanation. Why is it empty, what will populate it. */
  description?: string
  /** Primary CTA. */
  action?: { label: string; onClick: () => void; ariaLabel?: string }
  /** Secondary action (learn more / import sample data / etc). */
  secondary?: { label: string; onClick: () => void; ariaLabel?: string }
  /** If true, renders as a full-panel state; otherwise inline. */
  fullPanel?: boolean
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  fullPanel = true,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        'flex flex-col items-center justify-center gap-2 text-center ' +
        (fullPanel ? 'h-full min-h-[320px] p-8' : 'py-10 px-4')
      }
    >
      {icon && (
        <div className="text-3xl mb-1" style={{ opacity: 0.6 }} aria-hidden>
          {icon}
        </div>
      )}
      <div
        className="text-sm font-medium"
        style={{ color: 'var(--color-text)' }}
      >
        {title}
      </div>
      {description && (
        <div
          className="text-xxs max-w-sm"
          style={{ color: 'var(--color-text-muted, #9ca3af)' }}
        >
          {description}
        </div>
      )}
      {(action || secondary) && (
        <div className="flex items-center gap-2 mt-3">
          {action && (
            <button
              type="button"
              aria-label={action.ariaLabel ?? action.label}
              onClick={action.onClick}
              className="btn btn-sm btn-primary"
            >
              {action.label}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              aria-label={secondary.ariaLabel ?? secondary.label}
              onClick={secondary.onClick}
              className="btn btn-sm btn-secondary"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
