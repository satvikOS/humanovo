// ═══════════════════════════════════════════════════════════════════════
// Compute Lab — Numeric Compute Workstation
// Batch 4a: editor + command window backed by the compute engine.
// Batch 4b: adds variable inspector and plot panel on the right rail.
// Later batches add the preset library sidebar and polish.
// ═══════════════════════════════════════════════════════════════════════
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiPlay, FiSquare } from 'react-icons/fi'
import { useAlertDialog } from '../../components/AlertDialog'
import {
  LineChart, Line, ScatterChart, Scatter, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ReferenceLine,
} from 'recharts'
import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

const PlotlyChart = createPlotlyComponent(Plotly)
import {
  run as runEngine,
  createWorkspace,
  type Workspace,
  type RunOutput,
  type PlotSpec,
  type MValue,
} from './computeEngine'
import {
  WORKSTATION_CATEGORIES,
  WORKSTATION_TEMPLATES,
  type WorkstationTemplate,
} from './workstationTemplates'
import { BUILTIN_CATEGORIES, BUILTIN_DOCS, type BuiltinDoc } from './builtinDocs'
import { ALL_PRESETS, TOOLBOX_CATEGORIES } from './presets'
import type { Preset } from './types'
import ImagingPanel, { IMAGING_EVENT } from './ImagingPanel'
import { getPlotBlob } from '../../utils/plotExport'
import { plotlyConfig } from '../../utils/plotlyConfig'
import PublicationFigure from '../../components/PublicationFigure'

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

