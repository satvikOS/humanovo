import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  FiPlus, FiFolder, FiX, FiTrash2, FiSearch, FiRefreshCw,
  FiGrid, FiList, FiFilter, FiChevronDown,
  FiTarget, FiClock,
  FiTag, FiCalendar, FiArchive, FiCheckSquare, FiSquare,
} from 'react-icons/fi'
import clsx from 'clsx'
import api, { Project, ProjectCreate } from '../services/api'
import { logActivity } from '../utils/persistence'
import { formatTimeAgo } from '../utils/time'
import { Skeleton } from '../components/Skeleton'
import { toast } from '../contexts/ToastContext'
import { modalBackdropProps } from '../utils/clickable'

type ViewMode = 'grid' | 'list'
type SortOption = 'recent' | 'name' | 'hypotheses' | 'status'
type StatusFilter = 'all' | 'active' | 'paused' | 'completed' | 'archived'


/* ─── Stats Bar ─────────────────────────────────────────────────────── */

function StatsBar({ projects, totalDocs }: { projects: Project[]; totalDocs: number }) {
  const totalHypotheses = projects.reduce((sum, p) => sum + (p.hypothesis_count || 0), 0)
  const totalEvidence = projects.reduce((sum, p) => sum + (p.evidence_count || 0), 0) + totalDocs
  const activeCount = projects.filter(p => (p.status || 'active') === 'active').length
  const archivedCount = projects.filter(p => (p.status || 'active') === 'archived').length

  // Saved research papers come from the durable backend (Round 4b). The
  // count starts at 0 while the request is in flight; the StatsBar
  // re-renders when the request resolves so the user briefly sees a
  // 0 but never a stale count from a different account.
  const [paperCount, setPaperCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    api.listSavedPapers({ limit: 500 })
      .then(rows => { if (!cancelled) setPaperCount(rows.length) })
      .catch(() => { /* leave at 0 if endpoint unreachable */ })
    return () => { cancelled = true }
  }, [])

  const stats = [
    { label: 'Total', value: projects.length },
    { label: 'Active', value: activeCount },
    { label: 'Archived', value: archivedCount },
    { label: 'Hypotheses', value: totalHypotheses },
    { label: 'Evidence', value: totalEvidence },
    { label: 'Papers', value: paperCount },
  ]

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
      {stats.map(stat => (
        <div key={stat.label} className="glass-card p-3">
          <div className="text-xl font-semibold tracking-tight">{stat.value}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{stat.label}</div>
        </div>
      ))}
    </div>
  )
}

/* ─── Create Modal ──────────────────────────────────────────────────── */

function CreateProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (project: ProjectCreate) => Promise<string | true> }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    disease_focus: '',
    research_question: '',
    tags: [] as string[],
  })
  const [tagInput, setTagInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      const result = await onCreate({
        name: formData.name,
        description: formData.description || undefined,
        disease_focus: formData.disease_focus || undefined,
        research_question: formData.research_question || undefined,
        tags: formData.tags,
      })
      if (result === true) onClose()
      else setError(typeof result === 'string' ? result : 'Failed to create project. Open browser console (F12) for details.')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create project. Open browser console (F12) for details.'
      setError(msg)
    } finally {
      setCreating(false)
    }
  }

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] })
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) })
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      aria-modal="true"
      aria-labelledby="new-project-title"
      {...modalBackdropProps(onClose)}
    >
      <div className="glass-card w-full max-w-lg mx-4 p-0 animate-in fade-in zoom-in-95 duration-200" role="dialog" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/5 rounded-lg">
              <FiPlus className="w-4 h-4 text-[var(--color-text)]" />
            </div>
            <h2 id="new-project-title" className="text-lg font-semibold">New Research Project</h2>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-1 rounded hover:bg-white/5 transition-colors">
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              Project Name <span className="text-[var(--color-text-muted)]" aria-label="required">*</span>
            </label>
            <input
              type="text"
              className="input w-full"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., BRCA1 Prevention Strategies"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              Disease Focus
            </label>
            <input
              type="text"
              className="input w-full"
              value={formData.disease_focus}
              onChange={e => setFormData({ ...formData, disease_focus: e.target.value })}
              placeholder="e.g., Breast Cancer, Alzheimer's Disease"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              Description
            </label>
            <textarea
              className="input w-full h-24 resize-none"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the research project..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              Research Question
            </label>
            <textarea
              className="input w-full h-20 resize-none"
              value={formData.research_question}
              onChange={e => setFormData({ ...formData, research_question: e.target.value })}
              placeholder="What are you trying to discover or prove?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              Tags
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Add tag..."
              />
              <button type="button" onClick={addTag} className="btn text-[var(--color-text-secondary)] hover:text-white px-3">
                Add
              </button>
            </div>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center px-2.5 py-1 bg-white/5 rounded-full text-sm text-[var(--color-text-secondary)]">
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="ml-1.5 text-[var(--color-text-muted)] hover:text-white">
                      <FiX className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-[var(--color-text-muted)]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button type="button" onClick={onClose} className="btn text-[var(--color-text-secondary)] hover:text-white px-4 py-2" disabled={creating}>
              Cancel
            </button>
            <button type="submit" className="btn text-[var(--color-text)] hover:bg-white/5 px-4 py-2 font-medium" disabled={creating || !formData.name.trim()}>
              {creating ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  Creating...
                </span>
              ) : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Project Card (Grid) ──────────────────────────────────────────── */

