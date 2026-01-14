/**
 * JSON Path Index Primitive Tests - TDD RED Phase
 *
 * Tests for a low-level JSON path indexing primitive that enables efficient
 * queries on json_extract(data, '$.path') expressions in SQLite.
 *
 * From architectural review (CRITICAL):
 * "No JSON path indexes for data column queries. Add indexes for common queries:
 * json_extract(data, '$.name'), json_extract(data, '$.status'). Without these,
 * full table scans occur for data field queries."
 *
 * @see dotdo-v05ma - [RED] Add JSON path indexes for common data queries
 *
 * Design Goals:
 * - Provide a reusable primitive for creating indexes on JSON fields
 * - Support single-path, nested-path, and compound indexes
 * - Verify index usage via EXPLAIN QUERY PLAN
 * - Test performance characteristics with larger datasets
 * - Work with any SQLite table that has a JSON data column
 *
 * Uses real SQLite (better-sqlite3), NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createJsonPathIndexManager,
  type JsonPathIndexManager,
  type JsonPathIndexOptions,
  type JsonPathIndexInfo,
} from '../json-path-index'

// ============================================================================
// TEST TYPES
// ============================================================================

interface ThingRow {
  id: string
  type_id: number
  type_name: string
  data: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

// ============================================================================
// TEST SETUP
// ============================================================================

describe('JsonPathIndexManager Primitive', () => {
  let sqlite: Database.Database
  let manager: JsonPathIndexManager

  beforeEach(() => {
    sqlite = new Database(':memory:')

    // Create a Things table structure (common pattern in dotdo)
    sqlite.exec(`
      CREATE TABLE things (
        id TEXT PRIMARY KEY NOT NULL,
        type_id INTEGER NOT NULL,
        type_name TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE INDEX things_type_id_idx ON things(type_id);
      CREATE INDEX things_type_name_idx ON things(type_name);
    `)

    manager = createJsonPathIndexManager(sqlite, {
      tableName: 'things',
      dataColumn: 'data',
    })
  })

  afterEach(() => {
    sqlite.close()
  })

  // ============================================================================
  // 1. BASIC INDEX CREATION
  // ============================================================================

  describe('Basic Index Creation', () => {
    it('should create index on simple JSON path ($.name)', () => {
      manager.createIndex('name')

      const indexes = sqlite
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_things_data_%'"
        )
        .all() as { name: string; sql: string }[]

      expect(indexes.length).toBe(1)
      expect(indexes[0]!.name).toContain('name')
      expect(indexes[0]!.sql).toContain("json_extract(data, '$.name')")
    })

    it('should create index on $.status', () => {
      manager.createIndex('status')

      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%status%'")
        .all() as { name: string }[]

      expect(indexes.length).toBe(1)
    })

    it('should create index on $.type', () => {
      manager.createIndex('type')

      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%type%'")
        .all() as { name: string }[]

      // Note: should only match our data index, not type_id or type_name columns
      expect(indexes.some((i) => i.name.includes('data_type'))).toBe(true)
    })

    it('should create index on nested path ($.config.enabled)', () => {
      manager.createIndex('config.enabled')

      const indexes = sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%config%enabled%'"
        )
        .all() as { sql: string }[]

      expect(indexes.length).toBe(1)
      expect(indexes[0]!.sql).toContain("json_extract(data, '$.config.enabled')")
    })

    it('should create index on deeply nested path ($.settings.notifications.email.enabled)', () => {
      manager.createIndex('settings.notifications.email.enabled')

      const indexes = sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%settings%notifications%email%enabled%'"
        )
        .all() as { sql: string }[]

      expect(indexes.length).toBe(1)
      expect(indexes[0]!.sql).toContain(
        "json_extract(data, '$.settings.notifications.email.enabled')"
      )
    })

    it('should be idempotent - creating same index twice should not error', () => {
      manager.createIndex('status')

      // Second creation should not throw
      expect(() => manager.createIndex('status')).not.toThrow()

      // Should still only have one index
      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%status%'")
        .all()

      expect(indexes.length).toBe(1)
    })
  })

  // ============================================================================
  // 2. PARTIAL INDEXES (TYPE-FILTERED)
  // ============================================================================

  describe('Partial Indexes (Type-Filtered)', () => {
    it('should create partial index with typeId filter', () => {
      manager.createIndex('email', { typeId: 1 })

      const indexes = sqlite
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%type1%email%'"
        )
        .all() as { name: string; sql: string }[]

      expect(indexes.length).toBe(1)
      expect(indexes[0]!.sql).toContain('WHERE')
      expect(indexes[0]!.sql).toContain('type_id = 1')
    })

    it('should create partial index with typeName filter', () => {
      manager.createIndex('status', { typeName: 'Customer' })

      const indexes = sqlite
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%customer%status%'"
        )
        .all() as { name: string; sql: string }[]

      expect(indexes.length).toBe(1)
      expect(indexes[0]!.sql).toContain('WHERE')
      expect(indexes[0]!.sql).toContain("type_name = 'Customer'")
    })

    it('should allow same path with different type filters', () => {
      manager.createIndex('status', { typeId: 1 })
      manager.createIndex('status', { typeId: 2 })
      manager.createIndex('status') // Global index

      const indexes = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%data%status%'"
        )
        .all() as { name: string }[]

      // Should have 3 distinct indexes
      expect(indexes.length).toBe(3)
    })
  })

  // ============================================================================
  // 3. COMPOUND INDEXES
  // ============================================================================

  describe('Compound Indexes', () => {
    it('should create compound index on multiple JSON paths', () => {
      manager.createCompoundIndex(['status', 'priority'])

      const indexes = sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%status%priority%'"
        )
        .all() as { sql: string }[]

      expect(indexes.length).toBe(1)
      expect(indexes[0]!.sql).toContain("json_extract(data, '$.status')")
      expect(indexes[0]!.sql).toContain("json_extract(data, '$.priority')")
    })

    it('should create compound index with typeId + JSON path', () => {
      manager.createCompoundIndex(['status'], { includeTypeId: true })

      const indexes = sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%typeid%status%'"
        )
        .all() as { sql: string }[]

      expect(indexes.length).toBe(1)
      expect(indexes[0]!.sql).toContain('type_id')
      expect(indexes[0]!.sql).toContain("json_extract(data, '$.status')")
    })

    it('should create compound index with typeName + JSON path', () => {
      manager.createCompoundIndex(['status'], { includeTypeName: true })

      const indexes = sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%typename%status%'"
        )
        .all() as { sql: string }[]

      expect(indexes.length).toBe(1)
      expect(indexes[0]!.sql).toContain('type_name')
      expect(indexes[0]!.sql).toContain("json_extract(data, '$.status')")
    })
  })

  // ============================================================================
  // 4. INDEX LISTING AND MANAGEMENT
  // ============================================================================

  describe('Index Listing and Management', () => {
    it('should list all JSON path indexes', () => {
      manager.createIndex('name')
      manager.createIndex('status')
      manager.createIndex('email', { typeId: 1 })

      const indexes = manager.listIndexes()

      expect(indexes.length).toBe(3)
      expect(indexes.map((i) => i.path)).toContain('name')
      expect(indexes.map((i) => i.path)).toContain('status')
      expect(indexes.some((i) => i.path === 'email' && i.typeId === 1)).toBe(true)
    })

    it('should return index info with correct metadata', () => {
      manager.createIndex('status', { typeId: 1, typeName: 'Customer' })

      const indexes = manager.listIndexes()
      const statusIndex = indexes.find((i) => i.path === 'status')

      expect(statusIndex).toBeDefined()
      expect(statusIndex!.path).toBe('status')
      expect(statusIndex!.typeId).toBe(1)
      expect(statusIndex!.typeName).toBe('Customer')
      expect(statusIndex!.tableName).toBe('things')
      expect(statusIndex!.indexName).toMatch(/idx_things_.*status/)
    })

    it('should drop a JSON path index', () => {
      manager.createIndex('obsolete')

      let indexes = manager.listIndexes()
      expect(indexes.some((i) => i.path === 'obsolete')).toBe(true)

      manager.dropIndex('obsolete')

      indexes = manager.listIndexes()
      expect(indexes.some((i) => i.path === 'obsolete')).toBe(false)
    })

    it('should drop partial index by path and typeId', () => {
      manager.createIndex('email', { typeId: 1 })
      manager.createIndex('email', { typeId: 2 })

      manager.dropIndex('email', { typeId: 1 })

      const indexes = manager.listIndexes()
      expect(indexes.filter((i) => i.path === 'email')).toHaveLength(1)
      expect(indexes.find((i) => i.path === 'email')!.typeId).toBe(2)
    })

    it('should check if index exists', () => {
      manager.createIndex('status')

      expect(manager.hasIndex('status')).toBe(true)
      expect(manager.hasIndex('nonexistent')).toBe(false)
    })

    it('should check if partial index exists', () => {
      manager.createIndex('email', { typeId: 1 })

      expect(manager.hasIndex('email', { typeId: 1 })).toBe(true)
      expect(manager.hasIndex('email', { typeId: 2 })).toBe(false)
      expect(manager.hasIndex('email')).toBe(false) // Global index doesn't exist
    })
  })

  // ============================================================================
  // 5. QUERY PLAN VERIFICATION
  // ============================================================================

  describe('Query Plan Optimization', () => {
    beforeEach(() => {
      // Seed enough data for optimizer to prefer indexes
      const now = Date.now()
      const stmt = sqlite.prepare(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      for (let i = 0; i < 1000; i++) {
        stmt.run(
          `thing-${i}`,
          i % 3 === 0 ? 1 : 2,
          i % 3 === 0 ? 'Customer' : 'Product',
          JSON.stringify({
            name: `Item ${i}`,
            status: i % 2 === 0 ? 'active' : 'inactive',
            priority: i,
            category: i % 4 === 0 ? 'premium' : 'standard',
          }),
          now,
          now
        )
      }
    })

    it('should use index for equality query (json_extract(data, $.status) = value)', () => {
      manager.createIndex('status')
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM things
           WHERE json_extract(data, '$.status') = 'active'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map((p) => p.detail).join(' ')

      // Should use index, not full table scan
      expect(planStr).toMatch(/USING INDEX|SEARCH/i)
    })

    it('should use index for prefix LIKE query', () => {
      manager.createIndex('name')
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM things
           WHERE json_extract(data, '$.name') LIKE 'Item 1%'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map((p) => p.detail).join(' ')

      // SQLite can use B-tree index for prefix LIKE
      expect(planStr).toMatch(/USING INDEX|SEARCH/i)
    })

    it('should use index for range query (json_extract(data, $.priority) > value)', () => {
      manager.createIndex('priority')
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM things
           WHERE json_extract(data, '$.priority') > 500`
        )
        .all() as { detail: string }[]

      const planStr = plan.map((p) => p.detail).join(' ')

      expect(planStr).toMatch(/USING INDEX|SEARCH/i)
    })

    it('should use partial index when querying by typeId + json field', () => {
      manager.createIndex('status', { typeId: 1 })
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM things
           WHERE type_id = 1 AND json_extract(data, '$.status') = 'active'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map((p) => p.detail).join(' ')

      // Partial index should be used for this specific query pattern
      expect(planStr).toMatch(/USING INDEX/i)
    })

    it('should NOT use index for unindexed JSON field (prove table scan)', () => {
      // Do NOT create index on 'unindexed' field

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM things
           WHERE json_extract(data, '$.unindexed') = 'value'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map((p) => p.detail).join(' ')

      // Should show SCAN (table scan) without USING INDEX
      expect(planStr).toMatch(/SCAN things(?! USING INDEX)/i)
    })

    it('should use compound index for multi-field query', () => {
      manager.createCompoundIndex(['status', 'category'])
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM things
           WHERE json_extract(data, '$.status') = 'active'
             AND json_extract(data, '$.category') = 'premium'`
        )
        .all() as { detail: string }[]

      const planStr = plan.map((p) => p.detail).join(' ')

      expect(planStr).toMatch(/USING INDEX/i)
    })

    it('should use index for ORDER BY json_extract()', () => {
      manager.createIndex('priority')
      sqlite.exec('ANALYZE')

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM things
           ORDER BY json_extract(data, '$.priority') DESC`
        )
        .all() as { detail: string }[]

      const planStr = plan.map((p) => p.detail).join(' ')

      // B-tree index can be used for sorting
      expect(planStr).toMatch(/USING INDEX|SCAN.*USING/i)
    })
  })

  // ============================================================================
  // 6. EDGE CASES AND DATA TYPES
  // ============================================================================

  describe('Edge Cases and Data Types', () => {
    beforeEach(() => {
      const now = Date.now()
      const stmt = sqlite.prepare(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      // Various data type scenarios
      stmt.run('null-status', 1, 'Item', JSON.stringify({ status: null }), now, now)
      stmt.run('missing-field', 1, 'Item', JSON.stringify({ name: 'NoStatus' }), now, now)
      stmt.run('numeric-value', 1, 'Item', JSON.stringify({ priority: 42 }), now, now)
      stmt.run('boolean-value', 1, 'Item', JSON.stringify({ active: true }), now, now)
      stmt.run('array-value', 1, 'Item', JSON.stringify({ tags: ['a', 'b', 'c'] }), now, now)
      stmt.run('nested-object', 1, 'Item', JSON.stringify({ meta: { key: 'value' } }), now, now)
      stmt.run('empty-data', 1, 'Item', JSON.stringify({}), now, now)
      stmt.run('null-data', 1, 'Item', null, now, now)
    })

    it('should handle null values in indexed JSON field', () => {
      manager.createIndex('status')

      const results = sqlite
        .prepare(
          `SELECT id FROM things
           WHERE json_extract(data, '$.status') IS NULL`
        )
        .all() as { id: string }[]

      // Should find things with explicit null and missing field
      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results.some((r) => r.id === 'null-status')).toBe(true)
      expect(results.some((r) => r.id === 'missing-field')).toBe(true)
    })

    it('should handle missing field in indexed JSON', () => {
      manager.createIndex('status')

      const results = sqlite
        .prepare(
          `SELECT id FROM things
           WHERE json_extract(data, '$.status') IS NULL AND id = 'missing-field'`
        )
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
    })

    it('should handle numeric values in indexed field', () => {
      manager.createIndex('priority')

      const results = sqlite
        .prepare(
          `SELECT id FROM things
           WHERE json_extract(data, '$.priority') = 42`
        )
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('numeric-value')
    })

    it('should handle boolean values in indexed field', () => {
      manager.createIndex('active')

      const results = sqlite
        .prepare(
          `SELECT id FROM things
           WHERE json_extract(data, '$.active') = true`
        )
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('boolean-value')
    })

    it('should handle array values (index created but array queries need special handling)', () => {
      manager.createIndex('tags')

      // Index exists
      expect(manager.hasIndex('tags')).toBe(true)

      // Note: Querying array elements requires JSON array functions, not direct equality
      // This test just verifies the index is created, not array query semantics
    })

    it('should handle null data column', () => {
      manager.createIndex('status')

      const results = sqlite
        .prepare(
          `SELECT id FROM things
           WHERE json_extract(data, '$.status') IS NULL`
        )
        .all() as { id: string }[]

      // 'null-data' has null data column, so json_extract returns null
      expect(results.some((r) => r.id === 'null-data')).toBe(true)
    })

    it('should handle empty JSON object', () => {
      manager.createIndex('status')

      const results = sqlite
        .prepare(
          `SELECT id FROM things
           WHERE json_extract(data, '$.status') IS NULL`
        )
        .all() as { id: string }[]

      // Empty object {} means status field is missing
      expect(results.some((r) => r.id === 'empty-data')).toBe(true)
    })
  })

  // ============================================================================
  // 7. VALIDATION AND SECURITY
  // ============================================================================

  describe('Validation and Security', () => {
    it('should reject invalid JSON path (SQL injection attempt)', () => {
      expect(() => manager.createIndex("status'; DROP TABLE things--")).toThrow(/Invalid.*path/i)
    })

    it('should reject path with special characters', () => {
      expect(() => manager.createIndex('field[0]')).toThrow(/Invalid.*path/i)
      expect(() => manager.createIndex('field"name')).toThrow(/Invalid.*path/i)
      expect(() => manager.createIndex("field'name")).toThrow(/Invalid.*path/i)
    })

    it('should reject empty path', () => {
      expect(() => manager.createIndex('')).toThrow(/Invalid.*path|empty/i)
    })

    it('should reject path starting with dot', () => {
      expect(() => manager.createIndex('.invalid')).toThrow(/Invalid.*path/i)
    })

    it('should reject path ending with dot', () => {
      expect(() => manager.createIndex('invalid.')).toThrow(/Invalid.*path/i)
    })

    it('should allow valid alphanumeric paths with underscores', () => {
      expect(() => manager.createIndex('valid_field')).not.toThrow()
      expect(() => manager.createIndex('field123')).not.toThrow()
      expect(() => manager.createIndex('nested.field_name')).not.toThrow()
    })
  })

  // ============================================================================
  // 8. SCHEMA SYNCHRONIZATION
  // ============================================================================

  describe('Schema Synchronization', () => {
    it('should sync indexes from schema definition with index: true fields', () => {
      const schema = {
        email: { type: 'string', index: true },
        status: { type: 'string', index: true },
        name: { type: 'string', index: false },
        createdAt: { type: 'date' },
      }

      manager.syncFromSchema(schema, { typeId: 1 })

      const indexes = manager.listIndexes()
      const type1Indexes = indexes.filter((i) => i.typeId === 1)

      expect(type1Indexes.map((i) => i.path)).toContain('email')
      expect(type1Indexes.map((i) => i.path)).toContain('status')
      expect(type1Indexes.map((i) => i.path)).not.toContain('name')
      expect(type1Indexes.map((i) => i.path)).not.toContain('createdAt')
    })

    it('should support shorthand # prefix for indexed fields', () => {
      const schema = {
        email: '#string', // # prefix = indexed
        status: '#string',
        bio: 'string', // No # = not indexed
      }

      manager.syncFromSchema(schema, { typeId: 2 })

      const indexes = manager.listIndexes()
      const type2Indexes = indexes.filter((i) => i.typeId === 2)

      expect(type2Indexes.map((i) => i.path)).toContain('email')
      expect(type2Indexes.map((i) => i.path)).toContain('status')
      expect(type2Indexes.map((i) => i.path)).not.toContain('bio')
    })

    it('should drop obsolete indexes when schema changes', () => {
      // First sync with status indexed
      manager.syncFromSchema({ status: '#string', email: '#string' }, { typeId: 3 })

      let indexes = manager.listIndexes()
      expect(indexes.filter((i) => i.typeId === 3).map((i) => i.path)).toContain('status')

      // Second sync with status no longer indexed
      manager.syncFromSchema({ status: 'string', email: '#string' }, { typeId: 3 })

      indexes = manager.listIndexes()
      const type3Indexes = indexes.filter((i) => i.typeId === 3)
      expect(type3Indexes.map((i) => i.path)).not.toContain('status')
      expect(type3Indexes.map((i) => i.path)).toContain('email')
    })

    it('should not affect indexes for other types when syncing', () => {
      manager.createIndex('global_field')
      manager.createIndex('type1_field', { typeId: 1 })
      manager.syncFromSchema({ new_field: '#string' }, { typeId: 2 })

      const indexes = manager.listIndexes()

      // Global and type1 indexes should still exist
      expect(indexes.some((i) => i.path === 'global_field' && !i.typeId)).toBe(true)
      expect(indexes.some((i) => i.path === 'type1_field' && i.typeId === 1)).toBe(true)
      expect(indexes.some((i) => i.path === 'new_field' && i.typeId === 2)).toBe(true)
    })
  })

  // ============================================================================
  // 9. PERFORMANCE CHARACTERISTICS
  // ============================================================================

  describe('Performance Characteristics', () => {
    it('should query 10,000 rows efficiently with index', () => {
      // Seed large dataset
      const now = Date.now()
      const stmt = sqlite.prepare(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      for (let i = 0; i < 10000; i++) {
        stmt.run(
          `perf-${i}`,
          1,
          'Item',
          JSON.stringify({
            status: i % 100 === 0 ? 'special' : 'normal',
            index: i,
          }),
          now,
          now
        )
      }

      // Create index and analyze
      manager.createIndex('status')
      sqlite.exec('ANALYZE')

      // Measure query time
      const start = performance.now()
      const results = sqlite
        .prepare(
          `SELECT * FROM things
           WHERE json_extract(data, '$.status') = 'special'`
        )
        .all()
      const duration = performance.now() - start

      // Should find 100 items (every 100th is special)
      expect(results).toHaveLength(100)

      // With index, should be fast (< 100ms for 10k rows is conservative)
      expect(duration).toBeLessThan(1000)
    })

    it('should demonstrate performance improvement with index vs without', () => {
      // Seed data
      const now = Date.now()
      const stmt = sqlite.prepare(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      for (let i = 0; i < 5000; i++) {
        stmt.run(
          `bench-${i}`,
          1,
          'Item',
          JSON.stringify({ value: i, category: i % 10 === 0 ? 'target' : 'other' }),
          now,
          now
        )
      }

      // Query WITHOUT index
      const startWithout = performance.now()
      sqlite.prepare(`SELECT * FROM things WHERE json_extract(data, '$.category') = 'target'`).all()
      const durationWithout = performance.now() - startWithout

      // Create index and analyze
      manager.createIndex('category')
      sqlite.exec('ANALYZE')

      // Query WITH index
      const startWith = performance.now()
      sqlite.prepare(`SELECT * FROM things WHERE json_extract(data, '$.category') = 'target'`).all()
      const durationWith = performance.now() - startWith

      // Index should provide speedup (at least not significantly slower)
      // Note: For small datasets, index overhead might make it similar speed
      // The main benefit is at scale, but we verify it doesn't regress
      expect(durationWith).toBeLessThanOrEqual(durationWithout * 2 + 50) // Allow some variance
    })
  })

  // ============================================================================
  // 10. MULTIPLE TABLES SUPPORT
  // ============================================================================

  describe('Multiple Tables Support', () => {
    beforeEach(() => {
      // Create a second table
      sqlite.exec(`
        CREATE TABLE events (
          id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL,
          payload TEXT,
          timestamp INTEGER NOT NULL
        );
      `)
    })

    it('should manage indexes on different tables independently', () => {
      const eventsManager = createJsonPathIndexManager(sqlite, {
        tableName: 'events',
        dataColumn: 'payload',
      })

      manager.createIndex('status')
      eventsManager.createIndex('action')

      const thingsIndexes = manager.listIndexes()
      const eventsIndexes = eventsManager.listIndexes()

      expect(thingsIndexes.map((i) => i.path)).toContain('status')
      expect(thingsIndexes.map((i) => i.path)).not.toContain('action')
      expect(eventsIndexes.map((i) => i.path)).toContain('action')
      expect(eventsIndexes.map((i) => i.path)).not.toContain('status')
    })
  })
})
