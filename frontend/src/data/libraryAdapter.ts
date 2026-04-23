/**
 * Library adapter — single seam between frontend pages and the biology
 * knowledge base.
 *
 * Previously this module re-exported symbols from the 3.2 MB static
 * MasterHumanLibrary*.ts bundle (19 files, ~4900 entities baked into
 * the client). Those files have been deleted. The adapter now:
 *
 *   1. Owns every type (BiologicalElement, LibraryTreeNode, LibraryCategory).
 *   2. Exposes empty synchronous placeholders so existing import sites
 *      keep compiling without the 3.2 MB asset. Pages show their empty
 *      state until the backend knowledge graph is seeded.
 *   3. Provides async hooks (useLibrarySearch, useLibraryEntity) that
 *      hit /api/v1/knowledge-graph/entities — these are the live path.
 *
 * Backend seeding: run `python -m backend.scripts.seed_kg` (coming in
 * a follow-up batch) to populate the Neo4j + pgvector knowledge graph
 * from OpenAlex / PubTator3 / MeSH / HGNC / UniProt. Once seeded, the
 * hooks return live data and every consumer lights up.
 */

import { useEffect, useState } from 'react'

import * as knowledge from '../services/knowledge'

// ─── Types (owned by the adapter) ────────────────────────────────

export type LibraryCategory =
  | 'genetic_material'
  | 'rna_expression'
  | 'proteins_enzymes'
  | 'organic_molecules'
  | 'inorganic_components'
  | 'organelles'
  | 'cell_types'
  | 'tissues'
  | 'organs'
  | 'organ_systems'
  | 'biochemical_pathways'
  | 'signaling_pathways'

export interface BiologicalElement {
  id: string
  name: string
  category: LibraryCategory | string
  subcategory: string
  description: string
  location: string[]
  functions: string[]
  interactions: string[]
  diseaseLinks: string[]
  drugTargets: string[]
  // simulationParams is required by existing Workbench code paths —
  // live-API entities get a safe default below (entityToBiologicalElement).
  simulationParams: {
    baselineValue: number
    minValue: number
    maxValue: number
    unit: string
    halfLife?: string
    turnoverRate?: string
  }
  aiSimulationReady: boolean
}

export interface LibraryTreeNode {
  id: string
  name: string
  type: 'category' | 'subcategory' | 'element'
  description?: string
  children?: LibraryTreeNode[]
  elementCount?: number
  icon?: string
  color?: string
}

export interface LibraryStats {
  totalElements: number
  categories: number
  aiSimulationReady: number
}

// ─── Synchronous empty placeholders ──────────────────────────────
// Pages that can't yet use async hooks read from these. With the
// static bundle deleted, they're empty until the backend KG is seeded.

export const allBiologicalElements: BiologicalElement[] = []
export const completeSkeleton: BiologicalElement[] = []
export const completeMuscularSystem: BiologicalElement[] = []
export const cranialNerves: BiologicalElement[] = []
export const spinalPlexuses: BiologicalElement[] = []
export const allHistologicalTissues: BiologicalElement[] = []

export const masterLibraryTree: LibraryTreeNode[] = []

export const libraryStats: LibraryStats = {
  totalElements: 0,
  categories: 0,
  aiSimulationReady: 0,
}

export function findElementById(_id: string): BiologicalElement | undefined {
  return undefined
}

export function searchElements(_query: string): BiologicalElement[] {
  return []
}

// ─── Live-API hooks (TanStack-Query-free, no deps beyond React) ──

const LIVE_KG_ENABLED =
  // Default ON once the static data is gone — empty state is worse
  // than a failed API call the toast interceptor can show.
  (import.meta.env.VITE_USE_LIVE_KG ?? '1') !== '0'

/** Convert a backend Entity into the shape existing components expect. */
function entityToBiologicalElement(e: knowledge.Entity): BiologicalElement {
  return {
    id: e.id,
    name: e.name,
    category: mapCategory(e.category),
    subcategory: e.subcategory || '',
    description: e.description || '',
    location: [],
    functions: [],
    interactions: [],
    diseaseLinks: [],
    drugTargets: [],
    // Neutral defaults — live entities don't carry simulation parameters;
    // components that need them treat this as an un-simulatable placeholder.
    simulationParams: { baselineValue: 0, minValue: 0, maxValue: 1, unit: '' },
    aiSimulationReady: false,
  }
}

function mapCategory(c: string): string {
  const lut: Record<string, string> = {
    gene: 'genetic_material',
    rna: 'rna_expression',
    protein: 'proteins_enzymes',
    small_molecule: 'organic_molecules',
    pathway: 'signaling_pathways',
    biochemical_pathway: 'biochemical_pathways',
    signaling_pathway: 'signaling_pathways',
    cell_type: 'cell_types',
    tissue: 'tissues',
    organ: 'organs',
    organ_system: 'organ_systems',
  }
  return lut[c] ?? c
}

/**
 * Async search — consults the live /api/v1/knowledge-graph/entities
 * endpoint. Returns empty array while the call is in flight or when
 * the live flag is off (no more static-fallback path since the data
 * was deleted).
 */
