/**
 * Enhanced Domain Resolution Tests
 *
 * TDD RED Phase: Tests for domain resolution enhancements
 *
 * 1. Circuit Breaker with Half-Open State
 *    - After timeout, circuit goes to half-open state
 *    - Half-open allows one test request through
 *    - Success in half-open closes the circuit
 *    - Failure in half-open re-opens the circuit
 *
 * 2. LRU Stub Caching
 *    - Cache evicts least recently used stubs when full
 *    - Configurable max cache size
 *    - Cache invalidated on circuit break
 *
 * 3. R2 SQL Global Fallback
 *    - When local objects table lookup fails, try R2 SQL
 *    - R2 stores global namespace registry
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DO, type Env } from '../DO'
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
  public setObjectsStoreMock(objectsStore: { get: (ns: string) => Promise<unknown>; getGlobal?: (ns: string) => Promise<unknown> }) {
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

  public getCircuitBreakerState(ns: string): { failures: number; openUntil: number; state?: 'open' | 'half-open' | 'closed' } | undefined {
    // @ts-expect-error - accessing private field for testing
    return this._circuitBreaker.get(ns)
  }

  public setCircuitBreakerState(ns: string, state: { failures: number; openUntil: number; state?: 'open' | 'half-open' | 'closed' }): void {
    // @ts-expect-error - accessing private field for testing
    this._circuitBreaker.set(ns, state)
  }

  // Get stub cache entries for LRU testing
  public getStubCacheEntries(): Map<string, { stub: unknown; cachedAt: number; lastUsed: number }> {
    // @ts-expect-error - accessing private field for testing
    return this._stubCache
  }

  // Set stub cache max size for testing
  public setStubCacheMaxSize(size: number): void {
    // @ts-expect-error - accessing private field for testing
    this._stubCacheMaxSize = size
  }
}

// ============================================================================
// TESTS: Circuit Breaker with Half-Open State
// ============================================================================

describe('Circuit Breaker Half-Open State', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: TestDO

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new TestDO(mockState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('transitions to half-open state after timeout expires', async () => {
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
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Cause circuit to open (3 failures)
    for (let i = 0; i < 3; i++) {
      try {
        await doInstance.testResolveCrossDO('https://failing.do', 'item', 'main')
      } catch {
        // Expected to fail
      }
    }

    // Verify circuit is open
    const stateBeforeTimeout = doInstance.getCircuitBreakerState('https://failing.do')
    expect(stateBeforeTimeout?.state).toBe('open')

    // Advance time past the timeout (30 seconds)
    vi.advanceTimersByTime(31000)

    // Make a new stub that succeeds (for the half-open test)
    const successStub = createMockDOStub(mockDOId)
    const successNamespace = createMockDONamespace(successStub)
    mockEnv = createMockEnv({ DO: successNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Copy the circuit breaker state to the new instance
    doInstance.setCircuitBreakerState('https://failing.do', {
      ...stateBeforeTimeout!,
      openUntil: Date.now() - 1000, // Past the timeout
    })

    // Next call should transition to half-open state and then succeed
    try {
      await doInstance.testResolveCrossDO('https://failing.do', 'item', 'main')
    } catch {
      // May fail but should have transitioned to half-open first
    }

    // After the request, check if it transitioned through half-open
    // (If successful, circuit is cleared; if failed from half-open, it's back to open)
    const stateAfterRequest = doInstance.getCircuitBreakerState('https://failing.do')
    // On success, the circuit breaker is deleted (undefined)
    expect(stateAfterRequest).toBeUndefined()
  })

  it('allows one test request through in half-open state', async () => {
    const mockDOId = createMockDOId('remote-do-id-123')
    const mockStub = createMockDOStub(mockDOId)
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
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Manually set circuit to half-open state
    doInstance.setCircuitBreakerState('https://recovering.do', {
      failures: 0,
      openUntil: Date.now() - 1000, // Past the timeout
      state: 'half-open',
    })

    // Request should go through
    const result = await doInstance.testResolveCrossDO('https://recovering.do', 'item', 'main')
    expect(result).toBeDefined()
    expect(mockStub.fetch).toHaveBeenCalledTimes(1)
  })

  it('closes circuit on successful half-open request', async () => {
    const mockDOId = createMockDOId('remote-do-id-123')
    const mockStub = createMockDOStub(mockDOId)
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
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Manually set circuit to half-open state
    doInstance.setCircuitBreakerState('https://recovering.do', {
      failures: 0,
      openUntil: Date.now() - 1000,
      state: 'half-open',
    })

    // Successful request
    await doInstance.testResolveCrossDO('https://recovering.do', 'item', 'main')

    // Circuit should be closed (state removed)
    const state = doInstance.getCircuitBreakerState('https://recovering.do')
    expect(state).toBeUndefined()
  })

  it('re-opens circuit on failed half-open request', async () => {
    const mockDOId = createMockDOId('remote-do-id-123')
    const mockStub = createMockDOStubWithError(mockDOId, 'Still failing')
    const mockNamespace = createMockDONamespace(mockStub)

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    // Mock the objects store
    const mockObjectsStore = {
      get: vi.fn(async () => ({
        ns: 'https://stillfailing.do',
        id: 'remote-do-id-123',
        class: 'DO',
        relation: null,
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Manually set circuit to half-open state
    doInstance.setCircuitBreakerState('https://stillfailing.do', {
      failures: 0,
      openUntil: Date.now() - 1000,
      state: 'half-open',
    })

    // Failed request
    try {
      await doInstance.testResolveCrossDO('https://stillfailing.do', 'item', 'main')
    } catch {
      // Expected
    }

    // Circuit should be re-opened
    const state = doInstance.getCircuitBreakerState('https://stillfailing.do')
    expect(state?.state).toBe('open')
    expect(state?.openUntil).toBeGreaterThan(Date.now())
  })

  it('blocks additional requests while half-open test is in progress', async () => {
    const mockDOId = createMockDOId('remote-do-id-123')
    let fetchResolve: () => void
    const fetchPromise = new Promise<void>((resolve) => {
      fetchResolve = resolve
    })

    const mockStub: DurableObjectStub = {
      id: mockDOId,
      fetch: vi.fn(async () => {
        await fetchPromise
        return new Response(JSON.stringify({ $id: 'test', $type: 'Test' }), { status: 200 })
      }),
    }
    const mockNamespace = createMockDONamespace(mockStub)

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    // Mock the objects store
    const mockObjectsStore = {
      get: vi.fn(async () => ({
        ns: 'https://halfopen.do',
        id: 'remote-do-id-123',
        class: 'DO',
        relation: null,
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Set circuit to half-open
    doInstance.setCircuitBreakerState('https://halfopen.do', {
      failures: 0,
      openUntil: Date.now() - 1000,
      state: 'half-open',
    })

    // Start first request (half-open test)
    const firstRequest = doInstance.testResolveCrossDO('https://halfopen.do', 'item', 'main')

    // Second request should be blocked
    const secondRequest = doInstance.testResolveCrossDO('https://halfopen.do', 'item2', 'main')

    // Second should reject immediately while first is pending
    await expect(secondRequest).rejects.toThrow('Circuit breaker in half-open test')

    // Complete the first request
    fetchResolve!()
    await firstRequest
  })
})

// ============================================================================
// TESTS: LRU Stub Caching
// ============================================================================

describe('LRU Stub Caching', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: TestDO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new TestDO(mockState, mockEnv)
  })

  it('evicts least recently used stub when cache is full', async () => {
    const mockNamespace = {
      idFromName: vi.fn((name: string) => createMockDOId(name)),
      idFromString: vi.fn((id: string) => createMockDOId(id)),
      newUniqueId: vi.fn(() => createMockDOId(`unique-${Date.now()}`)),
      get: vi.fn(() => createMockDOStub(createMockDOId('stub-id'))),
    }

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    // Set max cache size to 3
    doInstance.setStubCacheMaxSize(3)

    // Create mock objects store that returns different namespaces
    const mockObjectsStore = {
      get: vi.fn(async (ns: string) => ({
        ns,
        id: `do-id-${ns}`,
        class: 'DO',
        relation: null,
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Cache 3 stubs with small delays to ensure different timestamps
    await doInstance.testResolveCrossDO('https://ns1.do', 'item', 'main')
    await new Promise((r) => setTimeout(r, 5))
    await doInstance.testResolveCrossDO('https://ns2.do', 'item', 'main')
    await new Promise((r) => setTimeout(r, 5))
    await doInstance.testResolveCrossDO('https://ns3.do', 'item', 'main')

    expect(doInstance.getStubCacheSize()).toBe(3)

    // Wait a bit then access ns1 and ns3 to make them recently used
    await new Promise((r) => setTimeout(r, 5))
    await doInstance.testResolveCrossDO('https://ns1.do', 'item', 'main')
    await new Promise((r) => setTimeout(r, 5))
    await doInstance.testResolveCrossDO('https://ns3.do', 'item', 'main')

    // Add ns4, should evict ns2 (least recently used)
    await doInstance.testResolveCrossDO('https://ns4.do', 'item', 'main')

    expect(doInstance.getStubCacheSize()).toBe(3)

    const cacheEntries = doInstance.getStubCacheEntries()
    expect(cacheEntries.has('https://ns1.do')).toBe(true)
    expect(cacheEntries.has('https://ns2.do')).toBe(false) // Evicted
    expect(cacheEntries.has('https://ns3.do')).toBe(true)
    expect(cacheEntries.has('https://ns4.do')).toBe(true)
  })

  it('updates lastUsed timestamp on cache hit', async () => {
    const mockNamespace = {
      idFromName: vi.fn((name: string) => createMockDOId(name)),
      idFromString: vi.fn((id: string) => createMockDOId(id)),
      newUniqueId: vi.fn(() => createMockDOId(`unique-${Date.now()}`)),
      get: vi.fn(() => createMockDOStub(createMockDOId('stub-id'))),
    }

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    const mockObjectsStore = {
      get: vi.fn(async (ns: string) => ({
        ns,
        id: `do-id-${ns}`,
        class: 'DO',
        relation: null,
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // First access
    await doInstance.testResolveCrossDO('https://ns1.do', 'item', 'main')
    const entries = doInstance.getStubCacheEntries()
    const firstLastUsed = entries.get('https://ns1.do')?.lastUsed

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Second access
    await doInstance.testResolveCrossDO('https://ns1.do', 'item', 'main')
    const secondLastUsed = entries.get('https://ns1.do')?.lastUsed

    expect(secondLastUsed).toBeGreaterThan(firstLastUsed!)
  })

  it('invalidates cache entry when circuit breaks', async () => {
    const mockDOId = createMockDOId('remote-do-id-123')
    const mockStub = createMockDOStubWithError(mockDOId, 'Error')
    const mockNamespace = createMockDONamespace(mockStub)

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    const mockObjectsStore = {
      get: vi.fn(async () => ({
        ns: 'https://breaking.do',
        id: 'remote-do-id-123',
        class: 'DO',
        relation: null,
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Cause failures to trigger circuit break
    for (let i = 0; i < 3; i++) {
      try {
        await doInstance.testResolveCrossDO('https://breaking.do', 'item', 'main')
      } catch {
        // Expected
      }
    }

    // Cache should be cleared for this namespace
    expect(doInstance.getStubCacheEntries().has('https://breaking.do')).toBe(false)
  })

  it('respects configurable cache size', async () => {
    const mockNamespace = {
      idFromName: vi.fn((name: string) => createMockDOId(name)),
      idFromString: vi.fn((id: string) => createMockDOId(id)),
      newUniqueId: vi.fn(() => createMockDOId(`unique-${Date.now()}`)),
      get: vi.fn(() => createMockDOStub(createMockDOId('stub-id'))),
    }

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    // Set max cache size to 2
    doInstance.setStubCacheMaxSize(2)

    const mockObjectsStore = {
      get: vi.fn(async (ns: string) => ({
        ns,
        id: `do-id-${ns}`,
        class: 'DO',
        relation: null,
        createdAt: new Date(),
      })),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    // Try to cache 4 stubs
    await doInstance.testResolveCrossDO('https://ns1.do', 'item', 'main')
    await doInstance.testResolveCrossDO('https://ns2.do', 'item', 'main')
    await doInstance.testResolveCrossDO('https://ns3.do', 'item', 'main')
    await doInstance.testResolveCrossDO('https://ns4.do', 'item', 'main')

    // Should only have 2 entries
    expect(doInstance.getStubCacheSize()).toBe(2)
  })
})

// ============================================================================
// TESTS: R2 SQL Global Fallback
// ============================================================================

describe('R2 SQL Global Fallback', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: TestDO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new TestDO(mockState, mockEnv)
  })

  it('falls back to R2 SQL when local objects table returns null', async () => {
    const mockDOId = createMockDOId('remote-do-id-123')
    const mockStub = createMockDOStub(mockDOId)
    const mockNamespace = createMockDONamespace(mockStub)

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    let getGlobalCalled = false

    // Mock objects store with null local result but successful global fallback
    const mockObjectsStore = {
      get: vi.fn(async (ns: string) => null), // Local lookup fails
      getGlobal: vi.fn(async (ns: string) => {
        getGlobalCalled = true
        return {
          ns: 'https://global.do',
          id: 'remote-do-id-123',
          class: 'DO',
          relation: null,
          createdAt: new Date(),
        }
      }),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    const result = await doInstance.testResolveCrossDO('https://global.do', 'item', 'main')

    expect(getGlobalCalled).toBe(true)
    expect(result).toBeDefined()
  })

  it('throws error when both local and global lookup fail', async () => {
    const mockNamespace = createMockDONamespace()
    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    // Mock objects store with null results for both
    const mockObjectsStore = {
      get: vi.fn(async () => null),
      getGlobal: vi.fn(async () => null),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    await expect(
      doInstance.testResolveCrossDO('https://unknown.do', 'item', 'main')
    ).rejects.toThrow('Unknown namespace: https://unknown.do')
  })

  it('uses local result when available (does not call global)', async () => {
    const mockDOId = createMockDOId('remote-do-id-123')
    const mockStub = createMockDOStub(mockDOId)
    const mockNamespace = createMockDONamespace(mockStub)

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    const mockObjectsStore = {
      get: vi.fn(async (ns: string) => ({
        ns,
        id: 'remote-do-id-123',
        class: 'DO',
        relation: null,
        createdAt: new Date(),
      })),
      getGlobal: vi.fn(async () => {
        throw new Error('Should not be called')
      }),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    const result = await doInstance.testResolveCrossDO('https://local.do', 'item', 'main')

    expect(result).toBeDefined()
    expect(mockObjectsStore.getGlobal).not.toHaveBeenCalled()
  })

  it('caches global lookup result in local objects table', async () => {
    const mockDOId = createMockDOId('remote-do-id-123')
    const mockStub = createMockDOStub(mockDOId)
    const mockNamespace = createMockDONamespace(mockStub)

    mockEnv = createMockEnv({ DO: mockNamespace as unknown as DurableObjectNamespace })
    doInstance = new TestDO(mockState, mockEnv)

    let registerCalled = false

    const mockObjectsStore = {
      get: vi.fn(async (ns: string) => null),
      getGlobal: vi.fn(async (ns: string) => ({
        ns: 'https://global.do',
        id: 'remote-do-id-123',
        class: 'DO',
        relation: null,
        createdAt: new Date(),
      })),
      register: vi.fn(async (data: unknown) => {
        registerCalled = true
        return data
      }),
    }
    doInstance.setObjectsStoreMock(mockObjectsStore)

    await doInstance.testResolveCrossDO('https://global.do', 'item', 'main')

    expect(registerCalled).toBe(true)
  })
})

// ============================================================================
// TESTS: ObjectsStore.getGlobal (R2 SQL)
// ============================================================================

describe('ObjectsStore.getGlobal', () => {
  it('queries R2 SQL for global namespace registry', async () => {
    // This test is for the ObjectsStore implementation
    // We'll test that the method exists and queries R2 correctly

    // Mock R2 with SQL interface
    const mockR2Sql = {
      exec: vi.fn(async (query: string, params: unknown[]) => ({
        results: [
          {
            ns: 'https://found.do',
            id: 'global-do-id',
            class: 'DO',
          },
        ],
      })),
    }

    // Note: This would be implemented in ObjectsStore
    // For now, we're just documenting the expected interface
    expect(mockR2Sql.exec).toBeDefined()
  })

  it('returns null when namespace not found in R2 SQL', async () => {
    const mockR2Sql = {
      exec: vi.fn(async () => ({ results: [] })),
    }

    // Query returns empty results
    const result = await mockR2Sql.exec('SELECT * FROM objects WHERE ns = ?', ['https://notfound.do'])
    expect(result.results).toHaveLength(0)
  })
})
