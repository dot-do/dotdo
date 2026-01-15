/**
 * DO Context Tests - TDD RED Phase
 *
 * Tests for DO base class where `this` IS the workflow context.
 * Instead of accessing methods via a separate `$` object:
 *   this.$.send('Event.type', data)
 *
 * The DO class itself should BE the context:
 *   this.send('Event.type', data)
 *
 * This unifies the API and eliminates the indirection.
 *
 * All tests should FAIL until the DO base class is updated.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Types for the new DO pattern
// =============================================================================

/**
 * Expected interface for DO instances where `this` is the context.
 * The DO class should implement all these methods directly.
 */
interface DOContextInterface {
  // Event methods
  send(eventType: string, data: unknown): string
  on: Record<string, Record<string, (handler: EventHandler) => () => void>>

  // Durable execution
  do<T>(action: () => T | Promise<T>, options?: DoOptions): Promise<T>
  try<T>(action: () => T | Promise<T>, options?: TryOptions): Promise<T>

  // Scheduling
  every: ScheduleBuilder & ((n: number) => IntervalBuilder)

  // Cross-DO RPC - dynamic Noun accessor
  [noun: string]: unknown
}

interface EventHandler {
  (event: {
    id: string
    type: string
    subject: string
    object: string
    data: unknown
    timestamp: Date
  }): void | Promise<void>
}

interface DoOptions {
  stepId?: string
  maxRetries?: number
}

interface TryOptions {
  timeout?: number
}

interface TimeBuilder {
  at9am: (handler: Function) => () => void
  at: (time: string) => (handler: Function) => () => void
}

interface ScheduleBuilder {
  Monday: TimeBuilder
  day: TimeBuilder
  hour: (handler: Function) => () => void
}

interface IntervalBuilder {
  minutes: (handler: Function) => () => void
  hours: (handler: Function) => () => void
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a fresh DOCore instance for testing.
 * The DOCore class should be updated to implement DOContextInterface.
 */
function getContextDO(name = 'context-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id) as unknown as DurableObjectStub & DOContextInterface
}

// =============================================================================
// 1. EVENT METHODS (this.send, this.on)
// =============================================================================

describe('Event Methods - this.send()', () => {
  it('should emit event and return event ID', async () => {
    const doInstance = getContextDO('send-test-1')

    // send() should exist directly on `this` (the DO instance)
    // It should emit an event and return an event ID
    const eventId = await doInstance.send('Customer.signup', { email: 'alice@example.com' })

    expect(eventId).toBeDefined()
    expect(typeof eventId).toBe('string')
    expect(eventId).toMatch(/^evt_/)
  })

  it('should fire-and-forget without blocking', async () => {
    const doInstance = getContextDO('send-test-2')

    const start = Date.now()

    // send() is fire-and-forget - it should return immediately
    // even if handlers take time to execute
    const eventId = await doInstance.send('Order.created', { orderId: '123' })

    const elapsed = Date.now() - start

    expect(eventId).toBeDefined()
    // Should return very quickly (< 100ms)
    expect(elapsed).toBeLessThan(100)
  })

  it('should pass data to event handlers', async () => {
    const doInstance = getContextDO('send-test-3')

    // First register a handler via RPC (preparation step)
    const receivedData: unknown[] = []
    const unsubscribe = doInstance.on.Payment.received((event) => {
      receivedData.push(event.data)
    })

    // Then send an event
    await doInstance.send('Payment.received', { amount: 99.99, currency: 'USD' })

    // Wait for async handlers
    await new Promise((r) => setTimeout(r, 50))

    expect(receivedData).toHaveLength(1)
    expect(receivedData[0]).toEqual({ amount: 99.99, currency: 'USD' })

    // Cleanup
    if (typeof unsubscribe === 'function') {
      unsubscribe()
    }
  })
})

describe('Event Methods - this.on.Noun.verb()', () => {
  it('should register handler and return unsubscribe function', async () => {
    const doInstance = getContextDO('on-test-1')

    // on.Noun.verb() should exist directly on `this`
    // It registers a handler and returns an unsubscribe function
    const unsubscribe = doInstance.on.Customer.signup(() => {
      // Handler body
    })

    expect(typeof unsubscribe).toBe('function')

    // Should be able to call unsubscribe
    unsubscribe()
  })

  it('should call handler when matching event is dispatched', async () => {
    const doInstance = getContextDO('on-test-2')

    let handlerCalled = false
    let receivedEvent: unknown = null

    doInstance.on.Invoice.created((event) => {
      handlerCalled = true
      receivedEvent = event
    })

    // Dispatch the event via send
    await doInstance.send('Invoice.created', { invoiceId: 'INV-001' })

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50))

    expect(handlerCalled).toBe(true)
    expect(receivedEvent).toMatchObject({
      type: 'Invoice.created',
      data: { invoiceId: 'INV-001' },
    })
  })

