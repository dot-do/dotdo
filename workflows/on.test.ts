import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  on,
  every,
  send,
  when,
  waitFor,
  Domain,
  getRegisteredHandlers,
  getHandlerRegistrations,
  getHandlerCount,
  getRegisteredEventKeys,
  clearHandlers,
  clearHandlersByContext,
  unregisterHandler,
  type Unsubscribe,
} from './on'

/**
 * Tests for the event-driven workflow DSL
 *
 * on.Customer.signup(customer => { ... })
 * every.Monday.at9am(() => { ... })
 * send.Order.shipped(order)
 */

describe('on.Entity.event', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('event subscription', () => {
    it('on.Customer.signup registers handler', () => {
      const handler = vi.fn()

      on.Customer.signup(handler)

      const handlers = getRegisteredHandlers('Customer.signup')
      expect(handlers).toHaveLength(1)
    })

    it('on.Order.placed registers handler', () => {
      const handler = vi.fn()

      on.Order.placed(handler)

      const handlers = getRegisteredHandlers('Order.placed')
      expect(handlers).toHaveLength(1)
    })

    it('multiple handlers can subscribe to same event', () => {
      on.Customer.signup(() => {})
      on.Customer.signup(() => {})
      on.Customer.signup(() => {})

      const handlers = getRegisteredHandlers('Customer.signup')
      expect(handlers).toHaveLength(3)
    })

    it('different events are independent', () => {
      on.Customer.signup(() => {})
      on.Customer.upgraded(() => {})
      on.Order.placed(() => {})

      expect(getRegisteredHandlers('Customer.signup')).toHaveLength(1)
      expect(getRegisteredHandlers('Customer.upgraded')).toHaveLength(1)
      expect(getRegisteredHandlers('Order.placed')).toHaveLength(1)
    })
  })

  describe('handler execution', () => {
    it('handler receives event payload', () => {
      const handler = vi.fn()
      on.Customer.signup(handler)

      const customer = { id: 'cust-123', email: 'test@example.com.ai' }
      // Simulate event firing
      const handlers = getRegisteredHandlers('Customer.signup')
      handlers[0](customer)

      expect(handler).toHaveBeenCalledWith(customer)
    })
  })
})

describe('Domain calls without $', () => {
  it('Domain(ctx).method() returns PipelinePromise', () => {
    const CRM = Domain('CRM', {
      createAccount: (customer: any) => ({ accountId: '123' }),
    })

    const customer = { id: 'cust-1' }
    const result = CRM(customer).createAccount()

    expect(result.__expr).toBeDefined()
    expect(result.__expr.type).toBe('call')
    expect(result.__expr.domain).toBe('CRM')
    expect(result.__expr.method).toEqual(['createAccount'])
  })

  it('property access on domain result works', () => {
    const CRM = Domain('CRM', {
      createAccount: (customer: any) => ({ accountId: '123' }),
    })

    const customer = { id: 'cust-1' }
    const accountId = CRM(customer).createAccount().accountId

    expect(accountId.__expr.type).toBe('property')
    expect(accountId.__expr.property).toBe('accountId')
  })

  it('domain results can be passed to other domains', () => {
    const CRM = Domain('CRM', {
      createAccount: (customer: any) => ({ id: '123' }),
    })
    const Email = Domain('Email', {
      sendWelcome: (customer: any, data: any) => ({ sent: true }),
    })

    const customer = { id: 'cust-1' }
    const crmAccount = CRM(customer).createAccount()
    const email = Email(customer).sendWelcome({ crmId: crmAccount.id })

    expect(email.__expr.type).toBe('call')
    expect(email.__expr.domain).toBe('Email')
    // The crmId arg should contain a reference to the CRM result
    expect(email.__expr.args[0].crmId.__expr.type).toBe('property')
  })
})

