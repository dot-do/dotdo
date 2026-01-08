/**
 * Vitest Infrastructure Tests
 *
 * These tests verify that the Vitest testing infrastructure is properly
 * configured for Cloudflare Workers development.
 *
 * Tests will FAIL until vitest.config.ts is created with proper configuration.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env, SELF, fetchMock } from 'cloudflare:test'

describe('Vitest Infrastructure', () => {
  describe('vitest.config.ts', () => {
    it('should exist and export valid config', async () => {
      // This test verifies the config file exists by attempting to import it
      // It will fail if vitest.config.ts doesn't exist or has invalid syntax
      const configModule = await import('../../../vitest.config')
      expect(configModule).toBeDefined()
      expect(configModule.default).toBeDefined()
    })

    it('should have @cloudflare/vitest-pool-workers configured', async () => {
      const configModule = await import('../../../vitest.config')
      const config = configModule.default

      // Verify poolOptions.workers is configured
      expect(config.test).toBeDefined()
      expect(config.test?.poolOptions).toBeDefined()
      expect(config.test?.poolOptions?.workers).toBeDefined()

      // Verify it uses the cloudflare workers pool
      expect(config.test?.pool).toBe('@cloudflare/vitest-pool-workers')
    })
  })

  describe('cloudflare:test imports', () => {
    it('should be able to import env from cloudflare:test', () => {
      // env provides access to bindings defined in vitest.config.ts
      // This will fail if @cloudflare/vitest-pool-workers is not configured
      expect(env).toBeDefined()
      expect(typeof env).toBe('object')
    })

    it('should be able to import SELF from cloudflare:test', () => {
      // SELF is a Fetcher that sends requests to the worker under test
      // This will fail if the pool workers configuration is missing
      expect(SELF).toBeDefined()
      expect(typeof SELF.fetch).toBe('function')
    })

    it('should have fetchMock available from cloudflare:test', () => {
      // fetchMock allows mocking outbound fetch requests
      // This is provided by @cloudflare/vitest-pool-workers
      expect(fetchMock).toBeDefined()
      expect(typeof fetchMock.activate).toBe('function')
      expect(typeof fetchMock.deactivate).toBe('function')
      expect(typeof fetchMock.get).toBe('function')
      expect(typeof fetchMock.post).toBe('function')
    })
  })

  describe('Test Isolation', () => {
    // These tests verify that storage is properly isolated between tests
    // Each test should start with a clean slate

    const STORAGE_KEY = 'test-isolation-key'
    const STORAGE_VALUE = 'test-value-' + Math.random()

    beforeEach(() => {
      // Storage should be reset before each test
      // This is handled by @cloudflare/vitest-pool-workers
    })

    it('should start with empty storage (test 1)', async () => {
      // Verify storage is empty at test start
      // This requires a KV namespace binding in vitest.config.ts
      if (!env.TEST_KV) {
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
      if (!env.TEST_KV) {
        throw new Error('TEST_KV binding not configured in vitest.config.ts')
      }

      const existingValue = await env.TEST_KV.get(STORAGE_KEY)

      // This assertion proves test isolation:
      // If it fails, storage is NOT being reset between tests
      expect(existingValue).toBeNull()
    })

    it('should isolate Durable Object storage between tests (test 1)', async () => {
      // Verify DO storage isolation
      if (!env.TEST_DO) {
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
      if (!env.TEST_DO) {
        throw new Error('TEST_DO binding not configured in vitest.config.ts')
      }

      const id = env.TEST_DO.idFromName('isolation-test')
      const stub = env.TEST_DO.get(id)

      // The data from test 1 should NOT exist
      const response = await stub.fetch(`http://test/get?key=${STORAGE_KEY}`)
      const data = await response.json()

      // This proves DO storage isolation works
      expect(data.value).toBeNull()
    })
  })
})
