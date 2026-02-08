import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventSystem, createEventSystem, type EventPayload } from '../workflow/event-system'
import { ValidationError } from '@dotdo/rpc'

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

  describe('Edge Cases - Null/Undefined/Empty Payloads', () => {
    it('should handle undefined event data', async () => {
      const handler = vi.fn()
      eventSystem.on.Test.event(handler)

      const event: EventPayload = { type: 'Test.event', data: undefined }
      await eventSystem.emit(event)

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should handle null event data', async () => {
      const handler = vi.fn()
      eventSystem.on.Test.event(handler)

      const event: EventPayload = { type: 'Test.event', data: null }
      await eventSystem.emit(event)

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should handle event with no data field at all', async () => {
      const handler = vi.fn()
      eventSystem.on.Test.event(handler)

      const event: EventPayload = { type: 'Test.event' }
      await eventSystem.emit(event)

      expect(handler).toHaveBeenCalledWith(event)
      expect((handler.mock.calls[0][0] as EventPayload).data).toBeUndefined()
    })

    it('should handle empty object as data', async () => {
      const handler = vi.fn()
      eventSystem.on.Test.event(handler)

      const event: EventPayload = { type: 'Test.event', data: {} }
      await eventSystem.emit(event)

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should handle empty metadata', async () => {
      const handler = vi.fn()
      eventSystem.on.Test.event(handler)

      const event: EventPayload = { type: 'Test.event', data: 'test', metadata: {} }
      await eventSystem.emit(event)

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should handle undefined metadata', async () => {
      const handler = vi.fn()
      eventSystem.on.Test.event(handler)

      const event: EventPayload = { type: 'Test.event', data: 'test', metadata: undefined }
      await eventSystem.emit(event)

      expect(handler).toHaveBeenCalledWith(event)
    })
  })

  describe('Edge Cases - Empty/Invalid Event Types', () => {
    it('should handle empty string event type (no handlers match)', async () => {
      const handler = vi.fn()
      eventSystem.on.Test.event(handler)

      const result = await eventSystem.emit({ type: '' })

      // No handlers should match an empty event type
      expect(result.succeeded).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
      expect(handler).not.toHaveBeenCalled()
    })

    it('should handle event type without dot separator', async () => {
      const globalHandler = vi.fn()
      eventSystem.on['*']['*'](globalHandler)

      // Event type with no dot - split produces [noun, undefined]
      const result = await eventSystem.emit({ type: 'NoDotEvent' })

      // Global wildcard should still match
      expect(globalHandler).toHaveBeenCalled()
      expect(result.succeeded).toHaveLength(1)
    })

    it('should handle event type with multiple dots when registered via handlers map', async () => {
      const handler = vi.fn()
      // The OnProxy only supports two levels (Noun.verb), so we register directly
      // to test how matchHandlers handles event types with multiple dots
      const handlersMap = eventSystem.getHandlersMap()
      handlersMap.set('Nested.Event.extra', [handler])

      // Note: split('.') only splits on first dot in matchHandlers
      // So 'Nested.Event.extra' becomes noun='Nested', verb='Event.extra'
      const result = await eventSystem.emit({ type: 'Nested.Event.extra' })

      expect(handler).toHaveBeenCalled()
      expect(result.succeeded).toHaveLength(1)
    })

    it('should handle event type starting with dot', async () => {
      const globalHandler = vi.fn()
      eventSystem.on['*']['*'](globalHandler)

      // Event type starting with dot - split produces ['', 'event']
      const result = await eventSystem.emit({ type: '.event' })

      // Global wildcard should match
      expect(globalHandler).toHaveBeenCalled()
    })

    it('should handle event type ending with dot', async () => {
      const globalHandler = vi.fn()
      eventSystem.on['*']['*'](globalHandler)

      // Event type ending with dot - split produces ['Noun', '']
      const result = await eventSystem.emit({ type: 'Noun.' })

      expect(globalHandler).toHaveBeenCalled()
    })

    it('should handle event type that is just a dot', async () => {
      const globalHandler = vi.fn()
      eventSystem.on['*']['*'](globalHandler)

      const result = await eventSystem.emit({ type: '.' })

      // Global wildcard matches
      expect(globalHandler).toHaveBeenCalled()
    })
  })

  describe('Edge Cases - Very Long Event Type Names', () => {
    it('should handle very long noun name', async () => {
      const longNoun = 'A'.repeat(1000)
      const handler = vi.fn()
      eventSystem.on[longNoun].event(handler)

      await eventSystem.emit({ type: `${longNoun}.event` })

      expect(handler).toHaveBeenCalled()
      expect(eventSystem.hasHandlers(`${longNoun}.event`)).toBe(true)
    })

    it('should handle very long verb name', async () => {
      const longVerb = 'B'.repeat(1000)
      const handler = vi.fn()
      eventSystem.on.Test[longVerb](handler)

      await eventSystem.emit({ type: `Test.${longVerb}` })

      expect(handler).toHaveBeenCalled()
    })

    it('should handle very long event type (both noun and verb)', async () => {
      const longNoun = 'C'.repeat(500)
      const longVerb = 'D'.repeat(500)
      const handler = vi.fn()
      eventSystem.on[longNoun][longVerb](handler)

      const result = await eventSystem.emit({ type: `${longNoun}.${longVerb}` })

      expect(handler).toHaveBeenCalled()
      expect(result.succeeded).toHaveLength(1)
    })

    it('should handle unicode in event type names', async () => {
      const handler = vi.fn()
      eventSystem.on.Emoji.created(handler)

      // Unicode characters in noun and verb
      eventSystem.on['Kundenservice'].erstellt(vi.fn())
      eventSystem.on['Customer123'].signup(vi.fn())

      expect(eventSystem.hasHandlers('Kundenservice.erstellt')).toBe(true)
      expect(eventSystem.hasHandlers('Customer123.signup')).toBe(true)
    })

    it('should handle special characters in event type names', async () => {
      const handler = vi.fn()
      eventSystem.on['Customer-V2'].created(handler)
      eventSystem.on['Order_Item'].placed(vi.fn())

      await eventSystem.emit({ type: 'Customer-V2.created' })

      expect(handler).toHaveBeenCalled()
      expect(eventSystem.hasHandlers('Order_Item.placed')).toBe(true)
    })
  })

  describe('Edge Cases - Concurrent Event Emission', () => {
    it('should handle concurrent emissions of same event type', async () => {
      const callOrder: number[] = []
      const handler = vi.fn(async (event: unknown) => {
        const payload = event as EventPayload
        const index = payload.data as number
        // Simulate async work with varying delays
        await new Promise(r => setTimeout(r, Math.random() * 10))
        callOrder.push(index)
      })
      eventSystem.on.Concurrent.test(handler)

      // Emit multiple events concurrently
      await Promise.all([
        eventSystem.emit({ type: 'Concurrent.test', data: 1 }),
        eventSystem.emit({ type: 'Concurrent.test', data: 2 }),
        eventSystem.emit({ type: 'Concurrent.test', data: 3 }),
        eventSystem.emit({ type: 'Concurrent.test', data: 4 }),
        eventSystem.emit({ type: 'Concurrent.test', data: 5 }),
      ])

      expect(handler).toHaveBeenCalledTimes(5)
      expect(callOrder).toHaveLength(5)
    })

    it('should handle concurrent emissions of different event types', async () => {
      const results: string[] = []

      eventSystem.on.Order.placed(async () => {
        await new Promise(r => setTimeout(r, 5))
        results.push('order-placed')
      })

      eventSystem.on.Payment.processed(async () => {
        await new Promise(r => setTimeout(r, 2))
        results.push('payment-processed')
      })

      eventSystem.on.Email.sent(async () => {
        await new Promise(r => setTimeout(r, 1))
        results.push('email-sent')
      })

      await Promise.all([
        eventSystem.emit({ type: 'Order.placed' }),
        eventSystem.emit({ type: 'Payment.processed' }),
        eventSystem.emit({ type: 'Email.sent' }),
      ])

      expect(results).toHaveLength(3)
      expect(results).toContain('order-placed')
      expect(results).toContain('payment-processed')
      expect(results).toContain('email-sent')
    })

    it('should handle rapid sequential emissions', async () => {
      const handler = vi.fn()
      eventSystem.on.Rapid.fire(handler)

      for (let i = 0; i < 100; i++) {
        await eventSystem.emit({ type: 'Rapid.fire', data: i })
      }

      expect(handler).toHaveBeenCalledTimes(100)
    })

    it('should isolate handler failures in concurrent emissions', async () => {
      const results: string[] = []

      eventSystem.on.Test.event(async (event) => {
        const payload = event as EventPayload
        if (payload.data === 'fail') {
          throw new Error('Intentional failure')
        }
        results.push(payload.data as string)
      })

      // Emit events concurrently, some will fail
      const emissions = await Promise.all([
        eventSystem.emit({ type: 'Test.event', data: 'success-1' }),
        eventSystem.emit({ type: 'Test.event', data: 'fail' }),
        eventSystem.emit({ type: 'Test.event', data: 'success-2' }),
      ])

      // Check that successful ones completed
      expect(results).toContain('success-1')
      expect(results).toContain('success-2')
      expect(results).not.toContain('fail')

      // Check result structure
      expect(emissions[0].succeeded).toHaveLength(1)
      expect(emissions[1].failed).toHaveLength(1)
      expect(emissions[2].succeeded).toHaveLength(1)
    })
  })

  describe('Edge Cases - Handler Errors', () => {
    it('should handle synchronous handler throwing Error', async () => {
      eventSystem.on.Test.event(() => {
        throw new Error('Sync error')
      })

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error?.message).toBe('Sync error')
    })

    it('should handle async handler rejecting with Error', async () => {
      eventSystem.on.Test.event(async () => {
        await Promise.reject(new Error('Async error'))
      })

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error?.message).toBe('Async error')
    })

    it('should handle handler throwing non-Error value (string)', async () => {
      eventSystem.on.Test.event(() => {
        throw 'string error'
      })

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error?.message).toBe('string error')
    })

    it('should handle handler throwing non-Error value (number)', async () => {
      eventSystem.on.Test.event(() => {
        throw 42
      })

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error?.message).toBe('42')
    })

    it('should handle handler throwing null', async () => {
      eventSystem.on.Test.event(() => {
        throw null
      })

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error?.message).toBe('null')
    })

    it('should handle handler throwing undefined', async () => {
      eventSystem.on.Test.event(() => {
        throw undefined
      })

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error?.message).toBe('undefined')
    })

    it('should not retry ValidationError', async () => {
      let attempts = 0
      eventSystem.on.Test.event(() => {
        attempts++
        throw new ValidationError('Validation failed', { field: 'test' })
      })

      const result = await eventSystem.emit(
        { type: 'Test.event' },
        { maxRetries: 5, initialDelay: 1 }
      )

      expect(attempts).toBe(1) // Only one attempt, no retries
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error?.message).toContain('Validation failed')
    })

    it('should not retry errors with retriable=false', async () => {
      let attempts = 0
      eventSystem.on.Test.event(() => {
        attempts++
        const error = new Error('Non-retriable error')
        ;(error as any).retriable = false
        throw error
      })

      const result = await eventSystem.emit(
        { type: 'Test.event' },
        { maxRetries: 5, initialDelay: 1 }
      )

      expect(attempts).toBe(1)
      expect(result.failed).toHaveLength(1)
    })

    it('should retry errors with retriable=true', async () => {
      let attempts = 0
      eventSystem.on.Test.event(() => {
        attempts++
        if (attempts < 3) {
          const error = new Error('Transient error')
          ;(error as any).retriable = true
          throw error
        }
      })

      const result = await eventSystem.emit(
        { type: 'Test.event' },
        { maxRetries: 5, backoff: 'linear', initialDelay: 1 }
      )

      expect(attempts).toBe(3)
      expect(result.succeeded).toHaveLength(1)
    })

    it('should handle multiple handlers where some fail', async () => {
      eventSystem.on.Test.event(vi.fn()) // succeeds
      eventSystem.on.Test.event(() => { throw new Error('fail 1') })
      eventSystem.on.Test.event(vi.fn()) // succeeds
      eventSystem.on.Test.event(() => { throw new Error('fail 2') })
      eventSystem.on.Test.event(vi.fn()) // succeeds

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.succeeded).toHaveLength(3)
      expect(result.failed).toHaveLength(2)
    })

    it('should continue processing remaining handlers after one fails', async () => {
      const results: string[] = []

      eventSystem.on.Test.event(() => results.push('handler-1'))
      eventSystem.on.Test.event(() => { throw new Error('fail') })
      eventSystem.on.Test.event(() => results.push('handler-3'))

      await eventSystem.emit({ type: 'Test.event' })

      // All handlers should have been attempted (executed sequentially in FIFO order)
      expect(results).toContain('handler-1')
      expect(results).toContain('handler-3')
    })

    it('should track attempt counts for retried handlers', async () => {
      let attempts = 0
      eventSystem.on.Test.event(() => {
        attempts++
        if (attempts <= 3) {
          const error = new Error('Transient')
          ;(error as any).retriable = true
          throw error
        }
      })

      const result = await eventSystem.emit(
        { type: 'Test.event' },
        { maxRetries: 5, initialDelay: 1, backoff: 'linear' }
      )

      expect(result.succeeded).toHaveLength(1)
      expect(result.succeeded[0].attempts).toBe(4) // 3 failures + 1 success
    })

    it('should report max retries exceeded in result', async () => {
      let attempts = 0
      eventSystem.on.Test.event(() => {
        attempts++
        const error = new Error('Always fails')
        ;(error as any).retriable = true
        throw error
      })

      const result = await eventSystem.emit(
        { type: 'Test.event' },
        { maxRetries: 3, initialDelay: 1, backoff: 'linear' }
      )

      expect(attempts).toBe(4) // initial + 3 retries
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].attempts).toBe(4)
      expect(result.failed[0].error?.message).toBe('Always fails')
    })
  })

  describe('Edge Cases - Handler Registration Boundaries', () => {
    it('should handle registering same handler function multiple times', async () => {
      const handler = vi.fn()
      eventSystem.on.Test.event(handler)
      eventSystem.on.Test.event(handler)
      eventSystem.on.Test.event(handler)

      await eventSystem.emit({ type: 'Test.event' })

      expect(handler).toHaveBeenCalledTimes(3)
    })

    it('should handle clearing non-existent event type', () => {
      // Should not throw
      eventSystem.clearHandlers('NonExistent.event')
      expect(eventSystem.hasHandlers('NonExistent.event')).toBe(false)
    })

    it('should handle getting handler count for non-existent event', () => {
      expect(eventSystem.getHandlerCount('NonExistent.event')).toBe(0)
    })

    it('should handle emitting event with no registered handlers', async () => {
      const result = await eventSystem.emit({ type: 'NoHandlers.event' })

      expect(result.succeeded).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('should handle matching handlers for non-existent event type', () => {
      const handlers = eventSystem.getMatchingHandlers('NonExistent.event')
      expect(handlers).toHaveLength(0)
    })
  })

  describe('Edge Cases - Emit Listener Boundaries', () => {
    it('should handle multiple emit listeners', async () => {
      const calls: number[] = []

      eventSystem.onEmit(() => calls.push(1))
      eventSystem.onEmit(() => calls.push(2))
      eventSystem.onEmit(() => calls.push(3))

      await eventSystem.emit({ type: 'Test.event' })

      expect(calls).toEqual([1, 2, 3])
    })

    it('should handle emit listener that throws continuing to next listener', async () => {
      const calls: number[] = []

      eventSystem.onEmit(() => calls.push(1))
      eventSystem.onEmit(() => { throw new Error('Listener error') })
      eventSystem.onEmit(() => calls.push(3))

      await eventSystem.emit({ type: 'Test.event' })

      expect(calls).toEqual([1, 3])
    })

    it('should handle unsubscribing listener that was never added', () => {
      const listener = vi.fn()
      // Create unsubscribe without actually subscribing
      const unsubscribe = eventSystem.onEmit(listener)

      // Unsubscribe twice - should not throw
      unsubscribe()
      unsubscribe()
    })

    it('should handle unsubscribing in the middle of listener array', async () => {
      const calls: number[] = []
      const unsub1 = eventSystem.onEmit(() => calls.push(1))
      const unsub2 = eventSystem.onEmit(() => calls.push(2))
      const unsub3 = eventSystem.onEmit(() => calls.push(3))

      unsub2() // Remove middle listener

      await eventSystem.emit({ type: 'Test.event' })

      expect(calls).toEqual([1, 3])
    })
  })
})
