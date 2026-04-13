// ═══════════════════════════════════════════════════════════════════════
// Compute Lab — Unified Math Library
// Self-contained client-side implementations of all math used by presets
// ═══════════════════════════════════════════════════════════════════════

/* ── Core Statistics ─────────────────────────────────────────────────── */
export const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0)
export const mean = (a: number[]): number => a.length === 0 ? 0 : sum(a) / a.length

// Single-pass min/max. Required instead of Math.min(...arr) / Math.max(...arr)
// because spread-as-arguments overflows the engine's call-stack around ~10k
// elements (Chromium threshold varies by platform). Every preset that reduces
// user-provided data should route through these.
export const arrMin = (a: ArrayLike<number>): number => {
  let m = Infinity
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < m) m = v }
  return Number.isFinite(m) ? m : 0
}
export const arrMax = (a: ArrayLike<number>): number => {
  let m = -Infinity
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v > m) m = v }
  return Number.isFinite(m) ? m : 0
}

export function variance(a: number[], ddof = 1): number {
  if (a.length <= ddof) return 0
  const m = mean(a)
  return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - ddof)
}

export const std = (a: number[], ddof = 1): number => Math.sqrt(variance(a, ddof))

export function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function quantile(a: number[], q: number): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

export function skewness(a: number[]): number {
  const n = a.length
  if (n < 3) return 0
  const m = mean(a), s = std(a)
  if (s === 0) return 0
  return (n / ((n - 1) * (n - 2))) * a.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0)
}

export function kurtosis(a: number[]): number {
  const n = a.length
  if (n < 4) return 0
  const m = mean(a), s = std(a)
  if (s === 0) return 0
  const g2 = a.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0)
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * g2 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
}

export const sem = (a: number[]): number => a.length === 0 ? 0 : std(a) / Math.sqrt(a.length)

export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n))
  let s = 0
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb)
  return s / (n - 1)
}

/* ── Distribution Functions ──────────────────────────────────────────── */
export function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6]
  let a = x, t = x + 5.5
  t -= (x + 0.5) * Math.log(t)
  let s = 1.000000000190015
  for (let i = 0; i < 6; i++) s += c[i] / ++a
  return -t + Math.log((2.5066282746310005 * s) / x)
}

export function normCDF(x: number): number {
  // Abramowitz & Stegun rational approximation
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

export function invNorm(p: number): number {
  // Beasley-Springer-Moro
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924]
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857]
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878]
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]
  const pl = 0.02425, ph = 1 - pl
  let x: number
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= ph) {
    const q = p - 0.5, r = q * q
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
         ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  return x
}

export function betaInc(x: number, a: number, b: number): number {
  // Regularized incomplete beta via Lentz's continued fraction
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lbeta = lnGamma(a + b) - lnGamma(a) - lnGamma(b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta) / a
  const eps = 1e-12
  let f = 1, c = 1, d = 0
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2)
    let num: number
    if (i === 0) num = 1
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + num * d
    if (Math.abs(d) < eps) d = eps
    d = 1 / d
    c = 1 + num / c
    if (Math.abs(c) < eps) c = eps
    const cd = c * d
    f *= cd
    if (Math.abs(cd - 1) < eps) break
  }
  return front * (f - 1)
}

export function tCDF(t: number, df: number): number {
  const x = df / (df + t * t)
  const p = 0.5 * betaInc(x, df / 2, 0.5)
  return t < 0 ? p : 1 - p
}

export function gammaCDF(x: number, k: number, theta: number): number {
  // Series expansion for regularized lower incomplete gamma P(k, x/theta)
  if (x <= 0) return 0
  const z = x / theta
  let sum = 1, term = 1
  for (let n = 1; n < 200; n++) {
    term *= z / (k + n)
    sum += term
    if (Math.abs(term) < 1e-12) break
  }
  return Math.exp(-z + k * Math.log(z) - lnGamma(k)) * sum / k * k
}

export function chiCDF(x: number, df: number): number {
  return gammaCDF(x, df / 2, 2)
}

