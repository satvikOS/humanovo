/**
 * Search → Evidence / Agents navigation + Search filter deep-link.
 * Verifies that clicking a search result passes an `?id=…` /
 * `?hypothesis=…` query the destination page can honour, and that
 * `/search?type=…` pre-selects the Type filter.
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

test.describe('Evidence — ?id= deep-link (from Search results)', () => {
  test('/evidence?id=some-evidence-id renders without crash and consumes the query', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/evidence?id=test-nonexistent-evidence-id')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    // Page should NOT have tripped the error boundary.
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    // The `?id=` query should be cleaned off the URL after mount.
    expect(page.url()).not.toMatch(/\?id=/)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Agents — ?hypothesis= deep-link (from Search results)', () => {
  test('/agents?hypothesis=some-id renders without crash and consumes the query', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/agents?hypothesis=test-nonexistent-hypothesis-id')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(page.url()).not.toMatch(/\?hypothesis=/)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/agents?disease=X&hypothesis=Y consumes both params', async ({ page }) => {
    await page.goto('/agents?disease=Glioma&hypothesis=test-id')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    await expect(page.locator('input[placeholder*="Pancreatic" i]').first()).toHaveValue(/Glioma/i)
    const url = page.url()
    expect(url).not.toMatch(/disease=/)
    expect(url).not.toMatch(/hypothesis=/)
  })
})

test.describe('Search — ?type= filter deep-link', () => {
  test('/search?type=evidence pre-selects the Evidence filter chip', async ({ page }) => {
    await page.goto('/search?type=evidence')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // The Filters sidebar is open by default; "Evidence" chip should be
    // visible inside it.
    await expect(page.locator('button:has-text("Evidence")').first()).toBeVisible()
  })

  test('/search?type=bogus falls back to All Types default', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/search?type=not-a-real-filter')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/search?q=foo&type=hypothesis combined deep-link', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/search?q=cancer&type=hypothesis')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    // Query input should have the `q=` text.
    const input = page.locator('input[placeholder*="Search evidence" i]').first()
    await expect(input).toHaveValue('cancer')
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})
