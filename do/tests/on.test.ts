import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOnProxy, type OnProxy } from '../on'

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
