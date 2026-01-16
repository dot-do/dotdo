/**
 * Playwright Configuration for Browser E2E Tests
 *
 * Tests the full user experience in a real browser environment:
 * - Documentation site navigation
 * - UI component interactions
 * - Page rendering and responsiveness
 *
 * Run with:
 *   npx playwright test                    # All browser tests
 *   npx playwright test --headed           # Watch mode with visible browser
 *   npx playwright test --ui               # Interactive UI mode
 *
 * @see https://playwright.dev/docs/test-configuration
 */
import { defineConfig, devices } from '@playwright/test'

/**
 * Base URL for the dev server
 * Can be overridden with PLAYWRIGHT_BASE_URL env var
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/e2e/browser',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI for consistency */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use */
  reporter: process.env.CI
    ? [['html', { outputFolder: 'playwright-report' }], ['junit', { outputFile: 'test-results/playwright-junit.xml' }]]
    : [['html', { open: 'never' }]],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL,

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Add more browsers for CI testing:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'cd app && npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // Give dev server time to start
  },
})
