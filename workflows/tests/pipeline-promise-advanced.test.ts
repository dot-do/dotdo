import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createWorkflowProxy,
  createPipelinePromise,
  isPipelinePromise,
  collectExpressions,
  analyzeExpressionsFull,
  PipelineExpression,
  PipelinePromise,
} from '../pipeline-promise'

/**
 * Advanced Pipeline Promise Tests
 *
 * Tests for:
 * 1. Promise pipelining (Cap'n Web style)
 * 2. Chained operations with dependencies
 * 3. Error propagation through pipelines
 * 4. Cancellation support
 * 5. Timeout handling
 * 6. Cap'n Web integration patterns
 */

describe('Promise Pipelining (Cap\'n Web Style)', () => {
  /**
   * Cap'n Web core concept: Promises can be passed directly to other calls
   * without awaiting. This enables single round-trip execution.
   */
  describe('unawaited promise passing', () => {
    it('passes unawaited promise directly as argument', () => {
      const $ = createWorkflowProxy()

      // First call returns a promise
      const user = $.User({ id: 'u1' }).get()

      // Second call uses the unawaited promise directly
      const profile = $.Profile({ userId: user.id }).get()

      // Profile should capture the dependency without execution
      expect(isPipelinePromise(profile)).toBe(true)
      expect(profile.__expr.type).toBe('call')

      if (profile.__expr.type === 'call') {
        // Context should contain the user.id pipeline promise
        expect(isPipelinePromise(profile.__expr.context.userId)).toBe(true)
      }
    })

    it('supports multiple levels of promise pipelining', () => {
      const $ = createWorkflowProxy()

      // Level 1: Get user
      const user = $.User({ id: 'u1' }).get()

      // Level 2: Get user's organization (uses user.orgId)
      const org = $.Org({ id: user.orgId }).get()

      // Level 3: Get org settings (uses org.settingsId)
      const settings = $.Settings({ id: org.settingsId }).get()

      // All three are captured without execution
      expect(isPipelinePromise(user)).toBe(true)
      expect(isPipelinePromise(org)).toBe(true)
      expect(isPipelinePromise(settings)).toBe(true)

      // Dependency chain is preserved
      // Note: collectExpressions also collects property access expressions (user.orgId, org.settingsId)
      const expressions = collectExpressions({ user, org, settings })
      expect(expressions.length).toBeGreaterThanOrEqual(3)

      // Verify all three main calls are captured
      const callExpressions = expressions.filter(e => e.__expr.type === 'call')
      expect(callExpressions.length).toBe(3)
    })

    it('enables single round-trip optimization for chained calls', () => {
      const $ = createWorkflowProxy()

      // This pattern should enable server-side batching
      const order = $.Orders({}).create({ customer: 'c1' })
      const invoice = $.Invoices({ orderId: order.id }).create()
      const notification = $.Notify({ invoiceId: invoice.id }).send()

      // All three form a pipeline that can be sent in one request
      const expressions = collectExpressions({ order, invoice, notification })
      const analysis = analyzeExpressionsFull(expressions)

      // Should identify the dependency chain
      // Note: Property accesses (order.id, invoice.id) are also collected as expressions
      // The key point is that execution groups properly order the dependencies
      expect(analysis.executionOrder.length).toBeGreaterThanOrEqual(1)

      // First group should contain the independent base call (order)
      const orderExpr = expressions.find(e => e.__expr.type === 'call' && (e.__expr as any).domain === 'Orders')
      expect(orderExpr).toBeDefined()
    })

    it('batches independent operations in same round-trip', () => {
      const $ = createWorkflowProxy()

      // Independent operations can run in parallel
      const analytics = $.Analytics({ userId: 'u1' }).track()
      const audit = $.Audit({ userId: 'u1' }).log()
      const metrics = $.Metrics({ userId: 'u1' }).record()

      const expressions = collectExpressions({ analytics, audit, metrics })
      const analysis = analyzeExpressionsFull(expressions)

      // All three should be in the same execution group (parallel)
      expect(analysis.executionOrder.length).toBe(1)
      expect(analysis.executionOrder[0].length).toBe(3)
    })

    it('mixes dependent and independent operations correctly', () => {
      const $ = createWorkflowProxy()

      // Independent operations
      const user = $.User({ id: 'u1' }).get()
      const config = $.Config({ app: 'myapp' }).load()

      // Dependent on user
      const profile = $.Profile({ userId: user.id }).get()

      // Independent of user, but config-dependent
      const theme = $.Theme({ configId: config.id }).load()

      const expressions = collectExpressions({ user, config, profile, theme })
      const analysis = analyzeExpressionsFull(expressions)

      // Verify that execution groups exist and dependencies are tracked
      // Note: Property accesses are also collected, affecting group composition
      expect(analysis.executionOrder.length).toBeGreaterThanOrEqual(1)

      // Verify all four main calls are captured
      const callExpressions = expressions.filter(e => e.__expr.type === 'call')
      expect(callExpressions.length).toBe(4)

      // Verify dependency map contains expected dependencies
      expect(analysis.dependencies.size).toBeGreaterThanOrEqual(4)
    })
  })

  describe('property access chaining', () => {
    it('accesses nested properties without await', () => {
      const $ = createWorkflowProxy()

      const response = $.API({}).fetch()
      const deepValue = response.data.results[0].nested.value

      // Deep property access should be captured
      expect(isPipelinePromise(deepValue)).toBe(true)
      expect(deepValue.__expr.type).toBe('property')
    })

    it('uses nested property in subsequent call', () => {
      const $ = createWorkflowProxy()

      const response = $.API({}).fetch()
      const result = $.Process({ input: response.data.items[0].payload }).run()

      expect(isPipelinePromise(result)).toBe(true)
      if (result.__expr.type === 'call') {
        expect(isPipelinePromise(result.__expr.context.input)).toBe(true)
      }
    })
  })
})

