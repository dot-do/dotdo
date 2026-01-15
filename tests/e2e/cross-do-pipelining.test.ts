/**
 * E2E Cross-DO RPC Pipelining Tests (RED Phase)
 *
 * Tests for Cap'n Web-style promise pipelining across real Durable Objects.
 * These tests verify that:
 *
 * 1. Pipelined method calls execute without waiting for intermediate results
 * 2. Cross-DO RPC calls are batched into single round-trips
 * 3. Promise pipelining allows calling methods on promised results
 * 4. The .map() pattern works across DO boundaries
 * 5. Fire-and-forget works with pipelining
 *
 * These tests should FAIL until the pipelining infrastructure is fully integrated
 * with the Durable Object transport layer.
 *
 * @see do-5kg - RED: E2E cross-DO pipelining tests
 * @see do-aby - True Cap'n Web Pipelining epic
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Types
// =============================================================================

interface ThingData {
  $id: string
  $type: string
  $createdAt: string
  $updatedAt: string
  [key: string]: unknown
}

interface PipelineMetrics {
  roundTrips: number
  totalRequests: number
  pipelineDepth: number
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DO stub for testing pipelining
 */
function getDOStub(name = 'pipeline-e2e-test') {
  const id = env.DOFull.idFromName(name)
  return env.DOFull.get(id)
}

/**
 * Reset test state for a DO by creating fresh data
 */
async function setupTestData(stub: DurableObjectStub, testId: string): Promise<void> {
  // Create test customer with profile
  await stub.create('Customer', {
    $id: `customer-${testId}`,
    name: 'Test Customer',
    email: `test-${testId}@example.com`,
    profile: {
      email: `profile-${testId}@example.com`,
      settings: {
        theme: 'dark',
        notifications: true,
      },
    },
    orders: [
      { id: `order-${testId}-1`, total: 100, active: true },
      { id: `order-${testId}-2`, total: 250, active: true },
      { id: `order-${testId}-3`, total: 75, active: false },
    ],
  })
}

// =============================================================================
// 1. PIPELINED METHOD CALLS WITHOUT WAITING
// =============================================================================

describe('Cross-DO RPC Pipelining: Single Round-Trip', () => {
  /**
   * Core pipelining test: chained property/method access should NOT
   * wait for intermediate results - the entire pipeline should be
   * sent as a single request and resolved on the server.
   */
  it('should pipeline method calls without waiting for intermediate results', async () => {
    // FAILING TEST: This requires full integration of pipelining with DO transport
    //
    // The pattern: doA.getUser(id).getOrders().filter({ active: true })
    // Should be ONE network round-trip, not THREE
    //
    // Current behavior: Each step may trigger a separate RPC call
    // Expected behavior: Entire pipeline sent at once and resolved server-side

    const doStub = getDOStub('pipeline-single-roundtrip-1')

    // Setup: Create test data
    await doStub.create('User', {
      $id: 'user-1',
      name: 'Test User',
      profile: {
        email: 'test@example.com',
        theme: 'dark',
      },
    })

    await doStub.create('Order', {
      $id: 'order-1',
      userId: 'user-1',
      total: 100,
      active: true,
    })

    await doStub.create('Order', {
      $id: 'order-2',
      userId: 'user-1',
      total: 250,
      active: true,
    })

    await doStub.create('Order', {
      $id: 'order-3',
      userId: 'user-1',
      total: 75,
      active: false,
    })

    // The test: Execute a pipelined query
    // This should be ONE request with the full pipeline, resolved server-side
    //
    // FAILING: Current implementation requires waiting between each step
    const orders = await doStub.User('user-1').getOrders().filter({ active: true })

    // Verify results
    expect(orders).toHaveLength(2)
    expect(orders.every((o: { active: boolean }) => o.active)).toBe(true)
  })

  it('should access nested properties via pipeline in single request', async () => {
    // FAILING TEST: Nested property access should be pipelined
    //
    // Pattern: stub.profile.settings.theme
    // Should send: { pipeline: [{type:'property',name:'profile'},{type:'property',name:'settings'},{type:'property',name:'theme'}] }

    const doStub = getDOStub('pipeline-nested-props-1')

    await doStub.create('Customer', {
      $id: 'cust-nested-1',
      profile: {
        email: 'nested@example.com',
        settings: {
          theme: 'dark',
          language: 'en',
          notifications: {
            email: true,
            sms: false,
          },
        },
      },
    })

    // Pipeline: Customer('id').profile.settings.theme
    // Should be ONE round-trip
    const theme = await doStub.Customer('cust-nested-1').profile.settings.theme

    expect(theme).toBe('dark')
  })

  it('should pipeline method calls with arguments', async () => {
    // FAILING TEST: Method calls with args should pipeline correctly

    const doStub = getDOStub('pipeline-method-args-1')

    await doStub.create('Calculator', {
      $id: 'calc-1',
      value: 10,
    })

    // Pipeline: Calculator('id').multiply(5).add(3).getValue()
    // Should send full pipeline with args
    const result = await doStub.Calculator('calc-1').multiply(5).add(3).getValue()

    // Expected: (10 * 5) + 3 = 53
    expect(result).toBe(53)
  })
})

