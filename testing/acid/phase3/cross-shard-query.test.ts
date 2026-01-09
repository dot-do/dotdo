/**
 * ACID Test Suite - Phase 3: Cross-Shard Query Tests
 *
 * RED TDD: These tests define the expected behavior for cross-shard query
 * operations. All tests are expected to FAIL initially as this is the RED phase.
 *
 * Cross-shard queries involve:
 * - Scatter-gather pattern: fan-out query to all shards, aggregate results
 * - Deterministic routing: queries with shard key go to single shard
 * - Aggregation strategies: merge, concat, sum, count, avg, min, max
 * - Error handling: partial failures, timeouts, circuit breakers
 * - Consistency: read-your-writes across shards
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'
import type {
  ShardOptions,
  ShardResult,
  ShardStrategy,
  CloneMode,
} from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR CROSS-SHARD QUERY TESTS
// ============================================================================

/**
 * Cross-shard query options
 */
interface CrossShardQueryOptions<T = unknown> {
  /** SQL query to execute on each shard */
  query: string
  /** Query parameters */
  params?: unknown[]
  /** Aggregation strategy for combining results */
  aggregation?: AggregationStrategy
  /** Timeout per shard in milliseconds */
  timeout?: number
  /** Continue on shard error (partial results) */
  continueOnError?: boolean
  /** Correlation ID for tracing */
  correlationId?: string
  /** Custom aggregator function */
  customAggregator?: (results: ShardQueryResult<T>[]) => T[]
  /** Filter function applied after aggregation */
  postFilter?: (item: T) => boolean
  /** Sort specification for final results */
  sort?: SortSpec<T>
  /** Limit on final results */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Specific shards to query (for targeted queries) */
  targetShards?: number[]
  /** Shard key value for single-shard routing */
  shardKeyValue?: string
}

/**
 * Aggregation strategies for cross-shard queries
 */
type AggregationStrategy =
  | 'merge'      // Merge all results into single array
  | 'concat'     // Concatenate results preserving order
  | 'sum'        // Sum numeric values
  | 'count'      // Count total items
  | 'avg'        // Average numeric values
  | 'min'        // Find minimum value
  | 'max'        // Find maximum value
  | 'first'      // Return first result from any shard
  | 'custom'     // Use custom aggregator function

/**
 * Sort specification
 */
interface SortSpec<T> {
  /** Field to sort by */
  field: keyof T | string
  /** Sort direction */
  direction: 'asc' | 'desc'
}

/**
 * Result from querying a single shard
 */
interface ShardQueryResult<T = unknown> {
  /** Shard index */
  shardIndex: number
  /** Shard namespace */
  ns: string
  /** Query results from this shard */
  data: T[]
  /** Number of items returned */
  itemCount: number
  /** Query execution time in ms */
  duration: number
  /** Error if query failed */
  error?: string
  /** Whether query succeeded */
  success: boolean
}

/**
 * Combined result from cross-shard query
 */
interface CrossShardQueryResult<T = unknown> {
  /** Merged/aggregated results */
  data: T[]
  /** Per-shard query results */
  shardResults: ShardQueryResult<T>[]
  /** Total items across all shards */
  totalItems: number
  /** Total query duration (including fan-out) */
  duration: number
  /** Number of shards queried */
  shardsQueried: number
  /** Number of successful shard queries */
  shardsSucceeded: number
  /** Number of failed shard queries */
  shardsFailed: number
  /** Aggregation strategy used */
  aggregation: AggregationStrategy
  /** Whether any shard had errors */
  hasErrors: boolean
  /** Correlation ID for tracing */
  correlationId?: string
}

/**
 * Shard routing result
 */
interface ShardRoutingResult {
  /** Computed shard index */
  shardIndex: number
  /** Shard namespace */
  ns: string
  /** DO ID of the shard */
  doId: string
  /** Hash value used for routing */
  hashValue: number
}

/**
 * Shard health information
 */
interface ShardHealth {
  /** Shard index */
  shardIndex: number
  /** Whether shard is healthy */
  healthy: boolean
  /** Last health check timestamp */
  lastCheck: Date
  /** Response time in ms */
  responseTime?: number
  /** Error if unhealthy */
  error?: string
  /** Circuit breaker state */
  circuitState: 'closed' | 'open' | 'half-open'
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  /** Failure threshold before opening circuit */
  failureThreshold: number
  /** Time in ms before testing half-open */
  resetTimeout: number
  /** Success threshold in half-open before closing */
  successThreshold: number
}

/**
 * Extended shard result with registry and stats
 */
interface ExtendedShardResult extends ShardResult {
  /** Time taken for sharding operation */
  duration: number
  /** Registry entry for the shard set */
  registry: ShardRegistry
  /** Statistics about the distribution */
  stats: ShardDistributionStats
}

/**
 * Shard registry entry
 */
