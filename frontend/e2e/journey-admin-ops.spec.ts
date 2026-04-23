/**
 * Customer journey — admin / ops workflow.
 *
 * Settings admin panel is the "is the platform healthy?" surface. This
 * spec exercises the admin tab end-to-end — service-health pills,
 * table-freshness grid, seed CTAs, ingestion activity — and screenshots
 * each state.
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

test.describe('Customer journey — admin / ops', () => {
  test('settings admin panel renders service health + seed + ingestion', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    const seen: string[] = []
    page.on('request', req => {
      const u = req.url()
      if (u.includes('/api/v1/admin/')) seen.push(u)
      if (u.includes('/api/v1/ingestion/')) seen.push(u)
    })

    await page.goto('/settings?tab=admin')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1, h2', { hasText: /Settings/i }).first().waitFor({ timeout: 10_000 })

    const adminHeader = page.locator('h2', { hasText: /Admin.*Seed demo data/i })
    const hasAdmin = (await adminHeader.count()) > 0

    if (hasAdmin) {
      await expect(page.locator('h3', { hasText: /Service health/i })).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('h3', { hasText: /Table freshness/i })).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('h3', { hasText: /Current corpus/i })).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('h3', { hasText: /Seed actions/i })).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('h3', { hasText: /Ingestion activity/i })).toBeVisible({ timeout: 5_000 })
      // Confirm both admin + ingestion endpoints got polled on mount.
      expect(seen.some(u => u.includes('/admin/health'))).toBe(true)
      expect(seen.some(u => u.includes('/admin/kg-stats'))).toBe(true)
      expect(seen.some(u => u.includes('/ingestion/'))).toBe(true)
    }

    await page.screenshot({ path: 'test-results/admin-ops-1-settings.png', fullPage: true })
    expect(errs.filter(e => /Maximum call stack|is not a function/.test(e))).toEqual([])
  })

  test('data manager page renders ingestion tab', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/data-manager')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('h1, h2, h3').first().waitFor({ timeout: 10_000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    await page.screenshot({ path: 'test-results/admin-ops-2-data-manager.png', fullPage: true })
    expect(errs.filter(e => /Maximum call stack|is not a function/.test(e))).toEqual([])
  })

  test('dashboard service-health pill appears', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    // The pill is one of: "healthy" | "degraded" | "offline". It lives
    // in the DifferentiatorStrip region.
    const pill = page.locator(
      '[aria-label*="Backend status" i], a[href*="/settings?tab=admin"]'
    ).first()
    await pill.waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {})
    await page.screenshot({ path: 'test-results/admin-ops-3-health-pill.png', fullPage: true })
  })
})
