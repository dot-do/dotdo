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

// Import WASM as ES module (Cloudflare Workers ES module style)
import duckdbWasm from '../../wasm/duckdb-worker.wasm'

// Use WASM module from ES module import
const createDB = (config?: Parameters<typeof createDuckDB>[0]) =>
  createDuckDB(config, { wasmModule: duckdbWasm })

// ============================================================================
// TEST SETUP
// ============================================================================

/**
 * SQL execution tests using vitest-pool-workers with WASM module binding.
 * Tests run in actual Workers runtime environment.
 */
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
      await db.exec("INSERT INTO test_users VALUES (1, 'Alice', 'alice@example.com.ai')")

      const result = await db.query<{ id: number; name: string; email: string }>(
        'SELECT * FROM test_users WHERE id = 1'
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com.ai',
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

  // ============================================================================
  // COMPLEX TYPES (LIST, STRUCT, UUID, etc.)
  // ============================================================================

  describe('Complex Type Handling', () => {
    /**
     * Tests for LIST, STRUCT, UUID, and other complex types that previously
     * returned empty strings due to duckdb_value_varchar limitations.
     * @see https://duckdb.org/docs/stable/clients/c/types
     */

    describe('LIST (Array) Type', () => {
      it('should return LIST values as arrays', async () => {
        const result = await db.query<{ int_array: number[] }>(
          'SELECT [1, 2, 3] as int_array'
        )

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('LIST')
        expect(result.rows[0].int_array).toEqual([1, 2, 3])
      })

      it('should handle empty LIST', async () => {
        const result = await db.query<{ empty_array: unknown[] }>(
          'SELECT []::INTEGER[] as empty_array'
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].empty_array).toEqual([])
      })

      it('should handle LIST of strings', async () => {
        const result = await db.query<{ str_array: string[] }>(
          "SELECT ['a', 'b', 'c'] as str_array"
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].str_array).toEqual(['a', 'b', 'c'])
      })

      it('should handle nested LIST', async () => {
        const result = await db.query<{ nested: number[][] }>(
          'SELECT [[1, 2], [3, 4]] as nested'
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].nested).toEqual([[1, 2], [3, 4]])
      })
    })

    describe('STRUCT Type', () => {
      it('should return STRUCT values as objects', async () => {
        const result = await db.query<{ point: { x: number; y: number } }>(
          "SELECT {'x': 1, 'y': 2} as point"
        )

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('STRUCT')
        expect(result.rows[0].point).toEqual({ x: 1, y: 2 })
      })

      it('should handle STRUCT with string values', async () => {
        const result = await db.query<{ person: { name: string; city: string } }>(
          "SELECT {'name': 'Alice', 'city': 'NYC'} as person"
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].person).toEqual({ name: 'Alice', city: 'NYC' })
      })

      it('should handle nested STRUCT', async () => {
        const result = await db.query<{
          data: { outer: { inner: number } }
        }>("SELECT {'outer': {'inner': 42}} as data")

        expect(result.success).toBe(true)
        expect(result.rows[0].data).toEqual({ outer: { inner: 42 } })
      })
    })

    describe('UUID Type', () => {
      it('should return UUID values as strings', async () => {
        const result = await db.query<{ uuid_val: string }>('SELECT UUID() as uuid_val')

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('UUID')
        // UUID should be a valid UUID string format
        expect(result.rows[0].uuid_val).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        )
      })

      it('should return literal UUID values', async () => {
        const result = await db.query<{ uuid_val: string }>(
          "SELECT '550e8400-e29b-41d4-a716-446655440000'::UUID as uuid_val"
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].uuid_val).toBe('550e8400-e29b-41d4-a716-446655440000')
      })
    })

    describe('TIMESTAMP_TZ Type', () => {
      it('should return TIMESTAMP_TZ values as strings', async () => {
        const result = await db.query<{ now: string }>('SELECT CURRENT_TIMESTAMP as now')

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('TIMESTAMP_TZ')
        // Should contain a valid timestamp format
        expect(result.rows[0].now).toMatch(/^\d{4}-\d{2}-\d{2}/)
      })

      it('should return NOW() function result', async () => {
        const result = await db.query<{ now_fn: string }>('SELECT NOW() as now_fn')

        expect(result.success).toBe(true)
        // NOW() returns TIMESTAMP_TZ in DuckDB
        expect(result.rows[0].now_fn).toMatch(/^\d{4}-\d{2}-\d{2}/)
      })

      it('should NOT return empty string for TIMESTAMP_TZ', async () => {
        /**
         * Bug regression test: TIMESTAMP_TZ was returning empty string
         * due to duckdb_value_varchar not handling this type properly.
         * The fix ensures TIMESTAMP_TZ is cast to VARCHAR before extraction.
         */
        const result = await db.query<{ ts: string }>('SELECT CURRENT_TIMESTAMP as ts')

        expect(result.success).toBe(true)
        // Critical: the value should NOT be empty
        expect(result.rows[0].ts).not.toBe('')
        expect(result.rows[0].ts.length).toBeGreaterThan(0)
        // Should be a valid timestamp string with timezone
        expect(result.rows[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/)
      })

      it('should handle literal TIMESTAMPTZ values', async () => {
        /**
         * Test explicit TIMESTAMPTZ literal with timezone
         */
        const result = await db.query<{ ts: string }>(
          "SELECT TIMESTAMPTZ '2025-06-15 14:30:00+00' as ts"
        )

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('TIMESTAMP_TZ')
        expect(result.rows[0].ts).not.toBe('')
        expect(result.rows[0].ts).toMatch(/2025-06-15/)
      })

      it('should handle TIMESTAMP_TZ with different timezone offsets', async () => {
        /**
         * Test various timezone representations
         */
        const result = await db.query<{ utc: string; pst: string }>(
          "SELECT TIMESTAMPTZ '2025-01-01 00:00:00+00' as utc, TIMESTAMPTZ '2025-01-01 00:00:00-08' as pst"
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].utc).not.toBe('')
        expect(result.rows[0].pst).not.toBe('')
        // Both should contain timestamp data
        expect(result.rows[0].utc).toMatch(/\d{4}-\d{2}-\d{2}/)
        expect(result.rows[0].pst).toMatch(/\d{4}-\d{2}-\d{2}/)
      })

      it('should handle TIMESTAMP_TZ mixed with other types', async () => {
        /**
         * Ensure TIMESTAMP_TZ works alongside primitive types
         */
        const result = await db.query<{ id: number; name: string; created: string }>(
          "SELECT 1 as id, 'test' as name, CURRENT_TIMESTAMP as created"
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].id).toBe(1)
        expect(result.rows[0].name).toBe('test')
        expect(result.rows[0].created).not.toBe('')
        expect(result.rows[0].created).toMatch(/^\d{4}-\d{2}-\d{2}/)
      })

      it('should handle NULL TIMESTAMP_TZ values', async () => {
        /**
         * NULL should remain NULL, not become empty string
         */
        const result = await db.query<{ ts: null }>(
          'SELECT NULL::TIMESTAMPTZ as ts'
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].ts).toBeNull()
      })
    })

    describe('TIME_TZ Type', () => {
      it('should NOT return empty string for TIME_TZ', async () => {
        /**
         * Bug regression test: TIME_TZ also returns empty string
         * due to duckdb_value_varchar not handling this type properly.
         */
        const result = await db.query<{ t: string }>(
          "SELECT TIMETZ '12:30:00+00' as t"
        )

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('TIME_TZ')
        expect(result.columns[0].typeCode).toBe(30)
        // Critical: the value should NOT be empty
        expect(result.rows[0].t).not.toBe('')
        expect(result.rows[0].t.length).toBeGreaterThan(0)
        // Should contain time format
        expect(result.rows[0].t).toMatch(/\d{2}:\d{2}:\d{2}/)
      })

      it('should handle TIME_TZ with different timezone offsets', async () => {
        const result = await db.query<{ utc: string; pst: string }>(
          "SELECT TIMETZ '12:00:00+00' as utc, TIMETZ '12:00:00-08' as pst"
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].utc).not.toBe('')
        expect(result.rows[0].pst).not.toBe('')
        expect(result.rows[0].utc).toMatch(/\d{2}:\d{2}:\d{2}/)
        expect(result.rows[0].pst).toMatch(/\d{2}:\d{2}:\d{2}/)
      })

      it('should handle NULL TIME_TZ values', async () => {
        const result = await db.query<{ t: null }>(
          'SELECT NULL::TIMETZ as t'
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].t).toBeNull()
      })
    })

    describe('MAP Type', () => {
      it('should return MAP values as objects', async () => {
        const result = await db.query<{ map_val: Record<string, number> }>(
          "SELECT MAP {'a': 1, 'b': 2} as map_val"
        )

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('MAP')
        expect(result.rows[0].map_val).toEqual({ a: 1, b: 2 })
      })
    })

    describe('Mixed Complex Types', () => {
      it('should handle multiple complex types in one query', async () => {
        const result = await db.query<{
          arr: number[]
          obj: { a: number }
          uuid: string
        }>("SELECT [1, 2] as arr, {'a': 1} as obj, UUID() as uuid")

        expect(result.success).toBe(true)
        expect(result.rows[0].arr).toEqual([1, 2])
        expect(result.rows[0].obj).toEqual({ a: 1 })
        expect(result.rows[0].uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        )
      })

      it('should handle complex types alongside primitive types', async () => {
        const result = await db.query<{
          num: number
          str: string
          arr: number[]
          obj: { x: number }
        }>("SELECT 42 as num, 'hello' as str, [1, 2, 3] as arr, {'x': 10} as obj")

        expect(result.success).toBe(true)
        expect(result.rows[0].num).toBe(42)
        expect(result.rows[0].str).toBe('hello')
        expect(result.rows[0].arr).toEqual([1, 2, 3])
        expect(result.rows[0].obj).toEqual({ x: 10 })
      })

      it('should handle NULL values in complex types', async () => {
        const result = await db.query<{
          null_arr: null
          null_struct: null
          null_uuid: null
        }>(`
          SELECT
            NULL::INTEGER[] as null_arr,
            NULL::STRUCT(a INTEGER) as null_struct,
            NULL::UUID as null_uuid
        `)

        expect(result.success).toBe(true)
        expect(result.rows[0].null_arr).toBeNull()
        expect(result.rows[0].null_struct).toBeNull()
        expect(result.rows[0].null_uuid).toBeNull()
      })
    })
  })

  // ============================================================================
  // BIGINT JSON SERIALIZATION
  // ============================================================================

  describe('BigInt JSON Serialization', () => {
    /**
     * Tests for BigInt handling to ensure query results can be JSON serialized.
     * DuckDB returns BigInt for BIGINT columns, but JSON.stringify fails with
     * "TypeError: Do not know how to serialize a BigInt".
     *
     * Solution: Convert BigInt to number when safe (within Number.MAX_SAFE_INTEGER),
     * otherwise convert to string.
     */

    describe('Safe Integer Range (should return number)', () => {
      it('should JSON serialize BIGINT values within safe integer range', async () => {
        const result = await db.query<{ big_val: number }>(
          'SELECT 9007199254740991::BIGINT as big_val' // Number.MAX_SAFE_INTEGER
        )

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('BIGINT')

        // Value should be a number (not BigInt) for JSON compatibility
        const row = result.rows[0]
        expect(typeof row.big_val).toBe('number')
        expect(row.big_val).toBe(9007199254740991)

        // Should be JSON serializable
        expect(() => JSON.stringify(row)).not.toThrow()
        expect(JSON.stringify(row)).toBe('{"big_val":9007199254740991}')
      })

      it('should JSON serialize negative BIGINT within safe range', async () => {
        const result = await db.query<{ negative: number }>(
          'SELECT -9007199254740991::BIGINT as negative' // -Number.MAX_SAFE_INTEGER
        )

        expect(result.success).toBe(true)
        const row = result.rows[0]
        expect(typeof row.negative).toBe('number')
        expect(row.negative).toBe(-9007199254740991)
        expect(() => JSON.stringify(row)).not.toThrow()
      })

      it('should JSON serialize zero as BIGINT', async () => {
        const result = await db.query<{ zero: number }>('SELECT 0::BIGINT as zero')

        expect(result.success).toBe(true)
        expect(typeof result.rows[0].zero).toBe('number')
        expect(result.rows[0].zero).toBe(0)
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })

      it('should JSON serialize common BIGINT values', async () => {
        const result = await db.query<{ count: number }>(
          'SELECT 1000000000::BIGINT as count'
        )

        expect(result.success).toBe(true)
        expect(typeof result.rows[0].count).toBe('number')
        expect(result.rows[0].count).toBe(1000000000)
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })
    })

    describe('Unsafe Integer Range (should return string)', () => {
      it('should JSON serialize BIGINT exceeding MAX_SAFE_INTEGER as string', async () => {
        const result = await db.query<{ huge: string }>(
          'SELECT 9007199254740992::BIGINT as huge' // MAX_SAFE_INTEGER + 1
        )

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('BIGINT')

        // Value should be a string to preserve precision
        const row = result.rows[0]
        expect(typeof row.huge).toBe('string')
        expect(row.huge).toBe('9007199254740992')

        // Should be JSON serializable
        expect(() => JSON.stringify(row)).not.toThrow()
        expect(JSON.stringify(row)).toBe('{"huge":"9007199254740992"}')
      })

      it('should JSON serialize max BIGINT as string', async () => {
        const result = await db.query<{ max: string }>(
          'SELECT 9223372036854775807::BIGINT as max' // Max BIGINT value
        )

        expect(result.success).toBe(true)
        const row = result.rows[0]
        expect(typeof row.max).toBe('string')
        expect(row.max).toBe('9223372036854775807')
        expect(() => JSON.stringify(row)).not.toThrow()
      })

      it('should JSON serialize negative BIGINT below safe range as string', async () => {
        const result = await db.query<{ negative: string }>(
          'SELECT -9007199254740992::BIGINT as negative' // -MAX_SAFE_INTEGER - 1
        )

        expect(result.success).toBe(true)
        const row = result.rows[0]
        expect(typeof row.negative).toBe('string')
        expect(row.negative).toBe('-9007199254740992')
        expect(() => JSON.stringify(row)).not.toThrow()
      })

      it('should JSON serialize min BIGINT as string', async () => {
        const result = await db.query<{ min: string }>(
          'SELECT -9223372036854775808::BIGINT as min' // Min BIGINT value
        )

        expect(result.success).toBe(true)
        const row = result.rows[0]
        expect(typeof row.min).toBe('string')
        expect(row.min).toBe('-9223372036854775808')
        expect(() => JSON.stringify(row)).not.toThrow()
      })
    })

    describe('UBIGINT Type', () => {
      it('should JSON serialize UBIGINT within safe range as number', async () => {
        const result = await db.query<{ val: number }>(
          'SELECT 9007199254740991::UBIGINT as val'
        )

        expect(result.success).toBe(true)
        expect(typeof result.rows[0].val).toBe('number')
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })

      it('should JSON serialize large UBIGINT as string', async () => {
        const result = await db.query<{ val: string }>(
          'SELECT 18446744073709551615::UBIGINT as val' // Max UBIGINT
        )

        expect(result.success).toBe(true)
        expect(typeof result.rows[0].val).toBe('string')
        expect(result.rows[0].val).toBe('18446744073709551615')
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })
    })

    describe('HUGEINT Type', () => {
      it('should JSON serialize HUGEINT as string (always exceeds safe range)', async () => {
        const result = await db.query<{ val: string }>(
          'SELECT 170141183460469231731687303715884105727::HUGEINT as val' // Max HUGEINT
        )

        expect(result.success).toBe(true)
        expect(result.columns[0].type).toBe('HUGEINT')
        expect(typeof result.rows[0].val).toBe('string')
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })

      it('should JSON serialize small HUGEINT within safe range as number', async () => {
        const result = await db.query<{ val: number }>(
          'SELECT 42::HUGEINT as val'
        )

        expect(result.success).toBe(true)
        expect(typeof result.rows[0].val).toBe('number')
        expect(result.rows[0].val).toBe(42)
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })
    })

    describe('Real-world Use Cases', () => {
      it('should handle length() function returning BIGINT', async () => {
        // length() returns BIGINT by default
        const result = await db.query<{ len: number }>(
          "SELECT length('hello world') as len"
        )

        expect(result.success).toBe(true)
        expect(typeof result.rows[0].len).toBe('number')
        expect(result.rows[0].len).toBe(11)
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })

      it('should handle COUNT(*) returning BIGINT', async () => {
        await db.exec('CREATE TABLE IF NOT EXISTS bigint_test (id INTEGER)')
        await db.exec('INSERT INTO bigint_test VALUES (1), (2), (3)')

        const result = await db.query<{ cnt: number }>(
          'SELECT COUNT(*) as cnt FROM bigint_test'
        )

        expect(result.success).toBe(true)
        expect(typeof result.rows[0].cnt).toBe('number')
        expect(result.rows[0].cnt).toBe(3)
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()

        await db.exec('DROP TABLE IF EXISTS bigint_test')
      })

      it('should handle SUM returning HUGEINT', async () => {
        // SUM of BIGINT returns HUGEINT
        const result = await db.query<{ total: number }>(
          'SELECT SUM(x::BIGINT) as total FROM generate_series(1, 100) t(x)'
        )

        expect(result.success).toBe(true)
        // 5050 is within safe integer range, should be number
        expect(typeof result.rows[0].total).toBe('number')
        expect(result.rows[0].total).toBe(5050)
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })

      it('should handle mixed BIGINT and other types', async () => {
        const result = await db.query<{
          id: number
          name: string
          big_count: number
        }>(
          "SELECT 1 as id, 'test' as name, 1000000::BIGINT as big_count"
        )

        expect(result.success).toBe(true)
        const row = result.rows[0]
        expect(row.id).toBe(1)
        expect(row.name).toBe('test')
        expect(typeof row.big_count).toBe('number')
        expect(() => JSON.stringify(row)).not.toThrow()
      })

      it('should handle NULL BIGINT values', async () => {
        const result = await db.query<{ val: null }>(
          'SELECT NULL::BIGINT as val'
        )

        expect(result.success).toBe(true)
        expect(result.rows[0].val).toBeNull()
        expect(() => JSON.stringify(result.rows[0])).not.toThrow()
      })
    })

    describe('Config: bigIntMode option', () => {
      it('should use string mode when configured', async () => {
        const stringDb = await createDuckDB(
          { wasmModule: duckdbWasm },
          { bigIntMode: 'string' }
        )

        try {
          const result = await stringDb.query<{ val: string }>(
            'SELECT 42::BIGINT as val'
          )

          expect(result.success).toBe(true)
          // Even safe integers should be strings in 'string' mode
          expect(typeof result.rows[0].val).toBe('string')
          expect(result.rows[0].val).toBe('42')
          expect(() => JSON.stringify(result.rows[0])).not.toThrow()
        } finally {
          await stringDb.close()
        }
      })

      it('should use number mode when configured', async () => {
        const numberDb = await createDuckDB(
          { wasmModule: duckdbWasm },
          { bigIntMode: 'number' }
        )

        try {
          // Note: This may lose precision for large values
          const result = await numberDb.query<{ val: number }>(
            'SELECT 1000000::BIGINT as val'
          )

          expect(result.success).toBe(true)
          expect(typeof result.rows[0].val).toBe('number')
          expect(result.rows[0].val).toBe(1000000)
          expect(() => JSON.stringify(result.rows[0])).not.toThrow()
        } finally {
          await numberDb.close()
        }
      })

      it('should default to auto mode', async () => {
        // Default db already uses auto mode
        const safeResult = await db.query<{ val: number }>(
          'SELECT 42::BIGINT as val'
        )
        expect(typeof safeResult.rows[0].val).toBe('number')

        const unsafeResult = await db.query<{ val: string }>(
          'SELECT 9007199254740992::BIGINT as val' // MAX_SAFE_INTEGER + 1
        )
        expect(typeof unsafeResult.rows[0].val).toBe('string')
      })
    })
  })
})