interface ShardRegistry {
  /** Unique ID for this shard set */
  id: string
  /** Shard key field name */
  shardKey: string
  /** Number of shards */
  shardCount: number
  /** Strategy used */
  strategy: ShardStrategy
  /** Creation timestamp */
  createdAt: Date
  /** Array of shard endpoints */
  endpoints: Array<{
    shardIndex: number
    ns: string
    doId: string
    status: 'active' | 'inactive' | 'rebalancing'
  }>
}

/**
 * Distribution statistics
 */
interface ShardDistributionStats {
  /** Total things distributed */
  totalThings: number
  /** Min things in any shard */
  minPerShard: number
  /** Max things in any shard */
  maxPerShard: number
  /** Average things per shard */
  avgPerShard: number
  /** Standard deviation */
  stdDev: number
  /** Skew ratio (max/min) */
  skewRatio: number
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
 * Query execution plan
 */
interface QueryExecutionPlan {
  /** Type of execution */
  type: 'single-shard' | 'scatter-gather' | 'targeted'
  /** Target shard indices */
  targetShards: number[]
  /** Whether query can use shard key optimization */
  optimized: boolean
  /** Estimated cost */
  estimatedCost: number
  /** Explanation of the plan */
  explanation: string
}

/**
 * Query cache entry
 */
interface QueryCacheEntry<T = unknown> {
  /** Cached result */
  result: CrossShardQueryResult<T>
  /** Cache key */
  key: string
  /** When cached */
  cachedAt: Date
  /** TTL in ms */
  ttl: number
  /** Whether cache is valid */
  valid: boolean
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
      value: Math.floor(Math.random() * 1000),
      category: ['electronics', 'books', 'clothing'][i % 3],
    },
    deleted: false,
    visibility: 'user',
    createdAt: now,
    updatedAt: now,
  }))
}

/**
 * Create things with custom tenant distribution
 */
function createThingsWithDistribution(
  distribution: Record<string, number>,
  keyField: string = 'tenantId'
): ThingRecord[] {
  const now = new Date().toISOString()
  const things: ThingRecord[] = []
  let index = 0

  for (const [tenant, count] of Object.entries(distribution)) {
    for (let i = 0; i < count; i++) {
      things.push({
        id: `thing-${index}`,
        type: 1,
        branch: null,
        name: `Item ${index}`,
        data: {
          [keyField]: tenant,
          index,
          value: Math.floor(Math.random() * 1000),
        },
        deleted: false,
        visibility: 'user',
        createdAt: now,
        updatedAt: now,
      })
      index++
    }
  }

  return things
}

/**
 * Create numeric data for aggregation tests
 */
function createNumericThings(count: number): ThingRecord[] {
  const now = new Date().toISOString()

  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    branch: null,
    name: `Item ${i}`,
    data: {
      tenantId: `tenant-${i % 4}`,
      amount: (i + 1) * 10, // 10, 20, 30, ...
      quantity: i + 1,
    },
    deleted: false,
    visibility: 'user',
    createdAt: now,
    updatedAt: now,
  }))
}

// ============================================================================
// TEST SUITE: DETERMINISTIC SHARD ROUTING
// ============================================================================

