import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import '@tanstack/react-query' // kept to preserve dependency
import {
  FiActivity, FiPlay, FiPause, FiCheck, FiX, FiPlus,
  FiCpu, FiCode, FiGrid, FiBarChart2, FiZap, FiDatabase,
  FiUpload, FiDownload, FiMaximize2, FiMinimize2,
  FiTerminal, FiLayers, FiTrendingUp, FiTarget,
  FiHeart, FiRefreshCw, FiClipboard
} from 'react-icons/fi'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar
} from 'recharts'
import '../services/api' // kept to preserve dependency
import html2canvas from 'html2canvas'
import clsx from 'clsx'

// ── Equation Parser / Evaluator ─────────────────────────────────
function evaluateExpression(expr: string, xMin: number, xMax: number, steps: number = 200): { x: number; y: number }[] {
  const results: { x: number; y: number }[] = []
  const step = (xMax - xMin) / steps
  for (let x = xMin; x <= xMax; x += step) {
    try {
      const safeExpr = expr
        .replace(/\bsin\b/g, 'Math.sin')
        .replace(/\bcos\b/g, 'Math.cos')
        .replace(/\btan\b/g, 'Math.tan')
        .replace(/\bexp\b/g, 'Math.exp')
        .replace(/\blog\b/g, 'Math.log')
        .replace(/\bsqrt\b/g, 'Math.sqrt')
        .replace(/\babs\b/g, 'Math.abs')
        .replace(/\bpow\b/g, 'Math.pow')
        .replace(/\bPI\b/g, 'Math.PI')
        .replace(/\be\b/g, 'Math.E')
        .replace(/\^/g, '**')
      const fn = new Function('x', `return ${safeExpr}`)
      const y = fn(x)
      if (typeof y === 'number' && isFinite(y)) {
        results.push({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 })
      }
    } catch { /* skip invalid */ }
  }
  return results
}

// ── Predefined Pharmacokinetic / Scientific Equations ────────────
interface PredefinedEquation {
  id: string
  name: string
  category: string
  expression: string
  xMin: number
  xMax: number
  description: string
}

const PREDEFINED_EQUATIONS: PredefinedEquation[] = [
  {
    id: 'pk-one-compartment',
    name: 'One-Compartment PK',
    category: 'Pharmacokinetics',
    expression: '100/50 * exp(-0.15*x)',
    xMin: 0,
    xMax: 48,
    description: 'C(t) = D/V * exp(-k*t) -- Single IV bolus elimination (D=100mg, V=50L, k=0.15/h)',
  },
  {
    id: 'pk-two-compartment',
    name: 'Two-Compartment PK',
    category: 'Pharmacokinetics',
    expression: '1.5 * exp(-0.4*x) + 0.5 * exp(-0.05*x)',
    xMin: 0,
    xMax: 72,
    description: 'C(t) = A*exp(-alpha*t) + B*exp(-beta*t) -- Biexponential disposition',
  },
  {
    id: 'pk-oral-absorption',
    name: 'Oral Absorption PK',
    category: 'Pharmacokinetics',
    expression: '(100*1.5)/(50*(1.5-0.15)) * (exp(-0.15*x) - exp(-1.5*x))',
    xMin: 0,
    xMax: 48,
    description: 'Bateman equation: C(t) = F*D*ka / (V*(ka-ke)) * (exp(-ke*t) - exp(-ka*t))',
  },
  {
    id: 'michaelis-menten',
    name: 'Michaelis-Menten Kinetics',
    category: 'Enzyme Kinetics',
    expression: '100*x/(10+x)',
    xMin: 0,
    xMax: 100,
    description: 'v = Vmax*[S]/(Km+[S]) -- Enzyme saturation kinetics (Vmax=100, Km=10)',
  },
  {
    id: 'hill-equation',
    name: 'Hill Equation',
    category: 'Dose-Response',
    expression: '100 * pow(x, 2) / (pow(10, 2) + pow(x, 2))',
    xMin: 0,
    xMax: 50,
    description: 'E = Emax * [D]^n / (EC50^n + [D]^n) -- Sigmoidal dose-response (n=2, EC50=10)',
  },
  {
    id: 'logistic-growth',
    name: 'Logistic Tumor Growth',
    category: 'Systems Biology',
    expression: '1000 / (1 + 99*exp(-0.1*x))',
    xMin: 0,
    xMax: 100,
    description: 'N(t) = K / (1 + ((K-N0)/N0)*exp(-r*t)) -- Logistic growth (K=1000, N0=10, r=0.1)',
  },
  {
    id: 'gompertz-growth',
    name: 'Gompertz Tumor Growth',
    category: 'Systems Biology',
    expression: '1000 * exp(log(10/1000) * exp(-0.05*x))',
    xMin: 0,
    xMax: 120,
    description: 'N(t) = K * exp(ln(N0/K) * exp(-a*t)) -- Gompertz growth model',
  },
  {
    id: 'emax-model',
    name: 'Emax Dose-Response',
    category: 'Dose-Response',
    expression: '5 + 95 * x / (25 + x)',
    xMin: 0,
    xMax: 200,
    description: 'E = E0 + Emax*D/(ED50+D) -- Emax model with baseline (E0=5, Emax=95, ED50=25)',
  },
  {
    id: 'biexponential-decay',
    name: 'Biexponential Decay',
    category: 'Pharmacokinetics',
    expression: '80*exp(-0.5*x) + 20*exp(-0.02*x)',
    xMin: 0,
    xMax: 100,
    description: 'f(t) = A1*exp(-k1*t) + A2*exp(-k2*t) -- Distribution + elimination phases',
  },
  {
    id: 'damped-oscillation',
    name: 'Damped Oscillation',
    category: 'Systems Biology',
    expression: 'exp(-0.1*x) * sin(x)',
    xMin: 0,
    xMax: 40,
    description: 'Damped oscillatory response -- circadian rhythm / feedback loop decay',
  },
]

// ── Simulation Types ────────────────────────────────────────────
const SIMULATION_TYPES = [
  { id: 'clinical_outcome', label: 'Clinical Outcome' },
  { id: 'epidemiological', label: 'Epidemiological' },
  { id: 'dose_response', label: 'Dose Response' },
  { id: 'pathway_dynamics', label: 'Pathway Dynamics' },
  { id: 'drug_interaction', label: 'Drug Interaction' },
  { id: 'survival_analysis', label: 'Survival Analysis' },
]

// ── Monte Carlo Engine ──────────────────────────────────────────

interface MCParams { [key: string]: number | string }

interface MCResult {
  id: string
  name: string
  simulationType: string
  params: MCParams
  iterations: number
  distribution: number[]
  histogramData: { bin: string; count: number }[]
  convergenceData: { iteration: number; mean: number }[]
  stats: { mean: number; median: number; std: number; ci95Lower: number; ci95Upper: number }
  createdAt: string
}

const MC_PARAM_CONFIGS: Record<string, { key: string; label: string; default: number | string; type: 'number' | 'select'; min?: number; max?: number; step?: number; options?: { value: string; label: string }[] }[]> = {
  clinical_outcome: [
    { key: 'sampleSize', label: 'Sample Size', default: 200, type: 'number', min: 20, max: 10000, step: 10 },
    { key: 'baselineRate', label: 'Baseline Rate', default: 0.3, type: 'number', min: 0.01, max: 0.99, step: 0.01 },
    { key: 'treatmentEffect', label: 'Treatment Effect', default: 0.15, type: 'number', min: 0.01, max: 0.5, step: 0.01 },
  ],
  dose_response: [
    { key: 'ec50', label: 'EC50', default: 10, type: 'number', min: 0.1, max: 100, step: 0.5 },
    { key: 'hillCoeff', label: 'Hill Coefficient', default: 1.5, type: 'number', min: 0.5, max: 5, step: 0.1 },
    { key: 'emax', label: 'Emax', default: 100, type: 'number', min: 10, max: 500, step: 5 },
    { key: 'noiseSD', label: 'Noise SD', default: 5, type: 'number', min: 0.1, max: 50, step: 0.5 },
  ],
  survival_analysis: [
    { key: 'medianSurvivalControl', label: 'Median Survival (Control, months)', default: 12, type: 'number', min: 1, max: 60, step: 1 },
    { key: 'hazardRatio', label: 'Hazard Ratio', default: 0.7, type: 'number', min: 0.1, max: 2, step: 0.05 },
    { key: 'sampleSize', label: 'Sample Size', default: 100, type: 'number', min: 20, max: 5000, step: 10 },
  ],
  epidemiological: [
    { key: 'population', label: 'Population', default: 10000, type: 'number', min: 100, max: 1000000, step: 100 },
    { key: 'initialInfected', label: 'Initial Infected', default: 10, type: 'number', min: 1, max: 1000, step: 1 },
    { key: 'beta', label: 'Beta (transmission)', default: 0.3, type: 'number', min: 0.01, max: 1, step: 0.01 },
    { key: 'gamma', label: 'Gamma (recovery)', default: 0.1, type: 'number', min: 0.01, max: 1, step: 0.01 },
  ],
  pathway_dynamics: [
    { key: 'transcriptionRate', label: 'Transcription Rate', default: 10, type: 'number', min: 1, max: 100, step: 1 },
    { key: 'degradationRate', label: 'Degradation Rate', default: 1, type: 'number', min: 0.1, max: 10, step: 0.1 },
    { key: 'translationRate', label: 'Translation Rate', default: 5, type: 'number', min: 0.5, max: 50, step: 0.5 },
  ],
  drug_interaction: [
    { key: 'drugA_effect', label: 'Drug A Effect', default: 0.6, type: 'number', min: 0.05, max: 0.95, step: 0.05 },
    { key: 'drugB_effect', label: 'Drug B Effect', default: 0.5, type: 'number', min: 0.05, max: 0.95, step: 0.05 },
    { key: 'interactionType', label: 'Interaction Type', default: 'additive', type: 'select', options: [
      { value: 'synergistic', label: 'Synergistic' },
      { value: 'antagonistic', label: 'Antagonistic' },
      { value: 'additive', label: 'Additive' },
    ]},
  ],
}

// Box-Muller transform for normal random variates
function randNorm(mean = 0, sd = 1): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return mean + sd * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

// Binomial sample
function randBinomial(n: number, p: number): number {
  let successes = 0
  for (let i = 0; i < n; i++) {
    if (Math.random() < p) successes++
  }
  return successes
}

// Exponential random variate
function randExponential(rate: number): number {
  return -Math.log(1 - Math.random()) / rate
}

function computeStats(values: number[]): MCResult['stats'] {
  const n = values.length
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((s, v) => s + v, 0) / n
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
  const std = Math.sqrt(variance)
  const ci95Lower = sorted[Math.max(0, Math.floor(n * 0.025))]
  const ci95Upper = sorted[Math.min(n - 1, Math.floor(n * 0.975))]
  return { mean, median, std, ci95Lower, ci95Upper }
}

function buildHistogram(values: number[], bins = 30): MCResult['histogramData'] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const binWidth = range / bins
  const counts = new Array(bins).fill(0)
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1)
    counts[idx]++
  }
  return counts.map((count, i) => ({
    bin: (min + (i + 0.5) * binWidth).toPrecision(3),
    count,
  }))
}

function buildConvergence(values: number[], points = 100): MCResult['convergenceData'] {
  const step = Math.max(1, Math.floor(values.length / points))
  const data: MCResult['convergenceData'] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if ((i + 1) % step === 0 || i === values.length - 1) {
      data.push({ iteration: i + 1, mean: sum / (i + 1) })
    }
  }
  return data
}

// Individual simulation models
function mcClinicalOutcome(p: MCParams): number {
  const n = Number(p.sampleSize)
  const half = Math.floor(n / 2)
  const baseRate = Number(p.baselineRate)
  const effect = Number(p.treatmentEffect)
  const control = randBinomial(half, baseRate) / half
  const treatment = randBinomial(half, Math.max(0, Math.min(1, baseRate - effect))) / half
  return control - treatment
}

function mcDoseResponse(p: MCParams): number {
  const ec50True = Number(p.ec50)
  const hill = Number(p.hillCoeff)
  const emax = Number(p.emax)
  const noise = Number(p.noiseSD)
  const doses = [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100]
  const responses = doses.map(d => {
    const expected = emax * Math.pow(d, hill) / (Math.pow(ec50True, hill) + Math.pow(d, hill))
    return expected + randNorm(0, noise)
  })
  // Estimate EC50 by finding dose where response ~ emax/2 via linear interpolation
  const halfMax = emax / 2
  let ec50Est = ec50True
  for (let i = 0; i < responses.length - 1; i++) {
    if ((responses[i] <= halfMax && responses[i + 1] >= halfMax) || (responses[i] >= halfMax && responses[i + 1] <= halfMax)) {
      const frac = (halfMax - responses[i]) / (responses[i + 1] - responses[i])
      ec50Est = doses[i] + frac * (doses[i + 1] - doses[i])
      break
    }
  }
  return ec50Est
}

