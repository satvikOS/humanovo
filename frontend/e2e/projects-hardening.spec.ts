/**
 * Projects hardening — Stage 3 page #2 of PATH_TO_100_PERCENT.md.
 *
 * Distinct from `visual-screenshots.spec.ts` (which screenshots every
 * page) — this drills into the loading / empty / filtered-empty / error
 * paths that the hardening pass either improved or relies on. The big
 * Projects page does most of the heavy lifting (it has rich filters +
 * a search + bulk actions); the e2e here covers the moving pieces a
 * Stage 3 regression would silently break.
 */

import { expect, test } from '@playwright/test'


test.describe('Projects — hardening worked example', () => {
  test('page mounts with the New Project CTA reachable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/projects')
    await page.waitForLoadState('domcontentloaded')

    // The "+ New Project" CTA in the header is part of every render
    // (regardless of empty / loaded / error). Asserting it directly
    // catches a layout-rewrite regression that would slip past
    // visual-screenshots.
    await expect(page.getByRole('button', { name: /New Project/i }).first()).toBeVisible({ timeout: 8_000 })

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('?new=1 deep-link auto-opens the create modal', async ({ page }) => {
    // Deep-link path used by Dashboard quick-action and Onboarding
    // wizard's first step. Regression here breaks two surfaces; assert
    // it explicitly.
    await page.goto('/projects?new=1')
    await page.waitForLoadState('domcontentloaded')
    // Modal is rendered; look for any of its anchor headings.
    await expect(
      page.getByRole('heading', { name: /Create.*Project|New.*Project|Project.*Name/i }).first(),
    ).toBeVisible({ timeout: 8_000 })
  })

  test('zero-projects path renders an empty-state CTA OR an error card', async ({ page }) => {
    // In the dev e2e environment the backend is unreachable, so we
    // expect EITHER:
    //   * empty state — "Start Your Research" + "Create Your First
    //     Project" CTA (when API returns empty / 200)
    //   * error card — "API error: …" banner with a Try-again button
    //     (when API throws / connection refused)
    // Both are valid; the bug is silently showing an empty white area.
    await page.goto('/projects')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2_000)

    const empty = await page
      .getByRole('button', { name: /Create Your First Project/i })
      .count()
    const tryAgain = await page.getByRole('button', { name: /Try again/i }).count()

    expect(
      empty + tryAgain,
      'Projects should expose either the empty-state CTA or a Try-again button when zero data is loaded',
    ).toBeGreaterThan(0)
  })

  test('search input is interactive', async ({ page }) => {
    await page.goto('/projects')
    await page.waitForLoadState('domcontentloaded')

    const search = page.getByPlaceholder(/Search projects by name/i).first()
    await expect(search).toBeVisible({ timeout: 8_000 })
    await search.fill('parkinsons')
    await expect(search).toHaveValue('parkinsons')
  })
})
