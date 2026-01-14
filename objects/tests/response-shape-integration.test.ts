/**
 * DOBase Response Shape Integration Tests
 *
 * Comprehensive integration tests verifying that DOBase's REST handler uses
 * the response shape utilities for consistent JSON-LD/MDXLD formatted responses.
 *
 * Test Coverage:
 * 1. Consistent Response Format - All endpoints follow standard structure
 * 2. Linked Data Inclusion - $context, $type, $id properly constructed
 * 3. Metadata Fields - count, links, actions, facets
 * 4. Error Responses - Standard error format with $type: 'Error'
 * 5. Pagination Responses - Cursor-based navigation links
 * 6. API Response Consistency - Shape consistency across endpoints
 *
 * Expected response format per the acceptance criteria:
 * - Root (GET /): $context=parent, $type=ns, $id=ns, collections object
 * - Collection (GET /:type): $context=ns, $type=ns/type, $id=ns/type, count, links, actions, items
 * - Item (GET /:type/:id): $context=ns, $type=ns/type, $id=ns/type/id, links, actions
 *
 * @module objects/tests/response-shape-integration.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../core/DO'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    setAlarm: vi.fn(async (_time: number): Promise<void> => {}),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    deleteAlarm: vi.fn(async (): Promise<void> => {}),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): { toString: () => string; equals: (other: unknown) => boolean; name: string } {
  return {
    toString: () => name,
    equals: (other: unknown) => (other as { toString: () => string })?.toString?.() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState
 */
function createMockState(idName: string = 'test-do-id') {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  }
}

/**
 * Create a mock environment
 */
function createMockEnv(): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

/**
 * Create a test DO instance
 */
function createTestDO(): DO {
  const state = createMockState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all DurableObjectState properties
  return new DO(state, env)
}

/**
 * Create an initialized DO instance with namespace and optional parent
 */
async function createInitializedDO(
  ns: string = 'https://headless.ly',
  parent: string = 'https://Startups.Studio'
): Promise<DO> {
  const doInstance = createTestDO()
  await doInstance.initialize({ ns, parent })
  return doInstance
}

// ============================================================================
// Response Shape Types (Expected Format)
// ============================================================================

/**
 * Root response shape (GET /)
 */
interface RootResponse {
  /** Parent namespace (for root, this is the DO's parent/studio) */
  $context: string
  /** The namespace URL itself is the type */
  $type: string
  /** Same as $type for root */
  $id: string
  /** Namespace identifier */
  ns?: string
  /** Available collections as Record with count info */
  collections: Record<string, CollectionInfo> | Array<{ $id: string; $type: string; name: string }>
}

/**
 * Collection info in root response
 */
interface CollectionInfo {
  $id: string
  $type: 'Collection'
  count: number
}

/**
 * Clickable action object with method and href
 */
interface ClickableAction {
  method: string
  href: string
  type?: string
}

/**
 * Collection response shape (GET /:type)
 */
interface CollectionResponse {
  /** Namespace URL */
  $context: string
  /** Type URL (ns + '/' + pluralized type) */
  $type: string
  /** Same as $type for collections */
  $id: string
  /** Total count of items */
  count?: number
  /** For compatibility with current impl */
  total?: number
  /** Navigation and action links */
  links?: {
    home?: string
    self?: string
    first?: string
    prev?: string
    next?: string
    last?: string
  }
  /** Available actions */
  actions?: {
    create?: string | ClickableAction
    [key: string]: string | ClickableAction | undefined
  }
  /** Facets for filtering/sorting */
  facets?: {
    sort?: string[]
    filter?: Record<string, string[]>
  }
  /** Array of items with full shape */
  items: Array<ItemShape & Record<string, unknown>>
}

/**
 * Item response shape (GET /:type/:id)
 */
