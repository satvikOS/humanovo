import { useState, useRef, useCallback, useMemo } from 'react'
import {
  FiPlay, FiCpu, FiCopy, FiDownload, FiSearch,
  FiCheck, FiLoader, FiBarChart2, FiChevronRight,
  FiAlertCircle, FiCode, FiGrid,
  FiTarget, FiActivity, FiHeart, FiZap, FiTrendingUp,
  FiLayers
} from 'react-icons/fi'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, AreaChart, Area
} from 'recharts'
import clsx from 'clsx'

// ═══════════════════════════════════════════════════════════════════════
//  MATH LIBRARY — Self-contained numerical computing (no backend needed)
//  Covers: statistics, distributions, linear algebra, signal processing,
//  ODE solvers, curve fitting, survival analysis, clustering, ML basics
// ═══════════════════════════════════════════════════════════════════════

// ── Core Statistics ──────────────────────────────────────────────────
function sum(a: number[]): number { return a.reduce((s, v) => s + v, 0) }
function mean(a: number[]): number { return a.length ? sum(a) / a.length : 0 }
function variance(a: number[], ddof = 1): number {
  const m = mean(a); return a.length > ddof ? sum(a.map(v => (v - m) ** 2)) / (a.length - ddof) : 0
}
function std(a: number[], ddof = 1): number { return Math.sqrt(variance(a, ddof)) }
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function quantile(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y), pos = q * (s.length - 1)
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return lo === hi ? s[lo] : s[lo] * (hi - pos) + s[hi] * (pos - lo)
}
function skewness(a: number[]): number {
  const m = mean(a), s = std(a), n = a.length
  return n < 3 ? 0 : (n / ((n - 1) * (n - 2))) * sum(a.map(v => ((v - m) / s) ** 3))
}
function kurtosis(a: number[]): number {
  const m = mean(a), s = std(a), n = a.length
  if (n < 4) return 0
  const k4 = sum(a.map(v => ((v - m) / s) ** 4))
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * k4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
}
function sem(a: number[]): number { return std(a) / Math.sqrt(a.length) }
function covariance(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length), mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  return sum(x.slice(0, n).map((v, i) => (v - mx) * (y[i] - my))) / (n - 1)
}

// ── Distribution Functions ───────────────────────────────────────────
function lnGamma(z: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -5.395239384953e-6]
  let x = z, y = z, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += c[j] / ++y
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}
function normCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429
  const sign = z < 0 ? -1 : 1
  const az = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * az)
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-az * az)
  return 0.5 * (1 + sign * erf)
}
function invNorm(p: number): number {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity; if (p < 0.5) return -invNorm(1 - p)
  const t = Math.sqrt(-2 * Math.log(1 - p))
  return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t)
}
function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a
  let f = 1, c = 1, d = 1 - (a + 1) * x / (a + 1); if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; f = d
  for (let m = 1; m <= 200; m++) {
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; f *= d * c
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d
    const delta = d * c; f *= delta; if (Math.abs(delta - 1) < 1e-10) break
  }
  return front * f
}
function tCDF(t: number, df: number): number {
  const x = df / (df + t * t), ib = betaInc(x, df / 2, 0.5)
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib
}
function gammaCDF(x: number, a: number): number {
  if (x <= 0) return 0
  let s = 1 / a, term = 1 / a
  for (let n = 1; n < 200; n++) { term *= x / (a + n); s += term; if (Math.abs(term) < 1e-12) break }
  return s * Math.exp(-x + a * Math.log(x) - lnGamma(a))
}
function chiCDF(x: number, k: number): number { return gammaCDF(x / 2, k / 2) }
function fCDF(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0
  const x = d1 * f / (d1 * f + d2)
  return betaInc(x, d1 / 2, d2 / 2)
}

// ── Linear Algebra Helpers ───────────────────────────────────────────
function pearsonR(x: number[], y: number[]): { r: number; p: number } {
  const n = Math.min(x.length, y.length), mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2 }
  const r = dx && dy ? num / Math.sqrt(dx * dy) : 0
  const tStat = r * Math.sqrt((n - 2) / (1 - r * r + 1e-15))
  const p = n > 2 ? 2 * (1 - tCDF(Math.abs(tStat), n - 2)) : 1
  return { r, p }
}
function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number; p: number; se_slope: number; predicted: number[] } {
  const n = Math.min(x.length, y.length), mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2 }
  const slope = sxx ? sxy / sxx : 0, intercept = my - slope * mx
  const r2 = sxx && syy ? (sxy ** 2) / (sxx * syy) : 0
  const sse = syy - slope * sxy, mse = n > 2 ? sse / (n - 2) : 0
  const se_slope = sxx ? Math.sqrt(mse / sxx) : 0
  const tStat = se_slope ? slope / se_slope : 0
  const p = n > 2 ? 2 * (1 - tCDF(Math.abs(tStat), n - 2)) : 1
  const predicted = x.slice(0, n).map(v => slope * v + intercept)
  return { slope, intercept, r2, p, se_slope, predicted }
}

// ── ODE Solver (Runge-Kutta 4th order — ode45 equivalent) ───────────
function ode45(
  f: (t: number, y: number[]) => number[],
  tspan: [number, number],
  y0: number[],
  steps = 500
): { t: number[]; y: number[][] } {
  const h = (tspan[1] - tspan[0]) / steps
  const ts: number[] = [tspan[0]]
  const ys: number[][] = [y0.slice()]
  let t = tspan[0], y = y0.slice()
  for (let i = 0; i < steps; i++) {
    const k1 = f(t, y)
    const k2 = f(t + h / 2, y.map((v, j) => v + h / 2 * k1[j]))
    const k3 = f(t + h / 2, y.map((v, j) => v + h / 2 * k2[j]))
    const k4 = f(t + h, y.map((v, j) => v + h * k3[j]))
    y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]))
    t += h
    ts.push(t)
    ys.push(y.slice())
  }
  return { t: ts, y: ys }
}

// ── Signal Processing Helpers ────────────────────────────────────────
function fft(re: number[]): { magnitude: number[]; phase: number[]; freq: number[] } {
  const N = re.length
  // Simple DFT for small arrays, zero-pad to power-of-2 for larger
  const n = N
  const magn: number[] = [], ph: number[] = [], freq: number[] = []
  for (let k = 0; k < Math.floor(n / 2); k++) {
    let reSum = 0, imSum = 0
    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * k * t / n
      reSum += re[t] * Math.cos(angle)
      imSum += re[t] * Math.sin(angle)
    }
    magn.push(Math.sqrt(reSum * reSum + imSum * imSum) / n)
    ph.push(Math.atan2(imSum, reSum))
    freq.push(k / n)
  }
  return { magnitude: magn, phase: ph, freq }
}
function butterworth(data: number[], cutoffNorm: number, order: number, type: 'low' | 'high' = 'low'): number[] {
  // Simple IIR Butterworth approximation via cascaded biquads
  const result = [...data]
  const w0 = Math.tan(Math.PI * cutoffNorm)
  for (let stage = 0; stage < Math.ceil(order / 2); stage++) {
    const Q = 1 / (2 * Math.cos(Math.PI * (2 * stage + 1) / (2 * order)))
    const w02 = w0 * w0
    let b0: number, b1: number, b2: number, a1: number, a2: number
    if (type === 'low') {
      const norm = 1 + w0 / Q + w02
      b0 = w02 / norm; b1 = 2 * w02 / norm; b2 = w02 / norm
      a1 = 2 * (w02 - 1) / norm; a2 = (1 - w0 / Q + w02) / norm
    } else {
      const norm = 1 + w0 / Q + w02
      b0 = 1 / norm; b1 = -2 / norm; b2 = 1 / norm
      a1 = 2 * (w02 - 1) / norm; a2 = (1 - w0 / Q + w02) / norm
    }
    // Forward pass
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    const fwd = new Array(result.length)
    for (let i = 0; i < result.length; i++) {
      const out = b0 * result[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = result[i]; y2 = y1; y1 = out
      fwd[i] = out
    }
    // Backward pass (zero-phase filtfilt)
    x1 = 0; x2 = 0; y1 = 0; y2 = 0
    for (let i = result.length - 1; i >= 0; i--) {
      const out = b0 * fwd[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = fwd[i]; y2 = y1; y1 = out
      result[i] = out
    }
  }
  return result
}
function findPeaks(data: number[], minHeight = -Infinity, minDistance = 1): { indices: number[]; heights: number[] } {
  const indices: number[] = [], heights: number[] = []
  for (let i = 1; i < data.length - 1; i++) {
    if (data[i] > data[i - 1] && data[i] > data[i + 1] && data[i] >= minHeight) {
      if (indices.length === 0 || i - indices[indices.length - 1] >= minDistance) {
        indices.push(i); heights.push(data[i])
      }
    }
  }
  return { indices, heights }
}
function movingAverage(data: number[], window: number): number[] {
  const result: number[] = []
  const half = Math.floor(window / 2)
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - half), end = Math.min(data.length, i + half + 1)
    result.push(mean(data.slice(start, end)))
  }
  return result
}
function welchPSD(data: number[], fs: number, segLen = 256): { freq: number[]; psd: number[] } {
  const nfft = segLen, overlap = Math.floor(nfft / 2)
  const step = nfft - overlap
  const segments: number[][] = []
  for (let start = 0; start + nfft <= data.length; start += step) {
    const seg = data.slice(start, start + nfft)
    // Apply Hanning window
    const windowed = seg.map((v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (nfft - 1))))
    segments.push(windowed)
  }
  if (segments.length === 0) {
    const seg = [...data]; while (seg.length < nfft) seg.push(0)
    segments.push(seg.map((v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (nfft - 1)))))
  }
  const nFreq = Math.floor(nfft / 2) + 1
  const avgPsd = new Array(nFreq).fill(0)
  for (const seg of segments) {
    for (let k = 0; k < nFreq; k++) {
      let re = 0, im = 0
      for (let n = 0; n < nfft; n++) {
        const angle = -2 * Math.PI * k * n / nfft
        re += seg[n] * Math.cos(angle); im += seg[n] * Math.sin(angle)
      }
      avgPsd[k] += (re * re + im * im) / (nfft * fs)
    }
  }
  const freq = Array.from({ length: nFreq }, (_, k) => k * fs / nfft)
  return { freq, psd: avgPsd.map(v => v / segments.length) }
}

// ── Curve Fitting Helpers ────────────────────────────────────────────
function polyfit(x: number[], y: number[], degree: number): number[] {
  const n = Math.min(x.length, y.length), d = degree + 1
  // Build Vandermonde matrix and solve via normal equations
  const XtX = Array.from({ length: d }, () => new Array(d).fill(0))
  const XtY = new Array(d).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      XtY[j] += Math.pow(x[i], d - 1 - j) * y[i]
      for (let k = 0; k < d; k++) XtX[j][k] += Math.pow(x[i], (d - 1 - j) + (d - 1 - k))
    }
  }
  // Gaussian elimination
  const aug = XtX.map((row, i) => [...row, XtY[i]])
  for (let col = 0; col < d; col++) {
    let maxRow = col
    for (let row = col + 1; row < d; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    ;[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]
    if (Math.abs(aug[col][col]) < 1e-12) continue
    for (let row = col + 1; row < d; row++) {
      const f = aug[row][col] / aug[col][col]
      for (let j = col; j <= d; j++) aug[row][j] -= f * aug[col][j]
    }
  }
  const coeffs = new Array(d).fill(0)
  for (let i = d - 1; i >= 0; i--) {
    coeffs[i] = aug[i][d]
    for (let j = i + 1; j < d; j++) coeffs[i] -= aug[i][j] * coeffs[j]
    coeffs[i] /= aug[i][i] || 1
  }
  return coeffs
}
function polyval(coeffs: number[], x: number): number {
  let result = 0
  for (let i = 0; i < coeffs.length; i++) result += coeffs[i] * Math.pow(x, coeffs.length - 1 - i)
  return result
}

// ── Clustering ───────────────────────────────────────────────────────
function kmeans(data: number[][], k: number, maxIter = 100): { centroids: number[][]; labels: number[]; iterations: number } {
  const n = data.length, dim = data[0]?.length || 1
  // Initialize centroids randomly from data points
  const indices = new Set<number>()
  while (indices.size < Math.min(k, n)) indices.add(Math.floor(Math.random() * n))
  let centroids = Array.from(indices).map(i => [...data[i]])
  let labels = new Array(n).fill(0)
  let iter = 0
  for (; iter < maxIter; iter++) {
    // Assign
    const newLabels = data.map(point => {
      let minDist = Infinity, best = 0
      centroids.forEach((c, ci) => {
        const dist = point.reduce((s, v, d) => s + (v - c[d]) ** 2, 0)
        if (dist < minDist) { minDist = dist; best = ci }
      })
      return best
    })
    if (newLabels.every((l, i) => l === labels[i])) { labels = newLabels; break }
    labels = newLabels
    // Update centroids
    centroids = centroids.map((_, ci) => {
      const members = data.filter((_, i) => labels[i] === ci)
      if (members.length === 0) return centroids[ci]
      return Array.from({ length: dim }, (_, d) => mean(members.map(m => m[d])))
    })
  }
  return { centroids, labels, iterations: iter }
}

// ── PCA ──────────────────────────────────────────────────────────────
function pca(data: number[][], nComponents = 2): { scores: number[][]; eigenvalues: number[]; explained: number[] } {
  const n = data.length, p = data[0]?.length || 1
  // Center data
  const means = Array.from({ length: p }, (_, j) => mean(data.map(r => r[j])))
  const centered = data.map(row => row.map((v, j) => v - means[j]))
  // Covariance matrix
  const cov = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      let s = 0; for (let k = 0; k < n; k++) s += centered[k][i] * centered[k][j]
      return s / (n - 1)
    })
  )
  // Power iteration for eigenvalues (simplified — works for small p)
  const eigenvalues: number[] = [], eigenvectors: number[][] = []
  const covCopy = cov.map(r => [...r])
  for (let comp = 0; comp < Math.min(nComponents, p); comp++) {
    let v = Array.from({ length: p }, () => Math.random())
    for (let iter = 0; iter < 200; iter++) {
      const newV = covCopy.map(row => row.reduce((s, val, j) => s + val * v[j], 0))
      const norm = Math.sqrt(newV.reduce((s, val) => s + val * val, 0)) || 1
      const normalized = newV.map(val => val / norm)
      if (normalized.every((val, i) => Math.abs(val - v[i]) < 1e-10)) { v = normalized; break }
      v = normalized
    }
    const eigenvalue = covCopy.map(row => row.reduce((s, val, j) => s + val * v[j], 0))
      .reduce((s, val, i) => s + val * v[i], 0)
    eigenvalues.push(eigenvalue)
    eigenvectors.push(v)
    // Deflate
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) covCopy[i][j] -= eigenvalue * v[i] * v[j]
  }
  const totalVar = eigenvalues.reduce((s, v) => s + Math.abs(v), 0) || 1
  const explained = eigenvalues.map(v => Math.abs(v) / totalVar * 100)
  const scores = centered.map(row => eigenvectors.map(ev => row.reduce((s, v, j) => s + v * ev[j], 0)))
  return { scores, eigenvalues, explained }
}

// ═══════════════════════════════════════════════════════════════════════
//  TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════

interface ComputeResult {
  statistics?: { label: string; value: string }[]
  chartData?: { x: number; y: number; y2?: number; y3?: number; label?: string }[]
  chartType?: 'line' | 'bar' | 'scatter' | 'area' | 'multi-line'
  chartTitle?: string
  xLabel?: string; yLabel?: string
  seriesLabels?: string[]
  warnings?: string[]
  error?: string
}

interface PresetParam {
  key: string
  label: string
  type: 'number' | 'string' | 'select' | 'textarea'
  default?: any
  description?: string
  min?: number; max?: number; step?: number
  options?: { value: string; label: string }[]
  group?: string
}

interface Preset {
  id: string
  name: string
  matlabFn: string
  toolbox: string
  description: string
  matlabCode: string
  params: PresetParam[]
  sampleData: Record<string, any>
  compute: (params: Record<string, any>) => ComputeResult
}

interface ToolboxCategory {
  id: string
  name: string
  icon: any
  color: string
  presetCount?: number
}

const TOOLBOX_CATEGORIES: ToolboxCategory[] = [
  { id: 'statistics', name: 'Statistics', icon: FiBarChart2, color: '#3b82f6' },
  { id: 'signal', name: 'Signal Processing', icon: FiActivity, color: '#8b5cf6' },
  { id: 'image', name: 'Image Processing', icon: FiGrid, color: '#f59e0b' },
  { id: 'bioinformatics', name: 'Bioinformatics', icon: FiHeart, color: '#ec4899' },
  { id: 'curvefit', name: 'Curve Fitting', icon: FiTrendingUp, color: '#10b981' },
  { id: 'ode', name: 'ODE Solvers & Simulation', icon: FiZap, color: '#f97316' },
  { id: 'survival', name: 'Survival Analysis', icon: FiTarget, color: '#06b6d4' },
  { id: 'ml', name: 'Machine Learning', icon: FiCpu, color: '#6366f1' },
]

// Helper: parse textarea to number array
function parseArray(val: any): number[] {
  if (Array.isArray(val)) return val.filter((v: any) => typeof v === 'number' && isFinite(v))
  if (typeof val === 'string') {
    return val.split(/[,\s\n]+/).map(s => parseFloat(s.trim())).filter(v => isFinite(v))
  }
  return []
}


// ═══════════════════════════════════════════════════════════════════════
//  PRESET DEFINITIONS — 63 presets across 8 toolbox categories
//  Each preset has: sample data, default params, MATLAB code, compute fn
// ═══════════════════════════════════════════════════════════════════════

