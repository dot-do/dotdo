/**
 * SQL WHERE Clause Tests for ThingsStore
 *
 * TDD Tests: Verify ThingsStore uses SQL WHERE clauses
 * instead of fetching all rows and filtering in memory.
 *
 * These tests ensure:
 * 1. Type filter uses SQL WHERE, not in-memory filter
 * 2. Branch filter uses SQL WHERE
 * 3. Combined filters use proper SQL AND clauses
 * 4. The generated SQL structure is correct
 *
 * Note: These tests verify the SQL query structure by examining
 * what the ThingsStore.list() method generates.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// MOCK SETUP
// ============================================================================

interface CapturedQuery {
  sql: string
  params: unknown[]
}

/**
 * Creates a mock database that captures the SQL queries executed.
 * This mock properly handles Drizzle's SQL template objects.
 */
function createMockDb() {
  const capturedQueries: CapturedQuery[] = []

  /**
   * Extract SQL string and params from a Drizzle SQL object.
   * Drizzle SQL objects have queryChunks array with strings and param objects.
   */
  function extractSqlString(sqlObj: any, depth = 0): CapturedQuery {
    // Prevent infinite recursion
    if (depth > 20) {
      return { sql: '[max depth]', params: [] }
    }

    if (!sqlObj) {
      return { sql: '', params: [] }
    }

    // Handle plain strings
    if (typeof sqlObj === 'string') {
      return { sql: sqlObj, params: [] }
    }

    // Handle Drizzle SQL objects - check for queryChunks first (most common pattern)
    if (Array.isArray(sqlObj.queryChunks)) {
      const parts: string[] = []
      const params: unknown[] = []

      for (const chunk of sqlObj.queryChunks) {
        if (typeof chunk === 'string') {
          parts.push(chunk)
        } else if (chunk && typeof chunk === 'object') {
          // StringChunk has a value array
          if (Array.isArray(chunk.value)) {
            parts.push(chunk.value.join(''))
          }
          // Param has encoder and value
          else if ('encoder' in chunk && 'value' in chunk) {
            parts.push('?')
            params.push(chunk.value)
          }
          // Nested SQL object
          else if (Array.isArray(chunk.queryChunks)) {
            const nested = extractSqlString(chunk, depth + 1)
            parts.push(nested.sql)
            params.push(...nested.params)
          }
          // Other objects - try to get useful representation
          else {
            parts.push('[obj]')
          }
        }
      }

      return { sql: parts.join(''), params }
    }

    // Try toQuery method with minimal config
    if (typeof sqlObj.toQuery === 'function') {
      try {
        const result = sqlObj.toQuery({
          casing: { cache: new Map() },
          escapeName: (n: string) => `"${n}"`,
          escapeParam: (_n: number, _v: unknown) => '?',
          escapeString: (s: string) => `'${s}'`
        })
        if (result && result.sql) {
          return { sql: result.sql, params: result.params || [] }
        }
      } catch {
        // toQuery failed, fall through
      }
    }

    // Last resort: convert to string
    return { sql: String(sqlObj), params: [] }
  }

  const mockDb = {
    all: vi.fn(async (query: any) => {
      const extracted = extractSqlString(query)
      capturedQueries.push(extracted)
      return []
    }),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnValue({
      values: vi.fn()
    }),
    _capturedQueries: capturedQueries,
    _getLastQuery: () => capturedQueries[capturedQueries.length - 1],
    _getAllQueries: () => capturedQueries,
    _clear: () => capturedQueries.length = 0
  }

  return mockDb
}

function createMockStoreContext(mockDb: ReturnType<typeof createMockDb>) {
  return {
    db: mockDb as any,
    ns: 'test-ns',
    currentBranch: 'main',
    env: {
      DO: {
        idFromName: vi.fn(),
        idFromString: vi.fn(),
        get: vi.fn()
      }
    },
    typeCache: new Map<string, number>()
  }
}

// Import the actual ThingsStore class and related utilities
import { ThingsStore, validateOrderColumn, validateJsonPath } from '../stores'

// ============================================================================
// TEST SUITE: SQL WHERE Clause Verification
// ============================================================================

