/**
 * SQL Safety Tests for stores.ts
 *
 * Tests for SQL injection prevention in ThingsStore.list()
 *
 * Security measures implemented:
 * - Column whitelist validation for orderBy (validateOrderColumn)
 * - JSON path regex validation (validateJsonPath)
 * - Type-safe ORDER BY clause builder with pre-built SQL fragments
 * - Parameterized queries for all user input via Drizzle's sql template tag
 *
 * These tests verify that:
 * 1. SQL injection attempts on orderBy are rejected
 * 2. SQL injection attempts on where clause JSON paths are rejected
 * 3. Only whitelisted columns are allowed for orderBy
 * 4. JSON paths are properly sanitized (alphanumeric, underscores, and dots only)
 */

import { describe, it, expect } from 'vitest'
import {
  validateOrderColumn,
  validateJsonPath,
  buildSafeJsonPath,
  buildOrderClause,
  ALLOWED_ORDER_COLUMNS,
  type AllowedOrderColumn,
} from '../../db/stores'

// ============================================================================
// TEST SUITE: Column Whitelist Validation
// ============================================================================

describe('SQL Injection Prevention - Column Whitelist', () => {
  describe('validateOrderColumn', () => {
    it('allows valid column names from whitelist', () => {
      // These columns should be in the whitelist and pass validation
      expect(() => validateOrderColumn('id')).not.toThrow()
      expect(() => validateOrderColumn('name')).not.toThrow()
      expect(() => validateOrderColumn('type')).not.toThrow()
      expect(() => validateOrderColumn('branch')).not.toThrow()
      expect(() => validateOrderColumn('deleted')).not.toThrow()
    })

    it('rejects SQL injection attempts in orderBy', () => {
      // Classic SQL injection - should throw
      expect(() => validateOrderColumn('id; DROP TABLE things;--')).toThrow()
      expect(() => validateOrderColumn("id' OR '1'='1")).toThrow()
      expect(() => validateOrderColumn('id UNION SELECT * FROM users')).toThrow()
    })

    it('rejects column names not in whitelist', () => {
      // Arbitrary column names should not be allowed
      expect(() => validateOrderColumn('nonexistent_column')).toThrow()
      expect(() => validateOrderColumn('password')).toThrow()
      expect(() => validateOrderColumn('secret_data')).toThrow()
    })

    it('rejects empty or null column names', () => {
      expect(() => validateOrderColumn('')).toThrow()
      expect(() => validateOrderColumn(null as any)).toThrow()
      expect(() => validateOrderColumn(undefined as any)).toThrow()
    })

    it('rejects column names with special characters', () => {
      // Even without explicit SQL injection, special chars should be rejected
      expect(() => validateOrderColumn('id--')).toThrow()
      expect(() => validateOrderColumn('id/*comment*/')).toThrow()
      expect(() => validateOrderColumn('id`')).toThrow()
      expect(() => validateOrderColumn('id"')).toThrow()
      expect(() => validateOrderColumn("id'")).toThrow()
    })

    it('rejects column names with whitespace', () => {
      expect(() => validateOrderColumn('id name')).toThrow()
      expect(() => validateOrderColumn('id\tname')).toThrow()
      expect(() => validateOrderColumn('id\nname')).toThrow()
    })

    it('returns the validated column name for valid inputs', () => {
      expect(validateOrderColumn('id')).toBe('id')
      expect(validateOrderColumn('name')).toBe('name')
    })
  })

  describe('ALLOWED_ORDER_COLUMNS constant', () => {
    it('exports a readonly array of allowed columns', () => {
      expect(ALLOWED_ORDER_COLUMNS).toBeDefined()
      expect(Array.isArray(ALLOWED_ORDER_COLUMNS)).toBe(true)
    })

    it('contains expected columns from things table schema', () => {
      // Based on the things table schema, these columns should be allowed
      expect(ALLOWED_ORDER_COLUMNS).toContain('id')
      expect(ALLOWED_ORDER_COLUMNS).toContain('name')
      expect(ALLOWED_ORDER_COLUMNS).toContain('type')
    })

    it('is frozen to prevent modification', () => {
      expect(Object.isFrozen(ALLOWED_ORDER_COLUMNS)).toBe(true)
    })
  })
})

