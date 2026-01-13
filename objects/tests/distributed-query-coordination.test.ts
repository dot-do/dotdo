/**
 * Distributed Query Coordination Tests
 *
 * TDD RED Phase: Tests for distributed query coordination across multiple DOs
 *
 * Problem Statement:
 * - Cross-DO relationships store URLs but no mechanism for distributed graph traversal
 * - Multi-hop traversals require N sequential network calls
 * - Need distributed traversal helper with DO RPC routing
 *
 * The DistributedQueryCoordinator should:
 * 1. Execute queries spanning multiple DOs in a single coordinated operation
 * 2. Aggregate results from multiple DO sources
 * 3. Handle timeouts for slow DOs gracefully
 * 4. Handle errors from failed DO calls with partial result support
 * 5. Support graph traversal with relationship following
 * 6. Optimize multi-hop queries with parallel fanout where possible
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// TYPES FOR DISTRIBUTED QUERY COORDINATION
// ============================================================================

/**
 * A query targeting multiple DOs
 */
interface DistributedQuery<TResult = unknown> {
  /** Unique identifier for tracking */
  id: string
  /** Target DO namespaces to query */
  targets: string[]
  /** Query predicate/filter to apply at each DO */
  predicate?: Record<string, unknown>
  /** Fields to return */
  select?: string[]
  /** Maximum depth for traversal */
  maxDepth?: number
  /** Overall timeout for the query */
  timeout?: number
}

/**
 * Result from a single DO in the distributed query
 */
interface DOQueryResult<T = unknown> {
  /** The DO namespace that was queried */
  namespace: string
  /** Whether the query succeeded */
  success: boolean
  /** The data returned */
  data?: T[]
  /** Error if failed */
  error?: Error
  /** Time taken in ms */
  duration: number
}

/**
 * Aggregated result from distributed query
 */
interface DistributedQueryResult<T = unknown> {
  /** Whether all queries succeeded */
  success: boolean
  /** Aggregated data from all DOs */
  data: T[]
  /** Results from each DO */
  doResults: DOQueryResult<T>[]
  /** DOs that failed */
  failures: { namespace: string; error: Error }[]
  /** Total time taken */
  duration: number
  /** Whether results are partial due to failures */
  partial: boolean
}

/**
 * Relationship edge for graph traversal
 */
interface RelationshipEdge {
  from: string
  to: string
  verb: string
  data?: Record<string, unknown>
}

/**
 * Graph traversal query options
 */
interface TraversalOptions {
  /** Starting node URL */
  startUrl: string
  /** Relationship verbs to follow */
  verbs?: string[]
  /** Maximum traversal depth */
  maxDepth: number
  /** Direction: outgoing, incoming, or both */
  direction: 'outgoing' | 'incoming' | 'both'
  /** Timeout per hop in ms */
  hopTimeout?: number
  /** Overall timeout in ms */
  timeout?: number
}

/**
 * Result of graph traversal
 */
interface TraversalResult {
  /** All nodes visited */
  nodes: string[]
  /** All edges traversed */
  edges: RelationshipEdge[]
  /** Nodes at each depth level */
  levels: Map<number, string[]>
  /** Whether traversal completed fully */
  complete: boolean
  /** Errors encountered */
  errors: { url: string; error: Error }[]
  /** Total duration */
  duration: number
}

/**
 * Mock DO stub interface for testing
 */
interface MockDOStub {
  id: string
  fetch: (request: Request) => Promise<Response>
}

/**
 * The coordinator class we're testing (not yet implemented)
 */
