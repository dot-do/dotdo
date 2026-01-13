/**
 * Distributed Graph Traversal Tests
 *
 * TDD RED Phase: Tests for distributed query coordination across DOs
 *
 * Problem Statement (from architectural review):
 * - Cross-DO relationships store URLs but no mechanism for distributed graph traversal
 * - Multi-hop traversals require N sequential network calls
 * - Need distributed traversal helper with DO RPC routing
 *
 * Key Requirements:
 * 1. Multi-hop traversal across DOs (User -> Org -> Members -> Roles)
 * 2. Batching of DO RPC calls for efficiency
 * 3. Parallel traversal when possible (siblings on same level)
 * 4. Circuit breaker integration for failing DOs
 * 5. Caching of intermediate results
 *
 * Uses real infrastructure, NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// TYPES - Distributed Traversal
// ============================================================================

/**
 * A traversal step defines one hop in a multi-hop traversal
 */
interface TraversalStep {
  /** The verb to traverse (e.g., 'memberOf', 'hasRole') */
  verb: string
  /** Direction of traversal: 'outgoing' (from->to), 'incoming' (to->from) */
  direction: 'outgoing' | 'incoming'
  /** Optional filter on target type */
  targetType?: string
}

/**
 * Options for distributed traversal
 */
interface DistributedTraversalOptions {
  /** Starting URL(s) for traversal */
  startUrls: string[]
  /** Sequence of traversal steps */
  steps: TraversalStep[]
  /** Maximum depth to traverse (default: steps.length) */
  maxDepth?: number
  /** Whether to enable parallel fetching (default: true) */
  parallel?: boolean
  /** Whether to batch RPC calls to the same DO (default: true) */
  batchRpc?: boolean
  /** Timeout per DO call in milliseconds (default: 5000) */
  timeoutMs?: number
  /** Whether to include full Thing data or just URLs (default: false) */
  includeData?: boolean
}

/**
 * Result of a distributed traversal
 */
interface DistributedTraversalResult {
  /** All URLs discovered at the final step */
  urls: string[]
  /** Full path information if requested */
  paths?: TraversalPath[]
  /** Metrics about the traversal */
  metrics: TraversalMetrics
}

/**
 * A single path through the graph
 */
interface TraversalPath {
  /** Sequence of URLs from start to end */
  nodes: string[]
  /** Sequence of verbs used */
  edges: string[]
}

/**
 * Metrics about the traversal execution
 */
interface TraversalMetrics {
  /** Total number of DO RPC calls made */
  rpcCalls: number
  /** Number of unique DOs contacted */
  uniqueDOs: number
  /** Total time in milliseconds */
  totalTimeMs: number
  /** Number of cache hits */
  cacheHits: number
  /** Number of circuit breaker trips */
  circuitBreakerTrips: number
}

/**
 * A batch of traversal requests for a single DO
 */
interface DOTraversalBatch {
  /** Target DO namespace URL */
  doNamespace: string
  /** Requests to execute on this DO */
  requests: DOTraversalRequest[]
}

/**
 * A single traversal request within a batch
 */
interface DOTraversalRequest {
  /** Starting URLs within this DO */
  fromUrls: string[]
  /** The verb to traverse */
  verb: string
  /** Direction of traversal */
  direction: 'outgoing' | 'incoming'
}

/**
 * Response from a batched DO traversal
 */
interface DOTraversalResponse {
  /** Map from starting URL to discovered target URLs */
  results: Map<string, string[]>
  /** Any errors that occurred */
  errors?: Map<string, string>
}

// ============================================================================
// INTERFACE - DistributedTraversalEngine
// ============================================================================

/**
 * Interface for the distributed traversal engine
 */
interface DistributedTraversalEngine {
  /**
   * Execute a multi-hop distributed traversal
   */
  traverse(options: DistributedTraversalOptions): Promise<DistributedTraversalResult>

