/**
 * Literature hardening — Stage 3 page #9 of PATH_TO_100_PERCENT.md.
 */

import { expect, test } from '@playwright/test'

test.describe('Literature — hardening worked example', () => {
  test('page mounts; add-paper or import path is reachable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/literature-review')
    await page.waitForLoadState('domcontentloaded')

    // Page either shows the import flow or the saved-list view. Assert
    // a primary action is visible (covers both paths).
    const anyAction = await page.getByRole('button', { name: /Add|Import|New|Save/i }).count()
    expect(anyAction).toBeGreaterThan(0)

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })
})