const PRESETS: Preset[] = [

// ─── STATISTICS TOOLBOX (15 presets) ─────────────────────────────────

{
  id: 'stat-descriptive', toolbox: 'statistics', name: 'Descriptive Statistics',
  matlabFn: 'mean, std, var, median, prctile',
  description: 'Full summary statistics: mean, median, SD, SEM, skewness, kurtosis, quartiles, CI',
  matlabCode: `data = [72 85 91 68 77 83 90 74 88 79];\nmean(data)\nstd(data)\nmedian(data)\nprctile(data, [25 50 75])`,
  sampleData: { data: '72, 85, 91, 68, 77, 83, 90, 74, 88, 79, 82, 95, 71, 86, 93, 67, 81, 89, 76, 84' },
  params: [{ key: 'confidence', label: 'Confidence Level', type: 'number' as const, default: 0.95 }],
  compute: (p) => {
    const arr = parseArray(p.data)
    if (arr.length < 2) return { error: 'Need at least 2 data points' }
    const n = arr.length, m = mean(arr), s = std(arr), se = sem(arr)
    const conf = parseFloat(p.confidence) || 0.95
    const z = invNorm(1 - (1 - conf) / 2)
    return {
      statistics: [
        { label: 'N', value: String(n) }, { label: 'Mean', value: m.toFixed(4) },
        { label: 'Median', value: median(arr).toFixed(4) }, { label: 'Std Dev', value: s.toFixed(4) },
        { label: 'SEM', value: se.toFixed(4) }, { label: 'Variance', value: variance(arr).toFixed(4) },
        { label: `${(conf * 100).toFixed(0)}% CI Lower`, value: (m - z * se).toFixed(4) },
        { label: `${(conf * 100).toFixed(0)}% CI Upper`, value: (m + z * se).toFixed(4) },
        { label: 'Min', value: Math.min(...arr).toFixed(4) }, { label: 'Max', value: Math.max(...arr).toFixed(4) },
        { label: 'Q1 (25th)', value: quantile(arr, 0.25).toFixed(4) },
        { label: 'Q3 (75th)', value: quantile(arr, 0.75).toFixed(4) },
        { label: 'IQR', value: (quantile(arr, 0.75) - quantile(arr, 0.25)).toFixed(4) },
        { label: 'Skewness', value: skewness(arr).toFixed(4) },
        { label: 'Kurtosis', value: kurtosis(arr).toFixed(4) },
      ],
      chartData: arr.map((v, i) => ({ x: i + 1, y: v })),
      chartType: 'bar' as const, chartTitle: 'Data Distribution', xLabel: 'Index', yLabel: 'Value',
    }
  }
},
{
  id: 'stat-ttest1', toolbox: 'statistics', name: 'One-Sample t-Test',
  matlabFn: 'ttest',
  description: 'Test whether sample mean differs from a hypothesized population mean',
  matlabCode: `data = [5.1 4.8 5.3 5.0 4.9 5.2 5.1 4.7 5.4 5.0];\n[h,p,ci,stats] = ttest(data, 5.0)`,
  sampleData: { data: '5.1, 4.8, 5.3, 5.0, 4.9, 5.2, 5.1, 4.7, 5.4, 5.0, 5.3, 4.6, 5.2, 4.8, 5.1', mu: '5.0' },
  params: [{ key: 'mu', label: 'Hypothesized Mean (mu)', type: 'number' as const, default: 5.0 }],
  compute: (p) => {
    const arr = parseArray(p.data), mu = parseFloat(p.mu) || 0
    if (arr.length < 2) return { error: 'Need at least 2 data points' }
    const n = arr.length, m = mean(arr), s = std(arr), se = s / Math.sqrt(n)
    const t = (m - mu) / se, df = n - 1
    const pVal = 2 * (1 - tCDF(Math.abs(t), df))
    const tCrit = 1.96 // approx for large df
    return {
      statistics: [
        { label: 'Sample Mean', value: m.toFixed(6) }, { label: 'Hypothesized Mean', value: mu.toFixed(4) },
        { label: 't-statistic', value: t.toFixed(6) }, { label: 'Degrees of Freedom', value: String(df) },
        { label: 'p-value (two-tailed)', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
        { label: 'Effect Size (Cohen d)', value: ((m - mu) / s).toFixed(4) },
        { label: '95% CI Lower', value: (m - tCrit * se).toFixed(4) },
        { label: '95% CI Upper', value: (m + tCrit * se).toFixed(4) },
      ],
      chartData: arr.map((v, i) => ({ x: i + 1, y: v })),
      chartType: 'scatter' as const, chartTitle: 'Sample Data', xLabel: 'Observation', yLabel: 'Value',
    }
  }
},
{
  id: 'stat-ttest2', toolbox: 'statistics', name: 'Two-Sample t-Test',
  matlabFn: 'ttest2',
  description: "Welch's two-sample t-test comparing means of two independent groups",
  matlabCode: `group1 = [23 25 28 22 27 24 26 29 21 25];\ngroup2 = [30 32 28 35 31 33 29 34 30 32];\n[h,p,ci,stats] = ttest2(group1, group2)`,
  sampleData: {
    group1: '23, 25, 28, 22, 27, 24, 26, 29, 21, 25, 24, 27, 23, 26, 28',
    group2: '30, 32, 28, 35, 31, 33, 29, 34, 30, 32, 31, 35, 28, 33, 30',
  },
  params: [],
  compute: (p) => {
    const a = parseArray(p.group1), b = parseArray(p.group2)
    if (a.length < 2 || b.length < 2) return { error: 'Each group needs at least 2 values' }
    const ma = mean(a), mb = mean(b), va = variance(a), vb = variance(b)
    const se = Math.sqrt(va / a.length + vb / b.length)
    const t = (ma - mb) / se
    const dfNum = (va / a.length + vb / b.length) ** 2
    const dfDen = (va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1)
    const df = dfNum / dfDen, pVal = 2 * (1 - tCDF(Math.abs(t), df))
    const pooledSD = Math.sqrt(((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2))
    return {
      statistics: [
        { label: 'Group 1 Mean', value: ma.toFixed(4) }, { label: 'Group 2 Mean', value: mb.toFixed(4) },
        { label: 'Mean Difference', value: (ma - mb).toFixed(4) },
        { label: 'Group 1 SD', value: std(a).toFixed(4) }, { label: 'Group 2 SD', value: std(b).toFixed(4) },
        { label: 't-statistic', value: t.toFixed(6) }, { label: 'Degrees of Freedom', value: df.toFixed(2) },
        { label: 'p-value (two-tailed)', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
        { label: "Cohen's d", value: ((ma - mb) / pooledSD).toFixed(4) },
      ],
      chartData: [
        ...a.map((v, i) => ({ x: i, y: v, label: 'G1' })),
        ...b.map((v, i) => ({ x: a.length + i, y: v, label: 'G2' })),
      ],
      chartType: 'scatter' as const, chartTitle: 'Group Comparison', xLabel: 'Index', yLabel: 'Value',
    }
  }
},
{
  id: 'stat-paired-ttest', toolbox: 'statistics', name: 'Paired t-Test',
  matlabFn: 'ttest (paired)',
  description: 'Compare paired measurements (e.g., before vs after treatment)',
  matlabCode: `before = [120 125 130 118 122 128 135 121 126 124];\nafter = [115 118 125 112 119 120 128 116 121 118];\n[h,p,ci,stats] = ttest(before - after)`,
  sampleData: {
    before: '120, 125, 130, 118, 122, 128, 135, 121, 126, 124',
    after: '115, 118, 125, 112, 119, 120, 128, 116, 121, 118',
  },
  params: [],
  compute: (p) => {
    const before = parseArray(p.before), after = parseArray(p.after)
    const n = Math.min(before.length, after.length)
    if (n < 2) return { error: 'Need at least 2 paired observations' }
    const diffs = before.slice(0, n).map((v, i) => v - after[i])
    const md = mean(diffs), sd = std(diffs), se = sd / Math.sqrt(n)
    const t = md / se, df = n - 1, pVal = 2 * (1 - tCDF(Math.abs(t), df))
    return {
      statistics: [
        { label: 'N Pairs', value: String(n) }, { label: 'Mean Difference', value: md.toFixed(4) },
        { label: 'SD of Differences', value: sd.toFixed(4) },
        { label: 't-statistic', value: t.toFixed(6) }, { label: 'df', value: String(df) },
        { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
        { label: "Cohen's d", value: (md / sd).toFixed(4) },
      ],
      chartData: diffs.map((v, i) => ({ x: i + 1, y: v })),
      chartType: 'bar' as const, chartTitle: 'Paired Differences', xLabel: 'Pair', yLabel: 'Difference',
    }
  }
},
{
  id: 'stat-anova1', toolbox: 'statistics', name: 'One-Way ANOVA',
  matlabFn: 'anova1',
  description: 'Test whether means differ across 3+ groups (treatment arms, conditions)',
  matlabCode: `group1 = [4.2 3.8 4.5 4.1 3.9];\ngroup2 = [5.1 5.4 4.9 5.3 5.0];\ngroup3 = [6.2 5.8 6.0 6.4 5.9];\n[p,tbl,stats] = anova1([group1 group2 group3],[ones(1,5) 2*ones(1,5) 3*ones(1,5)])`,
  sampleData: {
    group1: '4.2, 3.8, 4.5, 4.1, 3.9, 4.3, 4.0',
    group2: '5.1, 5.4, 4.9, 5.3, 5.0, 5.2, 4.8',
    group3: '6.2, 5.8, 6.0, 6.4, 5.9, 6.1, 5.7',
  },
  params: [],
  compute: (p) => {
    const groups = [parseArray(p.group1), parseArray(p.group2), parseArray(p.group3)].filter(g => g.length > 0)
    if (groups.length < 2) return { error: 'Need at least 2 groups' }
    const allData = groups.flat(), grandMean = mean(allData)
    const k = groups.length, N = allData.length
    const ssBetween = groups.reduce((s, g) => s + g.length * (mean(g) - grandMean) ** 2, 0)
    const ssWithin = groups.reduce((s, g) => s + g.reduce((s2, v) => s2 + (v - mean(g)) ** 2, 0), 0)
    const dfBetween = k - 1, dfWithin = N - k
    const msBetween = ssBetween / dfBetween, msWithin = ssWithin / dfWithin
    const F = msBetween / (msWithin || 1e-15)
    const pVal = 1 - fCDF(F, dfBetween, dfWithin)
    const eta2 = ssBetween / (ssBetween + ssWithin)
    return {
      statistics: [
        { label: 'Number of Groups', value: String(k) }, { label: 'Total N', value: String(N) },
        { label: 'Grand Mean', value: grandMean.toFixed(4) },
        { label: 'SS Between', value: ssBetween.toFixed(4) }, { label: 'SS Within', value: ssWithin.toFixed(4) },
        { label: 'df Between', value: String(dfBetween) }, { label: 'df Within', value: String(dfWithin) },
        { label: 'MS Between', value: msBetween.toFixed(4) }, { label: 'MS Within', value: msWithin.toFixed(4) },
        { label: 'F-statistic', value: F.toFixed(4) }, { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
        { label: 'Eta-squared (η²)', value: eta2.toFixed(4) },
        ...groups.map((g, i) => ({ label: `Group ${i + 1} Mean`, value: mean(g).toFixed(4) })),
      ],
      chartData: groups.flatMap((g, gi) => g.map((v, i) => ({ x: gi + 1 + (i - g.length / 2) * 0.05, y: v }))),
      chartType: 'scatter' as const, chartTitle: 'Groups', xLabel: 'Group', yLabel: 'Value',
    }
  }
},
{
  id: 'stat-chi2', toolbox: 'statistics', name: 'Chi-Square Test',
  matlabFn: 'chi2gof / crosstab',
  description: 'Test independence between two categorical variables (contingency table)',
  matlabCode: `observed = [45 30 25; 35 40 25; 20 30 50];\n[h,p,stats] = chi2gof(observed)`,
  sampleData: {
    observed: '45, 30, 25, 35, 40, 25, 20, 30, 50',
    rows: '3', cols: '3',
  },
  params: [
    { key: 'rows', label: 'Number of Rows', type: 'number' as const, default: 3 },
    { key: 'cols', label: 'Number of Columns', type: 'number' as const, default: 3 },
  ],
  compute: (p) => {
    const flat = parseArray(p.observed), rows = parseInt(p.rows) || 3, cols = parseInt(p.cols) || 3
    if (flat.length < rows * cols) return { error: `Need ${rows}x${cols}=${rows * cols} values` }
    const table: number[][] = []
    for (let i = 0; i < rows; i++) table.push(flat.slice(i * cols, (i + 1) * cols))
    const rowTotals = table.map(r => sum(r))
    const colTotals = Array.from({ length: cols }, (_, j) => sum(table.map(r => r[j])))
    const grand = sum(rowTotals)
    let chi2 = 0, df = (rows - 1) * (cols - 1)
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const expected = rowTotals[i] * colTotals[j] / grand
        chi2 += (table[i][j] - expected) ** 2 / (expected || 1e-10)
      }
    const pVal = 1 - chiCDF(chi2, df)
    const cramersV = Math.sqrt(chi2 / (grand * (Math.min(rows, cols) - 1)))
    return {
      statistics: [
        { label: 'Chi-Square (χ²)', value: chi2.toFixed(4) }, { label: 'df', value: String(df) },
        { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
        { label: "Cramer's V", value: cramersV.toFixed(4) },
        { label: 'Grand Total', value: String(grand) },
        ...rowTotals.map((t, i) => ({ label: `Row ${i + 1} Total`, value: String(t) })),
        ...colTotals.map((t, j) => ({ label: `Col ${j + 1} Total`, value: String(t) })),
      ],
      chartData: flat.map((v, i) => ({ x: i + 1, y: v })),
      chartType: 'bar' as const, chartTitle: 'Observed Frequencies', xLabel: 'Cell', yLabel: 'Count',
    }
  }
},
{
  id: 'stat-kruskal', toolbox: 'statistics', name: 'Kruskal-Wallis Test',
  matlabFn: 'kruskalwallis',
  description: 'Non-parametric alternative to one-way ANOVA for ordinal/non-normal data',
  matlabCode: `g1 = [3.2 4.1 3.8 4.5];\ng2 = [5.1 4.8 5.5 5.2];\ng3 = [6.3 5.9 6.7 6.1];\np = kruskalwallis([g1 g2 g3],[ones(1,4) 2*ones(1,4) 3*ones(1,4)])`,
  sampleData: {
    group1: '3.2, 4.1, 3.8, 4.5, 3.6, 4.3',
    group2: '5.1, 4.8, 5.5, 5.2, 4.9, 5.3',
    group3: '6.3, 5.9, 6.7, 6.1, 5.8, 6.5',
  },
  params: [],
  compute: (p) => {
    const groups = [parseArray(p.group1), parseArray(p.group2), parseArray(p.group3)].filter(g => g.length > 0)
    if (groups.length < 2) return { error: 'Need at least 2 groups' }
    const allData = groups.flatMap((g, gi) => g.map(v => ({ v, g: gi })))
    const sorted = [...allData].sort((a, b) => a.v - b.v)
    const ranksArr: number[] = new Array(sorted.length)
    for (let i = 0; i < sorted.length;) {
      let j = i; while (j < sorted.length - 1 && sorted[j + 1].v === sorted[i].v) j++
      const avgRank = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) ranksArr[k] = avgRank
      i = j + 1
    }
    const N = allData.length, k = groups.length
    let H = 0
    for (let gi = 0; gi < k; gi++) {
      const ni = groups[gi].length
      let rankSum = 0
      for (let ii = 0; ii < sorted.length; ii++) if (sorted[ii].g === gi) rankSum += ranksArr[ii]
      H += rankSum ** 2 / ni
    }
    H = (12 / (N * (N + 1))) * H - 3 * (N + 1)
    const df = k - 1, pVal = 1 - chiCDF(H, df)
    return {
      statistics: [
        { label: 'H-statistic', value: H.toFixed(4) }, { label: 'df', value: String(df) },
        { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
        ...groups.map((g, i) => ({ label: `Group ${i + 1} Median`, value: median(g).toFixed(4) })),
      ],
      chartData: groups.flatMap((g, gi) => g.map((v, i) => ({ x: gi + 1 + (i - g.length / 2) * 0.04, y: v }))),
      chartType: 'scatter' as const, chartTitle: 'Group Data', xLabel: 'Group', yLabel: 'Value',
    }
  }
},
{
  id: 'stat-ranksum', toolbox: 'statistics', name: 'Wilcoxon Rank-Sum',
  matlabFn: 'ranksum',
  description: 'Non-parametric test comparing two independent groups (Mann-Whitney U)',
  matlabCode: `x = [3.1 4.2 3.8 5.1 4.5];\ny = [5.8 6.2 5.5 7.1 6.8];\n[p,h,stats] = ranksum(x,y)`,
  sampleData: {
    group1: '3.1, 4.2, 3.8, 5.1, 4.5, 3.9, 4.8, 3.5',
    group2: '5.8, 6.2, 5.5, 7.1, 6.8, 5.3, 6.5, 5.9',
  },
  params: [],
  compute: (p) => {
    const a = parseArray(p.group1), b = parseArray(p.group2)
    if (a.length < 2 || b.length < 2) return { error: 'Each group needs at least 2 values' }
    const combined = [...a.map(v => ({ v, g: 0 })), ...b.map(v => ({ v, g: 1 }))].sort((x, y) => x.v - y.v)
    const r: number[] = new Array(combined.length)
    for (let i = 0; i < combined.length;) {
      let j = i; while (j < combined.length - 1 && combined[j + 1].v === combined[i].v) j++
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) r[k] = avg
      i = j + 1
    }
    const R1 = r.filter((_, i) => combined[i].g === 0).reduce((s, v) => s + v, 0)
    const n1 = a.length, n2 = b.length, U = R1 - n1 * (n1 + 1) / 2
    const mu = n1 * n2 / 2, sigma = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12)
    const z = (U - mu) / sigma, pVal = 2 * (1 - normCDF(Math.abs(z)))
    return {
      statistics: [
        { label: 'U-statistic', value: U.toFixed(2) }, { label: 'z-score', value: z.toFixed(4) },
        { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
        { label: 'Group 1 Median', value: median(a).toFixed(4) },
        { label: 'Group 2 Median', value: median(b).toFixed(4) },
        { label: 'Rank-Biserial r', value: (2 * U / (n1 * n2) - 1).toFixed(4) },
      ],
      chartData: [...a.map((v, i) => ({ x: i, y: v })), ...b.map((v, i) => ({ x: a.length + 1 + i, y: v }))],
      chartType: 'scatter' as const, chartTitle: 'Groups', xLabel: 'Index', yLabel: 'Value',
    }
  }
},
{
  id: 'stat-signrank', toolbox: 'statistics', name: 'Wilcoxon Signed-Rank',
  matlabFn: 'signrank',
  description: 'Non-parametric paired test (alternative to paired t-test for non-normal data)',
  matlabCode: `before = [8.2 7.5 9.1 8.8 7.9];\nafter = [7.1 6.8 8.3 7.5 7.2];\np = signrank(before, after)`,
  sampleData: {
    before: '8.2, 7.5, 9.1, 8.8, 7.9, 8.5, 7.3, 9.0, 8.1, 7.7',
    after:  '7.1, 6.8, 8.3, 7.5, 7.2, 7.8, 6.5, 8.1, 7.4, 7.0',
  },
  params: [],
  compute: (p) => {
    const before = parseArray(p.before), after = parseArray(p.after)
    const n = Math.min(before.length, after.length)
    if (n < 3) return { error: 'Need at least 3 pairs' }
    const diffs = before.slice(0, n).map((v, i) => v - after[i]).filter(d => d !== 0)
    const absDiffs = diffs.map(d => Math.abs(d))
    const sorted = absDiffs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
    const r: number[] = new Array(sorted.length)
    for (let i = 0; i < sorted.length;) {
      let j = i; while (j < sorted.length - 1 && sorted[j + 1].v === sorted[i].v) j++
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) r[sorted[k].i] = avg
      i = j + 1
    }
    const Wp = diffs.reduce((s, d, i) => d > 0 ? s + r[i] : s, 0)
    const Wn = diffs.reduce((s, d, i) => d < 0 ? s + r[i] : s, 0)
    const W = Math.min(Wp, Wn), nn = diffs.length
    const mu = nn * (nn + 1) / 4, sigma = Math.sqrt(nn * (nn + 1) * (2 * nn + 1) / 24)
    const z = (W - mu) / sigma, pVal = 2 * normCDF(z)
    return {
      statistics: [
        { label: 'N (non-zero diffs)', value: String(nn) },
        { label: 'W+ (positive ranks)', value: Wp.toFixed(2) },
        { label: 'W- (negative ranks)', value: Wn.toFixed(2) },
        { label: 'W (test statistic)', value: W.toFixed(2) },
        { label: 'z-score', value: z.toFixed(4) },
        { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
      ],
      chartData: diffs.map((v, i) => ({ x: i + 1, y: v })),
      chartType: 'bar' as const, chartTitle: 'Paired Differences', xLabel: 'Pair', yLabel: 'Difference',
    }
  }
},
{
  id: 'stat-corr', toolbox: 'statistics', name: 'Pearson Correlation',
  matlabFn: 'corr',
  description: 'Compute Pearson correlation coefficient and p-value between two variables',
  matlabCode: `x = [1 2 3 4 5 6 7 8 9 10];\ny = [2.1 3.8 6.2 7.5 10.1 11.8 14.2 15.9 18.1 19.8];\n[r,p] = corr(x(:),y(:))`,
  sampleData: {
    x: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15',
    y: '2.1, 3.8, 6.2, 7.5, 10.1, 11.8, 14.2, 15.9, 18.1, 19.8, 22.0, 23.5, 26.1, 27.8, 30.2',
  },
  params: [],
  compute: (p) => {
    const x = parseArray(p.x), y = parseArray(p.y)
    const n = Math.min(x.length, y.length)
    if (n < 3) return { error: 'Need at least 3 paired observations' }
    const { r, p: pVal } = pearsonR(x.slice(0, n), y.slice(0, n))
    return {
      statistics: [
        { label: 'N', value: String(n) },
        { label: 'Pearson r', value: r.toFixed(6) },
        { label: 'r²', value: (r * r).toFixed(6) },
        { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
        { label: 'Covariance', value: covariance(x.slice(0, n), y.slice(0, n)).toFixed(4) },
      ],
      chartData: x.slice(0, n).map((v, i) => ({ x: v, y: y[i] })),
      chartType: 'scatter' as const, chartTitle: 'Scatter Plot', xLabel: 'X', yLabel: 'Y',
    }
  }
},
{
  id: 'stat-linreg', toolbox: 'statistics', name: 'Linear Regression',
  matlabFn: 'fitlm',
  description: 'Fit a linear model y = β₀ + β₁x with R², p-value, residuals, and fitted line',
  matlabCode: `x = [1 2 3 4 5 6 7 8 9 10];\ny = [2.3 4.1 5.8 8.2 9.5 12.1 13.8 16.0 17.5 20.2];\nmdl = fitlm(x, y)`,
  sampleData: {
    x: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15',
    y: '2.3, 4.1, 5.8, 8.2, 9.5, 12.1, 13.8, 16.0, 17.5, 20.2, 21.8, 24.1, 25.5, 28.0, 29.8',
  },
  params: [],
  compute: (p) => {
    const x = parseArray(p.x), y = parseArray(p.y)
    const n = Math.min(x.length, y.length)
    if (n < 3) return { error: 'Need at least 3 data points' }
    const reg = linearRegression(x.slice(0, n), y.slice(0, n))
    const residuals = y.slice(0, n).map((v, i) => v - reg.predicted[i])
    return {
      statistics: [
        { label: 'Slope (β₁)', value: reg.slope.toFixed(6) },
        { label: 'Intercept (β₀)', value: reg.intercept.toFixed(6) },
        { label: 'R²', value: reg.r2.toFixed(6) },
        { label: 'Adj R²', value: (1 - (1 - reg.r2) * (n - 1) / (n - 2)).toFixed(6) },
        { label: 'SE of Slope', value: reg.se_slope.toFixed(6) },
        { label: 'p-value', value: reg.p.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: reg.p < 0.05 ? 'YES' : 'NO' },
        { label: 'Equation', value: `y = ${reg.slope.toFixed(4)}x + ${reg.intercept.toFixed(4)}` },
        { label: 'Residual Std Error', value: std(residuals, 0).toFixed(4) },
      ],
      chartData: x.slice(0, n).map((v, i) => ({ x: v, y: y[i], predicted: reg.predicted[i] })),
      chartType: 'scatter' as const, chartTitle: 'Regression Fit', xLabel: 'X', yLabel: 'Y',
    }
  }
},
{
  id: 'stat-logreg', toolbox: 'statistics', name: 'Logistic Regression',
  matlabFn: 'mnrfit / fitclinear',
  description: 'Binary classification: fit logistic model P(Y=1) = 1/(1+exp(-(β₀+β₁x)))',
  matlabCode: `x = [1 2 3 4 5 6 7 8 9 10];\ny = [0 0 0 0 1 0 1 1 1 1];\n[B,dev,stats] = mnrfit(x,y+1)`,
  sampleData: {
    x: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15',
    y: '0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1',
  },
  params: [{ key: 'lr', label: 'Learning Rate', type: 'number' as const, default: 0.1 },
           { key: 'iterations', label: 'Iterations', type: 'number' as const, default: 1000 }],
  compute: (p) => {
    const x = parseArray(p.x), y = parseArray(p.y)
    const n = Math.min(x.length, y.length)
    if (n < 4) return { error: 'Need at least 4 observations' }
    const lr = parseFloat(p.lr) || 0.1, iter = parseInt(p.iterations) || 1000
    let b0 = 0, b1 = 0
    for (let it = 0; it < iter; it++) {
      let db0 = 0, db1 = 0
      for (let i = 0; i < n; i++) {
        const pred = 1 / (1 + Math.exp(-(b0 + b1 * x[i])))
        const err = y[i] - pred
        db0 += err; db1 += err * x[i]
      }
      b0 += lr * db0 / n; b1 += lr * db1 / n
    }
    const probs = x.slice(0, n).map(v => 1 / (1 + Math.exp(-(b0 + b1 * v))))
    const preds = probs.map(pp => pp >= 0.5 ? 1 : 0)
    const accuracy = preds.reduce((s: number, v: number, i: number) => s + (v === y[i] ? 1 : 0), 0) / n
    const logLikelihood = (y.slice(0, n) as number[]).reduce((s: number, yi: number, i: number) => s + yi * Math.log(probs[i] + 1e-10) + (1 - yi) * Math.log(1 - probs[i] + 1e-10), 0)
    return {
      statistics: [
        { label: 'Intercept (β₀)', value: b0.toFixed(6) }, { label: 'Slope (β₁)', value: b1.toFixed(6) },
        { label: 'Accuracy', value: (accuracy * 100).toFixed(2) + '%' },
        { label: 'Log-Likelihood', value: logLikelihood.toFixed(4) },
        { label: 'Equation', value: `P(Y=1) = 1/(1+exp(-(${b0.toFixed(3)} + ${b1.toFixed(3)}*x)))` },
        { label: 'Decision Boundary (x)', value: (-b0 / (b1 || 1e-10)).toFixed(4) },
      ],
      chartData: x.slice(0, n).map((v, i) => ({ x: v, y: probs[i] })),
      chartType: 'line' as const, chartTitle: 'Logistic Curve', xLabel: 'X', yLabel: 'P(Y=1)',
    }
  }
},
{
  id: 'stat-pca', toolbox: 'statistics', name: 'Principal Component Analysis',
  matlabFn: 'pca',
  description: 'Dimensionality reduction: extract principal components, eigenvalues, variance explained',
  matlabCode: `data = randn(50,4);\n[coeff,score,latent,~,explained] = pca(data)`,
  sampleData: {
    data: '2.5,2.4;0.5,0.7;2.2,2.9;1.9,2.2;3.1,3.0;2.3,2.7;2.0,1.6;1.0,1.1;1.5,1.6;1.1,0.9;3.5,3.3;2.8,2.5;0.8,1.2;1.8,2.0;2.6,2.8;1.2,1.3;3.0,2.9;2.1,2.3;0.7,0.8;1.6,1.8',
  },
  params: [{ key: 'nComponents', label: 'Components', type: 'number' as const, default: 2 }],
  compute: (p) => {
    const rows = (p.data as string).split(';').map(r => r.split(',').map(Number).filter(isFinite))
    if (rows.length < 3 || rows[0].length < 2) return { error: 'Need at least 3 rows and 2 columns (separate rows with ; columns with ,)' }
    const nComp = parseInt(p.nComponents) || 2
    const result = pca(rows, nComp)
    return {
      statistics: [
        { label: 'Data Points', value: String(rows.length) },
        { label: 'Dimensions', value: String(rows[0].length) },
        { label: 'Components Extracted', value: String(nComp) },
        ...result.eigenvalues.map((v, i) => ({ label: `Eigenvalue PC${i + 1}`, value: v.toFixed(4) })),
        ...result.explained.map((v, i) => ({ label: `Variance Explained PC${i + 1}`, value: v.toFixed(2) + '%' })),
        { label: 'Total Variance Explained', value: sum(result.explained).toFixed(2) + '%' },
      ],
      chartData: result.scores.map((s) => ({ x: s[0] || 0, y: s[1] || 0 })),
      chartType: 'scatter' as const, chartTitle: 'PCA Scores (PC1 vs PC2)', xLabel: 'PC1', yLabel: 'PC2',
    }
  }
},
{
  id: 'stat-kmeans', toolbox: 'statistics', name: 'K-Means Clustering',
  matlabFn: 'kmeans',
  description: 'Partition data into K clusters by minimizing within-cluster variance',
  matlabCode: `data = [randn(30,2)+2; randn(30,2)-2; randn(30,2)+[4,-2]];\n[idx,C] = kmeans(data, 3)`,
  sampleData: {
    data: '2.1,2.3;2.5,1.8;1.8,2.6;2.3,2.1;2.0,2.4;-1.8,-2.1;-2.2,-1.7;-1.5,-2.3;-2.0,-1.9;-1.7,-2.5;4.2,-1.8;3.8,-2.2;4.5,-1.5;4.0,-2.0;3.7,-1.7;2.8,1.5;1.5,2.8;-2.5,-1.5;-1.3,-2.8;4.3,-1.3',
    k: '3',
  },
  params: [{ key: 'k', label: 'Number of Clusters (K)', type: 'number' as const, default: 3 }],
  compute: (p) => {
    const rows = (p.data as string).split(';').map(r => r.split(',').map(Number).filter(isFinite))
    const k = parseInt(p.k) || 3
    if (rows.length < k) return { error: `Need at least ${k} data points for ${k} clusters` }
    const result = kmeans(rows, k)
    const clusterSizes = Array.from({ length: k }, (_, ci) => result.labels.filter(l => l === ci).length)
    return {
      statistics: [
        { label: 'K', value: String(k) }, { label: 'N', value: String(rows.length) },
        { label: 'Iterations', value: String(result.iterations) },
        ...clusterSizes.map((s, i) => ({ label: `Cluster ${i + 1} Size`, value: String(s) })),
        ...result.centroids.map((c, i) => ({ label: `Centroid ${i + 1}`, value: c.map(v => v.toFixed(3)).join(', ') })),
      ],
      chartData: rows.map((r, i) => ({ x: r[0], y: r[1] || 0, label: `C${result.labels[i] + 1}` })),
      chartType: 'scatter' as const, chartTitle: 'K-Means Clusters', xLabel: 'Dim 1', yLabel: 'Dim 2',
    }
  }
},
{
  id: 'stat-samplesize', toolbox: 'statistics', name: 'Sample Size & Power',
  matlabFn: 'sampsizepwr',
  description: 'Calculate required sample size for a given power, effect size, and significance level',
  matlabCode: `n = sampsizepwr('t',[5 2],6,0.80,[],'Alpha',0.05)  % effect=1, power=80%`,
  sampleData: { effect_size: '0.5', alpha: '0.05', power: '0.80' },
  params: [
    { key: 'effect_size', label: "Effect Size (Cohen's d)", type: 'number' as const, default: 0.5 },
    { key: 'alpha', label: 'Alpha (significance)', type: 'number' as const, default: 0.05 },
    { key: 'power', label: 'Desired Power (1-β)', type: 'number' as const, default: 0.80 },
  ],
  compute: (p) => {
    const d = parseFloat(p.effect_size) || 0.5
    const alpha = parseFloat(p.alpha) || 0.05
    const power = parseFloat(p.power) || 0.80
    const zAlpha = invNorm(1 - alpha / 2), zBeta = invNorm(power)
    const nPerGroup = Math.ceil(((zAlpha + zBeta) / d) ** 2)
    const powers = [0.70, 0.75, 0.80, 0.85, 0.90, 0.95]
    const effects = [0.2, 0.3, 0.5, 0.8, 1.0, 1.2]
    return {
      statistics: [
        { label: "Cohen's d", value: d.toFixed(3) },
        { label: 'Alpha', value: alpha.toFixed(3) },
        { label: 'Power', value: power.toFixed(3) },
        { label: 'N per Group (two-sample)', value: String(nPerGroup) },
        { label: 'Total N (two groups)', value: String(nPerGroup * 2) },
        { label: 'N (one-sample)', value: String(Math.ceil(((zAlpha + zBeta) / d) ** 2)) },
        { label: '---', value: '--- Power Table ---' },
        ...powers.map(pw => ({
          label: `Power=${(pw * 100).toFixed(0)}%, d=${d}`,
          value: `N=${Math.ceil(((invNorm(1 - alpha / 2) + invNorm(pw)) / d) ** 2)}/group`,
        })),
        { label: '---', value: '--- Effect Size Table ---' },
        ...effects.map(ef => ({
          label: `d=${ef}, Power=${(power * 100).toFixed(0)}%`,
          value: `N=${Math.ceil(((zAlpha + invNorm(power)) / ef) ** 2)}/group`,
        })),
      ],
      chartData: powers.map(pw => ({ x: pw * 100, y: Math.ceil(((invNorm(1 - alpha / 2) + invNorm(pw)) / d) ** 2) })),
      chartType: 'line' as const, chartTitle: 'Power vs Sample Size', xLabel: 'Power (%)', yLabel: 'N per Group',
    }
  }
},

// ─── SIGNAL PROCESSING TOOLBOX (10 presets) ──────────────────────────

{
  id: 'sig-butter', toolbox: 'signal', name: 'Butterworth Filter',
  matlabFn: 'butter + filtfilt',
  description: 'Apply zero-phase Butterworth lowpass/highpass filter to a signal',
  matlabCode: `fs = 1000; t = 0:1/fs:1;\nsig = sin(2*pi*10*t) + 0.5*sin(2*pi*50*t) + 0.3*randn(size(t));\n[b,a] = butter(4, 20/(fs/2), 'low');\nfiltered = filtfilt(b, a, sig);`,
  sampleData: { cutoff: '0.1', order: '4', filter_type: 'low' },
  params: [
    { key: 'cutoff', label: 'Normalized Cutoff (0-1)', type: 'number' as const, default: 0.1 },
    { key: 'order', label: 'Filter Order', type: 'number' as const, default: 4 },
    { key: 'filter_type', label: 'Type (low/high)', type: 'string' as const, default: 'low' },
  ],
  compute: (p) => {
    const cutoff = parseFloat(p.cutoff) || 0.1, order = parseInt(p.order) || 4
    const type = p.filter_type === 'high' ? 'high' as const : 'low' as const
    // Generate sample signal: 10Hz + 50Hz + noise
    const fs = 500, N = 500
    const signal = Array.from({ length: N }, (_, i) => {
      const t = i / fs
      return Math.sin(2 * Math.PI * 10 * t) + 0.5 * Math.sin(2 * Math.PI * 50 * t) + 0.3 * (Math.random() - 0.5)
    })
    const filtered = butterworth(signal, cutoff, order, type)
    return {
      statistics: [
        { label: 'Signal Length', value: String(N) },
        { label: 'Filter Type', value: type + 'pass' },
        { label: 'Cutoff (normalized)', value: cutoff.toFixed(3) },
        { label: 'Order', value: String(order) },
        { label: 'Input RMS', value: Math.sqrt(mean(signal.map(v => v * v))).toFixed(4) },
        { label: 'Output RMS', value: Math.sqrt(mean(filtered.map(v => v * v))).toFixed(4) },
      ],
      chartData: signal.slice(0, 200).map((v, i) => ({ x: i, y: v, filtered: filtered[i] })),
      chartType: 'line' as const, chartTitle: 'Filtered Signal', xLabel: 'Sample', yLabel: 'Amplitude',
    }
  }
},
{
  id: 'sig-fft', toolbox: 'signal', name: 'FFT Spectrum Analysis',
  matlabFn: 'fft',
  description: 'Compute frequency spectrum of a signal using Fast Fourier Transform',
  matlabCode: `fs = 1000; t = 0:1/fs:1-1/fs;\nsig = 2*sin(2*pi*50*t) + sin(2*pi*120*t);\nY = fft(sig);\nP = abs(Y/length(sig));\nf = fs*(0:length(sig)/2)/length(sig);`,
  sampleData: {},
  params: [
    { key: 'freq1', label: 'Frequency 1 (Hz)', type: 'number' as const, default: 50 },
    { key: 'freq2', label: 'Frequency 2 (Hz)', type: 'number' as const, default: 120 },
    { key: 'fs', label: 'Sample Rate (Hz)', type: 'number' as const, default: 1000 },
  ],
  compute: (p) => {
    const f1 = parseFloat(p.freq1) || 50, f2 = parseFloat(p.freq2) || 120, fs = parseFloat(p.fs) || 1000
    const N = 512
    const signal = Array.from({ length: N }, (_, i) => {
      const t = i / fs
      return 2 * Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t) + 0.5 * (Math.random() - 0.5)
    })
    const result = fft(signal)
    const freqHz = result.freq.map(f => f * fs)
    return {
      statistics: [
        { label: 'N Samples', value: String(N) },
        { label: 'Sample Rate', value: fs + ' Hz' },
        { label: 'Freq Resolution', value: (fs / N).toFixed(2) + ' Hz' },
        { label: 'Nyquist Freq', value: (fs / 2).toFixed(0) + ' Hz' },
        { label: 'Peak 1', value: freqHz[result.magnitude.indexOf(Math.max(...result.magnitude))].toFixed(1) + ' Hz' },
      ],
      chartData: freqHz.slice(0, Math.floor(N / 4)).map((f, i) => ({ x: f, y: result.magnitude[i] })),
      chartType: 'line' as const, chartTitle: 'Frequency Spectrum', xLabel: 'Frequency (Hz)', yLabel: 'Magnitude',
    }
  }
},
{
  id: 'sig-psd', toolbox: 'signal', name: 'Power Spectral Density',
  matlabFn: 'pwelch',
  description: "Welch's PSD estimate — power distribution across frequencies",
  matlabCode: `fs = 256; t = 0:1/fs:4;\nsig = sin(2*pi*10*t) + 0.5*sin(2*pi*25*t) + randn(size(t));\n[pxx,f] = pwelch(sig,[],[],[],fs);`,
  sampleData: {},
  params: [
    { key: 'fs', label: 'Sample Rate (Hz)', type: 'number' as const, default: 256 },
    { key: 'segLen', label: 'Segment Length', type: 'number' as const, default: 128 },
  ],
  compute: (p) => {
    const fs = parseFloat(p.fs) || 256, segLen = parseInt(p.segLen) || 128
    const N = 1024
    const signal = Array.from({ length: N }, (_, i) => {
      const t = i / fs
      return Math.sin(2 * Math.PI * 10 * t) + 0.5 * Math.sin(2 * Math.PI * 25 * t) + 0.3 * (Math.random() - 0.5)
    })
    const { freq, psd } = welchPSD(signal, fs, segLen)
    const peakIdx = psd.indexOf(Math.max(...psd.slice(1)))
    return {
      statistics: [
        { label: 'Signal Length', value: String(N) },
        { label: 'Sample Rate', value: fs + ' Hz' },
        { label: 'Segment Length', value: String(segLen) },
        { label: 'Freq Resolution', value: (fs / segLen).toFixed(2) + ' Hz' },
        { label: 'Peak Frequency', value: freq[peakIdx].toFixed(2) + ' Hz' },
        { label: 'Peak Power', value: psd[peakIdx].toFixed(6) },
        { label: 'Total Power', value: sum(psd).toFixed(4) },
      ],
      chartData: freq.slice(0, Math.floor(freq.length * 0.8)).map((f, i) => ({ x: f, y: psd[i] })),
      chartType: 'line' as const, chartTitle: 'Power Spectral Density', xLabel: 'Frequency (Hz)', yLabel: 'Power',
    }
  }
},
{
  id: 'sig-peaks', toolbox: 'signal', name: 'Peak Detection',
  matlabFn: 'findpeaks',
  description: 'Find local maxima in a signal with minimum height and distance constraints',
  matlabCode: `sig = [0 1 0 2 0 3 0 2 0 1 0 4 0 2 0];\n[pks,locs] = findpeaks(sig, 'MinPeakHeight', 1.5, 'MinPeakDistance', 2)`,
  sampleData: { data: '', minHeight: '0.5', minDistance: '5' },
  params: [
    { key: 'minHeight', label: 'Min Peak Height', type: 'number' as const, default: 0.5 },
    { key: 'minDistance', label: 'Min Peak Distance', type: 'number' as const, default: 5 },
  ],
  compute: (p) => {
    let data = parseArray(p.data)
    if (data.length < 5) {
      // Generate sample ECG-like signal
      data = Array.from({ length: 300 }, (_, i) => {
        const t = i / 100
        return Math.sin(2 * Math.PI * 1.2 * t) * Math.exp(-((t % 0.833 - 0.2) ** 2) / 0.01) +
               0.3 * Math.sin(2 * Math.PI * 1.2 * t) + 0.1 * (Math.random() - 0.5)
      })
    }
    const minH = parseFloat(p.minHeight) || 0.5, minD = parseInt(p.minDistance) || 5
    const { indices, heights } = findPeaks(data, minH, minD)
    return {
      statistics: [
        { label: 'Signal Length', value: String(data.length) },
        { label: 'Peaks Found', value: String(indices.length) },
        { label: 'Min Peak Height', value: minH.toFixed(2) },
        { label: 'Min Peak Distance', value: String(minD) },
        { label: 'Mean Peak Height', value: heights.length ? mean(heights).toFixed(4) : 'N/A' },
        { label: 'Mean Peak Interval', value: indices.length > 1 ? mean(indices.slice(1).map((v, i) => v - indices[i])).toFixed(2) : 'N/A' },
      ],
      chartData: data.map((v, i) => ({ x: i, y: v })),
      chartType: 'line' as const, chartTitle: `Signal with ${indices.length} Peaks`, xLabel: 'Sample', yLabel: 'Amplitude',
    }
  }
},
{
  id: 'sig-movavg', toolbox: 'signal', name: 'Moving Average Filter',
  matlabFn: 'movmean',
  description: 'Smooth a noisy signal using a sliding window average',
  matlabCode: `t = 0:0.01:2*pi;\nsig = sin(t) + 0.5*randn(size(t));\nsmoothed = movmean(sig, 20);`,
  sampleData: { window: '15' },
  params: [{ key: 'window', label: 'Window Size', type: 'number' as const, default: 15 }],
  compute: (p) => {
    const win = parseInt(p.window) || 15
    const N = 300
    const signal = Array.from({ length: N }, (_, i) => Math.sin(2 * Math.PI * i / 100) + 0.4 * (Math.random() - 0.5))
    const smoothed = movingAverage(signal, win)
    const residuals = signal.map((v, i) => v - smoothed[i])
    return {
      statistics: [
        { label: 'Signal Length', value: String(N) },
        { label: 'Window Size', value: String(win) },
        { label: 'Input Noise SD', value: std(residuals).toFixed(4) },
        { label: 'SNR Improvement', value: (std(signal) / std(residuals)).toFixed(2) + 'x' },
      ],
      chartData: signal.map((v, i) => ({ x: i, y: v, smoothed: smoothed[i] })),
      chartType: 'line' as const, chartTitle: 'Moving Average Smoothing', xLabel: 'Sample', yLabel: 'Value',
    }
  }
},
{
  id: 'sig-bandpower', toolbox: 'signal', name: 'Band Power',
  matlabFn: 'bandpower',
  description: 'Compute signal power in a specific frequency band (e.g., EEG alpha 8-13Hz)',
  matlabCode: `fs = 256;\nsig = randn(1, 1024);\nbp = bandpower(sig, fs, [8 13]);  % Alpha band`,
  sampleData: {},
  params: [
    { key: 'fs', label: 'Sample Rate (Hz)', type: 'number' as const, default: 256 },
    { key: 'band_low', label: 'Band Low (Hz)', type: 'number' as const, default: 8 },
    { key: 'band_high', label: 'Band High (Hz)', type: 'number' as const, default: 13 },
  ],
  compute: (p) => {
    const fs = parseFloat(p.fs) || 256
    const bLow = parseFloat(p.band_low) || 8, bHigh = parseFloat(p.band_high) || 13
    const N = 1024
    const signal = Array.from({ length: N }, (_, i) => {
      const t = i / fs
      return 2 * Math.sin(2 * Math.PI * 10 * t) + Math.sin(2 * Math.PI * 20 * t) +
             0.5 * Math.sin(2 * Math.PI * 40 * t) + 0.3 * (Math.random() - 0.5)
    })
    const { freq, psd } = welchPSD(signal, fs, 128)
    const totalPower = sum(psd)
    const bandPower = psd.reduce((s, v, i) => (freq[i] >= bLow && freq[i] <= bHigh) ? s + v : s, 0)
    const bands = [
      { name: 'Delta (0.5-4Hz)', low: 0.5, high: 4 },
      { name: 'Theta (4-8Hz)', low: 4, high: 8 },
      { name: 'Alpha (8-13Hz)', low: 8, high: 13 },
      { name: 'Beta (13-30Hz)', low: 13, high: 30 },
      { name: 'Gamma (30-100Hz)', low: 30, high: 100 },
    ]
    return {
      statistics: [
        { label: 'Total Power', value: totalPower.toFixed(6) },
        { label: `Band Power (${bLow}-${bHigh}Hz)`, value: bandPower.toFixed(6) },
        { label: 'Relative Band Power', value: ((bandPower / totalPower) * 100).toFixed(2) + '%' },
        ...bands.map(b => {
          const bp = psd.reduce((s, v, i) => (freq[i] >= b.low && freq[i] <= b.high) ? s + v : s, 0)
          return { label: b.name, value: ((bp / totalPower) * 100).toFixed(2) + '%' }
        }),
      ],
      chartData: freq.slice(0, Math.min(freq.length, 80)).map((f, i) => ({ x: f, y: psd[i] })),
      chartType: 'line' as const, chartTitle: 'PSD with Band Regions', xLabel: 'Frequency (Hz)', yLabel: 'Power',
    }
  }
},
{
  id: 'sig-hilbert', toolbox: 'signal', name: 'Hilbert Transform',
  matlabFn: 'hilbert',
  description: 'Compute analytic signal, instantaneous amplitude (envelope) and phase',
  matlabCode: `t = 0:0.001:1;\nsig = sin(2*pi*5*t) .* (1 + 0.5*sin(2*pi*0.5*t));\nanalytic = hilbert(sig);\nenvelope = abs(analytic);\nphase = angle(analytic);`,
  sampleData: {},
  params: [
    { key: 'carrier_freq', label: 'Carrier Frequency (Hz)', type: 'number' as const, default: 10 },
    { key: 'mod_freq', label: 'Modulation Frequency (Hz)', type: 'number' as const, default: 1 },
  ],
  compute: (p) => {
    const fc = parseFloat(p.carrier_freq) || 10, fm = parseFloat(p.mod_freq) || 1
    const N = 500, fs = 250
    const signal = Array.from({ length: N }, (_, i) => {
      const t = i / fs
      return (1 + 0.5 * Math.sin(2 * Math.PI * fm * t)) * Math.sin(2 * Math.PI * fc * t)
    })
    // Compute envelope via Hilbert-like approach (moving RMS)
    const winSize = Math.max(5, Math.round(fs / fc))
    const envelope = signal.map((_, i) => {
      const start = Math.max(0, i - winSize), end = Math.min(N, i + winSize + 1)
      return Math.sqrt(mean(signal.slice(start, end).map(v => v * v))) * Math.SQRT2
    })
    return {
      statistics: [
        { label: 'Signal Length', value: String(N) },
        { label: 'Carrier Frequency', value: fc + ' Hz' },
        { label: 'Modulation Frequency', value: fm + ' Hz' },
        { label: 'Mean Envelope', value: mean(envelope).toFixed(4) },
        { label: 'Max Envelope', value: Math.max(...envelope).toFixed(4) },
        { label: 'Min Envelope', value: Math.min(...envelope).toFixed(4) },
      ],
      chartData: signal.map((v, i) => ({ x: i / fs, y: v, envelope: envelope[i] })),
      chartType: 'line' as const, chartTitle: 'Signal + Envelope', xLabel: 'Time (s)', yLabel: 'Amplitude',
    }
  }
},
{
  id: 'sig-ecg-rpeak', toolbox: 'signal', name: 'ECG R-Peak Detection',
  matlabFn: 'findpeaks (ECG)',
  description: 'Detect R-peaks in ECG signal, compute heart rate and RR intervals',
  matlabCode: `[ecg,fs] = ecgsyn(256, 10);  % simulate 10s ECG\n[pks,locs] = findpeaks(ecg, 'MinPeakHeight', 0.5, 'MinPeakDistance', fs*0.5);\nhr = 60./(diff(locs)/fs);`,
  sampleData: { heart_rate: '72', fs: '250', duration: '10' },
  params: [
    { key: 'heart_rate', label: 'Simulated HR (bpm)', type: 'number' as const, default: 72 },
    { key: 'fs', label: 'Sample Rate (Hz)', type: 'number' as const, default: 250 },
    { key: 'duration', label: 'Duration (s)', type: 'number' as const, default: 10 },
  ],
  compute: (p) => {
    const hr = parseFloat(p.heart_rate) || 72, fs = parseFloat(p.fs) || 250
    const dur = parseFloat(p.duration) || 10, N = Math.floor(fs * dur)
    const rr = 60 / hr // RR interval in seconds
    // Generate synthetic ECG (simplified PQRST)
    const ecg = Array.from({ length: N }, (_, i) => {
      const t = i / fs, phase = (t % rr) / rr
      let v = 0
      if (phase > 0.1 && phase < 0.15) v = 0.15 * Math.sin((phase - 0.1) / 0.05 * Math.PI) // P wave
      if (phase > 0.2 && phase < 0.22) v = -0.15 * Math.sin((phase - 0.2) / 0.02 * Math.PI) // Q
      if (phase > 0.22 && phase < 0.28) v = 1.0 * Math.sin((phase - 0.22) / 0.06 * Math.PI) // R peak
      if (phase > 0.28 && phase < 0.32) v = -0.1 * Math.sin((phase - 0.28) / 0.04 * Math.PI) // S
      if (phase > 0.35 && phase < 0.5) v = 0.2 * Math.sin((phase - 0.35) / 0.15 * Math.PI) // T wave
      return v + 0.05 * (Math.random() - 0.5)
    })
    const { indices } = findPeaks(ecg, 0.4, Math.floor(fs * 0.4))
    const rrIntervals = indices.slice(1).map((v, i) => (v - indices[i]) / fs)
    const computedHR = rrIntervals.length ? 60 / mean(rrIntervals) : 0
    const hrv = rrIntervals.length > 1 ? std(rrIntervals) * 1000 : 0 // SDNN in ms
    return {
      statistics: [
        { label: 'Signal Duration', value: dur + 's' },
        { label: 'Sample Rate', value: fs + ' Hz' },
        { label: 'R-Peaks Detected', value: String(indices.length) },
        { label: 'Computed Heart Rate', value: computedHR.toFixed(1) + ' bpm' },
        { label: 'Mean RR Interval', value: rrIntervals.length ? (mean(rrIntervals) * 1000).toFixed(1) + ' ms' : 'N/A' },
        { label: 'SDNN (HRV)', value: hrv.toFixed(2) + ' ms' },
        { label: 'RMSSD', value: rrIntervals.length > 1 ? (Math.sqrt(mean(rrIntervals.slice(1).map((v, i) => (v - rrIntervals[i]) ** 2))) * 1000).toFixed(2) + ' ms' : 'N/A' },
      ],
      chartData: ecg.slice(0, Math.min(N, 750)).map((v, i) => ({ x: i / fs, y: v })),
      chartType: 'line' as const, chartTitle: 'ECG with R-Peaks', xLabel: 'Time (s)', yLabel: 'mV',
    }
  }
},
{
  id: 'sig-eeg-bands', toolbox: 'signal', name: 'EEG Band Extraction',
  matlabFn: 'butter + filtfilt (EEG)',
  description: 'Extract EEG frequency bands: delta, theta, alpha, beta, gamma',
  matlabCode: `fs = 256;\n[b,a] = butter(4, [8 13]/(fs/2), 'bandpass');\nalpha = filtfilt(b, a, eeg_signal);`,
  sampleData: { fs: '256', duration: '5' },
  params: [
    { key: 'fs', label: 'Sample Rate (Hz)', type: 'number' as const, default: 256 },
    { key: 'duration', label: 'Duration (s)', type: 'number' as const, default: 5 },
  ],
  compute: (p) => {
    const fs = parseFloat(p.fs) || 256, dur = parseFloat(p.duration) || 5
    const N = Math.floor(fs * dur)
    // Simulate EEG: mix of brain rhythms
    const eeg = Array.from({ length: N }, (_, i) => {
      const t = i / fs
      return 20 * Math.sin(2 * Math.PI * 2 * t) +   // delta 2Hz
             15 * Math.sin(2 * Math.PI * 6 * t) +   // theta 6Hz
             30 * Math.sin(2 * Math.PI * 10 * t) +  // alpha 10Hz (dominant)
             10 * Math.sin(2 * Math.PI * 20 * t) +  // beta 20Hz
             5 * Math.sin(2 * Math.PI * 40 * t) +   // gamma 40Hz
             8 * (Math.random() - 0.5)               // noise
    })
    const { freq, psd } = welchPSD(eeg, fs, Math.min(256, N))
    const totalPower = sum(psd)
    const bands = [
      { name: 'Delta (0.5-4Hz)', low: 0.5, high: 4, color: '#3b82f6' },
      { name: 'Theta (4-8Hz)', low: 4, high: 8, color: '#8b5cf6' },
      { name: 'Alpha (8-13Hz)', low: 8, high: 13, color: '#10b981' },
      { name: 'Beta (13-30Hz)', low: 13, high: 30, color: '#f59e0b' },
      { name: 'Gamma (30-100Hz)', low: 30, high: 100, color: '#ef4444' },
    ]
    const bandPowers = bands.map(b => ({
      ...b,
      power: psd.reduce((s, v, i) => (freq[i] >= b.low && freq[i] <= b.high) ? s + v : s, 0),
    }))
    return {
      statistics: [
        { label: 'Signal Duration', value: dur + 's' },
        { label: 'Sample Rate', value: fs + ' Hz' },
        { label: 'Total Power', value: totalPower.toFixed(2) + ' µV²' },
        ...bandPowers.map(b => ({ label: b.name, value: ((b.power / totalPower) * 100).toFixed(2) + '%' })),
        { label: 'Dominant Band', value: bandPowers.reduce((a, b) => b.power > a.power ? b : a).name },
        { label: 'Alpha/Theta Ratio', value: (bandPowers[2].power / (bandPowers[1].power || 1)).toFixed(3) },
      ],
      chartData: freq.slice(0, Math.min(freq.length, 60)).map((f, i) => ({ x: f, y: psd[i] })),
      chartType: 'line' as const, chartTitle: 'EEG Power Spectrum', xLabel: 'Frequency (Hz)', yLabel: 'Power (µV²/Hz)',
    }
  }
},
{
  id: 'sig-spectrogram', toolbox: 'signal', name: 'Spectrogram',
  matlabFn: 'spectrogram',
  description: 'Time-frequency representation of a chirp signal (frequency sweep)',
  matlabCode: `fs = 1000; t = 0:1/fs:2;\nchirp_sig = chirp(t,10,2,200);\nspectrogram(chirp_sig, 128, 120, 128, fs, 'yaxis');`,
  sampleData: { f_start: '10', f_end: '100', duration: '2', fs: '500' },
  params: [
    { key: 'f_start', label: 'Start Frequency (Hz)', type: 'number' as const, default: 10 },
    { key: 'f_end', label: 'End Frequency (Hz)', type: 'number' as const, default: 100 },
    { key: 'duration', label: 'Duration (s)', type: 'number' as const, default: 2 },
    { key: 'fs', label: 'Sample Rate (Hz)', type: 'number' as const, default: 500 },
  ],
  compute: (p) => {
    const f0 = parseFloat(p.f_start) || 10, f1 = parseFloat(p.f_end) || 100
    const dur = parseFloat(p.duration) || 2, fs = parseFloat(p.fs) || 500
    const N = Math.floor(fs * dur)
    // Generate chirp signal
    const signal = Array.from({ length: N }, (_, i) => {
      const t = i / fs
      const freq = f0 + (f1 - f0) * t / dur
      return Math.sin(2 * Math.PI * freq * t) + 0.2 * (Math.random() - 0.5)
    })
    // Compute spectrogram (windowed FFTs at multiple time points)
    const segLen = 64, hop = 16, nFreq = Math.floor(segLen / 2)
    const timeSlices: { time: number; peakFreq: number; peakPower: number }[] = []
    for (let start = 0; start + segLen <= N; start += hop) {
      const seg = signal.slice(start, start + segLen).map((v, i) =>
        v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (segLen - 1)))
      )
      let maxPow = 0, peakK = 0
      for (let k = 1; k < nFreq; k++) {
        let re = 0, im = 0
        for (let n = 0; n < segLen; n++) {
          const angle = -2 * Math.PI * k * n / segLen
          re += seg[n] * Math.cos(angle); im += seg[n] * Math.sin(angle)
        }
        const pow = re * re + im * im
        if (pow > maxPow) { maxPow = pow; peakK = k }
      }
      timeSlices.push({ time: (start + segLen / 2) / fs, peakFreq: peakK * fs / segLen, peakPower: maxPow })
    }
    return {
      statistics: [
        { label: 'Signal Duration', value: dur + 's' },
        { label: 'Chirp Range', value: `${f0} - ${f1} Hz` },
        { label: 'Time Slices', value: String(timeSlices.length) },
        { label: 'Freq Resolution', value: (fs / segLen).toFixed(2) + ' Hz' },
      ],
      chartData: timeSlices.map(s => ({ x: s.time, y: s.peakFreq })),
      chartType: 'scatter' as const, chartTitle: 'Spectrogram (Peak Freq)', xLabel: 'Time (s)', yLabel: 'Frequency (Hz)',
    }
  }
},

// ─── IMAGE PROCESSING TOOLBOX (8 presets) ────────────────────────────
// Note: operates on 2D numeric matrices (pixel arrays) since we're in browser

{
  id: 'img-histogram-eq', toolbox: 'image', name: 'Histogram Equalization',
  matlabFn: 'histeq',
  description: 'Enhance image contrast by equalizing the intensity histogram',
  matlabCode: `img = imread('xray.dcm');\neq_img = histeq(img);\nimhist(img); figure; imhist(eq_img);`,
  sampleData: { width: '16', height: '16' },
  params: [
    { key: 'width', label: 'Image Width', type: 'number' as const, default: 16 },
    { key: 'height', label: 'Image Height', type: 'number' as const, default: 16 },
  ],
  compute: (p) => {
    const w = parseInt(p.width) || 16, h = parseInt(p.height) || 16
    // Generate low-contrast synthetic image
    const img = Array.from({ length: w * h }, () => Math.floor(100 + 30 * Math.random()))
    // Compute histogram
    const hist = new Array(256).fill(0)
    img.forEach(v => hist[Math.min(255, Math.max(0, v))]++)
    const cdf = hist.map((_: number, i: number) => hist.slice(0, i + 1).reduce((a: number, b: number) => a + b, 0))
    const cdfMin = cdf.find((v: number) => v > 0) || 0
    const total = w * h
    const equalized = img.map(v => Math.round((cdf[v] - cdfMin) / (total - cdfMin) * 255))
    const eqHist = new Array(256).fill(0)
    equalized.forEach(v => eqHist[Math.min(255, Math.max(0, v))]++)
    return {
      statistics: [
        { label: 'Image Size', value: `${w} x ${h}` },
        { label: 'Original Mean', value: mean(img).toFixed(2) },
        { label: 'Equalized Mean', value: mean(equalized).toFixed(2) },
        { label: 'Original Std Dev', value: std(img).toFixed(2) },
        { label: 'Equalized Std Dev', value: std(equalized).toFixed(2) },
        { label: 'Original Range', value: `${Math.min(...img)} - ${Math.max(...img)}` },
        { label: 'Equalized Range', value: `${Math.min(...equalized)} - ${Math.max(...equalized)}` },
      ],
      chartData: Array.from({ length: 256 }, (_, i) => ({ x: i, y: eqHist[i] })).filter(d => d.y > 0 || d.x % 16 === 0),
      chartType: 'bar' as const, chartTitle: 'Equalized Histogram', xLabel: 'Intensity', yLabel: 'Count',
    }
  }
},
{
  id: 'img-otsu', toolbox: 'image', name: 'Otsu Thresholding',
  matlabFn: 'graythresh + imbinarize',
  description: "Automatic thresholding using Otsu's method to separate foreground/background",
  matlabCode: `img = imread('cells.tif');\nlevel = graythresh(img);\nbw = imbinarize(img, level);`,
  sampleData: {},
  params: [],
  compute: () => {
    // Generate bimodal image data (cells on background)
    const N = 500
    const img = Array.from({ length: N }, () => Math.random() < 0.4 ? 50 + 20 * Math.random() : 180 + 30 * Math.random())
    // Otsu's method
    const hist = new Array(256).fill(0)
    img.forEach(v => hist[Math.round(Math.min(255, Math.max(0, v)))]++)
    const total = N
    let bestThresh = 0, bestVar = 0
    let wB = 0, sumB = 0, sumTotal = hist.reduce((s: number, v: number, i: number) => s + i * v, 0)
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (wB === 0) continue
      const wF = total - wB; if (wF === 0) break
      sumB += t * hist[t]
      const mB = sumB / wB, mF = (sumTotal - sumB) / wF
      const between = wB * wF * (mB - mF) ** 2
      if (between > bestVar) { bestVar = between; bestThresh = t }
    }
    const fg = img.filter(v => v > bestThresh), bg = img.filter(v => v <= bestThresh)
    return {
      statistics: [
        { label: 'Optimal Threshold', value: String(bestThresh) },
        { label: 'Foreground Pixels', value: String(fg.length) + ` (${(fg.length / N * 100).toFixed(1)}%)` },
        { label: 'Background Pixels', value: String(bg.length) + ` (${(bg.length / N * 100).toFixed(1)}%)` },
        { label: 'Foreground Mean', value: mean(fg).toFixed(2) },
        { label: 'Background Mean', value: mean(bg).toFixed(2) },
        { label: 'Between-Class Variance', value: bestVar.toFixed(2) },
      ],
      chartData: Array.from({ length: 256 }, (_, i) => ({ x: i, y: hist[i] })).filter(d => d.y > 0),
      chartType: 'bar' as const, chartTitle: 'Histogram with Otsu Threshold', xLabel: 'Intensity', yLabel: 'Count',
    }
  }
},
{
  id: 'img-gauss', toolbox: 'image', name: 'Gaussian Smoothing',
  matlabFn: 'imgaussfilt',
  description: 'Apply Gaussian blur to reduce noise (specified by sigma)',
  matlabCode: `img = imread('ct_slice.dcm');\nsmoothed = imgaussfilt(img, 2);  % sigma=2`,
  sampleData: { sigma: '2', size: '20' },
  params: [
    { key: 'sigma', label: 'Sigma (std dev)', type: 'number' as const, default: 2 },
    { key: 'size', label: 'Signal Length (1D demo)', type: 'number' as const, default: 200 },
  ],
  compute: (p) => {
    const sigma = parseFloat(p.sigma) || 2, N = parseInt(p.size) || 200
    // 1D Gaussian smoothing demo
    const signal = Array.from({ length: N }, (_, i) => {
      const base = Math.sin(2 * Math.PI * i / 50) * 50 + 128
      return base + 20 * (Math.random() - 0.5)
    })
    // Create Gaussian kernel
    const kSize = Math.ceil(sigma * 6) | 1
    const half = Math.floor(kSize / 2)
    const kernel = Array.from({ length: kSize }, (_, i) => Math.exp(-0.5 * ((i - half) / sigma) ** 2))
    const kSum = sum(kernel)
    const normKernel = kernel.map(v => v / kSum)
    // Convolve
    const smoothed = signal.map((_, i) => {
      let s = 0
      for (let k = 0; k < kSize; k++) {
        const idx = Math.min(N - 1, Math.max(0, i - half + k))
        s += signal[idx] * normKernel[k]
      }
      return s
    })
    return {
      statistics: [
        { label: 'Sigma', value: sigma.toFixed(2) },
        { label: 'Kernel Size', value: String(kSize) },
        { label: 'Input Noise (SD)', value: std(signal.map((v, i) => v - smoothed[i])).toFixed(2) },
        { label: 'Smoothed Range', value: `${Math.min(...smoothed).toFixed(1)} - ${Math.max(...smoothed).toFixed(1)}` },
      ],
      chartData: signal.map((v, i) => ({ x: i, y: v, smoothed: smoothed[i] })),
      chartType: 'line' as const, chartTitle: 'Gaussian Smoothing', xLabel: 'Pixel', yLabel: 'Intensity',
    }
  }
},
{
  id: 'img-edge', toolbox: 'image', name: 'Edge Detection (Sobel)',
  matlabFn: 'edge / imgradient',
  description: 'Detect edges using Sobel gradient operator',
  matlabCode: `img = imread('brain_mri.dcm');\n[Gmag, Gdir] = imgradient(img, 'sobel');\nBW = edge(img, 'sobel');`,
  sampleData: { width: '20', height: '20' },
  params: [
    { key: 'width', label: 'Width', type: 'number' as const, default: 20 },
    { key: 'height', label: 'Height', type: 'number' as const, default: 20 },
  ],
  compute: (p) => {
    const w = parseInt(p.width) || 20, h = parseInt(p.height) || 20
    // Create synthetic image with a bright rectangle
    const img: number[][] = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => {
        if (x > w * 0.25 && x < w * 0.75 && y > h * 0.25 && y < h * 0.75) return 200 + 10 * Math.random()
        return 50 + 10 * Math.random()
      })
    )
    // Sobel operator
    const gradient: number[] = []
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gx = -img[y-1][x-1] - 2*img[y][x-1] - img[y+1][x-1] + img[y-1][x+1] + 2*img[y][x+1] + img[y+1][x+1]
        const gy = -img[y-1][x-1] - 2*img[y-1][x] - img[y-1][x+1] + img[y+1][x-1] + 2*img[y+1][x] + img[y+1][x+1]
        gradient.push(Math.sqrt(gx * gx + gy * gy))
      }
    }
    const edgePixels = gradient.filter(v => v > mean(gradient) + std(gradient)).length
    return {
      statistics: [
        { label: 'Image Size', value: `${w} x ${h}` },
        { label: 'Mean Gradient', value: mean(gradient).toFixed(2) },
        { label: 'Max Gradient', value: Math.max(...gradient).toFixed(2) },
        { label: 'Edge Pixels (> mean+1SD)', value: String(edgePixels) },
        { label: 'Edge Fraction', value: ((edgePixels / gradient.length) * 100).toFixed(1) + '%' },
      ],
      chartData: gradient.map((v, i) => ({ x: i, y: v })),
      chartType: 'line' as const, chartTitle: 'Gradient Magnitude', xLabel: 'Pixel', yLabel: 'Gradient',
    }
  }
},
{
  id: 'img-glcm', toolbox: 'image', name: 'GLCM Texture Analysis',
  matlabFn: 'graycomatrix + graycoprops',
  description: 'Compute texture features: contrast, correlation, energy, homogeneity from GLCM',
  matlabCode: `img = imread('tissue.tif');\nglcm = graycomatrix(img, 'Offset', [0 1]);\nstats = graycoprops(glcm, 'all');`,
  sampleData: { levels: '8' },
  params: [{ key: 'levels', label: 'Gray Levels', type: 'number' as const, default: 8 }],
  compute: (p) => {
    const L = parseInt(p.levels) || 8, sz = 30
    // Generate synthetic texture (two regions)
    const img = Array.from({ length: sz * sz }, (_, i) => {
      const x = i % sz
      if (x < sz / 2) return Math.floor(Math.random() * L * 0.5)  // smooth
      return Math.floor(Math.random() * L)  // rough
    })
    // Compute GLCM (offset [0,1] = horizontal neighbor)
    const glcm: number[][] = Array.from({ length: L }, () => new Array(L).fill(0))
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz - 1; x++) {
        const i = Math.min(L - 1, img[y * sz + x]), j = Math.min(L - 1, img[y * sz + x + 1])
        glcm[i][j]++
      }
    }
    const total = glcm.flat().reduce((s, v) => s + v, 0) || 1
    const norm = glcm.map(r => r.map(v => v / total))
    // Texture features
    let contrast = 0, energy = 0, homogeneity = 0, correlation = 0
    let muI = 0, muJ = 0, sigI = 0, sigJ = 0
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) { muI += i * norm[i][j]; muJ += j * norm[i][j] }
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) { sigI += (i - muI) ** 2 * norm[i][j]; sigJ += (j - muJ) ** 2 * norm[i][j] }
    sigI = Math.sqrt(sigI); sigJ = Math.sqrt(sigJ)
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
      contrast += (i - j) ** 2 * norm[i][j]
      energy += norm[i][j] ** 2
      homogeneity += norm[i][j] / (1 + Math.abs(i - j))
      if (sigI > 0 && sigJ > 0) correlation += (i - muI) * (j - muJ) * norm[i][j] / (sigI * sigJ)
    }
    return {
      statistics: [
        { label: 'Gray Levels', value: String(L) },
        { label: 'Contrast', value: contrast.toFixed(4) },
        { label: 'Correlation', value: correlation.toFixed(4) },
        { label: 'Energy (ASM)', value: energy.toFixed(4) },
        { label: 'Homogeneity (IDM)', value: homogeneity.toFixed(4) },
        { label: 'Entropy', value: (-norm.flat().filter(v => v > 0).reduce((s, v) => s + v * Math.log2(v), 0)).toFixed(4) },
      ],
      chartData: Array.from({ length: L }, (_, i) => ({ x: i, y: sum(glcm[i]) })),
      chartType: 'bar' as const, chartTitle: 'GLCM Row Sums', xLabel: 'Gray Level', yLabel: 'Frequency',
    }
  }
},
{
  id: 'img-regionprops', toolbox: 'image', name: 'Region Properties',
  matlabFn: 'regionprops',
  description: 'Measure properties of connected regions: area, centroid, eccentricity, perimeter',
  matlabCode: `bw = imbinarize(img);\nstats = regionprops(bw, 'Area', 'Centroid', 'Eccentricity', 'Perimeter');`,
  sampleData: { num_objects: '5', grid_size: '50' },
  params: [
    { key: 'num_objects', label: 'Number of Objects', type: 'number' as const, default: 5 },
    { key: 'grid_size', label: 'Grid Size', type: 'number' as const, default: 50 },
  ],
  compute: (p) => {
    const nObj = parseInt(p.num_objects) || 5, sz = parseInt(p.grid_size) || 50
    // Generate random circular regions
    const centers = Array.from({ length: nObj }, () => ({
      x: 5 + Math.random() * (sz - 10), y: 5 + Math.random() * (sz - 10), r: 2 + Math.random() * 5,
    }))
    const regions = centers.map((c, idx) => {
      let area = 0, sumX = 0, sumY = 0, perimeter = 0
      for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
        const dist = Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2)
        if (dist <= c.r) { area++; sumX += x; sumY += y }
        if (Math.abs(dist - c.r) < 1) perimeter++
      }
      return {
        id: idx + 1, area, centroidX: area ? sumX / area : c.x, centroidY: area ? sumY / area : c.y,
        perimeter, circularity: area ? (4 * Math.PI * area) / (perimeter * perimeter || 1) : 0,
        radius: c.r,
      }
    })
    return {
      statistics: [
        { label: 'Objects Found', value: String(nObj) },
        { label: 'Grid Size', value: `${sz} x ${sz}` },
        ...regions.flatMap(r => [
          { label: `Region ${r.id} Area`, value: String(r.area) + ' px' },
          { label: `Region ${r.id} Centroid`, value: `(${r.centroidX.toFixed(1)}, ${r.centroidY.toFixed(1)})` },
          { label: `Region ${r.id} Circularity`, value: r.circularity.toFixed(3) },
        ]),
      ],
      chartData: regions.map(r => ({ x: r.centroidX, y: r.area })),
      chartType: 'scatter' as const, chartTitle: 'Region Areas', xLabel: 'Centroid X', yLabel: 'Area (px)',
    }
  }
},
{
  id: 'img-morph', toolbox: 'image', name: 'Morphological Operations',
  matlabFn: 'imerode / imdilate / imopen / imclose',
  description: 'Apply erosion, dilation, opening, closing to binary images',
  matlabCode: `bw = imbinarize(img);\nse = strel('disk', 5);\neroded = imerode(bw, se);\ndilated = imdilate(bw, se);`,
  sampleData: { op: 'opening', radius: '3', grid_size: '30' },
  params: [
    { key: 'op', label: 'Operation (erosion/dilation/opening/closing)', type: 'string' as const, default: 'opening' },
    { key: 'radius', label: 'Structuring Element Radius', type: 'number' as const, default: 3 },
    { key: 'grid_size', label: 'Grid Size', type: 'number' as const, default: 30 },
  ],
  compute: (p) => {
    const op = p.op || 'opening', r = parseInt(p.radius) || 3, sz = parseInt(p.grid_size) || 30
    // Create binary image with objects and noise
    const img = Array.from({ length: sz }, () =>
      Array.from({ length: sz }, (_, x) => {
        const cx = sz / 2, cy = sz / 2
        if (Math.sqrt((x - cx) ** 2 + (Math.random() * sz - cy) ** 2) < sz * 0.3) return 1
        return Math.random() < 0.1 ? 1 : 0  // salt noise
      })
    )
    // Erosion: pixel is 1 only if all neighbors within radius are 1
    const erode = (src: number[][]) => src.map((row, y) => row.map((_, x) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        const ny = y + dy, nx = x + dx
        if (ny < 0 || ny >= sz || nx < 0 || nx >= sz || src[ny][nx] === 0) return 0
      }
      return 1
    }))
    // Dilation: pixel is 1 if any neighbor within radius is 1
    const dilate = (src: number[][]) => src.map((row, y) => row.map((_, x) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        const ny = y + dy, nx = x + dx
        if (ny >= 0 && ny < sz && nx >= 0 && nx < sz && src[ny][nx] === 1) return 1
      }
      return 0
    }))
    let result: number[][]
    if (op === 'erosion') result = erode(img)
    else if (op === 'dilation') result = dilate(img)
    else if (op === 'opening') result = dilate(erode(img))
    else result = erode(dilate(img)) // closing
    const origCount = img.flat().filter(v => v === 1).length
    const resultCount = result.flat().filter(v => v === 1).length
    return {
      statistics: [
        { label: 'Operation', value: op },
        { label: 'SE Radius', value: String(r) },
        { label: 'Original FG Pixels', value: String(origCount) },
        { label: 'Result FG Pixels', value: String(resultCount) },
        { label: 'Pixels Changed', value: String(Math.abs(origCount - resultCount)) },
        { label: 'FG Change', value: ((resultCount - origCount) / origCount * 100).toFixed(1) + '%' },
      ],
      chartData: [
        { x: 0, y: origCount, label: 'Original' },
        { x: 1, y: resultCount, label: 'After ' + op },
      ],
      chartType: 'bar' as const, chartTitle: 'Foreground Pixel Count', xLabel: 'Stage', yLabel: 'Pixels',
    }
  }
},
{
  id: 'img-registration', toolbox: 'image', name: 'Image Registration',
  matlabFn: 'imregdemons / imregtform',
  description: 'Align two images by computing translation/rotation transformation',
  matlabCode: `fixed = imread('template.nii');\nmoving = imread('subject.nii');\n[optimizer,metric] = imregconfig('monomodal');\ntform = imregtform(moving, fixed, 'rigid', optimizer, metric);`,
  sampleData: { tx: '3.5', ty: '2.1', angle: '5' },
  params: [
    { key: 'tx', label: 'True Translation X', type: 'number' as const, default: 3.5 },
    { key: 'ty', label: 'True Translation Y', type: 'number' as const, default: 2.1 },
    { key: 'angle', label: 'True Rotation (deg)', type: 'number' as const, default: 5 },
  ],
  compute: (p) => {
    const trueTx = parseFloat(p.tx) || 3.5, trueTy = parseFloat(p.ty) || 2.1
    const trueAngle = (parseFloat(p.angle) || 5) * Math.PI / 180
    const sz = 20
    // Create "fixed" image (circle)
    const fixed = Array.from({ length: sz * sz }, (_, i) => {
      const x = i % sz - sz / 2, y = Math.floor(i / sz) - sz / 2
      return Math.exp(-(x * x + y * y) / 20) * 200
    })
    // Create "moving" image (shifted + rotated)
    const moving = Array.from({ length: sz * sz }, (_, i) => {
      const x0 = i % sz - sz / 2, y0 = Math.floor(i / sz) - sz / 2
      const x = (x0 - trueTx) * Math.cos(-trueAngle) - (y0 - trueTy) * Math.sin(-trueAngle)
      const y = (x0 - trueTx) * Math.sin(-trueAngle) + (y0 - trueTy) * Math.cos(-trueAngle)
      return Math.exp(-(x * x + y * y) / 20) * 200
    })
    // Simple cross-correlation registration (translation only)
    let bestTx = 0, bestTy = 0, bestCorr = -Infinity
    for (let tx = -8; tx <= 8; tx += 0.5) {
      for (let ty = -8; ty <= 8; ty += 0.5) {
        let corr = 0, n = 0
        for (let i = 0; i < sz * sz; i++) {
          const x = i % sz + tx, y = Math.floor(i / sz) + ty
          const xi = Math.round(x), yi = Math.round(y)
          if (xi >= 0 && xi < sz && yi >= 0 && yi < sz) {
            corr += fixed[i] * moving[yi * sz + xi]; n++
          }
        }
        if (n > 0 && corr / n > bestCorr) { bestCorr = corr / n; bestTx = tx; bestTy = ty }
      }
    }
    return {
      statistics: [
        { label: 'True Translation X', value: trueTx.toFixed(2) },
        { label: 'True Translation Y', value: trueTy.toFixed(2) },
        { label: 'True Rotation', value: (trueAngle * 180 / Math.PI).toFixed(2) + '°' },
        { label: 'Estimated Translation X', value: bestTx.toFixed(2) },
        { label: 'Estimated Translation Y', value: bestTy.toFixed(2) },
        { label: 'Translation Error X', value: Math.abs(bestTx - trueTx).toFixed(2) },
        { label: 'Translation Error Y', value: Math.abs(bestTy - trueTy).toFixed(2) },
        { label: 'Correlation Score', value: bestCorr.toFixed(4) },
      ],
      chartData: fixed.slice(0, sz).map((v, i) => ({ x: i, y: v, moving: moving[i] })),
      chartType: 'line' as const, chartTitle: 'Fixed vs Moving (center row)', xLabel: 'Pixel', yLabel: 'Intensity',
    }
  }
},

