import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  FiFolder,
  FiZap,
  FiActivity,
  FiDatabase,
  FiClock,
  FiArrowRight,
  FiFileText,
  FiCheckCircle,
  FiRefreshCw
} from 'react-icons/fi'
import clsx from 'clsx'
import { useWorkspace } from '../contexts/WorkspaceContext'

interface StatCard {
  label: string
  value: string | number
  change?: string
  trend?: 'up' | 'down' | 'neutral'
  icon: typeof FiFolder
  color: string
}

// Stats fetched from API - initially empty
const defaultStats: StatCard[] = [
  { label: 'Active Projects', value: 0, change: '', trend: 'neutral', icon: FiFolder, color: 'primary' },
  { label: 'Hypotheses', value: 0, change: '', trend: 'neutral', icon: FiZap, color: 'warning' },
  { label: 'Running Simulations', value: 0, change: '', trend: 'neutral', icon: FiActivity, color: 'success' },
  { label: 'Evidence Items', value: 0, change: '', trend: 'neutral', icon: FiDatabase, color: 'info' },
]

// Activity fetched from API
interface ActivityItem {
  id: number
  type: 'hypothesis' | 'simulation' | 'evidence' | 'project'
  action: string
  title: string
  project: string | null
  time: string
  status: string
}

const quickActions = [
  { label: 'New Project', icon: FiFolder, href: '/projects', color: 'bg-primary-500/20 text-primary-400' },
  { label: 'New Hypothesis', icon: FiZap, href: '/hypotheses', color: 'bg-warning-500/20 text-warning-400' },
  { label: 'Run Simulation', icon: FiActivity, href: '/simulations', color: 'bg-success-500/20 text-success-400' },
  { label: 'Import Evidence', icon: FiDatabase, href: '/evidence', color: 'bg-primary-500/20 text-primary-400' },
]

function StatCardComponent({ stat }: { stat: StatCard }) {
  return (
    <div className="card hover:border-[var(--color-border-strong)] transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className={clsx(
          'w-8 h-8 rounded flex items-center justify-center',
          stat.color === 'primary' && 'bg-primary-500/20 text-primary-400',
          stat.color === 'warning' && 'bg-warning-500/20 text-warning-400',
          stat.color === 'success' && 'bg-success-500/20 text-success-400',
          stat.color === 'info' && 'bg-primary-500/20 text-primary-400',
        )}>
          <stat.icon className="w-4 h-4" />
        </div>
        {stat.trend && (
          <span className={clsx(
            'text-xxs px-1.5 py-0.5 rounded',
            stat.trend === 'up' && 'bg-success-500/20 text-success-400',
            stat.trend === 'down' && 'bg-error-500/20 text-error-400',
            stat.trend === 'neutral' && 'bg-[var(--color-border)] text-[var(--color-text-muted)]',
          )}>
            {stat.trend === 'up' ? '+' : stat.trend === 'down' ? '-' : ''}{stat.change}
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold mb-0.5">{stat.value}</div>
      <div className="text-xs text-[var(--color-text-muted)]">{stat.label}</div>
    </div>
  )
}

function ActivityItemComponent({ activity }: { activity: ActivityItem }) {
  const icons = {
    hypothesis: FiZap,
    simulation: FiActivity,
    evidence: FiDatabase,
    project: FiFolder,
  }
  const Icon = icons[activity.type as keyof typeof icons] || FiFileText

  return (
    <div className="flex items-start gap-3 py-2">
      <div className={clsx(
        'w-7 h-7 rounded flex items-center justify-center flex-shrink-0',
        activity.type === 'hypothesis' && 'bg-warning-500/20 text-warning-400',
        activity.type === 'simulation' && 'bg-success-500/20 text-success-400',
        activity.type === 'evidence' && 'bg-primary-500/20 text-primary-400',
        activity.type === 'project' && 'bg-primary-500/20 text-primary-400',
      )}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{activity.title}</div>
        <div className="flex items-center gap-2 text-xxs text-[var(--color-text-muted)]">
          {activity.project && <span>{activity.project}</span>}
          <span>{activity.time}</span>
        </div>
      </div>
      {activity.status && (
        <span className={clsx(
          'text-xxs px-1.5 py-0.5 rounded flex-shrink-0',
          activity.status === 'success' && 'bg-success-500/20 text-success-400',
          activity.status === 'draft' && 'bg-[var(--color-border)] text-[var(--color-text-muted)]',
          activity.status === 'info' && 'bg-primary-500/20 text-primary-400',
        )}>
          {activity.action}
        </span>
      )}
    </div>
  )
}

