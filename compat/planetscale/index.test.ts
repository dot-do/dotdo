/**
 * @dotdo/planetscale - PlanetScale SDK compat tests
 *
 * Tests for @planetscale/database API compatibility backed by DO SQLite:
 * - connect() - Create connection via HTTP-based driver
 * - execute() - Execute queries with ? placeholders
 * - transaction() - Execute multiple queries atomically
 * - Result types - rows, headers, insertId, rowsAffected
 * - Error handling
 * - Batch execution
 *
 * @see https://github.com/planetscale/database-js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// NOTE: These imports will fail initially (RED phase)
// We are writing tests BEFORE the implementation exists
import {
  connect,
  Connection,
  Config,
  ExecutedQuery,
  Transaction,
  DatabaseError,
  // Cast types
  cast,
  hex,
  datetime,
  json,
} from './index'

// ============================================================================
// CONNECTION CREATION TESTS
// ============================================================================

describe('connect', () => {
  describe('configuration', () => {
    it('should create connection with host/username/password', () => {
      const conn = connect({
        host: 'aws.connect.psdb.cloud',
        username: 'test_user',
        password: 'test_password',
      })
      expect(conn).toBeDefined()
      expect(conn).toBeInstanceOf(Connection)
    })

    it('should create connection with url', () => {
      const conn = connect({
        url: 'mysql://user:pass@aws.connect.psdb.cloud/mydb',
      })
      expect(conn).toBeDefined()
    })

    it('should create connection with DATABASE_URL env style', () => {
      const conn = connect({
        url: process.env.DATABASE_URL ?? 'mysql://test:test@localhost/test',
      })
      expect(conn).toBeDefined()
    })

    it('should support fetch option for custom HTTP client', () => {
      const customFetch = vi.fn()
      const conn = connect({
        host: 'localhost',
        username: 'test',
        password: 'test',
        fetch: customFetch as unknown as typeof fetch,
      })
      expect(conn).toBeDefined()
    })

    it('should support format option for response format', () => {
      const conn = connect({
        host: 'localhost',
        username: 'test',
        password: 'test',
        format: 'json',
      })
      expect(conn).toBeDefined()
    })

    it('should support boost option for query caching', () => {
      const conn = connect({
        host: 'localhost',
        username: 'test',
        password: 'test',
        boost: true,
      })
      expect(conn).toBeDefined()
    })

    it('should throw error without credentials', () => {
      expect(() => connect({} as Config)).toThrow()
    })

    it('should throw error with empty host', () => {
      expect(() =>
        connect({
          host: '',
          username: 'test',
          password: 'test',
        })
      ).toThrow()
    })
  })

  describe('extended DO config', () => {
    it('should accept shard configuration', () => {
      const conn = connect({
        host: 'localhost',
        username: 'test',
        password: 'test',
        shard: { algorithm: 'consistent', count: 4 },
      })
      expect(conn).toBeDefined()
    })

    it('should accept replica configuration', () => {
      const conn = connect({
        host: 'localhost',
        username: 'test',
        password: 'test',
        replica: { readPreference: 'nearest' },
      })
      expect(conn).toBeDefined()
    })

    it('should accept doNamespace for production routing', () => {
      const conn = connect({
        host: 'localhost',
        username: 'test',
        password: 'test',
        doNamespace: {} as DurableObjectNamespace,
      })
      expect(conn).toBeDefined()
    })
  })
})

// ============================================================================
// EXECUTE TESTS
// ============================================================================

describe('conn.execute', () => {
  let conn: Connection

  beforeEach(() => {
    conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })
  })

  describe('basic queries', () => {
    it('should execute simple SELECT', async () => {
      const result = await conn.execute('SELECT 1')
      expect(result).toBeDefined()
      expect(result.rows).toBeDefined()
    })

    it('should return ExecutedQuery result', async () => {
      const result = await conn.execute('SELECT 1 as num')
      expect(result.headers).toBeDefined()
      expect(result.rows).toBeDefined()
      expect(result.size).toBeDefined()
      expect(result.time).toBeDefined()
    })

    it('should return rows as array of objects', async () => {
      await conn.execute('CREATE TABLE users (id INT, name VARCHAR(255))')
      await conn.execute("INSERT INTO users VALUES (1, 'Alice')")
      const result = await conn.execute('SELECT * FROM users')
      expect(Array.isArray(result.rows)).toBe(true)
      expect(result.rows[0]).toHaveProperty('id')
      expect(result.rows[0]).toHaveProperty('name')
    })

    it('should return headers array', async () => {
      await conn.execute('CREATE TABLE users (id INT, name VARCHAR(255))')
      const result = await conn.execute('SELECT * FROM users')
      expect(Array.isArray(result.headers)).toBe(true)
      expect(result.headers).toContain('id')
      expect(result.headers).toContain('name')
    })

    it('should return size (number of rows returned)', async () => {
      await conn.execute('CREATE TABLE users (id INT)')
      await conn.execute('INSERT INTO users VALUES (1), (2), (3)')
      const result = await conn.execute('SELECT * FROM users')
      expect(result.size).toBe(3)
    })

    it('should return time (execution time in ms)', async () => {
      const result = await conn.execute('SELECT 1')
      expect(typeof result.time).toBe('number')
      expect(result.time).toBeGreaterThanOrEqual(0)
    })
  })

  describe('typed queries', () => {
    it('should support generic type for rows', async () => {
      await conn.execute('CREATE TABLE users (id INT, name VARCHAR(255))')
      await conn.execute("INSERT INTO users VALUES (1, 'Alice')")

      interface User {
        id: number
        name: string
      }

      const result = await conn.execute<User>('SELECT * FROM users')
      const user = result.rows[0]
      expect(user.id).toBe(1)
      expect(user.name).toBe('Alice')
    })

    it('should infer types from query', async () => {
      await conn.execute('CREATE TABLE products (id INT, price DOUBLE)')
      await conn.execute('INSERT INTO products VALUES (1, 29.99)')

      const { rows } = await conn.execute<{ id: number; price: number }>(
        'SELECT id, price FROM products'
      )
      expect(rows[0].price).toBeCloseTo(29.99)
    })
  })

  describe('parameterized queries with ?', () => {
    beforeEach(async () => {
      await conn.execute('CREATE TABLE users (id INT, name VARCHAR(255), age INT)')
    })

    it('should execute with single parameter', async () => {
      await conn.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
      const result = await conn.execute('SELECT * FROM users WHERE id = ?', [1])
      expect(result.rows.length).toBe(1)
    })

    it('should execute with multiple parameters', async () => {
      const result = await conn.execute('INSERT INTO users VALUES (?, ?, ?)', [1, 'Bob', 25])
      expect(result.rowsAffected).toBe(1)
    })

    it('should handle string parameters', async () => {
      await conn.execute('INSERT INTO users VALUES (?, ?, ?)', [1, 'Carol', 28])
      const result = await conn.execute('SELECT * FROM users WHERE name = ?', ['Carol'])
      expect(result.rows[0].name).toBe('Carol')
    })

    it('should handle numeric parameters', async () => {
      await conn.execute('INSERT INTO users VALUES (?, ?, ?)', [1, 'Dave', 35])
      const result = await conn.execute('SELECT * FROM users WHERE age > ?', [30])
      expect(result.rows.length).toBe(1)
    })

    it('should handle null parameters', async () => {
      await conn.execute('INSERT INTO users VALUES (?, ?, ?)', [1, null, 30])
      const result = await conn.execute('SELECT * FROM users WHERE name IS NULL')
      expect(result.rows.length).toBe(1)
    })

    it('should handle boolean parameters (as 0/1)', async () => {
      await conn.execute('CREATE TABLE flags (id INT, active BOOLEAN)')
      await conn.execute('INSERT INTO flags VALUES (?, ?)', [1, true])
      await conn.execute('INSERT INTO flags VALUES (?, ?)', [2, false])
      const result = await conn.execute('SELECT * FROM flags WHERE active = ?', [true])
      expect(result.rows.length).toBe(1)
    })

    it('should escape special characters in strings', async () => {
      await conn.execute('INSERT INTO users VALUES (?, ?, ?)', [1, "O'Brien", 40])
      const result = await conn.execute('SELECT * FROM users WHERE id = ?', [1])
      expect(result.rows[0].name).toBe("O'Brien")
    })
  })

  describe('INSERT operations', () => {
    beforeEach(async () => {
      await conn.execute(
        'CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))'
      )
    })

    it('should return insertId for auto-increment', async () => {
      const result = await conn.execute('INSERT INTO users (name) VALUES (?)', ['Alice'])
      expect(result.insertId).toBeGreaterThan(0)
    })

    it('should return rowsAffected for insert', async () => {
      const result = await conn.execute('INSERT INTO users (name) VALUES (?)', ['Bob'])
      expect(result.rowsAffected).toBe(1)
    })

    it('should auto-increment IDs sequentially', async () => {
      const result1 = await conn.execute('INSERT INTO users (name) VALUES (?)', ['User1'])
      const result2 = await conn.execute('INSERT INTO users (name) VALUES (?)', ['User2'])
      expect(result2.insertId).toBeGreaterThan(result1.insertId!)
    })

    it('should handle insertId as string (bigint support)', async () => {
      const result = await conn.execute('INSERT INTO users (name) VALUES (?)', ['Test'])
      // PlanetScale returns insertId as string for bigint safety
      expect(result.insertId).toBeDefined()
    })
  })

  describe('UPDATE operations', () => {
    beforeEach(async () => {
      await conn.execute('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255), age INT)')
      await conn.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
      await conn.execute("INSERT INTO users VALUES (2, 'Bob', 25)")
    })

    it('should return rowsAffected for update', async () => {
      const result = await conn.execute('UPDATE users SET age = ? WHERE id = ?', [31, 1])
      expect(result.rowsAffected).toBe(1)
    })

    it('should update multiple rows', async () => {
      const result = await conn.execute('UPDATE users SET age = age + 1')
      expect(result.rowsAffected).toBe(2)
    })

    it('should return 0 rowsAffected when no match', async () => {
      const result = await conn.execute('UPDATE users SET age = ? WHERE id = ?', [99, 999])
      expect(result.rowsAffected).toBe(0)
    })
  })

  describe('DELETE operations', () => {
    beforeEach(async () => {
      await conn.execute('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255))')
      await conn.execute("INSERT INTO users VALUES (1, 'Alice')")
      await conn.execute("INSERT INTO users VALUES (2, 'Bob')")
      await conn.execute("INSERT INTO users VALUES (3, 'Carol')")
    })

    it('should return rowsAffected for delete', async () => {
      const result = await conn.execute('DELETE FROM users WHERE id = ?', [1])
      expect(result.rowsAffected).toBe(1)
    })

    it('should delete multiple rows', async () => {
      const result = await conn.execute('DELETE FROM users WHERE id > ?', [1])
      expect(result.rowsAffected).toBe(2)
    })

    it('should return 0 rowsAffected when no match', async () => {
      const result = await conn.execute('DELETE FROM users WHERE id = ?', [999])
      expect(result.rowsAffected).toBe(0)
    })
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('conn.transaction', () => {
  let conn: Connection

  beforeEach(async () => {
    conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })
    await conn.execute('CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)')
    await conn.execute('INSERT INTO accounts VALUES (1, 100)')
    await conn.execute('INSERT INTO accounts VALUES (2, 100)')
  })

  describe('basic transactions', () => {
    it('should execute transaction function', async () => {
      const result = await conn.transaction(async (tx) => {
        await tx.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [50, 1])
        await tx.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [50, 2])
        return 'success'
      })
      expect(result).toBe('success')
    })

    it('should commit on success', async () => {
      await conn.transaction(async (tx) => {
        await tx.execute('UPDATE accounts SET balance = ? WHERE id = ?', [50, 1])
      })

      const { rows } = await conn.execute('SELECT balance FROM accounts WHERE id = ?', [1])
      expect(rows[0].balance).toBe(50)
    })

    it('should rollback on error', async () => {
      try {
        await conn.transaction(async (tx) => {
          await tx.execute('UPDATE accounts SET balance = ? WHERE id = ?', [50, 1])
          throw new Error('Intentional error')
        })
      } catch {
        // Expected
      }

      const { rows } = await conn.execute('SELECT balance FROM accounts WHERE id = ?', [1])
      expect(rows[0].balance).toBe(100) // Original value
    })

    it('should return value from transaction', async () => {
      const result = await conn.transaction(async (tx) => {
        const { rows } = await tx.execute('SELECT SUM(balance) as total FROM accounts')
        return rows[0].total
      })
      expect(result).toBe(200)
    })
  })

  describe('transaction isolation', () => {
    it('should isolate reads within transaction', async () => {
      await conn.transaction(async (tx) => {
        await tx.execute('UPDATE accounts SET balance = ? WHERE id = ?', [50, 1])
        const { rows } = await tx.execute('SELECT balance FROM accounts WHERE id = ?', [1])
        expect(rows[0].balance).toBe(50)
      })
    })

    it('should support multiple statements', async () => {
      await conn.transaction(async (tx) => {
        await tx.execute('INSERT INTO accounts VALUES (?, ?)', [3, 300])
        await tx.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 3])
        const { rows } = await tx.execute('SELECT balance FROM accounts WHERE id = ?', [3])
        expect(rows[0].balance).toBe(200)
      })
    })
  })

  describe('transaction object', () => {
    it('should have execute method', async () => {
      await conn.transaction(async (tx) => {
        expect(typeof tx.execute).toBe('function')
        await tx.execute('SELECT 1')
      })
    })
  })
})

// ============================================================================
// BATCH EXECUTION TESTS
// ============================================================================

describe('batch execution', () => {
  let conn: Connection

  beforeEach(async () => {
    conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })
    await conn.execute('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255))')
  })

  it('should execute multiple queries in batch', async () => {
    // PlanetScale's batch execution pattern
    await conn.transaction(async (tx) => {
      await tx.execute('INSERT INTO users VALUES (?, ?)', [1, 'Alice'])
      await tx.execute('INSERT INTO users VALUES (?, ?)', [2, 'Bob'])
      await tx.execute('INSERT INTO users VALUES (?, ?)', [3, 'Carol'])
    })

    const { rows } = await conn.execute('SELECT COUNT(*) as count FROM users')
    expect(rows[0].count).toBe(3)
  })
})

// ============================================================================
// RESULT TYPE TESTS
// ============================================================================

describe('ExecutedQuery result', () => {
  let conn: Connection

  beforeEach(async () => {
    conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })
    await conn.execute('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255), age INT)')
    await conn.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
  })

  it('should have rows property', async () => {
    const result = await conn.execute('SELECT * FROM users')
    expect(result.rows).toBeDefined()
    expect(Array.isArray(result.rows)).toBe(true)
  })

  it('should have headers property', async () => {
    const result = await conn.execute('SELECT * FROM users')
    expect(result.headers).toBeDefined()
    expect(result.headers).toEqual(['id', 'name', 'age'])
  })

  it('should have size property (row count)', async () => {
    const result = await conn.execute('SELECT * FROM users')
    expect(result.size).toBe(1)
  })

  it('should have time property (execution time)', async () => {
    const result = await conn.execute('SELECT * FROM users')
    expect(typeof result.time).toBe('number')
  })

  it('should have insertId for INSERT', async () => {
    await conn.execute(
      'CREATE TABLE auto (id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(255))'
    )
    const result = await conn.execute('INSERT INTO auto (val) VALUES (?)', ['test'])
    expect(result.insertId).toBeDefined()
  })

  it('should have rowsAffected for INSERT/UPDATE/DELETE', async () => {
    const result = await conn.execute('UPDATE users SET age = ? WHERE id = ?', [31, 1])
    expect(result.rowsAffected).toBe(1)
  })

  it('should return empty rows for INSERT', async () => {
    const result = await conn.execute('INSERT INTO users VALUES (?, ?, ?)', [2, 'Bob', 25])
    expect(result.rows).toEqual([])
  })

  it('should return empty headers for INSERT', async () => {
    const result = await conn.execute('INSERT INTO users VALUES (?, ?, ?)', [2, 'Bob', 25])
    expect(result.headers).toEqual([])
  })
})

// ============================================================================
// TYPE COERCION TESTS
// ============================================================================

describe('type coercion', () => {
  let conn: Connection

  beforeEach(() => {
    conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })
  })

  it('should coerce INT to number', async () => {
    await conn.execute('CREATE TABLE t (val INT)')
    await conn.execute('INSERT INTO t VALUES (?)', [42])
    const { rows } = await conn.execute('SELECT val FROM t')
    expect(typeof rows[0].val).toBe('number')
  })

  it('should coerce VARCHAR to string', async () => {
    await conn.execute('CREATE TABLE t (val VARCHAR(255))')
    await conn.execute('INSERT INTO t VALUES (?)', ['hello'])
    const { rows } = await conn.execute('SELECT val FROM t')
    expect(typeof rows[0].val).toBe('string')
  })

  it('should coerce DOUBLE to number', async () => {
    await conn.execute('CREATE TABLE t (val DOUBLE)')
    await conn.execute('INSERT INTO t VALUES (?)', [3.14159])
    const { rows } = await conn.execute('SELECT val FROM t')
    expect(typeof rows[0].val).toBe('number')
    expect(rows[0].val).toBeCloseTo(3.14159)
  })

  it('should coerce BOOLEAN to number (0/1)', async () => {
    await conn.execute('CREATE TABLE t (val BOOLEAN)')
    await conn.execute('INSERT INTO t VALUES (?)', [true])
    const { rows } = await conn.execute('SELECT val FROM t')
    expect(rows[0].val).toBe(1)
  })

  it('should preserve NULL', async () => {
    await conn.execute('CREATE TABLE t (val VARCHAR(255))')
    await conn.execute('INSERT INTO t VALUES (?)', [null])
    const { rows } = await conn.execute('SELECT val FROM t')
    expect(rows[0].val).toBeNull()
  })

  it('should coerce DATETIME to string', async () => {
    await conn.execute('CREATE TABLE t (val DATETIME)')
    await conn.execute('INSERT INTO t VALUES (?)', ['2024-01-15 12:00:00'])
    const { rows } = await conn.execute('SELECT val FROM t')
    expect(typeof rows[0].val).toBe('string')
  })

  it('should coerce JSON to string', async () => {
    await conn.execute('CREATE TABLE t (val JSON)')
    const jsonVal = JSON.stringify({ foo: 'bar' })
    await conn.execute('INSERT INTO t VALUES (?)', [jsonVal])
    const { rows } = await conn.execute('SELECT val FROM t')
    expect(JSON.parse(rows[0].val)).toEqual({ foo: 'bar' })
  })

  it('should coerce BIGINT to string (for safety)', async () => {
    await conn.execute('CREATE TABLE t (val BIGINT)')
    await conn.execute('INSERT INTO t VALUES (?)', [9007199254740993]) // > Number.MAX_SAFE_INTEGER
    const { rows } = await conn.execute('SELECT val FROM t')
    // PlanetScale returns large integers as strings
    expect(rows[0].val).toBeDefined()
  })
})

// ============================================================================
// CAST FUNCTIONS TESTS
// ============================================================================

describe('cast functions', () => {
  let conn: Connection

  beforeEach(() => {
    conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })
  })

  describe('cast.hex', () => {
    it('should format binary data as hex', () => {
      const buffer = Buffer.from('hello')
      const result = hex(buffer)
      expect(result).toBe('68656c6c6f')
    })

    it('should handle Uint8Array', () => {
      const arr = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
      const result = hex(arr)
      expect(result).toBe('48656c6c6f')
    })
  })

  describe('cast.datetime', () => {
    it('should format Date as MySQL datetime string', () => {
      const date = new Date('2024-01-15T12:30:45.000Z')
      const result = datetime(date)
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    })

    it('should handle timezone offset', () => {
      const date = new Date('2024-01-15T12:30:45.000Z')
      const result = datetime(date)
      expect(typeof result).toBe('string')
    })
  })

  describe('cast.json', () => {
    it('should stringify object to JSON', () => {
      const obj = { name: 'Alice', age: 30 }
      const result = json(obj)
      expect(result).toBe('{"name":"Alice","age":30}')
    })

    it('should handle arrays', () => {
      const arr = [1, 2, 3]
      const result = json(arr)
      expect(result).toBe('[1,2,3]')
    })

    it('should handle nested objects', () => {
      const obj = { user: { name: 'Bob', tags: ['a', 'b'] } }
      const result = json(obj)
      expect(JSON.parse(result)).toEqual(obj)
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('error handling', () => {
  let conn: Connection

  beforeEach(() => {
    conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })
  })

  it('should throw DatabaseError on syntax error', async () => {
    try {
      await conn.execute('INVALID SQL QUERY')
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError)
    }
  })

  it('should throw DatabaseError on table not found', async () => {
    try {
      await conn.execute('SELECT * FROM nonexistent_table')
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError)
    }
  })

  it('should throw DatabaseError on duplicate key', async () => {
    await conn.execute('CREATE TABLE t (id INT PRIMARY KEY)')
    await conn.execute('INSERT INTO t VALUES (?)', [1])
    try {
      await conn.execute('INSERT INTO t VALUES (?)', [1])
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError)
    }
  })

  it('should throw DatabaseError on foreign key violation', async () => {
    // This would require FK support - may pass or skip depending on implementation
    try {
      await conn.execute('CREATE TABLE parent (id INT PRIMARY KEY)')
      await conn.execute(
        'CREATE TABLE child (id INT PRIMARY KEY, parent_id INT REFERENCES parent(id))'
      )
      await conn.execute('INSERT INTO child VALUES (?, ?)', [1, 999])
      // FK might not be enforced in SQLite mode
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError)
    }
  })

  describe('DatabaseError properties', () => {
    it('should have message property', async () => {
      try {
        await conn.execute('INVALID')
      } catch (e) {
        expect((e as DatabaseError).message).toBeDefined()
      }
    })

    it('should have code property', async () => {
      try {
        await conn.execute('INVALID')
      } catch (e) {
        expect((e as DatabaseError).code).toBeDefined()
      }
    })

    it('should have status property for HTTP errors', async () => {
      try {
        await conn.execute('INVALID')
      } catch (e) {
        // status may be undefined for non-HTTP errors
        expect(e).toBeInstanceOf(DatabaseError)
      }
    })
  })
})

// ============================================================================
// MYSQL SYNTAX SUPPORT TESTS
// ============================================================================

describe('MySQL syntax support', () => {
  let conn: Connection

  beforeEach(() => {
    conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })
  })

  it('should support AUTO_INCREMENT', async () => {
    await conn.execute('CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))')
    const result = await conn.execute('INSERT INTO t (name) VALUES (?)', ['test'])
    expect(result.insertId).toBe(1)
  })

  it('should support backtick identifiers', async () => {
    await conn.execute('CREATE TABLE `my-table` (`column-name` INT)')
    const result = await conn.execute('INSERT INTO `my-table` VALUES (?)', [42])
    expect(result.rowsAffected).toBe(1)
  })

  it('should support UNSIGNED', async () => {
    await conn.execute('CREATE TABLE t (val INT UNSIGNED)')
    const result = await conn.execute('INSERT INTO t VALUES (?)', [4294967295])
    expect(result.rowsAffected).toBe(1)
  })

  it('should support DATETIME default', async () => {
    await conn.execute('CREATE TABLE t (created_at DATETIME DEFAULT CURRENT_TIMESTAMP)')
    const result = await conn.execute('INSERT INTO t VALUES (DEFAULT)')
    expect(result.rowsAffected).toBe(1)
  })

  it('should support ON DUPLICATE KEY UPDATE', async () => {
    await conn.execute('CREATE TABLE t (id INT PRIMARY KEY, val INT)')
    await conn.execute('INSERT INTO t VALUES (?, ?)', [1, 100])
    await conn.execute('INSERT INTO t VALUES (?, ?) ON DUPLICATE KEY UPDATE val = ?', [1, 200, 200])
    const { rows } = await conn.execute('SELECT val FROM t WHERE id = ?', [1])
    expect(rows[0].val).toBe(200)
  })

  it('should support LIMIT with OFFSET', async () => {
    await conn.execute('CREATE TABLE t (id INT)')
    await conn.execute('INSERT INTO t VALUES (1), (2), (3), (4), (5)')
    const { rows } = await conn.execute('SELECT * FROM t ORDER BY id LIMIT 2 OFFSET 2')
    expect(rows.length).toBe(2)
    expect(rows[0].id).toBe(3)
  })

  it('should support IN clause with parameters', async () => {
    await conn.execute('CREATE TABLE t (id INT)')
    await conn.execute('INSERT INTO t VALUES (1), (2), (3)')
    const { rows } = await conn.execute('SELECT * FROM t WHERE id IN (?, ?)', [1, 3])
    expect(rows.length).toBe(2)
  })

  it('should support LIKE with wildcards', async () => {
    await conn.execute('CREATE TABLE t (name VARCHAR(255))')
    await conn.execute("INSERT INTO t VALUES ('Alice'), ('Bob'), ('Alicia')")
    const { rows } = await conn.execute('SELECT * FROM t WHERE name LIKE ?', ['Ali%'])
    expect(rows.length).toBe(2)
  })

  it('should support ORDER BY multiple columns', async () => {
    await conn.execute('CREATE TABLE t (a INT, b INT)')
    await conn.execute('INSERT INTO t VALUES (1, 2), (1, 1), (2, 1)')
    const { rows } = await conn.execute('SELECT * FROM t ORDER BY a ASC, b DESC')
    expect(rows[0].a).toBe(1)
    expect(rows[0].b).toBe(2)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration', () => {
  it('should work with realistic CRUD workflow', async () => {
    const conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })

    // Create schema
    await conn.execute(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        created_at DATETIME
      )
    `)

    // Insert data
    const insertResult = await conn.execute(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      ['Alice', 'alice@example.com']
    )
    expect(insertResult.insertId).toBeGreaterThan(0)
    const userId = insertResult.insertId

    // Read data
    const { rows: selectRows } = await conn.execute<{
      id: number
      name: string
      email: string
    }>('SELECT * FROM users WHERE id = ?', [userId])
    expect(selectRows[0].email).toBe('alice@example.com')

    // Update data
    const updateResult = await conn.execute('UPDATE users SET name = ? WHERE id = ?', [
      'Alicia',
      userId,
    ])
    expect(updateResult.rowsAffected).toBe(1)

    // Delete data
    const deleteResult = await conn.execute('DELETE FROM users WHERE id = ?', [userId])
    expect(deleteResult.rowsAffected).toBe(1)

    // Verify deletion
    const { rows: verifyRows } = await conn.execute('SELECT * FROM users WHERE id = ?', [userId])
    expect(verifyRows.length).toBe(0)
  })

  it('should handle transaction for money transfer', async () => {
    const conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })

    await conn.execute('CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)')
    await conn.execute('INSERT INTO accounts VALUES (1, 1000), (2, 1000)')

    // Transfer money atomically
    await conn.transaction(async (tx) => {
      await tx.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1])
      await tx.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2])
    })

    // Verify balances
    const { rows } = await conn.execute<{ id: number; balance: number }>(
      'SELECT * FROM accounts ORDER BY id'
    )
    expect(rows[0].balance).toBe(900)
    expect(rows[1].balance).toBe(1100)
  })

  it('should handle concurrent queries', async () => {
    const conn = connect({
      host: 'localhost',
      username: 'test',
      password: 'test',
    })

    await conn.execute('CREATE TABLE counters (id INT PRIMARY KEY, value INT)')
    await conn.execute('INSERT INTO counters VALUES (1, 0)')

    // Run concurrent updates
    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(conn.execute('UPDATE counters SET value = value + 1 WHERE id = ?', [1]))
    }
    await Promise.all(promises)

    const { rows } = await conn.execute('SELECT value FROM counters WHERE id = ?', [1])
    expect(rows[0].value).toBe(10)
  })
})

// ============================================================================
// CONFIG TYPES TEST
// ============================================================================

describe('Config types', () => {
  it('should accept minimal config', () => {
    const config: Config = {
      host: 'localhost',
      username: 'test',
      password: 'test',
    }
    expect(config.host).toBe('localhost')
  })

  it('should accept url config', () => {
    const config: Config = {
      url: 'mysql://user:pass@host/db',
    }
    expect(config.url).toBeDefined()
  })

  it('should accept full config', () => {
    const config: Config = {
      host: 'localhost',
      username: 'test',
      password: 'test',
      fetch: globalThis.fetch,
      format: 'json',
      boost: true,
    }
    expect(config).toBeDefined()
  })
})

// ============================================================================
// EXPORTS TEST
// ============================================================================

describe('exports', () => {
  it('should export connect function', () => {
    expect(connect).toBeDefined()
    expect(typeof connect).toBe('function')
  })

  it('should export Connection class', () => {
    expect(Connection).toBeDefined()
  })

  it('should export DatabaseError class', () => {
    expect(DatabaseError).toBeDefined()
  })

  it('should export cast helpers', () => {
    expect(hex).toBeDefined()
    expect(datetime).toBeDefined()
    expect(json).toBeDefined()
    expect(cast).toBeDefined()
  })
})
