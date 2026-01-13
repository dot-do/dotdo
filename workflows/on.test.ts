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

// ============================================================================
// Wildcard Event Handlers
// ============================================================================

describe('wildcard event handlers', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('*.verb pattern - all nouns with specific verb', () => {
    it('on.*.created registers handler for wildcard noun', () => {
      const handler = vi.fn()

      on['*'].created(handler)

      const handlers = getRegisteredHandlers('*.created')
      expect(handlers).toHaveLength(1)
      expect(handlers[0]).toBe(handler)
    })

    it('multiple wildcard handlers can be registered', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      on['*'].created(handler1)
      on['*'].updated(handler2)

      expect(getRegisteredHandlers('*.created')).toHaveLength(1)
      expect(getRegisteredHandlers('*.updated')).toHaveLength(1)
    })

    it('wildcard handlers coexist with specific handlers', () => {
      const wildcardHandler = vi.fn()
      const specificHandler = vi.fn()

      on['*'].created(wildcardHandler)
      on.Customer.created(specificHandler)

      expect(getRegisteredHandlers('*.created')).toHaveLength(1)
      expect(getRegisteredHandlers('Customer.created')).toHaveLength(1)
    })
  })

  describe('Noun.* pattern - all verbs for specific noun', () => {
    it('on.Customer.* registers handler for wildcard verb', () => {
      const handler = vi.fn()

      on.Customer['*'](handler)

      const handlers = getRegisteredHandlers('Customer.*')
      expect(handlers).toHaveLength(1)
      expect(handlers[0]).toBe(handler)
    })
  })

  describe('*.* pattern - global handler', () => {
    it('on.*.* registers global wildcard handler', () => {
      const handler = vi.fn()

      on['*']['*'](handler)

      const handlers = getRegisteredHandlers('*.*')
      expect(handlers).toHaveLength(1)
    })
  })

  describe('wildcard handler cleanup', () => {
    it('wildcard handlers return unsubscribe function', () => {
      const handler = vi.fn()
      const unsubscribe = on['*'].created(handler)

      expect(typeof unsubscribe).toBe('function')
      expect(getRegisteredHandlers('*.created')).toHaveLength(1)

      unsubscribe()

      expect(getRegisteredHandlers('*.created')).toHaveLength(0)
    })

    it('wildcard handlers support context cleanup', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      on['*'].created(handler1, { context: 'do:tenant-1' })
      on['*'].created(handler2, { context: 'do:tenant-2' })

      expect(getHandlerCount()).toBe(2)

      clearHandlersByContext('do:tenant-1')

      expect(getHandlerCount()).toBe(1)
      expect(getRegisteredHandlers('*.created')).toHaveLength(1)
      expect(getRegisteredHandlers('*.created')[0]).toBe(handler2)
    })
  })
})

// ============================================================================
// Handler Execution Patterns
// ============================================================================

