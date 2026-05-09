import { useState, useEffect, useMemo, useCallback } from 'react'
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
  FiTrendingUp,
  FiCode,
} from 'react-icons/fi'
// recharts not used in dashboard
import api from '../services/api'
import type { Project } from '../services/api'
import { persistGet, getActivityLog, type ActivityEntry } from '../utils/persistence'
import { formatTimeAgo, onTabActive, isTabActive } from '../utils/time'
import { EmptyState } from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import { toast } from '../contexts/ToastContext'

// ── Stat Card (expandable) ──────────────────────────────────────

interface StatData {
  label: string
  value: number
  icon: typeof FiFolder
  href: string
  loading?: boolean
}

function StatCard({ stat }: { stat: StatData }) {
  return (
    <Link
      to={stat.href}
      className="glass-card p-5 text-left transition-all duration-300 hover:bg-[var(--glass-bg-hover)] group block"
    >
      <div className="mb-3">
        <stat.icon className="w-5 h-5" style={{ color: 'var(--color-text-muted)' }} />
      </div>
      {stat.loading ? (
        <Skeleton width={60} height={32} style={{ marginBottom: 6 }} />
      ) : (
        <div className="text-3xl font-semibold tracking-tight mb-1">{stat.value}</div>
      )}
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
  kind: 'monte-carlo' | 'equation' | 'computational'
  stats?: { mean: number; median: number; std: number; ci95Lower: number; ci95Upper: number }
  createdAt: string
}

const SIM_TYPE_LABELS: Record<string, string> = {
  clinical_outcome: 'Clinical',
  epidemiological: 'Epidemiological',
  dose_response: 'Dose Response',
  pathway_dynamics: 'Pathway Dynamics',
  drug_interaction: 'Drug Interaction',
  survival_analysis: 'Survival Analysis',
  equation: 'Equation Plot',
  computational: 'Computational Lab',
}

const SIM_KIND_ICONS: Record<string, typeof FiActivity> = {
  'monte-carlo': FiActivity,
  equation: FiTrendingUp,
  computational: FiCode,
}

function RecentSimulationsWidget() {
  const navigate = useNavigate()
  const [simulations, setSimulations] = useState<SimulationSummary[]>([])
  const [loading, setLoading] = useState(true)
  // `stale` mirrors the ActivityFeed pattern below: API failed AND
  // local cache had something to show, so the widget is rendering
  // potentially-stale data. Surface it as a "cached" pill so the
  // user knows the live source is unreachable instead of silently
  // showing pre-deploy state forever.
  const [stale, setStale] = useState(false)
  // Surfaced when the API fails AND the local fallback is empty — the
  // pre-Stage-3 widget went silent here (loaded an empty list). Now
  // we render an explicit error card with a Retry CTA.
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // One-shot drain of pre-Round-4 localStorage collections to the
  // backend. Idempotent + sentineled; safe to call on every Dashboard
  // mount — the helper short-circuits when the per-key sentinel is
  // already set. Failures keep the source key in place for next time.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { drainLegacyLocalStorage } = await import('../utils/localStorageMigration')
        const result = await drainLegacyLocalStorage()
        if (cancelled) return
        const total = result.literature.migrated + result.papers.migrated
        if (total > 0) {
          console.info(
            `[migration] drained ${result.literature.migrated} literature ` +
            `+ ${result.papers.migrated} saved paper(s) to backend`,
          )
        }
      } catch {
        /* migration failures are non-fatal; legacy keys retry next session */
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // Gather all simulation types from localStorage. Each storage shape
    // is loose (different writers across the codebase) so we type each
    // entry as the minimal subset of fields we read here.
    type LocalMCSim = { id: string; name?: string; simulationType?: string; simulation_type?: string; stats?: SimulationSummary['stats']; createdAt?: string; created_at?: string }
    type LocalEqEntry = { id: string; expr?: string; createdAt?: string }
    type LocalCompRun = { id: string; template?: string; env?: string; createdAt?: string }
    type RemoteSim = { id: string; name?: string; simulation_type?: string; simulationType?: string; results?: { stats?: SimulationSummary['stats'] }; stats?: SimulationSummary['stats']; created_at?: string; createdAt?: string }

    const allSims: SimulationSummary[] = []

    const mcSims = persistGet<LocalMCSim[]>('mc-simulations', [])
    for (const s of mcSims) {
      allSims.push({
        id: s.id,
        name: s.name || 'Untitled Simulation',
        simulationType: s.simulationType || s.simulation_type || 'unknown',
        kind: 'monte-carlo',
        stats: s.stats,
        createdAt: s.createdAt || s.created_at || new Date().toISOString(),
      })
    }

    const eqHistory = persistGet<LocalEqEntry[]>('eq-history', [])
    for (const eq of eqHistory) {
      allSims.push({
        id: eq.id,
        name: `f(x) = ${eq.expr}`,
        simulationType: 'equation',
        kind: 'equation',
        createdAt: eq.createdAt || new Date().toISOString(),
      })
    }

    const compHistory = persistGet<LocalCompRun[]>('comp-history', [])
    for (const cr of compHistory) {
      allSims.push({
        id: cr.id,
        name: cr.template || cr.env || 'Code Run',
        simulationType: 'computational',
        kind: 'computational',
        createdAt: cr.createdAt || new Date().toISOString(),
      })
    }

    allSims.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const haveLocal = allSims.length > 0
    if (haveLocal) setSimulations(allSims.slice(0, 4))

    const fetchSimulations = async () => {
      try {
        const res = await api.getSimulations({ page_size: 3 })
        const items = ((res?.items || []) as RemoteSim[]).map((s) => ({
          id: s.id,
          name: s.name || 'Untitled Simulation',
          simulationType: s.simulation_type || s.simulationType || 'unknown',
          kind: 'monte-carlo' as const,
          stats: s.results?.stats || s.stats,
          createdAt: s.created_at || s.createdAt || new Date().toISOString(),
        }))
        if (items.length > 0) {
          setSimulations(prev => {
            const ids = new Set(items.map((i) => i.id))
            const merged = [...items, ...prev.filter(p => !ids.has(p.id))]
            merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            return merged.slice(0, 4)
          })
        }
        setStale(false)
        setError(null)
      } catch (err) {
        console.warn('Dashboard: simulations API unavailable; using local cache', err)
        // Two-branch error UX: API down + local cache empty → show
        // an error card with Retry. API down + local cache has data
        // → show data with a "cached" pill (mirrors ActivityFeed).
        if (haveLocal) {
          setStale(true)
          setError(null)
        } else {
          setError(err instanceof Error ? err.message : 'Couldn’t load simulations')
        }
      } finally {
        setLoading(false)
      }
    }
    fetchSimulations()
  }, [refreshKey])

  return (
    <div className="glass-card p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FiActivity className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-medium">Recent Simulations</h3>
          {stale && (
            <span
              className="text-xxs px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]"
              title="Live API unreachable — showing locally-cached entries"
            >
              cached
            </span>
          )}
        </div>
        <Link to="/compute-lab?tab=montecarlo" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors px-2.5 py-1 rounded-full border border-[var(--glass-border)] hover:border-[var(--color-border-strong)]">
          All <FiArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {loading && simulations.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} height={40} style={{ borderRadius: 10 }} />
          ))}
        </div>
      ) : error && simulations.length === 0 ? (
        <div role="alert" className="text-center py-4 text-[var(--color-text-muted)]">
          <FiActivity className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">Couldn’t load simulations</p>
          <p className="text-xxs mt-1 max-w-xs mx-auto opacity-80">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); setRefreshKey(k => k + 1) }}
            className="text-xs mt-2 px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors active:scale-95"
          >
            Try again
          </button>
        </div>
      ) : simulations.length === 0 ? (
        <div className="text-center py-4 text-[var(--color-text-muted)]">
          <FiActivity className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">No simulations yet</p>
          <button
            onClick={() => navigate('/compute-lab?tab=montecarlo')}
            className="text-xs mt-2 px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors active:scale-95"
          >
            Run a simulation
          </button>
        </div>
      ) : (
        <div className="space-y-0">
          {simulations.map(sim => {
            const IconComp = SIM_KIND_ICONS[sim.kind] || FiActivity
            const destTab = sim.kind === 'equation' ? 'equations'
              : sim.kind === 'computational' ? 'workstation'
              : 'montecarlo'
            const destPath = destTab === 'workstation' ? '/compute-lab' : `/compute-lab?tab=${destTab}`
            return (
              <button
                key={sim.id}
                onClick={() => navigate(destPath)}
                className="w-full text-left flex items-center gap-2.5 py-2.5 px-2 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--glass-bg-hover)] rounded-lg active:scale-95 transition-all"
              >
                <IconComp className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{sim.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xxs text-[var(--color-text-muted)]">
                      {SIM_TYPE_LABELS[sim.simulationType] || sim.simulationType}
                    </span>
                    <span className="text-xxs text-[var(--color-text-muted)]">·</span>
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
  const [loading, setLoading] = useState(true)
  // Same two-branch error UX as RecentSimulationsWidget — see the
  // commentary there for the rationale.
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    type RemoteNotebook = { id: string; title?: string; updated_at?: string; created_at?: string; tags?: string[] }
    type LocalNotebook = { id: string; title?: string; updatedAt?: string; updated_at?: string; createdAt?: string; tags?: string[] }
    let cancelled = false
    const fetchNotebooks = async () => {
      let apiError: unknown = null
      try {
        const res = await api.getNotebookPages({ page_size: 4 })
        const items = ((res?.items || []) as RemoteNotebook[]).map((p) => ({
          id: p.id,
          title: p.title || 'Untitled',
          updated_at: p.updated_at || p.created_at || '',
          tags: p.tags || [],
        }))
        if (!cancelled && items.length > 0) {
          setNotebooks(items)
          setStale(false)
          setError(null)
          return
        }
      } catch (err) {
        apiError = err
        console.warn('Dashboard: notebooks API unavailable; using local index', err)
      }
      // Fall through: API returned empty OR threw. Try the local
      // index. If that also yields nothing AND we had an API error,
      // surface the error UI; otherwise show the empty state.
      const pageIndex = persistGet<LocalNotebook[]>('notebook-index', [])
      const sorted = [...pageIndex].sort((a, b) =>
        new Date(b.updatedAt || b.updated_at || 0).getTime() - new Date(a.updatedAt || a.updated_at || 0).getTime()
      )
      const localItems = sorted.slice(0, 4).map((p) => ({
        id: p.id,
        title: p.title || 'Untitled',
        updated_at: p.updatedAt || p.updated_at || p.createdAt || '',
        tags: p.tags || [],
      }))
      if (cancelled) return
      setNotebooks(localItems)
      if (apiError && localItems.length === 0) {
        setError(apiError instanceof Error ? apiError.message : 'Couldn’t load notebooks')
        setStale(false)
      } else if (apiError && localItems.length > 0) {
        setStale(true)
        setError(null)
      } else {
        setStale(false)
        setError(null)
      }
    }
    fetchNotebooks().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey])

  return (
    <div className="glass-card p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FiBook className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-medium">Recent Notebooks</h3>
          {stale && (
            <span
              className="text-xxs px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]"
              title="Live API unreachable — showing locally-cached entries"
            >
              cached
            </span>
          )}
        </div>
        <Link to="/notebook" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors px-2.5 py-1 rounded-full border border-[var(--glass-border)] hover:border-[var(--color-border-strong)]">
          All <FiArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {loading && notebooks.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} height={40} style={{ borderRadius: 10 }} />
          ))}
        </div>
      ) : error && notebooks.length === 0 ? (
        <div role="alert" className="text-center py-4 text-[var(--color-text-muted)]">
          <FiBook className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">Couldn’t load notebooks</p>
          <p className="text-xxs mt-1 max-w-xs mx-auto opacity-80">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); setRefreshKey(k => k + 1) }}
            className="text-xs mt-2 px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors active:scale-95"
          >
            Try again
          </button>
        </div>
      ) : notebooks.length === 0 ? (
        <div className="text-center py-4 text-[var(--color-text-muted)]">
          <FiBook className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">No notebooks yet</p>
          <button
            onClick={() => navigate('/notebook')}
            className="text-xs mt-2 px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors active:scale-95"
          >
            Create a notebook
          </button>
        </div>
      ) : (
        <div className="space-y-0">
          {notebooks.map(nb => (
            <button
              key={nb.id}
              onClick={() => navigate(`/notebook?id=${encodeURIComponent(nb.id)}`)}
              className="w-full text-left flex items-center gap-2.5 py-2.5 px-2 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--glass-bg-hover)] rounded-lg active:scale-95 transition-all"
            >
              <FiBook className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-text-muted)]" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{nb.title}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {nb.tags.slice(0, 2).map(tag => (
                    <span key={tag} className="text-xxs px-1 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]">
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

// Default routes by activity type (index/list pages).
// When metadata.project_id is present we upgrade hypothesis and discovery
// entries to route to the dedicated project folder instead.
const ACTIVITY_ROUTES: Record<string, string> = {
  project: '/projects',
  hypothesis: '/agents',
  evidence: '/evidence',
  simulation: '/compute-lab?tab=montecarlo',
  notebook: '/notebook',
  discovery: '/agents',
}

/** Resolve the best navigation destination for an activity entry.
 *  If the entry carries a project_id in its metadata (discovery and
 *  hypothesis events always should), we navigate straight to that
 *  project folder so the user doesn't have to hunt for it. */
function activityDest(activity: ActivityEntry): string | undefined {
  const pid = (activity.metadata as { project_id?: string } | undefined)?.project_id
  if (pid && (activity.type === 'hypothesis' || activity.type === 'discovery')) {
    return `/projects/${pid}`
  }
  return ACTIVITY_ROUTES[activity.type]
}

const TYPE_ICONS: Record<string, typeof FiZap> = {
  hypothesis: FiZap,
  simulation: FiActivity,
  evidence: FiFileText,
  project: FiFolder,
  notebook: FiBook,
  discovery: FiCpu,
}

function ActivityFeed({ refreshKey: parentRefreshKey }: { refreshKey: number }) {
  const navigate = useNavigate()
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  // API down + local log empty → render an explicit error card with
  // a Retry CTA, mirroring the simulations + notebooks widgets.
  const [error, setError] = useState<string | null>(null)
  const [innerKey, setInnerKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const fetchActivities = async () => {
      type RemoteActivity = {
        id: string
        type?: ActivityEntry['type']
        action?: ActivityEntry['action']
        title?: string
        description?: string
        project_name?: string
        project_id?: string
        created_at?: string
        metadata?: Record<string, unknown>
      }
      let apiError: unknown = null
      try {
        const res = await api.getActivities({ page_size: 10 })
        if (cancelled) return
        const items = ((res?.items || []) as RemoteActivity[]).map((a) => ({
          id: a.id,
          type: a.type || 'project',
          action: a.action || 'created',
          title: a.title || a.description || 'Activity',
          project: a.project_name,
          timestamp: a.created_at || new Date().toISOString(),
          metadata: a.metadata || (a.project_id ? { project_id: a.project_id } : undefined),
        }))
        if (items.length > 0) {
          setActivities(items)
          setStale(false)
          setError(null)
          return
        }
      } catch (err) {
        if (cancelled) return
        apiError = err
        // Surface "stale" / "error" state below depending on whether
        // the local log has anything to show. Logged either way so a
        // dev sees the upstream symptom (auth blip / 5xx / rate-limit).
        console.warn('Dashboard: activity feed API failed; falling back to local log', err)
      }
      if (cancelled) return
      const localLog = getActivityLog().slice(0, 10)
      setActivities(localLog)
      if (apiError && localLog.length === 0) {
        setError(apiError instanceof Error ? apiError.message : 'Couldn’t load activity')
        setStale(false)
      } else if (apiError && localLog.length > 0) {
        setStale(true)
        setError(null)
      } else {
        setStale(false)
        setError(null)
      }
    }
    setLoading(true)
    fetchActivities().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [parentRefreshKey, innerKey])

  return (
    <div className="glass-card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Recent Activity</h3>
          {stale && (
            <span
              className="text-xxs px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]"
              title="Live feed unreachable — showing locally-cached entries"
            >
              cached
            </span>
          )}
        </div>
        <Link to="/timeline" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors px-2.5 py-1 rounded-full border border-[var(--glass-border)] hover:border-[var(--color-border-strong)]">
          <FiClock className="w-3 h-3" />
          Timeline
        </Link>
      </div>
      {loading && activities.length === 0 ? (
        <div className="space-y-2 flex-1">
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} height={48} style={{ borderRadius: 8 }} />
          ))}
        </div>
      ) : error && activities.length === 0 ? (
        <div role="alert" className="text-center py-8 text-[var(--color-text-muted)] flex-1 flex flex-col items-center justify-center">
          <FiClock className="w-6 h-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Couldn’t load recent activity</p>
          <p className="text-xs mt-1 max-w-xs opacity-80">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); setInnerKey(k => k + 1) }}
            className="text-xs mt-3 px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors active:scale-95"
          >
            Try again
          </button>
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-8 text-[var(--color-text-muted)] flex-1 flex flex-col items-center justify-center">
          <FiClock className="w-6 h-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No recent activity</p>
          <p className="text-xs mt-1">Start a discovery or create a project</p>
        </div>
      ) : (
        <div className="space-y-0 flex-1 overflow-y-auto">
          {activities.map((activity) => {
            const Icon = TYPE_ICONS[activity.type] || FiActivity
            const dest = activityDest(activity)
            return (
              <button
                key={activity.id}
                type="button"
                onClick={() => { if (dest) navigate(dest) }}
                disabled={!dest}
                className="w-full text-left flex items-start gap-3 py-3 border-b border-[var(--color-border)] last:border-0 group hover:bg-[var(--glass-bg-hover)] transition-colors disabled:cursor-default rounded-lg px-1"
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-[var(--color-text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{activity.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {activity.project && (
                      <span className="text-xs text-[var(--color-text-muted)]">{activity.project}</span>
                    )}
                    <span className="text-xs text-[var(--color-text-muted)]">{formatTimeAgo(activity.timestamp)}</span>
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-md flex-shrink-0 border border-[var(--glass-border)] text-[var(--color-text-muted)]">
                  {activity.action}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Dashboard ──────────────────────────────────────────────

// ── Discovery Pipeline Status ───────────────────────────────────
// Small live widget that polls /orchestrator/status every 5 s so the
// user sees whether any discovery run is in flight. Clicks straight
// into the Agents page for detail. Silently tolerates the orchestrator
// being idle (most common state).

function DiscoveryStatusWidget() {
  const [state, setState] = useState<string>('idle')
  const [stage, setStage] = useState<number | null>(null)
  const [disease, setDisease] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (!isTabActive()) return
      try {
        const s = await api.getOrchestratorStatus()
        if (cancelled) return
        const st = (s as unknown as { state?: string }).state ?? 'idle'
        setState(st)
        const cur = (s as unknown as { current_stage?: number }).current_stage
        setStage(typeof cur === 'number' ? cur : null)
        const d = (s as unknown as { disease?: string }).disease
        setDisease(typeof d === 'string' ? d : '')
      } catch {
        /* orchestrator not reachable — treat as idle, no toast spam */
      }
    }
    tick()
    const id = window.setInterval(tick, 10000)
    // Fire immediately when the tab becomes active again so the user
    // sees current state on return without waiting out the interval.
    const unsub = onTabActive(tick)
    return () => { cancelled = true; window.clearInterval(id); unsub() }
  }, [])

  const isActive = state === 'running' || state === 'paused'
  const pct = stage != null ? Math.min(100, Math.round((stage / 12) * 100)) : 0

  return (
    <Link
      to="/agents"
      className="glass-card p-4 block hover:bg-[var(--glass-bg-hover)] transition-all"
      aria-label={`Discovery pipeline ${state}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FiZap className="w-4 h-4 text-[var(--color-text-muted)]" />
          <span className="text-sm font-medium">Discovery</span>
          <span className="text-xxs px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]">
            {state}
          </span>
        </div>
        <FiChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
      </div>
      {isActive ? (
        <div className="mt-3">
          {disease && (
            <div className="text-xxs text-[var(--color-text-muted)] mb-1 truncate">
              {disease} · stage {stage ?? '—'}/12
            </div>
          )}
          {/* 12 stage ticks — monochrome (filled vs hollow) */}
          <div className="flex gap-0.5 mb-1" aria-hidden>
            {Array.from({ length: 12 }).map((_, i) => {
              const done = stage !== null && i < stage
              const current = stage !== null && i === stage
              return (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 1,
                    background: done
                      ? 'var(--color-text)'
                      : current
                      ? 'var(--color-text-secondary)'
                      : 'var(--glass-bg)',
                    transition: 'background 0.4s ease',
                  }}
                />
              )
            })}
          </div>
          <div className="text-xxs text-[var(--color-text-muted)]">
            {pct}% · multi-phase reasoning in progress
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xxs text-[var(--color-text-muted)]">
          No run in flight. Tap to start a discovery run.
        </div>
      )}
    </Link>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [simulationCount, setSimulationCount] = useState(0)
  const [countsLoading, setCountsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  // Projects-fetch error state — pre-Stage-3 this widget went silent
  // when the API failed. Now we surface a Retry CTA so the user can
  // recover without a full page reload.
  const [projectsError, setProjectsError] = useState<string | null>(null)

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.getProjects({ page_size: 50 })
      const apiProjects = res?.items || []
      apiProjects.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
      setProjects(apiProjects)
      setProjectsError(null)
    } catch (err) {
      console.warn('Dashboard: projects API unavailable', err)
      setProjectsError(err instanceof Error ? err.message : 'Couldn’t load projects')
    } finally {
      setProjectsLoading(false)
    }
  }, [])
  useEffect(() => { fetchProjects() }, [fetchProjects, refreshKey])

  useEffect(() => {
    const mcSims = persistGet<unknown[]>('mc-simulations', [])
    const eqHistory = persistGet<unknown[]>('eq-history', [])
    const compHistory = persistGet<unknown[]>('comp-history', [])
    const localCount = mcSims.length + eqHistory.length + compHistory.length
    setSimulationCount(localCount)

    const fetchSimCount = async () => {
      try {
        const res = await api.getSimulations({ page_size: 1 })
        const apiCount = res?.total || 0
        if (apiCount > localCount) setSimulationCount(apiCount)
      } catch {
        /* API unavailable — localStorage count already set */
      } finally {
        setCountsLoading(false)
      }
    }
    fetchSimCount()
  }, [refreshKey])

  // Auto-refresh when the tab becomes visible again.
  useEffect(() => onTabActive(() => setRefreshKey(k => k + 1)), [])

  const totalProjects = projects.length
  const totalHypotheses = useMemo(() => {
    return projects.reduce((sum, p) => {
      if (p.hypotheses && Array.isArray(p.hypotheses)) return sum + p.hypotheses.length
      return sum + (p.hypothesis_count || 0)
    }, 0)
  }, [projects])
  const datasetCount = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('data-manager-datasets') || '[]').length } catch { return 0 }
  }, [])
  const chartCount = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('humanovo-charts') || '[]').length } catch { return 0 }
  }, [])
  const imagingCount = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('research-imaging-studies') || '[]').length } catch { return 0 }
  }, [])

  const stats: StatData[] = [
    { label: 'Active Projects', value: totalProjects, icon: FiFolder, href: '/projects', loading: projectsLoading },
    { label: 'Simulations', value: simulationCount, icon: FiActivity, href: '/compute-lab', loading: countsLoading },
    { label: 'Datasets', value: datasetCount, icon: FiCpu, href: '/data-manager' },
    { label: 'Visualizations', value: chartCount, icon: FiTrendingUp, href: '/data-visualization' },
    { label: 'Imaging Studies', value: imagingCount, icon: FiSearch, href: '/imaging' },
    { label: 'Hypotheses', value: totalHypotheses, icon: FiZap, href: '/agents', loading: projectsLoading },
  ]

  const quickActions = [
    { label: 'Start Discovery', action: () => navigate('/agents?start=1') },
    { label: 'New Project', action: () => navigate('/projects?new=1') },
    { label: 'Compute Lab', action: () => navigate('/compute-lab') },
    { label: 'Visualize', action: () => navigate('/data-visualization') },
    { label: 'Notebook', action: () => navigate('/notebook') },
    { label: 'Search', action: () => navigate('/search') },
  ]

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Welcome back. Here's what's happening with your research.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {quickActions.map(action => (
            <button
              key={action.label}
              onClick={action.action}
              className="text-sm px-3 py-1.5 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text)] transition-colors active:scale-95"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col">
          <div className="flex-1"><ActivityFeed refreshKey={refreshKey} /></div>
        </div>

        <div className="flex flex-col gap-4 h-full">
          <DiscoveryStatusWidget />
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
          <Link to="/projects" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors px-2.5 py-1 rounded-full border border-[var(--glass-border)] hover:border-[var(--color-border-strong)]">
            View All <FiArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {projectsLoading && projects.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} height={92} style={{ borderRadius: 12 }} />
            ))}
          </div>
        ) : projectsError && projects.length === 0 ? (
          <div role="alert" className="text-center py-6">
            <FiFolder className="w-6 h-6 mx-auto mb-2 opacity-40" style={{ color: 'var(--color-text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Couldn’t load projects
            </p>
            <p className="text-xs mt-1 max-w-md mx-auto" style={{ color: 'var(--color-text-muted)', opacity: 0.8 }}>
              {projectsError}
            </p>
            <button
              onClick={() => { setProjectsLoading(true); setProjectsError(null); setRefreshKey(k => k + 1) }}
              className="text-xs mt-3 px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] transition-colors active:scale-95"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Try again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<FiFolder />}
            title="No projects yet"
            description="Projects group hypotheses, evidence, and simulations into a single research context. Start one to kick off a discovery run."
            action={{
              label: 'Create your first project',
              onClick: () => navigate('/projects?new=1'),
              ariaLabel: 'Create your first project',
            }}
            secondary={{
              label: 'Seed demo data',
              onClick: async () => {
                try {
                  const kg = await api.seedKg()
                  toast('success', kg.message, { title: 'Knowledge graph' })
                  const corp = await api.seedCorpus()
                  toast('success', corp.message, { title: 'Evidence corpus' })
                  await fetchProjects()
                } catch (e) {
                  toast('error', String(e), { title: 'Seed failed' })
                }
              },
              ariaLabel: 'Seed demo data (KG + evidence + projects)',
            }}
            fullPanel={false}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
