import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  buildWhere,
  buildSort,
  buildFieldCondition,
  toJsonPath,
  validateFieldPath,
  getFieldRef,
  createFieldRefCache,
  QueryBuilderError,
  type WhereClause,
  type QueryTable,
} from '../../src/adapter/query-builder'
import { things } from '../../../things'

/**
 * Query Builder Tests
 *
 * Tests for translating Payload CMS where clauses to Drizzle ORM queries.
 * This is the core query building functionality for the Payload database adapter.
 *
 * Payload uses a MongoDB-like query syntax:
 * - { field: { equals: value } }
 * - { field: { not_equals: value } }
 * - { field: { in: [values] } }
 * - { and: [...conditions] }
 * - { or: [...conditions] }
 *
 * These need to be translated to Drizzle ORM SQL expressions that work with
 * SQLite's json_extract for accessing data stored in JSON columns.
 *
 * @see dotdo-gl18 - A07 RED: Query builder tests
 */

// ============================================================================
// MOCK TABLE FOR TESTING
// ============================================================================

/** Mock table with data column for testing json_extract fallback */
const mockTable: QueryTable = {
  data: sql`data`,
  name: sql`name`,
  visibility: sql`visibility`,
  type: sql`type`,
}

// ============================================================================
// WHERE CLAUSE TRANSLATION TESTS
// ============================================================================

