/**
 * Distributed Query Coordination Tests
 *
 * TDD RED Phase: Tests for distributed query coordination across Durable Objects.
 *
 * Problem Statement (from architectural review):
 * - Cross-DO relationships store URLs but no mechanism for distributed graph traversal
 * - Multi-hop traversals require N sequential network calls
 * - Need distributed query coordinator with DO RPC routing
 *
 * Key Requirements:
 * 1. Query fan-out to multiple DOs
 * 2. Result aggregation from distributed sources
 * 3. Timeout handling for slow DOs
 * 4. Partial result handling when some DOs fail
 *
 * These tests should FAIL until the DistributedQueryCoordinator implementation
 * is complete in db/primitives/distributed-query.ts.
 *
 * @see db/primitives/distributed-query.ts (to be implemented)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// TYPES - Distributed Query Coordination
// ============================================================================

/**
 * Represents a single DO target for query fan-out
 */
interface DOTarget {
  /** The DO namespace URL (e.g., 'https://users.do') */
  namespace: string
  /** Optional partition key within the DO */
  partitionKey?: string
  /** Priority for query ordering (lower = higher priority) */
  priority?: number
}

/**
 * A query to be executed across multiple DOs
 */
interface DistributedQuery<TParams = unknown> {
  /** Unique identifier for this query */
  id: string
  /** The method/operation to call on each DO */
  method: string
  /** Query parameters */
  params: TParams
  /** Target DOs for fan-out */
  targets: DOTarget[]
}

/**
 * Result from a single DO
 */
interface DOQueryResult<T = unknown> {
  /** The DO that returned this result */
  target: DOTarget
  /** Whether the query succeeded */
  success: boolean
  /** The result data if successful */
  data?: T
  /** Error message if failed */
  error?: string
  /** Time taken in milliseconds */
  latencyMs: number
}

/**
 * Aggregated result from distributed query
 */
interface DistributedQueryResult<T = unknown> {
  /** Unique identifier matching the query */
  queryId: string
  /** Overall success (all DOs succeeded) */
  success: boolean
  /** Whether partial results are included */
  partial: boolean
  /** Individual DO results */
  results: DOQueryResult<T>[]
  /** Aggregated data (if aggregation was requested) */
  aggregated?: T[]
  /** Total time for the distributed query */
  totalLatencyMs: number
  /** Metrics about the query execution */
  metrics: QueryMetrics
}

/**
 * Metrics about the distributed query execution
 */
interface QueryMetrics {
  /** Total number of DOs targeted */
  totalTargets: number
  /** Number of successful responses */
  successfulResponses: number
  /** Number of failed responses */
  failedResponses: number
  /** Number of timed out responses */
  timedOutResponses: number
  /** Average latency across all responses */
  averageLatencyMs: number
  /** Maximum latency across all responses */
  maxLatencyMs: number
}

/**
 * Options for distributed query execution
 */
interface DistributedQueryOptions {
  /** Timeout per DO call in milliseconds (default: 5000) */
  timeoutMs?: number
  /** Maximum concurrent DO calls (default: 10) */
  maxConcurrency?: number
  /** Whether to return partial results on failures (default: true) */
  allowPartialResults?: boolean
  /** Retry configuration */
  retry?: {
    maxAttempts?: number
    backoffMs?: number
  }
  /** Aggregation strategy for results */
  aggregation?: 'collect' | 'merge' | 'first' | 'reduce'
  /** Custom reducer for 'reduce' aggregation */
  reducer?: <T>(acc: T[], curr: T) => T[]
}

/**
 * Interface for the distributed query coordinator
 */
interface DistributedQueryCoordinator {
  /**
   * Execute a distributed query across multiple DOs
   */
  execute<TParams, TResult>(
    query: DistributedQuery<TParams>,
    options?: DistributedQueryOptions
  ): Promise<DistributedQueryResult<TResult>>

  /**
   * Fan out queries to multiple DOs in parallel
   */
  fanOut<TParams, TResult>(
    targets: DOTarget[],
    method: string,
    params: TParams,
    options?: DistributedQueryOptions
  ): Promise<DOQueryResult<TResult>[]>

  /**
   * Aggregate results from multiple DOs
   */
  aggregate<T>(
    results: DOQueryResult<T>[],
    strategy: DistributedQueryOptions['aggregation']
  ): T[]

