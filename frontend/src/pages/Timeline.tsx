import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiFolder,
  FiZap,
  FiDatabase,
  FiActivity,
  FiClock,
  FiCalendar,
  FiRefreshCw,
  FiFileText,
  FiTrash2,
  FiTrendingUp,
} from 'react-icons/fi'
import api from '../services/api'
import { formatDate, formatDateTime, type ActivityEntry } from '../utils/persistence'

type FilterType = '' | 'project' | 'hypothesis' | 'evidence' | 'simulation' | 'notebook' | 'discovery'
type TimeRange = 'today' | 'week' | 'month' | 'all'

const filterOptions: { value: FilterType; label: string; icon: typeof FiFolder }[] = [
  { value: '', label: 'All', icon: FiClock },
  { value: 'project', label: 'Projects', icon: FiFolder },
  { value: 'hypothesis', label: 'Hypotheses', icon: FiZap },
  { value: 'evidence', label: 'Evidence', icon: FiDatabase },
  { value: 'simulation', label: 'Simulations', icon: FiActivity },
  { value: 'notebook', label: 'Notebooks', icon: FiFileText },
  { value: 'discovery', label: 'Discoveries', icon: FiTrendingUp },
]

const typeIcons: Record<string, typeof FiZap> = {
  project: FiFolder, hypothesis: FiZap, evidence: FiDatabase,
  simulation: FiActivity, notebook: FiFileText, discovery: FiTrendingUp,
}

// Monochrome — icon shape + type label convey the category; status icons
// still use error/success/warning tokens for accessibility.
const typeColors: Record<string, string> = {
  project: 'var(--color-text-secondary)', hypothesis: 'var(--color-text)',
  evidence: 'var(--color-text)', simulation: 'var(--color-text-secondary)',
  notebook: 'var(--color-text-muted)', discovery: 'var(--color-text)',
}

const actionColors: Record<string, string> = {
  created: 'var(--color-text)', updated: 'var(--color-text-muted)',
  completed: 'var(--color-success)', validated: 'var(--color-success)',
  rejected: 'var(--color-error)', imported: 'var(--color-text-secondary)',
  started: 'var(--color-warning)', deleted: 'var(--color-error)',
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return formatDate(dateStr)
}

function formatMilestoneTime(dateStr: string): string {
  return formatDateTime(dateStr)
}

const MILESTONE_ACTIONS = new Set(['created', 'completed', 'validated', 'started', 'rejected'])

// Valid params for deep-link filter/range. Kept inline with `filterOptions`
// and `TimeRange` so a stale query param silently falls back to the default
// instead of picking a bogus filter state.
const VALID_FILTER_TYPES = new Set<FilterType>(['', 'project', 'hypothesis', 'evidence', 'simulation', 'notebook', 'discovery'])
const VALID_TIME_RANGES = new Set<TimeRange>(['today', 'week', 'month', 'all'])

