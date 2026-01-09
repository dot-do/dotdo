/**
 * RED Phase Tests for ChDBSandbox Visibility Support
 *
 * These tests verify visibility filtering in the ClickHouse sandbox (chDB).
 * They are expected to FAIL until visibility support is implemented.
 *
 * Related issues:
 * - dotdo-cnxg: [RED] sandbox/clickhouse.ts visibility tests
 * - dotdo-xmpc: Visibility Controls for Things (parent epic)
 *
 * Visibility levels:
 * - `public` - Anyone can view
 * - `unlisted` - Accessible by direct link, not listed in searches
 * - `org` - Visible to organization members only
 * - `user` - Visible only to owner
 *
 * Implementation requirements:
 * - ChDBSandbox queries can filter by visibility
 * - Public queries don't require auth
 * - QueryTemplates include visibility parameter
 * - buildQuery supports visibility parameter
 * - ClickHouseCache handles visibility in cache keys
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ChDBSandbox,
  QueryBuilder,
  QueryTemplates,
  buildQuery,
  createChDBSandbox,
  type OutputFormat,
  type QueryResult,
} from '../../sandbox/clickhouse'

// ============================================================================
// Types (Expected to be implemented)
// ============================================================================

/**
 * Visibility levels for Things
 */
type Visibility = 'public' | 'unlisted' | 'org' | 'user'

/**
 * Query context for visibility-aware queries
 */
interface QueryContext {
  /** Current user ID (undefined for anonymous) */
  userId?: string
  /** Current organization ID */
  orgId?: string
  /** Whether to allow public access without auth */
  allowPublic?: boolean
}

/**
 * Options for visibility-filtered queries
 */
interface VisibilityQueryOptions {
  /** Visibility filter */
  visibility?: Visibility | Visibility[]
  /** Query context for access control */
  context?: QueryContext
}

// ============================================================================
// 1. ChDBSandbox Visibility Filtering Tests
// ============================================================================

describe('ChDBSandbox visibility filtering', () => {
  let sandbox: ChDBSandbox

  beforeEach(() => {
    sandbox = createChDBSandbox('starter')
  })

  describe('queryWithVisibility method', () => {
    it('should have a queryWithVisibility method', () => {
      // @ts-expect-error - Method not yet implemented
      expect(sandbox.queryWithVisibility).toBeDefined()
      // @ts-expect-error - Method not yet implemented
      expect(typeof sandbox.queryWithVisibility).toBe('function')
    })

    it('should accept visibility parameter', async () => {
      const sql = 'SELECT * FROM things WHERE 1=1'

      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryWithVisibility<unknown>(sql, {
        visibility: 'public',
      })

      expect(result.success).toBe(true)
    })

    it('should filter results by single visibility level', async () => {
      const sql = 'SELECT * FROM things'

      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryWithVisibility<{ visibility: string }>(sql, {
        visibility: 'public',
      })

      expect(result.success).toBe(true)
      // All returned rows should have public visibility
      if (result.data && result.data.length > 0) {
        result.data.forEach((row) => {
          expect(row.visibility).toBe('public')
        })
      }
    })

    it('should filter results by multiple visibility levels', async () => {
      const sql = 'SELECT * FROM things'

      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryWithVisibility<{ visibility: string }>(sql, {
        visibility: ['public', 'unlisted'],
      })

      expect(result.success).toBe(true)
      if (result.data && result.data.length > 0) {
        result.data.forEach((row) => {
          expect(['public', 'unlisted']).toContain(row.visibility)
        })
      }
    })

    it('should apply context-based filtering for org visibility', async () => {
      const sql = 'SELECT * FROM things'

      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryWithVisibility<{ visibility: string; org_id: string }>(sql, {
        visibility: 'org',
        context: {
          userId: 'user-123',
          orgId: 'org-abc',
        },
      })

      expect(result.success).toBe(true)
      if (result.data && result.data.length > 0) {
        result.data.forEach((row) => {
          expect(row.visibility).toBe('org')
          expect(row.org_id).toBe('org-abc')
        })
      }
    })

    it('should apply context-based filtering for user visibility', async () => {
      const sql = 'SELECT * FROM things'

      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryWithVisibility<{ visibility: string; user_id: string }>(sql, {
        visibility: 'user',
        context: {
          userId: 'user-123',
        },
      })

      expect(result.success).toBe(true)
      if (result.data && result.data.length > 0) {
        result.data.forEach((row) => {
          expect(row.visibility).toBe('user')
          expect(row.user_id).toBe('user-123')
        })
      }
    })

    it('should reject user/org visibility without context', async () => {
      const sql = 'SELECT * FROM things'

      // @ts-expect-error - Method not yet implemented
      await expect(
        sandbox.queryWithVisibility(sql, {
          visibility: 'user',
          // No context provided
        })
      ).rejects.toThrow(/context|unauthorized|authentication/i)
    })
  })

  describe('setVisibilityContext method', () => {
    it('should have a setVisibilityContext method', () => {
      // @ts-expect-error - Method not yet implemented
      expect(sandbox.setVisibilityContext).toBeDefined()
      // @ts-expect-error - Method not yet implemented
      expect(typeof sandbox.setVisibilityContext).toBe('function')
    })

    it('should set default context for subsequent queries', () => {
      // @ts-expect-error - Method not yet implemented
      sandbox.setVisibilityContext({
        userId: 'user-456',
        orgId: 'org-def',
      })

      // @ts-expect-error - Method not yet implemented
      const context = sandbox.getVisibilityContext()
      expect(context.userId).toBe('user-456')
      expect(context.orgId).toBe('org-def')
    })

    it('should allow clearing the context', () => {
      // @ts-expect-error - Method not yet implemented
      sandbox.setVisibilityContext({
        userId: 'user-456',
        orgId: 'org-def',
      })

      // @ts-expect-error - Method not yet implemented
      sandbox.setVisibilityContext(undefined)

      // @ts-expect-error - Method not yet implemented
      const context = sandbox.getVisibilityContext()
      expect(context).toBeUndefined()
    })
  })
})

