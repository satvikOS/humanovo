import { useState, useCallback } from 'react'
import {
  FiBook,
  FiPlus,
  FiCopy,
  FiDownload,
  FiTrash2,
  FiSearch,
  FiCheck,
} from 'react-icons/fi'

interface Citation {
  id: string
  type: 'journal' | 'book' | 'conference' | 'preprint' | 'website' | 'thesis'
  authors: string[]
  title: string
  journal?: string
  volume?: string
  issue?: string
  pages?: string
  year: number
  doi?: string
  url?: string
  publisher?: string
  tags: string[]
  createdAt: string
}

type CitationStyle = 'apa' | 'mla' | 'chicago' | 'vancouver' | 'harvard'

function formatCitation(c: Citation, style: CitationStyle): string {
  const authorStr = c.authors.length > 0 ? c.authors.join(', ') : 'Unknown'
  switch (style) {
    case 'apa':
      return `${authorStr} (${c.year}). ${c.title}. ${c.journal ? `*${c.journal}*` : ''}${c.volume ? `, ${c.volume}` : ''}${c.issue ? `(${c.issue})` : ''}${c.pages ? `, ${c.pages}` : ''}.${c.doi ? ` https://doi.org/${c.doi}` : ''}`
    case 'mla':
      return `${authorStr}. "${c.title}." ${c.journal || ''} ${c.volume || ''}.${c.issue || ''} (${c.year}): ${c.pages || 'n.p.'}.`
    case 'chicago':
      return `${authorStr}. "${c.title}." ${c.journal || ''} ${c.volume || ''}, no. ${c.issue || '-'} (${c.year}): ${c.pages || ''}.`
    case 'vancouver':
      return `${authorStr}. ${c.title}. ${c.journal || ''}. ${c.year};${c.volume || ''}(${c.issue || ''}):${c.pages || ''}.`
    case 'harvard':
      return `${authorStr} (${c.year}) '${c.title}', ${c.journal || ''}${c.volume ? `, vol. ${c.volume}` : ''}${c.issue ? `, no. ${c.issue}` : ''}${c.pages ? `, pp. ${c.pages}` : ''}.`
    default:
      return `${authorStr} (${c.year}). ${c.title}.`
  }
}

const CITATION_TYPES: Citation['type'][] = ['journal', 'book', 'conference', 'preprint', 'website', 'thesis']

export default function CitationManager() {
  const [citations, setCitations] = useState<Citation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('apa')
  const [copied, setCopied] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string>('')

  const [form, setForm] = useState({
    type: 'journal' as Citation['type'], title: '', authors: '', journal: '', volume: '',
    issue: '', pages: '', year: new Date().getFullYear(), doi: '', url: '', publisher: '', tags: '',
  })

  const saveCitations = useCallback((updated: Citation[]) => {
    setCitations(updated)
  }, [])

  const addCitation = () => {
    if (!form.title.trim()) return
    const citation: Citation = {
      id: `cite-${Date.now()}`,
      type: form.type,
      title: form.title,
      authors: form.authors.split(',').map(a => a.trim()).filter(Boolean),
      journal: form.journal || undefined,
      volume: form.volume || undefined,
      issue: form.issue || undefined,
      pages: form.pages || undefined,
      year: form.year,
      doi: form.doi || undefined,
      url: form.url || undefined,
      publisher: form.publisher || undefined,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
    }
    saveCitations([citation, ...citations])
    setForm({ type: 'journal', title: '', authors: '', journal: '', volume: '', issue: '', pages: '', year: new Date().getFullYear(), doi: '', url: '', publisher: '', tags: '' })
    setShowAddForm(false)
  }

  const deleteCitation = (id: string) => {
    saveCitations(citations.filter(c => c.id !== id))
  }

  const copyFormatted = (citation: Citation) => {
    const text = formatCitation(citation, citationStyle)
    navigator.clipboard.writeText(text)
    setCopied(citation.id)
    setTimeout(() => setCopied(null), 2000)
  }

  const exportBibliography = () => {
    const text = filtered.map((c, i) => `[${i + 1}] ${formatCitation(c, citationStyle)}`).join('\n\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `bibliography-${citationStyle}.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = citations
    .filter(c => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.authors.some(a => a.toLowerCase().includes(searchQuery.toLowerCase())))
    .filter(c => !filterType || c.type === filterType)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Citation Manager</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Manage references and generate bibliographies</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={citationStyle} onChange={e => setCitationStyle(e.target.value as CitationStyle)} className="input text-xs py-1.5">
              <option value="apa">APA 7th</option>
              <option value="mla">MLA 9th</option>
              <option value="chicago">Chicago</option>
              <option value="vancouver">Vancouver</option>
              <option value="harvard">Harvard</option>
            </select>
            <button onClick={exportBibliography} disabled={filtered.length === 0} className="btn text-sm disabled:opacity-30" style={{ color: 'var(--color-accent-blue)' }}>
              <FiDownload className="w-4 h-4" /> Export
            </button>
            <button onClick={() => setShowAddForm(!showAddForm)} className="btn text-sm" style={{ color: 'var(--color-success)' }}>
              <FiPlus className="w-4 h-4" /> Add Citation
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search citations..." className="input w-full pl-9" />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input text-xs py-2">
            <option value="">All Types</option>
            {CITATION_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
          <span className="text-xs text-[var(--color-text-muted)]">{filtered.length} citations</span>
        </div>
      </div>

      {/* Add form */}
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
            <input type="text" value={form.journal} onChange={e => setForm(f => ({ ...f, journal: e.target.value }))} placeholder="Journal / Source" className="input text-xs" />
            <div className="flex gap-2">
              <input type="text" value={form.volume} onChange={e => setForm(f => ({ ...f, volume: e.target.value }))} placeholder="Vol" className="input text-xs flex-1" />
              <input type="text" value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))} placeholder="Issue" className="input text-xs flex-1" />
              <input type="text" value={form.pages} onChange={e => setForm(f => ({ ...f, pages: e.target.value }))} placeholder="Pages" className="input text-xs flex-1" />
            </div>
            <input type="text" value={form.doi} onChange={e => setForm(f => ({ ...f, doi: e.target.value }))} placeholder="DOI" className="input text-xs" />
            <input type="text" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="Tags (comma-separated)" className="input text-xs" />
            <div className="col-span-2 flex gap-2">
              <button onClick={addCitation} disabled={!form.title.trim()} className="btn text-xs disabled:opacity-30" style={{ color: 'var(--color-success)' }}>Add Citation</button>
              <button onClick={() => setShowAddForm(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Citation list */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]">
              <FiBook className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm">{citations.length === 0 ? 'No citations yet' : 'No matching citations'}</p>
              <p className="text-xs mt-1">Add your first citation to build your bibliography</p>
            </div>
          ) : (
            filtered.map((citation, idx) => (
              <div key={citation.id} className="glass-card p-4 group">
                <div className="flex items-start gap-3">
                  <span className="text-xs text-[var(--color-text-muted)] font-mono mt-0.5 w-6 text-right flex-shrink-0">[{idx + 1}]</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                      {formatCitation(citation, citationStyle)}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">{citation.type}</span>
                      {citation.tags.map(t => (
                        <span key={t} className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">{t}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button onClick={() => copyFormatted(citation)} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]" title="Copy formatted">
                      {copied === citation.id ? <FiCheck className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} /> : <FiCopy className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => deleteCitation(citation.id)} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]" title="Delete">
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
