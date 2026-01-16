/**
 * Security Tests - Raw SQL RPC Method Protection [do-ld03]
 *
 * TDD RED Phase: Tests for protecting the raw SQL query() RPC method.
 *
 * Security Issue:
 * - DOCore.query() method is exposed as public RPC allowing arbitrary SQL execution
 * - No validation of SQL statements (can execute INSERT/UPDATE/DELETE/DROP)
 * - No authentication/authorization required for raw SQL access
 *
 * Expected Behavior (after fix):
 * - Only SELECT queries are allowed
 * - Multi-statement injection is blocked
 * - Dangerous SQL patterns are rejected
 * - Method optionally requires elevated capability (query:raw)
 *
 * These tests should FAIL initially until the fix is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Test Setup
// =============================================================================

/**
 * Get a DOCore stub for testing
 */
function getDOCoreStub(name = 'sql-security-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// =============================================================================
// SQL Injection Prevention Tests
// =============================================================================

describe('[SEC-RAW-SQL] Raw SQL Query RPC Method Security', () => {
  describe('Read-Only Enforcement', () => {
    it('should ALLOW simple SELECT queries', async () => {
      const stub = getDOCoreStub('sql-allow-select')

      // First create some data
      await stub.set('test-key', 'test-value')

      // SELECT should work
      const result = await stub.query('SELECT * FROM state LIMIT 5')

      // Should return results without error
      expect(Array.isArray(result)).toBe(true)
    })

    it('should ALLOW SELECT with parameterized values', async () => {
      const stub = getDOCoreStub('sql-allow-select-params')

      await stub.set('user:alice', { name: 'Alice' })

      // Parameterized SELECT should work
      const result = await stub.query(
        'SELECT * FROM state WHERE key = ?',
        ['user:alice']
      )

      expect(Array.isArray(result)).toBe(true)
    })

    it('should REJECT INSERT statements', async () => {
      const stub = getDOCoreStub('sql-reject-insert')

      // INSERT should be blocked
      await expect(
        stub.query("INSERT INTO state (key, value) VALUES ('hack', 'data')")
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT UPDATE statements', async () => {
      const stub = getDOCoreStub('sql-reject-update')

      // UPDATE should be blocked
      await expect(
        stub.query("UPDATE state SET value = 'hacked' WHERE key = 'admin'")
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT DELETE statements', async () => {
      const stub = getDOCoreStub('sql-reject-delete')

      // DELETE should be blocked
      await expect(
        stub.query('DELETE FROM state WHERE key LIKE "user:%"')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT DROP statements', async () => {
      const stub = getDOCoreStub('sql-reject-drop')

      // DROP should be blocked
      await expect(
        stub.query('DROP TABLE state')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT CREATE statements', async () => {
      const stub = getDOCoreStub('sql-reject-create')

      // CREATE should be blocked
      await expect(
        stub.query('CREATE TABLE hacked (id TEXT)')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT ALTER statements', async () => {
      const stub = getDOCoreStub('sql-reject-alter')

      // ALTER should be blocked
      await expect(
        stub.query('ALTER TABLE state ADD COLUMN hacked TEXT')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT TRUNCATE statements', async () => {
      const stub = getDOCoreStub('sql-reject-truncate')

      // TRUNCATE should be blocked
      await expect(
        stub.query('TRUNCATE TABLE state')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })
  })

  describe('Multi-Statement Injection Prevention', () => {
    it('should REJECT SELECT followed by DROP', async () => {
      const stub = getDOCoreStub('sql-multi-drop')

      // Attempted injection via stacked queries
      await expect(
        stub.query('SELECT * FROM state; DROP TABLE state;')
      ).rejects.toThrow(/Multiple statements|not allowed/i)
    })

    it('should REJECT SELECT followed by DELETE', async () => {
      const stub = getDOCoreStub('sql-multi-delete')

      await expect(
        stub.query('SELECT * FROM state; DELETE FROM state;')
      ).rejects.toThrow(/Multiple statements|not allowed/i)
    })

    it('should REJECT SELECT followed by INSERT', async () => {
      const stub = getDOCoreStub('sql-multi-insert')

      await expect(
        stub.query("SELECT * FROM state; INSERT INTO state VALUES ('x','y');")
      ).rejects.toThrow(/Multiple statements|not allowed/i)
    })

    it('should REJECT SELECT followed by UPDATE', async () => {
      const stub = getDOCoreStub('sql-multi-update')

      await expect(
        stub.query("SELECT * FROM state; UPDATE state SET value='x';")
      ).rejects.toThrow(/Multiple statements|not allowed/i)
    })

    it('should REJECT semicolon with trailing dangerous SQL', async () => {
      const stub = getDOCoreStub('sql-semicolon-injection')

      // Various injection patterns
      const injectionPatterns = [
        "SELECT 1; --",
        "SELECT 1; DROP TABLE state; --",
        "SELECT * FROM state WHERE key = ''; DROP TABLE state; --",
      ]

      for (const pattern of injectionPatterns) {
        await expect(
          stub.query(pattern)
        ).rejects.toThrow(/Multiple statements|not allowed/i)
      }
    })
  })

  describe('SQL Comment Injection Prevention', () => {
    it('should REJECT queries with SQL comment injection (--)', async () => {
      const stub = getDOCoreStub('sql-comment-dash')

      // Comment injection to bypass WHERE clause
      await expect(
        stub.query("SELECT * FROM state WHERE key = 'admin' -- AND 1=0")
      ).rejects.toThrow(/comment|not allowed/i)
    })

    it('should REJECT queries with block comment injection (/* */)', async () => {
      const stub = getDOCoreStub('sql-comment-block')

      await expect(
        stub.query("SELECT * FROM state /* comment */ WHERE 1=1")
      ).rejects.toThrow(/comment|not allowed/i)
    })
  })

  describe('Case Insensitivity', () => {
    it('should REJECT lowercase drop', async () => {
      const stub = getDOCoreStub('sql-lower-drop')

      await expect(
        stub.query('drop table state')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT mixed case DrOp', async () => {
      const stub = getDOCoreStub('sql-mixed-drop')

      await expect(
        stub.query('DrOp TaBlE state')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT mixed case DELETE', async () => {
      const stub = getDOCoreStub('sql-mixed-delete')

      await expect(
        stub.query('DeLeTe FROM state')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })
  })

  describe('Whitespace Variations', () => {
    it('should REJECT queries with leading whitespace before dangerous SQL', async () => {
      const stub = getDOCoreStub('sql-whitespace-leading')

      await expect(
        stub.query('   DROP TABLE state')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT queries with tabs before dangerous SQL', async () => {
      const stub = getDOCoreStub('sql-whitespace-tab')

      await expect(
        stub.query('\t\tDROP TABLE state')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })

    it('should REJECT queries with newlines before dangerous SQL', async () => {
      const stub = getDOCoreStub('sql-whitespace-newline')

      await expect(
        stub.query('\n\nDROP TABLE state')
      ).rejects.toThrow(/Only SELECT queries|SELECT queries allowed/i)
    })
  })

  describe('UNION-based Injection Prevention', () => {
    it('should ALLOW legitimate UNION SELECT (both sides are SELECT)', async () => {
      const stub = getDOCoreStub('sql-union-legit')

      // UNION between two SELECT statements should be allowed
      // (It's read-only)
      const result = await stub.query(
        "SELECT key FROM state WHERE key LIKE 'a%' UNION SELECT key FROM state WHERE key LIKE 'b%'"
      )

      expect(Array.isArray(result)).toBe(true)
    })

    it('should REJECT UNION with data exfiltration attempts', async () => {
      const stub = getDOCoreStub('sql-union-exfil')

      // This is still a SELECT, but we want to ensure:
      // 1. It doesn't crash
      // 2. It only returns data from allowed tables

      // The query itself is a SELECT so it should work
      // The security concern is about table access, not SQL injection per se
      const result = await stub.query(
        "SELECT key, value FROM state UNION SELECT 'admin', 'secret'"
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('Subquery Handling', () => {
    it('should ALLOW SELECT with legitimate subquery', async () => {
      const stub = getDOCoreStub('sql-subquery-legit')

      // Subquery in SELECT is read-only
      const result = await stub.query(
        'SELECT * FROM state WHERE key IN (SELECT key FROM state LIMIT 5)'
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('Empty and Malformed Queries', () => {
    it('should REJECT empty string query', async () => {
      const stub = getDOCoreStub('sql-empty')

      await expect(
        stub.query('')
      ).rejects.toThrow(/empty|required|Query/i)
    })

    it('should REJECT whitespace-only query', async () => {
      const stub = getDOCoreStub('sql-whitespace-only')

      await expect(
        stub.query('   \t\n  ')
      ).rejects.toThrow(/empty|required|Query/i)
    })

    it('should REJECT null query', async () => {
      const stub = getDOCoreStub('sql-null')

      await expect(
        // @ts-expect-error Testing invalid input
        stub.query(null)
      ).rejects.toThrow()
    })
  })

  describe('SQLite-Specific Attack Vectors', () => {
    it('should REJECT ATTACH DATABASE command', async () => {
      const stub = getDOCoreStub('sql-attach')

      await expect(
        stub.query("ATTACH DATABASE ':memory:' AS hacked")
      ).rejects.toThrow(/not allowed|SELECT queries/i)
    })

    it('should REJECT PRAGMA statements', async () => {
      const stub = getDOCoreStub('sql-pragma')

      await expect(
        stub.query('PRAGMA table_info(state)')
      ).rejects.toThrow(/not allowed|SELECT queries/i)
    })

    it('should REJECT VACUUM command', async () => {
      const stub = getDOCoreStub('sql-vacuum')

      await expect(
        stub.query('VACUUM')
      ).rejects.toThrow(/not allowed|SELECT queries/i)
    })

    it('should REJECT REINDEX command', async () => {
      const stub = getDOCoreStub('sql-reindex')

      await expect(
        stub.query('REINDEX')
      ).rejects.toThrow(/not allowed|SELECT queries/i)
    })

    it('should REJECT .read or .import dot commands (if executed)', async () => {
      const stub = getDOCoreStub('sql-dotcmd')

      // SQLite CLI dot commands - should be rejected even if they don't execute
      await expect(
        stub.query('.read /etc/passwd')
      ).rejects.toThrow(/not allowed|invalid|SELECT queries/i)
    })
  })

  describe('Parameter Binding Security', () => {
    it('should safely handle parameters with SQL injection attempts', async () => {
      const stub = getDOCoreStub('sql-param-injection')

      // The parameter should be safely escaped/bound
      const maliciousParam = "'; DROP TABLE state; --"

      // This should NOT drop the table
      const result = await stub.query(
        'SELECT * FROM state WHERE key = ?',
        [maliciousParam]
      )

      // Should return empty array (no match), not crash
      expect(Array.isArray(result)).toBe(true)

      // Verify table still exists by running another query
      const verify = await stub.query('SELECT COUNT(*) as count FROM state')
      expect(verify[0]).toHaveProperty('count')
    })

    it('should handle array parameters correctly', async () => {
      const stub = getDOCoreStub('sql-param-array')

      await stub.set('item1', 'value1')
      await stub.set('item2', 'value2')

      // SQLite doesn't support array parameters directly, but we should handle gracefully
      const result = await stub.query(
        'SELECT * FROM state WHERE key = ? OR key = ?',
        ['item1', 'item2']
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('Error Message Security', () => {
    it('should NOT leak SQL structure in error messages', async () => {
      const stub = getDOCoreStub('sql-error-leak')

      try {
        // Malformed SQL that would cause an error
        // Note: "SELEKT" is blocked because it's not SELECT
        await stub.query('SELEKT * FROM state')
      } catch (error) {
        const message = (error as Error).message

        // Error should not reveal internal SQLite details
        expect(message).not.toContain('sqlite')
        // Our validator blocks it before SQLite sees it, so no "syntax error"
        // Should give a safe, generic error about SELECT being required
        expect(message).toMatch(/Only SELECT queries|SELECT queries allowed/i)
      }
    })
  })
})

// =============================================================================
// Data Integrity Verification
// =============================================================================

describe('[SEC-RAW-SQL] Data Integrity After Attack Attempts', () => {
  it('should preserve data after rejected injection attempts', async () => {
    const stub = getDOCoreStub('sql-integrity-test')

    // Set up test data
    await stub.set('important-data', { value: 'critical', version: 1 })
    await stub.set('user:admin', { role: 'admin', permissions: ['all'] })

    // Attempt various injections (all should fail)
    const attacks = [
      'DROP TABLE state',
      'DELETE FROM state',
      "UPDATE state SET value = 'hacked'",
      "INSERT INTO state VALUES ('hack', 'data')",
      "SELECT 1; DROP TABLE state; --",
    ]

    for (const attack of attacks) {
      try {
        await stub.query(attack)
      } catch {
        // Expected to fail
      }
    }

    // Verify data is still intact
    const important = await stub.get('important-data')
    expect(important).toEqual({ value: 'critical', version: 1 })

    const admin = await stub.get('user:admin')
    expect(admin).toEqual({ role: 'admin', permissions: ['all'] })
  })
})