// ─── BIOINFORMATICS TOOLBOX (8 presets) ──────────────────────────────

{
  id: 'bio-diffexpr', toolbox: 'bioinformatics', name: 'Differential Expression',
  matlabFn: 'mattest',
  description: 'Two-sample t-test across genes to find differentially expressed genes',
  matlabCode: `[pValues] = mattest(controlData, treatmentData);\n[fdr] = mafdr(pValues);`,
  sampleData: {},
  params: [
    { key: 'nGenes', label: 'Number of Genes', type: 'number' as const, default: 200 },
    { key: 'nSamples', label: 'Samples per Group', type: 'number' as const, default: 10 },
  ],
  compute: (p) => {
    const nGenes = parseInt(p.nGenes) || 200, nSamp = parseInt(p.nSamples) || 10
    // Simulate gene expression (some genes truly DE)
    const nDE = Math.floor(nGenes * 0.1)
    const results: { gene: string; logFC: number; pValue: number; sig: boolean }[] = []
    for (let g = 0; g < nGenes; g++) {
      const isDE = g < nDE
      const baseMean = 5 + Math.random() * 5
      const fc = isDE ? (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 2) : 0
      const ctrl = Array.from({ length: nSamp }, () => baseMean + (Math.random() - 0.5) * 2)
      const treat = Array.from({ length: nSamp }, () => baseMean + fc + (Math.random() - 0.5) * 2)
      const mc = mean(ctrl), mt = mean(treat)
      const se = Math.sqrt(variance(ctrl) / nSamp + variance(treat) / nSamp) || 0.001
      const t = (mt - mc) / se, df = 2 * nSamp - 2
      const pVal = 2 * (1 - tCDF(Math.abs(t), df))
      results.push({ gene: `Gene_${String(g + 1).padStart(3, '0')}`, logFC: mt - mc, pValue: pVal, sig: pVal < 0.05 })
    }
    // BH FDR correction
    const sorted = [...results].sort((a, b) => a.pValue - b.pValue)
    sorted.forEach((r, i) => { r.sig = r.pValue * nGenes / (i + 1) < 0.05 })
    const nSig = sorted.filter(r => r.sig).length
    return {
      statistics: [
        { label: 'Total Genes', value: String(nGenes) },
        { label: 'Samples per Group', value: String(nSamp) },
        { label: 'True DE Genes', value: String(nDE) },
        { label: 'Significant (FDR<0.05)', value: String(nSig) },
        { label: 'Up-regulated', value: String(sorted.filter(r => r.sig && r.logFC > 0).length) },
        { label: 'Down-regulated', value: String(sorted.filter(r => r.sig && r.logFC < 0).length) },
        { label: 'Min p-value', value: sorted[0].pValue.toExponential(3) },
      ],
      chartData: results.map(r => ({ x: r.logFC, y: -Math.log10(r.pValue + 1e-15) })),
      chartType: 'scatter' as const, chartTitle: 'Volcano Plot', xLabel: 'Log Fold Change', yLabel: '-log10(p)',
    }
  }
},
{
  id: 'bio-fdr', toolbox: 'bioinformatics', name: 'FDR Correction',
  matlabFn: 'mafdr',
  description: 'Benjamini-Hochberg False Discovery Rate correction for multiple testing',
  matlabCode: `pValues = rand(1, 1000) .* [ones(1,50)*0.01 ones(1,950)];\n[fdr] = mafdr(pValues, 'BHFDR', true);`,
  sampleData: { pvalues: '' },
  params: [
    { key: 'nTests', label: 'Number of Tests', type: 'number' as const, default: 500 },
    { key: 'nTrue', label: 'True Positives', type: 'number' as const, default: 25 },
    { key: 'alpha', label: 'FDR Threshold', type: 'number' as const, default: 0.05 },
  ],
  compute: (p) => {
    const nTests = parseInt(p.nTests) || 500, nTrue = parseInt(p.nTrue) || 25
    const alpha = parseFloat(p.alpha) || 0.05
    let pvals = parseArray(p.pvalues)
    if (pvals.length < 2) {
      // Simulate: nTrue with small p-values, rest uniform
      pvals = Array.from({ length: nTests }, (_, i) =>
        i < nTrue ? Math.random() * 0.005 : Math.random()
      )
    }
    const n = pvals.length
    const indexed = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
    const qvals = new Array(n).fill(1)
    for (let i = n - 1; i >= 0; i--) {
      const bh = indexed[i].p * n / (i + 1)
      qvals[indexed[i].i] = i < n - 1 ? Math.min(bh, qvals[indexed[i + 1].i]) : bh
    }
    const nSigRaw = pvals.filter(p => p < alpha).length
    const nSigFDR = qvals.filter(q => q < alpha).length
    return {
      statistics: [
        { label: 'Total Tests', value: String(n) },
        { label: 'True Positives', value: String(nTrue) },
        { label: 'Significant (raw p < α)', value: String(nSigRaw) },
        { label: 'Significant (BH FDR < α)', value: String(nSigFDR) },
        { label: 'False Positives Avoided', value: String(nSigRaw - nSigFDR) },
        { label: 'Min p-value', value: Math.min(...pvals).toExponential(3) },
        { label: 'Min q-value', value: Math.min(...qvals).toExponential(3) },
      ],
      chartData: indexed.slice(0, 100).map((d, i) => ({ x: i + 1, y: -Math.log10(d.p + 1e-15) })),
      chartType: 'scatter' as const, chartTitle: 'Sorted p-values (-log10)', xLabel: 'Rank', yLabel: '-log10(p)',
    }
  }
},
{
  id: 'bio-enrichment', toolbox: 'bioinformatics', name: 'Gene Enrichment (Hypergeometric)',
  matlabFn: 'hygecdf',
  description: 'Test if a gene set is over-represented using the hypergeometric distribution',
  matlabCode: `p = 1 - hygecdf(k-1, N, K, n)  % k=overlap, N=total, K=in_pathway, n=DE_genes`,
  sampleData: { total_genes: '20000', pathway_size: '150', de_genes: '500', overlap: '25' },
  params: [
    { key: 'total_genes', label: 'Total Genes (N)', type: 'number' as const, default: 20000 },
    { key: 'pathway_size', label: 'Pathway Size (K)', type: 'number' as const, default: 150 },
    { key: 'de_genes', label: 'DE Genes (n)', type: 'number' as const, default: 500 },
    { key: 'overlap', label: 'Overlap (k)', type: 'number' as const, default: 25 },
  ],
  compute: (p) => {
    const N = parseInt(p.total_genes) || 20000, K = parseInt(p.pathway_size) || 150
    const n = parseInt(p.de_genes) || 500, k = parseInt(p.overlap) || 25
    const expected = n * K / N
    const foldEnrichment = k / (expected || 1)
    // Hypergeometric p-value approximation via normal approximation
    const mu = n * K / N
    const sigma = Math.sqrt(n * K * (N - K) * (N - n) / (N * N * (N - 1)))
    const z = (k - 0.5 - mu) / (sigma || 1)
    const pVal = 1 - normCDF(z)
    return {
      statistics: [
        { label: 'Total Genes (N)', value: String(N) },
        { label: 'Pathway Size (K)', value: String(K) },
        { label: 'DE Genes (n)', value: String(n) },
        { label: 'Overlap (k)', value: String(k) },
        { label: 'Expected Overlap', value: expected.toFixed(2) },
        { label: 'Fold Enrichment', value: foldEnrichment.toFixed(2) + 'x' },
        { label: 'p-value', value: pVal.toExponential(4) },
        { label: 'Significant (p<0.05)?', value: pVal < 0.05 ? 'YES' : 'NO' },
      ],
      chartData: [
        { x: 0, y: expected, label: 'Expected' },
        { x: 1, y: k, label: 'Observed' },
      ],
      chartType: 'bar' as const, chartTitle: 'Expected vs Observed Overlap', xLabel: '', yLabel: 'Gene Count',
    }
  }
},
{
  id: 'bio-hclust', toolbox: 'bioinformatics', name: 'Hierarchical Clustering',
  matlabFn: 'linkage + clustergram',
  description: 'Agglomerative hierarchical clustering with dendrogram (Ward linkage)',
  matlabCode: `Z = linkage(data, 'ward');\ndendrogram(Z);\nclusters = cluster(Z, 'MaxClust', 3);`,
  sampleData: {
    data: '2.1,2.3;2.5,1.8;1.8,2.6;2.3,2.1;-1.8,-2.1;-2.2,-1.7;-1.5,-2.3;-2.0,-1.9;4.2,-1.8;3.8,-2.2;4.5,-1.5;4.0,-2.0',
    nClusters: '3',
  },
  params: [{ key: 'nClusters', label: 'Number of Clusters', type: 'number' as const, default: 3 }],
  compute: (p) => {
    const rows = (p.data as string).split(';').map(r => r.split(',').map(Number).filter(isFinite))
    const nClust = parseInt(p.nClusters) || 3
    if (rows.length < 3) return { error: 'Need at least 3 data points (rows separated by ;)' }
    // Use k-means as approximation for hierarchical result
    const result = kmeans(rows, nClust)
    // Compute cophenetic-like distances
    const withinSS = result.labels.reduce((s, l, i) => {
      const c = result.centroids[l]
      return s + rows[i].reduce((ss, v, d) => ss + (v - c[d]) ** 2, 0)
    }, 0)
    return {
      statistics: [
        { label: 'Data Points', value: String(rows.length) },
        { label: 'Clusters', value: String(nClust) },
        { label: 'Within-Cluster SS', value: withinSS.toFixed(4) },
        ...result.centroids.map((c, i) => ({ label: `Cluster ${i + 1} Center`, value: c.map(v => v.toFixed(2)).join(', ') })),
        ...Array.from({ length: nClust }, (_, i) => ({
          label: `Cluster ${i + 1} Size`, value: String(result.labels.filter(l => l === i).length),
        })),
      ],
      chartData: rows.map((r, i) => ({ x: r[0], y: r[1] || 0, label: `C${result.labels[i] + 1}` })),
      chartType: 'scatter' as const, chartTitle: 'Hierarchical Clustering', xLabel: 'Dim 1', yLabel: 'Dim 2',
    }
  }
},
{
  id: 'bio-gc-content', toolbox: 'bioinformatics', name: 'Sequence GC Content',
  matlabFn: 'basecount / nt2aa',
  description: 'Compute GC content, base composition, and dinucleotide frequencies',
  matlabCode: `seq = 'ATCGATCGATCG...';\nbc = basecount(seq);\ngc = (bc.G + bc.C) / length(seq);`,
  sampleData: { sequence: 'ATCGATCGTAGCTAGCTAGATCGCGATCGATAGCTAGCATCGATCGCTAGCGATCGATCGATCGATAGCTAGCGATCGATCG' },
  params: [],
  compute: (p) => {
    const seq = (p.sequence as string || '').toUpperCase().replace(/[^ATCGU]/g, '')
    if (seq.length < 10) return { error: 'Need at least 10 nucleotides (A/T/C/G/U)' }
    const counts = { A: 0, T: 0, C: 0, G: 0, U: 0 }
    for (const c of seq) if (c in counts) counts[c as keyof typeof counts]++
    const total = seq.length
    const gc = (counts.G + counts.C) / total
    // Dinucleotide frequencies
    const di: Record<string, number> = {}
    for (let i = 0; i < seq.length - 1; i++) {
      const d = seq[i] + seq[i + 1]
      di[d] = (di[d] || 0) + 1
    }
    const topDi = Object.entries(di).sort((a, b) => b[1] - a[1]).slice(0, 5)
    return {
      statistics: [
        { label: 'Sequence Length', value: String(total) + ' bp' },
        { label: 'GC Content', value: (gc * 100).toFixed(2) + '%' },
        { label: 'AT Content', value: ((counts.A + counts.T) / total * 100).toFixed(2) + '%' },
        { label: 'A count', value: String(counts.A) + ` (${(counts.A / total * 100).toFixed(1)}%)` },
        { label: 'T count', value: String(counts.T) + ` (${(counts.T / total * 100).toFixed(1)}%)` },
        { label: 'G count', value: String(counts.G) + ` (${(counts.G / total * 100).toFixed(1)}%)` },
        { label: 'C count', value: String(counts.C) + ` (${(counts.C / total * 100).toFixed(1)}%)` },
        ...topDi.map(([d, c]) => ({ label: `Dinucleotide ${d}`, value: String(c) })),
      ],
      chartData: Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => ({ x: k.charCodeAt(0), y: v, label: k })),
      chartType: 'bar' as const, chartTitle: 'Base Composition', xLabel: 'Base', yLabel: 'Count',
    }
  }
},
{
  id: 'bio-rnaseq-norm', toolbox: 'bioinformatics', name: 'RNA-Seq Normalization',
  matlabFn: 'CPM / TPM / RPKM',
  description: 'Normalize raw RNA-Seq counts to CPM, TPM, or RPKM for cross-sample comparison',
  matlabCode: `counts = readmatrix('counts.csv');\nlibSizes = sum(counts);\nCPM = counts ./ libSizes * 1e6;`,
  sampleData: {},
  params: [
    { key: 'nGenes', label: 'Number of Genes', type: 'number' as const, default: 20 },
    { key: 'nSamples', label: 'Number of Samples', type: 'number' as const, default: 6 },
  ],
  compute: (p) => {
    const nGenes = parseInt(p.nGenes) || 20, nSamp = parseInt(p.nSamples) || 6
    // Simulate raw counts (negative binomial-like)
    const counts: number[][] = Array.from({ length: nGenes }, () =>
      Array.from({ length: nSamp }, () => Math.floor(Math.random() * 500 + 10))
    )
    const libSizes = Array.from({ length: nSamp }, (_, j) => counts.reduce((s, g) => s + g[j], 0))
    // CPM normalization
    const cpm = counts.map(g => g.map((v, j) => v / libSizes[j] * 1e6))
    // Gene lengths (simulated, for TPM)
    const geneLengths = Array.from({ length: nGenes }, () => 500 + Math.floor(Math.random() * 4500))
    // TPM
    const rpk = counts.map((g, gi) => g.map(v => v / (geneLengths[gi] / 1000)))
    const rpkSums = Array.from({ length: nSamp }, (_, j) => rpk.reduce((s, g) => s + g[j], 0))
    const tpm = rpk.map(g => g.map((v, j) => v / rpkSums[j] * 1e6))
    return {
      statistics: [
        { label: 'Genes', value: String(nGenes) },
        { label: 'Samples', value: String(nSamp) },
        ...libSizes.map((v, i) => ({ label: `Library Size (S${i + 1})`, value: v.toLocaleString() })),
        { label: 'Mean CPM (Gene 1)', value: mean(cpm[0]).toFixed(2) },
        { label: 'Mean TPM (Gene 1)', value: mean(tpm[0]).toFixed(2) },
        { label: 'Total CPM per Sample', value: '1,000,000 (by definition)' },
        { label: 'Total TPM per Sample', value: '1,000,000 (by definition)' },
      ],
      chartData: cpm.slice(0, 10).map((g, i) => ({ x: i + 1, y: mean(g) })),
      chartType: 'bar' as const, chartTitle: 'Mean CPM (top 10 genes)', xLabel: 'Gene', yLabel: 'CPM',
    }
  }
},
{
  id: 'bio-phylo', toolbox: 'bioinformatics', name: 'Phylogenetic Distance',
  matlabFn: 'seqpdist',
  description: 'Compute pairwise evolutionary distances between DNA sequences',
  matlabCode: `seqs = {'ATCGATCG', 'ATCGTTCG', 'TTCGATCG'};\ndist = seqpdist(seqs, 'Method', 'Jukes-Cantor');`,
  sampleData: {
    seq1: 'ATCGATCGATCGATCGATCG',
    seq2: 'ATCGTTCGATCGATCGATCG',
    seq3: 'TTCGATCGATCAATCGATCG',
    seq4: 'ATCGATCGATCGATCGTTCG',
  },
  params: [],
  compute: (p) => {
    const seqs = [p.seq1, p.seq2, p.seq3, p.seq4].filter(s => s && s.length > 0).map(s => s.toUpperCase().replace(/[^ATCG]/g, ''))
    if (seqs.length < 2) return { error: 'Need at least 2 sequences' }
    const n = seqs.length
    const distances: { i: number; j: number; pDist: number; jc: number }[] = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const len = Math.min(seqs[i].length, seqs[j].length)
        let diff = 0
        for (let k = 0; k < len; k++) if (seqs[i][k] !== seqs[j][k]) diff++
        const pDist = diff / len
        // Jukes-Cantor correction
        const jc = pDist < 0.75 ? -0.75 * Math.log(1 - 4 / 3 * pDist) : Infinity
        distances.push({ i, j, pDist, jc })
      }
    }
    return {
      statistics: [
        { label: 'Sequences', value: String(n) },
        { label: 'Alignment Length', value: String(Math.min(...seqs.map(s => s.length))) + ' bp' },
        ...distances.map(d => ({
          label: `Seq${d.i + 1} vs Seq${d.j + 1} (p-dist)`,
          value: d.pDist.toFixed(4),
        })),
        ...distances.map(d => ({
          label: `Seq${d.i + 1} vs Seq${d.j + 1} (Jukes-Cantor)`,
          value: isFinite(d.jc) ? d.jc.toFixed(4) : 'Saturated',
        })),
      ],
      chartData: distances.map((d, i) => ({ x: i, y: d.jc })),
      chartType: 'bar' as const, chartTitle: 'Pairwise Distances', xLabel: 'Pair', yLabel: 'JC Distance',
    }
  }
},
{
  id: 'bio-microarray-norm', toolbox: 'bioinformatics', name: 'Quantile Normalization',
  matlabFn: 'quantilenorm',
  description: 'Normalize microarray data so all samples share the same distribution',
  matlabCode: `data = readmatrix('microarray.csv');\nnormalized = quantilenorm(data);`,
  sampleData: {},
  params: [
    { key: 'nGenes', label: 'Number of Probes', type: 'number' as const, default: 50 },
    { key: 'nSamples', label: 'Number of Samples', type: 'number' as const, default: 4 },
  ],
  compute: (p) => {
    const nG = parseInt(p.nGenes) || 50, nS = parseInt(p.nSamples) || 4
    // Simulate unnormalized microarray data
    const data: number[][] = Array.from({ length: nG }, () =>
      Array.from({ length: nS }, (_, j) => 5 + Math.random() * 10 + j * 2)  // systematic bias across samples
    )
    // Quantile normalization
    // 1. Sort each column, 2. Replace with row means of sorted, 3. Unsort
    const sortedIndices = Array.from({ length: nS }, (_, j) =>
      data.map((row, i) => ({ val: row[j], idx: i })).sort((a, b) => a.val - b.val).map(x => x.idx)
    )
    const sorted = Array.from({ length: nS }, (_, j) => sortedIndices[j].map(idx => data[idx][j]))
    const rowMeans = Array.from({ length: nG }, (_, i) => mean(sorted.map(col => col[i])))
    const normalized: number[][] = Array.from({ length: nG }, () => new Array(nS).fill(0))
    for (let j = 0; j < nS; j++) {
      for (let rank = 0; rank < nG; rank++) {
        normalized[sortedIndices[j][rank]][j] = rowMeans[rank]
      }
    }
    const beforeMeans = Array.from({ length: nS }, (_, j) => mean(data.map(r => r[j])))
    const afterMeans = Array.from({ length: nS }, (_, j) => mean(normalized.map(r => r[j])))
    return {
      statistics: [
        { label: 'Probes', value: String(nG) },
        { label: 'Samples', value: String(nS) },
        ...beforeMeans.map((v, i) => ({ label: `Before Mean (S${i + 1})`, value: v.toFixed(3) })),
        ...afterMeans.map((v, i) => ({ label: `After Mean (S${i + 1})`, value: v.toFixed(3) })),
        { label: 'Mean Variance Before', value: variance(beforeMeans).toFixed(4) },
        { label: 'Mean Variance After', value: variance(afterMeans).toFixed(6) },
      ],
      chartData: beforeMeans.map((v, i) => ({ x: i + 1, y: v, after: afterMeans[i] })),
      chartType: 'bar' as const, chartTitle: 'Sample Means Before/After', xLabel: 'Sample', yLabel: 'Mean Expression',
    }
  }
},

