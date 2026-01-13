/**
 * Playwright E2E Configuration for MDXUI Routes
 *
 * Configures E2E testing for:
 * - /admin/* routes (DeveloperDashboard from @mdxui/cockpit)
 * - /app/* routes (AppShell from @mdxui/app)
 *
 * Features:
 * - Project-based configuration for admin and app routes
 * - Auth state persistence with role-based fixtures
 * - CI/CD integration with GitHub Actions
 * - Screenshot and trace capture on failure
 * - Parallel execution with configurable workers
 * - Mobile and tablet device testing
 */

import { defineConfig, devices } from '@playwright/test'

/** Detect CI environment */
const isCI = !!process.env.CI

/** Base URL for the TanStack Start dev server */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

/** Auth state storage directories */
const AUTH_STORAGE_DIR = 'tests/e2e/.auth'

export default defineConfig({
  testDir: 'tests/e2e',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if test.only was left in */
  forbidOnly: isCI,

  /* Retry on CI to handle flaky tests */
  retries: isCI ? 2 : 0,

  /* Limit parallel workers on CI to avoid resource contention */
  workers: isCI ? 2 : undefined,

  /* Reporter configuration */
  reporter: isCI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'tests/e2e/playwright-report' }],
        ['json', { outputFile: 'tests/e2e/results/e2e-results.json' }],
        ['junit', { outputFile: 'tests/e2e/results/junit.xml' }],
      ]
    : [['html', { open: 'on-failure', outputFolder: 'tests/e2e/playwright-report' }]],

  /* Global test timeout */
  timeout: 30_000,

  /* Expect timeout for assertions */
  expect: {
    timeout: 5_000,
  },

  /* Shared settings for all projects */
  use: {
    /* Base URL for page.goto('/') */
    baseURL: BASE_URL,

    /* Collect trace on first retry */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure in CI */
    video: isCI ? 'on-first-retry' : 'off',

    /* Consistent viewport */
    viewport: { width: 1280, height: 720 },

    /* Consistent timezone */
    timezoneId: 'America/Los_Angeles',

    /* Consistent locale */
    locale: 'en-US',

    /* Accept downloads */
    acceptDownloads: true,

    /* Navigation timeout */
    navigationTimeout: 30_000,

    /* Action timeout */
    actionTimeout: 10_000,
  },

  /* Project configuration for different route groups and auth states */
  projects: [
    // =========================================================================
    // Setup projects - run first to create auth states
    // =========================================================================
    {
      name: 'setup:admin',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },

    // =========================================================================
    // Admin routes - /admin/* (DeveloperDashboard)
    // =========================================================================
    {
      name: 'admin:chromium',
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: `${AUTH_STORAGE_DIR}/admin.json`,
      },
    },
    {
      name: 'admin:firefox',
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['Desktop Firefox'],
        storageState: `${AUTH_STORAGE_DIR}/admin.json`,
      },
    },
    {
      name: 'admin:webkit',
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['Desktop Safari'],
        storageState: `${AUTH_STORAGE_DIR}/admin.json`,
      },
    },
    {
      name: 'admin:mobile',
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['Pixel 5'],
        storageState: `${AUTH_STORAGE_DIR}/admin.json`,
      },
    },

    // =========================================================================
    // App routes - /app/* (AppShell)
    // =========================================================================
    {
      name: 'app:chromium',
      testMatch: /app\/.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: `${AUTH_STORAGE_DIR}/user.json`,
      },
    },
    {
      name: 'app:firefox',
      testMatch: /app\/.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['Desktop Firefox'],
        storageState: `${AUTH_STORAGE_DIR}/user.json`,
      },
    },
    {
      name: 'app:webkit',
      testMatch: /app\/.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['Desktop Safari'],
        storageState: `${AUTH_STORAGE_DIR}/user.json`,
      },
    },
    {
      name: 'app:mobile',
      testMatch: /app\/.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['Pixel 5'],
        storageState: `${AUTH_STORAGE_DIR}/user.json`,
      },
    },

    // =========================================================================
    // Unauthenticated tests (login, signup, password reset)
    // =========================================================================
    {
      name: 'auth:chromium',
      testMatch: /auth\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // No storage state - unauthenticated
      },
    },

    // =========================================================================
    // Tablet testing
    // =========================================================================
    {
      name: 'tablet',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup:admin'],
      use: {
        ...devices['iPad (gen 7)'],
        storageState: `${AUTH_STORAGE_DIR}/admin.json`,
      },
    },
  ],

  /* Output directory for test artifacts */
  outputDir: 'tests/e2e/results',

  /* Preserve output on failure only */
  preserveOutput: 'failures-only',

  /* Web server configuration for TanStack Start */
  webServer: {
    command: 'npm run dev:app',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  },
})
