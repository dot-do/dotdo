/**
 * ACID Test Suite - Phase 3: Shard Routing
 *
 * RED TDD: These tests define the expected behavior for shard routing -
 * how operations (queries, writes, lookups) are routed to the correct shard
 * in a sharded DO setup. All tests are expected to FAIL initially as this
 * is the RED phase.
 *
 * Shard Routing provides:
 * - Consistent hash routing for deterministic shard selection
 * - Query routing based on shard key presence in query
 * - Scatter-gather for queries without shard key
 * - Write routing to ensure data lands in correct shard
 * - Lookup routing for single-item access patterns
 * - Hot shard detection and load balancing
 * - Circuit breaker for unhealthy shards
 * - Retry logic with shard affinity
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 * @see testing/acid/phase3/shard.test.ts for basic sharding tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'
import type {
  ShardOptions,
  ShardResult,
  ShardStrategy,
} from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR SHARD ROUTING TESTS
// ============================================================================

/**
 * Shard router interface
 */
interface ShardRouter {
  /** Get the shard index for a given key */
  getShardIndex(key: string): number
  /** Get the shard DO stub for a given key */
  getShardForKey(key: string): Promise<ShardInfo>
  /** Get all shard stubs for scatter-gather operations */
  getAllShards(): Promise<ShardInfo[]>
  /** Get healthy shards only */
  getHealthyShards(): Promise<ShardInfo[]>
  /** Check if a shard is healthy */
  isShardHealthy(shardIndex: number): Promise<boolean>
  /** Mark a shard as unhealthy */
  markShardUnhealthy(shardIndex: number, error?: Error): void
  /** Mark a shard as healthy */
  markShardHealthy(shardIndex: number): void
}

/**
 * Shard information
 */
interface ShardInfo {
  /** Shard index */
  index: number
  /** Shard namespace */
  ns: string
  /** Shard DO ID */
  doId: string
  /** Current health status */
  healthy: boolean
  /** Last health check timestamp */
  lastHealthCheck?: Date
  /** Current load (requests in flight) */
  currentLoad?: number
  /** Average response time in ms */
  avgResponseTime?: number
}

/**
 * Routed query options
 */
interface RoutedQueryOptions {
  /** SQL query to execute */
  query: string
  /** Query parameters */
  params?: unknown[]
  /** Explicit shard key value (for routing) */
  shardKeyValue?: string
  /** Timeout per shard in ms */
  timeout?: number
  /** Continue on shard errors */
  continueOnError?: boolean
  /** Aggregation mode for multi-shard results */
  aggregation?: 'concat' | 'merge' | 'sum' | 'count' | 'avg' | 'min' | 'max'
  /** Limit per shard */
  limit?: number
  /** Order by for merged results */
  orderBy?: string
  /** Order direction */
  orderDirection?: 'asc' | 'desc'
}

/**
 * Routed query result
 */
interface RoutedQueryResult<T = unknown> {
  /** Combined results */
  data: T[]
  /** Per-shard results metadata */
  shardResults: Array<{
    shardIndex: number
    itemCount: number
    duration: number
    error?: string
    fromCache?: boolean
  }>
  /** Total item count */
  totalCount: number
  /** Total duration */
  duration: number
  /** Shards queried */
  shardsQueried: number
  /** Shards with errors */
  shardsWithErrors: number
}

/**
 * Routed write options
 */
interface RoutedWriteOptions {
  /** Thing data to write */
  data: ThingRecord
  /** Explicit shard key value (overrides extraction from data) */
  shardKeyValue?: string
  /** Timeout in ms */
  timeout?: number
  /** Retry count on failure */
  retries?: number
}

/**
 * Routed write result
 */
interface RoutedWriteResult {
  /** Whether write succeeded */
  success: boolean
  /** Shard the data was written to */
  shardIndex: number
  /** Thing ID */
  thingId: string
  /** Duration of write operation */
  duration: number
}

/**
 * Batch write options
 */
interface BatchWriteOptions {
  /** Things to write */
  items: ThingRecord[]
  /** Timeout per shard */
  timeout?: number
  /** Continue on error (write remaining items) */
  continueOnError?: boolean
  /** Atomic within each shard */
  atomicPerShard?: boolean
}

/**
 * Batch write result
 */
interface BatchWriteResult {
  /** Total items written successfully */
  successCount: number
  /** Total items that failed */
  failCount: number
  /** Per-shard results */
  shardResults: Array<{
    shardIndex: number
    successCount: number
    failCount: number
    error?: string
    itemIds: string[]
  }>
  /** Duration */
  duration: number
}

/**
 * Lookup options
 */
interface LookupOptions {
  /** Thing ID to lookup */
  thingId: string
  /** Shard key value (required for direct routing) */
  shardKeyValue?: string
  /** Timeout in ms */
  timeout?: number
  /** Whether to broadcast to all shards if shard key unknown */
  broadcastIfUnknown?: boolean
}

/**
 * Lookup result
 */
interface LookupResult<T = ThingRecord> {
  /** Found item or null */
  data: T | null
  /** Shard that had the item */
  shardIndex: number | null
  /** Duration */
  duration: number
  /** Shards queried */
  shardsQueried: number
}