  it('should unsubscribe handler when unsubscribe is called', async () => {
    const doInstance = getContextDO('on-test-3')

    let callCount = 0
    const unsubscribe = doInstance.on.User.updated(() => {
      callCount++
    })

    // Send first event
    await doInstance.send('User.updated', { userId: '1' })
    await new Promise((r) => setTimeout(r, 50))
    expect(callCount).toBe(1)

    // Unsubscribe
    unsubscribe()

    // Send second event - handler should NOT be called
    await doInstance.send('User.updated', { userId: '2' })
    await new Promise((r) => setTimeout(r, 50))
    expect(callCount).toBe(1) // Still 1, not 2
  })
})

describe('Event Methods - Wildcard Handlers', () => {
  it('should support wildcard on noun: this.on.*.created()', async () => {
    const doInstance = getContextDO('wildcard-test-1')

    const createdEvents: string[] = []

    // Wildcard on noun - matches any noun with 'created' verb
    doInstance.on['*'].created((event) => {
      createdEvents.push(event.type)
    })

    await doInstance.send('Customer.created', {})
    await doInstance.send('Order.created', {})
    await doInstance.send('Invoice.created', {})
    await doInstance.send('Customer.deleted', {}) // Should NOT match

    await new Promise((r) => setTimeout(r, 100))

    expect(createdEvents).toContain('Customer.created')
    expect(createdEvents).toContain('Order.created')
    expect(createdEvents).toContain('Invoice.created')
    expect(createdEvents).not.toContain('Customer.deleted')
    expect(createdEvents).toHaveLength(3)
  })

  it('should support wildcard on verb: this.on.Customer.*()', async () => {
    const doInstance = getContextDO('wildcard-test-2')

    const customerEvents: string[] = []

    // Wildcard on verb - matches any verb on 'Customer' noun
    doInstance.on.Customer['*']((event) => {
      customerEvents.push(event.type)
    })

    await doInstance.send('Customer.created', {})
    await doInstance.send('Customer.updated', {})
    await doInstance.send('Customer.deleted', {})
    await doInstance.send('Order.created', {}) // Should NOT match

    await new Promise((r) => setTimeout(r, 100))

    expect(customerEvents).toContain('Customer.created')
    expect(customerEvents).toContain('Customer.updated')
    expect(customerEvents).toContain('Customer.deleted')
    expect(customerEvents).not.toContain('Order.created')
    expect(customerEvents).toHaveLength(3)
  })

  it('should support double wildcard: this.on.*.*()', async () => {
    const doInstance = getContextDO('wildcard-test-3')

    const allEvents: string[] = []

    // Double wildcard - matches all events
    doInstance.on['*']['*']((event) => {
      allEvents.push(event.type)
    })

    await doInstance.send('Customer.created', {})
    await doInstance.send('Order.shipped', {})
    await doInstance.send('Payment.failed', {})

    await new Promise((r) => setTimeout(r, 100))

    expect(allEvents).toHaveLength(3)
    expect(allEvents).toContain('Customer.created')
    expect(allEvents).toContain('Order.shipped')
    expect(allEvents).toContain('Payment.failed')
  })
})

