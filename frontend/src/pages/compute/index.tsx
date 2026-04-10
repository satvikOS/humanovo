import { useState } from 'react'
import {
  FiCpu, FiTerminal, FiGrid, FiActivity, FiTrendingUp,
} from 'react-icons/fi'
import clsx from 'clsx'
import Workstation from './Workstation'
import PresetRunner from './PresetRunner'
import MonteCarloPanel from './MonteCarloPanel'
import EquationPlotter from './EquationPlotter'
import type { ComputeMode } from './types'

const tabs: { id: ComputeMode; label: string; icon: typeof FiGrid; desc: string }[] = [
  { id: 'workstation', label: 'Workstation', icon: FiTerminal, desc: 'In-browser numeric compute workstation' },
  { id: 'presets', label: 'Presets', icon: FiGrid, desc: '73+ one-click analyses organized by toolbox' },
  { id: 'montecarlo', label: 'Monte Carlo', icon: FiActivity, desc: 'Stochastic simulations & convergence' },
  { id: 'equations', label: 'Equation Plotter', icon: FiTrendingUp, desc: 'Plot, overlay & compare equations' },
]

export default function ComputeLab() {
  const [mode, setMode] = useState<ComputeMode>('workstation')

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--color-text)' }}>
      {/* ── Header ── */}
      <div className="flex items-center gap-5 px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--glass-border)' }}>
        <div className="flex items-center gap-2">
          <FiCpu className="text-base" style={{ color: 'var(--color-text-muted)' }} />
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Compute Lab</h1>
        </div>

        <div className="flex gap-1 ml-2">
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
        {mode === 'presets' && <PresetRunner />}
        {mode === 'montecarlo' && <MonteCarloPanel />}
        {mode === 'equations' && <EquationPlotter />}
      </div>
    </div>
  )
}