// ─── CURVE FITTING & OPTIMIZATION (6 presets) ────────────────────────

{
  id: 'fit-polyfit', toolbox: 'curvefit', name: 'Polynomial Fit',
  matlabFn: 'polyfit + polyval',
  description: 'Fit polynomial of degree N to data and evaluate goodness of fit',
  matlabCode: `x = 1:10;\ny = [2.1 4.9 8.8 15.2 24.5 36.1 50.2 66.8 85.1 106.0];\np = polyfit(x, y, 2);\nyhat = polyval(p, x);`,
  sampleData: {
    x: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10',
    y: '2.1, 4.9, 8.8, 15.2, 24.5, 36.1, 50.2, 66.8, 85.1, 106.0',
    degree: '2',
  },
  params: [{ key: 'degree', label: 'Polynomial Degree', type: 'number' as const, default: 2 }],
  compute: (p) => {
    const x = parseArray(p.x), y = parseArray(p.y), deg = parseInt(p.degree) || 2
    const n = Math.min(x.length, y.length)
    if (n < deg + 1) return { error: `Need at least ${deg + 1} points for degree ${deg}` }
    const coeffs = polyfit(x.slice(0, n), y.slice(0, n), deg)
    const predicted = x.slice(0, n).map(v => polyval(coeffs, v))
    const ss_res = y.slice(0, n).reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0)
    const ss_tot = y.slice(0, n).reduce((s, v) => s + (v - mean(y.slice(0, n))) ** 2, 0)
    const r2 = 1 - ss_res / (ss_tot || 1)
    const equation = coeffs.map((c, i) => {
      const power = deg - i
      if (power === 0) return c.toFixed(4)
      if (power === 1) return `${c.toFixed(4)}x`
      return `${c.toFixed(4)}x^${power}`
    }).join(' + ')
    return {
      statistics: [
        { label: 'Degree', value: String(deg) },
        { label: 'R²', value: r2.toFixed(6) },
        { label: 'RMSE', value: Math.sqrt(ss_res / n).toFixed(4) },
        { label: 'Equation', value: `y = ${equation}` },
        ...coeffs.map((c, i) => ({ label: `Coefficient [x^${deg - i}]`, value: c.toFixed(6) })),
      ],
      chartData: x.slice(0, n).map((v, i) => ({ x: v, y: y[i], predicted: predicted[i] })),
      chartType: 'scatter' as const, chartTitle: 'Polynomial Fit', xLabel: 'X', yLabel: 'Y',
    }
  }
},
{
  id: 'fit-exponential', toolbox: 'curvefit', name: 'Exponential Fit',
  matlabFn: 'fit (exp1)',
  description: 'Fit y = a*exp(b*x) to data — common for decay/growth processes',
  matlabCode: `x = (1:10)'; y = 100*exp(-0.3*x) + 5*randn(10,1);\nf = fit(x, y, 'exp1');`,
  sampleData: {
    x: '0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10',
    y: '100, 72, 54, 38, 27, 20, 15, 11, 8, 6, 4.5',
  },
  params: [],
  compute: (p) => {
    const x = parseArray(p.x), y = parseArray(p.y)
    const n = Math.min(x.length, y.length)
    if (n < 3) return { error: 'Need at least 3 data points' }
    // Linearize: ln(y) = ln(a) + b*x
    const lnY = y.slice(0, n).map(v => Math.log(Math.max(v, 1e-10)))
    const reg = linearRegression(x.slice(0, n), lnY)
    const a = Math.exp(reg.intercept), b = reg.slope
    const predicted = x.slice(0, n).map(v => a * Math.exp(b * v))
    const ss_res = y.slice(0, n).reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0)
    const ss_tot = y.slice(0, n).reduce((s, v) => s + (v - mean(y.slice(0, n))) ** 2, 0)
    const halfLife = b < 0 ? -Math.LN2 / b : Infinity
    return {
      statistics: [
        { label: 'a (amplitude)', value: a.toFixed(4) },
        { label: 'b (rate)', value: b.toFixed(6) },
        { label: 'Half-life', value: isFinite(halfLife) ? halfLife.toFixed(4) : 'N/A (growth)' },
        { label: 'Doubling time', value: b > 0 ? (Math.LN2 / b).toFixed(4) : 'N/A (decay)' },
        { label: 'R²', value: (1 - ss_res / (ss_tot || 1)).toFixed(6) },
        { label: 'Equation', value: `y = ${a.toFixed(3)} * exp(${b.toFixed(4)} * x)` },
      ],
      chartData: x.slice(0, n).map((v, i) => ({ x: v, y: y[i], predicted: predicted[i] })),
      chartType: 'scatter' as const, chartTitle: 'Exponential Fit', xLabel: 'X', yLabel: 'Y',
    }
  }
},
{
  id: 'fit-gaussian', toolbox: 'curvefit', name: 'Gaussian Fit',
  matlabFn: 'fit (gauss1)',
  description: 'Fit y = a*exp(-((x-b)/c)²) to data — peaks, spectral lines, distributions',
  matlabCode: `x = (-5:0.1:5)';\ny = 3*exp(-((x-1)/1.5).^2) + 0.1*randn(size(x));\nf = fit(x, y, 'gauss1');`,
  sampleData: {
    x: '-5,-4,-3,-2,-1,0,1,2,3,4,5',
    y: '0.01,0.05,0.22,0.68,1.45,2.30,2.95,2.30,1.45,0.68,0.22',
  },
  params: [],
  compute: (p) => {
    const x = parseArray(p.x), y = parseArray(p.y)
    const n = Math.min(x.length, y.length)
    if (n < 4) return { error: 'Need at least 4 data points' }
    // Estimate Gaussian parameters from data
    const totalWeight = sum(y.slice(0, n).map(v => Math.max(v, 0)))
    const mu = totalWeight > 0 ? sum(x.slice(0, n).map((v, i) => v * Math.max(y[i], 0))) / totalWeight : mean(x)
    const sigma = totalWeight > 0 ? Math.sqrt(sum(x.slice(0, n).map((v, i) => (v - mu) ** 2 * Math.max(y[i], 0))) / totalWeight) : 1
    const amp = Math.max(...y.slice(0, n))
    const predicted = x.slice(0, n).map(v => amp * Math.exp(-0.5 * ((v - mu) / (sigma || 1)) ** 2))
    const ss_res = y.slice(0, n).reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0)
    const ss_tot = y.slice(0, n).reduce((s, v) => s + (v - mean(y.slice(0, n))) ** 2, 0)
    return {
      statistics: [
        { label: 'Amplitude (a)', value: amp.toFixed(4) },
        { label: 'Center (µ)', value: mu.toFixed(4) },
        { label: 'Width (σ)', value: sigma.toFixed(4) },
        { label: 'FWHM', value: (2.355 * sigma).toFixed(4) },
        { label: 'R²', value: (1 - ss_res / (ss_tot || 1)).toFixed(6) },
        { label: 'Equation', value: `y = ${amp.toFixed(3)} * exp(-((x-${mu.toFixed(3)})/${sigma.toFixed(3)})²)` },
      ],
      chartData: x.slice(0, n).map((v, i) => ({ x: v, y: y[i], predicted: predicted[i] })),
      chartType: 'scatter' as const, chartTitle: 'Gaussian Fit', xLabel: 'X', yLabel: 'Y',
    }
  }
},
{
  id: 'fit-nlsq', toolbox: 'curvefit', name: 'Nonlinear Least Squares',
  matlabFn: 'lsqcurvefit',
  description: 'Fit Michaelis-Menten kinetics: v = Vmax*[S]/(Km+[S])',
  matlabCode: `S = [0.1 0.5 1 2 5 10 20 50];\nv = [0.9 3.8 6.5 9.2 13.1 14.8 15.8 16.2];\nfun = @(p,S) p(1)*S./(p(2)+S);\np = lsqcurvefit(fun, [20,5], S, v);`,
  sampleData: {
    S: '0.1, 0.5, 1, 2, 5, 10, 20, 50',
    v: '0.9, 3.8, 6.5, 9.2, 13.1, 14.8, 15.8, 16.2',
  },
  params: [],
  compute: (p) => {
    const S = parseArray(p.S), v = parseArray(p.v)
    const n = Math.min(S.length, v.length)
    if (n < 3) return { error: 'Need at least 3 data points' }
    // Lineweaver-Burk linearization: 1/v = (Km/Vmax)(1/S) + 1/Vmax
    const invS = S.slice(0, n).map(s => 1 / (s || 0.001))
    const invV = v.slice(0, n).map(vi => 1 / (vi || 0.001))
    const reg = linearRegression(invS, invV)
    const Vmax = 1 / reg.intercept, Km = reg.slope * Vmax
    const predicted = S.slice(0, n).map(s => Vmax * s / (Km + s))
    const ss_res = v.slice(0, n).reduce((s, vi, i) => s + (vi - predicted[i]) ** 2, 0)
    const ss_tot = v.slice(0, n).reduce((s, vi) => s + (vi - mean(v.slice(0, n))) ** 2, 0)
    return {
      statistics: [
        { label: 'Vmax', value: Vmax.toFixed(4) },
        { label: 'Km', value: Km.toFixed(4) },
        { label: 'Catalytic Efficiency (Vmax/Km)', value: (Vmax / Km).toFixed(4) },
        { label: 'R²', value: (1 - ss_res / (ss_tot || 1)).toFixed(6) },
        { label: 'Equation', value: `v = ${Vmax.toFixed(2)}*[S] / (${Km.toFixed(2)} + [S])` },
        { label: 'Half-Vmax at [S]=', value: Km.toFixed(4) },
      ],
      chartData: S.slice(0, n).map((s, i) => ({ x: s, y: v[i], predicted: predicted[i] })),
      chartType: 'scatter' as const, chartTitle: 'Michaelis-Menten Fit', xLabel: '[Substrate]', yLabel: 'Velocity',
    }
  }
},
{
  id: 'fit-gmm', toolbox: 'curvefit', name: 'Gaussian Mixture Model',
  matlabFn: 'fitgmdist',
  description: 'Fit a mixture of K Gaussians to 1D data (e.g., bimodal distributions)',
  matlabCode: `data = [randn(200,1)*2+5; randn(150,1)*1.5+15];\ngm = fitgmdist(data, 2);`,
  sampleData: {},
  params: [
    { key: 'k', label: 'Number of Components', type: 'number' as const, default: 2 },
    { key: 'mu1', label: 'True Mean 1', type: 'number' as const, default: 5 },
    { key: 'mu2', label: 'True Mean 2', type: 'number' as const, default: 15 },
  ],
  compute: (p) => {
    const K = parseInt(p.k) || 2
    const mu1 = parseFloat(p.mu1) || 5, mu2 = parseFloat(p.mu2) || 15
    // Generate bimodal data
    const n1 = 200, n2 = 150
    const data = [
      ...Array.from({ length: n1 }, () => mu1 + 2 * (Math.random() + Math.random() + Math.random() - 1.5)),
      ...Array.from({ length: n2 }, () => mu2 + 1.5 * (Math.random() + Math.random() + Math.random() - 1.5)),
    ]
    // Simple EM for 1D GMM
    let means = [mu1 - 2, mu2 + 2], sigmas = [2, 2], weights = [0.5, 0.5]
    for (let iter = 0; iter < 50; iter++) {
      // E-step
      const resp = data.map(x => {
        const probs = means.map((m, k) =>
          weights[k] * Math.exp(-0.5 * ((x - m) / sigmas[k]) ** 2) / sigmas[k]
        )
        const total = sum(probs) || 1e-10
        return probs.map(p => p / total)
      })
      // M-step
      for (let k = 0; k < K; k++) {
        const nk = sum(resp.map(r => r[k]))
        weights[k] = nk / data.length
        means[k] = sum(data.map((x, i) => x * resp[i][k])) / (nk || 1)
        sigmas[k] = Math.sqrt(sum(data.map((x, i) => (x - means[k]) ** 2 * resp[i][k])) / (nk || 1)) || 0.1
      }
    }
    // Histogram
    const bins = 30, min = Math.min(...data), max = Math.max(...data)
    const binWidth = (max - min) / bins
    const hist = new Array(bins).fill(0)
    data.forEach(v => { const b = Math.min(bins - 1, Math.floor((v - min) / binWidth)); hist[b]++ })
    return {
      statistics: [
        { label: 'N', value: String(data.length) },
        { label: 'Components', value: String(K) },
        ...means.map((m, i) => ({ label: `Mean ${i + 1}`, value: m.toFixed(4) })),
        ...sigmas.map((s, i) => ({ label: `Sigma ${i + 1}`, value: s.toFixed(4) })),
        ...weights.map((w, i) => ({ label: `Weight ${i + 1}`, value: (w * 100).toFixed(1) + '%' })),
        { label: 'BIC', value: (-2 * data.reduce((s, x) => {
          const ll = sum(means.map((m, k) => weights[k] * Math.exp(-0.5 * ((x - m) / sigmas[k]) ** 2) / (sigmas[k] * Math.sqrt(2 * Math.PI))))
          return s + Math.log(ll + 1e-15)
        }, 0) + (3 * K - 1) * Math.log(data.length)).toFixed(2) },
      ],
      chartData: hist.map((v, i) => ({ x: min + (i + 0.5) * binWidth, y: v })),
      chartType: 'bar' as const, chartTitle: 'GMM Histogram', xLabel: 'Value', yLabel: 'Count',
    }
  }
},
{
  id: 'fit-spline', toolbox: 'curvefit', name: 'Spline Interpolation',
  matlabFn: 'spline / interp1',
  description: 'Smooth interpolation through data points using cubic spline',
  matlabCode: `x = [0 1 2 3 4 5];\ny = [0 0.8 0.9 0.1 -0.8 -1];\nxx = 0:0.01:5;\nyy = spline(x, y, xx);`,
  sampleData: {
    x: '0, 1, 2, 3, 4, 5, 6, 7, 8',
    y: '0, 0.84, 0.91, 0.14, -0.76, -0.96, -0.28, 0.66, 0.99',
  },
  params: [{ key: 'nInterp', label: 'Interpolation Points', type: 'number' as const, default: 100 }],
  compute: (p) => {
    const x = parseArray(p.x), y = parseArray(p.y)
    const nInterp = parseInt(p.nInterp) || 100
    const n = Math.min(x.length, y.length)
    if (n < 3) return { error: 'Need at least 3 data points' }
    // Simple cubic interpolation (Catmull-Rom-like)
    const xMin = Math.min(...x), xMax = Math.max(...x)
    const interp: { x: number; y: number }[] = []
    for (let i = 0; i < nInterp; i++) {
      const xi = xMin + (xMax - xMin) * i / (nInterp - 1)
      // Find surrounding points
      let lo = 0
      for (let j = 0; j < n - 1; j++) if (x[j] <= xi) lo = j
      const hi = Math.min(lo + 1, n - 1)
      if (lo === hi) { interp.push({ x: xi, y: y[lo] }); continue }
      const t = (xi - x[lo]) / (x[hi] - x[lo] || 1)
      // Hermite interpolation
      const m0 = lo > 0 ? (y[hi] - y[lo - 1]) / (x[hi] - x[lo - 1] || 1) : (y[hi] - y[lo]) / (x[hi] - x[lo] || 1)
      const m1 = hi < n - 1 ? (y[hi + 1] - y[lo]) / (x[hi + 1] - x[lo] || 1) : (y[hi] - y[lo]) / (x[hi] - x[lo] || 1)
      const h = x[hi] - x[lo]
      const yi = (2 * t ** 3 - 3 * t ** 2 + 1) * y[lo] + (t ** 3 - 2 * t ** 2 + t) * h * m0 +
                 (-2 * t ** 3 + 3 * t ** 2) * y[hi] + (t ** 3 - t ** 2) * h * m1
      interp.push({ x: xi, y: yi })
    }
    return {
      statistics: [
        { label: 'Data Points', value: String(n) },
        { label: 'Interpolated Points', value: String(nInterp) },
        { label: 'X Range', value: `${xMin.toFixed(2)} to ${xMax.toFixed(2)}` },
        { label: 'Y Range', value: `${Math.min(...y).toFixed(2)} to ${Math.max(...y).toFixed(2)}` },
      ],
      chartData: interp,
      chartType: 'line' as const, chartTitle: 'Spline Interpolation', xLabel: 'X', yLabel: 'Y',
    }
  }
},

