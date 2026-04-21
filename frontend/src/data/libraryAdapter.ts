/**
 * Library adapter — single seam between frontend pages and the biology
 * knowledge base.
 *
 * Today this file just re-exports the static MasterHumanLibraryIndex data
 * so callers don't care whether data came from the 3.2 MB bundled blob
 * or from the live /api/v1/knowledge-graph/entities endpoint.
 *
 * Subsequent migration batches will:
 *   1. Wire a TanStack Query hook (useLibraryTree / useLibraryEntity)
 *      that hits the backend when a live connection is present.
 *   2. Fall back to the static exports below when the backend is unreachable
 *      or during SSR/prerender.
 *   3. Finally, delete the MasterHumanLibrary*.ts files once no caller
 *      reads from them directly.
 *
 * All Workbench / HumanAnatomy / KnowledgeGraph page code should import
 * from THIS module, not from '../data/MasterHumanLibraryIndex' directly.
 * That guarantees future migrations are a one-file change.
 */

export type { BiologicalElement, LibraryTreeNode } from './MasterHumanLibraryIndex'

export {
  allBiologicalElements,
  findElementById,
  libraryStats,
  masterLibraryTree,
  searchElements,
} from './MasterHumanLibraryIndex'

// Future: these are the hook names page components should prefer when
// the live-data migration is complete. They currently proxy to the
// synchronous static exports for compatibility.
import {
  allBiologicalElements as _all,
  findElementById as _find,
  libraryStats as _stats,
  masterLibraryTree as _tree,
  searchElements as _search,
} from './MasterHumanLibraryIndex'

import type { BiologicalElement, LibraryTreeNode } from './MasterHumanLibraryIndex'

export interface LibrarySource {
  tree: LibraryTreeNode[]
  stats: typeof _stats
  all: BiologicalElement[]
  search: (q: string) => BiologicalElement[]
  findById: (id: string) => BiologicalElement | undefined
}

/**
 * Synchronous accessor used while the live-migration is in progress.
 * Always returns the static library so callers are guaranteed data
 * on first render, even before the API has responded.
 */
export function getStaticLibrary(): LibrarySource {
  return {
    tree: _tree,
    stats: _stats,
    all: _all,
    search: _search,
    findById: _find,
  }
}
