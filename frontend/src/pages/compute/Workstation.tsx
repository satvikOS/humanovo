// ═══════════════════════════════════════════════════════════════════════
// Compute Lab — MATLAB/Octave Workstation
// Batch 4a: editor + command window backed by the octaveEngine.
// Batch 4b: adds variable inspector and plot panel on the right rail.
// Later batches add the preset library sidebar and polish.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiPlay, FiSquare, FiUpload, FiDownload, FiTrash2 } from 'react-icons/fi'
import {
  LineChart, Line, ScatterChart, Scatter, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  run as runOctave,
  createWorkspace,
  type Workspace,
  type RunOutput,
  type PlotSpec,
  type MValue,
} from './octaveEngine'
import {
  WORKSTATION_CATEGORIES,
  WORKSTATION_TEMPLATES,
  type WorkstationTemplate,
} from './workstationTemplates'

/* ── Persistence keys ────────────────────────────────────────────────── */
const SCRIPT_KEY = 'compute-workstation-script'
const HISTORY_KEY = 'compute-workstation-history'

const STARTER_SCRIPT = `% MATLAB/Octave Workstation
% Variables persist across runs. Use the command window at the bottom
% for quick expressions; put longer programs up here.

t = linspace(0, 2*pi, 200);
y1 = sin(t);
y2 = cos(t);

plot(t, y1, 'sin');
plot(t, y2, 'cos');
title('Trig demo');
xlabel('t'); ylabel('value');

m = mean(y1);
s = std(y1);
printf('sin: mean = %.4f, std = %.4f\\n', m, s);
`

interface ConsoleEntry {
  id: number
  kind: 'input' | 'output' | 'error'
  text: string
}

let nextEntryId = 1

/* ── Small helpers ───────────────────────────────────────────────────── */
function loadScript(): string {
  try { return localStorage.getItem(SCRIPT_KEY) ?? STARTER_SCRIPT } catch { return STARTER_SCRIPT }
}
function saveScript(src: string) {
  try { localStorage.setItem(SCRIPT_KEY, src) } catch { /* quota */ }
}
function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveHistory(h: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-100))) } catch { /* quota */ }
}

/* ── Variable snapshot (for inspector) ──────────────────────────────── */
interface VarSnapshot {
  name: string
  kind: MValue['kind']
  summary: string
  shape: string
}

function snapshotWorkspace(ws: Workspace): VarSnapshot[] {
  const out: VarSnapshot[] = []
  for (const [name, v] of ws.vars) {
    if (name.startsWith('__')) continue // skip internal (__tic__)
    out.push(describeVar(name, v))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function describeVar(name: string, v: MValue): VarSnapshot {
  switch (v.kind) {
    case 'num':
      return { name, kind: 'num', shape: '1x1', summary: formatScalar(v.v) }
    case 'bool':
      return { name, kind: 'bool', shape: '1x1', summary: v.v ? 'true' : 'false' }
    case 'str':
      return { name, kind: 'str', shape: `1x${v.v.length}`, summary: JSON.stringify(v.v.slice(0, 40)) }
    case 'mat': {
      const shape = `${v.rows}x${v.cols}`
      if (v.rows === 1 && v.cols === 1) return { name, kind: 'mat', shape, summary: formatScalar(v.data[0]) }
      const n = Math.min(4, v.data.length)
      const preview = Array.from(v.data.slice(0, n)).map(formatScalar).join(', ')
      const suffix = v.data.length > n ? ', …' : ''
      return { name, kind: 'mat', shape, summary: `[${preview}${suffix}]` }
    }
    case 'fn':
      return { name, kind: 'fn', shape: `arity ${v.arity}`, summary: `@${v.name}` }
    case 'void':
      return { name, kind: 'void', shape: '—', summary: '—' }
  }
}

function formatScalar(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-4)) return n.toExponential(3)
  if (Number.isInteger(n)) return String(n)
  return n.toPrecision(5).replace(/\.?0+$/, '')
}