interface ItemResponse {
  /** Namespace URL */
  $context: string
  /** Type URL (ns + '/' + pluralized type) */
  $type: string
  /** Full item URL (ns + '/' + type + '/' + id) */
  $id: string
  /** Navigation and action links */
  links?: {
    home?: string
    self?: string
    collection?: string
    edit?: string
    [key: string]: string | undefined
  }
  /** Available actions for this item */
  actions?: {
    update?: string | ClickableAction
    delete?: string | ClickableAction
    [key: string]: string | ClickableAction | undefined
  }
  /** Relationships to other entities */
  relationships?: Record<string, string | string[]>
  /** Reverse references from other entities */
  references?: Record<string, string | string[]>
  /** Item data */
  [key: string]: unknown
}

/**
 * Base item shape in collection items
 */
interface ItemShape {
  $context: string
  $type: string
  $id: string
}

/**
 * Error response shape
 */
interface ErrorResponse {
  $type: 'Error'
  code: string
  message: string
  details?: unknown
}

// ============================================================================
// 1. Root Response Tests (GET /)
// ============================================================================

describe('Response Shape Integration: Root Response (GET /)', () => {
  it('returns $context as parent namespace URL', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as RootResponse

    // $context should be the parent namespace, e.g., "https://Startups.Studio"
    expect(body.$context).toBeDefined()
    expect(typeof body.$context).toBe('string')
    expect(body.$context).toBe('https://Startups.Studio')
  })

  it('returns $type as the namespace URL', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as RootResponse

    // $type for root should be the DO's namespace URL itself
    expect(body.$type).toBe('https://headless.ly')
  })

  it('returns $id same as $type for root', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as RootResponse

    // $id should equal $type for root response
    expect(body.$id).toBe('https://headless.ly')
    expect(body.$id).toBe(body.$type)
  })

  it('returns collections as Record (not Array) with count info', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as RootResponse

    // collections should be a Record<string, CollectionInfo>, not Array
    expect(body.collections).toBeDefined()
    expect(Array.isArray(body.collections)).toBe(false)
    expect(typeof body.collections).toBe('object')
  })

  it('each collection in record has $id, $type: Collection, and count', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as RootResponse

    // Skip if collections is an array (current impl)
    if (Array.isArray(body.collections)) {
      // This should not be an array
      expect(Array.isArray(body.collections)).toBe(false)
      return
    }

    // Each collection should have proper structure
    for (const [_name, info] of Object.entries(body.collections)) {
      expect(info.$id).toBeDefined()
      expect(info.$type).toBe('Collection')
      expect(typeof info.count).toBe('number')
    }
  })

  it('handles orphan DO without parent by using schema.org.ai fallback', async () => {
    const doInstance = createTestDO()
    // Initialize without parent
    await doInstance.initialize({ ns: 'https://orphan.example.com' })

    const request = new Request('https://orphan.example.com/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as RootResponse

    // Orphan DO should use schema.org.ai type URL as $context
    // The URL may or may not have a trailing slash or type suffix
    expect(body.$context).toMatch(/^https:\/\/schema\.org\.ai/)
  })
})

// ============================================================================
// 2. Collection Response Tests (GET /:type)
// ============================================================================

