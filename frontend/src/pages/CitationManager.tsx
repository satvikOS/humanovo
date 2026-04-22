import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiBook, FiPlus, FiCopy, FiDownload, FiTrash2, FiSearch,
  FiCheck, FiUpload, FiFolder, FiEdit3, FiExternalLink,
  FiFile, FiX, FiRefreshCw, FiStar, FiBookOpen, FiHash,
  FiShield,
} from 'react-icons/fi'
import { usePersistentState, logActivity } from '../utils/persistence'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import api, { apiClient } from '../services/api'
import { toast } from '../contexts/ToastContext'

/**
 * Fetch wrapper for external third-party APIs (CrossRef / NCBI) that
 * can't route through our apiClient interceptor (different origin, no
 * /api/v1 prefix, no auth header). Adds:
 *   - 10s timeout via AbortController
 *   - One retry with 500ms backoff on network / 5xx errors
 *   - Toast on final failure so citation lookups never fail silently
 *
 * Returns the Response for success, null on failure (caller decides
 * how to degrade).
 */
async function externalFetch(url: string, label: string): Promise<Response | null> {
  const attempt = async (): Promise<Response> => {
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 10_000)
    try {
      return await fetch(url, { signal: ac.signal })
    } finally {
      window.clearTimeout(timer)
    }
  }
  for (let i = 0; i < 2; i++) {
    try {
      const res = await attempt()
      if (res.ok) return res
      if (res.status >= 500 && i === 0) {
        await new Promise(r => setTimeout(r, 500))
        continue
      }
      // 4xx (not-found etc.) — no retry, caller treats as "no metadata".
      return null
    } catch (e) {
      if (i === 0) {
        await new Promise(r => setTimeout(r, 500))
        continue
      }
      const msg = e instanceof Error && e.name === 'AbortError'
        ? `${label} timed out after 10s`
        : `${label} unreachable — check your connection`
      toast('error', msg, { title: 'Citation lookup' })
      return null
    }
  }
  return null
}

interface Citation {
  id: string
  type: 'journal' | 'book' | 'conference' | 'preprint' | 'website' | 'thesis'
  authors: string[]
  title: string
  abstract?: string
  journal?: string
  volume?: string
  issue?: string
  pages?: string
  year: number
  doi?: string
  pmid?: string
  url?: string
  publisher?: string
  tags: string[]
  collection?: string
  notes?: string
  starred?: boolean
  pdfUrl?: string
  createdAt: string
}

type CitationStyle = 'apa' | 'mla' | 'chicago' | 'vancouver'

/**
 * Format author names for different citation styles.
 */
function formatAuthorsAPA(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
  if (authors.length <= 20) return `${authors.slice(0, -1).join(', ')}, & ${authors[authors.length - 1]}`
  return `${authors.slice(0, 19).join(', ')}, ... ${authors[authors.length - 1]}`
}