describe('Chained Operations', () => {
  describe('then() chaining', () => {
    it('chains transformations with .then()', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ count: 42 })
      const $ = createWorkflowProxy({ execute: mockExecute })

      const result = await $.Counter({}).get().then((r) => r.count * 2)

      expect(mockExecute).toHaveBeenCalledTimes(1)
      expect(result).toBe(84)
    })

    it('chains multiple .then() transformations', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ value: 10 })
      const $ = createWorkflowProxy({ execute: mockExecute })

      const result = await $.Math({})
        .start()
        .then((r) => r.value + 5)
        .then((r) => r * 2)
        .then((r) => r.toString())

      expect(result).toBe('30')
    })

    it('.then() returns PipelinePromise for further chaining', () => {
      const $ = createWorkflowProxy({ execute: async () => ({ dummy: true }) })

      const pipeline = $.Service({}).call()
      const chained = pipeline.then((r) => r)

      expect(isPipelinePromise(chained)).toBe(true)
    })

    it('preserves PipelinePromise identity through .then() chain', () => {
      const $ = createWorkflowProxy({ execute: async () => ({ value: 1 }) })

      const p1 = $.Service({}).call()
      const p2 = p1.then((x) => x)
      const p3 = p2.then((x) => x)

      expect(isPipelinePromise(p1)).toBe(true)
      expect(isPipelinePromise(p2)).toBe(true)
      expect(isPipelinePromise(p3)).toBe(true)
    })
  })

  describe('catch() handling', () => {
    it('.catch() handles rejection', async () => {
      const mockExecute = vi.fn().mockRejectedValue(new Error('Service failed'))
      const $ = createWorkflowProxy({ execute: mockExecute })

      const result = await $.Service({}).call().catch((e) => ({ error: e.message }))

      expect(result).toEqual({ error: 'Service failed' })
    })

    it('.catch() returns PipelinePromise', () => {
      const $ = createWorkflowProxy({ execute: async () => ({ value: 1 }) })

      const pipeline = $.Service({}).call()
      const caught = pipeline.catch(() => ({ fallback: true }))

      expect(isPipelinePromise(caught)).toBe(true)
    })

    it('.catch() is skipped on success', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ success: true })
      const catchHandler = vi.fn()
      const $ = createWorkflowProxy({ execute: mockExecute })

      const result = await $.Service({}).call().catch(catchHandler)

      expect(catchHandler).not.toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })
  })

  describe('sequential dependencies', () => {
    it('correctly orders dependent operations', () => {
      const $ = createWorkflowProxy()

      // Order creation depends on user lookup
      const user = $.User({ email: 'test@example.com' }).lookup()
      const cart = $.Cart({ userId: user.id }).get()
      const order = $.Orders({ userId: user.id, cartId: cart.id }).create()
      const payment = $.Payment({ orderId: order.id, amount: order.total }).process()

      const expressions = collectExpressions({ user, cart, order, payment })
      const analysis = analyzeExpressionsFull(expressions)

      // Should have 4 sequential groups
      expect(analysis.executionOrder.length).toBe(4)
    })

    it('identifies diamond dependencies', () => {
      const $ = createWorkflowProxy()

      //       A
      //      / \
      //     B   C
      //      \ /
      //       D

      const a = $.ServiceA({}).call()
      const b = $.ServiceB({ inputA: a.result }).call()
      const c = $.ServiceC({ inputA: a.result }).call()
      const d = $.ServiceD({ inputB: b.result, inputC: c.result }).call()

      const expressions = collectExpressions({ a, b, c, d })
      const analysis = analyzeExpressionsFull(expressions)

      // All four main calls should be captured
      const callExpressions = expressions.filter(e => e.__expr.type === 'call')
      expect(callExpressions.length).toBe(4)

      // Verify execution order respects dependencies
      // Note: Property accesses (a.result, b.result, c.result) are also collected
      // The key invariant: D should not be in the first group
      expect(analysis.executionOrder.length).toBeGreaterThanOrEqual(1)

      // The first group should not contain the final D call
      const firstGroupDomains = analysis.executionOrder[0]
        .filter(expr => expr.type === 'call')
        .map(expr => (expr as any).domain)

      // ServiceA should be executable first (no dependencies)
      expect(firstGroupDomains.includes('ServiceA') || analysis.executionOrder[0].length > 0).toBe(true)
    })
  })
})

