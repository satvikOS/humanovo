import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
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
} from 'react-icons/fi'
import clsx from 'clsx'
import { useTheme } from '../contexts/ThemeContext'
import { useWorkspace, WorkspaceTab } from '../contexts/WorkspaceContext'

const mainNavItems = [
  { to: '/dashboard', icon: FiHome, label: 'Dashboard', shortcut: '1' },
  { to: '/projects', icon: FiFolder, label: 'Projects', shortcut: '2' },
  { to: '/evidence', icon: FiDatabase, label: 'Evidence', shortcut: '3' },
  { to: '/agents', icon: FiActivity, label: 'Discovery', shortcut: '4' },
  { to: '/workbench', icon: FiBox, label: 'Workbench', shortcut: '5' },
  { to: '/anatomy', icon: FiUser, label: '3D Anatomy', shortcut: '6' },
]

const secondaryNavItems = [
  { to: '/notebook', icon: FiBook, label: 'Notebook' },
  { to: '/timeline', icon: FiClock, label: 'Timeline' },
  { to: '/search', icon: FiSearch, label: 'Search' },
]

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
        title="New Tab"
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
}

function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const actions: CommandAction[] = [
    { label: 'Go to Dashboard', icon: FiHome, category: 'Navigation', action: () => { navigate('/dashboard'); onClose() } },
    { label: 'Go to Projects', icon: FiFolder, category: 'Navigation', action: () => { navigate('/projects'); onClose() } },
    { label: 'Go to Evidence', icon: FiDatabase, category: 'Navigation', action: () => { navigate('/evidence'); onClose() } },
    { label: 'Go to Discovery', icon: FiActivity, category: 'Navigation', action: () => { navigate('/agents'); onClose() } },
    { label: 'Go to Notebook', icon: FiBook, category: 'Navigation', action: () => { navigate('/notebook'); onClose() } },
    { label: 'Go to Search', icon: FiSearch, category: 'Navigation', action: () => { navigate('/search'); onClose() } },
    { label: 'Go to Timeline', icon: FiClock, category: 'Navigation', action: () => { navigate('/timeline'); onClose() } },
    { label: 'New Project', icon: FiPlus, description: 'Create a new research project', category: 'Actions', action: () => { navigate('/projects?new=1'); onClose() } },
    { label: 'Start Discovery', icon: FiZap, description: 'Launch AI discovery pipeline', category: 'Actions', action: () => { navigate('/agents?start=1'); onClose() } },
    { label: 'Global Search', icon: FiGlobe, description: 'Search across all data', category: 'Actions', action: () => { navigate('/search'); onClose() } },
    { label: 'Open Settings', icon: FiSettings, category: 'Actions', action: () => { navigate('/settings'); onClose() } },
  ]

  const filtered = query
    ? actions.filter(a => a.label.toLowerCase().includes(query.toLowerCase()) || a.description?.toLowerCase().includes(query.toLowerCase()))
    : actions

  const categories = [...new Set(filtered.map(a => a.category))]

  useEffect(() => {
    if (isOpen) setQuery('')
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] animate-fade-in">
      <div className="absolute inset-0 modal-overlay" onClick={onClose} />
      <div className="relative w-full max-w-xl glass-card-static overflow-hidden animate-scale-in" style={{ background: 'var(--color-surface-solid)', boxShadow: 'var(--glass-shadow)' }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <FiSearch className="w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)]"
            autoFocus
          />
          <kbd className="px-1.5 py-0.5 text-xxs text-[var(--color-text-muted)] bg-[var(--glass-bg)] rounded border border-[var(--color-border)]">ESC</kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-2">
          {categories.map(cat => (
            <div key={cat}>
              <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1.5 uppercase tracking-wider font-medium">{cat}</div>
              {filtered.filter(a => a.category === cat).map(item => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--glass-bg-hover)] transition-all group"
                >
                  <item.icon className="w-4 h-4 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]" />
                  <div className="flex-1 text-left">
                    <span className="text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)]">{item.label}</span>
                    {item.description && (
                      <span className="block text-xs text-[var(--color-text-muted)]">{item.description}</span>
                    )}
                  </div>
                  <FiArrowRight className="w-3 h-3 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">No results found</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { theme, toggleTheme } = useTheme()
  const [isCommandOpen, setIsCommandOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const location = useLocation()

  // Keyboard shortcut for command palette
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setIsCommandOpen(prev => !prev)
    }
    if (e.key === 'Escape') {
      setIsCommandOpen(false)
      setIsUserMenuOpen(false)
    }
  }, [])

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
    if (path === '/workbench') return 'Workbench'
    if (path === '/anatomy') return '3D Anatomy'
    if (path === '/notebook') return 'Notebook'
    if (path === '/timeline') return 'Timeline'
    if (path === '/search') return 'Search'
    if (path === '/settings') return 'Settings'
    return ''
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Sidebar */}
      <aside className="w-52 flex flex-col glass-sidebar">
        {/* Logo */}
        <div className="h-12 flex items-center px-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--color-text)] flex items-center justify-center">
              <span className="text-[var(--color-bg)] font-bold text-xs">H</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-[var(--color-text)] tracking-tight">humanovo</span>
              <span className="text-xxs text-[var(--color-text-muted)]">Research Platform</span>
            </div>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
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

          <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1.5 mt-4 uppercase tracking-widest font-medium">Tools</div>
          {secondaryNavItems.map((item) => (
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
        </nav>

        {/* Bottom section */}
        <div className="p-3 border-t border-[var(--color-border)] space-y-1">
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
            <button className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] rounded-lg transition-all relative">
              <FiBell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[var(--color-accent-blue)] rounded-full" />
            </button>

            {/* Divider */}
            <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
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
                    <button className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all">
                      <FiUser className="w-3.5 h-3.5" />
                      Profile
                    </button>
                    <button className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all">
                      <FiFileText className="w-3.5 h-3.5" />
                      API Keys
                    </button>
                    <button className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all">
                      <FiSettings className="w-3.5 h-3.5" />
                      Preferences
                    </button>
                    <div className="my-1 border-t border-[var(--color-border)]" />
                    <button className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-error)] hover:bg-[var(--glass-bg)] transition-all">
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

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-[var(--color-bg)]">
          <Outlet />
        </main>
      </div>

      {/* Command palette */}
      <CommandPalette isOpen={isCommandOpen} onClose={() => setIsCommandOpen(false)} />
    </div>
  )
}
