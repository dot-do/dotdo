/**
 * DuckDB WASM Prepared Statement Tests
 *
 * Tests parameterized queries for SQL injection safety.
 * Following TDD approach: these tests are written first (RED phase).
 *
 * @see https://duckdb.org/docs/api/c/prepared
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
  createDuckDB,
  clearCache,
  type DuckDBInstance,
} from '@dotdo/duckdb-worker'

// Import WASM as ES module (Cloudflare Workers ES module style)
import duckdbWasm from '../../wasm/duckdb-worker.wasm'

// Use WASM module from ES module import
const createDB = (config?: Parameters<typeof createDuckDB>[0]) =>
  createDuckDB(config, { wasmModule: duckdbWasm })

// ============================================================================
// TEST SETUP
// ============================================================================

describe('DuckDB WASM Prepared Statements', () => {
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
  // BASIC PARAMETERIZED SELECT
  // ============================================================================

  describe('Basic Parameterized SELECT', () => {
    beforeAll(async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          name VARCHAR(100),
          email VARCHAR(255),
          age INTEGER,
          balance DECIMAL(10, 2),
          active BOOLEAN
        )
      `)
      await db.exec(`
        INSERT INTO users VALUES
          (1, 'Alice', 'alice@example.com', 30, 1000.50, true),
          (2, 'Bob', 'bob@example.com', 25, 500.00, false),
          (3, 'Charlie', 'charlie@example.com', 35, 2500.75, true)
      `)
    })

    afterAll(async () => {
      await db.exec('DROP TABLE IF EXISTS users')
    })

    it('should handle single integer parameter', async () => {
      const result = await db.query<{ name: string }>(
        'SELECT name FROM users WHERE id = $1',
        [2]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Bob')
    })

    it('should handle single string parameter', async () => {
      const result = await db.query<{ id: number }>(
        'SELECT id FROM users WHERE name = $1',
        ['Charlie']
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe(3)
    })

    it('should handle multiple parameters', async () => {
      const result = await db.query<{ name: string }>(
        'SELECT name FROM users WHERE age >= $1 AND balance < $2',
        [30, 2000]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should handle boolean parameter', async () => {
      const result = await db.query<{ name: string }>(
        'SELECT name FROM users WHERE active = $1 ORDER BY id',
        [true]
      )

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.name)).toEqual(['Alice', 'Charlie'])
    })

    it('should handle NULL parameter', async () => {
      const result = await db.query<{ is_null: boolean }>(
        'SELECT $1 IS NULL as is_null',
        [null]
      )

      expect(result.rows[0].is_null).toBe(true)
    })

    it('should handle float/decimal parameter', async () => {
      const result = await db.query<{ name: string }>(
        'SELECT name FROM users WHERE balance > $1',
        [1500.00]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Charlie')
    })

    it('should handle LIKE with string parameter', async () => {
      const result = await db.query<{ name: string }>(
        'SELECT name FROM users WHERE email LIKE $1',
        ['%@example.com']
      )

      expect(result.rows).toHaveLength(3)
    })
  })

  // ============================================================================
  // PARAMETERIZED INSERT/UPDATE/DELETE
  // ============================================================================

  describe('Parameterized INSERT/UPDATE/DELETE', () => {
    beforeEach(async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY,
          name VARCHAR(100),
          price DECIMAL(10, 2),
          quantity INTEGER,
          available BOOLEAN
        )
      `)
    })

    afterEach(async () => {
      await db.exec('DROP TABLE IF EXISTS products')
    })

    it('should handle parameterized INSERT', async () => {
      await db.exec(
        'INSERT INTO products VALUES ($1, $2, $3, $4, $5)',
        [1, 'Widget', 29.99, 100, true]
      )

      const result = await db.query<{ name: string; price: number }>(
        'SELECT name, price FROM products WHERE id = 1'
      )

      expect(result.rows[0]).toEqual({ name: 'Widget', price: 29.99 })
    })

    it('should handle parameterized UPDATE', async () => {
      await db.exec('INSERT INTO products VALUES (1, \'Widget\', 29.99, 100, true)')

      await db.exec(
        'UPDATE products SET price = $1, quantity = $2 WHERE id = $3',
        [39.99, 50, 1]
      )

      const result = await db.query<{ price: number; quantity: number }>(
        'SELECT price, quantity FROM products WHERE id = 1'
      )

      expect(result.rows[0]).toEqual({ price: 39.99, quantity: 50 })
    })

    it('should handle parameterized DELETE', async () => {
      await db.exec(`
        INSERT INTO products VALUES
          (1, 'Widget', 29.99, 100, true),
          (2, 'Gadget', 49.99, 50, false),
          (3, 'Gizmo', 19.99, 200, true)
      `)

      await db.exec(
        'DELETE FROM products WHERE available = $1',
        [false]
      )

      const result = await db.query<{ id: number }>('SELECT id FROM products ORDER BY id')

      expect(result.rows.map((r) => r.id)).toEqual([1, 3])
    })

    it('should handle INSERT RETURNING with parameters', async () => {
      const result = await db.query<{ id: number; name: string }>(
        'INSERT INTO products VALUES ($1, $2, $3, $4, $5) RETURNING id, name',
        [99, 'Special', 99.99, 10, true]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({ id: 99, name: 'Special' })
    })
  })

  // ============================================================================
  // DATA TYPE SUPPORT
  // ============================================================================

  describe('Data Type Support', () => {
    it('should handle string type', async () => {
      const result = await db.query<{ val: string }>(
        'SELECT $1::VARCHAR as val',
        ['hello world']
      )

      expect(result.rows[0].val).toBe('hello world')
    })

    it('should handle integer type', async () => {
      const result = await db.query<{ val: number }>(
        'SELECT $1::INTEGER as val',
        [42]
      )

      expect(result.rows[0].val).toBe(42)
    })

    it('should handle bigint type', async () => {
      const result = await db.query<{ val: number | string }>(
        'SELECT $1::BIGINT as val',
        [9007199254740991] // MAX_SAFE_INTEGER
      )

      // Should be number for safe integers
      expect(result.rows[0].val).toBe(9007199254740991)
    })

    it('should handle boolean type - true', async () => {
      const result = await db.query<{ val: boolean }>(
        'SELECT $1::BOOLEAN as val',
        [true]
      )

      expect(result.rows[0].val).toBe(true)
    })

    it('should handle boolean type - false', async () => {
      const result = await db.query<{ val: boolean }>(
        'SELECT $1::BOOLEAN as val',
        [false]
      )

      expect(result.rows[0].val).toBe(false)
    })

    it('should handle null type', async () => {
      const result = await db.query<{ val: null }>(
        'SELECT $1 as val',
        [null]
      )

      expect(result.rows[0].val).toBeNull()
    })

    it('should handle float/double type', async () => {
      const result = await db.query<{ val: number }>(
        'SELECT $1::DOUBLE as val',
        [3.14159]
      )

      expect(result.rows[0].val).toBeCloseTo(3.14159, 5)
    })

    it('should handle Date type (converted to timestamp string)', async () => {
      const date = new Date('2025-06-15T10:30:00Z')
      const result = await db.query<{ val: string }>(
        'SELECT $1::TIMESTAMP as val',
        [date]
      )

      // Should contain the date
      expect(result.rows[0].val).toContain('2025-06-15')
    })

    it('should handle Uint8Array (blob) type', async () => {
      const buffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
      const result = await db.query<{ val: string }>(
        'SELECT $1::BLOB as val',
        [buffer]
      )

      // Result should be the blob
      expect(result.rows[0].val).toBeDefined()
    })

    it('should handle empty string', async () => {
      const result = await db.query<{ val: string }>(
        'SELECT $1::VARCHAR as val',
        ['']
      )

      expect(result.rows[0].val).toBe('')
    })

    it('should handle negative numbers', async () => {
      const result = await db.query<{ val: number }>(
        'SELECT $1::INTEGER as val',
        [-42]
      )

      expect(result.rows[0].val).toBe(-42)
    })

    it('should handle zero', async () => {
      const result = await db.query<{ val: number }>(
        'SELECT $1::INTEGER as val',
        [0]
      )

      expect(result.rows[0].val).toBe(0)
    })
  })

  // ============================================================================
  // SQL INJECTION PREVENTION
  // ============================================================================

  describe('SQL Injection Prevention', () => {
    beforeAll(async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS secrets (
          id INTEGER PRIMARY KEY,
          username VARCHAR(100),
          password VARCHAR(100)
        )
      `)
      await db.exec(`
        INSERT INTO secrets VALUES
          (1, 'admin', 'super_secret_password'),
          (2, 'user', 'user_password')
      `)
    })

    afterAll(async () => {
      await db.exec('DROP TABLE IF EXISTS secrets')
    })

    it('should prevent SQL injection via string parameter', async () => {
      // Classic SQL injection attempt: ' OR '1'='1
      const maliciousInput = "' OR '1'='1"

      const result = await db.query<{ username: string }>(
        'SELECT username FROM secrets WHERE username = $1',
        [maliciousInput]
      )

      // Should return NO rows because the input is treated as a literal string
      expect(result.rows).toHaveLength(0)
    })

    it('should prevent SQL injection via UNION SELECT', async () => {
      // SQL injection attempt using UNION
      const maliciousInput = "' UNION SELECT password FROM secrets --"

      const result = await db.query<{ username: string }>(
        'SELECT username FROM secrets WHERE username = $1',
        [maliciousInput]
      )

      // Should return NO rows because the input is treated as a literal string
      expect(result.rows).toHaveLength(0)
    })

    it('should prevent SQL injection via comment termination', async () => {
      // SQL injection attempt using comment
      const maliciousInput = "admin'--"

      const result = await db.query<{ username: string }>(
        'SELECT username FROM secrets WHERE username = $1',
        [maliciousInput]
      )

      // Should return NO rows because the input is treated as a literal string
      expect(result.rows).toHaveLength(0)
    })

    it('should prevent SQL injection via semicolon', async () => {
      // SQL injection attempt using semicolon to add new query
      const maliciousInput = "'; DROP TABLE secrets; --"

      const result = await db.query<{ username: string }>(
        'SELECT username FROM secrets WHERE username = $1',
        [maliciousInput]
      )

      // Should return NO rows because the input is treated as a literal string
      expect(result.rows).toHaveLength(0)

      // Table should still exist
      const tableExists = await db.query('SELECT * FROM secrets')
      expect(tableExists.rows.length).toBeGreaterThan(0)
    })

    it('should handle strings containing SQL keywords safely', async () => {
      // String containing SQL keywords should be safe
      const safeInput = "SELECT * FROM users WHERE id = 1"

      const result = await db.query<{ val: string }>(
        'SELECT $1::VARCHAR as val',
        [safeInput]
      )

      expect(result.rows[0].val).toBe(safeInput)
    })

    it('should handle strings with quotes safely', async () => {
      const inputWithQuotes = "It's a \"test\" string"

      const result = await db.query<{ val: string }>(
        'SELECT $1::VARCHAR as val',
        [inputWithQuotes]
      )

      expect(result.rows[0].val).toBe(inputWithQuotes)
    })

    it('should handle strings with backslashes safely', async () => {
      const inputWithBackslashes = "path\\to\\file"

      const result = await db.query<{ val: string }>(
        'SELECT $1::VARCHAR as val',
        [inputWithBackslashes]
      )

      expect(result.rows[0].val).toBe(inputWithBackslashes)
    })

    it('should handle null bytes safely', async () => {
      const inputWithNull = "before\x00after"

      const result = await db.query<{ val: string }>(
        'SELECT $1::VARCHAR as val',
        [inputWithNull]
      )

      // DuckDB may truncate at null byte or handle it - either way should be safe
      expect(result.rows[0].val).toBeDefined()
    })

    it('should handle extremely long strings safely', async () => {
      const longString = 'x'.repeat(10000)

      const result = await db.query<{ len: number }>(
        'SELECT length($1::VARCHAR) as len',
        [longString]
      )

      expect(result.rows[0].len).toBe(10000)
    })
  })

  // ============================================================================
  // PREPARED STATEMENT REUSE
  // ============================================================================

  describe('Prepared Statement Reuse', () => {
    beforeAll(async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY,
          name VARCHAR(100),
          category VARCHAR(50)
        )
      `)
      await db.exec(`
        INSERT INTO items VALUES
          (1, 'Apple', 'fruit'),
          (2, 'Banana', 'fruit'),
          (3, 'Carrot', 'vegetable'),
          (4, 'Broccoli', 'vegetable')
      `)
    })

    afterAll(async () => {
      await db.exec('DROP TABLE IF EXISTS items')
    })

    it('should allow reusing the same query with different parameters', async () => {
      // Execute same query multiple times with different parameters
      const result1 = await db.query<{ name: string }>(
        'SELECT name FROM items WHERE category = $1 ORDER BY name',
        ['fruit']
      )

      const result2 = await db.query<{ name: string }>(
        'SELECT name FROM items WHERE category = $1 ORDER BY name',
        ['vegetable']
      )

      expect(result1.rows.map((r) => r.name)).toEqual(['Apple', 'Banana'])
      expect(result2.rows.map((r) => r.name)).toEqual(['Broccoli', 'Carrot'])
    })

    it('should handle prepare() method for statement reuse', async () => {
      // Using the prepare() method for explicit statement reuse
      const stmt = await db.prepare<{ name: string }>(
        'SELECT name FROM items WHERE id = $1'
      )

      try {
        const result1 = await stmt.execute([1])
        const result2 = await stmt.execute([2])
        const result3 = await stmt.execute([3])

        expect(result1.rows[0].name).toBe('Apple')
        expect(result2.rows[0].name).toBe('Banana')
        expect(result3.rows[0].name).toBe('Carrot')
      } finally {
        await stmt.finalize()
      }
    })

    it('should handle bind() and execute() separately', async () => {
      const stmt = await db.prepare<{ name: string; category: string }>(
        'SELECT name, category FROM items WHERE id = $1'
      )

      try {
        stmt.bind([1])
        const result1 = await stmt.execute()

        stmt.bind([4])
        const result2 = await stmt.execute()

        expect(result1.rows[0]).toEqual({ name: 'Apple', category: 'fruit' })
        expect(result2.rows[0]).toEqual({ name: 'Broccoli', category: 'vegetable' })
      } finally {
        await stmt.finalize()
      }
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw on type mismatch - string to integer', async () => {
      await expect(
        db.query('SELECT $1::INTEGER as val', ['not a number'])
      ).rejects.toThrow()
    })

    it('should throw on wrong parameter count - too few', async () => {
      await expect(
        db.query('SELECT $1 + $2 as sum', [1])
      ).rejects.toThrow()
    })

    it('should throw on wrong parameter count - too many', async () => {
      await expect(
        db.query('SELECT $1 as val', [1, 2, 3])
      ).rejects.toThrow()
    })

    it('should throw on invalid parameter index', async () => {
      await expect(
        db.query('SELECT $0 as val', [1]) // $0 is invalid
      ).rejects.toThrow()
    })

    it('should handle prepare() errors gracefully', async () => {
      await expect(
        db.prepare('SELECT * FROM nonexistent_table WHERE id = $1')
      ).rejects.toThrow()
    })

    it('should handle finalize() on already finalized statement', async () => {
      const stmt = await db.prepare('SELECT $1 as val')

      await stmt.finalize()

      // Second finalize should not throw
      await expect(stmt.finalize()).resolves.not.toThrow()
    })

    it('should throw when executing finalized statement', async () => {
      const stmt = await db.prepare<{ val: number }>('SELECT $1::INTEGER as val')
      await stmt.finalize()

      await expect(stmt.execute([1])).rejects.toThrow()
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle query with no parameters', async () => {
      const result = await db.query<{ val: number }>('SELECT 42 as val')

      expect(result.rows[0].val).toBe(42)
    })

    it('should handle empty parameter array', async () => {
      const result = await db.query<{ val: number }>('SELECT 42 as val', [])

      expect(result.rows[0].val).toBe(42)
    })

    it('should handle undefined params (same as no params)', async () => {
      const result = await db.query<{ val: number }>('SELECT 42 as val', undefined)

      expect(result.rows[0].val).toBe(42)
    })

    it('should handle parameter used multiple times', async () => {
      const result = await db.query<{ doubled: number }>(
        'SELECT $1 + $1 as doubled',
        [21]
      )

      expect(result.rows[0].doubled).toBe(42)
    })

    it('should handle parameters out of order', async () => {
      const result = await db.query<{ diff: number }>(
        'SELECT $2 - $1 as diff',
        [10, 50]
      )

      expect(result.rows[0].diff).toBe(40)
    })

    it('should handle many parameters', async () => {
      const params = Array.from({ length: 20 }, (_, i) => i + 1)
      const placeholders = params.map((_, i) => `$${i + 1}`).join(' + ')

      const result = await db.query<{ total: number }>(
        `SELECT ${placeholders} as total`,
        params
      )

      // Sum of 1 to 20 = 210
      expect(result.rows[0].total).toBe(210)
    })

    it('should handle unicode in parameters', async () => {
      const unicodeStr = '你好世界 🌍 Привет мир'

      const result = await db.query<{ val: string }>(
        'SELECT $1::VARCHAR as val',
        [unicodeStr]
      )

      expect(result.rows[0].val).toBe(unicodeStr)
    })

    it('should handle very large numbers', async () => {
      const bigNum = Number.MAX_SAFE_INTEGER

      const result = await db.query<{ val: number }>(
        'SELECT $1::BIGINT as val',
        [bigNum]
      )

      expect(result.rows[0].val).toBe(bigNum)
    })

    it('should handle very small numbers', async () => {
      const smallNum = 0.0000000001

      const result = await db.query<{ val: number }>(
        'SELECT $1::DOUBLE as val',
        [smallNum]
      )

      expect(result.rows[0].val).toBeCloseTo(smallNum, 10)
    })

    it('should handle Infinity gracefully', async () => {
      // Infinity should either be handled or throw a clear error
      await expect(
        db.query('SELECT $1::DOUBLE as val', [Infinity])
      ).rejects.toThrow() // Or could handle as 'inf'
    })

    it('should handle NaN gracefully', async () => {
      // NaN should either be handled or throw a clear error
      await expect(
        db.query('SELECT $1::DOUBLE as val', [NaN])
      ).rejects.toThrow() // Or could handle as 'nan'
    })
  })
})