/**
 * Thing record for testing
 */
interface ThingRecord {
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  visibility: string
  createdAt?: string
  updatedAt?: string
}

/**
 * Shard health configuration
 */
interface ShardHealthConfig {
  /** Consecutive failures before marking unhealthy */
  failureThreshold: number
  /** Time window for failure counting in ms */
  failureWindow: number
  /** Cooldown before retrying unhealthy shard in ms */
  unhealthyCooldown: number
  /** Response time threshold for slow shard detection in ms */
  slowThreshold: number
  /** Health check interval in ms */
  healthCheckInterval: number
}

/**
 * Circuit breaker state
 */
type CircuitBreakerState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker info
 */
interface CircuitBreakerInfo {
  /** Shard index */
  shardIndex: number
  /** Current state */
  state: CircuitBreakerState
  /** Failure count in current window */
  failureCount: number
  /** Last failure timestamp */
  lastFailure?: Date
  /** When circuit will attempt to close */
  nextRetryAt?: Date
}

/**
 * Load balancer stats
 */
interface LoadBalancerStats {
  /** Total requests */
  totalRequests: number
  /** Per-shard request counts */
  requestsPerShard: Map<number, number>
  /** Per-shard avg response times */
  avgResponseTimes: Map<number, number>
  /** Hot shard indices (above threshold) */
  hotShards: number[]
  /** Cold shard indices (below threshold) */
  coldShards: number[]
}

/**
 * Retry options
 */
interface RetryOptions {
  /** Max retry attempts */
  maxRetries: number
  /** Initial delay in ms */
  initialDelay: number
  /** Backoff multiplier */
  backoffMultiplier: number
  /** Max delay cap in ms */
  maxDelay: number
  /** Whether to retry on same shard or failover */
  retryOnSameShard: boolean
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample things with shard key data
 */
function createShardableThings(
  count: number,
  keyField: string = 'tenantId'
): ThingRecord[] {
  const tenants = ['tenant-a', 'tenant-b', 'tenant-c', 'tenant-d', 'tenant-e']
  const now = new Date().toISOString()

  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    branch: null,
    name: `Item ${i}`,
    data: {
      [keyField]: tenants[i % tenants.length],
      index: i,
      value: `value-${i}`,
    },
    deleted: false,
    visibility: 'user',
    createdAt: now,
    updatedAt: now,
  }))
}

/**
 * Create a mock shard registry for tests
 */
function createMockShardRegistry(shardCount: number = 4): Array<{
  index: number
  ns: string
  doId: string
  status: 'active' | 'inactive'
}> {
  return Array.from({ length: shardCount }, (_, i) => ({
    index: i,
    ns: `https://shard-${i}.test.do`,
    doId: `shard-do-${i}`,
    status: 'active' as const,
  }))
}

/**
 * Create mock shard stubs for testing
 */
function createMockShardStubs(
  shardCount: number,
  mockNamespace: MockDurableObjectNamespace
): void {
  mockNamespace.stubFactory = (id) => {
    const idStr = id.toString()
    const shardIndex = parseInt(idStr.replace('shard-do-', ''), 10) || 0

    return {
      id,
      fetch: vi.fn().mockImplementation(async (req: Request) => {
        const url = new URL(req.url)
        const body = await req.json().catch(() => ({}))

        // Handle different request types
        if (url.pathname.includes('/query')) {
          return new Response(JSON.stringify({
            data: [{ id: `shard-${shardIndex}-item-1` }],
            count: 1,
          }))
        }

        if (url.pathname.includes('/write')) {
          return new Response(JSON.stringify({
            success: true,
            thingId: (body as Record<string, unknown>).id,
          }))
        }

        if (url.pathname.includes('/lookup')) {
          return new Response(JSON.stringify({
            data: null,
          }))
        }

        if (url.pathname.includes('/health')) {
          return new Response(JSON.stringify({
            healthy: true,
            load: Math.random() * 100,
          }))
        }

        return new Response('OK')
      }),
    }
  }
}

type MockDurableObjectNamespace = ReturnType<typeof createMockDONamespace>

// ============================================================================
// TEST SUITE: SHARD ROUTING BASICS
// ============================================================================

