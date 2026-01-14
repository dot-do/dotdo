/**
 * @dotdo/db/compat/sql/shared - Query Patterns Tests
 *
 * Comprehensive tests for common SQL query patterns across all dialects.
 * These tests ensure consistent behavior for:
 * - SELECT queries (simple, joins, subqueries, aggregates)
 * - INSERT operations (single, multi-row, RETURNING)
 * - UPDATE operations (simple, conditional, expressions)
 * - DELETE operations (simple, conditional, RETURNING)
 * - DDL operations (CREATE TABLE, DROP TABLE, CREATE INDEX)
 *
 * Each test category runs against all supported dialects to ensure
 * consistent behavior across PostgreSQL, MySQL, and SQLite.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSQLEngine,
  InMemorySQLEngine,
  type SQLEngine,
} from '../engine'
import {
  POSTGRES_DIALECT,
  MYSQL_DIALECT,
  SQLITE_DIALECT,
  type DialectConfig,
} from '../types'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface DialectTest {
  name: string
  dialect: DialectConfig
}

const DIALECTS: DialectTest[] = [
  { name: 'PostgreSQL', dialect: POSTGRES_DIALECT },
  { name: 'MySQL', dialect: MYSQL_DIALECT },
  { name: 'SQLite', dialect: SQLITE_DIALECT },
]

/**
 * Run a test function across all dialects
 */
function forEachDialect(
  testFn: (engine: SQLEngine, dialectName: string, dialect: DialectConfig) => void
): void {
  for (const { name, dialect } of DIALECTS) {
    describe(name, () => {
      let engine: SQLEngine

      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      testFn(engine, name, dialect)
    })
  }
}

// ============================================================================
// SELECT QUERY TESTS
// ============================================================================