// =============================================================================
// 2. DURABLE EXECUTION (this.do, this.try)
// =============================================================================

describe('Durable Execution - this.do()', () => {
  it('should execute action with retry on failure', async () => {
    const doInstance = getContextDO('do-test-1')

    let attempts = 0
    const action = async () => {
      attempts++
      if (attempts < 3) {
        throw new Error('Temporary failure')
      }
      return { success: true, attempts }
    }

    // do() should retry with exponential backoff
    const result = await doInstance.do(action, { stepId: 'step-1', maxRetries: 5 })

    expect(result).toEqual({ success: true, attempts: 3 })
    expect(attempts).toBe(3)
  })

  it('should use stepId for idempotency', async () => {
    const doInstance = getContextDO('do-test-2')

    let executionCount = 0
    const action = async () => {
      executionCount++
      return { executionCount }
    }

    // First call
    const result1 = await doInstance.do(action, { stepId: 'unique-step-123' })
    expect(result1.executionCount).toBe(1)

    // Second call with same stepId should return cached result
    const result2 = await doInstance.do(action, { stepId: 'unique-step-123' })
    expect(result2.executionCount).toBe(1) // Same as first, not 2
    expect(executionCount).toBe(1) // Action only executed once
  })

  it('should throw after maxRetries exhausted', async () => {
    const doInstance = getContextDO('do-test-3')

    const action = async () => {
      throw new Error('Persistent failure')
    }

    await expect(doInstance.do(action, { stepId: 'fail-step', maxRetries: 3 })).rejects.toThrow(
      'Persistent failure'
    )
  })

  it('should record action in log', async () => {
    const doInstance = getContextDO('do-test-4')

    await doInstance.do(
      async () => ({ logged: true }),
      { stepId: 'logged-step-456' }
    )

    // Action log should be queryable
    const actionLog = await doInstance.getActionLog()
    const entry = actionLog.find((e: { stepId: string }) => e.stepId === 'logged-step-456')

    expect(entry).toBeDefined()
    expect(entry?.status).toBe('completed')
  })
})

describe('Durable Execution - this.try()', () => {
  it('should execute action once without retry', async () => {
    const doInstance = getContextDO('try-test-1')

    let attempts = 0
    const action = async () => {
      attempts++
      if (attempts < 3) {
        throw new Error('First failure')
      }
      return { success: true }
    }

    // try() should NOT retry - it should fail on first attempt
    await expect(doInstance.try(action)).rejects.toThrow('First failure')
    expect(attempts).toBe(1) // Only one attempt
  })

  it('should support timeout option', async () => {
    const doInstance = getContextDO('try-test-2')

    const slowAction = async () => {
      await new Promise((r) => setTimeout(r, 5000)) // 5 second delay
      return { completed: true }
    }

    // try() with timeout should reject if action takes too long
    await expect(doInstance.try(slowAction, { timeout: 100 })).rejects.toThrow('Timeout')
  })

  it('should return result on success', async () => {
    const doInstance = getContextDO('try-test-3')

    const result = await doInstance.try(async () => ({ value: 42 }))

    expect(result).toEqual({ value: 42 })
  })

  it('should not persist to action log', async () => {
    const doInstance = getContextDO('try-test-4')

    await doInstance.try(async () => ({ transient: true }))

    // try() does not persist to action log
    const actionLog = await doInstance.getActionLog()
    const hasTransient = actionLog.some((e: { result?: { transient?: boolean } }) => e.result?.transient === true)

    expect(hasTransient).toBe(false)
  })
})

// =============================================================================
// 3. SCHEDULING (this.every)
// =============================================================================

