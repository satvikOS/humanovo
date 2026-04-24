// DiagnosticPlots — regression / model diagnostic visualizations.
//
// Each component renders one diagnostic at the publication-grade
// quality bar (muted palette, themeable axes, exportable via the
// surrounding PublicationFigure wrapper). They expect `points` of
// fitted-vs-observed pairs from any regression solver and compute
// residuals / quantiles client-side, so the underlying compute
// engine (computeEngine.ts → regress) doesn't have to change shape.
//
// Renderers:
//   * QQPlot      — sample quantiles vs theoretical normal quantiles
//   * ResidualPlot — residuals vs fitted values + smoother
//   * LeveragePlot — Cook's distance / leverage scatter
//   * PhasePortrait — 2D state-space trajectory (ODE solver output)
//
// All use Recharts for SVG output (vector-perfect PDF/SVG export
// via the PublicationFigure wrapper).
import {
  LineChart, Line, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { getPalette, makeTickFormatter, type TickFormat } from '../utils/publicationTheme'

// ── Statistics helpers (kept inline so this file is self-contained) ──

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let s = 0; for (const v of xs) s += v
  return s / xs.length
}

function stdDev(xs: number[]): number {
  const m = mean(xs)
  let s = 0
  for (const v of xs) s += (v - m) ** 2
  return Math.sqrt(s / Math.max(1, xs.length - 1))
}

// Beasley-Springer-Moro inverse normal CDF — accurate enough for
// Q-Q plot quantile placement without pulling in a stats lib.
function invNormCdf(p: number): number {
  // Clamp into open interval to avoid ±∞ at the extremes.
  p = Math.max(1e-7, Math.min(1 - 1e-7, p))
  const a = [-3.969683028665376e+01,  2.209460984245205e+02,
             -2.759285104469687e+02,  1.383577518672690e+02,
             -3.066479806614716e+01,  2.506628277459239e+00]
  const b = [-5.447609879822406e+01,  1.615858368580409e+02,
             -1.556989798598866e+02,  6.680131188771972e+01,
             -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
              4.374664141464968e+00,  2.938163982698783e+00]
  const d = [ 7.784695709041462e-03,  3.224671290700398e-01,
              2.445134137142996e+00,  3.754408661907416e+00]
  const pLow = 0.02425
  const pHigh = 1 - pLow
  let q: number, r: number
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
           ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1)
  } else if (p <= pHigh) {
    q = p - 0.5
    r = q * q
    return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5]) * q /
           (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1)
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
            ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1)
  }
}

// ── Common chart styling helpers ──

interface CommonProps {
  height?: number
  axisColor?: string
  gridColor?: string
  mutedColor?: string
  fontFamily?: string
  palette?: string
  tickFormat?: TickFormat
  decimals?: number
}

function useTickStyle({ mutedColor = 'var(--color-text-muted)', fontFamily = "'Inter', system-ui, sans-serif" }: CommonProps) {
  return { fontSize: 10, fill: mutedColor, fontFamily }
}

// ─────────────────────────────────────────────────────────────────
// Q-Q PLOT  — sample quantiles vs theoretical normal quantiles.
// Use for residual normality assessment.
// ─────────────────────────────────────────────────────────────────

export interface QQPlotProps extends CommonProps {
  values: number[]   // typically residuals from a regression
  xLabel?: string
  yLabel?: string
}

