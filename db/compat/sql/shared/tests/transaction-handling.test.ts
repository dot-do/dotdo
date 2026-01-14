/**
 * @dotdo/db/compat/sql/shared - Transaction Handling Tests
 *
 * Comprehensive tests for SQL transaction handling across all dialects.
 * These tests ensure consistent behavior for:
 * - BEGIN/COMMIT/ROLLBACK statements
 * - Transaction isolation (read vs write modes)
 * - Transaction state management
 * - Rollback behavior and data restoration
 * - Nested transaction simulation (savepoints)
 * - Auto-commit behavior
 *
 * Each test category runs against all supported dialects to ensure
 * consistent behavior across PostgreSQL, MySQL, and SQLite.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSQLEngine,
  type SQLEngine,
} from '../engine'
import {
  POSTGRES_DIALECT,
  MYSQL_DIALECT,
  SQLITE_DIALECT,
  ReadOnlyTransactionError,
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
// BASIC TRANSACTION TESTS
// ============================================================================

describe('Basic Transaction Control', () => {
  describe('Transaction State', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      it('should not be in transaction initially', () => {
        expect(engine.isInTransaction()).toBe(false)
      })

      it('should be in transaction after BEGIN', () => {
        engine.beginTransaction()
        expect(engine.isInTransaction()).toBe(true)
      })

      it('should not be in transaction after COMMIT', () => {
        engine.beginTransaction()
        engine.commitTransaction()
        expect(engine.isInTransaction()).toBe(false)
      })

      it('should not be in transaction after ROLLBACK', () => {
        engine.beginTransaction()
        engine.rollbackTransaction()
        expect(engine.isInTransaction()).toBe(false)
      })

      it('should handle BEGIN via SQL statement', () => {
        engine.execute('BEGIN')
        expect(engine.isInTransaction()).toBe(true)
      })

      it('should handle COMMIT via SQL statement', () => {
        engine.execute('BEGIN')
        engine.execute('COMMIT')
        expect(engine.isInTransaction()).toBe(false)
      })

      it('should handle ROLLBACK via SQL statement', () => {
        engine.execute('BEGIN')
        engine.execute('ROLLBACK')
        expect(engine.isInTransaction()).toBe(false)
      })
    })
  })

  describe('Transaction Modes', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
        engine.execute('INSERT INTO t VALUES (1, 100)')
      })

      it('should allow read operations in read mode', () => {
        engine.beginTransaction('read')

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)

        engine.commitTransaction()
      })

      it('should reject write operations in read mode', () => {
        engine.beginTransaction('read')

        expect(() => {
          engine.execute('INSERT INTO t VALUES (2, 200)')
        }).toThrow(ReadOnlyTransactionError)

        engine.rollbackTransaction()
      })

      it('should reject UPDATE in read mode', () => {
        engine.beginTransaction('read')

        expect(() => {
          engine.execute('UPDATE t SET value = 200 WHERE id = 1')
        }).toThrow(ReadOnlyTransactionError)

        engine.rollbackTransaction()
      })

      it('should reject DELETE in read mode', () => {
        engine.beginTransaction('read')

        expect(() => {
          engine.execute('DELETE FROM t WHERE id = 1')
        }).toThrow(ReadOnlyTransactionError)

        engine.rollbackTransaction()
      })

      it('should allow all operations in write mode', () => {
        engine.beginTransaction('write')

        engine.execute('SELECT * FROM t')
        engine.execute('INSERT INTO t VALUES (2, 200)')
        engine.execute('UPDATE t SET value = 300 WHERE id = 2')
        engine.execute('DELETE FROM t WHERE id = 2')

        engine.commitTransaction()
      })

      it('should default to write mode', () => {
        engine.beginTransaction()

        // Should not throw
        engine.execute('INSERT INTO t VALUES (2, 200)')

        engine.rollbackTransaction()
      })
    })
  })
})

// ============================================================================
// COMMIT BEHAVIOR TESTS
// ============================================================================

describe('Commit Behavior', () => {
  describe('Data Persistence on Commit', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
      })

      it('should persist INSERT after commit', () => {
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (1, 100)')
        engine.commitTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]).toEqual([1, 100])
      })

      it('should persist UPDATE after commit', () => {
        engine.execute('INSERT INTO t VALUES (1, 100)')

        engine.beginTransaction()
        engine.execute('UPDATE t SET value = 200 WHERE id = 1')
        engine.commitTransaction()

        const result = engine.execute('SELECT value FROM t WHERE id = 1')
        expect(result.rows[0]?.[0]).toBe(200)
      })

      it('should persist DELETE after commit', () => {
        engine.execute('INSERT INTO t VALUES (1, 100)')
        engine.execute('INSERT INTO t VALUES (2, 200)')

        engine.beginTransaction()
        engine.execute('DELETE FROM t WHERE id = 1')
        engine.commitTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]?.[0]).toBe(2)
      })

      it('should persist multiple operations after commit', () => {
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (1, 100)')
        engine.execute('INSERT INTO t VALUES (2, 200)')
        engine.execute('UPDATE t SET value = 150 WHERE id = 1')
        engine.execute('DELETE FROM t WHERE id = 2')
        engine.commitTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]).toEqual([1, 150])
      })
    })
  })

  describe('Auto-Increment Persistence', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        if (dialect.dialect === 'postgresql') {
          engine.execute('CREATE TABLE t (id SERIAL PRIMARY KEY, value INTEGER)')
        } else if (dialect.dialect === 'mysql') {
          engine.execute('CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, value INTEGER)')
        } else {
          engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, value INTEGER)')
        }
      })

      it('should persist auto-increment counter after commit', () => {
        engine.beginTransaction()
        engine.execute('INSERT INTO t (value) VALUES (100)')
        engine.execute('INSERT INTO t (value) VALUES (200)')
        engine.commitTransaction()

        // Insert after commit should continue from 3
        const result = engine.execute('INSERT INTO t (value) VALUES (300)')
        expect(result.lastInsertRowid).toBe(3)
      })
    })
  })
})

// ============================================================================
// ROLLBACK BEHAVIOR TESTS
// ============================================================================

describe('Rollback Behavior', () => {
  describe('Data Restoration on Rollback', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
      })

      it('should discard INSERT after rollback', () => {
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (1, 100)')
        engine.rollbackTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(0)
      })

      it('should restore original value after UPDATE rollback', () => {
        engine.execute('INSERT INTO t VALUES (1, 100)')

        engine.beginTransaction()
        engine.execute('UPDATE t SET value = 200 WHERE id = 1')
        engine.rollbackTransaction()

        const result = engine.execute('SELECT value FROM t WHERE id = 1')
        expect(result.rows[0]?.[0]).toBe(100)
      })

      it('should restore deleted row after DELETE rollback', () => {
        engine.execute('INSERT INTO t VALUES (1, 100)')

        engine.beginTransaction()
        engine.execute('DELETE FROM t WHERE id = 1')
        engine.rollbackTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]).toEqual([1, 100])
      })

      it('should restore all data after complex transaction rollback', () => {
        engine.execute('INSERT INTO t VALUES (1, 100)')
        engine.execute('INSERT INTO t VALUES (2, 200)')

        engine.beginTransaction()
        engine.execute('UPDATE t SET value = 999 WHERE id = 1')
        engine.execute('DELETE FROM t WHERE id = 2')
        engine.execute('INSERT INTO t VALUES (3, 300)')
        engine.rollbackTransaction()

        const result = engine.execute('SELECT * FROM t ORDER BY id')
        expect(result.rows.length).toBe(2)
        expect(result.rows[0]).toEqual([1, 100])
        expect(result.rows[1]).toEqual([2, 200])
      })
    })
  })

  describe('Auto-Increment Rollback', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        if (dialect.dialect === 'postgresql') {
          engine.execute('CREATE TABLE t (id SERIAL PRIMARY KEY, value INTEGER)')
        } else if (dialect.dialect === 'mysql') {
          engine.execute('CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, value INTEGER)')
        } else {
          engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, value INTEGER)')
        }
      })

      it('should restore auto-increment counter after rollback', () => {
        engine.execute('INSERT INTO t (value) VALUES (100)')
        // ID is now 1, counter is 1

        engine.beginTransaction()
        engine.execute('INSERT INTO t (value) VALUES (200)') // ID would be 2
        engine.execute('INSERT INTO t (value) VALUES (300)') // ID would be 3
        engine.rollbackTransaction()

        // After rollback, next insert should get ID 2 (counter restored)
        const result = engine.execute('INSERT INTO t (value) VALUES (400)')
        expect(result.lastInsertRowid).toBe(2)
      })
    })
  })

  describe('Multiple Table Rollback', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        engine.execute('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER)')
        engine.execute("INSERT INTO users VALUES (1, 'Alice')")
        engine.execute('INSERT INTO orders VALUES (1, 1, 100)')
      })

      it('should rollback changes to multiple tables', () => {
        engine.beginTransaction()
        engine.execute("UPDATE users SET name = 'Alicia' WHERE id = 1")
        engine.execute('UPDATE orders SET amount = 200 WHERE id = 1')
        engine.execute("INSERT INTO users VALUES (2, 'Bob')")
        engine.execute('INSERT INTO orders VALUES (2, 2, 300)')
        engine.rollbackTransaction()

        const users = engine.execute('SELECT * FROM users')
        expect(users.rows.length).toBe(1)
        expect(users.rows[0]?.[1]).toBe('Alice')

        const orders = engine.execute('SELECT * FROM orders')
        expect(orders.rows.length).toBe(1)
        expect(orders.rows[0]?.[2]).toBe(100)
      })
    })
  })
})

// ============================================================================
// TRANSACTION ISOLATION TESTS
// ============================================================================

describe('Transaction Isolation', () => {
  describe('Read Consistency', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
        engine.execute('INSERT INTO t VALUES (1, 100)')
      })

      it('should see uncommitted changes within transaction', () => {
        engine.beginTransaction()
        engine.execute('UPDATE t SET value = 200 WHERE id = 1')

        const result = engine.execute('SELECT value FROM t WHERE id = 1')
        expect(result.rows[0]?.[0]).toBe(200)

        engine.rollbackTransaction()
      })

      it('should see inserted rows within transaction', () => {
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (2, 200)')

        const result = engine.execute('SELECT * FROM t ORDER BY id')
        expect(result.rows.length).toBe(2)

        engine.rollbackTransaction()
      })

      it('should not see deleted rows within transaction', () => {
        engine.beginTransaction()
        engine.execute('DELETE FROM t WHERE id = 1')

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(0)

        engine.rollbackTransaction()
      })
    })
  })
})

// ============================================================================
// SEQUENTIAL TRANSACTION TESTS
// ============================================================================

describe('Sequential Transactions', () => {
  describe('Multiple Transactions', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
      })

      it('should handle multiple sequential transactions', () => {
        // First transaction
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (1, 100)')
        engine.commitTransaction()

        // Second transaction
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (2, 200)')
        engine.commitTransaction()

        const result = engine.execute('SELECT * FROM t ORDER BY id')
        expect(result.rows.length).toBe(2)
      })

      it('should handle commit then rollback sequence', () => {
        // First transaction - commit
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (1, 100)')
        engine.commitTransaction()

        // Second transaction - rollback
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (2, 200)')
        engine.rollbackTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]?.[0]).toBe(1)
      })

      it('should handle rollback then commit sequence', () => {
        // First transaction - rollback
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (1, 100)')
        engine.rollbackTransaction()

        // Second transaction - commit
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (2, 200)')
        engine.commitTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
        expect(result.rows[0]?.[0]).toBe(2)
      })

      it('should handle multiple rollbacks', () => {
        engine.execute('INSERT INTO t VALUES (1, 100)')

        engine.beginTransaction()
        engine.execute('UPDATE t SET value = 200 WHERE id = 1')
        engine.rollbackTransaction()

        engine.beginTransaction()
        engine.execute('UPDATE t SET value = 300 WHERE id = 1')
        engine.rollbackTransaction()

        const result = engine.execute('SELECT value FROM t WHERE id = 1')
        expect(result.rows[0]?.[0]).toBe(100)
      })
    })
  })
})

// ============================================================================
// SAVEPOINT TESTS (DDL STATEMENTS)
// ============================================================================

describe('Savepoint Statements', () => {
  describe('SAVEPOINT and RELEASE', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      it('should handle SAVEPOINT statement (no-op)', () => {
        // SAVEPOINT is accepted but is a no-op for in-memory engine
        expect(() => {
          engine.execute('SAVEPOINT sp1')
        }).not.toThrow()
      })

      it('should handle RELEASE statement (no-op)', () => {
        expect(() => {
          engine.execute('RELEASE sp1')
        }).not.toThrow()
      })

      it('should handle RELEASE SAVEPOINT statement (no-op)', () => {
        expect(() => {
          engine.execute('RELEASE SAVEPOINT sp1')
        }).not.toThrow()
      })
    })
  })
})

// ============================================================================
// SET AND SHOW STATEMENTS (SESSION CONTROL)
// ============================================================================

describe('Session Control Statements', () => {
  describe('SET Statements', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      it('should handle SET statement (no-op)', () => {
        expect(() => {
          engine.execute('SET search_path = public')
        }).not.toThrow()
      })

      it('should handle SET with equals', () => {
        expect(() => {
          engine.execute('SET timezone = "UTC"')
        }).not.toThrow()
      })
    })
  })

  describe('SHOW Statements', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
      })

      it('should handle SHOW statement (no-op)', () => {
        expect(() => {
          engine.execute('SHOW search_path')
        }).not.toThrow()
      })

      it('should handle SHOW ALL', () => {
        expect(() => {
          engine.execute('SHOW ALL')
        }).not.toThrow()
      })
    })
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Transaction Edge Cases', () => {
  describe('Empty Transactions', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
        engine.execute('INSERT INTO t VALUES (1)')
      })

      it('should handle empty commit', () => {
        engine.beginTransaction()
        engine.commitTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
      })

      it('should handle empty rollback', () => {
        engine.beginTransaction()
        engine.rollbackTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
      })

      it('should handle read-only transaction with commit', () => {
        engine.beginTransaction('read')
        engine.execute('SELECT * FROM t')
        engine.commitTransaction()

        expect(engine.isInTransaction()).toBe(false)
      })
    })
  })

  describe('Transaction with Errors', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
        engine.execute('INSERT INTO t VALUES (1, 100)')
      })

      it('should remain in transaction after query error', () => {
        engine.beginTransaction()
        engine.execute('INSERT INTO t VALUES (2, 200)')

        // This should throw (duplicate key)
        try {
          engine.execute('INSERT INTO t VALUES (2, 300)')
        } catch {
          // Expected
        }

        // Should still be in transaction
        expect(engine.isInTransaction()).toBe(true)

        // Rollback should restore state
        engine.rollbackTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
      })
    })
  })

  describe('Large Transactions', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value INTEGER)')
      })

      it('should handle many operations in one transaction', () => {
        engine.beginTransaction()

        for (let i = 0; i < 100; i++) {
          engine.execute(`INSERT INTO t VALUES (${i}, ${i * 10})`)
        }

        engine.commitTransaction()

        const result = engine.execute('SELECT COUNT(*) as count FROM t')
        // Note: In-memory engine doesn't support COUNT(*) properly,
        // so we use alternative approach
        const allRows = engine.execute('SELECT * FROM t')
        expect(allRows.rows.length).toBe(100)
      })

      it('should rollback many operations', () => {
        engine.execute('INSERT INTO t VALUES (0, 0)')

        engine.beginTransaction()

        for (let i = 1; i <= 100; i++) {
          engine.execute(`INSERT INTO t VALUES (${i}, ${i * 10})`)
        }

        engine.rollbackTransaction()

        const result = engine.execute('SELECT * FROM t')
        expect(result.rows.length).toBe(1)
      })
    })
  })
})

// ============================================================================
// DIALECT-SPECIFIC TRANSACTION SYNTAX
// ============================================================================

describe('Dialect-Specific Transaction Syntax', () => {
  describe('START TRANSACTION', () => {
    forEachDialect((engine, dialectName, dialect) => {
      beforeEach(() => {
        engine = createSQLEngine(dialect)
        engine.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
      })

      it('should handle START TRANSACTION as BEGIN', () => {
        engine.execute('START TRANSACTION')
        expect(engine.isInTransaction()).toBe(true)
        engine.execute('ROLLBACK')
      })
    })
  })
})
