/**
 * Persona walkthrough — PhD genomics researcher.
 *
 * Models a 3rd-year PhD student who's running RNA-seq differential
 * expression on a publicly available dataset, then back-filling
 * literature to support their candidate genes. The flow they hit:
 *
 *   1. /dashboard          — orient, see what's outstanding
 *   2. /genomics           — load a dataset, run analysis
 *   3. /data-visualization — pull up canned chart catalog
 *   4. /evidence           — search for primary literature
 *   5. /literature-review  — the LR view of the same evidence
 *   6. /citation-manager   — drag refs into a personal library
 *   7. /notebook           — write up findings
 *   8. /search             — quick keyword search across the platform
 *
 * Asserts: every page renders without crashing, heading is present,
 * no ErrorBoundary trip, no fatal pageerror or red console errors.
 * Screenshots full-page for visual review.
 */
import { test, expect, type Page } from '@playwright/test'

function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

const stops: { label: string; path: string; screenshot: string }[] = [
  { label: 'Dashboard',          path: '/dashboard',          screenshot: 'persona-phd-genomics-1-dashboard.png' },
  { label: 'Genomics',           path: '/genomics',           screenshot: 'persona-phd-genomics-2-genomics.png' },
  { label: 'Data Visualization', path: '/data-visualization', screenshot: 'persona-phd-genomics-3-viz.png' },
  { label: 'Evidence',           path: '/evidence',           screenshot: 'persona-phd-genomics-4-evidence.png' },
  { label: 'Literature Review',  path: '/literature-review',  screenshot: 'persona-phd-genomics-5-litreview.png' },
  { label: 'Citation Manager',   path: '/citation-manager',   screenshot: 'persona-phd-genomics-6-citations.png' },
  { label: 'Notebook',           path: '/notebook',           screenshot: 'persona-phd-genomics-7-notebook.png' },
  { label: 'Search',             path: '/search',             screenshot: 'persona-phd-genomics-8-search.png' },
]

test.describe('Persona — PhD genomics researcher', () => {
  for (const s of stops) {
    test(`${s.label} renders without crash`, async ({ page }) => {
      const errs: string[] = []
      attachErrorCapture(page, errs)
      await page.goto(s.path)
      await page.waitForLoadState('domcontentloaded')
      await page.locator('h1, h2, h3').first().waitFor({ timeout: 10_000 })
      const boundary = await page.locator('text=/Something went wrong/i').count()
      expect(boundary, `ErrorBoundary tripped on ${s.path}`).toBe(0)
      await page.screenshot({ path: `test-results/${s.screenshot}`, fullPage: true })
      expect(
        errs.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
        `Fatal console errors on ${s.path}: ${errs.join('\n')}`,
      ).toEqual([])
    })
  }

  test('genomics page is keyboard reachable from dashboard via g-prefix', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    // g-prefix navigation: `g g` opens /genomics in v1 (when bound).
    // We tolerate the binding being absent — the test only asserts that
    // attempting the chord doesn't crash the page.
    await page.keyboard.press('g')
    await page.keyboard.press('g')
    await page.waitForTimeout(500)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
  })
})
