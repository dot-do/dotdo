import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

/**
 * Unified Pagination Standard Tests
 *
 * These tests define the EXPECTED consistent pagination behavior across all APIs.
 * They are expected to FAIL since the codebase currently has 3 different pagination approaches:
 *
 * 1. Cursor-based (workos-vault): { cursor, hasMore, auditLog }
 * 2. Offset-based (search): { limit, offset, results, total }
 * 3. Mixed (resources): { items, limit, offset, total }
 *
 * The Unified Pagination Standard defines:
 * - Consistent response format with `data` array and `meta` object
 * - Support for both cursor-based and offset-based pagination
 * - HATEOAS `links` for navigation
 * - Deterministic keyset pagination for large datasets
 */

// ============================================================================
// Expected Pagination Interface
// ============================================================================

/**
 * Unified Pagination Response Format
 * All paginated endpoints should return this structure
 */
export interface PaginatedResponse<T = unknown> {
  /** The actual data items */
  data: T[]
  /** Pagination metadata */
  meta: {
    /** Total count of all items matching the query (optional for performance) */
    total?: number
    /** Number of items per page */
    limit: number
    /** Current offset (for offset-based pagination) */
    offset?: number
    /** Current page number (1-indexed) */
    page?: number
    /** Whether more items exist beyond this page */
    hasMore: boolean
    /** Opaque cursor for next page (for cursor-based pagination) */
    cursor?: string
    /** Opaque cursor for previous page */
    prevCursor?: string
  }
  /** HATEOAS navigation links */
  links: {
    /** Current page URL */
    self: string
    /** First page URL */
    first?: string
    /** Previous page URL (if not on first page) */
    prev?: string
    /** Next page URL (if more items exist) */
    next?: string
    /** Last page URL (if total is known) */
    last?: string
  }
}

/**
 * Pagination query parameters
 */
export interface PaginationParams {
  /** Maximum items to return (default: 20, max: 100) */
  limit?: number
  /** Number of items to skip (offset-based) */
  offset?: number
  /** Opaque cursor from previous response (cursor-based) */
  cursor?: string
  /** Page number (1-indexed, for page-based convenience) */
  page?: number
}

// ============================================================================
// Mock Setup
// ============================================================================

const mockData = Array.from({ length: 150 }, (_, i) => ({
  id: `item-${i + 1}`,
  name: `Item ${i + 1}`,
  createdAt: new Date(Date.now() - i * 1000).toISOString(),
  sortKey: i + 1,
}))

const mockDb = {
  items: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}

/**
 * Create a test app with unified pagination middleware
 * This middleware doesn't exist yet - tests will fail
 */
function createTestApp(): Hono {
  const app = new Hono()

  app.use('*', async (c, next) => {
    c.set('db', mockDb)
    await next()
  })

  // Mock endpoint that should implement unified pagination
  // @ts-expect-error - Endpoint uses unified pagination (not yet implemented)
  app.get('/api/items', async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100)
    const offset = parseInt(c.req.query('offset') || '0', 10)
    const cursor = c.req.query('cursor')
    const page = parseInt(c.req.query('page') || '1', 10)

    // This is the CURRENT inconsistent implementation
    // The tests expect unified format which doesn't exist yet
    const items = mockDb.items.findMany({ limit, offset })
    const total = mockDb.items.count()

    // Current implementations return different formats
    // This will NOT match the unified format the tests expect
    return c.json({
      items, // Wrong! Should be `data`
      total, // Wrong! Should be in `meta`
      limit,
      offset,
      // Missing: meta, links, hasMore, cursor, etc.
    })
  })

  return app
}

// ============================================================================
// 1. Cursor-Based Pagination Tests
// ============================================================================