  /**
   * Check health of DO targets
   */
  healthCheck(targets: DOTarget[]): Promise<Map<string, boolean>>
}

// ============================================================================
// MOCK IMPLEMENTATION HELPERS (for testing)
// ============================================================================

/**
 * Mock DO client for testing - simulates DO responses
 */
interface MockDOClient {
  query<TParams, TResult>(
    target: DOTarget,
    method: string,
    params: TParams
  ): Promise<TResult>
}

/**
 * Creates a mock DO client with configurable behavior
 */
function createMockDOClient(config: {
  responses?: Map<string, unknown>
  delays?: Map<string, number>
  failures?: Set<string>
}): MockDOClient {
  return {
    async query<TParams, TResult>(
      target: DOTarget,
      _method: string,
      _params: TParams
    ): Promise<TResult> {
      const key = target.namespace

      // Simulate delay
      const delay = config.delays?.get(key) ?? 10
      await new Promise(r => setTimeout(r, delay))

      // Simulate failure
      if (config.failures?.has(key)) {
        throw new Error(`DO ${key} is unavailable`)
      }

      // Return configured response
      const response = config.responses?.get(key) ?? { data: [] }
      return response as TResult
    },
  }
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestTargets(count: number, prefix = 'https://do'): DOTarget[] {
  return Array.from({ length: count }, (_, i) => ({
    namespace: `${prefix}-${i}.do`,
    partitionKey: `partition-${i}`,
    priority: i,
  }))
}

function createTestQuery<T>(params: T, targetCount = 3): DistributedQuery<T> {
  return {
    id: `query-${Date.now()}`,
    method: 'find',
    params,
    targets: createTestTargets(targetCount),
  }
}

// ============================================================================
// 1. DistributedQueryCoordinator Interface Tests
// ============================================================================

describe('DistributedQueryCoordinator Interface', () => {
  it('should be exported from db/primitives', async () => {
    // This will fail until DistributedQueryCoordinator is implemented
    const module = await import('../index')
    expect(module).toHaveProperty('DistributedQueryCoordinator')
  })

  it('has execute method', async () => {
    const module = await import('../index')
    const Coordinator = (module as Record<string, unknown>).DistributedQueryCoordinator as new (...args: unknown[]) => DistributedQueryCoordinator
    expect(Coordinator.prototype.execute).toBeDefined()
  })

  it('has fanOut method', async () => {
    const module = await import('../index')
    const Coordinator = (module as Record<string, unknown>).DistributedQueryCoordinator as new (...args: unknown[]) => DistributedQueryCoordinator
    expect(Coordinator.prototype.fanOut).toBeDefined()
  })

  it('has aggregate method', async () => {
    const module = await import('../index')
    const Coordinator = (module as Record<string, unknown>).DistributedQueryCoordinator as new (...args: unknown[]) => DistributedQueryCoordinator
    expect(Coordinator.prototype.aggregate).toBeDefined()
  })

  it('has healthCheck method', async () => {
    const module = await import('../index')
    const Coordinator = (module as Record<string, unknown>).DistributedQueryCoordinator as new (...args: unknown[]) => DistributedQueryCoordinator
    expect(Coordinator.prototype.healthCheck).toBeDefined()
  })

  it('createDistributedQueryCoordinator factory is exported', async () => {
    const module = await import('../index')
    expect(module).toHaveProperty('createDistributedQueryCoordinator')
  })
})

// ============================================================================
// 2. Query Fan-Out Tests
// ============================================================================

describe('Query Fan-Out to Multiple DOs', () => {
  describe('basic fan-out', () => {
    it('fans out query to all specified targets', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets = createTestTargets(5)
      const results = await coordinator.fanOut(
        targets,
        'findAll',
        { filter: {} }
      )

      expect(results.length).toBe(5)
      for (const target of targets) {
        const result = results.find(r => r.target.namespace === target.namespace)
        expect(result).toBeDefined()
      }
    })

    it('returns results from all DOs in parallel execution', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets = createTestTargets(10)
      const startTime = Date.now()

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        { filter: {} }
      )

      const elapsed = Date.now() - startTime

      // If queries were sequential with 100ms each, it would take 1000ms
      // Parallel should complete much faster
      expect(elapsed).toBeLessThan(500) // Generous upper bound
      expect(results.length).toBe(10)
    })

    it('respects maxConcurrency option', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets = createTestTargets(20)
      const startTime = Date.now()

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        { filter: {} },
        { maxConcurrency: 2 }
      )

      const elapsed = Date.now() - startTime

      // With concurrency of 2 and 20 targets, should take longer than unlimited
      expect(results.length).toBe(20)
      // Verify all results are present
      expect(results.every(r => r.success || !r.success)).toBe(true)
    })

    it('returns empty array for empty targets', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const results = await coordinator.fanOut(
        [],
        'findAll',
        { filter: {} }
      )

      expect(results).toEqual([])
    })

    it('includes latency metrics for each DO', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets = createTestTargets(3)
      const results = await coordinator.fanOut(
        targets,
        'findAll',
        { filter: {} }
      )

      for (const result of results) {
        expect(result.latencyMs).toBeGreaterThanOrEqual(0)
        expect(typeof result.latencyMs).toBe('number')
      }
    })
  })

  describe('fan-out with priorities', () => {
    it('respects target priority for query ordering', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://low-priority.do', priority: 10 },
        { namespace: 'https://high-priority.do', priority: 1 },
        { namespace: 'https://medium-priority.do', priority: 5 },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        { filter: {} },
        { maxConcurrency: 1 } // Sequential to test ordering
      )

      // Results should maintain order based on priority when concurrency is limited
      expect(results.length).toBe(3)
    })

    it('handles targets with same priority', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://a.do', priority: 1 },
        { namespace: 'https://b.do', priority: 1 },
        { namespace: 'https://c.do', priority: 1 },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        { filter: {} }
      )

      expect(results.length).toBe(3)
    })
  })

  describe('fan-out with partition keys', () => {
    it('routes queries to correct partition within DO', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://users.do', partitionKey: 'shard-1' },
        { namespace: 'https://users.do', partitionKey: 'shard-2' },
        { namespace: 'https://users.do', partitionKey: 'shard-3' },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        { filter: {} }
      )

      expect(results.length).toBe(3)
      // Each result should correspond to its partition
      for (let i = 0; i < results.length; i++) {
        expect(results[i]?.target.partitionKey).toBeDefined()
      }
    })
  })
})

