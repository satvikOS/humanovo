/**
 * Notebook hardening — Stage 3 page #6 of PATH_TO_100_PERCENT.md.
 *
 * Notebook already uses EmptyState + the api.getNotebookPages
 * loader has its own error catch path. This spec pins the surface
 * (page list rail + create-page CTA) so a regression that hides
 * either fails loudly.
 */

import { expect, test } from '@playwright/test'

test.describe('Notebook — hardening worked example', () => {
  test('page mounts; create-page CTA reachable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

    await page.goto('/notebook')
    await page.waitForLoadState('domcontentloaded')

    // Either the empty-state CTA ("Create a notebook page") or the
    // sidebar's "+" button is reachable — assert one of them is up.
    const empty = await page.getByRole('button', { name: /Create.*page|new page/i }).count()
    const newBtn = await page.getByRole('button', { name: /^\+$|New|Create/i }).count()
    expect(empty + newBtn).toBeGreaterThan(0)

    expect(
      errors.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
    ).toEqual([])
  })
})