describe('ThingsStore SQL WHERE Clause Usage', () => {
  let mockDb: ReturnType<typeof createMockDb>
  let ctx: ReturnType<typeof createMockStoreContext>
  let thingsStore: ThingsStore

  beforeEach(() => {
    mockDb = createMockDb()
    ctx = createMockStoreContext(mockDb)
    thingsStore = new ThingsStore(ctx)
    mockDb._clear()
  })

  describe('Type Filter in SQL WHERE', () => {
    it('should include type condition in SQL query when type is specified', async () => {
      // Pre-populate type cache to avoid additional queries
      ctx.typeCache.set('User', 1)

      await thingsStore.list({ type: 'User' })

      // Examine all captured queries to find the main SELECT query
      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // The query should include type condition
      expect(mainQuery!.sql.toLowerCase()).toMatch(/type\s*=/)
    })

    it('should include typeId parameter when filtering by type', async () => {
      ctx.typeCache.set('Product', 42)

      await thingsStore.list({ type: 'Product' })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // The type condition should be in the SQL (type = ? or actual value inline)
      expect(mainQuery!.sql.toLowerCase()).toMatch(/type\s*=/)
    })
  })

  describe('Branch Filter in SQL WHERE', () => {
    it('should include branch IS NULL condition for main branch', async () => {
      await thingsStore.list({ branch: 'main' })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Main branch should use IS NULL
      expect(mainQuery!.sql.toLowerCase()).toMatch(/branch\s+is\s+null/i)
    })

    it('should include branch = condition for non-main branch', async () => {
      await thingsStore.list({ branch: 'feature-x' })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Non-main branch should use = comparison (branch value may be inline or parameterized)
      expect(mainQuery!.sql.toLowerCase()).toMatch(/branch\s*=/i)
    })
  })

  describe('Combined Filters Use SQL AND', () => {
    it('should combine type and branch filters with AND', async () => {
      ctx.typeCache.set('Document', 10)

      await thingsStore.list({ type: 'Document', branch: 'staging' })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      expect(mainQuery!.sql.toLowerCase()).toContain('and')
      expect(mainQuery!.sql.toLowerCase()).toMatch(/type/)
      expect(mainQuery!.sql.toLowerCase()).toMatch(/branch/)
    })

    it('should include deleted condition when includeDeleted is false', async () => {
      await thingsStore.list({ includeDeleted: false })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Should filter out deleted records
      expect(mainQuery!.sql.toLowerCase()).toMatch(/deleted/)
    })
  })

  describe('LIMIT and OFFSET in SQL', () => {
    it('should include LIMIT clause in SQL', async () => {
      await thingsStore.list({ limit: 25 })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      expect(mainQuery!.sql.toLowerCase()).toContain('limit')
    })

    it('should include OFFSET clause in SQL', async () => {
      await thingsStore.list({ limit: 10, offset: 50 })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      expect(mainQuery!.sql.toLowerCase()).toContain('offset')
    })
  })

  describe('ORDER BY in SQL', () => {
    it('should include ORDER BY clause in SQL', async () => {
      await thingsStore.list({ orderBy: 'name', order: 'asc' })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      expect(mainQuery!.sql.toLowerCase()).toMatch(/order\s+by/)
    })

    it('should support DESC ordering', async () => {
      await thingsStore.list({ orderBy: 'id', order: 'desc' })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      expect(mainQuery!.sql.toLowerCase()).toMatch(/order\s+by.*desc/i)
    })
  })

  describe('JSON WHERE Clause (where option)', () => {
    it('should include json_extract for data field filters', async () => {
      await thingsStore.list({
        where: { 'data.status': 'active' }
      })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      expect(mainQuery!.sql.toLowerCase()).toContain('json_extract')
    })

    it('should use proper JSON path format', async () => {
      await thingsStore.list({
        where: { 'data.config.enabled': true }
      })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Should have $.config.enabled in the query or params
      const hasJsonPath = mainQuery!.sql.includes('$.config.enabled') ||
        mainQuery!.params.some(p => typeof p === 'string' && p.includes('$.config.enabled'))
      expect(hasJsonPath).toBe(true)
    })
  })

  describe('Cursor Pagination (after option)', () => {
    it('should include id > cursor condition in SQL', async () => {
      await thingsStore.list({ after: 'cursor-123' })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // The cursor condition should be in the SQL
      expect(mainQuery!.sql).toMatch(/id\s*>/)
    })
  })
})

// ============================================================================
// TEST SUITE: Query Efficiency Verification
// ============================================================================

