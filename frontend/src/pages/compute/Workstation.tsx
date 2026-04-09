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
import { BUILTIN_CATEGORIES, BUILTIN_DOCS, type BuiltinDoc } from './builtinDocs'

/* ── Persistence keys ────────────────────────────────────────────────── */
const SCRIPT_KEY = 'compute-workstation-script'          // legacy single-script key
const SCRIPTS_KEY = 'compute-workstation-scripts'        // { list, activeId }
const HISTORY_KEY = 'compute-workstation-history'
const WORKSPACE_KEY = 'compute-workstation-workspace-v1' // serialized vars

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
  /** Optional 1-based source line for click-to-jump on error entries. */
  line?: number
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

/* ── Workspace persistence ──────────────────────────────────────────────
 * Serializes the user's variables (excluding closures and engine
 * internals like __tic__) so they survive a page refresh. We hard-cap
 * total bytes so a runaway 1e8-element matrix can't destroy the
 * localStorage quota — past that limit we just save what fits.
 */
const WORKSPACE_BUDGET_BYTES = 1_500_000

interface SerialMValue {
  kind: 'num' | 'bool' | 'str' | 'mat'
  v?: number | string | boolean
  rows?: number
  cols?: number
  data?: number[]
}

function serializeMValue(v: MValue): SerialMValue | null {
  switch (v.kind) {
    case 'num':  return { kind: 'num',  v: v.v }
    case 'bool': return { kind: 'bool', v: v.v }
    case 'str':  return { kind: 'str',  v: v.v }
    case 'mat':  return { kind: 'mat',  rows: v.rows, cols: v.cols, data: Array.from(v.data) }
    case 'fn':
    case 'void': return null
  }
}

function deserializeMValue(s: SerialMValue): MValue | null {
  if (!s || typeof s.kind !== 'string') return null
  switch (s.kind) {
    case 'num':  return typeof s.v === 'number'  ? { kind: 'num',  v: s.v } : null
    case 'bool': return typeof s.v === 'boolean' ? { kind: 'bool', v: s.v } : null
    case 'str':  return typeof s.v === 'string'  ? { kind: 'str',  v: s.v } : null
    case 'mat': {
      if (typeof s.rows !== 'number' || typeof s.cols !== 'number' || !Array.isArray(s.data)) return null
      if (s.rows * s.cols !== s.data.length) return null
      return { kind: 'mat', rows: s.rows, cols: s.cols, data: Float64Array.from(s.data) }
    }
    default: return null
  }
}

function saveWorkspace(ws: Workspace) {
  try {
    const out: Record<string, SerialMValue> = {}
    let bytes = 0
    for (const [name, v] of ws.vars) {
      if (name.startsWith('__')) continue
      const s = serializeMValue(v)
      if (!s) continue
      // Cheap byte estimate; for matrices it's dominated by data length.
      const est = name.length + 16 + (s.data ? s.data.length * 9 : 32)
      if (bytes + est > WORKSPACE_BUDGET_BYTES) break
      bytes += est
      out[name] = s
    }
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ vars: out }))
  } catch { /* quota / serialization fail — silently drop */ }
}

function loadWorkspaceInto(ws: Workspace) {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.vars !== 'object') return
    for (const [name, ser] of Object.entries(parsed.vars)) {
      const v = deserializeMValue(ser as SerialMValue)
      if (v) ws.vars.set(name, v)
    }
  } catch { /* corrupted — ignore */ }
}

function clearSavedWorkspace() {
  try { localStorage.removeItem(WORKSPACE_KEY) } catch { /* quota */ }
}

/* ── Variable snapshot (for inspector) ──────────────────────────────── */
interface VarSnapshot {
  name: string
  kind: MValue['kind']
  summary: string
  shape: string
  /** Full value retained so the inspector can render expanded contents. */
  value: MValue
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
      return { name, kind: 'num', shape: '1x1', summary: formatScalar(v.v), value: v }
    case 'bool':
      return { name, kind: 'bool', shape: '1x1', summary: v.v ? 'true' : 'false', value: v }
    case 'str':
      return { name, kind: 'str', shape: `1x${v.v.length}`, summary: JSON.stringify(v.v.slice(0, 40)), value: v }
    case 'mat': {
      const shape = `${v.rows}x${v.cols}`
      if (v.rows === 1 && v.cols === 1) return { name, kind: 'mat', shape, summary: formatScalar(v.data[0]), value: v }
      const n = Math.min(4, v.data.length)
      const preview = Array.from(v.data.slice(0, n)).map(formatScalar).join(', ')
      const suffix = v.data.length > n ? ', …' : ''
      return { name, kind: 'mat', shape, summary: `[${preview}${suffix}]`, value: v }
    }
    case 'fn':
      return { name, kind: 'fn', shape: `arity ${v.arity}`, summary: `@${v.name}`, value: v }
    case 'void':
      return { name, kind: 'void', shape: '—', summary: '—', value: v }
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

// Build a per-character mask of positions that fall inside a MATLAB
// comment (%…\n) or a string literal so bracket-matching can skip them.
// The transpose heuristic mirrors the syntax-highlighter so `a'` is read
// as transpose, not as an unterminated string.
function maskCommentsAndStrings(src: string): Uint8Array {
  const m = new Uint8Array(src.length)
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '%') {
      while (i < src.length && src[i] !== '\n') { m[i] = 1; i++ }
      continue
    }
    if (c === '"') {
      m[i] = 1; i++
      while (i < src.length && src[i] !== '"') { m[i] = 1; i++ }
      if (i < src.length) { m[i] = 1; i++ }
      continue
    }
    if (c === "'") {
      const prev = src[i - 1] ?? ''
      if (/[A-Za-z0-9_)\].]/.test(prev)) { i++; continue }
      m[i] = 1; i++
      while (i < src.length && src[i] !== "'") { m[i] = 1; i++ }
      if (i < src.length) { m[i] = 1; i++ }
      continue
    }
    i++
  }
  return m
}

