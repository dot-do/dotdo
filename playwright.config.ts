import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E test configuration for dotdo
 *
 * Tests run against wrangler dev server at localhost:8787
 * The webServer config automatically starts and stops the dev server.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /* Start wrangler dev server before running tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