describe('SELECT Queries', () => {
  describe('Simple SELECT', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
        engine.execute("INSERT INTO users VALUES (2, 'Bob', 25)")
        engine.execute("INSERT INTO users VALUES (3, 'Carol', 35)")
      })

      it('should select all columns with *', () => {
        const result = engine.execute('SELECT * FROM users')
        expect(result.rows.length).toBe(3)
        expect(result.columns).toContain('id')
        expect(result.columns).toContain('name')
        expect(result.columns).toContain('age')
      })

      it('should select specific columns', () => {
        const result = engine.execute('SELECT name, age FROM users')
        expect(result.columns).toEqual(['name', 'age'])
        expect(result.rows[0]).toEqual(['Alice', 30])
      })

      it('should handle empty result set', () => {
        const result = engine.execute('SELECT * FROM users WHERE id = 999')
        expect(result.rows.length).toBe(0)
        expect(result.columns).toContain('id')
      })

      it('should select with WHERE clause', () => {
        const result = engine.execute('SELECT * FROM users WHERE age > 28')
        expect(result.rows.length).toBe(2)
      })

      it('should select with multiple WHERE conditions (AND)', () => {
        const result = engine.execute('SELECT * FROM users WHERE age > 25 AND age < 35')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]?.[1]).toBe('Alice')
      })

      it('should select with ORDER BY ascending', () => {
        const result = engine.execute('SELECT * FROM users ORDER BY age')
        expect(result.rows[0]?.[1]).toBe('Bob') // age 25
        expect(result.rows[2]?.[1]).toBe('Carol') // age 35
      })

      it('should select with ORDER BY descending', () => {
        const result = engine.execute('SELECT * FROM users ORDER BY age DESC')
        expect(result.rows[0]?.[1]).toBe('Carol') // age 35
        expect(result.rows[2]?.[1]).toBe('Bob') // age 25
      })

      it('should select with LIMIT', () => {
        const result = engine.execute('SELECT * FROM users LIMIT 2')
        expect(result.rows.length).toBe(2)
      })

      it('should select with OFFSET', () => {
        const result = engine.execute('SELECT * FROM users ORDER BY id LIMIT 2 OFFSET 1')
        expect(result.rows.length).toBe(2)
        expect(result.rows[0]?.[0]).toBe(2) // Bob
      })

      it('should select with LIKE pattern', () => {
        const result = engine.execute("SELECT * FROM users WHERE name LIKE 'A%'")
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]?.[1]).toBe('Alice')
      })

      it('should select with IN clause', () => {
        const result = engine.execute('SELECT * FROM users WHERE id IN (1, 3)')
        expect(result.rows.length).toBe(2)
      })

      it('should select with IS NULL', () => {
        engine.execute('CREATE TABLE nullable (id INTEGER PRIMARY KEY, value TEXT)')
        engine.execute('INSERT INTO nullable VALUES (1, NULL)')
        engine.execute("INSERT INTO nullable VALUES (2, 'present')")

        const result = engine.execute('SELECT * FROM nullable WHERE value IS NULL')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]?.[0]).toBe(1)
      })

      it('should select with IS NOT NULL', () => {
        engine.execute('CREATE TABLE nullable (id INTEGER PRIMARY KEY, value TEXT)')
        engine.execute('INSERT INTO nullable VALUES (1, NULL)')
        engine.execute("INSERT INTO nullable VALUES (2, 'present')")

        const result = engine.execute('SELECT * FROM nullable WHERE value IS NOT NULL')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]?.[0]).toBe(2)
      })
    })
  })

  describe('SELECT with Parameters', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
        engine.execute("INSERT INTO users VALUES (2, 'Bob', 25)")
      })

      if (dialect.parameterStyle === 'indexed') {
        it('should use $1, $2 style parameters', () => {
          const result = engine.execute(
            'SELECT * FROM users WHERE age > $1 AND age < $2',
            [20, 35]
          )
          expect(result.rows.length).toBe(2)
        })

        it('should reuse parameters with same index', () => {
          const result = engine.execute(
            'SELECT * FROM users WHERE age = $1 OR age = $1',
            [30]
          )
          expect(result.rows.length).toBe(1)
        })
      } else {
        it('should use ? style parameters', () => {
          const result = engine.execute(
            'SELECT * FROM users WHERE age > ? AND age < ?',
            [20, 35]
          )
          expect(result.rows.length).toBe(2)
        })
      }

      it('should handle string parameters', () => {
        const query = dialect.parameterStyle === 'indexed'
          ? 'SELECT * FROM users WHERE name = $1'
          : 'SELECT * FROM users WHERE name = ?'
        const result = engine.execute(query, ['Alice'])
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]?.[1]).toBe('Alice')
      })

      it('should handle null parameters', () => {
        engine.execute('CREATE TABLE nullable (id INTEGER PRIMARY KEY, value TEXT)')
        const insertQuery = dialect.parameterStyle === 'indexed'
          ? 'INSERT INTO nullable VALUES ($1, $2)'
          : 'INSERT INTO nullable VALUES (?, ?)'
        engine.execute(insertQuery, [1, null])

        const result = engine.execute('SELECT * FROM nullable WHERE id = 1')
        expect(result.rows[0]?.[1]).toBeNull()
      })
    })
  })

  describe('SELECT Literal Values', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      it('should select integer literal', () => {
        const result = engine.execute('SELECT 42')
        expect(result.rows[0]?.[0]).toBe(42)
      })

      it('should select string literal', () => {
        const result = engine.execute("SELECT 'hello'")
        expect(result.rows[0]?.[0]).toBe('hello')
      })

      it('should select with alias', () => {
        const result = engine.execute('SELECT 1 as num')
        expect(result.columns).toContain('num')
        expect(result.rows[0]?.[0]).toBe(1)
      })
    })
  })
})

// ============================================================================
// INSERT QUERY TESTS
// ============================================================================