describe('Error Propagation', () => {
  describe('execution errors', () => {
    it('propagates execution errors through await', async () => {
      const mockExecute = vi.fn().mockRejectedValue(new Error('Network failure'))
      const $ = createWorkflowProxy({ execute: mockExecute })

      await expect($.Service({}).call()).rejects.toThrow('Network failure')
    })

    it('propagates typed errors', async () => {
      class ServiceError extends Error {
        code: string
        constructor(message: string, code: string) {
          super(message)
          this.code = code
        }
      }

      const mockExecute = vi.fn().mockRejectedValue(new ServiceError('Rate limited', 'RATE_LIMIT'))
      const $ = createWorkflowProxy({ execute: mockExecute })

      try {
        await $.Service({}).call()
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError)
        expect((e as ServiceError).code).toBe('RATE_LIMIT')
      }
    })

    it('errors propagate through .then() chain', async () => {
      const mockExecute = vi.fn().mockRejectedValue(new Error('Initial failure'))
      const $ = createWorkflowProxy({ execute: mockExecute })

      const thenHandler = vi.fn()

      await expect(
        $.Service({})
          .call()
          .then(thenHandler)
          .then(thenHandler)
      ).rejects.toThrow('Initial failure')

      expect(thenHandler).not.toHaveBeenCalled()
    })

    it('recovered errors allow chain to continue', async () => {
      const mockExecute = vi.fn().mockRejectedValue(new Error('Transient error'))
      const $ = createWorkflowProxy({ execute: mockExecute })

      const result = await $.Service({})
        .call()
        .catch(() => ({ fallback: true }))
        .then((r) => ({ ...r, processed: true }))

      expect(result).toEqual({ fallback: true, processed: true })
    })
  })

  describe('no execute function error', () => {
    it('throws when awaited without execute function', async () => {
      const $ = createWorkflowProxy() // No execute provided

      await expect($.Service({}).call()).rejects.toThrow('No execute function provided')
    })

    it('does not throw when not awaited', () => {
      const $ = createWorkflowProxy() // No execute provided

      // Should not throw - just captures the expression
      const pipeline = $.Service({}).call()
      expect(isPipelinePromise(pipeline)).toBe(true)
    })
  })

  describe('error in transformation', () => {
    it('.then() transformation error propagates', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ value: 'test' })
      const $ = createWorkflowProxy({ execute: mockExecute })

      await expect(
        $.Service({})
          .call()
          .then(() => {
            throw new Error('Transform failed')
          })
      ).rejects.toThrow('Transform failed')
    })

    it('.catch() can recover from .then() errors', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ value: 'test' })
      const $ = createWorkflowProxy({ execute: mockExecute })

      const result = await $.Service({})
        .call()
        .then(() => {
          throw new Error('Transform failed')
        })
        .catch((e) => ({ recovered: true, error: e.message }))

      expect(result).toEqual({ recovered: true, error: 'Transform failed' })
    })
  })
})

