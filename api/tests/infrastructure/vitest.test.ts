/**
 * Vitest Infrastructure Tests
 *
 * These tests verify that the Vitest testing infrastructure is properly
 * configured for Cloudflare Workers development.
 *
 * NOTE: These tests require the @cloudflare/vitest-pool-workers to be properly
 * configured and running. The cloudflare:test imports are only available when
 * running in the Workers pool environment.
 *
 * Run with: npx vitest run --project=workers api/tests/infrastructure/vitest.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Conditionally import cloudflare:test - it's only available in the Workers pool
// These imports will fail when running outside of @cloudflare/vitest-pool-workers
let env: any
let SELF: any
let fetchMock: any
let cloudflareTestAvailable = false

try {
  // Dynamic import of cloudflare:test
  // This module is provided by @cloudflare/vitest-pool-workers at runtime
  const cloudflareTest = await import('cloudflare:test')
  env = cloudflareTest.env
  SELF = cloudflareTest.SELF
  fetchMock = cloudflareTest.fetchMock
  cloudflareTestAvailable = true
} catch {
  // cloudflare:test not available - tests will be skipped
  cloudflareTestAvailable = false
}

describe('Vitest Infrastructure', () => {
  describe('vitest.workspace.ts', () => {
    it('should exist and export valid workspace config', async () => {
      // This test verifies the workspace config file exists by attempting to import it
      // The workspace file defines all test projects including the workers project
      const workspaceModule = await import('../../../vitest.workspace')
      expect(workspaceModule).toBeDefined()
      expect(workspaceModule.default).toBeDefined()
      expect(Array.isArray(workspaceModule.default)).toBe(true)
    })

    it('should have workers project defined in workspace', async () => {
      const workspaceModule = await import('../../../vitest.workspace')
      const workspace = workspaceModule.default as Array<{ test?: { name?: string } }>

      // Find the workers project
      const workersProject = workspace.find(p => p.test?.name === 'workers')
      expect(workersProject).toBeDefined()
    })

    it('should have workers config that extends vitest.workers.config.ts', async () => {
      // The workers config should be properly set up
      // If we're running in the workers pool, this test proves it works
      const workersConfig = await import('../../../tests/config/vitest.workers.config')
      expect(workersConfig).toBeDefined()
      expect(workersConfig.default).toBeDefined()
      expect(workersConfig.default.test?.pool).toBe('@cloudflare/vitest-pool-workers')
    })
  })

  describe('cloudflare:test imports', () => {
    it.skipIf(!cloudflareTestAvailable)('should be able to import env from cloudflare:test', () => {
      // env provides access to bindings defined in vitest.config.ts
      // This will fail if @cloudflare/vitest-pool-workers is not configured
      expect(env).toBeDefined()
      expect(typeof env).toBe('object')
    })

    it.skipIf(!cloudflareTestAvailable)('should be able to import SELF from cloudflare:test', () => {
      // SELF is a Fetcher that sends requests to the worker under test
      // This will fail if the pool workers configuration is missing
      expect(SELF).toBeDefined()
      expect(typeof SELF.fetch).toBe('function')
    })

    it.skipIf(!cloudflareTestAvailable)('should have fetchMock available from cloudflare:test', () => {
      // fetchMock allows mocking outbound fetch requests
      // This is provided by @cloudflare/vitest-pool-workers
      expect(fetchMock).toBeDefined()
      expect(typeof fetchMock.activate).toBe('function')
      expect(typeof fetchMock.deactivate).toBe('function')
      expect(typeof fetchMock.get).toBe('function')
      expect(typeof fetchMock.post).toBe('function')
    })
  })

  describe.skipIf(!cloudflareTestAvailable)('Test Isolation', () => {
    // These tests verify that storage is properly isolated between tests
    // Each test should start with a clean slate
    // NOTE: These tests require cloudflare:test to be available (Workers pool)

    const STORAGE_KEY = 'test-isolation-key'
    const STORAGE_VALUE = 'test-value-' + Math.random()

    beforeEach(() => {
      // Storage should be reset before each test
      // This is handled by @cloudflare/vitest-pool-workers
    })

    it('should start with empty storage (test 1)', async () => {
      // Verify storage is empty at test start
      // This requires a KV namespace binding in vitest.config.ts
      if (!env?.TEST_KV) {
        throw new Error('TEST_KV binding not configured in vitest.config.ts')
      }

      const existingValue = await env.TEST_KV.get(STORAGE_KEY)
      expect(existingValue).toBeNull()

      // Write a value that should NOT persist to next test
      await env.TEST_KV.put(STORAGE_KEY, STORAGE_VALUE)
      const storedValue = await env.TEST_KV.get(STORAGE_KEY)
      expect(storedValue).toBe(STORAGE_VALUE)
    })

    it('should start with empty storage (test 2)', async () => {
      // This test runs after test 1
      // If isolation works, the value written in test 1 should NOT exist
      if (!env?.TEST_KV) {
        throw new Error('TEST_KV binding not configured in vitest.config.ts')
      }

      const existingValue = await env.TEST_KV.get(STORAGE_KEY)

      // This assertion proves test isolation:
      // If it fails, storage is NOT being reset between tests
      expect(existingValue).toBeNull()
    })

    it('should isolate Durable Object storage between tests (test 1)', async () => {
      // Verify DO storage isolation
      if (!env?.TEST_DO) {
        throw new Error('TEST_DO binding not configured in vitest.config.ts')
      }

      const id = env.TEST_DO.idFromName('isolation-test')
      const stub = env.TEST_DO.get(id)

      // Make a request that stores data
      const response = await stub.fetch('http://test/store', {
        method: 'POST',
        body: JSON.stringify({ key: STORAGE_KEY, value: STORAGE_VALUE }),
      })
      expect(response.ok).toBe(true)
    })

    it('should isolate Durable Object storage between tests (test 2)', async () => {
      // Verify DO storage was reset from test 1
      if (!env?.TEST_DO) {
        throw new Error('TEST_DO binding not configured in vitest.config.ts')
      }

      const id = env.TEST_DO.idFromName('isolation-test')
      const stub = env.TEST_DO.get(id)

      // The data from test 1 should NOT exist
      const response = await stub.fetch(`http://test/get?key=${STORAGE_KEY}`)
      const data = (await response.json()) as { value?: unknown }

      // This proves DO storage isolation works
      expect(data.value).toBeNull()
    })
  })
})
