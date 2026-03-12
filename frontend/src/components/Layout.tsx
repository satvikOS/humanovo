import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
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
  FiBookOpen,
  FiList,
  FiClipboard,
  FiBarChart2,
  FiMessageCircle,
  FiSend,
  FiImage,
  FiShield,
  FiPackage,
  FiShare2,
  FiTarget,
  FiHeart,
  FiGrid,
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

const researchNavItems = [
  { to: '/literature-review', icon: FiBookOpen, label: 'Lit Review' },
  { to: '/citation-manager', icon: FiList, label: 'Citations' },
  { to: '/experiment-tracker', icon: FiClipboard, label: 'Experiments' },
  { to: '/data-visualization', icon: FiBarChart2, label: 'Visualization' },
  { to: '/simulations', icon: FiActivity, label: 'Simulations' },
]

const analysisNavItems = [
  { to: '/statistical-analysis', icon: FiTarget, label: 'Statistics' },
  { to: '/genomics', icon: FiHeart, label: 'Genomics' },
  { to: '/knowledge-graph', icon: FiShare2, label: 'Knowledge Graph' },
]

const managementNavItems = [
  { to: '/data-manager', icon: FiDatabase, label: 'Data Manager', comingSoon: true },
  { to: '/clinical-trials', icon: FiClipboard, label: 'Clinical Trials', comingSoon: true },
  { to: '/manuscripts', icon: FiFileText, label: 'Manuscripts', comingSoon: true },
  { to: '/biobank', icon: FiPackage, label: 'Biobank', comingSoon: true },
  { to: '/collaboration', icon: FiGrid, label: 'Collaboration', comingSoon: true },
  { to: '/regulatory', icon: FiShield, label: 'Regulatory', comingSoon: true },
  { to: '/imaging', icon: FiImage, label: 'Imaging', comingSoon: true },
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
    { label: 'Go to Knowledge Graph', icon: FiGlobe, category: 'Navigation', action: () => { navigate('/knowledge-graph'); onClose() } },
    { label: 'Go to Simulations', icon: FiTrendingUp, category: 'Navigation', action: () => { navigate('/simulations'); onClose() } },
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

// ── Constant AI Chat ─────────────────────────────────────────────

function ConstantChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    { role: 'assistant', text: 'Hello! I\'m Constant, your AI research assistant. Ask me about your hypotheses, papers, experimental design, or anything research-related.' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)

    try {
      const res = await fetch('/api/v1/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, context: 'general' }),
      })
      if (res.ok) {
        const data = await res.json()
        setMessages(prev => [...prev, { role: 'assistant', text: data.response || 'I\'m not sure about that. Could you rephrase?' }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: 'Something went wrong. Please try again.' }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

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

      {/* Full-screen centered modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
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
                  <p className="text-xxs text-[var(--color-text-muted)]">AI Research Assistant</p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all">
                <FiX className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'assistant'
                        ? 'bg-[var(--glass-bg)] text-[var(--color-text-secondary)] rounded-tl-md'
                        : 'rounded-tr-md text-[var(--color-text)]'
                    }`}
                    style={msg.role === 'user' ? { background: 'rgba(168, 85, 247, 0.1)' } : {}}
                  >
                    {msg.role === 'assistant' && (
                      <span className="text-[var(--color-accent-purple)] font-medium text-xs block mb-1">Constant</span>
                    )}
                    {msg.text}
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
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="px-5 py-4 border-t border-[var(--color-border)]">
              <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--glass-bg)] px-4 py-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  placeholder="Ask Constant about your research..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)]"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="p-2 rounded-lg text-white disabled:opacity-30 transition-all"
                  style={{ background: 'var(--color-accent-purple)' }}
                >
                  <FiSend className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xxs text-[var(--color-text-muted)] mt-2 text-center">Press Enter to send, Escape to close</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { theme, toggleTheme } = useTheme()
  const [isCommandOpen, setIsCommandOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; description: string; time: string }>>([])
  const [hasUnread, setHasUnread] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  // Fetch recent activities as notifications
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const { api } = await import('../services/api')
        const result = await api.getActivities({ page: 1, page_size: 5 })
        if (result?.items && result.items.length > 0) {
          const lastRead = localStorage.getItem('humanovo-notifs-read') || '0'
          setNotifications(result.items.map((a: any) => ({
            id: a.id,
            title: (a.activity_type || 'activity').replace(/_/g, ' '),
            description: a.description || '',
            time: a.created_at ? new Date(a.created_at).toLocaleString() : '',
          })))
          const newestTime = result.items[0]?.created_at || ''
          setHasUnread(newestTime > lastRead)
        }
      } catch {
        // Activities endpoint may not be available yet
      }
    }
    fetchNotifications()
  }, [location.pathname])

  const markAllRead = () => {
    setHasUnread(false)
    localStorage.setItem('humanovo-notifs-read', new Date().toISOString())
  }

  // Keyboard shortcut for command palette
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setIsCommandOpen(prev => !prev)
    }
    if (e.key === 'Escape') {
      setIsCommandOpen(false)
      setIsUserMenuOpen(false)
      setIsNotificationsOpen(false)
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
    if (path === '/knowledge-graph') return 'Knowledge Graph'
    if (path === '/hypotheses') return 'Hypotheses'
    if (path.startsWith('/hypotheses/')) return 'Hypothesis Detail'
    if (path === '/simulations') return 'Simulations'
    if (path === '/workbench') return 'Workbench'
    if (path === '/anatomy') return '3D Anatomy'
    if (path === '/notebook') return 'Notebook'
    if (path === '/timeline') return 'Timeline'
    if (path === '/search') return 'Search'
    if (path === '/settings') return 'Settings'
    if (path === '/simulations') return 'Simulations'
    if (path === '/literature-review') return 'Literature Review'
    if (path === '/citation-manager') return 'Citation Manager'
    if (path === '/experiment-tracker') return 'Experiment Tracker'
    if (path === '/data-visualization') return 'Data Visualization'
    if (path === '/statistical-analysis') return 'Statistical Analysis'
    if (path === '/data-manager') return 'Data Manager'
    if (path === '/collaboration') return 'Collaboration'
if (path === '/clinical-trials') return 'Clinical Trials'
    if (path === '/genomics') return 'Genomics Analysis'
    if (path === '/manuscripts') return 'Manuscripts'
    if (path === '/regulatory') return 'Regulatory & Compliance'
    if (path === '/imaging') return 'Research Imaging'
    if (path === '/biobank') return 'Biobank'
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
              <span className="text-[var(--color-bg)] text-xl" style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 600, lineHeight: 1 }}>h</span>
            </div>
            <div className="flex flex-col">
              <span className="text-base text-[var(--color-text)] tracking-tight" style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 600 }}>humanovo</span>
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

          <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1.5 mt-4 uppercase tracking-widest font-medium">Research</div>
          {researchNavItems.map((item) => (
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

          <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1.5 mt-4 uppercase tracking-widest font-medium">Analysis</div>
          {analysisNavItems.map((item) => (
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

          <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1.5 mt-4 uppercase tracking-widest font-medium">Management</div>
          {managementNavItems.map((item) => (
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
              <span className="font-medium flex-1">{item.label}</span>
              {item.comingSoon && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)] whitespace-nowrap">Soon</span>
              )}
            </NavLink>
          ))}
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
                className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] rounded-lg transition-all relative"
              >
                <FiBell className="w-4 h-4" />
                {hasUnread && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[var(--color-accent-blue)] rounded-full" />
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
                          className="text-xxs text-[var(--color-accent-blue)] hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    {notifications.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto">
                        {notifications.map(n => (
                          <div key={n.id} className="px-3 py-2 hover:bg-[var(--glass-bg)] transition-all">
                            <div className="text-xs font-medium text-[var(--color-text-secondary)] capitalize">{n.title}</div>
                            <div className="text-xxs text-[var(--color-text-muted)] mt-0.5 truncate">{n.description}</div>
                            <div className="text-xxs text-[var(--color-text-muted)] mt-0.5">{n.time}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
                        No notifications yet
                      </div>
                    )}
                    <div className="border-t border-[var(--color-border)] px-3 py-2">
                      <button
                        onClick={() => { navigate('/timeline'); setIsNotificationsOpen(false) }}
                        className="text-xs text-[var(--color-accent-blue)] hover:underline w-full text-center"
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
                      onClick={() => { navigate('/settings?tab=api'); setIsUserMenuOpen(false) }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all"
                    >
                      <FiFileText className="w-3.5 h-3.5" />
                      API Keys
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
                        localStorage.clear()
                        window.location.href = '/dashboard'
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

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-[var(--color-bg)]">
          {['/data-manager', '/clinical-trials', '/manuscripts', '/biobank', '/collaboration', '/regulatory', '/imaging'].includes(location.pathname) && (
            <div className="mx-6 mt-4 px-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--glass-bg)] flex items-center gap-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-[var(--color-accent-blue)] text-white" style={{ background: 'var(--color-accent-blue)' }}>Coming Soon</span>
              <span className="text-xs text-[var(--color-text-muted)]">This feature is under active development and will be available in a future release.</span>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Command palette */}
      <CommandPalette isOpen={isCommandOpen} onClose={() => setIsCommandOpen(false)} />
    </div>
  )
}