export function fCDF(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0
  return 1 - betaInc(d2 / (d2 + d1 * x), d2 / 2, d1 / 2)
}

/* ── Statistical Tests ───────────────────────────────────────────────── */
export function pearsonR(x: number[], y: number[]): { r: number; p: number } {
  const n = Math.min(x.length, y.length)
  if (n < 3) return { r: 0, p: 1 }
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  const r = sxy / Math.sqrt(sxx * syy)
  const t = r * Math.sqrt((n - 2) / (1 - r * r + 1e-12))
  const p = 2 * (1 - tCDF(Math.abs(t), n - 2))
  return { r, p }
}

export function linearRegression(x: number[], y: number[]): {
  slope: number; intercept: number; r2: number; pValue: number; se: number; predicted: number[]
} {
  const n = Math.min(x.length, y.length)
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const predicted = x.slice(0, n).map(xi => slope * xi + intercept)
  const ssRes = predicted.reduce((s, p, i) => s + (y[i] - p) ** 2, 0)
  const r2 = 1 - ssRes / syy
  const se = Math.sqrt(ssRes / (n - 2)) / Math.sqrt(sxx)
  const t = slope / (se + 1e-12)
  const pValue = 2 * (1 - tCDF(Math.abs(t), n - 2))
  return { slope, intercept, r2, pValue, se, predicted }
}

export function welchTTest(a: number[], b: number[]): { t: number; df: number; p: number; cohenD: number } {
  const ma = mean(a), mb = mean(b)
  const va = variance(a), vb = variance(b)
  const t = (ma - mb) / Math.sqrt(va / a.length + vb / b.length + 1e-12)
  const df = ((va / a.length + vb / b.length) ** 2) /
    ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1) + 1e-12)
  const p = 2 * (1 - tCDF(Math.abs(t), df))
  const pooledSD = Math.sqrt((va + vb) / 2)
  const cohenD = (ma - mb) / (pooledSD + 1e-12)
  return { t, df, p, cohenD }
}

export function pairedTTest(a: number[], b: number[]): { t: number; df: number; p: number; cohenD: number } {
  const n = Math.min(a.length, b.length)
  const diffs = a.slice(0, n).map((v, i) => v - b[i])
  const md = mean(diffs), sd = std(diffs)
  const t = md / (sd / Math.sqrt(n) + 1e-12)
  const df = n - 1
  const p = 2 * (1 - tCDF(Math.abs(t), df))
  const cohenD = md / (sd + 1e-12)
  return { t, df, p, cohenD }
}

export function chiSquareTest(observed: number[][]): { chi2: number; df: number; p: number; cramerV: number } {
  const rows = observed.length, cols = observed[0].length
  const rowSums = observed.map(r => r.reduce((s, v) => s + v, 0))
  const colSums = observed[0].map((_, c) => observed.reduce((s, r) => s + r[c], 0))
  const total = rowSums.reduce((s, v) => s + v, 0)
  let chi2 = 0
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const exp = (rowSums[i] * colSums[j]) / total
      if (exp > 0) chi2 += ((observed[i][j] - exp) ** 2) / exp
    }
  }
  const df = (rows - 1) * (cols - 1)
  const p = 1 - chiCDF(chi2, df)
  const cramerV = Math.sqrt(chi2 / (total * Math.min(rows - 1, cols - 1) + 1e-12))
  return { chi2, df, p, cramerV }
}

export function anovaOneWay(groups: number[][]): { f: number; dfBetween: number; dfWithin: number; p: number; eta2: number } {
  const k = groups.length
  const ns = groups.map(g => g.length)
  const N = ns.reduce((s, n) => s + n, 0)
  const grandMean = groups.flat().reduce((s, v) => s + v, 0) / N
  let ssBetween = 0, ssWithin = 0
  for (let i = 0; i < k; i++) {
    const m = mean(groups[i])
    ssBetween += ns[i] * (m - grandMean) ** 2
    for (const v of groups[i]) ssWithin += (v - m) ** 2
  }
  const dfBetween = k - 1, dfWithin = N - k
  const f = (ssBetween / dfBetween) / (ssWithin / dfWithin + 1e-12)
  const p = 1 - fCDF(f, dfBetween, dfWithin)
  const eta2 = ssBetween / (ssBetween + ssWithin + 1e-12)
  return { f, dfBetween, dfWithin, p, eta2 }
}

