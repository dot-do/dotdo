/**
 * RED Phase Tests for ClickHouse Visibility Filtering
 *
 * These tests verify visibility-based access control for ClickHouse queries.
 * They are expected to FAIL until visibility support is implemented.
 *
 * Related issues:
 * - dotdo-xpbh: [Red] ClickHouse visibility tests
 *
 * Implementation requirements:
 * - Anonymous client can only query public visibility
 * - buildGetUrl includes visibility filter
 * - COMMON_QUERIES include visibility parameter
 * - Cache keys include visibility context
 * - Query helpers accept visibility filter
 *
 * Visibility levels:
 * - public: Accessible by anyone, including anonymous users
 * - protected: Accessible by authenticated users in the same org
 * - private: Accessible only by the owner
 *
 * @see db/clickhouse.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// Types (Expected)
// ============================================================================

/**
 * Visibility levels for data access control
 */
type Visibility = 'public' | 'protected' | 'private'

/**
 * User context for visibility checks
 */
interface VisibilityContext {
  /** Whether the user is authenticated */
  isAuthenticated: boolean
  /** User ID (if authenticated) */
  userId?: string
  /** Organization ID (if authenticated) */
  orgId?: string
  /** Whether user has admin privileges */
  isAdmin?: boolean
}

/**
 * Query options with visibility support
 */
interface VisibilityQueryOptions {
  /** Visibility filter - restricts results to matching visibility levels */
  visibility?: Visibility | Visibility[]
  /** Context for visibility checks */
  context?: VisibilityContext
}

/**
 * Expected exports from db/clickhouse.ts with visibility support
 */
interface ClickHouseVisibilityExports {
  /** Create anonymous client that only queries public data */
  createAnonymousClient: (config: unknown) => unknown
  /** Build GET URL with visibility filter */
  buildGetUrl: (options: BuildGetUrlOptions) => string
  /** Query with visibility filter */
  queryWithVisibility: <T>(
    client: unknown,
    options: QueryOptionsWithVisibility
  ) => Promise<{ data: T[] }>
  /** Visibility-aware cache */
  ClickHouseVisibilityCache: new (options: unknown) => VisibilityCache
  /** Common queries with visibility parameter */
  COMMON_QUERIES: CommonQueriesWithVisibility
}

interface BuildGetUrlOptions {
  baseUrl: string
  sql: string
  params?: Record<string, unknown>
  format?: string
  database?: string
  settings?: Record<string, string | number>
  visibility?: Visibility | Visibility[]
  context?: VisibilityContext
}

interface QueryOptionsWithVisibility {
  sql: string
  params?: Record<string, unknown>
  visibility?: Visibility | Visibility[]
  context?: VisibilityContext
}

interface VisibilityCache {
  query<T>(options: {
    sql: string
    params?: Record<string, unknown>
    visibility?: Visibility | Visibility[]
    context?: VisibilityContext
    cache?: { ttl: number; swr: number }
  }): Promise<{ data: T[]; cached: boolean }>
  getCacheKey(sql: string, params?: Record<string, unknown>, visibility?: Visibility | Visibility[]): string
}

