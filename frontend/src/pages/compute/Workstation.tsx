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
const SCRIPT_KEY = 'compute-workstation-script'          // legacy single-script key
const SCRIPTS_KEY = 'compute-workstation-scripts'        // { list, activeId }
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

interface SavedScript { id: string; name: string; code: string }
interface ScriptStore { list: SavedScript[]; activeId: string }

interface ConsoleEntry {
  id: number
  kind: 'input' | 'output' | 'error'
  text: string
}

let nextEntryId = 1
let nextScriptId = 1
const makeScriptId = () => `s${Date.now().toString(36)}${(nextScriptId++).toString(36)}`

/* ── Small helpers ───────────────────────────────────────────────────── */
function loadScripts(): ScriptStore {
  try {
    const raw = localStorage.getItem(SCRIPTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.list) && parsed.list.length > 0) {
        return {
          list: parsed.list.map((s: any) => ({
            id: String(s.id ?? makeScriptId()),
            name: String(s.name ?? 'untitled.m'),
            code: String(s.code ?? ''),
          })),
          activeId: String(parsed.activeId ?? parsed.list[0].id),
        }
      }
    }
    // Migrate legacy single-script storage if present.
    const legacy = localStorage.getItem(SCRIPT_KEY)
    const first: SavedScript = {
      id: makeScriptId(),
      name: 'main.m',
      code: legacy ?? STARTER_SCRIPT,
    }
    if (legacy) { try { localStorage.removeItem(SCRIPT_KEY) } catch { /* quota */ } }
    return { list: [first], activeId: first.id }
  } catch {
    const first: SavedScript = { id: makeScriptId(), name: 'main.m', code: STARTER_SCRIPT }
    return { list: [first], activeId: first.id }
  }
}
function saveScripts(s: ScriptStore) {
  try { localStorage.setItem(SCRIPTS_KEY, JSON.stringify(s)) } catch { /* quota */ }
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

/* ── MATLAB syntax highlighter ───────────────────────────────────────── */
// Produces a flat token list for an overlay <pre> that sits behind the
// textarea. Keeps the tokenizer intentionally tolerant: anything it can't
// classify falls through as 'text' so the whole source is always rendered
// exactly as typed (essential for the transparent-textarea overlay trick).
type HTokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'text'
interface HToken { kind: HTokenKind; text: string }

const MATLAB_KEYWORDS = new Set([
  'if', 'else', 'elseif', 'end', 'endif', 'endfor', 'endwhile', 'endfunction',
  'for', 'while', 'do', 'until', 'break', 'continue',
  'function', 'return', 'switch', 'case', 'otherwise',
  'try', 'catch', 'global', 'persistent',
  'true', 'false',
])

function highlightMatlab(src: string): HToken[] {
  const out: HToken[] = []
  let buf = ''
  const flush = () => { if (buf) { out.push({ kind: 'text', text: buf }); buf = '' } }

  const n = src.length
  let i = 0
  // Tracks the previous non-whitespace char on the current line so we can
  // distinguish a transpose apostrophe (`a'`) from a char-vector literal.
  let prevSig = ''

  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]

    // Block comment %{ ... %}
    if (c === '%' && c2 === '{') {
      flush()
      let j = i + 2
      while (j < n && !(src[j] === '%' && src[j + 1] === '}')) j++
      if (j < n) j += 2
      out.push({ kind: 'comment', text: src.slice(i, j) })
      i = j
      prevSig = ''
      continue
    }

    // Line comment % ... or # ... (Octave accepts both)
    if (c === '%' || c === '#') {
      flush()
      let j = i
      while (j < n && src[j] !== '\n') j++
      out.push({ kind: 'comment', text: src.slice(i, j) })
      i = j
      continue
    }

    // Double-quoted string (Octave + MATLAB R2017+)
    if (c === '"') {
      flush()
      let j = i + 1
      while (j < n) {
        if (src[j] === '"' && src[j + 1] === '"') { j += 2; continue }
        if (src[j] === '"') { j++; break }
        if (src[j] === '\n') break
        j++
      }
      out.push({ kind: 'string', text: src.slice(i, j) })
      i = j
      prevSig = '"'
      continue
    }

    // Single-quoted: either a char-vector or a transpose operator. If the
    // previous significant char is an identifier/number/close-paren, it's
    // a transpose and must be emitted as plain text.
    if (c === "'") {
      if (/[A-Za-z0-9_\)\]\.]/.test(prevSig)) {
        buf += c
        i++
        prevSig = "'"
        continue
      }
      flush()
      let j = i + 1
      while (j < n) {
        if (src[j] === "'" && src[j + 1] === "'") { j += 2; continue }
        if (src[j] === "'") { j++; break }
        if (src[j] === '\n') break
        j++
      }
      out.push({ kind: 'string', text: src.slice(i, j) })
      i = j
      prevSig = "'"
      continue
    }

    // Numbers — integer/float with optional exponent
    if ((c >= '0' && c <= '9') || (c === '.' && c2 >= '0' && c2 <= '9')) {
      flush()
      let j = i
      while (j < n && src[j] >= '0' && src[j] <= '9') j++
      if (src[j] === '.') {
        j++
        while (j < n && src[j] >= '0' && src[j] <= '9') j++
      }
      if (src[j] === 'e' || src[j] === 'E') {
        j++
        if (src[j] === '+' || src[j] === '-') j++
        while (j < n && src[j] >= '0' && src[j] <= '9') j++
      }
      if (src[j] === 'i' || src[j] === 'j') j++ // imaginary suffix
      out.push({ kind: 'number', text: src.slice(i, j) })
      i = j
      prevSig = '0'
      continue
    }

    // Identifiers / keywords
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i + 1
      while (j < n) {
        const ch = src[j]
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_') j++
        else break
      }
      const word = src.slice(i, j)
      if (MATLAB_KEYWORDS.has(word)) {
        flush()
        out.push({ kind: 'keyword', text: word })
      } else {
        buf += word
      }
      i = j
      prevSig = 'a'
      continue
    }

    // Whitespace / newlines don't change prevSig (we want `a '` to still
    // be read as transpose), but newline resets it.
    if (c === '\n') {
      buf += c
      prevSig = ''
      i++
      continue
    }
    if (c === ' ' || c === '\t') {
      buf += c
      i++
      continue
    }

    // Everything else is punctuation/operator text.
    buf += c
    prevSig = c
    i++
  }
  flush()
  return out
}

