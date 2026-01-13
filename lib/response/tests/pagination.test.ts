import { describe, it, expect } from 'vitest'

/**
 * Standard Pagination Tests (RED Phase)
 *
 * These tests define the EXPECTED unified pagination interface across REST, RPC, and compat layers.
 * They are expected to FAIL until lib/response/pagination.ts is implemented.
 *
 * This is RED phase of TDD for issue dotdo-zihfk.
 *
 * ## Unified Pagination Interface
 *
 * The pagination system supports:
 * - Cursor-based pagination (forward/backward)
 * - Offset-based pagination (for backwards compatibility)
 * - Consistent metadata across all API layers
 *
 * ## Expected Implementation (lib/response/pagination.ts):
 *
 * ```typescript
 * export interface PaginationParams {
 *   limit?: number      // Max items to return (default: 20, max: 100)
 *   cursor?: string     // Opaque cursor from previous response
 *   direction?: 'forward' | 'backward'  // Direction to paginate
 *   offset?: number     // Offset for offset-based pagination (deprecated)
 * }
 *
 * export interface PaginationMeta {
 *   total?: number      // Total count (optional for performance)
 *   limit: number       // Items per page
 *   hasMore: boolean    // Whether more items exist
 *   cursor?: string     // Cursor for next page
 *   prevCursor?: string // Cursor for previous page
 * }
 *
 * export interface PaginatedResult<T> {
 *   data: T[]
 *   meta: PaginationMeta
 * }
 *
 * export function createCursor(position: CursorPosition): string
 * export function parseCursor(cursor: string): CursorPosition | null
 * export function buildPaginationMeta(options: PaginationMetaOptions): PaginationMeta
 * export function paginate<T>(items: T[], params: PaginationParams): PaginatedResult<T>
 * ```
 */

// Import the module under test (will fail until implemented)
import {
  createCursor,
  parseCursor,
  buildPaginationMeta,
  paginate,
  type PaginationParams,
  type PaginationMeta,
  type PaginatedResult,
  type CursorPosition,
} from '../pagination'

// ============================================================================
// Test Data Setup
// ============================================================================

const createTestItems = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `item-${i + 1}`,
    name: `Item ${i + 1}`,
    createdAt: new Date(Date.now() - i * 1000).toISOString(),
    sortKey: i + 1,
  }))

// ============================================================================
// 1. Cursor Encoding/Decoding Tests
// ============================================================================

