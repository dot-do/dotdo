/**
 * Collection<T> Base Class Tests - TDD RED Phase
 *
 * Tests for a Collection base class that routes at /:id instead of /:type/:id.
 *
 * The Collection<T> base class is for DOs that ARE a collection
 * (like Startups.Studio), not DOs that HAVE collections (like a CRM).
 *
 * Key differences from Entity-based DOs:
 * - GET / returns the collection itself (root IS the collection)
 * - GET /:id returns an item directly (not /:type/:id)
 * - POST / creates an item (not POST /:type)
 * - $type === $id at root level (the collection is both its type and identity)
 * - $context points to schema.org.ai/Collection for orphan Collection
 *
 * Reference: dotdo-sh814 - [RED] Collection<T> base class single-collection routing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// CONSTANTS - Expected JSON-LD vocabulary
// ============================================================================

const COLLECTION_CONTEXT = 'https://schema.org.ai/Collection'

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
 * Create a mock ThingsStore for testing
 * This provides an in-memory implementation of ThingsStore operations
 */
function createMockThingsStore() {
  const items = new Map<string, {
    $id: string
    $type: string
    name?: string
    data?: Record<string, unknown>
  }>()

  return {
    async list(options?: { limit?: number; after?: string }) {
      const all = Array.from(items.values())
      const limit = options?.limit ?? 100
      return all.slice(0, limit)
    },

    async get(id: string) {
      return items.get(id) ?? null
    },

    async create(data: { $id?: string; $type: string; name?: string; data?: Record<string, unknown> }) {
      const id = data.$id ?? `item-${Date.now()}`
      const item = {
        $id: id,
        $type: data.$type,
        name: data.name,
        data: data.data ?? {},
      }
      items.set(id, item)
      return item
    },

    async update(
      id: string,
      data: { name?: string; data?: Record<string, unknown> },
      options?: { merge?: boolean }
    ) {
      const existing = items.get(id)
      if (!existing) {
        throw new Error(`Item not found: ${id}`)
      }
      const updated = {
        ...existing,
        name: data.name ?? existing.name,
        data: options?.merge
          ? { ...existing.data, ...data.data }
          : data.data ?? existing.data,
      }
      items.set(id, updated)
      return updated
    },

    async delete(id: string) {
      const existing = items.get(id)
      if (!existing) {
        throw new Error(`Item not found: ${id}`)
      }
      items.delete(id)
      return existing
    },

    // For test inspection
    _items: items,
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
function createMockEnv() {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

/**
 * Helper to create a CollectionDO with a mock ThingsStore for testing
 * This enables CRUD operations to work with an in-memory store
 */
async function createTestCollection(
  CollectionDO: unknown,
  options: { ns: string; parent?: string } = { ns: 'https://Startups.Studio' }
) {
  const state = createMockState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all DurableObjectState properties
  const collection = new (CollectionDO as new (...args: unknown[]) => {
    initialize(config: { ns: string; parent?: string }): Promise<void>
    setThingsStore(store: ReturnType<typeof createMockThingsStore>): void
    fetch(request: Request): Promise<Response>
    itemType: string
  })(state, env)

  // Initialize the collection
  await collection.initialize(options)

  // Inject mock ThingsStore for CRUD operations
  const mockStore = createMockThingsStore()
  collection.setThingsStore(mockStore)

  return { collection, mockStore }
}

// ============================================================================
// RESPONSE TYPE DEFINITIONS
// ============================================================================

/**
 * Collection root response (GET /)
 *
 * For a Collection<T>, the root IS the collection itself.
 * - $context: schema.org.ai/Collection (for orphan collections)
 * - $type: the collection's namespace URL (e.g., https://Startups.Studio)
 * - $id: same as $type (the collection is its own identity)
 * - items: array of collection items
 * - count: total number of items
 */
interface CollectionRootResponse {
  $context: string
  $type: string
  $id: string
  items: CollectionItem[]
  count: number
  cursor?: string
}

/**
 * Collection item response (GET /:id)
 *
 * Items within the collection:
 * - $context: the collection's namespace URL (parent context)
 * - $type: same as $context for Collection<T> (homogeneous type)
 * - $id: full URL path including the item ID
 */
interface CollectionItem {
  $context: string
  $type: string
  $id: string
  name?: string
  [key: string]: unknown
}

/**
 * Create response (POST /)
 */
interface CreateResponse {
  $context: string
  $type: string
  $id: string
  [key: string]: unknown
}

// ============================================================================
// 1. ROOT IS COLLECTION (GET /)
// ============================================================================

describe('Collection<T> Base Class: Root is Collection', () => {
  it('GET / returns $context as schema.org.ai/Collection for orphan collection', async () => {
    // RED: A Collection<T> at the root level (orphan) should have
    // $context pointing to the Collection schema
    //
    // This is because an orphan collection has no parent context,
    // so it uses the universal Collection type as its context.

    // Attempt to import the Collection base class
    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    // This will FAIL - CollectionDO doesn't exist yet
    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state doesn't have all DurableObjectState properties
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/')
      const response = await collection.fetch(request)

      expect(response.status).toBe(200)

      const body = await response.json() as CollectionRootResponse

      // Orphan collection uses schema.org.ai/Collection as $context
      expect(body.$context).toBe(COLLECTION_CONTEXT)
    }
  })

  it('GET / returns $type equal to the collection namespace URL', async () => {
    // RED: For a Collection<T>, $type at root should be the collection's
    // own namespace URL, not a generic "Collection" string.
    //
    // Example: Startups.Studio has $type: 'https://Startups.Studio'

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/')
      const response = await collection.fetch(request)

      const body = await response.json() as CollectionRootResponse

      // $type is the collection's namespace
      expect(body.$type).toBe('https://Startups.Studio')
    }
  })

  it('GET / returns $id equal to $type (root is self-referential)', async () => {
    // RED: At the root level, $id === $type for a Collection<T>
    // The collection IS both its type and its identity.
    //
    // This is the key semantic: Startups.Studio is not "a startup"
    // nor "a collection of startups" - it IS the Startups.Studio.

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/')
      const response = await collection.fetch(request)

      const body = await response.json() as CollectionRootResponse

      // $id === $type at root
      expect(body.$id).toBe('https://Startups.Studio')
      expect(body.$id).toBe(body.$type)
    }
  })

  it('GET / returns items array', async () => {
    // RED: The root response should include the collection items

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/')
      const response = await collection.fetch(request)

      const body = await response.json() as CollectionRootResponse

      expect(body.items).toBeDefined()
      expect(Array.isArray(body.items)).toBe(true)
    }
  })

  it('GET / returns count as number', async () => {
    // RED: The root response should include a count of items

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/')
      const response = await collection.fetch(request)

      const body = await response.json() as CollectionRootResponse

      expect(body.count).toBeDefined()
      expect(typeof body.count).toBe('number')
    }
  })

  it('GET / count matches items.length', async () => {
    // RED: count should reflect the actual number of items

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/')
      const response = await collection.fetch(request)

      const body = await response.json() as CollectionRootResponse

      expect(body.count).toBe(body.items.length)
    }
  })
})

