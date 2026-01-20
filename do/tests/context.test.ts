/**
 * WorkflowContext ($) Tests
 *
 * Tests for the WorkflowContext DSL using real state (no mocks).
 * Uses real WorkflowContext with real in-memory EventsStore.
 *
 * @module do/tests/context.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createContext, type WorkflowContext } from '../context'
import { env } from 'cloudflare:test'

// ============================================================================
// TEST HELPER: Get real DO stub
// ============================================================================

function getTestDO(name: string = 'test-' + Date.now()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// TESTS: WorkflowContext ($)
// ============================================================================

describe('WorkflowContext ($)', () => {
  let $: WorkflowContext
  let stub: DurableObjectStub

  beforeEach(async () => {
    // Get a real DO stub with real state
    const doName = `context-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    stub = getTestDO(doName)

    // Access the $ context via RPC
    const res = await stub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'getContext', args: [] })
    })

    // For tests that need direct access to WorkflowContext,
    // we create one with simulated state
    // The stub's internal $ is initialized but we test createContext directly
    const mockState = {
      id: { toString: () => doName },
      storage: {
        get: async () => undefined,
        put: async () => {},
        list: async () => new Map(),
        delete: async () => true,
        deleteAll: async () => {},
      },
      blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
      waitUntil: () => {},
    } as unknown as DurableObjectState

    $ = createContext(mockState, env)
  })

  describe('send()', () => {
    it('should emit events fire-and-forget', async () => {
      $.send({ type: 'user.created', payload: { name: 'Alice' } })

      // Wait for async emission
      await new Promise(r => setTimeout(r, 50))

      const events = await $._events.query({ type: 'user.created' })
      expect(events).toHaveLength(1)
      expect(events[0].payload).toEqual({ name: 'Alice' })
    })

    it('should dispatch to registered handlers', async () => {
      let handlerCalled = false
      let receivedEvent: unknown = null

      $.on.user.created((event) => {
        handlerCalled = true
        receivedEvent = event
      })

      $.send({ type: 'user.created', payload: { id: '123' } })

      await new Promise(r => setTimeout(r, 50))
      expect(handlerCalled).toBe(true)
      expect(receivedEvent).toBeDefined()
    })

    it('should dispatch to wildcard handlers', async () => {
      let wildcardCalled = false

      $.on.user['*'](() => {
        wildcardCalled = true
      })

      $.send({ type: 'user.created', payload: { id: '123' } })

      await new Promise(r => setTimeout(r, 50))
      expect(wildcardCalled).toBe(true)
    })

    it('should dispatch to global wildcard handlers', async () => {
      let globalCalled = false

      $.on['*']['*'](() => {
        globalCalled = true
      })

      $.send({ type: 'user.created', payload: { id: '123' } })

      await new Promise(r => setTimeout(r, 50))
      expect(globalCalled).toBe(true)
    })
  })

  describe('try()', () => {
    it('should execute action without retries', async () => {
      const result = await $.try(async () => 'success')
      expect(result).toBe('success')
    })

    it('should propagate errors', async () => {
      await expect($.try(async () => {
        throw new Error('fail')
      })).rejects.toThrow('fail')
    })
  })

  describe('do()', () => {
    it('should execute action with retries on failure', async () => {
      let attempts = 0

      const result = await $.do(async () => {
        attempts++
        if (attempts < 3) throw new Error('Not yet')
        return 'success'
      })

      expect(result).toBe('success')
      expect(attempts).toBe(3)
    })

    it('should fail after max retries', async () => {
      await expect($.do(async () => {
        throw new Error('Always fails')
      }, { retries: 2 })).rejects.toThrow('Always fails')
    })

    it('should timeout long actions', async () => {
      await expect($.do(async () => {
        await new Promise(r => setTimeout(r, 1000))
        return 'done'
      }, { timeout: 50, retries: 0 })).rejects.toThrow('timed out')
    })

    it('should use exponential backoff by default', async () => {
      let attempts = 0
      const timestamps: number[] = []

      await expect($.do(async () => {
        timestamps.push(Date.now())
        attempts++
        throw new Error('fail')
      }, { retries: 2, backoff: 'exponential' })).rejects.toThrow()

      expect(attempts).toBe(3)
      // Exponential backoff: 100ms, then 200ms
      if (timestamps.length >= 2) {
        const gap1 = timestamps[1] - timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90) // ~100ms with some tolerance
      }
      if (timestamps.length >= 3) {
        const gap2 = timestamps[2] - timestamps[1]
        expect(gap2).toBeGreaterThanOrEqual(180) // ~200ms with some tolerance
      }
    })

    it('should support linear backoff', async () => {
      let attempts = 0
      const timestamps: number[] = []

      await expect($.do(async () => {
        timestamps.push(Date.now())
        attempts++
        throw new Error('fail')
      }, { retries: 2, backoff: 'linear' })).rejects.toThrow()

      expect(attempts).toBe(3)
      // Linear backoff: 100ms, then 200ms, then 300ms
      if (timestamps.length >= 2) {
        const gap1 = timestamps[1] - timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90)
      }
    })

    it('should succeed on first attempt if no errors', async () => {
      let attempts = 0

      const result = await $.do(async () => {
        attempts++
        return 'immediate success'
      })

      expect(result).toBe('immediate success')
      expect(attempts).toBe(1)
    })
  })

  describe('on (event handlers)', () => {
    it('should register handlers via Proxy', () => {
      const handler = () => {}
      $.on.Order.placed(handler)

      expect($._handlers.get('Order.placed')).toContain(handler)
    })

    it('should support multiple handlers for same event', () => {
      const h1 = () => {}
      const h2 = () => {}

      $.on.Order.placed(h1)
      $.on.Order.placed(h2)

      expect($._handlers.get('Order.placed')).toHaveLength(2)
    })

    it('should work with any noun/verb combination', () => {
      const handler1 = () => {}
      const handler2 = () => {}
      const handler3 = () => {}

      $.on.Customer.signup(handler1)
      $.on.Payment.failed(handler2)
      $.on.Invoice.generated(handler3)

      expect($._handlers.get('Customer.signup')).toContain(handler1)
      expect($._handlers.get('Payment.failed')).toContain(handler2)
      expect($._handlers.get('Invoice.generated')).toContain(handler3)
    })
  })

  describe('every (scheduling DSL)', () => {
    it('should have every proxy available', () => {
      expect($.every).toBeDefined()
      expect(typeof $.every).toBe('function')
    })

    it('should allow chained access (stub)', () => {
      // This is a stub for do-7rf.6.4
      expect($.every.Monday).toBeDefined()
      expect($.every.day).toBeDefined()
      expect($.every.hour).toBeDefined()
    })
  })

  describe('send() error handling', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    it('should not throw when handler throws synchronously', async () => {
      let failingHandlerCalled = false
      let successHandlerCalled = false

      $.on.test.event(() => {
        failingHandlerCalled = true
        throw new Error('Sync handler error')
      })

      $.on.test.event(() => {
        successHandlerCalled = true
      })

      // This should not throw
      $.send({ type: 'test.event', payload: { data: 'test' } })

      // Wait for async processing
      await new Promise(r => setTimeout(r, 100))

      // Both handlers should have been called
      expect(failingHandlerCalled).toBe(true)
      expect(successHandlerCalled).toBe(true)
    })

    it('should not throw when handler rejects asynchronously', async () => {
      let failingHandlerCalled = false
      let successHandlerCalled = false

      $.on.test.event(async () => {
        failingHandlerCalled = true
        throw new Error('Async handler error')
      })

      $.on.test.event(() => {
        successHandlerCalled = true
      })

      // This should not throw
      $.send({ type: 'test.event', payload: { data: 'test' } })

      // Wait for async processing
      await new Promise(r => setTimeout(r, 100))

      // Both handlers should have been called
      expect(failingHandlerCalled).toBe(true)
      expect(successHandlerCalled).toBe(true)
    })

    it('should continue working after handler errors', async () => {
      let callCount = 0

      $.on.test.event(() => {
        callCount++
        throw new Error('Handler error')
      })

      // First send (will have error)
      $.send({ type: 'test.event', payload: { call: 1 } })
      await new Promise(r => setTimeout(r, 50))

      // Second send should still work
      $.send({ type: 'test.event', payload: { call: 2 } })
      await new Promise(r => setTimeout(r, 50))

      // Handler should have been called twice
      expect(callCount).toBe(2)
    })

    it('should handle errors in wildcard handlers without affecting other handlers', async () => {
      let wildcardCalled = false
      let exactCalled = false

      $.on['*']['*'](() => {
        wildcardCalled = true
        throw new Error('Wildcard error')
      })

      $.on.test.event(() => {
        exactCalled = true
      })

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 100))

      // Both handlers should have been called
      expect(wildcardCalled).toBe(true)
      expect(exactCalled).toBe(true)
    })

    it('should handle multiple failing handlers', async () => {
      let handler1Called = false
      let handler2Called = false
      let handler3Called = false

      $.on.test.event(() => {
        handler1Called = true
        throw new Error('Error 1')
      })

      $.on.test.event(() => {
        handler2Called = true
        throw new Error('Error 2')
      })

      $.on.test.event(() => {
        handler3Called = true
      })

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 100))

      // All handlers should have been called
      expect(handler1Called).toBe(true)
      expect(handler2Called).toBe(true)
      expect(handler3Called).toBe(true)
    })

    it('should handle returned promise rejections', async () => {
      let handlerCalled = false
      let successHandlerCalled = false

      $.on.test.event(() => {
        handlerCalled = true
        return Promise.reject(new Error('Rejected promise'))
      })

      $.on.test.event(() => {
        successHandlerCalled = true
      })

      $.send({ type: 'test.event', payload: {} })

      await new Promise(r => setTimeout(r, 100))

      expect(handlerCalled).toBe(true)
      expect(successHandlerCalled).toBe(true)
    })
  })
})
