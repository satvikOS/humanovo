/**
 * Full-catalog DataVisualization smoke test.
 *
 * Iterates every chart type exposed in the picker, loads its sample
 * dataset via the "Load Sample" affordance, submits the Create form,
 * and verifies that a non-empty chart renders (SVG/canvas child has
 * actual bounding-box area). This catches regressions where a chart
 * type silently renders an empty scene — which is exactly what
 * happened with our first cut of the advanced 3D types.
 */
import { test, expect, Page } from '/opt/node22/lib/node_modules/playwright/test.mjs'

// All chart type labels as they appear in the GlassSelect dropdown.
// Keep this in sync with CHART_TYPES in DataVisualization.tsx — the
// spec will fail loudly if a label is missing, which is the signal to
// refresh the list below.
const CHART_LABELS: string[] = [
  // Bars
  'Bar', 'Horizontal Bar', 'Grouped Bar', 'Stacked Bar', 'Stacked Bar (100%)', 'Waterfall',
  // Lines
  'Line', 'Multi-Line', 'Step', 'Spline (Smooth)', 'Stem (Lollipop)',
  // Areas
  'Area', 'Stacked Area', 'Streamgraph', 'Band / Range',
  // Circular
  'Pie', 'Donut', 'Radial Bar', 'Polar Area', 'Radar / Spider',
  // Scatter
  'Scatter', 'Bubble',
  // 3D
  '3D Scatter', '3D Bubble', '3D Line', '3D Bar',
  '3D Surface', '3D Wireframe', '3D Contour',
  '3D Tri-Surface', '3D Quiver (Vectors)', '3D Isosurface',
  '3D Voxel', '3D Streamline', '3D Slice',
  '3D Stem', '3D Waterfall', '3D Ribbon', '3D Pie',
  // Statistical
  'Histogram', 'Box Plot', 'Violin Plot', 'Density / KDE', 'Error Bars', 'Candlestick',
  // Other
  'Heatmap', 'Funnel', 'Treemap',
]

async function clearCharts(page: Page) {
  await page.evaluate(() => {
    try { localStorage.removeItem('charts') } catch {}
  })
}

async function openCreateModal(page: Page) {
  // Page-level CTA.
  await page.locator('button:has-text("Create Visualization")').first().click()
  // Wait until the modal heading "Create Visualization" (inside
  // an h2) is visible.
  await expect(page.locator('h2:has-text("Create Visualization")')).toBeVisible({ timeout: 5000 })
}

async function pickChartType(page: Page, label: string) {
  // The chart-type GlassSelect is a button with the current label
  // visible. The modal contains two GlassSelects (Chart Type, Color
  // Palette). We locate the chart-type picker by its surrounding
  // "Chart Type" label.
  const typeLabel = page.locator('label:has-text("Chart Type")').first()
  await typeLabel.scrollIntoViewIfNeeded()
  // Walk down to the button sibling inside the wrapping <div>.
  const selectBtn = typeLabel.locator('xpath=following-sibling::*[1]//button').first()
  await selectBtn.click()
  // Options in an open dropdown. Use exact label match within the
  // dropdown region. Each option is a <button> whose visible text is
  // the label.
  const option = page.locator('button', { hasText: new RegExp(`^${escapeRegex(label)}$`) }).last()
  await option.click()
  await page.waitForTimeout(80)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loadSample(page: Page) {
  const btn = page.getByRole('button', { name: /load sample/i })
  await btn.click()
  await page.waitForTimeout(80)
}

async function submit(page: Page) {
  // The modal footer has a "Create Visualization" button (submit).
  // The header also has one — target the LAST match since the modal
  // overlays the header button.
  const btn = page.locator('button:has-text("Create Visualization")').last()
  await btn.click()
}

async function chartHasVisibleContent(page: Page): Promise<boolean> {
  // Wait up to 6s for the rendered chart container to be populated with
  // either an SVG (Recharts / raw SVG) or a canvas / plotly div.
  const t0 = Date.now()
  while (Date.now() - t0 < 6000) {
    const info = await page.evaluate(() => {
      // First chart card on the page.
      const container = document.querySelector('[class*="chart-card"], [data-chart-id], .js-plotly-plot, svg, canvas')
      // Prefer a chart-rendering subtree — fallback to any svg/canvas.
      const targets = Array.from(document.querySelectorAll('.js-plotly-plot, svg, canvas'))
      const seen: Array<{ tag: string; w: number; h: number }> = []
      for (const el of targets) {
        const b = (el as HTMLElement).getBoundingClientRect()
        seen.push({ tag: el.tagName.toLowerCase(), w: Math.round(b.width), h: Math.round(b.height) })
      }
      return { hasContainer: !!container, seen }
    })
    // Accept if any rendered target has meaningful size.
    const big = info.seen.find(s => s.w >= 200 && s.h >= 120)
    if (big) return true
    await page.waitForTimeout(200)
  }
  return false
}

test.describe('Data Visualization — full chart catalogue', () => {
  test.setTimeout(180_000)

  for (const label of CHART_LABELS) {
    test(`chart type: ${label} renders a visible sample`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message))
      page.on('console', m => {
        if (m.type() !== 'error') return
        const t = m.text()
        // Ignore known backend/proxy noise — we're not running the API.
        if (/500|407|ECONNREFUSED|Failed to load resource/i.test(t)) return
        consoleErrors.push('CONSOLE: ' + t)
      })

      await page.goto('/data-visualization')
      await page.waitForLoadState('domcontentloaded')
      await clearCharts(page)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(300)

      await openCreateModal(page)
      await pickChartType(page, label)

      // Make sure the picker closed.
      await page.keyboard.press('Escape').catch(() => {})

      // Fill title.
      const titleInput = page.locator('input[placeholder*="Tumor Growth"]').first()
      await titleInput.fill(`E2E ${label}`)

      await loadSample(page)
      await submit(page)

      // Wait for modal dismissal.
      await page.waitForTimeout(400)

      const ok = await chartHasVisibleContent(page)
      expect(ok, `"${label}" produced no visible chart`).toBe(true)

      // No JS errors.
      expect(consoleErrors, `errors during "${label}":\n${consoleErrors.join('\n')}`)
        .toEqual([])
    })
  }
})
