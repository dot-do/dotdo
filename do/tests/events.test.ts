import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createOnProxy,
  matchHandlers,
  invokeHandlers,
  getEventTypes,
  getHandlerCount,
  clearHandlers,
  clearAllHandlers,
  type EventHandler,
  type RetryOptions,
  type HandlerResult,
  type InvokeHandlersResult,
} from '../workflow/events'
import { ValidationError, NetworkError, TimeoutError, RateLimitError } from '@dotdo/rpc'

describe('do/workflow/events.ts - Event Handler Functions', () => {
  let handlers: Map<string, EventHandler[]>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    handlers = new Map()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('createOnProxy', () => {
    describe('Basic Registration', () => {
      it('should register handler via $.on.Noun.verb() syntax', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on.Customer.signup(handler)

        expect(handlers.has('Customer.signup')).toBe(true)
        expect(handlers.get('Customer.signup')).toContain(handler)
      })

      it('should support infinite Noun.verb combinations', () => {
        const on = createOnProxy(handlers)

        on.Order.placed(vi.fn())
        on.Invoice.generated(vi.fn())
        on.Subscription.renewed(vi.fn())
        on.Payment.failed(vi.fn())

        expect(handlers.has('Order.placed')).toBe(true)
        expect(handlers.has('Invoice.generated')).toBe(true)
        expect(handlers.has('Subscription.renewed')).toBe(true)
        expect(handlers.has('Payment.failed')).toBe(true)
      })

      it('should support multiple handlers for the same event type', () => {
        const on = createOnProxy(handlers)
        const handler1 = vi.fn()
        const handler2 = vi.fn()
        const handler3 = vi.fn()

        on.Order.placed(handler1)
        on.Order.placed(handler2)
        on.Order.placed(handler3)

        expect(handlers.get('Order.placed')).toHaveLength(3)
        expect(handlers.get('Order.placed')).toContain(handler1)
        expect(handlers.get('Order.placed')).toContain(handler2)
        expect(handlers.get('Order.placed')).toContain(handler3)
      })

      it('should preserve handler registration order', () => {
        const on = createOnProxy(handlers)
        const handler1 = vi.fn()
        const handler2 = vi.fn()
        const handler3 = vi.fn()

        on.Test.event(handler1)
        on.Test.event(handler2)
        on.Test.event(handler3)

        const registeredHandlers = handlers.get('Test.event')!
        expect(registeredHandlers[0]).toBe(handler1)
        expect(registeredHandlers[1]).toBe(handler2)
        expect(registeredHandlers[2]).toBe(handler3)
      })
    })

    describe('Wildcard Registration', () => {
      it('should support verb wildcard (Customer.*)', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on.Customer['*'](handler)

        expect(handlers.has('Customer.*')).toBe(true)
        expect(handlers.get('Customer.*')).toContain(handler)
      })

      it('should support noun wildcard (*.created)', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on['*'].created(handler)

        expect(handlers.has('*.created')).toBe(true)
        expect(handlers.get('*.created')).toContain(handler)
      })

      it('should support global wildcard (*.*)', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on['*']['*'](handler)

        expect(handlers.has('*.*')).toBe(true)
        expect(handlers.get('*.*')).toContain(handler)
      })
    })

    describe('Edge Cases', () => {
      it('should handle very long noun names', () => {
        const on = createOnProxy(handlers)
        const longNoun = 'A'.repeat(1000)
        const handler = vi.fn()

        on[longNoun].event(handler)

        expect(handlers.has(`${longNoun}.event`)).toBe(true)
      })

      it('should handle very long verb names', () => {
        const on = createOnProxy(handlers)
        const longVerb = 'B'.repeat(1000)
        const handler = vi.fn()

        on.Test[longVerb](handler)

        expect(handlers.has(`Test.${longVerb}`)).toBe(true)
      })

      it('should handle special characters in names', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on['Customer-V2'].created(handler)
        on['Order_Item'].placed(vi.fn())
        on['Test123'].action(vi.fn())

        expect(handlers.has('Customer-V2.created')).toBe(true)
        expect(handlers.has('Order_Item.placed')).toBe(true)
        expect(handlers.has('Test123.action')).toBe(true)
      })

      it('should handle unicode characters in names', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on['Kundenservice'].erstellt(handler)

        expect(handlers.has('Kundenservice.erstellt')).toBe(true)
      })

      it('should handle registering same handler function multiple times', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on.Test.event(handler)
        on.Test.event(handler)
        on.Test.event(handler)

        expect(handlers.get('Test.event')).toHaveLength(3)
      })
    })
  })

  describe('matchHandlers', () => {
    describe('Exact Match', () => {
      it('should match exact event type', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on.Customer.signup(handler)

        const matched = matchHandlers('Customer.signup', handlers)
        expect(matched).toContain(handler)
        expect(matched).toHaveLength(1)
      })

      it('should return multiple handlers for exact match', () => {
        const on = createOnProxy(handlers)
        const handler1 = vi.fn()
        const handler2 = vi.fn()

        on.Order.placed(handler1)
        on.Order.placed(handler2)

        const matched = matchHandlers('Order.placed', handlers)
        expect(matched).toContain(handler1)
        expect(matched).toContain(handler2)
        expect(matched).toHaveLength(2)
      })

      it('should return empty array for non-existent event type', () => {
        const matched = matchHandlers('NonExistent.event', handlers)
        expect(matched).toHaveLength(0)
      })
    })

    describe('Wildcard Matching', () => {
      it('should match noun wildcard (Customer.*)', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on.Customer['*'](handler)

        const matched = matchHandlers('Customer.signup', handlers)
        expect(matched).toContain(handler)
      })

      it('should match verb wildcard (*.created)', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on['*'].created(handler)

        const matched = matchHandlers('Order.created', handlers)
        expect(matched).toContain(handler)
      })

      it('should match global wildcard (*.*)', () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on['*']['*'](handler)

        const matched = matchHandlers('Any.event', handlers)
        expect(matched).toContain(handler)
      })

      it('should collect all matching handlers in order', () => {
        const on = createOnProxy(handlers)
        const exactHandler = vi.fn()
        const nounWildcard = vi.fn()
        const verbWildcard = vi.fn()
        const globalWildcard = vi.fn()

        on.Order.placed(exactHandler)
        on.Order['*'](nounWildcard)
        on['*'].placed(verbWildcard)
        on['*']['*'](globalWildcard)

        const matched = matchHandlers('Order.placed', handlers)

        expect(matched).toHaveLength(4)
        // Order: exact, noun wildcard, verb wildcard, global wildcard
        expect(matched[0]).toBe(exactHandler)
        expect(matched[1]).toBe(nounWildcard)
        expect(matched[2]).toBe(verbWildcard)
        expect(matched[3]).toBe(globalWildcard)
      })
    })

    describe('Edge Cases', () => {
      it('should handle event type with no dot separator', () => {
        const on = createOnProxy(handlers)
        const globalHandler = vi.fn()

        on['*']['*'](globalHandler)

        // Event type with no dot - split produces [noun, undefined]
        const matched = matchHandlers('NoDotEvent', handlers)
        expect(matched).toContain(globalHandler)
      })

      it('should handle empty event type', () => {
        const on = createOnProxy(handlers)
        on.Test.event(vi.fn())

        const matched = matchHandlers('', handlers)
        expect(matched).toHaveLength(0)
      })

      it('should handle event type starting with dot', () => {
        const on = createOnProxy(handlers)
        const globalHandler = vi.fn()

        on['*']['*'](globalHandler)

        const matched = matchHandlers('.event', handlers)
        expect(matched).toContain(globalHandler)
      })

      it('should handle event type ending with dot', () => {
        const on = createOnProxy(handlers)
        const globalHandler = vi.fn()

        on['*']['*'](globalHandler)

        const matched = matchHandlers('Noun.', handlers)
        expect(matched).toContain(globalHandler)
      })

      it('should handle event type that is just a dot', () => {
        const on = createOnProxy(handlers)
        const globalHandler = vi.fn()

        on['*']['*'](globalHandler)

        const matched = matchHandlers('.', handlers)
        expect(matched).toContain(globalHandler)
      })
    })
  })

  describe('invokeHandlers', () => {
    describe('Event Emission', () => {
      it('should invoke all matched handlers with event data', async () => {
        const on = createOnProxy(handlers)
        const handler1 = vi.fn()
        const handler2 = vi.fn()

        on.Order.placed(handler1)
        on.Order.placed(handler2)

        const event = { orderId: '123', total: 100 }
        await invokeHandlers('Order.placed', event, handlers)

        expect(handler1).toHaveBeenCalledWith(event)
        expect(handler2).toHaveBeenCalledWith(event)
      })

      it('should return succeeded and failed arrays', async () => {
        const on = createOnProxy(handlers)
        const successHandler = vi.fn()
        const failHandler = vi.fn(() => {
          throw new Error('Handler failed')
        })

        on.Test.event(successHandler)
        on.Test.event(failHandler)

        const result = await invokeHandlers('Test.event', {}, handlers)

        expect(result.succeeded).toHaveLength(1)
        expect(result.failed).toHaveLength(1)
      })

      it('should handle async handlers', async () => {
        const on = createOnProxy(handlers)
        const asyncHandler = vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 10))
        })

        on.Async.test(asyncHandler)

        const result = await invokeHandlers('Async.test', {}, handlers)

        expect(asyncHandler).toHaveBeenCalled()
        expect(result.succeeded).toHaveLength(1)
      })

      it('should invoke handlers in parallel', async () => {
        const on = createOnProxy(handlers)
        const startTimes: number[] = []
        const endTimes: number[] = []

        for (let i = 0; i < 3; i++) {
          on.Parallel.test(async () => {
            startTimes.push(Date.now())
            await new Promise((r) => setTimeout(r, 50))
            endTimes.push(Date.now())
          })
        }

        await invokeHandlers('Parallel.test', {}, handlers)

        // All handlers should have started at roughly the same time
        const maxStartDiff = Math.max(...startTimes) - Math.min(...startTimes)
        expect(maxStartDiff).toBeLessThan(20) // Less than 20ms difference
      })

      it('should continue processing other handlers after one fails', async () => {
        const on = createOnProxy(handlers)
        const results: string[] = []

        on.Test.event(() => results.push('handler-1'))
        on.Test.event(() => {
          throw new Error('fail')
        })
        on.Test.event(() => results.push('handler-3'))

        await invokeHandlers('Test.event', {}, handlers)

        expect(results).toContain('handler-1')
        expect(results).toContain('handler-3')
      })

      it('should return empty arrays when no handlers match', async () => {
        const result = await invokeHandlers('NoHandlers.event', {}, handlers)

        expect(result.succeeded).toHaveLength(0)
        expect(result.failed).toHaveLength(0)
      })
    })

    describe('Event Payload Handling', () => {
      it('should handle undefined event data', async () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on.Test.event(handler)
        await invokeHandlers('Test.event', undefined, handlers)

        expect(handler).toHaveBeenCalledWith(undefined)
      })

      it('should handle null event data', async () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on.Test.event(handler)
        await invokeHandlers('Test.event', null, handlers)

        expect(handler).toHaveBeenCalledWith(null)
      })

      it('should handle complex nested event data', async () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()
        const complexData = {
          user: { id: 1, name: 'Alice', roles: ['admin', 'user'] },
          items: [
            { id: 1, price: 10 },
            { id: 2, price: 20 },
          ],
          metadata: { timestamp: Date.now(), source: 'api' },
        }

        on.Test.event(handler)
        await invokeHandlers('Test.event', complexData, handlers)

        expect(handler).toHaveBeenCalledWith(complexData)
      })

      it('should handle primitive event data', async () => {
        const on = createOnProxy(handlers)
        const handler = vi.fn()

        on.Test.event(handler)

        await invokeHandlers('Test.event', 'string-data', handlers)
        expect(handler).toHaveBeenCalledWith('string-data')

        await invokeHandlers('Test.event', 42, handlers)
        expect(handler).toHaveBeenCalledWith(42)

        await invokeHandlers('Test.event', true, handlers)
        expect(handler).toHaveBeenCalledWith(true)
      })
    })

    describe('Error Handling', () => {
      it('should handle synchronous handler throwing Error', async () => {
        const on = createOnProxy(handlers)
        on.Test.event(() => {
          throw new Error('Sync error')
        })

        const result = await invokeHandlers('Test.event', {}, handlers)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error?.message).toBe('Sync error')
      })

      it('should handle async handler rejecting with Error', async () => {
        const on = createOnProxy(handlers)
        on.Test.event(async () => {
          throw new Error('Async error')
        })

        const result = await invokeHandlers('Test.event', {}, handlers)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error?.message).toBe('Async error')
      })

      it('should handle handler throwing non-Error value (string)', async () => {
        const on = createOnProxy(handlers)
        on.Test.event(() => {
          throw 'string error'
        })

        const result = await invokeHandlers('Test.event', {}, handlers)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error?.message).toBe('string error')
      })

      it('should handle handler throwing non-Error value (number)', async () => {
        const on = createOnProxy(handlers)
        on.Test.event(() => {
          throw 42
        })

        const result = await invokeHandlers('Test.event', {}, handlers)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error?.message).toBe('42')
      })

      it('should handle handler throwing null', async () => {
        const on = createOnProxy(handlers)
        on.Test.event(() => {
          throw null
        })

        const result = await invokeHandlers('Test.event', {}, handlers)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error?.message).toBe('null')
      })

      it('should handle handler throwing undefined', async () => {
        const on = createOnProxy(handlers)
        on.Test.event(() => {
          throw undefined
        })

        const result = await invokeHandlers('Test.event', {}, handlers)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error?.message).toBe('undefined')
      })

      it('should track attempt count for each handler', async () => {
        const on = createOnProxy(handlers)
        on.Test.event(vi.fn())

        const result = await invokeHandlers('Test.event', {}, handlers)

        expect(result.succeeded[0].attempts).toBe(1)
      })
    })

    describe('Retry Behavior', () => {
      it('should NOT retry ValidationError', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          throw new ValidationError('Validation failed', { field: 'test' })
        })

        const result = await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 5,
          initialDelay: 1,
        })

        expect(attempts).toBe(1)
        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].attempts).toBe(1)
      })

      it('should NOT retry errors with retriable=false', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          const error = new Error('Non-retriable error')
          ;(error as any).retriable = false
          throw error
        })

        const result = await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 5,
          initialDelay: 1,
        })

        expect(attempts).toBe(1)
        expect(result.failed).toHaveLength(1)
      })

      it('should retry errors with retriable=true', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          if (attempts < 3) {
            const error = new Error('Transient error')
            ;(error as any).retriable = true
            throw error
          }
        })

        const result = await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 5,
          backoff: 'linear',
          initialDelay: 1,
        })

        expect(attempts).toBe(3)
        expect(result.succeeded).toHaveLength(1)
        expect(result.succeeded[0].attempts).toBe(3)
      })

      it('should retry NetworkError', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          if (attempts < 2) {
            throw new NetworkError('Network failure')
          }
        })

        const result = await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 3,
          backoff: 'linear',
          initialDelay: 1,
        })

        expect(attempts).toBe(2)
        expect(result.succeeded).toHaveLength(1)
      })

      it('should retry TimeoutError', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          if (attempts < 2) {
            throw new TimeoutError('Request timed out')
          }
        })

        const result = await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 3,
          backoff: 'linear',
          initialDelay: 1,
        })

        expect(attempts).toBe(2)
        expect(result.succeeded).toHaveLength(1)
      })

      it('should retry RateLimitError', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          if (attempts < 2) {
            throw new RateLimitError('Rate limit exceeded')
          }
        })

        const result = await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 3,
          backoff: 'linear',
          initialDelay: 1,
        })

        expect(attempts).toBe(2)
        expect(result.succeeded).toHaveLength(1)
      })

      it('should respect maxRetries limit', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          const error = new Error('Always fails')
          ;(error as any).retriable = true
          throw error
        })

        const result = await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 3,
          backoff: 'linear',
          initialDelay: 1,
        })

        expect(attempts).toBe(4) // initial + 3 retries
        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].attempts).toBe(4)
      })

      it('should use default retry options when not specified', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          if (attempts < 3) {
            const error = new Error('Transient')
            ;(error as any).retriable = true
            throw error
          }
        })

        // Default maxRetries is 5, so this should succeed
        const result = await invokeHandlers('Test.event', {}, handlers, {
          initialDelay: 1,
          backoff: 'linear',
        })

        expect(attempts).toBe(3)
        expect(result.succeeded).toHaveLength(1)
      })

      it('should NOT retry generic errors by default', async () => {
        const on = createOnProxy(handlers)
        let attempts = 0

        on.Test.event(() => {
          attempts++
          // Regular Error without retriable flag
          throw new Error('Generic error')
        })

        const result = await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 5,
          initialDelay: 1,
        })

        // Generic errors are not retryable by default
        expect(attempts).toBe(1)
        expect(result.failed).toHaveLength(1)
      })
    })

    describe('Backoff Strategies', () => {
      it('should use exponential backoff by default', async () => {
        const on = createOnProxy(handlers)
        const delays: number[] = []
        let lastTime = Date.now()
        let attempts = 0

        on.Test.event(() => {
          attempts++
          const now = Date.now()
          if (attempts > 1) {
            delays.push(now - lastTime)
          }
          lastTime = now
          if (attempts <= 3) {
            const error = new Error('Transient')
            ;(error as any).retriable = true
            throw error
          }
        })

        await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 5,
          initialDelay: 50,
          backoff: 'exponential',
        })

        // With exponential backoff: 50, 100, 200
        // Allow some tolerance for timing
        expect(delays[0]).toBeGreaterThanOrEqual(40)
        expect(delays[1]).toBeGreaterThanOrEqual(80)
        expect(delays[2]).toBeGreaterThanOrEqual(160)
      })

      it('should use linear backoff when specified', async () => {
        const on = createOnProxy(handlers)
        const delays: number[] = []
        let lastTime = Date.now()
        let attempts = 0

        on.Test.event(() => {
          attempts++
          const now = Date.now()
          if (attempts > 1) {
            delays.push(now - lastTime)
          }
          lastTime = now
          if (attempts <= 3) {
            const error = new Error('Transient')
            ;(error as any).retriable = true
            throw error
          }
        })

        await invokeHandlers('Test.event', {}, handlers, {
          maxRetries: 5,
          initialDelay: 50,
          backoff: 'linear',
        })

        // With linear backoff, all delays should be approximately the same
        for (const delay of delays) {
          expect(delay).toBeGreaterThanOrEqual(40)
          expect(delay).toBeLessThan(100)
        }
      })
    })

    describe('Event Filtering (via matchHandlers)', () => {
      it('should only invoke handlers matching the event type', async () => {
        const on = createOnProxy(handlers)
        const orderHandler = vi.fn()
        const customerHandler = vi.fn()

        on.Order.placed(orderHandler)
        on.Customer.signup(customerHandler)

        await invokeHandlers('Order.placed', {}, handlers)

        expect(orderHandler).toHaveBeenCalled()
        expect(customerHandler).not.toHaveBeenCalled()
      })

      it('should invoke wildcard handlers along with exact matches', async () => {
        const on = createOnProxy(handlers)
        const exactHandler = vi.fn()
        const wildcardHandler = vi.fn()
        const globalHandler = vi.fn()

        on.Order.placed(exactHandler)
        on.Order['*'](wildcardHandler)
        on['*']['*'](globalHandler)

        await invokeHandlers('Order.placed', {}, handlers)

        expect(exactHandler).toHaveBeenCalled()
        expect(wildcardHandler).toHaveBeenCalled()
        expect(globalHandler).toHaveBeenCalled()
      })

      it('should invoke verb wildcard for matching events', async () => {
        const on = createOnProxy(handlers)
        const verbWildcard = vi.fn()

        on['*'].created(verbWildcard)

        await invokeHandlers('Order.created', {}, handlers)
        expect(verbWildcard).toHaveBeenCalledTimes(1)

        await invokeHandlers('Customer.created', {}, handlers)
        expect(verbWildcard).toHaveBeenCalledTimes(2)

        await invokeHandlers('Order.placed', {}, handlers)
        // Should not be called for non-matching verb
        expect(verbWildcard).toHaveBeenCalledTimes(2)
      })
    })

    describe('Concurrent Event Emission', () => {
      it('should handle concurrent emissions of same event type', async () => {
        const on = createOnProxy(handlers)
        const results: number[] = []

        on.Concurrent.test(async (event) => {
          await new Promise((r) => setTimeout(r, Math.random() * 10))
          results.push(event as number)
        })

        await Promise.all([
          invokeHandlers('Concurrent.test', 1, handlers),
          invokeHandlers('Concurrent.test', 2, handlers),
          invokeHandlers('Concurrent.test', 3, handlers),
          invokeHandlers('Concurrent.test', 4, handlers),
          invokeHandlers('Concurrent.test', 5, handlers),
        ])

        expect(results).toHaveLength(5)
        expect(results.sort()).toEqual([1, 2, 3, 4, 5])
      })

      it('should isolate handler failures in concurrent emissions', async () => {
        const on = createOnProxy(handlers)
        const results: string[] = []

        on.Test.event(async (event) => {
          const payload = event as { fail?: boolean; id: string }
          if (payload.fail) {
            throw new Error('Intentional failure')
          }
          results.push(payload.id)
        })

        const emissions = await Promise.all([
          invokeHandlers('Test.event', { id: 'success-1' }, handlers),
          invokeHandlers('Test.event', { id: 'fail', fail: true }, handlers),
          invokeHandlers('Test.event', { id: 'success-2' }, handlers),
        ])

        expect(results).toContain('success-1')
        expect(results).toContain('success-2')
        expect(results).not.toContain('fail')

        expect(emissions[0].succeeded).toHaveLength(1)
        expect(emissions[1].failed).toHaveLength(1)
        expect(emissions[2].succeeded).toHaveLength(1)
      })
    })
  })

  describe('getEventTypes', () => {
    it('should return all registered event types', () => {
      const on = createOnProxy(handlers)

      on.Order.placed(vi.fn())
      on.Customer.signup(vi.fn())
      on.Payment.failed(vi.fn())

      const types = getEventTypes(handlers)

      expect(types).toContain('Order.placed')
      expect(types).toContain('Customer.signup')
      expect(types).toContain('Payment.failed')
      expect(types).toHaveLength(3)
    })

    it('should return empty array when no handlers registered', () => {
      const types = getEventTypes(handlers)
      expect(types).toHaveLength(0)
    })

    it('should include wildcard event types', () => {
      const on = createOnProxy(handlers)

      on['*'].created(vi.fn())
      on.Customer['*'](vi.fn())
      on['*']['*'](vi.fn())

      const types = getEventTypes(handlers)

      expect(types).toContain('*.created')
      expect(types).toContain('Customer.*')
      expect(types).toContain('*.*')
    })
  })

  describe('getHandlerCount', () => {
    it('should return count of handlers for an event type', () => {
      const on = createOnProxy(handlers)

      on.Order.placed(vi.fn())
      on.Order.placed(vi.fn())
      on.Order.placed(vi.fn())

      expect(getHandlerCount('Order.placed', handlers)).toBe(3)
    })

    it('should return 0 for non-existent event type', () => {
      expect(getHandlerCount('NonExistent.event', handlers)).toBe(0)
    })

    it('should return correct count after multiple registrations', () => {
      const on = createOnProxy(handlers)

      on.Test.event(vi.fn())
      expect(getHandlerCount('Test.event', handlers)).toBe(1)

      on.Test.event(vi.fn())
      expect(getHandlerCount('Test.event', handlers)).toBe(2)

      on.Test.event(vi.fn())
      expect(getHandlerCount('Test.event', handlers)).toBe(3)
    })
  })

  describe('clearHandlers', () => {
    it('should clear handlers for a specific event type', () => {
      const on = createOnProxy(handlers)

      on.Order.placed(vi.fn())
      on.Order.placed(vi.fn())
      on.Customer.signup(vi.fn())

      clearHandlers('Order.placed', handlers)

      expect(getHandlerCount('Order.placed', handlers)).toBe(0)
      expect(getHandlerCount('Customer.signup', handlers)).toBe(1)
    })

    it('should not throw when clearing non-existent event type', () => {
      expect(() => clearHandlers('NonExistent.event', handlers)).not.toThrow()
    })

    it('should handle clearing wildcard event types', () => {
      const on = createOnProxy(handlers)

      on['*']['*'](vi.fn())
      on.Order.placed(vi.fn())

      clearHandlers('*.*', handlers)

      expect(getHandlerCount('*.*', handlers)).toBe(0)
      expect(getHandlerCount('Order.placed', handlers)).toBe(1)
    })

    it('should prevent cleared handlers from being invoked', async () => {
      const on = createOnProxy(handlers)
      const handler = vi.fn()

      on.Order.placed(handler)

      clearHandlers('Order.placed', handlers)

      await invokeHandlers('Order.placed', {}, handlers)

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('clearAllHandlers', () => {
    it('should clear all registered handlers', () => {
      const on = createOnProxy(handlers)

      on.Order.placed(vi.fn())
      on.Customer.signup(vi.fn())
      on.Payment.failed(vi.fn())
      on['*']['*'](vi.fn())

      clearAllHandlers(handlers)

      expect(getEventTypes(handlers)).toHaveLength(0)
      expect(getHandlerCount('Order.placed', handlers)).toBe(0)
      expect(getHandlerCount('Customer.signup', handlers)).toBe(0)
      expect(getHandlerCount('Payment.failed', handlers)).toBe(0)
      expect(getHandlerCount('*.*', handlers)).toBe(0)
    })

    it('should not throw when clearing empty handlers map', () => {
      expect(() => clearAllHandlers(handlers)).not.toThrow()
    })

    it('should prevent all handlers from being invoked', async () => {
      const on = createOnProxy(handlers)
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      on.Order.placed(handler1)
      on.Customer.signup(handler2)
      on['*']['*'](handler3)

      clearAllHandlers(handlers)

      await invokeHandlers('Order.placed', {}, handlers)
      await invokeHandlers('Customer.signup', {}, handlers)
      await invokeHandlers('Any.event', {}, handlers)

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).not.toHaveBeenCalled()
      expect(handler3).not.toHaveBeenCalled()
    })
  })

  describe('Type Exports', () => {
    it('should export EventHandler type', () => {
      const handler: EventHandler = vi.fn()
      expect(handler).toBeDefined()
    })

    it('should export RetryOptions type', () => {
      const options: RetryOptions = {
        maxRetries: 5,
        backoff: 'exponential',
        initialDelay: 100,
      }
      expect(options).toBeDefined()
    })

    it('should export HandlerResult type', () => {
      const result: HandlerResult = {
        handler: vi.fn(),
        succeeded: true,
        attempts: 1,
      }
      expect(result).toBeDefined()
    })

    it('should export InvokeHandlersResult type', () => {
      const result: InvokeHandlersResult = {
        succeeded: [],
        failed: [],
      }
      expect(result).toBeDefined()
    })
  })
})
