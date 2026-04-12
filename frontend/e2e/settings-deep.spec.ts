/**
 * Settings — ?tab= deep-link parity with the rest of the platform.
 * Every tab ID (appearance, account, notifications, privacy, data,
 * integrations) should select its section on arrival AND strip the
 * query so a soft reload doesn't pin the section. Bogus values fall
 * back silently to Appearance.
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

test.describe('Settings — ?tab= deep-link', () => {
  const tabs = ['appearance', 'account', 'notifications', 'privacy', 'data', 'integrations'] as const

  test('/settings base renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/settings')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1, h2', { hasText: /Settings/i }).first().waitFor({ timeout: 10000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  for (const t of tabs) {
    test(`/settings?tab=${t} renders and cleans the query`, async ({ page }) => {
      await page.goto(`/settings?tab=${t}`)
      await page.waitForLoadState('domcontentloaded')
      await page.locator('h1, h2', { hasText: /Settings/i }).first().waitFor({ timeout: 10000 })
      await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
      expect(page.url()).not.toMatch(/tab=/)
    })
  }

  test('/settings?tab=totally-bogus falls back silently (no crash)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/settings?tab=totally-bogus-section')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1, h2', { hasText: /Settings/i }).first().waitFor({ timeout: 10000 })
    await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})
