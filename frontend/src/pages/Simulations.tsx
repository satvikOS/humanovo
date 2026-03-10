import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiActivity, FiPlay, FiPause, FiCheck, FiX, FiPlus } from 'react-icons/fi'
import { api, Simulation } from '../services/api'
import clsx from 'clsx'

const SIMULATION_TYPES = [
  { id: 'clinical_outcome', label: 'Clinical Outcome' },
  { id: 'epidemiological', label: 'Epidemiological' },
  { id: 'dose_response', label: 'Dose Response' },
  { id: 'pathway_dynamics', label: 'Pathway Dynamics' },
  { id: 'drug_interaction', label: 'Drug Interaction' },
  { id: 'survival_analysis', label: 'Survival Analysis' },
]

function SimulationCard({ simulation }: { simulation: Simulation }) {
  const statusConfig = {
    queued: { icon: FiPause, color: 'text-secondary-400', bg: 'bg-secondary-600/20' },
    running: { icon: FiPlay, color: 'text-blue-400', bg: 'bg-blue-600/20' },
    completed: { icon: FiCheck, color: 'text-green-400', bg: 'bg-green-600/20' },
    failed: { icon: FiX, color: 'text-red-400', bg: 'bg-red-600/20' },
    cancelled: { icon: FiX, color: 'text-secondary-400', bg: 'bg-secondary-600/20' },
  }

  const status = statusConfig[simulation.status] || statusConfig.queued
  const StatusIcon = status.icon

  const progress = simulation.iterations > 0
    ? (simulation.iterations_completed / simulation.iterations) * 100
    : 0

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className={clsx('p-2 rounded-lg', status.bg)}>
            <StatusIcon className={clsx('w-5 h-5', status.color)} />
          </div>
          <div>
            <h3 className="font-semibold text-white">{simulation.name}</h3>
            <p className="text-secondary-400 text-sm">{simulation.simulation_type}</p>
          </div>
        </div>
        <span className={clsx('badge', {
          'badge-success': simulation.status === 'completed',
          'badge-warning': simulation.status === 'running',
          'badge-error': simulation.status === 'failed',
        })}>
          {simulation.status}
        </span>
      </div>

      {simulation.description && (
        <p className="text-secondary-400 text-sm mt-3">{simulation.description}</p>
      )}

      {/* Progress bar for running simulations */}
      {simulation.status === 'running' && (
        <div className="mt-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-secondary-400">Progress</span>
            <span className="text-white">
              {simulation.iterations_completed.toLocaleString()} / {simulation.iterations.toLocaleString()}
            </span>
          </div>
          <div className="h-2 bg-secondary-700 rounded-full">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Outcomes for completed simulations */}
      {simulation.status === 'completed' && simulation.outcomes.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium text-secondary-300">Results</h4>
          {simulation.outcomes.slice(0, 3).map((outcome, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-secondary-400">{outcome.name}</span>
              <span className="text-white">
                {outcome.mean.toFixed(3)} (95% CI: {outcome.ci_lower.toFixed(3)} - {outcome.ci_upper.toFixed(3)})
              </span>
            </div>
          ))}
        </div>
      )}

      {simulation.summary && (
        <p className="text-secondary-300 text-sm mt-3 p-2 bg-secondary-800 rounded">
          {simulation.summary}
        </p>
      )}

      <div className="mt-4 pt-4 border-t border-secondary-700 flex justify-between text-sm">
        <span className="text-secondary-500">
          {simulation.iterations.toLocaleString()} iterations
        </span>
        {simulation.runtime_seconds && (
          <span className="text-secondary-500">
            {simulation.runtime_seconds.toFixed(1)}s runtime
          </span>
        )}
      </div>
    </div>
  )
}

function NewSimulationForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [simulationType, setSimulationType] = useState('clinical_outcome')
  const [iterations, setIterations] = useState(1000)

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createSimulation>[0]) => api.createSimulation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulations'] })
      onClose()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      simulation_type: simulationType,
      project_id: 'default',
      parameters: [],
      iterations,
    })
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--color-text)]">New Simulation</h3>
        <button onClick={onClose} className="p-1 hover:bg-[var(--glass-bg)] rounded transition-all">
          <FiX className="w-4 h-4 text-[var(--color-text-muted)]" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Drug efficacy simulation"
            className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-blue)]"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe what this simulation tests..."
            rows={2}
            className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-blue)] resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Type</label>
            <select
              value={simulationType}
              onChange={e => setSimulationType(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent-blue)]"
            >
              {SIMULATION_TYPES.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Iterations</label>
            <input
              type="number"
              value={iterations}
              onChange={e => setIterations(parseInt(e.target.value) || 1000)}
              min={100}
              max={100000}
              className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent-blue)]"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] rounded-lg transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            className="px-4 py-2 text-sm bg-[var(--color-accent-blue)] text-white rounded-lg hover:opacity-90 transition-all disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create & Run'}
          </button>
        </div>

        {createMutation.isError && (
          <p className="text-sm text-red-400">
            Failed to create simulation. Please try again.
          </p>
        )}
      </form>
    </div>
  )
}

export default function Simulations() {
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['simulations'],
    queryFn: () => api.getSimulations({ page: 1, page_size: 50 }),
  })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Simulations</h1>
          <p className="text-secondary-400 mt-1">Monte Carlo simulations for hypothesis testing</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-primary flex items-center space-x-2"
        >
          <FiPlus className="w-4 h-4" />
          <span>New Simulation</span>
        </button>
      </div>

      {showCreate && <NewSimulationForm onClose={() => setShowCreate(false)} />}

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-secondary-800 h-48 rounded-lg" />
          ))}
        </div>
      ) : data?.items && data.items.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.items.map((simulation) => (
            <SimulationCard key={simulation.id} simulation={simulation} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <FiActivity className="w-12 h-12 text-secondary-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No simulations yet</h3>
          <p className="text-secondary-400 mb-6">
            Run Monte Carlo simulations to test your hypotheses
          </p>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary">
            Create Simulation
          </button>
        </div>
      )}
    </div>
  )
}