// Auto-generated / system tags that we filter out of the user-facing tag
// chips. The /\d+-stage-pipeline/ pattern catches stale tags from earlier
// pipeline versions without hardcoding the specific stage counts.
const NOISE_TAG_LITERALS = new Set([
  'AI generated', 'ai-generated',
  'well-grounded', 'partially-grounded', 'needs-grounding',
])
const NOISE_TAG_PATTERN = /^\d+-stage-pipeline$/
function isNoiseTag(tag: string): boolean {
  return NOISE_TAG_LITERALS.has(tag) || NOISE_TAG_PATTERN.test(tag)
}

interface CardProps {
  project: Project
  onDelete: (id: string) => void
  onArchive: (id: string, restore: boolean) => void
  docCount?: number
  selectMode: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  paperCount?: number
}

function SelectBox({ selected, onClick }: { selected: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      aria-label={selected ? 'Deselect project' : 'Select project'}
    >
      {selected ? <FiCheckSquare className="w-4 h-4" /> : <FiSquare className="w-4 h-4" />}
    </button>
  )
}

function ProjectCardGrid({ project, onDelete, onArchive, selectMode, selected, onToggleSelect, paperCount = 0, docCount = 0 }: CardProps) {
  const isArchived = (project.status || 'active') === 'archived'
  const visibleTags = (project.tags || []).filter(t => !isNoiseTag(t))

  return (
    <div
      className={clsx(
        'glass-card transition-all duration-200 group relative overflow-hidden',
        selected && 'ring-1 ring-[var(--color-border-strong)]',
        isArchived && 'opacity-60',
      )}
    >
      <Link to={`/projects/${project.id}`} className="block p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {selectMode && (
              <SelectBox
                selected={selected}
                onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleSelect(project.id) }}
              />
            )}
            <FiFolder className="w-5 h-5 text-[var(--color-text-muted)] flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--color-text)] truncate">{project.name}</h3>
              {project.disease_focus && (
                <p className="text-[var(--color-text-muted)] text-sm truncate">{project.disease_focus}</p>
              )}
            </div>
          </div>
          {isArchived && (
            <span className="text-xxs px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]">
              archived
            </span>
          )}
        </div>

        {project.description && (
          <p className="text-[var(--color-text-muted)] text-sm line-clamp-2 mb-4 leading-relaxed">
            {project.description}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center p-2 rounded-lg border border-[var(--glass-border)]">
            <div className="text-sm font-semibold">{project.hypothesis_count || 0}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Hypotheses</div>
          </div>
          <div className="text-center p-2 rounded-lg border border-[var(--glass-border)]">
            <div className="text-sm font-semibold">{(project.evidence_count || 0) + docCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Evidence</div>
          </div>
          <div className="text-center p-2 rounded-lg border border-[var(--glass-border)]">
            <div className="text-sm font-semibold">{paperCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Papers</div>
          </div>
        </div>

        {visibleTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {visibleTags.slice(0, 5).map(tag => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--glass-border)] text-[var(--color-text-muted)]">
                {tag}
              </span>
            ))}
            {visibleTags.length > 5 && (
              <span className="text-[var(--color-text-muted)] text-xs self-center">+{visibleTags.length - 5}</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
          <span className="text-[var(--color-text-muted)] text-xs flex items-center gap-1">
            <FiClock className="w-3 h-3" />
            {formatTimeAgo(project.updated_at)}
          </span>
          <FiChevronDown className="w-3.5 h-3.5 text-[var(--color-text-muted)] -rotate-90" />
        </div>
      </Link>

      {/* Row actions: Archive + Delete. Shown on hover or always in select mode. */}
      {!selectMode && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onArchive(project.id, isArchived) }}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg-hover)] transition-colors"
            title={isArchived ? 'Restore project' : 'Archive project'}
            aria-label={isArchived ? 'Restore project' : 'Archive project'}
          >
            <FiArchive className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(project.id) }}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete project"
            aria-label="Delete project"
          >
            <FiTrash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── Project Row (List) ───────────────────────────────────────────── */