// ============================================================================
// 2. ITEM AT /:id (NOT /:type/:id)
// ============================================================================

describe('Collection<T> Base Class: Item at /:id', () => {
  it('GET /:id routes directly to item (not /:type/:id)', async () => {
    // RED: For Collection<T>, items are at /:id directly
    // NOT at /:type/:id like in Entity-based DOs
    //
    // Example:
    // - https://Startups.Studio/headless.ly (Collection<T> routing)
    // - NOT https://Startups.Studio/Startup/headless.ly (Entity routing)

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      // Request item directly at /:id
      const request = new Request('https://Startups.Studio/headless.ly')
      const response = await collection.fetch(request)

      // Should return item or 404 if not found
      // NOT 404 because route doesn't match
      expect([200, 404]).toContain(response.status)

      // If found, verify it's an item response
      if (response.status === 200) {
        const body = await response.json() as CollectionItem
        expect(body.$id).toBe('https://Startups.Studio/headless.ly')
      }
    }
  })

  it('GET /:id returns $context equal to the collection namespace', async () => {
    // RED: Items in a Collection<T> have their $context as the collection
    //
    // Example: headless.ly's context is Startups.Studio

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      // First create the item
      await collection.fetch(new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'headless.ly', name: 'Headless.ly' }),
      }))

      // Then get it
      const request = new Request('https://Startups.Studio/headless.ly')
      const response = await collection.fetch(request)

      if (response.status === 200) {
        const body = await response.json() as CollectionItem

        // $context is the parent collection
        expect(body.$context).toBe('https://Startups.Studio')
      }
    }
  })

  it('GET /:id returns $type equal to $context (homogeneous collection)', async () => {
    // RED: In a Collection<T>, all items have the same $type
    // which equals their $context (the collection namespace)
    //
    // This is the key difference from heterogeneous Entity containers:
    // - Collection<T>: $type === $context (all items same type)
    // - Entity container: $type !== $context (mixed types)

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      // Create and get item
      await collection.fetch(new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'headless.ly', name: 'Headless.ly' }),
      }))

      const request = new Request('https://Startups.Studio/headless.ly')
      const response = await collection.fetch(request)

      if (response.status === 200) {
        const body = await response.json() as CollectionItem

        // $type === $context for Collection<T> items
        expect(body.$type).toBe('https://Startups.Studio')
        expect(body.$type).toBe(body.$context)
      }
    }
  })

  it('GET /:id returns $id as full URL with item path', async () => {
    // RED: $id should be the full URL to the item

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      // Create and get item
      await collection.fetch(new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'headless.ly', name: 'Headless.ly' }),
      }))

      const request = new Request('https://Startups.Studio/headless.ly')
      const response = await collection.fetch(request)

      if (response.status === 200) {
        const body = await response.json() as CollectionItem

        // $id is full URL to item
        expect(body.$id).toBe('https://Startups.Studio/headless.ly')
      }
    }
  })

  it('GET /:id returns 404 for non-existent item', async () => {
    // RED: Should return 404 for items that don't exist

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/non-existent-startup')
      const response = await collection.fetch(request)

      expect(response.status).toBe(404)
    }
  })

  it('GET /:id returns item data fields', async () => {
    // RED: Item response should include all data fields

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      // Create item with data
      await collection.fetch(new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'headless.ly',
          name: 'Headless.ly',
          description: 'AI-native headless CMS',
          fundingStage: 'Seed',
        }),
      }))

      const request = new Request('https://Startups.Studio/headless.ly')
      const response = await collection.fetch(request)

      if (response.status === 200) {
        const body = await response.json() as CollectionItem

        expect(body.name).toBe('Headless.ly')
        expect(body.description).toBe('AI-native headless CMS')
        expect(body.fundingStage).toBe('Seed')
      }
    }
  })
})