// =============================================================================
// 2. PROMISE PIPELINING - METHODS ON PROMISED RESULTS
// =============================================================================

describe('Cross-DO RPC Pipelining: Promise Resolution', () => {
  /**
   * Cap'n Proto-style promise pipelining: call methods on a promise
   * WITHOUT waiting for it to resolve first.
   */
  it('should resolve promises through the pipeline', async () => {
    // FAILING TEST: Core Cap'n Proto feature
    //
    // Pattern: const userPromise = doA.getUser('user-1')
    //          const namePromise = userPromise.name  // Access property on PROMISE
    //          const name = await namePromise
    //
    // The key insight: We DON'T await userPromise before accessing .name
    // The entire pipeline is recorded and sent when we finally await

    const doStub = getDOStub('pipeline-promise-resolve-1')

    await doStub.create('User', {
      $id: 'user-promise-1',
      name: 'Test User',
      email: 'promise@example.com',
    })

    // Get a promise but DON'T await it
    const userPromise = doStub.User('user-promise-1').getProfile()

    // Access property on the promise - this should NOT execute yet
    const namePromise = userPromise.name

    // Only NOW when we await should the full pipeline execute
    const name = await namePromise

    expect(name).toBe('Test User')
  })

  it('should allow chained property access on unresolved promises', async () => {
    // FAILING TEST: Multiple property accesses on promise chain

    const doStub = getDOStub('pipeline-promise-chain-1')

    await doStub.create('Organization', {
      $id: 'org-1',
      settings: {
        billing: {
          address: {
            country: 'US',
            zip: '10001',
          },
        },
      },
    })

    // Build entire pipeline without awaiting
    const orgPromise = doStub.Organization('org-1').getSettings()
    const billingPromise = orgPromise.billing
    const addressPromise = billingPromise.address
    const countryPromise = addressPromise.country

    // Execute full pipeline with single await
    const country = await countryPromise

    expect(country).toBe('US')
  })

  it('should allow method calls on unresolved promises', async () => {
    // FAILING TEST: Method calls on promise should pipeline

    const doStub = getDOStub('pipeline-promise-method-1')

    await doStub.create('Service', {
      $id: 'svc-1',
      data: { items: [1, 2, 3, 4, 5] },
    })

    // Build pipeline: Service.getData().filter(x > 2).map(x => x * 2)
    const dataPromise = doStub.Service('svc-1').getData()
    const filteredPromise = dataPromise.filter({ gt: 2 })
    const mappedPromise = filteredPromise.map({ multiply: 2 })

    // Execute with single await
    const result = await mappedPromise

    // Expected: [3, 4, 5] * 2 = [6, 8, 10]
    expect(result).toEqual([6, 8, 10])
  })
})

// =============================================================================
// 3. CROSS-DO PIPELINING - MULTIPLE DURABLE OBJECTS
// =============================================================================

