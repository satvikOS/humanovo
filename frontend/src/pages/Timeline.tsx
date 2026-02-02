import { useState } from 'react'
import {
  FiFolder,
  FiZap,
  FiDatabase,
  FiActivity,
  FiCheckCircle,
  FiClock,
  FiCalendar,
  FiRefreshCw,
  FiUser,
  FiMessageSquare
} from 'react-icons/fi'
import clsx from 'clsx'

interface TimelineEvent {
  id: string
  type: 'project' | 'hypothesis' | 'evidence' | 'simulation' | 'comment' | 'milestone'
  action: 'created' | 'updated' | 'completed' | 'validated' | 'rejected' | 'ingested' | 'started'
  title: string
  description?: string
  project?: string
  user: string
  timestamp: Date
  metadata?: Record<string, unknown>
}

type FilterType = 'all' | 'project' | 'hypothesis' | 'evidence' | 'simulation' | 'milestone'
type TimeRange = 'today' | 'week' | 'month' | 'all'

// Mock timeline data
const mockEvents: TimelineEvent[] = [
  {
    id: '1',
    type: 'hypothesis',
    action: 'created',
    title: 'BRCA1 pathway inhibition hypothesis',
    description: 'Proposed new mechanism for synthetic lethality in BRCA1-mutated tumors',
    project: 'Breast Cancer Study',
    user: 'Dr. Smith',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    metadata: { confidence: 0.72 }
  },
  {
    id: '2',
    type: 'simulation',
    action: 'completed',
    title: 'Monte Carlo simulation #47',
    description: 'Drug efficacy prediction completed with 95% confidence interval',
    project: 'Drug Response Modeling',
    user: 'System',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
    metadata: { iterations: 10000, runtime: '2h 34m' }
  },
  {
    id: '3',
    type: 'evidence',
    action: 'ingested',
    title: '23 new papers from PubMed',
    description: 'Automated ingestion of TP53-related publications from the past week',
    project: 'TP53 Research',
    user: 'System',
    timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000),
    metadata: { sources: ['PubMed'], count: 23 }
  },
  {
    id: '4',
    type: 'hypothesis',
    action: 'validated',
    title: 'MDM2-p53 interaction model',
    description: 'Hypothesis confirmed with supporting evidence from 3 independent studies',
    project: 'TP53 Research',
    user: 'Dr. Chen',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    metadata: { supportingEvidence: 12, confidence: 0.91 }
  },
  {
    id: '5',
    type: 'project',
    action: 'created',
    title: 'Immunotherapy Response Prediction',
    description: 'New project to predict patient response to checkpoint inhibitors',
    user: 'Dr. Williams',
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
  },
  {
    id: '6',
    type: 'milestone',
    action: 'completed',
    title: 'Phase 1 Data Collection Complete',
    description: 'All patient samples collected and processed for the breast cancer biomarker study',
    project: 'Breast Cancer Study',
    user: 'Dr. Smith',
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  },
  {
    id: '7',
    type: 'simulation',
    action: 'started',
    title: 'Protein folding simulation',
    description: 'Large-scale molecular dynamics simulation initiated',
    project: 'Drug Response Modeling',
    user: 'Dr. Johnson',
    timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    metadata: { estimatedRuntime: '48h' }
  },
  {
    id: '8',
    type: 'evidence',
    action: 'ingested',
    title: '156 clinical trial results added',
    description: 'Bulk import from ClinicalTrials.gov for PARP inhibitor studies',
    project: 'Breast Cancer Study',
    user: 'System',
    timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    metadata: { sources: ['ClinicalTrials.gov'], count: 156 }
  },
  {
    id: '9',
    type: 'hypothesis',
    action: 'rejected',
    title: 'ERK inhibitor synergy hypothesis',
    description: 'Insufficient evidence to support the proposed mechanism',
    project: 'Drug Response Modeling',
    user: 'Dr. Chen',
    timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    metadata: { contradictingEvidence: 5 }
  },
  {
    id: '10',
    type: 'comment',
    action: 'created',
    title: 'Review comment on BRCA pathway analysis',
    description: 'Suggested additional validation experiments for the proposed mechanism',
    project: 'Breast Cancer Study',
    user: 'Dr. Williams',
    timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  },
]