interface CommonQueriesWithVisibility {
  /** List items with visibility filter */
  LIST_WITH_VISIBILITY: string
  /** Count items with visibility filter */
  COUNT_WITH_VISIBILITY: string
  /** Get by ID with visibility check */
  GET_BY_ID_WITH_VISIBILITY: string
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exports exist
// ============================================================================

let createAnonymousClient: ClickHouseVisibilityExports['createAnonymousClient'] | undefined
let buildGetUrl: ClickHouseVisibilityExports['buildGetUrl'] | undefined
let queryWithVisibility: ClickHouseVisibilityExports['queryWithVisibility'] | undefined
let ClickHouseVisibilityCache: ClickHouseVisibilityExports['ClickHouseVisibilityCache'] | undefined
let COMMON_QUERIES: ClickHouseVisibilityExports['COMMON_QUERIES'] | undefined

try {
  // @ts-expect-error - Visibility exports not yet implemented
  const module = await import('../../db/clickhouse')
  createAnonymousClient = module.createAnonymousClient
  buildGetUrl = module.buildGetUrl
  // @ts-expect-error - These exports don't exist yet
  queryWithVisibility = module.queryWithVisibility
  // @ts-expect-error - These exports don't exist yet
  ClickHouseVisibilityCache = module.ClickHouseVisibilityCache
  // @ts-expect-error - These exports don't exist yet
  COMMON_QUERIES = module.COMMON_QUERIES
} catch {
  // Module doesn't exist or exports are missing - tests will fail as expected (RED phase)
}

// ============================================================================
// Helper Functions
// ============================================================================

function createMockClient() {
  return {
    query: vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
      query_id: 'mock-query-id',
    }),
    command: vi.fn().mockResolvedValue({ query_id: 'mock-command-id' }),
    ping: vi.fn().mockResolvedValue({ success: true }),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createAnonymousContext(): VisibilityContext {
  return {
    isAuthenticated: false,
  }
}

function createAuthenticatedContext(userId: string, orgId: string): VisibilityContext {
  return {
    isAuthenticated: true,
    userId,
    orgId,
  }
}

function createAdminContext(userId: string, orgId: string): VisibilityContext {
  return {
    isAuthenticated: true,
    userId,
    orgId,
    isAdmin: true,
  }
}

// ============================================================================
// 1. Anonymous Client Visibility Tests
// ============================================================================

describe('Anonymous client visibility restrictions', () => {
  it('createAnonymousClient is exported from db/clickhouse', () => {
    expect(createAnonymousClient).toBeDefined()
    expect(typeof createAnonymousClient).toBe('function')
  })

  it('anonymous client only queries public visibility by default', () => {
    const client = createAnonymousClient!({
      url: 'https://clickhouse.example.com:8443',
      database: 'default',
    })

    // The client should have visibility restricted to public
    // @ts-expect-error - Checking internal visibility property
    expect(client.defaultVisibility).toBe('public')
  })

  it('anonymous client rejects queries for protected visibility', async () => {
    const client = createAnonymousClient!({
      url: 'https://clickhouse.example.com:8443',
    })

    // Attempting to query protected data should throw
    await expect(
      // @ts-expect-error - queryWithVisibility method expected on client
      client.queryWithVisibility({
        sql: 'SELECT * FROM items',
        visibility: 'protected',
      })
    ).rejects.toThrow(/visibility/)
  })

  it('anonymous client rejects queries for private visibility', async () => {
    const client = createAnonymousClient!({
      url: 'https://clickhouse.example.com:8443',
    })

    await expect(
      // @ts-expect-error - queryWithVisibility method expected on client
      client.queryWithVisibility({
        sql: 'SELECT * FROM items',
        visibility: 'private',
      })
    ).rejects.toThrow(/visibility/)
  })

  it('anonymous client adds visibility=public filter to all queries', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
      query_id: 'mock-id',
    })

    const client = createAnonymousClient!({
      url: 'https://clickhouse.example.com:8443',
    })

    // @ts-expect-error - Inject mock query function
    client.query = mockQuery

    // @ts-expect-error - Call queryWithVisibility
    await client.queryWithVisibility({
      sql: 'SELECT * FROM items WHERE tenant_id = {tenant_id:String}',
      params: { tenant_id: 'test-tenant' },
    })

    // The actual query should include visibility filter
    const calledWith = mockQuery.mock.calls[0][0]
    expect(calledWith.query).toContain('visibility')
    expect(calledWith.query).toContain('public')
  })
})

// ============================================================================
// 2. buildGetUrl Visibility Filter Tests
// ============================================================================