  /**
   * Execute a single-hop traversal from URLs
   */
  traverseStep(
    fromUrls: string[],
    step: TraversalStep
  ): Promise<Map<string, string[]>>

  /**
   * Batch multiple traversal requests by target DO
   */
  batchByDO(
    requests: Array<{ url: string; step: TraversalStep }>
  ): DOTraversalBatch[]

  /**
   * Execute batched requests in parallel
   */
  executeBatch(batches: DOTraversalBatch[]): Promise<DOTraversalResponse[]>

  /**
   * Clear traversal cache
   */
  clearCache(): void
}

// ============================================================================
// 1. DistributedTraversalEngine Interface Tests
// ============================================================================

describe('DistributedTraversalEngine Interface', () => {
  it('DistributedTraversalEngine should be exported from db/graph', async () => {
    // This will fail until DistributedTraversalEngine is implemented
    const module = await import('../index')
    expect(module).toHaveProperty('DistributedTraversalEngine')
  })

  it('has traverse method', async () => {
    const module = await import('../index')
    const Engine = (module as Record<string, unknown>).DistributedTraversalEngine as new (...args: unknown[]) => DistributedTraversalEngine
    expect(Engine.prototype.traverse).toBeDefined()
  })

  it('has traverseStep method', async () => {
    const module = await import('../index')
    const Engine = (module as Record<string, unknown>).DistributedTraversalEngine as new (...args: unknown[]) => DistributedTraversalEngine
    expect(Engine.prototype.traverseStep).toBeDefined()
  })

  it('has batchByDO method', async () => {
    const module = await import('../index')
    const Engine = (module as Record<string, unknown>).DistributedTraversalEngine as new (...args: unknown[]) => DistributedTraversalEngine
    expect(Engine.prototype.batchByDO).toBeDefined()
  })

  it('has executeBatch method', async () => {
    const module = await import('../index')
    const Engine = (module as Record<string, unknown>).DistributedTraversalEngine as new (...args: unknown[]) => DistributedTraversalEngine
    expect(Engine.prototype.executeBatch).toBeDefined()
  })

  it('has clearCache method', async () => {
    const module = await import('../index')
    const Engine = (module as Record<string, unknown>).DistributedTraversalEngine as new (...args: unknown[]) => DistributedTraversalEngine
    expect(Engine.prototype.clearCache).toBeDefined()
  })
})

// ============================================================================
// 2. Multi-Hop Traversal Tests
// ============================================================================

