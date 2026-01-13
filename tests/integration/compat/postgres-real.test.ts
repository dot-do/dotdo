/**
 * PostgreSQL Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/postgres compat layer with real DO storage,
 * verifying API compatibility with node-postgres (pg).
 *
 * These tests:
 * 1. Verify correct API shape matching pg
 * 2. Verify proper DO storage for SQL state
 * 3. Verify error handling matches pg behavior
 *
 * Run with: npx vitest run tests/integration/compat/postgres-real.test.ts --project=integration
 *
 * @module tests/integration/compat/postgres-real
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('PostgreSQL Compat Layer - Real Integration', () => {
  /**
   * Test Suite 1: API Shape Compatibility with pg
   *
   * Verifies that the PostgreSQL compat layer exports the same API surface
   * as the official node-postgres package.
   */
  describe('API Shape Compatibility', () => {
    it('exports Client class with pg-compatible constructor', async () => {
      const { Client } = await import('../../../compat/postgres/index')

      expect(Client).toBeDefined()
      expect(typeof Client).toBe('function')

      // Should accept connection config like pg
      const client = new Client({
        host: 'localhost',
        database: 'test',
        user: 'postgres',
        password: 'password',
      })
      expect(client).toBeDefined()
    })

    it('exports Pool class with pg-compatible constructor', async () => {
      const { Pool } = await import('../../../compat/postgres/index')

      expect(Pool).toBeDefined()
      expect(typeof Pool).toBe('function')

      // Should accept pool config like pg
      const pool = new Pool({
        connectionString: 'postgres://localhost/test',
        max: 10,
      })
      expect(pool).toBeDefined()
    })

    it('Client exposes connect, query, end methods', async () => {
      const { Client } = await import('../../../compat/postgres/index')
      const client = new Client()

      expect(typeof client.connect).toBe('function')
      expect(typeof client.query).toBe('function')
      expect(typeof client.end).toBe('function')
    })

    it('Pool exposes connect, query, end methods', async () => {
      const { Pool } = await import('../../../compat/postgres/index')
      const pool = new Pool()

      expect(typeof pool.connect).toBe('function')
      expect(typeof pool.query).toBe('function')
      expect(typeof pool.end).toBe('function')
    })

    it('exports DatabaseError class', async () => {
      const { DatabaseError } = await import('../../../compat/postgres/index')

      expect(DatabaseError).toBeDefined()
      expect(typeof DatabaseError).toBe('function')
    })

    it('exports types object for type parsing', async () => {
      const pg = await import('../../../compat/postgres/index')

      expect(pg.types).toBeDefined()
    })
  })

  /**
   * Test Suite 2: Query Execution
   *
   * Verifies that SQL queries execute correctly against DO SQLite storage.
   */
  describe('Query Execution', () => {
    let client: any

    beforeEach(async () => {
      const { Client } = await import('../../../compat/postgres/index')
      client = new Client()
      await client.connect()

      // Create test table
      await client.query(`
        CREATE TABLE IF NOT EXISTS test_users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `)
    })

    afterEach(async () => {
      await client.query('DROP TABLE IF EXISTS test_users')
      await client.end()
    })

    it('executes simple SELECT query', async () => {
      const result = await client.query('SELECT 1 + 1 as sum')

      expect(result).toBeDefined()
      expect(result.rows).toBeDefined()
      expect(result.rows[0].sum).toBe(2)
    })

    it('executes parameterized INSERT with $1, $2 syntax', async () => {
      const result = await client.query(
        'INSERT INTO test_users (id, name, email) VALUES ($1, $2, $3)',
        [1, 'Alice', 'alice@example.com']
      )

      expect(result).toBeDefined()
      expect(result.rowCount).toBeGreaterThanOrEqual(0)
    })

    it('executes SELECT with WHERE clause', async () => {
      await client.query(
        'INSERT INTO test_users (id, name, email) VALUES ($1, $2, $3)',
        [1, 'Alice', 'alice@example.com']
      )

      const result = await client.query(
        'SELECT * FROM test_users WHERE name = $1',
        ['Alice']
      )

      expect(result.rows).toBeDefined()
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('executes UPDATE with parameters', async () => {
      await client.query(
        'INSERT INTO test_users (id, name, email) VALUES ($1, $2, $3)',
        [1, 'Alice', 'alice@example.com']
      )

      const result = await client.query(
        'UPDATE test_users SET name = $1 WHERE id = $2',
        ['Alicia', 1]
      )

      expect(result.rowCount).toBeGreaterThanOrEqual(0)

      const check = await client.query('SELECT name FROM test_users WHERE id = $1', [1])
      expect(check.rows[0].name).toBe('Alicia')
    })

    it('executes DELETE with parameters', async () => {
      await client.query(
        'INSERT INTO test_users (id, name, email) VALUES ($1, $2, $3)',
        [1, 'Alice', 'alice@example.com']
      )

      await client.query('DELETE FROM test_users WHERE id = $1', [1])

      const check = await client.query('SELECT * FROM test_users WHERE id = $1', [1])
      expect(check.rows.length).toBe(0)
    })

    it('returns correct rowCount for mutations', async () => {
      await client.query(
        'INSERT INTO test_users (id, name, email) VALUES ($1, $2, $3)',
        [1, 'Alice', 'alice@example.com']
      )
      await client.query(
        'INSERT INTO test_users (id, name, email) VALUES ($1, $2, $3)',
        [2, 'Bob', 'bob@example.com']
      )

      const result = await client.query(
        'UPDATE test_users SET name = $1 WHERE id > $2',
        ['Updated', 0]
      )

      expect(result.rowCount).toBe(2)
    })
  })

  /**
   * Test Suite 3: Transaction Support
   *
   * Verifies that BEGIN/COMMIT/ROLLBACK work correctly.
   */
  describe('Transaction Support', () => {
    let client: any

    beforeEach(async () => {
      const { Client } = await import('../../../compat/postgres/index')
      client = new Client()
      await client.connect()

      await client.query(`
        CREATE TABLE IF NOT EXISTS tx_test (
          id INTEGER PRIMARY KEY,
          value TEXT
        )
      `)
    })

    afterEach(async () => {
      await client.query('DROP TABLE IF EXISTS tx_test')
      await client.end()
    })

    it('supports BEGIN/COMMIT transaction', async () => {
      await client.query('BEGIN')
      await client.query('INSERT INTO tx_test (id, value) VALUES ($1, $2)', [1, 'committed'])
      await client.query('COMMIT')

      const result = await client.query('SELECT * FROM tx_test WHERE id = $1', [1])
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].value).toBe('committed')
    })

    it('supports ROLLBACK to undo changes', async () => {
      await client.query('BEGIN')
      await client.query('INSERT INTO tx_test (id, value) VALUES ($1, $2)', [1, 'rolled_back'])
      await client.query('ROLLBACK')

      const result = await client.query('SELECT * FROM tx_test WHERE id = $1', [1])
      expect(result.rows.length).toBe(0)
    })

    it('maintains isolation between transactions', async () => {
      // Transaction 1: Insert and commit
      await client.query('BEGIN')
      await client.query('INSERT INTO tx_test (id, value) VALUES ($1, $2)', [1, 'first'])
      await client.query('COMMIT')

      // Transaction 2: Try to insert same id, should fail on commit
      await client.query('BEGIN')
      try {
        await client.query('INSERT INTO tx_test (id, value) VALUES ($1, $2)', [1, 'second'])
        await client.query('COMMIT')
      } catch {
        await client.query('ROLLBACK')
      }

      const result = await client.query('SELECT * FROM tx_test WHERE id = $1', [1])
      expect(result.rows[0].value).toBe('first')
    })
  })

  /**
   * Test Suite 4: Error Handling Compatibility
   *
   * Verifies that errors match pg error patterns.
   */
  describe('Error Handling Compatibility', () => {
    let client: any

    beforeEach(async () => {
      const { Client } = await import('../../../compat/postgres/index')
      client = new Client()
      await client.connect()

      await client.query(`
        CREATE TABLE IF NOT EXISTS error_test (
          id INTEGER PRIMARY KEY,
          unique_col TEXT UNIQUE
        )
      `)
    })

    afterEach(async () => {
      await client.query('DROP TABLE IF EXISTS error_test')
      await client.end()
    })

    it('throws error for syntax errors', async () => {
      await expect(
        client.query('SELEC * FROM error_test')
      ).rejects.toThrow()
    })

    it('throws error for unique constraint violation', async () => {
      await client.query('INSERT INTO error_test (id, unique_col) VALUES ($1, $2)', [1, 'unique'])

      await expect(
        client.query('INSERT INTO error_test (id, unique_col) VALUES ($1, $2)', [2, 'unique'])
      ).rejects.toThrow()
    })

    it('throws error for table not found', async () => {
      await expect(
        client.query('SELECT * FROM nonexistent_table')
      ).rejects.toThrow()
    })

    it('error includes helpful message', async () => {
      try {
        await client.query('INVALID SQL SYNTAX')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBeDefined()
        expect((error as Error).message.length).toBeGreaterThan(0)
      }
    })
  })

  /**
   * Test Suite 5: Pool Behavior
   *
   * Verifies connection pool behavior.
   */
  describe('Pool Behavior', () => {
    it('Pool.query executes without explicit connect', async () => {
      const { Pool } = await import('../../../compat/postgres/index')
      const pool = new Pool()

      const result = await pool.query('SELECT 1 + 1 as sum')
      expect(result.rows[0].sum).toBe(2)

      await pool.end()
    })

    it('Pool.connect returns a client', async () => {
      const { Pool } = await import('../../../compat/postgres/index')
      const pool = new Pool()

      const client = await pool.connect()
      expect(client).toBeDefined()
      expect(typeof client.query).toBe('function')
      expect(typeof client.release).toBe('function')

      client.release()
      await pool.end()
    })

    it('PoolClient.release returns client to pool', async () => {
      const { Pool } = await import('../../../compat/postgres/index')
      const pool = new Pool({ max: 1 })

      const client1 = await pool.connect()
      client1.release()

      // Should be able to get another client from pool
      const client2 = await pool.connect()
      expect(client2).toBeDefined()

      client2.release()
      await pool.end()
    })
  })
})
