import { useState } from 'react'
import {
  FiSearch,
  FiCalendar,
  FiDatabase,
  FiZap,
  FiFileText,
  FiFolder,
  FiExternalLink,
  FiBookmark,
  FiClock,
  FiSliders
} from 'react-icons/fi'
import clsx from 'clsx'

interface SearchResult {
  id: string
  type: 'evidence' | 'hypothesis' | 'project' | 'entity'
  title: string
  snippet: string
  source?: string
  date?: string
  relevance: number
  metadata?: Record<string, unknown>
}

type EntityType = 'all' | 'evidence' | 'hypothesis' | 'project' | 'gene' | 'protein' | 'drug'
type SearchMode = 'hybrid' | 'semantic' | 'keyword'

// Search results fetched from API (empty by default)

const entityTypes: { value: EntityType; label: string; icon: typeof FiDatabase }[] = [
  { value: 'all', label: 'All Types', icon: FiSearch },
  { value: 'evidence', label: 'Evidence', icon: FiDatabase },
  { value: 'hypothesis', label: 'Hypotheses', icon: FiZap },
  { value: 'project', label: 'Projects', icon: FiFolder },
  { value: 'gene', label: 'Genes', icon: FiFileText },
  { value: 'protein', label: 'Proteins', icon: FiFileText },
  { value: 'drug', label: 'Drugs', icon: FiFileText },
]

export default function Search() {
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('hybrid')
  const [entityType, setEntityType] = useState<EntityType>('all')
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [minRelevance, setMinRelevance] = useState(0)
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  const [savedSearches] = useState<string[]>([])

  const handleSearch = async () => {
    if (!query.trim()) return
    setIsSearching(true)
    // TODO: Integrate with actual search API
    await new Promise(resolve => setTimeout(resolve, 500))
    // Results will be populated from API
    setResults([])
    setIsSearching(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const clearFilters = () => {
    setEntityType('all')
    setDateRange({ from: '', to: '' })
    setMinRelevance(0)
  }

  const getTypeIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'evidence': return FiDatabase
      case 'hypothesis': return FiZap
      case 'project': return FiFolder
      default: return FiFileText
    }
  }

  const getTypeColor = (type: SearchResult['type']) => {
    switch (type) {
      case 'evidence': return 'text-primary-400 bg-primary-500/20'
      case 'hypothesis': return 'text-warning-400 bg-warning-500/20'
      case 'project': return 'text-success-400 bg-success-500/20'
      default: return 'text-[var(--color-text-muted)] bg-[var(--color-border)]'
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search Header */}
      <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search evidence, hypotheses, genes, proteins, drugs..."
                className="w-full pl-11 pr-4 py-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-primary-500 text-sm"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="btn bg-primary-500 text-white hover:bg-primary-600 px-6 py-3"
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={clsx(
                'p-3 rounded-lg border transition-colors',
                showFilters
                  ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
              )}
              title="Toggle Filters"
            >
              <FiSliders className="w-5 h-5" />
            </button>
          </div>

          {/* Search Mode Toggle */}
          <div className="flex items-center gap-4 mt-3">
            <span className="text-xs text-[var(--color-text-muted)]">Mode:</span>
            <div className="flex items-center gap-1 bg-[var(--color-bg)] rounded-lg p-1">
              {(['hybrid', 'semantic', 'keyword'] as SearchMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setSearchMode(mode)}
                  className={clsx(
                    'px-3 py-1 text-xs rounded transition-colors capitalize',
                    searchMode === mode
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <span className="text-xs text-[var(--color-text-muted)]">
              {searchMode === 'hybrid' && 'Combines semantic understanding with keyword matching'}
              {searchMode === 'semantic' && 'Uses AI to understand meaning and context'}
              {searchMode === 'keyword' && 'Traditional exact keyword matching'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Filters Sidebar */}
        {showFilters && (
          <div className="w-64 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Filters</h3>
              <button
                onClick={clearFilters}
                className="text-xs text-primary-400 hover:text-primary-300"
              >
                Clear all
              </button>
            </div>

            {/* Entity Type */}
            <div className="mb-6">
              <label className="text-xs text-[var(--color-text-muted)] mb-2 block">Type</label>
              <div className="space-y-1">
                {entityTypes.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setEntityType(value)}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors',
                      entityType === value
                        ? 'bg-primary-500/20 text-primary-400'
                        : 'hover:bg-[var(--color-border)] text-[var(--color-text-muted)]'
                    )}
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
                <FiCalendar className="w-3 h-3" />
                Date Range
              </label>
              <div className="space-y-2">
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs"
                  placeholder="From"
                />
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs"
                  placeholder="To"
                />
              </div>
            </div>

            {/* Relevance Threshold */}
            <div className="mb-6">
              <label className="text-xs text-[var(--color-text-muted)] mb-2 flex items-center justify-between">
                <span>Min Relevance</span>
                <span>{minRelevance}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={minRelevance}
                onChange={(e) => setMinRelevance(Number(e.target.value))}
                className="w-full"
              />
            </div>

            {/* Saved Searches */}
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-2 block flex items-center gap-1">
                <FiBookmark className="w-3 h-3" />
                Recent Searches
              </label>
              <div className="space-y-1">
                {savedSearches.map(search => (
                  <button
                    key={search}
                    onClick={() => setQuery(search)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs hover:bg-[var(--color-border)] text-left text-[var(--color-text-muted)]"
                  >
                    <FiClock className="w-3 h-3" />
                    {search}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto">
            {/* Results Header */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-[var(--color-text-muted)]">
                {results.length} results {query && `for "${query}"`}
              </span>
              <select className="text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1">
                <option>Sort by Relevance</option>
                <option>Sort by Date</option>
                <option>Sort by Citations</option>
              </select>
            </div>

            {/* Results List */}
            <div className="space-y-3">
              {results.map(result => {
                const TypeIcon = getTypeIcon(result.type)
                return (
                  <div
                    key={result.id}
                    className="card hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <div className={clsx('p-2 rounded', getTypeColor(result.type))}>
                        <TypeIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-medium hover:text-primary-400">
                            {result.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={clsx(
                              'text-xxs px-1.5 py-0.5 rounded capitalize',
                              getTypeColor(result.type)
                            )}>
                              {result.type}
                            </span>
                            <span className="text-xxs text-[var(--color-text-muted)]">
                              {Math.round(result.relevance * 100)}% match
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">
                          {result.snippet}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-muted)]">
                          {result.source && (
                            <span className="flex items-center gap-1">
                              <FiExternalLink className="w-3 h-3" />
                              {result.source}
                            </span>
                          )}
                          {result.date && (
                            <span className="flex items-center gap-1">
                              <FiCalendar className="w-3 h-3" />
                              {result.date}
                            </span>
                          )}
                          {result.metadata?.citations !== undefined && (
                            <span>{String(result.metadata.citations)} citations</span>
                          )}
                          {result.metadata?.confidence !== undefined && (
                            <span>
                              Confidence: {Math.round(Number(result.metadata.confidence) * 100)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {results.length === 0 && query && (
              <div className="text-center py-12">
                <FiSearch className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
                <p className="text-[var(--color-text-muted)]">
                  No results found for "{query}"
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                  Try adjusting your filters or search terms
                </p>
              </div>
            )}

            {!query && (
              <div className="text-center py-12">
                <FiSearch className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
                <p className="text-[var(--color-text-muted)]">
                  Enter a search query to find evidence, hypotheses, and more
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                  Use semantic search to find related concepts even without exact keywords
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