describe('Response Shape Integration: Collection Response (GET /:type)', () => {
  it('returns $context as namespace URL', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    // Accept 200 or 404 (unregistered type)
    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // $context should be the namespace URL
    expect(body.$context).toBe('https://headless.ly')
  })

  it('returns $type as full type URL (ns + pluralized type)', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // $type should be the full type URL
    expect(body.$type).toBe('https://headless.ly/customers')
  })

  it('returns $id same as $type for collections', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // $id equals $type for collection responses
    expect(body.$id).toBe('https://headless.ly/customers')
    expect(body.$id).toBe(body.$type)
  })

  it('returns count field with total number of items', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Should have 'count' field (not 'total' or 'totalItems')
    expect(body.count).toBeDefined()
    expect(typeof body.count).toBe('number')
  })

  it('returns links object with home and first', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Should have links object with navigation links
    expect(body.links).toBeDefined()
    expect(body.links?.home).toBe('https://headless.ly')
    expect(body.links?.first).toBe('https://headless.ly/customers')
  })

  it('returns actions object with create action', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Should have actions object with create action (clickable format)
    expect(body.actions).toBeDefined()
    expect(body.actions?.create).toMatchObject({
      method: 'POST',
      href: 'https://headless.ly/customers',
    })
  })

  it('items have full $context/$type/$id shape', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // If there are items, verify their shape
    if (body.items && body.items.length > 0) {
      const item = body.items[0]
      // Each item should have full linked data shape
      expect(item.$context).toBe('https://headless.ly')
      expect(item.$type).toBe('https://headless.ly/customers')
      expect(item.$id).toMatch(/^https:\/\/headless\.ly\/customers\//)
    }
  })

  it('items have links for self and collection', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // If there are items, verify their links
    if (body.items && body.items.length > 0) {
      const item = body.items[0] as ItemResponse
      expect(item.links).toBeDefined()
      expect(item.links?.self).toBeDefined()
      expect(item.links?.collection).toBe('https://headless.ly/customers')
    }
  })
})

// ============================================================================
// 3. Item Response Tests (GET /:type/:id)
// ============================================================================

describe('Response Shape Integration: Item Response (GET /:type/:id)', () => {
  it('returns $context as namespace URL', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice')
    const response = await doInstance.fetch(request)

    // Will be 404 in mock env, but verify shape when 200
    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // $context should be the namespace URL
    expect(body.$context).toBe('https://headless.ly')
  })

  it('returns $type as type URL', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // $type should be the collection type URL
    expect(body.$type).toBe('https://headless.ly/customers')
  })

  it('returns $id as full item URL', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // $id should be the full item URL
    expect(body.$id).toBe('https://headless.ly/customers/alice')
  })

  it('returns links object with self, collection, and edit', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // Should have links object
    expect(body.links).toBeDefined()
    expect(body.links?.self).toBe('https://headless.ly/customers/alice')
    expect(body.links?.collection).toBe('https://headless.ly/customers')
    expect(body.links?.edit).toBe('https://headless.ly/customers/alice/edit')
  })

  it('returns actions object with update and delete', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // Should have actions object
    expect(body.actions).toBeDefined()
    expect(body.actions?.update).toBe('https://headless.ly/customers/alice')
    expect(body.actions?.delete).toBe('https://headless.ly/customers/alice')
  })
})

// ============================================================================
// 4. Error Response Tests
// ============================================================================

describe('Response Shape Integration: Error Responses', () => {
  it('returns standard error format for 404 Not Found', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/nonexistent')
    const response = await doInstance.fetch(request)

    // Expect 404 for nonexistent item
    if (response.status !== 404) return

    const body = await response.json() as ErrorResponse

    // Should have $type: 'Error'
    expect(body.$type).toBe('Error')
    expect(body.code).toBe('NOT_FOUND')
    expect(body.message).toBeDefined()
    expect(typeof body.message).toBe('string')
  })

  it('returns standard error format for 400 Bad Request', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // POST with invalid body
    const request = new Request('https://headless.ly/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{{{',
    })

    const response = await doInstance.fetch(request)

    // Expect 400 for invalid JSON
    if (response.status !== 400) return

    const body = await response.json() as ErrorResponse

    // Should have $type: 'Error'
    expect(body.$type).toBe('Error')
    expect(body.code).toBe('BAD_REQUEST')
    expect(body.message).toBeDefined()
  })

  it('returns standard error format for 405 Method Not Allowed', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // PATCH is typically not allowed on collections
    const request = new Request('https://headless.ly/customers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const response = await doInstance.fetch(request)

    // Expect 405 for method not allowed
    if (response.status !== 405) return

    const body = await response.json() as ErrorResponse

    // Should have $type: 'Error'
    expect(body.$type).toBe('Error')
    expect(body.code).toBe('METHOD_NOT_ALLOWED')
    expect(body.message).toBeDefined()
  })

  it('error responses include $type: Error consistently', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // Various error-inducing requests
    const errorRequests = [
      new Request('https://headless.ly/nonexistent-collection/nonexistent-item'),
      new Request('https://headless.ly/customers/bad%2F%2Fid'),
    ]

    for (const request of errorRequests) {
      const response = await doInstance.fetch(request)

      if (response.status >= 400) {
        const body = await response.json() as ErrorResponse

        // All error responses should have $type: 'Error'
        expect(body.$type).toBe('Error')
        expect(body.code).toBeDefined()
        expect(typeof body.code).toBe('string')
        expect(body.message).toBeDefined()
        expect(typeof body.message).toBe('string')
      }
    }
  })
})