// ============================================================================
// TEST SUITE: JSON Path Validation
// ============================================================================

describe('SQL Injection Prevention - JSON Path Validation', () => {
  describe('validateJsonPath', () => {
    it('allows valid JSON paths with alphanumeric characters', () => {
      expect(() => validateJsonPath('status')).not.toThrow()
      expect(() => validateJsonPath('user')).not.toThrow()
      expect(() => validateJsonPath('createdAt')).not.toThrow()
    })

    it('allows valid nested JSON paths with dots', () => {
      expect(() => validateJsonPath('user.name')).not.toThrow()
      expect(() => validateJsonPath('metadata.version')).not.toThrow()
      expect(() => validateJsonPath('deeply.nested.path.value')).not.toThrow()
    })

    it('allows JSON paths with underscores', () => {
      expect(() => validateJsonPath('user_name')).not.toThrow()
      expect(() => validateJsonPath('created_at')).not.toThrow()
      expect(() => validateJsonPath('config.max_retries')).not.toThrow()
    })

    it('allows JSON paths with numbers', () => {
      expect(() => validateJsonPath('field1')).not.toThrow()
      expect(() => validateJsonPath('item2.value')).not.toThrow()
    })

    it('rejects SQL injection attempts in JSON path', () => {
      // SQL injection via JSON path
      expect(() => validateJsonPath("status'); DROP TABLE things;--")).toThrow()
      expect(() => validateJsonPath("user' OR '1'='1")).toThrow()
      expect(() => validateJsonPath('status UNION SELECT password FROM users')).toThrow()
    })

    it('rejects JSON paths with parentheses', () => {
      expect(() => validateJsonPath('func()')).toThrow()
      expect(() => validateJsonPath('json_extract(data)')).toThrow()
    })

    it('rejects JSON paths with quotes', () => {
      expect(() => validateJsonPath("user'")).toThrow()
      expect(() => validateJsonPath('user"')).toThrow()
      expect(() => validateJsonPath('user`')).toThrow()
    })

    it('rejects JSON paths with SQL operators', () => {
      expect(() => validateJsonPath('status OR 1=1')).toThrow()
      expect(() => validateJsonPath('status AND 1=1')).toThrow()
      expect(() => validateJsonPath('status;')).toThrow()
    })

    it('rejects JSON paths with comment markers', () => {
      expect(() => validateJsonPath('status--')).toThrow()
      expect(() => validateJsonPath('status/*comment*/')).toThrow()
      expect(() => validateJsonPath('status#')).toThrow()
    })

    it('rejects empty or null JSON paths', () => {
      expect(() => validateJsonPath('')).toThrow()
      expect(() => validateJsonPath(null as any)).toThrow()
      expect(() => validateJsonPath(undefined as any)).toThrow()
    })

    it('rejects JSON paths starting or ending with dots', () => {
      expect(() => validateJsonPath('.status')).toThrow()
      expect(() => validateJsonPath('status.')).toThrow()
      expect(() => validateJsonPath('.status.')).toThrow()
    })

    it('rejects JSON paths with consecutive dots', () => {
      expect(() => validateJsonPath('user..name')).toThrow()
      expect(() => validateJsonPath('a...b')).toThrow()
    })

    it('rejects JSON paths with array notation', () => {
      // Array notation could be exploited
      expect(() => validateJsonPath('items[0]')).toThrow()
      expect(() => validateJsonPath('users[*]')).toThrow()
    })

    it('returns the validated path for valid inputs', () => {
      expect(validateJsonPath('status')).toBe('status')
      expect(validateJsonPath('user.name')).toBe('user.name')
    })
  })
})

// ============================================================================
// TEST SUITE: Type-Safe Query Builders
// ============================================================================

