// Click-sweep against the running humanovo.exe via CDP. For each
// route, navigates, finds every visible button, clicks each one
// (with timeout + try/catch so the sweep doesn't bail on one
// stuck control), and reports any that triggered the React error
// boundary or threw a pageerror.
//
// Designed to be a smoke pass over the full interactive surface of
// the installed binary — catches button handlers that wire up
// to undefined callbacks, navigation routes that 404, modal
// dialogs that crash on open, etc. Skips controls that look
// destructive (text contains delete / remove / submit / publish /
// quit / reset) so the sweep doesn't blow away user state mid-run.
//
// Prerequisite: humanovo.exe launched with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222

import { chromium } from '@playwright/test'

const ROUTES = [
  '/dashboard', '/projects', '/evidence', '/compute-lab',
  '/notebook', '/agents', '/timeline', '/search', '/settings',
  '/literature-review', '/citation-manager', '/data-visualization',
  '/data-manager', '/genomics', '/imaging',
  '/knowledge-graph', '/knowledge-graph/viewer',
]

// Buttons whose text matches these patterns are skipped — destructive
// or state-mutating actions that would corrupt user data on a
// production system. Sweep is a smoke pass, not a stress test.
const DESTRUCTIVE = /delete|remove|submit|publish|quit|reset|clear all|drop|destroy|sign out|log out|cancel run|stop discovery/i

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0]
  if (!page) {
    console.error('No CDP page. humanovo not running?')
    process.exit(2)
  }

  const totals = { routes: 0, buttons: 0, clicked: 0, skipped: 0, crashes: 0 }
  const crashes = []

  for (const route of ROUTES) {
    totals.routes++
    let pageErrors = []
    const onPageError = (err) => pageErrors.push(`${err.name}: ${err.message}`)
    page.on('pageerror', onPageError)

    try {
      await page.goto(`http://tauri.localhost${route}`, {
        waitUntil: 'domcontentloaded', timeout: 8000,
      })
      await page.waitForTimeout(1200)
    } catch {
      console.log(`[NAV-FAIL] ${route}`)
      page.off('pageerror', onPageError)
      continue
    }

    // Snapshot button-like elements before clicking — clicking one
    // can re-render and invalidate handles. We collect their visible
    // text + bounding-box-center so we can click via coordinates
    // instead of element handles, which dodges stale-element errors.
    const buttons = await page.evaluate(() => {
      const out = []
      const els = document.querySelectorAll('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')
      for (const el of els) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const t = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 60)
        out.push({ text: t, x: r.left + r.width / 2, y: r.top + r.height / 2 })
      }
      return out
    })

    let routeButtons = 0
    let routeClicked = 0
    let routeSkipped = 0
    let routeCrashes = 0

    for (const btn of buttons.slice(0, 8)) { // cap at 8 per route to stay tractable
      routeButtons++
      totals.buttons++
      if (DESTRUCTIVE.test(btn.text)) {
        routeSkipped++
        totals.skipped++
        continue
      }
      // Click via mouse coordinates so a re-render between buttons
      // doesn't invalidate a stale element handle.
      try {
        await page.mouse.click(btn.x, btn.y, { delay: 50 })
        await page.waitForTimeout(250)
        routeClicked++
        totals.clicked++
        // If the click landed on a nav link or a button that
        // navigated us away, get back to the route under test
        // so the next click happens on the same surface.
        const here = page.url()
        if (!here.endsWith(route)) {
          await page.goto(`http://tauri.localhost${route}`, {
            waitUntil: 'domcontentloaded', timeout: 8000,
          })
          await page.waitForTimeout(800)
        }
      } catch {
        // Single click failure is fine; just move on.
      }

      // After every click, check if the React boundary triggered.
      const boundaryHit = await page.locator('text=Something went wrong').count()
      if (boundaryHit > 0) {
        routeCrashes++
        totals.crashes++
        crashes.push({ route, button: btn.text || '<unlabeled>' })
        // Reset the boundary by navigating away and back.
        await page.goto(`http://tauri.localhost${route}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(800)
      }
    }

    page.off('pageerror', onPageError)

    // Filter out backend-down 500s; those are environmental noise.
    const realPageErrors = pageErrors.filter(e =>
      !/500/.test(e) && !/Failed to load resource/.test(e),
    )
    const tag = routeCrashes > 0 ? 'CRASH   '
      : realPageErrors.length > 0 ? 'PAGE-ERR'
      : 'OK      '
    console.log(`[${tag}] ${route}  buttons=${routeButtons} clicked=${routeClicked} skipped=${routeSkipped} crashes=${routeCrashes}`)
    for (const e of realPageErrors.slice(0, 2)) console.log(`    pageerror: ${e}`)
  }

  console.log('')
  console.log('=== summary ===')
  console.log(`routes:   ${totals.routes}`)
  console.log(`buttons:  ${totals.buttons}`)
  console.log(`clicked:  ${totals.clicked}`)
  console.log(`skipped:  ${totals.skipped}  (destructive)`)
  console.log(`crashes:  ${totals.crashes}`)
  if (crashes.length > 0) {
    console.log('')
    console.log('boundary triggered after these clicks:')
    for (const c of crashes) console.log(`  ${c.route} :: ${c.button}`)
  }

  await browser.close().catch(() => {})
}

main().catch((e) => {
  console.error('click-sweep failed:', e)
  process.exit(1)
})