export function QQPlot(props: QQPlotProps) {
  const {
    values, height = 280,
    axisColor = 'var(--color-text-muted)',
    gridColor = 'var(--color-border)',
    palette = 'default',
    tickFormat = 'auto',
    decimals = 2,
    xLabel = 'Theoretical quantiles (z)',
    yLabel = 'Sample quantiles',
  } = props
  const colors = getPalette(palette)
  const tickStyle = useTickStyle(props)
  const fmt = makeTickFormatter(tickFormat, decimals)

  // Sort residuals + standardize so theoretical line is y = x.
  const m = mean(values)
  const sd = stdDev(values) || 1
  const std = values.map(v => (v - m) / sd).sort((a, b) => a - b)
  const n = std.length
  const data = std.map((s, i) => {
    // Use Filliben's plotting position for the i-th order statistic
    // — better tail behavior than (i+1)/(n+1).
    let p: number
    if (i === 0) p = 1 - Math.pow(0.5, 1 / n)
    else if (i === n - 1) p = Math.pow(0.5, 1 / n)
    else p = (i + 1 - 0.3175) / (n + 0.365)
    return { theoretical: invNormCdf(p), sample: s }
  })
  // Build the y = x reference line endpoints.
  if (data.length === 0) return <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>No data</div>
  const minQ = Math.min(data[0].theoretical, data[0].sample)
  const maxQ = Math.max(data[n - 1].theoretical, data[n - 1].sample)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="theoretical" name={xLabel} tick={tickStyle} stroke={axisColor} tickFormatter={fmt}
          label={{ value: xLabel, position: 'insideBottom', offset: -8, style: tickStyle }} domain={[minQ, maxQ]} />
        <YAxis type="number" dataKey="sample" name={yLabel} tick={tickStyle} stroke={axisColor} tickFormatter={fmt}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', style: tickStyle }} domain={[minQ, maxQ]} />
        <Tooltip cursor={{ stroke: gridColor }} contentStyle={{ background: 'var(--color-surface-solid)', border: `1px solid ${gridColor}`, fontSize: 11 }} formatter={fmt} />
        {/* y = x reference */}
        <ReferenceLine segment={[{ x: minQ, y: minQ }, { x: maxQ, y: maxQ }]} stroke={colors[5] || colors[0]} strokeDasharray="4 4" strokeWidth={1.25} />
        <Scatter name="Residuals" fill={colors[0]} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────────────────────────
// RESIDUAL PLOT  — residuals vs fitted values + LOWESS-ish smoother.
// ─────────────────────────────────────────────────────────────────

export interface ResidualPlotProps extends CommonProps {
  fitted: number[]
  residuals: number[]
  xLabel?: string
  yLabel?: string
  showSmoother?: boolean
}

export function ResidualPlot(props: ResidualPlotProps) {
  const {
    fitted, residuals, height = 280,
    axisColor = 'var(--color-text-muted)',
    gridColor = 'var(--color-border)',
    palette = 'default',
    tickFormat = 'auto',
    decimals = 2,
    xLabel = 'Fitted values',
    yLabel = 'Residuals',
    showSmoother = true,
  } = props
  const colors = getPalette(palette)
  const tickStyle = useTickStyle(props)
  const fmt = makeTickFormatter(tickFormat, decimals)
  if (fitted.length !== residuals.length || fitted.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>Residual / fitted length mismatch</div>
  }
  const data = fitted.map((f, i) => ({ fitted: f, residual: residuals[i] }))
  // Simple binned-mean smoother (10 bins) — a true LOWESS would
  // need the locfit or d3-regression package; binned mean is a
  // reasonable visual proxy for trend in residuals.
  let smoother: { fitted: number; smooth: number }[] = []
  if (showSmoother && data.length > 10) {
    const sorted = [...data].sort((a, b) => a.fitted - b.fitted)
    const bins = 10
    const binSize = Math.ceil(sorted.length / bins)
    smoother = []
    for (let b = 0; b < bins; b++) {
      const slice = sorted.slice(b * binSize, (b + 1) * binSize)
      if (slice.length === 0) continue
      const xMid = slice.reduce((s, p) => s + p.fitted, 0) / slice.length
      const yMid = slice.reduce((s, p) => s + p.residual, 0) / slice.length
      smoother.push({ fitted: xMid, smooth: yMid })
    }
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="fitted" tick={tickStyle} stroke={axisColor} tickFormatter={fmt}
          label={{ value: xLabel, position: 'insideBottom', offset: -8, style: tickStyle }} />
        <YAxis type="number" dataKey="residual" tick={tickStyle} stroke={axisColor} tickFormatter={fmt}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', style: tickStyle }} />
        <Tooltip cursor={{ stroke: gridColor }} contentStyle={{ background: 'var(--color-surface-solid)', border: `1px solid ${gridColor}`, fontSize: 11 }} formatter={fmt} />
        <ReferenceLine y={0} stroke={colors[5] || colors[0]} strokeDasharray="4 4" />
        <Scatter name="Residuals" fill={colors[0]} fillOpacity={0.6} />
        {showSmoother && smoother.length > 0 && (
          // Plot smoother as a line via second Scatter trace with a line
          // rendered between adjacent points (Recharts trick).
          <Scatter name="Trend" data={smoother as any} fill={colors[3] || colors[1]} line={{ stroke: colors[3] || colors[1], strokeWidth: 2 }} shape="circle" />
        )}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────────────────────────
// LEVERAGE / COOK'S DISTANCE PLOT
// ─────────────────────────────────────────────────────────────────

export interface LeveragePlotProps extends CommonProps {
  leverages: number[]
  cooksD: number[]
  // Threshold for Cook's distance — typically 4/n.
  threshold?: number
  xLabel?: string
  yLabel?: string
}

export function LeveragePlot(props: LeveragePlotProps) {
  const {
    leverages, cooksD, height = 280,
    axisColor = 'var(--color-text-muted)',
    gridColor = 'var(--color-border)',
    palette = 'default',
    tickFormat = 'auto',
    decimals = 2,
    threshold,
    xLabel = 'Leverage (h)',
    yLabel = "Cook's distance",
  } = props
  const colors = getPalette(palette)
  const tickStyle = useTickStyle(props)
  const fmt = makeTickFormatter(tickFormat, decimals)
  const data = leverages.map((h, i) => ({ leverage: h, cooks: cooksD[i] ?? 0, idx: i }))
  const cookThresh = threshold ?? (4 / Math.max(1, data.length))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="leverage" tick={tickStyle} stroke={axisColor} tickFormatter={fmt}
          label={{ value: xLabel, position: 'insideBottom', offset: -8, style: tickStyle }} />
        <YAxis type="number" dataKey="cooks" tick={tickStyle} stroke={axisColor} tickFormatter={fmt}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', style: tickStyle }} />
        <Tooltip cursor={{ stroke: gridColor }} contentStyle={{ background: 'var(--color-surface-solid)', border: `1px solid ${gridColor}`, fontSize: 11 }} formatter={fmt} />
        <ReferenceLine y={cookThresh} stroke={colors[5] || colors[0]} strokeDasharray="4 4"
          label={{ value: `4/n = ${cookThresh.toFixed(3)}`, position: 'right', style: tickStyle }} />
        <Scatter name="Observations" fill={colors[0]} fillOpacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────────────────────────
// PHASE PORTRAIT  — 2D state-space trajectory for ODE/PDE output.
// ─────────────────────────────────────────────────────────────────

export interface PhasePortraitProps extends CommonProps {
  xs: number[]
  ys: number[]
  // Optional fixed-point markers (equilibria) to annotate.
  fixedPoints?: { x: number; y: number; label?: string }[]
  // Render arrows along the trajectory at intervals.
  showArrows?: boolean
  xLabel?: string
  yLabel?: string
}

export function PhasePortrait(props: PhasePortraitProps) {
  const {
    xs, ys, height = 320,
    axisColor = 'var(--color-text-muted)',
    gridColor = 'var(--color-border)',
    palette = 'default',
    tickFormat = 'auto',
    decimals = 2,
    fixedPoints,
    xLabel = 'x₁',
    yLabel = 'x₂',
  } = props
  const colors = getPalette(palette)
  const tickStyle = useTickStyle(props)
  const fmt = makeTickFormatter(tickFormat, decimals)
  if (xs.length !== ys.length || xs.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>Empty trajectory</div>
  }
  const data = xs.map((x, i) => ({ x, y: ys[i] }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="x" tick={tickStyle} stroke={axisColor} tickFormatter={fmt}
          label={{ value: xLabel, position: 'insideBottom', offset: -8, style: tickStyle }} />
        <YAxis type="number" dataKey="y" tick={tickStyle} stroke={axisColor} tickFormatter={fmt}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', style: tickStyle }} />
        <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: `1px solid ${gridColor}`, fontSize: 11 }} formatter={fmt} />
        <Line type="monotone" dataKey="y" stroke={colors[0]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        {fixedPoints?.map((p, i) => (
          <ReferenceLine
            key={i}
            segment={[{ x: p.x, y: p.y }, { x: p.x, y: p.y }]}
            stroke={colors[5] || colors[1]}
            label={{ value: p.label || `eq${i + 1}`, position: 'top', style: tickStyle }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────────────────────────
// Compute residuals + leverages + Cook's D from a simple regression.
// Convenience helper so call sites can feed `regress()` output
// directly into the diagnostic plots without writing the math twice.
// ─────────────────────────────────────────────────────────────────

export interface RegressionDiagnostics {
  fitted: number[]
  residuals: number[]
  leverages: number[]
  cooksD: number[]
  rmse: number
  n: number
}

export function computeRegressionDiagnostics(
  x: number[], y: number[], slope: number, intercept: number,
): RegressionDiagnostics {
  const n = x.length
  const fitted = x.map(v => slope * v + intercept)
  const residuals = y.map((v, i) => v - fitted[i])
  const ssRes = residuals.reduce((s, r) => s + r * r, 0)
  const sigma2 = ssRes / Math.max(1, n - 2)
  const rmse = Math.sqrt(sigma2)
  // Hat matrix diagonal for simple linear regression:
  //   h_ii = 1/n + (x_i - mean(x))^2 / Σ(x_j - mean(x))^2
  const xMean = x.reduce((s, v) => s + v, 0) / Math.max(1, n)
  const sxx = x.reduce((s, v) => s + (v - xMean) ** 2, 0) || 1
  const leverages = x.map(v => 1 / n + (v - xMean) ** 2 / sxx)
  // Cook's distance with p=2 (slope + intercept):
  //   D_i = (r_i^2 / (p * sigma^2)) * (h_ii / (1 - h_ii)^2)
  const cooksD = residuals.map((r, i) => {
    const h = leverages[i]
    const denom = 2 * sigma2 * (1 - h) ** 2 || 1
    return (r * r / denom) * h
  })
  return { fitted, residuals, leverages, cooksD, rmse, n }
}
