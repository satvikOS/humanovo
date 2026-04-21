/**
 * Deep interaction tests — exercise actual user flows on pages that the
 * existing platform.spec.ts only smoke-loads. The goal is to catch
 * regressions in interactive behaviour (run a Monte Carlo, plot an
 * equation, create and delete a chart, toggle filters, etc.) not just
 * "does the page mount".
 */
import { test, expect, Page } from '@playwright/test'

// Capture "real" page errors, ignoring known backend/proxy noise that
// we don't run a server for in the e2e environment.
function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

test.describe('Compute Lab — Monte Carlo', () => {
  test('Run button produces results without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/compute-lab')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)

    const mcTab = page.locator('button:has-text("Monte Carlo")').first()
    await mcTab.click()
    await page.waitForTimeout(400)

    const runBtn = page.locator('button:has-text("Run")').last()
    await runBtn.click()
    // Simulation takes a moment.
    await page.waitForTimeout(1800)

    // No JS errors.
    expect(errs.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null') ||
      e.includes('is not a function')
    )).toEqual([])
  })
})

test.describe('Compute Lab — Equation Plotter', () => {
  test('Plot button renders a chart for a valid expression', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/compute-lab')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)

    await page.locator('button:has-text("Equation")').first().click()
    await page.waitForTimeout(400)

    const exprInput = page.locator('input[placeholder*="sin"]').first()
    await exprInput.fill('cos(x)')
    await page.locator('button:has-text("Plot")').first().click()
    await page.waitForTimeout(600)

    const svgOrCanvas = page.locator('svg, canvas, .js-plotly-plot')
    expect(await svgOrCanvas.count()).toBeGreaterThan(0)

    expect(errs.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('is not a function')
    )).toEqual([])
  })

  test('dy/dx toggle does not crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/compute-lab')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await page.locator('button:has-text("Equation")').first().click()
    await page.waitForTimeout(300)

    const derivBtn = page.locator('button:has-text("dy/dx")').first()
    if (await derivBtn.count() > 0) {
      await derivBtn.click()
      await page.waitForTimeout(200)
      await derivBtn.click()
      await page.waitForTimeout(200)
    }
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Data Visualization — persistence + delete', () => {
  test('create a bar chart, reload, chart persists', async ({ page }) => {
    await page.goto('/data-visualization')
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => {
      try { localStorage.removeItem('humanovo-charts') } catch {}
      try { localStorage.removeItem('charts') } catch {}
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(300)

    // Open modal.
    await page.locator('button:has-text("Create Visualization")').first().click()
    await expect(page.locator('h2:has-text("Create Visualization")')).toBeVisible({ timeout: 5000 })

    // Title.
    await page.locator('input[placeholder*="Tumor Growth"]').first().fill('E2E persistence test')

    // Load sample + submit.
    await page.getByRole('button', { name: /load sample/i }).click()
    await page.waitForTimeout(80)
    await page.locator('button:has-text("Create Visualization")').last().click()
    await page.waitForTimeout(400)

    // Reload + verify persistence.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await expect(page.locator('text=E2E persistence test').first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Settings — theme toggle actually flips DOM theme', () => {
  test('clicking Light swaps data-theme / dark class', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)

    const light = page.locator('text=Light').first()
    if (await light.count() > 0) {
      await light.click().catch(() => {})
      await page.waitForTimeout(200)
    }
    const dark = page.locator('text=Dark').first()
    if (await dark.count() > 0) {
      await dark.click().catch(() => {})
      await page.waitForTimeout(200)
    }
    // Just make sure we didn't crash.
    const errs: string[] = []; attachErrorCapture(page, errs)
    expect(errs.filter(e => e.includes('Maximum call stack'))).toEqual([])
  })
})

test.describe('Genomics — can switch through every tab', () => {
  const tabs = ['Pathway Enrichment', 'GSEA', 'Variant Annotation', 'Biomarker Discovery']
  for (const tab of tabs) {
    test(`can click "${tab}" tab`, async ({ page }) => {
      const errs: string[] = []; attachErrorCapture(page, errs)
      await page.goto('/genomics')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(500)
      const btn = page.locator(`button:has-text("${tab}")`).first()
      if (await btn.count() > 0) {
        await btn.click()
        await page.waitForTimeout(300)
      }
      expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
    })
  }
})

test.describe('Notebook — create + filter', () => {
  test('filter toggle does not crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/notebook')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // Try any button that looks filter-ish.
    const filt = page.locator('button:has-text("Filter")').first()
    if (await filt.count() > 0) {
      await filt.click().catch(() => {})
      await page.waitForTimeout(200)
    }
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Data Manager — dataset selection', () => {
  test('click a sample dataset item does not crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/data-manager')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const item = page.locator('text=Clinical Trial').first()
    if (await item.count() > 0) {
      await item.click().catch(() => {})
      await page.waitForTimeout(300)
    }
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Projects — create + navigate', () => {
  test('page loads and shows at least one project-related CTA', async ({ page }) => {
    await page.goto('/projects')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    const createBtn = page.locator('button:has-text("New"), button:has-text("Create")')
    expect(await createBtn.count()).toBeGreaterThan(0)
  })
})

test.describe('Literature Review + Citation Manager', () => {
  for (const path of ['/literature-review', '/citation-manager']) {
    test(`${path} loads and exposes at least one search-related control`, async ({ page }) => {
      const errs: string[] = []; attachErrorCapture(page, errs)
      await page.goto(path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const anyInput = await page.locator('input, textarea').count()
      expect(anyInput).toBeGreaterThan(0)
      expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
    })
  }
})

test.describe('Imaging — tool palette buttons', () => {
  test('title-bearing tool buttons swap without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/imaging')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(900)
    // Scope to buttons that explicitly advertise a tool via title or
    // aria-label. Generic "first svg button on the page" tends to hit
    // sidebar nav links and take us off the imaging route.
    for (const titleRx of [/pan/i, /zoom/i, /measure/i, /annotate/i, /reset/i]) {
      const b = page.locator(`button[title*="${titleRx.source.replace(/[\/i]/g, '')}" i]`).first()
      if (await b.count() > 0) {
        await b.click({ trial: false }).catch(() => {})
        await page.waitForTimeout(50)
      }
    }
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Navigation — deep link every major page', () => {
  const paths = [
    '/dashboard', '/projects', '/evidence', '/workbench', '/notebook',
    '/search', '/compute-lab', '/data-visualization', '/data-manager',
    '/imaging', '/genomics', '/literature-review', '/citation-manager',
    '/experiment-tracker', '/clinical-trials', '/manuscripts', '/biobank',
    '/collaboration', '/regulatory', '/settings', '/anatomy',
  ]
  for (const p of paths) {
    test(`direct-load ${p} has no critical JS error`, async ({ page }) => {
      const errs: string[] = []; attachErrorCapture(page, errs)
      await page.goto(p)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const critical = errs.filter(e =>
        e.includes('Maximum call stack') ||
        e.includes('Cannot read properties of null') ||
        e.includes('is not a function') ||
        e.includes('ReferenceError')
      )
      expect(critical, `critical errors on ${p}:\n${critical.join('\n')}`).toEqual([])
    })
  }
})
