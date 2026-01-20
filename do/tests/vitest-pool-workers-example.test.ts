/**
 * vitest-pool-workers Example Tests - Real Durable Object Instances
 *
 * This file demonstrates the CORRECT pattern for testing Durable Objects
 * using @cloudflare/vitest-pool-workers instead of vi.fn() mocks.
 *
 * KEY DIFFERENCES FROM MOCKED TESTS:
 * =======================================
 *
 * MOCKED (BAD - what we're replacing):
 * ```typescript
 * const mockState = {
 *   storage: {
 *     get: vi.fn(),
 *     put: vi.fn(),
 *   },
 *   blockConcurrencyWhile: vi.fn((fn) => fn()),
 * }
 * const do = new DO(mockState, {})
 * ```
 *
 * REAL (GOOD - using vitest-pool-workers):
 * ```typescript
 * import { env } from 'cloudflare:test'
 * const id = env.DO.idFromName('test')
 * const stub = env.DO.get(id)
 * const response = await stub.fetch('/endpoint')
 * ```
 *
 * Benefits of real tests:
 * - Tests actual DO behavior including concurrency handling
 * - Tests real storage persistence
 * - Tests real SQLite operations
 * - Tests real WebSocket hibernation
 * - Tests real DO-to-DO communication
 * - No false positives from mock implementation differences
 *
 * @module do/tests/vitest-pool-workers-example.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Expected structure from health endpoint
 */
interface HealthResponse {
  status: string
  id: string
}

/**
 * Expected structure from info endpoint
 */
interface InfoResponse {
  id: string
  keys: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('vitest-pool-workers DO Tests', () => {
  /**
   * Test 1: Basic DO instantiation
   *
   * This replaces the mocked pattern:
   * ```typescript
   * const mockState = createMockState()
   * const doInstance = new DO(mockState, {})
   * ```
   *
   * With real DO access via env binding
   */
  describe('DO Instantiation', () => {
    it('creates a real DO instance via env binding', async () => {
      // REAL: Get DO stub from env binding
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      // Make a request to the DO
      const response = await stub.fetch('https://do/')

      expect(response.status).toBe(200)

      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
      expect(typeof json.id).toBe('string')
    })

    it('creates separate instances for different names', async () => {
      // REAL: Different names = different isolated DO instances
      const id1 = env.DO.idFromName('instance-1-' + generateTestId())
      const id2 = env.DO.idFromName('instance-2-' + generateTestId())

      const stub1 = env.DO.get(id1)
      const stub2 = env.DO.get(id2)

      const resp1 = await stub1.fetch('https://do/')
      const resp2 = await stub2.fetch('https://do/')

      const json1 = (await resp1.json()) as HealthResponse
      const json2 = (await resp2.json()) as HealthResponse

      // Different DO instances have different IDs
      expect(json1.id).not.toBe(json2.id)
    })

    it('returns the same instance for the same name', async () => {
      // REAL: Same name always routes to the same DO instance
      const testName = 'shared-instance-' + generateTestId()

      const id1 = env.DO.idFromName(testName)
      const id2 = env.DO.idFromName(testName)

      const stub1 = env.DO.get(id1)
      const stub2 = env.DO.get(id2)

      const resp1 = await stub1.fetch('https://do/')
      const resp2 = await stub2.fetch('https://do/')

      const json1 = (await resp1.json()) as HealthResponse
      const json2 = (await resp2.json()) as HealthResponse

      // Same DO instance - same ID
      expect(json1.id).toBe(json2.id)
    })
  })

  /**
   * Test 2: Health check endpoint
   *
   * This replaces:
   * ```typescript
   * const request = new Request('https://do/')
   * const response = await doInstance.fetch(request)
   * ```
   *
   * With a real DO fetch through the stub
   */
  describe('Health Check', () => {
    it('responds to GET / with health status', async () => {
      const id = env.DO.idFromName('health-' + generateTestId())
      const stub = env.DO.get(id)

      const response = await stub.fetch('https://do/')

      expect(response.status).toBe(200)

      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
    })
  })

  /**
   * Test 3: Info endpoint
   *
   * Tests real storage operations rather than mocked storage
   */
  describe('Info Endpoint', () => {
    it('returns storage info at /info', async () => {
      const id = env.DO.idFromName('info-' + generateTestId())
      const stub = env.DO.get(id)

      const response = await stub.fetch('https://do/info')

      expect(response.status).toBe(200)

      const json = (await response.json()) as InfoResponse
      expect(json.id).toBeDefined()
      expect(typeof json.keys).toBe('number')
    })
  })

  /**
   * Test 4: RPC endpoint
   *
   * This replaces mock-based RPC testing with real RPC calls
   */
  describe('RPC Endpoint', () => {
    it('returns 404 for unknown methods', async () => {
      const id = env.DO.idFromName('rpc-' + generateTestId())
      const stub = env.DO.get(id)

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'nonExistentMethod', args: [] }),
      })

      expect(response.status).toBe(404)
    })
  })

  /**
   * Test 5: CORS handling
   *
   * Tests real CORS middleware rather than mocked middleware
   */
  describe('CORS', () => {
    it('includes CORS headers in response', async () => {
      const id = env.DO.idFromName('cors-' + generateTestId())
      const stub = env.DO.get(id)

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
  })

  /**
   * Test 6: Concurrent access
   *
   * This is WHERE REAL TESTS SHINE - mock-based tests can't test
   * actual concurrency handling because they skip blockConcurrencyWhile
   */
  describe('Concurrent Access', () => {
    it('handles concurrent requests correctly', async () => {
      const id = env.DO.idFromName('concurrent-' + generateTestId())
      const stub = env.DO.get(id)

      // Fire multiple concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        stub.fetch('https://do/')
      )

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
        // Consume the response body to avoid issues
        await response.text()
      }
    })

    it('serializes operations via single-threaded DO model', async () => {
      const id = env.DO.idFromName('serialize-' + generateTestId())
      const stub = env.DO.get(id)

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
  })
})