export function mannWhitneyU(a: number[], b: number[]): { u: number; z: number; p: number; effectSize: number } {
  const n1 = a.length, n2 = b.length
  const combined = [...a.map(v => ({ v, g: 0 })), ...b.map(v => ({ v, g: 1 }))]
  combined.sort((x, y) => x.v - y.v)
  // assign ranks (with tie averaging)
  const ranks: number[] = Array(combined.length)
  let i = 0
  while (i < combined.length) {
    let j = i
    while (j + 1 < combined.length && combined[j + 1].v === combined[i].v) j++
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[k] = avgRank
    i = j + 1
  }
  let r1 = 0
  for (let k = 0; k < combined.length; k++) if (combined[k].g === 0) r1 += ranks[k]
  const u1 = r1 - (n1 * (n1 + 1)) / 2
  const u = Math.min(u1, n1 * n2 - u1)
  const muU = (n1 * n2) / 2
  const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12)
  const z = (u - muU) / (sigmaU + 1e-12)
  const p = 2 * (1 - normCDF(Math.abs(z)))
  const effectSize = 1 - (2 * u) / (n1 * n2)
  return { u, z, p, effectSize }
}

export function shapiroWilk(data: number[]): { w: number; p: number } {
  // Approximate Shapiro-Wilk using expected order statistics from normal distribution
  const n = data.length
  if (n < 3) return { w: 0, p: 1 }
  const sorted = [...data].sort((a, b) => a - b)
  const m = sorted.map((_, i) => invNorm((i + 1 - 0.375) / (n + 0.25)))
  const mSq = m.reduce((s, v) => s + v * v, 0)
  const c = m.map(v => v / Math.sqrt(mSq))
  const xMean = mean(sorted)
  const num = sorted.reduce((s, x, i) => s + c[i] * x, 0) ** 2
  const den = sorted.reduce((s, x) => s + (x - xMean) ** 2, 0)
  const w = num / (den + 1e-12)
  // p-value approximation
  const lnW = Math.log(1 - w + 1e-12)
  const mu = -1.5861 - 0.31082 * Math.log(n) - 0.083751 * Math.log(n) ** 2 + 0.0038915 * Math.log(n) ** 3
  const sigma = Math.exp(-0.4803 - 0.082676 * Math.log(n) + 0.0030302 * Math.log(n) ** 2)
  const z = (lnW - mu) / sigma
  const p = 1 - normCDF(z)
  return { w, p }
}

/* ── Signal Processing ───────────────────────────────────────────────── */
export function fft(signal: number[], fs: number): { magnitude: number[]; phase: number[]; frequency: number[] } {
  // Naive O(n^2) DFT — sufficient for typical preset sizes
  const N = signal.length
  const magnitude: number[] = new Array(Math.floor(N / 2))
  const phase: number[] = new Array(Math.floor(N / 2))
  const frequency: number[] = new Array(Math.floor(N / 2))
  for (let k = 0; k < N / 2; k++) {
    let re = 0, im = 0
    for (let n = 0; n < N; n++) {
      const angle = (-2 * Math.PI * k * n) / N
      re += signal[n] * Math.cos(angle)
      im += signal[n] * Math.sin(angle)
    }
    magnitude[k] = Math.sqrt(re * re + im * im) / N * 2
    phase[k] = Math.atan2(im, re)
    frequency[k] = (k * fs) / N
  }
  return { magnitude, phase, frequency }
}

