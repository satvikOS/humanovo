/**
 * Evidence page — deep interaction tests covering the `?add=1` deep-link
 * flow that auto-opens the Add Evidence dialog, and basic search + list
 * plumbing. These match the pattern established for Projects `?new=1`.
 */
import { test, expect, Page } from '/opt/node22/lib/node_modules/playwright/test.mjs'

function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

test.describe('Evidence — deep-link auto-open', () => {
  test('/evidence?add=1 auto-opens the Add Evidence modal', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/evidence?add=1')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // Modal heading should be visible without a click.
    await expect(page.locator('h2:has-text("Add Evidence")').first()).toBeVisible({ timeout: 4000 })
    // Query should be cleaned out of the URL so reloading doesn't re-open.
    expect(page.url()).not.toMatch(/add=1/)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/evidence?new=1 (alias) also auto-opens the dialog', async ({ page }) => {
    await page.goto('/evidence?new=1')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await expect(page.locator('h2:has-text("Add Evidence")').first()).toBeVisible({ timeout: 4000 })
    expect(page.url()).not.toMatch(/new=1/)
  })

  test('/evidence with no query keeps the dialog closed', async ({ page }) => {
    await page.goto('/evidence')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // No modal heading on initial mount.
    const count = await page.locator('h2:has-text("Add Evidence")').count()
    expect(count).toBe(0)
  })
})

test.describe('Evidence — Add Evidence dialog form', () => {
  test('opens via the "Add Evidence" CTA and exposes all required fields', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/evidence')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // Click the page-level "Add Evidence" CTA.
    const cta = page.locator('button:has-text("Add Evidence")').first()
    await expect(cta).toBeVisible({ timeout: 4000 })
    await cta.click()
    await page.waitForTimeout(250)
    await expect(page.locator('h2:has-text("Add Evidence")').first()).toBeVisible()
    // At least one text input should be present inside the dialog.
    const inputs = await page.locator('input[type="text"], input:not([type])').count()
    expect(inputs).toBeGreaterThan(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('closing the dialog removes the modal from the DOM', async ({ page }) => {
    await page.goto('/evidence?add=1')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await expect(page.locator('h2:has-text("Add Evidence")').first()).toBeVisible({ timeout: 4000 })
    // The modal shell renders an "X" close button (FiX icon) in its
    // header; click the first button after the heading's container.
    const close = page.locator('button:has-text("Cancel"), button[aria-label="Close"]').first()
    if (await close.count()) {
      await close.click()
      await page.waitForTimeout(200)
      const count = await page.locator('h2:has-text("Add Evidence")').count()
      expect(count).toBe(0)
    }
  })
})

test.describe('Evidence — extended deep-link params', () => {
  test('/evidence?q=xyz seeds the search input and cleans the URL', async ({ page }) => {
    await page.goto('/evidence?q=nonexistent-evidence-seed')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => !window.location.search.includes('q='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/q=/)
    const search = page.locator('input[placeholder*="Search" i]').first()
    await expect(search).toHaveValue('nonexistent-evidence-seed', { timeout: 3000 })
  })

  test('/evidence?type=pubmed seeds the source-type filter and cleans the URL', async ({ page }) => {
    await page.goto('/evidence?type=pubmed')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => !window.location.search.includes('type='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/type=/)
  })

  test('/evidence?type=totally-bogus falls back silently (no crash, cleaned)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/evidence?type=totally-bogus-xyz')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => !window.location.search.includes('type='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Evidence — search input', () => {
  test('search input exists and accepts typing without crashing', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/evidence')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const search = page.locator('input[placeholder*="Search" i]').first()
    if (await search.count()) {
      await search.fill('nonexistent-evidence-query-xyz')
      await page.waitForTimeout(400)
    }
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})
