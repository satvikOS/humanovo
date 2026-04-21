/**
 * Library adapter — single seam between frontend pages and the biology
 * knowledge base.
 *
 * Two data paths:
 *   1. Static  — the bundled MasterHumanLibrary*.ts files (3.2 MB).
 *                Always available, fast, identical semantics to today's
 *                code. Used for tree rendering, hierarchical navigation,
 *                and any call-site that needs synchronous data.
 *   2. Live    — /api/v1/knowledge-graph/entities (backend-backed,
 *                Neo4j + pgvector). Used via the async hooks / helpers
 *                below. Enabled when VITE_USE_LIVE_KG=1 OR when the
 *                app is running against a real backend.
 *
 * Page code should import from THIS module, not from
 * '../data/MasterHumanLibraryIndex' directly, so future impl swaps
 * remain a one-file change.
 */

import { useEffect, useState } from 'react'

export type { BiologicalElement, LibraryTreeNode } from './MasterHumanLibraryIndex'

export {
  allBiologicalElements,
  findElementById,
  libraryStats,
  masterLibraryTree,
  searchElements,
} from './MasterHumanLibraryIndex'

// Sub-library re-exports so components like HumanAnatomyViewer that
// slice the library by anatomical system (skeleton / muscles / nerves
// / tissues) keep working through the single adapter seam. A future
// migration batch will swap these for live filtered API calls like
// `useEntitySearch({ category: 'bone' })`.
export {
  allHistologicalTissues,
  completeMuscularSystem,
  completeSkeleton,
  cranialNerves,
  spinalPlexuses,
} from './MasterHumanLibraryIndex'

import {
  allBiologicalElements as _all,
  findElementById as _find,
  libraryStats as _stats,
  masterLibraryTree as _tree,
  searchElements as _search,
} from './MasterHumanLibraryIndex'

import type { BiologicalElement, LibraryTreeNode } from './MasterHumanLibraryIndex'
import * as knowledge from '../services/knowledge'

const LIVE_KG_ENABLED = import.meta.env.VITE_USE_LIVE_KG === '1'

export interface LibrarySource {
  tree: LibraryTreeNode[]
  stats: typeof _stats
  all: BiologicalElement[]
  search: (q: string) => BiologicalElement[]
  findById: (id: string) => BiologicalElement | undefined
}

export function getStaticLibrary(): LibrarySource {
  return {
    tree: _tree,
    stats: _stats,
    all: _all,
    search: _search,
    findById: _find,
  }
}

/**
 * Convert a live Entity (from the backend API) into the BiologicalElement
 * shape the existing Workbench / HumanAnatomy code expects. Missing
 * fields default to an empty shape so callers can still render.
 */
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
    // Any extra fields from the live payload flow through as-is.
    ...(e as unknown as Partial<BiologicalElement>),
  } as BiologicalElement
}

// Map the backend canonical categories back to the string set the
// existing static library uses. Conservative — unmapped values keep
// their original label, the consuming code already handles unknowns.
function mapCategory(c: string): string {
  const lut: Record<string, string> = {
    gene: 'genetic_material',
    rna: 'rna_expression',
    protein: 'proteins_enzymes',
    small_molecule: 'organic_molecules',
    pathway: 'signaling_pathways',
    biochemical_pathway: 'metabolic_pathways',
    signaling_pathway: 'signaling_pathways',
    cell_type: 'cell_types',
    tissue: 'tissues',
    organ: 'organs',
    organ_system: 'organ_systems',
    drug: 'therapeutic_drugs',
    disease: 'clinical_diseases',
    phenotype: 'clinical_biomarkers',
  }
  return lut[c] ?? c
}

/**
 * Returns a search function that consults the live API when enabled,
 * otherwise defers to the synchronous static search.
 *
 * This is the first seam at which live-KG calls flow into page code.
 * When Workbench's search box is wired through this hook, it'll
 * query Neo4j/pgvector transparently — but *only* when the backend
 * is up and the feature flag is on.
 */
export function useLibrarySearch(query: string, limit = 50) {
  const [results, setResults] = useState<BiologicalElement[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([])
      return
    }
    // Fast path: static search while the live call is in-flight, so the
    // user sees something immediately.
    setResults(_search(query))

    if (!LIVE_KG_ENABLED) return

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
        if (cancelled) return
        // Fallback silently — static search already populated results.
        setError(err)
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

/**
 * Hook for fetching a single entity by canonical ID. Live when enabled,
 * static otherwise. Same graceful-degradation contract as useLibrarySearch.
 */
export function useLibraryEntity(id: string | null) {
  const [entity, setEntity] = useState<BiologicalElement | null>(
    id ? _find(id) ?? null : null,
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!id) {
      setEntity(null)
      return
    }
    // Hydrate from static immediately to avoid a flash of "not found".
    setEntity(_find(id) ?? null)
    if (!LIVE_KG_ENABLED) return

    let cancelled = false
    setLoading(true)
    knowledge
      .getEntity(id)
      .then((e) => {
        if (cancelled) return
        setEntity(entityToBiologicalElement(e))
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

/**
 * Compile-time feature-flag accessor for callers that want to branch
 * UI behavior (e.g. "show a LIVE badge when querying the backend").
 */
export function isLiveKgEnabled(): boolean {
  return LIVE_KG_ENABLED
}
