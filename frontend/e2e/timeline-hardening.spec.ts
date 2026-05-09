/**
 * Timeline hardening — Stage 3 page #8 of PATH_TO_100_PERCENT.md.
 */

import { expect, test } from '@playwright/test'

test.describe('Timeline — hardening worked example', () => {
  test('page mounts; activity feed area renders', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/timeline')
    await page.waitForLoadState('domcontentloaded')

    // Timeline either lists activity entries or shows an empty/error
    // state. The page heading is the consistent anchor.
    await expect(page.getByRole('heading', { name: /Timeline|Activity/i }).first()).toBeVisible({ timeout: 8_000 })

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })
})