function formatAuthorsMLA(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]}, and ${authors[1]}`
  return `${authors[0]}, et al.`
}

function formatAuthorsVancouver(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  if (authors.length <= 6) return authors.join(', ')
  return `${authors.slice(0, 6).join(', ')}, et al.`
}

/** Convert title to APA sentence case: capitalize first word, first word after colon, and preserve acronyms */
function toSentenceCase(title: string): string {
  return title.replace(/[^:]+/g, (segment, offset) => {
    return segment.replace(/\S+/g, (word, wordOffset) => {
      // Keep the very first word of the title or first word after a colon capitalized
      if ((offset === 0 && wordOffset === 0) || (offset > 0 && wordOffset <= 1)) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      }
      // Preserve all-uppercase acronyms (DNA, RNA, BRCA1, etc.)
      if (word === word.toUpperCase() && word.length >= 2 && /[A-Z]/.test(word)) return word
      return word.toLowerCase()
    })
  })
}

/** Ensure author string ends with a period for APA */
function apaAuthorBlock(authors: string[]): string {
  const formatted = formatAuthorsAPA(authors)
  // Add trailing period if not already present
  return formatted.endsWith('.') ? formatted : `${formatted}.`
}

function formatCitation(c: Citation, style: CitationStyle): string {
  const isBook = c.type === 'book'
  const isWebsite = c.type === 'website'
  const isThesis = c.type === 'thesis'
  const isConference = c.type === 'conference'

  switch (style) {
    case 'apa': {
      const authors = apaAuthorBlock(c.authors)
      const title = toSentenceCase(c.title)
      if (isBook) {
        let ref = `${authors} (${c.year}). <em>${title}</em>.`
        if (c.publisher) ref += ` ${c.publisher}.`
        if (c.doi) ref += ` https://doi.org/${c.doi}`
        return ref
      }
      if (isWebsite) {
        let ref = `${authors} (${c.year}). ${title}.`
        if (c.publisher) ref += ` ${c.publisher}.`
        if (c.url) ref += ` ${c.url}`
        return ref
      }
      if (isThesis) {
        let ref = `${authors} (${c.year}). <em>${title}</em> [Doctoral dissertation].`
        if (c.publisher) ref += ` ${c.publisher}.`
        if (c.doi) ref += ` https://doi.org/${c.doi}`
        return ref
      }
      if (isConference) {
        let ref = `${authors} (${c.year}). ${title}.`
        if (c.journal) ref += ` In <em>${c.journal}</em>`
        if (c.pages) ref += ` (pp. ${c.pages})`
        ref += '.'
        if (c.publisher) ref += ` ${c.publisher}.`
        if (c.doi) ref += ` https://doi.org/${c.doi}`
        return ref
      }
      // journal / preprint
      let ref = `${authors} (${c.year}). ${title}.`
      if (c.journal) {
        ref += ` <em>${c.journal}</em>`
        if (c.volume) {
          ref += `, <em>${c.volume}</em>`
          if (c.issue) ref += `(${c.issue})`
        }
        if (c.pages) ref += `, ${c.pages}`
        ref += '.'
      }
      if (c.doi) ref += ` https://doi.org/${c.doi}`
      return ref
    }
    case 'mla': {
      const authors = formatAuthorsMLA(c.authors)
      if (isBook) {
        let ref = `${authors}. <em>${c.title}</em>.`
        if (c.publisher) ref += ` ${c.publisher},`
        ref += ` ${c.year}.`
        if (c.doi) ref += ` https://doi.org/${c.doi}`
        return ref
      }
      if (isWebsite) {
        let ref = `${authors}. "${c.title}."`
        if (c.publisher) ref += ` <em>${c.publisher}</em>,`
        ref += ` ${c.year}.`
        if (c.url) ref += ` ${c.url}`
        return ref
      }
      // journal / conference / preprint / thesis
      let ref = `${authors}. "${c.title}."`
      if (c.journal) {
        ref += ` <em>${c.journal}</em>`
        if (c.volume) {
          ref += `, vol. ${c.volume}`
          if (c.issue) ref += `, no. ${c.issue}`
        }
        ref += `, ${c.year}`
        if (c.pages) ref += `, pp. ${c.pages}`
        ref += '.'
      }
      if (c.doi) ref += ` https://doi.org/${c.doi}`
      return ref
    }
    case 'chicago': {
      const authors = c.authors.length > 0 ? c.authors.join(', ') : 'Unknown'
      if (isBook) {
        let ref = `${authors}. <em>${c.title}</em>.`
        if (c.publisher) ref += ` ${c.publisher},`
        ref += ` ${c.year}.`
        if (c.doi) ref += ` https://doi.org/${c.doi}`
        return ref
      }
      // journal / conference / preprint / website / thesis
      let ref = `${authors}. "${c.title}."`
      if (c.journal) {
        ref += ` <em>${c.journal}</em>`
        if (c.volume) ref += ` ${c.volume}`
        if (c.issue) ref += `, no. ${c.issue}`
        ref += ` (${c.year})`
        if (c.pages) ref += `: ${c.pages}`
        ref += '.'
      }
      if (c.doi) ref += ` https://doi.org/${c.doi}`
      return ref
    }
    case 'vancouver': {
      const authors = formatAuthorsVancouver(c.authors)
      if (isBook) {
        let ref = `${authors}. ${c.title}.`
        if (c.publisher) ref += ` ${c.publisher};`
        ref += ` ${c.year}.`
        if (c.doi) ref += ` doi:${c.doi}`
        return ref
      }
      // journal / conference / preprint / website / thesis
      let ref = `${authors}. ${c.title}.`
      if (c.journal) {
        ref += ` ${c.journal}. ${c.year}`
        if (c.volume) {
          ref += `;${c.volume}`
          if (c.issue) ref += `(${c.issue})`
        }
        if (c.pages) ref += `:${c.pages}`
        ref += '.'
      }
      if (c.doi) ref += ` doi:${c.doi}`
      return ref
    }
    default:
      return `${c.authors.length > 0 ? c.authors.join(', ') : 'Unknown'} (${c.year}). ${c.title}.`
  }
}