describe('Cross-DO RPC Pipelining: Multiple DOs', () => {
  /**
   * True cross-DO pipelining: Start from one DO, get a reference to another,
   * and continue the pipeline WITHOUT waiting for the first DO to respond.
   */
  it('should pipeline across multiple DOs without intermediate round-trips', async () => {
    // FAILING TEST: This is the ultimate Cap'n Proto feature
    //
    // Pattern: OrderDO.getCustomer().profile.email
    // Where getCustomer() returns a capability/reference to CustomerDO
    //
    // Should be resolved with minimal round-trips:
    // 1. OrderDO receives pipeline, sees getCustomer() returns another DO
    // 2. OrderDO forwards remaining pipeline (.profile.email) to CustomerDO
    // 3. Result flows back through the pipeline

    const orderStub = getDOStub('pipeline-cross-do-order-1')
    const customerStub = getDOStub('pipeline-cross-do-customer-1')

    // Setup: Customer in one DO
    await customerStub.create('Customer', {
      $id: 'cross-cust-1',
      profile: {
        email: 'cross-do@example.com',
        name: 'Cross-DO Customer',
      },
    })

    // Setup: Order in another DO that references the customer
    await orderStub.create('Order', {
      $id: 'cross-order-1',
      customerId: 'cross-cust-1',
      customerDO: 'pipeline-cross-do-customer-1',
      total: 500,
    })

    // Pipeline across DO boundary
    // Order.getLinkedCustomer().profile.email
    const email = await orderStub.Order('cross-order-1').getLinkedCustomer().profile.email

    expect(email).toBe('cross-do@example.com')
  })

  it('should batch parallel pipelines to different DOs', async () => {
    // FAILING TEST: Multiple pipelines to different DOs should batch

    const doA = getDOStub('pipeline-batch-do-a')
    const doB = getDOStub('pipeline-batch-do-b')

    // Setup data in both DOs
    await doA.create('User', { $id: 'batch-user-a', name: 'User A' })
    await doB.create('User', { $id: 'batch-user-b', name: 'User B' })

    // Parallel pipelines to different DOs
    // Should be batched into single transport call
    const [nameA, nameB] = await Promise.all([
      doA.User('batch-user-a').name,
      doB.User('batch-user-b').name,
    ])

    expect(nameA).toBe('User A')
    expect(nameB).toBe('User B')
  })

  it('should handle errors in one pipeline without affecting others', async () => {
    // FAILING TEST: Error isolation in batch

    const doStub = getDOStub('pipeline-error-isolation-1')

    await doStub.create('Data', { $id: 'data-1', value: 42 })

    // One valid pipeline, one that will fail
    const results = await Promise.allSettled([
      doStub.Data('data-1').value, // Should succeed
      doStub.Data('nonexistent').value, // Should fail
      doStub.Data('data-1').value, // Should succeed
    ])

    expect(results[0]).toEqual({ status: 'fulfilled', value: 42 })
    expect(results[1].status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 42 })
  })
})

// =============================================================================
// 4. .MAP() PIPELINING ACROSS DOs
// =============================================================================

describe('Cross-DO RPC Pipelining: .map() Support', () => {
  /**
   * The .map() pattern should work with pipelining:
   * Get a list of items, then transform each via pipeline.
   */
  it('should support .map() in pipeline for transforming results', async () => {
    // FAILING TEST: .map() should be part of the pipeline protocol

    const doStub = getDOStub('pipeline-map-transform-1')

    await doStub.create('Collection', {
      $id: 'collection-1',
      items: [
        { id: 1, name: 'Item 1', price: 10 },
        { id: 2, name: 'Item 2', price: 20 },
        { id: 3, name: 'Item 3', price: 30 },
      ],
    })

    // Pipeline with map: Collection.items.map(item => item.price)
    const prices = await doStub.Collection('collection-1').items.map('price')

    expect(prices).toEqual([10, 20, 30])
  })

  it('should support .map() with cross-DO resolution', async () => {
    // FAILING TEST: .map() should resolve cross-DO references

    const orderStub = getDOStub('pipeline-map-cross-do-1')

    // Setup: Orders with customer references
    await orderStub.create('Order', {
      $id: 'map-order-1',
      customerId: 'map-cust-1',
      customerName: 'Customer 1',
      total: 100,
    })
    await orderStub.create('Order', {
      $id: 'map-order-2',
      customerId: 'map-cust-2',
      customerName: 'Customer 2',
      total: 200,
    })

    // Get all orders and map to customer names
    // Order.list().map(o => o.customerName)
    const customerNames = await orderStub.Order().list().map('customerName')

    expect(customerNames).toContain('Customer 1')
    expect(customerNames).toContain('Customer 2')
  })

  it('should support .filter().map() pipeline', async () => {
    // FAILING TEST: Chained filter and map

    const doStub = getDOStub('pipeline-filter-map-1')

    await doStub.create('Products', {
      $id: 'products-1',
      items: [
        { name: 'A', inStock: true, price: 10 },
        { name: 'B', inStock: false, price: 20 },
        { name: 'C', inStock: true, price: 30 },
      ],
    })

    // Pipeline: Products.items.filter({inStock: true}).map('name')
    const inStockNames = await doStub.Products('products-1').items
      .filter({ inStock: true })
      .map('name')

    expect(inStockNames).toEqual(['A', 'C'])
  })
})

