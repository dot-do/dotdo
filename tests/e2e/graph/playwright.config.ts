/**
 * Playwright E2E Configuration for Graph Tests
 *
 * Specialized configuration for cross-DO graph operation testing.
 * Uses the same base settings as the main E2E config but with
 * graph-specific adjustments.
 *
 * @module tests/e2e/graph/playwright.config
 */

import { defineConfig, devices } from '@playwright/test'

/** Detect CI environment */
const isCI = !!process.env.CI

/** Base URL for the test server */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8787'

export default defineConfig({
  testDir: '.',

  /* Run tests in files in parallel */
  fullyParallel: false, // Graph tests may have ordering dependencies

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: isCI,

  /* Retry on CI to handle flaky tests, no retries locally for faster feedback */
  retries: isCI ? 2 : 0,

  /* Single worker for graph consistency tests */
  workers: 1,

  /* Reporter configuration */
  reporter: isCI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: '../../results/graph-e2e-results.json' }],
      ]
    : [['html', { open: 'on-failure', outputFolder: 'playwright-report' }]],

  /* Global test timeout - graph operations may take longer */
  timeout: 60 * 1000,

  /* Expect timeout for assertions */
  expect: {
    timeout: 10000,
  },

  /* Shared settings for all the projects below */
  use: {
    /* Base URL for actions like `await page.goto('/')` */
    baseURL: BASE_URL,

    /* Collect trace when retrying a failed test */
    trace: 'on-first-retry',

    /* Capture screenshot on failure */
    screenshot: 'only-on-failure',

    /* Set viewport for consistent rendering */
    viewport: { width: 1280, height: 720 },

    /* Set navigation timeout */
    navigationTimeout: 30000,

    /* Set action timeout */
    actionTimeout: 15000,
  },

  /* Configure projects - primarily testing via API, not browser */
  projects: [
    {
      name: 'graph-api',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Output directory for test artifacts */
  outputDir: '../../results/graph-e2e',

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