describe('handler execution patterns', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('synchronous handlers', () => {
    it('handler receives event payload directly', () => {
      const handler = vi.fn()
      on.Order.placed(handler)

      const order = { id: 'ord-123', items: ['item-1', 'item-2'] }
      const handlers = getRegisteredHandlers('Order.placed')
      handlers[0](order)

      expect(handler).toHaveBeenCalledWith(order)
    })

    it('handler can return a value', () => {
      const handler = vi.fn().mockReturnValue({ processed: true })
      on.Order.placed(handler)

      const handlers = getRegisteredHandlers('Order.placed')
      const result = handlers[0]({ id: 'ord-123' })

      expect(result).toEqual({ processed: true })
    })

    it('multiple handlers execute in registration order', () => {
      const executionOrder: number[] = []
      const handler1 = vi.fn(() => executionOrder.push(1))
      const handler2 = vi.fn(() => executionOrder.push(2))
      const handler3 = vi.fn(() => executionOrder.push(3))

      on.Customer.signup(handler1)
      on.Customer.signup(handler2)
      on.Customer.signup(handler3)

      const handlers = getRegisteredHandlers('Customer.signup')
      handlers.forEach(h => h({ id: 'cust-1' }))

      expect(executionOrder).toEqual([1, 2, 3])
    })
  })

  describe('asynchronous handlers', () => {
    it('async handler can be registered and called', async () => {
      const handler = vi.fn(async (event: { id: string }) => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return { id: event.id, processed: true }
      })

      on.Payment.received(handler)

      const handlers = getRegisteredHandlers('Payment.received')
      const result = await handlers[0]({ id: 'pay-123' })

      expect(result).toEqual({ id: 'pay-123', processed: true })
    })

    it('multiple async handlers can run concurrently', async () => {
      const startTimes: number[] = []
      const endTimes: number[] = []

      const createSlowHandler = (delay: number, index: number) => {
        return vi.fn(async () => {
          startTimes.push(Date.now())
          await new Promise(resolve => setTimeout(resolve, delay))
          endTimes.push(Date.now())
          return index
        })
      }

      on.Task.started(createSlowHandler(50, 1))
      on.Task.started(createSlowHandler(50, 2))
      on.Task.started(createSlowHandler(50, 3))

      const handlers = getRegisteredHandlers('Task.started')
      const start = Date.now()

      // Run concurrently
      await Promise.all(handlers.map(h => h({})))

      const totalTime = Date.now() - start

      // If run sequentially, would take ~150ms. Concurrently should be ~50ms
      expect(totalTime).toBeLessThan(100)
    })
  })

  describe('handler with typed events', () => {
    it('handler receives typed domain event structure', () => {
      interface CustomerEvent {
        id: string
        verb: string
        source: string
        data: { customerId: string; email: string }
        timestamp: Date
      }

      const handler = vi.fn<[CustomerEvent], void>()
      on.Customer.created(handler)

      const event: CustomerEvent = {
        id: 'evt-123',
        verb: 'created',
        source: 'https://api.example.com.ai/customers',
        data: { customerId: 'cust-1', email: 'test@example.com.ai' },
        timestamp: new Date(),
      }

      const handlers = getRegisteredHandlers('Customer.created')
      handlers[0](event)

      expect(handler).toHaveBeenCalledWith(event)
      expect(handler.mock.calls[0][0].data.customerId).toBe('cust-1')
    })
  })
})

// ============================================================================
// Event Filtering (via handler logic)
// ============================================================================

