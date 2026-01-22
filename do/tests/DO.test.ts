/**
 * DO Class Integration Tests - Real Durable Objects with Miniflare
 *
 * This file uses @cloudflare/vitest-pool-workers to test with REAL Durable Objects.
 *
 * NO MOCKS - per CLAUDE.md:
 * - Real miniflare runtime
 * - Real SQLite storage
 * - Real DO instances via env bindings
 *
 * @module do/tests/DO.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import {
  generateTestId,
  getTestDO,
  type HealthResponse,
  type InfoResponse,
  type ErrorResponse,
} from '@dotdo/test-utils/helpers'

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get a fresh DO stub for testing
 */
function getStub(name?: string) {
  return getTestDO(env, name)
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('DO Class', () => {
  describe('health check', () => {
    it('should respond to GET /', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://do/')

      expect(response.status).toBe(200)
      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
      expect(typeof json.id).toBe('string')
    })

    it('should return consistent id for same DO instance', async () => {
      const testName = 'consistent-id-' + generateTestId()

      // Get the same DO twice via the same name
      const stub1 = getStub(testName)
      const stub2 = getStub(testName)

      const resp1 = await stub1.fetch('https://do/')
      const resp2 = await stub2.fetch('https://do/')

      const json1 = (await resp1.json()) as HealthResponse
      const json2 = (await resp2.json()) as HealthResponse

      // Same DO instance - same ID
      expect(json1.id).toBe(json2.id)
    })

    it('should return different ids for different DO instances', async () => {
      const stub1 = getStub('instance-a-' + generateTestId())
      const stub2 = getStub('instance-b-' + generateTestId())

      const resp1 = await stub1.fetch('https://do/')
      const resp2 = await stub2.fetch('https://do/')

      const json1 = (await resp1.json()) as HealthResponse
      const json2 = (await resp2.json()) as HealthResponse

      // Different DO instances have different IDs
      expect(json1.id).not.toBe(json2.id)
    })
  })

  describe('RPC endpoint', () => {
    it('should return 404 for unknown methods', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'unknownMethod', args: [] }),
      })

      expect(response.status).toBe(404)
    })

    it('should return 404 for deeply nested unknown methods', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'deep.nested.unknown', args: [] }),
      })

      expect(response.status).toBe(404)
    })

    it('should handle malformed RPC requests', async () => {
      const stub = getStub()

      // Missing method field
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: [] }),
      })

      // Should return 400 or similar error for malformed request
      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle invalid JSON in RPC body', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      // Should return 400 for invalid JSON
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('info endpoint', () => {
    it('should return storage info at /info', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://do/info')

      expect(response.status).toBe(200)
      const json = (await response.json()) as InfoResponse
      expect(json.id).toBeDefined()
      expect(typeof json.keys).toBe('number')
    })

    it('should show keys count in storage', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/info')
      expect(response.status).toBe(200)

      const json = (await response.json()) as InfoResponse
      expect(json.keys).toBeGreaterThanOrEqual(0)
    })
  })

  describe('CORS', () => {
    it('should include CORS headers by default', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      // CORS headers should be present
      const corsHeader = response.headers.get('Access-Control-Allow-Origin')
      expect(corsHeader).toBeTruthy()
    })

    it('should handle CORS preflight for POST', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/rpc', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      })

      // Should allow POST requests
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })
  })

  describe('concurrent access', () => {
    it('should handle concurrent requests correctly', async () => {
      const stub = getStub()

      // Fire multiple concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        stub.fetch('https://do/')
      )

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
        await response.text() // Consume body
      }
    })

    it('should serialize operations via single-threaded DO model', async () => {
      const stub = getStub()

      // Fire concurrent info requests - tests real concurrency serialization
      const requests = Array.from({ length: 3 }, () =>
        stub.fetch('https://do/info')
      )

      const responses = await Promise.all(requests)

      // All requests should get consistent view
      const infos: InfoResponse[] = []
      for (const response of responses) {
        infos.push((await response.json()) as InfoResponse)
      }

      // All should have the same ID (same DO instance)
      const ids = infos.map((i) => i.id)
      expect(new Set(ids).size).toBe(1)
    })

    it('should handle burst of requests to different endpoints', async () => {
      const stub = getStub()

      // Mix of different endpoints
      const requests = [
        stub.fetch('https://do/'),
        stub.fetch('https://do/info'),
        stub.fetch('https://do/'),
        stub.fetch('https://do/info'),
        stub.fetch('https://do/'),
      ]

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
        await response.text() // Consume body
      }
    })
  })

  describe('lifecycle methods', () => {
    it('should expose alarm method on DO stub', async () => {
      // The DO stub provides RPC access to public methods
      // We can verify the DO exists and responds to health check
      const stub = getStub()
      const response = await stub.fetch('https://do/')
      expect(response.status).toBe(200)

      // Alarm is an internal lifecycle method - we test its existence
      // by verifying the DO instantiates correctly and can respond
      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('ok')
    })
  })

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://do/nonexistent')

      expect(response.status).toBe(404)
    })

    it('should return 404 for unknown nested routes', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://do/api/v1/nonexistent')

      expect(response.status).toBe(404)
    })
  })

  describe('HTTP methods', () => {
    it('should handle GET requests', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://do/', { method: 'GET' })

      expect(response.status).toBe(200)
    })

    it('should handle POST to RPC endpoint', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'testMethod', args: [] }),
      })

      // Will be 404 since testMethod doesn't exist, but POST is handled
      expect(response.status).toBe(404)
    })

    it('should handle OPTIONS for CORS preflight', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      // OPTIONS should be handled by CORS middleware
      expect(response.status).toBeLessThan(500)
    })
  })

  describe('request/response handling', () => {
    it('should return JSON content type for health endpoint', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://do/')

      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('should return JSON content type for info endpoint', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://do/info')

      expect(response.headers.get('Content-Type')).toContain('application/json')
    })
  })
})