interface DistributedQueryCoordinator {
  /** Execute a query across multiple DOs */
  executeQuery<T>(query: DistributedQuery<T>): Promise<DistributedQueryResult<T>>
  /** Traverse relationships across DOs */
  traverseGraph(options: TraversalOptions): Promise<TraversalResult>
  /** Fan out to multiple DOs in parallel */
  fanout<T>(namespaces: string[], operation: (stub: MockDOStub) => Promise<T>): Promise<Map<string, T | Error>>
  /** Aggregate results using a reducer */
  aggregate<T, R>(query: DistributedQuery<T>, reducer: (acc: R, item: T) => R, initial: R): Promise<R>
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Creates a mock DO stub that returns data after a delay
 */
function createMockDOStub(
  id: string,
  responseData: unknown[],
  options?: { delay?: number; shouldFail?: boolean; errorMessage?: string }
): MockDOStub {
  return {
    id,
    fetch: vi.fn(async (request: Request) => {
      if (options?.delay) {
        await new Promise(r => setTimeout(r, options.delay))
      }
      if (options?.shouldFail) {
        return new Response(
          JSON.stringify({ error: options.errorMessage || 'Internal error' }),
          { status: 500 }
        )
      }
      return new Response(JSON.stringify(responseData), { status: 200 })
    }),
  }
}

/**
 * Creates a mock namespace that returns stubs
 */
function createMockNamespace(stubs: Map<string, MockDOStub>) {
  return {
    idFromName: vi.fn((name: string) => ({ toString: () => name })),
    idFromString: vi.fn((id: string) => ({ toString: () => id })),
    get: vi.fn((id: { toString: () => string }) => stubs.get(id.toString())),
  }
}

// ============================================================================
// PLACEHOLDER COORDINATOR (will fail - RED phase)
// ============================================================================

/**
 * Placeholder implementation that will fail all tests
 * Real implementation should be in objects/DistributedQueryCoordinator.ts
 */
class PlaceholderDistributedQueryCoordinator implements DistributedQueryCoordinator {
  async executeQuery<T>(_query: DistributedQuery<T>): Promise<DistributedQueryResult<T>> {
    throw new Error('DistributedQueryCoordinator.executeQuery not implemented')
  }

  async traverseGraph(_options: TraversalOptions): Promise<TraversalResult> {
    throw new Error('DistributedQueryCoordinator.traverseGraph not implemented')
  }

  async fanout<T>(
    _namespaces: string[],
    _operation: (stub: MockDOStub) => Promise<T>
  ): Promise<Map<string, T | Error>> {
    throw new Error('DistributedQueryCoordinator.fanout not implemented')
  }

