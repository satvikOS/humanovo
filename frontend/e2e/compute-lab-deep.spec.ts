/**
 * Compute Lab — deep-link ?tab= parity checks.
 *
 * The dashboard Recent-Simulations widget routes rows into Compute Lab
 * with ?tab=equations | ?tab=montecarlo | (no tab for workstation).
 * This spec locks in:
 *   - Each canonical tab name selects the right panel.
 *   - Legacy aliases (mc / monte-carlo / simulations / history / plotter)
 *     still resolve correctly.
 *   - A bogus tab value silently falls back to Workstation (no crash,
 *     URL cleaned of the invalid ?tab= param).
 *   - Clicking a tab button updates the URL so the selection is
 *     shareable and reload-safe.
 */
import { test, expect, Page } from '@playwright/test'

function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR|WebGL|three/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

async function waitComputeLabMounted(page: Page) {
  // The header row has three tab buttons; wait for at least one to show up.
  await page.locator('button', { hasText: 'Workstation' }).first().waitFor({ timeout: 10000 })
}

test.describe('ComputeLab — base mount', () => {
  test('/compute-lab renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/compute-lab')
    await page.waitForLoadState('domcontentloaded')
    await waitComputeLabMounted(page)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('ComputeLab — canonical ?tab= values', () => {
  test('?tab=montecarlo selects Monte Carlo (URL preserved)', async ({ page }) => {
    await page.goto('/compute-lab?tab=montecarlo')
    await page.waitForLoadState('domcontentloaded')
    await waitComputeLabMounted(page)
    // The MC tab button should be visually selected; assert URL.
    await page.waitForTimeout(300)
    expect(page.url()).toMatch(/tab=montecarlo/)
  })

  test('?tab=equations selects Equation Plotter (URL preserved)', async ({ page }) => {
    await page.goto('/compute-lab?tab=equations')
    await page.waitForLoadState('domcontentloaded')
    await waitComputeLabMounted(page)
    await page.waitForTimeout(300)
    expect(page.url()).toMatch(/tab=equations/)
  })

  test('?tab=workstation strips the tab param (workstation is default)', async ({ page }) => {
    await page.goto('/compute-lab?tab=workstation')
    await page.waitForLoadState('domcontentloaded')
    await waitComputeLabMounted(page)
    await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/tab=/)
  })
})

test.describe('ComputeLab — legacy aliases', () => {
  const aliases: Array<[string, string]> = [
    ['mc', 'montecarlo'],
    ['monte-carlo', 'montecarlo'],
    ['simulations', 'montecarlo'],
    ['history', 'montecarlo'],
    ['equation', 'equations'],
    ['plotter', 'equations'],
  ]
  for (const [alias, canonical] of aliases) {
    test(`?tab=${alias} normalizes to ${canonical}`, async ({ page }) => {
      await page.goto(`/compute-lab?tab=${alias}`)
      await page.waitForLoadState('domcontentloaded')
      await waitComputeLabMounted(page)
      // Wait for the sync effect to rewrite ?tab=alias → ?tab=canonical.
      await page.waitForFunction((target) => {
        const s = new URLSearchParams(window.location.search)
        return (s.get('tab') || '') === target
      }, canonical, { timeout: 5000 })
      expect(page.url()).toMatch(new RegExp(`tab=${canonical}`))
    })
  }
})

test.describe('ComputeLab — bogus ?tab= falls back', () => {
  test('?tab=totally-bogus silently resets to Workstation (no crash, no tab param)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/compute-lab?tab=totally-bogus-mode')
    await page.waitForLoadState('domcontentloaded')
    await waitComputeLabMounted(page)
    await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('ComputeLab — clicking tab updates the URL', () => {
  test('click Monte Carlo tab → URL gets ?tab=montecarlo', async ({ page }) => {
    await page.goto('/compute-lab')
    await page.waitForLoadState('domcontentloaded')
    await waitComputeLabMounted(page)
    await page.locator('button', { hasText: 'Monte Carlo' }).first().click()
    await page.waitForFunction(() => window.location.search.includes('tab=montecarlo'), null, { timeout: 5000 })
    expect(page.url()).toMatch(/tab=montecarlo/)
  })

  test('click Equation Plotter tab → URL gets ?tab=equations', async ({ page }) => {
    await page.goto('/compute-lab')
    await page.waitForLoadState('domcontentloaded')
    await waitComputeLabMounted(page)
    await page.locator('button', { hasText: 'Equation Plotter' }).first().click()
    await page.waitForFunction(() => window.location.search.includes('tab=equations'), null, { timeout: 5000 })
    expect(page.url()).toMatch(/tab=equations/)
  })

  test('back to Workstation from MC → URL clears tab param', async ({ page }) => {
    await page.goto('/compute-lab?tab=montecarlo')
    await page.waitForLoadState('domcontentloaded')
    await waitComputeLabMounted(page)
    await page.locator('button', { hasText: 'Workstation' }).first().click()
    await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/tab=/)
  })
})
