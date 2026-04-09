// ═══════════════════════════════════════════════════════════════════════
// Compute Lab — MATLAB/Octave Workstation
// Batch 4a: editor + command window backed by the octaveEngine.
// Later batches add the variable inspector, plot panel, and preset library.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiPlay, FiSquare, FiUpload, FiDownload, FiTrash2 } from 'react-icons/fi'
import {
  run as runOctave,
  createWorkspace,
  type Workspace,
  type RunOutput,
} from './octaveEngine'

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

/* ── Component ───────────────────────────────────────────────────────── */
export default function Workstation() {
  const [script, setScript] = useState<string>(loadScript)
  const [entries, setEntries] = useState<ConsoleEntry[]>([])
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [histIdx, setHistIdx] = useState<number | null>(null)

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

  /** Push engine outputs into the console entry list. */
  const appendOutputs = useCallback((outs: RunOutput[]) => {
    setEntries(prev => {
      const next = [...prev]
      for (const o of outs) {
        if (o.kind === 'text' && o.text) {
          next.push({ id: nextEntryId++, kind: 'output', text: o.text })
        } else if (o.kind === 'error') {
          next.push({ id: nextEntryId++, kind: 'error', text: o.text ?? 'error' })
        } else if (o.kind === 'plot') {
          // Plot capture arrives here — rendering panel lands in Batch 4b.
          // For now announce it in the console so the user has feedback.
          const n = o.plot?.series.length ?? 0
          next.push({
            id: nextEntryId++,
            kind: 'output',
            text: `[plot] ${n} series captured${o.plot?.title ? ' — ' + o.plot.title : ''}`,
          })
        }
      }
      return next
    })
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
      gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
      gap: 0,
      minHeight: 0,
    },
    editorWrap: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      borderBottom: '1px solid var(--glass-border)',
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
    console: {
      minHeight: 0,
      overflowY: 'auto',
      padding: '10px 16px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      lineHeight: 1.55,
      background: 'rgba(0, 0, 0, 0.55)',
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

  return (
    <div style={styles.container}>
      {/* ─── Toolbar ─────────────────────────────────────────────────── */}
      <div style={styles.toolbar}>
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

      {/* ─── Editor + Console ────────────────────────────────────────── */}
      <div style={styles.body}>
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
