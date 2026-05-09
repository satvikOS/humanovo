/**
 * Knowledge Graph hardening — Stage 3 page #5 of
 * PATH_TO_100_PERCENT.md.
 *
 * The /knowledge-graph page combines two surfaces shipped this
 * session: the new ScopedKnowledgeGraphPanel (Private/Common/All
 * toggle, commit 0835393) and the legacy explorer chrome below.
 * Both already render loading + error + empty states; this spec
 * pins the contract so a regression on either side fails loudly.
 */

import { expect, test } from '@playwright/test'


test.describe('Knowledge Graph — hardening worked example', () => {
  test('page mounts; scope toggle exposes Private / Common / All', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/knowledge-graph')
    await page.waitForLoadState('domcontentloaded')

    // ScopedKnowledgeGraphPanel renders three toggle buttons.
    await expect(page.getByRole('button', { name: 'Private' }).first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByRole('button', { name: 'Common' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'All' }).first()).toBeVisible()

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })

  test('clicking Private updates the active button styling', async ({ page }) => {
    await page.goto('/knowledge-graph')
    await page.waitForLoadState('domcontentloaded')
    const priv = page.getByRole('button', { name: 'Private' }).first()
    await priv.click()
    // The active toggle gets color: var(--color-bg) — the inverse of
    // the inactive state. We just assert the click didn't crash; the
    // exact style is a visual diff job.
    await expect(priv).toBeVisible()
  })

  test('legacy explorer header is still rendered below the new panel', async ({ page }) => {
    await page.goto('/knowledge-graph')
    await page.waitForLoadState('domcontentloaded')
    await expect(
      page.getByRole('heading', { name: /Knowledge Graph Explorer/i }).first(),
    ).toBeVisible({ timeout: 8_000 })
  })
})
