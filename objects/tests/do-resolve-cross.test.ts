/**
 * DO resolveCrossDO Tests
 *
 * TDD RED Phase: Tests for cross-DO resolution
 *
 * The resolveCrossDO method should:
 * 1. Look up the namespace in the objects table
 * 2. Get the DO class and ID from the objects record
 * 3. Create a DO stub using env.DO.get(env.DO.idFromString(doId))
 * 4. Call stub.fetch() with a resolve request
 * 5. Parse and return Thing from response
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../core/DO'
import type { Thing } from '../../types/Thing'

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
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
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

/**
 * Create a mock DurableObjectState with both KV and SQL storage
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
  } as unknown as DurableObjectState
}

/**
 * Create a mock environment with optional bindings
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

// ============================================================================
// TYPE DECLARATIONS FOR TESTS
// ============================================================================

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  sql: unknown
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  idFromString(id: string): DurableObjectId
  newUniqueId(options?: { jurisdiction?: string }): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

interface DurableObjectStub {
  id: DurableObjectId
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock DO stub that returns a Thing from fetch
 */
function createMockDOStub(id: DurableObjectId, mockThing?: Partial<Thing>): DurableObjectStub {
  const defaultThing: Partial<Thing> = {
    $id: 'https://other.do/item',
    $type: 'https://other.do/Item',
    name: 'Test Item',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  return {
    id,
    fetch: vi.fn(async (request: Request | string) => {
      const thing = { ...defaultThing, ...mockThing }
      return new Response(JSON.stringify(thing), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  }
}

/**
 * Create a mock DO stub that returns an error
 */
function createMockDOStubWithError(id: DurableObjectId, errorMessage: string): DurableObjectStub {
  return {
    id,
    fetch: vi.fn(async () => {
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  }
}

/**
 * Create a mock DO namespace that returns a specific stub
 */
function createMockDONamespace(stub?: DurableObjectStub): DurableObjectNamespace {
  const defaultStub = createMockDOStub(createMockDOId('stub-id'))

  return {
    idFromName: vi.fn((name: string) => createMockDOId(name)),
    idFromString: vi.fn((id: string) => createMockDOId(id)),
    newUniqueId: vi.fn(() => createMockDOId(`unique-${Date.now()}`)),
    get: vi.fn(() => stub || defaultStub),
  }
}

/**
 * TestDO - Exposes protected methods for testing
 */
class TestDO extends DO {
  // Expose protected methods for testing
  public async testResolveCrossDO(ns: string, path: string, ref: string): Promise<Thing> {
    return this.resolveCrossDO(ns, path, ref)
  }

  // Allow setting the objects store mock
  public setObjectsStoreMock(objectsStore: { get: (ns: string) => Promise<unknown> }) {
    // Override the objects getter
    Object.defineProperty(this, 'objects', {
      get: () => objectsStore,
    })
  }

  // Expose cache clearing for tests
  public testClearCache(ns?: string): void {
    this.clearCrossDoCache(ns)
  }

  // Access to internal caches for testing
  public getStubCacheSize(): number {
    // @ts-expect-error - accessing private field for testing
    return this._stubCache.size
  }

  public getCircuitBreakerState(ns: string): { failures: number; openUntil: number } | undefined {
    // @ts-expect-error - accessing private field for testing
    return this._circuitBreaker.get(ns)
  }
}

// ============================================================================
// TESTS: resolveCrossDO
// ============================================================================

describe('DO.resolveCrossDO', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: TestDO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new TestDO(mockState, mockEnv)
  })

  describe('objects table lookup', () => {
    it('looks up namespace in objects table', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub = createMockDOStub(mockDOId)
      const mockNamespace = createMockDONamespace(mockStub)

      // Create DO with namespace binding
      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store to return a valid object
      const mockObjectsStore = {
        get: vi.fn(async (ns: string) => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      await doInstance.testResolveCrossDO('https://other.do', 'item', 'main')

      // Verify the objects store was queried with the namespace
      expect(mockObjectsStore.get).toHaveBeenCalledWith('https://other.do')
    })
  })

  describe('DO stub creation', () => {
    it('creates DO stub from binding using objects record id', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub = createMockDOStub(mockDOId)
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      await doInstance.testResolveCrossDO('https://other.do', 'item', 'main')

      // Verify idFromString was called with the DO id from objects record
      expect(mockNamespace.idFromString).toHaveBeenCalledWith('remote-do-id-123')
      // Verify get was called with the id
      expect(mockNamespace.get).toHaveBeenCalled()
    })
  })

  describe('remote DO resolution', () => {
    it('calls resolve on remote DO via fetch', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub = createMockDOStub(mockDOId)
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      await doInstance.testResolveCrossDO('https://other.do', 'item', 'main')

      // Verify fetch was called on the stub
      expect(mockStub.fetch).toHaveBeenCalled()

      // Verify the request contains the path and ref
      const fetchCall = (mockStub.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const request = fetchCall[0] as Request
      expect(request.url).toContain('/resolve')
    })

    it('parses and returns Thing from response', async () => {
      const expectedThing = {
        $id: 'https://other.do/item',
        $type: 'https://other.do/Item',
        name: 'Resolved Item',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub: DurableObjectStub = {
        id: mockDOId,
        fetch: vi.fn(async () => {
          return new Response(JSON.stringify(expectedThing), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }),
      }
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      const result = await doInstance.testResolveCrossDO('https://other.do', 'item', 'main')

      expect(result.$id).toBe('https://other.do/item')
      expect(result.$type).toBe('https://other.do/Item')
      expect(result.name).toBe('Resolved Item')
    })
  })

  describe('error handling', () => {
    it('throws error when namespace not found in objects table', async () => {
      const mockNamespace = createMockDONamespace()
      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store to return null (not found)
      const mockObjectsStore = {
        get: vi.fn(async () => null),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      await expect(
        doInstance.testResolveCrossDO('https://unknown.do', 'item', 'main')
      ).rejects.toThrow('Unknown namespace: https://unknown.do')
    })

    it('throws error when DO binding is not configured', async () => {
      // No DO binding in env
      mockEnv = createMockEnv({ DO: undefined })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      await expect(
        doInstance.testResolveCrossDO('https://other.do', 'item', 'main')
      ).rejects.toThrow('DO namespace binding not configured')
    })

    it('throws error when remote DO fetch fails', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub = createMockDOStubWithError(mockDOId, 'Internal Server Error')
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      await expect(
        doInstance.testResolveCrossDO('https://other.do', 'item', 'main')
      ).rejects.toThrow('Cross-DO resolution failed')
    })

    it('throws error when response is not valid JSON', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub: DurableObjectStub = {
        id: mockDOId,
        fetch: vi.fn(async () => {
          return new Response('not valid json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }),
      }
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      await expect(
        doInstance.testResolveCrossDO('https://other.do', 'item', 'main')
      ).rejects.toThrow('Invalid response from remote DO')
    })
  })

  describe('request construction', () => {
    it('constructs resolve request with path and ref parameters', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub = createMockDOStub(mockDOId)
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      await doInstance.testResolveCrossDO('https://other.do', 'items/item-123', 'feature-branch')

      const fetchCall = (mockStub.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const request = fetchCall[0] as Request
      const url = new URL(request.url)

      expect(url.pathname).toBe('/resolve')
      expect(url.searchParams.get('path')).toBe('items/item-123')
      expect(url.searchParams.get('ref')).toBe('feature-branch')
    })
  })

  describe('stub caching', () => {
    it('caches DO stubs for repeated calls', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub = createMockDOStub(mockDOId)
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      // Make two calls
      await doInstance.testResolveCrossDO('https://other.do', 'item', 'main')
      await doInstance.testResolveCrossDO('https://other.do', 'item2', 'main')

      // Namespace.get should only be called once (stub is cached)
      expect(mockNamespace.get).toHaveBeenCalledTimes(1)

      // But fetch should be called twice (once per resolve)
      expect(mockStub.fetch).toHaveBeenCalledTimes(2)
    })

    it('clears cache when requested', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub = createMockDOStub(mockDOId)
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://other.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      // First call
      await doInstance.testResolveCrossDO('https://other.do', 'item', 'main')
      expect(doInstance.getStubCacheSize()).toBe(1)

      // Clear cache
      doInstance.testClearCache('https://other.do')
      expect(doInstance.getStubCacheSize()).toBe(0)
    })
  })

  describe('circuit breaker', () => {
    it('tracks failures and eventually opens circuit', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      const mockStub = createMockDOStubWithError(mockDOId, 'Internal Server Error')
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://failing.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      // Make 3 failing calls (threshold)
      for (let i = 0; i < 3; i++) {
        try {
          await doInstance.testResolveCrossDO('https://failing.do', 'item', 'main')
        } catch {
          // Expected to fail
        }
      }

      // Circuit should now be open
      await expect(
        doInstance.testResolveCrossDO('https://failing.do', 'item', 'main')
      ).rejects.toThrow('Circuit breaker open for namespace: https://failing.do')
    })

    it('resets circuit breaker on successful call', async () => {
      const mockDOId = createMockDOId('remote-do-id-123')
      let callCount = 0

      // First calls fail, then succeed
      const mockStub: DurableObjectStub = {
        id: mockDOId,
        fetch: vi.fn(async () => {
          callCount++
          if (callCount <= 2) {
            return new Response(JSON.stringify({ error: 'Error' }), { status: 500 })
          }
          return new Response(JSON.stringify({ $id: 'test', $type: 'Test' }), { status: 200 })
        }),
      }
      const mockNamespace = createMockDONamespace(mockStub)

      mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
      doInstance = new TestDO(mockState, mockEnv)

      // Mock the objects store
      const mockObjectsStore = {
        get: vi.fn(async () => ({
          ns: 'https://recovering.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: null,
          cached: null,
          createdAt: new Date(),
        })),
      }
      doInstance.setObjectsStoreMock(mockObjectsStore)

      // Two failures
      for (let i = 0; i < 2; i++) {
        try {
          await doInstance.testResolveCrossDO('https://recovering.do', 'item', 'main')
        } catch {
          // Expected to fail
        }
      }

      // Should have recorded failures
      const state = doInstance.getCircuitBreakerState('https://recovering.do')
      expect(state?.failures).toBe(2)

      // Third call succeeds
      const result = await doInstance.testResolveCrossDO('https://recovering.do', 'item', 'main')
      expect(result.$id).toBe('test')

      // Circuit breaker should be reset
      expect(doInstance.getCircuitBreakerState('https://recovering.do')).toBeUndefined()
    })
  })
})
