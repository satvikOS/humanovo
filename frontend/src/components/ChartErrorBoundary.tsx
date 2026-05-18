import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Change this when the chart input changes so the boundary re-arms. */
  resetKey?: string | number
}
interface State { hasError: boolean }

/**
 * Compact error boundary scoped to a single chart / figure.
 *
 * Plotly's render path can throw synchronously inside componentDidMount
 * (e.g. "Cannot read properties of undefined (reading 'selectAll')" on
 * some gl3d inputs). Without a boundary here that throw bubbles to the
 * page-level boundary and replaces the WHOLE Compute Lab / Data
 * Visualization page. Scoped to the chart, only the one cell shows a
 * fallback and the rest of the page stays interactive.
 */
export default class ChartErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  componentDidCatch(err: Error) {
    console.warn('chart render failed:', err.message)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        className="flex flex-col items-center justify-center w-full h-full gap-2 text-center p-4"
        style={{ minHeight: 160 }}
        role="alert"
      >
        <span className="text-2xl opacity-20">⚠</span>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          This chart could not be rendered.
        </p>
        <button
          onClick={() => this.setState({ hasError: false })}
          className="text-xs px-2.5 py-1 rounded border"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          Retry
        </button>
      </div>
    )
  }
}
