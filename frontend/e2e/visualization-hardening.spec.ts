/**
 * Data Visualization hardening — Stage 3 page #11 of
 * PATH_TO_100_PERCENT.md.
 */

import { expect, test } from '@playwright/test'

test.describe('Data Visualization — hardening worked example', () => {
  test('page mounts; chart-creation UI is reachable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/data-visualization')
    await page.waitForLoadState('domcontentloaded')

    // The page exposes a Create Visualization heading + a primary
    // CTA. Asserting the heading covers the page-mount; the smoke
    // suite's clickable-audit covers the buttons.
    await expect(
      page.getByRole('heading', { name: /Visualization|Create.*Chart|Data Visualization/i }).first(),
    ).toBeVisible({ timeout: 8_000 })

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })
})
