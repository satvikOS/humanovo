/**
 * Loads every top-level route and asserts no React error boundary
 * triggered + no uncaught page errors. Catches the crash class that
 * shipped to users in the last build (4 routes broke with .map /
 * .find / .flatMap / .length on undefined when the backend returned
 * a non-array body).
 *
 * Runs against the dev server (default Playwright config baseURL).
 * Companion to e2e/desktop-walker.mjs which does the same against a
 * running humanovo.exe via CDP.
 */

import { test, expect } from '@playwright/test'

const ROUTES = [
  '/dashboard',
  '/projects',
  '/evidence',
  '/compute-lab',
  '/notebook',
  '/agents',
  '/agents-chat-mode',
  '/timeline',
  '/search',
  '/settings',
  '/literature-review',
  '/citation-manager',
  '/data-visualization',
  '/data-manager',
  '/genomics',
  '/imaging',
  '/knowledge-graph',
  '/knowledge-graph/viewer',
  '/dev/pgvector',
]

for (const route of ROUTES) {
  test(`route loads without crash: ${route}`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))

    await page.goto(route, { waitUntil: 'domcontentloaded' })
    // Let the SPA settle and any deferred render-time crash trigger.
    await page.waitForTimeout(1500)

    // The error boundary surfaces a "Something went wrong" panel. If
    // a render path threw, that's what the user sees — and that's the
    // signal we want to fail on.
    const boundaryCount = await page.locator('text=Something went wrong').count()
    expect(boundaryCount, `${route} hit React error boundary`).toBe(0)
    expect(pageErrors, `${route} pageerror: ${pageErrors.join('; ')}`).toHaveLength(0)
  })
}