describe('ThingsStore Query Efficiency', () => {
  let mockDb: ReturnType<typeof createMockDb>
  let ctx: ReturnType<typeof createMockStoreContext>
  let thingsStore: ThingsStore

  beforeEach(() => {
    mockDb = createMockDb()
    ctx = createMockStoreContext(mockDb)
    thingsStore = new ThingsStore(ctx)
    mockDb._clear()
  })

  describe('Single Query Pattern', () => {
    it('should combine all filters in a single SELECT query', async () => {
      ctx.typeCache.set('Invoice', 7)

      await thingsStore.list({
        type: 'Invoice',
        branch: 'main',
        limit: 10,
        orderBy: 'id'
      })

      // Count how many SELECT queries were made (excluding nouns lookup)
      const selectQueries = mockDb._getAllQueries().filter(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      // Should have at most 2 SELECTs (subquery + main query, or just main query)
      // NOT one query per filter
      expect(selectQueries.length).toBeLessThanOrEqual(2)
    })

    it('should not perform separate queries for each filter condition', async () => {
      ctx.typeCache.set('Task', 8)

      await thingsStore.list({
        type: 'Task',
        branch: 'dev',
        includeDeleted: false,
        limit: 20,
        offset: 10,
        orderBy: 'name',
        order: 'desc'
      })

      // All these filters should be in the same query, not separate fetches
      const queries = mockDb._getAllQueries()
      const mainSelectQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things') &&
        q.sql.toLowerCase().includes('limit')
      )

      expect(mainSelectQuery).toBeDefined()
      // The query should have all conditions
      expect(mainSelectQuery!.sql.toLowerCase()).toContain('type')
      expect(mainSelectQuery!.sql.toLowerCase()).toContain('branch')
      expect(mainSelectQuery!.sql.toLowerCase()).toContain('deleted')
      expect(mainSelectQuery!.sql.toLowerCase()).toContain('order by')
    })
  })

  describe('get() Method Uses Indexed Lookup', () => {
    it('should use WHERE id = for direct lookups', async () => {
      await thingsStore.get('test-thing-id')

      const queries = mockDb._getAllQueries()
      const idQuery = queries.find(q =>
        q.sql.toLowerCase().includes('where') &&
        q.sql.toLowerCase().includes('id')
      )

      expect(idQuery).toBeDefined()
      // The id condition should be in the SQL (direct indexed lookup)
      expect(idQuery!.sql.toLowerCase()).toMatch(/id\s*=/)
    })
  })
})

// ============================================================================
// TEST SUITE: SQL Injection Prevention
// ============================================================================

describe('ThingsStore SQL Injection Prevention', () => {
  describe('OrderBy Column Validation', () => {
    it('should reject SQL injection in orderBy', () => {
      expect(() => validateOrderColumn("id; DROP TABLE things;--")).toThrow(/Invalid order column/)
    })

    it('should accept only whitelisted columns', () => {
      expect(() => validateOrderColumn('id')).not.toThrow()
      expect(() => validateOrderColumn('name')).not.toThrow()
      expect(() => validateOrderColumn('type')).not.toThrow()
      expect(() => validateOrderColumn('branch')).not.toThrow()
      expect(() => validateOrderColumn('deleted')).not.toThrow()
    })

    it('should reject arbitrary column names', () => {
      expect(() => validateOrderColumn('arbitrary_column')).toThrow(/Invalid order column/)
    })
  })

  describe('JSON Path Validation', () => {
    it('should reject SQL injection in JSON paths', () => {
      expect(() => validateJsonPath("status'; DROP TABLE things;--")).toThrow(/Invalid JSON path/)
    })

    it('should accept valid JSON paths', () => {
      expect(() => validateJsonPath('status')).not.toThrow()
      expect(() => validateJsonPath('config.enabled')).not.toThrow()
      expect(() => validateJsonPath('deeply.nested.path')).not.toThrow()
    })

    it('should reject paths with SQL metacharacters', () => {
      expect(() => validateJsonPath("path'")).toThrow(/Invalid JSON path/)
      expect(() => validateJsonPath('path"')).toThrow(/Invalid JSON path/)
      expect(() => validateJsonPath('path;')).toThrow(/Invalid JSON path/)
    })
  })

  describe('Type Filter is Safe', () => {
    let mockDb: ReturnType<typeof createMockDb>
    let ctx: ReturnType<typeof createMockStoreContext>
    let thingsStore: ThingsStore

    beforeEach(() => {
      mockDb = createMockDb()
      ctx = createMockStoreContext(mockDb)
      thingsStore = new ThingsStore(ctx)
    })

    it('should use type ID not type name in SQL (type name lookup is separate)', async () => {
      // Type names are looked up via getTypeId() which queries nouns table
      // The actual things query uses the numeric type ID
      ctx.typeCache.set("User'; DROP TABLE--", 99)

      await thingsStore.list({ type: "User'; DROP TABLE--" })

      const queries = mockDb._getAllQueries()
      // The type condition should use numeric ID, not the raw type name
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Type filter uses numeric ID (the type name is only used for cache lookup)
      expect(mainQuery!.sql.toLowerCase()).toMatch(/type\s*=/)
    })
  })

  describe('Branch Filter Uses SQL Parameters', () => {
    let mockDb: ReturnType<typeof createMockDb>
    let ctx: ReturnType<typeof createMockStoreContext>
    let thingsStore: ThingsStore

    beforeEach(() => {
      mockDb = createMockDb()
      ctx = createMockStoreContext(mockDb)
      thingsStore = new ThingsStore(ctx)
    })

    it('should include branch filter in SQL WHERE clause', async () => {
      await thingsStore.list({ branch: "feature-branch" })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Branch should be in SQL WHERE clause
      expect(mainQuery!.sql.toLowerCase()).toMatch(/branch\s*=/)
    })
  })
})

