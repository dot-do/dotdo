/**
 * Event System Tests - TDD RED Phase
 *
 * Comprehensive tests for core/event-system.ts covering:
 * 1. Event emission/subscription via OnProxy
 * 2. Wildcard matching (*.created, Customer.*, *.*)
 * 3. Handler error isolation (one handler failing shouldn't crash others)
 * 4. Unsubscribe behavior
 * 5. OnProxy pattern registration ($.on.Noun.verb())
 *
 * These tests define expected behavior - some may fail initially (TDD RED phase).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  EventSystem,
  createOnProxy,
  generateEventId,
  generateThingId,
  type Event,
  type EventHandler,
  type OnProxy,
} from '../event-system'

// =============================================================================
// ID Generation Utilities Tests
// =============================================================================

describe('ID Generation Utilities', () => {
  describe('generateEventId()', () => {
    it('should generate unique event IDs', () => {
      const id1 = generateEventId()
      const id2 = generateEventId()

      expect(id1).toBeDefined()
      expect(id2).toBeDefined()
      expect(id1).not.toBe(id2)
    })

    it('should generate IDs with evt_ prefix', () => {
      const id = generateEventId()
      expect(id).toMatch(/^evt_/)
    })

    it('should generate IDs with timestamp component', () => {
      const id = generateEventId()
      const parts = id.split('_')
      expect(parts.length).toBe(3)
      expect(Number(parts[1])).toBeGreaterThan(0)
    })

    it('should generate IDs with random suffix', () => {
      const id = generateEventId()
      const parts = id.split('_')
      expect(parts[2]).toHaveLength(9)
    })
  })

  describe('generateThingId()', () => {
    it('should generate unique thing IDs', () => {
      const id1 = generateThingId()
      const id2 = generateThingId()

      expect(id1).toBeDefined()
      expect(id2).toBeDefined()
      expect(id1).not.toBe(id2)
    })

    it('should generate IDs with thing_ prefix', () => {
      const id = generateThingId()
      expect(id).toMatch(/^thing_/)
    })
  })
})

// =============================================================================
// OnProxy Factory Tests
// =============================================================================

describe('createOnProxy()', () => {
  let eventHandlers: Map<string, EventHandler[]>
  let onProxy: OnProxy

  beforeEach(() => {
    eventHandlers = new Map()
    onProxy = createOnProxy(eventHandlers)
  })

  describe('Basic Registration', () => {
    it('should register handler via $.on.Noun.verb() pattern', () => {
      const handler = vi.fn()

      onProxy.Customer.signup(handler)

      expect(eventHandlers.has('Customer.signup')).toBe(true)
      expect(eventHandlers.get('Customer.signup')).toContain(handler)
    })

    it('should support multiple handlers for same event type', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      onProxy.Customer.signup(handler1)
      onProxy.Customer.signup(handler2)

      const handlers = eventHandlers.get('Customer.signup')
      expect(handlers).toHaveLength(2)
      expect(handlers).toContain(handler1)
      expect(handlers).toContain(handler2)
    })

    it('should support different Noun.verb combinations', () => {
      const signupHandler = vi.fn()
      const orderHandler = vi.fn()
      const paymentHandler = vi.fn()

      onProxy.Customer.signup(signupHandler)
      onProxy.Order.created(orderHandler)
      onProxy.Payment.processed(paymentHandler)

      expect(eventHandlers.get('Customer.signup')).toContain(signupHandler)
      expect(eventHandlers.get('Order.created')).toContain(orderHandler)
      expect(eventHandlers.get('Payment.processed')).toContain(paymentHandler)
    })
  })

  describe('Unsubscribe Behavior', () => {
    it('should return unsubscribe function', () => {
      const handler = vi.fn()

      const unsubscribe = onProxy.Customer.signup(handler)

      expect(typeof unsubscribe).toBe('function')
    })

    it('should remove handler when unsubscribe is called', () => {
      const handler = vi.fn()

      const unsubscribe = onProxy.Customer.signup(handler)
      expect(eventHandlers.get('Customer.signup')).toContain(handler)

      unsubscribe()
      expect(eventHandlers.get('Customer.signup')).not.toContain(handler)
    })

    it('should only remove specific handler when unsubscribe is called', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      const unsubscribe1 = onProxy.Customer.signup(handler1)
      onProxy.Customer.signup(handler2)

      unsubscribe1()

      const handlers = eventHandlers.get('Customer.signup')
      expect(handlers).not.toContain(handler1)
      expect(handlers).toContain(handler2)
    })

    it('should handle unsubscribe called multiple times', () => {
      const handler = vi.fn()

      const unsubscribe = onProxy.Customer.signup(handler)

      unsubscribe()
      unsubscribe() // Should not throw
      unsubscribe() // Should not throw

      expect(eventHandlers.get('Customer.signup')).not.toContain(handler)
    })

    it('should handle unsubscribe when handler was never registered', () => {
      const handler = vi.fn()

      const unsubscribe = onProxy.Customer.signup(handler)

      // Manually clear handlers
      eventHandlers.clear()

      // Should not throw
      expect(() => unsubscribe()).not.toThrow()
    })
  })

  describe('Wildcard Pattern Registration', () => {
    it('should register wildcard noun handler (*.verb)', () => {
      const handler = vi.fn()

      onProxy['*'].created(handler)

      expect(eventHandlers.has('*.created')).toBe(true)
      expect(eventHandlers.get('*.created')).toContain(handler)
    })

    it('should register wildcard verb handler (Noun.*)', () => {
      const handler = vi.fn()

      onProxy.Customer['*'](handler)

      expect(eventHandlers.has('Customer.*')).toBe(true)
      expect(eventHandlers.get('Customer.*')).toContain(handler)
    })

    it('should register global wildcard handler (*.*)', () => {
      const handler = vi.fn()

      onProxy['*']['*'](handler)

      expect(eventHandlers.has('*.*')).toBe(true)
      expect(eventHandlers.get('*.*')).toContain(handler)
    })
  })

  describe('Proxy Behavior', () => {
    it('should handle non-string noun access gracefully', () => {
      // @ts-expect-error Testing non-string access
      const result = onProxy[Symbol('test')]
      expect(result).toBeUndefined()
    })

    it('should handle non-string verb access gracefully', () => {
      const noun = onProxy.Customer
      // @ts-expect-error Testing non-string access
      const result = noun[Symbol('test')]
      expect(result).toBeUndefined()
    })
  })
})

// =============================================================================
// EventSystem Class Tests
// =============================================================================

describe('EventSystem', () => {
  let eventSystem: EventSystem

  beforeEach(() => {
    eventSystem = new EventSystem()
  })

  afterEach(() => {
    eventSystem.clearHandlers()
  })

  // ---------------------------------------------------------------------------
  // Basic Event Emission
  // ---------------------------------------------------------------------------

  describe('Event Emission via send()', () => {
    it('should emit events and return event ID', () => {
      const eventId = eventSystem.send('Customer.signup', { email: 'test@example.com' })

      expect(eventId).toBeDefined()
      expect(eventId).toMatch(/^evt_/)
    })

    it('should call registered handler when event is sent', async () => {
      const handler = vi.fn()

      eventSystem.on.Customer.signup(handler)
      eventSystem.send('Customer.signup', { email: 'test@example.com' })

      // Wait for async handler execution
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should pass correct event object to handler', async () => {
      const handler = vi.fn()

      eventSystem.on.Customer.signup(handler)
      eventSystem.send('Customer.signup', { email: 'alice@example.com' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Customer.signup',
          subject: 'Customer',
          object: 'signup',
          data: { email: 'alice@example.com' },
        })
      )
    })

    it('should include id, timestamp in event object', async () => {
      const handler = vi.fn()

      eventSystem.on.Customer.signup(handler)
      eventSystem.send('Customer.signup', { name: 'Bob' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      const event = handler.mock.calls[0][0] as Event
      expect(event.id).toMatch(/^evt_/)
      expect(event.timestamp).toBeInstanceOf(Date)
    })

    it('should call multiple handlers for same event type', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      eventSystem.on.Order.created(handler1)
      eventSystem.on.Order.created(handler2)
      eventSystem.on.Order.created(handler3)

      eventSystem.send('Order.created', { orderId: '123' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
      expect(handler3).toHaveBeenCalledTimes(1)
    })

    it('should not call handlers for different event types', async () => {
      const customerHandler = vi.fn()
      const orderHandler = vi.fn()

      eventSystem.on.Customer.signup(customerHandler)
      eventSystem.on.Order.created(orderHandler)

      eventSystem.send('Customer.signup', { email: 'test@example.com' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(customerHandler).toHaveBeenCalledTimes(1)
      expect(orderHandler).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Wildcard Matching
  // ---------------------------------------------------------------------------

  describe('Wildcard Matching', () => {
    describe('*.verb (wildcard noun) matching', () => {
      it('should match any noun with *.created', async () => {
        const handler = vi.fn()

        eventSystem.on['*'].created(handler)

        eventSystem.send('Customer.created', { name: 'Alice' })
        eventSystem.send('Order.created', { orderId: '123' })
        eventSystem.send('Product.created', { sku: 'SKU-001' })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(handler).toHaveBeenCalledTimes(3)
      })

      it('should not match events with different verbs', async () => {
        const handler = vi.fn()

        eventSystem.on['*'].created(handler)

        eventSystem.send('Customer.created', { name: 'Alice' })
        eventSystem.send('Customer.updated', { name: 'Alice Updated' })
        eventSystem.send('Customer.deleted', { id: '123' })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(handler).toHaveBeenCalledTimes(1)
      })
    })

    describe('Noun.* (wildcard verb) matching', () => {
      it('should match any verb with Customer.*', async () => {
        const handler = vi.fn()

        eventSystem.on.Customer['*'](handler)

        eventSystem.send('Customer.created', { name: 'Alice' })
        eventSystem.send('Customer.updated', { name: 'Alice Updated' })
        eventSystem.send('Customer.deleted', { id: '123' })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(handler).toHaveBeenCalledTimes(3)
      })

      it('should not match events from different nouns', async () => {
        const handler = vi.fn()

        eventSystem.on.Customer['*'](handler)

        eventSystem.send('Customer.created', { name: 'Alice' })
        eventSystem.send('Order.created', { orderId: '123' })
        eventSystem.send('Product.created', { sku: 'SKU-001' })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(handler).toHaveBeenCalledTimes(1)
      })
    })

    describe('*.* (global wildcard) matching', () => {
      it('should match all events with *.*', async () => {
        const handler = vi.fn()

        eventSystem.on['*']['*'](handler)

        eventSystem.send('Customer.created', { name: 'Alice' })
        eventSystem.send('Order.shipped', { orderId: '123' })
        eventSystem.send('Payment.processed', { amount: 100 })
        eventSystem.send('Inventory.updated', { sku: 'SKU-001' })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(handler).toHaveBeenCalledTimes(4)
      })
    })

    describe('Combined exact and wildcard handlers', () => {
      it('should call both exact and wildcard handlers', async () => {
        const exactHandler = vi.fn()
        const wildcardNounHandler = vi.fn()
        const wildcardVerbHandler = vi.fn()
        const globalHandler = vi.fn()

        eventSystem.on.Customer.created(exactHandler)
        eventSystem.on['*'].created(wildcardNounHandler)
        eventSystem.on.Customer['*'](wildcardVerbHandler)
        eventSystem.on['*']['*'](globalHandler)

        eventSystem.send('Customer.created', { name: 'Alice' })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(exactHandler).toHaveBeenCalledTimes(1)
        expect(wildcardNounHandler).toHaveBeenCalledTimes(1)
        expect(wildcardVerbHandler).toHaveBeenCalledTimes(1)
        expect(globalHandler).toHaveBeenCalledTimes(1)
      })

      it('should pass same event object to all matching handlers', async () => {
        const handlers: Event[] = []

        eventSystem.on.Customer.created((e) => handlers.push(e))
        eventSystem.on['*'].created((e) => handlers.push(e))
        eventSystem.on.Customer['*']((e) => handlers.push(e))
        eventSystem.on['*']['*']((e) => handlers.push(e))

        eventSystem.send('Customer.created', { name: 'Bob' })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(handlers).toHaveLength(4)
        // All should have same event ID
        const eventIds = new Set(handlers.map((e) => e.id))
        expect(eventIds.size).toBe(1)
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Handler Error Isolation
  // ---------------------------------------------------------------------------

  describe('Handler Error Isolation', () => {
    it('should not crash when handler throws sync error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const throwingHandler = vi.fn(() => {
        throw new Error('Handler error!')
      })
      const normalHandler = vi.fn()

      eventSystem.on.Test.event(throwingHandler)
      eventSystem.on.Test.event(normalHandler)

      // Should not throw
      expect(() => eventSystem.send('Test.event', { data: 'test' })).not.toThrow()

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Normal handler should still be called
      expect(normalHandler).toHaveBeenCalledTimes(1)

      consoleErrorSpy.mockRestore()
    })

    it('should not crash when handler throws async error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const throwingHandler = vi.fn(async () => {
        throw new Error('Async handler error!')
      })
      const normalHandler = vi.fn()

      eventSystem.on.Test.event(throwingHandler)
      eventSystem.on.Test.event(normalHandler)

      eventSystem.send('Test.event', { data: 'test' })

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Normal handler should still be called
      expect(normalHandler).toHaveBeenCalledTimes(1)

      consoleErrorSpy.mockRestore()
    })

    it('should execute all handlers even when first one fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const order: number[] = []

      const handler1 = vi.fn(() => {
        order.push(1)
        throw new Error('Handler 1 failed')
      })
      const handler2 = vi.fn(() => {
        order.push(2)
      })
      const handler3 = vi.fn(() => {
        order.push(3)
        throw new Error('Handler 3 failed')
      })
      const handler4 = vi.fn(() => {
        order.push(4)
      })

      eventSystem.on.Test.event(handler1)
      eventSystem.on.Test.event(handler2)
      eventSystem.on.Test.event(handler3)
      eventSystem.on.Test.event(handler4)

      eventSystem.send('Test.event', { data: 'test' })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()
      expect(handler4).toHaveBeenCalled()
      expect(order).toEqual([1, 2, 3, 4])

      consoleErrorSpy.mockRestore()
    })

    it('should log errors but continue execution', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const throwingHandler = vi.fn(() => {
        throw new Error('Test error message')
      })

      eventSystem.on.Test.event(throwingHandler)
      eventSystem.send('Test.event', { data: 'test' })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(consoleErrorSpy).toHaveBeenCalled()
      // Check that error message includes event type
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('Test.event')

      consoleErrorSpy.mockRestore()
    })
  })

  // ---------------------------------------------------------------------------
  // Unsubscribe Behavior
  // ---------------------------------------------------------------------------

  describe('Unsubscribe Behavior', () => {
    it('should stop receiving events after unsubscribe', async () => {
      const handler = vi.fn()

      const unsubscribe = eventSystem.on.Customer.signup(handler)

      eventSystem.send('Customer.signup', { email: 'first@example.com' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()

      eventSystem.send('Customer.signup', { email: 'second@example.com' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should still be 1, not 2
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should support unsubscribe for wildcard handlers', async () => {
      const handler = vi.fn()

      const unsubscribe = eventSystem.on['*'].created(handler)

      eventSystem.send('Customer.created', { name: 'Alice' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()

      eventSystem.send('Order.created', { orderId: '123' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should still be 1
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should support unsubscribe for global wildcard handlers', async () => {
      const handler = vi.fn()

      const unsubscribe = eventSystem.on['*']['*'](handler)

      eventSystem.send('Customer.created', { name: 'Alice' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()

      eventSystem.send('Order.shipped', { orderId: '123' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should still be 1
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Direct Handler Registration via registerHandler()
  // ---------------------------------------------------------------------------

  describe('registerHandler() direct method', () => {
    it('should register handler via registerHandler() method', async () => {
      const handler = vi.fn()

      eventSystem.registerHandler('Customer.signup', handler)
      eventSystem.send('Customer.signup', { email: 'test@example.com' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should return unsubscribe function from registerHandler()', async () => {
      const handler = vi.fn()

      const unsubscribe = eventSystem.registerHandler('Customer.signup', handler)

      eventSystem.send('Customer.signup', { email: 'first@example.com' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      unsubscribe()

      eventSystem.send('Customer.signup', { email: 'second@example.com' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should support wildcard patterns via registerHandler()', async () => {
      const handler = vi.fn()

      eventSystem.registerHandler('*.created', handler)

      eventSystem.send('Customer.created', { name: 'Alice' })
      eventSystem.send('Order.created', { orderId: '123' })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Handler Count and State Management
  // ---------------------------------------------------------------------------

  describe('Handler Count and State', () => {
    it('should return correct handler count', () => {
      eventSystem.on.Customer.signup(() => {})
      eventSystem.on.Customer.signup(() => {})
      eventSystem.on.Customer.signup(() => {})

      expect(eventSystem.getHandlerCount('Customer.signup')).toBe(3)
    })

    it('should return 0 for event types with no handlers', () => {
      expect(eventSystem.getHandlerCount('Unknown.event')).toBe(0)
    })

    it('should update count after unsubscribe', () => {
      const unsubscribe1 = eventSystem.on.Test.event(() => {})
      eventSystem.on.Test.event(() => {})

      expect(eventSystem.getHandlerCount('Test.event')).toBe(2)

      unsubscribe1()

      expect(eventSystem.getHandlerCount('Test.event')).toBe(1)
    })

    it('should clear all handlers via clearHandlers()', () => {
      eventSystem.on.Customer.signup(() => {})
      eventSystem.on.Order.created(() => {})
      eventSystem.on['*'].updated(() => {})

      eventSystem.clearHandlers()

      expect(eventSystem.getHandlerCount('Customer.signup')).toBe(0)
      expect(eventSystem.getHandlerCount('Order.created')).toBe(0)
      expect(eventSystem.getHandlerCount('*.updated')).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Async Handler Support
  // ---------------------------------------------------------------------------

  describe('Async Handler Support', () => {
    it('should support async handlers', async () => {
      const results: string[] = []

      const asyncHandler = async (event: Event) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        results.push(`handled: ${event.type}`)
      }

      eventSystem.on.Async.test(asyncHandler)
      eventSystem.send('Async.test', { value: 1 })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(results).toEqual(['handled: Async.test'])
    })

    it('should handle multiple async handlers', async () => {
      const results: number[] = []

      const handler1 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        results.push(1)
      }
      const handler2 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        results.push(2)
      }
      const handler3 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        results.push(3)
      }

      eventSystem.on.Async.test(handler1)
      eventSystem.on.Async.test(handler2)
      eventSystem.on.Async.test(handler3)

      eventSystem.send('Async.test', {})

      await new Promise((resolve) => setTimeout(resolve, 150))

      // All handlers should complete (order may vary due to different delays)
      expect(results).toHaveLength(3)
      expect(results).toContain(1)
      expect(results).toContain(2)
      expect(results).toContain(3)
    })
  })

  // ---------------------------------------------------------------------------
  // Fire-and-Forget Semantics
  // ---------------------------------------------------------------------------

  describe('Fire-and-Forget Semantics', () => {
    it('should return immediately without waiting for handlers', () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500))
      })

      eventSystem.on.Test.event(handler)

      const start = Date.now()
      const eventId = eventSystem.send('Test.event', { data: 'test' })
      const elapsed = Date.now() - start

      // Should return immediately (much less than 500ms)
      expect(elapsed).toBeLessThan(50)
      expect(eventId).toBeDefined()
    })

    it('should not block on slow handlers', () => {
      const slowHandler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      })

      eventSystem.on.Slow.event(slowHandler)

      const start = Date.now()
      eventSystem.send('Slow.event', { data: 'test1' })
      eventSystem.send('Slow.event', { data: 'test2' })
      eventSystem.send('Slow.event', { data: 'test3' })
      const elapsed = Date.now() - start

      // All sends should return immediately
      expect(elapsed).toBeLessThan(100)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle event with empty data', async () => {
      const handler = vi.fn()

      eventSystem.on.Test.event(handler)
      eventSystem.send('Test.event', {})

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {},
        })
      )
    })

    it('should handle event with null data', async () => {
      const handler = vi.fn()

      eventSystem.on.Test.event(handler)
      eventSystem.send('Test.event', null)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: null,
        })
      )
    })

    it('should handle event with undefined data', async () => {
      const handler = vi.fn()

      eventSystem.on.Test.event(handler)
      eventSystem.send('Test.event', undefined)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: undefined,
        })
      )
    })

    it('should handle event with complex nested data', async () => {
      const handler = vi.fn()
      const complexData = {
        user: {
          name: 'Alice',
          settings: {
            theme: 'dark',
            notifications: [
              { type: 'email', enabled: true },
              { type: 'sms', enabled: false },
            ],
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        },
      }

      eventSystem.on.Test.event(handler)
      eventSystem.send('Test.event', complexData)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: complexData,
        })
      )
    })

    it('should handle event type with single segment', async () => {
      const handler = vi.fn()

      eventSystem.registerHandler('SingleSegment', handler)
      eventSystem.send('SingleSegment', { data: 'test' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Handler registered with 'SingleSegment' should be called
      // Note: This tests behavior with non-standard event types
      expect(handler).toHaveBeenCalled()
    })

    it('should handle rapid event emission', async () => {
      const handler = vi.fn()

      eventSystem.on.Rapid.event(handler)

      // Emit 100 events rapidly
      for (let i = 0; i < 100; i++) {
        eventSystem.send('Rapid.event', { index: i })
      }

      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(handler).toHaveBeenCalledTimes(100)
    })
  })

  // ---------------------------------------------------------------------------
  // OnProxy Accessor
  // ---------------------------------------------------------------------------

  describe('OnProxy accessor via eventSystem.on', () => {
    it('should provide on property that returns OnProxy', () => {
      expect(eventSystem.on).toBeDefined()
      expect(typeof eventSystem.on.Customer.signup).toBe('function')
    })

    it('should create new OnProxy instance each time on is accessed', () => {
      // This is a behavioral test - both should work on the same underlying map
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      eventSystem.on.Test.event(handler1)
      eventSystem.on.Test.event(handler2)

      expect(eventSystem.getHandlerCount('Test.event')).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Event Handlers Map Access
  // ---------------------------------------------------------------------------

  describe('Event Handlers Map Access', () => {
    it('should provide access to underlying handlers map', () => {
      eventSystem.on.Test.event(() => {})
      eventSystem.on.Other.event(() => {})

      const map = eventSystem.getEventHandlersMap()

      expect(map).toBeInstanceOf(Map)
      expect(map.has('Test.event')).toBe(true)
      expect(map.has('Other.event')).toBe(true)
    })
  })
})

// =============================================================================
// Integration-like Tests (without actual DO runtime)
// =============================================================================

describe('EventSystem Integration Patterns', () => {
  describe('Event-driven workflow pattern', () => {
    it('should support chained event handling', async () => {
      const eventSystem = new EventSystem()
      const events: string[] = []

      // Simulate a workflow: signup -> welcome email -> profile setup
      eventSystem.on.Customer.signup((event) => {
        events.push('signup')
        // In real code, this would trigger welcome email
        eventSystem.send('Email.welcome', { to: (event.data as { email: string }).email })
      })

      eventSystem.on.Email.welcome((event) => {
        events.push('welcome-email')
        // In real code, this would trigger profile setup prompt
        eventSystem.send('Profile.setupPrompt', { email: (event.data as { to: string }).to })
      })

      eventSystem.on.Profile.setupPrompt(() => {
        events.push('profile-setup')
      })

      eventSystem.send('Customer.signup', { email: 'alice@example.com' })

      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(events).toEqual(['signup', 'welcome-email', 'profile-setup'])

      eventSystem.clearHandlers()
    })
  })

  describe('Event aggregation pattern', () => {
    it('should aggregate events via global wildcard', async () => {
      const eventSystem = new EventSystem()
      const allEvents: Event[] = []

      // Aggregate all events for logging/analytics
      eventSystem.on['*']['*']((event) => {
        allEvents.push(event)
      })

      eventSystem.send('Customer.created', { name: 'Alice' })
      eventSystem.send('Order.placed', { orderId: '123' })
      eventSystem.send('Payment.received', { amount: 100 })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(allEvents).toHaveLength(3)
      expect(allEvents.map((e) => e.type)).toEqual([
        'Customer.created',
        'Order.placed',
        'Payment.received',
      ])

      eventSystem.clearHandlers()
    })
  })

  describe('Filtered event handling pattern', () => {
    it('should filter events within handler', async () => {
      const eventSystem = new EventSystem()
      const vipCustomers: Event[] = []

      eventSystem.on.Customer['*']((event) => {
        const data = event.data as { tier?: string }
        if (data.tier === 'vip') {
          vipCustomers.push(event)
        }
      })

      eventSystem.send('Customer.created', { name: 'Alice', tier: 'standard' })
      eventSystem.send('Customer.created', { name: 'Bob', tier: 'vip' })
      eventSystem.send('Customer.upgraded', { name: 'Charlie', tier: 'vip' })
      eventSystem.send('Customer.downgraded', { name: 'Dave', tier: 'standard' })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(vipCustomers).toHaveLength(2)

      eventSystem.clearHandlers()
    })
  })
})

// =============================================================================
// Additional TDD RED Phase Tests - Future Requirements
// =============================================================================

describe('EventSystem Future Requirements (TDD RED Phase)', () => {
  let eventSystem: EventSystem

  beforeEach(() => {
    eventSystem = new EventSystem()
  })

  afterEach(() => {
    eventSystem.clearHandlers()
  })

  describe('Handler Execution Order', () => {
    it('should execute handlers in registration order', async () => {
      const order: number[] = []

      eventSystem.on.Test.event(() => order.push(1))
      eventSystem.on.Test.event(() => order.push(2))
      eventSystem.on.Test.event(() => order.push(3))

      eventSystem.send('Test.event', {})

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Handlers should be called in registration order
      expect(order).toEqual([1, 2, 3])
    })

    it('should execute exact match handlers before wildcards', async () => {
      const order: string[] = []

      // Register in different order to verify priority
      eventSystem.on['*']['*'](() => order.push('global'))
      eventSystem.on['*'].created(() => order.push('wildcard-noun'))
      eventSystem.on.Customer['*'](() => order.push('wildcard-verb'))
      eventSystem.on.Customer.created(() => order.push('exact'))

      eventSystem.send('Customer.created', {})

      await new Promise((resolve) => setTimeout(resolve, 100))

      // All should be called, exact first, then wildcards
      expect(order).toContain('exact')
      expect(order).toContain('wildcard-noun')
      expect(order).toContain('wildcard-verb')
      expect(order).toContain('global')
      expect(order.indexOf('exact')).toBeLessThan(order.indexOf('global'))
    })
  })

  describe('Event Types with Special Characters', () => {
    it('should handle event types with hyphens', async () => {
      const handler = vi.fn()

      eventSystem.registerHandler('user-service.account-created', handler)
      eventSystem.send('user-service.account-created', { userId: '123' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalled()
    })

    it('should handle event types with underscores', async () => {
      const handler = vi.fn()

      eventSystem.registerHandler('user_service.account_created', handler)
      eventSystem.send('user_service.account_created', { userId: '123' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalled()
    })

    it('should handle event types with numbers', async () => {
      const handler = vi.fn()

      eventSystem.registerHandler('API2.v3_endpoint', handler)
      eventSystem.send('API2.v3_endpoint', { version: 3 })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalled()
    })

    it('should handle event types with camelCase', async () => {
      const handler = vi.fn()

      eventSystem.registerHandler('UserAccount.passwordChanged', handler)
      eventSystem.send('UserAccount.passwordChanged', { userId: '123' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalled()
    })
  })

  describe('Memory Management', () => {
    it('should not leak memory when handlers are unsubscribed', () => {
      // Register and unsubscribe many handlers
      const unsubscribes: (() => void)[] = []

      for (let i = 0; i < 1000; i++) {
        const unsub = eventSystem.on.Test.event(() => {})
        unsubscribes.push(unsub)
      }

      expect(eventSystem.getHandlerCount('Test.event')).toBe(1000)

      // Unsubscribe all
      for (const unsub of unsubscribes) {
        unsub()
      }

      expect(eventSystem.getHandlerCount('Test.event')).toBe(0)
    })

    it('should handle empty handlers array after all unsubscribes', () => {
      const unsub1 = eventSystem.on.Test.event(() => {})
      const unsub2 = eventSystem.on.Test.event(() => {})

      unsub1()
      unsub2()

      // Should have empty array, not undefined
      const handlers = eventSystem.getEventHandlersMap().get('Test.event')
      expect(handlers).toBeDefined()
      expect(handlers).toHaveLength(0)
    })
  })

  describe('Concurrent Event Emission', () => {
    it('should handle concurrent sends without data corruption', async () => {
      const receivedEvents: Event[] = []

      eventSystem.on.Concurrent.test((event) => {
        receivedEvents.push(event)
      })

      // Send many events concurrently
      const promises = []
      for (let i = 0; i < 50; i++) {
        promises.push(
          Promise.resolve().then(() => {
            eventSystem.send('Concurrent.test', { index: i })
          })
        )
      }

      await Promise.all(promises)
      await new Promise((resolve) => setTimeout(resolve, 200))

      // All events should be received with unique IDs
      expect(receivedEvents).toHaveLength(50)
      const eventIds = new Set(receivedEvents.map((e) => e.id))
      expect(eventIds.size).toBe(50)
    })
  })

  describe('Handler Context', () => {
    it('should preserve handler context (this binding)', async () => {
      class EventProcessor {
        public processed: Event[] = []

        handleEvent(event: Event) {
          this.processed.push(event)
        }
      }

      const processor = new EventProcessor()

      // Bind the handler to preserve 'this'
      eventSystem.on.Test.event(processor.handleEvent.bind(processor))
      eventSystem.send('Test.event', { value: 42 })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(processor.processed).toHaveLength(1)
      expect(processor.processed[0].data).toEqual({ value: 42 })
    })
  })

  describe('Once-only Handlers (Future Feature)', () => {
    it.skip('should support once-only handlers that auto-unsubscribe', async () => {
      // This tests a potential future feature
      const handler = vi.fn()

      // Future API: eventSystem.once.Test.event(handler)
      // For now, implement with manual unsubscribe
      let unsubscribe: () => void
      unsubscribe = eventSystem.on.Test.event((event) => {
        handler(event)
        unsubscribe()
      })

      eventSystem.send('Test.event', { count: 1 })
      eventSystem.send('Test.event', { count: 2 })
      eventSystem.send('Test.event', { count: 3 })

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should only be called once
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('Event History (Future Feature)', () => {
    it.skip('should support retrieving recent events', async () => {
      eventSystem.send('History.event1', { data: 1 })
      eventSystem.send('History.event2', { data: 2 })
      eventSystem.send('History.event3', { data: 3 })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Future API: eventSystem.getRecentEvents(limit)
      // const history = eventSystem.getRecentEvents(10)
      // expect(history).toHaveLength(3)
    })
  })

  describe('Priority Handlers (Future Feature)', () => {
    it.skip('should support handler priority for execution order', async () => {
      const order: string[] = []

      // Future API: eventSystem.on.Test.event(handler, { priority: 10 })
      // Higher priority handlers execute first
      eventSystem.on.Test.event(() => order.push('low'))
      eventSystem.on.Test.event(() => order.push('high'))
      eventSystem.on.Test.event(() => order.push('medium'))

      eventSystem.send('Test.event', {})

      await new Promise((resolve) => setTimeout(resolve, 100))

      // With priority, order would be: high, medium, low
      // Currently, order is registration order
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('should accept Event interface correctly', () => {
    const event: Event = {
      id: 'evt_123',
      type: 'Test.event',
      subject: 'Test',
      object: 'event',
      data: { foo: 'bar' },
      timestamp: new Date(),
    }

    expect(event.id).toBe('evt_123')
    expect(event.type).toBe('Test.event')
    expect(event.subject).toBe('Test')
    expect(event.object).toBe('event')
    expect(event.timestamp).toBeInstanceOf(Date)
  })

  it('should accept EventHandler type correctly', () => {
    const handler: EventHandler = async (event) => {
      console.log(event.type)
    }

    expect(typeof handler).toBe('function')
  })

  it('should accept OnProxy type correctly', () => {
    const handlers = new Map<string, EventHandler[]>()
    const on: OnProxy = createOnProxy(handlers)

    // These should all type-check
    const unsub1 = on.Customer.signup(() => {})
    const unsub2 = on.Order.created(() => {})
    const unsub3 = on['*'].updated(() => {})
    const unsub4 = on.Product['*'](() => {})
    const unsub5 = on['*']['*'](() => {})

    expect(typeof unsub1).toBe('function')
    expect(typeof unsub2).toBe('function')
    expect(typeof unsub3).toBe('function')
    expect(typeof unsub4).toBe('function')
    expect(typeof unsub5).toBe('function')
  })
})