describe('createCursor', () => {
  describe('basic cursor creation', () => {
    it('creates opaque cursor from position', () => {
      const cursor = createCursor({ offset: 10 })

      expect(typeof cursor).toBe('string')
      expect(cursor.length).toBeGreaterThan(0)
    })

    it('cursor is URL-safe (base64url encoded)', () => {
      const cursor = createCursor({ offset: 100, sortKey: 'abc123' })

      // Base64url characters only: A-Z, a-z, 0-9, -, _
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('cursor does not expose raw offset', () => {
      const cursor = createCursor({ offset: 42 })

      expect(cursor).not.toBe('42')
      expect(cursor).not.toContain('42')
      expect(cursor).not.toContain('offset')
    })

    it('different positions create different cursors', () => {
      const cursor1 = createCursor({ offset: 10 })
      const cursor2 = createCursor({ offset: 20 })

      expect(cursor1).not.toBe(cursor2)
    })

    it('same position creates stable cursor', () => {
      const cursor1 = createCursor({ offset: 10, sortKey: 'key' })
      const cursor2 = createCursor({ offset: 10, sortKey: 'key' })

      expect(cursor1).toBe(cursor2)
    })
  })

  describe('cursor with sort key', () => {
    it('includes sort key in cursor', () => {
      const cursor = createCursor({ offset: 10, sortKey: 'item-10' })

      expect(typeof cursor).toBe('string')
    })

    it('includes composite sort key in cursor', () => {
      const cursor = createCursor({
        offset: 10,
        sortKey: 'item-10',
        secondaryKey: '2024-01-15T12:00:00Z',
      })

      expect(typeof cursor).toBe('string')
    })
  })
})

describe('parseCursor', () => {
  describe('valid cursor parsing', () => {
    it('parses cursor back to position', () => {
      const original: CursorPosition = { offset: 10 }
      const cursor = createCursor(original)
      const parsed = parseCursor(cursor)

      expect(parsed).not.toBeNull()
      expect(parsed?.offset).toBe(10)
    })

    it('parses cursor with sort key', () => {
      const original: CursorPosition = { offset: 20, sortKey: 'item-20' }
      const cursor = createCursor(original)
      const parsed = parseCursor(cursor)

      expect(parsed?.offset).toBe(20)
      expect(parsed?.sortKey).toBe('item-20')
    })

    it('parses cursor with composite key', () => {
      const original: CursorPosition = {
        offset: 30,
        sortKey: 'item-30',
        secondaryKey: '2024-01-15',
      }
      const cursor = createCursor(original)
      const parsed = parseCursor(cursor)

      expect(parsed?.offset).toBe(30)
      expect(parsed?.sortKey).toBe('item-30')
      expect(parsed?.secondaryKey).toBe('2024-01-15')
    })
  })

  describe('invalid cursor handling', () => {
    it('returns null for invalid cursor string', () => {
      const parsed = parseCursor('invalid-garbage-cursor')

      expect(parsed).toBeNull()
    })

    it('returns null for malformed base64', () => {
      const parsed = parseCursor('!!!not-valid!!!')

      expect(parsed).toBeNull()
    })

    it('returns null for empty string', () => {
      const parsed = parseCursor('')

      expect(parsed).toBeNull()
    })

    it('returns null for tampered cursor', () => {
      const cursor = createCursor({ offset: 10 })
      const tampered = cursor.slice(0, -3) + 'xxx'
      const parsed = parseCursor(tampered)

      expect(parsed).toBeNull()
    })
  })
})

// ============================================================================
// 2. Pagination Metadata Tests
// ============================================================================

describe('buildPaginationMeta', () => {
  describe('basic metadata', () => {
    it('includes limit in metadata', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 100,
        currentOffset: 0,
      })

      expect(meta.limit).toBe(20)
    })

    it('includes hasMore flag when more items exist', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 100,
        currentOffset: 0,
      })

      expect(meta.hasMore).toBe(true)
    })

    it('hasMore is false on last page', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 100,
        currentOffset: 80,
      })

      expect(meta.hasMore).toBe(false)
    })

    it('hasMore is false when all items fit in one page', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 15,
        currentOffset: 0,
      })

      expect(meta.hasMore).toBe(false)
    })
  })

  describe('total count', () => {
    it('includes total count when provided', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 150,
        currentOffset: 0,
      })

      expect(meta.total).toBe(150)
    })

    it('total is undefined when skipTotal is true', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        currentOffset: 0,
        skipTotal: true,
        actualItemCount: 20,
      })

      expect(meta.total).toBeUndefined()
    })

    it('hasMore works without total when actualItemCount provided', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        currentOffset: 0,
        skipTotal: true,
        actualItemCount: 20, // Full page returned, so hasMore is true
      })

      expect(meta.hasMore).toBe(true)
    })

    it('hasMore is false without total when partial page returned', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        currentOffset: 0,
        skipTotal: true,
        actualItemCount: 15, // Partial page, so hasMore is false
      })

      expect(meta.hasMore).toBe(false)
    })
  })

  describe('cursor generation', () => {
    it('includes cursor for next page', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 100,
        currentOffset: 0,
        lastItemKey: 'item-20',
      })

      expect(meta.cursor).toBeDefined()
      expect(typeof meta.cursor).toBe('string')
    })

    it('cursor is undefined on last page', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 100,
        currentOffset: 80,
      })

      expect(meta.cursor).toBeUndefined()
    })

    it('includes prevCursor when not on first page', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 100,
        currentOffset: 40,
        firstItemKey: 'item-41',
      })

      expect(meta.prevCursor).toBeDefined()
    })

    it('prevCursor is undefined on first page', () => {
      const meta = buildPaginationMeta({
        limit: 20,
        totalItems: 100,
        currentOffset: 0,
      })

      expect(meta.prevCursor).toBeUndefined()
    })
  })
})

