/**
 * SQL Injection Security Tests for MCP Search Tool
 *
 * RED Phase: These tests verify that SQL injection payloads are properly handled.
 * Tests should FAIL initially to demonstrate the vulnerability.
 *
 * Security Issue: do-9zv [SEC-2] SQL injection in MCP search FTS5
 *
 * @module tests/security/sql-injection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  searchTool,
  type SearchEnv,
  type SearchToolProps,
} from '../../mcp/tools/search'

// =============================================================================
// TEST INFRASTRUCTURE
// =============================================================================

/**
 * SQL execution tracker to detect injection attempts
 */
interface SQLExecutionRecord {
  query: string
  params: unknown[]
  timestamp: number
}

/**
 * Create a mock SQL environment that tracks all executions
 * and can detect SQL injection patterns
 */
function createSecurityTestSQL() {
  const executions: SQLExecutionRecord[] = []
  const things: Array<{ id: string; type: string; data: string; namespace?: string }> = []

  // Seed some test data
  things.push(
    { id: 'user-1', type: 'User', data: JSON.stringify({ name: 'Alice', email: 'alice@test.com' }) },
    { id: 'user-2', type: 'User', data: JSON.stringify({ name: 'Bob', email: 'bob@test.com' }) },
    { id: 'secret-1', type: 'Secret', data: JSON.stringify({ apiKey: 'sk-secret-key-12345' }) },
  )

  return {
    exec: vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
      // Record execution for security analysis
      executions.push({
        query,
        params: [...params],
        timestamp: Date.now(),
      })

      // Simulate FTS query failing (to trigger fallback)
      if (query.includes('things_fts') && query.includes('MATCH')) {
        throw new Error('FTS table not found')
      }

      // Simulate LIKE-based search
      if (query.includes('SELECT') && query.includes('LIKE')) {
        const searchTerm = (params[0] as string).replace(/%/g, '')
        const limit = params[params.length - 2] as number
        const offset = params[params.length - 1] as number
        const filtered = things.filter((t) => t.data.toLowerCase().includes(searchTerm.toLowerCase()))
        return {
          toArray: () =>
            filtered.slice(offset, offset + limit).map((t) => ({
              id: t.id,
              $type: t.type,
              data: t.data,
            })),
        }
      }

      return { toArray: () => [] }
    }),
    _executions: executions,
    _things: things,

    /**
     * Check if any SQL injection payload made it into executed queries
     */
    hasInjectionAttempt(): boolean {
      const injectionPatterns = [
        /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE)/i,
        /--\s*$/m,
        /UNION\s+SELECT/i,
        /OR\s+1\s*=\s*1/i,
        /'\s*OR\s+'/i,
        /;\s*--/,
      ]

      for (const exec of executions) {
        const fullQuery = exec.query + ' ' + exec.params.join(' ')
        for (const pattern of injectionPatterns) {
          if (pattern.test(fullQuery)) {
            return true
          }
        }
      }
      return false
    },

    /**
     * Get all parameters that contained unescaped injection payloads
     */
    getUnescapedPayloads(): string[] {
      const dangerous: string[] = []
      const dangerousChars = [';', '--', "'", '"', '\\']

      for (const exec of executions) {
        for (const param of exec.params) {
          if (typeof param === 'string') {
            // Check if dangerous characters made it through unescaped
            for (const char of dangerousChars) {
              if (param.includes(char) && !param.startsWith('%')) {
                // The %...% wrapper is expected for LIKE queries
                dangerous.push(param)
                break
              }
            }
          }
        }
      }
      return dangerous
    },
  }
}

/**
 * Create mock AI environment
 */
function createMockAI() {
  return {
    run: vi.fn().mockResolvedValue({
      data: [[0.1, 0.2, 0.3, 0.4, 0.5]],
    }),
  }
}

/**
 * Create mock Vectorize environment
 */
