/**
 * N+1 Query Performance Benchmark Tests
 *
 * RED PHASE: These tests benchmark ThingsStore.list() performance to catch N+1 queries.
 * The documented issue is in stores.ts where type name resolution was making
 * N queries for N items instead of using batch loading.
 *
 * Tests verify:
 * 1. Query count is O(1) not O(n) for type name resolution
 * 2. Performance remains under 50ms for 100 items
 * 3. Query count scales with unique types, not total items
 * 4. Cache effectiveness across multiple list() calls
 *
 * Expected behavior:
 * - list(100 items) should make at most 2-3 queries total (things + batch types)
 * - NOT 101+ queries (things + N type lookups)
 *
 * @see db/stores.ts ThingsStore.list() and batchGetTypeNames()
 * @see objects/tests/stores-n-plus-1.test.ts for unit tests with mocked DB
 * @see db/graph/tests/n-plus-one.test.ts for graph adapter N+1 tests
 * @see do-e2z9 - [RED] N+1 Performance benchmark tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ThingsStore, type StoreContext } from '../../db/stores'

// ============================================================================
// QUERY COUNTING INFRASTRUCTURE
// ============================================================================

interface QueryStats {
  totalQueries: number
  typeNameQueries: number
  batchTypeQueries: number
  thingsQueries: number
  timestamps: number[]
}

/**
 * Creates a mock database that tracks query statistics for performance analysis.
 *
 * Key metrics tracked:
 * - Total queries: All db.all() calls
 * - Type name queries: Individual getTypeName() lookups (SELECT noun FROM nouns WHERE rowid = ?)
 * - Batch type queries: Batched type lookups (SELECT rowid, noun FROM nouns WHERE rowid IN (...))
 * - Things queries: Main list queries (SELECT * FROM things ...)
 */
function createQueryTrackingDatabase() {
  const stats: QueryStats = {
    totalQueries: 0,
    typeNameQueries: 0,
    batchTypeQueries: 0,
    thingsQueries: 0,
    timestamps: [],
  }

  // In-memory storage for nouns and things
  const nouns = new Map<number, string>()
  const nounsByName = new Map<string, number>()
  let nextNounRowid = 1

  const things: Array<{
    rowid: number
    id: string
    type: number
    name: string | null
    data: string | null
    branch: string | null
    deleted: number
  }> = []
  let nextThingRowid = 1

  /**
   * Parse SQL query string from Drizzle SQL object for pattern matching.
   */
  const parseQuery = (sqlObj: any): { sql: string; params: any[] } => {
    const parts: string[] = []
    const params: any[] = []

    const processChunks = (chunks: any[]) => {
      for (const chunk of chunks) {
        if (chunk?.queryChunks) {
          processChunks(chunk.queryChunks)
        } else if (chunk?.value && Array.isArray(chunk.value)) {
          parts.push(...chunk.value)
        } else if (typeof chunk === 'number') {
          params.push(chunk)
          parts.push('?')
        } else if (typeof chunk === 'string') {
          if (chunk === '' || /^\s*$/.test(chunk) || /^(select|from|where|and|or|in|,|join|inner|on|\s)+$/i.test(chunk)) {
            parts.push(chunk)
          } else {
            params.push(chunk)
            parts.push('?')
          }
        } else if (chunk?.value !== undefined && !Array.isArray(chunk.value)) {
          params.push(chunk.value)
          parts.push('?')
        }
      }
    }

    processChunks(sqlObj?.queryChunks || [])
    return { sql: parts.join('').toLowerCase(), params }
  }

  const mockDb = {
    all: vi.fn(async (sqlQuery: any) => {
      const { sql, params } = parseQuery(sqlQuery)
      const timestamp = performance.now()
      stats.timestamps.push(timestamp)
      stats.totalQueries++

      // Categorize query type
      const isNounsQuery = sql.includes('nouns')
      const isThingsQuery = sql.includes('things')
      const isBatchQuery = sql.includes(' in ')

      if (isNounsQuery) {
        if (isBatchQuery) {
          stats.batchTypeQueries++
          // Handle batch type lookup: SELECT rowid, noun FROM nouns WHERE rowid IN (...)
          const typeIds = params.filter((p) => typeof p === 'number')
          return typeIds
            .filter((id) => nouns.has(id))
            .map((id) => ({ rowid: id, noun: nouns.get(id)! }))
        } else if (sql.includes('rowid')) {
          stats.typeNameQueries++
          // Handle single type lookup: SELECT noun FROM nouns WHERE rowid = ?
          const typeId = params.find((p) => typeof p === 'number')
          if (typeId !== undefined && nouns.has(typeId)) {
            return [{ noun: nouns.get(typeId) }]
          }
          return []
        } else if (sql.includes('noun')) {
          // Handle type ID lookup by name: SELECT rowid FROM nouns WHERE noun = ?
          const nounName = params.find((p) => typeof p === 'string')
          if (nounName && nounsByName.has(nounName)) {
            return [{ rowid: nounsByName.get(nounName) }]
          }
          return []
        }
      }

      if (isThingsQuery) {
        stats.thingsQueries++
        // Handle things query - return all non-deleted items from main branch
        return things
          .filter((t) => t.branch === null && !t.deleted)
          .map((t) => ({ ...t, version: t.rowid }))
      }

      return []
    }),

    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
        limit: vi.fn(async () => []),
      })),
    })),

    insert: vi.fn((table: any) => ({
      values: vi.fn(async () => {}),
    })),

    // Test helper methods
    _test: {
      stats,
      resetStats: () => {
        stats.totalQueries = 0
        stats.typeNameQueries = 0
        stats.batchTypeQueries = 0
        stats.thingsQueries = 0
        stats.timestamps = []
      },
      addNoun: (name: string): number => {
        const rowid = nextNounRowid++
        nouns.set(rowid, name)
        nounsByName.set(name, rowid)
        return rowid
      },
      addThing: (data: {
        id: string
        type: number
        name?: string
        data?: Record<string, unknown>
      }) => {
        const rowid = nextThingRowid++
        things.push({
          rowid,
          id: data.id,
          type: data.type,
          name: data.name ?? null,
          data: data.data ? JSON.stringify(data.data) : null,
          branch: null,
          deleted: 0,
        })
        return rowid
      },
    },
  }

  return mockDb
}