describe('Unified Pagination - Cursor-Based', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
      return mockData.slice(offset, offset + limit)
    })
    mockDb.items.count.mockReturnValue(mockData.length)
    app = createTestApp()
  })

  describe('Cursor in response', () => {
    it('returns cursor in response', async () => {
      const res = await app.request('/api/items?limit=10')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.meta).toBeDefined()
      expect(body.meta.cursor).toBeDefined()
      expect(typeof body.meta.cursor).toBe('string')
    })

    it('cursor is opaque and URL-safe', async () => {
      const res = await app.request('/api/items?limit=10')
      const body = await res.json() as PaginatedResponse

      // Cursor should be URL-safe (base64url or similar)
      expect(body.meta.cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('does not include cursor on last page', async () => {
      const res = await app.request('/api/items?limit=200') // More than total items
      const body = await res.json() as PaginatedResponse

      expect(body.meta.cursor).toBeUndefined()
      expect(body.meta.hasMore).toBe(false)
    })
  })

  describe('Cursor fetches next page', () => {
    it('cursor fetches next page correctly', async () => {
      // Get first page
      const res1 = await app.request('/api/items?limit=10')
      const body1 = await res1.json() as PaginatedResponse
      expect(body1.data).toHaveLength(10)
      expect(body1.data[0].id).toBe('item-1')

      // Use cursor to get next page
      const cursor = body1.meta.cursor!
      const res2 = await app.request(`/api/items?cursor=${cursor}`)
      const body2 = await res2.json() as PaginatedResponse

      expect(body2.data).toHaveLength(10)
      expect(body2.data[0].id).toBe('item-11')
    })

    it('maintains consistent ordering across pages', async () => {
      const allIds: string[] = []
      let cursor: string | undefined

      // Fetch all pages using cursor
      for (let i = 0; i < 5; i++) {
        const url = cursor ? `/api/items?limit=10&cursor=${cursor}` : '/api/items?limit=10'
        const res = await app.request(url)
        const body = await res.json() as PaginatedResponse

        allIds.push(...body.data.map((item: { id: string }) => item.id))
        cursor = body.meta.cursor
        if (!cursor) break
      }

      // Should have no duplicates
      const uniqueIds = new Set(allIds)
      expect(uniqueIds.size).toBe(allIds.length)
    })
  })

  describe('Cursor encoding', () => {
    it('cursor encodes position opaquely', async () => {
      const res = await app.request('/api/items?limit=10')
      const body = await res.json() as PaginatedResponse

      // Cursor should not expose internal offset/page numbers directly
      const cursor = body.meta.cursor!
      expect(cursor).not.toMatch(/^\d+$/) // Not just a number
      expect(cursor).not.toContain('offset')
      expect(cursor).not.toContain('page')
    })

    it('cursor is stable for same position', async () => {
      const res1 = await app.request('/api/items?limit=10')
      const body1 = await res1.json() as PaginatedResponse

      const res2 = await app.request('/api/items?limit=10')
      const body2 = await res2.json() as PaginatedResponse

      expect(body1.meta.cursor).toBe(body2.meta.cursor)
    })
  })

  describe('Invalid cursor handling', () => {
    it('invalid cursor throws error', async () => {
      const res = await app.request('/api/items?cursor=invalid-garbage-cursor')
      expect(res.status).toBe(400)

      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
      expect(body.error.toLowerCase()).toMatch(/cursor|invalid/)
    })

    it('malformed base64 cursor returns 400', async () => {
      const res = await app.request('/api/items?cursor=!!!not-valid!!!')
      expect(res.status).toBe(400)
    })

    it('expired or stale cursor returns appropriate error', async () => {
      const res = await app.request('/api/items?cursor=eyJvIjoxMDAwMDAwfQ') // Offset beyond data
      expect([400, 404]).toContain(res.status)
    })
  })
})

// ============================================================================
// 2. Limit Parameter Tests
// ============================================================================