describe('cross-shard query - deterministic routing', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(async () => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Create shards
    await result.instance.shard({
      key: 'tenantId',
      count: 4,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // CONSISTENT HASH ROUTING
  // ==========================================================================

  describe('consistent hash routing', () => {
    it('should route same key to same shard deterministically', async () => {
      // RED: Same key should always route to same shard
      const key = 'tenant-a'

      const routing1 = await (result.instance as unknown as {
        getShardForKey(key: string): Promise<ShardRoutingResult>
      }).getShardForKey(key)

      const routing2 = await (result.instance as unknown as {
        getShardForKey(key: string): Promise<ShardRoutingResult>
      }).getShardForKey(key)

      expect(routing1.shardIndex).toBe(routing2.shardIndex)
      expect(routing1.ns).toBe(routing2.ns)
    })

    it('should distribute different keys across shards', async () => {
      // RED: Different keys should be distributed
      const keys = ['tenant-a', 'tenant-b', 'tenant-c', 'tenant-d', 'tenant-e']
      const shardIndices = new Set<number>()

      for (const key of keys) {
        const routing = await (result.instance as unknown as {
          getShardForKey(key: string): Promise<ShardRoutingResult>
        }).getShardForKey(key)
        shardIndices.add(routing.shardIndex)
      }

      // With 5 keys and 4 shards, we should have multiple shards used
      expect(shardIndices.size).toBeGreaterThan(1)
    })

    it('should return consistent hash value', async () => {
      // RED: Hash value should be consistent
      const key = 'tenant-a'

      const routing = await (result.instance as unknown as {
        getShardForKey(key: string): Promise<ShardRoutingResult>
      }).getShardForKey(key)

      expect(typeof routing.hashValue).toBe('number')
      expect(routing.shardIndex).toBe(routing.hashValue % 4)
    })

    it('should handle unicode keys correctly', async () => {
      // RED: Unicode should hash consistently
      const unicodeKeys = ['tenant-alpha', 'tenant-beta', 'tenant-gamma']

      for (const key of unicodeKeys) {
        const routing1 = await (result.instance as unknown as {
          getShardForKey(key: string): Promise<ShardRoutingResult>
        }).getShardForKey(key)

        const routing2 = await (result.instance as unknown as {
          getShardForKey(key: string): Promise<ShardRoutingResult>
        }).getShardForKey(key)

        expect(routing1.shardIndex).toBe(routing2.shardIndex)
      }
    })

    it('should handle empty key gracefully', async () => {
      // RED: Empty key should route to a default shard
      const routing = await (result.instance as unknown as {
        getShardForKey(key: string): Promise<ShardRoutingResult>
      }).getShardForKey('')

      expect(routing.shardIndex).toBeDefined()
      expect(routing.shardIndex).toBeGreaterThanOrEqual(0)
      expect(routing.shardIndex).toBeLessThan(4)
    })

    it('should handle null key by routing to shard 0', async () => {
      // RED: Null keys should have defined behavior
      const routing = await (result.instance as unknown as {
        getShardForKey(key: string | null): Promise<ShardRoutingResult>
      }).getShardForKey(null as unknown as string)

      expect(routing.shardIndex).toBe(0) // Default shard
    })
  })

  // ==========================================================================
  // SINGLE-SHARD QUERY OPTIMIZATION
  // ==========================================================================

  describe('single-shard query optimization', () => {
    it('should route query with shard key to single shard', async () => {
      // RED: Query with shard key value should go to one shard
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT * FROM things WHERE data->>'tenantId' = ?",
        params: ['tenant-a'],
        shardKeyValue: 'tenant-a',
      })

      // Should only query one shard
      expect(queryResult.shardsQueried).toBe(1)
      expect(queryResult.shardResults.filter((r) => r.itemCount > 0)).toHaveLength(1)
    })

    it('should return execution plan for optimized query', async () => {
      // RED: Should explain query optimization
      const plan = await (result.instance as unknown as {
        explainQuery(options: CrossShardQueryOptions): Promise<QueryExecutionPlan>
      }).explainQuery({
        query: "SELECT * FROM things WHERE data->>'tenantId' = ?",
        params: ['tenant-a'],
        shardKeyValue: 'tenant-a',
      })

      expect(plan.type).toBe('single-shard')
      expect(plan.optimized).toBe(true)
      expect(plan.targetShards).toHaveLength(1)
    })

    it('should fallback to scatter-gather without shard key', async () => {
      // RED: Query without shard key should hit all shards
      const plan = await (result.instance as unknown as {
        explainQuery(options: CrossShardQueryOptions): Promise<QueryExecutionPlan>
      }).explainQuery({
        query: "SELECT * FROM things WHERE data->>'category' = ?",
        params: ['electronics'],
        // No shardKeyValue provided
      })

      expect(plan.type).toBe('scatter-gather')
      expect(plan.optimized).toBe(false)
      expect(plan.targetShards).toHaveLength(4)
    })

    it('should support targeted query to specific shards', async () => {
      // RED: Should query only specified shards
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        targetShards: [0, 2], // Only shards 0 and 2
      })

      expect(queryResult.shardsQueried).toBe(2)
      expect(queryResult.shardResults.map((r) => r.shardIndex).sort()).toEqual([0, 2])
    })
  })
})

// ============================================================================
// TEST SUITE: SCATTER-GATHER QUERIES
// ============================================================================

