/**
 * Smoke test for each Compute Lab tab — verifies clicking the Run /
 * Plot button on the default state produces output, not just paints
 * the panel chrome. Catches regressions where a refactor breaks the
 * computation pipeline silently (the existing compute-lab specs only
 * test tab navigation, not whether the engines actually compute).
 *
 * The tests use the panel's *default* state on first paint so they
 * don't depend on any specific input values — if the user is dropped
 * onto a panel and clicks Run, they should get a numeric / visual
 * result without configuring anything first.
 */

import { test, expect } from '@playwright/test'

test.describe('compute-lab smoke', () => {
  test('Monte Carlo: Run button produces a numeric mean result', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))

    await page.goto('/compute-lab?tab=montecarlo', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500) // panel lazy-load

    // The Run button is the only `button` whose visible text matches
    // "Run" (Auto-run sliders are <input type=checkbox> so they don't
    // collide). Use the role + name for stability against styling.
    const runBtn = page.getByRole('button', { name: /^Run$/ }).first()
    await expect(runBtn, 'Run button should be visible on the MC panel').toBeVisible()
    await runBtn.click()

    // Result appears as either:
    //   - a Mean / Std stat block, OR
    //   - a histogram / convergence chart
    // Wait up to 8 s for *any* numeric result text to appear (the
    // simulation runs ~1 s for the default 10 000 trials).
    const resultRegion = page.locator('text=/Mean|μ|Median|Std/i')
    await expect(resultRegion.first(), 'MC should show a numeric result after Run').toBeVisible({ timeout: 8000 })

    expect(pageErrors, `MC page errors: ${pageErrors.join('; ')}`).toEqual([])
  })

  test('Equation Plotter: ODE run produces a chart', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))

    await page.goto('/compute-lab?tab=equations', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    // The ODE Run button. Plotter has a Plot button at the top and a
    // Run button on the ODE side panel — first matching is fine for
    // smoke; either should produce output.
    const runBtn = page.getByRole('button', { name: /^(Run|Plot)$/i }).first()
    await expect(runBtn, 'Run/Plot button should be visible').toBeVisible()
    await runBtn.click()
    await page.waitForTimeout(1500) // chart paint

    // Chart appears as an SVG / canvas inside the plotter region.
    const plotArea = page.locator('svg, canvas').first()
    await expect(plotArea, 'A plot canvas should be present after Run').toBeVisible()

    expect(pageErrors, `Plotter page errors: ${pageErrors.join('; ')}`).toEqual([])
  })

  test('Workstation: panel mounts without crash on default load', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))

    await page.goto('/compute-lab', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000) // workstation pulls in a 410 KB bundle

    // Workstation has a script editor + Run button. The full Run path
    // hits the in-browser MATLAB-style interpreter which is heavy to
    // exercise from a smoke test; for now we just verify the panel
    // mounts and exposes its Run control. Future test should script-
    // type a basic expression and assert the output.
    const runBtn = page.getByRole('button', { name: /^Run$/ })
    expect(await runBtn.count(), 'Workstation should expose a Run button').toBeGreaterThan(0)

    expect(pageErrors, `Workstation page errors: ${pageErrors.join('; ')}`).toEqual([])
  })
})
