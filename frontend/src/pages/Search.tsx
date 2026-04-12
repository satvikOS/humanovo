import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { formatDate, persistGet, getActivityLog } from '../utils/persistence'
import {
  FiSearch,
  FiCalendar,
  FiDatabase,
  FiZap,
  FiFileText,
  FiFolder,
  FiBookmark,
  FiClock,
  FiSliders,
  FiGlobe,
  FiLoader,
  FiX,
  FiStar,
} from 'react-icons/fi'
import api from '../services/api'
import type { SearchResult } from '../services/api'

type SortBy = 'relevance' | 'date' | 'citations'

const SOURCE_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  evidence: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Evidence' },
  hypothesis: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Hypothesis' },
  project: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Project' },
  entity: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Entity' },
  notebook: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Notebook' },
  gene: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Gene' },
  protein: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Protein' },
  drug: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Drug' },
  disease: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Disease' },
  pathway: { color: 'var(--color-text-muted)', bg: 'var(--glass-bg)', label: 'Pathway' },
  pubmed: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'PubMed' },
  clinical_trial: { color: 'var(--color-text-secondary)', bg: 'var(--glass-bg)', label: 'Clinical Trial' },
  rag: { color: 'var(--color-text-muted)', bg: 'var(--glass-bg)', label: 'RAG' },
  unknown: { color: 'var(--color-text-muted)', bg: 'var(--glass-bg)', label: 'Other' },
}

const getSourceStyle = (sourceType: string) => {
  return SOURCE_COLORS[sourceType] || SOURCE_COLORS['unknown']
}

const typeIcons: Record<string, typeof FiDatabase> = {
  evidence: FiDatabase,
  hypothesis: FiZap,
  project: FiFolder,
  entity: FiGlobe,
  notebook: FiFileText,
}

const FILTER_TYPES = [
  { value: '', label: 'All Types', icon: FiSearch },
  { value: 'evidence', label: 'Evidence', icon: FiDatabase },
  { value: 'hypothesis', label: 'Hypotheses', icon: FiZap },
  { value: 'project', label: 'Projects', icon: FiFolder },
  { value: 'entity', label: 'Entities', icon: FiGlobe },
]

const VALID_SEARCH_FILTERS = new Set(['', 'evidence', 'hypothesis', 'project', 'entity'])

