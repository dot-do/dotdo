/**
 * SQL Injection Security Tests (TDD - RED Phase)
 *
 * Tests for SQL injection vulnerabilities in FlatIndex.
 * These tests verify that malicious IDs cannot execute arbitrary SQL.
 *
 * CRITICAL SECURITY: Lines 251, 309 in db/vector/engines/flat.ts use string
 * interpolation which is vulnerable to SQL injection attacks.
 *
 * @see db/vector/engines/flat.ts
 * @module tests/db/vector/sql-injection.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// MODULE IMPORTS
// ============================================================================

let FlatIndex: any

beforeEach(async () => {
  try {
    const module = await import('../../../db/vector/engines/flat')
    FlatIndex = module.FlatIndex
  } catch {
    FlatIndex = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertModuleLoaded(name: string, mod: any): asserts mod {
  if (!mod) {
    throw new Error(
      `FlatIndex module not implemented. Expected '${name}' from 'db/vector/engines/flat'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Generate a simple normalized vector for testing
 */
function simpleVector(dims: number): Float32Array {
  const vec = new Float32Array(dims)
  for (let i = 0; i < dims; i++) {
    vec[i] = 1 / Math.sqrt(dims)
  }
  return vec
}

/**
 * Create a mock SQLite-like database that tracks SQL executions
 * Returns both the mock db and a list of executed SQL statements
 */
function createTrackingMockDb() {
  const executedSql: string[] = []
  const preparedStatements: { sql: string; params: any[] }[] = []

  const db = {
    exec: vi.fn((sql: string) => {
      executedSql.push(sql)
    }),
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: any[]) => {
        preparedStatements.push({ sql, params: args })
      }),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    _flatIndexStorage: new Map(),
  }

  return { db, executedSql, preparedStatements }
}

// ============================================================================
// TESTS: SQL Injection Prevention
// ============================================================================