describe('cross-shard query - scatter-gather', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(async () => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    await result.instance.shard({
      key: 'tenantId',
      count: 4,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC SCATTER-GATHER
  // ==========================================================================

  describe('basic scatter-gather', () => {
    it('should query all shards and merge results', async () => {
      // RED: Should fan out to all shards
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
      })

      expect(queryResult.shardsQueried).toBe(4)
      expect(queryResult.totalItems).toBe(100)
      expect(queryResult.data).toHaveLength(100)
    })

    it('should include per-shard metadata', async () => {
      // RED: Should track per-shard results
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
      })

      expect(queryResult.shardResults).toHaveLength(4)
      for (const shardResult of queryResult.shardResults) {
        expect(shardResult.shardIndex).toBeDefined()
        expect(shardResult.ns).toBeDefined()
        expect(shardResult.duration).toBeGreaterThanOrEqual(0)
        expect(shardResult.success).toBe(true)
      }
    })

    it('should execute shards in parallel', async () => {
      // RED: Parallel execution should be faster than sequential
      const startTime = Date.now()

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
      })

      const totalDuration = Date.now() - startTime
      const sumOfShardDurations = queryResult.shardResults.reduce(
        (sum, r) => sum + r.duration,
        0
      )

      // Total time should be less than sum of individual times (parallel)
      // Allow some overhead for coordination
      expect(totalDuration).toBeLessThan(sumOfShardDurations * 1.5)
    })

    it('should include correlation ID for tracing', async () => {
      // RED: Should propagate correlation ID
      const correlationId = 'query-123'

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        correlationId,
      })

      expect(queryResult.correlationId).toBe(correlationId)
    })

    it('should generate correlation ID if not provided', async () => {
      // RED: Should auto-generate correlation ID
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
      })

      expect(queryResult.correlationId).toBeDefined()
      expect(queryResult.correlationId!.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // AGGREGATION STRATEGIES
  // ==========================================================================

  describe('aggregation strategies', () => {
    it('should support merge aggregation (default)', async () => {
      // RED: Merge should combine all results
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
      })

      expect(queryResult.aggregation).toBe('merge')
      expect(queryResult.data.length).toBe(queryResult.totalItems)
    })

    it('should support concat aggregation with order', async () => {
      // RED: Concat should preserve shard order
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things ORDER BY id',
        aggregation: 'concat',
      })

      expect(queryResult.aggregation).toBe('concat')
      // Results from shard 0 should come before shard 1, etc.
    })

    it('should support sum aggregation', async () => {
      // RED: Sum should add numeric values
      result.sqlData.set('things', createNumericThings(100))

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT SUM(data->>'amount') as total FROM things",
        aggregation: 'sum',
      })

      expect(queryResult.aggregation).toBe('sum')
      // Sum of 10 + 20 + 30 + ... + 1000 = 50500
      const expectedSum = (100 * 101 / 2) * 10
      expect((queryResult.data[0] as { total: number }).total).toBe(expectedSum)
    })

    it('should support count aggregation', async () => {
      // RED: Count should total items
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT COUNT(*) as count FROM things',
        aggregation: 'count',
      })

      expect(queryResult.aggregation).toBe('count')
      expect((queryResult.data[0] as { count: number }).count).toBe(100)
    })

    it('should support avg aggregation', async () => {
      // RED: Average should compute across all shards
      result.sqlData.set('things', createNumericThings(100))

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT AVG(data->>'amount') as average FROM things",
        aggregation: 'avg',
      })

      expect(queryResult.aggregation).toBe('avg')
      // Average of 10, 20, 30, ..., 1000 = 505
      expect((queryResult.data[0] as { average: number }).average).toBe(505)
    })

    it('should support min aggregation', async () => {
      // RED: Min should find smallest value
      result.sqlData.set('things', createNumericThings(100))

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT MIN(data->>'amount') as minimum FROM things",
        aggregation: 'min',
      })

      expect(queryResult.aggregation).toBe('min')
      expect((queryResult.data[0] as { minimum: number }).minimum).toBe(10)
    })

    it('should support max aggregation', async () => {
      // RED: Max should find largest value
      result.sqlData.set('things', createNumericThings(100))

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT MAX(data->>'amount') as maximum FROM things",
        aggregation: 'max',
      })

      expect(queryResult.aggregation).toBe('max')
      expect((queryResult.data[0] as { maximum: number }).maximum).toBe(1000)
    })

    it('should support first aggregation', async () => {
      // RED: First should return first result from any shard
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things LIMIT 1',
        aggregation: 'first',
      })

      expect(queryResult.aggregation).toBe('first')
      expect(queryResult.data).toHaveLength(1)
    })

    it('should support custom aggregation function', async () => {
      // RED: Custom aggregator should be used
      const customAggregator = (results: ShardQueryResult<ThingRecord>[]) => {
        // Custom: return only items with even index
        return results
          .flatMap((r) => r.data)
          .filter((item) => (item.data.index as number) % 2 === 0)
      }

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'custom',
        customAggregator,
      })

      expect(queryResult.aggregation).toBe('custom')
      expect(queryResult.data.length).toBe(50) // Half of 100
    })
  })

  // ==========================================================================
  // POST-PROCESSING
  // ==========================================================================

  describe('post-processing', () => {
    it('should apply post-filter after aggregation', async () => {
      // RED: Filter should be applied to aggregated results
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards<ThingRecord>({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        postFilter: (item) => item.data.category === 'electronics',
      })

      expect(queryResult.data.every((item) => item.data.category === 'electronics')).toBe(true)
    })

    it('should apply sorting after aggregation', async () => {
      // RED: Results should be sorted
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards<ThingRecord>({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        sort: { field: 'id', direction: 'asc' },
      })

      // Check that results are sorted by id
      for (let i = 1; i < queryResult.data.length; i++) {
        expect(queryResult.data[i].id >= queryResult.data[i - 1].id).toBe(true)
      }
    })

    it('should apply limit after aggregation', async () => {
      // RED: Limit should cap results
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        limit: 10,
      })

      expect(queryResult.data.length).toBe(10)
      expect(queryResult.totalItems).toBe(100) // Total still reflects all items
    })

    it('should apply offset for pagination', async () => {
      // RED: Offset should skip results
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards<ThingRecord>({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        sort: { field: 'id', direction: 'asc' },
        offset: 10,
        limit: 10,
      })

      expect(queryResult.data.length).toBe(10)
      expect(queryResult.data[0].id).toBe('thing-10')
    })

    it('should combine filter, sort, offset, and limit', async () => {
      // RED: All post-processing should work together
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards<ThingRecord>({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        postFilter: (item) => (item.data.index as number) % 2 === 0,
        sort: { field: 'id', direction: 'desc' },
        offset: 5,
        limit: 5,
      })

      expect(queryResult.data.length).toBe(5)
      // Should be 5 items with even indices, sorted desc, starting from offset 5
    })
  })
})

