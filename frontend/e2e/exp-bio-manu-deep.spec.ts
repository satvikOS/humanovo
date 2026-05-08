/**
 * ExperimentTracker, BiobankManager, ManuscriptManager — deep-link
 * query-string parity checks. Keeps the consume-and-clean pattern
 * (`?add=1`, `?q=`, `?id=`, `?view=`, `?status=`, `?type=`) in lock-
 * step with the other sidebar tools covered in prior batches.
 */
import { test, expect, Page } from '@playwright/test'

// All routes covered here (/experiment-tracker, /biobank, /manuscripts)
// are short-circuited to /dashboard by the V1Gate in App.tsx
// (isHiddenInV1). Re-enable when VITE_V1_HIDDEN_ROUTES_ENABLED=true
// ships in v1.1.
test.beforeEach(async () => {
  test.skip(true, 'V1-hidden route — see App.tsx V1Gate')
})

function attachErrorCapture(page: Page, bag: string[]) {
  page.on('pageerror', e => bag.push('PAGEERROR: ' + e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/500|407|ECONNREFUSED|Failed to load resource|favicon|net::ERR/i.test(t)) return
    bag.push('CONSOLE: ' + t)
  })
}

async function waitHeading(page: Page, text: RegExp | string) {
  await page.locator('h1, h2', { hasText: text }).first().waitFor({ timeout: 10000 })
}

test.describe('ExperimentTracker — deep-link ?add=1 / ?status= / ?id=', () => {
  test('/experiment-tracker renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/experiment-tracker')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Experiment/i)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/experiment-tracker?add=1 cleans the query without crash', async ({ page }) => {
    await page.goto('/experiment-tracker?add=1')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Experiment/i)
    await page.waitForFunction(() => !window.location.search.includes('add='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/add=1/)
  })

  test('/experiment-tracker?status=planned cleans the query', async ({ page }) => {
    await page.goto('/experiment-tracker?status=planned')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Experiment/i)
    await page.waitForFunction(() => !window.location.search.includes('status='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/status=/)
  })

  test('/experiment-tracker?status=totally-bogus falls back (no crash)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/experiment-tracker?status=totally-bogus-value')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Experiment/i)
    await page.waitForFunction(() => !window.location.search.includes('status='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/experiment-tracker?id=made-up&add=1 consumes both params', async ({ page }) => {
    await page.goto('/experiment-tracker?id=made-up-exp-xyz&add=1')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Experiment/i)
    await page.waitForFunction(() => !window.location.search.includes('add=') && !window.location.search.includes('id='), null, { timeout: 5000 })
    const url = page.url()
    expect(url).not.toMatch(/add=1/)
    expect(url).not.toMatch(/id=/)
  })
})

test.describe('BiobankManager — deep-link ?add=1 / ?view= / ?q= / ?status= / ?type= / ?id=', () => {
  test('/biobank renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/biobank')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Biobank/i)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/biobank?add=1 cleans the query', async ({ page }) => {
    await page.goto('/biobank?add=1')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Biobank/i)
    await page.waitForFunction(() => !window.location.search.includes('add='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/add=1/)
  })

  test('/biobank?view=inventory cleans the query', async ({ page }) => {
    await page.goto('/biobank?view=inventory')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Biobank/i)
    await page.waitForFunction(() => !window.location.search.includes('view='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/view=/)
  })

  test('/biobank?view=bogus falls back to list (no crash)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/biobank?view=totally-bogus')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Biobank/i)
    await page.waitForFunction(() => !window.location.search.includes('view='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/biobank?q=foo&status=available&type=tissue consumes all three', async ({ page }) => {
    await page.goto('/biobank?q=foo&status=available&type=tissue')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Biobank/i)
    await page.waitForFunction(() => {
      const s = window.location.search
      return !s.includes('q=') && !s.includes('status=') && !s.includes('type=')
    }, null, { timeout: 5000 })
    const url = page.url()
    expect(url).not.toMatch(/q=/)
    expect(url).not.toMatch(/status=/)
    expect(url).not.toMatch(/type=/)
  })
})

test.describe('ManuscriptManager — deep-link ?add=1 / ?id=', () => {
  test('/manuscripts renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/manuscripts')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Manuscript/i)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/manuscripts?add=1 cleans the query', async ({ page }) => {
    await page.goto('/manuscripts?add=1')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Manuscript/i)
    await page.waitForFunction(() => !window.location.search.includes('add='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/add=1/)
  })

  test('/manuscripts?id=made-up cleans the query', async ({ page }) => {
    await page.goto('/manuscripts?id=made-up-manuscript-xyz')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Manuscript/i)
    await page.waitForFunction(() => !window.location.search.includes('id='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/id=/)
  })
})