export default function Search() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  // `?type=` deep-link: pre-select a Type filter (evidence / hypothesis /
  // project / entity). Invalid values silently fall back to "All Types".
  const qTypeRaw = (searchParams.get('type') || '').trim().toLowerCase()
  const initialFilter = VALID_SEARCH_FILTERS.has(qTypeRaw) ? qTypeRaw : ''
  const [query, setQuery] = useState(initialQuery)
  const [filterType, setFilterType] = useState(initialFilter)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [minRelevance, setMinRelevance] = useState(0)
  const [sortBy, setSortBy] = useState<SortBy>('relevance')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  const [totalResults, setTotalResults] = useState(0)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { const s = localStorage.getItem('humanovo-recent-searches'); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [savedSearches, setSavedSearches] = useState<string[]>(() => {
    try { const s = localStorage.getItem('humanovo-saved-searches'); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const didAutoSearch = useRef(false)

  // Persist searches to localStorage
  useEffect(() => {
    try { localStorage.setItem('humanovo-recent-searches', JSON.stringify(recentSearches)) } catch { /* quota */ }
  }, [recentSearches])
  useEffect(() => {
    try { localStorage.setItem('humanovo-saved-searches', JSON.stringify(savedSearches)) } catch { /* quota */ }
  }, [savedSearches])

  // Search local data as fallback when API is unavailable
  const searchLocalData = useCallback((q: string): SearchResult[] => {
    const localResults: SearchResult[] = []
    const lq = q.toLowerCase()

    // Search activity log for projects, hypotheses, simulations, etc.
    const activities = getActivityLog()
    const seen = new Set<string>()
    for (const a of activities) {
      if (seen.has(a.title)) continue
      if (a.title?.toLowerCase().includes(lq) || a.project?.toLowerCase().includes(lq)) {
        seen.add(a.title)
        localResults.push({
          id: a.id,
          type: a.type === 'hypothesis' ? 'hypothesis' : a.type === 'evidence' ? 'evidence' : a.type === 'notebook' ? 'notebook' : 'project',
          title: a.title,
          snippet: `${a.action} ${a.project ? `in ${a.project}` : ''} — ${a.type}`,
          source: a.type,
          source_type: a.type,
          relevance_score: 0.6,
          metadata: {},
          created_at: a.timestamp,
          tags: [],
        })
      }
    }

    // Search MC simulations
    const mcSims = persistGet<any[]>('mc-simulations', [])
    for (const s of mcSims) {
      if (s.name?.toLowerCase().includes(lq) || s.simulationType?.toLowerCase().includes(lq)) {
        localResults.push({
          id: s.id,
          type: 'project' as any,
          title: s.name || 'Untitled Simulation',
          snippet: `Monte Carlo · ${s.iterations?.toLocaleString() || 0} iterations · μ=${s.stats?.mean?.toFixed(2) || 0}`,
          source: 'simulation',
          source_type: 'simulation',
          relevance_score: 0.7,
          metadata: { simulationType: s.simulationType },
          created_at: s.createdAt,
          tags: [],
        })
      }
    }

    // Search notebook pages
    const notebooks = persistGet<any[]>('notebook-index', [])
    for (const n of notebooks) {
      if (n.title?.toLowerCase().includes(lq) || n.tags?.some((t: string) => t.toLowerCase().includes(lq))) {
        localResults.push({
          id: n.id,
          type: 'notebook',
          title: n.title || 'Untitled Page',
          snippet: n.tags?.join(', ') || 'Notebook page',
          source: 'notebook',
          source_type: 'notebook',
          relevance_score: 0.65,
          metadata: {},
          created_at: n.updatedAt || n.updated_at || n.createdAt,
          tags: n.tags || [],
        })
      }
    }

    // Search experiments
    const experiments = persistGet<any[]>('experiments', [])
    for (const e of experiments) {
      if (e.title?.toLowerCase().includes(lq) || e.hypothesis?.toLowerCase().includes(lq) || e.tags?.some((t: string) => t.toLowerCase().includes(lq))) {
        localResults.push({
          id: e.id,
          type: 'project' as any,
          title: e.title,
          snippet: e.hypothesis || `Experiment · ${e.status}`,
          source: 'experiment',
          source_type: 'experiment',
          relevance_score: 0.65,
          metadata: { status: e.status },
          created_at: e.createdAt,
          tags: e.tags || [],
        })
      }
    }

    // Search equation history
    const eqHistory = persistGet<any[]>('eq-history', [])
    for (const eq of eqHistory) {
      if (eq.expr?.toLowerCase().includes(lq)) {
        localResults.push({
          id: eq.id,
          type: 'project' as any,
          title: `f(x) = ${eq.expr}`,
          snippet: `Equation plot · x ∈ [${eq.xMin}, ${eq.xMax}]`,
          source: 'equation',
          source_type: 'equation',
          relevance_score: 0.5,
          metadata: {},
          created_at: eq.createdAt,
          tags: [],
        })
      }
    }

    return localResults
  }, [])

  const handleSearch = useCallback(async (searchQuery?: string) => {
    const q = searchQuery || query
    if (!q.trim()) return
    setIsSearching(true)

    // Save to recent (ephemeral, in-memory only)
    setRecentSearches(prev => [q, ...prev.filter(s => s !== q)].slice(0, 10))

    // Search via API
    let apiResults: SearchResult[] = []
    try {
      const res = await api.globalSearch(q, {
        types: filterType ? [filterType] : undefined,
        date_from: dateRange.from || undefined,
        date_to: dateRange.to || undefined,
        min_relevance: minRelevance > 0 ? minRelevance / 100 : undefined,
        limit: 30,
      })
      apiResults = res.results || []
    } catch (err) {
      console.warn('Search API unavailable, falling back to local search:', err)
    }

    // If API returned nothing, search local data
    if (apiResults.length === 0) {
      apiResults = searchLocalData(q)
    }

    // Apply type filter
    let filtered = filterType ? apiResults.filter(r => r.type === filterType) : apiResults

    // Apply relevance filter
    if (minRelevance > 0) {
      filtered = filtered.filter(r => (r.relevance_score || 0) >= minRelevance / 100)
    }

    // Sort
    if (sortBy === 'date') {
      filtered.sort((a, b) => {
        if (!a.created_at) return 1
        if (!b.created_at) return -1
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    } else if (sortBy === 'citations') {
      filtered.sort((a, b) => ((b.metadata?.citation_count as number) || 0) - ((a.metadata?.citation_count as number) || 0))
    } else {
      filtered.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
    }

    setResults(filtered)
    setTotalResults(filtered.length)
    setIsSearching(false)
  }, [query, filterType, dateRange, minRelevance, sortBy, searchLocalData])

  // Auto-search when opened with ?q= parameter
  useEffect(() => {
    if (initialQuery && !didAutoSearch.current) {
      didAutoSearch.current = true
      handleSearch(initialQuery)
    }
  }, [initialQuery, handleSearch])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const saveSearch = () => {
    if (!query.trim()) return
    setSavedSearches(prev => [query, ...prev.filter(s => s !== query)].slice(0, 20))
  }

  const removeSavedSearch = (s: string) => {
    setSavedSearches(prev => prev.filter(x => x !== s))
  }

  const removeRecentSearch = (s: string) => {
    setRecentSearches(prev => prev.filter(x => x !== s))
  }

  const clearRecentSearches = () => {
    setRecentSearches([])
  }

  const navigateToResult = (result: SearchResult) => {
    switch (result.type) {
      case 'project': navigate(`/projects/${result.id}`); break
      case 'evidence': navigate(`/evidence?id=${result.id}`); break
      case 'hypothesis': navigate(`/agents?hypothesis=${result.id}`); break
      default: break
    }
  }

  // Highlight matching text
  const highlightMatch = (text: string, q: string) => {
    if (!q.trim() || !text) return text
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-white/20 text-[var(--color-text)] rounded px-0.5">{part}</mark> : part
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search Header */}
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search evidence, hypotheses, genes, proteins, drugs..."
                className="w-full pl-12 pr-4 py-3.5 bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-xl focus:outline-none focus:border-[var(--color-border-strong)] text-sm transition-all"
                autoFocus
              />
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={isSearching}
              className="btn px-6 py-3.5 text-sm font-medium rounded-xl border border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
              style={{ color: 'var(--color-text)' }}
            >
              {isSearching ? <FiLoader className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
            <button
              onClick={saveSearch}
              className="btn p-3.5 rounded-xl border border-[var(--color-border)]"
              title="Save search"
            >
              <FiBookmark className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`btn p-3.5 rounded-xl border transition-all ${showFilters ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg-hover)]' : 'border-[var(--color-border)]'}`}
              title="Toggle Filters"
            >
              <FiSliders className="w-4 h-4" />
            </button>
          </div>

          {/* Smart Search indicator */}
          <div className="flex items-center gap-2 mt-3">
            <FiZap className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <span className="text-xs text-[var(--color-text-muted)]">Smart search — combines semantic + keyword matching across all platform data</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Filters Sidebar */}
        {showFilters && (
          <div className="w-64 border-r border-[var(--color-border)] p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-medium">Filters</h3>
              <button onClick={() => { setFilterType(''); setDateRange({ from: '', to: '' }); setMinRelevance(0) }} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Clear all
              </button>
            </div>

            {/* Type */}
            <div className="mb-6">
              <label className="text-xs text-[var(--color-text-muted)] mb-2 block">Type</label>
              <div className="space-y-0.5">
                {FILTER_TYPES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setFilterType(value)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${filterType === value ? 'bg-[var(--glass-bg-hover)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]'}`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div className="mb-6">
              <label className="text-xs text-[var(--color-text-muted)] mb-2 block flex items-center gap-1">
                <FiCalendar className="w-3 h-3" /> Date Range
              </label>
              <div className="space-y-2">
                <input type="date" value={dateRange.from} onChange={e => setDateRange(p => ({ ...p, from: e.target.value }))} className="input w-full text-xs" />
                <input type="date" value={dateRange.to} onChange={e => setDateRange(p => ({ ...p, to: e.target.value }))} className="input w-full text-xs" />
              </div>
            </div>

            {/* Relevance */}
            <div className="mb-6">
              <label className="text-xs text-[var(--color-text-muted)] mb-2 flex justify-between">
                <span>Min Relevance</span>
                <span>{minRelevance}%</span>
              </label>
              <input type="range" min="0" max="100" value={minRelevance} onChange={e => setMinRelevance(Number(e.target.value))} className="w-full" />
            </div>

            {/* Saved Searches */}
            {savedSearches.length > 0 && (
              <div className="mb-6">
                <label className="text-xs text-[var(--color-text-muted)] mb-2 block flex items-center gap-1">
                  <FiStar className="w-3 h-3" /> Saved Searches
                </label>
                <div className="space-y-0.5">
                  {savedSearches.map(s => (
                    <div key={s} className="flex items-center gap-1 group">
                      <button onClick={() => { setQuery(s); handleSearch(s) }} className="flex-1 text-left text-xs px-3 py-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] truncate">
                        {s}
                      </button>
                      <button onClick={() => removeSavedSearch(s)} className="p-1 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)]">
                        <FiX className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                    <FiClock className="w-3 h-3" /> Recent
                  </label>
                  <button onClick={clearRecentSearches} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors">
                    Clear
                  </button>
                </div>
                <div className="space-y-0.5">
                  {recentSearches.slice(0, 5).map(s => (
                    <div key={s} className="group flex items-center">
                      <button onClick={() => { setQuery(s); handleSearch(s) }} className="flex-1 text-left text-xs px-3 py-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] truncate">
                        {s}
                      </button>
                      <button onClick={() => removeRecentSearch(s)} className="p-1 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)]">
                        <FiX className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            {/* Results header */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-[var(--color-text-muted)]">
                {totalResults > 0 ? `${totalResults} results` : ''} {query && totalResults > 0 && `for "${query}"`}
              </span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortBy)}
                className="input text-xs py-1.5"
              >
                <option value="relevance">Sort by Relevance</option>
                <option value="date">Sort by Date</option>
                <option value="citations">Sort by Citations</option>
              </select>
            </div>

            {/* Source legend */}
            {results.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-4">
                {[...new Set(results.map(r => r.source_type || r.type))].map(source => {
                  const style = getSourceStyle(source)
                  return (
                    <div key={source} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full" style={{ background: style.color }} />
                      <span style={{ color: style.color }}>{style.label}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Results List */}
            <div className="space-y-2">
              {results.map(result => {
                const Icon = typeIcons[result.type] || FiFileText
                const sourceStyle = getSourceStyle(result.source_type || result.source || result.type)
                const typeStyle = getSourceStyle(result.type)

                return (
                  <button
                    key={result.id}
                    onClick={() => navigateToResult(result)}
                    className="w-full text-left glass-card p-4 transition-all hover:bg-[var(--glass-bg-hover)] group"
                  >
                    <div className="flex items-start gap-3">
                      {/* Type indicator with color */}
                      <div className="p-2 rounded-lg flex-shrink-0" style={{ background: typeStyle.bg }}>
                        <Icon className="w-4 h-4" style={{ color: typeStyle.color }} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-sm font-medium group-hover:text-[var(--color-text)] transition-colors">
                            {highlightMatch(result.title, query)}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {/* Source badge with color */}
                            <span className="text-xs px-2 py-0.5 rounded-md" style={{ color: sourceStyle.color, background: sourceStyle.bg }}>
                              {sourceStyle.label}
                            </span>
                            {/* Relevance */}
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {Math.round((result.relevance_score || 0) * 100)}%
                            </span>
                          </div>
                        </div>

                        {result.snippet && (
                          <p className="text-xs text-[var(--color-text-muted)] mt-1.5 line-clamp-2">
                            {highlightMatch(result.snippet, query)}
                          </p>
                        )}

                        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-muted)]">
                          {/* Source origin color line */}
                          <span className="w-1 h-4 rounded-full" style={{ background: sourceStyle.color }} />
                          <span style={{ color: sourceStyle.color }}>{result.source || result.source_type}</span>

                          {result.created_at && (
                            <span className="flex items-center gap-1">
                              <FiCalendar className="w-3 h-3" />
                              {formatDate(result.created_at)}
                            </span>
                          )}
                          {result.metadata?.citation_count !== undefined && (
                            <span>{String(result.metadata.citation_count)} citations</span>
                          )}
                          {result.metadata?.confidence !== undefined && (
                            <span>Confidence: {Math.round(Number(result.metadata.confidence) * 100)}%</span>
                          )}
                          {result.metadata?.entity_type && (
                            <span className="capitalize">{String(result.metadata.entity_type)}</span>
                          )}
                        </div>

                        {/* Tags */}
                        {result.tags && result.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {result.tags.slice(0, 4).map(tag => (
                              <span key={tag} className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                                {tag}
                              </span>
                            ))}
                            {result.tags.length > 4 && (
                              <span className="text-xxs px-1.5 py-0.5 text-[var(--color-text-muted)]">+{result.tags.length - 4}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Empty states */}
            {results.length === 0 && query && !isSearching && (
              <div className="text-center py-16">
                <FiSearch className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-30" />
                <p className="text-sm text-[var(--color-text-muted)]">No results found for "{query}"</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">Try adjusting your filters or search terms</p>
              </div>
            )}

            {isSearching && (
              <div className="text-center py-16">
                <FiLoader className="w-8 h-8 mx-auto mb-3 animate-spin text-[var(--color-text-muted)]" />
                <p className="text-sm text-[var(--color-text-muted)]">Searching across all sources...</p>
              </div>
            )}

            {!query && !isSearching && (
              <div className="text-center py-16">
                <FiSearch className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-30" />
                <p className="text-sm text-[var(--color-text-muted)]">Enter a search query to find evidence, hypotheses, and more</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">Search across evidence, knowledge graph entities, projects, and RAG-indexed documents</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
