import axios, { AxiosInstance } from 'axios'

const apiClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
})

// ─── Projects ──────────────────────────────────────────────────────

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

// ─── Hypotheses ────────────────────────────────────────────────────

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

// ─── Evidence ──────────────────────────────────────────────────────

export interface Evidence {
  id: string
  project_id?: string
  title: string
  source_type: string
  source_id?: string
  source_url?: string
  abstract?: string
  snippet?: string
  full_text?: string
  authors: string[]
  publication_date?: string
  journal?: string
  doi?: string
  entities: string[]
  tags: string[]
  relevance_score?: number
  quality_score?: number
  citation_count?: number
  status?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface EvidenceCreate {
  title: string
  source_type: string
  source_url?: string
  abstract?: string
  authors?: string[]
  publication_date?: string
  tags?: string[]
  project_id?: string
}

// ─── Knowledge Graph ───────────────────────────────────────────────

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

// ─── Simulations ───────────────────────────────────────────────────

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

// ─── Orchestrator / Discovery ──────────────────────────────────────

export interface OrchestratorStatus {
  state: 'idle' | 'running' | 'paused' | 'stopping' | 'completed'
  total_agents: number
  active_agents: number
  hypotheses_found: number
  paths_explored: number
  high_confidence_discoveries: number
  current_round: number
  total_rounds: number
  agents_by_role: Record<string, number>
  agents_by_model: Record<string, number>
  models_active: string[]
  token_pool_stats: Record<string, any>
  learning_stats: {
    total_explored: number
    low_value_paths: number
    high_value_paths: number
    avg_relation_score: number
  }
}

export interface DiscoveryHypothesis {
  id: string
  title: string
  description: string
  mechanism: string
  confidence: number
  novelty_score: number
  external_factors: any[]
  evidence_summary: any[]
  risks: string[]
  validation_steps: string[]
  key_citations: string[]
  fda_references: string[]
  clinical_trial_references: string[]
}

export interface DiscoveryConfig {
  disease: string
  discovery_type: 'treatment' | 'prevention' | 'biomarker' | 'drug_repurposing' | 'combination_therapy'
  focus_entities?: string[]
  max_results?: number
  min_confidence?: number
  max_rounds?: number
  models?: string[]
}

// ─── RAG ───────────────────────────────────────────────────────────

export interface RAGQuery {
  query: string
  retrieval_mode?: 'vector' | 'keyword' | 'graph' | 'hybrid' | 'hybrid_graph'
  top_k?: number
  source_types?: string[]
  date_from?: string
  date_to?: string
  reranker?: 'none' | 'cross_encoder' | 'cohere' | 'llm'
}

export interface RAGResult {
  query: string
  results: Array<{
    id: string
    title: string
    content: string
    source_type: string
    relevance_score: number
    metadata: Record<string, any>
  }>
  total_results: number
  retrieval_mode: string
}

// ─── Ingestion ─────────────────────────────────────────────────────

export interface IngestionJob {
  id: string
  name: string
  source: string
  status: 'pending' | 'queued' | 'fetching' | 'processing' | 'indexing' | 'completed' | 'partial' | 'failed' | 'cancelled'
  progress: number
  items_found: number
  items_processed: number
  items_indexed: number
  query?: string
  target_project_id?: string
  created_at: string
  completed_at?: string
  error_message?: string
}

// ─── Agent Tasks ───────────────────────────────────────────────────

export interface AgentTask {
  id: string
  project_id: string
  name: string
  task_type: string
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  input_data?: Record<string, any>
  output_data?: Record<string, any>
  error_message?: string
  tokens_used?: number
  started_at?: string
  completed_at?: string
  created_at: string
}

// ─── Notebook ──────────────────────────────────────────────────────

export interface NotebookPage {
  id: string
  title: string
  content: string
  content_type: 'markdown' | 'rich_text' | 'canvas'
  tags: string[]
  version: number
  versions?: NotebookVersion[]
  created_at: string
  updated_at: string
}

export interface NotebookVersion {
  version: number
  content: string
  title: string
  created_at: string
}

export interface NotebookPageCreate {
  title: string
  content?: string
  content_type?: 'markdown' | 'rich_text' | 'canvas'
  tags?: string[]
}

// ─── Activity / Timeline ───────────────────────────────────────────

export interface Activity {
  id: string
  type: 'project' | 'hypothesis' | 'evidence' | 'simulation' | 'notebook' | 'discovery'
  action: 'created' | 'updated' | 'completed' | 'validated' | 'rejected' | 'imported' | 'started' | 'deleted'
  title: string
  description?: string
  entity_id?: string
  entity_type?: string
  project_name?: string
  metadata?: Record<string, any>
  annotation?: string
  created_at: string
}

// ─── Pagination ────────────────────────────────────────────────────

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

// ─── Search ────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  type: 'evidence' | 'hypothesis' | 'project' | 'entity' | 'notebook'
  title: string
  snippet: string
  source: string
  source_type: string
  relevance_score: number
  metadata: Record<string, any>
  created_at?: string
  tags?: string[]
}