const CITATION_TYPES: Citation['type'][] = ['journal', 'book', 'conference', 'preprint', 'website', 'thesis']

// Fetch citation metadata from DOI via CrossRef API
async function fetchFromDOI(doi: string): Promise<Partial<Citation> | null> {
  try {
    const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, '').trim()
    const res = await externalFetch(
      `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`,
      'CrossRef',
    )
    if (!res) return null
    const data = await res.json()
    const item = data.message
    return {
      title: (item.title || [])[0] || '',
      authors: (item.author || []).map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()),
      journal: (item['container-title'] || [])[0] || item.publisher || '',
      volume: item.volume || '',
      issue: item.issue || '',
      pages: item.page || '',
      year: item.published?.['date-parts']?.[0]?.[0] || new Date().getFullYear(),
      doi: cleanDoi,
      type: item.type === 'book-chapter' ? 'book' : item.type === 'proceedings-article' ? 'conference' : 'journal',
      url: item.URL || '',
      abstract: item.abstract?.replace(/<[^>]*>/g, '') || '',
    }
  } catch { return null }
}

// Fetch citation metadata from PMID via NCBI E-utilities
async function fetchFromPMID(pmid: string): Promise<Partial<Citation> | null> {
  try {
    const cleanPmid = pmid.replace(/\D/g, '')
    const res = await externalFetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${cleanPmid}&retmode=json`,
      'NCBI PubMed',
    )
    if (!res) return null
    const data = await res.json()
    const item = data.result?.[cleanPmid]
    if (!item) return null
    return {
      title: item.title || '',
      authors: (item.authors || []).map((a: any) => a.name),
      journal: item.fulljournalname || item.source || '',
      volume: item.volume || '',
      issue: item.issue || '',
      pages: item.pages || '',
      year: parseInt(item.pubdate?.split(' ')?.[0]) || new Date().getFullYear(),
      pmid: cleanPmid,
      doi: (item.elocationid || '').replace('doi: ', ''),
      type: 'journal',
      url: `https://pubmed.ncbi.nlm.nih.gov/${cleanPmid}`,
      abstract: '',
    }
  } catch { return null }
}

