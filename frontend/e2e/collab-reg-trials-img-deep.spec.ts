/**
 * Collaboration, RegulatoryCompliance, ClinicalTrials, ResearchImaging —
 * deep-link query-string parity checks. Consume-and-clean `?tab=`,
 * `?view=`, `?add=1`, `?id=`, `?q=`, `?modality=` so every sidebar
 * tool behaves identically for cross-page links.
 */
import { test, expect, Page } from '@playwright/test'

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

test.describe('Collaboration — deep-link ?tab=', () => {
  const tabs = ['team', 'comments', 'shares', 'notifications', 'audit'] as const
  test('/collaboration base renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/collaboration')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Collaboration|Team|Comments/i)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  for (const t of tabs) {
    test(`/collaboration?tab=${t} renders and cleans the query`, async ({ page }) => {
      await page.goto(`/collaboration?tab=${t}`)
      await page.waitForLoadState('domcontentloaded')
      await waitHeading(page, /Collaboration|Team|Comments/i)
      await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
      expect(page.url()).not.toMatch(/tab=/)
    })
  }

  test('/collaboration?tab=bogus falls back to team (no crash)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/collaboration?tab=totally-bogus-tab')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Collaboration|Team/i)
    await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })
})

test.describe('RegulatoryCompliance — deep-link ?tab=', () => {
  const tabs = ['irb', 'agreements', 'consent', 'checklists'] as const
  test('/regulatory base renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/regulatory')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Regulatory|Compliance/i)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  for (const t of tabs) {
    test(`/regulatory?tab=${t} renders and cleans the query`, async ({ page }) => {
      await page.goto(`/regulatory?tab=${t}`)
      await page.waitForLoadState('domcontentloaded')
      await waitHeading(page, /Regulatory|Compliance/i)
      await page.waitForFunction(() => !window.location.search.includes('tab='), null, { timeout: 5000 })
      expect(page.url()).not.toMatch(/tab=/)
    })
  }
})

test.describe('ClinicalTrials — deep-link ?add=1 / ?view= / ?id=', () => {
  test('/clinical-trials renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/clinical-trials')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Clinical Trial/i)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/clinical-trials?add=1 cleans the query', async ({ page }) => {
    await page.goto('/clinical-trials?add=1')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Clinical Trial/i)
    await page.waitForFunction(() => !window.location.search.includes('add='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/add=1/)
  })

  test('/clinical-trials?view=subjects cleans the query', async ({ page }) => {
    await page.goto('/clinical-trials?view=subjects')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Clinical Trial/i)
    await page.waitForFunction(() => !window.location.search.includes('view='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/view=/)
  })

  test('/clinical-trials?view=totally-bogus falls back (no crash)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/clinical-trials?view=totally-bogus')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Clinical Trial/i)
    await page.waitForFunction(() => !window.location.search.includes('view='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/clinical-trials?id=made-up&add=1 consumes both params', async ({ page }) => {
    await page.goto('/clinical-trials?id=made-up-trial-xyz&add=1')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Clinical Trial/i)
    await page.waitForFunction(() => {
      const s = window.location.search
      return !s.includes('add=') && !s.includes('id=')
    }, null, { timeout: 5000 })
    const url = page.url()
    expect(url).not.toMatch(/add=1/)
    expect(url).not.toMatch(/id=/)
  })
})

test.describe('ResearchImaging — deep-link ?q= / ?modality= / ?id=', () => {
  test('/imaging renders without crash', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/imaging')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Imaging|Research Imaging/i)
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/imaging?q=foo cleans the query', async ({ page }) => {
    await page.goto('/imaging?q=foo')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Imaging/i)
    await page.waitForFunction(() => !window.location.search.includes('q='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/q=/)
  })

  test('/imaging?modality=CT cleans the query', async ({ page }) => {
    await page.goto('/imaging?modality=CT')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Imaging/i)
    await page.waitForFunction(() => !window.location.search.includes('modality='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/modality=/)
  })

  test('/imaging?modality=bogus falls back (no crash)', async ({ page }) => {
    const errs: string[] = []; attachErrorCapture(page, errs)
    await page.goto('/imaging?modality=totally-bogus')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Imaging/i)
    await page.waitForFunction(() => !window.location.search.includes('modality='), null, { timeout: 5000 })
    const boundary = await page.locator('text=/Something went wrong/i').count()
    expect(boundary).toBe(0)
    expect(errs.filter(e => e.includes('Maximum call stack') || e.includes('is not a function'))).toEqual([])
  })

  test('/imaging?id=nonexistent consumes the id (no crash)', async ({ page }) => {
    await page.goto('/imaging?id=made-up-study-xyz')
    await page.waitForLoadState('domcontentloaded')
    await waitHeading(page, /Imaging/i)
    await page.waitForFunction(() => !window.location.search.includes('id='), null, { timeout: 5000 })
    expect(page.url()).not.toMatch(/id=/)
  })
})
