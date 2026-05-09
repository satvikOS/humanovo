/**
 * Data Manager hardening — Stage 3 page #14 of PATH_TO_100_PERCENT.md.
 */

import { expect, test } from '@playwright/test'

test.describe('Data Manager — hardening worked example', () => {
  test('page mounts; upload / import primary action reachable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/data-manager')
    await page.waitForLoadState('domcontentloaded')

    // The page surfaces an Upload / Import / Add CTA in the header.
    const action = await page.getByRole('button', { name: /Upload|Import|Add|New/i }).count()
    expect(action).toBeGreaterThan(0)

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })
})
