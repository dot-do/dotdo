/**
 * JSON Path Indexes for Things Table - TDD RED Phase
 *
 * Tests for JSON path indexing on the Things table to enable efficient
 * queries on json_extract(data, '$.path') expressions.
 *
 * From architectural review (CRITICAL):
 * "No JSON path indexes for data column queries. Add indexes for common queries:
 * json_extract(data, '$.name'), json_extract(data, '$.status'). Without these,
 * full table scans occur for data field queries."
 *
 * @see dotdo-v05ma - [RED] Add JSON path indexes for common data queries
 *
 * Design Goals:
 * - Create indexes on json_extract(data, '$.name'), json_extract(data, '$.status'), json_extract(data, '$.type')
 * - Verify query plans use indexes vs table scans via EXPLAIN QUERY PLAN
 * - Support both full indexes and type-filtered partial indexes
 * - Use real SQLite (better-sqlite3), NO MOCKS
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { SQLiteGraphStore } from '../stores'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('JSON Path Indexes for Things Table', () => {
  let sqlite: Database.Database
  let store: SQLiteGraphStore

  beforeEach(async () => {
    sqlite = new Database(':memory:')
    store = new SQLiteGraphStore(sqlite)
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
    sqlite.close()
  })

  // ============================================================================
  // CORE INDEX CREATION TESTS
  // ============================================================================

  describe('Index Creation', () => {
    it('should create index on json_extract(data, $.name)', async () => {
      // Create index for name field queries
      await store.createJsonPathIndex('name')

      // Verify index exists
      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%data_name%'")
        .all() as { name: string }[]

      expect(indexes.length).toBeGreaterThan(0)
      expect(indexes[0]!.name).toMatch(/name/)
    })

    it('should create index on json_extract(data, $.status)', async () => {
      await store.createJsonPathIndex('status')

      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%data_status%'")
        .all() as { name: string }[]

      expect(indexes.length).toBeGreaterThan(0)
    })

    it('should create index on json_extract(data, $.type)', async () => {
      await store.createJsonPathIndex('type')

      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%data_type%'")
        .all() as { name: string }[]

      expect(indexes.length).toBeGreaterThan(0)
    })

    it('should create composite index with typeId filter (partial index)', async () => {
      // Create type-specific index for Customer things (typeId = 1)
      await store.createJsonPathIndex('email', { typeId: 1 })

      // Verify partial index exists
      const indexes = sqlite
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%type1%data_email%'"
        )
        .all() as { name: string; sql: string }[]

      expect(indexes.length).toBeGreaterThan(0)
      // Partial index should have WHERE clause
      expect(indexes[0]!.sql).toMatch(/WHERE/)
    })

    it('should create index on nested JSON path (config.enabled)', async () => {
      await store.createJsonPathIndex('config.enabled')

      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%config%enabled%'")
        .all() as { name: string }[]

      expect(indexes.length).toBeGreaterThan(0)
    })

    it('should be idempotent - creating same index twice should not error', async () => {
      await store.createJsonPathIndex('status')
      await expect(store.createJsonPathIndex('status')).resolves.not.toThrow()
    })

    it('should list existing JSON path indexes', async () => {
      await store.createJsonPathIndex('name')
      await store.createJsonPathIndex('status')
      await store.createJsonPathIndex('email', { typeId: 1 })

      const indexes = await store.listJsonPathIndexes()

      expect(indexes.length).toBeGreaterThanOrEqual(3)
      expect(indexes.map(i => i.path)).toContain('name')
      expect(indexes.map(i => i.path)).toContain('status')
      expect(indexes.some(i => i.path === 'email' && i.typeId === 1)).toBe(true)
    })

    it('should drop a JSON path index', async () => {
      await store.createJsonPathIndex('obsolete')

      let indexes = await store.listJsonPathIndexes()
      expect(indexes.some(i => i.path === 'obsolete')).toBe(true)

      await store.dropJsonPathIndex('obsolete')

      indexes = await store.listJsonPathIndexes()
      expect(indexes.some(i => i.path === 'obsolete')).toBe(false)
    })
  })

  // ============================================================================
  // QUERY PLAN VERIFICATION - Ensure indexes are actually used
  // ============================================================================

  describe('Query Plan Optimization', () => {
    beforeEach(async () => {
      // Seed test data - need enough rows for optimizer to prefer index
      for (let i = 0; i < 1000; i++) {
        await store.createThing({
          id: `thing-${i}`,
          typeId: i % 3 === 0 ? 1 : 2, // Mix of types
          typeName: i % 3 === 0 ? 'Customer' : 'Product',
          data: {
            name: `Item ${i}`,
            status: i % 2 === 0 ? 'active' : 'inactive',
            type: i % 4 === 0 ? 'premium' : 'standard',
            priority: i,
          },
        })
      }
    })

    it('should use index for json_extract(data, $.status) = value query', async () => {
      // Create index on status
      await store.createJsonPathIndex('status')

      // Run ANALYZE to update statistics
      sqlite.exec('ANALYZE')

      // Get query plan
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE json_extract(data, '$.status') = 'active'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map(p => p.detail).join(' ')

      // Should use index, not SCAN
      expect(planStr).toMatch(/USING INDEX|idx_.*data_status/i)
      expect(planStr).not.toMatch(/SCAN graph_things(?! USING)/i)
    })

    it('should use index for json_extract(data, $.name) LIKE query', async () => {
      await store.createJsonPathIndex('name')
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE json_extract(data, '$.name') LIKE 'Item 1%'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map(p => p.detail).join(' ')

      // Index should be used for prefix LIKE queries
      expect(planStr).toMatch(/USING INDEX|idx_.*data_name|SEARCH/i)
    })

    it('should use type-filtered partial index when querying by typeId + json field', async () => {
      // Create partial index for Customer type (typeId = 1)
      await store.createJsonPathIndex('status', { typeId: 1 })
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE type_id = 1 AND json_extract(data, '$.status') = 'active'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map(p => p.detail).join(' ')

      // Should use the partial index
      expect(planStr).toMatch(/USING INDEX|idx_.*type1.*data_status/i)
    })

    it('should perform full table scan WITHOUT index for json_extract query', async () => {
      // Do NOT create index - verify we get a table scan
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE json_extract(data, '$.nonindexed') = 'value'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map(p => p.detail).join(' ')

      // Should show SCAN (table scan)
      expect(planStr).toMatch(/SCAN/i)
    })

    it('should use index for ORDER BY json_extract(data, $.priority)', async () => {
      await store.createJsonPathIndex('priority')
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           ORDER BY json_extract(data, '$.priority')`
        )
        .all() as { detail: string }[]

      const planStr = plan.map(p => p.detail).join(' ')

      // Index can be used for ordering
      expect(planStr).toMatch(/USING INDEX|idx_.*data_priority|SCAN.*USING/i)
    })

    it('should use index for range query json_extract(data, $.priority) > value', async () => {
      await store.createJsonPathIndex('priority')
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM graph_things
           WHERE json_extract(data, '$.priority') > 500`
        )
        .all() as { detail: string }[]

      const planStr = plan.map(p => p.detail).join(' ')

      expect(planStr).toMatch(/USING INDEX|idx_.*data_priority|SEARCH/i)
    })
  })

  // ============================================================================
  // COMMON QUERY PATTERNS
  // ============================================================================

  describe('Common Query Patterns That Benefit From Indexes', () => {
    beforeEach(async () => {
      // Seed diverse test data
      await store.createThing({
        id: 'customer-1',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Alice', status: 'active', tier: 'premium' },
      })
      await store.createThing({
        id: 'customer-2',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Bob', status: 'inactive', tier: 'basic' },
      })
      await store.createThing({
        id: 'product-1',
        typeId: 2,
        typeName: 'Product',
        data: { name: 'Widget', status: 'available', category: 'tools' },
      })
      await store.createThing({
        id: 'order-1',
        typeId: 3,
        typeName: 'Order',
        data: { status: 'pending', total: 99.99 },
      })
    })

    it('should efficiently query active customers by status', async () => {
      await store.createJsonPathIndex('status', { typeId: 1 })

      // This should use the index
      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE type_id = 1 AND json_extract(data, '$.status') = 'active'`
        )
        .all()

      expect(results).toHaveLength(1)
      expect((results[0] as { id: string }).id).toBe('customer-1')
    })

    it('should efficiently query things by name (lookup pattern)', async () => {
      await store.createJsonPathIndex('name')

      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE json_extract(data, '$.name') = 'Widget'`
        )
        .all()

      expect(results).toHaveLength(1)
      expect((results[0] as { id: string }).id).toBe('product-1')
    })

    it('should efficiently query by status across all types (dashboard pattern)', async () => {
      await store.createJsonPathIndex('status')

      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE json_extract(data, '$.status') = 'active'
              OR json_extract(data, '$.status') = 'pending'`
        )
        .all()

      expect(results).toHaveLength(2) // Alice (active) + order-1 (pending)
    })

    it('should efficiently count by status (analytics pattern)', async () => {
      await store.createJsonPathIndex('status')

      const result = sqlite
        .prepare(
          `SELECT json_extract(data, '$.status') as status, COUNT(*) as count
           FROM graph_things
           GROUP BY json_extract(data, '$.status')`
        )
        .all() as { status: string; count: number }[]

      expect(result.length).toBeGreaterThan(0)
      expect(result.some(r => r.status === 'active' && r.count === 1)).toBe(true)
    })

    it('should support findByDataField helper method', async () => {
      await store.createJsonPathIndex('status')

      // GraphStore should expose a helper that uses the indexed query
      const results = await store.findByDataField('status', 'active')

      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('customer-1')
    })

    it('should support findByDataField with typeId filter', async () => {
      await store.createJsonPathIndex('status', { typeId: 1 })

      const results = await store.findByDataField('status', 'active', { typeId: 1 })

      expect(results).toHaveLength(1)
      expect(results[0]!.typeName).toBe('Customer')
    })
  })

  // ============================================================================
  // AUTO-INDEX SYNC FROM NOUN SCHEMA
  // ============================================================================

  describe('Automatic Index Sync From Noun Schema', () => {
    it('should sync indexes from noun schema with index: true fields', async () => {
      // Define a schema with indexed fields
      const schema = {
        email: { type: 'string', index: true },
        status: { type: 'string', index: true },
        name: { type: 'string' }, // Not indexed
        createdAt: { type: 'date' }, // Not indexed
      }

      await store.syncJsonPathIndexesFromSchema(schema, { typeId: 1 })

      const indexes = await store.listJsonPathIndexes()
      const typeIndexes = indexes.filter(i => i.typeId === 1)

      expect(typeIndexes.map(i => i.path)).toContain('email')
      expect(typeIndexes.map(i => i.path)).toContain('status')
      expect(typeIndexes.map(i => i.path)).not.toContain('name')
      expect(typeIndexes.map(i => i.path)).not.toContain('createdAt')
    })

    it('should support shorthand # prefix for indexed fields', async () => {
      const schema = {
        email: '#string', // # prefix = indexed
        status: '#string',
        bio: 'string', // No # = not indexed
      }

      await store.syncJsonPathIndexesFromSchema(schema, { typeId: 2 })

      const indexes = await store.listJsonPathIndexes()
      const typeIndexes = indexes.filter(i => i.typeId === 2)

      expect(typeIndexes.map(i => i.path)).toContain('email')
      expect(typeIndexes.map(i => i.path)).toContain('status')
      expect(typeIndexes.map(i => i.path)).not.toContain('bio')
    })

    it('should drop obsolete indexes when schema changes', async () => {
      // First sync with status indexed
      await store.syncJsonPathIndexesFromSchema(
        { status: '#string', email: '#string' },
        { typeId: 3 }
      )

      let indexes = await store.listJsonPathIndexes()
      expect(indexes.filter(i => i.typeId === 3).map(i => i.path)).toContain('status')

      // Second sync with status no longer indexed
      await store.syncJsonPathIndexesFromSchema(
        { status: 'string', email: '#string' }, // status no longer has #
        { typeId: 3 }
      )

      indexes = await store.listJsonPathIndexes()
      const type3Indexes = indexes.filter(i => i.typeId === 3)
      expect(type3Indexes.map(i => i.path)).not.toContain('status')
      expect(type3Indexes.map(i => i.path)).toContain('email')
    })
  })

  // ============================================================================
  // EDGE CASES AND ROBUSTNESS
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle null values in indexed JSON field', async () => {
      await store.createJsonPathIndex('status')

      await store.createThing({
        id: 'null-status',
        typeId: 1,
        typeName: 'Customer',
        data: { status: null },
      })

      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE json_extract(data, '$.status') IS NULL`
        )
        .all()

      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle missing field in indexed JSON', async () => {
      await store.createJsonPathIndex('status')

      await store.createThing({
        id: 'missing-status',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'NoStatus' }, // status field missing
      })

      // Query for null should find things with missing field
      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE json_extract(data, '$.status') IS NULL`
        )
        .all()

      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle deeply nested JSON paths', async () => {
      await store.createJsonPathIndex('settings.notifications.email.enabled')

      await store.createThing({
        id: 'nested-thing',
        typeId: 1,
        typeName: 'User',
        data: {
          settings: {
            notifications: {
              email: { enabled: true },
            },
          },
        },
      })

      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE json_extract(data, '$.settings.notifications.email.enabled') = true`
        )
        .all()

      expect(results).toHaveLength(1)
    })

    it('should reject invalid JSON paths (SQL injection prevention)', async () => {
      await expect(store.createJsonPathIndex("status'; DROP TABLE--")).rejects.toThrow(
        /Invalid.*path/i
      )
    })

    it('should handle array values in indexed field', async () => {
      await store.createJsonPathIndex('tags')

      await store.createThing({
        id: 'array-thing',
        typeId: 1,
        typeName: 'Post',
        data: { tags: ['a', 'b', 'c'] },
      })

      // Index exists but array queries need JSON-specific handling
      const indexes = await store.listJsonPathIndexes()
      expect(indexes.some(i => i.path === 'tags')).toBe(true)
    })

    it('should handle numeric values in indexed field', async () => {
      await store.createJsonPathIndex('priority')

      await store.createThing({
        id: 'numeric-thing',
        typeId: 1,
        typeName: 'Task',
        data: { priority: 5 },
      })

      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE json_extract(data, '$.priority') = 5`
        )
        .all()

      expect(results).toHaveLength(1)
    })

    it('should handle boolean values in indexed field', async () => {
      await store.createJsonPathIndex('active')

      await store.createThing({
        id: 'bool-thing',
        typeId: 1,
        typeName: 'Feature',
        data: { active: true },
      })

      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE json_extract(data, '$.active') = true`
        )
        .all()

      expect(results).toHaveLength(1)
    })
  })

  // ============================================================================
  // PERFORMANCE BENCHMARK (optional, for documentation)
  // ============================================================================

  describe('Performance Baseline', () => {
    it('should query 10,000 rows efficiently with index', async () => {
      // Seed large dataset
      const batchSize = 100
      for (let batch = 0; batch < 100; batch++) {
        const things = []
        for (let i = 0; i < batchSize; i++) {
          const idx = batch * batchSize + i
          things.push({
            id: `perf-${idx}`,
            typeId: 1,
            typeName: 'Item',
            data: {
              status: idx % 100 === 0 ? 'special' : 'normal',
              index: idx,
            },
          })
        }
        // Batch insert
        const stmt = sqlite.prepare(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        const now = Date.now()
        for (const t of things) {
          stmt.run(t.id, t.typeId, t.typeName, JSON.stringify(t.data), now, now)
        }
      }

      // Create index
      await store.createJsonPathIndex('status')
      sqlite.exec('ANALYZE')

      // Measure query time
      const start = performance.now()
      const results = sqlite
        .prepare(
          `SELECT * FROM graph_things
           WHERE json_extract(data, '$.status') = 'special'`
        )
        .all()
      const duration = performance.now() - start

      // Should find 100 items (every 100th is special)
      expect(results).toHaveLength(100)

      // With index, should be fast (< 100ms for 10k rows)
      // This is a baseline - actual threshold depends on hardware
      expect(duration).toBeLessThan(1000) // Conservative threshold
    })
  })
})
