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

    const runBtn = page.getByRole('button', { name: /^Run$/ })
    expect(await runBtn.count(), 'Workstation should expose a Run button').toBeGreaterThan(0)

    expect(pageErrors, `Workstation page errors: ${pageErrors.join('; ')}`).toEqual([])
  })

  test('Workstation: typing 1+1 in editor + clicking Run produces 2 in output', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))

    await page.goto('/compute-lab', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500) // workstation lazy bundle + editor mount

    // The script editor is the lone <textarea> on the workstation
    // surface (everything else uses input or contenteditable). Fill
    // with the simplest possible expression that exercises the
    // interpreter: literal addition.
    const editor = page.locator('textarea').first()
    await expect(editor, 'editor textarea should be visible').toBeVisible()
    // Use editor.fill(...) — replaces existing content cleanly. The
    // workstation seeds the editor with a default sample script;
    // overwrite with our trivial expression so the output is
    // deterministic.
    await editor.fill('1 + 1')

    // Click Run.
    const runBtn = page.getByRole('button', { name: /^Run$/ }).first()
    await runBtn.click()
    // Run completes quickly (~5 ms for trivial expressions); give
    // it a beat for state to settle.
    await page.waitForTimeout(500)

    // The result lives in the Results overlay, which doesn't open
    // automatically — Workstation surfaces a "Results ▸" button in
    // the toolbar after a successful run. Click it to expose the
    // console/workspace where the value appears.
    const resultsBtn = page.getByRole('button', { name: /Results ▸|results overlay/i }).first()
    if (await resultsBtn.count() > 0) {
      await resultsBtn.click()
      await page.waitForTimeout(500)
    }

    // Now look for "ans = 2" — the workstation interpreter assigns
    // the value of a bare expression to the implicit `ans`
    // variable (matlab convention). Anchored to that exact string
    // so we don't false-match on the "Console 2" tab pill (where
    // 2 is the entry count) or any other stray digit on the page.
    await expect(
      page.locator('text=/ans\\s*=\\s*2/').first(),
      '`1 + 1` should produce `ans = 2` in the console',
    ).toBeVisible({ timeout: 4000 })

    expect(pageErrors, `Workstation page errors: ${pageErrors.join('; ')}`).toEqual([])
  })

  // sqrt(16) → 4: exercises the function-call dispatch + numeric
  // stdlib paths that 1+1 doesn't reach. Single check kept simple
  // (separate test from the addition case) — combining them required
  // closing the Results overlay between runs and the close-button
  // selectors were brittle.
  test('Workstation: sqrt(16) returns 4 (builtin function + Results overlay)', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))

    await page.goto('/compute-lab', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    const editor = page.locator('textarea').first()
    await editor.fill('sqrt(16)')

    const runBtn = page.getByRole('button', { name: /^Run$/ }).first()
    await runBtn.click()
    await page.waitForTimeout(600)

    const resultsBtn = page.getByRole('button', { name: /Results ▸|results overlay/i }).first()
    if (await resultsBtn.count() > 0) await resultsBtn.click()
    await page.waitForTimeout(400)

    await expect(
      page.locator('text=/ans\\s*=\\s*4/').first(),
      '`sqrt(16)` should produce `ans = 4` in the console',
    ).toBeVisible({ timeout: 4000 })

    expect(pageErrors, `Workstation page errors: ${pageErrors.join('; ')}`).toEqual([])
  })

  // mean(1:10) → 5.5: exercises range-expression syntax + reducing
  // builtin together. The `1:10` range is a matlab idiom for
  // [1, 2, 3, ..., 10], so this catches both the range parser and
  // the array-reducing function.
  test('Workstation: mean(1:10) returns 5.5 (range + reduce)', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))

    await page.goto('/compute-lab', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    const editor = page.locator('textarea').first()
    await editor.fill('mean(1:10)')

    const runBtn = page.getByRole('button', { name: /^Run$/ }).first()
    await runBtn.click()
    await page.waitForTimeout(600)

    const resultsBtn = page.getByRole('button', { name: /Results ▸|results overlay/i }).first()
    if (await resultsBtn.count() > 0) await resultsBtn.click()
    await page.waitForTimeout(400)

    await expect(
      page.locator('text=/ans\\s*=\\s*5\\.5/').first(),
      '`mean(1:10)` should produce `ans = 5.5` in the console',
    ).toBeVisible({ timeout: 4000 })

    expect(pageErrors, `Workstation page errors: ${pageErrors.join('; ')}`).toEqual([])
  })
})
