import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  })

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-secondary-800 rounded w-1/3" />
          <div className="h-4 bg-secondary-800 rounded w-2/3" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="p-8">
        <p className="text-secondary-400">Project not found</p>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">{project.name}</h1>
        {project.description && (
          <p className="text-secondary-400 mt-2">{project.description}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Project Details */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Details</h2>
            <dl className="space-y-3">
              {project.disease_focus && (
                <div>
                  <dt className="text-secondary-400 text-sm">Disease Focus</dt>
                  <dd className="text-white">{project.disease_focus}</dd>
                </div>
              )}
              {project.research_question && (
                <div>
                  <dt className="text-secondary-400 text-sm">Research Question</dt>
                  <dd className="text-white">{project.research_question}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Hypotheses */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">
              Hypotheses ({project.hypothesis_count})
            </h2>
            <p className="text-secondary-400">No hypotheses yet</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Stats */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Statistics</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-secondary-400">Hypotheses</dt>
                <dd className="text-white font-medium">{project.hypothesis_count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-secondary-400">Evidence</dt>
                <dd className="text-white font-medium">{project.evidence_count}</dd>
              </div>
            </dl>
          </div>

          {/* Tags */}
          {project.tags && project.tags.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-4">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {project.tags.map((tag) => (
                  <span key={tag} className="badge badge-info">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
