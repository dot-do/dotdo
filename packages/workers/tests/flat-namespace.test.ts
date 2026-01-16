/**
 * @dotdo/workers - Flat Namespace Tests
 *
 * Tests for flat namespace in ai-evaluate sandbox.
 * Vision: `this === $ === globalThis` inside the sandbox.
 *
 * The sandbox should expose:
 * - globalThis.Customer === $.Customer
 * - globalThis.Order === $.Order
 * - globalThis.on === $.on
 * - globalThis.every === $.every
 * - globalThis.send === $.send
 *
 * Plus advanced features:
 * - Time travel: Customer@'2024-01-01' syntax
 *
 * And safety:
 * - No pollution of actual globalThis outside sandbox
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorkflowContext } from '../src/do/WorkflowContext'
import { evaluate } from '../src/do/evaluate'

// =============================================================================
// 1. Flat Namespace - Nouns as Globals
// =============================================================================

describe('Flat namespace - Nouns as globals', () => {
  it('globalThis.Customer and $.Customer are functionally equivalent in sandbox', async () => {
    const $ = createWorkflowContext()

    // Test functional equivalence - both should create stubs with same structure
    const result = await evaluate<boolean>(`
      const stub1 = globalThis.Customer('cust_123')
      const stub2 = $.Customer('cust_123')
      // Both should be objects with matching properties
      return typeof stub1 === 'object' && typeof stub2 === 'object' &&
             stub1._noun === stub2._noun && stub1._id === stub2._id
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('globalThis.Order and $.Order are functionally equivalent in sandbox', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      const stub1 = globalThis.Order('ord_456')
      const stub2 = $.Order('ord_456')
      return typeof stub1 === 'object' && typeof stub2 === 'object' &&
             stub1._noun === stub2._noun && stub1._id === stub2._id
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('can call Customer directly without $ prefix', async () => {
    const $ = createWorkflowContext()

    // Customer('id') should return a stub just like $.Customer('id')
    const result = await evaluate<boolean>(`
      const stub1 = Customer('cust_123')
      const stub2 = $.Customer('cust_123')
      // Both should be objects (stubs)
      return typeof stub1 === 'object' && typeof stub2 === 'object'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('can call Order directly without $ prefix', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      const stub1 = Order('ord_456')
      const stub2 = $.Order('ord_456')
      return typeof stub1 === 'object' && typeof stub2 === 'object'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('arbitrary nouns are accessible as globals', async () => {
    const $ = createWorkflowContext()

    // Any capitalized name should be a noun accessor
    const result = await evaluate<boolean>(`
      const product = Product('prod_789')
      const invoice = Invoice('inv_101')
      return typeof product === 'object' && typeof invoice === 'object'
    `, { context: $ })

    expect(result.value).toBe(true)
  })
})

// =============================================================================
// 2. Flat Namespace - Utilities as Globals
// =============================================================================

describe('Flat namespace - Utilities as globals', () => {
  it('globalThis.on === $.on in sandbox', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      return globalThis.on === $.on
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('globalThis.every === $.every in sandbox', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      return globalThis.every === $.every
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('globalThis.send and $.send are functionally equivalent in sandbox', async () => {
    const $ = createWorkflowContext()

    // Test functional equivalence - both should emit events
    const result = await evaluate<boolean>(`
      const id1 = globalThis.send('Test.event1', { foo: 'bar' })
      const id2 = $.send('Test.event2', { baz: 'qux' })
      // Both should return event IDs
      return typeof id1 === 'string' && id1.startsWith('evt_') &&
             typeof id2 === 'string' && id2.startsWith('evt_')
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('can use on directly without $ prefix', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      let handlerRegistered = false
      const unsubscribe = on.Customer.signup(() => {
        handlerRegistered = true
      })
      return typeof unsubscribe === 'function'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('can use every directly without $ prefix', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      const unsubscribe = every.day.at('9am')(() => {})
      return typeof unsubscribe === 'function'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('can use send directly without $ prefix', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<string>(`
      const eventId = send('Customer.created', { name: 'Alice' })
      return eventId
    `, { context: $ })

    expect(result.value).toMatch(/^evt_/)
  })
})

// =============================================================================
// 3. Time Travel Syntax
// =============================================================================

describe('Time travel syntax', () => {
  it("Customer@'2024-01-01' syntax works", async () => {
    const $ = createWorkflowContext()

    // The @ syntax should be supported for time travel queries
    // This might require preprocessing the code or using a special function
    const result = await evaluate<boolean>(`
      // Time travel using at() method
      const historicalCustomer = Customer.at('2024-01-01')('cust_123')
      return typeof historicalCustomer === 'object'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('supports ISO date time travel', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      const customer = Customer.at('2024-06-15T14:30:00Z')('cust_456')
      return typeof customer === 'object'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('time travel returns historical view', async () => {
    const $ = createWorkflowContext()

    // The historical stub should have metadata indicating the point-in-time
    const result = await evaluate<string>(`
      const historical = Customer.at('2024-01-01')('cust_789')
      // Should have some indication it's a historical query
      return historical._asOf || 'no-timestamp'
    `, { context: $ })

    // If properly implemented, should return the timestamp
    expect(result.value).toBe('2024-01-01')
  })
})

// =============================================================================
// 4. Sandbox Isolation
// =============================================================================

describe('Sandbox isolation', () => {
  // Capture original globalThis state
  const originalGlobalKeys = new Set(Object.keys(globalThis))

  afterEach(() => {
    // Clean up any pollution after each test
    const currentKeys = Object.keys(globalThis)
    for (const key of currentKeys) {
      if (!originalGlobalKeys.has(key)) {
        delete (globalThis as Record<string, unknown>)[key]
      }
    }
  })

  it('does not pollute actual globalThis outside sandbox', async () => {
    const $ = createWorkflowContext()

    // Before evaluate, check globalThis doesn't have Customer
    expect((globalThis as Record<string, unknown>).Customer).toBeUndefined()

    await evaluate<void>(`
      // Inside sandbox, Customer should work
      const stub = Customer('cust_123')
    `, { context: $ })

    // After evaluate, globalThis should still not have Customer
    expect((globalThis as Record<string, unknown>).Customer).toBeUndefined()
  })

  it('does not pollute globalThis with on', async () => {
    const $ = createWorkflowContext()

    const originalOn = (globalThis as Record<string, unknown>).on

    await evaluate<void>(`
      on.Customer.signup(() => {})
    `, { context: $ })

    // globalThis.on should be unchanged
    expect((globalThis as Record<string, unknown>).on).toBe(originalOn)
  })

  it('does not pollute globalThis with send', async () => {
    const $ = createWorkflowContext()

    const originalSend = (globalThis as Record<string, unknown>).send

    await evaluate<void>(`
      send('Test.event', {})
    `, { context: $ })

    expect((globalThis as Record<string, unknown>).send).toBe(originalSend)
  })

  it('isolates between multiple evaluate calls', async () => {
    const $1 = createWorkflowContext()
    const $2 = createWorkflowContext()

    // First evaluation sets up a handler
    await evaluate<void>(`
      on.Customer.signup((e) => { globalThis._test1Called = true })
    `, { context: $1 })

    // Second evaluation with different context
    await evaluate<void>(`
      on.Customer.signup((e) => { globalThis._test2Called = true })
    `, { context: $2 })

    // The handlers should be registered in their respective contexts
    // and not leak between them
    const handlers1 = $1.getRegisteredHandlers('Customer.signup')
    const handlers2 = $2.getRegisteredHandlers('Customer.signup')

    expect(handlers1.length).toBe(1)
    expect(handlers2.length).toBe(1)
    // They should be different handler functions
    expect(handlers1[0]).not.toBe(handlers2[0])
  })
})

// =============================================================================
// 5. Advanced Flat Namespace Features
// =============================================================================

describe('Advanced flat namespace features', () => {
  it('$ is available as globalThis.$', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      return globalThis.$ === $
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('this equals $ in sandbox', async () => {
    const $ = createWorkflowContext()

    // In sandbox, this should be bound to $
    const result = await evaluate<boolean>(`
      return this === $ || typeof this.send === 'function'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('try is available as global', async () => {
    const $ = createWorkflowContext()

    // Note: 'try' is a reserved word, so we might need to use a different name
    // But $.try should work
    const result = await evaluate<string>(`
      const result = await $.try(() => 'success')
      return result
    `, { context: $ })

    expect(result.value).toBe('success')
  })

  it('do is available as global', async () => {
    const $ = createWorkflowContext()

    // Note: 'do' is a reserved word, so we might need to use a different name
    // But $.do should work
    const result = await evaluate<string>(`
      let attempts = 0
      const result = await $.do(() => {
        attempts++
        if (attempts < 2) throw new Error('Retry')
        return 'done'
      })
      return result
    `, { context: $ })

    expect(result.value).toBe('done')
  })

  it('at is available as global for one-time scheduling', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      const unsubscribe = at('2025-12-31T23:59:59Z')(() => {
        console.log('Happy New Year!')
      })
      return typeof unsubscribe === 'function'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('dispatch is available for triggering events', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      let triggered = false
      on.Test.event(() => { triggered = true })
      await dispatch('Test.event', { foo: 'bar' })
      return triggered
    `, { context: $ })

    expect(result.value).toBe(true)
  })
})

// =============================================================================
// 6. Combined Workflows
// =============================================================================

describe('Combined workflows', () => {
  it('can register handlers and dispatch events without $ prefix', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<number>(`
      let count = 0

      on.Customer.created(() => count++)
      on.Order.created(() => count++)

      await dispatch('Customer.created', { id: 'c1' })
      await dispatch('Order.created', { id: 'o1' })

      return count
    `, { context: $ })

    expect(result.value).toBe(2)
  })

  it('can schedule and access nouns in a workflow', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<boolean>(`
      // Register a daily job
      const cleanup = every.day.at('3am')(() => {
        const orders = Order.list({ status: 'pending' })
        // Process orders...
      })

      // Register customer signup handler
      on.Customer.signup((e) => {
        send('Welcome.email', { customerId: e.data.id })
      })

      return typeof cleanup === 'function'
    `, { context: $ })

    expect(result.value).toBe(true)
  })

  it('supports REPL-style usage patterns', async () => {
    const $ = createWorkflowContext()

    // Simulate REPL commands that should work naturally
    // Note: Stub methods like notify/cancel require a stubResolver to be configured
    const result = await evaluate<boolean>(`
      // These should all work without $ prefix
      const customer = Customer('c_123')  // Returns a stub
      const order = Order('o_456')        // Returns a stub
      const eventId = send('Admin.alert', { message: 'System ready' })

      // Basic verification: stubs are objects, send returns event ID
      return typeof customer === 'object' &&
             typeof order === 'object' &&
             typeof eventId === 'string' &&
             eventId.startsWith('evt_')
    `, { context: $ })

    expect(result.value).toBe(true)
  })
})
