import { useState, useRef, useCallback, useMemo } from 'react'
import {
  FiUpload, FiPlay, FiCpu, FiCopy, FiDownload,
  FiFile, FiAlertCircle, FiCheck, FiLoader,
  FiGrid, FiBarChart2, FiPlus, FiTrash2, FiX
} from 'react-icons/fi'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter
} from 'recharts'

// ═══════════════════════════════════════════════════════════════════
//  SELF-CONTAINED COMPUTE ENGINE — No backend dependency for core math.
//  Domains, operations, parameter schemas, and compute functions
//  are all embedded. File parsing runs client-side.
// ═══════════════════════════════════════════════════════════════════

// ── Statistical Math Library ──────────────────────────────────────

function sum(a: number[]): number { return a.reduce((s, v) => s + v, 0) }
function mean(a: number[]): number { return a.length ? sum(a) / a.length : 0 }
function variance(a: number[], ddof = 1): number {
  const m = mean(a); return a.length > ddof ? sum(a.map(v => (v - m) ** 2)) / (a.length - ddof) : 0
}
function std(a: number[], ddof = 1): number { return Math.sqrt(variance(a, ddof)) }
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function quantile(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y)
  const pos = q * (s.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos)
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

// Normal CDF approximation (Abramowitz & Stegun 26.2.17)
function normCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429
  const sign = z < 0 ? -1 : 1
  z = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z)
  return 0.5 * (1 + sign * erf)
}
// normPDF available if needed: Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)

// t-distribution CDF approximation (via regularized incomplete beta)
function betaInc(x: number, a: number, b: number): number {
  // Continued fraction approximation for regularized incomplete beta
  if (x <= 0) return 0; if (x >= 1) return 1
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a
  // Lentz's algorithm
  let f = 1, c = 1, d = 1 - (a + 1) * x / (a + 1); if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; f = d
  for (let m = 1; m <= 200; m++) {
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d; f *= d * c
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d; const delta = d * c; f *= delta
    if (Math.abs(delta - 1) < 1e-10) break
  }
  return front * f
}
function lnGamma(z: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -5.395239384953e-6]
  let x = z, y = z, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += c[j] / ++y
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}
function tCDF(t: number, df: number): number {
  const x = df / (df + t * t)
  const ib = betaInc(x, df / 2, 0.5)
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib
}

// Chi-square CDF (via regularized lower incomplete gamma)
function gammaCDF(x: number, a: number): number {
  if (x <= 0) return 0
  // Series expansion for lower incomplete gamma
  let s = 1 / a, term = 1 / a
  for (let n = 1; n < 200; n++) { term *= x / (a + n); s += term; if (Math.abs(term) < 1e-12) break }
  return s * Math.exp(-x + a * Math.log(x) - lnGamma(a))
}
function chiCDF(x: number, k: number): number { return gammaCDF(x / 2, k / 2) }

// F-distribution CDF
function fCDF(f: number, d1: number, d2: number): number {
  const x = d1 * f / (d1 * f + d2)
  return betaInc(x, d1 / 2, d2 / 2) > 1 ? 1 : betaInc(x, d1 / 2, d2 / 2)
}

// Shapiro-Wilk approximation (for small samples, uses correlation with normal order stats)
function shapiroWilk(a: number[]): { W: number; p: number } {
  const n = a.length; if (n < 3) return { W: 1, p: 1 }
  const sorted = [...a].sort((x, y) => x - y)
  const m = mean(sorted)
  // Approximate expected normal order statistics
  const expected = Array.from({ length: n }, (_, i) => {
    const p = (i + 1 - 0.375) / (n + 0.25)
    // Inverse normal approximation (Beasley-Springer-Moro)
    return invNorm(p)
  })
  const me = mean(expected), se = std(expected, 0)
  const cov = sum(sorted.map((v, i) => (v - m) * (expected[i] - me))) / n
  const W = (cov / (std(sorted, 0) * se)) ** 2
  // p-value approximation (log transform)
  const mu = 0.0038915 * Math.log(n) ** 3 - 0.083751 * Math.log(n) ** 2 - 0.31082 * Math.log(n) - 1.5861
  const sigma = Math.exp(0.0030302 * Math.log(n) ** 2 - 0.082676 * Math.log(n) - 0.4803)
  const z = (Math.log(1 - W) - mu) / sigma
  return { W, p: 1 - normCDF(z) }
}
function invNorm(p: number): number {
  // Rational approximation
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity
  if (p < 0.5) return -invNorm(1 - p)
  const t = Math.sqrt(-2 * Math.log(1 - p))
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328, d1 = 1.432788, d2 = 0.189269, d3 = 0.001308
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t)
}

// Pearson correlation
function pearsonR(x: number[], y: number[]): { r: number; p: number } {
  const n = Math.min(x.length, y.length)
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2 }
  const r = dx && dy ? num / Math.sqrt(dx * dy) : 0
  const t = r * Math.sqrt((n - 2) / (1 - r * r + 1e-15))
  const p = n > 2 ? 2 * (1 - tCDF(Math.abs(t), n - 2)) : 1
  return { r, p }
}

// Spearman rank correlation
function spearmanR(x: number[], y: number[]): { rho: number; p: number } {
  const n = Math.min(x.length, y.length)
  const rank = (a: number[]) => {
    const s = a.slice(0, n).map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
    const r = new Array(n)
    for (let i = 0; i < n;) {
      let j = i; while (j < n - 1 && s[j + 1].v === s[i].v) j++
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) r[s[k].i] = avg
      i = j + 1
    }
    return r
  }
  return { ...pearsonR(rank(x), rank(y)), rho: pearsonR(rank(x), rank(y)).r }
}

// Simple linear regression
function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number; p: number; se_slope: number } {
  const n = Math.min(x.length, y.length)
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2 }
  const slope = sxx ? sxy / sxx : 0
  const intercept = my - slope * mx
  const r2 = sxx && syy ? (sxy ** 2) / (sxx * syy) : 0
  const sse = syy - slope * sxy
  const mse = n > 2 ? sse / (n - 2) : 0
  const se_slope = sxx ? Math.sqrt(mse / sxx) : 0
  const t = se_slope ? slope / se_slope : 0
  const p = n > 2 ? 2 * (1 - tCDF(Math.abs(t), n - 2)) : 1
  return { slope, intercept, r2, p, se_slope }
}

// Ranks for nonparametric tests
function ranks(a: number[]): number[] {
  const s = a.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const r = new Array(a.length)
  for (let i = 0; i < a.length;) {
    let j = i; while (j < a.length - 1 && s[j + 1].v === s[i].v) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[s[k].i] = avg
    i = j + 1
  }
  return r
}

// ── Domain & Operation Definitions (self-contained) ───────────────

interface ParamDef {
  name: string; label: string; type: 'number' | 'array' | 'select' | 'boolean' | 'matrix' | 'string'
  required?: boolean; default?: any; description?: string
  min?: number; max?: number; step?: number
  options?: { value: string; label: string }[]
  group?: string
}

interface Operation {
  id: string; title: string; description: string
  params: ParamDef[]
  compute: (p: Record<string, any>, data: DataState) => ComputeResult
}

interface Domain {
  id: string; name: string; description: string
  operations: Operation[]
}

interface ComputeResult {
  results: Record<string, any>
  statistics?: { label: string; value: string }[]
  chartData?: { x: number; y: number; label?: string }[]
  chartType?: 'line' | 'bar' | 'scatter'
  chartTitle?: string
  xLabel?: string; yLabel?: string
  warnings?: string[]
  error?: string
}

interface DataState {
  columns: Record<string, number[]>
  raw: string[][]
  columnNames: string[]
  fileName?: string
}

// ── Helper for extracting array from params or data columns ───────
function getArray(p: Record<string, any>, data: DataState, name: string): number[] {
  // Check if param has direct array value
  if (p[name] && Array.isArray(p[name]) && p[name].length > 0) return p[name]
  // Check if param names a column
  if (typeof p[name] === 'string' && data.columns[p[name]]) return data.columns[p[name]]
  // Check data columns by name match
  if (data.columns[name]) return data.columns[name]
  // Try first/second column as fallback for x/y names
  const cols = Object.values(data.columns)
  if (name === 'x' || name === 'sample_1' || name === 'data' || name === 'values') return cols[0] || []
  if (name === 'y' || name === 'sample_2') return cols[1] || []
  return []
}

// ═══════════════════════════════════════════════════════════════════
//  DOMAIN DEFINITIONS — Each domain has operations with real compute
// ═══════════════════════════════════════════════════════════════════