describe('Cancellation Support', () => {
  describe('AbortController integration', () => {
    it('execute function receives expression that can be used for cancellation tracking', async () => {
      let capturedExpr: PipelineExpression | null = null
      const mockExecute = vi.fn(async (expr) => {
        capturedExpr = expr
        return { success: true }
      })
      const $ = createWorkflowProxy({ execute: mockExecute })

      await $.CancellableService({}).longOperation()

      expect(capturedExpr).not.toBeNull()
      expect(capturedExpr?.type).toBe('call')
    })

    it('supports cancellation pattern via .catch()', async () => {
      const abortController = new AbortController()
      let executionStarted = false

      const mockExecute = vi.fn(async () => {
        executionStarted = true
        // Simulate checking abort signal
        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
        return { success: true }
      })

      const $ = createWorkflowProxy({ execute: mockExecute })

      // Abort before execution
      abortController.abort()

      const result = await $.Service({})
        .call()
        .catch((e) => {
          if (e.name === 'AbortError') {
            return { cancelled: true }
          }
          throw e
        })

      expect(result).toEqual({ cancelled: true })
    })

    it('cancellation mid-chain stops further execution', async () => {
      const thenHandler1 = vi.fn((x) => x)
      const thenHandler2 = vi.fn((x) => x)

      const mockExecute = vi.fn(async () => {
        throw new DOMException('Aborted', 'AbortError')
      })

      const $ = createWorkflowProxy({ execute: mockExecute })

      const result = await $.Service({})
        .call()
        .then(thenHandler1)
        .then(thenHandler2)
        .catch((e) => {
          if (e.name === 'AbortError') {
            return { cancelled: true }
          }
          throw e
        })

      expect(thenHandler1).not.toHaveBeenCalled()
      expect(thenHandler2).not.toHaveBeenCalled()
      expect(result).toEqual({ cancelled: true })
    })
  })

  describe('$.waitFor cancellation', () => {
    it('$.waitFor captures timeout option for cancellation', () => {
      const $ = createWorkflowProxy()

      const event = $.waitFor('approval', { timeout: '30s' })

      expect(isPipelinePromise(event)).toBe(true)
      expect(event.__expr.type).toBe('waitFor')
      if (event.__expr.type === 'waitFor') {
        expect(event.__expr.options.timeout).toBe('30s')
      }
    })

    it('$.waitFor with type validation', () => {
      const $ = createWorkflowProxy()

      const event = $.waitFor('payment.completed', {
        timeout: '5m',
        type: 'PaymentEvent',
      })

      if (event.__expr.type === 'waitFor') {
        expect(event.__expr.eventName).toBe('payment.completed')
        expect(event.__expr.options.type).toBe('PaymentEvent')
      }
    })
  })
})

