import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { formatDateTime } from '../utils/persistence'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  FiPackage,
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
{ to: '/citation-manager', icon: FiList, label: 'Citations' },
  { to: '/experiment-tracker', icon: FiClipboard, label: 'Experiments' },
  { to: '/data-visualization', icon: FiBarChart2, label: 'Visualization' },
  { to: '/simulations', icon: FiActivity, label: 'Simulations' },
]

const analysisNavItems = [
  { to: '/statistical-analysis', icon: FiTarget, label: 'Statistics' },
  { to: '/genomics', icon: FiHeart, label: 'Genomics' },
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
    { role: 'assistant', text: 'Hey! I\'m Constant, your research companion on HumaNovo. I can help you navigate the platform, explain biology and statistics concepts, or dig into your research data. What would you like to do?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const getLocalContext = () => {
    try {
      // All platform data uses 'humanovo-' prefix via persistGet/persistSet
      const projects = JSON.parse(localStorage.getItem('humanovo-projects') || '[]')
      const hypotheses = JSON.parse(localStorage.getItem('humanovo-hypotheses') || '[]')
      const papers = JSON.parse(localStorage.getItem('humanovo-research-papers') || '[]')
      const simulations = JSON.parse(localStorage.getItem('humanovo-mc-simulations') || '[]')
      return {
        totalProjects: projects.length,
        totalHypotheses: hypotheses.length,
        totalPapers: papers.length,
        totalSimulations: simulations.length,
        projects: projects.map((p: any) => ({
          name: p.name || p.title,
          disease: p.disease_focus || p.disease,
          hypotheses: p.hypothesis_count,
          status: p.status,
        })).filter((p: any) => p.name),
        hypotheses: hypotheses.map((h: any) => ({
          title: h.statement || h.title,
          mechanism: h.mechanism,
          confidence: h.confidence || h.confidence_score,
          disease: h.disease,
          tags: h.tags?.slice(0, 5),
        })).filter((h: any) => h.title),
        papers: papers.map((p: any) => ({
          title: p.hypothesis_title,
          disease: p.disease,
        })).filter((p: any) => p.title),
      }
    } catch { return {} }
  }

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

  const generateSmartFallbackResponse = (query: string): string => {
    const q = query.toLowerCase().trim()
    const ctx = getLocalContext() as any

    const totalProjects = ctx.totalProjects || 0
    const totalHypotheses = ctx.totalHypotheses || 0
    const totalPapers = ctx.totalPapers || 0
    const totalSimulations = ctx.totalSimulations || 0
    const projects = (ctx.projects as any[]) || []
    const hypotheses = (ctx.hypotheses as any[]) || []
    const papers = (ctx.papers as any[]) || []

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
        [/simulat/i, 'Simulations', 'Head to **Simulations** in the sidebar under Tools. You can run Monte Carlo simulations to test hypothesis robustness.'],
        [/statistic|t-test|anova|regression/i, 'Statistics', 'Go to **Statistics** under Analysis in the sidebar. It has tabs for descriptive stats, hypothesis testing, regression, survival analysis, and sample size calculation.'],
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
    const matchingHyps = hypotheses.filter((h: any) => {
      const searchable = [h.title, h.mechanism, h.disease, ...(h.tags || [])].filter(Boolean).join(' ').toLowerCase()
      return q.split(/\s+/).some((word: string) => word.length > 3 && searchable.includes(word))
    })

    const matchingProjects = projects.filter((p: any) => {
      const searchable = [p.name, p.disease].filter(Boolean).join(' ').toLowerCase()
      return q.split(/\s+/).some((word: string) => word.length > 3 && searchable.includes(word))
    })

    if (matchingHyps.length > 0) {
      const intro = matchingHyps.length === 1
        ? 'I found a relevant hypothesis in your data:'
        : `I found **${matchingHyps.length}** relevant hypotheses in your data:`
      const items = matchingHyps.slice(0, 3).map((h: any, i: number) => {
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
      const items = matchingProjects.slice(0, 5).map((p: any, i: number) =>
        `${i + 1}. **${p.name}**${p.disease ? ` — ${p.disease}` : ''}${p.hypotheses ? ` (${p.hypotheses} hypotheses)` : ''}`
      ).join('\n')
      return `I found ${matchingProjects.length} related project${matchingProjects.length > 1 ? 's' : ''}:\n\n${items}\n\nOpen **Projects** in the sidebar to view details.`
    }

    // --- Context-aware queries about platform sections ---
    if (/hypothes[ie]s/i.test(q)) {
      if (totalHypotheses > 0) {
        const recent = hypotheses.slice(0, 3).map((h: any, i: number) =>
          `${i + 1}. **${h.title}**${h.confidence ? ` — ${Math.round(h.confidence * 100)}% confidence` : ''}`
        ).join('\n')
        return `You've generated **${totalHypotheses}** hypotheses so far. Here are a few:\n\n${recent}${totalHypotheses > 3 ? `\n\n...and ${totalHypotheses - 3} more.` : ''}\n\nHead to **Discovery** to explore them or generate new ones.`
      }
      return 'You don\'t have any hypotheses yet. Go to **Discovery** in the sidebar, enter a disease or research area, and click "Start" to begin generating hypotheses!'
    }

    if (/\bproject/i.test(q)) {
      if (totalProjects > 0) {
        const recent = projects.slice(0, 3).map((p: any, i: number) =>
          `${i + 1}. **${p.name}**${p.disease ? ` — ${p.disease}` : ''}`
        ).join('\n')
        return `You have **${totalProjects}** project${totalProjects > 1 ? 's' : ''}:\n\n${recent}${totalProjects > 3 ? `\n\n...and ${totalProjects - 3} more.` : ''}\n\nVisit **Projects** in the sidebar to manage them.`
      }
      return 'No projects yet! You can create one from the **Projects** page in the sidebar, or projects are automatically created when you run a discovery.'
    }

    if (/paper|publication|manuscript/i.test(q)) {
      if (totalPapers > 0) {
        const recent = papers.slice(0, 3).map((p: any, i: number) =>
          `${i + 1}. **${p.title}**${p.disease ? ` — ${p.disease}` : ''}`
        ).join('\n')
        return `You've generated **${totalPapers}** research paper${totalPapers > 1 ? 's' : ''}:\n\n${recent}\n\nYou can find them inside their respective projects.`
      }
      return 'No papers generated yet. To create one, open a project, select a hypothesis, and click "Generate Research Paper."'
    }

    if (/simulat/i.test(q)) {
      if (totalSimulations > 0) {
        return `You have **${totalSimulations}** simulation${totalSimulations > 1 ? 's' : ''}. Head to the **Simulations** page in the sidebar to view results or run new ones.`
      }
      return 'No simulations yet. Go to **Simulations** in the sidebar to run Monte Carlo simulations on your hypotheses — they help validate robustness and sensitivity.'
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
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)

    // Call the backend AI endpoint (routes to FastAPI → Bedrock Claude)
    try {
      const platformContext = getLocalContext()
      const res = await fetch('/api/v1/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, context: 'general', platform_context: platformContext }),
      })
      if (res.ok) {
        const data = await res.json()
        setMessages(prev => [...prev, { role: 'assistant', text: data.response || 'I\'m not sure about that. Could you rephrase?' }])
      } else {
        // API returned error — smart fallback using platform data
        setMessages(prev => [...prev, { role: 'assistant', text: generateSmartFallbackResponse(userMsg) }])
      }
    } catch {
      // API unreachable — smart fallback using platform data
      setMessages(prev => [...prev, { role: 'assistant', text: generateSmartFallbackResponse(userMsg) }])
    } finally {
      setLoading(false)
    }
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
              placeholder="Ask Constant anything — research, biology, stats..."
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
            time: a.created_at ? formatDateTime(a.created_at) : '',
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
        <div className="h-14 flex items-center px-4 border-b border-[var(--color-border)]">
          <Link to="/dashboard" className="flex items-center gap-2.5 no-underline hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-text)] flex items-center justify-center">
              <span className="text-[var(--color-bg)] text-2xl" style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 600, lineHeight: 1 }}>h</span>
            </div>
            <div className="flex flex-col">
              <span className="text-2xl text-[var(--color-text)] tracking-wide" style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 700, lineHeight: 1.2, letterSpacing: '0.04em' }}>humanovo</span>
            </div>
          </Link>
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
        <main className="flex-1 min-h-0 overflow-auto bg-[var(--color-bg)]">
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