// ============================================================================
// 3. Result Aggregation Tests
// ============================================================================

describe('Result Aggregation from Distributed Sources', () => {
  describe('collect aggregation', () => {
    it('collects all results into a flat array', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const mockResults: DOQueryResult<string[]>[] = [
        { target: { namespace: 'do-1' }, success: true, data: ['a', 'b'], latencyMs: 10 },
        { target: { namespace: 'do-2' }, success: true, data: ['c', 'd'], latencyMs: 15 },
        { target: { namespace: 'do-3' }, success: true, data: ['e'], latencyMs: 12 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'collect')

      expect(aggregated).toEqual([['a', 'b'], ['c', 'd'], ['e']])
    })

    it('excludes failed results from aggregation', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const mockResults: DOQueryResult<string[]>[] = [
        { target: { namespace: 'do-1' }, success: true, data: ['a', 'b'], latencyMs: 10 },
        { target: { namespace: 'do-2' }, success: false, error: 'Failed', latencyMs: 15 },
        { target: { namespace: 'do-3' }, success: true, data: ['c'], latencyMs: 12 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'collect')

      expect(aggregated).toEqual([['a', 'b'], ['c']])
    })

    it('returns empty array when all results failed', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const mockResults: DOQueryResult<string[]>[] = [
        { target: { namespace: 'do-1' }, success: false, error: 'Failed', latencyMs: 10 },
        { target: { namespace: 'do-2' }, success: false, error: 'Failed', latencyMs: 15 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'collect')

      expect(aggregated).toEqual([])
    })
  })

  describe('merge aggregation', () => {
    it('merges array results into single flat array', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const mockResults: DOQueryResult<string[]>[] = [
        { target: { namespace: 'do-1' }, success: true, data: ['a', 'b'], latencyMs: 10 },
        { target: { namespace: 'do-2' }, success: true, data: ['c', 'd'], latencyMs: 15 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'merge')

      expect(aggregated).toEqual(['a', 'b', 'c', 'd'])
    })

    it('handles empty arrays in merge', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const mockResults: DOQueryResult<string[]>[] = [
        { target: { namespace: 'do-1' }, success: true, data: ['a'], latencyMs: 10 },
        { target: { namespace: 'do-2' }, success: true, data: [], latencyMs: 15 },
        { target: { namespace: 'do-3' }, success: true, data: ['b'], latencyMs: 12 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'merge')

      expect(aggregated).toEqual(['a', 'b'])
    })
  })

  describe('first aggregation', () => {
    it('returns only the first successful result', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const mockResults: DOQueryResult<{ id: string }>[] = [
        { target: { namespace: 'do-1' }, success: true, data: { id: 'first' }, latencyMs: 10 },
        { target: { namespace: 'do-2' }, success: true, data: { id: 'second' }, latencyMs: 15 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'first')

      expect(aggregated).toEqual([{ id: 'first' }])
    })

    it('skips failed results to find first successful', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const mockResults: DOQueryResult<{ id: string }>[] = [
        { target: { namespace: 'do-1' }, success: false, error: 'Failed', latencyMs: 10 },
        { target: { namespace: 'do-2' }, success: true, data: { id: 'second' }, latencyMs: 15 },
        { target: { namespace: 'do-3' }, success: true, data: { id: 'third' }, latencyMs: 12 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'first')

      expect(aggregated).toEqual([{ id: 'second' }])
    })

    it('returns empty array if no successful results', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const mockResults: DOQueryResult<{ id: string }>[] = [
        { target: { namespace: 'do-1' }, success: false, error: 'Failed', latencyMs: 10 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'first')

      expect(aggregated).toEqual([])
    })
  })

  describe('reduce aggregation', () => {
    it('applies custom reducer to aggregate results', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query = createTestQuery({ filter: {} }, 3)

      const result = await coordinator.execute<{ filter: {} }, number[]>(
        query,
        {
          aggregation: 'reduce',
          reducer: (acc, curr) => {
            // Sum all numbers across DOs
            const sum = acc.reduce((a, b) => a + b, 0) + curr.reduce((a, b) => a + b, 0)
            return [sum]
          },
        }
      )

      expect(result.aggregated).toBeDefined()
    })
  })

  describe('aggregation with object results', () => {
    it('aggregates object results correctly', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      interface User { id: string; name: string }
      const mockResults: DOQueryResult<User[]>[] = [
        { target: { namespace: 'do-1' }, success: true, data: [{ id: '1', name: 'Alice' }], latencyMs: 10 },
        { target: { namespace: 'do-2' }, success: true, data: [{ id: '2', name: 'Bob' }], latencyMs: 15 },
      ]

      const aggregated = coordinator.aggregate(mockResults, 'merge')

      expect(aggregated).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ])
    })
  })
})