describe('Query Builder', () => {
  describe('buildWhere', () => {
    // -------------------------------------------------------------------------
    // EQUALS OPERATOR
    // -------------------------------------------------------------------------

    it('should translate equals operator', () => {
      const where: WhereClause = { status: { equals: 'published' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // SQL output should contain the equals condition
      const sqlStr = result?.getSQL()
      expect(sqlStr).toBeDefined()
    })

    it('should translate equals for boolean values', () => {
      const where: WhereClause = { featured: { equals: true } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should translate equals for null values', () => {
      const where: WhereClause = { deletedAt: { equals: null } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should produce IS NULL condition
    })

    // -------------------------------------------------------------------------
    // NOT_EQUALS OPERATOR
    // -------------------------------------------------------------------------

    it('should translate not_equals operator', () => {
      const where: WhereClause = { status: { not_equals: 'draft' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should translate not_equals for null values', () => {
      const where: WhereClause = { deletedAt: { not_equals: null } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should produce IS NOT NULL condition
    })

    // -------------------------------------------------------------------------
    // IN OPERATOR
    // -------------------------------------------------------------------------

    it('should translate in operator', () => {
      const where: WhereClause = { status: { in: ['published', 'archived'] } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should handle empty in array', () => {
      const where: WhereClause = { status: { in: [] } }
      const result = buildWhere(where, mockTable)

      // Empty IN should return a false condition (1 = 0)
      expect(result).toBeDefined()
    })

    // -------------------------------------------------------------------------
    // NOT_IN OPERATOR
    // -------------------------------------------------------------------------

    it('should translate not_in operator', () => {
      const where: WhereClause = { status: { not_in: ['draft', 'pending'] } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    // -------------------------------------------------------------------------
    // COMPARISON OPERATORS
    // -------------------------------------------------------------------------

    it('should translate greater_than operator', () => {
      const where: WhereClause = { price: { greater_than: 100 } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should translate greater_than_equal operator', () => {
      const where: WhereClause = { views: { greater_than_equal: 1000 } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should translate less_than operator', () => {
      const where: WhereClause = { stock: { less_than: 10 } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should translate less_than_equal operator', () => {
      const where: WhereClause = { rating: { less_than_equal: 3.5 } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    // -------------------------------------------------------------------------
    // STRING PATTERN OPERATORS
    // -------------------------------------------------------------------------

    it('should translate like operator with wildcards', () => {
      const where: WhereClause = { title: { like: '%introduction%' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should translate like with case insensitive option', () => {
      // Note: Case insensitive is handled at the application level
      // SQLite LIKE is case-insensitive for ASCII by default
      const where: WhereClause = { title: { like: '%HELLO%' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should translate contains operator', () => {
      const where: WhereClause = { description: { contains: 'important' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Contains should wrap with % wildcards
    })

    // -------------------------------------------------------------------------
    // EXISTS OPERATOR
    // -------------------------------------------------------------------------

    it('should translate exists operator for true', () => {
      const where: WhereClause = { metadata: { exists: true } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should produce IS NOT NULL
    })

    it('should translate exists operator for false', () => {
      const where: WhereClause = { metadata: { exists: false } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should produce IS NULL
    })

    // -------------------------------------------------------------------------
    // MULTIPLE OPERATORS ON SAME FIELD
    // -------------------------------------------------------------------------

    it('should combine multiple operators on same field', () => {
      const where: WhereClause = { price: { greater_than: 10, less_than: 100 } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should produce AND of both conditions
    })
  })

  // ============================================================================
  // NESTED FIELD ACCESS TESTS
  // ============================================================================

  describe('nested field access', () => {
    it('should access nested fields via json_extract', () => {
      const where: WhereClause = { 'meta.featured': { equals: true } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should handle deeply nested paths', () => {
      const where: WhereClause = { 'settings.display.theme.mode': { equals: 'dark' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should handle array index access', () => {
      // Test toJsonPath directly
      const jsonPath = toJsonPath('tags.0')
      expect(jsonPath).toBe('$.tags[0]')

      const where: WhereClause = { 'tags.0': { equals: 'featured' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should handle mixed object and array paths', () => {
      const jsonPath = toJsonPath('blocks.0.content.text')
      expect(jsonPath).toBe('$.blocks[0].content.text')

      const where: WhereClause = { 'blocks.0.content.text': { contains: 'hello' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should validate field path format', () => {
      // Empty path
      expect(() => validateFieldPath('')).toThrow('Field path cannot be empty')

      // Leading dot
      expect(() => validateFieldPath('.invalid')).toThrow('Field path cannot start with a dot')

      // Double dots
      expect(() => validateFieldPath('path..nested')).toThrow('Field path cannot contain consecutive dots')

      // Valid paths should not throw
      expect(() => validateFieldPath('valid')).not.toThrow()
      expect(() => validateFieldPath('valid.nested')).not.toThrow()
      expect(() => validateFieldPath('valid.0.nested')).not.toThrow()
    })
  })

  // ============================================================================
  // LOGICAL OPERATORS TESTS
  // ============================================================================

  describe('logical operators', () => {
    it('should combine with AND', () => {
      const where: WhereClause = {
        and: [
          { status: { equals: 'published' } },
          { featured: { equals: true } },
        ],
      }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should combine with OR', () => {
      const where: WhereClause = {
        or: [
          { status: { equals: 'published' } },
          { status: { equals: 'featured' } },
        ],
      }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should handle nested AND/OR', () => {
      const where: WhereClause = {
        and: [
          { type: { equals: 'post' } },
          {
            or: [
              { status: { equals: 'published' } },
              { featured: { equals: true } },
            ],
          },
        ],
      }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should handle deeply nested logical operators', () => {
      const where: WhereClause = {
        and: [
          { type: { equals: 'post' } },
          {
            or: [
              { status: { equals: 'published' } },
              {
                and: [
                  { featured: { equals: true } },
                  { priority: { greater_than: 5 } },
                ],
              },
            ],
          },
        ],
      }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should implicitly AND multiple top-level field conditions', () => {
      const where: WhereClause = {
        status: { equals: 'published' },
        featured: { equals: true },
      }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Both conditions should be ANDed together
    })

    it('should handle empty AND array', () => {
      const where: WhereClause = { and: [] }
      const result = buildWhere(where, mockTable)

      // Empty AND is always true - should return undefined (match all)
      expect(result).toBeUndefined()
    })

    it('should handle empty OR array', () => {
      const where: WhereClause = { or: [] }
      const result = buildWhere(where, mockTable)

      // Empty OR is always false - should return a condition
      expect(result).toBeDefined()
    })
  })

  // ============================================================================
  // SORTING TESTS
  // ============================================================================

  describe('sorting', () => {
    it('should build ascending sort', () => {
      const result = buildSort('createdAt', mockTable)

      expect(result).toBeDefined()
    })

    it('should build descending sort with - prefix', () => {
      const result = buildSort('-createdAt', mockTable)

      expect(result).toBeDefined()
    })

    it('should handle multiple sort fields', () => {
      const result = buildSort(['status', '-createdAt'], mockTable)

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
      expect((result as unknown[]).length).toBe(2)
    })

    it('should sort by nested JSON field', () => {
      const result = buildSort('meta.priority', mockTable)

      expect(result).toBeDefined()
    })

    it('should sort descending by nested JSON field', () => {
      const result = buildSort('-meta.priority', mockTable)

      expect(result).toBeDefined()
    })

    it('should handle sort with numeric type casting', () => {
      // Note: Type casting for numeric sorts is handled at the application level
      // This test verifies the sort clause is generated
      const result = buildSort('price', mockTable)

      expect(result).toBeDefined()
    })
  })

  // ============================================================================
  // TOP-LEVEL FIELD OPTIMIZATION TESTS
  // ============================================================================

  describe('top-level field optimization', () => {
    it('should use direct column access for indexed fields', () => {
      // When the table has a 'name' column, it should use it directly
      const where: WhereClause = { name: { equals: 'Test' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should use direct column reference
    })

    it('should use direct column for visibility field', () => {
      const where: WhereClause = { visibility: { equals: 'public' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should use direct column for type field', () => {
      const where: WhereClause = { type: { equals: 123 } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should fall back to json_extract for data fields', () => {
      const where: WhereClause = { customField: { equals: 'value' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should use json_extract since customField is not in the table
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('edge cases and error handling', () => {
    it('should handle empty where clause', () => {
      const result = buildWhere({}, mockTable)

      expect(result).toBeUndefined()
    })

    it('should handle undefined where clause', () => {
      const result = buildWhere(undefined, mockTable)

      expect(result).toBeUndefined()
    })

    it('should throw on unknown operator', () => {
      const where = { status: { unknown_op: 'value' } } as unknown as WhereClause

      expect(() => buildWhere(where, mockTable)).toThrow('Unknown operator: unknown_op')
    })

    it('should handle special characters in values', () => {
      const where: WhereClause = { title: { equals: "Test's \"quoted\" value" } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Drizzle handles SQL escaping internally
    })

    it('should handle unicode in field values', () => {
      const where: WhereClause = { name: { equals: '日本語テスト' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should handle very long field paths', () => {
      const where: WhereClause = { 'a.b.c.d.e.f.g.h.i.j': { equals: 'deep' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()

      // Also test toJsonPath
      const jsonPath = toJsonPath('a.b.c.d.e.f.g.h.i.j')
      expect(jsonPath).toBe('$.a.b.c.d.e.f.g.h.i.j')
    })

    it('should handle numeric string comparison', () => {
      const where: WhereClause = { code: { equals: '001' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should compare as string
    })
  })

  // ============================================================================
  // DATE HANDLING TESTS
  // ============================================================================

  describe('date handling', () => {
    it('should compare date strings', () => {
      const where: WhereClause = { createdAt: { greater_than: '2024-01-01T00:00:00Z' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should handle date range queries', () => {
      const where: WhereClause = {
        createdAt: {
          greater_than_equal: '2024-01-01',
          less_than: '2024-02-01',
        },
      }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Should produce AND of both conditions
    })

    it('should compare dates stored in JSON', () => {
      const where: WhereClause = { 'meta.publishedAt': { greater_than: '2024-01-01' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })
  })

  // ============================================================================
  // RELATIONSHIP FIELD TESTS
  // ============================================================================

  describe('relationship fields', () => {
    it('should query by relationship ID', () => {
      const where: WhereClause = { author: { equals: 'user-123' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
    })

    it('should query by relationship in array', () => {
      const where: WhereClause = { categories: { contains: 'category-1' } }
      const result = buildWhere(where, mockTable)

      expect(result).toBeDefined()
      // Contains uses LIKE with wildcards
    })
  })

  // ============================================================================
  // JSON PATH CONVERSION TESTS
  // ============================================================================

  describe('toJsonPath', () => {
    it('should convert simple field names', () => {
      expect(toJsonPath('status')).toBe('$.status')
      expect(toJsonPath('name')).toBe('$.name')
    })

    it('should convert nested object paths', () => {
      expect(toJsonPath('meta.featured')).toBe('$.meta.featured')
      expect(toJsonPath('settings.display.theme')).toBe('$.settings.display.theme')
    })

    it('should convert array indices', () => {
      expect(toJsonPath('tags.0')).toBe('$.tags[0]')
      expect(toJsonPath('items.5')).toBe('$.items[5]')
    })

    it('should convert mixed paths', () => {
      expect(toJsonPath('blocks.0.content')).toBe('$.blocks[0].content')
      expect(toJsonPath('data.items.0.name')).toBe('$.data.items[0].name')
      expect(toJsonPath('a.0.b.1.c')).toBe('$.a[0].b[1].c')
    })
  })

  // ============================================================================
  // FIELD REF TESTS
  // ============================================================================

  describe('getFieldRef', () => {
    it('should use direct column for known fields', () => {
      const ref = getFieldRef('name', mockTable)
      expect(ref).toBeDefined()
    })

    it('should use json_extract for unknown fields', () => {
      const ref = getFieldRef('unknownField', mockTable)
      expect(ref).toBeDefined()
    })

    it('should use json_extract for nested fields', () => {
      const ref = getFieldRef('meta.featured', mockTable)
      expect(ref).toBeDefined()
    })
  })

  // ============================================================================
  // FIELD REFERENCE CACHE TESTS
  // ============================================================================

  describe('createFieldRefCache', () => {
    it('should create a reusable cache instance', () => {
      const cache = createFieldRefCache()
      expect(cache).toBeDefined()
      expect(cache.size).toBe(0)
    })

    it('should cache field references across multiple calls', () => {
      const cache = createFieldRefCache()

      // First call should populate cache
      const ref1 = cache.get('meta.featured', mockTable)
      expect(ref1).toBeDefined()
      expect(cache.size).toBe(1)

      // Second call should return cached value
      const ref2 = cache.get('meta.featured', mockTable)
      expect(ref2).toBeDefined()
      expect(cache.size).toBe(1) // Still 1, not 2

      // Same reference should be returned
      expect(ref1).toBe(ref2)
    })

    it('should cache different fields separately', () => {
      const cache = createFieldRefCache()

      cache.get('name', mockTable)
      cache.get('status', mockTable)
      cache.get('meta.featured', mockTable)

      expect(cache.size).toBe(3)
    })

    it('should allow clearing the cache', () => {
      const cache = createFieldRefCache()

      cache.get('name', mockTable)
      cache.get('status', mockTable)
      expect(cache.size).toBe(2)

      cache.clear()
      expect(cache.size).toBe(0)
    })

    it('should work with buildWhere options', () => {
      const cache = createFieldRefCache()

      const where1: WhereClause = { status: { equals: 'published' } }
      const where2: WhereClause = { status: { equals: 'draft' } }

      // Both queries use the same field, cache should be reused
      buildWhere(where1, mockTable, { cache })
      expect(cache.size).toBe(1)

      buildWhere(where2, mockTable, { cache })
      expect(cache.size).toBe(1) // Same field, still 1
    })

    it('should work with buildSort', () => {
      const cache = createFieldRefCache()

      buildSort('createdAt', mockTable, cache)
      buildSort('-createdAt', mockTable, cache)

      // Same field used twice, should only cache once
      expect(cache.size).toBe(1)
    })
  })

  // ============================================================================
  // QUERY BUILDER ERROR TESTS
  // ============================================================================

  describe('QueryBuilderError', () => {
    it('should create error with field information', () => {
      const error = new QueryBuilderError('Invalid operator', 'status', 'unknown_op')

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(QueryBuilderError)
      expect(error.name).toBe('QueryBuilderError')
      expect(error.field).toBe('status')
      expect(error.operator).toBe('unknown_op')
      expect(error.message).toContain('Invalid operator')
      expect(error.message).toContain('Field: status')
      expect(error.message).toContain('Operator: unknown_op')
    })

    it('should include hint when provided', () => {
      const error = new QueryBuilderError(
        'Invalid operator',
        'status',
        'unknown_op',
        'Use equals, not_equals, in, etc.'
      )

      expect(error.hint).toBe('Use equals, not_equals, in, etc.')
      expect(error.message).toContain('Hint: Use equals, not_equals, in, etc.')
    })

    it('should work without operator', () => {
      const error = new QueryBuilderError('Field validation failed', 'meta.invalid')

      expect(error.field).toBe('meta.invalid')
      expect(error.operator).toBeUndefined()
      expect(error.message).toContain('Field: meta.invalid')
      expect(error.message).not.toContain('Operator:')
    })

    it('should be thrown for unknown operators', () => {
      const where = { status: { unknown_op: 'value' } } as unknown as WhereClause

      try {
        buildWhere(where, mockTable)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(QueryBuilderError)
        if (error instanceof QueryBuilderError) {
          expect(error.field).toBe('status')
          expect(error.operator).toBe('unknown_op')
          expect(error.hint).toContain('Valid operators are:')
        }
      }
    })

    it('should provide helpful error for invalid in operator value', () => {
      const where = { status: { in: 'not-an-array' } } as unknown as WhereClause

      try {
        buildWhere(where, mockTable)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(QueryBuilderError)
        if (error instanceof QueryBuilderError) {
          expect(error.field).toBe('status')
          expect(error.operator).toBe('in')
          expect(error.message).toContain('requires an array value')
        }
      }
    })
  })
})
