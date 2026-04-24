import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Brush, Legend,
} from 'recharts'
import {
  FiPlay, FiPlus, FiDownload, FiCopy, FiLayers,
  FiTrash2, FiRefreshCw, FiImage, FiCheck,
} from 'react-icons/fi'
import { copyPlotToClipboard as copyPlotBlob, downloadPlotPng } from '../../utils/plotExport'
import PublicationFigure from '../../components/PublicationFigure'

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
        case 'asin': return Math.asin(a[0])
        case 'acos': return Math.acos(a[0])
        case 'atan': return Math.atan(a[0])
        case 'atan2': return Math.atan2(a[0], a[1])
        case 'sinh': return Math.sinh(a[0])
        case 'cosh': return Math.cosh(a[0])
        case 'tanh': return Math.tanh(a[0])
        case 'log10': return a[0] > 0 ? Math.log10(a[0]) : NaN
        case 'log2': return a[0] > 0 ? Math.log2(a[0]) : NaN
        case 'sign': return Math.sign(a[0])
        case 'floor': return Math.floor(a[0])
        case 'ceil': return Math.ceil(a[0])
        case 'round': return Math.round(a[0])
        case 'step': return a[0] >= 0 ? 1 : 0
        case 'erf': {
          const t = 1 / (1 + 0.3275911 * Math.abs(a[0]))
          const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
          return a[0] >= 0 ? 1 - p * Math.exp(-a[0] * a[0]) : -(1 - p * Math.exp(-a[0] * a[0]))
        }
        case 'sigmoid': return 1 / (1 + Math.exp(-a[0]))
        case 'rect': return Math.abs(a[0]) <= 0.5 ? 1 : 0
        case 'sinc': return a[0] === 0 ? 1 : Math.sin(Math.PI * a[0]) / (Math.PI * a[0])
        case 'gamma': {
          if (a[0] <= 0 && a[0] === Math.floor(a[0])) return NaN
          const g = 7; const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7]
          let xx = a[0]; if (xx < 0.5) return Math.PI / (Math.sin(Math.PI * xx) * evaluate(node, 1 - xx + 0.0001))
          xx -= 1; let s = c[0]; for (let i = 1; i < g + 2; i++) s += c[i] / (xx + i)
          const t2 = xx + g + 0.5; return Math.sqrt(2 * Math.PI) * Math.pow(t2, xx + 0.5) * Math.exp(-t2) * s
        }
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
//  ODE System Solver — 4th-order Runge-Kutta
// ═══════════════════════════════════════════════════════════════════

type ODEDerivFn = (t: number, y: number[]) => number[]

function rk4(deriv: ODEDerivFn, y0: number[], tSpan: [number, number], steps = 500): { t: number[]; y: number[][] } {
  const dt = (tSpan[1] - tSpan[0]) / steps
  const ts: number[] = [tSpan[0]]
  const ys: number[][] = [y0.slice()]
  let y = y0.slice()
  let t = tSpan[0]
  for (let i = 0; i < steps; i++) {
    const k1 = deriv(t, y)
    const k2 = deriv(t + dt / 2, y.map((v, j) => v + dt / 2 * k1[j]))
    const k3 = deriv(t + dt / 2, y.map((v, j) => v + dt / 2 * k2[j]))
    const k4 = deriv(t + dt, y.map((v, j) => v + dt * k3[j]))
    y = y.map((v, j) => v + (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]))
    t = tSpan[0] + (i + 1) * dt
    ts.push(parseFloat(t.toFixed(6)))
    ys.push(y.slice())
  }
  return { t: ts, y: ys }
}

interface ODETemplate {
  id: string
  name: string
  category: string
  vars: string[]
  params: { key: string; label: string; value: number; min: number; max: number; step: number }[]
  tSpan: [number, number]
  y0: number[]
  deriv: (p: Record<string, number>) => ODEDerivFn
}