export function butterworth(data: number[], cutoff: number, fs: number, order: number, type: 'low' | 'high' = 'low'): number[] {
  // Cascaded biquad sections, applied forward then backward (filtfilt)
  const wc = Math.tan((Math.PI * cutoff) / fs)
  const sections: { b0: number; b1: number; b2: number; a1: number; a2: number }[] = []
  const numSections = Math.ceil(order / 2)
  for (let i = 0; i < numSections; i++) {
    const theta = (Math.PI * (2 * i + 1)) / (2 * order)
    const d = 2 * Math.sin(theta)
    const k = wc * wc
    const norm = 1 + d * wc + k
    if (type === 'low') {
      sections.push({
        b0: k / norm, b1: 2 * k / norm, b2: k / norm,
        a1: (2 * (k - 1)) / norm, a2: (1 - d * wc + k) / norm,
      })
    } else {
      sections.push({
        b0: 1 / norm, b1: -2 / norm, b2: 1 / norm,
        a1: (2 * (k - 1)) / norm, a2: (1 - d * wc + k) / norm,
      })
    }
  }
  const applyBiquad = (input: number[], s: typeof sections[0]): number[] => {
    const out = new Array(input.length).fill(0)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let n = 0; n < input.length; n++) {
      const y = s.b0 * input[n] + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2
      out[n] = y
      x2 = x1; x1 = input[n]; y2 = y1; y1 = y
    }
    return out
  }
  let y = [...data]
  for (const s of sections) y = applyBiquad(y, s)
  // Reverse, filter again, reverse (filtfilt)
  y.reverse()
  for (const s of sections) y = applyBiquad(y, s)
  y.reverse()
  return y
}

export function findPeaks(data: number[], minHeight?: number, minDistance: number = 1): { indices: number[]; heights: number[] } {
  const indices: number[] = []
  const heights: number[] = []
  for (let i = 1; i < data.length - 1; i++) {
    if (data[i] > data[i - 1] && data[i] > data[i + 1]) {
      if (minHeight !== undefined && data[i] < minHeight) continue
      if (indices.length && i - indices[indices.length - 1] < minDistance) {
        if (data[i] > heights[heights.length - 1]) {
          indices[indices.length - 1] = i
          heights[heights.length - 1] = data[i]
        }
        continue
      }
      indices.push(i)
      heights.push(data[i])
    }
  }
  return { indices, heights }
}

export function movingAverage(data: number[], window: number): number[] {
  const out = new Array(data.length).fill(0)
  const half = Math.floor(window / 2)
  for (let i = 0; i < data.length; i++) {
    let s = 0, c = 0
    for (let j = -half; j <= half; j++) {
      const idx = i + j
      if (idx >= 0 && idx < data.length) { s += data[idx]; c++ }
    }
    out[i] = s / c
  }
  return out
}

export function welchPSD(data: number[], fs: number, segLen?: number): { frequency: number[]; power: number[] } {
  const seg = segLen || Math.min(256, Math.floor(data.length / 4))
  const overlap = Math.floor(seg / 2)
  const window = new Array(seg).fill(0).map((_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (seg - 1))))
  const winNorm = window.reduce((s, v) => s + v * v, 0)
  const numSegs = Math.floor((data.length - overlap) / (seg - overlap))
  const psd = new Array(Math.floor(seg / 2)).fill(0)
  for (let s = 0; s < numSegs; s++) {
    const start = s * (seg - overlap)
    const segment = data.slice(start, start + seg).map((v, i) => v * window[i])
    if (segment.length < seg) break
    const { magnitude } = fft(segment, fs)
    for (let k = 0; k < magnitude.length; k++) {
      psd[k] += (magnitude[k] * seg / 2) ** 2 / (winNorm * fs)
    }
  }
  for (let k = 0; k < psd.length; k++) psd[k] /= numSegs
  const frequency = new Array(psd.length).fill(0).map((_, k) => (k * fs) / seg)
  return { frequency, power: psd }
}

export function bandpassFilter(data: number[], fs: number, lowHz: number, highHz: number): number[] {
  const high = butterworth(data, highHz, fs, 4, 'low')
  return butterworth(high, lowHz, fs, 4, 'high')
}

