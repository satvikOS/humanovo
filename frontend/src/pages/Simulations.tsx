import { useQuery } from '@tanstack/react-query'
import { FiActivity, FiPlay, FiPause, FiCheck, FiX } from 'react-icons/fi'
import { api, Simulation } from '../services/api'
import clsx from 'clsx'

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

export default function Simulations() {
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
        <button className="btn btn-primary flex items-center space-x-2">
          <FiActivity className="w-4 h-4" />
          <span>New Simulation</span>
        </button>
      </div>

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
          <button className="btn btn-primary">Create Simulation</button>
        </div>
      )}
    </div>
  )
}