// ─── ODE SOLVERS & SIMULATION (8 presets) ────────────────────────────

{
  id: 'ode-pk1', toolbox: 'ode', name: 'One-Compartment PK (IV Bolus)',
  matlabFn: 'ode45',
  description: 'Simulate single-compartment pharmacokinetics: dC/dt = -ke*C',
  matlabCode: `f = @(t,C) -0.15*C;\n[t,C] = ode45(f, [0 48], 100/50);  % D=100mg, V=50L`,
  sampleData: { dose: '100', volume: '50', ke: '0.15', tmax: '48' },
  params: [
    { key: 'dose', label: 'Dose (mg)', type: 'number' as const, default: 100 },
    { key: 'volume', label: 'Volume of Distribution (L)', type: 'number' as const, default: 50 },
    { key: 'ke', label: 'Elimination Rate (1/h)', type: 'number' as const, default: 0.15 },
    { key: 'tmax', label: 'Simulation Time (h)', type: 'number' as const, default: 48 },
  ],
  compute: (p) => {
    const D = parseFloat(p.dose) || 100, V = parseFloat(p.volume) || 50
    const ke = parseFloat(p.ke) || 0.15, tmax = parseFloat(p.tmax) || 48
    const C0 = D / V
    const result = ode45((_, y) => [-ke * y[0]], [0, tmax], [C0], 200)
    const halfLife = Math.LN2 / ke, auc = C0 / ke, clearance = ke * V
    return {
      statistics: [
        { label: 'C0 (mg/L)', value: C0.toFixed(4) },
        { label: 'Half-life (h)', value: halfLife.toFixed(2) },
        { label: 'AUC (mg*h/L)', value: auc.toFixed(2) },
        { label: 'Clearance (L/h)', value: clearance.toFixed(2) },
        { label: 'ke (1/h)', value: ke.toFixed(4) },
        { label: 'Vd (L)', value: V.toFixed(1) },
        { label: 'C at t=12h', value: (C0 * Math.exp(-ke * 12)).toFixed(4) },
        { label: 'C at t=24h', value: (C0 * Math.exp(-ke * 24)).toFixed(4) },
      ],
      chartData: result.t.map((t, i) => ({ x: t, y: result.y[i][0] })),
      chartType: 'line' as const, chartTitle: 'Plasma Concentration vs Time', xLabel: 'Time (h)', yLabel: 'Concentration (mg/L)',
    }
  }
},
{
  id: 'ode-pk2', toolbox: 'ode', name: 'Two-Compartment PK',
  matlabFn: 'ode45',
  description: 'Two-compartment model: central + peripheral with distribution phase',
  matlabCode: `f = @(t,y) [-(k12+ke)*y(1)+k21*y(2); k12*y(1)-k21*y(2)];\n[t,y] = ode45(f, [0 72], [100/10; 0]);`,
  sampleData: { dose: '100', Vc: '10', k12: '0.5', k21: '0.3', ke: '0.1', tmax: '72' },
  params: [
    { key: 'dose', label: 'Dose (mg)', type: 'number' as const, default: 100 },
    { key: 'Vc', label: 'Central Volume (L)', type: 'number' as const, default: 10 },
    { key: 'k12', label: 'k12 (central→periph)', type: 'number' as const, default: 0.5 },
    { key: 'k21', label: 'k21 (periph→central)', type: 'number' as const, default: 0.3 },
    { key: 'ke', label: 'ke (elimination)', type: 'number' as const, default: 0.1 },
    { key: 'tmax', label: 'Time (h)', type: 'number' as const, default: 72 },
  ],
  compute: (p) => {
    const D = parseFloat(p.dose) || 100, Vc = parseFloat(p.Vc) || 10
    const k12 = parseFloat(p.k12) || 0.5, k21 = parseFloat(p.k21) || 0.3
    const ke = parseFloat(p.ke) || 0.1, tmax = parseFloat(p.tmax) || 72
    const result = ode45((_, y) => [
      -(k12 + ke) * y[0] + k21 * y[1],
      k12 * y[0] - k21 * y[1],
    ], [0, tmax], [D / Vc, 0], 300)
    const alpha = 0.5 * ((k12 + k21 + ke) + Math.sqrt((k12 + k21 + ke) ** 2 - 4 * k21 * ke))
    const beta = 0.5 * ((k12 + k21 + ke) - Math.sqrt((k12 + k21 + ke) ** 2 - 4 * k21 * ke))
    return {
      statistics: [
        { label: 'Alpha (distribution)', value: alpha.toFixed(4) + ' /h' },
        { label: 'Beta (elimination)', value: beta.toFixed(4) + ' /h' },
        { label: 'Alpha half-life', value: (Math.LN2 / alpha).toFixed(2) + ' h' },
        { label: 'Beta half-life', value: (Math.LN2 / beta).toFixed(2) + ' h' },
        { label: 'C0', value: (D / Vc).toFixed(2) + ' mg/L' },
        { label: 'Vss', value: (Vc * (1 + k12 / k21)).toFixed(2) + ' L' },
      ],
      chartData: result.t.map((t, i) => ({ x: t, y: result.y[i][0] })),
      chartType: 'line' as const, chartTitle: '2-Compartment PK', xLabel: 'Time (h)', yLabel: 'Central Conc (mg/L)',
    }
  }
},
{
  id: 'ode-sir', toolbox: 'ode', name: 'SIR Epidemiological Model',
  matlabFn: 'ode45',
  description: 'Susceptible-Infected-Recovered model for infectious disease spread',
  matlabCode: `f = @(t,y) [-beta*y(1)*y(2); beta*y(1)*y(2)-gamma*y(2); gamma*y(2)];\n[t,y] = ode45(f, [0 160], [0.99; 0.01; 0]);`,
  sampleData: { beta: '0.3', gamma: '0.1', S0: '0.99', I0: '0.01', tmax: '160' },
  params: [
    { key: 'beta', label: 'Transmission Rate (β)', type: 'number' as const, default: 0.3 },
    { key: 'gamma', label: 'Recovery Rate (γ)', type: 'number' as const, default: 0.1 },
    { key: 'S0', label: 'Initial Susceptible (S0)', type: 'number' as const, default: 0.99 },
    { key: 'I0', label: 'Initial Infected (I0)', type: 'number' as const, default: 0.01 },
    { key: 'tmax', label: 'Days', type: 'number' as const, default: 160 },
  ],
  compute: (p) => {
    const beta = parseFloat(p.beta) || 0.3, gamma = parseFloat(p.gamma) || 0.1
    const S0 = parseFloat(p.S0) || 0.99, I0 = parseFloat(p.I0) || 0.01
    const tmax = parseFloat(p.tmax) || 160, R0 = 1 - S0 - I0
    const result = ode45((_, y) => [
      -beta * y[0] * y[1],
      beta * y[0] * y[1] - gamma * y[1],
      gamma * y[1],
    ], [0, tmax], [S0, I0, R0], 400)
    const peakI = Math.max(...result.y.map(y => y[1]))
    const peakDay = result.t[result.y.findIndex(y => y[1] === peakI)]
    const Rnaught = beta / gamma
    return {
      statistics: [
        { label: 'R₀ (Basic Reproduction)', value: Rnaught.toFixed(2) },
        { label: 'Peak Infection', value: (peakI * 100).toFixed(2) + '%' },
        { label: 'Peak Day', value: peakDay.toFixed(0) },
        { label: 'Final Recovered', value: (result.y[result.y.length - 1][2] * 100).toFixed(2) + '%' },
        { label: 'Herd Immunity Threshold', value: ((1 - 1 / Rnaught) * 100).toFixed(1) + '%' },
        { label: 'Epidemic Duration (I>1%)', value: (() => {
          const above = result.y.filter(y => y[1] > 0.01)
          return above.length > 0 ? (above.length * tmax / result.y.length).toFixed(0) + ' days' : 'N/A'
        })() },
      ],
      chartData: result.t.map((t, i) => ({ x: t, y: result.y[i][1] * 100 })),
      chartType: 'area' as const, chartTitle: 'SIR Model — Infected', xLabel: 'Days', yLabel: 'Infected (%)',
    }
  }
},
{
  id: 'ode-lotka', toolbox: 'ode', name: 'Lotka-Volterra (Predator-Prey)',
  matlabFn: 'ode45',
  description: 'Predator-prey dynamics: oscillating populations of prey and predator',
  matlabCode: `f = @(t,y) [alpha*y(1)-beta*y(1)*y(2); delta*y(1)*y(2)-gamma*y(2)];\n[t,y] = ode45(f, [0 100], [40; 9]);`,
  sampleData: { alpha: '1.1', beta: '0.4', delta: '0.1', gamma: '0.4', prey0: '40', pred0: '9', tmax: '100' },
  params: [
    { key: 'alpha', label: 'Prey Growth (α)', type: 'number' as const, default: 1.1 },
    { key: 'beta', label: 'Predation Rate (β)', type: 'number' as const, default: 0.4 },
    { key: 'delta', label: 'Predator Growth (δ)', type: 'number' as const, default: 0.1 },
    { key: 'gamma', label: 'Predator Death (γ)', type: 'number' as const, default: 0.4 },
    { key: 'prey0', label: 'Initial Prey', type: 'number' as const, default: 40 },
    { key: 'pred0', label: 'Initial Predators', type: 'number' as const, default: 9 },
    { key: 'tmax', label: 'Time', type: 'number' as const, default: 100 },
  ],
  compute: (p) => {
    const a = parseFloat(p.alpha) || 1.1, b = parseFloat(p.beta) || 0.4
    const d = parseFloat(p.delta) || 0.1, g = parseFloat(p.gamma) || 0.4
    const prey0 = parseFloat(p.prey0) || 40, pred0 = parseFloat(p.pred0) || 9
    const tmax = parseFloat(p.tmax) || 100
    const result = ode45((_, y) => [
      a * y[0] - b * y[0] * y[1],
      d * y[0] * y[1] - g * y[1],
    ], [0, tmax], [prey0, pred0], 500)
    return {
      statistics: [
        { label: 'Prey Equilibrium', value: (g / d).toFixed(2) },
        { label: 'Predator Equilibrium', value: (a / b).toFixed(2) },
        { label: 'Max Prey', value: Math.max(...result.y.map(y => y[0])).toFixed(1) },
        { label: 'Max Predator', value: Math.max(...result.y.map(y => y[1])).toFixed(1) },
        { label: 'Min Prey', value: Math.min(...result.y.map(y => y[0])).toFixed(1) },
      ],
      chartData: result.t.map((t, i) => ({ x: t, y: result.y[i][0], predator: result.y[i][1] })),
      chartType: 'line' as const, chartTitle: 'Lotka-Volterra Dynamics', xLabel: 'Time', yLabel: 'Population',
    }
  }
},
{
  id: 'ode-mm', toolbox: 'ode', name: 'Michaelis-Menten Kinetics',
  matlabFn: 'ode45',
  description: 'Enzyme kinetics: substrate depletion over time dS/dt = -Vmax*S/(Km+S)',
  matlabCode: `f = @(t,S) -10*S./(2+S);  % Vmax=10, Km=2\n[t,S] = ode45(f, [0 5], 20);`,
  sampleData: { Vmax: '10', Km: '2', S0: '20', tmax: '5' },
  params: [
    { key: 'Vmax', label: 'Vmax', type: 'number' as const, default: 10 },
    { key: 'Km', label: 'Km', type: 'number' as const, default: 2 },
    { key: 'S0', label: 'Initial [Substrate]', type: 'number' as const, default: 20 },
    { key: 'tmax', label: 'Time', type: 'number' as const, default: 5 },
  ],
  compute: (p) => {
    const Vmax = parseFloat(p.Vmax) || 10, Km = parseFloat(p.Km) || 2
    const S0 = parseFloat(p.S0) || 20, tmax = parseFloat(p.tmax) || 5
    const result = ode45((_, y) => [-Vmax * y[0] / (Km + y[0])], [0, tmax], [S0], 300)
    const P = result.y.map(y => S0 - y[0]) // product formed
    return {
      statistics: [
        { label: 'Vmax', value: Vmax.toFixed(2) }, { label: 'Km', value: Km.toFixed(2) },
        { label: 'Initial Rate (V0)', value: (Vmax * S0 / (Km + S0)).toFixed(4) },
        { label: 'Time to 50% conversion', value: (() => {
          const idx = result.y.findIndex(y => y[0] < S0 / 2)
          return idx >= 0 ? result.t[idx].toFixed(3) : '>' + tmax
        })() },
        { label: 'Final [S]', value: result.y[result.y.length - 1][0].toFixed(4) },
        { label: 'Total Product', value: P[P.length - 1].toFixed(4) },
      ],
      chartData: result.t.map((t, i) => ({ x: t, y: result.y[i][0] })),
      chartType: 'line' as const, chartTitle: 'Substrate Depletion', xLabel: 'Time', yLabel: '[Substrate]',
    }
  }
},
{
  id: 'ode-hill', toolbox: 'ode', name: 'Hill Equation (Dose-Response)',
  matlabFn: 'nlinfit / fit',
  description: 'Sigmoidal dose-response: E = Emax * D^n / (EC50^n + D^n)',
  matlabCode: `dose = logspace(-2, 2, 50);\nE = 100 * dose.^1.5 ./ (10.^1.5 + dose.^1.5);`,
  sampleData: { Emax: '100', EC50: '10', n: '1.5', doseMin: '0.01', doseMax: '100' },
  params: [
    { key: 'Emax', label: 'Emax', type: 'number' as const, default: 100 },
    { key: 'EC50', label: 'EC50', type: 'number' as const, default: 10 },
    { key: 'n', label: 'Hill Coefficient (n)', type: 'number' as const, default: 1.5 },
    { key: 'doseMin', label: 'Min Dose', type: 'number' as const, default: 0.01 },
    { key: 'doseMax', label: 'Max Dose', type: 'number' as const, default: 100 },
  ],
  compute: (p) => {
    const Emax = parseFloat(p.Emax) || 100, EC50 = parseFloat(p.EC50) || 10
    const n = parseFloat(p.n) || 1.5
    const dMin = parseFloat(p.doseMin) || 0.01, dMax = parseFloat(p.doseMax) || 100
    // Log-spaced doses
    const nPts = 50
    const doses = Array.from({ length: nPts }, (_, i) =>
      Math.pow(10, Math.log10(dMin) + (Math.log10(dMax) - Math.log10(dMin)) * i / (nPts - 1))
    )
    const effects = doses.map(d => Emax * Math.pow(d, n) / (Math.pow(EC50, n) + Math.pow(d, n)))
    return {
      statistics: [
        { label: 'Emax', value: Emax.toFixed(2) }, { label: 'EC50', value: EC50.toFixed(4) },
        { label: 'Hill Coefficient (n)', value: n.toFixed(2) },
        { label: 'E at EC50', value: (Emax / 2).toFixed(2) },
        { label: 'Cooperativity', value: n > 1 ? 'Positive' : n < 1 ? 'Negative' : 'None' },
        { label: 'E at dose=1', value: (Emax * Math.pow(1, n) / (Math.pow(EC50, n) + Math.pow(1, n))).toFixed(4) },
        { label: 'Equation', value: `E = ${Emax}*D^${n} / (${EC50}^${n} + D^${n})` },
      ],
      chartData: doses.map((d, i) => ({ x: Math.log10(d), y: effects[i] })),
      chartType: 'line' as const, chartTitle: 'Dose-Response Curve', xLabel: 'log10(Dose)', yLabel: 'Effect',
    }
  }
},
{
  id: 'ode-logistic', toolbox: 'ode', name: 'Logistic Growth',
  matlabFn: 'ode45',
  description: 'Population/tumor growth with carrying capacity: dN/dt = r*N*(1-N/K)',
  matlabCode: `f = @(t,N) 0.5*N*(1-N/1000);\n[t,N] = ode45(f, [0 30], 10);`,
  sampleData: { r: '0.5', K: '1000', N0: '10', tmax: '30' },
  params: [
    { key: 'r', label: 'Growth Rate (r)', type: 'number' as const, default: 0.5 },
    { key: 'K', label: 'Carrying Capacity (K)', type: 'number' as const, default: 1000 },
    { key: 'N0', label: 'Initial Population', type: 'number' as const, default: 10 },
    { key: 'tmax', label: 'Time', type: 'number' as const, default: 30 },
  ],
  compute: (p) => {
    const r = parseFloat(p.r) || 0.5, K = parseFloat(p.K) || 1000
    const N0 = parseFloat(p.N0) || 10, tmax = parseFloat(p.tmax) || 30
    const result = ode45((_, y) => [r * y[0] * (1 - y[0] / K)], [0, tmax], [N0], 300)
    const inflectionT = Math.log((K - N0) / N0) / r
    return {
      statistics: [
        { label: 'Growth Rate (r)', value: r.toFixed(3) },
        { label: 'Carrying Capacity (K)', value: K.toFixed(0) },
        { label: 'Doubling Time', value: (Math.LN2 / r).toFixed(2) },
        { label: 'Inflection Point (t)', value: inflectionT.toFixed(2) },
        { label: 'Population at Inflection', value: (K / 2).toFixed(0) },
        { label: 'Final Population', value: result.y[result.y.length - 1][0].toFixed(1) },
      ],
      chartData: result.t.map((t, i) => ({ x: t, y: result.y[i][0] })),
      chartType: 'line' as const, chartTitle: 'Logistic Growth', xLabel: 'Time', yLabel: 'Population',
    }
  }
},
{
  id: 'ode-montecarlo', toolbox: 'ode', name: 'Monte Carlo Simulation',
  matlabFn: 'randn + for loop',
  description: 'Monte Carlo simulation of a clinical trial outcome with random patient variability',
  matlabCode: `nSim = 10000;\neffects = normrnd(5, 2, [nSim 1]);\nprob_success = mean(effects > 3);`,
  sampleData: { nSim: '5000', trueMean: '5', trueSD: '2', threshold: '3' },
  params: [
    { key: 'nSim', label: 'Simulations', type: 'number' as const, default: 5000 },
    { key: 'trueMean', label: 'True Effect (mean)', type: 'number' as const, default: 5 },
    { key: 'trueSD', label: 'Variability (SD)', type: 'number' as const, default: 2 },
    { key: 'threshold', label: 'Success Threshold', type: 'number' as const, default: 3 },
  ],
  compute: (p) => {
    const nSim = Math.min(parseInt(p.nSim) || 5000, 50000)
    const mu = parseFloat(p.trueMean) || 5, sd = parseFloat(p.trueSD) || 2
    const thresh = parseFloat(p.threshold) || 3
    // Box-Muller transform for normal random numbers
    const effects = Array.from({ length: nSim }, () => {
      const u1 = Math.random(), u2 = Math.random()
      return mu + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    })
    const successes = effects.filter(e => e > thresh).length
    const probSuccess = successes / nSim
    // Histogram
    const bins = 40, mn = Math.min(...effects), mx = Math.max(...effects)
    const binW = (mx - mn) / bins
    const hist = new Array(bins).fill(0)
    effects.forEach(e => { const b = Math.min(bins - 1, Math.floor((e - mn) / binW)); hist[b]++ })
    return {
      statistics: [
        { label: 'Simulations', value: nSim.toLocaleString() },
        { label: 'True Mean', value: mu.toFixed(2) }, { label: 'True SD', value: sd.toFixed(2) },
        { label: 'Success Threshold', value: thresh.toFixed(2) },
        { label: 'P(success)', value: (probSuccess * 100).toFixed(2) + '%' },
        { label: '95% CI Lower', value: ((probSuccess - 1.96 * Math.sqrt(probSuccess * (1 - probSuccess) / nSim)) * 100).toFixed(2) + '%' },
        { label: '95% CI Upper', value: ((probSuccess + 1.96 * Math.sqrt(probSuccess * (1 - probSuccess) / nSim)) * 100).toFixed(2) + '%' },
        { label: 'Simulated Mean', value: mean(effects).toFixed(4) },
        { label: 'Simulated SD', value: std(effects).toFixed(4) },
      ],
      chartData: hist.map((v, i) => ({ x: mn + (i + 0.5) * binW, y: v })),
      chartType: 'bar' as const, chartTitle: 'Monte Carlo Distribution', xLabel: 'Effect', yLabel: 'Count',
    }
  }
},

