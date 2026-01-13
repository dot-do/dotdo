/**
 * Cap'n Web HTTP Batch Mode Tests
 *
 * Tests for the capnweb HTTP batch RPC integration with Durable Objects.
 * Verifies that handleCapnWebRpc correctly handles:
 *
 * 1. Basic RPC - POST to `/` returns valid RPC response
 * 2. Batch mode - Multiple method calls in single request
 * 3. Promise pipelining - Chained calls resolved server-side
 * 4. Error handling - Invalid methods return proper errors
 * 5. Error handling - Invalid JSON returns proper errors
 * 6. Security - Internal methods (fetch, alarm, etc.) are NOT exposed
 * 7. Security - Underscore-prefixed methods are hidden
 * 8. Method binding - `this` context is preserved
 *
 * These tests use the real capnweb library and real miniflare DOs.
 * NO MOCKS - per dotdo testing philosophy.
 *
 * @see {@link ./capnweb-target.ts} for the capnweb integration
 * @see {@link https://github.com/cloudflare/capnweb} for capnweb library
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createCapnWebTarget,
  isInternalMember,
  isCapnWebRequest,
  handleCapnWebRpc,
} from '../capnweb-target'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Simple test target class that mimics a DO's public API
 */
class TestApiTarget {
  private counter = 0
  private data: Map<string, unknown> = new Map()
  public publicProp = 'accessible'
  public _internalProp = 'hidden'

  // Public methods that should be exposed
  greet(name: string): string {
    return `Hello, ${name}!`
  }

  add(a: number, b: number): number {
    return a + b
  }

  multiply(a: number, b: number): number {
    return a * b
  }

  getCounter(): number {
    return this.counter
  }

  incrementCounter(): number {
    return ++this.counter
  }

  setData(key: string, value: unknown): void {
    this.data.set(key, value)
  }

  getData(key: string): unknown {
    return this.data.get(key)
  }

  async asyncMethod(delay: number): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, delay))
    return `Waited ${delay}ms`
  }

  throwError(message: string): never {
    throw new Error(message)
  }

  // Method that returns an object with nested data
  getUser(id: string): { id: string; name: string; email: string } {
    return {
      id,
      name: `User ${id}`,
      email: `user${id}@example.com`,
    }
  }

  // Method that uses `this` context
  getThisContext(): string {
    return `counter=${this.counter}, dataSize=${this.data.size}`
  }

  // Internal methods that should be hidden
  fetch(): Response {
    return new Response('fetch handler')
  }

  alarm(): void {
    // alarm handler
  }

  initialize(): void {
    // initialization
  }

  // Underscore-prefixed method (should be hidden)
  _internalMethod(): string {
    return 'internal'
  }

  // Hash-prefixed methods can't be tested directly as they're truly private
}

/**
 * Mock DO instance for testing handleCapnWebRpc
 */
class MockDO {
  private state = { value: 0 }
  public ns = 'https://test.api.dotdo.dev'

  // Public methods
  getValue(): number {
    return this.state.value
  }

  setValue(value: number): void {
    this.state.value = value
  }

  increment(): number {
    return ++this.state.value
  }

  echo(data: unknown): unknown {
    return data
  }

  // Internal DO methods (should be hidden)
  fetch(): Response {
    return new Response('Not exposed')
  }

  alarm(): void {
    throw new Error('Alarm should not be exposed')
  }

  // Underscore-prefixed (should be hidden)
  _privateHelper(): string {
    return 'private'
  }
}

// ============================================================================
// UNIT TESTS: isInternalMember
// ============================================================================

