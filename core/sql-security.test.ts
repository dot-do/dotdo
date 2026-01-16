/**
 * SQL Security Module Unit Tests
 *
 * Tests for the SQL validation and sanitization functions.
 *
 * @see do-ld03: Protect raw SQL query RPC method
 * @module core/sql-security.test
 */

import { describe, it, expect } from 'vitest'
import {
  validateSqlQuery,
  sanitizeSqlError,
  isSafeQuery,
  SqlSecurityError,
} from './sql-security'

// =============================================================================
// validateSqlQuery Tests
// =============================================================================

describe('validateSqlQuery', () => {
  describe('Valid SELECT queries', () => {
    it('accepts simple SELECT', () => {
      expect(() => validateSqlQuery('SELECT * FROM users')).not.toThrow()
    })

    it('accepts SELECT with columns', () => {
      expect(() => validateSqlQuery('SELECT id, name FROM users')).not.toThrow()
    })

    it('accepts SELECT with WHERE clause', () => {
      expect(() =>
        validateSqlQuery("SELECT * FROM users WHERE status = 'active'")
      ).not.toThrow()
    })

    it('accepts SELECT with JOIN', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM users u JOIN orders o ON u.id = o.user_id')
      ).not.toThrow()
    })

    it('accepts SELECT with GROUP BY and HAVING', () => {
      expect(() =>
        validateSqlQuery('SELECT status, COUNT(*) FROM users GROUP BY status HAVING COUNT(*) > 1')
      ).not.toThrow()
    })

    it('accepts SELECT with ORDER BY and LIMIT', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM users ORDER BY created_at DESC LIMIT 10')
      ).not.toThrow()
    })

    it('accepts SELECT with subquery', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)')
      ).not.toThrow()
    })

    it('accepts SELECT with UNION', () => {
      expect(() =>
        validateSqlQuery('SELECT id, name FROM users UNION SELECT id, name FROM admins')
      ).not.toThrow()
    })

    it('accepts SELECT with leading whitespace', () => {
      expect(() => validateSqlQuery('  SELECT * FROM users')).not.toThrow()
    })

    it('accepts lowercase select', () => {
      expect(() => validateSqlQuery('select * from users')).not.toThrow()
    })

    it('accepts mixed case SeLeCt', () => {
      expect(() => validateSqlQuery('SeLeCt * FrOm users')).not.toThrow()
    })
  })

  describe('Forbidden DML operations', () => {
    it('rejects INSERT', () => {
      expect(() =>
        validateSqlQuery("INSERT INTO users (name) VALUES ('hack')")
      ).toThrow(SqlSecurityError)
    })

    it('rejects UPDATE', () => {
      expect(() =>
        validateSqlQuery("UPDATE users SET role = 'admin'")
      ).toThrow(SqlSecurityError)
    })

    it('rejects DELETE', () => {
      expect(() => validateSqlQuery('DELETE FROM users')).toThrow(SqlSecurityError)
    })

    it('rejects REPLACE', () => {
      expect(() =>
        validateSqlQuery("REPLACE INTO users (id, name) VALUES (1, 'hack')")
      ).toThrow(SqlSecurityError)
    })
  })

  describe('Forbidden DDL operations', () => {
    it('rejects CREATE TABLE', () => {
      expect(() =>
        validateSqlQuery('CREATE TABLE hacked (id INTEGER)')
      ).toThrow(SqlSecurityError)
    })

    it('rejects ALTER TABLE', () => {
      expect(() =>
        validateSqlQuery('ALTER TABLE users ADD COLUMN hacked TEXT')
      ).toThrow(SqlSecurityError)
    })

    it('rejects DROP TABLE', () => {
      expect(() => validateSqlQuery('DROP TABLE users')).toThrow(SqlSecurityError)
    })

    it('rejects TRUNCATE', () => {
      expect(() => validateSqlQuery('TRUNCATE TABLE users')).toThrow(SqlSecurityError)
    })
  })

  describe('Forbidden administrative commands', () => {
    it('rejects ATTACH DATABASE', () => {
      expect(() =>
        validateSqlQuery("ATTACH DATABASE ':memory:' AS hacked")
      ).toThrow(SqlSecurityError)
    })

    it('rejects DETACH DATABASE', () => {
      expect(() => validateSqlQuery('DETACH DATABASE hacked')).toThrow(SqlSecurityError)
    })

    it('rejects VACUUM', () => {
      expect(() => validateSqlQuery('VACUUM')).toThrow(SqlSecurityError)
    })

    it('rejects REINDEX', () => {
      expect(() => validateSqlQuery('REINDEX')).toThrow(SqlSecurityError)
    })

    it('rejects ANALYZE', () => {
      expect(() => validateSqlQuery('ANALYZE')).toThrow(SqlSecurityError)
    })

    it('rejects PRAGMA', () => {
      expect(() => validateSqlQuery('PRAGMA table_info(users)')).toThrow(SqlSecurityError)
    })

    it('rejects EXPLAIN', () => {
      expect(() => validateSqlQuery('EXPLAIN SELECT * FROM users')).toThrow(SqlSecurityError)
    })
  })

  describe('Forbidden transaction commands', () => {
    it('rejects BEGIN', () => {
      expect(() => validateSqlQuery('BEGIN TRANSACTION')).toThrow(SqlSecurityError)
    })

    it('rejects COMMIT', () => {
      expect(() => validateSqlQuery('COMMIT')).toThrow(SqlSecurityError)
    })

    it('rejects ROLLBACK', () => {
      expect(() => validateSqlQuery('ROLLBACK')).toThrow(SqlSecurityError)
    })

    it('rejects SAVEPOINT', () => {
      expect(() => validateSqlQuery('SAVEPOINT sp1')).toThrow(SqlSecurityError)
    })

    it('rejects RELEASE', () => {
      expect(() => validateSqlQuery('RELEASE sp1')).toThrow(SqlSecurityError)
    })
  })

  describe('Multi-statement injection prevention', () => {
    it('rejects SELECT followed by DROP', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM users; DROP TABLE users;')
      ).toThrow(SqlSecurityError)
    })

    it('rejects SELECT followed by DELETE', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM users; DELETE FROM users;')
      ).toThrow(SqlSecurityError)
    })

    it('rejects SELECT followed by INSERT', () => {
      expect(() =>
        validateSqlQuery("SELECT * FROM users; INSERT INTO logs VALUES ('hack');")
      ).toThrow(SqlSecurityError)
    })

    it('rejects trailing content after semicolon', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM users; anything')
      ).toThrow(SqlSecurityError)
    })

    // Trailing semicolon alone should be OK (common in SQL)
    it('accepts SELECT with trailing semicolon only', () => {
      expect(() => validateSqlQuery('SELECT * FROM users;')).not.toThrow()
    })
  })

  describe('Comment injection prevention', () => {
    it('rejects single-line comment (--)', () => {
      expect(() =>
        validateSqlQuery("SELECT * FROM users -- comment")
      ).toThrow(SqlSecurityError)
    })

    it('rejects block comment (/* */)', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM users /* comment */')
      ).toThrow(SqlSecurityError)
    })

    it('rejects MySQL-style comment (#)', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM users # comment')
      ).toThrow(SqlSecurityError)
    })

    it('accepts -- in a string literal (edge case - currently blocked)', () => {
      // Note: This is a false positive but safer to block
      expect(() =>
        validateSqlQuery("SELECT * FROM users WHERE comment = 'test -- value'")
      ).toThrow(SqlSecurityError)
    })
  })

  describe('Case insensitivity', () => {
    it('rejects lowercase drop', () => {
      expect(() => validateSqlQuery('drop table users')).toThrow(SqlSecurityError)
    })

    it('rejects mixed case DrOp', () => {
      expect(() => validateSqlQuery('DrOp TaBlE users')).toThrow(SqlSecurityError)
    })

    it('rejects uppercase DELETE', () => {
      expect(() => validateSqlQuery('DELETE FROM users')).toThrow(SqlSecurityError)
    })
  })

  describe('Whitespace handling', () => {
    it('rejects DROP with leading spaces', () => {
      expect(() => validateSqlQuery('   DROP TABLE users')).toThrow(SqlSecurityError)
    })

    it('rejects DROP with leading tabs', () => {
      expect(() => validateSqlQuery('\t\tDROP TABLE users')).toThrow(SqlSecurityError)
    })

    it('rejects DROP with leading newlines', () => {
      expect(() => validateSqlQuery('\n\nDROP TABLE users')).toThrow(SqlSecurityError)
    })

    it('rejects DROP with mixed whitespace', () => {
      expect(() => validateSqlQuery(' \t\n DROP TABLE users')).toThrow(SqlSecurityError)
    })
  })

  describe('Empty and null queries', () => {
    it('rejects empty string', () => {
      expect(() => validateSqlQuery('')).toThrow(SqlSecurityError)
    })

    it('rejects whitespace-only string', () => {
      expect(() => validateSqlQuery('   \t\n  ')).toThrow(SqlSecurityError)
    })

    it('rejects null', () => {
      // @ts-expect-error Testing invalid input
      expect(() => validateSqlQuery(null)).toThrow(SqlSecurityError)
    })

    it('rejects undefined', () => {
      // @ts-expect-error Testing invalid input
      expect(() => validateSqlQuery(undefined)).toThrow(SqlSecurityError)
    })
  })

  describe('SQLite CLI dot commands', () => {
    it('rejects .read command', () => {
      expect(() => validateSqlQuery('.read /etc/passwd')).toThrow(SqlSecurityError)
    })

    it('rejects .import command', () => {
      expect(() => validateSqlQuery('.import file.csv table')).toThrow(SqlSecurityError)
    })

    it('rejects .dump command', () => {
      expect(() => validateSqlQuery('.dump')).toThrow(SqlSecurityError)
    })
  })

  describe('Error codes', () => {
    it('returns WRITE_OPERATION_FORBIDDEN for INSERT', () => {
      try {
        validateSqlQuery('INSERT INTO users VALUES (1)')
      } catch (error) {
        expect(error).toBeInstanceOf(SqlSecurityError)
        expect((error as SqlSecurityError).code).toBe('WRITE_OPERATION_FORBIDDEN')
      }
    })

    it('returns MULTI_STATEMENT_FORBIDDEN for stacked queries', () => {
      try {
        validateSqlQuery('SELECT 1; DROP TABLE x;')
      } catch (error) {
        expect(error).toBeInstanceOf(SqlSecurityError)
        expect((error as SqlSecurityError).code).toBe('MULTI_STATEMENT_FORBIDDEN')
      }
    })

    it('returns COMMENT_FORBIDDEN for SQL comments', () => {
      try {
        validateSqlQuery('SELECT * FROM users -- comment')
      } catch (error) {
        expect(error).toBeInstanceOf(SqlSecurityError)
        expect((error as SqlSecurityError).code).toBe('COMMENT_FORBIDDEN')
      }
    })

    it('returns EMPTY_QUERY for empty input', () => {
      try {
        validateSqlQuery('')
      } catch (error) {
        expect(error).toBeInstanceOf(SqlSecurityError)
        expect((error as SqlSecurityError).code).toBe('EMPTY_QUERY')
      }
    })
  })
})