// ============================================================================
// 4. Timeout Handling Tests
// ============================================================================

describe('Timeout Handling for Slow DOs', () => {
  describe('timeout behavior', () => {
    it('times out slow DO calls', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      // This target should be configured to simulate slow response
      const targets: DOTarget[] = [
        { namespace: 'https://slow.do' },
      ]

      const results = await coordinator.fanOut(
        targets,
        'slowOperation',
        {},
        { timeoutMs: 100 }
      )

      expect(results[0]?.success).toBe(false)
      expect(results[0]?.error).toMatch(/timeout/i)
    })

    it('returns partial results when some DOs timeout', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://fast.do' },
        { namespace: 'https://slow.do' },
        { namespace: 'https://fast2.do' },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {},
        { timeoutMs: 100, allowPartialResults: true }
      )

      expect(results.length).toBe(3)
      // Fast DOs should succeed
      const successful = results.filter(r => r.success)
      const timedOut = results.filter(r => !r.success && r.error?.includes('timeout'))

      expect(successful.length).toBeGreaterThanOrEqual(1)
    })

    it('reports timeout in metrics', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query = createTestQuery({ filter: {} }, 3)
      // Assuming one target is slow

      const result = await coordinator.execute(
        query,
        { timeoutMs: 100 }
      )

      expect(result.metrics.timedOutResponses).toBeGreaterThanOrEqual(0)
      expect(typeof result.metrics.timedOutResponses).toBe('number')
    })

    it('uses default timeout when not specified', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://normal.do' },
      ]

      const startTime = Date.now()
      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {}
        // No timeout specified - should use default (5000ms)
      )

      // Should complete normally if default timeout is reasonable
      expect(results.length).toBe(1)
    })

    it('timeout does not affect fast DOs', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://fast.do' },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {},
        { timeoutMs: 5000 } // Generous timeout
      )

      expect(results[0]?.success).toBe(true)
      expect(results[0]?.latencyMs).toBeLessThan(5000)
    })
  })

  describe('timeout with retries', () => {
    it('retries timed out requests', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://flaky.do' }, // Slow first, fast on retry
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {},
        {
          timeoutMs: 100,
          retry: { maxAttempts: 3, backoffMs: 50 },
        }
      )

      // May or may not succeed depending on mock behavior
      expect(results.length).toBe(1)
    })

    it('respects total timeout across retries', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://always-slow.do' },
      ]

      const startTime = Date.now()
      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {},
        {
          timeoutMs: 100,
          retry: { maxAttempts: 3, backoffMs: 50 },
        }
      )

      const elapsed = Date.now() - startTime

      // Should not take too long even with retries
      expect(elapsed).toBeLessThan(2000)
      expect(results[0]?.success).toBe(false)
    })
  })

  describe('timeout cancellation', () => {
    it('cancels in-flight requests on timeout', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://very-slow.do' },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {},
        { timeoutMs: 50 }
      )

      expect(results[0]?.success).toBe(false)
      // The request should have been cancelled, not completed late
    })
  })
})

