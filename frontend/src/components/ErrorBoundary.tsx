import { Component, type ReactNode } from 'react'

/**
 * Per-page error boundary. Catches render-time crashes (missing data,
 * null dereference, throw inside useMemo, etc.) and swaps the subtree
 * for a recoverable UI instead of the blank white screen we used to
 * ship.
 *
 * Three escape hatches:
 *   - Try again  → soft reset, re-renders the same subtree.
 *   - Copy details → puts the error message on the clipboard so the
 *     user can paste it into a bug report.
 *   - Reload page → hard reload if the soft retry also blows up.
 *
 * `resetKey` prop — when the parent changes this string (we use the
 * current pathname upstream in App.tsx) the boundary auto-resets so a
 * user who hits an error on /projects and navigates to /dashboard
 * doesn't stay stuck on the error screen.
 */
interface Props {
  children: ReactNode
  resetKey?: string
}
interface State { hasError: boolean; error: string }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: '' })
    }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surface to the browser console; real observability sink is out
    // of scope here — hooked in via window.__humanovoOnError if a
    // consumer wants it.
    console.error('Page error:', error, info.componentStack)
    try {
      const sink = (window as any).__humanovoOnError as undefined | ((e: Error, stack?: string | null) => void)
      sink?.(error, info.componentStack)
    } catch { /* noop */ }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const softReset = () => this.setState({ hasError: false, error: '' })
    const hardReload = () => { softReset(); window.location.reload() }
    const copyError = () => {
      try { navigator.clipboard?.writeText(this.state.error) } catch { /* noop */ }
    }
    return (
      <div className="flex items-center justify-center h-full p-8" role="alert">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4 opacity-20">⚠</div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
            Something went wrong
          </h2>
          <pre
            className="text-xs mb-4 px-3 py-2 text-left overflow-auto max-h-32 rounded"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-surface-raised)',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            }}
          >{this.state.error || 'Unknown error'}</pre>
          <div className="flex items-center justify-center gap-2">
            <button onClick={softReset} className="btn text-sm" style={{ color: 'var(--color-text)' }}>
              Try again
            </button>
            <button onClick={copyError} className="btn text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Copy details
            </button>
            <button onClick={hardReload} className="btn text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
