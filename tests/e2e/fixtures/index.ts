/**
 * E2E Test Fixtures for dotdo
 *
 * This module exports extended Playwright test fixtures with common setup
 * for authentication, API clients, and test data management.
 *
 * Usage:
 *   import { test, expect } from './fixtures'
 *
 * Instead of:
 *   import { test, expect } from '@playwright/test'
 */

import { test as base, expect } from '@playwright/test'
import type { APIRequestContext, Page, BrowserContext } from '@playwright/test'

// Re-export expect for convenience
export { expect }

/**
 * Custom fixture types for dotdo e2e tests
 */
export type TestFixtures = {
  /** API client configured with base URL */
  api: APIRequestContext

  /** Authenticated API client (with auth token) */
  authenticatedApi: APIRequestContext

  /** Page with logged in user session */
  authenticatedPage: Page

  /** Test data helpers */
  testData: TestDataFixture

  /** Console error collector */
  consoleErrors: string[]
}

/**
 * Test data fixture for managing test state
 */
export type TestDataFixture = {
  /** Generate a unique test ID */
  uniqueId: () => string

  /** Create test user data */
  createUser: (overrides?: Partial<TestUser>) => TestUser

  /** Create test thing data */
  createThing: (overrides?: Partial<TestThing>) => TestThing

  /** Cleanup registered test data */
  cleanup: () => Promise<void>
}

export type TestUser = {
  email: string
  name: string
  password: string
}

export type TestThing = {
  name: string
  description?: string
}

/**
 * Extended test with custom fixtures
 *
 * Provides:
 * - api: Pre-configured API request context
 * - authenticatedApi: API context with auth headers
 * - authenticatedPage: Page with user session
 * - testData: Helpers for generating test data
 * - consoleErrors: Collected console errors from the page
 */
export const test = base.extend<TestFixtures>({
  // API client fixture
  api: async ({ request }, use) => {
    await use(request)
  },

  // Authenticated API client fixture
  authenticatedApi: async ({ request }, use) => {
    // TODO: Implement actual authentication when auth is ready
    // For now, use the regular request context
    // In a real implementation, this would get a token and add it to headers
    await use(request)
  },

  // Authenticated page fixture
  authenticatedPage: async ({ page, context }, use) => {
    // TODO: Implement actual authentication when auth is ready
    // This would typically:
    // 1. Navigate to login page
    // 2. Fill in credentials
    // 3. Submit and wait for redirect
    // 4. Or restore a saved auth state from storage state

    // For now, just provide the page
    await use(page)
  },

  // Test data fixture
  testData: async ({}, use) => {
    const createdIds: string[] = []
    let idCounter = 0

    const fixture: TestDataFixture = {
      uniqueId: () => {
        idCounter++
        return `test-${Date.now()}-${idCounter}`
      },

      createUser: (overrides = {}) => {
        const id = fixture.uniqueId()
        return {
          email: `test-${id}@example.com`,
          name: `Test User ${id}`,
          password: 'test-password-123',
          ...overrides,
        }
      },

      createThing: (overrides = {}) => {
        const id = fixture.uniqueId()
        return {
          name: `Test Thing ${id}`,
          ...overrides,
        }
      },

      cleanup: async () => {
        // TODO: Implement cleanup when test data persistence is ready
        // This would delete any test data created during the test
        createdIds.length = 0
      },
    }

    await use(fixture)

    // Cleanup after test
    await fixture.cleanup()
  },

  // Console error collector fixture
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    page.on('pageerror', (error) => {
      errors.push(error.message)
    })

    await use(errors)
  },
})

/**
 * Test configuration helpers
 */
export const testConfig = {
  /** Check if running in CI environment */
  isCI: !!process.env.CI,

  /** Get base URL from config or env */
  baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8787',

  /** Default timeout for assertions */
  assertionTimeout: 5000,

  /** Default timeout for navigation */
  navigationTimeout: 30000,
}
