/**
 * Renders every supported chart type in DataVisualization and asserts
 * each one mounts without crashing the React error boundary or
 * throwing a `pageerror`.
 *
 * Why: the page supports 50+ chart types. Each one is its own render
 * branch in the giant `renderChartSwitch()`. A field-rename in
 * recharts or a missing field on DataPoint silently breaks one type
 * and you only find out when a user reports it. This spec exercises
 * the full grid in one pass and reports per-type pass/fail.
 *
 * Mechanism: seed localStorage with one ChartConfig per type using a
 * uniform test dataset that populates every optional DataPoint field
 * (value2/value3 for multi-series, errorPlus/errorMinus for error
 * bars, size for bubbles, etc.). Then navigate and assert. Charts
 * are rendered into one big grid; we don't need to scroll because
 * the spec only cares about render-time crashes, not layout.
 */

import { test, expect } from '@playwright/test'

// All chart types declared in DataVisualization.tsx's `ChartType`.
// Kept in sync by hand — if you add a new type there, add it here.
const CHART_TYPES_2D = [
  // Bars
  'bar', 'horizontal_bar', 'grouped_bar', 'stacked_bar', 'stacked_bar_100', 'waterfall',
  // Lines
  'line', 'multi_line', 'step', 'spline', 'stem',
  // Areas
  'area', 'stacked_area', 'stream', 'band',
  // Circular
  'pie', 'donut', 'radial_bar', 'polar_area',
  // Scatter
  'scatter', 'bubble',
  // Other 2D
  'radar', 'funnel', 'treemap',
  'histogram', 'box_plot', 'violin', 'density',
  'error_bar', 'heatmap',
  // Specialty 2D
  'sankey', 'candlestick',
] as const

const CHART_TYPES_3D = [
  'scatter_3d', 'bubble_3d', 'line_3d', 'bar_3d',
  'surface_3d', 'wireframe_3d', 'contour_3d', 'trisurf_3d',
  'quiver_3d', 'isosurface_3d', 'voxel_3d', 'streamline_3d',
  'slice_3d', 'stem_3d', 'waterfall_3d', 'ribbon_3d', 'pie_3d',
] as const

const CHART_TYPES = [...CHART_TYPES_2D, ...CHART_TYPES_3D] as const

const DATA = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2
  const baseline = 50 + 30 * Math.sin(angle)
  return {
    label: `Q${i + 1}`,
    value: Math.round(baseline + Math.random() * 5),
    value2: Math.round(baseline * 0.7 + Math.random() * 5),
    value3: Math.round(baseline * 0.4 + Math.random() * 5),
    category: i < 4 ? 'Cohort A' : i < 8 ? 'Cohort B' : 'Cohort C',
    errorPlus: 3 + (i % 3),
    errorMinus: 2 + (i % 2),
    size: 5 + (i % 5),
  }
})

const DEFAULT_OPTIONS = {
  color: 'var(--color-text-secondary)',
  colorPalette: 'okabe_ito',
  xLabel: 'Time (Q)',
  yLabel: 'Value',
  showGrid: true,
  showLegend: true,
  legendPosition: 'bottom',
  logScaleX: false,
  logScaleY: false,
  lineWidth: 2,
  markerSize: 4,
  markerShape: 'circle',
  fillOpacity: 0.4,
  showValues: false,
  animate: false, // tests want deterministic snapshots
  barGap: 4,
  innerRadius: 60,
  startAngle: 90,
  smooth: true,
  showBrush: false,
  showCrosshair: true,
  trendLine: 'none',
  showStats: false,
  pubTheme: 'paper',
  fontScale: 'normal',
  aspect: 'free',
  tickFormatX: 'auto',
  tickFormatY: 'auto',
  tickCountX: 0,
  tickCountY: 0,
  decimalPlaces: 2,
  showTitle: true,
  showCaption: false,
  showCI: false,
  ciLevel: 0.95,
  cbSim: 'none',
  watermark: '',
}

