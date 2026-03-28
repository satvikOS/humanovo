import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FiFolder,
  FiZap,
  FiActivity,
  FiFileText,
  FiClock,
  FiArrowRight,
  FiSearch,
  FiBook,
  FiChevronRight,
  FiCpu,
} from 'react-icons/fi'
// recharts not used in dashboard
import api from '../services/api'
import type { Project } from '../services/api'
import { persistGet, getActivityLog, type ActivityEntry } from '../utils/persistence'

// ── Stat Card (expandable) ──────────────────────────────────────

interface StatData {
  label: string
  value: number
  icon: typeof FiFolder
  accentColor: string
  href: string
}

function StatCard({ stat }: { stat: StatData }) {
  return (
    <Link
      to={stat.href}
      className="glass-card p-5 text-left transition-all duration-300 hover:bg-[var(--glass-bg-hover)] group block"
    >
      <div className="mb-3">
        <stat.icon className="w-5 h-5" style={{ color: stat.accentColor }} />
      </div>
      <div className="text-3xl font-semibold tracking-tight mb-1">{stat.value}</div>
      <div className="text-sm text-[var(--color-text-muted)]">{stat.label}</div>

      <div className="flex items-center gap-1 mt-2 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
        View details <FiChevronRight className="w-3 h-3" />
      </div>
    </Link>
  )
}

// ── Recent Simulations ──────────────────────────────────────────

interface SimulationSummary {
  id: string
  name: string
  simulationType: string
  stats: { mean: number; median: number; std: number; ci95Lower: number; ci95Upper: number }
  createdAt: string
}

const SIM_TYPE_LABELS: Record<string, string> = {
  clinical_outcome: 'Clinical',
  epidemiological: 'Epidemiological',
  dose_response: 'Dose Response',
  pathway_dynamics: 'Pathway Dynamics',
  drug_interaction: 'Drug Interaction',
  survival_analysis: 'Survival Analysis',
}

const SIM_TYPE_COLORS: Record<string, string> = {
  clinical_outcome: 'var(--color-accent-green)',
  epidemiological: 'var(--color-accent-blue)',
  dose_response: 'var(--color-accent-purple)',
  pathway_dynamics: 'var(--color-accent-orange)',
  drug_interaction: 'var(--color-accent-cyan)',
  survival_analysis: '#ef4444',
}

function formatTimeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function RecentSimulationsWidget() {
  const navigate = useNavigate()
  const [simulations, setSimulations] = useState<SimulationSummary[]>([])

  useEffect(() => {
    // Load from localStorage first for instant display
    const cached = persistGet<SimulationSummary[]>('mc-simulations', [])
    if (cached.length > 0) {
      setSimulations(cached.slice(0, 3).map((s: any) => ({
        id: s.id,
        name: s.name || 'Untitled Simulation',
        simulationType: s.simulationType || s.simulation_type || 'unknown',
        stats: s.stats || { mean: 0, median: 0, std: 0, ci95Lower: 0, ci95Upper: 0 },
        createdAt: s.createdAt || s.created_at || new Date().toISOString(),
      })))
    }
    // Also try API
    const fetchSimulations = async () => {
      try {
        const res = await api.getSimulations({ page_size: 3 })
        const items = (res?.items || []).map((s: any) => ({
          id: s.id,
          name: s.name || 'Untitled Simulation',
          simulationType: s.simulation_type || s.simulationType || 'unknown',
          stats: s.results?.stats || s.stats || { mean: 0, median: 0, std: 0, ci95Lower: 0, ci95Upper: 0 },
          createdAt: s.created_at || s.createdAt || new Date().toISOString(),
        }))
        if (items.length > 0) setSimulations(items)
      } catch {
        // API unavailable — localStorage data is already displayed
      }
    }
    fetchSimulations()
  }, [])

  return (
    <div className="glass-card p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FiActivity className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-medium">Recent Simulations</h3>
        </div>
        <Link to="/simulations?tab=history" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors">
          All <FiArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {simulations.length === 0 ? (
        <div className="text-center py-4 text-[var(--color-text-muted)]">
          <FiActivity className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">No simulations yet</p>
          <button onClick={() => navigate('/simulations?tab=history')} className="text-xs mt-1 text-[var(--color-text)] hover:text-[var(--color-text-secondary)] transition-colors">
            Run a simulation
          </button>
        </div>
      ) : (
        <div className="space-y-0">
          {simulations.map(sim => {
            const color = SIM_TYPE_COLORS[sim.simulationType] || 'var(--color-text-muted)'
            return (
              <button
                key={sim.id}
                onClick={() => navigate('/simulations')}
                className="w-full text-left flex items-center gap-2.5 py-2.5 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--glass-bg)] rounded-lg px-2 transition-all"
              >
                <FiActivity className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{sim.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xxs px-1 py-0.5 rounded" style={{ color, background: `${color}12` }}>
                      {SIM_TYPE_LABELS[sim.simulationType] || sim.simulationType}
                    </span>
                    <span className="text-xxs text-[var(--color-text-muted)]">{formatTimeAgo(sim.createdAt)}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Recent Notebooks ────────────────────────────────────────────

interface NotebookSummary {
  id: string
  title: string
  updated_at: string
  tags: string[]
}

function RecentNotebooksWidget() {
  const navigate = useNavigate()
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([])

  useEffect(() => {
    const fetchNotebooks = async () => {
      try {
        const res = await api.getNotebookPages({ page_size: 4 })
        const items = (res?.items || []).map((p: any) => ({
          id: p.id,
          title: p.title || 'Untitled',
          updated_at: p.updated_at || p.created_at || '',
          tags: p.tags || [],
        }))
        if (items.length > 0) {
          setNotebooks(items)
          return
        }
      } catch { /* API unavailable, fall back to local */ }
      // Fallback to localStorage notebook index
      const pageIndex = persistGet<any[]>('notebook-index', [])
      const sorted = [...pageIndex].sort((a, b) =>
        new Date(b.updatedAt || b.updated_at || 0).getTime() - new Date(a.updatedAt || a.updated_at || 0).getTime()
      )
      setNotebooks(sorted.slice(0, 4).map((p: any) => ({
        id: p.id,
        title: p.title,
        updated_at: p.updatedAt || p.updated_at || p.createdAt || '',
        tags: p.tags || [],
      })))
    }
    fetchNotebooks()
  }, [])

  return (
    <div className="glass-card p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FiBook className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-medium">Recent Notebooks</h3>
        </div>
        <Link to="/notebook" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors">
          All <FiArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {notebooks.length === 0 ? (
        <div className="text-center py-4 text-[var(--color-text-muted)]">
          <FiBook className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">No notebooks yet</p>
          <button onClick={() => navigate('/notebook')} className="text-xs mt-1 text-[var(--color-text)] hover:text-[var(--color-text-secondary)] transition-colors">
            Create a notebook
          </button>
        </div>
      ) : (
        <div className="space-y-0">
          {notebooks.map(nb => (
            <button
              key={nb.id}
              onClick={() => navigate('/notebook')}
              className="w-full text-left flex items-center gap-2.5 py-2.5 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--glass-bg)] rounded-lg px-2 transition-all"
            >
              <div className="p-1 rounded-md flex-shrink-0" style={{ background: 'rgba(249, 115, 22, 0.08)' }}>
                <FiBook className="w-3 h-3" style={{ color: 'var(--color-accent-orange)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{nb.title}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {nb.tags.slice(0, 2).map(tag => (
                    <span key={tag} className="text-xxs px-1 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                      {tag}
                    </span>
                  ))}
                  <span className="text-xxs text-[var(--color-text-muted)]">{formatTimeAgo(nb.updated_at)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Activity Feed ──────────────────────────────────────────────

function ActivityFeed() {
  const [activities, setActivities] = useState<ActivityEntry[]>([])

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const res = await api.getActivities({ page_size: 10 })
        const items = (res?.items || []).map((a: any) => ({
          id: a.id,
          type: a.type || 'project',
          action: a.action || 'created',
          title: a.title || a.description || 'Activity',
          project: a.project_name,
          timestamp: a.created_at || new Date().toISOString(),
        }))
        if (items.length > 0) {
          setActivities(items)
          return
        }
      } catch { /* API unavailable, fall back to local */ }
      setActivities(getActivityLog().slice(0, 10))
    }
    fetchActivities()
  }, [])

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
    <div className="glass-card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h3 className="text-sm font-medium">Recent Activity</h3>
        <Link to="/timeline" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors">
          <FiClock className="w-3 h-3" />
          Timeline
        </Link>
      </div>
      {activities.length === 0 ? (
        <div className="text-center py-8 text-[var(--color-text-muted)] flex-1 flex flex-col items-center justify-center">
          <FiClock className="w-6 h-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No recent activity</p>
          <p className="text-xs mt-1">Start a discovery or create a project</p>
        </div>
      ) : (
        <div className="space-y-0 flex-1 overflow-y-auto">
          {activities.map((activity) => {
            const Icon = typeIcons[activity.type] || FiActivity
            const color = typeColors[activity.type] || 'var(--color-text-muted)'
            return (
              <div key={activity.id} className="flex items-start gap-3 py-3 border-b border-[var(--color-border)] last:border-0 group">
                <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color }} />
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

// ── Main Dashboard ──────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])

  const [simulationCount, setSimulationCount] = useState(0)

  // Fetch API projects (no localStorage fallback)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await api.getProjects({ page_size: 50 })
        const apiProjects = res?.items || []
        apiProjects.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
        setProjects(apiProjects)
      } catch (err) {
        console.warn('Dashboard: projects API unavailable', err)
      }
    }
    fetchData()
  }, [])

  // Fetch simulation count from localStorage + API
  useEffect(() => {
    // Instant count from localStorage
    const cached = persistGet<unknown[]>('mc-simulations', [])
    if (cached.length > 0) setSimulationCount(cached.length)
    const fetchSimCount = async () => {
      try {
        const res = await api.getSimulations({ page_size: 1 })
        const apiCount = res?.total || 0
        if (apiCount > 0) setSimulationCount(apiCount)
      } catch {
        // API unavailable — localStorage count already set
      }
    }
    fetchSimCount()
  }, [])

  // Derive counts from actual project data for accuracy
  const totalProjects = projects.length
  // Count hypotheses from projects' own hypothesis arrays/counts
  const totalHypotheses = useMemo(() => {
    return projects.reduce((sum, p) => {
      if (p.hypotheses && Array.isArray(p.hypotheses)) return sum + p.hypotheses.length
      return sum + (p.hypothesis_count || 0)
    }, 0)
  }, [projects])
  // Count research papers from project evidence counts
  const totalPapers = useMemo(() => {
    return projects.reduce((sum, p) => sum + (p.evidence_count || 0), 0)
  }, [projects])

  const stats: StatData[] = [
    { label: 'Active Projects', value: totalProjects, icon: FiFolder, accentColor: '#a1a1a1', href: '/projects' },
    { label: 'Hypotheses', value: totalHypotheses, icon: FiZap, accentColor: '#a855f7', href: '/agents' },
    { label: 'Research Papers', value: totalPapers, icon: FiFileText, accentColor: '#22c55e', href: '/projects' },
    { label: 'Simulations', value: simulationCount, icon: FiActivity, accentColor: '#3b82f6', href: '/simulations' },
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
        {/* Activity Feed - spans 2 cols, stretch to match right column */}
        <div className="col-span-2 flex flex-col">
          <div className="flex-1"><ActivityFeed /></div>
        </div>

        {/* Recent Simulations + Notebooks — fill height equally */}
        <div className="flex flex-col gap-4 h-full">
          <div className="flex-1 min-h-0">
            <RecentSimulationsWidget />
          </div>
          <div className="flex-1 min-h-0">
            <RecentNotebooksWidget />
          </div>
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
                  </div>
                  <FiChevronRight className="w-3.5 h-3.5 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
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