describe('event filtering patterns', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('filter by event properties', () => {
    it('handler can filter events by data properties', () => {
      const vipHandler = vi.fn()
      const standardHandler = vi.fn()

      // VIP handler only processes VIP customers
      const vipFilter = (event: { data: { tier: string } }) => {
        if (event.data.tier === 'vip') {
          vipHandler(event)
        }
      }

      // Standard handler processes all
      const standardFilter = (event: { data: { tier: string } }) => {
        standardHandler(event)
      }

      on.Customer.created(vipFilter)
      on.Customer.created(standardFilter)

      const handlers = getRegisteredHandlers('Customer.created')

      // Standard customer
      handlers.forEach(h => h({ data: { tier: 'standard', id: 'cust-1' } }))
      expect(vipHandler).not.toHaveBeenCalled()
      expect(standardHandler).toHaveBeenCalledTimes(1)

      // VIP customer
      handlers.forEach(h => h({ data: { tier: 'vip', id: 'cust-2' } }))
      expect(vipHandler).toHaveBeenCalledTimes(1)
      expect(standardHandler).toHaveBeenCalledTimes(2)
    })

    it('handler can filter by amount threshold', () => {
      const highValueHandler = vi.fn()
      const processed: string[] = []

      const amountFilter = (event: { data: { amount: number; id: string } }) => {
        if (event.data.amount >= 1000) {
          highValueHandler(event)
          processed.push(event.data.id)
        }
      }

      on.Order.placed(amountFilter)

      const handlers = getRegisteredHandlers('Order.placed')
      handlers[0]({ data: { amount: 500, id: 'ord-1' } })
      handlers[0]({ data: { amount: 1500, id: 'ord-2' } })
      handlers[0]({ data: { amount: 999, id: 'ord-3' } })
      handlers[0]({ data: { amount: 1000, id: 'ord-4' } })

      expect(highValueHandler).toHaveBeenCalledTimes(2)
      expect(processed).toEqual(['ord-2', 'ord-4'])
    })
  })

  describe('filter by event source', () => {
    it('handler can filter by source domain', () => {
      const adminHandler = vi.fn()

      const sourceFilter = (event: { source: string }) => {
        if (event.source.includes('admin')) {
          adminHandler(event)
        }
      }

      on.User.updated(sourceFilter)

      const handlers = getRegisteredHandlers('User.updated')
      handlers[0]({ source: 'https://api.example.com.ai/users/123' })
      handlers[0]({ source: 'https://admin.example.com.ai/users/456' })

      expect(adminHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('composite filters', () => {
    it('handler can combine multiple filter conditions', () => {
      const targetedHandler = vi.fn()

      interface Event {
        source: string
        data: { amount: number; region: string }
      }

      const compositeFilter = (event: Event) => {
        const isAdmin = event.source.includes('admin')
        const isHighValue = event.data.amount > 1000
        const isUSRegion = event.data.region === 'US'

        if (isAdmin && isHighValue && isUSRegion) {
          targetedHandler(event)
        }
      }

      on.Transaction.processed(compositeFilter)

      const handlers = getRegisteredHandlers('Transaction.processed')

      // Does not match - not admin
      handlers[0]({ source: 'https://api.do', data: { amount: 2000, region: 'US' } })

      // Does not match - low value
      handlers[0]({ source: 'https://admin.do', data: { amount: 500, region: 'US' } })

      // Does not match - wrong region
      handlers[0]({ source: 'https://admin.do', data: { amount: 2000, region: 'EU' } })

      // Matches all conditions
      handlers[0]({ source: 'https://admin.do', data: { amount: 2000, region: 'US' } })

      expect(targetedHandler).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// Error Handling
// ============================================================================

describe('error handling', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('synchronous handler errors', () => {
    it('throwing handler propagates error to caller', () => {
      const failingHandler = vi.fn(() => {
        throw new Error('Handler failed')
      })

      on.Order.placed(failingHandler)

      const handlers = getRegisteredHandlers('Order.placed')
      expect(() => handlers[0]({})).toThrow('Handler failed')
    })

    it('one failing handler does not prevent registration of others', () => {
      const failingHandler = vi.fn(() => {
        throw new Error('I fail')
      })
      const successHandler = vi.fn()

      on.Order.placed(failingHandler)
      on.Order.placed(successHandler)

      const handlers = getRegisteredHandlers('Order.placed')
      expect(handlers).toHaveLength(2)
    })

    it('caller can catch and continue with remaining handlers', () => {
      const results: string[] = []

      const handler1 = vi.fn(() => {
        results.push('handler1-start')
        throw new Error('handler1 failed')
      })
      const handler2 = vi.fn(() => {
        results.push('handler2-success')
      })
      const handler3 = vi.fn(() => {
        results.push('handler3-success')
      })

      on.Event.triggered(handler1)
      on.Event.triggered(handler2)
      on.Event.triggered(handler3)

      const handlers = getRegisteredHandlers('Event.triggered')
      const errors: Error[] = []

      for (const handler of handlers) {
        try {
          handler({})
        } catch (e) {
          errors.push(e as Error)
        }
      }

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('handler1 failed')
      expect(results).toEqual(['handler1-start', 'handler2-success', 'handler3-success'])
    })
  })

  describe('asynchronous handler errors', () => {
    it('async handler rejection propagates to caller', async () => {
      const asyncFailingHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 1))
        throw new Error('Async handler failed')
      })

      on.Payment.processed(asyncFailingHandler)

      const handlers = getRegisteredHandlers('Payment.processed')
      await expect(handlers[0]({})).rejects.toThrow('Async handler failed')
    })

    it('Promise.allSettled can handle mixed success/failure', async () => {
      const handler1 = vi.fn(async () => 'success-1')
      const handler2 = vi.fn(async () => {
        throw new Error('failed-2')
      })
      const handler3 = vi.fn(async () => 'success-3')

      on.Batch.processed(handler1)
      on.Batch.processed(handler2)
      on.Batch.processed(handler3)

      const handlers = getRegisteredHandlers('Batch.processed')
      const results = await Promise.allSettled(handlers.map(h => h({})))

      expect(results[0]).toEqual({ status: 'fulfilled', value: 'success-1' })
      expect(results[1]).toMatchObject({ status: 'rejected' })
      expect(results[2]).toEqual({ status: 'fulfilled', value: 'success-3' })
    })
  })

  describe('error context preservation', () => {
    it('error includes handler context when available', () => {
      const handler = vi.fn(() => {
        const error = new Error('Processing failed')
        ;(error as any).eventKey = 'Order.placed'
        ;(error as any).handlerId = 'order-handler-1'
        throw error
      })

      on.Order.placed(handler)

      const handlers = getRegisteredHandlers('Order.placed')
      try {
        handlers[0]({ id: 'ord-123' })
      } catch (e: any) {
        expect(e.eventKey).toBe('Order.placed')
        expect(e.handlerId).toBe('order-handler-1')
      }
    })
  })

  describe('handler isolation', () => {
    it('handlers do not share mutable state unexpectedly', () => {
      const sharedState = { count: 0 }

      const handler1 = vi.fn(() => {
        sharedState.count++
        return sharedState.count
      })
      const handler2 = vi.fn(() => {
        sharedState.count += 10
        return sharedState.count
      })

      on.Counter.incremented(handler1)
      on.Counter.incremented(handler2)

      const handlers = getRegisteredHandlers('Counter.incremented')
      const result1 = handlers[0]({})
      const result2 = handlers[1]({})

      // Handlers DO share state if they reference the same object
      // This test documents the behavior
      expect(result1).toBe(1)
      expect(result2).toBe(11)
      expect(sharedState.count).toBe(11)
    })

    it('handler registration does not execute handler', () => {
      const handler = vi.fn()

      on.Customer.signup(handler)
      on.Customer.signup(handler)
      on.Customer.signup(handler)

      // Registration should not call the handler
      expect(handler).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Edge Cases and Boundary Conditions
// ============================================================================

describe('edge cases', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('empty and null values', () => {
    it('handler can receive empty object', () => {
      const handler = vi.fn()
      on.Event.empty(handler)

      const handlers = getRegisteredHandlers('Event.empty')
      handlers[0]({})

      expect(handler).toHaveBeenCalledWith({})
    })

    it('handler can receive null payload', () => {
      const handler = vi.fn()
      on.Event.nullable(handler)

      const handlers = getRegisteredHandlers('Event.nullable')
      handlers[0](null)

      expect(handler).toHaveBeenCalledWith(null)
    })

    it('handler can receive undefined payload', () => {
      const handler = vi.fn()
      on.Event.undefined(handler)

      const handlers = getRegisteredHandlers('Event.undefined')
      handlers[0](undefined)

      expect(handler).toHaveBeenCalledWith(undefined)
    })
  })

  describe('special event names', () => {
    it('event name with numbers', () => {
      const handler = vi.fn()
      on.Event123.action456(handler)

      expect(getRegisteredHandlers('Event123.action456')).toHaveLength(1)
    })

    it('event name with underscores', () => {
      const handler = vi.fn()
      on.my_event.my_action(handler)

      expect(getRegisteredHandlers('my_event.my_action')).toHaveLength(1)
    })

    it('event name with camelCase', () => {
      const handler = vi.fn()
      on.myCustomEvent.myCustomAction(handler)

      expect(getRegisteredHandlers('myCustomEvent.myCustomAction')).toHaveLength(1)
    })

    it('event name with PascalCase', () => {
      const handler = vi.fn()
      on.MyCustomEvent.MyCustomAction(handler)

      expect(getRegisteredHandlers('MyCustomEvent.MyCustomAction')).toHaveLength(1)
    })
  })

  describe('handler reference equality', () => {
    it('same function registered twice creates two entries', () => {
      const handler = vi.fn()

      on.Event.test(handler)
      on.Event.test(handler)

      expect(getRegisteredHandlers('Event.test')).toHaveLength(2)
    })

    it('unsubscribe only removes specific registration', () => {
      const handler = vi.fn()

      const unsub1 = on.Event.test(handler)
      on.Event.test(handler)

      unsub1()

      // One registration should remain
      expect(getRegisteredHandlers('Event.test')).toHaveLength(1)
    })
  })

  describe('high volume scenarios', () => {
    it('handles many different event keys', () => {
      const handlers: Function[] = []

      for (let i = 0; i < 100; i++) {
        const handler = vi.fn()
        handlers.push(handler)
        on[`Entity${i}`][`action${i}`](handler)
      }

      expect(getRegisteredEventKeys()).toHaveLength(100)
      expect(getHandlerCount()).toBe(100)
    })

    it('handles many handlers per event key', () => {
      for (let i = 0; i < 100; i++) {
        on.SingleEvent.action(vi.fn())
      }

      expect(getRegisteredHandlers('SingleEvent.action')).toHaveLength(100)
    })
  })
})

// ============================================================================
// Proxy-based API Tests
// ============================================================================

describe('Proxy-based API behavior', () => {
  beforeEach(() => {
    clearHandlers()
  })

  describe('on proxy mechanics', () => {
    it('on is a Proxy object', () => {
      // Access any property dynamically
      const customerProxy = on.Customer
      expect(customerProxy).toBeDefined()

      const signupFn = customerProxy.signup
      expect(typeof signupFn).toBe('function')
    })

    it('property access creates nested proxy', () => {
      const entityProxy = on.SomeNewEntity
      expect(entityProxy).toBeDefined()

      const verbProxy = entityProxy.someNewVerb
      expect(typeof verbProxy).toBe('function')
    })

    it('any noun/verb combination is valid', () => {
      const handler = vi.fn()

      // Arbitrary noun/verb combinations work
      on.AnyEntity.anyAction(handler)
      on.FooBar.bazQux(handler)
      on.X.y(handler)

      expect(getRegisteredEventKeys()).toContain('AnyEntity.anyAction')
      expect(getRegisteredEventKeys()).toContain('FooBar.bazQux')
      expect(getRegisteredEventKeys()).toContain('X.y')
    })
  })

  describe('every proxy mechanics', () => {
    it('every.day returns time proxy', () => {
      const dayProxy = every.day
      expect(dayProxy).toBeDefined()

      // Can call time methods
      const unsub = dayProxy.at9am(vi.fn())
      expect(typeof unsub).toBe('function')
    })

    it('every.hour is directly callable', () => {
      const unsub = every.hour(vi.fn())
      expect(typeof unsub).toBe('function')
      expect(getRegisteredHandlers('schedule:0 * * * *')).toHaveLength(1)
    })

    it('every.minute is directly callable', () => {
      const unsub = every.minute(vi.fn())
      expect(typeof unsub).toBe('function')
      expect(getRegisteredHandlers('schedule:* * * * *')).toHaveLength(1)
    })
  })

  describe('send proxy mechanics', () => {
    it('send.Entity.event returns PipelinePromise', () => {
      const result = send.AnyEntity.anyEvent({ data: 'test' })

      expect(result).toBeDefined()
      expect(result.__expr).toBeDefined()
      expect(result.__isPipelinePromise).toBe(true)
    })

    it('send captures entity, event, and payload', () => {
      const payload = { id: 'test-123', value: 42 }
      const result = send.MyEntity.myEvent(payload)

      expect(result.__expr.type).toBe('send')
      expect(result.__expr.entity).toBe('MyEntity')
      expect(result.__expr.event).toBe('myEvent')
      expect(result.__expr.payload).toBe(payload)
    })
  })
})
