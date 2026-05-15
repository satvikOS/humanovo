/**
 * Playwright auth setup — runs ONCE before the test projects.
 *
 * Since the app now gates every route behind RequireAuth (redirects
 * unauthenticated visitors to /login), every spec would otherwise
 * bounce to the login page. This setup drives the real mock-login
 * flow (1234 / 1234) once and saves the resulting storage state to
 * e2e/.auth/state.json; the `chromium` project loads that state so
 * each test starts already authenticated.
 *
 * Bonus: this also serves as the regression test for the mock-login
 * path itself — if mock auth breaks, the whole suite fails fast at
 * setup with a clear message rather than 50 confusing redirects.
 */
import { test as setup, expect } from '@playwright/test'

const authFile = 'e2e/.auth/state.json'

setup('authenticate via mock login', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill('1234')
  await page.getByTestId('login-password').fill('1234')
  await page.getByTestId('login-submit').click()
  // Mock auth issues a local token and the app redirects to the
  // dashboard. If this wait times out, mock login is broken.
  await page.waitForURL('**/dashboard', { timeout: 15_000 })
  await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 })
  await page.context().storageState({ path: authFile })
})