const filterOptions: { value: FilterType; label: string; icon: typeof FiFolder }[] = [
  { value: 'all', label: 'All Activity', icon: FiClock },
  { value: 'project', label: 'Projects', icon: FiFolder },
  { value: 'hypothesis', label: 'Hypotheses', icon: FiZap },
  { value: 'evidence', label: 'Evidence', icon: FiDatabase },
  { value: 'simulation', label: 'Simulations', icon: FiActivity },
  { value: 'milestone', label: 'Milestones', icon: FiCheckCircle },
]

const timeRanges: { value: TimeRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
]

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 60) return `${diffMins} minutes ago`
  if (diffHours < 24) return `${diffHours} hours ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return date.toLocaleDateString()
}

function getEventIcon(type: TimelineEvent['type']) {
  switch (type) {
    case 'project': return FiFolder
    case 'hypothesis': return FiZap
    case 'evidence': return FiDatabase
    case 'simulation': return FiActivity
    case 'comment': return FiMessageSquare
    case 'milestone': return FiCheckCircle
    default: return FiClock
  }
}

function getEventColor(type: TimelineEvent['type'], action: TimelineEvent['action']) {
  if (action === 'rejected') return 'text-error-400 bg-error-500/20'
  if (action === 'validated' || action === 'completed') return 'text-success-400 bg-success-500/20'

  switch (type) {
    case 'project': return 'text-primary-400 bg-primary-500/20'
    case 'hypothesis': return 'text-warning-400 bg-warning-500/20'
    case 'evidence': return 'text-primary-400 bg-primary-500/20'
    case 'simulation': return 'text-success-400 bg-success-500/20'
    case 'milestone': return 'text-purple-400 bg-purple-500/20'
    default: return 'text-[var(--color-text-muted)] bg-[var(--color-border)]'
  }
}

function getActionBadge(action: TimelineEvent['action']) {
  const badges: Record<string, { color: string; label: string }> = {
    created: { color: 'bg-primary-500/20 text-primary-400', label: 'Created' },
    updated: { color: 'bg-[var(--color-border)] text-[var(--color-text-muted)]', label: 'Updated' },
    completed: { color: 'bg-success-500/20 text-success-400', label: 'Completed' },
    validated: { color: 'bg-success-500/20 text-success-400', label: 'Validated' },
    rejected: { color: 'bg-error-500/20 text-error-400', label: 'Rejected' },
    ingested: { color: 'bg-primary-500/20 text-primary-400', label: 'Ingested' },
    started: { color: 'bg-warning-500/20 text-warning-400', label: 'Started' },
  }
  return badges[action] || { color: 'bg-[var(--color-border)]', label: action }
}

export default function Timeline() {
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [events] = useState<TimelineEvent[]>(mockEvents)

  // Get unique projects
  const projects = ['all', ...new Set(events.filter(e => e.project).map(e => e.project!))]

  // Filter events
  const filteredEvents = events.filter(event => {
    if (filterType !== 'all' && event.type !== filterType) return false
    if (selectedProject !== 'all' && event.project !== selectedProject) return false
    if (timeRange !== 'all') {
      const now = new Date()
      const eventDate = event.timestamp
      if (timeRange === 'today') {
        if (eventDate.toDateString() !== now.toDateString()) return false
      } else if (timeRange === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        if (eventDate < weekAgo) return false
      } else if (timeRange === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        if (eventDate < monthAgo) return false
      }
    }
    return true
  })

  // Group events by date
  const groupedEvents = filteredEvents.reduce((groups, event) => {
    const dateKey = event.timestamp.toDateString()
    if (!groups[dateKey]) groups[dateKey] = []
    groups[dateKey].push(event)
    return groups
  }, {} as Record<string, TimelineEvent[]>)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold">Discovery Timeline</h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Track all research activity across your projects
            </p>
          </div>
          <button className="btn btn-sm bg-[var(--color-border)] hover:bg-[var(--color-border-strong)]">
            <FiRefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          {/* Type Filter */}
          <div className="flex items-center gap-1 bg-[var(--color-bg)] rounded-lg p-1">
            {filterOptions.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setFilterType(value)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors',
                  filterType === value
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-[var(--color-border)]" />

          {/* Time Range */}
          <div className="flex items-center gap-2">
            <FiCalendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              className="text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5"
            >
              {timeRanges.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Project Filter */}
          <div className="flex items-center gap-2">
            <FiFolder className="w-4 h-4 text-[var(--color-text-muted)]" />
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5"
            >
              <option value="all">All Projects</option>
              {projects.filter(p => p !== 'all').map(project => (
                <option key={project} value={project}>{project}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto">
          {Object.entries(groupedEvents).map(([dateKey, dayEvents]) => (
            <div key={dateKey} className="mb-8">
              {/* Date Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[var(--color-border)] flex items-center justify-center">
                  <FiCalendar className="w-5 h-5 text-[var(--color-text-muted)]" />
                </div>
                <div>
                  <div className="text-sm font-medium">
                    {new Date(dateKey).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {dayEvents.length} events
                  </div>
                </div>
              </div>

              {/* Events */}
              <div className="ml-5 border-l-2 border-[var(--color-border)] pl-8 space-y-4">
                {dayEvents.map(event => {
                  const Icon = getEventIcon(event.type)
                  const colorClass = getEventColor(event.type, event.action)
                  const actionBadge = getActionBadge(event.action)

                  return (
                    <div
                      key={event.id}
                      className="relative card hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
                    >
                      {/* Timeline dot */}
                      <div className={clsx(
                        'absolute -left-[2.85rem] top-4 w-4 h-4 rounded-full border-2 border-[var(--color-bg-elevated)]',
                        colorClass
                      )} />

                      <div className="flex items-start gap-3">
                        <div className={clsx('p-2 rounded', colorClass)}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="text-sm font-medium">{event.title}</h3>
                              {event.description && (
                                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                  {event.description}
                                </p>
                              )}
                            </div>
                            <span className={clsx('text-xxs px-1.5 py-0.5 rounded flex-shrink-0', actionBadge.color)}>
                              {actionBadge.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-muted)]">
                            {event.project && (
                              <span className="flex items-center gap-1">
                                <FiFolder className="w-3 h-3" />
                                {event.project}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <FiUser className="w-3 h-3" />
                              {event.user}
                            </span>
                            <span className="flex items-center gap-1">
                              <FiClock className="w-3 h-3" />
                              {formatRelativeTime(event.timestamp)}
                            </span>
                          </div>
                          {event.metadata && (
                            <div className="flex items-center gap-3 mt-2 text-xs">
                              {event.metadata.confidence !== undefined && (
                                <span className="text-warning-400">
                                  Confidence: {Math.round(Number(event.metadata.confidence) * 100)}%
                                </span>
                              )}
                              {event.metadata.count !== undefined && (
                                <span className="text-primary-400">
                                  {String(event.metadata.count)} items
                                </span>
                              )}
                              {event.metadata.iterations !== undefined && (
                                <span className="text-success-400">
                                  {Number(event.metadata.iterations).toLocaleString()} iterations
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {filteredEvents.length === 0 && (
            <div className="text-center py-12">
              <FiClock className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
              <p className="text-[var(--color-text-muted)]">
                No activity found for the selected filters
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                Try adjusting your filters to see more events
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
