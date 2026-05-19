/**
 * End-to-end chart-render verification — runs INSIDE the packaged
 * humanovo Tauri desktop app (WebView2), not a browser.
 *
 * Why this lives here and not in frontend/e2e/: the chart-render bugs
 * being chased are WebView2-specific. A normal Playwright/Chromium run
 * renders all ~50 chart types fine; only WebView2 trips. This harness
 * is the only way to verify them.
 *
 * What it does:
 *   1. Launches the app and logs in via E2E_EMAIL / E2E_PASSWORD.
 *   2. Seeds one chart per type into localStorage, opens Data
 *      Visualization, and for EACH of the ~50 types:
 *        - screenshots the chart card  → screenshots/<type>.png
 *        - asserts it rendered (no error boundary; non-empty
 *          canvas/svg).
 *   3. Prints a pass/fail summary table.
 *   4. Spot-checks Compute Lab figure output + the Knowledge Graph
 *      page render.
 */

import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { CHART_TYPES } from '../lib/chart-types.js'
import {
  login,
  goto,
  seedAllChartsAndOpenViz,
  chartCard,
  checkChartRendered,
  type ChartCheck,
} from '../lib/app.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = resolve(__dirname, '..', 'screenshots')

describe('humanovo desktop — Data Visualization chart catalog', () => {
  const results: ChartCheck[] = []

  before(async () => {
    mkdirSync(SHOT_DIR, { recursive: true })
    // The window starts at 1440x900; bump it so the chart grid has
    // room and screenshots resolve enough detail.
    await browser.setWindowSize(1600, 1000).catch(() => {
      /* some WebView2 builds reject resize — non-fatal */
    })
    await login()
    await seedAllChartsAndOpenViz()
    // Recharts + Plotly render asynchronously. ~50 charts, 17 of them
    // WebGL contexts, legitimately need time on a single main thread.
    await browser.pause(12_000)
  })

  // One `it` per chart type so the spec reporter shows a green/red
  // line per type and a single failing chart doesn't mask the rest.
  for (const ct of CHART_TYPES) {
    it(`renders "${ct.label}" (${ct.value})`, async () => {
      // Scroll the card into view so the WebGL canvas actually paints
      // and the screenshot captures real pixels.
      try {
        const card = await chartCard(ct.value)
        await card.scrollIntoView({ block: 'center' })
        await browser.pause(ct.is3d ? 1200 : 400)
        await card.saveScreenshot(resolve(SHOT_DIR, `${ct.value}.png`))
      } catch {
        // card lookup / screenshot failed — checkChartRendered records it
      }

      const check = await checkChartRendered(ct.value, ct.is3d)
      results.push(check)

      if (!check.rendered) {
        throw new Error(
          `chart "${ct.value}" did not render — ${check.reason}`,
        )
      }
    })
  }

  after(() => {
    // Pass/fail summary — printed even when individual `it`s failed.
    const pass = results.filter((r) => r.rendered)
    const fail = results.filter((r) => !r.rendered)
    /* eslint-disable no-console */
    console.log('\n=== chart render summary ===')
    for (const r of results) {
      const tag = r.rendered ? 'PASS' : 'FAIL'
      console.log(`  [${tag}] ${r.type}${r.rendered ? '' : ' — ' + r.reason}`)
    }
    console.log(
      `\n  ${pass.length}/${results.length} rendered` +
        (fail.length ? `  (FAILED: ${fail.map((f) => f.type).join(', ')})` : ''),
    )
    console.log(`  screenshots → ${SHOT_DIR}\n`)
    /* eslint-enable no-console */
  })
})

describe('humanovo desktop — spot checks', () => {
  it('Compute Lab equation plotter produces a figure', async () => {
    // ?tab=equations opens the Equation Plotter panel directly.
    await goto('/compute-lab?tab=equations')
    await browser.pause(2500) // lazy panel bundle + editor mount

    // The plotter exposes a Run/Plot button; clicking it should
    // produce a chart (svg or canvas) in the plot region.
    const runBtn = await $(
      '//button[normalize-space()="Run" or normalize-space()="Plot"]',
    )
    await runBtn.waitForDisplayed({ timeout: 20_000 })
    await runBtn.click()
    await browser.pause(2500) // figure paint

    const plot = await $('svg, canvas')
    await plot.waitForExist({ timeout: 20_000 })

    const box = await plot.getSize()
    if (!box || box.width < 2 || box.height < 2) {
      throw new Error(`Compute Lab figure has zero size (${box?.width}x${box?.height})`)
    }

    // No error-boundary fallback should be on the page.
    const body = await $('body')
    const text = await body.getText()
    if (/could not be rendered/i.test(text)) {
      throw new Error('Compute Lab figure tripped the chart error boundary')
    }

    await mkdirSyncSafe(SHOT_DIR)
    await browser.saveScreenshot(resolve(SHOT_DIR, '_compute-lab.png'))
  })

  it('Knowledge Graph page renders', async () => {
    await goto('/knowledge-graph')
    await browser.pause(3000) // lazy page + cytoscape mount

    const heading = await $('h1*=Knowledge Graph')
    await heading.waitForDisplayed({ timeout: 20_000 })

    // Cytoscape draws into <canvas>; force-graph 3D into a WebGL
    // <canvas>. Either way a <canvas> should exist once the graph
    // mounts. (If the page shows an empty-state instead, the canvas
    // may be absent — so this is a soft check that at minimum the
    // page chrome rendered with no error boundary.)
    const body = await $('body')
    const text = await body.getText()
    if (/could not be rendered|something went wrong/i.test(text)) {
      throw new Error('Knowledge Graph page hit an error boundary')
    }

    await mkdirSyncSafe(SHOT_DIR)
    await browser.saveScreenshot(resolve(SHOT_DIR, '_knowledge-graph.png'))
  })
})

/** mkdir -p that never throws (idempotent). */
async function mkdirSyncSafe(dir: string): Promise<void> {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* already exists */
  }
}