// ============================================================================
// 3. Paginate Function Tests - Forward Pagination
// ============================================================================

describe('paginate - forward pagination', () => {
  const testItems = createTestItems(100)

  describe('first page', () => {
    it('returns first page with default limit', () => {
      const result = paginate(testItems, {})

      expect(result.data).toHaveLength(20) // Default limit
      expect(result.data[0].id).toBe('item-1')
      expect(result.meta.hasMore).toBe(true)
    })

    it('returns first page with custom limit', () => {
      const result = paginate(testItems, { limit: 10 })

      expect(result.data).toHaveLength(10)
      expect(result.data[0].id).toBe('item-1')
      expect(result.data[9].id).toBe('item-10')
    })

    it('includes cursor for next page', () => {
      const result = paginate(testItems, { limit: 10 })

      expect(result.meta.cursor).toBeDefined()
    })

    it('prevCursor is undefined on first page', () => {
      const result = paginate(testItems, { limit: 10 })

      expect(result.meta.prevCursor).toBeUndefined()
    })
  })

  describe('subsequent pages', () => {
    it('cursor fetches next page correctly', () => {
      const firstPage = paginate(testItems, { limit: 10 })
      const cursor = firstPage.meta.cursor!

      const secondPage = paginate(testItems, { limit: 10, cursor })

      expect(secondPage.data).toHaveLength(10)
      expect(secondPage.data[0].id).toBe('item-11')
      expect(secondPage.data[9].id).toBe('item-20')
    })

    it('second page includes prevCursor', () => {
      const firstPage = paginate(testItems, { limit: 10 })
      const cursor = firstPage.meta.cursor!

      const secondPage = paginate(testItems, { limit: 10, cursor })

      expect(secondPage.meta.prevCursor).toBeDefined()
    })

    it('maintains consistent ordering across pages', () => {
      const allIds: string[] = []
      let cursor: string | undefined

      for (let i = 0; i < 5; i++) {
        const result = paginate(testItems, { limit: 20, cursor })
        allIds.push(...result.data.map((item) => item.id))
        cursor = result.meta.cursor
        if (!cursor) break
      }

      // Should have no duplicates
      const uniqueIds = new Set(allIds)
      expect(uniqueIds.size).toBe(allIds.length)
    })
  })

  describe('last page', () => {
    it('hasMore is false on last page', () => {
      const items = createTestItems(25)
      const firstPage = paginate(items, { limit: 20 })
      const cursor = firstPage.meta.cursor!

      const lastPage = paginate(items, { limit: 20, cursor })

      expect(lastPage.data).toHaveLength(5)
      expect(lastPage.meta.hasMore).toBe(false)
    })

    it('cursor is undefined on last page', () => {
      const items = createTestItems(25)
      const firstPage = paginate(items, { limit: 20 })
      const cursor = firstPage.meta.cursor!

      const lastPage = paginate(items, { limit: 20, cursor })

      expect(lastPage.meta.cursor).toBeUndefined()
    })
  })
})

// ============================================================================
// 4. Paginate Function Tests - Backward Pagination
// ============================================================================

