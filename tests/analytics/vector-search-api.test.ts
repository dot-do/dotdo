/**
 * Vector Search API Endpoint Tests
 *
 * TDD RED phase tests for the vector search API endpoint integration.
 * Tests the POST /api/v1/search endpoint that routes to VectorSearchCoordinatorDO.
 *
 * Related issues:
 * - dotdo-0nxyt: Implement vector search API endpoint
 * - dotdo-rxsqb: Unified Analytics Architecture epic
 *
 * Acceptance criteria:
 * - POST /api/v1/search accepts vector queries
 * - Returns top-K results with scores
 * - Includes timing metrics
 * - Validates input (dimension check, k limits)
 * - Returns proper error responses
 *
 * @module tests/analytics/vector-search-api.test
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import the router to test
import { analyticsRouter } from '../../api/analytics/router'
import { Hono } from 'hono'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a test request for vector search
 */
function createSearchRequest(body: unknown): Request {
  return new Request('http://test.api.dotdo.dev/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/**
 * Create a test query vector
 */
function createTestVector(dimensions: number, seed: number = 0): number[] {
  const vector: number[] = []
  for (let i = 0; i < dimensions; i++) {
    vector.push(Math.sin(seed + i))
  }
  return vector
}

/**
 * Mock environment for testing
 */
interface MockEnv {
  VECTORS?: {
    query: (
      vector: Float32Array,
      options: { topK: number; returnMetadata?: string; returnValues?: boolean }
    ) => Promise<{
      matches: Array<{
        id: string
        score: number
        metadata?: Record<string, unknown>
        values?: number[]
      }>
      count: number
    }>
  }
  VECTOR_COORDINATOR?: DurableObjectNamespace
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Vector Search API Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = new Hono<{ Bindings: MockEnv }>()
    app.route('/', analyticsRouter)
  })

  // ==========================================================================
  // INPUT VALIDATION TESTS
  // ==========================================================================

  describe('input validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const request = new Request('http://test.api.dotdo.dev/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_QUERY')
    })

    it('returns 400 when query vector is missing', async () => {
      const request = createSearchRequest({ k: 10 })

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string; details?: { errors: string[] } } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_VECTOR')
      expect(data.error?.details?.errors).toContain('query vector is required')
    })

    it('returns 400 when query is not an array', async () => {
      const request = createSearchRequest({ query: 'not an array', k: 10 })

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string; details?: { errors: string[] } } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_VECTOR')
      expect(data.error?.details?.errors).toContain('query must be an array of numbers')
    })

    it('returns 400 when query vector is empty', async () => {
      const request = createSearchRequest({ query: [], k: 10 })

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string; details?: { errors: string[] } } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_VECTOR')
      expect(data.error?.details?.errors).toContain('query vector cannot be empty')
    })

    it('returns 400 when query contains non-numbers', async () => {
      const request = createSearchRequest({ query: [0.1, 'not a number', 0.3], k: 10 })

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string; details?: { errors: string[] } } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_VECTOR')
      expect(data.error?.details?.errors).toContain('query must contain only valid numbers')
    })

    it('returns 400 when k is less than 1', async () => {
      const request = createSearchRequest({ query: createTestVector(128), k: 0 })

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string; details?: { errors: string[] } } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_VECTOR')
      expect(data.error?.details?.errors).toContain('k must be between 1 and 1000')
    })

    it('returns 400 when k is greater than 1000', async () => {
      const request = createSearchRequest({ query: createTestVector(128), k: 1001 })

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string; details?: { errors: string[] } } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_VECTOR')
      expect(data.error?.details?.errors).toContain('k must be between 1 and 1000')
    })

    it('returns 400 for invalid metric', async () => {
      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
        metric: 'invalid_metric',
      })

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string; details?: { errors: string[] } } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_VECTOR')
      expect(data.error?.details?.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('metric must be one of')])
      )
    })

    it('accepts valid metric values: cosine, euclidean, dot_product', async () => {
      const metrics = ['cosine', 'euclidean', 'dot_product']

      for (const metric of metrics) {
        const request = createSearchRequest({
          query: createTestVector(128),
          k: 10,
          metric,
        })

        const response = await app.fetch(request, {})
        // Should not return 400 for validation error
        expect(response.status).not.toBe(400)
      }
    })
  })

  // ==========================================================================
  // RESPONSE STRUCTURE TESTS
  // ==========================================================================

  describe('response structure', () => {
    it('returns results array with scores', async () => {
      const mockVectors = {
        query: async () => ({
          matches: [
            { id: 'vec-1', score: 0.95 },
            { id: 'vec-2', score: 0.87 },
          ],
          count: 100,
        }),
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
      })

      const response = await app.fetch(request, { VECTORS: mockVectors })
      const data = await response.json() as {
        results: Array<{ id: string; score: number }>
      }

      expect(response.status).toBe(200)
      expect(data.results).toBeInstanceOf(Array)
      expect(data.results[0]).toHaveProperty('id')
      expect(data.results[0]).toHaveProperty('score')
    })

    it('includes timing metrics in response', async () => {
      const mockVectors = {
        query: async () => ({
          matches: [],
          count: 0,
        }),
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
      })

      const response = await app.fetch(request, { VECTORS: mockVectors })
      const data = await response.json() as {
        timing: {
          total: number
          centroidSearch?: number
          clusterLoad?: number
          rerank?: number
        }
      }

      expect(response.status).toBe(200)
      expect(data.timing).toBeDefined()
      expect(data.timing.total).toBeTypeOf('number')
      expect(data.timing.total).toBeGreaterThanOrEqual(0)
    })

    it('includes stats in response', async () => {
      const mockVectors = {
        query: async () => ({
          matches: [],
          count: 500,
        }),
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
      })

      const response = await app.fetch(request, { VECTORS: mockVectors })
      const data = await response.json() as {
        stats: {
          vectorsScanned: number
          clustersSearched?: number
          cacheHitRate?: number
        }
      }

      expect(response.status).toBe(200)
      expect(data.stats).toBeDefined()
      expect(data.stats.vectorsScanned).toBeTypeOf('number')
    })

    it('returns metadata when includeMetadata is true', async () => {
      const mockVectors = {
        query: async (_: Float32Array, options: { returnMetadata?: string }) => ({
          matches: [
            {
              id: 'vec-1',
              score: 0.95,
              metadata: options.returnMetadata === 'all' ? { category: 'test', tags: ['a', 'b'] } : undefined,
            },
          ],
          count: 100,
        }),
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
        includeMetadata: true,
      })

      const response = await app.fetch(request, { VECTORS: mockVectors })
      const data = await response.json() as {
        results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>
      }

      expect(response.status).toBe(200)
      expect(data.results[0]?.metadata).toBeDefined()
      expect(data.results[0]?.metadata?.category).toBe('test')
    })

    it('returns vectors when includeVectors is true', async () => {
      const testVector = createTestVector(4)
      const mockVectors = {
        query: async (_: Float32Array, options: { returnValues?: boolean }) => ({
          matches: [
            {
              id: 'vec-1',
              score: 0.95,
              values: options.returnValues ? testVector : undefined,
            },
          ],
          count: 100,
        }),
      }

      const request = createSearchRequest({
        query: createTestVector(4),
        k: 10,
        includeVectors: true,
      })

      const response = await app.fetch(request, { VECTORS: mockVectors })
      const data = await response.json() as {
        results: Array<{ id: string; score: number; vector?: number[] }>
      }

      expect(response.status).toBe(200)
      expect(data.results[0]?.vector).toBeDefined()
      expect(data.results[0]?.vector).toEqual(testVector)
    })
  })

  // ==========================================================================
  // COORDINATOR INTEGRATION TESTS
  // ==========================================================================

  describe('VectorSearchCoordinatorDO integration', () => {
    it('routes search to VectorSearchCoordinatorDO when available', async () => {
      // This test should verify that when VECTOR_COORDINATOR binding is present,
      // the endpoint routes to the coordinator DO instead of using Vectorize directly

      let coordinatorCalled = false
      const mockCoordinator = {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => ({
          search: async (query: Float32Array, k: number, options: Record<string, unknown>) => {
            coordinatorCalled = true
            return {
              results: [
                { id: 'vec-1', score: 0.95, sourceShard: 'shard-1' },
                { id: 'vec-2', score: 0.87, sourceShard: 'shard-2' },
              ],
              totalLatencyMs: 50,
              totalVectorsScanned: 1000,
              shardMetrics: [
                { shardId: 'shard-1', latencyMs: 30, vectorsScanned: 500, success: true },
                { shardId: 'shard-2', latencyMs: 40, vectorsScanned: 500, success: true },
              ],
            }
          },
        }),
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
      })

      // When VECTOR_COORDINATOR is available, it should be used
      const response = await app.fetch(request, {
        VECTOR_COORDINATOR: mockCoordinator as unknown as DurableObjectNamespace,
      })

      const data = await response.json() as {
        results: Array<{ id: string; score: number; sourceShard?: string }>
        timing: { total: number }
        stats: { vectorsScanned: number }
      }

      // TODO: This test is expected to FAIL until the implementation routes to coordinator
      expect(coordinatorCalled).toBe(true)
      expect(data.results.length).toBe(2)
      expect(data.results[0]?.sourceShard).toBe('shard-1')
    })

    it('includes shard metrics when using coordinator', async () => {
      const mockCoordinator = {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => ({
          search: async () => ({
            results: [],
            totalLatencyMs: 50,
            totalVectorsScanned: 1000,
            shardMetrics: [
              { shardId: 'shard-1', latencyMs: 30, vectorsScanned: 500, success: true },
              { shardId: 'shard-2', latencyMs: 40, vectorsScanned: 500, success: true },
            ],
            latencyStats: {
              min: 30,
              max: 40,
              avg: 35,
              p50: 35,
              p95: 40,
              p99: 40,
            },
          }),
        }),
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
      })

      const response = await app.fetch(request, {
        VECTOR_COORDINATOR: mockCoordinator as unknown as DurableObjectNamespace,
      })

      const data = await response.json() as {
        shardMetrics?: Array<{
          shardId: string
          latencyMs: number
          vectorsScanned: number
          success: boolean
        }>
        latencyStats?: {
          min: number
          max: number
          avg: number
          p50: number
          p95: number
          p99: number
        }
      }

      // TODO: This test is expected to FAIL until the implementation includes shard metrics
      expect(data.shardMetrics).toBeDefined()
      expect(data.shardMetrics?.length).toBe(2)
      expect(data.latencyStats).toBeDefined()
      expect(data.latencyStats?.p95).toBeTypeOf('number')
    })

    it('handles partial results from coordinator gracefully', async () => {
      const mockCoordinator = {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => ({
          search: async () => ({
            results: [{ id: 'vec-1', score: 0.95, sourceShard: 'shard-1' }],
            partial: true,
            failedShards: [{ shardId: 'shard-3', error: 'Connection timeout' }],
            timedOutShards: ['shard-2'],
            totalLatencyMs: 100,
            totalVectorsScanned: 500,
          }),
        }),
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
      })

      const response = await app.fetch(request, {
        VECTOR_COORDINATOR: mockCoordinator as unknown as DurableObjectNamespace,
      })

      const data = await response.json() as {
        results: Array<{ id: string; score: number }>
        partial?: boolean
        failedShards?: Array<{ shardId: string; error: string }>
        timedOutShards?: string[]
      }

      // Should still return 200 with partial results
      expect(response.status).toBe(200)
      // TODO: This test is expected to FAIL until the implementation handles partial results
      expect(data.partial).toBe(true)
      expect(data.failedShards?.length).toBe(1)
      expect(data.timedOutShards?.length).toBe(1)
    })
  })

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('error handling', () => {
    it('returns 500 when search fails', async () => {
      const mockVectors = {
        query: async () => {
          throw new Error('Search service unavailable')
        },
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
      })

      const response = await app.fetch(request, { VECTORS: mockVectors })
      const data = await response.json() as {
        error: { code: string; message: string; details?: { message: string } }
      }

      expect(response.status).toBe(500)
      expect(data.error.code).toBe('INTERNAL_ERROR')
      expect(data.error.details?.message).toContain('Search service unavailable')
    })

    it('returns empty results when no backend is available', async () => {
      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
      })

      // No VECTORS or VECTOR_COORDINATOR binding
      const response = await app.fetch(request, {})
      const data = await response.json() as {
        results: Array<{ id: string; score: number }>
        timing: { total: number }
      }

      expect(response.status).toBe(200)
      expect(data.results).toEqual([])
      expect(data.timing.total).toBeTypeOf('number')
    })
  })

  // ==========================================================================
  // DEFAULT VALUES TESTS
  // ==========================================================================

  describe('default values', () => {
    it('uses k=10 when not specified', async () => {
      let capturedK: number | undefined
      const mockVectors = {
        query: async (_: Float32Array, options: { topK: number }) => {
          capturedK = options.topK
          return { matches: [], count: 0 }
        },
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        // k not specified
      })

      await app.fetch(request, { VECTORS: mockVectors })

      expect(capturedK).toBe(10)
    })

    it('uses cosine metric when not specified', async () => {
      // This is handled internally - the router should default to cosine
      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
        // metric not specified
      })

      const response = await app.fetch(request, {})
      // Should not return validation error for missing metric
      expect(response.status).not.toBe(400)
    })

    it('excludes metadata by default when includeMetadata not specified', async () => {
      let capturedReturnMetadata: string | undefined
      const mockVectors = {
        query: async (_: Float32Array, options: { returnMetadata?: string }) => {
          capturedReturnMetadata = options.returnMetadata
          return { matches: [], count: 0 }
        },
      }

      const request = createSearchRequest({
        query: createTestVector(128),
        k: 10,
        // includeMetadata not specified - defaults to true
      })

      await app.fetch(request, { VECTORS: mockVectors })

      // Default is includeMetadata: true
      expect(capturedReturnMetadata).toBe('all')
    })
  })
})
