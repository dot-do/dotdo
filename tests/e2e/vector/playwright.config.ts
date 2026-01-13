/**
 * Playwright E2E Configuration for Vector Tests
 *
 * Specialized configuration for VectorManager E2E testing.
 * Tests vector operations across tiered backends with conditional
 * skipping when real backends are not available.
 *
 * @module tests/e2e/vector/playwright.config
 */

import { defineConfig, devices } from '@playwright/test'

/** Detect CI environment */
const isCI = !!process.env.CI

/** Base URL for the test server */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8787'

export default defineConfig({
  testDir: '.',

  /* Run tests in files in parallel */
  fullyParallel: false, // Vector tests may have ordering dependencies

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: isCI,

  /* Retry on CI to handle flaky tests, no retries locally for faster feedback */
  retries: isCI ? 2 : 0,

  /* Single worker for vector consistency tests */
  workers: 1,

  /* Reporter configuration */
  reporter: isCI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: '../../results/vector-e2e-results.json' }],
      ]
    : [['html', { open: 'on-failure', outputFolder: 'playwright-report' }]],

  /* Global test timeout - vector operations may take longer */
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
      name: 'vector-api',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Output directory for test artifacts */
  outputDir: '../../results/vector-e2e',

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