describe('buildGetUrl includes visibility filter', () => {
  it('buildGetUrl is exported from db/clickhouse', () => {
    expect(buildGetUrl).toBeDefined()
    expect(typeof buildGetUrl).toBe('function')
  })

  it('adds visibility parameter to URL when specified', () => {
    const url = buildGetUrl!({
      baseUrl: 'https://clickhouse.example.com:8443',
      sql: 'SELECT * FROM items',
      visibility: 'public',
    })

    // URL should include visibility in the query
    expect(url).toContain('visibility')
    expect(url).toContain('public')
  })

  it('adds multiple visibility levels to URL when array is specified', () => {
    const url = buildGetUrl!({
      baseUrl: 'https://clickhouse.example.com:8443',
      sql: 'SELECT * FROM items',
      visibility: ['public', 'protected'],
    })

    // URL should include both visibility levels
    expect(url).toContain('public')
    expect(url).toContain('protected')
  })

  it('includes context user ID for private visibility', () => {
    const url = buildGetUrl!({
      baseUrl: 'https://clickhouse.example.com:8443',
      sql: 'SELECT * FROM items',
      visibility: 'private',
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    // URL should include user filter for private visibility
    expect(url).toContain('user-123')
  })

  it('includes context org ID for protected visibility', () => {
    const url = buildGetUrl!({
      baseUrl: 'https://clickhouse.example.com:8443',
      sql: 'SELECT * FROM items',
      visibility: 'protected',
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    // URL should include org filter for protected visibility
    expect(url).toContain('org-456')
  })

  it('throws error when private visibility requested without context', () => {
    expect(() =>
      buildGetUrl!({
        baseUrl: 'https://clickhouse.example.com:8443',
        sql: 'SELECT * FROM items',
        visibility: 'private',
      })
    ).toThrow(/context required/i)
  })

  it('throws error when protected visibility requested without org context', () => {
    expect(() =>
      buildGetUrl!({
        baseUrl: 'https://clickhouse.example.com:8443',
        sql: 'SELECT * FROM items',
        visibility: 'protected',
        context: { isAuthenticated: true, userId: 'user-123' },
      })
    ).toThrow(/org.*required/i)
  })

  it('defaults to public visibility when no visibility specified for anonymous context', () => {
    const url = buildGetUrl!({
      baseUrl: 'https://clickhouse.example.com:8443',
      sql: 'SELECT * FROM items',
      context: createAnonymousContext(),
    })

    // Should default to public visibility
    expect(url).toContain('public')
  })
})

// ============================================================================
// 3. COMMON_QUERIES Visibility Tests
// ============================================================================

describe('COMMON_QUERIES include visibility parameter', () => {
  it('COMMON_QUERIES is exported from db/clickhouse', () => {
    expect(COMMON_QUERIES).toBeDefined()
    expect(typeof COMMON_QUERIES).toBe('object')
  })

  it('LIST_WITH_VISIBILITY query includes visibility parameter', () => {
    expect(COMMON_QUERIES!.LIST_WITH_VISIBILITY).toBeDefined()
    expect(COMMON_QUERIES!.LIST_WITH_VISIBILITY).toContain('{visibility:String}')
  })

  it('COUNT_WITH_VISIBILITY query includes visibility parameter', () => {
    expect(COMMON_QUERIES!.COUNT_WITH_VISIBILITY).toBeDefined()
    expect(COMMON_QUERIES!.COUNT_WITH_VISIBILITY).toContain('{visibility:String}')
  })

  it('GET_BY_ID_WITH_VISIBILITY query includes visibility parameter', () => {
    expect(COMMON_QUERIES!.GET_BY_ID_WITH_VISIBILITY).toBeDefined()
    expect(COMMON_QUERIES!.GET_BY_ID_WITH_VISIBILITY).toContain('{visibility:String}')
  })

  it('LIST_WITH_VISIBILITY supports array of visibility levels', () => {
    // Query should support IN clause for multiple visibility levels
    expect(COMMON_QUERIES!.LIST_WITH_VISIBILITY).toMatch(
      /visibility\s+IN|{visibility:Array/i
    )
  })
})

// ============================================================================
// 4. Cache Keys Include Visibility Context Tests
// ============================================================================

describe('Cache keys include visibility context', () => {
  let cache: VisibilityCache

  beforeEach(() => {
    // @ts-expect-error - Constructor not yet implemented
    cache = new ClickHouseVisibilityCache!({
      baseUrl: 'https://clickhouse.example.com:8443',
      database: 'default',
    })
  })

  it('ClickHouseVisibilityCache is exported from db/clickhouse', () => {
    expect(ClickHouseVisibilityCache).toBeDefined()
    expect(typeof ClickHouseVisibilityCache).toBe('function')
  })

  it('cache key includes visibility when specified', () => {
    const key1 = cache.getCacheKey('SELECT * FROM items', {}, 'public')
    const key2 = cache.getCacheKey('SELECT * FROM items', {}, 'protected')

    // Keys should be different for different visibility levels
    expect(key1).not.toBe(key2)
  })

  it('cache key includes all visibility levels when array is specified', () => {
    const key1 = cache.getCacheKey('SELECT * FROM items', {}, ['public'])
    const key2 = cache.getCacheKey('SELECT * FROM items', {}, ['public', 'protected'])

    // Keys should be different
    expect(key1).not.toBe(key2)
  })

  it('cache key is deterministic for same visibility', () => {
    const key1 = cache.getCacheKey('SELECT * FROM items', { id: '123' }, 'public')
    const key2 = cache.getCacheKey('SELECT * FROM items', { id: '123' }, 'public')

    expect(key1).toBe(key2)
  })

  it('cache key includes sorted visibility array for consistency', () => {
    const key1 = cache.getCacheKey('SELECT * FROM items', {}, ['protected', 'public'])
    const key2 = cache.getCacheKey('SELECT * FROM items', {}, ['public', 'protected'])

    // Order shouldn't matter - keys should be the same
    expect(key1).toBe(key2)
  })

  it('cached query respects visibility', async () => {
    const publicResult = await cache.query({
      sql: 'SELECT * FROM items',
      visibility: 'public',
    })

    const protectedResult = await cache.query({
      sql: 'SELECT * FROM items',
      visibility: 'protected',
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    // Results may differ based on visibility
    expect(publicResult).toBeDefined()
    expect(protectedResult).toBeDefined()
  })

  it('different users get different cache keys for private visibility', () => {
    // @ts-expect-error - getCacheKeyWithContext not yet implemented
    const key1 = cache.getCacheKeyWithContext(
      'SELECT * FROM items',
      {},
      'private',
      createAuthenticatedContext('user-1', 'org-1')
    )
    // @ts-expect-error - getCacheKeyWithContext not yet implemented
    const key2 = cache.getCacheKeyWithContext(
      'SELECT * FROM items',
      {},
      'private',
      createAuthenticatedContext('user-2', 'org-1')
    )

    expect(key1).not.toBe(key2)
  })

  it('same org users share cache key for protected visibility', () => {
    // @ts-expect-error - getCacheKeyWithContext not yet implemented
    const key1 = cache.getCacheKeyWithContext(
      'SELECT * FROM items',
      {},
      'protected',
      createAuthenticatedContext('user-1', 'org-shared')
    )
    // @ts-expect-error - getCacheKeyWithContext not yet implemented
    const key2 = cache.getCacheKeyWithContext(
      'SELECT * FROM items',
      {},
      'protected',
      createAuthenticatedContext('user-2', 'org-shared')
    )

    expect(key1).toBe(key2)
  })
})

// ============================================================================
// 5. Query Helpers Accept Visibility Filter Tests
// ============================================================================

describe('Query helpers accept visibility filter', () => {
  it('queryWithVisibility is exported from db/clickhouse', () => {
    expect(queryWithVisibility).toBeDefined()
    expect(typeof queryWithVisibility).toBe('function')
  })

  it('queryWithVisibility accepts visibility parameter', async () => {
    const client = createMockClient()

    const result = await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items WHERE tenant_id = {tenant_id:String}',
      params: { tenant_id: 'test-tenant' },
      visibility: 'public',
    })

    expect(result.data).toBeDefined()
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('queryWithVisibility injects visibility filter into SQL', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: 'public',
    })

    // Check that query was modified to include visibility filter
    const calledQuery = client.query.mock.calls[0][0].query
    expect(calledQuery).toContain('visibility')
  })

  it('queryWithVisibility adds visibility to WHERE clause', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items WHERE status = {status:String}',
      params: { status: 'active' },
      visibility: 'public',
    })

    const calledQuery = client.query.mock.calls[0][0].query
    // Should add AND visibility = 'public' to existing WHERE
    expect(calledQuery).toMatch(/WHERE.*AND.*visibility/i)
  })

  it('queryWithVisibility adds WHERE clause when none exists', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: 'public',
    })

    const calledQuery = client.query.mock.calls[0][0].query
    // Should add WHERE visibility = 'public'
    expect(calledQuery).toMatch(/WHERE\s+visibility/i)
  })

  it('queryWithVisibility handles multiple visibility levels', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: ['public', 'protected'],
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    const calledQuery = client.query.mock.calls[0][0].query
    // Should use IN clause for multiple visibility levels
    expect(calledQuery).toMatch(/visibility\s+IN/i)
  })

  it('queryWithVisibility adds owner filter for private visibility', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: 'private',
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    const calledQuery = client.query.mock.calls[0][0].query
    // Should include owner_id filter
    expect(calledQuery).toContain('user-123')
  })

  it('queryWithVisibility adds org filter for protected visibility', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: 'protected',
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    const calledQuery = client.query.mock.calls[0][0].query
    // Should include org_id filter
    expect(calledQuery).toContain('org-456')
  })

  it('queryWithVisibility throws without context for non-public visibility', async () => {
    const client = createMockClient()

    await expect(
      queryWithVisibility!(client, {
        sql: 'SELECT * FROM items',
        visibility: 'private',
      })
    ).rejects.toThrow(/context required/i)
  })

  it('admin context can query all visibility levels', async () => {
    const client = createMockClient()

    // Admin should be able to query private data of others
    const result = await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: ['public', 'protected', 'private'],
      context: createAdminContext('admin-user', 'admin-org'),
    })

    expect(result.data).toBeDefined()
  })
})

