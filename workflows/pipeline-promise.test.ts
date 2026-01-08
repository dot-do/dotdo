import { describe, it, expect, vi } from 'vitest'
import { createWorkflowProxy, PipelinePromise, isPipelinePromise, collectExpressions, analyzeExpressions } from './pipeline-promise'

/**
 * Tests for Capnweb-style PipelinePromise System
 *
 * Key behaviors:
 * 1. No await needed - operations return PipelinePromises
 * 2. Property access on unresolved values works
 * 3. Magic map via record-replay
 * 4. Automatic batching of independent operations
 */

describe('PipelinePromise', () => {
  /**
   * Basic pipeline creation - no immediate execution
   */
  describe('deferred execution', () => {
    it('$.Domain(ctx).method() returns PipelinePromise, not regular Promise', () => {
      const $ = createWorkflowProxy()

      const result = $.Inventory({ sku: 'ABC' }).check()

      // Should be PipelinePromise, not plain Promise
      expect(isPipelinePromise(result)).toBe(true)
    })

    it('does NOT execute immediately on method call', () => {
      const executeSpy = vi.fn()
      const $ = createWorkflowProxy({ onExecute: executeSpy })

      $.Inventory({ sku: 'ABC' }).check()

      // Nothing should have executed yet
      expect(executeSpy).not.toHaveBeenCalled()
    })

    it('captures the pipeline expression for later execution', () => {
      const $ = createWorkflowProxy()

      const pipeline = $.Inventory({ sku: 'ABC' }).check()

      // Should have captured expression
      expect(pipeline.__expr).toEqual({
        type: 'call',
        domain: 'Inventory',
        method: ['check'],
        context: { sku: 'ABC' },
        args: [],
      })
    })

    it('captures method arguments in expression', () => {
      const $ = createWorkflowProxy()

      const pipeline = $.Inventory({ sku: 'ABC' }).reserve({ quantity: 5 })

      expect(pipeline.__expr.args).toEqual([{ quantity: 5 }])
    })
  })

  /**
   * Property access on unresolved values
   */
  describe('property access on unresolved values', () => {
    it('result.property returns PipelinePromise', () => {
      const $ = createWorkflowProxy()

      const crm = $.CRM({ id: 'customer-1' }).createAccount()
      const crmId = crm.id

      expect(isPipelinePromise(crmId)).toBe(true)
    })

    it('captures property path in expression', () => {
      const $ = createWorkflowProxy()

      const crm = $.CRM({ id: 'customer-1' }).createAccount()
      const crmId = crm.id

      expect(crmId.__expr).toEqual({
        type: 'property',
        base: crm.__expr,
        property: 'id',
      })
    })

    it('supports deep property access chains', () => {
      const $ = createWorkflowProxy()

      const result = $.Config({ app: 'myapp' }).load()
      const theme = result.settings.ui.theme

      expect(theme.__expr).toEqual({
        type: 'property',
        base: {
          type: 'property',
          base: {
            type: 'property',
            base: result.__expr,
            property: 'settings',
          },
          property: 'ui',
        },
        property: 'theme',
      })
    })

    it('unresolved properties can be passed as arguments to other calls', () => {
      const $ = createWorkflowProxy()

      const order = $.Orders({ customer: 'cust-1' }).create({ items: [] })
      const payment = $.Payment({ orderId: order.id }).process()

      // The payment expression should reference order.id
      expect(payment.__expr.context.orderId.__expr).toBeDefined()
      expect(payment.__expr.context.orderId.__expr.property).toBe('id')
    })
  })

  /**
   * Thenable interface for backward compatibility
   */
  describe('thenable interface', () => {
    it('PipelinePromise is thenable (has .then)', () => {
      const $ = createWorkflowProxy()

      const pipeline = $.Inventory({ sku: 'ABC' }).check()

      expect(typeof pipeline.then).toBe('function')
    })

    it('can be awaited (triggers execution)', async () => {
      const executeFn = vi.fn().mockResolvedValue({ available: true, quantity: 10 })
      const $ = createWorkflowProxy({ execute: executeFn })

      const result = await $.Inventory({ sku: 'ABC' }).check()

      expect(executeFn).toHaveBeenCalled()
      expect(result).toEqual({ available: true, quantity: 10 })
    })

    it('.then() returns another PipelinePromise for chaining', () => {
      // Provide a dummy execute function to avoid unhandled rejection
      const $ = createWorkflowProxy({ execute: async () => ({ dummy: true }) })

      const pipeline = $.Inventory({ sku: 'ABC' }).check()
      const chained = pipeline.then((result) => result)

      expect(isPipelinePromise(chained)).toBe(true)
    })
  })

  /**
   * Magic map with record-replay
   */
  describe('magic map (record-replay)', () => {
    it('array.map() returns PipelinePromise', () => {
      const $ = createWorkflowProxy()

      const items = $.Cart({ id: 'cart-1' }).getItems()
      const checked = items.map((item) => $.Inventory(item.product).check())

      expect(isPipelinePromise(checked)).toBe(true)
    })

    it('captures map expression with mapper instructions', () => {
      const $ = createWorkflowProxy()

      const items = $.Cart({ id: 'cart-1' }).getItems()
      const checked = items.map((item) => $.Inventory(item.product).check())

      expect(checked.__expr.type).toBe('map')
      expect(checked.__expr.array).toBe(items.__expr)
      expect(checked.__expr.mapper).toBeDefined()
    })

    it('records operations without executing callback multiple times', () => {
      const callbackSpy = vi.fn((item) => $.Inventory(item.product).check())
      const $ = createWorkflowProxy()

      const items = $.Cart({ id: 'cart-1' }).getItems()
      items.map(callbackSpy)

      // Callback should run exactly once (recording phase)
      expect(callbackSpy).toHaveBeenCalledTimes(1)
    })

    it('callback receives placeholder with property access', () => {
      const $ = createWorkflowProxy()
      let receivedItem: any

      const items = $.Cart({ id: 'cart-1' }).getItems()
      items.map((item) => {
        receivedItem = item
        return $.Inventory(item.product).check()
      })

      // Item should be a special placeholder proxy
      expect(receivedItem).toBeDefined()
      expect(isPipelinePromise(receivedItem.product)).toBe(true)
    })

    it('nested map operations are supported', () => {
      const $ = createWorkflowProxy()

      const orders = $.Orders({ customer: 'cust-1' }).list()
      const itemCounts = orders.map((order) => order.items.map((item) => $.Inventory(item.sku).count()))

      expect(isPipelinePromise(itemCounts)).toBe(true)
      expect(itemCounts.__expr.type).toBe('map')
    })
  })

  /**
   * Expression collection for workflow analysis
   */
  describe('expression collection', () => {
    it('collectExpressions finds all pipeline expressions in return value', () => {
      const $ = createWorkflowProxy()

      const crm = $.CRM({ id: 'cust-1' }).createAccount()
      const billing = $.Billing({ id: 'cust-1' }).setup()

      const returnValue = {
        crmId: crm.id,
        billingId: billing.id,
        combined: { crm: crm.data, billing: billing.data },
      }

      const expressions = collectExpressions(returnValue)

      // Should find all 4 pipeline expressions
      expect(expressions.length).toBe(4)
    })

    it('collectExpressions handles nested objects and arrays', () => {
      const $ = createWorkflowProxy()

      const results = [$.Service1({}).call(), $.Service2({}).call(), { nested: $.Service3({}).call() }]

      const expressions = collectExpressions(results)

      expect(expressions.length).toBe(3)
    })

    it('identifies dependencies between expressions', () => {
      const $ = createWorkflowProxy()

      const order = $.Orders({}).create({ items: [] })
      const payment = $.Payment({ orderId: order.id }).process()

      const expressions = collectExpressions({ order, payment })

      // payment depends on order (uses order.id)
      const paymentExpr = expressions.find((e) => e.__expr.domain === 'Payment')
      expect(paymentExpr.__expr.context.orderId.__expr.base).toBe(order.__expr)
    })
  })

  /**
   * Automatic batching
   */
  describe('automatic batching', () => {
    it('independent expressions can be identified for parallel execution', () => {
      const $ = createWorkflowProxy()

      const crm = $.CRM({}).createAccount()
      const billing = $.Billing({}).setup()
      const support = $.Support({}).createTicket()

      const { independent, dependent } = analyzeExpressions([crm, billing, support])

      // All three are independent (no dependencies on each other)
      expect(independent.length).toBe(3)
      expect(dependent.length).toBe(0)
    })

    it('dependent expressions are identified for sequential execution', () => {
      const $ = createWorkflowProxy()

      const order = $.Orders({}).create({ items: [] })
      const payment = $.Payment({ orderId: order.id }).process()

      const { independent, dependent } = analyzeExpressions([order, payment])

      // order is independent, payment depends on order
      expect(independent.length).toBe(1)
      expect(dependent.length).toBe(1)
    })
  })
})

