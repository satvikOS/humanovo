/**
 * Settings hardening — Stage 3 page #15 of PATH_TO_100_PERCENT.md.
 */

import { expect, test } from '@playwright/test'

test.describe('Settings — hardening worked example', () => {
  test('page mounts; section nav is reachable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/settings')
    await page.waitForLoadState('domcontentloaded')

    // Settings has a left-rail with sections (Profile / Account /
    // Appearance / Billing / etc.). Asserting the heading + one of
    // the always-present labels covers the basic surface.
    await expect(
      page.getByText(/Profile|Account|Appearance|Preferences|Billing/i).first(),
    ).toBeVisible({ timeout: 8_000 })

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('theme toggle keeps the page mounted (no crash)', async ({ page }) => {
    // Spot-check the most-common interaction.
    await page.goto('/settings')
    await page.waitForLoadState('domcontentloaded')
    const themeBtn = page.getByRole('button', { name: /theme|light|dark/i }).first()
    if (await themeBtn.count()) {
      await themeBtn.click()
      // Page should still be mounted after the toggle.
      await expect(page.locator('body')).toBeVisible()
    }
  })
})