describe('every scheduling', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('fluent API', () => {
    it('every.Monday.at9am registers scheduled handler', () => {
      const handler = vi.fn()

      every.Monday.at9am(handler)

      const scheduled = getRegisteredHandlers('schedule:0 9 * * 1')
      expect(scheduled).toHaveLength(1)
    })

    it('every.day.at6am registers daily handler', () => {
      const handler = vi.fn()

      every.day.at6am(handler)

      const scheduled = getRegisteredHandlers('schedule:0 6 * * *')
      expect(scheduled).toHaveLength(1)
    })

    it('every.hour registers hourly handler', () => {
      const handler = vi.fn()

      every.hour(handler)

      const scheduled = getRegisteredHandlers('schedule:0 * * * *')
      expect(scheduled).toHaveLength(1)
    })
  })

  describe('string API', () => {
    it('every("Monday at 9am", handler) parses correctly', () => {
      const handler = vi.fn()

      every('Monday at 9am', handler)

      const scheduled = getRegisteredHandlers('schedule:0 9 * * 1')
      expect(scheduled).toHaveLength(1)
    })

    it('every("daily at 6am", handler) parses correctly', () => {
      const handler = vi.fn()

      every('daily at 6am', handler)

      const scheduled = getRegisteredHandlers('schedule:0 6 * * *')
      expect(scheduled).toHaveLength(1)
    })
  })
})

describe('send fire-and-forget', () => {
  it('send.Order.shipped returns PipelinePromise', () => {
    const order = { id: 'order-123' }
    const result = send.Order.shipped(order)

    expect(result.__expr).toBeDefined()
    expect(result.__expr.type).toBe('send')
    expect(result.__expr.entity).toBe('Order')
    expect(result.__expr.event).toBe('shipped')
    expect(result.__expr.payload).toBe(order)
  })

  it('send.Customer.churned queues event', () => {
    const customer = { id: 'cust-456' }
    const result = send.Customer.churned(customer)

    expect(result.__expr.type).toBe('send')
    expect(result.__expr.entity).toBe('Customer')
    expect(result.__expr.event).toBe('churned')
  })
})

describe('when conditional', () => {
  it('when returns PipelinePromise', () => {
    const CRM = Domain('CRM', {
      check: () => ({ valid: true }),
    })

    const result = CRM({}).check()
    const conditional = when(result.valid, {
      then: () => ({ status: 'approved' }),
      else: () => ({ status: 'rejected' }),
    })

    expect(conditional.__expr.type).toBe('conditional')
  })
})

describe('waitFor human-in-loop', () => {
  it('waitFor returns PipelinePromise', () => {
    const result = waitFor('manager-approval', { timeout: '7 days' })

    expect(result.__expr).toBeDefined()
    expect(result.__expr.type).toBe('waitFor')
    expect(result.__expr.eventName).toBe('manager-approval')
    expect(result.__expr.options.timeout).toBe('7 days')
  })
})

describe('complete workflow example', () => {
  beforeEach(() => {
    clearHandlers()
  })

  it('on.Customer.signup with domain calls', () => {
    const CRM = Domain('CRM', { createAccount: () => {} })
    const Billing = Domain('Billing', { setupSubscription: () => {} })
    const Email = Domain('Email', { sendWelcome: () => {} })

    on.Customer.signup((customer) => {
      CRM(customer).createAccount()
      Billing(customer).setupSubscription()
      Email(customer).sendWelcome({
        crmId: CRM(customer).createAccount().id,
      })
    })

    expect(getRegisteredHandlers('Customer.signup')).toHaveLength(1)
  })

  it('every.Monday.at9am with AI and notifications', () => {
    const Analytics = Domain('Analytics', { weeklyMetrics: () => {} })
    const AI = Domain('AI', { generateInsights: () => {} })
    const Slack = Domain('Slack', { post: () => {} })

    every.Monday.at9am(() => {
      const metrics = Analytics('sales').weeklyMetrics()
      const insights = AI('analyst').generateInsights({ metrics })
      Slack('#leadership').post({ report: { metrics, insights } })
    })

    expect(getRegisteredHandlers('schedule:0 9 * * 1')).toHaveLength(1)
  })
})

// ============================================================================
// Memory Leak Prevention Tests
// ============================================================================