/* ── Component ───────────────────────────────────────────────────────── */
export default function Workstation() {
  const [script, setScript] = useState<string>(loadScript)
  const [entries, setEntries] = useState<ConsoleEntry[]>([])
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [plots, setPlots] = useState<PlotSpec[]>([])
  const [activePlot, setActivePlot] = useState(0)
  const [vars, setVars] = useState<VarSnapshot[]>([])
  const [library, setLibrary] = useState<'open' | 'closed'>('open')
  const [libFilter, setLibFilter] = useState('')
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)

  // Single persistent workspace across runs.
  const workspaceRef = useRef<Workspace>(createWorkspace())
  const consoleRef = useRef<HTMLDivElement>(null)

  // Auto-scroll console to bottom on new entries.
  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  // Persist script as user types (debounced via microtask is overkill — 300ms).
  useEffect(() => {
    const h = setTimeout(() => saveScript(script), 300)
    return () => clearTimeout(h)
  }, [script])

  /** Push engine outputs into the console entry list and plot buffer. */
  const appendOutputs = useCallback((outs: RunOutput[]) => {
    const newPlots: PlotSpec[] = []
    setEntries(prev => {
      const next = [...prev]
      for (const o of outs) {
        if (o.kind === 'text' && o.text) {
          next.push({ id: nextEntryId++, kind: 'output', text: o.text })
        } else if (o.kind === 'error') {
          next.push({ id: nextEntryId++, kind: 'error', text: o.text ?? 'error' })
        } else if (o.kind === 'plot' && o.plot) {
          newPlots.push(o.plot)
          const n = o.plot.series.length
          next.push({
            id: nextEntryId++,
            kind: 'output',
            text: `[figure] ${n} series${o.plot.title ? ' — ' + o.plot.title : ''}`,
          })
        }
      }
      return next
    })
    if (newPlots.length > 0) {
      setPlots(prev => {
        const merged = [...prev, ...newPlots]
        setActivePlot(merged.length - 1)
        return merged.slice(-12) // keep last 12 figures
      })
    }
    // Refresh the variable inspector snapshot.
    setVars(snapshotWorkspace(workspaceRef.current))
  }, [])

  const runScript = useCallback(() => {
    if (running) return
    setRunning(true)
    setEntries(prev => [...prev, { id: nextEntryId++, kind: 'input', text: '▶ run script' }])
    // Defer one tick so the UI can paint the "running" state.
    setTimeout(() => {
      try {
        const res = runOctave(script, workspaceRef.current)
        appendOutputs(res.outputs)
      } catch (e: any) {
        setEntries(prev => [...prev, { id: nextEntryId++, kind: 'error', text: String(e?.message ?? e) }])
      } finally {
        setRunning(false)
      }
    }, 0)
  }, [script, running, appendOutputs])

  const runCommand = useCallback((text: string) => {
    const line = text.trim()
    if (!line) return
    setEntries(prev => [...prev, { id: nextEntryId++, kind: 'input', text: `>> ${line}` }])
    const h = [...history, line]
    setHistory(h); saveHistory(h); setHistIdx(null)
    try {
      const res = runOctave(line, workspaceRef.current)
      appendOutputs(res.outputs)
    } catch (e: any) {
      setEntries(prev => [...prev, { id: nextEntryId++, kind: 'error', text: String(e?.message ?? e) }])
    }
    setCmd('')
  }, [history, appendOutputs])

  const onCmdKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); runCommand(cmd); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const idx = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(idx); setCmd(history[idx] ?? '')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx === null) return
      const idx = histIdx + 1
      if (idx >= history.length) { setHistIdx(null); setCmd('') }
      else { setHistIdx(idx); setCmd(history[idx]) }
    }
  }, [cmd, history, histIdx, runCommand])

  const clearConsole = () => setEntries([])
  const resetWorkspace = () => {
    workspaceRef.current = createWorkspace()
    setVars([])
    setPlots([])
    setActivePlot(0)
    setEntries(prev => [...prev, { id: nextEntryId++, kind: 'output', text: '— workspace cleared —' }])
  }

  // Keyboard shortcut: Cmd/Ctrl+Enter inside editor runs the script.
  const onEditorKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runScript() }
  }, [runScript])

  const handleUpload = useCallback((ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => { setScript(String(r.result ?? '')) }
    r.readAsText(f)
    ev.target.value = ''
  }, [])

  const handleDownload = useCallback(() => {
    const blob = new Blob([script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'script.m'
    a.click()
    URL.revokeObjectURL(url)
  }, [script])

  /* ── styles (keyed off Humanovo CSS variables) ─────────────────────── */
  const styles = useMemo<Record<string, React.CSSProperties>>(() => ({
    container: {
      display: 'grid',
      gridTemplateRows: 'auto 1fr auto',
      height: '100%',
      color: 'var(--color-text)',
      background: 'transparent',
      minHeight: 0,
    },
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 16px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
    },
    btn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      fontSize: 12,
      fontWeight: 500,
      color: 'var(--color-text)',
      background: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid var(--glass-border)',
      borderRadius: 6,
      cursor: 'pointer',
      transition: 'background 0.15s, border-color 0.15s',
    },
    btnPrimary: {
      background: 'var(--color-accent-blue)',
      borderColor: 'var(--color-accent-blue)',
      color: '#fff',
    },
    btnGhost: {
      background: 'transparent',
    },
    body: {
      display: 'grid',
      gridTemplateColumns: library === 'open'
        ? '240px minmax(0, 1.3fr) minmax(320px, 1fr)'
        : 'minmax(0, 1.3fr) minmax(320px, 1fr)',
      gridTemplateRows: 'minmax(0, 1.5fr) minmax(0, 1fr)',
      minHeight: 0,
      transition: 'grid-template-columns 180ms ease',
    },
    library: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      borderRight: '1px solid var(--glass-border)',
      background: 'rgba(0, 0, 0, 0.35)',
      overflow: 'hidden',
      gridRow: '1 / -1',
    },
    libraryHeader: {
      padding: '6px 12px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
      fontSize: 11,
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: 'var(--color-text-muted)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    librarySearch: {
      padding: '8px 10px',
      borderBottom: '1px solid var(--glass-border)',
    },
    librarySearchInput: {
      width: '100%',
      background: 'rgba(0,0,0,0.4)',
      border: '1px solid var(--glass-border)',
      borderRadius: 4,
      padding: '4px 8px',
      color: 'var(--color-text)',
      fontSize: 11,
      outline: 'none',
    },
    libraryScroll: {
      flex: 1,
      overflowY: 'auto',
      padding: '6px 0',
    },
    libraryCategory: {
      padding: '6px 12px 2px 12px',
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: 'var(--color-text-muted)',
    },
    libraryItem: {
      display: 'block',
      width: '100%',
      textAlign: 'left' as const,
      padding: '6px 12px',
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text)',
      fontSize: 11.5,
      cursor: 'pointer',
      borderLeft: '2px solid transparent',
    },
    libraryItemActive: {
      background: 'rgba(59, 130, 246, 0.1)',
      borderLeft: '2px solid var(--color-accent-blue)',
      color: 'var(--color-accent-blue)',
    },
    libraryItemDesc: {
      fontSize: 10,
      color: 'var(--color-text-muted)',
      marginTop: 2,
      lineHeight: 1.35,
    },
    editorWrap: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      borderBottom: '1px solid var(--glass-border)',
      borderRight: '1px solid var(--glass-border)',
    },
    editorHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 16px',
      fontSize: 11,
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: 'var(--color-text-muted)',
      background: 'var(--glass-bg)',
    },
    editor: {
      flex: 1,
      resize: 'none',
      outline: 'none',
      border: 'none',
      padding: '12px 16px',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      color: 'var(--color-text)',
      background: 'rgba(0, 0, 0, 0.35)',
      tabSize: 2,
      minHeight: 0,
    },
    rightRail: {
      display: 'grid',
      gridTemplateRows: 'minmax(0, 1fr) auto',
      minHeight: 0,
      borderBottom: '1px solid var(--glass-border)',
      background: 'rgba(0, 0, 0, 0.25)',
    },
    plotPanel: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      borderBottom: '1px solid var(--glass-border)',
    },
    plotBody: {
      flex: 1,
      minHeight: 0,
      padding: 12,
    },
    varPanel: {
      display: 'flex',
      flexDirection: 'column',
      maxHeight: '40%',
      minHeight: 120,
    },
    varList: {
      overflowY: 'auto',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      padding: '4px 8px',
    },
    varRow: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1.2fr)',
      gap: 8,
      padding: '4px 6px',
      borderRadius: 4,
    },
    panelHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 16px',
      fontSize: 11,
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: 'var(--color-text-muted)',
      background: 'var(--glass-bg)',
    },
    console: {
      minHeight: 0,
      overflowY: 'auto',
      padding: '10px 16px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      lineHeight: 1.55,
      background: 'rgba(0, 0, 0, 0.55)',
      gridColumn: library === 'open' ? '2 / -1' : '1 / -1',
    },
    entryInput: { color: 'var(--color-accent-blue)' },
    entryOutput: { color: 'var(--color-text)', whiteSpace: 'pre-wrap' },
    entryError: { color: '#f87171', whiteSpace: 'pre-wrap' },
    cmdBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 16px',
      borderTop: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
    },
    prompt: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      color: 'var(--color-accent-blue)',
    },
    cmd: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: 'var(--color-text)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
    },
  }), [])

  const currentPlot = plots[activePlot] ?? null

  // Filter and group templates for the library sidebar.
  const filteredTemplates = useMemo<WorkstationTemplate[]>(() => {
    const q = libFilter.trim().toLowerCase()
    if (!q) return WORKSTATION_TEMPLATES
    return WORKSTATION_TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    )
  }, [libFilter])

  const groupedTemplates = useMemo(() => {
    const groups: Record<string, WorkstationTemplate[]> = {}
    for (const cat of WORKSTATION_CATEGORIES) groups[cat] = []
    for (const t of filteredTemplates) {
      if (!groups[t.category]) groups[t.category] = []
      groups[t.category].push(t)
    }
    return groups
  }, [filteredTemplates])

  const loadTemplate = useCallback((t: WorkstationTemplate) => {
    setScript(t.code)
    setActiveTemplate(t.id)
  }, [])

  return (
    <div style={styles.container}>
      {/* ─── Toolbar ─────────────────────────────────────────────────── */}
      <div style={styles.toolbar}>
        <button
          style={{ ...styles.btn, ...styles.btnGhost }}
          onClick={() => setLibrary(l => l === 'open' ? 'closed' : 'open')}
          title="Toggle template library"
        >
          {library === 'open' ? 'Hide library' : 'Show library'}
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--glass-border)', margin: '0 4px' }} />

        <button
          style={{ ...styles.btn, ...(running ? {} : styles.btnPrimary) }}
          onClick={runScript}
          disabled={running}
          title="Run script (Ctrl/Cmd + Enter)"
        >
          {running ? <FiSquare /> : <FiPlay />}
          {running ? 'Running…' : 'Run'}
        </button>

        <label style={{ ...styles.btn, ...styles.btnGhost }} title="Upload .m script">
          <FiUpload /> Upload
          <input type="file" accept=".m,.txt" style={{ display: 'none' }} onChange={handleUpload} />
        </label>

        <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={handleDownload} title="Download as .m">
          <FiDownload /> Download
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--glass-border)', margin: '0 4px' }} />

        <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={clearConsole} title="Clear console">
          <FiTrash2 /> Clear console
        </button>
        <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={resetWorkspace} title="Clear all variables">
          Reset workspace
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-muted)' }}>
          MATLAB / Octave compatible · running locally in-browser
        </span>
      </div>

      {/* ─── Library (left) + Editor + Right rail + Console (bottom) ── */}
      <div style={styles.body}>
        {library === 'open' && (
          <div style={styles.library}>
            <div style={styles.libraryHeader}>
              <span>Library · {filteredTemplates.length}</span>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 10 }}
                onClick={() => setLibrary('closed')}
                title="Collapse library"
              >hide</button>
            </div>
            <div style={styles.librarySearch}>
              <input
                style={styles.librarySearchInput}
                placeholder="Search templates…"
                value={libFilter}
                onChange={e => setLibFilter(e.target.value)}
              />
            </div>
            <div style={styles.libraryScroll}>
              {WORKSTATION_CATEGORIES.map(cat => {
                const items = groupedTemplates[cat] ?? []
                if (items.length === 0) return null
                return (
                  <div key={cat}>
                    <div style={styles.libraryCategory}>{cat}</div>
                    {items.map(t => (
                      <button
                        key={t.id}
                        style={{
                          ...styles.libraryItem,
                          ...(activeTemplate === t.id ? styles.libraryItemActive : null),
                        }}
                        onClick={() => loadTemplate(t)}
                        title={t.description}
                      >
                        <div>{t.name}</div>
                        <div style={styles.libraryItemDesc}>{t.description}</div>
                      </button>
                    ))}
                  </div>
                )
              })}
              {filteredTemplates.length === 0 && (
                <div style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 11 }}>
                  No templates match "{libFilter}".
                </div>
              )}
            </div>
          </div>
        )}

        <div style={styles.editorWrap}>
          <div style={styles.editorHeader}>
            <span>Script</span>
            <span style={{ opacity: 0.7 }}>Ctrl/Cmd + Enter to run</span>
          </div>
          <textarea
            style={styles.editor}
            value={script}
            onChange={e => setScript(e.target.value)}
            onKeyDown={onEditorKey}
            spellCheck={false}
          />
        </div>

        <div style={styles.rightRail}>
          <div style={styles.plotPanel}>
            <div style={styles.panelHeader}>
              <span>Figure {plots.length > 0 ? `${activePlot + 1} / ${plots.length}` : ''}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 10 }}
                  disabled={plots.length < 2}
                  onClick={() => setActivePlot(i => Math.max(0, i - 1))}
                >◀</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 10 }}
                  disabled={plots.length < 2}
                  onClick={() => setActivePlot(i => Math.min(plots.length - 1, i + 1))}
                >▶</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 10 }}
                  disabled={plots.length === 0}
                  onClick={() => { setPlots([]); setActivePlot(0) }}
                >clear</button>
              </div>
            </div>
            <div style={styles.plotBody}>
              <PlotView plot={currentPlot} />
            </div>
          </div>

          <div style={styles.varPanel}>
            <div style={styles.panelHeader}>
              <span>Workspace · {vars.length} variable{vars.length === 1 ? '' : 's'}</span>
            </div>
            <div style={styles.varList}>
              {vars.length === 0 && (
                <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '8px 6px' }}>
                  No variables yet. Run a script or enter a command.
                </div>
              )}
              {vars.map(v => (
                <div
                  key={v.name}
                  style={styles.varRow}
                  title={`${v.name}: ${v.kind}  ${v.shape}  ${v.summary}`}
                >
                  <span style={{ color: 'var(--color-accent-blue)' }}>{v.name}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{v.shape}</span>
                  <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.summary}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div ref={consoleRef} style={styles.console}>
          {entries.length === 0 && (
            <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Console ready. Type a command below or hit Run.
            </div>
          )}
          {entries.map(e => (
            <div
              key={e.id}
              style={
                e.kind === 'input' ? styles.entryInput
                : e.kind === 'error' ? styles.entryError
                : styles.entryOutput
              }
            >
              {e.text}
            </div>
          ))}
        </div>
      </div>

      {/* ─── Command line ────────────────────────────────────────────── */}
      <div style={styles.cmdBar}>
        <span style={styles.prompt}>{'>>'}</span>
        <input
          style={styles.cmd}
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={onCmdKey}
          placeholder="Enter a MATLAB/Octave expression (e.g. mean(1:10))"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  )
}

