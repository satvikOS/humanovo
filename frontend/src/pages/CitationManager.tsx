// CitationManager — Mendeley-equivalent reference library.
//
// Three-pane research-library UX replacing the form-heavy legacy
// citation manager (the localStorage + /evidence reuse approach).
//
//   [ Folders ]  [ Library table ]  [ Detail / PDF reader ]
//
// Features in this rewrite:
//   * Persistent, backend-backed library (Postgres `citations` table)
//   * Hierarchical folders + smart filters (starred / unread / tag / year / author)
//   * Drag-drop import for PDF + BibTeX + RIS + CSL-JSON + EndNote
//   * Export the selected (or filtered) subset as BibTeX / RIS / CSL-JSON
//   * Inline PDF reader with persistent, cross-device highlights
//   * Full-text search across title / authors / abstract / DOI / notes
//
// The legacy localStorage layer is gone — citations live in Postgres
// so the same library follows the user across devices and can be
// queried by the agents. DOI-based dedupe runs on every create so
// re-importing a paper never creates a twin.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiStar, FiSearch, FiDownload, FiX, FiFolder, FiFilter,
  FiExternalLink, FiLink, FiTrash2, FiBookOpen, FiEdit3, FiCheck,
} from 'react-icons/fi'
import api, { type LibraryCitation, type LibraryFolder, type LibraryHighlight } from '../services/api'
import FolderTree from '../components/citation/FolderTree'
import LibraryTable, { type SortKey } from '../components/citation/LibraryTable'
import ImportDropZone from '../components/citation/ImportDropZone'
import PdfReader from '../components/citation/PdfReader'
import { toast } from '../contexts/ToastContext'
import { EmptyState } from '../components/EmptyState'

type SmartFilter = 'all' | 'starred' | 'unread' | 'recent'

