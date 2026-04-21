import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  FiPlus, FiFolder, FiX, FiTrash2, FiSearch, FiRefreshCw,
  FiGrid, FiList, FiFilter, FiChevronDown,
  FiTarget, FiFileText, FiClock, FiZap,
  FiDatabase, FiTag, FiCalendar,
} from 'react-icons/fi'
import clsx from 'clsx'
import api, { Project, ProjectCreate } from '../services/api'
import { persistGet, formatDateTime, logActivity } from '../utils/persistence'

interface SavedResearchPaper {
  id: string
  hypothesis_id: string
  hypothesis_title: string
  project_id: string
  disease: string
  generated_at: string
  filename: string
}

type ViewMode = 'grid' | 'list'
type SortOption = 'recent' | 'name' | 'hypotheses' | 'status'
type StatusFilter = 'all' | 'active' | 'paused' | 'completed' | 'archived'


/* ─── Stats Bar ─────────────────────────────────────────────────────── */

function StatsBar({ projects }: { projects: Project[] }) {
  const totalHypotheses = projects.reduce((sum, p) => sum + (p.hypothesis_count || 0), 0)
  const allDocs = persistGet<{ id: string; project_id: string }[]>('project-documents', [])
  const totalEvidence = projects.reduce((sum, p) => sum + (p.evidence_count || 0), 0) + allDocs.length
  const activeCount = projects.filter(p => (p.status || 'active') === 'active').length
  const allPapers = persistGet<SavedResearchPaper[]>('research-papers', [])

  const stats = [
    { label: 'Total Projects', value: projects.length, icon: FiFolder, color: 'var(--color-text-secondary)' },
    { label: 'Active', value: activeCount, icon: FiZap, color: 'var(--color-text-secondary)' },
    { label: 'Hypotheses', value: totalHypotheses, icon: FiTarget, color: 'var(--color-text-secondary)' },
    { label: 'Evidence Items', value: totalEvidence, icon: FiDatabase, color: 'var(--color-text-secondary)' },
    { label: 'Research Papers', value: allPapers.length, icon: FiFileText, color: 'var(--color-text-secondary)' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
      {stats.map(stat => (
        <div key={stat.label} className="glass-card p-4 flex items-center gap-3 group hover:border-white/10 transition-all">
          <div className="p-2.5 rounded-lg" style={{ backgroundColor: `${stat.color}15` }}>
            <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
          </div>
          <div>
            <div className="text-xl font-bold text-white">{stat.value}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{stat.label}</div>
          </div>
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
    } catch (e: any) {
      setError(e?.message || 'Failed to create project. Open browser console (F12) for details.')
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="glass-card w-full max-w-lg mx-4 p-0 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/5 rounded-lg">
              <FiPlus className="w-4 h-4 text-[var(--color-text)]" />
            </div>
            <h2 className="text-lg font-semibold">New Research Project</h2>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-1 rounded hover:bg-white/5 transition-colors">
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              Project Name <span className="text-red-400">*</span>
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

function ProjectCardGrid({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  const allPapers = persistGet<SavedResearchPaper[]>('research-papers', [])
  const paperCount = allPapers.filter(p => p.project_id === project.id).length
  const allDocs = persistGet<{ id: string; project_id: string }[]>('project-documents', [])
  const docCount = allDocs.filter(d => d.project_id === project.id).length

  return (
    <div className="glass-card hover:border-white/10 transition-all duration-200 group relative overflow-hidden">
      <Link to={`/projects/${project.id}`} className="block p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-white/5 rounded-lg flex-shrink-0 group-hover:bg-white/10 transition-colors">
              <FiFolder className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-white group-hover:text-white/90 transition-colors truncate">
                {project.name}
              </h3>
              {project.disease_focus && (
                <p className="text-[var(--color-text-muted)] text-sm truncate">{project.disease_focus}</p>
              )}
            </div>
          </div>
        </div>

        {project.description && (
          <p className="text-[var(--color-text-muted)] text-sm line-clamp-2 mb-4 leading-relaxed">
            {project.description}
          </p>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center p-2 rounded-lg bg-white/[0.02]">
            <div className="text-sm font-bold text-white">{project.hypothesis_count || 0}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Hypotheses</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-white/[0.02]">
            <div className="text-sm font-bold text-white">{(project.evidence_count || 0) + docCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Evidence</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-white/[0.02]">
            <div className="text-sm font-bold text-white">{paperCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Papers</div>
          </div>
        </div>

        {/* Tags */}
        {project.tags && project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {project.tags.filter(t => !['AI generated', 'ai-generated', '12-stage-pipeline', '10-stage-pipeline', 'well-grounded', 'partially-grounded', 'needs-grounding'].includes(t)).slice(0, 5).map(tag => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-[var(--color-text-muted)]">
                {tag}
              </span>
            ))}
            {project.tags.filter(t => !['AI generated', 'ai-generated', '12-stage-pipeline', '10-stage-pipeline', 'well-grounded', 'partially-grounded', 'needs-grounding'].includes(t)).length > 5 && (
              <span className="text-[var(--color-text-muted)] text-xs self-center">+{project.tags.filter(t => !['AI generated', 'ai-generated', '12-stage-pipeline', '10-stage-pipeline', 'well-grounded', 'partially-grounded', 'needs-grounding'].includes(t)).length - 5}</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
          <span className="text-[var(--color-text-muted)] text-xs flex items-center gap-1">
            <FiClock className="w-3 h-3" />
            {formatDateTime(project.updated_at)}
          </span>
          <FiChevronDown className="w-3.5 h-3.5 text-[var(--color-text-muted)] -rotate-90" />
        </div>
      </Link>

      {/* Delete button */}
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(project.id) }}
        className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-all"
        title="Delete project"
      >
        <FiTrash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/* ─── Project Row (List) ───────────────────────────────────────────── */

function ProjectCardList({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  const allPapers = persistGet<SavedResearchPaper[]>('research-papers', [])
  const paperCount = allPapers.filter(p => p.project_id === project.id).length
  const allDocs = persistGet<{ id: string; project_id: string }[]>('project-documents', [])
  const docCount = allDocs.filter(d => d.project_id === project.id).length
  return (
    <div className="glass-card hover:border-white/10 transition-all group">
      <Link to={`/projects/${project.id}`} className="flex items-center gap-4 p-4">
        <div className="p-2.5 bg-white/5 rounded-lg flex-shrink-0 group-hover:bg-white/10 transition-colors">
          <FiFolder className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-0.5">
            <h3 className="font-semibold text-white group-hover:text-white/90 transition-colors truncate">
              {project.name}
            </h3>
          </div>
          {project.disease_focus && (
            <p className="text-[var(--color-text-muted)] text-sm truncate">{project.disease_focus}</p>
          )}
        </div>

        <div className="flex items-center gap-6 flex-shrink-0 text-sm">
          <div className="text-center w-16">
            <div className="font-bold text-white">{project.hypothesis_count || 0}</div>
            <div className="text-[10px] text-[var(--color-text-muted)]">Hyp.</div>
          </div>
          <div className="text-center w-16">
            <div className="font-bold text-white">{(project.evidence_count || 0) + docCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)]">Evidence</div>
          </div>
          <div className="text-center w-16">
            <div className="font-bold text-white">{paperCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)]">Papers</div>
          </div>
          <span className="text-[var(--color-text-muted)] text-xs w-24 text-right">
            {formatDateTime(project.updated_at)}
          </span>
        </div>

        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(project.id) }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-all flex-shrink-0"
          title="Delete project"
        >
          <FiTrash2 className="w-3.5 h-3.5" />
        </button>
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    loadProjects()
  }, [])

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
    } catch (err: any) {
      console.error('Failed to load projects:', err)
      setApiStatus('error')
      const status = err?.response?.status
      const ct = err?.response?.headers?.['content-type'] || ''
      if (ct.includes('text/html')) {
        setApiError('API Gateway not connected — CloudFront returning HTML instead of JSON. Run deploy-infra workflow.')
      } else if (status) {
        setApiError(`API returned ${status}: ${err?.response?.data?.detail || err?.message}`)
      } else {
        setApiError(`Cannot reach API: ${err?.message}`)
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
    } catch (err: any) {
      // Extract the real error for debugging
      const status = err?.response?.status
      const detail = err?.response?.data?.detail || err?.response?.data?.message || err?.message || String(err)
      const msg = status
        ? `API error ${status}: ${detail}`
        : `Network error: ${detail}`
      console.error('Failed to create project:', msg, err)
      return msg
    }
  }

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

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
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  }

  // Collect unique disease focuses and tags for filter dropdowns
  const uniqueDiseaseFocuses = useMemo(() => {
    const set = new Set<string>()
    projects.forEach(p => { if (p.disease_focus) set.add(p.disease_focus) })
    return [...set].sort()
  }, [projects])

  const uniqueTags = useMemo(() => {
    const set = new Set<string>()
    const excluded = new Set(['AI generated', 'ai-generated', '12-stage-pipeline', '10-stage-pipeline', 'well-grounded', 'partially-grounded', 'needs-grounding'])
    projects.forEach(p => (p.tags || []).forEach(t => { if (!excluded.has(t)) set.add(t) }))
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

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white">Projects</h1>
          <p className="text-[var(--color-text-muted)] mt-1 text-sm">Manage your research projects and discoveries</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn text-[var(--color-text)] hover:bg-white/5 flex items-center gap-2 font-medium"
        >
          <FiPlus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      {/* API Status Banner */}
      {apiStatus === 'error' && (
        <div className="mb-4 p-3 rounded-lg border text-sm" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          <strong>API Error:</strong> {apiError}
        </div>
      )}

      {/* Stats */}
      {!loading && projects.length > 0 && <StatsBar projects={projects} />}

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
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
            <span className="text-sm text-[var(--color-text-muted)]">Loading projects...</span>
          </div>
        </div>
      ) : displayProjects.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {displayProjects.map(project => (
              <ProjectCardGrid key={project.id} project={project} onDelete={handleDeleteRequest} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {displayProjects.map(project => (
              <ProjectCardList key={project.id} project={project} onDelete={handleDeleteRequest} />
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
            className="btn text-[var(--color-text)] hover:bg-white/5 flex items-center gap-2 mx-auto font-medium"
          >
            <FiPlus className="w-4 h-4" />
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

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirmId(null)}>
          <div className="glass-card p-6 max-w-sm mx-4 text-center" onClick={e => e.stopPropagation()}>
            <div className="inline-flex p-3 rounded-xl bg-red-500/10 mb-4">
              <FiTrash2 className="w-6 h-6 text-[var(--color-text-muted)]" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Delete Project?</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed">
              This will permanently delete this project, its hypotheses, and research papers. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmId(null)} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
                Cancel
              </button>
              <button onClick={handleDeleteConfirm} className="btn px-4 py-2 text-sm bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 font-medium">
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
