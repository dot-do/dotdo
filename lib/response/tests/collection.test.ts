import { describe, it, expect } from 'vitest'

/**
 * Collection Response Tests (RED Phase)
 *
 * These tests verify the collection response builder for constructing
 * paginated, filterable collection responses in the dotdo response format.
 *
 * They are expected to FAIL until lib/response/collection.ts is implemented.
 *
 * Expected function signature (to be implemented):
 *
 * interface CollectionResponseOptions {
 *   ns: string
 *   type: string
 *   parent?: string
 *   pagination?: {
 *     after?: string
 *     before?: string
 *     hasNext?: boolean
 *     hasPrev?: boolean
 *   }
 *   facets?: {
 *     sort?: string[]
 *     filter?: Record<string, string[]>
 *   }
 *   customActions?: string[]
 * }
 *
 * export function buildCollectionResponse<T extends object>(
 *   items: T[],
 *   count: number,
 *   options: CollectionResponseOptions
 * ): {
 *   $context: string
 *   $type: string
 *   $id: string
 *   count: number
 *   links: Record<string, string>
 *   facets?: { sort?: string[]; filter?: Record<string, string[]> }
 *   actions: Record<string, string>
 *   items: Array<T & { $context: string; $type: string; $id: string }>
 * }
 *
 * Response Format:
 * - $context: The namespace URL
 * - $type: The type URL (namespace + '/' + pluralize(type))
 * - $id: The collection URL (same as $type for collections)
 * - count: Total number of items (not just page size)
 * - links: Navigation links (home, first, prev, next, last)
 * - facets: Available sort and filter options
 * - actions: Available actions (create, etc.)
 * - items: Array of items with full $context/$type/$id shape
 *
 * Examples:
 * - Basic: { $context: "https://headless.ly", $type: "https://headless.ly/customers", ... }
 * - With pagination: links include prev/next with cursor params
 * - With facets: { sort: ['name', '-createdAt'], filter: { status: ['active', 'pending'] } }
 */

// Import the module under test (will fail until implemented)
import { buildCollectionResponse } from '../collection'

// ============================================================================
// Basic Collection Tests
// ============================================================================

