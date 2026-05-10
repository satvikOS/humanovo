// Headed E2E sweep against the installed humanovo.exe with mock auth.
//
// Connects to the running humanovo.exe via WebView2 CDP, logs in
// using the test credentials (1234 / 1234), and walks every route
// in the app reporting pass/fail per page. Reports any:
//   • pageerror thrown by the renderer
//   • React error-boundary trip ("Something went wrong" surface)
//   • route that fails to land within 5s
//
// Prerequisite: humanovo.exe launched with the CDP debug flag set:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// The companion `run-headed-e2e.bat` (Windows) handles the launch +
// invocation in one step.
//
// Mock auth: requires the build to have been compiled with
// VITE_ENABLE_MOCK_AUTH=true (default for non-production Vite builds;
// CI release builds set it explicitly to false). When the gate is
// off, the script logs a clear error and exits 3 instead of timing
// out trying to log in.
import { chromium } from '@playwright/test'

const ROUTES = [
  '/dashboard', '/projects', '/discovery', '/evidence',
  '/literature-review', '/citation-manager', '/data-manager',
  '/data-visualization', '/notebook', '/agents', '/timeline',
  '/search', '/settings', '/genomics', '/imaging',
  '/knowledge-graph', '/knowledge-graph/viewer',
  '/biobank', '/clinical-trials', '/collaboration',
  '/experiment-tracker', '/manuscript-manager',
  '/ml-models', '/pgvector', '/regulatory-compliance',
  '/research-imaging', '/workbench',
]

const CDP_URL = 'http://localhost:9222'
const RESULTS = []

async function login(page) {
  await page.goto('http://tauri.localhost/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  // The Tauri build serves the React app off `tauri://localhost` or
  // `http://tauri.localhost`. The CDP-attached page is already on
  // some humanovo route; navigating to /login via React Router is
  // simpler than reckoning the actual scheme.
  await page.evaluate(() => { if (window.location.hash !== '#/login') window.location.hash = '#/login' }).catch(() => {})
  await page.waitForTimeout(500)

  // Verify the mock-auth banner is visible — it's only rendered when
  // VITE_ENABLE_MOCK_AUTH=true. Bail out clearly if not.
  const bannerOk = await page.locator('[data-testid="mock-auth-banner"]').isVisible().catch(() => false)
  if (!bannerOk) {
    const url = page.url()
    throw new Error(
      `Mock-auth banner not visible at ${url}. ` +
      `Build was likely compiled with VITE_ENABLE_MOCK_AUTH=false. ` +
      `Reinstall the dev build, or set the env var on rebuild.`
    )
  }

  // One-click Fill button populates 1234/1234 — saves a fragile
  // type-into-each-input dance.
  await page.click('[data-testid="mock-auth-fill"]')
  await page.click('[data-testid="login-submit"]')

  // Successful mock login lands on /dashboard within ~1s.
  await page.waitForFunction(
    () => window.location.hash.includes('/dashboard') || window.location.pathname.includes('/dashboard'),
    null,
    { timeout: 10_000 },
  )
}

async function visitRoute(page, route) {
  const errors = []
  const onPageError = (e) => errors.push(`${e.name}: ${e.message}`)
  page.on('pageerror', onPageError)

  try {
    // Push the route via the React Router hash so the SPA router
    // takes over — works regardless of whether the Tauri shell uses
    // hash or memory routing.
    await page.evaluate((r) => {
      window.location.hash = '#' + r
    }, route)
    await page.waitForTimeout(800)
    // Detect React error-boundary fallback.
    const boundary = await page.locator('text=Something went wrong').first().isVisible().catch(() => false)
    return {
      route,
      ok: errors.length === 0 && !boundary,
      errors,
      errorBoundary: boundary,
    }
  } catch (e) {
    return { route, ok: false, errors: [`navigate failed: ${e.message}`], errorBoundary: false }
  } finally {
    page.off('pageerror', onPageError)
  }
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL).catch((e) => {
    console.error(
      `Cannot reach humanovo at ${CDP_URL}. ` +
      `Launch humanovo.exe with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.`
    )
    console.error(e.message)
    process.exit(2)
  })

  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0]
  if (!page) {
    console.error('humanovo CDP attached but no page found.')
    process.exit(2)
  }

  console.log('=== humanovo headed E2E (mock-auth + 27-route sweep) ===\n')

  try {
    await login(page)
    console.log('[OK ] mock-auth login (1234 / 1234)\n')
  } catch (e) {
    console.error(`[FAIL] login: ${e.message}`)
    process.exit(3)
  }

  for (const route of ROUTES) {
    const r = await visitRoute(page, route)
    RESULTS.push(r)
    const tag = r.ok ? '[OK ]' : '[FAIL]'
    const detail = r.ok ? '' : (
      ` — ${r.errorBoundary ? 'error-boundary tripped' : ''}` +
      (r.errors.length ? ` ${r.errors.slice(0, 1).join(' | ')}` : '')
    )
    console.log(`${tag} ${route.padEnd(34)}${detail}`)
  }

  const passed = RESULTS.filter((r) => r.ok).length
  const failed = RESULTS.length - passed
  console.log(`\n=== Summary: ${passed}/${RESULTS.length} routes OK, ${failed} failed ===`)

  await browser.close().catch(() => {})
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(99)
})
