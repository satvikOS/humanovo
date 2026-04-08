import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  FiPlay, FiPlus, FiDownload, FiCopy, FiLayers,
  FiTrash2, FiRefreshCw, FiChevronRight,
} from 'react-icons/fi'
import clsx from 'clsx'

// ═══════════════════════════════════════════════════════════════════
//  Expression Evaluator — self-contained, no external math library
// ═══════════════════════════════════════════════════════════════════

type Token = { type: 'num'; value: number }
  | { type: 'id'; value: string }
  | { type: 'op'; value: string }
  | { type: 'lp' } | { type: 'rp' } | { type: 'comma' }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (i < expr.length && /[0-9.eE]/.test(expr[i])) {
        if ((expr[i] === 'e' || expr[i] === 'E') && i + 1 < expr.length && (expr[i + 1] === '+' || expr[i + 1] === '-')) {
          num += expr[i] + expr[i + 1]; i += 2
        } else { num += expr[i]; i++ }
      }
      tokens.push({ type: 'num', value: parseFloat(num) })
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { id += expr[i]; i++ }
      tokens.push({ type: 'id', value: id })
      continue
    }
    if (ch === '(') { tokens.push({ type: 'lp' }); i++; continue }
    if (ch === ')') { tokens.push({ type: 'rp' }); i++; continue }
    if (ch === ',') { tokens.push({ type: 'comma' }); i++; continue }
    if ('+-*/^'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue }
    i++ // skip unknown
  }
  return tokens
}

type ASTNode = { kind: 'num'; value: number }
  | { kind: 'var' }
  | { kind: 'unary'; op: string; child: ASTNode }
  | { kind: 'binary'; op: string; left: ASTNode; right: ASTNode }
  | { kind: 'call'; name: string; args: ASTNode[] }

function parse(tokens: Token[]): ASTNode {
  let pos = 0
  const peek = () => tokens[pos] as Token | undefined
  const advance = () => tokens[pos++]

  function parseExpr(): ASTNode { return parseAdd() }

  function parseAdd(): ASTNode {
    let node = parseMul()
    let p = peek()
    while (p && p.type === 'op' && (p.value === '+' || p.value === '-')) {
      const op = (advance() as { type: 'op'; value: string }).value
      node = { kind: 'binary', op, left: node, right: parseMul() }
      p = peek()
    }
    return node
  }

  function parseMul(): ASTNode {
    let node = parsePow()
    let p = peek()
    while (p && p.type === 'op' && (p.value === '*' || p.value === '/')) {
      const op = (advance() as { type: 'op'; value: string }).value
      node = { kind: 'binary', op, left: node, right: parsePow() }
      p = peek()
    }
    return node
  }

  function parsePow(): ASTNode {
    let node = parseUnary()
    const p = peek()
    if (p && p.type === 'op' && p.value === '^') {
      advance()
      node = { kind: 'binary', op: '^', left: node, right: parsePow() }
    }
    return node
  }

  function parseUnary(): ASTNode {
    const p = peek()
    if (p && p.type === 'op' && p.value === '-') {
      advance()
      return { kind: 'unary', op: '-', child: parseUnary() }
    }
    if (p && p.type === 'op' && p.value === '+') { advance() }
    return parseAtom()
  }

  function parseAtom(): ASTNode {
    const t = peek()
    if (!t) throw new Error('Unexpected end of expression')

    if (t.type === 'num') { advance(); return { kind: 'num', value: t.value } }

    if (t.type === 'id') {
      const name = t.value
      advance()
      // constants
      if (name === 'pi') return { kind: 'num', value: Math.PI }
      if (name === 'e' && peek()?.type !== 'lp') return { kind: 'num', value: Math.E }
      // function call
      if (peek()?.type === 'lp') {
        advance() // skip (
        const args: ASTNode[] = []
        if (peek()?.type !== 'rp') {
          args.push(parseExpr())
          while (peek()?.type === 'comma') { advance(); args.push(parseExpr()) }
        }
        if (peek()?.type === 'rp') advance()
        return { kind: 'call', name, args }
      }
      if (name === 'x') return { kind: 'var' }
      throw new Error(`Unknown identifier: ${name}`)
    }

    if (t.type === 'lp') {
      advance()
      const node = parseExpr()
      if (peek()?.type === 'rp') advance()
      return node
    }

    throw new Error(`Unexpected token: ${JSON.stringify(t)}`)
  }

  const result = parseExpr()
  return result
}

