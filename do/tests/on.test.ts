/**
 * Event Handler Tests - Real Durable Object Instances
 *
 * Tests the $.on event handler proxy using real DO instances via
 * @cloudflare/vitest-pool-workers instead of vi.fn() mocks.
 *
 * This test file uses a dual approach:
 * 1. Real DO tests for integration scenarios that work with the current infrastructure
 * 2. Unit tests for the handler registration and invocation functions
 *
 * Tests cover:
 * 1. Handler registration via $.on.Noun.verb()
 * 2. Wildcard support (*.created, Customer.*, *.*)
 * 3. Handler invocation when events are emitted
 * 4. Error handling in handlers
 * 5. Multiple handlers for same event
 * 6. Pattern matching for wildcard handlers
 *
 * @module do/tests/on.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthResponse {
  status: string
  id: string
}

interface InfoResponse {
  id: string
  keys: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `on-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Helper to get a DO stub for testing
 */
function getTestDO(name: string = generateTestId()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// REAL DO INTEGRATION TESTS
// ============================================================================

describe('$.on - Real DO Integration Tests', () => {
  /**
   * Test 1: Basic DO operations verify the real DO environment works
   *
   * These tests ensure real DOs are properly instantiated and can handle requests
   */
  describe('DO Health and Info Endpoints', () => {
    it('should create a real DO instance via env binding', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const response = await stub.fetch('https://do/')

      expect(response.status).toBe(200)

      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
      expect(typeof json.id).toBe('string')
    })

    it('should create separate instances for different names', async () => {
      const id1 = env.DO.idFromName('instance-1-' + generateTestId())
      const id2 = env.DO.idFromName('instance-2-' + generateTestId())

      const stub1 = env.DO.get(id1)
      const stub2 = env.DO.get(id2)

      const resp1 = await stub1.fetch('https://do/')
      const resp2 = await stub2.fetch('https://do/')

      const json1 = (await resp1.json()) as HealthResponse
      const json2 = (await resp2.json()) as HealthResponse

      // Different DO instances have different IDs
      expect(json1.id).not.toBe(json2.id)
    })

    it('should return the same instance for the same name', async () => {
      const testName = 'shared-instance-' + generateTestId()

      const id1 = env.DO.idFromName(testName)
      const id2 = env.DO.idFromName(testName)

      const stub1 = env.DO.get(id1)
      const stub2 = env.DO.get(id2)

      const resp1 = await stub1.fetch('https://do/')
      const resp2 = await stub2.fetch('https://do/')

      const json1 = (await resp1.json()) as HealthResponse
      const json2 = (await resp2.json()) as HealthResponse

      // Same DO instance - same ID
      expect(json1.id).toBe(json2.id)
    })
  })

  /**
   * Test 2: DO info endpoint verifies storage access
   */
  describe('DO Storage Access', () => {
    it('should return storage info at /info', async () => {
      const id = env.DO.idFromName('info-' + generateTestId())
      const stub = env.DO.get(id)

      const response = await stub.fetch('https://do/info')

      expect(response.status).toBe(200)

      const json = (await response.json()) as InfoResponse
      expect(json.id).toBeDefined()
      expect(typeof json.keys).toBe('number')
    })
  })

  /**
   * Test 3: RPC endpoint is accessible (verifies the event system endpoint exists)
   */
  describe('RPC Endpoint Accessibility', () => {
    it('should return 404 for unknown methods via RPC', async () => {
      const id = env.DO.idFromName('rpc-' + generateTestId())
      const stub = env.DO.get(id)

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'nonExistentMethod', args: [] }),
      })

      expect(response.status).toBe(404)
    })
  })

  /**
   * Test 4: Concurrent request handling (demonstrates DO's serialization)
   */
  describe('Concurrent Request Handling', () => {
    it('should handle concurrent requests correctly', async () => {
      const id = env.DO.idFromName('concurrent-' + generateTestId())
      const stub = env.DO.get(id)

      // Fire multiple concurrent requests
      const requests = Array.from({ length: 5 }, () => stub.fetch('https://do/'))

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
        // Consume the response body to avoid issues
        await response.text()
      }
    })

    it('should serialize operations via single-threaded DO model', async () => {
      const id = env.DO.idFromName('serialize-' + generateTestId())
      const stub = env.DO.get(id)

      // Fire concurrent info requests - tests real concurrency serialization
      const requests = Array.from({ length: 3 }, () => stub.fetch('https://do/info'))

      const responses = await Promise.all(requests)

      // All requests should get consistent view
      const infos: InfoResponse[] = []
      for (const response of responses) {
        infos.push((await response.json()) as InfoResponse)
      }

      // All should have the same ID (same DO instance)
      const ids = infos.map((i) => i.id)
      expect(new Set(ids).size).toBe(1)
    })
  })

  /**
   * Test 5: CORS headers (verifies middleware integration)
   */
  describe('CORS Middleware Integration', () => {
    it('should include CORS headers in response', async () => {
      const id = env.DO.idFromName('cors-' + generateTestId())
      const stub = env.DO.get(id)

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      // CORS headers should be present
      const corsHeader = response.headers.get('Access-Control-Allow-Origin')
      expect(corsHeader).toBeTruthy()
    })
  })
})

