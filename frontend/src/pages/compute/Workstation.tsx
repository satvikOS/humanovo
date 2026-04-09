// ═══════════════════════════════════════════════════════════════════════
// Compute Lab — MATLAB/Octave Workstation
// Batch 4a: editor + command window backed by the octaveEngine.
// Batch 4b: adds variable inspector and plot panel on the right rail.
// Later batches add the preset library sidebar and polish.
// ═══════════════════════════════════════════════════════════════════════
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const EDITOR_PREFS_KEY = 'compute-workstation-editor-prefs'  // { fontSize, wrap }
const PINNED_VARS_KEY = 'compute-workstation-pinned-vars' // string[] of names

const EDITOR_FONT_MIN = 10
const EDITOR_FONT_MAX = 20
const EDITOR_FONT_DEFAULT = 12

interface EditorPrefs { fontSize: number; wrap: boolean }
function loadEditorPrefs(): EditorPrefs {
  try {
    const raw = localStorage.getItem(EDITOR_PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      const fs = Number(p?.fontSize)
      return {
        fontSize: Number.isFinite(fs) ? Math.max(EDITOR_FONT_MIN, Math.min(EDITOR_FONT_MAX, fs)) : EDITOR_FONT_DEFAULT,
        wrap: !!p?.wrap,
      }
    }
  } catch { /* fall through */ }
  return { fontSize: EDITOR_FONT_DEFAULT, wrap: false }
}
function saveEditorPrefs(p: EditorPrefs) {
  try { localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify(p)) } catch { /* quota */ }
}

function loadPinnedVars(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_VARS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return new Set(arr.filter(x => typeof x === 'string'))
  } catch { /* fall through */ }
  return new Set()
}
function savePinnedVars(set: ReadonlySet<string>) {
  try { localStorage.setItem(PINNED_VARS_KEY, JSON.stringify([...set])) } catch { /* quota */ }
}

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

/** Target formats for the workspace "copy variable" action. */
type CopyFormat = 'matlab' | 'python' | 'latex' | 'json' | 'csv'
const COPY_FORMATS: CopyFormat[] = ['matlab', 'python', 'latex', 'json', 'csv']

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
type HTokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'variable' | 'text'
interface HToken { kind: HTokenKind; text: string }

const MATLAB_KEYWORDS = new Set([
  'if', 'else', 'elseif', 'end', 'endif', 'endfor', 'endwhile', 'endfunction',
  'for', 'while', 'do', 'until', 'break', 'continue',
  'function', 'return', 'switch', 'case', 'otherwise',
  'try', 'catch', 'global', 'persistent',
  'true', 'false',
])