const ODE_TEMPLATES: ODETemplate[] = [
  {
    id: 'sir', name: 'SIR Epidemic', category: 'Epidemiology',
    vars: ['S', 'I', 'R'],
    params: [
      { key: 'beta', label: 'beta', value: 0.3, min: 0.01, max: 2, step: 0.01 },
      { key: 'gamma', label: 'gamma', value: 0.1, min: 0.01, max: 1, step: 0.01 },
      { key: 'N', label: 'N', value: 1000, min: 100, max: 100000, step: 100 },
    ],
    tSpan: [0, 160], y0: [990, 10, 0],
    deriv: (p) => (_t, y) => {
      const [S, I] = y; const N = p.N
      const dS = -p.beta * S * I / N
      const dI = p.beta * S * I / N - p.gamma * I
      const dR = p.gamma * I
      return [dS, dI, dR]
    },
  },
  {
    id: 'seir', name: 'SEIR Epidemic', category: 'Epidemiology',
    vars: ['S', 'E', 'I', 'R'],
    params: [
      { key: 'beta', label: 'beta', value: 0.5, min: 0.01, max: 2, step: 0.01 },
      { key: 'sigma', label: 'sigma', value: 0.2, min: 0.01, max: 1, step: 0.01 },
      { key: 'gamma', label: 'gamma', value: 0.1, min: 0.01, max: 1, step: 0.01 },
    ],
    tSpan: [0, 200], y0: [990, 0, 10, 0],
    deriv: (p) => (_t, y) => {
      const [S, E, I] = y; const N = 1000
      return [-p.beta * S * I / N, p.beta * S * I / N - p.sigma * E, p.sigma * E - p.gamma * I, p.gamma * I]
    },
  },
  {
    id: 'lotka-volterra', name: 'Lotka-Volterra', category: 'Population Dynamics',
    vars: ['Prey', 'Predator'],
    params: [
      { key: 'a', label: 'alpha', value: 1.1, min: 0.1, max: 3, step: 0.1 },
      { key: 'b', label: 'beta', value: 0.4, min: 0.1, max: 2, step: 0.1 },
      { key: 'd', label: 'delta', value: 0.1, min: 0.01, max: 1, step: 0.01 },
      { key: 'g', label: 'gamma', value: 0.4, min: 0.1, max: 2, step: 0.1 },
    ],
    tSpan: [0, 50], y0: [40, 9],
    deriv: (p) => (_t, y) => {
      const [x, yy] = y
      return [p.a * x - p.b * x * yy, p.d * x * yy - p.g * yy]
    },
  },
  {
    id: 'pk-2comp', name: 'PK Two-Compartment', category: 'Pharmacokinetics',
    vars: ['Central', 'Peripheral'],
    params: [
      { key: 'k10', label: 'k10', value: 0.15, min: 0.01, max: 1, step: 0.01 },
      { key: 'k12', label: 'k12', value: 0.3, min: 0.01, max: 1, step: 0.01 },
      { key: 'k21', label: 'k21', value: 0.1, min: 0.01, max: 1, step: 0.01 },
    ],
    tSpan: [0, 48], y0: [100, 0],
    deriv: (p) => (_t, y) => {
      const [c, pe] = y
      return [-(p.k10 + p.k12) * c + p.k21 * pe, p.k12 * c - p.k21 * pe]
    },
  },
  {
    id: 'gene-toggle', name: 'Genetic Toggle Switch', category: 'Systems Biology',
    vars: ['Protein A', 'Protein B'],
    params: [
      { key: 'a1', label: 'alpha1', value: 3, min: 0.5, max: 10, step: 0.5 },
      { key: 'a2', label: 'alpha2', value: 3, min: 0.5, max: 10, step: 0.5 },
      { key: 'n', label: 'n (Hill)', value: 2, min: 1, max: 5, step: 0.5 },
      { key: 'dg', label: 'degradation', value: 1, min: 0.1, max: 3, step: 0.1 },
    ],
    tSpan: [0, 20], y0: [0.1, 3],
    deriv: (p) => (_t, y) => {
      const [a, b] = y
      return [p.a1 / (1 + Math.pow(b, p.n)) - p.dg * a, p.a2 / (1 + Math.pow(a, p.n)) - p.dg * b]
    },
  },
  {
    id: 'hodgkin-huxley-simple', name: 'FitzHugh-Nagumo Neuron', category: 'Neuroscience',
    vars: ['V (membrane)', 'w (recovery)'],
    params: [
      { key: 'I', label: 'I_ext', value: 0.5, min: 0, max: 2, step: 0.05 },
      { key: 'a', label: 'a', value: 0.7, min: 0, max: 2, step: 0.1 },
      { key: 'b', label: 'b', value: 0.8, min: 0, max: 2, step: 0.1 },
      { key: 'tau', label: 'tau', value: 12.5, min: 1, max: 30, step: 0.5 },
    ],
    tSpan: [0, 100], y0: [-1, 1],
    deriv: (p) => (_t, y) => {
      const [v, w] = y
      return [v - v * v * v / 3 - w + p.I, (v + p.a - p.b * w) / p.tau]
    },
  },
]

const ODE_CATEGORIES = [
  { name: 'Epidemiology', ids: ['sir', 'seir'] },
  { name: 'Population Dynamics', ids: ['lotka-volterra'] },
  { name: 'Pharmacokinetics', ids: ['pk-2comp'] },
  { name: 'Systems Biology', ids: ['gene-toggle'] },
  { name: 'Neuroscience', ids: ['hodgkin-huxley-simple'] },
]

