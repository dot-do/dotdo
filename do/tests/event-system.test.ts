import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventSystem, createEventSystem, type EventPayload } from '../workflow/event-system'

describe('EventSystem - Standalone Event Handling Module', () => {
  let eventSystem: EventSystem
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    eventSystem = new EventSystem()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('Handler Registration', () => {
    it('should register handler via eventSystem.on.Customer.signup()', () => {
      const handler = vi.fn()
      eventSystem.on.Customer.signup(handler)

      expect(eventSystem.getHandlerCount('Customer.signup')).toBe(1)
      expect(eventSystem.hasHandlers('Customer.signup')).toBe(true)
    })

    it('should support infinite Noun.verb combinations', () => {
      eventSystem.on.Order.placed(vi.fn())
      eventSystem.on.Invoice.generated(vi.fn())
      eventSystem.on.Subscription.renewed(vi.fn())

      expect(eventSystem.getEventTypes()).toContain('Order.placed')
      expect(eventSystem.getEventTypes()).toContain('Invoice.generated')
      expect(eventSystem.getEventTypes()).toContain('Subscription.renewed')
    })

    it('should support multiple handlers for same event', () => {
      eventSystem.on.Order.placed(vi.fn())
      eventSystem.on.Order.placed(vi.fn())
      eventSystem.on.Order.placed(vi.fn())

      expect(eventSystem.getHandlerCount('Order.placed')).toBe(3)
    })

    it('should support wildcard handlers', () => {
      eventSystem.on['*'].created(vi.fn())
      eventSystem.on.Customer['*'](vi.fn())
      eventSystem.on['*']['*'](vi.fn())

      expect(eventSystem.hasHandlers('*.created')).toBe(true)
      expect(eventSystem.hasHandlers('Customer.*')).toBe(true)
      expect(eventSystem.hasHandlers('*.*')).toBe(true)
    })
  })

  describe('Event Emission', () => {
    it('should invoke registered handlers on emit', async () => {
      const handler = vi.fn()
      eventSystem.on.Order.placed(handler)

      const event: EventPayload = { type: 'Order.placed', data: { orderId: '123' } }
      await eventSystem.emit(event)

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should invoke all matching handlers', async () => {
      const exactHandler = vi.fn()
      const wildcardHandler = vi.fn()
      const globalHandler = vi.fn()

      eventSystem.on.Order.placed(exactHandler)
      eventSystem.on.Order['*'](wildcardHandler)
      eventSystem.on['*']['*'](globalHandler)

      await eventSystem.emit({ type: 'Order.placed', data: {} })

      expect(exactHandler).toHaveBeenCalled()
      expect(wildcardHandler).toHaveBeenCalled()
      expect(globalHandler).toHaveBeenCalled()
    })

    it('should return invocation results', async () => {
      const successHandler = vi.fn()
      const failHandler = vi.fn(() => { throw new Error('Handler failed') })

      eventSystem.on.Test.event(successHandler)
      eventSystem.on.Test.event(failHandler)

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.succeeded.length).toBe(1)
      expect(result.failed.length).toBe(1)
    })

    it('should support async handlers', async () => {
      const handler = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 10))
      })

      eventSystem.on.Async.handler(handler)
      await eventSystem.emit({ type: 'Async.handler' })

      expect(handler).toHaveBeenCalled()
    })
  })

  describe('Emit Listeners', () => {
    it('should notify emit listeners before handler invocation', async () => {
      const order: string[] = []

      eventSystem.onEmit(() => {
        order.push('listener')
      })

      eventSystem.on.Test.event(() => {
        order.push('handler')
      })

      await eventSystem.emit({ type: 'Test.event' })

      expect(order).toEqual(['listener', 'handler'])
    })

    it('should support unsubscribing emit listeners', async () => {
      const listener = vi.fn()
      const unsubscribe = eventSystem.onEmit(listener)

      await eventSystem.emit({ type: 'Test.first' })
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()

      await eventSystem.emit({ type: 'Test.second' })
      expect(listener).toHaveBeenCalledTimes(1) // Still 1, not 2
    })

    it('should continue even if listener throws', async () => {
      const handler = vi.fn()

      eventSystem.onEmit(() => {
        throw new Error('Listener error')
      })

      eventSystem.on.Test.event(handler)

      await eventSystem.emit({ type: 'Test.event' })

      expect(handler).toHaveBeenCalled()
    })
  })

  describe('Handler Matching', () => {
    it('should return matching handlers for exact match', () => {
      const handler = vi.fn()
      eventSystem.on.Customer.signup(handler)

      const handlers = eventSystem.getMatchingHandlers('Customer.signup')
      expect(handlers).toContain(handler)
    })

    it('should match wildcard patterns', () => {
      const nounWildcard = vi.fn()
      const verbWildcard = vi.fn()
      const globalWildcard = vi.fn()

      eventSystem.on.Customer['*'](nounWildcard)
      eventSystem.on['*'].signup(verbWildcard)
      eventSystem.on['*']['*'](globalWildcard)

      const handlers = eventSystem.getMatchingHandlers('Customer.signup')

      expect(handlers).toContain(nounWildcard)
      expect(handlers).toContain(verbWildcard)
      expect(handlers).toContain(globalWildcard)
    })

    it('should return true for hasMatchingHandlers with wildcards', () => {
      eventSystem.on['*']['*'](vi.fn())

      expect(eventSystem.hasMatchingHandlers('Any.event')).toBe(true)
      expect(eventSystem.hasHandlers('Any.event')).toBe(false) // No exact match
    })
  })

  describe('Handler Management', () => {
    it('should clear handlers for specific event type', () => {
      eventSystem.on.Order.placed(vi.fn())
      eventSystem.on.Order.placed(vi.fn())
      eventSystem.on.Customer.signup(vi.fn())

      eventSystem.clearHandlers('Order.placed')

      expect(eventSystem.hasHandlers('Order.placed')).toBe(false)
      expect(eventSystem.hasHandlers('Customer.signup')).toBe(true)
    })

    it('should clear all handlers', () => {
      eventSystem.on.Order.placed(vi.fn())
      eventSystem.on.Customer.signup(vi.fn())
      eventSystem.on.Payment.failed(vi.fn())

      eventSystem.clearAllHandlers()

      expect(eventSystem.getTotalHandlerCount()).toBe(0)
      expect(eventSystem.getEventTypes()).toHaveLength(0)
    })

    it('should return total handler count', () => {
      eventSystem.on.Order.placed(vi.fn())
      eventSystem.on.Order.placed(vi.fn())
      eventSystem.on.Customer.signup(vi.fn())

      expect(eventSystem.getTotalHandlerCount()).toBe(3)
    })
  })

  describe('Retry Options', () => {
    it('should use default retry options', () => {
      const defaults = eventSystem.getDefaultRetryOptions()

      expect(defaults.maxRetries).toBe(5)
      expect(defaults.backoff).toBe('exponential')
      expect(defaults.initialDelay).toBe(100)
    })

    it('should allow setting default retry options', () => {
      eventSystem.setDefaultRetryOptions({
        maxRetries: 3,
        backoff: 'linear',
        initialDelay: 200,
      })

      const defaults = eventSystem.getDefaultRetryOptions()

      expect(defaults.maxRetries).toBe(3)
      expect(defaults.backoff).toBe('linear')
      expect(defaults.initialDelay).toBe(200)
    })

    it('should accept custom retry options on emit', async () => {
      let attempts = 0
      eventSystem.on.Test.event(() => {
        attempts++
        if (attempts < 3) {
          const error = new Error('Transient error')
          ;(error as any).retriable = true
          throw error
        }
      })

      await eventSystem.emit(
        { type: 'Test.event' },
        { maxRetries: 3, backoff: 'linear', initialDelay: 10 }
      )

      expect(attempts).toBe(3)
    })
  })

  describe('Factory Function', () => {
    it('should create EventSystem via createEventSystem()', () => {
      const es = createEventSystem()
      expect(es).toBeInstanceOf(EventSystem)
    })

    it('should accept options in factory', () => {
      const es = createEventSystem({
        defaultRetryOptions: {
          maxRetries: 10,
        },
      })

      expect(es.getDefaultRetryOptions().maxRetries).toBe(10)
    })
  })

  describe('Handlers Map Access', () => {
    it('should provide access to internal handlers map', () => {
      eventSystem.on.Test.event(vi.fn())

      const map = eventSystem.getHandlersMap()
      expect(map).toBeInstanceOf(Map)
      expect(map.has('Test.event')).toBe(true)
    })
  })

  describe('No DO Dependencies', () => {
    it('should work without any Durable Object dependencies', () => {
      // EventSystem should be completely standalone
      const es = new EventSystem()

      // Register handlers
      es.on.StandaloneTest.action(vi.fn())

      // Check state
      expect(es.getEventTypes()).toContain('StandaloneTest.action')
      expect(es.hasHandlers('StandaloneTest.action')).toBe(true)

      // No DO-specific methods or properties should be required
    })

    it('should be usable in contexts without DurableObjectState', async () => {
      const es = new EventSystem()
      const results: string[] = []

      es.on.Process.start((event) => {
        results.push(`started: ${(event as EventPayload).data}`)
      })

      es.on.Process.complete((event) => {
        results.push(`completed: ${(event as EventPayload).data}`)
      })

      await es.emit({ type: 'Process.start', data: 'job-1' })
      await es.emit({ type: 'Process.complete', data: 'job-1' })

      expect(results).toEqual(['started: job-1', 'completed: job-1'])
    })
  })
})
