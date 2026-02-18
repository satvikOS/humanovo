import axios, { AxiosInstance } from 'axios'

const apiClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Projects
export interface Project {
  id: string
  name: string
  description?: string
  disease_focus?: string
  research_question?: string
  tags: string[]
  status?: string
  hypothesis_count: number
  evidence_count: number
  simulation_count?: number
  hypotheses?: Array<{
    id: string
    title: string
    description: string
    mechanism: string
    confidence: number
    model_used: string
    validated: boolean
    external_factors: any[]
    created_at: string
  }>
  created_at: string
  updated_at: string
}

export interface ProjectCreate {
  name: string
  description?: string
  disease_focus?: string
  research_question?: string
  tags?: string[]
}

// Hypotheses
export interface Hypothesis {
  id: string
  project_id: string
  statement: string
  mechanism?: string
  rationale?: string
  status: 'draft' | 'generating' | 'active' | 'validated' | 'rejected' | 'archived'
  confidence_score: number
  novelty_score: number
  evidence_refs: EvidenceRef[]
  contradiction_count: number
  supporting_count: number
  simulation_results?: SimulationResult
  tags: string[]
  user_notes?: string
  version: number
  created_at: string
  updated_at: string
}

export interface EvidenceRef {
  evidence_id: string
  evidence_type: 'supporting' | 'contradicting' | 'neutral'
  relevance_score: number
  snippet?: string
}

export interface SimulationResult {
  simulation_id: string
  outcome_probability: number
  confidence_interval: [number, number]
  iterations: number
  summary: string
}

export interface HypothesisCreate {
  project_id: string
  statement: string
  mechanism?: string
  tags?: string[]
}

export interface HypothesisGenerate {
  project_id: string
  query: string
  focus_entities?: string[]
  max_hypotheses?: number
}

// Evidence
export interface Evidence {
  id: string
  project_id?: string
  title: string
  source_type: string
  source_id?: string
  source_url?: string
  abstract?: string
  snippet?: string
  authors: string[]
  publication_date?: string
  entities: string[]
  tags: string[]
  relevance_score?: number
  created_at: string
  updated_at: string
}

// Knowledge Graph
export interface Entity {
  id: string
  name: string
  entity_type: string
  aliases: string[]
  description?: string
  external_ids: Record<string, string>
  properties: Record<string, unknown>
  source_count: number
}

export interface Relation {
  id: string
  source_id: string
  source_name: string
  source_type: string
  target_id: string
  target_name: string
  target_type: string
  relation_type: string
  confidence: number
  evidence_count: number
  source_references: string[]
}

export interface GraphNeighborhood {
  center_entity: Entity
  entities: Entity[]
  relations: Relation[]
  depth: number
}

// Simulations
export interface Simulation {
  id: string
  hypothesis_id?: string
  project_id: string
  name: string
  description?: string
  simulation_type: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  iterations: number
  iterations_completed: number
  seed?: number
  parameters: ParameterDistribution[]
  outcomes: OutcomeMetric[]
  summary?: string
  runtime_seconds?: number
  created_at: string
  completed_at?: string
}

export interface ParameterDistribution {
  name: string
  distribution: string
  params: Record<string, number>
}

export interface OutcomeMetric {
  name: string
  mean: number
  std: number
  median: number
  ci_lower: number
  ci_upper: number
  min: number
  max: number
  percentiles: Record<string, number>
}

// Pagination
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages?: number
}

export interface PaginationParams {
  page?: number
  page_size?: number
}