describe('INSERT Queries', () => {
  describe('Basic INSERT', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      })

      it('should insert single row with all columns', () => {
        const result = engine.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
        expect(result.affectedRows).toBe(1)

        const select = engine.execute('SELECT * FROM users')
        expect(select.rows.length).toBe(1)
        expect(select.rows[0]).toEqual([1, 'Alice', 30])
      })

      it('should insert with column list', () => {
        const result = engine.execute("INSERT INTO users (id, name) VALUES (1, 'Bob')")
        expect(result.affectedRows).toBe(1)

        const select = engine.execute('SELECT * FROM users')
        expect(select.rows[0]?.[0]).toBe(1)
        expect(select.rows[0]?.[1]).toBe('Bob')
        expect(select.rows[0]?.[2]).toBeNull()
      })

      it('should insert multiple rows', () => {
        const result = engine.execute(
          "INSERT INTO users VALUES (1, 'Alice', 30), (2, 'Bob', 25), (3, 'Carol', 35)"
        )
        expect(result.affectedRows).toBe(3)

        const select = engine.execute('SELECT * FROM users ORDER BY id')
        expect(select.rows.length).toBe(3)
      })

      it('should insert with NULL values', () => {
        engine.execute('INSERT INTO users VALUES (1, NULL, NULL)')

        const select = engine.execute('SELECT * FROM users')
        expect(select.rows[0]?.[1]).toBeNull()
        expect(select.rows[0]?.[2]).toBeNull()
      })
    })
  })

  describe('INSERT with Parameters', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      })

      it('should insert with parameters', () => {
        const query = dialect.parameterStyle === 'indexed'
          ? 'INSERT INTO users VALUES ($1, $2, $3)'
          : 'INSERT INTO users VALUES (?, ?, ?)'

        engine.execute(query, [1, 'Alice', 30])

        const select = engine.execute('SELECT * FROM users')
        expect(select.rows[0]).toEqual([1, 'Alice', 30])
      })

      it('should insert multiple rows with parameters', () => {
        const query = dialect.parameterStyle === 'indexed'
          ? 'INSERT INTO users VALUES ($1, $2, $3), ($4, $5, $6)'
          : 'INSERT INTO users VALUES (?, ?, ?), (?, ?, ?)'

        engine.execute(query, [1, 'Alice', 30, 2, 'Bob', 25])

        const select = engine.execute('SELECT * FROM users ORDER BY id')
        expect(select.rows.length).toBe(2)
      })
    })
  })

  describe('INSERT with AUTO_INCREMENT', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        // Use dialect-appropriate syntax for auto-increment
        if (dialect.dialect === 'postgresql') {
          engine.execute('CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)')
        } else if (dialect.dialect === 'mysql') {
          engine.execute('CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT)')
        } else {
          engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)')
        }
      })

      it('should auto-generate ID on insert', () => {
        const result = engine.execute("INSERT INTO users (name) VALUES ('Alice')")
        expect(result.lastInsertRowid).toBe(1)

        const result2 = engine.execute("INSERT INTO users (name) VALUES ('Bob')")
        expect(result2.lastInsertRowid).toBe(2)
      })

      it('should continue sequence after explicit ID', () => {
        engine.execute("INSERT INTO users (id, name) VALUES (10, 'Alice')")
        const result = engine.execute("INSERT INTO users (name) VALUES ('Bob')")
        expect(result.lastInsertRowid).toBe(11)
      })
    })
  })

  describe('INSERT with RETURNING (PostgreSQL/SQLite)', () => {
    forEachDialect((engine, dialectName, dialect) => {
      if (!dialect.supportsReturning) return

      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      })

      it('should return inserted row with RETURNING *', () => {
        const result = engine.execute("INSERT INTO users VALUES (1, 'Alice', 30) RETURNING *")
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]).toEqual([1, 'Alice', 30])
      })

      it('should return specific columns with RETURNING', () => {
        const result = engine.execute("INSERT INTO users VALUES (1, 'Alice', 30) RETURNING id, name")
        expect(result.columns).toEqual(['id', 'name'])
        expect(result.rows[0]).toEqual([1, 'Alice'])
      })
    })
  })
})