// ============================================================================
// 6. Visibility SQL Generation Tests
// ============================================================================

describe('Visibility SQL generation', () => {
  it('generates correct SQL for public visibility', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: 'public',
    })

    const calledQuery = client.query.mock.calls[0][0].query
    expect(calledQuery).toContain("visibility = 'public'")
  })

  it('generates correct SQL for protected visibility with org', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: 'protected',
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    const calledQuery = client.query.mock.calls[0][0].query
    expect(calledQuery).toContain("visibility = 'protected'")
    expect(calledQuery).toContain("org_id = 'org-456'")
  })

  it('generates correct SQL for private visibility with owner', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: 'private',
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    const calledQuery = client.query.mock.calls[0][0].query
    expect(calledQuery).toContain("visibility = 'private'")
    expect(calledQuery).toContain("owner_id = 'user-123'")
  })

  it('generates correct SQL for mixed visibility levels', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      visibility: ['public', 'protected'],
      context: createAuthenticatedContext('user-123', 'org-456'),
    })

    const calledQuery = client.query.mock.calls[0][0].query
    // Should generate OR conditions for each visibility level with appropriate filters
    expect(calledQuery).toMatch(/\(.*visibility.*=.*'public'.*\).*OR.*\(.*visibility.*=.*'protected'.*org_id/i)
  })

  it('preserves existing query structure when adding visibility', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT name, COUNT(*) as count FROM items GROUP BY name ORDER BY count DESC LIMIT 10',
      visibility: 'public',
    })

    const calledQuery = client.query.mock.calls[0][0].query
    // Original structure should be preserved
    expect(calledQuery).toContain('GROUP BY')
    expect(calledQuery).toContain('ORDER BY')
    expect(calledQuery).toContain('LIMIT')
    expect(calledQuery).toContain('visibility')
  })

  it('handles subqueries correctly', async () => {
    const client = createMockClient()

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items WHERE category_id IN (SELECT id FROM categories WHERE active = 1)',
      visibility: 'public',
    })

    const calledQuery = client.query.mock.calls[0][0].query
    // Visibility should be added to outer query, not subquery
    expect(calledQuery).toContain('visibility')
    // Subquery should remain intact
    expect(calledQuery).toContain('SELECT id FROM categories')
  })
})

