// Agents (Discovery) — conversational research co-pilot.
//
// Claude/ChatGPT/Gemini-level chat experience that replaces the old
// form-driven orchestrator on /agents. Features:
//   * Left rail with persistent session list (search, pin, rename,
//     delete, fork).
//   * Center chat pane with streaming token-by-token assistant
//     output via SSE, rich-card rendering for hypotheses / evidence
//     / KG snippets, markdown-lite formatting.
//   * Right-side slide-over for agent configuration (model,
//     temperature, system prompt, tool toggles).
//   * Hypothesis-save routing: when the agent emits a hypothesis
//     card, clicking the save icon attaches it to the currently
//     selected project (or prompts the user to pick one).
//
// Persistence: DiscoverySession CRUD at /api/v1/discovery-sessions
// keeps every conversation durable across tabs/devices. Streaming:
// /api/v1/agents/chat/stream emits SSE frames for token/card/status.
//
// The old form-driven Agents UI lives on as AgentsLegacy.tsx —
// preserved for reference but no longer mounted on any route.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  FiSend, FiSettings, FiStopCircle, FiZap, FiFolder, FiX,
  FiChevronDown, FiGitBranch,
} from 'react-icons/fi'
import api, { type DiscoverySessionSummary, type DiscoverySessionDetail, type DiscoveryMessage, type DiscoveryAgentConfig } from '../services/api'
import ChatMessage from '../components/discovery/ChatMessage'
import SessionSidebar from '../components/discovery/SessionSidebar'
import AgentConfigPanel from '../components/discovery/AgentConfigPanel'
import { useSSEChat } from '../components/discovery/useSSEChat'
import { toast } from '../contexts/ToastContext'
import { EmptyState } from '../components/EmptyState'
import { modalBackdropProps } from '../utils/clickable'

const LS_SIDEBAR_KEY = 'agents-sidebar-collapsed'

// Starter prompts shown on the empty-state pane to help authors kick
// off a meaningful conversation. Worded like real research questions.
const STARTERS: string[] = [
  'What are the leading hypotheses for amyloid-independent pathways in Alzheimer\'s?',
  'Which targets in IL-6 / JAK-STAT signalling have the strongest evidence for repurposing?',
  'Suggest three testable mechanisms connecting gut-microbiome composition to PD onset.',
  'Summarize recent evidence on mitochondrial dysfunction in ALS motor neurons.',
]

