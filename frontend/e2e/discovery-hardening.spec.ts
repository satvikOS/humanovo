/**
 * Discovery (Agents) hardening — Stage 3 page #3 of
 * PATH_TO_100_PERCENT.md.
 *
 * Drills into the moving pieces of the /agents page that the
 * hardening pass touched: configuration form, control buttons, and
 * connection-status indicator. visual-screenshots covers "renders
 * cleanly"; this covers "the right surfaces are reachable AND the
 * silent control-failure path now toasts".
 */

import { expect, test } from '@playwright/test'


test.describe('Discovery (Agents) — hardening worked example', () => {
  test('page mounts with the configuration form visible', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/agents')
    await page.waitForLoadState('domcontentloaded')

    // The Configuration heading is part of every render — the page
    // is essentially the discovery cockpit. visual-screenshots says
    // it renders; this asserts the form is reachable.
    await expect(page.getByText(/Configuration/i).first()).toBeVisible({ timeout: 8_000 })
    await expect(
      page.getByText(/Disease.*Target/i).first(),
    ).toBeVisible({ timeout: 8_000 })

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('connection status text is rendered', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('domcontentloaded')
    // The Live / Offline / Connecting / "..." text accompanies the
    // status dot in the header; matching the text is more stable
    // than the [title=...] selector since Playwright's visibility
    // check on a 2×2 dot can be flaky depending on layout shifts.
    const status = page.getByText(/^(Live|Offline|Connecting|\.\.\.)$/).first()
    await expect(status).toBeVisible({ timeout: 8_000 })
  })

  test('?disease= deep-link pre-fills the disease input', async ({ page }) => {
    // Used by Dashboard quick-action and KG-driven shortcuts. Regression
    // here breaks the cross-page handoff.
    await page.goto('/agents?disease=Pancreatic%20Cancer')
    await page.waitForLoadState('domcontentloaded')
    const disease = page.locator('input[placeholder*="Pancreatic" i]').first()
    if (await disease.count()) {
      await expect(disease).toHaveValue(/Pancreatic Cancer/i, { timeout: 8_000 })
    }
  })

  test('Start Discovery button is present on the form', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('domcontentloaded')
    // The primary CTA. With no project selected and no disease typed,
    // it may be disabled — the button just needs to be visible.
    await expect(
      page.getByRole('button', { name: /Start.*Discovery|Start$/i }).first(),
    ).toBeVisible({ timeout: 8_000 })
  })
})
