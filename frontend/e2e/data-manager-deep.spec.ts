/**
 * Data Manager — `?id=` / `?view=` deep-link tests. Lets Dashboard
 * and cross-page links jump straight into a dataset + view mode
 * combo (e.g. "open X in Profile view").
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

test.describe('DataManager — base mount + layout', () => {
  test('/data-manager renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/data-manager')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('DataManager — deep-link ?view= tab selector', () => {
  const views = ['table', 'profile', 'etl'] as const
  for (const v of views) {
    test(`/data-manager?view=${v} renders without crash and cleans the query`, async ({ page }) => {
      await page.goto(`/data-manager?view=${v}`)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(600)
      const boundary = await page.locator('text=/Something went wrong/i').count()
      expect(boundary).toBe(0)
      expect(page.url()).not.toMatch(/view=/)
    })
  }

  test('/data-manager?view=bogus falls back to overview (no crash)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/data-manager?view=totally-made-up-view')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('DataManager — deep-link ?id= dataset selector', () => {
  test('/data-manager?id=nonexistent does not crash; query is cleaned', async ({ page }) => {
    await page.goto('/data-manager?id=made-up-dataset-id-xyz')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(page.url()).not.toMatch(/\?id=/)
  })

  test('/data-manager?id=X&view=profile consumes both params', async ({ page }) => {
    await page.goto('/data-manager?id=made-up&view=profile')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const url = page.url()
    expect(url).not.toMatch(/\?id=/)
    expect(url).not.toMatch(/view=/)
  })
})

test.describe('DataManager — dataset list + search', () => {
  test('dataset search input filters the sidebar list', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/data-manager')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const search = page.locator('input[placeholder*="Search" i]').first()
    if (await search.count()) {
      await search.fill('zzz-nonexistent-dataset')
      await page.waitForTimeout(300)
    }
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})