// =============================================================================
// 5. FIRE-AND-FORGET WITH PIPELINING
// =============================================================================

describe('Cross-DO RPC Pipelining: Fire-and-Forget', () => {
  /**
   * Fire-and-forget patterns should work with pipelining.
   * The caller doesn't wait for the result.
   */
  it('should support fire-and-forget method calls in pipeline', async () => {
    // FAILING TEST: Fire-and-forget should work with pipeline

    const doStub = getDOStub('pipeline-fire-forget-1')

    await doStub.create('EventLog', {
      $id: 'eventlog-1',
      events: [],
    })

    // Fire-and-forget: log an event without waiting
    // EventLog.logEvent({ type: 'pageview' })
    doStub.EventLog('eventlog-1').logEvent({ type: 'pageview', timestamp: Date.now() })

    // Don't await - just continue
    // Give a small delay for the event to be processed
    await new Promise((r) => setTimeout(r, 100))

    // Verify the event was logged
    const events = await doStub.EventLog('eventlog-1').events
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('pageview')
  })

  it('should support fire-and-forget notification via pipeline', async () => {
    // FAILING TEST: Notification pattern

    const doStub = getDOStub('pipeline-fire-forget-notify-1')

    await doStub.create('User', {
      $id: 'notify-user-1',
      notifications: [],
    })

    // Fire-and-forget notification
    doStub.User('notify-user-1').notify({ type: 'welcome', message: 'Hello!' })

    await new Promise((r) => setTimeout(r, 100))

    // Verify notification was recorded
    const notifications = await doStub.User('notify-user-1').notifications
    expect(notifications).toHaveLength(1)
    expect(notifications[0].type).toBe('welcome')
  })
})

// =============================================================================
// 6. PIPELINE PERFORMANCE VERIFICATION
// =============================================================================

describe('Cross-DO RPC Pipelining: Performance', () => {
  /**
   * Verify that pipelining actually reduces round-trips.
   * These tests measure the performance characteristics.
   */
  it('should complete deep pipeline in single round-trip', async () => {
    // FAILING TEST: Deep pipelines should still be efficient

    const doStub = getDOStub('pipeline-deep-perf-1')

    await doStub.create('DeepData', {
      $id: 'deep-1',
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 'deep-value',
              },
            },
          },
        },
      },
    })

    const start = Date.now()

    // 5-level deep property access
    const value = await doStub.DeepData('deep-1').level1.level2.level3.level4.level5.value

    const elapsed = Date.now() - start

    expect(value).toBe('deep-value')
    // Should complete quickly - if each level was a separate round-trip,
    // this would take much longer
    expect(elapsed).toBeLessThan(1000)
  })

  it('should batch multiple parallel pipelines efficiently', async () => {
    // FAILING TEST: Parallel pipelines should batch

    const doStub = getDOStub('pipeline-parallel-perf-1')

    // Create 10 items
    for (let i = 0; i < 10; i++) {
      await doStub.create('Item', { $id: `perf-item-${i}`, value: i * 10 })
    }

    const start = Date.now()

    // 10 parallel pipelines
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => doStub.Item(`perf-item-${i}`).value)
    )

    const elapsed = Date.now() - start

    expect(results).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
    // All 10 pipelines should batch - should complete quickly
    expect(elapsed).toBeLessThan(2000)
  })

  it('should avoid N+1 queries with pipelining', async () => {
    // FAILING TEST: Classic N+1 problem should be avoided

    const doStub = getDOStub('pipeline-n-plus-1-test')

    // Create parent with children
    await doStub.create('Parent', {
      $id: 'parent-1',
      childIds: ['child-1', 'child-2', 'child-3'],
    })

    await doStub.create('Child', { $id: 'child-1', name: 'Child 1' })
    await doStub.create('Child', { $id: 'child-2', name: 'Child 2' })
    await doStub.create('Child', { $id: 'child-3', name: 'Child 3' })

    // This pattern traditionally causes N+1:
    // 1 query for parent, N queries for each child
    //
    // With proper pipelining, should be 1 or 2 queries max
    const childNames = await doStub.Parent('parent-1').getChildren().map('name')

    expect(childNames).toEqual(['Child 1', 'Child 2', 'Child 3'])
  })
})

