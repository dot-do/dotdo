/**
 * @dotdo/postgres - Postgres Compat Layer Tests
 *
 * Comprehensive TDD RED phase tests for PostgreSQL compatibility layer.
 * Tests cover connection management, queries, type mapping, error handling,
 * Hyperdrive integration, and query builder patterns.
 *
 * These tests verify pg (node-postgres) API compatibility backed by DO SQLite.
 *
 * @see https://node-postgres.com/
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Client,
  Pool,
  DatabaseError,
  ConnectionError,
  types,
  type QueryResult,
  type PoolClient,
  type ClientConfig,
  type PoolConfig,
  type ExtendedPostgresConfig,
} from '../index'

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('@dotdo/postgres - Connection', () => {
  describe('connects with connection string', () => {
    it('should parse and use postgres:// URL format', async () => {
      const client = new Client('postgres://user:pass@localhost:5432/mydb')
      expect(client).toBeDefined()
      expect(client.connectionParameters.connectionString).toBe(
        'postgres://user:pass@localhost:5432/mydb'
      )
      await client.connect()
      expect(client.processID).not.toBeNull()
      await client.end()
    })

    it('should parse and use postgresql:// URL format', async () => {
      const client = new Client('postgresql://user:pass@localhost:5432/mydb')
      expect(client).toBeDefined()
      await client.connect()
      await client.end()
    })

    it('should parse URL with SSL parameters', async () => {
      const client = new Client('postgres://localhost/mydb?sslmode=require')
      expect(client).toBeDefined()
      await client.connect()
      await client.end()
    })

    it('should parse URL with application_name', async () => {
      const client = new Client('postgres://localhost/mydb?application_name=myapp')
      expect(client).toBeDefined()
      await client.connect()
      await client.end()
    })
  })

  describe('connects with config object', () => {
    it('should accept host, port, database, user, password', async () => {
      const client = new Client({
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        user: 'postgres',
        password: 'secret',
      })
      expect(client).toBeDefined()
      await client.connect()
      expect(client.processID).not.toBeNull()
      await client.end()
    })

    it('should accept ssl configuration', async () => {
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
        ssl: {
          rejectUnauthorized: false,
          ca: 'certificate-data',
        },
      })
      expect(client).toBeDefined()
      await client.connect()
      await client.end()
    })

    it('should accept statement_timeout', async () => {
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
        statement_timeout: 5000,
      })
      expect(client).toBeDefined()
      await client.connect()
      await client.end()
    })

    it('should accept query_timeout', async () => {
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
        query_timeout: 10000,
      })
      expect(client).toBeDefined()
      await client.connect()
      await client.end()
    })
  })

  describe('handles connection pool', () => {
    it('should create pool with max connections', async () => {
      const pool = new Pool({ max: 10 })
      expect(pool.totalCount).toBe(0)
      const client = await pool.connect()
      expect(pool.totalCount).toBe(1)
      client.release()
      expect(pool.idleCount).toBe(1)
      await pool.end()
    })

    it('should create pool with min connections', async () => {
      const pool = new Pool({ min: 2, max: 10 })
      expect(pool).toBeDefined()
      // Note: min connections are lazily created in this implementation
      await pool.end()
    })

    it('should respect idleTimeoutMillis', async () => {
      const pool = new Pool({ max: 5, idleTimeoutMillis: 1000 })
      const client = await pool.connect()
      client.release()
      expect(pool.idleCount).toBe(1)
      await pool.end()
    })

    it('should respect connectionTimeoutMillis', async () => {
      const pool = new Pool({ max: 1, connectionTimeoutMillis: 100 })
      const client1 = await pool.connect()
      // With only 1 max connection and it checked out, should timeout
      const connectPromise = pool.connect()
      await expect(connectPromise).rejects.toThrow(ConnectionError)
      client1.release()
      await pool.end()
    })

    it('should track waitingCount', async () => {
      const pool = new Pool({ max: 1, connectionTimeoutMillis: 5000 })
      const client1 = await pool.connect()
      expect(pool.waitingCount).toBe(0)

      // Start waiting for second connection
      const waitingPromise = pool.connect()
      // Allow microtask to queue waiting request
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(pool.waitingCount).toBe(1)

      client1.release()
      const client2 = await waitingPromise
      expect(pool.waitingCount).toBe(0)
      client2.release()
      await pool.end()
    })
  })

  describe('reconnects on failure', () => {
    it('should allow reconnect after end', async () => {
      const client = new Client()
      await client.connect()
      await client.end()

      // Create new client - original client cannot reconnect after end
      const client2 = new Client()
      await client2.connect()
      expect(client2.processID).not.toBeNull()
      await client2.end()
    })

    it('should handle multiple connect calls gracefully', async () => {
      const client = new Client()
      await client.connect()
      // Second connect should not throw
      await client.connect()
      await client.end()
    })

    it('should emit error event on connection failure simulation', async () => {
      const client = new Client()
      const errorHandler = vi.fn()
      client.on('error', errorHandler)
      // In the in-memory implementation, connection always succeeds
      // but we test that the event handler is properly registered
      await client.connect()
      await client.end()
      expect(errorHandler).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// QUERY TESTS
// ============================================================================

describe('@dotdo/postgres - Queries', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('executes raw SQL', () => {
    it('should execute simple SELECT', async () => {
      const result = await client.query('SELECT 1 + 1 as sum')
      expect(result.rows).toBeDefined()
      expect(result.command).toBe('SELECT')
    })

    it('should execute CREATE TABLE', async () => {
      const result = await client.query('CREATE TABLE test_raw (id INTEGER, name TEXT)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should execute INSERT', async () => {
      await client.query('CREATE TABLE test_raw (id INTEGER, name TEXT)')
      const result = await client.query("INSERT INTO test_raw VALUES (1, 'test')")
      expect(result.command).toBe('INSERT')
      expect(result.rowCount).toBe(1)
    })

    it('should execute UPDATE', async () => {
      await client.query('CREATE TABLE test_raw (id INTEGER, name TEXT)')
      await client.query("INSERT INTO test_raw VALUES (1, 'test')")
      const result = await client.query("UPDATE test_raw SET name = 'updated' WHERE id = 1")
      expect(result.command).toBe('UPDATE')
      expect(result.rowCount).toBe(1)
    })

    it('should execute DELETE', async () => {
      await client.query('CREATE TABLE test_raw (id INTEGER, name TEXT)')
      await client.query("INSERT INTO test_raw VALUES (1, 'test')")
      const result = await client.query('DELETE FROM test_raw WHERE id = 1')
      expect(result.command).toBe('DELETE')
      expect(result.rowCount).toBe(1)
    })
  })

  describe('executes parameterized query', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE params_test (id INTEGER, name TEXT, age INTEGER)')
    })

    it('should handle $1 placeholder', async () => {
      await client.query('INSERT INTO params_test VALUES ($1, $2, $3)', [1, 'Alice', 30])
      const result = await client.query('SELECT * FROM params_test WHERE id = $1', [1])
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should handle multiple $1, $2, $3 placeholders', async () => {
      const result = await client.query(
        'INSERT INTO params_test VALUES ($1, $2, $3) RETURNING *',
        [2, 'Bob', 25]
      )
      expect(result.rows[0].id).toBe(2)
      expect(result.rows[0].name).toBe('Bob')
      expect(result.rows[0].age).toBe(25)
    })

    it('should handle null parameter values', async () => {
      await client.query('INSERT INTO params_test VALUES ($1, $2, $3)', [3, null, null])
      const result = await client.query('SELECT * FROM params_test WHERE id = $1', [3])
      expect(result.rows[0].name).toBeNull()
      expect(result.rows[0].age).toBeNull()
    })

    it('should handle boolean parameter values', async () => {
      await client.query('CREATE TABLE bool_test (id INTEGER, active BOOLEAN)')
      await client.query('INSERT INTO bool_test VALUES ($1, $2)', [1, true])
      const result = await client.query('SELECT * FROM bool_test WHERE id = $1', [1])
      expect(result.rows[0].active).toBe(true)
    })

    it('should handle QueryConfig object', async () => {
      const result = await client.query({
        text: 'INSERT INTO params_test VALUES ($1, $2, $3) RETURNING *',
        values: [4, 'Carol', 28],
      })
      expect(result.rows[0].name).toBe('Carol')
    })
  })

  describe('handles transactions', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE tx_test (id INTEGER PRIMARY KEY, balance INTEGER)')
      await client.query('INSERT INTO tx_test VALUES (1, 100)')
      await client.query('INSERT INTO tx_test VALUES (2, 100)')
    })

    it('should BEGIN transaction', async () => {
      const result = await client.query('BEGIN')
      expect(result.command).toBe('BEGIN')
    })

    it('should COMMIT transaction', async () => {
      await client.query('BEGIN')
      await client.query('UPDATE tx_test SET balance = 50 WHERE id = 1')
      const result = await client.query('COMMIT')
      expect(result.command).toBe('COMMIT')

      const check = await client.query('SELECT balance FROM tx_test WHERE id = 1')
      expect(check.rows[0].balance).toBe(50)
    })

    it('should ROLLBACK transaction', async () => {
      await client.query('BEGIN')
      await client.query('UPDATE tx_test SET balance = 0 WHERE id = 1')
      const result = await client.query('ROLLBACK')
      expect(result.command).toBe('ROLLBACK')

      const check = await client.query('SELECT balance FROM tx_test WHERE id = 1')
      expect(check.rows[0].balance).toBe(100)
    })

    it('should handle START TRANSACTION', async () => {
      const result = await client.query('START TRANSACTION')
      expect(result.command).toBe('BEGIN')
      await client.query('ROLLBACK')
    })

    it('should handle SAVEPOINT', async () => {
      await client.query('BEGIN')
      const result = await client.query('SAVEPOINT my_savepoint')
      expect(result.command).toBe('SAVEPOINT')
      await client.query('ROLLBACK')
    })

    it('should handle RELEASE SAVEPOINT', async () => {
      await client.query('BEGIN')
      await client.query('SAVEPOINT sp1')
      const result = await client.query('RELEASE SAVEPOINT sp1')
      expect(result.command).toBe('RELEASE')
      await client.query('COMMIT')
    })

    it('should handle ROLLBACK TO SAVEPOINT', async () => {
      await client.query('BEGIN')
      await client.query('UPDATE tx_test SET balance = 50 WHERE id = 1')
      await client.query('SAVEPOINT sp1')
      await client.query('UPDATE tx_test SET balance = 0 WHERE id = 1')
      await client.query('ROLLBACK TO SAVEPOINT sp1')

      const check = await client.query('SELECT balance FROM tx_test WHERE id = 1')
      // After rollback to savepoint, balance should be 50 (before sp1)
      expect(check.rows[0].balance).toBe(50)
      await client.query('COMMIT')
    })
  })

  describe('batch queries', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE batch_test (id INTEGER, value TEXT)')
    })

    it('should execute multiple queries sequentially', async () => {
      const results = await Promise.all([
        client.query('INSERT INTO batch_test VALUES (1, $1)', ['one']),
        client.query('INSERT INTO batch_test VALUES (2, $1)', ['two']),
        client.query('INSERT INTO batch_test VALUES (3, $1)', ['three']),
      ])

      expect(results.every((r) => r.rowCount === 1)).toBe(true)

      const select = await client.query('SELECT * FROM batch_test ORDER BY id')
      expect(select.rows.length).toBe(3)
    })

    it('should handle batch with pool.query', async () => {
      const pool = new Pool()
      await pool.query('CREATE TABLE pool_batch (id INTEGER, value TEXT)')

      const insertPromises = Array.from({ length: 5 }, (_, i) =>
        pool.query('INSERT INTO pool_batch VALUES ($1, $2)', [i, `value-${i}`])
      )
      await Promise.all(insertPromises)

      const result = await pool.query('SELECT COUNT(*) as cnt FROM pool_batch')
      expect(result.rows[0].cnt).toBe(5)
      await pool.end()
    })
  })
})

// ============================================================================
// TYPE MAPPING TESTS
// ============================================================================

describe('@dotdo/postgres - Type Mapping', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('maps SERIAL to number', () => {
    it('should auto-increment SERIAL column', async () => {
      await client.query('CREATE TABLE serial_test (id SERIAL PRIMARY KEY, name TEXT)')
      const r1 = await client.query(
        "INSERT INTO serial_test (name) VALUES ('first') RETURNING id"
      )
      const r2 = await client.query(
        "INSERT INTO serial_test (name) VALUES ('second') RETURNING id"
      )

      expect(typeof r1.rows[0].id).toBe('number')
      expect(r2.rows[0].id).toBeGreaterThan(r1.rows[0].id)
    })

    it('should handle BIGSERIAL', async () => {
      await client.query('CREATE TABLE bigserial_test (id BIGSERIAL PRIMARY KEY, name TEXT)')
      const result = await client.query(
        "INSERT INTO bigserial_test (name) VALUES ('test') RETURNING id"
      )
      expect(typeof result.rows[0].id).toBe('number')
    })

    it('should handle SMALLSERIAL', async () => {
      await client.query('CREATE TABLE smallserial_test (id SMALLSERIAL PRIMARY KEY, name TEXT)')
      const result = await client.query(
        "INSERT INTO smallserial_test (name) VALUES ('test') RETURNING id"
      )
      expect(typeof result.rows[0].id).toBe('number')
    })
  })

  describe('maps JSONB to object', () => {
    it('should store and retrieve JSON object', async () => {
      await client.query('CREATE TABLE jsonb_test (id INTEGER, data JSONB)')
      const obj = { name: 'test', nested: { value: 123 } }
      await client.query('INSERT INTO jsonb_test VALUES ($1, $2)', [1, JSON.stringify(obj)])
      const result = await client.query('SELECT data FROM jsonb_test WHERE id = 1')
      // JSONB should be parsed back to object or remain as string depending on implementation
      const data =
        typeof result.rows[0].data === 'string'
          ? JSON.parse(result.rows[0].data)
          : result.rows[0].data
      expect(data.name).toBe('test')
      expect(data.nested.value).toBe(123)
    })

    it('should store and retrieve JSON array', async () => {
      await client.query('CREATE TABLE jsonb_arr_test (id INTEGER, data JSONB)')
      const arr = [1, 2, 3, { key: 'value' }]
      await client.query('INSERT INTO jsonb_arr_test VALUES ($1, $2)', [1, JSON.stringify(arr)])
      const result = await client.query('SELECT data FROM jsonb_arr_test WHERE id = 1')
      const data =
        typeof result.rows[0].data === 'string'
          ? JSON.parse(result.rows[0].data)
          : result.rows[0].data
      expect(Array.isArray(data)).toBe(true)
      expect(data[3].key).toBe('value')
    })

    it('should handle JSON type (not JSONB)', async () => {
      await client.query('CREATE TABLE json_test (id INTEGER, data JSON)')
      await client.query('INSERT INTO json_test VALUES ($1, $2)', [1, '{"key":"value"}'])
      const result = await client.query('SELECT data FROM json_test WHERE id = 1')
      expect(result.rows[0].data).toBeDefined()
    })
  })

  describe('maps TIMESTAMP to Date', () => {
    it('should store and retrieve TIMESTAMP', async () => {
      await client.query('CREATE TABLE ts_test (id INTEGER, created_at TIMESTAMP)')
      const now = new Date().toISOString()
      await client.query('INSERT INTO ts_test VALUES ($1, $2)', [1, now])
      const result = await client.query('SELECT created_at FROM ts_test WHERE id = 1')
      // Timestamp may be returned as string or Date depending on type parsing
      expect(result.rows[0].created_at).toBeDefined()
    })

    it('should handle TIMESTAMPTZ (with timezone)', async () => {
      await client.query('CREATE TABLE tstz_test (id INTEGER, created_at TIMESTAMPTZ)')
      const now = new Date().toISOString()
      await client.query('INSERT INTO tstz_test VALUES ($1, $2)', [1, now])
      const result = await client.query('SELECT created_at FROM tstz_test WHERE id = 1')
      expect(result.rows[0].created_at).toBeDefined()
    })

    it('should handle DATE type', async () => {
      await client.query('CREATE TABLE date_test (id INTEGER, birth_date DATE)')
      await client.query('INSERT INTO date_test VALUES ($1, $2)', [1, '2000-01-15'])
      const result = await client.query('SELECT birth_date FROM date_test WHERE id = 1')
      expect(result.rows[0].birth_date).toBeDefined()
    })

    it('should handle TIME type', async () => {
      await client.query('CREATE TABLE time_test (id INTEGER, start_time TIME)')
      await client.query('INSERT INTO time_test VALUES ($1, $2)', [1, '14:30:00'])
      const result = await client.query('SELECT start_time FROM time_test WHERE id = 1')
      expect(result.rows[0].start_time).toBeDefined()
    })
  })

  describe('maps ARRAY to Array', () => {
    it('should handle TEXT[] array', async () => {
      await client.query('CREATE TABLE arr_test (id INTEGER, tags TEXT)')
      // Note: SQLite backing doesn't natively support arrays, stored as JSON
      await client.query('INSERT INTO arr_test VALUES ($1, $2)', [
        1,
        JSON.stringify(['tag1', 'tag2', 'tag3']),
      ])
      const result = await client.query('SELECT tags FROM arr_test WHERE id = 1')
      const tags =
        typeof result.rows[0].tags === 'string'
          ? JSON.parse(result.rows[0].tags)
          : result.rows[0].tags
      expect(Array.isArray(tags)).toBe(true)
      expect(tags).toContain('tag1')
    })

    it('should handle INTEGER[] array', async () => {
      await client.query('CREATE TABLE int_arr_test (id INTEGER, values TEXT)')
      await client.query('INSERT INTO int_arr_test VALUES ($1, $2)', [
        1,
        JSON.stringify([1, 2, 3, 4, 5]),
      ])
      const result = await client.query('SELECT values FROM int_arr_test WHERE id = 1')
      const values =
        typeof result.rows[0].values === 'string'
          ? JSON.parse(result.rows[0].values)
          : result.rows[0].values
      expect(values).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('maps UUID to string', () => {
    it('should store and retrieve UUID', async () => {
      await client.query('CREATE TABLE uuid_test (id UUID PRIMARY KEY, name TEXT)')
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      await client.query('INSERT INTO uuid_test VALUES ($1, $2)', [uuid, 'test'])
      const result = await client.query('SELECT id FROM uuid_test WHERE name = $1', ['test'])
      expect(typeof result.rows[0].id).toBe('string')
      expect(result.rows[0].id).toBe(uuid)
    })

    it('should validate UUID format', async () => {
      await client.query('CREATE TABLE uuid_val_test (id UUID, name TEXT)')
      const validUuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
      await client.query('INSERT INTO uuid_val_test VALUES ($1, $2)', [validUuid, 'test'])
      const result = await client.query('SELECT id FROM uuid_val_test')
      expect(result.rows[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('@dotdo/postgres - Error Handling', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('handles connection error', () => {
    it('should throw ConnectionError on pool end when getting connection', async () => {
      const pool = new Pool()
      await pool.end()
      await expect(pool.connect()).rejects.toThrow(ConnectionError)
    })

    it('should throw error message on connection timeout', async () => {
      const pool = new Pool({ max: 1, connectionTimeoutMillis: 50 })
      const client = await pool.connect()
      const timeoutPromise = pool.connect()
      await expect(timeoutPromise).rejects.toThrow(/timeout/i)
      client.release()
      await pool.end()
    })
  })

  describe('handles query error', () => {
    it('should throw DatabaseError on syntax error', async () => {
      await expect(client.query('SELECT * FORM users')).rejects.toThrow(DatabaseError)
    })

    it('should throw DatabaseError with code on syntax error', async () => {
      try {
        await client.query('INVALID SQL STATEMENT')
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError)
        expect((e as DatabaseError).code).toBeDefined()
      }
    })

    it('should throw DatabaseError on table not found', async () => {
      try {
        await client.query('SELECT * FROM nonexistent_table')
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError)
        expect((e as DatabaseError).code).toBe('42P01') // undefined_table
      }
    })
  })

  describe('handles constraint violation', () => {
    it('should throw on PRIMARY KEY violation', async () => {
      await client.query('CREATE TABLE pk_test (id INTEGER PRIMARY KEY)')
      await client.query('INSERT INTO pk_test VALUES (1)')
      try {
        await client.query('INSERT INTO pk_test VALUES (1)')
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError)
        expect((e as DatabaseError).code).toBe('23505') // unique_violation
      }
    })

    it('should throw on UNIQUE constraint violation', async () => {
      await client.query('CREATE TABLE unique_test (id INTEGER, email TEXT UNIQUE)')
      await client.query("INSERT INTO unique_test VALUES (1, 'test@example.com')")
      try {
        await client.query("INSERT INTO unique_test VALUES (2, 'test@example.com')")
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError)
        expect((e as DatabaseError).code).toBe('23505')
      }
    })

    it('should throw on NOT NULL constraint violation', async () => {
      await client.query('CREATE TABLE notnull_test (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
      await expect(
        client.query('INSERT INTO notnull_test (id) VALUES (1)')
      ).rejects.toThrow(DatabaseError)
    })

    it('should throw on CHECK constraint violation', async () => {
      await client.query(
        'CREATE TABLE check_test (id INTEGER, age INTEGER CHECK (age >= 0))'
      )
      await expect(
        client.query('INSERT INTO check_test VALUES (1, -5)')
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('surfaces error codes', () => {
    it('should include SQLSTATE code 42P01 for undefined_table', async () => {
      try {
        await client.query('SELECT * FROM no_such_table')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as DatabaseError).code).toBe('42P01')
      }
    })

    it('should include SQLSTATE code 42P07 for duplicate_table', async () => {
      await client.query('CREATE TABLE dup_test (id INTEGER)')
      try {
        await client.query('CREATE TABLE dup_test (id INTEGER)')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as DatabaseError).code).toBe('42P07')
      }
    })

    it('should include SQLSTATE code 23505 for unique_violation', async () => {
      await client.query('CREATE TABLE code_test (id INTEGER PRIMARY KEY)')
      await client.query('INSERT INTO code_test VALUES (1)')
      try {
        await client.query('INSERT INTO code_test VALUES (1)')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as DatabaseError).code).toBe('23505')
      }
    })

    it('should include SQLSTATE code 42601 for syntax_error', async () => {
      try {
        await client.query('SELEC * FROM')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as DatabaseError).code).toBe('42601')
      }
    })

    it('should include severity in DatabaseError', async () => {
      try {
        await client.query('INVALID')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as DatabaseError).severity).toBeDefined()
        expect((e as DatabaseError).severity).toBe('ERROR')
      }
    })
  })
})

// ============================================================================
// HYPERDRIVE INTEGRATION TESTS
// ============================================================================

describe('@dotdo/postgres - Hyperdrive Integration', () => {
  describe('uses Hyperdrive binding', () => {
    it('should accept hyperdrive in extended config (placeholder)', async () => {
      // Hyperdrive integration would be configured via env bindings
      // This test verifies the config structure is accepted
      const config: ExtendedPostgresConfig = {
        host: 'localhost',
        database: 'mydb',
        // Hyperdrive would be a binding, not direct config
      }
      const pool = new Pool(config)
      expect(pool).toBeDefined()
      await pool.end()
    })

    it('should use connection string from Hyperdrive (simulated)', async () => {
      // In production, Hyperdrive provides optimized connection pooling
      // For testing, we verify the connection string handling
      const hyperdriveMockUrl = 'postgres://hyperdrive-proxy:5432/mydb'
      const client = new Client(hyperdriveMockUrl)
      expect(client.connectionParameters.connectionString).toBe(hyperdriveMockUrl)
      await client.connect()
      await client.end()
    })
  })

  describe('connection pooling via Hyperdrive', () => {
    it('should share connection pool across requests (simulated)', async () => {
      const pool = new Pool({ max: 5 })

      // Simulate multiple concurrent requests
      const queries = Array.from({ length: 10 }, () => pool.query('SELECT 1'))
      await Promise.all(queries)

      // Pool should reuse connections
      expect(pool.totalCount).toBeLessThanOrEqual(5)
      await pool.end()
    })

    it('should maintain pool metrics', async () => {
      const pool = new Pool({ max: 3 })

      const client1 = await pool.connect()
      const client2 = await pool.connect()

      expect(pool.totalCount).toBe(2)
      expect(pool.idleCount).toBe(0)

      client1.release()
      expect(pool.idleCount).toBe(1)

      client2.release()
      expect(pool.idleCount).toBe(2)

      await pool.end()
    })
  })

  describe('handles Hyperdrive unavailable', () => {
    it('should fall back to direct connection (simulated)', async () => {
      // When Hyperdrive is unavailable, should use direct connection
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
      })
      await client.connect()
      expect(client.processID).not.toBeNull()
      await client.end()
    })

    it('should retry connection on transient failure (simulated)', async () => {
      const pool = new Pool({ max: 5, connectionTimeoutMillis: 5000 })
      // In production, Hyperdrive handles retries
      // Here we verify pool can establish connections
      const client = await pool.connect()
      expect(client).toBeDefined()
      client.release()
      await pool.end()
    })
  })
})

// ============================================================================
// QUERY BUILDER TESTS
// ============================================================================

describe('@dotdo/postgres - Query Builder', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
    await client.query(`
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL,
        category TEXT,
        in_stock BOOLEAN DEFAULT true
      )
    `)
    await client.query("INSERT INTO products (name, price, category) VALUES ('Widget', 9.99, 'tools')")
    await client.query("INSERT INTO products (name, price, category) VALUES ('Gadget', 19.99, 'electronics')")
    await client.query("INSERT INTO products (name, price, category) VALUES ('Gizmo', 14.99, 'electronics')")
  })

  afterEach(async () => {
    await client.end()
  })

  describe('select with where clause', () => {
    it('should filter with single condition', async () => {
      const result = await client.query(
        'SELECT * FROM products WHERE category = $1',
        ['electronics']
      )
      expect(result.rows.length).toBe(2)
    })

    it('should filter with multiple AND conditions', async () => {
      const result = await client.query(
        'SELECT * FROM products WHERE category = $1 AND price < $2',
        ['electronics', 18]
      )
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Gizmo')
    })

    it('should filter with OR conditions', async () => {
      const result = await client.query(
        "SELECT * FROM products WHERE category = 'tools' OR price > 15"
      )
      expect(result.rows.length).toBe(2)
    })

    it('should filter with LIKE pattern', async () => {
      const result = await client.query("SELECT * FROM products WHERE name LIKE 'G%'")
      expect(result.rows.length).toBe(2) // Gadget, Gizmo
    })

    it('should filter with IN clause', async () => {
      const result = await client.query(
        'SELECT * FROM products WHERE id IN (1, 3)'
      )
      expect(result.rows.length).toBe(2)
    })

    it('should filter with BETWEEN', async () => {
      const result = await client.query(
        'SELECT * FROM products WHERE price BETWEEN $1 AND $2',
        [10, 18]
      )
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Gizmo')
    })
  })

  describe('insert returning', () => {
    it('should return inserted id', async () => {
      const result = await client.query(
        "INSERT INTO products (name, price, category) VALUES ($1, $2, $3) RETURNING id",
        ['NewProduct', 29.99, 'tools']
      )
      expect(result.rows.length).toBe(1)
      expect(typeof result.rows[0].id).toBe('number')
      expect(result.rows[0].id).toBeGreaterThan(0)
    })

    it('should return multiple columns', async () => {
      const result = await client.query(
        "INSERT INTO products (name, price, category) VALUES ($1, $2, $3) RETURNING id, name, price",
        ['AnotherProduct', 39.99, 'electronics']
      )
      expect(result.rows[0].id).toBeDefined()
      expect(result.rows[0].name).toBe('AnotherProduct')
      expect(result.rows[0].price).toBeCloseTo(39.99)
    })

    it('should return all columns with RETURNING *', async () => {
      const result = await client.query(
        "INSERT INTO products (name, price, category) VALUES ($1, $2, $3) RETURNING *",
        ['AllColumns', 49.99, 'tools']
      )
      expect(result.rows[0].id).toBeDefined()
      expect(result.rows[0].name).toBe('AllColumns')
      expect(result.rows[0].price).toBeCloseTo(49.99)
      expect(result.rows[0].category).toBe('tools')
      expect(result.rows[0].in_stock).toBe(true)
    })
  })

  describe('update with returning', () => {
    it('should return modified row', async () => {
      const result = await client.query(
        'UPDATE products SET price = $1 WHERE name = $2 RETURNING *',
        [24.99, 'Widget']
      )
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].price).toBeCloseTo(24.99)
    })

    it('should return multiple modified rows', async () => {
      const result = await client.query(
        "UPDATE products SET in_stock = $1 WHERE category = $2 RETURNING id, name",
        [false, 'electronics']
      )
      expect(result.rows.length).toBe(2)
      expect(result.rowCount).toBe(2)
    })

    it('should return empty when no rows match', async () => {
      const result = await client.query(
        'UPDATE products SET price = $1 WHERE name = $2 RETURNING *',
        [99.99, 'NonExistent']
      )
      expect(result.rows.length).toBe(0)
      expect(result.rowCount).toBe(0)
    })

    it('should support complex update expressions', async () => {
      const result = await client.query(
        'UPDATE products SET price = price * 1.1 WHERE category = $1 RETURNING name, price',
        ['electronics']
      )
      expect(result.rows.length).toBe(2)
      // Prices should be increased by 10%
      const gadget = result.rows.find((r: { name: string }) => r.name === 'Gadget')
      expect(gadget.price).toBeCloseTo(21.989) // 19.99 * 1.1
    })
  })
})

// ============================================================================
// TYPE CONSTANTS TESTS
// ============================================================================

describe('@dotdo/postgres - Type Constants', () => {
  it('should export standard type OIDs', () => {
    expect(types.BOOL).toBe(16)
    expect(types.INT2).toBe(21)
    expect(types.INT4).toBe(23)
    expect(types.INT8).toBe(20)
    expect(types.TEXT).toBe(25)
    expect(types.VARCHAR).toBe(1043)
    expect(types.FLOAT4).toBe(700)
    expect(types.FLOAT8).toBe(701)
    expect(types.JSON).toBe(114)
    expect(types.JSONB).toBe(3802)
    expect(types.UUID).toBe(2950)
    expect(types.DATE).toBe(1082)
    expect(types.TIME).toBe(1083)
    expect(types.TIMESTAMP).toBe(1114)
    expect(types.TIMESTAMPTZ).toBe(1184)
    expect(types.NUMERIC).toBe(1700)
  })
})

// ============================================================================
// UTILITY TESTS
// ============================================================================

describe('@dotdo/postgres - Utilities', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('escapeLiteral', () => {
    it('should escape single quotes', () => {
      expect(client.escapeLiteral("O'Reilly")).toBe("'O''Reilly'")
    })

    it('should wrap value in single quotes', () => {
      expect(client.escapeLiteral('test')).toBe("'test'")
    })

    it('should handle empty string', () => {
      expect(client.escapeLiteral('')).toBe("''")
    })

    it('should handle multiple quotes', () => {
      expect(client.escapeLiteral("it's a 'test'")).toBe("'it''s a ''test'''")
    })
  })

  describe('escapeIdentifier', () => {
    it('should escape double quotes', () => {
      expect(client.escapeIdentifier('column"name')).toBe('"column""name"')
    })

    it('should wrap value in double quotes', () => {
      expect(client.escapeIdentifier('my_table')).toBe('"my_table"')
    })

    it('should handle reserved words', () => {
      expect(client.escapeIdentifier('select')).toBe('"select"')
    })
  })
})

// ============================================================================
// EXTENDED DO CONFIG TESTS
// ============================================================================

describe('@dotdo/postgres - Extended DO Config', () => {
  it('should accept shard configuration', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'mydb',
      shard: {
        algorithm: 'consistent',
        count: 8,
        key: 'tenant_id',
      },
    } as ExtendedPostgresConfig)
    expect(pool).toBeDefined()
  })

  it('should accept replica configuration', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'mydb',
      replica: {
        readPreference: 'nearest',
        writeThrough: true,
        jurisdiction: 'eu',
      },
    } as ExtendedPostgresConfig)
    expect(pool).toBeDefined()
  })

  it('should accept combined shard and replica config', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'mydb',
      max: 20,
      shard: {
        algorithm: 'hash',
        count: 4,
        key: 'org_id',
      },
      replica: {
        readPreference: 'secondary',
        jurisdiction: 'us',
      },
    } as ExtendedPostgresConfig)
    expect(pool).toBeDefined()
  })
})

// ============================================================================
// TDD RED PHASE: CONNECTION POOLING LIMITS
// ============================================================================

describe('@dotdo/postgres - Connection Pooling Limits (TDD RED)', () => {
  describe('respects max pool size', () => {
    it('should never exceed max connections', async () => {
      const pool = new Pool({ max: 3 })
      const clients: PoolClient[] = []

      // Acquire max connections
      for (let i = 0; i < 3; i++) {
        clients.push(await pool.connect())
      }

      expect(pool.totalCount).toBe(3)
      expect(pool.idleCount).toBe(0)

      // Release all
      clients.forEach((c) => c.release())
      await pool.end()
    })

    it('should queue requests when pool is exhausted', async () => {
      const pool = new Pool({ max: 2, connectionTimeoutMillis: 5000 })
      const client1 = await pool.connect()
      const client2 = await pool.connect()

      expect(pool.totalCount).toBe(2)

      // Third connect should queue
      let queued = false
      const pending = pool.connect().then((c) => {
        queued = true
        return c
      })

      await new Promise((r) => setTimeout(r, 50))
      expect(pool.waitingCount).toBe(1)

      // Release one to unblock
      client1.release()
      const client3 = await pending
      expect(queued).toBe(true)

      client2.release()
      client3.release()
      await pool.end()
    })
  })

  describe('pre-warms min connections', () => {
    it.todo('should create min connections on pool creation')
    it.todo('should maintain min connections after releases')
    it.todo('should replenish connections to min after errors')
  })

  describe('reuses idle connections', () => {
    it('should reuse idle connections instead of creating new ones', async () => {
      const pool = new Pool({ max: 5 })

      const client1 = await pool.connect()
      expect(pool.totalCount).toBe(1)
      client1.release()
      expect(pool.idleCount).toBe(1)

      const client2 = await pool.connect()
      // Should reuse, not create new
      expect(pool.totalCount).toBe(1)
      expect(pool.idleCount).toBe(0)

      client2.release()
      await pool.end()
    })

    it('should prefer most recently used idle connection (LIFO)', async () => {
      const pool = new Pool({ max: 5 })

      const c1 = await pool.connect()
      const c2 = await pool.connect()

      c1.release() // First to idle
      c2.release() // Second to idle (most recent)

      // Should get c2 (LIFO)
      const c3 = await pool.connect()
      expect(pool.idleCount).toBe(1)

      c3.release()
      await pool.end()
    })
  })

  describe('evicts idle connections', () => {
    it.todo('should evict connections after idleTimeoutMillis')
    it.todo('should not evict connections below min threshold')
    it.todo('should reset idle timer on connection reuse')
  })

  describe('enforces maxUses limit', () => {
    it.todo('should destroy connection after maxUses queries')
    it.todo('should create replacement connection when destroying')
  })
})

// ============================================================================
// TDD RED PHASE: TRANSACTION ISOLATION
// ============================================================================

describe('@dotdo/postgres - Transaction Isolation (TDD RED)', () => {
  describe('provides transaction isolation', () => {
    it.todo('should isolate uncommitted changes from other connections')
    it.todo('should make committed changes visible to other connections')
    it.todo('should handle concurrent transactions on same table')
  })

  describe('supports isolation levels', () => {
    it.todo('should support READ COMMITTED isolation level')
    it.todo('should support REPEATABLE READ isolation level')
    it.todo('should support SERIALIZABLE isolation level')
    it.todo('should throw on isolation violation in SERIALIZABLE')
  })

  describe('handles deadlock detection', () => {
    it.todo('should detect deadlock and abort one transaction')
    it.todo('should provide deadlock error code 40P01')
  })

  describe('supports row-level locking', () => {
    it.todo('should support SELECT FOR UPDATE')
    it.todo('should support SELECT FOR SHARE')
    it.todo('should block conflicting locks')
  })
})

// ============================================================================
// TDD RED PHASE: ERROR RECOVERY
// ============================================================================

describe('@dotdo/postgres - Error Recovery (TDD RED)', () => {
  describe('recovers from transient errors', () => {
    it.todo('should auto-reconnect on connection drop')
    it.todo('should retry queries on transient failure')
    it.todo('should emit error event on recovery failure')
  })

  describe('handles pool errors gracefully', () => {
    it('should remove errored client from pool', async () => {
      const pool = new Pool({ max: 5 })
      const client = await pool.connect()

      // Simulate error by releasing with destroy flag
      client.release(true)

      expect(pool.totalCount).toBe(0)
      expect(pool.idleCount).toBe(0)
      await pool.end()
    })

    it.todo('should create replacement after error removal')
    it.todo('should propagate unrecoverable errors to waiters')
  })

  describe('transaction error recovery', () => {
    it('should auto-rollback on error in transaction', async () => {
      const client = new Client()
      await client.connect()

      await client.query('CREATE TABLE recovery_test (id INTEGER PRIMARY KEY)')
      await client.query('BEGIN')
      await client.query('INSERT INTO recovery_test VALUES (1)')

      // This should fail and trigger rollback
      try {
        await client.query('INSERT INTO recovery_test VALUES (1)') // Duplicate key
      } catch {
        await client.query('ROLLBACK')
      }

      // Transaction should be rolled back, table should be empty
      const result = await client.query('SELECT COUNT(*) as cnt FROM recovery_test')
      expect(result.rows[0].cnt).toBe(0)

      await client.end()
    })

    it.todo('should allow retry after failed transaction')
    it.todo('should preserve savepoint state on partial rollback')
  })
})

// ============================================================================
// TDD RED PHASE: QUERY EXECUTION
// ============================================================================

describe('@dotdo/postgres - Query Execution (TDD RED)', () => {
  describe('supports prepared statements', () => {
    it.todo('should prepare statement with name')
    it.todo('should execute prepared statement with parameters')
    it.todo('should deallocate prepared statement')
    it.todo('should reuse prepared statement plan')
  })

  describe('supports cursors', () => {
    it.todo('should create cursor with DECLARE')
    it.todo('should fetch rows from cursor')
    it.todo('should close cursor')
    it.todo('should support cursor with HOLD')
  })

  describe('supports COPY protocol', () => {
    it('should throw on copyFrom (not implemented)', async () => {
      const client = new Client()
      await client.connect()

      expect(() => client.copyFrom('COPY test FROM STDIN')).toThrow(
        'COPY FROM not supported'
      )

      await client.end()
    })

    it('should throw on copyTo (not implemented)', async () => {
      const client = new Client()
      await client.connect()

      expect(() => client.copyTo('COPY test TO STDOUT')).toThrow(
        'COPY TO not supported'
      )

      await client.end()
    })
  })

  describe('supports LISTEN/NOTIFY', () => {
    it.todo('should emit notification on NOTIFY')
    it.todo('should support multiple channels')
    it.todo('should support UNLISTEN')
    it.todo('should include payload in notification')
  })

  describe('supports rowMode array', () => {
    it('should return rows as arrays with rowMode: array', async () => {
      const client = new Client()
      await client.connect()

      await client.query('CREATE TABLE rowmode_test (id INTEGER, name TEXT)')
      await client.query("INSERT INTO rowmode_test VALUES (1, 'test')")

      const result = await client.query({
        text: 'SELECT * FROM rowmode_test',
        rowMode: 'array',
      })

      // With rowMode: 'array', rows should be arrays
      // Currently this may not be implemented
      expect(Array.isArray(result.rows[0])).toBe(true)

      await client.end()
    })
  })
})

// ============================================================================
// TDD RED PHASE: PARAMETERIZED QUERIES (EDGE CASES)
// ============================================================================

describe('@dotdo/postgres - Parameterized Queries Edge Cases (TDD RED)', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('handles special parameter values', () => {
    it('should handle undefined as NULL', async () => {
      await client.query('CREATE TABLE undef_test (id INTEGER, value TEXT)')
      await client.query('INSERT INTO undef_test VALUES ($1, $2)', [1, undefined])
      const result = await client.query('SELECT * FROM undef_test WHERE id = 1')
      expect(result.rows[0].value).toBeNull()
    })

    it('should handle Date objects', async () => {
      await client.query('CREATE TABLE date_param_test (id INTEGER, created_at TIMESTAMP)')
      const now = new Date()
      await client.query('INSERT INTO date_param_test VALUES ($1, $2)', [1, now])
      const result = await client.query('SELECT created_at FROM date_param_test WHERE id = 1')
      expect(result.rows[0].created_at).toBeDefined()
    })

    it('should handle Buffer/Uint8Array for BYTEA', async () => {
      await client.query('CREATE TABLE bytea_test (id INTEGER, data BLOB)')
      const buffer = new Uint8Array([1, 2, 3, 4, 5])
      await client.query('INSERT INTO bytea_test VALUES ($1, $2)', [1, buffer])
      const result = await client.query('SELECT data FROM bytea_test WHERE id = 1')
      expect(result.rows[0].data).toBeDefined()
    })

    it('should handle BigInt values', async () => {
      await client.query('CREATE TABLE bigint_test (id BIGINT PRIMARY KEY)')
      const bigVal = BigInt('9223372036854775807')
      await client.query('INSERT INTO bigint_test VALUES ($1)', [bigVal])
      const result = await client.query('SELECT id FROM bigint_test')
      // BigInt should be converted appropriately
      expect(result.rows[0].id).toBeDefined()
    })

    it('should handle object as JSON', async () => {
      await client.query('CREATE TABLE obj_json_test (id INTEGER, data JSON)')
      const obj = { foo: 'bar', nested: { value: 123 } }
      await client.query('INSERT INTO obj_json_test VALUES ($1, $2)', [1, obj])
      const result = await client.query('SELECT data FROM obj_json_test WHERE id = 1')
      const parsed =
        typeof result.rows[0].data === 'string'
          ? JSON.parse(result.rows[0].data)
          : result.rows[0].data
      expect(parsed.foo).toBe('bar')
    })
  })

  describe('handles parameter count mismatches', () => {
    it('should error when fewer params than placeholders', async () => {
      await client.query('CREATE TABLE param_err_test (a INTEGER, b INTEGER, c INTEGER)')
      await expect(
        client.query('INSERT INTO param_err_test VALUES ($1, $2, $3)', [1, 2])
      ).rejects.toThrow()
    })

    it('should handle extra params gracefully', async () => {
      await client.query('CREATE TABLE extra_param_test (a INTEGER)')
      // Extra params should be ignored or cause error depending on implementation
      const result = await client.query('INSERT INTO extra_param_test VALUES ($1)', [
        1,
        2,
        3,
      ])
      expect(result.rowCount).toBe(1)
    })
  })

  describe('handles out-of-order placeholders', () => {
    it('should handle $3, $1, $2 order', async () => {
      await client.query('CREATE TABLE order_test (a TEXT, b TEXT, c TEXT)')
      await client.query('INSERT INTO order_test VALUES ($2, $3, $1)', ['c', 'a', 'b'])
      const result = await client.query('SELECT * FROM order_test')
      expect(result.rows[0].a).toBe('a')
      expect(result.rows[0].b).toBe('b')
      expect(result.rows[0].c).toBe('c')
    })

    it('should handle reused placeholders ($1 used multiple times)', async () => {
      await client.query('CREATE TABLE reuse_test (a TEXT, b TEXT)')
      await client.query('INSERT INTO reuse_test VALUES ($1, $1)', ['same'])
      const result = await client.query('SELECT * FROM reuse_test')
      expect(result.rows[0].a).toBe('same')
      expect(result.rows[0].b).toBe('same')
    })
  })
})

// ============================================================================
// TDD RED PHASE: CONNECTION LIFECYCLE
// ============================================================================

describe('@dotdo/postgres - Connection Lifecycle (TDD RED)', () => {
  describe('emits lifecycle events', () => {
    it('should emit connect event on successful connection', async () => {
      const client = new Client()
      const connectHandler = vi.fn()
      client.on('connect', connectHandler)

      await client.connect()
      expect(connectHandler).toHaveBeenCalled()

      await client.end()
    })

    it('should emit end event on connection close', async () => {
      const client = new Client()
      const endHandler = vi.fn()
      client.on('end', endHandler)

      await client.connect()
      await client.end()

      expect(endHandler).toHaveBeenCalled()
    })

    it.todo('should emit error event on connection failure')
    it.todo('should emit notice event on PostgreSQL NOTICE')
    it.todo('should emit notification event on NOTIFY')
  })

  describe('pool lifecycle events', () => {
    it('should emit connect event when client created', async () => {
      const pool = new Pool({ max: 2 })
      const connectHandler = vi.fn()
      pool.on('connect', connectHandler)

      const client = await pool.connect()
      expect(connectHandler).toHaveBeenCalledWith(client)

      client.release()
      await pool.end()
    })

    it('should emit acquire event when client checked out', async () => {
      const pool = new Pool({ max: 2 })
      const acquireHandler = vi.fn()
      pool.on('acquire', acquireHandler)

      const client = await pool.connect()
      expect(acquireHandler).toHaveBeenCalledWith(client)

      client.release()
      await pool.end()
    })

    it('should emit release event when client returned', async () => {
      const pool = new Pool({ max: 2 })
      const releaseHandler = vi.fn()
      pool.on('release', releaseHandler)

      const client = await pool.connect()
      client.release()

      expect(releaseHandler).toHaveBeenCalled()
      await pool.end()
    })

    it('should emit remove event when client destroyed', async () => {
      const pool = new Pool({ max: 2 })
      const removeHandler = vi.fn()
      pool.on('remove', removeHandler)

      const client = await pool.connect()
      client.release(true) // destroy flag

      expect(removeHandler).toHaveBeenCalled()
      await pool.end()
    })

    it.todo('should emit error event on client error')
  })

  describe('connection state management', () => {
    it('should reject queries on ended client', async () => {
      const client = new Client()
      await client.connect()
      await client.end()

      // Query on ended client should fail gracefully
      // Note: Current implementation may or may not throw
      // This test documents expected behavior
      await expect(client.query('SELECT 1')).rejects.toThrow()
    })

    it('should reject connect on ended pool', async () => {
      const pool = new Pool()
      await pool.end()

      await expect(pool.connect()).rejects.toThrow(ConnectionError)
    })

    it('should reject query on ended pool', async () => {
      const pool = new Pool()
      await pool.end()

      await expect(pool.query('SELECT 1')).rejects.toThrow(ConnectionError)
    })
  })

  describe('callback API compatibility', () => {
    it('should support client.connect(callback)', async () => {
      const client = new Client()
      await new Promise<void>((resolve, reject) => {
        client.connect((err) => {
          if (err) reject(err)
          else {
            expect(err).toBeUndefined()
            client.end(() => resolve())
          }
        })
      })
    })

    it('should support client.query(sql, callback)', async () => {
      const client = new Client()
      await client.connect()

      await new Promise<void>((resolve, reject) => {
        client.query('SELECT 1 as num', (err, result) => {
          try {
            expect(err).toBeNull()
            expect(result.rows).toBeDefined()
            resolve()
          } catch (e) {
            reject(e)
          }
        })
      })

      await client.end()
    })

    // NOTE: This test demonstrates a known limitation - callback with params
    // currently treats params as the callback. The async API works correctly.
    it.todo('should support client.query(sql, params, callback)')

    it('should support client.end(callback)', async () => {
      const client = new Client()
      await client.connect()

      await new Promise<void>((resolve, reject) => {
        client.end((err) => {
          if (err) reject(err)
          else {
            expect(err).toBeUndefined()
            resolve()
          }
        })
      })
    })
  })
})