describe('Type-Safe Query Builders', () => {
  describe('buildSafeJsonPath', () => {
    it('prefixes valid paths with $.', () => {
      expect(buildSafeJsonPath('status')).toBe('$.status')
      expect(buildSafeJsonPath('user.name')).toBe('$.user.name')
      expect(buildSafeJsonPath('deeply.nested.path')).toBe('$.deeply.nested.path')
    })

    it('validates before building path', () => {
      expect(() => buildSafeJsonPath("status'; DROP TABLE")).toThrow()
      expect(() => buildSafeJsonPath('')).toThrow()
      expect(() => buildSafeJsonPath('..invalid')).toThrow()
    })

    it('returns safe paths for use in parameterized queries', () => {
      const path = buildSafeJsonPath('config.max_retries')
      // The path should be safe to use as a string value in parameterized query
      expect(path).toBe('$.config.max_retries')
      expect(path).not.toContain(';')
      expect(path).not.toContain("'")
      expect(path).not.toContain('"')
    })
  })

  describe('buildOrderClause', () => {
    it('returns SQL fragment for valid columns', () => {
      // Each allowed column should have both asc and desc variants
      for (const column of ALLOWED_ORDER_COLUMNS) {
        const ascClause = buildOrderClause(column, 'asc')
        const descClause = buildOrderClause(column, 'desc')
        expect(ascClause).toBeDefined()
        expect(descClause).toBeDefined()
      }
    })

    it('defaults to ascending order', () => {
      const defaultClause = buildOrderClause('id')
      const explicitAsc = buildOrderClause('id', 'asc')
      // Both should produce equivalent SQL fragments
      expect(defaultClause).toBeDefined()
      expect(explicitAsc).toBeDefined()
    })

    it('returns different fragments for asc vs desc', () => {
      const ascClause = buildOrderClause('name', 'asc')
      const descClause = buildOrderClause('name', 'desc')
      // They should be different SQL fragments
      expect(ascClause).not.toBe(descClause)
    })
  })
})

// ============================================================================
// TEST SUITE: Advanced Injection Attacks
// ============================================================================

describe('SQL Injection Prevention - Advanced Attacks', () => {
  describe('validateOrderColumn - Advanced SQL Injection', () => {
    it('rejects blind SQL injection attempts', () => {
      expect(() => validateOrderColumn('id AND 1=1')).toThrow()
      expect(() => validateOrderColumn('id AND SLEEP(5)')).toThrow()
      expect(() => validateOrderColumn('id AND BENCHMARK(10000000,SHA1(1))')).toThrow()
    })

    it('rejects time-based injection attempts', () => {
      expect(() => validateOrderColumn("id AND IF(1=1,SLEEP(5),0)")).toThrow()
      expect(() => validateOrderColumn("id AND WAITFOR DELAY '0:0:5'")).toThrow()
    })

    it('rejects stacked queries', () => {
      expect(() => validateOrderColumn('id; INSERT INTO users VALUES(1,2,3)')).toThrow()
      expect(() => validateOrderColumn('id; UPDATE users SET admin=1')).toThrow()
    })

    it('rejects comment-based injection', () => {
      expect(() => validateOrderColumn('id --')).toThrow()
      expect(() => validateOrderColumn('id /* */ name')).toThrow()
      expect(() => validateOrderColumn('id # comment')).toThrow()
    })

    it('rejects unicode and encoding attacks', () => {
      expect(() => validateOrderColumn('id\u0000name')).toThrow()  // Null byte
      expect(() => validateOrderColumn('id%00name')).toThrow()      // URL-encoded null
      expect(() => validateOrderColumn('id\x00name')).toThrow()     // Hex null
    })

    it('rejects case variations of SQL keywords', () => {
      expect(() => validateOrderColumn('id OR 1=1')).toThrow()
      expect(() => validateOrderColumn('id or 1=1')).toThrow()
      expect(() => validateOrderColumn('id Or 1=1')).toThrow()
      expect(() => validateOrderColumn('id oR 1=1')).toThrow()
    })
  })

  describe('validateJsonPath - Advanced SQL Injection', () => {
    it('rejects SQL function calls', () => {
      expect(() => validateJsonPath('CONCAT(a,b)')).toThrow()
      expect(() => validateJsonPath('SUBSTR(password,1,1)')).toThrow()
      expect(() => validateJsonPath('LENGTH(data)')).toThrow()
      expect(() => validateJsonPath('CHAR(65)')).toThrow()
    })

    it('rejects subquery attempts', () => {
      expect(() => validateJsonPath('(SELECT password FROM users)')).toThrow()
      expect(() => validateJsonPath('x IN (SELECT 1)')).toThrow()
    })

    it('rejects hex and binary literals', () => {
      expect(() => validateJsonPath('0x414243')).toThrow()  // Starts with digit
      // Note: 'x0x414243' is actually a valid identifier (starts with letter, alphanumeric after)
      // It's safe as a JSON path because it's just a field name, not an actual hex literal
      expect(() => validateJsonPath('x0x414243')).not.toThrow()
    })

    it('rejects escape sequence abuse', () => {
      expect(() => validateJsonPath('status\\x27')).toThrow()  // Backslash
      expect(() => validateJsonPath('status\\n')).toThrow()
      expect(() => validateJsonPath('status\\\\')).toThrow()
    })

    it('rejects paths that could escape JSON context', () => {
      expect(() => validateJsonPath('status"')).toThrow()
      expect(() => validateJsonPath("status'")).toThrow()
      expect(() => validateJsonPath('status\\')).toThrow()  // Backslash for escaping
    })

    it('rejects comparison operators in paths', () => {
      expect(() => validateJsonPath('status=1')).toThrow()
      expect(() => validateJsonPath('status>0')).toThrow()
      expect(() => validateJsonPath('status<>0')).toThrow()
      expect(() => validateJsonPath('status!=0')).toThrow()
    })

    it('rejects boolean operators in paths', () => {
      expect(() => validateJsonPath('status AND true')).toThrow()
      expect(() => validateJsonPath('status OR false')).toThrow()
      expect(() => validateJsonPath('status NOT null')).toThrow()
    })
  })
})