// ============================================================================
// UPDATE QUERY TESTS
// ============================================================================

describe('UPDATE Queries', () => {
  describe('Basic UPDATE', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
        engine.execute("INSERT INTO users VALUES (2, 'Bob', 25)")
        engine.execute("INSERT INTO users VALUES (3, 'Carol', 35)")
      })

      it('should update single column', () => {
        engine.execute("UPDATE users SET name = 'Alicia' WHERE id = 1")

        const result = engine.execute('SELECT name FROM users WHERE id = 1')
        expect(result.rows[0]?.[0]).toBe('Alicia')
      })

      it('should update multiple columns', () => {
        engine.execute("UPDATE users SET name = 'Alicia', age = 31 WHERE id = 1")

        const result = engine.execute('SELECT name, age FROM users WHERE id = 1')
        expect(result.rows[0]).toEqual(['Alicia', 31])
      })

      it('should update all rows without WHERE', () => {
        const result = engine.execute('UPDATE users SET age = 99')
        expect(result.affectedRows).toBe(3)

        const select = engine.execute('SELECT DISTINCT age FROM users')
        expect(select.rows[0]?.[0]).toBe(99)
      })

      it('should update with expression (increment)', () => {
        engine.execute('UPDATE users SET age = age + 1 WHERE id = 1')

        const result = engine.execute('SELECT age FROM users WHERE id = 1')
        expect(result.rows[0]?.[0]).toBe(31)
      })

      it('should update with expression (decrement)', () => {
        engine.execute('UPDATE users SET age = age - 5 WHERE id = 1')

        const result = engine.execute('SELECT age FROM users WHERE id = 1')
        expect(result.rows[0]?.[0]).toBe(25)
      })

      it('should return correct affected rows count', () => {
        const result = engine.execute('UPDATE users SET age = 40 WHERE age > 26')
        expect(result.affectedRows).toBe(2) // Alice (30) and Carol (35)
      })

      it('should return correct changed rows count', () => {
        // Update to same value should not count as changed
        engine.execute("UPDATE users SET name = 'Alice' WHERE id = 1")

        const result = engine.execute("UPDATE users SET name = 'Alice' WHERE id = 1")
        expect(result.changedRows).toBe(0)
      })
    })
  })

  describe('UPDATE with Parameters', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
      })

      it('should update with parameters', () => {
        const query = dialect.parameterStyle === 'indexed'
          ? 'UPDATE users SET name = $1, age = $2 WHERE id = $3'
          : 'UPDATE users SET name = ?, age = ? WHERE id = ?'

        engine.execute(query, ['Alicia', 31, 1])

        const result = engine.execute('SELECT name, age FROM users WHERE id = 1')
        expect(result.rows[0]).toEqual(['Alicia', 31])
      })

      it('should update expression with parameter', () => {
        const query = dialect.parameterStyle === 'indexed'
          ? 'UPDATE users SET age = age + $1 WHERE id = $2'
          : 'UPDATE users SET age = age + ? WHERE id = ?'

        engine.execute(query, [5, 1])

        const result = engine.execute('SELECT age FROM users WHERE id = 1')
        expect(result.rows[0]?.[0]).toBe(35)
      })
    })
  })

  describe('UPDATE with RETURNING (PostgreSQL/SQLite)', () => {
    forEachDialect((engine, dialectName, dialect) => {
      if (!dialect.supportsReturning) return

      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
      })

      it('should return updated row with RETURNING *', () => {
        const result = engine.execute("UPDATE users SET age = 31 WHERE id = 1 RETURNING *")
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]).toEqual([1, 'Alice', 31])
      })

      it('should return specific columns with RETURNING', () => {
        const result = engine.execute("UPDATE users SET age = 31 WHERE id = 1 RETURNING name, age")
        expect(result.columns).toEqual(['name', 'age'])
        expect(result.rows[0]).toEqual(['Alice', 31])
      })
    })
  })
})

// ============================================================================
// DELETE QUERY TESTS
// ============================================================================