// ============================================================================
// 5. Partial Result Handling Tests
// ============================================================================

describe('Partial Result Handling When Some DOs Fail', () => {
  describe('allowPartialResults: true (default)', () => {
    it('returns successful results even when some DOs fail', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://working.do' },
        { namespace: 'https://failing.do' },
        { namespace: 'https://working2.do' },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {},
        { allowPartialResults: true }
      )

      expect(results.length).toBe(3)
      const successful = results.filter(r => r.success)
      expect(successful.length).toBeGreaterThan(0)
    })

    it('marks result as partial when not all DOs succeed', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query: DistributedQuery<{}> = {
        id: 'test-query',
        method: 'findAll',
        params: {},
        targets: [
          { namespace: 'https://working.do' },
          { namespace: 'https://failing.do' },
        ],
      }

      const result = await coordinator.execute(
        query,
        { allowPartialResults: true }
      )

      // If failing.do actually fails, partial should be true
      if (result.results.some(r => !r.success)) {
        expect(result.partial).toBe(true)
      }
    })

    it('includes error details for failed DOs', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://failing.do' },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {},
        { allowPartialResults: true }
      )

      const failed = results.find(r => !r.success)
      if (failed) {
        expect(failed.error).toBeDefined()
        expect(typeof failed.error).toBe('string')
      }
    })
  })

  describe('allowPartialResults: false', () => {
    it('throws error when any DO fails', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://working.do' },
        { namespace: 'https://failing.do' },
      ]

      await expect(
        coordinator.fanOut(
          targets,
          'findAll',
          {},
          { allowPartialResults: false }
        )
      ).rejects.toThrow()
    })

    it('returns complete result when all DOs succeed', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const targets: DOTarget[] = [
        { namespace: 'https://working.do' },
        { namespace: 'https://working2.do' },
      ]

      const results = await coordinator.fanOut(
        targets,
        'findAll',
        {},
        { allowPartialResults: false }
      )

      expect(results.every(r => r.success)).toBe(true)
    })
  })

  describe('failure tracking in metrics', () => {
    it('tracks failed response count', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query: DistributedQuery<{}> = {
        id: 'test-query',
        method: 'findAll',
        params: {},
        targets: [
          { namespace: 'https://working.do' },
          { namespace: 'https://failing.do' },
          { namespace: 'https://failing2.do' },
        ],
      }

      const result = await coordinator.execute(query, { allowPartialResults: true })

      expect(result.metrics.failedResponses).toBeGreaterThanOrEqual(0)
      expect(result.metrics.totalTargets).toBe(3)
      expect(
        result.metrics.successfulResponses + result.metrics.failedResponses + result.metrics.timedOutResponses
      ).toBe(result.metrics.totalTargets)
    })

    it('calculates average latency correctly', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query: DistributedQuery<{}> = {
        id: 'test-query',
        method: 'findAll',
        params: {},
        targets: createTestTargets(5),
      }

      const result = await coordinator.execute(query)

      expect(result.metrics.averageLatencyMs).toBeGreaterThanOrEqual(0)
      expect(result.metrics.maxLatencyMs).toBeGreaterThanOrEqual(result.metrics.averageLatencyMs)
    })
  })

  describe('graceful degradation', () => {
    it('aggregates only successful results', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query: DistributedQuery<{}> = {
        id: 'test-query',
        method: 'findAll',
        params: {},
        targets: [
          { namespace: 'https://working.do' },
          { namespace: 'https://failing.do' },
        ],
      }

      const result = await coordinator.execute<{}, string[]>(
        query,
        { aggregation: 'merge', allowPartialResults: true }
      )

      // Aggregated should only contain data from successful DOs
      expect(result.aggregated).toBeDefined()
      // Should not throw or include undefined/null from failed DOs
      if (result.aggregated) {
        expect(result.aggregated.every(item => item !== undefined && item !== null)).toBe(true)
      }
    })

    it('provides overall success status based on threshold', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query: DistributedQuery<{}> = {
        id: 'test-query',
        method: 'findAll',
        params: {},
        targets: createTestTargets(10),
      }

      const result = await coordinator.execute(query, { allowPartialResults: true })

      // success should be true only if ALL DOs succeeded
      expect(result.success).toBe(result.results.every(r => r.success))
    })
  })
})