// ============================================================================
// 7. Error Handling Tests
// ============================================================================

describe('Visibility error handling', () => {
  it('throws meaningful error for invalid visibility level', async () => {
    const client = createMockClient()

    await expect(
      queryWithVisibility!(client, {
        sql: 'SELECT * FROM items',
        // @ts-expect-error - Testing invalid visibility
        visibility: 'invalid-level',
      })
    ).rejects.toThrow(/invalid visibility/i)
  })

  it('throws error when protected visibility requested without authentication', async () => {
    const client = createMockClient()

    await expect(
      queryWithVisibility!(client, {
        sql: 'SELECT * FROM items',
        visibility: 'protected',
        context: createAnonymousContext(),
      })
    ).rejects.toThrow(/authentication required/i)
  })

  it('throws error when private visibility requested without user ID', async () => {
    const client = createMockClient()

    await expect(
      queryWithVisibility!(client, {
        sql: 'SELECT * FROM items',
        visibility: 'private',
        context: {
          isAuthenticated: true,
          // Missing userId
          orgId: 'org-123',
        },
      })
    ).rejects.toThrow(/user.*required/i)
  })

  it('logs warning when querying without visibility filter', async () => {
    const client = createMockClient()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await queryWithVisibility!(client, {
      sql: 'SELECT * FROM items',
      // No visibility specified
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/visibility.*not specified/i)
    )

    warnSpy.mockRestore()
  })
})