export default function CitationManager() {
  const [citations, setCitations] = usePersistentState<Citation[]>('citations', [])
  // Deep-link support: `?q=` seeds the search filter, `?add=1` opens the
  // Add citation form, `?import=1` opens the import-by-DOI/PMID flow.
  // Consumed-and-cleaned pattern matches Evidence/Projects/Agents.
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [showAddForm, setShowAddForm] = useState(() => searchParams.get('add') === '1')
  const [showImport, setShowImport] = useState(() => searchParams.get('import') === '1')
  useEffect(() => {
    if (searchParams.has('q') || searchParams.has('add') || searchParams.has('import')) {
      const next = new URLSearchParams(searchParams)
      next.delete('q')
      next.delete('add')
      next.delete('import')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('apa')
  const [copied, setCopied] = useState<string | null>(null)
  // Citation-verify state: per-id verdict/loading from the backend
  // round-trip (CrossRef + NCBI). Keyed by citation.id so the list row
  // can render a verdict badge next to each entry.
  type VerifyVerdict = 'verified' | 'fabricated' | 'network_error'
  interface VerifyResult { verdict: VerifyVerdict; message: string }
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({})
  const [verifyLoading, setVerifyLoading] = useState<Record<string, boolean>>({})

  const verifyCitation = async (citation: Citation) => {
    setVerifyLoading(prev => ({ ...prev, [citation.id]: true }))
    try {
      const data = await api.verifyCitation(
        citation.doi ? { doi: citation.doi } : { pmid: citation.pmid }
      )
      const verdict: VerifyVerdict = !data.network_ok
        ? 'network_error'
        : data.is_fabricated
        ? 'fabricated'
        : 'verified'
      setVerifyResults(prev => ({
        ...prev,
        [citation.id]: { verdict, message: data.message || '' },
      }))
    } catch (err: unknown) {
      setVerifyResults(prev => ({
        ...prev,
        [citation.id]: {
          verdict: 'network_error',
          message: err instanceof Error ? err.message : String(err),
        },
      }))
    } finally {
      setVerifyLoading(prev => ({ ...prev, [citation.id]: false }))
    }
  }
  const [filterType, setFilterType] = useState<string>('')
  const [filterCollection, setFilterCollection] = useState<string>('')
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null)
  const [importId, setImportId] = useState('')
  const [importing, setImporting] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'starred' | 'collections'>('all')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    type: 'journal' as Citation['type'], title: '', authors: '', journal: '', volume: '',
    issue: '', pages: '', year: new Date().getFullYear(), doi: '', pmid: '', url: '', publisher: '', tags: '', collection: '', abstract: '',
  })

  // Load citations from backend API on mount
  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await apiClient.get('/evidence', {
          params: { page_size: 100 },
          headers: { 'X-Silent-Error': '1' },
        })
        if (data.items?.length > 0) {
          const loaded = data.items.map((e: any) => ({
            id: e.id,
            type: e.source_type === 'pubmed' ? 'journal' : e.source_type === 'preprint' ? 'preprint' : 'journal',
            title: e.title || '',
            authors: e.authors || [],
            journal: e.journal || '',
            year: e.publication_date ? new Date(e.publication_date).getFullYear() : 0,
            doi: e.doi || '',
            tags: e.tags || [],
            abstract: e.abstract || e.snippet || '',
            url: e.source_url || '',
            notes: e.notes || '',
            createdAt: e.created_at || new Date().toISOString(),
          }))
          setCitations(prev => {
            const existingIds = new Set(prev.map(p => p.id))
            return [...prev, ...loaded.filter((l: any) => !existingIds.has(l.id))]
          })
        }
      } catch { /* API unavailable */ }
    }
    load()
  }, [])

  const saveCitation = useCallback((updated: Citation[]) => {
    setCitations(updated)
  }, [])

  const addCitation = () => {
    if (!form.title.trim()) return
    const citation: Citation = {
      id: `cite-${Date.now()}`,
      type: form.type,
      title: form.title,
      authors: form.authors.split(',').map(a => a.trim()).filter(Boolean),
      abstract: form.abstract || undefined,
      journal: form.journal || undefined,
      volume: form.volume || undefined,
      issue: form.issue || undefined,
      pages: form.pages || undefined,
      year: form.year,
      doi: form.doi || undefined,
      pmid: form.pmid || undefined,
      url: form.url || undefined,
      publisher: form.publisher || undefined,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      collection: form.collection || undefined,
      createdAt: new Date().toISOString(),
    }
    saveCitation([citation, ...citations])
    setForm({ type: 'journal', title: '', authors: '', journal: '', volume: '', issue: '', pages: '', year: new Date().getFullYear(), doi: '', pmid: '', url: '', publisher: '', tags: '', collection: '', abstract: '' })
    setShowAddForm(false)
    logActivity({ type: 'notebook', action: 'created', title: `Added citation: ${citation.title}` })

    // Persist to backend
    ;(async () => {
      try {
        await apiClient.post('/evidence', {
          title: citation.title,
          source_type: citation.type === 'journal' ? 'pubmed' : citation.type,
          abstract: citation.abstract,
          authors: citation.authors,
          publication_date: `${citation.year}-01-01`,
          tags: citation.tags,
          source_url: citation.url || (citation.doi ? `https://doi.org/${citation.doi}` : undefined),
        }, { headers: { 'X-Silent-Error': '1' } })
      } catch { /* non-fatal */ }
    })()
  }

  const importFromId = async () => {
    if (!importId.trim()) return
    setImporting(true)
    try {
      let result: Partial<Citation> | null = null
      const id = importId.trim()
      if (id.match(/^10\.\d+\//) || id.includes('doi.org')) {
        result = await fetchFromDOI(id)
      } else if (id.match(/^\d+$/)) {
        result = await fetchFromPMID(id)
      } else if (id.startsWith('10.')) {
        result = await fetchFromDOI(id)
      }

      if (result && result.title) {
        const citation: Citation = {
          id: `cite-${Date.now()}`,
          type: result.type || 'journal',
          title: result.title || '',
          authors: result.authors || [],
          abstract: result.abstract || '',
          journal: result.journal || '',
          volume: result.volume || '',
          issue: result.issue || '',
          pages: result.pages || '',
          year: result.year || new Date().getFullYear(),
          doi: result.doi || '',
          pmid: result.pmid || '',
          url: result.url || '',
          tags: [],
          createdAt: new Date().toISOString(),
        }
        saveCitation([citation, ...citations])
        setImportId('')
        setShowImport(false)
        logActivity({ type: 'notebook', action: 'imported', title: `Imported citation: ${citation.title}` })
      }
    } catch { /* import failed */ }
    setImporting(false)
  }

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Create citation from PDF filename
    const name = file.name.replace(/\.pdf$/i, '')
    const citation: Citation = {
      id: `cite-${Date.now()}`,
      type: 'journal',
      title: name,
      authors: [],
      year: new Date().getFullYear(),
      tags: ['uploaded'],
      pdfUrl: URL.createObjectURL(file),
      createdAt: new Date().toISOString(),
    }
    saveCitation([citation, ...citations])
    logActivity({ type: 'notebook', action: 'imported', title: `Uploaded PDF citation: ${name}` })

    // Upload to backend
    try {
      const formData = new FormData()
      formData.append('file', file)
      await apiClient.post('/ingestion/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data', 'X-Silent-Error': '1' },
      })
    } catch { /* non-fatal */ }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const deleteCitation = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = () => {
    if (deleteConfirmId) {
      const deletedCitation = citations.find(c => c.id === deleteConfirmId)
      saveCitation(citations.filter(c => c.id !== deleteConfirmId))
      setDeleteConfirmId(null)
      logActivity({ type: 'notebook', action: 'deleted', title: `Deleted citation: ${deletedCitation?.title || deleteConfirmId}` })
    }
  }

  const toggleStar = (id: string) => {
    saveCitation(citations.map(c => c.id === id ? { ...c, starred: !c.starred } : c))
  }

  const updateNotes = (id: string, notes: string) => {
    saveCitation(citations.map(c => c.id === id ? { ...c, notes } : c))
  }

  const copyFormatted = (citation: Citation) => {
    const text = formatCitation(citation, citationStyle).replace(/<[^>]*>/g, '')
    navigator.clipboard.writeText(text)
    setCopied(citation.id)
    setTimeout(() => setCopied(null), 2000)
  }

  const exportBibliography = () => {
    const text = filtered.map((c, i) => `[${i + 1}] ${formatCitation(c, citationStyle).replace(/<[^>]*>/g, '')}`).join('\n\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `bibliography-${citationStyle}.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  const collections = [...new Set(citations.filter(c => c.collection).map(c => c.collection!))]

  const filtered = citations
    .filter(c => activeTab !== 'starred' || c.starred)
    .filter(c => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.authors.some(a => a.toLowerCase().includes(searchQuery.toLowerCase())) || (c.abstract || '').toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(c => !filterType || c.type === filterType)
    .filter(c => !filterCollection || c.collection === filterCollection)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Citation Manager</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Organize, annotate, and cite academic papers</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={citationStyle} onChange={e => setCitationStyle(e.target.value as CitationStyle)} className="input text-xs py-1.5">
              <option value="apa">APA 7th</option>
              <option value="mla">MLA 9th</option>
              <option value="chicago">Chicago 17th</option>
              <option value="vancouver">Vancouver</option>
            </select>
            <button onClick={exportBibliography} disabled={filtered.length === 0} className="btn text-sm disabled:opacity-30" style={{ color: 'var(--color-text-secondary)' }}>
              <FiDownload className="w-4 h-4" /> Export
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handlePdfUpload} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="btn text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <FiUpload className="w-4 h-4" /> Upload PDF
            </button>
            <button onClick={() => { setShowImport(!showImport); setShowAddForm(false) }} className="btn text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <FiHash className="w-4 h-4" /> Import DOI/PMID
            </button>
            <button onClick={() => { setShowAddForm(!showAddForm); setShowImport(false) }} className="btn text-sm" style={{ color: 'var(--color-success)' }}>
              <FiPlus className="w-4 h-4" /> Manual Add
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-4 mb-3">
          {(['all', 'starred', 'collections'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`text-xs pb-1 border-b-2 transition-colors ${activeTab === tab ? 'border-[var(--color-text)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              {tab === 'all' ? `All (${citations.length})` : tab === 'starred' ? `Starred (${citations.filter(c => c.starred).length})` : `Collections (${collections.length})`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by title, authors, abstract..." className="input w-full pl-9" />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input text-xs py-2">
            <option value="">All Types</option>
            {CITATION_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
          {activeTab === 'collections' && collections.length > 0 && (
            <select value={filterCollection} onChange={e => setFilterCollection(e.target.value)} className="input text-xs py-2">
              <option value="">All Collections</option>
              {collections.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <span className="text-xs text-[var(--color-text-muted)]">{filtered.length} results</span>
        </div>
      </div>

      {/* DOI/PMID Import */}
      {showImport && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)] animate-slide-down">
          <div className="max-w-xl mx-auto">
            <label className="text-xs text-[var(--color-text-muted)] mb-2 block">Enter a DOI or PMID to auto-import citation metadata</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={importId}
                onChange={e => setImportId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && importFromId()}
                placeholder="e.g., 10.1038/nature12373 or 25123456"
                className="input flex-1 text-sm"
              />
              <button onClick={importFromId} disabled={importing || !importId.trim()} className="btn text-xs disabled:opacity-30" style={{ color: 'var(--color-text-secondary)' }}>
                {importing ? <FiRefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FiDownload className="w-3.5 h-3.5" />}
                {importing ? 'Fetching...' : 'Import'}
              </button>
              <button onClick={() => setShowImport(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
            <p className="text-xxs text-[var(--color-text-muted)] mt-2">Supported: DOI (e.g., 10.1038/nature12373), PMID (e.g., 25123456)</p>
          </div>
        </div>
      )}

      {/* Manual Add form */}
      {showAddForm && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)] animate-slide-down">
          <div className="max-w-3xl mx-auto grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Title *" className="input w-full text-sm" />
            </div>
            <input type="text" value={form.authors} onChange={e => setForm(f => ({ ...f, authors: e.target.value }))} placeholder="Authors (comma-separated)" className="input text-xs" />
            <div className="flex gap-2">
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as Citation['type'] }))} className="input text-xs flex-1">
                {CITATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: parseInt(e.target.value) }))} className="input text-xs w-24" />
            </div>
            {(form.type === 'journal' || form.type === 'preprint' || form.type === 'conference') && (
              <>
                <input type="text" value={form.journal} onChange={e => setForm(f => ({ ...f, journal: e.target.value }))} placeholder={form.type === 'conference' ? 'Conference / Proceedings' : 'Journal / Source'} className="input text-xs" />
                <div className="flex gap-2">
                  <input type="text" value={form.volume} onChange={e => setForm(f => ({ ...f, volume: e.target.value }))} placeholder="Vol" className="input text-xs flex-1" />
                  <input type="text" value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))} placeholder="Issue" className="input text-xs flex-1" />
                  <input type="text" value={form.pages} onChange={e => setForm(f => ({ ...f, pages: e.target.value }))} placeholder="Pages" className="input text-xs flex-1" />
                </div>
              </>
            )}
            {form.type === 'book' && (
              <input type="text" value={form.publisher} onChange={e => setForm(f => ({ ...f, publisher: e.target.value }))} placeholder="Publisher" className="input text-xs col-span-2" />
            )}
            {form.type === 'thesis' && (
              <>
                <input type="text" value={form.publisher} onChange={e => setForm(f => ({ ...f, publisher: e.target.value }))} placeholder="University / Institution" className="input text-xs" />
                <input type="text" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="URL" className="input text-xs" />
              </>
            )}
            {form.type === 'website' && (
              <>
                <input type="text" value={form.publisher} onChange={e => setForm(f => ({ ...f, publisher: e.target.value }))} placeholder="Website / Publisher Name" className="input text-xs" />
                <input type="text" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="URL *" className="input text-xs" />
              </>
            )}
            <input type="text" value={form.doi} onChange={e => setForm(f => ({ ...f, doi: e.target.value }))} placeholder="DOI" className="input text-xs" />
            <input type="text" value={form.pmid} onChange={e => setForm(f => ({ ...f, pmid: e.target.value }))} placeholder="PMID" className="input text-xs" />
            <input type="text" value={form.collection} onChange={e => setForm(f => ({ ...f, collection: e.target.value }))} placeholder="Collection (e.g., Literature Review)" className="input text-xs" />
            <input type="text" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="Tags (comma-separated)" className="input text-xs" />
            <div className="col-span-2">
              <textarea value={form.abstract} onChange={e => setForm(f => ({ ...f, abstract: e.target.value }))} placeholder="Abstract (optional)" className="input w-full text-xs h-20 resize-none" />
            </div>
            <div className="col-span-2 flex gap-2">
              <button onClick={addCitation} disabled={!form.title.trim()} className="btn text-xs disabled:opacity-30" style={{ color: 'var(--color-success)' }}>Add Citation</button>
              <button onClick={() => setShowAddForm(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Main content: list + detail panel */}
      <div className="flex-1 flex min-h-0">
        {/* Citation list */}
        <div className={`${selectedCitation ? 'w-1/2' : 'w-full'} overflow-y-auto p-6 border-r border-[var(--color-border)]`}>
          <div className="max-w-3xl mx-auto space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-[var(--color-text-muted)]">
                <FiBook className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p className="text-sm">{citations.length === 0 ? 'No citations yet' : 'No matching citations'}</p>
                <p className="text-xs mt-1">Import via DOI/PMID, upload a PDF, or add manually</p>
              </div>
            ) : (
              filtered.map((citation, idx) => (
                <div
                  key={citation.id}
                  onClick={() => setSelectedCitation(citation)}
                  className={`glass-card p-4 group cursor-pointer transition-all ${selectedCitation?.id === citation.id ? 'border-white/30' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-[var(--color-text-muted)] font-mono mt-0.5 w-6 text-right flex-shrink-0">[{idx + 1}]</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] leading-snug">{citation.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        {citation.authors.slice(0, 3).join(', ')}{citation.authors.length > 3 ? ' et al.' : ''}
                        {citation.journal ? ` \u00B7 ${citation.journal}` : ''}
                        {citation.year ? ` (${citation.year})` : ''}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">{citation.type}</span>
                        {citation.collection && (
                          <span className="text-xxs px-1.5 py-0.5 rounded bg-white/5 text-[var(--color-text)]">
                            <FiFolder className="w-2.5 h-2.5 inline mr-0.5" />{citation.collection}
                          </span>
                        )}
                        {citation.tags.slice(0, 3).map(t => (
                          <span key={t} className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">{t}</span>
                        ))}
                        {citation.doi && <span className="text-xxs text-[var(--color-text)]">DOI</span>}
                        {citation.pmid && <span className="text-xxs text-[var(--color-text)]">PubMed</span>}
                        {verifyResults[citation.id] && (
                          <span
                            aria-label={`Verification: ${verifyResults[citation.id].verdict}`}
                            className="text-xxs px-1.5 py-0.5 rounded"
                            style={{
                              background:
                                verifyResults[citation.id].verdict === 'verified'
                                  ? 'rgba(34, 197, 94, 0.14)'
                                  : verifyResults[citation.id].verdict === 'fabricated'
                                  ? 'rgba(239, 68, 68, 0.14)'
                                  : 'rgba(234, 179, 8, 0.14)',
                              color:
                                verifyResults[citation.id].verdict === 'verified'
                                  ? '#4ade80'
                                  : verifyResults[citation.id].verdict === 'fabricated'
                                  ? '#f87171'
                                  : '#fbbf24',
                              border: '1px solid currentColor',
                            }}
                            title={verifyResults[citation.id].message}
                          >
                            {verifyResults[citation.id].verdict}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); toggleStar(citation.id) }} className="p-1.5 rounded hover:bg-[var(--glass-bg)]" title="Star">
                        <FiStar className={`w-3.5 h-3.5 ${citation.starred ? 'text-[var(--color-text-secondary)] fill-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); copyFormatted(citation) }} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]" title="Copy formatted">
                        {copied === citation.id ? <FiCheck className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} /> : <FiCopy className="w-3.5 h-3.5" />}
                      </button>
                      {(citation.doi || citation.pmid) && (
                        <button
                          aria-label="Verify citation"
                          onClick={(e) => { e.stopPropagation(); verifyCitation(citation) }}
                          disabled={verifyLoading[citation.id]}
                          className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] disabled:opacity-40"
                          title="Verify via CrossRef / NCBI round-trip"
                        >
                          <FiShield className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); deleteCitation(citation.id) }} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]" title="Delete">
                        <FiTrash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Detail / annotation panel */}
        {selectedCitation && (
          <div className="w-1/2 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Citation Details</h3>
              <button onClick={() => setSelectedCitation(null)} className="p-1 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Formatted citation */}
              <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-muted)] mb-1 font-medium">Formatted ({citationStyle.toUpperCase()})</p>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed" dangerouslySetInnerHTML={{ __html: formatCitation(selectedCitation, citationStyle) }} />
              </div>

              {/* Title */}
              <div>
                <p className="text-xs text-[var(--color-text-muted)] mb-1 font-medium">Title</p>
                <p className="text-sm text-[var(--color-text)]">{selectedCitation.title}</p>
              </div>

              {/* Authors */}
              {selectedCitation.authors.length > 0 && (
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] mb-1 font-medium">Authors</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">{selectedCitation.authors.join(', ')}</p>
                </div>
              )}

              {/* Abstract */}
              {selectedCitation.abstract && (
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] mb-1 font-medium">Abstract</p>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{selectedCitation.abstract}</p>
                </div>
              )}

              {/* Links */}
              <div className="flex items-center gap-3">
                {selectedCitation.doi && (
                  <a href={`https://doi.org/${selectedCitation.doi}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/5 text-[var(--color-text)] hover:bg-white/10 transition-colors">
                    <FiExternalLink className="w-3 h-3" /> DOI
                  </a>
                )}
                {selectedCitation.pmid && (
                  <a href={`https://pubmed.ncbi.nlm.nih.gov/${selectedCitation.pmid}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/5 text-[var(--color-text)] hover:bg-white/10 transition-colors">
                    <FiBookOpen className="w-3 h-3" /> PubMed
                  </a>
                )}
                {selectedCitation.pdfUrl && (
                  <a href={selectedCitation.pdfUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/5 text-[var(--color-text)] hover:bg-white/10 transition-colors">
                    <FiFile className="w-3 h-3" /> View PDF
                  </a>
                )}
              </div>

              {/* Metadata — type-aware: only show fields relevant to this citation type */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-[var(--color-text-muted)]">Type:</span> <span className="text-[var(--color-text-secondary)] capitalize">{selectedCitation.type}</span></div>
                <div><span className="text-[var(--color-text-muted)]">Year:</span> <span className="text-[var(--color-text-secondary)]">{selectedCitation.year}</span></div>
                {/* Journal/conference/preprint fields */}
                {(selectedCitation.type === 'journal' || selectedCitation.type === 'preprint' || selectedCitation.type === 'conference') && selectedCitation.journal && (
                  <div><span className="text-[var(--color-text-muted)]">{selectedCitation.type === 'conference' ? 'Conference:' : 'Journal:'}</span> <span className="text-[var(--color-text-secondary)]">{selectedCitation.journal}</span></div>
                )}
                {(selectedCitation.type === 'journal' || selectedCitation.type === 'preprint' || selectedCitation.type === 'conference') && selectedCitation.volume && (
                  <div><span className="text-[var(--color-text-muted)]">Volume:</span> <span className="text-[var(--color-text-secondary)]">{selectedCitation.volume}</span></div>
                )}
                {(selectedCitation.type === 'journal' || selectedCitation.type === 'preprint' || selectedCitation.type === 'conference') && selectedCitation.issue && (
                  <div><span className="text-[var(--color-text-muted)]">Issue:</span> <span className="text-[var(--color-text-secondary)]">{selectedCitation.issue}</span></div>
                )}
                {(selectedCitation.type === 'journal' || selectedCitation.type === 'preprint' || selectedCitation.type === 'conference') && selectedCitation.pages && (
                  <div><span className="text-[var(--color-text-muted)]">Pages:</span> <span className="text-[var(--color-text-secondary)]">{selectedCitation.pages}</span></div>
                )}
                {/* Book/thesis/website fields */}
                {(selectedCitation.type === 'book' || selectedCitation.type === 'thesis') && selectedCitation.publisher && (
                  <div><span className="text-[var(--color-text-muted)]">{selectedCitation.type === 'thesis' ? 'Institution:' : 'Publisher:'}</span> <span className="text-[var(--color-text-secondary)]">{selectedCitation.publisher}</span></div>
                )}
                {(selectedCitation.type === 'website') && selectedCitation.publisher && (
                  <div><span className="text-[var(--color-text-muted)]">Website:</span> <span className="text-[var(--color-text-secondary)]">{selectedCitation.publisher}</span></div>
                )}
                {(selectedCitation.type === 'website' || selectedCitation.type === 'thesis') && selectedCitation.url && (
                  <div className="col-span-2"><span className="text-[var(--color-text-muted)]">URL:</span> <span className="text-[var(--color-text-secondary)] break-all">{selectedCitation.url}</span></div>
                )}
              </div>

              {/* Notes / Annotations */}
              <div>
                <p className="text-xs text-[var(--color-text-muted)] mb-1 font-medium flex items-center gap-1">
                  <FiEdit3 className="w-3 h-3" /> Notes & Annotations
                </p>
                <textarea
                  value={selectedCitation.notes || ''}
                  onChange={e => updateNotes(selectedCitation.id, e.target.value)}
                  placeholder="Add your notes, key findings, relevant quotes..."
                  className="input w-full text-xs h-32 resize-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>
      {deleteConfirmId && (
        <ConfirmDeleteDialog
          title="Delete Citation?"
          message="This will permanently remove this citation from your library. This action cannot be undone."
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}
