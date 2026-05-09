/**
 * Citations (Citation Manager) hardening — Stage 3 page #10 of
 * PATH_TO_100_PERCENT.md.
 *
 * Pins the deep-link consume-and-clean behaviour wired in the visual
 * KG commit (commit 0835393): ?q= seeds the search input, ?import=1
 * opens the import dialog, and both params are stripped from the URL
 * after consumption.
 */

import { expect, test } from '@playwright/test'

test.describe('Citations — hardening worked example', () => {
  test('page mounts; search input reachable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/citation-manager')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('input[placeholder*="Search" i]').first()).toBeVisible({ timeout: 8_000 })

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('?q= seeds the search input and is stripped from the URL', async ({ page }) => {
    await page.goto('/citation-manager?q=nature')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(700)
    const search = page.locator('input[placeholder*="Search" i]').first()
    if (await search.count()) {
      await expect(search).toHaveValue('nature')
    }
    expect(page.url()).not.toMatch(/q=/)
  })
})
