import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { FiPlus, FiFolder, FiX, FiTrash2, FiSearch, FiRefreshCw } from 'react-icons/fi'
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

function CreateProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (project: ProjectCreate) => void }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    disease_focus: '',
    research_question: '',
    tags: [] as string[],
  })
  const [tagInput, setTagInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onCreate({
      name: formData.name,
      description: formData.description || undefined,
      disease_focus: formData.disease_focus || undefined,
      research_question: formData.research_question || undefined,
      tags: formData.tags,
    })
    onClose()
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="glass-card w-full max-w-lg mx-4 p-0">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold">New Project</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white">
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Project Name *
            </label>
            <input
              type="text"
              className="input w-full"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., BRCA1 Prevention Strategies"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
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
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Disease Focus
            </label>
            <input
              type="text"
              className="input w-full"
              value={formData.disease_focus}
              onChange={e => setFormData({ ...formData, disease_focus: e.target.value })}
              placeholder="e.g., Breast Cancer"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
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
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Tags
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                className="input flex-1"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Add tag..."
              />
              <button type="button" onClick={addTag} className="btn text-[var(--color-text-secondary)] hover:text-white">
                Add
              </button>
            </div>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center px-2 py-1 bg-white/5 rounded text-sm text-[var(--color-text-secondary)]">
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="ml-1 text-[var(--color-text-muted)] hover:text-white">
                      <FiX className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={onClose} className="btn text-[var(--color-text-secondary)] hover:text-white">
              Cancel
            </button>
            <button type="submit" className="btn text-accent-blue hover:bg-accent-blue/10">
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  const allPapers = persistGet<SavedResearchPaper[]>('research-papers', [])
  const paperCount = allPapers.filter(p => p.project_id === project.id).length
  return (
    <div className="glass-card hover:border-white/10 transition-colors group relative p-4">
      <Link to={`/projects/${project.id}`} className="block">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-white/5 rounded-lg">
              <FiFolder className="w-5 h-5 text-[var(--color-text-muted)]" />
            </div>
            <div>
              <h3 className="font-semibold text-white group-hover:text-accent-blue transition-colors">
                {project.name}
              </h3>
              {project.disease_focus && (
                <p className="text-[var(--color-text-muted)] text-sm">{project.disease_focus}</p>
              )}
            </div>
          </div>
        </div>

        {project.description && (
          <p className="text-[var(--color-text-muted)] text-sm mt-3 line-clamp-2">
            {project.description}
          </p>
        )}

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-border)]">
          <div className="flex space-x-4 text-sm">
            <span className="text-[var(--color-text-muted)]">
              <span className="text-white font-medium">{project.hypothesis_count}</span> hypotheses
            </span>
            <span className="text-[var(--color-text-muted)]">
              <span className="text-white font-medium">{paperCount}</span> papers
            </span>
          </div>
          <span className="text-[var(--color-text-muted)] text-xs">
            {formatDateTime(project.updated_at)}
          </span>
        </div>

        {project.tags && project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {project.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-xxs px-1.5 py-0.5 rounded bg-white/5 text-[var(--color-text-muted)]">
                {tag}
              </span>
            ))}
            {project.tags.length > 3 && (
              <span className="text-[var(--color-text-muted)] text-xs">+{project.tags.length - 3}</span>
            )}
          </div>
        )}
      </Link>
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(project.id) }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-500/10 text-red-400 transition-all"
        title="Delete project"
      >
        <FiTrash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default function Projects() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    try {
      setLoading(true)

      // Get list of IDs the user has explicitly deleted
      const deletedIds = new Set(persistGet<string[]>('deleted-project-ids', []))

      let apiProjects: Project[] = []
      try {
        const res = await api.getProjects({ page_size: 50, search: searchQuery || undefined })
        apiProjects = (res.items || []).filter(p => !deletedIds.has(p.id))
      } catch {
        // API may be unavailable
      }

      // Merge localStorage projects (created by discovery) that aren't in API
      // Also filter out deleted projects from localStorage
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

      // Search filter for local projects
      const filteredLocal = searchQuery
        ? localOnly.filter(p =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.disease_focus || '').toLowerCase().includes(searchQuery.toLowerCase())
          )
        : localOnly

      // Sort all projects by most recent first
      const all = [...apiProjects, ...filteredLocal]
      all.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
      setProjects(all)
    } catch (err) {
      console.error('Failed to load projects:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (data: ProjectCreate) => {
    try {
      const project = await api.createProject(data)
      setProjects(prev => [project, ...prev])
    } catch (err) {
      console.error('Failed to create project:', err)
    }
  }

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const handleDeleteRequest = (id: string) => {
    setDeleteConfirmId(id)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return
    const id = deleteConfirmId
    setDeleteConfirmId(null)
    try {
      try { await api.deleteProject(id) } catch { /* API may be unavailable */ }
      setProjects(prev => prev.filter(p => p.id !== id))
      // Also remove from localStorage
      const localProjects = persistGet<any[]>('projects', [])
      persistSet('projects', localProjects.filter((p: any) => p.id !== id))
      // Track deleted IDs so API projects don't reappear on reload
      const deletedIds = persistGet<string[]>('deleted-project-ids', [])
      if (!deletedIds.includes(id)) persistSet('deleted-project-ids', [...deletedIds, id])
      // Remove associated research papers
      const papers = persistGet<any[]>('research-papers', [])
      persistSet('research-papers', papers.filter((p: any) => p.project_id !== id))
      // Remove associated hypotheses
      const hypotheses = persistGet<any[]>('hypotheses', [])
      persistSet('hypotheses', hypotheses.filter((h: any) => h.project_id !== id))
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Projects</h1>
          <p className="text-[var(--color-text-muted)] mt-1">Manage your research projects</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadProjects} className="btn text-[var(--color-text-muted)] hover:text-white p-2">
            <FiRefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn text-accent-blue hover:bg-accent-blue/10 flex items-center space-x-2"
          >
            <FiPlus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadProjects()}
          placeholder="Search projects..."
          className="w-full pl-10 pr-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:border-white/20"
        />
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <ProjectCard key={project.id} project={project} onDelete={handleDeleteRequest} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <FiFolder className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium text-white mb-2">No projects yet</h3>
          <p className="text-[var(--color-text-muted)] mb-6">
            Create your first research project to get started
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn text-accent-blue hover:bg-accent-blue/10"
          >
            Create Project
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateProjectModal onClose={() => setShowCreateModal(false)} onCreate={handleCreate} />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 max-w-sm mx-4 text-center">
            <FiTrash2 className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">Delete Project?</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              This will permanently delete this project, its hypotheses, and research papers. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmId(null)} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
                Cancel
              </button>
              <button onClick={handleDeleteConfirm} className="btn px-4 py-2 text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20">
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