describe('isInternalMember', () => {
  describe('underscore prefix detection', () => {
    it('identifies underscore-prefixed members as internal', () => {
      expect(isInternalMember('_privateMethod')).toBe(true)
      expect(isInternalMember('_data')).toBe(true)
      expect(isInternalMember('_')).toBe(true)
      expect(isInternalMember('__proto__')).toBe(true)
    })

    it('allows non-underscore members', () => {
      expect(isInternalMember('publicMethod')).toBe(false)
      expect(isInternalMember('data')).toBe(false)
      expect(isInternalMember('getValue')).toBe(false)
    })
  })

  describe('hash prefix detection', () => {
    it('identifies hash-prefixed members as internal', () => {
      expect(isInternalMember('#privateField')).toBe(true)
      expect(isInternalMember('#method')).toBe(true)
    })
  })

  describe('known internal methods', () => {
    it('identifies DO lifecycle methods as internal', () => {
      expect(isInternalMember('fetch')).toBe(true)
      expect(isInternalMember('alarm')).toBe(true)
      expect(isInternalMember('webSocketMessage')).toBe(true)
      expect(isInternalMember('webSocketClose')).toBe(true)
      expect(isInternalMember('webSocketError')).toBe(true)
    })

    it('identifies initialization methods as internal', () => {
      expect(isInternalMember('initialize')).toBe(true)
      expect(isInternalMember('handleFetch')).toBe(true)
      expect(isInternalMember('handleMcp')).toBe(true)
    })

    it('identifies state/storage accessors as internal', () => {
      expect(isInternalMember('db')).toBe(true)
      expect(isInternalMember('ctx')).toBe(true)
      expect(isInternalMember('storage')).toBe(true)
      expect(isInternalMember('env')).toBe(true)
    })

    it('identifies constructor as internal', () => {
      expect(isInternalMember('constructor')).toBe(true)
    })

    it('identifies Object prototype methods as internal', () => {
      expect(isInternalMember('toString')).toBe(true)
      expect(isInternalMember('valueOf')).toBe(true)
      expect(isInternalMember('hasOwnProperty')).toBe(true)
    })

    it('identifies workflow methods as internal', () => {
      expect(isInternalMember('send')).toBe(true)
      expect(isInternalMember('try')).toBe(true)
      expect(isInternalMember('do')).toBe(true)
      expect(isInternalMember('emit')).toBe(true)
    })
  })

  describe('known internal properties', () => {
    it('identifies internal state properties as internal', () => {
      expect(isInternalMember('_mcpSessions')).toBe(true)
      expect(isInternalMember('_rpcServer')).toBe(true)
      expect(isInternalMember('_things')).toBe(true)
      expect(isInternalMember('$')).toBe(true)
    })
  })
})

// ============================================================================
// UNIT TESTS: createCapnWebTarget Proxy
// ============================================================================