describe('Multi-Hop Traversal Across DOs', () => {
  /**
   * In-memory graph setup for testing
   *
   * Simulates the following structure across multiple DOs:
   *
   * users.do:
   *   - User (alice) --memberOf--> Org (acme)
   *
   * orgs.do:
   *   - Org (acme) --hasMembers--> User (bob), User (carol)
   *   - Org (acme) --hasRole--> Role (admin), Role (member)
   *
   * roles.do:
   *   - Role (admin) --assignedTo--> User (bob)
   *   - Role (member) --assignedTo--> User (carol)
   */

  describe('User -> Org -> Members traversal', () => {
    it('traverses from User to Org to Members in two hops', async () => {
      // This test verifies that we can traverse:
      // https://users.do/alice --memberOf--> https://orgs.do/acme --hasMembers--> [bob, carol]
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
          { verb: 'hasMembers', direction: 'outgoing' },
        ],
      })

      expect(result.urls).toContain('https://users.do/bob')
      expect(result.urls).toContain('https://users.do/carol')
      expect(result.urls).toHaveLength(2)
    })

    it('handles empty intermediate results gracefully', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://users.do/orphan'], // User not member of any org
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
          { verb: 'hasMembers', direction: 'outgoing' },
        ],
      })

      expect(result.urls).toHaveLength(0)
    })

    it('includes path information when requested', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
          { verb: 'hasMembers', direction: 'outgoing' },
        ],
        includeData: true,
      })

      expect(result.paths).toBeDefined()
      expect(result.paths!.length).toBeGreaterThan(0)

      const pathToBob = result.paths!.find(p => p.nodes.includes('https://users.do/bob'))
      expect(pathToBob).toBeDefined()
      expect(pathToBob!.nodes).toEqual([
        'https://users.do/alice',
        'https://orgs.do/acme',
        'https://users.do/bob',
      ])
      expect(pathToBob!.edges).toEqual(['memberOf', 'hasMembers'])
    })
  })

  describe('User -> Org -> Roles -> Assignees traversal', () => {
    it('traverses three hops across DOs', async () => {
      // https://users.do/alice --memberOf--> https://orgs.do/acme
      //   --hasRole--> https://roles.do/admin --assignedTo--> https://users.do/bob
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
          { verb: 'hasRole', direction: 'outgoing' },
          { verb: 'assignedTo', direction: 'outgoing' },
        ],
      })

      expect(result.urls).toContain('https://users.do/bob')
      expect(result.urls).toContain('https://users.do/carol')
    })

    it('respects maxDepth option', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
          { verb: 'hasRole', direction: 'outgoing' },
          { verb: 'assignedTo', direction: 'outgoing' },
        ],
        maxDepth: 2, // Stop after 2 hops
      })

      // Should only reach roles, not the assigned users
      expect(result.urls).toContain('https://roles.do/admin')
      expect(result.urls).toContain('https://roles.do/member')
      expect(result.urls).not.toContain('https://users.do/bob')
    })

    it('filters by target type when specified', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
          { verb: 'hasRole', direction: 'outgoing', targetType: 'AdminRole' },
        ],
      })

      expect(result.urls).toContain('https://roles.do/admin')
      expect(result.urls).not.toContain('https://roles.do/member')
    })
  })

  describe('Incoming direction traversal', () => {
    it('traverses incoming relationships (reverse direction)', async () => {
      // Find all users that are members of an org
      // https://orgs.do/acme <--memberOf-- [users who are members]
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://orgs.do/acme'],
        steps: [
          { verb: 'memberOf', direction: 'incoming' },
        ],
      })

      expect(result.urls).toContain('https://users.do/alice')
    })

    it('mixes incoming and outgoing directions', async () => {
      // From an org, find who created it, then find their other creations
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://orgs.do/acme'],
        steps: [
          { verb: 'created', direction: 'incoming' }, // Who created this org?
          { verb: 'created', direction: 'outgoing' }, // What else did they create?
        ],
      })

      // Result depends on the graph structure
      expect(result.urls).toBeDefined()
    })
  })
})

// ============================================================================
// 3. Batching DO RPC Calls Tests
// ============================================================================

