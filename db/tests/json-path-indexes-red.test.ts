/**
 * JSON Path Indexes - RED Phase Tests
 *
 * TDD RED phase: These tests define the expected behavior for JSON path indexes
 * covering common data query patterns. Tests should FAIL until implementation
 * is complete.
 *
 * Covers:
 * - Creating indexes on JSON paths (data.user.email)
 * - Querying using indexed paths
 * - Compound JSON path indexes
 * - Index maintenance on updates
 *
 * @see dotdo-v05ma for issue details
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import * as schema from '../index'
import {
  createJsonIndex,
  dropJsonIndex,
  listJsonIndexes,
  getIndexName,
  type JsonIndexOptions,
} from '../json-indexes'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('JSON Path Indexes - RED Phase', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = drizzle(sqlite, { schema })

    // Create tables matching production schema
    sqlite.exec(`
      CREATE TABLE nouns (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        noun TEXT NOT NULL UNIQUE,
        plural TEXT,
        description TEXT,
        schema TEXT
      )
    `)

    sqlite.exec(`
      CREATE TABLE things (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        type INTEGER NOT NULL,
        branch TEXT,
        name TEXT,
        data TEXT,
        deleted INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'user'
      )
    `)

    sqlite.exec(`
      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    // Insert test nouns
    sqlite.exec(`
      INSERT INTO nouns (noun, plural) VALUES ('User', 'Users');
      INSERT INTO nouns (noun, plural) VALUES ('Order', 'Orders');
      INSERT INTO nouns (noun, plural) VALUES ('Product', 'Products');
    `)
  })

  afterEach(() => {
    sqlite.close()
  })

  // ============================================================================
  // DEEP NESTED PATH INDEXES (data.user.email pattern)
  // ============================================================================

  describe('Creating indexes on deep JSON paths', () => {
    it('should create index on data.user.email path', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'user.email',
        typeId: 1,
      })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: 'idx_things_type1_data_user_email',
          path: 'user.email',
          typeId: 1,
        })
      )
    })

    it('should create index on data.user.profile.address.city', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'user.profile.address.city',
        typeId: 1,
      })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toContainEqual(
        expect.objectContaining({
          path: 'user.profile.address.city',
          typeId: 1,
        })
      )
    })

    it('should handle commonly indexed fields like status and name', async () => {
      // Common fields mentioned in architectural review
      await createJsonIndex(db, { table: 'things', path: 'name' })
      await createJsonIndex(db, { table: 'things', path: 'status' })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes.map((i) => i.path).sort()).toContain('name')
      expect(indexes.map((i) => i.path).sort()).toContain('status')
    })
  })

  // ============================================================================
  // QUERYING USING INDEXED PATHS
  // ============================================================================

  describe('Query using indexed path', () => {
    beforeEach(() => {
      // Insert test data with nested structure
      for (let i = 0; i < 100; i++) {
        const email = `user${i}@example.com`
        const status = i % 3 === 0 ? 'active' : i % 3 === 1 ? 'pending' : 'inactive'
        sqlite.exec(`
          INSERT INTO things (id, type, data)
          VALUES (
            'user-${i}',
            1,
            '${JSON.stringify({
              user: {
                email,
                profile: {
                  name: `User ${i}`,
                  age: 20 + (i % 50),
                },
              },
              status,
              priority: i,
            })}'
          )
        `)
      }
    })

    it('should use index when querying by user.email', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'user.email',
        typeId: 1,
      })

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE type = 1 AND json_extract(data, '$.user.email') = 'user50@example.com'`
        )
        .all()

      const planStr = JSON.stringify(plan)
      expect(planStr).toMatch(/idx_things_type1_data_user_email|USING INDEX/)
    })

    it('should efficiently query by status with index', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'status',
        typeId: 1,
      })

      // Query should use index and return correct results
      const result = sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM things WHERE type = 1 AND json_extract(data, '$.status') = 'active'`
        )
        .get() as { count: number }

      expect(result.count).toBe(34) // Every 3rd item (0, 3, 6, ..., 99)

      // Verify index usage
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE type = 1 AND json_extract(data, '$.status') = 'active'`
        )
        .all()

      const planStr = JSON.stringify(plan)
      expect(planStr).toMatch(/idx_things_type1_data_status|USING INDEX/)
    })

    it('should support range queries on indexed numeric paths', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'priority',
        typeId: 1,
      })

      // Range query
      const result = sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM things WHERE type = 1 AND json_extract(data, '$.priority') BETWEEN 10 AND 20`
        )
        .get() as { count: number }

      expect(result.count).toBe(11) // 10, 11, 12, ..., 20

      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE type = 1 AND json_extract(data, '$.priority') BETWEEN 10 AND 20`
        )
        .all()

      const planStr = JSON.stringify(plan)
      expect(planStr).toMatch(/idx_things_type1_data_priority|USING INDEX/)
    })
  })

  // ============================================================================
  // COMPOUND JSON PATH INDEXES
  // ============================================================================

  describe('Compound JSON path indexes', () => {
    /**
     * RED PHASE: Compound indexes on multiple JSON paths
     *
     * These tests expect a new function: createCompoundJsonIndex()
     * that creates indexes on multiple JSON paths for efficient
     * multi-field queries.
     *
     * Expected signature:
     * createCompoundJsonIndex(db, {
     *   table: 'things',
     *   paths: ['status', 'priority'],
     *   typeId: 1,
     * })
     *
     * Should generate:
     * CREATE INDEX idx_things_type1_data_compound_status_priority
     *   ON things(type, json_extract(data, '$.status'), json_extract(data, '$.priority'))
     *   WHERE type = 1
     */

    it('should create compound index on multiple JSON paths', async () => {
      // Import the function that should exist but doesn't yet
      const { createCompoundJsonIndex } = await import('../json-indexes').catch(() => ({
        createCompoundJsonIndex: undefined,
      }))

      // This test fails in RED phase - function doesn't exist
      expect(createCompoundJsonIndex).toBeDefined()

      if (createCompoundJsonIndex) {
        await createCompoundJsonIndex(db, {
          table: 'things',
          paths: ['status', 'priority'],
          typeId: 1,
        })

        const indexes = await listJsonIndexes(db, 'things')
        expect(indexes).toContainEqual(
          expect.objectContaining({
            name: expect.stringMatching(/compound.*status.*priority/),
          })
        )
      }
    })

    it('should use compound index for multi-field queries', async () => {
      // Insert test data
      for (let i = 0; i < 100; i++) {
        sqlite.exec(`
          INSERT INTO things (id, type, data)
          VALUES (
            'item-${i}',
            1,
            '{"status": "${i % 2 === 0 ? 'active' : 'inactive'}", "priority": ${i % 5}, "category": "test"}'
          )
        `)
      }

      const { createCompoundJsonIndex } = await import('../json-indexes').catch(() => ({
        createCompoundJsonIndex: undefined,
      }))

      // Skip if not implemented
      if (!createCompoundJsonIndex) {
        expect(createCompoundJsonIndex).toBeDefined()
        return
      }

      await createCompoundJsonIndex(db, {
        table: 'things',
        paths: ['status', 'priority'],
        typeId: 1,
      })

      // Multi-field query should use compound index
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things
           WHERE type = 1
             AND json_extract(data, '$.status') = 'active'
             AND json_extract(data, '$.priority') = 2`
        )
        .all()

      const planStr = JSON.stringify(plan)
      expect(planStr).toMatch(/compound|USING INDEX/)
    })

    it('should support three-field compound indexes', async () => {
      const { createCompoundJsonIndex } = await import('../json-indexes').catch(() => ({
        createCompoundJsonIndex: undefined,
      }))

      expect(createCompoundJsonIndex).toBeDefined()

      if (createCompoundJsonIndex) {
        await createCompoundJsonIndex(db, {
          table: 'things',
          paths: ['status', 'category', 'priority'],
          typeId: 1,
        })

        const indexes = await listJsonIndexes(db, 'things')
        expect(indexes.length).toBeGreaterThan(0)
      }
    })

    it('should generate deterministic compound index names', async () => {
      const { getCompoundIndexName } = await import('../json-indexes').catch(() => ({
        getCompoundIndexName: undefined,
      }))

      expect(getCompoundIndexName).toBeDefined()

      if (getCompoundIndexName) {
        const name1 = getCompoundIndexName('things', ['status', 'priority'], 1)
        const name2 = getCompoundIndexName('things', ['status', 'priority'], 1)

        expect(name1).toBe(name2)
        expect(name1).toMatch(/idx_things_type1_data_compound/)
      }
    })
  })

  // ============================================================================
  // INDEX MAINTENANCE ON UPDATES
  // ============================================================================

  describe('Index maintenance on updates', () => {
    beforeEach(() => {
      // Create initial data
      for (let i = 0; i < 50; i++) {
        sqlite.exec(`
          INSERT INTO things (id, type, data)
          VALUES (
            'item-${i}',
            1,
            '{"status": "draft", "version": 1}'
          )
        `)
      }
    })

    it('should maintain index when updating JSON data', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'status',
        typeId: 1,
      })

      // Verify initial state
      let result = sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM things WHERE json_extract(data, '$.status') = 'draft'`
        )
        .get() as { count: number }
      expect(result.count).toBe(50)

      // Update some records
      sqlite.exec(`
        UPDATE things
        SET data = '{"status": "published", "version": 2}'
        WHERE id IN ('item-0', 'item-1', 'item-2')
      `)

      // Index should reflect updates
      result = sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM things WHERE json_extract(data, '$.status') = 'draft'`
        )
        .get() as { count: number }
      expect(result.count).toBe(47)

      result = sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM things WHERE json_extract(data, '$.status') = 'published'`
        )
        .get() as { count: number }
      expect(result.count).toBe(3)
    })

    it('should maintain index when inserting new JSON data', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'status',
        typeId: 1,
      })

      // Insert new record
      sqlite.exec(`
        INSERT INTO things (id, type, data)
        VALUES ('item-new', 1, '{"status": "active"}')
      `)

      // Should be queryable via index
      const result = sqlite
        .prepare(
          `SELECT * FROM things WHERE type = 1 AND json_extract(data, '$.status') = 'active'`
        )
        .all()

      expect(result).toHaveLength(1)
    })

    it('should maintain index when deleting records', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'status',
        typeId: 1,
      })

      // Delete some records
      sqlite.exec(`DELETE FROM things WHERE id IN ('item-0', 'item-1')`)

      // Index should reflect deletions
      const result = sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM things WHERE json_extract(data, '$.status') = 'draft'`
        )
        .get() as { count: number }
      expect(result.count).toBe(48)
    })

    it('should handle partial JSON updates maintaining index integrity', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'version',
        typeId: 1,
      })

      // Simulate JSON merge update using json_set
      sqlite.exec(`
        UPDATE things
        SET data = json_set(data, '$.version', 2)
        WHERE id = 'item-0'
      `)

      // Query by updated field
      const result = sqlite
        .prepare(
          `SELECT * FROM things WHERE json_extract(data, '$.version') = 2`
        )
        .all()

      expect(result).toHaveLength(1)
    })

    it('should maintain compound index on updates', async () => {
      const { createCompoundJsonIndex } = await import('../json-indexes').catch(() => ({
        createCompoundJsonIndex: undefined,
      }))

      if (!createCompoundJsonIndex) {
        expect(createCompoundJsonIndex).toBeDefined()
        return
      }

      await createCompoundJsonIndex(db, {
        table: 'things',
        paths: ['status', 'version'],
        typeId: 1,
      })

      // Update both indexed fields
      sqlite.exec(`
        UPDATE things
        SET data = '{"status": "published", "version": 3}'
        WHERE id = 'item-0'
      `)

      // Query should return correct result
      const result = sqlite
        .prepare(
          `SELECT * FROM things
           WHERE json_extract(data, '$.status') = 'published'
             AND json_extract(data, '$.version') = 3`
        )
        .all()

      expect(result).toHaveLength(1)
    })
  })

  // ============================================================================
  // PERFORMANCE VERIFICATION
  // ============================================================================

  describe('Performance verification', () => {
    beforeEach(() => {
      // Insert larger dataset for performance testing
      const stmt = sqlite.prepare(`
        INSERT INTO things (id, type, data)
        VALUES (?, 1, ?)
      `)

      const insertMany = sqlite.transaction((items: Array<{ id: string; data: string }>) => {
        for (const item of items) {
          stmt.run(item.id, item.data)
        }
      })

      const items = []
      for (let i = 0; i < 1000; i++) {
        items.push({
          id: `perf-${i}`,
          data: JSON.stringify({
            user: {
              email: `user${i}@example.com`,
              name: `User ${i}`,
            },
            status: i % 4 === 0 ? 'active' : 'inactive',
            score: Math.random() * 100,
            tags: ['tag1', 'tag2'],
          }),
        })
      }
      insertMany(items)
    })

    it('should show improved query plan with index vs without', async () => {
      // Query plan WITHOUT index
      const planWithout = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE json_extract(data, '$.status') = 'active'`
        )
        .all()
      const planWithoutStr = JSON.stringify(planWithout)

      // Should show SCAN (full table scan)
      expect(planWithoutStr).toMatch(/SCAN/)

      // Create index
      await createJsonIndex(db, { table: 'things', path: 'status' })

      // Query plan WITH index
      const planWith = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE json_extract(data, '$.status') = 'active'`
        )
        .all()
      const planWithStr = JSON.stringify(planWith)

      // Should show INDEX usage
      expect(planWithStr).toMatch(/INDEX|SEARCH/)
    })

    it('should use index for common query patterns', async () => {
      // Create indexes for common fields from architectural review
      await createJsonIndex(db, { table: 'things', path: 'user.email' })
      await createJsonIndex(db, { table: 'things', path: 'status' })

      // Verify email lookup uses index
      const emailPlan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE json_extract(data, '$.user.email') = 'user500@example.com'`
        )
        .all()

      expect(JSON.stringify(emailPlan)).toMatch(/idx_things_data_user_email|USING INDEX/)

      // Verify status lookup uses index
      const statusPlan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE json_extract(data, '$.status') = 'active'`
        )
        .all()

      expect(JSON.stringify(statusPlan)).toMatch(/idx_things_data_status|USING INDEX/)
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error handling for JSON path indexes', () => {
    it('should validate paths in compound index creation', async () => {
      const { createCompoundJsonIndex } = await import('../json-indexes').catch(() => ({
        createCompoundJsonIndex: undefined,
      }))

      if (!createCompoundJsonIndex) {
        expect(createCompoundJsonIndex).toBeDefined()
        return
      }

      // Should reject invalid paths
      await expect(
        createCompoundJsonIndex(db, {
          table: 'things',
          paths: ['valid', '; DROP TABLE things'],
          typeId: 1,
        })
      ).rejects.toThrow(/Invalid/)
    })

    it('should require at least two paths for compound index', async () => {
      const { createCompoundJsonIndex } = await import('../json-indexes').catch(() => ({
        createCompoundJsonIndex: undefined,
      }))

      if (!createCompoundJsonIndex) {
        expect(createCompoundJsonIndex).toBeDefined()
        return
      }

      // Single path should fail
      await expect(
        createCompoundJsonIndex(db, {
          table: 'things',
          paths: ['status'],
          typeId: 1,
        })
      ).rejects.toThrow(/at least two/)
    })

    it('should limit compound index to reasonable number of paths', async () => {
      const { createCompoundJsonIndex } = await import('../json-indexes').catch(() => ({
        createCompoundJsonIndex: undefined,
      }))

      if (!createCompoundJsonIndex) {
        expect(createCompoundJsonIndex).toBeDefined()
        return
      }

      // Too many paths should fail (e.g., > 5)
      await expect(
        createCompoundJsonIndex(db, {
          table: 'things',
          paths: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
          typeId: 1,
        })
      ).rejects.toThrow(/too many/)
    })
  })
})
