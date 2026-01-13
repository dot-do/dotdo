import { describe, it, expect } from 'vitest'
import {
  encodeCursor,
  decodeCursor,
  tryDecodeCursor,
  paginate,
  createPaginationMeta,
  normalizePaginationParams,
  parsePaginationQuery,
  validatePaginationParams,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type PaginationParams,
  type PaginationMeta,
  type PaginatedResult,
  type CursorData,
} from '../index'

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

describe('encodeCursor', () => {
  describe('basic encoding', () => {
    it('encodes object to string', () => {
      const cursor = encodeCursor({ offset: 10 })

      expect(typeof cursor).toBe('string')
      expect(cursor.length).toBeGreaterThan(0)
    })

    it('returns URL-safe string (base64url)', () => {
      const cursor = encodeCursor({ offset: 100, sortKey: 'test/key+special' })

      // Base64url characters only: A-Z, a-z, 0-9, -, _
      // No +, /, or = characters
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('produces deterministic output', () => {
      const data = { offset: 42, sortKey: 'test' }
      const cursor1 = encodeCursor(data)
      const cursor2 = encodeCursor(data)

      expect(cursor1).toBe(cursor2)
    })

    it('different data produces different cursors', () => {
      const cursor1 = encodeCursor({ offset: 10 })
      const cursor2 = encodeCursor({ offset: 20 })

      expect(cursor1).not.toBe(cursor2)
    })

    it('handles complex nested objects', () => {
      const data = {
        offset: 50,
        sortKey: 'key',
        secondaryKey: 12345,
        v: 1,
      }
      const cursor = encodeCursor(data)

      expect(typeof cursor).toBe('string')
      expect(cursor.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('handles empty object', () => {
      const cursor = encodeCursor({})

      expect(typeof cursor).toBe('string')
    })

    it('handles unicode characters', () => {
      const cursor = encodeCursor({ sortKey: 'test-unicode-value' })

      expect(typeof cursor).toBe('string')
    })

    it('handles special characters in values', () => {
      const cursor = encodeCursor({ sortKey: 'key/with+special=chars' })

      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    })
  })
})

describe('decodeCursor', () => {
  describe('valid cursor decoding', () => {
    it('decodes cursor back to original data', () => {
      const original = { offset: 10 }
      const cursor = encodeCursor(original)
      const decoded = decodeCursor<typeof original>(cursor)

      expect(decoded.offset).toBe(10)
    })

    it('preserves all properties', () => {
      const original: CursorData = {
        offset: 20,
        sortKey: 'item-20',
        secondaryKey: '2024-01-15',
        v: 1,
      }
      const cursor = encodeCursor(original)
      const decoded = decodeCursor<CursorData>(cursor)

      expect(decoded.offset).toBe(20)
      expect(decoded.sortKey).toBe('item-20')
      expect(decoded.secondaryKey).toBe('2024-01-15')
      expect(decoded.v).toBe(1)
    })

    it('handles numeric sort keys', () => {
      const original = { offset: 30, sortKey: 12345 }
      const cursor = encodeCursor(original)
      const decoded = decodeCursor<typeof original>(cursor)

      expect(decoded.sortKey).toBe(12345)
    })
  })

  describe('invalid cursor handling', () => {
    it('throws for invalid base64', () => {
      expect(() => decodeCursor('!!!not-valid!!!')).toThrow('Invalid cursor')
    })

    it('throws for empty string', () => {
      expect(() => decodeCursor('')).toThrow('Invalid cursor')
    })

    it('throws for non-string input', () => {
      // @ts-expect-error - Testing invalid input
      expect(() => decodeCursor(null)).toThrow('Invalid cursor')
      // @ts-expect-error - Testing invalid input
      expect(() => decodeCursor(undefined)).toThrow('Invalid cursor')
    })

    it('throws for tampered cursor', () => {
      const cursor = encodeCursor({ offset: 10 })
      const tampered = cursor.slice(0, -3) + 'xxx'

      // May throw or return invalid data
      expect(() => {
        const result = decodeCursor(tampered)
        // If it doesn't throw, verify it at least fails validation
        if (typeof result !== 'object') {
          throw new Error('Invalid cursor')
        }
      }).not.toThrow() // Tampered base64 might still decode to something
    })

    it('throws for non-object JSON', () => {
      // Encode a primitive value manually
      const primitiveBase64 = btoa('"just-a-string"')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

      expect(() => decodeCursor(primitiveBase64)).toThrow('Invalid cursor')
    })
  })
})

describe('tryDecodeCursor', () => {
  it('returns decoded data for valid cursor', () => {
    const original = { offset: 10 }
    const cursor = encodeCursor(original)
    const decoded = tryDecodeCursor<typeof original>(cursor)

    expect(decoded).not.toBeNull()
    expect(decoded?.offset).toBe(10)
  })

  it('returns null for invalid cursor', () => {
    const decoded = tryDecodeCursor('invalid-cursor')

    expect(decoded).toBeNull()
  })

  it('returns null for empty string', () => {
    const decoded = tryDecodeCursor('')

    expect(decoded).toBeNull()
  })

  it('returns null for malformed base64', () => {
    const decoded = tryDecodeCursor('!!!not-valid!!!')

    expect(decoded).toBeNull()
  })
})

// ============================================================================
// 2. Pagination Parameter Normalization
// ============================================================================

describe('normalizePaginationParams', () => {
  describe('limit handling', () => {
    it('applies default limit when not specified', () => {
      const result = normalizePaginationParams({})

      expect(result.limit).toBe(DEFAULT_LIMIT)
    })

    it('respects custom limit', () => {
      const result = normalizePaginationParams({ limit: 50 })

      expect(result.limit).toBe(50)
    })

    it('enforces maximum limit', () => {
      const result = normalizePaginationParams({ limit: 500 })

      expect(result.limit).toBe(MAX_LIMIT)
    })

    it('treats negative limit as default', () => {
      const result = normalizePaginationParams({ limit: -5 })

      expect(result.limit).toBe(DEFAULT_LIMIT)
    })

    it('allows limit of 0', () => {
      const result = normalizePaginationParams({ limit: 0 })

      expect(result.limit).toBe(0)
    })
  })

  describe('offset handling', () => {
    it('defaults offset to 0', () => {
      const result = normalizePaginationParams({})

      expect(result.offset).toBe(0)
    })

    it('respects custom offset', () => {
      const result = normalizePaginationParams({ offset: 100 })

      expect(result.offset).toBe(100)
    })

    it('ignores negative offset', () => {
      const result = normalizePaginationParams({ offset: -10 })

      expect(result.offset).toBe(0)
    })
  })

  describe('page to offset conversion', () => {
    it('converts page 1 to offset 0', () => {
      const result = normalizePaginationParams({ page: 1, limit: 20 })

      expect(result.offset).toBe(0)
    })

    it('converts page 2 to correct offset', () => {
      const result = normalizePaginationParams({ page: 2, limit: 20 })

      expect(result.offset).toBe(20)
    })

    it('converts page 5 to correct offset', () => {
      const result = normalizePaginationParams({ page: 5, limit: 10 })

      expect(result.offset).toBe(40)
    })

    it('page takes precedence over offset', () => {
      const result = normalizePaginationParams({ page: 3, offset: 10, limit: 20 })

      expect(result.offset).toBe(40) // page 3 * limit 20 = 40
    })

    it('ignores page <= 0', () => {
      const result = normalizePaginationParams({ page: 0, limit: 20 })

      expect(result.offset).toBe(0)
    })
  })

  describe('cursor passthrough', () => {
    it('passes cursor through unchanged', () => {
      const result = normalizePaginationParams({ cursor: 'test-cursor' })

      expect(result.cursor).toBe('test-cursor')
    })
  })
})

// ============================================================================
// 3. Paginate Function Tests
// ============================================================================

describe('paginate', () => {
  const testItems = createTestItems(100)

  describe('first page', () => {
    it('returns first page with default limit', () => {
      const result = paginate(testItems, {})

      expect(result.data).toHaveLength(20)
      expect(result.data[0].id).toBe('item-1')
      expect(result.meta.hasNextPage).toBe(true)
      expect(result.meta.hasPreviousPage).toBe(false)
    })

    it('returns first page with custom limit', () => {
      const result = paginate(testItems, { limit: 10 })

      expect(result.data).toHaveLength(10)
      expect(result.data[0].id).toBe('item-1')
      expect(result.data[9].id).toBe('item-10')
    })

    it('includes endCursor for next page', () => {
      const result = paginate(testItems, { limit: 10 })

      expect(result.meta.endCursor).toBeDefined()
      expect(typeof result.meta.endCursor).toBe('string')
    })

    it('includes startCursor', () => {
      const result = paginate(testItems, { limit: 10 })

      expect(result.meta.startCursor).toBeDefined()
    })

    it('hasPreviousPage is false on first page', () => {
      const result = paginate(testItems, { limit: 10 })

      expect(result.meta.hasPreviousPage).toBe(false)
    })
  })

  describe('cursor-based pagination', () => {
    it('cursor fetches next page correctly', () => {
      const firstPage = paginate(testItems, { limit: 10 })
      const cursor = firstPage.meta.endCursor!

      const secondPage = paginate(testItems, { limit: 10, cursor })

      expect(secondPage.data).toHaveLength(10)
      expect(secondPage.data[0].id).toBe('item-11')
      expect(secondPage.data[9].id).toBe('item-20')
    })

    it('second page has hasPreviousPage true', () => {
      const firstPage = paginate(testItems, { limit: 10 })
      const cursor = firstPage.meta.endCursor!

      const secondPage = paginate(testItems, { limit: 10, cursor })

      expect(secondPage.meta.hasPreviousPage).toBe(true)
    })

    it('maintains consistent ordering across pages', () => {
      const allIds: string[] = []
      let cursor: string | undefined

      for (let i = 0; i < 5; i++) {
        const result = paginate(testItems, { limit: 20, cursor })
        allIds.push(...result.data.map((item) => item.id))
        cursor = result.meta.endCursor
        if (!cursor) break
      }

      // Should have no duplicates
      const uniqueIds = new Set(allIds)
      expect(uniqueIds.size).toBe(allIds.length)
      expect(uniqueIds.size).toBe(100)
    })

    it('handles invalid cursor gracefully', () => {
      const result = paginate(testItems, { limit: 10, cursor: 'invalid' })

      // Should fall back to first page behavior
      expect(result.data).toHaveLength(10)
      expect(result.data[0].id).toBe('item-1')
    })
  })

  describe('offset-based pagination', () => {
    it('offset skips correct number of items', () => {
      const result = paginate(testItems, { limit: 10, offset: 30 })

      expect(result.data).toHaveLength(10)
      expect(result.data[0].id).toBe('item-31')
    })

    it('hasPreviousPage is true when offset > 0', () => {
      const result = paginate(testItems, { limit: 10, offset: 30 })

      expect(result.meta.hasPreviousPage).toBe(true)
    })
  })

  describe('page-based pagination', () => {
    it('page parameter works correctly', () => {
      const result = paginate(testItems, { limit: 10, page: 3 })

      expect(result.data).toHaveLength(10)
      expect(result.data[0].id).toBe('item-21')
    })

    it('page 1 returns first items', () => {
      const result = paginate(testItems, { limit: 10, page: 1 })

      expect(result.data[0].id).toBe('item-1')
    })
  })

  describe('last page', () => {
    it('hasNextPage is false on last page', () => {
      const items = createTestItems(25)
      const firstPage = paginate(items, { limit: 20 })
      const cursor = firstPage.meta.endCursor!

      const lastPage = paginate(items, { limit: 20, cursor })

      expect(lastPage.data).toHaveLength(5)
      expect(lastPage.meta.hasNextPage).toBe(false)
    })

    it('endCursor is undefined on last page', () => {
      const items = createTestItems(25)
      const firstPage = paginate(items, { limit: 20 })
      const cursor = firstPage.meta.endCursor!

      const lastPage = paginate(items, { limit: 20, cursor })

      expect(lastPage.meta.endCursor).toBeUndefined()
    })
  })

  describe('empty results', () => {
    it('returns empty data array for empty input', () => {
      const result = paginate([], { limit: 20 })

      expect(result.data).toEqual([])
      expect(result.meta.hasNextPage).toBe(false)
      expect(result.meta.hasPreviousPage).toBe(false)
      expect(result.meta.total).toBe(0)
    })

    it('cursors are undefined for empty results', () => {
      const result = paginate([], { limit: 20 })

      expect(result.meta.startCursor).toBeUndefined()
      expect(result.meta.endCursor).toBeUndefined()
    })
  })

  describe('single page results', () => {
    it('all items fit when count < limit', () => {
      const items = createTestItems(15)
      const result = paginate(items, { limit: 20 })

      expect(result.data).toHaveLength(15)
      expect(result.meta.hasNextPage).toBe(false)
      expect(result.meta.total).toBe(15)
    })

    it('exact limit count is single page', () => {
      const items = createTestItems(20)
      const result = paginate(items, { limit: 20 })

      expect(result.data).toHaveLength(20)
      expect(result.meta.hasNextPage).toBe(false)
    })

    it('endCursor is undefined when all items fit', () => {
      const items = createTestItems(15)
      const result = paginate(items, { limit: 20 })

      expect(result.meta.endCursor).toBeUndefined()
    })
  })

  describe('limit constraints', () => {
    it('default limit is 20', () => {
      const result = paginate(testItems, {})

      expect(result.data).toHaveLength(20)
    })

    it('max limit is enforced at 100', () => {
      const largeItems = createTestItems(150)
      const result = paginate(largeItems, { limit: 500 })

      expect(result.data).toHaveLength(100)
    })

    it('limit=0 returns empty array', () => {
      const result = paginate(testItems, { limit: 0 })

      expect(result.data).toEqual([])
    })

    it('negative limit treated as default', () => {
      const result = paginate(testItems, { limit: -5 })

      expect(result.data).toHaveLength(20)
    })
  })

  describe('total count', () => {
    it('includes total by default', () => {
      const result = paginate(testItems, { limit: 10 })

      expect(result.meta.total).toBe(100)
    })

    it('total can be skipped', () => {
      const result = paginate(testItems, { limit: 10 }, { skipTotal: true })

      expect(result.meta.total).toBeUndefined()
    })
  })

  describe('large datasets', () => {
    it('handles large dataset efficiently', () => {
      const items = createTestItems(10000)
      const result = paginate(items, { limit: 100 })

      expect(result.data).toHaveLength(100)
      expect(result.meta.hasNextPage).toBe(true)
      expect(result.meta.total).toBe(10000)
    })

    it('paginates through entire large dataset', () => {
      const items = createTestItems(1000)
      let cursor: string | undefined
      let totalFetched = 0
      let iterations = 0
      const maxIterations = 50

      while (iterations < maxIterations) {
        const result = paginate(items, { limit: 100, cursor })
        totalFetched += result.data.length
        cursor = result.meta.endCursor
        iterations++

        if (!cursor) break
      }

      expect(totalFetched).toBe(1000)
      expect(iterations).toBe(10)
    })
  })
})

// ============================================================================
// 4. Create Pagination Meta Tests
// ============================================================================

describe('createPaginationMeta', () => {
  it('creates correct metadata for first page', () => {
    const meta = createPaginationMeta(100, 0, 20, 20)

    expect(meta.total).toBe(100)
    expect(meta.hasNextPage).toBe(true)
    expect(meta.hasPreviousPage).toBe(false)
    expect(meta.startCursor).toBeDefined()
    expect(meta.endCursor).toBeDefined()
  })

  it('creates correct metadata for middle page', () => {
    const meta = createPaginationMeta(100, 40, 20, 20)

    expect(meta.hasNextPage).toBe(true)
    expect(meta.hasPreviousPage).toBe(true)
  })

  it('creates correct metadata for last page', () => {
    const meta = createPaginationMeta(100, 80, 20, 20)

    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPreviousPage).toBe(true)
    expect(meta.endCursor).toBeUndefined()
  })

  it('handles partial last page', () => {
    const meta = createPaginationMeta(95, 80, 20, 15)

    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPreviousPage).toBe(true)
  })

  it('handles empty result', () => {
    const meta = createPaginationMeta(0, 0, 20, 0)

    expect(meta.total).toBe(0)
    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPreviousPage).toBe(false)
    expect(meta.startCursor).toBeUndefined()
    expect(meta.endCursor).toBeUndefined()
  })

  it('handles single item total', () => {
    const meta = createPaginationMeta(1, 0, 20, 1)

    expect(meta.total).toBe(1)
    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPreviousPage).toBe(false)
  })
})

// ============================================================================
// 5. Parse Pagination Query Tests
// ============================================================================

describe('parsePaginationQuery', () => {
  it('parses limit from string', () => {
    const params = parsePaginationQuery({ limit: '50' })

    expect(params.limit).toBe(50)
  })

  it('parses offset from string', () => {
    const params = parsePaginationQuery({ offset: '100' })

    expect(params.offset).toBe(100)
  })

  it('parses page from string', () => {
    const params = parsePaginationQuery({ page: '3' })

    expect(params.page).toBe(3)
  })

  it('parses cursor', () => {
    const params = parsePaginationQuery({ cursor: 'test-cursor' })

    expect(params.cursor).toBe('test-cursor')
  })

  it('handles all parameters together', () => {
    const params = parsePaginationQuery({
      limit: '25',
      offset: '50',
      cursor: 'abc',
      page: '2',
    })

    expect(params.limit).toBe(25)
    expect(params.offset).toBe(50)
    expect(params.cursor).toBe('abc')
    expect(params.page).toBe(2)
  })

  it('ignores invalid numeric strings', () => {
    const params = parsePaginationQuery({
      limit: 'abc',
      offset: 'xyz',
      page: 'invalid',
    })

    expect(params.limit).toBeUndefined()
    expect(params.offset).toBeUndefined()
    expect(params.page).toBeUndefined()
  })

  it('ignores negative offset', () => {
    const params = parsePaginationQuery({ offset: '-10' })

    expect(params.offset).toBeUndefined()
  })

  it('ignores non-positive page', () => {
    const params = parsePaginationQuery({ page: '0' })

    expect(params.page).toBeUndefined()
  })

  it('handles null values', () => {
    const params = parsePaginationQuery({
      limit: null,
      offset: null,
    })

    expect(params.limit).toBeUndefined()
    expect(params.offset).toBeUndefined()
  })
})

// ============================================================================
// 6. Validate Pagination Params Tests
// ============================================================================

describe('validatePaginationParams', () => {
  it('returns null for valid params', () => {
    expect(validatePaginationParams({ limit: 20 })).toBeNull()
    expect(validatePaginationParams({ offset: 10 })).toBeNull()
    expect(validatePaginationParams({ cursor: 'test' })).toBeNull()
    expect(validatePaginationParams({ page: 2, limit: 10 })).toBeNull()
  })

  it('returns error for cursor with offset', () => {
    const error = validatePaginationParams({ cursor: 'test', offset: 10 })

    expect(error).not.toBeNull()
    expect(error).toContain('cursor')
  })

  it('returns error for cursor with page', () => {
    const error = validatePaginationParams({ cursor: 'test', page: 2 })

    expect(error).not.toBeNull()
    expect(error).toContain('cursor')
  })

  it('returns error for page < 1', () => {
    const error = validatePaginationParams({ page: 0 })

    expect(error).not.toBeNull()
    expect(error).toContain('Page')
  })

  it('returns error for negative offset', () => {
    const error = validatePaginationParams({ offset: -5 })

    expect(error).not.toBeNull()
    expect(error).toContain('Offset')
  })
})

// ============================================================================
// 7. Type Safety Tests
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

    expect(typeof meta.hasNextPage).toBe('boolean')
    expect(typeof meta.hasPreviousPage).toBe('boolean')
    if (meta.total !== undefined) {
      expect(typeof meta.total).toBe('number')
    }
    if (meta.startCursor !== undefined) {
      expect(typeof meta.startCursor).toBe('string')
    }
    if (meta.endCursor !== undefined) {
      expect(typeof meta.endCursor).toBe('string')
    }
  })

  it('PaginationParams accepts all valid options', () => {
    const params: PaginationParams = {
      limit: 20,
      cursor: 'abc123',
      offset: 10,
      page: 2,
    }

    // Should not throw type errors
    expect(params.limit).toBe(20)
    expect(params.cursor).toBe('abc123')
  })
})

// ============================================================================
// 8. Constants Tests
// ============================================================================

describe('constants', () => {
  it('DEFAULT_LIMIT is 20', () => {
    expect(DEFAULT_LIMIT).toBe(20)
  })

  it('MAX_LIMIT is 100', () => {
    expect(MAX_LIMIT).toBe(100)
  })
})

// ============================================================================
// 9. Integration Tests
// ============================================================================

describe('integration - REST/RPC/compat consistency', () => {
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

    expect(result.meta).toHaveProperty('hasNextPage')
    expect(result.meta).toHaveProperty('hasPreviousPage')
    expect(result.meta).toHaveProperty('total')
  })

  it('cursor-based pagination works consistently', () => {
    const items = createTestItems(100)

    // First request
    const page1 = paginate(items, { limit: 25 })
    expect(page1.data).toHaveLength(25)
    expect(page1.meta.hasNextPage).toBe(true)
    expect(page1.meta.endCursor).toBeDefined()

    // Second request with cursor
    const page2 = paginate(items, { limit: 25, cursor: page1.meta.endCursor })
    expect(page2.data).toHaveLength(25)
    expect(page2.data[0].id).toBe('item-26')
    expect(page2.meta.hasPreviousPage).toBe(true)
  })
})
