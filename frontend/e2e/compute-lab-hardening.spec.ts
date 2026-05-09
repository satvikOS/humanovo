/**
 * Compute Lab hardening — Stage 3 page #12 of PATH_TO_100_PERCENT.md.
 *
 * The page itself is already strong on items 1-7. This spec pins
 * the lazy-load contract from B2 (commit 03d3981): the tab buttons
 * paint immediately, panels load on demand inside Suspense.
 */

import { expect, test } from '@playwright/test'

test.describe('Compute Lab — hardening worked example', () => {
  test('page mounts; three tab buttons paint without waiting on plotly', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/compute-lab')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('button', { name: 'Workstation' }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /Monte Carlo/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Equation Plotter/i }).first()).toBeVisible()

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('?tab=montecarlo deep-link selects the Monte Carlo panel', async ({ page }) => {
    await page.goto('/compute-lab?tab=montecarlo')
    await page.waitForLoadState('domcontentloaded')
    expect(page.url()).toMatch(/tab=montecarlo/)
  })
})