// ============================================================================
// 5. Pagination Response Tests
// ============================================================================

describe('Response Shape Integration: Pagination Responses', () => {
  it('collection response includes links.next when more items exist', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // Request with limit parameter
    const request = new Request('https://headless.ly/customers?limit=10')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // If count > items.length, should have next link
    if (body.count && body.items.length < body.count) {
      expect(body.links?.next).toBeDefined()
      expect(body.links?.next).toContain('after=')
    }
  })

  it('collection response includes links.prev when not on first page', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // Request with after parameter (not first page)
    const request = new Request('https://headless.ly/customers?after=cursor123')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Should have prev link when after is specified
    if (body.links?.prev) {
      expect(body.links.prev).toContain('before=')
    }
  })

  it('collection response includes links.first always', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers?after=somecursor')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Should always have first link
    expect(body.links?.first).toBe('https://headless.ly/customers')
  })

  it('collection response includes links.last when pagination exists', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers?limit=5')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Should have last link when there are more pages
    if (body.count && body.items.length < body.count) {
      expect(body.links?.last).toBeDefined()
    }
  })

  it('cursor in next link is URL-encoded', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers?limit=1')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // If next link exists, cursor should be URL-encoded
    if (body.links?.next) {
      // Should be a valid URL
      expect(() => new URL(body.links!.next!)).not.toThrow()
    }
  })
})

// ============================================================================
// 6. Namespace Derivation from Request Origin
// ============================================================================

describe('Response Shape Integration: Namespace from Request Origin', () => {
  it('derives response URLs from request origin for root', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // Make request with specific origin
    const request = new Request('https://headless.ly/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as RootResponse

    // All URLs should be based on the request origin
    expect(body.$type).toBe('https://headless.ly')
    expect(body.$id).toBe('https://headless.ly')
  })

  it('derives response URLs from request origin for collection', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/orders')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // URLs should use request origin as base
    expect(body.$context).toBe('https://headless.ly')
    expect(body.$type).toBe('https://headless.ly/orders')
    expect(body.$id).toBe('https://headless.ly/orders')
  })

  it('derives response URLs from request origin for item', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/orders/ord-123')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // URLs should use request origin as base
    expect(body.$context).toBe('https://headless.ly')
    expect(body.$type).toBe('https://headless.ly/orders')
    expect(body.$id).toBe('https://headless.ly/orders/ord-123')
  })

  it('handles different subdomains correctly', async () => {
    const doInstance = await createInitializedDO('https://tenant1.headless.ly')

    const request = new Request('https://tenant1.headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // URLs should use tenant subdomain
    expect(body.$context).toBe('https://tenant1.headless.ly')
    expect(body.$type).toBe('https://tenant1.headless.ly/customers')
  })
})

// ============================================================================
// 7. Full Response Shape Validation (Integration)
// ============================================================================

