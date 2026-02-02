import { useState, useEffect } from 'react'
import {
  FiCpu,
  FiSearch,
  FiZap,
  FiCheckCircle,
  FiAlertCircle,
  FiClock,
  FiPlay,
  FiPause,
  FiRefreshCw,
  FiChevronRight,
  FiSettings,
  FiActivity,
  FiDatabase,
  FiFileText,
  FiGitBranch,
  FiMessageSquare,
  FiTarget
} from 'react-icons/fi'
import clsx from 'clsx'

type AgentType = 'controller' | 'search' | 'extraction' | 'reasoning' | 'verification' | 'simulation'
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

interface AgentTask {
  id: string
  type: AgentType
  name: string
  description: string
  status: TaskStatus
  progress: number
  startTime?: Date
  endTime?: Date
  steps: TaskStep[]
  result?: unknown
  error?: string
}

interface TaskStep {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  agent: AgentType
  startTime?: Date
  endTime?: Date
  output?: string
}

interface AgentConfig {
  type: AgentType
  name: string
  description: string
  icon: typeof FiCpu
  color: string
  capabilities: string[]
}

const agentConfigs: AgentConfig[] = [
  {
    type: 'controller',
    name: 'Controller Agent',
    description: 'Orchestrates multi-agent workflows and manages task distribution',
    icon: FiGitBranch,
    color: 'text-purple-400 bg-purple-500/20',
    capabilities: ['Task planning', 'Agent coordination', 'Result aggregation']
  },
  {
    type: 'search',
    name: 'Search Agent',
    description: 'Searches literature, databases, and knowledge graphs',
    icon: FiSearch,
    color: 'text-primary-400 bg-primary-500/20',
    capabilities: ['PubMed search', 'Semantic search', 'Knowledge graph traversal']
  },
  {
    type: 'extraction',
    name: 'Extraction Agent',
    description: 'Extracts structured data from unstructured text',
    icon: FiFileText,
    color: 'text-green-400 bg-green-500/20',
    capabilities: ['Entity extraction', 'Relationship detection', 'Data normalization']
  },
  {
    type: 'reasoning',
    name: 'Reasoning Agent',
    description: 'Performs logical reasoning and hypothesis generation',
    icon: FiZap,
    color: 'text-warning-400 bg-warning-500/20',
    capabilities: ['Causal inference', 'Hypothesis generation', 'Pattern recognition']
  },
  {
    type: 'verification',
    name: 'Verification Agent',
    description: 'Validates hypotheses against evidence',
    icon: FiCheckCircle,
    color: 'text-success-400 bg-success-500/20',
    capabilities: ['Evidence matching', 'Contradiction detection', 'Confidence scoring']
  },
  {
    type: 'simulation',
    name: 'Simulation Agent',
    description: 'Runs computational simulations and predictions',
    icon: FiActivity,
    color: 'text-orange-400 bg-orange-500/20',
    capabilities: ['Monte Carlo simulations', 'Pathway modeling', 'Drug response prediction']
  },
]

// Mock tasks
const mockTasks: AgentTask[] = [
  {
    id: '1',
    type: 'controller',
    name: 'Analyze TP53 mutation effects',
    description: 'Comprehensive analysis of TP53 mutations in cancer progression',
    status: 'running',
    progress: 65,
    startTime: new Date(Date.now() - 30 * 60 * 1000),
    steps: [
      {
        id: 's1',
        name: 'Search literature for TP53 mutations',
        status: 'completed',
        agent: 'search',
        startTime: new Date(Date.now() - 30 * 60 * 1000),
        endTime: new Date(Date.now() - 25 * 60 * 1000),
        output: 'Found 156 relevant papers'
      },
      {
        id: 's2',
        name: 'Extract mutation data',
        status: 'completed',
        agent: 'extraction',
        startTime: new Date(Date.now() - 25 * 60 * 1000),
        endTime: new Date(Date.now() - 15 * 60 * 1000),
        output: 'Extracted 42 unique mutations'
      },
      {
        id: 's3',
        name: 'Generate hypotheses',
        status: 'running',
        agent: 'reasoning',
        startTime: new Date(Date.now() - 15 * 60 * 1000),
      },
      {
        id: 's4',
        name: 'Verify hypotheses',
        status: 'pending',
        agent: 'verification',
      },
      {
        id: 's5',
        name: 'Run pathway simulations',
        status: 'pending',
        agent: 'simulation',
      },
    ]
  },
  {
    id: '2',
    type: 'search',
    name: 'BRCA1 drug interactions search',
    description: 'Search for drug interactions affecting BRCA1 pathway',
    status: 'completed',
    progress: 100,
    startTime: new Date(Date.now() - 60 * 60 * 1000),
    endTime: new Date(Date.now() - 45 * 60 * 1000),
    steps: [
      {
        id: 's1',
        name: 'Query PubMed',
        status: 'completed',
        agent: 'search',
        output: '89 papers found'
      },
      {
        id: 's2',
        name: 'Query ClinicalTrials',
        status: 'completed',
        agent: 'search',
        output: '23 trials found'
      },
    ],
    result: { papers: 89, trials: 23, entities: 156 }
  },
  {
    id: '3',
    type: 'verification',
    name: 'Validate MDM2 inhibitor hypothesis',
    description: 'Check evidence supporting MDM2 inhibitor efficacy',
    status: 'failed',
    progress: 40,
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
    endTime: new Date(Date.now() - 90 * 60 * 1000),
    steps: [
      {
        id: 's1',
        name: 'Collect supporting evidence',
        status: 'completed',
        agent: 'search',
        output: '12 supporting papers'
      },
      {
        id: 's2',
        name: 'Check for contradictions',
        status: 'failed',
        agent: 'verification',
        output: 'Error: Timeout connecting to knowledge graph'
      },
    ],
    error: 'Task failed due to knowledge graph connection timeout'
  },
]

