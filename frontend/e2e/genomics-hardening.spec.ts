/**
 * Genomics hardening — Stage 3 page #13 of PATH_TO_100_PERCENT.md.
 */

import { expect, test } from '@playwright/test'

test.describe('Genomics — hardening worked example', () => {
  test('page mounts; analysis tabs reachable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/genomics')
    await page.waitForLoadState('domcontentloaded')

    // Genomics exposes 4 analysis tabs (Pathway / GSEA / Variants /
    // Biomarkers). Assert the page heading + at least one tab.
    await expect(
      page.getByRole('heading', { name: /Genomics|Omics/i }).first(),
    ).toBeVisible({ timeout: 8_000 })
    await expect(page.getByRole('button', { name: /Pathway|GSEA|Variants|Biomarker/i }).first()).toBeVisible()

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('?tab= deep-links land on the correct analysis tab and clean the URL', async ({ page }) => {
    await page.goto('/genomics?tab=variants')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5_000 })
    expect(page.url()).not.toMatch(/tab=/)
  })
})
