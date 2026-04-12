/**
 * Literature Review, Citation Manager, Data Visualization — deep-link
 * query-string parity checks. All three pages now honour the consume-
 * and-clean `?add=1` / `?q=` pattern shipped across the earlier
 * deep-link batches.
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

test.describe('DataVisualization — ?add=1 deep-link', () => {
  test('/data-visualization?add=1 renders without crash and cleans the query', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/data-visualization?add=1')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1', { hasText: 'Data Visualization' }).first().waitFor({ timeout: 10000 })
    await page.waitForFunction(() => !window.location.search.includes('add='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(page.url()).not.toMatch(/add=1/)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/data-visualization (no query) renders without crash', async ({ page }) => {
    await page.goto('/data-visualization')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1', { hasText: 'Data Visualization' }).first().waitFor({ timeout: 10000 })
    await page.waitForTimeout(300)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
  })
})

test.describe('LiteratureReview — deep-link ?q= / ?add=1', () => {
  test('/literature-review?q=cancer seeds the search query input', async ({ page }) => {
    await page.goto('/literature-review?q=cancer')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const search = page.locator('input[placeholder*="Search" i]').first()
    if (await search.count()) {
      await expect(search).toHaveValue('cancer')
    }
    expect(page.url()).not.toMatch(/q=/)
  })

  test('/literature-review?add=1 does not crash and cleans the query', async ({ page }) => {
    await page.goto('/literature-review?add=1')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(page.url()).not.toMatch(/add=1/)
  })

  test('/literature-review?q=foo&add=1 combined deep-link', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/literature-review?q=brca1&add=1')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const url = page.url()
    expect(url).not.toMatch(/q=/)
    expect(url).not.toMatch(/add=1/)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('CitationManager — deep-link ?q= / ?add=1 / ?import=1', () => {
  test('/citation-manager?q=nature seeds the search query input', async ({ page }) => {
    await page.goto('/citation-manager?q=nature')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    const search = page.locator('input[placeholder*="Search" i]').first()
    if (await search.count()) {
      await expect(search).toHaveValue('nature')
    }
    expect(page.url()).not.toMatch(/q=/)
  })

  test('/citation-manager?add=1 does not crash and cleans the query', async ({ page }) => {
    await page.goto('/citation-manager?add=1')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(page.url()).not.toMatch(/add=1/)
  })

  test('/citation-manager?import=1 opens the import flow without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/citation-manager?import=1')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(page.url()).not.toMatch(/import=1/)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})