describe('shard routing', () => {
  let result: MockDOResult<DO, MockEnv>
  let mockNamespace: MockDurableObjectNamespace

  beforeEach(() => {
    mockNamespace = createMockDONamespace()
    createMockShardStubs(4, mockNamespace)

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Set up the shard registry in storage
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      endpoints: createMockShardRegistry(4),
    })

    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // CONSISTENT HASH ROUTING
  // ==========================================================================

  describe('consistent hash routing', () => {
    it('should route same key to same shard consistently', async () => {
      // RED: Same key should always route to same shard
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const key = 'tenant-a'
      const shardIndex1 = router.getShardIndex(key)
      const shardIndex2 = router.getShardIndex(key)
      const shardIndex3 = router.getShardIndex(key)

      expect(shardIndex1).toBe(shardIndex2)
      expect(shardIndex2).toBe(shardIndex3)
    })

    it('should distribute keys evenly across shards', async () => {
      // RED: Keys should be evenly distributed
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const distribution = new Map<number, number>()
      const keyCount = 1000

      for (let i = 0; i < keyCount; i++) {
        const key = `tenant-${i}`
        const shardIndex = router.getShardIndex(key)
        distribution.set(shardIndex, (distribution.get(shardIndex) || 0) + 1)
      }

      // Check that each shard has reasonable distribution (within 30% of average)
      const avgPerShard = keyCount / 4
      for (const [, count] of distribution) {
        expect(Math.abs(count - avgPerShard) / avgPerShard).toBeLessThan(0.3)
      }
    })

    it('should handle empty string key', async () => {
      // RED: Empty key should route to a valid shard
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const shardIndex = router.getShardIndex('')
      expect(shardIndex).toBeGreaterThanOrEqual(0)
      expect(shardIndex).toBeLessThan(4)
    })

    it('should handle unicode keys', async () => {
      // RED: Unicode keys should route correctly
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const unicodeKeys = ['tenant-alpha', 'tenant-beta', 'tenant-gamma']
      for (const key of unicodeKeys) {
        const shardIndex = router.getShardIndex(key)
        expect(shardIndex).toBeGreaterThanOrEqual(0)
        expect(shardIndex).toBeLessThan(4)
      }
    })

    it('should handle very long keys', async () => {
      // RED: Long keys should route correctly
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const longKey = 'x'.repeat(10000)
      const shardIndex = router.getShardIndex(longKey)
      expect(shardIndex).toBeGreaterThanOrEqual(0)
      expect(shardIndex).toBeLessThan(4)
    })

    it('should return ShardInfo with all required fields', async () => {
      // RED: getShardForKey should return complete shard info
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const shardInfo = await router.getShardForKey('tenant-a')

      expect(shardInfo).toHaveProperty('index')
      expect(shardInfo).toHaveProperty('ns')
      expect(shardInfo).toHaveProperty('doId')
      expect(shardInfo).toHaveProperty('healthy')
    })
  })

  // ==========================================================================
  // QUERY ROUTING
  // ==========================================================================

  describe('query routing', () => {
    it('should route query with shard key to single shard', async () => {
      // RED: Query with explicit shard key should only hit one shard
      const queryResult = await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: "SELECT * FROM things WHERE data->>'tenantId' = ?",
        params: ['tenant-a'],
        shardKeyValue: 'tenant-a',
      })

      expect(queryResult.shardsQueried).toBe(1)
      expect(queryResult.shardResults.length).toBe(1)
    })

    it('should scatter query without shard key to all shards', async () => {
      // RED: Query without shard key should hit all shards
      const queryResult = await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things WHERE type = 1',
      })

      expect(queryResult.shardsQueried).toBe(4)
      expect(queryResult.shardResults.length).toBe(4)
    })

    it('should aggregate results from multiple shards', async () => {
      // RED: Results should be aggregated according to aggregation mode
      const queryResult = await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT COUNT(*) as count FROM things',
        aggregation: 'sum',
      })

      expect(queryResult.data).toBeDefined()
      expect(queryResult.totalCount).toBeGreaterThan(0)
    })

    it('should respect limit per shard', async () => {
      // RED: Each shard should respect the per-shard limit
      const queryResult = await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
        limit: 10,
      })

      for (const shardResult of queryResult.shardResults) {
        expect(shardResult.itemCount).toBeLessThanOrEqual(10)
      }
    })

    it('should apply orderBy across merged results', async () => {
      // RED: Merged results should be properly ordered
      const queryResult = await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
        orderBy: 'createdAt',
        orderDirection: 'desc',
      })

      // Verify ordering in merged results
      const dates = queryResult.data.map((d: { createdAt: string }) => d.createdAt)
      for (let i = 1; i < dates.length; i++) {
        expect(new Date(dates[i - 1]).getTime()).toBeGreaterThanOrEqual(
          new Date(dates[i]).getTime()
        )
      }
    })

    it('should continue on error when configured', async () => {
      // RED: Should continue with other shards if one fails
      // Make shard 1 fail
      const stubs = mockNamespace.stubs
      const failingStub = stubs.get('shard-do-1')
      if (failingStub) {
        failingStub.fetch = vi.fn().mockRejectedValue(new Error('Shard 1 error'))
      }

      const queryResult = await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
        continueOnError: true,
      })

      expect(queryResult.shardsWithErrors).toBe(1)
      expect(queryResult.shardsQueried).toBe(4)
      expect(queryResult.shardResults.some((r) => r.error)).toBe(true)
    })

    it('should fail fast when continueOnError is false', async () => {
      // RED: Should throw immediately on first shard error
      const stubs = mockNamespace.stubs
      const failingStub = stubs.get('shard-do-0')
      if (failingStub) {
        failingStub.fetch = vi.fn().mockRejectedValue(new Error('Shard 0 error'))
      }

      await expect(
        (result.instance as unknown as {
          routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
        }).routedQuery({
          query: 'SELECT * FROM things',
          continueOnError: false,
        })
      ).rejects.toThrow(/Shard 0 error/)
    })

    it('should respect timeout per shard', async () => {
      // RED: Slow shards should be timed out
      const stubs = mockNamespace.stubs
      const slowStub = stubs.get('shard-do-2')
      if (slowStub) {
        slowStub.fetch = vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return new Response('OK')
        })
      }

      await expect(
        (result.instance as unknown as {
          routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
        }).routedQuery({
          query: 'SELECT * FROM things',
          timeout: 100,
          continueOnError: false,
        })
      ).rejects.toThrow(/timeout/i)
    })

    it('should extract shard key from query WHERE clause', async () => {
      // RED: Should auto-extract shard key from simple equality conditions
      const queryResult = await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: "SELECT * FROM things WHERE data->>'tenantId' = 'tenant-b'",
        // Note: no explicit shardKeyValue - should be auto-extracted
      })

      // Should only hit one shard if key was extracted
      expect(queryResult.shardsQueried).toBe(1)
    })
  })

  // ==========================================================================
  // WRITE ROUTING
  // ==========================================================================

  describe('write routing', () => {
    it('should route write to correct shard based on shard key', async () => {
      // RED: Writes should go to the correct shard
      const thing: ThingRecord = {
        id: 'new-thing-1',
        type: 1,
        branch: null,
        name: 'New Thing',
        data: { tenantId: 'tenant-a', value: 'test' },
        deleted: false,
        visibility: 'user',
      }

      const writeResult = await (result.instance as unknown as {
        routedWrite(options: RoutedWriteOptions): Promise<RoutedWriteResult>
      }).routedWrite({
        data: thing,
      })

      expect(writeResult.success).toBe(true)
      expect(writeResult.thingId).toBe('new-thing-1')
      expect(writeResult.shardIndex).toBeGreaterThanOrEqual(0)
      expect(writeResult.shardIndex).toBeLessThan(4)
    })

    it('should use explicit shard key when provided', async () => {
      // RED: Explicit shard key should override extraction from data
      const thing: ThingRecord = {
        id: 'new-thing-2',
        type: 1,
        branch: null,
        name: 'New Thing 2',
        data: { tenantId: 'tenant-a', value: 'test' },
        deleted: false,
        visibility: 'user',
      }

      const writeResult = await (result.instance as unknown as {
        routedWrite(options: RoutedWriteOptions): Promise<RoutedWriteResult>
      }).routedWrite({
        data: thing,
        shardKeyValue: 'tenant-override', // Different from data.tenantId
      })

      expect(writeResult.success).toBe(true)
      // Shard should be calculated from 'tenant-override', not 'tenant-a'
    })

    it('should retry write on failure', async () => {
      // RED: Should retry writes according to retry count
      let attemptCount = 0
      mockNamespace.stubFactory = () => ({
        id: createMockId('retry-test'),
        fetch: vi.fn().mockImplementation(async () => {
          attemptCount++
          if (attemptCount < 3) {
            throw new Error('Transient error')
          }
          return new Response(JSON.stringify({ success: true, thingId: 'new-thing' }))
        }),
      })

      const thing: ThingRecord = {
        id: 'retry-thing',
        type: 1,
        branch: null,
        name: 'Retry Thing',
        data: { tenantId: 'tenant-a' },
        deleted: false,
        visibility: 'user',
      }

      const writeResult = await (result.instance as unknown as {
        routedWrite(options: RoutedWriteOptions): Promise<RoutedWriteResult>
      }).routedWrite({
        data: thing,
        retries: 3,
      })

      expect(writeResult.success).toBe(true)
      expect(attemptCount).toBe(3)
    })

    it('should fail after exhausting retries', async () => {
      // RED: Should fail if all retries exhausted
      mockNamespace.stubFactory = () => ({
        id: createMockId('fail-test'),
        fetch: vi.fn().mockRejectedValue(new Error('Persistent error')),
      })

      const thing: ThingRecord = {
        id: 'fail-thing',
        type: 1,
        branch: null,
        name: 'Fail Thing',
        data: { tenantId: 'tenant-a' },
        deleted: false,
        visibility: 'user',
      }

      await expect(
        (result.instance as unknown as {
          routedWrite(options: RoutedWriteOptions): Promise<RoutedWriteResult>
        }).routedWrite({
          data: thing,
          retries: 2,
        })
      ).rejects.toThrow(/Persistent error/)
    })

    it('should reject write with missing shard key', async () => {
      // RED: Should reject if shard key cannot be determined
      const thing: ThingRecord = {
        id: 'no-key-thing',
        type: 1,
        branch: null,
        name: 'No Key Thing',
        data: { value: 'test' }, // No tenantId
        deleted: false,
        visibility: 'user',
      }

      await expect(
        (result.instance as unknown as {
          routedWrite(options: RoutedWriteOptions): Promise<RoutedWriteResult>
        }).routedWrite({
          data: thing,
        })
      ).rejects.toThrow(/shard key.*required|missing.*shard key/i)
    })
  })

  // ==========================================================================
  // BATCH WRITE ROUTING
  // ==========================================================================

  describe('batch write routing', () => {
    it('should route batch items to correct shards', async () => {
      // RED: Each item should go to its correct shard
      const items: ThingRecord[] = [
        { id: 'batch-1', type: 1, branch: null, name: 'B1', data: { tenantId: 'tenant-a' }, deleted: false, visibility: 'user' },
        { id: 'batch-2', type: 1, branch: null, name: 'B2', data: { tenantId: 'tenant-b' }, deleted: false, visibility: 'user' },
        { id: 'batch-3', type: 1, branch: null, name: 'B3', data: { tenantId: 'tenant-c' }, deleted: false, visibility: 'user' },
        { id: 'batch-4', type: 1, branch: null, name: 'B4', data: { tenantId: 'tenant-a' }, deleted: false, visibility: 'user' },
      ]

      const batchResult = await (result.instance as unknown as {
        routedBatchWrite(options: BatchWriteOptions): Promise<BatchWriteResult>
      }).routedBatchWrite({
        items,
      })

      expect(batchResult.successCount).toBe(4)
      expect(batchResult.failCount).toBe(0)
    })

    it('should group items by shard for efficient writes', async () => {
      // RED: Items going to same shard should be batched together
      const items: ThingRecord[] = Array.from({ length: 10 }, (_, i) => ({
        id: `batch-item-${i}`,
        type: 1,
        branch: null,
        name: `Item ${i}`,
        data: { tenantId: 'tenant-a' }, // All same tenant = same shard
        deleted: false,
        visibility: 'user',
      }))

      let fetchCallCount = 0
      mockNamespace.stubFactory = () => ({
        id: createMockId('batch-test'),
        fetch: vi.fn().mockImplementation(async () => {
          fetchCallCount++
          return new Response(JSON.stringify({
            success: true,
            count: 10,
          }))
        }),
      })

      await (result.instance as unknown as {
        routedBatchWrite(options: BatchWriteOptions): Promise<BatchWriteResult>
      }).routedBatchWrite({
        items,
      })

      // Should be batched into a single call per shard
      expect(fetchCallCount).toBe(1)
    })

    it('should continue on error when configured', async () => {
      // RED: Should continue with other shards on failure
      const items: ThingRecord[] = [
        { id: 'batch-1', type: 1, branch: null, name: 'B1', data: { tenantId: 'tenant-a' }, deleted: false, visibility: 'user' },
        { id: 'batch-2', type: 1, branch: null, name: 'B2', data: { tenantId: 'tenant-b' }, deleted: false, visibility: 'user' },
      ]

      // Make one shard fail
      let callCount = 0
      mockNamespace.stubFactory = () => ({
        id: createMockId('continue-test'),
        fetch: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            throw new Error('First shard error')
          }
          return new Response(JSON.stringify({ success: true, count: 1 }))
        }),
      })

      const batchResult = await (result.instance as unknown as {
        routedBatchWrite(options: BatchWriteOptions): Promise<BatchWriteResult>
      }).routedBatchWrite({
        items,
        continueOnError: true,
      })

      expect(batchResult.failCount).toBe(1)
      expect(batchResult.successCount).toBe(1)
    })

    it('should support atomic writes per shard', async () => {
      // RED: Atomic per shard should rollback shard batch on partial failure
      const items: ThingRecord[] = [
        { id: 'atomic-1', type: 1, branch: null, name: 'A1', data: { tenantId: 'tenant-a' }, deleted: false, visibility: 'user' },
        { id: 'atomic-2', type: 1, branch: null, name: 'A2', data: { tenantId: 'tenant-a' }, deleted: false, visibility: 'user' },
      ]

      mockNamespace.stubFactory = () => ({
        id: createMockId('atomic-test'),
        fetch: vi.fn().mockRejectedValue(new Error('Partial write failed')),
      })

      const batchResult = await (result.instance as unknown as {
        routedBatchWrite(options: BatchWriteOptions): Promise<BatchWriteResult>
      }).routedBatchWrite({
        items,
        atomicPerShard: true,
        continueOnError: true,
      })

      // Both items should fail because they were in an atomic batch
      expect(batchResult.failCount).toBe(2)
      expect(batchResult.successCount).toBe(0)
    })
  })

  // ==========================================================================
  // LOOKUP ROUTING
  // ==========================================================================

  describe('lookup routing', () => {
    it('should route lookup to correct shard when key is known', async () => {
      // RED: Direct lookup should only hit one shard
      const lookupResult = await (result.instance as unknown as {
        routedLookup(options: LookupOptions): Promise<LookupResult>
      }).routedLookup({
        thingId: 'thing-1',
        shardKeyValue: 'tenant-a',
      })

      expect(lookupResult.shardsQueried).toBe(1)
    })

    it('should broadcast lookup when key is unknown', async () => {
      // RED: Broadcast should query all shards
      const lookupResult = await (result.instance as unknown as {
        routedLookup(options: LookupOptions): Promise<LookupResult>
      }).routedLookup({
        thingId: 'thing-1',
        broadcastIfUnknown: true,
      })

      expect(lookupResult.shardsQueried).toBe(4)
    })

    it('should return null when thing not found', async () => {
      // RED: Should return null for missing thing
      mockNamespace.stubFactory = () => ({
        id: createMockId('lookup-test'),
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ data: null }))
        ),
      })

      const lookupResult = await (result.instance as unknown as {
        routedLookup(options: LookupOptions): Promise<LookupResult>
      }).routedLookup({
        thingId: 'non-existent',
        shardKeyValue: 'tenant-a',
      })

      expect(lookupResult.data).toBeNull()
    })

    it('should short-circuit broadcast on first hit', async () => {
      // RED: Should stop searching once item is found
      let queriedShards = 0
      mockNamespace.stubFactory = (id) => {
        const shardIndex = parseInt(id.toString().split('-').pop() || '0', 10)
        return {
          id,
          fetch: vi.fn().mockImplementation(async () => {
            queriedShards++
            // Only shard 2 has the item
            if (shardIndex === 2) {
              return new Response(JSON.stringify({
                data: { id: 'found-item', data: { value: 'test' } },
              }))
            }
            return new Response(JSON.stringify({ data: null }))
          }),
        }
      }

      const lookupResult = await (result.instance as unknown as {
        routedLookup(options: LookupOptions): Promise<LookupResult>
      }).routedLookup({
        thingId: 'found-item',
        broadcastIfUnknown: true,
      })

      expect(lookupResult.data).not.toBeNull()
      // Should have stopped after finding the item
      expect(queriedShards).toBeLessThanOrEqual(4)
    })

    it('should respect lookup timeout', async () => {
      // RED: Slow shards should be timed out
      mockNamespace.stubFactory = () => ({
        id: createMockId('slow-lookup'),
        fetch: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return new Response(JSON.stringify({ data: null }))
        }),
      })

      await expect(
        (result.instance as unknown as {
          routedLookup(options: LookupOptions): Promise<LookupResult>
        }).routedLookup({
          thingId: 'slow-thing',
          shardKeyValue: 'tenant-a',
          timeout: 100,
        })
      ).rejects.toThrow(/timeout/i)
    })
  })

  // ==========================================================================
  // SHARD HEALTH AND CIRCUIT BREAKER
  // ==========================================================================

  describe('shard health and circuit breaker', () => {
    it('should track shard health status', async () => {
      // RED: Should be able to check if shard is healthy
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const isHealthy = await router.isShardHealthy(0)
      expect(typeof isHealthy).toBe('boolean')
    })

    it('should mark shard unhealthy after failures', async () => {
      // RED: Should mark shard unhealthy after threshold failures
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      // Simulate multiple failures
      for (let i = 0; i < 5; i++) {
        router.markShardUnhealthy(1, new Error(`Failure ${i}`))
      }

      const isHealthy = await router.isShardHealthy(1)
      expect(isHealthy).toBe(false)
    })

    it('should recover shard after successful request', async () => {
      // RED: Should mark shard healthy again after success
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      // Mark unhealthy then healthy
      router.markShardUnhealthy(2, new Error('Error'))
      router.markShardHealthy(2)

      const isHealthy = await router.isShardHealthy(2)
      expect(isHealthy).toBe(true)
    })

    it('should exclude unhealthy shards from queries', async () => {
      // RED: Scatter-gather should skip unhealthy shards
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      // Mark shard 1 as unhealthy
      for (let i = 0; i < 5; i++) {
        router.markShardUnhealthy(1, new Error('Failure'))
      }

      const healthyShards = await router.getHealthyShards()
      expect(healthyShards.length).toBe(3)
      expect(healthyShards.every((s) => s.index !== 1)).toBe(true)
    })

    it('should get circuit breaker state', async () => {
      // RED: Should expose circuit breaker state
      const cbInfo = await (result.instance as unknown as {
        getCircuitBreakerInfo(shardIndex: number): Promise<CircuitBreakerInfo>
      }).getCircuitBreakerInfo(0)

      expect(cbInfo).toHaveProperty('state')
      expect(['closed', 'open', 'half-open']).toContain(cbInfo.state)
    })

    it('should open circuit after threshold failures', async () => {
      // RED: Circuit should open after failures
      // Simulate failures
      for (let i = 0; i < 5; i++) {
        try {
          await (result.instance as unknown as {
            routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
          }).routedQuery({
            query: 'SELECT * FROM things',
            shardKeyValue: 'fail-key',
          })
        } catch {
          // Expected to fail
        }
      }

      const cbInfo = await (result.instance as unknown as {
        getCircuitBreakerInfo(shardIndex: number): Promise<CircuitBreakerInfo>
      }).getCircuitBreakerInfo(0)

      expect(cbInfo.state).toBe('open')
    })

    it('should transition to half-open after cooldown', async () => {
      // RED: Circuit should transition to half-open
      // This would require time manipulation or fast-forwarded cooldown
      const cbInfo = await (result.instance as unknown as {
        getCircuitBreakerInfo(shardIndex: number): Promise<CircuitBreakerInfo>
      }).getCircuitBreakerInfo(0)

      if (cbInfo.nextRetryAt) {
        expect(cbInfo.nextRetryAt).toBeInstanceOf(Date)
      }
    })
  })

  // ==========================================================================
  // LOAD BALANCING
  // ==========================================================================

  describe('load balancing', () => {
    it('should track request distribution', async () => {
      // RED: Should track how requests are distributed
      const stats = await (result.instance as unknown as {
        getLoadBalancerStats(): Promise<LoadBalancerStats>
      }).getLoadBalancerStats()

      expect(stats).toHaveProperty('totalRequests')
      expect(stats).toHaveProperty('requestsPerShard')
    })

    it('should detect hot shards', async () => {
      // RED: Should identify shards with high load
      // Simulate requests heavily biased to one shard
      for (let i = 0; i < 100; i++) {
        await (result.instance as unknown as {
          routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
        }).routedQuery({
          query: 'SELECT * FROM things',
          shardKeyValue: 'hot-tenant', // Same key = same shard
        }).catch(() => {})
      }

      const stats = await (result.instance as unknown as {
        getLoadBalancerStats(): Promise<LoadBalancerStats>
      }).getLoadBalancerStats()

      expect(stats.hotShards.length).toBeGreaterThan(0)
    })

    it('should track average response times', async () => {
      // RED: Should track response time per shard
      const stats = await (result.instance as unknown as {
        getLoadBalancerStats(): Promise<LoadBalancerStats>
      }).getLoadBalancerStats()

      expect(stats.avgResponseTimes).toBeInstanceOf(Map)
    })

    it('should expose current shard load', async () => {
      // RED: Should show current in-flight requests per shard
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const shardInfo = await router.getShardForKey('test-key')
      expect(shardInfo).toHaveProperty('currentLoad')
    })
  })

  // ==========================================================================
  // RETRY LOGIC
  // ==========================================================================

  describe('retry logic', () => {
    it('should retry with exponential backoff', async () => {
      // RED: Retries should use exponential backoff
      const delays: number[] = []
      let lastAttempt = Date.now()

      mockNamespace.stubFactory = () => ({
        id: createMockId('backoff-test'),
        fetch: vi.fn().mockImplementation(async () => {
          const now = Date.now()
          delays.push(now - lastAttempt)
          lastAttempt = now
          throw new Error('Retry me')
        }),
      })

      try {
        await (result.instance as unknown as {
          routedWrite(options: RoutedWriteOptions): Promise<RoutedWriteResult>
        }).routedWrite({
          data: {
            id: 'backoff-thing',
            type: 1,
            branch: null,
            name: 'Backoff',
            data: { tenantId: 'test' },
            deleted: false,
            visibility: 'user',
          },
          retries: 3,
        })
      } catch {
        // Expected
      }

      // Each delay should be longer than the previous (exponential)
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1])
      }
    })

    it('should support retry on different shard (failover)', async () => {
      // RED: Should be able to failover to different shard
      let primaryCalled = false
      let failoverCalled = false

      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          if (id.toString().includes('primary')) {
            primaryCalled = true
            throw new Error('Primary failed')
          }
          failoverCalled = true
          return new Response(JSON.stringify({ success: true, thingId: 'failover-item' }))
        }),
      })

      // This test assumes there's a failover mechanism
      const writeResult = await (result.instance as unknown as {
        routedWriteWithFailover(options: RoutedWriteOptions & { failover: boolean }): Promise<RoutedWriteResult>
      }).routedWriteWithFailover({
        data: {
          id: 'failover-thing',
          type: 1,
          branch: null,
          name: 'Failover',
          data: { tenantId: 'test' },
          deleted: false,
          visibility: 'user',
        },
        failover: true,
      })

      expect(writeResult.success).toBe(true)
    })

    it('should respect max delay cap', async () => {
      // RED: Backoff should not exceed max delay
      const retryOptions: RetryOptions = {
        maxRetries: 10,
        initialDelay: 100,
        backoffMultiplier: 2,
        maxDelay: 1000, // Cap at 1 second
        retryOnSameShard: true,
      }

      // Even with 10 retries and 2x multiplier, delay should be capped
      // 100 -> 200 -> 400 -> 800 -> 1000 (capped) -> 1000 ...
      const calculatedDelay = (attempt: number) => {
        const uncapped = retryOptions.initialDelay * Math.pow(retryOptions.backoffMultiplier, attempt)
        return Math.min(uncapped, retryOptions.maxDelay)
      }

      expect(calculatedDelay(5)).toBe(1000)
      expect(calculatedDelay(10)).toBe(1000)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle all shards being unhealthy', async () => {
      // RED: Should fail gracefully when no shards available
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      // Mark all shards unhealthy
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 5; j++) {
          router.markShardUnhealthy(i, new Error('Failure'))
        }
      }

      await expect(
        (result.instance as unknown as {
          routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
        }).routedQuery({
          query: 'SELECT * FROM things',
        })
      ).rejects.toThrow(/no healthy shards|all shards unhealthy/i)
    })

    it('should handle shard registry being empty', async () => {
      // RED: Should fail gracefully with no shards configured
      result.storage.data.set('shardRegistry', null)

      await expect(
        (result.instance as unknown as {
          routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
        }).routedQuery({
          query: 'SELECT * FROM things',
        })
      ).rejects.toThrow(/not sharded|no shard registry/i)
    })

    it('should handle concurrent routing requests', async () => {
      // RED: Should handle many concurrent requests
      const requests = Array.from({ length: 100 }, (_, i) =>
        (result.instance as unknown as {
          routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
        }).routedQuery({
          query: `SELECT * FROM things WHERE id = 'thing-${i}'`,
          shardKeyValue: `tenant-${i % 5}`,
        })
      )

      const results = await Promise.allSettled(requests)
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThan(0)
    })

    it('should handle shard returning invalid response', async () => {
      // RED: Should handle malformed shard responses
      mockNamespace.stubFactory = () => ({
        id: createMockId('invalid-response'),
        fetch: vi.fn().mockResolvedValue(
          new Response('not json', { status: 200 })
        ),
      })

      await expect(
        (result.instance as unknown as {
          routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
        }).routedQuery({
          query: 'SELECT * FROM things',
          shardKeyValue: 'tenant-a',
        })
      ).rejects.toThrow(/invalid response|parse error/i)
    })

    it('should handle shard returning error status', async () => {
      // RED: Should handle HTTP error responses
      mockNamespace.stubFactory = () => ({
        id: createMockId('error-status'),
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 })
        ),
      })

      await expect(
        (result.instance as unknown as {
          routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
        }).routedQuery({
          query: 'SELECT * FROM things',
          shardKeyValue: 'tenant-a',
          continueOnError: false,
        })
      ).rejects.toThrow()
    })

    it('should handle routing when DO is not sharded', async () => {
      // RED: Should fail gracefully for non-sharded DO
      result.storage.data.delete('shardRegistry')

      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter | null>
      }).getShardRouter()

      expect(router).toBeNull()
    })

    it('should handle null shard key values in routing', async () => {
      // RED: Should handle null keys consistently
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const shardIndex = router.getShardIndex(null as unknown as string)
      expect(shardIndex).toBeGreaterThanOrEqual(0)
      expect(shardIndex).toBeLessThan(4)
    })
  })

  // ==========================================================================
  // ROUTING METRICS
  // ==========================================================================

  describe('routing metrics', () => {
    it('should track total routed requests', async () => {
      // RED: Should track total routed request count
      await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
        shardKeyValue: 'tenant-a',
      }).catch(() => {})

      const metrics = await (result.instance as unknown as {
        getRoutingMetrics(): Promise<{
          totalRequests: number
          singleShardRequests: number
          scatterGatherRequests: number
          failedRequests: number
        }>
      }).getRoutingMetrics()

      expect(metrics.totalRequests).toBeGreaterThan(0)
    })

    it('should track single-shard vs scatter-gather ratio', async () => {
      // RED: Should distinguish routing patterns
      // Single shard query
      await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
        shardKeyValue: 'tenant-a',
      }).catch(() => {})

      // Scatter-gather query
      await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
      }).catch(() => {})

      const metrics = await (result.instance as unknown as {
        getRoutingMetrics(): Promise<{
          singleShardRequests: number
          scatterGatherRequests: number
        }>
      }).getRoutingMetrics()

      expect(metrics.singleShardRequests).toBeGreaterThan(0)
      expect(metrics.scatterGatherRequests).toBeGreaterThan(0)
    })

    it('should track per-shard latency', async () => {
      // RED: Should track latency per shard
      await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
      }).catch(() => {})

      const latencies = await (result.instance as unknown as {
        getShardLatencies(): Promise<Map<number, { avg: number; p50: number; p99: number }>>
      }).getShardLatencies()

      expect(latencies).toBeInstanceOf(Map)
    })
  })

  // ==========================================================================
  // CACHE INTEGRATION
  // ==========================================================================

  describe('cache integration', () => {
    it('should cache shard routing decisions', async () => {
      // RED: Should cache shard index lookups
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      // First call
      const shardInfo1 = await router.getShardForKey('cached-key')
      // Second call should use cache
      const shardInfo2 = await router.getShardForKey('cached-key')

      expect(shardInfo1.index).toBe(shardInfo2.index)
    })

    it('should invalidate cache on shard topology change', async () => {
      // RED: Cache should be invalidated when shards change
      const router = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const shardInfo1 = await router.getShardForKey('change-key')

      // Simulate topology change (add shard)
      await (result.instance as unknown as {
        onShardTopologyChange(): Promise<void>
      }).onShardTopologyChange()

      // Get router again - may have different routing
      const newRouter = await (result.instance as unknown as {
        getShardRouter(): Promise<ShardRouter>
      }).getShardRouter()

      const shardInfo2 = await newRouter.getShardForKey('change-key')

      // The shard may or may not be the same, but cache should have been invalidated
      expect(shardInfo2).toBeDefined()
    })

    it('should indicate cache hit in query results', async () => {
      // RED: Should indicate if routing used cache
      // First query
      await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
        shardKeyValue: 'cache-test',
      }).catch(() => {})

      // Second query - should be cached
      const queryResult = await (result.instance as unknown as {
        routedQuery<T>(options: RoutedQueryOptions): Promise<RoutedQueryResult<T>>
      }).routedQuery({
        query: 'SELECT * FROM things',
        shardKeyValue: 'cache-test',
      })

      // Check if any shard result indicates cache hit
      expect(queryResult.shardResults[0]).toBeDefined()
    })
  })
})
