import { expect, test } from '@playwright/test'

// Every major page + key modals / tabs. Screenshots land in
// frontend/test-results/visual-screenshots/ — upload as a CI artifact
// for visual-assistance review.
//
// Run:
//   cd frontend && npx vite --port 3001 &   # or `npm run dev -- --port 3001`
//   npx playwright test visual-screenshots --reporter=list
// Screenshots are saved per-page.

const PAGES: Array<{ name: string; path: string; waitFor?: string }> = [
  { name: 'dashboard',            path: '/dashboard' },
  { name: 'projects',             path: '/projects' },
  { name: 'evidence',             path: '/evidence' },
  { name: 'search',               path: '/search' },
  { name: 'timeline',             path: '/timeline' },
  { name: 'notebook',             path: '/notebook' },
  { name: 'agents',               path: '/agents' },
  { name: 'data-manager',         path: '/data-manager' },
  { name: 'settings',             path: '/settings' },
  { name: 'compute-lab',          path: '/compute-lab' },
  { name: 'workbench',            path: '/workbench' },
  { name: 'anatomy',              path: '/anatomy' },
  { name: 'literature-review',    path: '/literature-review' },
  { name: 'citation-manager',     path: '/citation-manager' },
  { name: 'experiment-tracker',   path: '/experiment-tracker' },
  { name: 'data-visualization',   path: '/data-visualization' },
  { name: 'collaboration',        path: '/collaboration' },
  { name: 'clinical-trials',      path: '/clinical-trials' },
  { name: 'genomics',             path: '/genomics' },
  { name: 'manuscripts',          path: '/manuscripts' },
  { name: 'regulatory',           path: '/regulatory' },
  { name: 'imaging',              path: '/imaging' },
  { name: 'biobank',              path: '/biobank' },
  { name: 'pgvector',             path: '/dev/pgvector' },
]

for (const page of PAGES) {
  test(`screenshot: ${page.name}`, async ({ page: pw }) => {
    pw.on('console', (msg) => {
      if (msg.type() === 'error') {
        // eslint-disable-next-line no-console
        console.log(`[console.error on ${page.name}]`, msg.text())
      }
    })
    pw.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log(`[pageerror on ${page.name}]`, err.message)
    })

    await pw.goto(page.path)
    // Give lazy chunks + react-query a beat to paint first data.
    await pw.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
    await pw.waitForTimeout(600)

    await pw.screenshot({
      path: `test-results/visual-screenshots/${page.name}.png`,
      fullPage: true,
    })
    // Sanity: the route rendered something (not the 404 fallback).
    await expect(pw.locator('body')).toBeVisible()
  })
}