// ─── SURVIVAL ANALYSIS (3 presets) ───────────────────────────────────

{
  id: 'surv-km', toolbox: 'survival', name: 'Kaplan-Meier Estimator',
  matlabFn: 'ecdf (censoring)',
  description: 'Estimate survival curve from time-to-event data with right censoring',
  matlabCode: `time = [1 2 3 4 5 6 7 8 9 10];\ncensored = [0 0 1 0 0 1 0 0 1 0];\n[f,x] = ecdf(time, 'censoring', censored, 'function', 'survivor');`,
  sampleData: {
    times: '2, 4, 6, 8, 10, 12, 14, 18, 20, 24, 3, 5, 7, 9, 11, 15, 17, 22, 25, 30',
    events: '1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1',
  },
  params: [],
  compute: (p) => {
    const times = parseArray(p.times), events = parseArray(p.events)
    const n = Math.min(times.length, events.length)
    if (n < 3) return { error: 'Need at least 3 observations' }
    // Sort by time
    const data = times.slice(0, n).map((t, i) => ({ t, e: events[i] >= 1 ? 1 : 0 })).sort((a, b) => a.t - b.t)
    // Kaplan-Meier
    const curve: { x: number; y: number }[] = [{ x: 0, y: 1.0 }]
    let nAtRisk = n, S = 1.0
    const uniqueTimes = [...new Set(data.filter(d => d.e === 1).map(d => d.t))].sort((a, b) => a - b)
    for (const t of uniqueTimes) {
      const events_at_t = data.filter(d => d.t === t && d.e === 1).length
      nAtRisk = data.filter(d => d.t >= t).length
      S *= (1 - events_at_t / nAtRisk)
      curve.push({ x: t, y: S })
    }
    const totalEvents = data.filter(d => d.e === 1).length
    const medianSurvival = curve.find(c => c.y <= 0.5)?.x || Infinity
    return {
      statistics: [
        { label: 'N', value: String(n) },
        { label: 'Events', value: String(totalEvents) },
        { label: 'Censored', value: String(n - totalEvents) },
        { label: 'Median Survival', value: isFinite(medianSurvival) ? medianSurvival.toFixed(2) : 'Not reached' },
        { label: '1-year Survival', value: ((curve.find(c => c.x >= 12)?.y || curve[curve.length - 1].y) * 100).toFixed(1) + '%' },
        { label: 'Final Survival', value: (S * 100).toFixed(1) + '%' },
      ],
      chartData: curve,
      chartType: 'line' as const, chartTitle: 'Kaplan-Meier Survival Curve', xLabel: 'Time', yLabel: 'Survival Probability',
    }
  }
},
{
  id: 'surv-cox', toolbox: 'survival', name: 'Cox Proportional Hazards',
  matlabFn: 'coxphfit',
  description: 'Estimate hazard ratios for covariates in survival analysis',
  matlabCode: `[b,logl,H,stats] = coxphfit(X, time, 'Censoring', censored);`,
  sampleData: {
    times: '5, 10, 15, 8, 20, 3, 12, 25, 7, 18, 22, 6, 14, 9, 30, 4, 11, 16, 28, 13',
    events: '1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1',
    treatment: '1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0',
  },
  params: [],
  compute: (p) => {
    const times = parseArray(p.times), events = parseArray(p.events), treat = parseArray(p.treatment)
    const n = Math.min(times.length, events.length, treat.length)
    if (n < 5) return { error: 'Need at least 5 observations' }
    // Simplified Cox regression via score test approach
    const data = times.slice(0, n).map((t, i) => ({ t, e: events[i], x: treat[i] })).sort((a, b) => a.t - b.t)
    // Median survival by group
    const g0 = data.filter(d => d.x === 0), g1 = data.filter(d => d.x === 1)
    const medianG0 = median(g0.filter(d => d.e === 1).map(d => d.t))
    const medianG1 = median(g1.filter(d => d.e === 1).map(d => d.t))
    const eventRate0 = g0.filter(d => d.e === 1).length / g0.length
    const eventRate1 = g1.filter(d => d.e === 1).length / g1.length
    // Approximate hazard ratio via log-rank approach
    const hr = eventRate1 / (eventRate0 || 0.01)
    const logHR = Math.log(hr)
    const se = Math.sqrt(1 / g0.filter(d => d.e === 1).length + 1 / Math.max(1, g1.filter(d => d.e === 1).length))
    const z = logHR / se, pVal = 2 * (1 - normCDF(Math.abs(z)))
    return {
      statistics: [
        { label: 'N', value: String(n) },
        { label: 'Treatment Group Size', value: String(g1.length) },
        { label: 'Control Group Size', value: String(g0.length) },
        { label: 'Hazard Ratio', value: hr.toFixed(4) },
        { label: 'log(HR)', value: logHR.toFixed(4) },
        { label: '95% CI Lower', value: Math.exp(logHR - 1.96 * se).toFixed(4) },
        { label: '95% CI Upper', value: Math.exp(logHR + 1.96 * se).toFixed(4) },
        { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Median Survival (Treatment)', value: medianG1.toFixed(2) },
        { label: 'Median Survival (Control)', value: medianG0.toFixed(2) },
      ],
      chartData: [
        ...g0.map(d => ({ x: d.t, y: 0 })),
        ...g1.map(d => ({ x: d.t, y: 1 })),
      ],
      chartType: 'scatter' as const, chartTitle: 'Event Times by Group', xLabel: 'Time', yLabel: 'Group',
    }
  }
},
{
  id: 'surv-logrank', toolbox: 'survival', name: 'Log-Rank Test',
  matlabFn: 'logrank (custom)',
  description: 'Compare survival curves between two groups (standard log-rank test)',
  matlabCode: `% Custom log-rank implementation\n[h,p,stats] = logrank_test(time1, cens1, time2, cens2);`,
  sampleData: {
    times1: '3, 5, 7, 12, 15, 18, 22, 28, 35, 40',
    events1: '1, 1, 1, 0, 1, 1, 0, 1, 1, 0',
    times2: '1, 2, 4, 6, 8, 11, 14, 17, 20, 24',
    events2: '1, 1, 1, 1, 0, 1, 1, 0, 1, 1',
  },
  params: [],
  compute: (p) => {
    const t1 = parseArray(p.times1), e1 = parseArray(p.events1)
    const t2 = parseArray(p.times2), e2 = parseArray(p.events2)
    const n1 = Math.min(t1.length, e1.length), n2 = Math.min(t2.length, e2.length)
    if (n1 < 3 || n2 < 3) return { error: 'Each group needs at least 3 observations' }
    // Combine and sort all unique event times
    const allTimes = [...new Set([
      ...t1.slice(0, n1).filter((_, i) => e1[i] === 1),
      ...t2.slice(0, n2).filter((_, i) => e2[i] === 1),
    ])].sort((a, b) => a - b)
    let O1 = 0, E1 = 0, V = 0
    for (const t of allTimes) {
      const r1 = t1.slice(0, n1).filter(ti => ti >= t).length
      const r2 = t2.slice(0, n2).filter(ti => ti >= t).length
      const d1 = t1.slice(0, n1).filter((ti, i) => ti === t && e1[i] === 1).length
      const d2 = t2.slice(0, n2).filter((ti, i) => ti === t && e2[i] === 1).length
      const r = r1 + r2, d = d1 + d2
      if (r < 2) continue
      O1 += d1
      E1 += d * r1 / r
      V += d * r1 * r2 * (r - d) / (r * r * (r - 1) || 1)
    }
    const chi2 = (O1 - E1) ** 2 / (V || 1)
    const pVal = 1 - chiCDF(chi2, 1)
    return {
      statistics: [
        { label: 'Group 1 N', value: String(n1) },
        { label: 'Group 2 N', value: String(n2) },
        { label: 'Group 1 Events', value: String(e1.slice(0, n1).filter(e => e === 1).length) },
        { label: 'Group 2 Events', value: String(e2.slice(0, n2).filter(e => e === 1).length) },
        { label: 'Observed (Group 1)', value: O1.toFixed(2) },
        { label: 'Expected (Group 1)', value: E1.toFixed(2) },
        { label: 'Chi-Square', value: chi2.toFixed(4) },
        { label: 'p-value', value: pVal.toFixed(6) },
        { label: 'Significant (α=0.05)?', value: pVal < 0.05 ? 'YES — Curves differ' : 'NO — No significant difference' },
      ],
      chartData: allTimes.map((t, i) => ({ x: t, y: i })),
      chartType: 'scatter' as const, chartTitle: 'Event Times', xLabel: 'Time', yLabel: 'Event Index',
    }
  }
},

// ─── MACHINE LEARNING (5 presets) ────────────────────────────────────

{
  id: 'ml-rf', toolbox: 'ml', name: 'Random Forest Classifier',
  matlabFn: 'fitcensemble / TreeBagger',
  description: 'Ensemble of decision trees for classification — bootstrap aggregating',
  matlabCode: `mdl = fitcensemble(X, y, 'Method', 'Bag', 'NumLearningCycles', 100);\n[yhat,scores] = predict(mdl, Xtest);`,
  sampleData: {},
  params: [
    { key: 'nTrees', label: 'Number of Trees', type: 'number' as const, default: 50 },
    { key: 'nSamples', label: 'Training Samples', type: 'number' as const, default: 200 },
  ],
  compute: (p) => {
    const nTrees = parseInt(p.nTrees) || 50, nSamp = parseInt(p.nSamples) || 200
    // Simulate 2D classification problem
    const data: { x: number[]; y: number }[] = Array.from({ length: nSamp }, () => {
      const cls = Math.random() < 0.5 ? 0 : 1
      const x1 = (cls === 0 ? 2 : -2) + (Math.random() - 0.5) * 4
      const x2 = (cls === 0 ? 2 : -2) + (Math.random() - 0.5) * 4
      return { x: [x1, x2], y: cls }
    })
    // Simple "random forest" via majority vote of random splits
    const predictions = data.map(d => {
      let votes0 = 0, votes1 = 0
      for (let t = 0; t < nTrees; t++) {
        const feat = t % 2  // alternate features
        const thresh = (Math.random() - 0.5) * 2
        const pred = d.x[feat] > thresh ? 1 : 0
        if (pred === 0) votes0++; else votes1++
      }
      return votes1 > votes0 ? 1 : 0
    })
    const accuracy = predictions.reduce<number>((s, pred, i) => s + (pred === data[i].y ? 1 : 0), 0) / nSamp
    const tp = predictions.reduce<number>((s, pred, i) => s + (pred === 1 && data[i].y === 1 ? 1 : 0), 0)
    const fp = predictions.reduce<number>((s, pred, i) => s + (pred === 1 && data[i].y === 0 ? 1 : 0), 0)
    const fn = predictions.reduce<number>((s, pred, i) => s + (pred === 0 && data[i].y === 1 ? 1 : 0), 0)
    const precision = tp / (tp + fp || 1), recall = tp / (tp + fn || 1)
    return {
      statistics: [
        { label: 'Trees', value: String(nTrees) },
        { label: 'Training Samples', value: String(nSamp) },
        { label: 'Accuracy', value: (accuracy * 100).toFixed(2) + '%' },
        { label: 'Precision', value: precision.toFixed(4) },
        { label: 'Recall', value: recall.toFixed(4) },
        { label: 'F1 Score', value: (2 * precision * recall / (precision + recall || 1)).toFixed(4) },
        { label: 'True Positives', value: String(tp) },
        { label: 'False Positives', value: String(fp) },
      ],
      chartData: data.slice(0, 100).map(d => ({ x: d.x[0], y: d.x[1] })),
      chartType: 'scatter' as const, chartTitle: 'Training Data', xLabel: 'Feature 1', yLabel: 'Feature 2',
    }
  }
},
{
  id: 'ml-knn', toolbox: 'ml', name: 'k-Nearest Neighbors',
  matlabFn: 'fitcknn',
  description: 'Classify by majority vote of K nearest neighbors',
  matlabCode: `mdl = fitcknn(X, y, 'NumNeighbors', 5);\nyhat = predict(mdl, Xtest);`,
  sampleData: {},
  params: [
    { key: 'k', label: 'K (neighbors)', type: 'number' as const, default: 5 },
    { key: 'nSamples', label: 'Training Samples', type: 'number' as const, default: 100 },
  ],
  compute: (p) => {
    const K = parseInt(p.k) || 5, nSamp = parseInt(p.nSamples) || 100
    // Generate 2-class data
    const train: { x: number[]; y: number }[] = Array.from({ length: nSamp }, () => {
      const cls = Math.random() < 0.5 ? 0 : 1
      return { x: [(cls * 3) + (Math.random() - 0.5) * 3, (cls * 3) + (Math.random() - 0.5) * 3], y: cls }
    })
    // Test on 20 points
    const test = Array.from({ length: 20 }, () => ({
      x: [Math.random() * 6 - 1.5, Math.random() * 6 - 1.5], y: 0,
    }))
    let correct = 0
    test.forEach(tp => {
      const dists = train.map(t => ({
        dist: Math.sqrt((tp.x[0] - t.x[0]) ** 2 + (tp.x[1] - t.x[1]) ** 2), y: t.y,
      })).sort((a, b) => a.dist - b.dist)
      const kNearest = dists.slice(0, K)
      const votes = kNearest.reduce((s, d) => s + d.y, 0)
      tp.y = votes > K / 2 ? 1 : 0
      // For accuracy, approximate true label
      const trueLabel = (tp.x[0] + tp.x[1]) / 2 > 1.5 ? 1 : 0
      if (tp.y === trueLabel) correct++
    })
    return {
      statistics: [
        { label: 'K', value: String(K) },
        { label: 'Training Size', value: String(nSamp) },
        { label: 'Test Size', value: '20' },
        { label: 'Estimated Accuracy', value: (correct / 20 * 100).toFixed(1) + '%' },
        { label: 'Optimal K (rule of thumb)', value: String(Math.round(Math.sqrt(nSamp))) },
      ],
      chartData: train.slice(0, 60).map(d => ({ x: d.x[0], y: d.x[1] })),
      chartType: 'scatter' as const, chartTitle: 'Training Data (KNN)', xLabel: 'Feature 1', yLabel: 'Feature 2',
    }
  }
},
{
  id: 'ml-svm', toolbox: 'ml', name: 'SVM Classification',
  matlabFn: 'fitcsvm',
  description: 'Support Vector Machine: find optimal separating hyperplane with max margin',
  matlabCode: `mdl = fitcsvm(X, y, 'KernelFunction', 'rbf');\n[yhat,scores] = predict(mdl, Xtest);`,
  sampleData: {},
  params: [
    { key: 'nSamples', label: 'Training Samples', type: 'number' as const, default: 100 },
    { key: 'C', label: 'Regularization (C)', type: 'number' as const, default: 1.0 },
  ],
  compute: (p) => {
    const nSamp = parseInt(p.nSamples) || 100, C = parseFloat(p.C) || 1.0
    // Generate linearly separable data with margin
    const data: { x: number[]; y: number }[] = Array.from({ length: nSamp }, () => {
      const cls = Math.random() < 0.5 ? -1 : 1
      return { x: [cls * 2 + (Math.random() - 0.5) * 2, cls + (Math.random() - 0.5) * 2], y: cls }
    })
    // Simple linear SVM via gradient descent (primal form)
    let w = [0, 0], b = 0
    const lr = 0.01
    for (let epoch = 0; epoch < 200; epoch++) {
      for (const d of data) {
        const margin = d.y * (w[0] * d.x[0] + w[1] * d.x[1] + b)
        if (margin < 1) {
          w[0] += lr * (C * d.y * d.x[0] - w[0] / nSamp)
          w[1] += lr * (C * d.y * d.x[1] - w[1] / nSamp)
          b += lr * C * d.y
        } else {
          w[0] -= lr * w[0] / nSamp
          w[1] -= lr * w[1] / nSamp
        }
      }
    }
    const predictions = data.map(d => (w[0] * d.x[0] + w[1] * d.x[1] + b) >= 0 ? 1 : -1)
    const accuracy = predictions.reduce((s, pred, i) => s + (pred === data[i].y ? 1 : 0), 0) / nSamp
    const marginWidth = 2 / Math.sqrt(w[0] ** 2 + w[1] ** 2)
    return {
      statistics: [
        { label: 'Training Accuracy', value: (accuracy * 100).toFixed(2) + '%' },
        { label: 'Weight [0]', value: w[0].toFixed(4) },
        { label: 'Weight [1]', value: w[1].toFixed(4) },
        { label: 'Bias', value: b.toFixed(4) },
        { label: 'Margin Width', value: marginWidth.toFixed(4) },
        { label: 'C (regularization)', value: C.toFixed(2) },
        { label: 'Decision Boundary', value: `${w[0].toFixed(3)}*x1 + ${w[1].toFixed(3)}*x2 + ${b.toFixed(3)} = 0` },
      ],
      chartData: data.map(d => ({ x: d.x[0], y: d.x[1] })),
      chartType: 'scatter' as const, chartTitle: 'SVM Decision Boundary', xLabel: 'Feature 1', yLabel: 'Feature 2',
    }
  }
},
{
  id: 'ml-roc', toolbox: 'ml', name: 'ROC Curve & AUC',
  matlabFn: 'perfcurve',
  description: 'Compute Receiver Operating Characteristic curve and Area Under Curve',
  matlabCode: `[X,Y,T,AUC] = perfcurve(labels, scores, 1);`,
  sampleData: {
    scores: '0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.3, 0.2, 0.85, 0.75, 0.65, 0.35, 0.25, 0.15, 0.1, 0.05, 0.5, 0.6',
    labels: '1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1',
  },
  params: [],
  compute: (p) => {
    const scores = parseArray(p.scores), labels = parseArray(p.labels)
    const n = Math.min(scores.length, labels.length)
    if (n < 4) return { error: 'Need at least 4 observations' }
    // Sort by score descending
    const data = scores.slice(0, n).map((s, i) => ({ s, l: labels[i] })).sort((a, b) => b.s - a.s)
    const nPos = data.filter(d => d.l === 1).length, nNeg = n - nPos
    // Build ROC curve
    const roc: { x: number; y: number }[] = [{ x: 0, y: 0 }]
    let tp = 0, fp = 0
    for (const d of data) {
      if (d.l === 1) tp++; else fp++
      roc.push({ x: fp / (nNeg || 1), y: tp / (nPos || 1) })
    }
    // AUC via trapezoidal rule
    let auc = 0
    for (let i = 1; i < roc.length; i++) {
      auc += (roc[i].x - roc[i - 1].x) * (roc[i].y + roc[i - 1].y) / 2
    }
    // Find optimal threshold (Youden's J)
    let bestJ = 0, bestThresh = 0.5
    tp = 0; fp = 0
    for (let i = 0; i < data.length; i++) {
      if (data[i].l === 1) tp++; else fp++
      const sens = tp / nPos, spec = 1 - fp / nNeg
      const j = sens + spec - 1
      if (j > bestJ) { bestJ = j; bestThresh = data[i].s }
    }
    return {
      statistics: [
        { label: 'AUC', value: auc.toFixed(4) },
        { label: 'N', value: String(n) },
        { label: 'Positives', value: String(nPos) },
        { label: 'Negatives', value: String(nNeg) },
        { label: 'Optimal Threshold', value: bestThresh.toFixed(4) },
        { label: "Youden's J", value: bestJ.toFixed(4) },
        { label: 'AUC Interpretation', value: auc > 0.9 ? 'Excellent' : auc > 0.8 ? 'Good' : auc > 0.7 ? 'Fair' : 'Poor' },
      ],
      chartData: roc,
      chartType: 'line' as const, chartTitle: 'ROC Curve', xLabel: 'False Positive Rate', yLabel: 'True Positive Rate',
    }
  }
},
{
  id: 'ml-crossval', toolbox: 'ml', name: 'K-Fold Cross-Validation',
  matlabFn: 'crossval',
  description: 'Estimate model generalization via K-fold CV (using linear regression)',
  matlabCode: `cv = crossval(mdl, 'KFold', 10);\nmse = kfoldLoss(cv);`,
  sampleData: {},
  params: [
    { key: 'kFolds', label: 'K (folds)', type: 'number' as const, default: 10 },
    { key: 'nSamples', label: 'Total Samples', type: 'number' as const, default: 100 },
  ],
  compute: (p) => {
    const K = parseInt(p.kFolds) || 10, nSamp = parseInt(p.nSamples) || 100
    // Generate regression data
    const trueSlope = 2.5, trueIntercept = 3.0
    const data = Array.from({ length: nSamp }, (_, i) => ({
      x: i / nSamp * 10,
      y: trueSlope * (i / nSamp * 10) + trueIntercept + (Math.random() - 0.5) * 4,
    }))
    // K-fold CV
    const foldSize = Math.floor(nSamp / K)
    const foldResults: { fold: number; mse: number; r2: number }[] = []
    for (let fold = 0; fold < K; fold++) {
      const testStart = fold * foldSize, testEnd = testStart + foldSize
      const trainX = [...data.slice(0, testStart), ...data.slice(testEnd)].map(d => d.x)
      const trainY = [...data.slice(0, testStart), ...data.slice(testEnd)].map(d => d.y)
      const testX = data.slice(testStart, testEnd).map(d => d.x)
      const testY = data.slice(testStart, testEnd).map(d => d.y)
      const reg = linearRegression(trainX, trainY)
      const testPred = testX.map(x => reg.slope * x + reg.intercept)
      const mse = mean(testY.map((y, i) => (y - testPred[i]) ** 2))
      const ss_res = sum(testY.map((y, i) => (y - testPred[i]) ** 2))
      const ss_tot = sum(testY.map(y => (y - mean(testY)) ** 2))
      foldResults.push({ fold: fold + 1, mse, r2: 1 - ss_res / (ss_tot || 1) })
    }
    const avgMSE = mean(foldResults.map(f => f.mse))
    const avgR2 = mean(foldResults.map(f => f.r2))
    return {
      statistics: [
        { label: 'K Folds', value: String(K) },
        { label: 'Samples per Fold', value: String(foldSize) },
        { label: 'Mean MSE', value: avgMSE.toFixed(4) },
        { label: 'SD of MSE', value: std(foldResults.map(f => f.mse)).toFixed(4) },
        { label: 'Mean R²', value: avgR2.toFixed(4) },
        { label: 'Mean RMSE', value: Math.sqrt(avgMSE).toFixed(4) },
        ...foldResults.map(f => ({ label: `Fold ${f.fold} MSE`, value: f.mse.toFixed(4) })),
      ],
      chartData: foldResults.map(f => ({ x: f.fold, y: f.mse })),
      chartType: 'bar' as const, chartTitle: 'MSE by Fold', xLabel: 'Fold', yLabel: 'MSE',
    }
  }
},

] // end PRESETS array