// Walk forward or backward from a bracket character to find its mate,
// using a depth counter and skipping anything inside comments or string
// literals. Returns the absolute char positions of both brackets.
function findBracketMatch(src: string, pos: number): [number, number] | null {
  const opens = '([{', closes = ')]}'
  let bracket = ''
  let bracketPos = -1
  if (pos < src.length && (opens.includes(src[pos]) || closes.includes(src[pos]))) {
    bracket = src[pos]; bracketPos = pos
  } else if (pos > 0 && (opens.includes(src[pos - 1]) || closes.includes(src[pos - 1]))) {
    bracket = src[pos - 1]; bracketPos = pos - 1
  } else {
    return null
  }
  const masked = maskCommentsAndStrings(src)
  if (masked[bracketPos]) return null
  const isOpen = opens.includes(bracket)
  const target = isOpen
    ? closes[opens.indexOf(bracket)]
    : opens[closes.indexOf(bracket)]
  const dir = isOpen ? 1 : -1
  let depth = 0
  for (let j = bracketPos + dir; j >= 0 && j < src.length; j += dir) {
    if (masked[j]) continue
    const cc = src[j]
    if (cc === bracket) depth++
    else if (cc === target) {
      if (depth === 0) return [bracketPos, j]
      depth--
    }
  }
  return null
}

// Convert an absolute char index in `src` to (line, col), both 0-based.
function lineColForPos(src: string, pos: number): { line: number; col: number } {
  let line = 0, col = 0
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src[i] === '\n') { line++; col = 0 }
    else col++
  }
  return { line, col }
}

// Walk back from `pos` while we sit on identifier characters and return
// the resulting partial token (or null if there is none / it starts with
// a digit, which would not be a valid identifier).
function getWordBefore(value: string, pos: number): { word: string; start: number } | null {
  let start = pos
  while (start > 0 && /[A-Za-z0-9_]/.test(value[start - 1])) start--
  if (start === pos) return null
  if (/[0-9]/.test(value[start])) return null
  return { word: value.slice(start, pos), start }
}

