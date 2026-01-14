/**
 * Event Dispatcher Tests
 *
 * Tests for the EventDispatcher class covering:
 * - Handler registration and ordering
 * - Event dispatch with priority
 * - Dead letter queue handling
 * - Retry with exponential backoff
 * - Event acknowledgment
 * - Wildcard pattern matching
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  EventDispatcher,
  createEventDispatcher,
  calculateBackoff,
  parseEventType,
  matchesPattern,
  type DispatchableEvent,
  type DLQEntry,
  type ExecutionTrace,
  type Acknowledgment,
} from '../event-dispatcher'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createTestEvent(type: string, data: unknown = {}): DispatchableEvent {
  return {
    id: `evt-${crypto.randomUUID()}`,
    type,
    source: `test/${type.split('.')[0]}`,
    data,
    timestamp: new Date(),
  }
}

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility Functions', () => {
  describe('calculateBackoff', () => {
    it('calculates exponential backoff with base delay', () => {
      const base = 1000

      // First retry: 1000ms * 2^0 = 1000ms (plus jitter)
      const retry0 = calculateBackoff(0, base)
      const diff0 = retry0.getTime() - Date.now()
      expect(diff0).toBeGreaterThanOrEqual(1000)
      expect(diff0).toBeLessThanOrEqual(1250) // 1000 + 25% jitter

      // Second retry: 1000ms * 2^1 = 2000ms (plus jitter)
      const retry1 = calculateBackoff(1, base)
      const diff1 = retry1.getTime() - Date.now()
      expect(diff1).toBeGreaterThanOrEqual(2000)
      expect(diff1).toBeLessThanOrEqual(2500)

      // Third retry: 1000ms * 2^2 = 4000ms (plus jitter)
      const retry2 = calculateBackoff(2, base)
      const diff2 = retry2.getTime() - Date.now()
      expect(diff2).toBeGreaterThanOrEqual(4000)
      expect(diff2).toBeLessThanOrEqual(5000)
    })

    it('caps delay at maximum (1 hour)', () => {
      // Very high retry count should cap at 1 hour
      const maxHour = 60 * 60 * 1000
      const retry20 = calculateBackoff(20, 1000)
      const diff = retry20.getTime() - Date.now()
      expect(diff).toBeLessThanOrEqual(maxHour * 1.25) // with jitter
    })
  })

  describe('parseEventType', () => {
    it('parses noun and verb from event type', () => {
      expect(parseEventType('Customer.created')).toEqual({
        noun: 'Customer',
        verb: 'created',
      })
      expect(parseEventType('Order.placed')).toEqual({
        noun: 'Order',
        verb: 'placed',
      })
    })

    it('handles wildcards', () => {
      expect(parseEventType('*.created')).toEqual({
        noun: '*',
        verb: 'created',
      })
      expect(parseEventType('Customer.*')).toEqual({
        noun: 'Customer',
        verb: '*',
      })
      expect(parseEventType('*.*')).toEqual({
        noun: '*',
        verb: '*',
      })
    })

    it('handles missing parts', () => {
      expect(parseEventType('Customer')).toEqual({
        noun: 'Customer',
        verb: '*',
      })
      expect(parseEventType('')).toEqual({
        noun: '*',
        verb: '*',
      })
    })
  })

  describe('matchesPattern', () => {
    it('matches exact event types', () => {
      expect(matchesPattern('Customer.created', 'Customer.created')).toBe(true)
      expect(matchesPattern('Customer.created', 'Customer.updated')).toBe(false)
      expect(matchesPattern('Customer.created', 'Order.created')).toBe(false)
    })

    it('matches verb wildcards', () => {
      expect(matchesPattern('Customer.created', '*.created')).toBe(true)
      expect(matchesPattern('Order.created', '*.created')).toBe(true)
      expect(matchesPattern('Customer.updated', '*.created')).toBe(false)
    })

    it('matches noun wildcards', () => {
      expect(matchesPattern('Customer.created', 'Customer.*')).toBe(true)
      expect(matchesPattern('Customer.updated', 'Customer.*')).toBe(true)
      expect(matchesPattern('Order.created', 'Customer.*')).toBe(false)
    })

    it('matches global wildcards', () => {
      expect(matchesPattern('Customer.created', '*.*')).toBe(true)
      expect(matchesPattern('Order.placed', '*.*')).toBe(true)
      expect(matchesPattern('Any.thing', '*.*')).toBe(true)
    })
  })
})

// ============================================================================
// HANDLER REGISTRATION TESTS
// ============================================================================

describe('Handler Registration', () => {
  let dispatcher: EventDispatcher

  beforeEach(() => {
    dispatcher = new EventDispatcher()
  })

  afterEach(() => {
    dispatcher.clear()
  })

  it('registers handlers and returns unique IDs', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    const id1 = dispatcher.registerHandler('Customer.created', handler1)
    const id2 = dispatcher.registerHandler('Customer.created', handler2)

    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
  })

  it('stores handler with default options', () => {
    const handler = vi.fn()
    const id = dispatcher.registerHandler('Customer.created', handler)

    const registered = dispatcher.getHandler(id)
    expect(registered).toBeDefined()
    expect(registered?.priority).toBe(0)
    expect(registered?.maxRetries).toBe(3)
    expect(registered?.stats.executionCount).toBe(0)
  })

  it('stores handler with custom options', () => {
    const handler = vi.fn()
    const id = dispatcher.registerHandler('Customer.created', handler, {
      priority: 10,
      name: 'customHandler',
      maxRetries: 5,
      retryDelayMs: 2000,
      timeoutMs: 5000,
    })

    const registered = dispatcher.getHandler(id)
    expect(registered?.priority).toBe(10)
    expect(registered?.name).toBe('customHandler')
    expect(registered?.maxRetries).toBe(5)
    expect(registered?.retryDelayMs).toBe(2000)
    expect(registered?.timeoutMs).toBe(5000)
  })

  it('unregisters handlers by ID', () => {
    const handler = vi.fn()
    const id = dispatcher.registerHandler('Customer.created', handler)

    expect(dispatcher.getHandler(id)).toBeDefined()

    const removed = dispatcher.unregisterHandler(id)
    expect(removed).toBe(true)
    expect(dispatcher.getHandler(id)).toBeUndefined()
  })

  it('returns false when unregistering non-existent handler', () => {
    const removed = dispatcher.unregisterHandler('non-existent-id')
    expect(removed).toBe(false)
  })

  it('collects handlers from multiple patterns', () => {
    const exactHandler = vi.fn()
    const wildcardHandler = vi.fn()
    const globalHandler = vi.fn()

    dispatcher.registerHandler('Customer.created', exactHandler)
    dispatcher.registerHandler('*.created', wildcardHandler)
    dispatcher.registerHandler('*.*', globalHandler)

    const handlers = dispatcher.getHandlers('Customer.created')
    expect(handlers).toHaveLength(3)
  })
})

// ============================================================================
// HANDLER ORDERING TESTS
// ============================================================================

describe('Handler Ordering', () => {
  let dispatcher: EventDispatcher

  beforeEach(() => {
    dispatcher = new EventDispatcher()
  })

  afterEach(() => {
    dispatcher.clear()
  })

  it('executes handlers in priority order (higher first)', async () => {
    const executionOrder: number[] = []

    dispatcher.registerHandler('Test.event', () => executionOrder.push(1), { priority: 1 })
    dispatcher.registerHandler('Test.event', () => executionOrder.push(10), { priority: 10 })
    dispatcher.registerHandler('Test.event', () => executionOrder.push(5), { priority: 5 })

    await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(executionOrder).toEqual([10, 5, 1])
  })

  it('maintains registration order for same priority', async () => {
    const executionOrder: number[] = []

    dispatcher.registerHandler('Test.event', () => executionOrder.push(1), { priority: 5 })
    dispatcher.registerHandler('Test.event', () => executionOrder.push(2), { priority: 5 })
    dispatcher.registerHandler('Test.event', () => executionOrder.push(3), { priority: 5 })

    await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(executionOrder).toEqual([1, 2, 3])
  })

  it('executes exact matches before wildcards (same priority)', async () => {
    const executionOrder: string[] = []

    dispatcher.registerHandler('*.created', () => executionOrder.push('wildcard'))
    dispatcher.registerHandler('Customer.created', () => executionOrder.push('exact'))

    await dispatcher.dispatch(createTestEvent('Customer.created'))

    expect(executionOrder).toEqual(['exact', 'wildcard'])
  })

  it('allows wildcards to run first with higher priority', async () => {
    const executionOrder: string[] = []

    dispatcher.registerHandler('Customer.created', () => executionOrder.push('exact'), { priority: 0 })
    dispatcher.registerHandler('*.created', () => executionOrder.push('wildcard'), { priority: 100 })

    await dispatcher.dispatch(createTestEvent('Customer.created'))

    expect(executionOrder).toEqual(['wildcard', 'exact'])
  })

  it('supports negative priorities (run last)', async () => {
    const executionOrder: number[] = []

    dispatcher.registerHandler('Test.event', () => executionOrder.push(0)) // default priority 0
    dispatcher.registerHandler('Test.event', () => executionOrder.push(-10), { priority: -10 })
    dispatcher.registerHandler('Test.event', () => executionOrder.push(10), { priority: 10 })

    await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(executionOrder).toEqual([10, 0, -10])
  })
})

// ============================================================================
// EVENT DISPATCH TESTS
// ============================================================================

describe('Event Dispatch', () => {
  let dispatcher: EventDispatcher

  beforeEach(() => {
    dispatcher = new EventDispatcher()
  })

  afterEach(() => {
    dispatcher.clear()
  })

  it('dispatches events to matching handlers', async () => {
    const handler = vi.fn()
    dispatcher.registerHandler('Customer.created', handler)

    const event = createTestEvent('Customer.created', { name: 'Alice' })
    const result = await dispatcher.dispatch(event)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(event)
    expect(result.handled).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('isolates errors between handlers', async () => {
    const successHandler = vi.fn()
    const failingHandler = vi.fn().mockRejectedValue(new Error('Handler failed'))

    dispatcher.registerHandler('Test.event', successHandler, { priority: 10 })
    dispatcher.registerHandler('Test.event', failingHandler, { priority: 5 })

    const result = await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(successHandler).toHaveBeenCalledTimes(1)
    expect(failingHandler).toHaveBeenCalledTimes(1)
    expect(result.handled).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe('Handler failed')
  })

  it('tracks wildcard matches separately', async () => {
    dispatcher.registerHandler('Customer.created', vi.fn())
    dispatcher.registerHandler('*.created', vi.fn())
    dispatcher.registerHandler('*.*', vi.fn())

    const result = await dispatcher.dispatch(createTestEvent('Customer.created'))

    expect(result.handled).toBe(3)
    expect(result.wildcardMatches).toBe(2)
  })

  it('respects filter predicates', async () => {
    const handler = vi.fn()
    dispatcher.registerHandler('Order.placed', handler, {
      filter: (event) => (event.data as { amount: number }).amount > 100,
    })

    // Should be filtered out
    await dispatcher.dispatch(createTestEvent('Order.placed', { amount: 50 }))
    expect(handler).not.toHaveBeenCalled()

    // Should execute
    await dispatcher.dispatch(createTestEvent('Order.placed', { amount: 150 }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('supports async filter predicates', async () => {
    const handler = vi.fn()
    dispatcher.registerHandler('Test.event', handler, {
      filter: async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return (event.data as { allowed: boolean }).allowed
      },
    })

    const result1 = await dispatcher.dispatch(createTestEvent('Test.event', { allowed: false }))
    expect(result1.filtered).toBe(1)
    expect(handler).not.toHaveBeenCalled()

    const result2 = await dispatcher.dispatch(createTestEvent('Test.event', { allowed: true }))
    expect(result2.handled).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('treats filter errors as filtered', async () => {
    const handler = vi.fn()
    dispatcher.registerHandler('Test.event', handler, {
      filter: () => {
        throw new Error('Filter error')
      },
    })

    const result = await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(result.filtered).toBe(1)
    expect(result.handled).toBe(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it('records execution traces', async () => {
    const traces: ExecutionTrace[] = []
    const dispatcher = createEventDispatcher({
      onTrace: (trace) => traces.push(trace),
    })

    dispatcher.registerHandler('Test.event', vi.fn(), { name: 'handler1' })
    dispatcher.registerHandler('Test.event', vi.fn().mockRejectedValue(new Error('fail')), { name: 'handler2' })

    const result = await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(result.traces).toHaveLength(2)
    expect(traces).toHaveLength(2)

    const successTrace = traces.find((t) => t.handlerName === 'handler1')
    expect(successTrace?.status).toBe('success')

    const errorTrace = traces.find((t) => t.handlerName === 'handler2')
    expect(errorTrace?.status).toBe('error')
  })

  it('calculates total dispatch duration', async () => {
    dispatcher.registerHandler('Test.event', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const result = await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(result.durationMs).toBeGreaterThanOrEqual(50)
  })

  it('updates handler statistics on execution', async () => {
    const handler = vi.fn()
    const id = dispatcher.registerHandler('Test.event', handler)

    await dispatcher.dispatch(createTestEvent('Test.event'))
    await dispatcher.dispatch(createTestEvent('Test.event'))

    const registered = dispatcher.getHandler(id)
    expect(registered?.stats.executionCount).toBe(2)
    expect(registered?.stats.successCount).toBe(2)
    expect(registered?.stats.lastExecutedAt).toBeDefined()
  })
})

// ============================================================================
// DEAD LETTER QUEUE TESTS
// ============================================================================

describe('Dead Letter Queue', () => {
  let dispatcher: EventDispatcher
  let dlqEntries: DLQEntry[]

  beforeEach(() => {
    dlqEntries = []
    dispatcher = createEventDispatcher({
      onDLQEntry: (entry) => dlqEntries.push(entry),
    })
  })

  afterEach(() => {
    dispatcher.clear()
  })

  it('adds failed handlers to DLQ', async () => {
    dispatcher.registerHandler('Test.event', () => {
      throw new Error('Handler failed')
    }, { name: 'failingHandler' })

    const result = await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(result.dlqEntries).toHaveLength(1)
    expect(dlqEntries).toHaveLength(1)
    expect(dlqEntries[0].error).toBe('Handler failed')
    expect(dlqEntries[0].handlerName).toBe('failingHandler')
    expect(dlqEntries[0].status).toBe('pending')
  })

  it('does not add successful handlers to DLQ', async () => {
    dispatcher.registerHandler('Test.event', vi.fn())

    const result = await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(result.dlqEntries).toHaveLength(0)
    expect(dlqEntries).toHaveLength(0)
  })

  it('stores event data in DLQ entry', async () => {
    dispatcher.registerHandler('Order.placed', () => {
      throw new Error('Failed')
    })

    const event = createTestEvent('Order.placed', { orderId: '123', amount: 100 })
    await dispatcher.dispatch(event)

    const entry = dlqEntries[0]
    expect(entry.eventId).toBe(event.id)
    expect(entry.eventType).toBe('Order.placed')
    expect(entry.data).toEqual({ orderId: '123', amount: 100 })
  })

  it('calculates next retry time with backoff', async () => {
    dispatcher.registerHandler('Test.event', () => {
      throw new Error('Failed')
    }, { retryDelayMs: 1000 })

    await dispatcher.dispatch(createTestEvent('Test.event'))

    const entry = dlqEntries[0]
    const expectedMin = Date.now() + 1000
    const expectedMax = Date.now() + 1250 // with jitter
    expect(entry.nextRetryAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
    expect(entry.nextRetryAt.getTime()).toBeLessThanOrEqual(expectedMax)
  })

  it('retrieves DLQ entries with filters', async () => {
    dispatcher.registerHandler('Event.a', () => { throw new Error('A') }, { name: 'handlerA' })
    dispatcher.registerHandler('Event.b', () => { throw new Error('B') }, { name: 'handlerB' })

    await dispatcher.dispatch(createTestEvent('Event.a'))
    await dispatcher.dispatch(createTestEvent('Event.b'))

    const all = dispatcher.getDLQEntries()
    expect(all).toHaveLength(2)

    const filtered = dispatcher.getDLQEntries({ eventType: 'Event.a' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].eventType).toBe('Event.a')
  })

  it('replays DLQ entries successfully', async () => {
    let shouldFail = true
    dispatcher.registerHandler('Test.event', () => {
      if (shouldFail) throw new Error('Failed')
    }, { name: 'flakyHandler' })

    await dispatcher.dispatch(createTestEvent('Test.event'))
    const entry = dlqEntries[0]
    expect(entry.status).toBe('pending')

    // Fix the handler
    shouldFail = false

    const replayed = await dispatcher.replayDLQEntry(entry.id)
    expect(replayed?.status).toBe('succeeded')
  })

  it('increments retry count on failed replay', async () => {
    dispatcher.registerHandler('Test.event', () => {
      throw new Error('Always fails')
    }, { maxRetries: 3 })

    await dispatcher.dispatch(createTestEvent('Test.event'))
    const entry = dlqEntries[0]
    expect(entry.retryCount).toBe(0)

    const replayed = await dispatcher.replayDLQEntry(entry.id)
    expect(replayed?.retryCount).toBe(1)
    expect(replayed?.status).toBe('pending')
  })

  it('marks entry as exhausted after max retries', async () => {
    dispatcher.registerHandler('Test.event', () => {
      throw new Error('Always fails')
    }, { maxRetries: 2 })

    await dispatcher.dispatch(createTestEvent('Test.event'))
    let entry = dispatcher.getDLQEntry(dlqEntries[0].id)!

    // First replay
    await dispatcher.replayDLQEntry(entry.id)
    entry = dispatcher.getDLQEntry(entry.id)!
    expect(entry.retryCount).toBe(1)
    expect(entry.status).toBe('pending')

    // Second replay - exhausted
    await dispatcher.replayDLQEntry(entry.id)
    entry = dispatcher.getDLQEntry(entry.id)!
    expect(entry.retryCount).toBe(2)
    expect(entry.status).toBe('exhausted')
  })

  it('replays all due DLQ entries', async () => {
    let callCount = 0
    dispatcher.registerHandler('Test.event', () => {
      callCount++
      if (callCount <= 2) throw new Error('First two fail')
    }, { retryDelayMs: 1 }) // Very short delay for testing

    // Dispatch twice to create two DLQ entries
    await dispatcher.dispatch(createTestEvent('Test.event'))
    await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(dlqEntries).toHaveLength(2)

    // Wait for retry delay
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Replay all due entries
    const results = await dispatcher.replayDueDLQEntries()
    expect(results).toHaveLength(2)
  })

  it('purges succeeded DLQ entries', async () => {
    let shouldFail = true
    dispatcher.registerHandler('Test.event', () => {
      if (shouldFail) throw new Error('Failed')
    })

    await dispatcher.dispatch(createTestEvent('Test.event'))
    shouldFail = false
    await dispatcher.replayDLQEntry(dlqEntries[0].id)

    const beforePurge = dispatcher.getDLQEntries()
    expect(beforePurge).toHaveLength(1)
    expect(beforePurge[0].status).toBe('succeeded')

    const purged = dispatcher.purgeDLQEntries('succeeded')
    expect(purged).toBe(1)

    const afterPurge = dispatcher.getDLQEntries()
    expect(afterPurge).toHaveLength(0)
  })
})

// ============================================================================
// EVENT ACKNOWLEDGMENT TESTS
// ============================================================================

describe('Event Acknowledgment', () => {
  let dispatcher: EventDispatcher
  let acknowledgments: Acknowledgment[]

  beforeEach(() => {
    acknowledgments = []
    dispatcher = createEventDispatcher({
      onAcknowledge: (ack) => acknowledgments.push(ack),
    })
  })

  afterEach(() => {
    dispatcher.clear()
  })

  it('acknowledges events after successful dispatch', async () => {
    dispatcher.registerHandler('Test.event', vi.fn())

    const event = createTestEvent('Test.event')
    await dispatcher.dispatch(event)

    expect(acknowledgments).toHaveLength(1)
    expect(acknowledgments[0].eventId).toBe(event.id)
    expect(acknowledgments[0].complete).toBe(true)
  })

  it('marks acknowledgment as incomplete when handlers fail', async () => {
    dispatcher.registerHandler('Test.event', () => {
      throw new Error('Failed')
    })

    const event = createTestEvent('Test.event')
    const result = await dispatcher.dispatch(event)

    expect(result.acknowledged).toBe(false)
    expect(acknowledgments[0].complete).toBe(false)
  })

  it('retrieves acknowledgment by event ID', async () => {
    dispatcher.registerHandler('Test.event', vi.fn())

    const event = createTestEvent('Test.event')
    await dispatcher.dispatch(event)

    const ack = dispatcher.getAcknowledgment(event.id)
    expect(ack).toBeDefined()
    expect(ack?.eventId).toBe(event.id)
  })

  it('checks if event is acknowledged', async () => {
    dispatcher.registerHandler('Test.event', vi.fn())

    const event = createTestEvent('Test.event')
    expect(dispatcher.isAcknowledged(event.id)).toBe(false)

    await dispatcher.dispatch(event)
    expect(dispatcher.isAcknowledged(event.id)).toBe(true)
  })

  it('supports manual acknowledgment', () => {
    const eventId = 'manual-event-123'
    const handlerId = 'handler-456'

    dispatcher.acknowledge(eventId, handlerId)

    const ack = dispatcher.getAcknowledgment(eventId)
    expect(ack).toBeDefined()
    expect(ack?.handlerIds).toContain(handlerId)
  })
})

// ============================================================================
// STATISTICS TESTS
// ============================================================================

describe('Statistics', () => {
  let dispatcher: EventDispatcher

  beforeEach(() => {
    dispatcher = new EventDispatcher()
  })

  afterEach(() => {
    dispatcher.clear()
  })

  it('tracks handler registration stats', () => {
    dispatcher.registerHandler('Customer.created', vi.fn())
    dispatcher.registerHandler('Customer.updated', vi.fn())
    dispatcher.registerHandler('Order.placed', vi.fn())

    const stats = dispatcher.getStats()

    expect(stats.totalHandlers).toBe(3)
    expect(stats.handlersByEventKey['Customer.created']).toBe(1)
    expect(stats.handlersByEventKey['Customer.updated']).toBe(1)
    expect(stats.handlersByEventKey['Order.placed']).toBe(1)
  })

  it('tracks DLQ stats', async () => {
    let shouldFail = true
    dispatcher.registerHandler('Test.event', () => {
      if (shouldFail) throw new Error('Failed')
    })

    // Create some DLQ entries
    await dispatcher.dispatch(createTestEvent('Test.event'))
    await dispatcher.dispatch(createTestEvent('Test.event'))

    let stats = dispatcher.getStats()
    expect(stats.dlqPending).toBe(2)
    expect(stats.dlqExhausted).toBe(0)
    expect(stats.dlqSucceeded).toBe(0)

    // Replay one successfully
    shouldFail = false
    const entries = dispatcher.getDLQEntries()
    await dispatcher.replayDLQEntry(entries[0].id)

    stats = dispatcher.getStats()
    expect(stats.dlqPending).toBe(1)
    expect(stats.dlqSucceeded).toBe(1)
  })

  it('tracks acknowledgment count', async () => {
    dispatcher.registerHandler('Test.event', vi.fn())

    await dispatcher.dispatch(createTestEvent('Test.event'))
    await dispatcher.dispatch(createTestEvent('Test.event'))

    const stats = dispatcher.getStats()
    expect(stats.totalAcknowledgments).toBe(2)
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createEventDispatcher', () => {
  it('creates dispatcher with default options', () => {
    const dispatcher = createEventDispatcher()
    expect(dispatcher).toBeInstanceOf(EventDispatcher)
  })

  it('creates dispatcher with custom options', () => {
    const onDLQEntry = vi.fn()
    const onTrace = vi.fn()

    const dispatcher = createEventDispatcher({
      defaultMaxRetries: 5,
      defaultRetryDelayMs: 2000,
      onDLQEntry,
      onTrace,
    })

    dispatcher.registerHandler('Test.event', () => {
      throw new Error('Failed')
    })

    return dispatcher.dispatch(createTestEvent('Test.event')).then(() => {
      expect(onDLQEntry).toHaveBeenCalled()
      expect(onTrace).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// TIMEOUT TESTS
// ============================================================================

describe('Handler Timeouts', () => {
  let dispatcher: EventDispatcher

  beforeEach(() => {
    dispatcher = createEventDispatcher({
      defaultTimeoutMs: 100, // Short timeout for testing
    })
  })

  afterEach(() => {
    dispatcher.clear()
  })

  it('times out slow handlers', async () => {
    dispatcher.registerHandler('Test.event', async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }, { timeoutMs: 50 })

    const result = await dispatcher.dispatch(createTestEvent('Test.event'))

    expect(result.failed).toBe(1)
    expect(result.errors[0].error).toContain('timed out')
  })

  it('records timeout in trace', async () => {
    dispatcher.registerHandler('Test.event', async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }, { timeoutMs: 50, name: 'slowHandler' })

    const result = await dispatcher.dispatch(createTestEvent('Test.event'))

    const timeoutTrace = result.traces.find((t) => t.handlerName === 'slowHandler')
    expect(timeoutTrace?.status).toBe('timeout')
  })
})
