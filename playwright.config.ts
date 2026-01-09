import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E test configuration for dotdo
 *
 * Features:
 * - CI/CD detection with appropriate reporter selection
 * - Multi-browser testing (Chromium, Firefox, WebKit)
 * - Mobile device testing
 * - Screenshot and trace capture on failure
 * - Configurable retries based on environment
 * - Parallel execution with worker management
 *
 * Tests run against wrangler dev server at localhost:8787
 * The webServer config automatically starts and stops the dev server.
 */

/** Detect CI environment */
const isCI = !!process.env.CI

/** Base URL for the test server */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8787'

export default defineConfig({
  testDir: './tests/e2e',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: isCI,

  /* Retry on CI to handle flaky tests, no retries locally for faster feedback */
  retries: isCI ? 2 : 0,

  /* Limit workers on CI to avoid resource contention */
  workers: isCI ? 1 : undefined,

  /* Reporter configuration */
  reporter: isCI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'testing/playwright-report' }],
        ['json', { outputFile: 'tests/results/e2e-results.json' }],
      ]
    : [['html', { open: 'on-failure', outputFolder: 'testing/playwright-report' }]],

  /* Global test timeout */
  timeout: 30 * 1000,

  /* Expect timeout for assertions */
  expect: {
    timeout: 5000,
  },

  /* Shared settings for all the projects below */
  use: {
    /* Base URL for actions like `await page.goto('/')` */
    baseURL: BASE_URL,

    /* Collect trace when retrying a failed test */
    trace: 'on-first-retry',

    /* Capture screenshot on failure */
    screenshot: 'only-on-failure',

    /* Record video on failure (only in CI to save resources) */
    video: isCI ? 'on-first-retry' : 'off',

    /* Set viewport for consistent rendering */
    viewport: { width: 1280, height: 720 },

    /* Emulate timezone for consistent date handling */
    timezoneId: 'America/Los_Angeles',

    /* Emulate locale for consistent formatting */
    locale: 'en-US',

    /* Accept all cookies by default */
    acceptDownloads: true,

    /* Set navigation timeout */
    navigationTimeout: 30000,

    /* Set action timeout */
    actionTimeout: 10000,
  },

  /* Configure projects for major browsers and devices */
  projects: [
    /* Desktop browsers */
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Mobile browsers */
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },

    /* Tablet */
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],

  /* Output directory for test artifacts */
  outputDir: 'tests/results/e2e',

  /* Preserve output on failure */
  preserveOutput: 'failures-only',

  /* Start wrangler dev server before running tests */
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
