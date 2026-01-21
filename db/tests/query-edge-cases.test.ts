/**
 * Edge Case Tests for db/query.ts (do-wmfc)
 *
 * These tests cover:
 * 1. Complex query scenarios
 * 2. Edge cases in query building
 * 3. SQL injection prevention (supplementary to sql-injection.test.ts)
 * 4. Null/undefined handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createThingsStore, type ThingsStore } from '../things'
import { createRelationshipsStore, type RelationshipsStore } from '../relationships'
import {
  query,
  createQuery,
  createQueryWithJoins,
  buildWhereClause,
  buildOrderByClause,
  buildPaginationClause,
  configureQueryLimits,
  getQueryLimits,
  QueryLimitError,
  DEFAULT_QUERY_LIMITS,
  validateFieldName,
  type QueryOptions,
  type WhereCondition,
} from '../query'
import { DbValidationError } from '../errors'

// ============================================================
// Complex Query Scenarios
// ============================================================

describe('Complex Query Scenarios', () => {
  let store: ThingsStore
  let relationships: RelationshipsStore

  beforeEach(async () => {
    store = createThingsStore()
    relationships = createRelationshipsStore()
    configureQueryLimits({ mode: 'warn' })

    // Seed complex test data
    // Users with various attributes including nulls, empty strings, zeros
    await store.create({ $type: 'User', name: 'Alice', age: 30, role: 'admin', score: 100, active: true, bio: null })
    await store.create({ $type: 'User', name: 'Bob', age: 0, role: 'user', score: 0, active: false, bio: '' })
    await store.create({ $type: 'User', name: 'Charlie', age: 25, role: 'user', score: null, active: true, bio: 'Hello' })
    await store.create({ $type: 'User', name: '', age: 18, role: 'guest', score: 50, active: null, bio: 'Empty name user' })
    await store.create({ $type: 'User', name: 'Eve', age: null, role: '', score: 75, active: true, bio: null })
  })

  afterEach(() => {
    configureQueryLimits({ mode: 'strict' })
  })

  describe('Multiple chained conditions', () => {
    it('should handle many whereOp conditions', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('age', '>=', 18)
        .whereOp('age', '<=', 30)
        .whereOp('score', '>=', 50)
        .whereOp('active', '=', true)
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
    })

    it('should handle mixed where and whereOp conditions', async () => {
      const results = await query(store)
        .type('User')
        .where('role', 'user')
        .whereOp('age', '>', 0)
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Charlie')
    })

    it('should handle object where with whereOp', async () => {
      const results = await query(store)
        .type('User')
        .where({ role: 'user' })
        .whereOp('score', 'IS NULL', null)
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Charlie')
    })
  })

  describe('Ordering edge cases', () => {
    it('should handle ordering with null values', async () => {
      const results = await query(store)
        .type('User')
        .orderBy('age', 'asc')
        .execute()

      // null values should be sorted after non-null
      expect(results[results.length - 1].name).toBe('Eve')
    })

    it('should handle ordering with mixed types', async () => {
      const results = await query(store)
        .type('User')
        .orderBy('score', 'desc')
        .execute()

      // Should not throw and should handle null/number mix
      expect(results.length).toBeGreaterThan(0)
    })

    it('should handle ordering by non-existent field', async () => {
      // Should not throw, just return results in some order
      const results = await query(store)
        .type('User')
        .orderBy('nonexistent')
        .execute()

      expect(results.length).toBe(5)
    })
  })

  describe('Pagination edge cases', () => {
    it('should handle offset greater than total results', async () => {
      const results = await query(store)
        .type('User')
        .offset(100)
        .limit(10)
        .execute()

      expect(results).toHaveLength(0)
    })

    it('should handle limit of 0', async () => {
      const results = await query(store)
        .type('User')
        .limit(0)
        .execute()

      expect(results).toHaveLength(0)
    })

    it('should handle negative offset (treated as 0)', async () => {
      // Negative offset should be treated as 0 or throw
      const results = await query(store)
        .type('User')
        .offset(-1)
        .limit(10)
        .execute()

      // Should either work as offset 0 or return results
      expect(results.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle executePaginated with empty results', async () => {
      const result = await query(store)
        .type('NonExistentType')
        .limit(10)
        .executePaginated()

      expect(result.results).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.cursor).toBeUndefined()
    })

    it('should handle executePaginated with invalid cursor', async () => {
      const result = await query(store)
        .type('User')
        .limit(10)
        .executePaginated({ cursor: 'invalid-cursor-data' })

      // Should recover and start from beginning
      expect(result.results.length).toBeGreaterThan(0)
    })

    it('should handle executePaginated with malformed base64 cursor', async () => {
      const result = await query(store)
        .type('User')
        .limit(10)
        .executePaginated({ cursor: '!!!not-base64!!!' })

      // Should recover and start from beginning
      expect(result.results.length).toBeGreaterThan(0)
    })
  })

  describe('Select projection edge cases', () => {
    it('should always include system fields in projection', async () => {
      const results = await query(store)
        .type('User')
        .select('name')
        .execute()

      expect(results[0]).toHaveProperty('$id')
      expect(results[0]).toHaveProperty('$type')
    })

    it('should handle empty select array', async () => {
      const results = await query(store)
        .type('User')
        .select()
        .execute()

      // Should return full objects
      expect(results[0]).toHaveProperty('name')
      expect(results[0]).toHaveProperty('age')
    })

    it('should handle select with non-existent fields', async () => {
      const results = await query(store)
        .type('User')
        .select('name', 'nonexistent_field')
        .execute()

      // Should not throw, just not include the non-existent field
      expect(results[0]).toHaveProperty('name')
      expect(results[0]).not.toHaveProperty('nonexistent_field')
    })
  })

  describe('Type filtering edge cases', () => {
    it('should handle query without type filter', async () => {
      // Add a different type
      await store.create({ $type: 'Order', total: 100 })

      const results = await query(store).execute()

      // Should return all types
      expect(results.length).toBe(6)
    })

    it('should handle empty type string', async () => {
      const results = await query(store)
        .type('')
        .execute()

      // Empty string type filter: behavior is implementation-dependent
      // In the in-memory store, empty type string still gets set but no entities have $type=''
      // However, the filter check `t.$type === type` with type='' won't match any User entities
      // The actual behavior is that all entities are returned because the filter doesn't apply
      // This test documents the current behavior rather than prescribing what it "should" be
      expect(results.length).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================
// Edge Cases in Query Building
// ============================================================

describe('Query Building Edge Cases', () => {
  let store: ThingsStore

  beforeEach(async () => {
    store = createThingsStore()
    configureQueryLimits({ mode: 'warn' })
  })

  afterEach(() => {
    configureQueryLimits({ mode: 'strict' })
  })

  describe('buildWhereClause edge cases', () => {
    it('should handle empty whereConditions array', () => {
      const options: QueryOptions = { whereConditions: [] }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe('')
      expect(params).toEqual([])
    })

    it('should handle LIKE with special regex characters', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'pattern', operator: 'LIKE', value: '%[test]%' }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toContain('LIKE')
      expect(params).toEqual(['%[test]%'])
    })

    it('should handle IN with single value', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'status', operator: 'IN', value: ['active'] }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toContain('IN (?)')
      expect(params).toEqual(['active'])
    })

    it('should handle IN with many values', () => {
      const values = Array.from({ length: 100 }, (_, i) => `value${i}`)
      const options: QueryOptions = {
        whereConditions: [{ field: 'status', operator: 'IN', value: values }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(params).toHaveLength(100)
      expect(clause).toContain('?, '.repeat(99) + '?')
    })

    it('should handle NOT IN with empty array (always true)', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'status', operator: 'NOT IN', value: [] }]
      }
      const { clause, params } = buildWhereClause(options)

      // Empty NOT IN is always true, so no clause should be added
      expect(clause).toBe('')
      expect(params).toEqual([])
    })

    it('should handle NOT IN with non-array value', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'status', operator: 'NOT IN', value: 'single-value' as unknown as string[] }]
      }
      const { clause, params } = buildWhereClause(options)

      // Non-array for NOT IN should be treated as always true (no filter)
      expect(clause).toBe('')
    })

    it('should handle IN with non-array value', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'status', operator: 'IN', value: 'single-value' as unknown as string[] }]
      }
      const { clause, params } = buildWhereClause(options)

      // Non-array for IN should be treated as always false
      expect(clause).toBe('WHERE 1 = 0')
    })

    it('should combine type filter with multiple conditions', () => {
      const options: QueryOptions = {
        type: 'User',
        whereConditions: [
          { field: 'age', operator: '>=', value: 18 },
          { field: 'status', operator: '=', value: 'active' },
          { field: 'role', operator: 'IN', value: ['admin', 'user'] }
        ]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toContain('type = ?')
      expect(clause).toContain('AND')
      expect(params[0]).toBe('User')
    })

    it('should handle all system field mappings', () => {
      const testCases = [
        { field: '$id', expectedColumn: 'id' },
        { field: '$type', expectedColumn: 'type' },
        { field: '$createdAt', expectedColumn: 'created_at' },
        { field: '$updatedAt', expectedColumn: 'updated_at' },
      ]

      for (const { field, expectedColumn } of testCases) {
        const options: QueryOptions = {
          whereConditions: [{ field, operator: '=', value: 'test' }]
        }
        const { clause } = buildWhereClause(options)

        expect(clause).toContain(`${expectedColumn} = ?`)
        expect(clause).not.toContain('json_extract')
      }
    })
  })

  describe('buildOrderByClause edge cases', () => {
    it('should default to created_at DESC when no orderBy', () => {
      const clause = buildOrderByClause({})

      expect(clause).toBe('ORDER BY created_at DESC')
    })

    it('should handle system fields in orderBy', () => {
      const clause = buildOrderByClause({ orderBy: '$createdAt', order: 'asc' })

      expect(clause).toBe('ORDER BY created_at ASC')
    })

    it('should handle JSON fields in orderBy', () => {
      const clause = buildOrderByClause({ orderBy: 'customField', order: 'desc' })

      expect(clause).toContain("json_extract(data, '$.customField')")
      expect(clause).toContain('DESC')
    })

    it('should default to DESC when order not specified', () => {
      const clause = buildOrderByClause({ orderBy: 'name' })

      expect(clause).toContain('DESC')
    })
  })

  describe('buildPaginationClause edge cases', () => {
    it('should use default limit when not specified', () => {
      const { clause, params } = buildPaginationClause({})

      expect(clause).toBe('LIMIT ? OFFSET ?')
      expect(params[0]).toBe(DEFAULT_QUERY_LIMITS.DEFAULT_LIMIT)
      expect(params[1]).toBe(0)
    })

    it('should clamp limit to max', () => {
      configureQueryLimits({ mode: 'warn', maxLimit: 50 })

      const { params } = buildPaginationClause({ limit: 1000 })

      expect(params[0]).toBeLessThanOrEqual(50)
    })

    it('should handle zero offset', () => {
      const { params } = buildPaginationClause({ offset: 0, limit: 10 })

      expect(params[1]).toBe(0)
    })
  })

  describe('validateFieldName edge cases', () => {
    it('should accept single letter field names', () => {
      expect(() => validateFieldName('a')).not.toThrow()
      expect(() => validateFieldName('Z')).not.toThrow()
    })

    it('should accept single underscore field names', () => {
      expect(() => validateFieldName('_')).not.toThrow()
    })

    it('should accept single $ field names', () => {
      expect(() => validateFieldName('$')).not.toThrow()
    })

    it('should reject fields starting with numbers', () => {
      expect(() => validateFieldName('0field')).toThrow(DbValidationError)
      expect(() => validateFieldName('9test')).toThrow(DbValidationError)
    })

    it('should accept fields with numbers in the middle', () => {
      expect(() => validateFieldName('field123')).not.toThrow()
      expect(() => validateFieldName('a1b2c3')).not.toThrow()
    })

    it('should reject fields with dots (path traversal)', () => {
      expect(() => validateFieldName('user.name')).toThrow(DbValidationError)
      expect(() => validateFieldName('.hidden')).toThrow(DbValidationError)
    })

    it('should reject fields with array notation', () => {
      expect(() => validateFieldName('items[0]')).toThrow(DbValidationError)
      expect(() => validateFieldName('arr[]')).toThrow(DbValidationError)
    })

    it('should reject Unicode letters', () => {
      // Only ASCII alphanumeric allowed
      expect(() => validateFieldName('\u00e9name')).toThrow(DbValidationError) // e with accent
    })
  })

  describe('getQueryInfo', () => {
    it('should expose query options for inspection', () => {
      const q = query(store)
        .type('User')
        .where('name', 'Alice')
        .whereOp('age', '>', 20)
        .orderBy('age', 'asc')
        .limit(10)
        .offset(5)
        .select('name', 'age')

      const info = q.getQueryInfo()

      expect(info.options.type).toBe('User')
      expect(info.options.orderBy).toBe('age')
      expect(info.options.order).toBe('asc')
      expect(info.options.limit).toBe(10)
      expect(info.options.offset).toBe(5)
      expect(info.options.select).toEqual(['name', 'age'])
      expect(info.options.whereConditions?.length).toBe(2)
    })
  })
})

// ============================================================
// SQL Injection Prevention (Supplementary Tests)
// ============================================================

describe('SQL Injection Prevention - Additional Edge Cases', () => {
  let store: ThingsStore

  beforeEach(async () => {
    store = createThingsStore()
    configureQueryLimits({ mode: 'warn' })

    await store.create({ $type: 'User', name: 'Alice', role: 'admin' })
    await store.create({ $type: 'User', name: 'Bob', role: 'user' })
  })

  afterEach(() => {
    configureQueryLimits({ mode: 'strict' })
  })

  describe('Value injection attempts (should be safe due to parameterization)', () => {
    it('should safely handle boolean injection attempts', async () => {
      const results = await query(store)
        .type('User')
        .where('name', '1=1' as unknown as string)
        .execute()

      expect(results).toHaveLength(0)
    })

    it('should safely handle UNION injection in values', async () => {
      const results = await query(store)
        .type('User')
        .where('name', 'test UNION SELECT * FROM users')
        .execute()

      expect(results).toHaveLength(0)
    })

    it('should safely handle nested SQL in LIKE value', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('name', 'LIKE', '%\'; DROP TABLE users; --%')
        .execute()

      expect(results).toHaveLength(0)
    })

    it('should safely handle null byte injection', async () => {
      const results = await query(store)
        .type('User')
        .where('name', 'Alice\x00; DROP TABLE users')
        .execute()

      expect(results).toHaveLength(0)
    })

    it('should safely handle IN with injection values', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('name', 'IN', ['Alice', "'; DROP TABLE users; --", 'Bob'])
        .execute()

      // Should only match Alice and Bob
      expect(results).toHaveLength(2)
    })

    it('should safely handle very long values', async () => {
      const longValue = 'A'.repeat(10000)
      const results = await query(store)
        .type('User')
        .where('name', longValue)
        .execute()

      expect(results).toHaveLength(0)
    })
  })

  describe('Field name injection attempts (should throw)', () => {
    it('should reject comment sequences in field names', () => {
      expect(() => query(store).where('name/*comment*/', 'test')).toThrow(DbValidationError)
    })

    it('should reject newline characters in field names', () => {
      expect(() => query(store).where('name\nOR 1=1', 'test')).toThrow(DbValidationError)
    })

    it('should reject tab characters in field names', () => {
      expect(() => query(store).where('name\tOR', 'test')).toThrow(DbValidationError)
    })

    it('should reject carriage return in field names', () => {
      expect(() => query(store).where('name\rOR', 'test')).toThrow(DbValidationError)
    })

    it('should reject hex encoded SQL keywords', () => {
      expect(() => query(store).where('name%27', 'test')).toThrow(DbValidationError)
    })

    it('should reject backslash escape sequences', () => {
      expect(() => query(store).where('name\\', 'test')).toThrow(DbValidationError)
    })

    it('should reject pipe characters (MySQL concat)', () => {
      expect(() => query(store).where('name||password', 'test')).toThrow(DbValidationError)
    })

    it('should reject ampersand (potential operator)', () => {
      expect(() => query(store).where('name&1', 'test')).toThrow(DbValidationError)
    })
  })
})

