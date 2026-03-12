import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FiFolder,
  FiZap,
  FiActivity,
  FiFileText,
  FiClock,
  FiArrowRight,
  FiArrowUpRight,
  FiArrowDownRight,
  FiSearch,
  FiBook,
  FiChevronRight,
  FiCpu,
} from 'react-icons/fi'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import api from '../services/api'
import type { Project, OrchestratorStatus } from '../services/api'
import { persistGet, getActivityLog, type ActivityEntry } from '../utils/persistence'

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

function StatCard({ stat }: { stat: StatData }) {
  return (
    <Link
      to={stat.href}
      className="glass-card p-5 text-left transition-all duration-300 hover:bg-[var(--glass-bg-hover)] group block"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg`} style={{ background: `${stat.accentColor}12` }}>
          <stat.icon className="w-4 h-4" style={{ color: stat.accentColor }} />
        </div>
        {stat.change !== undefined && stat.change !== 0 && (
          <span className="flex items-center gap-0.5 text-xs" style={{ color: stat.change > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
            {stat.change > 0 ? <FiArrowUpRight className="w-3 h-3" /> : <FiArrowDownRight className="w-3 h-3" />}
            {Math.abs(stat.change)}%
          </span>
        )}
      </div>
      <div className="text-3xl font-semibold tracking-tight mb-1">{stat.value}</div>
      <div className="text-sm text-[var(--color-text-muted)]">{stat.label}</div>

      {stat.chartData && stat.chartData.length > 0 && (
        <div className="mt-3 h-12">
          <ResponsiveContainer width="100%" height={48}>
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
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center gap-1 mt-2 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
        View details <FiChevronRight className="w-3 h-3" />
      </div>
    </Link>
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

// ── Activity Feed (from localStorage) ──────────────────────────

function ActivityFeed() {
  const activities = useMemo(() => getActivityLog().slice(0, 10), [])

  const typeIcons: Record<string, typeof FiZap> = {
    hypothesis: FiZap,
    simulation: FiActivity,
    evidence: FiFileText,
    project: FiFolder,
    notebook: FiBook,
    discovery: FiCpu,
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
                    {activity.project && (
                      <span className="text-xs text-[var(--color-text-muted)]">{activity.project}</span>
                    )}
                    <span className="text-xs text-[var(--color-text-muted)]">{formatTime(activity.timestamp)}</span>
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

// ── Helpers for real stats ──────────────────────────────────────

function computeChangePercent(activities: ActivityEntry[], type: string): number {
  const now = Date.now()
  const weekAgo = now - 7 * 86400000
  const twoWeeksAgo = now - 14 * 86400000
  const thisWeek = activities.filter(a => a.type === type && new Date(a.timestamp).getTime() >= weekAgo).length
  const lastWeek = activities.filter(a => a.type === type && new Date(a.timestamp).getTime() >= twoWeeksAgo && new Date(a.timestamp).getTime() < weekAgo).length
  if (lastWeek === 0) return thisWeek > 0 ? 100 : 0
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
}

function buildChartData(activities: ActivityEntry[], type: string): Array<{ name: string; value: number }> {
  const now = new Date()
  const days: Array<{ name: string; value: number }> = []
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now)
    dayStart.setDate(dayStart.getDate() - i)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const count = activities.filter(a => {
      if (a.type !== type) return false
      const t = new Date(a.timestamp).getTime()
      return t >= dayStart.getTime() && t < dayEnd.getTime()
    }).length
    const dayLabel = dayStart.toLocaleDateString('en-US', { weekday: 'short' })
    days.push({ name: dayLabel, value: count })
  }
  return days
}

// ── Main Dashboard ──────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])

  // Get real counts from localStorage
  const allActivities = useMemo(() => getActivityLog(), [])
  const localProjects = useMemo(() => persistGet<any[]>('projects', []), [])
  const localHypotheses = useMemo(() => persistGet<any[]>('hypotheses', []), [])
  const localPapers = useMemo(() => persistGet<any[]>('research-papers', []), [])

  // Fetch API projects, merge with localStorage
  useEffect(() => {
    const fetchData = async () => {
      try {
        let apiProjects: Project[] = []
        try {
          const res = await api.getProjects({ page_size: 50 })
          apiProjects = res.items || []
        } catch { /* API may be unavailable */ }

        const apiIds = new Set(apiProjects.map(p => p.id))
        const localOnly = localProjects
          .filter((p: any) => p.id && !apiIds.has(p.id))
          .map((p: any) => ({
            id: p.id,
            name: p.name || 'Untitled Project',
            description: p.description,
            disease_focus: p.disease_focus,
            research_question: p.research_question,
            tags: p.tags || [],
            status: p.status || 'active',
            hypothesis_count: p.hypothesis_count || 0,
            evidence_count: p.evidence_count || 0,
            created_at: p.created_at || new Date().toISOString(),
            updated_at: p.updated_at || new Date().toISOString(),
          } as Project))

        const all = [...apiProjects, ...localOnly]
        all.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
        setProjects(all)
      } catch (e) {
        console.error('Dashboard fetch error:', e)
      }
    }
    fetchData()
  }, [localProjects])

  const totalProjects = projects.length
  const totalHypotheses = localHypotheses.length
  const totalPapers = localPapers.length

  const stats: StatData[] = [
    {
      label: 'Active Projects', value: totalProjects,
      change: computeChangePercent(allActivities, 'project'),
      icon: FiFolder, accentColor: '#a1a1a1', href: '/projects',
      chartData: buildChartData(allActivities, 'project'),
    },
    {
      label: 'Hypotheses', value: totalHypotheses,
      change: computeChangePercent(allActivities, 'hypothesis'),
      icon: FiZap, accentColor: '#a855f7', href: '/agents',
      chartData: buildChartData(allActivities, 'hypothesis'),
    },
    {
      label: 'Research Papers', value: totalPapers,
      change: computeChangePercent(allActivities, 'evidence'),
      icon: FiFileText, accentColor: '#22c55e', href: '/projects',
      chartData: buildChartData(allActivities, 'evidence'),
    },
    {
      label: 'Discoveries', value: allActivities.filter(a => a.type === 'discovery').length,
      change: computeChangePercent(allActivities, 'discovery'),
      icon: FiCpu, accentColor: '#3b82f6', href: '/agents',
      chartData: buildChartData(allActivities, 'discovery'),
    },
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
        {stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
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

      {/* Recent Projects */}
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
          <div className="grid grid-cols-3 gap-3">
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
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