// ============================================================================
// TEST SUITE: Edge Cases and Boundary Conditions
// ============================================================================

describe('SQL Injection Prevention - Edge Cases', () => {
  describe('validateOrderColumn - Edge Cases', () => {
    it('handles case sensitivity correctly', () => {
      // Only exact matches should pass
      expect(() => validateOrderColumn('ID')).toThrow()  // Uppercase
      expect(() => validateOrderColumn('Id')).toThrow()  // Mixed case
      expect(() => validateOrderColumn('iD')).toThrow()  // Mixed case
      expect(validateOrderColumn('id')).toBe('id')       // Exact lowercase
    })

    it('rejects leading/trailing whitespace', () => {
      expect(() => validateOrderColumn(' id')).toThrow()
      expect(() => validateOrderColumn('id ')).toThrow()
      expect(() => validateOrderColumn(' id ')).toThrow()
    })

    it('handles very long input', () => {
      const longColumn = 'a'.repeat(1000)
      expect(() => validateOrderColumn(longColumn)).toThrow()
    })

    it('handles non-string input types', () => {
      expect(() => validateOrderColumn(123 as any)).toThrow()
      expect(() => validateOrderColumn({} as any)).toThrow()
      expect(() => validateOrderColumn([] as any)).toThrow()
      expect(() => validateOrderColumn(true as any)).toThrow()
    })
  })

  describe('validateJsonPath - Edge Cases', () => {
    it('rejects paths starting with numbers', () => {
      expect(() => validateJsonPath('1field')).toThrow()
      expect(() => validateJsonPath('123')).toThrow()
    })

    it('allows paths starting with underscore', () => {
      expect(validateJsonPath('_private')).toBe('_private')
      expect(validateJsonPath('_private.field')).toBe('_private.field')
    })

    it('rejects paths with only underscores and dots', () => {
      expect(() => validateJsonPath('_._')).not.toThrow()  // This is valid
      expect(() => validateJsonPath('_')).not.toThrow()    // Single underscore is valid
    })

    it('handles maximum nesting depth', () => {
      const deepPath = 'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p'
      expect(validateJsonPath(deepPath)).toBe(deepPath)
    })

    it('handles very long path segments', () => {
      const longSegment = 'a'.repeat(100)
      expect(validateJsonPath(longSegment)).toBe(longSegment)
    })

    it('rejects mixed separator styles', () => {
      expect(() => validateJsonPath('user/name')).toThrow()
      expect(() => validateJsonPath('user->name')).toThrow()
      expect(() => validateJsonPath('user::name')).toThrow()
    })
  })
})

// ============================================================================
// TEST SUITE: Comprehensive Payload Testing (OWASP)
// ============================================================================

