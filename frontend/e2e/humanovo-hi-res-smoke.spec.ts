import { test, expect, Page } from '@playwright/test'

/**
 * Hi-res smoke of all recently-changed surfaces. Writes PNGs under
 *   test-results/humanovo-hi-res/
 * for visual review by the developer.
 *
 * Uses a 1440x900 @ 2x device pixel ratio viewport so every screenshot
 * is 2880x1800 — enough resolution to judge typography + alignment.
 */

test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})

async function snap(page: Page, name: string) {
  await page.waitForTimeout(600)
  await page.screenshot({
    path: `test-results/humanovo-hi-res/${name}.png`,
    fullPage: true,
  })
}

test.beforeEach(async ({ page }) => {
  // Suppress noisy uncaught frontend console errors in the stream
  page.on('pageerror', () => { /* ignore — we're snapshot-only */ })
})

test('1 dashboard at root', async ({ page }) => {
  await page.goto('/')
  await snap(page, '01-dashboard')
})

test('2 settings – appearance (default landing)', async ({ page }) => {
  await page.goto('/settings')
  await snap(page, '02-settings-appearance')
})

test('3 settings – usage & billing (NEW)', async ({ page }) => {
  await page.goto('/settings?tab=billing')
  await snap(page, '03-settings-billing')
})

test('4 settings – kg & contributions (NEW)', async ({ page }) => {
  await page.goto('/settings?tab=kg-contributions')
  await snap(page, '04-settings-kg-contributions')
})

test('5 projects list', async ({ page }) => {
  await page.goto('/projects')
  await snap(page, '05-projects-list')
})

test('6 discovery (reverted form-driven)', async ({ page }) => {
  await page.goto('/agents')
  await snap(page, '06-discovery-form')
})

test('7 knowledge graph top-level', async ({ page }) => {
  await page.goto('/knowledge-graph')
  await snap(page, '07-knowledge-graph')
})

test('8 evidence', async ({ page }) => {
  await page.goto('/evidence')
  await snap(page, '08-evidence')
})

test('9 citations library', async ({ page }) => {
  await page.goto('/citations')
  await snap(page, '09-citations')
})

test('10 compute lab', async ({ page }) => {
  await page.goto('/compute')
  await snap(page, '10-compute')
})

test('11 manuscripts', async ({ page }) => {
  await page.goto('/manuscripts')
  await snap(page, '11-manuscripts')
})

test('12 command palette (global Cmd-K)', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press(
    (process.platform === 'darwin' ? 'Meta' : 'Control') + '+k'
  )
  await snap(page, '12-command-palette')
})

test('13 hypothesis detail (if accessible without data)', async ({ page }) => {
  // Visit any known hypothesis route; page usually renders empty-state
  // when no hypothesis exists with that id
  await page.goto('/hypotheses/demo-preview')
  await snap(page, '13-hypothesis-detail-empty')
})