/* ── Plot renderer ───────────────────────────────────────────────────── */
const SERIES_COLORS = ['#3b82f6', '#60a5fa', '#93c5fd', '#2563eb', '#1d4ed8', '#0ea5e9', '#38bdf8', '#7dd3fc']

function PlotView({ plot }: { plot: PlotSpec | null }) {
  if (!plot || plot.series.length === 0) {
    return (
      <div style={{
        height: '100%',
        minHeight: 180,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-muted)',
        fontSize: 12,
        fontStyle: 'italic',
      }}>
        No figure yet. Call plot(x, y) from a script or the command line.
      </div>
    )
  }

  // Decide chart type from first series (mixed types fall back to line).
  const kinds = new Set(plot.series.map(s => s.type))
  const primary = plot.series[0].type
  const kind = kinds.size === 1 ? primary : 'line'

  // Merge all series into a single data frame keyed by x value.
  const xSet = new Set<number>()
  for (const s of plot.series) for (const x of s.x) xSet.add(x)
  const xs = Array.from(xSet).sort((a, b) => a - b)
  const data = xs.map(x => {
    const row: Record<string, number> = { x }
    for (const s of plot.series) {
      const idx = s.x.indexOf(x)
      if (idx >= 0) row[s.name] = s.y[idx]
    }
    return row
  })

  const common = (
    <>
      <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
      <XAxis
        dataKey="x"
        stroke="rgba(255,255,255,0.45)"
        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.65)' }}
        label={plot.xLabel ? { value: plot.xLabel, position: 'insideBottom', offset: -2, fill: 'rgba(255,255,255,0.55)', fontSize: 10 } : undefined}
      />
      <YAxis
        stroke="rgba(255,255,255,0.45)"
        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.65)' }}
        label={plot.yLabel ? { value: plot.yLabel, angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.55)', fontSize: 10 } : undefined}
      />
      <Tooltip
        contentStyle={{
          background: 'rgba(10,10,10,0.92)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 4,
          fontSize: 11,
        }}
      />
      {plot.series.length > 1 && (
        <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }} />
      )}
    </>
  )

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 180 }}>
      {plot.title && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, textAlign: 'center' }}>
          {plot.title}
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'bar' ? (
          <BarChart data={data}>
            {common}
            {plot.series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            ))}
          </BarChart>
        ) : kind === 'scatter' ? (
          <ScatterChart>
            {common}
            {plot.series.map((s, i) => (
              <Scatter
                key={s.name}
                name={s.name}
                data={s.x.map((x, j) => ({ x, [s.name]: s.y[j] }))}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                dataKey={s.name}
              />
            ))}
          </ScatterChart>
        ) : (
          <LineChart data={data}>
            {common}
            {plot.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