// API Functions
export const api = {
  // Projects
  async getProjects(params?: PaginationParams): Promise<PaginatedResponse<Project>> {
    const { data } = await apiClient.get('/projects', { params })
    return data
  },

  async getProject(id: string): Promise<Project> {
    const { data } = await apiClient.get(`/projects/${id}`)
    return data
  },

  async createProject(project: ProjectCreate): Promise<Project> {
    const { data } = await apiClient.post('/projects', project)
    return data
  },

  async updateProject(id: string, project: Partial<ProjectCreate>): Promise<Project> {
    const { data } = await apiClient.patch(`/projects/${id}`, project)
    return data
  },

  async deleteProject(id: string): Promise<void> {
    await apiClient.delete(`/projects/${id}`)
  },

  // Hypotheses
  async getHypotheses(params?: PaginationParams & { project_id?: string; status?: string }): Promise<PaginatedResponse<Hypothesis>> {
    const { data } = await apiClient.get('/hypotheses', { params })
    return data
  },

  async getHypothesis(id: string): Promise<Hypothesis> {
    const { data } = await apiClient.get(`/hypotheses/${id}`)
    return data
  },

  async createHypothesis(hypothesis: HypothesisCreate): Promise<Hypothesis> {
    const { data } = await apiClient.post('/hypotheses', hypothesis)
    return data
  },

  async generateHypotheses(request: HypothesisGenerate): Promise<{ task_id: string; status: string; message: string }> {
    const { data } = await apiClient.post('/hypotheses/generate', request)
    return data
  },

  async updateHypothesis(id: string, update: Partial<Hypothesis>): Promise<Hypothesis> {
    const { data } = await apiClient.patch(`/hypotheses/${id}`, update)
    return data
  },

  async deleteHypothesis(id: string): Promise<void> {
    await apiClient.delete(`/hypotheses/${id}`)
  },

  async verifyHypothesis(id: string): Promise<Hypothesis> {
    const { data } = await apiClient.post(`/hypotheses/${id}/verify`)
    return data
  },

  // Evidence
  async searchEvidence(query: string, params?: { source_types?: string[]; semantic_search?: boolean; limit?: number }): Promise<{ items: Evidence[]; total: number }> {
    const { data } = await apiClient.post('/evidence/search', { query, ...params })
    return data
  },

  async getEvidence(id: string): Promise<Evidence> {
    const { data } = await apiClient.get(`/evidence/${id}`)
    return data
  },

  // Knowledge Graph
  async searchEntities(query: string, params?: { entity_types?: string[]; limit?: number }): Promise<Entity[]> {
    const { data } = await apiClient.get('/knowledge/entities/search', { params: { query, ...params } })
    return data
  },

  async getEntity(id: string): Promise<Entity> {
    const { data } = await apiClient.get(`/knowledge/entities/${id}`)
    return data
  },

  async getEntityNeighbors(id: string, params?: { depth?: number; relation_types?: string[]; limit?: number }): Promise<GraphNeighborhood> {
    const { data } = await apiClient.get(`/knowledge/entities/${id}/neighbors`, { params })
    return data
  },

  async findPaths(sourceId: string, targetId: string, params?: { max_length?: number; limit?: number }): Promise<Array<{ source: Entity; target: Entity; path: Relation[]; path_length: number; path_confidence: number }>> {
    const { data } = await apiClient.get('/knowledge/paths', { params: { source_id: sourceId, target_id: targetId, ...params } })
    return data
  },

  async getGraphStats(): Promise<{ total_entities: number; total_relations: number; entity_counts: Record<string, number>; relation_counts: Record<string, number>; last_updated: string }> {
    const { data } = await apiClient.get('/knowledge/stats')
    return data
  },

  // Simulations
  async getSimulations(params?: PaginationParams & { project_id?: string; hypothesis_id?: string; status?: string }): Promise<PaginatedResponse<Simulation>> {
    const { data } = await apiClient.get('/simulation', { params })
    return data
  },

  async getSimulation(id: string): Promise<Simulation> {
    const { data } = await apiClient.get(`/simulation/${id}`)
    return data
  },

  async createSimulation(simulation: {
    hypothesis_id?: string
    project_id: string
    name: string
    description?: string
    simulation_type: string
    parameters: ParameterDistribution[]
    iterations?: number
    seed?: number
  }): Promise<{ id: string; status: string; message: string }> {
    const { data } = await apiClient.post('/simulation', simulation)
    return data
  },

  async cancelSimulation(id: string): Promise<Simulation> {
    const { data } = await apiClient.post(`/simulation/${id}/cancel`)
    return data
  },

  // Agents
  async createAgentTask(task: { project_id: string; task_type: string; query: string; context?: Record<string, unknown>; max_iterations?: number }): Promise<{ id: string; status: string }> {
    const { data } = await apiClient.post('/agents/tasks', task)
    return data
  },

  async getAgentTask(id: string): Promise<{ id: string; status: string; progress: number; result?: Record<string, unknown>; error?: string }> {
    const { data } = await apiClient.get(`/agents/tasks/${id}`)
    return data
  },

  async runSearch(query: string, sources?: string[], maxResults?: number): Promise<{ query: string; results: Array<{ title: string; url: string; snippet?: string; source: string; relevance_score: number }>; total_results: number }> {
    const { data } = await apiClient.post('/agents/search', { query, sources, max_results: maxResults })
    return data
  },

  // Orchestrator - Discovery & Paper Generation
  async saveDiscoveryToProject(projectName?: string): Promise<{ status: string; project_id: string; name: string; hypothesis_count: number; message: string }> {
    const { data } = await apiClient.post('/orchestrator/save-to-project', null, {
      params: projectName ? { project_name: projectName } : undefined,
    })
    return data
  },

  async generatePaper(): Promise<any> {
    const { data } = await apiClient.post('/orchestrator/generate-paper')
    return data
  },

  async generatePaperMarkdown(): Promise<string> {
    const { data } = await apiClient.post('/orchestrator/generate-paper/markdown')
    return data
  },
}

export default api
