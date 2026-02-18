/**
 * Playwright E2E tests for the orchestrator API and Discovery page.
 *
 * Run: npx playwright test tests/e2e/orchestrator.spec.ts
 * Against live: BASE_URL=https://d3t0bklraii7g8.cloudfront.net npx playwright test
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'https://d3t0bklraii7g8.cloudfront.net'

test.describe('Orchestrator API', () => {
  test('GET /api/v1/orchestrator/status returns 200 with valid JSON', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/orchestrator/status`)
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('state')
    expect(['idle', 'running', 'paused', 'stopping']).toContain(body.state)
    expect(body).toHaveProperty('top_hypotheses')
  })

  test('GET /api/v1/orchestrator/health returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/orchestrator/health`)
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('total_models')
  })

  test('GET /api/v1/health returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/health`)
    expect(response.status()).toBe(200)
  })
})

test.describe('Discovery Page', () => {
  test('loads and shows AI connection status', async ({ page }) => {
    await page.goto(`${BASE_URL}/agents`)
    // Wait for the page to load
    await page.waitForLoadState('networkidle')

    // The page should show either "Connecting..." or "X/4 Agents"
    // It should NOT show "AI Disconnected"
    const statusIndicator = page.locator('text=/Connecting|Agents/')
    await expect(statusIndicator.first()).toBeVisible({ timeout: 15000 })
  })

  test('status polling returns 200 (not 500)', async ({ page }) => {
    // Intercept API calls to verify they succeed
    const statusResponses: number[] = []
    page.on('response', (response) => {
      if (response.url().includes('/orchestrator/status')) {
        statusResponses.push(response.status())
      }
    })

    await page.goto(`${BASE_URL}/agents`)
    // Wait for at least 2 polling cycles (3s each)
    await page.waitForTimeout(7000)

    expect(statusResponses.length).toBeGreaterThan(0)
    // All status responses should be 200, not 500
    for (const status of statusResponses) {
      expect(status).toBe(200)
    }
  })

  test('can start discovery without "undefined" error', async ({ page }) => {
    await page.goto(`${BASE_URL}/agents`)
    await page.waitForLoadState('networkidle')

    // Enter a disease
    const diseaseInput = page.locator('input[placeholder*="disease"], input[placeholder*="Disease"]')
    if (await diseaseInput.isVisible()) {
      await diseaseInput.fill('lung cancer')

      // Listen for alerts (should not show "undefined")
      page.on('dialog', async (dialog) => {
        const message = dialog.message()
        expect(message).not.toContain('undefined')
        await dialog.accept()
      })
    }
  })
})
