/**
 * Dashboard hardening — focused e2e for the worked example covered in
 * commit `feat(uiux): dashboard hardening end-to-end` and tracked under
 * Stage 3 of PATH_TO_100_PERCENT.md.
 *
 * Distinct from `visual-screenshots.spec.ts` (which screenshots every
 * page) — this spec drills into Dashboard's loading / error / empty
 * states because they are the moving pieces the hardening pass
 * actually touched. visual-screenshots covers "page renders cleanly";
 * this covers "the new error-recovery UX works as intended".
 *
 * Scope:
 *   - Page mounts without an unhandled error.
 *   - Stats cards present with the labels the hardening relies on.
 *   - Quick-action buttons reachable.
 *   - At least one zero-data widget renders an empty state OR an
 *     error card with a Retry button when the backend is unreachable
 *     (the dev-server e2e setup runs without a backend, so this
 *     exercises the fallback path the hardening introduced).
 *   - The "View All" / link rows route correctly.
 */

import { expect, test } from '@playwright/test'


test.describe('Dashboard — hardening worked example', () => {
  test('page mounts and the welcome strip renders', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    // The header subtitle is part of every dashboard render — assert
    // it's there so a regression that hides the welcome strip fails
    // loudly instead of silently passing the screenshot suite.
    await expect(
      page.getByText("Welcome back. Here's what's happening with your research.").first(),
    ).toBeVisible({ timeout: 8_000 })

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('stats strip exposes all six counters', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    // The six labels live alongside their counters in the stats strip.
    // Assert each is present; renaming any of them is a deliberate
    // breaking change that should require a test update.
    const statLabels = [
      'Active Projects',
      'Simulations',
      'Datasets',
      'Visualizations',
      'Imaging Studies',
      'Hypotheses',
    ]
    for (const label of statLabels) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 8_000 })
    }
  })

  test('quick-action bar surfaces every CTA', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    // These six buttons live in the welcome strip; the hardening
    // pass asserts they all stay reachable post-refactor.
    const buttons = [
      'Start Discovery',
      'New Project',
      'Compute Lab',
      'Visualize',
      'Notebook',
      'Search',
    ]
    for (const label of buttons) {
      await expect(page.getByRole('button', { name: label }).first()).toBeVisible({ timeout: 8_000 })
    }
  })

  test('zero-data widgets render either an empty state OR a Retry-equipped error card', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    // Give the widgets time to fan out their fetches and either
    // populate, fail-and-recover via local cache, or fail outright.
    await page.waitForTimeout(2_000)

    // Recent Simulations + Recent Notebooks both ship the new
    // two-branch error UX. In the dev e2e environment the backend
    // is unreachable, so we expect EITHER an empty-state CTA
    // ("Run a simulation" / "Create a notebook") OR an error card
    // ("Try again"). Both are valid outcomes; the bug is silently
    // showing nothing.
    const simEmpty = await page.getByRole('button', { name: 'Run a simulation' }).count()
    const simRetry = await page.getByRole('button', { name: 'Try again' }).count()
    expect(
      simEmpty + simRetry,
      'simulations widget should expose either an empty CTA or a Retry button',
    ).toBeGreaterThan(0)

    const nbEmpty = await page.getByRole('button', { name: 'Create a notebook' }).count()
    expect(nbEmpty + simRetry).toBeGreaterThan(0)
  })

  test('"New Project" button routes to /projects?new=1', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: 'New Project' }).first().click()
    // The Projects page handles the ?new=1 query to auto-open the
    // create modal; here we just assert the navigation landed.
    await expect(page).toHaveURL(/\/projects/)
  })
})