// Approximate viewport coordinates of the textarea caret. JetBrains Mono
// at 12px is ~7.2px wide and our line-height is 1.6 * 12 = 19.2px. Good
// enough for placing the autocomplete popup just below the active line.
function caretViewportAnchor(ta: HTMLTextAreaElement): { top: number; left: number } {
  const rect = ta.getBoundingClientRect()
  const pos = ta.selectionStart
  const before = ta.value.slice(0, pos)
  const lineIdx = (before.match(/\n/g)?.length ?? 0)
  const lastNL = before.lastIndexOf('\n')
  const col = pos - lastNL - 1
  const padTop = 14, padLeft = 14
  const lineHeight = 19.2
  const charWidth = 7.2
  const top = rect.top + padTop + (lineIdx + 1) * lineHeight - ta.scrollTop
  const left = rect.left + padLeft + col * charWidth - ta.scrollLeft
  return { top, left }
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
    // Any edit invalidates the previous error marker.
    setErrorLine(null)
  }, [])
  const [entries, setEntries] = useState<ConsoleEntry[]>([])
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [plots, setPlots] = useState<PlotSpec[]>([])
  const [activePlot, setActivePlot] = useState(0)
  const [plotFullscreen, setPlotFullscreen] = useState(false)
  // Per-figure rendering options. Toggled by the small chip buttons in the
  // figure header (grid / log-x / log-y / legend) and applied to PlotView.
  const [plotOpts, setPlotOpts] = useState<PlotOpts>({
    grid: true,
    logX: false,
    logY: false,
    legend: 'auto',
  })
  const [vars, setVars] = useState<VarSnapshot[]>([])
  const [expandedVar, setExpandedVar] = useState<string | null>(null)
  const [library, setLibrary] = useState<'open' | 'closed'>('open')
  const [libFilter, setLibFilter] = useState('')
  const [libMode, setLibMode] = useState<'templates' | 'functions'>('templates')
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 })
  const [lastRunMs, setLastRunMs] = useState<number | null>(null)
  // Line number of the most recent script error (1-based), or null if clean.
  // Shown as a red stripe in the gutter until the user starts editing.
  const [errorLine, setErrorLine] = useState<number | null>(null)

  // Find & replace state. `findOpen` toggles the slim bar above the editor.
  // `matchIdx` is the index of the currently highlighted match in `matches`.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)

  // Tab autocomplete state. The popup floats below the caret and lists
  // matching builtins, workspace variables and language keywords.
  type AcItem = { name: string; kind: 'fn' | 'var' | 'kw'; desc?: string }
  const [acOpen, setAcOpen] = useState(false)
  const [acItems, setAcItems] = useState<AcItem[]>([])
  const [acIndex, setAcIndex] = useState(0)
  const [acAnchor, setAcAnchor] = useState<{ top: number; left: number } | null>(null)
  const [acRange, setAcRange] = useState<{ start: number; end: number } | null>(null)

  // Single persistent workspace across runs. Hydrated from localStorage so
  // variables survive a full page refresh; functions and engine internals
  // are intentionally not restored (they can't be safely serialized).
  const workspaceRef = useRef<Workspace>((() => {
    const ws = createWorkspace()
    loadWorkspaceInto(ws)
    return ws
  })())
  const consoleRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const bracketOverlayRef = useRef<HTMLDivElement>(null)
  const plotBodyRef = useRef<HTMLDivElement>(null)

  // Memoized token stream for the syntax-highlighting overlay. Recomputes
  // on every keystroke; the tokenizer is O(n) and cheap enough for scripts
  // up to a few thousand lines.
  const highlightTokens = useMemo(() => highlightMatlab(script), [script])

  // Convert (line, col) cursor → absolute char index. Used by the bracket
  // matcher; the cursor itself comes from the textarea via updateCursor().
  const caretPos = useMemo(() => {
    const lines = script.split('\n')
    let pos = 0
    for (let i = 0; i < cursor.line - 1 && i < lines.length; i++) pos += lines[i].length + 1
    pos += Math.max(0, cursor.col - 1)
    return Math.min(pos, script.length)
  }, [cursor, script])

  // Pair of absolute char positions for bracket-match highlighting, or
  // null when the caret isn't sitting next to a bracket.
  const bracketPair = useMemo(() => findBracketMatch(script, caretPos), [script, caretPos])

  // Auto-scroll console to bottom on new entries.
  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  // Hydrate the variable inspector from the persisted workspace once on
  // mount (the workspaceRef itself was loaded synchronously above).
  useEffect(() => {
    setVars(snapshotWorkspace(workspaceRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist script store as the user edits (debounced).
  useEffect(() => {
    const h = setTimeout(() => saveScripts(scriptStore), 300)
    return () => clearTimeout(h)
  }, [scriptStore])

  // Esc closes the fullscreen plot overlay.
  useEffect(() => {
    if (!plotFullscreen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setPlotFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plotFullscreen])

  // The autocomplete anchor is computed in viewport coordinates, so any
  // window resize / scroll would leave it stale — easiest fix is to just
  // close the popup when that happens.
  useEffect(() => {
    if (!acOpen) return
    const dismiss = () => setAcOpen(false)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [acOpen])

  /** Push engine outputs into the console entry list and plot buffer. */
  const appendOutputs = useCallback((outs: RunOutput[]) => {
    const newPlots: PlotSpec[] = []
    setEntries(prev => {
      const next = [...prev]
      for (const o of outs) {
        if (o.kind === 'text' && o.text) {
          next.push({ id: nextEntryId++, kind: 'output', text: o.text })
        } else if (o.kind === 'error') {
          next.push({ id: nextEntryId++, kind: 'error', text: o.text ?? 'error', line: o.line })
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
    // Refresh the variable inspector snapshot and persist the workspace
    // so variables survive a refresh of the page.
    setVars(snapshotWorkspace(workspaceRef.current))
    saveWorkspace(workspaceRef.current)
  }, [])

  // Core runner. Takes an arbitrary source fragment plus a label that is
  // echoed into the console so the user can tell a full run from a
  // "Run Selection". Used by both runScript and runSelection.
  const runFragment = useCallback((src: string, label: string) => {
    if (running) return
    if (!src.trim()) return
    setRunning(true)
    setErrorLine(null)
    setEntries(prev => [...prev, { id: nextEntryId++, kind: 'input', text: label }])
    setTimeout(() => {
      const t0 = performance.now()
      try {
        const res = runOctave(src, workspaceRef.current)
        appendOutputs(res.outputs)
        const firstErr = res.outputs.find(o => o.kind === 'error' && typeof o.line === 'number')
        if (firstErr?.line) setErrorLine(firstErr.line)
      } catch (e: any) {
        setEntries(prev => [...prev, { id: nextEntryId++, kind: 'error', text: String(e?.message ?? e) }])
      } finally {
        setLastRunMs(performance.now() - t0)
        setRunning(false)
      }
    }, 0)
  }, [running, appendOutputs])

  const runScript = useCallback(() => {
    runFragment(script, '▶ run script')
  }, [script, runFragment])

  // Run the current textarea selection, or the caret's line if nothing
  // is selected. Standard MATLAB F9 behaviour.
  const runSelection = useCallback(() => {
    const ta = editorRef.current
    if (!ta) return
    let { selectionStart: s, selectionEnd: e } = ta
    const value = ta.value
    if (s === e) {
      // No selection: expand to the current line.
      s = value.lastIndexOf('\n', s - 1) + 1
      const nl = value.indexOf('\n', e)
      e = nl < 0 ? value.length : nl
    }
    const fragment = value.slice(s, e)
    if (!fragment.trim()) return
    const preview = fragment.split('\n')[0].trim().slice(0, 40)
    runFragment(fragment, `▶ run selection — ${preview}${fragment.split('\n')[0].length > 40 ? '…' : ''}`)
  }, [runFragment])

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
    clearSavedWorkspace()
    setVars([])
    setPlots([])
    setActivePlot(0)
    setEntries(prev => [...prev, { id: nextEntryId++, kind: 'output', text: '— workspace cleared —' }])
  }

  /** Export the currently rendered figure as SVG. */
  const exportPlotSVG = useCallback(() => {
    const host = plotBodyRef.current
    if (!host) return
    const svg = host.querySelector('svg')
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    // Inline a white-on-dark background so the exported file is self-contained.
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('width', '100%')
    bgRect.setAttribute('height', '100%')
    bgRect.setAttribute('fill', '#0a0a0a')
    clone.insertBefore(bgRect, clone.firstChild)
    const xml = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([xml], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const title = plots[activePlot]?.title?.replace(/[^\w-]+/g, '_') || `figure-${activePlot + 1}`
    a.href = url
    a.download = `${title}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }, [plots, activePlot])

  /** Export the underlying series data of the current figure as CSV. */
  const exportPlotCSV = useCallback(() => {
    const plot = plots[activePlot]
    if (!plot || plot.series.length === 0) return
    const xSet = new Set<number>()
    for (const s of plot.series) for (const x of s.x) xSet.add(x)
    const xs = Array.from(xSet).sort((a, b) => a - b)
    const header = ['x', ...plot.series.map(s => s.name)].join(',')
    const rows = xs.map(x => {
      const cells = [String(x)]
      for (const s of plot.series) {
        const idx = s.x.indexOf(x)
        cells.push(idx >= 0 ? String(s.y[idx]) : '')
      }
      return cells.join(',')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const title = plot.title?.replace(/[^\w-]+/g, '_') || `figure-${activePlot + 1}`
    a.href = url
    a.download = `${title}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [plots, activePlot])

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

  // Close the autocomplete popup and reset its bookkeeping.
  const closeAutocomplete = useCallback(() => {
    setAcOpen(false)
    setAcItems([])
    setAcAnchor(null)
    setAcRange(null)
    setAcIndex(0)
  }, [])

  // Replace the in-progress identifier (acRange) with the chosen item and
  // restore focus to the editor at the new caret position.
  const acceptAutocomplete = useCallback((name: string) => {
    const ta = editorRef.current
    if (!ta || !acRange) { closeAutocomplete(); return }
    const v = ta.value
    const newVal = v.slice(0, acRange.start) + name + v.slice(acRange.end)
    setScript(newVal)
    const newPos = acRange.start + name.length
    closeAutocomplete()
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = newPos
    })
  }, [acRange, closeAutocomplete, setScript])

  // Jump the editor caret to a 1-based line and select the entire line so
  // it's visible at a glance. Used by click-to-jump on error console entries.
  const jumpToLine = useCallback((line: number) => {
    const ta = editorRef.current
    if (!ta) return
    const lines = script.split('\n')
    if (line < 1 || line > lines.length) return
    let start = 0
    for (let i = 0; i < line - 1; i++) start += lines[i].length + 1
    const end = start + lines[line - 1].length
    ta.focus()
    ta.setSelectionRange(start, end)
    const lineHeight = 12 * 1.6
    ta.scrollTop = Math.max(0, (line - 1) * lineHeight - ta.clientHeight / 2)
  }, [script])

  // Keyboard shortcuts inside the editor:
  //   Cmd/Ctrl+Enter        — run script
  //   Shift+Cmd/Ctrl+Enter  — run selection (or current line)
  //   F9                     — run selection (MATLAB convention)
  //   Cmd/Ctrl+F            — find / replace panel
  //   Ctrl+/                — toggle line comment (%)
  //   Tab / Shift+Tab — indent / outdent current selection (2 spaces)
  //   Enter           — auto-indent to match the previous line
  //   ( [ { " '       — auto-pair brackets / quotes
  //   ) ] }           — skip over matching closer
  //   Backspace       — delete matching pair when between them
  const onEditorKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete popup keyboard navigation. Handled before everything
    // else so the popup behaves like a focus-trapping menu while open.
    if (acOpen && acItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcIndex(i => (i + 1) % acItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcIndex(i => (i - 1 + acItems.length) % acItems.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptAutocomplete(acItems[acIndex].name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAutocomplete()
        return
      }
      // Any other key dismisses the popup but lets the keystroke fall
      // through, so the user can keep typing without an extra Esc.
      closeAutocomplete()
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) runSelection()
      else runScript()
      return
    }
    if (e.key === 'F9') {
      e.preventDefault()
      runSelection()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault()
      openFind()
      return
    }
    const ta = e.currentTarget
    const { selectionStart: s, selectionEnd: ePos, value } = ta

    // Ctrl+/ — toggle MATLAB line comment (%)
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault()
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      // Expand to all lines in selection
      const lineEnd = value.indexOf('\n', ePos)
      const regionEnd = lineEnd < 0 ? value.length : lineEnd
      const before = value.slice(0, lineStart)
      const middle = value.slice(lineStart, regionEnd)
      const after = value.slice(regionEnd)
      const lines = middle.split('\n')
      const allCommented = lines.every(l => /^\s*%/.test(l) || l.trim() === '')
      const toggled = allCommented
        ? lines.map(l => l.replace(/^(\s*)% ?/, '$1')).join('\n')
        : lines.map(l => l === '' ? l : '% ' + l).join('\n')
      const newVal = before + toggled + after
      setScript(newVal)
      requestAnimationFrame(() => {
        ta.selectionStart = lineStart
        ta.selectionEnd = lineStart + toggled.length
      })
      return
    }

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
      // Try Tab autocomplete: when the cursor sits at the end of an
      // identifier-prefix, look up matching builtins, workspace variables
      // and language keywords. With one match we expand directly; with
      // many we open a small popup. With zero we fall through to indent.
      const wb = getWordBefore(value, s)
      if (wb && !e.shiftKey) {
        const prefix = wb.word
        const lower = prefix.toLowerCase()
        const seen = new Set<string>()
        const items: AcItem[] = []
        for (const v of vars) {
          if (v.name.toLowerCase().startsWith(lower) && v.name !== prefix && !seen.has(v.name)) {
            items.push({ name: v.name, kind: 'var' })
            seen.add(v.name)
          }
        }
        for (const d of BUILTIN_DOCS) {
          if (d.name.toLowerCase().startsWith(lower) && d.name !== prefix && !seen.has(d.name)) {
            items.push({ name: d.name, kind: 'fn', desc: d.signature })
            seen.add(d.name)
          }
        }
        for (const k of MATLAB_KEYWORDS) {
          if (k.toLowerCase().startsWith(lower) && k !== prefix && !seen.has(k)) {
            items.push({ name: k, kind: 'kw' })
            seen.add(k)
          }
        }
        items.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
        const top = items.slice(0, 20)
        if (top.length === 1) {
          const item = top[0]
          const newVal = value.slice(0, wb.start) + item.name + value.slice(s)
          setScript(newVal)
          const newPos = wb.start + item.name.length
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos })
          return
        }
        if (top.length > 1) {
          setAcItems(top)
          setAcIndex(0)
          setAcRange({ start: wb.start, end: s })
          setAcAnchor(caretViewportAnchor(ta))
          setAcOpen(true)
          return
        }
      }
      // Cursor insert: simple 2-space indent
      const newVal = value.slice(0, s) + '  ' + value.slice(ePos)
      setScript(newVal)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2
      })
      return
    }

    // Auto-pair brackets and quotes
    const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
    const CLOSERS = new Set([')', ']', '}'])
    const QUOTE_PAIRS: Record<string, string> = { '"': '"', "'": "'" }

    if (PAIRS[e.key]) {
      e.preventDefault()
      const open = e.key, close = PAIRS[e.key]
      if (s !== ePos) {
        // Wrap selection
        const wrapped = open + value.slice(s, ePos) + close
        const newVal = value.slice(0, s) + wrapped + value.slice(ePos)
        setScript(newVal)
        requestAnimationFrame(() => {
          ta.selectionStart = s + 1
          ta.selectionEnd = ePos + 1
        })
      } else {
        const newVal = value.slice(0, s) + open + close + value.slice(ePos)
        setScript(newVal)
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 })
      }
      return
    }

    if (CLOSERS.has(e.key) && s === ePos && value[s] === e.key) {
      // Closing bracket that already exists: skip over it
      e.preventDefault()
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 })
      return
    }

    if (QUOTE_PAIRS[e.key]) {
      // Don't auto-pair single-quote after an identifier (transpose in MATLAB)
      if (e.key === "'" && /[A-Za-z0-9_\)\]\.]/.test(value[s - 1] ?? '')) {
        return // let default handle it
      }
      if (s === ePos && value[s] === e.key) {
        // Skip over existing quote
        e.preventDefault()
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 })
        return
      }
      e.preventDefault()
      const q = e.key
      if (s !== ePos) {
        const wrapped = q + value.slice(s, ePos) + q
        const newVal = value.slice(0, s) + wrapped + value.slice(ePos)
        setScript(newVal)
        requestAnimationFrame(() => { ta.selectionStart = s + 1; ta.selectionEnd = ePos + 1 })
      } else {
        const newVal = value.slice(0, s) + q + q + value.slice(ePos)
        setScript(newVal)
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 })
      }
      return
    }

    // Backspace between matched pair: delete both
    if (e.key === 'Backspace' && s === ePos && s > 0) {
      const prev = value[s - 1]
      const next = value[s]
      if ((prev === '(' && next === ')') || (prev === '[' && next === ']') ||
          (prev === '{' && next === '}') || (prev === '"' && next === '"') ||
          (prev === "'" && next === "'")) {
        e.preventDefault()
        const newVal = value.slice(0, s - 1) + value.slice(s + 1)
        setScript(newVal)
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s - 1 })
        return
      }
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
  }, [runScript, runSelection, openFind, setScript, vars, acOpen, acItems, acIndex, acceptAutocomplete, closeAutocomplete])

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
    if (bracketOverlayRef.current) {
      bracketOverlayRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
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
    libraryModeBar: {
      display: 'flex',
      gap: 0,
      padding: '0 8px',
      borderBottom: '1px solid var(--glass-border)',
    },
    libraryModeBtn: {
      flex: 1,
      padding: '6px 8px',
      fontSize: 11,
      fontWeight: 500,
      color: 'var(--color-text-muted)',
      background: 'transparent',
      border: 'none',
      borderBottom: '2px solid transparent',
      cursor: 'pointer',
      transition: 'color 0.15s',
    },
    libraryModeBtnActive: {
      color: 'var(--color-text)',
      borderBottom: '2px solid var(--color-text)',
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
    bracketOverlay: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      pointerEvents: 'none' as const,
      willChange: 'transform',
    },
    bracketHL: {
      position: 'absolute' as const,
      width: 7.2,
      height: 19.2,
      border: '1px solid var(--color-text)',
      borderRadius: 2,
      boxSizing: 'border-box' as const,
      opacity: 0.55,
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
    varExpand: {
      margin: '2px 6px 10px 6px',
      padding: '8px 10px',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 4,
      maxHeight: 220,
      overflow: 'auto',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: 'var(--color-text-secondary)',
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
    fullscreenOverlay: {
      position: 'fixed' as const,
      inset: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(8px)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      padding: 20,
    },
    fullscreenHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 0 16px 0',
      color: 'var(--color-text)',
      fontSize: 13,
      fontWeight: 600,
    },
    fullscreenBody: {
      flex: 1,
      minHeight: 0,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 8,
      padding: 24,
    },
    acPopup: {
      position: 'fixed' as const,
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 4,
      padding: 4,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      zIndex: 200,
      maxHeight: 240,
      overflowY: 'auto' as const,
      minWidth: 220,
      maxWidth: 420,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    },
    acItem: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 8px',
      borderRadius: 3,
      cursor: 'pointer',
      color: 'var(--color-text-secondary)',
      whiteSpace: 'nowrap' as const,
    },
    acItemActive: {
      background: 'var(--glass-bg-hover)',
      color: 'var(--color-text)',
    },
    acItemKind: {
      display: 'inline-block',
      width: 14,
      textAlign: 'center' as const,
      color: 'var(--color-text-muted)',
      fontStyle: 'italic' as const,
      flex: '0 0 auto',
    },
    acItemName: { flex: '0 0 auto', fontWeight: 500 },
    acItemDesc: {
      flex: 1,
      color: 'var(--color-text-muted)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      fontSize: 10,
      marginLeft: 8,
    },
    plotChip: {
      padding: '2px 8px',
      fontSize: 10,
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.02em',
      color: 'var(--color-text-muted)',
      background: 'transparent',
      border: '1px solid var(--glass-border)',
      borderRadius: 3,
      cursor: 'pointer',
      lineHeight: 1.4,
      transition: 'background 0.12s, color 0.12s, border-color 0.12s',
    },
    plotChipActive: {
      color: 'var(--color-text)',
      background: 'var(--glass-bg-hover)',
      borderColor: 'var(--color-border-strong)',
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

  // Filter and group built-in function docs the same way templates work.
  const filteredBuiltins = useMemo<BuiltinDoc[]>(() => {
    const q = libFilter.trim().toLowerCase()
    if (!q) return BUILTIN_DOCS
    return BUILTIN_DOCS.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q) ||
      d.signature.toLowerCase().includes(q)
    )
  }, [libFilter])

  const groupedBuiltins = useMemo(() => {
    const groups: Record<string, BuiltinDoc[]> = {}
    for (const cat of BUILTIN_CATEGORIES) groups[cat] = []
    for (const d of filteredBuiltins) {
      if (!groups[d.category]) groups[d.category] = []
      groups[d.category].push(d)
    }
    return groups
  }, [filteredBuiltins])

  // Insert a builtin's snippet at the editor cursor (or replace selection).
  const insertBuiltin = useCallback((doc: BuiltinDoc) => {
    const ta = editorRef.current
    if (!ta) return
    const s = ta.selectionStart
    const e = ta.selectionEnd
    const before = script.slice(0, s)
    const after = script.slice(e)
    const next = before + doc.snippet + after
    setScript(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = s + doc.snippet.length
    })
  }, [script, setScript])

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

        <button
          style={{ ...styles.btn, ...styles.btnGhost }}
          onClick={runSelection}
          disabled={running}
          title="Run current selection — or the caret's line if nothing is selected (F9 or Shift+Ctrl/Cmd+Enter)"
        >
          <FiPlay style={{ opacity: 0.7 }} /> Run selection
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
              <span>
                Library · {libMode === 'templates' ? filteredTemplates.length : filteredBuiltins.length}
              </span>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                onClick={() => setLibrary('closed')}
                title="Collapse library"
              >hide</button>
            </div>
            <div style={styles.libraryModeBar}>
              <button
                style={{
                  ...styles.libraryModeBtn,
                  ...(libMode === 'templates' ? styles.libraryModeBtnActive : null),
                }}
                onClick={() => setLibMode('templates')}
              >Templates</button>
              <button
                style={{
                  ...styles.libraryModeBtn,
                  ...(libMode === 'functions' ? styles.libraryModeBtnActive : null),
                }}
                onClick={() => setLibMode('functions')}
              >Functions</button>
            </div>
            <div style={styles.librarySearch}>
              <input
                style={styles.librarySearchInput}
                placeholder={libMode === 'templates' ? 'Search templates…' : 'Search functions…'}
                value={libFilter}
                onChange={e => setLibFilter(e.target.value)}
              />
            </div>
            <div style={styles.libraryScroll}>
              {libMode === 'templates' ? (
                <>
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
                </>
              ) : (
                <>
                  {BUILTIN_CATEGORIES.map(cat => {
                    const items = groupedBuiltins[cat] ?? []
                    if (items.length === 0) return null
                    return (
                      <div key={cat}>
                        <div style={styles.libraryCategory}>{cat}</div>
                        {items.map(d => (
                          <button
                            key={d.name}
                            style={styles.libraryItem}
                            onClick={() => insertBuiltin(d)}
                            title={`${d.signature} — ${d.description}`}
                          >
                            <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>{d.signature}</div>
                            <div style={styles.libraryItemDesc}>{d.description}</div>
                          </button>
                        ))}
                      </div>
                    )
                  })}
                  {filteredBuiltins.length === 0 && (
                    <div style={{ padding: '12px 16px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                      No functions match "{libFilter}".
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div style={styles.editorWrap}>
          <div style={styles.editorHeader}>
            <span>Scripts</span>
            <span style={{ opacity: 0.7 }}>Ctrl/Cmd + Enter to run · F9 runs selection · Ctrl/Cmd + F to find · Tab to indent</span>
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
                {Array.from({ length: lineCount }, (_, i) => {
                  const n = i + 1
                  const isErr = errorLine === n
                  return (
                    <div
                      key={n}
                      style={{
                        height: '1.6em',
                        color: isErr ? 'var(--color-error)' : undefined,
                        fontWeight: isErr ? 600 : undefined,
                      }}
                    >
                      {isErr ? '● ' + n : n}
                    </div>
                  )
                })}
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
              <div ref={bracketOverlayRef} style={styles.bracketOverlay} aria-hidden="true">
                {bracketPair && bracketPair.map((p, idx) => {
                  const lc = lineColForPos(script, p)
                  return (
                    <div
                      key={idx}
                      style={{
                        ...styles.bracketHL,
                        top: 14 + lc.line * 19.2,
                        left: 14 + lc.col * 7.2,
                      }}
                    />
                  )
                })}
              </div>
              <textarea
                ref={editorRef}
                style={styles.editor}
                value={script}
                onChange={e => { setScript(e.target.value); updateCursor(e.target); if (acOpen) closeAutocomplete() }}
                onKeyDown={onEditorKey}
                onKeyUp={onEditorSelect}
                onClick={onEditorSelect}
                onScroll={onEditorScroll}
                onBlur={() => { if (acOpen) closeAutocomplete() }}
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
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  style={plotOpts.grid ? { ...styles.plotChip, ...styles.plotChipActive } : styles.plotChip}
                  onClick={() => setPlotOpts(o => ({ ...o, grid: !o.grid }))}
                  title="Toggle gridlines"
                >grid</button>
                <button
                  style={plotOpts.logX ? { ...styles.plotChip, ...styles.plotChipActive } : styles.plotChip}
                  onClick={() => setPlotOpts(o => ({ ...o, logX: !o.logX }))}
                  title="Toggle logarithmic x-axis"
                >log&nbsp;x</button>
                <button
                  style={plotOpts.logY ? { ...styles.plotChip, ...styles.plotChipActive } : styles.plotChip}
                  onClick={() => setPlotOpts(o => ({ ...o, logY: !o.logY }))}
                  title="Toggle logarithmic y-axis"
                >log&nbsp;y</button>
                <button
                  style={plotOpts.legend !== 'off' ? { ...styles.plotChip, ...styles.plotChipActive } : styles.plotChip}
                  onClick={() => setPlotOpts(o => ({ ...o, legend: o.legend === 'off' ? 'on' : 'off' }))}
                  title="Toggle legend"
                >legend</button>
                <span style={{ width: 1, height: 14, background: 'var(--glass-border)', margin: '0 4px' }} />
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                  disabled={plots.length < 2}
                  onClick={() => setActivePlot(i => Math.max(0, i - 1))}
                  title="Previous figure"
                >◀</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                  disabled={plots.length < 2}
                  onClick={() => setActivePlot(i => Math.min(plots.length - 1, i + 1))}
                  title="Next figure"
                >▶</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                  disabled={plots.length === 0}
                  onClick={exportPlotSVG}
                  title="Download current figure as SVG"
                >svg</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                  disabled={plots.length === 0}
                  onClick={exportPlotCSV}
                  title="Download series data as CSV"
                >csv</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                  disabled={plots.length === 0}
                  onClick={() => setPlotFullscreen(true)}
                  title="Expand figure to fullscreen"
                >expand</button>
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                  disabled={plots.length === 0}
                  onClick={() => { setPlots([]); setActivePlot(0) }}
                  title="Discard all figures"
                >clear</button>
              </div>
            </div>
            <div ref={plotBodyRef} style={styles.plotBody}>
              <PlotView plot={currentPlot} opts={plotOpts} />
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
              {vars.map(v => {
                const isOpen = expandedVar === v.name
                return (
                  <div key={v.name}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedVar(prev => prev === v.name ? null : v.name)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setExpandedVar(prev => prev === v.name ? null : v.name)
                        }
                      }}
                      style={{
                        ...styles.varRow,
                        cursor: 'pointer',
                        background: isOpen ? 'var(--glass-bg-hover)' : 'transparent',
                      }}
                      title={`${v.name}: ${v.kind}  ${v.shape}  ${v.summary}`}
                    >
                      <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{v.name}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{v.shape}</span>
                      <span style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.summary}
                      </span>
                    </div>
                    {isOpen && (
                      <div style={styles.varExpand}>
                        <VarExpandView value={v.value} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div ref={consoleRef} style={styles.console}>
          {entries.length === 0 && (
            <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
              Console ready. Type a command below or hit Run.
            </div>
          )}
          {entries.map(e => {
            const clickable = e.kind === 'error' && typeof e.line === 'number'
            return (
              <div
                key={e.id}
                onClick={clickable ? () => jumpToLine(e.line!) : undefined}
                style={{
                  ...(e.kind === 'input' ? styles.entryInput
                    : e.kind === 'error' ? styles.entryError
                    : styles.entryOutput),
                  ...(clickable ? { cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 } : null),
                }}
                title={clickable ? `Click to jump to line ${e.line}` : undefined}
              >
                {e.text}
              </div>
            )
          })}
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

      {/* ─── Fullscreen figure overlay ──────────────────────────────── */}
      {plotFullscreen && currentPlot && (
        <div
          style={styles.fullscreenOverlay}
          role="dialog"
          aria-modal="true"
          onClick={e => { if (e.target === e.currentTarget) setPlotFullscreen(false) }}
        >
          <div style={styles.fullscreenHeader}>
            <span>
              Figure {plots.length > 0 ? `${activePlot + 1} / ${plots.length}` : ''}
              {currentPlot.title ? ` · ${currentPlot.title}` : ''}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 10px', fontSize: 11 }}
                disabled={plots.length < 2}
                onClick={() => setActivePlot(i => Math.max(0, i - 1))}
                title="Previous figure"
              >◀</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 10px', fontSize: 11 }}
                disabled={plots.length < 2}
                onClick={() => setActivePlot(i => Math.min(plots.length - 1, i + 1))}
                title="Next figure"
              >▶</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 10px', fontSize: 11 }}
                onClick={exportPlotSVG}
                title="Download current figure as SVG"
              >svg</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 10px', fontSize: 11 }}
                onClick={exportPlotCSV}
                title="Download series data as CSV"
              >csv</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 10px', fontSize: 11 }}
                onClick={() => setPlotFullscreen(false)}
                title="Close fullscreen (Esc)"
              >close</button>
            </div>
          </div>
          <div style={styles.fullscreenBody}>
            <PlotView plot={currentPlot} opts={plotOpts} />
          </div>
        </div>
      )}

      {/* ─── Autocomplete popup (position: fixed, viewport coords) ──── */}
      {acOpen && acAnchor && acItems.length > 0 && (
        <div
          style={{ ...styles.acPopup, top: acAnchor.top, left: acAnchor.left }}
          role="listbox"
        >
          {acItems.map((it, i) => (
            <div
              key={it.name}
              role="option"
              aria-selected={i === acIndex}
              style={i === acIndex ? { ...styles.acItem, ...styles.acItemActive } : styles.acItem}
              onMouseEnter={() => setAcIndex(i)}
              onMouseDown={ev => {
                ev.preventDefault()
                acceptAutocomplete(it.name)
              }}
            >
              <span style={styles.acItemKind}>
                {it.kind === 'fn' ? 'ƒ' : it.kind === 'var' ? 'v' : 'kw'}
              </span>
              <span style={styles.acItemName}>{it.name}</span>
              {it.desc && <span style={styles.acItemDesc}>{it.desc}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Plot renderer ───────────────────────────────────────────────────── */
// Monochrome palette — matches the rest of the Humanovo platform. Shades
// step down so multiple series remain distinguishable without introducing
// category colors.
const SERIES_COLORS = ['#ededed', '#a1a1a1', '#d4d4d4', '#737373', '#8a8a8a', '#bfbfbf', '#525252', '#e5e5e5']

// Per-figure render options surfaced through the figure-panel chips.
interface PlotOpts {
  grid: boolean
  logX: boolean
  logY: boolean
  legend: 'auto' | 'on' | 'off'
}
const DEFAULT_PLOT_OPTS: PlotOpts = { grid: true, logX: false, logY: false, legend: 'auto' }

function PlotView({ plot, opts = DEFAULT_PLOT_OPTS }: { plot: PlotSpec | null; opts?: PlotOpts }) {
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

  // Recharts log scale needs an explicit numeric domain, otherwise it
  // collapses zero/negative ticks to NaN and the axis disappears.
  const xScale = opts.logX ? 'log' : 'auto'
  const yScale = opts.logY ? 'log' : 'auto'
  const xDomain = opts.logX ? ['auto', 'auto'] as [string, string] : undefined
  const yDomain = opts.logY ? ['auto', 'auto'] as [string, string] : undefined
  const showLegend = opts.legend === 'on' || (opts.legend === 'auto' && plot.series.length > 1)

  const common = (
    <>
      {opts.grid && <CartesianGrid stroke="var(--glass-border)" strokeDasharray="3 3" />}
      <XAxis
        dataKey="x"
        type="number"
        scale={xScale}
        domain={xDomain}
        allowDataOverflow={opts.logX}
        stroke="var(--glass-border)"
        tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
        label={plot.xLabel ? { value: plot.xLabel, position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)', fontSize: 11 } : undefined}
      />
      <YAxis
        scale={yScale}
        domain={yDomain}
        allowDataOverflow={opts.logY}
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
      {showLegend && (
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

/* ── Variable expand view ────────────────────────────────────────────── */
// Renders the full contents of a workspace variable when the user clicks
// its row in the inspector. Matrices are shown as a compact grid (first
// 20×20), scalars/strings/functions are shown inline.
const VAR_MAX_ROWS = 20
const VAR_MAX_COLS = 20

function VarExpandView({ value }: { value: MValue }) {
  switch (value.kind) {
    case 'num':
      return <span>{formatScalar(value.v)}</span>
    case 'bool':
      return <span>{value.v ? 'true' : 'false'}</span>
    case 'str':
      return <span style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(value.v)}</span>
    case 'fn':
      return <span>@{value.name} (arity {value.arity})</span>
    case 'void':
      return <span>—</span>
    case 'mat': {
      const rows = Math.min(value.rows, VAR_MAX_ROWS)
      const cols = Math.min(value.cols, VAR_MAX_COLS)
      const rowTrunc = value.rows > VAR_MAX_ROWS
      const colTrunc = value.cols > VAR_MAX_COLS
      // MATLAB stores matrices column-major, but our engine uses a flat
      // row-major Float64Array (see mathLib). Access via data[r*cols + c].
      const data = value.data
      const full = value.cols
      return (
        <div>
          <table style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <tbody>
              {Array.from({ length: rows }, (_, r) => (
                <tr key={r}>
                  {Array.from({ length: cols }, (_, c) => (
                    <td
                      key={c}
                      style={{
                        padding: '2px 8px',
                        textAlign: 'right',
                        color: 'var(--color-text)',
                        borderRight: c < cols - 1 ? '1px solid var(--glass-border)' : 'none',
                      }}
                    >
                      {formatScalar(data[r * full + c])}
                    </td>
                  ))}
                  {colTrunc && (
                    <td style={{ padding: '2px 6px', color: 'var(--color-text-muted)' }}>…</td>
                  )}
                </tr>
              ))}
              {rowTrunc && (
                <tr>
                  <td colSpan={cols + (colTrunc ? 1 : 0)} style={{ padding: '2px 6px', color: 'var(--color-text-muted)' }}>
                    … {value.rows - VAR_MAX_ROWS} more row{value.rows - VAR_MAX_ROWS === 1 ? '' : 's'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )
    }
  }
}