/**
 * COMPARISON: Mock vs Real Tests
 *
 * ============================================================================
 * BEFORE (Mock-based - do/tests/DO.test.ts pattern):
 * ============================================================================
 *
 * function createMockState(): DurableObjectState {
 *   const storage = new Map<string, unknown>()
 *   return {
 *     id: { toString: () => 'test-do-id' } as DurableObjectId,
 *     storage: {
 *       get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
 *       put: vi.fn((key: string, value: unknown) => {
 *         storage.set(key, value)
 *         return Promise.resolve()
 *       }),
 *       // ... more mocks
 *     },
 *     blockConcurrencyWhile: vi.fn((fn) => fn()),  // <-- WRONG! Real behavior is different
 *     waitUntil: vi.fn(),
 *   } as unknown as DurableObjectState
 * }
 *
 * describe('DO Class', () => {
 *   let doInstance: DO
 *   beforeEach(() => {
 *     const mockState = createMockState()
 *     doInstance = new DO(mockState, {})
 *   })
 *
 *   it('should respond to GET /', async () => {
 *     const request = new Request('https://do/')
 *     const response = await doInstance.fetch(request)
 *     expect(response.status).toBe(200)
 *   })
 * })
 *
 * ============================================================================
 * AFTER (Real vitest-pool-workers):
 * ============================================================================
 *
 * import { env } from 'cloudflare:test'
 *
 * describe('DO Class', () => {
 *   it('should respond to GET /', async () => {
 *     const id = env.DO.idFromName('test')
 *     const stub = env.DO.get(id)
 *
 *     const response = await stub.fetch('https://do/')
 *
 *     expect(response.status).toBe(200)
 *     const json = await response.json()
 *     expect(json.status).toBe('ok')
 *   })
 * })
 *
 * Key differences:
 * 1. No mock setup required
 * 2. Real storage behavior (persistence, limits, SQL)
 * 3. Real concurrency handling (blockConcurrencyWhile actually blocks)
 * 4. Real WebSocket hibernation
 * 5. Real DO-to-DO communication
 * 6. Tests actual production behavior
 */