describe('FlatIndex - SQL Injection Prevention', () => {
  describe('Malicious ID Tests', () => {
    it('should safely handle DROP TABLE injection attempt in add()', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // Malicious ID attempting to drop the table
      const maliciousId = "'; DROP TABLE flat_vectors; --"
      const vector = simpleVector(4)

      await index.add(maliciousId, vector)

      // Check that no DROP TABLE was executed
      const allSql = executedSql.join('\n').toUpperCase()

      // The malicious SQL should NOT have been executed as a separate statement
      // If vulnerable, this would result in "DROP TABLE flat_vectors" being executed
      const dropCount = (allSql.match(/DROP\s+TABLE/g) || []).length
      expect(dropCount).toBe(0)

      // Verify the vector was stored with the ID treated as a literal string
      expect(index.has(maliciousId)).toBe(true)
    })

    it('should safely handle DROP TABLE injection attempt in remove()', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // First add a vector with normal ID
      await index.add('normal-id', simpleVector(4))

      // Clear executed SQL to focus on remove
      executedSql.length = 0

      // Attempt SQL injection through remove
      const maliciousId = "'; DROP TABLE flat_vectors; --"
      await index.remove(maliciousId)

      // Check that no DROP TABLE was executed
      const allSql = executedSql.join('\n').toUpperCase()
      const dropCount = (allSql.match(/DROP\s+TABLE/g) || []).length
      expect(dropCount).toBe(0)
    })

    it('should handle single quote escape attempts', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // IDs with various quote patterns
      const maliciousIds = [
        "test'id",
        "test''id",
        "test'''id",
        "'; SELECT * FROM users; --",
        "' OR '1'='1",
        "') OR ('1'='1",
      ]

      for (const id of maliciousIds) {
        await index.add(id, simpleVector(4))
        expect(index.has(id)).toBe(true)

        // The ID should be treated as a literal string
        const retrieved = await index.get(id)
        expect(retrieved).not.toBeNull()
      }

      // Verify no unauthorized SQL operations
      const allSql = executedSql.join('\n').toUpperCase()
      expect(allSql).not.toContain('SELECT * FROM USERS')
    })

    it('should handle semicolon injection attempts', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // IDs with semicolons attempting statement separation
      const maliciousIds = [
        'test;DELETE FROM flat_vectors',
        'test; DELETE FROM flat_vectors;',
        'test;--',
        '; DELETE FROM flat_vectors WHERE 1=1;',
      ]

      for (const id of maliciousIds) {
        await index.add(id, simpleVector(4))
        expect(index.has(id)).toBe(true)
      }

      // Verify DELETE was not executed as a separate statement
      const deleteStatements = executedSql.filter(
        sql => sql.toUpperCase().includes('DELETE') && !sql.toUpperCase().includes('INSERT')
      )
      expect(deleteStatements.length).toBe(0)
    })

    it('should handle comment injection attempts', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // IDs attempting to comment out parts of the query
      const maliciousIds = [
        'test--comment',
        'test/*comment*/',
        "test'--",
        "test' /*",
      ]

      for (const id of maliciousIds) {
        await index.add(id, simpleVector(4))
        expect(index.has(id)).toBe(true)
      }
    })

    it('should handle NULL byte injection attempts', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // ID with NULL byte (common attack vector)
      const maliciousId = "test\x00'; DROP TABLE flat_vectors; --"

      await index.add(maliciousId, simpleVector(4))
      expect(index.has(maliciousId)).toBe(true)
    })

    it('should handle unicode escape sequences', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // IDs with unicode that might be interpreted differently
      const maliciousIds = [
        "test\u0027id", // Unicode single quote
        "test\u003Bid", // Unicode semicolon
        "test\u002D\u002Did", // Unicode hyphens (comment)
      ]

      for (const id of maliciousIds) {
        await index.add(id, simpleVector(4))
        expect(index.has(id)).toBe(true)
      }
    })
  })

  describe('Parameterized Query Verification', () => {
    it('should use parameterized queries for INSERT operations', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql, preparedStatements } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      const testId = 'test-vector-id'
      await index.add(testId, simpleVector(4))

      // After fix: should use prepare().run() instead of exec() for data operations
      // Check that the ID does NOT appear directly in any exec() SQL (except schema creation)
      const dataSql = executedSql.filter(
        sql => !sql.includes('CREATE TABLE') && !sql.includes('CREATE INDEX')
      )

      // The ID should not appear directly interpolated in SQL
      // If using parameterized queries correctly, the ID won't be in the SQL string
      const hasInterpolatedId = dataSql.some(sql => sql.includes(`'${testId}'`))

      // This assertion should FAIL with current vulnerable code (RED phase)
      // and PASS after fix (GREEN phase)
      expect(hasInterpolatedId).toBe(false)
    })

    it('should use parameterized queries for DELETE operations', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // Add then remove
      const testId = 'test-vector-id'
      await index.add(testId, simpleVector(4))

      // Clear to focus on DELETE
      executedSql.length = 0

      await index.remove(testId)

      // The ID should not appear directly interpolated in DELETE SQL
      const hasInterpolatedId = executedSql.some(sql => sql.includes(`'${testId}'`))

      // This assertion should FAIL with current vulnerable code (RED phase)
      // and PASS after fix (GREEN phase)
      expect(hasInterpolatedId).toBe(false)
    })
  })

  describe('Batch Operation Security', () => {
    it('should safely handle malicious IDs in addBatch()', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      const maliciousBatch = [
        { id: "'; DROP TABLE flat_vectors; --", vector: simpleVector(4) },
        { id: 'normal-id', vector: simpleVector(4) },
        { id: "' OR 1=1; --", vector: simpleVector(4) },
      ]

      await index.addBatch(maliciousBatch)

      // All vectors should be stored
      expect(index.size).toBe(3)

      // No DROP TABLE should have executed
      const allSql = executedSql.join('\n').toUpperCase()
      expect(allSql).not.toContain('DROP TABLE FLAT_VECTORS')
    })

    it('should safely handle malicious IDs in removeBatch()', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // Add normal vectors first
      await index.add('vec_1', simpleVector(4))
      await index.add('vec_2', simpleVector(4))

      executedSql.length = 0

      // Try to remove with malicious IDs
      const maliciousIds = [
        "'; DROP TABLE flat_vectors; --",
        "vec_1'; DELETE FROM flat_vectors; --",
      ]

      await index.removeBatch(maliciousIds)

      // Should not have dropped the table
      const allSql = executedSql.join('\n').toUpperCase()
      expect(allSql).not.toContain('DROP TABLE')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string ID safely', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      await index.add('', simpleVector(4))
      expect(index.has('')).toBe(true)
    })

    it('should handle very long IDs safely', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db, executedSql } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // Very long ID that might cause buffer overflows in naive implementations
      const longId = "a'; --".repeat(10000)

      await index.add(longId, simpleVector(4))
      expect(index.has(longId)).toBe(true)

      // Should not have corrupted SQL
      const allSql = executedSql.join('\n')
      expect(allSql).not.toContain('DROP')
    })

    it('should handle newline characters in IDs', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // Newlines can sometimes break SQL parsing
      const maliciousIds = [
        "test\nid",
        "test\r\nid",
        "test\n'; DROP TABLE flat_vectors; --",
      ]

      for (const id of maliciousIds) {
        await index.add(id, simpleVector(4))
        expect(index.has(id)).toBe(true)
      }
    })

    it('should handle backslash escape sequences', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // Backslashes can escape quotes in some SQL dialects
      const maliciousIds = [
        "test\\'id",
        "test\\\\'id",
        "test\\'; DROP TABLE flat_vectors; --",
      ]

      for (const id of maliciousIds) {
        await index.add(id, simpleVector(4))
        expect(index.has(id)).toBe(true)
      }
    })
  })

  describe('Data Integrity After Attacks', () => {
    it('should preserve existing data after injection attempts', async () => {
      assertModuleLoaded('FlatIndex', FlatIndex)

      const { db } = createTrackingMockDb()
      const index = new FlatIndex({
        dimension: 4,
        storage: 'sqlite',
        db,
      })

      // Add legitimate vectors first
      await index.add('legitimate_1', simpleVector(4))
      await index.add('legitimate_2', simpleVector(4))

      // Attempt injection attacks
      const maliciousIds = [
        "'; DROP TABLE flat_vectors; --",
        "'; DELETE FROM flat_vectors WHERE 1=1; --",
        "'; UPDATE flat_vectors SET vector = NULL; --",
      ]

      for (const id of maliciousIds) {
        await index.add(id, simpleVector(4))
      }

      // Original vectors should still exist and be retrievable
      expect(index.has('legitimate_1')).toBe(true)
      expect(index.has('legitimate_2')).toBe(true)

      const vec1 = await index.get('legitimate_1')
      const vec2 = await index.get('legitimate_2')

      expect(vec1).not.toBeNull()
      expect(vec2).not.toBeNull()
      expect(vec1?.length).toBe(4)
      expect(vec2?.length).toBe(4)
    })
  })
})