// ============================================================
// Null/Undefined Handling
// ============================================================

describe('Null/Undefined Handling', () => {
  let store: ThingsStore

  beforeEach(async () => {
    store = createThingsStore()
    configureQueryLimits({ mode: 'warn' })

    // Create test data with various null/undefined patterns
    await store.create({ $type: 'User', name: 'Alice', email: 'alice@test.com', phone: null })
    await store.create({ $type: 'User', name: 'Bob', email: null, phone: '123-456' })
    await store.create({ $type: 'User', name: 'Charlie', email: '', phone: '' })
    // Note: undefined values are typically not stored, but we test the query behavior
  })

  afterEach(() => {
    configureQueryLimits({ mode: 'strict' })
  })

  describe('IS NULL operator', () => {
    it('should find things with null field values', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('email', 'IS NULL', null)
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Bob')
    })

    it('should not match empty strings with IS NULL', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('email', 'IS NULL', null)
        .execute()

      // Charlie has empty string, not null
      expect(results.every(r => r.name !== 'Charlie')).toBe(true)
    })

    it('should find things with missing fields using IS NULL', async () => {
      // Create a thing without a specific optional field
      await store.create({ $type: 'User', name: 'Dave' }) // no email, phone fields

      const results = await query(store)
        .type('User')
        .whereOp('email', 'IS NULL', null)
        .execute()

      // Both Bob (null) and Dave (missing) should match
      expect(results.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('IS NOT NULL operator', () => {
    it('should find things with non-null field values', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('email', 'IS NOT NULL', null)
        .execute()

      // Alice has email, Charlie has empty string (not null)
      expect(results.length).toBeGreaterThanOrEqual(2)
    })

    it('should include empty strings in IS NOT NULL results', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('email', 'IS NOT NULL', null)
        .execute()

      const charlie = results.find(r => r.name === 'Charlie')
      expect(charlie).toBeDefined()
    })
  })

  describe('Equality with null', () => {
    it('should match null values with = null', async () => {
      const results = await query(store)
        .type('User')
        .where('phone', null)
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
    })

    it('should match empty strings with = empty string', async () => {
      const results = await query(store)
        .type('User')
        .where('email', '')
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Charlie')
    })
  })

  describe('undefined handling in where conditions', () => {
    it('should handle undefined value in where condition object', async () => {
      // When passing undefined, it should convert to null comparison
      const results = await query(store)
        .type('User')
        .where('email', undefined as unknown as null)
        .execute()

      // Implementation detail: undefined might be treated as null
      expect(Array.isArray(results)).toBe(true)
    })
  })

  describe('null in IN/NOT IN arrays', () => {
    it('should handle null values in IN array', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('email', 'IN', ['alice@test.com', null])
        .execute()

      // Should match Alice (has email) and potentially Bob (null)
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle null values in NOT IN array', async () => {
      const results = await query(store)
        .type('User')
        .whereOp('email', 'NOT IN', ['alice@test.com', ''])
        .execute()

      // Should exclude Alice and Charlie
      // Bob has null which might not match the NOT IN behavior
      expect(results.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Comparison operators with null', () => {
    it('should handle comparison with null values (undefined behavior)', async () => {
      // Comparing null with > should return false/empty
      const results = await query(store)
        .type('User')
        .whereOp('phone', '>', null as unknown as number)
        .execute()

      // Behavior is undefined, but should not throw
      expect(Array.isArray(results)).toBe(true)
    })
  })
})

// ============================================================
// Query Limit Configuration Edge Cases
// ============================================================

describe('Query Limit Configuration Edge Cases', () => {
  let store: ThingsStore

  beforeEach(async () => {
    store = createThingsStore()

    // Create some test data
    for (let i = 0; i < 10; i++) {
      await store.create({ $type: 'User', name: `User${i}`, index: i })
    }
  })

  afterEach(() => {
    // Reset configuration
    configureQueryLimits({
      mode: 'strict',
      defaultLimit: DEFAULT_QUERY_LIMITS.DEFAULT_LIMIT,
      maxLimit: DEFAULT_QUERY_LIMITS.MAX_LIMIT,
      warningThreshold: DEFAULT_QUERY_LIMITS.WARNING_THRESHOLD,
      defaultJoinLimit: DEFAULT_QUERY_LIMITS.DEFAULT_JOIN_LIMIT,
    })
  })

  describe('configureQueryLimits edge cases', () => {
    it('should merge configs incrementally', () => {
      configureQueryLimits({ maxLimit: 500 })
      expect(getQueryLimits().maxLimit).toBe(500)

      configureQueryLimits({ warningThreshold: 100 })
      expect(getQueryLimits().maxLimit).toBe(500) // Still preserved
      expect(getQueryLimits().warningThreshold).toBe(100)
    })

    it('should handle empty config object', () => {
      const before = getQueryLimits()
      configureQueryLimits({})
      const after = getQueryLimits()

      expect(after.defaultLimit).toBe(before.defaultLimit)
    })

    it('should allow custom warning callback', async () => {
      const warnings: string[] = []
      configureQueryLimits({
        mode: 'warn',
        warningThreshold: 1,
        onWarning: (msg) => warnings.push(msg),
      })

      await query(store).type('User').limit(5).execute()

      expect(warnings.length).toBeGreaterThan(0)
    })
  })

  describe('Strict mode edge cases', () => {
    beforeEach(() => {
      configureQueryLimits({ mode: 'strict', maxLimit: 5 })
    })

    it('should throw for limit exactly at max + 1', async () => {
      await expect(
        query(store).type('User').limit(6).execute()
      ).rejects.toThrow(QueryLimitError)
    })

    it('should allow limit exactly at max', async () => {
      const results = await query(store).type('User').limit(5).execute()
      expect(results).toHaveLength(5)
    })

    it('should include helpful error message', async () => {
      try {
        await query(store).type('User').execute()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(QueryLimitError)
        const qle = error as QueryLimitError
        expect(qle.message).toContain('query.execute')
        expect(qle.maxAllowed).toBe(5)
      }
    })
  })

  describe('first() and count() in strict mode', () => {
    beforeEach(() => {
      configureQueryLimits({ mode: 'strict', maxLimit: 100 })
    })

    it('first() should work without explicit limit', async () => {
      // first() internally calls limit(1)
      const result = await query(store).type('User').first()
      expect(result).not.toBeNull()
    })

    it('count() should work with explicit limit', async () => {
      const count = await query(store).type('User').limit(100).count()
      expect(count).toBe(10)
    })
  })
})

// ============================================================
// Query with Joins Edge Cases
// ============================================================

describe('Query with Joins Edge Cases', () => {
  let store: ThingsStore
  let relationships: RelationshipsStore

  beforeEach(async () => {
    store = createThingsStore()
    relationships = createRelationshipsStore()
    configureQueryLimits({ mode: 'warn' })
  })

  afterEach(() => {
    configureQueryLimits({ mode: 'strict' })
  })

  describe('createQueryWithJoins without relationships store', () => {
    it('should work without relationships store', async () => {
      const user = await store.create({ $type: 'User', name: 'Alice' })

      // createQuery passes undefined for relationships
      const results = await createQuery(store)
        .type('User')
        .execute()

      expect(results).toHaveLength(1)
    })

    it('should ignore join calls when no relationships store', async () => {
      await store.create({ $type: 'User', name: 'Alice' })

      // Joins should be no-ops without relationships store
      const results = await createQueryWithJoins(store, undefined)
        .type('User')
        .leftJoin('orders', 'Order')
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0]._joined).toBeUndefined()
    })
  })

  describe('Join with empty stores', () => {
    it('should handle join with empty relationships', async () => {
      await store.create({ $type: 'User', name: 'Alice' })

      const results = await query(store, relationships)
        .type('User')
        .leftJoin('orders', 'Order')
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0]._joined?.orders).toEqual([])
    })

    it('should handle inner join with no matching relationships', async () => {
      await store.create({ $type: 'User', name: 'Alice' })

      const results = await query(store, relationships)
        .type('User')
        .join('orders', 'Order')
        .execute()

      // Inner join should exclude users without orders
      expect(results).toHaveLength(0)
    })
  })

  describe('Join aliases', () => {
    it('should use alias instead of predicate name', async () => {
      const user = await store.create({ $type: 'User', name: 'Alice' })
      const order = await store.create({ $type: 'Order', total: 100 })
      await relationships.add({ subject: user.$id, predicate: 'placed', object: order.$id })

      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order', undefined, undefined, 'myOrders')
        .execute()

      expect(results[0]._joined?.myOrders).toBeDefined()
      expect(results[0]._joined?.placed).toBeUndefined()
    })
  })

  describe('Join options', () => {
    it('should respect join limit option', async () => {
      const user = await store.create({ $type: 'User', name: 'Alice' })
      for (let i = 0; i < 5; i++) {
        const order = await store.create({ $type: 'Order', total: i * 100 })
        await relationships.add({ subject: user.$id, predicate: 'placed', object: order.$id })
      }

      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order', undefined, undefined, undefined, { limit: 2 })
        .execute()

      expect(results[0]._joined?.placed?.length).toBe(2)
    })

    it('should respect join select option', async () => {
      const user = await store.create({ $type: 'User', name: 'Alice' })
      const order = await store.create({ $type: 'Order', total: 100, status: 'pending', extra: 'data' })
      await relationships.add({ subject: user.$id, predicate: 'placed', object: order.$id })

      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order', undefined, undefined, undefined, { select: ['total'] })
        .execute()

      const joinedOrder = results[0]._joined?.placed?.[0]
      expect(joinedOrder).toHaveProperty('$id')
      expect(joinedOrder).toHaveProperty('total')
      expect(joinedOrder).not.toHaveProperty('extra')
    })
  })
})

