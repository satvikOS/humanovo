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
  { id: 'workstation', label: 'Workstation', icon: FiTerminal, desc: 'In-browser MATLAB / Octave workstation' },
  { id: 'presets', label: 'Presets', icon: FiGrid, desc: '73+ one-click analyses organized by toolbox' },
  { id: 'montecarlo', label: 'Monte Carlo', icon: FiActivity, desc: 'Stochastic simulations & convergence' },
  { id: 'equations', label: 'Equation Plotter', icon: FiTrendingUp, desc: 'Plot, overlay & compare equations' },
]

export default function ComputeLab() {
  const [mode, setMode] = useState<ComputeMode>('workstation')

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--color-text)' }}>
      {/* ── Header ── */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b flex-shrink-0" style={{ borderColor: 'var(--glass-border)' }}>
        <div className="flex items-center gap-2">
          <FiCpu className="text-lg" style={{ color: 'var(--color-accent-blue)' }} />
          <h1 className="text-sm font-semibold">Compute Lab</h1>
        </div>

        <div className="flex gap-0.5 ml-4 p-0.5 rounded-lg" style={{ background: 'var(--glass-bg)' }}>
          {tabs.map(tab => {
            const active = mode === tab.id
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                  active ? 'shadow-sm' : 'hover:bg-white/5'
                )}
                style={{
                  background: active ? 'var(--color-accent-blue)' : 'transparent',
                  color: active ? '#fff' : 'var(--color-text-muted)',
                }}
                title={tab.desc}
              >
                <Icon className="text-sm" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
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