const HL_COLORS: Record<HTokenKind, React.CSSProperties> = {
  comment: { color: 'var(--color-text-muted)', fontStyle: 'italic' },
  string:  { color: 'var(--color-text-secondary)' },
  number:  { color: 'var(--color-text-secondary)' },
  keyword: { color: 'var(--color-text)', fontWeight: 600 },
  text:    { color: 'var(--color-text)' },
}

/* ── Component ───────────────────────────────────────────────────────── */
export default function Workstation() {
  const [scriptStore, setScriptStore] = useState<ScriptStore>(loadScripts)
  const activeScript = useMemo(
    () => scriptStore.list.find(s => s.id === scriptStore.activeId) ?? scriptStore.list[0],
    [scriptStore]
  )
  const script = activeScript?.code ?? ''
  const setScript = useCallback((next: string | ((prev: string) => string)) => {
    setScriptStore(store => {
      const current = store.list.find(s => s.id === store.activeId)
      if (!current) return store
      const nextCode = typeof next === 'function' ? (next as (p: string) => string)(current.code) : next
      if (nextCode === current.code) return store
      return {
        ...store,
        list: store.list.map(s => s.id === store.activeId ? { ...s, code: nextCode } : s),
      }
    })
  }, [])
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
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 })
  const [lastRunMs, setLastRunMs] = useState<number | null>(null)

  // Find & replace state. `findOpen` toggles the slim bar above the editor.
  // `matchIdx` is the index of the currently highlighted match in `matches`.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)

  // Single persistent workspace across runs.
  const workspaceRef = useRef<Workspace>(createWorkspace())
  const consoleRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)

  // Memoized token stream for the syntax-highlighting overlay. Recomputes
  // on every keystroke; the tokenizer is O(n) and cheap enough for scripts
  // up to a few thousand lines.
  const highlightTokens = useMemo(() => highlightMatlab(script), [script])

  // Auto-scroll console to bottom on new entries.
  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  // Persist script store as the user edits (debounced).
  useEffect(() => {
    const h = setTimeout(() => saveScripts(scriptStore), 300)
    return () => clearTimeout(h)
  }, [scriptStore])

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
      const t0 = performance.now()
      try {
        const res = runOctave(script, workspaceRef.current)
        appendOutputs(res.outputs)
      } catch (e: any) {
        setEntries(prev => [...prev, { id: nextEntryId++, kind: 'error', text: String(e?.message ?? e) }])
      } finally {
        setLastRunMs(performance.now() - t0)
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

  // Open the find panel, seeding it with the current selection if any.
  const openFind = useCallback(() => {
    setFindOpen(true)
    const ta = editorRef.current
    if (ta) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd)
      if (sel && !sel.includes('\n')) setFindQuery(sel)
    }
    requestAnimationFrame(() => { findInputRef.current?.focus(); findInputRef.current?.select() })
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    editorRef.current?.focus()
  }, [])

  // Keyboard shortcuts inside the editor:
  //   Cmd/Ctrl+Enter  — run script
  //   Cmd/Ctrl+F      — find / replace panel
  //   Tab / Shift+Tab — indent / outdent current selection (2 spaces)
  //   Enter           — auto-indent to match the previous line
  const onEditorKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      runScript()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault()
      openFind()
      return
    }
    const ta = e.currentTarget
    const { selectionStart: s, selectionEnd: ePos, value } = ta

    if (e.key === 'Tab') {
      e.preventDefault()
      if (s !== ePos) {
        // Multi-line indent / outdent on the selection range
        const lineStart = value.lastIndexOf('\n', s - 1) + 1
        const before = value.slice(0, lineStart)
        const middle = value.slice(lineStart, ePos)
        const after = value.slice(ePos)
        if (e.shiftKey) {
          const dedented = middle.replace(/^ {1,2}/gm, '')
          const newVal = before + dedented + after
          setScript(newVal)
          requestAnimationFrame(() => {
            ta.selectionStart = lineStart
            ta.selectionEnd = lineStart + dedented.length
          })
        } else {
          const indented = middle.replace(/^/gm, '  ')
          const newVal = before + indented + after
          setScript(newVal)
          requestAnimationFrame(() => {
            ta.selectionStart = lineStart
            ta.selectionEnd = lineStart + indented.length
          })
        }
        return
      }
      // Cursor insert: simple 2-space indent
      const newVal = value.slice(0, s) + '  ' + value.slice(ePos)
      setScript(newVal)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2
      })
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // Copy leading whitespace of the current line to the new one.
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const currentLine = value.slice(lineStart, s)
      const m = currentLine.match(/^\s*/)
      const indent = m ? m[0] : ''
      if (!indent) return // let default handle it
      e.preventDefault()
      const newVal = value.slice(0, s) + '\n' + indent + value.slice(ePos)
      setScript(newVal)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 1 + indent.length
      })
    }
  }, [runScript, openFind, setScript])

  // Track cursor position for the status bar.
  const updateCursor = useCallback((ta: HTMLTextAreaElement) => {
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const line = (before.match(/\n/g)?.length ?? 0) + 1
    const col = pos - before.lastIndexOf('\n')
    setCursor({ line, col })
  }, [])

  const onEditorSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    updateCursor(e.currentTarget)
  }, [updateCursor])

  const onEditorScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-scrollTop}px)`
    }
    if (highlightRef.current) {
      highlightRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
    }
  }, [])

  // Case-insensitive substring match positions for find/replace. Recomputed
  // whenever the script or query changes; kept as plain offsets so we can
  // map them straight to textarea selections.
  const findMatches = useMemo<number[]>(() => {
    if (!findQuery) return []
    const hay = script.toLowerCase()
    const needle = findQuery.toLowerCase()
    const out: number[] = []
    let from = 0
    while (from <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, from)
      if (idx < 0) break
      out.push(idx)
      from = idx + Math.max(1, needle.length)
    }
    return out
  }, [script, findQuery])

  // Keep matchIdx in range as matches shift.
  useEffect(() => {
    if (findMatches.length === 0) { setMatchIdx(0); return }
    if (matchIdx >= findMatches.length) setMatchIdx(0)
  }, [findMatches, matchIdx])

  const selectMatch = useCallback((idx: number) => {
    const ta = editorRef.current
    if (!ta || findMatches.length === 0) return
    const safe = ((idx % findMatches.length) + findMatches.length) % findMatches.length
    const start = findMatches[safe]
    const end = start + findQuery.length
    ta.focus()
    ta.setSelectionRange(start, end)
    // Scroll the match into view by approximating line height.
    const lineHeight = 12 * 1.6
    const lineOfMatch = (script.slice(0, start).match(/\n/g)?.length ?? 0)
    ta.scrollTop = Math.max(0, lineOfMatch * lineHeight - ta.clientHeight / 2)
    setMatchIdx(safe)
  }, [findMatches, findQuery, script])

  const findNext = useCallback(() => selectMatch(matchIdx + 1), [selectMatch, matchIdx])
  const findPrev = useCallback(() => selectMatch(matchIdx - 1), [selectMatch, matchIdx])

  const replaceOne = useCallback(() => {
    if (findMatches.length === 0 || !findQuery) return
    const safe = Math.min(matchIdx, findMatches.length - 1)
    const start = findMatches[safe]
    const end = start + findQuery.length
    const next = script.slice(0, start) + replaceQuery + script.slice(end)
    setScript(next)
    // After the state update lands, highlight the next occurrence (or stay
    // in place if none remain).
    requestAnimationFrame(() => {
      const ta = editorRef.current
      if (!ta) return
      const pos = start + replaceQuery.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }, [findMatches, findQuery, matchIdx, replaceQuery, script, setScript])

  const replaceAll = useCallback(() => {
    if (findMatches.length === 0 || !findQuery) return
    // Case-insensitive global replace without touching case elsewhere.
    const esc = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(esc, 'gi')
    setScript(script.replace(re, replaceQuery))
  }, [findMatches, findQuery, replaceQuery, script, setScript])

  const lineCount = useMemo(() => script.split('\n').length, [script])

  const handleUpload = useCallback((ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]
    if (!f) return
    const fname = f.name
    const r = new FileReader()
    r.onload = () => {
      const code = String(r.result ?? '')
      // Create a new script tab from the uploaded file.
      setScriptStore(store => {
        const id = makeScriptId()
        return {
          list: [...store.list, { id, name: fname || 'upload.m', code }],
          activeId: id,
        }
      })
    }
    r.readAsText(f)
    ev.target.value = ''
  }, [])

  const handleDownload = useCallback(() => {
    const blob = new Blob([script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activeScript?.name || 'script.m'
    a.click()
    URL.revokeObjectURL(url)
  }, [script, activeScript])

  /* ── Script tab handlers ─────────────────────────────────────────── */
  const newScript = useCallback(() => {
    setScriptStore(store => {
      const id = makeScriptId()
      // Pick a unique default name.
      const base = 'untitled'
      let n = 1
      while (store.list.some(s => s.name === `${base}${n}.m`)) n++
      return {
        list: [...store.list, { id, name: `${base}${n}.m`, code: '% New script\n' }],
        activeId: id,
      }
    })
  }, [])

  const switchScript = useCallback((id: string) => {
    setScriptStore(store => store.activeId === id ? store : { ...store, activeId: id })
  }, [])

  const closeScript = useCallback((id: string) => {
    setScriptStore(store => {
      if (store.list.length <= 1) return store // never close the last one
      const idx = store.list.findIndex(s => s.id === id)
      if (idx < 0) return store
      const list = store.list.filter(s => s.id !== id)
      const activeId = store.activeId === id
        ? (list[idx] ?? list[idx - 1] ?? list[0]).id
        : store.activeId
      return { list, activeId }
    })
  }, [])

  const renameScript = useCallback((id: string) => {
    const current = scriptStore.list.find(s => s.id === id)
    if (!current) return
    const next = prompt('Rename script', current.name)
    if (!next) return
    setScriptStore(store => ({
      ...store,
      list: store.list.map(s => s.id === id ? { ...s, name: next } : s),
    }))
  }, [scriptStore])

  /* ── styles (keyed off Humanovo CSS variables) ─────────────────────── */
  const styles = useMemo<Record<string, React.CSSProperties>>(() => ({
    container: {
      display: 'grid',
      gridTemplateRows: 'auto 1fr auto auto',
      height: '100%',
      color: 'var(--color-text)',
      background: 'transparent',
      minHeight: 0,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    },
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '10px 20px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'transparent',
    },
    btn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      fontSize: 12,
      fontWeight: 500,
      color: 'var(--color-text-secondary)',
      background: 'transparent',
      border: '1px solid var(--glass-border)',
      borderRadius: 6,
      cursor: 'pointer',
      transition: 'background 0.15s, border-color 0.15s, color 0.15s',
    },
    btnPrimary: {
      color: 'var(--color-text)',
      background: 'var(--glass-bg-hover)',
      borderColor: 'var(--color-border-strong)',
    },
    btnGhost: {
      background: 'transparent',
      border: '1px solid transparent',
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
      background: 'transparent',
      overflow: 'hidden',
      gridRow: '1 / -1',
    },
    libraryHeader: {
      padding: '10px 16px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'transparent',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--color-text)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    librarySearch: {
      padding: '8px 12px',
      borderBottom: '1px solid var(--glass-border)',
    },
    librarySearchInput: {
      width: '100%',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 6,
      padding: '6px 10px',
      color: 'var(--color-text)',
      fontSize: 12,
      outline: 'none',
    },
    libraryScroll: {
      flex: 1,
      overflowY: 'auto',
      padding: '8px 0',
    },
    libraryCategory: {
      padding: '10px 16px 4px 16px',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--color-text-muted)',
    },
    libraryItem: {
      display: 'block',
      width: '100%',
      textAlign: 'left' as const,
      padding: '6px 16px',
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-secondary)',
      fontSize: 12,
      cursor: 'pointer',
      borderLeft: '2px solid transparent',
      transition: 'background 0.15s, color 0.15s',
    },
    libraryItemActive: {
      background: 'var(--glass-bg-hover)',
      borderLeft: '2px solid var(--color-text)',
      color: 'var(--color-text)',
    },
    libraryItemDesc: {
      fontSize: 11,
      color: 'var(--color-text-muted)',
      marginTop: 2,
      lineHeight: 1.4,
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
      padding: '10px 16px',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--color-text)',
      background: 'transparent',
      borderBottom: '1px solid var(--glass-border)',
    },
    tabBar: {
      display: 'flex',
      alignItems: 'stretch',
      gap: 0,
      padding: '0 8px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'transparent',
      minHeight: 30,
      overflowX: 'auto' as const,
    },
    tab: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      fontSize: 12,
      fontFamily: "'JetBrains Mono', monospace",
      color: 'var(--color-text-muted)',
      background: 'transparent',
      border: 'none',
      borderBottom: '2px solid transparent',
      cursor: 'pointer',
      whiteSpace: 'nowrap' as const,
      transition: 'color 0.15s',
    },
    tabActive: {
      color: 'var(--color-text)',
      background: 'transparent',
      borderBottom: '2px solid var(--color-text)',
    },
    tabCloseBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 14,
      height: 14,
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-muted)',
      cursor: 'pointer',
      fontSize: 12,
      lineHeight: 1,
      borderRadius: 3,
      padding: 0,
    },
    tabAddBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 12px',
      fontSize: 14,
      color: 'var(--color-text-muted)',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
    },
    editorBody: {
      flex: 1,
      display: 'flex',
      minHeight: 0,
      background: 'transparent',
    },
    editorGutterClip: {
      flex: '0 0 auto',
      width: 44,
      overflow: 'hidden',
      background: 'transparent',
      borderRight: '1px solid var(--glass-border)',
      position: 'relative' as const,
    },
    editorGutterNumbers: {
      padding: '14px 8px 14px 0',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 12,
      lineHeight: 1.6,
      color: 'var(--color-text-muted)',
      textAlign: 'right' as const,
      userSelect: 'none' as const,
      whiteSpace: 'pre',
      willChange: 'transform',
    },
    findBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
    },
    findInput: {
      background: 'var(--glass-bg-hover)',
      border: '1px solid var(--glass-border)',
      borderRadius: 4,
      padding: '4px 8px',
      color: 'var(--color-text)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      outline: 'none',
      width: 180,
    },
    findCount: {
      fontSize: 11,
      fontFamily: "'JetBrains Mono', monospace",
      color: 'var(--color-text-muted)',
      minWidth: 48,
      textAlign: 'center' as const,
    },
    editorTextWrap: {
      position: 'relative' as const,
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      overflow: 'hidden',
    },
    editorHighlight: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      margin: 0,
      padding: '14px 16px 14px 14px',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 12,
      lineHeight: 1.6,
      whiteSpace: 'pre' as const,
      pointerEvents: 'none' as const,
      willChange: 'transform',
      tabSize: 2,
      color: 'var(--color-text)',
      background: 'transparent',
    },
    editor: {
      position: 'absolute' as const,
      inset: 0,
      width: '100%',
      height: '100%',
      resize: 'none',
      outline: 'none',
      border: 'none',
      padding: '14px 16px 14px 14px',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 12,
      lineHeight: 1.6,
      color: 'transparent',
      caretColor: 'var(--color-text)',
      background: 'transparent',
      tabSize: 2,
      minHeight: 0,
      whiteSpace: 'pre' as const,
      overflowWrap: 'normal' as const,
      wordBreak: 'normal' as const,
      overflow: 'auto' as const,
    },
    statusBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '6px 20px',
      borderTop: '1px solid var(--glass-border)',
      background: 'transparent',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: 'var(--color-text-muted)',
    },
    rightRail: {
      display: 'grid',
      gridTemplateRows: 'minmax(0, 1fr) auto',
      minHeight: 0,
      borderBottom: '1px solid var(--glass-border)',
      background: 'transparent',
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
      padding: 14,
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
      padding: '6px 10px',
    },
    varRow: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1.2fr)',
      gap: 10,
      padding: '5px 6px',
      borderRadius: 4,
    },
    panelHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 16px',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--color-text)',
      background: 'transparent',
      borderBottom: '1px solid var(--glass-border)',
    },
    console: {
      minHeight: 0,
      overflowY: 'auto',
      padding: '12px 20px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      lineHeight: 1.6,
      background: 'transparent',
      gridColumn: library === 'open' ? '2 / -1' : '1 / -1',
      borderTop: '1px solid var(--glass-border)',
    },
    entryInput: { color: 'var(--color-text)', fontWeight: 500 },
    entryOutput: { color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' },
    entryError: { color: 'var(--color-error)', whiteSpace: 'pre-wrap' },
    cmdBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 20px',
      borderTop: '1px solid var(--glass-border)',
      background: 'transparent',
    },
    prompt: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      color: 'var(--color-text-muted)',
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
  }), [library])

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
    // If the active script is empty or already matches this template, replace
    // in place. Otherwise open the template as a new tab so user work is safe.
    setScriptStore(store => {
      const current = store.list.find(s => s.id === store.activeId)
      const inPlace = !current || current.code.trim() === '' || current.code === t.code
      if (inPlace && current) {
        return {
          ...store,
          list: store.list.map(s => s.id === store.activeId ? { ...s, code: t.code, name: `${t.id}.m` } : s),
        }
      }
      const id = makeScriptId()
      return {
        list: [...store.list, { id, name: `${t.id}.m`, code: t.code }],
        activeId: id,
      }
    })
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

        <div style={{ width: 1, height: 18, background: 'var(--glass-border)', margin: '0 6px' }} />

        <button
          style={{ ...styles.btn, ...styles.btnPrimary }}
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

        <div style={{ width: 1, height: 18, background: 'var(--glass-border)', margin: '0 6px' }} />

        <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={clearConsole} title="Clear console">
          <FiTrash2 /> Clear console
        </button>
        <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={resetWorkspace} title="Clear all variables">
          Reset workspace
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-muted)' }}>
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
                style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
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
                <div style={{ padding: '12px 16px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                  No templates match "{libFilter}".
                </div>
              )}
            </div>
          </div>
        )}

        <div style={styles.editorWrap}>
          <div style={styles.editorHeader}>
            <span>Scripts</span>
            <span style={{ opacity: 0.7 }}>Ctrl/Cmd + Enter to run · Ctrl/Cmd + F to find · Tab to indent</span>
          </div>
          <div style={styles.tabBar}>
            {scriptStore.list.map(s => {
              const active = s.id === scriptStore.activeId
              return (
                <button
                  key={s.id}
                  style={{ ...styles.tab, ...(active ? styles.tabActive : null) }}
                  onClick={() => switchScript(s.id)}
                  onDoubleClick={() => renameScript(s.id)}
                  title={`${s.name} — double-click to rename`}
                >
                  <span>{s.name}</span>
                  {scriptStore.list.length > 1 && (
                    <span
                      style={styles.tabCloseBtn}
                      onClick={e => { e.stopPropagation(); closeScript(s.id) }}
                      role="button"
                      aria-label={`Close ${s.name}`}
                    >×</span>
                  )}
                </button>
              )
            })}
            <button style={styles.tabAddBtn} onClick={newScript} title="New script">+</button>
          </div>
          {findOpen && (
            <div style={styles.findBar}>
              <input
                ref={findInputRef}
                style={styles.findInput}
                value={findQuery}
                onChange={e => setFindQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); closeFind() }
                  else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (e.shiftKey) findPrev(); else findNext()
                  }
                }}
                placeholder="Find"
                spellCheck={false}
                autoComplete="off"
              />
              <input
                style={styles.findInput}
                value={replaceQuery}
                onChange={e => setReplaceQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); closeFind() }
                  else if (e.key === 'Enter') { e.preventDefault(); replaceOne() }
                }}
                placeholder="Replace"
                spellCheck={false}
                autoComplete="off"
              />
              <span style={styles.findCount}>
                {findMatches.length === 0
                  ? (findQuery ? '0 / 0' : '')
                  : `${Math.min(matchIdx + 1, findMatches.length)} / ${findMatches.length}`}
              </span>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11 }}
                onClick={findPrev}
                disabled={findMatches.length === 0}
                title="Previous match (Shift+Enter)"
              >↑</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11 }}
                onClick={findNext}
                disabled={findMatches.length === 0}
                title="Next match (Enter)"
              >↓</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11 }}
                onClick={replaceOne}
                disabled={findMatches.length === 0}
                title="Replace current match"
              >Replace</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11 }}
                onClick={replaceAll}
                disabled={findMatches.length === 0}
                title="Replace all matches"
              >Replace all</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11, marginLeft: 'auto' }}
                onClick={closeFind}
                title="Close (Esc)"
              >×</button>
            </div>
          )}
          <div style={styles.editorBody}>
            <div style={styles.editorGutterClip} aria-hidden>
              <div ref={gutterRef} style={styles.editorGutterNumbers}>
                {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
              </div>
            </div>
            <div style={styles.editorTextWrap}>
              <pre ref={highlightRef} style={styles.editorHighlight} aria-hidden="true">
                {highlightTokens.map((t, idx) => (
                  <span key={idx} style={HL_COLORS[t.kind]}>{t.text}</span>
                ))}
                {/* Trailing newline so the last line is still visible when the
                    user's cursor is on it. */}
                {'\n'}
              </pre>
              <textarea
                ref={editorRef}
                style={styles.editor}
                value={script}
                onChange={e => { setScript(e.target.value); updateCursor(e.target) }}
                onKeyDown={onEditorKey}
                onKeyUp={onEditorSelect}
                onClick={onEditorSelect}
                onScroll={onEditorScroll}
                spellCheck={false}
                wrap="off"
              />
            </div>
          </div>
        </div>

        <div style={styles.rightRail}>
          <div style={styles.plotPanel}>
            <div style={styles.panelHeader}>
              <span>Figure {plots.length > 0 ? `${activePlot + 1} / ${plots.length}` : ''}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                  disabled={plots.length < 2}
                  onClick={() => setActivePlot(i => Math.max(0, i - 1))}
                >◀</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                  disabled={plots.length < 2}
                  onClick={() => setActivePlot(i => Math.min(plots.length - 1, i + 1))}
                >▶</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
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
                <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '10px 6px', fontSize: 12 }}>
                  No variables yet. Run a script or enter a command.
                </div>
              )}
              {vars.map(v => (
                <div
                  key={v.name}
                  style={styles.varRow}
                  title={`${v.name}: ${v.kind}  ${v.shape}  ${v.summary}`}
                >
                  <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{v.name}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{v.shape}</span>
                  <span style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.summary}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div ref={consoleRef} style={styles.console}>
          {entries.length === 0 && (
            <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
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

      {/* ─── Status bar ──────────────────────────────────────────────── */}
      <div style={styles.statusBar}>
        <span>Ln {cursor.line}, Col {cursor.col}</span>
        <span>·</span>
        <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>{vars.length} var{vars.length === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>{plots.length} figure{plots.length === 1 ? '' : 's'}</span>
        <span style={{ marginLeft: 'auto' }}>
          {lastRunMs !== null
            ? `last run ${lastRunMs < 1000 ? lastRunMs.toFixed(1) + ' ms' : (lastRunMs / 1000).toFixed(2) + ' s'}`
            : 'ready'}
        </span>
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
// Monochrome palette — matches the rest of the Humanovo platform. Shades
// step down so multiple series remain distinguishable without introducing
// category colors.
const SERIES_COLORS = ['#ededed', '#a1a1a1', '#d4d4d4', '#737373', '#8a8a8a', '#bfbfbf', '#525252', '#e5e5e5']

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
        fontFamily: "'Inter', system-ui, sans-serif",
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
      <CartesianGrid stroke="var(--glass-border)" strokeDasharray="3 3" />
      <XAxis
        dataKey="x"
        stroke="var(--glass-border)"
        tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
        label={plot.xLabel ? { value: plot.xLabel, position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 11 } : undefined}
      />
      <YAxis
        stroke="var(--glass-border)"
        tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
        label={plot.yLabel ? { value: plot.yLabel, angle: -90, position: 'insideLeft', fill: 'var(--color-text-muted)', fontSize: 11 } : undefined}
      />
      <Tooltip
        contentStyle={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--glass-border)',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--color-text)',
        }}
      />
      {plot.series.length > 1 && (
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-text-secondary)' }} />
      )}
    </>
  )

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 180 }}>
      {plot.title && (
        <div style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          marginBottom: 6,
          textAlign: 'center',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
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