describe('Scheduling - this.every.day.at()', () => {
  it('should register daily schedule at specific time', async () => {
    const doInstance = getContextDO('schedule-test-1')

    let scheduledHandler: Function | null = null

    // every.day.at('9am') should register a CRON schedule
    const unsubscribe = doInstance.every.day.at('9am')((handler: Function) => {
      scheduledHandler = handler
    })

    expect(typeof unsubscribe).toBe('function')

    // Verify the schedule was registered
    const schedule = await doInstance.getSchedule('0 9 * * *')
    expect(schedule).toBeDefined()
  })

  it('should support various time formats', async () => {
    const doInstance = getContextDO('schedule-test-2')

    // Different time formats should all work
    doInstance.every.day.at('6pm')(() => {})
    doInstance.every.day.at('9:30am')(() => {})
    doInstance.every.day.at('noon')(() => {})
    doInstance.every.day.at('midnight')(() => {})

    const schedule6pm = await doInstance.getSchedule('0 18 * * *')
    const schedule930am = await doInstance.getSchedule('30 9 * * *')
    const scheduleNoon = await doInstance.getSchedule('0 12 * * *')
    const scheduleMidnight = await doInstance.getSchedule('0 0 * * *')

    expect(schedule6pm).toBeDefined()
    expect(schedule930am).toBeDefined()
    expect(scheduleNoon).toBeDefined()
    expect(scheduleMidnight).toBeDefined()
  })
})

describe('Scheduling - this.every.Monday.at()', () => {
  it('should register weekly schedule on specific day', async () => {
    const doInstance = getContextDO('schedule-test-3')

    doInstance.every.Monday.at('9am')(() => {})

    // Monday = 1 in CRON
    const schedule = await doInstance.getSchedule('0 9 * * 1')
    expect(schedule).toBeDefined()
  })

  it('should support time shortcuts like at9am', async () => {
    const doInstance = getContextDO('schedule-test-4')

    // at9am is a shortcut for at('9am')
    doInstance.every.Monday.at9am(() => {})

    const schedule = await doInstance.getSchedule('0 9 * * 1')
    expect(schedule).toBeDefined()
  })
})

describe('Scheduling - this.every(n).minutes()', () => {
  it('should register interval schedule', async () => {
    const doInstance = getContextDO('schedule-test-5')

    // every(5).minutes should register an interval
    doInstance.every(5).minutes(() => {})

    const schedule = await doInstance.getSchedule('*/5 * * * *')
    expect(schedule).toBeDefined()
  })

  it('should support hours interval', async () => {
    const doInstance = getContextDO('schedule-test-6')

    doInstance.every(2).hours(() => {})

    const schedule = await doInstance.getSchedule('0 */2 * * *')
    expect(schedule).toBeDefined()
  })

  it('should return unsubscribe function', async () => {
    const doInstance = getContextDO('schedule-test-7')

    const unsubscribe = doInstance.every(10).minutes(() => {})

    expect(typeof unsubscribe).toBe('function')

    // After unsubscribe, schedule should be removed
    unsubscribe()

    const schedule = await doInstance.getSchedule('*/10 * * * *')
    expect(schedule).toBeUndefined()
  })
})

describe('Scheduling - this.every.hour()', () => {
  it('should register hourly schedule', async () => {
    const doInstance = getContextDO('schedule-test-8')

    doInstance.every.hour(() => {})

    const schedule = await doInstance.getSchedule('0 * * * *')
    expect(schedule).toBeDefined()
  })
})

// =============================================================================
// 4. CROSS-DO RPC (this.Customer(id))
// =============================================================================

describe('Cross-DO RPC - this.Noun(id)', () => {
  it('should return pipelined stub for cross-DO calls', async () => {
    const doInstance = getContextDO('rpc-test-1')

    // Customer(id) should return a pipelined stub
    const customerStub = doInstance.Customer('cust-123')

    expect(customerStub).toBeDefined()
    expect(typeof customerStub).toBe('object')
  })

  it('should support method calls on stub', async () => {
    const doInstance = getContextDO('rpc-test-2')

    // Pipelined stub should support method chaining
    const result = await doInstance.Customer('cust-456').notify()

    expect(result).toBeDefined()
  })

  it('should support chained property access', async () => {
    const doInstance = getContextDO('rpc-test-3')

    // Should support $.Customer(id).profile.email pattern
    const result = await doInstance.Customer('cust-789').getProfile()

    expect(result).toBeDefined()
  })

  it('should resolve to actual DO when awaited', async () => {
    const doInstance = getContextDO('rpc-test-4')

    // When awaited, should execute the RPC call
    const result = await doInstance.Order('order-001').getStatus()

    expect(result).toBeDefined()
  })
})