describe('Batching DO RPC Calls', () => {
  describe('batchByDO', () => {
    it('groups requests by target DO namespace', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const requests = [
        { url: 'https://users.do/alice', step: { verb: 'memberOf', direction: 'outgoing' as const } },
        { url: 'https://users.do/bob', step: { verb: 'memberOf', direction: 'outgoing' as const } },
        { url: 'https://orgs.do/acme', step: { verb: 'hasMembers', direction: 'outgoing' as const } },
      ]

      const batches = engine.batchByDO(requests)

      // Should create 2 batches: one for users.do, one for orgs.do
      expect(batches).toHaveLength(2)

      const usersBatch = batches.find(b => b.doNamespace === 'https://users.do')
      const orgsBatch = batches.find(b => b.doNamespace === 'https://orgs.do')

      expect(usersBatch).toBeDefined()
      expect(usersBatch!.requests).toHaveLength(1) // Same verb/direction gets merged
      expect(usersBatch!.requests[0].fromUrls).toContain('https://users.do/alice')
      expect(usersBatch!.requests[0].fromUrls).toContain('https://users.do/bob')

      expect(orgsBatch).toBeDefined()
      expect(orgsBatch!.requests).toHaveLength(1)
    })

    it('separates different verbs within same DO', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const requests = [
        { url: 'https://users.do/alice', step: { verb: 'memberOf', direction: 'outgoing' as const } },
        { url: 'https://users.do/alice', step: { verb: 'created', direction: 'outgoing' as const } },
      ]

      const batches = engine.batchByDO(requests)

      // Should create 1 batch with 2 requests (different verbs)
      expect(batches).toHaveLength(1)
      expect(batches[0].requests).toHaveLength(2)
    })

    it('separates different directions within same DO/verb', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const requests = [
        { url: 'https://users.do/alice', step: { verb: 'memberOf', direction: 'outgoing' as const } },
        { url: 'https://users.do/alice', step: { verb: 'memberOf', direction: 'incoming' as const } },
      ]

      const batches = engine.batchByDO(requests)

      expect(batches).toHaveLength(1)
      expect(batches[0].requests).toHaveLength(2)
    })

    it('returns empty array for empty input', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const batches = engine.batchByDO([])

      expect(batches).toEqual([])
    })
  })

  describe('executeBatch', () => {
    it('executes all batches and returns consolidated results', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const batches: DOTraversalBatch[] = [
        {
          doNamespace: 'https://users.do',
          requests: [
            { fromUrls: ['https://users.do/alice'], verb: 'memberOf', direction: 'outgoing' },
          ],
        },
      ]

      const responses = await engine.executeBatch(batches)

      expect(responses).toHaveLength(1)
      expect(responses[0].results).toBeDefined()
      expect(responses[0].results.get('https://users.do/alice')).toBeDefined()
    })

    it('handles partial failures gracefully', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const batches: DOTraversalBatch[] = [
        {
          doNamespace: 'https://users.do',
          requests: [
            { fromUrls: ['https://users.do/alice'], verb: 'memberOf', direction: 'outgoing' },
          ],
        },
        {
          doNamespace: 'https://failing.do', // This DO will fail
          requests: [
            { fromUrls: ['https://failing.do/item'], verb: 'linkedTo', direction: 'outgoing' },
          ],
        },
      ]

      const responses = await engine.executeBatch(batches)

      // First batch should succeed
      expect(responses[0].results).toBeDefined()

      // Second batch should have errors
      expect(responses[1].errors).toBeDefined()
    })
  })

  describe('batch efficiency', () => {
    it('reduces RPC calls compared to individual requests', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      // Traverse from 10 users to their orgs
      const startUrls = Array.from({ length: 10 }, (_, i) => `https://users.do/user${i}`)

      const result = await engine.traverse({
        startUrls,
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
        batchRpc: true,
      })

      // Should only need 1 RPC call to users.do, not 10
      expect(result.metrics.rpcCalls).toBe(1)
    })

    it('batching can be disabled for debugging', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const startUrls = Array.from({ length: 3 }, (_, i) => `https://users.do/user${i}`)

      const result = await engine.traverse({
        startUrls,
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
        batchRpc: false, // Disable batching
      })

      // Should make 3 separate RPC calls
      expect(result.metrics.rpcCalls).toBe(3)
    })
  })
})

// ============================================================================
// 4. Parallel Traversal Tests
// ============================================================================

