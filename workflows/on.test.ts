import { describe, it, expect, vi, beforeEach } from 'vitest'
import { on, every, send, when, waitFor, Domain, getRegisteredHandlers, clearHandlers } from './on'

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

      const customer = { id: 'cust-123', email: 'test@example.com' }
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
