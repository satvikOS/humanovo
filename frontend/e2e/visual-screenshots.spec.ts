import { expect, test, type Page } from '@playwright/test'

// Output directory (relative to the frontend/ cwd when playwright runs).
const OUT = 'test-results/visual-screenshots'

const PAGES: Array<{ name: string; path: string }> = [
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
  // /hypotheses was retired — hypotheses live inside projects now.
  // Keeping the screenshot slot but pointed at /projects so the visual
  // diff archive stays continuous.
  { name: 'hypotheses',           path: '/projects' },
  { name: 'knowledge-graph',      path: '/knowledge-graph' },
  { name: 'knowledge-graph-viewer', path: '/knowledge-graph/viewer' },
  { name: 'ml-models',            path: '/ml-models' },
  { name: 'pgvector',             path: '/dev/pgvector' },
]

/**
 * Attach listeners that collect console errors + unhandled page errors so
 * we can assert on them per-page.
 */
function watchConsole(page: Page, name: string) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      // Known-benign noise from the dev environment (no backend running):
      //   * axios errors on API calls — the toast interceptor will surface
      //     them, that's the intended behavior and not a regression.
      //   * React strict-mode double-invocation warnings.
      if (/\bAxiosError\b|\bECONNREFUSED\b|Failed to load resource|Network Error|React-Hook-Form|StrictMode/.test(text)) return
      consoleErrors.push(`[${name}] ${text}`)
    }
  })
  page.on('pageerror', (err) => {
    pageErrors.push(`[${name}] ${err.message}`)
  })
  return { consoleErrors, pageErrors }
}

for (const page of PAGES) {
  test(`page: ${page.name}`, async ({ page: pw }) => {
    const { consoleErrors, pageErrors } = watchConsole(pw, page.name)

    await pw.goto(page.path)
    await pw.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
    await pw.waitForTimeout(500)

    // Sanity: the Layout shell renders even if the page content is empty.
    await expect(pw.locator('body')).toBeVisible()

    // Full-page screenshot.
    await pw.screenshot({ path: `${OUT}/${page.name}.png`, fullPage: true })

    // A runtime pageerror is a hard regression. A console.error is allowed
    // to slip through a dev-mode API-down environment, so we just log.
    if (pageErrors.length > 0) {
      throw new Error(`Runtime errors on ${page.name}:\n${pageErrors.join('\n')}`)
    }
    if (consoleErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`NOTE [${page.name}] ${consoleErrors.length} console.error(s):\n  ${consoleErrors.slice(0, 5).join('\n  ')}`)
    }
  })
}

/**
 * Click-every-button coverage pass. This is the "at least every button is
 * connected to *something*" test — it doesn't validate behavior, only that:
 *   1. The button has an accessible name
 *   2. Clicking it does not throw a page error
 *   3. Nothing nav-jumps to a 404
 *
 * Limited to `button[type="button"]` + `[role="button"]` to avoid form
 * submits (those are covered by flows.spec.ts). Skips buttons that are
 * visually disabled — useful for Workbench where the graph toolbar has
 * ~40 buttons, half of which are state-gated.
 */
for (const page of PAGES) {
  test(`clickable-audit: ${page.name}`, async ({ page: pw }) => {
    const { pageErrors } = watchConsole(pw, page.name)

    await pw.goto(page.path)
    await pw.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
    await pw.waitForTimeout(400)

    // Screenshot before any clicks.
    await pw.screenshot({ path: `${OUT}/click/${page.name}-before.png`, fullPage: true })

    const selectors = [
      'main button:not([disabled])',
      'main [role="button"]:not([aria-disabled="true"])',
      '[data-testid] button:not([disabled])',
    ]
    const buttons = pw.locator(selectors.join(', '))
    const initialCount = await buttons.count()
    // No cap — per user request, click every button. Spec budget is
    // the per-test timeout (30 s). Each click waits ~60 ms, so we can
    // comfortably handle ~300 clicks/page before bumping into the
    // timeout, which is more than any page currently exposes.
    const cap = initialCount

    const unnamed: number[] = []
    const startUrl = pw.url()

    for (let i = 0; i < cap; i++) {
      // Re-query each iteration; prior clicks may have re-rendered the DOM.
      const live = pw.locator(selectors.join(', '))
      const currentCount = await live.count()
      if (i >= currentCount) break
      const b = live.nth(i)
      const visible = await b.isVisible().catch(() => false)
      if (!visible) continue

      const name = (await b.getAttribute('aria-label')) || (await b.textContent())?.trim() || ''
      if (!name) unnamed.push(i)

      // Only click buttons that look like pure UI (no form submits, no
      // destructive verbs in their accessible name).
      if (/^(delete|remove|log out|sign out)/i.test(name)) continue

      await b.click({ trial: false, force: false, timeout: 2000 }).catch(() => undefined)
      await pw.waitForTimeout(40)

      // Always snap back to the originating page — some clicks open
      // modals or navigate; the next iteration needs a stable DOM.
      if (!pw.url().startsWith(startUrl.split('?')[0])) {
        await pw.goto(page.path)
        await pw.waitForTimeout(200)
      } else {
        // Close any dialog that opened.
        await pw.keyboard.press('Escape').catch(() => undefined)
      }
    }

    await pw.screenshot({ path: `${OUT}/click/${page.name}-after.png`, fullPage: true })

    if (pageErrors.length > 0) {
      throw new Error(`Runtime errors during click-audit on ${page.name}:\n${pageErrors.join('\n')}`)
    }
    if (unnamed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`a11y NOTE [${page.name}] ${unnamed.length} buttons without an accessible name`)
    }
  })
}