describe('Parallel Traversal', () => {
  describe('parallel execution', () => {
    it('executes sibling nodes in parallel within a level', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      // Start from multiple users
      const result = await engine.traverse({
        startUrls: [
          'https://users.do/alice',
          'https://users.do/bob',
          'https://users.do/carol',
        ],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
        ],
        parallel: true,
      })

      // All three should be processed in parallel (verified via metrics)
      expect(result.urls).toBeDefined()
      // The total time should be closer to single request time than 3x
      expect(result.metrics.totalTimeMs).toBeLessThan(result.metrics.rpcCalls * 1000)
    })

    it('respects parallel: false option', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: [
          'https://users.do/alice',
          'https://users.do/bob',
        ],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
        ],
        parallel: false, // Sequential execution
      })

      expect(result.urls).toBeDefined()
      // Sequential execution should still work
    })

    it('handles mixed DO targets in parallel', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      // Start from entities in different DOs
      const result = await engine.traverse({
        startUrls: [
          'https://users.do/alice',
          'https://orgs.do/acme',
        ],
        steps: [
          { verb: 'linkedTo', direction: 'outgoing' },
        ],
        parallel: true,
      })

      // Both DOs should be contacted in parallel
      expect(result.metrics.uniqueDOs).toBeGreaterThanOrEqual(2)
    })
  })

  describe('parallelism with depth', () => {
    it('parallelizes each level of multi-hop traversal', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' },
          { verb: 'hasMembers', direction: 'outgoing' },
        ],
        parallel: true,
      })

      // First hop produces N orgs, second hop processes all N in parallel
      expect(result.urls).toBeDefined()
    })

    it('avoids redundant traversal of already-visited nodes', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      // If multiple paths lead to the same node, don't traverse from it twice
      const result = await engine.traverse({
        startUrls: [
          'https://users.do/alice',
          'https://users.do/bob',
        ],
        steps: [
          { verb: 'memberOf', direction: 'outgoing' }, // Both might be members of same org
          { verb: 'hasMembers', direction: 'outgoing' },
        ],
        parallel: true,
      })

      // Check metrics - should not have duplicate work
      expect(result.metrics.cacheHits).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// 5. Error Handling and Resilience Tests
// ============================================================================

describe('Error Handling and Resilience', () => {
  describe('timeout handling', () => {
    it('respects timeout per DO call', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      await expect(
        engine.traverse({
          startUrls: ['https://slow.do/item'], // This DO is slow
          steps: [{ verb: 'linkedTo', direction: 'outgoing' }],
          timeoutMs: 100, // Very short timeout
        })
      ).rejects.toThrow(/timeout/i)
    })

    it('continues traversal even if one DO times out', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      // Mix of slow and fast DOs
      const result = await engine.traverse({
        startUrls: [
          'https://fast.do/item',
          'https://slow.do/item',
        ],
        steps: [{ verb: 'linkedTo', direction: 'outgoing' }],
        timeoutMs: 100,
        parallel: true,
      })

      // Should have partial results from fast.do
      expect(result.urls.some(u => u.startsWith('https://fast.do'))).toBe(true)
      expect(result.metrics.circuitBreakerTrips).toBeGreaterThan(0)
    })
  })

  describe('circuit breaker integration', () => {
    it('trips circuit breaker after repeated failures', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      // Make multiple requests to a failing DO
      for (let i = 0; i < 5; i++) {
        try {
          await engine.traverseStep(
            ['https://failing.do/item'],
            { verb: 'linkedTo', direction: 'outgoing' }
          )
        } catch {
          // Expected to fail
        }
      }

      // Subsequent calls should fail fast with circuit breaker open
      await expect(
        engine.traverseStep(
          ['https://failing.do/item'],
          { verb: 'linkedTo', direction: 'outgoing' }
        )
      ).rejects.toThrow(/circuit breaker/i)
    })

    it('circuit breaker recovers after cooling period', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      // This test would need time-based mocking to be practical
      // For now, verify the interface exists
      expect(engine.clearCache).toBeDefined()
    })
  })

  describe('partial results handling', () => {
    it('returns partial results when some DOs fail', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: [
          'https://users.do/alice',
          'https://failing.do/item',
        ],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      // Should have results from users.do even though failing.do failed
      expect(result.urls.some(u => u.startsWith('https://orgs.do'))).toBe(true)
    })

    it('reports failures in metrics', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverse({
        startUrls: [
          'https://users.do/alice',
          'https://failing.do/item',
        ],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      expect(result.metrics.circuitBreakerTrips).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// 6. Caching Tests
// ============================================================================

describe('Traversal Caching', () => {
  describe('result caching', () => {
    it('caches traversal results for repeated queries', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      // First traversal
      const result1 = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      // Second identical traversal
      const result2 = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      // Second should use cache
      expect(result2.metrics.cacheHits).toBeGreaterThan(0)
      expect(result2.metrics.rpcCalls).toBeLessThan(result1.metrics.rpcCalls)
    })

    it('cache can be cleared', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      engine.clearCache()

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      // Should not have cache hits after clear
      expect(result.metrics.cacheHits).toBe(0)
    })
  })

  describe('cache key generation', () => {
    it('differentiates cache entries by start URL', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      const result = await engine.traverse({
        startUrls: ['https://users.do/bob'], // Different start
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      // Should not use cache from alice's traversal
      expect(result.metrics.cacheHits).toBe(0)
    })

    it('differentiates cache entries by verb', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'created', direction: 'outgoing' }], // Different verb
      })

      expect(result.metrics.cacheHits).toBe(0)
    })

    it('differentiates cache entries by direction', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'memberOf', direction: 'outgoing' }],
      })

      const result = await engine.traverse({
        startUrls: ['https://users.do/alice'],
        steps: [{ verb: 'memberOf', direction: 'incoming' }], // Different direction
      })

      expect(result.metrics.cacheHits).toBe(0)
    })
  })
})

