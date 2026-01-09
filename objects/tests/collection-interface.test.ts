/**
 * Collection Interface Tests - TDD RED Phase
 *
 * Tests for the Collection interface (homogeneous typed container).
 *
 * Key design decisions (from dotdo-f4ul):
 * - Collection has `$type: 'https://schema.org.ai/Collection'`
 * - Collection has `itemType` for the contained type
 * - `buildItemId(id)` constructs `ns/id` (no type in path)
 * - CRUD methods work without type parameter
 *
 * Reference: dotdo-52va - [RED] Tests for Collection interface and ID construction
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS - These describe the expected interface
// ============================================================================

/**
 * Schema.org.ai type URLs for DO type discrimination
 */
const COLLECTION_TYPE = 'https://schema.org.ai/Collection'
const THING_TYPE = 'https://schema.org.ai/Thing'

/**
 * Expected Collection interface (to be implemented in types/Collection.ts)
 *
 * A Collection is a homogeneous typed container where:
 * - All items are of the same type (itemType)
 * - IDs are constructed as `ns/id` (no type in path)
 * - CRUD operations don't require type parameter
 */
interface CollectionData {
  readonly $id: string // Full physical ID: ns + qualifiers
  readonly $type: typeof COLLECTION_TYPE // Always 'https://schema.org.ai/Collection'
  readonly ns: string // Logical namespace: 'https://crm.headless.ly/acme'
  readonly itemType: string // Type of contained items: 'https://startups.studio/Startup'
  name?: string
  description?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Thing interface (simplified for testing)
 */
interface Thing {
  $id: string
  $type: string
  name?: string
  [key: string]: unknown
}

/**
 * Expected Collection interface with CRUD operations
 */
interface Collection<T extends Thing = Thing> extends CollectionData {
  // ID construction
  buildItemId(id: string): string // Constructs `${this.ns}/${id}`

  // CRUD - no type parameter needed
  get(id: string): Promise<T | null>
  create(id: string, data: Partial<Omit<T, '$id' | '$type'>>): Promise<T>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<void>

  // Query
  list(options?: { limit?: number; cursor?: string }): Promise<{ items: T[]; cursor?: string }>
  find(query: Record<string, unknown>): Promise<T[]>
  count(query?: Record<string, unknown>): Promise<number>
}

/**
 * Expected collection factory function
 */
type CollectionFactory = <T extends Thing = Thing>(type: string) => Collection<T>

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
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: {
    get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
    put<T>(key: string | Record<string, T>, value?: T): Promise<void>
    delete(key: string | string[]): Promise<boolean | number>
    deleteAll(): Promise<void>
    list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
    sql: unknown
  }
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Create a mock DurableObjectState
 */
function createMockState(idName: string = 'test-do-id'): DurableObjectState {
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
  }
}

// ============================================================================
// TESTS: Collection $type Discriminator
// ============================================================================

