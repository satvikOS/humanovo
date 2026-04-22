/**
 * Timeline — deep-link `?type=` / `?range=` filters. Lets Dashboard
 * cards and external cross-links jump into a pre-filtered view.
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

test.describe('Timeline — deep-link filter / range', () => {
  test('/timeline mounts with "All" + "All Time" defaults', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/timeline')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // The range <select> default value should be 'all'.
    const rangeSelect = page.locator('select').first()
    await expect(rangeSelect).toHaveValue('all')
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/timeline?type=hypothesis pre-selects the Hypotheses filter', async ({ page }) => {
    await page.goto('/timeline?type=hypothesis')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    // The "Hypotheses" chip should be highlighted. We can't easily assert
    // the highlight style, but we can assert the query was consumed and
    // the filter chip is visible & clickable.
    await expect(page.locator('button:has-text("Hypotheses")').first()).toBeVisible()
    expect(page.url()).not.toMatch(/type=/)
  })

  test('/timeline?range=week pre-sets the time range select', async ({ page }) => {
    await page.goto('/timeline?range=week')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const rangeSelect = page.locator('select').first()
    await expect(rangeSelect).toHaveValue('week')
    expect(page.url()).not.toMatch(/range=/)
  })

  test('/timeline?type=evidence&range=today consumes both params', async ({ page }) => {
    await page.goto('/timeline?type=evidence&range=today')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const rangeSelect = page.locator('select').first()
    await expect(rangeSelect).toHaveValue('today')
    const url = page.url()
    expect(url).not.toMatch(/type=/)
    expect(url).not.toMatch(/range=/)
  })

  test('/timeline?type=bogus falls back to the All default', async ({ page }) => {
    await page.goto('/timeline?type=totally-not-a-real-filter')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // Should render without crashing; query cleaned off URL.
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(page.url()).not.toMatch(/type=/)
  })

  test('/timeline?range=bogus falls back to All Time', async ({ page }) => {
    await page.goto('/timeline?range=millennia')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const rangeSelect = page.locator('select').first()
    await expect(rangeSelect).toHaveValue('all')
  })
})

test.describe('Timeline — filter chips toggle', () => {
  test('clicking a filter chip updates the selection without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/timeline')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    for (const label of ['Projects', 'Hypotheses', 'Evidence', 'Simulations', 'All']) {
      const chip = page.locator(`button:has-text("${label}")`).first()
      if (await chip.count()) {
        await chip.click()
        await page.waitForTimeout(120)
      }
    }
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Timeline — refresh control', () => {
  test('Refresh button is clickable and does not crash the page', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/timeline')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const refresh = page.locator('button:has-text("Refresh")').first()
    await expect(refresh).toBeVisible({ timeout: 4000 })
    await refresh.click()
    await page.waitForTimeout(300)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})