// ============================================================================
// 2. Public Query Access Without Auth
// ============================================================================

describe('Public queries without authentication', () => {
  let sandbox: ChDBSandbox

  beforeEach(() => {
    sandbox = createChDBSandbox('free')
  })

  describe('queryPublic method', () => {
    it('should have a queryPublic method', () => {
      // @ts-expect-error - Method not yet implemented
      expect(sandbox.queryPublic).toBeDefined()
      // @ts-expect-error - Method not yet implemented
      expect(typeof sandbox.queryPublic).toBe('function')
    })

    it('should query only public visibility data', async () => {
      const sql = 'SELECT * FROM things'

      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryPublic<{ visibility: string }>(sql)

      expect(result.success).toBe(true)
      if (result.data && result.data.length > 0) {
        result.data.forEach((row) => {
          expect(row.visibility).toBe('public')
        })
      }
    })

    it('should not require any context or authentication', async () => {
      const sql = 'SELECT count() as count FROM things'

      // No context, no auth
      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryPublic<{ count: number }>(sql)

      expect(result.success).toBe(true)
      expect(result.data?.[0]?.count).toBeGreaterThanOrEqual(0)
    })

    it('should not expose non-public data even with malicious SQL', async () => {
      // Attempt to bypass visibility filter with SQL injection
      const maliciousSql = "SELECT * FROM things WHERE visibility = 'user' OR 1=1"

      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryPublic<{ visibility: string }>(maliciousSql)

      expect(result.success).toBe(true)
      // Should still only return public data
      if (result.data && result.data.length > 0) {
        result.data.forEach((row) => {
          expect(row.visibility).toBe('public')
        })
      }
    })

    it('should work with format parameter', async () => {
      const sql = 'SELECT * FROM things LIMIT 10'

      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryPublic<unknown>(sql, 'JSONEachRow')

      expect(result.success).toBe(true)
    })
  })

  describe('anonymous access configuration', () => {
    it('should have allowAnonymousPublicAccess configuration', () => {
      const sandboxWithConfig = new ChDBSandbox({
        tier: 'starter',
        // @ts-expect-error - Option not yet implemented
        allowAnonymousPublicAccess: true,
      })

      // @ts-expect-error - Property not yet implemented
      expect(sandboxWithConfig.allowAnonymousPublicAccess).toBe(true)
    })

    it('should default to allowing anonymous public access', () => {
      const defaultSandbox = createChDBSandbox('starter')

      // @ts-expect-error - Property not yet implemented
      expect(defaultSandbox.allowAnonymousPublicAccess).toBe(true)
    })

    it('should be configurable to disallow anonymous access', () => {
      const sandboxWithConfig = new ChDBSandbox({
        tier: 'enterprise',
        // @ts-expect-error - Option not yet implemented
        allowAnonymousPublicAccess: false,
      })

      // @ts-expect-error - Method not yet implemented
      expect(() => sandboxWithConfig.queryPublic('SELECT 1')).toThrow(
        /anonymous|public.*disabled|authentication.*required/i
      )
    })
  })
})