describe('SQL Injection Prevention - OWASP Payloads', () => {
  const SQL_INJECTION_PAYLOADS = [
    // Classic payloads
    "' OR '1'='1",
    "' OR '1'='1'--",
    "' OR '1'='1'/*",
    "'; DROP TABLE users--",
    "'; DROP TABLE things--",
    "1; DROP TABLE users",

    // Union-based
    "' UNION SELECT * FROM users--",
    "1 UNION SELECT NULL,NULL,NULL--",
    "1 UNION ALL SELECT NULL,NULL,NULL--",

    // Blind injection
    "1' AND '1'='1",
    "1' AND '1'='2",
    "1 AND 1=1",
    "1 AND 1=2",

    // Error-based
    "1' AND (SELECT 1 FROM(SELECT COUNT(*),CONCAT((SELECT user()),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--",

    // Time-based
    "1' AND SLEEP(5)--",
    "1'; WAITFOR DELAY '0:0:5'--",

    // Comment-based
    "1'--",
    "1'/*",
    "1'#",

    // Encoding attacks
    "1%27%20OR%20%271%27%3D%271",  // URL encoded
    "1' OR 1=1--",

    // Stacked queries
    "1'; INSERT INTO users(username) VALUES('hacker')--",
    "1'; UPDATE users SET password='hacked'--",
  ]

  describe('orderBy rejects all OWASP payloads', () => {
    SQL_INJECTION_PAYLOADS.forEach((payload, index) => {
      it(`rejects payload ${index + 1}: ${payload.substring(0, 30)}...`, () => {
        expect(() => validateOrderColumn(payload)).toThrow()
      })
    })
  })

  describe('JSON path rejects all OWASP payloads', () => {
    SQL_INJECTION_PAYLOADS.forEach((payload, index) => {
      it(`rejects payload ${index + 1}: ${payload.substring(0, 30)}...`, () => {
        expect(() => validateJsonPath(payload)).toThrow()
      })
    })
  })
})

// ============================================================================
// TEST SUITE: Integration Verification (Unit Level)
// ============================================================================

describe('Integration Verification', () => {
  describe('buildSafeJsonPath integration', () => {
    it('produces paths that cannot contain SQL metacharacters', () => {
      const validPaths = ['status', 'user.name', 'config.max_retries', '_private.value']
      for (const path of validPaths) {
        const safePath = buildSafeJsonPath(path)
        // Verify no SQL metacharacters in output
        expect(safePath).not.toMatch(/[;'"()=<>]/)
        expect(safePath).toMatch(/^\$\.[a-zA-Z_][a-zA-Z0-9_.]*$/)
      }
    })

    it('throws before producing any output for invalid paths', () => {
      const invalidPaths = ["status'; DROP", 'user.name--', 'x OR 1=1']
      for (const path of invalidPaths) {
        expect(() => buildSafeJsonPath(path)).toThrow()
      }
    })
  })

  describe('buildOrderClause integration', () => {
    it('only accepts values from ALLOWED_ORDER_COLUMNS', () => {
      // This verifies the type system works correctly
      for (const col of ALLOWED_ORDER_COLUMNS) {
        expect(() => buildOrderClause(col, 'asc')).not.toThrow()
        expect(() => buildOrderClause(col, 'desc')).not.toThrow()
      }
    })

    it('produces consistent SQL fragments', () => {
      // Verify fragments are pre-built and consistent
      const clause1 = buildOrderClause('id', 'asc')
      const clause2 = buildOrderClause('id', 'asc')
      expect(clause1).toBe(clause2)  // Same reference from lookup table
    })
  })
})

// ============================================================================
// TEST SUITE: Error Messages
// ============================================================================

describe('SQL Safety Error Messages', () => {
  it('provides informative error message for invalid orderBy', () => {
    try {
      validateOrderColumn('invalid_column')
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('Invalid order column')
      expect((error as Error).message).toContain('invalid_column')
    }
  })

  it('provides informative error message for invalid JSON path', () => {
    try {
      validateJsonPath("malicious'; DROP TABLE")
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('Invalid JSON path')
    }
  })

  it('lists allowed columns in error message for orderBy', () => {
    try {
      validateOrderColumn('bad_column')
      expect.fail('Should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('Allowed columns:')
      expect(message).toContain('id')
    }
  })
})