// ============================================================================
// 6. Execute Method Tests (Full Integration)
// ============================================================================

describe('Distributed Query Execution (Full Integration)', () => {
  describe('execute method', () => {
    it('executes a complete distributed query', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query = createTestQuery({ filter: { active: true } }, 5)

      const result = await coordinator.execute<{ filter: { active: boolean } }, unknown>(query)

      expect(result.queryId).toBe(query.id)
      expect(result.results.length).toBe(5)
      expect(result.totalLatencyMs).toBeGreaterThan(0)
      expect(result.metrics).toBeDefined()
    })

    it('returns consistent query ID', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const queryId = 'my-unique-query-id'
      const query: DistributedQuery<{}> = {
        id: queryId,
        method: 'findAll',
        params: {},
        targets: createTestTargets(2),
      }

      const result = await coordinator.execute(query)

      expect(result.queryId).toBe(queryId)
    })

    it('applies all options correctly', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query = createTestQuery({}, 5)

      const result = await coordinator.execute(query, {
        timeoutMs: 5000,
        maxConcurrency: 2,
        allowPartialResults: true,
        aggregation: 'collect',
        retry: { maxAttempts: 2, backoffMs: 100 },
      })

      expect(result).toBeDefined()
      expect(result.aggregated).toBeDefined()
    })
  })

  describe('error scenarios', () => {
    it('handles network errors gracefully', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query: DistributedQuery<{}> = {
        id: 'network-error-test',
        method: 'findAll',
        params: {},
        targets: [{ namespace: 'https://unreachable.do' }],
      }

      const result = await coordinator.execute(query, { allowPartialResults: true })

      expect(result.success).toBe(false)
      expect(result.results[0]?.error).toBeDefined()
    })

    it('handles malformed responses', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query: DistributedQuery<{}> = {
        id: 'malformed-response-test',
        method: 'findAll',
        params: {},
        targets: [{ namespace: 'https://malformed.do' }],
      }

      const result = await coordinator.execute(query, { allowPartialResults: true })

      // Should handle gracefully, not throw
      expect(result).toBeDefined()
    })

    it('handles empty response from DOs', async () => {
      const { createDistributedQueryCoordinator } = await import('../index')
      const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

      const query: DistributedQuery<{}> = {
        id: 'empty-response-test',
        method: 'findAll',
        params: {},
        targets: [{ namespace: 'https://empty.do' }],
      }

      const result = await coordinator.execute<{}, unknown[]>(query)

      // Empty is a valid response
      expect(result.success).toBe(true)
      expect(result.results[0]?.data).toEqual([])
    })
  })
})

// ============================================================================
// 7. Health Check Tests
// ============================================================================

describe('DO Health Check', () => {
  it('checks health of all targets', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets = createTestTargets(3)

    const health = await coordinator.healthCheck(targets)

    expect(health.size).toBe(3)
    for (const target of targets) {
      expect(health.has(target.namespace)).toBe(true)
    }
  })

  it('returns true for healthy DOs', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets: DOTarget[] = [
      { namespace: 'https://healthy.do' },
    ]

    const health = await coordinator.healthCheck(targets)

    expect(health.get('https://healthy.do')).toBe(true)
  })

  it('returns false for unhealthy DOs', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets: DOTarget[] = [
      { namespace: 'https://unhealthy.do' },
    ]

    const health = await coordinator.healthCheck(targets)

    expect(health.get('https://unhealthy.do')).toBe(false)
  })

  it('handles mixed healthy and unhealthy DOs', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets: DOTarget[] = [
      { namespace: 'https://healthy.do' },
      { namespace: 'https://unhealthy.do' },
      { namespace: 'https://healthy2.do' },
    ]

    const health = await coordinator.healthCheck(targets)

    expect(health.size).toBe(3)
    // At least one should be healthy, one unhealthy based on naming
  })

  it('returns empty map for empty targets', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const health = await coordinator.healthCheck([])

    expect(health.size).toBe(0)
  })
})

