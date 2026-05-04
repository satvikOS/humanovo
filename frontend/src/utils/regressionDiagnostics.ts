/**
 * Regression diagnostics — math helpers used by DiagnosticPlots.
 *
 * Lives outside the components/ tree so React Fast Refresh can do its
 * job: components/*.tsx must export only React components for HMR to
 * work cleanly.
 */

export interface RegressionDiagnostics {
  fitted: number[]
  residuals: number[]
  leverages: number[]
  cooksD: number[]
  rmse: number
  n: number
}

/** Compute residuals + leverages + Cook's D from a simple linear regression.
 *  Convenience helper so callers can feed `regress()` output directly into
 *  the diagnostic plots without writing the math twice. */
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