function createMockVectorize() {
  return {
    query: vi.fn().mockResolvedValue({ matches: [] }),
    insert: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * Create full test environment
 */
function createTestEnv() {
  return {
    AI: createMockAI(),
    VECTORIZE: createMockVectorize(),
    sql: createSecurityTestSQL(),
  }
}

function createTestProps(): SearchToolProps {
  return {
    permissions: ['search'],
    namespace: 'test',
  }
}

// =============================================================================
// SQL INJECTION PAYLOAD TESTS
// =============================================================================

describe('SQL Injection Security Tests', () => {
  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()
  })

  describe('Classic SQL Injection Payloads', () => {
    it('should reject DROP TABLE injection attempt', async () => {
      const maliciousQuery = "'; DROP TABLE things; --"

      await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)

      // The SQL execution should use parameterized queries
      // so injection payloads should NOT appear in the raw query
      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should reject DELETE injection attempt', async () => {
      const maliciousQuery = "\\'; DELETE FROM events; --"

      await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should reject OR 1=1 tautology attack', async () => {
      const maliciousQuery = '" OR 1=1 --'

      await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should reject UNION SELECT data exfiltration', async () => {
      const maliciousQuery = "' UNION SELECT id, data, type FROM secrets --"

      await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should reject stacked queries injection', async () => {
      const maliciousQuery = "test'; INSERT INTO things VALUES ('hack', 'Hacked', '{}'); --"

      await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })
  })

  describe('FTS5-Specific Injection Payloads', () => {
    it('should sanitize FTS5 MATCH operator injection', async () => {
      // FTS5 allows complex expressions in MATCH
      const maliciousQuery = 'test" OR "1"="1'

      await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)

      // Should not contain unescaped quotes in the MATCH parameter
      const unescaped = env.sql.getUnescapedPayloads()
      expect(unescaped.length).toBe(0)
    })

    it('should handle FTS5 phrase injection', async () => {
      const maliciousQuery = '"{test}" NOT "{safe}"'

      await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should sanitize FTS5 column filter injection', async () => {
      // FTS5 column filters: column:term
      const maliciousQuery = 'content:* OR type:Secret'

      await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)

      // The query should be sanitized to prevent accessing unintended columns
      const unescaped = env.sql.getUnescapedPayloads()
      expect(unescaped.length).toBe(0)
    })
  })

  describe('Parameter Sanitization', () => {
    it('should escape single quotes in search terms', async () => {
      const queryWithQuotes = "O'Brien's test"

      await searchTool({ query: queryWithQuotes, type: 'keyword' }, env, props)

      // Single quotes should be escaped or handled via parameterized queries
      const unescaped = env.sql.getUnescapedPayloads()
      const hasUnescapedQuote = unescaped.some((p) => p.includes("'") && !p.includes("\\'"))
      expect(hasUnescapedQuote).toBe(false)
    })

    it('should escape double quotes in search terms', async () => {
      const queryWithQuotes = 'search for "exact phrase"'

      await searchTool({ query: queryWithQuotes, type: 'keyword' }, env, props)

      const unescaped = env.sql.getUnescapedPayloads()
      const hasUnescapedDoubleQuote = unescaped.some((p) => p.includes('"') && !p.includes('\\"'))
      expect(hasUnescapedDoubleQuote).toBe(false)
    })

    it('should escape backslashes in search terms', async () => {
      const queryWithBackslash = 'path\\to\\file'

      await searchTool({ query: queryWithBackslash, type: 'keyword' }, env, props)

      const unescaped = env.sql.getUnescapedPayloads()
      expect(unescaped.length).toBe(0)
    })

    it('should escape semicolons in search terms', async () => {
      const queryWithSemicolon = 'test; malicious'

      await searchTool({ query: queryWithSemicolon, type: 'keyword' }, env, props)

      const unescaped = env.sql.getUnescapedPayloads()
      const hasUnescapedSemicolon = unescaped.some((p) => p.includes(';'))
      expect(hasUnescapedSemicolon).toBe(false)
    })

    it('should escape comment markers (--) in search terms', async () => {
      const queryWithComment = 'test -- this is a comment'

      await searchTool({ query: queryWithComment, type: 'keyword' }, env, props)

      const unescaped = env.sql.getUnescapedPayloads()
      const hasCommentMarker = unescaped.some((p) => p.includes('--'))
      expect(hasCommentMarker).toBe(false)
    })
  })

  describe('Filter Parameter Injection', () => {
    it('should sanitize $type filter for injection', async () => {
      const maliciousType = "'; DROP TABLE things; --"

      await searchTool(
        {
          query: 'test',
          type: 'keyword',
          filters: { $type: maliciousType },
        },
        env,
        props
      )

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should sanitize namespace filter for injection', async () => {
      const maliciousNamespace = "admin' OR '1'='1"

      await searchTool(
        {
          query: 'test',
          type: 'keyword',
          filters: { namespace: maliciousNamespace },
        },
        env,
        props
      )

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should sanitize date range filters for injection', async () => {
      const maliciousDate = "2026-01-01'; DROP TABLE things; --"

      await searchTool(
        {
          query: 'test',
          type: 'keyword',
          filters: {
            dateRange: {
              from: maliciousDate,
              to: '2026-12-31',
            },
          },
        },
        env,
        props
      )

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })
  })

  describe('Parameterized Query Verification', () => {
    it('should use parameterized queries for all user input', async () => {
      await searchTool({ query: 'test query', type: 'keyword' }, env, props)

      // Verify all SQL executions used parameter binding
      for (const exec of env.sql._executions) {
        // User input should be in params, not interpolated into query
        expect(exec.query).not.toContain('test query')
        // Should have params (at minimum: search term, limit, offset)
        expect(exec.params.length).toBeGreaterThan(0)
      }
    })

    it('should not interpolate user input directly into SQL', async () => {
      const userInput = 'user-provided-search-term'

      await searchTool({ query: userInput, type: 'keyword' }, env, props)

      // The raw user input should never appear in the query string itself
      for (const exec of env.sql._executions) {
        expect(exec.query).not.toContain(userInput)
      }
    })

    it('should use placeholders (?) for all dynamic values', async () => {
      await searchTool(
        {
          query: 'search',
          type: 'keyword',
          filters: { $type: 'Customer', namespace: 'prod' },
        },
        env,
        props
      )

      // All filter values should be passed as parameters, not in query
      for (const exec of env.sql._executions) {
        expect(exec.query).not.toContain("'Customer'")
        expect(exec.query).not.toContain("'prod'")
        // Query should contain ? placeholders instead
        const placeholderCount = (exec.query.match(/\?/g) || []).length
        expect(placeholderCount).toBeGreaterThanOrEqual(exec.params.length)
      }
    })
  })

  describe('Boundary Conditions', () => {
    it('should handle null bytes in query', async () => {
      const queryWithNull = 'test\x00DROP TABLE things'

      // Should not throw and should sanitize null bytes
      const result = await searchTool({ query: queryWithNull, type: 'keyword' }, env, props)

      expect(result).toBeDefined()
      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should handle unicode escape sequences', async () => {
      // Unicode encoded semicolon: \u003B = ;
      const queryWithUnicode = 'test\u003BDROP TABLE things'

      await searchTool({ query: queryWithUnicode, type: 'keyword' }, env, props)

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should handle extremely long injection payloads', async () => {
      const longPayload = "'; ".repeat(1000) + 'DROP TABLE things; --'

      await searchTool({ query: longPayload, type: 'keyword' }, env, props)

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })

    it('should handle mixed encoding injection attempts', async () => {
      // Mix of URL encoding, unicode, and raw chars
      const mixedQuery = "test%27%20OR%201=1\u0027; DROP TABLE things"

      await searchTool({ query: mixedQuery, type: 'keyword' }, env, props)

      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })
  })

  describe('Hybrid Search Injection Protection', () => {
    it('should sanitize injection in hybrid mode (both search paths)', async () => {
      const maliciousQuery = "'; DROP TABLE things; --"

      await searchTool({ query: maliciousQuery, type: 'hybrid' }, env, props)

      // Both keyword and semantic paths should be protected
      expect(env.sql.hasInjectionAttempt()).toBe(false)
    })
  })

  describe('Error Handling Security', () => {
    it('should not leak SQL structure in error messages', async () => {
      const maliciousQuery = 'test" syntax error here'

      try {
        await searchTool({ query: maliciousQuery, type: 'keyword' }, env, props)
      } catch (error: unknown) {
        if (error instanceof Error) {
          // Error message should not reveal SQL structure
          expect(error.message).not.toMatch(/SELECT|FROM|WHERE|TABLE/i)
        }
      }
    })
  })
})