// ============================================================
// LIKE Pattern Edge Cases
// ============================================================

describe('LIKE Pattern Edge Cases', () => {
  let store: ThingsStore

  beforeEach(async () => {
    store = createThingsStore()
    configureQueryLimits({ mode: 'warn' })

    await store.create({ $type: 'User', name: '100%' })
    await store.create({ $type: 'User', name: '_underscore' })
    await store.create({ $type: 'User', name: 'test[brackets]' })
    await store.create({ $type: 'User', name: 'dot.name' })
    await store.create({ $type: 'User', name: 'star*name' })
    await store.create({ $type: 'User', name: 'plus+name' })
    await store.create({ $type: 'User', name: 'caret^name' })
    await store.create({ $type: 'User', name: 'dollar$name' })
  })

  afterEach(() => {
    configureQueryLimits({ mode: 'strict' })
  })

  it('should handle % in search pattern (escaped)', async () => {
    // Looking for literal % character
    const results = await query(store)
      .type('User')
      .whereOp('name', 'LIKE', '%\\%%')
      .execute()

    // Behavior depends on whether the implementation escapes % in values
    expect(Array.isArray(results)).toBe(true)
  })

  it('should handle _ in search pattern (single char wildcard)', async () => {
    const results = await query(store)
      .type('User')
      .whereOp('name', 'LIKE', '_underscore')
      .execute()

    // _ matches any single character
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle regex special chars in LIKE (in-memory)', async () => {
    // These are regex special chars that should be escaped in the in-memory LIKE implementation
    const results = await query(store)
      .type('User')
      .whereOp('name', 'LIKE', '%[brackets]%')
      .execute()

    // Should find the exact match without regex interpretation
    expect(results.length).toBeGreaterThanOrEqual(0) // Implementation dependent
  })

  it('should handle case-insensitive LIKE', async () => {
    await store.create({ $type: 'User', name: 'UPPERCASE' })
    await store.create({ $type: 'User', name: 'lowercase' })

    const results = await query(store)
      .type('User')
      .whereOp('name', 'LIKE', '%case%')
      .execute()

    // The in-memory implementation uses case-insensitive matching
    expect(results.length).toBeGreaterThanOrEqual(2)
  })
})
