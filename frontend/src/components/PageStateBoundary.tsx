/**
 * PageStateBoundary — standard loading / error / empty / content
 * sequencing for any page that fetches its own data.
 *
 * Drop-in pattern:
 *
 *     <PageStateBoundary
 *       loading={isLoading}
 *       error={error}
 *       empty={items.length === 0}
 *       loadingLabel="Loading datasets…"
 *       emptyTitle="No datasets yet"
 *       emptyDescription="Drop a CSV / TSV here, or wire up a data source from Settings."
 *       onRetry={refetch}
 *     >
 *       <Table rows={items} />
 *     </PageStateBoundary>
 *
 * Why a wrapper instead of letting each page roll its own:
 *   - 50ms grace before the loading skeleton paints, so fast responses
 *     don't flash a spinner. Each page rolling its own forgets this.
 *   - Consistent error UX with a Retry CTA — without this every page
 *     reinvents the error card differently.
 *   - Empty / loaded / error are mutually exclusive — the wrapper
 *     enforces ordering so you can't accidentally render both.
 *
 * The empty-state path defers to the shared `EmptyState` component for
 * visual consistency. Pass either an `emptyTitle` (and optional
 * description / action) for the standard look, or a fully-custom
 * `emptySlot` ReactNode if the page needs something bespoke.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { EmptyState } from './EmptyState'

interface BaseProps {
  loading: boolean
  error?: string | Error | null
  empty?: boolean
  /** Body shown when none of loading/error/empty apply. */
  children: ReactNode
  /** Override the default 50ms grace before showing the spinner. */
  graceMs?: number
  /** "Loading datasets…" — defaults to a generic 'Loading…'. */
  loadingLabel?: string
  /** Click handler for the Retry button on the error card. */
  onRetry?: () => void
}

interface StandardEmptyProps {
  /** "No datasets yet". Required when `emptySlot` not provided. */
  emptyTitle: string
  emptyDescription?: string
  emptyAction?: { label: string; onClick: () => void }
  emptySlot?: never
}

interface CustomEmptyProps {
  /** Render whatever you want for the empty state — bypasses
   *  EmptyState entirely. Useful for pages that need illustrations
   *  beyond the standard icon + heading. */
  emptySlot: ReactNode
  emptyTitle?: never
  emptyDescription?: never
  emptyAction?: never
}

type PageStateBoundaryProps = BaseProps & (StandardEmptyProps | CustomEmptyProps | {
  emptyTitle?: never
  emptySlot?: never
  emptyDescription?: never
  emptyAction?: never
})


export default function PageStateBoundary(props: PageStateBoundaryProps) {
  const {
    loading,
    error,
    empty,
    children,
    graceMs = 50,
    loadingLabel = 'Loading…',
    onRetry,
  } = props

  // 50ms grace so a fast response doesn't flash the spinner. Trigger
  // the timer once `loading` flips to true; cancel + reset when it
  // flips back, so a re-fetch doesn't show the spinner instantly
  // either.
  const [showLoadingUI, setShowLoadingUI] = useState(false)
  useEffect(() => {
    if (!loading) {
      setShowLoadingUI(false)
      return
    }
    const t = window.setTimeout(() => setShowLoadingUI(true), graceMs)
    return () => window.clearTimeout(t)
  }, [loading, graceMs])

  if (loading) {
    if (!showLoadingUI) return null
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center h-full min-h-[240px] py-12"
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-6 h-6 rounded-full animate-spin"
            style={{
              border: '2px solid var(--color-border)',
              borderTopColor: 'var(--color-text)',
            }}
          />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {loadingLabel}
          </span>
        </div>
      </div>
    )
  }

  if (error) {
    const message = error instanceof Error ? error.message : String(error)
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 text-center h-full min-h-[240px] py-12 px-6"
      >
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-text)' }}
        >
          Couldn&apos;t load this view
        </span>
        <span
          className="text-xs max-w-md"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {message || 'An unexpected error occurred. Try again, or refresh the page if it persists.'}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 px-3 py-1.5 rounded text-xs font-medium"
            style={{
              background: 'var(--glass-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (empty) {
    if ('emptySlot' in props && props.emptySlot) {
      return <>{props.emptySlot}</>
    }
    if ('emptyTitle' in props && props.emptyTitle) {
      return (
        <EmptyState
          title={props.emptyTitle}
          description={props.emptyDescription}
          action={props.emptyAction}
        />
      )
    }
    // Fallback — caller said empty=true but provided neither slot nor
    // title. Render the children so the page still works; useful for
    // surfaces where the "empty" UX lives in the children themselves
    // (e.g. an editor page with a blank canvas).
  }

  return <>{children}</>
}
