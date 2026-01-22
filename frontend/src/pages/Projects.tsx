import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FiPlus, FiFolder, FiX } from 'react-icons/fi'
import { api, ProjectCreate, Project } from '../services/api'

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const [formData, setFormData] = useState<ProjectCreate>({
    name: '',
    description: '',
    disease_focus: '',
    research_question: '',
    tags: [],
  })
  const [tagInput, setTagInput] = useState('')

  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      onClose()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(formData)
  }

  const addTag = () => {
    if (tagInput.trim() && !formData.tags?.includes(tagInput.trim())) {
      setFormData({
        ...formData,
        tags: [...(formData.tags || []), tagInput.trim()],
      })
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setFormData({
      ...formData,
      tags: formData.tags?.filter((t) => t !== tag),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-secondary-800 rounded-xl border border-secondary-700 w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-secondary-700">
          <h2 className="text-lg font-semibold text-white">New Project</h2>
          <button onClick={onClose} className="text-secondary-400 hover:text-white">
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">
              Project Name *
            </label>
            <input
              type="text"
              className="input w-full"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., BRCA1 Prevention Strategies"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">
              Description
            </label>
            <textarea
              className="input w-full h-24 resize-none"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the research project..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">
              Disease Focus
            </label>
            <input
              type="text"
              className="input w-full"
              value={formData.disease_focus}
              onChange={(e) => setFormData({ ...formData, disease_focus: e.target.value })}
              placeholder="e.g., Breast Cancer"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">
              Research Question
            </label>
            <textarea
              className="input w-full h-20 resize-none"
              value={formData.research_question}
              onChange={(e) => setFormData({ ...formData, research_question: e.target.value })}
              placeholder="What are you trying to discover or prove?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">
              Tags
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                className="input flex-1"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Add tag..."
              />
              <button type="button" onClick={addTag} className="btn btn-secondary">
                Add
              </button>
            </div>
            {formData.tags && formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-2 py-1 bg-secondary-700 rounded text-sm text-secondary-200"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-1 text-secondary-400 hover:text-white"
                    >
                      <FiX className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="card hover:border-primary-600/50 transition-colors group"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-primary-600/20 rounded-lg">
            <FiFolder className="w-5 h-5 text-primary-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white group-hover:text-primary-400 transition-colors">
              {project.name}
            </h3>
            {project.disease_focus && (
              <p className="text-secondary-400 text-sm">{project.disease_focus}</p>
            )}
          </div>
        </div>
      </div>

      {project.description && (
        <p className="text-secondary-400 text-sm mt-3 line-clamp-2">
          {project.description}
        </p>
      )}

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-secondary-700">
        <div className="flex space-x-4 text-sm">
          <span className="text-secondary-400">
            <span className="text-white font-medium">{project.hypothesis_count}</span> hypotheses
          </span>
          <span className="text-secondary-400">
            <span className="text-white font-medium">{project.evidence_count}</span> evidence
          </span>
        </div>
        <span className="text-secondary-500 text-xs">
          Updated {new Date(project.updated_at).toLocaleDateString()}
        </span>
      </div>

      {project.tags && project.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {project.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="badge badge-info text-xs">
              {tag}
            </span>
          ))}
          {project.tags.length > 3 && (
            <span className="text-secondary-500 text-xs">+{project.tags.length - 3}</span>
          )}
        </div>
      )}
    </Link>
  )
}

export default function Projects() {
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects({ page: 1, page_size: 50 }),
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Projects</h1>
          <p className="text-secondary-400 mt-1">Manage your research projects</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary flex items-center space-x-2"
        >
          <FiPlus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      {/* Projects Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-secondary-800 h-48 rounded-lg" />
          ))}
        </div>
      ) : data?.items && data.items.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.items.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <FiFolder className="w-12 h-12 text-secondary-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No projects yet</h3>
          <p className="text-secondary-400 mb-6">
            Create your first research project to get started
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary"
          >
            Create Project
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateProjectModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  )
}