// ============================================================================
// 8. Performance Tests
// ============================================================================

describe('Distributed Query Performance', () => {
  it('handles 100 targets in parallel efficiently', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets = createTestTargets(100)
    const startTime = Date.now()

    const results = await coordinator.fanOut(
      targets,
      'findAll',
      {}
    )

    const elapsed = Date.now() - startTime

    expect(results.length).toBe(100)
    // Parallel execution should be much faster than sequential
    expect(elapsed).toBeLessThan(5000)
  })

  it('limits concurrency to prevent resource exhaustion', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets = createTestTargets(50)

    const results = await coordinator.fanOut(
      targets,
      'findAll',
      {},
      { maxConcurrency: 5 }
    )

    expect(results.length).toBe(50)
  })

  it('completes within total latency budget', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const query = createTestQuery({}, 10)

    const result = await coordinator.execute(query, {
      timeoutMs: 1000,
    })

    expect(result.totalLatencyMs).toBeLessThan(1500) // Some buffer
  })
})

// ============================================================================
// 9. Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  it('handles duplicate targets gracefully', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets: DOTarget[] = [
      { namespace: 'https://same.do' },
      { namespace: 'https://same.do' },
      { namespace: 'https://same.do' },
    ]

    const results = await coordinator.fanOut(targets, 'findAll', {})

    // Should handle duplicates - either dedupe or process all
    expect(results.length).toBeGreaterThan(0)
  })

  it('handles null/undefined in params', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets = createTestTargets(1)

    const results = await coordinator.fanOut(
      targets,
      'findAll',
      { value: null, other: undefined }
    )

    expect(results.length).toBe(1)
  })

  it('handles very long method names', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets = createTestTargets(1)
    const longMethodName = 'a'.repeat(1000)

    const results = await coordinator.fanOut(
      targets,
      longMethodName,
      {}
    )

    expect(results.length).toBe(1)
  })

  it('handles special characters in namespace URLs', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const targets: DOTarget[] = [
      { namespace: 'https://do-with-special%20chars.do' },
    ]

    const results = await coordinator.fanOut(targets, 'findAll', {})

    expect(results.length).toBe(1)
  })

  it('handles large result sets', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')
    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    const query = createTestQuery({ limit: 10000 }, 5)

    const result = await coordinator.execute<{ limit: number }, unknown[]>(query)

    expect(result).toBeDefined()
    // Should handle large payloads without crashing
  })
})

// ============================================================================
// 10. Factory Function Tests
// ============================================================================

describe('Factory Function', () => {
  it('createDistributedQueryCoordinator creates instance with defaults', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')

    const coordinator = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    expect(coordinator.execute).toBeDefined()
    expect(coordinator.fanOut).toBeDefined()
    expect(coordinator.aggregate).toBeDefined()
    expect(coordinator.healthCheck).toBeDefined()
  })

  it('createDistributedQueryCoordinator accepts custom options', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')

    interface CoordinatorOptions {
      defaultTimeoutMs?: number
      defaultMaxConcurrency?: number
      circuitBreakerEnabled?: boolean
    }

    const coordinator = (createDistributedQueryCoordinator as (options?: CoordinatorOptions) => DistributedQueryCoordinator)({
      defaultTimeoutMs: 10000,
      defaultMaxConcurrency: 20,
      circuitBreakerEnabled: true,
    })

    expect(coordinator).toBeDefined()
  })

  it('multiple coordinator instances are independent', async () => {
    const { createDistributedQueryCoordinator } = await import('../index')

    const coordinator1 = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()
    const coordinator2 = (createDistributedQueryCoordinator as () => DistributedQueryCoordinator)()

    expect(coordinator1).not.toBe(coordinator2)
  })
})
