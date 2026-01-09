/**
 * DuckDB WASM SQL Query Tests for Cloudflare Workers
 *
 * Tests SQL execution capabilities in the Workers runtime.
 * These tests verify:
 * - Basic SELECT queries work
 * - DDL/DML operations (CREATE TABLE, INSERT, SELECT)
 * - Parameterized queries
 * - Error handling for invalid SQL
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

import {
  createDuckDB,
  clearCache,
  type DuckDBInstance,
  type QueryResult,
} from '@dotdo/duckdb-worker'

// Alias for test compatibility
const createDB = createDuckDB

// ============================================================================
// TEST SETUP
// ============================================================================

describe('DuckDB WASM SQL Execution in Workers', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    clearCache()
    db = await createDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  // ============================================================================
  // BASIC QUERIES
  // ============================================================================

  describe('Basic SELECT Queries', () => {
    it('should execute SELECT 1 + 1', async () => {
      /**
       * Most basic test - arithmetic in SQL.
       * If this fails, DuckDB is not functional at all.
       */
      const result = await db.query<{ answer: number }>('SELECT 1 + 1 as answer')

      expect(result).toBeDefined()
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].answer).toBe(2)
    })

    it('should return column metadata', async () => {
      /**
       * Verify column information is returned correctly.
       */
      const result = await db.query('SELECT 1 as num, \'hello\' as str')

      expect(result.columns).toBeDefined()
      expect(result.columns).toHaveLength(2)
      expect(result.columns[0].name).toBe('num')
      expect(result.columns[1].name).toBe('str')
    })

    it('should handle multiple columns', async () => {
      /**
       * Test selecting multiple columns.
       */
      const result = await db.query<{ a: number; b: number; c: number }>(
        'SELECT 1 as a, 2 as b, 3 as c'
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('should handle string data', async () => {
      /**
       * Test string handling in queries.
       */
      const result = await db.query<{ greeting: string }>(
        "SELECT 'Hello, Workers!' as greeting"
      )

      expect(result.rows[0].greeting).toBe('Hello, Workers!')
    })

    it('should handle NULL values', async () => {
      /**
       * Test NULL handling.
       */
      const result = await db.query<{ empty: null }>('SELECT NULL as empty')

      expect(result.rows[0].empty).toBeNull()
    })

    it('should handle boolean values', async () => {
      /**
       * Test boolean handling.
       */
      const result = await db.query<{ yes: boolean; no: boolean }>(
        'SELECT true as yes, false as no'
      )

      expect(result.rows[0].yes).toBe(true)
      expect(result.rows[0].no).toBe(false)
    })

    it('should execute arithmetic expressions', async () => {
      /**
       * Test various arithmetic operations.
       */
      const result = await db.query<{
        sum: number
        product: number
        diff: number
        quotient: number
      }>('SELECT 2 + 3 as sum, 4 * 5 as product, 10 - 3 as diff, 20 / 4 as quotient')

      expect(result.rows[0]).toEqual({
        sum: 5,
        product: 20,
        diff: 7,
        quotient: 5,
      })
    })

    it('should handle floating point numbers', async () => {
      /**
       * Test floating point precision.
       */
      const result = await db.query<{ pi: number }>('SELECT 3.14159 as pi')

      expect(result.rows[0].pi).toBeCloseTo(3.14159, 5)
    })

    it('should report execution time', async () => {
      /**
       * Verify execution timing is tracked.
       */
      const result = await db.query('SELECT * FROM range(100)')

      expect(result.executionTimeMs).toBeDefined()
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // DDL/DML OPERATIONS
  // ============================================================================

  describe('CREATE TABLE / INSERT / SELECT', () => {
    afterEach(async () => {
      // Clean up test tables
      try {
        await db.query('DROP TABLE IF EXISTS test_users')
        await db.query('DROP TABLE IF EXISTS test_products')
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should CREATE TABLE with various types', async () => {
      /**
       * Test table creation with different column types.
       */
      await db.exec(`
        CREATE TABLE test_users (
          id INTEGER PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(255),
          age INTEGER,
          balance DECIMAL(10, 2),
          active BOOLEAN DEFAULT true
        )
      `)

      // Verify table exists
      const result = await db.query('SELECT * FROM test_users')
      expect(result.rows).toHaveLength(0)
      expect(result.columns.length).toBeGreaterThan(0)
    })

    it('should INSERT single row and SELECT it back', async () => {
      /**
       * Test basic insert and select roundtrip.
       */
      await db.exec('CREATE TABLE test_users (id INTEGER, name VARCHAR, email VARCHAR)')
      await db.exec("INSERT INTO test_users VALUES (1, 'Alice', 'alice@example.com')")

      const result = await db.query<{ id: number; name: string; email: string }>(
        'SELECT * FROM test_users WHERE id = 1'
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
      })
    })

    it('should INSERT multiple rows', async () => {
      /**
       * Test inserting multiple rows in single statement.
       */
      await db.exec('CREATE TABLE test_users (id INTEGER, name VARCHAR)')
      await db.exec(`
        INSERT INTO test_users VALUES
          (1, 'Alice'),
          (2, 'Bob'),
          (3, 'Charlie')
      `)

      const result = await db.query<{ id: number; name: string }>(
        'SELECT * FROM test_users ORDER BY id'
      )

      expect(result.rows).toHaveLength(3)
      expect(result.rows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('should UPDATE existing rows', async () => {
      /**
       * Test UPDATE statement.
       */
      await db.exec('CREATE TABLE test_users (id INTEGER, name VARCHAR, active BOOLEAN)')
      await db.exec("INSERT INTO test_users VALUES (1, 'Alice', true)")
      await db.exec('UPDATE test_users SET active = false WHERE id = 1')

      const result = await db.query<{ active: boolean }>(
        'SELECT active FROM test_users WHERE id = 1'
      )

      expect(result.rows[0].active).toBe(false)
    })

    it('should DELETE rows', async () => {
      /**
       * Test DELETE statement.
       */
      await db.exec('CREATE TABLE test_users (id INTEGER, name VARCHAR)')
      await db.exec("INSERT INTO test_users VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie')")
      await db.exec('DELETE FROM test_users WHERE id = 2')

      const result = await db.query<{ id: number }>('SELECT id FROM test_users ORDER BY id')

      expect(result.rows.map((r) => r.id)).toEqual([1, 3])
    })

    it('should handle INSERT RETURNING', async () => {
      /**
       * Test INSERT with RETURNING clause.
       */
      await db.exec('CREATE TABLE test_users (id INTEGER, name VARCHAR)')
      const result = await db.query<{ id: number; name: string }>(
        "INSERT INTO test_users VALUES (99, 'Zoe') RETURNING *"
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({ id: 99, name: 'Zoe' })
    })

    it('should support CREATE TABLE AS SELECT', async () => {
      /**
       * Test CTAS pattern.
       */
      await db.exec('CREATE TABLE test_users (id INTEGER, name VARCHAR, dept VARCHAR)')
      await db.exec(`
        INSERT INTO test_users VALUES
          (1, 'Alice', 'eng'),
          (2, 'Bob', 'eng'),
          (3, 'Charlie', 'sales')
      `)
      await db.exec("CREATE TABLE engineers AS SELECT * FROM test_users WHERE dept = 'eng'")

      const result = await db.query<{ name: string }>('SELECT name FROM engineers ORDER BY id')
      expect(result.rows.map((r) => r.name)).toEqual(['Alice', 'Bob'])

      await db.exec('DROP TABLE engineers')
    })
  })

  // ============================================================================
  // PARAMETERIZED QUERIES
  // ============================================================================

  describe('Parameterized Queries', () => {
    beforeAll(async () => {
      await db.exec('CREATE TABLE IF NOT EXISTS params_test (id INTEGER, name VARCHAR, value DECIMAL(10,2))')
      await db.exec(`
        INSERT INTO params_test VALUES
          (1, 'Alpha', 100.50),
          (2, 'Beta', 200.75),
          (3, 'Gamma', 300.25)
      `)
    })

    afterAll(async () => {
      await db.exec('DROP TABLE IF EXISTS params_test')
    })

    it('should handle single integer parameter', async () => {
      /**
       * Test parameterized query with integer.
       */
      const result = await db.query<{ name: string }>(
        'SELECT name FROM params_test WHERE id = $1',
        [2]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Beta')
    })

    it('should handle single string parameter', async () => {
      /**
       * Test parameterized query with string.
       */
      const result = await db.query<{ id: number }>(
        'SELECT id FROM params_test WHERE name = $1',
        ['Gamma']
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe(3)
    })

    it('should handle multiple parameters', async () => {
      /**
       * Test query with multiple parameters.
       */
      const result = await db.query<{ name: string }>(
        'SELECT name FROM params_test WHERE id >= $1 AND value < $2',
        [1, 250]
      )

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.name)).toContain('Alpha')
      expect(result.rows.map((r) => r.name)).toContain('Beta')
    })

    it('should handle NULL parameter', async () => {
      /**
       * Test parameterized query with NULL.
       */
      const result = await db.query<{ is_null: boolean }>(
        'SELECT $1 IS NULL as is_null',
        [null]
      )

      expect(result.rows[0].is_null).toBe(true)
    })

    it('should handle parameterized INSERT', async () => {
      /**
       * Test INSERT with parameters.
       */
      await db.query(
        'INSERT INTO params_test VALUES ($1, $2, $3)',
        [99, 'Omega', 999.99]
      )

      const result = await db.query<{ name: string; value: number }>(
        'SELECT name, value FROM params_test WHERE id = $1',
        [99]
      )

      expect(result.rows[0]).toEqual({ name: 'Omega', value: 999.99 })

      // Clean up
      await db.exec('DELETE FROM params_test WHERE id = 99')
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw on invalid SQL syntax', async () => {
      /**
       * Test that syntax errors are properly thrown.
       */
      await expect(db.query('SELEC * FROM invalid')).rejects.toThrow()
    })

    it('should throw on non-existent table', async () => {
      /**
       * Test that missing table errors are thrown.
       */
      await expect(db.query('SELECT * FROM nonexistent_table_xyz')).rejects.toThrow()
    })

    it('should throw on type mismatch', async () => {
      /**
       * Test that type errors are thrown.
       */
      await expect(db.query("SELECT 'not a number' + 5")).rejects.toThrow()
    })

    it('should include error message in thrown error', async () => {
      /**
       * Verify error messages are descriptive.
       */
      try {
        await db.query('SELECT * FROM missing_table_abc')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message.length).toBeGreaterThan(0)
      }
    })

    it('should handle query after error', async () => {
      /**
       * Verify connection remains usable after error.
       */
      try {
        await db.query('INVALID SQL HERE')
      } catch {
        // Expected error
      }

      // Should still be able to query
      const result = await db.query('SELECT 1 as recovered')
      expect(result.rows[0].recovered).toBe(1)
    })

    it('should throw when database is closed', async () => {
      /**
       * Test that operations fail after close.
       */
      const closedDb = await createDB()
      await closedDb.close()

      await expect(closedDb.query('SELECT 1')).rejects.toThrow()
    })
  })

  // ============================================================================
  // ADVANCED QUERIES
  // ============================================================================

  describe('Advanced Query Features', () => {
    beforeAll(async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS advanced_test (
          id INTEGER,
          category VARCHAR,
          value INTEGER
        )
      `)
      await db.exec(`
        INSERT INTO advanced_test VALUES
          (1, 'A', 10),
          (2, 'A', 20),
          (3, 'B', 30),
          (4, 'B', 40),
          (5, 'C', 50)
      `)
    })

    afterAll(async () => {
      await db.exec('DROP TABLE IF EXISTS advanced_test')
    })

    it('should execute aggregations', async () => {
      /**
       * Test aggregate functions.
       */
      const result = await db.query<{
        cnt: number
        total: number
        avg: number
        min: number
        max: number
      }>(`
        SELECT
          COUNT(*) as cnt,
          SUM(value) as total,
          AVG(value) as avg,
          MIN(value) as min,
          MAX(value) as max
        FROM advanced_test
      `)

      expect(result.rows[0]).toEqual({
        cnt: 5,
        total: 150,
        avg: 30,
        min: 10,
        max: 50,
      })
    })

    it('should execute GROUP BY', async () => {
      /**
       * Test GROUP BY clause.
       */
      const result = await db.query<{ category: string; total: number }>(`
        SELECT category, SUM(value) as total
        FROM advanced_test
        GROUP BY category
        ORDER BY category
      `)

      expect(result.rows).toEqual([
        { category: 'A', total: 30 },
        { category: 'B', total: 70 },
        { category: 'C', total: 50 },
      ])
    })

    it('should execute HAVING', async () => {
      /**
       * Test GROUP BY with HAVING.
       */
      const result = await db.query<{ category: string; total: number }>(`
        SELECT category, SUM(value) as total
        FROM advanced_test
        GROUP BY category
        HAVING SUM(value) > 40
        ORDER BY total DESC
      `)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].category).toBe('B')
    })

    it('should execute subqueries', async () => {
      /**
       * Test subquery support.
       */
      const result = await db.query<{ id: number; value: number }>(`
        SELECT id, value
        FROM advanced_test
        WHERE value > (SELECT AVG(value) FROM advanced_test)
        ORDER BY id
      `)

      expect(result.rows.map((r) => r.id)).toEqual([4, 5])
    })

    it('should execute CTE (WITH clause)', async () => {
      /**
       * Test Common Table Expressions.
       */
      const result = await db.query<{ category: string; rank: number }>(`
        WITH ranked AS (
          SELECT category, SUM(value) as total
          FROM advanced_test
          GROUP BY category
        )
        SELECT category, RANK() OVER (ORDER BY total DESC) as rank
        FROM ranked
        ORDER BY rank
      `)

      expect(result.rows[0].category).toBe('B')
      expect(result.rows[0].rank).toBe(1)
    })
  })
})
