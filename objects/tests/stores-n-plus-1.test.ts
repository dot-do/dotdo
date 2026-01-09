/**
 * N+1 Query Prevention Tests for ThingsStore.list()
 *
 * RED PHASE: These tests verify that listing things does NOT make
 * N+1 queries for type name resolution. Currently the implementation
 * makes one query per item to resolve type names, which is inefficient.
 *
 * Expected behavior after fix:
 * - list(100 items) should make at most 2 queries: 1 for things, 1 for types
 * - Type resolution should be batched, not per-item
 * - Performance should remain under 50ms for 100 items
 *
 * Current problematic code in stores.ts lines 603-604:
 * ```
 * for (const row of results as any[]) {
 *   const typeName = await this.getTypeName(row.type)  // N queries!
 * ```
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import the actual store implementation
import { ThingsStore, type StoreContext } from '../stores'
import * as schema from '../../db'

// ============================================================================
// TEST INFRASTRUCTURE: Query Tracking Mock Database
// ============================================================================

interface QueryCall {
  method: 'all' | 'select'
  timestamp: number
  isTypeNameLookup: boolean
}

/**
 * Creates a mock database that tracks all query calls.
 * The key insight: we count how many times db.all() is called,
 * because getTypeName() calls db.all() for each type lookup.
 */
function createMockDatabase() {
  const queryCalls: QueryCall[] = []

  // In-memory storage
  const nouns: Map<number, string> = new Map() // rowid -> noun name
  const nounsByName: Map<string, number> = new Map() // noun name -> rowid
  let nextNounRowid = 1

  const things: Array<{
    rowid: number
    id: string
    type: number
    branch: string | null
    name: string | null
    data: string | null
    deleted: number
  }> = []
  let nextThingRowid = 1

  // Recursively extract the full query string from a Drizzle SQL object
  const extractQueryString = (sqlQuery: any): { queryStr: string; values: any[] } => {
    const parts: string[] = []
    const values: any[] = []

    const processChunks = (chunks: any[]) => {
      for (const chunk of chunks) {
        // Nested SQL object (has its own queryChunks)
        if (chunk?.queryChunks) {
          processChunks(chunk.queryChunks)
        }
        // StringChunk has .value as an array of strings
        else if (chunk?.value && Array.isArray(chunk.value)) {
          parts.push(...chunk.value)
        }
        // Param value (scalar) - can be number, string, etc. directly in chunks
        else if (typeof chunk === 'number') {
          values.push(chunk)
          parts.push('?')
        }
        else if (typeof chunk === 'string') {
          // Could be a string param or a plain string part
          // If it looks like SQL, it's a part; otherwise treat as value
          if (chunk.match(/^(select|from|where|and|or|in|,|\s)+$/i)) {
            parts.push(chunk)
          } else if (chunk === '' || chunk.match(/^\s*$/)) {
            // Empty strings are parts
            parts.push(chunk)
          } else {
            // Non-SQL strings are likely values
            values.push(chunk)
            parts.push('?')
          }
        }
        else if (chunk?.value !== undefined && !Array.isArray(chunk.value)) {
          values.push(chunk.value)
          parts.push('?')
        }
      }
    }

    processChunks(sqlQuery?.queryChunks || [])

    return { queryStr: parts.join('').toLowerCase(), values }
  }

  // Track if this is a type name lookup query (queries nouns table by rowid)
  const isTypeNameQuery = (queryStr: string): boolean => {
    return queryStr.includes('nouns') && queryStr.includes('rowid')
  }

  const mockDb = {
    // Called for raw SQL queries - this is what ThingsStore.list() and getTypeName() use
    all: vi.fn(async (sqlQuery: any) => {
      const { queryStr, values } = extractQueryString(sqlQuery)

      // Determine query type
      const typeNameLookup = isTypeNameQuery(queryStr)

      queryCalls.push({
        method: 'all',
        timestamp: Date.now(),
        isTypeNameLookup: typeNameLookup,
      })

      // Handle batch type name lookup: SELECT rowid, noun FROM nouns WHERE rowid IN (...)
      if (queryStr.includes('nouns') && queryStr.includes('rowid') && queryStr.includes('in')) {
        // Batch query - return all matching rows
        const typeIds = values.filter((v) => typeof v === 'number')
        const results: Array<{ rowid: number; noun: string }> = []
        for (const typeId of typeIds) {
          if (nouns.has(typeId)) {
            results.push({ rowid: typeId, noun: nouns.get(typeId)! })
          }
        }
        return results
      }

      // Handle single type name lookup: SELECT noun FROM nouns WHERE rowid = ?
      if (queryStr.includes('nouns') && queryStr.includes('rowid')) {
        const typeId = values.find((v) => typeof v === 'number')
        if (typeId !== undefined && nouns.has(typeId)) {
          return [{ noun: nouns.get(typeId) }]
        }
        return []
      }

      // Handle type ID lookup: SELECT rowid FROM nouns WHERE noun = ?
      if (queryStr.includes('nouns') && queryStr.includes('noun')) {
        const nounName = values.find((v) => typeof v === 'string')
        if (nounName && nounsByName.has(nounName)) {
          return [{ rowid: nounsByName.get(nounName) }]
        }
        return []
      }

      // Handle things query
      if (queryStr.includes('things')) {
        // Filter to main branch (branch IS NULL) and not deleted
        const filtered = things.filter((t) => t.branch === null && !t.deleted)
        return filtered.map((t) => ({
          ...t,
          version: t.rowid,
        }))
      }

      return []
    }),

    // Called by Drizzle query builder - used for noun lookups via select()
    select: vi.fn(() => ({
      from: vi.fn((table: any) => ({
        where: vi.fn((condition: any) => ({
          limit: vi.fn(async (n: number) => {
            queryCalls.push({
              method: 'select',
              timestamp: Date.now(),
              isTypeNameLookup: false,
            })
            // Return empty for now - the important tracking is in db.all()
            return []
          }),
        })),
        limit: vi.fn(async (n: number) => []),
      })),
    })),

    // Insert for nouns
    insert: vi.fn((table: any) => ({
      values: vi.fn(async (data: any) => {
        if (table === schema.nouns) {
          const rowid = nextNounRowid++
          nouns.set(rowid, data.noun)
          nounsByName.set(data.noun, rowid)
        }
      }),
    })),

    // Internals for test setup
    _test: {
      queryCalls,
      getQueryCount: () => queryCalls.length,
      getTypeNameQueryCount: () => queryCalls.filter((q) => q.isTypeNameLookup).length,
      reset: () => {
        queryCalls.length = 0
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
        branch?: string | null
        deleted?: boolean
      }) => {
        const rowid = nextThingRowid++
        things.push({
          rowid,
          id: data.id,
          type: data.type,
          name: data.name ?? null,
          data: data.data ? JSON.stringify(data.data) : null,
          branch: data.branch ?? null,
          deleted: data.deleted ? 1 : 0,
        })
        return rowid
      },
    },
  }

  return mockDb
}