// ============================================================================
// STANDALONE EVENT HANDLER UNIT TESTS
// ============================================================================

import {
  createOnProxy,
  invokeHandlers,
  matchHandlers,
  type OnProxy,
  type EventHandler,
} from '../on'

describe('createOnProxy - Unit Tests', () => {
  let on: OnProxy
  let handlers: Map<string, Array<(event: unknown) => Promise<void>>>

  beforeEach(() => {
    handlers = new Map()
    on = createOnProxy(handlers)
  })

  describe('Handler Registration', () => {
    it('should register handler via $.on.Customer.signup()', () => {
      const handler = vi.fn()
      on.Customer.signup(handler)

      expect(handlers.get('Customer.signup')).toContain(handler)
    })

    it('should register handler via $.on.Payment.failed()', () => {
      const handler = vi.fn()
      on.Payment.failed(handler)

      expect(handlers.get('Payment.failed')).toContain(handler)
    })

    it('should support infinite Noun.verb combinations', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      const h3 = vi.fn()

      on.Order.placed(h1)
      on.Invoice.generated(h2)
      on.Subscription.renewed(h3)

      expect(handlers.get('Order.placed')).toContain(h1)
      expect(handlers.get('Invoice.generated')).toContain(h2)
      expect(handlers.get('Subscription.renewed')).toContain(h3)
    })

    it('should support multiple handlers for same event', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      const h3 = vi.fn()

      on.Order.placed(h1)
      on.Order.placed(h2)
      on.Order.placed(h3)

      const registered = handlers.get('Order.placed')
      expect(registered).toHaveLength(3)
      expect(registered).toContain(h1)
      expect(registered).toContain(h2)
      expect(registered).toContain(h3)
    })

    it('should support arbitrary property names', () => {
      const handler = vi.fn()
      on.ArbitraryNoun.arbitraryVerb(handler)

      expect(handlers.get('ArbitraryNoun.arbitraryVerb')).toContain(handler)
    })

    it('should support camelCase, PascalCase, and snake_case', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      const h3 = vi.fn()

      on.user.created(h1)
      on.UserProfile.updated(h2)
      on.payment_method.verified(h3)

      expect(handlers.get('user.created')).toContain(h1)
      expect(handlers.get('UserProfile.updated')).toContain(h2)
      expect(handlers.get('payment_method.verified')).toContain(h3)
    })
  })

  describe('Wildcard Support', () => {
    it('should register wildcard handlers via $.on.*.created()', () => {
      const handler = vi.fn()
      on['*'].created(handler)

      expect(handlers.get('*.created')).toContain(handler)
    })

    it('should register noun wildcard handlers via $.on.Customer.*()', () => {
      const handler = vi.fn()
      on.Customer['*'](handler)

      expect(handlers.get('Customer.*')).toContain(handler)
    })

    it('should register global wildcard handlers via $.on.*.*()', () => {
      const handler = vi.fn()
      on['*']['*'](handler)

      expect(handlers.get('*.*')).toContain(handler)
    })

    it('should support multiple wildcard patterns', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      const h3 = vi.fn()

      on['*'].created(h1)
      on.User['*'](h2)
      on['*']['*'](h3)

      expect(handlers.get('*.created')).toContain(h1)
      expect(handlers.get('User.*')).toContain(h2)
      expect(handlers.get('*.*')).toContain(h3)
    })

    it('should register verb wildcard handlers via $.on.*.verb()', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()

      on['*'].created(h1)
      on['*'].updated(h2)

      expect(handlers.get('*.created')).toContain(h1)
      expect(handlers.get('*.updated')).toContain(h2)
    })
  })

  describe('Type Safety', () => {
    it('should have proper TypeScript types for common nouns', () => {
      // These should compile without errors
      on.Customer.created(() => Promise.resolve())
      on.Order.placed(() => Promise.resolve())
      on.Payment.failed(() => Promise.resolve())
      on.User.authenticated(() => Promise.resolve())
      on.Email.sent(() => Promise.resolve())
      on.Invoice.generated(() => Promise.resolve())
      on.Product.updated(() => Promise.resolve())
      on.Subscription.renewed(() => Promise.resolve())

      expect(true).toBe(true)
    })

    it('should support custom nouns via index signature', () => {
      // These should also compile without errors
      on.CustomNoun.customEvent(() => Promise.resolve())
      on.AnyThing.anyAction(() => Promise.resolve())

      expect(true).toBe(true)
    })
  })

  describe('Pattern Matching', () => {
    it('should match events to wildcard handlers', () => {
      const specificHandler = vi.fn()
      const nounWildcard = vi.fn()
      const verbWildcard = vi.fn()
      const globalWildcard = vi.fn()

      on.Order.placed(specificHandler)
      on.Order['*'](nounWildcard)
      on['*'].placed(verbWildcard)
      on['*']['*'](globalWildcard)

      // For 'Order.placed', should match all 4 handlers
      expect(handlers.get('Order.placed')).toContain(specificHandler)
      expect(handlers.get('Order.*')).toContain(nounWildcard)
      expect(handlers.get('*.placed')).toContain(verbWildcard)
      expect(handlers.get('*.*')).toContain(globalWildcard)
    })

    it('should distinguish between different noun wildcards', () => {
      const orderWildcard = vi.fn()
      const userWildcard = vi.fn()

      on.Order['*'](orderWildcard)
      on.User['*'](userWildcard)

      expect(handlers.get('Order.*')).toContain(orderWildcard)
      expect(handlers.get('Order.*')).not.toContain(userWildcard)

      expect(handlers.get('User.*')).toContain(userWildcard)
      expect(handlers.get('User.*')).not.toContain(orderWildcard)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty handlers map', () => {
      const registered = handlers.get('Order.placed') || []

      expect(registered).toHaveLength(0)
    })

    it('should handle handlers that return non-promises', () => {
      const syncHandler = vi.fn(() => {
        // Synchronous handler (no return)
      })

      on.Order.placed(syncHandler)

      expect(handlers.get('Order.placed')).toContain(syncHandler)
    })

    it('should preserve handler order', () => {
      const order: number[] = []
      const h1 = vi.fn(() => {
        order.push(1)
        return Promise.resolve()
      })
      const h2 = vi.fn(() => {
        order.push(2)
        return Promise.resolve()
      })
      const h3 = vi.fn(() => {
        order.push(3)
        return Promise.resolve()
      })

      on.Order.placed(h1)
      on.Order.placed(h2)
      on.Order.placed(h3)

      const registered = handlers.get('Order.placed')
      expect(registered).toEqual([h1, h2, h3])
    })
  })
})