describe('Unified Pagination - Limit Parameter', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
      return mockData.slice(offset, offset + limit)
    })
    mockDb.items.count.mockReturnValue(mockData.length)
    app = createTestApp()
  })

  describe('Respects limit parameter', () => {
    it('respects limit parameter', async () => {
      const res = await app.request('/api/items?limit=5')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.data).toHaveLength(5)
      expect(body.meta.limit).toBe(5)
    })

    it('returns exactly limit items when available', async () => {
      const res = await app.request('/api/items?limit=25')
      const body = await res.json() as PaginatedResponse

      expect(body.data).toHaveLength(25)
    })

    it('returns fewer items on last page', async () => {
      const res = await app.request('/api/items?limit=100&offset=100')
      const body = await res.json() as PaginatedResponse

      // 150 total - 100 offset = 50 remaining
      expect(body.data).toHaveLength(50)
      expect(body.meta.limit).toBe(100) // Requested limit preserved in meta
    })
  })

  describe('Default limit applied', () => {
    it('default limit applied when not specified', async () => {
      const res = await app.request('/api/items')
      const body = await res.json() as PaginatedResponse

      expect(body.data).toHaveLength(20) // Default limit
      expect(body.meta.limit).toBe(20)
    })

    it('default limit is sensible (20)', async () => {
      const res = await app.request('/api/items')
      const body = await res.json() as PaginatedResponse

      expect(body.meta.limit).toBe(20)
    })
  })

  describe('Max limit enforced', () => {
    it('max limit enforced at 100', async () => {
      const res = await app.request('/api/items?limit=500')
      const body = await res.json() as PaginatedResponse

      expect(body.data.length).toBeLessThanOrEqual(100)
      expect(body.meta.limit).toBeLessThanOrEqual(100)
    })

    it('limit capped silently without error', async () => {
      const res = await app.request('/api/items?limit=9999')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.meta.limit).toBeLessThanOrEqual(100)
    })
  })

  describe('Edge cases', () => {
    it('limit=0 returns empty array', async () => {
      const res = await app.request('/api/items?limit=0')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.data).toEqual([])
      expect(body.meta.limit).toBe(0)
    })

    it('negative limit treated as default', async () => {
      const res = await app.request('/api/items?limit=-5')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.meta.limit).toBeGreaterThan(0)
    })

    it('non-numeric limit treated as default', async () => {
      const res = await app.request('/api/items?limit=abc')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.meta.limit).toBe(20)
    })
  })
})

// ============================================================================
// 3. Offset Pagination Tests
// ============================================================================

describe('Unified Pagination - Offset Pagination', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
      return mockData.slice(offset, offset + limit)
    })
    mockDb.items.count.mockReturnValue(mockData.length)
    app = createTestApp()
  })

  describe('Offset skips items', () => {
    it('offset skips specified number of items', async () => {
      const res = await app.request('/api/items?offset=10&limit=5')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.data[0].id).toBe('item-11')
      expect(body.meta.offset).toBe(10)
    })

    it('offset=0 returns from beginning', async () => {
      const res = await app.request('/api/items?offset=0&limit=5')
      const body = await res.json() as PaginatedResponse

      expect(body.data[0].id).toBe('item-1')
      expect(body.meta.offset).toBe(0)
    })
  })

  describe('Offset + limit combination', () => {
    it('offset + limit combination creates page window', async () => {
      const res = await app.request('/api/items?offset=20&limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.data).toHaveLength(10)
      expect(body.data[0].id).toBe('item-21')
      expect(body.data[9].id).toBe('item-30')
    })

    it('supports arbitrary page windows', async () => {
      // Page 3 with 15 items per page
      const res = await app.request('/api/items?offset=30&limit=15')
      const body = await res.json() as PaginatedResponse

      expect(body.data).toHaveLength(15)
      expect(body.data[0].id).toBe('item-31')
    })
  })

  describe('Offset beyond count', () => {
    it('offset beyond count returns empty result', async () => {
      const res = await app.request('/api/items?offset=1000&limit=10')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.data).toEqual([])
      expect(body.meta.hasMore).toBe(false)
    })

    it('offset at exact count returns empty', async () => {
      const res = await app.request('/api/items?offset=150&limit=10') // Exactly at end
      const body = await res.json() as PaginatedResponse

      expect(body.data).toEqual([])
    })
  })
})

// ============================================================================
// 4. Page Metadata Tests
// ============================================================================

