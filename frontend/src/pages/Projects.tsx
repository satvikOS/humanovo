import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  FiPlus, FiFolder, FiX, FiTrash2, FiSearch, FiRefreshCw,
  FiGrid, FiList, FiFilter, FiChevronDown, FiActivity,
  FiTarget, FiFileText, FiClock, FiTrendingUp, FiZap,
  FiBookOpen, FiDatabase, FiLayers,
} from 'react-icons/fi'
import clsx from 'clsx'
import api, { Project, ProjectCreate } from '../services/api'
import { persistGet, persistSet, formatDateTime } from '../utils/persistence'

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

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  paused: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  completed: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  archived: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', dot: 'bg-zinc-500' },
}

/* ─── Stats Bar ─────────────────────────────────────────────────────── */

function StatsBar({ projects }: { projects: Project[] }) {
  const totalHypotheses = projects.reduce((sum, p) => sum + (p.hypothesis_count || 0), 0)
  const totalEvidence = projects.reduce((sum, p) => sum + (p.evidence_count || 0), 0)
  const activeCount = projects.filter(p => (p.status || 'active') === 'active').length
  const allPapers = persistGet<SavedResearchPaper[]>('research-papers', [])

  const stats = [
    { label: 'Total Projects', value: projects.length, icon: FiFolder, color: 'var(--color-accent-blue)' },
    { label: 'Active', value: activeCount, icon: FiZap, color: 'var(--color-accent-green)' },
    { label: 'Hypotheses', value: totalHypotheses, icon: FiTarget, color: 'var(--color-accent-purple)' },
    { label: 'Evidence Items', value: totalEvidence, icon: FiDatabase, color: 'var(--color-accent-cyan)' },
    { label: 'Research Papers', value: allPapers.length, icon: FiFileText, color: 'var(--color-accent-orange)' },
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

function CreateProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (project: ProjectCreate) => Promise<boolean> }) {
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
      const success = await onCreate({
        name: formData.name,
        description: formData.description || undefined,
        disease_focus: formData.disease_focus || undefined,
        research_question: formData.research_question || undefined,
        tags: formData.tags,
      })
      if (success) onClose()
      else setError('Failed to create project. Please check that the backend server is running.')
    } catch {
      setError('Failed to create project. Please check that the backend server is running.')
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
            <div className="p-2 bg-[var(--color-accent-blue)]/10 rounded-lg">
              <FiPlus className="w-4 h-4 text-[var(--color-accent-blue)]" />
            </div>
            <h2 className="text-lg font-semibold">New Research Project</h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-1 rounded hover:bg-white/5 transition-colors">
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
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button type="button" onClick={onClose} className="btn text-[var(--color-text-secondary)] hover:text-white px-4 py-2" disabled={creating}>
              Cancel
            </button>
            <button type="submit" className="btn text-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue)]/10 px-4 py-2 font-medium" disabled={creating || !formData.name.trim()}>
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
  const status = project.status || 'active'
  const statusColors = STATUS_COLORS[status] || STATUS_COLORS.active
  const totalItems = (project.hypothesis_count || 0) + (project.evidence_count || 0) + paperCount
  const progressWidth = Math.min(100, totalItems * 5)

  return (
    <div className="glass-card hover:border-white/10 transition-all duration-200 group relative overflow-hidden">
      {/* Progress bar at top */}
      <div className="h-0.5 bg-white/5">
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${progressWidth}%`,
            background: `linear-gradient(90deg, var(--color-accent-blue), var(--color-accent-purple))`,
          }}
        />
      </div>

      <Link to={`/projects/${project.id}`} className="block p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-white/5 rounded-lg flex-shrink-0 group-hover:bg-[var(--color-accent-blue)]/10 transition-colors">
              <FiFolder className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-blue)] transition-colors" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-white group-hover:text-[var(--color-accent-blue)] transition-colors truncate">
                {project.name}
              </h3>
              {project.disease_focus && (
                <p className="text-[var(--color-text-muted)] text-sm truncate">{project.disease_focus}</p>
              )}
            </div>
          </div>
          <span className={clsx('flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs flex-shrink-0', statusColors.bg, statusColors.text)}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', statusColors.dot)} />
            {status}
          </span>
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
            <div className="text-sm font-bold text-white">{project.evidence_count || 0}</div>
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
            {project.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-[var(--color-text-muted)]">
                {tag}
              </span>
            ))}
            {project.tags.length > 4 && (
              <span className="text-[var(--color-text-muted)] text-xs self-center">+{project.tags.length - 4}</span>
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
  const status = project.status || 'active'
  const statusColors = STATUS_COLORS[status] || STATUS_COLORS.active

  return (
    <div className="glass-card hover:border-white/10 transition-all group">
      <Link to={`/projects/${project.id}`} className="flex items-center gap-4 p-4">
        <div className="p-2.5 bg-white/5 rounded-lg flex-shrink-0 group-hover:bg-[var(--color-accent-blue)]/10 transition-colors">
          <FiFolder className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-blue)] transition-colors" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-0.5">
            <h3 className="font-semibold text-white group-hover:text-[var(--color-accent-blue)] transition-colors truncate">
              {project.name}
            </h3>
            <span className={clsx('flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs flex-shrink-0', statusColors.bg, statusColors.text)}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', statusColors.dot)} />
              {status}
            </span>
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
            <div className="font-bold text-white">{project.evidence_count || 0}</div>
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

export default function Projects() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('humanovo-projects-view') as ViewMode) || 'grid'
  )
  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [])

  useEffect(() => {
    localStorage.setItem('humanovo-projects-view', viewMode)
  }, [viewMode])

  const loadProjects = async () => {
    try {
      setLoading(true)
      const deletedIds = new Set(persistGet<string[]>('deleted-project-ids', []))

      let apiProjects: Project[] = []
      try {
        const res = await api.getProjects({ page_size: 50, search: searchQuery || undefined })
        apiProjects = (res.items || []).filter(p => !deletedIds.has(p.id))
      } catch { /* API unavailable */ }

      const localProjects = persistGet<any[]>('projects', []).filter((p: any) => p.id && !deletedIds.has(p.id))
      const apiIds = new Set(apiProjects.map(p => p.id))
      const localOnly = localProjects
        .filter((p: any) => !apiIds.has(p.id))
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
          hypotheses: p.hypotheses,
          created_at: p.created_at || new Date().toISOString(),
          updated_at: p.updated_at || new Date().toISOString(),
        } as Project))

      const filteredLocal = searchQuery
        ? localOnly.filter(p =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.disease_focus || '').toLowerCase().includes(searchQuery.toLowerCase())
          )
        : localOnly

      const all = [...apiProjects, ...filteredLocal]
      all.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
      setProjects(all)
    } catch (err) {
      console.error('Failed to load projects:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (data: ProjectCreate): Promise<boolean> => {
    try {
      const project = await api.createProject(data)
      setProjects(prev => [project, ...prev])
      const localProjects = persistGet<any[]>('projects', [])
      persistSet('projects', [project, ...localProjects])
      return true
    } catch { /* API unavailable */ }

    const localProject: Project = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: data.name,
      description: data.description,
      disease_focus: data.disease_focus,
      research_question: data.research_question,
      tags: data.tags || [],
      status: 'active',
      hypothesis_count: 0,
      evidence_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setProjects(prev => [localProject, ...prev])
    const localProjects = persistGet<any[]>('projects', [])
    persistSet('projects', [localProject, ...localProjects])
    return true
  }

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const handleDeleteRequest = (id: string) => setDeleteConfirmId(id)

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return
    const id = deleteConfirmId
    setDeleteConfirmId(null)
    try {
      try { await api.deleteProject(id) } catch { /* API unavailable */ }
      setProjects(prev => prev.filter(p => p.id !== id))
      const localProjects = persistGet<any[]>('projects', [])
      persistSet('projects', localProjects.filter((p: any) => p.id !== id))
      const deletedIds = persistGet<string[]>('deleted-project-ids', [])
      if (!deletedIds.includes(id)) persistSet('deleted-project-ids', [...deletedIds, id])
      const papers = persistGet<any[]>('research-papers', [])
      persistSet('research-papers', papers.filter((p: any) => p.project_id !== id))
      const hypotheses = persistGet<any[]>('hypotheses', [])
      persistSet('hypotheses', hypotheses.filter((h: any) => h.project_id !== id))
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  }

  // Filtered and sorted projects
  const displayProjects = useMemo(() => {
    let filtered = projects

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => (p.status || 'active') === statusFilter)
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
  }, [projects, statusFilter, searchQuery, sortBy])

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
          className="btn text-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue)]/10 flex items-center gap-2 font-medium"
        >
          <FiPlus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

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
          {/* Status filter */}
          <div className="relative">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={clsx(
                'btn flex items-center gap-2 px-3 py-2 text-sm',
                statusFilter !== 'all' ? 'text-[var(--color-accent-blue)]' : 'text-[var(--color-text-muted)]'
              )}
            >
              <FiFilter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{statusFilter === 'all' ? 'Filter' : statusFilter}</span>
              <FiChevronDown className="w-3 h-3" />
            </button>
            {showFilters && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowFilters(false)} />
                <div className="absolute right-0 top-full mt-1 glass-card p-1 min-w-[140px] z-50">
                  {(['all', 'active', 'paused', 'completed', 'archived'] as StatusFilter[]).map(status => (
                    <button
                      key={status}
                      onClick={() => { setStatusFilter(status); setShowFilters(false) }}
                      className={clsx(
                        'w-full text-left px-3 py-1.5 rounded text-sm flex items-center justify-between',
                        statusFilter === status ? 'text-white bg-white/5' : 'text-[var(--color-text-muted)] hover:text-white hover:bg-white/5'
                      )}
                    >
                      <span className="capitalize">{status}</span>
                      <span className="text-xs opacity-50">{statusCounts[status] || 0}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

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
          <button onClick={loadProjects} className="btn text-[var(--color-text-muted)] hover:text-white p-2" title="Refresh">
            <FiRefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-[var(--color-accent-blue)] rounded-full animate-spin" />
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
            onClick={() => { setSearchQuery(''); setStatusFilter('all') }}
            className="btn text-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue)]/10 text-sm"
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
            className="btn text-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue)]/10 flex items-center gap-2 mx-auto font-medium"
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
              <FiTrash2 className="w-6 h-6 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Delete Project?</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed">
              This will permanently delete this project, its hypotheses, and research papers. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmId(null)} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
                Cancel
              </button>
              <button onClick={handleDeleteConfirm} className="btn px-4 py-2 text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 font-medium">
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
