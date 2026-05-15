import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { formatDateTime, persistGet, getActivityLog } from '../utils/persistence'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { apiClient } from '../services'
import {
  FiHome,
  FiFolder,
  FiZap,
  FiActivity,
  FiSettings,
  FiDatabase,
  FiSearch,
  FiBook,
  FiClock,
  FiBox,
  FiSun,
  FiMoon,
  FiPlus,
  FiX,
  FiBell,
  FiUser,
  FiChevronDown,
  FiCommand,
  FiArrowRight,
  FiGlobe,
  FiFileText,
  FiTrendingUp,
  FiList,
  FiClipboard,
  FiBarChart2,
  FiMessageCircle,
  FiSend,
  FiImage,
  FiShield,
  FiHeart,
  FiGrid,
  FiUpload,
  FiPaperclip,
  FiCpu,
  FiBookOpen,
  FiLayers,
  FiUsers,
  FiEdit3,
  FiAperture,
  FiTerminal,
  FiArchive,
  FiShare2,
  FiHelpCircle,
} from 'react-icons/fi'
import clsx from 'clsx'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/useAuth'
import { filterV1 } from '../utils/featureFlags'
import { useWorkspace, WorkspaceTab } from '../contexts/WorkspaceContext'
import HumanovoGlyph from './HumanovoGlyph'
import { Onboarding } from './Onboarding'
import { TrialBanner } from './TrialBanner'
import { VerifyEmailBanner } from './VerifyEmailBanner'

const mainNavItems = filterV1([
  { to: '/dashboard', icon: FiHome, label: 'Dashboard', shortcut: '1' },
  { to: '/projects', icon: FiFolder, label: 'Projects', shortcut: '2' },
  { to: '/evidence', icon: FiLayers, label: 'Evidence', shortcut: '3' },
  { to: '/agents', icon: FiZap, label: 'Discovery', shortcut: '4' },
  { to: '/workbench', icon: FiTerminal, label: 'Workbench', shortcut: '5' },
  { to: '/anatomy', icon: FiAperture, label: '3D Anatomy', shortcut: '6' },
])

// Default routes by activity type. When a notification has
// metadata.project_id (set for hypothesis and discovery events in
// Agents.tsx), we upgrade the destination to the specific project
// folder via notifDest() below.
const NOTIFICATION_ROUTES: Record<string, string> = {
  project: '/projects',
  hypothesis: '/agents',
  evidence: '/evidence',
  simulation: '/compute-lab?tab=montecarlo',
  notebook: '/notebook',
  discovery: '/agents',
  experiment: '/experiment-tracker',
  manuscript: '/manuscripts',
  citation: '/citation-manager',
  literature: '/literature-review',
  trial: '/clinical-trials',
  imaging: '/imaging',
  biobank: '/biobank',
  genomics: '/genomics',
  collaboration: '/collaboration',
  regulatory: '/regulatory',
  data: '/data-manager',
  visualization: '/data-visualization',
}

/** Resolve the best navigation destination for a notification entry.
 *  discovery and hypothesis notifications that carry a project_id in
 *  their metadata route directly to the project folder. */
function notifDest(n: { type?: string; metadata?: { project_id?: string } & Record<string, unknown> }): string | undefined {
  const pid = n.metadata?.project_id
  if (pid && (n.type === 'hypothesis' || n.type === 'discovery')) {
    return `/projects/${pid}`
  }
  return n.type ? NOTIFICATION_ROUTES[n.type] : undefined
}

const secondaryNavItems = [
  { to: '/notebook', icon: FiEdit3, label: 'Notebook' },
  { to: '/timeline', icon: FiClock, label: 'Timeline' },
  { to: '/search', icon: FiSearch, label: 'Search' },
]

const researchNavItems = filterV1([
  { to: '/literature-review', icon: FiBookOpen, label: 'Literature' },
  { to: '/citation-manager', icon: FiList, label: 'Citations' },
  { to: '/experiment-tracker', icon: FiTrendingUp, label: 'Experiments' },
  { to: '/data-visualization', icon: FiBarChart2, label: 'Visualization' },
])

const analysisNavItems = filterV1([
  { to: '/compute-lab', icon: FiCpu, label: 'Compute Lab' },
  { to: '/genomics', icon: FiGrid, label: 'Genomics' },
])

const managementNavItems = filterV1([
  { to: '/data-manager', icon: FiDatabase, label: 'Data Manager' },
  { to: '/imaging', icon: FiImage, label: 'Imaging' },
  { to: '/clinical-trials', icon: FiActivity, label: 'Clinical Trials' },
  { to: '/manuscripts', icon: FiFileText, label: 'Manuscripts' },
  { to: '/biobank', icon: FiArchive, label: 'Biobank' },
  { to: '/collaboration', icon: FiUsers, label: 'Collaboration' },
  { to: '/regulatory', icon: FiShield, label: 'Regulatory' },
])

// Knowledge section. The standalone Hypotheses entry was removed —
// hypotheses now live inside their parent project and surface from
// the Discovery chat or the project detail view. Old /hypotheses
// links redirect to /projects so external bookmarks don't 404.
const knowledgeNavItems = filterV1([
  { to: '/knowledge-graph', icon: FiLayers, label: 'Knowledge Graph' },
  { to: '/ml-models', icon: FiCpu, label: 'ML Models' },
])

/**
 * Sidebar section with a clickable header that toggles visibility of
 * its child links. Collapsed state persists per-section in localStorage
 * so the user's preferred layout survives page reloads. Any section
 * that contains the currently-active route auto-expands (so the user
 * can always see where they are, even if they had collapsed it).
 */
type NavSectionItem = { to: string; icon: React.ComponentType<{ className?: string }>; label: string }
function CollapsibleNavSection({ title, items }: { title: string; items: NavSectionItem[] }) {
  const storageKey = `sidebar-collapsed-${title.toLowerCase()}`
  const { pathname } = useLocation()
  const containsActive = items.some(
    (i) => pathname === i.to || pathname.startsWith(i.to + '/'),
  )
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (containsActive) return false
    try { return localStorage.getItem(storageKey) === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, collapsed ? '1' : '0') } catch { /* quota */ }
  }, [collapsed, storageKey])
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={clsx(
          'w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-xxs uppercase tracking-widest font-medium transition-colors',
          'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]',
          containsActive && 'text-[var(--color-text)]',
        )}
        aria-expanded={!collapsed}
        aria-controls={`nav-section-${title.toLowerCase()}`}
      >
        <span
          className={clsx(
            'text-[10px] w-3 text-center transition-transform duration-150 opacity-70',
            !collapsed && 'rotate-90',
          )}
          aria-hidden="true"
        >
          ▸
        </span>
        <span className="flex-1 text-left">{title}</span>
        {collapsed && items.length > 0 && (
          <span className="text-[10px] opacity-50 tabular-nums normal-case tracking-normal">{items.length}</span>
        )}
      </button>
      {!collapsed && (
        <div id={`nav-section-${title.toLowerCase()}`} className="space-y-0.5 mt-0.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-200',
                  isActive
                    ? 'bg-[var(--glass-bg-hover)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]'
                )
              }
            >
              <item.icon className="w-4 h-4" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function TabIcon({ type }: { type: WorkspaceTab['type'] }) {
  const icons: Record<WorkspaceTab['type'], typeof FiFolder> = {
    project: FiFolder,
    hypothesis: FiZap,
    simulation: FiActivity,
    workbench: FiBox,
    evidence: FiDatabase,
    notebook: FiBook,
    agents: FiTrendingUp,
  }
  const Icon = icons[type] || FiFolder
  return <Icon className="w-3 h-3" />
}

function WorkspaceTabs() {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab } = useWorkspace()
  const navigate = useNavigate()

  const handleAddTab = () => {
    addTab({ type: 'project', title: 'New Tab' })
    navigate('/projects')
  }

  if (tabs.length === 0) return null

  return (
    <div className="flex items-center h-9 px-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="flex items-center gap-0.5 overflow-x-auto hide-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all duration-200 min-w-0',
              activeTabId === tab.id
                ? 'bg-[var(--glass-bg-hover)] text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--glass-bg)]'
            )}
          >
            <TabIcon type={tab.type} />
            <span className="truncate max-w-24">{tab.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); removeTab(tab.id) }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--color-border-strong)] rounded transition-all"
            >
              <FiX className="w-2.5 h-2.5" />
            </button>
          </button>
        ))}
      </div>
      <button
        onClick={handleAddTab}
        className="ml-1 p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-lg transition-all hover:bg-[var(--glass-bg)]"
        title="New Tab" aria-label="New Tab"
      >
        <FiPlus className="w-3 h-3" />
      </button>
    </div>
  )
}

interface CommandAction {
  label: string
  icon: typeof FiFolder
  description?: string
  action: () => void
  category: string
  /** Optional keyboard shortcut to render on the right side — hint-only,
   *  the actual binding lives in Layout.handleKeyDown. */
  shortcut?: string[]
}