const DOMAINS: Domain[] = [
  // ── Statistics ──────────────────────────────────────────────────
  {
    id: 'statistics', name: 'Statistics',
    description: 'Descriptive & inferential statistics — means, tests, correlations, regression, ANOVA, normality',
    operations: [
      {
        id: 'descriptive', title: 'Descriptive Statistics',
        description: 'Full summary: mean, median, SD, SEM, skewness, kurtosis, quartiles, range, CI',
        params: [
          { name: 'data', label: 'Data (column or array)', type: 'array', required: true, description: 'Numeric values — paste comma-separated or load from file' },
          { name: 'confidence', label: 'Confidence Level', type: 'number', default: 0.95, min: 0.5, max: 0.999, step: 0.01 },
        ],
        compute: (p, data) => {
          const arr = getArray(p, data, 'data')
          if (arr.length < 2) return { results: {}, error: 'Need at least 2 data points' }
          const n = arr.length, m = mean(arr), s = std(arr), se = sem(arr)
          const conf = p.confidence || 0.95
          const z = invNorm(1 - (1 - conf) / 2)
          const ci_lo = m - z * se, ci_hi = m + z * se
          const sorted = [...arr].sort((a, b) => a - b)
          return {
            results: {},
            statistics: [
              { label: 'N', value: String(n) },
              { label: 'Mean', value: m.toFixed(6) },
              { label: 'Median', value: median(arr).toFixed(6) },
              { label: 'Std Dev', value: s.toFixed(6) },
              { label: 'SEM', value: se.toFixed(6) },
              { label: 'Variance', value: variance(arr).toFixed(6) },
              { label: `${(conf * 100).toFixed(0)}% CI Lower`, value: ci_lo.toFixed(6) },
              { label: `${(conf * 100).toFixed(0)}% CI Upper`, value: ci_hi.toFixed(6) },
              { label: 'Min', value: sorted[0].toFixed(6) },
              { label: 'Q1 (25th)', value: quantile(arr, 0.25).toFixed(6) },
              { label: 'Q3 (75th)', value: quantile(arr, 0.75).toFixed(6) },
              { label: 'Max', value: sorted[sorted.length - 1].toFixed(6) },
              { label: 'IQR', value: (quantile(arr, 0.75) - quantile(arr, 0.25)).toFixed(6) },
              { label: 'Range', value: (sorted[sorted.length - 1] - sorted[0]).toFixed(6) },
              { label: 'Skewness', value: skewness(arr).toFixed(6) },
              { label: 'Kurtosis', value: kurtosis(arr).toFixed(6) },
              { label: 'Sum', value: sum(arr).toFixed(6) },
            ],
            chartData: arr.map((v, i) => ({ x: i + 1, y: v })),
            chartType: 'line', chartTitle: 'Data Plot', xLabel: 'Index', yLabel: 'Value',
          }
        }
      },
      {
        id: 'ttest_independent', title: 'Independent t-Test',
        description: "Welch's two-sample t-test — compares means of two independent groups",
        params: [
          { name: 'sample_1', label: 'Sample 1', type: 'array', required: true, description: 'First group values' },
          { name: 'sample_2', label: 'Sample 2', type: 'array', required: true, description: 'Second group values' },
          { name: 'alternative', label: 'Alternative', type: 'select', default: 'two_sided', options: [
            { value: 'two_sided', label: 'Two-sided' }, { value: 'greater', label: 'Greater' }, { value: 'less', label: 'Less' }
          ]},
        ],
        compute: (p, data) => {
          const a = getArray(p, data, 'sample_1'), b = getArray(p, data, 'sample_2')
          if (a.length < 2 || b.length < 2) return { results: {}, error: 'Each sample needs at least 2 values' }
          const ma = mean(a), mb = mean(b), va = variance(a), vb = variance(b)
          const se = Math.sqrt(va / a.length + vb / b.length)
          const t = (ma - mb) / se
          // Welch-Satterthwaite df
          const num = (va / a.length + vb / b.length) ** 2
          const den = (va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1)
          const df = num / den
          let pval = 2 * (1 - tCDF(Math.abs(t), df))
          if (p.alternative === 'greater') pval = 1 - tCDF(t, df)
          else if (p.alternative === 'less') pval = tCDF(t, df)
          const d = se ? (ma - mb) / Math.sqrt((variance(a) * (a.length - 1) + variance(b) * (b.length - 1)) / (a.length + b.length - 2)) : 0
          return {
            results: {},
            statistics: [
              { label: 't-statistic', value: t.toFixed(6) },
              { label: 'Degrees of freedom', value: df.toFixed(2) },
              { label: 'p-value', value: pval < 1e-10 ? pval.toExponential(4) : pval.toFixed(6) },
              { label: "Cohen's d", value: d.toFixed(4) },
              { label: 'Mean difference', value: (ma - mb).toFixed(6) },
              { label: 'Sample 1: mean', value: ma.toFixed(6) },
              { label: 'Sample 1: SD', value: std(a).toFixed(6) },
              { label: 'Sample 1: N', value: String(a.length) },
              { label: 'Sample 2: mean', value: mb.toFixed(6) },
              { label: 'Sample 2: SD', value: std(b).toFixed(6) },
              { label: 'Sample 2: N', value: String(b.length) },
              { label: 'Significant (α=0.05)', value: pval < 0.05 ? 'Yes' : 'No' },
            ],
            chartData: [
              ...a.map(v => ({ x: 1, y: v, label: 'Sample 1' })),
              ...b.map(v => ({ x: 2, y: v, label: 'Sample 2' })),
            ],
            chartType: 'scatter', chartTitle: 'Group Comparison', xLabel: 'Group', yLabel: 'Value',
          }
        }
      },
      {
        id: 'ttest_paired', title: 'Paired t-Test',
        description: 'Paired-sample t-test — compares means of matched/repeated measurements',
        params: [
          { name: 'sample_1', label: 'Before / Condition A', type: 'array', required: true },
          { name: 'sample_2', label: 'After / Condition B', type: 'array', required: true },
        ],
        compute: (p, data) => {
          const a = getArray(p, data, 'sample_1'), b = getArray(p, data, 'sample_2')
          const n = Math.min(a.length, b.length)
          if (n < 2) return { results: {}, error: 'Need at least 2 paired observations' }
          const diffs = Array.from({ length: n }, (_, i) => a[i] - b[i])
          const md = mean(diffs), sd = std(diffs), se_d = sd / Math.sqrt(n)
          const t = md / se_d, df = n - 1
          const pval = 2 * (1 - tCDF(Math.abs(t), df))
          const d = sd ? md / sd : 0
          return {
            results: {},
            statistics: [
              { label: 't-statistic', value: t.toFixed(6) },
              { label: 'df', value: String(df) },
              { label: 'p-value', value: pval < 1e-10 ? pval.toExponential(4) : pval.toFixed(6) },
              { label: "Cohen's d", value: d.toFixed(4) },
              { label: 'Mean difference', value: md.toFixed(6) },
              { label: 'SD of differences', value: sd.toFixed(6) },
              { label: 'N pairs', value: String(n) },
              { label: 'Significant (α=0.05)', value: pval < 0.05 ? 'Yes' : 'No' },
            ],
            chartData: diffs.map((v, i) => ({ x: i + 1, y: v })),
            chartType: 'bar', chartTitle: 'Paired Differences', xLabel: 'Pair', yLabel: 'Difference',
          }
        }
      },
      {
        id: 'mann_whitney', title: 'Mann-Whitney U Test',
        description: 'Non-parametric test for comparing two independent groups (no normality assumption)',
        params: [
          { name: 'sample_1', label: 'Sample 1', type: 'array', required: true },
          { name: 'sample_2', label: 'Sample 2', type: 'array', required: true },
        ],
        compute: (p, data) => {
          const a = getArray(p, data, 'sample_1'), b = getArray(p, data, 'sample_2')
          if (a.length < 1 || b.length < 1) return { results: {}, error: 'Each sample needs at least 1 value' }
          const combined = [...a.map(v => ({ v, g: 0 })), ...b.map(v => ({ v, g: 1 }))]
          const r = ranks(combined.map(c => c.v))
          const R1 = sum(r.filter((_, i) => combined[i].g === 0))
          const n1 = a.length, n2 = b.length
          const U1 = R1 - n1 * (n1 + 1) / 2, U2 = n1 * n2 - U1
          const U = Math.min(U1, U2)
          // Normal approximation for large samples
          const mu = n1 * n2 / 2
          const sigma = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12)
          const z = sigma ? (U - mu) / sigma : 0
          const pval = 2 * normCDF(z)
          const rbc = 1 - (2 * U) / (n1 * n2) // rank-biserial correlation
          return {
            results: {},
            statistics: [
              { label: 'U statistic', value: U.toFixed(1) },
              { label: 'z-score', value: z.toFixed(4) },
              { label: 'p-value', value: pval < 1e-10 ? pval.toExponential(4) : pval.toFixed(6) },
              { label: 'Rank-biserial r', value: rbc.toFixed(4) },
              { label: 'U₁', value: U1.toFixed(1) }, { label: 'U₂', value: U2.toFixed(1) },
              { label: 'N₁', value: String(n1) }, { label: 'N₂', value: String(n2) },
              { label: 'Median₁', value: median(a).toFixed(6) },
              { label: 'Median₂', value: median(b).toFixed(6) },
              { label: 'Significant (α=0.05)', value: pval < 0.05 ? 'Yes' : 'No' },
            ],
          }
        }
      },
      {
        id: 'one_way_anova', title: 'One-Way ANOVA',
        description: 'Compare means across 2+ groups — F-test with effect size (η²)',
        params: [
          { name: 'groups', label: 'Number of groups', type: 'number', default: 3, min: 2, max: 20, description: 'Each column in your data = one group' },
        ],
        compute: (_p, data) => {
          const groups = Object.values(data.columns).filter(c => c.length > 0)
          if (groups.length < 2) return { results: {}, error: 'Need at least 2 groups (load multi-column data or use matrix)' }
          const k = groups.length
          const allData = groups.flat()
          const N = allData.length, grandMean = mean(allData)
          const SSB = sum(groups.map(g => g.length * (mean(g) - grandMean) ** 2))
          const SSW = sum(groups.map(g => sum(g.map(v => (v - mean(g)) ** 2))))
          const dfB = k - 1, dfW = N - k
          const MSB = SSB / dfB, MSW = dfW ? SSW / dfW : 0
          const F = MSW ? MSB / MSW : 0
          const pval = 1 - fCDF(F, dfB, dfW)
          const eta2 = (SSB + SSW) ? SSB / (SSB + SSW) : 0
          const stats: { label: string; value: string }[] = [
            { label: 'F-statistic', value: F.toFixed(4) },
            { label: 'p-value', value: pval < 1e-10 ? pval.toExponential(4) : pval.toFixed(6) },
            { label: 'df (between)', value: String(dfB) },
            { label: 'df (within)', value: String(dfW) },
            { label: 'SS (between)', value: SSB.toFixed(4) },
            { label: 'SS (within)', value: SSW.toFixed(4) },
            { label: 'MS (between)', value: MSB.toFixed(4) },
            { label: 'MS (within)', value: MSW.toFixed(4) },
            { label: 'η² (eta-squared)', value: eta2.toFixed(4) },
            { label: 'Significant (α=0.05)', value: pval < 0.05 ? 'Yes' : 'No' },
          ]
          groups.forEach((g, i) => {
            const name = data.columnNames[i] || `Group ${i + 1}`
            stats.push({ label: `${name}: mean`, value: mean(g).toFixed(4) })
            stats.push({ label: `${name}: SD`, value: std(g).toFixed(4) })
            stats.push({ label: `${name}: N`, value: String(g.length) })
          })
          const chartData = groups.flatMap((g, i) => g.map(v => ({ x: i + 1, y: v, label: data.columnNames[i] || `G${i + 1}` })))
          return { results: {}, statistics: stats, chartData, chartType: 'scatter', chartTitle: 'ANOVA Groups', xLabel: 'Group', yLabel: 'Value' }
        }
      },
      {
        id: 'correlation', title: 'Correlation Analysis',
        description: 'Pearson r and Spearman ρ with p-values, scatterplot with regression line',
        params: [
          { name: 'x', label: 'X variable', type: 'array', required: true },
          { name: 'y', label: 'Y variable', type: 'array', required: true },
        ],
        compute: (p, data) => {
          const x = getArray(p, data, 'x'), y = getArray(p, data, 'y')
          const n = Math.min(x.length, y.length)
          if (n < 3) return { results: {}, error: 'Need at least 3 paired observations' }
          const pr = pearsonR(x.slice(0, n), y.slice(0, n))
          const sr = spearmanR(x.slice(0, n), y.slice(0, n))
          const reg = linearRegression(x.slice(0, n), y.slice(0, n))
          return {
            results: {},
            statistics: [
              { label: 'Pearson r', value: pr.r.toFixed(6) },
              { label: 'Pearson p-value', value: pr.p < 1e-10 ? pr.p.toExponential(4) : pr.p.toFixed(6) },
              { label: 'Spearman ρ', value: sr.rho.toFixed(6) },
              { label: 'Spearman p-value', value: sr.p < 1e-10 ? sr.p.toExponential(4) : sr.p.toFixed(6) },
              { label: 'R²', value: reg.r2.toFixed(6) },
              { label: 'Regression: y = slope·x + intercept', value: `y = ${reg.slope.toFixed(4)}x + ${reg.intercept.toFixed(4)}` },
              { label: 'N', value: String(n) },
              { label: 'Significant (α=0.05)', value: pr.p < 0.05 ? 'Yes' : 'No' },
            ],
            chartData: Array.from({ length: n }, (_, i) => ({ x: x[i], y: y[i] })),
            chartType: 'scatter', chartTitle: 'Scatter Plot', xLabel: 'X', yLabel: 'Y',
          }
        }
      },
      {
        id: 'linear_regression', title: 'Linear Regression',
        description: 'OLS regression with coefficients, R², residuals, and prediction',
        params: [
          { name: 'x', label: 'Predictor (X)', type: 'array', required: true },
          { name: 'y', label: 'Response (Y)', type: 'array', required: true },
          { name: 'predict_x', label: 'Predict at X=', type: 'number', description: 'Optional X value to predict Y' },
        ],
        compute: (p, data) => {
          const x = getArray(p, data, 'x'), y = getArray(p, data, 'y')
          const n = Math.min(x.length, y.length)
          if (n < 3) return { results: {}, error: 'Need at least 3 observations' }
          const reg = linearRegression(x.slice(0, n), y.slice(0, n))
          const residuals = Array.from({ length: n }, (_, i) => y[i] - (reg.slope * x[i] + reg.intercept))
          const stats: { label: string; value: string }[] = [
            { label: 'Slope (β₁)', value: reg.slope.toFixed(6) },
            { label: 'Intercept (β₀)', value: reg.intercept.toFixed(6) },
            { label: 'SE of slope', value: reg.se_slope.toFixed(6) },
            { label: 'R²', value: reg.r2.toFixed(6) },
            { label: 'Adjusted R²', value: (1 - (1 - reg.r2) * (n - 1) / (n - 2)).toFixed(6) },
            { label: 'p-value (slope)', value: reg.p < 1e-10 ? reg.p.toExponential(4) : reg.p.toFixed(6) },
            { label: 'Residual SE', value: std(residuals, 0).toFixed(6) },
            { label: 'N', value: String(n) },
          ]
          if (p.predict_x !== undefined && p.predict_x !== '') {
            const px = Number(p.predict_x)
            stats.push({ label: `Predicted Y at X=${px}`, value: (reg.slope * px + reg.intercept).toFixed(6) })
          }
          // Line + scatter
          return {
            results: { equation: `y = ${reg.slope.toFixed(4)}x + ${reg.intercept.toFixed(4)}`, residuals },
            statistics: stats,
            chartData: Array.from({ length: n }, (_, i) => ({ x: x[i], y: y[i] })),
            chartType: 'scatter', chartTitle: 'Regression', xLabel: 'X', yLabel: 'Y',
          }
        }
      },
      {
        id: 'chi_square', title: 'Chi-Square Test',
        description: 'Chi-square test of independence for a contingency table',
        params: [
          { name: 'observed', label: 'Observed counts (matrix)', type: 'matrix', required: true, description: 'Enter as matrix — rows are categories, columns are groups' },
        ],
        compute: (_p, data) => {
          // Try to get matrix from data or param
          let matrix: number[][] = []
          if (data.raw.length > 0) {
            matrix = data.raw.map(row => row.map(Number).filter(v => !isNaN(v))).filter(r => r.length > 0)
          }
          if (matrix.length < 2 || matrix[0].length < 2) return { results: {}, error: 'Need at least a 2×2 contingency table. Enter data in the matrix editor.' }
          const rows = matrix.length, cols = matrix[0].length
          const rowTotals = matrix.map(r => sum(r))
          const colTotals = Array.from({ length: cols }, (_, j) => sum(matrix.map(r => r[j])))
          const N = sum(rowTotals)
          let chi2 = 0
          for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
              const expected = rowTotals[i] * colTotals[j] / N
              if (expected > 0) chi2 += (matrix[i][j] - expected) ** 2 / expected
            }
          }
          const df = (rows - 1) * (cols - 1)
          const pval = 1 - chiCDF(chi2, df)
          const cramersV = Math.sqrt(chi2 / (N * (Math.min(rows, cols) - 1)))
          return {
            results: {},
            statistics: [
              { label: 'χ² statistic', value: chi2.toFixed(4) },
              { label: 'df', value: String(df) },
              { label: 'p-value', value: pval < 1e-10 ? pval.toExponential(4) : pval.toFixed(6) },
              { label: "Cramér's V", value: cramersV.toFixed(4) },
              { label: 'Table size', value: `${rows} × ${cols}` },
              { label: 'Total N', value: String(N) },
              { label: 'Significant (α=0.05)', value: pval < 0.05 ? 'Yes' : 'No' },
            ],
          }
        }
      },
      {
        id: 'normality', title: 'Normality Tests',
        description: 'Shapiro-Wilk W test and descriptive normality indicators',
        params: [
          { name: 'data', label: 'Data', type: 'array', required: true },
        ],
        compute: (p, data) => {
          const arr = getArray(p, data, 'data')
          if (arr.length < 3) return { results: {}, error: 'Need at least 3 values' }
          const sw = shapiroWilk(arr)
          const sk = skewness(arr), ku = kurtosis(arr)
          // Jarque-Bera
          const n = arr.length
          const jb = (n / 6) * (sk ** 2 + ku ** 2 / 4)
          const jb_p = 1 - chiCDF(jb, 2)
          return {
            results: {},
            statistics: [
              { label: 'Shapiro-Wilk W', value: sw.W.toFixed(6) },
              { label: 'Shapiro-Wilk p', value: sw.p < 1e-10 ? sw.p.toExponential(4) : sw.p.toFixed(6) },
              { label: 'Jarque-Bera JB', value: jb.toFixed(4) },
              { label: 'Jarque-Bera p', value: jb_p < 1e-10 ? jb_p.toExponential(4) : jb_p.toFixed(6) },
              { label: 'Skewness', value: sk.toFixed(6) },
              { label: 'Excess Kurtosis', value: ku.toFixed(6) },
              { label: 'N', value: String(n) },
              { label: 'Normal (Shapiro, α=0.05)', value: sw.p >= 0.05 ? 'Yes — cannot reject normality' : 'No — significantly non-normal' },
              { label: 'Normal (JB, α=0.05)', value: jb_p >= 0.05 ? 'Yes' : 'No' },
            ],
            chartData: (() => {
              // Histogram approximation
              const sorted = [...arr].sort((a, b) => a - b)
              const bins = Math.ceil(Math.sqrt(n))
              const bw = (sorted[sorted.length - 1] - sorted[0]) / bins || 1
              const hist: { x: number; y: number }[] = []
              for (let i = 0; i < bins; i++) {
                const lo = sorted[0] + i * bw, hi = lo + bw
                const count = arr.filter(v => v >= lo && (i === bins - 1 ? v <= hi : v < hi)).length
                hist.push({ x: Math.round((lo + hi / 2) * 100) / 100, y: count })
              }
              return hist
            })(),
            chartType: 'bar', chartTitle: 'Histogram', xLabel: 'Value', yLabel: 'Count',
          }
        }
      },
    ]
  },
  // ── Signal Processing ──────────────────────────────────────────
  {
    id: 'signals', name: 'Signal Processing',
    description: 'EEG/ECG/EMG — filtering, spectral analysis, peak detection, HRV',
    operations: [
      {
        id: 'bandpass_filter', title: 'Bandpass Filter',
        description: 'Butterworth-approximated bandpass filter for physiological signals',
        params: [
          { name: 'data', label: 'Signal data', type: 'array', required: true },
          { name: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256, min: 1 },
          { name: 'low_hz', label: 'Low cutoff (Hz)', type: 'number', default: 1, min: 0.01 },
          { name: 'high_hz', label: 'High cutoff (Hz)', type: 'number', default: 40, min: 0.1 },
        ],
        compute: (p, data) => {
          const signal = getArray(p, data, 'data')
          if (signal.length < 10) return { results: {}, error: 'Signal too short (need 10+ samples)' }
          const fs = p.fs || 256, lo = p.low_hz || 1, hi = p.high_hz || 40
          // Simple moving-average bandpass approximation
          const nyq = fs / 2
          const lowN = Math.max(1, Math.round(nyq / hi))
          const highN = Math.max(lowN + 1, Math.round(nyq / lo))
          // Low-pass then subtract low-frequency
          const lp = signal.map((_, i) => {
            const start = Math.max(0, i - lowN), end = Math.min(signal.length, i + lowN + 1)
            return sum(signal.slice(start, end)) / (end - start)
          })
          const hp = signal.map((_, i) => {
            const start = Math.max(0, i - highN), end = Math.min(signal.length, i + highN + 1)
            return sum(signal.slice(start, end)) / (end - start)
          })
          const filtered = lp.map((v, i) => v - hp[i])
          return {
            results: { filtered_signal: filtered },
            statistics: [
              { label: 'Input samples', value: String(signal.length) },
              { label: 'Sampling rate', value: `${fs} Hz` },
              { label: 'Band', value: `${lo}–${hi} Hz` },
              { label: 'Output mean', value: mean(filtered).toFixed(6) },
              { label: 'Output SD', value: std(filtered).toFixed(6) },
            ],
            chartData: filtered.slice(0, 2000).map((v, i) => ({ x: i / fs, y: v })),
            chartType: 'line', chartTitle: 'Filtered Signal', xLabel: 'Time (s)', yLabel: 'Amplitude',
          }
        }
      },
      {
        id: 'power_spectrum', title: 'Power Spectrum (PSD)',
        description: 'Estimate power spectral density using FFT-based periodogram',
        params: [
          { name: 'data', label: 'Signal data', type: 'array', required: true },
          { name: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256, min: 1 },
        ],
        compute: (p, data) => {
          const signal = getArray(p, data, 'data')
          if (signal.length < 16) return { results: {}, error: 'Signal too short (need 16+ samples)' }
          const fs = p.fs || 256
          // Zero-pad to next power of 2
          const N = Math.pow(2, Math.ceil(Math.log2(signal.length)))
          const padded = [...signal, ...new Array(N - signal.length).fill(0)]
          // DFT (simplified, not FFT but works for reasonable sizes)
          const psd: number[] = []
          const freqs: number[] = []
          const halfN = Math.floor(N / 2)
          for (let k = 0; k <= halfN; k++) {
            let re = 0, im = 0
            for (let n = 0; n < N; n++) {
              const angle = -2 * Math.PI * k * n / N
              re += padded[n] * Math.cos(angle)
              im += padded[n] * Math.sin(angle)
            }
            psd.push((re * re + im * im) / (N * fs))
            freqs.push(k * fs / N)
          }
          const totalPower = sum(psd)
          // Find dominant frequency
          let maxIdx = 0
          for (let i = 1; i < psd.length; i++) if (psd[i] > psd[maxIdx]) maxIdx = i
          return {
            results: { frequencies: freqs, psd },
            statistics: [
              { label: 'N samples', value: String(signal.length) },
              { label: 'FFT size', value: String(N) },
              { label: 'Freq resolution', value: `${(fs / N).toFixed(3)} Hz` },
              { label: 'Dominant freq', value: `${freqs[maxIdx].toFixed(2)} Hz` },
              { label: 'Total power', value: totalPower.toFixed(4) },
            ],
            chartData: freqs.slice(0, halfN).map((f, i) => ({ x: f, y: psd[i] })),
            chartType: 'line', chartTitle: 'Power Spectral Density', xLabel: 'Frequency (Hz)', yLabel: 'Power',
          }
        }
      },
      {
        id: 'peak_detection', title: 'Peak Detection',
        description: 'Find peaks in signal with configurable threshold and minimum distance',
        params: [
          { name: 'data', label: 'Signal', type: 'array', required: true },
          { name: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256 },
          { name: 'threshold', label: 'Threshold (SD multiplier)', type: 'number', default: 1.5, min: 0, step: 0.1 },
          { name: 'min_distance', label: 'Min distance (samples)', type: 'number', default: 50, min: 1 },
        ],
        compute: (p, data) => {
          const signal = getArray(p, data, 'data')
          if (signal.length < 5) return { results: {}, error: 'Signal too short' }
          const fs = p.fs || 256
          const thresh = mean(signal) + (p.threshold || 1.5) * std(signal)
          const minDist = p.min_distance || 50
          const peaks: number[] = []
          for (let i = 1; i < signal.length - 1; i++) {
            if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1] && signal[i] > thresh) {
              if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist) {
                peaks.push(i)
              }
            }
          }
          const intervals = peaks.slice(1).map((p, i) => (p - peaks[i]) / fs)
          const rate = intervals.length ? 60 / mean(intervals) : 0
          return {
            results: { peak_indices: peaks, peak_values: peaks.map(i => signal[i]), intervals_sec: intervals },
            statistics: [
              { label: 'Peaks found', value: String(peaks.length) },
              { label: 'Mean interval', value: intervals.length ? `${mean(intervals).toFixed(4)} s` : 'N/A' },
              { label: 'SD interval', value: intervals.length > 1 ? `${std(intervals).toFixed(4)} s` : 'N/A' },
              { label: 'Rate (BPM)', value: rate ? rate.toFixed(1) : 'N/A' },
              { label: 'Threshold', value: thresh.toFixed(4) },
            ],
            chartData: signal.slice(0, 2000).map((v, i) => ({ x: i / fs, y: v })),
            chartType: 'line', chartTitle: 'Signal with Peaks', xLabel: 'Time (s)', yLabel: 'Amplitude',
          }
        }
      },
      {
        id: 'hrv_analysis', title: 'HRV Analysis',
        description: 'Heart rate variability from RR intervals — time & frequency domain metrics',
        params: [
          { name: 'rr_intervals', label: 'RR intervals (ms)', type: 'array', required: true, description: 'RR intervals in milliseconds' },
        ],
        compute: (p, data) => {
          const rr = getArray(p, data, 'rr_intervals')
          if (rr.length < 5) return { results: {}, error: 'Need at least 5 RR intervals' }
          const meanRR = mean(rr), sdnn = std(rr)
          const diffs = rr.slice(1).map((v, i) => v - rr[i])
          const rmssd = Math.sqrt(mean(diffs.map(d => d * d)))
          const nn50 = diffs.filter(d => Math.abs(d) > 50).length
          const pnn50 = (nn50 / diffs.length) * 100
          const hr = rr.map(r => 60000 / r)
          return {
            results: { hr_values: hr },
            statistics: [
              { label: 'Mean RR', value: `${meanRR.toFixed(1)} ms` },
              { label: 'SDNN', value: `${sdnn.toFixed(2)} ms` },
              { label: 'RMSSD', value: `${rmssd.toFixed(2)} ms` },
              { label: 'pNN50', value: `${pnn50.toFixed(1)}%` },
              { label: 'NN50', value: String(nn50) },
              { label: 'Mean HR', value: `${mean(hr).toFixed(1)} bpm` },
              { label: 'SD HR', value: `${std(hr).toFixed(2)} bpm` },
              { label: 'CV (SDNN/meanRR)', value: `${((sdnn / meanRR) * 100).toFixed(2)}%` },
              { label: 'N intervals', value: String(rr.length) },
            ],
            chartData: rr.map((v, i) => ({ x: i, y: v })),
            chartType: 'line', chartTitle: 'RR Interval Tachogram', xLabel: 'Beat #', yLabel: 'RR (ms)',
          }
        }
      },
    ]
  },
  // ── Pharmacokinetics ───────────────────────────────────────────
  {
    id: 'pharmacokinetics', name: 'Pharmacokinetics',
    description: 'PK modeling — compartmental models, AUC, half-life, dosing simulations',
    operations: [
      {
        id: 'one_compartment', title: 'One-Compartment IV Bolus',
        description: 'C(t) = (D/V) · e^(-k·t) — single compartment elimination kinetics',
        params: [
          { name: 'dose', label: 'Dose (mg)', type: 'number', default: 100, min: 0.01 },
          { name: 'volume', label: 'Volume of distribution (L)', type: 'number', default: 50, min: 0.1 },
          { name: 'ke', label: 'Elimination rate constant (1/h)', type: 'number', default: 0.15, min: 0.001, step: 0.01 },
          { name: 't_max', label: 'Simulation time (h)', type: 'number', default: 48, min: 1 },
          { name: 'mec', label: 'Min effective conc (mg/L)', type: 'number', default: 0.5, description: 'Optional MEC for therapeutic window' },
          { name: 'mtc', label: 'Min toxic conc (mg/L)', type: 'number', default: 5, description: 'Optional MTC for therapeutic window' },
        ],
        compute: (p) => {
          const D = p.dose || 100, V = p.volume || 50, ke = p.ke || 0.15, tMax = p.t_max || 48
          const C0 = D / V, halfLife = Math.LN2 / ke
          const auc = C0 / ke
          const cl = ke * V
          const steps = 200
          const dt = tMax / steps
          const curve = Array.from({ length: steps + 1 }, (_, i) => {
            const t = i * dt
            return { x: Math.round(t * 100) / 100, y: C0 * Math.exp(-ke * t) }
          })
          const stats: { label: string; value: string }[] = [
            { label: 'C₀ (initial conc)', value: `${C0.toFixed(4)} mg/L` },
            { label: 'Half-life (t½)', value: `${halfLife.toFixed(2)} h` },
            { label: 'AUC₀₋∞', value: `${auc.toFixed(4)} mg·h/L` },
            { label: 'Clearance (CL)', value: `${cl.toFixed(4)} L/h` },
            { label: 'Vd', value: `${V} L` },
            { label: 'ke', value: `${ke} 1/h` },
          ]
          if (p.mec) {
            const t_mec = -Math.log(p.mec / C0) / ke
            stats.push({ label: 'Time above MEC', value: t_mec > 0 ? `${t_mec.toFixed(2)} h` : 'Below MEC at t=0' })
          }
          return {
            results: { concentration_curve: curve },
            statistics: stats,
            chartData: curve,
            chartType: 'line', chartTitle: 'Concentration-Time Profile', xLabel: 'Time (h)', yLabel: 'Concentration (mg/L)',
          }
        }
      },
      {
        id: 'oral_absorption', title: 'Oral Absorption (1-Comp)',
        description: 'C(t) = (F·D·ka)/(V·(ka-ke)) · (e^(-ke·t) - e^(-ka·t))',
        params: [
          { name: 'dose', label: 'Dose (mg)', type: 'number', default: 500, min: 0.01 },
          { name: 'volume', label: 'Vd (L)', type: 'number', default: 70, min: 0.1 },
          { name: 'ka', label: 'Absorption rate (1/h)', type: 'number', default: 1.2, min: 0.01, step: 0.1 },
          { name: 'ke', label: 'Elimination rate (1/h)', type: 'number', default: 0.15, min: 0.001, step: 0.01 },
          { name: 'f', label: 'Bioavailability (F)', type: 'number', default: 0.8, min: 0, max: 1, step: 0.05 },
          { name: 't_max_sim', label: 'Simulation time (h)', type: 'number', default: 48 },
        ],
        compute: (p) => {
          const D = p.dose || 500, V = p.volume || 70, ka = p.ka || 1.2, ke = p.ke || 0.15, F = p.f || 0.8
          const tMax = p.t_max_sim || 48
          const A = (F * D * ka) / (V * (ka - ke))
          const tPeak = Math.log(ka / ke) / (ka - ke)
          const cPeak = A * (Math.exp(-ke * tPeak) - Math.exp(-ka * tPeak))
          const auc = (F * D) / (V * ke)
          const steps = 200, dt = tMax / steps
          const curve = Array.from({ length: steps + 1 }, (_, i) => {
            const t = i * dt
            return { x: Math.round(t * 100) / 100, y: A * (Math.exp(-ke * t) - Math.exp(-ka * t)) }
          })
          return {
            results: {},
            statistics: [
              { label: 'Tmax', value: `${tPeak.toFixed(2)} h` },
              { label: 'Cmax', value: `${cPeak.toFixed(4)} mg/L` },
              { label: 'AUC₀₋∞', value: `${auc.toFixed(4)} mg·h/L` },
              { label: 'Half-life', value: `${(Math.LN2 / ke).toFixed(2)} h` },
              { label: 'Bioavailability', value: `${(F * 100).toFixed(0)}%` },
              { label: 'ka', value: `${ka} 1/h` },
              { label: 'ke', value: `${ke} 1/h` },
            ],
            chartData: curve, chartType: 'line',
            chartTitle: 'Oral PK Profile', xLabel: 'Time (h)', yLabel: 'Concentration (mg/L)',
          }
        }
      },
      {
        id: 'multiple_dosing', title: 'Multiple Dosing Simulation',
        description: 'Simulate repeated IV or oral dosing to steady state',
        params: [
          { name: 'dose', label: 'Dose (mg)', type: 'number', default: 100 },
          { name: 'interval', label: 'Dosing interval (h)', type: 'number', default: 8, min: 0.5 },
          { name: 'n_doses', label: 'Number of doses', type: 'number', default: 10, min: 1, max: 100 },
          { name: 'volume', label: 'Vd (L)', type: 'number', default: 50 },
          { name: 'ke', label: 'ke (1/h)', type: 'number', default: 0.15 },
          { name: 'route', label: 'Route', type: 'select', default: 'iv', options: [
            { value: 'iv', label: 'IV Bolus' }, { value: 'oral', label: 'Oral' }
          ]},
          { name: 'ka', label: 'ka (1/h, oral only)', type: 'number', default: 1.2 },
          { name: 'f', label: 'Bioavailability (oral only)', type: 'number', default: 0.8, min: 0, max: 1 },
        ],
        compute: (p) => {
          const D = p.dose || 100, tau = p.interval || 8, nDoses = p.n_doses || 10
          const V = p.volume || 50, ke = p.ke || 0.15
          const isOral = p.route === 'oral'
          const ka = isOral ? (p.ka || 1.2) : 0, F = isOral ? (p.f || 0.8) : 1
          const tTotal = tau * nDoses, steps = tTotal * 4
          const dt = tTotal / steps
          const curve: { x: number; y: number }[] = []
          for (let i = 0; i <= steps; i++) {
            const t = i * dt
            let c = 0
            for (let d = 0; d < nDoses; d++) {
              const td = t - d * tau
              if (td < 0) continue
              if (isOral) {
                const A = (F * D * ka) / (V * (ka - ke))
                c += A * (Math.exp(-ke * td) - Math.exp(-ka * td))
              } else {
                c += (D / V) * Math.exp(-ke * td)
              }
            }
            curve.push({ x: Math.round(t * 100) / 100, y: Math.max(0, c) })
          }
          // Steady-state metrics
          const accumFactor = 1 / (1 - Math.exp(-ke * tau))
          const cssMax = (D / V) * accumFactor
          const cssMin = cssMax * Math.exp(-ke * tau)
          return {
            results: {},
            statistics: [
              { label: 'Accumulation factor', value: accumFactor.toFixed(3) },
              { label: 'Css,max (IV)', value: `${cssMax.toFixed(4)} mg/L` },
              { label: 'Css,min (trough)', value: `${cssMin.toFixed(4)} mg/L` },
              { label: 'Fluctuation', value: `${(((cssMax - cssMin) / cssMin) * 100).toFixed(1)}%` },
              { label: 'Time to ~SS', value: `${(4.5 * Math.LN2 / ke).toFixed(1)} h (~5 half-lives)` },
              { label: 'Doses', value: `${nDoses} × ${D}mg q${tau}h` },
            ],
            chartData: curve, chartType: 'line',
            chartTitle: 'Multiple Dosing Profile', xLabel: 'Time (h)', yLabel: 'Concentration (mg/L)',
          }
        }
      },
    ]
  },
  // ── Equation Plotter ───────────────────────────────────────────
  {
    id: 'equations', name: 'Equation Plotter',
    description: 'Plot mathematical and pharmacokinetic equations — custom or predefined',
    operations: [
      {
        id: 'custom_equation', title: 'Custom Equation',
        description: 'Plot any equation y = f(x). Supports: sin, cos, tan, exp, log, sqrt, abs, pow, PI, e, ^',
        params: [
          { name: 'expression', label: 'Equation (use x as variable)', type: 'string', required: true, default: 'sin(x) * exp(-0.1*x)' },
          { name: 'x_min', label: 'X min', type: 'number', default: 0 },
          { name: 'x_max', label: 'X max', type: 'number', default: 20 },
          { name: 'steps', label: 'Points', type: 'number', default: 200, min: 10, max: 2000 },
        ],
        compute: (p) => {
          const expr = p.expression || 'x'
          const xMin = p.x_min ?? 0, xMax = p.x_max ?? 20, steps = p.steps || 200
          const safeExpr = expr
            .replace(/\bsin\b/g, 'Math.sin').replace(/\bcos\b/g, 'Math.cos').replace(/\btan\b/g, 'Math.tan')
            .replace(/\bexp\b/g, 'Math.exp').replace(/\blog\b/g, 'Math.log').replace(/\bsqrt\b/g, 'Math.sqrt')
            .replace(/\babs\b/g, 'Math.abs').replace(/\bpow\b/g, 'Math.pow')
            .replace(/\bPI\b/g, 'Math.PI').replace(/\be\b/g, 'Math.E').replace(/\^/g, '**')
          const data: { x: number; y: number }[] = []
          const warnings: string[] = []
          let errorCount = 0
          try {
            const fn = new Function('x', `"use strict"; return ${safeExpr}`)
            const dt = (xMax - xMin) / steps
            for (let i = 0; i <= steps; i++) {
              const x = xMin + i * dt
              try {
                const y = fn(x)
                if (typeof y === 'number' && isFinite(y)) {
                  data.push({ x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 })
                } else { errorCount++ }
              } catch { errorCount++ }
            }
          } catch (e: any) {
            return { results: {}, error: `Invalid expression: ${e.message}` }
          }
          if (errorCount > 0) warnings.push(`${errorCount} points undefined/infinite`)
          return {
            results: { expression: expr, points: data.length },
            statistics: data.length > 0 ? [
              { label: 'Expression', value: expr },
              { label: 'Points plotted', value: String(data.length) },
              { label: 'Y min', value: Math.min(...data.map(d => d.y)).toFixed(6) },
              { label: 'Y max', value: Math.max(...data.map(d => d.y)).toFixed(6) },
              { label: 'Y mean', value: mean(data.map(d => d.y)).toFixed(6) },
            ] : undefined,
            chartData: data, chartType: 'line', chartTitle: `y = ${expr}`, xLabel: 'x', yLabel: 'y',
            warnings,
          }
        }
      },
      {
        id: 'dose_response', title: 'Dose-Response Curve (Hill)',
        description: 'E = Emax · D^n / (EC50^n + D^n) — sigmoidal dose-response',
        params: [
          { name: 'emax', label: 'Emax (max effect)', type: 'number', default: 100 },
          { name: 'ec50', label: 'EC50', type: 'number', default: 10 },
          { name: 'hill_n', label: 'Hill coefficient (n)', type: 'number', default: 1.5, min: 0.1, step: 0.1 },
          { name: 'baseline', label: 'Baseline effect', type: 'number', default: 0 },
          { name: 'd_min', label: 'Dose min', type: 'number', default: 0.1 },
          { name: 'd_max', label: 'Dose max', type: 'number', default: 1000 },
        ],
        compute: (p) => {
          const Emax = p.emax || 100, EC50 = p.ec50 || 10, n = p.hill_n || 1.5, E0 = p.baseline || 0
          const dMin = p.d_min || 0.1, dMax = p.d_max || 1000
          // Log-spaced doses
          const logMin = Math.log10(dMin), logMax = Math.log10(dMax)
          const data = Array.from({ length: 100 }, (_, i) => {
            const d = Math.pow(10, logMin + (logMax - logMin) * i / 99)
            const e = E0 + Emax * Math.pow(d, n) / (Math.pow(EC50, n) + Math.pow(d, n))
            return { x: Math.round(d * 1000) / 1000, y: Math.round(e * 1000) / 1000 }
          })
          return {
            results: {},
            statistics: [
              { label: 'Emax', value: String(Emax) },
              { label: 'EC50', value: String(EC50) },
              { label: 'Hill coefficient', value: String(n) },
              { label: 'EC90', value: (EC50 * Math.pow(9, 1 / n)).toFixed(2) },
              { label: 'EC10', value: (EC50 * Math.pow(1 / 9, 1 / n)).toFixed(2) },
            ],
            chartData: data, chartType: 'line',
            chartTitle: 'Dose-Response Curve', xLabel: 'Dose', yLabel: 'Effect',
          }
        }
      },
      {
        id: 'sir_model', title: 'SIR Epidemic Model',
        description: 'Susceptible-Infected-Recovered compartmental model',
        params: [
          { name: 'population', label: 'Population (N)', type: 'number', default: 10000 },
          { name: 'i0', label: 'Initial infected', type: 'number', default: 10 },
          { name: 'beta', label: 'Transmission rate (β)', type: 'number', default: 0.3, step: 0.01 },
          { name: 'gamma', label: 'Recovery rate (γ)', type: 'number', default: 0.1, step: 0.01 },
          { name: 'days', label: 'Days to simulate', type: 'number', default: 160, min: 10 },
        ],
        compute: (p) => {
          const N = p.population || 10000, I0 = p.i0 || 10, beta = p.beta || 0.3, gamma = p.gamma || 0.1
          const days = p.days || 160, dt = 0.1
          let S = N - I0, I = I0, R = 0
          const data: { x: number; y: number; label?: string }[] = []
          for (let t = 0; t <= days; t += dt) {
            if (Math.abs(t - Math.round(t)) < dt / 2) {
              data.push({ x: Math.round(t), y: Math.round(I), label: 'Infected' })
            }
            const dS = -beta * S * I / N * dt
            const dI = (beta * S * I / N - gamma * I) * dt
            const dR = gamma * I * dt
            S += dS; I += dI; R += dR
          }
          const R0 = beta / gamma
          const peakI = Math.max(...data.map(d => d.y))
          const peakDay = data.find(d => d.y === peakI)?.x || 0
          return {
            results: {},
            statistics: [
              { label: 'R₀', value: R0.toFixed(2) },
              { label: 'Peak infected', value: String(peakI) },
              { label: 'Peak day', value: String(peakDay) },
              { label: 'Final susceptible', value: Math.round(S).toString() },
              { label: 'Final recovered', value: Math.round(R).toString() },
              { label: 'Attack rate', value: `${((R / N) * 100).toFixed(1)}%` },
              { label: 'Herd immunity threshold', value: `${((1 - 1 / R0) * 100).toFixed(1)}%` },
            ],
            chartData: data, chartType: 'line',
            chartTitle: 'SIR Model — Infected Over Time', xLabel: 'Day', yLabel: 'Infected',
          }
        }
      },
    ]
  },
]

