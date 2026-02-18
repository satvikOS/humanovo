import { useParams, Link } from 'react-router-dom'
import { FiArrowLeft, FiActivity, FiTarget, FiCpu, FiCheckCircle, FiClock } from 'react-icons/fi'
import { persistGet } from '../utils/persistence'

interface ProjectHypothesis {
  id: string
  title: string
  description: string
  mechanism: string
  confidence: number
  model_used: string
  validated: boolean
  external_factors: any[]
  created_at: string
}

interface LocalProject {
  id: string
  name: string
  description?: string
  disease_focus?: string
  research_question?: string
  tags: string[]
  hypothesis_count: number
  evidence_count: number
  status: string
  created_at: string
  updated_at: string
}

interface SavedHypothesis {
  id: string
  title: string
  description: string
  mechanism: string
  confidence: number
  tags: string[]
  disease: string
  discovery_type: string
  project_id: string
  created_at: string
}

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()

  // Read from localStorage — same source as Projects.tsx and Agents.tsx
  const projects = persistGet<LocalProject[]>('projects', [])
  const project = projects.find(p => p.id === projectId)

  // Load hypotheses for this project from localStorage
  const allHypotheses = persistGet<SavedHypothesis[]>('hypotheses', [])
  const projectHypotheses = allHypotheses.filter(h => h.project_id === projectId)

  if (!project) {
    return (
      <div className="p-8">
        <Link to="/projects" className="inline-flex items-center text-primary-400 hover:text-primary-300 mb-6">
          <FiArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Link>
        <div className="card text-center py-12">
          <FiTarget className="w-12 h-12 text-secondary-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Project Not Found</h2>
          <p className="text-secondary-400 max-w-md mx-auto">
            This project may not have been saved properly. Try running a new discovery
            and saving results to a project from the Agents page.
          </p>
        </div>
      </div>
    )
  }

  // Map saved hypotheses to the display format
  const hypotheses: ProjectHypothesis[] = projectHypotheses.map(h => ({
    id: h.id,
    title: h.title,
    description: h.description,
    mechanism: h.mechanism,
    confidence: h.confidence,
    model_used: h.discovery_type || 'unknown',
    validated: false,
    external_factors: [],
    created_at: h.created_at,
  }))

  const modelColors: Record<string, string> = {
    llama_maverick: 'text-orange-400',
    deepseek_r1: 'text-teal-400',
    kimi_25: 'text-purple-400',
    gpt_oss_120b: 'text-blue-400',
  }
  const modelLabels: Record<string, string> = {
    llama_maverick: 'Llama Maverick',
    deepseek_r1: 'DeepSeek R1',
    kimi_25: 'Kimi 2.5',
    gpt_oss_120b: 'GPT OSS 120B',
  }

  return (
    <div className="p-8">
      {/* Back navigation */}
      <Link to="/projects" className="inline-flex items-center text-primary-400 hover:text-primary-300 mb-6">
        <FiArrowLeft className="w-4 h-4 mr-2" />
        Back to Projects
      </Link>

      {/* Project header */}
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
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center">
              <FiActivity className="w-5 h-5 mr-2 text-primary-400" />
              Hypotheses ({hypotheses.length})
            </h2>

            {hypotheses.length > 0 ? (
              <div className="space-y-4">
                {hypotheses.map((h, idx) => (
                  <div key={h.id} className="border border-secondary-700 rounded-lg p-4 hover:border-primary-600/50 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-secondary-500 font-mono text-sm">#{idx + 1}</span>
                        <h3 className="font-medium text-white">{h.title}</h3>
                      </div>
                      <div className="flex items-center space-x-2">
                        {h.validated && (
                          <FiCheckCircle className="w-4 h-4 text-green-400" />
                        )}
                        <span className={`text-sm font-medium ${
                          h.confidence >= 0.7 ? 'text-green-400' :
                          h.confidence >= 0.5 ? 'text-yellow-400' : 'text-orange-400'
                        }`}>
                          {(h.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {h.description && (
                      <p className="text-secondary-400 text-sm mb-2 line-clamp-2">{h.description}</p>
                    )}

                    {h.mechanism && (
                      <div className="mt-2">
                        <span className="text-secondary-500 text-xs uppercase tracking-wider">Mechanism</span>
                        <p className="text-secondary-300 text-sm mt-1 line-clamp-2">{h.mechanism}</p>
                      </div>
                    )}

                    <div className="flex items-center space-x-4 mt-3 pt-3 border-t border-secondary-700">
                      <span className={`text-xs ${modelColors[h.model_used] || 'text-secondary-400'} flex items-center`}>
                        <FiCpu className="w-3 h-3 mr-1" />
                        {modelLabels[h.model_used] || h.model_used}
                      </span>
                      {h.external_factors && h.external_factors.length > 0 && (
                        <span className="text-xs text-secondary-500">
                          {h.external_factors.length} external factor{h.external_factors.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {h.created_at && (
                        <span className="text-xs text-secondary-500 flex items-center">
                          <FiClock className="w-3 h-3 mr-1" />
                          {new Date(h.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-secondary-400">
                No hypotheses stored in this project yet. Run a discovery from the Agents page
                and save results to populate this project.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Stats */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Statistics</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-secondary-400">Hypotheses</dt>
                <dd className="text-white font-medium">{hypotheses.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-secondary-400">Evidence</dt>
                <dd className="text-white font-medium">{project.evidence_count || 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-secondary-400">Status</dt>
                <dd className="text-white font-medium capitalize">{project.status || 'active'}</dd>
              </div>
            </dl>
          </div>

          {/* Confidence distribution mini */}
          {hypotheses.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-4">Confidence Distribution</h2>
              <div className="space-y-2">
                {[
                  { label: 'High (>=70%)', filter: (c: number) => c >= 0.7, color: 'bg-green-500' },
                  { label: 'Medium (50-70%)', filter: (c: number) => c >= 0.5 && c < 0.7, color: 'bg-yellow-500' },
                  { label: 'Low (<50%)', filter: (c: number) => c < 0.5, color: 'bg-orange-500' },
                ].map(({ label, filter, color }) => {
                  const count = hypotheses.filter(h => filter(h.confidence)).length
                  const pct = hypotheses.length > 0 ? (count / hypotheses.length) * 100 : 0
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-secondary-400">{label}</span>
                        <span className="text-white">{count}</span>
                      </div>
                      <div className="h-2 bg-secondary-700 rounded-full">
                        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tags */}
          {project.tags && project.tags.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-white mb-4">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {project.tags.map((tag: string) => (
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