function ProjectCardList({ project, onDelete, onArchive, selectMode, selected, onToggleSelect, paperCount = 0, docCount = 0 }: CardProps) {
  const isArchived = (project.status || 'active') === 'archived'

  return (
    <div
      className={clsx(
        'glass-card transition-all group',
        selected && 'ring-1 ring-[var(--color-border-strong)]',
        isArchived && 'opacity-60',
      )}
    >
      <Link to={`/projects/${project.id}`} className="flex items-center gap-4 p-4">
        {selectMode && (
          <SelectBox
            selected={selected}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleSelect(project.id) }}
          />
        )}
        <FiFolder className="w-5 h-5 text-[var(--color-text-muted)] flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-0.5">
            <h3 className="font-semibold text-[var(--color-text)] truncate">{project.name}</h3>
            {isArchived && (
              <span className="text-xxs px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)]">
                archived
              </span>
            )}
          </div>
          {project.disease_focus && (
            <p className="text-[var(--color-text-muted)] text-sm truncate">{project.disease_focus}</p>
          )}
        </div>

        <div className="flex items-center gap-6 flex-shrink-0 text-sm">
          <div className="text-center w-16">
            <div className="font-semibold">{project.hypothesis_count || 0}</div>
            <div className="text-[10px] text-[var(--color-text-muted)]">Hyp.</div>
          </div>
          <div className="text-center w-16">
            <div className="font-semibold">{(project.evidence_count || 0) + docCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)]">Evidence</div>
          </div>
          <div className="text-center w-16">
            <div className="font-semibold">{paperCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)]">Papers</div>
          </div>
          <span className="text-[var(--color-text-muted)] text-xs w-24 text-right">
            {formatTimeAgo(project.updated_at)}
          </span>
        </div>

        {!selectMode && (
          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onArchive(project.id, isArchived) }}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg-hover)] transition-colors"
              title={isArchived ? 'Restore' : 'Archive'}
              aria-label={isArchived ? 'Restore project' : 'Archive project'}
            >
              <FiArchive className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(project.id) }}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete"
              aria-label="Delete project"
            >
              <FiTrash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </Link>
    </div>
  )
}

/* ─── Main Projects Page ───────────────────────────────────────────── */

// Enum-guard helpers so bogus deep-link values silently fall back to
// sensible defaults instead of blank-screening the filter UI.
const VALID_STATUS_FILTERS: ReadonlySet<StatusFilter> = new Set(['all', 'active', 'paused', 'completed', 'archived'])
const VALID_VIEW_MODES: ReadonlySet<ViewMode> = new Set(['grid', 'list'])

