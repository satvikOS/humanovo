/**
 * useSavedPapers — backend-backed list + CRUD for AI-generated research papers.
 *
 * Replaces `usePersistentState<SavedResearchPaper[]>('research-papers', [])`
 * which only persisted into localStorage. The list endpoint returns
 * SavedPaperSummary rows (no paper_html body, to keep the response small);
 * `getPaperHtml(id)` lazily fetches the rendered HTML when a user actually
 * opens the paper viewer.
 *
 * Pass `projectId` to scope to a single project. Pass `undefined` (or omit)
 * to fetch every paper the current user has saved across all projects.
 */
import { useCallback, useEffect, useState } from 'react'

import { api, SavedPaperCreate, SavedPaperDetail, SavedPaperSummary } from '../services/api'

export interface UseSavedPapersResult {
  papers: SavedPaperSummary[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  createPaper: (body: SavedPaperCreate) => Promise<SavedPaperDetail>
  deletePaper: (id: string) => Promise<void>
  getPaperHtml: (id: string) => Promise<string>
}

export function useSavedPapers(projectId?: string): UseSavedPapersResult {
  const [papers, setPapers] = useState<SavedPaperSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await api.listSavedPapers({ project_id: projectId, limit: 500 })
      setPapers(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load saved papers')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refetch()
  }, [refetch])

  const createPaper = useCallback(async (body: SavedPaperCreate) => {
    const created = await api.createSavedPaper(body)
    // Detail rows include paper_html; the list state intentionally keeps
    // only the summary shape so we don't accumulate huge HTML strings in
    // memory across all rendered pages.
    const summary: SavedPaperSummary = {
      id: created.id,
      hypothesis_id: created.hypothesis_id,
      project_id: created.project_id,
      hypothesis_title: created.hypothesis_title,
      disease: created.disease,
      filename: created.filename,
      created_at: created.created_at,
      updated_at: created.updated_at,
    }
    setPapers(prev => [summary, ...prev])
    return created
  }, [])

  const deletePaper = useCallback(async (id: string) => {
    await api.deleteSavedPaper(id)
    setPapers(prev => prev.filter(p => p.id !== id))
  }, [])

  const getPaperHtml = useCallback(async (id: string) => {
    const detail = await api.getSavedPaper(id)
    return detail.paper_html
  }, [])

  return { papers, loading, error, refetch, createPaper, deletePaper, getPaperHtml }
}