describe('buildCollectionResponse', () => {
  describe('basic collection shape', () => {
    it('returns object with $context field', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.$context).toBe('https://headless.ly')
    })

    it('returns object with $type field as pluralized type URL', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.$type).toBe('https://headless.ly/customers')
    })

    it('returns object with $id field same as $type for collections', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.$id).toBe('https://headless.ly/customers')
    })

    it('returns object with count field', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.count).toBe(100)
    })

    it('count reflects total items, not page size', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }],
        500,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.count).toBe(500)
      expect(result.items).toHaveLength(2)
    })

    it('returns items array', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns empty items array when given empty input', () => {
      const result = buildCollectionResponse(
        [],
        0,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items).toEqual([])
      expect(result.count).toBe(0)
    })
  })

  // ============================================================================
  // Item Shape Tests ($context/$type/$id)
  // ============================================================================

  describe('item shape with $context/$type/$id', () => {
    it('each item has $context field', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items[0].$context).toBe('https://headless.ly')
    })

    it('each item has $type field', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items[0].$type).toBe('https://headless.ly/customers')
    })

    it('each item has $id field constructed from item id', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items[0].$id).toBe('https://headless.ly/customers/alice')
    })

    it('preserves original item properties', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice', email: 'alice@example.com' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items[0].id).toBe('alice')
      expect(result.items[0].name).toBe('Alice')
      expect(result.items[0].email).toBe('alice@example.com')
    })

    it('handles multiple items correctly', () => {
      const result = buildCollectionResponse(
        [
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' },
          { id: 'charlie', name: 'Charlie' },
        ],
        300,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items).toHaveLength(3)
      expect(result.items[0].$id).toBe('https://headless.ly/customers/alice')
      expect(result.items[1].$id).toBe('https://headless.ly/customers/bob')
      expect(result.items[2].$id).toBe('https://headless.ly/customers/charlie')
    })

    it('URL-encodes special characters in item id', () => {
      const result = buildCollectionResponse(
        [{ id: 'user@example.com', name: 'User' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items[0].$id).toBe('https://headless.ly/customers/user%40example.com')
    })
  })

  // ============================================================================
  // Links Tests (home, first, prev, next, last)
  // ============================================================================

  describe('links field', () => {
    it('has links object', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.links).toBeDefined()
      expect(typeof result.links).toBe('object')
    })

    it('has home link pointing to namespace', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.links.home).toBe('https://headless.ly')
    })

    it('has first link pointing to collection without pagination', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.links.first).toBe('https://headless.ly/customers')
    })

    it('has last link when pagination info available', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          pagination: { hasNext: true },
        }
      )

      expect(result.links.last).toBeDefined()
    })
  })

  // ============================================================================
  // Pagination Links Tests
  // ============================================================================

  describe('pagination links', () => {
    it('includes prev link when hasPrev is true', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          pagination: {
            before: 'cursor123',
            hasPrev: true,
          },
        }
      )

      expect(result.links.prev).toBeDefined()
      expect(result.links.prev).toContain('before=')
    })

    it('does not include prev link when hasPrev is false', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          pagination: {
            hasPrev: false,
          },
        }
      )

      expect(result.links.prev).toBeUndefined()
    })

    it('includes next link when hasNext is true', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          pagination: {
            after: 'cursor456',
            hasNext: true,
          },
        }
      )

      expect(result.links.next).toBeDefined()
      expect(result.links.next).toContain('after=')
    })

    it('does not include next link when hasNext is false', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          pagination: {
            hasNext: false,
          },
        }
      )

      expect(result.links.next).toBeUndefined()
    })

    it('includes cursor value in prev link', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          pagination: {
            before: 'abc123',
            hasPrev: true,
          },
        }
      )

      expect(result.links.prev).toContain('before=abc123')
    })

    it('includes cursor value in next link', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          pagination: {
            after: 'xyz789',
            hasNext: true,
          },
        }
      )

      expect(result.links.next).toContain('after=xyz789')
    })

    it('omits pagination links when no pagination option provided', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        1,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.links.prev).toBeUndefined()
      expect(result.links.next).toBeUndefined()
    })
  })

  // ============================================================================
  // Facets Tests (sort and filter options)
  // ============================================================================

  describe('facets field', () => {
    it('includes facets when provided', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          facets: {
            sort: ['name', '-createdAt'],
          },
        }
      )

      expect(result.facets).toBeDefined()
    })

    it('omits facets when not provided', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.facets).toBeUndefined()
    })

    it('includes sort options', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          facets: {
            sort: ['name', '-createdAt', 'email'],
          },
        }
      )

      expect(result.facets?.sort).toEqual(['name', '-createdAt', 'email'])
    })

    it('includes filter options', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          facets: {
            filter: {
              status: ['active', 'pending', 'inactive'],
              tier: ['free', 'pro', 'enterprise'],
            },
          },
        }
      )

      expect(result.facets?.filter).toEqual({
        status: ['active', 'pending', 'inactive'],
        tier: ['free', 'pro', 'enterprise'],
      })
    })

    it('includes both sort and filter options', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          facets: {
            sort: ['name', '-createdAt'],
            filter: {
              status: ['active', 'pending'],
            },
          },
        }
      )

      expect(result.facets?.sort).toEqual(['name', '-createdAt'])
      expect(result.facets?.filter).toEqual({ status: ['active', 'pending'] })
    })

    it('handles empty sort array', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          facets: {
            sort: [],
          },
        }
      )

      expect(result.facets?.sort).toEqual([])
    })

    it('handles empty filter object', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          facets: {
            filter: {},
          },
        }
      )

      expect(result.facets?.filter).toEqual({})
    })
  })

  // ============================================================================
  // Actions Tests (create and custom actions)
  // ============================================================================

  describe('actions field', () => {
    it('has actions object', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.actions).toBeDefined()
      expect(typeof result.actions).toBe('object')
    })

    it('has create action pointing to collection URL', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.actions.create).toBe('https://headless.ly/customers')
    })

    it('includes custom actions', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          customActions: ['import', 'export'],
        }
      )

      expect(result.actions.import).toBeDefined()
      expect(result.actions.export).toBeDefined()
    })

    it('custom actions point to collection URL with action suffix', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          customActions: ['import'],
        }
      )

      expect(result.actions.import).toBe('https://headless.ly/customers/import')
    })

    it('includes multiple custom actions', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          customActions: ['import', 'export', 'bulk-delete'],
        }
      )

      expect(result.actions.import).toBe('https://headless.ly/customers/import')
      expect(result.actions.export).toBe('https://headless.ly/customers/export')
      expect(result.actions['bulk-delete']).toBe('https://headless.ly/customers/bulk-delete')
    })

    it('preserves create action when custom actions provided', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          customActions: ['import'],
        }
      )

      expect(result.actions.create).toBe('https://headless.ly/customers')
      expect(result.actions.import).toBeDefined()
    })
  })

  // ============================================================================
  // Parent Context Tests
  // ============================================================================

  describe('parent option', () => {
    it('uses parent for $context when provided', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-123', total: 99.99 }],
        50,
        {
          ns: 'https://headless.ly',
          type: 'Order',
          parent: 'https://headless.ly/customers/alice',
        }
      )

      expect(result.$context).toBe('https://headless.ly/customers/alice')
    })

    it('uses parent in item $context when provided', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-123', total: 99.99 }],
        50,
        {
          ns: 'https://headless.ly',
          type: 'Order',
          parent: 'https://headless.ly/customers/alice',
        }
      )

      expect(result.items[0].$context).toBe('https://headless.ly/customers/alice')
    })

    it('uses parent-based type URL when parent provided', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-123', total: 99.99 }],
        50,
        {
          ns: 'https://headless.ly',
          type: 'Order',
          parent: 'https://headless.ly/customers/alice',
        }
      )

      expect(result.$type).toBe('https://headless.ly/customers/alice/orders')
    })

    it('uses parent-based $id for collection', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-123', total: 99.99 }],
        50,
        {
          ns: 'https://headless.ly',
          type: 'Order',
          parent: 'https://headless.ly/customers/alice',
        }
      )

      expect(result.$id).toBe('https://headless.ly/customers/alice/orders')
    })

    it('uses parent-based $id for items', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-123', total: 99.99 }],
        50,
        {
          ns: 'https://headless.ly',
          type: 'Order',
          parent: 'https://headless.ly/customers/alice',
        }
      )

      expect(result.items[0].$id).toBe('https://headless.ly/customers/alice/orders/ord-123')
    })
  })

  // ============================================================================
  // Type Pluralization Tests
  // ============================================================================

  describe('type pluralization', () => {
    it('pluralizes regular nouns', () => {
      const result = buildCollectionResponse(
        [{ id: '1', name: 'Product 1' }],
        10,
        { ns: 'https://headless.ly', type: 'Product' }
      )

      expect(result.$type).toBe('https://headless.ly/products')
    })

    it('pluralizes nouns ending in y', () => {
      const result = buildCollectionResponse(
        [{ id: '1', name: 'Category 1' }],
        10,
        { ns: 'https://headless.ly', type: 'Category' }
      )

      expect(result.$type).toBe('https://headless.ly/categories')
    })

    it('handles irregular plurals - Person', () => {
      const result = buildCollectionResponse(
        [{ id: 'john', name: 'John' }],
        10,
        { ns: 'https://headless.ly', type: 'Person' }
      )

      expect(result.$type).toBe('https://headless.ly/people')
    })

    it('handles irregular plurals - Child', () => {
      const result = buildCollectionResponse(
        [{ id: '1', name: 'Child 1' }],
        10,
        { ns: 'https://headless.ly', type: 'Child' }
      )

      expect(result.$type).toBe('https://headless.ly/children')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles namespace with trailing slash', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly/', type: 'Customer' }
      )

      // Should not double up slashes
      expect(result.$type).toBe('https://headless.ly/customers')
    })

    it('handles namespace with port', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://localhost:8787', type: 'Customer' }
      )

      expect(result.$context).toBe('https://localhost:8787')
      expect(result.$type).toBe('https://localhost:8787/customers')
    })

    it('handles namespace with path segments', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://api.example.com/v1/tenant', type: 'Customer' }
      )

      expect(result.$context).toBe('https://api.example.com/v1/tenant')
      expect(result.$type).toBe('https://api.example.com/v1/tenant/customers')
    })

    it('handles items with complex nested properties', () => {
      const result = buildCollectionResponse(
        [{
          id: 'alice',
          name: 'Alice',
          address: { city: 'NYC', zip: '10001' },
          tags: ['vip', 'premium'],
        }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items[0].address).toEqual({ city: 'NYC', zip: '10001' })
      expect(result.items[0].tags).toEqual(['vip', 'premium'])
    })

    it('handles items with numeric id', () => {
      const result = buildCollectionResponse(
        [{ id: '12345', name: 'Item' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items[0].$id).toBe('https://headless.ly/customers/12345')
    })

    it('handles items with hyphenated id', () => {
      const result = buildCollectionResponse(
        [{ id: 'cust-abc-123', name: 'Customer' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result.items[0].$id).toBe('https://headless.ly/customers/cust-abc-123')
    })
  })

  // ============================================================================
  // Integration Tests - Full Response Shape
  // ============================================================================

  describe('full response shape integration', () => {
    it('builds complete basic response', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        { ns: 'https://headless.ly', type: 'Customer' }
      )

      expect(result).toEqual({
        $context: 'https://headless.ly',
        $type: 'https://headless.ly/customers',
        $id: 'https://headless.ly/customers',
        count: 100,
        links: {
          home: 'https://headless.ly',
          first: 'https://headless.ly/customers',
        },
        actions: {
          create: 'https://headless.ly/customers',
        },
        items: [{
          $context: 'https://headless.ly',
          $type: 'https://headless.ly/customers',
          $id: 'https://headless.ly/customers/alice',
          id: 'alice',
          name: 'Alice',
        }],
      })
    })

    it('builds complete response with pagination and facets', () => {
      const result = buildCollectionResponse(
        [
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' },
        ],
        500,
        {
          ns: 'https://headless.ly',
          type: 'Customer',
          pagination: {
            after: 'cursor_bob',
            before: 'cursor_alice',
            hasNext: true,
            hasPrev: true,
          },
          facets: {
            sort: ['name', '-createdAt'],
            filter: {
              status: ['active', 'pending'],
              tier: ['pro', 'enterprise'],
            },
          },
          customActions: ['import', 'export'],
        }
      )

      // Verify structure
      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers')
      expect(result.count).toBe(500)

      // Verify links
      expect(result.links.home).toBe('https://headless.ly')
      expect(result.links.first).toBe('https://headless.ly/customers')
      expect(result.links.prev).toContain('before=cursor_alice')
      expect(result.links.next).toContain('after=cursor_bob')

      // Verify facets
      expect(result.facets?.sort).toEqual(['name', '-createdAt'])
      expect(result.facets?.filter).toEqual({
        status: ['active', 'pending'],
        tier: ['pro', 'enterprise'],
      })

      // Verify actions
      expect(result.actions.create).toBe('https://headless.ly/customers')
      expect(result.actions.import).toBe('https://headless.ly/customers/import')
      expect(result.actions.export).toBe('https://headless.ly/customers/export')

      // Verify items
      expect(result.items).toHaveLength(2)
      expect(result.items[0].$id).toBe('https://headless.ly/customers/alice')
      expect(result.items[1].$id).toBe('https://headless.ly/customers/bob')
    })

    it('builds response with nested resources (parent context)', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        25,
        {
          ns: 'https://headless.ly',
          type: 'Order',
          parent: 'https://headless.ly/customers/alice',
        }
      )

      expect(result).toEqual({
        $context: 'https://headless.ly/customers/alice',
        $type: 'https://headless.ly/customers/alice/orders',
        $id: 'https://headless.ly/customers/alice/orders',
        count: 25,
        links: {
          home: 'https://headless.ly',
          first: 'https://headless.ly/customers/alice/orders',
        },
        actions: {
          create: 'https://headless.ly/customers/alice/orders',
        },
        items: [{
          $context: 'https://headless.ly/customers/alice',
          $type: 'https://headless.ly/customers/alice/orders',
          $id: 'https://headless.ly/customers/alice/orders/ord-001',
          id: 'ord-001',
          total: 99.99,
        }],
      })
    })
  })

  // ============================================================================
  // Type Safety Tests
  // ============================================================================

  describe('type safety', () => {
    it('preserves item type in return value', () => {
      interface Customer {
        id: string
        name: string
        email: string
      }

      const customers: Customer[] = [
        { id: 'alice', name: 'Alice', email: 'alice@example.com' },
      ]

      const result = buildCollectionResponse(customers, 100, {
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      // TypeScript should recognize these properties
      const item = result.items[0]
      expect(item.id).toBe('alice')
      expect(item.name).toBe('Alice')
      expect(item.email).toBe('alice@example.com')
      expect(item.$context).toBe('https://headless.ly')
      expect(item.$type).toBe('https://headless.ly/customers')
      expect(item.$id).toBe('https://headless.ly/customers/alice')
    })

    it('handles generic item types', () => {
      const result = buildCollectionResponse(
        [{ id: 'product-1', sku: 'SKU001', price: 29.99, inStock: true }],
        50,
        { ns: 'https://headless.ly', type: 'Product' }
      )

      expect(result.items[0].sku).toBe('SKU001')
      expect(result.items[0].price).toBe(29.99)
      expect(result.items[0].inStock).toBe(true)
    })
  })
})