/* ── ODE Solver (RK4) ────────────────────────────────────────────────── */
export function ode45(
  f: (t: number, y: number[]) => number[],
  tSpan: [number, number],
  y0: number[],
  steps: number = 500
): { t: number[]; y: number[][] } {
  const [t0, tf] = tSpan
  const h = (tf - t0) / steps
  const t: number[] = new Array(steps + 1)
  const y: number[][] = new Array(steps + 1)
  t[0] = t0; y[0] = [...y0]
  for (let i = 0; i < steps; i++) {
    const ti = t[i], yi = y[i]
    const k1 = f(ti, yi)
    const k2 = f(ti + h / 2, yi.map((v, j) => v + (h / 2) * k1[j]))
    const k3 = f(ti + h / 2, yi.map((v, j) => v + (h / 2) * k2[j]))
    const k4 = f(ti + h, yi.map((v, j) => v + h * k3[j]))
    y[i + 1] = yi.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]))
    t[i + 1] = ti + h
  }
  return { t, y }
}

/* ── Curve Fitting ───────────────────────────────────────────────────── */
export function polyfit(x: number[], y: number[], degree: number): number[] {
  const n = x.length, m = degree + 1
  // Build Vandermonde matrix
  const V: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    for (let j = 0; j < m; j++) row.push(Math.pow(x[i], j))
    V.push(row)
  }
  // Normal equations: V^T V c = V^T y
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < m; i++) {
    A.push(new Array(m).fill(0))
    let bi = 0
    for (let j = 0; j < m; j++) {
      let sum = 0
      for (let k = 0; k < n; k++) sum += V[k][i] * V[k][j]
      A[i][j] = sum
    }
    for (let k = 0; k < n; k++) bi += V[k][i] * y[k]
    b.push(bi)
  }
  // Gaussian elimination
  for (let i = 0; i < m; i++) {
    let maxRow = i
    for (let k = i + 1; k < m; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k
    }
    ;[A[i], A[maxRow]] = [A[maxRow], A[i]]
    ;[b[i], b[maxRow]] = [b[maxRow], b[i]]
    for (let k = i + 1; k < m; k++) {
      const factor = A[k][i] / (A[i][i] + 1e-12)
      for (let j = i; j < m; j++) A[k][j] -= factor * A[i][j]
      b[k] -= factor * b[i]
    }
  }
  const c = new Array(m).fill(0)
  for (let i = m - 1; i >= 0; i--) {
    let s = b[i]
    for (let j = i + 1; j < m; j++) s -= A[i][j] * c[j]
    c[i] = s / (A[i][i] + 1e-12)
  }
  return c
}

export function polyval(coeffs: number[], x: number): number {
  // Horner's method
  let r = 0
  for (let i = coeffs.length - 1; i >= 0; i--) r = r * x + coeffs[i]
  return r
}

/* ── Clustering & Dimensionality Reduction ───────────────────────────── */
export function kmeans(data: number[][], k: number, maxIter: number = 100): { centroids: number[][]; labels: number[] } {
  const n = data.length, d = data[0].length
  // random init
  const centroids: number[][] = []
  const used = new Set<number>()
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * n)
    if (!used.has(idx)) { used.add(idx); centroids.push([...data[idx]]) }
  }
  const labels = new Array(n).fill(0)
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false
    // assign
    for (let i = 0; i < n; i++) {
      let bestK = 0, bestDist = Infinity
      for (let c = 0; c < k; c++) {
        let dist = 0
        for (let j = 0; j < d; j++) dist += (data[i][j] - centroids[c][j]) ** 2
        if (dist < bestDist) { bestDist = dist; bestK = c }
      }
      if (labels[i] !== bestK) { labels[i] = bestK; changed = true }
    }
    if (!changed) break
    // update
    for (let c = 0; c < k; c++) {
      const members = data.filter((_, i) => labels[i] === c)
      if (members.length === 0) continue
      for (let j = 0; j < d; j++) {
        centroids[c][j] = members.reduce((s, m) => s + m[j], 0) / members.length
      }
    }
  }
  return { centroids, labels }
}