function highlightMatlab(src: string, varNames?: Set<string>): HToken[] {
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
      } else if (varNames && varNames.has(word)) {
        flush()
        out.push({ kind: 'variable', text: word })
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
  comment:  { color: 'var(--color-text-muted)', fontStyle: 'italic' },
  string:   { color: 'var(--color-text-secondary)' },
  number:   { color: 'var(--color-text-secondary)' },
  keyword:  { color: 'var(--color-text)', fontWeight: 600 },
  variable: { color: 'var(--color-text)', textDecoration: 'underline', textDecorationColor: 'var(--color-text-muted)', textDecorationStyle: 'dotted', textUnderlineOffset: 3 },
  text:     { color: 'var(--color-text)' },
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
// line-height ≈ fontSize * 1.6 and average glyph width ≈ fontSize * 0.6.
// Good enough for placing the autocomplete popup just below the active line.
function caretViewportAnchor(ta: HTMLTextAreaElement, fontSize: number): { top: number; left: number } {
  const rect = ta.getBoundingClientRect()
  const pos = ta.selectionStart
  const before = ta.value.slice(0, pos)
  const lineIdx = (before.match(/\n/g)?.length ?? 0)
  const lastNL = before.lastIndexOf('\n')
  const col = pos - lastNL - 1
  const padTop = 14, padLeft = 14
  const lineHeight = fontSize * 1.6
  const charWidth = fontSize * 0.6
  const top = rect.top + padTop + (lineIdx + 1) * lineHeight - ta.scrollTop
  const left = rect.left + padLeft + col * charWidth - ta.scrollLeft
  return { top, left }
}

/* ── Component ───────────────────────────────────────────────────────── */
export default function Workstation() {
  const [scriptStore, setScriptStore] = useState<ScriptStore>(loadScripts)
  // Drag-and-drop tab reordering. Ref holds the source id during the drag;
  // state drives the visual drop indicator. We clear both on drop / dragend.
  const draggedTabIdRef = useRef<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
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
  const [consoleFilter, setConsoleFilter] = useState('')
  // Kind-scoped console view: 'all' shows everything, the others narrow to
  // a single entry kind. Combines with the text filter above.
  const [consoleKind, setConsoleKind] = useState<'all' | 'input' | 'output' | 'error'>('all')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [histIdx, setHistIdx] = useState<number | null>(null)
  // Reverse history search (Ctrl+R) overlay. `histSearchOpen` toggles the
  // inline search bar above the command line, `histSearchQuery` drives the
  // filter, and `histSearchCursor` walks through the matches from most to
  // least recent.
  const [histSearchOpen, setHistSearchOpen] = useState(false)
  const [histSearchQuery, setHistSearchQuery] = useState('')
  const [histSearchCursor, setHistSearchCursor] = useState(0)
  const histSearchInputRef = useRef<HTMLInputElement>(null)
  const cmdInputRef = useRef<HTMLInputElement>(null)
  const [plots, setPlots] = useState<PlotSpec[]>([])
  const [activePlot, setActivePlot] = useState(0)
  const [plotFullscreen, setPlotFullscreen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [dropHover, setDropHover] = useState(false)
  // Per-figure rendering options. Toggled by the small chip buttons in the
  // figure header (grid / log-x / log-y / legend) and applied to PlotView.
  const [plotOpts, setPlotOpts] = useState<PlotOpts>({
    grid: true,
    logX: false,
    logY: false,
    legend: 'auto',
  })
  const [vars, setVars] = useState<VarSnapshot[]>([])
  const [varFilter, setVarFilter] = useState('')
  // Pinned workspace variables — float to the top of the list regardless
  // of the current sort order. Persisted to localStorage so the user's
  // favourites survive a reload.
  const [pinnedVars, setPinnedVars] = useState<ReadonlySet<string>>(loadPinnedVars)
  useEffect(() => { savePinnedVars(pinnedVars) }, [pinnedVars])
  const togglePinnedVar = useCallback((name: string) => {
    setPinnedVars(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])
  // Sort key for the workspace inspector. Cycled through via a small chip
  // in the panel header so power users can reorder by size when hunting
  // the largest matrix in the ws, or by type when scanning kinds.
  const [varSort, setVarSort] = useState<'name' | 'size' | 'type'>('name')
  // Target format used by the ⧉ copy button on each workspace row.
  // Cycled through via a small chip in the panel header so users can
  // paste the same matrix into MATLAB, Python, LaTeX, JSON, or CSV
  // without retyping anything.
  const [copyFormat, setCopyFormat] = useState<CopyFormat>('matlab')
  const [expandedVar, setExpandedVar] = useState<string | null>(null)
  const [inspectVar, setInspectVar] = useState<string | null>(null)
  const [library, setLibrary] = useState<'open' | 'closed'>('open')
  const [libFilter, setLibFilter] = useState('')
  const [libMode, setLibMode] = useState<'templates' | 'functions'>('templates')
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 })
  // Live selection size (characters and logical lines) for the status bar.
  // Null when the user isn't selecting any text.
  const [selectionInfo, setSelectionInfo] = useState<{ chars: number; lines: number } | null>(null)
  const [lastRunMs, setLastRunMs] = useState<number | null>(null)

  // Editor appearance prefs — font size (clamped) and soft word wrap.
  // Persisted to localStorage so the user's choice survives a reload.
  // Command palette modal — a filter-and-run launcher for every
  // action the Workstation exposes. Bound to Ctrl / Cmd + Shift + P.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const paletteInputRef = useRef<HTMLInputElement>(null)
  const [editorPrefs, setEditorPrefs] = useState<EditorPrefs>(loadEditorPrefs)
  const editorFontSize = editorPrefs.fontSize
  const editorWrapOn = editorPrefs.wrap
  const editorLineHeight = editorFontSize * 1.6
  const editorCharWidth = editorFontSize * 0.6
  useEffect(() => { saveEditorPrefs(editorPrefs) }, [editorPrefs])
  const bumpEditorFont = useCallback((delta: number) => {
    setEditorPrefs(p => ({
      ...p,
      fontSize: Math.max(EDITOR_FONT_MIN, Math.min(EDITOR_FONT_MAX, p.fontSize + delta)),
    }))
  }, [])
  const toggleEditorWrap = useCallback(() => {
    setEditorPrefs(p => ({ ...p, wrap: !p.wrap }))
  }, [])
  // Line number of the most recent script error (1-based), or null if clean.
  // Shown as a red stripe in the gutter until the user starts editing.
  const [errorLine, setErrorLine] = useState<number | null>(null)

  // Find & replace state. `findOpen` toggles the slim bar above the editor.
  // `matchIdx` is the index of the currently highlighted match in `matches`.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  // Find modifiers. `findRegex` reinterprets the query as a JavaScript
  // regular expression; `findCaseSensitive` flips the default case-fold
  // behaviour. Both are applied to the matches memo and to replaceAll.
  const [findRegex, setFindRegex] = useState(false)
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)
  const [findError, setFindError] = useState<string | null>(null)
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)

  // "Go to line" popup — mutually exclusive with the find panel.
  const [gotoOpen, setGotoOpen] = useState(false)
  const [gotoQuery, setGotoQuery] = useState('')
  const gotoInputRef = useRef<HTMLInputElement>(null)

  // Tab autocomplete state. The popup floats below the caret and lists
  // matching builtins, workspace variables and language keywords.
  type AcItem = { name: string; kind: 'fn' | 'var' | 'kw'; desc?: string }
  const [acOpen, setAcOpen] = useState(false)
  const [acItems, setAcItems] = useState<AcItem[]>([])
  const [acIndex, setAcIndex] = useState(0)
  const [acAnchor, setAcAnchor] = useState<{ top: number; left: number } | null>(null)
  const [acRange, setAcRange] = useState<{ start: number; end: number } | null>(null)

  // Function-signature hint popup: opens when the user types "(" right after
  // a known builtin identifier, closes on Escape, ")", Enter, blur, or when
  // the caret leaves the hint's line.
  interface SigHint { signature: string; description: string; line: number; anchor: { top: number; left: number } }
  const [sigHint, setSigHint] = useState<SigHint | null>(null)

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
  // Per-script remembered editor state (scroll offsets + selection). Keyed
  // by script id so switching tabs returns the user to exactly where they
  // left off rather than snapping to the top of the file.
  const scriptViewStateRef = useRef<Map<string, {
    scrollTop: number; scrollLeft: number; selStart: number; selEnd: number
  }>>(new Map())
  const prevScriptIdRef = useRef<string>(scriptStore.activeId)
  // Per-script line bookmarks, keyed by script id. Each entry is a Set of
  // 1-indexed line numbers. Lives in a ref so typing doesn't force a full
  // re-render; the visible set is mirrored in `bookmarkLines` state whenever
  // we mutate the active script's entry.
  const scriptBookmarksRef = useRef<Map<string, Set<number>>>(new Map())
  const [bookmarkLines, setBookmarkLines] = useState<ReadonlySet<number>>(() => new Set())
  const gutterRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const indentGuideRef = useRef<HTMLDivElement>(null)
  const bracketOverlayRef = useRef<HTMLDivElement>(null)
  const findOverlayRef = useRef<HTMLDivElement>(null)
  const wordOverlayRef = useRef<HTMLDivElement>(null)
  const currentLineRef = useRef<HTMLDivElement>(null)
  const plotBodyRef = useRef<HTMLDivElement>(null)

  // Set of workspace variable names so the syntax highlighter can give
  // user-defined identifiers a distinct visual treatment — a subtle dotted
  // underline — making it obvious at a glance which symbols are live.
  const varNameSet = useMemo(() => new Set(vars.map(v => v.name)), [vars])

  // Memoized token stream for the syntax-highlighting overlay. Recomputes
  // on every keystroke; the tokenizer is O(n) and cheap enough for scripts
  // up to a few thousand lines.
  const highlightTokens = useMemo(() => highlightMatlab(script, varNameSet), [script, varNameSet])

  // Piggyback on the tokenizer to count how many times each workspace
  // variable is used in the current script. Free since we already emit
  // 'variable' tokens for exactly these identifiers. Shown in the
  // workspace panel as a small muted badge so users can spot unused vars.
  const varUsageCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    for (const t of highlightTokens) {
      if (t.kind === 'variable') counts[t.text] = (counts[t.text] || 0) + 1
    }
    return counts
  }, [highlightTokens])

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

  // Auto-scroll console to bottom on new entries — but only while the
  // user is already pinned to the bottom. If they've scrolled up to
  // inspect history, we stop chasing the tail so the scroll position
  // stays put and they can read in peace.
  const consolePinnedRef = useRef(true)
  const [consolePinned, setConsolePinned] = useState(true)
  useEffect(() => {
    const el = consoleRef.current
    if (el && consolePinnedRef.current) el.scrollTop = el.scrollHeight
  }, [entries])
  const onConsoleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    if (atBottom !== consolePinnedRef.current) {
      consolePinnedRef.current = atBottom
      setConsolePinned(atBottom)
    }
  }, [])
  const scrollConsoleToBottom = useCallback(() => {
    const el = consoleRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    consolePinnedRef.current = true
    setConsolePinned(true)
  }, [])

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

  // Esc closes the variable inspector modal.
  useEffect(() => {
    if (!inspectVar) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setInspectVar(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectVar])

  // F1 anywhere in the Workstation toggles the keyboard-shortcut help
  // modal. Esc closes it. Ctrl+L clears the console (bash convention).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'F1') { ev.preventDefault(); setHelpOpen(h => !h) }
      else if (ev.key === 'Escape' && helpOpen) setHelpOpen(false)
      else if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'l' || ev.key === 'L')) {
        // Don't swallow the browser's URL-bar focus when the user has
        // focused something outside the Workstation.
        const tgt = ev.target as HTMLElement | null
        if (tgt && (tgt.tagName === 'TEXTAREA' || tgt.tagName === 'INPUT' || tgt.closest?.('[data-workstation]'))) {
          ev.preventDefault()
          setEntries([])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [helpOpen])

  // Apply the console filter (substring, case-insensitive) and the
  // kind-scope filter. Both are cheap linear passes so we just fuse them.
  const visibleEntries = useMemo(() => {
    const q = consoleFilter.trim().toLowerCase()
    if (!q && consoleKind === 'all') return entries
    return entries.filter(e => {
      if (consoleKind !== 'all' && e.kind !== consoleKind) return false
      if (q && !e.text.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, consoleFilter, consoleKind])

  // Per-kind counts for the console header badges. Recomputed when entries
  // change; O(n) scan but small compared to rendering the list.
  const consoleCounts = useMemo(() => {
    let input = 0, output = 0, error = 0
    for (const e of entries) {
      if (e.kind === 'input') input++
      else if (e.kind === 'output') output++
      else if (e.kind === 'error') error++
    }
    return { all: entries.length, input, output, error }
  }, [entries])

  // Same idea for the workspace inspector — filter by variable name,
  // substring, case-insensitive. Then sort by the current varSort key.
  // Pinned variables always float to the top regardless of sort key so
  // the user can keep an eye on the handful of values they care about
  // while iterating on a script.
  const visibleVars = useMemo(() => {
    const q = varFilter.trim().toLowerCase()
    const base = q ? vars.filter(v => v.name.toLowerCase().includes(q)) : vars
    const kindRank = (k: VarSnapshot['kind']): number => {
      switch (k) {
        case 'mat':  return 0
        case 'num':  return 1
        case 'bool': return 2
        case 'str':  return 3
        case 'fn':   return 4
        default:     return 5
      }
    }
    const sizeOf = (v: VarSnapshot): number => {
      if (v.kind === 'mat' && v.value.kind === 'mat') return v.value.rows * v.value.cols
      if (v.kind === 'str' && v.value.kind === 'str') return v.value.v.length
      return 1
    }
    const sorted = base.slice()
    if (varSort === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name))
    } else if (varSort === 'size') {
      sorted.sort((a, b) => {
        const d = sizeOf(b) - sizeOf(a)
        return d !== 0 ? d : a.name.localeCompare(b.name)
      })
    } else {
      sorted.sort((a, b) => {
        const d = kindRank(a.kind) - kindRank(b.kind)
        return d !== 0 ? d : a.name.localeCompare(b.name)
      })
    }
    // Stable partition: pinned first (keeping their relative order within
    // the sorted list), then everything else.
    if (pinnedVars.size === 0) return sorted
    const pinned: VarSnapshot[] = []
    const rest: VarSnapshot[] = []
    for (const v of sorted) {
      if (pinnedVars.has(v.name)) pinned.push(v)
      else rest.push(v)
    }
    return [...pinned, ...rest]
  }, [vars, varFilter, varSort, pinnedVars])

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

  const lineCount = useMemo(() => script.split('\n').length, [script])

  // Indent-guide runs. For each 2-column indent level, collects contiguous
  // vertical ranges of lines where at least that many spaces of indent are
  // present. Blank lines inherit the greater of their neighbours so guides
  // don't break across empty separators in the middle of a block. The
  // overlay renderer turns each run into a single absolutely-positioned
  // vertical divider, keeping the DOM tiny even for deeply nested code.
  const indentGuides = useMemo<Array<{ col: number; startLine: number; endLine: number }>>(() => {
    const lines = script.split('\n')
    const n = lines.length
    if (n === 0) return []
    // Leading-space count per line (tabs are expanded at 2 spaces since
    // the editor's own indent handlers always emit pairs of spaces).
    const indents = new Int32Array(n)
    const isBlank = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const ln = lines[i]
      if (ln.trim() === '') { isBlank[i] = 1; indents[i] = -1; continue }
      let k = 0
      while (k < ln.length && (ln[k] === ' ' || ln[k] === '\t')) {
        k += ln[k] === '\t' ? 2 : 1
      }
      indents[i] = k
    }
    // Smooth blank lines so a run of them inherits min(neighbours). This
    // lets guides span across empty separators in the middle of a block.
    for (let i = 0; i < n; i++) {
      if (!isBlank[i]) continue
      let left = 0, right = 0
      for (let j = i - 1; j >= 0; j--) { if (!isBlank[j]) { left = indents[j]; break } }
      for (let j = i + 1; j < n; j++) { if (!isBlank[j]) { right = indents[j]; break } }
      indents[i] = Math.min(left, right)
    }
    const out: Array<{ col: number; startLine: number; endLine: number }> = []
    // Walk columns 2, 4, 6, … until no line reaches that depth.
    let maxIndent = 0
    for (let i = 0; i < n; i++) if (indents[i] > maxIndent) maxIndent = indents[i]
    for (let col = 2; col < maxIndent; col += 2) {
      let runStart = -1
      for (let i = 0; i < n; i++) {
        if (indents[i] > col) {
          if (runStart < 0) runStart = i
        } else if (runStart >= 0) {
          out.push({ col, startLine: runStart + 1, endLine: i }) // 1-based inclusive
          runStart = -1
        }
      }
      if (runStart >= 0) out.push({ col, startLine: runStart + 1, endLine: n })
    }
    return out
  }, [script])

  // Section boundaries for %% markers. `starts` holds 1-based line numbers
  // of lines that begin a new section. A leading implicit section 1 is
  // always present even if the file doesn't contain a %% marker.
  const sections = useMemo(() => {
    const lines = script.split('\n')
    const starts: number[] = [1]
    const names: Record<number, string> = {}
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*%%/.test(lines[i])) {
        const n = i + 1
        if (!starts.includes(n)) starts.push(n)
        const name = lines[i].replace(/^\s*%%\s*/, '').trim()
        if (name) names[n] = name
      }
    }
    return { starts, names }
  }, [script])

  const sectionStartSet = useMemo(() => new Set(sections.starts), [sections])

  // Caret offset (0-based) derived from line/col so we can run regex scans
  // without hitting the DOM. Keeps the memo pipeline declarative.
  const caretOffset = useMemo(() => {
    const lines = script.split('\n')
    let off = 0
    for (let i = 0; i < cursor.line - 1 && i < lines.length; i++) off += lines[i].length + 1
    return off + (cursor.col - 1)
  }, [script, cursor])

  // The identifier containing the caret, or '' if the caret sits on
  // whitespace / punctuation / a single-letter token (too noisy to
  // highlight). Used to drive the subtle "all occurrences" overlay below.
  const wordAtCaret = useMemo(() => {
    const pos = caretOffset
    if (pos < 0 || pos > script.length) return ''
    let start = pos, end = pos
    while (start > 0 && /[A-Za-z0-9_]/.test(script[start - 1])) start--
    while (end < script.length && /[A-Za-z0-9_]/.test(script[end])) end++
    if (start === end) return ''
    if (/[0-9]/.test(script[start])) return ''
    const word = script.slice(start, end)
    return word.length >= 2 ? word : ''
  }, [script, caretOffset])

  // Whole-word occurrence offsets for wordAtCaret. Short-circuits when
  // nothing is selected or the find bar is open (their highlights would
  // clash). Returns empty when the word has only one occurrence since
  // highlighting a unique identifier is pure visual noise.
  const wordOccurrences = useMemo<number[]>(() => {
    if (!wordAtCaret || findOpen) return []
    const out: number[] = []
    const n = wordAtCaret.length
    const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c)
    let from = 0
    while (from <= script.length - n) {
      const idx = script.indexOf(wordAtCaret, from)
      if (idx < 0) break
      const before = idx > 0 ? script[idx - 1] : ''
      const after = idx + n < script.length ? script[idx + n] : ''
      if (!isWordChar(before) && !isWordChar(after)) out.push(idx)
      from = idx + n
    }
    return out.length >= 2 ? out : []
  }, [script, wordAtCaret, findOpen])

  // Flatten the sections into an ordered chip list for the outline strip.
  // Unnamed sections fall back to "section N" so the chip is still clickable.
  const sectionOutline = useMemo(() => {
    return sections.starts.map((line, idx) => ({
      line,
      label: sections.names[line] || `section ${idx + 1}`,
    }))
  }, [sections])

  // Pick the outline entry whose start is the largest <= current caret line.
  // That's the "I'm inside this section" answer we show as active.
  const activeSectionLine = useMemo(() => {
    let best = sections.starts[0] ?? 1
    for (const s of sections.starts) {
      if (s <= cursor.line) best = s
      else break
    }
    return best
  }, [sections, cursor.line])

  // Display name for the active %% section (or null if the file has no
  // real sections). Used to drop a small "Section: foo" breadcrumb into
  // the status bar so users always know which block they're editing.
  const activeSectionLabel = useMemo(() => {
    if (sections.starts.length <= 1) return null
    const idx = sections.starts.indexOf(activeSectionLine)
    if (idx < 0) return null
    return sections.names[activeSectionLine] || `section ${idx + 1}`
  }, [sections, activeSectionLine])

  // Rough live estimate of how much memory the workspace is holding,
  // dominated by matrix storage (8 bytes per double). Strings contribute
  // ~2 bytes per UTF-16 code unit; scalars are negligible but still
  // counted for honesty. Shown in the status bar as a human-friendly
  // size so the user can spot runaway allocations before the engine
  // grinds to a halt.
  const workspaceBytes = useMemo(() => {
    let total = 0
    for (const v of vars) {
      switch (v.value.kind) {
        case 'mat':  total += v.value.data.length * 8; break
        case 'str':  total += v.value.v.length * 2; break
        case 'num':  total += 8; break
        case 'bool': total += 1; break
        default:     break
      }
    }
    return total
  }, [vars])
  const workspaceSizeLabel = useMemo(() => {
    const b = workspaceBytes
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }, [workspaceBytes])

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

  // Run the %%-delimited section containing the caret. Sections are
  // MATLAB's standard script partitioning: a block starting at either
  // the file head or a `%% name` marker line and running to the next
  // such marker (or end-of-file). Useful for long scripts where you
  // want to re-run one stage without touching the rest of the workspace.
  const runSection = useCallback(() => {
    const starts = sections.starts
    const caretLine = cursor.line
    let sectionStart = starts[0]
    for (const ln of starts) if (ln <= caretLine) sectionStart = ln
    const nextStart = starts.find(ln => ln > sectionStart) ?? lineCount + 1
    const lines = script.split('\n')
    // Skip the `%%` marker line itself so its comment text isn't echoed.
    const from = sectionStart - 1 + (/^\s*%%/.test(lines[sectionStart - 1] ?? '') ? 1 : 0)
    const to = nextStart - 1
    const fragment = lines.slice(from, to).join('\n')
    const name = sections.names[sectionStart] ?? `line ${sectionStart}`
    runFragment(fragment, `▶ run section — ${name}`)
  }, [sections, cursor.line, lineCount, script, runFragment])

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

  // Tab-completion cycle state for the console: when the user presses Tab
  // repeatedly after a partial word, we walk through the same candidate
  // list rather than re-inferring it each time. Cleared as soon as the
  // user types anything else or commits the line.
  const cmdTabCycleRef = useRef<{ prefix: string; start: number; items: string[]; idx: number } | null>(null)

  const onCmdKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab — autocomplete the partial identifier under the caret against
    // workspace variables, MATLAB builtins, and keywords. A second Tab
    // without editing cycles to the next candidate; any other keystroke
    // drops the cycle so the user can keep typing naturally.
    if (e.key === 'Tab') {
      e.preventDefault()
      const inp = e.currentTarget
      const pos = inp.selectionStart ?? cmd.length
      if (inp.selectionEnd !== pos) return
      // If the previous call left us mid-cycle and the user hasn't
      // touched the text, advance to the next candidate.
      const cached = cmdTabCycleRef.current
      if (cached && cmd.slice(0, cached.start) + cached.items[cached.idx] === cmd.slice(0, pos)) {
        const nextIdx = (cached.idx + (e.shiftKey ? -1 : 1) + cached.items.length) % cached.items.length
        const next = cached.items[nextIdx]
        const newVal = cmd.slice(0, cached.start) + next + cmd.slice(pos)
        setCmd(newVal)
        cmdTabCycleRef.current = { ...cached, idx: nextIdx }
        requestAnimationFrame(() => {
          const p = cached.start + next.length
          inp.setSelectionRange(p, p)
        })
        return
      }
      // Fresh completion from the word immediately left of the caret.
      const wb = getWordBefore(cmd, pos)
      if (!wb) return
      const prefix = wb.word
      const lower = prefix.toLowerCase()
      const seen = new Set<string>()
      const items: string[] = []
      for (const v of vars) {
        if (v.name.toLowerCase().startsWith(lower) && !seen.has(v.name)) {
          items.push(v.name); seen.add(v.name)
        }
      }
      for (const d of BUILTIN_DOCS) {
        if (d.name.toLowerCase().startsWith(lower) && !seen.has(d.name)) {
          items.push(d.name); seen.add(d.name)
        }
      }
      for (const k of MATLAB_KEYWORDS) {
        if (k.toLowerCase().startsWith(lower) && !seen.has(k)) {
          items.push(k); seen.add(k)
        }
      }
      // Put exact-prefix items that only differ in case at the front so
      // the first Tab "just works" for the obvious completion.
      items.sort((a, b) => a.length - b.length || a.localeCompare(b))
      if (items.length === 0) return
      const pick = items[0]
      const newVal = cmd.slice(0, wb.start) + pick + cmd.slice(pos)
      setCmd(newVal)
      cmdTabCycleRef.current = { prefix, start: wb.start, items, idx: 0 }
      requestAnimationFrame(() => {
        const p = wb.start + pick.length
        inp.setSelectionRange(p, p)
      })
      return
    }
    // Any keystroke that isn't Tab invalidates the cycle.
    if (cmdTabCycleRef.current) cmdTabCycleRef.current = null

    // Ctrl/Cmd + R — open the reverse history search overlay. Mirrors the
    // bash/zsh shortcut: start typing to narrow matches, Ctrl+R again to
    // cycle, Enter to accept, Esc to bail out.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault()
      if (history.length === 0) return
      setHistSearchOpen(true)
      setHistSearchQuery('')
      setHistSearchCursor(0)
      requestAnimationFrame(() => histSearchInputRef.current?.focus())
      return
    }
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
  }, [cmd, history, histIdx, runCommand, vars])

  // Filtered history matches for the Ctrl+R search overlay — deduped and
  // ordered from most recent to least recent, so the first hit is the
  // entry the user most likely wants.
  const histSearchMatches = useMemo(() => {
    if (!histSearchOpen) return []
    const q = histSearchQuery.toLowerCase()
    const seen = new Set<string>()
    const out: string[] = []
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i]
      if (seen.has(h)) continue
      if (q && !h.toLowerCase().includes(q)) continue
      seen.add(h)
      out.push(h)
    }
    return out
  }, [history, histSearchOpen, histSearchQuery])

  // Keep the cursor in range as the filter narrows or widens.
  useEffect(() => {
    if (!histSearchOpen) return
    if (histSearchCursor >= histSearchMatches.length) {
      setHistSearchCursor(Math.max(0, histSearchMatches.length - 1))
    }
  }, [histSearchOpen, histSearchCursor, histSearchMatches.length])

  const closeHistSearch = useCallback(() => {
    setHistSearchOpen(false)
    setHistSearchQuery('')
    setHistSearchCursor(0)
    requestAnimationFrame(() => cmdInputRef.current?.focus())
  }, [])

  const commitHistSearch = useCallback(() => {
    const pick = histSearchMatches[histSearchCursor]
    if (pick !== undefined) {
      setCmd(pick)
      setHistIdx(null)
    }
    closeHistSearch()
  }, [histSearchMatches, histSearchCursor, closeHistSearch])

  const onHistSearchKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); closeHistSearch(); return }
    if (e.key === 'Enter') { e.preventDefault(); commitHistSearch(); return }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault()
      // Walk to the next older match, wrapping back to the top.
      if (histSearchMatches.length === 0) return
      setHistSearchCursor(c => (c + 1) % histSearchMatches.length)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histSearchMatches.length === 0) return
      setHistSearchCursor(c => (c + 1) % histSearchMatches.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (histSearchMatches.length === 0) return
      setHistSearchCursor(c => (c - 1 + histSearchMatches.length) % histSearchMatches.length)
      return
    }
  }, [histSearchMatches, closeHistSearch, commitHistSearch])

  const clearConsole = () => setEntries([])

  // Copy the currently visible console entries as plain text so the user
  // can paste them into a note or bug report. Re-uses the visibleEntries
  // pipeline so the export respects the active kind / text filters —
  // "copy what you see" rather than dumping the full backlog.
  const [copyFlash, setCopyFlash] = useState(false)
  const copyConsole = useCallback(() => {
    const text = visibleEntries.map(e => {
      if (e.kind === 'input') return `> ${e.text}`
      if (e.kind === 'error') return `! ${e.text}`
      return e.text
    }).join('\n')
    if (!text) return
    const done = () => { setCopyFlash(true); setTimeout(() => setCopyFlash(false), 900) }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {/* ignore */})
    } else {
      // Fallback for older browsers / non-secure contexts.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); done() } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
  }, [visibleEntries])

  const resetWorkspace = () => {
    workspaceRef.current = createWorkspace()
    clearSavedWorkspace()
    setVars([])
    setPlots([])
    setActivePlot(0)
    setEntries(prev => [...prev, { id: nextEntryId++, kind: 'output', text: '— workspace cleared —' }])
  }

  // Clone the currently displayed chart SVG with a solid dark background
  // baked in. Shared between the SVG and PNG exporters so both produce
  // the same image.
  const cloneCurrentPlotSvg = useCallback((): SVGSVGElement | null => {
    const host = plotBodyRef.current
    if (!host) return null
    const svg = host.querySelector('svg')
    if (!svg) return null
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    // Preserve the original width/height as attributes so <img> can render
    // it without additional hints when we rasterize.
    const rect = svg.getBoundingClientRect()
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(rect.width))
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(rect.height))
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('width', '100%')
    bgRect.setAttribute('height', '100%')
    bgRect.setAttribute('fill', '#0a0a0a')
    clone.insertBefore(bgRect, clone.firstChild)
    return clone
  }, [])

  /** Export the currently rendered figure as SVG. */
  const exportPlotSVG = useCallback(() => {
    const clone = cloneCurrentPlotSvg()
    if (!clone) return
    const xml = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([xml], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const title = plots[activePlot]?.title?.replace(/[^\w-]+/g, '_') || `figure-${activePlot + 1}`
    a.href = url
    a.download = `${title}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }, [plots, activePlot, cloneCurrentPlotSvg])

  /** Export the currently rendered figure as PNG (rasterized at 2× DPR). */
  const exportPlotPNG = useCallback(() => {
    const clone = cloneCurrentPlotSvg()
    if (!clone) return
    const xml = new XMLSerializer().serializeToString(clone)
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload = () => {
      const widthAttr = Number(clone.getAttribute('width')) || img.width || 800
      const heightAttr = Number(clone.getAttribute('height')) || img.height || 480
      const scale = 2 // produce crisp, retina-ready output
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(widthAttr * scale)
      canvas.height = Math.round(heightAttr * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(svgUrl); return }
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(svgUrl)
      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const title = plots[activePlot]?.title?.replace(/[^\w-]+/g, '_') || `figure-${activePlot + 1}`
        a.href = url
        a.download = `${title}.png`
        a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(svgUrl) }
    img.src = svgUrl
  }, [plots, activePlot, cloneCurrentPlotSvg])

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

  // Download the whole workspace as JSON so it can be reloaded later.
  // Uses the same SerialMValue shape that powers localStorage persistence.
  const exportWorkspaceJson = useCallback(() => {
    const out: Record<string, SerialMValue> = {}
    for (const [name, v] of workspaceRef.current.vars) {
      if (name.startsWith('__')) continue
      const s = serializeMValue(v)
      if (s) out[name] = s
    }
    const blob = new Blob([JSON.stringify({ vars: out }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'workspace.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // Import a workspace JSON file, merging its variables into the live
  // workspace (existing names are overwritten). Silently ignores entries
  // that fail validation rather than aborting the whole import.
  const importWorkspaceJson = useCallback((file: File) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result ?? ''))
        if (!parsed || typeof parsed.vars !== 'object') {
          setEntries(prev => [...prev, { id: nextEntryId++, kind: 'error', text: `${file.name}: not a workspace JSON file` }])
          return
        }
        let n = 0
        for (const [name, ser] of Object.entries(parsed.vars)) {
          const v = deserializeMValue(ser as SerialMValue)
          if (v) { workspaceRef.current.vars.set(name, v); n++ }
        }
        setVars(snapshotWorkspace(workspaceRef.current))
        saveWorkspace(workspaceRef.current)
        setEntries(prev => [...prev, {
          id: nextEntryId++,
          kind: 'output',
          text: `Imported ${n} variable${n === 1 ? '' : 's'} from ${file.name}`,
        }])
      } catch (e: any) {
        setEntries(prev => [...prev, { id: nextEntryId++, kind: 'error', text: `${file.name}: ${String(e?.message ?? e)}` }])
      }
    }
    r.readAsText(file)
  }, [])

  // Delete a single variable from the workspace. Resets the inspector
  // and collapses the row if it was open.
  const deleteVariable = useCallback((name: string) => {
    workspaceRef.current.vars.delete(name)
    setVars(snapshotWorkspace(workspaceRef.current))
    saveWorkspace(workspaceRef.current)
    setExpandedVar(prev => prev === name ? null : prev)
    setInspectVar(prev => prev === name ? null : prev)
  }, [])

  // Copy a variable's contents as a literal MATLAB expression, so users
  // can paste a matrix straight into a script. Scalars and booleans use
  // their natural literal form.
  // Render a workspace value in the chosen target language. Formats are
  // picked via the small chip in the workspace panel header so users can
  // move matrices into MATLAB, Python/numpy, LaTeX, JSON, or plain CSV
  // without hand-rewriting them.
  const formatVariableAs = useCallback((v: MValue, fmt: CopyFormat): string => {
    const num = (x: number) => String(x)
    switch (v.kind) {
      case 'num':  return num(v.v)
      case 'bool':
        switch (fmt) {
          case 'python': return v.v ? 'True' : 'False'
          case 'json':   return v.v ? 'true' : 'false'
          default:       return v.v ? 'true' : 'false'
        }
      case 'str':
        switch (fmt) {
          case 'python': return JSON.stringify(v.v)
          case 'json':   return JSON.stringify(v.v)
          case 'latex':  return v.v.replace(/[\\{}$&#%_^~]/g, m => '\\' + m)
          case 'csv':    return v.v
          default:       return `'${v.v.replace(/'/g, "''")}'`
        }
      case 'void': return fmt === 'python' ? '[]' : fmt === 'json' ? '[]' : '[]'
      case 'fn':   return `@${v.name}`
      case 'mat': {
        const { rows, cols, data } = v
        const row = (r: number) => Array.from({ length: cols }, (_, c) => num(data[r * cols + c]))
        switch (fmt) {
          case 'matlab': {
            const lines = Array.from({ length: rows }, (_, r) => row(r).join(', '))
            return `[${lines.join('; ')}]`
          }
          case 'python': {
            const lines = Array.from({ length: rows }, (_, r) => `[${row(r).join(', ')}]`)
            return `np.array([${lines.join(', ')}])`
          }
          case 'latex': {
            const lines = Array.from({ length: rows }, (_, r) => row(r).join(' & '))
            return `\\begin{bmatrix}\n  ${lines.join(' \\\\\n  ')}\n\\end{bmatrix}`
          }
          case 'json': {
            const arr = Array.from({ length: rows }, (_, r) => row(r).map(Number))
            return rows === 1 ? JSON.stringify(arr[0]) : JSON.stringify(arr)
          }
          case 'csv': {
            return Array.from({ length: rows }, (_, r) => row(r).join(',')).join('\n')
          }
        }
      }
    }
  }, [])

  const copyVariableExpr = useCallback((name: string, v: MValue) => {
    const text = formatVariableAs(v, copyFormat)
    navigator.clipboard?.writeText(text).catch(() => { /* clipboard may be blocked */ })
    setEntries(prev => [...prev, {
      id: nextEntryId++,
      kind: 'output',
      text: `Copied ${name} to clipboard as ${copyFormat} (${text.length} chars)`,
    }])
  }, [copyFormat, formatVariableAs])

  // Insert a variable name at the script editor's caret (replacing any
  // active selection). Keeps focus on the editor afterwards so the user
  // can keep typing. Used by the ➤ button in the workspace var row.
  const insertVariableAtCaret = useCallback((name: string) => {
    const ta = editorRef.current
    if (!ta) return
    const s = ta.selectionStart
    const ePos = ta.selectionEnd
    setScript(prev => prev.slice(0, s) + name + prev.slice(ePos))
    requestAnimationFrame(() => {
      ta.focus()
      const pos = s + name.length
      ta.setSelectionRange(pos, pos)
    })
  }, [setScript])

  // Rename every whole-word occurrence of the identifier under the caret
  // (or the current selection, when it already covers a valid identifier)
  // to a user-supplied replacement. The replace pass is anchored with
  // word boundaries so we don't mangle substring matches inside other
  // names. Returns the number of replacements for the caller to surface.
  const renameIdentifierAtCaret = useCallback(() => {
    const ta = editorRef.current
    if (!ta) return
    const s = ta.selectionStart
    const ePos = ta.selectionEnd
    const value = ta.value
    let wStart = s, wEnd = ePos
    // If the user hasn't selected anything, expand to the identifier the
    // caret is sitting on.
    if (s === ePos) {
      while (wStart > 0 && /[A-Za-z0-9_]/.test(value[wStart - 1])) wStart--
      while (wEnd < value.length && /[A-Za-z0-9_]/.test(value[wEnd])) wEnd++
    }
    const old = value.slice(wStart, wEnd)
    if (!old || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(old)) return
    const next = prompt(`Rename "${old}" to:`, old)
    if (!next || next === old) return
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(next)) {
      alert(`"${next}" is not a valid MATLAB identifier.`)
      return
    }
    const esc = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${esc}\\b`, 'g')
    let count = 0
    const replaced = value.replace(re, () => { count++; return next })
    if (count === 0) return
    setScript(replaced)
    // After the edit lands, restore a caret on the first replacement so
    // the user can see where the change took effect.
    requestAnimationFrame(() => {
      const ta2 = editorRef.current
      if (!ta2) return
      const firstIdx = replaced.search(re)
      if (firstIdx >= 0) {
        ta2.focus()
        ta2.setSelectionRange(firstIdx, firstIdx + next.length)
      }
    })
  }, [setScript])

  // Jump the caret to the bracket that matches the one at the current
  // caret. Pass `extend=true` to grow the selection across the pair,
  // which is handy for yanking a whole parenthesised expression.
  const gotoMatchingBracket = useCallback((extend: boolean) => {
    const ta = editorRef.current
    if (!ta) return
    const pair = findBracketMatch(ta.value, ta.selectionStart)
    if (!pair) return
    const [from, to] = pair
    if (extend) {
      const start = Math.min(from, to)
      const end = Math.max(from, to) + 1
      ta.selectionStart = start
      ta.selectionEnd = end
    } else {
      ta.selectionStart = to
      ta.selectionEnd = to
    }
    const lineOfTarget = (ta.value.slice(0, to).match(/\n/g)?.length ?? 0)
    ta.scrollTop = Math.max(0, lineOfTarget * editorLineHeight - ta.clientHeight / 2)
    ta.focus()
  }, [editorLineHeight])

  // Insert a multi-line snippet at the current caret, matching the
  // indentation of the line the caret is on. Any `$0` token in the
  // snippet is removed and becomes the final caret position; otherwise
  // the caret lands at the end of the inserted block. Used by the
  // palette commands below to stamp out common MATLAB skeletons.
  const insertSnippet = useCallback((snippet: string) => {
    const ta = editorRef.current
    if (!ta) return
    const s = ta.selectionStart
    const ePos = ta.selectionEnd
    const value = ta.value
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    const indentMatch = value.slice(lineStart, s).match(/^[ \t]*/)
    const indent = indentMatch ? indentMatch[0] : ''
    const lines = snippet.split('\n')
    // Prefix every continuation line with the caret's indent so the
    // pasted block aligns with the surrounding code.
    const indented = lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n')
    const zero = indented.indexOf('$0')
    const final = zero >= 0 ? indented.slice(0, zero) + indented.slice(zero + 2) : indented
    const newVal = value.slice(0, s) + final + value.slice(ePos)
    setScript(newVal)
    const caret = zero >= 0 ? s + zero : s + final.length
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(caret, caret)
    })
  }, [setScript])

  // Dump a workspace matrix to CSV. Cells are written with full precision
  // so round-tripping through another tool doesn't introduce noise.
  const exportMatrixCsv = useCallback((name: string, v: MValue & { kind: 'mat' }) => {
    const rows: string[] = []
    for (let r = 0; r < v.rows; r++) {
      const cells: string[] = []
      for (let c = 0; c < v.cols; c++) {
        const x = v.data[r * v.cols + c]
        cells.push(Number.isFinite(x) ? String(x) : String(x))
      }
      rows.push(cells.join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

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
  // it's visible at a glance. Used by click-to-jump on error console entries
  // and by the Ctrl+G "Go to line" popup.
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
    ta.scrollTop = Math.max(0, (line - 1) * editorLineHeight - ta.clientHeight / 2)
  }, [script, editorLineHeight])

  // "Go to line" popup handlers. Seeds the input with the current line
  // number so the user can tweak the digits rather than retyping.
  const openGoto = useCallback(() => {
    setFindOpen(false) // keep the editor bar area mutually exclusive
    setGotoOpen(true)
    const ta = editorRef.current
    if (ta) {
      const before = ta.value.slice(0, ta.selectionStart)
      const ln = (before.match(/\n/g)?.length ?? 0) + 1
      setGotoQuery(String(ln))
    }
    requestAnimationFrame(() => { gotoInputRef.current?.focus(); gotoInputRef.current?.select() })
  }, [])

  const closeGoto = useCallback(() => {
    setGotoOpen(false)
    editorRef.current?.focus()
  }, [])

  const commitGoto = useCallback(() => {
    const n = parseInt(gotoQuery, 10)
    if (Number.isFinite(n) && n >= 1) {
      jumpToLine(n)
    }
    setGotoOpen(false)
  }, [gotoQuery, jumpToLine])

  // Bookmarks. We keep a Set<number> of 1-indexed line numbers in a ref map
  // keyed by script id. Callers mutate the active script's entry and then
  // mirror it into `bookmarkLines` state so React re-renders the gutter.
  const getActiveBookmarkSet = useCallback((): Set<number> => {
    const id = scriptStore.activeId
    let set = scriptBookmarksRef.current.get(id)
    if (!set) {
      set = new Set()
      scriptBookmarksRef.current.set(id, set)
    }
    return set
  }, [scriptStore.activeId])

  const toggleBookmark = useCallback((line: number) => {
    if (line < 1) return
    const set = getActiveBookmarkSet()
    if (set.has(line)) set.delete(line)
    else set.add(line)
    setBookmarkLines(new Set(set))
  }, [getActiveBookmarkSet])

  const toggleBookmarkAtCaret = useCallback(() => {
    const ta = editorRef.current
    if (!ta) return
    const before = ta.value.slice(0, ta.selectionStart)
    const line = (before.match(/\n/g)?.length ?? 0) + 1
    toggleBookmark(line)
  }, [toggleBookmark])

  const gotoBookmark = useCallback((dir: 1 | -1) => {
    const set = getActiveBookmarkSet()
    if (set.size === 0) return
    const sorted = Array.from(set).sort((a, b) => a - b)
    const ta = editorRef.current
    const curLine = (() => {
      if (!ta) return 1
      const before = ta.value.slice(0, ta.selectionStart)
      return (before.match(/\n/g)?.length ?? 0) + 1
    })()
    let target: number
    if (dir === 1) {
      target = sorted.find(l => l > curLine) ?? sorted[0]
    } else {
      let found = sorted[sorted.length - 1]
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i] < curLine) { found = sorted[i]; break }
      }
      // If current line was before the first bookmark, wrap to the last.
      if (sorted.every(l => l >= curLine)) found = sorted[sorted.length - 1]
      target = found
    }
    jumpToLine(target)
  }, [getActiveBookmarkSet, jumpToLine])

  const clearAllBookmarks = useCallback(() => {
    const set = getActiveBookmarkSet()
    if (set.size === 0) return
    set.clear()
    setBookmarkLines(new Set())
  }, [getActiveBookmarkSet])

  // Keyboard shortcuts inside the editor:
  //   Cmd/Ctrl+Enter        — run script
  //   Shift+Cmd/Ctrl+Enter  — run selection (or current line)
  //   Alt+Cmd/Ctrl+Enter    — run current %% section
  //   F9                     — run selection (MATLAB convention)
  //   Cmd/Ctrl+F            — find / replace panel
  //   Ctrl+/                — toggle line comment (%)
  //   Tab / Shift+Tab — indent / outdent current selection (2 spaces)
  //   Enter           — auto-indent to match the previous line
  //   ( [ { " '       — auto-pair brackets / quotes
  //   ) ] }           — skip over matching closer
  //   Backspace       — delete matching pair when between them
  const onEditorKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Dismiss the signature hint on Escape. Other keys are handled by
    // updateCursor (line change) or the auto-skip of ')' below.
    if (e.key === 'Escape' && sigHint) {
      setSigHint(null)
      // fall through so Escape can also close autocomplete if open
    }
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
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === 'Enter') {
      e.preventDefault()
      runSection()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault()
      openFind()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault()
      openGoto()
      return
    }
    // Ctrl/Cmd + M — jump to matching bracket at caret. Shift extends the
    // selection from the current caret to the match, making it easy to
    // grab an entire parenthesised expression or brace block.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault()
      gotoMatchingBracket(e.shiftKey)
      requestAnimationFrame(() => {
        const ta2 = editorRef.current
        if (ta2) updateCursor(ta2)
      })
      return
    }
    // F2 family — line bookmarks.
    //   Ctrl/Cmd + F2 → toggle bookmark on current line
    //   F2            → jump to next bookmark (wraps)
    //   Shift + F2    → jump to previous bookmark (wraps)
    if (e.key === 'F2') {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) {
        toggleBookmarkAtCaret()
      } else if (e.shiftKey) {
        gotoBookmark(-1)
      } else {
        gotoBookmark(1)
      }
      return
    }
    const ta = e.currentTarget
    const { selectionStart: s, selectionEnd: ePos, value } = ta

    // Ctrl / Cmd + D — select word at caret, or if the current selection
    // is already a word, jump to and select the next occurrence. Mirrors
    // VSCode's "Select next occurrence" shortcut as closely as a single-
    // selection textarea allows (no true multi-cursor).
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault()
      const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c)
      if (s === ePos) {
        // Nothing selected: expand to the identifier under the caret.
        let wStart = s, wEnd = s
        while (wStart > 0 && isWordChar(value[wStart - 1])) wStart--
        while (wEnd < value.length && isWordChar(value[wEnd])) wEnd++
        if (wStart === wEnd) return
        ta.selectionStart = wStart
        ta.selectionEnd = wEnd
        updateCursor(ta)
        return
      }
      // Current selection is the seed; jump to the next whole-word match.
      const seed = value.slice(s, ePos)
      if (!seed || !/^[A-Za-z0-9_]+$/.test(seed)) return
      let from = ePos
      while (from <= value.length - seed.length) {
        const idx = value.indexOf(seed, from)
        if (idx < 0) break
        const before = idx > 0 ? value[idx - 1] : ''
        const after = idx + seed.length < value.length ? value[idx + seed.length] : ''
        if (!isWordChar(before) && !isWordChar(after)) {
          ta.selectionStart = idx
          ta.selectionEnd = idx + seed.length
          const lineOfMatch = (value.slice(0, idx).match(/\n/g)?.length ?? 0)
          ta.scrollTop = Math.max(0, lineOfMatch * editorLineHeight - ta.clientHeight / 2)
          updateCursor(ta)
          return
        }
        from = idx + seed.length
      }
      // No next match: wrap to the start of the buffer and try once more.
      from = 0
      while (from < s) {
        const idx = value.indexOf(seed, from)
        if (idx < 0 || idx >= s) break
        const before = idx > 0 ? value[idx - 1] : ''
        const after = idx + seed.length < value.length ? value[idx + seed.length] : ''
        if (!isWordChar(before) && !isWordChar(after)) {
          ta.selectionStart = idx
          ta.selectionEnd = idx + seed.length
          const lineOfMatch = (value.slice(0, idx).match(/\n/g)?.length ?? 0)
          ta.scrollTop = Math.max(0, lineOfMatch * editorLineHeight - ta.clientHeight / 2)
          updateCursor(ta)
          return
        }
        from = idx + seed.length
      }
      return
    }

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

    // Ctrl / Cmd + Shift + K — delete the current line(s). Mirrors VSCode
    // behaviour: the caret lands at the start of whatever followed the
    // deleted region, with no text selected.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const lineEnd = value.indexOf('\n', ePos)
      // If the region ends at EOF, also drop the preceding '\n' so we don't
      // leave a dangling empty line behind.
      let regionStart = lineStart
      let regionEnd: number
      if (lineEnd < 0) {
        regionEnd = value.length
        if (lineStart > 0) regionStart = lineStart - 1
      } else {
        regionEnd = lineEnd + 1
      }
      const newVal = value.slice(0, regionStart) + value.slice(regionEnd)
      setScript(newVal)
      requestAnimationFrame(() => {
        const pos = Math.min(regionStart, newVal.length)
        ta.selectionStart = pos
        ta.selectionEnd = pos
      })
      return
    }

    // Shift + Alt + ArrowDown / ArrowUp — duplicate the current line(s)
    if (e.altKey && e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const lineEnd = value.indexOf('\n', ePos)
      const regionEnd = lineEnd < 0 ? value.length : lineEnd
      const block = value.slice(lineStart, regionEnd)
      // Insert '\n' + block directly after the current region so we get one
      // clean copy immediately below. The original block keeps its position.
      const newVal = value.slice(0, regionEnd) + '\n' + block + value.slice(regionEnd)
      setScript(newVal)
      const shift = block.length + 1
      requestAnimationFrame(() => {
        if (e.key === 'ArrowDown') {
          // Move caret/selection to the duplicated copy below.
          ta.selectionStart = s + shift
          ta.selectionEnd = ePos + shift
        } else {
          // Keep caret/selection on the original (top) copy.
          ta.selectionStart = s
          ta.selectionEnd = ePos
        }
      })
      return
    }

    // Alt + ArrowUp / ArrowDown — move the current line(s) up or down by one.
    if (e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const lineEnd = value.indexOf('\n', ePos)
      const regionEnd = lineEnd < 0 ? value.length : lineEnd
      if (e.key === 'ArrowUp') {
        if (lineStart === 0) return // already at the top
        e.preventDefault()
        const prevStart = value.lastIndexOf('\n', lineStart - 2) + 1
        const prevBlock = value.slice(prevStart, lineStart) // includes trailing '\n'
        const block = value.slice(lineStart, regionEnd)
        // If the current block was the last line (no trailing '\n'), we need
        // to donate a '\n' to the now-top block and strip the '\n' off the
        // prevBlock so the separator stays in place after the swap.
        const curHasNL = regionEnd < value.length && value[regionEnd] === '\n'
        const newBottom = curHasNL ? prevBlock : prevBlock.slice(0, -1)
        const tailStart = curHasNL ? regionEnd + 1 : regionEnd
        const newVal =
          value.slice(0, prevStart) +
          block + '\n' +
          newBottom +
          value.slice(tailStart)
        setScript(newVal)
        const delta = -prevBlock.length
        requestAnimationFrame(() => {
          ta.selectionStart = s + delta
          ta.selectionEnd = ePos + delta
        })
        return
      } else {
        if (regionEnd >= value.length) return // already at the bottom
        e.preventDefault()
        const nextStart = regionEnd + 1 // skip the '\n' separator
        const nextEndNL = value.indexOf('\n', nextStart)
        const nextEnd = nextEndNL < 0 ? value.length : nextEndNL
        const block = value.slice(lineStart, regionEnd)
        const nextBlock = value.slice(nextStart, nextEnd)
        const nextTrailing = value.slice(nextEnd, nextEnd + 1) // '\n' or ''
        const newVal =
          value.slice(0, lineStart) +
          nextBlock + '\n' +
          block + nextTrailing +
          value.slice(nextEnd + nextTrailing.length)
        setScript(newVal)
        const delta = nextBlock.length + 1
        requestAnimationFrame(() => {
          ta.selectionStart = s + delta
          ta.selectionEnd = ePos + delta
        })
        return
      }
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
          setAcAnchor(caretViewportAnchor(ta, editorFontSize))
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
        // If we just opened a function call like "sin(", pop up the
        // signature hint for the matching builtin.
        if (open === '(') {
          const wb = getWordBefore(value, s)
          if (wb) {
            const doc = BUILTIN_DOCS.find(d => d.name === wb.word)
            if (doc) {
              const before = value.slice(0, s)
              const ln = (before.match(/\n/g)?.length ?? 0) + 1
              requestAnimationFrame(() => {
                const anchor = caretViewportAnchor(ta, editorFontSize)
                setSigHint({
                  signature: doc.signature,
                  description: doc.description,
                  line: ln,
                  anchor,
                })
              })
            }
          }
        }
      }
      return
    }

    if (CLOSERS.has(e.key) && s === ePos && value[s] === e.key) {
      // Closing bracket that already exists: skip over it. If it was ')'
      // and the signature hint is open, dismiss it — the user is done
      // with the call.
      e.preventDefault()
      if (e.key === ')' && sigHint) setSigHint(null)
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

    // Smart dedent: when the user finishes typing a block-closing keyword
    // as the only content on an otherwise-blank line, pop one indent level
    // so the closer lines up with its opener. Complements the Enter
    // auto-indent: typing `if⏎ body⏎ end` now lands `end` at the outer
    // indent without any manual correction.
    if (
      s === ePos && !e.ctrlKey && !e.metaKey && !e.altKey && !acOpen &&
      e.key.length === 1 && /[A-Za-z]/.test(e.key)
    ) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const currentLine = value.slice(lineStart, s)
      const afterInsert = currentLine + e.key
      const trimmed = afterInsert.trimStart()
      const indentStr = afterInsert.slice(0, afterInsert.length - trimmed.length)
      // Closer set is intentionally chosen so none is a prefix of another
      // (so typing `endif` only fires once at `end`, not again at `endif`).
      const CLOSERS = new Set(['end', 'else', 'catch', 'otherwise', 'case'])
      if (CLOSERS.has(trimmed) && indentStr.length >= 2) {
        e.preventDefault()
        const newVal =
          value.slice(0, lineStart) +
          indentStr.slice(2) +
          trimmed +
          value.slice(ePos)
        setScript(newVal)
        requestAnimationFrame(() => {
          const pos = s - 1 // removed 2 indent chars, added 1 key char
          ta.selectionStart = ta.selectionEnd = pos
        })
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // Copy leading whitespace of the current line to the new one, and add
      // one extra indent step if the previous line opens a block. Mirrors
      // the feel of a standard MATLAB editor — `if cond⏎` lands the caret
      // two spaces deeper than `cond` itself.
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const currentLine = value.slice(lineStart, s)
      const m = currentLine.match(/^\s*/)
      const indent = m ? m[0] : ''
      // Strip trailing comments (% …) before checking the first token so
      // "if cond  % guard" still triggers the extra indent.
      const codePart = currentLine.replace(/%.*$/, '').trimEnd()
      const firstTokMatch = codePart.trimStart().match(/^([A-Za-z_]\w*)/)
      const firstTok = firstTokMatch ? firstTokMatch[1] : ''
      const BLOCK_OPENERS = new Set([
        'if', 'elseif', 'else',
        'for', 'while', 'do',
        'switch', 'case', 'otherwise',
        'try', 'catch',
        'function',
      ])
      // Avoid double-indenting one-liners like `if cond; body; end`. Crude
      // but effective: if the line already contains an `end` token, treat
      // the block as closed inline.
      const hasInlineEnd = /(^|[\s;,])end(\b|[\s;,]|$)/.test(codePart)
      const opensBlock = BLOCK_OPENERS.has(firstTok) && !hasInlineEnd
      const extraIndent = opensBlock ? '  ' : ''
      if (!indent && !extraIndent) return // let default handle it
      e.preventDefault()
      const newIndent = indent + extraIndent
      const newVal = value.slice(0, s) + '\n' + newIndent + value.slice(ePos)
      setScript(newVal)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 1 + newIndent.length
      })
    }
  }, [runScript, runSelection, runSection, openFind, openGoto, setScript, vars, acOpen, acItems, acIndex, acceptAutocomplete, closeAutocomplete, editorFontSize, sigHint, toggleBookmarkAtCaret, gotoBookmark, gotoMatchingBracket])

  // Track cursor position and selection size for the status bar.
  const updateCursor = useCallback((ta: HTMLTextAreaElement) => {
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const line = (before.match(/\n/g)?.length ?? 0) + 1
    const col = pos - before.lastIndexOf('\n')
    setCursor({ line, col })
    const selLen = ta.selectionEnd - ta.selectionStart
    if (selLen > 0) {
      const selText = ta.value.slice(ta.selectionStart, ta.selectionEnd)
      const nl = (selText.match(/\n/g)?.length ?? 0)
      setSelectionInfo({ chars: selLen, lines: nl + 1 })
    } else {
      setSelectionInfo(null)
    }
    // Close the signature hint if the caret walked off its line.
    setSigHint(prev => (prev && prev.line !== line ? null : prev))
  }, [])

  const onEditorSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    updateCursor(e.currentTarget)
  }, [updateCursor])

  // Save and restore per-script editor state (scroll + selection) when the
  // active tab changes. We capture the outgoing script's state directly
  // from the textarea before React rerenders, then apply the incoming
  // script's state on the next frame (after the new code has been
  // committed to the DOM). New scripts with no saved state fall back to
  // scroll-to-top, caret at 0 — matching a fresh open.
  useEffect(() => {
    const prevId = prevScriptIdRef.current
    const currId = scriptStore.activeId
    if (prevId === currId) return
    const ta = editorRef.current
    if (ta && prevId) {
      scriptViewStateRef.current.set(prevId, {
        scrollTop: ta.scrollTop,
        scrollLeft: ta.scrollLeft,
        selStart: ta.selectionStart,
        selEnd: ta.selectionEnd,
      })
    }
    prevScriptIdRef.current = currId
    // Sync the visible bookmark set to whatever the new script has saved.
    const nextBookmarks = scriptBookmarksRef.current.get(currId)
    setBookmarkLines(nextBookmarks ? new Set(nextBookmarks) : new Set())
    requestAnimationFrame(() => {
      const ta2 = editorRef.current
      if (!ta2) return
      const saved = scriptViewStateRef.current.get(currId)
      if (saved) {
        const len = ta2.value.length
        ta2.scrollTop = saved.scrollTop
        ta2.scrollLeft = saved.scrollLeft
        ta2.selectionStart = Math.min(saved.selStart, len)
        ta2.selectionEnd = Math.min(saved.selEnd, len)
      } else {
        ta2.scrollTop = 0
        ta2.scrollLeft = 0
        ta2.selectionStart = ta2.selectionEnd = 0
      }
      updateCursor(ta2)
      // Setting scrollTop/scrollLeft programmatically doesn't always fire
      // the scroll event consistently, so nudge the overlay transforms
      // directly to match.
      const sTop = ta2.scrollTop
      const sLeft = ta2.scrollLeft
      if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-sTop}px)`
      if (highlightRef.current) highlightRef.current.style.transform = `translate(${-sLeft}px, ${-sTop}px)`
      if (indentGuideRef.current) indentGuideRef.current.style.transform = `translate(${-sLeft}px, ${-sTop}px)`
      if (bracketOverlayRef.current) bracketOverlayRef.current.style.transform = `translate(${-sLeft}px, ${-sTop}px)`
      if (findOverlayRef.current) findOverlayRef.current.style.transform = `translate(${-sLeft}px, ${-sTop}px)`
      if (wordOverlayRef.current) wordOverlayRef.current.style.transform = `translate(${-sLeft}px, ${-sTop}px)`
      if (currentLineRef.current) currentLineRef.current.style.transform = `translateY(${-sTop}px)`
    })
  }, [scriptStore.activeId, updateCursor])

  const onEditorScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-scrollTop}px)`
    }
    if (highlightRef.current) {
      highlightRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
    }
    if (indentGuideRef.current) {
      indentGuideRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
    }
    if (bracketOverlayRef.current) {
      bracketOverlayRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
    }
    if (findOverlayRef.current) {
      findOverlayRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
    }
    if (wordOverlayRef.current) {
      wordOverlayRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
    }
    if (currentLineRef.current) {
      // Only the vertical scroll matters for the horizontal strip.
      currentLineRef.current.style.transform = `translateY(${-scrollTop}px)`
    }
    // The signature hint uses fixed-viewport coordinates, so scrolling the
    // editor would leave it stranded. Dismiss rather than chasing the anchor.
    setSigHint(null)
  }, [])

  // Match positions for find/replace. Each entry has a start offset and
  // a length, so regex matches with variable widths work the same as
  // plain substring matches. Recomputed whenever script, query, or the
  // find modifiers change. A syntactically invalid regex falls back to
  // an empty result and surfaces the error in `findError`.
  const findMatches = useMemo<Array<{ start: number; len: number }>>(() => {
    if (!findQuery) { setFindError(null); return [] }
    const out: Array<{ start: number; len: number }> = []
    if (findRegex) {
      try {
        const flags = findCaseSensitive ? 'g' : 'gi'
        const re = new RegExp(findQuery, flags)
        let m: RegExpExecArray | null
        let guard = 0
        while ((m = re.exec(script)) !== null) {
          // Empty matches (e.g. "a*") would loop forever — nudge past.
          const len = m[0].length
          out.push({ start: m.index, len })
          if (len === 0) re.lastIndex = m.index + 1
          if (++guard > 10000) break
        }
        setFindError(null)
      } catch (err) {
        setFindError(err instanceof Error ? err.message : 'invalid regex')
        return []
      }
    } else {
      const hay = findCaseSensitive ? script : script.toLowerCase()
      const needle = findCaseSensitive ? findQuery : findQuery.toLowerCase()
      let from = 0
      while (from <= hay.length - needle.length) {
        const idx = hay.indexOf(needle, from)
        if (idx < 0) break
        out.push({ start: idx, len: needle.length })
        from = idx + Math.max(1, needle.length)
      }
      setFindError(null)
    }
    return out
  }, [script, findQuery, findRegex, findCaseSensitive])

  // Keep matchIdx in range as matches shift.
  useEffect(() => {
    if (findMatches.length === 0) { setMatchIdx(0); return }
    if (matchIdx >= findMatches.length) setMatchIdx(0)
  }, [findMatches, matchIdx])

  const selectMatch = useCallback((idx: number) => {
    const ta = editorRef.current
    if (!ta || findMatches.length === 0) return
    const safe = ((idx % findMatches.length) + findMatches.length) % findMatches.length
    const m = findMatches[safe]
    const start = m.start
    const end = start + m.len
    ta.focus()
    ta.setSelectionRange(start, end)
    // Scroll the match into view using the live editor line height so the
    // math stays right when the user has bumped the font size.
    const lineOfMatch = (script.slice(0, start).match(/\n/g)?.length ?? 0)
    ta.scrollTop = Math.max(0, lineOfMatch * editorLineHeight - ta.clientHeight / 2)
    setMatchIdx(safe)
  }, [findMatches, script, editorLineHeight])

  const findNext = useCallback(() => selectMatch(matchIdx + 1), [selectMatch, matchIdx])
  const findPrev = useCallback(() => selectMatch(matchIdx - 1), [selectMatch, matchIdx])

  const replaceOne = useCallback(() => {
    if (findMatches.length === 0 || !findQuery) return
    const safe = Math.min(matchIdx, findMatches.length - 1)
    const m = findMatches[safe]
    const start = m.start
    const end = start + m.len
    // In regex mode honour backreferences like $1 in the replacement.
    let piece = replaceQuery
    if (findRegex) {
      try {
        const flags = findCaseSensitive ? '' : 'i'
        const re = new RegExp(findQuery, flags)
        piece = script.slice(start, end).replace(re, replaceQuery)
      } catch { /* fall through to literal replacement */ }
    }
    const next = script.slice(0, start) + piece + script.slice(end)
    setScript(next)
    // After the state update lands, highlight the next occurrence (or stay
    // in place if none remain).
    requestAnimationFrame(() => {
      const ta = editorRef.current
      if (!ta) return
      const pos = start + piece.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }, [findMatches, findQuery, findRegex, findCaseSensitive, matchIdx, replaceQuery, script, setScript])

  const replaceAll = useCallback(() => {
    if (findMatches.length === 0 || !findQuery) return
    try {
      if (findRegex) {
        const flags = findCaseSensitive ? 'g' : 'gi'
        const re = new RegExp(findQuery, flags)
        setScript(script.replace(re, replaceQuery))
      } else {
        // Plain substring replace, escaped into a regex so we can do it in
        // one pass while still honouring the case-sensitivity toggle.
        const esc = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const flags = findCaseSensitive ? 'g' : 'gi'
        const re = new RegExp(esc, flags)
        // Escape $ in the literal replacement so '$1' etc. aren't
        // interpreted as backreferences in non-regex mode.
        const literal = replaceQuery.replace(/\$/g, '$$$$')
        setScript(script.replace(re, literal))
      }
    } catch { /* invalid regex — surfaced via findError already */ }
  }, [findMatches, findQuery, findRegex, findCaseSensitive, replaceQuery, script, setScript])

  const handleUpload = useCallback((ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = ev.target.files
    if (!files || files.length === 0) return
    // Walk every selected file (the input supports multi-select) and
    // turn each one into its own script tab. The last file read wins
    // the active slot so the user lands on the final one they picked.
    const list = Array.from(files)
    let completed = 0
    const loaded: Array<{ name: string; code: string }> = new Array(list.length)
    list.forEach((f, idx) => {
      const r = new FileReader()
      r.onload = () => {
        loaded[idx] = { name: f.name || `upload-${idx + 1}.m`, code: String(r.result ?? '') }
        completed++
        if (completed === list.length) {
          setScriptStore(store => {
            const newScripts: SavedScript[] = loaded.map(x => ({ id: makeScriptId(), name: x.name, code: x.code }))
            return {
              list: [...store.list, ...newScripts],
              activeId: newScripts[newScripts.length - 1].id,
            }
          })
        }
      }
      r.readAsText(f)
    })
    ev.target.value = ''
  }, [])

  // Parse a CSV blob into a numeric matrix and bind it to the workspace
  // under a name derived from the filename. Non-numeric cells become NaN
  // so the user can still inspect the shape and see what failed to parse.
  const importCsv = useCallback((file: File) => {
    const r = new FileReader()
    r.onload = () => {
      const text = String(r.result ?? '').replace(/\r/g, '')
      const rawLines = text.split('\n').filter(l => l.length > 0)
      if (rawLines.length === 0) return
      // If the first line has any non-numeric cells, treat it as a header.
      const first = rawLines[0].split(',').map(s => s.trim())
      const firstIsHeader = first.some(s => s !== '' && !Number.isFinite(Number(s)))
      const lines = firstIsHeader ? rawLines.slice(1) : rawLines
      if (lines.length === 0) return
      const cols = lines[0].split(',').length
      const rows = lines.length
      const data = new Float64Array(rows * cols)
      for (let r = 0; r < rows; r++) {
        const parts = lines[r].split(',')
        for (let c = 0; c < cols; c++) {
          const cell = (parts[c] ?? '').trim()
          data[r * cols + c] = cell === '' ? NaN : Number(cell)
        }
      }
      const mat: MValue = { kind: 'mat', rows, cols, data }
      // Derive a valid identifier from the filename.
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_')
      let name = /^[A-Za-z_]/.test(base) ? base : `data_${base}`
      if (!name) name = 'data'
      workspaceRef.current.vars.set(name, mat)
      setVars(snapshotWorkspace(workspaceRef.current))
      saveWorkspace(workspaceRef.current)
      setEntries(prev => [...prev, {
        id: nextEntryId++,
        kind: 'output',
        text: `Imported ${file.name} → ${name} (${rows}×${cols})${firstIsHeader ? ' · header row skipped' : ''}`,
      }])
    }
    r.readAsText(file)
  }, [])

  // Top-level drag/drop on the whole Workstation: .csv files become
  // workspace variables, .m/.txt files become new script tabs.
  const onWsDragOver = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    if (ev.dataTransfer.types.includes('Files')) {
      ev.preventDefault()
      setDropHover(true)
    }
  }, [])
  const onWsDragLeave = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    // Only clear when the drag actually leaves the outer container.
    if (ev.target === ev.currentTarget) setDropHover(false)
  }, [])
  const onWsDrop = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    if (!ev.dataTransfer.files.length) return
    ev.preventDefault()
    setDropHover(false)
    for (const f of Array.from(ev.dataTransfer.files)) {
      const ext = f.name.toLowerCase().replace(/^.*\./, '')
      if (ext === 'csv') {
        importCsv(f)
      } else if (ext === 'json') {
        importWorkspaceJson(f)
      } else if (ext === 'm' || ext === 'txt') {
        const r = new FileReader()
        r.onload = () => {
          const code = String(r.result ?? '')
          setScriptStore(store => {
            const id = makeScriptId()
            return {
              list: [...store.list, { id, name: f.name, code }],
              activeId: id,
            }
          })
        }
        r.readAsText(f)
      }
    }
  }, [importCsv, importWorkspaceJson])

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
      // Remember the closed script (plus its original position) so
      // Ctrl+Shift+T can restore it at the same spot.
      const closed = store.list[idx]
      closedScriptsRef.current.push({ script: closed, index: idx })
      // Cap the ring so we don't grow without bound.
      if (closedScriptsRef.current.length > 12) closedScriptsRef.current.shift()
      const list = store.list.filter(s => s.id !== id)
      const activeId = store.activeId === id
        ? (list[idx] ?? list[idx - 1] ?? list[0]).id
        : store.activeId
      return { list, activeId }
    })
  }, [])

  // Ring of recently-closed scripts so the user can undo an accidental
  // tab close via Ctrl/Cmd+Shift+T — standard IDE behaviour. Held in a
  // ref rather than state because we only read it inside event handlers;
  // no render depends on the ring contents.
  const closedScriptsRef = useRef<Array<{ script: SavedScript; index: number }>>([])
  const reopenLastClosedScript = useCallback(() => {
    const entry = closedScriptsRef.current.pop()
    if (!entry) return
    setScriptStore(store => {
      // Don't re-add a script whose id is already present (edge case if
      // the user rapidly new-script / reopen — just no-op to stay safe).
      if (store.list.some(s => s.id === entry.script.id)) return store
      const list = store.list.slice()
      const at = Math.min(Math.max(0, entry.index), list.length)
      list.splice(at, 0, entry.script)
      return { list, activeId: entry.script.id }
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

  // Duplicate a script tab — creates an exact copy of the given script's
  // code under a derived name (` (copy)`, ` (copy 2)`, …) immediately
  // after the source in the tab bar and switches focus to it. Used by
  // the palette command and the tab right-click menu.
  const duplicateScript = useCallback((id: string) => {
    setScriptStore(store => {
      const src = store.list.find(s => s.id === id)
      if (!src) return store
      // Build a non-colliding name: "foo.m" → "foo (copy).m",
      // "foo (copy).m" → "foo (copy 2).m", and so on.
      const dotIdx = src.name.lastIndexOf('.')
      const base = dotIdx > 0 ? src.name.slice(0, dotIdx) : src.name
      const ext  = dotIdx > 0 ? src.name.slice(dotIdx) : ''
      const stripped = base.replace(/\s*\(copy(?:\s+\d+)?\)\s*$/, '')
      const existing = new Set(store.list.map(s => s.name))
      let candidate = `${stripped} (copy)${ext}`
      let n = 2
      while (existing.has(candidate)) {
        candidate = `${stripped} (copy ${n})${ext}`
        n++
      }
      const dup: SavedScript = { id: makeScriptId(), name: candidate, code: src.code }
      const idx = store.list.findIndex(s => s.id === id)
      const list = store.list.slice()
      list.splice(idx + 1, 0, dup)
      return { list, activeId: dup.id }
    })
  }, [])

  // Reorder a script tab — used by the drag-and-drop handlers in the tab
  // bar. `targetId` is the tab currently being hovered; the dragged tab
  // slides into the target's position. Dropping onto the already-dragged
  // tab is a no-op.
  const reorderScriptTab = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    setScriptStore(store => {
      const list = store.list.slice()
      const fromIdx = list.findIndex(s => s.id === draggedId)
      const toIdx = list.findIndex(s => s.id === targetId)
      if (fromIdx < 0 || toIdx < 0) return store
      const [moved] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, moved)
      return { ...store, list }
    })
  }, [])

  // Command palette handlers. Open resets the query and focuses the input
  // so the user can start typing immediately; close returns focus to the
  // editor so the keyboard flow stays uninterrupted.
  const openPalette = useCallback(() => {
    setPaletteQuery('')
    setPaletteIndex(0)
    setPaletteOpen(true)
    requestAnimationFrame(() => paletteInputRef.current?.focus())
  }, [])
  const closePalette = useCallback(() => {
    setPaletteOpen(false)
    editorRef.current?.focus()
  }, [])

  // Ordered command list. Kept as a memo so downstream filter passes are
  // cheap and the array identity is stable across renders.
  const paletteCommands = useMemo(() => [
    { id: 'run',          title: 'Run script',                   hint: 'Ctrl+Enter',       run: () => runScript() },
    { id: 'run-sel',      title: 'Run selection',                hint: 'F9',               run: () => runSelection() },
    { id: 'run-sec',      title: 'Run current %% section',       hint: 'Alt+Ctrl+Enter',   run: () => runSection() },
    { id: 'find',         title: 'Find and replace',             hint: 'Ctrl+F',           run: () => openFind() },
    { id: 'goto',         title: 'Go to line',                   hint: 'Ctrl+G',           run: () => openGoto() },
    { id: 'new-script',   title: 'New script',                   hint: '',                 run: () => newScript() },
    { id: 'dup-script',   title: 'Duplicate current script',     hint: '',                 run: () => duplicateScript(scriptStore.activeId) },
    { id: 'close-script', title: 'Close current script',         hint: 'Ctrl+W',           run: () => closeScript(scriptStore.activeId) },
    { id: 'reopen',       title: 'Reopen last closed script',    hint: 'Ctrl+Shift+T',     run: () => reopenLastClosedScript() },
    { id: 'rename',       title: 'Rename current script',        hint: '',                 run: () => renameScript(scriptStore.activeId) },
    { id: 'wrap',         title: 'Toggle word wrap',             hint: '',                 run: () => toggleEditorWrap() },
    { id: 'font-up',      title: 'Increase editor font size',    hint: '',                 run: () => bumpEditorFont(1) },
    { id: 'font-down',    title: 'Decrease editor font size',    hint: '',                 run: () => bumpEditorFont(-1) },
    { id: 'clear-con',    title: 'Clear console',                hint: 'Ctrl+L',           run: () => clearConsole() },
    { id: 'copy-con',     title: 'Copy console to clipboard',    hint: '',                 run: () => copyConsole() },
    { id: 'reset-ws',     title: 'Reset workspace',              hint: '',                 run: () => resetWorkspace() },
    { id: 'exp-svg',      title: 'Export current figure as SVG', hint: '',                 run: () => exportPlotSVG() },
    { id: 'exp-png',      title: 'Export current figure as PNG', hint: '',                 run: () => exportPlotPNG() },
    { id: 'exp-csv',      title: 'Export figure data as CSV',    hint: '',                 run: () => exportPlotCSV() },
    { id: 'bm-toggle',    title: 'Toggle bookmark on current line', hint: 'Ctrl+F2',       run: () => toggleBookmarkAtCaret() },
    { id: 'bm-next',      title: 'Jump to next bookmark',        hint: 'F2',               run: () => gotoBookmark(1) },
    { id: 'bm-prev',      title: 'Jump to previous bookmark',    hint: 'Shift+F2',         run: () => gotoBookmark(-1) },
    { id: 'bm-clear',     title: 'Clear bookmarks in this script', hint: '',               run: () => clearAllBookmarks() },
    { id: 'snip-for',     title: 'Insert snippet: for loop',     hint: '',                 run: () => insertSnippet('for i = 1:$0\n  \nend\n') },
    { id: 'snip-while',   title: 'Insert snippet: while loop',   hint: '',                 run: () => insertSnippet('while $0\n  \nend\n') },
    { id: 'snip-if',      title: 'Insert snippet: if / else',    hint: '',                 run: () => insertSnippet('if $0\n  \nelse\n  \nend\n') },
    { id: 'snip-switch',  title: 'Insert snippet: switch / case', hint: '',                run: () => insertSnippet('switch $0\n  case \n    \n  otherwise\n    \nend\n') },
    { id: 'snip-fn',      title: 'Insert snippet: function',     hint: '',                 run: () => insertSnippet('function [out] = $0(in)\n  \nend\n') },
    { id: 'snip-try',     title: 'Insert snippet: try / catch',  hint: '',                 run: () => insertSnippet('try\n  $0\ncatch err\n  disp(err.message)\nend\n') },
    { id: 'snip-sec',     title: 'Insert snippet: %% section header', hint: '',            run: () => insertSnippet('%% $0\n') },
    { id: 'rename-id',    title: 'Rename identifier at caret',   hint: '',                 run: () => renameIdentifierAtCaret() },
    { id: 'goto-bracket', title: 'Go to matching bracket',       hint: 'Ctrl+M',           run: () => gotoMatchingBracket(false) },
    { id: 'sel-bracket',  title: 'Select to matching bracket',   hint: 'Ctrl+Shift+M',     run: () => gotoMatchingBracket(true) },
    { id: 'help',         title: 'Show keyboard shortcuts',      hint: 'F1',               run: () => setHelpOpen(true) },
  ], [runScript, runSelection, runSection, openFind, openGoto, newScript, duplicateScript, closeScript, reopenLastClosedScript, renameScript, scriptStore.activeId, toggleEditorWrap, bumpEditorFont, copyConsole, exportPlotSVG, exportPlotPNG, exportPlotCSV, toggleBookmarkAtCaret, gotoBookmark, clearAllBookmarks, insertSnippet, renameIdentifierAtCaret, gotoMatchingBracket])

  // Fuzzy-ish filter: split the query into tokens and require each to
  // appear (substring, case-insensitive) in the command title. Keeps
  // results predictable without pulling in a scoring library.
  const visiblePaletteCommands = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase()
    if (!q) return paletteCommands
    const tokens = q.split(/\s+/)
    return paletteCommands.filter(c => {
      const hay = c.title.toLowerCase()
      return tokens.every(t => hay.includes(t))
    })
  }, [paletteCommands, paletteQuery])

  // Keep the highlighted item index in range as the filter narrows.
  useEffect(() => {
    if (paletteIndex >= visiblePaletteCommands.length) setPaletteIndex(0)
  }, [visiblePaletteCommands, paletteIndex])

  // Ctrl / Cmd + Shift + P global opener. Scoped to document so it fires
  // from anywhere inside the Workstation, not just the editor. Also
  // handles Ctrl/Cmd+W to close the active script tab and
  // Ctrl/Cmd+Shift+T to reopen the most recently closed tab.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey
      if (!mod) return
      if (ev.shiftKey && (ev.key === 'p' || ev.key === 'P')) {
        ev.preventDefault()
        openPalette()
        return
      }
      if (ev.shiftKey && (ev.key === 't' || ev.key === 'T')) {
        // Browsers bind Ctrl+Shift+T to "reopen closed tab" natively;
        // intercepting here means the Workstation wins focus first.
        ev.preventDefault()
        reopenLastClosedScript()
        return
      }
      if (!ev.shiftKey && !ev.altKey && (ev.key === 'w' || ev.key === 'W')) {
        // Guard: only intercept when the command palette isn't open,
        // so Ctrl+W inside the palette input still reaches the browser
        // if the user really needs it.
        if (paletteOpen) return
        ev.preventDefault()
        closeScript(scriptStore.activeId)
        return
      }
      // Ctrl/Cmd + 1..9 jumps directly to that script tab (9 wraps to
      // the last tab regardless of count, matching Chrome's tab-bar
      // convention). No-op when the palette is open so number keys
      // stay usable for filtering.
      if (!ev.shiftKey && !ev.altKey && /^[1-9]$/.test(ev.key)) {
        if (paletteOpen) return
        const n = Number(ev.key)
        const list = scriptStore.list
        if (list.length === 0) return
        const targetIdx = n === 9 ? list.length - 1 : Math.min(n - 1, list.length - 1)
        const target = list[targetIdx]
        if (target && target.id !== scriptStore.activeId) {
          ev.preventDefault()
          switchScript(target.id)
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPalette, reopenLastClosedScript, closeScript, switchScript, scriptStore.activeId, scriptStore.list, paletteOpen])

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
    sectionStrip: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 12px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'transparent',
      overflowX: 'auto' as const,
      minHeight: 28,
    },
    sectionStripLabel: {
      fontSize: 10,
      letterSpacing: 0.6,
      textTransform: 'uppercase' as const,
      color: 'var(--color-text-muted)',
      fontFamily: "'JetBrains Mono', monospace",
      flexShrink: 0,
    },
    sectionChip: {
      padding: '2px 10px',
      fontSize: 11,
      fontFamily: "'JetBrains Mono', monospace",
      color: 'var(--color-text-muted)',
      background: 'transparent',
      border: '1px solid var(--glass-border)',
      borderRadius: 3,
      cursor: 'pointer',
      flexShrink: 0,
      whiteSpace: 'nowrap' as const,
      transition: 'background 0.12s, color 0.12s, border-color 0.12s',
    },
    sectionChipActive: {
      color: 'var(--color-text)',
      background: 'var(--glass-bg-hover)',
      borderColor: 'var(--color-border-strong)',
    },
    figurePillStrip: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '5px 12px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'transparent',
      overflowX: 'auto' as const,
      minHeight: 28,
      flexShrink: 0,
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
      fontSize: editorFontSize,
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
      fontSize: editorFontSize,
      lineHeight: 1.6,
      whiteSpace: (editorWrapOn ? 'pre-wrap' : 'pre') as 'pre' | 'pre-wrap',
      wordBreak: (editorWrapOn ? 'break-word' : 'normal') as 'break-word' | 'normal',
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
      fontSize: editorFontSize,
      lineHeight: 1.6,
      color: 'transparent',
      caretColor: 'var(--color-text)',
      background: 'transparent',
      tabSize: 2,
      minHeight: 0,
      whiteSpace: (editorWrapOn ? 'pre-wrap' : 'pre') as 'pre' | 'pre-wrap',
      overflowWrap: (editorWrapOn ? 'break-word' : 'normal') as 'break-word' | 'normal',
      wordBreak: (editorWrapOn ? 'break-word' : 'normal') as 'break-word' | 'normal',
      overflow: 'auto' as const,
    },
    bracketOverlay: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      pointerEvents: 'none' as const,
      willChange: 'transform',
    },
    currentLineStrip: {
      position: 'absolute' as const,
      left: 0,
      right: 0,
      height: editorLineHeight,
      background: 'var(--glass-bg)',
      pointerEvents: 'none' as const,
      willChange: 'transform',
    },
    indentGuideOverlay: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      pointerEvents: 'none' as const,
      willChange: 'transform',
    },
    indentGuide: {
      position: 'absolute' as const,
      width: 0,
      borderLeft: '1px dotted var(--glass-border)',
      opacity: 0.7,
    },
    columnRuler: {
      position: 'absolute' as const,
      top: 0,
      bottom: 0,
      width: 0,
      borderLeft: '1px dashed var(--glass-border)',
      opacity: 0.45,
      pointerEvents: 'none' as const,
    },
    bracketHL: {
      position: 'absolute' as const,
      width: editorCharWidth,
      height: editorLineHeight,
      border: '1px solid var(--color-text)',
      borderRadius: 2,
      boxSizing: 'border-box' as const,
      opacity: 0.55,
    },
    findOverlay: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      pointerEvents: 'none' as const,
      willChange: 'transform',
    },
    findMatchHL: {
      position: 'absolute' as const,
      height: editorLineHeight,
      background: 'var(--glass-bg-hover)',
      border: '1px solid var(--glass-border)',
      borderRadius: 2,
      boxSizing: 'border-box' as const,
    },
    findMatchHLActive: {
      background: 'var(--color-bg-elevated)',
      borderColor: 'var(--color-border-strong)',
    },
    wordOverlay: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      pointerEvents: 'none' as const,
      willChange: 'transform',
    },
    wordHL: {
      position: 'absolute' as const,
      height: editorLineHeight,
      borderBottom: '1px dashed var(--color-text-muted)',
      opacity: 0.65,
      boxSizing: 'border-box' as const,
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
    varFilter: {
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      color: 'var(--color-text)',
      padding: '3px 8px',
      fontSize: 11,
      borderRadius: 3,
      outline: 'none',
      width: 140,
      fontFamily: "'Inter', sans-serif",
    },
    varRow: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1.2fr)',
      gap: 10,
      padding: '5px 6px',
      borderRadius: 4,
    },
    varAction: {
      background: 'transparent',
      border: '1px solid var(--glass-border)',
      color: 'var(--color-text-muted)',
      width: 18,
      height: 18,
      borderRadius: 3,
      fontSize: 11,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      lineHeight: 1,
      opacity: 0.7,
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
    consoleWrap: {
      display: 'flex',
      flexDirection: 'column' as const,
      minHeight: 0,
      gridColumn: library === 'open' ? '2 / -1' : '1 / -1',
      borderTop: '1px solid var(--glass-border)',
      background: 'transparent',
      position: 'relative' as const,
    },
    consoleJumpBtn: {
      position: 'absolute' as const,
      right: 24,
      bottom: 60,
      padding: '4px 10px',
      fontSize: 10,
      fontFamily: "'JetBrains Mono', monospace",
      color: 'var(--color-text)',
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 12,
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
      zIndex: 5,
    },
    consoleHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '6px 20px',
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: 'uppercase' as const,
      color: 'var(--color-text-muted)',
      borderBottom: '1px solid var(--glass-border)',
    },
    consoleFilter: {
      marginLeft: 'auto',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      color: 'var(--color-text)',
      padding: '3px 8px',
      fontSize: 11,
      borderRadius: 3,
      outline: 'none',
      width: 180,
      fontFamily: "'Inter', sans-serif",
      textTransform: 'none' as const,
      letterSpacing: 0,
    },
    console: {
      minHeight: 0,
      flex: 1,
      overflowY: 'auto',
      padding: '12px 20px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      lineHeight: 1.6,
      background: 'transparent',
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
    histSearchBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 20px',
      borderTop: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
    },
    histSearchLabel: {
      color: 'var(--color-text-muted)',
      whiteSpace: 'nowrap' as const,
    },
    histSearchInput: {
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: 'var(--color-text)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      minWidth: 140,
      maxWidth: 220,
    },
    histSearchPreview: {
      flex: 1,
      color: 'var(--color-text-secondary)',
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden' as const,
      textOverflow: 'ellipsis' as const,
    },
    histSearchCount: {
      color: 'var(--color-text-muted)',
      fontSize: 10,
      whiteSpace: 'nowrap' as const,
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
    dropOverlay: {
      position: 'absolute' as const,
      inset: 0,
      background: 'rgba(0, 0, 0, 0.55)',
      border: '2px dashed var(--color-border-strong)',
      borderRadius: 8,
      zIndex: 900,
      pointerEvents: 'none' as const,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dropOverlayInner: {
      fontSize: 14,
      fontWeight: 500,
      letterSpacing: 0.3,
      color: 'var(--color-text)',
      padding: '14px 22px',
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--glass-border)',
      borderRadius: 6,
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
    sigHintPopup: {
      position: 'fixed' as const,
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 4,
      padding: '6px 10px',
      zIndex: 200,
      maxWidth: 520,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
      pointerEvents: 'none' as const,
    },
    sigHintSignature: {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 12,
      color: 'var(--color-text)',
    },
    sigHintDescription: {
      fontFamily: "'Inter', sans-serif",
      fontSize: 11,
      color: 'var(--color-text-secondary)',
      marginTop: 2,
    },
    paletteBackdrop: {
      position: 'fixed' as const,
      inset: 0,
      background: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(6px)',
      zIndex: 1100,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '12vh',
    },
    paletteCard: {
      width: 'min(560px, 92vw)',
      maxHeight: '70vh',
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 8,
      boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
    paletteInput: {
      padding: '12px 16px',
      border: 'none',
      borderBottom: '1px solid var(--glass-border)',
      background: 'transparent',
      color: 'var(--color-text)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      outline: 'none',
    },
    paletteList: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto' as const,
      padding: 4,
    },
    paletteItem: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      borderRadius: 4,
      cursor: 'pointer',
      color: 'var(--color-text-secondary)',
      fontFamily: "'Inter', sans-serif",
      fontSize: 12,
    },
    paletteItemActive: {
      background: 'var(--glass-bg-hover)',
      color: 'var(--color-text)',
    },
    paletteHint: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      color: 'var(--color-text-muted)',
    },
    paletteEmpty: {
      padding: '16px',
      color: 'var(--color-text-muted)',
      fontStyle: 'italic' as const,
      fontSize: 12,
      textAlign: 'center' as const,
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
  }), [library, editorFontSize, editorWrapOn, editorLineHeight, editorCharWidth])

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
    <div
      style={styles.container}
      data-workstation="1"
      onDragOver={onWsDragOver}
      onDragLeave={onWsDragLeave}
      onDrop={onWsDrop}
    >
      {dropHover && (
        <div style={styles.dropOverlay} aria-hidden="true">
          <div style={styles.dropOverlayInner}>
            Drop .csv data · .json workspace · .m or .txt script to import
          </div>
        </div>
      )}
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

        <button
          style={{ ...styles.btn, ...styles.btnGhost }}
          onClick={runSection}
          disabled={running || sections.starts.length < 2}
          title="Run the %% section containing the caret (Alt+Ctrl/Cmd+Enter)"
        >
          <FiPlay style={{ opacity: 0.7 }} /> Run section
        </button>

        <label style={{ ...styles.btn, ...styles.btnGhost }} title="Upload one or more .m scripts">
          <FiUpload /> Upload
          <input type="file" accept=".m,.txt" multiple style={{ display: 'none' }} onChange={handleUpload} />
        </label>

        <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={handleDownload} title="Download as .m">
          <FiDownload /> Download
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--glass-border)', margin: '0 6px' }} />

        <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={clearConsole} title="Clear console">
          <FiTrash2 /> Clear console
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnGhost }}
          onClick={exportWorkspaceJson}
          title="Download the current workspace as a JSON file"
        >
          Export workspace
        </button>
        <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={resetWorkspace} title="Clear all variables">
          Reset workspace
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-muted)' }}>
          MATLAB / Octave compatible · running locally in-browser
        </span>

        <button
          style={{ ...styles.btn, ...styles.btnGhost, marginLeft: 10 }}
          onClick={() => setHelpOpen(true)}
          title="Keyboard shortcuts (F1)"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ opacity: 0.7, fontWeight: 400 }}>
                Ctrl/Cmd + Enter to run · F9 runs selection · Alt+Ctrl/Cmd + Enter runs %% section · Ctrl/Cmd + F to find
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  style={styles.plotChip}
                  onClick={() => bumpEditorFont(-1)}
                  disabled={editorFontSize <= EDITOR_FONT_MIN}
                  title="Decrease editor font size"
                  aria-label="Decrease editor font size"
                >A−</button>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                    minWidth: 18,
                    textAlign: 'center',
                  }}
                  title="Editor font size"
                >{editorFontSize}</span>
                <button
                  type="button"
                  style={styles.plotChip}
                  onClick={() => bumpEditorFont(1)}
                  disabled={editorFontSize >= EDITOR_FONT_MAX}
                  title="Increase editor font size"
                  aria-label="Increase editor font size"
                >A+</button>
                <button
                  type="button"
                  style={{ ...styles.plotChip, ...(editorWrapOn ? styles.plotChipActive : null) }}
                  onClick={toggleEditorWrap}
                  title="Toggle soft word wrap"
                  aria-pressed={editorWrapOn}
                >wrap</button>
              </div>
            </div>
          </div>
          <div style={styles.tabBar}>
            {scriptStore.list.map(s => {
              const active = s.id === scriptStore.activeId
              const isDropTarget = dragOverTabId === s.id && draggedTabIdRef.current !== s.id
              return (
                <button
                  key={s.id}
                  style={{
                    ...styles.tab,
                    ...(active ? styles.tabActive : null),
                    ...(isDropTarget ? { boxShadow: 'inset 2px 0 0 var(--color-text)' } : null),
                    ...(draggedTabIdRef.current === s.id ? { opacity: 0.5 } : null),
                  }}
                  onClick={() => switchScript(s.id)}
                  onDoubleClick={() => renameScript(s.id)}
                  draggable
                  onDragStart={(ev) => {
                    draggedTabIdRef.current = s.id
                    ev.dataTransfer.effectAllowed = 'move'
                    // Firefox requires some data on the transfer to actually
                    // start a drag; the value is unused but must be set.
                    try { ev.dataTransfer.setData('text/plain', s.id) } catch { /* noop */ }
                  }}
                  onDragOver={(ev) => {
                    if (!draggedTabIdRef.current) return
                    ev.preventDefault()
                    ev.dataTransfer.dropEffect = 'move'
                    if (dragOverTabId !== s.id) setDragOverTabId(s.id)
                  }}
                  onDragLeave={() => {
                    if (dragOverTabId === s.id) setDragOverTabId(null)
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault()
                    const from = draggedTabIdRef.current
                    draggedTabIdRef.current = null
                    setDragOverTabId(null)
                    if (from) reorderScriptTab(from, s.id)
                  }}
                  onDragEnd={() => {
                    draggedTabIdRef.current = null
                    setDragOverTabId(null)
                  }}
                  title={`${s.name} — drag to reorder, double-click to rename`}
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
          {sectionOutline.length > 1 && (
            <div style={styles.sectionStrip} aria-label="Script sections">
              <span style={styles.sectionStripLabel}>§</span>
              {sectionOutline.map(sec => {
                const active = sec.line === activeSectionLine
                return (
                  <button
                    key={sec.line}
                    type="button"
                    style={{ ...styles.sectionChip, ...(active ? styles.sectionChipActive : null) }}
                    onClick={() => jumpToLine(sec.line)}
                    title={`Jump to line ${sec.line}: ${sec.label}`}
                  >{sec.label}</button>
                )
              })}
            </div>
          )}
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
              <button
                type="button"
                style={{
                  ...styles.btn,
                  ...styles.btnGhost,
                  padding: '3px 8px',
                  fontSize: 11,
                  ...(findCaseSensitive ? { color: 'var(--color-text)', borderColor: 'var(--color-border-strong)' } : null),
                }}
                onClick={() => setFindCaseSensitive(v => !v)}
                title="Case sensitive"
                aria-pressed={findCaseSensitive}
              >Aa</button>
              <button
                type="button"
                style={{
                  ...styles.btn,
                  ...styles.btnGhost,
                  padding: '3px 8px',
                  fontSize: 11,
                  ...(findRegex ? { color: 'var(--color-text)', borderColor: 'var(--color-border-strong)' } : null),
                }}
                onClick={() => setFindRegex(v => !v)}
                title="Regular expression"
                aria-pressed={findRegex}
              >.*</button>
              <span style={styles.findCount}>
                {findError
                  ? <span style={{ color: 'var(--color-error)' }}>regex err</span>
                  : findMatches.length === 0
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
          {gotoOpen && (
            <div style={styles.findBar}>
              <span style={{
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--color-text-muted)',
              }}>Go to line</span>
              <input
                ref={gotoInputRef}
                style={styles.findInput}
                value={gotoQuery}
                onChange={e => setGotoQuery(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); closeGoto() }
                  else if (e.key === 'Enter') { e.preventDefault(); commitGoto() }
                }}
                placeholder={`1 – ${lineCount}`}
                inputMode="numeric"
                spellCheck={false}
                autoComplete="off"
              />
              <span style={styles.findCount}>
                {gotoQuery ? `of ${lineCount}` : ''}
              </span>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11 }}
                onClick={commitGoto}
                disabled={!gotoQuery}
                title="Jump to line (Enter)"
              >Go</button>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11, marginLeft: 'auto' }}
                onClick={closeGoto}
                title="Close (Esc)"
              >×</button>
            </div>
          )}
          <div style={styles.editorBody}>
            <div style={styles.editorGutterClip}>
              <div ref={gutterRef} style={styles.editorGutterNumbers}>
                {Array.from({ length: lineCount }, (_, i) => {
                  const n = i + 1
                  const isErr = errorLine === n
                  const isSec = sectionStartSet.has(n) && n !== 1
                  const isCur = cursor.line === n
                  const isBm = bookmarkLines.has(n)
                  return (
                    <div
                      key={n}
                      onClick={(ev) => {
                        // Alt/Option + click on the gutter toggles a bookmark
                        // instead of jumping, so users can manage marks with
                        // the mouse as well as Ctrl+F2.
                        if (ev.altKey) { toggleBookmark(n); return }
                        jumpToLine(n)
                      }}
                      role="button"
                      tabIndex={-1}
                      style={{
                        height: '1.6em',
                        cursor: 'pointer',
                        color: isErr ? 'var(--color-error)'
                          : isCur ? 'var(--color-text)'
                          : isSec ? 'var(--color-text)' : undefined,
                        fontWeight: isErr || isSec || isCur ? 600 : undefined,
                        borderTop: isSec ? '1px solid var(--color-border-strong)' : undefined,
                        position: 'relative',
                      }}
                      title={
                        isSec
                          ? (sections.names[n] ? `Section: ${sections.names[n]} — click to jump` : 'Section — click to jump')
                          : `Line ${n} — click to jump, Alt+click to bookmark`
                      }
                    >
                      {isBm && (
                        <span
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            left: 2,
                            top: '50%',
                            width: 5,
                            height: 5,
                            transform: 'translateY(-50%) rotate(45deg)',
                            background: 'var(--color-text)',
                            opacity: 0.85,
                          }}
                        />
                      )}
                      {isErr ? '● ' + n : n}
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={styles.editorTextWrap}>
              {!editorWrapOn && (
                <div
                  ref={currentLineRef}
                  aria-hidden="true"
                  style={{
                    ...styles.currentLineStrip,
                    top: 14 + (cursor.line - 1) * editorLineHeight,
                  }}
                />
              )}
              {!editorWrapOn && (
                <div
                  aria-hidden="true"
                  style={{
                    ...styles.columnRuler,
                    left: 14 + 80 * editorCharWidth,
                  }}
                />
              )}
              <pre ref={highlightRef} style={styles.editorHighlight} aria-hidden="true">
                {highlightTokens.map((t, idx) => (
                  <span key={idx} style={HL_COLORS[t.kind]}>{t.text}</span>
                ))}
                {/* Trailing newline so the last line is still visible when the
                    user's cursor is on it. */}
                {'\n'}
              </pre>
              {!editorWrapOn && indentGuides.length > 0 && (
                <div ref={indentGuideRef} style={styles.indentGuideOverlay} aria-hidden="true">
                  {indentGuides.map((g, idx) => (
                    <div
                      key={idx}
                      style={{
                        ...styles.indentGuide,
                        top: 14 + (g.startLine - 1) * editorLineHeight,
                        left: 14 + g.col * editorCharWidth,
                        height: (g.endLine - g.startLine + 1) * editorLineHeight,
                      }}
                    />
                  ))}
                </div>
              )}
              {!editorWrapOn && (
                <div ref={bracketOverlayRef} style={styles.bracketOverlay} aria-hidden="true">
                  {bracketPair && bracketPair.map((p, idx) => {
                    const lc = lineColForPos(script, p)
                    return (
                      <div
                        key={idx}
                        style={{
                          ...styles.bracketHL,
                          top: 14 + lc.line * editorLineHeight,
                          left: 14 + lc.col * editorCharWidth,
                        }}
                      />
                    )
                  })}
                </div>
              )}
              {!editorWrapOn && wordOccurrences.length > 0 && (
                <div ref={wordOverlayRef} style={styles.wordOverlay} aria-hidden="true">
                  {wordOccurrences.map((start, idx) => {
                    // Skip the occurrence that contains the caret itself —
                    // highlighting the identifier you're typing reads as
                    // noise and competes with the current-line strip.
                    if (caretOffset >= start && caretOffset <= start + wordAtCaret.length) return null
                    const lc = lineColForPos(script, start)
                    return (
                      <div
                        key={idx}
                        style={{
                          ...styles.wordHL,
                          top: 14 + lc.line * editorLineHeight,
                          left: 14 + lc.col * editorCharWidth,
                          width: wordAtCaret.length * editorCharWidth,
                        }}
                      />
                    )
                  })}
                </div>
              )}
              {!editorWrapOn && findOpen && findQuery && findMatches.length > 0 && (
                <div ref={findOverlayRef} style={styles.findOverlay} aria-hidden="true">
                  {findMatches.map((m, idx) => {
                    // Multi-line matches would need a rect per line; in
                    // practice find queries rarely cross newlines, so only
                    // draw single-line matches and skip the rest.
                    const start = m.start
                    const end = start + m.len
                    if (m.len === 0) return null
                    if (script.slice(start, end).indexOf('\n') >= 0) return null
                    const lc = lineColForPos(script, start)
                    const active = idx === matchIdx
                    return (
                      <div
                        key={idx}
                        style={{
                          ...styles.findMatchHL,
                          ...(active ? styles.findMatchHLActive : null),
                          top: 14 + lc.line * editorLineHeight,
                          left: 14 + lc.col * editorCharWidth,
                          width: m.len * editorCharWidth,
                        }}
                      />
                    )
                  })}
                </div>
              )}
              <textarea
                ref={editorRef}
                style={styles.editor}
                value={script}
                onChange={e => { setScript(e.target.value); updateCursor(e.target); if (acOpen) closeAutocomplete() }}
                onKeyDown={onEditorKey}
                onKeyUp={onEditorSelect}
                onClick={onEditorSelect}
                onScroll={onEditorScroll}
                onBlur={() => { if (acOpen) closeAutocomplete(); if (sigHint) setSigHint(null) }}
                spellCheck={false}
                wrap={editorWrapOn ? 'soft' : 'off'}
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
                  onClick={exportPlotPNG}
                  title="Download current figure as PNG"
                >png</button>
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
            {plots.length > 1 && (
              <div style={styles.figurePillStrip}>
                {plots.map((p, idx) => {
                  const active = idx === activePlot
                  const label = p.title?.trim() || `figure ${idx + 1}`
                  return (
                    <button
                      key={idx}
                      type="button"
                      style={active ? { ...styles.plotChip, ...styles.plotChipActive } : styles.plotChip}
                      onClick={() => setActivePlot(idx)}
                      title={`${label} (${p.series.length} series)`}
                      aria-label={`Switch to figure ${idx + 1}`}
                      aria-current={active ? 'true' : undefined}
                    >
                      {idx + 1}
                      {p.title?.trim() && (
                        <span style={{
                          marginLeft: 6,
                          color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                          maxWidth: 96,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'inline-block',
                          verticalAlign: 'bottom',
                        }}>{p.title.trim()}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            <div ref={plotBodyRef} style={styles.plotBody}>
              <PlotView plot={currentPlot} opts={plotOpts} />
            </div>
          </div>

          <div style={styles.varPanel}>
            <div style={styles.panelHeader}>
              <span>
                Workspace · {vars.length} variable{vars.length === 1 ? '' : 's'}
                {varFilter.trim() && (
                  <span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontWeight: 400 }}>
                    ({visibleVars.length} shown)
                  </span>
                )}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  style={{ ...styles.plotChip, ...styles.plotChipActive }}
                  onClick={() => setVarSort(s => s === 'name' ? 'size' : s === 'size' ? 'type' : 'name')}
                  disabled={vars.length === 0}
                  title="Cycle sort key: name → size → type"
                  aria-label={`Sort workspace by ${varSort}`}
                >sort: {varSort} ↓</button>
                <button
                  type="button"
                  style={{ ...styles.plotChip, ...styles.plotChipActive }}
                  onClick={() => setCopyFormat(f => {
                    const i = COPY_FORMATS.indexOf(f)
                    return COPY_FORMATS[(i + 1) % COPY_FORMATS.length]
                  })}
                  disabled={vars.length === 0}
                  title="Cycle copy format used by the row ⧉ button: matlab → python → latex → json → csv"
                  aria-label={`Copy format: ${copyFormat}`}
                >copy: {copyFormat}</button>
                <input
                  style={styles.varFilter}
                  value={varFilter}
                  onChange={e => setVarFilter(e.target.value)}
                  placeholder="Filter…"
                  aria-label="Filter workspace variables"
                  spellCheck={false}
                  disabled={vars.length === 0}
                />
              </div>
            </div>
            <div style={styles.varList}>
              {vars.length === 0 && (
                <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '10px 6px', fontSize: 12 }}>
                  No variables yet. Run a script or enter a command.
                </div>
              )}
              {vars.length > 0 && visibleVars.length === 0 && (
                <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '10px 6px', fontSize: 12 }}>
                  No variables match "{varFilter}".
                </div>
              )}
              {visibleVars.map(v => {
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
                      title={`${v.name}: ${v.kind}  ${v.shape}  ${v.summary}${varUsageCounts[v.name] ? `  (used ${varUsageCounts[v.name]}× in script)` : '  (unused in script)'}`}
                    >
                      <span style={{ color: 'var(--color-text)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {pinnedVars.has(v.name) && (
                          <span
                            aria-hidden="true"
                            title="Pinned — click the pin to unpin"
                            style={{
                              fontSize: 10,
                              color: 'var(--color-text)',
                              lineHeight: 1,
                            }}
                          >◆</span>
                        )}
                        {v.name}
                        {(() => {
                          const n = varUsageCounts[v.name] || 0
                          return (
                            <span style={{
                              fontSize: 10,
                              fontWeight: 400,
                              color: n === 0 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                              fontStyle: n === 0 ? 'italic' : 'normal',
                            }}>
                              {n === 0 ? 'unused' : `${n}×`}
                            </span>
                          )
                        })()}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{v.shape}</span>
                      <span style={{
                        color: 'var(--color-text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.summary}</span>
                        {v.value.kind === 'mat' && (v.value.rows === 1 || v.value.cols === 1) && v.value.data.length >= 2 && (
                          <Sparkline data={v.value.data} />
                        )}
                        <button
                          style={{
                            ...styles.varAction,
                            ...(pinnedVars.has(v.name) ? { color: 'var(--color-text)' } : null),
                          }}
                          onClick={e => { e.stopPropagation(); togglePinnedVar(v.name) }}
                          title={pinnedVars.has(v.name) ? 'Unpin from top' : 'Pin to top of workspace'}
                          aria-label={pinnedVars.has(v.name) ? `Unpin ${v.name}` : `Pin ${v.name}`}
                        >{pinnedVars.has(v.name) ? '◆' : '◇'}</button>
                        <button
                          style={styles.varAction}
                          onClick={e => { e.stopPropagation(); insertVariableAtCaret(v.name) }}
                          title="Insert name at editor caret"
                          aria-label={`Insert ${v.name} at caret`}
                        >↵</button>
                        <button
                          style={styles.varAction}
                          onClick={e => { e.stopPropagation(); copyVariableExpr(v.name, v.value) }}
                          title="Copy as MATLAB expression"
                          aria-label={`Copy ${v.name}`}
                        >⧉</button>
                        <button
                          style={styles.varAction}
                          onClick={e => { e.stopPropagation(); deleteVariable(v.name) }}
                          title="Delete this variable"
                          aria-label={`Delete ${v.name}`}
                        >×</button>
                      </span>
                    </div>
                    {isOpen && (
                      <div style={styles.varExpand}>
                        <VarExpandView value={v.value} />
                        {v.value.kind === 'mat' && (v.value.rows > VAR_MAX_ROWS || v.value.cols > VAR_MAX_COLS) && (
                          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                            <button
                              style={{ ...styles.btn, ...styles.btnGhost, padding: '2px 8px', fontSize: 11 }}
                              onClick={(e) => { e.stopPropagation(); setInspectVar(v.name) }}
                              title="Open full matrix viewer"
                            >View full</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div style={styles.consoleWrap}>
          <div style={styles.consoleHeader}>
            <span>Console</span>
            <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
              {(['all', 'input', 'output', 'error'] as const).map(k => {
                const isActive = consoleKind === k
                const count = consoleCounts[k]
                return (
                  <button
                    key={k}
                    type="button"
                    style={{ ...styles.plotChip, ...(isActive ? styles.plotChipActive : null) }}
                    onClick={() => setConsoleKind(k)}
                    title={`Show ${k === 'all' ? 'every entry' : `only ${k} entries`}`}
                  >{k} {count}</button>
                )
              })}
            </div>
            <input
              style={styles.consoleFilter}
              value={consoleFilter}
              onChange={e => setConsoleFilter(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter console entries"
              spellCheck={false}
            />
            {(consoleFilter || consoleKind !== 'all') && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {visibleEntries.length} / {entries.length}
              </span>
            )}
            <button
              type="button"
              style={{ ...styles.plotChip, ...(copyFlash ? styles.plotChipActive : null) }}
              onClick={copyConsole}
              disabled={visibleEntries.length === 0}
              title="Copy visible console entries to clipboard"
            >{copyFlash ? 'copied' : 'copy'}</button>
          </div>
          <div ref={consoleRef} style={styles.console} onScroll={onConsoleScroll}>
            {entries.length === 0 && (
              <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                Console ready. Type a command below or hit Run.
              </div>
            )}
            {entries.length > 0 && visibleEntries.length === 0 && (
              <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                {consoleFilter
                  ? `No entries match "${consoleFilter}".`
                  : `No ${consoleKind} entries yet.`}
              </div>
            )}
            {visibleEntries.map(e => {
              const clickable = e.kind === 'error' && typeof e.line === 'number'
              // Double-clicking any input line drops its command back into
              // the prompt so the user can edit and rerun it — mirrors the
              // way terminals treat their scrollback. Output and error
              // lines still drop their text in (minus the leading '>> '
              // for input entries) so users can grab a computed value or
              // reuse part of an error message.
              const reuseText = e.kind === 'input'
                ? e.text.replace(/^>>\s?/, '')
                : e.text
              return (
                <div
                  key={e.id}
                  onClick={clickable ? () => jumpToLine(e.line!) : undefined}
                  onDoubleClick={() => {
                    setCmd(reuseText)
                    requestAnimationFrame(() => {
                      const inp = cmdInputRef.current
                      if (!inp) return
                      inp.focus()
                      inp.setSelectionRange(reuseText.length, reuseText.length)
                    })
                  }}
                  style={{
                    ...(e.kind === 'input' ? styles.entryInput
                      : e.kind === 'error' ? styles.entryError
                      : styles.entryOutput),
                    ...(clickable ? { cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 } : null),
                  }}
                  title={
                    clickable
                      ? `Click to jump to line ${e.line}, double-click to copy to prompt`
                      : 'Double-click to copy to prompt'
                  }
                >
                  {e.text}
                </div>
              )
            })}
          </div>
          {!consolePinned && entries.length > 0 && (
            <button
              type="button"
              style={styles.consoleJumpBtn}
              onClick={scrollConsoleToBottom}
              title="Jump to bottom and resume auto-scroll"
            >↓ live</button>
          )}
        </div>
      </div>

      {/* ─── Status bar ──────────────────────────────────────────────── */}
      <div style={styles.statusBar}>
        <span>Ln {cursor.line}, Col {cursor.col}</span>
        <span>·</span>
        <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>
        {selectionInfo && (
          <>
            <span>·</span>
            <span style={{ color: 'var(--color-text)' }}>
              {selectionInfo.chars} char{selectionInfo.chars === 1 ? '' : 's'}
              {selectionInfo.lines > 1 && `, ${selectionInfo.lines} lines`}
              {' selected'}
            </span>
          </>
        )}
        {activeSectionLabel && (
          <>
            <span>·</span>
            <span
              style={{ color: 'var(--color-text)', cursor: 'pointer' }}
              onClick={() => jumpToLine(activeSectionLine)}
              title={`Jump to the start of this %% section (line ${activeSectionLine})`}
            >
              §{' '}{activeSectionLabel}
            </span>
          </>
        )}
        <span>·</span>
        <span title={`${workspaceBytes.toLocaleString()} bytes across ${vars.length} variable${vars.length === 1 ? '' : 's'}`}>
          {vars.length} var{vars.length === 1 ? '' : 's'}
          {vars.length > 0 && ` · ${workspaceSizeLabel}`}
        </span>
        <span>·</span>
        <span>{plots.length} figure{plots.length === 1 ? '' : 's'}</span>
        <span style={{ marginLeft: 'auto' }}>
          {lastRunMs !== null
            ? `last run ${lastRunMs < 1000 ? lastRunMs.toFixed(1) + ' ms' : (lastRunMs / 1000).toFixed(2) + ' s'}`
            : 'ready'}
        </span>
      </div>

      {/* ─── Command line ────────────────────────────────────────────── */}
      {histSearchOpen && (
        <div style={styles.histSearchBar}>
          <span style={styles.histSearchLabel}>(reverse-i-search)</span>
          <input
            ref={histSearchInputRef}
            style={styles.histSearchInput}
            value={histSearchQuery}
            onChange={e => { setHistSearchQuery(e.target.value); setHistSearchCursor(0) }}
            onKeyDown={onHistSearchKey}
            placeholder="type to filter history…"
            spellCheck={false}
            autoComplete="off"
          />
          <span style={styles.histSearchPreview}>
            {histSearchMatches.length === 0
              ? (histSearchQuery ? `no match for "${histSearchQuery}"` : 'history empty')
              : `› ${histSearchMatches[histSearchCursor] ?? ''}`}
          </span>
          <span style={styles.histSearchCount}>
            {histSearchMatches.length > 0 && `${histSearchCursor + 1}/${histSearchMatches.length}`}
          </span>
          <button
            style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11 }}
            onClick={commitHistSearch}
            disabled={histSearchMatches.length === 0}
            title="Use this command (Enter)"
          >use</button>
          <button
            style={{ ...styles.btn, ...styles.btnGhost, padding: '3px 8px', fontSize: 11 }}
            onClick={closeHistSearch}
            title="Close (Esc)"
          >×</button>
        </div>
      )}
      <div style={styles.cmdBar}>
        <span style={styles.prompt}>{'>>'}</span>
        <input
          ref={cmdInputRef}
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
                onClick={exportPlotPNG}
                title="Download current figure as PNG"
              >png</button>
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

      {/* ─── Variable inspector modal ───────────────────────────────── */}
      {inspectVar && (() => {
        const snap = vars.find(v => v.name === inspectVar)
        if (!snap) return null
        return (
          <div
            style={styles.fullscreenOverlay}
            role="dialog"
            aria-modal="true"
            onClick={e => { if (e.target === e.currentTarget) setInspectVar(null) }}
          >
            <div style={styles.fullscreenHeader}>
              <span>
                {snap.name} <span style={{ color: 'var(--color-text-muted)', marginLeft: 10 }}>{snap.kind} · {snap.shape}</span>
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {snap.value.kind === 'mat' && (
                  <button
                    style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 10px', fontSize: 11 }}
                    onClick={() => exportMatrixCsv(snap.name, snap.value as MValue & { kind: 'mat' })}
                    title="Download this matrix as CSV"
                  >csv</button>
                )}
                <button
                  style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 10px', fontSize: 11 }}
                  onClick={() => setInspectVar(null)}
                  title="Close (Esc)"
                >close</button>
              </div>
            </div>
            <div style={{ ...styles.fullscreenBody, overflow: 'auto', padding: 20 }}>
              <FullMatrixView value={snap.value} />
            </div>
          </div>
        )
      })()}

      {/* ─── Keyboard shortcut help modal ───────────────────────────── */}
      {helpOpen && (
        <div
          style={styles.fullscreenOverlay}
          role="dialog"
          aria-modal="true"
          onClick={e => { if (e.target === e.currentTarget) setHelpOpen(false) }}
        >
          <div style={styles.fullscreenHeader}>
            <span>Keyboard shortcuts</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 10px', fontSize: 11 }}
                onClick={() => setHelpOpen(false)}
                title="Close (Esc or F1)"
              >close</button>
            </div>
          </div>
          <div style={{ ...styles.fullscreenBody, overflow: 'auto', padding: '24px 28px' }}>
            <ShortcutHelp />
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

      {/* ─── Function signature hint (fixed-viewport, opens on "(") ───── */}
      {sigHint && (
        <div
          style={{
            ...styles.sigHintPopup,
            top: sigHint.anchor.top,
            left: sigHint.anchor.left,
          }}
          role="tooltip"
          aria-live="polite"
        >
          <div style={styles.sigHintSignature}>{sigHint.signature}</div>
          <div style={styles.sigHintDescription}>{sigHint.description}</div>
        </div>
      )}

      {/* ─── Command palette (Ctrl/Cmd + Shift + P) ────────────────── */}
      {paletteOpen && (
        <div
          style={styles.paletteBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onClick={e => { if (e.target === e.currentTarget) closePalette() }}
        >
          <div style={styles.paletteCard}>
            <input
              ref={paletteInputRef}
              style={styles.paletteInput}
              value={paletteQuery}
              onChange={e => { setPaletteQuery(e.target.value); setPaletteIndex(0) }}
              placeholder="Type a command…"
              aria-label="Filter commands"
              spellCheck={false}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); closePalette() }
                else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setPaletteIndex(i => Math.min(i + 1, Math.max(0, visiblePaletteCommands.length - 1)))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setPaletteIndex(i => Math.max(i - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const cmd = visiblePaletteCommands[paletteIndex]
                  if (cmd) { closePalette(); cmd.run() }
                }
              }}
            />
            <div style={styles.paletteList}>
              {visiblePaletteCommands.length === 0 && (
                <div style={styles.paletteEmpty}>No commands match "{paletteQuery}".</div>
              )}
              {visiblePaletteCommands.map((cmd, i) => {
                const active = i === paletteIndex
                return (
                  <div
                    key={cmd.id}
                    role="option"
                    aria-selected={active}
                    style={active ? { ...styles.paletteItem, ...styles.paletteItemActive } : styles.paletteItem}
                    onMouseEnter={() => setPaletteIndex(i)}
                    onMouseDown={e => { e.preventDefault(); closePalette(); cmd.run() }}
                  >
                    <span>{cmd.title}</span>
                    {cmd.hint && <span style={styles.paletteHint}>{cmd.hint}</span>}
                  </div>
                )
              })}
            </div>
          </div>
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

// Tiny inline line chart used as a thumbnail preview for vector-shaped
// workspace variables. Downsampled to at most 48 points so very long
// vectors still render instantly, and rendered as a plain SVG path so
// it inherits the current text colour without a second colour token.
function Sparkline({ data, width = 64, height = 16 }: { data: Float64Array; width?: number; height?: number }) {
  const n = data.length
  if (n < 2) return null
  const maxPts = 48
  const step = n > maxPts ? Math.ceil(n / maxPts) : 1
  const pts: number[] = []
  for (let i = 0; i < n; i += step) pts.push(data[i])
  // Always include the final sample so the line ends at the real last value.
  if ((n - 1) % step !== 0) pts.push(data[n - 1])
  let min = Infinity, max = -Infinity
  for (const v of pts) { if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v } }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  const pad = 1
  const span = max - min || 1
  const w = width - pad * 2
  const h = height - pad * 2
  const path = pts.map((v, i) => {
    const x = pad + (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w)
    const y = pad + (1 - (v - min) / span) * h
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ flexShrink: 0, opacity: 0.75 }} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

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
      const headerStyle: React.CSSProperties = {
        padding: '2px 8px',
        color: 'var(--color-text-muted)',
        fontSize: 10,
        textAlign: 'right',
        fontFamily: "'JetBrains Mono', monospace",
      }
      return (
        <div>
          <table style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>
                <th style={{ ...headerStyle, borderRight: '1px solid var(--glass-border)', borderBottom: '1px solid var(--glass-border)' }}></th>
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} style={{ ...headerStyle, borderBottom: '1px solid var(--glass-border)' }}>
                    {c + 1}
                  </th>
                ))}
                {colTrunc && <th style={{ ...headerStyle, borderBottom: '1px solid var(--glass-border)' }}>…</th>}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, r) => (
                <tr key={r}>
                  <td style={{ ...headerStyle, borderRight: '1px solid var(--glass-border)' }}>{r + 1}</td>
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
                  <td colSpan={cols + 1 + (colTrunc ? 1 : 0)} style={{ padding: '2px 6px', color: 'var(--color-text-muted)' }}>
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

// Full, un-truncated variable view used inside the inspector modal.
// Matrices above ~50k cells are chunked by row so scrolling stays smooth;
// strings display their full contents, scalars display with max precision.
const FULL_VIEW_CELL_CAP = 50_000
function FullMatrixView({ value }: { value: MValue }) {
  switch (value.kind) {
    case 'num':
      return <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>{value.v}</div>
    case 'bool':
      return <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>{value.v ? 'true' : 'false'}</div>
    case 'str':
      return (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--color-text)' }}>
          {value.v}
        </pre>
      )
    case 'fn':
      return <div>@{value.name} (arity {value.arity})</div>
    case 'void':
      return <div>—</div>
    case 'mat': {
      const { rows, cols, data } = value
      const total = rows * cols
      const rowCap = total > FULL_VIEW_CELL_CAP ? Math.max(1, Math.floor(FULL_VIEW_CELL_CAP / Math.max(1, cols))) : rows
      const truncated = rowCap < rows
      return (
        <div>
          <div style={{ marginBottom: 8, color: 'var(--color-text-muted)', fontSize: 11 }}>
            {rows}×{cols}
            {truncated && <> · showing first {rowCap} rows · use the CSV export to get the full matrix</>}
          </div>
          <table style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', color: 'var(--color-text-muted)', fontWeight: 400, textAlign: 'right' }}></th>
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} style={{ padding: '4px 8px', color: 'var(--color-text-muted)', fontWeight: 400, textAlign: 'right' }}>
                    {c + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowCap }, (_, r) => (
                <tr key={r}>
                  <td style={{ padding: '2px 8px', color: 'var(--color-text-muted)', textAlign: 'right' }}>{r + 1}</td>
                  {Array.from({ length: cols }, (_, c) => (
                    <td
                      key={c}
                      style={{
                        padding: '2px 8px',
                        textAlign: 'right',
                        color: 'var(--color-text)',
                        borderLeft: '1px solid var(--glass-border)',
                      }}
                    >
                      {formatScalar(data[r * cols + c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
  }
}

// Keyboard shortcut reference rendered inside the help modal. Grouped
// by area so it's easy to scan.
const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Running code',
    items: [
      ['Ctrl / Cmd + Enter', 'Run the full script'],
      ['Shift + Ctrl / Cmd + Enter', 'Run selection (or current line)'],
      ['F9', 'Run selection (MATLAB-style)'],
      ['Alt + Ctrl / Cmd + Enter', 'Run current %% section'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['Tab / Shift + Tab', 'Indent / outdent selection'],
      ['Enter', 'Auto-indent to the previous line'],
      ['Ctrl / Cmd + /', 'Toggle line comment (%)'],
      ['Alt + ↑ / ↓', 'Move current line(s) up or down'],
      ['Shift + Alt + ↑ / ↓', 'Duplicate current line(s)'],
      ['Ctrl / Cmd + Shift + K', 'Delete current line(s)'],
      ['Ctrl / Cmd + D', 'Select word / jump to next occurrence'],
      ['( [ { " \'', 'Auto-pair brackets and quotes'],
      ['Backspace between pair', 'Delete matching pair'],
      ['Tab on identifier', 'Autocomplete variable / builtin'],
    ],
  },
  {
    title: 'Navigation',
    items: [
      ['Ctrl / Cmd + F', 'Find and replace'],
      ['Ctrl / Cmd + G', 'Go to line'],
      ['Ctrl / Cmd + M', 'Jump to matching bracket'],
      ['Ctrl / Cmd + Shift + M', 'Select to matching bracket'],
      ['Enter / Shift + Enter (find)', 'Next / previous match'],
      ['Ctrl / Cmd + F2', 'Toggle bookmark on current line'],
      ['F2 / Shift + F2', 'Next / previous bookmark'],
      ['Alt + click gutter', 'Toggle bookmark on that line'],
      ['Esc', 'Close find, autocomplete, fullscreen or help'],
    ],
  },
  {
    title: 'Scripts',
    items: [
      ['Ctrl / Cmd + 1 … 8', 'Switch to script tab 1–8'],
      ['Ctrl / Cmd + 9', 'Switch to the last script tab'],
      ['Ctrl / Cmd + W', 'Close the active script tab'],
      ['Ctrl / Cmd + Shift + T', 'Reopen the most recently closed tab'],
    ],
  },
  {
    title: 'Console',
    items: [
      ['Arrow Up / Down', 'Recall command history'],
      ['Ctrl / Cmd + R', 'Reverse-search command history'],
      ['Enter', 'Run command'],
    ],
  },
  {
    title: 'Help',
    items: [
      ['F1', 'Toggle this help dialog'],
      ['Ctrl / Cmd + Shift + P', 'Open the command palette'],
    ],
  },
]

function ShortcutHelp() {
  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 720 }}>
      {SHORTCUT_GROUPS.map(group => (
        <div key={group.title}>
          <div style={{
            fontSize: 11,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            marginBottom: 6,
          }}>
            {group.title}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '6px 16px' }}>
            {group.items.map(([keys, desc]) => (
              <Fragment key={keys}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  color: 'var(--color-text)',
                  padding: '3px 8px',
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 3,
                  alignSelf: 'start',
                  textAlign: 'center',
                }}>
                  {keys}
                </div>
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, alignSelf: 'center' }}>
                  {desc}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