// ============================================================================
// TEST SUITE: ERROR HANDLING
// ============================================================================

describe('cross-shard query - error handling', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(async () => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    await result.instance.shard({
      key: 'tenantId',
      count: 4,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // PARTIAL FAILURES
  // ==========================================================================

  describe('partial failures', () => {
    it('should continue on error when configured', async () => {
      // RED: Should return partial results when continueOnError is true
      // Mock one shard to fail
      const mockNamespace = createMockDONamespace()
      let shardQueryCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          shardQueryCount++
          if (shardQueryCount === 2) {
            throw new Error('Shard unavailable')
          }
          return new Response(JSON.stringify({ data: [], count: 0 }))
        }),
      })
      result.env.DO = mockNamespace

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        continueOnError: true,
      })

      expect(queryResult.hasErrors).toBe(true)
      expect(queryResult.shardsFailed).toBe(1)
      expect(queryResult.shardsSucceeded).toBe(3)
    })

    it('should fail entirely when continueOnError is false', async () => {
      // RED: Should throw when any shard fails
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockRejectedValue(new Error('Shard unavailable')),
      })
      result.env.DO = mockNamespace

      await expect(
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: 'SELECT * FROM things',
          aggregation: 'merge',
          continueOnError: false,
        })
      ).rejects.toThrow(/shard.*unavailable|query.*failed/i)
    })

    it('should include error details in shard results', async () => {
      // RED: Should capture error information
      const mockNamespace = createMockDONamespace()
      let shardQueryCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          shardQueryCount++
          if (shardQueryCount === 2) {
            throw new Error('Connection timeout')
          }
          return new Response(JSON.stringify({ data: [], count: 0 }))
        }),
      })
      result.env.DO = mockNamespace

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        continueOnError: true,
      })

      const failedShard = queryResult.shardResults.find((r) => !r.success)
      expect(failedShard).toBeDefined()
      expect(failedShard?.error).toContain('Connection timeout')
    })
  })

  // ==========================================================================
  // TIMEOUTS
  // ==========================================================================

  describe('timeouts', () => {
    it('should timeout individual shards', async () => {
      // RED: Slow shard should timeout
      const mockNamespace = createMockDONamespace()
      let shardQueryCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          shardQueryCount++
          if (shardQueryCount === 2) {
            // Simulate slow shard
            await new Promise((resolve) => setTimeout(resolve, 5000))
          }
          return new Response(JSON.stringify({ data: [], count: 0 }))
        }),
      })
      result.env.DO = mockNamespace

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        timeout: 100, // 100ms timeout
        continueOnError: true,
      })

      const timedOutShard = queryResult.shardResults.find((r) => !r.success)
      expect(timedOutShard).toBeDefined()
      expect(timedOutShard?.error).toMatch(/timeout/i)
    })

    it('should use default timeout when not specified', async () => {
      // RED: Should have sensible default timeout
      const plan = await (result.instance as unknown as {
        explainQuery(options: CrossShardQueryOptions): Promise<QueryExecutionPlan>
      }).explainQuery({
        query: 'SELECT * FROM things',
      })

      // Default timeout should be documented in the plan
      expect(plan.explanation).toContain('timeout')
    })
  })

  // ==========================================================================
  // CIRCUIT BREAKER
  // ==========================================================================

  describe('circuit breaker', () => {
    it('should track shard health', async () => {
      // RED: Should maintain health status for each shard
      const health = await (result.instance as unknown as {
        getShardHealth(): Promise<ShardHealth[]>
      }).getShardHealth()

      expect(health).toHaveLength(4)
      for (const shardHealth of health) {
        expect(shardHealth.shardIndex).toBeDefined()
        expect(shardHealth.healthy).toBeDefined()
        expect(shardHealth.lastCheck).toBeInstanceOf(Date)
        expect(shardHealth.circuitState).toBeDefined()
      }
    })

    it('should open circuit after repeated failures', async () => {
      // RED: Circuit should open after threshold
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockRejectedValue(new Error('Shard unavailable')),
      })
      result.env.DO = mockNamespace

      // Configure circuit breaker
      await (result.instance as unknown as {
        configureCircuitBreaker(config: CircuitBreakerConfig): Promise<void>
      }).configureCircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 30000,
        successThreshold: 1,
      })

      // Make multiple failing queries
      for (let i = 0; i < 4; i++) {
        try {
          await (result.instance as unknown as {
            queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
          }).queryShards({
            query: 'SELECT * FROM things',
            aggregation: 'merge',
            continueOnError: true,
          })
        } catch {
          // Expected to fail
        }
      }

      const health = await (result.instance as unknown as {
        getShardHealth(): Promise<ShardHealth[]>
      }).getShardHealth()

      const openCircuits = health.filter((h) => h.circuitState === 'open')
      expect(openCircuits.length).toBeGreaterThan(0)
    })

    it('should skip shards with open circuit', async () => {
      // RED: Should not query shards with open circuit
      // First, force a circuit to open
      await (result.instance as unknown as {
        forceCircuitOpen(shardIndex: number): Promise<void>
      }).forceCircuitOpen(1)

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
        continueOnError: true,
      })

      // Shard 1 should not be queried
      expect(queryResult.shardsQueried).toBe(3)
      expect(queryResult.shardResults.find((r) => r.shardIndex === 1)).toBeUndefined()
    })

    it('should transition to half-open after timeout', async () => {
      // RED: Circuit should become half-open after reset timeout
      await (result.instance as unknown as {
        configureCircuitBreaker(config: CircuitBreakerConfig): Promise<void>
      }).configureCircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100, // 100ms
        successThreshold: 1,
      })

      await (result.instance as unknown as {
        forceCircuitOpen(shardIndex: number): Promise<void>
      }).forceCircuitOpen(1)

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150))

      const health = await (result.instance as unknown as {
        getShardHealth(): Promise<ShardHealth[]>
      }).getShardHealth()

      const shard1Health = health.find((h) => h.shardIndex === 1)
      expect(shard1Health?.circuitState).toBe('half-open')
    })

    it('should close circuit on successful query in half-open state', async () => {
      // RED: Successful query should close circuit
      await (result.instance as unknown as {
        configureCircuitBreaker(config: CircuitBreakerConfig): Promise<void>
      }).configureCircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100,
        successThreshold: 1,
      })

      await (result.instance as unknown as {
        forceCircuitOpen(shardIndex: number): Promise<void>
      }).forceCircuitOpen(1)

      // Wait for half-open
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Make successful query
      await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
      })

      const health = await (result.instance as unknown as {
        getShardHealth(): Promise<ShardHealth[]>
      }).getShardHealth()

      const shard1Health = health.find((h) => h.shardIndex === 1)
      expect(shard1Health?.circuitState).toBe('closed')
    })
  })
})