// ============================================================================
// 3. QueryTemplates Visibility Support
// ============================================================================

describe('QueryTemplates visibility support', () => {
  describe('eventsByDate with visibility', () => {
    it('should have eventsByDateWithVisibility template', () => {
      // @ts-expect-error - Function not yet implemented
      expect(QueryTemplates.eventsByDateWithVisibility).toBeDefined()
      // @ts-expect-error - Function not yet implemented
      expect(typeof QueryTemplates.eventsByDateWithVisibility).toBe('function')
    })

    it('should generate SQL with visibility filter', () => {
      // @ts-expect-error - Function not yet implemented
      const sql = QueryTemplates.eventsByDateWithVisibility('events', 'public')

      expect(sql).toContain('visibility')
      expect(sql).toContain("'public'")
      expect(sql).toContain('GROUP BY')
      expect(sql).toContain('date')
    })

    it('should accept array of visibility levels', () => {
      // @ts-expect-error - Function not yet implemented
      const sql = QueryTemplates.eventsByDateWithVisibility('events', ['public', 'unlisted'])

      expect(sql).toContain('visibility')
      expect(sql).toContain("'public'")
      expect(sql).toContain("'unlisted'")
      expect(sql).toMatch(/IN\s*\(/)
    })
  })

  describe('topN with visibility', () => {
    it('should have topNWithVisibility template', () => {
      // @ts-expect-error - Function not yet implemented
      expect(QueryTemplates.topNWithVisibility).toBeDefined()
      // @ts-expect-error - Function not yet implemented
      expect(typeof QueryTemplates.topNWithVisibility).toBe('function')
    })

    it('should generate SQL with visibility filter', () => {
      // @ts-expect-error - Function not yet implemented
      const sql = QueryTemplates.topNWithVisibility('things', 'type', 10, 'public')

      expect(sql).toContain('visibility')
      expect(sql).toContain("'public'")
      expect(sql).toContain('LIMIT 10')
    })
  })

  describe('timeSeries with visibility', () => {
    it('should have timeSeriesWithVisibility template', () => {
      // @ts-expect-error - Function not yet implemented
      expect(QueryTemplates.timeSeriesWithVisibility).toBeDefined()
      // @ts-expect-error - Function not yet implemented
      expect(typeof QueryTemplates.timeSeriesWithVisibility).toBe('function')
    })

    it('should generate SQL with visibility filter', () => {
      // @ts-expect-error - Function not yet implemented
      const sql = QueryTemplates.timeSeriesWithVisibility('events', 'day', 'public')

      expect(sql).toContain('visibility')
      expect(sql).toContain("'public'")
      expect(sql).toContain('toDate')
    })
  })

  describe('percentiles with visibility', () => {
    it('should have percentilesWithVisibility template', () => {
      // @ts-expect-error - Function not yet implemented
      expect(QueryTemplates.percentilesWithVisibility).toBeDefined()
      // @ts-expect-error - Function not yet implemented
      expect(typeof QueryTemplates.percentilesWithVisibility).toBe('function')
    })

    it('should generate SQL with visibility filter', () => {
      // @ts-expect-error - Function not yet implemented
      const sql = QueryTemplates.percentilesWithVisibility('metrics', 'latency', 'public')

      expect(sql).toContain('visibility')
      expect(sql).toContain("'public'")
      expect(sql).toContain('quantile')
    })
  })

  describe('existing templates backward compatibility', () => {
    it('eventsByDate should continue working without visibility', () => {
      const sql = QueryTemplates.eventsByDate('events')

      expect(sql).toContain('toDate')
      expect(sql).toContain('events')
      expect(sql).not.toContain('visibility')
    })

    it('topN should continue working without visibility', () => {
      const sql = QueryTemplates.topN('things', 'type', 5)

      expect(sql).toContain('LIMIT 5')
      expect(sql).not.toContain('visibility')
    })
  })
})

// ============================================================================
// 4. buildQuery Visibility Parameter Support
// ============================================================================

describe('buildQuery visibility parameter support', () => {
  describe('Visibility type parameter', () => {
    it('should support {visibility:Visibility} parameter type', () => {
      const template = 'SELECT * FROM things WHERE visibility = {vis:Visibility}'

      const sql = buildQuery(template, { vis: 'public' })

      expect(sql).toBe("SELECT * FROM things WHERE visibility = 'public'")
    })

    it('should properly escape visibility value', () => {
      const template = 'SELECT * FROM things WHERE visibility = {vis:Visibility}'

      const sql = buildQuery(template, { vis: 'unlisted' })

      expect(sql).toBe("SELECT * FROM things WHERE visibility = 'unlisted'")
    })

    it('should validate visibility values', () => {
      const template = 'SELECT * FROM things WHERE visibility = {vis:Visibility}'

      expect(() => buildQuery(template, { vis: 'invalid_visibility' })).toThrow(
        /invalid.*visibility/i
      )
    })

    it('should accept all valid visibility values', () => {
      const template = 'SELECT * FROM things WHERE visibility = {vis:Visibility}'

      expect(buildQuery(template, { vis: 'public' })).toContain("'public'")
      expect(buildQuery(template, { vis: 'unlisted' })).toContain("'unlisted'")
      expect(buildQuery(template, { vis: 'org' })).toContain("'org'")
      expect(buildQuery(template, { vis: 'user' })).toContain("'user'")
    })
  })

  describe('VisibilityArray type parameter', () => {
    it('should support {visibilities:VisibilityArray} parameter type', () => {
      const template = 'SELECT * FROM things WHERE visibility IN {vis:VisibilityArray}'

      const sql = buildQuery(template, { vis: ['public', 'unlisted'] })

      expect(sql).toContain("'public'")
      expect(sql).toContain("'unlisted'")
      expect(sql).toMatch(/\(.*'public'.*,.*'unlisted'.*\)/)
    })

    it('should handle single-element array', () => {
      const template = 'SELECT * FROM things WHERE visibility IN {vis:VisibilityArray}'

      const sql = buildQuery(template, { vis: ['public'] })

      expect(sql).toContain("'public'")
    })

    it('should validate all values in array', () => {
      const template = 'SELECT * FROM things WHERE visibility IN {vis:VisibilityArray}'

      expect(() =>
        buildQuery(template, { vis: ['public', 'invalid'] })
      ).toThrow(/invalid.*visibility/i)
    })
  })

  describe('combined with context parameters', () => {
    it('should support visibility with user context', () => {
      const template = `
        SELECT * FROM things
        WHERE visibility = {vis:Visibility}
        AND (visibility != 'user' OR user_id = {userId:String})
      `

      const sql = buildQuery(template, {
        vis: 'user',
        userId: 'user-123',
      })

      expect(sql).toContain("'user'")
      expect(sql).toContain("'user-123'")
    })

    it('should support visibility with org context', () => {
      const template = `
        SELECT * FROM things
        WHERE visibility = {vis:Visibility}
        AND (visibility != 'org' OR org_id = {orgId:String})
      `

      const sql = buildQuery(template, {
        vis: 'org',
        orgId: 'org-abc',
      })

      expect(sql).toContain("'org'")
      expect(sql).toContain("'org-abc'")
    })
  })
})

// ============================================================================
// 5. QueryBuilder Visibility Methods
// ============================================================================

describe('QueryBuilder visibility methods', () => {
  let builder: QueryBuilder

  beforeEach(() => {
    builder = new QueryBuilder()
  })

  describe('visibility method', () => {
    it('should have a visibility method', () => {
      // @ts-expect-error - Method not yet implemented
      expect(builder.visibility).toBeDefined()
      // @ts-expect-error - Method not yet implemented
      expect(typeof builder.visibility).toBe('function')
    })

    it('should add single visibility value to query', () => {
      // @ts-expect-error - Method not yet implemented
      const sql = builder.sql('visibility = ').visibility('public').build()

      expect(sql).toBe("visibility = 'public'")
    })

    it('should validate visibility value', () => {
      // @ts-expect-error - Method not yet implemented
      expect(() => builder.visibility('invalid')).toThrow(/invalid.*visibility/i)
    })

    it('should return builder for chaining', () => {
      // @ts-expect-error - Method not yet implemented
      const result = builder.sql('WHERE ').visibility('public')

      expect(result).toBe(builder)
    })
  })

  describe('visibilityArray method', () => {
    it('should have a visibilityArray method', () => {
      // @ts-expect-error - Method not yet implemented
      expect(builder.visibilityArray).toBeDefined()
      // @ts-expect-error - Method not yet implemented
      expect(typeof builder.visibilityArray).toBe('function')
    })

    it('should add array of visibility values', () => {
      // @ts-expect-error - Method not yet implemented
      const sql = builder.sql('visibility IN ').visibilityArray(['public', 'unlisted']).build()

      expect(sql).toContain("'public'")
      expect(sql).toContain("'unlisted'")
    })

    it('should validate all values in array', () => {
      // @ts-expect-error - Method not yet implemented
      expect(() => builder.visibilityArray(['public', 'invalid'])).toThrow(
        /invalid.*visibility/i
      )
    })
  })

  describe('visibilityFilter method', () => {
    it('should have a visibilityFilter method for complex conditions', () => {
      // @ts-expect-error - Method not yet implemented
      expect(builder.visibilityFilter).toBeDefined()
      // @ts-expect-error - Method not yet implemented
      expect(typeof builder.visibilityFilter).toBe('function')
    })

    it('should generate complete visibility filter clause', () => {
      // @ts-expect-error - Method not yet implemented
      const sql = builder
        .sql('SELECT * FROM things WHERE ')
        .visibilityFilter({
          visibility: ['public', 'org'],
          context: { userId: 'user-123', orgId: 'org-abc' },
        })
        .build()

      expect(sql).toContain('visibility')
      expect(sql).toContain("'public'")
      expect(sql).toContain("'org'")
      expect(sql).toContain("'org-abc'")
    })
  })
})

// ============================================================================
// 6. ClickHouseCache Visibility in Cache Keys (if applicable)
// ============================================================================

describe('ClickHouseCache visibility in cache keys', () => {
  describe('cache key generation', () => {
    it('should include visibility in cache key', () => {
      // @ts-expect-error - Class not yet implemented
      const { ClickHouseCache, createCacheKey } = require('../../sandbox/clickhouse')

      const key1 = createCacheKey('SELECT * FROM things', { visibility: 'public' })
      const key2 = createCacheKey('SELECT * FROM things', { visibility: 'org' })

      expect(key1).not.toBe(key2)
      expect(key1).toContain('public')
      expect(key2).toContain('org')
    })

    it('should include context in cache key for non-public visibility', () => {
      // @ts-expect-error - Class not yet implemented
      const { createCacheKey } = require('../../sandbox/clickhouse')

      const key1 = createCacheKey('SELECT * FROM things', {
        visibility: 'org',
        context: { orgId: 'org-1' },
      })
      const key2 = createCacheKey('SELECT * FROM things', {
        visibility: 'org',
        context: { orgId: 'org-2' },
      })

      expect(key1).not.toBe(key2)
    })

    it('should generate same key for public queries regardless of context', () => {
      // @ts-expect-error - Class not yet implemented
      const { createCacheKey } = require('../../sandbox/clickhouse')

      const key1 = createCacheKey('SELECT * FROM things', {
        visibility: 'public',
        context: { userId: 'user-1' },
      })
      const key2 = createCacheKey('SELECT * FROM things', {
        visibility: 'public',
        context: { userId: 'user-2' },
      })

      // Public queries should share cache regardless of who is asking
      expect(key1).toBe(key2)
    })
  })

  describe('cache isolation', () => {
    it('should not return cached private data for different users', async () => {
      // @ts-expect-error - Class not yet implemented
      const { ClickHouseCache } = require('../../sandbox/clickhouse')
      const cache = new ClickHouseCache()

      const query = 'SELECT * FROM things'

      // User 1 queries their data
      await cache.set(query, { visibility: 'user', context: { userId: 'user-1' } }, [
        { id: 1, visibility: 'user', user_id: 'user-1' },
      ])

      // User 2 should not get User 1's cached data
      const result = await cache.get(query, {
        visibility: 'user',
        context: { userId: 'user-2' },
      })

      expect(result).toBeUndefined()
    })

    it('should not return cached org data for different orgs', async () => {
      // @ts-expect-error - Class not yet implemented
      const { ClickHouseCache } = require('../../sandbox/clickhouse')
      const cache = new ClickHouseCache()

      const query = 'SELECT * FROM things'

      // Org 1 queries their data
      await cache.set(query, { visibility: 'org', context: { orgId: 'org-1' } }, [
        { id: 1, visibility: 'org', org_id: 'org-1' },
      ])

      // Org 2 should not get Org 1's cached data
      const result = await cache.get(query, {
        visibility: 'org',
        context: { orgId: 'org-2' },
      })

      expect(result).toBeUndefined()
    })

    it('should share cached public data across all users', async () => {
      // @ts-expect-error - Class not yet implemented
      const { ClickHouseCache } = require('../../sandbox/clickhouse')
      const cache = new ClickHouseCache()

      const query = 'SELECT * FROM things WHERE visibility = ?'
      const publicData = [{ id: 1, visibility: 'public' }]

      // Cache public data
      await cache.set(query, { visibility: 'public' }, publicData)

      // Different users should all get the same cached public data
      const result1 = await cache.get(query, {
        visibility: 'public',
        context: { userId: 'user-1' },
      })
      const result2 = await cache.get(query, {
        visibility: 'public',
        context: { userId: 'user-2' },
      })
      const result3 = await cache.get(query, { visibility: 'public' }) // No context

      expect(result1).toEqual(publicData)
      expect(result2).toEqual(publicData)
      expect(result3).toEqual(publicData)
    })
  })
})

// ============================================================================
// 7. Integration Tests
// ============================================================================

describe('Visibility integration tests', () => {
  let sandbox: ChDBSandbox

  beforeEach(() => {
    sandbox = createChDBSandbox('starter')
  })

  describe('end-to-end visibility filtering', () => {
    it('should filter Iceberg queries by visibility', async () => {
      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryIcebergWithVisibility({
        bucket: 'my-data',
        tablePath: 'warehouse/things',
        query: 'SELECT * FROM things',
        visibility: 'public',
      })

      expect(result.success).toBe(true)
      if (result.data && result.data.length > 0) {
        result.data.forEach((row: { visibility: string }) => {
          expect(row.visibility).toBe('public')
        })
      }
    })

    it('should filter Parquet queries by visibility', async () => {
      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryParquetWithVisibility({
        path: 'https://bucket.r2.dev/data/*.parquet',
        query: 'SELECT * FROM data',
        visibility: 'public',
      })

      expect(result.success).toBe(true)
      if (result.data && result.data.length > 0) {
        result.data.forEach((row: { visibility: string }) => {
          expect(row.visibility).toBe('public')
        })
      }
    })
  })

  describe('visibility with session queries', () => {
    it('should apply visibility to session queries', async () => {
      const sessionSandbox = new ChDBSandbox({
        dataPath: '/tmp/test-session',
        tier: 'starter',
      })

      // @ts-expect-error - Method not yet implemented
      const result = await sessionSandbox.queryWithSessionAndVisibility(
        'SELECT * FROM things',
        {
          visibility: 'public',
        }
      )

      expect(result.success).toBe(true)
    })
  })

  describe('visibility constraints are enforced', () => {
    it('should prevent accessing user data without user context', async () => {
      // @ts-expect-error - Method not yet implemented
      await expect(
        sandbox.queryWithVisibility('SELECT * FROM things', {
          visibility: 'user',
          context: {}, // No userId
        })
      ).rejects.toThrow(/userId.*required|context.*invalid/i)
    })

    it('should prevent accessing org data without org context', async () => {
      // @ts-expect-error - Method not yet implemented
      await expect(
        sandbox.queryWithVisibility('SELECT * FROM things', {
          visibility: 'org',
          context: { userId: 'user-123' }, // No orgId
        })
      ).rejects.toThrow(/orgId.*required|context.*invalid/i)
    })

    it('should allow unlisted access without authentication', async () => {
      // @ts-expect-error - Method not yet implemented
      const result = await sandbox.queryWithVisibility('SELECT * FROM things WHERE id = ?', {
        visibility: 'unlisted',
        // No context needed for unlisted (direct link access)
      })

      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// 8. Error Handling Tests
// ============================================================================

describe('Visibility error handling', () => {
  let sandbox: ChDBSandbox

  beforeEach(() => {
    sandbox = createChDBSandbox('starter')
  })

  it('should return meaningful error for invalid visibility value', async () => {
    // @ts-expect-error - Method not yet implemented
    const result = await sandbox.queryWithVisibility('SELECT * FROM things', {
      // @ts-expect-error - Invalid value for testing
      visibility: 'invalid_visibility',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/invalid.*visibility|unknown.*visibility/i)
  })

  it('should return meaningful error for missing required context', async () => {
    // @ts-expect-error - Method not yet implemented
    const result = await sandbox.queryWithVisibility('SELECT * FROM things', {
      visibility: 'user',
      // Missing context
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/context.*required|authentication.*required/i)
  })

  it('should handle SQL injection attempts in visibility parameter', async () => {
    // @ts-expect-error - Method not yet implemented
    const result = await sandbox.queryWithVisibility('SELECT * FROM things', {
      // @ts-expect-error - SQL injection attempt
      visibility: "public' OR '1'='1",
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/invalid.*visibility/i)
  })
})