describe('Unified Pagination - Page Metadata', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
      return mockData.slice(offset, offset + limit)
    })
    mockDb.items.count.mockReturnValue(mockData.length)
    app = createTestApp()
  })

  describe('Total count', () => {
    it('includes total count in meta', async () => {
      const res = await app.request('/api/items?limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.meta).toBeDefined()
      expect(body.meta.total).toBe(150)
    })

    it('total reflects full count, not page count', async () => {
      const res = await app.request('/api/items?limit=5')
      const body = await res.json() as PaginatedResponse

      expect(body.data).toHaveLength(5)
      expect(body.meta.total).toBe(150)
    })
  })

  describe('hasMore flag', () => {
    it('includes hasMore flag when more pages exist', async () => {
      const res = await app.request('/api/items?limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.meta.hasMore).toBe(true)
    })

    it('hasMore is false on last page', async () => {
      const res = await app.request('/api/items?offset=140&limit=20')
      const body = await res.json() as PaginatedResponse

      expect(body.meta.hasMore).toBe(false)
    })

    it('hasMore is false when fetching all items', async () => {
      const res = await app.request('/api/items?limit=200')
      const body = await res.json() as PaginatedResponse

      expect(body.meta.hasMore).toBe(false)
    })
  })

  describe('Page number', () => {
    it('includes page number when using page param', async () => {
      const res = await app.request('/api/items?page=3&limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.meta.page).toBe(3)
    })

    it('page is 1-indexed', async () => {
      const res = await app.request('/api/items?page=1&limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.meta.page).toBe(1)
      expect(body.data[0].id).toBe('item-1')
    })

    it('page param calculates correct offset', async () => {
      const res = await app.request('/api/items?page=2&limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.data[0].id).toBe('item-11') // Page 2 = offset 10
    })
  })

  describe('Items per page', () => {
    it('includes items per page (limit) in meta', async () => {
      const res = await app.request('/api/items?limit=25')
      const body = await res.json() as PaginatedResponse

      expect(body.meta.limit).toBe(25)
    })
  })
})

// ============================================================================
// 5. Response Format Tests
// ============================================================================

describe('Unified Pagination - Response Format', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
      return mockData.slice(offset, offset + limit)
    })
    mockDb.items.count.mockReturnValue(mockData.length)
    app = createTestApp()
  })

  describe('Data array location', () => {
    it('data in data array (not items, results, or other keys)', async () => {
      const res = await app.request('/api/items?limit=10')
      const body = await res.json() as Record<string, unknown>

      // Should use `data` key
      expect(body.data).toBeDefined()
      expect(Array.isArray(body.data)).toBe(true)

      // Should NOT use other common keys
      expect(body.items).toBeUndefined()
      expect(body.results).toBeUndefined()
      expect(body.records).toBeUndefined()
    })
  })

  describe('Pagination in meta object', () => {
    it('pagination metadata in meta object', async () => {
      const res = await app.request('/api/items?limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.meta).toBeDefined()
      expect(typeof body.meta).toBe('object')
      expect(body.meta.limit).toBeDefined()
      expect(body.meta.hasMore).toBeDefined()
    })

    it('meta contains all pagination fields', async () => {
      const res = await app.request('/api/items?limit=10&offset=5')
      const body = await res.json() as PaginatedResponse

      expect(body.meta).toMatchObject({
        limit: expect.any(Number),
        offset: expect.any(Number),
        hasMore: expect.any(Boolean),
      })
    })
  })

  describe('HATEOAS links', () => {
    it('links object for HATEOAS navigation', async () => {
      const res = await app.request('/api/items?limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.links).toBeDefined()
      expect(typeof body.links).toBe('object')
    })

    it('links.self contains current request URL', async () => {
      const res = await app.request('/api/items?limit=10&offset=20')
      const body = await res.json() as PaginatedResponse

      expect(body.links.self).toBeDefined()
      expect(body.links.self).toContain('/api/items')
    })

    it('links.next present when hasMore is true', async () => {
      const res = await app.request('/api/items?limit=10')
      const body = await res.json() as PaginatedResponse

      expect(body.meta.hasMore).toBe(true)
      expect(body.links.next).toBeDefined()
      expect(body.links.next).toContain('/api/items')
    })

    it('links.prev present when not on first page', async () => {
      const res = await app.request('/api/items?limit=10&offset=20')
      const body = await res.json() as PaginatedResponse

      expect(body.links.prev).toBeDefined()
    })

    it('links.first always present', async () => {
      const res = await app.request('/api/items?limit=10&offset=50')
      const body = await res.json() as PaginatedResponse

      expect(body.links.first).toBeDefined()
      expect(body.links.first).toContain('offset=0')
    })
  })
})