function createTestContext(db: ReturnType<typeof createQueryTrackingDatabase>): StoreContext {
  return {
    db: db as any,
    ns: 'test://n-plus-one-perf',
    currentBranch: 'main',
    env: {},
    typeCache: new Map<string, number>(),
  }
}

// ============================================================================
// N+1 QUERY PREVENTION BENCHMARKS
// ============================================================================

describe('N+1 Query Prevention Benchmarks', () => {
  let mockDb: ReturnType<typeof createQueryTrackingDatabase>
  let ctx: StoreContext
  let store: ThingsStore

  beforeEach(() => {
    mockDb = createQueryTrackingDatabase()
    ctx = createTestContext(mockDb)
    store = new ThingsStore(ctx)
  })

  afterEach(() => {
    mockDb._test.resetStats()
  })

  describe('Query Count Verification', () => {
    /**
     * Core N+1 test: listing 100 items should NOT make 100+ queries.
     *
     * Expected (with batching): 2 queries total
     * - 1 query to list things
     * - 1 batch query for type names (IN clause)
     *
     * N+1 pattern (broken): 101 queries
     * - 1 query to list things
     * - 100 queries for type names (one per item)
     */
    it('should list 100 items in O(1) queries, not O(n)', async () => {
      // Setup: 5 types distributed across 100 things
      const types = ['Customer', 'Order', 'Product', 'Invoice', 'Payment']
      const typeIds = types.map((t) => mockDb._test.addNoun(t))

      for (let i = 0; i < 100; i++) {
        mockDb._test.addThing({
          id: `thing-${i}`,
          type: typeIds[i % 5]!,
          name: `Item ${i}`,
        })
      }

      mockDb._test.resetStats()

      // Execute
      const start = performance.now()
      const results = await store.list({ limit: 100 })
      const elapsed = performance.now() - start

      // Verify results
      expect(results.length).toBe(100)

      // Get query stats
      const { totalQueries, typeNameQueries, batchTypeQueries, thingsQueries } = mockDb._test.stats

      console.log('=== Query Count Results ===')
      console.log(`Total queries: ${totalQueries}`)
      console.log(`Things queries: ${thingsQueries}`)
      console.log(`Individual type name queries: ${typeNameQueries}`)
      console.log(`Batch type queries: ${batchTypeQueries}`)
      console.log(`Time elapsed: ${elapsed.toFixed(2)}ms`)

      // RED PHASE ASSERTIONS
      // These should FAIL if N+1 pattern exists (typeNameQueries would be ~100)
      // After fix: totalQueries should be 2-3, typeNameQueries should be 0
      expect(totalQueries).toBeLessThan(5)
      expect(typeNameQueries).toBeLessThanOrEqual(0)
    })

    /**
     * Verify query count scales with unique types, not total items.
     *
     * 90 items with 3 types should have same query count as
     * 10 items with 3 types.
     */
    it('query count should scale with unique types, not item count', async () => {
      // Create 3 types
      const types = ['Alpha', 'Beta', 'Gamma']
      const typeIds = types.map((t) => mockDb._test.addNoun(t))

      // Create 90 things (30 of each type)
      for (let i = 0; i < 90; i++) {
        mockDb._test.addThing({
          id: `thing-${i}`,
          type: typeIds[i % 3]!,
        })
      }

      mockDb._test.resetStats()

      // Execute
      await store.list({ limit: 90 })

      const queriesFor90Items = mockDb._test.stats.totalQueries
      const typeQueriesFor90Items = mockDb._test.stats.typeNameQueries

      console.log('=== Scaling Test Results ===')
      console.log(`Queries for 90 items (3 types): ${queriesFor90Items}`)
      console.log(`Type queries: ${typeQueriesFor90Items}`)

      // RED PHASE: With N+1, typeNameQueries would be ~90
      // After fix: Should be 0 (batch query) or at most 3 (one per unique type)
      expect(typeQueriesFor90Items).toBeLessThanOrEqual(3)
    })

    /**
     * Test with many unique types to verify batch query efficiency.
     */
    it('should handle 20 unique types efficiently', async () => {
      // Create 20 types
      const typeIds: number[] = []
      for (let i = 0; i < 20; i++) {
        typeIds.push(mockDb._test.addNoun(`Type${i}`))
      }

      // Create 100 things distributed across 20 types
      for (let i = 0; i < 100; i++) {
        mockDb._test.addThing({
          id: `thing-${i}`,
          type: typeIds[i % 20]!,
        })
      }

      mockDb._test.resetStats()

      await store.list({ limit: 100 })

      const { totalQueries, typeNameQueries, batchTypeQueries } = mockDb._test.stats

      console.log('=== Many Types Test Results ===')
      console.log(`Total queries: ${totalQueries}`)
      console.log(`Individual type queries: ${typeNameQueries}`)
      console.log(`Batch type queries: ${batchTypeQueries}`)

      // RED PHASE: With N+1, totalQueries would be ~100+
      // After fix: Should be 2 (1 things + 1 batch) regardless of unique type count
      expect(totalQueries).toBeLessThanOrEqual(5)
      expect(typeNameQueries).toBe(0) // Should use batch query instead
    })
  })

  describe('Performance Benchmarks', () => {
    /**
     * Performance threshold: list(100) should complete under 50ms.
     *
     * N+1 pattern can cause timeouts with real database due to
     * sequential round-trip latency for each type lookup.
     */
    it('list of 100 items should complete under 50ms', async () => {
      const typeId = mockDb._test.addNoun('FastType')

      for (let i = 0; i < 100; i++) {
        mockDb._test.addThing({
          id: `fast-${i}`,
          type: typeId,
        })
      }

      mockDb._test.resetStats()

      // Measure execution time
      const iterations = 5
      const times: number[] = []

      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        await store.list({ limit: 100 })
        times.push(performance.now() - start)
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length
      const maxTime = Math.max(...times)
      const minTime = Math.min(...times)

      console.log('=== Performance Results ===')
      console.log(`Average time: ${avgTime.toFixed(2)}ms`)
      console.log(`Min time: ${minTime.toFixed(2)}ms`)
      console.log(`Max time: ${maxTime.toFixed(2)}ms`)

      // In mocked environment, this will pass easily.
      // Real N+1 with actual DB would be much slower.
      expect(avgTime).toBeLessThan(50)
    })

    /**
     * Test performance doesn't degrade linearly with item count.
     *
     * With N+1: 50 items takes ~5x longer than 10 items
     * Without N+1: 50 items takes roughly same time as 10 items (batch)
     */
    it('performance should not degrade linearly with item count', async () => {
      const typeId = mockDb._test.addNoun('LinearTest')

      // Create 100 things
      for (let i = 0; i < 100; i++) {
        mockDb._test.addThing({
          id: `linear-${i}`,
          type: typeId,
        })
      }

      // Measure time for 10 items
      mockDb._test.resetStats()
      const start10 = performance.now()
      await store.list({ limit: 10 })
      const time10 = performance.now() - start10
      const queries10 = mockDb._test.stats.totalQueries

      // Measure time for 50 items
      // Note: Cache is populated from first call, so second call may use fewer queries
      mockDb._test.resetStats()
      const start50 = performance.now()
      await store.list({ limit: 50 })
      const time50 = performance.now() - start50
      const queries50 = mockDb._test.stats.totalQueries

      console.log('=== Linear Scaling Test ===')
      console.log(`10 items: ${time10.toFixed(2)}ms (${queries10} queries)`)
      console.log(`50 items: ${time50.toFixed(2)}ms (${queries50} queries)`)
      console.log(`Time ratio (50/10): ${(time50 / time10).toFixed(2)}x`)
      console.log(`Query ratio (50/10): ${(queries50 / queries10).toFixed(2)}x`)

      // RED PHASE: With N+1, query count scales linearly (10 vs 50 queries)
      // After fix: Query count should be constant or decrease (cache effect)
      // Key insight: 50 items should NOT need 5x more queries than 10 items
      expect(queries50).toBeLessThanOrEqual(queries10)
      // Neither should exceed 3 queries (things + optional batch type)
      expect(queries10).toBeLessThanOrEqual(3)
      expect(queries50).toBeLessThanOrEqual(3)
    })
  })

  describe('Cache Effectiveness', () => {
    /**
     * Second list() call should benefit from type cache.
     *
     * After first call populates cache, second call should
     * make 0 type queries (all cached).
     */
    it('second list call should use cached type names', async () => {
      const types = ['Cached1', 'Cached2', 'Cached3']
      const typeIds = types.map((t) => mockDb._test.addNoun(t))

      for (let i = 0; i < 30; i++) {
        mockDb._test.addThing({
          id: `cached-${i}`,
          type: typeIds[i % 3]!,
        })
      }

      // First call - populates cache
      mockDb._test.resetStats()
      await store.list({ limit: 30 })
      const firstCallQueries = mockDb._test.stats.totalQueries
      const firstCallTypeQueries = mockDb._test.stats.typeNameQueries + mockDb._test.stats.batchTypeQueries

      // Second call - should use cache
      mockDb._test.resetStats()
      await store.list({ limit: 30 })
      const secondCallQueries = mockDb._test.stats.totalQueries
      const secondCallTypeQueries = mockDb._test.stats.typeNameQueries + mockDb._test.stats.batchTypeQueries

      console.log('=== Cache Effectiveness ===')
      console.log(`First call: ${firstCallQueries} total (${firstCallTypeQueries} type queries)`)
      console.log(`Second call: ${secondCallQueries} total (${secondCallTypeQueries} type queries)`)

      // RED PHASE: Cache should be effective
      // Second call should make 0 type queries (all cached)
      expect(secondCallTypeQueries).toBe(0)
      expect(secondCallQueries).toBeLessThan(firstCallQueries)
    })

    /**
     * Cache should be populated with bidirectional mapping.
     *
     * After batch query, both forward (name -> id) and reverse (id -> name)
     * lookups should be cached for O(1) access.
     */
    it('cache should support bidirectional lookup after batch query', async () => {
      const typeIds = [
        mockDb._test.addNoun('Person'),
        mockDb._test.addNoun('Company'),
      ]

      mockDb._test.addThing({ id: 'person1', type: typeIds[0]! })
      mockDb._test.addThing({ id: 'company1', type: typeIds[1]! })

      // Verify cache is empty before list
      expect(ctx.typeCache.size).toBe(0)

      mockDb._test.resetStats()
      await store.list({ limit: 10 })

      // Cache should now have entries (forward mapping: name -> id)
      expect(ctx.typeCache.size).toBeGreaterThanOrEqual(2)

      console.log('=== Bidirectional Cache ===')
      console.log(`Cache entries after list: ${ctx.typeCache.size}`)
      console.log(`Cache contents: ${JSON.stringify(Object.fromEntries(ctx.typeCache))}`)

      // Verify forward lookup works
      expect(ctx.typeCache.get('Person')).toBe(typeIds[0])
      expect(ctx.typeCache.get('Company')).toBe(typeIds[1])
    })
  })

  describe('Edge Cases', () => {
    /**
     * Empty result set should not make type lookup queries.
     */
    it('empty result set should not query types', async () => {
      mockDb._test.resetStats()

      const results = await store.list({ limit: 10 })

      expect(results).toEqual([])
      expect(mockDb._test.stats.typeNameQueries).toBe(0)
      expect(mockDb._test.stats.batchTypeQueries).toBe(0)
    })

    /**
     * Single item should use same pattern (batch or no query if cached).
     */
    it('single item should not trigger N+1 pattern', async () => {
      const typeId = mockDb._test.addNoun('SingleType')
      mockDb._test.addThing({ id: 'only-one', type: typeId })

      mockDb._test.resetStats()

      const results = await store.list({ limit: 10 })

      expect(results.length).toBe(1)
      // Should still be constant query count
      expect(mockDb._test.stats.totalQueries).toBeLessThanOrEqual(2)
    })

    /**
     * Unknown type ID should be handled gracefully.
     */
    it('should handle unknown type ID gracefully', async () => {
      mockDb._test.addThing({
        id: 'orphan',
        type: 9999, // Non-existent type
        name: 'Orphan',
      })

      mockDb._test.resetStats()

      // Should not throw
      const results = await store.list({ limit: 10 })

      expect(results.length).toBe(1)
      // Should fallback to 'Unknown' type
      expect(results[0]!.$type).toBeDefined()
    })
  })

  describe('Comparative Analysis', () => {
    /**
     * Document actual query patterns for analysis.
     *
     * This test doesn't assert, but logs query patterns
     * to help diagnose N+1 issues.
     */
    it('documents query pattern for 100 items with 10 types', async () => {
      const typeIds: number[] = []
      for (let i = 0; i < 10; i++) {
        typeIds.push(mockDb._test.addNoun(`DocType${i}`))
      }

      for (let i = 0; i < 100; i++) {
        mockDb._test.addThing({
          id: `doc-${i}`,
          type: typeIds[i % 10]!,
        })
      }

      mockDb._test.resetStats()
      const start = performance.now()
      const results = await store.list({ limit: 100 })
      const elapsed = performance.now() - start

      const { totalQueries, typeNameQueries, batchTypeQueries, thingsQueries } = mockDb._test.stats

      console.log('=== Query Pattern Documentation ===')
      console.log(`Items: ${results.length}`)
      console.log(`Unique types: 10`)
      console.log(`Total queries: ${totalQueries}`)
      console.log(`  - Things queries: ${thingsQueries}`)
      console.log(`  - Individual type queries (N+1 pattern): ${typeNameQueries}`)
      console.log(`  - Batch type queries (O(1) pattern): ${batchTypeQueries}`)
      console.log(`Time: ${elapsed.toFixed(2)}ms`)
      console.log('')
      console.log('Expected (no N+1): 2 queries (1 things + 1 batch types)')
      console.log('N+1 pattern would show: 101+ queries (1 things + 100 type lookups)')
      console.log(`Actual pattern: ${typeNameQueries > 10 ? 'N+1 DETECTED!' : 'OK - using batch/cache'}`)

      // This documents the pattern - N+1 would show typeNameQueries ~ 100
      expect(typeNameQueries).toBeLessThan(10) // Should be 0 with proper batching
    })
  })
})