/**
 * Example workflows demonstrating the no-await pattern
 */
describe('Example Workflows (no async/await)', () => {
  describe('OnboardingWorkflow', () => {
    it('captures all operations without execution', () => {
      const $ = createWorkflowProxy()

      // This is the actual workflow - NO async, NO await
      const OnboardingWorkflow = ($: any, customer: any) => {
        const crm = $.CRM(customer).createAccount()
        const billing = $.Billing(customer).setupSubscription()
        const support = $.Support(customer).createTicketQueue()
        const analytics = $.Analytics(customer).initializeTracking()

        // Property access on unresolved values
        $.Email(customer).sendWelcome({
          crmId: crm.id,
          billingPortal: billing.portalUrl,
          supportEmail: support.email,
        })

        return {
          customerId: customer.id,
          crmId: crm.id,
          status: 'onboarded',
        }
      }

      const result = OnboardingWorkflow($, { id: 'cust-123', email: 'test@example.com' })

      // Result should contain PipelinePromises
      expect(isPipelinePromise(result.crmId)).toBe(true)

      // Collect all expressions for analysis
      const expressions = collectExpressions(result)
      expect(expressions.length).toBeGreaterThan(0)
    })
  })

  describe('BatchProcessingWorkflow with magic map', () => {
    it('uses map for batch operations', () => {
      const $ = createWorkflowProxy()

      const BatchWorkflow = ($: any, batch: any) => {
        const items = $.Warehouse(batch).getItems()

        // Magic map - record-replay pattern
        const checked = items.map((item) => $.Inventory(item.sku).check())
        const reserved = checked.map((check, i) =>
          $.when(check.available, {
            then: () => $.Inventory(items[i].sku).reserve(),
          }),
        )

        return { results: reserved }
      }

      const result = BatchWorkflow($, { warehouseId: 'wh-1' })

      expect(isPipelinePromise(result.results)).toBe(true)
      expect(result.results.__expr.type).toBe('map')
    })
  })

  describe('ConditionalWorkflow with $.when', () => {
    it('uses declarative branching', () => {
      const $ = createWorkflowProxy()

      const OrderWorkflow = ($: any, order: any) => {
        const inventory = $.Inventory(order.product).check()

        // Declarative conditional - no if/else with resolved values
        return $.when(inventory.available, {
          then: () => ({
            status: 'confirmed',
            reservation: $.Inventory(order.product).reserve({ quantity: order.quantity }),
          }),
          else: () => ({
            status: 'unavailable',
            notification: $.Notification(order.customer).sendOutOfStock(),
          }),
        })
      }

      const result = OrderWorkflow($, { product: { sku: 'ABC' }, quantity: 1, customer: { id: 'c1' } })

      // Result is a PipelinePromise representing the conditional
      expect(isPipelinePromise(result)).toBe(true)
      expect(result.__expr.type).toBe('conditional')
    })
  })
})

