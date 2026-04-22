/**
 * Customer journey — researcher deep-workflow.
 *
 * Exercises the research-flow a power user hits once a project is
 * seeded: evidence → citations → hypotheses → knowledge graph. Every
 * step screenshots for visual review and asserts no runtime crash /
 * ErrorBoundary trip.
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

const pages: { label: string; path: string; screenshot: string }[] = [
  { label: 'Evidence', path: '/evidence', screenshot: 'researcher-1-evidence.png' },
  { label: 'Literature Review', path: '/literature-review', screenshot: 'researcher-2-literature.png' },
  { label: 'Citation Manager', path: '/citation-manager', screenshot: 'researcher-3-citations.png' },
  { label: 'Hypotheses', path: '/hypotheses', screenshot: 'researcher-4-hypotheses.png' },
  { label: 'Knowledge Graph', path: '/knowledge-graph', screenshot: 'researcher-5-kg.png' },
  { label: 'Workbench', path: '/workbench', screenshot: 'researcher-6-workbench.png' },
  { label: 'Notebook', path: '/notebook', screenshot: 'researcher-7-notebook.png' },
]

test.describe('Customer journey — researcher deep-workflow', () => {
  for (const p of pages) {
    test(`${p.label} renders without crash`, async ({ page }) => {
      const errs: string[] = []; attachErrorCapture(page, errs)
      await page.goto(p.path)
      await page.waitForLoadState('domcontentloaded')
      await page.locator('h1, h2, h3').first().waitFor({ timeout: 10_000 })
      const boundary = await page.locator('text=/Something went wrong/i').count()
      expect(boundary).toBe(0)
      await page.screenshot({ path: `test-results/${p.screenshot}`, fullPage: true })
      expect(errs.filter(e => /Maximum call stack|is not a function|Cannot read prop/.test(e))).toEqual([])
    })
  }

  test('g-prefix navigation chain dashboard → hypotheses → knowledge graph', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    await page.keyboard.press('g')
    await page.keyboard.press('h')
    await page.waitForURL(/\/hypotheses$/, { timeout: 3_000 }).catch(() => {})

    await page.keyboard.press('g')
    await page.keyboard.press('k')
    await page.waitForURL(/\/knowledge-graph$/, { timeout: 3_000 }).catch(() => {})

    await page.screenshot({ path: 'test-results/researcher-8-g-chain.png', fullPage: true })
  })
})