// ═══════════════════════════════════════════════════════════════════
// API Functions
// ═══════════════════════════════════════════════════════════════════

export const api = {
  // ── Projects ──────────────────────────────────────────────────

  async getProjects(params?: PaginationParams & { search?: string; status?: string }): Promise<PaginatedResponse<Project>> {
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

  async getProjectStats(id: string): Promise<any> {
    const { data } = await apiClient.get(`/projects/${id}/stats`)
    return data
  },

  // ── Hypotheses ────────────────────────────────────────────────

  async getHypotheses(params?: PaginationParams & { project_id?: string; status?: string; sort_by?: string }): Promise<PaginatedResponse<Hypothesis>> {
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

  async getGenerationStatus(taskId: string): Promise<any> {
    const { data } = await apiClient.get(`/hypotheses/generation/${taskId}`)
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

  async addEvidenceToHypothesis(hypothesisId: string, evidenceRef: Partial<EvidenceRef>): Promise<any> {
    const { data } = await apiClient.post(`/hypotheses/${hypothesisId}/add-evidence`, evidenceRef)
    return data
  },

  // ── Evidence ──────────────────────────────────────────────────

  async searchEvidence(query: string, params?: { source_types?: string[]; semantic_search?: boolean; limit?: number; date_from?: string; date_to?: string }): Promise<{ items: Evidence[]; total: number }> {
    const { data } = await apiClient.post('/evidence/search', { query, ...params })
    return data
  },

  async getEvidenceList(params?: PaginationParams & { source_type?: string; project_id?: string }): Promise<PaginatedResponse<Evidence>> {
    const { data } = await apiClient.get('/evidence', { params })
    return data
  },

  async getEvidence(id: string): Promise<Evidence> {
    const { data } = await apiClient.get(`/evidence/${id}`)
    return data
  },

  async createEvidence(evidence: EvidenceCreate): Promise<Evidence> {
    const { data } = await apiClient.post('/evidence', evidence)
    return data
  },

  async updateEvidence(id: string, update: Partial<Evidence>): Promise<Evidence> {
    const { data } = await apiClient.patch(`/evidence/${id}`, update)
    return data
  },

  async deleteEvidence(id: string): Promise<void> {
    await apiClient.delete(`/evidence/${id}`)
  },

  async getRelatedEvidence(id: string): Promise<Evidence[]> {
    const { data } = await apiClient.get(`/evidence/${id}/related`)
    return data
  },

  async bulkCreateEvidence(items: EvidenceCreate[]): Promise<any> {
    const { data } = await apiClient.post('/evidence/bulk', { items })
    return data
  },

  // ── Knowledge Graph ───────────────────────────────────────────

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

  async getRelationsBetween(sourceId: string, targetId: string): Promise<Relation[]> {
    const { data } = await apiClient.get('/knowledge/relations/between', { params: { source_id: sourceId, target_id: targetId } })
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

  async getEntityTypes(): Promise<string[]> {
    const { data } = await apiClient.get('/knowledge/entity-types')
    return data
  },

  async getRelationTypes(): Promise<string[]> {
    const { data } = await apiClient.get('/knowledge/relation-types')
    return data
  },

  async queryCypher(query: string): Promise<any> {
    const { data } = await apiClient.post('/knowledge/query', { query })
    return data
  },

  // ── RAG ───────────────────────────────────────────────────────

  async ragQuery(request: RAGQuery): Promise<RAGResult> {
    const { data } = await apiClient.post('/rag/query', request)
    return data
  },

  async ragContext(query: string, params?: { max_tokens?: number; source_types?: string[] }): Promise<any> {
    const { data } = await apiClient.post('/rag/context', { query, ...params })
    return data
  },

  async ragSimilar(documentId: string, params?: { top_k?: number }): Promise<any> {
    const { data } = await apiClient.post('/rag/similar', { document_id: documentId, ...params })
    return data
  },

  async ragGraphContext(entities: string[]): Promise<any> {
    const { data } = await apiClient.post('/rag/graph-context', { entities })
    return data
  },

  async ragStats(): Promise<any> {
    const { data } = await apiClient.get('/rag/stats')
    return data
  },

  async ragHealth(): Promise<any> {
    const { data } = await apiClient.get('/rag/health')
    return data
  },

  // ── Ingestion ─────────────────────────────────────────────────

  async createIngestionJob(job: { name: string; source: string; query?: string; target_project_id?: string; auto_process?: boolean; auto_index?: boolean }): Promise<IngestionJob> {
    const { data } = await apiClient.post('/ingestion/jobs', job)
    return data
  },

  async getIngestionJobs(params?: PaginationParams & { status?: string; source?: string }): Promise<PaginatedResponse<IngestionJob>> {
    const { data } = await apiClient.get('/ingestion/jobs', { params })
    return data
  },

  async getIngestionJob(id: string): Promise<IngestionJob> {
    const { data } = await apiClient.get(`/ingestion/jobs/${id}`)
    return data
  },

  async cancelIngestionJob(id: string): Promise<IngestionJob> {
    const { data } = await apiClient.post(`/ingestion/jobs/${id}/cancel`)
    return data
  },

  async retryIngestionJob(id: string): Promise<IngestionJob> {
    const { data } = await apiClient.post(`/ingestion/jobs/${id}/retry`)
    return data
  },

  async getIngestionSources(): Promise<any[]> {
    const { data } = await apiClient.get('/ingestion/sources')
    return data
  },

  async uploadDocument(file: File, params?: { project_id?: string }): Promise<any> {
    const formData = new FormData()
    formData.append('file', file)
    if (params?.project_id) formData.append('project_id', params.project_id)
    const { data } = await apiClient.post('/ingestion/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  async getIngestionQueueStats(): Promise<any> {
    const { data } = await apiClient.get('/ingestion/queue/stats')
    return data
  },

  // ── Simulations ───────────────────────────────────────────────

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

  async runSimulation(id: string): Promise<any> {
    const { data } = await apiClient.post(`/simulation/${id}/run`)
    return data
  },

  async getSimulationResults(id: string): Promise<any> {
    const { data } = await apiClient.get(`/simulation/${id}/results`)
    return data
  },

  async cancelSimulation(id: string): Promise<Simulation> {
    const { data } = await apiClient.post(`/simulation/${id}/cancel`)
    return data
  },

  // ── Agent Tasks ───────────────────────────────────────────────

  async createAgentTask(task: { project_id: string; task_type: string; query: string; context?: Record<string, unknown>; max_iterations?: number }): Promise<{ id: string; status: string }> {
    const { data } = await apiClient.post('/agents/tasks', task)
    return data
  },

  async getAgentTasks(params?: PaginationParams & { project_id?: string; status?: string }): Promise<PaginatedResponse<AgentTask>> {
    const { data } = await apiClient.get('/agents/tasks', { params })
    return data
  },

  async getAgentTask(id: string): Promise<AgentTask> {
    const { data } = await apiClient.get(`/agents/tasks/${id}`)
    return data
  },

  async cancelAgentTask(id: string): Promise<any> {
    const { data } = await apiClient.post(`/agents/tasks/${id}/cancel`)
    return data
  },

  async getAgentTaskLogs(id: string): Promise<any> {
    const { data } = await apiClient.get(`/agents/tasks/${id}/logs`)
    return data
  },

  async runSearch(query: string, sources?: string[], maxResults?: number): Promise<{ query: string; results: Array<{ title: string; url: string; snippet?: string; source: string; relevance_score: number }>; total_results: number }> {
    const { data } = await apiClient.post('/agents/search', { query, sources, max_results: maxResults })
    return data
  },

  // ── Orchestrator ──────────────────────────────────────────────

  async startDiscovery(config?: DiscoveryConfig): Promise<any> {
    const { data } = await apiClient.post('/orchestrator/start', config)
    return data
  },

  async getOrchestratorStatus(): Promise<OrchestratorStatus> {
    const { data } = await apiClient.get('/orchestrator/status')
    return data
  },

  async pauseDiscovery(): Promise<any> {
    const { data } = await apiClient.post('/orchestrator/pause')
    return data
  },

  async stopDiscovery(): Promise<any> {
    const { data } = await apiClient.post('/orchestrator/stop')
    return data
  },

  async saveDiscoveryToProject(projectName?: string): Promise<{ status: string; project_id: string; name: string; hypothesis_count: number; message: string }> {
    const { data } = await apiClient.post('/orchestrator/save-to-project', null, {
      params: projectName ? { project_name: projectName } : undefined,
    })
    return data
  },

  async generatePaper(): Promise<any> {
    const { data } = await apiClient.post('/orchestrator/paper/generate')
    return data
  },

  async getPaperStatus(): Promise<any> {
    const { data } = await apiClient.get('/orchestrator/paper/status')
    return data
  },

  async generatePaperMarkdown(): Promise<string> {
    const { data } = await apiClient.post('/orchestrator/generate-paper/markdown')
    return data
  },

  // ── Discovery Analysis ────────────────────────────────────────

  async analyzeDisease(config: DiscoveryConfig): Promise<any> {
    const { data } = await apiClient.post('/discovery/analyze', config)
    return data
  },

  // ── Documents / PDF ───────────────────────────────────────────

  async generateProjectPdf(projectId: string, useAi: boolean = true): Promise<Blob> {
    const { data } = await apiClient.post(
      `/documents/project/${projectId}/pdf?use_ai=${useAi}`,
      null,
      { responseType: 'blob' },
    )
    return data
  },

  async generateProjectPdfAsync(projectId: string, useAi: boolean = true): Promise<{ status: string; project_id: string; message: string }> {
    const { data } = await apiClient.post(`/documents/project/${projectId}/pdf/async?use_ai=${useAi}`)
    return data
  },

  async generateHypothesisPdf(hypothesisId: string, useAi: boolean = true): Promise<Blob> {
    const { data } = await apiClient.post(
      `/documents/hypothesis/${hypothesisId}/pdf?use_ai=${useAi}`,
      null,
      { responseType: 'blob' },
    )
    return data
  },

  async getDocumentStatus(): Promise<{ status: string; filename?: string; size_bytes?: number; error?: string }> {
    const { data } = await apiClient.get('/documents/status')
    return data
  },

  async downloadDocument(): Promise<Blob> {
    const { data } = await apiClient.get('/documents/download', { responseType: 'blob' })
    return data
  },

  // ── Notebook ──────────────────────────────────────────────────

  async getNotebookPages(params?: PaginationParams): Promise<PaginatedResponse<NotebookPage>> {
    const { data } = await apiClient.get('/notebook/pages', { params })
    return data
  },

  async getNotebookPage(id: string): Promise<NotebookPage> {
    const { data } = await apiClient.get(`/notebook/pages/${id}`)
    return data
  },

  async createNotebookPage(page: NotebookPageCreate): Promise<NotebookPage> {
    const { data } = await apiClient.post('/notebook/pages', page)
    return data
  },

  async updateNotebookPage(id: string, update: Partial<NotebookPageCreate & { content: string }>): Promise<NotebookPage> {
    const { data } = await apiClient.patch(`/notebook/pages/${id}`, update)
    return data
  },

  async deleteNotebookPage(id: string): Promise<void> {
    await apiClient.delete(`/notebook/pages/${id}`)
  },

  async getNotebookPageVersions(id: string): Promise<NotebookVersion[]> {
    const { data } = await apiClient.get(`/notebook/pages/${id}/versions`)
    return data
  },

  async restoreNotebookVersion(pageId: string, version: number): Promise<NotebookPage> {
    const { data } = await apiClient.post(`/notebook/pages/${pageId}/versions/${version}/restore`)
    return data
  },

  async exportNotebookPage(id: string, format: 'markdown' | 'pdf' | 'html'): Promise<Blob> {
    const { data } = await apiClient.get(`/notebook/pages/${id}/export`, {
      params: { format },
      responseType: 'blob',
    })
    return data
  },

  // ── Activity / Timeline ───────────────────────────────────────

  async getActivities(params?: PaginationParams & { type?: string; action?: string; date_from?: string; date_to?: string }): Promise<PaginatedResponse<Activity>> {
    const { data } = await apiClient.get('/activities', { params })
    return data
  },

  async getActivity(id: string): Promise<Activity> {
    const { data } = await apiClient.get(`/activities/${id}`)
    return data
  },

  async updateActivity(id: string, update: { annotation?: string; description?: string }): Promise<Activity> {
    const { data } = await apiClient.patch(`/activities/${id}`, update)
    return data
  },

  async deleteActivity(id: string): Promise<void> {
    await apiClient.delete(`/activities/${id}`)
  },

  // ── Monitoring ────────────────────────────────────────────────

  async getHealthCheck(): Promise<any> {
    const { data } = await apiClient.get('/monitoring/health')
    return data
  },

  async getSystemMetrics(): Promise<any> {
    const { data } = await apiClient.get('/monitoring/metrics')
    return data
  },

  // ── Global Search ─────────────────────────────────────────────

  async globalSearch(query: string, params?: {
    types?: string[]
    date_from?: string
    date_to?: string
    min_relevance?: number
    sort_by?: 'relevance' | 'date' | 'citations'
    limit?: number
  }): Promise<{ results: SearchResult[]; total: number; query: string }> {
    // Aggregate search across multiple endpoints
    const results: SearchResult[] = []

    await Promise.allSettled([
      // Search evidence
      apiClient.post('/evidence/search', { query, limit: params?.limit || 20 }).then(r => {
        (r.data.items || []).forEach((item: any) => {
          results.push({
            id: item.id,
            type: 'evidence',
            title: item.title,
            snippet: item.abstract || item.snippet || '',
            source: item.source_type || 'unknown',
            source_type: 'evidence',
            relevance_score: item.relevance_score || 0.5,
            metadata: { authors: item.authors, journal: item.journal, doi: item.doi, citation_count: item.citation_count },
            created_at: item.created_at,
            tags: item.tags,
          })
        })
      }),

      // Search knowledge graph entities
      apiClient.get('/knowledge/entities/search', { params: { query, limit: params?.limit || 10 } }).then(r => {
        (r.data || []).forEach((item: any) => {
          results.push({
            id: item.id,
            type: 'entity',
            title: item.name,
            snippet: item.description || `${item.entity_type} with ${item.source_count} sources`,
            source: item.entity_type,
            source_type: item.entity_type,
            relevance_score: 0.7,
            metadata: { entity_type: item.entity_type, aliases: item.aliases, external_ids: item.external_ids },
            tags: item.aliases || [],
          })
        })
      }),

      // Search projects
      apiClient.get('/projects', { params: { search: query, page_size: 10 } }).then(r => {
        (r.data.items || []).forEach((item: any) => {
          results.push({
            id: item.id,
            type: 'project',
            title: item.name,
            snippet: item.description || item.research_question || '',
            source: 'project',
            source_type: 'project',
            relevance_score: 0.6,
            metadata: { disease_focus: item.disease_focus, hypothesis_count: item.hypothesis_count, evidence_count: item.evidence_count },
            created_at: item.created_at,
            tags: item.tags,
          })
        })
      }),

      // Search hypotheses
      apiClient.get('/hypotheses', { params: { page_size: 10 } }).then(r => {
        const items = (r.data.items || []).filter((item: any) =>
          item.statement?.toLowerCase().includes(query.toLowerCase()) ||
          item.mechanism?.toLowerCase().includes(query.toLowerCase())
        )
        items.forEach((item: any) => {
          results.push({
            id: item.id,
            type: 'hypothesis',
            title: item.statement,
            snippet: item.mechanism || item.rationale || '',
            source: 'hypothesis',
            source_type: 'hypothesis',
            relevance_score: item.confidence_score || 0.5,
            metadata: { confidence: item.confidence_score, novelty: item.novelty_score, status: item.status },
            created_at: item.created_at,
            tags: item.tags,
          })
        })
      }),

      // Search RAG
      apiClient.post('/rag/query', { query, top_k: params?.limit || 10 }).then(r => {
        (r.data.results || []).forEach((item: any) => {
          // Avoid duplicates from evidence search
          if (!results.find(r => r.id === item.id)) {
            results.push({
              id: item.id || `rag-${Math.random()}`,
              type: 'evidence',
              title: item.title || 'RAG Result',
              snippet: item.content || '',
              source: item.source_type || 'rag',
              source_type: item.source_type || 'rag',
              relevance_score: item.relevance_score || 0.5,
              metadata: item.metadata || {},
            })
          }
        })
      }),
    ])

    // Sort by relevance
    results.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))

    // Apply filters
    let filtered = results
    if (params?.types?.length) {
      filtered = filtered.filter(r => params.types!.includes(r.type))
    }
    if (params?.min_relevance) {
      filtered = filtered.filter(r => (r.relevance_score || 0) >= params.min_relevance!)
    }

    return { results: filtered, total: filtered.length, query }
  },
}

export default api