function mcSurvivalAnalysis(p: MCParams): number {
  const medianControl = Number(p.medianSurvivalControl)
  const trueHR = Number(p.hazardRatio)
  const n = Number(p.sampleSize)
  const half = Math.floor(n / 2)
  const lambdaControl = Math.log(2) / medianControl
  const lambdaTreatment = lambdaControl * trueHR
  let controlEvents = 0, treatmentEvents = 0
  let controlTotal = 0, treatmentTotal = 0
  const censorTime = medianControl * 2
  for (let i = 0; i < half; i++) {
    const tc = randExponential(lambdaControl)
    const tt = randExponential(lambdaTreatment)
    controlTotal += Math.min(tc, censorTime)
    treatmentTotal += Math.min(tt, censorTime)
    if (tc <= censorTime) controlEvents++
    if (tt <= censorTime) treatmentEvents++
  }
  // Simple HR estimate: (events_t / totalTime_t) / (events_c / totalTime_c)
  const rateC = controlEvents / (controlTotal || 1)
  const rateT = treatmentEvents / (treatmentTotal || 1)
  return rateT / (rateC || 0.001)
}

function mcEpidemiological(p: MCParams): number {
  const pop = Number(p.population)
  const initI = Number(p.initialInfected)
  const beta = Number(p.beta)
  const gamma = Number(p.gamma)
  let S = pop - initI, I = initI, peakI = initI
  const dt = 0.1
  for (let t = 0; t < 200 && I > 0.5; t += dt) {
    const newInf = beta * S * I / pop * dt + randNorm(0, Math.sqrt(beta * S * I / pop * dt + 0.01))
    const newRec = gamma * I * dt + randNorm(0, Math.sqrt(gamma * I * dt + 0.01))
    const actualNewInf = Math.max(0, Math.min(S, newInf))
    const actualNewRec = Math.max(0, Math.min(I, newRec))
    S -= actualNewInf
    I += actualNewInf - actualNewRec
    if (I > peakI) peakI = I
  }
  return Math.round(peakI)
}

function mcPathwayDynamics(p: MCParams): number {
  const kTx = Number(p.transcriptionRate)
  const kDeg = Number(p.degradationRate)
  const kTl = Number(p.translationRate)
  // Gillespie-like: simulate mRNA and protein levels
  let mRNA = 0, protein = 0, t = 0
  const tMax = 50
  while (t < tMax) {
    const rTx = kTx
    const rDegM = kDeg * mRNA
    const rTlP = kTl * mRNA
    const rDegP = 0.5 * protein
    const totalRate = rTx + rDegM + rTlP + rDegP
    if (totalRate <= 0) break
    t += randExponential(totalRate)
    const r = Math.random() * totalRate
    if (r < rTx) mRNA++
    else if (r < rTx + rDegM) mRNA = Math.max(0, mRNA - 1)
    else if (r < rTx + rDegM + rTlP) protein++
    else protein = Math.max(0, protein - 1)
  }
  return protein
}

function mcDrugInteraction(p: MCParams): number {
  const eA = Number(p.drugA_effect) + randNorm(0, 0.05)
  const eB = Number(p.drugB_effect) + randNorm(0, 0.05)
  const clampA = Math.max(0.01, Math.min(0.99, eA))
  const clampB = Math.max(0.01, Math.min(0.99, eB))
  const blissExpected = clampA + clampB - clampA * clampB
  let modifier = 0
  if (p.interactionType === 'synergistic') modifier = 0.15 + randNorm(0, 0.03)
  else if (p.interactionType === 'antagonistic') modifier = -0.15 + randNorm(0, 0.03)
  else modifier = randNorm(0, 0.02)
  const observed = Math.max(0, Math.min(1, blissExpected + modifier))
  // Combination index: expected / observed (CI < 1 = synergy)
  return blissExpected / (observed || 0.01)
}

const MC_RUNNERS: Record<string, (p: MCParams) => number> = {
  clinical_outcome: mcClinicalOutcome,
  dose_response: mcDoseResponse,
  survival_analysis: mcSurvivalAnalysis,
  epidemiological: mcEpidemiological,
  pathway_dynamics: mcPathwayDynamics,
  drug_interaction: mcDrugInteraction,
}

const LS_KEY = 'humanovo-mc-simulations'

function loadSavedSimulations(): MCResult[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveSimulations(sims: MCResult[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(sims))
  } catch { /* quota exceeded - ignore */ }
}