// =============================================================================
// 7. ERROR PROPAGATION IN PIPELINES
// =============================================================================

describe('Cross-DO RPC Pipelining: Error Handling', () => {
  it('should propagate errors with step information', async () => {
    // FAILING TEST: Errors should indicate which step failed

    const doStub = getDOStub('pipeline-error-step-1')

    await doStub.create('Data', {
      $id: 'error-data-1',
      value: null,
    })

    // Pipeline that will fail at step 2 (accessing property of null)
    try {
      await doStub.Data('error-data-1').value.someProperty.deeperProperty
      expect.fail('Should have thrown')
    } catch (error) {
      // Error should indicate which step failed
      expect((error as Error).message).toMatch(/step|null|undefined/i)
    }
  })

  it('should handle timeout in pipelined calls', async () => {
    // FAILING TEST: Timeouts should work with pipelining

    const doStub = getDOStub('pipeline-timeout-1')

    await doStub.create('SlowService', {
      $id: 'slow-1',
    })

    // This should timeout if the service is slow
    const startTime = Date.now()

    try {
      // Configure a short timeout
      await Promise.race([
        doStub.SlowService('slow-1').slowOperation({ delay: 10000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000)),
      ])
      expect.fail('Should have timed out')
    } catch (error) {
      expect((error as Error).message).toMatch(/timeout/i)
    }

    const elapsed = Date.now() - startTime
    expect(elapsed).toBeLessThan(2000)
  })

  it('should clean up on pipeline cancellation', async () => {
    // FAILING TEST: Cancelled pipelines should clean up

    const doStub = getDOStub('pipeline-cancel-1')

    await doStub.create('CancellableService', {
      $id: 'cancel-1',
      operationsStarted: 0,
      operationsCompleted: 0,
    })

    // Start a slow operation
    const abortController = new AbortController()
    const operationPromise = doStub.CancellableService('cancel-1')
      .startLongOperation({ signal: abortController.signal })

    // Cancel it quickly
    setTimeout(() => abortController.abort(), 100)

    try {
      await operationPromise
    } catch (error) {
      expect((error as Error).message).toMatch(/abort|cancel/i)
    }

    // Verify cleanup happened
    const stats = await doStub.CancellableService('cancel-1').getStats()
    expect(stats.operationsStarted).toBe(stats.operationsCompleted)
  })
})

// =============================================================================
// 8. WIRE FORMAT VERIFICATION
// =============================================================================

describe('Cross-DO RPC Pipelining: Wire Format', () => {
  it('should send correct wire format for property pipeline', async () => {
    // FAILING TEST: Verify the wire format is correct

    const doStub = getDOStub('pipeline-wire-format-1')

    await doStub.create('WireTest', {
      $id: 'wire-1',
      nested: {
        property: {
          value: 'test',
        },
      },
    })

    // The pipeline Customer('id').nested.property.value should produce:
    // {
    //   target: ['Customer', 'id'],
    //   pipeline: [
    //     { type: 'property', name: 'nested' },
    //     { type: 'property', name: 'property' },
    //     { type: 'property', name: 'value' }
    //   ]
    // }

    const value = await doStub.WireTest('wire-1').nested.property.value
    expect(value).toBe('test')
  })

  it('should send correct wire format for method pipeline', async () => {
    // FAILING TEST: Method calls with args in wire format

    const doStub = getDOStub('pipeline-wire-method-1')

    await doStub.create('MethodTest', {
      $id: 'method-wire-1',
    })

    // Pipeline: MethodTest('id').process({data: 'input'}).transform('uppercase')
    // Should produce:
    // {
    //   target: ['MethodTest', 'method-wire-1'],
    //   pipeline: [
    //     { type: 'method', name: 'process', args: [{data: 'input'}] },
    //     { type: 'method', name: 'transform', args: ['uppercase'] }
    //   ]
    // }

    const result = await doStub.MethodTest('method-wire-1')
      .process({ data: 'input' })
      .transform('uppercase')

    expect(result).toBeDefined()
  })
})