// =============================================================================
// ESCAPE FUNCTION UNIT TESTS
// =============================================================================

describe('escapeSearchQuery Function Security', () => {
  // Note: We cannot directly import escapeSearchQuery as it's not exported
  // These tests verify the escaping behavior through searchTool

  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()
  })

  it('should strip or escape all FTS5 special characters', async () => {
    // FTS5 special chars: " * () ^ ~ - + : AND OR NOT NEAR
    const fts5SpecialChars = '""test* (group) ^boost ~negate -exclude +include : AND OR NOT NEAR'

    await searchTool({ query: fts5SpecialChars, type: 'keyword' }, env, props)

    // None of these special operators should reach the SQL unescaped
    // in a way that changes query semantics
    expect(env.sql.hasInjectionAttempt()).toBe(false)
  })

  it('should handle nested quote escaping', async () => {
    const nestedQuotes = 'test "with \'nested\' quotes" inside'

    await searchTool({ query: nestedQuotes, type: 'keyword' }, env, props)

    const unescaped = env.sql.getUnescapedPayloads()
    expect(unescaped.length).toBe(0)
  })

  it('should not allow query rewriting via operators', async () => {
    // Try to inject OR conditions
    const operatorInjection = 'test" OR "1"="1'

    await searchTool({ query: operatorInjection, type: 'keyword' }, env, props)

    expect(env.sql.hasInjectionAttempt()).toBe(false)
  })
})