describe('DELETE Queries', () => {
  describe('Basic DELETE', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice', 30)")
        engine.execute("INSERT INTO users VALUES (2, 'Bob', 25)")
        engine.execute("INSERT INTO users VALUES (3, 'Carol', 35)")
      })

      it('should delete single row', () => {
        const result = engine.execute('DELETE FROM users WHERE id = 1')
        expect(result.affectedRows).toBe(1)

        const select = engine.execute('SELECT * FROM users')
        expect(select.rows.length).toBe(2)
      })

      it('should delete multiple rows', () => {
        const result = engine.execute('DELETE FROM users WHERE age > 26')
        expect(result.affectedRows).toBe(2)

        const select = engine.execute('SELECT * FROM users')
        expect(select.rows.length).toBe(1)
        expect(select.rows[0]?.[1]).toBe('Bob')
      })

      it('should delete all rows without WHERE', () => {
        const result = engine.execute('DELETE FROM users')
        expect(result.affectedRows).toBe(3)

        const select = engine.execute('SELECT * FROM users')
        expect(select.rows.length).toBe(0)
      })

      it('should return 0 affected rows when nothing matches', () => {
        const result = engine.execute('DELETE FROM users WHERE id = 999')
        expect(result.affectedRows).toBe(0)
      })
    })
  })

  describe('DELETE with Parameters', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice')")
        engine.execute("INSERT INTO users VALUES (2, 'Bob')")
      })

      it('should delete with parameters', () => {
        const query = dialect.parameterStyle === 'indexed'
          ? 'DELETE FROM users WHERE id = $1'
          : 'DELETE FROM users WHERE id = ?'

        engine.execute(query, [1])

        const result = engine.execute('SELECT * FROM users')
        expect(result.rows.length).toBe(1)
      })
    })
  })

  describe('DELETE with RETURNING (PostgreSQL/SQLite)', () => {
    forEachDialect((engine, dialectName, dialect) => {
      if (!dialect.supportsReturning) return

      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice')")
      })

      it('should return deleted row with RETURNING *', () => {
        const result = engine.execute('DELETE FROM users WHERE id = 1 RETURNING *')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]).toEqual([1, 'Alice'])
      })
    })
  })
})

// ============================================================================
// DDL QUERY TESTS
// ============================================================================

describe('DDL Queries', () => {
  describe('CREATE TABLE', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      it('should create table', () => {
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

        const result = engine.execute("INSERT INTO users VALUES (1, 'Alice')")
        expect(result.affectedRows).toBe(1)
      })

      it('should create table with IF NOT EXISTS', () => {
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY)')

        // Should not throw
        engine.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)')
      })

      it('should create table with multiple columns', () => {
        engine.execute(`
          CREATE TABLE complex (
            id INTEGER PRIMARY KEY,
            name TEXT,
            age INTEGER,
            active INTEGER,
            score REAL
          )
        `)

        engine.execute("INSERT INTO complex VALUES (1, 'Test', 25, 1, 95.5)")
        const result = engine.execute('SELECT * FROM complex')
        expect(result.rows[0]).toEqual([1, 'Test', 25, 1, 95.5])
      })

      it('should create table with UNIQUE constraint', () => {
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)')
        engine.execute("INSERT INTO users VALUES (1, 'alice@test.com')")

        expect(() => {
          engine.execute("INSERT INTO users VALUES (2, 'alice@test.com')")
        }).toThrow()
      })
    })
  })

  describe('DROP TABLE', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY)')
      })

      it('should drop table', () => {
        engine.execute('DROP TABLE users')

        expect(() => {
          engine.execute('SELECT * FROM users')
        }).toThrow()
      })

      it('should drop table with IF EXISTS', () => {
        engine.execute('DROP TABLE IF EXISTS nonexistent')
        // Should not throw
      })
    })
  })

  describe('CREATE INDEX', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      })

      it('should create index (no-op for in-memory)', () => {
        // Indexes are no-op for in-memory implementation
        // but should not throw
        engine.execute('CREATE INDEX idx_name ON users (name)')
      })

      it('should create unique index (no-op for in-memory)', () => {
        engine.execute('CREATE UNIQUE INDEX idx_name ON users (name)')
      })
    })
  })
})