// ============================================================================
// TIMING-BASED N+1 DETECTION
// ============================================================================

describe('Timing-Based N+1 Detection', () => {
  let mockDb: ReturnType<typeof createQueryTrackingDatabase>
  let ctx: StoreContext
  let store: ThingsStore

  beforeEach(() => {
    mockDb = createQueryTrackingDatabase()
    ctx = createTestContext(mockDb)
    store = new ThingsStore(ctx)
  })

  /**
   * Analyze query timing patterns to detect sequential vs batch queries.
   *
   * N+1 pattern: queries are spread over time (sequential)
   * Batch pattern: all type queries happen at once
   */
  it('query timing should show batch pattern, not sequential', async () => {
    const typeIds = []
    for (let i = 0; i < 5; i++) {
      typeIds.push(mockDb._test.addNoun(`TimingType${i}`))
    }

    for (let i = 0; i < 50; i++) {
      mockDb._test.addThing({
        id: `timing-${i}`,
        type: typeIds[i % 5]!,
      })
    }

    mockDb._test.resetStats()
    await store.list({ limit: 50 })

    const { timestamps } = mockDb._test.stats

    if (timestamps.length > 1) {
      // Calculate timing gaps between queries
      const gaps: number[] = []
      for (let i = 1; i < timestamps.length; i++) {
        gaps.push(timestamps[i]! - timestamps[i - 1]!)
      }

      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
      const maxGap = Math.max(...gaps)

      console.log('=== Query Timing Analysis ===')
      console.log(`Total queries: ${timestamps.length}`)
      console.log(`Average gap between queries: ${avgGap.toFixed(3)}ms`)
      console.log(`Max gap: ${maxGap.toFixed(3)}ms`)

      // With N+1, there would be many queries with consistent small gaps
      // With batch, there are few queries with larger gaps (waiting for results)
    } else {
      console.log('Only 1 query - efficient batch/cache pattern')
    }

    // RED PHASE: Query count should be minimal
    expect(timestamps.length).toBeLessThan(5)
  })
})
