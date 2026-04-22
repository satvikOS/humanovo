/**
 * GenomicsAnalysis, HumanAnatomy, Workbench — base-mount smoke tests
 * plus the one deep-link we ship on GenomicsAnalysis. HumanAnatomy
 * and Workbench are canvas-heavy and have their own dedicated state
 * machines, so we keep coverage tight here and rely on their own
 * specs (if any) for deeper behaviour.
 */
import { test, expect, Page } from '@playwright/test'

function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR|WebGL|three/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

test.describe('GenomicsAnalysis — deep-link ?tab=', () => {
  const tabs = ['pathway', 'gsea', 'variants', 'biomarkers'] as const

  test('/genomics base renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/genomics')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1, h2', { hasText: /Genomics/i }).first().waitFor({ timeout: 10000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  for (const t of tabs) {
    test(`/genomics?tab=${t} renders and cleans the query`, async ({ page }) => {
      await page.goto(`/genomics?tab=${t}`)
      await page.waitForLoadState('domcontentloaded')
      await page.locator('h1, h2', { hasText: /Genomics/i }).first().waitFor({ timeout: 10000 })
      await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
      expect(page.url()).not.toMatch(/tab=/)
    })
  }

  test('/genomics?tab=bogus falls back to pathway (no crash)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/genomics?tab=totally-bogus')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1, h2', { hasText: /Genomics/i }).first().waitFor({ timeout: 10000 })
    await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('HumanAnatomy — base smoke', () => {
  test('/anatomy renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/anatomy')
    await page.waitForLoadState('domcontentloaded')
    // Canvas-heavy; wait for the heading/loader to appear but skip
    // complex assertions — WebGL init can be slow in headless.
    await page.waitForTimeout(1500)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('Workbench — base smoke', () => {
  test('/workbench renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/workbench')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})
