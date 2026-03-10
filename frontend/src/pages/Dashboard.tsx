import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FiFolder,
  FiZap,
  FiActivity,
  FiDatabase,
  FiClock,
  FiArrowRight,
  FiArrowUpRight,
  FiArrowDownRight,
  FiCheckCircle,
  FiRefreshCw,
  FiSearch,
  FiBook,
  FiChevronRight,
  FiTrendingUp,
  FiCpu,
} from 'react-icons/fi'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import api from '../services/api'
import type { Project, Activity, Simulation, OrchestratorStatus } from '../services/api'

// ── Stat Card (expandable) ──────────────────────────────────────

interface StatData {
  label: string
  value: number
  change?: number
  icon: typeof FiFolder
  accentColor: string
  href: string
  chartData?: Array<{ name: string; value: number }>
}

function StatCard({ stat, expanded, onToggle }: { stat: StatData; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="glass-card p-5 text-left transition-all duration-300 hover:bg-[var(--glass-bg-hover)] group w-full"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg`} style={{ background: `${stat.accentColor}12` }}>
          <stat.icon className="w-4 h-4" style={{ color: stat.accentColor }} />
        </div>
        {stat.change !== undefined && (
          <span className="flex items-center gap-0.5 text-xs" style={{ color: stat.change >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
            {stat.change >= 0 ? <FiArrowUpRight className="w-3 h-3" /> : <FiArrowDownRight className="w-3 h-3" />}
            {Math.abs(stat.change)}%
          </span>
        )}
      </div>
      <div className="text-3xl font-semibold tracking-tight mb-1">{stat.value}</div>
      <div className="text-sm text-[var(--color-text-muted)]">{stat.label}</div>

      {expanded && stat.chartData && stat.chartData.length > 0 && (
        <div className="mt-4 h-16 animate-fade-in">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stat.chartData}>
              <defs>
                <linearGradient id={`grad-${stat.label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={stat.accentColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={stat.accentColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={stat.accentColor}
                fill={`url(#grad-${stat.label})`}
                strokeWidth={1.5}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface-solid)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: 'var(--color-text)',
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center gap-1 mt-3 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
        View details <FiChevronRight className="w-3 h-3" />
      </div>
    </button>
  )
}

// ── Discovery Status ────────────────────────────────────────────

function DiscoveryWidget() {
  const [status, setStatus] = useState<OrchestratorStatus | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    let interval: number
    const poll = async () => {
      try {
        const data = await api.getOrchestratorStatus()
        setStatus(data)
        setConnected(true)
      } catch {
        setConnected(false)
      }
    }
    poll()
    interval = window.setInterval(poll, 10000)
    return () => clearInterval(interval)
  }, [])

  const stateLabel = status?.state === 'running' ? 'Running' : status?.state === 'paused' ? 'Paused' : status?.state === 'completed' ? 'Complete' : 'Idle'
  const stateColor = status?.state === 'running' ? 'var(--color-success)' : status?.state === 'paused' ? 'var(--color-warning)' : 'var(--color-text-muted)'

  return (
    <div className="glass-card p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FiCpu className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-medium">Discovery Engine</h3>
        </div>
        <Link to="/agents" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors">
          Open <FiArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-[var(--glass-bg)]">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Pipeline</div>
          <div className="text-sm font-semibold" style={{ color: connected ? 'var(--color-success)' : connected === false ? 'var(--color-text-muted)' : 'var(--color-warning)' }}>
            {connected === null ? 'Connecting...' : connected ? 'Live' : 'Offline'}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-[var(--glass-bg)]">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">State</div>
          <div className="text-sm font-semibold" style={{ color: stateColor }}>{stateLabel}</div>
        </div>
      </div>

      {status && status.hypotheses_found > 0 && (
        <div className="p-3 rounded-lg bg-[var(--glass-bg)] mb-4 text-center">
          <div className="text-xs text-[var(--color-text-muted)]">Hypotheses Found</div>
          <div className="text-2xl font-bold mt-1" style={{ color: 'var(--color-accent-purple)' }}>{status.hypotheses_found}</div>
        </div>
      )}

      <div className="space-y-2">
        {[
          { label: 'Multi-model reasoning', active: true },
          { label: 'MCP context sharding', active: true },
          { label: 'Genomics analysis', active: true },
          { label: 'Paper generation', active: true },
        ].map(cap => (
          <div key={cap.label} className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: cap.active ? 'var(--color-success)' : 'var(--color-text-muted)' }} />
            {cap.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Simulations Widget ──────────────────────────────────────────

function SimulationsWidget() {
  const [simulations, setSimulations] = useState<Simulation[]>([])

  useEffect(() => {
    api.getSimulations({ page_size: 5, status: 'running' })
      .then(res => setSimulations(res.items || []))
      .catch(() => {})
  }, [])

  return (
    <div className="glass-card p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Active Simulations</h3>
        <Link to="/simulations" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors">
          View All <FiArrowRight className="w-3 h-3" />
        </Link>
      </div>
      {simulations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-[var(--color-text-muted)]">
          <FiActivity className="w-6 h-6 mb-2 opacity-40" />
          <p className="text-sm">Coming Soon...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {simulations.map(sim => (
            <div key={sim.id} className="p-3 rounded-lg bg-[var(--glass-bg)]">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium truncate">{sim.name}</span>
                {sim.status === 'completed' ? (
                  <FiCheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-success)' }} />
                ) : (
                  <FiRefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0" style={{ color: 'var(--color-accent-blue)' }} />
                )}
              </div>
              <div className="h-1.5 rounded-full overflow-hidden bg-[var(--color-border)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round((sim.iterations_completed / sim.iterations) * 100)}%`,
                    background: sim.status === 'completed' ? 'var(--color-success)' : 'var(--color-accent-blue)',
                  }}
                />
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1">
                {sim.iterations_completed}/{sim.iterations} iterations
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Activity Feed ───────────────────────────────────────────────

function ActivityFeed() {
  const [activities, setActivities] = useState<Activity[]>([])

  useEffect(() => {
    api.getActivities({ page_size: 8 })
      .then(res => setActivities(res.items || []))
      .catch(() => {})
  }, [])

  const typeIcons: Record<string, typeof FiZap> = {
    hypothesis: FiZap,
    simulation: FiActivity,
    evidence: FiDatabase,
    project: FiFolder,
    notebook: FiBook,
    discovery: FiTrendingUp,
  }

  const typeColors: Record<string, string> = {
    hypothesis: 'var(--color-accent-purple)',
    simulation: 'var(--color-accent-green)',
    evidence: 'var(--color-accent-blue)',
    project: 'var(--color-text-secondary)',
    notebook: 'var(--color-accent-orange)',
    discovery: 'var(--color-accent-cyan)',
  }

  const actionColors: Record<string, string> = {
    created: 'var(--color-accent-blue)',
    updated: 'var(--color-text-muted)',
    completed: 'var(--color-success)',
    validated: 'var(--color-success)',
    rejected: 'var(--color-error)',
    started: 'var(--color-warning)',
    imported: 'var(--color-accent-cyan)',
    deleted: 'var(--color-error)',
  }

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Recent Activity</h3>
        <Link to="/timeline" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors">
          <FiClock className="w-3 h-3" />
          Timeline
        </Link>
      </div>
      {activities.length === 0 ? (
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          <FiClock className="w-6 h-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No recent activity</p>
          <p className="text-xs mt-1">Start a discovery or create a project</p>
        </div>
      ) : (
        <div className="space-y-0">
          {activities.map((activity) => {
            const Icon = typeIcons[activity.type] || FiActivity
            const color = typeColors[activity.type] || 'var(--color-text-muted)'
            return (
              <div key={activity.id} className="flex items-start gap-3 py-3 border-b border-[var(--color-border)] last:border-0 group">
                <div className="p-1.5 rounded-lg flex-shrink-0" style={{ background: `${color}12` }}>
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{activity.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {activity.project_name && (
                      <span className="text-xs text-[var(--color-text-muted)]">{activity.project_name}</span>
                    )}
                    <span className="text-xs text-[var(--color-text-muted)]">{formatTime(activity.created_at)}</span>
                  </div>
                </div>
                <span
                  className="text-xs px-2 py-0.5 rounded-md flex-shrink-0"
                  style={{ color: actionColors[activity.action] || 'var(--color-text-muted)', background: `${actionColors[activity.action] || 'var(--color-text-muted)'}12` }}
                >
                  {activity.action}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Dashboard ──────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [expandedStat, setExpandedStat] = useState<number | null>(null)
  const [counts, setCounts] = useState({ projects: 0, hypotheses: 0, simulations: 0, evidence: 0 })

  // Fetch data from live API
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [projectsRes, hypothesesRes, simsRes, evidenceRes] = await Promise.allSettled([
          api.getProjects({ page_size: 8 }),
          api.getHypotheses({ page_size: 1 }),
          api.getSimulations({ page_size: 1 }),
          api.getEvidenceList({ page_size: 1 }),
        ])

        if (projectsRes.status === 'fulfilled') {
          setProjects(projectsRes.value.items || [])
          setCounts(prev => ({ ...prev, projects: projectsRes.value.total }))
        }
        if (hypothesesRes.status === 'fulfilled') setCounts(prev => ({ ...prev, hypotheses: hypothesesRes.value.total }))
        if (simsRes.status === 'fulfilled') setCounts(prev => ({ ...prev, simulations: simsRes.value.total }))
        if (evidenceRes.status === 'fulfilled') setCounts(prev => ({ ...prev, evidence: evidenceRes.value.total }))
      } catch (e) {
        console.error('Dashboard fetch error:', e)
      }
    }
    fetchData()
  }, [])

  // Generate chart data (last 7 periods)
  const makeChartData = (total: number) => {
    const data = []
    for (let i = 6; i >= 0; i--) {
      data.push({ name: `${i}d`, value: Math.max(0, total - Math.floor(Math.random() * Math.max(1, total * 0.3) * (i + 1))) })
    }
    data[data.length - 1].value = total
    return data
  }

  const stats: StatData[] = [
    { label: 'Active Projects', value: counts.projects, icon: FiFolder, accentColor: '#a1a1a1', href: '/projects', chartData: makeChartData(counts.projects) },
    { label: 'Hypotheses', value: counts.hypotheses, icon: FiZap, accentColor: '#a855f7', href: '/agents', chartData: makeChartData(counts.hypotheses) },
    { label: 'Simulations', value: counts.simulations, icon: FiActivity, accentColor: '#22c55e', href: '/agents', chartData: makeChartData(counts.simulations) },
    { label: 'Evidence Items', value: counts.evidence, icon: FiDatabase, accentColor: '#3b82f6', href: '/evidence', chartData: makeChartData(counts.evidence) },
  ]

  const quickActions = [
    { label: 'New Project', icon: FiFolder, action: () => navigate('/projects?new=1'), color: 'var(--color-text)' },
    { label: 'Start Discovery', icon: FiZap, action: () => navigate('/agents?start=1'), color: 'var(--color-accent-purple)' },
    { label: 'Search', icon: FiSearch, action: () => navigate('/search'), color: 'var(--color-accent-blue)' },
    { label: 'Notebook', icon: FiBook, action: () => navigate('/notebook'), color: 'var(--color-accent-orange)' },
  ]

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Welcome back. Here's what's happening with your research.</p>
        </div>
        <div className="flex items-center gap-2">
          {quickActions.map(action => (
            <button
              key={action.label}
              onClick={action.action}
              className="btn text-sm"
              style={{ color: action.color }}
            >
              <action.icon className="w-4 h-4" />
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <StatCard
            key={stat.label}
            stat={stat}
            expanded={expandedStat === i}
            onToggle={() => setExpandedStat(expandedStat === i ? null : i)}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-3 gap-4">
        {/* Activity Feed - spans 2 cols */}
        <div className="col-span-2">
          <ActivityFeed />
        </div>

        {/* Discovery Widget */}
        <div>
          <DiscoveryWidget />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Simulations */}
        <div>
          <SimulationsWidget />
        </div>

        {/* Recent Projects */}
        <div className="col-span-2">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Recent Projects</h3>
              <Link to="/projects" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors">
                View All <FiArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)]">
                <FiFolder className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm">No projects yet</p>
                <button
                  onClick={() => navigate('/projects?new=1')}
                  className="text-sm mt-2 text-[var(--color-text)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  Create your first project
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {projects.slice(0, 6).map(project => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="p-4 rounded-xl bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-all group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <FiFolder className="w-4 h-4 text-[var(--color-text-muted)]" />
                        {project.status && (
                          <span className="text-xs" style={{ color: project.status === 'active' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                            {project.status}
                          </span>
                        )}
                      </div>
                      <FiArrowUpRight className="w-3.5 h-3.5 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm font-medium mb-1 truncate">{project.name}</div>
                    {project.disease_focus && (
                      <div className="text-xs text-[var(--color-text-muted)] mb-2 truncate">{project.disease_focus}</div>
                    )}
                    <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                      <span>{project.hypothesis_count} hypotheses</span>
                      <span>{project.evidence_count} evidence</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