describe('paginate - backward pagination', () => {
  const testItems = createTestItems(100)

  describe('backward from middle', () => {
    it('direction: backward navigates to previous page', () => {
      // Get to second page first
      const firstPage = paginate(testItems, { limit: 10 })
      const secondPage = paginate(testItems, {
        limit: 10,
        cursor: firstPage.meta.cursor,
      })

      // Go back using prevCursor
      const backToFirst = paginate(testItems, {
        limit: 10,
        cursor: secondPage.meta.prevCursor,
        direction: 'backward',
      })

      expect(backToFirst.data[0].id).toBe('item-1')
      expect(backToFirst.data).toHaveLength(10)
    })

    it('backward pagination includes correct prevCursor', () => {
      // Navigate forward through several pages
      let cursor: string | undefined
      for (let i = 0; i < 3; i++) {
        const result = paginate(testItems, { limit: 10, cursor })
        cursor = result.meta.cursor
      }

      // Now on page 4, go backward
      const page4 = paginate(testItems, { limit: 10, cursor })
      const page3 = paginate(testItems, {
        limit: 10,
        cursor: page4.meta.prevCursor,
        direction: 'backward',
      })

      expect(page3.data[0].id).toBe('item-21') // Page 3 starts at item 21
    })
  })

  describe('backward from first page', () => {
    it('backward from first page returns empty or first page', () => {
      const firstPage = paginate(testItems, { limit: 10 })

      // prevCursor should be undefined on first page
      expect(firstPage.meta.prevCursor).toBeUndefined()
    })
  })
})

// ============================================================================
// 5. Edge Cases - Empty Results
// ============================================================================

describe('paginate - empty results', () => {
  it('returns empty data array for empty input', () => {
    const result = paginate([], { limit: 20 })

    expect(result.data).toEqual([])
    expect(result.meta.hasMore).toBe(false)
    expect(result.meta.total).toBe(0)
  })

  it('cursor is undefined for empty results', () => {
    const result = paginate([], { limit: 20 })

    expect(result.meta.cursor).toBeUndefined()
  })

  it('prevCursor is undefined for empty results', () => {
    const result = paginate([], { limit: 20 })

    expect(result.meta.prevCursor).toBeUndefined()
  })

  it('limit is preserved in metadata for empty results', () => {
    const result = paginate([], { limit: 50 })

    expect(result.meta.limit).toBe(50)
  })
})

// ============================================================================
// 6. Edge Cases - Single Page Results
// ============================================================================

describe('paginate - single page results', () => {
  it('all items fit in one page when count < limit', () => {
    const items = createTestItems(15)
    const result = paginate(items, { limit: 20 })

    expect(result.data).toHaveLength(15)
    expect(result.meta.hasMore).toBe(false)
    expect(result.meta.total).toBe(15)
  })

  it('cursor is undefined when all items fit', () => {
    const items = createTestItems(15)
    const result = paginate(items, { limit: 20 })

    expect(result.meta.cursor).toBeUndefined()
  })

  it('exact limit count is single page', () => {
    const items = createTestItems(20)
    const result = paginate(items, { limit: 20 })

    expect(result.data).toHaveLength(20)
    expect(result.meta.hasMore).toBe(false)
  })

  it('single item returns correctly', () => {
    const items = createTestItems(1)
    const result = paginate(items, { limit: 20 })

    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe('item-1')
    expect(result.meta.hasMore).toBe(false)
    expect(result.meta.total).toBe(1)
  })
})

// ============================================================================
// 7. Edge Cases - Large Result Sets
// ============================================================================

describe('paginate - large result sets', () => {
  it('handles large dataset efficiently', () => {
    const items = createTestItems(10000)
    const result = paginate(items, { limit: 100 })

    expect(result.data).toHaveLength(100)
    expect(result.meta.hasMore).toBe(true)
    expect(result.meta.total).toBe(10000)
  })

  it('cursor works through entire large dataset', () => {
    const items = createTestItems(1000)
    let cursor: string | undefined
    let totalFetched = 0
    let iterations = 0
    const maxIterations = 50 // Safety limit

    while (iterations < maxIterations) {
      const result = paginate(items, { limit: 100, cursor })
      totalFetched += result.data.length
      cursor = result.meta.cursor
      iterations++

      if (!cursor) break
    }

    expect(totalFetched).toBe(1000)
    expect(iterations).toBe(10) // 1000 / 100 = 10 pages
  })

  it('no duplicate items across pages in large dataset', () => {
    const items = createTestItems(500)
    const seenIds = new Set<string>()
    let cursor: string | undefined

    for (let i = 0; i < 25; i++) {
      const result = paginate(items, { limit: 20, cursor })

      for (const item of result.data) {
        expect(seenIds.has(item.id)).toBe(false)
        seenIds.add(item.id)
      }

      cursor = result.meta.cursor
      if (!cursor) break
    }

    expect(seenIds.size).toBe(500)
  })
})

