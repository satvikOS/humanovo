import { useQuery } from '@tanstack/react-query'
import { FiZap, FiFileText, FiActivity, FiClock } from 'react-icons/fi'
import { api } from '../services/api'

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  change?: string
  changeType?: 'positive' | 'negative' | 'neutral'
}

function StatCard({ title, value, icon: Icon, change, changeType = 'neutral' }: StatCardProps) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-secondary-400 text-sm font-medium">{title}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {change && (
            <p className={`text-sm mt-1 ${
              changeType === 'positive' ? 'text-green-400' :
              changeType === 'negative' ? 'text-red-400' :
              'text-secondary-400'
            }`}>
              {change}
            </p>
          )}
        </div>
        <div className="p-3 bg-primary-600/20 rounded-lg">
          <Icon className="w-6 h-6 text-primary-400" />
        </div>
      </div>
    </div>
  )
}

interface RecentHypothesis {
  id: string
  statement: string
  confidence_score: number
  status: string
  created_at: string
}

function RecentHypothesesList() {
  const { data: hypotheses, isLoading } = useQuery({
    queryKey: ['hypotheses', 'recent'],
    queryFn: () => api.getHypotheses({ page: 1, page_size: 5 }),
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse bg-secondary-700 h-20 rounded-lg" />
        ))}
      </div>
    )
  }

  const items = hypotheses?.items || []

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-secondary-400 text-center py-8">No hypotheses yet</p>
      ) : (
        items.map((hypothesis: RecentHypothesis) => (
          <div key={hypothesis.id} className="p-4 bg-secondary-800/50 rounded-lg border border-secondary-700 hover:border-secondary-600 transition-colors">
            <p className="text-white font-medium line-clamp-2">{hypothesis.statement}</p>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center space-x-3">
                <span className={`badge ${
                  hypothesis.status === 'validated' ? 'badge-success' :
                  hypothesis.status === 'active' ? 'badge-info' :
                  'badge-warning'
                }`}>
                  {hypothesis.status}
                </span>
                <span className="text-secondary-400 text-sm">
                  {Math.round(hypothesis.confidence_score * 100)}% confidence
                </span>
              </div>
              <span className="text-secondary-500 text-xs">
                {new Date(hypothesis.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default function Dashboard() {
  const { data: projects } = useQuery({
    queryKey: ['projects', 'count'],
    queryFn: () => api.getProjects({ page: 1, page_size: 1 }),
  })

  const { data: hypotheses } = useQuery({
    queryKey: ['hypotheses', 'count'],
    queryFn: () => api.getHypotheses({ page: 1, page_size: 1 }),
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-secondary-400 mt-1">Overview of your biomedical discovery platform</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Active Projects"
          value={projects?.total || 0}
          icon={FiFileText}
        />
        <StatCard
          title="Hypotheses Generated"
          value={hypotheses?.total || 0}
          icon={FiZap}
        />
        <StatCard
          title="Simulations Run"
          value={0}
          icon={FiActivity}
        />
        <StatCard
          title="Last Update"
          value="Just now"
          icon={FiClock}
        />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Hypotheses */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Recent Hypotheses</h2>
            <a href="/hypotheses" className="text-primary-400 text-sm hover:underline">
              View all
            </a>
          </div>
          <RecentHypothesesList />
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <button className="w-full p-4 bg-primary-600/20 border border-primary-600/30 rounded-lg text-left hover:bg-primary-600/30 transition-colors">
              <h3 className="font-medium text-primary-400">Generate Hypotheses</h3>
              <p className="text-secondary-400 text-sm mt-1">
                Use AI to generate new biomedical hypotheses
              </p>
            </button>
            <button className="w-full p-4 bg-secondary-800/50 border border-secondary-700 rounded-lg text-left hover:bg-secondary-800 transition-colors">
              <h3 className="font-medium text-white">New Project</h3>
              <p className="text-secondary-400 text-sm mt-1">
                Create a new research project
              </p>
            </button>
            <button className="w-full p-4 bg-secondary-800/50 border border-secondary-700 rounded-lg text-left hover:bg-secondary-800 transition-colors">
              <h3 className="font-medium text-white">Run Simulation</h3>
              <p className="text-secondary-400 text-sm mt-1">
                Execute Monte Carlo simulation
              </p>
            </button>
            <button className="w-full p-4 bg-secondary-800/50 border border-secondary-700 rounded-lg text-left hover:bg-secondary-800 transition-colors">
              <h3 className="font-medium text-white">Explore Knowledge Graph</h3>
              <p className="text-secondary-400 text-sm mt-1">
                Browse biomedical entities and relationships
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
