/**
 * Layout — Notifications dropdown rows should behave like ActivityFeed
 * rows: clicking a notification navigates to the matching index page
 * (projects, evidence, notebook, etc.) and closes the dropdown.
 */
import { test, expect, Page } from '/opt/node22/lib/node_modules/playwright/test.mjs'

async function seedActivity(page: Page, entries: Array<{ type: string; action: string; title: string }>) {
  await page.goto('/dashboard')
  await page.evaluate((rows) => {
    const now = new Date().toISOString()
    const log = rows.map((r, i) => ({
      id: `notif-${i}-${Date.now()}`,
      type: r.type,
      action: r.action,
      title: r.title,
      timestamp: now,
      created_at: now,
    }))
    try { localStorage.setItem('humanovo-activity-log', JSON.stringify(log)) } catch {}
    try { localStorage.setItem('humanovo-notifs-read', '0') } catch {}
  }, entries)
}

async function openBell(page: Page) {
  await page.locator('button[aria-label="Notifications"]').first().click()
}

test.describe('Layout — Notifications dropdown clickable rows', () => {
  test('project notification routes to /projects', async ({ page }) => {
    await seedActivity(page, [{ type: 'project', action: 'created', title: 'Layout project Foo' }])
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await openBell(page)
    const row = page.locator('button', { hasText: 'Layout project Foo' }).first()
    await row.waitFor({ timeout: 3000 })
    await row.click()
    await page.waitForURL('**/projects**', { timeout: 5000 })
    expect(page.url()).toMatch(/\/projects/)
  })

  test('evidence notification routes to /evidence', async ({ page }) => {
    await seedActivity(page, [{ type: 'evidence', action: 'imported', title: 'Layout evidence item' }])
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await openBell(page)
    const row = page.locator('button', { hasText: 'Layout evidence item' }).first()
    await row.waitFor({ timeout: 3000 })
    await row.click()
    await page.waitForURL('**/evidence**', { timeout: 5000 })
    expect(page.url()).toMatch(/\/evidence/)
  })

  test('notebook notification routes to /notebook', async ({ page }) => {
    await seedActivity(page, [{ type: 'notebook', action: 'updated', title: 'Layout notebook entry' }])
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await openBell(page)
    const row = page.locator('button', { hasText: 'Layout notebook entry' }).first()
    await row.waitFor({ timeout: 3000 })
    await row.click()
    await page.waitForURL('**/notebook**', { timeout: 5000 })
    expect(page.url()).toMatch(/\/notebook/)
  })

  test('unknown-type notification is disabled (no navigation)', async ({ page }) => {
    await seedActivity(page, [{ type: 'unknown_type_xyz', action: 'happened', title: 'Layout unknown row' }])
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    await openBell(page)
    const row = page.locator('button', { hasText: 'Layout unknown row' }).first()
    await row.waitFor({ timeout: 3000 })
    await expect(row).toBeDisabled()
    const before = page.url()
    await row.click({ force: true }).catch(() => {})
    await page.waitForTimeout(300)
    expect(page.url()).toBe(before)
  })
})
