/**
 * VectorSearchCoordinator Tests
 *
 * TDD RED phase tests for the distributed vector search coordinator.
 * The coordinator orchestrates scatter-gather vector search across multiple shards.
 *
 * Key responsibilities:
 * - Scatter queries to all shards in parallel
 * - Gather and merge results from shards
 * - Respect top-k limits after merging
 * - Handle shard failures gracefully
 * - Timeout slow shards and return partial results
 * - Deduplicate results with same ID from different shards
 * - Apply score threshold filtering
 * - Support metadata filters passed to shards
 * - Track latency metrics per shard
 * - Implement circuit breaker for unhealthy shards
 *
 * @module tests/vector/search-coordinator.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import the coordinator (does not exist yet - RED phase)
import { VectorSearchCoordinator } from '../../db/vector/search-coordinator'
import type {
  SearchCoordinatorConfig,
  ShardStub,
  CoordinatedSearchResult,
  ShardSearchResult,
  ShardMetrics,
  CircuitBreakerState,
} from '../../db/vector/search-coordinator'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a mock shard stub that returns configurable results
 */
function createMockShardStub(options: {
  shardId: string
  results?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>
  latencyMs?: number
  shouldFail?: boolean
  failureError?: Error
}): ShardStub {
  const {
    shardId,
    results = [],
    latencyMs = 10,
    shouldFail = false,
    failureError = new Error(`Shard ${shardId} failed`),
  } = options

  return {
    shardId,
    search: vi.fn(async (query: Float32Array, k: number, options?: { filter?: Record<string, unknown> }) => {
      // Simulate latency
      await new Promise(resolve => setTimeout(resolve, latencyMs))

      if (shouldFail) {
        throw failureError
      }

      // Apply metadata filter if provided
      let filteredResults = results
      if (options?.filter) {
        filteredResults = results.filter(r => {
          if (!r.metadata) return false
          return Object.entries(options.filter!).every(
            ([key, value]) => r.metadata![key] === value
          )
        })
      }

      // Return top-k results
      return {
        results: filteredResults.slice(0, k),
        vectorsScanned: results.length,
        searchTimeMs: latencyMs,
      } satisfies ShardSearchResult
    }),
    health: vi.fn(async () => ({
      healthy: !shouldFail,
      vectorCount: results.length,
      lastUpdated: Date.now(),
    })),
  }
}

/**
 * Create a test query vector
 */
function createTestQuery(dimensions: number, seed: number = 0): Float32Array {
  const query = new Float32Array(dimensions)
  for (let i = 0; i < dimensions; i++) {
    query[i] = Math.sin(seed + i)
  }
  return query
}

/**
 * Create test results with unique IDs
 */