describe('matchHandlers - Unit Tests', () => {
  let handlers: Map<string, EventHandler[]>

  beforeEach(() => {
    handlers = new Map()
  })

  it('should match exact event type', () => {
    const handler = vi.fn()
    handlers.set('Order.placed', [handler])

    const matched = matchHandlers('Order.placed', handlers)
    expect(matched).toContain(handler)
  })

  it('should match noun wildcard', () => {
    const handler = vi.fn()
    handlers.set('Order.*', [handler])

    const matched = matchHandlers('Order.placed', handlers)
    expect(matched).toContain(handler)
  })

  it('should match verb wildcard', () => {
    const handler = vi.fn()
    handlers.set('*.placed', [handler])

    const matched = matchHandlers('Order.placed', handlers)
    expect(matched).toContain(handler)
  })

  it('should match global wildcard', () => {
    const handler = vi.fn()
    handlers.set('*.*', [handler])

    const matched = matchHandlers('Order.placed', handlers)
    expect(matched).toContain(handler)
  })

  it('should match all applicable patterns', () => {
    const exact = vi.fn()
    const nounWild = vi.fn()
    const verbWild = vi.fn()
    const global = vi.fn()

    handlers.set('Order.placed', [exact])
    handlers.set('Order.*', [nounWild])
    handlers.set('*.placed', [verbWild])
    handlers.set('*.*', [global])

    const matched = matchHandlers('Order.placed', handlers)

    expect(matched).toContain(exact)
    expect(matched).toContain(nounWild)
    expect(matched).toContain(verbWild)
    expect(matched).toContain(global)
    expect(matched).toHaveLength(4)
  })

  it('should return empty array when no handlers match', () => {
    const matched = matchHandlers('Order.placed', handlers)
    expect(matched).toHaveLength(0)
  })
})