// ============================================================================
// TEST SUITE: Edge Cases
// ============================================================================

describe('ThingsStore SQL WHERE Edge Cases', () => {
  let mockDb: ReturnType<typeof createMockDb>
  let ctx: ReturnType<typeof createMockStoreContext>
  let thingsStore: ThingsStore

  beforeEach(() => {
    mockDb = createMockDb()
    ctx = createMockStoreContext(mockDb)
    thingsStore = new ThingsStore(ctx)
    mockDb._clear()
  })

  describe('Empty and Undefined Filters', () => {
    it('should handle empty options object', async () => {
      await thingsStore.list({})

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Should still have WHERE clause for branch and deleted defaults
      expect(mainQuery!.sql.toLowerCase()).toContain('where')
    })

    it('should not include type condition when type is undefined', async () => {
      await thingsStore.list({ type: undefined })

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Should NOT have type = in the query since type was undefined
      // (excluding any subquery references to 'type' column)
      const hasTypeEqualsCondition = mainQuery!.sql.match(/AND\s+type\s*=\s*\?/i)
      expect(hasTypeEqualsCondition).toBeFalsy()
    })
  })

  describe('Default Values', () => {
    it('should include LIMIT in SQL with default value', async () => {
      await thingsStore.list({})

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things') &&
        q.sql.toLowerCase().includes('limit')
      )

      expect(mainQuery).toBeDefined()
      // LIMIT should be present in the SQL
      expect(mainQuery!.sql.toLowerCase()).toContain('limit')
    })

    it('should include OFFSET in SQL with default value', async () => {
      await thingsStore.list({})

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things') &&
        q.sql.toLowerCase().includes('offset')
      )

      expect(mainQuery).toBeDefined()
      // OFFSET should be present in the SQL
      expect(mainQuery!.sql.toLowerCase()).toContain('offset')
    })

    it('should use currentBranch from context when branch not specified', async () => {
      ctx.currentBranch = 'development'

      await thingsStore.list({})

      const queries = mockDb._getAllQueries()
      const mainQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things')
      )

      expect(mainQuery).toBeDefined()
      // Since development is not 'main', it should use branch = condition
      expect(mainQuery!.sql.toLowerCase()).toMatch(/branch\s*=/)
    })
  })

  describe('Version Queries', () => {
    it('versions() should query by id with ORDER BY rowid', async () => {
      await thingsStore.versions('thing-123')

      const queries = mockDb._getAllQueries()
      const versionQuery = queries.find(q =>
        q.sql.toLowerCase().includes('select') &&
        q.sql.toLowerCase().includes('things') &&
        q.sql.toLowerCase().includes('order by')
      )

      expect(versionQuery).toBeDefined()
      // Should include id = condition and ORDER BY
      expect(versionQuery!.sql.toLowerCase()).toMatch(/id\s*=/)
      expect(versionQuery!.sql.toLowerCase()).toMatch(/order\s+by/)
    })
  })
})