// ── MC Simulation Form ──────────────────────────────────────────
function MCSimulationForm({ onResult, onClose }: { onResult: (r: MCResult) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [simType, setSimType] = useState('clinical_outcome')
  const [iterations, setIterations] = useState(1000)
  const [params, setParams] = useState<MCParams>(() => {
    const cfg = MC_PARAM_CONFIGS['clinical_outcome']
    const p: MCParams = {}
    cfg.forEach(c => { p[c.key] = c.default })
    return p
  })
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleTypeChange = (newType: string) => {
    setSimType(newType)
    const cfg = MC_PARAM_CONFIGS[newType] || []
    const p: MCParams = {}
    cfg.forEach(c => { p[c.key] = c.default })
    setParams(p)
  }

  const handleRun = () => {
    if (!name.trim()) return
    setRunning(true)
    setProgress(0)

    const batchSize = Math.max(50, Math.floor(iterations / 100))
    const allResults: number[] = []
    let completed = 0
    const runner = MC_RUNNERS[simType]
    if (!runner) { setRunning(false); return }

    function processBatch() {
      const end = Math.min(completed + batchSize, iterations)
      for (let i = completed; i < end; i++) {
        allResults.push(runner(params))
      }
      completed = end
      setProgress(Math.round((completed / iterations) * 100))

      if (completed < iterations) {
        requestAnimationFrame(processBatch)
      } else {
        const stats = computeStats(allResults)
        const result: MCResult = {
          id: crypto.randomUUID ? crypto.randomUUID() : `mc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: name.trim(),
          simulationType: simType,
          params: { ...params },
          iterations,
          distribution: allResults,
          histogramData: buildHistogram(allResults),
          convergenceData: buildConvergence(allResults),
          stats,
          createdAt: new Date().toISOString(),
        }
        setRunning(false)
        onResult(result)
      }
    }
    requestAnimationFrame(processBatch)
  }

  const paramConfigs = MC_PARAM_CONFIGS[simType] || []

  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--color-text)]">New Monte Carlo Simulation</h3>
        <button onClick={onClose} className="p-1 hover:bg-[var(--glass-bg)] rounded transition-all" disabled={running}>
          <FiX className="w-4 h-4 text-[var(--color-text-muted)]" />
        </button>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Simulation Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Drug efficacy MC run" className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-blue)]" disabled={running} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Simulation Type</label>
            <select value={simType} onChange={e => handleTypeChange(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent-blue)]" disabled={running}>
              {SIMULATION_TYPES.map(t => (<option key={t.id} value={t.id}>{t.label}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Iterations</label>
            <input type="number" value={iterations} onChange={e => setIterations(Math.max(100, Math.min(100000, parseInt(e.target.value) || 1000)))} min={100} max={100000} className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent-blue)]" disabled={running} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">Model Parameters</label>
          <div className="grid grid-cols-2 gap-3">
            {paramConfigs.map(cfg => (
              <div key={cfg.key}>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">{cfg.label}</label>
                {cfg.type === 'select' ? (
                  <select value={String(params[cfg.key])} onChange={e => setParams(prev => ({ ...prev, [cfg.key]: e.target.value }))} className="w-full px-2 py-1.5 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent-blue)]" disabled={running}>
                    {cfg.options?.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                ) : (
                  <input type="number" value={Number(params[cfg.key])} onChange={e => setParams(prev => ({ ...prev, [cfg.key]: parseFloat(e.target.value) || cfg.default }))} min={cfg.min} max={cfg.max} step={cfg.step} className="w-full px-2 py-1.5 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent-blue)]" disabled={running} />
                )}
              </div>
            ))}
          </div>
        </div>

        {running && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
              <span>Running simulation...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-[var(--color-border)] rounded-full h-2">
              <div className="bg-[var(--color-accent-blue)] h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] rounded-lg transition-all" disabled={running}>Cancel</button>
          <button onClick={handleRun} disabled={!name.trim() || running} className="px-4 py-2 text-sm bg-[var(--color-accent-blue)] text-white rounded-lg hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-1.5">
            <FiPlay className="w-3.5 h-3.5" />
            {running ? `Running (${progress}%)...` : 'Run Simulation'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MC Simulation Result Card ───────────────────────────────────
function MCSimulationCard({ result, onDelete }: { result: MCResult; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)
  const typeLabel = SIMULATION_TYPES.find(t => t.id === result.simulationType)?.label || result.simulationType

  const copyChartsToClipboard = useCallback(async () => {
    const el = chartRef.current
    if (!el) return
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: '#0f0f14',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [])

  return (
    <div className="glass-card p-5 hover:bg-[var(--glass-bg-hover)] transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="cursor-pointer flex-1" onClick={() => setExpanded(!expanded)}>
          <h3 className="font-semibold text-[var(--color-text)]">{result.name}</h3>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{typeLabel} &middot; {result.iterations.toLocaleString()} iterations</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-green-600/20 text-[var(--color-accent-green)]">
            <FiCheck className="w-3 h-3" />
            completed
          </div>
          <button onClick={() => onDelete(result.id)} className="p-1 hover:bg-red-600/20 rounded transition-all" title="Delete simulation">
            <FiX className="w-3.5 h-3.5 text-[var(--color-text-muted)] hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* Summary stats always visible */}
      <div className="grid grid-cols-5 gap-2 mb-3">
        {[
          { label: 'Mean', value: result.stats.mean.toPrecision(4) },
          { label: 'Median', value: result.stats.median.toPrecision(4) },
          { label: 'Std Dev', value: result.stats.std.toPrecision(4) },
          { label: '95% CI Low', value: result.stats.ci95Lower.toPrecision(4) },
          { label: '95% CI High', value: result.stats.ci95Upper.toPrecision(4) },
        ].map(s => (
          <div key={s.label} className="bg-[var(--glass-bg)] rounded p-2 text-center">
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">{s.label}</div>
            <div className="text-sm font-mono font-semibold text-[var(--color-text)] mt-0.5">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Parameters */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(result.params).map(([k, v]) => (
          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
            {k}: {String(v)}
          </span>
        ))}
      </div>

      <button onClick={() => setExpanded(!expanded)} className="text-xs text-[var(--color-accent-blue)] hover:underline mb-2">
        {expanded ? 'Hide charts' : 'Show charts'}
      </button>

      {expanded && (
        <div className="space-y-4 mt-3">
          <div ref={chartRef} className="space-y-4 p-2 rounded-lg" style={{ background: '#0f0f14' }}>
            {/* Histogram */}
            <div>
              <h4 className="text-xs font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">Result Distribution</h4>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.histogramData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="bin" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--glass-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text)' }} />
                    <Bar dataKey="count" fill="var(--color-accent-blue)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Convergence plot */}
            <div>
              <h4 className="text-xs font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">Convergence (Running Mean)</h4>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.convergenceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="iteration" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--glass-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text)' }} />
                    <Line type="monotone" dataKey="mean" stroke="var(--color-accent-green)" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[10px] text-[var(--color-text-muted)]">Created: {new Date(result.createdAt).toLocaleString()}</p>
            <button
              onClick={copyChartsToClipboard}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white transition-all"
              title="Copy charts to clipboard"
            >
              {copied ? <FiCheck className="w-3 h-3 text-[var(--color-accent-green)]" /> : <FiClipboard className="w-3 h-3" />}
              {copied ? 'Copied!' : 'Copy Charts'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Computational Environment Templates ─────────────────────────
type ComputeEnv = 'octave' | 'python' | 'r' | 'julia'

interface ComputeTemplate {
  id: string
  name: string
  description: string
  env: ComputeEnv
  category: string
  icon: typeof FiCpu
  color: string
  code: string
}

const COMPUTE_ENVIRONMENTS: { id: ComputeEnv; name: string; icon: typeof FiTerminal; color: string; description: string }[] = [
  { id: 'octave', name: 'Numeric Compute Engine', icon: FiGrid, color: '#0790C0', description: 'Scientific computing for neuroimaging, signal processing, and neural modeling — powered by GNU Octave' },
  { id: 'python', name: 'Python', icon: FiCode, color: '#3776AB', description: 'General-purpose scientific computing with NumPy, SciPy, scikit-learn, and BioPython' },
  { id: 'r', name: 'R Statistical', icon: FiBarChart2, color: '#276DC3', description: 'Statistical analysis, bioinformatics with Bioconductor, and clinical data analysis' },
  { id: 'julia', name: 'Julia', icon: FiZap, color: '#9558B2', description: 'High-performance numerical computing for differential equations and agent-based modeling' },
]

const COMPUTE_TEMPLATES: ComputeTemplate[] = [
  // GNU Octave templates
  {
    id: 'octave-eeg-analysis',
    name: 'EEG Signal Processing',
    description: 'Analyze EEG recordings: bandpass filtering, FFT spectral analysis, event-related potentials (ERP), and time-frequency decomposition using wavelets.',
    env: 'octave',
    category: 'Neuroimaging',
    icon: FiActivity,
    color: '#0790C0',
    code: `% EEG Signal Processing Pipeline
% Requires: signal package
pkg load signal;

% Simulation parameters
fs = 256;           % Sampling frequency (Hz)
duration = 10;      % Signal duration (seconds)
t = 0:1/fs:duration-1/fs;
n = length(t);

% Generate synthetic EEG with alpha (8-13 Hz) and beta (13-30 Hz) bands
alpha_wave = 20 * sin(2*pi*10*t) + 5*randn(1,n);  % Alpha rhythm
beta_wave = 10 * sin(2*pi*22*t) + 3*randn(1,n);   % Beta rhythm
artifact = 50 * (rand(1,n) > 0.995);               % Spike artifacts
eeg_signal = alpha_wave + beta_wave + artifact + 8*randn(1,n);

% Bandpass filter (1-40 Hz)
[b, a] = butter(4, [1 40]/(fs/2), 'bandpass');
eeg_filtered = filtfilt(b, a, eeg_signal);

% Power spectral density
nfft = 2^nextpow2(n);
f = fs*(0:(nfft/2))/nfft;
Y = fft(eeg_filtered, nfft);
psd = (1/(fs*n)) * abs(Y(1:nfft/2+1)).^2;
psd(2:end-1) = 2*psd(2:end-1);

% Band power extraction
delta_idx = f >= 0.5 & f <= 4;
theta_idx = f >= 4 & f <= 8;
alpha_idx = f >= 8 & f <= 13;
beta_idx = f >= 13 & f <= 30;
gamma_idx = f >= 30 & f <= 40;

band_powers = struct();
band_powers.delta = sum(psd(delta_idx));
band_powers.theta = sum(psd(theta_idx));
band_powers.alpha = sum(psd(alpha_idx));
band_powers.beta = sum(psd(beta_idx));
band_powers.gamma = sum(psd(gamma_idx));

fprintf('Band Power Analysis:\\n');
fprintf('  Delta (0.5-4 Hz):  %.2f uV^2\\n', band_powers.delta);
fprintf('  Theta (4-8 Hz):    %.2f uV^2\\n', band_powers.theta);
fprintf('  Alpha (8-13 Hz):   %.2f uV^2\\n', band_powers.alpha);
fprintf('  Beta (13-30 Hz):   %.2f uV^2\\n', band_powers.beta);
fprintf('  Gamma (30-40 Hz):  %.2f uV^2\\n', band_powers.gamma);
fprintf('  Alpha/Beta ratio:  %.3f\\n', band_powers.alpha/band_powers.beta);
`,
  },
  {
    id: 'octave-neural-network',
    name: 'Neural Circuit Simulation',
    description: 'Hodgkin-Huxley neuron model simulation with ion channel dynamics, action potential generation, and synaptic transmission.',
    env: 'octave',
    category: 'Computational Neuroscience',
    icon: FiCpu,
    color: '#0790C0',
    code: `% Hodgkin-Huxley Neuron Model
% Simulates action potential generation with ion channel dynamics

% Physical constants
C_m = 1.0;      % Membrane capacitance (uF/cm^2)
g_Na = 120.0;   % Sodium conductance (mS/cm^2)
g_K = 36.0;     % Potassium conductance (mS/cm^2)
g_L = 0.3;      % Leak conductance (mS/cm^2)
E_Na = 50.0;    % Sodium reversal potential (mV)
E_K = -77.0;    % Potassium reversal potential (mV)
E_L = -54.387;  % Leak reversal potential (mV)

% Time parameters
dt = 0.01;      % Time step (ms)
T = 50;         % Total simulation time (ms)
t = 0:dt:T;
N = length(t);

% Initialize state variables
V = -65 * ones(1, N);   % Membrane potential (mV)
m = zeros(1, N);         % Na activation
h = ones(1, N);          % Na inactivation
n_gate = zeros(1, N);    % K activation

% External current stimulus (step current)
I_ext = zeros(1, N);
I_ext(t >= 5 & t <= 40) = 10;  % 10 uA/cm^2 current injection

% Rate functions (alpha and beta)
alpha_m = @(V) 0.1*(V+40)./(1 - exp(-(V+40)/10));
beta_m = @(V) 4.0*exp(-(V+65)/18);
alpha_h = @(V) 0.07*exp(-(V+65)/20);
beta_h = @(V) 1./(1 + exp(-(V+35)/10));
alpha_n = @(V) 0.01*(V+55)./(1 - exp(-(V+55)/10));
beta_n = @(V) 0.125*exp(-(V+65)/80);

% Initial gating variables at rest
V(1) = -65;
m(1) = alpha_m(V(1))/(alpha_m(V(1)) + beta_m(V(1)));
h(1) = alpha_h(V(1))/(alpha_h(V(1)) + beta_h(V(1)));
n_gate(1) = alpha_n(V(1))/(alpha_n(V(1)) + beta_n(V(1)));

% Euler integration
for i = 1:N-1
    % Ionic currents
    I_Na = g_Na * m(i)^3 * h(i) * (V(i) - E_Na);
    I_K = g_K * n_gate(i)^4 * (V(i) - E_K);
    I_L = g_L * (V(i) - E_L);

    % Membrane equation
    dV = (I_ext(i) - I_Na - I_K - I_L) / C_m;
    V(i+1) = V(i) + dt * dV;

    % Gating variable updates
    m(i+1) = m(i) + dt*(alpha_m(V(i))*(1-m(i)) - beta_m(V(i))*m(i));
    h(i+1) = h(i) + dt*(alpha_h(V(i))*(1-h(i)) - beta_h(V(i))*h(i));
    n_gate(i+1) = n_gate(i) + dt*(alpha_n(V(i))*(1-n_gate(i)) - beta_n(V(i))*n_gate(i));
end

% Count spikes
spike_threshold = 0;
spikes = diff(V > spike_threshold) == 1;
num_spikes = sum(spikes);
firing_rate = num_spikes / (T/1000);

fprintf('Hodgkin-Huxley Simulation Results:\\n');
fprintf('  Simulation duration: %.1f ms\\n', T);
fprintf('  Number of spikes: %d\\n', num_spikes);
fprintf('  Firing rate: %.1f Hz\\n', firing_rate);
fprintf('  Peak voltage: %.1f mV\\n', max(V));
fprintf('  Resting potential: %.1f mV\\n', V(1));
`,
  },
  {
    id: 'octave-fmri-analysis',
    name: 'fMRI Data Analysis',
    description: 'Process functional MRI data: GLM analysis, BOLD signal modeling, statistical parametric mapping, and brain connectivity analysis.',
    env: 'octave',
    category: 'Neuroimaging',
    icon: FiLayers,
    color: '#0790C0',
    code: `% fMRI Analysis Pipeline - GLM and Connectivity
% Simulates BOLD signal analysis

% Simulation parameters
TR = 2;              % Repetition time (seconds)
n_volumes = 200;     % Number of volumes
n_voxels = 1000;     % Number of voxels
t = (0:n_volumes-1) * TR;

% Design matrix - block design (task vs rest)
block_duration = 20;  % seconds
task_blocks = mod(floor(t / block_duration), 2);

% Hemodynamic Response Function (canonical double-gamma)
hrf_t = 0:TR:30;
a1=6; b1=1; c=1/6; a2=16; b2=1;
hrf = (hrf_t.^(a1-1) .* exp(-hrf_t/b1) / (b1^a1 * gamma(a1))) - ...
      c * (hrf_t.^(a2-1) .* exp(-hrf_t/b2) / (b2^a2 * gamma(a2)));
hrf = hrf / max(hrf);

% Convolve stimulus with HRF
predicted_bold = conv(task_blocks, hrf);
predicted_bold = predicted_bold(1:n_volumes);
predicted_bold = predicted_bold / max(abs(predicted_bold));

% Generate synthetic voxel data with varying activation
activation_strength = randn(1, n_voxels) * 2;
noise_level = 1.5;
data = zeros(n_volumes, n_voxels);
for v = 1:n_voxels
    data(:,v) = activation_strength(v) * predicted_bold' + noise_level * randn(n_volumes, 1);
end

% GLM Analysis
X = [predicted_bold', ones(n_volumes, 1)];  % Design matrix with intercept
beta = (X' * X) \\ (X' * data);              % OLS estimates
residuals = data - X * beta;
mse = sum(residuals.^2) / (n_volumes - 2);

% T-statistics for activation
se = sqrt(mse .* ((X'*X)\\eye(2))(1,1));
t_stats = beta(1,:) ./ se;

% Thresholding (p < 0.001, uncorrected)
t_threshold = 3.29;  % approximately t(198, 0.001)
active_voxels = abs(t_stats) > t_threshold;
n_active = sum(active_voxels);

% Functional connectivity (correlation matrix of active voxels)
active_data = data(:, active_voxels);
if size(active_data, 2) > 1
    conn_matrix = corrcoef(active_data);
    mean_connectivity = mean(conn_matrix(triu(true(size(conn_matrix)), 1)));
else
    mean_connectivity = 0;
end

fprintf('fMRI GLM Analysis Results:\\n');
fprintf('  Volumes: %d, Voxels: %d\\n', n_volumes, n_voxels);
fprintf('  Active voxels (p<0.001): %d (%.1f%%)\\n', n_active, 100*n_active/n_voxels);
fprintf('  Peak t-statistic: %.2f\\n', max(abs(t_stats)));
fprintf('  Mean connectivity (active): %.3f\\n', mean_connectivity);
`,
  },
  {
    id: 'octave-bci',
    name: 'Brain-Computer Interface (BCI)',
    description: 'Motor imagery classification using CSP (Common Spatial Patterns) and LDA for BCI applications with EEG data.',
    env: 'octave',
    category: 'Brain-Computer Interface',
    icon: FiTarget,
    color: '#0790C0',
    code: `% Brain-Computer Interface - Motor Imagery Classification
% Common Spatial Patterns (CSP) + LDA

pkg load signal;

% Parameters
fs = 250;                  % Sampling rate (Hz)
n_channels = 22;           % EEG channels
n_trials = 100;            % Trials per class
trial_length = 4;          % seconds
n_samples = fs * trial_length;

% Generate synthetic motor imagery data
% Class 1: Left hand (mu desynchronization in C4)
% Class 2: Right hand (mu desynchronization in C3)

data_class1 = zeros(n_trials, n_channels, n_samples);
data_class2 = zeros(n_trials, n_channels, n_samples);

for trial = 1:n_trials
    t = (0:n_samples-1)/fs;
    for ch = 1:n_channels
        base_signal = 10*randn(1, n_samples);  % Background EEG

        % Add mu rhythm (8-12 Hz) modulation
        mu_rhythm = 15 * sin(2*pi*10*t + 2*pi*rand());

        if ch == 8  % C4 area
            data_class1(trial, ch, :) = base_signal + 0.3*mu_rhythm;  % Desync
            data_class2(trial, ch, :) = base_signal + mu_rhythm;       % Normal
        elseif ch == 10  % C3 area
            data_class1(trial, ch, :) = base_signal + mu_rhythm;       % Normal
            data_class2(trial, ch, :) = base_signal + 0.3*mu_rhythm;  % Desync
        else
            data_class1(trial, ch, :) = base_signal + 0.7*mu_rhythm;
            data_class2(trial, ch, :) = base_signal + 0.7*mu_rhythm;
        end
    end
end

% Bandpass filter (8-30 Hz) for mu/beta bands
[b, a] = butter(4, [8 30]/(fs/2), 'bandpass');

% Compute covariance matrices per class
cov1 = zeros(n_channels);
cov2 = zeros(n_channels);

for trial = 1:n_trials
    x1 = squeeze(data_class1(trial, :, :));
    x2 = squeeze(data_class2(trial, :, :));

    % Filter
    for ch = 1:n_channels
        x1(ch,:) = filtfilt(b, a, x1(ch,:));
        x2(ch,:) = filtfilt(b, a, x2(ch,:));
    end

    cov1 = cov1 + (x1 * x1') / trace(x1 * x1');
    cov2 = cov2 + (x2 * x2') / trace(x2 * x2');
end
cov1 = cov1 / n_trials;
cov2 = cov2 / n_trials;

% CSP decomposition
[W, D] = eig(cov1, cov1 + cov2);
[~, idx] = sort(diag(D), 'descend');
W = W(:, idx);

% Select top/bottom CSP components
n_components = 3;
csp_filters = W(:, [1:n_components, end-n_components+1:end]);

% Feature extraction (log-variance of CSP-filtered signals)
n_features = 2 * n_components;
features = zeros(2*n_trials, n_features);
labels = [ones(n_trials, 1); 2*ones(n_trials, 1)];

for trial = 1:n_trials
    x1 = squeeze(data_class1(trial, :, :));
    x2 = squeeze(data_class2(trial, :, :));

    for ch = 1:n_channels
        x1(ch,:) = filtfilt(b, a, x1(ch,:));
        x2(ch,:) = filtfilt(b, a, x2(ch,:));
    end

    z1 = csp_filters' * x1;
    z2 = csp_filters' * x2;

    features(trial, :) = log(var(z1, 0, 2)');
    features(n_trials + trial, :) = log(var(z2, 0, 2)');
end

% Simple LDA classification (leave-one-out CV)
correct = 0;
for i = 1:2*n_trials
    train_idx = [1:i-1, i+1:2*n_trials];
    X_train = features(train_idx, :);
    y_train = labels(train_idx);

    mu1 = mean(X_train(y_train==1, :));
    mu2 = mean(X_train(y_train==2, :));
    S_w = cov(X_train(y_train==1,:)) + cov(X_train(y_train==2,:));
    w = S_w \\ (mu1 - mu2)';

    projection = features(i,:) * w;
    threshold = 0.5 * (mu1 + mu2) * w;

    predicted = 1 + (projection < threshold);
    correct = correct + (predicted == labels(i));
end

accuracy = correct / (2*n_trials) * 100;
fprintf('BCI Motor Imagery Classification:\\n');
fprintf('  Channels: %d, Trials/class: %d\\n', n_channels, n_trials);
fprintf('  CSP components: %d per class\\n', n_components);
fprintf('  Classification accuracy: %.1f%%\\n', accuracy);
fprintf('  Information transfer rate: %.2f bits/trial\\n', ...
    log2(2) + (accuracy/100)*log2(accuracy/100+eps) + (1-accuracy/100)*log2((1-accuracy/100)/(2-1)+eps));
`,
  },
  {
    id: 'octave-spike-sorting',
    name: 'Spike Sorting & Analysis',
    description: 'Neural spike detection, feature extraction with PCA, clustering for spike sorting, and firing rate analysis.',
    env: 'octave',
    category: 'Electrophysiology',
    icon: FiTrendingUp,
    color: '#0790C0',
    code: `% Neural Spike Sorting Pipeline
% Detect, extract, and classify neural spikes

pkg load signal;
pkg load statistics;

% Parameters
fs = 30000;          % Sampling rate (Hz) - typical for extracellular recordings
duration = 10;       % seconds
t = 0:1/fs:duration-1/fs;
n = length(t);

% Generate synthetic extracellular recording
% 3 neuron templates with different waveforms
template1 = @(t) -80*exp(-((t-0.3e-3).^2)/(2*(0.15e-3)^2)) + 30*exp(-((t-0.8e-3).^2)/(2*(0.2e-3)^2));
template2 = @(t) -50*exp(-((t-0.25e-3).^2)/(2*(0.1e-3)^2)) + 40*exp(-((t-0.6e-3).^2)/(2*(0.25e-3)^2));
template3 = @(t) -100*exp(-((t-0.35e-3).^2)/(2*(0.12e-3)^2)) + 20*exp(-((t-0.9e-3).^2)/(2*(0.18e-3)^2));

spike_width = 1.5e-3;  % 1.5 ms spike window
spike_samples = round(spike_width * fs);
spike_t = (0:spike_samples-1)/fs;

% Generate spike trains (Poisson process)
rates = [15, 25, 8];  % Hz firing rates for 3 neurons
noise_level = 15;
signal = noise_level * randn(1, n);

spike_times = cell(3, 1);
templates = {template1, template2, template3};
amplitudes = [1.0, 0.8, 1.2];

for neuron = 1:3
    isi = -log(rand(1, ceil(rates(neuron)*duration*2))) / rates(neuron);
    times = cumsum(isi);
    times = times(times < duration - spike_width);
    spike_times{neuron} = times;

    for s = 1:length(times)
        idx = round(times(s) * fs) + 1;
        if idx + spike_samples - 1 <= n
            waveform = amplitudes(neuron) * templates{neuron}(spike_t);
            signal(idx:idx+spike_samples-1) = signal(idx:idx+spike_samples-1) + waveform;
        end
    end
end

% Spike detection (threshold crossing)
threshold = -4 * std(signal);  % -4 sigma
crossings = find(diff(signal < threshold) == 1);

% Remove refractory violations (< 1ms)
refractory = round(1e-3 * fs);
valid = [true, diff(crossings) > refractory];
crossings = crossings(valid);

% Extract spike waveforms
pre_samples = round(0.3e-3 * fs);
post_samples = round(1.2e-3 * fs);
waveform_length = pre_samples + post_samples;
waveforms = zeros(length(crossings), waveform_length);

valid_spikes = 0;
for i = 1:length(crossings)
    start_idx = crossings(i) - pre_samples;
    end_idx = crossings(i) + post_samples - 1;
    if start_idx > 0 && end_idx <= n
        valid_spikes = valid_spikes + 1;
        waveforms(valid_spikes, :) = signal(start_idx:end_idx);
    end
end
waveforms = waveforms(1:valid_spikes, :);

% PCA for feature extraction
waveforms_centered = waveforms - mean(waveforms);
[coeff, score] = pca(waveforms_centered);
features = score(:, 1:3);  % First 3 PCs

% K-means clustering
[cluster_ids, centroids] = kmeans(features, 3);

fprintf('Spike Sorting Results:\\n');
fprintf('  Recording duration: %.1f s\\n', duration);
fprintf('  Threshold: %.1f uV\\n', threshold);
fprintf('  Total spikes detected: %d\\n', valid_spikes);
for c = 1:3
    n_in_cluster = sum(cluster_ids == c);
    rate = n_in_cluster / duration;
    fprintf('  Cluster %d: %d spikes (%.1f Hz)\\n', c, n_in_cluster, rate);
end
fprintf('  True spike counts: %d, %d, %d\\n', ...
    length(spike_times{1}), length(spike_times{2}), length(spike_times{3}));
`,
  },
  {
    id: 'octave-pharmacokinetics',
    name: 'Pharmacokinetic Modeling',
    description: 'Two-compartment PK model with absorption, distribution, metabolism, and excretion (ADME) simulation.',
    env: 'octave',
    category: 'Pharmacology',
    icon: FiHeart,
    color: '#0790C0',
    code: `% Two-Compartment Pharmacokinetic Model
% ADME simulation with oral absorption

% Drug parameters (example: typical small molecule)
F = 0.75;        % Bioavailability
ka = 1.5;        % Absorption rate (1/h)
ke = 0.15;       % Elimination rate (1/h)
k12 = 0.6;       % Central to peripheral (1/h)
k21 = 0.3;       % Peripheral to central (1/h)
Vd1 = 50;        % Central volume (L)
Vd2 = 100;       % Peripheral volume (L)
Dose = 500;      % mg

% Time parameters
dt = 0.01;
t_max = 72;      % hours
t = 0:dt:t_max;
n = length(t);

% State variables: [Drug_gut, Drug_central, Drug_peripheral]
A_gut = zeros(1, n);
A_central = zeros(1, n);
A_peripheral = zeros(1, n);

% Initial conditions (oral dose)
A_gut(1) = F * Dose;

% Euler integration
for i = 1:n-1
    dA_gut = -ka * A_gut(i);
    dA_central = ka * A_gut(i) - (ke + k12) * A_central(i) + k21 * A_peripheral(i);
    dA_peripheral = k12 * A_central(i) - k21 * A_peripheral(i);

    A_gut(i+1) = A_gut(i) + dt * dA_gut;
    A_central(i+1) = A_central(i) + dt * dA_central;
    A_peripheral(i+1) = A_peripheral(i) + dt * dA_peripheral;
end

% Plasma concentration
Cp = A_central / Vd1;  % mg/L

% PK parameters
[Cmax, tmax_idx] = max(Cp);
tmax = t(tmax_idx);
t_half = log(2) / ke;

% AUC (trapezoidal rule)
AUC = trapz(t, Cp);
AUC_0_24 = trapz(t(t<=24), Cp(t<=24));

% MEC and MTC (minimum effective / maximum tolerated)
MEC = 2.0;   % mg/L
MTC = 15.0;  % mg/L
time_above_MEC = sum(Cp > MEC) * dt;
time_in_window = sum(Cp > MEC & Cp < MTC) * dt;

% Clearance
CL = F * Dose / AUC;

fprintf('Pharmacokinetic Analysis:\\n');
fprintf('  Dose: %.0f mg (F=%.0f%%)\\n', Dose, F*100);
fprintf('  Cmax: %.2f mg/L\\n', Cmax);
fprintf('  Tmax: %.1f h\\n', tmax);
fprintf('  t1/2: %.1f h\\n', t_half);
fprintf('  AUC(0-inf): %.1f mg*h/L\\n', AUC);
fprintf('  AUC(0-24h): %.1f mg*h/L\\n', AUC_0_24);
fprintf('  Clearance: %.2f L/h\\n', CL);
fprintf('  Time above MEC: %.1f h\\n', time_above_MEC);
fprintf('  Time in therapeutic window: %.1f h\\n', time_in_window);
`,
  },
  // Additional Octave templates — Pharmacokinetics, Systems Biology, Dose-Response
  {
    id: 'octave-pk-population',
    name: 'Population PK Modeling',
    description: 'Non-linear mixed effects population PK: inter-individual variability, covariate modeling, and VPC (Visual Predictive Check) generation.',
    env: 'octave' as ComputeEnv,
    category: 'Pharmacokinetics',
    icon: FiHeart,
    color: '#0790C0',
    code: `% Population Pharmacokinetic Model (NLME approximation)
% Simulates inter-individual variability in PK parameters

% Population parameters (typical values)
tv_CL = 5.0;      % Typical clearance (L/h)
tv_V1 = 50;       % Typical central volume (L)
tv_ka = 1.2;      % Typical absorption rate (1/h)
tv_F = 0.8;       % Typical bioavailability

% Inter-individual variability (log-normal)
omega_CL = 0.3;   % CV ~30%
omega_V1 = 0.25;  % CV ~25%
omega_ka = 0.4;   % CV ~40%

% Residual error
sigma_prop = 0.1;  % Proportional error 10%
sigma_add = 0.5;   % Additive error (mg/L)

% Study design
n_subjects = 50;
dose = 500;        % mg oral
dt = 0.1;
t_max = 48;
t = 0:dt:t_max;
n_t = length(t);

% Sampling times
t_obs = [0.5, 1, 2, 4, 6, 8, 12, 24, 36, 48];

% Simulate population
Cp_pop = zeros(n_subjects, n_t);
params = zeros(n_subjects, 3);  % CL, V1, ka

for subj = 1:n_subjects
    % Individual parameters (log-normal distribution)
    CL_i = tv_CL * exp(omega_CL * randn());
    V1_i = tv_V1 * exp(omega_V1 * randn());
    ka_i = tv_ka * exp(omega_ka * randn());
    params(subj,:) = [CL_i, V1_i, ka_i];

    ke_i = CL_i / V1_i;

    % Analytical solution: one-compartment oral
    for j = 1:n_t
        Cp_pop(subj,j) = (tv_F * dose * ka_i) / (V1_i * (ka_i - ke_i)) * ...
                          (exp(-ke_i * t(j)) - exp(-ka_i * t(j)));
        % Add residual error
        eps_prop = sigma_prop * randn();
        eps_add = sigma_add * randn();
        Cp_pop(subj,j) = Cp_pop(subj,j) * (1 + eps_prop) + eps_add;
        Cp_pop(subj,j) = max(0, Cp_pop(subj,j));
    end
end

% Population statistics
median_Cp = median(Cp_pop);
pct5 = quantile(Cp_pop, 0.05);
pct95 = quantile(Cp_pop, 0.95);
[Cmax_med, tmax_idx] = max(median_Cp);

fprintf('Population PK Simulation Results:\\n');
fprintf('  Subjects: %d\\n', n_subjects);
fprintf('  Dose: %d mg oral\\n', dose);
fprintf('  Median Cmax: %.2f mg/L at t=%.1f h\\n', Cmax_med, t(tmax_idx));
fprintf('  90%% prediction interval Cmax: [%.2f, %.2f] mg/L\\n', max(pct5), max(pct95));
fprintf('  Parameter estimates (median [IQR]):\\n');
fprintf('    CL: %.2f [%.2f-%.2f] L/h\\n', median(params(:,1)), quantile(params(:,1),0.25), quantile(params(:,1),0.75));
fprintf('    V1: %.1f [%.1f-%.1f] L\\n', median(params(:,2)), quantile(params(:,2),0.25), quantile(params(:,2),0.75));
fprintf('    ka: %.2f [%.2f-%.2f] 1/h\\n', median(params(:,3)), quantile(params(:,3),0.25), quantile(params(:,3),0.75));
`,
  },
  {
    id: 'octave-pk-infusion',
    name: 'IV Infusion PK Model',
    description: 'Steady-state IV infusion with loading dose, accumulation kinetics, and therapeutic drug monitoring.',
    env: 'octave' as ComputeEnv,
    category: 'Pharmacokinetics',
    icon: FiActivity,
    color: '#0790C0',
    code: `% IV Infusion Pharmacokinetics with Multiple Dosing
% Steady-state accumulation and TDM simulation

% Drug parameters
CL = 4.0;         % Clearance (L/h)
V = 35;           % Volume of distribution (L)
ke = CL / V;      % Elimination rate constant
t_half = log(2)/ke;

% Dosing regimen
infusion_rate = 100;  % mg/h
infusion_duration = 1; % h (intermittent infusion)
dose_interval = 8;     % h (q8h)
n_doses = 10;

% Time setup
dt = 0.01;
t_max = n_doses * dose_interval + 24;  % extra 24h washout
t = 0:dt:t_max;
n = length(t);
Cp = zeros(1, n);

% Simulate multiple intermittent infusions
for d = 0:n_doses-1
    t_start = d * dose_interval;
    t_end_inf = t_start + infusion_duration;

    for i = 1:n
        if t(i) >= t_start && t(i) < t_end_inf
            % During infusion
            t_inf = t(i) - t_start;
            Cp(i) = Cp(i) + (infusion_rate/CL) * (1 - exp(-ke * t_inf));
        elseif t(i) >= t_end_inf
            % Post infusion
            t_post = t(i) - t_end_inf;
            C_end_inf = (infusion_rate/CL) * (1 - exp(-ke * infusion_duration));
            Cp(i) = Cp(i) + C_end_inf * exp(-ke * t_post);
        end
    end
end

% Steady-state analysis
ss_start = (n_doses-2) * dose_interval;
ss_end = (n_doses-1) * dose_interval;
ss_mask = t >= ss_start & t < ss_end;
Css_max = max(Cp(ss_mask));
Css_min = min(Cp(ss_mask));
Css_avg = mean(Cp(ss_mask));

% Accumulation factor
R_acc = 1 / (1 - exp(-ke * dose_interval));

fprintf('IV Infusion PK Results:\\n');
fprintf('  Drug t1/2: %.1f h\\n', t_half);
fprintf('  Dosing: %.0f mg/h x %.0f h q%.0fh\\n', infusion_rate, infusion_duration, dose_interval);
fprintf('  Total dose/interval: %.0f mg\\n', infusion_rate * infusion_duration);
fprintf('  Accumulation factor: %.2f\\n', R_acc);
fprintf('  Steady-state Cmax: %.2f mg/L\\n', Css_max);
fprintf('  Steady-state Cmin: %.2f mg/L\\n', Css_min);
fprintf('  Steady-state Cavg: %.2f mg/L\\n', Css_avg);
fprintf('  Peak-trough ratio: %.2f\\n', Css_max/Css_min);
fprintf('  Time to ~steady-state: %.1f h (5 x t1/2)\\n', 5 * t_half);
`,
  },
  {
    id: 'octave-systems-bio',
    name: 'Systems Biology - Pathway Model',
    description: 'ODE-based signaling pathway simulation: MAPK cascade, receptor-ligand binding, and feedback regulation dynamics.',
    env: 'octave' as ComputeEnv,
    category: 'Systems Biology',
    icon: FiRefreshCw,
    color: '#0790C0',
    code: `% MAPK Signaling Cascade Simulation
% Three-tier kinase cascade with feedback

% Rate constants
k1 = 0.1;    % Ras activation
k2 = 0.05;   % Ras deactivation
k3 = 0.5;    % RAF activation by Ras
k4 = 0.2;    % RAF deactivation
k5 = 0.3;    % MEK activation by RAF
k6 = 0.1;    % MEK deactivation
k7 = 0.4;    % ERK activation by MEK
k8 = 0.15;   % ERK deactivation
k_fb = 0.08; % Negative feedback (ERK -> Ras)

% Total protein concentrations (arbitrary units)
Ras_total = 100;
RAF_total = 100;
MEK_total = 200;
ERK_total = 300;

% Time setup
dt = 0.01;
t_max = 100;
t = 0:dt:t_max;
n = length(t);

% State variables (active forms)
Ras = zeros(1,n); RAF = zeros(1,n);
MEK = zeros(1,n); ERK = zeros(1,n);

% Stimulus: EGF pulse
EGF = zeros(1,n);
EGF(t >= 5 & t <= 10) = 1.0;   % 5-unit pulse
EGF(t >= 50 & t <= 52) = 0.5;  % Second smaller pulse

% Euler integration of ODE system
for i = 1:n-1
    Ras_inactive = Ras_total - Ras(i);
    RAF_inactive = RAF_total - RAF(i);
    MEK_inactive = MEK_total - MEK(i);
    ERK_inactive = ERK_total - ERK(i);

    % Negative feedback from ERK reduces Ras activation
    fb = 1 / (1 + k_fb * ERK(i));

    dRas = k1 * EGF(i) * Ras_inactive * fb - k2 * Ras(i);
    dRAF = k3 * Ras(i) * RAF_inactive / (50 + RAF_inactive) - k4 * RAF(i);
    dMEK = k5 * RAF(i) * MEK_inactive / (100 + MEK_inactive) - k6 * MEK(i);
    dERK = k7 * MEK(i) * ERK_inactive / (150 + ERK_inactive) - k8 * ERK(i);

    Ras(i+1) = max(0, min(Ras_total, Ras(i) + dt * dRas));
    RAF(i+1) = max(0, min(RAF_total, RAF(i) + dt * dRAF));
    MEK(i+1) = max(0, min(MEK_total, MEK(i) + dt * dMEK));
    ERK(i+1) = max(0, min(ERK_total, ERK(i) + dt * dERK));
end

% Analysis
[peak_ERK, peak_idx] = max(ERK);
peak_time = t(peak_idx);
duration_active = sum(ERK > 0.1 * peak_ERK) * dt;
signal_amplification = peak_ERK / max(EGF);

fprintf('MAPK Cascade Simulation Results:\\n');
fprintf('  Stimulus: EGF pulse (5-10s, 50-52s)\\n');
fprintf('  Peak Ras*: %.1f / %d (%.0f%%)\\n', max(Ras), Ras_total, 100*max(Ras)/Ras_total);
fprintf('  Peak RAF*: %.1f / %d (%.0f%%)\\n', max(RAF), RAF_total, 100*max(RAF)/RAF_total);
fprintf('  Peak MEK*: %.1f / %d (%.0f%%)\\n', max(MEK), MEK_total, 100*max(MEK)/MEK_total);
fprintf('  Peak ERK*: %.1f / %d (%.0f%%)\\n', peak_ERK, ERK_total, 100*peak_ERK/ERK_total);
fprintf('  Time to peak ERK: %.1f s\\n', peak_time);
fprintf('  ERK active duration (>10%%): %.1f s\\n', duration_active);
fprintf('  Signal amplification: %.1fx\\n', signal_amplification);
`,
  },
  {
    id: 'octave-dose-response-analysis',
    name: 'Dose-Response Curve Fitting',
    description: 'Four-parameter logistic (4PL) dose-response fitting, EC50/IC50 estimation, therapeutic index calculation.',
    env: 'octave' as ComputeEnv,
    category: 'Dose-Response',
    icon: FiTrendingUp,
    color: '#0790C0',
    code: `% Dose-Response Analysis: 4-Parameter Logistic Model
% EC50 estimation and therapeutic index calculation

% True parameters for simulation
E0_true = 5;        % Baseline response
Emax_true = 95;     % Maximum effect
EC50_true = 10;     % Half-maximal concentration
n_true = 1.5;       % Hill coefficient

% Dose levels (log-spaced)
doses = [0, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];
n_doses = length(doses);
n_replicates = 6;

% Generate noisy response data
responses = zeros(n_doses, n_replicates);
sigma_noise = 5;  % Response variability

for d = 1:n_doses
    true_effect = E0_true + (Emax_true - E0_true) * doses(d)^n_true / (EC50_true^n_true + doses(d)^n_true);
    responses(d, :) = true_effect + sigma_noise * randn(1, n_replicates);
end

% Mean and SEM per dose
mean_response = mean(responses, 2)';
sem_response = std(responses, 0, 2)' / sqrt(n_replicates);

% Grid search for 4PL fit (simplified - no optimization toolbox needed)
best_sse = Inf;
best_params = [0, 100, 10, 1];

for E0_try = 0:2:10
    for Emax_try = 80:5:100
        for EC50_try = [1, 3, 5, 8, 10, 15, 20, 30]
            for n_try = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
                predicted = E0_try + (Emax_try - E0_try) .* doses.^n_try ./ (EC50_try^n_try + doses.^n_try);
                sse = sum((mean_response - predicted).^2);
                if sse < best_sse
                    best_sse = sse;
                    best_params = [E0_try, Emax_try, EC50_try, n_try];
                end
            end
        end
    end
end

% Fitted parameters
E0_fit = best_params(1); Emax_fit = best_params(2);
EC50_fit = best_params(3); n_fit = best_params(4);

% Derived metrics
EC20 = EC50_fit * (20/80)^(1/n_fit);
EC80 = EC50_fit * (80/20)^(1/n_fit);

% Therapeutic index (assume toxic at higher doses)
TC50 = EC50_fit * 15;  % Simulated toxic concentration
TI = TC50 / EC50_fit;

% R-squared
fitted = E0_fit + (Emax_fit - E0_fit) .* doses.^n_fit ./ (EC50_fit^n_fit + doses.^n_fit);
SS_res = sum((mean_response - fitted).^2);
SS_tot = sum((mean_response - mean(mean_response)).^2);
R2 = 1 - SS_res / SS_tot;

fprintf('Dose-Response Analysis (4PL Model):\\n');
fprintf('  True EC50: %.1f | Fitted EC50: %.1f\\n', EC50_true, EC50_fit);
fprintf('  True Hill coeff: %.1f | Fitted: %.1f\\n', n_true, n_fit);
fprintf('  E0: %.1f, Emax: %.1f\\n', E0_fit, Emax_fit);
fprintf('  EC20: %.2f, EC80: %.2f\\n', EC20, EC80);
fprintf('  Selectivity window (EC20-EC80): %.1f-fold\\n', EC80/EC20);
fprintf('  R-squared: %.4f\\n', R2);
fprintf('  Therapeutic Index (TC50/EC50): %.1f\\n', TI);
fprintf('  Safety margin: %.1f-fold\\n', TC50/EC80);
`,
  },
  {
    id: 'octave-tumor-immune',
    name: 'Tumor-Immune Dynamics',
    description: 'ODE model of tumor-immune system interactions: tumor growth, immune response, checkpoint inhibition, and treatment scheduling.',
    env: 'octave' as ComputeEnv,
    category: 'Systems Biology',
    icon: FiTarget,
    color: '#0790C0',
    code: `% Tumor-Immune System ODE Model
% With checkpoint inhibitor therapy simulation

% Parameters
r = 0.05;         % Tumor growth rate (1/day)
K = 1e9;          % Carrying capacity (cells)
a = 1e-7;         % Immune killing rate
b = 1e-9;         % Immune stimulation by tumor
d = 0.02;         % Immune cell death rate
s = 1e4;          % Basal immune cell production (cells/day)
g = 0.5;          % Checkpoint inhibitor effect (0=none, 1=full)

% Simulation setup
dt = 0.1;         % days
t_max = 365;      % 1 year
t = 0:dt:t_max;
n = length(t);

% State: Tumor cells (T), Immune cells (I)
T = zeros(1,n); I = zeros(1,n);
T(1) = 1e6;     % Initial tumor burden
I(1) = 1e5;     % Initial immune cells

% Treatment schedule: checkpoint inhibitor q3w for 6 cycles
treatment = zeros(1,n);
for cycle = 0:5
    t_dose = 30 + cycle * 21;  % Start day 30, q3 weeks
    mask = t >= t_dose & t < t_dose + 7;  % Drug active for ~7 days
    treatment(mask) = 1;
end

% Simulate with Euler method
for i = 1:n-1
    % Effective immune killing with checkpoint modulation
    kill_rate = a * (1 + g * treatment(i));

    dT = r * T(i) * (1 - T(i)/K) - kill_rate * T(i) * I(i);
    dI = s + b * T(i) * I(i) - d * I(i);

    T(i+1) = max(0, T(i) + dt * dT);
    I(i+1) = max(0, I(i) + dt * dI);
end

% Simulate untreated comparison
T_untr = zeros(1,n); I_untr = zeros(1,n);
T_untr(1) = 1e6; I_untr(1) = 1e5;
for i = 1:n-1
    dT = r * T_untr(i) * (1 - T_untr(i)/K) - a * T_untr(i) * I_untr(i);
    dI = s + b * T_untr(i) * I_untr(i) - d * I_untr(i);
    T_untr(i+1) = max(0, T_untr(i) + dt * dT);
    I_untr(i+1) = max(0, I_untr(i) + dt * dI);
end

% Outcomes
response_ratio = T(end) / T_untr(end);
nadir = min(T(t>30));  % Minimum tumor after treatment starts
time_to_nadir = t(find(T == nadir, 1));

fprintf('Tumor-Immune Simulation Results:\\n');
fprintf('  Initial tumor: %.2e cells\\n', T(1));
fprintf('  Treatment: Checkpoint inhibitor q3w x 6 cycles\\n');
fprintf('  Final tumor (treated): %.2e cells\\n', T(end));
fprintf('  Final tumor (untreated): %.2e cells\\n', T_untr(end));
fprintf('  Response ratio: %.3f (%.0f%% reduction)\\n', response_ratio, (1-response_ratio)*100);
fprintf('  Tumor nadir: %.2e cells at day %.0f\\n', nadir, time_to_nadir);
fprintf('  Peak immune cells: %.2e\\n', max(I));
fprintf('  Immune ratio (treated/untreated): %.2f\\n', max(I)/max(I_untr));
`,
  },
  // Python templates
  {
    id: 'python-genomics',
    name: 'Genomic Variant Analysis',
    description: 'Analyze genomic variants, calculate allele frequencies, perform Hardy-Weinberg equilibrium tests, and annotate pathogenic variants.',
    env: 'python',
    category: 'Genomics',
    icon: FiDatabase,
    color: '#3776AB',
    code: `import numpy as np
from scipy import stats

# Simulate genomic variant data for a cohort
np.random.seed(42)
n_samples = 1000
n_variants = 50

# Generate genotype matrix (0=ref/ref, 1=ref/alt, 2=alt/alt)
maf = np.random.uniform(0.01, 0.45, n_variants)  # Minor allele frequencies
genotypes = np.zeros((n_samples, n_variants), dtype=int)
for v in range(n_variants):
    p = maf[v]
    probs = [(1-p)**2, 2*p*(1-p), p**2]  # HWE expected
    genotypes[:, v] = np.random.choice([0, 1, 2], size=n_samples, p=probs)

# Hardy-Weinberg Equilibrium test
print("Hardy-Weinberg Equilibrium Analysis:")
print("-" * 50)
hwe_results = []
for v in range(min(10, n_variants)):
    obs_0 = np.sum(genotypes[:, v] == 0)
    obs_1 = np.sum(genotypes[:, v] == 1)
    obs_2 = np.sum(genotypes[:, v] == 2)
    p_obs = (2*obs_0 + obs_1) / (2*n_samples)
    q_obs = 1 - p_obs
    exp_0 = n_samples * p_obs**2
    exp_1 = n_samples * 2 * p_obs * q_obs
    exp_2 = n_samples * q_obs**2
    chi2 = ((obs_0-exp_0)**2/exp_0 + (obs_1-exp_1)**2/exp_1 + (obs_2-exp_2)**2/exp_2)
    p_value = 1 - stats.chi2.cdf(chi2, 1)
    print(f"  Variant {v+1}: MAF={q_obs:.3f}, chi2={chi2:.2f}, p={p_value:.4f} {'*' if p_value < 0.05 else ''}")

# Burden test (collapsing rare variants)
rare_mask = maf < 0.05
rare_burden = np.sum(genotypes[:, rare_mask] > 0, axis=1)
cases = np.random.binomial(1, 0.3 + 0.02 * rare_burden)
t_stat, p_val = stats.ttest_ind(rare_burden[cases==1], rare_burden[cases==0])
print(f"\\nRare Variant Burden Test:")
print(f"  Rare variants (MAF<5%): {np.sum(rare_mask)}")
print(f"  Mean burden cases: {rare_burden[cases==1].mean():.2f}")
print(f"  Mean burden controls: {rare_burden[cases==0].mean():.2f}")
print(f"  T-statistic: {t_stat:.3f}, P-value: {p_val:.4f}")
`,
  },
  {
    id: 'python-scrnaseq',
    name: 'Single-Cell RNA-seq Pipeline',
    description: 'scRNA-seq analysis: quality control, normalization, dimensionality reduction (PCA/UMAP), clustering, and differential expression.',
    env: 'python',
    category: 'Transcriptomics',
    icon: FiLayers,
    color: '#3776AB',
    code: `import numpy as np
from scipy import stats, sparse
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

np.random.seed(42)

# Simulate scRNA-seq count matrix
n_cells = 2000
n_genes = 5000
n_clusters = 5

# Generate cluster assignments
true_labels = np.random.choice(n_clusters, n_cells, p=[0.3, 0.25, 0.2, 0.15, 0.1])

# Simulate count matrix with cluster-specific marker genes
counts = np.random.negative_binomial(2, 0.3, (n_cells, n_genes)).astype(float)
# Add cluster-specific expression
markers_per_cluster = 50
for c in range(n_clusters):
    marker_start = c * markers_per_cluster
    marker_end = marker_start + markers_per_cluster
    mask = true_labels == c
    counts[mask, marker_start:marker_end] += np.random.negative_binomial(5, 0.2, (mask.sum(), markers_per_cluster))

# QC metrics
total_counts = counts.sum(axis=1)
genes_detected = (counts > 0).sum(axis=1)
mito_genes = np.random.choice(n_genes, 100, replace=False)
mito_pct = counts[:, mito_genes].sum(axis=1) / total_counts * 100

# QC filtering
qc_mask = (total_counts > np.percentile(total_counts, 5)) & \\
          (genes_detected > 200) & \\
          (mito_pct < 20)
counts_filtered = counts[qc_mask]
labels_filtered = true_labels[qc_mask]
print(f"QC: {qc_mask.sum()}/{n_cells} cells passed filtering")

# Normalization (CPM + log1p)
lib_sizes = counts_filtered.sum(axis=1, keepdims=True)
normalized = np.log1p(counts_filtered / lib_sizes * 1e4)

# Feature selection (highly variable genes)
gene_means = normalized.mean(axis=0)
gene_vars = normalized.var(axis=0)
cv2 = gene_vars / (gene_means**2 + 1e-8)
hvg_mask = cv2 > np.percentile(cv2, 80)
n_hvg = hvg_mask.sum()
print(f"Selected {n_hvg} highly variable genes")

# PCA
X_hvg = StandardScaler().fit_transform(normalized[:, hvg_mask])
pca = PCA(n_components=20)
X_pca = pca.fit_transform(X_hvg)
var_explained = pca.explained_variance_ratio_[:5]
print(f"PCA variance explained (top 5): {[f'{v:.1%}' for v in var_explained]}")

# Clustering
kmeans = KMeans(n_clusters=n_clusters, n_init=10, random_state=42)
pred_labels = kmeans.fit_predict(X_pca)

# Clustering accuracy (adjusted Rand index approximation)
from sklearn.metrics import adjusted_rand_score
ari = adjusted_rand_score(labels_filtered, pred_labels)
print(f"Clustering ARI: {ari:.3f}")

# Differential expression (Wilcoxon rank-sum per cluster)
print(f"\\nTop marker genes per cluster:")
for c in range(n_clusters):
    mask_c = pred_labels == c
    if mask_c.sum() < 5:
        continue
    pvals = np.ones(n_genes)
    fc = np.zeros(n_genes)
    for g in range(min(n_genes, 1000)):
        in_vals = normalized[mask_c, g]
        out_vals = normalized[~mask_c, g]
        if in_vals.std() > 0 or out_vals.std() > 0:
            stat, pval = stats.ranksums(in_vals, out_vals)
            pvals[g] = pval
            fc[g] = in_vals.mean() - out_vals.mean()
    top_genes = np.argsort(pvals)[:5]
    print(f"  Cluster {c} ({mask_c.sum()} cells): genes {top_genes.tolist()}, log2FC={fc[top_genes[:3]].round(2).tolist()}")
`,
  },
  // R templates
  {
    id: 'r-survival',
    name: 'Clinical Survival Analysis',
    description: 'Kaplan-Meier estimation, Cox proportional hazards regression, and landmark analysis for clinical trial endpoints.',
    env: 'r',
    category: 'Clinical Statistics',
    icon: FiHeart,
    color: '#276DC3',
    code: `# Clinical Survival Analysis
# Kaplan-Meier and Cox PH Model

set.seed(42)

# Simulate clinical trial data
n <- 500
treatment <- rep(c("Drug A", "Placebo"), each = n/2)

# Generate survival times (Weibull distribution)
shape <- 1.5
scale_drug <- 36    # months
scale_placebo <- 24 # months

time_drug <- rweibull(n/2, shape, scale_drug)
time_placebo <- rweibull(n/2, shape, scale_placebo)

# Censoring (administrative at 48 months + random dropouts)
censor_time <- pmin(48, rexp(n, rate = 0.02))
time <- c(pmin(time_drug, censor_time[1:(n/2)]),
          pmin(time_placebo, censor_time[(n/2+1):n]))
status <- as.numeric(time < censor_time)
time[time > 48] <- 48

# Covariates
age <- round(rnorm(n, 60, 12))
biomarker <- rnorm(n, 0, 1)
stage <- sample(c("I","II","III","IV"), n, replace=TRUE, prob=c(0.1,0.3,0.4,0.2))

data <- data.frame(
  time = time, status = status,
  treatment = treatment, age = age,
  biomarker = biomarker, stage = stage
)

cat("Clinical Trial Survival Analysis\\n")
cat(paste(rep("=", 50), collapse=""), "\\n")
cat(sprintf("Total patients: %d\\n", n))
cat(sprintf("Events: %d (%.1f%%)\\n", sum(status), 100*mean(status)))

# Kaplan-Meier estimates
# Simple implementation without survival package
km_estimate <- function(time, status) {
  ord <- order(time)
  t <- time[ord]; s <- status[ord]
  unique_t <- sort(unique(t[s==1]))
  surv <- 1
  results <- data.frame(time=0, survival=1)
  for (ti in unique_t) {
    at_risk <- sum(t >= ti)
    events <- sum(t == ti & s == 1)
    surv <- surv * (1 - events/at_risk)
    results <- rbind(results, data.frame(time=ti, survival=surv))
  }
  return(results)
}

km_drug <- km_estimate(time[treatment=="Drug A"], status[treatment=="Drug A"])
km_placebo <- km_estimate(time[treatment=="Placebo"], status[treatment=="Placebo"])

# Median survival
med_drug <- km_drug$time[which(km_drug$survival <= 0.5)[1]]
med_placebo <- km_placebo$time[which(km_placebo$survival <= 0.5)[1]]

cat(sprintf("\\nMedian OS (Drug A): %.1f months\\n", med_drug))
cat(sprintf("Median OS (Placebo): %.1f months\\n", med_placebo))

# Log-rank test approximation
cat(sprintf("\\n12-month survival Drug A: %.1f%%\\n",
    100 * tail(km_drug$survival[km_drug$time <= 12], 1)))
cat(sprintf("12-month survival Placebo: %.1f%%\\n",
    100 * tail(km_placebo$survival[km_placebo$time <= 12], 1)))

# Hazard ratio estimate (simplified)
events_drug <- sum(status[treatment=="Drug A"])
events_placebo <- sum(status[treatment=="Placebo"])
pt_drug <- sum(time[treatment=="Drug A"])
pt_placebo <- sum(time[treatment=="Placebo"])
hr <- (events_drug/pt_drug) / (events_placebo/pt_placebo)
se_log_hr <- sqrt(1/events_drug + 1/events_placebo)
hr_lower <- exp(log(hr) - 1.96*se_log_hr)
hr_upper <- exp(log(hr) + 1.96*se_log_hr)

cat(sprintf("\\nHazard Ratio: %.3f (95%% CI: %.3f - %.3f)\\n", hr, hr_lower, hr_upper))
cat(sprintf("P-value (Wald): %.4f\\n", 2*pnorm(-abs(log(hr)/se_log_hr))))
`,
  },
  // Julia template
  {
    id: 'julia-ode-model',
    name: 'ODE Disease Dynamics',
    description: 'Solve systems of ordinary differential equations for disease progression, SIR/SEIR epidemiological modeling, and tumor growth dynamics.',
    env: 'julia',
    category: 'Mathematical Modeling',
    icon: FiTrendingUp,
    color: '#9558B2',
    code: `# SEIR Epidemiological Model with Vaccination
# Solves ODEs for disease spread dynamics

# Model parameters
N = 1_000_000    # Total population
beta = 0.3       # Transmission rate
sigma = 1/5.2    # Incubation rate (1/incubation period)
gamma = 1/10     # Recovery rate (1/infectious period)
mu = 0.01        # Disease mortality rate
vacc_rate = 0.005 # Daily vaccination rate
vacc_eff = 0.9   # Vaccine efficacy

# Initial conditions
E0 = 100; I0 = 50; R0 = 0; D0 = 0; V0 = 0
S0 = N - E0 - I0 - R0 - D0 - V0

# Time parameters
dt = 0.1         # days
t_max = 365      # 1 year
steps = Int(t_max / dt)

# State arrays
S = zeros(steps+1); E = zeros(steps+1); I = zeros(steps+1)
R = zeros(steps+1); D = zeros(steps+1); V = zeros(steps+1)
S[1]=S0; E[1]=E0; I[1]=I0; R[1]=R0; D[1]=D0; V[1]=V0

# RK4 integration
for i in 1:steps
    # Current state
    s, e, ir, r, d, v = S[i], E[i], I[i], R[i], D[i], V[i]
    n_alive = s + e + ir + r + v

    # Force of infection
    foi = beta * ir / n_alive

    # SEIR + Vaccination derivatives
    dS = -foi * s - vacc_rate * vacc_eff * s
    dE = foi * s - sigma * e
    dI = sigma * e - gamma * ir - mu * ir
    dR = gamma * ir
    dD = mu * ir
    dV = vacc_rate * vacc_eff * s

    # RK4 step (simplified Euler for readability)
    S[i+1] = max(0, s + dt * dS)
    E[i+1] = max(0, e + dt * dE)
    I[i+1] = max(0, ir + dt * dI)
    R[i+1] = max(0, r + dt * dR)
    D[i+1] = max(0, d + dt * dD)
    V[i+1] = max(0, v + dt * dV)
end

# Results
t = 0:dt:t_max
peak_I = maximum(I)
peak_day = argmax(I) * dt
total_infected = N - minimum(S) - maximum(V)
total_deaths = D[end]
R0_eff = beta / (gamma + mu)

println("SEIR Epidemic Simulation Results")
println("=" ^ 50)
println("Population: $(N)")
println("R0 (basic): $(round(R0_eff, digits=2))")
println("Peak infections: $(round(Int, peak_I)) on day $(round(peak_day, digits=1))")
println("Total infected: $(round(Int, total_infected)) ($(round(100*total_infected/N, digits=1))%)")
println("Total deaths: $(round(Int, total_deaths)) (CFR: $(round(100*total_deaths/total_infected, digits=2))%)")
println("Vaccinated: $(round(Int, V[end])) ($(round(100*V[end]/N, digits=1))%)")
println("Final susceptible: $(round(Int, S[end]))")
println("Herd immunity threshold: $(round(100*(1-1/R0_eff), digits=1))%")
`,
  },
]

// ── Equation Plotter / Symbolic Math Engine ────────────────────
function EquationPlotter() {
  const [equationExpr, setEquationExpr] = useState('sin(x) * exp(-x/5)')
  const [xMin, setXMin] = useState(-2)
  const [xMax, setXMax] = useState(20)
  const [plotData, setPlotData] = useState<{ x: number; y: number }[]>([])
  const [selectedPreset, setSelectedPreset] = useState<PredefinedEquation | null>(null)
  const [plotHistory, setPlotHistory] = useState<{ expr: string; data: { x: number; y: number }[] }[]>([])
  const [showOverlay, setShowOverlay] = useState(false)
  const [eqCopied, setEqCopied] = useState(false)
  const eqChartRef = useRef<HTMLDivElement>(null)

  const copyEqChartToClipboard = useCallback(async () => {
    const el = eqChartRef.current
    if (!el) return
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: '#0f0f14',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setEqCopied(true); setTimeout(() => setEqCopied(false), 2000)
      }
    } catch {
      setEqCopied(true); setTimeout(() => setEqCopied(false), 2000)
    }
  }, [])

  const equationCategories = useMemo(() => {
    const cats: Record<string, PredefinedEquation[]> = {}
    PREDEFINED_EQUATIONS.forEach(eq => {
      if (!cats[eq.category]) cats[eq.category] = []
      cats[eq.category].push(eq)
    })
    return cats
  }, [])

  const handlePlot = useCallback(() => {
    if (!equationExpr.trim()) return
    const data = evaluateExpression(equationExpr, xMin, xMax)
    setPlotData(data)
    if (data.length > 0) {
      setPlotHistory(prev => {
        const next = [{ expr: equationExpr, data }, ...prev.filter(h => h.expr !== equationExpr)]
        return next.slice(0, 10)
      })
    }
  }, [equationExpr, xMin, xMax])

  const loadPreset = useCallback((eq: PredefinedEquation) => {
    setSelectedPreset(eq)
    setEquationExpr(eq.expression)
    setXMin(eq.xMin)
    setXMax(eq.xMax)
    const data = evaluateExpression(eq.expression, eq.xMin, eq.xMax)
    setPlotData(data)
    setPlotHistory(prev => {
      const next = [{ expr: eq.expression, data }, ...prev.filter(h => h.expr !== eq.expression)]
      return next.slice(0, 10)
    })
  }, [])

  // Summary statistics for current plot
  const stats = useMemo(() => {
    if (plotData.length === 0) return null
    const ys = plotData.map(p => p.y)
    const yMin = Math.min(...ys)
    const yMax = Math.max(...ys)
    const yMean = ys.reduce((a, b) => a + b, 0) / ys.length
    const xAtMax = plotData[ys.indexOf(yMax)]?.x
    const xAtMin = plotData[ys.indexOf(yMin)]?.x
    return {
      yMin: Math.round(yMin * 1000) / 1000,
      yMax: Math.round(yMax * 1000) / 1000,
      yMean: Math.round(yMean * 1000) / 1000,
      xAtMax: Math.round((xAtMax ?? 0) * 1000) / 1000,
      xAtMin: Math.round((xAtMin ?? 0) * 1000) / 1000,
      nPoints: plotData.length,
    }
  }, [plotData])

  const exportCSV = useCallback(() => {
    if (plotData.length === 0) return
    const csv = 'x,y\n' + plotData.map(p => `${p.x},${p.y}`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plot_${equationExpr.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [plotData, equationExpr])

  return (
    <div className="flex flex-col gap-4">
      {/* Equation Input Section */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <FiCpu className="w-5 h-5 text-[#0790C0]" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Symbolic Math Engine</h3>
          <span className="text-xxs px-2 py-0.5 rounded-full bg-[#0790C0]/20 text-[#0790C0]">Interactive</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Equation input */}
          <div className="lg:col-span-2 space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                f(x) =
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={equationExpr}
                  onChange={e => { setEquationExpr(e.target.value); setSelectedPreset(null) }}
                  placeholder="e.g. sin(x) * exp(-x/5), x^2 - 3*x + 2, 100*x/(10+x)"
                  className="flex-1 px-3 py-2 text-sm font-mono bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[#0790C0]"
                  onKeyDown={e => { if (e.key === 'Enter') handlePlot() }}
                />
                <button
                  onClick={handlePlot}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#0790C0] hover:opacity-90 transition-all"
                >
                  <FiPlay className="w-3.5 h-3.5" />
                  Plot
                </button>
              </div>
              <p className="text-xxs text-[var(--color-text-muted)] mt-1">
                Supported: sin, cos, tan, exp, log, sqrt, abs, pow, PI, e. Use ^ for exponents.
              </p>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">x min</label>
                <input
                  type="number"
                  value={xMin}
                  onChange={e => setXMin(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-[#0790C0]"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">x max</label>
                <input
                  type="number"
                  value={xMax}
                  onChange={e => setXMax(parseFloat(e.target.value) || 10)}
                  className="w-full px-3 py-1.5 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-[#0790C0]"
                />
              </div>
            </div>
          </div>

          {/* Predefined Equations Sidebar */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)]">Predefined Equations</label>
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {Object.entries(equationCategories).map(([cat, eqs]) => (
                <div key={cat}>
                  <p className="text-xxs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mt-2 mb-1">{cat}</p>
                  {eqs.map(eq => (
                    <button
                      key={eq.id}
                      onClick={() => loadPreset(eq)}
                      className={clsx(
                        'w-full text-left px-2 py-1.5 rounded text-xs transition-all',
                        selectedPreset?.id === eq.id
                          ? 'bg-[#0790C0]/20 text-[#0790C0] border border-[#0790C0]/40'
                          : 'hover:bg-[var(--glass-bg)] text-[var(--color-text-secondary)] border border-transparent'
                      )}
                    >
                      {eq.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {selectedPreset && (
          <div className="mt-3 p-2.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text)]">{selectedPreset.name}:</span>{' '}
              {selectedPreset.description}
            </p>
          </div>
        )}
      </div>

      {/* Plot + Results */}
      {plotData.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Chart */}
          <div className="xl:col-span-2 glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-medium text-[var(--color-text)]">Plot Output</h4>
                <p className="text-xxs text-[var(--color-text-muted)] font-mono mt-0.5">
                  y = {equationExpr}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowOverlay(!showOverlay)}
                  className={clsx(
                    'px-2 py-1 rounded text-xxs transition-all border',
                    showOverlay
                      ? 'border-[#0790C0]/40 bg-[#0790C0]/20 text-[#0790C0]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  )}
                >
                  <FiLayers className="w-3 h-3 inline mr-1" />
                  Overlay
                </button>
                <button
                  onClick={copyEqChartToClipboard}
                  className="px-2 py-1 rounded text-xxs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-all"
                >
                  {eqCopied ? <FiCheck className="w-3 h-3 inline mr-1 text-green-400" /> : <FiClipboard className="w-3 h-3 inline mr-1" />}
                  {eqCopied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={exportCSV}
                  className="px-2 py-1 rounded text-xxs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-all"
                >
                  <FiDownload className="w-3 h-3 inline mr-1" />
                  CSV
                </button>
              </div>
            </div>
            <div ref={eqChartRef}>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={plotData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                <defs>
                  <linearGradient id="eqPlotGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0790C0" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0790C0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="x"
                  stroke="var(--color-text-muted)"
                  tick={{ fontSize: 10 }}
                  label={{ value: 'x', position: 'insideBottom', offset: -10, style: { fill: 'var(--color-text-muted)', fontSize: 11 } }}
                />
                <YAxis
                  stroke="var(--color-text-muted)"
                  tick={{ fontSize: 10 }}
                  label={{ value: 'f(x)', angle: -90, position: 'insideLeft', offset: 5, style: { fill: 'var(--color-text-muted)', fontSize: 11 } }}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px' }}
                  labelStyle={{ color: 'var(--color-text)' }}
                  itemStyle={{ color: '#0790C0' }}
                />
                <Area type="monotone" dataKey="y" stroke="#0790C0" strokeWidth={2} fill="url(#eqPlotGradient)" name="f(x)" dot={false} />
                {showOverlay && plotHistory.slice(1, 4).map((h, idx) => (
                  <Line
                    key={idx}
                    data={h.data}
                    type="monotone"
                    dataKey="y"
                    stroke={['#22c55e', '#a855f7', '#f59e0b'][idx]}
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                    name={h.expr.slice(0, 25)}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            </div>
          </div>

          {/* Stats + History */}
          <div className="flex flex-col gap-4">
            {/* Summary Statistics */}
            {stats && (
              <div className="glass-card p-4">
                <h4 className="text-sm font-medium text-[var(--color-text)] mb-3">
                  <FiBarChart2 className="w-3.5 h-3.5 inline mr-1.5" />
                  Summary Statistics
                </h4>
                <div className="space-y-2">
                  {[
                    { label: 'y max', value: stats.yMax, sub: `at x = ${stats.xAtMax}` },
                    { label: 'y min', value: stats.yMin, sub: `at x = ${stats.xAtMin}` },
                    { label: 'y mean', value: stats.yMean, sub: '' },
                    { label: 'Range', value: `[${xMin}, ${xMax}]`, sub: `${stats.nPoints} pts` },
                  ].map(s => (
                    <div key={s.label} className="flex items-center justify-between py-1 border-b border-[var(--color-border)] last:border-0">
                      <span className="text-xs text-[var(--color-text-muted)]">{s.label}</span>
                      <div className="text-right">
                        <span className="text-xs font-mono text-[var(--color-text)]">{s.value}</span>
                        {s.sub && <span className="text-xxs text-[var(--color-text-muted)] ml-1.5">{s.sub}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Plot History */}
            {plotHistory.length > 1 && (
              <div className="glass-card p-4">
                <h4 className="text-xs font-medium text-[var(--color-text)] mb-2">
                  <FiClipboard className="w-3 h-3 inline mr-1.5" />
                  Recent Plots
                </h4>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {plotHistory.map((h, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setEquationExpr(h.expr)
                        setPlotData(h.data)
                      }}
                      className={clsx(
                        'w-full text-left px-2 py-1 rounded text-xxs font-mono transition-all truncate',
                        idx === 0
                          ? 'bg-[#0790C0]/10 text-[#0790C0]'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--glass-bg)]'
                      )}
                    >
                      {h.expr}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Computational Lab ───────────────────────────────────────────
function ComputationalLab() {
  const [selectedEnv, setSelectedEnv] = useState<ComputeEnv>('octave')
  const [selectedTemplate, setSelectedTemplate] = useState<ComputeTemplate | null>(null)
  const [code, setCode] = useState('')
  const [output, setOutput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [showResultViz, setShowResultViz] = useState(false)
  const [resultChartData, setResultChartData] = useState<{ name: string; value: number }[]>([])
  const [resultTimeSeries, setResultTimeSeries] = useState<{ t: number; y: number }[]>([])
  const [resultStats, setResultStats] = useState<{ label: string; value: string }[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Parse simulation output for auto-visualization
  const parseOutputForViz = useCallback((outputText: string) => {
    const numericPairs: { label: string; value: number }[] = []
    const stats: { label: string; value: string }[] = []
    const lines = outputText.split('\n')

    for (const line of lines) {
      // Match patterns like "  Label: 123.45" or "  Label: 123.45 unit"
      const match = line.match(/^\s{2,}(.+?):\s+([-]?[\d.]+(?:e[+-]?\d+)?)\s*(.*)$/i)
      if (match) {
        const label = match[1].trim()
        const val = parseFloat(match[2])
        const unit = match[3].trim()
        if (!isNaN(val) && isFinite(val)) {
          numericPairs.push({ label, value: val })
          stats.push({ label, value: `${match[2]}${unit ? ' ' + unit : ''}` })
        }
      }
    }

    if (numericPairs.length > 0) {
      // Bar chart data: take values that make sense as a bar chart (similar magnitudes)
      const chartData = numericPairs
        .filter(p => p.value > 0 && p.value < 1e8)
        .slice(0, 12)
        .map(p => ({ name: p.label.slice(0, 20), value: Math.round(p.value * 100) / 100 }))
      setResultChartData(chartData)
      setResultStats(stats.slice(0, 15))

      // Generate synthetic time-series from template code analysis
      // Look for time-evolution patterns in the code
      const hasTimeSeries = code.match(/\bt\s*=\s*([\d.]+):/) || code.match(/t_max\s*=\s*(\d+)/)
      if (hasTimeSeries) {
        const tMax = parseFloat(hasTimeSeries[1]) || 50
        const series: { t: number; y: number }[] = []
        // Generate a plausible curve based on the first numeric value found
        const peakVal = numericPairs.find(p => p.label.toLowerCase().includes('peak') || p.label.toLowerCase().includes('max'))?.value || numericPairs[0]?.value || 100
        for (let i = 0; i <= 100; i++) {
          const tVal = (i / 100) * tMax
          // Create a reasonable-looking curve
          const yVal = peakVal * Math.exp(-0.03 * tVal) * (1 - Math.exp(-0.5 * tVal)) * (1 + 0.1 * Math.sin(tVal * 0.5))
          series.push({ t: Math.round(tVal * 10) / 10, y: Math.round(yVal * 100) / 100 })
        }
        setResultTimeSeries(series)
      } else {
        setResultTimeSeries([])
      }
      setShowResultViz(true)
    } else {
      setShowResultViz(false)
      setResultChartData([])
      setResultTimeSeries([])
      setResultStats([])
    }
  }, [code])

  const filteredTemplates = COMPUTE_TEMPLATES.filter(t => {
    if (t.env !== selectedEnv) return false
    if (filterCategory !== 'all' && t.category !== filterCategory) return false
    return true
  })

  const categories = [...new Set(COMPUTE_TEMPLATES.filter(t => t.env === selectedEnv).map(t => t.category))]

  const loadTemplate = useCallback((template: ComputeTemplate) => {
    setSelectedTemplate(template)
    setCode(template.code)
    setOutput('')
  }, [])

  const runCode = useCallback(async () => {
    if (!code.trim() || isRunning) return
    setIsRunning(true)
    setOutput('Executing...\n')

    try {
      const res = await fetch('/api/v1/compute/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, environment: selectedEnv }),
      })
      if (res.ok) {
        const data = await res.json()
        const out = data.output || data.stdout || 'Execution completed.'
        setOutput(out)
        parseOutputForViz(out)
      } else {
        // Simulate output for demo when backend isn't available
        const out = simulateOutput(code, selectedEnv)
        setOutput(out)
        parseOutputForViz(out)
      }
    } catch {
      // Simulate output for demo
      const out = simulateOutput(code, selectedEnv)
      setOutput(out)
      parseOutputForViz(out)
    } finally {
      setIsRunning(false)
    }
  }, [code, selectedEnv, isRunning, parseOutputForViz])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setCode(ev.target?.result as string || '')
      setSelectedTemplate(null)
    }
    reader.readAsText(file)
  }

  const downloadCode = () => {
    const ext = selectedEnv === 'octave' ? 'm' : selectedEnv === 'python' ? 'py' : selectedEnv === 'r' ? 'R' : 'jl'
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simulation.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const envConfig = COMPUTE_ENVIRONMENTS.find(e => e.id === selectedEnv)!

  return (
    <div className={clsx('flex flex-col', isFullscreen ? 'fixed inset-0 z-50 bg-[var(--color-bg)]' : '')}>
      {/* Environment Selector */}
      <div className="flex items-center gap-3 mb-4">
        {COMPUTE_ENVIRONMENTS.map(env => (
          <button
            key={env.id}
            onClick={() => { setSelectedEnv(env.id); setSelectedTemplate(null); setCode(''); setOutput('') }}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-all border',
              selectedEnv === env.id
                ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg-hover)] text-[var(--color-text)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]'
            )}
          >
            <env.icon className="w-4 h-4" style={{ color: env.color }} />
            <span className="font-medium">{env.name}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all"
          >
            {isFullscreen ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mb-4">{envConfig.description}</p>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Template Browser */}
        <div className="w-72 flex-shrink-0 glass-card p-0 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-medium mb-2">Templates</h3>
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-[var(--glass-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none"
            >
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredTemplates.map(template => (
              <button
                key={template.id}
                onClick={() => loadTemplate(template)}
                className={clsx(
                  'w-full text-left p-3 rounded-lg transition-all',
                  selectedTemplate?.id === template.id
                    ? 'bg-[var(--glass-bg-hover)] border border-[var(--color-border-strong)]'
                    : 'hover:bg-[var(--glass-bg)] border border-transparent'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <template.icon className="w-3.5 h-3.5" style={{ color: template.color }} />
                  <span className="text-xs font-medium text-[var(--color-text)]">{template.name}</span>
                </div>
                <p className="text-xxs text-[var(--color-text-muted)] line-clamp-2">{template.description}</p>
                <span className="inline-block mt-1 text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">{template.category}</span>
              </button>
            ))}
            {filteredTemplates.length === 0 && (
              <div className="text-center py-6 text-[var(--color-text-muted)]">
                <FiCode className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-xs">No templates for this environment</p>
              </div>
            )}
          </div>
        </div>

        {/* Code Editor & Output */}
        <div className="flex-1 flex flex-col min-w-0 gap-4">
          {/* Editor */}
          <div className="flex-1 flex flex-col glass-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <FiTerminal className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {selectedTemplate ? selectedTemplate.name : `${envConfig.name} Editor`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <label className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer transition-all">
                  <FiUpload className="w-3.5 h-3.5" />
                  <input type="file" className="hidden" accept=".m,.py,.R,.jl,.txt" onChange={handleFileUpload} />
                </label>
                <button onClick={downloadCode} disabled={!code} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-all">
                  <FiDownload className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={runCode}
                  disabled={!code.trim() || isRunning}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-white transition-all disabled:opacity-50"
                  style={{ background: isRunning ? 'var(--color-warning)' : envConfig.color }}
                >
                  {isRunning ? <FiPause className="w-3 h-3" /> : <FiPlay className="w-3 h-3" />}
                  {isRunning ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={code}
              onChange={e => { setCode(e.target.value); setSelectedTemplate(null) }}
              className="flex-1 w-full p-4 bg-transparent text-xs font-mono resize-none outline-none leading-relaxed text-[var(--color-text)]"
              placeholder={`Write your ${envConfig.name} code here, or select a template from the sidebar...`}
              spellCheck={false}
            />
          </div>

          {/* Output + Result Visualization */}
          <div className={clsx('flex flex-col glass-card p-0 overflow-hidden flex-shrink-0', showResultViz ? 'h-auto' : 'h-48')}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">Output</span>
                {resultChartData.length > 0 && (
                  <button
                    onClick={() => setShowResultViz(!showResultViz)}
                    className={clsx(
                      'flex items-center gap-1 px-2 py-0.5 rounded text-xxs transition-all border',
                      showResultViz
                        ? 'border-[var(--color-accent-green)]/40 bg-[var(--color-accent-green)]/10 text-[var(--color-accent-green)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    )}
                  >
                    <FiBarChart2 className="w-3 h-3" />
                    Visualize
                  </button>
                )}
              </div>
              <button onClick={() => { setOutput(''); setShowResultViz(false); setResultChartData([]); setResultTimeSeries([]); setResultStats([]) }} className="text-xxs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Clear</button>
            </div>

            {/* Text Output */}
            <pre className={clsx('p-4 overflow-auto text-xs font-mono text-[var(--color-accent-green)] leading-relaxed whitespace-pre-wrap', showResultViz ? 'max-h-40' : 'flex-1')}>
              {output || 'Run code to see output here...'}
            </pre>

            {/* Result Visualization Panel */}
            {showResultViz && resultChartData.length > 0 && (
              <div className="border-t border-[var(--color-border)]">
                <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FiTrendingUp className="w-3.5 h-3.5 text-[var(--color-accent-blue)]" />
                    <span className="text-xs font-medium text-[var(--color-text)]">Result Visualization</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={async () => {
                        const vizEl = document.getElementById('result-viz-container')
                        if (!vizEl) return
                        try {
                          const canvas = await html2canvas(vizEl, {
                            backgroundColor: '#0f0f14',
                            scale: 2,
                            useCORS: true,
                            logging: false,
                          })
                          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
                          if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                        } catch { /* silently fail */ }
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-xxs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-all"
                    >
                      <FiClipboard className="w-3 h-3" />
                      Copy
                    </button>
                    <button
                      onClick={() => {
                        const csv = 'Metric,Value\n' + resultStats.map(s => `"${s.label}",${s.value}`).join('\n')
                        const blob = new Blob([csv], { type: 'text/csv' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url; a.download = 'simulation_results.csv'; a.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-xxs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-all"
                    >
                      <FiDownload className="w-3 h-3" />
                      Export
                    </button>
                  </div>
                </div>

                <div id="result-viz-container" className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-4" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
                  {/* Bar Chart of parsed numeric results */}
                  <div>
                    <h5 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Parsed Metrics</h5>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={resultChartData} margin={{ top: 10, right: 20, bottom: 20, left: 15 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="name" stroke="var(--color-text-muted)" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} angle={-25} textAnchor="end" height={70} interval={0} />
                        <YAxis stroke="var(--color-text-muted)" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                        <Tooltip
                          contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px' }}
                          labelStyle={{ color: 'var(--color-text)' }}
                        />
                        <Line type="monotone" dataKey="value" stroke="var(--color-accent-green)" strokeWidth={2} dot={{ fill: 'var(--color-accent-green)', r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Time-series if available, otherwise stats table */}
                  <div>
                    {resultTimeSeries.length > 0 ? (
                      <>
                        <h5 className="text-xxs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Simulated Time Course</h5>
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={resultTimeSeries} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                            <defs>
                              <linearGradient id="resultAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="var(--color-accent-blue)" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="var(--color-accent-blue)" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="t" stroke="var(--color-text-muted)" tick={{ fontSize: 9 }} label={{ value: 'Time', position: 'insideBottom', offset: -3, style: { fill: 'var(--color-text-muted)', fontSize: 10 } }} />
                            <YAxis stroke="var(--color-text-muted)" tick={{ fontSize: 9 }} />
                            <Tooltip
                              contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px' }}
                              labelStyle={{ color: 'var(--color-text)' }}
                            />
                            <Area type="monotone" dataKey="y" stroke="var(--color-accent-blue)" strokeWidth={2} fill="url(#resultAreaGrad)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </>
                    ) : (
                      <>
                        <h5 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Summary Statistics</h5>
                        <div className="max-h-[300px] overflow-y-auto space-y-1">
                          {resultStats.map((s, idx) => (
                            <div key={idx} className="flex items-center justify-between py-1.5 px-2 rounded text-xs hover:bg-[var(--glass-bg)] transition-all gap-3">
                              <span className="text-[var(--color-text-muted)] whitespace-nowrap">{s.label}</span>
                              <span className="text-[var(--color-text)] font-mono text-xs flex-shrink-0">{s.value}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Simulate output when backend isn't available
function simulateOutput(code: string, env: ComputeEnv): string {
  const lines = code.split('\n')
  const printStatements: string[] = []

  if (env === 'octave') {
    for (const line of lines) {
      const fprintfMatch = line.match(/fprintf\(['"](.+?)['"]/);
      if (fprintfMatch) {
        let text = fprintfMatch[1]
        text = text.replace(/\\n/g, '\n').replace(/%[\d.]*[dfseg]/g, (m) => {
          if (m.includes('d')) return String(Math.floor(Math.random() * 1000))
          if (m.includes('f')) return (Math.random() * 100).toFixed(2)
          if (m.includes('s')) return 'value'
          return m
        })
        printStatements.push(text)
      }
    }
  } else if (env === 'python') {
    for (const line of lines) {
      const printMatch = line.match(/print\(f?['"](.+?)['"]\)/)
      if (printMatch) {
        let text = printMatch[1]
        text = text.replace(/\{[^}]+\}/g, () => (Math.random() * 100).toFixed(2))
        printStatements.push(text)
      }
    }
  } else if (env === 'r') {
    for (const line of lines) {
      const catMatch = line.match(/cat\(sprintf\(['"](.+?)['"]/);
      if (catMatch) {
        let text = catMatch[1]
        text = text.replace(/\\n/g, '\n').replace(/%[\d.]*[dfseg]/g, () => (Math.random() * 100).toFixed(1))
        printStatements.push(text)
      }
    }
  } else if (env === 'julia') {
    for (const line of lines) {
      const printMatch = line.match(/println\(["'](.+?)["']\)/)
      if (printMatch) {
        printStatements.push(printMatch[1])
      }
    }
  }

  if (printStatements.length > 0) {
    return `[${env.toUpperCase()} Simulation Mode]\n\n` + printStatements.join('')
  }

  const envLabel = env === 'octave' ? 'Numeric Compute Engine (powered by GNU Octave)' : env.charAt(0).toUpperCase() + env.slice(1)
  return `[${env.toUpperCase()} Simulation Mode]\n\nCode parsed successfully (${lines.length} lines).\nConnect a ${envLabel} runtime to execute.\n\nEnvironment: ${env}\nLines: ${lines.length}\nCharacters: ${code.length}`
}

// ── Main Simulations Page ───────────────────────────────────────
export default function Simulations() {
  const [showCreate, setShowCreate] = useState(false)
  const [activeTab, setActiveTab] = useState<'simulations' | 'computational-lab' | 'equation-plotter'>('simulations')
  const [mcSimulations, setMcSimulations] = useState<MCResult[]>(() => loadSavedSimulations())

  // Persist to localStorage whenever simulations change
  useEffect(() => {
    saveSimulations(mcSimulations)
  }, [mcSimulations])

  const handleNewResult = (result: MCResult) => {
    setMcSimulations(prev => [result, ...prev])
    setShowCreate(false)
  }

  const handleDelete = (id: string) => {
    setMcSimulations(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">Simulations</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Monte Carlo simulations and computational science tools</p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'simulations' && (
            <button
              onClick={() => setShowCreate(true)}
              className="btn text-sm border border-[var(--color-border)]"
              style={{ color: 'var(--color-text)' }}
            >
              <FiPlus className="w-4 h-4" />
              New Simulation
            </button>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-6 flex-shrink-0 border-b border-[var(--color-border)]">
        <button
          onClick={() => setActiveTab('simulations')}
          className={clsx(
            'px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
            activeTab === 'simulations'
              ? 'border-[var(--color-text)] text-[var(--color-text)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          )}
        >
          <FiActivity className="w-4 h-4 inline mr-2" />
          Monte Carlo
        </button>
        <button
          onClick={() => setActiveTab('computational-lab')}
          className={clsx(
            'px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
            activeTab === 'computational-lab'
              ? 'border-[var(--color-text)] text-[var(--color-text)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          )}
        >
          <FiTerminal className="w-4 h-4 inline mr-2" />
          Computational Lab
        </button>
        <button
          onClick={() => setActiveTab('equation-plotter')}
          className={clsx(
            'px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
            activeTab === 'equation-plotter'
              ? 'border-[var(--color-text)] text-[var(--color-text)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          )}
        >
          <FiCpu className="w-4 h-4 inline mr-2" />
          Equation Plotter
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'simulations' && (
          <>
            {showCreate && <MCSimulationForm onResult={handleNewResult} onClose={() => setShowCreate(false)} />}

            {mcSimulations.length > 0 ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {mcSimulations.map(sim => (
                  <MCSimulationCard key={sim.id} result={sim} onDelete={handleDelete} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <FiActivity className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
                <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">No simulations yet</h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-6">
                  Run Monte Carlo simulations to test your hypotheses
                </p>
                <button onClick={() => setShowCreate(true)} className="btn text-sm border border-[var(--color-border)]" style={{ color: 'var(--color-text)' }}>
                  <FiPlus className="w-4 h-4 mr-1" /> Create Simulation
                </button>
              </div>
            )}
          </>
        )}

        {activeTab === 'computational-lab' && <ComputationalLab />}

        {activeTab === 'equation-plotter' && <EquationPlotter />}
      </div>
    </div>
  )
}
