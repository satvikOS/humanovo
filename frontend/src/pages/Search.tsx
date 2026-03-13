import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDate } from '../utils/persistence'
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
  evidence: { color: 'var(--color-accent-blue)', bg: 'rgba(59, 130, 246, 0.08)', label: 'Evidence' },
  hypothesis: { color: 'var(--color-accent-purple)', bg: 'rgba(168, 85, 247, 0.08)', label: 'Hypothesis' },
  project: { color: 'var(--color-accent-green)', bg: 'rgba(34, 197, 94, 0.08)', label: 'Project' },
  entity: { color: 'var(--color-accent-orange)', bg: 'rgba(249, 115, 22, 0.08)', label: 'Entity' },
  notebook: { color: 'var(--color-accent-cyan)', bg: 'rgba(6, 182, 212, 0.08)', label: 'Notebook' },
  gene: { color: 'var(--color-accent-orange)', bg: 'rgba(249, 115, 22, 0.08)', label: 'Gene' },
  protein: { color: 'var(--color-accent-pink)', bg: 'rgba(236, 72, 153, 0.08)', label: 'Protein' },
  drug: { color: 'var(--color-accent-cyan)', bg: 'rgba(6, 182, 212, 0.08)', label: 'Drug' },
  disease: { color: 'var(--color-accent-red)', bg: 'rgba(239, 68, 68, 0.08)', label: 'Disease' },
  pathway: { color: 'var(--color-accent-yellow)', bg: 'rgba(234, 179, 8, 0.08)', label: 'Pathway' },
  pubmed: { color: 'var(--color-accent-blue)', bg: 'rgba(59, 130, 246, 0.08)', label: 'PubMed' },
  clinical_trial: { color: 'var(--color-accent-green)', bg: 'rgba(34, 197, 94, 0.08)', label: 'Clinical Trial' },
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