// ============================================================================
// 6. Keyset Pagination Tests
// ============================================================================

describe('Unified Pagination - Keyset Pagination', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
      return mockData.slice(offset, offset + limit)
    })
    mockDb.items.count.mockReturnValue(mockData.length)
    app = createTestApp()
  })

  describe('Order by primary key', () => {
    it('order by primary key for deterministic pagination', async () => {
      // Fetch multiple pages and verify deterministic order
      const res1 = await app.request('/api/items?limit=10')
      const body1 = await res1.json() as PaginatedResponse

      const res2 = await app.request('/api/items?limit=10')
      const body2 = await res2.json() as PaginatedResponse

      // Same request should return same order
      expect(body1.data.map((d: { id: string }) => d.id)).toEqual(
        body2.data.map((d: { id: string }) => d.id)
      )
    })

    it('maintains order across cursor-based pagination', async () => {
      const allIds: string[] = []
      let cursor: string | undefined

      // Fetch multiple pages
      for (let i = 0; i < 3; i++) {
        const url = cursor ? `/api/items?cursor=${cursor}` : '/api/items?limit=20'
        const res = await app.request(url)
        const body = await res.json() as PaginatedResponse

        const pageIds = body.data.map((d: { id: string }) => d.id)
        allIds.push(...pageIds)
        cursor = body.meta.cursor
        if (!cursor) break
      }

      // IDs should be in order
      const sortedIds = [...allIds].sort((a, b) => {
        const numA = parseInt(a.replace('item-', ''))
        const numB = parseInt(b.replace('item-', ''))
        return numA - numB
      })
      expect(allIds).toEqual(sortedIds)
    })
  })

  describe('Composite key support', () => {
    it('composite key support for multi-column ordering', async () => {
      // Request with sort parameter
      const res = await app.request('/api/items?limit=10&sort=createdAt,id')
      expect(res.status).toBe(200)

      const body = await res.json() as PaginatedResponse
      expect(body.data).toBeDefined()
    })

    it('cursor encodes composite sort position', async () => {
      const res = await app.request('/api/items?limit=10&sort=createdAt,id')
      const body = await res.json() as PaginatedResponse

      // Cursor should work with composite sort
      if (body.meta.cursor) {
        const res2 = await app.request(`/api/items?cursor=${body.meta.cursor}&sort=createdAt,id`)
        expect(res2.status).toBe(200)
      }
    })
  })

  describe('Stable under mutations', () => {
    it('stable under mutations - no drift', async () => {
      // Get first page
      const res1 = await app.request('/api/items?limit=10')
      const body1 = await res1.json() as PaginatedResponse
      const cursor = body1.meta.cursor!

      // Simulate mutation (new item added)
      const originalFindMany = mockDb.items.findMany
      mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
        // Add a new item at the beginning
        const newData = [
          { id: 'item-new', name: 'New Item', createdAt: new Date().toISOString(), sortKey: 0 },
          ...mockData,
        ]
        return newData.slice(offset, offset + limit)
      })

      // Using cursor should still get consistent results (not affected by new item)
      const res2 = await app.request(`/api/items?cursor=${cursor}`)
      const body2 = await res2.json() as PaginatedResponse

      // Should continue from where we left off, not be affected by new item
      expect(body2.data[0].id).toBe('item-11')

      mockDb.items.findMany = originalFindMany
    })

    it('keyset pagination prevents page drift', async () => {
      const res1 = await app.request('/api/items?limit=10')
      const body1 = await res1.json() as PaginatedResponse
      const lastItem = body1.data[body1.data.length - 1] as { id: string; sortKey: number }

      // Using keyset (sortKey > lastItem.sortKey) should be stable
      // Even if items are inserted before our position
      const res2 = await app.request(`/api/items?after=${lastItem.sortKey}&limit=10`)
      expect(res2.status).toBe(200)
    })
  })
})

// ============================================================================
// 7. Integration Tests - Consistent Format Across Endpoints
// ============================================================================