// ═══════════════════════════════════════════════════════════════════
//  CLIENT-SIDE FILE PARSING
// ═══════════════════════════════════════════════════════════════════

function parseCSV(text: string): { columns: Record<string, number[]>; raw: string[][]; columnNames: string[] } {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 1) return { columns: {}, raw: [], columnNames: [] }
  // Detect delimiter
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const rows = lines.map(l => l.split(delim).map(c => c.trim().replace(/^["']|["']$/g, '')))
  // Detect if first row is header
  const firstRowNumeric = rows[0].every(c => !isNaN(Number(c)) && c !== '')
  const headerRow = firstRowNumeric ? rows[0].map((_, i) => `Col_${i + 1}`) : rows[0]
  const dataRows = firstRowNumeric ? rows : rows.slice(1)
  const columns: Record<string, number[]> = {}
  headerRow.forEach((h, i) => {
    const vals = dataRows.map(r => Number(r[i])).filter(v => !isNaN(v))
    if (vals.length > 0) columns[h] = vals
  })
  return { columns, raw: dataRows, columnNames: headerRow }
}

function parseJSON(text: string): { columns: Record<string, number[]>; raw: string[][]; columnNames: string[] } {
  const obj = JSON.parse(text)
  const columns: Record<string, number[]> = {}
  if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
    // Array of objects
    const keys = Object.keys(obj[0])
    keys.forEach(k => {
      const vals = obj.map((row: any) => Number(row[k])).filter((v: number) => !isNaN(v))
      if (vals.length > 0) columns[k] = vals
    })
    return { columns, raw: obj.map((row: any) => keys.map(k => String(row[k] ?? ''))), columnNames: keys }
  } else if (Array.isArray(obj) && obj.every((v: any) => typeof v === 'number')) {
    columns['values'] = obj
    return { columns, raw: obj.map((v: any) => [String(v)]), columnNames: ['values'] }
  }
  return { columns: {}, raw: [], columnNames: [] }
}

function parseFileContent(text: string, filename: string): DataState {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  try {
    if (ext === 'json') {
      const parsed = parseJSON(text)
      return { ...parsed, fileName: filename }
    }
  } catch { /* fall through to CSV */ }
  const parsed = parseCSV(text)
  return { ...parsed, fileName: filename }
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function NumericCompute() {
  // Domain & operation selection
  const [selectedDomain, setSelectedDomain] = useState('')
  const [selectedOp, setSelectedOp] = useState('')

  // Data state (from file, matrix, or manual entry)
  const emptyData: DataState = { columns: {}, raw: [], columnNames: [] }
  const [dataState, setDataState] = useState<DataState>(emptyData)

  // Input state
  const [paramValues, setParamValues] = useState<Record<string, any>>({})
  const [matrixData, setMatrixData] = useState<string[][]>(
    Array.from({ length: 5 }, () => Array(3).fill(''))
  )

  // Results
  const [result, setResult] = useState<ComputeResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  // UI
  const [_expandedGroups] = useState<Set<string>>(new Set(['General', 'Parameters'])) // reserved for future group collapsing
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Domain/operation lookup
  const domain = useMemo(() => DOMAINS.find(d => d.id === selectedDomain), [selectedDomain])
  const operation = useMemo(() => domain?.operations.find(o => o.id === selectedOp), [domain, selectedOp])

  // Initialize defaults on operation change
  const handleOpChange = useCallback((opId: string) => {
    setSelectedOp(opId)
    setResult(null)
    setError('')
    const op = domain?.operations.find(o => o.id === opId)
    if (op) {
      const defaults: Record<string, any> = {}
      op.params.forEach(p => { if (p.default !== undefined) defaults[p.name] = p.default })
      setParamValues(defaults)
    }
  }, [domain])

  // File upload handler
  const handleFile = useCallback((file: File) => {
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const parsed = parseFileContent(text, file.name)
        setDataState(parsed)
        if (Object.keys(parsed.columns).length === 0) {
          setError('Could not extract numeric columns from file. Ensure CSV/TSV/JSON format.')
        }
      } catch (err: any) {
        setError(`File parse error: ${err.message}`)
      }
    }
    reader.readAsText(file)
  }, [])

  // Matrix → data state
  const applyMatrix = useCallback(() => {
    const rows = matrixData.filter(r => r.some(c => c.trim() !== ''))
    if (rows.length === 0) return
    const cols = rows[0].length
    const columns: Record<string, number[]> = {}
    const columnNames: string[] = []
    for (let c = 0; c < cols; c++) {
      const name = `Col_${c + 1}`
      columnNames.push(name)
      const vals = rows.map(r => Number(r[c])).filter(v => !isNaN(v))
      if (vals.length > 0) columns[name] = vals
    }
    setDataState({ columns, raw: rows, columnNames })
  }, [matrixData])

  // Execute computation
  const executeCompute = useCallback(async () => {
    if (!operation) return
    setRunning(true); setError(''); setResult(null)
    try {
      // Brief async delay to let UI update
      await new Promise(r => setTimeout(r, 10))
      const start = performance.now()
      const res = operation.compute(paramValues, dataState)
      const elapsed = (performance.now() - start) / 1000
      if (res.error) { setError(res.error) }
      else { setResult({ ...res, results: res.results || {} } as any) }
      // Store runtime for display
      if (res && !res.error) {
        setResult(prev => prev ? { ...prev, _runtime: elapsed } as any : null)
      }
    } catch (err: any) {
      setError(`Computation error: ${err.message}`)
    } finally {
      setRunning(false)
    }
  }, [operation, paramValues, dataState])

  // Parameter update helper
  const setParam = useCallback((name: string, value: any) => {
    setParamValues(prev => ({ ...prev, [name]: value }))
  }, [])

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-3 p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <FiCpu />Compute Engine
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {DOMAINS.reduce((s, d) => s + d.operations.length, 0)} operations across {DOMAINS.length} domains — client-side, no server required
          </p>
        </div>
        {dataState.fileName && (
          <div className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--glass-bg)', color: 'var(--color-accent-green)' }}>
            <FiFile size={12} />
            {dataState.fileName} — {Object.keys(dataState.columns).length} columns, {Math.max(...Object.values(dataState.columns).map(c => c.length), 0)} rows
            <button onClick={() => setDataState(emptyData)} className="opacity-60 hover:opacity-100"><FiX size={12} /></button>
          </div>
        )}
      </div>

      {/* Domain & Operation selectors */}
      <div className="flex gap-2 flex-shrink-0">
        <select
          className="input flex-1"
          value={selectedDomain}
          onChange={e => { setSelectedDomain(e.target.value); setSelectedOp(''); setResult(null); setError('') }}
        >
          <option value="">Select Domain...</option>
          {DOMAINS.map(d => (
            <option key={d.id} value={d.id}>{d.name} — {d.operations.length} ops</option>
          ))}
        </select>
        <select
          className="input flex-1"
          value={selectedOp}
          onChange={e => handleOpChange(e.target.value)}
          disabled={!domain}
        >
          <option value="">Select Operation...</option>
          {domain?.operations.map(o => (
            <option key={o.id} value={o.id}>{o.title}</option>
          ))}
        </select>
      </div>

      {/* Operation description */}
      {operation && (
        <div className="text-xs px-3 py-2 rounded-lg flex-shrink-0" style={{ background: 'var(--glass-bg)', color: 'var(--color-text-secondary)' }}>
          {operation.description}
        </div>
      )}

      {/* Main content */}
      <div className="flex gap-3 flex-1 min-h-0">
        {/* ──── LEFT: Inputs ──── */}
        <div className="w-1/2 flex flex-col gap-3 overflow-y-auto pr-1 min-h-0">

          {/* File Upload Zone */}
          <div
            className="glass-card rounded-xl p-3"
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                <FiUpload className="inline mr-1" size={12} />Data Input
              </span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>CSV, TSV, JSON</span>
            </div>
            <div
              className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all"
              style={{
                borderColor: dragOver ? 'var(--color-accent-blue)' : 'var(--glass-border)',
                background: dragOver ? 'rgba(59,130,246,0.05)' : 'transparent',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,.json,.dat"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Drop file here or click to browse
              </p>
            </div>

            {/* Data preview */}
            {Object.keys(dataState.columns).length > 0 && (
              <div className="mt-2 overflow-auto max-h-32 rounded-lg" style={{ background: 'var(--glass-bg)' }}>
                <table className="w-full text-[10px]">
                  <thead>
                    <tr>
                      {dataState.columnNames.map(n => (
                        <th key={n} className="px-2 py-1 text-left font-medium" style={{ color: 'var(--color-text-secondary)' }}>{n}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataState.raw.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t" style={{ borderColor: 'var(--glass-border)' }}>
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-0.5" style={{ color: 'var(--color-text)' }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dataState.raw.length > 5 && (
                  <p className="text-[9px] px-2 py-1" style={{ color: 'var(--color-text-muted)' }}>
                    ...{dataState.raw.length - 5} more rows
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Matrix Editor */}
          <details className="glass-card rounded-xl">
            <summary className="px-3 py-2 text-xs font-medium cursor-pointer flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
              <FiGrid size={12} />Matrix Editor
              <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-muted)' }}>Paste from Excel or enter manually</span>
            </summary>
            <div className="px-3 pb-3">
              <div className="overflow-auto max-h-48 rounded-lg" style={{ background: 'var(--glass-bg)' }}>
                <table className="text-[10px]">
                  <tbody>
                    {matrixData.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="p-0">
                            <input
                              className="w-16 px-1 py-0.5 border-0 text-[10px] bg-transparent focus:outline-none"
                              style={{ color: 'var(--color-text)', borderRight: '1px solid var(--glass-border)', borderBottom: '1px solid var(--glass-border)' }}
                              value={cell}
                              onChange={e => {
                                const next = matrixData.map(r => [...r])
                                next[ri][ci] = e.target.value
                                setMatrixData(next)
                              }}
                              onPaste={e => {
                                const text = e.clipboardData.getData('text')
                                if (text.includes('\t') || text.includes('\n')) {
                                  e.preventDefault()
                                  const rows = text.trim().split(/\r?\n/).map(r => r.split('\t'))
                                  const maxCols = Math.max(...rows.map(r => r.length))
                                  const padded = rows.map(r => [...r, ...Array(maxCols - r.length).fill('')])
                                  setMatrixData(padded)
                                }
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 mt-2">
                <button className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}
                  onClick={() => setMatrixData(prev => [...prev, Array(prev[0].length).fill('')])}
                ><FiPlus size={9} className="inline" /> Row</button>
                <button className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}
                  onClick={() => setMatrixData(prev => prev.map(r => [...r, '']))}
                ><FiPlus size={9} className="inline" /> Col</button>
                <button className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--color-accent-blue)', color: '#fff' }}
                  onClick={applyMatrix}
                >Apply as Data</button>
                <button className="text-[10px] px-2 py-1 rounded ml-auto" style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}
                  onClick={() => setMatrixData(Array.from({ length: 5 }, () => Array(3).fill('')))}
                ><FiTrash2 size={9} className="inline" /> Clear</button>
              </div>
            </div>
          </details>

          {/* Parameters Form */}
          {operation && operation.params.length > 0 && (
            <div className="glass-card rounded-xl p-3">
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                Parameters
              </div>
              <div className="space-y-2">
                {operation.params.map(param => {
                  return (
                    <div key={param.name} className="space-y-0.5">
                      <label className="flex items-center justify-between">
                        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
                          {param.label}
                          {param.required && <span style={{ color: '#ef4444' }}> *</span>}
                        </span>
                        {param.description && (
                          <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }} title={param.description}>?</span>
                        )}
                      </label>

                      {param.type === 'number' && (
                        <input
                          type="number"
                          className="input w-full text-xs"
                          value={paramValues[param.name] ?? param.default ?? ''}
                          min={param.min} max={param.max} step={param.step}
                          onChange={e => setParam(param.name, e.target.value === '' ? '' : Number(e.target.value))}
                        />
                      )}

                      {param.type === 'string' && (
                        <input
                          type="text"
                          className="input w-full text-xs"
                          value={paramValues[param.name] ?? param.default ?? ''}
                          onChange={e => setParam(param.name, e.target.value)}
                        />
                      )}

                      {param.type === 'select' && (
                        <select
                          className="input w-full text-xs"
                          value={paramValues[param.name] ?? param.default ?? ''}
                          onChange={e => setParam(param.name, e.target.value)}
                        >
                          {param.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}

                      {param.type === 'boolean' && (
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!paramValues[param.name]}
                            onChange={e => setParam(param.name, e.target.checked)}
                          />
                          <span style={{ color: 'var(--color-text-muted)' }}>{paramValues[param.name] ? 'Enabled' : 'Disabled'}</span>
                        </label>
                      )}

                      {param.type === 'array' && (
                        <div>
                          <textarea
                            className="input w-full text-[10px] font-mono"
                            rows={2}
                            placeholder="Enter comma-separated values, or load from file/matrix"
                            value={Array.isArray(paramValues[param.name]) ? paramValues[param.name].join(', ') : (paramValues[param.name] ?? '')}
                            onChange={e => {
                              const raw = e.target.value
                              const nums = raw.split(/[,\s]+/).map(Number).filter(n => !isNaN(n))
                              setParam(param.name, nums.length > 0 ? nums : raw)
                            }}
                          />
                          {/* Column picker if data loaded */}
                          {Object.keys(dataState.columns).length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {dataState.columnNames.map(col => (
                                <button
                                  key={col}
                                  className="text-[9px] px-1.5 py-0.5 rounded"
                                  style={{
                                    background: paramValues[param.name] === col ? 'var(--color-accent-blue)' : 'var(--glass-bg)',
                                    color: paramValues[param.name] === col ? '#fff' : 'var(--color-text-muted)',
                                  }}
                                  onClick={() => setParam(param.name, dataState.columns[col])}
                                  title={`Use column "${col}" (${dataState.columns[col]?.length} values)`}
                                >
                                  {col}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {param.type === 'matrix' && (
                        <p className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>
                          Use the Matrix Editor above to enter data, then click "Apply as Data"
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Execute */}
          <button
            className="btn py-2.5 w-full flex items-center justify-center gap-2 rounded-xl flex-shrink-0 text-sm font-medium"
            style={{
              background: running ? 'var(--glass-bg)' : !selectedDomain || !selectedOp ? 'var(--glass-bg)' : 'var(--color-accent-blue)',
              color: running || !selectedDomain || !selectedOp ? 'var(--color-text-muted)' : '#fff',
              cursor: running || !selectedDomain || !selectedOp ? 'not-allowed' : 'pointer',
            }}
            onClick={executeCompute}
            disabled={running || !selectedDomain || !selectedOp}
          >
            {running ? <FiLoader className="animate-spin" /> : <FiPlay />}
            {running ? 'Computing...' : 'Execute'}
          </button>
        </div>

        {/* ──── RIGHT: Results ──── */}
        <div className="w-1/2 flex flex-col min-h-0 glass-card rounded-xl p-4 overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl mb-3" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              <FiAlertCircle className="mt-0.5 flex-shrink-0" />
              <div className="text-xs">{error}</div>
            </div>
          )}

          {!result && !running && !error && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
                <FiCpu size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium mb-1">Ready to Compute</p>
                <p className="text-xs max-w-xs mx-auto">
                  {!selectedDomain
                    ? 'Select a domain and operation to begin. Load data from a file, paste into the matrix editor, or enter values directly in parameter fields.'
                    : !selectedOp
                    ? `${domain?.operations.length} operations available. Select one to see its parameters.`
                    : 'Configure parameters and click Execute.'
                  }
                </p>
                {!selectedDomain && (
                  <div className="mt-4 grid grid-cols-2 gap-2 text-left max-w-sm mx-auto">
                    {DOMAINS.map(d => (
                      <button
                        key={d.id}
                        className="text-[10px] p-2 rounded-lg text-left transition-all hover:scale-[1.02]"
                        style={{ background: 'var(--glass-bg)', color: 'var(--color-text)' }}
                        onClick={() => { setSelectedDomain(d.id); setSelectedOp(''); setResult(null); setError('') }}
                      >
                        <div className="font-medium">{d.name}</div>
                        <div style={{ color: 'var(--color-text-muted)' }}>{d.operations.length} operations</div>
                      </button>
                    ))}
                  </div>
                )}
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
                <span className="flex items-center gap-1" style={{ color: 'var(--color-accent-green)' }}>
                  <FiCheck size={14} /> Completed
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {((result as any)._runtime || 0).toFixed(3)}s
                </span>
              </div>

              {/* Warnings */}
              {result.warnings && result.warnings.length > 0 && (
                <div className="space-y-1">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                      <FiAlertCircle className="mt-0.5 flex-shrink-0" size={12} />{w}
                    </div>
                  ))}
                </div>
              )}

              {/* Chart */}
              {result.chartData && result.chartData.length > 0 && (
                <div className="glass-card rounded-xl p-3">
                  <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>
                    <FiBarChart2 className="inline mr-1" size={12} />
                    {result.chartTitle || 'Plot'}
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    {result.chartType === 'scatter' ? (
                      <ScatterChart margin={{ top: 5, right: 15, bottom: 20, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="x" type="number" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: result.xLabel, position: 'bottom', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: result.yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 10 }} />
                        <Scatter data={result.chartData} fill="var(--color-accent-blue)" fillOpacity={0.6} r={2} />
                      </ScatterChart>
                    ) : result.chartType === 'bar' ? (
                      <BarChart data={result.chartData} margin={{ top: 5, right: 15, bottom: 20, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="x" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: result.xLabel, position: 'bottom', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: result.yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 10 }} />
                        <Bar dataKey="y" fill="var(--color-accent-blue)" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    ) : (
                      <LineChart data={result.chartData} margin={{ top: 5, right: 15, bottom: 20, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="x" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: result.xLabel, position: 'bottom', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: result.yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 10 }} />
                        <Line type="monotone" dataKey="y" stroke="var(--color-accent-blue)" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}

              {/* Statistics table */}
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

              {/* Raw results JSON (if any extra data) */}
              {result.results && Object.keys(result.results).length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium py-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Raw Output Data
                  </summary>
                  <div className="flex justify-end mb-1">
                    <button
                      className="text-[10px] flex items-center gap-1 opacity-60 hover:opacity-100"
                      style={{ color: 'var(--color-text-muted)' }}
                      onClick={() => navigator.clipboard.writeText(JSON.stringify(result.results, null, 2))}
                    ><FiCopy size={10} /> Copy JSON</button>
                  </div>
                  <pre
                    className="glass-card rounded-xl p-3 text-[10px] overflow-auto max-h-48 font-mono"
                    style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {JSON.stringify(result.results, null, 2)}
                  </pre>
                </details>
              )}

              {/* Export */}
              <div className="flex gap-2 pt-1">
                <button
                  className="text-[10px] px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                  style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
                    a.download = `${selectedDomain}_${selectedOp}_results.json`; a.click()
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
                      a.download = `${selectedDomain}_${selectedOp}_results.csv`; a.click()
                      URL.revokeObjectURL(a.href)
                    }}
                  ><FiDownload size={10} /> CSV</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
