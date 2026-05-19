/**
 * Capture a screenshot of each Compute Lab tab (with its default run
 * executed) so the current visual state can be assessed for the
 * publication-quality pass. Diagnostic spec — not a hard gate.
 */
import { test } from '@playwright/test'

const TABS = ['workstation', 'montecarlo', 'equations'] as const

for (const tab of TABS) {
  test(`compute-lab shot: ${tab}`, async ({ page }) => {
    test.setTimeout(70_000)
    await page.setViewportSize({ width: 1680, height: 1020 })
    await page.goto(`/compute-lab?tab=${tab}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    // Best-effort: trigger the panel's default Run/Plot so a figure shows.
    const runBtn = page.getByRole('button', { name: /^(Run|Plot|Run script)$/i }).first()
    if (await runBtn.count() > 0) {
      try { await runBtn.click({ timeout: 3000 }) } catch { /* no-op */ }
    }
    await page.waitForTimeout(5000)
    await page.screenshot({ path: `test-results/compute/${tab}.png`, fullPage: true })
  })
}