const newTaskTemplates = [
  { name: 'Literature Review', type: 'search' as AgentType, description: 'Search and summarize literature on a topic' },
  { name: 'Hypothesis Generation', type: 'reasoning' as AgentType, description: 'Generate new hypotheses from existing data' },
  { name: 'Evidence Validation', type: 'verification' as AgentType, description: 'Validate a hypothesis against evidence' },
  { name: 'Full Research Pipeline', type: 'controller' as AgentType, description: 'Complete multi-agent research workflow' },
]

export default function Agents() {
  const [tasks, setTasks] = useState<AgentTask[]>(mockTasks)
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(mockTasks[0])
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskQuery, setNewTaskQuery] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState(newTaskTemplates[0])

  // Simulate progress updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTasks(prev => prev.map(task => {
        if (task.status === 'running' && task.progress < 100) {
          const newProgress = Math.min(task.progress + Math.random() * 5, 99)
          return { ...task, progress: newProgress }
        }
        return task
      }))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const getStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'completed': return <FiCheckCircle className="w-4 h-4 text-success-400" />
      case 'running': return <FiRefreshCw className="w-4 h-4 text-primary-400 animate-spin" />
      case 'failed': return <FiAlertCircle className="w-4 h-4 text-error-400" />
      case 'pending': return <FiClock className="w-4 h-4 text-[var(--color-text-muted)]" />
      default: return <FiClock className="w-4 h-4 text-[var(--color-text-muted)]" />
    }
  }

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case 'completed': return 'bg-success-500/20 text-success-400'
      case 'running': return 'bg-primary-500/20 text-primary-400'
      case 'failed': return 'bg-error-500/20 text-error-400'
      case 'pending': return 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
      default: return 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
    }
  }

  const handleNewTask = () => {
    if (!newTaskQuery.trim()) return
    const newTask: AgentTask = {
      id: `task-${Date.now()}`,
      type: selectedTemplate.type,
      name: newTaskQuery,
      description: selectedTemplate.description,
      status: 'pending',
      progress: 0,
      steps: []
    }
    setTasks(prev => [newTask, ...prev])
    setShowNewTask(false)
    setNewTaskQuery('')
    // Simulate starting the task
    setTimeout(() => {
      setTasks(prev => prev.map(t =>
        t.id === newTask.id ? { ...t, status: 'running' as TaskStatus, startTime: new Date() } : t
      ))
    }, 500)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Multi-Agent Research</h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Orchestrate AI agents to automate research tasks
            </p>
          </div>
          <button
            onClick={() => setShowNewTask(true)}
            className="btn bg-primary-500 text-white hover:bg-primary-600"
          >
            <FiPlay className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Task List */}
        <div className="w-80 border-r border-[var(--color-border)] overflow-y-auto">
          <div className="p-3 border-b border-[var(--color-border)]">
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              Active Tasks
            </h3>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {tasks.map(task => {
              const config = agentConfigs.find(c => c.type === task.type)
              const Icon = config?.icon || FiCpu
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className={clsx(
                    'w-full p-3 text-left hover:bg-[var(--color-bg)] transition-colors',
                    selectedTask?.id === task.id && 'bg-[var(--color-bg)]'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={clsx('p-2 rounded', config?.color || 'bg-[var(--color-border)]')}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{task.name}</span>
                        {getStatusIcon(task.status)}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={clsx('text-xxs px-1.5 py-0.5 rounded capitalize', getStatusColor(task.status))}>
                          {task.status}
                        </span>
                        {task.status === 'running' && (
                          <span className="text-xxs text-[var(--color-text-muted)]">
                            {Math.round(task.progress)}%
                          </span>
                        )}
                      </div>
                      {task.status === 'running' && (
                        <div className="mt-2 h-1 bg-[var(--color-border)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Task Detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedTask ? (
            <div className="p-4">
              {/* Task Header */}
              <div className="mb-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedTask.name}</h2>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                      {selectedTask.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedTask.status === 'running' && (
                      <button className="btn btn-sm bg-warning-500/20 text-warning-400">
                        <FiPause className="w-3.5 h-3.5" />
                        Pause
                      </button>
                    )}
                    {selectedTask.status === 'failed' && (
                      <button className="btn btn-sm bg-primary-500/20 text-primary-400">
                        <FiRefreshCw className="w-3.5 h-3.5" />
                        Retry
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress */}
                {selectedTask.status === 'running' && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-[var(--color-text-muted)]">Progress</span>
                      <span>{Math.round(selectedTask.progress)}%</span>
                    </div>
                    <div className="h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all"
                        style={{ width: `${selectedTask.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {selectedTask.error && (
                  <div className="mt-4 p-3 bg-error-500/10 border border-error-500/30 rounded-lg">
                    <div className="flex items-center gap-2 text-error-400 text-sm">
                      <FiAlertCircle className="w-4 h-4" />
                      {selectedTask.error}
                    </div>
                  </div>
                )}
              </div>

              {/* Steps */}
              <div className="mb-6">
                <h3 className="text-sm font-medium mb-3">Execution Steps</h3>
                <div className="space-y-3">
                  {selectedTask.steps.map((step, index) => {
                    const agentConfig = agentConfigs.find(c => c.type === step.agent)
                    const AgentIcon = agentConfig?.icon || FiCpu
                    return (
                      <div
                        key={step.id}
                        className={clsx(
                          'card',
                          step.status === 'running' && 'border-primary-500/50',
                          step.status === 'failed' && 'border-error-500/50'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center">
                            <div className={clsx(
                              'w-8 h-8 rounded-full flex items-center justify-center',
                              step.status === 'completed' && 'bg-success-500/20',
                              step.status === 'running' && 'bg-primary-500/20',
                              step.status === 'failed' && 'bg-error-500/20',
                              step.status === 'pending' && 'bg-[var(--color-border)]'
                            )}>
                              {step.status === 'completed' && <FiCheckCircle className="w-4 h-4 text-success-400" />}
                              {step.status === 'running' && <FiRefreshCw className="w-4 h-4 text-primary-400 animate-spin" />}
                              {step.status === 'failed' && <FiAlertCircle className="w-4 h-4 text-error-400" />}
                              {step.status === 'pending' && <span className="text-xs text-[var(--color-text-muted)]">{index + 1}</span>}
                            </div>
                            {index < selectedTask.steps.length - 1 && (
                              <div className="w-0.5 h-8 bg-[var(--color-border)] mt-2" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{step.name}</span>
                              <div className={clsx('flex items-center gap-1.5 px-2 py-1 rounded text-xs', agentConfig?.color)}>
                                <AgentIcon className="w-3 h-3" />
                                {agentConfig?.name.replace(' Agent', '')}
                              </div>
                            </div>
                            {step.output && (
                              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                {step.output}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Result */}
              {selectedTask.result && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-3">Result</h3>
                  <div className="card bg-success-500/5 border-success-500/30">
                    <pre className="text-xs overflow-x-auto">
                      {JSON.stringify(selectedTask.result, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FiCpu className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
                <p className="text-[var(--color-text-muted)]">Select a task to view details</p>
              </div>
            </div>
          )}
        </div>

        {/* Agent Panel */}
        <div className="w-72 border-l border-[var(--color-border)] overflow-y-auto">
          <div className="p-3 border-b border-[var(--color-border)]">
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              Available Agents
            </h3>
          </div>
          <div className="p-3 space-y-3">
            {agentConfigs.map(agent => (
              <div key={agent.type} className="card">
                <div className="flex items-center gap-2 mb-2">
                  <div className={clsx('p-1.5 rounded', agent.color)}>
                    <agent.icon className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium">{agent.name}</span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">
                  {agent.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {agent.capabilities.map(cap => (
                    <span
                      key={cap}
                      className="text-xxs px-1.5 py-0.5 bg-[var(--color-border)] rounded"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* New Task Modal */}
      {showNewTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--color-bg-elevated)] rounded-lg w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Create New Research Task</h2>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-[var(--color-text-muted)] block mb-2">
                  Task Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {newTaskTemplates.map(template => {
                    const config = agentConfigs.find(c => c.type === template.type)
                    const Icon = config?.icon || FiCpu
                    return (
                      <button
                        key={template.name}
                        onClick={() => setSelectedTemplate(template)}
                        className={clsx(
                          'p-3 rounded-lg border text-left transition-colors',
                          selectedTemplate.name === template.name
                            ? 'border-primary-500 bg-primary-500/10'
                            : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={clsx('w-4 h-4', config?.color.split(' ')[0])} />
                          <span className="text-sm font-medium">{template.name}</span>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {template.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="text-sm text-[var(--color-text-muted)] block mb-2">
                  Research Query
                </label>
                <textarea
                  value={newTaskQuery}
                  onChange={(e) => setNewTaskQuery(e.target.value)}
                  placeholder="Describe what you want to research..."
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-sm resize-none h-24"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowNewTask(false)}
                className="btn btn-sm bg-[var(--color-border)]"
              >
                Cancel
              </button>
              <button
                onClick={handleNewTask}
                disabled={!newTaskQuery.trim()}
                className="btn btn-sm bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
              >
                <FiPlay className="w-3.5 h-3.5" />
                Start Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