export default function Agents() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Sessions list ──
  const [sessions, setSessions] = useState<DiscoverySessionSummary[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [current, setCurrent] = useState<DiscoverySessionDetail | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_SIDEBAR_KEY) === '1' } catch { return false }
  })
  const [searchQuery, setSearchQuery] = useState('')

  // ── Chat state ──
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [streamingCards, setStreamingCards] = useState<DiscoveryMessage['cards']>([])
  const [status, setStatus] = useState<string | null>(null)
  const [inflight, setInflight] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)

  // ── Project context (for hypothesis save routing) ──
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    try { return localStorage.getItem('discovery-active-project-id') } catch { return null }
  })
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { send, cancel } = useSSEChat()

  // ── Effects ──

  // Load sessions on mount.
  const reloadSessions = useCallback(async (q?: string) => {
    try {
      const list = await api.listDiscoverySessions({ q: q || undefined, limit: 200 })
      setSessions(list)
    } catch (err) {
      console.warn('Failed to load sessions:', err)
    }
  }, [])

  useEffect(() => { reloadSessions() }, [reloadSessions])

  // Load projects for the save-to-project picker.
  useEffect(() => {
    (async () => {
      try {
        const res = await api.getProjects({ page: 1, page_size: 100 })
        setProjects((res.items || []).map(p => ({ id: p.id, name: p.name })))
      } catch { /* non-fatal */ }
    })()
  }, [])

  // Open the session indicated by ?session= URL param, or auto-open
  // the most recent one, or create a fresh session if none exist.
  useEffect(() => {
    const requested = searchParams.get('session')
    if (requested && requested !== currentId) {
      void openSession(requested)
      return
    }
    if (!currentId && sessions.length > 0) {
      void openSession(sessions[0].id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, searchParams.get('session')])

  // Scroll to bottom when messages change.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [current?.messages.length, streamingText])

  // Persist sidebar-collapsed + active-project to localStorage.
  useEffect(() => {
    try { localStorage.setItem(LS_SIDEBAR_KEY, sidebarCollapsed ? '1' : '0') } catch { /* ignore */ }
  }, [sidebarCollapsed])
  useEffect(() => {
    try { if (activeProjectId) localStorage.setItem('discovery-active-project-id', activeProjectId) } catch { /* ignore */ }
  }, [activeProjectId])

  // ── Session ops ──

  const openSession = useCallback(async (id: string) => {
    try {
      const detail = await api.getDiscoverySession(id)
      setCurrent(detail)
      setCurrentId(id)
      setStreamingText('')
      setStreamingCards([])
      setStatus(null)
      setSearchParams(prev => {
        const sp = new URLSearchParams(prev)
        sp.set('session', id)
        return sp
      }, { replace: true })
    } catch {
      toast('error', 'Could not load session', { title: 'Discovery' })
    }
  }, [setSearchParams])

  const newSession = useCallback(async () => {
    try {
      const detail = await api.createDiscoverySession({ project_id: activeProjectId || undefined })
      setSessions(s => [
        { id: detail.id, title: detail.title, pinned: detail.pinned, project_id: detail.project_id, message_count: 0, last_run_id: null, updated_at: detail.updated_at, created_at: detail.created_at, preview: null },
        ...s,
      ])
      setCurrent(detail)
      setCurrentId(detail.id)
      setStreamingText('')
      setStreamingCards([])
      setStatus(null)
      setSearchParams(prev => {
        const sp = new URLSearchParams(prev)
        sp.set('session', detail.id)
        return sp
      }, { replace: true })
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch {
      toast('error', 'Could not create session')
    }
  }, [activeProjectId, setSearchParams])

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.deleteDiscoverySession(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (id === currentId) {
        const next = sessions.find(s => s.id !== id)
        if (next) void openSession(next.id); else { setCurrent(null); setCurrentId(null) }
      }
    } catch {
      toast('error', 'Could not delete session')
    }
  }, [currentId, sessions, openSession])

  const renameSession = useCallback(async (id: string, title: string) => {
    try {
      const updated = await api.updateDiscoverySession(id, { title })
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: updated.title } : s))
      if (id === currentId) setCurrent(c => c ? { ...c, title: updated.title } : c)
    } catch {
      toast('error', 'Could not rename session')
    }
  }, [currentId])

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    try {
      await api.updateDiscoverySession(id, { pinned })
      setSessions(prev => prev.map(s => s.id === id ? { ...s, pinned } : s))
    } catch {
      toast('error', 'Could not update pin state')
    }
  }, [])

  const forkSession = useCallback(async () => {
    if (!currentId) return
    try {
      const forked = await api.forkDiscoverySession(currentId)
      setSessions(prev => [{ id: forked.id, title: forked.title, pinned: forked.pinned, project_id: forked.project_id, message_count: forked.messages.length, last_run_id: forked.last_run_id, updated_at: forked.updated_at, created_at: forked.created_at, preview: null }, ...prev])
      void openSession(forked.id)
      toast('success', 'Session forked')
    } catch {
      toast('error', 'Could not fork session')
    }
  }, [currentId, openSession])

  // ── Config updates ──
  const updateConfig = useCallback(async (patch: Partial<DiscoveryAgentConfig>) => {
    if (!current) return
    try {
      const updated = await api.updateDiscoverySession(current.id, { agent_config: patch })
      setCurrent(updated)
    } catch {
      toast('error', 'Could not update agent config')
    }
  }, [current])

  // ── Send a turn ──

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || inflight) return
    // Ensure we have a session — create one if the user jumped
    // straight to the composer on an empty page.
    let sessionId = currentId
    let sessionDetail = current
    if (!sessionId) {
      const detail = await api.createDiscoverySession({ project_id: activeProjectId || undefined })
      sessionId = detail.id
      sessionDetail = detail
      setCurrent(detail)
      setCurrentId(sessionId)
      setSessions(s => [
        { id: detail.id, title: detail.title, pinned: detail.pinned, project_id: detail.project_id, message_count: 0, last_run_id: null, updated_at: detail.updated_at, created_at: detail.created_at, preview: null },
        ...s,
      ])
    }

    // Optimistically append the user turn locally so the bubble shows
    // immediately. The SSE server appends the persisted version on
    // its side; on stream completion we reload the session to reconcile.
    const optimisticUser: DiscoveryMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      cards: [],
    }
    setCurrent(c => c ? { ...c, messages: [...c.messages, optimisticUser] } : c)
    setInput('')
    setInflight(true)
    setStreamingText('')
    setStreamingCards([])
    setStatus('Sending…')

    let runId = ''
    await send(
      sessionId!,
      text,
      undefined,
      {
        onStart: meta => { runId = meta.run_id; setStatus(`Streaming from ${meta.model}…`) },
        onStatus: msg => setStatus(msg),
        onToken: delta => setStreamingText(prev => prev + delta),
        onCard: card => setStreamingCards(prev => [...(prev || []), card]),
        onDone: async () => {
          setInflight(false)
          setStatus(null)
          setStreamingText('')
          setStreamingCards([])
          // Reload the full session to pick up the persisted
          // assistant message with its server-assigned id and any
          // tools-call traces.
          try {
            const detail = await api.getDiscoverySession(sessionId!)
            setCurrent(detail)
            // Refresh the sessions list so the sidebar preview updates.
            void reloadSessions(searchQuery)
          } catch { /* ignore */ }
        },
        onError: msg => {
          setInflight(false)
          setStatus(null)
          toast('error', msg, { title: 'Stream error' })
        },
      },
    )
    // Reference runId to silence TS unused; parent uses it from onStart.
    void runId
    void sessionDetail
  }, [currentId, current, activeProjectId, inflight, send, reloadSessions, searchQuery])

  // ── Hypothesis save routing ──

  // Stable identity (useCallback w/ no reactive deps) so the
  // handleCardAction useCallback below can list it as a dep without
  // re-creating on every render. Body uses only the two arguments,
  // imported `toast`, and the in-component `apiCreateHypothesis`
  // helper which itself never reads reactive state.
  const saveHypothesisToProject = useCallback(async (payload: Record<string, unknown>, projectId: string) => {
    try {
      // api.ts exposes `createHypothesis` via POST /hypotheses; we
      // stitch the card payload into the backend schema.
      const created = await apiCreateHypothesis({
        project_id: projectId,
        statement: String(payload.title ?? payload.statement ?? 'Untitled hypothesis'),
        mechanism: String(payload.body ?? payload.mechanism ?? ''),
        rationale: String(payload.rationale ?? ''),
        tags: Array.isArray(payload.tags) ? payload.tags as string[] : [],
      })
      toast('success', `Saved to project`, { title: 'Hypothesis saved' })
      return created
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      toast('error', msg)
    }
  }, [])

  const handleCardAction = useCallback(async (kind: string, payload: Record<string, unknown>) => {
    if (kind !== 'save-hypothesis') return
    if (!activeProjectId) {
      // Prompt the user to pick a project.
      setProjectPickerOpen(true)
      // Stash the pending hypothesis; the picker's confirm handler
      // will re-run the save.
      ;(window as unknown as { __pendingHypothesisCard?: Record<string, unknown> }).__pendingHypothesisCard = payload
      return
    }
    await saveHypothesisToProject(payload, activeProjectId)
  }, [activeProjectId, saveHypothesisToProject])

  // Minimal inline wrapper — api.ts already has createHypothesis but
  // threads it through a different path; we keep the call shape tight.
  const apiCreateHypothesis = async (body: { project_id: string; statement: string; mechanism: string; rationale: string; tags: string[] }) => {
    const { data } = await (await import('../services/api')).apiClient.post('/hypotheses', body)
    return data
  }

  // ── Render ──

  const activeProject = useMemo(() => projects.find(p => p.id === activeProjectId) || null, [projects, activeProjectId])

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <SessionSidebar
        sessions={sessions}
        currentId={currentId}
        onSelect={openSession}
        onNew={newSession}
        onDelete={deleteSession}
        onRename={renameSession}
        onTogglePin={togglePin}
        onSearch={(q) => { setSearchQuery(q); void reloadSessions(q) }}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={setSidebarCollapsed}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xxs uppercase tracking-wider text-[var(--color-text-muted)]">Discovery</div>
            {/* h2 (not a styled div) so screen readers and the persona
                e2e harness can locate the page heading via h1/h2/h3 */}
            <h2 className="text-sm font-semibold truncate m-0 p-0" style={{ color: 'var(--color-text)' }}>
              {current?.title || 'New conversation'}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Active project pill */}
            <button
              onClick={() => setProjectPickerOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--glass-border)] text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
              title="Active project (for hypothesis routing)"
            >
              <FiFolder className="w-3 h-3" />
              <span className="max-w-[180px] truncate">{activeProject?.name || 'No project selected'}</span>
              <FiChevronDown className="w-3 h-3" />
            </button>
            <button
              onClick={forkSession}
              disabled={!current}
              className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
              title="Fork conversation (copy + tweak config)"
              aria-label="Fork conversation"
            >
              <FiGitBranch className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setConfigOpen(true)}
              className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              title="Agent configuration"
              aria-label="Agent configuration"
            >
              <FiSettings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
          {!current || current.messages.length === 0 ? (
            <div className="max-w-3xl mx-auto">
              <EmptyState
                icon={<FiZap />}
                title="Ask anything biomedical"
                description="Humanovo reasons over the evidence corpus and knowledge graph, then surfaces hypotheses with explicit citations. Try one of the starters below or type your own question."
              />
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 10) }}
                    className="text-left text-sm px-3 py-2 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {current.messages.map(msg => (
                <ChatMessage key={msg.id} message={msg} onCardAction={handleCardAction} />
              ))}
              {/* Streaming in-progress assistant message */}
              {inflight && (
                <ChatMessage
                  key="streaming"
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: streamingText || (status || 'Thinking…'),
                    cards: streamingCards,
                    timestamp: new Date().toISOString(),
                  } as DiscoveryMessage}
                  streaming
                  onCardAction={handleCardAction}
                />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-[var(--color-border)] p-4">
          <div className="max-w-3xl mx-auto">
            {status && !inflight && (
              <div className="mb-2 text-xxs text-[var(--color-text-muted)]">{status}</div>
            )}
            <div className="relative rounded-xl border border-[var(--glass-border)] focus-within:border-[var(--color-border-strong)] bg-[var(--glass-bg)] transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(input)
                  }
                }}
                placeholder="Ask about a mechanism, propose a study design, request citations…"
                rows={Math.min(6, Math.max(1, input.split('\n').length))}
                className="w-full bg-transparent resize-none px-4 py-3 pr-14 text-sm leading-relaxed focus:outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
                aria-label="Message composer"
              />
              {inflight ? (
                <button
                  onClick={cancel}
                  className="absolute right-2 bottom-2 p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] border border-[var(--glass-border)]"
                  aria-label="Stop generation"
                  title="Stop generation"
                >
                  <FiStopCircle className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="absolute right-2 bottom-2 p-2 rounded-lg disabled:opacity-40 text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] border border-[var(--glass-border)]"
                  aria-label="Send message"
                  title="Send message (⏎)"
                >
                  <FiSend className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex justify-between items-center text-xxs text-[var(--color-text-muted)]">
              <span>Enter to send · Shift+Enter for newline</span>
              {current?.agent_config && (
                <span>
                  {current.agent_config.model} · T={current.agent_config.temperature}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Agent config panel */}
      {current && (
        <AgentConfigPanel
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          config={current.agent_config}
          onChange={updateConfig}
        />
      )}

      {/* Project picker modal */}
      {projectPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          aria-modal="true"
          aria-label="Pick project"
          {...modalBackdropProps(() => setProjectPickerOpen(false))}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div onClick={e => e.stopPropagation()} className="relative w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-solid)] p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-xxs uppercase tracking-wider text-[var(--color-text-muted)] mb-0.5">Select active project</div>
                <div className="text-sm" style={{ color: 'var(--color-text)' }}>
                  Hypotheses saved from this conversation will attach to the selected project.
                </div>
              </div>
              <button onClick={() => setProjectPickerOpen(false)} aria-label="Close" className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {projects.length === 0 ? (
                <div className="text-xs text-[var(--color-text-muted)] py-4 text-center">
                  No projects yet. <button onClick={() => { setProjectPickerOpen(false); navigate('/projects?new=1') }} className="underline">Create one →</button>
                </div>
              ) : projects.map(p => (
                <button
                  key={p.id}
                  onClick={async () => {
                    setActiveProjectId(p.id)
                    setProjectPickerOpen(false)
                    // Persist to current session too.
                    if (current) {
                      try { await api.updateDiscoverySession(current.id, { project_id: p.id }) } catch { /* ignore */ }
                    }
                    // If there's a pending hypothesis save, complete it.
                    const w = window as unknown as { __pendingHypothesisCard?: Record<string, unknown> }
                    const pending = w.__pendingHypothesisCard
                    if (pending) {
                      await saveHypothesisToProject(pending, p.id)
                      w.__pendingHypothesisCard = undefined
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                    activeProjectId === p.id
                      ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg)] text-[var(--color-text)]'
                      : 'border-[var(--glass-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FiFolder className="w-3.5 h-3.5" />
                    <span className="truncate">{p.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