export default function Projects() {
  const [searchParams] = useSearchParams()
  // Auto-open the Create modal when we arrive via /projects?new=1. This
  // is the target of every "New Project" shortcut on the dashboard and
  // in empty states; without this the button navigated here but then
  // forced the user to click "New Project" a second time.
  const [showCreateModal, setShowCreateModal] = useState(() => searchParams.get('new') === '1')
  // Seed search, view, and status filters from ?q=, ?view=, ?status=
  // so that cross-page links (e.g. from Dashboard or Search) preserve
  // user intent on arrival. All params are consume-and-cleaned below.
  const initialQuery = searchParams.get('q') || ''
  const initialViewRaw = (searchParams.get('view') || '').toLowerCase() as ViewMode
  const initialStatusRaw = (searchParams.get('status') || '').toLowerCase() as StatusFilter
  const initialView: ViewMode = VALID_VIEW_MODES.has(initialViewRaw)
    ? initialViewRaw
    : ((localStorage.getItem('humanovo-projects-view') as ViewMode) || 'grid')
  const initialStatus: StatusFilter = VALID_STATUS_FILTERS.has(initialStatusRaw) ? initialStatusRaw : 'all'
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    let changed = false
    for (const key of ['new', 'q', 'view', 'status']) {
      if (sp.has(key)) { sp.delete(key); changed = true }
    }
    if (changed) {
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
  }, [])  
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState(initialQuery)
  const [viewMode, setViewMode] = useState<ViewMode>(initialView)
  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus)
  const [showFilters, setShowFilters] = useState(false)
  const [diseaseFocusFilter, setDiseaseFocusFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d' | '1y'>('all')
  // paperCountByProject: per-project saved-paper count, fetched once on
  // mount from /api/v1/saved-papers and indexed by project_id. Empty
  // until the request resolves; cards default to 0 in the meantime.
  const [paperCountByProject, setPaperCountByProject] = useState<Record<string, number>>({})
  // docCountByProject: per-project document count, fetched once on
  // mount from /api/v1/project-documents (Round 4f). Same pattern as
  // paperCountByProject — empty until the request resolves.
  const [docCountByProject, setDocCountByProject] = useState<Record<string, number>>({})

  useEffect(() => {
    loadProjects()
    // loadProjects depends on searchQuery which is dynamic, but the
    // explicit reload-on-search lives in the search-input useEffect
    // below; the mount-time call here only needs to fire once. Adding
    // loadProjects to the dep array would re-fire on every searchQuery
    // change and double-load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    api.listSavedPapers({ limit: 500 })
      .then(rows => {
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const r of rows) {
          if (r.project_id) counts[r.project_id] = (counts[r.project_id] || 0) + 1
        }
        setPaperCountByProject(counts)
      })
      .catch(() => { /* leave map empty if endpoint unreachable */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.listProjectDocuments({ limit: 1000 })
      .then(rows => {
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const r of rows) {
          counts[r.project_id] = (counts[r.project_id] || 0) + 1
        }
        setDocCountByProject(counts)
      })
      .catch(() => { /* leave map empty if endpoint unreachable */ })
    return () => { cancelled = true }
  }, [])

  const totalDocCount = useMemo(
    () => Object.values(docCountByProject).reduce((a, b) => a + b, 0),
    [docCountByProject],
  )

  useEffect(() => {
    localStorage.setItem('humanovo-projects-view', viewMode)
  }, [viewMode])

  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking')
  const [apiError, setApiError] = useState<string>('')

  const loadProjects = async () => {
    try {
      setLoading(true)
      const res = await api.getProjects({ page_size: 50, search: searchQuery || undefined })
      const apiProjects = res.items || []
      apiProjects.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
      setProjects(apiProjects)
      setApiStatus('connected')
    } catch (err: unknown) {
      console.error('Failed to load projects:', err)
      setApiStatus('error')
      const e = err as { response?: { status?: number; headers?: Record<string, string>; data?: { detail?: string } }; message?: string }
      const status = e?.response?.status
      const ct = e?.response?.headers?.['content-type'] || ''
      if (ct.includes('text/html')) {
        setApiError('API Gateway not connected — CloudFront returning HTML instead of JSON. Run deploy-infra workflow.')
      } else if (status) {
        setApiError(`API returned ${status}: ${e?.response?.data?.detail || e?.message}`)
      } else {
        setApiError(`Cannot reach API: ${e?.message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (data: ProjectCreate): Promise<string | true> => {
    try {
      const project = await api.createProject(data)
      setProjects(prev => [project, ...prev])
      logActivity({ type: 'project', action: 'created', title: `Created project: ${project.name || data.name}`, project: project.name || data.name })
      return true
    } catch (err: unknown) {
      // Extract the real error for debugging
      const e = err as { response?: { status?: number; data?: { detail?: string; message?: string } }; message?: string }
      const status = e?.response?.status
      const detail = e?.response?.data?.detail || e?.response?.data?.message || e?.message || String(err)
      const msg = status
        ? `API error ${status}: ${detail}`
        : `Network error: ${detail}`
      console.error('Failed to create project:', msg, err)
      return msg
    }
  }

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleDeleteRequest = (id: string) => setDeleteConfirmId(id)

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return
    const id = deleteConfirmId
    setDeleteConfirmId(null)
    try {
      const deletedProject = projects.find(p => p.id === id)
      await api.deleteProject(id)
      setProjects(prev => prev.filter(p => p.id !== id))
      logActivity({ type: 'project', action: 'deleted', title: `Deleted project: ${deletedProject?.name || 'Unknown'}`, project: deletedProject?.name })
      toast('success', `Deleted ${deletedProject?.name || 'project'}`)
    } catch (err: unknown) {
      console.error('Failed to delete project:', err)
      const msg = err instanceof Error ? err.message : 'Delete failed'
      toast('error', msg, { title: 'Could not delete' })
    }
  }

  const handleArchive = useCallback(async (id: string, restore: boolean) => {
    const previous = projects.find(p => p.id === id)
    try {
      const updated = await api.archiveProject(id, restore)
      setProjects(prev => prev.map(p => p.id === id ? { ...p, status: updated.status } : p))
      logActivity({
        type: 'project',
        action: restore ? 'updated' : 'updated',
        title: `${restore ? 'Restored' : 'Archived'}: ${previous?.name || 'project'}`,
        project: previous?.name,
      })
      toast('success', `${restore ? 'Restored' : 'Archived'} ${previous?.name || 'project'}`)
    } catch (err: unknown) {
      console.error('Failed to archive project:', err)
      const msg = err instanceof Error ? err.message : 'Archive failed'
      toast('error', msg, { title: 'Could not archive' })
    }
  }, [projects])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const handleBulkArchive = useCallback(async (restore: boolean) => {
    const ids = [...selectedIds]
    if (!ids.length) return
    try {
      const res = await api.bulkArchiveProjects(ids, restore)
      const updatedSet = new Set(res.updated)
      setProjects(prev => prev.map(p => updatedSet.has(p.id) ? { ...p, status: res.status } : p))
      toast('success', `${restore ? 'Restored' : 'Archived'} ${res.updated_count} project${res.updated_count === 1 ? '' : 's'}`)
      exitSelectMode()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bulk archive failed'
      toast('error', msg, { title: 'Could not archive' })
    }
  }, [selectedIds, exitSelectMode])

  const handleBulkDeleteConfirm = useCallback(async () => {
    const ids = [...selectedIds]
    if (!ids.length) return
    setBulkDeleteConfirm(false)
    try {
      const res = await api.bulkDeleteProjects(ids)
      const deletedSet = new Set(res.deleted)
      setProjects(prev => prev.filter(p => !deletedSet.has(p.id)))
      toast('success', `Deleted ${res.deleted_count} project${res.deleted_count === 1 ? '' : 's'}`)
      exitSelectMode()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bulk delete failed'
      toast('error', msg, { title: 'Could not delete' })
    }
  }, [selectedIds, exitSelectMode])

  // Collect unique disease focuses and tags for filter dropdowns
  const uniqueDiseaseFocuses = useMemo(() => {
    const set = new Set<string>()
    projects.forEach(p => { if (p.disease_focus) set.add(p.disease_focus) })
    return [...set].sort()
  }, [projects])

  const uniqueTags = useMemo(() => {
    const set = new Set<string>()
    projects.forEach(p => (p.tags || []).forEach(t => { if (!isNoiseTag(t)) set.add(t) }))
    return [...set].sort()
  }, [projects])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (statusFilter !== 'all') count++
    if (diseaseFocusFilter) count++
    if (tagFilter) count++
    if (dateRange !== 'all') count++
    return count
  }, [statusFilter, diseaseFocusFilter, tagFilter, dateRange])

  // Filtered and sorted projects
  const displayProjects = useMemo(() => {
    let filtered = projects

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => (p.status || 'active') === statusFilter)
    }

    // Disease focus filter
    if (diseaseFocusFilter) {
      filtered = filtered.filter(p => p.disease_focus === diseaseFocusFilter)
    }

    // Tag filter
    if (tagFilter) {
      filtered = filtered.filter(p => (p.tags || []).includes(tagFilter))
    }

    // Date range filter
    if (dateRange !== 'all') {
      const now = Date.now()
      const msMap: Record<string, number> = { '7d': 7 * 86400000, '30d': 30 * 86400000, '90d': 90 * 86400000, '1y': 365 * 86400000 }
      const cutoff = now - (msMap[dateRange] || 0)
      filtered = filtered.filter(p => new Date(p.updated_at || p.created_at).getTime() >= cutoff)
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.disease_focus || '').toLowerCase().includes(q) ||
        (p.tags || []).some(t => t.toLowerCase().includes(q))
      )
    }

    // Sort
    const sorted = [...filtered]
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'hypotheses':
        sorted.sort((a, b) => (b.hypothesis_count || 0) - (a.hypothesis_count || 0))
        break
      case 'status':
        sorted.sort((a, b) => (a.status || 'active').localeCompare(b.status || 'active'))
        break
      default: // recent
        sorted.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
    }

    return sorted
  }, [projects, statusFilter, diseaseFocusFilter, tagFilter, dateRange, searchQuery, sortBy])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: projects.length, active: 0, paused: 0, completed: 0, archived: 0 }
    projects.forEach(p => { counts[p.status || 'active'] = (counts[p.status || 'active'] || 0) + 1 })
    return counts
  }, [projects])

  const allSelected = selectMode && selectedIds.size > 0 && displayProjects.every(p => selectedIds.has(p.id))

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-[var(--color-text-muted)] mt-1 text-sm">Manage your research projects and discoveries</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true) }}
            className={clsx(
              'text-sm px-3 py-1.5 rounded-lg border transition-colors active:scale-95 flex items-center gap-2',
              selectMode
                ? 'border-[var(--color-border-strong)] text-[var(--color-text)]'
                : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]',
            )}
            aria-pressed={selectMode}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-sm px-3 py-1.5 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text)] transition-colors flex items-center gap-2 active:scale-95"
          >
            <FiPlus className="w-4 h-4 text-[var(--color-text-muted)]" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* API Status Banner — Stage 3 hardening adds an inline Retry
          CTA so the user can recover without a full page reload. The
          banner itself stays visible (no toast) because Projects is
          a list page where the empty render below would otherwise
          look indistinguishable from "no projects yet". */}
      {apiStatus === 'error' && (
        <div
          role="alert"
          className="mb-4 p-3 rounded-lg border border-[var(--glass-border)] text-sm text-[var(--color-text-muted)] flex items-start justify-between gap-3 flex-wrap"
        >
          <div className="min-w-0">
            <strong className="text-[var(--color-text)]">API error:</strong> {apiError}
          </div>
          <button
            onClick={loadProjects}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40 active:scale-95"
          >
            Try again
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-[var(--color-border-strong)] flex items-center justify-between gap-3 flex-wrap bg-[var(--glass-bg)]">
          <div className="text-sm text-[var(--color-text)]">
            {selectedIds.size} project{selectedIds.size === 1 ? '' : 's'} selected
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(allSelected ? new Set() : new Set(displayProjects.map(p => p.id)))}
              className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              {allSelected ? 'Clear selection' : 'Select all visible'}
            </button>
            <button
              onClick={() => handleBulkArchive(false)}
              className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors flex items-center gap-1.5"
            >
              <FiArchive className="w-3 h-3" /> Archive
            </button>
            <button
              onClick={() => handleBulkArchive(true)}
              className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Restore
            </button>
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-400/90 hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1.5"
            >
              <FiTrash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      {!loading && projects.length > 0 && <StatsBar projects={projects} totalDocs={totalDocCount} />}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search projects by name, disease, tags..."
            className="w-full pl-10 pr-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'btn flex items-center gap-2 px-3 py-2 text-sm',
              activeFilterCount > 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'
            )}
          >
            <FiFilter className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold bg-white/10 text-[var(--color-text)] rounded-full">{activeFilterCount}</span>
            )}
          </button>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-muted)] px-3 py-2 focus:outline-none"
          >
            <option value="recent">Recent</option>
            <option value="name">Name</option>
            <option value="hypotheses">Hypotheses</option>
            <option value="status">Status</option>
          </select>

          {/* View toggle */}
          <div className="flex bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={clsx('p-2', viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-[var(--color-text-muted)] hover:text-white')}
            >
              <FiGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={clsx('p-2', viewMode === 'list' ? 'bg-white/10 text-white' : 'text-[var(--color-text-muted)] hover:text-white')}
            >
              <FiList className="w-4 h-4" />
            </button>
          </div>

          {/* Refresh */}
          <button onClick={loadProjects} className="btn text-[var(--color-text-muted)] hover:text-white p-2" title="Refresh" aria-label="Refresh">
            <FiRefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Expanded Filters Panel */}
      {showFilters && (
        <div className="glass-card p-4 mb-6 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-wrap items-end gap-3">
            {/* Status */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Status</label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-muted)] px-3 py-1.5 focus:outline-none min-w-[120px]"
              >
                {(['all', 'active', 'paused', 'completed', 'archived'] as StatusFilter[]).map(s => (
                  <option key={s} value={s}>{s === 'all' ? `All (${statusCounts.all})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${statusCounts[s] || 0})`}</option>
                ))}
              </select>
            </div>

            {/* Disease Focus */}
            {uniqueDiseaseFocuses.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium flex items-center gap-1">
                  <FiTarget className="w-3 h-3" /> Disease Focus
                </label>
                <select
                  value={diseaseFocusFilter}
                  onChange={e => setDiseaseFocusFilter(e.target.value)}
                  className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-muted)] px-3 py-1.5 focus:outline-none min-w-[160px]"
                >
                  <option value="">All Diseases</option>
                  {uniqueDiseaseFocuses.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}

            {/* Tag */}
            {uniqueTags.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium flex items-center gap-1">
                  <FiTag className="w-3 h-3" /> Tag
                </label>
                <select
                  value={tagFilter}
                  onChange={e => setTagFilter(e.target.value)}
                  className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-muted)] px-3 py-1.5 focus:outline-none min-w-[140px]"
                >
                  <option value="">All Tags</option>
                  {uniqueTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {/* Date Range */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium flex items-center gap-1">
                <FiCalendar className="w-3 h-3" /> Updated
              </label>
              <select
                value={dateRange}
                onChange={e => setDateRange(e.target.value as typeof dateRange)}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-muted)] px-3 py-1.5 focus:outline-none min-w-[120px]"
              >
                <option value="all">Any Time</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="90d">Last 90 Days</option>
                <option value="1y">Last Year</option>
              </select>
            </div>

            {/* Clear all filters */}
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setStatusFilter('all'); setDiseaseFocusFilter(''); setTagFilter(''); setDateRange('all') }}
                className="btn text-xs text-[var(--color-text)] hover:bg-white/5 px-3 py-1.5"
              >
                <FiX className="w-3 h-3 mr-1 inline" />
                Clear All
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading projects">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-[var(--glass-bg)] border border-[var(--color-border)]">
              <Skeleton variant="rect" height={16} width="60%" />
              <div style={{ marginTop: 10 }}>
                <Skeleton lines={3} />
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <Skeleton variant="rect" width={60} height={18} />
                <Skeleton variant="rect" width={80} height={18} />
                <Skeleton variant="rect" width={50} height={18} />
              </div>
            </div>
          ))}
        </div>
      ) : displayProjects.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {displayProjects.map(project => (
              <ProjectCardGrid
                key={project.id}
                project={project}
                onDelete={handleDeleteRequest}
                onArchive={handleArchive}
                selectMode={selectMode}
                selected={selectedIds.has(project.id)}
                onToggleSelect={toggleSelect}
                paperCount={paperCountByProject[project.id]}
                docCount={docCountByProject[project.id]}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {displayProjects.map(project => (
              <ProjectCardList
                key={project.id}
                project={project}
                onDelete={handleDeleteRequest}
                onArchive={handleArchive}
                selectMode={selectMode}
                selected={selectedIds.has(project.id)}
                onToggleSelect={toggleSelect}
                paperCount={paperCountByProject[project.id]}
                docCount={docCountByProject[project.id]}
              />
            ))}
          </div>
        )
      ) : projects.length > 0 && displayProjects.length === 0 ? (
        /* Filtered to empty */
        <div className="text-center py-16">
          <FiSearch className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium text-white mb-2">No matching projects</h3>
          <p className="text-[var(--color-text-muted)] mb-4 text-sm">
            Try adjusting your search or filters
          </p>
          <button
            onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDiseaseFocusFilter(''); setTagFilter(''); setDateRange('all') }}
            className="btn text-[var(--color-text)] hover:bg-white/5 text-sm"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        /* Empty state */
        <div className="text-center py-20">
          <div className="inline-flex p-4 rounded-2xl bg-white/[0.02] mb-6">
            <FiFolder className="w-12 h-12 text-[var(--color-text-muted)] opacity-30" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Start Your Research</h3>
          <p className="text-[var(--color-text-muted)] mb-8 max-w-md mx-auto text-sm leading-relaxed">
            Create your first research project to begin generating hypotheses, gathering evidence, and producing research papers with AI-powered discovery.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-sm px-4 py-2 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text)] transition-colors flex items-center gap-2 mx-auto active:scale-95"
          >
            <FiPlus className="w-4 h-4 text-[var(--color-text-muted)]" />
            Create Your First Project
          </button>
        </div>
      )}

      {/* Results count */}
      {!loading && displayProjects.length > 0 && (
        <div className="text-center text-xs text-[var(--color-text-muted)] mt-6">
          Showing {displayProjects.length} of {projects.length} project{projects.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateProjectModal onClose={() => setShowCreateModal(false)} onCreate={handleCreate} />
      )}

      {/* Single delete confirmation */}
      {deleteConfirmId && (
        <ConfirmDeleteModal
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={handleDeleteConfirm}
          title="Delete Project?"
          description="This will permanently delete this project, its hypotheses, and research papers. This action cannot be undone."
        />
      )}

      {/* Bulk delete confirmation */}
      {bulkDeleteConfirm && (
        <ConfirmDeleteModal
          onCancel={() => setBulkDeleteConfirm(false)}
          onConfirm={handleBulkDeleteConfirm}
          title={`Delete ${selectedIds.size} project${selectedIds.size === 1 ? '' : 's'}?`}
          description="This will permanently delete the selected projects, including their hypotheses and research papers. This action cannot be undone."
        />
      )}
    </div>
  )
}

/* ─── Shared confirm-delete modal ──────────────────────────────────── */

function ConfirmDeleteModal({
  onCancel, onConfirm, title, description,
}: {
  onCancel: () => void
  onConfirm: () => void
  title: string
  description: string
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      aria-modal="true"
      aria-labelledby="confirm-delete-project-title"
      {...modalBackdropProps(onCancel)}
    >
      <div className="glass-card p-6 max-w-sm mx-4 text-center" role="dialog" onClick={e => e.stopPropagation()}>
        <div className="inline-flex p-3 rounded-xl bg-red-500/10 mb-4">
          <FiTrash2 className="w-6 h-6 text-red-400" />
        </div>
        <h3 id="confirm-delete-project-title" className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed">{description}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors font-medium">
            Delete Permanently
          </button>
        </div>
      </div>
    </div>
  )
}