function evaluate(node: ASTNode, x: number): number {
  switch (node.kind) {
    case 'num': return node.value
    case 'var': return x
    case 'unary': return node.op === '-' ? -evaluate(node.child, x) : evaluate(node.child, x)
    case 'binary': {
      const l = evaluate(node.left, x), r = evaluate(node.right, x)
      switch (node.op) {
        case '+': return l + r
        case '-': return l - r
        case '*': return l * r
        case '/': return r === 0 ? NaN : l / r
        case '^': return Math.pow(l, r)
        default: return NaN
      }
    }
    case 'call': {
      const a = node.args.map(a => evaluate(a, x))
      switch (node.name) {
        case 'sin': return Math.sin(a[0])
        case 'cos': return Math.cos(a[0])
        case 'tan': return Math.tan(a[0])
        case 'exp': return Math.exp(a[0])
        case 'log': return a[0] > 0 ? Math.log(a[0]) : NaN
        case 'ln': return a[0] > 0 ? Math.log(a[0]) : NaN
        case 'sqrt': return a[0] >= 0 ? Math.sqrt(a[0]) : NaN
        case 'abs': return Math.abs(a[0])
        case 'pow': return Math.pow(a[0], a[1])
        case 'min': return Math.min(a[0], a[1])
        case 'max': return Math.max(a[0], a[1])
        default: throw new Error(`Unknown function: ${node.name}`)
      }
    }
  }
}

function safeEval(expr: string, x: number): number {
  try {
    const tokens = tokenize(expr)
    const ast = parse(tokens)
    const val = evaluate(ast, x)
    return isFinite(val) ? val : NaN
  } catch { return NaN }
}

function computeSeries(expr: string, xMin: number, xMax: number, n = 300): { x: number; y: number }[] {
  const step = (xMax - xMin) / (n - 1)
  const data: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const x = xMin + i * step
    const y = safeEval(expr, x)
    data.push({ x: parseFloat(x.toFixed(6)), y })
  }
  return data
}

// ═══════════════════════════════════════════════════════════════════
//  Predefined Scientific Equations
// ═══════════════════════════════════════════════════════════════════

interface PredefinedEq {
  id: string
  name: string
  expr: string
  xMin: number
  xMax: number
  category: string
}

const PRESETS: PredefinedEq[] = [
  { id: 'pk-one-compartment', name: 'PK One-Compartment', expr: '100/50 * exp(-0.15*x)', xMin: 0, xMax: 48, category: 'Pharmacokinetics' },
  { id: 'pk-two-compartment', name: 'PK Two-Compartment', expr: '1.5*exp(-0.4*x) + 0.5*exp(-0.05*x)', xMin: 0, xMax: 72, category: 'Pharmacokinetics' },
  { id: 'pk-oral-absorption', name: 'PK Oral Absorption', expr: '(100*1.5)/(50*(1.5-0.15))*(exp(-0.15*x)-exp(-1.5*x))', xMin: 0, xMax: 48, category: 'Pharmacokinetics' },
  { id: 'michaelis-menten', name: 'Michaelis-Menten', expr: '100*x/(10+x)', xMin: 0, xMax: 100, category: 'Enzyme Kinetics' },
  { id: 'hill-equation', name: 'Hill Equation', expr: '100*pow(x,2)/(pow(10,2)+pow(x,2))', xMin: 0, xMax: 50, category: 'Dose-Response' },
  { id: 'logistic-growth', name: 'Logistic Growth', expr: '1000/(1+99*exp(-0.1*x))', xMin: 0, xMax: 100, category: 'Systems Biology' },
  { id: 'gompertz-growth', name: 'Gompertz Growth', expr: '1000*exp(log(10/1000)*exp(-0.05*x))', xMin: 0, xMax: 120, category: 'Systems Biology' },
  { id: 'emax-model', name: 'Emax Model', expr: '5+95*x/(25+x)', xMin: 0, xMax: 200, category: 'Dose-Response' },
  { id: 'biexponential-decay', name: 'Biexponential Decay', expr: '80*exp(-0.5*x)+20*exp(-0.02*x)', xMin: 0, xMax: 100, category: 'Pharmacokinetics' },
  { id: 'damped-oscillation', name: 'Damped Oscillation', expr: 'exp(-0.1*x)*sin(x)', xMin: 0, xMax: 40, category: 'Systems Biology' },
]

const OVERLAY_COLORS = ['#f97316', '#a855f7', '#14b8a6']

interface SavedOverlay {
  expr: string
  xMin: number
  xMax: number
  enabled: boolean
}

interface HistoryEntry {
  expr: string
  xMin: number
  xMax: number
  timestamp: number
}

// ═══════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════

