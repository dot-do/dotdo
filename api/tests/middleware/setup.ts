/**
 * Test setup for middleware tests
 *
 * In vitest-pool-workers, the bundler creates a separate `process.env` object
 * for the test code, distinct from what the middleware sees via globalThis.
 *
 * Tests should use `setTestEnv()` from the middleware module to set environment
 * variables that the middleware can read.
 */

// Define the shared env type
declare global {
  var __WEBHOOKS_TEST_ENV__: Record<string, string | undefined>
}

// Initialize the shared env object on globalThis
globalThis.__WEBHOOKS_TEST_ENV__ = globalThis.__WEBHOOKS_TEST_ENV__ || {}