function createTestResults(
  count: number,
  options: {
    prefix?: string
    baseScore?: number
    scoreDecrement?: number
    metadata?: Record<string, unknown>
  } = {}
): Array<{ id: string; score: number; metadata?: Record<string, unknown> }> {
  const {
    prefix = 'vec',
    baseScore = 0.99,
    scoreDecrement = 0.01,
    metadata,
  } = options

  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    score: baseScore - i * scoreDecrement,
    metadata: metadata ? { ...metadata, index: i } : undefined,
  }))
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('VectorSearchCoordinator', () => {
  let coordinator: VectorSearchCoordinator
  let mockShards: ShardStub[]

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // TEST 1: Scatter query to all shards in parallel
  // ==========================================================================

  describe('should scatter query to all shards in parallel', () => {
    it('sends the same query to all configured shards simultaneously', async () => {
      // Arrange: Create multiple mock shards
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: createTestResults(10, { prefix: 's1' }),
        latencyMs: 50,
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: createTestResults(10, { prefix: 's2' }),
        latencyMs: 50,
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: createTestResults(10, { prefix: 's3' }),
        latencyMs: 50,
      })

      mockShards = [shard1, shard2, shard3]

      const config: SearchCoordinatorConfig = {
        shards: mockShards,
        timeoutMs: 1000,
      }

      coordinator = new VectorSearchCoordinator(config)

      const query = createTestQuery(128)
      const k = 10

      // Act: Execute search
      const searchPromise = coordinator.search(query, k)

      // Advance timers to allow parallel execution
      await vi.advanceTimersByTimeAsync(100)

      const result = await searchPromise

      // Assert: All shards were called with the same query
      expect(shard1.search).toHaveBeenCalledTimes(1)
      expect(shard2.search).toHaveBeenCalledTimes(1)
      expect(shard3.search).toHaveBeenCalledTimes(1)

      // Verify the query was passed correctly
      expect(shard1.search).toHaveBeenCalledWith(query, k, expect.any(Object))
      expect(shard2.search).toHaveBeenCalledWith(query, k, expect.any(Object))
      expect(shard3.search).toHaveBeenCalledWith(query, k, expect.any(Object))
    })

    it('executes shard queries in parallel, not sequentially', async () => {
      // Arrange: Create shards with known latencies
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: createTestResults(5),
        latencyMs: 100,
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: createTestResults(5),
        latencyMs: 100,
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: createTestResults(5),
        latencyMs: 100,
      })

      mockShards = [shard1, shard2, shard3]

      coordinator = new VectorSearchCoordinator({
        shards: mockShards,
        timeoutMs: 1000,
      })

      const query = createTestQuery(128)

      // Act: Measure total execution time
      const startTime = Date.now()
      const searchPromise = coordinator.search(query, 10)

      // Advance time - if parallel, should complete in ~100ms not 300ms
      await vi.advanceTimersByTimeAsync(150)

      const result = await searchPromise
      const totalTime = result.totalLatencyMs

      // Assert: Total time should be close to single shard latency (parallel)
      // not 3x the latency (sequential)
      expect(totalTime).toBeLessThan(200) // Should be ~100ms if parallel
    })
  })

  // ==========================================================================
  // TEST 2: Gather and merge results from shards
  // ==========================================================================

  describe('should gather and merge results from shards', () => {
    it('combines results from all shards into a single result set', async () => {
      // Arrange: Each shard returns different results
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'doc-a', score: 0.95 },
          { id: 'doc-b', score: 0.85 },
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'doc-c', score: 0.92 },
          { id: 'doc-d', score: 0.88 },
        ],
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: [
          { id: 'doc-e', score: 0.90 },
          { id: 'doc-f', score: 0.80 },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: All results from all shards are present
      const ids = result.results.map(r => r.id)
      expect(ids).toContain('doc-a')
      expect(ids).toContain('doc-b')
      expect(ids).toContain('doc-c')
      expect(ids).toContain('doc-d')
      expect(ids).toContain('doc-e')
      expect(ids).toContain('doc-f')
      expect(result.results).toHaveLength(6)
    })

    it('sorts merged results by score in descending order', async () => {
      // Arrange: Shards return results in arbitrary order
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'doc-low', score: 0.50 },
          { id: 'doc-high', score: 0.99 },
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'doc-mid', score: 0.75 },
          { id: 'doc-higher', score: 0.90 },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Results are sorted by score descending
      expect(result.results[0].id).toBe('doc-high')
      expect(result.results[0].score).toBe(0.99)
      expect(result.results[1].id).toBe('doc-higher')
      expect(result.results[1].score).toBe(0.90)
      expect(result.results[2].id).toBe('doc-mid')
      expect(result.results[2].score).toBe(0.75)
      expect(result.results[3].id).toBe('doc-low')
      expect(result.results[3].score).toBe(0.50)

      // Verify scores are in descending order
      for (let i = 0; i < result.results.length - 1; i++) {
        expect(result.results[i].score).toBeGreaterThanOrEqual(result.results[i + 1].score)
      }
    })

    it('tracks which shard each result came from', async () => {
      // Arrange
      const shard1 = createMockShardStub({
        shardId: 'shard-alpha',
        results: [{ id: 'doc-1', score: 0.9 }],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-beta',
        results: [{ id: 'doc-2', score: 0.8 }],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Each result has source shard info
      const doc1 = result.results.find(r => r.id === 'doc-1')
      const doc2 = result.results.find(r => r.id === 'doc-2')

      expect(doc1?.sourceShard).toBe('shard-alpha')
      expect(doc2?.sourceShard).toBe('shard-beta')
    })
  })

  // ==========================================================================
  // TEST 3: Respect top-k limit after merging
  // ==========================================================================

  describe('should respect top-k limit after merging', () => {
    it('returns exactly k results when more are available', async () => {
      // Arrange: Each shard returns 10 results (30 total)
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: createTestResults(10, { prefix: 's1', baseScore: 0.99 }),
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: createTestResults(10, { prefix: 's2', baseScore: 0.98 }),
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: createTestResults(10, { prefix: 's3', baseScore: 0.97 }),
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      const k = 5

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), k)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Exactly k results returned
      expect(result.results).toHaveLength(k)
    })

    it('returns fewer than k results when not enough available', async () => {
      // Arrange: Only 3 total results across all shards
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [{ id: 'doc-1', score: 0.9 }],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [{ id: 'doc-2', score: 0.8 }],
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: [{ id: 'doc-3', score: 0.7 }],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      const k = 10 // Request more than available

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), k)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Returns all available (3), not 10
      expect(result.results).toHaveLength(3)
    })

    it('selects the top-k highest scoring results globally', async () => {
      // Arrange: Results interleaved across shards by score
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'best', score: 0.99 },    // #1
          { id: 's1-4th', score: 0.96 },  // #4
          { id: 's1-7th', score: 0.93 },  // #7
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 's2-2nd', score: 0.98 },  // #2
          { id: 's2-5th', score: 0.95 },  // #5
          { id: 's2-8th', score: 0.92 },  // #8
        ],
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: [
          { id: 's3-3rd', score: 0.97 },  // #3
          { id: 's3-6th', score: 0.94 },  // #6
          { id: 's3-9th', score: 0.91 },  // #9
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      const k = 5

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), k)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Top 5 globally
      expect(result.results.map(r => r.id)).toEqual([
        'best',      // 0.99
        's2-2nd',    // 0.98
        's3-3rd',    // 0.97
        's1-4th',    // 0.96
        's2-5th',    // 0.95
      ])
    })
  })

  // ==========================================================================
  // TEST 4: Handle shard failures gracefully
  // ==========================================================================

  describe('should handle shard failures gracefully', () => {
    it('returns results from healthy shards when one shard fails', async () => {
      // Arrange: One shard will fail
      const shard1 = createMockShardStub({
        shardId: 'healthy-1',
        results: [{ id: 'doc-1', score: 0.9 }],
      })
      const shard2 = createMockShardStub({
        shardId: 'failing-shard',
        shouldFail: true,
        failureError: new Error('Connection refused'),
      })
      const shard3 = createMockShardStub({
        shardId: 'healthy-2',
        results: [{ id: 'doc-3', score: 0.7 }],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Got results from healthy shards
      expect(result.results).toHaveLength(2)
      expect(result.results.map(r => r.id)).toContain('doc-1')
      expect(result.results.map(r => r.id)).toContain('doc-3')
    })

    it('reports failed shards in the response metadata', async () => {
      // Arrange
      const shard1 = createMockShardStub({
        shardId: 'healthy',
        results: [{ id: 'doc-1', score: 0.9 }],
      })
      const shard2 = createMockShardStub({
        shardId: 'failed-shard',
        shouldFail: true,
        failureError: new Error('Network timeout'),
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Failed shards are tracked
      expect(result.failedShards).toBeDefined()
      expect(result.failedShards).toHaveLength(1)
      expect(result.failedShards![0].shardId).toBe('failed-shard')
      expect(result.failedShards![0].error).toContain('Network timeout')
    })

    it('returns empty results when all shards fail', async () => {
      // Arrange: All shards fail
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        shouldFail: true,
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        shouldFail: true,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Empty results but no throw
      expect(result.results).toHaveLength(0)
      expect(result.failedShards).toHaveLength(2)
      expect(result.partial).toBe(true)
    })

    it('does not throw exceptions on shard failures by default', async () => {
      // Arrange
      const shard1 = createMockShardStub({
        shardId: 'failing',
        shouldFail: true,
        failureError: new Error('Catastrophic failure'),
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1],
        timeoutMs: 1000,
      })

      // Act & Assert: Should not throw
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)

      await expect(searchPromise).resolves.toBeDefined()
    })
  })

  // ==========================================================================
  // TEST 5: Timeout slow shards and return partial results
  // ==========================================================================

  describe('should timeout slow shards and return partial results', () => {
    it('returns results before timeout from fast shards', async () => {
      // Arrange: One fast shard, one slow shard
      const fastShard = createMockShardStub({
        shardId: 'fast-shard',
        results: [{ id: 'fast-doc', score: 0.9 }],
        latencyMs: 50,
      })
      const slowShard = createMockShardStub({
        shardId: 'slow-shard',
        results: [{ id: 'slow-doc', score: 0.95 }],
        latencyMs: 5000, // 5 seconds - way over timeout
      })

      coordinator = new VectorSearchCoordinator({
        shards: [fastShard, slowShard],
        timeoutMs: 200, // 200ms timeout
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(250)

      const result = await searchPromise

      // Assert: Got fast shard results, slow shard timed out
      expect(result.results).toHaveLength(1)
      expect(result.results[0].id).toBe('fast-doc')
      expect(result.partial).toBe(true)
    })

    it('marks result as partial when shards timeout', async () => {
      // Arrange
      const slowShard = createMockShardStub({
        shardId: 'slow',
        results: [{ id: 'doc', score: 0.9 }],
        latencyMs: 1000,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [slowShard],
        timeoutMs: 100,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(150)
      const result = await searchPromise

      // Assert
      expect(result.partial).toBe(true)
      expect(result.timedOutShards).toBeDefined()
      expect(result.timedOutShards).toContain('slow')
    })

    it('reports timed out shards separately from failed shards', async () => {
      // Arrange
      const slowShard = createMockShardStub({
        shardId: 'slow-shard',
        latencyMs: 5000,
        results: [{ id: 'doc', score: 0.9 }],
      })
      const failingShard = createMockShardStub({
        shardId: 'failing-shard',
        shouldFail: true,
        failureError: new Error('Connection error'),
      })
      const healthyShard = createMockShardStub({
        shardId: 'healthy-shard',
        results: [{ id: 'healthy-doc', score: 0.8 }],
        latencyMs: 10,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [slowShard, failingShard, healthyShard],
        timeoutMs: 100,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(150)
      const result = await searchPromise

      // Assert: Separate tracking
      expect(result.timedOutShards).toContain('slow-shard')
      expect(result.failedShards?.map(f => f.shardId)).toContain('failing-shard')
      expect(result.results.map(r => r.id)).toContain('healthy-doc')
    })

    it('respects custom timeout configuration', async () => {
      // Arrange
      const shard = createMockShardStub({
        shardId: 'shard',
        results: [{ id: 'doc', score: 0.9 }],
        latencyMs: 300,
      })

      // Test with short timeout
      const shortTimeoutCoordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 100,
      })

      // Test with long timeout
      const longTimeoutCoordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 500,
      })

      // Act: Short timeout should miss the result
      const shortPromise = shortTimeoutCoordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(150)
      const shortResult = await shortPromise

      // Reset shard mock
      vi.clearAllMocks()

      // Act: Long timeout should get the result
      const longPromise = longTimeoutCoordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(350)
      const longResult = await longPromise

      // Assert
      expect(shortResult.partial).toBe(true)
      expect(shortResult.results).toHaveLength(0)

      expect(longResult.partial).toBeFalsy()
      expect(longResult.results).toHaveLength(1)
    })
  })

  // ==========================================================================
  // TEST 6: Deduplicate results with same ID from different shards
  // ==========================================================================

  describe('should deduplicate results with same ID from different shards', () => {
    it('removes duplicate IDs keeping the highest score', async () => {
      // Arrange: Same document appears in multiple shards with different scores
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'duplicate-doc', score: 0.85 },
          { id: 'unique-1', score: 0.80 },
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'duplicate-doc', score: 0.90 }, // Higher score
          { id: 'unique-2', score: 0.75 },
        ],
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: [
          { id: 'duplicate-doc', score: 0.70 }, // Lower score
          { id: 'unique-3', score: 0.65 },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Only one copy of duplicate-doc with highest score
      const duplicateDocs = result.results.filter(r => r.id === 'duplicate-doc')
      expect(duplicateDocs).toHaveLength(1)
      expect(duplicateDocs[0].score).toBe(0.90) // Highest score kept
    })

    it('preserves metadata from the highest scoring duplicate', async () => {
      // Arrange
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'doc', score: 0.80, metadata: { source: 'shard-1', version: 1 } },
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'doc', score: 0.95, metadata: { source: 'shard-2', version: 2 } },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Metadata from highest scoring version
      const doc = result.results.find(r => r.id === 'doc')
      expect(doc?.metadata?.source).toBe('shard-2')
      expect(doc?.metadata?.version).toBe(2)
    })

    it('correctly counts total unique results after deduplication', async () => {
      // Arrange: 6 results total, 2 duplicates
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'dup-1', score: 0.9 },
          { id: 'unique-1', score: 0.8 },
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'dup-1', score: 0.85 }, // Duplicate
          { id: 'dup-2', score: 0.7 },
          { id: 'unique-2', score: 0.6 },
        ],
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: [
          { id: 'dup-2', score: 0.75 }, // Duplicate
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: 4 unique results (not 6)
      expect(result.results).toHaveLength(4)
      expect(result.totalDeduplicated).toBe(2) // 2 duplicates removed
    })
  })

  // ==========================================================================
  // TEST 7: Apply score threshold filtering
  // ==========================================================================

  describe('should apply score threshold filtering', () => {
    it('filters out results below minimum score threshold', async () => {
      // Arrange
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'high-score', score: 0.95 },
          { id: 'mid-score', score: 0.75 },
          { id: 'low-score', score: 0.30 },
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'above-threshold', score: 0.85 },
          { id: 'below-threshold', score: 0.40 },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act: Search with minimum score threshold of 0.5
      const searchPromise = coordinator.search(createTestQuery(128), 10, {
        minScore: 0.5,
      })
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Only results >= 0.5 score
      expect(result.results.every(r => r.score >= 0.5)).toBe(true)
      expect(result.results).toHaveLength(3)
      expect(result.results.map(r => r.id)).toEqual([
        'high-score',
        'above-threshold',
        'mid-score',
      ])
    })

    it('returns empty results when no scores meet threshold', async () => {
      // Arrange
      const shard = createMockShardStub({
        shardId: 'shard',
        results: [
          { id: 'doc-1', score: 0.3 },
          { id: 'doc-2', score: 0.2 },
          { id: 'doc-3', score: 0.1 },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 1000,
      })

      // Act: High threshold
      const searchPromise = coordinator.search(createTestQuery(128), 10, {
        minScore: 0.9,
      })
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert
      expect(result.results).toHaveLength(0)
    })

    it('applies threshold after merging but before k limit', async () => {
      // Arrange: Results that would be in top-k but below threshold
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'top-1', score: 0.99 },
          { id: 'top-2', score: 0.95 },
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'below-threshold-but-top-3', score: 0.40 },
          { id: 'below-threshold-but-top-4', score: 0.35 },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act: Request k=4 but with threshold 0.5
      const searchPromise = coordinator.search(createTestQuery(128), 4, {
        minScore: 0.5,
      })
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Only 2 results even though k=4 (threshold filters the rest)
      expect(result.results).toHaveLength(2)
    })

    it('reports how many results were filtered by threshold', async () => {
      // Arrange
      const shard = createMockShardStub({
        shardId: 'shard',
        results: [
          { id: 'keep-1', score: 0.9 },
          { id: 'keep-2', score: 0.8 },
          { id: 'filter-1', score: 0.4 },
          { id: 'filter-2', score: 0.3 },
          { id: 'filter-3', score: 0.2 },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10, {
        minScore: 0.5,
      })
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert
      expect(result.filteredByThreshold).toBe(3)
    })
  })

  // ==========================================================================
  // TEST 8: Support metadata filters passed to shards
  // ==========================================================================

  describe('should support metadata filters passed to shards', () => {
    it('passes filter to all shards', async () => {
      // Arrange
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'doc-1', score: 0.9, metadata: { category: 'tech', author: 'alice' } },
          { id: 'doc-2', score: 0.8, metadata: { category: 'sports', author: 'bob' } },
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'doc-3', score: 0.85, metadata: { category: 'tech', author: 'carol' } },
          { id: 'doc-4', score: 0.75, metadata: { category: 'news', author: 'dave' } },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      const filter = { category: 'tech' }

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10, { filter })
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Filter was passed to shards
      expect(shard1.search).toHaveBeenCalledWith(
        expect.any(Float32Array),
        10,
        expect.objectContaining({ filter })
      )
      expect(shard2.search).toHaveBeenCalledWith(
        expect.any(Float32Array),
        10,
        expect.objectContaining({ filter })
      )
    })

    it('only returns results matching the filter', async () => {
      // Arrange: Shards return filtered results
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [
          { id: 'tech-doc-1', score: 0.9, metadata: { category: 'tech' } },
          { id: 'sports-doc', score: 0.95, metadata: { category: 'sports' } }, // Higher score but wrong category
        ],
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [
          { id: 'tech-doc-2', score: 0.85, metadata: { category: 'tech' } },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10, {
        filter: { category: 'tech' },
      })
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Only tech category results
      expect(result.results.every(r => r.metadata?.category === 'tech')).toBe(true)
    })

    it('supports complex filter conditions', async () => {
      // Arrange
      const shard = createMockShardStub({
        shardId: 'shard',
        results: [
          { id: 'match', score: 0.9, metadata: { status: 'published', year: 2024 } },
          { id: 'no-match-1', score: 0.85, metadata: { status: 'draft', year: 2024 } },
          { id: 'no-match-2', score: 0.80, metadata: { status: 'published', year: 2023 } },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 1000,
      })

      // Act: Filter by multiple conditions
      const searchPromise = coordinator.search(createTestQuery(128), 10, {
        filter: { status: 'published', year: 2024 },
      })
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert
      expect(result.results).toHaveLength(1)
      expect(result.results[0].id).toBe('match')
    })

    it('returns all results when no filter specified', async () => {
      // Arrange
      const shard = createMockShardStub({
        shardId: 'shard',
        results: [
          { id: 'doc-1', score: 0.9, metadata: { type: 'a' } },
          { id: 'doc-2', score: 0.8, metadata: { type: 'b' } },
          { id: 'doc-3', score: 0.7, metadata: { type: 'c' } },
        ],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 1000,
      })

      // Act: No filter
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: All results returned
      expect(result.results).toHaveLength(3)
    })
  })

  // ==========================================================================
  // TEST 9: Track latency metrics per shard
  // ==========================================================================

  describe('should track latency metrics per shard', () => {
    it('records latency for each shard', async () => {
      // Arrange: Shards with different latencies
      const shard1 = createMockShardStub({
        shardId: 'fast-shard',
        results: [{ id: 'doc-1', score: 0.9 }],
        latencyMs: 10,
      })
      const shard2 = createMockShardStub({
        shardId: 'medium-shard',
        results: [{ id: 'doc-2', score: 0.8 }],
        latencyMs: 50,
      })
      const shard3 = createMockShardStub({
        shardId: 'slow-shard',
        results: [{ id: 'doc-3', score: 0.7 }],
        latencyMs: 100,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(150)
      const result = await searchPromise

      // Assert: Latency metrics for each shard
      expect(result.shardMetrics).toBeDefined()
      expect(result.shardMetrics).toHaveLength(3)

      const fastMetrics = result.shardMetrics!.find(m => m.shardId === 'fast-shard')
      const mediumMetrics = result.shardMetrics!.find(m => m.shardId === 'medium-shard')
      const slowMetrics = result.shardMetrics!.find(m => m.shardId === 'slow-shard')

      expect(fastMetrics?.latencyMs).toBeGreaterThanOrEqual(10)
      expect(fastMetrics?.latencyMs).toBeLessThan(50)
      expect(mediumMetrics?.latencyMs).toBeGreaterThanOrEqual(50)
      expect(slowMetrics?.latencyMs).toBeGreaterThanOrEqual(100)
    })

    it('calculates aggregate latency statistics', async () => {
      // Arrange
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: [],
        latencyMs: 20,
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: [],
        latencyMs: 40,
      })
      const shard3 = createMockShardStub({
        shardId: 'shard-3',
        results: [],
        latencyMs: 60,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2, shard3],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Aggregate stats
      expect(result.latencyStats).toBeDefined()
      expect(result.latencyStats!.min).toBeGreaterThanOrEqual(20)
      expect(result.latencyStats!.max).toBeGreaterThanOrEqual(60)
      expect(result.latencyStats!.avg).toBeGreaterThanOrEqual(30) // Average of 20, 40, 60
      expect(result.latencyStats!.p50).toBeDefined()
      expect(result.latencyStats!.p95).toBeDefined()
      expect(result.latencyStats!.p99).toBeDefined()
    })

    it('tracks vectors scanned per shard', async () => {
      // Arrange
      const shard1 = createMockShardStub({
        shardId: 'shard-1',
        results: createTestResults(5),
      })
      const shard2 = createMockShardStub({
        shardId: 'shard-2',
        results: createTestResults(10),
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard1, shard2],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 3)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert
      const shard1Metrics = result.shardMetrics!.find(m => m.shardId === 'shard-1')
      const shard2Metrics = result.shardMetrics!.find(m => m.shardId === 'shard-2')

      expect(shard1Metrics?.vectorsScanned).toBe(5)
      expect(shard2Metrics?.vectorsScanned).toBe(10)
      expect(result.totalVectorsScanned).toBe(15)
    })

    it('includes timing breakdown in metrics', async () => {
      // Arrange
      const shard = createMockShardStub({
        shardId: 'shard',
        results: createTestResults(10),
        latencyMs: 50,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 5)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Timing breakdown
      expect(result.timingBreakdown).toBeDefined()
      expect(result.timingBreakdown!.scatterMs).toBeDefined()
      expect(result.timingBreakdown!.gatherMs).toBeDefined()
      expect(result.timingBreakdown!.mergeMs).toBeDefined()
      expect(result.timingBreakdown!.totalMs).toBeDefined()
    })
  })

  // ==========================================================================
  // TEST 10: Implement circuit breaker for unhealthy shards
  // ==========================================================================

  describe('should implement circuit breaker for unhealthy shards', () => {
    it('opens circuit after consecutive failures', async () => {
      // Arrange: Shard that fails consistently
      const failingShard = createMockShardStub({
        shardId: 'failing-shard',
        shouldFail: true,
        failureError: new Error('Persistent failure'),
      })
      const healthyShard = createMockShardStub({
        shardId: 'healthy-shard',
        results: [{ id: 'doc', score: 0.9 }],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [failingShard, healthyShard],
        timeoutMs: 1000,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeMs: 30000,
        },
      })

      // Act: Make multiple requests to trigger circuit breaker
      for (let i = 0; i < 3; i++) {
        const searchPromise = coordinator.search(createTestQuery(128), 10)
        await vi.advanceTimersByTimeAsync(50)
        await searchPromise
      }

      // Assert: Circuit should be open for failing shard
      const circuitState = coordinator.getCircuitState('failing-shard')
      expect(circuitState).toBe('open')
    })

    it('skips open-circuit shards on subsequent requests', async () => {
      // Arrange
      const failingShard = createMockShardStub({
        shardId: 'circuit-open',
        shouldFail: true,
      })
      const healthyShard = createMockShardStub({
        shardId: 'healthy',
        results: [{ id: 'doc', score: 0.9 }],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [failingShard, healthyShard],
        timeoutMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeMs: 30000,
        },
      })

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        const searchPromise = coordinator.search(createTestQuery(128), 10)
        await vi.advanceTimersByTimeAsync(50)
        await searchPromise
      }

      // Clear mock call counts
      vi.clearAllMocks()

      // Act: Make another request
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Failing shard was not called (circuit open)
      expect(failingShard.search).not.toHaveBeenCalled()
      expect(healthyShard.search).toHaveBeenCalled()
      expect(result.skippedShards).toContain('circuit-open')
    })

    it('moves to half-open state after reset time', async () => {
      // Arrange
      const failingShard = createMockShardStub({
        shardId: 'recovering-shard',
        shouldFail: true,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [failingShard],
        timeoutMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeMs: 5000,
        },
      })

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        const searchPromise = coordinator.search(createTestQuery(128), 10)
        await vi.advanceTimersByTimeAsync(50)
        await searchPromise
      }

      expect(coordinator.getCircuitState('recovering-shard')).toBe('open')

      // Act: Wait for reset time
      await vi.advanceTimersByTimeAsync(5000)

      // Assert: Circuit should be half-open
      expect(coordinator.getCircuitState('recovering-shard')).toBe('half-open')
    })

    it('closes circuit after successful request in half-open state', async () => {
      // Arrange: Start with a failing shard that will recover
      let shouldFail = true
      const recoveringShard: ShardStub = {
        shardId: 'recovering',
        search: vi.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          if (shouldFail) {
            throw new Error('Still failing')
          }
          return {
            results: [{ id: 'doc', score: 0.9 }],
            vectorsScanned: 1,
            searchTimeMs: 10,
          }
        }),
        health: vi.fn(async () => ({ healthy: !shouldFail, vectorCount: 1, lastUpdated: Date.now() })),
      }

      coordinator = new VectorSearchCoordinator({
        shards: [recoveringShard],
        timeoutMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeMs: 1000,
        },
      })

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        const searchPromise = coordinator.search(createTestQuery(128), 10)
        await vi.advanceTimersByTimeAsync(50)
        await searchPromise
      }

      // Wait for half-open
      await vi.advanceTimersByTimeAsync(1000)
      expect(coordinator.getCircuitState('recovering')).toBe('half-open')

      // Now the shard recovers
      shouldFail = false

      // Act: Make request in half-open state
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      await searchPromise

      // Assert: Circuit should be closed
      expect(coordinator.getCircuitState('recovering')).toBe('closed')
    })

    it('reopens circuit if request fails in half-open state', async () => {
      // Arrange
      const stillFailingShard = createMockShardStub({
        shardId: 'still-failing',
        shouldFail: true,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [stillFailingShard],
        timeoutMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeMs: 1000,
        },
      })

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        const searchPromise = coordinator.search(createTestQuery(128), 10)
        await vi.advanceTimersByTimeAsync(50)
        await searchPromise
      }

      // Wait for half-open
      await vi.advanceTimersByTimeAsync(1000)
      expect(coordinator.getCircuitState('still-failing')).toBe('half-open')

      // Act: Make request (still fails)
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      await searchPromise

      // Assert: Circuit should be back to open
      expect(coordinator.getCircuitState('still-failing')).toBe('open')
    })

    it('reports circuit breaker state in response metadata', async () => {
      // Arrange
      const failingShard = createMockShardStub({
        shardId: 'cb-test-shard',
        shouldFail: true,
      })
      const healthyShard = createMockShardStub({
        shardId: 'healthy-shard',
        results: [{ id: 'doc', score: 0.9 }],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [failingShard, healthyShard],
        timeoutMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeMs: 30000,
        },
      })

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        const searchPromise = coordinator.search(createTestQuery(128), 10)
        await vi.advanceTimersByTimeAsync(50)
        await searchPromise
      }

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Circuit state in response
      expect(result.circuitBreakerStates).toBeDefined()
      expect(result.circuitBreakerStates!['cb-test-shard']).toBe('open')
      expect(result.circuitBreakerStates!['healthy-shard']).toBe('closed')
    })

    it('allows manual circuit breaker reset', async () => {
      // Arrange
      const shard = createMockShardStub({
        shardId: 'manual-reset-shard',
        shouldFail: true,
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 1000,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeMs: 30000,
        },
      })

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        const searchPromise = coordinator.search(createTestQuery(128), 10)
        await vi.advanceTimersByTimeAsync(50)
        await searchPromise
      }

      expect(coordinator.getCircuitState('manual-reset-shard')).toBe('open')

      // Act: Manual reset
      coordinator.resetCircuit('manual-reset-shard')

      // Assert
      expect(coordinator.getCircuitState('manual-reset-shard')).toBe('closed')
    })
  })

  // ==========================================================================
  // ADDITIONAL EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles empty query gracefully', async () => {
      const shard = createMockShardStub({
        shardId: 'shard',
        results: [],
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 1000,
      })

      // Act & Assert: Should not throw
      const searchPromise = coordinator.search(new Float32Array(0), 10)
      await vi.advanceTimersByTimeAsync(50)

      await expect(searchPromise).rejects.toThrow('Invalid query: empty vector')
    })

    it('handles k=0 gracefully', async () => {
      const shard = createMockShardStub({
        shardId: 'shard',
        results: createTestResults(10),
      })

      coordinator = new VectorSearchCoordinator({
        shards: [shard],
        timeoutMs: 1000,
      })

      // Act
      const searchPromise = coordinator.search(createTestQuery(128), 0)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Returns empty
      expect(result.results).toHaveLength(0)
    })

    it('handles no shards configured', async () => {
      // Act & Assert
      expect(() => {
        new VectorSearchCoordinator({
          shards: [],
          timeoutMs: 1000,
        })
      }).toThrow('At least one shard must be configured')
    })
  })
})
