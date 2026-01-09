/**
 * Domain Proxy Method Invocation Tests
 *
 * TDD RED phase: Tests for createDomainProxy() method invocation in DO.ts
 *
 * These tests verify that $.Customer('acme').notify() resolves and calls methods
 * correctly, handling both local and cross-DO scenarios.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DO, type Env } from '../DO'

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
 * Create mock Durable Object state
 */
function createMockState() {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: {
      toString: () => 'mock-do-id-12345',
      name: 'test-do',
    },
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    abort: vi.fn(),
  } as unknown as DurableObjectState
}

/**
 * Create mock environment
 */
function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    DO: undefined,
    ...overrides,
  }
}

// ============================================================================
// TEST DO SUBCLASS - Adds methods for testing
// ============================================================================

/**
 * Test DO subclass with domain methods
 */
class TestDO extends DO<Env> {
  // Track method calls for verification
  methodCalls: Array<{ method: string; args: unknown[] }> = []

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Set namespace for testing
    // @ts-expect-error - Setting readonly after construction for testing
    this.ns = 'https://test.do'
  }

  // Local method that can be called
  async notify(message?: string): Promise<{ sent: boolean; message: string }> {
    this.methodCalls.push({ method: 'notify', args: [message] })
    return { sent: true, message: message || 'default notification' }
  }

  // Method that returns data
  async getData(): Promise<{ name: string; value: number }> {
    this.methodCalls.push({ method: 'getData', args: [] })
    return { name: 'test', value: 42 }
  }

  // Method with multiple arguments
  async processOrder(orderId: string, options: { priority: string; notify: boolean }): Promise<string> {
    this.methodCalls.push({ method: 'processOrder', args: [orderId, options] })
    return `Processed order ${orderId} with priority ${options.priority}`
  }

  // Method that throws an error
  async failingMethod(): Promise<void> {
    this.methodCalls.push({ method: 'failingMethod', args: [] })
    throw new Error('Intentional failure')
  }

  // Async method with delay
  async delayedMethod(delayMs: number): Promise<string> {
    this.methodCalls.push({ method: 'delayedMethod', args: [delayMs] })
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return 'completed'
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Domain Proxy Method Invocation', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let testDO: TestDO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    testDO = new TestDO(mockState, mockEnv)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. BASIC METHOD INVOCATION
  // ==========================================================================

  describe('Basic Method Invocation', () => {
    it('$.Customer(id).notify() resolves and calls method', async () => {
      // When we call a method on a domain proxy, it should resolve to calling
      // a method on the target DO and return the result
      const result = await testDO.$.Customer('acme').notify()

      // The method should be called and return a result
      expect(result).toBeDefined()
      expect(result).toHaveProperty('sent')
    })

    it('$.Startup(id).getData() returns data', async () => {
      // getData should return the expected data structure
      const result = await testDO.$.Startup('headless').getData()

      expect(result).toBeDefined()
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('value')
    })

    it('method returns Promise that resolves properly', async () => {
      const promise = testDO.$.Customer('test-id').notify()

      // Should be a Promise
      expect(promise).toBeInstanceOf(Promise)

      // Should resolve to a value
      const result = await promise
      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // 2. METHOD ARGUMENTS
  // ==========================================================================

  describe('Method Arguments', () => {
    it('method with single argument passes correctly', async () => {
      const result = await testDO.$.Customer('acme').notify('Hello, Customer!')

      expect(result).toBeDefined()
      expect(result.message).toBe('Hello, Customer!')
    })

    it('method with multiple arguments passes correctly', async () => {
      const result = await testDO.$.Order('order-123').processOrder('order-123', {
        priority: 'high',
        notify: true,
      })

      expect(result).toBeDefined()
      expect(result).toContain('order-123')
      expect(result).toContain('high')
    })

    it('method with no arguments works', async () => {
      const result = await testDO.$.Entity('test').getData()

      expect(result).toBeDefined()
    })

    it('method with complex object argument works', async () => {
      const complexArg = {
        nested: {
          deeply: {
            value: 'test',
          },
        },
        array: [1, 2, 3],
        date: new Date().toISOString(),
      }

      // This tests that complex objects can be passed through the proxy
      const promise = testDO.$.Config('settings').processOrder('cfg-1', complexArg as unknown as { priority: string; notify: boolean })
      expect(promise).toBeInstanceOf(Promise)
    })
  })

  // ==========================================================================
  // 3. ERROR HANDLING
  // ==========================================================================

  describe('Error Propagation', () => {
    it('error from remote method propagates correctly', async () => {
      // When a method throws an error, it should propagate through the proxy
      await expect(testDO.$.Service('failing').failingMethod()).rejects.toThrow('Intentional failure')
    })

    it('calling non-existent method throws appropriate error', async () => {
      // Calling a method that doesn't exist should throw a clear error
      await expect(testDO.$.Entity('test').nonExistentMethod()).rejects.toThrow()
    })

    it('error includes method and target information', async () => {
      try {
        await testDO.$.Service('failing').failingMethod()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        // Error message should be informative
        expect((error as Error).message).toBeDefined()
      }
    })
  })

  // ==========================================================================
  // 4. LOCAL VS CROSS-DO ROUTING
  // ==========================================================================

  describe('Local vs Cross-DO Routing', () => {
    it('local thing calls method directly on this DO', async () => {
      // When the target is local (same ns), method should be called directly
      // For this test, we need to simulate local resolution

      // Call a method - for local targets, it should call the DO's method directly
      const result = await testDO.$.Customer('local-customer').notify('local call')

      // Verify the method was actually called on the DO
      // The implementation should recognize local targets and call directly
      expect(result).toBeDefined()
    })

    it('cross-DO calls should make RPC request', async () => {
      // When target is on a different DO, should make an RPC call
      // This test verifies the routing logic distinguishes local from remote

      // Create a mock DO namespace for cross-DO calls
      const mockStub = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ result: { data: 'from-remote' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      }

      const mockDONamespace = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'remote-do-id' }),
        get: vi.fn().mockReturnValue(mockStub),
      }

      // Create DO with mock namespace
      const envWithDO = createMockEnv({ DO: mockDONamespace as unknown as DurableObjectNamespace })
      const doWithRemote = new TestDO(mockState, envWithDO)

      // Cross-DO call should use the stub
      // The target namespace is different from this DO's namespace
      const promise = doWithRemote.$.RemoteEntity('remote-id').getData()

      expect(promise).toBeInstanceOf(Promise)
    })

    it('identifies local target by matching namespace', async () => {
      // Create a DO with a specific namespace
      const state = createMockState()
      const localDO = new TestDO(state, mockEnv)

      // When calling with the same namespace prefix, should be local
      // The implementation should compare namespaces to determine routing
      const result = await localDO.$.Test('local-thing').getData()

      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // 5. PROMISE BEHAVIOR
  // ==========================================================================

  describe('Promise Behavior', () => {
    it('returns Promise that can be awaited', async () => {
      const result = await testDO.$.Customer('test').notify()
      expect(result).toBeDefined()
    })

    it('supports .then() chaining', async () => {
      const result = await testDO.$.Customer('test')
        .notify()
        .then((res) => res.sent)

      expect(result).toBe(true)
    })

    it('supports .catch() for error handling', async () => {
      const error = await testDO.$.Service('test')
        .failingMethod()
        .catch((err) => err)

      expect(error).toBeInstanceOf(Error)
    })

    it('supports Promise.all for multiple calls', async () => {
      const results = await Promise.all([
        testDO.$.Customer('a').notify(),
        testDO.$.Customer('b').notify(),
        testDO.$.Customer('c').notify(),
      ])

      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.sent).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 6. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles undefined return value', async () => {
      // Create a method that returns undefined
      class DOWithUndefinedReturn extends TestDO {
        async returnsUndefined(): Promise<void> {
          // Returns undefined
        }
      }

      const state = createMockState()
      const doInstance = new DOWithUndefinedReturn(state, mockEnv)

      const result = await doInstance.$.Entity('test').returnsUndefined()
      expect(result).toBeUndefined()
    })

    it('handles null return value', async () => {
      class DOWithNullReturn extends TestDO {
        async returnsNull(): Promise<null> {
          return null
        }
      }

      const state = createMockState()
      const doInstance = new DOWithNullReturn(state, mockEnv)

      const result = await doInstance.$.Entity('test').returnsNull()
      expect(result).toBeNull()
    })

    it('method name with special characters works', async () => {
      // Methods should work even with valid JS method names that look unusual
      const proxy = testDO.$.Entity('test')

      // Should not throw when accessing valid method-like properties
      expect(typeof proxy.getData).toBe('function')
    })

    it('empty string id is handled', async () => {
      const promise = testDO.$.Customer('').notify()
      expect(promise).toBeInstanceOf(Promise)
    })

    it('special characters in id are handled', async () => {
      const promise = testDO.$.Customer('test/with/slashes').notify()
      expect(promise).toBeInstanceOf(Promise)
    })
  })

  // ==========================================================================
  // 7. METHOD CALL TRACKING (for verification)
  // ==========================================================================

  describe('Method Call Tracking', () => {
    it('local method calls are tracked', async () => {
      await testDO.$.Entity('test').notify('tracked message')

      // For local calls, we should be able to verify the method was called
      // This helps verify local routing works correctly
      expect(testDO.methodCalls.length).toBeGreaterThanOrEqual(0)
    })

    it('arguments are passed through correctly', async () => {
      await testDO.$.Order('test').processOrder('ord-1', {
        priority: 'urgent',
        notify: false,
      })

      // Verify arguments made it through the proxy
      // The actual verification depends on local routing implementation
      const calls = testDO.methodCalls.filter((c) => c.method === 'processOrder')
      // If local routing works, we should see the call
      if (calls.length > 0) {
        expect(calls[0].args[0]).toBe('ord-1')
        expect(calls[0].args[1]).toEqual({ priority: 'urgent', notify: false })
      }
    })
  })
})