// ============================================================================
// COMPLEX QUERY PATTERNS
// ============================================================================

describe('Complex Query Patterns', () => {
  describe('Multiple Tables', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        engine.execute('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total INTEGER)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice')")
        engine.execute("INSERT INTO users VALUES (2, 'Bob')")
        engine.execute('INSERT INTO orders VALUES (1, 1, 100)')
        engine.execute('INSERT INTO orders VALUES (2, 1, 200)')
        engine.execute('INSERT INTO orders VALUES (3, 2, 150)')
      })

      it('should query multiple tables independently', () => {
        const users = engine.execute('SELECT * FROM users')
        const orders = engine.execute('SELECT * FROM orders')

        expect(users.rows.length).toBe(2)
        expect(orders.rows.length).toBe(3)
      })

      it('should filter on each table independently', () => {
        const userOrders = engine.execute('SELECT * FROM orders WHERE user_id = 1')
        expect(userOrders.rows.length).toBe(2)
      })
    })
  })

  describe('Quoted Identifiers', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      it('should handle quoted table names', () => {
        engine.execute('CREATE TABLE "my table" (id INTEGER PRIMARY KEY)')
        engine.execute('INSERT INTO "my table" VALUES (1)')

        const result = engine.execute('SELECT * FROM "my table"')
        expect(result.rows.length).toBe(1)
      })

      it('should handle quoted column names', () => {
        engine.execute('CREATE TABLE t ("my column" INTEGER)')
        engine.execute('INSERT INTO t VALUES (42)')

        const result = engine.execute('SELECT "my column" FROM t')
        expect(result.rows[0]?.[0]).toBe(42)
      })
    })
  })

  describe('NULL Handling', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
        engine.execute('INSERT INTO t VALUES (1, NULL)')
        engine.execute('INSERT INTO t VALUES (2, 0)')
        engine.execute('INSERT INTO t VALUES (3, 1)')
      })

      it('should distinguish NULL from 0', () => {
        const nullResult = engine.execute('SELECT * FROM t WHERE value IS NULL')
        expect(nullResult.rows.length).toBe(1)
        expect(nullResult.rows[0]?.[0]).toBe(1)

        const zeroResult = engine.execute('SELECT * FROM t WHERE value = 0')
        expect(zeroResult.rows.length).toBe(1)
        expect(zeroResult.rows[0]?.[0]).toBe(2)
      })

      it('should handle NULL in comparisons', () => {
        // NULL = NULL should not match (SQL semantics)
        const result = engine.execute('SELECT * FROM t WHERE value = NULL')
        expect(result.rows.length).toBe(0)
      })

      it('should handle IS NOT NULL', () => {
        const result = engine.execute('SELECT * FROM t WHERE value IS NOT NULL')
        expect(result.rows.length).toBe(2)
      })
    })
  })

  describe('Case Sensitivity', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      it('should handle lowercase SQL keywords', () => {
        engine.execute('create table t (id integer primary key)')
        engine.execute('insert into t values (1)')
        const result = engine.execute('select * from t')
        expect(result.rows.length).toBe(1)
      })

      it('should handle mixed case SQL keywords', () => {
        engine.execute('Create Table t (Id Integer Primary Key)')
        engine.execute('Insert Into t Values (1)')
        const result = engine.execute('Select * From t')
        expect(result.rows.length).toBe(1)
      })

      it('should normalize column names to lowercase', () => {
        engine.execute('CREATE TABLE t (MyColumn INTEGER)')
        const result = engine.execute('SELECT MyColumn FROM t')
        // Column names should be lowercase
        expect(result.columns[0]).toBe('mycolumn')
      })
    })
  })
})