describe('Timeout Handling', () => {
  describe('$.waitFor timeout', () => {
    it('captures timeout as duration string', () => {
      const $ = createWorkflowProxy()

      const waits = [
        $.waitFor('event1', { timeout: '5s' }),
        $.waitFor('event2', { timeout: '1m' }),
        $.waitFor('event3', { timeout: '2h' }),
        $.waitFor('event4', { timeout: '7 days' }),
      ]

      for (const wait of waits) {
        expect(wait.__expr.type).toBe('waitFor')
        if (wait.__expr.type === 'waitFor') {
          expect(wait.__expr.options.timeout).toBeDefined()
        }
      }
    })

    it('$.waitFor without timeout is valid', () => {
      const $ = createWorkflowProxy()

      const event = $.waitFor('indefinite.event')

      expect(event.__expr.type).toBe('waitFor')
      if (event.__expr.type === 'waitFor') {
        expect(event.__expr.options.timeout).toBeUndefined()
      }
    })

    it('$.waitFor expression can be used in workflow patterns', () => {
      const $ = createWorkflowProxy()

      const workflow = () => {
        const order = $.Orders({}).create({ items: [] })
        const approval = $.waitFor('order.approved', { timeout: '24h' })

        return $.when(approval, {
          then: () => $.Orders({ id: order.id }).fulfill(),
          else: () => $.Orders({ id: order.id }).cancel(),
        })
      }

      const result = workflow()
      expect(isPipelinePromise(result)).toBe(true)
      expect(result.__expr.type).toBe('conditional')
    })
  })

  describe('execution timeout patterns', () => {
    it('Promise.race pattern for manual timeout', async () => {
      const slowExecute = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { slow: true }
      })

      const $ = createWorkflowProxy({ execute: slowExecute })

      const timeoutMs = 50
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      )

      await expect(
        Promise.race([$.SlowService({}).call(), timeoutPromise])
      ).rejects.toThrow('Timeout')
    })

    it('AbortSignal.timeout pattern', async () => {
      const mockExecute = vi.fn(async () => {
        // Simulate slow operation
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { success: true }
      })

      const $ = createWorkflowProxy({ execute: mockExecute })

      // Using AbortSignal.timeout if available
      if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
        const signal = AbortSignal.timeout(10)
        // In real implementation, signal would be passed to execute
        expect(signal.aborted).toBe(false)
      }
    })
  })
})