// =============================================================================
// 5. THING CRUD (this.Noun.create, this.Noun.list, etc.)
// =============================================================================

describe('Thing CRUD - this.Noun.create()', () => {
  it('should create a new thing and return it with $id', async () => {
    const doInstance = getContextDO('crud-test-1')

    // Customer.create({}) should create a new Customer thing
    const customer = await doInstance.Customer.create({
      name: 'Alice',
      email: 'alice@example.com',
    })

    expect(customer).toBeDefined()
    expect(customer.$id).toBeDefined()
    expect(customer.$type).toBe('Customer')
    expect(customer.name).toBe('Alice')
    expect(customer.email).toBe('alice@example.com')
  })

  it('should assign timestamps on create', async () => {
    const doInstance = getContextDO('crud-test-2')

    const before = Date.now()
    const product = await doInstance.Product.create({ name: 'Widget', price: 9.99 })
    const after = Date.now()

    expect(product.$createdAt).toBeDefined()
    expect(new Date(product.$createdAt).getTime()).toBeGreaterThanOrEqual(before)
    expect(new Date(product.$createdAt).getTime()).toBeLessThanOrEqual(after)
  })

  it('should allow custom $id on create', async () => {
    const doInstance = getContextDO('crud-test-3')

    const order = await doInstance.Order.create({
      $id: 'ORD-12345',
      total: 99.99,
    })

    expect(order.$id).toBe('ORD-12345')
  })
})

describe('Thing CRUD - this.Noun.list()', () => {
  it('should list all things of a type', async () => {
    const doInstance = getContextDO('crud-test-4')

    // Create some customers
    await doInstance.Customer.create({ name: 'Alice' })
    await doInstance.Customer.create({ name: 'Bob' })
    await doInstance.Customer.create({ name: 'Charlie' })

    const customers = await doInstance.Customer.list()

    expect(Array.isArray(customers)).toBe(true)
    expect(customers.length).toBeGreaterThanOrEqual(3)
    expect(customers.every((c: { $type: string }) => c.$type === 'Customer')).toBe(true)
  })

  it('should support where clause for filtering', async () => {
    const doInstance = getContextDO('crud-test-5')

    await doInstance.Product.create({ name: 'Widget', category: 'electronics' })
    await doInstance.Product.create({ name: 'Gadget', category: 'electronics' })
    await doInstance.Product.create({ name: 'Chair', category: 'furniture' })

    const electronics = await doInstance.Product.list({
      where: { category: 'electronics' },
    })

    expect(electronics.length).toBe(2)
    expect(electronics.every((p: { category: string }) => p.category === 'electronics')).toBe(true)
  })

  it('should support limit and offset', async () => {
    const doInstance = getContextDO('crud-test-6')

    // Create 10 items
    for (let i = 0; i < 10; i++) {
      await doInstance.Item.create({ name: `Item ${i}`, index: i })
    }

    const page1 = await doInstance.Item.list({ limit: 3 })
    const page2 = await doInstance.Item.list({ limit: 3, offset: 3 })

    expect(page1.length).toBe(3)
    expect(page2.length).toBe(3)
    // Pages should not overlap
    const page1Ids = page1.map((i: { $id: string }) => i.$id)
    const page2Ids = page2.map((i: { $id: string }) => i.$id)
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false)
  })
})

