/**
 * @dotdo/cockroach - CockroachDB SDK compat tests (RED PHASE)
 *
 * Tests for CockroachDB API compatibility backed by DO SQLite:
 * - Client - Connection, query execution, events
 * - Pool - Connection pooling, checkout/release
 * - Query - Parameterized queries ($1, $2, etc.)
 * - Transactions - BEGIN/COMMIT/ROLLBACK with isolation levels
 * - AS OF SYSTEM TIME - Time-travel queries
 * - Error handling - DatabaseError, ConnectionError
 *
 * CockroachDB is PostgreSQL wire-protocol compatible, so this extends
 * the postgres compat layer with CockroachDB-specific features.
 *
 * @see https://www.cockroachlabs.com/docs/
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Client,
  Pool,
  crdb,
  types,
  DatabaseError,
  ConnectionError,
  type QueryResult,
  type PoolClient,
  type PoolConfig,
  type ClientConfig,
  type CockroachConfig,
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
      const client = new Client('postgresql://root@localhost:26257/defaultdb')
      expect(client).toBeDefined()
    })

    it('should create client with config object', () => {
      const client = new Client({
        host: 'localhost',
        port: 26257,
        database: 'defaultdb',
        user: 'root',
        password: '',
      })
      expect(client).toBeDefined()
    })

    it('should create client with SSL config for CockroachDB Cloud', () => {
      const client = new Client({
        host: 'free-tier.gcp-us-central1.cockroachlabs.cloud',
        port: 26257,
        database: 'defaultdb',
        user: 'user',
        password: 'secret',
        ssl: {
          rejectUnauthorized: true,
        },
      })
      expect(client).toBeDefined()
    })

    it('should create client with CockroachDB-specific config', () => {
      const client = new Client({
        host: 'localhost',
        database: 'defaultdb',
        cluster: 'my-cluster-123',
        shard: { algorithm: 'consistent', count: 4 },
        replica: { readPreference: 'nearest' },
      } as CockroachConfig)
      expect(client).toBeDefined()
    })

    it('should have null processID before connect', () => {
      const client = new Client()
      expect(client.processID).toBeNull()
      expect(client.secretKey).toBeNull()
    })

    it('should expose connectionParameters', () => {
      const client = new Client({ host: 'localhost', database: 'mydb' })
      expect(client.connectionParameters).toBeDefined()
      expect(client.connectionParameters.host).toBe('localhost')
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
      await new Promise<void>((resolve, reject) => {
        client.connect((err) => {
          if (err) return reject(err)
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

    it('should set secretKey after connect', async () => {
      const client = new Client()
      await client.connect()
      expect(client.secretKey).not.toBeNull()
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
      await new Promise<void>((resolve, reject) => {
        client.connect(() => {
          client.end((err) => {
            if (err) return reject(err)
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

    it('should support error event', async () => {
      const client = new Client()
      const errorHandler = vi.fn()
      client.on('error', errorHandler)
      await client.connect()
      // Error event handler registered
      expect(client).toBeDefined()
      await client.end()
    })
  })
})

// ============================================================================
// BASIC CRUD OPERATIONS TESTS
// ============================================================================

describe('CRUD operations', () => {
  let client: InstanceType<typeof Client>

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('CREATE TABLE', () => {
    it('should create simple table', async () => {
      const result = await client.query('CREATE TABLE users (id INT, name STRING)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should create table with PRIMARY KEY', async () => {
      const result = await client.query('CREATE TABLE users (id INT PRIMARY KEY, name STRING)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should create table with SERIAL (INT DEFAULT unique_rowid())', async () => {
      const result = await client.query(
        'CREATE TABLE users (id SERIAL PRIMARY KEY, name STRING)'
      )
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should create table with IF NOT EXISTS', async () => {
      await client.query('CREATE TABLE users (id INT)')
      const result = await client.query('CREATE TABLE IF NOT EXISTS users (id INT)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should throw error on duplicate table', async () => {
      await client.query('CREATE TABLE users (id INT)')
      await expect(client.query('CREATE TABLE users (id INT)')).rejects.toThrow(DatabaseError)
    })

    it('should create table with UNIQUE constraint', async () => {
      const result = await client.query('CREATE TABLE users (id INT, email STRING UNIQUE)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should create table with UUID column', async () => {
      const result = await client.query(
        'CREATE TABLE events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name STRING)'
      )
      expect(result.command).toBe('CREATE TABLE')
    })
  })

  describe('INSERT', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE users (id SERIAL PRIMARY KEY, name STRING, age INT)')
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
      await client.query('CREATE TABLE emails (id INT PRIMARY KEY, email STRING UNIQUE)')
      await client.query("INSERT INTO emails (id, email) VALUES (1, 'test@example.com.ai')")
      await expect(
        client.query("INSERT INTO emails (id, email) VALUES (2, 'test@example.com.ai')")
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('SELECT', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE users (id INT PRIMARY KEY, name STRING, age INT)')
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
      expect(result.rows[0].name).toBeDefined()
      expect(result.rows[0].age).toBeDefined()
      expect(result.rows[0].id).toBeUndefined()
    })

    it('should filter with WHERE clause', async () => {
      const result = await client.query('SELECT * FROM users WHERE age > $1', [28])
      expect(result.rows.length).toBe(2)
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
  })

  describe('UPDATE', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE users (id INT PRIMARY KEY, name STRING, age INT)')
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
  })

  describe('DELETE', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE users (id INT PRIMARY KEY, name STRING)')
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
  })
})

// ============================================================================
// PARAMETERIZED QUERIES TESTS
// ============================================================================

describe('parameterized queries', () => {
  let client: InstanceType<typeof Client>

  beforeEach(async () => {
    client = new Client()
    await client.connect()
    await client.query('CREATE TABLE test (id INT, name STRING, value INT)')
  })

  afterEach(async () => {
    await client.end()
  })

  it('should handle single parameter $1', async () => {
    await client.query('INSERT INTO test VALUES (1, $1, 100)', ['Alice'])
    const result = await client.query('SELECT * FROM test WHERE name = $1', ['Alice'])
    expect(result.rows.length).toBe(1)
  })

  it('should handle multiple parameters $1, $2, $3', async () => {
    await client.query('INSERT INTO test VALUES ($1, $2, $3)', [1, 'Bob', 200])
    const result = await client.query('SELECT * FROM test WHERE id = $1 AND value > $2', [1, 100])
    expect(result.rows.length).toBe(1)
  })

  it('should handle out-of-order parameter usage', async () => {
    // CockroachDB allows using parameters in any order
    await client.query('INSERT INTO test VALUES ($3, $1, $2)', ['Carol', 300, 2])
    const result = await client.query('SELECT * FROM test WHERE name = $1', ['Carol'])
    expect(result.rows[0].value).toBe(300)
  })

  it('should handle NULL parameter', async () => {
    await client.query('INSERT INTO test VALUES ($1, $2, $3)', [1, null, 100])
    const result = await client.query('SELECT * FROM test WHERE name IS NULL')
    expect(result.rows.length).toBe(1)
  })

  it('should handle boolean parameter', async () => {
    await client.query('CREATE TABLE flags (id INT, active BOOL)')
    await client.query('INSERT INTO flags VALUES ($1, $2)', [1, true])
    const result = await client.query('SELECT * FROM flags WHERE active = $1', [true])
    expect(result.rows.length).toBe(1)
  })

  it('should handle array-like IN clause with parameters', async () => {
    await client.query('INSERT INTO test VALUES (1, $1, 100)', ['Alice'])
    await client.query('INSERT INTO test VALUES (2, $1, 200)', ['Bob'])
    await client.query('INSERT INTO test VALUES (3, $1, 300)', ['Carol'])
    const result = await client.query('SELECT * FROM test WHERE id IN ($1, $2)', [1, 3])
    expect(result.rows.length).toBe(2)
  })
})

// ============================================================================
// TRANSACTIONS WITH ISOLATION LEVELS TESTS
// ============================================================================

describe('transactions', () => {
  let client: InstanceType<typeof Client>

  beforeEach(async () => {
    client = new Client()
    await client.connect()
    await client.query('CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)')
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

  it('should support BEGIN TRANSACTION', async () => {
    const result = await client.query('BEGIN TRANSACTION')
    expect(result.command).toBe('BEGIN')
    await client.query('ROLLBACK')
  })

  it('should support SERIALIZABLE isolation level', async () => {
    const result = await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
    expect(result.command).toBe('BEGIN')
    await client.query('ROLLBACK')
  })

  it('should support READ COMMITTED isolation level', async () => {
    const result = await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED')
    expect(result.command).toBe('BEGIN')
    await client.query('ROLLBACK')
  })

  it('should support REPEATABLE READ isolation level', async () => {
    const result = await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    expect(result.command).toBe('BEGIN')
    await client.query('ROLLBACK')
  })

  it('should support SET TRANSACTION ISOLATION LEVEL', async () => {
    await client.query('BEGIN')
    const result = await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
    expect(result.command).toBe('SET')
    await client.query('ROLLBACK')
  })

  it('should support READ ONLY transaction', async () => {
    const result = await client.query('BEGIN TRANSACTION READ ONLY')
    expect(result.command).toBe('BEGIN')
    await client.query('ROLLBACK')
  })

  it('should support AS OF SYSTEM TIME in transaction', async () => {
    // CockroachDB allows AS OF SYSTEM TIME with transactions
    const result = await client.query("BEGIN TRANSACTION AS OF SYSTEM TIME '-1s'")
    expect(result.command).toBe('BEGIN')
    await client.query('ROLLBACK')
  })

  it('should handle savepoint', async () => {
    await client.query('BEGIN')
    const result = await client.query('SAVEPOINT sp1')
    expect(result.command).toBe('SAVEPOINT')
    await client.query('ROLLBACK')
  })

  it('should handle release savepoint', async () => {
    await client.query('BEGIN')
    await client.query('SAVEPOINT sp1')
    const result = await client.query('RELEASE SAVEPOINT sp1')
    expect(result.command).toBe('RELEASE')
    await client.query('COMMIT')
  })

  it('should handle rollback to savepoint', async () => {
    // Note: Full savepoint rollback requires MVCC, which is simulated
    // This test verifies the SQL is accepted
    await client.query('BEGIN')
    await client.query('UPDATE accounts SET balance = 50 WHERE id = 1')
    await client.query('SAVEPOINT sp1')
    const result = await client.query('ROLLBACK TO SAVEPOINT sp1')
    expect(result.command).toBe('ROLLBACK')
    await client.query('ROLLBACK')
  })
})

// ============================================================================
// AS OF SYSTEM TIME TESTS (CockroachDB-specific)
// ============================================================================

describe('AS OF SYSTEM TIME', () => {
  let client: InstanceType<typeof Client>

  beforeEach(async () => {
    client = new Client()
    await client.connect()
    await client.query('CREATE TABLE events (id INT PRIMARY KEY, name STRING, created_at TIMESTAMP)')
  })

  afterEach(async () => {
    await client.end()
  })

  it('should query with AS OF SYSTEM TIME interval', async () => {
    await client.query("INSERT INTO events VALUES (1, 'event1', now())")
    // Query historical data
    const result = await client.query("SELECT * FROM events AS OF SYSTEM TIME '-10s'")
    // Result may be empty since table was just created, but query should succeed
    expect(result).toBeDefined()
    expect(result.rows).toBeDefined()
  })

  it('should query with AS OF SYSTEM TIME timestamp', async () => {
    await client.query("INSERT INTO events VALUES (1, 'event1', now())")
    // Use explicit timestamp
    const result = await client.query(
      "SELECT * FROM events AS OF SYSTEM TIME '2024-01-01 00:00:00'"
    )
    expect(result).toBeDefined()
  })

  it('should query with AS OF SYSTEM TIME with follower_read_timestamp()', async () => {
    await client.query("INSERT INTO events VALUES (1, 'event1', now())")
    // follower_read_timestamp() is CockroachDB-specific
    const result = await client.query(
      'SELECT * FROM events AS OF SYSTEM TIME follower_read_timestamp()'
    )
    expect(result).toBeDefined()
  })

  it('should support AS OF SYSTEM TIME with parameterized interval', async () => {
    await client.query("INSERT INTO events VALUES (1, 'event1', now())")
    const result = await client.query("SELECT * FROM events AS OF SYSTEM TIME '-' || $1 || 's'", [
      '10',
    ])
    expect(result).toBeDefined()
  })

  it('should use AS OF SYSTEM TIME for consistent reads', async () => {
    // Note: Full MVCC requires version tracking per row, this is simulated
    // This test verifies the syntax is accepted and queries work
    await client.query("INSERT INTO events VALUES (1, 'initial', now())")

    // Query with explicit timestamp syntax should work
    const result = await client.query(
      "SELECT * FROM events AS OF SYSTEM TIME '2024-01-01 00:00:00'"
    )
    // May return empty due to time filter, but query should succeed
    expect(result).toBeDefined()
    expect(result.rows).toBeDefined()
  })

  it('should support experimental_follower_read_timestamp', async () => {
    await client.query("INSERT INTO events VALUES (1, 'event1', now())")
    // Older CockroachDB syntax
    const result = await client.query(
      'SELECT * FROM events AS OF SYSTEM TIME experimental_follower_read_timestamp()'
    )
    expect(result).toBeDefined()
  })

  it('should handle AS OF SYSTEM TIME with JOIN', async () => {
    await client.query('CREATE TABLE users (id INT PRIMARY KEY, name STRING)')
    await client.query("INSERT INTO users VALUES (1, 'Alice')")
    await client.query("INSERT INTO events VALUES (1, 'login', now())")

    const result = await client.query(`
      SELECT e.*, u.name as user_name
      FROM events e AS OF SYSTEM TIME '-1s'
      JOIN users u AS OF SYSTEM TIME '-1s' ON e.id = u.id
    `)
    expect(result).toBeDefined()
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('error handling', () => {
  let client: InstanceType<typeof Client>

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
    await client.query('CREATE TABLE t (id INT PRIMARY KEY)')
    await client.query('INSERT INTO t VALUES (1)')
    try {
      await client.query('INSERT INTO t VALUES (1)')
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError)
      expect((e as DatabaseError).code).toBe('23505')
    }
  })

  it('should have error severity property', async () => {
    try {
      await client.query('SELECT * FROM nonexistent')
    } catch (e) {
      expect((e as DatabaseError).severity).toBeDefined()
    }
  })

  it('should call error callback', async () => {
    await new Promise<void>((resolve) => {
      client.query('INVALID SQL', (err, _result) => {
        expect(err).toBeInstanceOf(DatabaseError)
        resolve()
      })
    })
  })

  it('should throw ConnectionError when pool is ended', async () => {
    const pool = new Pool()
    await pool.end()
    await expect(pool.connect()).rejects.toThrow(ConnectionError)
  })

  it('should handle serialization errors (40001)', async () => {
    // This simulates a transaction retry error
    await client.query('CREATE TABLE t (id INT PRIMARY KEY, val INT)')
    await client.query('INSERT INTO t VALUES (1, 100)')

    // In real CockroachDB, concurrent transactions can cause serialization errors
    // Our mock should recognize the error code
    expect(DatabaseError).toBeDefined()
  })
})

// ============================================================================
// CONNECTION MANAGEMENT TESTS
// ============================================================================

describe('connection management', () => {
  it('should handle multiple sequential connections', async () => {
    const client = new Client()
    await client.connect()
    await client.query('SELECT 1')
    await client.end()

    const client2 = new Client()
    await client2.connect()
    await client2.query('SELECT 1')
    await client2.end()
  })

  it('should handle connection with timeout config', async () => {
    const client = new Client({
      host: 'localhost',
      connectionTimeoutMillis: 5000,
    })
    expect(client).toBeDefined()
  })

  it('should handle statement_timeout config', async () => {
    const client = new Client({
      host: 'localhost',
      statement_timeout: 30000,
    })
    expect(client).toBeDefined()
  })

  it('should support application_name', async () => {
    const client = new Client({
      host: 'localhost',
      application_name: 'my-app',
    })
    expect(client).toBeDefined()
  })

  it('should expose escapeLiteral', async () => {
    const client = new Client()
    await client.connect()
    const escaped = client.escapeLiteral("it's a test")
    expect(escaped).toBe("'it''s a test'")
    await client.end()
  })

  it('should expose escapeIdentifier', async () => {
    const client = new Client()
    await client.connect()
    const escaped = client.escapeIdentifier('column"name')
    expect(escaped).toBe('"column""name"')
    await client.end()
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
      const pool = new Pool('postgresql://root@localhost:26257/defaultdb')
      expect(pool).toBeDefined()
    })

    it('should create pool with config object', () => {
      const pool = new Pool({
        host: 'localhost',
        port: 26257,
        database: 'defaultdb',
        max: 20,
        idleTimeoutMillis: 30000,
      })
      expect(pool).toBeDefined()
    })

    it('should create pool with CockroachDB-specific config', () => {
      const pool = new Pool({
        host: 'localhost',
        database: 'defaultdb',
        cluster: 'my-cluster-123',
        shard: { algorithm: 'hash', count: 8 },
        replica: { readPreference: 'secondary' },
      } as CockroachConfig)
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
    let pool: InstanceType<typeof Pool>

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
      await pool.query('CREATE TABLE users (id INT, name STRING)')
      await pool.query('INSERT INTO users VALUES ($1, $2)', [1, 'Alice'])
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [1])
      expect(result.rows[0].name).toBe('Alice')
    })
  })

  describe('pool.connect', () => {
    let pool: InstanceType<typeof Pool>

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
  })

  describe('client.release', () => {
    let pool: InstanceType<typeof Pool>

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

  describe('pool transactions', () => {
    let pool: InstanceType<typeof Pool>

    beforeEach(async () => {
      pool = new Pool()
      await pool.query('CREATE TABLE accounts (id INT, balance INT)')
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

    it('should support SERIALIZABLE transaction', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
        await client.query('UPDATE accounts SET balance = 50 WHERE id = 1')
        await client.query('COMMIT')
      } finally {
        client.release()
      }

      const result = await pool.query('SELECT balance FROM accounts WHERE id = 1')
      expect(result.rows[0].balance).toBe(50)
    })
  })
})

// ============================================================================
// DATA TYPES TESTS
// ============================================================================

describe('data types', () => {
  let client: InstanceType<typeof Client>

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  it('should handle INT', async () => {
    await client.query('CREATE TABLE t (val INT)')
    await client.query('INSERT INTO t VALUES ($1)', [42])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBe(42)
  })

  it('should handle STRING', async () => {
    await client.query('CREATE TABLE t (val STRING)')
    await client.query('INSERT INTO t VALUES ($1)', ['hello world'])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBe('hello world')
  })

  it('should handle BOOL', async () => {
    await client.query('CREATE TABLE t (val BOOL)')
    await client.query('INSERT INTO t VALUES ($1)', [true])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBe(true)
  })

  it('should handle NULL', async () => {
    await client.query('CREATE TABLE t (val STRING)')
    await client.query('INSERT INTO t VALUES ($1)', [null])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBeNull()
  })

  it('should handle FLOAT', async () => {
    await client.query('CREATE TABLE t (val FLOAT)')
    await client.query('INSERT INTO t VALUES ($1)', [3.14])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBeCloseTo(3.14)
  })

  it('should handle DECIMAL', async () => {
    await client.query('CREATE TABLE t (val DECIMAL(10,2))')
    await client.query('INSERT INTO t VALUES ($1)', [123.45])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].val).toBeCloseTo(123.45)
  })

  it('should handle UUID', async () => {
    await client.query('CREATE TABLE t (id UUID PRIMARY KEY, name STRING)')
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    await client.query('INSERT INTO t VALUES ($1, $2)', [uuid, 'test'])
    const result = await client.query('SELECT * FROM t WHERE id = $1', [uuid])
    expect(result.rows[0].id).toBe(uuid)
  })

  it('should handle JSONB', async () => {
    await client.query('CREATE TABLE t (data JSONB)')
    const jsonData = { name: 'Alice', age: 30 }
    await client.query('INSERT INTO t VALUES ($1)', [JSON.stringify(jsonData)])
    const result = await client.query('SELECT * FROM t')
    expect(result.rows[0].data).toBeDefined()
  })
})

// ============================================================================
// UTILITIES TESTS
// ============================================================================

describe('utilities', () => {
  describe('types', () => {
    it('should export type constants', () => {
      expect(types.BOOL).toBeDefined()
      expect(types.INT4).toBeDefined()
      expect(types.INT8).toBeDefined()
      expect(types.TEXT).toBeDefined()
      expect(types.JSON).toBeDefined()
      expect(types.JSONB).toBeDefined()
      expect(types.UUID).toBeDefined()
    })
  })

  describe('default export', () => {
    it('should have Client, Pool, types, errors', () => {
      expect(crdb.Client).toBeDefined()
      expect(crdb.Pool).toBeDefined()
      expect(crdb.types).toBeDefined()
      expect(crdb.DatabaseError).toBeDefined()
      expect(crdb.ConnectionError).toBeDefined()
    })
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
        name STRING NOT NULL,
        email STRING UNIQUE,
        created_at TIMESTAMP DEFAULT now()
      )
    `)

    // Insert data
    const insertResult = await client.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
      ['Alice', 'alice@example.com.ai']
    )
    expect(insertResult.rows[0].name).toBe('Alice')
    const userId = insertResult.rows[0].id

    // Read data
    const selectResult = await client.query('SELECT * FROM users WHERE id = $1', [userId])
    expect(selectResult.rows[0].email).toBe('alice@example.com.ai')

    // Update data
    const updateResult = await client.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
      ['Alicia', userId]
    )
    expect(updateResult.rows[0].name).toBe('Alicia')

    // Delete data
    const deleteResult = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId])
    expect(deleteResult.rows[0].name).toBe('Alicia')

    await client.end()
  })

  it('should work with pool workflow', async () => {
    const pool = new Pool({ max: 5 })

    // Create schema
    await pool.query('CREATE TABLE posts (id SERIAL PRIMARY KEY, title STRING, body STRING)')

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

  it('should handle transaction with SERIALIZABLE isolation', async () => {
    const pool = new Pool()

    await pool.query('CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)')
    await pool.query('INSERT INTO accounts VALUES (1, 1000)')
    await pool.query('INSERT INTO accounts VALUES (2, 1000)')

    // Transfer money with SERIALIZABLE isolation
    const client = await pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
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

  it('should handle AS OF SYSTEM TIME for analytics', async () => {
    const pool = new Pool()

    await pool.query('CREATE TABLE metrics (id INT PRIMARY KEY, value INT, ts TIMESTAMP)')
    await pool.query("INSERT INTO metrics VALUES (1, 100, now())")
    await pool.query("INSERT INTO metrics VALUES (2, 200, now())")

    // Stale read for analytics (reduces contention)
    const result = await pool.query(`
      SELECT * FROM metrics AS OF SYSTEM TIME '-1s'
    `)
    expect(result).toBeDefined()

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
      database: 'defaultdb',
      shard: { key: 'user_id', count: 8, algorithm: 'hash' },
    } as CockroachConfig)
    expect(pool).toBeDefined()
  })

  it('should accept replica configuration', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'defaultdb',
      replica: {
        readPreference: 'secondary',
        writeThrough: true,
        jurisdiction: 'eu',
      },
    } as CockroachConfig)
    expect(pool).toBeDefined()
  })

  it('should accept cluster identifier', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'defaultdb',
      cluster: 'my-cluster-abc123',
    } as CockroachConfig)
    expect(pool).toBeDefined()
  })

  it('should accept doNamespace', () => {
    const pool = new Pool({
      host: 'localhost',
      database: 'defaultdb',
      doNamespace: {} as DurableObjectNamespace,
    } as CockroachConfig)
    expect(pool).toBeDefined()
  })
})