function DiscoveryStatus() {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/v1/orchestrator/status')
        setConnected(res.ok)
      } catch {
        setConnected(false)
      }
    }
    check()
  }, [])

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Discovery Engine</h3>
        <Link to="/agents" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
          Open <FiArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 bg-[var(--color-bg)] rounded text-center">
            <div className="text-xs text-[var(--color-text-muted)]">Pipeline</div>
            <div className={clsx(
              'text-sm font-bold mt-0.5',
              connected === null ? 'text-yellow-400' : connected ? 'text-green-400' : 'text-red-400'
            )}>
              {connected === null ? 'Checking...' : connected ? 'Connected' : 'Offline'}
            </div>
          </div>
          <div className="p-2 bg-[var(--color-bg)] rounded text-center">
            <div className="text-xs text-[var(--color-text-muted)]">Max Agents</div>
            <div className="text-sm font-bold mt-0.5">10,000</div>
          </div>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className={clsx('w-2 h-2 rounded-full', connected ? 'bg-green-500' : 'bg-gray-500')} />
            <span className="text-[var(--color-text-muted)]">Multi-model reasoning</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx('w-2 h-2 rounded-full', connected ? 'bg-green-500' : 'bg-gray-500')} />
            <span className="text-[var(--color-text-muted)]">Parallel exploration</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx('w-2 h-2 rounded-full', connected ? 'bg-green-500' : 'bg-gray-500')} />
            <span className="text-[var(--color-text-muted)]">External factor simulation</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx('w-2 h-2 rounded-full', connected ? 'bg-green-500' : 'bg-gray-500')} />
            <span className="text-[var(--color-text-muted)]">Research paper generation</span>
          </div>
        </div>
      </div>
    </div>
  )
}

interface Simulation {
  id: number
  name: string
  progress: number
  status: 'running' | 'completed' | 'queued'
}

function ActiveSimulations({ simulations = [] }: { simulations?: Simulation[] }) {
  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Active Simulations</h3>
        <Link to="/simulations" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
          View All <FiArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="space-y-3">
        {simulations.length === 0 ? (
          <div className="text-center py-4 text-[var(--color-text-muted)] text-xs">
            No active simulations
          </div>
        ) : simulations.map(sim => (
          <div key={sim.id} className="p-2 bg-[var(--color-bg)] rounded">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium truncate">{sim.name}</span>
              {sim.status === 'completed' ? (
                <FiCheckCircle className="w-3.5 h-3.5 text-success-400 flex-shrink-0" />
              ) : (
                <FiRefreshCw className="w-3.5 h-3.5 text-primary-400 animate-spin flex-shrink-0" />
              )}
            </div>
            <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full rounded-full transition-all',
                  sim.status === 'completed' ? 'bg-success-500' : 'bg-primary-500'
                )}
                style={{ width: `${sim.progress}%` }}
              />
            </div>
            <div className="text-xxs text-[var(--color-text-muted)] mt-1">{sim.progress}% complete</div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface Project {
  id: string
  name: string
  hypotheses: number
  evidence: number
  status: 'active' | 'draft' | 'completed'
}

export default function Dashboard() {
  const { addTab } = useWorkspace()

  // State for data fetched from API (empty by default)
  const [stats] = useState<StatCard[]>(defaultStats)
  const [recentActivity] = useState<ActivityItem[]>([])
  const [simulations] = useState<Simulation[]>([])
  const [projects] = useState<Project[]>([])

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Welcome back. Here's what's happening with your research.</p>
        </div>
        <div className="flex items-center gap-2">
          {quickActions.map(action => (
            <Link
              key={action.label}
              to={action.href}
              className={clsx('btn btn-sm', action.color)}
            >
              <action.icon className="w-3.5 h-3.5" />
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {stats.map(stat => (
          <StatCardComponent key={stat.label} stat={stat} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Recent Activity</h3>
            <Link to="/timeline" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1">
              <FiClock className="w-3 h-3" />
              View Timeline
            </Link>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {recentActivity.length === 0 ? (
              <div className="text-center py-4 text-[var(--color-text-muted)] text-xs">
                No recent activity
              </div>
            ) : recentActivity.map(activity => (
              <ActivityItemComponent key={activity.id} activity={activity} />
            ))}
          </div>
        </div>

        <div className="row-span-2">
          <ActiveSimulations simulations={simulations} />
        </div>

        <div className="col-span-2">
          <DiscoveryStatus />
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Recent Projects</h3>
          <Link to="/projects" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
            View All <FiArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {projects.length === 0 ? (
            <div className="col-span-4 text-center py-8 text-[var(--color-text-muted)]">
              <FiFolder className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No projects yet</p>
              <Link to="/projects" className="text-xs text-primary-400 hover:text-primary-300 mt-1 inline-block">
                Create your first project
              </Link>
            </div>
          ) : projects.map(project => (
            <button
              key={project.id}
              onClick={() => addTab({ type: 'project', title: project.name })}
              className="p-3 bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-left transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <FiFolder className="w-4 h-4 text-primary-400" />
                <span className={clsx(
                  'text-xxs px-1.5 py-0.5 rounded',
                  project.status === 'active' ? 'bg-success-500/20 text-success-400' : 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
                )}>
                  {project.status}
                </span>
              </div>
              <div className="text-sm font-medium truncate mb-1">{project.name}</div>
              <div className="flex items-center gap-3 text-xxs text-[var(--color-text-muted)]">
                <span>{project.hypotheses} hypotheses</span>
                <span>{project.evidence} evidence</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
