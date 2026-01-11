/**
 * @dotdo/turso libsql API Compatibility Tests
 *
 * RED Phase: Tests for libsql-client API compatibility
 * These tests verify that @dotdo/turso provides a compatible interface
 * with the official @libsql/client package.
 *
 * Reference: https://github.com/tursodatabase/libsql-client-ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Import from @dotdo/turso (these will fail until implementation exists)
import {
  createClient,
  type Client,
  type Config,
  type ResultSet,
  type Row,
  type Value,
  type InStatement,
  type Transaction,
  type TransactionMode,
} from '@dotdo/turso'

// ============================================================================
// CLIENT CREATION TESTS
// ============================================================================

describe('@dotdo/turso libsql compatibility', () => {
  describe('createClient', () => {
    it('accepts url string in config', () => {
      const client = createClient({
        url: 'libsql://test-db.turso.io',
      })

      expect(client).toBeDefined()
      expect(typeof client.execute).toBe('function')
      expect(typeof client.batch).toBe('function')
      expect(typeof client.transaction).toBe('function')
      expect(typeof client.close).toBe('function')
    })

    it('accepts url with authToken', () => {
      const client = createClient({
        url: 'libsql://test-db.turso.io',
        authToken: 'test-auth-token-12345',
      })

      expect(client).toBeDefined()
    })

    it('accepts local file URL', () => {
      const client = createClient({
        url: 'file:./test.db',
      })

      expect(client).toBeDefined()
    })

    it('accepts in-memory URL', () => {
      const client = createClient({
        url: ':memory:',
      })

      expect(client).toBeDefined()
    })

    it('validates connection string format - rejects empty url', () => {
      expect(() => {
        createClient({
          url: '',
        })
      }).toThrow(/url|empty|invalid/i)
    })

    it('validates connection string format - rejects invalid protocol', () => {
      expect(() => {
        createClient({
          url: 'invalid://test.db',
        })
      }).toThrow(/protocol|unsupported|invalid/i)
    })

    it('accepts http/https URLs', () => {
      const httpClient = createClient({
        url: 'http://localhost:8080',
      })
      expect(httpClient).toBeDefined()

      const httpsClient = createClient({
        url: 'https://db.example.com.ai',
      })
      expect(httpsClient).toBeDefined()
    })

    it('accepts ws/wss URLs', () => {
      const wsClient = createClient({
        url: 'ws://localhost:8080',
      })
      expect(wsClient).toBeDefined()

      const wssClient = createClient({
        url: 'wss://db.example.com.ai',
      })
      expect(wssClient).toBeDefined()
    })

    it('accepts syncUrl for embedded replicas', () => {
      const client = createClient({
        url: 'file:./local.db',
        syncUrl: 'libsql://test-db.turso.io',
        authToken: 'test-token',
      })

      expect(client).toBeDefined()
      expect(typeof client.sync).toBe('function')
    })

    it('accepts syncInterval for auto-sync', () => {
      const client = createClient({
        url: 'file:./local.db',
        syncUrl: 'libsql://test-db.turso.io',
        authToken: 'test-token',
        syncInterval: 60, // seconds
      })

      expect(client).toBeDefined()
    })

    it('accepts encryptionKey for encrypted databases', () => {
      const client = createClient({
        url: 'file:./encrypted.db',
        encryptionKey: 'secret-key-1234567890',
      })

      expect(client).toBeDefined()
    })
  })

  // ============================================================================
  // EXECUTE TESTS
  // ============================================================================

  describe('execute', () => {
    let client: Client

    beforeEach(() => {
      client = createClient({
        url: ':memory:',
      })
    })

    afterEach(async () => {
      await client.close()
    })

    it('executes single SELECT with string', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")

      const result = await client.execute('SELECT * FROM users')

      expect(result).toBeDefined()
      expect(result.rows).toBeDefined()
      expect(Array.isArray(result.rows)).toBe(true)
    })

    it('executes SELECT with positional args', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")
      await client.execute("INSERT INTO users (name) VALUES ('Bob')")

      const result = await client.execute({
        sql: 'SELECT * FROM users WHERE name = ?',
        args: ['Alice'],
      })

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('executes SELECT with named args', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")

      const result = await client.execute({
        sql: 'SELECT * FROM users WHERE name = :name',
        args: { name: 'Alice' },
      })

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('executes SELECT with $name style args', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")

      const result = await client.execute({
        sql: 'SELECT * FROM users WHERE name = $name',
        args: { name: 'Alice' },
      })

      expect(result.rows).toHaveLength(1)
    })

    it('executes SELECT with @name style args', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")

      const result = await client.execute({
        sql: 'SELECT * FROM users WHERE name = @name',
        args: { name: 'Alice' },
      })

      expect(result.rows).toHaveLength(1)
    })

    it('executes INSERT with params', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')

      const result = await client.execute({
        sql: 'INSERT INTO users (name, age) VALUES (?, ?)',
        args: ['Charlie', 30],
      })

      expect(result.rowsAffected).toBe(1)
      expect(result.lastInsertRowid).toBeDefined()
    })

    it('executes UPDATE and returns rowsAffected', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")
      await client.execute("INSERT INTO users (name) VALUES ('Bob')")

      const result = await client.execute({
        sql: "UPDATE users SET name = 'Updated' WHERE name = ?",
        args: ['Alice'],
      })

      expect(result.rowsAffected).toBe(1)
    })

    it('executes DELETE and returns rowsAffected', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")
      await client.execute("INSERT INTO users (name) VALUES ('Bob')")

      const result = await client.execute({
        sql: 'DELETE FROM users WHERE name = ?',
        args: ['Alice'],
      })

      expect(result.rowsAffected).toBe(1)
    })

    it('returns ResultSet with columns and rows', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      await client.execute("INSERT INTO users (name, age) VALUES ('Alice', 25)")

      const result = await client.execute('SELECT id, name, age FROM users')

      expect(result.columns).toBeDefined()
      expect(result.columns).toEqual(['id', 'name', 'age'])
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toBeDefined()
    })

    it('returns rows with both index and named access', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")

      const result = await client.execute('SELECT id, name FROM users')
      const row = result.rows[0]

      // Named access
      expect(row.id).toBeDefined()
      expect(row.name).toBe('Alice')

      // Index access
      expect(row[0]).toBeDefined()
      expect(row[1]).toBe('Alice')
    })

    it('handles NULL values', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, bio TEXT)')
      await client.execute("INSERT INTO users (name, bio) VALUES ('Alice', NULL)")

      const result = await client.execute('SELECT * FROM users')

      expect(result.rows[0].bio).toBeNull()
    })

    it('handles BLOB values', async () => {
      await client.execute('CREATE TABLE files (id INTEGER PRIMARY KEY, data BLOB)')
      const blobData = new Uint8Array([1, 2, 3, 4, 5])

      await client.execute({
        sql: 'INSERT INTO files (data) VALUES (?)',
        args: [blobData],
      })

      const result = await client.execute('SELECT data FROM files')

      expect(result.rows[0].data).toBeInstanceOf(Uint8Array)
    })

    it('handles INTEGER values correctly', async () => {
      await client.execute('CREATE TABLE numbers (id INTEGER PRIMARY KEY, value INTEGER)')
      await client.execute('INSERT INTO numbers (value) VALUES (42)')
      await client.execute(`INSERT INTO numbers (value) VALUES (${Number.MAX_SAFE_INTEGER})`)

      const result = await client.execute('SELECT value FROM numbers ORDER BY id')

      expect(result.rows[0].value).toBe(42)
      expect(typeof result.rows[0].value).toBe('number')
    })

    it('handles REAL/FLOAT values correctly', async () => {
      await client.execute('CREATE TABLE decimals (id INTEGER PRIMARY KEY, value REAL)')
      await client.execute('INSERT INTO decimals (value) VALUES (3.14159)')

      const result = await client.execute('SELECT value FROM decimals')

      expect(result.rows[0].value).toBeCloseTo(3.14159, 5)
      expect(typeof result.rows[0].value).toBe('number')
    })

    it('handles TEXT values correctly', async () => {
      await client.execute('CREATE TABLE texts (id INTEGER PRIMARY KEY, value TEXT)')
      await client.execute("INSERT INTO texts (value) VALUES ('Hello, World!')")

      const result = await client.execute('SELECT value FROM texts')

      expect(result.rows[0].value).toBe('Hello, World!')
      expect(typeof result.rows[0].value).toBe('string')
    })

    it('handles BigInt for large integers', async () => {
      await client.execute('CREATE TABLE big (id INTEGER PRIMARY KEY, value INTEGER)')
      const bigValue = BigInt('9223372036854775807') // Max 64-bit signed int

      await client.execute({
        sql: 'INSERT INTO big (value) VALUES (?)',
        args: [bigValue],
      })

      const result = await client.execute('SELECT value FROM big')

      // libsql returns bigint for values > MAX_SAFE_INTEGER
      expect(result.rows[0].value).toBe(bigValue)
    })

    it('throws error for invalid SQL', async () => {
      await expect(
        client.execute('INVALID SQL SYNTAX')
      ).rejects.toThrow()
    })

    it('throws error for non-existent table', async () => {
      await expect(
        client.execute('SELECT * FROM nonexistent_table')
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // BATCH TESTS
  // ============================================================================

  describe('batch', () => {
    let client: Client

    beforeEach(() => {
      client = createClient({
        url: ':memory:',
      })
    })

    afterEach(async () => {
      await client.close()
    })

    it('executes multiple statements', async () => {
      const results = await client.batch([
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        "INSERT INTO users (name) VALUES ('Alice')",
        "INSERT INTO users (name) VALUES ('Bob')",
        'SELECT * FROM users',
      ])

      expect(results).toHaveLength(4)
      expect(results[3].rows).toHaveLength(2)
    })

    it('returns array of ResultSets', async () => {
      const results = await client.batch([
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        "INSERT INTO users (name) VALUES ('Alice')",
        'SELECT * FROM users',
      ])

      expect(Array.isArray(results)).toBe(true)
      results.forEach((result) => {
        expect(result).toHaveProperty('columns')
        expect(result).toHaveProperty('rows')
        expect(result).toHaveProperty('rowsAffected')
      })
    })

    it('executes statements with parameters', async () => {
      const results = await client.batch([
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        { sql: 'INSERT INTO users (name) VALUES (?)', args: ['Alice'] },
        { sql: 'INSERT INTO users (name) VALUES (?)', args: ['Bob'] },
        { sql: 'SELECT * FROM users WHERE name = ?', args: ['Alice'] },
      ])

      expect(results[3].rows).toHaveLength(1)
      expect(results[3].rows[0].name).toBe('Alice')
    })

    it('executes in transaction (atomic)', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT UNIQUE)')
      await client.execute("INSERT INTO users (name) VALUES ('Existing')")

      // This batch should fail because of UNIQUE constraint
      await expect(
        client.batch([
          "INSERT INTO users (name) VALUES ('New1')",
          "INSERT INTO users (name) VALUES ('Existing')", // Duplicate
          "INSERT INTO users (name) VALUES ('New2')",
        ])
      ).rejects.toThrow()

      // No new rows should be inserted (transaction rolled back)
      const result = await client.execute('SELECT COUNT(*) as count FROM users')
      expect(result.rows[0].count).toBe(1)
    })

    it('accepts write transaction mode', async () => {
      const results = await client.batch(
        [
          'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
          "INSERT INTO users (name) VALUES ('Alice')",
        ],
        'write'
      )

      expect(results).toHaveLength(2)
    })

    it('accepts read transaction mode', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")

      const results = await client.batch(
        ['SELECT * FROM users', 'SELECT COUNT(*) FROM users'],
        'read'
      )

      expect(results).toHaveLength(2)
    })

    it('accepts deferred transaction mode (default)', async () => {
      const results = await client.batch(
        [
          'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
          "INSERT INTO users (name) VALUES ('Alice')",
        ],
        'deferred'
      )

      expect(results).toHaveLength(2)
    })

    it('rejects write operations in read mode', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      await expect(
        client.batch(
          ["INSERT INTO users (name) VALUES ('Alice')"],
          'read'
        )
      ).rejects.toThrow()
    })

    it('handles empty batch', async () => {
      const results = await client.batch([])

      expect(results).toHaveLength(0)
    })
  })

  // ============================================================================
  // TRANSACTION TESTS
  // ============================================================================

  describe('transaction', () => {
    let client: Client

    beforeEach(() => {
      client = createClient({
        url: ':memory:',
      })
    })

    afterEach(async () => {
      await client.close()
    })

    it('returns a Transaction object', async () => {
      const tx = await client.transaction()

      expect(tx).toBeDefined()
      expect(typeof tx.execute).toBe('function')
      expect(typeof tx.commit).toBe('function')
      expect(typeof tx.rollback).toBe('function')
      expect(typeof tx.close).toBe('function')

      await tx.rollback()
    })

    it('commits on success', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction()
      await tx.execute("INSERT INTO users (name) VALUES ('Alice')")
      await tx.execute("INSERT INTO users (name) VALUES ('Bob')")
      await tx.commit()

      const result = await client.execute('SELECT COUNT(*) as count FROM users')
      expect(result.rows[0].count).toBe(2)
    })

    it('rolls back on explicit rollback', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction()
      await tx.execute("INSERT INTO users (name) VALUES ('Alice')")
      await tx.execute("INSERT INTO users (name) VALUES ('Bob')")
      await tx.rollback()

      const result = await client.execute('SELECT COUNT(*) as count FROM users')
      expect(result.rows[0].count).toBe(0)
    })

    it('rolls back on error', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT UNIQUE)')

      const tx = await client.transaction()
      try {
        await tx.execute("INSERT INTO users (name) VALUES ('Alice')")
        await tx.execute("INSERT INTO users (name) VALUES ('Alice')") // Duplicate
        await tx.commit()
      } catch {
        await tx.rollback()
      }

      const result = await client.execute('SELECT COUNT(*) as count FROM users')
      expect(result.rows[0].count).toBe(0)
    })

    it('supports execute with positional args', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction()
      await tx.execute({
        sql: 'INSERT INTO users (name) VALUES (?)',
        args: ['Alice'],
      })
      await tx.commit()

      const result = await client.execute('SELECT * FROM users')
      expect(result.rows[0].name).toBe('Alice')
    })

    it('supports execute with named args', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction()
      await tx.execute({
        sql: 'INSERT INTO users (name) VALUES (:name)',
        args: { name: 'Alice' },
      })
      await tx.commit()

      const result = await client.execute('SELECT * FROM users')
      expect(result.rows[0].name).toBe('Alice')
    })

    it('accepts write transaction mode', async () => {
      const tx = await client.transaction('write')
      await tx.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await tx.commit()

      // Table should exist
      const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      expect(result.rows).toHaveLength(1)
    })

    it('accepts read transaction mode', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")

      const tx = await client.transaction('read')
      const result = await tx.execute('SELECT * FROM users')
      await tx.close()

      expect(result.rows).toHaveLength(1)
    })

    it('rejects writes in read mode', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction('read')

      await expect(
        tx.execute("INSERT INTO users (name) VALUES ('Alice')")
      ).rejects.toThrow()

      await tx.close()
    })

    it('close() implicitly rolls back uncommitted transaction', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction()
      await tx.execute("INSERT INTO users (name) VALUES ('Alice')")
      await tx.close() // Close without commit

      const result = await client.execute('SELECT COUNT(*) as count FROM users')
      expect(result.rows[0].count).toBe(0)
    })

    it('throws error when using transaction after commit', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction()
      await tx.execute("INSERT INTO users (name) VALUES ('Alice')")
      await tx.commit()

      await expect(
        tx.execute("INSERT INTO users (name) VALUES ('Bob')")
      ).rejects.toThrow()
    })

    it('throws error when using transaction after rollback', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction()
      await tx.rollback()

      await expect(
        tx.execute("INSERT INTO users (name) VALUES ('Alice')")
      ).rejects.toThrow()
    })

    it('supports batch within transaction', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const tx = await client.transaction()
      const results = await tx.batch([
        { sql: 'INSERT INTO users (name) VALUES (?)', args: ['Alice'] },
        { sql: 'INSERT INTO users (name) VALUES (?)', args: ['Bob'] },
      ])
      await tx.commit()

      expect(results).toHaveLength(2)

      const selectResult = await client.execute('SELECT COUNT(*) as count FROM users')
      expect(selectResult.rows[0].count).toBe(2)
    })
  })

  // ============================================================================
  // PREPARED STATEMENT TESTS
  // ============================================================================

  describe('prepared statements', () => {
    let client: Client

    beforeEach(() => {
      client = createClient({
        url: ':memory:',
      })
    })

    afterEach(async () => {
      await client.close()
    })

    it('supports InStatement with sql and args', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')

      const stmt: InStatement = {
        sql: 'INSERT INTO users (name, age) VALUES (?, ?)',
        args: ['Alice', 25],
      }

      const result = await client.execute(stmt)
      expect(result.rowsAffected).toBe(1)
    })

    it('supports InStatement with positional args array', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const stmt: InStatement = {
        sql: 'INSERT INTO users (name) VALUES (?)',
        args: ['Alice'],
      }

      await client.execute(stmt)

      const selectStmt: InStatement = {
        sql: 'SELECT * FROM users WHERE name = ?',
        args: ['Alice'],
      }

      const result = await client.execute(selectStmt)
      expect(result.rows).toHaveLength(1)
    })

    it('supports InStatement with named args object', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')

      const stmt: InStatement = {
        sql: 'INSERT INTO users (name, age) VALUES (:name, :age)',
        args: { name: 'Alice', age: 25 },
      }

      const result = await client.execute(stmt)
      expect(result.rowsAffected).toBe(1)
    })

    it('handles multiple executions with different args', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

      const sql = 'INSERT INTO users (name) VALUES (?)'

      await client.execute({ sql, args: ['Alice'] })
      await client.execute({ sql, args: ['Bob'] })
      await client.execute({ sql, args: ['Charlie'] })

      const result = await client.execute('SELECT COUNT(*) as count FROM users')
      expect(result.rows[0].count).toBe(3)
    })
  })

  // ============================================================================
  // TYPE COERCION TESTS
  // ============================================================================

  describe('type coercion', () => {
    let client: Client

    beforeEach(() => {
      client = createClient({
        url: ':memory:',
      })
    })

    afterEach(async () => {
      await client.close()
    })

    it('coerces JavaScript number to INTEGER', async () => {
      await client.execute('CREATE TABLE nums (value INTEGER)')
      await client.execute({ sql: 'INSERT INTO nums (value) VALUES (?)', args: [42] })

      const result = await client.execute('SELECT value, typeof(value) as type FROM nums')
      expect(result.rows[0].value).toBe(42)
    })

    it('coerces JavaScript number to REAL', async () => {
      await client.execute('CREATE TABLE nums (value REAL)')
      await client.execute({ sql: 'INSERT INTO nums (value) VALUES (?)', args: [3.14] })

      const result = await client.execute('SELECT value FROM nums')
      expect(result.rows[0].value).toBeCloseTo(3.14, 2)
    })

    it('coerces JavaScript string to TEXT', async () => {
      await client.execute('CREATE TABLE texts (value TEXT)')
      await client.execute({ sql: 'INSERT INTO texts (value) VALUES (?)', args: ['hello'] })

      const result = await client.execute('SELECT value FROM texts')
      expect(result.rows[0].value).toBe('hello')
    })

    it('coerces JavaScript null to NULL', async () => {
      await client.execute('CREATE TABLE nulls (value TEXT)')
      await client.execute({ sql: 'INSERT INTO nulls (value) VALUES (?)', args: [null] })

      const result = await client.execute('SELECT value FROM nulls')
      expect(result.rows[0].value).toBeNull()
    })

    it('coerces JavaScript undefined to NULL', async () => {
      await client.execute('CREATE TABLE nulls (value TEXT)')
      await client.execute({ sql: 'INSERT INTO nulls (value) VALUES (?)', args: [undefined] })

      const result = await client.execute('SELECT value FROM nulls')
      expect(result.rows[0].value).toBeNull()
    })

    it('coerces JavaScript boolean to INTEGER (0/1)', async () => {
      await client.execute('CREATE TABLE bools (value INTEGER)')
      await client.execute({ sql: 'INSERT INTO bools (value) VALUES (?)', args: [true] })
      await client.execute({ sql: 'INSERT INTO bools (value) VALUES (?)', args: [false] })

      const result = await client.execute('SELECT value FROM bools ORDER BY rowid')
      expect(result.rows[0].value).toBe(1)
      expect(result.rows[1].value).toBe(0)
    })

    it('coerces JavaScript BigInt to INTEGER', async () => {
      await client.execute('CREATE TABLE bigs (value INTEGER)')
      await client.execute({ sql: 'INSERT INTO bigs (value) VALUES (?)', args: [BigInt(12345)] })

      const result = await client.execute('SELECT value FROM bigs')
      expect(result.rows[0].value).toBe(12345)
    })

    it('coerces JavaScript Uint8Array to BLOB', async () => {
      await client.execute('CREATE TABLE blobs (value BLOB)')
      const data = new Uint8Array([1, 2, 3, 4, 5])
      await client.execute({ sql: 'INSERT INTO blobs (value) VALUES (?)', args: [data] })

      const result = await client.execute('SELECT value FROM blobs')
      expect(result.rows[0].value).toBeInstanceOf(Uint8Array)
      expect([...(result.rows[0].value as Uint8Array)]).toEqual([1, 2, 3, 4, 5])
    })

    it('coerces JavaScript ArrayBuffer to BLOB', async () => {
      await client.execute('CREATE TABLE blobs (value BLOB)')
      const buffer = new ArrayBuffer(5)
      const view = new Uint8Array(buffer)
      view.set([1, 2, 3, 4, 5])

      await client.execute({ sql: 'INSERT INTO blobs (value) VALUES (?)', args: [buffer] })

      const result = await client.execute('SELECT value FROM blobs')
      expect(result.rows[0].value).toBeInstanceOf(Uint8Array)
    })

    it('coerces JavaScript Date to ISO string', async () => {
      await client.execute('CREATE TABLE dates (value TEXT)')
      const date = new Date('2024-01-15T10:30:00.000Z')
      await client.execute({ sql: 'INSERT INTO dates (value) VALUES (?)', args: [date] })

      const result = await client.execute('SELECT value FROM dates')
      expect(result.rows[0].value).toBe('2024-01-15T10:30:00.000Z')
    })

    it('throws error for unsupported types', async () => {
      await client.execute('CREATE TABLE test (value TEXT)')

      await expect(
        client.execute({ sql: 'INSERT INTO test (value) VALUES (?)', args: [{ obj: true }] })
      ).rejects.toThrow()

      await expect(
        client.execute({ sql: 'INSERT INTO test (value) VALUES (?)', args: [Symbol('test')] })
      ).rejects.toThrow()

      await expect(
        client.execute({ sql: 'INSERT INTO test (value) VALUES (?)', args: [() => {}] })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // CONNECTION STRING PARSING TESTS
  // ============================================================================

  describe('connection string parsing', () => {
    it('parses libsql:// protocol', () => {
      const client = createClient({
        url: 'libsql://my-database.turso.io',
      })
      expect(client).toBeDefined()
    })

    it('parses libsql:// with database name', () => {
      const client = createClient({
        url: 'libsql://my-org-my-database.turso.io',
      })
      expect(client).toBeDefined()
    })

    it('parses http:// protocol', () => {
      const client = createClient({
        url: 'http://localhost:8080',
      })
      expect(client).toBeDefined()
    })

    it('parses https:// protocol', () => {
      const client = createClient({
        url: 'https://my-database.turso.io',
      })
      expect(client).toBeDefined()
    })

    it('parses file: protocol', () => {
      const client = createClient({
        url: 'file:./local.db',
      })
      expect(client).toBeDefined()
    })

    it('parses file: with absolute path', () => {
      const client = createClient({
        url: 'file:/tmp/database.db',
      })
      expect(client).toBeDefined()
    })

    it('parses :memory: for in-memory database', () => {
      const client = createClient({
        url: ':memory:',
      })
      expect(client).toBeDefined()
    })

    it('handles URL with port', () => {
      const client = createClient({
        url: 'http://localhost:8080',
      })
      expect(client).toBeDefined()
    })

    it('handles URL with path', () => {
      const client = createClient({
        url: 'http://localhost:8080/v1/db',
      })
      expect(client).toBeDefined()
    })

    it('rejects malformed URLs', () => {
      expect(() => createClient({ url: 'not-a-url' })).toThrow(/url|invalid|malformed/i)
      expect(() => createClient({ url: '://missing-protocol' })).toThrow(/url|protocol|invalid/i)
      expect(() => createClient({ url: 'ftp://wrong-protocol.com' })).toThrow(/protocol|unsupported|ftp/i)
    })
  })

  // ============================================================================
  // AUTH TOKEN HANDLING TESTS
  // ============================================================================

  describe('auth token handling', () => {
    it('accepts authToken in config', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
      })
      expect(client).toBeDefined()
    })

    it('works without authToken for local databases', () => {
      const client = createClient({
        url: ':memory:',
      })
      expect(client).toBeDefined()
    })

    it('works without authToken for file databases', () => {
      const client = createClient({
        url: 'file:./test.db',
      })
      expect(client).toBeDefined()
    })

    it('rejects empty authToken', () => {
      expect(() =>
        createClient({
          url: 'libsql://test.turso.io',
          authToken: '',
        })
      ).toThrow(/auth|token|empty|invalid/i)
    })

    it('handles JWT-style tokens', () => {
      const jwtToken =
        'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE2OTk1NTQ0NjAsImV4cCI6MTY5OTU1ODA2MCwianRpIjoiYWJjZGVmMTIzNDU2In0.signature'

      const client = createClient({
        url: 'libsql://test.turso.io',
        authToken: jwtToken,
      })
      expect(client).toBeDefined()
    })
  })

  // ============================================================================
  // CLIENT LIFECYCLE TESTS
  // ============================================================================

  describe('client lifecycle', () => {
    it('close() releases resources', async () => {
      const client = createClient({
        url: ':memory:',
      })

      await client.execute('SELECT 1')
      await client.close()

      // After close, operations should fail
      await expect(client.execute('SELECT 1')).rejects.toThrow()
    })

    it('allows multiple close() calls', async () => {
      const client = createClient({
        url: ':memory:',
      })

      await client.close()
      await client.close() // Should not throw
    })

    it('closed property indicates state', async () => {
      const client = createClient({
        url: ':memory:',
      })

      expect(client.closed).toBe(false)

      await client.close()

      expect(client.closed).toBe(true)
    })
  })

  // ============================================================================
  // EMBEDDED REPLICA TESTS
  // ============================================================================

  describe('embedded replicas', () => {
    it('sync() method exists when syncUrl is provided', () => {
      const client = createClient({
        url: 'file:./local.db',
        syncUrl: 'libsql://remote.turso.io',
        authToken: 'test-token',
      })

      expect(typeof client.sync).toBe('function')
    })

    it('sync() returns a promise', async () => {
      const client = createClient({
        url: ':memory:',
        syncUrl: 'libsql://remote.turso.io',
        authToken: 'test-token',
      })

      const syncPromise = client.sync()
      expect(syncPromise).toBeInstanceOf(Promise)

      // Note: This will likely fail without a real remote, which is expected in RED phase
      try {
        await syncPromise
      } catch {
        // Expected to fail without real connection
      }
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('error handling', () => {
    let client: Client

    beforeEach(() => {
      client = createClient({
        url: ':memory:',
      })
    })

    afterEach(async () => {
      await client.close()
    })

    it('throws LibsqlError for SQL syntax errors', async () => {
      try {
        await client.execute('INVALID SQL')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toHaveProperty('code')
        expect(error).toHaveProperty('message')
      }
    })

    it('throws LibsqlError for constraint violations', async () => {
      await client.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT UNIQUE)')
      await client.execute("INSERT INTO users (name) VALUES ('Alice')")

      try {
        await client.execute("INSERT INTO users (name) VALUES ('Alice')")
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toHaveProperty('code')
      }
    })

    it('includes SQL in error for debugging', async () => {
      try {
        await client.execute('SELECT * FROM nonexistent')
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        const message = (error as Error).message
        expect(message).toContain('nonexistent')
      }
    })
  })
})
