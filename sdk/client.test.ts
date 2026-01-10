/**
 * $() Client SDK Tests
 *
 * Tests for the Cap'n Web-style RPC client that connects to any DO via $().
 * The client uses JavaScript Proxy to chain property accesses and method calls,
 * then executes them all in one round trip when awaited.
 *
 * Key features:
 * - Namespace URL connection
 * - Property chaining via Proxy
 * - Method calls with arguments
 * - Single round-trip execution on await
 * - RpcPromise interface for thenable behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import the implementation under test
import { $, ChainStep } from './client'

// =============================================================================
// Mock fetch for testing
// =============================================================================

interface MockFetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function createMockFetch(
  handler: (req: MockFetchRequest) => Promise<{ result?: unknown; error?: { code: string; message: string } }>
) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    const request: MockFetchRequest = {
      url: urlString,
      method: init?.method || 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }
    const response = await handler(request)
    return new Response(JSON.stringify(response), {
      status: response.error ? 400 : 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

// =============================================================================
// Test Suite
// =============================================================================

describe('$() client SDK', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Connection Tests
  // ===========================================================================

  describe('connection', () => {
    it('creates a proxy for namespace URL', () => {
      const client = $('https://startups.studio')

      // Should return a proxy (proxying a function to support apply trap)
      expect(client).toBeDefined()
      // Proxy of a function returns 'function' for typeof, which is expected
      expect(typeof client === 'function' || typeof client === 'object').toBe(true)
    })

    it('accepts string namespace', () => {
      const client = $('https://my-do.example.com/namespace')

      expect(client).toBeDefined()
    })

    it('stores the namespace URL internally', () => {
      const client = $('https://startups.studio')

      // The proxy should be able to build requests to this URL
      expect(client).toBeDefined()
    })
  })

  // ===========================================================================
  // Property Chaining Tests
  // ===========================================================================

  describe('property chaining', () => {
    it('returns proxy for property access', () => {
      const client = $('https://startups.studio')

      const customer = client.Customer

      expect(customer).toBeDefined()
      expect(typeof customer).toBe('function') // Callable proxy
    })

    it('chains multiple property accesses', () => {
      const client = $('https://startups.studio')

      const email = client.Customer.profile.email

      expect(email).toBeDefined()
    })

    it('tracks chain steps internally', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: 'alice@example.com' }
      })

      const client = $('https://startups.studio')

      // Access nested properties
      await client.Customer.profile.email

      // Should have captured the chain
      expect(capturedBody).toHaveLength(1)
      expect(capturedBody[0]).toMatchObject({
        chain: [
          { type: 'property', key: 'Customer' },
          { type: 'property', key: 'profile' },
          { type: 'property', key: 'email' },
        ],
      })
    })
  })

  // ===========================================================================
  // Method Calls Tests
  // ===========================================================================

  describe('method calls', () => {
    it('returns proxy for method call', () => {
      const client = $('https://startups.studio')

      const result = client.Customer('alice')

      expect(result).toBeDefined()
      // Should be thenable
      expect(typeof result.then).toBe('function')
    })

    it('captures method arguments', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: { id: 'alice', name: 'Alice' } }
      })

      const client = $('https://startups.studio')

      await client.Customer('alice')

      expect(capturedBody).toHaveLength(1)
      expect(capturedBody[0]).toMatchObject({
        chain: [
          { type: 'call', key: 'Customer', args: ['alice'] },
        ],
      })
    })

    it('chains property access and method calls', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: { name: 'Alice Updated' } }
      })

      const client = $('https://startups.studio')

      await client.Customer('alice').update({ name: 'Alice Updated' })

      expect(capturedBody).toHaveLength(1)
      expect(capturedBody[0]).toMatchObject({
        chain: [
          { type: 'call', key: 'Customer', args: ['alice'] },
          { type: 'call', key: 'update', args: [{ name: 'Alice Updated' }] },
        ],
      })
    })

    it('supports chaining after method calls', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: 'alice@example.com' }
      })

      const client = $('https://startups.studio')

      await client.Customer('alice').profile.email

      expect(capturedBody).toHaveLength(1)
      expect(capturedBody[0]).toMatchObject({
        chain: [
          { type: 'call', key: 'Customer', args: ['alice'] },
          { type: 'property', key: 'profile' },
          { type: 'property', key: 'email' },
        ],
      })
    })
  })

  // ===========================================================================
  // Execution Tests
  // ===========================================================================

  describe('execution', () => {
    it('executes on await', async () => {
      let fetchCalled = false
      globalThis.fetch = createMockFetch(async () => {
        fetchCalled = true
        return { result: { id: 'alice' } }
      })

      const client = $('https://startups.studio')
      const customer = client.Customer('alice')

      // Not executed yet
      expect(fetchCalled).toBe(false)

      // Execute on await
      await customer

      expect(fetchCalled).toBe(true)
    })

    it('sends chain to /rpc endpoint', async () => {
      let capturedUrl = ''
      globalThis.fetch = createMockFetch(async (req) => {
        capturedUrl = req.url
        return { result: { id: 'alice' } }
      })

      const client = $('https://startups.studio')
      await client.Customer('alice')

      expect(capturedUrl).toBe('https://startups.studio/rpc')
    })

    it('returns parsed JSON response', async () => {
      globalThis.fetch = createMockFetch(async () => {
        return { result: { id: 'alice', name: 'Alice', email: 'alice@example.com' } }
      })

      const client = $('https://startups.studio')
      const result = await client.Customer('alice')

      expect(result).toEqual({ id: 'alice', name: 'Alice', email: 'alice@example.com' })
    })

    it('handles errors from server', async () => {
      globalThis.fetch = createMockFetch(async () => {
        return { error: { code: 'NOT_FOUND', message: 'Customer not found' } }
      })

      const client = $('https://startups.studio')

      await expect(client.Customer('nonexistent')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Customer not found',
      })
    })

    it('handles network errors', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('Network error')
      })

      const client = $('https://startups.studio')

      await expect(client.Customer('alice')).rejects.toThrow('Network error')
    })

    it('sends POST request', async () => {
      let capturedMethod = ''
      globalThis.fetch = createMockFetch(async (req) => {
        capturedMethod = req.method
        return { result: {} }
      })

      const client = $('https://startups.studio')
      await client.Customer('alice')

      expect(capturedMethod).toBe('POST')
    })

    it('sends correct Content-Type header', async () => {
      let capturedHeaders: Record<string, string> = {}
      globalThis.fetch = createMockFetch(async (req) => {
        capturedHeaders = req.headers
        return { result: {} }
      })

      const client = $('https://startups.studio')
      await client.Customer('alice')

      expect(capturedHeaders['content-type']).toBe('application/json')
    })
  })

  // ===========================================================================
  // RpcPromise Tests
  // ===========================================================================

  describe('RpcPromise', () => {
    it('implements Promise interface', async () => {
      globalThis.fetch = createMockFetch(async () => {
        return { result: { id: 'alice' } }
      })

      const client = $('https://startups.studio')
      const rpcPromise = client.Customer('alice')

      // Should have Promise methods
      expect(typeof rpcPromise.then).toBe('function')
      expect(typeof rpcPromise.catch).toBe('function')
      expect(typeof rpcPromise.finally).toBe('function')
    })

    it('supports .then()', async () => {
      globalThis.fetch = createMockFetch(async () => {
        return { result: { id: 'alice', name: 'Alice' } }
      })

      const client = $('https://startups.studio')

      const result = await client.Customer('alice').then((customer: { name: string }) => customer.name)

      expect(result).toBe('Alice')
    })

    it('supports .catch()', async () => {
      globalThis.fetch = createMockFetch(async () => {
        return { error: { code: 'NOT_FOUND', message: 'Not found' } }
      })

      const client = $('https://startups.studio')

      const error = await client.Customer('alice').catch((err: { code: string }) => err)

      expect(error).toMatchObject({ code: 'NOT_FOUND' })
    })

    it('supports .finally()', async () => {
      globalThis.fetch = createMockFetch(async () => {
        return { result: { id: 'alice' } }
      })

      const client = $('https://startups.studio')
      let finallyCalled = false

      await client.Customer('alice').finally(() => {
        finallyCalled = true
      })

      expect(finallyCalled).toBe(true)
    })

    it('supports Promise.all()', async () => {
      let callCount = 0
      globalThis.fetch = createMockFetch(async (req) => {
        callCount++
        const chain = (req.body as { chain: ChainStep[] }).chain
        const customerId = chain[0].args?.[0]
        return { result: { id: customerId, name: `Customer ${customerId}` } }
      })

      const client = $('https://startups.studio')

      const results = await Promise.all([
        client.Customer('alice'),
        client.Customer('bob'),
        client.Customer('charlie'),
      ])

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({ id: 'alice', name: 'Customer alice' })
      expect(results[1]).toEqual({ id: 'bob', name: 'Customer bob' })
      expect(results[2]).toEqual({ id: 'charlie', name: 'Customer charlie' })
      expect(callCount).toBe(3)
    })

    it('supports Promise.race()', async () => {
      globalThis.fetch = createMockFetch(async (req) => {
        const chain = (req.body as { chain: ChainStep[] }).chain
        const customerId = chain[0].args?.[0]
        // First one wins
        if (customerId === 'alice') {
          return { result: { id: 'alice', winner: true } }
        }
        // Others would return later but race will resolve first
        return { result: { id: customerId, winner: false } }
      })

      const client = $('https://startups.studio')

      const result = await Promise.race([
        client.Customer('alice'),
        client.Customer('bob'),
      ]) as { id: string; winner: boolean }

      // One of them should win
      expect(result.id).toBeDefined()
    })
  })

  // ===========================================================================
  // Complex Usage Tests
  // ===========================================================================

  describe('complex usage', () => {
    it('supports collection queries', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: [{ id: '1', $type: 'Customer' }, { id: '2', $type: 'Customer' }] }
      })

      const client = $('https://startups.studio')

      const customers = await client.things.where({ $type: 'Customer' })

      expect(capturedBody[0]).toMatchObject({
        chain: [
          { type: 'property', key: 'things' },
          { type: 'call', key: 'where', args: [{ $type: 'Customer' }] },
        ],
      })
      expect(customers).toHaveLength(2)
    })

    it('supports deep property access after method', async () => {
      globalThis.fetch = createMockFetch(async () => {
        return { result: 'alice@example.com' }
      })

      const client = $('https://startups.studio')
      const email = await client.Customer('alice').profile.email

      expect(email).toBe('alice@example.com')
    })

    it('supports multiple chained method calls', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: { success: true } }
      })

      const client = $('https://startups.studio')

      await client.Customer('alice').orders.create({ product: 'widget', quantity: 5 })

      expect(capturedBody[0]).toMatchObject({
        chain: [
          { type: 'call', key: 'Customer', args: ['alice'] },
          { type: 'property', key: 'orders' },
          { type: 'call', key: 'create', args: [{ product: 'widget', quantity: 5 }] },
        ],
      })
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty namespace URL', () => {
      expect(() => $('')).toThrow()
    })

    it('handles special property names', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: 'value' }
      })

      const client = $('https://startups.studio')

      // Properties that might conflict with Proxy traps
      await client['__proto__']

      // Should still work
      expect(capturedBody).toHaveLength(1)
    })

    it('handles null/undefined arguments', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: {} }
      })

      const client = $('https://startups.studio')

      await client.method(null, undefined)

      // Note: undefined is converted to null when JSON stringified
      expect(capturedBody[0]).toMatchObject({
        chain: [
          { type: 'call', key: 'method', args: [null, null] },
        ],
      })
    })

    it('handles complex object arguments', async () => {
      const capturedBody: unknown[] = []
      globalThis.fetch = createMockFetch(async (req) => {
        capturedBody.push(req.body)
        return { result: {} }
      })

      const client = $('https://startups.studio')
      const complexArg = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        date: '2024-01-01',
      }

      await client.process(complexArg)

      expect(capturedBody[0]).toMatchObject({
        chain: [
          { type: 'call', key: 'process', args: [complexArg] },
        ],
      })
    })

    it('each await creates new request', async () => {
      let callCount = 0
      globalThis.fetch = createMockFetch(async () => {
        callCount++
        return { result: { count: callCount } }
      })

      const client = $('https://startups.studio')
      const customerProxy = client.Customer('alice')

      const result1 = await customerProxy
      const result2 = await customerProxy

      // Each await should trigger a new fetch
      expect(callCount).toBe(2)
    })

    it('handles Symbol properties gracefully', () => {
      const client = $('https://startups.studio')

      // Symbol.toStringTag and other symbols should not break
      expect(() => String(client)).not.toThrow()
    })
  })
})