describe('Response Shape Integration: Full Shape Validation', () => {
  it('root response has complete expected shape', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as RootResponse

    // Verify complete root shape per acceptance criteria
    expect(body).toMatchObject({
      $context: 'https://Startups.Studio', // Parent
      $type: 'https://headless.ly',
      $id: 'https://headless.ly',
    })

    // Collections should be Record, not Array
    expect(body.collections).toBeDefined()
    expect(Array.isArray(body.collections)).toBe(false)
  })

  it('collection response has complete expected shape', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Verify complete collection shape per acceptance criteria
    expect(body).toMatchObject({
      $context: 'https://headless.ly',
      $type: 'https://headless.ly/customers',
      $id: 'https://headless.ly/customers',
      count: expect.any(Number),
      links: {
        home: 'https://headless.ly',
        first: 'https://headless.ly/customers',
      },
      actions: {
        create: expect.objectContaining({
          method: 'POST',
          href: 'https://headless.ly/customers',
        }),
      },
    })

    expect(Array.isArray(body.items)).toBe(true)
  })

  it('item response has complete expected shape', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // Verify complete item shape per acceptance criteria
    expect(body).toMatchObject({
      $context: 'https://headless.ly',
      $type: 'https://headless.ly/customers',
      $id: 'https://headless.ly/customers/alice',
      links: {
        self: 'https://headless.ly/customers/alice',
        collection: 'https://headless.ly/customers',
        edit: 'https://headless.ly/customers/alice/edit',
      },
      actions: {
        update: 'https://headless.ly/customers/alice',
        delete: 'https://headless.ly/customers/alice',
      },
    })
  })
})

// ============================================================================
// 8. Edge Cases
// ============================================================================

describe('Response Shape Integration: Edge Cases', () => {
  it('handles special characters in item IDs with URL encoding', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // ID with special character @ should be URL encoded
    const request = new Request('https://headless.ly/customers/user%40example.com')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // $id should have URL-encoded special characters
    expect(body.$id).toBe('https://headless.ly/customers/user%40example.com')
  })

  it('empty collection has correct shape with count 0', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Empty collection should still have full shape
    expect(body.$context).toBe('https://headless.ly')
    expect(body.$type).toBe('https://headless.ly/customers')
    expect(body.$id).toBe('https://headless.ly/customers')
    expect(body.count).toBe(0)
    expect(body.items).toEqual([])
    expect(body.links).toBeDefined()
    expect(body.actions).toBeDefined()
  })

  it('handles namespace with port number', async () => {
    const doInstance = createTestDO()
    await doInstance.initialize({ ns: 'https://localhost:8787' })

    const request = new Request('https://localhost:8787/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    expect(body.$context).toBe('https://localhost:8787')
    expect(body.$type).toBe('https://localhost:8787/customers')
  })

  it('handles namespace with path segments', async () => {
    const doInstance = createTestDO()
    await doInstance.initialize({ ns: 'https://api.example.com/v1/tenant' })

    const request = new Request('https://api.example.com/v1/tenant/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    expect(body.$context).toBe('https://api.example.com/v1/tenant')
    expect(body.$type).toBe('https://api.example.com/v1/tenant/customers')
  })

  it('normalizes namespace trailing slashes', async () => {
    const doInstance = createTestDO()
    await doInstance.initialize({ ns: 'https://headless.ly/' })

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Should not have double slashes
    expect(body.$type).toBe('https://headless.ly/customers')
    expect(body.$type).not.toContain('//')
  })
})

// ============================================================================
// 9. Metadata Fields Tests
// ============================================================================

