import { defineConfig, devices } from '@playwright/test'

// Playwright config for the humanovo frontend.
// - Locally: CI=0, reuses a dev server if already running (faster iteration).
// - CI:      starts its own Vite dev server on a free port and tears it down.
const PORT = Number(process.env.PORT ?? 3001)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Runs auth.setup.ts first — mock-logs-in once and saves the
    // authenticated storage state. Required because the app now
    // gates all routes behind RequireAuth.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Every test inherits the logged-in localStorage token.
        storageState: 'e2e/.auth/state.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // In CI: spin up a fresh dev server. Locally: reuse one if present.
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