function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const actions: CommandAction[] = [
    { label: 'Go to Dashboard', icon: FiHome, category: 'Navigation', shortcut: ['g', 'd'], action: () => { navigate('/dashboard'); onClose() } },
    { label: 'Go to Projects', icon: FiFolder, category: 'Navigation', shortcut: ['g', 'p'], action: () => { navigate('/projects'); onClose() } },
    { label: 'Go to Evidence', icon: FiDatabase, category: 'Navigation', shortcut: ['g', 'e'], action: () => { navigate('/evidence'); onClose() } },
    { label: 'Go to Discovery', icon: FiActivity, category: 'Navigation', shortcut: ['g', 'a'], action: () => { navigate('/agents'); onClose() } },
    { label: 'Go to Compute Lab', icon: FiTrendingUp, category: 'Navigation', shortcut: ['g', 'c'], action: () => { navigate('/compute-lab'); onClose() } },
    { label: 'Go to Notebook', icon: FiBook, category: 'Navigation', shortcut: ['g', 'n'], action: () => { navigate('/notebook'); onClose() } },
    { label: 'Go to Search', icon: FiSearch, category: 'Navigation', shortcut: ['g', 's'], action: () => { navigate('/search'); onClose() } },
    { label: 'Go to Timeline', icon: FiClock, category: 'Navigation', shortcut: ['g', 't'], action: () => { navigate('/timeline'); onClose() } },
    { label: 'Go to Data Manager', icon: FiDatabase, category: 'Navigation', action: () => { navigate('/data-manager'); onClose() } },
    { label: 'Go to Visualization', icon: FiBarChart2, category: 'Navigation', action: () => { navigate('/data-visualization'); onClose() } },
    { label: 'Go to Imaging', icon: FiImage, category: 'Navigation', shortcut: ['g', 'i'], action: () => { navigate('/imaging'); onClose() } },
    { label: 'Go to Literature', icon: FiBookOpen, category: 'Navigation', action: () => { navigate('/literature-review'); onClose() } },
    { label: 'Go to Citations', icon: FiList, category: 'Navigation', action: () => { navigate('/citation-manager'); onClose() } },
    { label: 'Go to Experiments', icon: FiClipboard, category: 'Navigation', action: () => { navigate('/experiment-tracker'); onClose() } },
    { label: 'Go to Genomics', icon: FiHeart, category: 'Navigation', action: () => { navigate('/genomics'); onClose() } },
    { label: 'Go to Knowledge Graph', icon: FiShare2, category: 'Navigation', shortcut: ['g', 'k'], action: () => { navigate('/knowledge-graph'); onClose() } },
    // `g h` historically opened /hypotheses; now opens /projects
    // since that's where hypotheses live.
    { label: 'Go to Projects (hypotheses)', icon: FiFolder, category: 'Navigation', shortcut: ['g', 'h'], action: () => { navigate('/projects'); onClose() } },
    { label: 'Go to Workbench', icon: FiGrid, category: 'Navigation', shortcut: ['g', 'w'], action: () => { navigate('/workbench'); onClose() } },
    { label: 'New Project', icon: FiPlus, description: 'Create a new research project', category: 'Actions', action: () => { navigate('/projects?new=1'); onClose() } },
    { label: 'Start Discovery', icon: FiZap, description: 'Launch AI discovery pipeline', category: 'Actions', action: () => { navigate('/agents?start=1'); onClose() } },
    { label: 'Global Search', icon: FiGlobe, description: 'Search across all data', category: 'Actions', action: () => { navigate('/search'); onClose() } },
    { label: 'Open Settings', icon: FiSettings, category: 'Actions', action: () => { navigate('/settings'); onClose() } },
    { label: 'Settings · Usage & Billing', icon: FiSettings, category: 'Actions', description: 'Spend, cap, alerts', action: () => { navigate('/settings?tab=billing'); onClose() } },
    { label: 'Settings · KG & Contributions', icon: FiSettings, category: 'Actions', description: 'Royalty accrual, upload scope', action: () => { navigate('/settings?tab=kg-contributions'); onClose() } },
    { label: 'Show keyboard shortcuts', icon: FiHelpCircle, description: 'Full cheatsheet (press ?)', category: 'Actions', shortcut: ['?'], action: () => { onClose(); window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })) } },
  ]

  // Build data search results from local storage when user types a query
  const dataResults = useMemo<CommandAction[]>(() => {
    if (!query || query.length < 2) return []
    const lq = query.toLowerCase()
    const results: CommandAction[] = []

    // Search activity log
    const activities = getActivityLog()
    const seen = new Set<string>()
    for (const a of activities) {
      if (seen.has(a.title)) continue
      if (a.title?.toLowerCase().includes(lq) || a.project?.toLowerCase().includes(lq)) {
        seen.add(a.title)
        const typeIcon = a.type === 'hypothesis' ? FiZap : a.type === 'simulation' ? FiTrendingUp : a.type === 'evidence' ? FiDatabase : a.type === 'notebook' ? FiBook : FiFolder
        results.push({
          label: a.title,
          icon: typeIcon,
          description: `${a.type} · ${a.action}${a.project ? ` · ${a.project}` : ''}`,
          category: 'Results',
          action: () => {
            if (a.type === 'project') navigate(`/projects`)
            else if (a.type === 'hypothesis') navigate(`/agents`)
            else if (a.type === 'notebook') navigate(`/notebook`)
            else if (a.type === 'simulation') navigate(`/compute-lab`)
            else navigate(`/search?q=${encodeURIComponent(a.title)}`)
            onClose()
          },
        })
      }
      if (results.length >= 5) break
    }

    // Search MC simulations
    type MCSim = { name?: string; simulationType?: string }
    const mcSims = persistGet<MCSim[]>('mc-simulations', [])
    for (const s of mcSims) {
      if (results.length >= 8) break
      if (s.name?.toLowerCase().includes(lq) || s.simulationType?.toLowerCase().includes(lq)) {
        results.push({
          label: s.name || 'Untitled Simulation',
          icon: FiTrendingUp,
          description: `Monte Carlo · ${s.simulationType}`,
          category: 'Results',
          action: () => { navigate('/compute-lab'); onClose() },
        })
      }
    }

    // Search notebook pages
    type NotebookEntry = { id?: string; title?: string; tags?: string[] }
    const notebooks = persistGet<NotebookEntry[]>('notebook-index', [])
    for (const n of notebooks) {
      if (results.length >= 10) break
      if (n.title?.toLowerCase().includes(lq) || n.tags?.some((t: string) => t.toLowerCase().includes(lq))) {
        results.push({
          label: n.title || 'Untitled Page',
          icon: FiBook,
          description: `Notebook · ${n.tags?.join(', ') || ''}`,
          category: 'Results',
          action: () => { navigate(`/notebook?page=${n.id}`); onClose() },
        })
      }
    }

    // Search experiments
    type ExperimentEntry = { title?: string; hypothesis?: string; status?: string }
    const experiments = persistGet<ExperimentEntry[]>('experiments', [])
    for (const e of experiments) {
      if (results.length >= 12) break
      if (e.title?.toLowerCase().includes(lq) || e.hypothesis?.toLowerCase().includes(lq)) {
        results.push({
          label: e.title || 'Untitled experiment',
          icon: FiClipboard,
          description: `Experiment · ${e.status ?? 'unknown'}`,
          category: 'Results',
          action: () => { navigate('/experiments'); onClose() },
        })
      }
    }

    return results
  }, [query, navigate, onClose])

  const filtered = query
    ? actions.filter(a => a.label.toLowerCase().includes(query.toLowerCase()) || a.description?.toLowerCase().includes(query.toLowerCase()))
    : actions

  // Combine navigation + data results. Wrapped in useMemo so the
  // downstream flatItems useMemo's dep array stays stable across
  // renders that don't actually change inputs.
  const allItems = useMemo(() => [...filtered, ...dataResults], [filtered, dataResults])
  const categories = useMemo(() => [...new Set(allItems.map(a => a.category))], [allItems])

  // If query is long enough and no data results, offer to do a full search
  const showFullSearchOption = query.length >= 2

  // Flat list used for arrow-key navigation: full-search row first (if shown)
  // then every command in the order the categories render them.
  const triggerFullSearch = useCallback(() => {
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
    onClose()
  }, [navigate, query, onClose])

  const flatItems = useMemo(() => {
    const items: Array<{ run: () => void }> = []
    if (showFullSearchOption) items.push({ run: triggerFullSearch })
    for (const cat of categories) {
      for (const it of allItems.filter(a => a.category === cat)) {
        items.push({ run: it.action })
      }
    }
    return items
  }, [showFullSearchOption, triggerFullSearch, categories, allItems])

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [isOpen])

  // Reset selection when the result set changes so the highlight never
  // points past the end of the list.
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Keep the highlighted row in view while the user arrows through results.
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-cp-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flatItems.length) setActiveIndex(i => (i + 1) % flatItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flatItems.length) setActiveIndex(i => (i - 1 + flatItems.length) % flatItems.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[activeIndex]
      if (item) item.run()
      else if (query.trim().length >= 2) triggerFullSearch()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 modal-overlay" onClick={onClose} />
      <div className="relative w-full max-w-2xl mx-4 glass-card-static overflow-hidden animate-scale-in" style={{ background: 'var(--color-surface-solid)', boxShadow: 'var(--glass-shadow)' }}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--color-border)]">
          <FiSearch className="w-5 h-5 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            aria-label="Command palette search"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-[var(--color-text-muted)] focus:ring-1 focus:ring-[var(--color-border-strong)] rounded"
            autoFocus
          />
          <kbd className="px-1.5 py-0.5 text-xxs text-[var(--color-text-muted)] bg-[var(--glass-bg)] rounded border border-[var(--color-border)]">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3" ref={listRef}>
          {(() => {
            // Index-aware renderer: we walk flatItems once so the
            // highlighted row lines up with the arrow-key position.
            let cursor = 0
            const rows: React.ReactNode[] = []
            if (showFullSearchOption) {
              const myIdx = cursor++
              const active = activeIndex === myIdx
              rows.push(
                <button
                  key="full-search"
                  data-cp-idx={myIdx}
                  onClick={triggerFullSearch}
                  onMouseEnter={() => setActiveIndex(myIdx)}
                  className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-lg transition-all group mb-1 ${active ? 'bg-[var(--glass-bg-hover)]' : ''}`}
                >
                  <FiSearch className={`w-4 h-4 ${active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`} />
                  <div className="flex-1 text-left">
                    <span className={active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}>Search for "{query}"</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">Full search across all platform data</span>
                  </div>
                  <span className="text-xxs text-[var(--color-text-muted)]">Enter</span>
                </button>
              )
            }
            for (const cat of categories) {
              rows.push(
                <div key={`cat-${cat}`} className="text-xxs text-[var(--color-text-muted)] px-2 py-1.5 uppercase tracking-wider font-medium">{cat}</div>
              )
              for (const item of allItems.filter(a => a.category === cat)) {
                const myIdx = cursor++
                const active = activeIndex === myIdx
                rows.push(
                  <button
                    key={`${item.label}-${myIdx}`}
                    data-cp-idx={myIdx}
                    onClick={item.action}
                    onMouseEnter={() => setActiveIndex(myIdx)}
                    className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-lg transition-all group ${active ? 'bg-[var(--glass-bg-hover)]' : ''}`}
                  >
                    <item.icon className={`w-4 h-4 ${active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`} />
                    <div className="flex-1 text-left">
                      <span className={active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}>{item.label}</span>
                      {item.description && (
                        <span className="block text-xs text-[var(--color-text-muted)]">{item.description}</span>
                      )}
                    </div>
                    {item.shortcut && item.shortcut.length > 0 && (
                      <span className="flex items-center gap-1 mr-1" aria-hidden>
                        {item.shortcut.map((k, ki) => (
                          <kbd
                            key={ki}
                            className="px-1.5 py-0.5 text-xxs rounded border tabular-nums"
                            style={{
                              color: 'var(--color-text-muted)',
                              borderColor: 'var(--color-border)',
                              background: 'var(--glass-bg)',
                              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                            }}
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    )}
                    <FiArrowRight className={`w-3 h-3 text-[var(--color-text-muted)] transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
                  </button>
                )
              }
            }
            return rows
          })()}
          {allItems.length === 0 && !showFullSearchOption && (
            <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">No results found</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Constant AI Chat ─────────────────────────────────────────────

// Simple markdown renderer for Constant chat responses
function renderMarkdown(text: string): React.ReactNode {
  // Split into lines and process
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let inTable = false
  let tableRows: string[][] = []
  let tableHeaders: string[] = []

  const processInline = (line: string): React.ReactNode => {
    // Process bold, italic, and code inline
    const parts: React.ReactNode[] = []
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    let key = 0
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) parts.push(line.slice(lastIndex, match.index))
      if (match[2]) parts.push(<strong key={key++}>{match[2]}</strong>)
      else if (match[3]) parts.push(<em key={key++}>{match[3]}</em>)
      else if (match[4]) parts.push(<code key={key++} className="px-1 py-0.5 rounded text-xs" style={{ background: 'rgba(168,85,247,0.15)' }}>{match[4]}</code>)
      lastIndex = regex.lastIndex
    }
    if (lastIndex < line.length) parts.push(line.slice(lastIndex))
    return parts.length === 1 ? parts[0] : <>{parts}</>
  }

  const flushTable = () => {
    if (tableHeaders.length > 0) {
      elements.push(
        <div key={elements.length} className="overflow-x-auto my-2">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                {tableHeaders.map((h, i) => (
                  <th key={i} className="text-left px-2 py-1.5 border-b border-[var(--color-border)] font-semibold text-[var(--color-text)]">{processInline(h.trim())}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1.5 border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">{processInline(cell.trim())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    tableHeaders = []
    tableRows = []
    inTable = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Table detection
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.trim().slice(1, -1).split('|')
      // Check if next line is separator (|---|---|)
      if (!inTable && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
        inTable = true
        tableHeaders = cells
        i++ // skip separator line
        continue
      } else if (inTable) {
        tableRows.push(cells)
        continue
      }
    } else if (inTable) {
      flushTable()
    }

    // Bullet points
    if (/^[-•]\s/.test(line.trim())) {
      elements.push(<div key={elements.length} className="flex gap-1.5 ml-1"><span className="text-[var(--color-accent-purple)] mt-0.5">-</span><span>{processInline(line.trim().replace(/^[-•]\s/, ''))}</span></div>)
      continue
    }

    // Numbered lists
    if (/^\d+\.\s/.test(line.trim())) {
      const num = line.trim().match(/^(\d+)\.\s/)
      elements.push(<div key={elements.length} className="flex gap-1.5 ml-1"><span className="text-[var(--color-accent-purple)] font-medium mt-0.5">{num?.[1]}.</span><span>{processInline(line.trim().replace(/^\d+\.\s/, ''))}</span></div>)
      continue
    }

    // Empty lines
    if (line.trim() === '') {
      elements.push(<div key={elements.length} className="h-2" />)
      continue
    }

    // Regular text with inline formatting
    elements.push(<div key={elements.length}>{processInline(line)}</div>)
  }

  if (inTable) flushTable()

  return <div className="space-y-0.5">{elements}</div>
}

// Copy button for chat messages
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      title="Copy message" aria-label="Copy message"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <FiClipboard className="w-3.5 h-3.5" />
      )}
    </button>
  )
}

function ConstantChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    { role: 'assistant', text: 'Hey! I\'m Constant, your research companion on HumaNovo. I can help you navigate the platform, explain biology and statistics concepts, or dig into your research data. What would you like to do?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
  const MAX_FILES = 2

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, streamingText])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const newFiles: File[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        setMessages(prev => [...prev, { role: 'assistant', text: `**${file.name}** exceeds the 20 MB size limit. Please use a smaller file.` }])
        continue
      }
      if (attachedFiles.length + newFiles.length >= MAX_FILES) {
        setMessages(prev => [...prev, { role: 'assistant', text: `Maximum ${MAX_FILES} documents per message. Remove an attachment first.` }])
        break
      }
      newFiles.push(file)
    }
    if (newFiles.length > 0) setAttachedFiles(prev => [...prev, ...newFiles].slice(0, MAX_FILES))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const getLocalContext = () => {
    try {
      // All platform data uses 'humanovo-' prefix via persistGet/persistSet
      const projects = JSON.parse(localStorage.getItem('humanovo-projects') || '[]')
      const hypotheses = JSON.parse(localStorage.getItem('humanovo-hypotheses') || '[]')
      const papers = JSON.parse(localStorage.getItem('humanovo-research-papers') || '[]')
      // Local-context shapes — these come out of localStorage so we
      // tolerate every field being optional. Concrete shapes here let
      // the downstream chat/assistant code consume them without `any`.
      type LocalProject = { name?: string; title?: string; disease_focus?: string; disease?: string; hypothesis_count?: number; status?: string }
      type LocalHypothesis = { statement?: string; title?: string; mechanism?: string; confidence?: number; confidence_score?: number; disease?: string; tags?: string[] }
      type LocalPaper = { hypothesis_title?: string; disease?: string }
      type LocalDocument = { title?: string; doc_type?: string; authors?: string; description?: string; tags?: string[]; knowledge_base?: string; project_id?: string }

      const projectsTyped: LocalProject[] = Array.isArray(projects) ? projects : []
      const hypothesesTyped: LocalHypothesis[] = Array.isArray(hypotheses) ? hypotheses : []
      const papersTyped: LocalPaper[] = Array.isArray(papers) ? papers : []
      const simulations = JSON.parse(localStorage.getItem('humanovo-mc-simulations') || '[]')
      const docs = JSON.parse(localStorage.getItem('humanovo-project-documents') || '[]')
      const docsTyped: LocalDocument[] = Array.isArray(docs) ? docs : []
      return {
        totalProjects: projectsTyped.length,
        totalHypotheses: hypothesesTyped.length,
        totalPapers: papersTyped.length,
        totalSimulations: simulations.length,
        totalDocuments: docsTyped.length,
        projects: projectsTyped.map((p) => ({
          name: p.name || p.title,
          disease: p.disease_focus || p.disease,
          hypotheses: p.hypothesis_count,
          status: p.status,
        })).filter((p) => p.name),
        hypotheses: hypothesesTyped.map((h) => ({
          title: h.statement || h.title,
          mechanism: h.mechanism,
          confidence: h.confidence || h.confidence_score,
          disease: h.disease,
          tags: h.tags?.slice(0, 5),
        })).filter((h) => h.title),
        papers: papersTyped.map((p) => ({
          title: p.hypothesis_title,
          disease: p.disease,
        })).filter((p) => p.title),
        documents: docsTyped.map((d) => ({
          title: d.title,
          doc_type: d.doc_type,
          authors: d.authors,
          description: d.description,
          tags: d.tags,
          knowledge_base: d.knowledge_base || 'private',
          project_id: d.project_id,
        })).filter((d) => d.title),
      }
    } catch { /* parse error */ return {} }
  }

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      // Clear attachments when chat closes
      setAttachedFiles([])
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])

  // --- Scope guard: only allow medical/healthcare/biotech/human sciences topics ---
  const isOutOfScope = (query: string): boolean => {
    const q = query.toLowerCase().trim()
    // Allow conversational, navigation, platform, and data queries
    if (/^(hi|hey|hello|howdy|yo|sup|what'?s up|good (morning|afternoon|evening))[\s!.?]*$/i.test(q)) return false
    if (/^(i am|i'm|my name is|this is|call me)\s/i.test(q)) return false
    if (/^(thanks?|thank you|thx|ty|cheers|appreciate)[\s!.]*$/i.test(q)) return false
    if (/how are you|how('?re| are) (you|u) doing/i.test(q)) return false
    if (/what (can|do) you do|help me|tour|guide/i.test(q)) return false
    if (/where|how (do i|to|can i)|take me to|go to|open|navigate|show me|dashboard|project|notebook|workbench|setting|search|discover/i.test(q)) return false
    if (/hypothes|paper|simulat|how many|count|total|overview|summary|status/i.test(q)) return false
    // Allow medical/bio/health keywords
    if (/medic|health|bio|pharma|genom|gene|protein|cell|organ|disease|drug|clinic|pathol|immun|neuro|cardio|oncol|cancer|tumor|surg|anat|physiol|molecule|dna|rna|enzyme|receptor|antibod|vaccine|therap|diagnos|symptom|treat|patient|hospital|epidem|virus|bacter|infect|metabol|endocrin|hematol|pulmon|gastro|dermat|ophthal|orthoped|pediatr|geriatr|psych|nutrit|toxicol|radiol|anesthes|pathogen|prognos|biomarker|assay|pcr|crispr|apoptosis|kinase|signaling|pathway|t-test|anova|regression|survival|sample size|p-value|statistic|research|experiment|hypothes|lab|science|human|body|tissue|blood|brain|heart|lung|liver|kidney|muscle|bone|nerve|skin|stem cell|chromosome|mutation|variant|allele|phenotype|genotype|epigenet|transcript|translat|ribosom|mitochond|endoplasm|golgi|cytoplasm|nucleus|membrane|synapse|neurotransmit|dopamin|serotonin|glutamat|gaba|insulin|cortisol|estrogen|testosterone|thyroid|pituitar|adrenal|pancrea|spleen|lymph|marrow|platelet|hemoglobin|cholesterol|lipid|amino acid|peptide|carbohydrate|glucose|glycol|oxidat|reduct|ATP|mitosis|meiosis|fertil|embryo|fetus|pregnan|natal|obstet|gynecol|urol|nephrol|hepat|respiratory|ventilat|alveol|bronch|trachea|diaphragm|rett|brca|egfr|p53|tp53|mdm2|bax|vegf|mtor|pi3k|akt|ras|mapk|kras/i.test(q)) return false
    // Allow if query is short or generic enough to not be clearly off-topic
    if (q.split(/\s+/).length <= 4) return false
    // Check for clearly off-topic subjects
    if (/\b(cook|recipe|football|soccer|basketball|baseball|cricket|tennis|movie|film|actor|actress|music|song|lyric|celebrity|fashion|style|outfit|makeup|politics|election|vote|president|prime minister|parliament|congress|stock market|crypto|bitcoin|ethereum|nft|forex|trading|invest|real estate|mortgage|car|automobile|truck|motorcycle|airplane|flight|travel|hotel|resort|vacation|tourism|restaurant|food|cuisine|baking|weather|forecast|temperature|rain|snow|hurricane|earthquake|volcano|gaming|video game|playstation|xbox|nintendo|twitch|streamer|tiktok|instagram|snapchat|youtube|influencer|dating|relationship|wedding|divorce|astrology|horoscope|zodiac|religion|prayer|church|mosque|temple|bible|quran|homework|math|algebra|calculus|geometry|trigonometry|physics(?! ther)|chemistry(?! ther)|engineering(?! bio)|programming|javascript|python|react|angular|vue|java|c\+\+|rust|golang|html|css|database|sql|mongodb|docker|kubernetes|aws|cloud|machine learning(?! (drug|bio|medical|health|genom))|artificial intelligence(?! (drug|bio|medical|health))|robot|autonomous|self-driving|spacex|nasa|astronomy|planet|galaxy|star(?!t)|universe|cosmos|philosophy(?! of (medicine|science|bio))|literature|novel|poem|poetry|shakespeare|history(?! of (medicine|bio|health|science))|geography|economy|inflation|recession|gdp|unemployment|tax|insurance(?! health)|legal|lawyer|court|judge|jury|law(?! of thermodynamics)|crime|police|military|army|navy|war(?!farin)|weapon|gun|ammunition|explosive|hack|exploit|malware|virus(?!es| biology| infect))\b/i.test(q)) return true
    return false
  }

  const generateSmartFallbackResponse = (query: string): string => {
    const q = query.toLowerCase().trim()
    // The chat fallback only reads counts + recent items off the local
    // context — no need for stricter typing here. ReturnType captures
    // exactly what getLocalContext yields.
    const ctx = getLocalContext() as ReturnType<typeof getLocalContext>

    // Scope check: reject out-of-scope topics
    if (isOutOfScope(q)) {
      return `I appreciate the question, but I'm specifically designed to assist with **medicine, healthcare, biotechnology, and human sciences** topics.\n\nHere's what I can help with:\n\n| Category | Examples |\n|----------|----------|\n| **Biology** | Genes, proteins, pathways, cell biology, anatomy |\n| **Medicine** | Diseases, diagnostics, treatments, clinical trials |\n| **Statistics** | t-tests, ANOVA, regression, survival analysis |\n| **Genomics** | GSEA, pathway enrichment, variant annotation |\n| **Platform** | Navigation, your projects, hypotheses, papers |\n\nTry asking something in these areas!`
    }

    const totalProjects = ctx.totalProjects || 0
    const totalHypotheses = ctx.totalHypotheses || 0
    const totalPapers = ctx.totalPapers || 0
    const totalSimulations = ctx.totalSimulations || 0
    // Now that ctx is typed via ReturnType<typeof getLocalContext>,
    // .projects/.hypotheses/.papers are already proper arrays — no casts.
    const projects = ctx.projects || []
    const hypotheses = ctx.hypotheses || []
    const papers = ctx.papers || []

    // --- Conversational responses: greetings, introductions, casual chat ---
    if (/^(hi|hey|hello|howdy|yo|sup|what'?s up|good (morning|afternoon|evening))[\s!.?]*$/i.test(q) || q === 'hi' || q === 'hey') {
      const greetings = [
        'Hey! Great to see you.',
        'Hi there! How can I help today?',
        'Hello! What are you working on?',
        'Hey! Ready to dive into some research?',
      ]
      const greeting = greetings[Math.floor(Math.random() * greetings.length)]
      if (totalProjects > 0 || totalHypotheses > 0) {
        return `${greeting} You've got **${totalProjects}** project${totalProjects !== 1 ? 's' : ''} and **${totalHypotheses}** hypothes${totalHypotheses !== 1 ? 'es' : 'is'} going. What would you like to work on?`
      }
      return `${greeting} I'm Constant — I can help you navigate the platform, explain research concepts, or get you started with your first project. What's on your mind?`
    }

    // Handle personal introductions
    if (/^(i am|i'm|my name is|this is|call me)\s/i.test(q)) {
      const nameMatch = q.match(/(?:i am|i'm|my name is|this is|call me)\s+(.+)/i)
      const name = nameMatch ? nameMatch[1].replace(/[.!?]+$/, '').trim() : 'there'
      return `Nice to meet you, ${name}! I'm Constant, your research companion here on HumaNovo. I can help you with:\n\n- **Navigating the platform** — finding tools, projects, or features\n- **Research tutoring** — explaining biology, statistics, genomics concepts\n- **Your data** — searching your hypotheses, projects, and papers\n\nWhat are you interested in working on?`
    }

    // Handle "thank you" / politeness
    if (/^(thanks?|thank you|thx|ty|cheers|appreciate)[\s!.]*$/i.test(q)) {
      return 'You\'re welcome! Let me know if there\'s anything else I can help with.'
    }

    // Handle "how are you" type questions
    if (/how are you|how('?re| are) (you|u) doing|how('?s| is) it going/i.test(q)) {
      return 'I\'m doing great, thanks for asking! I\'m here whenever you need help with your research. What can I do for you?'
    }

    // Handle "what can you do" / help
    if (/what (can|do) you do|help me|how (can|do) (you|i) (use|start)|what('?s| is) this|tour|guide/i.test(q)) {
      return `Great question! Here's what I can help with:\n\n**Navigate the platform:**\n- **Dashboard** — see your research overview and recent activity\n- **Discovery** — run AI-powered hypothesis generation for any disease\n- **Projects** — organize hypotheses and generate research papers\n- **Workbench** — build biological knowledge graphs visually\n- **Notebook** — write and organize research notes with Markdown\n- **Simulations** — run Monte Carlo simulations on hypotheses\n- **Statistics** — run t-tests, ANOVA, regression, survival analysis\n- **Genomics** — pathway enrichment, GSEA, variant annotation\n\n**Learn and explore:**\n- Ask me to explain any biology, statistics, or research concept\n- Ask about your existing projects, hypotheses, or papers\n\nJust ask naturally — I'm here to help!`
    }

    // --- Navigation requests ---
    if (/where (can i|do i|is|are)|how (do i|to|can i) (find|get|go|navigate|access|open|use|start|create|make|run|see|view)/i.test(q) || /take me to|go to|open|navigate to|show me/i.test(q)) {
      const navMap: [RegExp, string, string][] = [
        [/dashboard/i, 'Dashboard', 'Head to the **Dashboard** from the sidebar — it shows your research overview, recent activity, and quick stats.'],
        [/project/i, 'Projects', 'Go to **Projects** in the sidebar. You can create new projects, organize hypotheses, and generate research papers from there.'],
        [/discover|hypothes/i, 'Discovery', 'Open **Discovery** in the sidebar. Enter a disease or research area, then click "Start" to generate AI-powered hypotheses.'],
        [/workbench|graph|knowledge/i, 'Workbench', 'Open the **Workbench** from the sidebar. Drag biological structures from the library onto the canvas and connect them to build knowledge graphs.'],
        [/notebook|note/i, 'Notebook', 'Go to **Notebook** in the sidebar under Tools. You can create pages using templates (research notes, experiment logs, protocols) and write in Markdown.'],
        [/simulat/i, 'Compute Lab', 'Head to **Compute Lab** in the sidebar under Analysis. It includes Monte Carlo simulations, equation plotter, and 70+ one-click presets.'],
        [/statistic|t-test|anova|regression/i, 'Compute Lab', 'Go to **Compute Lab** under Analysis in the sidebar. The Presets tab has descriptive stats, t-tests, ANOVA, regression, survival analysis, sample size calculation, and more.'],
        [/genom|pathway|gsea|variant/i, 'Genomics', 'Open **Genomics** under Analysis. You can run pathway enrichment, GSEA, variant annotation, and biomarker discovery.'],
        [/timeline|activity|history/i, 'Timeline', 'Check the **Timeline** in the sidebar under Tools to see your complete research activity history.'],
        [/search/i, 'Search', 'Use **Search** in the sidebar or press **Cmd+K** to search across all your projects, hypotheses, and papers.'],
        [/citation/i, 'Citations', 'Go to **Citations** under Research in the sidebar to manage your reference library.'],
        [/experiment|tracker/i, 'Experiments', 'Check **Experiments** under Research to track your experimental protocols and results.'],
        [/visual|chart|plot/i, 'Visualization', 'Open **Visualization** under Research to create custom charts and plots from your data.'],
        [/evidence/i, 'Evidence', 'Go to **Evidence** in the sidebar to browse and manage your research evidence base.'],
        [/anatomy|3d|body/i, '3D Anatomy', 'Open **3D Anatomy** in the sidebar for an interactive 3D human anatomy explorer.'],
        [/setting/i, 'Settings', 'Go to **Settings** at the bottom of the sidebar to customize your experience.'],
      ]
      for (const [pattern, , response] of navMap) {
        if (pattern.test(q)) return response
      }
      return 'I can help you find anything on the platform! Try asking about a specific section — like "How do I start a discovery?" or "Where are my projects?"'
    }

    // --- Search user data for relevant context ---
    const matchingHyps = hypotheses.filter((h) => {
      const searchable = [h.title, h.mechanism, h.disease, ...(h.tags || [])].filter(Boolean).join(' ').toLowerCase()
      return q.split(/\s+/).some((word: string) => word.length > 3 && searchable.includes(word))
    })

    const matchingProjects = projects.filter((p) => {
      const searchable = [p.name, p.disease].filter(Boolean).join(' ').toLowerCase()
      return q.split(/\s+/).some((word: string) => word.length > 3 && searchable.includes(word))
    })

    if (matchingHyps.length > 0) {
      const intro = matchingHyps.length === 1
        ? 'I found a relevant hypothesis in your data:'
        : `I found **${matchingHyps.length}** relevant hypotheses in your data:`
      const items = matchingHyps.slice(0, 3).map((h, i) => {
        let item = `${i + 1}. **${h.title}**`
        if (h.confidence) item += ` (${Math.round(h.confidence * 100)}% confidence)`
        if (h.disease) item += `\n   Disease: ${h.disease}`
        if (h.mechanism) item += `\n   Mechanism: ${h.mechanism.slice(0, 120)}${h.mechanism.length > 120 ? '...' : ''}`
        return item
      }).join('\n\n')
      const more = matchingHyps.length > 3 ? `\n\n...and ${matchingHyps.length - 3} more in your data.` : ''
      return `${intro}\n\n${items}${more}\n\nYou can explore these in the **Discovery** section or open the related project to generate research papers.`
    }

    if (matchingProjects.length > 0) {
      const items = matchingProjects.slice(0, 5).map((p, i) =>
        `${i + 1}. **${p.name}**${p.disease ? ` — ${p.disease}` : ''}${p.hypotheses ? ` (${p.hypotheses} hypotheses)` : ''}`
      ).join('\n')
      return `I found ${matchingProjects.length} related project${matchingProjects.length > 1 ? 's' : ''}:\n\n${items}\n\nOpen **Projects** in the sidebar to view details.`
    }

    // --- Context-aware queries about platform sections ---
    if (/hypothes[ie]s/i.test(q)) {
      if (totalHypotheses > 0) {
        const recent = hypotheses.slice(0, 3).map((h, i) =>
          `${i + 1}. **${h.title}**${h.confidence ? ` — ${Math.round(h.confidence * 100)}% confidence` : ''}`
        ).join('\n')
        return `You've generated **${totalHypotheses}** hypotheses so far. Here are a few:\n\n${recent}${totalHypotheses > 3 ? `\n\n...and ${totalHypotheses - 3} more.` : ''}\n\nHead to **Discovery** to explore them or generate new ones.`
      }
      return 'You don\'t have any hypotheses yet. Go to **Discovery** in the sidebar, enter a disease or research area, and click "Start" to begin generating hypotheses!'
    }

    if (/\bproject/i.test(q)) {
      if (totalProjects > 0) {
        const recent = projects.slice(0, 3).map((p, i) =>
          `${i + 1}. **${p.name}**${p.disease ? ` — ${p.disease}` : ''}`
        ).join('\n')
        return `You have **${totalProjects}** project${totalProjects > 1 ? 's' : ''}:\n\n${recent}${totalProjects > 3 ? `\n\n...and ${totalProjects - 3} more.` : ''}\n\nVisit **Projects** in the sidebar to manage them.`
      }
      return 'No projects yet! You can create one from the **Projects** page in the sidebar, or projects are automatically created when you run a discovery.'
    }

    if (/paper|publication|manuscript/i.test(q)) {
      if (totalPapers > 0) {
        const recent = papers.slice(0, 3).map((p, i) =>
          `${i + 1}. **${p.title}**${p.disease ? ` — ${p.disease}` : ''}`
        ).join('\n')
        return `You've generated **${totalPapers}** research paper${totalPapers > 1 ? 's' : ''}:\n\n${recent}\n\nYou can find them inside their respective projects.`
      }
      return 'No papers generated yet. To create one, open a project, select a hypothesis, and click "Generate Research Paper."'
    }

    if (/simulat/i.test(q)) {
      if (totalSimulations > 0) {
        return `You have **${totalSimulations}** simulation${totalSimulations > 1 ? 's' : ''}. Head to the **Compute Lab → Monte Carlo** tab in the sidebar to view results or run new ones.`
      }
      return 'No simulations yet. Go to **Compute Lab** in the sidebar and pick the Monte Carlo tab to run stochastic simulations on your hypotheses.'
    }

    if (/how many|count|total|number|overview|summary|status/i.test(q)) {
      return `Here's your research at a glance:\n\n- **${totalProjects}** project${totalProjects !== 1 ? 's' : ''}\n- **${totalHypotheses}** hypothes${totalHypotheses !== 1 ? 'es' : 'is'}\n- **${totalPapers}** research paper${totalPapers !== 1 ? 's' : ''}\n- **${totalSimulations}** simulation${totalSimulations !== 1 ? 's' : ''}\n\nAnything specific you'd like to dig into?`
    }

    // --- Educational / tutoring queries ---
    const topics: Record<string, string> = {
      'p53': '**TP53 (p53)** is often called the "guardian of the genome." When DNA gets damaged, p53 steps in to either pause the cell cycle (via p21) so the cell can repair itself, or trigger apoptosis (via BAX) if the damage is too severe. It\'s mutated in about half of all human cancers, which is why it\'s such a huge research target.\n\nMDM2 keeps p53 in check through a negative feedback loop — it tags p53 for destruction. Many cancer therapies aim to disrupt this MDM2-p53 interaction to reactivate p53.',
      'brca': '**BRCA1 and BRCA2** are essential for repairing double-strand DNA breaks through homologous recombination. When these genes are mutated (inherited mutations), cells can\'t properly fix their DNA, leading to genomic instability.\n\nThis dramatically increases cancer risk — particularly breast (60-80% lifetime risk) and ovarian (20-40%). The silver lining? BRCA-deficient tumors are vulnerable to **PARP inhibitors** like olaparib, which exploit synthetic lethality — blocking the backup repair pathway too.',
      'crispr': '**CRISPR-Cas9** is a powerful gene editing tool borrowed from bacterial immune defense. Here\'s how it works:\n\n1. A **guide RNA** is designed to match your target DNA sequence\n2. The **Cas9 protein** follows the guide to the exact spot in the genome\n3. Cas9 cuts both DNA strands at that location\n4. The cell repairs the break — either by **NHEJ** (creating knockouts) or **HDR** (making precise edits with a template)\n\nIt\'s revolutionizing gene therapy, disease modeling, and functional genomics.',
      'rett': '**Rett Syndrome** is a rare neurodevelopmental disorder caused primarily by mutations in the **MECP2** gene on the X chromosome. It predominantly affects girls (about 1 in 10,000-15,000 female births).\n\nChildren develop normally for 6-18 months, then begin losing motor and communication skills. Key features include repetitive hand movements, breathing irregularities, seizures, and intellectual disability.\n\nMECP2 encodes a protein that regulates gene expression by reading DNA methylation marks — without it, thousands of genes become dysregulated in the brain. Current research focuses on gene replacement therapy (AAV-MECP2), reactivating the silent X chromosome copy, and targeted downstream interventions.',
      't-test': '**T-tests** are your go-to for comparing means between two groups. There are two main types:\n\n- **Independent t-test** — comparing two separate groups (e.g., treated vs. control)\n- **Paired t-test** — comparing before/after measurements on the same subjects\n\nKey assumptions: data should be roughly normally distributed, and variances should be similar (or use Welch\'s t-test if they\'re not). If p < 0.05, the difference is statistically significant — but always report **effect size** (Cohen\'s d) too, since p-values alone don\'t tell you how *big* the difference is.\n\nYou can run t-tests right here on the platform — go to **Statistics** in the sidebar!',
      'anova': '**ANOVA** extends the t-test idea to 3+ groups. Instead of asking "are these two groups different?" it asks "is at least one of these groups different from the rest?"\n\n- **One-way ANOVA** — one grouping factor (e.g., 3 drug doses)\n- **Two-way ANOVA** — two factors (e.g., drug dose × gender)\n\nIf the overall ANOVA is significant, you need **post-hoc tests** (Tukey or Bonferroni) to figure out *which* groups differ.\n\nYou can run ANOVA directly in the **Statistics** section!',
      'regression': '**Regression** models how one variable predicts another:\n\n- **Linear regression**: Y = β₀ + β₁X + error — predicts a continuous outcome\n- **Logistic regression**: predicts binary outcomes (yes/no, disease/healthy)\n- **Multiple regression**: multiple predictors simultaneously\n\nKey metrics to look at: **R²** (how much variance is explained), **p-values** (which predictors are significant), and **residual plots** (checking model assumptions).\n\nThe **Statistics** section has regression tools built in!',
      'pathway': '**Pathway enrichment analysis** helps you understand the "bigger picture" of your gene list. Rather than looking at individual genes, it identifies which biological pathways have more of your genes than expected by chance.\n\nPopular databases: **KEGG** and **Reactome**. The analysis uses a hypergeometric test to find significantly enriched pathways.\n\nYou can run this directly in the **Genomics** section under Analysis!',
      'gsea': '**GSEA** (Gene Set Enrichment Analysis) is different from standard pathway analysis because it uses your **entire ranked gene list**, not just the significant ones. This is powerful because it can detect subtle but coordinated changes that individual gene cutoffs might miss.\n\nThe output includes an enrichment score, normalized enrichment score (NES), and leading-edge genes that drive the enrichment signal.\n\nTry it out in the **Genomics** section!',
      'survival': '**Survival analysis** studies time until an event occurs (death, relapse, response). The **Kaplan-Meier curve** visualizes the probability of "surviving" past each time point.\n\nKey tools:\n- **Log-rank test** — compares survival between groups\n- **Cox regression** — identifies factors that influence survival (hazard ratios)\n- **Censoring** — properly handles patients lost to follow-up\n\nRun survival analysis in the **Statistics** section!',
      'hypothesis': 'A good scientific hypothesis follows this structure: "If [independent variable] is [changed], then [dependent variable] will [change] because [mechanism]."\n\nKey principles:\n1. It must be **testable** — you can design an experiment to test it\n2. It must be **falsifiable** — there must be possible outcomes that would disprove it\n3. It should be **mechanistic** — explaining *why*, not just *what*\n\nOr let the platform do it for you! Go to **Discovery** and enter a disease — the AI will generate novel, mechanistic hypotheses automatically.',
      'biomarker': '**Biomarkers** are measurable indicators of biological states. There are several types:\n\n- **Diagnostic** — detect disease presence\n- **Prognostic** — predict disease outcome\n- **Predictive** — predict treatment response\n- **Pharmacodynamic** — measure drug effects\n\nDiscovery typically involves comparing molecular profiles between groups and validating candidates in independent cohorts. You can explore biomarker discovery in the **Genomics** section!',
      'apoptosis': '**Apoptosis** is programmed cell death — the body\'s clean way of removing damaged or unnecessary cells. Two main pathways:\n\n**Intrinsic (mitochondrial):** Cellular stress → BAX/BAK form pores → cytochrome c released → caspase-9 → caspase-3\n\n**Extrinsic (death receptor):** FAS/TRAIL ligand binds receptor → FADD recruited → caspase-8 → caspase-3\n\nBoth pathways converge on executioner caspases (3, 6, 7) that systematically dismantle the cell. Cancer cells often find ways to evade apoptosis — restoring it is a major therapeutic strategy.',
      'kinase': '**Kinases** are enzymes that add phosphate groups to proteins, acting as molecular switches. They\'re central to cell signaling:\n\n- **Receptor tyrosine kinases** (EGFR, HER2) — receive signals at the cell surface\n- **Serine/threonine kinases** (RAF, AKT) — relay signals internally\n- **MAP kinases** (ERK, JNK, p38) — control growth, stress response\n\nKinase inhibitors are blockbuster cancer drugs — imatinib (BCR-ABL), erlotinib (EGFR), and many more. You can model these pathways in the **Workbench**!',
      'sample size': '**Sample size calculation** ensures your study has enough power to detect a real effect. Key inputs:\n\n- **Effect size** — how big a difference you expect\n- **Alpha** (α) — significance threshold, usually 0.05\n- **Power** (1-β) — probability of detecting a real effect, usually 0.80\n- **Variability** — standard deviation of your measurements\n\nUnderpowered studies waste resources and risk missing real effects. The **Statistics** section has a sample size calculator built in!',
    }

    for (const [key, explanation] of Object.entries(topics)) {
      if (q.includes(key)) {
        return explanation + '\n\nWant me to go deeper on any aspect of this, or connect it to something in your research?'
      }
    }

    // Check for general educational intent even without matching a specific topic
    if (/what is|explain|teach|how does|define|tell me about|what are|why do|how do|what('?s| is) the|describe/i.test(q)) {
      return `That's a great question! I have built-in explanations for many topics — try asking about specific concepts like:\n\n- **Biology:** p53, BRCA, CRISPR, apoptosis, kinases, biomarkers, Rett syndrome\n- **Statistics:** t-tests, ANOVA, regression, survival analysis, sample size\n- **Genomics:** pathway analysis, GSEA, variant annotation\n- **Methods:** hypothesis design, experimental controls\n\nWhen the backend AI is connected, I can explain virtually anything in detail. For now, try one of the topics above!`
    }

    // --- Default: friendly, conversational response ---
    if (totalProjects === 0 && totalHypotheses === 0) {
      return 'Looks like you\'re just getting started — exciting! Here\'s how to begin:\n\n1. **Create a project** in the Projects section to organize your research\n2. **Run a discovery** — enter a disease in Discovery and let the AI generate hypotheses\n3. **Explore your results** — review hypotheses, generate papers, run simulations\n\nOr ask me anything — I\'m here to help you learn and navigate the platform!'
    }

    const responses = [
      `I'm not sure I caught that, but I'd love to help! You can ask me to explain research concepts, search your data, or navigate the platform. For example, try "Explain CRISPR" or "Show me my projects."`,
      `Hmm, could you rephrase that? I can help with:\n- Explaining biology, stats, or research methods\n- Finding things in your data (${totalHypotheses} hypotheses, ${totalProjects} projects)\n- Navigating any section of the platform`,
      `I want to make sure I help you properly — could you be a bit more specific? I'm great at explaining concepts, searching your research data, and pointing you to the right tools on the platform.`,
    ]
    return responses[Math.floor(Math.random() * responses.length)]
  }

  const sendMessage = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || loading) return
    const userMsg = input.trim()
    const filesToSend = [...attachedFiles]
    setInput('')
    setAttachedFiles([])
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto'

    const displayText = filesToSend.length > 0
      ? `${userMsg}${userMsg ? '\n' : ''}${filesToSend.map(f => `📎 ${f.name}`).join('\n')}`
      : userMsg
    setMessages(prev => [...prev, { role: 'user', text: displayText }])
    setLoading(true)

    // Upload attached files first (if any)
    for (const file of filesToSend) {
      try {
        const { api } = await import('../services/api')
        await api.uploadDocument(file)
      } catch {
        // Silently continue — file upload to backend is best-effort
      }
    }

    // Scope guard: check before hitting backend
    let fullResponse = ''
    const hasOnlyFiles = !userMsg && filesToSend.length > 0
    if (hasOnlyFiles) {
      fullResponse = `Got it! I've received ${filesToSend.length === 1 ? `**${filesToSend[0].name}**` : `${filesToSend.length} documents`}. They'll be processed for the knowledge base. What would you like to do with ${filesToSend.length === 1 ? 'it' : 'them'}?`
    } else if (isOutOfScope(userMsg.toLowerCase().trim())) {
      fullResponse = generateSmartFallbackResponse(userMsg)
    } else {
      // Call the backend AI endpoint (powered by Constant AI).
      // Non-streaming — server returns the full message, then we
      // simulate character-by-character client-side below.
      try {
        const platformContext = getLocalContext()
        const { data } = await apiClient.post('/orchestrator/chat', {
          message: userMsg,
          context: 'general',
          platform_context: platformContext,
          knowledge_base: { include_documents: true, retrieval_mode: 'hybrid' },
          attached_files: filesToSend.map(f => ({ name: f.name, size: f.size, type: f.type })),
        })
        fullResponse = data.response || 'I\'m not sure about that. Could you rephrase?'
      } catch { /* API unavailable — use local fallback */
        fullResponse = generateSmartFallbackResponse(userMsg)
      }
    }
    // Stream the response character-by-character for a real-time feel
    setLoading(false)
    setIsStreaming(true)
    setStreamingText('')
    const chunkSize = 3
    for (let i = 0; i < fullResponse.length; i += chunkSize) {
      await new Promise(r => setTimeout(r, 12))
      setStreamingText(fullResponse.slice(0, i + chunkSize))
    }
    setStreamingText('')
    setIsStreaming(false)
    setMessages(prev => [...prev, { role: 'assistant', text: fullResponse }])
  }

  const modal = isOpen ? createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] animate-fade-in">
      <div className="absolute inset-0 modal-overlay bg-black/50 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      <div className="relative w-full max-w-2xl h-[70vh] mx-4 flex flex-col rounded-2xl border border-[var(--color-border)] overflow-hidden animate-scale-in" style={{ background: 'var(--color-surface-solid)', boxShadow: 'var(--glass-shadow)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(168, 85, 247, 0.1)' }}>
              <FiMessageCircle className="w-4 h-4" style={{ color: 'var(--color-accent-purple)' }} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Constant</h2>
              <p className="text-xxs text-[var(--color-text-muted)]">AI Research Tutor & Assistant</p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all">
            <FiX className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed relative ${
                  msg.role === 'assistant'
                    ? 'bg-[var(--glass-bg)] text-[var(--color-text-secondary)] rounded-tl-md'
                    : 'rounded-tr-md text-[var(--color-text)]'
                }`}
                style={msg.role === 'user' ? { background: 'rgba(168, 85, 247, 0.1)' } : {}}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[var(--color-accent-purple)] font-medium text-xs">Constant</span>
                    <CopyButton text={msg.text} />
                  </div>
                )}
                {msg.role === 'assistant' ? renderMarkdown(msg.text) : msg.text}
                {msg.role === 'user' && (
                  <div className="absolute -left-8 top-1/2 -translate-y-1/2">
                    <CopyButton text={msg.text} />
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tl-md bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-sm">
                <span className="text-[var(--color-accent-purple)] font-medium text-xs block mb-1">Constant</span>
                <span className="animate-pulse">Thinking...</span>
              </div>
            </div>
          )}
          {isStreaming && streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tl-md bg-[var(--glass-bg)] text-[var(--color-text-secondary)] text-sm leading-relaxed">
                <span className="text-[var(--color-accent-purple)] font-medium text-xs block mb-1">Constant</span>
                {renderMarkdown(streamingText)}<span className="inline-block w-0.5 h-4 bg-[var(--color-accent-purple)] ml-0.5 animate-pulse align-text-bottom" />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-3 border-t border-[var(--color-border)]">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.csv,.tsv,.md,.markdown,.mdx,.json,.jsonl,.ndjson,.xml,.html,.htm,.rtf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.log,.bib"
            onChange={handleFileSelect}
            className="hidden"
          />
          {/* Attachment chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-white/5 border border-[var(--color-border)] rounded-lg px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
                  <FiPaperclip className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[140px]">{f.name}</span>
                  <span className="text-[var(--color-text-muted)]">({(f.size / 1024 / 1024).toFixed(1)}MB)</span>
                  <button onClick={() => removeAttachment(i)} className="p-0.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <FiX className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={attachedFiles.length >= MAX_FILES}
              className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 transition-all disabled:opacity-30 shrink-0 mb-0.5"
              title={attachedFiles.length >= MAX_FILES ? `Max ${MAX_FILES} files` : 'Attach document'}
            >
              <FiUpload className="w-4 h-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                // Auto-resize
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Ask Constant anything — research, biology, stats..."
              aria-label="Chat input"
              rows={1}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)] resize-none leading-relaxed py-2 focus:ring-1 focus:ring-[var(--color-border-strong)] rounded"
              style={{ maxHeight: '120px' }}
            />
            <button aria-label="Send"
              onClick={sendMessage}
              disabled={(!input.trim() && attachedFiles.length === 0) || loading || isStreaming}
              className="p-2 rounded-lg text-white disabled:opacity-30 transition-all shrink-0 mb-0.5"
              style={{ background: 'var(--color-accent-purple)' }}
            >
              <FiSend className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xxs text-[var(--color-text-muted)] mt-1.5 text-center">Enter to send · Shift+Enter for new line · Escape to close</p>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className="mb-1">
      {/* Sidebar trigger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm transition-all duration-200 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]"
      >
        <FiMessageCircle className="w-4 h-4" style={{ color: 'var(--color-accent-purple)' }} />
        <span className="font-medium">Constant</span>
      </button>
      {modal}
    </div>
  )
}

export default function Layout() {
  const { theme, toggleTheme } = useTheme()
  // Auth state — used to gate the first-run Onboarding wizard at the
  // bottom of this component. The wizard renders once per user when
  // the backend reports has_completed_onboarding === false.
  const { user, loading: authLoading } = useAuth()
  const [isCommandOpen, setIsCommandOpen] = useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; description: string; time: string; timestamp: string; type?: string; metadata?: Record<string, unknown> }>>([])
  const [hasUnread, setHasUnread] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  // Load notifications from localStorage activity log
  useEffect(() => {
    const loadNotifications = () => {
      try {
        const activities = getActivityLog()
        const lastRead = localStorage.getItem('humanovo-notifs-read') || '0'
        const recent = activities.slice(0, 20)
        setNotifications(recent.map((a) => ({
          id: a.id,
          title: a.title || `${(a.type || 'activity').replace(/_/g, ' ')} ${(a.action || '').replace(/_/g, ' ')}`,
          description: a.project || '',
          time: formatDateTime(a.timestamp),
          timestamp: a.timestamp || '',
          type: a.type,
          // Preserve metadata so notifDest() can route hypothesis/discovery
          // notifications to the dedicated project folder.
          metadata: a.metadata,
        })))
        const newestTime = recent[0]?.timestamp || ''
        setHasUnread(newestTime > lastRead)
      } catch {
        // Activity log may not be available
      }
    }
    loadNotifications()
  }, [location.pathname])

  const markAllRead = () => {
    setHasUnread(false)
    setNotifications([])
    localStorage.setItem('humanovo-notifs-read', new Date().toISOString())
  }

  // `g` prefix state for vim-style navigation: press `g` then one of
  // the letters below within 1.5 s to jump to that page. A stale prefix
  // is cleared after the timeout so a stray `g` keypress doesn't stick.
  const gPrefixRef = useRef<{ active: boolean; timer: number | null }>({ active: false, timer: null })
  const clearGPrefix = useCallback(() => {
    const s = gPrefixRef.current
    if (s.timer != null) window.clearTimeout(s.timer)
    s.active = false
    s.timer = null
  }, [])

  // Keyboard shortcut for command palette + number shortcuts + g-prefix
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setIsCommandOpen(prev => !prev)
    }
    if (e.key === 'Escape') {
      setIsCommandOpen(false)
      setIsShortcutsOpen(false)
      setIsUserMenuOpen(false)
      setIsNotificationsOpen(false)
      clearGPrefix()
    }
    // "?" (Shift+/) opens the keyboard-shortcuts cheatsheet, but only
    // when the user isn't typing into a field. Accept both e.key === '?'
    // (produced on US keyboards) and the literal '/' + shiftKey combo
    // that some test-runners / layouts send.
    const tag = (e.target as HTMLElement)?.tagName
    const typingIn = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      (e.target as HTMLElement)?.isContentEditable
    const wantsShortcutHelp = !typingIn && !e.metaKey && !e.ctrlKey && !e.altKey &&
      (e.key === '?' || (e.key === '/' && e.shiftKey))
    if (wantsShortcutHelp) {
      e.preventDefault()
      setIsShortcutsOpen(prev => !prev)
    }
    // g-prefix navigation: `g d` → Dashboard, `g p` → Projects, etc.
    // Takes precedence over the number-navigation below while a prefix
    // is active.
    if (!typingIn && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const prefixMap: Record<string, string> = {
        d: '/dashboard',
        p: '/projects',
        e: '/evidence',
        // `g h` now opens /projects since hypotheses live inside projects.
        h: '/projects',
        c: '/compute-lab',
        n: '/notebook',
        a: '/agents',
        t: '/timeline',
        s: '/search',
        k: '/knowledge-graph',
        w: '/workbench',
        i: '/imaging',
        g: '/collaboration', // "g g" → collaboration (second g)
      }
      if (gPrefixRef.current.active) {
        const dest = prefixMap[e.key.toLowerCase()]
        if (dest) {
          e.preventDefault()
          navigate(dest)
        }
        clearGPrefix()
        return
      }
      if (e.key === 'g' && !e.shiftKey) {
        gPrefixRef.current.active = true
        gPrefixRef.current.timer = window.setTimeout(clearGPrefix, 1500)
        return
      }
    }
    // Number shortcuts 1-6 for main nav (only when no input focused)
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !typingIn) {
      const idx = parseInt(e.key) - 1
      if (idx >= 0 && idx < mainNavItems.length) {
        navigate(mainNavItems[idx].to)
      }
    }
  }, [navigate, clearGPrefix])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Get current page title
  const getPageTitle = () => {
    const path = location.pathname
    if (path === '/dashboard' || path === '/') return 'Dashboard'
    if (path === '/projects') return 'Projects'
    if (path.startsWith('/projects/')) return 'Project'
    if (path === '/evidence') return 'Evidence'
    if (path === '/agents') return 'Discovery'
    if (path === '/agents-chat-mode') return 'Discovery (Chat Mode)'
    // /hypotheses itself redirects to /projects so the title label
    // for it would only ever show mid-redirect. The per-id detail
    // route still has a page.
    if (path.startsWith('/hypotheses/')) return 'Hypothesis Detail'
    if (path === '/compute-lab') return 'Compute Lab'
    if (path === '/simulations' || path === '/statistical-analysis' || path === '/numeric-compute' || path === '/matlab-compute') return 'Compute Lab'
    if (path === '/workbench') return 'Workbench'
    if (path === '/anatomy') return '3D Anatomy'
    if (path === '/notebook') return 'Notebook'
    if (path === '/timeline') return 'Timeline'
    if (path === '/search') return 'Search'
    if (path === '/settings') return 'Settings'
    if (path === '/literature-review') return 'Literature Review'
    if (path === '/citation-manager') return 'Citation Manager'
    if (path === '/experiment-tracker') return 'Experiment Tracker'
    if (path === '/data-visualization') return 'Data Visualization'
    if (path === '/data-manager') return 'Data Manager'
    if (path === '/collaboration') return 'Collaboration'
if (path === '/clinical-trials') return 'Clinical Trials'
    if (path === '/genomics') return 'Genomics Analysis'
    if (path === '/manuscripts') return 'Manuscripts'
    if (path === '/regulatory') return 'Regulatory & Compliance'
    if (path === '/imaging') return 'Research Imaging'
    if (path === '/biobank') return 'Biobank'
    if (path === '/knowledge-graph') return 'Knowledge Graph'
    if (path.startsWith('/knowledge-graph/')) return 'Knowledge Graph'
    if (path === '/ml-models') return 'ML Models'
    if (path.startsWith('/dev/pgvector')) return 'pgvector'
    return ''
  }

  // Keep document.title in sync with the current route so multi-tab
  // users can tell pages apart from the browser tab strip alone.
  // Single source of truth — the per-page components don't need to
  // each set their own title.
  useEffect(() => {
    const pageName = getPageTitle()
    document.title = pageName
      ? `${pageName} · humanovo`
      : 'humanovo — Biomedical Discovery Platform'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Skip-to-content link — visually hidden until a keyboard user
          tabs to it, then becomes a high-contrast button that jumps
          past the sidebar + header straight into <main>. Standard
          WCAG 2.4.1 "Bypass Blocks" implementation. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[99999] focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg"
        style={{
          background: 'var(--color-accent-blue, #3b82f6)',
          color: '#fff',
          fontSize: '0.875rem',
          fontWeight: 600,
        }}
      >
        Skip to main content
      </a>
      {/* Sidebar */}
      <aside className="w-52 flex flex-col glass-sidebar" aria-label="Primary navigation">
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-[var(--color-border)]">
          <a href="/dashboard" onClick={(e) => { e.preventDefault(); window.location.href = '/dashboard' }} className="flex items-center gap-2.5 no-underline hover:opacity-80 transition-opacity cursor-pointer">
            <HumanovoGlyph size={36} className="text-[var(--color-text)]" />
            <div className="flex flex-col">
              <span className="text-2xl text-[var(--color-text)] tracking-wide" style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 700, lineHeight: 1.2, letterSpacing: '0.04em' }}>humanovo</span>
            </div>
          </a>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {/* Main section — always expanded + shows keyboard shortcuts */}
          <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1.5 uppercase tracking-widest font-medium">Main</div>
          {mainNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-200 group',
                  isActive
                    ? 'bg-[var(--glass-bg-hover)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]'
                )
              }
            >
              <item.icon className="w-4 h-4" />
              <span className="flex-1 font-medium">{item.label}</span>
              <kbd className="hidden group-hover:inline text-xxs text-[var(--color-text-muted)] opacity-50">{item.shortcut}</kbd>
            </NavLink>
          ))}

          <CollapsibleNavSection title="Tools" items={secondaryNavItems} />
          <CollapsibleNavSection title="Research" items={researchNavItems} />
          <CollapsibleNavSection title="Analysis" items={analysisNavItems} />
          <CollapsibleNavSection title="Management" items={managementNavItems} />
          <CollapsibleNavSection title="Knowledge" items={knowledgeNavItems} />
        </nav>

        {/* Bottom section */}
        <div className="p-3 border-t border-[var(--color-border)] space-y-1">
          <ConstantChat />
          <button
            onClick={() => setIsCommandOpen(true)}
            className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all"
          >
            <FiCommand className="w-4 h-4" />
            <span className="font-medium">Command</span>
            <kbd className="ml-auto text-xxs text-[var(--color-text-muted)] bg-[var(--glass-bg)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">⌘K</kbd>
          </button>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm transition-all duration-200',
                isActive
                  ? 'bg-[var(--glass-bg-hover)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]'
              )
            }
          >
            <FiSettings className="w-4 h-4" />
            <span className="font-medium">Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 flex items-center justify-between px-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-medium text-[var(--color-text)]">{getPageTitle()}</h1>
            <span className="text-[var(--color-border-strong)]">/</span>
            <button
              onClick={() => setIsCommandOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text-muted)] bg-[var(--glass-bg)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--glass-bg-hover)] transition-all w-56"
            >
              <FiSearch className="w-3 h-3" />
              <span className="flex-1 text-left">Search...</span>
              <kbd className="text-xxs text-[var(--color-text-muted)]">⌘K</kbd>
            </button>
          </div>

          <div className="flex items-center gap-1">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] rounded-lg transition-all"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <FiSun className="w-4 h-4" /> : <FiMoon className="w-4 h-4" />}
            </button>

            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => { setIsNotificationsOpen(!isNotificationsOpen); setIsUserMenuOpen(false) }}
                aria-label="Notifications"
                title="Notifications"
                className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] rounded-lg transition-all relative"
              >
                <FiBell className="w-4 h-4" />
                {hasUnread && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[var(--color-text)] rounded-full" />
                )}
              </button>

              {isNotificationsOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsNotificationsOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 w-80 py-1.5 glass-card-static z-50 animate-scale-in" style={{ background: 'var(--color-surface-solid)' }}>
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
                      <span className="text-sm font-medium text-[var(--color-text)]">Notifications</span>
                      {hasUnread && (
                        <button
                          onClick={markAllRead}
                          className="text-xxs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    {notifications.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto">
                        {notifications.map(n => {
                          const dest = notifDest(n)
                          return (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => {
                                if (dest) {
                                  navigate(dest)
                                  setIsNotificationsOpen(false)
                                }
                              }}
                              disabled={!dest}
                              className={clsx(
                                'w-full text-left px-3 py-2 transition-all flex gap-2',
                                dest
                                  ? 'hover:bg-[var(--glass-bg)] cursor-pointer'
                                  : 'cursor-default opacity-90'
                              )}
                              title={dest ? `Open ${dest}` : undefined}
                            >
                              <div className="flex-shrink-0 mt-1.5">
                                {n.timestamp > (localStorage.getItem('humanovo-notifs-read') || '0') ? (
                                  <span className="block w-2 h-2 rounded-full bg-[var(--color-text)]" />
                                ) : (
                                  <span className="block w-2 h-2" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-[var(--color-text-secondary)] capitalize">{n.title}</div>
                                <div className="text-xxs text-[var(--color-text-muted)] mt-0.5 truncate">{n.description}</div>
                                <div className="text-xxs text-[var(--color-text-muted)] mt-0.5">{n.time}</div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
                        No notifications yet
                      </div>
                    )}
                    <div className="border-t border-[var(--color-border)] px-3 py-2">
                      <button
                        onClick={() => { navigate('/timeline'); setIsNotificationsOpen(false) }}
                        className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:underline w-full text-center"
                      >
                        View all activity
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Divider */}
            <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => { setIsUserMenuOpen(!isUserMenuOpen); setIsNotificationsOpen(false) }}
                className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-[var(--glass-bg)] rounded-lg transition-all"
              >
                <div className="w-6 h-6 bg-[var(--glass-bg-hover)] rounded-full flex items-center justify-center border border-[var(--color-border)]">
                  <FiUser className="w-3 h-3 text-[var(--color-text-secondary)]" />
                </div>
                <span className="text-[var(--color-text-secondary)] text-sm">Researcher</span>
                <FiChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
              </button>

              {isUserMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 w-44 py-1.5 glass-card-static z-50 animate-scale-in" style={{ background: 'var(--color-surface-solid)' }}>
                    <button
                      onClick={() => { navigate('/settings'); setIsUserMenuOpen(false) }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all"
                    >
                      <FiUser className="w-3.5 h-3.5" />
                      Profile
                    </button>
                    <button
                      onClick={() => { navigate('/settings?tab=appearance'); setIsUserMenuOpen(false) }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all"
                    >
                      <FiSettings className="w-3.5 h-3.5" />
                      Preferences
                    </button>
                    <div className="my-1 border-t border-[var(--color-border)]" />
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false)
                        // Sign out only clears session state, NOT user research data.
                        // There is no auth system yet, so this just resets UI state and navigates home.
                        sessionStorage.clear()
                        navigate('/dashboard')
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-error)] hover:bg-[var(--glass-bg)] transition-all"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Workspace tabs */}
        <WorkspaceTabs />

        {/* Trial-state banner — visible only for tier=trial users
            with a known trial_ends_at. Renders ABOVE the main
            content so it scrolls away as the user navigates a long
            page, freeing the chrome rather than persistently
            stealing pixels. */}
        <TrialBanner />

        {/* Email-verification banner — only when is_verified=false.
            Stacks below the trial banner so an unverified trial user
            sees both nudges (trial countdown is more urgent, so it
            goes first). */}
        <VerifyEmailBanner />

        {/* Main content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-h-0 overflow-auto bg-[var(--color-bg)]"
        >
          <Outlet />
        </main>
      </div>

      {/* Command palette */}
      <CommandPalette isOpen={isCommandOpen} onClose={() => setIsCommandOpen(false)} />

      {/* Keyboard shortcuts cheatsheet */}
      <KeyboardShortcutsHelp isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />

      {/* First-run onboarding wizard. Shown when:
          - auth bootstrap finished (otherwise we'd flash on page reload),
          - user is signed in,
          - backend reports has_completed_onboarding === false.
          The wizard's Skip / Finish handlers PATCH /me to flip the flag
          and trigger refresh(), so it never re-opens after dismissal. */}
      {!authLoading && user && user.has_completed_onboarding === false && (
        <Onboarding />
      )}
    </div>
  )
}

function KeyboardShortcutsHelp({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null
  const groups: { title: string; rows: { keys: string[]; label: string }[] }[] = [
    {
      title: 'Global',
      rows: [
        { keys: ['⌘', 'K'], label: 'Open command palette / global search' },
        { keys: ['?'], label: 'Show this keyboard cheatsheet' },
        { keys: ['Esc'], label: 'Close dialogs & menus' },
      ],
    },
    {
      title: 'Command palette',
      rows: [
        { keys: ['↑', '↓'], label: 'Move highlight between results' },
        { keys: ['Enter'], label: 'Run highlighted action' },
        { keys: ['Esc'], label: 'Dismiss palette' },
      ],
    },
    {
      title: 'Navigation — number',
      rows: [
        { keys: ['1'], label: 'Go to Dashboard' },
        { keys: ['2'], label: 'Go to Projects' },
        { keys: ['3'], label: 'Go to Evidence' },
        { keys: ['4'], label: 'Go to Compute Lab' },
        { keys: ['5'], label: 'Go to Notebook' },
        { keys: ['6'], label: 'Go to Agents' },
      ],
    },
    {
      title: 'Navigation — vim-style (g then letter)',
      rows: [
        { keys: ['g', 'd'], label: 'Go to Dashboard' },
        { keys: ['g', 'p'], label: 'Go to Projects' },
        { keys: ['g', 'e'], label: 'Go to Evidence' },
        { keys: ['g', 'h'], label: 'Go to Hypotheses' },
        { keys: ['g', 'c'], label: 'Go to Compute Lab' },
        { keys: ['g', 'n'], label: 'Go to Notebook' },
        { keys: ['g', 'a'], label: 'Go to Agents' },
        { keys: ['g', 'k'], label: 'Go to Knowledge Graph' },
        { keys: ['g', 't'], label: 'Go to Timeline' },
        { keys: ['g', 's'], label: 'Go to Search' },
        { keys: ['g', 'w'], label: 'Go to Workbench' },
        { keys: ['g', 'i'], label: 'Go to Imaging' },
      ],
    },
    {
      title: 'Compute Lab',
      rows: [
        { keys: ['⌘', 'Enter'], label: 'Run current expression / script' },
        { keys: ['⌘', 'S'], label: 'Save to history' },
        { keys: ['↑', '↓'], label: 'Navigate history in the REPL' },
      ],
    },
    {
      title: 'Research Imaging',
      rows: [
        { keys: ['P'], label: 'Pan' },
        { keys: ['R'], label: 'Rectangle' },
        { keys: ['C'], label: 'Circle' },
        { keys: ['L'], label: 'Line' },
        { keys: ['M'], label: 'Measure' },
        { keys: ['U'], label: 'Ruler' },
        { keys: ['B'], label: 'Brush (segmentation)' },
        { keys: ['X'], label: 'Eraser' },
        { keys: ['+', '-'], label: 'Zoom in / out' },
        { keys: ['0'], label: 'Reset zoom & pan' },
        { keys: ['F'], label: 'Toggle multi-planar view' },
        { keys: ['[', ']'], label: 'Previous / next study' },
      ],
    },
  ]
  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card max-w-xl w-full mx-4 p-6"
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--color-surface-solid)', border: '1px solid var(--glass-border)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--glass-bg-hover)]"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Close"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5">
          {groups.map(g => (
            <div key={g.title}>
              <div
                className="text-xxs uppercase tracking-wider mb-2"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {g.title}
              </div>
              <div className="space-y-1.5">
                {g.rows.map(r => (
                  <div key={r.label} className="flex items-center justify-between text-xs">
                    <span style={{ color: 'var(--color-text-secondary)' }}>{r.label}</span>
                    <span className="flex items-center gap-1">
                      {r.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="px-1.5 py-0.5 rounded text-xxs font-mono"
                          style={{
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid var(--glass-border)',
                            color: 'var(--color-text)',
                            minWidth: '1.5rem',
                            textAlign: 'center',
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          className="mt-5 pt-4 text-xxs"
          style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--glass-border)' }}
        >
          Shortcuts are disabled while typing in inputs or the editor.
        </div>
      </div>
    </div>
  )
}
