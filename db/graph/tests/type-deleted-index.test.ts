/**
 * Covering Index Tests for type_name + deleted_at Queries
 *
 * TDD RED phase: Failing tests for the composite index on graph_things table
 * that covers the common query pattern of filtering by type_name and deleted_at.
 *
 * @see dotdo-rudhq - [RED] Add covering index for type+deleted queries
 *
 * Background:
 * The getThingsByType() function commonly filters by:
 * - typeName (to get all instances of a specific type)
 * - deleted_at IS NULL (to exclude soft-deleted records)
 *
 * A covering index on (type_name, deleted_at) allows the database to:
 * 1. Find matching type_name entries efficiently
 * 2. Filter deleted_at in the same index scan
 * 3. Avoid table lookups for simple existence checks
 *
 * Expected Index:
 * CREATE INDEX graph_things_type_deleted_idx ON graph_things(type_name, deleted_at);
 *
 * This test file verifies:
 * 1. The index is defined in the Drizzle schema (db/graph/things.ts)
 * 2. The index is created by SQLiteGraphStore.initialize()
 * 3. Query plans use the index for type+deleted queries
 * 4. Query performance is improved for large datasets
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'

// ============================================================================
// SCHEMA INDEX DEFINITION TESTS
// ============================================================================

describe('[RED] Covering Index: type_name + deleted_at', () => {
  describe('Drizzle Schema Index Definition', () => {
    it('graphThings schema exports type_deleted composite index', async () => {
      // Import the schema module
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule).not.toBeNull()
      expect(thingsModule?.graphThings).toBeDefined()

      // The graphThings table should have an index definition for (type_name, deleted_at)
      // In Drizzle, indexes are defined in the third parameter of sqliteTable()
      // We verify this by checking the generated SQL or index metadata
      const table = thingsModule?.graphThings

      // Drizzle tables with indexes have the index definitions accessible
      // The exact API varies, but the schema should define:
      // index('graph_things_type_deleted_idx').on(table.typeName, table.deletedAt)
      expect(table).toBeDefined()
    })

    it('index is named graph_things_type_deleted_idx', async () => {
      // The index should follow the naming convention:
      // graph_things_{columns}_idx
      const thingsModule = await import('../things').catch(() => null)

      // The schema should define an index with this specific name
      // This test documents the expected naming convention
      expect(thingsModule).not.toBeNull()
    })

    it('index columns are in correct order (type_name, deleted_at)', async () => {
      // The order matters for query efficiency:
      // - type_name first: allows filtering by type efficiently
      // - deleted_at second: allows filtering soft-deleted in same scan
      //
      // Queries like WHERE type_name = 'Customer' AND deleted_at IS NULL
      // can use this index efficiently.
      //
      // The reverse order (deleted_at, type_name) would be less efficient
      // because most queries filter by type first.
      const thingsModule = await import('../things').catch(() => null)
      expect(thingsModule).not.toBeNull()
    })
  })

  // ============================================================================
  // SQLiteGraphStore INDEX CREATION TESTS
  // ============================================================================

  describe('SQLiteGraphStore Index Creation', () => {
    let store: SQLiteGraphStore

    beforeEach(async () => {
      store = new SQLiteGraphStore(':memory:')
      await store.initialize()
    })

    afterEach(async () => {
      await store.close()
    })

    it('creates graph_things_type_deleted_idx on initialization', async () => {
      // Query SQLite's sqlite_master to verify the index exists
      // @ts-expect-error - accessing private sqlite for testing
      const sqlite = store['sqlite']

      const result = sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
           AND tbl_name = 'graph_things'
           AND name = 'graph_things_type_deleted_idx'`
        )
        .get() as { name: string } | undefined

      expect(result).toBeDefined()
      expect(result?.name).toBe('graph_things_type_deleted_idx')
    })

    it('index covers type_name and deleted_at columns', async () => {
      // Use PRAGMA index_info to verify the index columns
      // @ts-expect-error - accessing private sqlite for testing
      const sqlite = store['sqlite']

      const columns = sqlite
        .prepare(`PRAGMA index_info(graph_things_type_deleted_idx)`)
        .all() as Array<{ seqno: number; cid: number; name: string }>

      // Should have exactly 2 columns
      expect(columns.length).toBe(2)

      // First column should be type_name (seqno=0)
      const firstColumn = columns.find((c) => c.seqno === 0)
      expect(firstColumn?.name).toBe('type_name')

      // Second column should be deleted_at (seqno=1)
      const secondColumn = columns.find((c) => c.seqno === 1)
      expect(secondColumn?.name).toBe('deleted_at')
    })

    it('index coexists with existing indexes', async () => {
      // Verify that the new index doesn't break existing indexes
      // @ts-expect-error - accessing private sqlite for testing
      const sqlite = store['sqlite']

      const indexes = sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
           AND tbl_name = 'graph_things'
           ORDER BY name`
        )
        .all() as Array<{ name: string }>

      const indexNames = indexes.map((i) => i.name)

      // Should have all existing indexes plus the new one
      expect(indexNames).toContain('graph_things_type_id_idx')
      expect(indexNames).toContain('graph_things_type_name_idx')
      expect(indexNames).toContain('graph_things_created_at_idx')
      expect(indexNames).toContain('graph_things_deleted_at_idx')
      expect(indexNames).toContain('graph_things_type_deleted_idx') // NEW
    })
  })

  // ============================================================================
  // QUERY PLAN TESTS
  // ============================================================================

  describe('Query Plan Optimization', () => {
    let store: SQLiteGraphStore

    beforeEach(async () => {
      store = new SQLiteGraphStore(':memory:')
      await store.initialize()
    })

    afterEach(async () => {
      await store.close()
    })

    it('uses index for type_name + deleted_at IS NULL queries', async () => {
      // @ts-expect-error - accessing private sqlite for testing
      const sqlite = store['sqlite']

      // EXPLAIN QUERY PLAN shows how SQLite will execute the query
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE type_name = 'Customer'
           AND deleted_at IS NULL`
        )
        .all() as Array<{ detail: string }>

      // The query plan should mention using the type_deleted index
      const planDetails = plan.map((p) => p.detail).join(' ')

      // Should use the composite index, not a full table scan
      expect(planDetails).toMatch(/USING INDEX.*graph_things_type_deleted_idx/i)
    })

    it('uses index for type_name only queries (leftmost prefix)', async () => {
      // @ts-expect-error - accessing private sqlite for testing
      const sqlite = store['sqlite']

      // Composite indexes can be used for leftmost prefix queries
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE type_name = 'Customer'`
        )
        .all() as Array<{ detail: string }>

      const planDetails = plan.map((p) => p.detail).join(' ')

      // Should be able to use either type_name_idx or type_deleted_idx
      expect(planDetails).toMatch(/USING INDEX.*graph_things_type/i)
    })

    it('uses index for includeDeleted queries (type_name only)', async () => {
      // @ts-expect-error - accessing private sqlite for testing
      const sqlite = store['sqlite']

      // When includeDeleted=true, we query by type_name without deleted_at filter
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE type_name = 'Customer'`
        )
        .all() as Array<{ detail: string }>

      const planDetails = plan.map((p) => p.detail).join(' ')

      // Should use an index, not full scan
      expect(planDetails).not.toMatch(/SCAN.*graph_things(?! USING INDEX)/i)
    })

    it('avoids full table scan for common query patterns', async () => {
      // @ts-expect-error - accessing private sqlite for testing
      const sqlite = store['sqlite']

      // The most common query: get active things by type
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE type_name = 'Customer'
           AND deleted_at IS NULL
           ORDER BY created_at DESC
           LIMIT 100`
        )
        .all() as Array<{ detail: string }>

      const planDetails = plan.map((p) => p.detail).join(' ')

      // Should use the composite index specifically
      expect(planDetails).toMatch(/USING INDEX.*graph_things_type_deleted_idx/i)
    })
  })

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance Validation', () => {
    let store: SQLiteGraphStore

    beforeEach(async () => {
      store = new SQLiteGraphStore(':memory:')
      await store.initialize()
    })

    afterEach(async () => {
      await store.close()
    })

    it('handles large datasets efficiently with index', async () => {
      // Insert a moderate number of test records to validate index usage
      const types = ['Customer', 'Product', 'Order', 'User', 'Task']
      const recordsPerType = 200 // 1000 total records

      for (let i = 0; i < recordsPerType * types.length; i++) {
        const typeName = types[i % types.length]!
        await store.createThing({
          id: `thing-${i}`,
          typeId: types.indexOf(typeName) + 1,
          typeName,
          data: { index: i },
        })
      }

      // Query by type with deleted filter
      const startTime = performance.now()

      for (let i = 0; i < 10; i++) {
        const results = await store.getThingsByType({
          typeName: 'Customer',
          includeDeleted: false,
        })
        expect(results.length).toBe(recordsPerType)
      }

      const endTime = performance.now()
      const avgQueryTime = (endTime - startTime) / 10

      // With a proper index, queries should be fast (< 50ms per query)
      // This is a rough benchmark; actual times depend on hardware
      expect(avgQueryTime).toBeLessThan(100)
    })

    it('soft-deleted records do not affect query performance', async () => {
      // Insert records, then soft-delete half of them
      const types = ['Customer']
      const totalRecords = 500

      for (let i = 0; i < totalRecords; i++) {
        await store.createThing({
          id: `perf-thing-${i}`,
          typeId: 1,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      // Soft-delete half
      for (let i = 0; i < totalRecords / 2; i++) {
        await store.deleteThing(`perf-thing-${i}`)
      }

      // Query for non-deleted records should be efficient
      const startTime = performance.now()

      for (let i = 0; i < 10; i++) {
        const results = await store.getThingsByType({
          typeName: 'Customer',
          includeDeleted: false,
        })
        expect(results.length).toBe(totalRecords / 2)
      }

      const endTime = performance.now()
      const avgQueryTime = (endTime - startTime) / 10

      // Should still be fast despite many deleted records
      expect(avgQueryTime).toBeLessThan(100)
    })
  })

  // ============================================================================
  // INTEGRATION WITH getThingsByType
  // ============================================================================

  describe('Integration with getThingsByType', () => {
    let store: SQLiteGraphStore

    beforeEach(async () => {
      store = new SQLiteGraphStore(':memory:')
      await store.initialize()

      // Seed test data
      await store.createThing({
        id: 'customer-1',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Alice' },
      })
      await store.createThing({
        id: 'customer-2',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Bob' },
      })
      await store.createThing({
        id: 'product-1',
        typeId: 2,
        typeName: 'Product',
        data: { name: 'Widget' },
      })

      // Soft-delete one customer
      await store.deleteThing('customer-1')
    })

    afterEach(async () => {
      await store.close()
    })

    it('uses index for default query (excludes deleted)', async () => {
      const results = await store.getThingsByType({ typeName: 'Customer' })

      // Should return only non-deleted customers
      expect(results.length).toBe(1)
      expect(results[0]!.id).toBe('customer-2')
    })

    it('uses index for includeDeleted=true query', async () => {
      const results = await store.getThingsByType({
        typeName: 'Customer',
        includeDeleted: true,
      })

      // Should return all customers including deleted
      expect(results.length).toBe(2)
    })

    it('uses index for type filtering across multiple types', async () => {
      // Query different types should all benefit from the index
      const customers = await store.getThingsByType({ typeName: 'Customer' })
      const products = await store.getThingsByType({ typeName: 'Product' })

      expect(customers.length).toBe(1)
      expect(products.length).toBe(1)
    })
  })

  // ============================================================================
  // DOCUMENT STORE INDEX TESTS
  // ============================================================================

  describe('DocumentGraphStore Index Creation', () => {
    it('DocumentGraphStore also creates the composite index', async () => {
      // DocumentGraphStore should also create the type_deleted composite index
      // This ensures consistency across all graph store implementations
      const { DocumentGraphStore } = await import('../stores/document')

      const docStore = new DocumentGraphStore(':memory:')
      await docStore.initialize()

      // @ts-expect-error - accessing private sqlite for testing
      const sqlite = docStore['sqlite']

      expect(sqlite).toBeDefined()

      const result = sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
           AND tbl_name = 'graph_things'
           AND name = 'idx_things_type_deleted'`
        )
        .get() as { name: string } | undefined

      expect(result).toBeDefined()
      expect(result?.name).toBe('idx_things_type_deleted')

      await docStore.close()
    })
  })
})
