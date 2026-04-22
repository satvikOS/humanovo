/**
 * Dashboard quick-action wiring — verifies that the Dashboard's
 * empty-state CTAs and nav buttons point at the correct deep-link
 * targets (Compute Lab tab routes, ?new=1 project dialog, etc.) and
 * that Notebook deep-link `?id=` query is honoured.
 */
import { test, expect, Page } from '@playwright/test'

function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

test.describe('Dashboard — quick action bar', () => {
  test('"New Project" button navigates to /projects?new=1 (opens dialog)', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const btn = page.locator('button:has-text("New Project")').first()
    await expect(btn).toBeVisible({ timeout: 4000 })
    await btn.click()
    await page.waitForURL(/\/projects/, { timeout: 4000 })
    // The Project Name input from the dialog should be visible.
    await expect(page.locator('input[placeholder*="BRCA1" i]').first()).toBeVisible({ timeout: 3000 })
  })

  test('"Compute Lab" button navigates to /compute-lab', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const btn = page.locator('button:has-text("Compute Lab")').first()
    await btn.click()
    await page.waitForURL(/\/compute-lab/, { timeout: 4000 })
  })

  test('"Notebook" button navigates to /notebook', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const btn = page.locator('button:has-text("Notebook")').first()
    await btn.click()
    await page.waitForURL(/\/notebook/, { timeout: 4000 })
  })

  test('"Search" quick-action button navigates to /search', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // Scope to the Dashboard header quick-action row. Use exact text
    // match so the locator doesn't pick up other "Search" affordances
    // (sidebar nav, project search input labels, etc.).
    const btn = page.getByRole('button', { name: /^Search$/ }).first()
    await expect(btn).toBeVisible({ timeout: 4000 })
    await btn.click()
    await page.waitForURL(/\/search/, { timeout: 4000 })
  })
})

test.describe('Dashboard — empty-state simulation CTA', () => {
  test('"Run a simulation" empty-state button targets compute-lab Monte Carlo tab', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    // The button only shows when there are no simulations. We just
    // confirm that if it is rendered, it does NOT point at the legacy
    // /simulations path (which drops the ?tab= query on the redirect
    // because <Navigate> doesn't preserve search by default).
    const cta = page.locator('button:has-text("Run a simulation")')
    if (await cta.count()) {
      await cta.first().click()
      await page.waitForTimeout(800)
      expect(page.url()).toMatch(/compute-lab/)
      expect(page.url()).toMatch(/tab=montecarlo/)
    }
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Dashboard — Recent Notebooks deep-link', () => {
  test('clicking a notebook row navigates with ?id= and consumes it', async ({ page }) => {
    // Seed a notebook entry in localStorage so the widget renders a row.
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => {
      const now = new Date().toISOString()
      localStorage.setItem('humanovo-notebook-index', JSON.stringify([
        { id: 'e2e-deeplink-1', title: 'Deep-link test page', tags: ['e2e'], updatedAt: now, createdAt: now },
      ]))
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    const row = page.locator('button:has-text("Deep-link test page")').first()
    if (await row.count()) {
      await row.click()
      await page.waitForURL(/\/notebook/, { timeout: 4000 })
      // Notebook consumes the `?id=` param on mount and cleans it off.
      // We simply confirm the navigation landed on /notebook without the
      // app crashing — consuming the param is verified by URL not having
      // `?id=` after the effect runs.
      await page.waitForTimeout(400)
      expect(page.url()).not.toMatch(/\?id=/)
    }
    // Cleanup to avoid polluting other tests.
    await page.evaluate(() => localStorage.removeItem('humanovo-notebook-index'))
  })

  test('/notebook?id=does-not-exist does not crash; falls back to first page', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/notebook?id=completely-made-up-id-xyz-123')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    // Page should render without a React error boundary trip.
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    // The stale deep-link should be cleaned off the URL.
    await page.waitForTimeout(400)
    expect(page.url()).not.toMatch(/\?id=/)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})