// ============================================================================
// 3. CREATE AT ROOT (POST /)
// ============================================================================

describe('Collection<T> Base Class: Create at Root', () => {
  it('POST / creates item and returns 201', async () => {
    // RED: Creating an item should return 201 Created

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const { collection } = await createTestCollection(CollectionDO)

      const request = new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'new-startup',
          name: 'New Startup Co',
        }),
      })

      const response = await collection.fetch(request)

      expect(response.status).toBe(201)
    }
  })

  it('POST / sets Location header to new item URL', async () => {
    // RED: Location header should point to the created item

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'new-startup',
          name: 'New Startup Co',
        }),
      })

      const response = await collection.fetch(request)

      if (response.status === 201) {
        const location = response.headers.get('Location')

        expect(location).toBeDefined()
        expect(location).toBe('https://Startups.Studio/new-startup')
      }
    }
  })

  it('POST / returns created item in response body', async () => {
    // RED: Response body should contain the created item

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'new-startup',
          name: 'New Startup Co',
        }),
      })

      const response = await collection.fetch(request)

      if (response.status === 201) {
        const body = await response.json() as CreateResponse

        expect(body.$id).toBe('https://Startups.Studio/new-startup')
        expect(body.$type).toBe('https://Startups.Studio')
        expect(body.$context).toBe('https://Startups.Studio')
        expect(body.name).toBe('New Startup Co')
      }
    }
  })

  it('POST / generates ID if not provided', async () => {
    // RED: Should auto-generate ID when not specified

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No id field
          name: 'Auto ID Startup',
        }),
      })

      const response = await collection.fetch(request)

      if (response.status === 201) {
        const body = await response.json() as CreateResponse
        const location = response.headers.get('Location')

        // Should have generated an ID
        expect(body.$id).toBeDefined()
        expect(body.$id).toMatch(/^https:\/\/Startups\.Studio\/[a-zA-Z0-9_-]+$/)
        expect(location).toBeDefined()
        expect(location).not.toBe('https://Startups.Studio/')
      }
    }
  })

  it('POST / returns 409 for duplicate ID', async () => {
    // RED: Should reject duplicate IDs with 409 Conflict

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const createRequest = (id: string) => new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: 'Test' }),
      })

      // Create first
      const response1 = await collection.fetch(createRequest('duplicate-id'))

      if (response1.status === 201) {
        // Try to create with same ID
        const response2 = await collection.fetch(createRequest('duplicate-id'))

        expect(response2.status).toBe(409)
      }
    }
  })

  it('POST / returns 400 for invalid JSON', async () => {
    // RED: Should reject invalid JSON with 400 Bad Request

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)
      await collection.initialize({ ns: 'https://Startups.Studio' })

      const request = new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      const response = await collection.fetch(request)

      expect(response.status).toBe(400)
    }
  })
})