export default function Search() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [filterType, setFilterType] = useState('')
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [minRelevance, setMinRelevance] = useState(0)
  const [sortBy, setSortBy] = useState<SortBy>('relevance')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  const [totalResults, setTotalResults] = useState(0)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('humanovo-recent-searches') || '[]')
    } catch { return [] }
  })
  const [savedSearches, setSavedSearches] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('humanovo-saved-searches') || '[]')
    } catch { return [] }
  })

  // Fuzzy text match: checks if all words in query appear in the target text
  const fuzzyMatch = useCallback((text: string, q: string): number => {
    if (!text || !q) return 0
    const lower = text.toLowerCase()
    const queryLower = q.toLowerCase()

    // Exact substring match = highest score
    if (lower.includes(queryLower)) return 1.0

    // Check each query word individually
    const words = queryLower.split(/\s+/).filter(w => w.length > 1)
    if (words.length === 0) return 0
    const matched = words.filter(w => lower.includes(w)).length
    return matched / words.length
  }, [])

  // Search localStorage for projects, hypotheses, papers, evidence
  // NOTE: All platform data uses 'humanovo-' prefix via persistGet/persistSet
  const searchLocalStorage = useCallback((q: string): SearchResult[] => {
    const localResults: SearchResult[] = []

    // Search projects (stored at 'humanovo-projects')
    try {
      const projects = JSON.parse(localStorage.getItem('humanovo-projects') || '[]')
      projects.forEach((p: any) => {
        const searchText = [p.name, p.description, p.disease_focus, p.research_question, ...(p.tags || [])].filter(Boolean).join(' ')
        const score = fuzzyMatch(searchText, q)
        if (score > 0.3) {
          localResults.push({
            id: p.id, type: 'project', title: p.name || 'Untitled Project',
            snippet: p.description || p.research_question || p.disease_focus || '',
            source: 'project', source_type: 'project', relevance_score: score,
            metadata: { disease_focus: p.disease_focus, hypothesis_count: p.hypothesis_count },
            created_at: p.created_at, tags: p.tags,
          })
        }
      })
    } catch { /* ignore */ }

    // Search hypotheses (stored at 'humanovo-hypotheses')
    try {
      const hypotheses = JSON.parse(localStorage.getItem('humanovo-hypotheses') || '[]')
      hypotheses.forEach((h: any) => {
        const searchText = [h.title, h.statement, h.description, h.mechanism, h.disease, ...(h.tags || [])].filter(Boolean).join(' ')
        const score = fuzzyMatch(searchText, q)
        if (score > 0.2) {
          localResults.push({
            id: h.id, type: 'hypothesis', title: h.title || h.statement || 'Untitled Hypothesis',
            snippet: h.mechanism || h.description || '',
            source: 'hypothesis', source_type: 'hypothesis', relevance_score: score,
            metadata: { confidence: h.confidence || h.confidence_score, disease: h.disease },
            created_at: h.created_at, tags: h.tags,
          })
        }
      })
    } catch { /* ignore */ }

    // Search research papers (stored at 'humanovo-research-papers')
    try {
      const papers = JSON.parse(localStorage.getItem('humanovo-research-papers') || '[]')
      papers.forEach((p: any) => {
        const searchText = [p.hypothesis_title, p.disease, p.filename].filter(Boolean).join(' ')
        const score = fuzzyMatch(searchText, q)
        if (score > 0.2) {
          localResults.push({
            id: p.id || p.hypothesis_id, type: 'evidence',
            title: `Research Paper: ${p.hypothesis_title || 'Untitled'}`,
            snippet: `Disease: ${p.disease || 'Unknown'} | Generated: ${p.generated_at ? formatDate(p.generated_at) : 'Unknown'}`,
            source: 'research_paper', source_type: 'evidence', relevance_score: score,
            metadata: { disease: p.disease },
            created_at: p.generated_at, tags: [],
          })
        }
      })
    } catch { /* ignore */ }

    // Search discovery history (stored at 'humanovo-discovery-history')
    try {
      const history = JSON.parse(localStorage.getItem('humanovo-discovery-history') || '[]')
      history.forEach((d: any) => {
        const searchText = [d.disease, d.discoveryType, ...(d.factors || [])].filter(Boolean).join(' ')
        const score = fuzzyMatch(searchText, q)
        if (score > 0.3) {
          localResults.push({
            id: d.id || `disc-${d.timestamp}`, type: 'project',
            title: `Discovery: ${d.disease || 'Unknown'}`,
            snippet: `Type: ${d.discoveryType || 'treatment'} | ${d.hypothesesCount || 0} hypotheses`,
            source: 'discovery', source_type: 'project', relevance_score: score,
            metadata: {}, created_at: d.timestamp, tags: [],
          })
        }
      })
    } catch { /* ignore */ }

    // Search simulations
    try {
      const sims = JSON.parse(localStorage.getItem('humanovo-mc-simulations') || '[]')
      sims.forEach((s: any) => {
        const searchText = [s.name, s.simulationType].filter(Boolean).join(' ')
        const score = fuzzyMatch(searchText, q)
        if (score > 0.3) {
          localResults.push({
            id: s.id, type: 'project', title: `Simulation: ${s.name || 'Untitled'}`,
            snippet: `Type: ${s.simulationType} | Mean: ${s.stats?.mean?.toFixed(2) || 'N/A'}`,
            source: 'simulation', source_type: 'project', relevance_score: score,
            metadata: {}, created_at: s.createdAt, tags: [],
          })
        }
      })
    } catch { /* ignore */ }

    return localResults.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
  }, [fuzzyMatch])

  const handleSearch = useCallback(async (searchQuery?: string) => {
    const q = searchQuery || query
    if (!q.trim()) return
    setIsSearching(true)

    // Save to recent
    const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 10)
    setRecentSearches(updated)
    localStorage.setItem('humanovo-recent-searches', JSON.stringify(updated))

    // Always search localStorage first for instant results
    const localResults = searchLocalStorage(q)

    // Try API search and merge results
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
    } catch {
      // API unavailable — localStorage results will be used
    }

    // Merge and deduplicate: API results + localStorage results
    const seenIds = new Set<string>()
    const merged: SearchResult[] = []
    for (const r of [...apiResults, ...localResults]) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id)
        merged.push(r)
      }
    }

    // Apply type filter
    let filtered = filterType ? merged.filter(r => r.type === filterType) : merged

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
  }, [query, filterType, dateRange, minRelevance, sortBy, recentSearches, searchLocalStorage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const saveSearch = () => {
    if (!query.trim()) return
    const updated = [query, ...savedSearches.filter(s => s !== query)].slice(0, 20)
    setSavedSearches(updated)
    localStorage.setItem('humanovo-saved-searches', JSON.stringify(updated))
  }

  const removeSavedSearch = (s: string) => {
    const updated = savedSearches.filter(x => x !== s)
    setSavedSearches(updated)
    localStorage.setItem('humanovo-saved-searches', JSON.stringify(updated))
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
      regex.test(part) ? <mark key={i} className="bg-[var(--color-accent-yellow)] bg-opacity-20 text-[var(--color-text)] rounded px-0.5">{part}</mark> : part
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
            <FiZap className="w-3.5 h-3.5 text-[var(--color-accent-purple)]" />
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
                <label className="text-xs text-[var(--color-text-muted)] mb-2 block flex items-center gap-1">
                  <FiClock className="w-3 h-3" /> Recent
                </label>
                <div className="space-y-0.5">
                  {recentSearches.slice(0, 5).map(s => (
                    <button key={s} onClick={() => { setQuery(s); handleSearch(s) }} className="w-full text-left text-xs px-3 py-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] truncate">
                      {s}
                    </button>
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
