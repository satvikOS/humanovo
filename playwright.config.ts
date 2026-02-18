import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'https://d3t0bklraii7g8.cloudfront.net',
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },
  },
})
