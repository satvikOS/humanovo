/**
 * Persona walkthrough — postdoc drug-discovery researcher.
 *
 * Models a postdoc who's screening repurposing candidates for a rare
 * disease. The flow they hit, end-to-end on a typical day:
 *
 *   1. /projects                  — pick or create a disease-focused project
 *   2. /agents                    — kick off the discovery pipeline
 *   3. /agents-chat-mode          — talk to Constant about what to try
 *   4. /knowledge-graph           — explore disease-target-drug links
 *   5. /knowledge-graph/viewer    — focused subgraph view
 *   6. /evidence                  — read what came back
 *   7. /citation-manager          — capture refs for the methods section
 *   8. /data-manager              — keep the source datasets organized
 *   9. /compute-lab               — run quick analyses / fits
 *  10. /notebook                  — write up the day's findings
 *
 * Asserts: every page renders without crashing, no ErrorBoundary trip,
 * no fatal console error. Screenshots full-page for visual review.
 */
import { test, expect, type Page } from '@playwright/test'

function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

const stops: { label: string; path: string; screenshot: string }[] = [
  { label: 'Projects',                path: '/projects',               screenshot: 'persona-postdoc-drug-01-projects.png' },
  { label: 'Agents',                  path: '/agents',                 screenshot: 'persona-postdoc-drug-02-agents.png' },
  { label: 'Agents (Chat Mode)',      path: '/agents-chat-mode',       screenshot: 'persona-postdoc-drug-03-chat.png' },
  { label: 'Knowledge Graph',         path: '/knowledge-graph',        screenshot: 'persona-postdoc-drug-04-kg.png' },
  { label: 'Knowledge Graph Viewer',  path: '/knowledge-graph/viewer', screenshot: 'persona-postdoc-drug-05-kg-viewer.png' },
  { label: 'Evidence',                path: '/evidence',               screenshot: 'persona-postdoc-drug-06-evidence.png' },
  { label: 'Citation Manager',        path: '/citation-manager',       screenshot: 'persona-postdoc-drug-07-citations.png' },
  { label: 'Data Manager',            path: '/data-manager',           screenshot: 'persona-postdoc-drug-08-data.png' },
  { label: 'Compute Lab',             path: '/compute-lab',            screenshot: 'persona-postdoc-drug-09-compute.png' },
  { label: 'Notebook',                path: '/notebook',               screenshot: 'persona-postdoc-drug-10-notebook.png' },
]

test.describe('Persona — postdoc drug-discovery researcher', () => {
  for (const s of stops) {
    test(`${s.label} renders without crash`, async ({ page }) => {
      const errs: string[] = []
      attachErrorCapture(page, errs)
      await page.goto(s.path)
      await page.waitForLoadState('domcontentloaded')
      await page.locator('h1, h2, h3').first().waitFor({ timeout: 10_000 })
      const boundary = await page.locator('text=/Something went wrong/i').count()
      expect(boundary, `ErrorBoundary tripped on ${s.path}`).toBe(0)
      await page.screenshot({ path: `test-results/${s.screenshot}`, fullPage: true })
      expect(
        errs.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e)),
        `Fatal console errors on ${s.path}: ${errs.join('\n')}`,
      ).toEqual([])
    })
  }

  test('legacy compute aliases redirect to /compute-lab', async ({ page }) => {
    // The Sprint 1 compute consolidation collapsed several pages into
    // /compute-lab; the postdoc still has muscle memory for the old URLs.
    for (const legacy of ['/simulations', '/statistical-analysis', '/numeric-compute']) {
      await page.goto(legacy)
      await page.waitForURL(/\/compute-lab/, { timeout: 5_000 })
      await page.waitForLoadState('domcontentloaded')
      const boundary = await page.locator('text=/Something went wrong/i').count()
      expect(boundary, `ErrorBoundary on legacy redirect from ${legacy}`).toBe(0)
    }
  })
})