/**
 * Declarative Conditionals Tests
 * Tests for $.when, $.branch, $.match
 */
describe('Declarative Conditionals', () => {
  describe('$.when', () => {
    it('$.when returns PipelinePromise', () => {
      const $ = createWorkflowProxy()

      const inventory = $.Inventory({ sku: 'ABC' }).check()
      const result = $.when(inventory.available, {
        then: () => $.Inventory({ sku: 'ABC' }).reserve(),
      })

      expect(isPipelinePromise(result)).toBe(true)
    })

    it('$.when captures condition and both branches', () => {
      const $ = createWorkflowProxy()

      const inventory = $.Inventory({ sku: 'ABC' }).check()
      const result = $.when(inventory.available, {
        then: () => $.Inventory({ sku: 'ABC' }).reserve(),
        else: () => $.Email({ to: 'customer@example.com' }).sendOutOfStock(),
      })

      const expr = result.__expr
      expect(expr.type).toBe('conditional')

      // Condition should be the property access on inventory
      if (expr.type === 'conditional') {
        expect(expr.condition.type).toBe('property')
        if (expr.condition.type === 'property') {
          expect(expr.condition.property).toBe('available')
        }

        // Then branch should capture the reserve call
        expect(expr.thenBranch).toBeDefined()
        expect(expr.thenBranch.type).toBe('call')
        if (expr.thenBranch.type === 'call') {
          expect(expr.thenBranch.domain).toBe('Inventory')
          expect(expr.thenBranch.method).toEqual(['reserve'])
        }

        // Else branch should capture the email call
        expect(expr.elseBranch).toBeDefined()
        expect(expr.elseBranch?.type).toBe('call')
        if (expr.elseBranch?.type === 'call') {
          expect(expr.elseBranch.domain).toBe('Email')
          expect(expr.elseBranch.method).toEqual(['sendOutOfStock'])
        }
      }
    })

    it('$.when works without else branch', () => {
      const $ = createWorkflowProxy()

      const inventory = $.Inventory({ sku: 'ABC' }).check()
      const result = $.when(inventory.available, {
        then: () => $.Inventory({ sku: 'ABC' }).reserve(),
      })

      const expr = result.__expr
      if (expr.type === 'conditional') {
        expect(expr.thenBranch).toBeDefined()
        expect(expr.elseBranch).toBeNull()
      }
    })
  })

  describe('$.branch', () => {
    it('$.branch returns PipelinePromise', () => {
      const $ = createWorkflowProxy()

      const order = $.Orders({ id: 'order-1' }).get()
      const result = $.branch(order.status, {
        pending: () => $.Payment(order).process(),
        shipped: () => $.Tracking(order).update(),
        delivered: () => $.Review(order.customer).request(),
      })

      expect(isPipelinePromise(result)).toBe(true)
    })

    it('$.branch captures all cases', () => {
      const $ = createWorkflowProxy()

      const order = $.Orders({ id: 'order-1' }).get()
      const result = $.branch(order.status, {
        pending: () => $.Payment(order).process(),
        shipped: () => $.Tracking(order).update(),
        delivered: () => $.Review(order.customer).request(),
        default: () => $.Log({ message: 'Unknown status' }).write(),
      })

      const expr = result.__expr
      expect(expr.type).toBe('branch')

      if (expr.type === 'branch') {
        // Value should be the status property access
        expect(expr.value.type).toBe('property')
        if (expr.value.type === 'property') {
          expect(expr.value.property).toBe('status')
        }

        // Should have all four cases captured
        expect(Object.keys(expr.cases)).toHaveLength(4)
        expect(expr.cases['pending']).toBeDefined()
        expect(expr.cases['shipped']).toBeDefined()
        expect(expr.cases['delivered']).toBeDefined()
        expect(expr.cases['default']).toBeDefined()

        // Each case should be a call expression
        expect(expr.cases['pending'].type).toBe('call')
        expect(expr.cases['shipped'].type).toBe('call')
        expect(expr.cases['delivered'].type).toBe('call')
        expect(expr.cases['default'].type).toBe('call')
      }
    })
  })

  describe('$.match', () => {
    it('$.match returns PipelinePromise', () => {
      const $ = createWorkflowProxy()

      const result = $.Service({}).call()
      const matched = $.match(result, [
        [(r) => r.success, () => $.Email({}).sendSuccess()],
        [(r) => r.error, () => $.Alert({}).notify()],
      ])

      expect(isPipelinePromise(matched)).toBe(true)
    })

    it('$.match captures patterns', () => {
      const $ = createWorkflowProxy()

      const result = $.Service({}).call()
      const matched = $.match(result, [
        [(r) => r.success, () => $.Email({}).sendSuccess()],
        [(r) => r.error, () => $.Alert({}).notify()],
        [(r) => r.retry, () => $.Queue({}).requeue()],
      ])

      const expr = matched.__expr
      expect(expr.type).toBe('match')

      if (expr.type === 'match') {
        // Value should be the call expression
        expect(expr.value.type).toBe('call')
        if (expr.value.type === 'call') {
          expect(expr.value.domain).toBe('Service')
          expect(expr.value.method).toEqual(['call'])
        }

        // Should have three patterns
        expect(expr.patterns).toHaveLength(3)

        // Each pattern should have predicateSource (function string) and result expression
        for (const pattern of expr.patterns) {
          expect(typeof pattern.predicateSource).toBe('string')
          expect(pattern.predicateSource).toContain('=>')
          expect(pattern.result).toBeDefined()
          expect(pattern.result.type).toBe('call')
        }

        // Verify specific pattern results
        if (expr.patterns[0].result.type === 'call') {
          expect(expr.patterns[0].result.domain).toBe('Email')
        }
        if (expr.patterns[1].result.type === 'call') {
          expect(expr.patterns[1].result.domain).toBe('Alert')
        }
        if (expr.patterns[2].result.type === 'call') {
          expect(expr.patterns[2].result.domain).toBe('Queue')
        }
      }
    })
  })
})

// analyzeExpressions is now imported from ./pipeline-promise