const ODE_COLORS = ['#5B8DB8', '#8B7EAF', '#6BA594', '#C4956A']

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
  // Pharmacokinetics
  { id: 'pk-one-compartment', name: 'IV Bolus (1-Comp)', expr: '2*exp(-0.15*x)', xMin: 0, xMax: 48, category: 'Pharmacokinetics' },
  { id: 'pk-two-compartment', name: 'IV Bolus (2-Comp)', expr: '1.5*exp(-0.4*x)+0.5*exp(-0.05*x)', xMin: 0, xMax: 72, category: 'Pharmacokinetics' },
  { id: 'pk-oral', name: 'Oral Absorption', expr: '(100*1.5)/(50*(1.5-0.15))*(exp(-0.15*x)-exp(-1.5*x))', xMin: 0, xMax: 48, category: 'Pharmacokinetics' },
  { id: 'pk-biexp', name: 'Biexponential Decay', expr: '80*exp(-0.5*x)+20*exp(-0.02*x)', xMin: 0, xMax: 100, category: 'Pharmacokinetics' },
  { id: 'pk-infusion', name: 'IV Infusion', expr: '(500/0.15/50)*(1-exp(-0.15*x))', xMin: 0, xMax: 48, category: 'Pharmacokinetics' },
  { id: 'pk-repeated', name: 'Repeated Dosing SS', expr: '2*exp(-0.1*x)/(1-exp(-0.1*12))', xMin: 0, xMax: 12, category: 'Pharmacokinetics' },
  // Enzyme Kinetics
  { id: 'michaelis-menten', name: 'Michaelis-Menten', expr: '100*x/(10+x)', xMin: 0, xMax: 100, category: 'Enzyme Kinetics' },
  { id: 'lineweaver-burk', name: 'Lineweaver-Burk', expr: '10/(100*x)+1/100', xMin: 0.01, xMax: 2, category: 'Enzyme Kinetics' },
  { id: 'competitive-inhib', name: 'Competitive Inhibition', expr: '100*x/(10*(1+5/3)+x)', xMin: 0, xMax: 100, category: 'Enzyme Kinetics' },
  { id: 'allosteric', name: 'Allosteric (Hill n=3)', expr: '100*pow(x,3)/(pow(10,3)+pow(x,3))', xMin: 0, xMax: 30, category: 'Enzyme Kinetics' },
  // Dose-Response
  { id: 'hill-equation', name: 'Hill Equation', expr: '100*pow(x,2)/(pow(10,2)+pow(x,2))', xMin: 0, xMax: 50, category: 'Dose-Response' },
  { id: 'emax-model', name: 'Emax Model', expr: '5+95*x/(25+x)', xMin: 0, xMax: 200, category: 'Dose-Response' },
  { id: 'sigmoid-emax', name: 'Sigmoidal Emax', expr: '5+95*pow(x,1.5)/(pow(25,1.5)+pow(x,1.5))', xMin: 0, xMax: 200, category: 'Dose-Response' },
  { id: 'log-logistic', name: 'Log-Logistic (4PL)', expr: '5+(95-5)/(1+pow(x/25,-2))', xMin: 0.1, xMax: 500, category: 'Dose-Response' },
  { id: 'biphasic-dose', name: 'Biphasic Response', expr: '100*x*exp(-x/20)/(10+x)', xMin: 0, xMax: 100, category: 'Dose-Response' },
  // Systems Biology
  { id: 'logistic-growth', name: 'Logistic Growth', expr: '1000/(1+99*exp(-0.1*x))', xMin: 0, xMax: 100, category: 'Population & Growth' },
  { id: 'gompertz-growth', name: 'Gompertz Growth', expr: '1000*exp(log(10/1000)*exp(-0.05*x))', xMin: 0, xMax: 120, category: 'Population & Growth' },
  { id: 'exponential-growth', name: 'Exponential Growth', expr: '10*exp(0.05*x)', xMin: 0, xMax: 80, category: 'Population & Growth' },
  { id: 'decay-chain', name: 'Radioactive Decay Chain', expr: '100*0.1/(0.1-0.05)*(exp(-0.05*x)-exp(-0.1*x))', xMin: 0, xMax: 60, category: 'Population & Growth' },
  // Signal & Waveform
  { id: 'damped-osc', name: 'Damped Oscillation', expr: 'exp(-0.1*x)*sin(x)', xMin: 0, xMax: 40, category: 'Signal & Waveform' },
  { id: 'beat-freq', name: 'Beat Frequency', expr: 'sin(10*x)*sin(0.5*x)', xMin: 0, xMax: 20, category: 'Signal & Waveform' },
  { id: 'chirp', name: 'Chirp Signal', expr: 'sin(x*x/10)', xMin: 0, xMax: 25, category: 'Signal & Waveform' },
  { id: 'gaussian-pulse', name: 'Gaussian Pulse', expr: 'exp(-x*x/2)*cos(5*x)', xMin: -5, xMax: 5, category: 'Signal & Waveform' },
  { id: 'sinc-fn', name: 'Sinc Function', expr: 'sinc(x)', xMin: -10, xMax: 10, category: 'Signal & Waveform' },
  // Probability & Statistics
  { id: 'normal-pdf', name: 'Normal Distribution', expr: 'exp(-x*x/2)/sqrt(2*pi)', xMin: -4, xMax: 4, category: 'Statistics' },
  { id: 'lognormal', name: 'Log-Normal PDF', expr: 'exp(-pow(log(x),2)/2)/(x*sqrt(2*pi))', xMin: 0.01, xMax: 6, category: 'Statistics' },
  { id: 'sigmoid-fn', name: 'Sigmoid / Logistic', expr: 'sigmoid(x)', xMin: -8, xMax: 8, category: 'Statistics' },
  { id: 'erf-fn', name: 'Error Function', expr: 'erf(x)', xMin: -3, xMax: 3, category: 'Statistics' },
  // Mathematical
  { id: 'gamma-fn', name: 'Gamma Function', expr: 'gamma(x)', xMin: 0.1, xMax: 5, category: 'Mathematical' },
  { id: 'tanh-fn', name: 'Hyperbolic Tangent', expr: 'tanh(x)', xMin: -5, xMax: 5, category: 'Mathematical' },
  { id: 'bessel-approx', name: 'Bessel J0 Approx', expr: 'cos(x-pi/4)/sqrt(x)*sqrt(2/pi)', xMin: 1, xMax: 30, category: 'Mathematical' },
  { id: 'heaviside-step', name: 'Heaviside Step', expr: 'step(x)', xMin: -5, xMax: 5, category: 'Mathematical' },
]