describe('handler cleanup (memory leak prevention)', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('unsubscribe function', () => {
    it('on.Entity.event returns unsubscribe function', () => {
      const handler = vi.fn()
      const unsubscribe = on.Customer.signup(handler)

      expect(typeof unsubscribe).toBe('function')
    })

    it('calling unsubscribe removes the handler', () => {
      const handler = vi.fn()
      const unsubscribe = on.Customer.signup(handler)

      expect(getRegisteredHandlers('Customer.signup')).toHaveLength(1)

      const result = unsubscribe()

      expect(result).toBe(true)
      expect(getRegisteredHandlers('Customer.signup')).toHaveLength(0)
    })

    it('unsubscribe returns false if handler already removed', () => {
      const handler = vi.fn()
      const unsubscribe = on.Customer.signup(handler)

      unsubscribe()
      const result = unsubscribe()

      expect(result).toBe(false)
    })

    it('unsubscribe only removes the specific handler', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      on.Customer.signup(handler1)
      const unsubscribe2 = on.Customer.signup(handler2)
      on.Customer.signup(handler3)

      expect(getRegisteredHandlers('Customer.signup')).toHaveLength(3)

      unsubscribe2()

      const remaining = getRegisteredHandlers('Customer.signup')
      expect(remaining).toHaveLength(2)
      expect(remaining).toContain(handler1)
      expect(remaining).not.toContain(handler2)
      expect(remaining).toContain(handler3)
    })

    it('every.* returns unsubscribe function', () => {
      const handler = vi.fn()
      const unsubscribe = every.Monday.at9am(handler)

      expect(typeof unsubscribe).toBe('function')
      expect(getRegisteredHandlers('schedule:0 9 * * 1')).toHaveLength(1)

      unsubscribe()

      expect(getRegisteredHandlers('schedule:0 9 * * 1')).toHaveLength(0)
    })

    it('every.hour returns unsubscribe function', () => {
      const handler = vi.fn()
      const unsubscribe = every.hour(handler)

      expect(typeof unsubscribe).toBe('function')
      unsubscribe()
      expect(getRegisteredHandlers('schedule:0 * * * *')).toHaveLength(0)
    })

    it('every(string, handler) returns unsubscribe function', () => {
      const handler = vi.fn()
      const unsubscribe = every('Monday at 9am', handler)

      expect(typeof unsubscribe).toBe('function')
      unsubscribe()
      expect(getRegisteredHandlers('schedule:0 9 * * 1')).toHaveLength(0)
    })
  })

  describe('unregisterHandler function', () => {
    it('removes handler by event key and reference', () => {
      const handler = vi.fn()
      on.Customer.signup(handler)

      const result = unregisterHandler('Customer.signup', handler)

      expect(result).toBe(true)
      expect(getRegisteredHandlers('Customer.signup')).toHaveLength(0)
    })

    it('returns false for non-existent event key', () => {
      const handler = vi.fn()
      const result = unregisterHandler('NonExistent.event', handler)

      expect(result).toBe(false)
    })

    it('returns false for non-registered handler', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      on.Customer.signup(handler1)

      const result = unregisterHandler('Customer.signup', handler2)

      expect(result).toBe(false)
      expect(getRegisteredHandlers('Customer.signup')).toHaveLength(1)
    })
  })

  describe('context-based cleanup', () => {
    it('registers handlers with context', () => {
      const handler = vi.fn()
      on.Customer.signup(handler, { context: 'do:tenant-123' })

      const registrations = getHandlerRegistrations('Customer.signup')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].context).toBe('do:tenant-123')
    })

    it('clearHandlersByContext removes all handlers for a context', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      on.Customer.signup(handler1, { context: 'do:tenant-123' })
      on.Order.placed(handler2, { context: 'do:tenant-123' })
      on.Customer.signup(handler3, { context: 'do:tenant-456' })

      expect(getHandlerCount()).toBe(3)

      const removed = clearHandlersByContext('do:tenant-123')

      expect(removed).toBe(2)
      expect(getHandlerCount()).toBe(1)
      expect(getRegisteredHandlers('Customer.signup')).toHaveLength(1)
      expect(getRegisteredHandlers('Customer.signup')[0]).toBe(handler3)
      expect(getRegisteredHandlers('Order.placed')).toHaveLength(0)
    })

    it('clearHandlersByContext returns 0 for non-existent context', () => {
      on.Customer.signup(vi.fn(), { context: 'do:tenant-123' })

      const removed = clearHandlersByContext('do:non-existent')

      expect(removed).toBe(0)
      expect(getHandlerCount()).toBe(1)
    })

    it('schedule handlers support context cleanup', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      every.Monday.at9am(handler1, { context: 'do:tenant-123' })
      every.hour(handler2, { context: 'do:tenant-123' })

      expect(getHandlerCount()).toBe(2)

      clearHandlersByContext('do:tenant-123')

      expect(getHandlerCount()).toBe(0)
    })

    it('mixed context and non-context handlers', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      on.Customer.signup(handler1) // no context
      on.Customer.signup(handler2, { context: 'do:tenant-123' })
      on.Customer.signup(handler3) // no context

      expect(getHandlerCount()).toBe(3)

      clearHandlersByContext('do:tenant-123')

      expect(getHandlerCount()).toBe(2)
      const handlers = getRegisteredHandlers('Customer.signup')
      expect(handlers).toContain(handler1)
      expect(handlers).not.toContain(handler2)
      expect(handlers).toContain(handler3)
    })
  })

  describe('handler metadata', () => {
    it('getHandlerRegistrations returns metadata', () => {
      const handler = vi.fn()
      on.Customer.signup(handler, { context: 'test-context' })

      const registrations = getHandlerRegistrations('Customer.signup')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].handler).toBe(handler)
      expect(registrations[0].eventKey).toBe('Customer.signup')
      expect(registrations[0].context).toBe('test-context')
      expect(registrations[0].registeredAt).toBeGreaterThan(0)
    })

    it('getHandlerCount returns total handler count', () => {
      on.Customer.signup(vi.fn())
      on.Customer.signup(vi.fn())
      on.Order.placed(vi.fn())

      expect(getHandlerCount()).toBe(3)
    })

    it('getRegisteredEventKeys returns all event keys', () => {
      on.Customer.signup(vi.fn())
      on.Order.placed(vi.fn())
      on.Payment.failed(vi.fn())

      const keys = getRegisteredEventKeys()
      expect(keys).toHaveLength(3)
      expect(keys).toContain('Customer.signup')
      expect(keys).toContain('Order.placed')
      expect(keys).toContain('Payment.failed')
    })
  })

  describe('memory leak scenario simulation', () => {
    it('simulates DO lifecycle with proper cleanup', () => {
      // Simulate multiple DO instances registering handlers
      const do1Context = 'do:instance-1'
      const do2Context = 'do:instance-2'

      // DO 1 registers handlers
      on.Customer.signup(vi.fn(), { context: do1Context })
      on.Order.placed(vi.fn(), { context: do1Context })
      every.hour(vi.fn(), { context: do1Context })

      // DO 2 registers handlers
      on.Customer.signup(vi.fn(), { context: do2Context })
      on.Payment.received(vi.fn(), { context: do2Context })

      expect(getHandlerCount()).toBe(5)

      // DO 1 is destroyed - clean up its handlers
      const removed1 = clearHandlersByContext(do1Context)
      expect(removed1).toBe(3)
      expect(getHandlerCount()).toBe(2)

      // DO 2 is destroyed - clean up its handlers
      const removed2 = clearHandlersByContext(do2Context)
      expect(removed2).toBe(2)
      expect(getHandlerCount()).toBe(0)
    })

    it('handlers without context are not affected by context cleanup', () => {
      // Global handlers (no context)
      on.System.startup(vi.fn())
      on.System.shutdown(vi.fn())

      // DO-scoped handlers
      on.Customer.signup(vi.fn(), { context: 'do:temp' })

      expect(getHandlerCount()).toBe(3)

      clearHandlersByContext('do:temp')

      expect(getHandlerCount()).toBe(2)
      expect(getRegisteredHandlers('System.startup')).toHaveLength(1)
      expect(getRegisteredHandlers('System.shutdown')).toHaveLength(1)
    })

    it('stress test: register and cleanup many handlers', () => {
      const contexts = Array.from({ length: 100 }, (_, i) => `do:instance-${i}`)

      // Register 10 handlers per context = 1000 total
      for (const ctx of contexts) {
        for (let i = 0; i < 10; i++) {
          on.Customer.signup(vi.fn(), { context: ctx })
        }
      }

      expect(getHandlerCount()).toBe(1000)

      // Clean up all contexts
      for (const ctx of contexts) {
        clearHandlersByContext(ctx)
      }

      expect(getHandlerCount()).toBe(0)
      expect(getRegisteredEventKeys()).toHaveLength(0)
    })
  })
})