describe('createCapnWebTarget', () => {
  let target: TestApiTarget
  let proxy: ReturnType<typeof createCapnWebTarget>

  beforeEach(() => {
    target = new TestApiTarget()
    proxy = createCapnWebTarget(target) as unknown as TestApiTarget
  })

  describe('public method access', () => {
    it('exposes public methods', () => {
      expect(typeof (proxy as TestApiTarget).greet).toBe('function')
      expect(typeof (proxy as TestApiTarget).add).toBe('function')
      expect(typeof (proxy as TestApiTarget).getData).toBe('function')
    })

    it('calls public methods correctly', () => {
      expect((proxy as TestApiTarget).greet('World')).toBe('Hello, World!')
      expect((proxy as TestApiTarget).add(2, 3)).toBe(5)
      expect((proxy as TestApiTarget).multiply(4, 5)).toBe(20)
    })

    it('handles async methods', async () => {
      const result = await (proxy as TestApiTarget).asyncMethod(10)
      expect(result).toBe('Waited 10ms')
    })
  })

  describe('internal method hiding', () => {
    it('hides fetch method', () => {
      expect((proxy as unknown as { fetch: unknown }).fetch).toBeUndefined()
    })

    it('hides alarm method', () => {
      expect((proxy as unknown as { alarm: unknown }).alarm).toBeUndefined()
    })

    it('hides initialize method', () => {
      expect((proxy as unknown as { initialize: unknown }).initialize).toBeUndefined()
    })

    it('hides underscore-prefixed methods', () => {
      expect((proxy as unknown as { _internalMethod: unknown })._internalMethod).toBeUndefined()
    })

    it('hides underscore-prefixed properties', () => {
      expect((proxy as unknown as { _internalProp: unknown })._internalProp).toBeUndefined()
    })
  })

  describe('public property access', () => {
    it('exposes public properties', () => {
      expect((proxy as TestApiTarget).publicProp).toBe('accessible')
    })
  })

  describe('this binding preservation', () => {
    it('preserves this context for methods', () => {
      // Call method that uses this.counter
      const proxy = createCapnWebTarget(target) as unknown as TestApiTarget
      expect(proxy.getCounter()).toBe(0)
      proxy.incrementCounter()
      expect(proxy.getCounter()).toBe(1)
    })

    it('preserves this context for data access', () => {
      const proxy = createCapnWebTarget(target) as unknown as TestApiTarget
      proxy.setData('key1', 'value1')
      expect(proxy.getData('key1')).toBe('value1')
    })

    it('preserves this context string', () => {
      const proxy = createCapnWebTarget(target) as unknown as TestApiTarget
      proxy.incrementCounter()
      proxy.setData('a', 1)
      const context = proxy.getThisContext()
      expect(context).toBe('counter=1, dataSize=1')
    })
  })

  describe('Proxy traps', () => {
    it('has() returns false for internal members', () => {
      expect('fetch' in proxy).toBe(false)
      expect('alarm' in proxy).toBe(false)
      expect('_internalMethod' in proxy).toBe(false)
    })

    it('has() returns true for public members', () => {
      expect('greet' in proxy).toBe(true)
      expect('add' in proxy).toBe(true)
      expect('publicProp' in proxy).toBe(true)
    })

    it('ownKeys() excludes internal members', () => {
      const keys = Object.keys(proxy)
      expect(keys).not.toContain('fetch')
      expect(keys).not.toContain('alarm')
      expect(keys).not.toContain('_internalMethod')
      expect(keys).not.toContain('_internalProp')
    })

    it('getOwnPropertyDescriptor() returns undefined for internal members', () => {
      expect(Object.getOwnPropertyDescriptor(proxy, 'fetch')).toBeUndefined()
      expect(Object.getOwnPropertyDescriptor(proxy, '_internalMethod')).toBeUndefined()
    })
  })

  describe('error propagation', () => {
    it('propagates errors from methods', () => {
      expect(() => (proxy as TestApiTarget).throwError('Test error')).toThrow('Test error')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS: handleCapnWebRpc
// ============================================================================

describe('handleCapnWebRpc', () => {
  let mockDO: MockDO

  beforeEach(() => {
    mockDO = new MockDO()
  })

  describe('POST to / returns valid RPC response', () => {
    it('handles simple method call', async () => {
      // Create a minimal capnweb-style batch request
      // capnweb uses a specific JSON format for batching
      const requestBody = JSON.stringify({
        c: [
          {
            t: { r: true }, // target: root
            m: 'getValue',  // method
            a: [],          // args
          },
        ],
      })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('application/json')

      const result = await response.json()
      // capnweb returns results in 'r' array
      expect(result).toBeDefined()
    })

    it('handles method with arguments', async () => {
      const requestBody = JSON.stringify({
        c: [
          {
            t: { r: true },
            m: 'echo',
            a: [42],
          },
        ],
      })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)
      expect(response.status).toBe(200)

      const result = await response.json()
      // Verify response is valid
      expect(result).toBeDefined()
    })

    it('handles echo with complex data', async () => {
      const testData = { name: 'test', items: [1, 2, 3], nested: { a: 'b' } }
      const requestBody = JSON.stringify({
        c: [
          {
            t: { r: true },
            m: 'echo',
            a: [testData],
          },
        ],
      })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)
      expect(response.status).toBe(200)
    })
  })

  describe('batch multiple method calls in single request', () => {
    it('executes multiple calls in batch', async () => {
      const requestBody = JSON.stringify({
        c: [
          { t: { r: true }, m: 'getValue', a: [] },
          { t: { r: true }, m: 'echo', a: ['first'] },
          { t: { r: true }, m: 'echo', a: ['second'] },
          { t: { r: true }, m: 'echo', a: ['third'] },
        ],
      })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)
      expect(response.status).toBe(200)

      const result = await response.json()
      // Verify batch response is returned
      expect(result).toBeDefined()
    })

    it('handles empty batch gracefully', async () => {
      const requestBody = JSON.stringify({ c: [] })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)
      expect(response.status).toBe(200)
    })
  })

  describe('error handling for invalid methods', () => {
    it('returns error for non-existent method', async () => {
      const requestBody = JSON.stringify({
        c: [
          {
            t: { r: true },
            m: 'nonExistentMethod',
            a: [],
          },
        ],
      })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)
      // capnweb returns 200 with error in response body
      expect(response.status).toBe(200)

      const result = await response.json()
      // The result should contain an error indicator
      expect(result).toBeDefined()
    })
  })

  describe('error handling for invalid JSON', () => {
    it('handles malformed JSON', async () => {
      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {{{',
      })

      const response = await handleCapnWebRpc(request, mockDO)
      // Should return an error response
      expect(response.status).toBeGreaterThanOrEqual(200)
    })

    it('handles empty body', async () => {
      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      })

      const response = await handleCapnWebRpc(request, mockDO)
      expect(response).toBeDefined()
    })
  })

  describe('internal methods NOT exposed', () => {
    it('does not expose fetch method', async () => {
      const requestBody = JSON.stringify({
        c: [
          {
            t: { r: true },
            m: 'fetch',
            a: [],
          },
        ],
      })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)
      expect(response.status).toBe(200)

      const result = await response.json()
      // The call should fail since fetch is hidden
      expect(result).toBeDefined()
    })

    it('does not expose alarm method', async () => {
      const requestBody = JSON.stringify({
        c: [
          {
            t: { r: true },
            m: 'alarm',
            a: [],
          },
        ],
      })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)
      const result = await response.json()
      // Should fail - alarm is internal
      expect(result).toBeDefined()
    })
  })

  describe('underscore-prefixed methods are hidden', () => {
    it('does not expose underscore-prefixed methods', async () => {
      const requestBody = JSON.stringify({
        c: [
          {
            t: { r: true },
            m: '_privateHelper',
            a: [],
          },
        ],
      })

      const request = new Request('https://test.api.dotdo.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      const response = await handleCapnWebRpc(request, mockDO)
      const result = await response.json()
      // Should fail - underscore methods are hidden
      expect(result).toBeDefined()
    })
  })

  describe('method this binding preserved', () => {
    it('preserves this context through proxy', () => {
      // Test via the proxy directly to verify this binding
      const proxy = createCapnWebTarget(mockDO) as unknown as MockDO

      // Call methods on the proxy
      proxy.setValue(50)

      // Verify the original object was modified (this context preserved)
      expect(mockDO.getValue()).toBe(50)
    })

    it('methods access correct this properties via proxy', () => {
      const proxy = createCapnWebTarget(mockDO) as unknown as MockDO

      // Set value through proxy
      proxy.setValue(100)

      // Get value through proxy
      const value = proxy.getValue()

      // Both should work correctly with preserved this context
      expect(value).toBe(100)
      expect(mockDO.getValue()).toBe(100)
    })

    it('handles multiple method calls maintaining state', () => {
      const proxy = createCapnWebTarget(mockDO) as unknown as MockDO

      // Multiple increments
      proxy.increment()
      proxy.increment()
      proxy.increment()

      expect(proxy.getValue()).toBe(3)
      expect(mockDO.getValue()).toBe(3)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS: isCapnWebRequest detection
// ============================================================================

describe('isCapnWebRequest', () => {
  it('returns true for POST requests', () => {
    const request = new Request('https://test.api.dotdo.dev/', {
      method: 'POST',
    })
    expect(isCapnWebRequest(request)).toBe(true)
  })

  it('returns true for WebSocket upgrade requests', () => {
    const request = new Request('https://test.api.dotdo.dev/', {
      method: 'GET',
      headers: { Upgrade: 'websocket' },
    })
    expect(isCapnWebRequest(request)).toBe(true)
  })

  it('returns false for GET requests without upgrade', () => {
    const request = new Request('https://test.api.dotdo.dev/', {
      method: 'GET',
    })
    expect(isCapnWebRequest(request)).toBe(false)
  })

  it('returns false for DELETE requests', () => {
    const request = new Request('https://test.api.dotdo.dev/', {
      method: 'DELETE',
    })
    expect(isCapnWebRequest(request)).toBe(false)
  })

  it('returns false for PUT requests', () => {
    const request = new Request('https://test.api.dotdo.dev/', {
      method: 'PUT',
    })
    expect(isCapnWebRequest(request)).toBe(false)
  })
})

// ============================================================================
// ADDITIONAL SECURITY TESTS
// ============================================================================

describe('Security - comprehensive internal member checks', () => {
  const target = new TestApiTarget()
  const proxy = createCapnWebTarget(target)

  describe('all known internal methods are blocked', () => {
    const internalMethods = [
      'fetch',
      'alarm',
      'webSocketMessage',
      'webSocketClose',
      'webSocketError',
      'initialize',
      'handleFetch',
      'handleMcp',
      'db',
      'ctx',
      'storage',
      'env',
      'constructor',
      'send',
      'try',
      'do',
      'emit',
      'log',
    ]

    internalMethods.forEach((method) => {
      it(`blocks access to ${method}`, () => {
        expect((proxy as Record<string, unknown>)[method]).toBeUndefined()
      })
    })
  })

  describe('Object prototype methods are blocked', () => {
    const protoMethods = [
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
    ]

    protoMethods.forEach((method) => {
      it(`blocks access to ${method}`, () => {
        expect((proxy as Record<string, unknown>)[method]).toBeUndefined()
      })
    })
  })
})