const PRESET_CATEGORIES = [
  { name: 'Pharmacokinetics', ids: ['pk-one-compartment','pk-two-compartment','pk-oral','pk-biexp','pk-infusion','pk-repeated'] },
  { name: 'Enzyme Kinetics', ids: ['michaelis-menten','lineweaver-burk','competitive-inhib','allosteric'] },
  { name: 'Dose-Response', ids: ['hill-equation','emax-model','sigmoid-emax','log-logistic','biphasic-dose'] },
  { name: 'Population & Growth', ids: ['logistic-growth','gompertz-growth','exponential-growth','decay-chain'] },
  { name: 'Signal & Waveform', ids: ['damped-osc','beat-freq','chirp','gaussian-pulse','sinc-fn'] },
  { name: 'Statistics', ids: ['normal-pdf','lognormal','sigmoid-fn','erf-fn'] },
  { name: 'Mathematical', ids: ['gamma-fn','tanh-fn','bessel-approx','heaviside-step'] },
]

// Monochrome overlay palette — distinguishable shades without category color.
const OVERLAY_COLORS = ['#7BA7B8', '#A89B6E', '#8598AD']

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
  const [showLibrary, setShowLibrary] = useState(false)
  const [copied, setCopied] = useState(false)
  const [chartCopied, setChartCopied] = useState(false)
  // Chart host ref — passed to plotExport for clipboard-as-image + PNG export.
  const chartHostRef = useRef<HTMLDivElement | null>(null)

  // ODE mode
  const [mode, setMode] = useState<'equation' | 'ode'>('equation')
  const [odeTemplate, setOdeTemplate] = useState(ODE_TEMPLATES[0].id)
  const [odeParams, setOdeParams] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {}
    ODE_TEMPLATES[0].params.forEach(pp => { p[pp.key] = pp.value })
    return p
  })
  const [odeResult, setOdeResult] = useState<{ t: number[]; y: number[][] } | null>(null)
  const [showOdeLibrary, setShowOdeLibrary] = useState(false)
  const [odeAutoSolve, setOdeAutoSolve] = useState(true)
  const [showDerivative, setShowDerivative] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    // Single-pass min/max/sum — spreading ys into Math.min/max could overflow
    // the argument-list stack when high-resolution plots exceed ~10k samples.
    let mn = Infinity, mx = -Infinity, s = 0
    for (let i = 0; i < ys.length; i++) {
      const v = ys[i]
      if (v < mn) mn = v
      if (v > mx) mx = v
      s += v
    }
    return {
      min: mn,
      max: mx,
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

  const copyStats = useCallback(() => {
    if (!stats) return
    const lines = [`Expression: ${expr}`, `Range: [${xMin}, ${xMax}]`, `Min: ${stats.min}`, `Max: ${stats.max}`, `Mean: ${stats.mean}`, `Points: ${stats.points}`]
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }, [stats, expr, xMin, xMax])

  const copyChartImage = useCallback(async () => {
    const ok = await copyPlotBlob(chartHostRef.current)
    if (ok) {
      setChartCopied(true)
      setTimeout(() => setChartCopied(false), 2000)
    }
  }, [])

  const downloadChartImage = useCallback(async () => {
    const label = expr.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'equation_plot'
    await downloadPlotPng(chartHostRef.current, label)
  }, [expr])

  // ── Render helpers ─────────────────────────────────────────────
  const fmt = (n: number) => {
    if (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.001 && n !== 0)) return n.toExponential(3)
    return n.toFixed(4).replace(/\.?0+$/, '')
  }

  // ── 4-quadrant detection ───────────────────────────────────────
  const quadrantInfo = useMemo(() => {
    let xMn = Infinity, xMx = -Infinity, yMn = Infinity, yMx = -Infinity
    for (const p of mainData) {
      if (isFinite(p.y)) { if (p.y < yMn) yMn = p.y; if (p.y > yMx) yMx = p.y }
      if (isFinite(p.x)) { if (p.x < xMn) xMn = p.x; if (p.x > xMx) xMx = p.x }
    }
    const hasNegX = xMn < 0, hasPosX = xMx > 0, hasNegY = yMn < 0, hasPosY = yMx > 0
    const showXRef = hasNegY && hasPosY
    const showYRef = hasNegX && hasPosX
    return { xMn, xMx, yMn, yMx, showXRef, showYRef }
  }, [mainData])

  // ── ODE helpers ────────────────────────────────────────────────
  const activeODE = useMemo(() => ODE_TEMPLATES.find(t => t.id === odeTemplate) || ODE_TEMPLATES[0], [odeTemplate])

  const selectODE = useCallback((id: string) => {
    setOdeTemplate(id)
    const tmpl = ODE_TEMPLATES.find(t => t.id === id)!
    const p: Record<string, number> = {}
    tmpl.params.forEach(pp => { p[pp.key] = pp.value })
    setOdeParams(p)
    setOdeResult(null)
    setShowOdeLibrary(false)
  }, [])

  const runODE = useCallback(() => {
    const derivFn = activeODE.deriv(odeParams)
    const result = rk4(derivFn, activeODE.y0, activeODE.tSpan, 500)
    setOdeResult(result)
  }, [activeODE, odeParams])

  const odeChartData = useMemo(() => {
    if (!odeResult) return []
    return odeResult.t.map((t, i) => {
      const row: Record<string, number> = { t }
      activeODE.vars.forEach((v, j) => { row[v] = odeResult.y[i][j] })
      return row
    })
  }, [odeResult, activeODE])

  // Auto-solve ODE when parameters change
  const odeAutoRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!odeAutoSolve || mode !== 'ode') return
    if (odeAutoRef.current) clearTimeout(odeAutoRef.current)
    odeAutoRef.current = setTimeout(() => { runODE() }, 200)
    return () => { if (odeAutoRef.current) clearTimeout(odeAutoRef.current) }
  }, [odeAutoSolve, odeParams, odeTemplate, mode]) // eslint-disable-line

  // Numerical derivative of main equation
  const derivativeData = useMemo(() => {
    if (!showDerivative || mainData.length < 3) return []
    const h = (xMax - xMin) / 300
    return mainData.map((p, i) => {
      if (i === 0 || i === mainData.length - 1) return { x: p.x, dy: NaN }
      const dy = (mainData[i + 1].y - mainData[i - 1].y) / (2 * h)
      return { x: p.x, dy: isFinite(dy) ? dy : NaN }
    })
  }, [showDerivative, mainData, xMin, xMax])

  // Merge derivative into chart data
  const chartDataWithDerivative = useMemo(() => {
    if (!showDerivative || derivativeData.length === 0) return chartData
    return chartData.map((row, i) => ({
      ...row,
      dy: derivativeData[i]?.dy ?? NaN,
    }))
  }, [chartData, derivativeData, showDerivative])

  const exportOdeCSV = useCallback(() => {
    if (!odeResult) return
    const header = ['t', ...activeODE.vars].join(',') + '\n'
    const rows = odeResult.t.map((t, i) => [t, ...activeODE.vars.map((_v, j) => odeResult.y[i][j])].join(',')).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `ode_${odeTemplate}.csv`; a.click(); URL.revokeObjectURL(url)
  }, [odeResult, activeODE, odeTemplate])

  // ── Inline styles (MC-matching) ─────────────────────────────
  const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'border-color 0.15s, background 0.15s' }
  const inp: React.CSSProperties = { width: 64, padding: '3px 6px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--color-text)', outline: 'none', transition: 'border-color 0.15s' }
  const card: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', transition: 'border-color 0.15s, background 0.15s' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 }}>
      {/* ── Mode toggle ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => setMode('equation')} style={{ ...chip, fontWeight: mode === 'equation' ? 700 : 400, borderColor: mode === 'equation' ? 'var(--color-text)' : undefined }}>f(x) Equation</button>
        <button onClick={() => setMode('ode')} style={{ ...chip, fontWeight: mode === 'ode' ? 700 : 400, borderColor: mode === 'ode' ? 'var(--color-text)' : undefined }}>ODE Systems</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{mode === 'equation' ? '32 presets + custom expressions' : '6 ODE templates with RK4 solver'}</span>
      </div>

      {mode === 'equation' ? (<>
      {/* ── Equation toolbar ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button style={{ ...chip, fontWeight: 600 }} onClick={() => setShowLibrary(true)}>Library</button>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)', fontFamily: 'monospace' }}>f(x) =</span>
        <input ref={inputRef} type="text" value={expr} onChange={e => setExpr(e.target.value)} onKeyDown={e => e.key === 'Enter' && handlePlot()} style={{ ...inp, flex: 1, minWidth: 120 }} placeholder="sin(x)*exp(-0.1*x)" spellCheck={false} />
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--color-text)', color: 'var(--color-bg)', border: 'none', cursor: 'pointer' }} onClick={handlePlot}>
          <FiPlay size={12} /> Plot
        </button>
      </div>

      {/* ── Parameters row ───────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>x min</label>
          <input type="number" style={inp} value={xMin} onChange={e => setXMin(parseFloat(e.target.value) || 0)} />
          <input type="range" min={-100} max={0} step={0.5} value={xMin} onChange={e => setXMin(parseFloat(e.target.value))} style={{ width: 60, accentColor: 'var(--color-text)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>x max</label>
          <input type="number" style={inp} value={xMax} onChange={e => setXMax(parseFloat(e.target.value) || 0)} />
          <input type="range" min={0} max={100} step={0.5} value={xMax} onChange={e => setXMax(parseFloat(e.target.value))} style={{ width: 60, accentColor: 'var(--color-text)' }} />
        </div>
        <button onClick={resetRange} style={{ ...chip, fontWeight: 400 }}><FiRefreshCw size={11} /> Reset</button>
        <button onClick={() => setShowDerivative(d => !d)} style={{ ...chip, fontWeight: showDerivative ? 600 : 400, borderColor: showDerivative ? 'var(--color-text)' : undefined }}>
          dy/dx
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowOverlays(p => !p)} style={{ ...chip, fontWeight: 400 }}>
          <FiLayers size={11} /> Overlays ({overlays.filter(o => o.enabled).length}/3)
        </button>
        <button onClick={addOverlay} disabled={overlays.length >= 3} style={{ ...chip, fontWeight: 400, opacity: overlays.length >= 3 ? 0.3 : 1 }}>
          <FiPlus size={11} /> Save Overlay
        </button>
      </div>

      {/* ── Overlay chips ────────────────────────────────────────── */}
      {showOverlays && overlays.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {overlays.map((o, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 5, border: `1px solid ${OVERLAY_COLORS[idx]}`, background: 'var(--glass-bg)', fontSize: 11 }}>
              <input type="checkbox" checked={o.enabled} onChange={() => toggleOverlay(idx)} />
              <span style={{ fontFamily: 'monospace', color: OVERLAY_COLORS[idx], maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.expr}</span>
              <button onClick={() => removeOverlay(idx)} style={{ color: 'var(--color-text-muted)', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}><FiTrash2 size={11} /></button>
            </div>
          ))}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────── */}
      {error && (
        <div style={{ fontSize: 11, padding: '5px 10px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
          Parse error: {error}
        </div>
      )}

      {/* ── Chart ──────────────────────────────────────────────────
          Wrapped in PublicationFigure so the user gets the same
          theme/CB/PDF/SVG/4×PNG controls as DataVisualization. */}
      <div ref={chartHostRef} style={{ flex: 1, minHeight: 0, border: '1px solid var(--glass-border)', borderRadius: 8, padding: 10, background: 'var(--glass-bg)' }}>
        {chartData.length > 0 ? (
        <PublicationFigure
          title={`f(x) = ${expr}`}
          subtitle={overlays.filter(o => o.enabled).length > 0 ? `with ${overlays.filter(o => o.enabled).length} overlay(s)` : undefined}
          exportName={`equation-${(expr || 'plot').replace(/[^\w-]+/g, '_')}`}
        >
          <ResponsiveContainer width="100%" height={Math.max(280, (chartHostRef.current?.clientHeight || 320) - 80)}>
            <LineChart data={chartDataWithDerivative} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="x" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickFormatter={v => typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toExponential(0) : String(Math.round(v * 100) / 100)) : v} stroke="var(--glass-border)" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickFormatter={v => typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toExponential(0) : String(Math.round(v * 100) / 100)) : v} stroke="var(--glass-border)" width={56} />
              <Tooltip contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 6, fontSize: 11, color: 'var(--color-text)' }} cursor={{ stroke: 'var(--color-text-muted)', strokeDasharray: '4 4' }} labelStyle={{ color: 'var(--color-text-muted)' }} formatter={(value: unknown, name: unknown) => { const n = typeof value === 'number' ? value : Number(value); return [isFinite(n) ? n.toFixed(4) : 'NaN', name === 'dy' ? "f'(x)" : ''] }} labelFormatter={(label: unknown) => `x = ${label}`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {quadrantInfo.showXRef && <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeDasharray="4 4" strokeOpacity={0.4} />}
              {quadrantInfo.showYRef && <ReferenceLine x={0} stroke="var(--color-text-muted)" strokeDasharray="4 4" strokeOpacity={0.4} />}
              <Line type="monotone" dataKey="y" stroke="var(--color-text)" strokeWidth={1.8} strokeOpacity={0.7} dot={false} name={expr} isAnimationActive={false} />
              {showDerivative && <Line type="monotone" dataKey="dy" stroke="#C4956A" strokeWidth={1.2} strokeDasharray="4 2" strokeOpacity={0.6} dot={false} name="f'(x)" isAnimationActive={false} connectNulls={false} />}
              {overlays.map((o, idx) => o.enabled ? (
                <Line key={idx} type="monotone" dataKey={`o${idx}`} stroke={OVERLAY_COLORS[idx]} strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.6} dot={false} name={o.expr} isAnimationActive={false} connectNulls={false} />
              ) : null)}
              <Brush dataKey="x" height={14} stroke="var(--color-text-muted)" fill="var(--glass-bg)" travellerWidth={6} />
            </LineChart>
          </ResponsiveContainer>
        </PublicationFigure>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--color-text-muted)' }}>
            Enter an expression above to plot, or browse the Library
          </div>
        )}
      </div>

      {/* ── Stats + export ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {stats && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--glass-border)', background: 'var(--glass-bg)' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>Min: <strong style={{ color: 'var(--color-text)' }}>{fmt(stats.min)}</strong></span>
            <span style={{ color: 'var(--color-text-muted)' }}>Max: <strong style={{ color: 'var(--color-text)' }}>{fmt(stats.max)}</strong></span>
            <span style={{ color: 'var(--color-text-muted)' }}>Mean: <strong style={{ color: 'var(--color-text)' }}>{fmt(stats.mean)}</strong></span>
            <span style={{ color: 'var(--color-text-muted)' }}>Pts: <strong style={{ color: 'var(--color-text)' }}>{stats.points}</strong></span>
          </div>
        )}
        {history.length > 0 && <button onClick={clearHistory} style={{ ...chip, fontWeight: 400, fontSize: 10 }}><FiTrash2 size={10} /> Clear History</button>}
        <div style={{ flex: 1 }} />
        <button onClick={copyStats} disabled={!stats} style={{ ...chip, fontWeight: 400, opacity: stats ? 1 : 0.3 }}>
          {copied ? 'Copied!' : <><FiCopy size={11} /> Copy Stats</>}
        </button>
        <button onClick={copyChartData} disabled={mainData.length === 0} style={{ ...chip, fontWeight: 400, opacity: mainData.length > 0 ? 1 : 0.3 }}>
          <FiCopy size={11} /> Copy Data
        </button>
        <button onClick={copyChartImage} disabled={mainData.length === 0} style={{ ...chip, fontWeight: 400, opacity: mainData.length > 0 ? 1 : 0.3 }} title="Copy chart as image to clipboard">
          {chartCopied ? <><FiCheck size={11} /> Copied</> : <><FiImage size={11} /> Copy Plot</>}
        </button>
        <button onClick={downloadChartImage} disabled={mainData.length === 0} style={{ ...chip, fontWeight: 400, opacity: mainData.length > 0 ? 1 : 0.3 }} title="Download chart as PNG">
          <FiImage size={11} /> PNG
        </button>
        <button onClick={exportCSV} disabled={mainData.length === 0} style={{ ...chip, fontWeight: 400, opacity: mainData.length > 0 ? 1 : 0.3 }}>
          <FiDownload size={11} /> CSV
        </button>
      </div>

      {/* ── Library overlay ──────────────────────────────────────── */}
      {showLibrary && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => { if (e.target === e.currentTarget) setShowLibrary(false) }}>
          <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 10, width: 620, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto', padding: '20px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>Equation Library</h2>
              <button style={chip} onClick={() => setShowLibrary(false)}>Close</button>
            </div>
            {PRESET_CATEGORIES.map(cat => (
              <div key={cat.name} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 6 }}>{cat.name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 6 }}>
                  {cat.ids.map(id => {
                    const p = PRESETS.find(q => q.id === id)
                    if (!p) return null
                    const isActive = expr === p.expr
                    return (
                      <div key={id} style={{ ...card, ...(isActive ? { borderColor: 'var(--color-text)' } : {}) }} onClick={() => { loadPreset(p); setShowLibrary(false) }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.expr}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {history.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 6 }}>Recent History</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 6 }}>
                  {history.slice(0, 8).map((h, i) => (
                    <div key={i} style={card} onClick={() => { restoreHistory(h); setShowLibrary(false) }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.expr}</div>
                      <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2 }}>[{h.xMin}, {h.xMax}]</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </>) : (<>
      {/* ══════════════════════════════════════════════════════════ */}
      {/*  ODE Systems Mode                                        */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* ODE toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button style={{ ...chip, fontWeight: 600 }} onClick={() => setShowOdeLibrary(true)}>Library</button>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{activeODE.name}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flex: 1 }}>
          Variables: {activeODE.vars.join(', ')}
        </span>
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--color-text)', color: 'var(--color-bg)', border: 'none', cursor: 'pointer' }} onClick={runODE}>
          <FiPlay size={12} /> Solve
        </button>
      </div>

      {/* ODE parameters — reactive sliders */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {activeODE.params.map(p => {
          const val = odeParams[p.key] ?? p.value
          return (
            <div key={p.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>{p.label}</label>
                <input type="number" style={{ ...inp, width: 56, fontSize: 10 }} value={val} min={p.min} max={p.max} step={p.step}
                  onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setOdeParams(prev => ({ ...prev, [p.key]: v })) }} />
              </div>
              <input type="range" min={p.min} max={p.max} step={p.step} value={val}
                onChange={e => setOdeParams(prev => ({ ...prev, [p.key]: parseFloat(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--color-text)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 8, color: 'var(--color-text-muted)', opacity: 0.5 }}>{p.min}</span>
                <span style={{ fontSize: 8, color: 'var(--color-text-muted)', opacity: 0.5 }}>{p.max}</span>
              </div>
            </div>
          )
        })}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 'auto' }}>
          <button onClick={() => setOdeAutoSolve(a => !a)} style={{ ...chip, fontWeight: odeAutoSolve ? 600 : 400, borderColor: odeAutoSolve ? 'var(--color-text)' : undefined, fontSize: 10 }}>
            <FiRefreshCw size={10} /> Auto
          </button>
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textAlign: 'center' }}>
            t: [{activeODE.tSpan[0]}, {activeODE.tSpan[1]}]
          </span>
        </div>
      </div>

      {/* ODE Chart — wrapped in PublicationFigure */}
      <div ref={chartHostRef} style={{ flex: 1, minHeight: 0, border: '1px solid var(--glass-border)', borderRadius: 8, padding: 10, background: 'var(--glass-bg)' }}>
        {odeChartData.length > 0 ? (
          <PublicationFigure
            title={`ODE: ${activeODE.name}`}
            subtitle={`State variables: ${activeODE.vars.join(', ')} · t ∈ [${activeODE.tSpan[0]}, ${activeODE.tSpan[1]}]`}
            caption={`Solved via Runge-Kutta-Fehlberg (RKF45). State trajectories for ${activeODE.vars.join(', ')}.`}
            exportName={`ode-${activeODE.id}`}
          >
            <ResponsiveContainer width="100%" height={Math.max(280, (chartHostRef.current?.clientHeight || 320) - 80)}>
              <LineChart data={odeChartData} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" label={{ value: 'Time', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" width={56} />
                <Tooltip contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 6, fontSize: 11, color: 'var(--color-text)' }} cursor={{ stroke: 'var(--color-text-muted)', strokeDasharray: '4 4' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {activeODE.vars.map((v, i) => (
                  <Line key={v} type="monotone" dataKey={v} stroke={ODE_COLORS[i % ODE_COLORS.length]} strokeWidth={1.5} strokeOpacity={0.7} dot={false} name={v} isAnimationActive={false} />
                ))}
                <Brush dataKey="t" height={14} stroke="var(--color-text-muted)" fill="var(--glass-bg)" travellerWidth={6} />
              </LineChart>
            </ResponsiveContainer>
          </PublicationFigure>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--color-text-muted)' }}>
            Select an ODE template from the Library and click Solve
          </div>
        )}
      </div>

      {/* ODE stats/export */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {odeResult && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--glass-border)', background: 'var(--glass-bg)' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>Steps: <strong style={{ color: 'var(--color-text)' }}>{odeResult.t.length}</strong></span>
            <span style={{ color: 'var(--color-text-muted)' }}>dt: <strong style={{ color: 'var(--color-text)' }}>{((activeODE.tSpan[1] - activeODE.tSpan[0]) / 500).toFixed(4)}</strong></span>
            {activeODE.vars.map((v, j) => {
              // Single-pass max (ODE results can hit 10k+ steps — spreading
              // would overflow the argument-list call stack).
              let mx = -Infinity
              for (let k = 0; k < odeResult.y.length; k++) {
                const rv = odeResult.y[k][j]
                if (rv > mx) mx = rv
              }
              if (!Number.isFinite(mx)) mx = 0
              return <span key={v} style={{ color: 'var(--color-text-muted)' }}>{v} max: <strong style={{ color: 'var(--color-text)' }}>{mx.toFixed(1)}</strong></span>
            })}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={exportOdeCSV} disabled={!odeResult} style={{ ...chip, fontWeight: 400, opacity: odeResult ? 1 : 0.3 }}>
          <FiDownload size={11} /> CSV
        </button>
      </div>

      {/* ODE Library overlay */}
      {showOdeLibrary && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => { if (e.target === e.currentTarget) setShowOdeLibrary(false) }}>
          <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 10, width: 520, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto', padding: '20px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>ODE Systems Library</h2>
              <button style={chip} onClick={() => setShowOdeLibrary(false)}>Close</button>
            </div>
            {ODE_CATEGORIES.map(cat => (
              <div key={cat.name} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 6 }}>{cat.name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                  {cat.ids.map(id => {
                    const tmpl = ODE_TEMPLATES.find(t => t.id === id)!
                    const isActive = odeTemplate === id
                    return (
                      <div key={id} style={{ ...card, ...(isActive ? { borderColor: 'var(--color-text)' } : {}) }} onClick={() => selectODE(id)}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>{tmpl.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>Variables: {tmpl.vars.join(', ')}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>)}
    </div>
  )
}
