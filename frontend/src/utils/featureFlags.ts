/**
 * Feature flags for v1 surface.
 *
 * v1 ships a focused academic-researcher feature set. Routes/pages in
 * V1_HIDDEN_PATHS exist in source (their lazy chunks still ship; their
 * code is maintained) but are blocked from the user-facing surface:
 *   - the route guard in App.tsx redirects to /dashboard
 *   - the sidebar nav lists in Layout.tsx filter them out
 *   - the command-palette navigation actions filter them out
 *
 * Set VITE_V1_HIDDEN_ROUTES_ENABLED="true" to surface all of them again
 * (used in v1.1 dev work and on internal staging).
 *
 * Reasons documented per route:
 *   /workbench          ROUGH (silent error swallow at line 2524, 3825 LOC)
 *   /anatomy            placeholder BP3D models
 *   /clinical-trials    clinical, defer to v1.1
 *   /manuscripts        ROUGH (researchers use Overleaf)
 *   /regulatory         FDA/IRB tracker — clinical/industry
 *   /collaboration      ROUGH
 *   /biobank            niche (Benchling-grade)
 *   /experiment-tracker niche (Benchling-grade)
 *   /ml-models          unclear scope
 *
 * RECENTLY UN-HIDDEN:
 *   /imaging  — back in V1 per user directive 2026-05-09. Wires into
 *               MONAI (PyTorch medical-imaging framework) for
 *               segmentation / classification / registration; backend
 *               endpoints + DICOM viewer are follow-on work tracked
 *               separately.
 */

const HIDDEN_ENABLED =
  import.meta.env.VITE_V1_HIDDEN_ROUTES_ENABLED === 'true'

export const V1_HIDDEN_PATHS: ReadonlySet<string> = new Set([
  '/workbench',
  '/anatomy',
  '/clinical-trials',
  '/manuscripts',
  '/regulatory',
  '/collaboration',
  '/biobank',
  '/experiment-tracker',
  '/ml-models',
])

/**
 * True when the given path is hidden in the v1 surface.
 * Accepts paths with or without a leading slash.
 */
export function isHiddenInV1(path: string): boolean {
  if (HIDDEN_ENABLED) return false
  const normalized = path.startsWith('/') ? path : `/${path}`
  return V1_HIDDEN_PATHS.has(normalized)
}

/**
 * Filter helper for nav-item arrays — drops anything pointing to a v1-hidden
 * path. Items without a `to` property pass through unchanged.
 */
export function filterV1<T extends { to?: string }>(items: readonly T[]): T[] {
  if (HIDDEN_ENABLED) return [...items]
  return items.filter((item) => !item.to || !isHiddenInV1(item.to))
}