export default function CitationManager() {
  // Deep-link query params consumed on mount and stripped from the URL
  // so the canonical citation-manager URL stays clean for sharing:
  //   ?q=<text>     → seeds the search query input
  //   ?import=1     → opens the drag-drop import dialog
  //   ?add=1        → opens the import dialog (alias of ?import=1)
  const [searchParams] = useSearchParams()

  // ── Data ──
  const [citations, setCitations] = useState<LibraryCitation[]>([])
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [highlights, setHighlights] = useState<LibraryHighlight[]>([])

  // ── Filters ──
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [smart, setSmart] = useState<SmartFilter>('all')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [yearFilter, setYearFilter] = useState<number | null>(null)

  // ── Sort ──
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // ── UI mode ──
  const [rightPane, setRightPane] = useState<'detail' | 'pdf'>('detail')
  const [loading, setLoading] = useState(false)
  const [showImport, setShowImport] = useState(
    () => searchParams.get('import') === '1' || searchParams.get('add') === '1'
  )

  // Strip consumed params from the URL so the canonical /citation-manager
  // URL stays clean. window.history.replaceState avoids re-rendering the
  // route, which would otherwise reset focus state on the search input.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    let dirty = false
    for (const k of ['q', 'import', 'add']) {
      if (sp.has(k)) { sp.delete(k); dirty = true }
    }
    if (dirty) {
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
  }, [])

  const focused = useMemo(() => citations.find(c => c.id === focusedId) || null, [citations, focusedId])

  // ── Load library + folders ──
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [cs, fs] = await Promise.all([
        api.listLibraryCitations({
          q: query || undefined,
          starred_only: smart === 'starred' || undefined,
          unread_only: smart === 'unread' || undefined,
          tag: tagFilter || undefined,
          folder: folderId || undefined,
          year: yearFilter || undefined,
          limit: 500,
        }),
        api.listLibraryFolders(),
      ])
      setCitations(cs)
      setFolders(fs)
    } catch {
      toast('error', 'Failed to load citation library')
    } finally {
      setLoading(false)
    }
  }, [query, smart, tagFilter, folderId, yearFilter])

  useEffect(() => { void reload() }, [reload])

  // Load highlights for the focused citation on change.
  useEffect(() => {
    if (!focusedId) { setHighlights([]); return }
    void api.listLibraryHighlights(focusedId).then(setHighlights).catch(() => setHighlights([]))
  }, [focusedId])

  // ── Derived ──
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    citations.forEach(c => (c.folders || []).forEach(fid => { counts[fid] = (counts[fid] || 0) + 1 }))
    return counts
  }, [citations])

  // Recent = added in last 14 days. Implemented client-side since
  // the backend endpoint doesn't have a dedicated flag for it.
  const filteredRows = useMemo(() => {
    let rows = citations
    if (smart === 'recent') {
      const cutoff = Date.now() - 14 * 24 * 3600 * 1000
      rows = rows.filter(c => new Date(c.created_at).getTime() >= cutoff)
    }
    // Sort in-memory — the backend already returns pinned-first,
    // updated-desc, and we only sort on the current page worth of
    // rows (max 500) so cost is trivial.
    const dir = sortDir === 'asc' ? 1 : -1
    const key = sortKey
    rows = [...rows].sort((a, b) => {
      const av = key === 'authors' ? (a.authors?.[0] || '') : key === 'updated' ? a.updated_at : (a as unknown as Record<string, unknown>)[key] ?? ''
      const bv = key === 'authors' ? (b.authors?.[0] || '') : key === 'updated' ? b.updated_at : (b as unknown as Record<string, unknown>)[key] ?? ''
      return av > bv ? dir : av < bv ? -dir : 0
    })
    return rows
  }, [citations, smart, sortKey, sortDir])

  const allYears = useMemo(() => {
    const s = new Set<number>()
    citations.forEach(c => { if (c.year) s.add(c.year) })
    return Array.from(s).sort((a, b) => b - a)
  }, [citations])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    citations.forEach(c => (c.tags || []).forEach(t => s.add(t)))
    return Array.from(s).sort()
  }, [citations])

  // ── Actions ──
  const toggleStar = async (id: string, starred: boolean) => {
    try {
      const updated = await api.updateLibraryCitation(id, { starred })
      setCitations(cs => cs.map(c => c.id === id ? updated : c))
    } catch { toast('error', 'Could not update star') }
  }
  const toggleRead = async (id: string, read: boolean) => {
    try {
      const updated = await api.updateLibraryCitation(id, { read })
      setCitations(cs => cs.map(c => c.id === id ? updated : c))
    } catch { toast('error', 'Could not update read state') }
  }
  const updateCitation = async (id: string, patch: Partial<LibraryCitation>) => {
    try {
      const updated = await api.updateLibraryCitation(id, patch)
      setCitations(cs => cs.map(c => c.id === id ? updated : c))
    } catch { toast('error', 'Could not save changes') }
  }
  const bulkDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} citation${selectedIds.size === 1 ? '' : 's'}?`)) return
    try {
      const res = await api.bulkDeleteLibraryCitations(Array.from(selectedIds))
      toast('success', `Deleted ${res.deleted_count}`)
      setSelectedIds(new Set())
      if (focusedId && selectedIds.has(focusedId)) setFocusedId(null)
      await reload()
    } catch { toast('error', 'Bulk delete failed') }
  }

  const importText = async (format: 'bibtex' | 'ris' | 'csl' | 'endnote', text: string) => {
    try {
      const res = await api.importLibraryCitations({ format, text })
      toast('success', `Imported ${res.imported}${res.skipped_duplicates ? ` · ${res.skipped_duplicates} duplicates skipped` : ''}`)
      await reload()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast('error', detail || 'Import failed')
    }
  }

  const importPdf = async (file: File) => {
    // Create a citation pre-populated with the filename as title and
    // a blob: URL so the user can immediately read the PDF. The file
    // is also uploaded to /ingestion/documents/upload so the corpus
    // has a permanent copy.
    const blobUrl = URL.createObjectURL(file)
    let pdf_file_id: string | undefined
    try {
      const resp = await api.uploadDocument(file)
      pdf_file_id = resp?.job_id
    } catch { /* non-fatal — citation still created with blob URL */ }
    try {
      const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
      const created = await api.createLibraryCitation({
        title: title || '(untitled PDF)',
        type: 'journal',
        authors: [],
        pdf_url: blobUrl,
        pdf_file_id,
      })
      setCitations(cs => [created, ...cs])
      setFocusedId(created.id)
      setRightPane('pdf')
      toast('success', 'PDF imported — edit the metadata or verify via DOI in the detail panel')
    } catch {
      toast('error', 'Could not create citation for the PDF')
    }
  }

  const exportFormat = async (format: 'bibtex' | 'ris' | 'csl') => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined
    try {
      const body = { format, ids } as { format: 'bibtex' | 'ris' | 'csl'; ids?: string[] }
      const data = await api.exportLibraryCitations(body)
      let blob: Blob
      let filename: string
      if (format === 'csl') {
        blob = new Blob([JSON.stringify((data as { items: unknown[] }).items, null, 2)], { type: 'application/json' })
        filename = 'library.csl.json'
      } else {
        blob = data as Blob
        filename = `library.${format === 'bibtex' ? 'bib' : 'ris'}`
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      toast('success', `Exported ${ids?.length ?? citations.length} citations as ${format.toUpperCase()}`)
    } catch {
      toast('error', 'Export failed')
    }
  }

  // Folder ops.
  const createFolder = async (parentId: string | null, name: string) => {
    try {
      const f = await api.createLibraryFolder({ name, parent_id: parentId || undefined })
      setFolders(xs => [...xs, f])
    } catch { toast('error', 'Could not create folder') }
  }
  const renameFolder = async (id: string, name: string) => {
    try {
      const f = await api.updateLibraryFolder(id, { name })
      setFolders(xs => xs.map(x => x.id === id ? f : x))
    } catch { toast('error', 'Could not rename folder') }
  }
  const deleteFolder = async (id: string) => {
    try {
      await api.deleteLibraryFolder(id)
      setFolders(xs => xs.filter(x => x.id !== id))
      if (folderId === id) setFolderId(null)
      await reload()
    } catch { toast('error', 'Could not delete folder') }
  }
  const reparentFolder = async (id: string, newParentId: string | null) => {
    try {
      const f = await api.updateLibraryFolder(id, { parent_id: newParentId })
      setFolders(xs => xs.map(x => x.id === id ? f : x))
    } catch { toast('error', 'Could not move folder') }
  }

  // Highlight ops.
  const addHighlight = async (payload: { page: number; text: string; note: string; color: string }) => {
    if (!focusedId) return
    try {
      const h = await api.createLibraryHighlight(focusedId, {
        citation_id: focusedId,
        page: payload.page,
        rect: { x: 0, y: 0, w: 1, h: 0.05 },  // placeholder until pdfjs lands
        text: payload.text || null,
        note: payload.note || null,
        color: payload.color,
      })
      setHighlights(hs => [...hs, h])
    } catch { toast('error', 'Could not save highlight') }
  }
  const deleteHighlight = async (id: string) => {
    try {
      await api.deleteLibraryHighlight(id)
      setHighlights(hs => hs.filter(x => x.id !== id))
    } catch { toast('error', 'Could not delete highlight') }
  }
  const updateHighlight = async (id: string, patch: Partial<LibraryHighlight>) => {
    try {
      const h = await api.updateLibraryHighlight(id, patch)
      setHighlights(hs => hs.map(x => x.id === id ? h : x))
    } catch { toast('error', 'Could not update highlight') }
  }

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'updated' || k === 'year' ? 'desc' : 'asc') }
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* ── Left rail: folders + smart filters ── */}
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-solid)] flex flex-col overflow-hidden">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="text-xxs uppercase tracking-wider font-semibold text-[var(--color-text-muted)] mb-2">Library</div>
          {([
            { key: 'all' as const,     label: 'All citations', icon: FiBookOpen },
            { key: 'starred' as const, label: 'Starred',       icon: FiStar },
            { key: 'unread' as const,  label: 'Unread',        icon: FiFilter },
            { key: 'recent' as const,  label: 'Recently added', icon: FiFilter },
          ]).map(f => (
            <button
              key={f.key}
              onClick={() => { setSmart(f.key); setFolderId(null); setTagFilter(null); setYearFilter(null) }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                smart === f.key && folderId === null ? 'bg-[var(--glass-bg)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--glass-bg)] hover:text-[var(--color-text)]'
              }`}
            >
              <f.icon className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">{f.label}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="text-xxs uppercase tracking-wider font-semibold text-[var(--color-text-muted)] mb-2">Folders</div>
          <FolderTree
            folders={folders}
            selected={folderId}
            onSelect={id => { setFolderId(id); setSmart('all') }}
            onCreate={createFolder}
            onRename={renameFolder}
            onDelete={deleteFolder}
            onReparent={reparentFolder}
            counts={folderCounts}
          />
          {allTags.length > 0 && (
            <>
              <div className="text-xxs uppercase tracking-wider font-semibold text-[var(--color-text-muted)] mt-5 mb-2">Tags</div>
              <div className="flex flex-wrap gap-1">
                {allTags.slice(0, 50).map(t => (
                  <button
                    key={t}
                    onClick={() => { setTagFilter(tagFilter === t ? null : t); setSmart('all') }}
                    className={`text-xxs px-1.5 py-0.5 rounded border ${
                      tagFilter === t
                        ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg)] text-[var(--color-text)]'
                        : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </>
          )}
          {allYears.length > 0 && (
            <>
              <div className="text-xxs uppercase tracking-wider font-semibold text-[var(--color-text-muted)] mt-5 mb-2">Years</div>
              <div className="flex flex-wrap gap-1">
                {allYears.slice(0, 20).map(y => (
                  <button
                    key={y}
                    onClick={() => { setYearFilter(yearFilter === y ? null : y); setSmart('all') }}
                    className={`text-xxs px-1.5 py-0.5 rounded border tabular-nums ${
                      yearFilter === y
                        ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg)] text-[var(--color-text)]'
                        : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ── Center: library table + search bar ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-xxs uppercase tracking-wider text-[var(--color-text-muted)]">Citation Library</div>
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
              {folderId ? folders.find(f => f.id === folderId)?.name : smart === 'starred' ? 'Starred' : smart === 'unread' ? 'Unread' : smart === 'recent' ? 'Recently added' : 'All citations'}
              <span className="ml-2 text-xxs font-normal text-[var(--color-text-muted)]">{filteredRows.length} items</span>
            </div>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search title, authors, DOI, notes…"
              className="pl-8 pr-2 py-1.5 text-xs rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] w-64"
              aria-label="Search library"
            />
          </div>
          <button
            onClick={() => setShowImport(s => !s)}
            className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--glass-border)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--glass-bg)]"
            aria-expanded={showImport}
          >
            Import
          </button>
          <div className="flex items-center gap-0.5 rounded-md border border-[var(--glass-border)] overflow-hidden">
            {(['bibtex', 'ris', 'csl'] as const).map(f => (
              <button
                key={f}
                onClick={() => exportFormat(f)}
                className="px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] border-r border-[var(--glass-border)] last:border-r-0"
                title={`Export ${selectedIds.size > 0 ? `${selectedIds.size} selected` : 'library'} as ${f.toUpperCase()}`}
              >
                <FiDownload className="w-3 h-3 inline mr-1" />{f.toUpperCase()}
              </button>
            ))}
          </div>
          {selectedIds.size > 0 && (
            <button
              onClick={bulkDelete}
              className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] flex items-center gap-1"
            >
              <FiTrash2 className="w-3 h-3" /> Delete {selectedIds.size}
            </button>
          )}
        </div>
        {showImport && (
          <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-solid)]">
            <ImportDropZone onImportText={importText} onImportPdf={importPdf} />
          </div>
        )}
        <div className="flex-1 overflow-auto min-h-0">
          {loading && citations.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">Loading library…</div>
          ) : citations.length === 0 ? (
            <EmptyState
              icon={<FiBookOpen />}
              title="Your library is empty"
              description="Drop a PDF or a BibTeX / RIS / CSL / EndNote file into the Import panel above to get started. Every citation you save here is searchable from Discovery and attaches inline when you draft a manuscript."
            />
          ) : (
            <LibraryTable
              citations={filteredRows}
              selectedIds={selectedIds}
              focusedId={focusedId}
              onFocus={id => { setFocusedId(id); setRightPane('detail') }}
              onSelectionChange={setSelectedIds}
              onToggleStar={toggleStar}
              onToggleRead={toggleRead}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
          )}
        </div>
      </div>

      {/* ── Right: detail panel / PDF reader ── */}
      {focused && (
        <aside className="w-[520px] flex-shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface-solid)] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
            <div className="flex gap-1">
              <button
                onClick={() => setRightPane('detail')}
                className={`text-xs px-2 py-1 rounded ${rightPane === 'detail' ? 'bg-[var(--glass-bg)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              >
                Detail
              </button>
              <button
                onClick={() => setRightPane('pdf')}
                className={`text-xs px-2 py-1 rounded ${rightPane === 'pdf' ? 'bg-[var(--glass-bg)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              >
                PDF {focused.pdf_url ? '' : '(no file)'}
              </button>
            </div>
            <button
              onClick={() => setFocusedId(null)}
              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              aria-label="Close detail panel"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {rightPane === 'pdf' ? (
              <PdfReader
                pdfUrl={focused.pdf_url || null}
                highlights={highlights}
                onAddHighlight={addHighlight}
                onDeleteHighlight={deleteHighlight}
                onUpdateHighlight={updateHighlight}
              />
            ) : (
              <DetailPanel
                citation={focused}
                folders={folders}
                onUpdate={patch => updateCitation(focused.id, patch)}
              />
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

// ─── DetailPanel ────────────────────────────────────────────────
// Editable metadata view. Text fields commit on blur; the author
// list uses a chip-style multi-value input.

function DetailPanel({ citation, folders, onUpdate }: {
  citation: LibraryCitation
  folders: LibraryFolder[]
  onUpdate: (patch: Partial<LibraryCitation>) => void | Promise<void>
}) {
  const [authorsDraft, setAuthorsDraft] = useState((citation.authors || []).join('; '))
  const [tagsDraft, setTagsDraft] = useState((citation.tags || []).join(', '))

  // Reset drafts when a different citation is focused.
  useEffect(() => {
    setAuthorsDraft((citation.authors || []).join('; '))
    setTagsDraft((citation.tags || []).join(', '))
  }, [citation.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const Field = ({ label, value, onCommit, placeholder, type = 'text' }:
    { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; type?: string }
  ) => {
    const [draft, setDraft] = useState(value)
    useEffect(() => setDraft(value), [value])
    return (
      <label className="block">
        <span className="block text-xxs font-medium text-[var(--color-text-muted)] mb-1">{label}</span>
        <input
          type={type}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onCommit(draft) }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder={placeholder}
          className="w-full px-2 py-1 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
        />
      </label>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {/* Title row */}
      <div>
        <span className="block text-xxs font-medium text-[var(--color-text-muted)] mb-1 flex items-center gap-1">
          <FiEdit3 className="w-3 h-3" /> Title
        </span>
        <textarea
          defaultValue={citation.title}
          onBlur={e => { if (e.target.value !== citation.title) onUpdate({ title: e.target.value }) }}
          rows={2}
          className="w-full px-2 py-1.5 text-sm font-medium rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] resize-none"
          aria-label="Title"
        />
      </div>

      <label className="block">
        <span className="block text-xxs font-medium text-[var(--color-text-muted)] mb-1">Authors (semicolon-separated)</span>
        <input
          value={authorsDraft}
          onChange={e => setAuthorsDraft(e.target.value)}
          onBlur={() => {
            const list = authorsDraft.split(';').map(a => a.trim()).filter(Boolean)
            if (JSON.stringify(list) !== JSON.stringify(citation.authors || [])) onUpdate({ authors: list })
          }}
          className="w-full px-2 py-1 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
          aria-label="Authors"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xxs font-medium text-[var(--color-text-muted)] mb-1">Type</span>
          <select
            value={citation.type}
            onChange={e => onUpdate({ type: e.target.value })}
            className="w-full px-2 py-1 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
            aria-label="Type"
          >
            {['journal', 'conference', 'book', 'preprint', 'thesis', 'website'].map(t =>
              <option key={t} value={t}>{t}</option>
            )}
          </select>
        </label>
        <Field label="Year" value={citation.year?.toString() || ''}
          onCommit={v => onUpdate({ year: v ? parseInt(v) : null })}
          placeholder="2024" type="number"
        />
      </div>

      <Field label="Journal / container" value={citation.journal || ''} onCommit={v => onUpdate({ journal: v || null })} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Volume" value={citation.volume || ''} onCommit={v => onUpdate({ volume: v || null })} />
        <Field label="Issue" value={citation.issue || ''} onCommit={v => onUpdate({ issue: v || null })} />
        <Field label="Pages" value={citation.pages || ''} onCommit={v => onUpdate({ pages: v || null })} />
      </div>

      <Field label="DOI" value={citation.doi || ''} onCommit={v => onUpdate({ doi: v || null })} placeholder="10.1038/..." />
      <Field label="PMID" value={citation.pmid || ''} onCommit={v => onUpdate({ pmid: v || null })} />
      <Field label="URL" value={citation.url || ''} onCommit={v => onUpdate({ url: v || null })} placeholder="https://..." />

      <label className="block">
        <span className="block text-xxs font-medium text-[var(--color-text-muted)] mb-1">Tags (comma-separated)</span>
        <input
          value={tagsDraft}
          onChange={e => setTagsDraft(e.target.value)}
          onBlur={() => {
            const list = tagsDraft.split(',').map(t => t.trim()).filter(Boolean)
            if (JSON.stringify(list) !== JSON.stringify(citation.tags || [])) onUpdate({ tags: list })
          }}
          className="w-full px-2 py-1 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
          aria-label="Tags"
        />
      </label>

      {/* Folders assignment */}
      {folders.length > 0 && (
        <div>
          <span className="block text-xxs font-medium text-[var(--color-text-muted)] mb-1 flex items-center gap-1">
            <FiFolder className="w-3 h-3" /> Folders
          </span>
          <div className="flex flex-wrap gap-1">
            {folders.map(f => {
              const inFolder = (citation.folders || []).includes(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    const next = inFolder
                      ? (citation.folders || []).filter(x => x !== f.id)
                      : [...(citation.folders || []), f.id]
                    onUpdate({ folders: next })
                  }}
                  className={`text-xxs px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                    inFolder
                      ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg)] text-[var(--color-text)]'
                      : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {inFolder && <FiCheck className="w-2.5 h-2.5" />}
                  {f.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <label className="block">
        <span className="block text-xxs font-medium text-[var(--color-text-muted)] mb-1">Abstract</span>
        <textarea
          defaultValue={citation.abstract || ''}
          onBlur={e => { if (e.target.value !== (citation.abstract || '')) onUpdate({ abstract: e.target.value || null }) }}
          rows={5}
          className="w-full px-2 py-1.5 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] resize-y leading-relaxed"
          placeholder="Paste abstract…"
          aria-label="Abstract"
        />
      </label>

      <label className="block">
        <span className="block text-xxs font-medium text-[var(--color-text-muted)] mb-1">Notes</span>
        <textarea
          defaultValue={citation.notes || ''}
          onBlur={e => { if (e.target.value !== (citation.notes || '')) onUpdate({ notes: e.target.value || null }) }}
          rows={4}
          className="w-full px-2 py-1.5 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] resize-y"
          placeholder="Your private notes…"
          aria-label="Notes"
        />
      </label>

      <div className="flex gap-2 pt-2 border-t border-[var(--color-border)]">
        {citation.doi && (
          <a href={`https://doi.org/${citation.doi}`} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-1 text-xxs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <FiLink className="w-3 h-3" /> DOI
          </a>
        )}
        {citation.pmid && (
          <a href={`https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}`} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-1 text-xxs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <FiExternalLink className="w-3 h-3" /> PubMed
          </a>
        )}
        {citation.url && (
          <a href={citation.url} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-1 text-xxs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <FiExternalLink className="w-3 h-3" /> Open URL
          </a>
        )}
        <span className="flex-1" />
        <button
          onClick={() => onUpdate({ starred: !citation.starred })}
          className="flex items-center gap-1 text-xxs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          aria-label={citation.starred ? 'Unstar' : 'Star'}
        >
          <FiStar className={`w-3 h-3 ${citation.starred ? 'fill-current text-[var(--color-accent,#C4956A)]' : ''}`} />
          {citation.starred ? 'Starred' : 'Star'}
        </button>
      </div>
    </div>
  )
}