describe('Unified Pagination - Cross-Endpoint Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('all paginated endpoints return same response structure', async () => {
    // This test verifies that multiple endpoints use the same pagination format
    // Currently they don't - search returns { results }, resources returns { items }

    const app = new Hono()

    // Mock different endpoints that should have same pagination format
    const endpoints = [
      '/api/items',
      '/api/users',
      '/api/events',
      '/api/search/tasks',
    ]

    for (const endpoint of endpoints) {
      app.get(endpoint, (c) => {
        // All should return unified format
        return c.json({
          data: [],
          meta: { limit: 20, hasMore: false },
          links: { self: endpoint },
        })
      })
    }

    for (const endpoint of endpoints) {
      const res = await app.request(endpoint)
      const body = await res.json() as PaginatedResponse

      // All should have same structure
      expect(body.data).toBeDefined()
      expect(body.meta).toBeDefined()
      expect(body.meta.limit).toBeDefined()
      expect(body.meta.hasMore).toBeDefined()
      expect(body.links).toBeDefined()
      expect(body.links.self).toBeDefined()
    }
  })

  it('pagination params work consistently across endpoints', async () => {
    const app = new Hono()

    app.get('/api/items', (c) => {
      const limit = parseInt(c.req.query('limit') || '20', 10)
      const offset = parseInt(c.req.query('offset') || '0', 10)
      const cursor = c.req.query('cursor')

      return c.json({
        data: mockData.slice(offset, offset + limit),
        meta: {
          limit,
          offset,
          hasMore: offset + limit < mockData.length,
          cursor: cursor || 'next-cursor',
        },
        links: { self: '/api/items' },
      })
    })

    // Test limit param
    const res1 = await app.request('/api/items?limit=5')
    const body1 = await res1.json() as PaginatedResponse
    expect(body1.data).toHaveLength(5)
    expect(body1.meta.limit).toBe(5)

    // Test offset param
    const res2 = await app.request('/api/items?offset=10&limit=5')
    const body2 = await res2.json() as PaginatedResponse
    expect(body2.meta.offset).toBe(10)

    // Test cursor param
    const res3 = await app.request('/api/items?cursor=test-cursor')
    const body3 = await res3.json() as PaginatedResponse
    expect(body3.meta.cursor).toBeDefined()
  })
})

// ============================================================================
// 8. Error Handling Tests
// ============================================================================

describe('Unified Pagination - Error Handling', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
      return mockData.slice(offset, offset + limit)
    })
    mockDb.items.count.mockReturnValue(mockData.length)
    app = createTestApp()
  })

  it('returns 400 for conflicting pagination params', async () => {
    // Using both cursor and offset should be an error
    const res = await app.request('/api/items?cursor=abc&offset=10')
    expect(res.status).toBe(400)

    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/cursor|offset|conflict/i)
  })

  it('returns 400 for invalid page number', async () => {
    const res = await app.request('/api/items?page=0') // Pages are 1-indexed
    expect(res.status).toBe(400)
  })

  it('handles database errors gracefully', async () => {
    mockDb.items.findMany.mockRejectedValue(new Error('DB connection failed'))

    const res = await app.request('/api/items')
    expect(res.status).toBe(500)
  })
})

// ============================================================================
// 9. Performance Considerations
// ============================================================================

describe('Unified Pagination - Performance', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.items.findMany.mockImplementation(({ limit, offset }: { limit: number; offset: number }) => {
      return mockData.slice(offset, offset + limit)
    })
    mockDb.items.count.mockReturnValue(mockData.length)
    app = createTestApp()
  })

  it('total count is optional for performance', async () => {
    // Some endpoints may skip total count for performance
    const res = await app.request('/api/items?limit=10&skipTotal=true')
    expect(res.status).toBe(200)

    const body = await res.json() as PaginatedResponse
    // total may be undefined when skipped
    expect(body.meta.hasMore).toBeDefined() // But hasMore should still work
  })

  it('cursor pagination more efficient than offset for large datasets', async () => {
    // Cursor should work without counting all items
    const countCalls = vi.fn()
    mockDb.items.count = countCalls

    const res = await app.request('/api/items?cursor=some-cursor')
    expect(res.status).toBe(200)

    // Cursor-based pagination shouldn't need total count
    // (implementation detail, but good to verify)
  })
})