// ============================================================================
// 4. UPDATE AND DELETE AT /:id
// ============================================================================

describe('Collection<T> Base Class: Update and Delete', () => {
  it('PUT /:id updates item', async () => {
    // RED: PUT should update an existing item

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const { collection } = await createTestCollection(CollectionDO)

      // Create item first
      await collection.fetch(new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'update-me', name: 'Original' }),
      }))

      // Update it
      const updateRequest = new Request('https://Startups.Studio/update-me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      })

      const response = await collection.fetch(updateRequest)

      expect(response.status).toBe(200)

      if (response.status === 200) {
        const body = await response.json() as CollectionItem
        expect(body.name).toBe('Updated')
      }
    }
  })

  it('DELETE /:id removes item', async () => {
    // RED: DELETE should remove an item

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const { collection } = await createTestCollection(CollectionDO)

      // Create item first
      await collection.fetch(new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'delete-me', name: 'To Delete' }),
      }))

      // Delete it
      const deleteRequest = new Request('https://Startups.Studio/delete-me', {
        method: 'DELETE',
      })

      const response = await collection.fetch(deleteRequest)

      expect([200, 204]).toContain(response.status)

      // Verify it's gone
      const getResponse = await collection.fetch(
        new Request('https://Startups.Studio/delete-me')
      )
      expect(getResponse.status).toBe(404)
    }
  })
})

// ============================================================================
// 5. COLLECTION TYPE DISCRIMINATION
// ============================================================================

describe('Collection<T> Base Class: Type Discrimination', () => {
  it('CollectionDO has static $type property', async () => {
    // RED: CollectionDO class should have $type for discrimination

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      // @ts-expect-error - checking for static property
      expect(CollectionDO.$type).toBeDefined()
      // @ts-expect-error - checking value
      expect(CollectionDO.$type).toBe('Collection')
    }
  })

  it('CollectionDO extends DO base class', async () => {
    // RED: CollectionDO should extend DO

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))
    const { DO } = await import('../DO').catch(() => ({ DO: undefined }))

    expect(CollectionDO).toBeDefined()
    expect(DO).toBeDefined()

    if (CollectionDO && DO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const instance = new CollectionDO(state, env)

      expect(instance).toBeInstanceOf(DO)
    }
  })

  it('CollectionDO has itemType property', async () => {
    // RED: CollectionDO should have itemType to describe contained items

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const { collection } = await createTestCollection(CollectionDO)

      // itemType should be defined after initialization
      expect(collection.itemType).toBeDefined()
    }
  })
})

