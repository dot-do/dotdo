import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createOnProxy, invokeHandlers, matchHandlers, type OnProxy, type EventHandler } from '../on'

describe('$.on - Event Handler Proxy', () => {
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

  describe('Handler Invocation', () => {
    it('should invoke registered handlers for matching events', async () => {
      const handler = vi.fn()
      on.Order.placed(handler)

      // Simulate event emission
      const event = { type: 'Order.placed', payload: { orderId: '123' } }
      const registered = handlers.get('Order.placed') || []
      await Promise.all(registered.map(h => h(event)))

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should invoke all registered handlers for same event', async () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      const h3 = vi.fn()

      on.Order.placed(h1)
      on.Order.placed(h2)
      on.Order.placed(h3)

      const event = { type: 'Order.placed', payload: { orderId: '123' } }
      const registered = handlers.get('Order.placed') || []
      await Promise.all(registered.map(h => h(event)))

      expect(h1).toHaveBeenCalledWith(event)
      expect(h2).toHaveBeenCalledWith(event)
      expect(h3).toHaveBeenCalledWith(event)
    })

    it('should support async handlers', async () => {
      const handler = vi.fn(async (event: unknown) => {
        await new Promise(r => setTimeout(r, 10))
        return event
      })

      on.Customer.signup(handler)

      const event = { type: 'Customer.signup', payload: { email: 'test@example.com' } }
      const registered = handlers.get('Customer.signup') || []
      await Promise.all(registered.map(h => h(event)))

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should handle errors in handlers gracefully', async () => {
      const h1 = vi.fn(async () => {
        throw new Error('Handler error')
      })
      const h2 = vi.fn()

      on.Order.placed(h1)
      on.Order.placed(h2)

      const event = { type: 'Order.placed', payload: { orderId: '123' } }
      const registered = handlers.get('Order.placed') || []

      // Errors should not prevent other handlers from running
      const results = await Promise.allSettled(registered.map(h => h(event)))

      expect(results[0].status).toBe('rejected')
      expect(results[1].status).toBe('fulfilled')
      expect(h2).toHaveBeenCalledWith(event)
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
      const event = { type: 'Order.placed', payload: {} }
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
      const h1 = vi.fn(() => { order.push(1); return Promise.resolve() })
      const h2 = vi.fn(() => { order.push(2); return Promise.resolve() })
      const h3 = vi.fn(() => { order.push(3); return Promise.resolve() })

      on.Order.placed(h1)
      on.Order.placed(h2)
      on.Order.placed(h3)

      const registered = handlers.get('Order.placed')
      expect(registered).toEqual([h1, h2, h3])
    })
  })
})

describe('invokeHandlers - Error Handling', () => {
  let handlers: Map<string, EventHandler[]>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    handlers = new Map()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('Error isolation', () => {
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

  describe('Error logging', () => {
    it('should log errors with event type context', async () => {
      const error = new Error('Handler failed')
      const h1 = vi.fn(() => {
        throw error
      })

      handlers.set('Order.placed', [h1])

      await invokeHandlers('Order.placed', { orderId: '123' }, handlers)

      expect(consoleErrorSpy).toHaveBeenCalled()
      const logCall = consoleErrorSpy.mock.calls[0]
      expect(logCall[0]).toContain('Order.placed')
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

  describe('Handler completion', () => {
    it('should wait for all async handlers to complete', async () => {
      const completionOrder: number[] = []

      const h1 = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 30))
        completionOrder.push(1)
      })
      const h2 = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 10))
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

  describe('Wildcard handler errors', () => {
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

  describe('Edge cases', () => {
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
