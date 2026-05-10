// Walks every humanovo route via CDP-attached Playwright and reports
// what crashes, what console-errors, what shows the React error
// boundary. Designed to drive a *running* Tauri desktop app, not the
// browser dev server.
//
// Prerequisite: humanovo.exe launched with the env var
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// so its WebView2 exposes CDP at localhost:9222.
//
// Usage: node e2e/desktop-walker.mjs

import { chromium } from '@playwright/test'

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

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0]
  if (!page) {
    console.error('No existing page in humanovo CDP. Is humanovo running?')
    process.exit(2)
  }

  console.log(`Attached. Current URL: ${page.url()}`)

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

    const url = `http://tauri.localhost${route}`
    let nav = 'ok'
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 })
      // Give the SPA a beat to settle and any deferred .map crash a
      // chance to throw.
      await page.waitForTimeout(1500)
    } catch (e) {
      nav = `nav-fail: ${e.message}`
    }

    // Detect the in-app ErrorBoundary's "Something went wrong" UI.
    let boundaryHit = false
    try {
      boundaryHit = await page.locator('text=Something went wrong').count() > 0
    } catch { /* noop */ }

    page.off('console', onConsole)
    page.off('pageerror', onPageError)

    // Filter out the noisy 500/network errors that are just
    // "backend isn't running" — they hit *every* route and aren't
    // page-specific signal.
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
      pageErrors: pageErrors.slice(0, 5),
      consoleErrors: interesting(consoleErrors).slice(0, 5),
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
    for (const e of pageErrors) console.log(`    pageerror: ${e}`)
    for (const e of interesting(consoleErrors)) console.log(`    console:   ${e}`)
  }

  console.log('\n=== summary ===')
  const crashed = results.filter((r) => r.boundary || r.pageErrors.length)
  console.log(`crashed/boundary: ${crashed.length}/${results.length}`)
  for (const r of crashed) {
    console.log(`  ${r.route}: boundary=${r.boundary} pageerr=${r.pageErrors.length}`)
  }

  await browser.close().catch(() => {})
}

main().catch((e) => {
  console.error('walker failed:', e)
  process.exit(1)
})
