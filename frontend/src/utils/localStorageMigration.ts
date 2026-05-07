/**
 * One-shot localStorage → backend migration drain.
 *
 * Round 4 moved two formerly-localStorage entities to durable
 * Postgres-backed storage:
 *   - `humanovo-literature-papers`  →  POST /api/v1/citations
 *   - `research-papers`             →  POST /api/v1/saved-papers
 *
 * Existing users (anyone who ran an older client) still have rows
 * sitting in localStorage. This module drains them to the backend
 * exactly once per device and clears the legacy keys on success so
 * the data isn't silently abandoned when the new client ships.
 *
 * Idempotency is per-key — a sentinel (`humanovo-migrated-<key>`)
 * is written when a key has been successfully drained, so the
 * helper is safe to call on every login. Failures leave the
 * source key in place so the next session can retry; we never
 * data-loss on a transient API hiccup.
 *
 * Sequencing:
 *   - Run AFTER the user is authenticated (the API calls require
 *     a session-bound JWT; calling pre-auth would 401).
 *   - Run BEFORE the user opens any page that queries the new
 *     backend collection — so they don't see "0 papers" while
 *     the drain is still in flight. The dashboard's bootstrap
 *     effect is the natural place.
 *
 * The drain is deliberately conservative on cross-mapping: if a
 * field is unparseable or the backend rejects an entry (validation
 * error, duplicate, whatever), the migration logs to console.warn
 * and continues with the next entry, then keeps the source key on
 * disk so a future client release can re-attempt. We never bulk-
 * fail the whole run on a single bad row.
 */
import { api, LibraryCitation, SavedPaperDetail } from '../services/api'

const SENTINEL_PREFIX = 'humanovo-migrated-'

interface LegacyLiteraturePaper {
  id?: string
  title?: string
  authors?: string[]
  journal?: string
  year?: number
  doi?: string
  abstract?: string
  tags?: string[]
  relevance?: 'high' | 'medium' | 'low'
  notes?: string
  starred?: boolean
}

interface LegacyResearchPaper {
  id?: string
  hypothesis_id?: string
  hypothesis_title?: string
  project_id?: string
  disease?: string
  generated_at?: string
  filename?: string
  paper_html?: string
}

function alreadyMigrated(key: string): boolean {
  try {
    return localStorage.getItem(SENTINEL_PREFIX + key) === '1'
  } catch {
    return false
  }
}

function markMigrated(key: string): void {
  try {
    localStorage.setItem(SENTINEL_PREFIX + key, '1')
    localStorage.removeItem(key)
  } catch {
    /* quota — leave the key in place; we'll retry next session */
  }
}

async function drainLegacyLiteraturePapers(): Promise<{ migrated: number; failed: number }> {
  const KEY = 'humanovo-literature-papers'
  if (alreadyMigrated(KEY)) return { migrated: 0, failed: 0 }
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { return { migrated: 0, failed: 0 } }
  if (!raw) { markMigrated(KEY); return { migrated: 0, failed: 0 } }

  let parsed: LegacyLiteraturePaper[]
  try { parsed = JSON.parse(raw) } catch {
    console.warn('[migration] literature-papers JSON unparseable; leaving key in place')
    return { migrated: 0, failed: 0 }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    markMigrated(KEY)
    return { migrated: 0, failed: 0 }
  }

  let migrated = 0
  let failed = 0
  for (const p of parsed) {
    if (!p?.title) { failed++; continue }
    const tags = Array.isArray(p.tags) ? [...p.tags] : []
    if (p.relevance) tags.push(`relevance:${p.relevance}`)
    try {
      await api.createLibraryCitation({
        type: 'journal',
        title: p.title,
        authors: Array.isArray(p.authors) ? p.authors : [],
        journal: p.journal || null,
        year: typeof p.year === 'number' ? p.year : null,
        doi: p.doi || null,
        abstract: p.abstract || null,
        tags,
        starred: !!p.starred,
        notes: p.notes || null,
      } as Partial<LibraryCitation>)
      migrated++
    } catch (e) {
      console.warn('[migration] literature-papers entry failed:', e)
      failed++
    }
  }
  // Only mark drained when ALL entries succeeded; otherwise we leave
  // the source key so a future session can retry the failures.
  if (failed === 0) markMigrated(KEY)
  return { migrated, failed }
}

async function drainLegacyResearchPapers(): Promise<{ migrated: number; failed: number }> {
  const KEY = 'research-papers'
  if (alreadyMigrated(KEY)) return { migrated: 0, failed: 0 }
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { return { migrated: 0, failed: 0 } }
  if (!raw) { markMigrated(KEY); return { migrated: 0, failed: 0 } }

  let parsed: LegacyResearchPaper[]
  try { parsed = JSON.parse(raw) } catch {
    console.warn('[migration] research-papers JSON unparseable; leaving key in place')
    return { migrated: 0, failed: 0 }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    markMigrated(KEY)
    return { migrated: 0, failed: 0 }
  }

  let migrated = 0
  let failed = 0
  for (const p of parsed) {
    if (!p?.hypothesis_id || !p?.hypothesis_title || !p?.paper_html) {
      // The backend `paper_html` column is NOT NULL; html-less stub
      // rows the localStorage layer accepted historically must be
      // dropped during migration rather than create useless backend
      // rows the user can't actually open.
      failed++
      continue
    }
    try {
      await api.createSavedPaper({
        hypothesis_id: p.hypothesis_id,
        project_id: p.project_id || null,
        hypothesis_title: p.hypothesis_title,
        disease: p.disease || null,
        filename: p.filename || `humanovo-${p.hypothesis_id}.pdf`,
        paper_html: p.paper_html,
      })
      migrated++
    } catch (e) {
      console.warn('[migration] research-papers entry failed:', e)
      failed++
    }
  }
  if (failed === 0) markMigrated(KEY)
  return { migrated, failed }
}

/**
 * Drain every legacy localStorage collection to the backend exactly
 * once per device. Call from the dashboard / app shell after auth.
 * Returns a summary so callers can surface a toast like "Migrated 7
 * literature papers + 3 saved papers to your account."
 */
export async function drainLegacyLocalStorage(): Promise<{
  literature: { migrated: number; failed: number }
  papers: { migrated: number; failed: number }
}> {
  // Sequence intentionally — both calls hit the same JWT; running
  // them in parallel doubles the cold-start lambda concurrency for
  // no real user-perceived speedup, and the failure mode of one
  // shouldn't affect the other.
  const literature = await drainLegacyLiteraturePapers()
  const papers = await drainLegacyResearchPapers()
  return { literature, papers }
}

// Internal helper exposed for tests; not part of the public API.
export const __testHooks = {
  drainLegacyLiteraturePapers,
  drainLegacyResearchPapers,
} as const

// Type-export to make the SavedPaperDetail ref show as used.
export type { SavedPaperDetail }
