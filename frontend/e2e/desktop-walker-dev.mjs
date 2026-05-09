// Dev-server variant of e2e/desktop-walker.mjs. Launches its own
// chromium against http://localhost:3001 so we can verify code fixes
// without needing to rebuild the desktop binary. Same crash-detection
// logic; only the URL base + browser-launch path differ.
//
// Usage: node e2e/desktop-walker-dev.mjs

import { chromium } from '@playwright/test'

const BASE = 'http://localhost:3001'
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
  '/knowledge-graph',
  '/knowledge-graph/viewer',
  '/dev/pgvector',
]

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  const results = []
  for (const route of ROUTES) {
    const consoleErrors = []
    const pageErrors = []
    const onConsole = (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    }
    const onPageError = (err) => pageErrors.push(`${err.name}: ${err.message}`)

    page.on('console', onConsole)
    page.on('pageerror', onPageError)

    let nav = 'ok'
    try {
      await page.goto(`${BASE}${route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 8000,
      })
      await page.waitForTimeout(1500)
    } catch (e) {
      nav = `nav-fail: ${e.message}`
    }

    let boundaryHit = false
    try {
      boundaryHit = (await page.locator('text=Something went wrong').count()) > 0
    } catch { /* noop */ }

    page.off('console', onConsole)
    page.off('pageerror', onPageError)

    const interesting = (msgs) =>
      msgs.filter(
        (m) =>
          !/Failed to load resource: the server responded with a status of 500/.test(m) &&
          !/\[API\] 500/.test(m) &&
          !/HTTP 401|HTTP 404/.test(m),
      )

    results.push({
      route,
      nav,
      boundary: boundaryHit,
      pageErrors,
      consoleErrors: interesting(consoleErrors),
    })

    const tag = boundaryHit
      ? 'BOUNDARY'
      : pageErrors.length
      ? 'PAGEERR '
      : nav !== 'ok'
      ? 'NAV-FAIL'
      : interesting(consoleErrors).length
      ? 'WARN    '
      : 'OK      '
    console.log(
      `[${tag}] ${route}  pageErr=${pageErrors.length} consoleErr=${
        interesting(consoleErrors).length
      }`,
    )
    for (const e of pageErrors.slice(0, 3)) console.log(`    pageerror: ${e}`)
    for (const e of interesting(consoleErrors).slice(0, 3))
      console.log(`    console:   ${e.split('\n')[0]}`)
  }

  console.log('\n=== summary ===')
  const crashed = results.filter((r) => r.boundary || r.pageErrors.length)
  console.log(`crashed/boundary: ${crashed.length}/${results.length}`)
  for (const r of crashed) {
    console.log(
      `  ${r.route}: boundary=${r.boundary} pageerr=${r.pageErrors.length}`,
    )
  }

  await browser.close()
}

main().catch((e) => {
  console.error('walker failed:', e)
  process.exit(1)
})
