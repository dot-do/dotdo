/**
 * Playwright E2E configuration for CLI tests
 *
 * Unlike the main E2E tests, CLI tests:
 * - Do NOT use the webServer config (each test manages its own server)
 * - Run sequentially to avoid port conflicts
 * - Use longer timeouts for server startup
 * - Target specific example directories
 */

import { defineConfig } from '@playwright/test'

/** Detect CI environment */
const isCI = !!process.env.CI

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',

  /* Run tests sequentially - each test starts its own server */
  fullyParallel: false,
  workers: 1,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: isCI,

  /* Retry on CI to handle flaky tests */
  retries: isCI ? 2 : 0,

  /* Reporter configuration */
  reporter: isCI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: '../../../results/cli-e2e-results.json' }],
      ]
    : [['html', { open: 'on-failure', outputFolder: 'playwright-report' }]],

  /* Longer timeout for server startup tests */
  timeout: 60 * 1000,

  /* Expect timeout for assertions */
  expect: {
    timeout: 10000,
  },

  /* Shared settings */
  use: {
    /* Collect trace when retrying a failed test */
    trace: 'on-first-retry',

    /* Capture screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Projects - just chromium for CLI tests */
  projects: [
    {
      name: 'cli-e2e',
      testMatch: '**/*.spec.ts',
    },
  ],

  /* Output directory for test artifacts */
  outputDir: '../../../results/cli-e2e',

  /* NO webServer - each test manages its own server lifecycle */
})
