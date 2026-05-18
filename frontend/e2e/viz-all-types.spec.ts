/**
 * Renders EVERY DataVisualization chart type — one per test, in
 * isolation — and asserts each mounts without hitting either error
 * boundary or throwing a pageerror.
 *
 * Why one-per-test (not the old single-grid fixture): the 17 3D types
 * render on three.js WebGL canvases, and a browser caps simultaneous
 * WebGL contexts at ~16. Seeding all 51 charts on one page lost
 * contexts and produced false failures. One chart per page = a clean,
 * definitive per-type signal, and Playwright reports pass/fail per
 * type natively.
 *
 * Failure signals checked:
 *   - "Something went wrong"          → page-level ErrorBoundary
 *   - "This chart could not be rendered" → Chart3D's ChartErrorBoundary
 *   - any pageerror
 *   - no canvas/SVG painted at all
 */
import { test, expect } from '@playwright/test'

const CHART_TYPES_2D = [
  'bar', 'horizontal_bar', 'grouped_bar', 'stacked_bar', 'stacked_bar_100', 'waterfall',
  'line', 'multi_line', 'step', 'spline', 'stem',
  'area', 'stacked_area', 'stream', 'band',
  'pie', 'donut', 'radial_bar', 'polar_area',
  'scatter', 'bubble',
  'radar', 'funnel', 'treemap',
  'histogram', 'box_plot', 'violin', 'density',
  'error_bar', 'heatmap',
  'sankey', 'candlestick',
] as const

const CHART_TYPES_3D = [
  'scatter_3d', 'bubble_3d', 'line_3d', 'bar_3d',
  'surface_3d', 'wireframe_3d', 'contour_3d', 'trisurf_3d',
  'quiver_3d', 'isosurface_3d', 'voxel_3d', 'streamline_3d',
  'slice_3d', 'stem_3d', 'waterfall_3d', 'ribbon_3d', 'pie_3d',
] as const

const IS_3D = new Set<string>(CHART_TYPES_3D)
const ALL_TYPES = [...CHART_TYPES_2D, ...CHART_TYPES_3D]

// One deterministic dataset that populates every field any chart type
// reads — 2D (label/value/value2/value3/category/error/size) AND 3D
// (x/y/z/vx/vy/vz). No Math.random so screenshots are reproducible.
const DATA = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2
  const baseline = 50 + 30 * Math.sin(angle)
  return {
    label: `Q${i + 1}`,
    value: Math.round(baseline + 3),
    value2: Math.round(baseline * 0.7 + 2),
    value3: Math.round(baseline * 0.4 + 1),
    category: i < 4 ? 'Cohort A' : i < 8 ? 'Cohort B' : 'Cohort C',
    errorPlus: 3 + (i % 3),
    errorMinus: 2 + (i % 2),
    size: 5 + (i % 5),
    x: +(Math.cos(angle) * 4).toFixed(3),
    y: +(Math.sin(angle) * 4).toFixed(3),
    z: +(baseline / 18).toFixed(3),
    vx: +(Math.cos(angle) * 0.5).toFixed(3),
    vy: +(Math.sin(angle) * 0.5).toFixed(3),
    vz: 0.4,
  }
})

const DEFAULT_OPTIONS = {
  color: 'var(--color-text-secondary)', colorPalette: 'okabe_ito',
  xLabel: 'Time (Q)', yLabel: 'Value', showGrid: true, showLegend: true,
  legendPosition: 'bottom', logScaleX: false, logScaleY: false,
  lineWidth: 2, markerSize: 4, markerShape: 'circle', fillOpacity: 0.4,
  showValues: false, animate: false, barGap: 4, innerRadius: 60,
  startAngle: 90, smooth: true, showBrush: false, showCrosshair: true,
  trendLine: 'none', showStats: false, pubTheme: 'paper', fontScale: 'normal',
  aspect: 'free', tickFormatX: 'auto', tickFormatY: 'auto', tickCountX: 0,
  tickCountY: 0, decimalPlaces: 2, showTitle: true, showCaption: false,
  showCI: false, ciLevel: 0.95, cbSim: 'none', watermark: '',
}

function seedOne(type: string): string {
  return JSON.stringify([{
    id: `cov-${type}`,
    title: type,
    type,
    data: DATA,
    options: { ...DEFAULT_OPTIONS },
    annotations: [],
    createdAt: new Date('2026-01-01').toISOString(),
  }])
}

for (const type of ALL_TYPES) {
  test(`viz renders: ${type}`, async ({ page }) => {
    test.setTimeout(45_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))

    await page.addInitScript((seeded: string) => {
      localStorage.setItem('humanovo-charts', seeded)
    }, seedOne(type))

    await page.goto('/data-visualization', { waitUntil: 'domcontentloaded' })
    // recharts (SVG) + three.js (WebGL) both mount asynchronously.
    await page.waitForTimeout(4000)

    await page.screenshot({ path: `test-results/viz/${type}.png`, fullPage: true })

    const pageBoundary = await page.locator('text=Something went wrong').count()
    const chartBoundary = await page.locator('text=This chart could not be rendered').count()

    expect(errors, `pageerror while rendering "${type}"`).toEqual([])
    expect(pageBoundary, `"${type}" hit the page error boundary`).toBe(0)
    expect(chartBoundary, `"${type}" hit the chart error boundary`).toBe(0)
    // 3D types always mount a three.js WebGL <canvas>; assert it's there.
    // 2D types render heterogeneously (recharts SVG, custom SVG, or a
    // <div> grid for heatmap) — there is no universal surface selector,
    // so the crash/error signals above are the automated gate and the
    // per-type screenshot saved above is the visual check.
    if (IS_3D.has(type)) {
      const canvases = await page.locator('canvas').count()
      expect(canvases, `"${type}" painted no 3D canvas`).toBeGreaterThan(0)
    }
  })
}
