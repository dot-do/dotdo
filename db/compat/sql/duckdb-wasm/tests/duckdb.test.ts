/**
 * DuckDB WASM Compat Layer Comprehensive Tests
 *
 * RED phase TDD tests covering the complete DuckDB WASM compat layer.
 * These tests define the full API contract that the DuckDB WASM module must support.
 *
 * Test Categories:
 * 1. Database Operations - Connection, persistence, cleanup
 * 2. SQL Execution - CRUD operations
 * 3. Prepared Statements - Parameterized queries
 * 4. Data Types - Type handling
 * 5. WASM Specifics - Edge runtime, memory, async
 * 6. Extensions - JSON, Parquet extensions
 *
 * @see https://duckdb.org/docs/api/wasm/overview
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { env, SELF } from 'cloudflare:test'

import {
  createDuckDB,
  instantiateDuckDB,
  clearCache,
  isCached,
  getHeapUsage,
  type DuckDBInstance,
  type DuckDBConfig,
  type InstantiationResult,
  type QueryResult,
} from '../index'

// ============================================================================
// 1. DATABASE OPERATIONS
// ============================================================================

describe('Database Operations', () => {
  describe('Connection', () => {
    afterEach(async () => {
      // Clear cache between tests to ensure isolation
      clearCache()
    })

    it('opens in-memory database', async () => {
      // GIVEN: Default configuration (in-memory)
      // WHEN: Creating a DuckDB instance
      const db = await createDuckDB()

      // THEN: Database should be open and functional
      expect(db).toBeDefined()
      expect(db.open).toBe(true)
      expect(db.path).toBe(':memory:')

      // Verify it works with a simple query
      const result = await db.query('SELECT 1 as test')
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].test).toBe(1)

      await db.close()
    })

    it('opens persistent database', async () => {
      // GIVEN: Configuration with a file path
      const config: DuckDBConfig = {
        path: '/tmp/test.duckdb',
      }

      // WHEN: Creating a DuckDB instance with persistent storage
      const db = await createDuckDB(config)

      // THEN: Database should be configured for persistence
      expect(db).toBeDefined()
      expect(db.open).toBe(true)
      expect(db.path).toBe('/tmp/test.duckdb')

      await db.close()
    })

    it('closes database cleanly', async () => {
      // GIVEN: An open database with some data
      const db = await createDuckDB()
      await db.query('CREATE TABLE cleanup_test (id INTEGER)')
      await db.query('INSERT INTO cleanup_test VALUES (1), (2), (3)')

      // Verify data exists
      const beforeClose = await db.query('SELECT COUNT(*) as cnt FROM cleanup_test')
      expect(beforeClose.rows[0].cnt).toBe(3)

      // WHEN: Closing the database
      await db.close()

      // THEN: Database should be marked as closed
      expect(db.open).toBe(false)

      // AND: Operations should throw after close
      await expect(db.query('SELECT 1')).rejects.toThrow('Database connection is closed')
    })

    it('allows multiple connections to separate databases', async () => {
      // GIVEN: Two separate database instances
      const db1 = await createDuckDB()
      const db2 = await createDuckDB()

      // WHEN: Creating tables with same name in each
      await db1.query('CREATE TABLE shared_name (val INTEGER)')
      await db2.query('CREATE TABLE shared_name (val VARCHAR)')

      await db1.query('INSERT INTO shared_name VALUES (42)')
      await db2.query("INSERT INTO shared_name VALUES ('hello')")

      // THEN: Each should maintain independent data
      const result1 = await db1.query('SELECT val FROM shared_name')
      const result2 = await db2.query('SELECT val FROM shared_name')

      expect(result1.rows[0].val).toBe(42)
      expect(result2.rows[0].val).toBe('hello')

      await db1.close()
      await db2.close()
    })
  })
})

// ============================================================================
// 2. SQL EXECUTION
// ============================================================================

describe('SQL Execution', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  afterEach(async () => {
    // Clean up any test tables
    try {
      await db.query('DROP TABLE IF EXISTS sql_test')
      await db.query('DROP TABLE IF EXISTS users')
      await db.query('DROP TABLE IF EXISTS products')
    } catch {
      // Ignore cleanup errors
    }
  })

  it('executes SELECT query', async () => {
    // GIVEN: A table with data
    await db.query('CREATE TABLE sql_test (id INTEGER, name VARCHAR)')
    await db.query("INSERT INTO sql_test VALUES (1, 'Alice'), (2, 'Bob')")

    // WHEN: Executing a SELECT query
    const result = await db.query<{ id: number; name: string }>(
      'SELECT id, name FROM sql_test ORDER BY id'
    )

    // THEN: Should return all matching rows with correct data
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ id: 1, name: 'Alice' })
    expect(result.rows[1]).toEqual({ id: 2, name: 'Bob' })
    expect(result.columns).toHaveLength(2)
    expect(result.columns[0].name).toBe('id')
    expect(result.columns[1].name).toBe('name')
  })

  it('executes INSERT', async () => {
    // GIVEN: An empty table
    await db.query('CREATE TABLE sql_test (id INTEGER, value DOUBLE)')

    // WHEN: Inserting data
    await db.query('INSERT INTO sql_test VALUES (1, 10.5), (2, 20.5), (3, 30.5)')

    // THEN: Data should be persisted
    const result = await db.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM sql_test')
    expect(result.rows[0].cnt).toBe(3)

    const sumResult = await db.query<{ total: number }>('SELECT SUM(value) as total FROM sql_test')
    expect(sumResult.rows[0].total).toBe(61.5)
  })

  it('executes UPDATE', async () => {
    // GIVEN: A table with existing data
    await db.query('CREATE TABLE sql_test (id INTEGER, status VARCHAR)')
    await db.query("INSERT INTO sql_test VALUES (1, 'pending'), (2, 'pending'), (3, 'complete')")

    // WHEN: Updating rows matching a condition
    await db.query("UPDATE sql_test SET status = 'processed' WHERE status = 'pending'")

    // THEN: Only matching rows should be updated
    const result = await db.query<{ id: number; status: string }>(
      'SELECT id, status FROM sql_test ORDER BY id'
    )
    expect(result.rows[0].status).toBe('processed')
    expect(result.rows[1].status).toBe('processed')
    expect(result.rows[2].status).toBe('complete')
  })

  it('executes DELETE', async () => {
    // GIVEN: A table with data
    await db.query('CREATE TABLE sql_test (id INTEGER, active BOOLEAN)')
    await db.query('INSERT INTO sql_test VALUES (1, true), (2, false), (3, true), (4, false)')

    // WHEN: Deleting rows matching a condition
    await db.query('DELETE FROM sql_test WHERE active = false')

    // THEN: Only non-matching rows should remain
    const result = await db.query<{ id: number }>('SELECT id FROM sql_test ORDER BY id')
    expect(result.rows).toHaveLength(2)
    expect(result.rows.map((r) => r.id)).toEqual([1, 3])
  })

  it('executes CREATE TABLE', async () => {
    // WHEN: Creating a table with various column types and constraints
    await db.query(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100),
        age INTEGER CHECK (age >= 0),
        balance DECIMAL(10, 2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // THEN: Table should exist and be queryable
    const result = await db.query('SELECT * FROM users')
    expect(result.rows).toHaveLength(0) // Empty table
    expect(result.columns.length).toBe(6)

    // Should be able to insert valid data
    await db.query("INSERT INTO users (id, email, name, age) VALUES (1, 'test@example.com.ai', 'Test', 25)")
    const inserted = await db.query<{ id: number; name: string }>('SELECT id, name FROM users')
    expect(inserted.rows[0]).toEqual({ id: 1, name: 'Test' })
  })

  it('handles SQL syntax errors gracefully', async () => {
    // WHEN: Executing invalid SQL
    // THEN: Should throw a descriptive error
    await expect(db.query('SELEC * FORM table')).rejects.toThrow()
  })

  it('executes multiple statements in sequence', async () => {
    // GIVEN: Multiple SQL operations
    await db.query('CREATE TABLE sql_test (x INTEGER)')

    // WHEN: Executing multiple inserts
    await db.query('INSERT INTO sql_test VALUES (1)')
    await db.query('INSERT INTO sql_test VALUES (2)')
    await db.query('INSERT INTO sql_test VALUES (3)')

    // THEN: All should succeed
    const result = await db.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM sql_test')
    expect(result.rows[0].cnt).toBe(3)
  })
})

// ============================================================================
// 3. PREPARED STATEMENTS
// ============================================================================

describe('Prepared Statements', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()
    // Create test table
    await db.query('CREATE TABLE prep_test (id INTEGER, name VARCHAR, value DOUBLE)')
    await db.query(`
      INSERT INTO prep_test VALUES
        (1, 'Alice', 100.0),
        (2, 'Bob', 200.0),
        (3, 'Charlie', 300.0)
    `)
  })

  afterAll(async () => {
    if (db) {
      await db.query('DROP TABLE IF EXISTS prep_test')
      await db.close()
    }
  })

  it('prepares parameterized query', async () => {
    // WHEN: Executing a parameterized query
    const result = await db.query<{ id: number; name: string }>(
      'SELECT id, name FROM prep_test WHERE id = $1',
      [2]
    )

    // THEN: Should return rows matching the parameter
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({ id: 2, name: 'Bob' })
  })

  it('executes prepared statement', async () => {
    // WHEN: Executing with multiple parameters
    const result = await db.query<{ id: number; name: string; value: number }>(
      'SELECT * FROM prep_test WHERE value BETWEEN $1 AND $2',
      [150.0, 250.0]
    )

    // THEN: Should correctly bind both parameters
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Bob')
    expect(result.rows[0].value).toBe(200.0)
  })

  it('handles multiple executions', async () => {
    // WHEN: Executing the same query pattern multiple times with different params
    const result1 = await db.query<{ name: string }>(
      'SELECT name FROM prep_test WHERE id = $1',
      [1]
    )
    const result2 = await db.query<{ name: string }>(
      'SELECT name FROM prep_test WHERE id = $1',
      [2]
    )
    const result3 = await db.query<{ name: string }>(
      'SELECT name FROM prep_test WHERE id = $1',
      [3]
    )

    // THEN: Each should return correct results
    expect(result1.rows[0].name).toBe('Alice')
    expect(result2.rows[0].name).toBe('Bob')
    expect(result3.rows[0].name).toBe('Charlie')
  })

  it('handles string parameters with special characters', async () => {
    // GIVEN: A search string with special characters
    await db.query("INSERT INTO prep_test VALUES (4, 'O''Brien', 400.0)")

    // WHEN: Querying with special characters
    const result = await db.query<{ id: number }>(
      'SELECT id FROM prep_test WHERE name = $1',
      ["O'Brien"]
    )

    // THEN: Should handle escaping correctly
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe(4)
  })

  it('handles NULL parameters', async () => {
    // GIVEN: An insert with NULL values
    await db.query('INSERT INTO prep_test VALUES ($1, $2, $3)', [5, null, 500.0])

    // WHEN: Querying for NULL
    const result = await db.query<{ id: number; name: string | null }>(
      'SELECT id, name FROM prep_test WHERE name IS NULL'
    )

    // THEN: Should handle NULL correctly
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe(5)
    expect(result.rows[0].name).toBeNull()
  })

  it('handles multiple parameter types in same query', async () => {
    // WHEN: Using different types of parameters
    const result = await db.query<{ id: number; name: string; value: number }>(
      'SELECT * FROM prep_test WHERE id > $1 AND name LIKE $2 AND value < $3',
      [1, '%ob%', 300.0]
    )

    // THEN: All parameter types should be correctly bound
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Bob')
  })
})

// ============================================================================
// 4. DATA TYPES
// ============================================================================

describe('Data Types', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  afterEach(async () => {
    try {
      await db.query('DROP TABLE IF EXISTS type_test')
    } catch {
      // Ignore cleanup errors
    }
  })

  it('handles INTEGER', async () => {
    // WHEN: Working with INTEGER type
    await db.query('CREATE TABLE type_test (val INTEGER)')
    await db.query('INSERT INTO type_test VALUES (0), (42), (-100), (2147483647)')

    const result = await db.query<{ val: number }>('SELECT val FROM type_test ORDER BY val')

    // THEN: Should correctly store and retrieve integers
    expect(result.rows.map((r) => r.val)).toEqual([-100, 0, 42, 2147483647])
    expect(typeof result.rows[0].val).toBe('number')
  })

  it('handles BIGINT', async () => {
    // WHEN: Working with BIGINT type
    await db.query('CREATE TABLE type_test (val BIGINT)')
    await db.query('INSERT INTO type_test VALUES (9007199254740992), (-9007199254740992)')

    const result = await db.query<{ val: number | bigint }>('SELECT val FROM type_test ORDER BY val')

    // THEN: Should handle large integers (may be converted to number or bigint)
    expect(result.rows).toHaveLength(2)
    // DuckDB WASM converts BIGINT to number when within safe integer range
    // or to string/bigint for larger values
  })

  it('handles VARCHAR', async () => {
    // WHEN: Working with VARCHAR type
    await db.query('CREATE TABLE type_test (val VARCHAR)')
    await db.query(`
      INSERT INTO type_test VALUES
        ('hello'),
        (''),
        ('Unicode: \u4e2d\u6587'),
        ('Special: \t\n\r')
    `)

    const result = await db.query<{ val: string }>('SELECT val FROM type_test ORDER BY val')

    // THEN: Should correctly store and retrieve strings
    expect(result.rows).toHaveLength(4)
    expect(result.rows.some((r) => r.val === 'hello')).toBe(true)
    expect(result.rows.some((r) => r.val === '')).toBe(true)
    expect(result.rows.some((r) => r.val.includes('\u4e2d\u6587'))).toBe(true)
    expect(typeof result.rows[0].val).toBe('string')
  })

  it('handles TIMESTAMP', async () => {
    // WHEN: Working with TIMESTAMP type
    await db.query('CREATE TABLE type_test (val TIMESTAMP)')
    await db.query(`
      INSERT INTO type_test VALUES
        ('2024-01-15 10:30:00'),
        ('1970-01-01 00:00:00'),
        (TIMESTAMP '2025-12-31 23:59:59.999')
    `)

    const result = await db.query<{ val: Date | string }>('SELECT val FROM type_test ORDER BY val')

    // THEN: Should correctly store and retrieve timestamps
    expect(result.rows).toHaveLength(3)
    // Timestamps may be returned as Date objects or ISO strings
  })

  it('handles DATE', async () => {
    // WHEN: Working with DATE type
    await db.query('CREATE TABLE type_test (val DATE)')
    await db.query(`
      INSERT INTO type_test VALUES
        ('2024-01-15'),
        ('1970-01-01'),
        (DATE '2025-12-31')
    `)

    const result = await db.query<{ val: Date | string }>('SELECT val FROM type_test ORDER BY val')

    // THEN: Should correctly store and retrieve dates
    expect(result.rows).toHaveLength(3)
  })

  it('handles BOOLEAN', async () => {
    // WHEN: Working with BOOLEAN type
    await db.query('CREATE TABLE type_test (val BOOLEAN)')
    await db.query('INSERT INTO type_test VALUES (true), (false), (NULL)')

    const result = await db.query<{ val: boolean | null }>('SELECT val FROM type_test ORDER BY val')

    // THEN: Should correctly store and retrieve booleans
    expect(result.rows).toHaveLength(3)
    expect(result.rows.some((r) => r.val === true)).toBe(true)
    expect(result.rows.some((r) => r.val === false)).toBe(true)
    expect(result.rows.some((r) => r.val === null)).toBe(true)
  })

  it('handles DOUBLE', async () => {
    // WHEN: Working with DOUBLE type
    await db.query('CREATE TABLE type_test (val DOUBLE)')
    await db.query(`
      INSERT INTO type_test VALUES
        (3.14159265359),
        (-0.0),
        (1e10),
        (1e-10)
    `)

    const result = await db.query<{ val: number }>('SELECT val FROM type_test ORDER BY val')

    // THEN: Should correctly store and retrieve floating point numbers
    expect(result.rows).toHaveLength(4)
    expect(typeof result.rows[0].val).toBe('number')
    expect(result.rows.some((r) => Math.abs(r.val - 3.14159265359) < 0.0001)).toBe(true)
  })

  it('handles JSON', async () => {
    // WHEN: Working with JSON type
    await db.query('CREATE TABLE type_test (val JSON)')
    await db.query(`
      INSERT INTO type_test VALUES
        ('{"name": "Alice", "age": 30}'),
        ('["a", "b", "c"]'),
        ('{"nested": {"deep": {"value": 42}}}')
    `)

    const result = await db.query<{ val: object | string }>(
      'SELECT val FROM type_test'
    )

    // THEN: Should correctly store and retrieve JSON
    expect(result.rows).toHaveLength(3)
  })

  it('handles json_extract', async () => {
    // WHEN: Using json_extract function
    await db.query("CREATE TABLE type_test AS SELECT '{\"name\": \"Alice\", \"age\": 30}'::JSON as data")

    const result = await db.query<{ name: string; age: number }>(
      "SELECT json_extract_string(data, '$.name') as name, json_extract(data, '$.age')::INTEGER as age FROM type_test"
    )

    // THEN: Should correctly extract JSON values
    expect(result.rows[0].name).toBe('Alice')
    expect(result.rows[0].age).toBe(30)
  })

  it('handles ARRAY', async () => {
    // WHEN: Working with ARRAY type
    await db.query('CREATE TABLE type_test (val INTEGER[])')
    await db.query(`
      INSERT INTO type_test VALUES
        ([1, 2, 3]),
        ([]),
        ([42])
    `)

    const result = await db.query<{ val: number[] }>(
      'SELECT val FROM type_test ORDER BY array_length(val)'
    )

    // THEN: Should correctly store and retrieve arrays
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0].val).toEqual([]) // Empty array first
    expect(result.rows[2].val).toEqual([1, 2, 3])
  })

  it('handles array functions', async () => {
    // WHEN: Using array functions
    await db.query('CREATE TABLE type_test AS SELECT [1, 2, 3, 4, 5] as arr')

    const result = await db.query<{
      len: number
      sum: number
      contains_3: boolean
    }>(`
      SELECT
        array_length(arr) as len,
        list_sum(arr) as sum,
        list_contains(arr, 3) as contains_3
      FROM type_test
    `)

    // THEN: Array functions should work correctly
    expect(result.rows[0].len).toBe(5)
    expect(result.rows[0].sum).toBe(15)
    expect(result.rows[0].contains_3).toBe(true)
  })

  it('handles DECIMAL', async () => {
    // WHEN: Working with DECIMAL type for precise arithmetic
    await db.query('CREATE TABLE type_test (val DECIMAL(10, 2))')
    await db.query('INSERT INTO type_test VALUES (1234.56), (0.01), (99999999.99)')

    const result = await db.query<{ val: number | string }>(
      'SELECT val FROM type_test ORDER BY val'
    )

    // THEN: Should maintain decimal precision
    expect(result.rows).toHaveLength(3)
    // First row should be 0.01
    const firstVal = Number(result.rows[0].val)
    expect(Math.abs(firstVal - 0.01)).toBeLessThan(0.001)
  })

  it('handles BLOB', async () => {
    // WHEN: Working with BLOB type
    await db.query("CREATE TABLE type_test (val BLOB)")
    await db.query("INSERT INTO type_test VALUES (decode('48656c6c6f', 'hex'))")

    const result = await db.query<{ val: Uint8Array | string }>(
      'SELECT val FROM type_test'
    )

    // THEN: Should store and retrieve binary data
    expect(result.rows).toHaveLength(1)
  })

  it('handles UUID', async () => {
    // WHEN: Working with UUID type
    await db.query('CREATE TABLE type_test (val UUID)')
    await db.query(`
      INSERT INTO type_test VALUES
        ('550e8400-e29b-41d4-a716-446655440000'),
        (gen_random_uuid())
    `)

    const result = await db.query<{ val: string }>('SELECT val FROM type_test')

    // THEN: Should correctly store and retrieve UUIDs
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].val).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })
})

// ============================================================================
// 5. WASM SPECIFICS
// ============================================================================

describe('WASM Specifics', () => {
  afterEach(() => {
    clearCache()
  })

  it('loads in Workers environment', async () => {
    // WHEN: Instantiating DuckDB in Workers environment
    const result = await instantiateDuckDB({ measureMetrics: true })

    // THEN: Should successfully load WASM module
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.metrics).toBeDefined()
    expect(result.metrics?.wasmModuleSizeBytes).toBeGreaterThan(0)
  })

  it('handles memory limits', async () => {
    // GIVEN: Memory constraints of Workers (128MB limit)
    const result = await instantiateDuckDB({ measureMetrics: true })

    // THEN: Peak memory should stay under 128MB
    expect(result.success).toBe(true)
    const peakMemoryMB = (result.metrics?.peakMemoryBytes ?? 0) / (1024 * 1024)
    expect(peakMemoryMB).toBeLessThan(128)

    console.log(`Peak memory: ${peakMemoryMB.toFixed(2)} MB`)
  })

  it('async execution works', async () => {
    // WHEN: Running async operations
    const db = await createDuckDB()

    // THEN: All operations should be non-blocking and awaitable
    const createPromise = db.query('CREATE TABLE async_test (id INTEGER)')
    expect(createPromise).toBeInstanceOf(Promise)
    await createPromise

    const insertPromise = db.query('INSERT INTO async_test VALUES (1), (2), (3)')
    expect(insertPromise).toBeInstanceOf(Promise)
    await insertPromise

    const selectPromise = db.query('SELECT * FROM async_test')
    expect(selectPromise).toBeInstanceOf(Promise)
    const result = await selectPromise

    expect(result.rows).toHaveLength(3)

    await db.close()
  })

  it('supports concurrent async queries', async () => {
    // GIVEN: A database with data
    const db = await createDuckDB()
    await db.query('CREATE TABLE concurrent_test AS SELECT i FROM range(1000) t(i)')

    // WHEN: Running multiple queries concurrently
    const queries = [
      db.query('SELECT COUNT(*) as cnt FROM concurrent_test WHERE i < 100'),
      db.query('SELECT COUNT(*) as cnt FROM concurrent_test WHERE i >= 100 AND i < 500'),
      db.query('SELECT COUNT(*) as cnt FROM concurrent_test WHERE i >= 500'),
      db.query('SELECT SUM(i) as total FROM concurrent_test'),
      db.query('SELECT AVG(i) as avg FROM concurrent_test'),
    ]

    const results = await Promise.all(queries)

    // THEN: All queries should complete successfully
    expect(results).toHaveLength(5)
    expect(results[0].rows[0].cnt).toBe(100)
    expect(results[1].rows[0].cnt).toBe(400)
    expect(results[2].rows[0].cnt).toBe(500)
    expect(results[3].rows[0].total).toBe(499500) // sum(0..999)

    await db.close()
  })

  it('benefits from module caching', async () => {
    // Clear cache to ensure cold start
    clearCache()
    expect(isCached()).toBe(false)

    // WHEN: First instantiation (cold)
    const coldStart = performance.now()
    await instantiateDuckDB()
    const coldTime = performance.now() - coldStart

    expect(isCached()).toBe(true)

    // WHEN: Second instantiation (warm)
    const warmStart = performance.now()
    await instantiateDuckDB()
    const warmTime = performance.now() - warmStart

    // THEN: Warm start should be faster
    console.log(`Cold start: ${coldTime.toFixed(2)}ms, Warm start: ${warmTime.toFixed(2)}ms`)

    // Warm start should be at least somewhat faster (allowing variance)
    // This is a soft expectation since timing can vary
    expect(warmTime).toBeLessThan(coldTime + 100) // Allow 100ms variance
  })

  it('clears cache correctly', async () => {
    // Ensure module is cached
    await instantiateDuckDB()
    expect(isCached()).toBe(true)
    expect(getHeapUsage()).toBeGreaterThan(0)

    // WHEN: Clearing cache
    clearCache()

    // THEN: Cache should be cleared
    expect(isCached()).toBe(false)
    expect(getHeapUsage()).toBe(0)
  })

  it('handles large result sets', async () => {
    // GIVEN: A database with a large table
    const db = await createDuckDB()
    await db.query(`
      CREATE TABLE large_test AS
      SELECT i as id, 'row_' || i as name
      FROM range(100000) t(i)
    `)

    // WHEN: Querying large dataset
    const start = performance.now()
    const result = await db.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM large_test')
    const elapsed = performance.now() - start

    // THEN: Should handle efficiently
    expect(result.rows[0].cnt).toBe(100000)
    expect(elapsed).toBeLessThan(5000) // Should complete in under 5 seconds

    console.log(`100K row count query: ${elapsed.toFixed(2)}ms`)

    await db.close()
  })
})

// ============================================================================
// 6. EXTENSIONS
// ============================================================================

describe('Extensions', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  describe('JSON Extension', () => {
    it('loads JSON extension', async () => {
      // WHEN: Using JSON functions (extension auto-loads)
      const result = await db.query<{ parsed: object | string }>(
        "SELECT json('{\"key\": \"value\"}') as parsed"
      )

      // THEN: JSON function should work
      expect(result.rows).toHaveLength(1)
    })

    it('uses json_extract', async () => {
      // GIVEN: JSON data
      await db.query(`
        CREATE TABLE IF NOT EXISTS json_test AS
        SELECT '{"user": {"name": "Alice", "email": "alice@example.com.ai"}, "active": true}'::JSON as data
      `)

      // WHEN: Extracting nested values
      const result = await db.query<{ name: string; email: string; active: boolean }>(`
        SELECT
          json_extract_string(data, '$.user.name') as name,
          json_extract_string(data, '$.user.email') as email,
          json_extract(data, '$.active')::BOOLEAN as active
        FROM json_test
      `)

      // THEN: Should correctly extract values
      expect(result.rows[0].name).toBe('Alice')
      expect(result.rows[0].email).toBe('alice@example.com.ai')
      expect(result.rows[0].active).toBe(true)

      await db.query('DROP TABLE IF EXISTS json_test')
    })

    it('handles json_array_length', async () => {
      // WHEN: Getting array length from JSON
      const result = await db.query<{ len: number }>(
        "SELECT json_array_length('[1, 2, 3, 4, 5]') as len"
      )

      // THEN: Should return correct length
      expect(result.rows[0].len).toBe(5)
    })

    it('handles json_type', async () => {
      // WHEN: Checking JSON types
      const result = await db.query<{ t1: string; t2: string; t3: string; t4: string }>(`
        SELECT
          json_type('123') as t1,
          json_type('"string"') as t2,
          json_type('{"a": 1}') as t3,
          json_type('[1, 2]') as t4
      `)

      // THEN: Should correctly identify types
      expect(result.rows[0].t1).toBe('INTEGER')
      expect(result.rows[0].t2).toBe('VARCHAR')
      expect(result.rows[0].t3).toBe('OBJECT')
      expect(result.rows[0].t4).toBe('ARRAY')
    })
  })

  describe('Parquet Extension', () => {
    it('loads parquet extension', async () => {
      // WHEN: Creating Parquet file (extension auto-loads)
      await db.query(`
        CREATE TABLE IF NOT EXISTS parquet_source AS
        SELECT 1 as id, 'test' as name
      `)
      await db.query("COPY parquet_source TO 'test.parquet' (FORMAT PARQUET)")

      // THEN: Parquet file should be created and queryable
      const result = await db.query<{ id: number; name: string }>(
        "SELECT * FROM parquet_scan('test.parquet')"
      )
      expect(result.rows[0]).toEqual({ id: 1, name: 'test' })

      await db.query('DROP TABLE IF EXISTS parquet_source')
    })

    it('supports parquet_metadata', async () => {
      // GIVEN: A parquet file
      await db.query(`
        CREATE TABLE IF NOT EXISTS meta_source AS
        SELECT i as id, 'row_' || i as name
        FROM range(100) t(i)
      `)
      await db.query("COPY meta_source TO 'meta.parquet' (FORMAT PARQUET)")

      // WHEN: Reading metadata
      const result = await db.query<{ num_rows: number }>(
        "SELECT num_rows FROM parquet_metadata('meta.parquet')"
      )

      // THEN: Should return correct metadata
      expect(result.rows[0].num_rows).toBe(100)

      await db.query('DROP TABLE IF EXISTS meta_source')
    })

    it('supports parquet with compression', async () => {
      // WHEN: Creating Parquet with compression
      await db.query(`
        CREATE TABLE IF NOT EXISTS compress_source AS
        SELECT i, repeat('x', 100) as padding FROM range(1000) t(i)
      `)
      await db.query("COPY compress_source TO 'compressed.parquet' (FORMAT PARQUET, COMPRESSION 'snappy')")

      // THEN: Should be queryable
      const result = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM parquet_scan('compressed.parquet')"
      )
      expect(result.rows[0].cnt).toBe(1000)

      await db.query('DROP TABLE IF EXISTS compress_source')
    })
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('Error Handling', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  it('throws on table not found', async () => {
    await expect(
      db.query('SELECT * FROM nonexistent_table_xyz')
    ).rejects.toThrow()
  })

  it('throws on column not found', async () => {
    await db.query('CREATE TABLE error_test (a INTEGER)')

    await expect(
      db.query('SELECT nonexistent_column FROM error_test')
    ).rejects.toThrow()

    await db.query('DROP TABLE error_test')
  })

  it('throws on type mismatch', async () => {
    await db.query('CREATE TABLE type_error_test (val INTEGER)')

    await expect(
      db.query("INSERT INTO type_error_test VALUES ('not a number')")
    ).rejects.toThrow()

    await db.query('DROP TABLE type_error_test')
  })

  it('throws on constraint violation', async () => {
    await db.query('CREATE TABLE constraint_test (id INTEGER PRIMARY KEY)')
    await db.query('INSERT INTO constraint_test VALUES (1)')

    await expect(
      db.query('INSERT INTO constraint_test VALUES (1)')
    ).rejects.toThrow()

    await db.query('DROP TABLE constraint_test')
  })

  it('provides descriptive error messages', async () => {
    try {
      await db.query('INVALID SQL STATEMENT')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBeTruthy()
      expect((error as Error).message.length).toBeGreaterThan(10)
    }
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  it('handles empty result set', async () => {
    await db.query('CREATE TABLE empty_test (id INTEGER)')

    const result = await db.query('SELECT * FROM empty_test')

    expect(result.rows).toHaveLength(0)
    expect(result.columns).toBeDefined()
    expect(result.columns.length).toBe(1)

    await db.query('DROP TABLE empty_test')
  })

  it('handles very long strings', async () => {
    const longString = 'x'.repeat(100000)

    await db.query('CREATE TABLE long_test (val VARCHAR)')
    await db.query('INSERT INTO long_test VALUES ($1)', [longString])

    const result = await db.query<{ val: string }>('SELECT val FROM long_test')
    expect(result.rows[0].val.length).toBe(100000)

    await db.query('DROP TABLE long_test')
  })

  it('handles many columns', async () => {
    const columns = Array.from({ length: 50 }, (_, i) => `col${i} INTEGER`).join(', ')
    await db.query(`CREATE TABLE wide_test (${columns})`)

    const values = Array.from({ length: 50 }, (_, i) => i).join(', ')
    await db.query(`INSERT INTO wide_test VALUES (${values})`)

    const result = await db.query('SELECT * FROM wide_test')
    expect(result.columns).toHaveLength(50)

    await db.query('DROP TABLE wide_test')
  })

  it('handles special characters in identifiers', async () => {
    await db.query('CREATE TABLE "table with spaces" (id INTEGER)')
    await db.query('INSERT INTO "table with spaces" VALUES (42)')

    const result = await db.query<{ id: number }>('SELECT id FROM "table with spaces"')
    expect(result.rows[0].id).toBe(42)

    await db.query('DROP TABLE "table with spaces"')
  })

  it('handles Unicode data', async () => {
    await db.query('CREATE TABLE unicode_test (val VARCHAR)')
    await db.query(`
      INSERT INTO unicode_test VALUES
        ('\u4e2d\u6587'),
        ('\u65e5\u672c\u8a9e'),
        ('\ud55c\uad6d\uc5b4'),
        ('\u0410\u0411\u0412'),
        ('\u1f600\u1f389\u2764')
    `)

    const result = await db.query<{ val: string }>('SELECT val FROM unicode_test')
    expect(result.rows).toHaveLength(5)
    expect(result.rows.some((r) => r.val.includes('\u4e2d'))).toBe(true)

    await db.query('DROP TABLE unicode_test')
  })
})