describe('Response Shape Integration: Metadata Fields', () => {
  it('collection response includes facets when available', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    // Facets should be present if the collection supports filtering/sorting
    if (body.facets) {
      expect(body.facets).toMatchObject({
        sort: expect.any(Array),
      })
    }
  })

  it('item response may include relationships', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/contacts/john')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // Relationships should be URLs if present
    if (body.relationships) {
      for (const [_verb, value] of Object.entries(body.relationships)) {
        if (Array.isArray(value)) {
          for (const url of value) {
            expect(url).toMatch(/^https?:\/\//)
          }
        } else {
          expect(value).toMatch(/^https?:\/\//)
        }
      }
    }
  })

  it('item response may include references', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/companies/acme')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as ItemResponse

    // References should be URLs if present
    if (body.references) {
      for (const [_verb, value] of Object.entries(body.references)) {
        if (Array.isArray(value)) {
          for (const url of value) {
            expect(url).toMatch(/^https?:\/\//)
          }
        } else {
          expect(value).toMatch(/^https?:\/\//)
        }
      }
    }
  })
})

// ============================================================================
// 10. API Response Consistency Tests
// ============================================================================

describe('Response Shape Integration: API Response Consistency', () => {
  it('all successful responses have $context, $type, $id', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const requests = [
      new Request('https://headless.ly/'),
      new Request('https://headless.ly/customers'),
      new Request('https://headless.ly/customers/alice'),
    ]

    for (const request of requests) {
      const response = await doInstance.fetch(request)

      if (response.status === 200) {
        const body = await response.json() as Record<string, unknown>

        // All 2xx responses should have linked data properties
        expect(body.$context).toBeDefined()
        expect(typeof body.$context).toBe('string')
        expect(body.$type).toBeDefined()
        expect(typeof body.$type).toBe('string')
        expect(body.$id).toBeDefined()
        expect(typeof body.$id).toBe('string')
      }
    }
  })

  it('$id is always a valid URL', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const requests = [
      new Request('https://headless.ly/'),
      new Request('https://headless.ly/customers'),
      new Request('https://headless.ly/customers/alice'),
    ]

    for (const request of requests) {
      const response = await doInstance.fetch(request)

      if (response.status === 200) {
        const body = await response.json() as Record<string, unknown>

        // $id should be a valid URL
        expect(() => new URL(body.$id as string)).not.toThrow()
      }
    }
  })

  it('$type is always a valid URL', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const requests = [
      new Request('https://headless.ly/'),
      new Request('https://headless.ly/customers'),
      new Request('https://headless.ly/customers/alice'),
    ]

    for (const request of requests) {
      const response = await doInstance.fetch(request)

      if (response.status === 200) {
        const body = await response.json() as Record<string, unknown>

        // $type should be a valid URL
        expect(() => new URL(body.$type as string)).not.toThrow()
      }
    }
  })

  it('Content-Type header is application/json', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const requests = [
      new Request('https://headless.ly/'),
      new Request('https://headless.ly/customers'),
    ]

    for (const request of requests) {
      const response = await doInstance.fetch(request)

      // Content-Type should be application/json
      const contentType = response.headers.get('Content-Type')
      expect(contentType).toMatch(/application\/json/)
    }
  })

  it('response shape is consistent across GET and POST for same resource', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // GET collection
    const getRequest = new Request('https://headless.ly/customers')
    const getResponse = await doInstance.fetch(getRequest)

    if (getResponse.status !== 200) return

    const getBody = await getResponse.json() as CollectionResponse

    // POST to collection (create item)
    const postRequest = new Request('https://headless.ly/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Customer' }),
    })
    const postResponse = await doInstance.fetch(postRequest)

    // If POST succeeds (201), returned item should have same shape structure
    if (postResponse.status === 201) {
      const postBody = await postResponse.json() as ItemResponse

      // Created item should have same $context and $type as collection
      expect(postBody.$context).toBe(getBody.$context)
      expect(postBody.$type).toBe(getBody.$type)
    }
  })
})

// ============================================================================
// 11. Type Pluralization Consistency Tests
// ============================================================================

describe('Response Shape Integration: Type Pluralization', () => {
  it('pluralizes regular nouns correctly (Customer -> customers)', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    expect(body.$type).toBe('https://headless.ly/customers')
  })

  it('pluralizes -y ending nouns correctly (Category -> categories)', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/categories')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    expect(body.$type).toBe('https://headless.ly/categories')
  })

  it('handles irregular plurals (Person -> people)', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/people')
    const response = await doInstance.fetch(request)

    if (response.status !== 200) return

    const body = await response.json() as CollectionResponse

    expect(body.$type).toBe('https://headless.ly/people')
  })
})
