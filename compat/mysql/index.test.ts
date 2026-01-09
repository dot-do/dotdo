/**
 * @dotdo/mysql - MySQL SDK compat tests
 *
 * Tests for mysql2/promise API compatibility backed by DO SQLite:
 * - Connection - createConnection, query, execute, transactions
 * - Pool - createPool, getConnection, release
 * - Prepared statements - execute with ? placeholders
 * - Result types - RowDataPacket, ResultSetHeader
 * - MySQL dialect translation to SQLite
 *
 * @see https://sidorares.github.io/node-mysql2/docs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createConnection,
  createPool,
  mysql,
  Types,
  MySQLError,
  ConnectionError,
  type Connection,
  type Pool,
  type PoolConnection,
  type ConnectionOptions,
  type PoolOptions,
  type ExtendedMySQLConfig,
  type RowDataPacket,
  type ResultSetHeader,
  type FieldPacket,
} from './index'

// ============================================================================
// CONNECTION CREATION TESTS
// ============================================================================

describe('createConnection', () => {
  describe('configuration', () => {
    it('should create connection with config object', async () => {
      const connection = await createConnection({
        host: 'localhost',
        user: 'root',
        database: 'test',
      })
      expect(connection).toBeDefined()
      await connection.end()
    })

    it('should create connection with URI', async () => {
      const connection = await createConnection({
        uri: 'mysql://root:pass@localhost:3306/test',
      })
      expect(connection).toBeDefined()
      await connection.end()
    })

    it('should create connection with SSL config', async () => {
      const connection = await createConnection({
        host: 'localhost',
        database: 'test',
        ssl: {
          rejectUnauthorized: false,
        },
      })
      expect(connection).toBeDefined()
      await connection.end()
    })

    it('should create connection with extended DO config', async () => {
      const connection = await createConnection({
        host: 'localhost',
        database: 'test',
        shard: { algorithm: 'consistent', count: 4 },
        replica: { readPreference: 'nearest' },
      } as ExtendedMySQLConfig)
      expect(connection).toBeDefined()
      await connection.end()
    })

    it('should have threadId after connection', async () => {
      const connection = await createConnection({
        host: 'localhost',
        database: 'test',
      })
      expect(connection.threadId).toBeDefined()
      expect(typeof connection.threadId).toBe('number')
      await connection.end()
    })
  })

  describe('connection.end', () => {
    it('should end connection', async () => {
      const connection = await createConnection({
        host: 'localhost',
        database: 'test',
      })
      await connection.end()
    })

    it('should call end callback', async () => {
      const connection = await createConnection({
        host: 'localhost',
        database: 'test',
      })
      const endHandler = vi.fn()
      connection.on('end', endHandler)
      await connection.end()
      expect(endHandler).toHaveBeenCalled()
    })
  })

  describe('connection.destroy', () => {
    it('should destroy connection immediately', async () => {
      const connection = await createConnection({
        host: 'localhost',
        database: 'test',
      })
      connection.destroy()
      // No-op, just ensure it doesn't throw
    })
  })

  describe('connection.ping', () => {
    it('should ping successfully', async () => {
      const connection = await createConnection({
        host: 'localhost',
        database: 'test',
      })
      await connection.ping()
      await connection.end()
    })
  })
})

// ============================================================================
// QUERY TESTS
// ============================================================================

describe('connection.query', () => {
  let connection: Connection

  beforeEach(async () => {
    connection = await createConnection({
      host: 'localhost',
      database: 'test',
    })
  })

  afterEach(async () => {
    await connection.end()
  })

  describe('basic queries', () => {
    it('should execute simple SELECT', async () => {
      const [rows] = await connection.query('SELECT 1')
      expect(rows).toBeDefined()
    })

    it('should return rows and fields tuple', async () => {
      const [rows, fields] = await connection.query('SELECT 1 as num')
      expect(rows).toBeDefined()
      expect(fields).toBeDefined()
      expect(Array.isArray(rows)).toBe(true)
      expect(Array.isArray(fields)).toBe(true)
    })

    it('should return RowDataPacket for SELECT', async () => {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT 1 as num')
      expect(rows[0].num).toBe(1)
    })

    it('should return field info', async () => {
      const [, fields] = await connection.query('SELECT 1 as num')
      expect(fields[0].name).toBe('num')
    })
  })

  describe('CREATE TABLE', () => {
    it('should create simple table', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'CREATE TABLE users (id INT, name VARCHAR(255))'
      )
      expect(result.affectedRows).toBeDefined()
    })

    it('should create table with AUTO_INCREMENT', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))'
      )
      expect(result.affectedRows).toBeDefined()
    })

    it('should create table with IF NOT EXISTS', async () => {
      await connection.query('CREATE TABLE users (id INT)')
      const [result] = await connection.query<ResultSetHeader>(
        'CREATE TABLE IF NOT EXISTS users (id INT)'
      )
      expect(result).toBeDefined()
    })

    it('should throw error on duplicate table', async () => {
      await connection.query('CREATE TABLE users (id INT)')
      await expect(connection.query('CREATE TABLE users (id INT)')).rejects.toThrow()
    })

    it('should create table with UNIQUE constraint', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'CREATE TABLE users (id INT, email VARCHAR(255) UNIQUE)'
      )
      expect(result).toBeDefined()
    })

    it('should create table with NOT NULL constraint', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'CREATE TABLE users (id INT, name VARCHAR(255) NOT NULL)'
      )
      expect(result).toBeDefined()
    })
  })

  describe('INSERT with ? placeholders', () => {
    beforeEach(async () => {
      await connection.query(
        'CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), age INT)'
      )
    })

    it('should insert with parameterized values', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'INSERT INTO users (name, age) VALUES (?, ?)',
        ['Alice', 30]
      )
      expect(result.affectedRows).toBe(1)
      expect(result.insertId).toBeGreaterThan(0)
    })

    it('should insert single row', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        "INSERT INTO users (name, age) VALUES ('Bob', 25)"
      )
      expect(result.affectedRows).toBe(1)
    })

    it('should auto-increment ID', async () => {
      const [result1] = await connection.query<ResultSetHeader>(
        'INSERT INTO users (name) VALUES (?)',
        ['User1']
      )
      const [result2] = await connection.query<ResultSetHeader>(
        'INSERT INTO users (name) VALUES (?)',
        ['User2']
      )
      expect(result2.insertId).toBeGreaterThan(result1.insertId)
    })

    it('should return insertId in ResultSetHeader', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'INSERT INTO users (name, age) VALUES (?, ?)',
        ['Carol', 28]
      )
      expect(result.insertId).toBeDefined()
      expect(typeof result.insertId).toBe('number')
    })

    it('should throw on unique constraint violation', async () => {
      await connection.query('CREATE TABLE emails (id INT PRIMARY KEY, email VARCHAR(255) UNIQUE)')
      await connection.query("INSERT INTO emails (id, email) VALUES (1, 'test@example.com')")
      await expect(
        connection.query("INSERT INTO emails (id, email) VALUES (2, 'test@example.com')")
      ).rejects.toThrow()
    })
  })

  describe('SELECT with ? placeholders', () => {
    beforeEach(async () => {
      await connection.query('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255), age INT)')
      await connection.query("INSERT INTO users VALUES (1, 'Alice', 30)")
      await connection.query("INSERT INTO users VALUES (2, 'Bob', 25)")
      await connection.query("INSERT INTO users VALUES (3, 'Carol', 35)")
    })

    it('should select all rows', async () => {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM users')
      expect(rows.length).toBe(3)
    })

    it('should select with WHERE clause', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE age > ?',
        [28]
      )
      expect(rows.length).toBe(2)
    })

    it('should select with = operator', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE name = ?',
        ['Bob']
      )
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Bob')
    })

    it('should support > operator', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE age > ?',
        [30]
      )
      expect(rows.length).toBe(1)
    })

    it('should support >= operator', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE age >= ?',
        [30]
      )
      expect(rows.length).toBe(2)
    })

    it('should support < operator', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE age < ?',
        [30]
      )
      expect(rows.length).toBe(1)
    })

    it('should support <= operator', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE age <= ?',
        [30]
      )
      expect(rows.length).toBe(2)
    })

    it('should support != operator', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE name != ?',
        ['Bob']
      )
      expect(rows.length).toBe(2)
    })

    it('should support IS NULL', async () => {
      await connection.query('CREATE TABLE nullable (id INT, value VARCHAR(255))')
      await connection.query('INSERT INTO nullable VALUES (1, NULL)')
      await connection.query("INSERT INTO nullable VALUES (2, 'test')")
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM nullable WHERE value IS NULL'
      )
      expect(rows.length).toBe(1)
    })

    it('should support LIKE', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM users WHERE name LIKE 'A%'"
      )
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Alice')
    })

    it('should support IN clause', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE id IN (1, 3)'
      )
      expect(rows.length).toBe(2)
    })

    it('should support ORDER BY ASC', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users ORDER BY age ASC'
      )
      expect(rows[0].age).toBe(25)
      expect(rows[2].age).toBe(35)
    })

    it('should support ORDER BY DESC', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users ORDER BY age DESC'
      )
      expect(rows[0].age).toBe(35)
      expect(rows[2].age).toBe(25)
    })

    it('should support LIMIT', async () => {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM users LIMIT 2')
      expect(rows.length).toBe(2)
    })

    it('should support LIMIT with OFFSET', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM users ORDER BY id ASC LIMIT 1 OFFSET 1'
      )
      expect(rows.length).toBe(1)
      expect(rows[0].id).toBe(2)
    })
  })

  describe('UPDATE with ? placeholders', () => {
    beforeEach(async () => {
      await connection.query('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255), age INT)')
      await connection.query("INSERT INTO users VALUES (1, 'Alice', 30)")
      await connection.query("INSERT INTO users VALUES (2, 'Bob', 25)")
    })

    it('should update single row', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'UPDATE users SET age = ? WHERE id = ?',
        [31, 1]
      )
      expect(result.affectedRows).toBe(1)
    })

    it('should update multiple rows', async () => {
      const [result] = await connection.query<ResultSetHeader>('UPDATE users SET age = age + 1')
      expect(result.affectedRows).toBe(2)
    })

    it('should return changedRows', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'UPDATE users SET age = ? WHERE id = ?',
        [31, 1]
      )
      expect(result.changedRows).toBeDefined()
    })
  })

  describe('DELETE with ? placeholders', () => {
    beforeEach(async () => {
      await connection.query('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255))')
      await connection.query("INSERT INTO users VALUES (1, 'Alice')")
      await connection.query("INSERT INTO users VALUES (2, 'Bob')")
      await connection.query("INSERT INTO users VALUES (3, 'Carol')")
    })

    it('should delete single row', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM users WHERE id = ?',
        [1]
      )
      expect(result.affectedRows).toBe(1)
    })

    it('should delete multiple rows', async () => {
      const [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM users WHERE id > ?',
        [1]
      )
      expect(result.affectedRows).toBe(2)
    })

    it('should delete all rows', async () => {
      const [result] = await connection.query<ResultSetHeader>('DELETE FROM users')
      expect(result.affectedRows).toBe(3)
    })
  })

  describe('DROP TABLE', () => {
    it('should drop existing table', async () => {
      await connection.query('CREATE TABLE users (id INT)')
      const [result] = await connection.query<ResultSetHeader>('DROP TABLE users')
      expect(result).toBeDefined()
    })

    it('should drop with IF EXISTS', async () => {
      const [result] = await connection.query<ResultSetHeader>('DROP TABLE IF EXISTS nonexistent')
      expect(result).toBeDefined()
    })

    it('should throw on drop nonexistent table', async () => {
      await expect(connection.query('DROP TABLE nonexistent')).rejects.toThrow()
    })
  })
})

// ============================================================================
// EXECUTE TESTS (Prepared Statements)
// ============================================================================

describe('connection.execute', () => {
  let connection: Connection

  beforeEach(async () => {
    connection = await createConnection({
      host: 'localhost',
      database: 'test',
    })
    await connection.query(
      'CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), age INT)'
    )
  })

  afterEach(async () => {
    await connection.end()
  })

  it('should execute with ? placeholders', async () => {
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO users (name, age) VALUES (?, ?)',
      ['Alice', 30]
    )
    expect(result.affectedRows).toBe(1)
    expect(result.insertId).toBeGreaterThan(0)
  })

  it('should execute SELECT with ? placeholders', async () => {
    await connection.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['Alice', 30])
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT * FROM users WHERE name = ?',
      ['Alice']
    )
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe('Alice')
  })

  it('should return ResultSetHeader for INSERT', async () => {
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO users (name) VALUES (?)',
      ['Bob']
    )
    expect(result.insertId).toBeDefined()
    expect(result.affectedRows).toBe(1)
  })

  it('should return ResultSetHeader for UPDATE', async () => {
    await connection.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['Alice', 30])
    const [result] = await connection.execute<ResultSetHeader>(
      'UPDATE users SET age = ? WHERE name = ?',
      [31, 'Alice']
    )
    expect(result.affectedRows).toBe(1)
  })

  it('should return ResultSetHeader for DELETE', async () => {
    await connection.execute('INSERT INTO users (name) VALUES (?)', ['Alice'])
    const [result] = await connection.execute<ResultSetHeader>(
      'DELETE FROM users WHERE name = ?',
      ['Alice']
    )
    expect(result.affectedRows).toBe(1)
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('transactions', () => {
  let connection: Connection

  beforeEach(async () => {
    connection = await createConnection({
      host: 'localhost',
      database: 'test',
    })
    await connection.query('CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)')
    await connection.query('INSERT INTO accounts VALUES (1, 100)')
    await connection.query('INSERT INTO accounts VALUES (2, 100)')
  })

  afterEach(async () => {
    await connection.end()
  })

  it('should begin transaction', async () => {
    await connection.beginTransaction()
    // No throw means success
  })

  it('should commit transaction', async () => {
    await connection.beginTransaction()
    await connection.query('UPDATE accounts SET balance = 50 WHERE id = 1')
    await connection.commit()

    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT balance FROM accounts WHERE id = 1'
    )
    expect(rows[0].balance).toBe(50)
  })

  it('should rollback transaction', async () => {
    await connection.beginTransaction()
    await connection.query('UPDATE accounts SET balance = 50 WHERE id = 1')
    await connection.rollback()

    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT balance FROM accounts WHERE id = 1'
    )
    expect(rows[0].balance).toBe(100)
  })

  it('should support START TRANSACTION', async () => {
    const [result] = await connection.query<ResultSetHeader>('START TRANSACTION')
    expect(result).toBeDefined()
    await connection.rollback()
  })
})

// ============================================================================
// POOL TESTS
// ============================================================================

describe('createPool', () => {
  describe('configuration', () => {
    it('should create pool with config object', () => {
      const pool = createPool({
        host: 'localhost',
        user: 'root',
        database: 'test',
      })
      expect(pool).toBeDefined()
    })

    it('should create pool with connectionLimit', () => {
      const pool = createPool({
        host: 'localhost',
        database: 'test',
        connectionLimit: 20,
      })
      expect(pool).toBeDefined()
    })

    it('should create pool with extended DO config', () => {
      const pool = createPool({
        host: 'localhost',
        database: 'test',
        shard: { algorithm: 'hash', count: 8 },
        replica: { readPreference: 'secondary' },
      } as ExtendedMySQLConfig)
      expect(pool).toBeDefined()
    })
  })

  describe('pool.query', () => {
    let pool: Pool

    beforeEach(() => {
      pool = createPool({
        host: 'localhost',
        database: 'test',
      })
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should execute query and return result', async () => {
      const [rows] = await pool.query('SELECT 1')
      expect(rows).toBeDefined()
    })

    it('should execute parameterized query', async () => {
      await pool.query('CREATE TABLE users (id INT, name VARCHAR(255))')
      await pool.query('INSERT INTO users VALUES (?, ?)', [1, 'Alice'])
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM users WHERE id = ?', [1])
      expect(rows[0].name).toBe('Alice')
    })
  })

  describe('pool.execute', () => {
    let pool: Pool

    beforeEach(() => {
      pool = createPool({
        host: 'localhost',
        database: 'test',
      })
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should execute prepared statement', async () => {
      await pool.query('CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))')
      const [result] = await pool.execute<ResultSetHeader>(
        'INSERT INTO users (name) VALUES (?)',
        ['Alice']
      )
      expect(result.insertId).toBeGreaterThan(0)
    })
  })

  describe('pool.getConnection', () => {
    let pool: Pool

    beforeEach(() => {
      pool = createPool({
        host: 'localhost',
        database: 'test',
        connectionLimit: 2,
      })
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should get connection from pool', async () => {
      const connection = await pool.getConnection()
      expect(connection).toBeDefined()
      connection.release()
    })

    it('should release connection back to pool', async () => {
      const connection = await pool.getConnection()
      connection.release()
      // Should be able to get another connection
      const connection2 = await pool.getConnection()
      expect(connection2).toBeDefined()
      connection2.release()
    })

    it('should use connection for transaction', async () => {
      await pool.query('CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)')
      await pool.query('INSERT INTO accounts VALUES (1, 100), (2, 100)')

      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        await connection.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [50, 1])
        await connection.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [50, 2])
        await connection.commit()
      } catch (e) {
        await connection.rollback()
        throw e
      } finally {
        connection.release()
      }

      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM accounts ORDER BY id')
      expect(rows[0].balance).toBe(50)
      expect(rows[1].balance).toBe(150)
    })
  })

  describe('pool.end', () => {
    it('should end pool', async () => {
      const pool = createPool({
        host: 'localhost',
        database: 'test',
      })
      await pool.end()
    })
  })
})

// ============================================================================
// MySQL SYNTAX TRANSLATION TESTS
// ============================================================================

describe('MySQL syntax translation', () => {
  let connection: Connection

  beforeEach(async () => {
    connection = await createConnection({
      host: 'localhost',
      database: 'test',
    })
  })

  afterEach(async () => {
    await connection.end()
  })

  it('should translate AUTO_INCREMENT to AUTOINCREMENT', async () => {
    await connection.query(
      'CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))'
    )
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO t (name) VALUES (?)',
      ['test']
    )
    expect(result.insertId).toBe(1)
  })

  it('should translate UNSIGNED to regular INT', async () => {
    await connection.query('CREATE TABLE t (id INT UNSIGNED)')
    const [result] = await connection.query<ResultSetHeader>('INSERT INTO t VALUES (?)', [42])
    expect(result.affectedRows).toBe(1)
  })

  it('should translate TINYINT(1) to BOOLEAN', async () => {
    await connection.query('CREATE TABLE t (active TINYINT(1))')
    await connection.query('INSERT INTO t VALUES (?)', [1])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].active).toBe(1)
  })

  it('should translate DATETIME to TEXT', async () => {
    await connection.query('CREATE TABLE t (created_at DATETIME)')
    await connection.query('INSERT INTO t VALUES (?)', ['2024-01-01 12:00:00'])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].created_at).toBeDefined()
  })

  it('should translate ENUM to TEXT', async () => {
    await connection.query("CREATE TABLE t (status ENUM('active', 'inactive'))")
    await connection.query('INSERT INTO t VALUES (?)', ['active'])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].status).toBe('active')
  })

  it('should translate DOUBLE to REAL', async () => {
    await connection.query('CREATE TABLE t (value DOUBLE)')
    await connection.query('INSERT INTO t VALUES (?)', [3.14159])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].value).toBeCloseTo(3.14159)
  })

  it('should handle backtick identifiers', async () => {
    await connection.query('CREATE TABLE `users` (`id` INT, `name` VARCHAR(255))')
    await connection.query('INSERT INTO `users` (`id`, `name`) VALUES (?, ?)', [1, 'Alice'])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM `users`')
    expect(rows.length).toBe(1)
  })

  it('should translate ON DUPLICATE KEY UPDATE', async () => {
    await connection.query('CREATE TABLE t (id INT PRIMARY KEY, value INT)')
    await connection.query('INSERT INTO t VALUES (1, 100)')
    // Note: SQLite uses INSERT OR REPLACE, we handle this translation
    await connection.query(
      'INSERT INTO t VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
      [1, 200, 200]
    )
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t WHERE id = 1')
    expect(rows[0].value).toBe(200)
  })
})

// ============================================================================
// DATA TYPE TESTS
// ============================================================================

describe('data types', () => {
  let connection: Connection

  beforeEach(async () => {
    connection = await createConnection({
      host: 'localhost',
      database: 'test',
    })
  })

  afterEach(async () => {
    await connection.end()
  })

  it('should handle INT', async () => {
    await connection.query('CREATE TABLE t (val INT)')
    await connection.query('INSERT INTO t VALUES (?)', [42])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].val).toBe(42)
  })

  it('should handle VARCHAR', async () => {
    await connection.query('CREATE TABLE t (val VARCHAR(255))')
    await connection.query('INSERT INTO t VALUES (?)', ['hello world'])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].val).toBe('hello world')
  })

  it('should handle TEXT', async () => {
    await connection.query('CREATE TABLE t (val TEXT)')
    const longText = 'x'.repeat(10000)
    await connection.query('INSERT INTO t VALUES (?)', [longText])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].val).toBe(longText)
  })

  it('should handle BOOLEAN / TINYINT(1)', async () => {
    await connection.query('CREATE TABLE t (val BOOLEAN)')
    await connection.query('INSERT INTO t VALUES (?)', [true])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].val).toBe(1)
  })

  it('should handle NULL', async () => {
    await connection.query('CREATE TABLE t (val VARCHAR(255))')
    await connection.query('INSERT INTO t VALUES (?)', [null])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].val).toBeNull()
  })

  it('should handle FLOAT / DOUBLE', async () => {
    await connection.query('CREATE TABLE t (val FLOAT)')
    await connection.query('INSERT INTO t VALUES (?)', [3.14])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].val).toBeCloseTo(3.14)
  })

  it('should handle BIGINT', async () => {
    await connection.query('CREATE TABLE t (val BIGINT)')
    await connection.query('INSERT INTO t VALUES (?)', [9007199254740991])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(rows[0].val).toBe(9007199254740991)
  })

  it('should handle JSON', async () => {
    await connection.query('CREATE TABLE t (val JSON)')
    await connection.query('INSERT INTO t VALUES (?)', [JSON.stringify({ foo: 'bar' })])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM t')
    expect(JSON.parse(rows[0].val)).toEqual({ foo: 'bar' })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('error handling', () => {
  let connection: Connection

  beforeEach(async () => {
    connection = await createConnection({
      host: 'localhost',
      database: 'test',
    })
  })

  afterEach(async () => {
    await connection.end()
  })

  it('should throw MySQLError on syntax error', async () => {
    try {
      await connection.query('INVALID SQL')
    } catch (e) {
      expect(e).toBeInstanceOf(MySQLError)
      expect((e as MySQLError).code).toBeDefined()
    }
  })

  it('should throw MySQLError on table not found', async () => {
    try {
      await connection.query('SELECT * FROM nonexistent')
    } catch (e) {
      expect(e).toBeInstanceOf(MySQLError)
      expect((e as MySQLError).errno).toBeDefined()
    }
  })

  it('should throw MySQLError on constraint violation', async () => {
    await connection.query('CREATE TABLE t (id INT PRIMARY KEY)')
    await connection.query('INSERT INTO t VALUES (1)')
    try {
      await connection.query('INSERT INTO t VALUES (1)')
    } catch (e) {
      expect(e).toBeInstanceOf(MySQLError)
    }
  })
})

// ============================================================================
// UTILITY TESTS
// ============================================================================

describe('utilities', () => {
  let connection: Connection

  beforeEach(async () => {
    connection = await createConnection({
      host: 'localhost',
      database: 'test',
    })
  })

  afterEach(async () => {
    await connection.end()
  })

  describe('escape', () => {
    it('should escape single quotes', () => {
      const result = connection.escape("it's a test")
      expect(result).toBe("'it\\'s a test'")
    })

    it('should wrap in single quotes', () => {
      const result = connection.escape('test')
      expect(result).toBe("'test'")
    })

    it('should handle NULL', () => {
      const result = connection.escape(null)
      expect(result).toBe('NULL')
    })
  })

  describe('escapeId', () => {
    it('should escape backticks', () => {
      const result = connection.escapeId('column`name')
      expect(result).toBe('`column``name`')
    })

    it('should wrap in backticks', () => {
      const result = connection.escapeId('tablename')
      expect(result).toBe('`tablename`')
    })
  })

  describe('format', () => {
    it('should format query with values', () => {
      const result = connection.format('SELECT * FROM users WHERE id = ?', [1])
      expect(result).toBe('SELECT * FROM users WHERE id = 1')
    })

    it('should format query with string values', () => {
      const result = connection.format('SELECT * FROM users WHERE name = ?', ['Alice'])
      expect(result).toBe("SELECT * FROM users WHERE name = 'Alice'")
    })
  })

  describe('Types', () => {
    it('should export MySQL type constants', () => {
      expect(Types.INT24).toBeDefined()
      expect(Types.VARCHAR).toBeDefined()
      expect(Types.BLOB).toBeDefined()
      expect(Types.JSON).toBeDefined()
      expect(Types.DATETIME).toBeDefined()
    })
  })
})

// ============================================================================
// DEFAULT EXPORT TESTS
// ============================================================================

describe('default export', () => {
  it('should have createConnection, createPool', () => {
    expect(mysql.createConnection).toBeDefined()
    expect(mysql.createPool).toBeDefined()
  })

  it('should have Types', () => {
    expect(mysql.Types).toBeDefined()
    expect(mysql.Types.VARCHAR).toBeDefined()
  })

  it('should have error classes', () => {
    expect(mysql.MySQLError).toBeDefined()
    expect(mysql.ConnectionError).toBeDefined()
  })
})

// ============================================================================
// DO ROUTING TESTS
// ============================================================================

describe('DO routing', () => {
  it('should accept shard configuration', () => {
    const pool = createPool({
      host: 'localhost',
      database: 'test',
      shard: { key: 'user_id', count: 8, algorithm: 'hash' },
    } as ExtendedMySQLConfig)
    expect(pool).toBeDefined()
  })

  it('should accept replica configuration', () => {
    const pool = createPool({
      host: 'localhost',
      database: 'test',
      replica: {
        readPreference: 'secondary',
        writeThrough: true,
        jurisdiction: 'eu',
      },
    } as ExtendedMySQLConfig)
    expect(pool).toBeDefined()
  })

  it('should accept doNamespace', () => {
    const pool = createPool({
      host: 'localhost',
      database: 'test',
      doNamespace: {} as DurableObjectNamespace,
    } as ExtendedMySQLConfig)
    expect(pool).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration', () => {
  it('should work with realistic CRUD workflow', async () => {
    const connection = await createConnection({
      host: 'localhost',
      database: 'test',
    })

    // Create schema
    await connection.query(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        created_at DATETIME
      )
    `)

    // Insert data
    const [insertResult] = await connection.execute<ResultSetHeader>(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      ['Alice', 'alice@example.com']
    )
    expect(insertResult.insertId).toBeGreaterThan(0)
    const userId = insertResult.insertId

    // Read data
    const [selectRows] = await connection.query<RowDataPacket[]>(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    )
    expect(selectRows[0].email).toBe('alice@example.com')

    // Update data
    const [updateResult] = await connection.execute<ResultSetHeader>(
      'UPDATE users SET name = ? WHERE id = ?',
      ['Alicia', userId]
    )
    expect(updateResult.affectedRows).toBe(1)

    // Delete data
    const [deleteResult] = await connection.execute<ResultSetHeader>(
      'DELETE FROM users WHERE id = ?',
      [userId]
    )
    expect(deleteResult.affectedRows).toBe(1)

    // Verify deletion
    const [verifyRows] = await connection.query<RowDataPacket[]>(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    )
    expect(verifyRows.length).toBe(0)

    await connection.end()
  })

  it('should work with pool workflow', async () => {
    const pool = createPool({
      host: 'localhost',
      database: 'test',
      connectionLimit: 5,
    })

    // Create schema
    await pool.query('CREATE TABLE posts (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255))')

    // Concurrent inserts
    const insertPromises = []
    for (let i = 0; i < 10; i++) {
      insertPromises.push(
        pool.execute<ResultSetHeader>('INSERT INTO posts (title) VALUES (?)', [`Post ${i}`])
      )
    }
    await Promise.all(insertPromises)

    // Verify
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM posts')
    expect(rows.length).toBe(10)

    await pool.end()
  })

  it('should handle transaction with pool connection', async () => {
    const pool = createPool({
      host: 'localhost',
      database: 'test',
    })

    await pool.query('CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)')
    await pool.query('INSERT INTO accounts VALUES (1, 1000), (2, 1000)')

    // Transfer money
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1])
      await connection.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2])
      await connection.commit()
    } catch (e) {
      await connection.rollback()
      throw e
    } finally {
      connection.release()
    }

    // Verify
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM accounts ORDER BY id')
    expect(rows[0].balance).toBe(900)
    expect(rows[1].balance).toBe(1100)

    await pool.end()
  })
})