const STARTER_SCRIPT = `% Numeric Compute Workstation
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
  /** Wall-clock time the entry was emitted (epoch ms). Optional for
   *  backwards-compat with persisted sessions that predate the field. */
  at?: number
}

// Helper for constructing entries with an auto-populated wall-clock
// timestamp. Centralising this keeps the dozens of setEntries call
// sites from having to thread `Date.now()` around by hand.
function mkEntry(partial: Omit<ConsoleEntry, 'id' | 'at'> & { line?: number }): ConsoleEntry {
  return { id: nextEntryId++, at: Date.now(), ...partial }
}

/** Target formats for the workspace "copy variable" action. */
type CopyFormat = 'native' | 'python' | 'latex' | 'json' | 'csv'
const COPY_FORMATS: CopyFormat[] = ['native', 'python', 'latex', 'json', 'csv']

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
            name: String(s.name ?? 'untitled.hm'),
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
      name: 'main.hm',
      // First-time visitors land on an empty main.hm — the welcome card
      // overlay then guides them into templates / functions / starter
      // demo. Returning users keep their saved scripts.
      code: legacy ?? '',
    }
    if (legacy) { try { localStorage.removeItem(SCRIPT_KEY) } catch { /* quota */ } }
    return { list: [first], activeId: first.id }
  } catch {
    const first: SavedScript = { id: makeScriptId(), name: 'main.hm', code: '' }
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

// Short glyph for the variable kind badge in the workspace panel. Kept
// to one monochrome character so the badges line up at the start of
// each row without pulling focus away from the variable name.
const VAR_KIND_LABEL: Record<MValue['kind'], string> = {
  num:  'N',
  bool: 'B',
  str:  'S',
  mat:  'M',
  fn:   'ƒ',
  void: '·',
}
const VAR_KIND_TITLE: Record<MValue['kind'], string> = {
  num:  'number',
  bool: 'logical',
  str:  'string',
  mat:  'matrix',
  fn:   'function handle',
  void: 'void',
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
      if (v.rows === 1 && v.cols === 1) return { name, kind: 'mat', shape: 'scalar', summary: formatScalar(v.data[0]), value: v }
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
  if (abs !== 0 && (abs >= 1e8 || abs < 1e-4)) return n.toExponential(4)
  if (Number.isInteger(n) && abs < 1e15) return String(n)
  return n.toPrecision(6).replace(/\.?0+$/, '')
}

/* ── Syntax highlighter ─────────────────────────────────────────────── */
// Produces a flat token list for an overlay <pre> that sits behind the
// textarea. Keeps the tokenizer intentionally tolerant: anything it can't
// classify falls through as 'text' so the whole source is always rendered
// exactly as typed (essential for the transparent-textarea overlay trick).
type HTokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'variable' | 'text'
interface HToken { kind: HTokenKind; text: string }

const LANGUAGE_KEYWORDS = new Set([
  'if', 'else', 'elseif', 'end', 'endif', 'endfor', 'endwhile', 'endfunction',
  'for', 'while', 'do', 'until', 'break', 'continue',
  'function', 'return', 'switch', 'case', 'otherwise',
  'try', 'catch', 'global', 'persistent',
  'true', 'false',
])

function highlightSyntax(src: string, varNames?: Set<string>): HToken[] {
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

    // Line comment % ... or # ... (both accepted)
    if (c === '%' || c === '#') {
      flush()
      let j = i
      while (j < n && src[j] !== '\n') j++
      out.push({ kind: 'comment', text: src.slice(i, j) })
      i = j
      continue
    }

    // Double-quoted string
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
      if (/[A-Za-z0-9_)\].]/.test(prevSig)) {
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
      if (LANGUAGE_KEYWORDS.has(word)) {
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
  string:   { color: 'var(--color-accent-green)' },
  number:   { color: 'var(--color-accent-orange)' },
  keyword:  { color: 'var(--color-accent-blue)', fontWeight: 600 },
  variable: { color: 'var(--color-text)' },
  text:     { color: 'var(--color-text)' },
}

// Build a per-character mask of positions that fall inside a line
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
  const { showAlert, showPrompt, AlertDialog } = useAlertDialog()
  const [scriptStore, setScriptStore] = useState<ScriptStore>(loadScripts)
  // Which script IDs have had their welcome overlay explicitly dismissed
  // ("Start with a blank script" or the × close button). Kept as a Set so
  // the overlay re-surfaces for new tabs but stays hidden for the one the
  // user asked to drop focus into.
  const [welcomeDismissed, setWelcomeDismissed] = useState<Set<string>>(() => new Set())
  // Drag-and-drop tab reordering. Ref holds the source id during the drag;
  // state drives the visual drop indicator. We clear both on drop / dragend.
  const draggedTabIdRef = useRef<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  // Right-click context menu on a script tab. Stores the id of the tab
  // the menu applies to plus the click coordinates so the menu opens
  // anchored to the mouse pointer rather than the tab itself.
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // Which toolbar dropdown is currently open. The File button is an
  // anchor point for a rect-derived menu position; null means nothing
  // is open and the backdrop is inert.
  const [toolbarMenu, setToolbarMenu] = useState<null | { kind: 'file' | 'edit' | 'view' | 'run' | 'help'; x: number; y: number }>(null)
  // Hidden file input refs driven by the File menu items. Kept outside
  // the menu so the pickers survive menu close/reopen.
  const scriptFileInputRef = useRef<HTMLInputElement | null>(null)
  const workspaceFileInputRef = useRef<HTMLInputElement | null>(null)
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
  // a single entry kind. Combines with the text filter above. Persisted so
  // users who live in an "errors only" view don't have to re-click it on
  // every reload.
  const [consoleKind, setConsoleKind] = useState<'all' | 'input' | 'output' | 'error'>(() => {
    try {
      const v = localStorage.getItem('compute-workstation-console-kind')
      if (v === 'input' || v === 'output' || v === 'error' || v === 'all') return v
    } catch { /* noop */ }
    return 'all'
  })
  useEffect(() => {
    try { localStorage.setItem('compute-workstation-console-kind', consoleKind) } catch { /* noop */ }
  }, [consoleKind])
  // Inline timestamps chip — when on, each console entry is prefixed
  // with an HH:MM:SS hint. Persisted so the user's preference survives
  // a reload, same pattern as the other console chips.
  const [consoleShowTimestamps, setConsoleShowTimestamps] = useState<boolean>(() => {
    try { return localStorage.getItem('compute-workstation-console-timestamps') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('compute-workstation-console-timestamps', consoleShowTimestamps ? '1' : '0') } catch { /* noop */ }
  }, [consoleShowTimestamps])
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
  // Results overlay — full-screen workspace for figures, console output and
  // variables. The default editor view is intentionally kept clean (just
  // editor + collapsible library + status bar) so non-programmer users —
  // clinicians, surgeons, PKPD researchers — aren't overwhelmed by panels
  // before they've even pressed Run. The overlay opens automatically as soon
  // as a script (or fragment) finishes executing, and can be reopened from
  // the toolbar's "Results" entry without re-running.
  const [resultsOverlay, setResultsOverlay] = useState(false)
  const [resultsTab, setResultsTab] = useState<'figure' | 'console' | 'workspace' | 'imaging'>('figure')
  // Quick-read count of studies for the Imaging tab badge. Refreshed whenever
  // the overlay opens or the shared IMAGING_EVENT fires (script mutations).
  const [imagingStudyCount, setImagingStudyCount] = useState<number>(() => {
    try { return (JSON.parse(localStorage.getItem('research-imaging-studies') || '[]') as unknown[]).length } catch { return 0 }
  })
  useEffect(() => {
    const refresh = () => {
      try { setImagingStudyCount((JSON.parse(localStorage.getItem('research-imaging-studies') || '[]') as unknown[]).length) } catch { /* noop */ }
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    window.addEventListener(IMAGING_EVENT, refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
      window.removeEventListener(IMAGING_EVENT, refresh)
    }
  }, [])
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
  // paste the same matrix into Python, LaTeX, JSON, or CSV
  // without retyping anything.
  const [copyFormat, setCopyFormat] = useState<CopyFormat>('native')
  const [expandedVar, setExpandedVar] = useState<string | null>(null)
  const [inspectVar, setInspectVar] = useState<string | null>(null)
  // The library lives behind a Library ▸ button now — it opens as a
  // full-screen overlay (same pattern as Results) so the editor surface
  // stays calm by default. Closed at startup so first-time users land on
  // a clean editor instead of a sidebar full of stuff to read.
  const [library, setLibrary] = useState<'open' | 'closed'>('closed')
  const [libFilter, setLibFilter] = useState('')
  const [libMode, setLibMode] = useState<'templates' | 'functions' | 'presets'>('templates')
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  // Keyboard cursor inside the library overlay. Indexes into the flat
  // visible-items list for the active mode (templates or functions),
  // not the grouped/category structure. Resets to 0 whenever the mode
  // or the search filter changes so the user always lands on the first
  // result after a search.
  const [libCursor, setLibCursor] = useState(0)
  useEffect(() => { setLibCursor(0) }, [libFilter, libMode, library])
  // Smoothly scroll the highlighted item into view whenever the cursor
  // moves. Uses a data attribute on each item card to keep this side
  // effect cheap (no refs map). Only fires while the library overlay
  // is open.
  useEffect(() => {
    if (library !== 'open') return
    const el = document.querySelector(`[data-lib-idx="${libCursor}"]`)
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [library, libCursor, libMode, libFilter])
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 })
  // Live selection size (characters, logical lines and word count) for the
  // status bar. Null when the user isn't selecting any text.
  const [selectionInfo, setSelectionInfo] = useState<{ chars: number; lines: number; words: number } | null>(null)
  const [lastRunMs, setLastRunMs] = useState<number | null>(null)
  // Persistent state for the status bar's last-run pill: null until the
  // user runs anything for the first time, then true if the most recent
  // run finished cleanly or false if it surfaced an error. Distinct from
  // the toolbar `runPulse` (which auto-fades after a few seconds) so the
  // status bar can keep colour-coding the dot until the next run.
  const [lastRunOk, setLastRunOk] = useState<boolean | null>(null)
  // Calm "run pulse" feedback chip surfaced in the toolbar after every
  // run finishes. It shows ✓ on success or ⚠ on error, plus a one-line
  // summary, and fades out automatically after a few seconds. Designed
  // so users get a visible confirmation without ever having to peek at
  // the status bar.
  const [runPulse, setRunPulse] = useState<{ kind: 'ok' | 'err'; label: string; key: number; tab: 'figure' | 'console' | 'workspace' } | null>(null)
  useEffect(() => {
    if (!runPulse) return
    const id = window.setTimeout(() => {
      setRunPulse(p => (p && p.key === runPulse.key) ? null : p)
    }, 3500)
    return () => window.clearTimeout(id)
  }, [runPulse])
  // Session elapsed time — ticks once per minute so the status bar can
  // show how long this Workstation tab has been open. The ref captures
  // the mount time exactly once; `sessionTick` forces a re-render each
  // minute, with the label derived inline from the delta at render time.
  const sessionStartedAtRef = useRef<number>(Date.now())
  const [sessionTick, setSessionTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSessionTick(t => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const sessionElapsedLabel = (() => {
    void sessionTick // force re-read on each tick
    const mins = Math.floor((Date.now() - sessionStartedAtRef.current) / 60_000)
    if (mins < 1) return 'session <1m'
    if (mins < 60) return `session ${mins}m`
    const h = Math.floor(mins / 60), m = mins % 60
    return `session ${h}h ${m}m`
  })()

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
  const resetEditorFont = useCallback(() => {
    setEditorPrefs(p => ({ ...p, fontSize: EDITOR_FONT_DEFAULT }))
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

  // "Go to symbol" overlay — scans the current script for %% section
  // headers and top-level function definitions, lets the user fuzzy-
  // filter them and jumps the editor to the chosen line. Bound to
  // Ctrl / Cmd + Shift + O.
  const [symbolNavOpen, setSymbolNavOpen] = useState(false)
  const [symbolNavQuery, setSymbolNavQuery] = useState('')
  const [symbolNavIndex, setSymbolNavIndex] = useState(0)
  const symbolNavInputRef = useRef<HTMLInputElement>(null)

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
  // left off rather than snapping to the top of the file. Seeded from
  // localStorage on mount so a page refresh also preserves the caret and
  // scroll position per script.
  const scriptViewStateRef = useRef<Map<string, {
    scrollTop: number; scrollLeft: number; selStart: number; selEnd: number
  }>>((() => {
    try {
      const raw = localStorage.getItem('compute-workstation-view-state')
      if (!raw) return new Map()
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return new Map()
      const map = new Map<string, { scrollTop: number; scrollLeft: number; selStart: number; selEnd: number }>()
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object') {
          const o = v as any
          map.set(k, {
            scrollTop: Number(o.scrollTop) || 0,
            scrollLeft: Number(o.scrollLeft) || 0,
            selStart: Number(o.selStart) || 0,
            selEnd: Number(o.selEnd) || 0,
          })
        }
      }
      return map
    } catch { return new Map() }
  })())
  // Persist the current view-state map to localStorage. Called whenever
  // we mutate the map (switching tabs) and from a beforeunload handler so
  // the active script's live caret also survives a refresh.
  const persistScriptViewState = useCallback(() => {
    try {
      const obj: Record<string, { scrollTop: number; scrollLeft: number; selStart: number; selEnd: number }> = {}
      scriptViewStateRef.current.forEach((v, k) => { obj[k] = v })
      localStorage.setItem('compute-workstation-view-state', JSON.stringify(obj))
    } catch { /* storage full or disabled — silently skip */ }
  }, [])
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
  const highlightTokens = useMemo(() => highlightSyntax(script, varNameSet), [script, varNameSet])

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

  // Esc closes the results overlay. Only attaches when the overlay is up
  // so it doesn't compete with other modals (find bar, palette, etc.).
  useEffect(() => {
    if (!resultsOverlay) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      // Don't fight modals layered on top — they install their own Esc.
      if (plotFullscreen || inspectVar || helpOpen) return
      const tgt = ev.target as HTMLElement | null
      // Don't swallow Esc when the user is closing an inline editor input.
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return
      setResultsOverlay(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [resultsOverlay, plotFullscreen, inspectVar, helpOpen])

  // Esc closes the library overlay. Same guarding as the results overlay
  // so it never fights a modal that's already on top of it.
  useEffect(() => {
    if (library !== 'open') return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      if (plotFullscreen || inspectVar || helpOpen) return
      // Allow the search input inside the overlay to receive its own Esc
      // first — only act when the user has dismissed the input or focused
      // something inside the overlay shell.
      const tgt = ev.target as HTMLElement | null
      if (tgt && tgt.tagName === 'INPUT' && tgt.closest?.('[data-library-overlay]')) {
        // First Esc clears the filter; second Esc (caught next time) closes.
        if ((tgt as HTMLInputElement).value) {
          setLibFilter('')
          ev.preventDefault()
          return
        }
      }
      setLibrary('closed')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [library, plotFullscreen, inspectVar, helpOpen])

  // F1 anywhere in the Workstation toggles the keyboard-shortcut help
  // modal. Esc closes it. Ctrl+L clears the console (bash convention).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'F1') { ev.preventDefault(); setHelpOpen(h => !h) }
      else if (ev.key === 'Escape' && helpOpen) setHelpOpen(false)
      else if (ev.key === 'Escape') { setTabMenu(null); setToolbarMenu(null) }
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
    // Build the new entries and plot list synchronously up front. The
    // previous version mutated `newPlots` from inside a setEntries
    // updater, which only worked because of React's eager-bailout
    // optimization — under concurrent rendering or repeated dispatches
    // the updater can run later than the surrounding code, leaving
    // newPlots empty and skipping setPlots entirely. Computing both
    // arrays before any setState removes the ordering trap.
    const newPlots: PlotSpec[] = []
    const newEntries: ConsoleEntry[] = []
    for (const o of outs) {
      if (o.kind === 'text' && o.text) {
        newEntries.push(mkEntry({ kind: 'output', text: o.text }))
      } else if (o.kind === 'error') {
        newEntries.push(mkEntry({ kind: 'error', text: o.text ?? 'error', line: o.line }))
      } else if (o.kind === 'plot' && o.plot) {
        newPlots.push(o.plot)
        const figLabel = o.plot.mode3d
          ? `[figure] 3D ${o.plot.mode3d}${o.plot.title ? ' — ' + o.plot.title : ''}`
          : `[figure] ${o.plot.series.length} series${o.plot.title ? ' — ' + o.plot.title : ''}`
        newEntries.push(mkEntry({
          kind: 'output',
          text: figLabel,
        }))
      }
    }
    if (newEntries.length > 0) {
      setEntries(prev => [...prev, ...newEntries])
    }
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

  // Look up the builtin doc that matches the identifier under the caret,
  // if any. Drives the calm "docs strip" beneath the editor so a clinician
  // who lands on `mean(` or `linspace` immediately sees the signature
  // without ever opening the library overlay.
  const docAtCaret = useMemo<BuiltinDoc | null>(() => {
    if (!wordAtCaret) return null
    return BUILTIN_DOCS.find(d => d.name === wordAtCaret) ?? null
  }, [wordAtCaret])

  // Same idea, but for live workspace variables. When the caret sits on
  // an identifier that already exists in the workspace, the docs strip
  // shows its kind/shape/summary so users get an at-a-glance reminder of
  // what they're about to feed into a function.
  const varAtCaret = useMemo<VarSnapshot | null>(() => {
    if (!wordAtCaret) return null
    return vars.find(v => v.name === wordAtCaret) ?? null
  }, [wordAtCaret, vars])

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

  // Remembers the most recent fragment handed to runFragment so that a
  // single keystroke (Ctrl+Shift+R) can re-run the exact same slice of
  // script without reselecting. Useful for iterating on a REPL-style
  // workflow: tweak code, re-run the same cell, repeat.
  const lastFragmentRef = useRef<{ src: string; label: string } | null>(null)

  // Core runner. Takes an arbitrary source fragment plus a label that is
  // echoed into the console so the user can tell a full run from a
  // "Run Selection". Used by both runScript and runSelection.
  const runFragment = useCallback((src: string, label: string) => {
    if (running) return
    if (!src.trim()) return
    lastFragmentRef.current = { src, label }
    setRunning(true)
    setErrorLine(null)
    setEntries(prev => [...prev, mkEntry({ kind: 'input', text: label })])
    setTimeout(() => {
      const t0 = performance.now()
      let producedPlot = false
      let producedError = false
      try {
        const res = runEngine(src, workspaceRef.current)
        appendOutputs(res.outputs)
        producedPlot = res.outputs.some(o => o.kind === 'plot')
        const firstErr = res.outputs.find(o => o.kind === 'error' && typeof o.line === 'number')
        if (firstErr?.line) setErrorLine(firstErr.line)
        producedError = res.outputs.some(o => o.kind === 'error')
      } catch (e: any) {
        setEntries(prev => [...prev, mkEntry({ kind: 'error', text: String(e?.message ?? e) })])
        producedError = true
      } finally {
        const ms = performance.now() - t0
        setLastRunMs(ms)
        setLastRunOk(!producedError)
        setRunning(false)
        // Pre-select the most informative tab in the Results overlay so that
        // when the user opens it (via the pulse chip, the toolbar Results
        // button, or a status-bar pill) it lands on the right view. We do
        // NOT auto-open the overlay anymore — clinicians, surgeons and
        // PKPD researchers asked for the workstation to stay calm and
        // uninterrupted after each run. The pulse chip below is the
        // discoverable, on-demand entry point.
        const nextTab: 'figure' | 'console' | 'workspace' =
          producedError ? 'console' : producedPlot ? 'figure' : 'console'
        setResultsTab(nextTab)
        // Drop a calm pulse chip in the toolbar so the user gets a
        // confirmation that registers even if they never glance at the
        // status bar. The chip is clickable — one click opens Results on
        // the appropriate tab. Auto-dismisses via the runPulse useEffect.
        const durLabel = ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`
        setRunPulse({
          kind: producedError ? 'err' : 'ok',
          label: producedError
            ? 'Error · view console'
            : producedPlot
              ? `Done · view figure · ${durLabel}`
              : `Done · ${durLabel}`,
          key: Date.now(),
          tab: nextTab,
        })
      }
    }, 0)
  }, [running, appendOutputs])

  const runScript = useCallback(() => {
    runFragment(script, '▶ run script')
  }, [script, runFragment])

  // Run the current textarea selection, or the caret's line if nothing
  // is selected. Standard F9 behaviour.
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
  // Standard script partitioning (%% sections): a block starting at either
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

  // Run everything from the start of the script up to and including the
  // line the caret is on. Handy for stepping through a long script one
  // chunk at a time without having to re-run earlier cells manually.
  const runUntilCursor = useCallback(() => {
    const lines = script.split('\n')
    const upto = Math.max(1, Math.min(cursor.line, lines.length))
    const fragment = lines.slice(0, upto).join('\n')
    if (!fragment.trim()) return
    runFragment(fragment, `▶ run until line ${upto}`)
  }, [script, cursor.line, runFragment])

  // Re-execute the most recent fragment — whether it was a full script,
  // a selection, a section, or a "run until cursor". Falls back to a
  // full-script run if nothing has been executed yet in this session.
  const rerunLastFragment = useCallback(() => {
    const last = lastFragmentRef.current
    if (last) {
      runFragment(last.src, `↻ ${last.label.replace(/^▶\s*/, '')}`)
    } else {
      runFragment(script, '▶ run script')
    }
  }, [runFragment, script])

  const runCommand = useCallback((text: string) => {
    const line = text.trim()
    if (!line) return
    setEntries(prev => [...prev, mkEntry({ kind: 'input', text: `>> ${line}` })])
    const h = [...history, line]
    setHistory(h); saveHistory(h); setHistIdx(null)
    try {
      const res = runEngine(line, workspaceRef.current)
      appendOutputs(res.outputs)
    } catch (e: any) {
      setEntries(prev => [...prev, mkEntry({ kind: 'error', text: String(e?.message ?? e) })])
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
    // workspace variables, builtins, and keywords. A second Tab
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
      for (const k of LANGUAGE_KEYWORDS) {
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

  // Strip only error entries, leaving input / output scrollback intact. Useful
  // after fixing a batch of reported problems — the user can wipe the red
  // noise without losing their command history or computed values.
  const clearConsoleErrors = useCallback(() => {
    setEntries(prev => prev.some(e => e.kind === 'error') ? prev.filter(e => e.kind !== 'error') : prev)
  }, [])

  // Copy the currently visible console entries as plain text so the user
  // can paste them into a note or bug report. Re-uses the visibleEntries
  // pipeline so the export respects the active kind / text filters —
  // "copy what you see" rather than dumping the full backlog.
  const [copyFlash, setCopyFlash] = useState(false)
  // Serialize the visible console into a plain-text transcript. Shared by
  // the clipboard copy button and the "download transcript" command so
  // both paths produce the same formatting.
  const serializeConsole = useCallback(() => {
    return visibleEntries.map(e => {
      if (e.kind === 'input') return `> ${e.text}`
      if (e.kind === 'error') return `! ${e.text}`
      return e.text
    }).join('\n')
  }, [visibleEntries])

  const copyConsole = useCallback(() => {
    const text = serializeConsole()
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
  }, [serializeConsole])

  // Download the console transcript as a .txt file. Named with the
  // active script and a short timestamp so repeated exports don't
  // clobber each other in the user's downloads folder.
  const downloadConsole = useCallback(() => {
    const text = serializeConsole()
    if (!text) return
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const scriptName = scriptStore.list.find(s => s.id === scriptStore.activeId)?.name ?? 'session'
    const base = scriptName.replace(/\.hm$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'session'
    const filename = `workstation-${base}-${stamp}.txt`
    const header = `% Humanovo Workstation console transcript\n% script: ${scriptName}\n% saved: ${now.toISOString()}\n\n`
    const blob = new Blob([header + text + '\n'], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [serializeConsole, scriptStore.list, scriptStore.activeId])

  const resetWorkspace = () => {
    workspaceRef.current = createWorkspace()
    clearSavedWorkspace()
    setVars([])
    setPlots([])
    setActivePlot(0)
    setEntries(prev => [...prev, mkEntry({ kind: 'output', text: '— workspace cleared —' })])
  }

  // Resolve the currently displayed plot into a raster image via the
  // shared `plotExport` utility, which handles both Recharts / inline
  // SVG plots and Plotly (WebGL / canvas) plots uniformly.
  //
  // Exports default to a **fully transparent** background so figures
  // drop into papers and slide decks without the app chrome bleeding
  // through. Pass `transparent: false` (via the util directly) if a
  // solid bg is ever needed here.
  const getCurrentPlotBlob = useCallback(async (format: 'png' | 'svg'): Promise<Blob | null> => {
    return getPlotBlob(plotBodyRef.current, format)
  }, [])

  /** Copy the current figure to clipboard as PNG with solid adaptive background. */
  const copyPlotToClipboard = useCallback(async () => {
    try {
      const blob = await getCurrentPlotBlob('png')
      if (!blob) return
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch { /* clipboard write may fail in restricted contexts */ }
  }, [getCurrentPlotBlob])

  /** Export the currently rendered figure as SVG. */
  const exportPlotSVG = useCallback(async () => {
    const blob = await getCurrentPlotBlob('svg')
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const title = plots[activePlot]?.title?.replace(/[^\w-]+/g, '_') || `figure-${activePlot + 1}`
    a.href = url
    a.download = `${title}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }, [plots, activePlot, getCurrentPlotBlob])

  /** Export the currently rendered figure as PNG (rasterized at 2× DPR). */
  const exportPlotPNG = useCallback(async () => {
    const blob = await getCurrentPlotBlob('png')
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const title = plots[activePlot]?.title?.replace(/[^\w-]+/g, '_') || `figure-${activePlot + 1}`
    a.href = url
    a.download = `${title}.png`
    a.click()
    URL.revokeObjectURL(url)
  }, [plots, activePlot, getCurrentPlotBlob])

  /** Export the underlying series data of the current figure as CSV. */
  const exportPlotCSV = useCallback(() => {
    const plot = plots[activePlot]
    if (!plot || (plot.series.length === 0 && !plot.mode3d)) return
    if (plot.mode3d) return // 3D CSV export not supported yet
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
          setEntries(prev => [...prev, mkEntry({ kind: 'error', text: `${file.name}: not a workspace JSON file` })])
          return
        }
        let n = 0
        for (const [name, ser] of Object.entries(parsed.vars)) {
          const v = deserializeMValue(ser as SerialMValue)
          if (v) { workspaceRef.current.vars.set(name, v); n++ }
        }
        setVars(snapshotWorkspace(workspaceRef.current))
        saveWorkspace(workspaceRef.current)
        setEntries(prev => [...prev, mkEntry({
          kind: 'output',
          text: `Imported ${n} variable${n === 1 ? '' : 's'} from ${file.name}`,
        })])
      } catch (e: any) {
        setEntries(prev => [...prev, mkEntry({ kind: 'error', text: `${file.name}: ${String(e?.message ?? e)}` })])
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

  // Render a workspace value in the chosen target language. Formats are
  // picked via the small chip in the workspace panel header so users can
  // move matrices into Python/numpy, LaTeX, JSON, or plain CSV
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
          case 'native': {
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
    setEntries(prev => [...prev, mkEntry({
      kind: 'output',
      text: `Copied ${name} to clipboard as ${copyFormat} (${text.length} chars)`,
    })])
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
  const renameIdentifierAtCaret = useCallback(async () => {
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
    const next = await showPrompt(`Rename "${old}" to:`, 'Rename Variable', old)
    if (!next || next === old) return
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(next)) {
      showAlert(`"${next}" is not a valid identifier.`, 'Invalid Name')
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
  }, [setScript, showPrompt, showAlert])

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
  // palette commands below to stamp out common code skeletons.
  // Apply an in-place text transform to the current selection, or to the
  // current line when nothing is selected. Returns early if the result
  // would be identical (avoids clobbering undo history with no-ops).
  const applySelectionTransform = useCallback((transform: (text: string) => string) => {
    const ta = editorRef.current
    if (!ta) return
    let { selectionStart: s, selectionEnd: e } = ta
    const value = ta.value
    if (s === e) {
      // No selection: expand to the caret's full line.
      s = value.lastIndexOf('\n', s - 1) + 1
      const nl = value.indexOf('\n', e)
      e = nl < 0 ? value.length : nl
    }
    const before = value.slice(s, e)
    const after = transform(before)
    if (after === before) return
    const next = value.slice(0, s) + after + value.slice(e)
    setScript(next)
    requestAnimationFrame(() => {
      const ta2 = editorRef.current
      if (!ta2) return
      ta2.focus()
      ta2.setSelectionRange(s, s + after.length)
    })
  }, [setScript])

  // Sort the selected lines alphabetically, falling back to the caret's
  // line if nothing is selected (a no-op in that case). Stable-ish sort
  // via localeCompare so mixed case and numbers behave naturally.
  const sortSelectedLines = useCallback(() => {
    applySelectionTransform(text => {
      const lines = text.split('\n')
      if (lines.length < 2) return text
      return lines.slice().sort((a, b) => a.localeCompare(b)).join('\n')
    })
  }, [applySelectionTransform])

  // Collapse the selection down to its unique lines, preserving first-
  // seen order so the shape of the block is closer to what the user
  // started with. Handy for de-duplicating pasted output or variable
  // name lists.
  const uniqueSelectedLines = useCallback(() => {
    applySelectionTransform(text => {
      const lines = text.split('\n')
      if (lines.length < 2) return text
      const seen = new Set<string>()
      const out: string[] = []
      for (const ln of lines) {
        if (!seen.has(ln)) { seen.add(ln); out.push(ln) }
      }
      return out.join('\n')
    })
  }, [applySelectionTransform])

  // Drop blank lines (lines that are empty or only whitespace) from the
  // selection. Pairs well with sortSelectedLines for cleaning up pasted
  // text.
  const removeEmptySelectedLines = useCallback(() => {
    applySelectionTransform(text => {
      const lines = text.split('\n')
      const filtered = lines.filter(ln => ln.trim().length > 0)
      if (filtered.length === lines.length) return text
      return filtered.join('\n')
    })
  }, [applySelectionTransform])

  // Convert every hard tab in the script into two spaces — the same
  // indent width used by the editor's Tab handler. Useful after pasting
  // code from an external editor that still indents with tabs. Caret
  // position is mapped forward so it tracks its old character even
  // when expansion shifts later characters to the right.
  const convertTabsToSpaces = useCallback(() => {
    const ta = editorRef.current
    if (!ta) return
    const value = ta.value
    if (value.indexOf('\t') < 0) return
    const caret = ta.selectionStart
    // Count tabs that sit before the caret so we know how many extra
    // characters were inserted ahead of it by the expansion.
    let tabsBeforeCaret = 0
    for (let i = 0; i < caret; i++) if (value[i] === '\t') tabsBeforeCaret++
    const next = value.replace(/\t/g, '  ')
    setScript(next)
    const newCaret = caret + tabsBeforeCaret
    requestAnimationFrame(() => {
      const ta2 = editorRef.current
      if (!ta2) return
      ta2.focus()
      ta2.setSelectionRange(newCaret, newCaret)
    })
  }, [setScript])

  // Join the current line with the next — replacing the intervening
  // newline (and any run of indent whitespace on the follower) with a
  // single space. When a range of lines is selected, every internal
  // newline in the selection is joined, matching VS Code's "Join Lines"
  // behaviour. No-op on the final line when nothing is selected.
  const joinLines = useCallback(() => {
    const ta = editorRef.current
    if (!ta) return
    const value = ta.value
    let { selectionStart: s, selectionEnd: e } = ta
    if (s === e) {
      // Expand to "current line" so the join replaces the newline
      // between it and the next line.
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const nextNl = value.indexOf('\n', s)
      if (nextNl < 0) return // already the last line, nothing to join
      const nextLineEnd = value.indexOf('\n', nextNl + 1)
      s = lineStart
      e = nextLineEnd < 0 ? value.length : nextLineEnd
    }
    const before = value.slice(0, s)
    const middle = value.slice(s, e)
    const after = value.slice(e)
    // Collapse each newline + run of leading whitespace into a single
    // space, but drop the space if the previous character is already
    // whitespace so joins don't introduce doubled gaps.
    const joined = middle.replace(/\n[ \t]*/g, (_m, offset: number) => {
      // offset is relative to `middle` — check the char immediately
      // before the match in the joined substring we're building.
      const prev = offset > 0 ? middle[offset - 1] : ''
      return prev && /\s/.test(prev) ? '' : ' '
    })
    if (joined === middle) return
    const next = before + joined + after
    setScript(next)
    const caret = before.length + joined.length
    requestAnimationFrame(() => {
      const ta2 = editorRef.current
      if (!ta2) return
      ta2.focus()
      ta2.setSelectionRange(caret, caret)
    })
  }, [setScript])

  // Strip trailing spaces and tabs from every line in the script. Keeps
  // the caret on the same logical line, clamping its column so it lands
  // on the new end-of-line when the user sat inside the removed run.
  const trimTrailingWhitespace = useCallback(() => {
    const ta = editorRef.current
    if (!ta) return
    const value = ta.value
    const trimmed = value.replace(/[ \t]+$/gm, '')
    if (trimmed === value) return
    // Map the current caret from old-space to new-space by walking line
    // by line and accounting for how much each line shrank.
    const oldLines = value.split('\n')
    const newLines = trimmed.split('\n')
    const caret = ta.selectionStart
    let oldOff = 0
    let newOff = 0
    let targetNew = 0
    for (let i = 0; i < oldLines.length; i++) {
      const oldLen = oldLines[i].length
      const newLen = newLines[i].length
      if (caret <= oldOff + oldLen) {
        const col = caret - oldOff
        targetNew = newOff + Math.min(col, newLen)
        break
      }
      oldOff += oldLen + 1 // + '\n'
      newOff += newLen + 1
      targetNew = newOff
    }
    setScript(trimmed)
    requestAnimationFrame(() => {
      const ta2 = editorRef.current
      if (!ta2) return
      ta2.focus()
      ta2.setSelectionRange(targetNew, targetNew)
    })
  }, [setScript])

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

  // Collect the script line of every error entry in the console. Used by
  // F8 (next error) and Shift+F8 (previous error) to step through all
  // reported issues without visually scanning the console, and by the
  // gutter so every offending line gets a marker — not just the most
  // recent one that setErrorLine captured.
  const errorLines = useMemo(() => {
    const seen = new Set<number>()
    const out: number[] = []
    for (const e of entries) {
      if (e.kind === 'error' && typeof e.line === 'number' && !seen.has(e.line)) {
        seen.add(e.line)
        out.push(e.line)
      }
    }
    out.sort((a, b) => a - b)
    return out
  }, [entries])
  const errorLineSet = useMemo(() => new Set(errorLines), [errorLines])

  // Jump to the next (or previous) reported error line, wrapping around
  // when the caret is past the last one. No-op when there are no errors.
  const gotoNextError = useCallback((dir: 1 | -1) => {
    if (errorLines.length === 0) return
    const line = cursor.line
    if (dir === 1) {
      const next = errorLines.find(l => l > line) ?? errorLines[0]
      jumpToLine(next)
    } else {
      const prev = [...errorLines].reverse().find(l => l < line) ?? errorLines[errorLines.length - 1]
      jumpToLine(prev)
    }
  }, [errorLines, cursor.line, jumpToLine])

  // Scan the current script for symbols — %% section headers and top-level
  // `function` definitions. Captured greedily (no scope analysis) because
  // The language allows multiple local functions per file and nested functions.
  type ScriptSymbol = { kind: 'section' | 'fn'; name: string; line: number }
  const scriptSymbols = useMemo<ScriptSymbol[]>(() => {
    const out: ScriptSymbol[] = []
    const lines = script.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      const secM = /^\s*%%\s*(.*)$/.exec(ln)
      if (secM) {
        out.push({ kind: 'section', name: secM[1].trim() || `section ${out.filter(s => s.kind === 'section').length + 1}`, line: i + 1 })
        continue
      }
      // Accept both `function name(` and `function [out] = name(` forms.
      const fnM = /^\s*function\s+(?:[[\]\w,\s]+=\s*)?([A-Za-z_]\w*)\s*\(/.exec(ln)
      if (fnM) {
        out.push({ kind: 'fn', name: fnM[1], line: i + 1 })
      }
    }
    return out
  }, [script])

  // Name of the enclosing function at the caret (or null if the caret
  // is in top-level script space). Uses the symbol list: the answer is
  // the last function-kind symbol at or before the caret line, unless
  // a subsequent function or section has already opened a new scope.
  const enclosingFunctionName = useMemo(() => {
    const fns = scriptSymbols.filter(s => s.kind === 'fn')
    if (fns.length === 0) return null
    let current: ScriptSymbol | null = null
    for (const fn of fns) {
      if (fn.line <= cursor.line) current = fn
      else break
    }
    return current?.name ?? null
  }, [scriptSymbols, cursor.line])

  const visibleScriptSymbols = useMemo(() => {
    const q = symbolNavQuery.trim().toLowerCase()
    if (!q) return scriptSymbols
    const tokens = q.split(/\s+/)
    return scriptSymbols.filter(s => {
      const hay = s.name.toLowerCase()
      return tokens.every(t => hay.includes(t))
    })
  }, [scriptSymbols, symbolNavQuery])

  const openSymbolNav = useCallback(() => {
    setFindOpen(false)
    setGotoOpen(false)
    setSymbolNavOpen(true)
    setSymbolNavQuery('')
    setSymbolNavIndex(0)
    requestAnimationFrame(() => {
      symbolNavInputRef.current?.focus()
      symbolNavInputRef.current?.select()
    })
  }, [])

  const closeSymbolNav = useCallback(() => {
    setSymbolNavOpen(false)
    editorRef.current?.focus()
  }, [])

  const commitSymbolNav = useCallback(() => {
    const sym = visibleScriptSymbols[symbolNavIndex]
    if (!sym) return
    setSymbolNavOpen(false)
    jumpToLine(sym.line)
  }, [visibleScriptSymbols, symbolNavIndex, jumpToLine])

  // Keep the active row inside the filtered range as the user types.
  useEffect(() => {
    if (symbolNavIndex >= visibleScriptSymbols.length) {
      setSymbolNavIndex(Math.max(0, visibleScriptSymbols.length - 1))
    }
  }, [visibleScriptSymbols, symbolNavIndex])

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
  //   F9                     — run selection
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
      if (e.shiftKey) runUntilCursor()
      else runSelection()
      return
    }
    // Ctrl/Cmd + Shift + R — re-run the most recent fragment regardless of
    // what's currently selected. Mirrors the "Rerun" convention from most
    // JetBrains IDEs and shells. Plain Ctrl+R is taken by reverse history
    // search on the command line, so the shift variant avoids the clash.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault()
      rerunLastFragment()
      return
    }
    // F8 steps to the next error reported in the console. Shift+F8
    // walks backwards. Both wrap around and no-op when the console
    // has no errors yet.
    if (e.key === 'F8') {
      e.preventDefault()
      gotoNextError(e.shiftKey ? -1 : 1)
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
    // Ctrl/Cmd + J — join the current line (or selection of lines) with
    // the next, collapsing the intervening newline plus indent run into
    // a single space. Matches VS Code's "Join Lines" binding.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault()
      joinLines()
      return
    }
    // Ctrl/Cmd + = / + — grow the editor font size. Ctrl+- shrinks,
    // Ctrl+0 resets to the default. Matches the browser zoom shortcuts
    // so the muscle memory carries over. We only preventDefault when
    // the editor actually has focus, so the page-level browser zoom
    // still works elsewhere in the Workstation.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      bumpEditorFont(1)
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '-') {
      e.preventDefault()
      bumpEditorFont(-1)
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '0') {
      e.preventDefault()
      resetEditorFont()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault()
      openGoto()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault()
      openSymbolNav()
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

    // Ctrl+/ — toggle line comment (%)
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
        for (const k of LANGUAGE_KEYWORDS) {
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
      // Don't auto-pair single-quote after an identifier (transpose operator)
      if (e.key === "'" && /[A-Za-z0-9_)\].]/.test(value[s - 1] ?? '')) {
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
      // the feel of a standard editor — `if cond⏎` lands the caret
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
  }, [runScript, runSelection, runSection, runUntilCursor, rerunLastFragment, openFind, openGoto, openSymbolNav, setScript, vars, acOpen, acItems, acIndex, acceptAutocomplete, closeAutocomplete, editorFontSize, sigHint, toggleBookmarkAtCaret, gotoBookmark, gotoMatchingBracket, gotoNextError, joinLines, bumpEditorFont, resetEditorFont])

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
      const words = (selText.match(/[A-Za-z0-9_]+/g)?.length ?? 0)
      setSelectionInfo({ chars: selLen, lines: nl + 1, words })
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
      persistScriptViewState()
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
  }, [scriptStore.activeId, updateCursor, persistScriptViewState])

  // Catch a page unload / tab switch (visibility hide) and flush the
  // current caret position of the active script into the persisted view
  // state. Without this the activeId-change handler only ever saves on
  // *tab switch*, so a straight refresh after typing would lose the
  // current caret.
  useEffect(() => {
    const flush = () => {
      const ta = editorRef.current
      const id = scriptStore.activeId
      if (!ta || !id) return
      scriptViewStateRef.current.set(id, {
        scrollTop: ta.scrollTop,
        scrollLeft: ta.scrollLeft,
        selStart: ta.selectionStart,
        selEnd: ta.selectionEnd,
      })
      persistScriptViewState()
    }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      flush()
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [scriptStore.activeId, persistScriptViewState])

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
        loaded[idx] = { name: f.name || `upload-${idx + 1}.hm`, code: String(r.result ?? '') }
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
      setEntries(prev => [...prev, mkEntry({
        kind: 'output',
        text: `Imported ${file.name} → ${name} (${rows}×${cols})${firstIsHeader ? ' · header row skipped' : ''}`,
      })])
    }
    r.readAsText(file)
  }, [])

  // Top-level drag/drop on the whole Workstation: .csv files become
  // workspace variables, .hm/.txt files become new script tabs.
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
    a.download = activeScript?.name || 'script.hm'
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
      while (store.list.some(s => s.name === `${base}${n}.hm`)) n++
      return {
        // New tabs start genuinely empty so the welcome card surfaces — that
        // way clinicians/surgeons hitting "+" land on a guided start screen
        // instead of a lone "% New script" comment they have to delete.
        list: [...store.list, { id, name: `${base}${n}.hm`, code: '' }],
        activeId: id,
      }
    })
  }, [])

  const switchScript = useCallback((id: string) => {
    setScriptStore(store => store.activeId === id ? store : { ...store, activeId: id })
  }, [])

  const closeScript = useCallback((id: string) => {
    setScriptStore(store => {
      const idx = store.list.findIndex(s => s.id === id)
      if (idx < 0) return store
      // Remember the closed script (plus its original position) so
      // Ctrl+Shift+T can restore it at the same spot.
      const closed = store.list[idx]
      closedScriptsRef.current.push({ script: closed, index: idx })
      // Cap the ring so we don't grow without bound.
      if (closedScriptsRef.current.length > 12) closedScriptsRef.current.shift()
      // Allow closing every tab — users asked for the ability to land on
      // a clean empty-state ("+ New Script" centered) rather than being
      // force-fed an auto-spawned `untitled.py` every time they close the
      // last tab. The body of the editor surface renders the empty-state
      // when `scriptStore.list.length === 0`.
      const list = store.list.filter(s => s.id !== id)
      if (list.length === 0) {
        return { list: [], activeId: '' }
      }
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

  // Close every tab except the given id. Pushes all closed scripts onto
  // the reopen ring (newest last) so Ctrl+Shift+T can walk back through
  // them one at a time, mirroring browser tab behaviour.
  const closeOtherScripts = useCallback((keepId: string) => {
    setScriptStore(store => {
      if (store.list.length <= 1) return store
      const keepIdx = store.list.findIndex(s => s.id === keepId)
      if (keepIdx < 0) return store
      const victims = store.list.filter(s => s.id !== keepId)
      for (const v of victims) {
        const originalIdx = store.list.findIndex(s => s.id === v.id)
        closedScriptsRef.current.push({ script: v, index: originalIdx })
      }
      while (closedScriptsRef.current.length > 12) closedScriptsRef.current.shift()
      return { list: [store.list[keepIdx]], activeId: keepId }
    })
  }, [])

  // Close every tab to the right of the given id. Useful after opening
  // a bunch of scratch tabs and wanting to clear them without touching
  // the pinned leftmost set.
  const closeScriptsToRight = useCallback((pivotId: string) => {
    setScriptStore(store => {
      const pivot = store.list.findIndex(s => s.id === pivotId)
      if (pivot < 0 || pivot >= store.list.length - 1) return store
      const keepers = store.list.slice(0, pivot + 1)
      const victims = store.list.slice(pivot + 1)
      for (let i = 0; i < victims.length; i++) {
        closedScriptsRef.current.push({ script: victims[i], index: pivot + 1 + i })
      }
      while (closedScriptsRef.current.length > 12) closedScriptsRef.current.shift()
      const activeId = keepers.some(s => s.id === store.activeId)
        ? store.activeId
        : pivotId
      return { list: keepers, activeId }
    })
  }, [])

  const renameScript = useCallback(async (id: string) => {
    const current = scriptStore.list.find(s => s.id === id)
    if (!current) return
    const next = await showPrompt('Enter new name:', 'Rename Script', current.name)
    if (!next) return
    setScriptStore(store => ({
      ...store,
      list: store.list.map(s => s.id === id ? { ...s, name: next } : s),
    }))
  }, [scriptStore, showPrompt])

  // Duplicate a script tab — creates an exact copy of the given script's
  // code under a derived name (` (copy)`, ` (copy 2)`, …) immediately
  // after the source in the tab bar and switches focus to it. Used by
  // the palette command and the tab right-click menu.
  const duplicateScript = useCallback((id: string) => {
    setScriptStore(store => {
      const src = store.list.find(s => s.id === id)
      if (!src) return store
      // Build a non-colliding name: "foo.hm" → "foo (copy).hm",
      // "foo (copy).hm" → "foo (copy 2).hm", and so on.
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
    { id: 'run-last',     title: 'Re-run last fragment',         hint: 'Ctrl+Shift+R',     run: () => rerunLastFragment() },
    { id: 'run-sel',      title: 'Run selection',                hint: 'F9',               run: () => runSelection() },
    { id: 'run-sec',      title: 'Run current %% section',       hint: 'Alt+Ctrl+Enter',   run: () => runSection() },
    { id: 'run-until',    title: 'Run until cursor line',        hint: 'Shift+F9',         run: () => runUntilCursor() },
    { id: 'find',         title: 'Find and replace',             hint: 'Ctrl+F',           run: () => openFind() },
    { id: 'goto',         title: 'Go to line',                   hint: 'Ctrl+G',           run: () => openGoto() },
    { id: 'new-script',   title: 'New script',                   hint: '',                 run: () => newScript() },
    { id: 'dup-script',   title: 'Duplicate current script',     hint: '',                 run: () => duplicateScript(scriptStore.activeId) },
    { id: 'close-script', title: 'Close current script',         hint: 'Ctrl+W',           run: () => closeScript(scriptStore.activeId) },
    { id: 'close-other',  title: 'Close other script tabs',      hint: '',                 run: () => closeOtherScripts(scriptStore.activeId) },
    { id: 'close-right',  title: 'Close script tabs to the right', hint: '',               run: () => closeScriptsToRight(scriptStore.activeId) },
    { id: 'reopen',       title: 'Reopen last closed script',    hint: 'Ctrl+Shift+T',     run: () => reopenLastClosedScript() },
    { id: 'rename',       title: 'Rename current script',        hint: '',                 run: () => renameScript(scriptStore.activeId) },
    { id: 'wrap',         title: 'Toggle word wrap',             hint: '',                 run: () => toggleEditorWrap() },
    { id: 'font-up',      title: 'Increase editor font size',    hint: 'Ctrl+=',           run: () => bumpEditorFont(1) },
    { id: 'font-down',    title: 'Decrease editor font size',    hint: 'Ctrl+-',           run: () => bumpEditorFont(-1) },
    { id: 'font-reset',   title: 'Reset editor font size',       hint: 'Ctrl+0',           run: () => resetEditorFont() },
    { id: 'clear-con',    title: 'Clear console',                hint: 'Ctrl+L',           run: () => clearConsole() },
    { id: 'clear-err',    title: 'Clear only error entries',     hint: '',                 run: () => clearConsoleErrors() },
    { id: 'con-time',     title: 'Toggle console timestamps',    hint: '',                 run: () => setConsoleShowTimestamps(v => !v) },
    { id: 'copy-con',     title: 'Copy console to clipboard',    hint: '',                 run: () => copyConsole() },
    { id: 'dl-con',       title: 'Download console transcript',  hint: '',                 run: () => downloadConsole() },
    { id: 'reset-ws',     title: 'Reset workspace',              hint: '',                 run: () => resetWorkspace() },
    { id: 'exp-ws',       title: 'Export workspace as JSON',     hint: '',                 run: () => exportWorkspaceJson() },
    { id: 'exp-svg',      title: 'Export current figure as SVG', hint: '',                 run: () => exportPlotSVG() },
    { id: 'exp-png',      title: 'Export current figure as PNG', hint: '',                 run: () => exportPlotPNG() },
    { id: 'exp-csv',      title: 'Export figure data as CSV',    hint: '',                 run: () => exportPlotCSV() },
    { id: 'clear-figs',   title: 'Clear all figures',            hint: '',                 run: () => { setPlots([]); setActivePlot(0) } },
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
    { id: 'trim-ws',      title: 'Trim trailing whitespace',     hint: '',                 run: () => trimTrailingWhitespace() },
    { id: 'tabs-spaces',  title: 'Convert tabs to spaces',       hint: '',                 run: () => convertTabsToSpaces() },
    { id: 'join-lines',   title: 'Join line with next',          hint: 'Ctrl+J',           run: () => joinLines() },
    { id: 'upper-sel',    title: 'Uppercase selection',          hint: '',                 run: () => applySelectionTransform(s => s.toUpperCase()) },
    { id: 'lower-sel',    title: 'Lowercase selection',          hint: '',                 run: () => applySelectionTransform(s => s.toLowerCase()) },
    { id: 'sort-lines',   title: 'Sort selected lines',          hint: '',                 run: () => sortSelectedLines() },
    { id: 'unique-lines', title: 'Unique selected lines',        hint: '',                 run: () => uniqueSelectedLines() },
    { id: 'drop-blank',   title: 'Remove empty selected lines',  hint: '',                 run: () => removeEmptySelectedLines() },
    { id: 'reverse-lines', title: 'Reverse selected lines',      hint: '',                 run: () => applySelectionTransform(s => s.split('\n').reverse().join('\n')) },
    { id: 'goto-bracket', title: 'Go to matching bracket',       hint: 'Ctrl+M',           run: () => gotoMatchingBracket(false) },
    { id: 'sel-bracket',  title: 'Select to matching bracket',   hint: 'Ctrl+Shift+M',     run: () => gotoMatchingBracket(true) },
    { id: 'goto-sym',     title: 'Go to symbol in script',       hint: 'Ctrl+Shift+O',     run: () => openSymbolNav() },
    { id: 'next-err',     title: 'Jump to next error',           hint: 'F8',               run: () => gotoNextError(1) },
    { id: 'prev-err',     title: 'Jump to previous error',       hint: 'Shift+F8',         run: () => gotoNextError(-1) },
    { id: 'res-show',     title: 'Show Results overlay',         hint: '',                 run: () => setResultsOverlay(true) },
    { id: 'res-fig',      title: 'Show figure in Results',       hint: '',                 run: () => { setResultsTab('figure'); setResultsOverlay(true) } },
    { id: 'res-con',      title: 'Show console in Results',      hint: '',                 run: () => { setResultsTab('console'); setResultsOverlay(true) } },
    { id: 'res-ws',       title: 'Show workspace in Results',    hint: '',                 run: () => { setResultsTab('workspace'); setResultsOverlay(true) } },
    { id: 'help',         title: 'Show keyboard shortcuts',      hint: 'F1',               run: () => setHelpOpen(true) },
  ], [runScript, runSelection, runSection, runUntilCursor, rerunLastFragment, openFind, openGoto, openSymbolNav, gotoNextError, newScript, duplicateScript, closeScript, closeOtherScripts, closeScriptsToRight, reopenLastClosedScript, renameScript, scriptStore.activeId, toggleEditorWrap, bumpEditorFont, resetEditorFont, copyConsole, downloadConsole, clearConsoleErrors, exportWorkspaceJson, exportPlotSVG, exportPlotPNG, exportPlotCSV, toggleBookmarkAtCaret, gotoBookmark, clearAllBookmarks, insertSnippet, renameIdentifierAtCaret, gotoMatchingBracket, trimTrailingWhitespace, convertTabsToSpaces, applySelectionTransform, sortSelectedLines, uniqueSelectedLines, removeEmptySelectedLines, joinLines])

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

  // Map a command id to a human-friendly category. The order in this
  // list matches the order categories appear in the unfiltered palette
  // view, so the most-used groups (Run, Edit, Navigate) sit at the top.
  const PALETTE_CATEGORY_ORDER = [
    'Run', 'Edit', 'Navigate', 'Scripts', 'View', 'Console', 'Workspace', 'Figures', 'Snippets', 'Help',
  ] as const
  const categoryOfPaletteCommand = (id: string): typeof PALETTE_CATEGORY_ORDER[number] => {
    if (id === 'run' || id.startsWith('run-')) return 'Run'
    if (id === 'goto-sym' || id === 'next-err' || id === 'prev-err' || id.startsWith('bm-')) return 'Navigate'
    if (id.startsWith('snip-')) return 'Snippets'
    if (id === 'find' || id === 'goto' || id === 'rename-id' || id === 'trim-ws' || id === 'tabs-spaces' || id === 'join-lines' || id === 'upper-sel' || id === 'lower-sel' || id === 'sort-lines' || id === 'unique-lines' || id === 'drop-blank' || id === 'reverse-lines' || id === 'goto-bracket' || id === 'sel-bracket') return 'Edit'
    if (id === 'new-script' || id === 'dup-script' || id === 'close-script' || id === 'close-other' || id === 'close-right' || id === 'reopen' || id === 'rename') return 'Scripts'
    if (id === 'wrap' || id === 'font-up' || id === 'font-down' || id === 'font-reset' || id.startsWith('res-')) return 'View'
    if (id === 'clear-con' || id === 'clear-err' || id === 'con-time' || id === 'copy-con' || id === 'dl-con') return 'Console'
    if (id === 'reset-ws' || id === 'exp-ws') return 'Workspace'
    if (id === 'exp-svg' || id === 'exp-png' || id === 'exp-csv' || id === 'clear-figs') return 'Figures'
    if (id === 'help') return 'Help'
    return 'Edit'
  }
  // When the palette is unfiltered, walk paletteCommands once and emit
  // a flat array of either category headings or commands so the render
  // pass stays simple and the keyboard cursor still maps cleanly to a
  // command index in visiblePaletteCommands.
  const groupedPaletteRows = useMemo(() => {
    if (paletteQuery.trim()) return null
    type Row = { kind: 'cat'; label: string } | { kind: 'cmd'; cmd: typeof paletteCommands[number]; flatIdx: number }
    const grouped: Record<string, typeof paletteCommands> = {}
    paletteCommands.forEach(c => {
      const cat = categoryOfPaletteCommand(c.id)
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(c)
    })
    const rows: Row[] = []
    let flatIdx = 0
    for (const cat of PALETTE_CATEGORY_ORDER) {
      const list = grouped[cat]
      if (!list || list.length === 0) continue
      rows.push({ kind: 'cat', label: cat })
      for (const c of list) {
        // Find the matching index in paletteCommands so the keyboard
        // cursor (which advances through visiblePaletteCommands, which
        // equals paletteCommands when unfiltered) lines up with the
        // rendered cmd row.
        rows.push({ kind: 'cmd', cmd: c, flatIdx })
        flatIdx += 1
      }
    }
    return rows
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
      padding: '8px 14px',
      background: 'transparent',
    },
    btn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '5px 12px',
      fontSize: 11,
      fontWeight: 500,
      color: 'var(--color-text-secondary)',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 14,
      cursor: 'pointer',
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
    },
    btnPrimary: {
      color: '#fff',
      background: 'rgba(91, 141, 184, 0.25)',
      borderColor: 'rgba(91, 141, 184, 0.35)',
    },
    btnGhost: {
      background: 'transparent',
      border: '1px solid transparent',
      backdropFilter: 'none',
    },
    // Run-pulse chip — small, calm confirmation that a run finished.
    // Lives in the toolbar next to the Run button and fades out after a
    // few seconds. Two flavors (ok / err) with subtle borders so the
    // chip never shouts.
    runPulse: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 9px',
      borderRadius: 999,
      fontSize: 10.5,
      fontWeight: 500,
      letterSpacing: 0.1,
      border: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
      color: 'var(--color-text-secondary)',
      whiteSpace: 'nowrap' as const,
      cursor: 'pointer',
      transition: 'opacity 200ms ease, background 120ms ease, border-color 120ms ease',
      // Reset native button defaults so this <button> looks identical to
      // the previous <span>-based pill but stays focusable + clickable.
      fontFamily: 'inherit',
      lineHeight: 1.4,
    },
    runPulseOk: {
      borderColor: 'var(--color-border-strong)',
      color: 'var(--color-text)',
    },
    runPulseErr: {
      borderColor: 'var(--color-error)',
      color: 'var(--color-error)',
    },
    runPulseDot: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: 'currentColor',
      flex: '0 0 auto',
      opacity: 0.85,
    },
    body: {
      display: 'grid',
      // Editor-only body. Library, figures, console and workspace all
      // live behind their own overlays so the default surface stays calm
      // enough for clinicians, surgeons and PKPD researchers who don't
      // write code daily.
      gridTemplateColumns: 'minmax(0, 1fr)',
      gridTemplateRows: 'minmax(0, 1fr)',
      minHeight: 0,
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
      padding: '12px 16px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'transparent',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--color-text)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      whiteSpace: 'nowrap' as const,
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
      borderRadius: 10,
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
    },
    tabBar: {
      display: 'flex',
      alignItems: 'stretch',
      gap: 0,
      padding: '0 12px',
      background: 'transparent',
      minHeight: 28,
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
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      color: 'var(--color-text-muted)',
      cursor: 'pointer',
      fontSize: 12,
      lineHeight: 1,
      borderRadius: 14,
      padding: 0,
      backdropFilter: 'blur(12px)',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
    },
    tabAddBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 12px',
      fontSize: 14,
      color: 'var(--color-text-muted)',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 14,
      cursor: 'pointer',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
    },
    sectionStrip: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 12px',
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
      background: 'transparent',
      overflowX: 'auto' as const,
      minHeight: 28,
      flexShrink: 0,
    },
    editorBody: {
      flex: 1,
      display: 'flex',
      minHeight: 0,
      // Seamless — no background elevation so the editor blends with the
      // surrounding workstation chrome without any visible rectangular
      // boundary around the code area.
      background: 'transparent',
    },
    editorGutterClip: {
      flex: '0 0 auto',
      width: 44,
      overflow: 'hidden',
      // Transparent so gutter blends with the editor — no visible
      // boundary between gutter and code surface.
      background: 'transparent',
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
      borderRadius: 8,
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
    overviewRuler: {
      flex: '0 0 auto',
      width: 10,
      position: 'relative' as const,
      // No border or tinted background — seamless with the editor.
      background: 'transparent',
      cursor: 'pointer',
    },
    overviewMark: {
      position: 'absolute' as const,
      left: 1,
      right: 1,
      height: 2,
      pointerEvents: 'none' as const,
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
    // ─── Welcome card (shown when the active script is empty) ──────────
    // The overlay itself is pointer-transparent so clicks pass through
    // to the textarea underneath. Only the inner card and its tiles
    // intercept clicks. This keeps the editor immediately usable: a
    // user can click anywhere outside the card and start typing.
    welcomeOverlay: {
      position: 'absolute' as const,
      inset: 0,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '32px 32px 24px 32px',
      // Frosted-glass blur over the editor so the card reads as a floating
      // coach mark rather than a sheet. Keeps the workstation context just
      // visible in the background — iOS-style layered depth.
      background: 'rgba(0, 0, 0, 0.35)',
      backdropFilter: 'blur(18px) saturate(140%)',
      WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      zIndex: 4,
    },
    welcomeCard: {
      maxWidth: 520,
      width: '100%',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 12,
      padding: '20px 24px 18px 24px',
      borderRadius: 14,
      background: 'var(--color-bg-elevated)',
      // No border — rely on shadow to float the card. Thinner
      // boundaries per the design brief.
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.10)',
    },
    welcomeKicker: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: 1.2,
      textTransform: 'uppercase' as const,
      color: 'var(--color-text-muted)',
    },
    welcomeTitle: {
      margin: 0,
      fontSize: 18,
      fontWeight: 600,
      color: 'var(--color-text)',
      letterSpacing: -0.2,
      lineHeight: 1.25,
    },
    welcomeSub: {
      margin: 0,
      fontSize: 12,
      lineHeight: 1.5,
      color: 'var(--color-text-secondary)',
    },
    welcomeGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 8,
    },
    welcomeTile: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'flex-start',
      gap: 4,
      padding: '10px 12px',
      borderRadius: 12,
      border: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
      color: 'var(--color-text)',
      cursor: 'pointer',
      textAlign: 'left' as const,
      transition: 'background 120ms ease, border-color 120ms ease',
    },
    welcomeTileTitle: {
      fontSize: 12.5,
      fontWeight: 600,
      color: 'var(--color-text)',
      letterSpacing: 0.05,
    },
    welcomeTileSub: {
      fontSize: 11,
      lineHeight: 1.45,
      color: 'var(--color-text-muted)',
    },
    welcomeHint: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingTop: 4,
      fontSize: 10.5,
      color: 'var(--color-text-muted)',
    },
    welcomeHintKbd: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      padding: '2px 8px',
      borderRadius: 8,
      border: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      color: 'var(--color-text-secondary)',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
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
    // Faint red wash painted across the editor for every line that
    // has an error reported in the console. Lets users spot trouble at
    // a glance even when the gutter is collapsed or scrolled out of view.
    errorLineStrip: {
      position: 'absolute' as const,
      left: 0,
      right: 0,
      height: editorLineHeight,
      background: 'rgba(220, 38, 38, 0.10)',
      borderTop: '1px solid rgba(220, 38, 38, 0.18)',
      borderBottom: '1px solid rgba(220, 38, 38, 0.18)',
      pointerEvents: 'none' as const,
      boxSizing: 'border-box' as const,
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
      background: 'transparent',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: 'var(--color-text-muted)',
    },
    // Inline docs strip — sits between the editor body and the status bar
    // and surfaces the signature + one-line description of the builtin
    // under the caret. Quiet by default; auto-hides when no builtin is
    // matched so it never adds visual noise to plain script editing.
    docsStrip: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '5px 20px',
      background: 'transparent',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: 'var(--color-text-muted)',
      minHeight: 26,
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden',
    },
    docsStripSig: {
      color: 'var(--color-text)',
      fontWeight: 500,
      flex: '0 0 auto',
    },
    docsStripDesc: {
      color: 'var(--color-text-secondary)',
      flex: '1 1 auto',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    docsStripOpen: {
      flex: '0 0 auto',
      padding: '2px 8px',
      borderRadius: 3,
      border: '1px solid var(--glass-border)',
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      cursor: 'pointer',
      transition: 'background 0.12s, color 0.12s',
    },
    // Status bar segments that double as quick actions (caret position →
    // Go to line, var count → workspace tab, figure count → figure tab).
    // Calm by default; the hover wash makes the affordance discoverable
    // without ever feeling like a button.
    statusBarAction: {
      cursor: 'pointer',
      padding: '2px 6px',
      borderRadius: 8,
      margin: '-2px -6px',
      transition: 'background 0.12s, color 0.12s',
    },
    // Tiny coloured pill that lives at the right edge of the status bar
    // and reflects the most recent run state. Calm by default, accented
    // green or red depending on whether the last run finished cleanly.
    statusRunPill: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '2px 8px 2px 7px',
      borderRadius: 999,
      border: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
      color: 'var(--color-text-secondary)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10.5,
      lineHeight: 1,
      whiteSpace: 'nowrap' as const,
    },
    statusRunPillOk: {
      borderColor: 'rgba(34, 197, 94, 0.3)',
      background: 'rgba(34, 197, 94, 0.08)',
      color: 'var(--color-text)',
    },
    statusRunPillErr: {
      borderColor: 'rgba(220, 38, 38, 0.35)',
      background: 'rgba(220, 38, 38, 0.08)',
      color: 'var(--color-text)',
    },
    statusRunPillRunning: {
      borderColor: 'rgba(96, 165, 250, 0.35)',
      background: 'rgba(96, 165, 250, 0.08)',
      color: 'var(--color-text)',
    },
    statusRunDot: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'var(--color-text-muted)',
      flex: '0 0 auto',
    },
    statusRunDotOk: {
      background: '#22c55e',
    },
    statusRunDotErr: {
      background: 'var(--color-error)',
    },
    statusRunDotRunning: {
      background: '#60a5fa',
      animation: 'workstationStatusPulse 1.1s ease-in-out infinite',
    },
    rightRail: {
      display: 'flex',
      flexDirection: 'column' as const,
      minHeight: 0,
      flex: 1,
      background: 'transparent',
    },
    plotPanel: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      flex: 1,
    },
    plotBody: {
      flex: 1,
      minHeight: 0,
      padding: 18,
      // Solid surface so the chart's axes have a guaranteed background
      // to contrast against. The Results overlay scrim is dark enough
      // that the previous transparent body let the axes melt into the
      // dimmed page; verified live with screenshots.
      background: 'var(--color-bg-elevated)',
      borderTop: '1px solid var(--color-border-strong)',
    },
    varPanel: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      flex: 1,
    },
    varList: {
      overflowY: 'auto',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      padding: '6px 10px',
    },
    varFilter: {
      flex: '1 1 auto',
      minWidth: 0,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      color: 'var(--color-text)',
      padding: '5px 10px',
      fontSize: 12,
      borderRadius: 8,
      outline: 'none',
      fontFamily: "'Inter', sans-serif",
    },
    varRow: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1.2fr)',
      gap: 10,
      padding: '5px 6px',
      borderRadius: 8,
    },
    varKindBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 14,
      height: 14,
      fontSize: 9,
      fontFamily: "'JetBrains Mono', monospace",
      fontWeight: 600,
      color: 'var(--color-text-muted)',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 2,
      flex: '0 0 auto',
      letterSpacing: 0,
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
      borderRadius: 8,
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
      padding: '12px 18px 8px 18px',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0.3,
      textTransform: 'uppercase' as const,
      color: 'var(--color-text-muted)',
      background: 'transparent',
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    consoleWrap: {
      display: 'flex',
      flexDirection: 'column' as const,
      minHeight: 0,
      flex: 1,
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
      justifyContent: 'space-between',
      gap: 12,
      padding: '12px 20px 8px 20px',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0.3,
      textTransform: 'uppercase' as const,
      color: 'var(--color-text-muted)',
    },
    consoleFilter: {
      flex: '1 1 auto',
      minWidth: 0,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      color: 'var(--color-text)',
      padding: '5px 10px',
      fontSize: 12,
      borderRadius: 8,
      outline: 'none',
      fontFamily: "'Inter', sans-serif",
    },
    panelToolbar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 18px 10px 18px',
      background: 'transparent',
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
    // Each entry is rendered as a row with a small leading kind column
    // (>, ↳, or ⚠) so users can scan the console without re-reading
    // every line. Errors get a subtle red left stripe so a stack trace
    // doesn't disappear into a wall of grey output.
    entryInput: {
      color: 'var(--color-text)',
      fontWeight: 500,
      padding: '1px 0 1px 4px',
      borderLeft: '2px solid transparent',
      marginTop: 6,
    },
    entryOutput: {
      color: 'var(--color-text-secondary)',
      whiteSpace: 'pre-wrap' as const,
      padding: '0 0 0 14px',
      borderLeft: '2px solid transparent',
    },
    entryError: {
      color: 'var(--color-error)',
      whiteSpace: 'pre-wrap' as const,
      padding: '2px 6px 2px 8px',
      borderLeft: '2px solid var(--color-error)',
      background: 'rgba(220, 38, 38, 0.06)',
      borderRadius: '0 3px 3px 0',
      marginTop: 4,
      marginBottom: 2,
    },
    cmdBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 20px',
      borderTop: '1px solid var(--glass-border)',
      background: 'transparent',
    },
    // Subtle ghost hints surfaced inside the command bar so users
    // organically learn the keyboard shortcuts. Shown only when the
    // input is empty so the bar stays clean while typing.
    cmdHint: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      color: 'var(--color-text-muted)',
      whiteSpace: 'nowrap' as const,
      flex: '0 0 auto',
      pointerEvents: 'none' as const,
    },
    cmdHintKbd: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '1px 5px',
      borderRadius: 3,
      border: '1px solid var(--glass-border)',
      background: 'var(--glass-bg)',
      color: 'var(--color-text-secondary)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 9.5,
      lineHeight: 1.4,
      marginRight: 4,
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
      fontWeight: 600,
      color: 'var(--color-text)',
      opacity: 0.7,
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
    /* ── Library overlay shell ──────────────────────────────────────── */
    libraryOverlay: {
      position: 'fixed' as const,
      inset: 0,
      background: 'rgba(0, 0, 0, 0.78)',
      backdropFilter: 'blur(10px)',
      zIndex: 950,
      display: 'flex',
      flexDirection: 'column' as const,
      padding: '24px 28px 20px 28px',
    },
    libraryCardOverlay: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 14,
      overflow: 'hidden' as const,
      boxShadow: '0 18px 60px rgba(0, 0, 0, 0.55)',
    },
    libraryGrid: {
      flex: 1,
      minHeight: 0,
      display: 'grid',
      // 3-column layout: category rail | item list | snippet preview.
      // The preview pane lets the user read a template / function
      // snippet before loading it, which dramatically reduces the
      // "load → look → undo" loop for first-time clinicians and
      // PKPD researchers.
      gridTemplateColumns: 'minmax(200px, 240px) minmax(280px, 1fr) minmax(320px, 1.4fr)',
      overflow: 'hidden' as const,
    },
    libraryPreviewPane: {
      borderLeft: '1px solid var(--glass-border)',
      display: 'flex',
      flexDirection: 'column' as const,
      minHeight: 0,
      overflow: 'hidden' as const,
    },
    libraryPreviewHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      padding: '14px 18px 10px 18px',
      borderBottom: '1px solid var(--glass-border)',
    },
    libraryPreviewTitle: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--color-text)',
      letterSpacing: 0.05,
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden' as const,
      textOverflow: 'ellipsis' as const,
      flex: 1,
      minWidth: 0,
    },
    libraryPreviewDescription: {
      padding: '10px 18px 0 18px',
      fontSize: 11.5,
      lineHeight: 1.5,
      color: 'var(--color-text-secondary)',
    },
    libraryPreviewBody: {
      flex: 1,
      minHeight: 0,
      margin: '12px 18px 18px 18px',
      padding: '12px 14px',
      borderRadius: 10,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      overflow: 'auto' as const,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 11.5,
      lineHeight: 1.55,
      color: 'var(--color-text)',
      whiteSpace: 'pre' as const,
      tabSize: 2,
    },
    libraryPreviewEmpty: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      color: 'var(--color-text-muted)',
      fontSize: 12,
      fontStyle: 'italic' as const,
      textAlign: 'center' as const,
    },
    libraryCategoryRail: {
      borderRight: '1px solid var(--glass-border)',
      overflowY: 'auto' as const,
      padding: '14px 0',
    },
    libraryCategoryRailItem: {
      display: 'block',
      width: '100%',
      textAlign: 'left' as const,
      padding: '7px 22px',
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-muted)',
      fontSize: 12,
      cursor: 'pointer',
      borderLeft: '2px solid transparent',
      transition: 'background 0.12s, color 0.12s',
    },
    libraryCategoryRailItemActive: {
      color: 'var(--color-text)',
      background: 'var(--glass-bg-hover)',
      borderLeft: '2px solid var(--color-text)',
    },
    libraryItemsScroll: {
      overflowY: 'auto' as const,
      padding: '14px 18px',
    },
    libraryItemCard: {
      display: 'block',
      width: '100%',
      textAlign: 'left' as const,
      padding: '12px 14px',
      marginBottom: 8,
      background: 'var(--glass-bg-hover)',
      border: '1px solid var(--glass-border)',
      color: 'var(--color-text-secondary)',
      fontSize: 12,
      cursor: 'pointer',
      borderRadius: 10,
      transition: 'background 0.12s, border-color 0.12s, color 0.12s',
    },
    libraryItemCardActive: {
      background: 'var(--color-bg-elevated)',
      borderColor: 'var(--color-border-strong)',
      color: 'var(--color-text)',
    },
    // Cursor highlight for the keyboard-navigated item in the library
    // overlay. A subtle inset accent so the item reads as "selected by
    // arrows" without flashing or shouting.
    libraryItemCardCursor: {
      borderColor: 'var(--color-text)',
      boxShadow: 'inset 2px 0 0 var(--color-text)',
      color: 'var(--color-text)',
    },
    libraryItemTitle: {
      color: 'var(--color-text)',
      fontWeight: 500,
      marginBottom: 4,
    },
    libraryItemTitleMono: {
      color: 'var(--color-text)',
      fontWeight: 500,
      fontFamily: "'JetBrains Mono', monospace",
      marginBottom: 4,
      fontSize: 12,
    },
    libraryItemSubtle: {
      fontSize: 11,
      color: 'var(--color-text-muted)',
      lineHeight: 1.4,
    },
    /* ── Results overlay (Figure / Console / Workspace) ─────────────── */
    resultsOverlay: {
      position: 'fixed' as const,
      inset: 0,
      // Slightly lighter scrim than before — the previous 0.78 black was
      // crushing the editor underneath into pure shadow, which felt
      // heavy and modal. 0.55 keeps the focus on Results without making
      // the user feel trapped.
      background: 'rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(10px)',
      zIndex: 950,
      display: 'flex',
      flexDirection: 'column' as const,
      padding: '24px 28px 20px 28px',
    },
    resultsCard: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 14,
      overflow: 'hidden' as const,
      boxShadow: '0 18px 60px rgba(0, 0, 0, 0.55)',
    },
    // Compact overlay chrome — the library/results top bar was taking
    // up too much vertical space, pushing content below the fold on
    // short screens. Padding trimmed and tab pills tightened so the
    // bar reads like a macOS/VS Code segmented control, not a banner.
    resultsHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 14px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'var(--glass-bg-hover)',
      position: 'relative' as const,
      zIndex: 2,
      flexShrink: 0,
      minHeight: 40,
    },
    resultsTitle: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--color-text)',
      whiteSpace: 'nowrap' as const,
      letterSpacing: 0.2,
    },
    resultsTabBar: {
      display: 'flex',
      gap: 2,
      marginLeft: 10,
    },
    resultsTab: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      fontSize: 11,
      fontWeight: 500,
      color: 'var(--color-text-muted)',
      background: 'transparent',
      border: '1px solid transparent',
      borderRadius: 10,
      cursor: 'pointer',
      transition: 'background 0.15s, color 0.15s, border-color 0.15s',
    },
    resultsTabActive: {
      color: 'var(--color-text)',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
    },
    resultsTabBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 18,
      height: 16,
      padding: '0 5px',
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--color-text-muted)',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 12,
    },
    resultsTabBadgeActive: {
      color: 'var(--color-text)',
      background: 'var(--color-bg-elevated)',
      borderColor: 'var(--color-border-strong)',
    },
    resultsBody: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'hidden' as const,
    },
    // Shared empty-state look for Figure / Console / Workspace tabs in
    // the Results overlay (and elsewhere). Centered, calm, with a
    // small kicker label, a slightly larger heading, and an optional
    // CTA chip. Replaces the older italic-muted one-liners and gives
    // every tab a unified resting state.
    emptyHero: {
      flex: 1,
      minHeight: 160,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: '28px 24px',
      textAlign: 'center' as const,
      color: 'var(--color-text-muted)',
      fontFamily: "'Inter', system-ui, sans-serif",
    },
    emptyHeroKicker: {
      fontSize: 9.5,
      fontWeight: 600,
      letterSpacing: 1.2,
      textTransform: 'uppercase' as const,
      color: 'var(--color-text-muted)',
      opacity: 0.75,
    },
    emptyHeroTitle: {
      margin: 0,
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--color-text-secondary)',
      letterSpacing: -0.1,
    },
    emptyHeroSub: {
      margin: 0,
      fontSize: 12,
      lineHeight: 1.5,
      color: 'var(--color-text-muted)',
      maxWidth: 360,
    },
    emptyHeroCtaRow: {
      display: 'flex',
      gap: 8,
      marginTop: 6,
      flexWrap: 'wrap' as const,
      justifyContent: 'center',
    },
    emptyHeroCta: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '5px 12px',
      borderRadius: 10,
      border: '1px solid var(--glass-border)',
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      cursor: 'pointer',
      fontSize: 11,
      fontWeight: 500,
      transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
    },
    dropOverlay: {
      position: 'absolute' as const,
      inset: 0,
      background: 'rgba(0, 0, 0, 0.55)',
      border: '2px dashed var(--color-border-strong)',
      borderRadius: 12,
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
      borderRadius: 10,
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
      borderRadius: 12,
      padding: 24,
    },
    acPopup: {
      position: 'fixed' as const,
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 8,
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
      borderRadius: 8,
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
      borderRadius: 12,
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
      borderRadius: 8,
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
    // Category heading rendered between groups when the palette is
    // showing the unfiltered list. Disappears as soon as the user starts
    // typing so the flat fuzzy results stay tight.
    paletteCategory: {
      padding: '10px 12px 4px 12px',
      fontSize: 9.5,
      fontFamily: "'JetBrains Mono', monospace",
      fontWeight: 600,
      letterSpacing: 1.2,
      textTransform: 'uppercase' as const,
      color: 'var(--color-text-muted)',
    },
    // Calm footer strip for the palette / symbol nav surfaces. Shows
    // keyboard hints so first-time users discover the shortcuts after
    // a single visit instead of having to read the help screen.
    paletteFooter: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '8px 14px',
      borderTop: '1px solid var(--glass-border)',
      fontSize: 10.5,
      color: 'var(--color-text-muted)',
      fontFamily: "'Inter', sans-serif",
      background: 'transparent',
    },
    paletteFooterKey: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
    },
    paletteFooterKbd: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
      padding: '1px 5px',
      borderRadius: 3,
      border: '1px solid var(--glass-border)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 9.5,
      color: 'var(--color-text-secondary)',
    },
    tabMenu: {
      position: 'fixed' as const,
      minWidth: 180,
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 10,
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
      padding: 4,
      zIndex: 1120,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 1,
      fontFamily: "'Inter', sans-serif",
      fontSize: 12,
    },
    tabMenuItem: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 10px',
      borderRadius: 8,
      border: 'none',
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      cursor: 'pointer',
      textAlign: 'left' as const,
      font: 'inherit',
    },
    tabMenuItemDisabled: {
      color: 'var(--color-text-muted)',
      cursor: 'not-allowed',
    },
    tabMenuSep: {
      height: 1,
      background: 'var(--glass-border)',
      margin: '4px 2px',
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
      padding: '4px 10px',
      fontSize: 11,
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.02em',
      color: 'var(--color-text-muted)',
      background: 'transparent',
      border: '1px solid var(--glass-border)',
      borderRadius: 8,
      cursor: 'pointer',
      lineHeight: 1.4,
      transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      whiteSpace: 'nowrap' as const,
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
          list: store.list.map(s => s.id === store.activeId ? { ...s, code: t.code, name: `${t.id}.hm` } : s),
        }
      }
      const id = makeScriptId()
      return {
        list: [...store.list, { id, name: `${t.id}.hm`, code: t.code }],
        activeId: id,
      }
    })
    setActiveTemplate(t.id)
    // Picking a template should drop the user back into the editor.
    setLibrary('closed')
  }, [])

  // Fill the active tab with the built-in starter demo (sin/cos plot + a
  // couple of summary stats). Used by the welcome card as a "this is what
  // a working script looks like" entry point for people who don't write
  // code daily. If the active tab has content we open a new one instead
  // so the user's in-progress work is never overwritten.
  const loadStarterDemo = useCallback(() => {
    setScriptStore(store => {
      const current = store.list.find(s => s.id === store.activeId)
      if (current && current.code.trim() === '') {
        return {
          ...store,
          list: store.list.map(s => s.id === store.activeId ? { ...s, code: STARTER_SCRIPT, name: 'starter.hm' } : s),
        }
      }
      const id = makeScriptId()
      return {
        list: [...store.list, { id, name: 'starter.hm', code: STARTER_SCRIPT }],
        activeId: id,
      }
    })
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

  // ── Preset filtering / grouping for Library "Presets" tab ──────────
  const PRESET_CATEGORIES = useMemo(() => TOOLBOX_CATEGORIES.map(c => c.name), [])

  const filteredPresets = useMemo<Preset[]>(() => {
    const q = libFilter.trim().toLowerCase()
    if (!q) return ALL_PRESETS
    return ALL_PRESETS.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.toolbox.toLowerCase().includes(q) ||
      p.referenceFn.toLowerCase().includes(q)
    )
  }, [libFilter])

  const presetToolboxName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of TOOLBOX_CATEGORIES) m[c.id] = c.name
    return m
  }, [])

  const groupedPresets = useMemo(() => {
    const groups: Record<string, Preset[]> = {}
    for (const c of TOOLBOX_CATEGORIES) groups[c.name] = []
    for (const p of filteredPresets) {
      const cat = presetToolboxName[p.toolbox] ?? p.toolbox
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(p)
    }
    return groups
  }, [filteredPresets, presetToolboxName])

  const loadPreset = useCallback((p: Preset) => {
    // Build a runnable script from the preset's reference code and
    // sample data so the user can edit and re-run in the editor.
    const header = `% ${p.name}\n% ${p.description}\n\n`
    const dataLines = Object.entries(p.sampleData)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k} = [${v.join(', ')}];`
        if (typeof v === 'number') return `${k} = ${v};`
        if (typeof v === 'string') return `${k} = "${v}";`
        return `% ${k} = ... (set your data here)`
      })
      .join('\n')
    const code = header + (dataLines ? dataLines + '\n\n' : '') + p.referenceCode + '\n'
    setScriptStore(store => {
      const current = store.list.find(s => s.id === store.activeId)
      const inPlace = !current || current.code.trim() === ''
      if (inPlace && current) {
        return { ...store, list: store.list.map(s => s.id === store.activeId ? { ...s, code, name: `${p.id}.hm` } : s) }
      }
      const id = crypto.randomUUID()
      return { activeId: id, list: [...store.list, { id, name: `${p.id}.hm`, code }] }
    })
    setScript(code)
    setLibrary('closed')
  }, [setScript])

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
    // Drop back into the editor after inserting from the library overlay.
    setLibrary('closed')
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
      <AlertDialog />
      {/* Tiny stylesheet for the keyframes used by the running-state dot
          in the status bar. Scoped via a unique class so it never leaks
          into other compute pages. */}
      <style>{`
        @keyframes workstationStatusPulse {
          0%, 100% { opacity: 0.4; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
      {dropHover && (
        <div style={styles.dropOverlay} aria-hidden="true">
          <div style={styles.dropOverlayInner}>
            Drop .csv data · .json workspace · .hm or .txt script to import
          </div>
        </div>
      )}
      {/* ─── Toolbar ─────────────────────────────────────────────────── */}
      <div style={styles.toolbar}>
        <button
          style={{ ...styles.btn, ...styles.btnGhost, ...(library === 'open' ? styles.btnPrimary : null) }}
          onClick={() => setLibrary(l => l === 'open' ? 'closed' : 'open')}
          title="Open template & function library (templates, builtins, examples)"
          aria-label="Open library overlay"
          aria-expanded={library === 'open'}
        >
          Library ▸
        </button>

        {/* Split-button: primary "Run" action on the left, run-options
            caret on the right. The two halves share a border seam so they
            read as a single unified control rather than as two adjacent
            buttons. The caret button is the only entry point into the run
            options menu — there is no separate "Run ▾" top-level menu in
            the toolbar anymore (it would have been a duplicate label). */}
        <div style={{ display: 'inline-flex', alignItems: 'stretch' }}>
          <button
            style={{
              ...styles.btn,
              ...styles.btnPrimary,
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
            }}
            onClick={runScript}
            disabled={running}
            title="Run script (Ctrl/Cmd + Enter) · F9 runs selection · Alt+Enter runs %% section"
          >
            {running ? <FiSquare /> : <FiPlay />}
            {running ? 'Running…' : 'Run'}
          </button>
          <button
            style={{
              ...styles.btn,
              ...styles.btnPrimary,
              ...(toolbarMenu?.kind === 'run' ? { background: 'var(--color-bg-elevated)' } : null),
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              borderLeft: 0,
              padding: '4px 6px',
              fontSize: 9,
            }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setToolbarMenu(prev => prev?.kind === 'run' ? null : { kind: 'run', x: rect.left, y: rect.bottom + 4 })
            }}
            disabled={running}
            aria-haspopup="menu"
            aria-expanded={toolbarMenu?.kind === 'run'}
            aria-label="Run options"
            title="Run options · Re-run last fragment · Run selection · Run %% section"
          >
            ▾
          </button>
        </div>

        {/* Calm post-run feedback chip — auto-dismisses via the runPulse
            useEffect. Hidden completely while a run is in flight so the
            "Running…" button stays the only signal during execution. The
            chip is the discoverable, on-demand entry point into the
            Results overlay: one click opens Results on the right tab. */}
        {runPulse && !running && (
          <button
            key={runPulse.key}
            type="button"
            style={{
              ...styles.runPulse,
              ...(runPulse.kind === 'ok' ? styles.runPulseOk : styles.runPulseErr),
            }}
            onClick={() => { setResultsTab(runPulse.tab); setResultsOverlay(true) }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg)'
            }}
            aria-live="polite"
            title={runPulse.kind === 'err' ? 'Open Results · console' : `Open Results · ${runPulse.tab}`}
          >
            <span style={styles.runPulseDot} />
            {runPulse.label}
          </button>
        )}

        {/* Top-level menu trees. Each button toggles its dropdown and
            shows a faint primary highlight while open. The dropdowns
            themselves are rendered in a single shared block below the
            toolbar so the menu styling stays consistent across kinds.
            Note: 'run' is intentionally absent — the run options menu
            is reached via the caret half of the Run split-button above
            so we don't render two "Run" labels in the toolbar. */}
        {(['file', 'edit', 'view'] as const).map(kind => (
          <button
            key={kind}
            style={{ ...styles.btn, ...styles.btnGhost, ...(toolbarMenu?.kind === kind ? styles.btnPrimary : null) }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setToolbarMenu(prev => prev?.kind === kind ? null : { kind, x: rect.left, y: rect.bottom + 4 })
            }}
            aria-haspopup="menu"
            aria-expanded={toolbarMenu?.kind === kind}
            title={`${kind[0].toUpperCase()}${kind.slice(1)} actions`}
          >
            {kind[0].toUpperCase()}{kind.slice(1)} ▾
          </button>
        ))}

        {/* Hidden pickers driven by the File menu. Kept outside the menu
            DOM so unmounting the menu doesn't interrupt the file dialog. */}
        <input
          ref={scriptFileInputRef}
          type="file"
          accept=".hm,.m,.txt"
          multiple
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        <input
          ref={workspaceFileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(ev) => {
            const f = ev.target.files?.[0]
            if (f) importWorkspaceJson(f)
            ev.target.value = ''
          }}
        />

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {(plots.length > 0 || vars.length > 0 || entries.length > 0) && (
            <button
              style={{ ...styles.btn, ...styles.btnGhost }}
              onClick={() => setResultsOverlay(true)}
              title="Open Results overlay (figures, console, workspace)"
              aria-label="Open results overlay"
            >
              Results ▸
            </button>
          )}
          <button
            style={{ ...styles.btn, ...styles.btnGhost, ...(toolbarMenu?.kind === 'help' ? styles.btnPrimary : null) }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setToolbarMenu(prev => prev?.kind === 'help' ? null : { kind: 'help', x: rect.left, y: rect.bottom + 4 })
            }}
            aria-haspopup="menu"
            aria-expanded={toolbarMenu?.kind === 'help'}
            title="Help · command palette · keyboard shortcuts"
          >
            Help ▾
          </button>
        </span>
      </div>

      {/* ─── Toolbar dropdowns (File / Edit / View / Run / Help) ─────── */}
      {toolbarMenu && (() => {
        const closeMenu = () => setToolbarMenu(null)
        // Helper that produces a menu-item button with the same hover /
        // disabled affordances as the script-tab context menu, so the
        // whole Workstation reuses one menu vocabulary.
        const item = (label: string, hint: string, enabled: boolean, onClick: () => void) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            style={{ ...styles.tabMenuItem, ...(enabled ? null : styles.tabMenuItemDisabled) }}
            disabled={!enabled}
            onClick={() => { if (enabled) { onClick(); closeMenu() } }}
            onMouseEnter={(e) => { if (enabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <span>{label}</span>
            {hint && <span style={{ marginLeft: 18, color: 'var(--color-text-muted)', fontSize: 10 }}>{hint}</span>}
          </button>
        )
        const sep = (k: string) => <div key={`sep-${k}`} style={styles.tabMenuSep} />

        // The textarea-only commands are gated on the editor existing —
        // mostly a guard so palette / menu items don't crash when the
        // user opens a menu before the editor has mounted.
        const hasEditor = !!editorRef.current
        const hasSel = !!editorRef.current && editorRef.current.selectionStart !== editorRef.current.selectionEnd

        let label = ''
        let menuW = 240
        let items: React.ReactNode[] = []

        switch (toolbarMenu.kind) {
          case 'file':
            label = 'File actions'
            menuW = 240
            items = [
              item('New script', '', true, () => newScript()),
              item('Open script file…', '', true, () => scriptFileInputRef.current?.click()),
              item('Save as .hm', '', !!activeScript, () => handleDownload()),
              sep('f1'),
              item('Import workspace .json…', '', true, () => workspaceFileInputRef.current?.click()),
              item('Export workspace .json', '', vars.length > 0, () => exportWorkspaceJson()),
              item('Download console transcript', '', entries.length > 0, () => downloadConsole()),
              sep('f2'),
              item('Reset workspace', '', vars.length > 0, () => resetWorkspace()),
            ]
            break
          case 'edit':
            label = 'Edit actions'
            menuW = 280
            items = [
              item('Find & replace', 'Ctrl+F', true, () => openFind()),
              item('Go to line', 'Ctrl+G', true, () => openGoto()),
              item('Go to symbol', 'Ctrl+Shift+O', true, () => openSymbolNav()),
              sep('e1'),
              item('Rename identifier at caret', '', hasEditor, () => renameIdentifierAtCaret()),
              item('Trim trailing whitespace', '', hasEditor, () => trimTrailingWhitespace()),
              item('Convert tabs to spaces', '', hasEditor, () => convertTabsToSpaces()),
              item('Join with next line', 'Ctrl+J', hasEditor, () => joinLines()),
              sep('e2'),
              item('Sort selected lines', '', hasSel, () => sortSelectedLines()),
              item('Unique selected lines', '', hasSel, () => uniqueSelectedLines()),
              item('Reverse selected lines', '', hasSel, () => applySelectionTransform(s => s.split('\n').reverse().join('\n'))),
              item('Remove blank lines in selection', '', hasSel, () => removeEmptySelectedLines()),
              item('Uppercase selection', '', hasSel, () => applySelectionTransform(s => s.toUpperCase())),
              item('Lowercase selection', '', hasSel, () => applySelectionTransform(s => s.toLowerCase())),
              sep('e3'),
              item('Toggle bookmark on current line', 'Ctrl+F2', hasEditor, () => toggleBookmarkAtCaret()),
              item('Next bookmark', 'F2', bookmarkLines.size > 0, () => gotoBookmark(1)),
              item('Previous bookmark', 'Shift+F2', bookmarkLines.size > 0, () => gotoBookmark(-1)),
              item('Clear bookmarks in this script', '', bookmarkLines.size > 0, () => clearAllBookmarks()),
            ]
            break
          case 'view':
            label = 'View actions'
            menuW = 260
            items = [
              item(library === 'open' ? 'Hide library' : 'Show library', '', true, () => setLibrary(l => l === 'open' ? 'closed' : 'open')),
              item(editorWrapOn ? 'Disable word wrap' : 'Enable word wrap', '', true, () => toggleEditorWrap()),
              sep('v1'),
              item('Increase editor font size', 'Ctrl+=', editorFontSize < EDITOR_FONT_MAX, () => bumpEditorFont(1)),
              item('Decrease editor font size', 'Ctrl+-', editorFontSize > EDITOR_FONT_MIN, () => bumpEditorFont(-1)),
              item('Reset editor font size', 'Ctrl+0', editorFontSize !== EDITOR_FONT_DEFAULT, () => resetEditorFont()),
              sep('v2'),
              item('Open Results overlay', '', plots.length > 0 || vars.length > 0 || entries.length > 0, () => setResultsOverlay(true)),
              item('Toggle console timestamps', '', true, () => setConsoleShowTimestamps(v => !v)),
              item('Clear console', 'Ctrl+L', entries.length > 0, () => clearConsole()),
              item('Clear all figures', '', plots.length > 0, () => { setPlots([]); setActivePlot(0) }),
            ]
            break
          case 'run':
            label = 'Run actions'
            menuW = 280
            items = [
              item('Run script', 'Ctrl+Enter', !running, () => runScript()),
              item('Re-run last fragment', 'Ctrl+Shift+R', !running, () => rerunLastFragment()),
              sep('r1'),
              item('Run selection', 'F9', !running, () => runSelection()),
              item('Run current %% section', 'Alt+Ctrl+Enter', !running, () => runSection()),
              item('Run until cursor line', 'Shift+F9', !running, () => runUntilCursor()),
            ]
            break
          case 'help':
            label = 'Help actions'
            menuW = 260
            items = [
              item('Command palette', 'Ctrl+Shift+P', true, () => openPalette()),
              item('Keyboard shortcuts', 'F1', true, () => setHelpOpen(true)),
            ]
            break
        }

        // Approximate height for off-screen clamping. Each item is ~28px,
        // each separator ~9px; we don't have measurements yet so this is a
        // best-guess upper bound that keeps menus on-screen near the
        // viewport edge.
        const menuH = Math.min(560, items.length * 30 + 20)
        const left = Math.min(toolbarMenu.x, window.innerWidth - menuW - 8)
        const top = Math.min(toolbarMenu.y, window.innerHeight - menuH - 8)

        return (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1115 }}
              onClick={closeMenu}
              onContextMenu={(e) => { e.preventDefault(); closeMenu() }}
            />
            <div
              role="menu"
              aria-label={label}
              style={{ ...styles.tabMenu, left, top, minWidth: menuW }}
              onClick={(e) => e.stopPropagation()}
            >
              {items}
            </div>
          </>
        )
      })()}

      {/* ─── Editor body (figures / console / workspace / library all
           live in their own overlays) ─────────────────────────────── */}
      <div style={styles.body}>
        <div style={styles.editorWrap}>
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
                  onAuxClick={e => {
                    // Middle-click closes the tab (browser-tab convention).
                    // Only fires when more than one script is open so we
                    // never end up with an empty tab bar.
                    if (e.button === 1) {
                      e.preventDefault()
                      e.stopPropagation()
                      closeScript(s.id)
                    }
                  }}
                  onContextMenu={e => {
                    // Right-click a script tab → open the action menu
                    // anchored at the cursor. Preventing the browser's
                    // default means users only see our in-app commands,
                    // keeping the tab bar experience consistent.
                    e.preventDefault()
                    e.stopPropagation()
                    setTabMenu({ id: s.id, x: e.clientX, y: e.clientY })
                  }}
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
                  title={`${s.name} — drag to reorder, double-click to rename, middle-click to close`}
                >
                  <span>{s.name}</span>
                  <span
                    style={styles.tabCloseBtn}
                    onClick={e => { e.stopPropagation(); closeScript(s.id) }}
                    role="button"
                    aria-label={`Close ${s.name}`}
                  >×</span>
                </button>
              )
            })}
            <button style={styles.tabAddBtn} onClick={newScript} title="New script">+</button>

            {/* Editor font controls — flush right inside the tab bar so
                we don't burn a whole row on a "SCRIPTS" header that adds
                nothing the tab names don't already convey. */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
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
                  textAlign: 'center' as const,
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
          {tabMenu && (() => {
            const menuW = 200
            const menuH = 210
            const left = Math.min(tabMenu.x, window.innerWidth - menuW - 8)
            const top = Math.min(tabMenu.y, window.innerHeight - menuH - 8)
            const target = scriptStore.list.find(s => s.id === tabMenu.id)
            if (!target) return null
            const pivotIdx = scriptStore.list.findIndex(s => s.id === tabMenu.id)
            const canCloseOthers = scriptStore.list.length > 1
            const canCloseRight = pivotIdx >= 0 && pivotIdx < scriptStore.list.length - 1
            // Allow closing the last tab — when the list empties out the
            // editor surface shows an empty-state with a big "+ New Script"
            // CTA, which is the behaviour the user asked for.
            const canClose = scriptStore.list.length >= 1
            const closeMenu = () => setTabMenu(null)
            const item = (label: string, enabled: boolean, onClick: () => void) => (
              <button
                type="button"
                style={{ ...styles.tabMenuItem, ...(enabled ? null : styles.tabMenuItemDisabled) }}
                disabled={!enabled}
                onClick={() => { if (enabled) { onClick(); closeMenu() } }}
                onMouseEnter={(e) => { if (enabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              >
                <span>{label}</span>
              </button>
            )
            return (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 1115 }}
                  onClick={closeMenu}
                  onContextMenu={(e) => { e.preventDefault(); closeMenu() }}
                />
                <div
                  role="menu"
                  aria-label={`Actions for ${target.name}`}
                  style={{ ...styles.tabMenu, left, top }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {item('Rename…', true, () => renameScript(target.id))}
                  {item('Duplicate', true, () => duplicateScript(target.id))}
                  <div style={styles.tabMenuSep} />
                  {item('Close', canClose, () => closeScript(target.id))}
                  {item('Close others', canCloseOthers, () => closeOtherScripts(target.id))}
                  {item('Close to the right', canCloseRight, () => closeScriptsToRight(target.id))}
                </div>
              </>
            )
          })()}
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
          {scriptStore.list.length === 0 ? (
            // Empty-state: the user closed every tab. Instead of auto-spawning
            // a scratch file we surface a big, centered "+ New Script" CTA
            // (per user feedback: "show + New Script button for empty state")
            // with secondary affordances so there's always a well-lit next step.
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}
              role="region"
              aria-label="No scripts open"
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 14,
                  maxWidth: 440,
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: 1.1,
                    textTransform: 'uppercase',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  Compute Lab
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: 'var(--color-text)',
                  }}
                >
                  No scripts open
                </div>
                <p
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: 'var(--color-text-muted)',
                    margin: 0,
                  }}
                >
                  You closed every tab. Start a fresh script, load one from the
                  template library, or drop a <code>.hm</code> / <code>.csv</code>
                  file anywhere to import.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={newScript}
                    style={{
                      ...styles.btn,
                      padding: '10px 20px',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                    autoFocus
                  >
                    + New Script
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLibMode('templates'); setLibrary('open') }}
                    style={{
                      ...styles.btn,
                      ...styles.btnGhost,
                      padding: '10px 16px',
                      fontSize: 13,
                    }}
                  >
                    Browse templates
                  </button>
                </div>
              </div>
            </div>
          ) : (<>
          <div style={styles.editorBody}>
            <div style={styles.editorGutterClip}>
              <div ref={gutterRef} style={styles.editorGutterNumbers}>
                {Array.from({ length: lineCount }, (_, i) => {
                  const n = i + 1
                  const isErr = errorLine === n || errorLineSet.has(n)
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
              {/* Faint red wash on every error line — paints first so the
                  current-line strip and word/find overlays still sit on top. */}
              {!editorWrapOn && errorLines.length > 0 && (
                <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {errorLines.map(n => (
                    <div
                      key={`err-strip-${n}`}
                      style={{
                        ...styles.errorLineStrip,
                        top: 14 + (n - 1) * editorLineHeight,
                      }}
                    />
                  ))}
                </div>
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
              {/* ─── Welcome card ──────────────────────────────────────
                 Surfaces when the active script is empty AND the user
                 hasn't explicitly dismissed the overlay for this script.
                 The backdrop-blur layer blocks clicks on the editor and
                 its surrounding tools while the welcome is up, giving
                 the CTA tiles an unambiguous focus. Users can dismiss
                 either via × or the "Start with a blank script" tile,
                 both of which drop focus back into the textarea. */}
              {script === '' && activeScript && !welcomeDismissed.has(activeScript.id) && (
                <div
                  style={styles.welcomeOverlay}
                  aria-label="Workstation welcome"
                  role="dialog"
                  aria-modal="true"
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    // Esc dismisses the overlay so keyboard-first users can
                    // get into the editor without a mouse click.
                    if (e.key === 'Escape' && activeScript) {
                      e.preventDefault()
                      setWelcomeDismissed(prev => {
                        if (prev.has(activeScript.id)) return prev
                        const next = new Set(prev)
                        next.add(activeScript.id)
                        return next
                      })
                      requestAnimationFrame(() => editorRef.current?.focus())
                    }
                  }}
                >
                  <div
                    style={{ ...styles.welcomeCard, position: 'relative' }}
                    role="region"
                    aria-label="Get started"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeScript) return
                        setWelcomeDismissed(prev => {
                          if (prev.has(activeScript.id)) return prev
                          const next = new Set(prev)
                          next.add(activeScript.id)
                          return next
                        })
                        // Drop focus straight into the editor so the user
                        // can start typing without another click.
                        requestAnimationFrame(() => editorRef.current?.focus())
                      }}
                      title="Dismiss (Esc) — start with a blank editor"
                      aria-label="Dismiss welcome"
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        width: 26,
                        height: 26,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 6,
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-text-muted)',
                        fontSize: 16,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                      }}
                    >×</button>
                    <span style={styles.welcomeKicker}>Numeric Compute Workstation</span>
                    <h2 style={styles.welcomeTitle}>Start computing</h2>
                    <p style={styles.welcomeSub}>
                      Type numeric expressions directly into the editor, or pick a starting
                      point below. Variables and figures persist across runs — your
                      workspace is yours to explore.
                    </p>
                    <div style={styles.welcomeGrid}>
                      <button
                        type="button"
                        style={styles.welcomeTile}
                        onClick={() => { setLibMode('templates'); setLibrary('open') }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                        }}
                      >
                        <span style={styles.welcomeTileTitle}>Browse templates</span>
                        <span style={styles.welcomeTileSub}>
                          Ready-to-run examples for PK/PD, ECG, imaging, signals, and stats.
                        </span>
                      </button>
                      <button
                        type="button"
                        style={styles.welcomeTile}
                        onClick={() => { setLibMode('functions'); setLibrary('open') }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                        }}
                      >
                        <span style={styles.welcomeTileTitle}>Browse functions</span>
                        <span style={styles.welcomeTileSub}>
                          Built-in reference with signatures, examples, and copy-ready snippets.
                        </span>
                      </button>
                      <button
                        type="button"
                        style={styles.welcomeTile}
                        onClick={() => loadStarterDemo()}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                        }}
                      >
                        <span style={styles.welcomeTileTitle}>Load starter demo</span>
                        <span style={styles.welcomeTileSub}>
                          A tiny sin/cos plot with summary stats — verifies everything works.
                        </span>
                      </button>
                      <button
                        type="button"
                        style={styles.welcomeTile}
                        onClick={() => openPalette()}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                        }}
                      >
                        <span style={styles.welcomeTileTitle}>Command palette</span>
                        <span style={styles.welcomeTileSub}>
                          Find any action — templates, settings, run modes, conversions.
                        </span>
                      </button>
                      <button
                        type="button"
                        style={{ ...styles.welcomeTile, gridColumn: '1 / -1' }}
                        onClick={() => {
                          if (!activeScript) return
                          // User chose to write their own script from scratch:
                          // dismiss the welcome and focus the editor so typing
                          // immediately replaces the empty textarea.
                          setWelcomeDismissed(prev => {
                            if (prev.has(activeScript.id)) return prev
                            const next = new Set(prev)
                            next.add(activeScript.id)
                            return next
                          })
                          requestAnimationFrame(() => editorRef.current?.focus())
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                        }}
                      >
                        <span style={styles.welcomeTileTitle}>Start with a blank script</span>
                        <span style={styles.welcomeTileSub}>
                          Dismiss this panel and write your own from scratch.
                        </span>
                      </button>
                    </div>
                    <div style={styles.welcomeHint}>
                      <span>Drop a .hm, .csv, or .json file anywhere to import.</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={styles.welcomeHintKbd}>Ctrl/Cmd ↵</span>
                        <span>Run</span>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {lineCount > 0 && (
              <div
                style={styles.overviewRuler}
                aria-label="Script overview"
                title="Click to jump to that line"
                onClick={(ev) => {
                  const rect = ev.currentTarget.getBoundingClientRect()
                  const frac = (ev.clientY - rect.top) / rect.height
                  const line = Math.max(1, Math.min(lineCount, Math.round(frac * lineCount)))
                  jumpToLine(line)
                }}
              >
                {/* Sections — faint hairlines */}
                {sectionOutline.map(sec => (
                  <div
                    key={`sec-${sec.line}`}
                    style={{
                      ...styles.overviewMark,
                      top: `${Math.max(0, Math.min(100, ((sec.line - 1) / Math.max(1, lineCount)) * 100))}%`,
                      background: 'var(--color-text-muted)',
                      opacity: 0.45,
                      height: 1,
                    }}
                  />
                ))}
                {/* Bookmarks — solid text colour */}
                {Array.from(bookmarkLines).map(n => (
                  <div
                    key={`bm-${n}`}
                    style={{
                      ...styles.overviewMark,
                      top: `${Math.max(0, Math.min(100, ((n - 1) / Math.max(1, lineCount)) * 100))}%`,
                      background: 'var(--color-text)',
                    }}
                  />
                ))}
                {/* Errors — red, rendered last so they stack on top */}
                {errorLines.map(n => (
                  <div
                    key={`err-${n}`}
                    style={{
                      ...styles.overviewMark,
                      top: `${Math.max(0, Math.min(100, ((n - 1) / Math.max(1, lineCount)) * 100))}%`,
                      background: 'var(--color-error)',
                      height: 3,
                    }}
                  />
                ))}
                {/* Caret — thin translucent bar tracking the cursor's line */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${Math.max(0, Math.min(100, ((cursor.line - 1) / Math.max(1, lineCount)) * 100))}%`,
                    height: 2,
                    background: 'var(--color-text)',
                    opacity: 0.35,
                    pointerEvents: 'none',
                  }}
                />
              </div>
            )}
          </div>
          {/* ─── Inline docs strip ────────────────────────────────────
             Pops in beneath the editor body whenever the caret lands on
             a recognised builtin or live workspace variable. Stays out
             of the layout entirely otherwise so plain editing never
             gains an empty bar. Builtins win when both match (a builtin
             function shadowed by a workspace variable still resolves to
             the function over the variable). */}
          {(docAtCaret || varAtCaret) && (
            <div style={styles.docsStrip} role="status" aria-live="polite">
              {docAtCaret ? (
                <>
                  <span style={styles.docsStripSig}>{docAtCaret.signature}</span>
                  <span style={styles.docsStripDesc} title={docAtCaret.description}>
                    — {docAtCaret.description}
                  </span>
                  <button
                    type="button"
                    style={styles.docsStripOpen}
                    onClick={() => { setLibrary('open'); setLibMode('functions'); setLibFilter(docAtCaret.name) }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)' }}
                    title={`Open the library overlay focused on ${docAtCaret.name}`}
                  >open in library →</button>
                </>
              ) : varAtCaret && (
                <>
                  <span style={styles.docsStripSig}>
                    {varAtCaret.name}
                    <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: 6 }}>
                      {VAR_KIND_TITLE[varAtCaret.kind]} · {varAtCaret.shape}
                    </span>
                  </span>
                  <span style={styles.docsStripDesc} title={varAtCaret.summary}>
                    — {varAtCaret.summary}
                  </span>
                  <button
                    type="button"
                    style={styles.docsStripOpen}
                    onClick={() => { setResultsTab('workspace'); setResultsOverlay(true); setExpandedVar(varAtCaret.name) }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)' }}
                    title={`Open ${varAtCaret.name} in the workspace inspector`}
                  >inspect →</button>
                </>
              )}
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* ─── Library overlay (Templates / Functions / Presets) ────────── */}
      {library === 'open' && (() => {
        // Build the active list and category headings up front so the
        // grid can render the rail and the items section consistently.
        const isTpl = libMode === 'templates'
        const isPre = libMode === 'presets'
        const cats = isPre ? PRESET_CATEGORIES : isTpl ? WORKSTATION_CATEGORIES : BUILTIN_CATEGORIES
        const groups = isPre ? groupedPresets : isTpl ? groupedTemplates : groupedBuiltins
        const total = isPre ? filteredPresets.length : isTpl ? filteredTemplates.length : filteredBuiltins.length
        const visibleCats = cats.filter(c => (groups[c]?.length ?? 0) > 0)
        // Flat ordered list mirroring exactly what the grid renders, in
        // category-then-item order. The library overlay's keyboard
        // navigation (arrows / Home / End / Enter) walks this list and
        // each item card is tagged with data-lib-idx so the
        // scroll-into-view effect can find the active card by index.
        const flatItems: Array<
          | { kind: 'tpl'; t: WorkstationTemplate }
          | { kind: 'fn'; d: BuiltinDoc }
          | { kind: 'pre'; p: Preset }
        > = isPre
          ? visibleCats.flatMap(c => (groupedPresets[c] ?? []).map(p => ({ kind: 'pre' as const, p })))
          : isTpl
            ? visibleCats.flatMap(c => (groupedTemplates[c] ?? []).map(t => ({ kind: 'tpl' as const, t })))
            : visibleCats.flatMap(c => (groupedBuiltins[c] ?? []).map(d => ({ kind: 'fn' as const, d })))
        const cursorClamped = flatItems.length === 0 ? -1 : Math.max(0, Math.min(libCursor, flatItems.length - 1))
        const onLibSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (flatItems.length > 0) setLibCursor(c => Math.min(flatItems.length - 1, (c < 0 ? 0 : c + 1)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (flatItems.length > 0) setLibCursor(c => Math.max(0, (c < 0 ? 0 : c - 1)))
          } else if (e.key === 'Home') {
            e.preventDefault()
            if (flatItems.length > 0) setLibCursor(0)
          } else if (e.key === 'End') {
            e.preventDefault()
            if (flatItems.length > 0) setLibCursor(flatItems.length - 1)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const sel = cursorClamped >= 0 ? flatItems[cursorClamped] : null
            if (sel) {
              if (sel.kind === 'tpl') loadTemplate(sel.t)
              else if (sel.kind === 'pre') loadPreset(sel.p)
              else insertBuiltin(sel.d)
            }
          } else if (e.key === 'Tab') {
            // Tab cycles through Templates → Functions → Presets so
            // the user can flip modes without leaving the search input.
            e.preventDefault()
            setLibMode(m => m === 'templates' ? 'functions' : m === 'functions' ? 'presets' : 'templates')
          }
        }
        let runningIdx = 0
        return (
          <div
            data-library-overlay
            style={styles.libraryOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Template library"
            onClick={e => { if (e.target === e.currentTarget) setLibrary('closed') }}
          >
            <div style={styles.libraryCardOverlay}>
              <div style={styles.resultsHeader}>
                <span style={styles.resultsTitle}>Library</span>
                <div style={styles.resultsTabBar} role="tablist" aria-label="Library mode">
                  {([
                    { id: 'templates' as const, label: 'Templates', count: filteredTemplates.length },
                    { id: 'functions' as const, label: 'Functions', count: filteredBuiltins.length },
                    { id: 'presets' as const, label: 'Presets', count: filteredPresets.length },
                  ]).map(t => {
                    const active = libMode === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        style={{ ...styles.resultsTab, ...(active ? styles.resultsTabActive : null) }}
                        onClick={() => setLibMode(t.id)}
                        title={`Show ${t.label.toLowerCase()}`}
                      >
                        {t.label}
                        <span style={{ ...styles.resultsTabBadge, ...(active ? styles.resultsTabBadgeActive : null) }}>
                          {t.count}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0 18px' }}>
                  <input
                    autoFocus
                    style={{
                      ...styles.librarySearchInput,
                      maxWidth: 380,
                      background: 'var(--glass-bg-hover)',
                    }}
                    placeholder={isPre ? 'Search presets…  ↑↓ Enter' : isTpl ? 'Search templates…  ↑↓ Enter' : 'Search functions…  ↑↓ Enter'}
                    value={libFilter}
                    onChange={e => setLibFilter(e.target.value)}
                    onKeyDown={onLibSearchKey}
                    aria-label="Filter library"
                    spellCheck={false}
                  />
                </div>
                <button
                  type="button"
                  style={{ ...styles.btn, ...styles.btnGhost }}
                  onClick={() => setLibrary('closed')}
                  title="Close (Esc)"
                  aria-label="Close library overlay"
                >
                  Close · Esc
                </button>
              </div>

              <div style={styles.libraryGrid}>
                <div style={styles.libraryCategoryRail}>
                  {visibleCats.length === 0 && (
                    <div style={{ padding: '12px 22px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                      {libFilter ? `No matches for "${libFilter}".` : 'No items.'}
                    </div>
                  )}
                  {visibleCats.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      style={styles.libraryCategoryRailItem}
                      onClick={() => {
                        const el = document.getElementById(`lib-cat-${cat.replace(/\s+/g, '-')}`)
                        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    >
                      {cat}
                      <span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontSize: 10 }}>
                        {groups[cat]?.length ?? 0}
                      </span>
                    </button>
                  ))}
                  <div style={{ padding: '14px 22px 6px 22px', color: 'var(--color-text-muted)', fontSize: 10 }}>
                    {total} item{total === 1 ? '' : 's'}
                  </div>
                </div>

                <div style={styles.libraryItemsScroll}>
                  {isTpl ? (
                    <>
                      {visibleCats.map(cat => {
                        const items = groupedTemplates[cat] ?? []
                        if (items.length === 0) return null
                        return (
                          <div key={cat} id={`lib-cat-${cat.replace(/\s+/g, '-')}`}>
                            <div style={styles.panelHeader}>{cat}</div>
                            {items.map(t => {
                              const myIdx = runningIdx++
                              const cursorActive = myIdx === cursorClamped
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  data-lib-idx={myIdx}
                                  style={{
                                    ...styles.libraryItemCard,
                                    ...(activeTemplate === t.id ? styles.libraryItemCardActive : null),
                                    ...(cursorActive ? styles.libraryItemCardCursor : null),
                                  }}
                                  onClick={() => loadTemplate(t)}
                                  onMouseEnter={(e) => {
                                    setLibCursor(myIdx);
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border-strong)'
                                  }}
                                  onMouseLeave={(e) => {
                                    if (activeTemplate !== t.id && !cursorActive) {
                                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-border)'
                                    }
                                  }}
                                  title={t.description}
                                >
                                  <div style={styles.libraryItemTitle}>{t.name}</div>
                                  <div style={styles.libraryItemSubtle}>{t.description}</div>
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                      {filteredTemplates.length === 0 && (
                        <div style={{ padding: '12px 4px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                          No templates match "{libFilter}".
                        </div>
                      )}
                    </>
                  ) : isPre ? (
                    <>
                      {visibleCats.map(cat => {
                        const items = groupedPresets[cat] ?? []
                        if (items.length === 0) return null
                        return (
                          <div key={cat} id={`lib-cat-${cat.replace(/\s+/g, '-')}`}>
                            <div style={styles.panelHeader}>{cat}</div>
                            {items.map(p => {
                              const myIdx = runningIdx++
                              const cursorActive = myIdx === cursorClamped
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  data-lib-idx={myIdx}
                                  style={{
                                    ...styles.libraryItemCard,
                                    ...(cursorActive ? styles.libraryItemCardCursor : null),
                                  }}
                                  onClick={() => loadPreset(p)}
                                  title={`${p.name} — ${p.description}`}
                                  onMouseEnter={(e) => {
                                    setLibCursor(myIdx);
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border-strong)'
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!cursorActive) {
                                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-border)'
                                    }
                                  }}
                                >
                                  <div style={styles.libraryItemTitle}>{p.name}</div>
                                  <div style={styles.libraryItemSubtle}>{p.description}</div>
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                      {filteredPresets.length === 0 && (
                        <div style={{ padding: '12px 4px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                          No presets match "{libFilter}".
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {visibleCats.map(cat => {
                        const items = groupedBuiltins[cat] ?? []
                        if (items.length === 0) return null
                        return (
                          <div key={cat} id={`lib-cat-${cat.replace(/\s+/g, '-')}`}>
                            <div style={styles.panelHeader}>{cat}</div>
                            {items.map(d => {
                              const myIdx = runningIdx++
                              const cursorActive = myIdx === cursorClamped
                              return (
                                <button
                                  key={d.name}
                                  type="button"
                                  data-lib-idx={myIdx}
                                  style={{
                                    ...styles.libraryItemCard,
                                    ...(cursorActive ? styles.libraryItemCardCursor : null),
                                  }}
                                  onClick={() => insertBuiltin(d)}
                                  title={`${d.signature} — ${d.description}`}
                                  onMouseEnter={(e) => {
                                    setLibCursor(myIdx);
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border-strong)'
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!cursorActive) {
                                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-border)'
                                    }
                                  }}
                                >
                                  <div style={styles.libraryItemTitleMono}>{d.signature}</div>
                                  <div style={styles.libraryItemSubtle}>{d.description}</div>
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                      {filteredBuiltins.length === 0 && (
                        <div style={{ padding: '12px 4px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                          No functions match "{libFilter}".
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Snippet preview pane — shows the code for whichever
                    template or function the keyboard / mouse cursor is
                    on. Lets clinicians read what a snippet does before
                    they commit to loading it. */}
                <div style={styles.libraryPreviewPane} aria-label="Library item preview">
                  {(() => {
                    const sel = cursorClamped >= 0 ? flatItems[cursorClamped] : null
                    if (!sel) {
                      return (
                        <div style={styles.libraryPreviewEmpty}>
                          {flatItems.length === 0
                            ? (libFilter ? `Nothing matches "${libFilter}".` : 'No items in this category.')
                            : 'Use ↑ ↓ or hover an item to preview its snippet.'}
                        </div>
                      )
                    }
                    if (sel.kind === 'tpl') {
                      const t = sel.t
                      return (
                        <>
                          <div style={styles.libraryPreviewHeader}>
                            <span style={styles.libraryPreviewTitle}>{t.name}</span>
                            <button
                              type="button"
                              style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 12px' }}
                              onClick={() => loadTemplate(t)}
                              title="Load this template into the editor (Enter)"
                            >Load · ↵</button>
                          </div>
                          <div style={styles.libraryPreviewDescription}>{t.description}</div>
                          <pre style={styles.libraryPreviewBody}>{t.code}</pre>
                        </>
                      )
                    }
                    if (sel.kind === 'pre') {
                      const p = sel.p
                      return (
                        <>
                          <div style={styles.libraryPreviewHeader}>
                            <span style={styles.libraryPreviewTitle}>{p.name}</span>
                            <button
                              type="button"
                              style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 12px' }}
                              onClick={() => loadPreset(p)}
                              title="Load this preset into the editor with sample data (Enter)"
                            >Load · ↵</button>
                          </div>
                          <div style={styles.libraryPreviewDescription}>{p.description}</div>
                          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' as const }}>Reference code</div>
                          <pre style={styles.libraryPreviewBody}>{p.referenceCode}</pre>
                        </>
                      )
                    }
                    const d = sel.d
                    return (
                      <>
                        <div style={styles.libraryPreviewHeader}>
                          <span style={styles.libraryPreviewTitle} title={d.signature}>{d.signature}</span>
                          <button
                            type="button"
                            style={{ ...styles.btn, ...styles.btnGhost, padding: '4px 12px' }}
                            onClick={() => insertBuiltin(d)}
                            title="Insert this snippet at the editor caret (Enter)"
                          >Insert · ↵</button>
                        </div>
                        <div style={styles.libraryPreviewDescription}>{d.description}</div>
                        <pre style={styles.libraryPreviewBody}>{d.snippet}</pre>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ─── Results overlay (Figure / Console / Workspace) ─────────── */}
      {resultsOverlay && (
        <div
          style={styles.resultsOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Results"
          onClick={e => { if (e.target === e.currentTarget) setResultsOverlay(false) }}
        >
          <div style={styles.resultsCard}>
            <div style={styles.resultsHeader}>
              <span style={styles.resultsTitle}>Results</span>
              <div style={styles.resultsTabBar} role="tablist" aria-label="Result panels">
                {([
                  { id: 'figure', label: 'Figure', count: plots.length },
                  { id: 'console', label: 'Console', count: entries.length },
                  { id: 'workspace', label: 'Workspace', count: vars.length },
                  { id: 'imaging', label: 'Imaging', count: imagingStudyCount },
                ] as const).map(t => {
                  const active = resultsTab === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      style={{ ...styles.resultsTab, ...(active ? styles.resultsTabActive : null) }}
                      onClick={() => setResultsTab(t.id)}
                      title={`Show ${t.label.toLowerCase()}`}
                    >
                      {t.label}
                      <span style={{ ...styles.resultsTabBadge, ...(active ? styles.resultsTabBadgeActive : null) }}>
                        {t.count}
                      </span>
                    </button>
                  )
                })}
              </div>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                style={{ ...styles.btn, ...styles.btnGhost, padding: '6px 12px' }}
                onClick={() => setResultsOverlay(false)}
                title="Close (Esc) — your output is preserved"
                aria-label="Close results overlay"
              >
                Close · Esc
              </button>
            </div>
            <div style={styles.resultsBody}>

        {resultsTab === 'figure' && (
        <div style={styles.rightRail}>
          <div style={styles.plotPanel}>
            <div style={styles.panelHeader}>
              <span>Figure</span>
              <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 11 }}>
                {plots.length > 0 ? `${activePlot + 1} / ${plots.length}` : 'none'}
              </span>
            </div>
            <div style={styles.panelToolbar}>
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
              <span style={{ flex: 1 }} />
              <button
                style={styles.plotChip}
                disabled={plots.length < 2}
                onClick={() => setActivePlot(i => Math.max(0, i - 1))}
                title="Previous figure"
                aria-label="Previous figure"
              >◀</button>
              <button
                style={styles.plotChip}
                disabled={plots.length < 2}
                onClick={() => setActivePlot(i => Math.min(plots.length - 1, i + 1))}
                title="Next figure"
                aria-label="Next figure"
              >▶</button>
              <button
                style={styles.plotChip}
                disabled={plots.length === 0}
                onClick={() => { copyPlotToClipboard() }}
                title="Copy figure to clipboard as PNG"
              >copy</button>
              <button
                style={styles.plotChip}
                disabled={plots.length === 0}
                onClick={exportPlotSVG}
                title="Download current figure as SVG"
              >svg</button>
              <button
                style={styles.plotChip}
                disabled={plots.length === 0}
                onClick={exportPlotPNG}
                title="Download current figure as PNG"
              >png</button>
              <button
                style={styles.plotChip}
                disabled={plots.length === 0}
                onClick={() => setPlotFullscreen(true)}
                title="Expand figure to fullscreen (double-click chart)"
                aria-label="Expand figure"
              >⤢</button>
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
                      title={`${label} (${p.mode3d ? '3D ' + p.mode3d : p.series.length + ' series'})`}
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
        </div>
        )}

        {resultsTab === 'workspace' && (
        <div style={styles.rightRail}>
          <div style={styles.varPanel}>
            <div style={styles.panelHeader}>
              <span>Workspace</span>
              <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 11 }}>
                {vars.length} variable{vars.length === 1 ? '' : 's'}
                {varFilter.trim() && ` · ${visibleVars.length} shown`}
              </span>
            </div>
            <div style={styles.panelToolbar}>
              <input
                style={styles.varFilter}
                value={varFilter}
                onChange={e => setVarFilter(e.target.value)}
                placeholder="Filter variables…"
                aria-label="Filter workspace variables"
                spellCheck={false}
                disabled={vars.length === 0}
              />
              <button
                type="button"
                style={{ ...styles.plotChip, minWidth: 54, justifyContent: 'center', display: 'inline-flex' }}
                onClick={() => setVarSort(s => s === 'name' ? 'size' : s === 'size' ? 'type' : 'name')}
                disabled={vars.length === 0}
                title={`Sort by ${varSort} — click to cycle (name → size → type)`}
                aria-label={`Sort workspace by ${varSort}`}
              >sort ↕</button>
              <button
                type="button"
                style={{ ...styles.plotChip, minWidth: 54, justifyContent: 'center', display: 'inline-flex' }}
                onClick={() => setCopyFormat(f => {
                  const i = COPY_FORMATS.indexOf(f)
                  return COPY_FORMATS[(i + 1) % COPY_FORMATS.length]
                })}
                disabled={vars.length === 0}
                title={`Row copy format: ${copyFormat} — click to cycle (native → python → latex → json → csv)`}
                aria-label={`Copy format: ${copyFormat}`}
              >copy ⧉</button>
            </div>
            <div style={styles.varList}>
              {vars.length === 0 && (
                <div style={styles.emptyHero}>
                  <span style={styles.emptyHeroKicker}>Workspace</span>
                  <h3 style={styles.emptyHeroTitle}>No variables yet</h3>
                  <p style={styles.emptyHeroSub}>
                    Run a script or type an expression below — every value you
                    compute lands here, ready to inspect, copy, or pin.
                  </p>
                  <div style={styles.emptyHeroCtaRow}>
                    <button
                      type="button"
                      style={styles.emptyHeroCta}
                      onClick={runScript}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    >Run script</button>
                    <button
                      type="button"
                      style={styles.emptyHeroCta}
                      onClick={() => cmdInputRef.current?.focus()}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    >Focus command line</button>
                  </div>
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
                        <span
                          aria-hidden="true"
                          title={VAR_KIND_TITLE[v.kind]}
                          style={styles.varKindBadge}
                        >
                          {VAR_KIND_LABEL[v.kind]}
                        </span>
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
                          title="Copy as native expression"
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
        )}

        {resultsTab === 'imaging' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ImagingPanel visible />
          </div>
        )}

        {resultsTab === 'console' && (
        <div style={styles.consoleWrap}>
          <div style={styles.consoleHeader}>
            <span>Console</span>
            <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 11 }}>
              {(consoleFilter || consoleKind !== 'all')
                ? `${visibleEntries.length} / ${entries.length} shown`
                : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
            </span>
          </div>
          <div style={styles.panelToolbar}>
            <div style={{ display: 'flex', gap: 6 }}>
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
              placeholder="Filter console…"
              aria-label="Filter console entries"
              spellCheck={false}
            />
            <button
              type="button"
              style={{ ...styles.plotChip, ...(copyFlash ? styles.plotChipActive : null), minWidth: 54, justifyContent: 'center', display: 'inline-flex' }}
              onClick={copyConsole}
              disabled={visibleEntries.length === 0}
              title="Copy visible console entries to clipboard"
            >{copyFlash ? 'copied' : 'copy'}</button>
          </div>
          <div ref={consoleRef} style={styles.console} onScroll={onConsoleScroll}>
            {entries.length === 0 && (
              <div style={styles.emptyHero}>
                <span style={styles.emptyHeroKicker}>Console</span>
                <h3 style={styles.emptyHeroTitle}>Nothing has been run yet</h3>
                <p style={styles.emptyHeroSub}>
                  Hit Run to execute the editor, or type a quick
                  expression below — outputs and errors will appear here.
                </p>
                <div style={styles.emptyHeroCtaRow}>
                  <button
                    type="button"
                    style={styles.emptyHeroCta}
                    onClick={runScript}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  >Run script</button>
                  <button
                    type="button"
                    style={styles.emptyHeroCta}
                    onClick={() => cmdInputRef.current?.focus()}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  >Focus command line</button>
                </div>
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
              // Prefix each entry with a monospace HH:MM:SS hint when
              // the "time" chip is active. Older entries without an
              // `at` field (e.g. loaded from persisted sessions) get a
              // dim placeholder so columns still line up.
              let stamp: string | null = null
              if (consoleShowTimestamps) {
                if (typeof e.at === 'number') {
                  const d = new Date(e.at)
                  const pad = (n: number) => String(n).padStart(2, '0')
                  stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
                } else {
                  stamp = '--:--:--'
                }
              }
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
                    (clickable
                      ? `Click to jump to line ${e.line}, double-click to copy to prompt`
                      : 'Double-click to copy to prompt') +
                    (typeof e.at === 'number' ? `\n${new Date(e.at).toLocaleString()}` : '')
                  }
                >
                  {stamp && (
                    <span style={{ color: 'var(--color-text-muted)', marginRight: 8 }}>
                      {stamp}
                    </span>
                  )}
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
        )}

            </div>
          </div>
        </div>
      )}

      {/* ─── Status bar ──────────────────────────────────────────────── */}
      <div style={styles.statusBar}>
        <span
          style={styles.statusBarAction}
          onClick={openGoto}
          onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.background = 'var(--glass-bg-hover)'; (e.currentTarget as HTMLSpanElement).style.color = 'var(--color-text)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.background = 'transparent'; (e.currentTarget as HTMLSpanElement).style.color = '' }}
          title="Go to line… (Ctrl/Cmd + G)"
          role="button"
        >Ln {cursor.line}, Col {cursor.col}</span>
        <span>·</span>
        <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>
        {selectionInfo && (
          <>
            <span>·</span>
            <span
              style={{ color: 'var(--color-text)' }}
              title={`${selectionInfo.chars} char${selectionInfo.chars === 1 ? '' : 's'}, ${selectionInfo.words} word${selectionInfo.words === 1 ? '' : 's'}, ${selectionInfo.lines} line${selectionInfo.lines === 1 ? '' : 's'} selected`}
            >
              {selectionInfo.chars} char{selectionInfo.chars === 1 ? '' : 's'}
              {selectionInfo.words > 0 && `, ${selectionInfo.words} word${selectionInfo.words === 1 ? '' : 's'}`}
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
        {enclosingFunctionName && (
          <>
            <span>·</span>
            <span
              style={{ color: 'var(--color-text)' }}
              title={`Caret is inside function "${enclosingFunctionName}"`}
            >
              ƒ {enclosingFunctionName}
            </span>
          </>
        )}
        <span>·</span>
        <span
          style={styles.statusBarAction}
          onClick={() => { setResultsTab('workspace'); setResultsOverlay(true) }}
          onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.background = 'var(--glass-bg-hover)'; (e.currentTarget as HTMLSpanElement).style.color = 'var(--color-text)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.background = 'transparent'; (e.currentTarget as HTMLSpanElement).style.color = '' }}
          title={`Open Workspace tab — ${workspaceBytes.toLocaleString()} bytes across ${vars.length} variable${vars.length === 1 ? '' : 's'}`}
          role="button"
        >
          {vars.length} var{vars.length === 1 ? '' : 's'}
          {vars.length > 0 && ` · ${workspaceSizeLabel}`}
        </span>
        {plots.length > 0 && (
          <>
            <span>·</span>
            <span
              style={styles.statusBarAction}
              onClick={() => { setResultsTab('figure'); setResultsOverlay(true) }}
              onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.background = 'var(--glass-bg-hover)'; (e.currentTarget as HTMLSpanElement).style.color = 'var(--color-text)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.background = 'transparent'; (e.currentTarget as HTMLSpanElement).style.color = '' }}
              title="Open Figures tab"
              role="button"
            >{plots.length} figure{plots.length === 1 ? '' : 's'}</span>
          </>
        )}
        <span
          style={{ ...styles.statusBarAction, marginLeft: 'auto' }}
          onClick={() => setHelpOpen(true)}
          onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.background = 'var(--glass-bg-hover)'; (e.currentTarget as HTMLSpanElement).style.color = 'var(--color-text)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.background = 'transparent'; (e.currentTarget as HTMLSpanElement).style.color = '' }}
          title="Keyboard shortcuts (F1)"
          role="button"
        >
          F1 shortcuts
        </span>
        <span>·</span>
        <span
          style={styles.statusBarAction}
          onClick={() => {
            const next = { ...editorPrefs, wrap: !editorPrefs.wrap }
            setEditorPrefs(next)
            saveEditorPrefs(next)
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.background = 'var(--glass-bg-hover)'; (e.currentTarget as HTMLSpanElement).style.color = 'var(--color-text)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.background = 'transparent'; (e.currentTarget as HTMLSpanElement).style.color = '' }}
          title={`Word wrap: ${editorPrefs.wrap ? 'ON' : 'OFF'} — click to toggle`}
          role="button"
        >
          {editorPrefs.fontSize}px {editorPrefs.wrap ? 'wrap' : 'nowrap'}
        </span>
        <span>·</span>
        <span
          style={{ color: 'var(--color-text-muted)' }}
          title={`Workstation session opened at ${new Date(sessionStartedAtRef.current).toLocaleTimeString()}`}
        >
          {sessionElapsedLabel}
        </span>
        <span>·</span>
        {(() => {
          const pillStyle = {
            ...styles.statusRunPill,
            ...(running
              ? styles.statusRunPillRunning
              : lastRunOk === true
                ? styles.statusRunPillOk
                : lastRunOk === false
                  ? styles.statusRunPillErr
                  : null),
          }
          const dotStyle = {
            ...styles.statusRunDot,
            ...(running
              ? styles.statusRunDotRunning
              : lastRunOk === true
                ? styles.statusRunDotOk
                : lastRunOk === false
                  ? styles.statusRunDotErr
                  : null),
          }
          const label = running
            ? 'running…'
            : lastRunMs !== null
              ? `last run ${lastRunMs < 1000 ? lastRunMs.toFixed(1) + ' ms' : (lastRunMs / 1000).toFixed(2) + ' s'}`
              : 'ready'
          const title = running
            ? 'A script or fragment is currently running'
            : lastRunOk === true
              ? 'Most recent run finished cleanly'
              : lastRunOk === false
                ? 'Most recent run surfaced an error — open the console tab to inspect'
                : 'No script has been run yet in this session'
          return (
            <span style={pillStyle} title={title}>
              <span style={dotStyle} aria-hidden="true" />
              {label}
            </span>
          )
        })()}
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
          placeholder="Enter a numeric expression (e.g. mean(1:10))"
          spellCheck={false}
          autoComplete="off"
        />
        {cmd === '' && (
          <span style={styles.cmdHint} aria-hidden="true">
            <span><span style={styles.cmdHintKbd}>↑↓</span>history</span>
            <span><span style={styles.cmdHintKbd}>⌃R</span>search</span>
            <span><span style={styles.cmdHintKbd}>⌃L</span>clear</span>
          </span>
        )}
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
                onClick={() => { copyPlotToClipboard() }}
                title="Copy figure to clipboard"
              >copy</button>
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
              {groupedPaletteRows
                ? groupedPaletteRows.map((row) => {
                    if (row.kind === 'cat') {
                      return <div key={`cat-${row.label}`} style={styles.paletteCategory}>{row.label}</div>
                    }
                    const active = row.flatIdx === paletteIndex
                    return (
                      <div
                        key={row.cmd.id}
                        role="option"
                        aria-selected={active}
                        style={active ? { ...styles.paletteItem, ...styles.paletteItemActive } : styles.paletteItem}
                        onMouseEnter={() => setPaletteIndex(row.flatIdx)}
                        onMouseDown={e => { e.preventDefault(); closePalette(); row.cmd.run() }}
                      >
                        <span>{row.cmd.title}</span>
                        {row.cmd.hint && <span style={styles.paletteHint}>{row.cmd.hint}</span>}
                      </div>
                    )
                  })
                : visiblePaletteCommands.map((cmd, i) => {
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
            <div style={styles.paletteFooter}>
              <span>
                {visiblePaletteCommands.length}
                {' of '}
                {paletteCommands.length} command{paletteCommands.length === 1 ? '' : 's'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                <span style={styles.paletteFooterKey}>
                  <span style={styles.paletteFooterKbd}>↑↓</span>
                  navigate
                </span>
                <span style={styles.paletteFooterKey}>
                  <span style={styles.paletteFooterKbd}>↵</span>
                  run
                </span>
                <span style={styles.paletteFooterKey}>
                  <span style={styles.paletteFooterKbd}>esc</span>
                  close
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ─── Go to symbol (Ctrl/Cmd + Shift + O) ──────────────────── */}
      {symbolNavOpen && (
        <div
          style={styles.paletteBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Go to symbol"
          onClick={e => { if (e.target === e.currentTarget) closeSymbolNav() }}
        >
          <div style={styles.paletteCard}>
            <input
              ref={symbolNavInputRef}
              style={styles.paletteInput}
              value={symbolNavQuery}
              onChange={e => { setSymbolNavQuery(e.target.value); setSymbolNavIndex(0) }}
              placeholder="Go to symbol — type to filter sections and functions…"
              aria-label="Filter symbols"
              spellCheck={false}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); closeSymbolNav() }
                else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSymbolNavIndex(i => Math.min(i + 1, Math.max(0, visibleScriptSymbols.length - 1)))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSymbolNavIndex(i => Math.max(i - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  commitSymbolNav()
                }
              }}
            />
            <div style={styles.paletteList}>
              {visibleScriptSymbols.length === 0 && (
                <div style={styles.paletteEmpty}>
                  {scriptSymbols.length === 0
                    ? 'No %% sections or function definitions in this script.'
                    : `No symbols match "${symbolNavQuery}".`}
                </div>
              )}
              {visibleScriptSymbols.map((sym, i) => {
                const active = i === symbolNavIndex
                return (
                  <div
                    key={`${sym.kind}-${sym.line}-${sym.name}`}
                    role="option"
                    aria-selected={active}
                    style={active ? { ...styles.paletteItem, ...styles.paletteItemActive } : styles.paletteItem}
                    onMouseEnter={() => setSymbolNavIndex(i)}
                    onMouseDown={e => {
                      e.preventDefault()
                      setSymbolNavIndex(i)
                      setSymbolNavOpen(false)
                      jumpToLine(sym.line)
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{
                        display: 'inline-block',
                        width: 14,
                        textAlign: 'center',
                        color: 'var(--color-text-muted)',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10,
                        flex: '0 0 auto',
                      }}>
                        {sym.kind === 'section' ? '§' : 'ƒ'}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sym.name}
                      </span>
                    </span>
                    <span style={styles.paletteHint}>line {sym.line}</span>
                  </div>
                )
              })}
            </div>
            <div style={styles.paletteFooter}>
              <span>
                {visibleScriptSymbols.length}
                {' of '}
                {scriptSymbols.length} symbol{scriptSymbols.length === 1 ? '' : 's'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                <span style={styles.paletteFooterKey}>
                  <span style={styles.paletteFooterKbd}>↑↓</span>
                  navigate
                </span>
                <span style={styles.paletteFooterKey}>
                  <span style={styles.paletteFooterKbd}>↵</span>
                  jump
                </span>
                <span style={styles.paletteFooterKey}>
                  <span style={styles.paletteFooterKbd}>esc</span>
                  close
                </span>
              </span>
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
// Series palette uses Humanovo theme accent CSS vars so the colours
// stay legible in both light and dark mode. The previous monochrome
// grey palette (#ededed → #525252) was tuned for the dark theme and
// became invisible on the Results overlay's white plot card under
// light mode. Six distinct accents cover most multi-series biomedical
// plots; deeper indices loop. Recharts forwards stroke/fill straight
// into the SVG attribute so CSS vars resolve at render time.
const SERIES_COLORS = [
  'var(--color-accent-blue)',
  'var(--color-accent-orange)',
  'var(--color-accent-green)',
  'var(--color-accent-purple)',
  'var(--color-accent-pink)',
  'var(--color-accent-cyan)',
]

// Per-figure render options surfaced through the figure-panel chips.
interface PlotOpts {
  grid: boolean
  logX: boolean
  logY: boolean
  legend: 'auto' | 'on' | 'off'
}
const DEFAULT_PLOT_OPTS: PlotOpts = { grid: true, logX: false, logY: false, legend: 'auto' }

function PlotView({ plot, opts = DEFAULT_PLOT_OPTS }: { plot: PlotSpec | null; opts?: PlotOpts }) {
  // 3D plot rendering via Plotly
  if (plot?.mode3d) {
    const cs = plot.colorscale || 'Viridis'
    let traces: any[] = []
    const mode = plot.mode3d
    if (mode === 'surface' || mode === 'wireframe' || mode === 'contour') {
      const base: any = {
        type: 'surface', x: plot.surfaceX, y: plot.surfaceY, z: plot.surfaceZ,
        colorscale: cs, opacity: mode === 'wireframe' ? 0.4 : 0.92,
      }
      if (mode === 'wireframe') {
        base.hidesurface = true
        base.contours = { x: { show: true, color: '#888', width: 1 }, y: { show: true, color: '#888', width: 1 }, z: { show: false } }
      }
      if (mode === 'contour') {
        base.contours = { z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: true } } }
      }
      traces = [base]
    } else if (mode === 'scatter3d') {
      traces = [{ type: 'scatter3d', mode: 'markers', x: plot.scatter3dX, y: plot.scatter3dY, z: plot.scatter3dZ, marker: { size: 3, color: plot.scatter3dZ, colorscale: cs, opacity: 0.85 } }]
    } else if (mode === 'heatmap') {
      traces = [{ type: 'heatmap', x: plot.surfaceX, y: plot.surfaceY, z: plot.surfaceZ, colorscale: cs }]
    }
    const is2D = mode === 'heatmap'
    const layout: any = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#a1a1aa', size: 11 }, margin: { l: 10, r: 10, t: plot.title ? 30 : 10, b: 10 },
      showlegend: false, autosize: true,
      title: plot.title ? { text: plot.title, font: { color: '#e5e5e5', size: 13 } } : undefined,
    }
    if (!is2D) {
      layout.scene = {
        xaxis: { title: plot.xLabel || 'x', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', backgroundcolor: 'rgba(0,0,0,0)' },
        yaxis: { title: plot.yLabel || 'y', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', backgroundcolor: 'rgba(0,0,0,0)' },
        zaxis: { title: plot.zLabel || 'z', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', backgroundcolor: 'rgba(0,0,0,0)' },
        bgcolor: 'rgba(0,0,0,0)', camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } },
      }
    } else {
      layout.xaxis = { title: plot.xLabel || 'x', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)' }
      layout.yaxis = { title: plot.yLabel || 'y', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)' }
    }
    return (
      <div style={{ width: '100%', height: '100%', minHeight: 180 }}>
        <PublicationFigure
          title={plot.title || `Figure (${mode})`}
          subtitle={plot.xLabel && plot.yLabel ? `${plot.xLabel} vs ${plot.yLabel}${plot.zLabel ? ` vs ${plot.zLabel}` : ''}` : undefined}
          exportName={(plot.title || `figure-${mode}`).replace(/[^\w-]+/g, '_')}
        >
          <div style={{ width: '100%', height: 480 }}>
            <PlotlyChart data={traces} layout={layout} config={plotlyConfig()} style={{ width: '100%', height: '100%' }} useResizeHandler />
          </div>
        </PublicationFigure>
      </div>
    )
  }

  if (!plot || plot.series.length === 0) {
    return (
      <div style={{
        height: '100%',
        minHeight: 180,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '28px 24px',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <span style={{
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          opacity: 0.75,
        }}>Figure</span>
        <h3 style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          letterSpacing: -0.1,
        }}>No figure yet</h3>
        <p style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.5,
          maxWidth: 360,
        }}>
          Call <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>plot(x, y)</code>
          {' '}from a script or the command line. Figures stack here so you can flip between them.
        </p>
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

  // Compute data bounds to decide quadrant display.
  // If data spans negative and positive ranges, show all 4 quadrants.
  let xMinVal = Infinity, xMaxVal = -Infinity
  let yMinVal = Infinity, yMaxVal = -Infinity
  for (const s of plot.series) {
    for (const v of s.x) { if (Number.isFinite(v)) { if (v < xMinVal) xMinVal = v; if (v > xMaxVal) xMaxVal = v } }
    for (const v of s.y) { if (Number.isFinite(v)) { if (v < yMinVal) yMinVal = v; if (v > yMaxVal) yMaxVal = v } }
  }
  const hasNegX = xMinVal < 0, hasNegY = yMinVal < 0
  const hasPosX = xMaxVal > 0, hasPosY = yMaxVal > 0
  // Determine if we need 4-quadrant display (data crosses both axes)
  const fourQuadrant = (hasNegX && hasPosX) || (hasNegY && hasPosY)

  // Recharts log scale needs an explicit numeric domain, otherwise it
  // collapses zero/negative ticks to NaN and the axis disappears.
  const xScale = opts.logX ? 'log' : 'auto'
  const yScale = opts.logY ? 'log' : 'auto'

  // Auto-expand domain to show full quadrants when data has negative values.
  // Add ~5% padding so points don't sit on the axis edge.
  let xDomain: [number | string, number | string] | undefined
  let yDomain: [number | string, number | string] | undefined
  if (opts.logX) {
    xDomain = ['auto', 'auto']
  } else if (fourQuadrant || hasNegX || hasNegY) {
    const xPad = (xMaxVal - xMinVal) * 0.05 || 1
    const yPad = (yMaxVal - yMinVal) * 0.05 || 1
    xDomain = [xMinVal - xPad, xMaxVal + xPad]
    yDomain = [yMinVal - yPad, yMaxVal + yPad]
  }
  if (opts.logY) {
    yDomain = ['auto', 'auto']
  }

  const showLegend = opts.legend === 'on' || (opts.legend === 'auto' && plot.series.length > 1)

  // Axes use --color-border-strong (10% on the foreground) instead of
  // --glass-border (6%) so the gridlines and axis lines stay legible on
  // both the regular workstation surface AND the Results overlay's
  // dimmed scrim. Without this bump the chart effectively dissolves into
  // its container under the overlay — verified live in-browser.
  const common = (
    <>
      {opts.grid && <CartesianGrid stroke="var(--color-border-strong)" strokeDasharray="3 3" />}
      {/* 4-quadrant: draw prominent axis lines at x=0 and y=0 */}
      {fourQuadrant && hasNegY && hasPosY && (
        <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeWidth={1} strokeDasharray="" />
      )}
      {fourQuadrant && hasNegX && hasPosX && (
        <ReferenceLine x={0} stroke="var(--color-text-muted)" strokeWidth={1} strokeDasharray="" />
      )}
      <XAxis
        dataKey="x"
        type="number"
        scale={xScale}
        domain={xDomain}
        allowDataOverflow={opts.logX}
        stroke="var(--color-border-strong)"
        tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
        label={plot.xLabel ? { value: plot.xLabel, position: 'insideBottom', offset: -2, fill: 'var(--color-text-secondary)', fontSize: 11 } : undefined}
      />
      <YAxis
        scale={yScale}
        domain={yDomain}
        allowDataOverflow={opts.logY}
        stroke="var(--color-border-strong)"
        tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
        label={plot.yLabel ? { value: plot.yLabel, angle: -90, position: 'insideLeft', fill: 'var(--color-text-secondary)', fontSize: 11 } : undefined}
      />
      <Tooltip
        contentStyle={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 10,
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
      <PublicationFigure
        title={plot.title || 'Figure'}
        subtitle={plot.series.length > 1 ? `${plot.series.length} series` : undefined}
        exportName={(plot.title || `figure-${kind}`).replace(/[^\w-]+/g, '_')}
      >
        <div style={{ width: '100%', height: Math.max(280, 420) }}>
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
      </PublicationFigure>
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
      // The engine uses a flat
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
      ['F9', 'Run selection'],
      ['Shift + F9', 'Run everything up to the cursor line'],
      ['Ctrl / Cmd + Shift + R', 'Re-run the most recent fragment'],
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
      ['Ctrl / Cmd + J', 'Join line with the next line'],
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
      ['Ctrl / Cmd + Shift + O', 'Go to symbol (sections + functions)'],
      ['Ctrl / Cmd + M', 'Jump to matching bracket'],
      ['Ctrl / Cmd + Shift + M', 'Select to matching bracket'],
      ['Enter / Shift + Enter (find)', 'Next / previous match'],
      ['Ctrl / Cmd + F2', 'Toggle bookmark on current line'],
      ['F2 / Shift + F2', 'Next / previous bookmark'],
      ['F8 / Shift + F8', 'Jump to next / previous reported error'],
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
      ['Ctrl / Cmd + = / -', 'Grow / shrink editor font size'],
      ['Ctrl / Cmd + 0', 'Reset editor font size to default'],
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