function createTestContext(db: ReturnType<typeof createMockDatabase>): StoreContext {
  return {
    db: db as any,
    ns: 'test://n-plus-1',
    currentBranch: 'main',
    env: {},
    typeCache: new Map<string, number>(),
  }
}

// ============================================================================
// RED PHASE TESTS
// ============================================================================

describe('ThingsStore N+1 Query Prevention', () => {
  let mockDb: ReturnType<typeof createMockDatabase>
  let ctx: StoreContext
  let store: ThingsStore

  beforeEach(() => {
    mockDb = createMockDatabase()
    ctx = createTestContext(mockDb)
    store = new ThingsStore(ctx)
  })

  afterEach(() => {
    mockDb._test.reset()
  })

  describe('RED: Query Count Verification', () => {
    it('listing 100 things should make at most 2 db.all() calls, not 101', async () => {
      // Setup: Add 5 types and 100 things
      const types = ['Customer', 'Order', 'Product', 'Invoice', 'Payment']
      const typeIds = types.map((t) => mockDb._test.addNoun(t))

      for (let i = 0; i < 100; i++) {
        mockDb._test.addThing({
          id: `thing-${i}`,
          type: typeIds[i % 5],
          name: `Thing ${i}`,
        })
      }

      mockDb._test.reset() // Clear setup queries

      // Act
      const results = await store.list({ limit: 100 })

      // Assert
      const allCalls = mockDb._test.getQueryCount()
      const typeNameCalls = mockDb._test.getTypeNameQueryCount()

      console.log(`Total db.all() calls: ${allCalls}`)
      console.log(`Type name lookup calls: ${typeNameCalls}`)
      console.log(`Results count: ${results.length}`)

      // The problem: Current implementation calls getTypeName() for EACH row
      // Expected: 1 call for list + 1 call for batch type names = 2 total
      // Actual (broken): 1 call for list + 100 calls for type names = 101 total

      // RED TEST: This SHOULD FAIL with current implementation
      expect(allCalls).toBeLessThanOrEqual(2)
      expect(typeNameCalls).toBeLessThanOrEqual(1) // Should be 0 or 1 batch call
    })

    it('type name lookups should be batched, not per-item', async () => {
      // Setup: Create 3 different types
      const customerType = mockDb._test.addNoun('Customer')
      const orderType = mockDb._test.addNoun('Order')
      const productType = mockDb._test.addNoun('Product')

      // Add 30 things with 10 of each type
      for (let i = 0; i < 10; i++) {
        mockDb._test.addThing({ id: `customer-${i}`, type: customerType })
        mockDb._test.addThing({ id: `order-${i}`, type: orderType })
        mockDb._test.addThing({ id: `product-${i}`, type: productType })
      }

      mockDb._test.reset()

      // Act
      await store.list({ limit: 30 })

      // Assert: Type lookup queries should NOT scale with item count
      const typeNameCalls = mockDb._test.getTypeNameQueryCount()

      console.log(`Type name lookup calls for 30 items (3 types): ${typeNameCalls}`)

      // RED TEST: Currently this will be 30 (one per item)
      // After fix: Should be 1 (batch lookup for 3 unique type IDs)
      // or 0 if we use a JOIN instead
      expect(typeNameCalls).toBeLessThanOrEqual(1)
    })

    it('query count should NOT increase with more items of same type', async () => {
      // Setup: Single type, many items
      const taskType = mockDb._test.addNoun('Task')

      // Add 50 tasks
      for (let i = 0; i < 50; i++) {
        mockDb._test.addThing({ id: `task-${i}`, type: taskType, name: `Task ${i}` })
      }

      mockDb._test.reset()

      // Count queries for 10 items
      const results10 = await store.list({ limit: 10 })
      const queriesFor10 = mockDb._test.getQueryCount()
      const typeQueriesFor10 = mockDb._test.getTypeNameQueryCount()

      mockDb._test.reset()

      // Count queries for 50 items
      const results50 = await store.list({ limit: 50 })
      const queriesFor50 = mockDb._test.getQueryCount()
      const typeQueriesFor50 = mockDb._test.getTypeNameQueryCount()

      console.log(`Queries for 10 items: ${queriesFor10} (${typeQueriesFor10} type lookups)`)
      console.log(`Queries for 50 items: ${queriesFor50} (${typeQueriesFor50} type lookups)`)

      // RED TEST: With N+1, type lookups scale linearly with item count
      // After fix: Both should have same number of type lookups (1 or less)
      expect(typeQueriesFor10).toBeLessThanOrEqual(1)
      expect(typeQueriesFor50).toBeLessThanOrEqual(1)
    })
  })

  describe('RED: Unique Type IDs Optimization', () => {
    it('should only lookup each unique type ID once', async () => {
      // Setup: 3 types, 90 things (30 of each type)
      const types = [
        mockDb._test.addNoun('Alpha'),
        mockDb._test.addNoun('Beta'),
        mockDb._test.addNoun('Gamma'),
      ]

      for (let i = 0; i < 30; i++) {
        for (const typeId of types) {
          mockDb._test.addThing({
            id: `${typeId}-${i}`,
            type: typeId,
          })
        }
      }

      mockDb._test.reset()

      // Act
      await store.list({ limit: 90 })

      // Assert
      const typeNameCalls = mockDb._test.getTypeNameQueryCount()

      console.log(`Type name lookups for 90 items with 3 unique types: ${typeNameCalls}`)

      // RED TEST: Currently 90 calls (one per item)
      // After fix: Should be at most 3 (one per unique type)
      // Or 1 if using a single IN() query
      // Or 0 if using a JOIN
      expect(typeNameCalls).toBeLessThanOrEqual(3)
    })

    it('should handle many unique types efficiently', async () => {
      // Setup: 20 types, 100 things
      const types: number[] = []
      for (let i = 0; i < 20; i++) {
        types.push(mockDb._test.addNoun(`Type${i}`))
      }

      for (let i = 0; i < 100; i++) {
        mockDb._test.addThing({
          id: `thing-${i}`,
          type: types[i % 20],
        })
      }

      mockDb._test.reset()

      // Act
      await store.list({ limit: 100 })

      // Assert
      const totalCalls = mockDb._test.getQueryCount()
      const typeNameCalls = mockDb._test.getTypeNameQueryCount()

      console.log(`Total calls for 100 items, 20 types: ${totalCalls}`)
      console.log(`Type name calls: ${typeNameCalls}`)

      // RED TEST: Currently 100 type name lookups
      // After fix: Should be at most 1 (batch) or ~20 (one per unique type)
      expect(totalCalls).toBeLessThanOrEqual(22) // 1 list + 20 unique types + 1 buffer
    })
  })

  describe('RED: Type Cache Effectiveness', () => {
    it('second list call should benefit from populated cache', async () => {
      // Setup
      const type1 = mockDb._test.addNoun('FirstType')
      const type2 = mockDb._test.addNoun('SecondType')

      mockDb._test.addThing({ id: 'item1', type: type1 })
      mockDb._test.addThing({ id: 'item2', type: type2 })
      mockDb._test.addThing({ id: 'item3', type: type1 })
      mockDb._test.addThing({ id: 'item4', type: type2 })

      mockDb._test.reset()

      // First call - populates cache
      await store.list({ limit: 10 })
      const firstCallQueries = mockDb._test.getQueryCount()
      const firstCallTypeQueries = mockDb._test.getTypeNameQueryCount()

      mockDb._test.reset()

      // Second call - should use cache
      await store.list({ limit: 10 })
      const secondCallQueries = mockDb._test.getQueryCount()
      const secondCallTypeQueries = mockDb._test.getTypeNameQueryCount()

      console.log(`First call: ${firstCallQueries} total, ${firstCallTypeQueries} type lookups`)
      console.log(`Second call: ${secondCallQueries} total, ${secondCallTypeQueries} type lookups`)

      // Cache should help on second call
      // RED TEST: With current impl, both calls make same type queries
      // After fix with proper batching + cache: second call should have 0 type lookups
      expect(secondCallTypeQueries).toBe(0)
    })

    it('cache should be populated with bidirectional mapping after batch lookup', async () => {
      // Setup
      const personType = mockDb._test.addNoun('Person')
      const companyType = mockDb._test.addNoun('Company')
      mockDb._test.addThing({ id: 'person1', type: personType })
      mockDb._test.addThing({ id: 'company1', type: companyType })

      // Ensure cache is empty
      expect(ctx.typeCache.size).toBe(0)

      mockDb._test.reset()

      // Act - first list populates cache
      const results1 = await store.list({ limit: 10 })
      const firstCallTypeQueries = mockDb._test.getTypeNameQueryCount()

      // Assert: Cache should now contain the type mappings
      expect(ctx.typeCache.size).toBeGreaterThanOrEqual(2)

      mockDb._test.reset()

      // Act - second list should use cache
      const results2 = await store.list({ limit: 10 })
      const secondCallTypeQueries = mockDb._test.getTypeNameQueryCount()

      console.log(`First call type queries: ${firstCallTypeQueries}`)
      console.log(`Second call type queries: ${secondCallTypeQueries}`)

      // RED TEST: Current impl still makes queries on second call (cache lookup is O(n) per item)
      // After fix: Second call should make 0 type queries (efficient cache hit)
      expect(secondCallTypeQueries).toBe(0)
    })
  })

  describe('RED: Edge Cases', () => {
    it('empty result set should not make type lookups', async () => {
      // No things added
      mockDb._test.reset()

      const results = await store.list({ limit: 10 })

      expect(results).toEqual([])
      // Should only be the main query, no type lookups
      expect(mockDb._test.getTypeNameQueryCount()).toBe(0)
    })

    it('single item should not trigger N+1 pattern', async () => {
      const type1 = mockDb._test.addNoun('SingleType')
      mockDb._test.addThing({ id: 'only-one', type: type1, name: 'Only One' })

      mockDb._test.reset()

      const results = await store.list({ limit: 10 })

      expect(results.length).toBe(1)

      // Even for 1 item, pattern should be consistent
      // Should be 1 list query + at most 1 type lookup
      const totalQueries = mockDb._test.getQueryCount()
      expect(totalQueries).toBeLessThanOrEqual(2)
    })

    it('should handle type not found gracefully', async () => {
      // Add thing with non-existent type
      mockDb._test.addThing({
        id: 'orphan',
        type: 9999, // This type doesn't exist
        name: 'Orphan Thing',
      })

      mockDb._test.reset()

      // Should not throw
      const results = await store.list({ limit: 10 })

      expect(results.length).toBe(1)
      // Type should fallback to something reasonable
      expect(results[0].$type).toBeDefined()
    })
  })

  describe('RED: Performance Benchmarks', () => {
    it('list of 100 items should complete under 50ms', async () => {
      const type1 = mockDb._test.addNoun('FastType')
      for (let i = 0; i < 100; i++) {
        mockDb._test.addThing({ id: `fast-${i}`, type: type1 })
      }

      mockDb._test.reset()

      const start = performance.now()
      await store.list({ limit: 100 })
      const duration = performance.now() - start

      console.log(`list(100) took ${duration.toFixed(2)}ms`)

      // In mocked environment this will pass, but in real env with N+1
      // hitting actual DB, this would be much slower
      expect(duration).toBeLessThan(50)
    })
  })
})