// ============================================================================
// 6. NESTED COLLECTION CONTEXT
// ============================================================================

describe('Collection<T> Base Class: Nested Collection Context', () => {
  it('Nested collection has parent as $context', async () => {
    // RED: A collection nested under another has the parent as $context
    //
    // Example: investors.startups.studio has:
    // - $context: 'https://startups.studio' (parent)
    // - $type: 'https://investors.startups.studio'
    // - $id: 'https://investors.startups.studio'

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const state = createMockState()
      const env = createMockEnv()
      // @ts-expect-error - Mock state
      const collection = new CollectionDO(state, env)

      // Initialize with parent context
      await collection.initialize({
        ns: 'https://investors.startups.studio',
        parent: 'https://startups.studio',
      })

      const request = new Request('https://investors.startups.studio/')
      const response = await collection.fetch(request)

      if (response.status === 200) {
        const body = await response.json() as CollectionRootResponse

        // $context is the parent
        expect(body.$context).toBe('https://startups.studio')
        // $type is self
        expect(body.$type).toBe('https://investors.startups.studio')
        // $id is self
        expect(body.$id).toBe('https://investors.startups.studio')
      }
    }
  })
})

// ============================================================================
// 7. ROUTING DISTINCTION FROM ENTITY-BASED DOs
// ============================================================================

describe('Collection<T> vs Entity: Routing Comparison', () => {
  it('Collection routes /:id to item (not /:type/:id)', async () => {
    // RED: This test explicitly verifies the routing difference
    //
    // Collection<T> routing: GET /headless.ly -> item
    // Entity routing: GET /Startup/headless.ly -> item (NOT supported in Collection)

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const { collection } = await createTestCollection(CollectionDO)

      // Create an item
      await collection.fetch(new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'headless.ly', name: 'Headless.ly' }),
      }))

      // Collection routing: /:id
      const collectionRoute = await collection.fetch(
        new Request('https://Startups.Studio/headless.ly')
      )
      expect(collectionRoute.status).toBe(200)

      // Entity routing would be /:type/:id - this should NOT work
      // (or should be interpreted as nested path, not type/id)
      const entityRoute = await collection.fetch(
        new Request('https://Startups.Studio/Startup/headless.ly')
      )
      // Should be 404 - there's no item with id "Startup/headless.ly"
      expect(entityRoute.status).toBe(404)
    }
  })

  it('Collection POST / creates at root (not POST /:type)', async () => {
    // RED: Creation happens at root for Collection<T>

    const { CollectionDO } = await import('../CollectionDO').catch(() => ({ CollectionDO: undefined }))

    expect(CollectionDO).toBeDefined()

    if (CollectionDO) {
      const { collection } = await createTestCollection(CollectionDO)

      // Collection: POST / creates item
      const rootPost = await collection.fetch(new Request('https://Startups.Studio/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'test', name: 'Test' }),
      }))
      expect(rootPost.status).toBe(201)

      // POST /:type would be interpreted differently in Collection<T>
      // (as POST to an item path, which might be disallowed or mean something else)
    }
  })
})

// ============================================================================
// 8. MODULE EXPORT TESTS
// ============================================================================

describe('Collection<T> Base Class: Module Exports', () => {
  it('CollectionDO is exported from objects/', async () => {
    // RED: CollectionDO should be importable

    const exports = await import('../CollectionDO').catch(() => null)

    expect(exports).not.toBeNull()
    expect(exports?.CollectionDO).toBeDefined()
  })

  it('CollectionDO is re-exported from objects/index', async () => {
    // RED: Should be available from objects index

    const exports = await import('../index').catch(() => ({ CollectionDO: undefined }))

    expect(exports.CollectionDO).toBeDefined()
  })
})