// ============================================================================
// 8. Integration with Existing Query Functions Tests
// ============================================================================

describe('Integration with existing query functions', () => {
  it('query function accepts visibility option', async () => {
    // This tests that the existing query function is extended with visibility
    const { query } = await import('../../db/clickhouse')

    expect(query).toBeDefined()

    // The query function signature should accept visibility
    // @ts-expect-error - visibility option not yet implemented
    const result = await query(createMockClient(), {
      sql: 'SELECT * FROM items',
      visibility: 'public',
    })

    expect(result).toBeDefined()
  })

  it('queryOne function accepts visibility option', async () => {
    const { queryOne } = await import('../../db/clickhouse')

    expect(queryOne).toBeDefined()

    // @ts-expect-error - visibility option not yet implemented
    const result = await queryOne(createMockClient(), {
      sql: 'SELECT * FROM items WHERE id = {id:String}',
      params: { id: 'item-1' },
      visibility: 'public',
    })

    expect(result).toBeDefined()
  })

  it('queryStream function accepts visibility option', async () => {
    const { queryStream } = await import('../../db/clickhouse')

    expect(queryStream).toBeDefined()

    // @ts-expect-error - visibility option not yet implemented
    const stream = queryStream(createMockClient(), {
      sql: 'SELECT * FROM items',
      visibility: 'public',
    })

    expect(stream).toBeDefined()
  })

  it('ClickHouseCache query method accepts visibility option', async () => {
    const { ClickHouseCache } = await import('../../db/clickhouse')

    const cache = new ClickHouseCache({
      baseUrl: 'https://clickhouse.example.com:8443',
      database: 'default',
    })

    // @ts-expect-error - visibility option not yet implemented
    const result = await cache.query({
      sql: 'SELECT * FROM items',
      visibility: 'public',
    })

    expect(result).toBeDefined()
  })
})