// ============================================================================
// TEST SUITE: CONSISTENCY GUARANTEES
// ============================================================================

describe('cross-shard query - consistency', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(async () => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    await result.instance.shard({
      key: 'tenantId',
      count: 4,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // READ-YOUR-WRITES
  // ==========================================================================

  describe('read-your-writes consistency', () => {
    it('should see writes immediately after writing', async () => {
      // RED: Write then read should see the write
      // Write a new thing
      const newThing = {
        id: 'thing-new',
        type: 1,
        branch: null,
        name: 'New Item',
        data: { tenantId: 'tenant-a', value: 999 },
        deleted: false,
        visibility: 'user',
      }

      await (result.instance as unknown as {
        writeToShard(thing: ThingRecord): Promise<void>
      }).writeToShard(newThing)

      // Immediately query
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards<ThingRecord>({
        query: "SELECT * FROM things WHERE id = 'thing-new'",
        shardKeyValue: 'tenant-a',
      })

      expect(queryResult.data).toHaveLength(1)
      expect(queryResult.data[0].id).toBe('thing-new')
    })

    it('should maintain session affinity for consistency', async () => {
      // RED: Same session should have consistent view
      const sessionId = 'session-123'

      // Start session
      await (result.instance as unknown as {
        startQuerySession(sessionId: string): Promise<void>
      }).startQuerySession(sessionId)

      // Make writes
      const newThing = {
        id: 'thing-session',
        type: 1,
        branch: null,
        name: 'Session Item',
        data: { tenantId: 'tenant-b', value: 888 },
        deleted: false,
        visibility: 'user',
      }

      await (result.instance as unknown as {
        writeToShard(thing: ThingRecord, sessionId?: string): Promise<void>
      }).writeToShard(newThing, sessionId)

      // Query with session
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T> & { sessionId?: string }): Promise<CrossShardQueryResult<T>>
      }).queryShards<ThingRecord>({
        query: "SELECT * FROM things WHERE id = 'thing-session'",
        sessionId,
      })

      expect(queryResult.data).toHaveLength(1)

      // End session
      await (result.instance as unknown as {
        endQuerySession(sessionId: string): Promise<void>
      }).endQuerySession(sessionId)
    })
  })

  // ==========================================================================
  // SNAPSHOT ISOLATION
  // ==========================================================================

  describe('snapshot isolation', () => {
    it('should support point-in-time queries', async () => {
      // RED: Query at specific timestamp
      const snapshotTime = new Date()

      // Make a write after snapshot time
      const newThing = {
        id: 'thing-after-snapshot',
        type: 1,
        branch: null,
        name: 'After Snapshot',
        data: { tenantId: 'tenant-c', value: 777 },
        deleted: false,
        visibility: 'user',
      }

      await (result.instance as unknown as {
        writeToShard(thing: ThingRecord): Promise<void>
      }).writeToShard(newThing)

      // Query at snapshot time
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T> & { snapshotTime?: Date }): Promise<CrossShardQueryResult<T>>
      }).queryShards<ThingRecord>({
        query: "SELECT * FROM things WHERE id = 'thing-after-snapshot'",
        snapshotTime,
      })

      // Should not see the new thing
      expect(queryResult.data).toHaveLength(0)
    })

    it('should maintain consistent snapshot across shards', async () => {
      // RED: All shards should use same snapshot
      const snapshotId = await (result.instance as unknown as {
        createSnapshot(): Promise<string>
      }).createSnapshot()

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T> & { snapshotId?: string }): Promise<CrossShardQueryResult<T>>
      }).queryShards<ThingRecord>({
        query: 'SELECT * FROM things',
        snapshotId,
      })

      // All shards should report same snapshot
      for (const shardResult of queryResult.shardResults) {
        expect((shardResult as unknown as { snapshotId: string }).snapshotId).toBe(snapshotId)
      }
    })
  })
})

