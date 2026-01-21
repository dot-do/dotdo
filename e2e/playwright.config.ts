/**
 * Playwright Configuration for Browser E2E Tests
 *
 * Tests critical user journeys in a real browser environment:
 * - Page navigation and rendering
 * - UI component interactions
 * - Authentication flows
 * - Real-time WebSocket updates
 * - Error handling and recovery
 *
 * Run with:
 *   npx playwright test                    # All browser tests
 *   npx playwright test --headed           # Watch mode with visible browser
 *   npx playwright test --ui               # Interactive UI mode
 *
 * @see https://playwright.dev/docs/test-configuration
 * @see do-o4sii
 */
import { defineConfig, devices } from '@playwright/test'

/**
 * Base URL for the TanStack Start app
 * Can be overridden with PLAYWRIGHT_BASE_URL env var
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

/**
 * API URL for backend testing
 * Can be overridden with PLAYWRIGHT_API_URL env var
 */
const apiURL = process.env.PLAYWRIGHT_API_URL || process.env.WORKER_URL || 'http://localhost:8787'

export default defineConfig({
  testDir: './browser',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI for consistency */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter configuration */
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/playwright-junit.xml' }],
      ]
    : [['html', { open: 'never' }]],

  /* Global timeout for tests */
  timeout: 60000,

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL,

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure for debugging */
    video: process.env.CI ? 'on-first-retry' : 'off',

    /* Extra HTTP headers for API requests */
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Enable additional browsers for CI testing
    ...(process.env.CI
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
          },
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
          },
        ]
      : []),
    // Mobile viewport tests
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  /* Run local dev server before starting the tests */
  webServer: [
    {
      command: 'cd ../app && npm run dev',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // Optionally start the API worker if needed
    ...(process.env.START_API_SERVER
      ? [
          {
            command: 'cd ../api && npm run dev',
            url: apiURL,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
        ]
      : []),
  ],

  /* Output folder for test artifacts */
  outputDir: 'test-results',

  /* Expect configuration */
  expect: {
    /* Maximum time expect() should wait for the condition to be met */
    timeout: 10000,
  },
})