function seedCharts() {
  const charts = CHART_TYPES.map((type) => ({
    id: `coverage-${type}`,
    title: `${type}`,
    type,
    data: DATA,
    options: { ...DEFAULT_OPTIONS },
    annotations: [],
    createdAt: new Date().toISOString(),
  }))
  return JSON.stringify(charts)
}

test('every chart type renders without crash', async ({ page }) => {
  // This fixture seeds ALL 51 chart types (34 recharts 2D + 17
  // Plotly WebGL 3D) into one grid — far past any real user's page.
  // Mounting 17 simultaneous WebGL contexts plus 34 SVG charts
  // legitimately needs more than the 30s suite default; the
  // page.locator().count() coverage loop below was timing out
  // purely on main-thread saturation, not a render bug. Give the
  // test 2 minutes — proportional to the deliberately-extreme
  // fixture.
  test.setTimeout(120_000)
  // Larger viewport so the fullPage screenshot resolves enough
  // detail per chart to spot typography / overlap issues — at the
  // default 1280px the grid only fits 2 charts wide and they shrink
  // unreadably small.
  await page.setViewportSize({ width: 1920, height: 1080 })
  const pageErrors: { type: string; err: string }[] = []
  page.on('pageerror', (err) => {
    pageErrors.push({ type: 'global', err: `${err.name}: ${err.message}` })
  })

  // Seed before navigation so the initial render reads our charts.
  // Key is `humanovo-charts` because persistence.ts prefixes every
  // key with `humanovo-` (verified at src/utils/persistence.ts:8).
  await page.addInitScript((seeded: string) => {
    localStorage.setItem('humanovo-charts', seeded)
  }, seedCharts())

  await page.goto('/data-visualization', { waitUntil: 'domcontentloaded' })
  // Recharts + Plotly render asynchronously. With 51 charts (17 of
  // them WebGL) a 3s beat wasn't enough — the count loop ran while
  // the page was still mid-mount and main-thread-bound. 8s lets the
  // bulk of the grid settle so the queries below don't fight an
  // actively-rendering page.
  await page.waitForTimeout(8000)

  // The page renders one card per chart with its title visible. If a
  // chart's render branch throws, ErrorBoundary swaps the card for a
  // "Something went wrong" panel. Use that as the per-type signal.
  const boundaryCount = await page.locator('text=Something went wrong').count()

  // If any pageerror fired, attribute it best-effort to the type by
  // looking at the stack — they include the chunk URL, but for now we
  // just report all errors and let the developer correlate with the
  // boundary count.
  const failed: string[] = []
  for (const t of CHART_TYPES) {
    const titleHits = await page.locator(`h3:has-text("${t}")`).count()
    if (titleHits === 0) failed.push(t)
  }

  // Print per-type pass/fail before asserting so the developer sees
  // the full report on a failed run, not just the first failure.
  console.log('=== chart-type coverage ===')
  for (const t of CHART_TYPES) {
    const titleHits = await page.locator(`h3:has-text("${t}")`).count()
    const status = titleHits > 0 ? 'OK' : 'MISSING'
    console.log(`  [${status}] ${t}`)
  }
  console.log(`\nboundary panels: ${boundaryCount}, missing types: ${failed.length}, page errors: ${pageErrors.length}`)
  if (pageErrors.length) {
    console.log('\npage errors:')
    for (const e of pageErrors) console.log(`  ${e.err}`)
  }

  expect(boundaryCount, 'no chart should hit the error boundary').toBe(0)
  expect(failed, `chart types missing from render: ${failed.join(', ')}`).toEqual([])
  expect(pageErrors, `pageerrors fired during render`).toHaveLength(0)

  // Per-type screenshot grid — useful for eyeballing journal-grade
  // typography and CB-safe palette application across all 49 types.
  // Saved next to the spec so a future run can diff against the
  // committed baseline once the visual surface stabilises.
  await page.screenshot({
    path: 'test-results/viz-all-types-grid.png',
    fullPage: true,
  })
})