// ============================================================================
// TEST SUITE: QUERY CACHING
// ============================================================================

describe('cross-shard query - caching', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(async () => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    await result.instance.shard({
      key: 'tenantId',
      count: 4,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('query cache', () => {
    it('should cache query results', async () => {
      // RED: Second query should hit cache
      const options: CrossShardQueryOptions = {
        query: 'SELECT * FROM things',
        aggregation: 'count',
      }

      // First query
      const result1 = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards(options)

      // Second query (should be cached)
      const result2 = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards(options)

      // Both should have same result
      expect(result1.totalItems).toBe(result2.totalItems)

      // Second should be faster (cached)
      expect(result2.duration).toBeLessThan(result1.duration)
    })

    it('should invalidate cache on writes', async () => {
      // RED: Cache should be invalidated after write
      const options: CrossShardQueryOptions = {
        query: 'SELECT COUNT(*) FROM things',
        aggregation: 'count',
      }

      // First query
      const result1 = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards(options)

      // Write to a shard
      const newThing = {
        id: 'thing-new-cache',
        type: 1,
        branch: null,
        name: 'New Cache Item',
        data: { tenantId: 'tenant-a', value: 123 },
        deleted: false,
        visibility: 'user',
      }

      await (result.instance as unknown as {
        writeToShard(thing: ThingRecord): Promise<void>
      }).writeToShard(newThing)

      // Query again (cache should be invalidated)
      const result2 = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards(options)

      expect(result2.totalItems).toBe(result1.totalItems + 1)
    })

    it('should respect cache TTL', async () => {
      // RED: Cache should expire after TTL
      await (result.instance as unknown as {
        configureCacheTTL(ttlMs: number): Promise<void>
      }).configureCacheTTL(100) // 100ms TTL

      const options: CrossShardQueryOptions = {
        query: 'SELECT * FROM things',
        aggregation: 'count',
      }

      // First query
      await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards(options)

      // Wait for TTL
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Check cache status
      const cacheEntry = await (result.instance as unknown as {
        getCacheEntry(query: string): Promise<QueryCacheEntry | null>
      }).getCacheEntry('SELECT * FROM things')

      expect(cacheEntry?.valid).toBe(false)
    })

    it('should support cache bypass', async () => {
      // RED: Should be able to bypass cache
      const options: CrossShardQueryOptions = {
        query: 'SELECT * FROM things',
        aggregation: 'count',
      }

      // First query
      await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards(options)

      // Bypass cache
      const result2 = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T> & { bypassCache?: boolean }): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        ...options,
        bypassCache: true,
      })

      // Should hit all shards (not cache)
      expect(result2.shardsQueried).toBe(4)
    })
  })
})

// ============================================================================
// TEST SUITE: QUERY VALIDATION
// ============================================================================

