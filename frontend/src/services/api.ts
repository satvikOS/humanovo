import axios, { AxiosInstance } from 'axios'
import { toast } from '../contexts/ToastContext'
import { logError } from '../lib/errorLog'
import { getToken, clearToken, isTokenExpired } from './auth'

// In production (CloudFront), set VITE_API_BASE_URL to the backend URL
// (e.g. https://api.humanovo.com or API Gateway URL).
// In development, Vite proxy handles /api → localhost:8000.
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

/**
 * Shared axios instance. Exported so callers with non-standard
 * request shapes (form-data uploads, WebSocket auth, raw POST bodies)
 * can use the configured interceptor + baseURL directly instead of
 * hand-rolling fetch().
 *
 * Auth: a request interceptor attaches `Authorization: Bearer <jwt>`
 * from local storage if present. A response interceptor clears the
 * token on 401 and redirects the app to /login. Endpoints that should
 * NOT trigger this redirect (e.g. /auth/login itself) use a separate
 * axios instance defined in services/auth.ts.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: attach the JWT to every request that has one.
// Pre-emptively clears expired tokens — saves a server round-trip on
// the first request after the TTL elapses.
apiClient.interceptors.request.use(
  (config) => {
    if (isTokenExpired()) {
      clearToken()
      // Don't attach an expired token; let the request go through and
      // the response interceptor handle the 401 redirect uniformly.
      return config
    }
    const token = getToken()
    if (token) {
      config.headers = config.headers || {}
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// Opt-out header: set `X-Silent-Error: '1'` on a request to suppress the
// global toast (useful for background polls where failure is expected
// and the caller already handles the error).
const SILENT_HEADER = 'X-Silent-Error'

function describeError(error: {
  response?: { status?: number; data?: unknown; config?: unknown }
  config?: { method?: string; url?: string; headers?: Record<string, unknown> }
  request?: unknown
  message?: string
}): { message: string; silent: boolean } {
  const silent = Boolean(error.config?.headers?.[SILENT_HEADER])
  const method = (error.config?.method || 'GET').toUpperCase()
  const url = error.config?.url || ''
  if (error.response) {
    const status = error.response.status ?? 0
    const data = error.response.data as { detail?: unknown; message?: unknown } | string | undefined
    const detail =
      typeof data === 'string' ? data :
      typeof data?.detail === 'string' ? data.detail :
      typeof data?.message === 'string' ? data.message :
      ''
    return {
      message: `${status} ${method} ${url}${detail ? ` — ${detail}` : ''}`,
      silent,
    }
  }
  if (error.request) {
    return {
      message: `Network error — ${method} ${url} did not respond`,
      silent,
    }
  }
  return { message: error.message || 'Unknown error', silent }
}

// Response interceptor: detect non-JSON responses (e.g. CloudFront returning HTML)
apiClient.interceptors.response.use(
  (response) => {
    const ct = response.headers['content-type'] || ''
    if (ct.includes('text/html') && typeof response.data === 'string' && response.data.includes('<!doctype')) {
      console.error('[API] Received HTML instead of JSON — API Gateway may not be connected. URL:', response.config?.url)
      const msg =
        `API returned HTML instead of JSON for ${response.config?.url}. ` +
        'This usually means CloudFront is not routing /api/* to API Gateway. ' +
        'Check your infrastructure deployment.'
      toast('error', msg, { title: 'API misrouted' })
      return Promise.reject(new Error(msg))
    }
    return response
  },
  (error) => {
    const { message, silent } = describeError(error)
    if (error.response) {
      console.error(`[API] ${message}:`, error.response.data)
    } else if (error.request) {
      console.error(`[API] ${message}`)
    }
    // 401 handling: clear the local token and redirect to /login. The
    // RequireAuth route guard would catch a navigation that lands on a
    // protected page without a token, but a 401 in-flight on a stale
    // token (e.g. after the user idled past the JWT TTL) needs to be
    // converted into a re-auth prompt directly.
    if (error.response?.status === 401) {
      const url = error.config?.url || ''
      // Don't loop on /auth/login itself — that 401 means wrong creds,
      // surfaced by the login page (which uses authClient, not this
      // instance, but defensively skip anyway).
      const isAuthEndpoint = typeof url === 'string' && /\/auth\/(login|register)/.test(url)
      if (!isAuthEndpoint) {
        clearToken()
        // Avoid double-redirects from concurrent failures.
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          // Preserve the page the user was on so we can return them
          // there after re-login.
          const next = encodeURIComponent(window.location.pathname + window.location.search)
          window.location.href = `/login?next=${next}`
        }
      }
    }
    if (!silent && error.response?.status !== 401 && error.response?.status !== 404) {
      // Collapse all 5xx + network errors under a single title/message so
      // the ToastContext dedup (3s window) merges a backend-down storm
      // into one toast instead of one-per-endpoint.
      const status = error.response?.status
      const isServerDown = !error.response || (status !== undefined && status >= 500)
      if (isServerDown) {
        toast('error', 'Backend unreachable — check the API server, retrying on next request.', {
          title: 'API offline',
        })
      } else {
        toast('error', message, { title: 'Request failed' })
      }
    }
    // Feed non-silent errors into the diagnostics ring buffer so a
    // user filing a support ticket has the failed request visible
    // even when the calling code silently swallows the rejection
    // (e.g. background polls, optimistic UI fallbacks). 401/404 are
    // expected control-flow errors and would just be noise.
    if (!silent && error.response?.status !== 401 && error.response?.status !== 404) {
      const url = error.config?.url || 'unknown'
      const status = error.response?.status ?? 'network'
      logError('manual', `API ${status} ${error.config?.method?.toUpperCase() || ''} ${url}: ${message}`)
    }
    return Promise.reject(error)
  }
)

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
    external_factors: string[]
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

export interface TranslationalPhaseDetail {
  phase: string  // T0, T1, T2, T3, T4, T5
  phase_name: string
  formal_name: string
  description: string
  objectives: string[]
  key_activities: string[]
  milestones: string[]
  deliverables: string[]
  evidence_requirements: string[]
  data_sources: string[]
  regulatory_considerations: string[]
  regulatory_milestones: string[]
  key_stakeholders: string[]
  collaborators: string[]
  success_criteria: string[]
  go_no_go_gates: string[]
  phase_risks: string[]
  mitigation_strategies: string[]
  estimated_duration: string
  resource_requirements: string[]
  estimated_cost_range: string
  prerequisites: string[]
  blockers: string[]
}

export interface TranslationalRoadmap {
  current_phase: string
  phases: TranslationalPhaseDetail[]
  overall_feasibility_score: number
  estimated_total_timeline: string
  critical_path_summary: string
  key_decision_points: string[]
  cross_phase_risks: string[]
  regulatory_pathway_summary: string
  commercialization_potential: string
}

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
  translational_roadmap?: TranslationalRoadmap
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
  token_pool_stats: Record<string, unknown>
  learning_stats: {
    total_explored: number
    low_value_paths: number
    high_value_paths: number
    avg_relation_score: number
  }
  project_id?: string
  project_name?: string
}

export interface DiscoveryHypothesis {
  id: string
  title: string
  description: string
  mechanism: string
  confidence: number
  novelty_score: number
  external_factors: string[]
  evidence_summary: Array<Record<string, unknown>>
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
  research_guidance?: string
  knowledge_base_ids?: string[]
  document_context?: boolean
  external_factors?: string[]
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
    metadata: Record<string, unknown>
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
  input_data?: Record<string, unknown>
  output_data?: Record<string, unknown>
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
  metadata?: Record<string, unknown>
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

// Standard bulk-action response shapes used across all
// `/X/bulk-delete` and `/X/bulk-archive` endpoints.
export interface BulkDeleteResult {
  deleted: string[]
  deleted_count: number
  status?: string
}
export interface BulkArchiveResult {
  updated: string[]
  updated_count: number
  status: 'archived' | 'active' | string
}

// ─── Search ────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  type: 'evidence' | 'hypothesis' | 'project' | 'entity' | 'notebook' | 'simulation' | 'experiment' | 'equation'
  title: string
  snippet: string
  source: string
  source_type: string
  relevance_score: number
  metadata: Record<string, unknown>
  created_at?: string
  tags?: string[]
}

// ═══════════════════════════════════════════════════════════════════
// API Functions
// ═══════════════════════════════════════════════════════════════════

// ── Citation Library (Mendeley-equivalent reference manager) ──
export interface LibraryCitation {
  id: string
  type: 'journal' | 'book' | 'conference' | 'preprint' | 'website' | 'thesis' | string
  title: string
  authors: string[]
  year?: number | null
  abstract?: string | null
  journal?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  publisher?: string | null
  doi?: string | null
  pmid?: string | null
  pmcid?: string | null
  arxiv_id?: string | null
  isbn?: string | null
  url?: string | null
  tags: string[]
  folders: string[]
  starred: boolean
  read: boolean
  notes?: string | null
  cite_key?: string | null
  pdf_url?: string | null
  pdf_file_id?: string | null
  csl_json: Record<string, unknown>
  project_id?: string | null
  created_at: string
  updated_at: string
}

export interface LibraryFolder {
  id: string
  name: string
  parent_id: string | null
  color: string | null
  icon: string | null
  order_index: number
  project_id: string | null
  created_at: string
  updated_at: string
}

export interface LibraryHighlight {
  id: string
  citation_id: string
  page: number
  rect: { x: number; y: number; w: number; h: number } | Record<string, number>
  text: string | null
  color: string
  note: string | null
  created_at: string
  updated_at: string
}

// ─── Saved research papers ────────────────────────────────────────
//
// Backend `SavedResearchPaper` rows. Listing returns the summary
// (no body); detail GET returns body too (paper_html can be 50–200 KB).

export interface SavedPaperSummary {
  id: string
  hypothesis_id: string
  project_id: string | null
  hypothesis_title: string
  disease: string | null
  filename: string
  created_at: string
  updated_at: string
}

export interface SavedPaperDetail extends SavedPaperSummary {
  paper_html: string
}

export interface SavedPaperCreate {
  hypothesis_id: string
  project_id?: string | null
  hypothesis_title: string
  disease?: string | null
  filename: string
  paper_html: string
}

// ─── Project documents ────────────────────────────────────────────
//
// Backend `ProjectDocument` rows. Listing returns metadata only;
// /content endpoint streams the raw file bytes with the original
// Content-Type and a Content-Disposition for save-as flows.

export interface ProjectDocumentSummary {
  id: string
  project_id: string
  title: string
  doc_type: string
  authors: string | null
  document_date: string | null
  description: string | null
  tags: string[]
  filename: string
  file_size: number
  mime_type: string
  knowledge_base: 'private' | 'common' | string
  created_at: string
  updated_at: string
}

export interface ProjectDocumentUploadFields {
  project_id: string
  title: string
  doc_type?: string
  authors?: string
  document_date?: string
  description?: string
  tags?: string[]
  knowledge_base?: 'private' | 'common'
}

// ── Hypothesis trace + audit log replay (Round 10 commit 2) ────────
//
// Backend lives in app/api/v1/endpoints/hypothesis_trace.py.
// /trace returns one CitationChainEntry per evidence_ref on the
// hypothesis; /audit-log returns the Merkle-anchored event log plus
// chain integrity flags.

export type CitationVerificationStatus =
  | 'verified'
  | 'unsupported'
  | 'retracted'
  | 'unknown'

export interface CitationChainEntry {
  evidence_id: string
  evidence_type: 'supporting' | 'contradicting' | 'neutral' | string
  relevance_score: number
  snippet: string | null
  title: string | null
  doi: string | null
  pmid: string | null
  url: string | null
  publication_date: string | null
  citation_verified: boolean
  verification_status: CitationVerificationStatus
}

export interface HypothesisTraceResponse {
  hypothesis_id: string
  project_id: string
  statement: string
  confidence_score: number
  supporting_count: number
  contradiction_count: number
  citation_chain: CitationChainEntry[]
  audit_log_url: string
}

export interface AuditLogEntry {
  sequence: number
  timestamp: string
  event_type: string
  severity: string
  action: string
  resource_type: string | null
  resource_id: string | null
  details: Record<string, unknown> | null
  duration_ms: number | null
  cost_usd: number | null
  record_hash: string
  previous_hash: string | null
}

export interface AuditLogResponse {
  hypothesis_id: string
  total_records: number
  entries: AuditLogEntry[]
  chain_intact: boolean
  chain_issues: Array<Record<string, unknown>>
}

// ── Discovery Sessions (conversational Discovery persistence) ──
export interface DiscoveryMessageCard {
  kind: 'hypothesis' | 'evidence' | 'entity' | 'kg_subgraph' | 'citation' | string
  payload: Record<string, unknown>
}

export interface DiscoveryMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  cards?: DiscoveryMessageCard[]
  timestamp?: string
  finish_reason?: string | null
  tokens?: { prompt: number; completion: number } | null
  tool_name?: string | null
  tool_args?: Record<string, unknown> | null
}

export interface DiscoverySessionSummary {
  id: string
  title: string
  pinned: boolean
  project_id: string | null
  message_count: number
  last_run_id: string | null
  updated_at: string
  created_at: string
  preview: string | null
}

export interface DiscoveryAgentConfig {
  model: string
  temperature: number
  system_prompt: string
  max_hypotheses: number
  tools: { rag: boolean; kg: boolean; evidence: boolean; simulation: boolean; web: boolean }
  verbosity: 'terse' | 'normal' | 'verbose'
}

export interface DiscoverySessionDetail extends DiscoverySessionSummary {
  agent_config: DiscoveryAgentConfig
  messages: DiscoveryMessage[]
  notes: string | null
}

// ── Compute Lab — server-side regression with diagnostics ────────
export interface RegressionResult {
  n: number
  slope: number
  intercept: number
  r2: number
  rmse: number
  se_slope: number
  se_intercept: number
  t_stat: number
  p_value: number
  ci_slope: [number, number]
  ci_intercept: [number, number]
  fitted: number[]
  residuals: number[]
  leverages: number[]
  cooks_d: number[]
  cook_threshold: number
}

export const api = {
  // ── Projects ──────────────────────────────────────────────────

  async getProjects(params?: PaginationParams & { search?: string; status?: string }): Promise<PaginatedResponse<Project>> {
    const { data } = await apiClient.get('/projects', { params })
    return data
  },

  /**
   * Server-side OLS regression with full diagnostic output. Used by
   * the Compute Lab statistics panel to render Q-Q, residual, and
   * leverage plots without round-tripping the sandboxed code path.
   */
  async runRegression(x: number[], y: number[]): Promise<RegressionResult> {
    const { data } = await apiClient.post('/compute/regression', { x, y })
    return data
  },

  // ── Discovery Sessions (chatbot persistence) ──────────────────

  async listDiscoverySessions(params?: { project_id?: string; q?: string; pinned_only?: boolean; limit?: number }): Promise<DiscoverySessionSummary[]> {
    const { data } = await apiClient.get('/discovery-sessions', { params })
    return data
  },

  async createDiscoverySession(body?: { title?: string; project_id?: string; agent_config?: Partial<DiscoveryAgentConfig>; notes?: string }): Promise<DiscoverySessionDetail> {
    const { data } = await apiClient.post('/discovery-sessions', body || {})
    return data
  },

  async getDiscoverySession(sessionId: string): Promise<DiscoverySessionDetail> {
    const { data } = await apiClient.get(`/discovery-sessions/${sessionId}`)
    return data
  },

  async updateDiscoverySession(sessionId: string, body: { title?: string; pinned?: boolean; agent_config?: Partial<DiscoveryAgentConfig>; notes?: string; project_id?: string; last_run_id?: string }): Promise<DiscoverySessionDetail> {
    const { data } = await apiClient.patch(`/discovery-sessions/${sessionId}`, body)
    return data
  },

  async deleteDiscoverySession(sessionId: string): Promise<void> {
    await apiClient.delete(`/discovery-sessions/${sessionId}`)
  },

  async appendDiscoveryMessage(sessionId: string, message: DiscoveryMessage): Promise<DiscoverySessionDetail> {
    const { data } = await apiClient.post(`/discovery-sessions/${sessionId}/append`, { message })
    return data
  },

  async forkDiscoverySession(sessionId: string): Promise<DiscoverySessionDetail> {
    const { data } = await apiClient.post(`/discovery-sessions/${sessionId}/fork`)
    return data
  },

  // ── Citation Library (Mendeley-equivalent reference manager) ──

  async listLibraryCitations(params?: {
    q?: string; starred_only?: boolean; unread_only?: boolean;
    tag?: string; folder?: string; year?: number; author?: string;
    project_id?: string; limit?: number; offset?: number;
  }): Promise<LibraryCitation[]> {
    const { data } = await apiClient.get('/citations', { params })
    return data
  },
  async createLibraryCitation(body: Partial<LibraryCitation>): Promise<LibraryCitation> {
    const { data } = await apiClient.post('/citations', body)
    return data
  },
  async getLibraryCitation(id: string): Promise<LibraryCitation> {
    const { data } = await apiClient.get(`/citations/${id}`)
    return data
  },
  async updateLibraryCitation(id: string, body: Partial<LibraryCitation>): Promise<LibraryCitation> {
    const { data } = await apiClient.patch(`/citations/${id}`, body)
    return data
  },
  async deleteLibraryCitation(id: string): Promise<void> {
    await apiClient.delete(`/citations/${id}`)
  },
  async bulkDeleteLibraryCitations(ids: string[]): Promise<{ deleted_count: number }> {
    const { data } = await apiClient.post('/citations/bulk-delete', { ids })
    return data
  },
  async listLibraryFolders(params?: { project_id?: string }): Promise<LibraryFolder[]> {
    const { data } = await apiClient.get('/citation-folders', { params })
    return data
  },
  async createLibraryFolder(body: { name: string; parent_id?: string; color?: string; icon?: string; order_index?: number; project_id?: string }): Promise<LibraryFolder> {
    const { data } = await apiClient.post('/citation-folders', body)
    return data
  },
  async updateLibraryFolder(id: string, body: Partial<LibraryFolder>): Promise<LibraryFolder> {
    const { data } = await apiClient.patch(`/citation-folders/${id}`, body)
    return data
  },
  async deleteLibraryFolder(id: string): Promise<void> {
    await apiClient.delete(`/citation-folders/${id}`)
  },
  async listLibraryHighlights(citationId: string): Promise<LibraryHighlight[]> {
    const { data } = await apiClient.get(`/citations/${citationId}/highlights`)
    return data
  },
  async createLibraryHighlight(citationId: string, body: Omit<LibraryHighlight, 'id' | 'created_at' | 'updated_at'>): Promise<LibraryHighlight> {
    const { data } = await apiClient.post(`/citations/${citationId}/highlights`, body)
    return data
  },
  async updateLibraryHighlight(id: string, body: Partial<LibraryHighlight>): Promise<LibraryHighlight> {
    const { data } = await apiClient.patch(`/citation-highlights/${id}`, body)
    return data
  },
  async deleteLibraryHighlight(id: string): Promise<void> {
    await apiClient.delete(`/citation-highlights/${id}`)
  },
  async importLibraryCitations(body: { format: 'bibtex' | 'ris' | 'csl' | 'endnote'; text: string; project_id?: string }): Promise<{ imported: number; skipped_duplicates: number; citations: LibraryCitation[] }> {
    const { data } = await apiClient.post('/citations/import', body)
    return data
  },
  async exportLibraryCitations(body: { format: 'bibtex' | 'ris' | 'csl'; ids?: string[]; project_id?: string }): Promise<Blob | { items: Record<string, unknown>[]; count: number }> {
    if (body.format === 'csl') {
      const { data } = await apiClient.post('/citations/export', body)
      return data
    }
    const resp = await apiClient.post('/citations/export', body, { responseType: 'blob' })
    return resp.data
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Saved research papers — durable persistence for AI-generated paper
  // HTML artifacts. Replaces the older `research-papers` localStorage key.
  // Listing endpoint omits the (large) paper_html body; fetch with
  // getSavedPaper(id) when the user actually opens the paper viewer.
  //   GET    /v1/saved-papers           — list (owner-scoped, filterable)
  //   POST   /v1/saved-papers           — create after document_pipeline run
  //   GET    /v1/saved-papers/{id}      — fetch full paper_html
  //   DELETE /v1/saved-papers/{id}      — remove from library
  // ═══════════════════════════════════════════════════════════════════════
  async listSavedPapers(params?: {
    project_id?: string; hypothesis_id?: string; limit?: number; offset?: number;
  }): Promise<SavedPaperSummary[]> {
    const { data } = await apiClient.get('/saved-papers', { params })
    return data
  },
  async createSavedPaper(body: SavedPaperCreate): Promise<SavedPaperDetail> {
    const { data } = await apiClient.post('/saved-papers', body)
    return data
  },
  async getSavedPaper(id: string): Promise<SavedPaperDetail> {
    const { data } = await apiClient.get(`/saved-papers/${id}`)
    return data
  },
  async deleteSavedPaper(id: string): Promise<void> {
    await apiClient.delete(`/saved-papers/${id}`)
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Project documents — researcher-uploaded artifacts (PDFs, datasets,
  // IRB approvals, lab notes, manuscripts) attached to a project.
  // Replaces the localStorage 'project-documents' key + IndexedDB blob
  // shards. Listing returns metadata only; /content streams raw bytes.
  //   POST   /v1/project-documents              — multipart upload
  //   GET    /v1/project-documents              — list (project_id filter)
  //   GET    /v1/project-documents/{id}         — metadata
  //   GET    /v1/project-documents/{id}/content — raw file bytes
  //   DELETE /v1/project-documents/{id}         — remove
  // ═══════════════════════════════════════════════════════════════════════
  async listProjectDocuments(params?: {
    project_id?: string; doc_type?: string; limit?: number; offset?: number;
  }): Promise<ProjectDocumentSummary[]> {
    const { data } = await apiClient.get('/project-documents', { params })
    return data
  },
  async uploadProjectDocument(
    file: File,
    fields: ProjectDocumentUploadFields,
  ): Promise<ProjectDocumentSummary> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('project_id', fields.project_id)
    fd.append('title', fields.title)
    fd.append('doc_type', fields.doc_type || 'Other')
    if (fields.authors) fd.append('authors', fields.authors)
    if (fields.document_date) fd.append('document_date', fields.document_date)
    if (fields.description) fd.append('description', fields.description)
    if (fields.tags && fields.tags.length > 0) fd.append('tags', fields.tags.join(','))
    fd.append('knowledge_base', fields.knowledge_base || 'private')
    const { data } = await apiClient.post('/project-documents', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
  async getProjectDocument(id: string): Promise<ProjectDocumentSummary> {
    const { data } = await apiClient.get(`/project-documents/${id}`)
    return data
  },
  async getProjectDocumentContent(id: string): Promise<Blob> {
    const resp = await apiClient.get(`/project-documents/${id}/content`, {
      responseType: 'blob',
    })
    return resp.data
  },
  async deleteProjectDocument(id: string): Promise<void> {
    await apiClient.delete(`/project-documents/${id}`)
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Hypothesis trace + Merkle-anchored audit log replay (the /provenance
  // product surface, shipped Round 10 commit 2).
  //   GET /v1/hypotheses/{id}/trace      → per-claim citation chain
  //   GET /v1/hypotheses/{id}/audit-log  → Merkle event log + chain check
  // ═══════════════════════════════════════════════════════════════════════

  async getHypothesisTrace(id: string): Promise<HypothesisTraceResponse> {
    const { data } = await apiClient.get(`/hypotheses/${id}/trace`)
    return data
  },
  async getHypothesisAuditLog(
    id: string,
    params?: { limit?: number },
  ): Promise<AuditLogResponse> {
    const { data } = await apiClient.get(`/hypotheses/${id}/audit-log`, { params })
    return data
  },

  // ═══════════════════════════════════════════════════════════════════════
  // User budget + KG permissions + royalties
  //   /v1/user/{uid}/budget              — monthly cap + status
  //   /v1/user/{uid}/budget/usage        — last N days usage breakdown
  //   /v1/kg/documents/{did}/permission  — private | common toggle
  //   /v1/kg/user/{uid}/royalties        — royalty summary
  //   /v1/kg/user/{uid}/kg/overview      — node counts + coverage
  // ═══════════════════════════════════════════════════════════════════════

  async getUserBudget(userId: string): Promise<{
    user_id: string
    monthly_budget_usd: number
    current_spend_usd: number
    remaining_usd: number
    percent_used: number
    status: 'ok' | 'warning' | 'blocked'
    hard_limit: boolean
    alert_threshold_pct: number
    current_month_starts: string
    notification_email: string | null
    message: string | null
  }> {
    const { data } = await apiClient.get(`/user/${encodeURIComponent(userId)}/budget`)
    return data
  },

  async updateUserBudget(
    userId: string,
    body: {
      monthly_budget_cents: number
      alert_threshold_pct?: number
      hard_limit?: boolean
      notification_email?: string | null
    },
  ): Promise<{
    user_id: string
    monthly_budget_usd: number
    current_spend_usd: number
    remaining_usd: number
    percent_used: number
    status: 'ok' | 'warning' | 'blocked'
    hard_limit: boolean
    alert_threshold_pct: number
    message: string | null
  }> {
    const { data } = await apiClient.put(
      `/user/${encodeURIComponent(userId)}/budget`,
      body,
    )
    return data
  },

  async getUserBudgetUsage(userId: string, days = 30): Promise<{
    period_start: string
    period_end: string
    total_spend_usd: number
    by_run_kind: Array<{ run_kind: string; runs: number }>
    by_model: Array<{ model: string; cost_usd: number; input_tokens: number; output_tokens: number; n_calls: number }>
    by_day: Array<{ day: string; cost_cents: number; n_calls: number }>
    total_runs: number
    total_hypotheses_generated: number
    total_papers_generated: number
  }> {
    const { data } = await apiClient.get(
      `/user/${encodeURIComponent(userId)}/budget/usage`,
      { params: { days } },
    )
    return data
  },

  // Stripe Customer Portal — returns a short-lived URL the frontend
  // opens in a new tab so the user can update card / cancel / download
  // invoices on Stripe's hosted UI. 409 from the server means the user
  // hasn't started any billing relationship yet (trial / free tier);
  // callers should branch on that to show a "no billing yet" hint
  // rather than a generic error.
  async createBillingPortalSession(
    returnUrl?: string,
  ): Promise<{ url: string; return_url: string; expires_at: number | null }> {
    const { data } = await apiClient.post(
      '/account/billing/portal-session',
      returnUrl ? { return_url: returnUrl } : {},
    )
    return data
  },

  // GDPR Art. 20 (data export) — returns a ZIP blob the UI prompts
  // the user to save. The backend streams the archive so memory
  // footprint stays bounded; we receive it as a Blob and dispatch
  // a synthetic <a download> click. Don't JSON-parse the response.
  async exportAccountData(): Promise<Blob> {
    const { data } = await apiClient.get('/account/export', {
      responseType: 'blob',
    })
    return data as Blob
  },

  // GDPR Art. 17 (right to erasure) — soft-deletes the account
  // immediately and schedules the hard-delete cron to fire 30 days
  // later. Repeated calls are idempotent (same scheduled_hard_delete_at
  // returns). Restoring inside the window requires a support ticket
  // for now (no self-serve restore endpoint).
  async requestAccountDeletion(): Promise<{
    status: string
    requested_at: string
    scheduled_hard_delete_at: string
    grace_window_days: number
    message: string
  }> {
    const { data } = await apiClient.post('/account/delete')
    return data
  },

  // Pricing tiers + upgrade flow. The /pricing/tiers endpoint is
  // PUBLIC (no auth) so trial users can see what they'd be paying
  // for before they hit checkout. /billing/checkout returns a Stripe
  // Checkout URL that we open in a new tab.
  async getPricingTiers(): Promise<{
    tiers: Array<{
      key: 'trial' | 'researcher' | 'lab' | 'institution'
      name: string
      tagline: string
      monthly_price_cents: number
      annual_price_cents: number
      monthly_cap_cents: number
      monthly_runs_at_default_n: number
      features: string[]
      stripe_price_id_monthly: string | null
      stripe_price_id_annual: string | null
    }>
    overage_per_run_cents: number
    trial_days: number
    annual_discount_pct: number
    currency: string
    note: string
  }> {
    const { data } = await apiClient.get('/pricing/tiers')
    return data
  },

  async getBillingStatus(): Promise<{
    tier: string
    monthly_cap_cents: number
    spend_cents: number
    has_paid_subscription: boolean
    subscription_status: string | null
  }> {
    const { data } = await apiClient.get('/billing/status')
    return data
  },

  async startBillingCheckout(targetTier: 'researcher' | 'lab' | 'institution'): Promise<{
    checkout_url: string
  }> {
    const { data } = await apiClient.post('/billing/checkout', {
      target_tier: targetTier,
    })
    return data
  },

  // Promo code redemption. preview = lookup (no side effect);
  // redeem applies the code. 404 from preview means the code is
  // unknown/expired/revoked. 400 from redeem includes the human
  // reason (one-shot already used, email-domain restricted, etc.).
  async previewPromoCode(code: string): Promise<{
    code: string
    kind: 'percent_off' | 'fixed_cents_off' | 'trial_extension'
    value: number
    description: string | null
    expires_at: string | null
  }> {
    const { data } = await apiClient.get(
      `/account/preview-code/${encodeURIComponent(code)}`,
    )
    return data
  },

  async redeemPromoCode(code: string): Promise<{
    status: string
    code: string
    kind: 'percent_off' | 'fixed_cents_off' | 'trial_extension'
    value: number
    new_trial_ends_at: string | null
    stripe_coupon_id: string | null
    message: string
  }> {
    const { data } = await apiClient.post('/account/redeem-code', { code })
    return data
  },

  // API keys (account-scoped). The raw token is only ever returned
  // on POST /api-keys; list/get must never include it. Callers must
  // surface the raw token to the user once and then discard it.
  async listApiKeys(): Promise<{
    keys: Array<{
      id: string
      name: string
      prefix: string
      scopes: string[]
      created_at: string
      expires_at: string | null
      last_used_at: string | null
      revoked_at: string | null
    }>
    count: number
  }> {
    const { data } = await apiClient.get('/account/api-keys')
    return data
  },

  async createApiKey(body: {
    name: string
    scopes?: string[]
    expires_at?: string | null
  }): Promise<{
    id: string
    name: string
    prefix: string
    scopes: string[]
    created_at: string
    expires_at: string | null
    raw_token: string
    warning: string
  }> {
    const { data } = await apiClient.post('/account/api-keys', body)
    return data
  },

  async revokeApiKey(keyId: string): Promise<{ status: string; key_id: string }> {
    const { data } = await apiClient.delete(
      `/account/api-keys/${encodeURIComponent(keyId)}`,
    )
    return data
  },

  // Cancel subscription at period end. The server records the
  // reason regardless of Stripe outcome (so analytics survives a
  // Stripe outage), then schedules cancel_at_period_end=true on
  // Stripe. UI gets a 409 when the user has no active sub.
  async cancelSubscription(body: {
    reason_category:
      | 'price' | 'features' | 'bug' | 'churn' | 'no_longer_needed' | 'other'
    reason_text?: string
  }): Promise<{
    reason_recorded: boolean
    stripe: { status: string; cancel_at?: number | null; reason?: string }
    message: string
  }> {
    const { data } = await apiClient.post('/account/cancel-subscription', body)
    return data
  },

  // Billing-interval preference (monthly / annual). The actual
  // Stripe subscription swap still happens in the Customer Portal;
  // this just persists the user's preference locally so the
  // cost-preview projections render the right cadence.
  async getBillingInterval(): Promise<{ billing_interval: 'monthly' | 'annual' }> {
    const { data } = await apiClient.get('/account/billing-interval')
    return data
  },

  async updateBillingInterval(
    interval: 'monthly' | 'annual',
  ): Promise<{
    status: string
    billing_interval: 'monthly' | 'annual'
    note: string
  }> {
    const { data } = await apiClient.put('/account/billing-interval', {
      billing_interval: interval,
    })
    return data
  },

  // Admin refund operations — see backend admin_billing.py.
  // listAdminRefunds: paginated history newest first, optionally
  // filtered by status. The dashboard shows recent attempts including
  // failures so ops can spot patterns.
  // issueAdminRefund: POST a refund to a specific invoice. amountCents
  // omitted means refund the full invoice amount_paid. Reason MUST
  // match the backend enum (duplicate / fraudulent / requested_by_customer
  // / other); the server validates and 400s on mismatch.
  async listAdminRefunds(opts: {
    limit?: number
    offset?: number
    status?: 'succeeded' | 'pending' | 'failed'
  } = {}): Promise<{
    refunds: Array<{
      id: string
      user_id: string
      issued_by_admin_id: string | null
      stripe_invoice_id: string
      stripe_charge_id: string | null
      stripe_refund_id: string | null
      amount_cents: number
      currency: string
      reason: string
      reason_text: string | null
      status: 'succeeded' | 'pending' | 'failed'
      error_message: string | null
      created_at: string | null
    }>
    count: number
  }> {
    const params: Record<string, string | number> = {
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    }
    if (opts.status) params.status_filter = opts.status
    const { data } = await apiClient.get('/admin/billing/refunds', { params })
    return data
  },

  async issueAdminRefund(
    invoiceId: string,
    body: {
      reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'other'
      reason_text?: string
      amount_cents?: number
    },
  ): Promise<{
    invoice_id: string
    refund_id: string | null
    status: 'succeeded' | 'pending' | 'failed'
    amount_cents: number
    currency: string
    error_message: string | null
  }> {
    const { data } = await apiClient.post(
      `/admin/billing/refund/${encodeURIComponent(invoiceId)}`,
      body,
    )
    return data
  },

  async getDocumentPermission(userId: string, documentId: string): Promise<{
    document_id: string
    user_id: string
    permission: 'private' | 'common'
    note: string | null
  }> {
    const { data } = await apiClient.get(
      `/kg/documents/${encodeURIComponent(documentId)}/permission`,
      { params: { user_id: userId } },
    )
    return data
  },

  async setDocumentPermission(
    userId: string,
    documentId: string,
    permission: 'private' | 'common',
  ): Promise<{
    document_id: string
    user_id: string
    permission: 'private' | 'common'
    note: string | null
  }> {
    const { data } = await apiClient.put(
      `/kg/documents/${encodeURIComponent(documentId)}/permission`,
      { user_id: userId, permission },
    )
    return data
  },

  async getUserRoyalties(userId: string, days = 30): Promise<{
    user_id: string
    window_days: number
    by_kind: Array<{ event_kind: string; n: number; weight: number }>
    total_weight: number
    note: string | null
  }> {
    const { data } = await apiClient.get(
      `/kg/user/${encodeURIComponent(userId)}/royalties`,
      { params: { days } },
    )
    return data
  },

  async getUserKGOverview(userId: string): Promise<{
    user_id: string
    private_nodes: number
    private_edges: number
    common_contributions: number
    royalty_weight_all_time: number
  }> {
    const { data } = await apiClient.get(
      `/kg/user/${encodeURIComponent(userId)}/kg/overview`,
    )
    return data
  },

  async getProjectKG(
    projectId: string,
    opts?: { userId?: string; maxNodes?: number; includeAncestors?: boolean },
  ): Promise<{
    project_id: string
    nodes: Array<{
      id: string; name: string; kind: string; scope: string;
      group: string; color: string; shape: string; size: number;
      canonical_id?: string; payload?: Record<string, unknown>;
    }>
    links: Array<{
      source: string; target: string; relation: string;
      confidence: number; color: string; scope: string;
    }>
    stats: {
      nodes: number; edges: number;
      project_private: number; project_common: number; public_domain: number;
    }
  }> {
    const params: Record<string, unknown> = {}
    if (opts?.userId) params.user_id = opts.userId
    if (opts?.maxNodes) params.max_nodes = opts.maxNodes
    if (opts?.includeAncestors !== undefined)
      params.include_ancestors = opts.includeAncestors
    const { data } = await apiClient.get(
      `/projects/${encodeURIComponent(projectId)}/kg`,
      { params },
    )
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

  async bulkDeleteProjects(ids: string[]): Promise<{ deleted: string[]; requested: number; deleted_count: number }> {
    const { data } = await apiClient.post('/projects/bulk-delete', { ids })
    return data
  },

  async bulkArchiveProjects(ids: string[], restore = false): Promise<{ updated: string[]; status: string; updated_count: number }> {
    const { data } = await apiClient.post('/projects/bulk-archive', { ids }, { params: restore ? { restore: true } : {} })
    return data
  },

  async archiveProject(id: string, restore = false): Promise<Project> {
    const { data } = await apiClient.patch(`/projects/${id}`, { status: restore ? 'active' : 'archived' })
    return data
  },

  async getProjectStats(id: string): Promise<unknown> {
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

  async getGenerationStatus(taskId: string): Promise<unknown> {
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

  async addEvidenceToHypothesis(hypothesisId: string, evidenceRef: Partial<EvidenceRef>): Promise<unknown> {
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

  async bulkCreateEvidence(items: EvidenceCreate[]): Promise<unknown> {
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
    try {
      const { data } = await apiClient.get('/knowledge/stats')
      return data
    } catch { /* API unavailable — return empty stats */
      return { total_entities: 0, total_relations: 0, entity_counts: {}, relation_counts: {}, last_updated: '' }
    }
  },

  async getEntityTypes(): Promise<string[]> {
    const { data } = await apiClient.get('/knowledge/entity-types')
    return data
  },

  async getRelationTypes(): Promise<string[]> {
    const { data } = await apiClient.get('/knowledge/relation-types')
    return data
  },

  async queryCypher(query: string): Promise<unknown> {
    const { data } = await apiClient.post('/knowledge/query', { query })
    return data
  },

  // ── RAG ───────────────────────────────────────────────────────

  async ragQuery(request: RAGQuery): Promise<RAGResult> {
    const { data } = await apiClient.post('/rag/query', request)
    return data
  },

  async ragContext(query: string, params?: { max_tokens?: number; source_types?: string[] }): Promise<unknown> {
    const { data } = await apiClient.post('/rag/context', { query, ...params })
    return data
  },

  async ragSimilar(documentId: string, params?: { top_k?: number }): Promise<unknown> {
    const { data } = await apiClient.post('/rag/similar', { document_id: documentId, ...params })
    return data
  },

  async ragGraphContext(entities: string[]): Promise<unknown> {
    const { data } = await apiClient.post('/rag/graph-context', { entities })
    return data
  },

  async ragStats(): Promise<unknown> {
    const { data } = await apiClient.get('/rag/stats')
    return data
  },

  async ragHealth(): Promise<unknown> {
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

  async getIngestionSources(): Promise<Array<Record<string, unknown>>> {
    const { data } = await apiClient.get('/ingestion/sources')
    return data
  },

  async uploadDocument(file: File, params?: { project_id?: string }): Promise<{ id?: string; document_id?: string; job_id?: string; [k: string]: unknown }> {
    const formData = new FormData()
    formData.append('file', file)
    if (params?.project_id) formData.append('project_id', params.project_id)
    const { data } = await apiClient.post('/ingestion/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  async getIngestionQueueStats(): Promise<unknown> {
    const { data } = await apiClient.get('/ingestion/queue/stats')
    return data
  },

  // ── Simulations ───────────────────────────────────────────────

  async getSimulations(params?: PaginationParams & { project_id?: string; hypothesis_id?: string; status?: string }): Promise<PaginatedResponse<Simulation>> {
    const { data } = await apiClient.get('/simulations', { params })
    return data
  },

  async getSimulation(id: string): Promise<Simulation> {
    const { data } = await apiClient.get(`/simulations/${id}`)
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
    const { data } = await apiClient.post('/simulations', simulation)
    return data
  },

  async getSimulationResults(id: string): Promise<unknown> {
    const { data } = await apiClient.get(`/simulations/${id}/results`)
    return data
  },

  async cancelSimulation(id: string): Promise<Simulation> {
    const { data } = await apiClient.post(`/simulations/${id}/cancel`)
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

  async cancelAgentTask(id: string): Promise<unknown> {
    const { data } = await apiClient.post(`/agents/tasks/${id}/cancel`)
    return data
  },

  async runSearch(query: string, sources?: string[], maxResults?: number): Promise<{ query: string; results: Array<{ title: string; url: string; snippet?: string; source: string; relevance_score: number }>; total_results: number }> {
    const { data } = await apiClient.post('/agents/search', { query, sources, max_results: maxResults })
    return data
  },

  // ── Orchestrator ──────────────────────────────────────────────

  async startDiscovery(config?: DiscoveryConfig): Promise<{ project_id?: string; project_name?: string; [k: string]: unknown }> {
    const { data } = await apiClient.post('/orchestrator/start', config)
    return data
  },

  async getOrchestratorStatus(): Promise<OrchestratorStatus> {
    const { data } = await apiClient.get('/orchestrator/status')
    return data
  },

  async pauseDiscovery(): Promise<unknown> {
    const { data } = await apiClient.post('/orchestrator/pause')
    return data
  },

  async resumeDiscovery(): Promise<unknown> {
    const { data } = await apiClient.post('/orchestrator/resume')
    return data
  },

  async stopDiscovery(): Promise<unknown> {
    const { data } = await apiClient.post('/orchestrator/stop')
    return data
  },

  async saveDiscoveryToProject(projectName?: string): Promise<{ status: string; project_id: string; name: string; hypothesis_count: number; message: string }> {
    const { data } = await apiClient.post('/orchestrator/save-to-project', null, {
      params: projectName ? { project_name: projectName } : undefined,
    })
    return data
  },

  async generatePaper(): Promise<unknown> {
    const { data } = await apiClient.post('/orchestrator/paper/generate')
    return data
  },

  async getPaperStatus(): Promise<unknown> {
    const { data } = await apiClient.get('/orchestrator/paper/status')
    return data
  },

  async generatePaperMarkdown(): Promise<string> {
    const { data } = await apiClient.post('/orchestrator/generate-paper/markdown')
    return data
  },

  // ── Discovery Analysis ────────────────────────────────────────

  async analyzeDisease(config: DiscoveryConfig): Promise<unknown> {
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
    // Try backend /activities first (Mega-P wired this up); fall back
    // to localStorage so the dev loop and offline sessions still work.
    // The localStorage path remains authoritative for user-generated
    // activity until the writer paths also move backend-side.
    let backendItems: Activity[] = []
    try {
      const { data } = await apiClient.get('/activities', {
        params: {
          page: params?.page ?? 1,
          page_size: params?.page_size ?? 200,
          type: params?.type,
          action: params?.action,
          date_from: params?.date_from,
          date_to: params?.date_to,
        },
        // This path is non-fatal; hide the error toast.
        headers: { 'X-Silent-Error': '1' },
      })
      backendItems = (data?.items ?? []) as Activity[]
    } catch {
      /* backend unreachable — pure localStorage path below */
    }

    const raw = JSON.parse(localStorage.getItem('humanovo-activity-log') || '[]') as Array<Activity & { timestamp?: string }>
    // Normalize: ensure created_at is set (legacy items may only have timestamp)
    const localItems: Activity[] = raw.map(a => ({
      ...a,
      created_at: a.created_at || a.timestamp || new Date().toISOString(),
    }))

    // Merge + dedup by id (backend wins on conflict).
    const byId = new Map<string, Activity>()
    for (const a of localItems) if (a.id) byId.set(a.id, a)
    for (const a of backendItems) if (a.id) byId.set(a.id, a)
    let all = Array.from(byId.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )

    if (params?.type)      all = all.filter(a => a.type === params.type)
    if (params?.action)    all = all.filter(a => a.action === params.action)
    if (params?.date_from) {
      const from = new Date(params.date_from).getTime()
      all = all.filter(a => new Date(a.created_at).getTime() >= from)
    }
    if (params?.date_to) {
      const to = new Date(params.date_to).getTime()
      all = all.filter(a => new Date(a.created_at).getTime() <= to)
    }

    const page = params?.page || 1
    const pageSize = params?.page_size || 200
    const start = (page - 1) * pageSize
    return { items: all.slice(start, start + pageSize), total: all.length, page, page_size: pageSize }
  },

  async getActivity(id: string): Promise<Activity> {
    const all = JSON.parse(localStorage.getItem('humanovo-activity-log') || '[]') as Activity[]
    const found = all.find((a) => a.id === id)
    if (!found) throw new Error('Activity not found')
    return found
  },

  async updateActivity(id: string, update: { annotation?: string; description?: string }): Promise<Activity> {
    const all = JSON.parse(localStorage.getItem('humanovo-activity-log') || '[]') as Activity[]
    const idx = all.findIndex((a) => a.id === id)
    if (idx === -1) throw new Error('Activity not found')
    Object.assign(all[idx], update)
    localStorage.setItem('humanovo-activity-log', JSON.stringify(all))
    return all[idx]
  },

  async deleteActivity(id: string): Promise<void> {
    const all = JSON.parse(localStorage.getItem('humanovo-activity-log') || '[]') as Activity[]
    localStorage.setItem('humanovo-activity-log', JSON.stringify(all.filter((a) => a.id !== id)))
  },

  // ── Experiments ───────────────────────────────────────────────

  async getExperiments(params?: PaginationParams & { status?: string; project_id?: string }): Promise<PaginatedResponse<Record<string, unknown>>> {
    const { data } = await apiClient.get('/experiments', { params })
    return data
  },
  async getExperiment(id: string): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get(`/experiments/${id}`)
    return data
  },
  async createExperiment(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await apiClient.post('/experiments', body)
    return data
  },
  async updateExperiment(id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await apiClient.patch(`/experiments/${id}`, body)
    return data
  },
  async deleteExperiment(id: string): Promise<void> {
    await apiClient.delete(`/experiments/${id}`)
  },

  // ── Datasets ──────────────────────────────────────────────────

  async getDatasets(params?: PaginationParams): Promise<PaginatedResponse<Record<string, unknown>>> {
    const { data } = await apiClient.get('/datasets', { params })
    return data
  },
  async getDataset(id: string): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get(`/datasets/${id}`)
    return data
  },
  async createDataset(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await apiClient.post('/datasets', body)
    return data
  },
  async updateDataset(id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await apiClient.patch(`/datasets/${id}`, body)
    return data
  },
  async deleteDataset(id: string): Promise<void> {
    await apiClient.delete(`/datasets/${id}`)
  },

  // ── Imaging ───────────────────────────────────────────────────

  async getImagingStudies(params?: PaginationParams): Promise<PaginatedResponse<Record<string, unknown>>> {
    const { data } = await apiClient.get('/imaging/studies', { params })
    return data
  },
  async getImagingStudy(id: string): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get(`/imaging/studies/${id}`)
    return data
  },
  async createImagingStudy(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await apiClient.post('/imaging/studies', body)
    return data
  },
  async deleteImagingStudy(id: string): Promise<void> {
    await apiClient.delete(`/imaging/studies/${id}`)
  },

  // ── Management lists (bulk-delete where available) ────────────

  async getClinicalTrials(): Promise<{ items: Array<Record<string, unknown>>; total?: number }> {
    const { data } = await apiClient.get('/clinical-trials')
    return data
  },
  async bulkDeleteClinicalTrials(ids: string[]): Promise<BulkDeleteResult> {
    const { data } = await apiClient.post('/clinical-trials/bulk-delete', { ids })
    return data
  },
  async bulkArchiveClinicalTrials(ids: string[], restore = false): Promise<BulkArchiveResult> {
    const { data } = await apiClient.post('/clinical-trials/bulk-archive', { ids }, { params: restore ? { restore: true } : {} })
    return data
  },
  async getManuscripts(): Promise<{ items: Array<Record<string, unknown>>; total?: number }> {
    const { data } = await apiClient.get('/manuscripts')
    return data
  },
  async bulkDeleteManuscripts(ids: string[]): Promise<BulkDeleteResult> {
    const { data } = await apiClient.post('/manuscripts/bulk-delete', { ids })
    return data
  },
  async bulkArchiveManuscripts(ids: string[], restore = false): Promise<BulkArchiveResult> {
    const { data } = await apiClient.post('/manuscripts/bulk-archive', { ids }, { params: restore ? { restore: true } : {} })
    return data
  },
  async getBiobankSamples(params?: Record<string, unknown>): Promise<{ items: Array<Record<string, unknown>>; total?: number }> {
    const { data } = await apiClient.get('/biobank/samples', { params })
    return data
  },
  async bulkDeleteBiobankSamples(ids: string[]): Promise<BulkDeleteResult> {
    const { data } = await apiClient.post('/biobank/samples/bulk-delete', { ids })
    return data
  },
  async bulkArchiveBiobankSamples(ids: string[], restore = false): Promise<BulkArchiveResult> {
    const { data } = await apiClient.post('/biobank/samples/bulk-archive', { ids }, { params: restore ? { restore: true } : {} })
    return data
  },
  async getMLModels(): Promise<{ items: Array<Record<string, unknown>>; total?: number }> {
    const { data } = await apiClient.get('/ml-models')
    return data
  },

  // ── Monitoring ────────────────────────────────────────────────

  async getHealthCheck(): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get('/monitoring/health')
    return data
  },

  async getSystemMetrics(): Promise<Record<string, unknown>> {
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
        type EvidenceItem = { id: string; title: string; abstract?: string; snippet?: string; source_type?: string; relevance_score?: number; authors?: unknown; journal?: string; doi?: string; citation_count?: number; created_at?: string; tags?: string[] }
        ;(r.data.items || []).forEach((item: EvidenceItem) => {
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

      // Search knowledge graph entities — merge exact-match + vector.
      // Legacy /knowledge/entities/search handles alias matches; the
      // new /knowledge-graph/search/similar adds pgvector cosine
      // ranking. We merge the two here so the downstream dedup sees a
      // single entity-id space (no `vec:` prefix kludge). If the same
      // entity appears in both streams, vector-similarity wins because
      // it carries an actually-useful score; otherwise we keep alias
      // match's static 0.7 relevance.
      Promise.allSettled([
        apiClient.get('/knowledge/entities/search', {
          params: { query, limit: params?.limit || 10 },
        }),
        apiClient.post('/knowledge-graph/search/similar', {
          query, limit: params?.limit || 10,
        }),
      ]).then(([aliasRes, vectorRes]) => {
        const byId: Record<string, SearchResult> = {}
        if (aliasRes.status === 'fulfilled') {
          type EntityHit = { id: string; name: string; description?: string; entity_type: string; source_count?: number; aliases?: string[]; external_ids?: Record<string, string> }
          ;((aliasRes.value.data || []) as EntityHit[]).forEach((item) => {
            byId[item.id] = {
              id: item.id,
              type: 'entity',
              title: item.name,
              snippet: item.description || `${item.entity_type} with ${item.source_count} sources`,
              source: item.entity_type,
              source_type: item.entity_type,
              relevance_score: 0.7,
              metadata: { entity_type: item.entity_type, aliases: item.aliases, external_ids: item.external_ids, alias_match: true },
              tags: item.aliases || [],
            }
          })
        }
        if (vectorRes.status === 'fulfilled') {
          type VectorEntity = { id: string; name: string; description?: string; entity_type: string; category?: string; aliases?: string[]; synonyms?: string[]; external_ids?: Record<string, string> }
          ;((vectorRes.value.data as Array<{ entity: VectorEntity; similarity: number }>) || []).forEach(row => {
            const existing = byId[row.entity.id]
            const relevance = Math.max(0, row.similarity)
            const merged: SearchResult = {
              id: row.entity.id,
              type: 'entity',
              title: row.entity.name,
              snippet: row.entity.description ||
                `${row.entity.category} · vector match (cos=${row.similarity.toFixed(3)})`,
              source: row.entity.category || row.entity.entity_type,
              source_type: row.entity.category || row.entity.entity_type,
              relevance_score: existing
                ? Math.max(existing.relevance_score, relevance)
                : relevance,
              metadata: {
                ...(existing?.metadata || {}),
                entity_type: row.entity.category,
                similarity: row.similarity,
                vector_match: true,
              },
              tags: existing?.tags || row.entity.synonyms || [],
            }
            byId[row.entity.id] = merged
          })
        }
        Object.values(byId).forEach(r => results.push(r))
      }),

      // Search projects
      apiClient.get('/projects', { params: { search: query, page_size: 10 } }).then(r => {
        type ProjectHit = { id: string; name: string; description?: string; research_question?: string; disease_focus?: string; hypothesis_count?: number; evidence_count?: number; created_at?: string; tags?: string[] }
        ;((r.data.items || []) as ProjectHit[]).forEach((item) => {
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
      apiClient.get('/hypotheses', { params: { page_size: 10 } }).then((r) => {
        type HypothesisHit = { id: string; statement: string; mechanism?: string; rationale?: string; confidence_score?: number; novelty_score?: number; status?: string; created_at?: string; tags?: string[] }
        const items = ((r.data.items || []) as HypothesisHit[]).filter((item) =>
          item.statement?.toLowerCase().includes(query.toLowerCase()) ||
          item.mechanism?.toLowerCase().includes(query.toLowerCase())
        )
        items.forEach((item) => {
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
      apiClient.post('/rag/query', { query, top_k: params?.limit || 10 }).then((r) => {
        type RagHit = { id?: string; title?: string; content?: string; source_type?: string; relevance_score?: number; metadata?: Record<string, unknown> }
        ;((r.data.results || []) as RagHit[]).forEach((item) => {
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

  // ── Discovery Pipeline ──────────────────────────────

  async startProjectDiscovery(projectId: string, config: {
    disease: string
    discovery_type: string
    external_factors?: string[]
    num_rounds?: number
    hypotheses_per_round?: number
    output_format?: string
    verbosity?: string
    grant_type?: string
    citation_style?: string
  }): Promise<{ run_id: string; websocket_url: string; status: string }> {
    const { data } = await apiClient.post(`/projects/${projectId}/discover`, config)
    return data
  },

  async listAllDiscoveryRuns(params?: { status?: string; limit?: number; offset?: number }): Promise<{
    items: Array<{
      run_id: string
      project_id: string | null
      disease: string
      discovery_type: string
      status: string
      total_hypotheses: number
      best_confidence: number
      total_cost_usd?: number
      total_duration_seconds?: number
      stages_total?: number
      stages_succeeded?: number
      focus_entities?: string[]
      created_at: string
      completed_at: string | null
    }>
    total: number
    limit: number
    offset: number
  }> {
    const { data } = await apiClient.get('/discovery-runs', { params })
    return data
  },

  async listDiscoveryRuns(projectId: string, params?: { status?: string; limit?: number; offset?: number }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const { data } = await apiClient.get(`/projects/${projectId}/discovery-runs`, { params })
    return data
  },

  async getDiscoveryRun(runId: string): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get(`/discovery-runs/${runId}`)
    return data
  },

  async cancelDiscoveryRun(runId: string): Promise<unknown> {
    const { data } = await apiClient.delete(`/discovery-runs/${runId}`)
    return data
  },

  async listProjectHypotheses(projectId: string, params?: { limit?: number; offset?: number }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const { data } = await apiClient.get(`/projects/${projectId}/hypotheses`, { params })
    return data
  },

  async getProjectHypothesis(projectId: string, hypothesisId: string): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get(`/projects/${projectId}/hypotheses/${hypothesisId}`)
    return data
  },

  async submitHypothesisFeedback(hypothesisId: string, feedback: {
    overall_quality: number
    dimension_scores: Record<string, number>
    boolean_flags?: Record<string, boolean>
    tags?: string[]
    free_text?: string
  }): Promise<unknown> {
    const { data } = await apiClient.post(`/hypotheses/${hypothesisId}/feedback`, feedback)
    return data
  },

  // ── Synthesis Pipeline ──────────────────────────────

  async startSynthesis(projectId: string, config: {
    hypothesis: string
    field_scope?: string
    output_format?: string
    grant_type?: string
    citation_style?: string
    verbosity?: string
  }): Promise<{ run_id: string; websocket_url: string; status: string }> {
    const { data } = await apiClient.post(`/projects/${projectId}/synthesize`, config)
    return data
  },

  async listSynthesisRuns(projectId: string, params?: { limit?: number; offset?: number }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const { data } = await apiClient.get(`/projects/${projectId}/synthesis-runs`, { params })
    return data
  },

  async getSynthesisRun(projectId: string, runId: string): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get(`/projects/${projectId}/synthesis-runs/${runId}`)
    return data
  },

  // ── Imaging ──────────────────────────────────────────────────

  async uploadImaging(projectId: string, file: File): Promise<Record<string, unknown>> {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post(`/projects/${projectId}/imaging/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  async listImagingRecords(projectId: string): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const { data } = await apiClient.get(`/projects/${projectId}/imaging`)
    return data
  },

  async linkImagingToHypothesis(projectId: string, recordId: string, hypothesisId: string): Promise<unknown> {
    const { data } = await apiClient.post(`/projects/${projectId}/imaging/${recordId}/link-hypothesis`, { hypothesis_id: hypothesisId })
    return data
  },

  // ── pgvector Management ──────────────────────────────────────

  async getPgvectorStats(): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get('/dev/pgvector/stats')
    return data
  },

  async pgvectorSearch(query: string, params?: { source?: string; threshold?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const { data } = await apiClient.post('/dev/pgvector/search', { query, ...params })
    return data
  },

  async pgvectorSimilarityTest(query: string): Promise<Record<string, unknown>> {
    const { data } = await apiClient.post('/dev/pgvector/similarity-test', { query })
    return data
  },

  async pgvectorTtlCleanup(): Promise<unknown> {
    const { data } = await apiClient.post('/dev/pgvector/maintenance/ttl-cleanup')
    return data
  },

  async pgvectorReindex(): Promise<unknown> {
    const { data } = await apiClient.post('/dev/pgvector/maintenance/reindex')
    return data
  },

  async pgvectorVacuum(): Promise<unknown> {
    const { data } = await apiClient.post('/dev/pgvector/maintenance/vacuum')
    return data
  },

  async pgvectorMaintenanceStatus(): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get('/dev/pgvector/maintenance/status')
    return data
  },

  // ── Config ──────────────────────────────────────────────────

  async getMethodsTaxonomy(): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get('/config/methods-taxonomy')
    return data
  },

  async getModelPricing(): Promise<Record<string, unknown>> {
    const { data } = await apiClient.get('/config/model-pricing')
    return data
  },

  async getConstitutionalConstraints(): Promise<string> {
    const { data } = await apiClient.get('/config/constitutional-constraints')
    return data
  },

  // ─── Admin ──────────────────────────────────────────────────────
  async getKgStats(): Promise<{
    environment: string
    node_count: number
    edge_count: number
    embedding_count: number
    evidence_count?: number
    evidence_embedding_count?: number
    hypothesis_count?: number
    project_count?: number
    seed_available: boolean
    corpus_seeded?: boolean
  }> {
    const { data } = await apiClient.get('/admin/kg-stats')
    return data
  },
  async seedKg(force = false): Promise<{ ok: boolean; message: string; nodes_after: number; edges_after: number; embeddings_written: number }> {
    const { data } = await apiClient.post('/admin/seed-kg', null, { params: { force } })
    return data
  },
  async seedCorpus(force = false): Promise<{ ok: boolean; message: string; evidence_count_after?: number }> {
    const { data } = await apiClient.post('/admin/seed-corpus', null, { params: { force } })
    return data
  },
  async getAdminHealth(): Promise<{
    status: 'healthy' | 'degraded'
    environment: string
    version: string
    checks: Record<string, string>
    counts: Record<string, number | null>
    last_seen: Record<string, string | null>
    embeddings?: { kg_entity?: number | null; evidence?: number | null }
    flags?: { seed_available?: boolean; corpus_seeded?: boolean }
  }> {
    const { data } = await apiClient.get('/admin/health')
    return data
  },

  // ─── Citation verification (CrossRef + NCBI round-trip) ───────
  async verifyCitation(params: { doi?: string; pmid?: string; claim_text?: string }): Promise<{
    exists: boolean
    source: 'crossref' | 'ncbi' | 'none'
    doi?: string
    pmid?: string
    title?: string
    authors: string[]
    year?: string
    is_fabricated: boolean
    network_ok: boolean
    message: string
  }> {
    const { data } = await apiClient.post('/citation/verify', params)
    return data
  },

  // ─── Vector-similarity search (pgvector over KG entities) ──────
  async searchSimilarEntities(
    query: string,
    opts?: { limit?: number; min_similarity?: number },
  ): Promise<Array<{ entity: { id: string; name: string; category: string; description?: string; synonyms?: string[] }; similarity: number }>> {
    const { data } = await apiClient.post('/knowledge-graph/search/similar', {
      query,
      limit: opts?.limit ?? 10,
      min_similarity: opts?.min_similarity ?? 0.0,
    })
    return data
  },
}

export default api