describe('Thing CRUD - this.Noun(id).update()', () => {
  it('should update an existing thing', async () => {
    const doInstance = getContextDO('crud-test-7')

    const customer = await doInstance.Customer.create({ name: 'Alice', status: 'active' })
    const customerId = customer.$id

    const updated = await doInstance.Customer(customerId).update({ status: 'inactive' })

    expect(updated.$id).toBe(customerId)
    expect(updated.name).toBe('Alice') // Unchanged
    expect(updated.status).toBe('inactive') // Updated
  })

  it('should update $updatedAt timestamp', async () => {
    const doInstance = getContextDO('crud-test-8')

    const product = await doInstance.Product.create({ name: 'Widget' })
    const originalUpdatedAt = product.$updatedAt

    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 10))

    const updated = await doInstance.Product(product.$id).update({ name: 'Super Widget' })

    expect(new Date(updated.$updatedAt).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime()
    )
  })

  it('should throw if thing does not exist', async () => {
    const doInstance = getContextDO('crud-test-9')

    await expect(
      doInstance.Customer('nonexistent-id-12345').update({ name: 'Ghost' })
    ).rejects.toThrow()
  })
})

describe('Thing CRUD - this.Noun(id).delete()', () => {
  it('should delete an existing thing', async () => {
    const doInstance = getContextDO('crud-test-10')

    const customer = await doInstance.Customer.create({ name: 'ToDelete' })
    const customerId = customer.$id

    const result = await doInstance.Customer(customerId).delete()

    expect(result).toBe(true)

    // Verify it's gone
    const customers = await doInstance.Customer.list()
    expect(customers.find((c: { $id: string }) => c.$id === customerId)).toBeUndefined()
  })

  it('should return false if thing does not exist', async () => {
    const doInstance = getContextDO('crud-test-11')

    const result = await doInstance.Customer('already-deleted-id').delete()

    expect(result).toBe(false)
  })

  it('should emit Noun.deleted event', async () => {
    const doInstance = getContextDO('crud-test-12')

    const deletedEvents: unknown[] = []
    doInstance.on.Product.deleted((event) => {
      deletedEvents.push(event.data)
    })

    const product = await doInstance.Product.create({ name: 'WillBeDeleted' })
    await doInstance.Product(product.$id).delete()

    await new Promise((r) => setTimeout(r, 100))

    expect(deletedEvents.length).toBeGreaterThanOrEqual(1)
    expect(deletedEvents[0]).toMatchObject({ $id: product.$id })
  })
})

// =============================================================================
// 6. INTEGRATION - Combining Features
// =============================================================================

describe('Integration - Event-Driven CRUD', () => {
  it('should emit create events automatically', async () => {
    const doInstance = getContextDO('integration-test-1')

    const createdEvents: unknown[] = []
    doInstance.on.Customer.created((event) => {
      createdEvents.push(event.data)
    })

    await doInstance.Customer.create({ name: 'EventDriven' })

    await new Promise((r) => setTimeout(r, 100))

    expect(createdEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('should support scheduled thing operations', async () => {
    const doInstance = getContextDO('integration-test-2')

    // Schedule a cleanup job
    doInstance.every.day.at('3am')(() => {
      // This would clean up old things
      return doInstance.Temp.list({ where: { expired: true } })
    })

    const schedule = await doInstance.getSchedule('0 3 * * *')
    expect(schedule).toBeDefined()
  })

  it('should support durable CRUD operations', async () => {
    const doInstance = getContextDO('integration-test-3')

    // Durable create with retry semantics
    const customer = await doInstance.do(
      () => doInstance.Customer.create({ name: 'DurableCustomer' }),
      { stepId: 'create-durable-customer' }
    )

    expect(customer.$id).toBeDefined()

    // Second call with same stepId should return cached result
    const customer2 = await doInstance.do(
      () => doInstance.Customer.create({ name: 'WouldBeDifferent' }),
      { stepId: 'create-durable-customer' }
    )

    expect(customer2.$id).toBe(customer.$id) // Same ID = cached
  })
})
