import { FiActivity, FiClock } from 'react-icons/fi'

export default function Simulations() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-6">
        <div className="w-16 h-16 rounded-2xl bg-[var(--glass-bg)] border border-[var(--color-border)] flex items-center justify-center mx-auto mb-6">
          <FiActivity className="w-8 h-8 text-[var(--color-text-muted)]" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Active Simulations</h1>
        <div className="flex items-center justify-center gap-2 mb-4">
          <FiClock className="w-4 h-4 text-[var(--color-accent-blue)]" />
          <span className="text-sm font-medium" style={{ color: 'var(--color-accent-blue)' }}>Coming Soon...</span>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
          Monte Carlo simulations for hypothesis testing, molecular dynamics modeling,
          and in-silico experimentation are currently under development.
          This feature will allow you to run computational simulations
          to validate your research hypotheses.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3">
          {[
            { label: 'Monte Carlo', desc: 'Statistical simulations' },
            { label: 'Molecular Dynamics', desc: 'Protein interactions' },
            { label: 'Pathway Analysis', desc: 'Signaling cascades' },
            { label: 'Drug Docking', desc: 'Binding predictions' },
          ].map(item => (
            <div key={item.label} className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] text-left">
              <div className="text-xs font-medium text-[var(--color-text-secondary)]">{item.label}</div>
              <div className="text-xxs text-[var(--color-text-muted)] mt-0.5">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
