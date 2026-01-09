/**
 * JSON Path Indexing Tests
 *
 * TDD RED phase: Tests for JSON path indexing on Things and Relationships tables.
 * These tests should FAIL until the implementation is complete.
 *
 * @see dotdo-p2r1z for issue details
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import * as schema from '../index'
import {
  createJsonIndex,
  dropJsonIndex,
  syncNounIndexes,
  listJsonIndexes,
  getIndexName,
  validateIndexPath,
  type JsonIndexOptions,
} from '../json-indexes'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('JSON Path Indexing', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = drizzle(sqlite, { schema })

    // Create tables
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

    // Insert test noun
    sqlite.exec(`
      INSERT INTO nouns (noun, plural) VALUES ('Post', 'Posts')
    `)
  })

  afterEach(() => {
    sqlite.close()
  })

  // ============================================================================
  // INDEX NAME GENERATION
  // ============================================================================

  describe('getIndexName', () => {
    it('should generate valid index name for simple path', () => {
      const name = getIndexName('things', 'status')
      expect(name).toBe('idx_things_data_status')
    })

    it('should generate valid index name for nested path', () => {
      const name = getIndexName('things', 'config.enabled')
      expect(name).toBe('idx_things_data_config_enabled')
    })

    it('should generate valid index name for deeply nested path', () => {
      const name = getIndexName('things', 'settings.notifications.email')
      expect(name).toBe('idx_things_data_settings_notifications_email')
    })

    it('should include type filter in name when provided', () => {
      const name = getIndexName('things', 'status', 1)
      expect(name).toBe('idx_things_type1_data_status')
    })

    it('should work for relationships table', () => {
      const name = getIndexName('relationships', 'metadata.priority')
      expect(name).toBe('idx_relationships_data_metadata_priority')
    })
  })

  // ============================================================================
  // PATH VALIDATION
  // ============================================================================

  describe('validateIndexPath', () => {
    it('should accept valid simple path', () => {
      expect(() => validateIndexPath('status')).not.toThrow()
    })

    it('should accept valid nested path', () => {
      expect(() => validateIndexPath('config.enabled')).not.toThrow()
    })

    it('should accept valid deeply nested path', () => {
      expect(() => validateIndexPath('a.b.c.d.e')).not.toThrow()
    })

    it('should accept paths with underscores', () => {
      expect(() => validateIndexPath('user_id')).not.toThrow()
    })

    it('should accept paths with numbers', () => {
      expect(() => validateIndexPath('field1.subfield2')).not.toThrow()
    })

    it('should reject paths starting with dot', () => {
      expect(() => validateIndexPath('.status')).toThrow(/Invalid JSON path/)
    })

    it('should reject paths ending with dot', () => {
      expect(() => validateIndexPath('status.')).toThrow(/Invalid JSON path/)
    })

    it('should reject paths with consecutive dots', () => {
      expect(() => validateIndexPath('config..enabled')).toThrow(/Invalid JSON path/)
    })

    it('should reject paths with special characters', () => {
      expect(() => validateIndexPath('status;DROP TABLE')).toThrow(/Invalid JSON path/)
    })

    it('should reject paths with quotes', () => {
      expect(() => validateIndexPath("status'test")).toThrow(/Invalid JSON path/)
    })

    it('should reject empty paths', () => {
      expect(() => validateIndexPath('')).toThrow(/Invalid JSON path/)
    })
  })

  // ============================================================================
  // INDEX CREATION
  // ============================================================================

  describe('createJsonIndex', () => {
    it('should create index for simple path on things table', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'status',
      })

      // Verify index exists
      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: 'idx_things_data_status',
          path: 'status',
        })
      )
    })

    it('should create index for nested path', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'config.enabled',
      })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: 'idx_things_data_config_enabled',
          path: 'config.enabled',
        })
      )
    })

    it('should create partial index filtered by type', async () => {
      await createJsonIndex(db, {
        table: 'things',
        path: 'status',
        typeId: 1,
      })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: 'idx_things_type1_data_status',
          path: 'status',
          typeId: 1,
        })
      )
    })

    it('should be idempotent (IF NOT EXISTS)', async () => {
      // Create same index twice
      await createJsonIndex(db, { table: 'things', path: 'status' })
      await createJsonIndex(db, { table: 'things', path: 'status' })

      const indexes = await listJsonIndexes(db, 'things')
      const statusIndexes = indexes.filter((i) => i.path === 'status')
      expect(statusIndexes).toHaveLength(1)
    })

    it('should create index on relationships table', async () => {
      await createJsonIndex(db, {
        table: 'relationships',
        path: 'metadata.weight',
      })

      const indexes = await listJsonIndexes(db, 'relationships')
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: 'idx_relationships_data_metadata_weight',
          path: 'metadata.weight',
        })
      )
    })

    it('should throw on invalid path', async () => {
      await expect(
        createJsonIndex(db, { table: 'things', path: '; DROP TABLE things' })
      ).rejects.toThrow(/Invalid JSON path/)
    })

    it('should throw on invalid table', async () => {
      await expect(
        createJsonIndex(db, { table: 'invalid_table' as any, path: 'status' })
      ).rejects.toThrow(/Invalid table/)
    })
  })

  // ============================================================================
  // INDEX DROPPING
  // ============================================================================

  describe('dropJsonIndex', () => {
    it('should drop existing index', async () => {
      await createJsonIndex(db, { table: 'things', path: 'status' })

      let indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(1)

      await dropJsonIndex(db, { table: 'things', path: 'status' })

      indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(0)
    })

    it('should be idempotent (no error if index does not exist)', async () => {
      await expect(
        dropJsonIndex(db, { table: 'things', path: 'nonexistent' })
      ).resolves.not.toThrow()
    })

    it('should drop type-specific index', async () => {
      await createJsonIndex(db, { table: 'things', path: 'status', typeId: 1 })

      await dropJsonIndex(db, { table: 'things', path: 'status', typeId: 1 })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(0)
    })
  })

  // ============================================================================
  // LISTING INDEXES
  // ============================================================================

  describe('listJsonIndexes', () => {
    it('should return empty array when no JSON indexes exist', async () => {
      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toEqual([])
    })

    it('should list all JSON indexes on a table', async () => {
      await createJsonIndex(db, { table: 'things', path: 'status' })
      await createJsonIndex(db, { table: 'things', path: 'category' })
      await createJsonIndex(db, { table: 'things', path: 'priority', typeId: 1 })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(3)
      expect(indexes.map((i) => i.path).sort()).toEqual(['category', 'priority', 'status'])
    })

    it('should not include non-JSON indexes', async () => {
      // Built-in indexes exist on things table
      const indexes = await listJsonIndexes(db, 'things')
      // Should only return JSON path indexes (idx_*_data_*)
      expect(indexes.every((i) => i.name.includes('_data_'))).toBe(true)
    })
  })

  // ============================================================================
  // NOUN SYNC
  // ============================================================================

  describe('syncNounIndexes', () => {
    it('should create indexes for all indexed fields in noun schema', async () => {
      const nounSchema = {
        status: { type: 'string', index: true },
        title: { type: 'string' }, // not indexed
        publishedAt: { type: 'date', index: true },
      }

      await syncNounIndexes(db, {
        nounName: 'Post',
        typeId: 1,
        schema: nounSchema,
      })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(2)
      expect(indexes.map((i) => i.path).sort()).toEqual(['publishedAt', 'status'])
    })

    it('should create indexes for nested indexed fields', async () => {
      const nounSchema = {
        'config.enabled': { type: 'boolean', index: true },
        'settings.notifications.email': { type: 'boolean', index: true },
      }

      await syncNounIndexes(db, {
        nounName: 'Post',
        typeId: 1,
        schema: nounSchema,
      })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(2)
    })

    it('should be idempotent on repeated calls', async () => {
      const nounSchema = {
        status: { type: 'string', index: true },
      }

      await syncNounIndexes(db, { nounName: 'Post', typeId: 1, schema: nounSchema })
      await syncNounIndexes(db, { nounName: 'Post', typeId: 1, schema: nounSchema })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(1)
    })

    it('should drop indexes for fields no longer marked as indexed', async () => {
      // First sync with indexed field
      await syncNounIndexes(db, {
        nounName: 'Post',
        typeId: 1,
        schema: {
          status: { type: 'string', index: true },
          category: { type: 'string', index: true },
        },
      })

      let indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(2)

      // Second sync with one field no longer indexed
      await syncNounIndexes(db, {
        nounName: 'Post',
        typeId: 1,
        schema: {
          status: { type: 'string', index: true },
          category: { type: 'string' }, // no longer indexed
        },
      })

      indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(1)
      expect(indexes[0].path).toBe('status')
    })

    it('should handle shorthand string definitions with # prefix', async () => {
      // Support: { status: '#string' } syntax (hash = indexed)
      const nounSchema = {
        status: '#string',
        title: 'string',
      }

      await syncNounIndexes(db, {
        nounName: 'Post',
        typeId: 1,
        schema: nounSchema,
      })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(1)
      expect(indexes[0].path).toBe('status')
    })
  })

  // ============================================================================
  // QUERY PLAN VERIFICATION
  // ============================================================================

  describe('Query Plan Optimization', () => {
    beforeEach(async () => {
      // Insert test data
      for (let i = 0; i < 100; i++) {
        sqlite.exec(`
          INSERT INTO things (id, type, data)
          VALUES ('thing-${i}', 1, '{"status": "${i % 2 === 0 ? 'published' : 'draft'}", "priority": ${i}}')
        `)
      }
    })

    it('should use index for json_extract queries (EXPLAIN QUERY PLAN)', async () => {
      // Create index
      await createJsonIndex(db, { table: 'things', path: 'status', typeId: 1 })

      // Get query plan
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE type = 1 AND json_extract(data, '$.status') = 'published'`
        )
        .all()

      // Should show index usage
      const planStr = JSON.stringify(plan)
      expect(planStr).toMatch(/idx_things_type1_data_status|USING INDEX/)
    })

    it('should not use index when no matching index exists', async () => {
      // Query without index
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE json_extract(data, '$.nonexistent') = 'value'`
        )
        .all()

      // Should show table scan
      const planStr = JSON.stringify(plan)
      expect(planStr).toMatch(/SCAN|SEARCH things/)
    })

    it('should use composite index with type filter', async () => {
      // Create type-specific index
      await createJsonIndex(db, { table: 'things', path: 'priority', typeId: 1 })

      // This query should use the partial index
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM things WHERE type = 1 AND json_extract(data, '$.priority') > 50`
        )
        .all()

      const planStr = JSON.stringify(plan)
      // The index should be considered by the query planner
      expect(planStr).toMatch(/idx_things_type1_data_priority|USING INDEX/)
    })
  })

  // ============================================================================
  // TYPE DEFINITION INTEGRATION
  // ============================================================================

  describe('FieldDefinition index option', () => {
    it('should support index: true in FieldDefinition', () => {
      // This tests the type definition - if this compiles, the test passes
      const field: import('../../types/Noun').FieldDefinition = {
        type: 'string',
        index: true,
      }
      expect(field.index).toBe(true)
    })

    it('should support index with other options', () => {
      const field: import('../../types/Noun').FieldDefinition = {
        type: 'date',
        index: true,
        required: true,
        description: 'When the post was published',
      }
      expect(field.index).toBe(true)
      expect(field.required).toBe(true)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle array values in JSON data', async () => {
      sqlite.exec(`
        INSERT INTO things (id, type, data)
        VALUES ('array-test', 1, '{"tags": ["a", "b", "c"]}')
      `)

      // Create index on array field (limited usefulness but should not error)
      await createJsonIndex(db, { table: 'things', path: 'tags' })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(1)
    })

    it('should handle null values in indexed field', async () => {
      sqlite.exec(`
        INSERT INTO things (id, type, data)
        VALUES ('null-test', 1, '{"status": null}')
      `)

      await createJsonIndex(db, { table: 'things', path: 'status' })

      // Query should work
      const result = sqlite
        .prepare(`SELECT * FROM things WHERE json_extract(data, '$.status') IS NULL`)
        .all()
      expect(result).toHaveLength(1)
    })

    it('should handle missing field in JSON data', async () => {
      sqlite.exec(`
        INSERT INTO things (id, type, data)
        VALUES ('missing-test', 1, '{"other": "value"}')
      `)

      await createJsonIndex(db, { table: 'things', path: 'status' })

      // Query should work (returns null for missing)
      const result = sqlite
        .prepare(`SELECT * FROM things WHERE json_extract(data, '$.status') IS NULL`)
        .all()
      expect(result).toHaveLength(1)
    })

    it('should handle deeply nested paths (5+ levels)', async () => {
      const path = 'a.b.c.d.e.f'
      await createJsonIndex(db, { table: 'things', path })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes[0].path).toBe(path)
    })

    it('should handle unicode field names', async () => {
      // Note: This may not be supported - test documents the behavior
      await expect(
        createJsonIndex(db, { table: 'things', path: 'field_日本語' })
      ).rejects.toThrow(/Invalid JSON path/)
    })

    it('should handle paths with numbers in field names', async () => {
      await createJsonIndex(db, { table: 'things', path: 'field1.subfield2' })

      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes[0].path).toBe('field1.subfield2')
    })
  })

  // ============================================================================
  // RELATIONSHIPS TABLE
  // ============================================================================

  describe('Relationships JSON Indexing', () => {
    it('should create index on relationships data column', async () => {
      await createJsonIndex(db, {
        table: 'relationships',
        path: 'weight',
      })

      const indexes = await listJsonIndexes(db, 'relationships')
      expect(indexes).toHaveLength(1)
      expect(indexes[0].name).toBe('idx_relationships_data_weight')
    })

    it('should support verb-filtered partial indexes on relationships', async () => {
      await createJsonIndex(db, {
        table: 'relationships',
        path: 'priority',
        verbFilter: 'manages',
      })

      const indexes = await listJsonIndexes(db, 'relationships')
      expect(indexes).toContainEqual(
        expect.objectContaining({
          path: 'priority',
          verbFilter: 'manages',
        })
      )
    })
  })

  // ============================================================================
  // MIGRATION UTILITIES
  // ============================================================================

  describe('Migration Utilities', () => {
    it('should support building indexes in batch for existing data', async () => {
      // Insert existing data
      for (let i = 0; i < 50; i++) {
        sqlite.exec(`
          INSERT INTO things (id, type, data)
          VALUES ('thing-${i}', 1, '{"status": "published"}')
        `)
      }

      // Create index on existing data
      await createJsonIndex(db, { table: 'things', path: 'status' })

      // Verify index exists and is usable
      const indexes = await listJsonIndexes(db, 'things')
      expect(indexes).toHaveLength(1)

      // Query should work
      const result = sqlite
        .prepare(`SELECT COUNT(*) as count FROM things WHERE json_extract(data, '$.status') = 'published'`)
        .get() as { count: number }
      expect(result.count).toBe(50)
    })
  })
})