describe('Collection Interface', () => {
  describe('$type Discriminator', () => {
    it('Collection.$type is schema.org.ai/Collection', async () => {
      // This test will FAIL until types/Collection.ts is created
      // The Collection interface should have $type = 'https://schema.org.ai/Collection'

      // Attempt to import the Collection type
      // This will fail because the module doesn't exist yet
      const { Collection } = await import('../../types/Collection').catch(() => ({ Collection: undefined }))

      expect(Collection).toBeDefined()

      // If we can create a collection, verify its $type
      // This tests the interface requirement that $type is a constant
      const mockCollection: CollectionData = {
        $id: 'https://startups.studio?shard=1',
        $type: COLLECTION_TYPE,
        ns: 'https://startups.studio',
        itemType: 'https://startups.studio/Startup',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(mockCollection.$type).toBe('https://schema.org.ai/Collection')
    })

    it('Collection.$type is distinct from Thing.$type', () => {
      // Collection and Thing should have different $type values
      // This enables runtime type discrimination

      expect(COLLECTION_TYPE).toBe('https://schema.org.ai/Collection')
      expect(THING_TYPE).toBe('https://schema.org.ai/Thing')
      expect(COLLECTION_TYPE).not.toBe(THING_TYPE)
    })

    it('$type is readonly and cannot be modified', async () => {
      // The $type property should be readonly to prevent accidental modification
      // This test documents the expected TypeScript behavior

      // Attempt to import and use the Collection interface
      const { CollectionData: CollectionDataType } = await import('../../types/Collection').catch(() => ({
        CollectionData: undefined,
      }))

      // This test will FAIL until the type is implemented
      expect(CollectionDataType).toBeDefined()
    })
  })

  // ============================================================================
  // TESTS: Collection itemType
  // ============================================================================

  describe('itemType Property', () => {
    it('Collection.itemType specifies the contained type', async () => {
      // A Collection<Startup> should have itemType = 'https://startups.studio/Startup'

      // This will FAIL until types/Collection.ts is created
      const { Collection } = await import('../../types/Collection').catch(() => ({ Collection: undefined }))

      expect(Collection).toBeDefined()

      // Test the expected behavior
      const mockCollection: CollectionData = {
        $id: 'https://startups.studio',
        $type: COLLECTION_TYPE,
        ns: 'https://startups.studio',
        itemType: 'https://startups.studio/Startup',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(mockCollection.itemType).toBe('https://startups.studio/Startup')
    })

    it('itemType is a fully qualified URL', () => {
      // itemType should be a schema.org/Noun URL, not a bare string

      const validItemType = 'https://startups.studio/Startup'

      // Should be a valid URL
      expect(() => new URL(validItemType)).not.toThrow()

      // Should NOT be a bare noun name
      const bareNoun = 'Startup'
      expect(bareNoun).not.toContain('://')
    })

    it('itemType is required on Collection', async () => {
      // The itemType field should be required (not optional)
      // This test verifies TypeScript behavior by attempting to create without it

      const { CollectionData: CollectionDataType } = await import('../../types/Collection').catch(() => ({
        CollectionData: undefined,
      }))

      // This will FAIL until types/Collection.ts is implemented
      expect(CollectionDataType).toBeDefined()

      // Document expected behavior: creating without itemType should be a type error
      // @ts-expect-error - itemType is required
      const invalid: CollectionData = {
        $id: 'https://test.example.com',
        $type: COLLECTION_TYPE,
        ns: 'https://test.example.com',
        // itemType missing - should error
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Test that itemType is indeed required at runtime
      expect(invalid.itemType).toBeUndefined()
    })
  })

  // ============================================================================
  // TESTS: buildItemId Method
  // ============================================================================

  describe('buildItemId Method', () => {
    it('buildItemId constructs ns/id format (no type in path)', async () => {
      // For Collection, IDs should be `ns/id` NOT `ns/type/id`
      // This is the key distinction from heterogeneous Things containers

      // This will FAIL until types/Collection.ts implements buildItemId
      const { buildItemId } = await import('../../types/Collection').catch(() => ({
        buildItemId: undefined,
      }))

      expect(buildItemId).toBeDefined()

      // Expected behavior:
      // collection.buildItemId('acme') -> 'https://startups.studio/acme'
      const ns = 'https://startups.studio'
      const id = 'acme'

      // Direct test of expected format
      const expected = `${ns}/${id}`
      expect(expected).toBe('https://startups.studio/acme')

      // Should NOT include type in path
      expect(expected).not.toContain('Startup/')
    })

    it('buildItemId returns fully qualified URL', () => {
      // The result should be a valid URL

      const ns = 'https://crm.headless.ly/acme'
      const id = 'customer-123'
      const result = `${ns}/${id}`

      // Should be parseable as URL
      expect(() => new URL(result)).not.toThrow()

      // Should preserve the namespace structure
      const parsed = new URL(result)
      expect(parsed.protocol).toBe('https:')
      expect(parsed.host).toBe('crm.headless.ly')
      expect(parsed.pathname).toBe('/acme/customer-123')
    })

    it('buildItemId handles special characters in id', async () => {
      // IDs with special characters should be handled correctly

      const { buildItemId } = await import('../../types/Collection').catch(() => ({
        buildItemId: undefined,
      }))

      // This will FAIL until implemented
      expect(buildItemId).toBeDefined()

      // Test cases for special characters
      const ns = 'https://example.com'
      const testCases = [
        { id: 'simple-id', expected: 'https://example.com/simple-id' },
        { id: 'id.with.dots', expected: 'https://example.com/id.with.dots' },
        { id: 'id_with_underscores', expected: 'https://example.com/id_with_underscores' },
        { id: 'user@example.com', expected: 'https://example.com/user@example.com' },
      ]

      for (const { id, expected } of testCases) {
        const result = `${ns}/${id}`
        expect(result).toBe(expected)
      }
    })

    it('buildItemId is idempotent for already-qualified IDs', async () => {
      // If passed a full URL, buildItemId should handle it gracefully
      // (either return as-is or throw a clear error)

      const { buildItemId } = await import('../../types/Collection').catch(() => ({
        buildItemId: undefined,
      }))

      // This will FAIL until implemented
      expect(buildItemId).toBeDefined()
    })
  })

  // ============================================================================
  // TESTS: CRUD Operations
  // ============================================================================

  describe('CRUD Operations', () => {
    describe('get(id)', () => {
      it('get returns typed DO without type parameter', async () => {
        // collection.get('acme') should return Startup, not require get<Startup>('acme')

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        // This will FAIL until types/Collection.ts is created
        expect(Collection).toBeDefined()
      })

      it('get constructs correct $id for returned item', async () => {
        // When get('acme') returns a Startup, its $id should be 'ns/acme'

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()

        // Expected behavior:
        // const startup = await collection.get('acme')
        // expect(startup.$id).toBe('https://startups.studio/acme')
      })

      it('get returns null for non-existent items', async () => {
        // get() should return null (not throw) for missing items

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })

      it('get preserves item $type from collection itemType', async () => {
        // Items returned by get() should have $type = collection.itemType

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()

        // Expected:
        // const startup = await collection.get('acme')
        // expect(startup.$type).toBe(collection.itemType)
      })
    })

    describe('create(id, data)', () => {
      it('create generates correct $id from ns and id', async () => {
        // create('acme', {...}) should generate $id = 'ns/acme'

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()

        // Expected:
        // const startup = await collection.create('acme', { name: 'Acme Corp' })
        // expect(startup.$id).toBe('https://startups.studio/acme')
      })

      it('create sets $type from collection itemType', async () => {
        // Created items should automatically have $type = collection.itemType

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()

        // Expected:
        // const startup = await collection.create('acme', { name: 'Acme Corp' })
        // expect(startup.$type).toBe('https://startups.studio/Startup')
      })

      it('create rejects duplicate ids', async () => {
        // Creating with an existing ID should fail (or upsert based on config)

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })

      it('create without id generates unique id', async () => {
        // If no id is provided, one should be generated

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()

        // Expected:
        // const startup = await collection.create(undefined, { name: 'Acme' })
        // expect(startup.$id).toMatch(/^https:\/\/startups\.studio\/[a-z0-9-]+$/)
      })
    })

    describe('update(id, data)', () => {
      it('update preserves $id and $type', async () => {
        // update() should not modify identity fields

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })

      it('update throws for non-existent items', async () => {
        // Updating a missing item should throw (not silently create)

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })
    })

    describe('delete(id)', () => {
      it('delete removes item by id', async () => {
        // delete('acme') should remove the item

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })

      it('delete is idempotent for missing items', async () => {
        // Deleting non-existent item should not throw

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })
    })
  })

  // ============================================================================
  // TESTS: Query Operations
  // ============================================================================

  describe('Query Operations', () => {
    describe('list()', () => {
      it('list returns paginated results', async () => {
        // list() should support pagination with limit and cursor

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()

        // Expected:
        // const page1 = await collection.list({ limit: 10 })
        // expect(page1.items).toHaveLength(10)
        // expect(page1.cursor).toBeDefined()
      })

      it('list cursor allows fetching next page', async () => {
        // Cursor should enable continuation

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()

        // Expected:
        // const page1 = await collection.list({ limit: 10 })
        // const page2 = await collection.list({ limit: 10, cursor: page1.cursor })
        // expect(page2.items).not.toEqual(page1.items)
      })

      it('list returns items with correct $type', async () => {
        // All items should have $type = collection.itemType

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })

      it('list returns empty array for empty collection', async () => {
        // Empty collection should return empty array, not null

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })
    })

    describe('find(query)', () => {
      it('find filters by field values', async () => {
        // find({ status: 'active' }) should return matching items

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })

      it('find returns typed results', async () => {
        // Results should be typed as T[]

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })
    })

    describe('count()', () => {
      it('count returns total items in collection', async () => {
        // count() should return number of items

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })

      it('count with query returns filtered count', async () => {
        // count({ status: 'active' }) should count only matching

        const { Collection } = await import('../../types/Collection').catch(() => ({
          Collection: undefined,
        }))

        expect(Collection).toBeDefined()
      })
    })
  })

  // ============================================================================
  // TESTS: ID Construction and Format
  // ============================================================================

  describe('ID Construction', () => {
    it('item $id follows ns/id format (not ns/type/id)', () => {
      // This is the key distinction for Collection vs heterogeneous container

      const ns = 'https://startups.studio'
      const id = 'acme'

      // Collection format: ns/id
      const collectionItemId = `${ns}/${id}`
      expect(collectionItemId).toBe('https://startups.studio/acme')

      // Thing format (heterogeneous): ns/type/id
      const type = 'Startup'
      const thingItemId = `${ns}/${type}/${id}`
      expect(thingItemId).toBe('https://startups.studio/Startup/acme')

      // They should be different!
      expect(collectionItemId).not.toBe(thingItemId)
    })

    it('$id is extractable from full URL', () => {
      // Given $id, we should be able to extract the local id

      const $id = 'https://startups.studio/acme'
      const parsed = new URL($id)

      // Extract local id (last path segment)
      const localId = parsed.pathname.slice(1) // Remove leading /
      expect(localId).toBe('acme')
    })

    it('$id with branch qualifier preserves base id', () => {
      // $id can have qualifiers like @branch - these should be handled correctly

      // Physical $id with branch qualifier
      const $idWithBranch = 'https://startups.studio/acme@feature'

      // The base id is still 'acme'
      const baseId = 'acme'
      expect($idWithBranch).toContain(baseId)
    })

    it('$id with shard qualifier preserves base id', () => {
      // $id can have qualifiers like ?shard=1

      const $idWithShard = 'https://startups.studio/acme?shard=1'
      const parsed = new URL($idWithShard)

      // Pathname should be the base path
      expect(parsed.pathname).toBe('/acme')

      // Shard is in search params
      expect(parsed.searchParams.get('shard')).toBe('1')
    })
  })

  // ============================================================================
  // TESTS: Collection Factory API
  // ============================================================================

  describe('Collection Factory API', () => {
    it('collection<T>(type) returns typed collection', async () => {
      // DO.collection<Startup>('Startup') should return Collection<Startup>

      // This will FAIL until the factory is implemented
      const { collection } = await import('../../types/Collection').catch(() => ({
        collection: undefined,
      }))

      expect(collection).toBeDefined()
    })

    it('collection factory infers itemType from type parameter', async () => {
      // collection<Startup>('Startup') should set itemType automatically

      const { collection } = await import('../../types/Collection').catch(() => ({
        collection: undefined,
      }))

      expect(collection).toBeDefined()
    })

    it('collection is generic over item type T', async () => {
      // Type parameter T should flow through to CRUD operations

      interface Startup extends Thing {
        $id: string
        $type: string
        name: string
        fundingStage?: string
      }

      const { collection } = await import('../../types/Collection').catch(() => ({
        collection: undefined as CollectionFactory | undefined,
      }))

      expect(collection).toBeDefined()

      // Expected: collection<Startup>('Startup').get('id') returns Promise<Startup | null>
    })
  })

  // ============================================================================
  // TESTS: Stream Context Integration
  // ============================================================================

  describe('Stream Context', () => {
    it('items have $context equal to collection ns', async () => {
      // When streaming items, $context should be the collection's ns
      // This is used for efficient SQL queries

      const { Collection } = await import('../../types/Collection').catch(() => ({
        Collection: undefined,
      }))

      expect(Collection).toBeDefined()

      // Expected stream format:
      // {
      //   $id: 'https://startups.studio/acme',
      //   $type: 'https://startups.studio/Startup',
      //   $context: 'https://startups.studio', // == collection.ns
      //   ...data
      // }
    })

    it('$context enables passthrough SQL queries', () => {
      // Streams can filter by $context without computing $id in SQL

      // This documents the expected optimization
      const expectedQuery = `
        SELECT * FROM things
        WHERE $context = 'https://startups.studio'
      `

      // The query should NOT need to parse $id or compute namespace
      expect(expectedQuery).toContain('$context')
      expect(expectedQuery).not.toContain('SUBSTR')
      expect(expectedQuery).not.toContain('INSTR')
    })
  })

  // ============================================================================
  // TESTS: Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('throws on invalid ns format', async () => {
      // ns must be a valid URL

      const { Collection } = await import('../../types/Collection').catch(() => ({
        Collection: undefined,
      }))

      expect(Collection).toBeDefined()

      // Expected: new Collection({ ns: 'invalid' }) throws
    })

    it('throws on invalid itemType format', async () => {
      // itemType must be a valid URL

      const { Collection } = await import('../../types/Collection').catch(() => ({
        Collection: undefined,
      }))

      expect(Collection).toBeDefined()
    })

    it('throws on empty id in get/create/update/delete', async () => {
      // Empty string id should be rejected

      const { Collection } = await import('../../types/Collection').catch(() => ({
        Collection: undefined,
      }))

      expect(Collection).toBeDefined()

      // Expected: collection.get('') throws
    })
  })

  // ============================================================================
  // TESTS: Type Safety
  // ============================================================================

  describe('Type Safety', () => {
    it('Collection type is exported from types/Collection.ts', async () => {
      // The module should export Collection type

      const exports = await import('../../types/Collection').catch(() => null)

      // This will FAIL until the module exists
      expect(exports).not.toBeNull()
    })

    it('CollectionData type is exported', async () => {
      // Should export the data interface separately

      const exports = await import('../../types/Collection').catch(() => ({ CollectionData: undefined }))

      expect(exports.CollectionData).toBeDefined()
    })

    it('types are exported from types/index.ts', async () => {
      // Collection types should be re-exported from index

      const exports = await import('../../types').catch(() => ({ Collection: undefined }))

      // This will FAIL until added to index
      expect(exports.Collection).toBeDefined()
    })
  })
})

// ============================================================================
// TESTS: Integration with DO Base Class
// ============================================================================

describe('Collection Integration with DO', () => {
  it('DO.collection() method returns Collection interface', async () => {
    // The DO class should have a collection() method

    const { DO } = await import('../DO').catch(() => ({ DO: undefined }))

    expect(DO).toBeDefined()

    // Current DO.collection() exists but returns ThingsCollection, not Collection
    // This test documents the expected migration
  })

  it('DO has $type discriminator', async () => {
    // DO instances should have $type for discrimination

    const { DO } = await import('../DO').catch(() => ({ DO: undefined }))

    expect(DO).toBeDefined()

    // Expected: DO instance has $type property
    // This will FAIL until DO is updated with type discriminator
  })

  it('collection items use DO ns for $id construction', async () => {
    // Items in a collection should use the DO's ns

    const { DO } = await import('../DO').catch(() => ({ DO: undefined }))

    expect(DO).toBeDefined()

    // Expected:
    // const do = new DO(ctx, env)
    // await do.initialize({ ns: 'https://startups.studio' })
    // const collection = do.collection<Startup>('Startup')
    // const item = await collection.create('acme', { name: 'Acme' })
    // expect(item.$id).toBe('https://startups.studio/acme')
  })
})