// =============================================================================
// sanitizeSqlError Tests
// =============================================================================

describe('sanitizeSqlError', () => {
  it('returns SqlSecurityError as-is', () => {
    const original = new SqlSecurityError('test', 'EMPTY_QUERY')
    const result = sanitizeSqlError(original)
    expect(result).toBe(original)
  })

  it('sanitizes SQLITE_ERROR messages', () => {
    const original = new Error('near "INVALID": syntax error: SQLITE_ERROR')
    const result = sanitizeSqlError(original)
    expect(result.message).toBe('Query execution failed')
    expect(result.message).not.toContain('INVALID')
    expect(result.message).not.toContain('SQLITE')
  })

  it('sanitizes syntax error messages', () => {
    const original = new Error('near "SELECT": syntax error at offset 10')
    const result = sanitizeSqlError(original)
    expect(result.message).toBe('Invalid query syntax')
    expect(result.message).not.toContain('syntax error')
  })

  it('sanitizes no such table messages', () => {
    const original = new Error('no such table: secret_data')
    const result = sanitizeSqlError(original)
    expect(result.message).toBe('Table not found')
    expect(result.message).not.toContain('secret_data')
  })

  it('sanitizes no such column messages', () => {
    const original = new Error('no such column: password')
    const result = sanitizeSqlError(original)
    expect(result.message).toBe('Column not found')
    expect(result.message).not.toContain('password')
  })

  it('sanitizes not authorized messages', () => {
    const original = new Error('not authorized: SQLITE_AUTH')
    const result = sanitizeSqlError(original)
    expect(result.message).toBe('Operation not authorized')
  })

  it('sanitizes SQLITE_LOCKED messages', () => {
    const original = new Error('database table is locked: SQLITE_LOCKED')
    const result = sanitizeSqlError(original)
    expect(result.message).toBe('Operation not permitted')
  })

  it('returns generic error for unknown errors', () => {
    const original = new Error('some unexpected internal error')
    const result = sanitizeSqlError(original)
    expect(result.message).toBe('Query execution failed')
  })

  it('handles non-Error objects', () => {
    const result = sanitizeSqlError('string error')
    expect(result.message).toBe('Query execution failed')
  })
})

// =============================================================================
// isSafeQuery Tests
// =============================================================================

describe('isSafeQuery', () => {
  it('returns true for valid SELECT', () => {
    expect(isSafeQuery('SELECT * FROM users')).toBe(true)
  })

  it('returns false for INSERT', () => {
    expect(isSafeQuery("INSERT INTO users VALUES (1, 'hack')")).toBe(false)
  })

  it('returns false for DELETE', () => {
    expect(isSafeQuery('DELETE FROM users')).toBe(false)
  })

  it('returns false for DROP', () => {
    expect(isSafeQuery('DROP TABLE users')).toBe(false)
  })

  it('returns false for multi-statement', () => {
    expect(isSafeQuery('SELECT 1; DROP TABLE users;')).toBe(false)
  })

  it('returns false for empty query', () => {
    expect(isSafeQuery('')).toBe(false)
  })
})