export function pca(data: number[][], nComponents: number = 2): { components: number[][]; eigenvalues: number[]; explained: number[] } {
  const n = data.length, d = data[0].length
  // Center
  const means = new Array(d).fill(0)
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) means[j] += data[i][j] / n
  const X = data.map(row => row.map((v, j) => v - means[j]))
  // Covariance matrix
  const C: number[][] = Array.from({ length: d }, () => new Array(d).fill(0))
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      let s = 0
      for (let k = 0; k < n; k++) s += X[k][i] * X[k][j]
      C[i][j] = s / (n - 1)
    }
  }
  // Power iteration for top eigenvectors
  const components: number[][] = []
  const eigenvalues: number[] = []
  const Cwork = C.map(row => [...row])
  for (let comp = 0; comp < nComponents; comp++) {
    let v = new Array(d).fill(0).map(() => Math.random() - 0.5)
    let lambda = 0
    for (let iter = 0; iter < 200; iter++) {
      const Cv = new Array(d).fill(0)
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) Cv[i] += Cwork[i][j] * v[j]
      const norm = Math.sqrt(Cv.reduce((s, x) => s + x * x, 0)) + 1e-12
      v = Cv.map(x => x / norm)
      lambda = norm
    }
    components.push(v)
    eigenvalues.push(lambda)
    // Deflate
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) Cwork[i][j] -= lambda * v[i] * v[j]
  }
  const totalVar = C.reduce((s, row, i) => s + row[i], 0)
  const explained = eigenvalues.map(e => e / (totalVar + 1e-12))
  return { components, eigenvalues, explained }
}

/* ── Pharmacokinetics ────────────────────────────────────────────────── */
export function pkOneCompartment(dose: number, volume: number, ke: number, tMax: number): { t: number[]; c: number[] } {
  const C0 = dose / volume
  const t: number[] = []
  const c: number[] = []
  const steps = 200
  for (let i = 0; i <= steps; i++) {
    const ti = (i / steps) * tMax
    t.push(ti)
    c.push(C0 * Math.exp(-ke * ti))
  }
  return { t, c }
}

export function pkOralAbsorption(dose: number, volume: number, ka: number, ke: number, f: number, tMax: number): { t: number[]; c: number[] } {
  const factor = (f * dose * ka) / (volume * (ka - ke + 1e-12))
  const t: number[] = []
  const c: number[] = []
  const steps = 200
  for (let i = 0; i <= steps; i++) {
    const ti = (i / steps) * tMax
    t.push(ti)
    c.push(factor * (Math.exp(-ke * ti) - Math.exp(-ka * ti)))
  }
  return { t, c }
}

export function pkMultipleDosing(
  dose: number, interval: number, nDoses: number, volume: number, ke: number,
  route: 'iv' | 'oral' = 'iv', ka: number = 1, f: number = 1
): { t: number[]; c: number[] } {
  const tMax = interval * nDoses + interval * 2
  const steps = 500
  const t: number[] = []
  const c: number[] = []
  for (let i = 0; i <= steps; i++) {
    const ti = (i / steps) * tMax
    let conc = 0
    for (let n = 0; n < nDoses; n++) {
      const tDose = n * interval
      if (ti < tDose) continue
      const dt = ti - tDose
      if (route === 'iv') {
        conc += (dose / volume) * Math.exp(-ke * dt)
      } else {
        conc += ((f * dose * ka) / (volume * (ka - ke + 1e-12))) * (Math.exp(-ke * dt) - Math.exp(-ka * dt))
      }
    }
    t.push(ti)
    c.push(conc)
  }
  return { t, c }
}

