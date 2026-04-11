import { defineConfig } from '/opt/node22/lib/node_modules/playwright/node_modules/@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  },
  webServer: {
    url: 'http://localhost:3001',
    reuseExistingServer: true,
  },
});
