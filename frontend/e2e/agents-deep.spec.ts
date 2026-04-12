/**
 * Agents (Discovery Engine) — deep-link + config-panel tests. Covers
 * the newly-added `?disease=` / `?type=` / `?guidance=` query-string
 * deep-links plus the Start button's disabled-until-valid behaviour
 * and the left-rail collapse/restore controls.
 */
import { test, expect, Page } from '/opt/node22/lib/node_modules/playwright/test.mjs'

function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

test.describe('Agents — deep-link pre-fill', () => {
  test('/agents?disease=Pancreatic%20Cancer pre-fills the Disease field', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/agents?disease=Pancreatic%20Cancer')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const diseaseInput = page.locator('input[placeholder*="Pancreatic" i]').first()
    await expect(diseaseInput).toHaveValue(/Pancreatic Cancer/i)
    // Query should be consumed on mount.
    expect(page.url()).not.toMatch(/disease=/)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/agents?type=biomarker pre-selects the Discovery Type dropdown', async ({ page }) => {
    await page.goto('/agents?type=biomarker')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const sel = page.locator('select').first()
    await expect(sel).toHaveValue('biomarker')
    expect(page.url()).not.toMatch(/type=/)
  })

  test('/agents?type=bogus falls back to treatment (default)', async ({ page }) => {
    await page.goto('/agents?type=bogus-not-a-real-type')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const sel = page.locator('select').first()
    await expect(sel).toHaveValue('treatment')
  })

  test('/agents?guidance=… pre-fills the Research Guidance textarea', async ({ page }) => {
    const txt = 'focus on epigenetic mechanisms'
    await page.goto('/agents?guidance=' + encodeURIComponent(txt))
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const guidance = page.locator('textarea').first()
    await expect(guidance).toHaveValue(new RegExp(txt, 'i'))
    expect(page.url()).not.toMatch(/guidance=/)
  })

  test('combined deep-link with all three params pre-fills everything', async ({ page }) => {
    await page.goto('/agents?disease=Breast%20Cancer&type=drug_repurposing&guidance=immunotherapy')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await expect(page.locator('input[placeholder*="Pancreatic" i]').first()).toHaveValue(/Breast Cancer/i)
    await expect(page.locator('select').first()).toHaveValue('drug_repurposing')
    await expect(page.locator('textarea').first()).toHaveValue(/immunotherapy/i)
    const url = page.url()
    expect(url).not.toMatch(/disease=/)
    expect(url).not.toMatch(/type=/)
    expect(url).not.toMatch(/guidance=/)
  })
})

test.describe('Agents — Start button gate', () => {
  test('Start button is disabled when Disease is empty', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const startBtn = page.locator('button:has-text("Start")').first()
    await expect(startBtn).toBeVisible({ timeout: 4000 })
    await expect(startBtn).toBeDisabled()
  })

  test('entering a disease name enables the Start button', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const disease = page.locator('input[placeholder*="Pancreatic" i]').first()
    await disease.fill('Glioblastoma')
    await page.waitForTimeout(200)
    const startBtn = page.locator('button:has-text("Start")').first()
    await expect(startBtn).toBeEnabled()
  })
})

test.describe('Agents — left rail collapse', () => {
  test('collapsing and re-expanding the config rail round-trips cleanly', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/agents')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    // The collapse button has aria-label "Collapse configuration panel".
    const collapse = page.locator('button[aria-label="Collapse configuration panel"]').first()
    await expect(collapse).toBeVisible({ timeout: 4000 })
    // Heading "Discovery Engine" is visible inside the expanded panel.
    const heading = page.locator('h2:has-text("Discovery Engine")').first()
    await expect(heading).toBeVisible()
    await collapse.click()
    await page.waitForTimeout(250)
    // After collapse, the heading is no longer visible (panel is
    // display:none via the `hidden` Tailwind class).
    await expect(heading).toBeHidden()
    // Reload and confirm the preference persisted via localStorage.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await expect(page.locator('h2:has-text("Discovery Engine")').first()).toBeHidden()
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
    // Cleanup: restore expanded state so this test doesn't pollute later
    // tests that assume the default layout.
    await page.evaluate(() => localStorage.setItem('agents-left-collapsed', '0'))
  })
})

test.describe('Agents — config panel fields', () => {
  test('Configuration section exposes Disease / Type / Min Confidence / Guidance', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await expect(page.locator('input[placeholder*="Pancreatic" i]').first()).toBeVisible()
    await expect(page.locator('select').first()).toBeVisible()
    await expect(page.locator('input[type="range"]').first()).toBeVisible()
    await expect(page.locator('textarea').first()).toBeVisible()
  })

  test('Min Confidence slider renders its current value as a percentage label', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const slider = page.locator('input[type="range"]').first()
    await expect(slider).toBeVisible()
    // Default min_confidence is 0.3 → "30%" label. Assert the label pair
    // exists; we don't need to drive the slider from Playwright to
    // confirm the wiring.
    const hasThirty = await page.locator('text=/30%/').count()
    expect(hasThirty).toBeGreaterThan(0)
  })
})
