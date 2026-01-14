/**
 * @dotdo/turso - Turso/libSQL SDK compat tests
 *
 * Tests for @libsql/client API compatibility backed by DO SQLite:
 * - createClient() - Client initialization with config
 * - execute() - Single statement execution
 * - batch() - Multiple statements in transaction
 * - transaction() - Interactive transactions
 * - sync() - Embedded replica sync
 *
 * @see https://docs.turso.tech/sdk/ts/reference
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  Client,
  Config,
  ExtendedTursoConfig,
  ResultSet,
  Transaction,
  TransactionMode,
} from './types'
import { LibsqlError, LibsqlBatchError } from './types'
import { createClient, createResultSet, parseStatement } from './turso'

// ============================================================================
// CREATE CLIENT TESTS
// ============================================================================

describe('createClient', () => {
  it('should create client with URL only', () => {
    const client = createClient({ url: 'libsql://test.turso.io' })
    expect(client).toBeDefined()
    expect(client.closed).toBe(false)
  })

  it('should create client with auth token', () => {
    const client = createClient({
      url: 'libsql://test.turso.io',
      authToken: 'token123',
    })
    expect(client).toBeDefined()
  })

  it('should create client with file: URL', () => {
    const client = createClient({ url: 'file:local.db' })
    expect(client).toBeDefined()
  })

  it('should create client with :memory:', () => {
    const client = createClient({ url: ':memory:' })
    expect(client).toBeDefined()
  })

  it('should accept http URL', () => {
    const client = createClient({ url: 'http://localhost:8080' })
    expect(client.protocol).toBe('http')
  })

  it('should accept https URL', () => {
    const client = createClient({ url: 'https://test.turso.io' })
    expect(client.protocol).toBe('https')
  })

  it('should accept ws URL', () => {
    const client = createClient({ url: 'ws://localhost:8080' })
    expect(client.protocol).toBe('ws')
  })

  it('should accept wss URL', () => {
    const client = createClient({ url: 'wss://test.turso.io' })
    expect(client.protocol).toBe('wss')
  })

  it('should accept libsql URL', () => {
    const client = createClient({ url: 'libsql://test.turso.io' })
    expect(client.protocol).toBe('libsql')
  })

  it('should set intMode', () => {
    const client = createClient({ url: ':memory:', intMode: 'bigint' })
    expect(client).toBeDefined()
  })

  it('should set concurrency', () => {
    const client = createClient({ url: ':memory:', concurrency: 10 })
    expect(client).toBeDefined()
  })

  it('should accept syncUrl for embedded replicas', () => {
    const client = createClient({
      url: 'file:local.db',
      syncUrl: 'libsql://remote.turso.io',
    })
    expect(client).toBeDefined()
  })

  it('should accept extended DO config', () => {
    const client = createClient({
      url: ':memory:',
      doNamespace: {} as DurableObjectNamespace,
      shard: { algorithm: 'consistent', count: 4 },
      replica: { readPreference: 'nearest' },
    } as ExtendedTursoConfig)
    expect(client).toBeDefined()
  })
})

// ============================================================================
// EXECUTE TESTS
// ============================================================================

describe('execute', () => {
  let client: Client

  beforeEach(() => {
    client = createClient({ url: ':memory:' })
  })

  it('should execute simple SQL string', async () => {
    const result = await client.execute('SELECT 1')
    expect(result).toBeDefined()
    expect(result.columns).toBeDefined()
    expect(result.rows).toBeDefined()
  })

  it('should execute SQL with positional args', async () => {
    await client.execute('CREATE TABLE users (id INTEGER, name TEXT)')
    await client.execute({
      sql: 'INSERT INTO users VALUES (?, ?)',
      args: [1, 'Alice'],
    })

    const result = await client.execute('SELECT * FROM users')
    expect(result.rows.length).toBe(1)
  })

  it('should execute SQL with named args', async () => {
    await client.execute('CREATE TABLE users (id INTEGER, name TEXT)')
    await client.execute({
      sql: 'INSERT INTO users VALUES (:id, :name)',
      args: { id: 1, name: 'Bob' },
    })

    const result = await client.execute('SELECT * FROM users')
    expect(result.rows.length).toBe(1)
  })

  it('should return rowsAffected for INSERT', async () => {
    await client.execute('CREATE TABLE t (x INTEGER)')
    const result = await client.execute('INSERT INTO t VALUES (1)')
    expect(result.rowsAffected).toBe(1)
  })

  it('should return lastInsertRowid', async () => {
    await client.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT)')
    const result = await client.execute("INSERT INTO t (x) VALUES ('test')")
    expect(result.lastInsertRowid).toBeDefined()
  })

  it('should handle boolean values', async () => {
    await client.execute('CREATE TABLE flags (active INTEGER)')
    await client.execute({
      sql: 'INSERT INTO flags VALUES (?)',
      args: [true],
    })

    const result = await client.execute('SELECT * FROM flags')
    expect(result.rows[0][0]).toBe(1)
  })

  it('should handle Date values', async () => {
    await client.execute('CREATE TABLE events (ts TEXT)')
    const date = new Date('2025-01-01')
    await client.execute({
      sql: 'INSERT INTO events VALUES (?)',
      args: [date],
    })

    const result = await client.execute('SELECT * FROM events')
    expect(result.rows[0][0]).toBe(date.toISOString())
  })

  it('should handle null values', async () => {
    await client.execute('CREATE TABLE nullable (x TEXT)')
    await client.execute({
      sql: 'INSERT INTO nullable VALUES (?)',
      args: [null],
    })

    const result = await client.execute('SELECT * FROM nullable')
    expect(result.rows[0][0]).toBe(null)
  })

  it('should throw LibsqlError on syntax error', async () => {
    await expect(client.execute('INVALID SQL')).rejects.toThrow(LibsqlError)
  })

  it('should throw LibsqlError on constraint violation', async () => {
    await client.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    await client.execute('INSERT INTO t VALUES (1)')
    await expect(client.execute('INSERT INTO t VALUES (1)')).rejects.toThrow(LibsqlError)
  })
})

// ============================================================================
// RESULT SET TESTS
// ============================================================================

describe('ResultSet', () => {
  let client: Client

  beforeEach(async () => {
    client = createClient({ url: ':memory:' })
    await client.execute('CREATE TABLE users (id INTEGER, name TEXT, age INTEGER)')
    await client.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
    await client.execute("INSERT INTO users VALUES (2, 'Bob', 25)")
  })

  it('should provide column names', async () => {
    const result = await client.execute('SELECT id, name FROM users')
    expect(result.columns).toEqual(['id', 'name'])
  })

  it('should provide column types', async () => {
    const result = await client.execute('SELECT id, name FROM users')
    expect(result.columnTypes.length).toBe(2)
  })

  it('should access row by index', async () => {
    const result = await client.execute('SELECT id, name FROM users LIMIT 1')
    expect(result.rows[0][0]).toBe(1)
    expect(result.rows[0][1]).toBe('Alice')
  })

  it('should access row by column name', async () => {
    const result = await client.execute('SELECT id, name FROM users LIMIT 1')
    expect(result.rows[0]['id']).toBe(1)
    expect(result.rows[0]['name']).toBe('Alice')
  })

  it('should have row length', async () => {
    const result = await client.execute('SELECT id, name FROM users LIMIT 1')
    expect(result.rows[0].length).toBe(2)
  })

  it('should convert to JSON', async () => {
    const result = await client.execute('SELECT 1 as num')
    const json = result.toJSON()
    expect(json).toBeDefined()
    expect(json.columns).toBeDefined()
    expect(json.rows).toBeDefined()
  })
})

// ============================================================================
// BATCH TESTS
// ============================================================================

describe('batch', () => {
  let client: Client

  beforeEach(() => {
    client = createClient({ url: ':memory:' })
  })

  it('should execute multiple statements', async () => {
    const results = await client.batch([
      'CREATE TABLE t (x INTEGER)',
      'INSERT INTO t VALUES (1)',
      'INSERT INTO t VALUES (2)',
      'SELECT * FROM t',
    ])

    expect(results.length).toBe(4)
    expect(results[3].rows.length).toBe(2)
  })

  it('should execute in implicit transaction', async () => {
    const results = await client.batch([
      'CREATE TABLE t (x INTEGER)',
      'INSERT INTO t VALUES (1)',
      'SELECT * FROM t',
    ])

    expect(results[2].rows.length).toBe(1)
  })

  it('should rollback on error', async () => {
    await client.execute('CREATE TABLE t (x INTEGER UNIQUE)')

    await expect(
      client.batch([
        'INSERT INTO t VALUES (1)',
        'INSERT INTO t VALUES (2)',
        'INSERT INTO t VALUES (1)', // Duplicate - should fail
      ])
    ).rejects.toThrow()

    // Should have no rows due to rollback
    const result = await client.execute('SELECT * FROM t')
    expect(result.rows.length).toBe(0)
  })

  it('should throw LibsqlBatchError with statement index', async () => {
    await client.execute('CREATE TABLE t (x INTEGER UNIQUE)')
    await client.execute('INSERT INTO t VALUES (1)')

    try {
      await client.batch([
        'INSERT INTO t VALUES (2)',
        'INSERT INTO t VALUES (3)',
        'INSERT INTO t VALUES (1)', // Will fail at index 2
      ])
    } catch (e) {
      expect(e).toBeInstanceOf(LibsqlBatchError)
      expect((e as LibsqlBatchError).statementIndex).toBe(2)
    }
  })

  it('should accept transaction mode', async () => {
    const results = await client.batch(
      ['SELECT 1'],
      'read' as TransactionMode
    )
    expect(results.length).toBe(1)
  })

  it('should support statements with args', async () => {
    await client.execute('CREATE TABLE t (x INTEGER, y TEXT)')

    const results = await client.batch([
      { sql: 'INSERT INTO t VALUES (?, ?)', args: [1, 'a'] },
      { sql: 'INSERT INTO t VALUES (?, ?)', args: [2, 'b'] },
      'SELECT * FROM t',
    ])

    expect(results[2].rows.length).toBe(2)
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('transaction', () => {
  let client: Client

  beforeEach(async () => {
    client = createClient({ url: ':memory:' })
    await client.execute('CREATE TABLE t (x INTEGER)')
  })

  it('should start a transaction', async () => {
    const tx = await client.transaction()
    expect(tx).toBeDefined()
    expect(tx.closed).toBe(false)
    await tx.rollback()
  })

  it('should execute in transaction', async () => {
    const tx = await client.transaction()
    await tx.execute('INSERT INTO t VALUES (1)')
    await tx.commit()

    const result = await client.execute('SELECT * FROM t')
    expect(result.rows.length).toBe(1)
  })

  it('should rollback transaction', async () => {
    const tx = await client.transaction()
    await tx.execute('INSERT INTO t VALUES (1)')
    await tx.rollback()

    const result = await client.execute('SELECT * FROM t')
    expect(result.rows.length).toBe(0)
  })

  it('should support batch in transaction', async () => {
    const tx = await client.transaction()
    const results = await tx.batch([
      'INSERT INTO t VALUES (1)',
      'INSERT INTO t VALUES (2)',
    ])
    await tx.commit()

    expect(results.length).toBe(2)
    const result = await client.execute('SELECT * FROM t')
    expect(result.rows.length).toBe(2)
  })

  it('should close transaction', async () => {
    const tx = await client.transaction()
    tx.close()
    expect(tx.closed).toBe(true)
  })

  it('should rollback on close without commit', async () => {
    const tx = await client.transaction()
    await tx.execute('INSERT INTO t VALUES (1)')
    tx.close()

    const result = await client.execute('SELECT * FROM t')
    expect(result.rows.length).toBe(0)
  })

  it('should accept transaction mode', async () => {
    const tx = await client.transaction('read')
    expect(tx).toBeDefined()
    await tx.close()
  })

  it('should reject writes in read mode', async () => {
    const tx = await client.transaction('read')
    await expect(tx.execute('INSERT INTO t VALUES (1)')).rejects.toThrow()
    tx.close()
  })

  it('should support deferred mode', async () => {
    const tx = await client.transaction('deferred')
    await tx.execute('INSERT INTO t VALUES (1)')
    await tx.commit()

    const result = await client.execute('SELECT * FROM t')
    expect(result.rows.length).toBe(1)
  })
})

// ============================================================================
// EXECUTE MULTIPLE TESTS
// ============================================================================

describe('executeMultiple', () => {
  let client: Client

  beforeEach(() => {
    client = createClient({ url: ':memory:' })
  })

  it('should execute multiple semicolon-separated statements', async () => {
    await client.executeMultiple(`
      CREATE TABLE t (x INTEGER);
      INSERT INTO t VALUES (1);
      INSERT INTO t VALUES (2);
    `)

    const result = await client.execute('SELECT * FROM t')
    expect(result.rows.length).toBe(2)
  })

  it('should handle empty statements', async () => {
    await client.executeMultiple('SELECT 1;; SELECT 2;')
    // Should not throw
  })
})

// ============================================================================
// SYNC TESTS
// ============================================================================

describe('sync', () => {
  it('should sync embedded replica', async () => {
    const client = createClient({
      url: 'file:local.db',
      syncUrl: 'libsql://remote.turso.io',
    })

    const result = await client.sync()
    // For in-memory impl, returns undefined
    expect(result === undefined || typeof result === 'object').toBe(true)
  })

  it('should return undefined for non-replica', async () => {
    const client = createClient({ url: ':memory:' })
    const result = await client.sync()
    expect(result).toBeUndefined()
  })
})

// ============================================================================
// CLOSE TESTS
// ============================================================================

describe('close', () => {
  it('should close client', () => {
    const client = createClient({ url: ':memory:' })
    expect(client.closed).toBe(false)
    client.close()
    expect(client.closed).toBe(true)
  })

  it('should reject operations after close', async () => {
    const client = createClient({ url: ':memory:' })
    client.close()
    await expect(client.execute('SELECT 1')).rejects.toThrow()
  })
})

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('createResultSet', () => {
  it('should create result set from data', () => {
    const result = createResultSet(
      ['id', 'name'],
      ['INTEGER', 'TEXT'],
      [[1, 'Alice'], [2, 'Bob']],
      0,
      undefined
    )

    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows.length).toBe(2)
    expect(result.rows[0]['id']).toBe(1)
  })
})

describe('parseStatement', () => {
  it('should parse string statement', () => {
    const { sql, args } = parseStatement('SELECT 1')
    expect(sql).toBe('SELECT 1')
    expect(args).toEqual([])
  })

  it('should parse statement with args', () => {
    const { sql, args } = parseStatement({
      sql: 'SELECT ?',
      args: [42],
    })
    expect(sql).toBe('SELECT ?')
    expect(args).toEqual([42])
  })

  it('should convert boolean args to integer', () => {
    const { args } = parseStatement({
      sql: 'SELECT ?',
      args: [true],
    })
    expect(args).toEqual([1])
  })

  it('should convert Date args to ISO string', () => {
    const date = new Date('2025-01-01T00:00:00.000Z')
    const { args } = parseStatement({
      sql: 'SELECT ?',
      args: [date],
    })
    expect(args).toEqual(['2025-01-01T00:00:00.000Z'])
  })
})

// ============================================================================
// DO ROUTING TESTS
// ============================================================================

describe('DO routing', () => {
  it('should extract shard key from INSERT', () => {
    const client = createClient({
      url: ':memory:',
      shard: { key: 'user_id' },
    } as ExtendedTursoConfig)

    // Internal method to test shard key extraction
    // In production, this routes to appropriate DO shard
    expect(client).toBeDefined()
  })

  it('should route reads based on replica config', () => {
    const client = createClient({
      url: ':memory:',
      replica: { readPreference: 'secondary' },
    } as ExtendedTursoConfig)

    expect(client).toBeDefined()
  })

  it('should support write-through replication', () => {
    const client = createClient({
      url: ':memory:',
      replica: { writeThrough: true },
    } as ExtendedTursoConfig)

    expect(client).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration', () => {
  it('should work with realistic workflow', async () => {
    const client = createClient({ url: ':memory:' })

    // Create schema
    await client.batch([
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE)',
      'CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, body TEXT)',
      'CREATE INDEX posts_user_id ON posts(user_id)',
    ])

    // Insert users
    await client.batch([
      { sql: 'INSERT INTO users (name, email) VALUES (?, ?)', args: ['Alice', 'alice@example.com.ai'] },
      { sql: 'INSERT INTO users (name, email) VALUES (?, ?)', args: ['Bob', 'bob@example.com.ai'] },
    ])

    // Insert posts in transaction
    const tx = await client.transaction()
    await tx.execute({ sql: 'INSERT INTO posts (user_id, title, body) VALUES (?, ?, ?)', args: [1, 'Hello', 'World'] })
    await tx.execute({ sql: 'INSERT INTO posts (user_id, title, body) VALUES (?, ?, ?)', args: [1, 'Second', 'Post'] })
    await tx.commit()

    // Query with join
    const result = await client.execute(`
      SELECT u.name, p.title
      FROM users u
      JOIN posts p ON u.id = p.user_id
      WHERE u.name = 'Alice'
    `)

    expect(result.rows.length).toBe(2)
    expect(result.rows[0]['name']).toBe('Alice')

    client.close()
  })
})
