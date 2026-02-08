import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  FiHome,
  FiFolder,
  FiZap,

  FiActivity,
  FiSettings,
  FiDatabase,
  FiSearch,
  FiBook,
  FiUsers,
  FiClock,
  FiBox,
  FiSun,
  FiMoon,
  FiPlus,
  FiX,
  FiBell,
  FiUser,
  FiChevronDown,
  FiCommand
} from 'react-icons/fi'
import clsx from 'clsx'
import { useTheme } from '../contexts/ThemeContext'
import { useWorkspace, WorkspaceTab } from '../contexts/WorkspaceContext'

const mainNavItems = [
  { to: '/dashboard', icon: FiHome, label: 'Dashboard', shortcut: '1' },
  { to: '/projects', icon: FiFolder, label: 'Projects', shortcut: '2' },
  { to: '/evidence', icon: FiDatabase, label: 'Evidence', shortcut: '3' },
  { to: '/hypotheses', icon: FiZap, label: 'Hypotheses', shortcut: '4' },
  { to: '/agents', icon: FiActivity, label: 'Discovery', shortcut: '5' },
  { to: '/workbench', icon: FiBox, label: 'Workbench', shortcut: '6' },
  { to: '/anatomy', icon: FiUser, label: '3D Anatomy', shortcut: '7' },
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
    agents: FiUsers,
  }
  const Icon = icons[type] || FiFolder
  return <Icon className="w-3 h-3" />
}

function WorkspaceTabs() {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab } = useWorkspace()
  const navigate = useNavigate()

  const handleAddTab = () => {
    addTab({
      type: 'project',
      title: 'New Tab',
    })
    navigate('/projects')
  }

  if (tabs.length === 0) return null

  return (
    <div className="flex items-center h-8 px-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="flex items-center gap-0.5 overflow-x-auto hide-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'group flex items-center gap-1.5 px-2 py-1 text-xs rounded-t transition-colors min-w-0',
              activeTabId === tab.id
                ? 'bg-[var(--color-surface)] text-[var(--color-text)] border-t border-x border-[var(--color-border)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]/50'
            )}
          >
            <TabIcon type={tab.type} />
            <span className="truncate max-w-24">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeTab(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--color-border)] rounded transition-opacity"
            >
              <FiX className="w-2.5 h-2.5" />
            </button>
          </button>
        ))}
      </div>
      <button
        onClick={handleAddTab}
        className="ml-1 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded transition-colors"
        title="New Tab"
      >
        <FiPlus className="w-3 h-3" />
      </button>
    </div>
  )
}

function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
          <FiSearch className="w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            placeholder="Search commands, projects, hypotheses..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)]"
            autoFocus
          />
          <kbd className="px-1.5 py-0.5 text-xxs bg-[var(--color-bg)] rounded border border-[var(--color-border)]">ESC</kbd>
        </div>
        <div className="p-2 max-h-80 overflow-y-auto">
          <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1">Quick Actions</div>
          {[
            { label: 'New Project', icon: FiFolder },
            { label: 'New Hypothesis', icon: FiZap },
            { label: 'Run Simulation', icon: FiActivity },
            { label: 'Open Workbench', icon: FiBox },
          ].map((item) => (
            <button
              key={item.label}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-[var(--color-border)] transition-colors"
              onClick={onClose}
            >
              <item.icon className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { theme, toggleTheme } = useTheme()
  const [isCommandOpen, setIsCommandOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Sidebar */}
      <aside className="w-48 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        {/* Logo */}
        <div className="h-10 flex items-center px-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-primary-400 to-primary-600 rounded flex items-center justify-center">
              <span className="text-white font-bold text-xs">H</span>
            </div>
            <span className="text-sm font-semibold text-[var(--color-text)]">Humanovo</span>
            <span className="badge badge-info ml-auto">v0.1</span>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1 uppercase tracking-wider">Main</div>
          {mainNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors group',
                  isActive
                    ? 'bg-primary-500/10 text-primary-400'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                )
              }
            >
              <item.icon className="w-3.5 h-3.5" />
              <span className="flex-1">{item.label}</span>
              <kbd className="hidden group-hover:inline text-xxs text-[var(--color-text-muted)]">{item.shortcut}</kbd>
            </NavLink>
          ))}

          <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1 mt-3 uppercase tracking-wider">Tools</div>
          {secondaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors',
                  isActive
                    ? 'bg-primary-500/10 text-primary-400'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                )
              }
            >
              <item.icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="p-2 border-t border-[var(--color-border)] space-y-1">
          <button
            onClick={() => setIsCommandOpen(true)}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] transition-colors"
          >
            <FiCommand className="w-3.5 h-3.5" />
            <span>Command</span>
            <kbd className="ml-auto text-xxs bg-[var(--color-bg)] px-1 rounded border border-[var(--color-border)]">K</kbd>
          </button>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs transition-colors',
                isActive
                  ? 'bg-primary-500/10 text-primary-400'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
              )
            }
          >
            <FiSettings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-10 flex items-center justify-between px-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCommandOpen(true)}
              className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)] rounded border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors"
            >
              <FiSearch className="w-3 h-3" />
              <span>Search...</span>
              <kbd className="text-xxs">Cmd+K</kbd>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded transition-colors"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <FiSun className="w-3.5 h-3.5" /> : <FiMoon className="w-3.5 h-3.5" />}
            </button>

            {/* Notifications */}
            <button className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded transition-colors relative">
              <FiBell className="w-3.5 h-3.5" />
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-primary-500 rounded-full" />
            </button>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-[var(--color-surface)] rounded transition-colors"
              >
                <div className="w-5 h-5 bg-primary-500/20 rounded-full flex items-center justify-center">
                  <FiUser className="w-3 h-3 text-primary-400" />
                </div>
                <span className="text-[var(--color-text-secondary)]">Researcher</span>
                <FiChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
              </button>

              {isUserMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-40 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50">
                    <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors">
                      <FiUser className="w-3 h-3" />
                      Profile
                    </button>
                    <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors">
                      <FiSettings className="w-3 h-3" />
                      Preferences
                    </button>
                    <div className="my-1 border-t border-[var(--color-border)]" />
                    <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-error-400 hover:bg-[var(--color-border)] transition-colors">
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