  async aggregate<T, R>(
    _query: DistributedQuery<T>,
    _reducer: (acc: R, item: T) => R,
    _initial: R
  ): Promise<R> {
    throw new Error('DistributedQueryCoordinator.aggregate not implemented')
  }
}

// ============================================================================
// TESTS: Query Spanning Multiple DOs
// ============================================================================

describe('DistributedQueryCoordinator', () => {
  let coordinator: DistributedQueryCoordinator

  beforeEach(() => {
    coordinator = new PlaceholderDistributedQueryCoordinator()
  })

  describe('Query spanning multiple DOs', () => {
    it('should execute a query across multiple DO namespaces', async () => {
      const query: DistributedQuery<{ id: string; name: string }> = {
        id: 'q1',
        targets: ['https://users.do', 'https://teams.do', 'https://projects.do'],
        predicate: { status: 'active' },
        select: ['id', 'name'],
      }

      const result = await coordinator.executeQuery(query)

      expect(result.success).toBe(true)
      expect(result.doResults).toHaveLength(3)
      expect(result.data.length).toBeGreaterThan(0)
      // Each DO result should be identified
      expect(result.doResults.every(r => r.namespace)).toBe(true)
    })

    it('should apply predicate filter at each target DO', async () => {
      const query: DistributedQuery<{ id: string; status: string }> = {
        id: 'q2',
        targets: ['https://orders.do'],
        predicate: { status: 'pending', amount: { $gt: 100 } },
      }

      const result = await coordinator.executeQuery(query)

      expect(result.success).toBe(true)
      // All returned items should match the predicate
      expect(result.data.every(item => item.status === 'pending')).toBe(true)
    })

    it('should handle empty results from some DOs', async () => {
      const query: DistributedQuery = {
        id: 'q3',
        targets: ['https://do1.do', 'https://do2.do', 'https://do3.do'],
        predicate: { rareField: 'very-rare-value' },
      }

      const result = await coordinator.executeQuery(query)

      expect(result.success).toBe(true)
      // Some DOs might return empty, but query should still succeed
      expect(result.doResults.some(r => r.success && (r.data?.length ?? 0) === 0)).toBe(true)
    })

    it('should select only specified fields', async () => {
      const query: DistributedQuery<{ id: string; email: string }> = {
        id: 'q4',
        targets: ['https://users.do'],
        select: ['id', 'email'],
      }

      const result = await coordinator.executeQuery(query)

      expect(result.success).toBe(true)
      // Returned objects should only have selected fields
      result.data.forEach(item => {
        expect(Object.keys(item)).toEqual(['id', 'email'])
      })
    })

    it('should execute queries in parallel across DOs', async () => {
      const start = Date.now()
      const query: DistributedQuery = {
        id: 'q5',
        targets: ['https://do1.do', 'https://do2.do', 'https://do3.do'],
        timeout: 5000,
      }

      await coordinator.executeQuery(query)
      const elapsed = Date.now() - start

      // If running in parallel, total time should be ~max single DO time, not sum
      // Each DO takes ~100ms, so parallel should be ~100-200ms, not 300ms
      expect(elapsed).toBeLessThan(250)
    })
  })

  // ==========================================================================
  // TESTS: Result Aggregation from Multiple Sources
  // ==========================================================================

  describe('Result aggregation from multiple sources', () => {
    it('should aggregate results from all DOs into a single array', async () => {
      const query: DistributedQuery<{ id: string }> = {
        id: 'agg1',
        targets: ['https://do1.do', 'https://do2.do'],
      }

      const result = await coordinator.executeQuery(query)

      expect(result.success).toBe(true)
      // Data should be combined from all sources
      expect(result.data.length).toBeGreaterThan(0)
      // Can verify source via doResults
      const totalFromSources = result.doResults.reduce(
        (sum, r) => sum + (r.data?.length ?? 0),
        0
      )
      expect(result.data.length).toBe(totalFromSources)
    })

    it('should aggregate with custom reducer function', async () => {
      const query: DistributedQuery<{ amount: number }> = {
        id: 'agg2',
        targets: ['https://sales.do', 'https://refunds.do'],
      }

      // Sum all amounts
      const total = await coordinator.aggregate(
        query,
        (acc, item) => acc + item.amount,
        0
      )

      expect(typeof total).toBe('number')
      expect(total).toBeGreaterThanOrEqual(0)
    })

    it('should support count aggregation', async () => {
      const query: DistributedQuery<{ id: string }> = {
        id: 'agg3',
        targets: ['https://events.do', 'https://logs.do'],
        predicate: { level: 'error' },
      }

      const count = await coordinator.aggregate(
        query,
        (acc, _item) => acc + 1,
        0
      )

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('should support group-by aggregation', async () => {
      const query: DistributedQuery<{ category: string; amount: number }> = {
        id: 'agg4',
        targets: ['https://transactions.do'],
      }

      const grouped = await coordinator.aggregate<
        { category: string; amount: number },
        Record<string, number>
      >(
        query,
        (acc, item) => {
          acc[item.category] = (acc[item.category] || 0) + item.amount
          return acc
        },
        {}
      )

      expect(typeof grouped).toBe('object')
    })

    it('should preserve source information in aggregated results', async () => {
      const query: DistributedQuery = {
        id: 'agg5',
        targets: ['https://us-east.do', 'https://us-west.do', 'https://eu.do'],
      }

      const result = await coordinator.executeQuery(query)

      // Each result should be traceable to its source DO
      expect(result.doResults.length).toBe(3)
      result.doResults.forEach(doResult => {
        expect(doResult.namespace).toBeTruthy()
        expect(typeof doResult.duration).toBe('number')
      })
    })

    it('should deduplicate results when specified', async () => {
      // Same entity might exist in multiple DOs
      const query: DistributedQuery<{ id: string; name: string }> = {
        id: 'agg6',
        targets: ['https://cache.do', 'https://primary.do'],
      }

      const result = await coordinator.executeQuery(query)

      // Verify no duplicate IDs in final result
      const ids = result.data.map(d => d.id)
      const uniqueIds = new Set(ids)
      expect(ids.length).toBe(uniqueIds.size)
    })
  })

  // ==========================================================================
  // TESTS: Timeout Handling for Slow DOs
  // ==========================================================================

  describe('Timeout handling for slow DOs', () => {
    it('should timeout slow DO queries', async () => {
      const query: DistributedQuery = {
        id: 'timeout1',
        targets: ['https://slow.do'],
        timeout: 100, // 100ms timeout
      }

      const result = await coordinator.executeQuery(query)

      // Query should complete with partial results
      expect(result.partial).toBe(true)
      expect(result.failures.length).toBeGreaterThan(0)
      expect(result.failures[0].error.message).toMatch(/timeout/i)
    })

    it('should return partial results from fast DOs when some timeout', async () => {
      const query: DistributedQuery<{ id: string }> = {
        id: 'timeout2',
        targets: ['https://fast.do', 'https://slow.do'],
        timeout: 100,
      }

      const result = await coordinator.executeQuery(query)

      // Should have results from fast DO
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.partial).toBe(true)
      // Fast DO should succeed
      expect(result.doResults.find(r => r.namespace === 'https://fast.do')?.success).toBe(true)
      // Slow DO should fail
      expect(result.doResults.find(r => r.namespace === 'https://slow.do')?.success).toBe(false)
    })

    it('should support per-DO timeout configuration', async () => {
      const query: DistributedQuery = {
        id: 'timeout3',
        targets: ['https://critical.do', 'https://optional.do'],
        timeout: 5000, // Overall timeout
        // Individual DO timeouts would be set differently
      }

      const result = await coordinator.executeQuery(query)

      // Verify query respects timeout
      expect(result.duration).toBeLessThan(5100)
    })

    it('should cancel in-flight requests on overall timeout', async () => {
      const query: DistributedQuery = {
        id: 'timeout4',
        targets: ['https://do1.do', 'https://do2.do', 'https://do3.do'],
        timeout: 50,
      }

      const start = Date.now()
      await coordinator.executeQuery(query)
      const elapsed = Date.now() - start

      // Should not wait for all DOs if overall timeout hit
      expect(elapsed).toBeLessThan(200)
    })

    it('should track timeout statistics per DO', async () => {
      const query: DistributedQuery = {
        id: 'timeout5',
        targets: ['https://flaky.do'],
        timeout: 100,
      }

      const result = await coordinator.executeQuery(query)

      // Duration should be tracked even for failed requests
      const flakyResult = result.doResults.find(r => r.namespace === 'https://flaky.do')
      expect(flakyResult).toBeDefined()
      expect(typeof flakyResult!.duration).toBe('number')
    })
  })

  // ==========================================================================
  // TESTS: Error Handling for Failed DO Calls
  // ==========================================================================

  describe('Error handling for failed DO calls', () => {
    it('should handle network errors from DOs gracefully', async () => {
      const query: DistributedQuery = {
        id: 'error1',
        targets: ['https://unreachable.do'],
      }

      const result = await coordinator.executeQuery(query)

      expect(result.partial).toBe(true)
      expect(result.failures.length).toBe(1)
      expect(result.failures[0].namespace).toBe('https://unreachable.do')
    })

    it('should handle 500 errors from DOs', async () => {
      const query: DistributedQuery = {
        id: 'error2',
        targets: ['https://broken.do'],
      }

      const result = await coordinator.executeQuery(query)

      expect(result.partial).toBe(true)
      expect(result.failures[0].error.message).toContain('500')
    })

    it('should continue with other DOs when one fails', async () => {
      const query: DistributedQuery<{ id: string }> = {
        id: 'error3',
        targets: ['https://healthy1.do', 'https://broken.do', 'https://healthy2.do'],
      }

      const result = await coordinator.executeQuery(query)

      // Should still get results from healthy DOs
      expect(result.data.length).toBeGreaterThan(0)
      // Healthy DOs should succeed
      expect(result.doResults.filter(r => r.success).length).toBe(2)
      // Broken DO should fail
      expect(result.failures.length).toBe(1)
    })

    it('should provide detailed error information', async () => {
      const query: DistributedQuery = {
        id: 'error4',
        targets: ['https://error.do'],
      }

      const result = await coordinator.executeQuery(query)

      expect(result.failures[0]).toMatchObject({
        namespace: 'https://error.do',
        error: expect.any(Error),
      })
      // Error should have useful context
      expect(result.failures[0].error.message).toBeTruthy()
    })

    it('should handle malformed responses from DOs', async () => {
      const query: DistributedQuery = {
        id: 'error5',
        targets: ['https://malformed.do'],
      }

      const result = await coordinator.executeQuery(query)

      expect(result.partial).toBe(true)
      expect(result.failures[0].error.message).toMatch(/parse|invalid|malformed/i)
    })

    it('should retry transient errors before failing', async () => {
      const query: DistributedQuery = {
        id: 'error6',
        targets: ['https://flaky.do'],
        // Retry configuration would be here
      }

      // First call might fail, retry should succeed
      const result = await coordinator.executeQuery(query)

      // Even if flaky, should have attempted retries
      expect(result.doResults[0]).toBeDefined()
    })

    it('should mark query as success if at least one DO returns results', async () => {
      const query: DistributedQuery<{ id: string }> = {
        id: 'error7',
        targets: ['https://working.do', 'https://broken1.do', 'https://broken2.do'],
      }

      const result = await coordinator.executeQuery(query)

      // Query overall can be considered successful with partial results
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.partial).toBe(true)
    })

    it('should fail query if all DOs fail', async () => {
      const query: DistributedQuery = {
        id: 'error8',
        targets: ['https://broken1.do', 'https://broken2.do'],
      }

      const result = await coordinator.executeQuery(query)

      expect(result.success).toBe(false)
      expect(result.data).toHaveLength(0)
      expect(result.failures.length).toBe(2)
    })
  })

  // ==========================================================================
  // TESTS: Graph Traversal with Relationship Following
  // ==========================================================================

  describe('Graph traversal with relationship following', () => {
    it('should traverse outgoing relationships from a starting node', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://users.do/user-123',
        verbs: ['owns', 'manages'],
        maxDepth: 2,
        direction: 'outgoing',
      }

      const result = await coordinator.traverseGraph(options)

      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.nodes).toContain('https://users.do/user-123')
      expect(result.edges.length).toBeGreaterThan(0)
    })

    it('should traverse incoming relationships to a node', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://projects.do/proj-456',
        verbs: ['contributes-to'],
        maxDepth: 1,
        direction: 'incoming',
      }

      const result = await coordinator.traverseGraph(options)

      expect(result.nodes.length).toBeGreaterThan(0)
      // All edges should point TO the start node
      expect(result.edges.every(e => e.to === 'https://projects.do/proj-456')).toBe(true)
    })

    it('should traverse bidirectionally when specified', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://teams.do/team-1',
        maxDepth: 2,
        direction: 'both',
      }

      const result = await coordinator.traverseGraph(options)

      // Should find both incoming and outgoing relationships
      expect(result.edges.some(e => e.from === 'https://teams.do/team-1')).toBe(true)
      expect(result.edges.some(e => e.to === 'https://teams.do/team-1')).toBe(true)
    })

    it('should respect maxDepth limit', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://root.do/entity-1',
        maxDepth: 3,
        direction: 'outgoing',
      }

      const result = await coordinator.traverseGraph(options)

      // Levels map should have at most maxDepth + 1 levels (0 to maxDepth)
      expect(result.levels.size).toBeLessThanOrEqual(4)
    })

    it('should track nodes at each depth level', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://org.do/company',
        maxDepth: 2,
        direction: 'outgoing',
      }

      const result = await coordinator.traverseGraph(options)

      // Level 0 should contain start node
      expect(result.levels.get(0)).toContain('https://org.do/company')
      // Other levels should have discovered nodes
      expect(result.levels.size).toBeGreaterThan(1)
    })

    it('should handle cycles in the graph', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://cyclic.do/node-a',
        maxDepth: 10,
        direction: 'outgoing',
      }

      const result = await coordinator.traverseGraph(options)

      // Should not visit same node twice
      const uniqueNodes = new Set(result.nodes)
      expect(result.nodes.length).toBe(uniqueNodes.size)
      // Should complete despite cycle
      expect(result.complete).toBe(true)
    })

    it('should filter by relationship verbs', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://users.do/user-1',
        verbs: ['owns'],
        maxDepth: 2,
        direction: 'outgoing',
      }

      const result = await coordinator.traverseGraph(options)

      // All edges should have the specified verb
      expect(result.edges.every(e => e.verb === 'owns')).toBe(true)
    })

    it('should follow relationships across different DO namespaces', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://users.do/user-1',
        maxDepth: 2,
        direction: 'outgoing',
      }

      const result = await coordinator.traverseGraph(options)

      // Should traverse to nodes in different namespaces
      const namespaces = new Set(result.nodes.map(n => new URL(n).origin))
      expect(namespaces.size).toBeGreaterThan(1)
    })
  })

  // ==========================================================================
  // TESTS: Parallel Fanout Operations
  // ==========================================================================

  describe('Parallel fanout operations', () => {
    it('should fan out operations to multiple DOs in parallel', async () => {
      const namespaces = ['https://shard1.do', 'https://shard2.do', 'https://shard3.do']

      const results = await coordinator.fanout(namespaces, async (stub) => {
        return { id: stub.id, result: 'success' }
      })

      expect(results.size).toBe(3)
      expect(results.get('https://shard1.do')).toBeDefined()
      expect(results.get('https://shard2.do')).toBeDefined()
      expect(results.get('https://shard3.do')).toBeDefined()
    })

    it('should return errors for failed fanout operations', async () => {
      const namespaces = ['https://healthy.do', 'https://broken.do']

      const results = await coordinator.fanout(namespaces, async (stub) => {
        if (stub.id === 'broken') {
          throw new Error('DO unavailable')
        }
        return { success: true }
      })

      expect(results.get('https://healthy.do')).not.toBeInstanceOf(Error)
      expect(results.get('https://broken.do')).toBeInstanceOf(Error)
    })

    it('should complete fanout faster than sequential execution', async () => {
      const namespaces = Array.from({ length: 10 }, (_, i) => `https://shard${i}.do`)

      const start = Date.now()
      await coordinator.fanout(namespaces, async () => {
        await new Promise(r => setTimeout(r, 50)) // Each takes 50ms
        return { done: true }
      })
      const elapsed = Date.now() - start

      // Sequential would take 500ms, parallel should be ~50-100ms
      expect(elapsed).toBeLessThan(200)
    })

    it('should respect concurrency limits', async () => {
      const namespaces = Array.from({ length: 100 }, (_, i) => `https://shard${i}.do`)
      let concurrentCount = 0
      let maxConcurrent = 0

      await coordinator.fanout(namespaces, async () => {
        concurrentCount++
        maxConcurrent = Math.max(maxConcurrent, concurrentCount)
        await new Promise(r => setTimeout(r, 10))
        concurrentCount--
        return { done: true }
      })

      // Should limit concurrent operations (e.g., max 10-20)
      expect(maxConcurrent).toBeLessThanOrEqual(20)
    })

    it('should handle mixed success and failure in fanout', async () => {
      const namespaces = ['https://do1.do', 'https://do2.do', 'https://do3.do']
      let callCount = 0

      const results = await coordinator.fanout(namespaces, async () => {
        callCount++
        if (callCount === 2) {
          throw new Error('Simulated failure')
        }
        return { success: true }
      })

      const successes = [...results.values()].filter(v => !(v instanceof Error))
      const failures = [...results.values()].filter(v => v instanceof Error)

      expect(successes.length).toBe(2)
      expect(failures.length).toBe(1)
    })
  })

  // ==========================================================================
  // TESTS: Traversal Timeout Handling
  // ==========================================================================

  describe('Traversal timeout handling', () => {
    it('should timeout on slow hop traversals', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://slow.do/entity',
        maxDepth: 5,
        direction: 'outgoing',
        hopTimeout: 50, // 50ms per hop
      }

      const result = await coordinator.traverseGraph(options)

      // Traversal might be incomplete due to timeouts
      expect(result.complete).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0].error.message).toMatch(/timeout/i)
    })

    it('should respect overall traversal timeout', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://deep.do/root',
        maxDepth: 100,
        direction: 'outgoing',
        timeout: 200, // 200ms total
      }

      const start = Date.now()
      const result = await coordinator.traverseGraph(options)
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(300)
      expect(result.complete).toBe(false)
    })

    it('should return partial traversal results on timeout', async () => {
      const options: TraversalOptions = {
        startUrl: 'https://graph.do/start',
        maxDepth: 10,
        direction: 'outgoing',
        timeout: 100,
      }

      const result = await coordinator.traverseGraph(options)

      // Should have some results even if incomplete
      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.levels.get(0)).toContain('https://graph.do/start')
    })
  })
})
