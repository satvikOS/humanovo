import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiCpu, FiTerminal, FiGrid, FiActivity, FiTrendingUp,
} from 'react-icons/fi'
import clsx from 'clsx'
import Workstation from './Workstation'
import MonteCarloPanel from './MonteCarloPanel'
import EquationPlotter from './EquationPlotter'
import type { ComputeMode } from './types'

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
  useEffect(() => {
    const current = (searchParams.get('tab') || '').toLowerCase()
    const normalized = TAB_ALIASES[current] ?? ''
    if (normalized !== mode) {
      const next = new URLSearchParams(searchParams)
      if (mode === 'workstation') next.delete('tab')
      else next.set('tab', mode)
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
        {mode === 'workstation' && <Workstation />}
        {mode === 'montecarlo' && <MonteCarloPanel />}
        {mode === 'equations' && <EquationPlotter />}
      </div>
    </div>
  )
}