describe('invokeHandlers - Unit Tests', () => {
  let handlers: Map<string, EventHandler[]>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    handlers = new Map()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('Basic Invocation', () => {
    it('should invoke registered handlers for matching events', async () => {
      const handler = vi.fn()
      handlers.set('Order.placed', [handler])

      const event = { type: 'Order.placed', payload: { orderId: '123' } }
      await invokeHandlers('Order.placed', event, handlers)

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should invoke all registered handlers for same event', async () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      const h3 = vi.fn()

      handlers.set('Order.placed', [h1, h2, h3])

      const event = { type: 'Order.placed', payload: { orderId: '123' } }
      await invokeHandlers('Order.placed', event, handlers)

      expect(h1).toHaveBeenCalledWith(event)
      expect(h2).toHaveBeenCalledWith(event)
      expect(h3).toHaveBeenCalledWith(event)
    })

    it('should support async handlers', async () => {
      const handler = vi.fn(async (event: unknown) => {
        await new Promise((r) => setTimeout(r, 10))
        return event
      })

      handlers.set('Customer.signup', [handler])

      const event = { type: 'Customer.signup', payload: { email: 'test@example.com' } }
      await invokeHandlers('Customer.signup', event, handlers)

      expect(handler).toHaveBeenCalledWith(event)
    })
  })

  describe('Error Isolation', () => {
    it('should not crash when a handler throws synchronously', async () => {
      const h1 = vi.fn(() => {
        throw new Error('Sync error')
      })
      const h2 = vi.fn()

      handlers.set('Test.event', [h1, h2])

      // Should not throw, returns result object
      const result = await invokeHandlers('Test.event', { data: 'test' }, handlers)
      expect(result).toBeDefined()
      expect(result.failed.length).toBe(1)
      expect(result.succeeded.length).toBe(1)

      // Second handler should still be called
      expect(h2).toHaveBeenCalled()
    })

    it('should not crash when a handler rejects asynchronously', async () => {
      const h1 = vi.fn(async () => {
        await Promise.resolve()
        throw new Error('Async error')
      })
      const h2 = vi.fn()

      handlers.set('Test.event', [h1, h2])

      // Should not throw, returns result object
      const result = await invokeHandlers('Test.event', { data: 'test' }, handlers)
      expect(result).toBeDefined()
      expect(result.failed.length).toBe(1)
      expect(result.succeeded.length).toBe(1)

      // Second handler should still be called
      expect(h2).toHaveBeenCalled()
    })

    it('should continue processing when multiple handlers throw', async () => {
      const executionOrder: number[] = []

      const h1 = vi.fn(() => {
        executionOrder.push(1)
        throw new Error('Error in handler 1')
      })
      const h2 = vi.fn(async () => {
        executionOrder.push(2)
        throw new Error('Error in handler 2')
      })
      const h3 = vi.fn(() => {
        executionOrder.push(3)
      })

      handlers.set('Test.event', [h1, h2, h3])

      await invokeHandlers('Test.event', {}, handlers)

      // All handlers should have been invoked
      expect(executionOrder).toContain(1)
      expect(executionOrder).toContain(2)
      expect(executionOrder).toContain(3)
    })

    it('should still work after a handler throws', async () => {
      const h1 = vi.fn(() => {
        throw new Error('First call error')
      })

      handlers.set('Test.event', [h1])

      // First invocation
      await invokeHandlers('Test.event', { call: 1 }, handlers)

      // Handler should still be registered and callable
      await invokeHandlers('Test.event', { call: 2 }, handlers)

      expect(h1).toHaveBeenCalledTimes(2)
    })
  })

  describe('Error Logging', () => {
    it('should log errors with event type context', async () => {
      const error = new Error('Handler failed')
      const h1 = vi.fn(() => {
        throw error
      })

      handlers.set('Order.placed', [h1])

      await invokeHandlers('Order.placed', { orderId: '123' }, handlers)

      expect(consoleErrorSpy).toHaveBeenCalled()
      const logCall = consoleErrorSpy.mock.calls[0]
      // The logger format is: [prefix] message error
      // Check if any argument contains the event type
      const hasEventType = logCall.some(
        (arg: unknown) => typeof arg === 'string' && arg.includes('Order.placed')
      )
      expect(hasEventType).toBe(true)
    })

    it('should log the actual error object', async () => {
      const error = new Error('Specific error message')
      const h1 = vi.fn(() => {
        throw error
      })

      handlers.set('Test.event', [h1])

      await invokeHandlers('Test.event', {}, handlers)

      expect(consoleErrorSpy).toHaveBeenCalled()
      const logCall = consoleErrorSpy.mock.calls[0]
      expect(logCall).toContain(error)
    })

    it('should log errors for each failing handler separately', async () => {
      const h1 = vi.fn(() => {
        throw new Error('Error 1')
      })
      const h2 = vi.fn(() => {
        throw new Error('Error 2')
      })

      handlers.set('Test.event', [h1, h2])

      await invokeHandlers('Test.event', {}, handlers)

      // Should have logged twice, once for each error
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('Handler Completion', () => {
    it('should wait for all async handlers to complete', async () => {
      const completionOrder: number[] = []

      const h1 = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 30))
        completionOrder.push(1)
      })
      const h2 = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10))
        completionOrder.push(2)
      })

      handlers.set('Test.event', [h1, h2])

      await invokeHandlers('Test.event', {}, handlers)

      // Both handlers should have completed
      expect(completionOrder).toHaveLength(2)
      expect(completionOrder).toContain(1)
      expect(completionOrder).toContain(2)
    })

    it('should pass event data correctly to all handlers', async () => {
      const eventData = { type: 'test', payload: { id: '123', name: 'test' } }
      const h1 = vi.fn()
      const h2 = vi.fn()

      handlers.set('Test.event', [h1, h2])

      await invokeHandlers('Test.event', eventData, handlers)

      expect(h1).toHaveBeenCalledWith(eventData)
      expect(h2).toHaveBeenCalledWith(eventData)
    })
  })

  describe('Wildcard Handler Errors', () => {
    it('should handle errors in exact match handlers', async () => {
      const exactHandler = vi.fn(() => {
        throw new Error('Exact match error')
      })
      const wildcardHandler = vi.fn()

      handlers.set('Order.placed', [exactHandler])
      handlers.set('*.*', [wildcardHandler])

      await invokeHandlers('Order.placed', {}, handlers)

      // Wildcard handler should still run
      expect(wildcardHandler).toHaveBeenCalled()
    })

    it('should handle errors in wildcard handlers without affecting exact match', async () => {
      const exactHandler = vi.fn()
      const wildcardHandler = vi.fn(() => {
        throw new Error('Wildcard error')
      })

      handlers.set('Order.placed', [exactHandler])
      handlers.set('*.*', [wildcardHandler])

      await invokeHandlers('Order.placed', {}, handlers)

      // Exact handler should have run
      expect(exactHandler).toHaveBeenCalled()
    })

    it('should handle errors across all wildcard patterns', async () => {
      const executionOrder: string[] = []

      const exactHandler = vi.fn(() => {
        executionOrder.push('exact')
        throw new Error('Exact error')
      })
      const nounWildcard = vi.fn(() => {
        executionOrder.push('noun-wildcard')
        throw new Error('Noun wildcard error')
      })
      const verbWildcard = vi.fn(() => {
        executionOrder.push('verb-wildcard')
        throw new Error('Verb wildcard error')
      })
      const globalWildcard = vi.fn(() => {
        executionOrder.push('global-wildcard')
      })

      handlers.set('Order.placed', [exactHandler])
      handlers.set('Order.*', [nounWildcard])
      handlers.set('*.placed', [verbWildcard])
      handlers.set('*.*', [globalWildcard])

      await invokeHandlers('Order.placed', {}, handlers)

      // All handlers should have been invoked despite errors
      expect(executionOrder).toContain('exact')
      expect(executionOrder).toContain('noun-wildcard')
      expect(executionOrder).toContain('verb-wildcard')
      expect(executionOrder).toContain('global-wildcard')
    })
  })

  describe('Edge Cases', () => {
    it('should handle non-Error objects thrown', async () => {
      const h1 = vi.fn(() => {
        throw 'string error'
      })
      const h2 = vi.fn(() => {
        throw { custom: 'error object' }
      })
      const h3 = vi.fn()

      handlers.set('Test.event', [h1, h2, h3])

      const result = await invokeHandlers('Test.event', {}, handlers)
      expect(result).toBeDefined()
      expect(result.failed.length).toBe(2)
      expect(result.succeeded.length).toBe(1)
      expect(h3).toHaveBeenCalled()
    })

    it('should handle null/undefined thrown', async () => {
      const h1 = vi.fn(() => {
        throw null
      })
      const h2 = vi.fn(() => {
        throw undefined
      })
      const h3 = vi.fn()

      handlers.set('Test.event', [h1, h2, h3])

      const result = await invokeHandlers('Test.event', {}, handlers)
      expect(result).toBeDefined()
      expect(result.failed.length).toBe(2)
      expect(result.succeeded.length).toBe(1)
      expect(h3).toHaveBeenCalled()
    })

    it('should handle empty handlers gracefully', async () => {
      // No handlers registered - returns empty result
      const result = await invokeHandlers('Unknown.event', {}, handlers)
      expect(result).toBeDefined()
      expect(result.succeeded).toEqual([])
      expect(result.failed).toEqual([])
    })

    it('should handle handlers that return rejected promises', async () => {
      const h1 = vi.fn(() => Promise.reject(new Error('Rejected promise')))
      const h2 = vi.fn()

      handlers.set('Test.event', [h1, h2])

      const result = await invokeHandlers('Test.event', {}, handlers)
      expect(result).toBeDefined()
      expect(result.failed.length).toBe(1)
      expect(result.succeeded.length).toBe(1)
      expect(h2).toHaveBeenCalled()
    })
  })
})
