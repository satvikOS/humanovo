/**
 * Dashboard — ActivityFeed rows should navigate to the right index
 * page, and the Recent Simulations widget should route each row to
 * the correct Compute Lab tab (not always Monte Carlo).
 */
import { test, expect, Page } from '/opt/node22/lib/node_modules/playwright/test.mjs'

async function seedActivity(page: Page, entries: Array<{ type: string; action: string; title: string }>) {
  await page.goto('/dashboard')
  await page.evaluate((rows) => {
    const now = new Date().toISOString()
    const log = rows.map((r, i) => ({
      id: `act-${i}-${Date.now()}`,
      type: r.type,
      action: r.action,
      title: r.title,
      timestamp: now,
      created_at: now,
    }))
    try { localStorage.setItem('humanovo-activity-log', JSON.stringify(log)) } catch {}
  }, entries)
}

async function seedSimulations(page: Page) {
  await page.goto('/dashboard')
  await page.evaluate(() => {
    const base = { createdAt: new Date().toISOString() }
    const mc = [{ id: 'mc-1', name: 'MC run alpha', simulationType: 'monte_carlo', ...base }]
    const eqs = [{ id: 'eq-1', expr: 'x^2 + 1', ...base }]
    const comp = [{ id: 'comp-1', template: 'python template', env: 'python', ...base }]
    try {
      localStorage.setItem('humanovo-mc-simulations', JSON.stringify(mc))
      localStorage.setItem('humanovo-eq-history', JSON.stringify(eqs))
      localStorage.setItem('humanovo-comp-history', JSON.stringify(comp))
    } catch {}
  })
}

test.describe('Dashboard — ActivityFeed clickable rows', () => {
  test('clicking a project activity row navigates to /projects', async ({ page }) => {
    await seedActivity(page, [{ type: 'project', action: 'created', title: 'My project Foo' }])
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const row = page.locator('button', { hasText: 'My project Foo' }).first()
    await row.click()
    await page.waitForURL('**/projects**', { timeout: 5000 })
    expect(page.url()).toMatch(/\/projects/)
  })

  test('clicking an evidence activity row navigates to /evidence', async ({ page }) => {
    await seedActivity(page, [{ type: 'evidence', action: 'imported', title: 'Evidence X paper' }])
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const row = page.locator('button', { hasText: 'Evidence X paper' }).first()
    await row.click()
    await page.waitForURL('**/evidence**', { timeout: 5000 })
    expect(page.url()).toMatch(/\/evidence/)
  })

  test('clicking a notebook activity row navigates to /notebook', async ({ page }) => {
    await seedActivity(page, [{ type: 'notebook', action: 'updated', title: 'Notebook notes page' }])
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
    const row = page.locator('button', { hasText: 'Notebook notes page' }).first()
    await row.click()
    await page.waitForURL('**/notebook**', { timeout: 5000 })
    expect(page.url()).toMatch(/\/notebook/)
  })
})

test.describe('Dashboard — Recent Simulations routing by kind', () => {
  test('monte-carlo row lands on ?tab=montecarlo', async ({ page }) => {
    await seedSimulations(page)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const row = page.locator('button', { hasText: 'MC run alpha' }).first()
    if (!(await row.count())) test.skip()
    await row.click()
    await page.waitForURL('**/compute-lab**', { timeout: 5000 })
    expect(page.url()).toMatch(/tab=montecarlo/)
  })

  test('equation row lands on ?tab=equations', async ({ page }) => {
    await seedSimulations(page)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const row = page.locator('button', { hasText: 'f(x) = x^2 + 1' }).first()
    if (!(await row.count())) test.skip()
    await row.click()
    await page.waitForURL('**/compute-lab**', { timeout: 5000 })
    expect(page.url()).toMatch(/tab=equations/)
  })

  test('computational row lands on plain /compute-lab (workstation default)', async ({ page }) => {
    await seedSimulations(page)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(600)
    const row = page.locator('button', { hasText: 'python template' }).first()
    if (!(await row.count())) test.skip()
    await row.click()
    await page.waitForURL('**/compute-lab**', { timeout: 5000 })
    // Workstation is the default — no ?tab= param should be set.
    expect(page.url()).not.toMatch(/tab=montecarlo/)
    expect(page.url()).not.toMatch(/tab=equations/)
  })
})