// ============================================================================
// 8. Limit Parameter Tests
// ============================================================================

describe('paginate - limit parameter', () => {
  const testItems = createTestItems(150)

  describe('limit constraints', () => {
    it('default limit is 20', () => {
      const result = paginate(testItems, {})

      expect(result.data).toHaveLength(20)
      expect(result.meta.limit).toBe(20)
    })

    it('respects custom limit', () => {
      const result = paginate(testItems, { limit: 50 })

      expect(result.data).toHaveLength(50)
      expect(result.meta.limit).toBe(50)
    })

    it('max limit is enforced at 100', () => {
      const result = paginate(testItems, { limit: 500 })

      expect(result.data).toHaveLength(100)
      expect(result.meta.limit).toBe(100)
    })

    it('limit=0 returns empty array', () => {
      const result = paginate(testItems, { limit: 0 })

      expect(result.data).toEqual([])
      expect(result.meta.limit).toBe(0)
    })

    it('negative limit treated as default', () => {
      const result = paginate(testItems, { limit: -5 })

      expect(result.data).toHaveLength(20)
      expect(result.meta.limit).toBe(20)
    })
  })
})

// ============================================================================
// 9. Type Safety Tests
// ============================================================================

describe('type safety', () => {
  interface TestItem {
    id: string
    name: string
  }

  it('preserves item type in result', () => {
    const items: TestItem[] = [
      { id: '1', name: 'One' },
      { id: '2', name: 'Two' },
    ]

    const result: PaginatedResult<TestItem> = paginate(items, { limit: 10 })

    expect(result.data[0].id).toBe('1')
    expect(result.data[0].name).toBe('One')
  })

  it('PaginationMeta has correct shape', () => {
    const items = createTestItems(50)
    const result = paginate(items, { limit: 20 })
    const meta: PaginationMeta = result.meta

    expect(typeof meta.limit).toBe('number')
    expect(typeof meta.hasMore).toBe('boolean')
    if (meta.total !== undefined) {
      expect(typeof meta.total).toBe('number')
    }
    if (meta.cursor !== undefined) {
      expect(typeof meta.cursor).toBe('string')
    }
  })

  it('PaginationParams accepts all valid options', () => {
    const params: PaginationParams = {
      limit: 20,
      cursor: 'abc123',
      direction: 'forward',
    }

    const items = createTestItems(50)
    // Should not throw type errors
    const _result = paginate(items, params)
    expect(_result).toBeDefined()
  })
})

// ============================================================================
// 10. Integration Tests - REST/RPC/Compat Consistency
// ============================================================================

describe('pagination interface consistency', () => {
  it('PaginatedResult has data array', () => {
    const items = createTestItems(10)
    const result = paginate(items, { limit: 5 })

    expect(result.data).toBeDefined()
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('PaginatedResult has meta object', () => {
    const items = createTestItems(10)
    const result = paginate(items, { limit: 5 })

    expect(result.meta).toBeDefined()
    expect(typeof result.meta).toBe('object')
  })

  it('meta contains standard fields', () => {
    const items = createTestItems(50)
    const result = paginate(items, { limit: 20 })

    expect(result.meta).toHaveProperty('limit')
    expect(result.meta).toHaveProperty('hasMore')
    expect(result.meta).toHaveProperty('total')
  })

  it('cursor-based pagination works consistently', () => {
    const items = createTestItems(100)

    // First request
    const page1 = paginate(items, { limit: 25 })
    expect(page1.data).toHaveLength(25)
    expect(page1.meta.hasMore).toBe(true)
    expect(page1.meta.cursor).toBeDefined()

    // Second request with cursor
    const page2 = paginate(items, { limit: 25, cursor: page1.meta.cursor })
    expect(page2.data).toHaveLength(25)
    expect(page2.data[0].id).toBe('item-26')
    expect(page2.meta.prevCursor).toBeDefined()
  })
})