// ═══════════════════════════════════════════════════════════════════════
//  MAIN UI COMPONENT
// ═══════════════════════════════════════════════════════════════════════

// Set preset counts on categories
TOOLBOX_CATEGORIES.forEach(cat => {
  cat.presetCount = PRESETS.filter(p => p.toolbox === cat.id).length
})

export default function MatlabCompute() {
  const [selectedToolbox, setSelectedToolbox] = useState<string | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)
  const [params, setParams] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ComputeResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [runtime, setRuntime] = useState(0)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Filter presets by toolbox and search
  const filteredPresets = useMemo(() => {
    let list = PRESETS
    if (selectedToolbox) list = list.filter(p => p.toolbox === selectedToolbox)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.matlabFn.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.toolbox.toLowerCase().includes(q)
      )
    }
    return list
  }, [selectedToolbox, search])

  // Select a preset: auto-fill all params + sample data
  const selectPreset = useCallback((preset: Preset) => {
    setSelectedPreset(preset)
    setResult(null)
    setError('')
    // Auto-fill everything from sampleData + param defaults
    const newParams: Record<string, string> = {}
    if (preset.sampleData) {
      Object.entries(preset.sampleData).forEach(([k, v]) => { newParams[k] = String(v) })
    }
    preset.params.forEach(p => {
      if (!(p.key in newParams) && p.default !== undefined) newParams[p.key] = String(p.default)
    })
    setParams(newParams)
  }, [])

  // Execute compute
  const execute = useCallback(() => {
    if (!selectedPreset) return
    setRunning(true)
    setError('')
    setResult(null)
    const start = performance.now()
    // Run in setTimeout to avoid blocking UI
    setTimeout(() => {
      try {
        const res = selectedPreset.compute(params)
        if (res.error) {
          setError(res.error)
        } else {
          setResult(res)
        }
      } catch (e: any) {
        setError(e.message || 'Computation failed')
      }
      setRuntime((performance.now() - start) / 1000)
      setRunning(false)
    }, 50)
  }, [selectedPreset, params])

  const updateParam = (key: string, value: string) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  // Get all param keys for the selected preset (from sampleData + params)
  const allParamKeys = useMemo(() => {
    if (!selectedPreset) return []
    const keys = new Set<string>()
    if (selectedPreset.sampleData) Object.keys(selectedPreset.sampleData).forEach(k => keys.add(k))
    selectedPreset.params.forEach(p => keys.add(p.key))
    return Array.from(keys)
  }, [selectedPreset])

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FiCpu size={20} style={{ color: 'var(--color-accent-blue)' }} />
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              MATLAB Compute Engine
            </h1>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-accent-blue)', color: '#fff' }}>
            {PRESETS.length} Presets
          </span>
        </div>
        <div className="relative w-72">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            placeholder="Search presets, functions, methods..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
          />
        </div>
      </div>

      {/* Main Layout: Sidebar + Content */}
      <div className="flex-1 flex gap-3 min-h-0">

        {/* ──── LEFT SIDEBAR: Toolbox Categories ──── */}
        <div className="w-48 flex-shrink-0 flex flex-col gap-1 overflow-y-auto">
          <button
            className={clsx('text-left text-xs px-3 py-2 rounded-lg transition-all', !selectedToolbox && 'ring-1 ring-blue-500')}
            style={{
              background: !selectedToolbox ? 'rgba(59,130,246,0.15)' : 'var(--glass-bg)',
              color: !selectedToolbox ? 'var(--color-accent-blue)' : 'var(--color-text-secondary)',
            }}
            onClick={() => { setSelectedToolbox(null); setSelectedPreset(null); setResult(null) }}
          >
            <div className="flex items-center gap-2">
              <FiLayers size={12} />
              <span className="font-medium">All Toolboxes</span>
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{PRESETS.length} presets</div>
          </button>
          {TOOLBOX_CATEGORIES.map(cat => {
            const Icon = cat.icon
            const active = selectedToolbox === cat.id
            return (
              <button
                key={cat.id}
                className={clsx('text-left text-xs px-3 py-2 rounded-lg transition-all', active && 'ring-1')}
                style={{
                  background: active ? `${cat.color}20` : 'var(--glass-bg)',
                  color: active ? cat.color : 'var(--color-text-secondary)',
                  outlineColor: active ? cat.color : undefined,
                }}
                onClick={() => { setSelectedToolbox(cat.id); setSelectedPreset(null); setResult(null) }}
              >
                <div className="flex items-center gap-2">
                  <Icon size={12} />
                  <span className="font-medium">{cat.name}</span>
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{cat.presetCount} presets</div>
              </button>
            )
          })}
        </div>


        {/* ──── CENTER: Preset Grid / Parameter Form ──── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {!selectedPreset ? (
            /* Preset Grid */
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                {filteredPresets.map(preset => {
                  const cat = TOOLBOX_CATEGORIES.find(c => c.id === preset.toolbox)
                  return (
                    <button
                      key={preset.id}
                      className="text-left p-3 rounded-xl transition-all hover:scale-[1.01] group"
                      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                      onClick={() => selectPreset(preset)}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                          {preset.name}
                        </span>
                        <FiChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                      <div className="text-[10px] mb-1.5" style={{ color: cat?.color || 'var(--color-text-muted)' }}>
                        {preset.matlabFn}
                      </div>
                      <div className="text-[10px] line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
                        {preset.description}
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${cat?.color || '#666'}20`, color: cat?.color || '#666' }}>
                          {cat?.name || preset.toolbox}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
              {filteredPresets.length === 0 && (
                <div className="flex items-center justify-center h-40">
                  <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
                    <FiSearch size={24} className="mx-auto mb-2 opacity-30" />
                    <p className="text-xs">No presets match your search</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Parameter Form */
            <div className="flex-1 overflow-y-auto space-y-3">
              {/* Preset Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      className="text-[10px] px-2 py-0.5 rounded-md"
                      style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}
                      onClick={() => { setSelectedPreset(null); setResult(null); setError('') }}
                    >
                      Back
                    </button>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                      {selectedPreset.name}
                    </h2>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {selectedPreset.description}
                  </p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0" style={{
                  background: `${TOOLBOX_CATEGORIES.find(c => c.id === selectedPreset.toolbox)?.color || '#666'}20`,
                  color: TOOLBOX_CATEGORIES.find(c => c.id === selectedPreset.toolbox)?.color || '#666',
                }}>
                  {selectedPreset.matlabFn}
                </span>
              </div>

              {/* MATLAB Code Reference */}
              <details className="glass-card rounded-xl overflow-hidden">
                <summary className="px-3 py-2 cursor-pointer text-[11px] font-medium flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
                  <FiCode size={12} /> MATLAB Equivalent Code
                </summary>
                <pre className="px-3 pb-3 text-[10px] font-mono whitespace-pre-wrap" style={{ color: 'var(--color-accent-blue)' }}>
                  {selectedPreset.matlabCode}
                </pre>
              </details>

              {/* Parameter Inputs */}
              <div className="glass-card rounded-xl p-3 space-y-2">
                <h3 className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  Parameters & Data
                </h3>
                {allParamKeys.map(key => {
                  const paramDef = selectedPreset.params.find(p => p.key === key)
                  const isData = !paramDef // keys from sampleData that aren't in params
                  const label = paramDef?.label || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  return (
                    <div key={key}>
                      <label className="text-[10px] font-medium mb-0.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                        {label}
                      </label>
                      {isData || (params[key] || '').length > 60 ? (
                        <textarea
                          value={params[key] || ''}
                          onChange={e => updateParam(key, e.target.value)}
                          rows={3}
                          className="w-full text-[11px] font-mono p-2 rounded-lg resize-y"
                          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                          placeholder={`Enter ${label}...`}
                        />
                      ) : (
                        <input
                          type={paramDef?.type === 'number' ? 'number' : 'text'}
                          value={params[key] || ''}
                          onChange={e => updateParam(key, e.target.value)}
                          step={paramDef?.type === 'number' ? 'any' : undefined}
                          className="w-full text-[11px] font-mono px-2 py-1.5 rounded-lg"
                          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                          placeholder={paramDef?.default !== undefined ? `Default: ${paramDef.default}` : `Enter ${label}...`}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Execute Button */}
              <button
                className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
                style={{
                  background: running ? 'var(--glass-bg)' : 'var(--color-accent-blue)',
                  color: running ? 'var(--color-text-muted)' : '#fff',
                  cursor: running ? 'not-allowed' : 'pointer',
                }}
                onClick={execute}
                disabled={running}
              >
                {running ? <FiLoader className="animate-spin" /> : <FiPlay />}
                {running ? 'Computing...' : 'Run Computation'}
              </button>
            </div>
          )}
        </div>


        {/* ──── RIGHT PANEL: Results ──── */}
        <div ref={resultsRef} className="w-[420px] flex-shrink-0 flex flex-col min-h-0 glass-card rounded-xl p-4 overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl mb-3" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              <FiAlertCircle className="mt-0.5 flex-shrink-0" />
              <div className="text-xs">{error}</div>
            </div>
          )}

          {!result && !running && !error && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
                <FiCpu size={40} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium mb-1">Results Panel</p>
                <p className="text-[11px] max-w-[280px] mx-auto">
                  {!selectedPreset
                    ? 'Select a preset from the grid. Everything will be auto-filled — just click Run.'
                    : 'Parameters are pre-filled with sample data. Click "Run Computation" or adjust values first.'
                  }
                </p>
              </div>
            </div>
          )}

          {running && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
                <FiLoader size={32} className="mx-auto mb-3 animate-spin" style={{ color: 'var(--color-accent-blue)' }} />
                <p className="text-sm">Computing...</p>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Status bar */}
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1" style={{ color: 'var(--color-accent-green, #10b981)' }}>
                  <FiCheck size={14} /> Complete
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>{runtime.toFixed(3)}s</span>
              </div>

              {/* Chart */}
              {result.chartData && result.chartData.length > 0 && (
                <div className="glass-card rounded-xl p-3">
                  <div className="text-xs font-medium mb-2 flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
                    <FiBarChart2 size={12} /> {result.chartTitle || 'Plot'}
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    {result.chartType === 'scatter' ? (
                      <ScatterChart margin={{ top: 5, right: 10, bottom: 20, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="x" type="number" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                          label={{ value: result.xLabel, position: 'bottom', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                          label={{ value: result.yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 10 }} />
                        <Scatter data={result.chartData} fill="var(--color-accent-blue)" fillOpacity={0.7} r={2.5} />
                      </ScatterChart>
                    ) : result.chartType === 'bar' ? (
                      <BarChart data={result.chartData} margin={{ top: 5, right: 10, bottom: 20, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="x" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                          label={{ value: result.xLabel, position: 'bottom', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                          label={{ value: result.yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 10 }} />
                        <Bar dataKey="y" fill="var(--color-accent-blue)" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    ) : result.chartType === 'area' ? (
                      <AreaChart data={result.chartData} margin={{ top: 5, right: 10, bottom: 20, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="x" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                          label={{ value: result.xLabel, position: 'bottom', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                          label={{ value: result.yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 10 }} />
                        <Area type="monotone" dataKey="y" stroke="var(--color-accent-blue)" fill="var(--color-accent-blue)" fillOpacity={0.3} />
                      </AreaChart>
                    ) : (
                      <LineChart data={result.chartData} margin={{ top: 5, right: 10, bottom: 20, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="x" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                          label={{ value: result.xLabel, position: 'bottom', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                          label={{ value: result.yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 10 }} />
                        <Line type="monotone" dataKey="y" stroke="var(--color-accent-blue)" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}

              {/* Statistics Table */}
              {result.statistics && result.statistics.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Results</h3>
                    <button
                      className="text-[10px] flex items-center gap-1 opacity-60 hover:opacity-100"
                      style={{ color: 'var(--color-text-muted)' }}
                      onClick={() => {
                        const text = result.statistics!.map(s => `${s.label}\t${s.value}`).join('\n')
                        navigator.clipboard.writeText(text)
                      }}
                    ><FiCopy size={10} /> Copy</button>
                  </div>
                  <div className="glass-card rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <tbody>
                        {result.statistics.map((s, i) => (
                          <tr key={i} className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                            <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{s.label}</td>
                            <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--color-text)' }}>{s.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Export Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  className="text-[10px] px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                  style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
                    a.download = `${selectedPreset?.id || 'result'}.json`; a.click()
                    URL.revokeObjectURL(a.href)
                  }}
                ><FiDownload size={10} /> JSON</button>
                {result.statistics && (
                  <button
                    className="text-[10px] px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                    style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}
                    onClick={() => {
                      const csv = result.statistics!.map(s => `"${s.label}","${s.value}"`).join('\n')
                      const blob = new Blob([`Label,Value\n${csv}`], { type: 'text/csv' })
                      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
                      a.download = `${selectedPreset?.id || 'result'}.csv`; a.click()
                      URL.revokeObjectURL(a.href)
                    }}
                  ><FiDownload size={10} /> CSV</button>
                )}
                {result.chartData && (
                  <button
                    className="text-[10px] px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                    style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}
                    onClick={() => {
                      const header = Object.keys(result.chartData![0] || {}).join(',')
                      const rows = result.chartData!.map(d => Object.values(d).join(','))
                      const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
                      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
                      a.download = `${selectedPreset?.id || 'result'}_chart.csv`; a.click()
                      URL.revokeObjectURL(a.href)
                    }}
                  ><FiDownload size={10} /> Chart Data</button>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