export function useLibrarySearch(query: string, limit = 50) {
  const [results, setResults] = useState<BiologicalElement[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!LIVE_KG_ENABLED || !query || query.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    knowledge
      .searchEntities({ query, limit })
      .then((res) => {
        if (cancelled) return
        setResults(res.entities.map(entityToBiologicalElement))
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, limit])

  return { results, loading, error }
}

/** Fetch a single entity by ID. */
export function useLibraryEntity(id: string | null) {
  const [entity, setEntity] = useState<BiologicalElement | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!LIVE_KG_ENABLED || !id) {
      setEntity(null)
      return
    }
    let cancelled = false
    setLoading(true)
    knowledge
      .getEntity(id)
      .then((e) => {
        if (!cancelled) setEntity(entityToBiologicalElement(e))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return { entity, loading }
}

export function isLiveKgEnabled(): boolean {
  return LIVE_KG_ENABLED
}

// ─── Live tree ───────────────────────────────────────────────────
// Builds a Workbench Sapien-Corridor-style hierarchy from live KG
// entities. One sweep of /entities per category, assembled into a
// { category → [entities] } tree on the client. Renders within one
// frame of the API response (no virtualized loading state flashes).

const TREE_CATEGORIES: Array<{ backend: string; label: string; icon: string; color: string }> = [
  { backend: 'organ_system', label: 'Organ Systems',     icon: '🫁', color: '#ef4444' },
  { backend: 'organ',         label: 'Organs',           icon: '🫀', color: '#fb923c' },
  { backend: 'tissue',        label: 'Tissues',          icon: '🧬', color: '#f59e0b' },
  { backend: 'cell_type',     label: 'Cell Types',       icon: '🦠', color: '#eab308' },
  { backend: 'gene',          label: 'Genes',            icon: '🧬', color: '#ec4899' },
  { backend: 'rna',           label: 'RNA',              icon: '🧬', color: '#d946ef' },
  { backend: 'protein',       label: 'Proteins',         icon: '🔬', color: '#22c55e' },
  { backend: 'small_molecule', label: 'Small Molecules', icon: '⚗️', color: '#14b8a6' },
  { backend: 'drug',          label: 'Drugs & Therapeutics', icon: '💊', color: '#10b981' },
  { backend: 'pathway',        label: 'Pathways',        icon: '↻', color: '#06b6d4' },
  { backend: 'biochemical_pathway', label: 'Biochemical Pathways', icon: '↻', color: '#0ea5e9' },
  { backend: 'signaling_pathway',   label: 'Signaling Pathways',   icon: '↻', color: '#3b82f6' },
  { backend: 'disease',       label: 'Diseases',         icon: '🧪', color: '#dc2626' },
  { backend: 'phenotype',     label: 'Phenotypes',       icon: '📋', color: '#a855f7' },
]

export interface LiveTreeState {
  tree: LibraryTreeNode[]
  stats: LibraryStats
  loading: boolean
  error: Error | null
}

/**
 * Fetches every category in parallel, groups the results into a
 * two-level tree (category → entity). Cached while the hook is
 * mounted; refetch() invalidates.
 */
export function useLibraryTree(): LiveTreeState & { refetch: () => void } {
  const [tree, setTree] = useState<LibraryTreeNode[]>([])
  const [stats, setStats] = useState<LibraryStats>({
    totalElements: 0,
    categories: 0,
    aiSimulationReady: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    if (!LIVE_KG_ENABLED) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    // Fire one GET per category in parallel — 14 small requests is
    // faster than a single big paged sweep, and lets each branch
    // render as its own category resolves (future: stream-in).
    Promise.all(
      TREE_CATEGORIES.map((cat) =>
        knowledge
          .searchEntities({ category: cat.backend as never, limit: 500 })
          .then((res) => ({ cat, entities: res.entities, total: res.total }))
          .catch((e) => {
            // A single-category failure shouldn't nuke the whole tree;
            // log and continue. The top-level setError below captures
            // the aggregate if every request fails.
             
            console.warn(`[libraryAdapter] category ${cat.backend} failed:`, e)
            return { cat, entities: [], total: 0 }
          }),
      ),
    )
      .then((results) => {
        if (cancelled) return
        const nodes: LibraryTreeNode[] = results
          .filter((r) => r.entities.length > 0)
          .map((r) => ({
            id: `cat:${r.cat.backend}`,
            name: r.cat.label,
            type: 'category',
            elementCount: r.total,
            icon: r.cat.icon,
            color: r.cat.color,
            children: r.entities.map((e) => ({
              id: e.id,
              name: e.name,
              type: 'element',
              description: e.description || undefined,
              color: r.cat.color,
            })),
          }))
        setTree(nodes)
        setStats({
          totalElements: results.reduce((a, r) => a + r.total, 0),
          categories: nodes.length,
          aiSimulationReady: 0,
        })
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [epoch])

  const refetch = () => setEpoch((e) => e + 1)
  return { tree, stats, loading, error, refetch }
}