/* ── Survival Analysis ───────────────────────────────────────────────── */
export function kaplanMeier(times: number[], events: (0 | 1)[], groups?: number[]): {
  curves: { time: number; survival: number; nAtRisk: number; group?: number }[][]
  medianSurvival: (number | null)[]
} {
  const groupIds = groups ? Array.from(new Set(groups)).sort((a, b) => a - b) : [0]
  const curves: { time: number; survival: number; nAtRisk: number; group?: number }[][] = []
  const medianSurvival: (number | null)[] = []
  for (const g of groupIds) {
    const idxs = groups
      ? times.map((_, i) => (groups[i] === g ? i : -1)).filter(i => i >= 0)
      : times.map((_, i) => i)
    const data = idxs.map(i => ({ t: times[i], e: events[i] }))
    data.sort((a, b) => a.t - b.t)
    let nAtRisk = data.length
    let survival = 1
    const curve: { time: number; survival: number; nAtRisk: number; group?: number }[] = [
      { time: 0, survival: 1, nAtRisk, group: g },
    ]
    let median: number | null = null
    let i = 0
    while (i < data.length) {
      let j = i
      while (j + 1 < data.length && data[j + 1].t === data[i].t) j++
      const eventCount = data.slice(i, j + 1).filter(d => d.e === 1).length
      if (eventCount > 0) {
        survival *= 1 - eventCount / nAtRisk
        if (median === null && survival <= 0.5) median = data[i].t
      }
      curve.push({ time: data[i].t, survival, nAtRisk, group: g })
      nAtRisk -= j - i + 1
      i = j + 1
    }
    curves.push(curve)
    medianSurvival.push(median)
  }
  return { curves, medianSurvival }
}

/* ── Sample Size & Power ─────────────────────────────────────────────── */
export function sampleSizeCalc(effectSize: number, alpha: number, power: number, testType: string): { n: number; nPerGroup: number; warnings: string[] } {
  const warnings: string[] = []
  if (effectSize < 0.1) warnings.push('Very small effect size — required N may be impractical')
  if (alpha > 0.1) warnings.push('Alpha > 0.1 is non-standard')
  if (power < 0.7) warnings.push('Power < 0.7 may produce unreliable results')
  const zAlpha = invNorm(1 - alpha / 2)
  const zBeta = invNorm(power)
  let nPerGroup: number
  switch (testType) {
    case 'two_sample_t':
    case 'paired_t':
      nPerGroup = Math.ceil(2 * ((zAlpha + zBeta) / effectSize) ** 2)
      break
    case 'one_sample_t':
      nPerGroup = Math.ceil(((zAlpha + zBeta) / effectSize) ** 2)
      break
    case 'chi_square':
      nPerGroup = Math.ceil(((zAlpha + zBeta) / effectSize) ** 2)
      break
    case 'anova':
      nPerGroup = Math.ceil(((zAlpha + zBeta) ** 2) / (effectSize * effectSize))
      break
    default:
      nPerGroup = Math.ceil(2 * ((zAlpha + zBeta) / effectSize) ** 2)
  }
  return { n: nPerGroup * 2, nPerGroup, warnings }
}

/* ── Random Number Generation ────────────────────────────────────────── */
export function randNorm(mean: number = 0, sd: number = 1): number {
  // Box-Muller
  const u1 = Math.random() || 1e-9
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + sd * z
}

export function randExponential(rate: number): number {
  return -Math.log(Math.random() || 1e-9) / rate
}

/* ── Utilities ───────────────────────────────────────────────────────── */
export function buildHistogram(values: number[], bins: number = 20): { bin: string; count: number }[] {
  if (!values.length) return []
  // Single-pass min/max — spreading a large array blows the JS argument
  // stack and is the single most common large-dataset crash path.
  let min = Infinity, max = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  const width = (max - min) / bins || 1
  const counts = new Array(bins).fill(0)
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    const idx = Math.min(bins - 1, Math.floor((v - min) / width))
    counts[idx]++
  }
  return counts.map((c, i) => ({ bin: (min + i * width).toFixed(2), count: c }))
}

export function computeStats(values: number[]): { mean: number; median: number; std: number; ci95: [number, number] } {
  const m = mean(values), s = std(values)
  const me = 1.96 * s / Math.sqrt(values.length || 1)
  return { mean: m, median: median(values), std: s, ci95: [m - me, m + me] }
}

