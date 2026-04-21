/**
 * Knowledge Entity Service
 *
 * REPLACES the 3.2 MB static MasterHumanLibrary*.ts files with live
 * backend API calls to the knowledge-graph endpoint.
 *
 * Migration path:
 *   1. Backend wires up GET /api/v1/knowledge-graph/entities
 *   2. Components import from this service instead of MasterHumanLibrary*
 *   3. Static library files get deleted
 *
 * This is the single most important frontend refactor for humanovo.
 * Without this, "knowledge graph" is a UI demo, not a product.
 */

import axios from 'axios'
import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const apiClient = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
})

// ─── Types (mirror backend Pydantic schemas) ────────────────────

export type EntityCategory =
  | 'gene'
  | 'protein'
  | 'rna'
  | 'small_molecule'
  | 'pathway'
  | 'disease'
  | 'cell_type'
  | 'tissue'
  | 'organ'
  | 'organ_system'
  | 'biochemical_pathway'
  | 'signaling_pathway'
  | 'drug'
  | 'phenotype'

export interface Entity {
  id: string                          // canonical ID (e.g., HGNC:12345)
  name: string                        // primary name
  synonyms: string[]                  // alternative names
  category: EntityCategory
  subcategory?: string
  description?: string
  external_ids: Record<string, string> // {ncbi_gene: "...", uniprot: "...", ...}
  source: string                      // primary data source
  evidence_count: number              // citations supporting this entity
  created_at: string
  updated_at: string
}

export interface EntityRelationship {
  id: string
  source_id: string
  target_id: string
  relation_type: string               // 'inhibits', 'activates', 'binds', etc.
  confidence: number                  // 0-1
  evidence_pmids: string[]
  evidence_count: number
  source: string
}

export interface EntitySearchParams {
  query?: string
  category?: EntityCategory | EntityCategory[]
  source?: string
  limit?: number
  offset?: number
}

export interface EntitySearchResult {
  entities: Entity[]
  total: number
  limit: number
  offset: number
}

export interface PathQuery {
  source_id: string
  target_id: string
  max_hops?: number                   // default 3
  min_confidence?: number             // default 0.5
}

export interface Path {
  nodes: Entity[]
  edges: EntityRelationship[]
  total_confidence: number
  hop_count: number
}

// ─── API Functions ──────────────────────────────────────────────

/**
 * Search entities by query, category, or source.
 * Replaces: filtering MasterHumanLibrary arrays in memory.
 */
export async function searchEntities(
  params: EntitySearchParams = {},
): Promise<EntitySearchResult> {
  const { data } = await apiClient.get<EntitySearchResult>(
    '/knowledge-graph/entities',
    { params },
  )
  return data
}

/**
 * Get a single entity by canonical ID.
 * Replaces: Array.find() on MasterHumanLibrary.
 */
export async function getEntity(id: string): Promise<Entity> {
  const { data } = await apiClient.get<Entity>(
    `/knowledge-graph/entities/${encodeURIComponent(id)}`,
  )
  return data
}

/**
 * Get all relationships for an entity.
 * Replaces: traversing the static `interactions` field.
 */
export async function getEntityRelationships(
  id: string,
  params: { limit?: number; min_confidence?: number } = {},
): Promise<EntityRelationship[]> {
  const { data } = await apiClient.get<EntityRelationship[]>(
    `/knowledge-graph/entities/${encodeURIComponent(id)}/relationships`,
    { params },
  )
  return data
}

/**
 * Find paths between two entities (multi-hop traversal).
 * Backed by Neo4j Cypher query, NOT in-memory graph search.
 */
export async function findPaths(query: PathQuery): Promise<Path[]> {
  const { data } = await apiClient.post<Path[]>(
    '/knowledge-graph/paths',
    query,
  )
  return data
}

/**
 * Get neighborhood subgraph centered on an entity.
 * Used by the KnowledgeGraph visualization component.
 */
export async function getNeighborhood(
  entityId: string,
  depth: number = 2,
  limit: number = 100,
): Promise<{ nodes: Entity[]; edges: EntityRelationship[] }> {
  const { data } = await apiClient.get(
    `/knowledge-graph/entities/${encodeURIComponent(entityId)}/neighborhood`,
    { params: { depth, limit } },
  )
  return data
}

/**
 * Get entities by disease focus.
 * Replaces: hardcoded disease-entity mappings in MasterHumanLibrary.
 */
export async function getEntitiesByDisease(
  diseaseId: string,
  limit: number = 50,
): Promise<Entity[]> {
  const { data } = await apiClient.get<Entity[]>(
    `/knowledge-graph/diseases/${encodeURIComponent(diseaseId)}/entities`,
    { params: { limit } },
  )
  return data
}

/**
 * Bulk fetch entities by ID list.
 * Used when a hypothesis references multiple entities by ID.
 */
export async function getEntitiesBulk(ids: string[]): Promise<Entity[]> {
  if (ids.length === 0) return []
  const { data } = await apiClient.post<Entity[]>(
    '/knowledge-graph/entities/bulk',
    { ids },
  )
  return data
}

// ─── React Query Hooks ──────────────────────────────────────────

export function useEntitySearch(
  params: EntitySearchParams,
): UseQueryResult<EntitySearchResult> {
  return useQuery({
    queryKey: ['entities', 'search', params],
    queryFn: () => searchEntities(params),
    staleTime: 5 * 60 * 1000,  // 5 minutes
  })
}

export function useEntity(id: string | null): UseQueryResult<Entity> {
  return useQuery({
    queryKey: ['entities', id],
    queryFn: () => getEntity(id!),
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  })
}

export function useEntityRelationships(
  id: string | null,
  params: { limit?: number; min_confidence?: number } = {},
): UseQueryResult<EntityRelationship[]> {
  return useQuery({
    queryKey: ['entities', id, 'relationships', params],
    queryFn: () => getEntityRelationships(id!, params),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

export function useNeighborhood(
  entityId: string | null,
  depth: number = 2,
  limit: number = 100,
) {
  return useQuery({
    queryKey: ['entities', entityId, 'neighborhood', depth, limit],
    queryFn: () => getNeighborhood(entityId!, depth, limit),
    enabled: !!entityId,
    staleTime: 5 * 60 * 1000,
  })
}

export function usePathFinder() {
  return useMutation({
    mutationFn: (query: PathQuery) => findPaths(query),
  })
}

// ─── Migration Helpers ──────────────────────────────────────────

/**
 * Adapter: returns a structure that matches the OLD MasterHumanLibrary
 * BiologicalElement interface, so existing components can swap in this
 * service with zero changes during the migration period.
 *
 * REMOVE THIS once all components have been migrated to the new types.
 */
export interface LegacyBiologicalElement {
  id: string
  name: string
  category: string
  subcategory: string
  description: string
  location: string[]
  functions: string[]
  interactions: string[]
  diseaseLinks: string[]
  drugTargets: string[]
}

export function entityToLegacy(e: Entity): LegacyBiologicalElement {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    subcategory: e.subcategory || '',
    description: e.description || '',
    location: [],
    functions: [],
    interactions: [],   // To populate, call getEntityRelationships
    diseaseLinks: [],
    drugTargets: [],
  }
}