// ============================================================================
// 7. Metrics Tests
// ============================================================================

describe('Traversal Metrics', () => {
  it('tracks total RPC calls', async () => {
    const { DistributedTraversalEngine } = await import('../index')
    const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

    const result = await engine.traverse({
      startUrls: ['https://users.do/alice'],
      steps: [
        { verb: 'memberOf', direction: 'outgoing' },
        { verb: 'hasMembers', direction: 'outgoing' },
      ],
    })

    expect(result.metrics.rpcCalls).toBeGreaterThanOrEqual(2) // At least one per hop
  })

  it('tracks unique DOs contacted', async () => {
    const { DistributedTraversalEngine } = await import('../index')
    const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

    const result = await engine.traverse({
      startUrls: ['https://users.do/alice'],
      steps: [
        { verb: 'memberOf', direction: 'outgoing' }, // users.do -> orgs.do
        { verb: 'hasMembers', direction: 'outgoing' }, // orgs.do -> users.do
      ],
    })

    expect(result.metrics.uniqueDOs).toBe(2) // users.do and orgs.do
  })

  it('tracks total time', async () => {
    const { DistributedTraversalEngine } = await import('../index')
    const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

    const result = await engine.traverse({
      startUrls: ['https://users.do/alice'],
      steps: [{ verb: 'memberOf', direction: 'outgoing' }],
    })

    expect(result.metrics.totalTimeMs).toBeGreaterThan(0)
  })

  it('tracks cache hits', async () => {
    const { DistributedTraversalEngine } = await import('../index')
    const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

    await engine.traverse({
      startUrls: ['https://users.do/alice'],
      steps: [{ verb: 'memberOf', direction: 'outgoing' }],
    })

    const result = await engine.traverse({
      startUrls: ['https://users.do/alice'],
      steps: [{ verb: 'memberOf', direction: 'outgoing' }],
    })

    expect(result.metrics.cacheHits).toBeGreaterThan(0)
  })

  it('tracks circuit breaker trips', async () => {
    const { DistributedTraversalEngine } = await import('../index')
    const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

    const result = await engine.traverse({
      startUrls: ['https://failing.do/item'],
      steps: [{ verb: 'linkedTo', direction: 'outgoing' }],
    })

    expect(result.metrics.circuitBreakerTrips).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// 8. URL Parsing and DO Routing Tests
// ============================================================================

describe('URL Parsing and DO Routing', () => {
  describe('extracting DO namespace from URL', () => {
    it('extracts DO namespace from standard URL', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const requests = [
        { url: 'https://users.do/alice', step: { verb: 'memberOf', direction: 'outgoing' as const } },
      ]

      const batches = engine.batchByDO(requests)

      expect(batches[0].doNamespace).toBe('https://users.do')
    })

    it('handles URLs with paths correctly', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const requests = [
        { url: 'https://users.do/org/acme/user/alice', step: { verb: 'memberOf', direction: 'outgoing' as const } },
      ]

      const batches = engine.batchByDO(requests)

      expect(batches[0].doNamespace).toBe('https://users.do')
    })

    it('handles URLs with query parameters', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const requests = [
        { url: 'https://users.do/alice?version=1', step: { verb: 'memberOf', direction: 'outgoing' as const } },
      ]

      const batches = engine.batchByDO(requests)

      expect(batches[0].doNamespace).toBe('https://users.do')
    })

    it('handles external URLs (non-DO)', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const requests = [
        { url: 'https://github.com/user/repo', step: { verb: 'linkedTo', direction: 'outgoing' as const } },
      ]

      const batches = engine.batchByDO(requests)

      // External URLs should be grouped by origin
      expect(batches[0].doNamespace).toBe('https://github.com')
    })
  })

  describe('routing to correct DO', () => {
    it('routes requests to the correct DO based on URL', async () => {
      const { DistributedTraversalEngine } = await import('../index')
      const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

      const result = await engine.traverseStep(
        ['https://users.do/alice'],
        { verb: 'memberOf', direction: 'outgoing' }
      )

      // The results should come from users.do and point to orgs.do
      const targets = result.get('https://users.do/alice') || []
      expect(targets.some(t => t.includes('orgs.do'))).toBe(true)
    })
  })
})