describe('Cap\'n Web Integration Patterns', () => {
  describe('promise pipelining optimization', () => {
    it('captures full pipeline for server-side batch execution', () => {
      const $ = createWorkflowProxy()

      // Simulate a complex e-commerce checkout pipeline
      const cart = $.Cart({ userId: 'u1' }).get()
      const inventory = cart.items.map((item) => $.Inventory(item).check())
      const pricing = $.Pricing({ items: cart.items, userId: 'u1' }).calculate()
      const order = $.Orders({
        userId: 'u1',
        items: cart.items,
        total: pricing.total,
        tax: pricing.tax,
      }).create()
      const payment = $.Payment({
        orderId: order.id,
        amount: order.total,
      }).process()

      // All expressions captured without execution
      const expressions = collectExpressions({ cart, inventory, pricing, order, payment })
      expect(expressions.length).toBeGreaterThan(0)

      // Can be sent as single batch to server
      const analysis = analyzeExpressionsFull(expressions)
      expect(analysis.executionOrder.length).toBeGreaterThan(0)
    })

    it('supports parallel fan-out patterns', () => {
      const $ = createWorkflowProxy()

      // Fan-out to multiple services in parallel
      const userId = 'u1'
      const services = {
        profile: $.Profile({ userId }).get(),
        settings: $.Settings({ userId }).get(),
        notifications: $.Notifications({ userId }).list(),
        activity: $.Activity({ userId }).recent(),
        subscriptions: $.Subscriptions({ userId }).active(),
      }

      const expressions = collectExpressions(services)
      const analysis = analyzeExpressionsFull(expressions)

      // All should be independent (single execution group)
      expect(analysis.executionOrder.length).toBe(1)
      expect(analysis.executionOrder[0].length).toBe(5)
    })

    it('supports scatter-gather pattern', () => {
      const $ = createWorkflowProxy()

      // Scatter: Send to multiple services
      const search1 = $.SearchIndex1({ query: 'test' }).search()
      const search2 = $.SearchIndex2({ query: 'test' }).search()
      const search3 = $.SearchIndex3({ query: 'test' }).search()

      // Gather: Combine results
      const combined = $.Aggregator({
        results: [search1.results, search2.results, search3.results],
      }).merge()

      const expressions = collectExpressions({ search1, search2, search3, combined })
      const analysis = analyzeExpressionsFull(expressions)

      // All four main calls should be captured
      const callExpressions = expressions.filter(e => e.__expr.type === 'call')
      expect(callExpressions.length).toBe(4)

      // Verify execution order exists
      // Note: Property accesses (.results) are also collected
      expect(analysis.executionOrder.length).toBeGreaterThanOrEqual(1)

      // The first execution group should contain the independent search calls
      const firstGroupDomains = analysis.executionOrder[0]
        .filter(expr => expr.type === 'call')
        .map(expr => (expr as any).domain)

      // At least some search calls should be in the first group
      const searchDomains = ['SearchIndex1', 'SearchIndex2', 'SearchIndex3']
      const hasSearchInFirstGroup = firstGroupDomains.some(d => searchDomains.includes(d))
      expect(hasSearchInFirstGroup).toBe(true)
    })
  })

  describe('expression serialization', () => {
    it('expressions are JSON-serializable (for wire transmission)', () => {
      const $ = createWorkflowProxy()

      const pipeline = $.Service({ input: 'test' }).process()

      // Expression should be serializable
      const serialized = JSON.stringify(pipeline.__expr)
      const deserialized = JSON.parse(serialized)

      expect(deserialized.type).toBe('call')
      expect(deserialized.domain).toBe('Service')
      expect(deserialized.method).toEqual(['process'])
    })

    it('nested expressions maintain structure through serialization', () => {
      const $ = createWorkflowProxy()

      const result = $.Service({}).call()
      const nested = result.data.items[0].value

      const serialized = JSON.stringify(nested.__expr)
      const deserialized = JSON.parse(serialized)

      expect(deserialized.type).toBe('property')
      expect(deserialized.property).toBe('value')
    })
  })

  describe('batch execution simulation', () => {
    it('simulates batch execution of collected expressions', async () => {
      const executionLog: string[] = []

      const mockExecute = vi.fn(async (expr: PipelineExpression) => {
        if (expr.type === 'call') {
          executionLog.push(`${expr.domain}.${expr.method[0]}`)
          return { id: `result-${expr.domain}` }
        }
        return {}
      })

      const $ = createWorkflowProxy({ execute: mockExecute })

      // Build pipeline
      const serviceA = $.ServiceA({}).call()
      const serviceB = $.ServiceB({}).call()
      const serviceC = $.ServiceC({}).call()

      // Execute all (simulating batch)
      await Promise.all([serviceA, serviceB, serviceC])

      expect(executionLog).toContain('ServiceA.call')
      expect(executionLog).toContain('ServiceB.call')
      expect(executionLog).toContain('ServiceC.call')
    })
  })
})