export default function Timeline() {
  // Deep-link support: `?type=hypothesis&range=week` lets Dashboard cards
  // and external links jump into a pre-filtered view. Invalid params fall
  // back to defaults; the query is cleaned off the URL on mount so a soft
  // reload doesn't overwrite user-driven filter changes.
  const [searchParams, setSearchParams] = useSearchParams()
  const qType = searchParams.get('type') || ''
  const qRange = searchParams.get('range') || ''
  const initialFilter: FilterType = VALID_FILTER_TYPES.has(qType as FilterType) ? (qType as FilterType) : ''
  const initialRange: TimeRange = VALID_TIME_RANGES.has(qRange as TimeRange) ? (qRange as TimeRange) : 'all'

  const [filterType, setFilterType] = useState<FilterType>(initialFilter)
  const [timeRange, setTimeRange] = useState<TimeRange>(initialRange)

  // Clean the deep-link params off the URL after the initial mount.
  useEffect(() => {
    if (searchParams.has('type') || searchParams.has('range')) {
      const next = new URLSearchParams(searchParams)
      next.delete('type')
      next.delete('range')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [refreshKey, setRefreshKey] = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [allActivities, setAllActivities] = useState<ActivityEntry[]>([])
  // Track load status so the empty state can distinguish "nothing
  // logged yet" from "couldn't reach the activity API" — two
  // completely different user actions (write something vs. check
  // connectivity).
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    const load = async () => {
      setLoadState('loading')
      try {
        const dateFrom = timeRange === 'today'
          ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
          : timeRange === 'week'
            ? new Date(Date.now() - 7 * 86400000).toISOString()
            : timeRange === 'month'
              ? new Date(Date.now() - 30 * 86400000).toISOString()
              : undefined
        const res = await api.getActivities({
          page_size: 200,
          type: filterType || undefined,
          date_from: dateFrom,
        })
        const mapped: ActivityEntry[] = (res.items || []).map((a: any) => ({
          id: a.id,
          type: a.type || 'project',
          action: a.action || 'created',
          title: a.title || '',
          project: a.project_name || '',
          timestamp: a.created_at || new Date().toISOString(),
          metadata: a.metadata,
        }))
        setAllActivities(mapped)
        setLoadState('ok')
      } catch {
        setAllActivities([])
        setLoadState('error')
      }
    }
    load()
  }, [filterType, timeRange, refreshKey])

  const activities = useMemo(() => allActivities, [allActivities])

  const handleDelete = async (id: string) => {
    try {
      await api.deleteActivity(id)
    } catch { /* ignore */ }
    setDeleteConfirm(null)
    setRefreshKey(n => n + 1)
  }

  // Group by date
  const grouped = activities.reduce((acc, activity) => {
    const dateKey = new Date(activity.timestamp).toDateString()
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(activity)
    return acc
  }, {} as Record<string, ActivityEntry[]>)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Track all research activity across your projects</p>
          </div>
          <button onClick={() => setRefreshKey(n => n + 1)} className="btn text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <FiRefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-0.5 bg-[var(--glass-bg)] rounded-lg p-0.5">
            {filterOptions.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setFilterType(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${filterType === value ? 'bg-[var(--glass-bg-hover)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-[var(--color-border)]" />

          <div className="flex items-center gap-2">
            <FiCalendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <select
              value={timeRange}
              onChange={e => setTimeRange(e.target.value as TimeRange)}
              className="input text-xs py-1.5"
            >
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="all">All Time</option>
            </select>
          </div>

          <span className="text-xs text-[var(--color-text-muted)] ml-auto">{activities.length} events</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {Object.entries(grouped).length === 0 ? (
            <div className="text-center py-16">
              <FiClock className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-30" />
              {loadState === 'loading' ? (
                <>
                  <p className="text-sm text-[var(--color-text-muted)]">Loading activity…</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">Fetching from the activity log</p>
                </>
              ) : loadState === 'error' ? (
                <>
                  <p className="text-sm text-[var(--color-error)]">Couldn't reach the activity service</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">Check your connection or the API and try Refresh above.</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--color-text-muted)]">No activity found</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">Start a discovery or create a project to see activity here</p>
                </>
              )}
            </div>
          ) : (
            Object.entries(grouped).map(([dateKey, dayActivities]) => (
              <div key={dateKey} className="mb-8">
                {/* Date header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[var(--glass-bg)] flex items-center justify-center border border-[var(--color-border)]">
                    <FiCalendar className="w-4 h-4 text-[var(--color-text-muted)]" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">
                      {formatDate(dateKey)}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">{dayActivities.length} events</div>
                  </div>
                </div>

                {/* Events */}
                <div className="ml-5 border-l border-[var(--color-border)] pl-8 space-y-3">
                  {dayActivities.map(activity => {
                    const Icon = typeIcons[activity.type] || FiClock
                    const color = typeColors[activity.type] || 'var(--color-text-muted)'
                    const actionColor = actionColors[activity.action] || 'var(--color-text-muted)'
                    const isDeleting = deleteConfirm === activity.id

                    return (
                      <div key={activity.id} className="relative glass-card p-4 group transition-all">
                        {/* Timeline dot */}
                        <div className="absolute -left-[2.15rem] top-5 w-3 h-3 rounded-full border-2 border-[var(--color-bg)]" style={{ background: color }} />

                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-lg flex-shrink-0" style={{ background: `${color}12` }}>
                            <Icon className="w-4 h-4" style={{ color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <h3 className="text-sm font-medium">{activity.title}</h3>
                                {activity.project && (
                                  <p className="text-xs text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
                                    <FiFolder className="w-3 h-3" /> {activity.project}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-xs px-2 py-0.5 rounded-md" style={{ color: actionColor, background: `${actionColor}12` }}>
                                  {activity.action}
                                </span>
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => setDeleteConfirm(activity.id)}
                                    className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--glass-bg)]"
                                    title="Delete"
                                  >
                                    <FiTrash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Delete confirmation */}
                            {isDeleting && (
                              <div className="mt-2 p-3 rounded-lg border border-[var(--color-error)] bg-[rgba(239,68,68,0.05)]">
                                <p className="text-xs text-[var(--color-error)] mb-2">Delete this activity entry?</p>
                                <div className="flex gap-2">
                                  <button onClick={() => handleDelete(activity.id)} className="btn btn-sm" style={{ color: 'var(--color-error)' }}>Delete</button>
                                  <button onClick={() => setDeleteConfirm(null)} className="btn btn-sm text-[var(--color-text-muted)]">Cancel</button>
                                </div>
                              </div>
                            )}

                            {/* Metadata & time */}
                            <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-muted)]">
                              <span className="flex items-center gap-1">
                                <FiClock className="w-3 h-3" />
                                {MILESTONE_ACTIONS.has(activity.action)
                                  ? formatMilestoneTime(activity.timestamp)
                                  : formatRelativeTime(activity.timestamp)}
                              </span>
                              {activity.metadata?.confidence !== undefined && (
                                <span style={{ color: 'var(--color-text-secondary)' }}>
                                  Confidence: {Math.round(Number(activity.metadata.confidence) * 100)}%
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