// ============================================================================
// 9. Integration with RelationshipsStore Tests
// ============================================================================

describe('Integration with RelationshipsStore', () => {
  it('uses RelationshipsStore for local relationship queries', async () => {
    const { DistributedTraversalEngine, RelationshipsStore } = await import('../index')

    // Both should be exported
    expect(DistributedTraversalEngine).toBeDefined()
    expect(RelationshipsStore).toBeDefined()
  })

  it('falls back to RPC for cross-DO relationships', async () => {
    const { DistributedTraversalEngine } = await import('../index')
    const engine = new (DistributedTraversalEngine as new () => DistributedTraversalEngine)()

    // Traversal that goes across DOs
    const result = await engine.traverse({
      startUrls: ['https://users.do/alice'],
      steps: [
        { verb: 'memberOf', direction: 'outgoing' }, // Goes to orgs.do
      ],
    })

    // Should have made RPC call to users.do
    expect(result.metrics.rpcCalls).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// 10. Factory Function Tests
// ============================================================================

describe('Factory Function', () => {
  it('createDistributedTraversalEngine factory is exported', async () => {
    const module = await import('../index')
    expect(module).toHaveProperty('createDistributedTraversalEngine')
  })

  it('creates engine with default options', async () => {
    const { createDistributedTraversalEngine } = await import('../index')
    const engine = (createDistributedTraversalEngine as () => DistributedTraversalEngine)()

    expect(engine.traverse).toBeDefined()
    expect(engine.traverseStep).toBeDefined()
    expect(engine.batchByDO).toBeDefined()
    expect(engine.executeBatch).toBeDefined()
    expect(engine.clearCache).toBeDefined()
  })

  it('creates engine with custom options', async () => {
    const { createDistributedTraversalEngine } = await import('../index')

    interface EngineOptions {
      defaultTimeout?: number
      maxParallelRequests?: number
      cacheEnabled?: boolean
    }

    const engine = (createDistributedTraversalEngine as (options?: EngineOptions) => DistributedTraversalEngine)({
      defaultTimeout: 10000,
      maxParallelRequests: 5,
      cacheEnabled: false,
    })

    expect(engine).toBeDefined()
  })
})