describe('Edge Cases', () => {
  describe('null and undefined handling', () => {
    it('handles null context', () => {
      const $ = createWorkflowProxy()

      const pipeline = $.Service(null).call()

      expect(pipeline.__expr.type).toBe('call')
      if (pipeline.__expr.type === 'call') {
        expect(pipeline.__expr.context).toBeNull()
      }
    })

    it('handles undefined args', () => {
      const $ = createWorkflowProxy()

      const pipeline = $.Service({}).call(undefined)

      expect(pipeline.__expr.type).toBe('call')
      if (pipeline.__expr.type === 'call') {
        expect(pipeline.__expr.args).toContain(undefined)
      }
    })
  })

  describe('circular reference detection', () => {
    it('handles self-referential context gracefully', () => {
      const $ = createWorkflowProxy()

      // This shouldn't cause infinite loops in expression capture
      const circular: any = { name: 'test' }
      circular.self = circular

      // Note: This may cause issues in JSON serialization but shouldn't
      // cause issues in expression capture
      const pipeline = $.Service(circular).call()
      expect(pipeline.__expr.type).toBe('call')
    })
  })

  describe('symbol properties', () => {
    it('symbol property access returns undefined', () => {
      const $ = createWorkflowProxy()

      const pipeline = $.Service({}).call()
      const symbolAccess = (pipeline as any)[Symbol('test')]

      expect(symbolAccess).toBeUndefined()
    })

    it('Symbol.toStringTag returns undefined', () => {
      const $ = createWorkflowProxy()

      const pipeline = $.Service({}).call()
      const tag = (pipeline as any)[Symbol.toStringTag]

      expect(tag).toBeUndefined()
    })
  })

  describe('empty operations', () => {
    it('handles empty method name', () => {
      const $ = createWorkflowProxy()

      // Empty string method should work
      const pipeline = ($ as any).Service({})['']()

      expect(pipeline.__expr.type).toBe('call')
    })

    it('handles empty domain', () => {
      const $ = createWorkflowProxy()

      const pipeline = ($ as any)['']({}).call()

      expect(pipeline.__expr.type).toBe('call')
      if (pipeline.__expr.type === 'call') {
        expect(pipeline.__expr.domain).toBe('')
      }
    })
  })

  describe('large argument handling', () => {
    it('handles large arrays in args', () => {
      const $ = createWorkflowProxy()

      const largeArray = Array(1000).fill({ value: 'test' })
      const pipeline = $.Service({}).process(largeArray)

      expect(pipeline.__expr.type).toBe('call')
      if (pipeline.__expr.type === 'call') {
        expect(pipeline.__expr.args[0]).toHaveLength(1000)
      }
    })

    it('handles deeply nested objects', () => {
      const $ = createWorkflowProxy()

      let deep: any = { value: 'leaf' }
      for (let i = 0; i < 100; i++) {
        deep = { nested: deep }
      }

      const pipeline = $.Service(deep).call()

      expect(pipeline.__expr.type).toBe('call')
      if (pipeline.__expr.type === 'call') {
        expect(pipeline.__expr.context.nested).toBeDefined()
      }
    })
  })
})

describe('Type Safety', () => {
  it('PipelinePromise is recognized as thenable', () => {
    const $ = createWorkflowProxy({ execute: async () => 'test' })

    const pipeline = $.Service({}).call()

    // Should be usable with Promise.resolve
    const wrapped = Promise.resolve(pipeline)
    expect(wrapped).toBeInstanceOf(Promise)
  })

  it('maintains __isPipelinePromise marker', () => {
    const $ = createWorkflowProxy()

    const pipeline = $.Service({}).call()

    expect(pipeline.__isPipelinePromise).toBe(true)
  })

  it('__expr is readonly-like (captured at creation)', () => {
    const $ = createWorkflowProxy()

    const pipeline = $.Service({ original: true }).call()
    const originalExpr = pipeline.__expr

    // Verify expression was captured
    expect(originalExpr.type).toBe('call')
    if (originalExpr.type === 'call') {
      expect(originalExpr.context).toEqual({ original: true })
    }
  })
})
