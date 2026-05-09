/**
 * Search hardening — Stage 3 page #7 of PATH_TO_100_PERCENT.md.
 */

import { expect, test } from '@playwright/test'

test.describe('Search — hardening worked example', () => {
  test('page mounts; query input is interactive', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/search')
    await page.waitForLoadState('domcontentloaded')

    const input = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first()
    await expect(input).toBeVisible({ timeout: 8_000 })
    await input.fill('parkinsons')
    await expect(input).toHaveValue('parkinsons')

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('initial mount renders something other than an empty <main>', async ({ page }) => {
    await page.goto('/search')
    await page.waitForLoadState('domcontentloaded')
    // Search has multiple zero-states (Recent / Saved / Suggested /
    // Filters). Asserting any visible button / heading / input on the
    // page ensures it isn't blank, without pinning a specific label
    // that the design might rotate.
    const visibleAnchors = await page.locator(
      'main button, main h1, main h2, main h3, main input',
    ).count()
    expect(visibleAnchors).toBeGreaterThan(0)
  })
})