export default function EquationPlotter() {
  // ── State ──────────────────────────────────────────────────────
  const [expr, setExpr] = useState(() => localStorage.getItem('eq-plotter-expr') || 'sin(x)')
  const [xMin, setXMin] = useState(() => parseFloat(localStorage.getItem('eq-plotter-xmin') || '-10'))
  const [xMax, setXMax] = useState(() => parseFloat(localStorage.getItem('eq-plotter-xmax') || '10'))
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('eq-history') || '[]') } catch { return [] }
  })
  const [overlays, setOverlays] = useState<SavedOverlay[]>([])
  const [showOverlays, setShowOverlays] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const inputRef = useRef<HTMLInputElement>(null)

  // ── Persistence ────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem('eq-plotter-expr', expr) }, [expr])
  useEffect(() => { localStorage.setItem('eq-plotter-xmin', String(xMin)) }, [xMin])
  useEffect(() => { localStorage.setItem('eq-plotter-xmax', String(xMax)) }, [xMax])
  useEffect(() => { localStorage.setItem('eq-history', JSON.stringify(history.slice(0, 30))) }, [history])

  // ── Computed data ──────────────────────────────────────────────
  const mainData = useMemo(() => {
    try {
      // Quick validation: try a single evaluation
      const tokens = tokenize(expr)
      const ast = parse(tokens)
      evaluate(ast, (xMin + xMax) / 2)
      setError(null)
      return computeSeries(expr, xMin, xMax)
    } catch (e: any) {
      setError(e.message || 'Invalid expression')
      return []
    }
  }, [expr, xMin, xMax])

  const overlayData = useMemo(() => {
    return overlays
      .filter(o => o.enabled)
      .map(o => computeSeries(o.expr, Math.min(o.xMin, xMin), Math.max(o.xMax, xMax)))
  }, [overlays, xMin, xMax])

  // Merge main + overlay data into unified chart points
  const chartData = useMemo(() => {
    if (mainData.length === 0) return []
    const merged = mainData.map(p => {
      const row: Record<string, number> = { x: p.x, y: p.y }
      overlayData.forEach((series, idx) => {
        const closest = series.reduce((best, s) =>
          Math.abs(s.x - p.x) < Math.abs(best.x - p.x) ? s : best, series[0])
        if (closest && Math.abs(closest.x - p.x) < (xMax - xMin) / 200) {
          row[`o${idx}`] = closest.y
        }
      })
      return row
    })
    return merged
  }, [mainData, overlayData, xMin, xMax])

  const stats = useMemo(() => {
    const ys = mainData.map(p => p.y).filter(v => isFinite(v))
    if (ys.length === 0) return null
    const s = ys.reduce((a, b) => a + b, 0)
    return {
      min: Math.min(...ys),
      max: Math.max(...ys),
      mean: s / ys.length,
      points: ys.length,
    }
  }, [mainData])

  // ── Actions ────────────────────────────────────────────────────
  const addToHistory = useCallback((e: string, mn: number, mx: number) => {
    setHistory(prev => {
      const filtered = prev.filter(h => h.expr !== e)
      return [{ expr: e, xMin: mn, xMax: mx, timestamp: Date.now() }, ...filtered].slice(0, 30)
    })
  }, [])

  const handlePlot = useCallback(() => {
    addToHistory(expr, xMin, xMax)
  }, [expr, xMin, xMax, addToHistory])

  const loadPreset = useCallback((p: PredefinedEq) => {
    setExpr(p.expr)
    setXMin(p.xMin)
    setXMax(p.xMax)
    addToHistory(p.expr, p.xMin, p.xMax)
    inputRef.current?.focus()
  }, [addToHistory])

  const restoreHistory = useCallback((h: HistoryEntry) => {
    setExpr(h.expr)
    setXMin(h.xMin)
    setXMax(h.xMax)
    inputRef.current?.focus()
  }, [])

  const addOverlay = useCallback(() => {
    if (overlays.length >= 3) return
    setOverlays(prev => [...prev, { expr, xMin, xMax, enabled: true }])
    setShowOverlays(true)
  }, [expr, xMin, xMax, overlays.length])

  const removeOverlay = useCallback((idx: number) => {
    setOverlays(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const toggleOverlay = useCallback((idx: number) => {
    setOverlays(prev => prev.map((o, i) => i === idx ? { ...o, enabled: !o.enabled } : o))
  }, [])

  const exportCSV = useCallback(() => {
    if (mainData.length === 0) return
    const header = 'x,y\n'
    const rows = mainData.map(p => `${p.x},${p.y}`).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `equation-plot-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [mainData])

  const copyChartData = useCallback(() => {
    if (mainData.length === 0) return
    const header = 'x\ty\n'
    const rows = mainData.map(p => `${p.x}\t${p.y}`).join('\n')
    navigator.clipboard.writeText(header + rows).catch(() => {})
  }, [mainData])

  const clearHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem('eq-history')
  }, [])

  const resetRange = useCallback(() => {
    setXMin(-10)
    setXMax(10)
  }, [])

  // ── Render helpers ─────────────────────────────────────────────
  const fmt = (n: number) => {
    if (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.001 && n !== 0)) return n.toExponential(3)
    return n.toFixed(4).replace(/\.?0+$/, '')
  }

  const glassCard = {
    background: 'var(--glass-bg)',
    borderColor: 'var(--glass-border)',
  }

  // ── Grouped presets by category ────────────────────────────────
  const presetCategories = useMemo(() => {
    const map = new Map<string, PredefinedEq[]>()
    PRESETS.forEach(p => {
      const arr = map.get(p.category) || []
      arr.push(p)
      map.set(p.category, arr)
    })
    return Array.from(map.entries())
  }, [])

  // ══════════════════════════════════════════════════════════════
  //  JSX
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* ── LEFT SIDEBAR ─────────────────────────────────────── */}
      <div
        className={clsx(
          'flex flex-col border rounded-lg transition-all duration-200 overflow-hidden shrink-0',
          sidebarOpen ? 'w-64' : 'w-8',
        )}
        style={glassCard}
      >
        {/* Toggle */}
        <button
          onClick={() => setSidebarOpen(p => !p)}
          className="flex items-center justify-center h-8 hover:bg-white/5 transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <FiChevronRight className={clsx('transition-transform', sidebarOpen && 'rotate-180')} />
        </button>

        {sidebarOpen && (
          <div className="flex flex-col flex-1 overflow-y-auto px-2 pb-2 gap-3">
            {/* Presets */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: 'var(--color-text-muted)' }}>Equations</h3>
              {presetCategories.map(([cat, items]) => (
                <div key={cat} className="mb-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider"
                    style={{ color: 'var(--color-accent-blue)' }}>{cat}</span>
                  {items.map(p => (
                    <button
                      key={p.id}
                      onClick={() => loadPreset(p)}
                      className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-white/5 transition-colors truncate"
                      style={{ color: 'var(--color-text)' }}
                      title={p.expr}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* History */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-text-muted)' }}>History</h3>
                {history.length > 0 && (
                  <button onClick={clearHistory}
                    className="p-0.5 hover:bg-white/10 rounded transition-colors"
                    style={{ color: 'var(--color-text-muted)' }} title="Clear history">
                    <FiTrash2 size={11} />
                  </button>
                )}
              </div>
              {history.length === 0 && (
                <p className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>
                  No history yet
                </p>
              )}
              {history.slice(0, 15).map((h, i) => (
                <button
                  key={i}
                  onClick={() => restoreHistory(h)}
                  className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-white/5 transition-colors truncate"
                  style={{ color: 'var(--color-text)' }}
                  title={`${h.expr}  [${h.xMin}, ${h.xMax}]`}
                >
                  {h.expr}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── MAIN PANEL ───────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 gap-3">
        {/* Expression input bar */}
        <div className="flex items-center gap-2 border rounded-lg px-3 py-2" style={glassCard}>
          <span className="text-sm font-mono font-semibold shrink-0"
            style={{ color: 'var(--color-accent-blue)' }}>f(x) =</span>
          <input
            ref={inputRef}
            type="text"
            value={expr}
            onChange={e => setExpr(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePlot()}
            className="flex-1 bg-transparent outline-none font-mono text-sm"
            style={{ color: 'var(--color-text)' }}
            placeholder="Enter expression, e.g. sin(x)*exp(-0.1*x)"
            spellCheck={false}
          />
          <button onClick={handlePlot}
            className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors hover:opacity-80"
            style={{ background: 'var(--color-accent-blue)', color: '#fff' }}>
            <FiPlay size={12} /> Plot
          </button>
        </div>

        {/* Range controls + overlay toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>x min</label>
            <input
              type="number"
              value={xMin}
              onChange={e => setXMin(parseFloat(e.target.value) || 0)}
              className="w-20 bg-transparent border rounded px-2 py-1 text-xs font-mono outline-none"
              style={{ color: 'var(--color-text)', borderColor: 'var(--glass-border)' }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>x max</label>
            <input
              type="number"
              value={xMax}
              onChange={e => setXMax(parseFloat(e.target.value) || 0)}
              className="w-20 bg-transparent border rounded px-2 py-1 text-xs font-mono outline-none"
              style={{ color: 'var(--color-text)', borderColor: 'var(--glass-border)' }}
            />
          </div>
          <button onClick={resetRange}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-white/5 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}>
            <FiRefreshCw size={11} /> Reset Range
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowOverlays(p => !p)}
            className={clsx(
              'flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors',
              showOverlays ? 'bg-white/10' : 'hover:bg-white/5',
            )}
            style={{ color: overlays.length > 0 ? 'var(--color-accent-blue)' : 'var(--color-text-muted)' }}
          >
            <FiLayers size={12} /> Overlays ({overlays.filter(o => o.enabled).length}/3)
          </button>
          <button onClick={addOverlay}
            disabled={overlays.length >= 3}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-white/5 transition-colors disabled:opacity-30"
            style={{ color: 'var(--color-text-muted)' }}
            title="Save current equation as overlay">
            <FiPlus size={12} /> Save Overlay
          </button>
        </div>

        {/* Overlay management */}
        {showOverlays && overlays.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
            {overlays.map((o, idx) => (
              <div key={idx}
                className="flex items-center gap-2 border rounded px-2 py-1 text-xs"
                style={{ ...glassCard, borderColor: OVERLAY_COLORS[idx] }}>
                <input
                  type="checkbox"
                  checked={o.enabled}
                  onChange={() => toggleOverlay(idx)}
                  className="accent-blue-500"
                />
                <span className="font-mono truncate max-w-[180px]"
                  style={{ color: OVERLAY_COLORS[idx] }}>
                  {o.expr}
                </span>
                <button onClick={() => removeOverlay(idx)}
                  className="hover:opacity-70 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <FiTrash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="text-xs px-3 py-1.5 rounded border"
            style={{ color: '#f87171', borderColor: '#f8717140', background: '#f8717110' }}>
            Parse error: {error}
          </div>
        )}

        {/* Chart */}
        <div className="flex-1 min-h-0 border rounded-lg p-3" style={glassCard}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis
                  dataKey="x"
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                  tickFormatter={v => typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toExponential(0) : String(Math.round(v * 100) / 100)) : v}
                  stroke="var(--glass-border)"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                  tickFormatter={v => typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toExponential(0) : String(Math.round(v * 100) / 100)) : v}
                  stroke="var(--glass-border)"
                  width={56}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: 'var(--color-text-muted)' }}
                  formatter={(value: unknown) => {
                    const n = typeof value === 'number' ? value : Number(value)
                    return [isFinite(n) ? n.toFixed(4) : 'NaN', '']
                  }}
                  labelFormatter={(label: unknown) => `x = ${label}`}
                />
                {/* Main curve */}
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke="var(--color-accent-blue)"
                  strokeWidth={2}
                  dot={false}
                  name={expr}
                  isAnimationActive={false}
                />
                {/* Overlay curves */}
                {overlays.map((o, idx) =>
                  o.enabled ? (
                    <Line
                      key={idx}
                      type="monotone"
                      dataKey={`o${idx}`}
                      stroke={OVERLAY_COLORS[idx]}
                      strokeWidth={1.5}
                      strokeDasharray="6 3"
                      dot={false}
                      name={o.expr}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  ) : null,
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-sm"
              style={{ color: 'var(--color-text-muted)' }}>
              Enter an expression above to plot
            </div>
          )}
        </div>

        {/* Stats + export row */}
        <div className="flex items-center gap-3 flex-wrap">
          {stats && (
            <div className="flex items-center gap-4 text-xs border rounded-lg px-3 py-2" style={glassCard}>
              <span style={{ color: 'var(--color-text-muted)' }}>
                Min: <strong style={{ color: 'var(--color-text)' }}>{fmt(stats.min)}</strong>
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                Max: <strong style={{ color: 'var(--color-text)' }}>{fmt(stats.max)}</strong>
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                Mean: <strong style={{ color: 'var(--color-text)' }}>{fmt(stats.mean)}</strong>
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                Points: <strong style={{ color: 'var(--color-text)' }}>{stats.points}</strong>
              </span>
            </div>
          )}
          <div className="flex-1" />
          <button onClick={copyChartData}
            disabled={mainData.length === 0}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border hover:bg-white/5 transition-colors disabled:opacity-30"
            style={{ color: 'var(--color-text-muted)', borderColor: 'var(--glass-border)' }}>
            <FiCopy size={12} /> Copy Data
          </button>
          <button onClick={exportCSV}
            disabled={mainData.length === 0}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border hover:bg-white/5 transition-colors disabled:opacity-30"
            style={{ color: 'var(--color-text-muted)', borderColor: 'var(--glass-border)' }}>
            <FiDownload size={12} /> Export CSV
          </button>
        </div>
      </div>
    </div>
  )
}
