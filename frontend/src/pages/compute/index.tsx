import { lazy, Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiCpu, FiTerminal, FiGrid, FiActivity, FiTrendingUp,
} from 'react-icons/fi'
import clsx from 'clsx'
import type { ComputeMode } from './types'

// Lazy-load each tab's panel — Workstation alone pulls in plotly-dist-min
// (~3 MB minified) plus a MATLAB-style numeric interpreter, so eagerly
// importing all three blows up the compute-lab initial paint and used to
// trip the 30 s default test timeout under headless 7-worker contention.
// Splitting them into separate chunks keeps the tab row painting fast and
// the heavy work on demand.
const Workstation = lazy(() => import('./Workstation'))
const MonteCarloPanel = lazy(() => import('./MonteCarloPanel'))
const EquationPlotter = lazy(() => import('./EquationPlotter'))

const tabs: { id: ComputeMode; label: string; icon: typeof FiGrid; desc: string }[] = [
  { id: 'workstation', label: 'Workstation', icon: FiTerminal, desc: 'In-browser numeric compute workstation with 3D plotting' },
  { id: 'montecarlo', label: 'Monte Carlo', icon: FiActivity, desc: 'Stochastic simulations & convergence' },
  { id: 'equations', label: 'Equation Plotter', icon: FiTrendingUp, desc: 'Plot, overlay & compare equations' },
]

// Accept legacy aliases so existing dashboard links that still point at
// "history" or "simulation" names don't 404 into the default workstation
// tab. Map each known alias onto a real ComputeMode.
const TAB_ALIASES: Record<string, ComputeMode> = {
  workstation: 'workstation',
  montecarlo: 'montecarlo',
  'monte-carlo': 'montecarlo',
  mc: 'montecarlo',
  history: 'montecarlo', // legacy: simulations history = Monte Carlo panel
  simulations: 'montecarlo',
  equations: 'equations',
  equation: 'equations',
  plotter: 'equations',
}

export default function ComputeLab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMode: ComputeMode = (() => {
    const raw = (searchParams.get('tab') || '').toLowerCase()
    return TAB_ALIASES[raw] ?? 'workstation'
  })()
  const [mode, setMode] = useState<ComputeMode>(initialMode)

  // Keep the URL query in sync so the selected tab is shareable and
  // survives reload without hijacking the user's back/forward stack.
  // We compare what's *literally* in the URL against what the current
  // mode wants — this normalizes aliases (?tab=mc → ?tab=montecarlo)
  // and strips ?tab=workstation (workstation is the default, so no
  // param should be visible) on initial mount.
  useEffect(() => {
    const currentRaw = (searchParams.get('tab') || '').toLowerCase()
    const want = mode === 'workstation' ? '' : mode
    if (currentRaw !== want) {
      const next = new URLSearchParams(searchParams)
      if (want) next.set('tab', want)
      else next.delete('tab')
      setSearchParams(next, { replace: true })
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--color-text)' }}>
      {/* ── Header ──
          The sidebar + top-nav both already render the page title
          "Compute Lab", so we drop the inline <h1> that used to sit
          left of the tab row — it was pure visual duplication that
          ate horizontal space. Keep the FiCpu icon as a compact
          anchor so users still get a visual cue. */}
      <div className="flex items-center gap-5 px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--glass-border)' }}>
        <FiCpu className="text-base flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />

        <div className="flex gap-1">
          {tabs.map(tab => {
            const active = mode === tab.id
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                  !active && 'hover:bg-white/[0.03]'
                )}
                style={{
                  background: 'transparent',
                  color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                  borderBottom: active ? '2px solid var(--color-text)' : '2px solid transparent',
                }}
                title={tab.desc}
              >
                <Icon className="text-sm" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {tabs.find(t => t.id === mode)?.desc}
        </span>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div
              className="flex items-center justify-center h-full p-8 text-xs"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Loading…
            </div>
          }
        >
          {mode === 'workstation' && <Workstation />}
          {mode === 'montecarlo' && <MonteCarloPanel />}
          {mode === 'equations' && <EquationPlotter />}
        </Suspense>
      </div>
    </div>
  )
}
