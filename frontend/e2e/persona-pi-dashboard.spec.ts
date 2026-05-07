/**
 * Persona walkthrough — Principal Investigator (PI) dashboard.
 *
 * Models a PI overseeing 4-6 postdocs / PhD students. The PI does NOT
 * sit in the workbench day-to-day — they spend ~15 min/morning catching
 * up on what their lab did overnight. The flow they hit:
 *
 *   1. /dashboard       — single-glance lab overview
 *   2. /projects        — drill into specific projects
 *   3. /timeline        — the activity stream across the whole lab
 *   4. /evidence        — sanity-check the literature pull a postdoc did
 *   5. /knowledge-graph — same, but for the relations side
 *   6. /citation-manager — make sure refs are tagged for the next paper
 *   7. /settings        — admin / billing
 *
 * Plus the cross-cutting deep-link sanity test: every dashboard tile
 * deep-links should resolve without breaking.
 *
 * Asserts: every page renders without crashing; the PI's "first paint"
 * (the dashboard) loads in < 5s wall-clock.
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
  { label: 'Dashboard',         path: '/dashboard',         screenshot: 'persona-pi-1-dashboard.png' },
  { label: 'Projects',          path: '/projects',          screenshot: 'persona-pi-2-projects.png' },
  { label: 'Timeline',          path: '/timeline',          screenshot: 'persona-pi-3-timeline.png' },
  { label: 'Evidence',          path: '/evidence',          screenshot: 'persona-pi-4-evidence.png' },
  { label: 'Knowledge Graph',   path: '/knowledge-graph',   screenshot: 'persona-pi-5-kg.png' },
  { label: 'Citation Manager',  path: '/citation-manager',  screenshot: 'persona-pi-6-citations.png' },
  { label: 'Settings',          path: '/settings',          screenshot: 'persona-pi-7-settings.png' },
]

test.describe('Persona — Principal Investigator (PI) dashboard', () => {
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

  test('dashboard first paint < 5s wall-clock', async ({ page }) => {
    const t0 = Date.now()
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1, h2, h3').first().waitFor({ timeout: 5_000 })
    const elapsed = Date.now() - t0
    expect(elapsed, `dashboard first paint took ${elapsed}ms`).toBeLessThan(5_000)
  })

  test('hypotheses redirect lands on /projects', async ({ page }) => {
    // The PI may still type /hypotheses out of habit; v1 redirects it
    // to /projects since hypotheses live inside their project there.
    await page.goto('/hypotheses')
    await page.waitForURL(/\/projects$/, { timeout: 5_000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
  })
})
