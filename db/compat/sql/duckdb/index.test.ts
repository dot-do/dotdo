/**
 * @dotdo/duckdb - DuckDB SDK compat tests
 *
 * Tests for duckdb-node API compatibility backed by DO SQLite:
 * - Database - Creation, connection management
 * - run() - DDL/DML operations
 * - all() - SELECT queries returning all rows
 * - each() - Row-by-row iteration
 * - get() - Single row retrieval
 * - Prepared statements - prepare(), bind(), all(), finalize()
 * - Async API - open(), connect()
 * - Aggregate functions - COUNT, SUM, AVG, MIN, MAX
 * - Error handling
 *
 * @see https://duckdb.org/docs/api/nodejs/reference
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Database,
  open,
  Connection,
  Statement,
  DuckDBError,
  type DatabaseConfig,
  type QueryResult,
} from './index'

// ============================================================================
// DATABASE CREATION TESTS
// ============================================================================

describe('Database', () => {
  describe('constructor', () => {
    it('should create in-memory database with :memory:', () => {
      const db = new Database(':memory:')
      expect(db).toBeDefined()
      db.close()
    })

    it('should create in-memory database with empty string', () => {
      const db = new Database('')
      expect(db).toBeDefined()
      db.close()
    })

    it('should create in-memory database with no arguments', () => {
      const db = new Database()
      expect(db).toBeDefined()
      db.close()
    })

    it('should create database with file path', () => {
      const db = new Database('/tmp/test-duckdb.db')
      expect(db).toBeDefined()
      db.close()
    })

    it('should accept configuration object', () => {
      const db = new Database(':memory:', { access_mode: 'read_write' })
      expect(db).toBeDefined()
      db.close()
    })

    it('should accept read-only configuration', () => {
      const db = new Database(':memory:', { access_mode: 'read_only' })
      expect(db).toBeDefined()
      db.close()
    })

    it('should have default properties', () => {
      const db = new Database(':memory:')
      expect(db.path).toBe(':memory:')
      expect(db.open).toBe(true)
      db.close()
    })

    it('should accept callback on creation', async () => {
      await new Promise<void>((resolve) => {
        const db = new Database(':memory:', (err) => {
          expect(err).toBeNull()
          expect(db.open).toBe(true)
          db.close()
          resolve()
        })
      })
    })

    it('should accept config and callback', async () => {
      await new Promise<void>((resolve) => {
        const db = new Database(':memory:', { access_mode: 'read_write' }, (err) => {
          expect(err).toBeNull()
          db.close()
          resolve()
        })
      })
    })
  })

  describe('close', () => {
    it('should close database with promise', async () => {
      const db = new Database(':memory:')
      await db.close()
      expect(db.open).toBe(false)
    })

    it('should close database with callback', async () => {
      const db = new Database(':memory:')
      await new Promise<void>((resolve) => {
        db.close((err) => {
          expect(err).toBeNull()
          expect(db.open).toBe(false)
          resolve()
        })
      })
    })

    it('should be safe to close multiple times', async () => {
      const db = new Database(':memory:')
      await db.close()
      await db.close()
      expect(db.open).toBe(false)
    })
  })
})

// ============================================================================
// RUN() TESTS - DDL/DML OPERATIONS
// ============================================================================

describe('run()', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  describe('CREATE TABLE', () => {
    it('should create simple table', () => {
      const result = db.run('CREATE TABLE users (id INTEGER, name VARCHAR)')
      expect(result).toBeDefined()
    })

    it('should create table with PRIMARY KEY', () => {
      db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR)')
    })

    it('should create table with multiple columns', () => {
      db.run('CREATE TABLE users (id INTEGER, name VARCHAR, email VARCHAR, age INTEGER)')
    })

    it('should create table with NOT NULL constraint', () => {
      db.run('CREATE TABLE users (id INTEGER NOT NULL, name VARCHAR NOT NULL)')
    })

    it('should create table with DEFAULT values', () => {
      db.run("CREATE TABLE users (id INTEGER, status VARCHAR DEFAULT 'active')")
    })

    it('should create table with IF NOT EXISTS', () => {
      db.run('CREATE TABLE users (id INTEGER)')
      db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER)')
    })

    it('should throw on duplicate table without IF NOT EXISTS', () => {
      db.run('CREATE TABLE users (id INTEGER)')
      expect(() => db.run('CREATE TABLE users (id INTEGER)')).toThrow(DuckDBError)
    })

    it('should support SEQUENCE / autoincrement', () => {
      db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR)')
      db.run("INSERT INTO users (id, name) VALUES (1, 'Alice')")
    })
  })

  describe('INSERT', () => {
    beforeEach(() => {
      db.run('CREATE TABLE users (id INTEGER, name VARCHAR, age INTEGER)')
    })

    it('should insert single row with values', () => {
      const result = db.run("INSERT INTO users VALUES (1, 'Alice', 30)")
      expect(result.changes).toBe(1)
    })

    it('should insert with parameterized values', () => {
      const result = db.run('INSERT INTO users VALUES (?, ?, ?)', [1, 'Bob', 25])
      expect(result.changes).toBe(1)
    })

    it('should insert with named columns', () => {
      const result = db.run("INSERT INTO users (id, name) VALUES (1, 'Carol')")
      expect(result.changes).toBe(1)
    })

    it('should insert multiple rows', () => {
      db.run("INSERT INTO users VALUES (1, 'Alice', 30)")
      db.run("INSERT INTO users VALUES (2, 'Bob', 25)")
      db.run("INSERT INTO users VALUES (3, 'Carol', 35)")
      const rows = db.all('SELECT * FROM users')
      expect(rows.length).toBe(3)
    })

    it('should handle NULL values', () => {
      db.run('INSERT INTO users VALUES (1, NULL, NULL)')
      const rows = db.all('SELECT * FROM users WHERE id = 1')
      expect(rows[0].name).toBeNull()
      expect(rows[0].age).toBeNull()
    })

    it('should return lastInsertRowid', () => {
      db.run('CREATE TABLE auto_users (id INTEGER PRIMARY KEY, name VARCHAR)')
      const result = db.run("INSERT INTO auto_users (name) VALUES ('Test')")
      expect(result.lastInsertRowid).toBeDefined()
    })
  })

  describe('UPDATE', () => {
    beforeEach(() => {
      db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR, age INTEGER)')
      db.run("INSERT INTO users VALUES (1, 'Alice', 30)")
      db.run("INSERT INTO users VALUES (2, 'Bob', 25)")
    })

    it('should update single row', () => {
      const result = db.run('UPDATE users SET age = 31 WHERE id = 1')
      expect(result.changes).toBe(1)
    })

    it('should update multiple rows', () => {
      const result = db.run('UPDATE users SET age = age + 1')
      expect(result.changes).toBe(2)
    })

    it('should update with parameterized values', () => {
      const result = db.run('UPDATE users SET name = ?, age = ? WHERE id = ?', ['Alicia', 32, 1])
      expect(result.changes).toBe(1)
    })

    it('should update multiple columns', () => {
      db.run("UPDATE users SET name = 'Alicia', age = 32 WHERE id = 1")
      const rows = db.all('SELECT * FROM users WHERE id = 1')
      expect(rows[0].name).toBe('Alicia')
      expect(rows[0].age).toBe(32)
    })

    it('should return 0 changes when no rows match', () => {
      const result = db.run('UPDATE users SET age = 50 WHERE id = 999')
      expect(result.changes).toBe(0)
    })
  })

  describe('DELETE', () => {
    beforeEach(() => {
      db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR)')
      db.run("INSERT INTO users VALUES (1, 'Alice')")
      db.run("INSERT INTO users VALUES (2, 'Bob')")
      db.run("INSERT INTO users VALUES (3, 'Carol')")
    })

    it('should delete single row', () => {
      const result = db.run('DELETE FROM users WHERE id = 1')
      expect(result.changes).toBe(1)
    })

    it('should delete multiple rows', () => {
      const result = db.run('DELETE FROM users WHERE id > 1')
      expect(result.changes).toBe(2)
    })

    it('should delete with parameterized values', () => {
      const result = db.run('DELETE FROM users WHERE id = ?', [2])
      expect(result.changes).toBe(1)
    })

    it('should delete all rows', () => {
      const result = db.run('DELETE FROM users')
      expect(result.changes).toBe(3)
    })

    it('should return 0 changes when no rows match', () => {
      const result = db.run('DELETE FROM users WHERE id = 999')
      expect(result.changes).toBe(0)
    })
  })

  describe('DROP TABLE', () => {
    it('should drop existing table', () => {
      db.run('CREATE TABLE users (id INTEGER)')
      db.run('DROP TABLE users')
    })

    it('should drop with IF EXISTS', () => {
      db.run('DROP TABLE IF EXISTS nonexistent')
    })

    it('should throw on drop nonexistent table', () => {
      expect(() => db.run('DROP TABLE nonexistent')).toThrow(DuckDBError)
    })
  })
})

// ============================================================================
// ALL() TESTS - SELECT RETURNING ALL ROWS
// ============================================================================

describe('all()', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR, age INTEGER)')
    db.run("INSERT INTO users VALUES (1, 'Alice', 30)")
    db.run("INSERT INTO users VALUES (2, 'Bob', 25)")
    db.run("INSERT INTO users VALUES (3, 'Carol', 35)")
  })

  afterEach(() => {
    db.close()
  })

  it('should return all rows', () => {
    const rows = db.all('SELECT * FROM users')
    expect(rows.length).toBe(3)
  })

  it('should return array of objects', () => {
    const rows = db.all('SELECT * FROM users WHERE id = 1')
    expect(rows[0]).toEqual({ id: 1, name: 'Alice', age: 30 })
  })

  it('should return empty array when no rows', () => {
    const rows = db.all('SELECT * FROM users WHERE id = 999')
    expect(rows).toEqual([])
  })

  it('should support parameterized queries', () => {
    const rows = db.all('SELECT * FROM users WHERE age > ?', [28])
    expect(rows.length).toBe(2)
  })

  it('should support multiple parameters', () => {
    const rows = db.all('SELECT * FROM users WHERE age > ? AND age < ?', [25, 35])
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe('Alice')
  })

  it('should support ORDER BY', () => {
    const rows = db.all('SELECT * FROM users ORDER BY age ASC')
    expect(rows[0].age).toBe(25)
    expect(rows[2].age).toBe(35)
  })

  it('should support LIMIT', () => {
    const rows = db.all('SELECT * FROM users LIMIT 2')
    expect(rows.length).toBe(2)
  })

  it('should support OFFSET', () => {
    const rows = db.all('SELECT * FROM users ORDER BY id OFFSET 1')
    expect(rows.length).toBe(2)
    expect(rows[0].id).toBe(2)
  })

  it('should support callback style', async () => {
    await new Promise<void>((resolve) => {
      db.all('SELECT * FROM users', (err, rows) => {
        expect(err).toBeNull()
        expect(rows!.length).toBe(3)
        resolve()
      })
    })
  })

  it('should support callback with params', async () => {
    await new Promise<void>((resolve) => {
      db.all('SELECT * FROM users WHERE id = ?', [1], (err, rows) => {
        expect(err).toBeNull()
        expect(rows![0].name).toBe('Alice')
        resolve()
      })
    })
  })

  it('should handle complex queries', () => {
    const rows = db.all(`
      SELECT id, name, age
      FROM users
      WHERE age >= 25
      ORDER BY age DESC
      LIMIT 2
    `)
    expect(rows.length).toBe(2)
    expect(rows[0].age).toBe(35)
  })
})

// ============================================================================
// EACH() TESTS - ROW-BY-ROW ITERATION
// ============================================================================

describe('each()', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('CREATE TABLE users (id INTEGER, name VARCHAR)')
    db.run("INSERT INTO users VALUES (1, 'Alice')")
    db.run("INSERT INTO users VALUES (2, 'Bob')")
    db.run("INSERT INTO users VALUES (3, 'Carol')")
  })

  afterEach(() => {
    db.close()
  })

  it('should call callback for each row', () => {
    const callback = vi.fn()
    db.each('SELECT * FROM users', callback)
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('should pass row to callback', () => {
    const rows: any[] = []
    db.each('SELECT * FROM users ORDER BY id', (err, row) => {
      rows.push(row)
    })
    expect(rows[0]).toEqual({ id: 1, name: 'Alice' })
    expect(rows[1]).toEqual({ id: 2, name: 'Bob' })
    expect(rows[2]).toEqual({ id: 3, name: 'Carol' })
  })

  it('should pass null error on success', () => {
    db.each('SELECT * FROM users', (err, row) => {
      expect(err).toBeNull()
    })
  })

  it('should support parameterized queries', () => {
    const callback = vi.fn()
    db.each('SELECT * FROM users WHERE id > ?', [1], callback)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('should call complete callback when done', () => {
    let count = 0
    let completeCalled = false
    let completeRowCount = 0
    db.each(
      'SELECT * FROM users',
      (err, row) => {
        count++
      },
      (err, rowCount) => {
        expect(err).toBeNull()
        completeCalled = true
        completeRowCount = rowCount
      }
    )
    expect(completeCalled).toBe(true)
    expect(completeRowCount).toBe(3)
    expect(count).toBe(3)
  })

  it('should handle empty result set', () => {
    const callback = vi.fn()
    let completeCalled = false
    let completeRowCount = -1
    db.each(
      'SELECT * FROM users WHERE id = 999',
      callback,
      (err, rowCount) => {
        completeCalled = true
        completeRowCount = rowCount
      }
    )
    expect(callback).not.toHaveBeenCalled()
    expect(completeCalled).toBe(true)
    expect(completeRowCount).toBe(0)
  })
})

// ============================================================================
// GET() TESTS - SINGLE ROW RETRIEVAL
// ============================================================================

describe('get()', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR, age INTEGER)')
    db.run("INSERT INTO users VALUES (1, 'Alice', 30)")
    db.run("INSERT INTO users VALUES (2, 'Bob', 25)")
  })

  afterEach(() => {
    db.close()
  })

  it('should return single row', () => {
    const row = db.get('SELECT * FROM users WHERE id = 1')
    expect(row).toEqual({ id: 1, name: 'Alice', age: 30 })
  })

  it('should return first row when multiple match', () => {
    const row = db.get('SELECT * FROM users ORDER BY id')
    expect(row.id).toBe(1)
  })

  it('should return undefined when no match', () => {
    const row = db.get('SELECT * FROM users WHERE id = 999')
    expect(row).toBeUndefined()
  })

  it('should support parameterized queries', () => {
    const row = db.get('SELECT * FROM users WHERE id = ?', [2])
    expect(row.name).toBe('Bob')
  })

  it('should support callback style', async () => {
    await new Promise<void>((resolve) => {
      db.get('SELECT * FROM users WHERE id = 1', (err, row) => {
        expect(err).toBeNull()
        expect(row!.name).toBe('Alice')
        resolve()
      })
    })
  })

  it('should support callback with params', async () => {
    await new Promise<void>((resolve) => {
      db.get('SELECT * FROM users WHERE id = ?', [2], (err, row) => {
        expect(err).toBeNull()
        expect(row!.name).toBe('Bob')
        resolve()
      })
    })
  })
})

// ============================================================================
// PREPARED STATEMENT TESTS
// ============================================================================

describe('Prepared Statements', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR, age INTEGER)')
    db.run("INSERT INTO users VALUES (1, 'Alice', 30)")
    db.run("INSERT INTO users VALUES (2, 'Bob', 25)")
    db.run("INSERT INTO users VALUES (3, 'Carol', 35)")
  })

  afterEach(() => {
    db.close()
  })

  describe('prepare()', () => {
    it('should return Statement object', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      expect(stmt).toBeDefined()
      expect(stmt).toBeInstanceOf(Statement)
      stmt.finalize()
    })

    it('should prepare SELECT statement', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      expect(stmt).toBeDefined()
      stmt.finalize()
    })

    it('should prepare INSERT statement', () => {
      const stmt = db.prepare('INSERT INTO users VALUES (?, ?, ?)')
      expect(stmt).toBeDefined()
      stmt.finalize()
    })

    it('should prepare UPDATE statement', () => {
      const stmt = db.prepare('UPDATE users SET name = ? WHERE id = ?')
      expect(stmt).toBeDefined()
      stmt.finalize()
    })

    it('should prepare DELETE statement', () => {
      const stmt = db.prepare('DELETE FROM users WHERE id = ?')
      expect(stmt).toBeDefined()
      stmt.finalize()
    })
  })

  describe('Statement.all()', () => {
    it('should execute with bound parameters', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      const rows = stmt.all(1)
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Alice')
      stmt.finalize()
    })

    it('should execute with multiple parameters', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE age > ? AND age < ?')
      const rows = stmt.all(25, 35)
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Alice')
      stmt.finalize()
    })

    it('should be reusable with different parameters', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      const rows1 = stmt.all(1)
      const rows2 = stmt.all(2)
      expect(rows1[0].name).toBe('Alice')
      expect(rows2[0].name).toBe('Bob')
      stmt.finalize()
    })
  })

  describe('Statement.get()', () => {
    it('should return single row', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      const row = stmt.get(1)
      expect(row.name).toBe('Alice')
      stmt.finalize()
    })

    it('should return undefined when no match', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      const row = stmt.get(999)
      expect(row).toBeUndefined()
      stmt.finalize()
    })
  })

  describe('Statement.run()', () => {
    it('should execute INSERT', () => {
      const stmt = db.prepare('INSERT INTO users VALUES (?, ?, ?)')
      const result = stmt.run(4, 'Dave', 40)
      expect(result.changes).toBe(1)
      stmt.finalize()
    })

    it('should execute UPDATE', () => {
      const stmt = db.prepare('UPDATE users SET age = ? WHERE id = ?')
      const result = stmt.run(31, 1)
      expect(result.changes).toBe(1)
      stmt.finalize()
    })

    it('should execute DELETE', () => {
      const stmt = db.prepare('DELETE FROM users WHERE id = ?')
      const result = stmt.run(1)
      expect(result.changes).toBe(1)
      stmt.finalize()
    })
  })

  describe('Statement.bind()', () => {
    it('should bind parameters', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      stmt.bind(1)
      const rows = stmt.all()
      expect(rows[0].name).toBe('Alice')
      stmt.finalize()
    })

    it('should return statement for chaining', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      const result = stmt.bind(1)
      expect(result).toBe(stmt)
      stmt.finalize()
    })

    it('should allow rebinding', () => {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
      stmt.bind(1)
      const rows1 = stmt.all()
      stmt.bind(2)
      const rows2 = stmt.all()
      expect(rows1[0].name).toBe('Alice')
      expect(rows2[0].name).toBe('Bob')
      stmt.finalize()
    })
  })

  describe('Statement.finalize()', () => {
    it('should finalize statement', () => {
      const stmt = db.prepare('SELECT * FROM users')
      stmt.finalize()
    })

    it('should be safe to finalize multiple times', () => {
      const stmt = db.prepare('SELECT * FROM users')
      stmt.finalize()
      stmt.finalize()
    })

    it('should support callback', () => {
      const stmt = db.prepare('SELECT * FROM users')
      let callbackCalled = false
      stmt.finalize((err) => {
        expect(err).toBeNull()
        callbackCalled = true
      })
      expect(callbackCalled).toBe(true)
    })
  })
})

// ============================================================================
// ASYNC API TESTS
// ============================================================================

describe('Async API', () => {
  describe('open()', () => {
    it('should open in-memory database', async () => {
      const db = await open(':memory:')
      expect(db).toBeDefined()
      expect(db.open).toBe(true)
      await db.close()
    })

    it('should open with config', async () => {
      const db = await open(':memory:', { access_mode: 'read_write' })
      expect(db).toBeDefined()
      await db.close()
    })
  })

  describe('connect()', () => {
    it('should return connection', async () => {
      const db = await open(':memory:')
      const conn = await db.connect()
      expect(conn).toBeDefined()
      expect(conn).toBeInstanceOf(Connection)
      await db.close()
    })

    it('should allow multiple connections', async () => {
      const db = await open(':memory:')
      const conn1 = await db.connect()
      const conn2 = await db.connect()
      expect(conn1).toBeDefined()
      expect(conn2).toBeDefined()
      await db.close()
    })
  })

  describe('Connection.all()', () => {
    it('should execute query async', async () => {
      const db = await open(':memory:')
      const conn = await db.connect()
      await conn.run('CREATE TABLE users (id INTEGER, name VARCHAR)')
      await conn.run("INSERT INTO users VALUES (1, 'Alice')")
      const rows = await conn.all('SELECT * FROM users')
      expect(rows.length).toBe(1)
      expect(rows[0].name).toBe('Alice')
      await db.close()
    })

    it('should support parameterized queries', async () => {
      const db = await open(':memory:')
      const conn = await db.connect()
      await conn.run('CREATE TABLE users (id INTEGER, name VARCHAR)')
      await conn.run('INSERT INTO users VALUES (?, ?)', [1, 'Bob'])
      const rows = await conn.all('SELECT * FROM users WHERE id = ?', [1])
      expect(rows[0].name).toBe('Bob')
      await db.close()
    })
  })

  describe('Connection.run()', () => {
    it('should execute DDL async', async () => {
      const db = await open(':memory:')
      const conn = await db.connect()
      const result = await conn.run('CREATE TABLE users (id INTEGER)')
      expect(result).toBeDefined()
      await db.close()
    })

    it('should execute DML async', async () => {
      const db = await open(':memory:')
      const conn = await db.connect()
      await conn.run('CREATE TABLE users (id INTEGER, name VARCHAR)')
      const result = await conn.run('INSERT INTO users VALUES (?, ?)', [1, 'Carol'])
      expect(result.changes).toBe(1)
      await db.close()
    })
  })
})

// ============================================================================
// AGGREGATE FUNCTION TESTS
// ============================================================================

describe('Aggregate Functions', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('CREATE TABLE numbers (value INTEGER)')
    db.run('INSERT INTO numbers VALUES (10)')
    db.run('INSERT INTO numbers VALUES (20)')
    db.run('INSERT INTO numbers VALUES (30)')
    db.run('INSERT INTO numbers VALUES (40)')
    db.run('INSERT INTO numbers VALUES (50)')
  })

  afterEach(() => {
    db.close()
  })

  it('should support COUNT(*)', () => {
    const row = db.get('SELECT COUNT(*) as cnt FROM numbers')
    expect(row.cnt).toBe(5)
  })

  it('should support COUNT(column)', () => {
    db.run('INSERT INTO numbers VALUES (NULL)')
    const row = db.get('SELECT COUNT(value) as cnt FROM numbers')
    expect(row.cnt).toBe(5) // NULL not counted
  })

  it('should support SUM()', () => {
    const row = db.get('SELECT SUM(value) as total FROM numbers')
    expect(row.total).toBe(150)
  })

  it('should support AVG()', () => {
    const row = db.get('SELECT AVG(value) as avg FROM numbers')
    expect(row.avg).toBe(30)
  })

  it('should support MIN()', () => {
    const row = db.get('SELECT MIN(value) as min FROM numbers')
    expect(row.min).toBe(10)
  })

  it('should support MAX()', () => {
    const row = db.get('SELECT MAX(value) as max FROM numbers')
    expect(row.max).toBe(50)
  })

  it('should support GROUP BY', () => {
    db.run('CREATE TABLE items (category VARCHAR, price INTEGER)')
    db.run("INSERT INTO items VALUES ('A', 100)")
    db.run("INSERT INTO items VALUES ('A', 200)")
    db.run("INSERT INTO items VALUES ('B', 150)")
    const rows = db.all('SELECT category, SUM(price) as total FROM items GROUP BY category ORDER BY category')
    expect(rows.length).toBe(2)
    expect(rows[0].category).toBe('A')
    expect(rows[0].total).toBe(300)
    expect(rows[1].category).toBe('B')
    expect(rows[1].total).toBe(150)
  })

  it('should support HAVING', () => {
    db.run('CREATE TABLE items (category VARCHAR, price INTEGER)')
    db.run("INSERT INTO items VALUES ('A', 100)")
    db.run("INSERT INTO items VALUES ('A', 200)")
    db.run("INSERT INTO items VALUES ('B', 50)")
    const rows = db.all(
      'SELECT category, SUM(price) as total FROM items GROUP BY category HAVING SUM(price) > 100'
    )
    expect(rows.length).toBe(1)
    expect(rows[0].category).toBe('A')
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('should throw DuckDBError on syntax error', () => {
    expect(() => db.run('INVALID SQL')).toThrow(DuckDBError)
  })

  it('should throw DuckDBError on table not found', () => {
    expect(() => db.all('SELECT * FROM nonexistent')).toThrow(DuckDBError)
  })

  it('should throw DuckDBError on column not found', () => {
    db.run('CREATE TABLE users (id INTEGER)')
    expect(() => db.all('SELECT nonexistent FROM users')).toThrow(DuckDBError)
  })

  it('should pass error to callback', async () => {
    await new Promise<void>((resolve) => {
      db.all('SELECT * FROM nonexistent', (err, rows) => {
        expect(err).toBeInstanceOf(DuckDBError)
        resolve()
      })
    })
  })

  it('should include error message', () => {
    try {
      db.run('INVALID SQL')
    } catch (e) {
      expect((e as DuckDBError).message).toBeDefined()
      expect((e as DuckDBError).message.length).toBeGreaterThan(0)
    }
  })

  it('should throw on operations after close', async () => {
    await db.close()
    expect(() => db.run('SELECT 1')).toThrow(DuckDBError)
  })
})

// ============================================================================
// DATA TYPE TESTS
// ============================================================================

describe('Data Types', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('should handle INTEGER', () => {
    db.run('CREATE TABLE t (val INTEGER)')
    db.run('INSERT INTO t VALUES (?)', [42])
    const row = db.get('SELECT * FROM t')
    expect(row.val).toBe(42)
  })

  it('should handle BIGINT', () => {
    db.run('CREATE TABLE t (val BIGINT)')
    db.run('INSERT INTO t VALUES (?)', [9007199254740991])
    const row = db.get('SELECT * FROM t')
    expect(row.val).toBe(9007199254740991)
  })

  it('should handle VARCHAR', () => {
    db.run('CREATE TABLE t (val VARCHAR)')
    db.run('INSERT INTO t VALUES (?)', ['hello world'])
    const row = db.get('SELECT * FROM t')
    expect(row.val).toBe('hello world')
  })

  it('should handle BOOLEAN', () => {
    db.run('CREATE TABLE t (val BOOLEAN)')
    db.run('INSERT INTO t VALUES (?)', [true])
    const row = db.get('SELECT * FROM t')
    expect(row.val).toBe(true)
  })

  it('should handle DOUBLE', () => {
    db.run('CREATE TABLE t (val DOUBLE)')
    db.run('INSERT INTO t VALUES (?)', [3.14159])
    const row = db.get('SELECT * FROM t')
    expect(row.val).toBeCloseTo(3.14159)
  })

  it('should handle NULL', () => {
    db.run('CREATE TABLE t (val VARCHAR)')
    db.run('INSERT INTO t VALUES (?)', [null])
    const row = db.get('SELECT * FROM t')
    expect(row.val).toBeNull()
  })

  it('should handle DATE', () => {
    db.run('CREATE TABLE t (val DATE)')
    db.run("INSERT INTO t VALUES ('2024-01-15')")
    const row = db.get('SELECT * FROM t')
    expect(row.val).toBeDefined()
  })

  it('should handle TIMESTAMP', () => {
    db.run('CREATE TABLE t (val TIMESTAMP)')
    db.run("INSERT INTO t VALUES ('2024-01-15 10:30:00')")
    const row = db.get('SELECT * FROM t')
    expect(row.val).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  it('should handle complete CRUD workflow', () => {
    const db = new Database(':memory:')

    // Create
    db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR, email VARCHAR)')

    // Insert
    db.run("INSERT INTO users VALUES (1, 'Alice', 'alice@example.com.ai')")
    db.run('INSERT INTO users VALUES (?, ?, ?)', [2, 'Bob', 'bob@example.com.ai'])

    // Read
    const users = db.all('SELECT * FROM users ORDER BY id')
    expect(users.length).toBe(2)

    // Update
    db.run('UPDATE users SET email = ? WHERE id = ?', ['alice@new.com', 1])
    const alice = db.get('SELECT * FROM users WHERE id = 1')
    expect(alice.email).toBe('alice@new.com')

    // Delete
    db.run('DELETE FROM users WHERE id = 2')
    const remaining = db.all('SELECT * FROM users')
    expect(remaining.length).toBe(1)

    db.close()
  })

  it('should handle prepared statements workflow', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE logs (id INTEGER, message VARCHAR, level VARCHAR)')

    const insertStmt = db.prepare('INSERT INTO logs VALUES (?, ?, ?)')
    insertStmt.run(1, 'Starting up', 'INFO')
    insertStmt.run(2, 'Warning!', 'WARN')
    insertStmt.run(3, 'Error occurred', 'ERROR')
    insertStmt.finalize()

    const selectStmt = db.prepare('SELECT * FROM logs WHERE level = ?')
    const warnings = selectStmt.all('WARN')
    const errors = selectStmt.all('ERROR')
    expect(warnings.length).toBe(1)
    expect(errors.length).toBe(1)
    selectStmt.finalize()

    db.close()
  })

  it('should handle async workflow', async () => {
    const db = await open(':memory:')
    const conn = await db.connect()

    await conn.run('CREATE TABLE tasks (id INTEGER, title VARCHAR, done BOOLEAN)')
    await conn.run('INSERT INTO tasks VALUES (?, ?, ?)', [1, 'Buy groceries', false])
    await conn.run('INSERT INTO tasks VALUES (?, ?, ?)', [2, 'Walk dog', true])

    const pending = await conn.all('SELECT * FROM tasks WHERE done = false')
    expect(pending.length).toBe(1)
    expect(pending[0].title).toBe('Buy groceries')

    await db.close()
  })

  it('should handle complex analytical query', () => {
    const db = new Database(':memory:')

    db.run('CREATE TABLE sales (product VARCHAR, region VARCHAR, amount DOUBLE)')
    db.run("INSERT INTO sales VALUES ('Widget', 'North', 100.50)")
    db.run("INSERT INTO sales VALUES ('Widget', 'South', 200.75)")
    db.run("INSERT INTO sales VALUES ('Gadget', 'North', 150.00)")
    db.run("INSERT INTO sales VALUES ('Gadget', 'South', 175.25)")

    const results = db.all(`
      SELECT
        product,
        SUM(amount) as total,
        AVG(amount) as average,
        COUNT(*) as count
      FROM sales
      GROUP BY product
      ORDER BY total DESC
    `)

    expect(results.length).toBe(2)
    // Gadget (325.25) > Widget (301.25) so Gadget comes first with DESC
    expect(results[0].product).toBe('Gadget')
    expect(results[0].total).toBeCloseTo(325.25)
    expect(results[1].product).toBe('Widget')
    expect(results[1].total).toBeCloseTo(301.25)

    db.close()
  })
})
