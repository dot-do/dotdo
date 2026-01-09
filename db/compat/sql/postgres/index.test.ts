/**
 * @dotdo/postgres - PostgreSQL SDK compat tests
 *
 * Tests for pg (node-postgres) API compatibility backed by DO SQLite:
 * - Client - Connection, query execution, events
 * - Pool - Connection pooling, checkout/release
 * - Query - Parameterized queries, prepared statements
 * - Transactions - BEGIN/COMMIT/ROLLBACK
 * - Error handling - DatabaseError, ConnectionError
 *
 * @see https://node-postgres.com/
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Client,
  Pool,
  pg,
  native,
  types,
  DatabaseError,
  ConnectionError,
  type QueryResult,
  type PoolClient,
  type PoolConfig,
  type ClientConfig,
  type ExtendedPostgresConfig,
} from './index'

// ============================================================================
// CLIENT CREATION TESTS
// ============================================================================

describe('Client', () => {
  describe('constructor', () => {
    it('should create client with no config', () => {
      const client = new Client()
      expect(client).toBeDefined()
    })

    it('should create client with connection string', () => {
      const client = new Client('postgres://user:pass@localhost:5432/mydb')
      expect(client).toBeDefined()
    })

    it('should create client with config object', () => {
      const client = new Client({
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        user: 'postgres',
        password: 'secret',
      })
      expect(client).toBeDefined()
    })

    it('should create client with SSL config', () => {
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
        ssl: {
          rejectUnauthorized: false,
        },
      })
      expect(client).toBeDefined()
    })

    it('should create client with extended DO config', () => {
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
        shard: { algorithm: 'consistent', count: 4 },
        replica: { readPreference: 'nearest' },
      } as ExtendedPostgresConfig)
      expect(client).toBeDefined()
    })

    it('should have null processID before connect', () => {
      const client = new Client()
      expect(client.processID).toBeNull()
      expect(client.secretKey).toBeNull()
    })
  })

  describe('connect', () => {
    it('should connect with promise', async () => {
      const client = new Client()
      await client.connect()
      expect(client.processID).toBeDefined()
      expect(client.processID).not.toBeNull()
      await client.end()
    })

    it('should connect with callback', async () => {
      const client = new Client()
      await new Promise<void>((resolve) => {
        client.connect((err) => {
          expect(err).toBeUndefined()
          expect(client.processID).not.toBeNull()
          client.end(() => resolve())
        })
      })
    })

    it('should emit connect event', async () => {
      const client = new Client()
      const connectHandler = vi.fn()
      client.on('connect', connectHandler)
      await client.connect()
      expect(connectHandler).toHaveBeenCalled()
      await client.end()
    })
  })

  describe('end', () => {
    it('should end with promise', async () => {
      const client = new Client()
      await client.connect()
      await client.end()
    })

    it('should end with callback', async () => {
      const client = new Client()
      await new Promise<void>((resolve) => {
        client.connect(() => {
          client.end((err) => {
            expect(err).toBeUndefined()
            resolve()
          })
        })
      })
    })

    it('should emit end event', async () => {
      const client = new Client()
      const endHandler = vi.fn()
      client.on('end', endHandler)
      await client.connect()
      await client.end()
      expect(endHandler).toHaveBeenCalled()
    })
  })

  describe('event handlers', () => {
    it('should support on/off pattern', async () => {
      const client = new Client()
      const handler = vi.fn()
      client.on('end', handler)
      client.off('end', handler)
      await client.connect()
      await client.end()
      expect(handler).not.toHaveBeenCalled()
    })

    it('should support removeListener', async () => {
      const client = new Client()
      const handler = vi.fn()
      client.on('end', handler)
      client.removeListener('end', handler)
      await client.connect()
      await client.end()
      expect(handler).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// QUERY TESTS
// ============================================================================

describe('query', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('basic queries', () => {
    it('should execute simple SELECT', async () => {
      const result = await client.query('SELECT 1')
      expect(result).toBeDefined()
      expect(result.rows).toBeDefined()
      expect(result.rows[0]['?column?']).toBe(1)
    })

    it('should return QueryResult structure', async () => {
      const result = await client.query('SELECT 1')
      expect(result.fields).toBeDefined()
      expect(result.rows).toBeDefined()
      expect(result.rowCount).toBeDefined()
      expect(result.command).toBe('SELECT')
      expect(result.oid).toBeDefined()
    })

    it('should execute with callback', async () => {
      await new Promise<void>((resolve) => {
        client.query('SELECT 1', (err, result) => {
          expect(err).toBeNull()
          expect(result.rows[0]['?column?']).toBe(1)
          resolve()
        })
      })
    })
  })

  describe('CREATE TABLE', () => {
    it('should create simple table', async () => {
      const result = await client.query('CREATE TABLE users (id INTEGER, name TEXT)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should create table with PRIMARY KEY', async () => {
      const result = await client.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should create table with SERIAL', async () => {
      const result = await client.query('CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should create table with IF NOT EXISTS', async () => {
      await client.query('CREATE TABLE users (id INTEGER)')
      const result = await client.query('CREATE TABLE IF NOT EXISTS users (id INTEGER)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should throw error on duplicate table', async () => {
      await client.query('CREATE TABLE users (id INTEGER)')
      await expect(client.query('CREATE TABLE users (id INTEGER)')).rejects.toThrow(DatabaseError)
    })

    it('should create table with UNIQUE constraint', async () => {
      const result = await client.query('CREATE TABLE users (id INTEGER, email TEXT UNIQUE)')
      expect(result.command).toBe('CREATE TABLE')
    })
  })

  describe('INSERT', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)')
    })

    it('should insert single row', async () => {
      const result = await client.query("INSERT INTO users (name, age) VALUES ('Alice', 30)")
      expect(result.rowCount).toBe(1)
      expect(result.command).toBe('INSERT')
    })

    it('should insert with parameterized values', async () => {
      const result = await client.query('INSERT INTO users (name, age) VALUES ($1, $2)', [
        'Bob',
        25,
      ])
      expect(result.rowCount).toBe(1)
    })

    it('should insert with QueryConfig', async () => {
      const result = await client.query({
        text: 'INSERT INTO users (name, age) VALUES ($1, $2)',
        values: ['Carol', 28],
      })
      expect(result.rowCount).toBe(1)
    })

    it('should insert with RETURNING', async () => {
      const result = await client.query(
        'INSERT INTO users (name, age) VALUES ($1, $2) RETURNING id, name',
        ['Dave', 35]
      )
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Dave')
      expect(result.rows[0].id).toBeDefined()
    })

    it('should insert with RETURNING *', async () => {
      const result = await client.query(
        'INSERT INTO users (name, age) VALUES ($1, $2) RETURNING *',
        ['Eve', 40]
      )
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Eve')
      expect(result.rows[0].age).toBe(40)
    })

    it('should auto-increment SERIAL column', async () => {
      const result1 = await client.query(
        'INSERT INTO users (name) VALUES ($1) RETURNING id',
        ['User1']
      )
      const result2 = await client.query(
        'INSERT INTO users (name) VALUES ($1) RETURNING id',
        ['User2']
      )
      expect(result2.rows[0].id).toBeGreaterThan(result1.rows[0].id)
    })

    it('should throw on unique constraint violation', async () => {
      await client.query('CREATE TABLE emails (id INTEGER PRIMARY KEY, email TEXT UNIQUE)')
      await client.query("INSERT INTO emails (id, email) VALUES (1, 'test@example.com')")
      await expect(
        client.query("INSERT INTO emails (id, email) VALUES (2, 'test@example.com')")
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('SELECT', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      await client.query("INSERT INTO users VALUES (1, 'Alice', 30)")
      await client.query("INSERT INTO users VALUES (2, 'Bob', 25)")
      await client.query("INSERT INTO users VALUES (3, 'Carol', 35)")
    })

    it('should select all rows', async () => {
      const result = await client.query('SELECT * FROM users')
      expect(result.rows.length).toBe(3)
    })

    it('should select specific columns', async () => {
      const result = await client.query('SELECT name, age FROM users')
      expect(result.rows[0].name).toBe('Alice')
      expect(result.rows[0].age).toBe(30)
      expect(result.rows[0].id).toBeUndefined()
    })

    it('should filter with WHERE clause', async () => {
      const result = await client.query('SELECT * FROM users WHERE age > $1', [28])
      expect(result.rows.length).toBe(2)
    })

    it('should support = operator', async () => {
      const result = await client.query('SELECT * FROM users WHERE name = $1', ['Bob'])
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Bob')
    })

    it('should support != operator', async () => {
      const result = await client.query('SELECT * FROM users WHERE name != $1', ['Bob'])
      expect(result.rows.length).toBe(2)
    })

    it('should support > operator', async () => {
      const result = await client.query('SELECT * FROM users WHERE age > $1', [30])
      expect(result.rows.length).toBe(1)
    })

    it('should support >= operator', async () => {
      const result = await client.query('SELECT * FROM users WHERE age >= $1', [30])
      expect(result.rows.length).toBe(2)
    })

    it('should support < operator', async () => {
      const result = await client.query('SELECT * FROM users WHERE age < $1', [30])
      expect(result.rows.length).toBe(1)
    })

    it('should support <= operator', async () => {
      const result = await client.query('SELECT * FROM users WHERE age <= $1', [30])
      expect(result.rows.length).toBe(2)
    })

    it('should support IS NULL', async () => {
      await client.query('CREATE TABLE nullable (id INTEGER, value TEXT)')
      await client.query('INSERT INTO nullable VALUES (1, NULL)')
      await client.query("INSERT INTO nullable VALUES (2, 'test')")
      const result = await client.query('SELECT * FROM nullable WHERE value IS NULL')
      expect(result.rows.length).toBe(1)
    })

    it('should support IS NOT NULL', async () => {
      await client.query('CREATE TABLE nullable (id INTEGER, value TEXT)')
      await client.query('INSERT INTO nullable VALUES (1, NULL)')
      await client.query("INSERT INTO nullable VALUES (2, 'test')")
      const result = await client.query('SELECT * FROM nullable WHERE value IS NOT NULL')
      expect(result.rows.length).toBe(1)
    })

    it('should support LIKE', async () => {
      const result = await client.query("SELECT * FROM users WHERE name LIKE 'A%'")
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should support ILIKE (case-insensitive)', async () => {
      const result = await client.query("SELECT * FROM users WHERE name ILIKE 'a%'")
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should support IN clause', async () => {
      const result = await client.query('SELECT * FROM users WHERE id IN (1, 3)')
      expect(result.rows.length).toBe(2)
    })

    it('should support AND conditions', async () => {
      const result = await client.query('SELECT * FROM users WHERE age > $1 AND age < $2', [25, 35])
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should support ORDER BY ASC', async () => {
      const result = await client.query('SELECT * FROM users ORDER BY age ASC')
      expect(result.rows[0].age).toBe(25)
      expect(result.rows[2].age).toBe(35)
    })

    it('should support ORDER BY DESC', async () => {
      const result = await client.query('SELECT * FROM users ORDER BY age DESC')
      expect(result.rows[0].age).toBe(35)
      expect(result.rows[2].age).toBe(25)
    })

    it('should support LIMIT', async () => {
      const result = await client.query('SELECT * FROM users LIMIT 2')
      expect(result.rows.length).toBe(2)
    })

    it('should support OFFSET', async () => {
      const result = await client.query('SELECT * FROM users ORDER BY id ASC OFFSET 1')
      expect(result.rows.length).toBe(2)
      expect(result.rows[0].id).toBe(2)
    })

    it('should support LIMIT and OFFSET together', async () => {
      const result = await client.query('SELECT * FROM users ORDER BY id ASC LIMIT 1 OFFSET 1')
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].id).toBe(2)
    })
  })

  describe('UPDATE', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      await client.query("INSERT INTO users VALUES (1, 'Alice', 30)")
      await client.query("INSERT INTO users VALUES (2, 'Bob', 25)")
    })

    it('should update single row', async () => {
      const result = await client.query('UPDATE users SET age = $1 WHERE id = $2', [31, 1])
      expect(result.rowCount).toBe(1)
      expect(result.command).toBe('UPDATE')
    })

    it('should update multiple rows', async () => {
      const result = await client.query('UPDATE users SET age = age + 1')
      expect(result.rowCount).toBe(2)
    })

    it('should update with RETURNING', async () => {
      const result = await client.query(
        'UPDATE users SET age = $1 WHERE id = $2 RETURNING name, age',
        [31, 1]
      )
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].age).toBe(31)
    })

    it('should update multiple columns', async () => {
      const result = await client.query(
        'UPDATE users SET name = $1, age = $2 WHERE id = $3 RETURNING *',
        ['Alicia', 32, 1]
      )
      expect(result.rows[0].name).toBe('Alicia')
      expect(result.rows[0].age).toBe(32)
    })
  })

  describe('DELETE', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.query("INSERT INTO users VALUES (1, 'Alice')")
      await client.query("INSERT INTO users VALUES (2, 'Bob')")
      await client.query("INSERT INTO users VALUES (3, 'Carol')")
    })

    it('should delete single row', async () => {
      const result = await client.query('DELETE FROM users WHERE id = $1', [1])
      expect(result.rowCount).toBe(1)
      expect(result.command).toBe('DELETE')
    })

    it('should delete multiple rows', async () => {
      const result = await client.query('DELETE FROM users WHERE id > $1', [1])
      expect(result.rowCount).toBe(2)
    })

    it('should delete with RETURNING', async () => {
      const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [1])
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should delete all rows', async () => {
      const result = await client.query('DELETE FROM users')
      expect(result.rowCount).toBe(3)
    })
  })

  describe('DROP TABLE', () => {
    it('should drop existing table', async () => {
      await client.query('CREATE TABLE users (id INTEGER)')
      const result = await client.query('DROP TABLE users')
      expect(result.command).toBe('DROP TABLE')
    })

    it('should drop with IF EXISTS', async () => {
      const result = await client.query('DROP TABLE IF EXISTS nonexistent')
      expect(result.command).toBe('DROP TABLE')
    })

    it('should throw on drop nonexistent table', async () => {
      await expect(client.query('DROP TABLE nonexistent')).rejects.toThrow(DatabaseError)
    })
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('transactions', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
    await client.query('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)')
    await client.query('INSERT INTO accounts VALUES (1, 100)')
    await client.query('INSERT INTO accounts VALUES (2, 100)')
  })

  afterEach(async () => {
    await client.end()
  })

  it('should begin transaction', async () => {
    const result = await client.query('BEGIN')
    expect(result.command).toBe('BEGIN')
  })

  it('should commit transaction', async () => {
    await client.query('BEGIN')
    await client.query('UPDATE accounts SET balance = 50 WHERE id = 1')
    const result = await client.query('COMMIT')
    expect(result.command).toBe('COMMIT')

    const check = await client.query('SELECT balance FROM accounts WHERE id = 1')
    expect(check.rows[0].balance).toBe(50)
  })

  it('should rollback transaction', async () => {
    await client.query('BEGIN')
    await client.query('UPDATE accounts SET balance = 50 WHERE id = 1')
    const result = await client.query('ROLLBACK')
    expect(result.command).toBe('ROLLBACK')

    const check = await client.query('SELECT balance FROM accounts WHERE id = 1')
    expect(check.rows[0].balance).toBe(100)
  })

  it('should support START TRANSACTION', async () => {
    const result = await client.query('START TRANSACTION')
    expect(result.command).toBe('BEGIN')
    await client.query('ROLLBACK')
  })

  it('should handle savepoint (acknowledged)', async () => {
    await client.query('BEGIN')
    const result = await client.query('SAVEPOINT sp1')
    expect(result.command).toBe('SAVEPOINT')
    await client.query('ROLLBACK')
  })

  it('should handle release savepoint (acknowledged)', async () => {
    await client.query('BEGIN')
    await client.query('SAVEPOINT sp1')
    const result = await client.query('RELEASE SAVEPOINT sp1')
    expect(result.command).toBe('RELEASE')
    await client.query('COMMIT')
  })
})

// ============================================================================
// POOL TESTS
// ============================================================================

describe('Pool', () => {
  describe('constructor', () => {
    it('should create pool with no config', () => {
      const pool = new Pool()
      expect(pool).toBeDefined()
      expect(pool.totalCount).toBe(0)
    })

    it('should create pool with connection string', () => {
      const pool = new Pool('postgres://localhost/mydb')
      expect(pool).toBeDefined()
    })

    it('should create pool with config object', () => {
      const pool = new Pool({
        host: 'localhost',
        database: 'mydb',
        max: 20,
        idleTimeoutMillis: 30000,
      })
      expect(pool).toBeDefined()
    })

    it('should create pool with extended DO config', () => {
      const pool = new Pool({
        host: 'localhost',
        database: 'mydb',
        shard: { algorithm: 'hash', count: 8 },
        replica: { readPreference: 'secondary' },
      } as ExtendedPostgresConfig)
      expect(pool).toBeDefined()
    })
  })

  describe('pool properties', () => {
    it('should have totalCount, idleCount, waitingCount', () => {
      const pool = new Pool()
      expect(pool.totalCount).toBe(0)
      expect(pool.idleCount).toBe(0)
      expect(pool.waitingCount).toBe(0)
    })

    it('should have ended property', () => {
      const pool = new Pool()
      expect(pool.ended).toBe(false)
    })
  })

  describe('pool.query', () => {
    let pool: Pool

    beforeEach(() => {
      pool = new Pool()
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should execute query and return result', async () => {
      const result = await pool.query('SELECT 1')
      expect(result.rows).toBeDefined()
    })

    it('should execute parameterized query', async () => {
      await pool.query('CREATE TABLE users (id INTEGER, name TEXT)')
      await pool.query('INSERT INTO users VALUES ($1, $2)', [1, 'Alice'])
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [1])
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should execute query with QueryConfig', async () => {
      const result = await pool.query({
        text: 'SELECT 1 as num',
        values: [],
      })
      expect(result.rows).toBeDefined()
    })
  })

  describe('pool.connect', () => {
    let pool: Pool

    beforeEach(() => {
      pool = new Pool({ max: 2 })
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should checkout client', async () => {
      const client = await pool.connect()
      expect(client).toBeDefined()
      expect(pool.totalCount).toBe(1)
      client.release()
    })

    it('should emit connect event', async () => {
      const connectHandler = vi.fn()
      pool.on('connect', connectHandler)
      const client = await pool.connect()
      expect(connectHandler).toHaveBeenCalled()
      client.release()
    })

    it('should emit acquire event', async () => {
      const acquireHandler = vi.fn()
      pool.on('acquire', acquireHandler)
      const client = await pool.connect()
      expect(acquireHandler).toHaveBeenCalled()
      client.release()
    })

    it('should reuse idle client', async () => {
      const client1 = await pool.connect()
      client1.release()

      const client2 = await pool.connect()
      expect(pool.totalCount).toBe(1)
      client2.release()
    })

    it('should create new client when needed', async () => {
      const client1 = await pool.connect()
      const client2 = await pool.connect()
      expect(pool.totalCount).toBe(2)
      client1.release()
      client2.release()
    })
  })

  describe('client.release', () => {
    let pool: Pool

    beforeEach(() => {
      pool = new Pool({ max: 2 })
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should return client to pool', async () => {
      const client = await pool.connect()
      expect(pool.idleCount).toBe(0)
      client.release()
      expect(pool.idleCount).toBe(1)
    })

    it('should emit release event', async () => {
      const releaseHandler = vi.fn()
      pool.on('release', releaseHandler)
      const client = await pool.connect()
      client.release()
      expect(releaseHandler).toHaveBeenCalled()
    })

    it('should destroy client on release(true)', async () => {
      const removeHandler = vi.fn()
      pool.on('remove', removeHandler)
      const client = await pool.connect()
      client.release(true)
      expect(removeHandler).toHaveBeenCalled()
      expect(pool.totalCount).toBe(0)
    })
  })

  describe('pool.end', () => {
    it('should end all clients', async () => {
      const pool = new Pool()
      const client = await pool.connect()
      client.release()
      await pool.end()
      expect(pool.ended).toBe(true)
    })

    it('should reject new connections after end', async () => {
      const pool = new Pool()
      await pool.end()
      await expect(pool.connect()).rejects.toThrow(ConnectionError)
    })
  })

  describe('pool transactions', () => {
    let pool: Pool

    beforeEach(async () => {
      pool = new Pool()
      await pool.query('CREATE TABLE accounts (id INTEGER, balance INTEGER)')
      await pool.query('INSERT INTO accounts VALUES (1, 100)')
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should support transaction with checkout', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('UPDATE accounts SET balance = 50 WHERE id = 1')
        await client.query('COMMIT')
      } finally {
        client.release()
      }

      const result = await pool.query('SELECT balance FROM accounts WHERE id = 1')
      expect(result.rows[0].balance).toBe(50)
    })

    it('should rollback on error', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('UPDATE accounts SET balance = 50 WHERE id = 1')
        // Simulate error - rollback
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }

      const result = await pool.query('SELECT balance FROM accounts WHERE id = 1')
      expect(result.rows[0].balance).toBe(100)
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('error handling', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  it('should throw DatabaseError on syntax error', async () => {
    try {
      await client.query('INVALID SQL')
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError)
      expect((e as DatabaseError).code).toBeDefined()
    }
  })

  it('should throw DatabaseError on table not found', async () => {
    try {
      await client.query('SELECT * FROM nonexistent')
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError)
      expect((e as DatabaseError).code).toBe('42P01')
    }
  })

  it('should throw DatabaseError on constraint violation', async () => {
    await client.query('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    await client.query('INSERT INTO t VALUES (1)')
    try {
      await client.query('INSERT INTO t VALUES (1)')
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError)
      expect((e as DatabaseError).code).toBe('23505')
    }
  })

  it('should call error callback', async () => {
    await new Promise<void>((resolve) => {
      client.query('INVALID SQL', (err, result) => {
        expect(err).toBeInstanceOf(DatabaseError)
        resolve()
      })
    })
  })
})

// ============================================================================
// UTILITY TESTS
// ============================================================================

describe('utilities', () => {
  describe('escapeLiteral', () => {
    let client: Client

    beforeEach(async () => {
      client = new Client()
      await client.connect()
    })

    afterEach(async () => {
      await client.end()
    })

    it('should escape single quotes', () => {
      const result = client.escapeLiteral("it's a test")
      expect(result).toBe("'it''s a test'")
    })

    it('should wrap in single quotes', () => {
      const result = client.escapeLiteral('test')
      expect(result).toBe("'test'")
    })
  })

  describe('escapeIdentifier', () => {
    let client: Client

    beforeEach(async () => {
      client = new Client()
      await client.connect()
    })

    afterEach(async () => {
      await client.end()
    })

    it('should escape double quotes', () => {
      const result = client.escapeIdentifier('column"name')
      expect(result).toBe('"column""name"')
    })

    it('should wrap in double quotes', () => {
      const result = client.escapeIdentifier('tablename')
      expect(result).toBe('"tablename"')
    })
  })

  describe('types', () => {
    it('should export type constants', () => {
      expect(types.BOOL).toBeDefined()
      expect(types.INT4).toBeDefined()
      expect(types.TEXT).toBeDefined()
      expect(types.JSON).toBeDefined()
      expect(types.JSONB).toBeDefined()
      expect(types.UUID).toBeDefined()
    })
  })

  describe('native', () => {
    it('should return Client and Pool', () => {
      const n = native()
      expect(n.Client).toBeDefined()
      expect(n.Pool).toBeDefined()
    })
  })

  describe('default export', () => {
    it('should have Client, Pool, types, errors', () => {
      expect(pg.Client).toBeDefined()
      expect(pg.Pool).toBeDefined()
      expect(pg.types).toBeDefined()
      expect(pg.DatabaseError).toBeDefined()
      expect(pg.ConnectionError).toBeDefined()
      expect(pg.native).toBeDefined()
    })
  })
})

// ============================================================================
// DATA TYPE TESTS
// ============================================================================

describe('data types', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  it('should handle INTEGER', async () => {
    await client.query('CREATE TABLE t (val INTEGER)')
    await client.query('INSERT INTO t VALUES ($1)', [42])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBe(42)
  })

  it('should handle TEXT', async () => {
    await client.query('CREATE TABLE t (val TEXT)')
    await client.query('INSERT INTO t VALUES ($1)', ['hello world'])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBe('hello world')
  })

  it('should handle BOOLEAN', async () => {
    await client.query('CREATE TABLE t (val BOOLEAN)')
    await client.query('INSERT INTO t VALUES ($1)', [true])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBe(true)
  })

  it('should handle NULL', async () => {
    await client.query('CREATE TABLE t (val TEXT)')
    await client.query('INSERT INTO t VALUES ($1)', [null])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBeNull()
  })

  it('should handle FLOAT', async () => {
    await client.query('CREATE TABLE t (val REAL)')
    await client.query('INSERT INTO t VALUES ($1)', [3.14])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBeCloseTo(3.14)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration', () => {
  it('should work with realistic CRUD workflow', async () => {
    const client = new Client()
    await client.connect()

    // Create schema
    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at TEXT
      )
    `)

    // Insert data
    const insertResult = await client.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
      ['Alice', 'alice@example.com']
    )
    expect(insertResult.rows[0].name).toBe('Alice')
    const userId = insertResult.rows[0].id

    // Read data
    const selectResult = await client.query('SELECT * FROM users WHERE id = $1', [userId])
    expect(selectResult.rows[0].email).toBe('alice@example.com')

    // Update data
    const updateResult = await client.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
      ['Alicia', userId]
    )
    expect(updateResult.rows[0].name).toBe('Alicia')

    // Delete data
    const deleteResult = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId])
    expect(deleteResult.rows[0].name).toBe('Alicia')

    // Verify deletion
    const verifyResult = await client.query('SELECT * FROM users WHERE id = $1', [userId])
    expect(verifyResult.rows.length).toBe(0)

    await client.end()
  })

  it('should work with pool workflow', async () => {
    const pool = new Pool({ max: 5 })

    // Create schema
    await pool.query('CREATE TABLE posts (id SERIAL PRIMARY KEY, title TEXT, body TEXT)')

    // Concurrent inserts
    const insertPromises = []
    for (let i = 0; i < 10; i++) {
      insertPromises.push(
        pool.query('INSERT INTO posts (title, body) VALUES ($1, $2)', [`Post ${i}`, `Body ${i}`])
      )
    }
    await Promise.all(insertPromises)

    // Verify
    const result = await pool.query('SELECT * FROM posts')
    expect(result.rows.length).toBe(10)

    await pool.end()
  })

  it('should handle transaction with checkout', async () => {
    const pool = new Pool()

    await pool.query('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)')
    await pool.query('INSERT INTO accounts VALUES (1, 1000), (2, 1000)')

    // Transfer money
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 1])
      await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 2])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }

    // Verify
    const result = await pool.query('SELECT * FROM accounts ORDER BY id')
    expect(result.rows[0].balance).toBe(900)
    expect(result.rows[1].balance).toBe(1100)

    await pool.end()
  })
})

// ============================================================================
// DO ROUTING TESTS
// ============================================================================

describe('DO routing', () => {
  it('should accept shard configuration', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'mydb',
      shard: { key: 'user_id', count: 8, algorithm: 'hash' },
    } as ExtendedPostgresConfig)
    expect(pool).toBeDefined()
  })

  it('should accept replica configuration', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'mydb',
      replica: {
        readPreference: 'secondary',
        writeThrough: true,
        jurisdiction: 'eu',
      },
    } as ExtendedPostgresConfig)
    expect(pool).toBeDefined()
  })

  it('should accept doNamespace', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'mydb',
      doNamespace: {} as DurableObjectNamespace,
    } as ExtendedPostgresConfig)
    expect(pool).toBeDefined()
  })
})