describe('cross-shard query - validation', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(async () => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    await result.instance.shard({
      key: 'tenantId',
      count: 4,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('query validation', () => {
    it('should reject empty queries', async () => {
      // RED: Empty query should be rejected
      await expect(
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: '',
          aggregation: 'merge',
        })
      ).rejects.toThrow(/query.*required|empty.*query/i)
    })

    it('should reject invalid SQL', async () => {
      // RED: Invalid SQL should be rejected
      await expect(
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: 'INVALID SQL SYNTAX HERE',
          aggregation: 'merge',
        })
      ).rejects.toThrow(/syntax|invalid.*query/i)
    })

    it('should reject mutations in query', async () => {
      // RED: Write queries should be rejected
      await expect(
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: 'DELETE FROM things',
          aggregation: 'merge',
        })
      ).rejects.toThrow(/mutation|write.*not.*allowed|read.*only/i)

      await expect(
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: 'UPDATE things SET name = ?',
          params: ['test'],
          aggregation: 'merge',
        })
      ).rejects.toThrow(/mutation|write.*not.*allowed|read.*only/i)
    })

    it('should reject invalid aggregation strategy', async () => {
      // RED: Invalid aggregation should be rejected
      await expect(
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: 'SELECT * FROM things',
          aggregation: 'invalid' as AggregationStrategy,
        })
      ).rejects.toThrow(/invalid.*aggregation/i)
    })

    it('should reject invalid shard indices', async () => {
      // RED: Invalid target shards should be rejected
      await expect(
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: 'SELECT * FROM things',
          aggregation: 'merge',
          targetShards: [0, 99], // Shard 99 doesn't exist
        })
      ).rejects.toThrow(/invalid.*shard|shard.*not.*found/i)
    })

    it('should reject negative timeout', async () => {
      // RED: Negative timeout should be rejected
      await expect(
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: 'SELECT * FROM things',
          aggregation: 'merge',
          timeout: -100,
        })
      ).rejects.toThrow(/timeout.*positive|invalid.*timeout/i)
    })
  })
})

// ============================================================================
// TEST SUITE: EDGE CASES
// ============================================================================

describe('cross-shard query - edge cases', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(async () => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    await result.instance.shard({
      key: 'tenantId',
      count: 4,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('edge cases', () => {
    it('should handle empty result set', async () => {
      // RED: Empty results should return empty array
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT * FROM things WHERE id = 'nonexistent'",
        aggregation: 'merge',
      })

      expect(queryResult.data).toHaveLength(0)
      expect(queryResult.totalItems).toBe(0)
      expect(queryResult.hasErrors).toBe(false)
    })

    it('should handle large result sets', async () => {
      // RED: Large results should be handled efficiently
      result.sqlData.set('things', createShardableThings(10000))

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
      })

      expect(queryResult.totalItems).toBe(10000)
    })

    it('should handle all shards empty', async () => {
      // RED: All empty shards should return empty result
      result.sqlData.set('things', [])

      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT * FROM things',
        aggregation: 'merge',
      })

      expect(queryResult.data).toHaveLength(0)
      expect(queryResult.shardsQueried).toBe(4)
    })

    it('should handle query with no matching shard key', async () => {
      // RED: Non-existent key should route correctly
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT * FROM things WHERE data->>'tenantId' = 'nonexistent-tenant'",
        shardKeyValue: 'nonexistent-tenant',
      })

      // Should still route to a shard (deterministic)
      expect(queryResult.shardsQueried).toBe(1)
      expect(queryResult.data).toHaveLength(0)
    })

    it('should handle concurrent queries', async () => {
      // RED: Concurrent queries should work correctly
      const queries = Array.from({ length: 10 }, (_, i) =>
        (result.instance as unknown as {
          queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
        }).queryShards({
          query: 'SELECT * FROM things',
          aggregation: 'count',
          correlationId: `concurrent-${i}`,
        })
      )

      const results = await Promise.all(queries)

      // All should succeed
      expect(results.every((r) => r.totalItems === 100)).toBe(true)

      // Each should have unique correlation ID
      const correlationIds = results.map((r) => r.correlationId)
      expect(new Set(correlationIds).size).toBe(10)
    })

    it('should handle special characters in query parameters', async () => {
      // RED: Special characters should be escaped
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT * FROM things WHERE name = ?",
        params: ["O'Brien's \"Special\" Item"],
        aggregation: 'merge',
      })

      // Should not throw and should return empty (no match expected)
      expect(queryResult).toBeDefined()
    })

    it('should handle unicode in query parameters', async () => {
      // RED: Unicode should be handled correctly
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions<T>): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT * FROM things WHERE name = ?",
        params: ['special item'],
        aggregation: 'merge',
      })

      expect(queryResult).toBeDefined()
    })
  })
})
